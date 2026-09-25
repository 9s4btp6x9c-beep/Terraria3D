// Game: owns the world, player and presentation systems and runs the loop.

import * as THREE from 'three';
import { Structures } from './building/structures';
import { HOTBAR, Inventory } from './items/inventory';
import { item } from './items/items';
import { PlayerController } from './player/controller';
import { Input } from './player/input';
import { Interaction } from './player/interaction';
import { Particles } from './render/particles';
import { PostFX } from './render/postfx';
import { Sky } from './render/sky';
import { StructureRenderer } from './render/structureRenderer';
import { TerrainRenderer } from './render/terrainRenderer';
import { buildTextureArray } from './render/textures';
import { VegetationRenderer } from './render/vegetationRenderer';
import { Viewmodel } from './render/viewmodel';
import { type WorldUniforms, createSkyTexture, createWorldMaterial, createWorldUniforms, updateSkyTexture } from './render/worldMaterial';
import { Hud } from './ui/hud';
import { Minimap } from './ui/minimap';
import { WorldCollision } from './world/collision';
import { defaultConfig } from './world/config';
import { WorldGenerator } from './world/generator';
import { generateField } from './world/loader';
import { EditLog, type SaveData, readSave, writeSave } from './world/persistence';
import { SkyMap } from './world/skymap';
import { TerrainField } from './world/terrain';
import { Vegetation } from './world/vegetation';

const SUN_DIR = new THREE.Vector3(0.45, 0.82, 0.3).normalize();
const SKY_FOG = new THREE.Color(0xa9c6ee);
const CAVE_FOG = new THREE.Color(0x0b0a12);

