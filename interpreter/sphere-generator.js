'use strict';

const { VoxelWorld } = require('./world');
const { valueNoise3D } = require('./noise');

const DEFAULT_STONE = 'minecraft:stone';
const DEFAULT_DIRT = 'minecraft:dirt';
const DEFAULT_GRASS = 'minecraft:grass_block';
// Default rock per band (used whenever a template doesn't specify its own
// stoneLayers) — andesite/diorite for the two deep bands, matching the
// "andesite inner / diorite-accent outer" banding real rocky planets in the
// live datapack actually use, rather than flat stone everywhere.
const DEFAULT_BAND_ROCK = ['minecraft:andesite', 'minecraft:diorite', DEFAULT_STONE, DEFAULT_STONE];
// Real shipped planets run ~2% ore-to-solid-block density; this multiplier
// tunes oreDensityPerBand (a small template-authored int like 1-3) up to
// something in that neighborhood without changing the config schema.
const ORE_VEINS_PER_DENSITY_UNIT = 40;

const PASSIVE_MOBS = [
  'minecraft:cow', 'minecraft:sheep', 'minecraft:pig', 'minecraft:chicken',
  'minecraft:horse', 'minecraft:donkey', 'minecraft:llama', 'minecraft:rabbit', 'minecraft:mooshroom',
];

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// Radial shell thicknesses, outermost first. Original design: four bands
// (dirt-shell / stone-layer / deep-outer accent / deep-inner) wrapping a
// solid core, mirrored in every direction from the planet's center — a
// plain distance-from-center voxel loop, no relation to the old
// entity-rotation/caret-fill approach it replaces.
const DIRT_SHELL = 4;
const STONE_LAYER = 8;
const DEEP_OUTER = 10;
const DEEP_INNER = 12;

// Surface roughness ("rocky spikes"): rocky planets get their outer radius
// perturbed by direction-dependent noise instead of being a perfect
// mathematical sphere. Band boundaries shift by the same displacement so the
// rock strata still read as parallel layers following the bumpy surface.
const SPIKE_AMPLITUDE = 5;
const SPIKE_SCALE = 2.2;

function bandBoundaries(radius) {
  const rDirtStart = radius - DIRT_SHELL;
  const rStoneStart = rDirtStart - STONE_LAYER;
  const rDeepOuterStart = rStoneStart - DEEP_OUTER;
  const rDeepInnerStart = rDeepOuterStart - DEEP_INNER;
  return { rDirtStart, rStoneStart, rDeepOuterStart, rDeepInnerStart };
}

function bandAt(r, radius) {
  const { rDirtStart, rStoneStart, rDeepOuterStart, rDeepInnerStart } = bandBoundaries(radius);
  if (r >= rDirtStart) return 3; // outermost shell
  if (r >= rStoneStart) return 2;
  if (r >= rDeepOuterStart) return 1;
  if (r >= rDeepInnerStart) return 0;
  return -1; // core
}

function surfaceDisplacement(x, y, z, seed) {
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  const nx = (x / len) * SPIKE_SCALE, ny = (y / len) * SPIKE_SCALE, nz = (z / len) * SPIKE_SCALE;
  const n = valueNoise3D(nx, ny, nz, seed); // 0..1
  return (n - 0.5) * 2 * SPIKE_AMPLITUDE; // -AMPLITUDE..+AMPLITUDE
}

function blockForBand(band, material, category) {
  const layers = material.stoneLayers;
  if (band === -1) return (layers && layers[0]) || DEFAULT_BAND_ROCK[0]; // core reuses innermost rock
  if (layers && layers[band]) return layers[band];
  if (band === 3 && category === 'habitable') return null; // handled by surface pass instead
  return DEFAULT_BAND_ROCK[band];
}

// Scatters `count` veins (6-10 blocks each) of `oreId` at random positions
// within a single explicit radius range [rMin, rMax].
function scatterOreVeinsInRange(world, rng, rMin, rMax, oreId, count) {
  for (let i = 0; i < count; i++) {
    const r = rMin + rng() * Math.max(0, rMax - rMin);
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(2 * rng() - 1);
    const cx = Math.round(r * Math.sin(phi) * Math.cos(theta));
    const cy = Math.round(r * Math.sin(phi) * Math.sin(theta));
    const cz = Math.round(r * Math.cos(phi));
    const veinSize = 6 + Math.floor(rng() * 5);
    let x = cx, y = cy, z = cz;
    for (let v = 0; v < veinSize; v++) {
      if (world.get(x, y, z) !== 'minecraft:air') world.set(x, y, z, oreId);
      x += Math.floor(rng() * 3) - 1;
      y += Math.floor(rng() * 3) - 1;
      z += Math.floor(rng() * 3) - 1;
    }
  }
}

