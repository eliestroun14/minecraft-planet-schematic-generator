'use strict';

// Small deterministic 3D value-noise field, seeded independently of the main
// RNG stream so cave carving doesn't perturb ore/decoration randomness.
// Textbook hash-and-smoothstep-interpolate value noise — no external deps.

function hash3(x, y, z, seed) {
  let h = seed | 0;
  h = Math.imul(h ^ x, 374761393);
  h = Math.imul(h ^ y, 668265263);
  h = Math.imul(h ^ z, 2147483647);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function valueNoise3D(x, y, z, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const xf = x - x0, yf = y - y0, zf = z - z0;
  const u = smooth(xf), v = smooth(yf), w = smooth(zf);

  const c000 = hash3(x0, y0, z0, seed);
  const c100 = hash3(x0 + 1, y0, z0, seed);
  const c010 = hash3(x0, y0 + 1, z0, seed);
  const c110 = hash3(x0 + 1, y0 + 1, z0, seed);
  const c001 = hash3(x0, y0, z0 + 1, seed);
  const c101 = hash3(x0 + 1, y0, z0 + 1, seed);
  const c011 = hash3(x0, y0 + 1, z0 + 1, seed);
  const c111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);

  const x00 = lerp(c000, c100, u), x10 = lerp(c010, c110, u);
  const x01 = lerp(c001, c101, u), x11 = lerp(c011, c111, u);
  const y0v = lerp(x00, x10, v), y1v = lerp(x01, x11, v);
  return lerp(y0v, y1v, w);
}

module.exports = { valueNoise3D };