export interface LoadCallbacks { progress(fraction: number, label: string): void }

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(78, 1, 0.05, 700);
  readonly input: Input;
  field!: TerrainField;
  gen!: WorldGenerator;
  sky!: SkyMap;
  veg!: Vegetation;
  structures = new Structures();
  inventory = new Inventory();
  log = new EditLog();
  player!: PlayerController;
  interaction!: Interaction;
  private uniforms!: WorldUniforms;
  private skyTex!: THREE.DataTexture;
  private terrainRenderer!: TerrainRenderer;
  private vegRenderer!: VegetationRenderer;
  private structureRenderer!: StructureRenderer;
  private particles!: Particles;
  private viewmodel!: Viewmodel;
  private post!: PostFX;
  private skyDome!: Sky;
  private sun!: THREE.DirectionalLight;
  private hud!: Hud;
  private minimap!: Minimap;
  private water!: THREE.Mesh;
  private lastFrame = 0;
  /** When true the rAF loop stops simulating; tests drive `simulate()` instead. */
  manual = false;
  private time = 0;
  private underground = 0;
  private autosave = 0;
  private skyDirty: [number, number, number, number] | null = null;
  private wobble = new Map<number, number>();
  paused = true;
  fps = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.input = new Input(canvas);
    this.scene.add(this.camera);
  }

  async load(seed: number, save: SaveData | null, cb: LoadCallbacks) {
    const cfg = defaultConfig(save?.seed ?? seed);
    this.gen = new WorldGenerator(cfg);
    this.field = new TerrainField(cfg);
    await generateField(this.field, this.gen, f => cb.progress(f * 0.55, 'Generating terrain'));

    if (save) {
      this.log.replay(this.field, save.edits);
      this.structures.load(save.pieces);
      this.inventory.load(save.inventory);
    } else {
      this.inventory.add('copper_pickaxe', 1);
      this.inventory.add('copper_axe', 1);
      this.inventory.add('wood', 30);
    }
    this.field.dirty.clear();

    cb.progress(0.56, 'Computing skylight');
    await tick();
    this.sky = new SkyMap(this.field);
    cb.progress(0.6, 'Growing forests');
    await tick();
    this.veg = new Vegetation(this.field, this.gen);
    if (save) for (const id of save.treesRemoved) if (this.veg.trees[id]) this.veg.trees[id].alive = false;

    // Rendering resources.
    const textures = buildTextureArray();
    this.skyTex = createSkyTexture(this.sky);
    this.uniforms = createWorldUniforms(textures, this.skyTex, this.field.sx, this.field.sz);
    const worldMat = createWorldMaterial(this.uniforms);
    const plantMat = createWorldMaterial(this.uniforms, { vertexColors: true, side: THREE.DoubleSide });

    this.terrainRenderer = new TerrainRenderer(this.field, worldMat);
    await this.terrainRenderer.buildAll(f => cb.progress(0.62 + f * 0.33, 'Meshing terrain'));
    this.scene.add(this.terrainRenderer.group);

    this.vegRenderer = new VegetationRenderer(this.veg, worldMat, plantMat);
    for (const t of this.veg.trees) if (!t.alive) this.vegRenderer.removeTree(t.id);
    this.scene.add(this.vegRenderer.group);
    this.structureRenderer = new StructureRenderer(this.structures, worldMat);
    this.scene.add(this.structureRenderer.group);

    this.setupLighting();
    this.skyDome = new Sky(cfg.seed, new THREE.Vector3(this.field.sx / 2, 0, this.field.sz / 2));
    this.scene.add(this.skyDome.group);
    this.setupWater(cfg.seaLevel);

    this.particles = new Particles((x, y, z) => this.field.sample(x, y, z) > 0);
    this.scene.add(this.particles.mesh);
    this.viewmodel = new Viewmodel(this.camera);
    this.post = new PostFX(this.renderer, this.camera);

    // Player.
    const collision = new WorldCollision(this.field, this.structures, this.veg);
    this.player = new PlayerController(collision);
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
    this.minimap = new Minimap(document.querySelector('#minimap') as HTMLCanvasElement, this.field, this.sky, cfg.seaLevel);
    this.interaction = new Interaction(this.field, this.structures, this.veg, this.inventory, this.player, this.log, {
      terrainEdited: (x, y, z, r) => this.onTerrainEdited(x, y, z, r),
      treeFelled: t => { this.vegRenderer.removeTree(t.id); this.wobble.delete(t.id); },
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
    cb.progress(1, 'Ready');
  }

  private setupLighting() {
    this.sun = new THREE.DirectionalLight(0xfff2dc, 2.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = -70; s.right = 70; s.top = 70; s.bottom = -70; s.near = 1; s.far = 420;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.06;
    this.scene.add(this.sun, this.sun.target);
    this.scene.fog = new THREE.Fog(SKY_FOG.clone(), 70, 330);
  }

  private setupWater(level: number) {
    const geo = new THREE.PlaneGeometry(1400, 1400, 1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: 0x2f73c8, transparent: true, opacity: 0.78, emissive: 0x0a2248 });
    // The sea is one plane; hide it wherever the column is covered by land so
    // it never shows up inside caves that dip below sea level.
    mat.onBeforeCompile = shader => {
      shader.uniforms.uSky = this.uniforms.uSky;
      shader.uniforms.uSkySize = this.uniforms.uSkySize;
      shader.uniforms.uSea = { value: level };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWaterWorld;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uSky; uniform vec2 uSkySize; uniform float uSea; varying vec3 vWaterWorld;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  vec2 suv = (vWaterWorld.xz + 0.5) / uSkySize;
  if (suv.x > 0.0 && suv.y > 0.0 && suv.x < 1.0 && suv.y < 1.0 && texture2D(uSky, suv).r > uSea + 2.5) discard;`);
    };
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.set(this.field.sx / 2, level, this.field.sz / 2);
    this.water.receiveShadow = true;
    this.water.renderOrder = 5;
    this.scene.add(this.water);
  }

  private refreshHeld() {
    const held = this.inventory.held;
    this.viewmodel.setItem(held?.id ?? null);
    this.hud.modeLabel = held && item(held.id).kind !== 'tool' ? this.interaction.modeLabel() : '';
    this.hud.render();
  }

  private onTerrainEdited(x: number, y: number, z: number, r: number) {
    const pad = r + 1;
    const d = this.skyDirty;
    this.skyDirty = d ? [Math.min(d[0], x - pad), Math.min(d[1], z - pad), Math.max(d[2], x + pad), Math.max(d[3], z + pad)] : [x - pad, z - pad, x + pad, z + pad];
    const tufts = this.veg.clearTufts(x, y, z, r + 0.6);
    if (tufts.length) this.vegRenderer.removeTufts(tufts);
    // Mesh edited chunks immediately for responsive feedback.
    this.terrainRenderer.update(this.camera.position, 8);
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
      this.update(dt);
      this.render();
    };
    requestAnimationFrame(loop);
  }

  /** Advance the simulation by fixed steps without rendering (tests/tools). */
  simulate(seconds: number, step = 1 / 60) {
    for (let t = 0; t < seconds; t += step) this.update(step);
  }

  saveGame() {
    writeSave(this.snapshot());
    this.hud.message('World saved', '#9fd0ff');
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
      crouch: !!(k('KeyC') || k('ControlLeft')),
    }, outdoorsHere ? this.field.cfg.seaLevel : null);
    if (this.player.y < -10) {
      const s = this.gen.spawn;
      this.player.teleport(s.x, s.y + 2, s.z);
    }

    // Camera.
    const eye = this.player.eyeHeight;
    this.camera.position.set(this.player.x, this.player.y + eye, this.player.z);
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);

    // Interaction.
    this.interaction.update(dt, this.camera.position, dir, active && inp.lmb, active && inp.consumeClick());
    const held = this.inventory.held;
    if (held && item(held.id).kind !== 'tool') {
      const label = this.interaction.modeLabel();
      if (label !== this.hud.modeLabel) { this.hud.modeLabel = label; this.hud.render(); }
    }

    // World updates.
    this.terrainRenderer.update(this.camera.position, 4);
    this.structureRenderer.update();
    if (this.skyDirty) {
      const [x0, z0, x1, z1] = this.skyDirty;
      this.sky.update(x0, z0, x1, z1);
      updateSkyTexture(this.skyTex, this.sky);
      this.minimap.refresh(x0, z0, x1, z1);
      this.skyDirty = null;
    }
    for (const [id, t] of this.wobble) {
      const nt = t + dt;
      this.vegRenderer.wobbleTree(id, nt);
      if (nt > 0.4) this.wobble.delete(id); else this.wobble.set(id, nt);
    }

    // Atmosphere: blend towards cave lighting when underground.
    const vis = this.sky.visibility(this.camera.position.x, this.camera.position.y, this.camera.position.z);
    this.underground += ((1 - vis) - this.underground) * Math.min(1, dt * 3);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(SKY_FOG).lerp(CAVE_FOG, this.underground);
    fog.near = 70 - this.underground * 62;
    fog.far = 330 - this.underground * 250;
    this.renderer.setClearColor(fog.color);
    this.post.setUnderground(this.underground);
    this.skyDome.group.visible = this.underground < 0.98;

    // Sun + shadows follow the player (snapped to texels to avoid shimmer).
    const snap = 140 / 2048;
    const px = Math.round(this.player.x / snap) * snap, pz = Math.round(this.player.z / snap) * snap;
    this.sun.target.position.set(px, this.player.y, pz);
    this.sun.position.set(px + SUN_DIR.x * 200, this.player.y + SUN_DIR.y * 200, pz + SUN_DIR.z * 200);

    // Player lantern (point light slot 0).
    const lp = this.uniforms.uLightPos.value[0];
    lp.set(this.camera.position.x + dir.x * 0.5, this.camera.position.y + 0.2, this.camera.position.z + dir.z * 0.5, 13);
    this.uniforms.uLightColor.value[0].setRGB(1.0, 0.72, 0.42).multiplyScalar(0.35 + this.underground * 0.9);
    this.uniforms.uTime.value = this.time;

    this.skyDome.follow(this.camera);
    this.skyDome.update(this.time);
    const moving = Math.min(1, Math.hypot(this.player.vx, this.player.vz) / 5) * (this.player.grounded ? 1 : 0);
    this.viewmodel.update(dt, moving, Math.max(vis, 0.35));
    this.particles.update(dt, Math.max(vis, 0.3));

    this.minimap.draw(this.player.x, this.player.z, this.player.yaw);
    this.hud.setDebug(
      `fps ${this.fps.toFixed(0)}\npos ${this.player.x.toFixed(1)} ${this.player.y.toFixed(1)} ${this.player.z.toFixed(1)}\n` +
      `grounded ${this.player.grounded} sky ${vis.toFixed(2)}\ntris ${this.terrainRenderer.triangleCount} edits ${this.log.edits.length} pieces ${this.structures.pieces.size}\n` +
      `calls ${this.renderer.info.render.calls}`,
    );

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
