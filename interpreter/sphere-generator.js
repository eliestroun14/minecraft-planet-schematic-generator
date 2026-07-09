'use strict';

const { VoxelWorld } = require('./world');
const { valueNoise3D } = require('./noise');

const DEFAULT_DIRT = 'minecraft:dirt';
const DEFAULT_GRASS = 'minecraft:grass_block';

const PASSIVE_MOBS = [
  'minecraft:cow', 'minecraft:sheep', 'minecraft:pig', 'minecraft:chicken',
  'minecraft:horse', 'minecraft:donkey', 'minecraft:llama', 'minecraft:rabbit', 'minecraft:mooshroom',
];

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// ---------------------------------------------------------------------------
// Zone layout: every planet, regardless of category, is built from the same
// seven concentric zones (fractions of the total radius, sum to 1.0):
//
//   bedrock (0.03) -> lava/magma (0.05) -> obsidian (0.04) -> deep (0.18)
//   -> semiDeep (0.18) -> central (0.18) -> outer (0.34, the thickest)
//
// "outer" doubles as the walkable surface for rocky/ring planets; habitable
// planets override its outermost few blocks with grass/dirt instead.
// ---------------------------------------------------------------------------
const ZONE_FRACTIONS = {
  bedrock: 0.03,
  lava: 0.05,
  obsidian: 0.04,
  deep: 0.18,
  semiDeep: 0.18,
  central: 0.18,
  outer: 0.34,
};
const SURFACE_OVERRIDE_THICKNESS = 4; // outer's outer edge that becomes grass/dirt on habitable planets

function zoneBoundaries(radius) {
  let acc = 0;
  const b = {};
  for (const [zone, frac] of Object.entries(ZONE_FRACTIONS)) {
    acc += radius * frac;
    b[zone] = acc;
  }
  return b; // { bedrock, lava, obsidian, deep, semiDeep, central, outer } — each an outer radius bound
}

// `b` is a precomputed zoneBoundaries(radius) result — computing it fresh
// per voxel (this is called millions of times per planet) was the single
// biggest cost in generation.
function zoneAt(r, b) {
  if (r <= b.bedrock) return 'bedrock';
  if (r <= b.lava) return 'lava';
  if (r <= b.obsidian) return 'obsidian';
  if (r <= b.deep) return 'deep';
  if (r <= b.semiDeep) return 'semiDeep';
  if (r <= b.central) return 'central';
  return 'outer';
}

// General terrain relief: rocky/ring planets get their outer radius
// perturbed by direction-dependent noise instead of being a perfect
// mathematical sphere. Zone boundaries shift by the same displacement so
// the strata still read as parallel layers following the bumpy surface.
const SPIKE_AMPLITUDE = 5;
const SPIKE_SCALE = 2.2;
function surfaceDisplacement(x, y, z, seed) {
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  const nx = (x / len) * SPIKE_SCALE, ny = (y / len) * SPIKE_SCALE, nz = (z / len) * SPIKE_SCALE;
  const n = valueNoise3D(nx, ny, nz, seed); // 0..1
  return (n - 0.5) * 2 * SPIKE_AMPLITUDE;
}

// Picks `options[0]` (the main rock) most of the time, with patches of
// options[1..] mixed in via noise — used for every multi-rock zone
// (semiDeep/central/outer) instead of independent per-voxel randomness, so
// the secondary rock forms coherent patches rather than static.
const SPICE_CHANCE = 0.22;
function pickWithNoise(options, x, y, z, seed) {
  if (options.length <= 1) return options[0];
  const n = valueNoise3D(x * 0.12, y * 0.12, z * 0.12, seed);
  if (n > 1 - SPICE_CHANCE) {
    const idx = Math.floor(n * 1000) % (options.length - 1);
    return options[1 + idx];
  }
  return options[0];
}

function blockForZone(zone, material, category, x, y, z, b, r, seed) {
  switch (zone) {
    case 'bedrock':
      return 'minecraft:bedrock';
    case 'lava':
      // Mostly liquid lava with magma_block patches, not a solid ball —
      // this is what makes it a molten core rather than a stone one.
      return pickWithNoise(['minecraft:lava', 'minecraft:magma_block'], x, y, z, seed + 11);
    case 'obsidian':
      return 'minecraft:obsidian';
    case 'deep':
      return material.deep.rock;
    case 'semiDeep':
      return pickWithNoise([material.semiDeep.mainRock, material.semiDeep.noiseRock], x, y, z, seed + 22);
    case 'central':
      return pickWithNoise([material.central.mainRock, ...material.central.noiseRocks], x, y, z, seed + 33);
    case 'outer': {
      if (category === 'habitable' && r >= b.outer - SURFACE_OVERRIDE_THICKNESS) {
        return null; // handled by the grass/dirt surface pass instead
      }
      return pickWithNoise([material.outer.mainRock, ...material.outer.noiseRocks], x, y, z, seed + 44);
    }
    default:
      return 'minecraft:stone';
  }
}

