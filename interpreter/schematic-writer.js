'use strict';

const fs = require('fs');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');

const DATA_VERSION_1_20_1 = 3465;

function encodeVarInt(value) {
  const bytes = [];
  let v = value;
  for (;;) {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) {
      bytes.push(b | 0x80);
    } else {
      bytes.push(b);
      break;
    }
  }
  return bytes;
}

// Locate the diamond_block / emerald_block corner markers placeBoundsMarkers
// left in the world. Finding the actual markers doubles as a sanity check
// that generation produced a coherent, bounded result.
function computeExportBounds(world) {
  let min = null;
  let max = null;
  for (const [key, blockId] of world.blocks) {
    if (blockId === 'minecraft:diamond_block') min = key.split(',').map(Number);
    if (blockId === 'minecraft:emerald_block') max = key.split(',').map(Number);
  }
  if (!min || !max) {
    throw new Error('WorldEdit corner markers (diamond_block/emerald_block) not found in the virtual world — generation likely incomplete.');
  }
  return {
    minX: Math.min(min[0], max[0]), maxX: Math.max(min[0], max[0]),
    minY: Math.min(min[1], max[1]), maxY: Math.max(min[1], max[1]),
    minZ: Math.min(min[2], max[2]), maxZ: Math.max(min[2], max[2]),
  };
}

// Sponge Schematic v2 BlockEntities entries: { Id: string, Pos: int[3], ...extra
// tile-entity NBT merged at the top level } (confirmed against the Sponge
// schematic spec's own worked example, which merges extra keys directly
// rather than nesting them under a sub-tag).
function buildBlockEntityNbt(data, relPos) {
  const value = {
    Id: { type: 'string', value: data.Id },
    Pos: { type: 'intArray', value: relPos },
  };
  if (data.SpawnData) {
    value.SpawnData = {
      type: 'compound',
      value: {
        entity: { type: 'compound', value: { id: { type: 'string', value: data.SpawnData.entity.id } } },
      },
    };
  }
  // Bare compound content, not a {type,value}-wrapped tag: list elements take
  // their type from the list's own declared element type (list.value.type),
  // so wrapping each entry again desyncs prismarine-nbt's writer/reader.
  return value;
}

function writeSchematic(world, outPath) {
  const b = computeExportBounds(world);
  const width = b.maxX - b.minX + 1;
  const height = b.maxY - b.minY + 1;
  const length = b.maxZ - b.minZ + 1;

  const palette = new Map();
  palette.set('minecraft:air', 0);
  const blockDataBytes = [];

  for (let y = 0; y < height; y++) {
    for (let z = 0; z < length; z++) {
      for (let x = 0; x < width; x++) {
        let blockId = world.get(b.minX + x, b.minY + y, b.minZ + z);
        if (blockId === 'minecraft:diamond_block' || blockId === 'minecraft:emerald_block') blockId = 'minecraft:air';
        if (!palette.has(blockId)) palette.set(blockId, palette.size);
        blockDataBytes.push(...encodeVarInt(palette.get(blockId)));
      }
    }
  }

  const paletteCompound = {};
  for (const [blockId, idx] of palette) paletteCompound[blockId] = { type: 'int', value: idx };

  const signedBytes = blockDataBytes.map((v) => (v > 127 ? v - 256 : v));

  const blockEntitiesList = [];
  for (const [key, data] of world.blockEntities) {
    const [x, y, z] = key.split(',').map(Number);
    if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY || z < b.minZ || z > b.maxZ) continue;
    blockEntitiesList.push(buildBlockEntityNbt(data, [x - b.minX, y - b.minY, z - b.minZ]));
  }

  const schematicNbt = {
    type: 'compound',
    // WorldEdit's Sponge v2 format detection (BuiltInClipboardFormat) checks
    // that the ROOT NBT tag itself is named "Schematic" — an empty root name
    // parses fine with any generic NBT reader (which is why our own decode
    // round-trips passed) but WorldEdit's findByFile() silently rejects it.
    name: 'Schematic',
    value: {
      Version: { type: 'int', value: 2 },
      DataVersion: { type: 'int', value: DATA_VERSION_1_20_1 },
      Width: { type: 'short', value: width },
      Height: { type: 'short', value: height },
      Length: { type: 'short', value: length },
      Palette: { type: 'compound', value: paletteCompound },
      PaletteMax: { type: 'int', value: palette.size },
      BlockData: { type: 'byteArray', value: signedBytes },
      BlockEntities: { type: 'list', value: { type: 'compound', value: blockEntitiesList } },
      Metadata: { type: 'compound', value: {} },
    },
  };

  const buf = nbt.writeUncompressed(schematicNbt, 'big');
  fs.writeFileSync(outPath, zlib.gzipSync(buf));

  return { width, height, length, paletteSize: palette.size, blockCount: width * height * length, blockEntityCount: blockEntitiesList.length };
}

module.exports = { writeSchematic, computeExportBounds };
