# Architecture & roadmap

## Findings at project start

- The repository was empty: no engine and no existing systems.
- The environment has Node 22 and headless Chromium (no Godot or Unity), so
  the stack is **TypeScript + Three.js (WebGL2) + Vite**. It can be
  unit-tested in Node and tested end-to-end with real rendering in headless
  Chromium.
- Rendering: Three.js gives shadows, fog, instancing, render targets and
  custom shaders through `onBeforeCompile`.
- Physics: no engine physics is used. Collision queries go straight to the
  terrain's distance field, which is simpler and exact for deformable
  terrain.

## Terrain architecture decision

**Option B, SDF / volumetric field with smooth meshing**, chosen over an
editable heightfield because caves, overhangs, tunnels and sky islands need
real 3D, and over CSG-on-meshes because that is much harder to make robust.

| Concern | Solution |
|---|---|
| Representation | Density + material per 1 m sample, 32³ chunks, uniform chunks stored as a single value |
| Surface | Surface Nets (one vertex per surface cell) with smooth gradient normals. Organic, low-poly, never cubes |
| Editing | CSG sphere add/subtract that respects tool tier. Dirty chunks re-mesh in a few ms |
| Collision | Sphere-stack player vs gradient-normalised distance. Pieces and trunks are analytic SDFs |
| Lighting underground | SkyMap: blurred per-column ground height, compared in the shader, so caves go dark with no baking |
| Persistence | Seed + ordered edit log (values rounded before apply so replay is exact) |
| Generation | Deterministic from seed, run in parallel Web Workers (about 3–5 s for a 256×160×256 m world) |

The visual style follows the reference images: bright stylized daylight,
world-space triplanar **pixel-art texture array** (cobblestone, blotchy grass,
speckled dirt, planks...), **dithered pixel transitions** between materials,
**depth-based silhouette outlines**, tall trees with faceted canopies,
low-poly clouds and floating islands.

## Status: foundation proven (the section 41 checks)

The automated e2e test (`npm run e2e`) verifies each of these in a real
browser:

1. Walk across organic terrain ✔
2. Enter an actual 3D cave (a generated entrance tunnel and a chamber) ✔
3. Mine into terrain ✔
4. Remove terrain, which turns into resources ✔
5. Create a tunnel ✔
6. Place a structure ✔
7. Save the modified world ✔
8. Reload it with edits and structures intact ✔

The prototype also includes: spaghetti tunnels and caverns, ore veins
(copper, iron), glowing lumite crystals, sky islands, forests with instanced
trees and grass, felling trees for wood, a hotbar and inventory, terrain fill,
a minimap, particles, and a held-item viewmodel.

## Milestones delivered