// ---------------------------------------------------------------------------
// Ore veins: count/size/spread vary per zone to match the requested feel —
// deep is a few big compact veins, semiDeep is big but loosely spread
// ("diffuse"), central's veins (both the 3 inherited from deep/semiDeep and
// its own 3 new ones) are smaller and tighter, outer is generous.
// ---------------------------------------------------------------------------
const VEIN_PROFILES = {
  deep: { count: 4, size: 40, spread: 1 },
  semiDeep: { count: 8, size: 40, spread: 3 },
  centralInherited: { count: 10, size: 12, spread: 1 },
  centralNew: { count: 10, size: 12, spread: 1 },
  outer: { count: 18, size: 20, spread: 2 },
};

function scatterOreVeins(world, rng, rMin, rMax, oreId, { count, size, spread }) {
  for (let i = 0; i < count; i++) {
    const r = rMin + rng() * Math.max(0, rMax - rMin);
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(2 * rng() - 1);
    let x = Math.round(r * Math.sin(phi) * Math.cos(theta));
    let y = Math.round(r * Math.sin(phi) * Math.sin(theta));
    let z = Math.round(r * Math.cos(phi));
    for (let v = 0; v < size; v++) {
      if (world.get(x, y, z) !== 'minecraft:air') world.set(x, y, z, oreId);
      x += Math.floor(rng() * (2 * spread + 1)) - spread;
      y += Math.floor(rng() * (2 * spread + 1)) - spread;
      z += Math.floor(rng() * (2 * spread + 1)) - spread;
    }
  }
}

