// Game: owns the world, player and presentation systems and runs the loop.

import * as THREE from 'three';
import { Structures } from './building/structures';
import { HOTBAR, Inventory } from './items/inventory';
import { item } from './items/items';
import { PlayerController } from './player/controller';
import { Input } from './player/input';
import { Interaction } from './player/interaction';
import { Atmosphere } from './render/atmosphere';
import { Particles } from './render/particles';
import { PostFX } from './render/postfx';
import { StructureRenderer } from './render/structureRenderer';
import { TerrainSystem } from './render/terrainSystem';
import { buildTextureArray } from './render/textures';
import { VegetationRenderer } from './render/vegetationRenderer';
import { Viewmodel } from './render/viewmodel';
import { type WorldUniforms, createSkyTexture, createWorldMaterial, createWorldUniforms, updateSkyTexture } from './render/worldMaterial';
import { Hud } from './ui/hud';
import { Minimap } from './ui/minimap';
import { type Quality, detectQuality } from './ui/quality';
import { WorldCollision } from './world/collision';
import { defaultConfig } from './world/config';
import { WorldGenerator } from './world/generator';
import { EditLog, type SaveData, readSave, writeSave } from './world/persistence';
import { SkyMap } from './world/skymap';
import { TerrainField } from './world/terrain';
import type { Tree } from './world/vegetation';
import { Vegetation } from './world/vegetation';
import { TerrainWorkerPool } from './world/workerPool';

