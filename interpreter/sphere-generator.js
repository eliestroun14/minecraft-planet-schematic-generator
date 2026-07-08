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
// Secondary "spice" materials mixed into each default (non-templated) band
// via noise-based patches, purely for visual variety — real shipped planets
// have noticeably more block diversity per band than a flat single material.
// Only applied where a template hasn't specified its own themed stoneLayers,
// so a deliberately-themed template (nether "stem", volcanic, etc) stays
// visually coherent.
const BAND_SPICE = {
  0: ['minecraft:granite'],
  1: ['minecraft:granite', 'minecraft:tuff'],
  2: ['minecraft:gravel', 'minecraft:tuff'],
  3: ['minecraft:gravel', 'minecraft:sandstone'],
};
const BAND_SPICE_CHANCE = 0.16;
// Innermost core: a small solid center distinct from the deep-rock band,
// giving planets an actual "start from the core" layer instead of the
// deep-inner band simply continuing in forever.
const CORE_FRACTION = 0.22;
const CORE_ROCK = { rocky: 'minecraft:bedrock', habitable: 'minecraft:deepslate', ring: 'minecraft:bedrock' };

// Ring planets: a rocky-style core body shrunk to 75% of the nominal radius,
// orbited by a separate ring structure. RING_GAP/WIDTH/THICKNESS are offsets
// from the core's own (already-shrunk) radius, not the nominal one.
const RING_CORE_FRACTION = 0.75;
const RING_GAP = 10;
const RING_WIDTH = 20;
const RING_THICKNESS = 4;
const RING_ORE_CHANCE = 0.07;
// Fraction of candidate ring positions that are actually solid — a fully
// filled disc reads as a slab, not a ring of countless rock/ice fragments.
const RING_POROSITY = 0.4;
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

// General terrain relief: rocky planets get their outer radius perturbed by
// direction-dependent noise instead of being a perfect mathematical sphere.
// Band boundaries shift by the same displacement so the rock strata still
// read as parallel layers following the bumpy surface. This is separate
// from — and secondary to — exposed ore veins (see scatterOreVeins) for
// giving the walkable top surface visual interest on a rocky planet.
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
  if (r >= radius * CORE_FRACTION) return -1; // inner filler, reuses deep-inner rock
  return -2; // true core
}

function surfaceDisplacement(x, y, z, seed) {
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  const nx = (x / len) * SPIKE_SCALE, ny = (y / len) * SPIKE_SCALE, nz = (z / len) * SPIKE_SCALE;
  const n = valueNoise3D(nx, ny, nz, seed); // 0..1
  return (n - 0.5) * 2 * SPIKE_AMPLITUDE; // -AMPLITUDE..+AMPLITUDE
}