| Milestone | Contents | Verified by |
|---|---|---|
| M1 Foundation | SDF terrain, Surface Nets, mining, building pieces, save/load | e2e checks 1–8 |
| M2 Scale | Chunk streaming in workers, quadtree LOD for distant terrain (stride 2/4/8), 512 m world, day/night, fog | far-view LOD check |
| M3 Core loop | Items, recipes, stations, furniture, pickups, creatures, melee/ranged combat, sound | crafting, furniture and combat checks |
| M4 Progression | Desert/snow/Blight biomes, Ember Depths, cabins with loot, housing + NPCs with shop, grappling hook, the Deepwyrm boss | biome, housing, NPC, grapple and boss checks |
| M5 Mobile | Touch controls, quality presets, free-look fallback without pointer lock, compact phone UI | `scripts/e2e-mobile.mjs` |
| M6 Events | Blood Moon (red sky, event creatures, shard gear), Hollow Raid (raiders march on the town, progress bar, Tinkerer NPC), visible sun and moon | `tests/events.test.ts`, event e2e checks |
| M7 Sky tier | Aerite ore in the sky islands, Skyforged armor, Gale Bow, Gale Swifts and Cloud Globs, the Tempest Roc boss, Roc Wings flight and gliding, Tempest Staff | sky tier e2e checks |
| M8 Growth | Life Crystals in caves (+max life), fallen stars at night, Mana Crystals and mana potions, max stats saved | growth e2e checks |
| M9 Mushroom caverns | Underground zone with wide halls, luminous mushroom grass over mud, giant glowing mushrooms with real point lights, teal cave tint, Sporelings and Glowmoths, glowcaps, Glowcap Lamp, glowcap mana potions; far-away furniture and buried mushrooms culled | cavern e2e checks |
| M10 Water | Liquid grid (fall, spread, level out, flood from the sea below sea level), lakes and cave pools, swimming, breath and drowning, underwater view, buckets, creatures float; the sea plane is limited to the real ocean | `tests/water.test.ts`, water e2e checks |
| M11 Interface | Title screen over the live world (orbiting camera), loading screen with tips, new world, settings, controls, pause and death screens; bundled pixel fonts, a pixel icon set replacing all emoji, one panel style across HUD, inventory and dialogue | `scripts/ui-shots.mjs`, e2e suites |
| M12 Hollowdeep identity | Retheme away from genre conventions: Vigor/Glim gauges, Amber currency, Heartroots, drifting Starseeds and Glim Vessels, Hearth-based homes and draughts, Burrlings, Rootwalkers, Drifters, the Sporefall and the Hollow March; three new biomes (the Rootwold's petrified root arches, the Ossuary Flats' titan skeletons, the Amberwood's resin) built from a generic terrain-feature system, the Riftlands recolour, biome titles; world grown to 768 m with legacy saves kept at 512 m | `tests/biomes.test.ts`, `scripts/biome-shots.mjs`, `scripts/creature-shots.mjs`, e2e suites |
| M13 Building | Builder's Hammer and build menu (desktop and touch), 14 multi-part pieces (foundation, floor, wall, doorway, glazed window, half wall, fence, post, beam, stairs, steep and low roofs, gables) in five materials; snapping to built pieces (stacked walls, level floors, upper storeys, roofs on wall tops and continuing slopes), foundations with automatic footings, support check, rotation and free placement, deconstruct with full refund, doors snapping into doorways, a level-ground terrain edit, Hearth comfort and the Rested buff | `tests/building2.test.ts`, `scripts/e2e-build.mjs` (a house built by aiming and clicking), mobile check |
| M14 Fire and wanderers | Plain names (Health and Mana, Red and Blue Elixirs, Red and Blue Essence, Blobs and Gel); settlers and housing removed in favour of a wandering merchant who arrives at dawn every few days, camps near your spawn point with a pack cart, sells a seeded stock that grows with progress and leaves at dusk; the Hollow faction replaced by the Cinderbound (basalt-plated fire cultists: Ashdelvers, Firebrands, Cinderbound Raiders, Basalt Colossi) and the Cinder Siege on your Hearth; lava as a second, slower, damaging liquid that hardens into obsidian where it meets water; the Cinder Peaks volcano biome (ash cones, crater lava lakes, lava tubes into a magma chamber, basalt, charred trees, Ash Blobs and Cinder Scouts), basalt brick building material | `tests/merchant.test.ts`, `tests/biomes.test.ts`, merchant, siege and lava e2e checks |
| M15 Feel and polish | Player collision that stands firm on steep-density floors (no bouncing), ducks under low ceilings, climbs out of rock instead of sinking, and a camera guard against seeing through walls; the held item drawn in its own depth pass (never see-through or clipped), swung from the shoulder; calmer textures with smooth material blends and flatter creature skins; sky light that no longer blackens the ground around cliffs and holes; lake surfaces that meet the shore along the terrain; creatures that swim; fewer, steadier night spawns and a Hearth safe zone; tiered spruces, buttercups, solid tree shake and unbroken fossil ribs; doors that swing away from you and see-through windows; torches with fire particles and a light pool that fades instead of strobing | `tests/physics.test.ts`, `scripts/probe-jitter.mjs`, `scripts/probe-tunnel.mjs`, `scripts/probe-xray.mjs`, `scripts/viewmodel-shots.mjs`, `scripts/review-shots.mjs`, e2e suites |
| M16 Delving | Cave systems v2 for new worlds (wider winding tunnels, caverns from 12 m down, deep flat-floored halls, ~60 cave mouths and sinkholes from the surface; older saves keep their caves), the Dune Worm (a segmented burrower of the desert that bursts out of the sand, hittable along its whole body), green-glowing mushroom caverns, block-style pixel torches (held and placed) that shed fire, lava that spits embers, and the build menu no longer pausing the game on [Q] | `tests/caves.test.ts`, cave-mouth and Dune Worm e2e checks, `scripts/worm-shots.mjs`, `scripts/review-shots.mjs` |

## Next phases

1. **Fishing and water creatures**, brine pools on the Ossuary Flats,
   lava-proof fishing in crater lakes.
2. **Hardmode-style world shift** after a final boss: new ores seeded into
   the existing world, harder variants of every biome.
3. **More travellers** who visit like the merchant (a smith who reforges
   gear, a cartographer who marks volcanoes and cabins on the map).
4. **Mounts and pets** from rare drops.
5. **More underground variety:** crystal geodes and buried temples.

## Performance notes

- Terrain streams in 32³ chunks built in Web Workers (inline fallback when
  workers are blocked). Distant areas use coarser quadtree regions (64/128/256 m
  at stride 2/4/8) that overlap by one cell so no seams show. Buried caves
  are culled from the far LOD.
- A typical far view is about 800k terrain triangles in 160–260 draw calls.
  Trees, grass, pickups and particles are instanced.
- Quality presets (low/medium/high) scale pixel ratio, shadow map size,
  MSAA, LOD detail, grass radius and tree distance. Touch devices default to
  low.
- Edits re-mesh only the affected chunks. The edit log is indexed per chunk
  so streamed-in chunks replay exactly their own edits.