export interface LoadCallbacks { progress(fraction: number, label: string): void }

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(78, 1, 0.1, 1000);
  readonly input: Input;
  readonly quality: Quality;
  field!: TerrainField;
  gen!: WorldGenerator;
  sky!: SkyMap;
  veg!: Vegetation;
  structures = new Structures();
  inventory = new Inventory();
  log!: EditLog;
  player!: PlayerController;
  interaction!: Interaction;
  terrain!: TerrainSystem;
  atmosphere!: Atmosphere;
  private pool!: TerrainWorkerPool;
  private uniforms!: WorldUniforms;
  private skyTex!: THREE.DataTexture;
  private vegRenderer!: VegetationRenderer;
  private structureRenderer!: StructureRenderer;
  private particles!: Particles;
  private viewmodel!: Viewmodel;
  private post!: PostFX;
  private hud!: Hud;
  private minimap!: Minimap;
  private lastFrame = 0;
  /** When true the rAF loop stops simulating; tests drive `simulate()` instead. */
  manual = false;
  private time = 0;
  private autosave = 0;
  private skyDirty: [number, number, number, number] | null = null;
  private skyTexDirty = false;
  private wobble = new Map<number, number>();
  private dir = new THREE.Vector3();
  fps = 0;
  private frameMs = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.quality = detectQuality();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.quality.shadowSize > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.input = new Input(canvas);
    this.scene.add(this.camera);
  }

  async load(seed: number, save: SaveData | null, cb: LoadCallbacks) {
    const cfg = defaultConfig(save?.seed ?? seed);
    cb.progress(0.02, 'Shaping the land');
    await tick();
    this.gen = new WorldGenerator(cfg);
    this.field = new TerrainField(cfg);
    this.field.fallback = (x, y, z) => this.gen.densityAt(x, y, z);
    this.log = new EditLog(cfg);
    if (save) {
      this.log.load(save.edits);
      this.structures.load(save.pieces);
      this.inventory.load(save.inventory);
    } else {
      this.inventory.add('copper_pickaxe', 1);
      this.inventory.add('copper_axe', 1);
      this.inventory.add('wood', 30);
    }

    cb.progress(0.06, 'Computing skylight');
    await tick();
    this.sky = new SkyMap(this.field, (x, z) => this.gen.height(x, z));
    cb.progress(0.1, 'Growing forests');
    await tick();
    this.veg = new Vegetation(this.field, this.gen, this.sky);
    if (save) for (const id of save.treesRemoved) if (this.veg.trees[id]) this.veg.trees[id].alive = false;

    // Rendering resources.
    const textures = buildTextureArray();
    this.skyTex = createSkyTexture(this.sky);
    this.uniforms = createWorldUniforms(textures, this.skyTex, this.field.sx, this.field.sz);
    const worldMat = createWorldMaterial(this.uniforms);
    const plantMat = createWorldMaterial(this.uniforms, { vertexColors: true, side: THREE.DoubleSide });

    this.pool = new TerrainWorkerPool(cfg, this.gen);
    this.terrain = new TerrainSystem(this.field, this.log, this.pool, worldMat, this.quality.detail);
    this.terrain.onColumnResident = (x0, z0) => {
      this.markSky(x0, z0, x0 + 31, z0 + 31);
      this.veg.invalidateTufts(x0 + 16, z0 + 16, 20);
    };
    this.scene.add(this.terrain.group);

    this.vegRenderer = new VegetationRenderer(this.veg, worldMat, plantMat);
    this.scene.add(this.vegRenderer.group);
    this.structureRenderer = new StructureRenderer(this.structures, worldMat);
    this.scene.add(this.structureRenderer.group);

    const center = new THREE.Vector3(this.field.sx / 2, 0, this.field.sz / 2);
    this.atmosphere = new Atmosphere(this.scene, this.renderer, this.uniforms, center, cfg.seed, cfg.seaLevel, this.quality.shadowSize);
    this.atmosphere.timeOfDay = (save?.extra?.timeOfDay as number | undefined) ?? 0.34;

    this.particles = new Particles((x, y, z) => this.field.sample(x, y, z) > 0);
    this.scene.add(this.particles.mesh);
    this.viewmodel = new Viewmodel(this.camera);
    this.post = new PostFX(this.renderer, this.camera, this.quality.msaa);

    // Player.
    const collision = new WorldCollision(this.field, this.structures, this.veg);
    this.player = new PlayerController(collision);
    this.player.bounds = { x: this.field.sx, z: this.field.sz };
    if (save) {
      this.player.teleport(save.player.x, save.player.y, save.player.z);
      this.player.yaw = save.player.yaw;
      this.player.pitch = save.player.pitch;
    } else {
      const s = this.gen.spawn;
      this.player.teleport(s.x, s.y, s.z);
      // Face the cave entrance so it's discoverable.
      const e = this.gen.entrance[0];
      this.player.yaw = Math.atan2(-(e.ax - s.x), -(e.az - s.z));
    }

    this.hud = new Hud(this.inventory);
    this.minimap = new Minimap(document.querySelector('#minimap') as HTMLCanvasElement, this.field, this.sky, cfg.seaLevel,
      (x, z, h) => {
        const dh = Math.hypot(this.gen.height(x + 1, z) - this.gen.height(x - 1, z), this.gen.height(x, z + 1) - this.gen.height(x, z - 1)) / 2;
        return this.gen.materialFor(x, h - 0.5, z, 0, 1 / Math.sqrt(1 + dh * dh));
      });
    this.interaction = new Interaction(this.field, this.structures, this.veg, this.inventory, this.player, this.log, {
      terrainEdited: (x, y, z, r) => this.onTerrainEdited(x, y, z, r),
      treeFelled: t => this.onTreeFelled(t),
      treeHit: t => this.wobble.set(t.id, 0),
      particles: (x, y, z, nx, ny, nz, c, n) => this.particles.burst(x, y, z, nx, ny, nz, c, n),
      message: (t, c) => this.hud.message(t, c),
      swing: () => this.viewmodel.triggerSwing(),
      ghost: (m, p, v, r) => this.structureRenderer.showGhost(m, p, v, r),
    });
    this.inventory.onChange(() => this.refreshHeld());
    this.refreshHeld();

    window.addEventListener('resize', () => this.resize());
    this.resize();

    // Stream in everything visible from the start position.
    const focus = new THREE.Vector3(this.player.x, this.player.y, this.player.z);
    while (!this.terrain.complete) {
      this.terrain.update(focus, 6);
      cb.progress(0.15 + this.terrain.progress() * 0.83, 'Building terrain');
      await new Promise(r => setTimeout(r, 16));
    }
    this.flushSky();
    // Pre-grow the grass around the start position.
    for (let i = 0; i < 20; i++) this.vegRenderer.update(focus, 0.1);
    cb.progress(1, 'Ready');
  }

  private refreshHeld() {
    const held = this.inventory.held;
    this.viewmodel.setItem(held?.id ?? null);
    this.hud.modeLabel = held && item(held.id).kind !== 'tool' ? this.interaction.modeLabel() : '';
    this.hud.render();
  }

  private markSky(x0: number, z0: number, x1: number, z1: number) {
    const d = this.skyDirty;
    this.skyDirty = d ? [Math.min(d[0], x0), Math.min(d[1], z0), Math.max(d[2], x1), Math.max(d[3], z1)] : [x0, z0, x1, z1];
  }

  private flushSky() {
    if (this.skyDirty) {
      const [x0, z0, x1, z1] = this.skyDirty;
      this.sky.update(x0, z0, x1, z1);
      this.minimap.refresh(x0, z0, x1, z1);
      this.skyDirty = null;
      this.skyTexDirty = true;
    }
    if (this.skyTexDirty) {
      updateSkyTexture(this.skyTex, this.sky);
      this.skyTexDirty = false;
    }
  }

  private onTerrainEdited(x: number, _y: number, z: number, r: number) {
    const pad = r + 1;
    this.markSky(x - pad, z - pad, x + pad, z + pad);
    this.veg.invalidateTufts(x, z, r + 1);
    for (const t of this.veg.unsupportedTrees(x, z, r)) {
      // Undermined trees topple and drop their wood (like Terraria).
      t.alive = false;
      this.onTreeFelled(t);
      const wood = Math.round(t.height / 2) + 2;
      this.inventory.add('wood', wood);
      this.hud.message(`+${wood} Wood (tree toppled)`, '#cfe8a0');
      this.particles.burst(t.x, t.y + t.height * 0.8, t.z, 0, 1, 0, 0x3f9a55, 24);
    }
    // Mesh edited chunks immediately for responsive feedback.
    this.terrain.remeshDirty(8);
  }

  private onTreeFelled(t: Tree) {
    this.vegRenderer.removeTree();
    this.wobble.delete(t.id);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post?.resize();
  }

  start() {
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
      this.lastFrame = now;
      if (this.manual) return;
      const t0 = performance.now();
      this.update(dt);
      this.render();
      this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    };
    requestAnimationFrame(loop);
  }

  /** Advance the simulation by fixed steps without rendering (tests/tools). */
  simulate(seconds: number, step = 1 / 60) {
    for (let t = 0; t < seconds; t += step) this.update(step);
  }

  saveGame() {
    const ok = writeSave(this.snapshot());
    this.hud.message(ok ? 'World saved' : 'Could not save (storage unavailable)', ok ? '#9fd0ff' : '#ff9a7a');
  }

  snapshot(): SaveData {
    return {
      version: 1,
      seed: this.field.cfg.seed,
      edits: this.log.edits,
      pieces: this.structures.serialize(),
      treesRemoved: this.veg.trees.filter(t => !t.alive).map(t => t.id),
      inventory: this.inventory.serialize(),
      player: { x: this.player.x, y: this.player.y, z: this.player.z, yaw: this.player.yaw, pitch: this.player.pitch },
      savedAt: Date.now(),
      extra: { timeOfDay: this.atmosphere.timeOfDay },
    };
  }

  private handleKeys() {
    const inp = this.input;
    for (let i = 0; i < HOTBAR; i++) if (inp.wasPressed(`Digit${i + 1}`)) this.inventory.select(i);
    if (inp.wheel) this.inventory.select(this.inventory.selected + inp.wheel);
    if (inp.wasPressed('KeyQ')) { this.interaction.cycleMode(); this.refreshHeld(); }
    if (inp.wasPressed('F3')) this.hud.debugVisible = !this.hud.debugVisible;
    if (inp.wasPressed('F5')) this.saveGame();
    if (inp.wasPressed('F9')) location.href = `${location.pathname}?continue=1`;
    if (inp.wasPressed('Tab') || inp.wasPressed('KeyE')) {
      const open = !this.hud.inventoryOpen;
      this.hud.setInventoryOpen(open);
      if (open) inp.unlock(); else inp.lock();
    }
  }

  update(dt: number) {
    this.time += dt;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
    const inp = this.input;
    const active = inp.locked && !this.hud.inventoryOpen;
    this.handleKeys();

    // Look.
    if (active) {
      this.player.yaw -= inp.mouseDX * inp.sensitivity;
      this.player.pitch = Math.max(-1.55, Math.min(1.55, this.player.pitch - inp.mouseDY * inp.sensitivity));
    }
    // Move.
    const k = (c: string) => (active && inp.down(c) ? 1 : 0);
    const outdoorsHere = this.sky.visibility(this.player.x, this.player.y + 1, this.player.z) > 0.5;
    this.player.update(dt, {
      forward: k('KeyW') - k('KeyS'),
      strafe: k('KeyD') - k('KeyA'),
      jump: !!k('Space'),
      sprint: !!(k('ShiftLeft') || k('ShiftRight')),
      crouch: !!k('KeyC'),
    }, outdoorsHere ? this.field.cfg.seaLevel : null);
    if (this.player.y < -10) {
      const s = this.gen.spawn;
      this.player.teleport(s.x, s.y + 2, s.z);
    }

    // Camera.
    this.camera.position.set(this.player.x, this.player.y + this.player.eyeHeight, this.player.z);
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
    const dir = this.dir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);

    // Interaction.
    this.interaction.update(dt, this.camera.position, dir, active && inp.lmb, active && inp.consumeClick());
    const held = this.inventory.held;
    if (held && item(held.id).kind !== 'tool') {
      const label = this.interaction.modeLabel();
      if (label !== this.hud.modeLabel) { this.hud.modeLabel = label; this.hud.render(); }
    }

    // World streaming + updates.
    this.terrain.update(this.camera.position, 3);
    this.vegRenderer.update(this.camera.position, dt);
    this.structureRenderer.update();
    this.flushSky();
    for (const [id, t] of this.wobble) {
      const nt = t + dt;
      this.vegRenderer.wobbleTree(id, nt);
      if (nt > 0.4) this.wobble.delete(id); else this.wobble.set(id, nt);
    }

    // Atmosphere.
    const cam = this.camera.position;
    const vis = this.sky.visibility(cam.x, cam.y, cam.z);
    this.atmosphere.update(dt, cam, vis, this.time, this.player.position, dir);
    this.post.setUnderground(this.atmosphere.underground);
    const moving = Math.min(1, Math.hypot(this.player.vx, this.player.vz) / 5) * (this.player.grounded ? 1 : 0);
    const ambient = this.atmosphere.ambientAt(vis);
    this.viewmodel.update(dt, moving, ambient);
    this.particles.update(dt, ambient);

    this.minimap.draw(this.player.x, this.player.z, this.player.yaw);
    if (this.hud.debugVisible) {
      const st = this.terrain.stats, vc = this.vegRenderer.counts;
      this.hud.setDebug(
        `fps ${this.fps.toFixed(0)}  frame ${this.frameMs.toFixed(1)}ms\n` +
        `pos ${this.player.x.toFixed(1)} ${this.player.y.toFixed(1)} ${this.player.z.toFixed(1)}  sky ${vis.toFixed(2)}\n` +
        `terrain ${st.meshes} meshes ${(st.tris / 1000).toFixed(0)}k tris, ${st.resident} chunks, ${st.nodes} lod, ${st.pending} jobs\n` +
        `trees ${vc.near}+${vc.far}  grass ${vc.grass}  draw calls ${this.renderer.info.render.calls}  tris ${(this.renderer.info.render.triangles / 1000).toFixed(0)}k\n` +
        `time ${(this.atmosphere.timeOfDay * 24).toFixed(1)}h  edits ${this.log.edits.length}  pieces ${this.structures.pieces.size}`,
      );
    } else this.hud.setDebug('');

    this.autosave += dt;
    if (this.autosave > 60 && (this.log.edits.length || this.structures.pieces.size)) {
      this.autosave = 0;
      writeSave(this.snapshot());
    }

    inp.endFrame();
  }

  render() {
    this.renderer.info.reset();
    this.post.render(this.scene);
  }
}

function tick() {
  return new Promise(r => setTimeout(r, 0));
}

export function savedGame() {
  return readSave();
}
