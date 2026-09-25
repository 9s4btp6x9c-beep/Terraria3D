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

## Next phases

1. **Crafting** (Phase 5): data-driven recipes; workbench, furnace and anvil
   as placeable furniture; copper and iron tool tiers (iron pickaxe unlocks
   iron, deepstone and lumite).
2. **Placeables and housing** (Phase 4 completion): doors, torches (point
   light pool, already supported by the shader), furniture, and room
   validation by flood-fill inside pieces.
3. **Combat** (Phase 6): health, damage, the first weapons (a melee swing and
   a thrown or ranged weapon), 3–4 forest and cave enemies with simple
   steering AI on the SDF, drops, death and respawn.
4. **Progression** (Phase 7): accessories (double jump, dash, fall
   protection), grappling hook (a ray against the SDF, then rope
   constraint), and more biomes (desert, snow, jungle, corruption) driven by
   biome noise in the generator.
5. **First boss** (Phase 8), for example a burrowing boss that moves through
   the SDF and carves real tunnels.
6. **Scale and polish** (Phase 9): day/night cycle, distance LOD (coarser
   Surface Nets for far chunks), meshing in workers, audio, more particles
   and post effects.

## Performance notes

- About 1M terrain triangles for the whole 256 m world. Frustum culling per
  chunk; trees, grass and particles are instanced (a few draw calls each).
- Meshing a dense chunk takes about 4 ms, and edits re-mesh only the
  affected chunks.
- Later: far-chunk LOD, worker meshing, streaming for larger worlds.
