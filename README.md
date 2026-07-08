# Minecraft Planet Schematic Generator

A config-driven generator that turns JSON block/template definitions into
Minecraft **Sponge Schematic (`.schem`)** files — large procedural "planet"
spheres (rocky/barren or habitable/vegetated), ready to paste with WorldEdit
or convert into a native structure for a jigsaw-based world generator (see
[minecraft-planet-generator](https://github.com/eliestroun14/minecraft-planet-generator),
the datapack this tool feeds).

Generation happens entirely offline in Node.js — no Minecraft instance
required. A planet (~181×181×181 blocks, several million voxels) generates
in a few seconds.

## Why

The goal is to make new planet variants easy to contribute **without writing
any code** — everything that defines what a planet looks like lives in the
`blocks/` and `planet-templates.json` JSON files. Want a new rock type, a new
tree species, or a whole new planet preset? Edit JSON, run the CLI, done.

## Architecture

```
blocks/
  vanilla.json      block bank (stone/ore/wood/grass/dirt/flower/herb/liquid),
                     vanilla Minecraft blocks only
  modded.json        the same categories, additional blocks keyed by mod id
                     (e.g. "mekanism": { "ore": [...] })
planet-templates.json  hand-authored planet presets (rocky.vanilla,
                        habitable.cherry, etc.), each referencing explicit
                        blocks (not necessarily from the shared bank)
interpreter/
  sphere-generator.js  the core algorithm — a plain distance-from-center
                        voxel loop assigning concentric shell bands, ore
                        veins, noise-carved caves, and (for habitable
                        planets) surface decoration + passive-mob spawners
  world.js             sparse voxel grid (Map<"x,y,z", blockId>)
  noise.js              tiny deterministic 3D value-noise field for caves
  random-material.js    fully-random material rolls (used by `random`)
  rng.js                 seeded PRNG (mulberry32)
  schematic-writer.js    writes the voxel grid out as a Sponge Schematic v2
                          .schem file
  generate.js            CLI entry point
```

All of this is original — no code or content from any existing Minecraft
mod or datapack. Earlier iterations of this project used a headless
interpreter for an in-game `.mcfunction` datapack to do the same thing; that
approach was dropped since it wasn't original work and was ~70x slower than
generating spheres directly (a `.mcfunction`-based planet took ~5-6 minutes
to generate; this takes ~5 seconds).

## Usage

```
npm install

# A specific hand-authored template
node interpreter/generate.js template --category rocky --template vanilla --seed 42 --out rocky-vanilla.schem

# Fully randomized material rolls (every axis — rock, ore, wood, flowers — picked independently)
node interpreter/generate.js random --category habitable --seed 42 --out random-planet.schem

# Vanilla-only output (no mod dependency) — see "Modded blocks" below
node interpreter/generate.js template --category rocky --template vanilla --seed 42 --out rocky-vanilla.schem --use-modded-blocks false
```

Available categories/templates: `rocky` (vanilla, dimension, modded,
volcanic), `habitable` (stem, cherry, swamp, overworld). List them with:

```
node -e "console.log(require('./planet-templates.json').categories)"
```

Inspect a generated `.schem`'s palette/dimensions:

```
node tools/inspect-schem.js path/to/file.schem
```

## Modded blocks

`--use-modded-blocks false` (default: `true`) restricts generation to
`blocks/vanilla.json` only:

- For the `random` command, the shared block bank simply excludes every
  modded category listed in `blocks/modded.json`.
- For `template`, any modded block id embedded directly in that template's
  own `ores`/`stoneLayers` is filtered out too. A template that's *entirely*
  built around one mod's blocks (like `rocky.modded`) fails with a clear
  error instead of silently generating something unintended — a mixed
  template (like `habitable.stem`, mostly vanilla with one modded ore) just
  drops the modded entries and keeps going.

Currently `blocks/modded.json` covers **Mekanism** and **Immersive
Engineering** ores (the two mods the original planet set was built around).
Adding another mod's blocks is just adding a new top-level key.

## Contributing new blocks or templates

- **New block for an existing category**: add its id to
  `blocks/vanilla.json` (or the right mod's section in `blocks/modded.json`)
  — it's immediately available to `random` generation.
- **New planet preset**: add an entry to the right category's `templates`
  array in `planet-templates.json`. See existing entries for the shape —
  `stoneLayers` (4 bands, innermost to outermost), `ores` +
  `oreDensityPerBand`, and for `habitable` also `dirt`/`grass`/`grassAlt`,
  `wood` (`{log, leaves}`), `flower`, `herb`, `liquid`.

## License

MIT — see [LICENSE](LICENSE).
