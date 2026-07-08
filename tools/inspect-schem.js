const fs = require('fs');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');

const file = process.argv[2];
const buf = zlib.gunzipSync(fs.readFileSync(file));
const parsed = nbt.parseUncompressed(buf, 'big', { noArraySizeCheck: true });
const v = parsed.value;

console.log('root name:', JSON.stringify(parsed.name));
console.log('Version:', v.Version.value, 'DataVersion:', v.DataVersion.value);
console.log('dims:', v.Width.value, v.Height.value, v.Length.value);
console.log('palette:', Object.keys(v.Palette.value));
console.log('block entities:', v.BlockEntities.value.value.length);
