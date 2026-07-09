#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { generatePlanet } = require('./sphere-generator');
const { writeSchematic } = require('./schematic-writer');
const { mulberry32 } = require('./rng');
const { resolveMaterial } = require('./material');

const ROOT = path.join(__dirname, '..');

function isModdedId(blockId) {
  return typeof blockId === 'string' && blockId.split(':')[0] !== 'minecraft';
}

// Recursively strips modded block ids out of a (possibly deeply nested)
// template spec, turning them back into "unspecified" so resolveMaterial
// fills the gap with a random VANILLA pick instead. Unlike the old flat
// schema, no template can become "entirely unusable" anymore — every slot
// that loses its modded id just gets a vanilla replacement.
function stripModded(value) {
  if (typeof value === 'string') return isModdedId(value) ? undefined : value;
  if (Array.isArray(value)) {
    return value.map((v) => stripModded(v)).filter((v) => v !== undefined);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const stripped = stripModded(v);
      if (stripped !== undefined) out[k] = stripped;
    }
    return out;
  }
  return value;
}

function loadBlockBank(useModdedBlocks) {
  const vanilla = JSON.parse(fs.readFileSync(path.join(ROOT, 'blocks', 'vanilla.json'), 'utf8'));
  if (!useModdedBlocks) return vanilla;
  const modded = JSON.parse(fs.readFileSync(path.join(ROOT, 'blocks', 'modded.json'), 'utf8'));
  const merged = JSON.parse(JSON.stringify(vanilla));
  for (const modBank of Object.values(modded)) {
    for (const [category, entries] of Object.entries(modBank)) {
      merged[category] = (merged[category] || []).concat(entries);
    }
  }
  return merged;
}

function loadTemplates() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'planet-templates.json'), 'utf8')).categories;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    }
  }
  return args;
}

function resolveUseModdedBlocks(args) {
  if (args['use-modded-blocks'] === undefined) return true; // preserves prior default behavior
  return String(args['use-modded-blocks']) !== 'false';
}

// Every generated .schem lands in outputs/ by default (gitignored — it's
// generated content, not source) so it's always in one predictable place
// instead of scattered wherever the CLI happened to be run from.
function resolveOutPath(args, defaultName) {
  if (args.out) return args.out;
  const outDir = path.join(ROOT, 'outputs');
  fs.mkdirSync(outDir, { recursive: true });
  return path.join(outDir, defaultName);
}

function generateAndWrite(category, material, args, outPath) {
  const seed = args.seed !== undefined ? parseInt(args.seed, 10) : Date.now() & 0xffffffff;
  const t0 = Date.now();
  const { world } = generatePlanet({ category, material, radius: args.radius ? parseInt(args.radius, 10) : 130, seed });
  const info = writeSchematic(world, outPath);
  console.log(`Wrote ${outPath}: ${info.width}x${info.height}x${info.length}, ${info.paletteSize} block types, ${Date.now() - t0}ms.`);
}

function cmdTemplate(args) {
  const useModdedBlocks = resolveUseModdedBlocks(args);
  const bank = loadBlockBank(useModdedBlocks);
  const templates = loadTemplates();
  const cat = templates[args.category];
  if (!cat) throw new Error(`Unknown category: ${args.category}. Available: ${Object.keys(templates).join(', ')}`);
  const tpl = cat.templates.find((t) => t.name === args.template);
  if (!tpl) throw new Error(`Unknown template "${args.template}" for ${args.category}. Available: ${cat.templates.map((t) => t.name).join(', ')}`);

  const seed = args.seed !== undefined ? parseInt(args.seed, 10) : Date.now() & 0xffffffff;
  const spec = useModdedBlocks ? tpl : stripModded(tpl);
  const material = resolveMaterial(spec, bank, mulberry32(seed ^ 0x51ed270b), args.category);

  const outPath = resolveOutPath(args, `${args.category}-${args.template}.schem`);
  generateAndWrite(args.category, material, { ...args, seed }, outPath);
}

function cmdRandom(args) {
  const useModdedBlocks = resolveUseModdedBlocks(args);
  const bank = loadBlockBank(useModdedBlocks);
  const seed = args.seed !== undefined ? parseInt(args.seed, 10) : Date.now() & 0xffffffff;
  const material = resolveMaterial({}, bank, mulberry32(seed ^ 0x51ed270b), args.category);

  const outPath = resolveOutPath(args, `${args.category}-random-${seed}.schem`);
  generateAndWrite(args.category, material, { ...args, seed }, outPath);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (cmd === 'template') return cmdTemplate(args);
  if (cmd === 'random') return cmdRandom(args);
  console.error('Usage:');
  console.error('  node generate.js template --category <rocky|habitable|ring> --template <name> [--seed N] [--out path] [--use-modded-blocks true|false]');
  console.error('  node generate.js random --category <rocky|habitable|ring> [--seed N] [--out path] [--use-modded-blocks true|false]');
  process.exit(1);
}

if (require.main === module) main();
module.exports = { loadBlockBank, loadTemplates, stripModded };