function blockForBand(band, material, category, x, y, z, spiceSeed) {
  const layers = material.stoneLayers;
  if (band === -2) return CORE_ROCK[category] || DEFAULT_STONE;
  if (band === -1) return (layers && layers[0]) || DEFAULT_BAND_ROCK[0]; // inner filler
  // Checked BEFORE stoneLayers[band]: on a habitable planet the walkable
  // surface always comes from grass/dirt (below), even for a template that
  // also specifies a band-3 stoneLayers entry (e.g. "stem") — otherwise the
  // literal rock band wins, decorateSurface never finds a grass-family top
  // block to plant on, and the whole planet ends up bare.
  if (band === 3 && category === 'habitable') return null;
  if (layers && layers[band]) return layers[band]; // template-themed band: no spice, stays coherent
  const spiceOptions = BAND_SPICE[band];
  if (spiceOptions) {
    const n = valueNoise3D(x * 0.12, y * 0.12, z * 0.12, spiceSeed + band * 97);
    if (n > 1 - BAND_SPICE_CHANCE) return spiceOptions[Math.floor(n * 1000) % spiceOptions.length];
  }
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
// `oreId` PER solid rock band. Deliberately stops at rDirtStart — buried
// veins reaching into the outer shell would sit flush with the ground once
// exposed, undermining exposeSurfaceOre's whole point of making surface ore
// visibly protrude as raised outcrops instead.
function scatterOreVeins(world, rng, radius, oreId, density) {
  const count = density * ORE_VEINS_PER_DENSITY_UNIT;
  const { rDirtStart, rStoneStart, rDeepOuterStart, rDeepInnerStart } = bandBoundaries(radius);
  scatterOreVeinsInRange(world, rng, rDeepInnerStart + 2, rDeepOuterStart, oreId, count);
  scatterOreVeinsInRange(world, rng, rDeepOuterStart, rStoneStart, oreId, count);
  scatterOreVeinsInRange(world, rng, rStoneStart, rDirtStart, oreId, count);
}

// On a rocky planet there's no vegetation to give the walkable top surface
// visual interest, so that interest has to come from ore veins actually
// breaking the surface — "aspérités" the player can see and mine without
// digging. Rather than just swapping the existing topmost block for ore
// (flush with the ground, easy to miss), this builds a short ridge of small
// raised mounds — each mound ADDS 1-2 ore blocks on top of the existing
// surface instead of replacing it, so the vein visibly protrudes above the
// surrounding terrain like a real outcrop. Every mound still anchors off
// the true topmost block of its column (same trick decorateSurface uses for
// plants), so it's always properly supported and where the player actually
// walks.
function exposeSurfaceOre(world, rng, radius, ores, density) {
  if (!ores || !ores.length) return;
  const ridgeCount = Math.round(2 + density * 2.5);
  let placed = 0;
  let attempts = 0;
  while (placed < ridgeCount && attempts < ridgeCount * 20) {
    attempts++;
    const ang = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius * 0.9;
    let x = Math.round(Math.cos(ang) * r);
    let z = Math.round(Math.sin(ang) * r);
    if (world.topSurfaceY(x, z, radius + 6) === null) continue;
    placed++;

    const oreId = pick(rng, ores);
    const mounds = 4 + Math.floor(rng() * 4); // elongated ridge, not one lump
    for (let m = 0; m < mounds; m++) {
      const mR = 1 + Math.floor(rng() * 2); // 1-2 block footprint radius
      const mH = 1 + Math.floor(rng() * 2); // 1-2 blocks of extra height
      for (let dx = -mR; dx <= mR; dx++) {
        for (let dz = -mR; dz <= mR; dz++) {
          if (dx * dx + dz * dz > mR * mR) continue;
          if (rng() < 0.25) continue; // ragged edge instead of a perfect disc
          const bx = x + dx, bz = z + dz;
          const topY = world.topSurfaceY(bx, bz, radius + 6);
          if (topY === null) continue;
          for (let h = 0; h <= mH; h++) world.set(bx, topY + h, bz, oreId);
        }
      }
      x += Math.floor(rng() * 3) - 1;
      z += Math.floor(rng() * 3) - 1;
    }
  }
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

// A winding surface channel across the walkable top, carved a couple blocks
// deep and filled with liquid — a river, not just a static lake. Follows a
// random walk with momentum (each step nudges the previous heading rather
// than picking a fresh random direction) so the path curves naturally
// instead of zigzagging.
function carveRiver(world, rng, radius, liquidId) {
  const startAng = rng() * Math.PI * 2;
  let x = Math.cos(startAng) * radius * 0.3;
  let z = Math.sin(startAng) * radius * 0.3;
  let heading = rng() * Math.PI * 2;
  const steps = 90 + Math.floor(rng() * 60);
  for (let i = 0; i < steps; i++) {
    heading += (rng() - 0.5) * 0.5;
    x += Math.cos(heading) * 1.5;
    z += Math.sin(heading) * 1.5;
    if (x * x + z * z > radius * radius * 0.92) break;

    const ix = Math.round(x), iz = Math.round(z);
    const topY = world.topSurfaceY(ix, iz, radius + 6);
    if (topY === null) continue;
    const w = 2 + Math.floor(rng() * 2);
    for (let dx = -w; dx <= w; dx++) {
      for (let dz = -w; dz <= w; dz++) {
        if (dx * dx + dz * dz > w * w) continue;
        const bx = ix + dx, bz = iz + dz;
        const by = world.topSurfaceY(bx, bz, radius + 6);
        if (by === null) continue;
        world.set(bx, by, bz, liquidId);
        world.set(bx, by - 1, bz, liquidId);
        if (world.get(bx, by + 1, bz) !== 'minecraft:air') world.blocks.delete(world.key(bx, by + 1, bz));
      }
    }
  }
}

function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function normalize(a) {
  const len = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) || 1;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}
// Uniformly random point on the unit sphere — used as the ring plane's
// normal vector. n=(0,1,0) gives a flat/equatorial ring (parallel to the
// "ground"); n=(1,0,0) or (0,0,1) gives a ring standing on edge, perpendicular
// to the ground; anything else is a tilted/oblique ring ("de biais") — one
// formula covers every case the ring's orientation is supposed to vary over.
function randomUnitVector(rng) {
  const z = rng() * 2 - 1;
  const theta = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return { x: r * Math.cos(theta), y: r * Math.sin(theta), z };
}

// Builds a ring orbiting the core at [coreRadius+RING_GAP, +RING_GAP+WIDTH],
// in an arbitrary plane (tilt), out of two alternating block types plus a
// scattered ore. Walks the ring in its own polar coordinates (angle/radius/
// height-off-plane) rather than a bounding-cube voxel loop, since the actual
// ring shell is a tiny fraction of the cube that would contain it.
function generateRing(world, rng, coreRadius, ringBlocks, ringOre, seed, tilt) {
  const blocks = ringBlocks && ringBlocks.length >= 2 ? ringBlocks : ['minecraft:stone', 'minecraft:cobblestone'];
  const ore = ringOre || 'minecraft:iron_ore';
  const innerR = coreRadius + RING_GAP;
  const outerR = innerR + RING_WIDTH;
  const normal = tilt || randomUnitVector(rng);
  const arbitrary = Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = normalize(cross(normal, arbitrary));
  const v = cross(normal, u); // unit length: normal and u are orthonormal

  const angleSteps = Math.max(64, Math.round(outerR * 2 * Math.PI));
  for (let ai = 0; ai < angleSteps; ai++) {
    const theta = (ai / angleSteps) * Math.PI * 2;
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    for (let r = innerR; r <= outerR; r += 1) {
      for (let h = -RING_THICKNESS / 2; h <= RING_THICKNESS / 2; h += 1) {
        const x = Math.round(r * cosT * u.x + r * sinT * v.x + h * normal.x);
        const y = Math.round(r * cosT * u.y + r * sinT * v.y + h * normal.y);
        const z = Math.round(r * cosT * u.z + r * sinT * v.z + h * normal.z);
        const n = valueNoise3D(x * 0.1, y * 0.1, z * 0.1, seed);
        if (n < RING_POROSITY) continue;
        const blockId = rng() < RING_ORE_CHANCE ? ore : (rng() < 0.5 ? blocks[0] : blocks[1]);
        world.set(x, y, z, blockId);
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
  // Explicit axis=y: a bare block id defaults correctly in native structure
  // NBT, but leaving it implicit here isn't worth the risk of a sideways
  // trunk if some downstream reader doesn't fall back the same way.
  const verticalLog = wood.log.includes('[') ? wood.log : `${wood.log}[axis=y]`;
  for (let i = 0; i < height; i++) world.set(x, groundY + i, z, verticalLog);
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
// flower?, herb?, liquid?, ores?, oreDensityPerBand?, ringBlocks?, ringOre?,
// ringTilt? } — see README.md.
// fallbackLiquids: blocks/vanilla.json's `liquid` list, used for the
// river/underground pockets when a template doesn't specify its own liquid.
function generatePlanet({ category, material, radius = 90, seed = 1, spawnerCount, fallbackLiquids }) {
  const { mulberry32 } = require('./rng');
  const rng = mulberry32(seed);
  const noiseSeed = seed ^ 0x9e3779b9;
  const world = new VoxelWorld();

  // Ring planets: everything about the core body (bands, caves, ore,
  // river/pockets) is generated exactly like a rocky planet, just shrunk —
  // the ring itself is a separate feature added on top afterward.
  const isRockLike = category === 'rocky' || category === 'ring';
  // Must stay an integer: a fractional radius (e.g. 90*0.75=67.5) shifts the
  // whole core generation loop onto a half-integer coordinate grid, which
  // then silently fails to line up with the ring's integer grid (and isn't
  // a valid Minecraft block position either way).
  const coreRadius = category === 'ring' ? Math.round(radius * RING_CORE_FRACTION) : radius;

  const grass = material.grass || DEFAULT_GRASS;
  const grassAlt = material.grassAlt || grass;
  const dirt = material.dirt || DEFAULT_DIRT;

  const spikeRadius = coreRadius + SPIKE_AMPLITUDE;
  for (let x = -spikeRadius; x <= spikeRadius; x++) {
    for (let y = -spikeRadius; y <= spikeRadius; y++) {
      for (let z = -spikeRadius; z <= spikeRadius; z++) {
        const rRaw = Math.sqrt(x * x + y * y + z * z);
        if (rRaw > spikeRadius) continue;
        const disp = isRockLike ? surfaceDisplacement(x, y, z, noiseSeed) : 0;
        const r = rRaw - disp; // positive noise pushes material outward
        if (r > coreRadius) continue;
        const band = bandAt(r, coreRadius);
        let blockId = blockForBand(band, material, category === 'ring' ? 'rocky' : category, x, y, z, noiseSeed);
        if (blockId === null) {
          // outermost shell of a habitable planet with no custom stoneLayers:
          // grass on the very surface, a thin dirt band just beneath it.
          blockId = r >= coreRadius - 1 ? (rng() < 0.5 ? grass : grassAlt) : dirt;
        }
        world.set(x, y, z, blockId);
      }
    }
  }

  carveCaves(world, coreRadius, rng, noiseSeed);

  // Ore is a rocky/ring-planet feature only — habitable planets get their
  // visual interest from vegetation instead (a scattering of exposed ore
  // across a grassy planet reads as noise, not a deliberate resource).
  if (isRockLike) {
    const ores = material.ores || [];
    const density = material.oreDensityPerBand || 2;
    for (const oreId of ores) scatterOreVeins(world, rng, coreRadius, oreId, density);
    exposeSurfaceOre(world, rng, coreRadius, ores, density);
  }

  // Every planet gets a river and a couple of underground pockets on its
  // core body — using the template's own liquid if it specified one,
  // otherwise picking from the shared block bank so this doesn't depend on
  // every template explicitly opting in.
  const liquidPool = fallbackLiquids && fallbackLiquids.length ? fallbackLiquids : ['minecraft:water'];
  const liquid = material.liquid || pick(rng, liquidPool);
  carveRiver(world, rng, coreRadius, liquid);
  scatterLiquidPockets(world, rng, coreRadius, liquid, 1 + Math.floor(rng() * 2));

  let spawners = [];
  if (category === 'habitable') {
    decorateSurface(world, rng, coreRadius, material);
    spawners = placePassiveMobSpawners(world, rng, coreRadius, spawnerCount || (3 + Math.floor(rng() * 3)));
  }

  if (category === 'ring') {
    generateRing(world, rng, coreRadius, material.ringBlocks, material.ringOre, noiseSeed, material.ringTilt);
  }

  placeBoundsMarkers(world);

  return { world, spawners };
}

module.exports = { generatePlanet };
