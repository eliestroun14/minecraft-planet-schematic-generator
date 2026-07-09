'use strict';

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// Independent draws — the SAME entry can come up more than once on purpose
// ("un même bloc ou minerai peut être choisi 2 fois" — for ores, a duplicate
// means that ore gets its vein-scatter pass run twice, i.e. ~2x as common).
// This is deliberately NOT "pick N distinct items".
function pickWithDuplicates(rng, arr, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(pick(rng, arr));
  return out;
}

function fillArray(arr, n, fillFn) {
  const out = (arr || []).slice(0, n);
  while (out.length < n) out.push(fillFn());
  return out;
}

// Fills in any field a template (or, for `random` generation, an empty {})
// left unspecified by drawing from the shared block bank — "quand un bloc
// n'est pas spécifié, on choisira des blocs au hasard dans la banque". This
// is the single source of truth for the material shape every planet
// category shares (deep/semiDeep/central/outer + liquid), plus the
// category-specific extras (habitable's vegetation, ring's ring).
function resolveMaterial(spec, bank, rng, category) {
  const s = JSON.parse(JSON.stringify(spec || {}));
  s.category = category;

  s.deep = s.deep || {};
  s.deep.rock = s.deep.rock || pick(rng, bank.stone);
  s.deep.ore = s.deep.ore || pick(rng, bank.ore);

  s.semiDeep = s.semiDeep || {};
  s.semiDeep.mainRock = s.semiDeep.mainRock || pick(rng, bank.stone);
  s.semiDeep.noiseRock = s.semiDeep.noiseRock || pick(rng, bank.accentStone);
  s.semiDeep.ores = fillArray(s.semiDeep.ores, 2, () => pick(rng, bank.ore));

  s.central = s.central || {};
  s.central.mainRock = s.central.mainRock || pick(rng, bank.stone);
  s.central.noiseRocks = fillArray(s.central.noiseRocks, 2, () => pick(rng, bank.accentStone));
  s.central.ores = fillArray(s.central.ores, 3, () => pick(rng, bank.ore));

  s.outer = s.outer || {};
  s.outer.mainRock = s.outer.mainRock || pick(rng, bank.stone);
  s.outer.noiseRocks = fillArray(s.outer.noiseRocks, 2, () => pick(rng, bank.accentStone));

  if (!s.liquid) s.liquid = pick(rng, bank.liquid);

  if (category === 'habitable') {
    // undefined (key absent) = "please fill from the bank"; explicit null =
    // "deliberately none" (e.g. a nether-themed template with no flowers)
    // and must survive untouched.
    if (s.dirt === undefined) s.dirt = pick(rng, bank.dirt);
    if (s.grass === undefined) s.grass = pick(rng, bank.grass);
    if (s.grassAlt === undefined) s.grassAlt = pick(rng, bank.grass);
    if (s.wood === undefined && s.woods === undefined) s.woods = pickWithDuplicates(rng, bank.wood, 1 + Math.floor(rng() * 3));
    if (s.flower === undefined) s.flower = pickWithDuplicates(rng, bank.flower, 2 + Math.floor(rng() * 3));
    if (s.herb === undefined) s.herb = pickWithDuplicates(rng, bank.herb, 1 + Math.floor(rng() * 3));
  }

  if (category === 'ring') {
    s.ringBlocks = fillArray(s.ringBlocks, 2, () => pick(rng, bank.stone.concat(bank.accentStone)));
    s.ringOre = s.ringOre || pick(rng, bank.ore);
    // ringTilt intentionally left unset if the caller didn't provide one —
    // sphere-generator.js treats a missing tilt as "randomize every run".
  }

  return s;
}

module.exports = { resolveMaterial, pick, pickWithDuplicates, fillArray };