// `density` (as authored in a template, e.g. 1-3) veins-per-density-unit of
// `oreId` PER solid rock band (deep-inner, deep-outer, stone-layer — never
// the outer dirt/grass shell or the untouched core).
function scatterOreVeins(world, rng, radius, oreId, density) {
  const count = density * ORE_VEINS_PER_DENSITY_UNIT;
  const { rDirtStart, rStoneStart, rDeepOuterStart, rDeepInnerStart } = bandBoundaries(radius);
  scatterOreVeinsInRange(world, rng, rDeepInnerStart + 2, rDeepOuterStart, oreId, count);
  scatterOreVeinsInRange(world, rng, rDeepOuterStart, rStoneStart, oreId, count);
  scatterOreVeinsInRange(world, rng, rStoneStart, rDirtStart - 2, oreId, count);
}

// Carves organic pockets out of the interior using 3D value noise, leaving
// the outer shell and a solid inner core intact so caves never breach the
// surface or hollow out the planet entirely.
function carveCaves(world, radius, rng, seed) {
  const rCeiling = radius - DIRT_SHELL - STONE_LAYER - 2;
  const rFloor = radius * 0.2;
  const scale = 0.08;
  for (let x = -rCeiling; x <= rCeiling; x++) {
    for (let y = -rCeiling; y <= rCeiling; y++) {
      for (let z = -rCeiling; z <= rCeiling; z++) {
        const r = Math.sqrt(x * x + y * y + z * z);
        if (r > rCeiling || r < rFloor) continue;
        const n = valueNoise3D(x * scale, y * scale, z * scale, seed);
        if (n > 0.74) world.blocks.delete(world.key(x, y, z));
      }
    }
  }
}

function scatterLiquidPockets(world, rng, radius, liquidId, count = 3) {
  const rMin = radius - DIRT_SHELL - STONE_LAYER;
  const rMax = radius - DIRT_SHELL - 3;
  for (let i = 0; i < count; i++) {
    const r = rMin + rng() * Math.max(0, rMax - rMin);
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(2 * rng() - 1);
    const cx = Math.round(r * Math.sin(phi) * Math.cos(theta));
    const cy = Math.round(r * Math.sin(phi) * Math.sin(theta));
    const cz = Math.round(r * Math.cos(phi));
    const poolRadius = 2 + Math.floor(rng() * 2);
    for (let dx = -poolRadius; dx <= poolRadius; dx++) {
      for (let dy = -poolRadius; dy <= poolRadius; dy++) {
        for (let dz = -poolRadius; dz <= poolRadius; dz++) {
          if (dx * dx + dy * dy + dz * dz > poolRadius * poolRadius) continue;
          world.set(cx + dx, cy + dy, cz + dz, liquidId);
        }
      }
    }
  }
}

// Builds a simple 3-4 block trunk-and-canopy tree at (x, groundY, z), with
// the trunk's base resting ON TOP of the ground block (world.get(x,groundY-1,z)
// is the surface), so it never needs its own external support check.
function placeTree(world, x, groundY, z, wood, rng) {
  const height = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < height; i++) world.set(x, groundY + i, z, wood.log);
  const topY = groundY + height - 1;
  for (let dy = -2; dy <= 1; dy++) {
    const ringRadius = dy <= -1 ? 2 : 1;
    for (let dx = -ringRadius; dx <= ringRadius; dx++) {
      for (let dz = -ringRadius; dz <= ringRadius; dz++) {
        if (dx === 0 && dz === 0 && dy < 1) continue; // leave trunk itself alone
        if (Math.abs(dx) === ringRadius && Math.abs(dz) === ringRadius && rng() < 0.5) continue;
        const px = x + dx, py = topY + dy, pz = z + dz;
        if (world.get(px, py, pz) === 'minecraft:air') world.set(px, py, pz, wood.leaves);
      }
    }
  }
}

// Only ever called with the true topmost solid block of a (x,z) column, so
// every plant placed here has guaranteed support directly beneath it —
// structurally impossible to produce the floating-plant problem the
// downstream .nbt converter has to defend against for hand-captured
// schematics.
function decorateSurface(world, rng, radius, material) {
  const spawners = [];
  const ceiling = radius + 6; // a little above the sphere to guarantee we start outside it
  // Fixed templates specify a single `wood: {log,leaves}`; the random
  // generator produces a `woods: [...]` array of several species. Accept both.
  const woods = material.woods && material.woods.length ? material.woods : (material.wood ? [material.wood] : null);
  const flowers = material.flower;
  const herbs = material.herb;

  for (let x = -radius; x <= radius; x++) {
    for (let z = -radius; z <= radius; z++) {
      if (x * x + z * z > radius * radius) continue;
      const groundY = world.topSurfaceY(x, z, ceiling);
      if (groundY === null) continue;
      const groundBlock = world.get(x, groundY, z);
      if (groundBlock !== 'minecraft:grass_block' && groundBlock !== material.grass && groundBlock !== material.grassAlt) continue;
      if (world.get(x, groundY + 1, z) !== 'minecraft:air') continue;

      const roll = rng();
      if (woods && roll < 0.02) {
        placeTree(world, x, groundY + 1, z, pick(rng, woods), rng);
      } else if (flowers && roll < 0.07) {
        world.set(x, groundY + 1, z, pick(rng, flowers));
      } else if (herbs && roll < 0.14) {
        world.set(x, groundY + 1, z, pick(rng, herbs));
      }
    }
  }
  return spawners;
}