// On a rocky/ring planet there's no vegetation to give the walkable top
// surface visual interest, so it comes from ore breaking the surface —
// deliberately the 3 ores from the deep/semiDeep zones (never central/
// outer's own ores), so a player can't tell what's actually most abundant
// just by looking at the surface without digging. Builds a short ridge of
// raised mounds (adds height on top of the ground instead of replacing it)
// so the vein visibly protrudes as an outcrop.
function exposeSurfaceOre(world, rng, radius, deepSemiDeepOres) {
  if (!deepSemiDeepOres.length) return;
  const ridgeCount = 10;
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

    const oreId = pick(rng, deepSemiDeepOres);
    const mounds = 4 + Math.floor(rng() * 4);
    for (let m = 0; m < mounds; m++) {
      const mR = 1 + Math.floor(rng() * 2);
      const mH = 1 + Math.floor(rng() * 2);
      for (let dx = -mR; dx <= mR; dx++) {
        for (let dz = -mR; dz <= mR; dz++) {
          if (dx * dx + dz * dz > mR * mR) continue;
          if (rng() < 0.25) continue;
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

// Carves organic pockets via 3D value noise, confined to the central zone
// and inward from it (never reaching into "outer", which needs to stay
// structurally intact for surface features/liquid pockets).
function carveCaves(world, radius, rng, seed) {
  const b = zoneBoundaries(radius);
  const rCeiling = Math.round(b.central - 2);
  const rFloor = Math.round(b.obsidian + 2);
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
// than picking a fresh random direction) so the path curves naturally.
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

// Underground liquid pockets — confined to the outer zone specifically (per
// spec: "poches de liquide... dans la couche externe"), not scattered
// anywhere in the planet's interior.
function scatterLiquidPockets(world, rng, radius, liquidId, count = 3) {
  const b = zoneBoundaries(radius);
  const rMin = b.central;
  const rMax = b.outer - SURFACE_OVERRIDE_THICKNESS - 2;
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

// Builds a simple trunk-and-canopy tree at (x, groundY, z), trunk resting ON
// TOP of the ground block, so it never needs its own external support check.
function placeTree(world, x, groundY, z, wood, rng) {
  const height = 4 + Math.floor(rng() * 3);
  const verticalLog = wood.log.includes('[') ? wood.log : `${wood.log}[axis=y]`;
  for (let i = 0; i < height; i++) world.set(x, groundY + i, z, verticalLog);
  const topY = groundY + height - 1;
  for (let dy = -2; dy <= 1; dy++) {
    const ringRadius = dy <= -1 ? 2 : 1;
    for (let dx = -ringRadius; dx <= ringRadius; dx++) {
      for (let dz = -ringRadius; dz <= ringRadius; dz++) {
        if (dx === 0 && dz === 0 && dy < 1) continue;
        if (Math.abs(dx) === ringRadius && Math.abs(dz) === ringRadius && rng() < 0.5) continue;
        const px = x + dx, py = topY + dy, pz = z + dz;
        if (world.get(px, py, pz) === 'minecraft:air') world.set(px, py, pz, wood.leaves);
      }
    }
  }
}

// Only ever called with the true topmost solid block of a (x,z) column, so
// every plant placed here has guaranteed support directly beneath it.
function decorateSurface(world, rng, radius, material) {
  const ceiling = radius + 6;
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
  const searchRadius = Math.min(radius - SURFACE_OVERRIDE_THICKNESS, radius * 0.6);
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

function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function normalize(a) {
  const len = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) || 1;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}
function randomUnitVector(rng) {
  const z = rng() * 2 - 1;
  const theta = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return { x: r * Math.cos(theta), y: r * Math.sin(theta), z };
}

const RING_CORE_FRACTION = 0.75;
const RING_GAP = 12;
const RING_WIDTH = 24;
const RING_THICKNESS = 5;
const RING_ORE_CHANCE = 0.07;
const RING_POROSITY = 0.4;

function generateRing(world, rng, coreRadius, ringBlocks, ringOre, seed, tilt) {
  const blocks = ringBlocks && ringBlocks.length >= 2 ? ringBlocks : ['minecraft:stone', 'minecraft:cobblestone'];
  const ore = ringOre || 'minecraft:iron_ore';
  const innerR = coreRadius + RING_GAP;
  const outerR = innerR + RING_WIDTH;
  const normal = tilt || randomUnitVector(rng);
  const arbitrary = Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = normalize(cross(normal, arbitrary));
  const v = cross(normal, u);

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

// material shape (see interpreter/material.js's resolveMaterial for how this
// gets filled in from a template + bank):
// {
//   category, liquid,
//   deep: { rock, ore },
//   semiDeep: { mainRock, noiseRock, ores: [2] },
//   central: { mainRock, noiseRocks: [2], ores: [3] },
//   outer: { mainRock, noiseRocks: [2] },
//   // habitable only:
//   dirt, grass, grassAlt, wood?, woods?, flower, herb,
//   // ring only:
//   ringBlocks: [2], ringOre, ringTilt,
// }
function generatePlanet({ category, material, radius = 130, seed = 1, spawnerCount }) {
  const { mulberry32 } = require('./rng');
  const rng = mulberry32(seed);
  const noiseSeed = seed ^ 0x9e3779b9;
  const world = new VoxelWorld();

  const isRockLike = category === 'rocky' || category === 'ring';
  // Must stay an integer: a fractional radius shifts the whole core loop
  // onto a half-integer coordinate grid that won't line up with the ring's
  // integer grid, and isn't a valid Minecraft block position either way.
  const coreRadius = category === 'ring' ? Math.round(radius * RING_CORE_FRACTION) : radius;

  const grass = material.grass || DEFAULT_GRASS;
  const grassAlt = material.grassAlt || grass;
  const dirt = material.dirt || DEFAULT_DIRT;

  const zoneBounds = zoneBoundaries(coreRadius); // computed ONCE, not per voxel
  const spikeRadius = coreRadius + SPIKE_AMPLITUDE;
  for (let x = -spikeRadius; x <= spikeRadius; x++) {
    for (let y = -spikeRadius; y <= spikeRadius; y++) {
      for (let z = -spikeRadius; z <= spikeRadius; z++) {
        const rRaw = Math.sqrt(x * x + y * y + z * z);
        if (rRaw > spikeRadius) continue;
        const disp = isRockLike ? surfaceDisplacement(x, y, z, noiseSeed) : 0;
        const r = rRaw - disp;
        if (r > coreRadius) continue;
        const zone = zoneAt(r, zoneBounds);
        let blockId = blockForZone(zone, material, category, x, y, z, zoneBounds, r, noiseSeed);
        if (blockId === null) {
          blockId = r >= coreRadius - 1 ? (rng() < 0.5 ? grass : grassAlt) : dirt;
        }
        world.set(x, y, z, blockId);
      }
    }
  }

  carveCaves(world, coreRadius, rng, noiseSeed);

  const b = zoneBoundaries(coreRadius);
  const deepOre = material.deep.ore;
  const semiDeepOres = material.semiDeep.ores;
  const inheritedOres = [deepOre, ...semiDeepOres]; // the "1+2" from deep+semiDeep
  const centralNewOres = material.central.ores;

  scatterOreVeins(world, rng, b.obsidian, b.deep, deepOre, VEIN_PROFILES.deep);
  for (const oreId of semiDeepOres) scatterOreVeins(world, rng, b.deep, b.semiDeep, oreId, VEIN_PROFILES.semiDeep);
  for (const oreId of inheritedOres) scatterOreVeins(world, rng, b.semiDeep, b.central, oreId, VEIN_PROFILES.centralInherited);
  for (const oreId of centralNewOres) scatterOreVeins(world, rng, b.semiDeep, b.central, oreId, VEIN_PROFILES.centralNew);
  const outerMax = b.outer - SURFACE_OVERRIDE_THICKNESS;
  for (const oreId of centralNewOres) scatterOreVeins(world, rng, b.central, outerMax, oreId, VEIN_PROFILES.outer);

  if (isRockLike) exposeSurfaceOre(world, rng, coreRadius, inheritedOres);

  // Liquid: river always on the walkable surface; pockets confined to the
  // outer zone per spec.
  const liquid = material.liquid || 'minecraft:water';
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

module.exports = { generatePlanet, zoneBoundaries };
