# Minecraft Planet Schematic Generator

A config-driven generator that turns JSON block/template definitions into
Minecraft **Sponge Schematic (`.schem`)** files — large procedural "planet"
spheres in three flavors (`rocky` barren, `habitable` vegetated, `ring` a
shrunk core orbited by a ring), ready to paste with WorldEdit or convert into
a native structure for a jigsaw-based world generator (see
[minecraft-planet-world-generator](https://github.com/eliestroun14/minecraft-planet-world-generator),
the datapack this tool feeds).

Generation happens entirely offline in Node.js — no Minecraft instance
required. A planet (~260×260×260 blocks, tens of millions of voxels)
generates in 10-20 seconds.

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
                        voxel loop assigning the seven concentric zones (see
                        "Strata" below), ore veins, noise-carved caves, a
                        river + underground pockets, (habitable) surface
                        decoration + passive-mob spawners, and (ring) an
                        orbiting ring in an arbitrary/random plane
  material.js           resolveMaterial() — fills in whatever a template (or,
                        for `random`, an empty spec) left unspecified by
                        drawing from the block bank; single source of truth
                        for the material shape every category shares
  world.js             sparse voxel grid (Map<"x,y,z", blockId>)
  noise.js              tiny deterministic 3D value-noise field for caves
                        and multi-rock zone mixing
  rng.js                 seeded PRNG (mulberry32)
  schematic-writer.js    writes the voxel grid out as a Sponge Schematic v2
                          .schem file
  generate.js            CLI entry point
```

All of this is original — no code or content from any existing Minecraft
mod or datapack. Earlier iterations of this project used a headless
interpreter for an in-game `.mcfunction` datapack to do the same thing; that
approach was dropped since it wasn't original work and was far slower than
generating spheres directly (a `.mcfunction`-based planet took ~5-6 minutes
to generate; this takes 10-20 seconds even with the much richer strata
system now in place).

## Usage

```
npm install

# A specific hand-authored template -> outputs/rocky-vanilla.schem
node interpreter/generate.js template --category rocky --template vanilla --seed 42

# Fully randomized material rolls -> outputs/habitable-random-<seed>.schem
node interpreter/generate.js random --category habitable --seed 42

# Vanilla-only output (no mod dependency) — see "Modded blocks" below
node interpreter/generate.js template --category rocky --template vanilla --seed 42 --use-modded-blocks false
```

Every run writes into `outputs/` (created automatically, gitignored) unless
you pass an explicit `--out path`.

Available categories/templates: `rocky` (vanilla, dimension, modded,
volcanic), `habitable` (stem, cherry, swamp, overworld), `ring` (asteroid,
ice). List them with:

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
- For `template`, any modded block id anywhere in the (nested) template spec
  is stripped out first, turning it back into "unspecified" — `resolveMaterial`
  then fills that gap with a random *vanilla* pick same as any other missing
  field. A template that's entirely built around one mod's blocks (like
  `rocky.modded`) gracefully degrades into an all-vanilla planet instead of
  erroring; nothing can become "impossible" to generate anymore.

Currently `blocks/modded.json` covers **Mekanism** and **Immersive
Engineering** ores (the two mods the original planet set was built around).
Adding another mod's blocks is just adding a new top-level key.

## Strata (core to surface)

Every planet — `rocky`, `habitable`, or `ring`'s core — is built from the
same seven concentric zones, as fractions of the total radius:

| Zone | Fraction | Contents |
|---|---|---|
| `bedrock` | 3% | A handful of bedrock blocks, the true center |
| `lava` | 5% | Liquid lava with magma_block patches — a molten shell around the bedrock |
| `obsidian` | 4% | Solid obsidian, where the lava meets the rock above it |
| `deep` | 18% | 1 rock + 1 ore. Few veins, but large and compact |
| `semiDeep` | 18% | 2 rocks (1 main + 1 noise-scattered) + 2 ores. Large veins, loosely spread ("diffuse") |
| `central` | 18% | 3 rocks (1 main + 2 noise-scattered) + the 3 ores from `deep`+`semiDeep` (smaller, tighter veins) + 3 new ores (same distribution) |
| `outer` | 34%, the thickest | 3 rocks (1 main + 2 noise-scattered) + only `central`'s 3 new ores, generously |

On `habitable` planets, `outer`'s outermost few blocks are overridden by
`dirt`/`grass`/`grassAlt` instead (and it's where trees/flowers/herbs and
passive-mob spawners go). On `rocky`/`ring` planets, `outer` IS the walkable
surface, and gets raised ore outcrops ("aspérités") — deliberately built
from `deep`+`semiDeep`'s 3 ores, not `central`/`outer`'s own, so a player
can't tell what's actually most abundant just by looking at the surface;
finding that out means digging.

River + underground liquid pockets both use the resolved `liquid` and are
confined to the `outer` zone.

Every layer's rock/ore fields can be partially specified — `interpreter/
material.js`'s `resolveMaterial()` fills any gap with a random pick from the
block bank (see `rocky.modded` in `planet-templates.json`, which ships with
only 2 of `central`'s 3 ores and no `liquid` on purpose, to demonstrate
this). `random` generation is exactly this same fill logic starting from an
empty spec, so every field goes through the bank — including the
possibility of picking the *same* block or ore twice for one zone, which for
an ore means it's that much more common there.

## Ring planets

`ring` is a third planet category: a rocky-style core body shrunk to 75% of
the nominal radius (same bands/ore/caves/river as `rocky`, just smaller),
orbited by a separate ring made of 2 alternating block types plus 1 ore
mixed through it. The ring's plane can be:

- flat/equatorial (`ringTilt: {"x":0,"y":1,"z":0}`) — a classic Saturn-style
  ring, parallel to the "ground"
- standing on edge (`ringTilt: {"x":1,"y":0,"z":0}` or `{"x":0,"y":0,"z":1}`)
  — perpendicular to the ground, like a halo through the poles
- anything in between (any other unit vector) — a tilted/oblique ring
- omitted/`null` — a fresh random tilt every generation (this is what
  `random` generation always does)

The ring itself isn't a solid disc — it's noise-carved porous (rock/ice
fragments, not a slab) so it doesn't read as a flat wall.

## Contributing new blocks or templates

- **New block for an existing category**: add its id to
  `blocks/vanilla.json` (or the right mod's section in `blocks/modded.json`)
  — it's immediately available to `random` generation.
- **New planet preset**: add an entry to the right category's `templates`
  array in `planet-templates.json`. See existing entries for the shape —
  `deep`/`semiDeep`/`central`/`outer` (see "Strata" above) and `liquid`,
  for `habitable` also `dirt`/`grass`/`grassAlt`, `wood` (`{log, leaves}`),
  `flower`, `herb`, and for `ring` also `ringBlocks` (exactly 2 ids),
  `ringOre`, `ringTilt`. Any field can be left out entirely — it'll be
  filled from the bank. For `habitable`'s `flower`/`herb`/`wood`, an
  *explicit* `null` means "deliberately none" (e.g. no flowers on a nether
  biome) and is preserved as-is, unlike an absent key.

## License

MIT — see [LICENSE](LICENSE).
