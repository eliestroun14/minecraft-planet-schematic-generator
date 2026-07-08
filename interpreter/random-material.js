'use strict';

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function pickN(rng, arr, n) {
  const pool = arr.slice();
  const out = [];
  n = Math.min(n, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

// Builds ONE fresh, fully independent random material assignment. Unlike
// generate_presets.js's buildVariants (which bakes a small fixed randomCount
// of combinations ahead of time so the in-game menu can offer them as static
// buttons), this draws a brand-new combination on every call — no ceiling on
// distinct outcomes, every axis rolled independently.
function buildRandomMaterial(category, bank, rng) {
  // Always 4 independent picks (no cyclic reuse across bands, unlike the
  // in-game system's occasional 2-3-layer arrays) so every one of the 4
  // physical rock bands (andesite/diorite/stone/dirt-shell) can differ.
  const stoneLayers = [0, 1, 2, 3].map((i) => (i === 1 ? pick(rng, bank.accentStone) : pick(rng, bank.stone)));

  if (category === 'rocky') {
    return {
      category,
      stoneLayers,
      liquid: rng() < 0.5 ? pick(rng, bank.liquid) : null,
      ores: pickN(rng, bank.ore, 4 + Math.floor(rng() * 4)), // 4-7 distinct ores
      oreDensityPerBand: 2 + Math.floor(rng() * 2), // 2-3
    };
  }

  const useCustomStone = rng() < 0.6;
  const useCustomGround = rng() < 0.6;
  return {
    category,
    stoneLayers: useCustomStone ? stoneLayers : null,
    dirt: useCustomGround ? pick(rng, bank.dirt) : null,
    grass: useCustomGround ? pick(rng, bank.grass) : null,
    grassAlt: useCustomGround ? pick(rng, bank.grass) : null,
    woods: pickN(rng, bank.wood, 1 + Math.floor(rng() * 3)), // 1-3 tree species on one planet
    flower: rng() < 0.8 ? pickN(rng, bank.flower, 2 + Math.floor(rng() * 3)) : null,
    herb: rng() < 0.8 ? pickN(rng, bank.herb, 1 + Math.floor(rng() * 3)) : null,
    liquid: rng() < 0.4 ? pick(rng, bank.liquid) : null,
    ores: pickN(rng, bank.ore, 3 + Math.floor(rng() * 4)), // 3-6
    oreDensityPerBand: 1 + Math.floor(rng() * 2), // 1-2
  };
}

module.exports = { buildRandomMaterial, pick, pickN };
