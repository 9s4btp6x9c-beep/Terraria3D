# Terraria 3D (working title)

An original sandbox in the spirit of Terraria, built as a fully 3D game with
organic, destructible, **non-voxel** terrain and a stylized low-poly /
pixel-texture look.

Engine: **TypeScript + Three.js + Vite** (runs in the browser).

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (world generation, meshing, editing)
npm run build        # typecheck + production build
npm run e2e          # headless-browser test of the core loop (needs a build)
```

URL options: `?seed=1234` (world seed), `?new` (ignore the save), `?continue=1` (load the save).

## Controls

| Input | Action |
|---|---|
| WASD / Mouse | Move / look |
| Shift · Space · C or Ctrl | Sprint · jump / swim up · crouch |
| LMB | Use held item (mine, chop, place) |
| 1–9, mouse wheel | Select hotbar slot |
| Q | Cycle build shape for the held material (terrain fill, floor, wall, pillar, stairs, roof) |
| Tab / E | Inventory (click two slots to swap) |
| F5 / F9 | Save / reload the saved world |
| F3 | Debug readout |

## How the world works (and why it is not voxels)

The terrain is a **signed density field** sampled once per metre (positive =
solid). The visible surface is extracted with **Surface Nets**, which gives
smooth, organic, faceted polygon meshes: hills, cliffs, overhangs, tunnels
and caverns. The sampling grid is internal only; nothing ever renders as a
cube.

- **Mining** is CSG subtraction of a sphere from the field. Removed volume
  per material turns into items. Only the affected chunks are re-meshed.
- **Physics** collides the player (a stack of spheres) against the same
  field via gradient-normalised distance, plus analytic SDFs for building
  pieces and tree trunks. There are no collision meshes.
- **Saves** store only what the player changed: a replayable log of CSG
  edits, placed pieces, felled trees, the inventory and the player's
  position. The world regenerates from the seed.
- **Building** uses modular pieces on a 2 m placement grid (a building aid,
  not the world representation). Terrain can also be filled back in with
  dirt, stone, sand and other materials.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the architecture and the development plan.

## Layout

```
src/
  core/       seeded noise + PRNG
  world/      config, materials, TerrainField (density + CSG), generator,
              Surface Nets mesher, worker loader, SkyMap, vegetation,
              collision, persistence
  building/   modular pieces (SDFs, snapping)
  items/      item database, inventory
  player/     controller, input, interaction (mine / chop / build)
  render/     pixel-art texture array, world shader, terrain/vegetation/
              structure renderers, sky, particles, post FX (outlines), viewmodel
  ui/         HUD, minimap
tests/        vitest unit tests
scripts/      e2e browser test
```

## Screenshots (from the automated e2e run)

| Forest | Overview with sky island |
|---|---|
| ![](docs/screenshots/landscape.png) | ![](docs/screenshots/overview.png) |
| **Cave chamber (lantern + lumite crystal)** | **Tunnel dug with the pickaxe** |
| ![](docs/screenshots/cave.png) | ![](docs/screenshots/mined-tunnel.png) |
