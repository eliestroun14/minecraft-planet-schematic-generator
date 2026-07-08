const fs = require('fs');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');

function decodeVarInts(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    let result = 0, shift = 0, b;
    do { b = bytes[i++]; result |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    out.push(result);
  }
  return out;
}

const file = process.argv[2];
const buf = zlib.gunzipSync(fs.readFileSync(file));
const parsed = nbt.parseUncompressed(buf, 'big', { noArraySizeCheck: true });
const v = parsed.value;
const w = v.Width.value, h = v.Height.value, l = v.Length.value;

const idToBlock = {};
for (const [id, entry] of Object.entries(v.Palette.value)) idToBlock[entry.value] = id;
const rawBytes = v.BlockData.value.map((b) => (b < 0 ? b + 256 : b));
const indices = decodeVarInts(rawBytes);

const counts = {};
let i = 0;
const cx = w / 2, cy = h / 2, cz = l / 2;
let maxR = 0, minSurfaceR = Infinity, maxSurfaceR = 0;
const surfaceRs = [];
for (let y = 0; y < h; y++) {
  for (let z = 0; z < l; z++) {
    for (let x = 0; x < w; x++) {
      const id = idToBlock[indices[i++]];
      counts[id] = (counts[id] || 0) + 1;
    }
  }
}

console.log('Block counts:');
for (const [id, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(' ', id, n);
}

const oreTotal = Object.entries(counts).filter(([id]) => id.includes('_ore')).reduce((s, [, n]) => s + n, 0);
console.log('Total ore blocks:', oreTotal);
