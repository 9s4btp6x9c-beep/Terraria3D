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

## Next phases

1. **More progression:** a second ore tier past iron, armor sets with set
   bonuses, and accessories (double jump, dash, fall protection).
2. **Events:** night invasions and a blood-moon style event that raises
   spawn rates and brings special enemies.
3. **Second boss** tied to the sky islands, and a flying mount or wings.
4. **More NPCs** unlocked by progress (a smith who reforges, a guide).
5. **Water and liquids** that flow into dug-out cavities.

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
