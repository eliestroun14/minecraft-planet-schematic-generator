#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { generatePlanet } = require('./sphere-generator');
const { writeSchematic } = require('./schematic-writer');
const { mulberry32 } = require('./rng');
const { buildRandomMaterial } = require('./random-material');

const ROOT = path.join(__dirname, '..');

function isModdedId(blockId) {
  return typeof blockId === 'string' && blockId.split(':')[0] !== 'minecraft';
}

// Deep-filters modded block ids out of a template's own explicit fields
// (used even when the shared bank isn't touched, since some hardcoded
// templates embed modded ids directly). Returns null if filtering would
// leave a template with nothing usable (e.g. a template that's entirely
// about showcasing one mod's ores).
function stripModdedFromTemplate(tpl) {
  const out = { ...tpl };
  if (Array.isArray(out.ores)) {
    const filtered = out.ores.filter((o) => !isModdedId(o));
    if (tpl.ores.length && filtered.length === 0) return null;
    out.ores = filtered;
  }
  if (Array.isArray(out.stoneLayers) && out.stoneLayers.some(isModdedId)) return null;
  return out;
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

function cmdTemplate(args) {
  const useModdedBlocks = resolveUseModdedBlocks(args);
  const templates = loadTemplates();
  const cat = templates[args.category];
  if (!cat) throw new Error(`Unknown category: ${args.category}. Available: ${Object.keys(templates).join(', ')}`);
  const tpl = cat.templates.find((t) => t.name === args.template);
  if (!tpl) throw new Error(`Unknown template "${args.template}" for ${args.category}. Available: ${cat.templates.map((t) => t.name).join(', ')}`);

  const material = useModdedBlocks ? tpl : stripModdedFromTemplate(tpl);
  if (!material) throw new Error(`Template "${args.template}" is entirely modded-block-based; skipped because --use-modded-blocks false.`);

  const seed = args.seed !== undefined ? parseInt(args.seed, 10) : Date.now() & 0xffffffff;
  const outPath = args.out || `${args.category}-${args.template}.schem`;
  const t0 = Date.now();
  const { world } = generatePlanet({ category: args.category, material: { ...material, category: args.category }, radius: args.radius ? parseInt(args.radius, 10) : 90, seed });
  const info = writeSchematic(world, outPath);
  console.log(`Wrote ${outPath}: ${info.width}x${info.height}x${info.length}, ${info.paletteSize} block types, ${Date.now() - t0}ms.`);
}

function cmdRandom(args) {
  const useModdedBlocks = resolveUseModdedBlocks(args);
  const bank = loadBlockBank(useModdedBlocks);
  const seed = args.seed !== undefined ? parseInt(args.seed, 10) : Date.now() & 0xffffffff;
  const material = buildRandomMaterial(args.category, bank, mulberry32(seed));
  const outPath = args.out || `${args.category}-random.schem`;
  const t0 = Date.now();
  const { world } = generatePlanet({ category: args.category, material, radius: args.radius ? parseInt(args.radius, 10) : 90, seed: seed ^ 0x9e3779b9 });
  const info = writeSchematic(world, outPath);
  console.log(`Wrote ${outPath}: ${info.width}x${info.height}x${info.length}, ${info.paletteSize} block types, ${Date.now() - t0}ms.`);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (cmd === 'template') return cmdTemplate(args);
  if (cmd === 'random') return cmdRandom(args);
  console.error('Usage:');
  console.error('  node generate.js template --category <rocky|habitable> --template <name> [--seed N] [--out path] [--use-modded-blocks true|false]');
  console.error('  node generate.js random --category <rocky|habitable> [--seed N] [--out path] [--use-modded-blocks true|false]');
  process.exit(1);
}

if (require.main === module) main();
module.exports = { loadBlockBank, loadTemplates, stripModdedFromTemplate };