function placePassiveMobSpawners(world, rng, radius, count) {
  const mobPool = [];
  const pool = PASSIVE_MOBS.slice();
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * pool.length);
    mobPool.push(pool[idx]);
    pool.splice(idx, 1);
  }

  const placed = [];
  let attempts = 0;
  const searchRadius = Math.min(radius - DIRT_SHELL, 55);
  while (placed.length < mobPool.length && attempts < 400) {
    attempts++;
    const ang = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * searchRadius;
    const x = Math.round(Math.cos(ang) * r);
    const z = Math.round(Math.sin(ang) * r);
    const groundY = world.topSurfaceY(x, z, radius + 6);
    if (groundY === null) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 18)) continue;
    if (world.get(x, groundY, z) === 'minecraft:water' || world.get(x, groundY, z) === 'minecraft:lava') continue;
    if (world.get(x, groundY + 1, z) !== 'minecraft:air') continue;
    if (world.get(x, groundY + 2, z) !== 'minecraft:air') continue;

    const mob = mobPool[placed.length];
    world.set(x, groundY + 1, z, 'minecraft:spawner');
    world.setBlockEntity(x, groundY + 1, z, { Id: 'minecraft:mob_spawner', SpawnData: { entity: { id: mob } } });
    placed.push({ x, z, mob });
  }
  return placed;
}

function placeBoundsMarkers(world) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const key of world.blocks.keys()) {
    const [x, y, z] = key.split(',').map(Number);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  world.set(minX, minY, minZ, 'minecraft:diamond_block');
  world.set(maxX, maxY, maxZ, 'minecraft:emerald_block');
}

// material shape: { category, stoneLayers?, dirt?, grass?, grassAlt?, woods?,
// flower?, herb?, liquid?, ores?, oreDensityPerBand? } — see README.md.
function generatePlanet({ category, material, radius = 90, seed = 1, spawnerCount }) {
  const { mulberry32 } = require('./rng');
  const rng = mulberry32(seed);
  const noiseSeed = seed ^ 0x9e3779b9;
  const world = new VoxelWorld();

  const grass = material.grass || DEFAULT_GRASS;
  const grassAlt = material.grassAlt || grass;
  const dirt = material.dirt || DEFAULT_DIRT;

  const spikeRadius = radius + SPIKE_AMPLITUDE;
  for (let x = -spikeRadius; x <= spikeRadius; x++) {
    for (let y = -spikeRadius; y <= spikeRadius; y++) {
      for (let z = -spikeRadius; z <= spikeRadius; z++) {
        const rRaw = Math.sqrt(x * x + y * y + z * z);
        if (rRaw > spikeRadius) continue;
        const disp = category === 'rocky' ? surfaceDisplacement(x, y, z, noiseSeed) : 0;
        const r = rRaw - disp; // positive noise pushes material outward
        if (r > radius) continue;
        const band = bandAt(r, radius);
        let blockId = blockForBand(band, material, category);
        if (blockId === null) {
          // outermost shell of a habitable planet with no custom stoneLayers:
          // grass on the very surface, a thin dirt band just beneath it.
          blockId = r >= radius - 1 ? (rng() < 0.5 ? grass : grassAlt) : dirt;
        }
        world.set(x, y, z, blockId);
      }
    }
  }

  carveCaves(world, radius, rng, noiseSeed);

  const ores = material.ores || [];
  const density = material.oreDensityPerBand || 2;
  for (const oreId of ores) scatterOreVeins(world, rng, radius, oreId, density);

  if (material.liquid) scatterLiquidPockets(world, rng, radius, material.liquid);

  let spawners = [];
  if (category === 'habitable') {
    decorateSurface(world, rng, radius, material);
    spawners = placePassiveMobSpawners(world, rng, radius, spawnerCount || (3 + Math.floor(rng() * 3)));
  }

  placeBoundsMarkers(world);

  return { world, spawners };
}

module.exports = { generatePlanet };
