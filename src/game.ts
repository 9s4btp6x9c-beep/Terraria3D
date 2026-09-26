// Game: owns the world, player and presentation systems and runs the loop.

import * as THREE from 'three';
import { Audio } from './audio/sfx';
import { mulberry32 } from './core/noise';
import { FurnitureSet, type Placed, lightPoint } from './building/furniture';
import { Structures } from './building/structures';
import { Combat } from './entities/combat';
import type { NpcContext } from './entities/npcs';
import { WanderingMerchant } from './entities/merchant';
import { CREATURES, type Creature } from './entities/creatures';
import { type EventKind, type EventSignal, WorldEvents } from './entities/events';
import { Equipment, type PlayerStats } from './items/equipment';
import { HOTBAR, Inventory } from './items/inventory';
import { type ItemDef, item } from './items/items';
import { RECIPES, canCraft, craft } from './items/recipes';
import { PlayerController } from './player/controller';
import { Grapple } from './player/grapple';
import { Input } from './player/input';
import { Interaction } from './player/interaction';
import { PlayerVitals } from './player/vitals';
import { Atmosphere } from './render/atmosphere';
import { FurnitureRenderer } from './render/furnitureRenderer';
import { IconAtlas } from './render/icons';
import { Particles } from './render/particles';
import { Pickups } from './render/pickups';
import { PostFX } from './render/postfx';
import { RopeRenderer } from './render/rope';
import { StructureRenderer } from './render/structureRenderer';
import { TerrainSystem } from './render/terrainSystem';
import { buildTextureArray } from './render/textures';
import { VegetationRenderer } from './render/vegetationRenderer';
import { VIEWMODEL_LAYER, Viewmodel } from './render/viewmodel';
import { type WorldUniforms, createSkyTexture, createWorldMaterial, createWorldUniforms, updateSkyTexture } from './render/worldMaterial';
import { Hud } from './ui/hud';
import { BuildMenu } from './ui/buildMenu';
import { COMFORT_RANGE, REST_TIME, comfortAt, restDuration } from './building/comfort';
import { DialogueUI } from './ui/dialogue';
import { InventoryUI } from './ui/inventoryUI';
import { Minimap } from './ui/minimap';
import { type Quality, detectQuality } from './ui/quality';
import { WorldLabels } from './ui/worldLabels';
import { WorldCollision } from './world/collision';
import { CAVES_VERSION, LEGACY_CHUNKS, WORLD_CHUNKS, defaultConfig } from './world/config';
import { BIOME_NAMES, EMBER_Y, WorldGenerator } from './world/generator';
import { Mat, material } from './world/materials';
import { EditLog, type SaveData, readSave, writeSave } from './world/persistence';
import { SkyMap } from './world/skymap';
import { TerrainField } from './world/terrain';
import type { Tree } from './world/vegetation';
import { Vegetation } from './world/vegetation';
import { caveFloor, planStructures } from './world/worldStructures';
import { MIN_LEVEL, WaterSim } from './world/water';
import { WaterRenderer, createLavaMaterial, createWaterMaterial } from './render/waterRenderer';
import { TerrainWorkerPool } from './world/workerPool';

export interface LoadCallbacks { progress(fraction: number, label: string): void }

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(78, 1, 0.05, 1000);
  readonly input: Input;
  readonly quality: Quality;
  readonly audio = new Audio();
  field!: TerrainField;
  gen!: WorldGenerator;
  sky!: SkyMap;
  veg!: Vegetation;
  structures = new Structures();
  furniture = new FurnitureSet();
  inventory = new Inventory();
  equipment = new Equipment();
  vitals = new PlayerVitals();
  log!: EditLog;
  player!: PlayerController;
  interaction!: Interaction;
  terrain!: TerrainSystem;
  atmosphere!: Atmosphere;
  combat!: Combat;
  pickups!: Pickups;
  stats!: PlayerStats;
  spawnPoint = { x: 0, y: 0, z: 0 };
  grapple!: Grapple;
  merchant!: WanderingMerchant;
  private wasDaylight: boolean | null = null;
  private dialogue!: DialogueUI;
  /** World progression flags (bosses defeated, events). */
  progress = { bossDefeated: false, raidDefeated: false, rocDefeated: false };
  readonly events = new WorldEvents();
  water!: WaterSim;
  private waterRenderer!: WaterRenderer;
  /** Lava: the same liquid grid, thicker and slower, that burns. */
  lava!: WaterSim;
  private lavaRenderer!: WaterRenderer;
  private lavaAcc = 0;
  private lavaReact = 0;
  /** Where lava glows (craters, chambers, pools) for nearby lights. */
  private lavaSources: { x: number; y: number; z: number }[] = [];
  private lavaLights = new Map<number, number>();
  private lavaLightTimer = 0;
  private burnWarned = 0;
  private waterAcc = 0;
  private structVersion = -1;
  private furnVersion = -1;
  /** Seconds of breath left underwater. */
  breath = 12;
  /** Biome whose name was last shown, and the one the player is crossing into. */
  private biomeShown = -1;
  private biomeNext = -1;
  private biomeTime = 0;
  readonly maxBreath = 12;
  private drownTimer = 0;
  private wasInWater = false;
  private rope!: RopeRenderer;
  private pool!: TerrainWorkerPool;
  private uniforms!: WorldUniforms;
  private skyTex!: THREE.DataTexture;
  private vegRenderer!: VegetationRenderer;
  private structureRenderer!: StructureRenderer;
  buildMenu!: BuildMenu;
  private furnitureRenderer!: FurnitureRenderer;
  private particles!: Particles;
  /** Rising flame licks over torches and fires (always bright). */
  private flames!: Particles;
  private fires: [number, number, number, number][] = [];
  private flameAt = new THREE.Vector3();
  /** Lava surface points near the player (embers rise from them). */
  private lavaTop: [number, number, number][] = [];
  private lavaScan = 0;
  private fireScan = 0;
  private viewmodel!: Viewmodel;
  private post!: PostFX;
  private hud!: Hud;
  private invUI!: InventoryUI;
  private icons!: IconAtlas;
  private labels!: WorldLabels;
  private minimap!: Minimap;
  private lastFrame = 0;
  /** When true the rAF loop stops simulating; tests drive `simulate()` instead. */
  manual = false;
  /** Paused (pause menu): the world is drawn but not simulated. */
  paused = false;
  /** Title screen: the camera drifts around spawn and the player is idle. */
  menuMode = false;
  private menuT = 0;
  private time = 0;
  private autosave = 0;
  private skyDirty: [number, number, number, number] | null = null;
  private skyTexDirty = false;
  private wobble = new Map<number, number>();
  private dir = new THREE.Vector3();
  private shake = 0;
  private collision!: WorldCollision;
  private camN: [number, number, number] = [0, 0, 0];
  private potionCooldown = 0;
  private flapTimer = 0;
  private invertY = false;
  /** Stars currently falling (become pickups where they land). */
  private stars: { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number }[] = [];
  private starTimer = 30;
  /** Point lights for the nearest glowing mushrooms (tree id -> light id). */
  private mushLights = new Map<number, number>();
  private mushTimer = 0;
  private deathShown = false;
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
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  // ======================================================================= load

  async load(seed: number, save: SaveData | null, cb: LoadCallbacks) {
    const chunks = save ? (typeof save.extra?.chunks === 'number' ? save.extra.chunks : LEGACY_CHUNKS) : WORLD_CHUNKS;
    // Saves keep the cave generation they were made with (older ones: 1).
    const cfg = { ...defaultConfig(save?.seed ?? seed, chunks), caves: save ? (typeof save.extra?.caves === 'number' ? save.extra.caves : 1) : CAVES_VERSION };
    cb.progress(0.02, 'Shaping the land');
    await tick();
    this.gen = new WorldGenerator(cfg);
    this.field = new TerrainField(cfg);
    this.field.fallback = (x, y, z) => this.gen.densityAt(x, y, z);
    this.log = new EditLog(cfg);
    this.spawnPoint = { ...this.gen.spawn };
    if (save) {
      this.log.load(save.edits);
      this.structures.load(save.pieces);
      this.inventory.load(save.inventory);
      const ex = save.extra ?? {};
      if (ex.furniture) this.furniture.load(ex.furniture as Placed[]);
      if (ex.equipment) this.equipment.load(ex.equipment as never);
      if (ex.spawn) this.spawnPoint = ex.spawn as typeof this.spawnPoint;
      if (typeof ex.maxHp === 'number') this.vitals.maxHp = ex.maxHp;
      if (typeof ex.maxMana === 'number') this.vitals.maxMana = this.vitals.mana = ex.maxMana;
      if (typeof ex.hp === 'number') this.vitals.hp = Math.max(1, Math.min(this.vitals.maxHp, ex.hp));
      // Worlds from before the Builder's Hammer get one.
      if (!ex.build && this.inventory.count('builder_hammer') === 0) this.inventory.add('builder_hammer', 1);
    } else {
      // Generated cabins and sky shrines, built from regular pieces/furniture.
      const plan = planStructures(this.gen);
      for (const p of plan.pieces) this.structures.add(p);
      for (const f of plan.furniture) this.furniture.add(f);
      // A light start: tools and torches on the hotbar, supplies in the pack.
      this.inventory.add('copper_pickaxe', 1);
      this.inventory.add('copper_axe', 1);
      this.inventory.add('wooden_sword', 1);
      this.inventory.add('builder_hammer', 1);
      this.inventory.add('torch', 12);
      this.inventory.add('wood', 30);
      this.inventory.add('healing_potion', 2);
      this.inventory.swap(5, HOTBAR);
      this.inventory.swap(6, HOTBAR + 1);
    }

    cb.progress(0.06, 'Computing skylight');
    await tick();
    this.sky = new SkyMap(this.field, (x, z) => this.gen.height(x, z), (x, y, z) => {
      // Root arches and giant ribs don't count as a roof over the ground.
      if (y < this.gen.height(x, z) + 1) return false;
      const f = this.gen.featureAt(x, y, z);
      return !!f && f.d > -1.5 && f.mat !== Mat.Amber;
    });
    cb.progress(0.1, 'Growing forests');
    await tick();
    this.veg = new Vegetation(this.field, this.gen, this.sky);
    if (save) for (const id of save.treesRemoved) if (this.veg.trees[id]) this.veg.trees[id].alive = false;

    // Rendering resources.
    const textures = buildTextureArray();
    this.skyTex = createSkyTexture(this.sky);
    this.uniforms = createWorldUniforms(textures, this.skyTex, this.field.sx, this.field.sz);
    const u = this.uniforms;
    const worldMat = createWorldMaterial(u);
    const plantMat = createWorldMaterial(u, { vertexColors: true, side: THREE.DoubleSide });
    const furnMat = createWorldMaterial(u, { vertexColors: true });
    const pickupMat = createWorldMaterial(u, { vertexColors: true, objectSpace: { scale: 3, visibility: null } });
    const iconMat = createWorldMaterial(u, { vertexColors: true, objectSpace: { scale: 3, visibility: { value: 1 } } });
    const viewVis = { value: 1 };
    const viewMat = createWorldMaterial(u, { vertexColors: true, objectSpace: { scale: 3, visibility: viewVis } });
    this.icons = new IconAtlas(this.renderer, iconMat);

    this.pool = new TerrainWorkerPool(cfg, this.gen);
    this.terrain = new TerrainSystem(this.field, this.log, this.pool, worldMat, this.quality.detail);
    this.terrain.onColumnResident = (x0, z0) => {
      this.water?.invalidate();
      this.lava?.invalidate();
      this.markSky(x0, z0, x0 + 31, z0 + 31);
      this.veg.invalidateTufts(x0 + 16, z0 + 16, 20);
    };
    this.scene.add(this.terrain.group);

    // Liquid water (lakes, pools, floods). Distance to the coast (in columns)
    // limits how far the sea's pressure floods tunnels instantly.
    const coast = coastDistance(this.field.sx, this.field.sz, (x, z) => this.gen.oceanFloor(x + 0.5, z + 0.5) !== null);
    const liquidSolid = (i: number, j: number, k: number) => {
      const x = i + 0.5, y = j + 0.5, z = k + 0.5;
      if (this.field.sample(x, y, z) > 0) return true;
      const near = this.structures.near(x, y, z, 1.5);
      if (near.length && Structures.distance(near, x, y, z) < 0.05) return true;
      const furn = this.furniture.colliders(x, y, z, 1.5);
      return furn.length > 0 && FurnitureSet.distance(furn, x, y, z) < 0;
    };
    this.water = new WaterSim({
      sx: this.field.sx, sy: this.field.sy, sz: this.field.sz, seaLevel: cfg.seaLevel,
      solid: liquidSolid,
      oceanFloor: (i, k) => this.gen.oceanFloor(i + 0.5, k + 0.5),
      nearCoast: (i, k) => coast[i + k * this.field.sx] <= 48,
    });
    if (save?.extra?.water) this.water.load(save.extra.water as never);
    else this.fillInitialWater();
    const shore = (i: number, j: number, k: number) => this.field.sample(i + 0.5, j + 0.5, k + 0.5) > 0;
    this.waterRenderer = new WaterRenderer(this.water, createWaterMaterial(u), (x, y, z) => this.sky.visibility(x, y, z) < 0.3, shore);
    this.lava = new WaterSim({ sx: this.field.sx, sy: this.field.sy, sz: this.field.sz, seaLevel: -1, solid: liquidSolid, oceanFloor: () => null, spreadMin: 0.3 });
    this.lavaSources = this.findLavaSources();
    if (save?.extra?.lava) { this.lava.load(save.extra.lava as never); this.lava.wakeAll(); }
    else this.fillInitialLava();
    this.lavaRenderer = new WaterRenderer(this.lava, createLavaMaterial(u), (x, y, z) => this.sky.visibility(x, y, z) < 0.3, shore);
    this.scene.add(this.lavaRenderer.group);
    this.scene.add(this.waterRenderer.group);

    this.vegRenderer = new VegetationRenderer(this.veg, worldMat, plantMat, this.quality.grass, this.quality.trees);
    this.scene.add(this.vegRenderer.group);
    // Window panes: the world material, but see-through.
    const glassMat = createWorldMaterial(u, { side: THREE.DoubleSide });
    glassMat.transparent = true;
    glassMat.opacity = 0.32;
    glassMat.depthWrite = false;
    this.structureRenderer = new StructureRenderer(this.structures, worldMat, glassMat);
    this.scene.add(this.structureRenderer.group);

    const center = new THREE.Vector3(this.field.sx / 2, 0, this.field.sz / 2);
    this.atmosphere = new Atmosphere(this.scene, this.renderer, u, center, cfg.seed, cfg.seaLevel, this.quality.shadowSize);
    this.atmosphere.timeOfDay = (save?.extra?.timeOfDay as number | undefined) ?? 0.34;
    this.atmosphere.setOceanMask(this.field.sx, this.field.sz, (x, z) => this.gen.height(x, z) < cfg.seaLevel + 3);
    this.furnitureRenderer = new FurnitureRenderer(this.furniture, furnMat, this.atmosphere.lights);
    this.scene.add(this.furnitureRenderer.group);

    this.particles = new Particles((x, y, z) => this.field.sample(x, y, z) > 0);
    this.flames = new Particles(() => false);
    this.scene.add(this.flames.mesh);
    this.scene.add(this.particles.mesh);
    this.viewmodel = new Viewmodel(this.camera, viewMat, viewVis);
    this.post = new PostFX(this.renderer, this.camera, this.quality.msaa);

    // Player.
    const collision = new WorldCollision(this.field, this.structures, this.veg, this.furniture);
    this.collision = collision;
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

    // UI.
    this.hud = new Hud(this.inventory, this.icons);
    this.labels = new WorldLabels($('#hud'));
    this.invUI = new InventoryUI(this.inventory, this.icons, this.equipment, (t, c) => {
      this.hud.message(t, c);
      if (t.startsWith('Crafted')) this.audio.play('craft');
    });
    this.invUI.onClose = () => this.toggleInventory(false);
    this.minimap = new Minimap($<HTMLCanvasElement>('#minimap'), this.field, this.sky, cfg.seaLevel,
      (x, z, h) => (this.gen.oceanFloor(x, z) !== null && h < cfg.seaLevel ? cfg.seaLevel : this.water.level(Math.floor(x), Math.floor(h), Math.floor(z)) >= MIN_LEVEL || this.water.level(Math.floor(x), Math.floor(h) + 1, Math.floor(z)) >= MIN_LEVEL ? h + 1 : null),
      (x, z, h) => {
        const dh = Math.hypot(this.gen.height(x + 1, z) - this.gen.height(x - 1, z), this.gen.height(x, z + 1) - this.gen.height(x, z - 1)) / 2;
        return this.gen.materialFor(x, h - 0.5, z, 0, 1 / Math.sqrt(1 + dh * dh));
      });

    this.pickups = new Pickups(pickupMat, (x, y, z) => this.field.sample(x, y, z) > 0 || this.structuresSolid(x, y, z), this.inventory,
      (id, n) => {
        this.audio.play('pickup');
        this.hud.message(`+${n} ${item(id).name}`, '#cfe8a0');
      });
    this.scene.add(this.pickups.group);

    this.grapple = new Grapple(this.player, (ox, oy, oz, dx, dy, dz, max) => {
      // Latch onto terrain, building pieces or furniture — whichever is nearest.
      const hits = [
        this.field.raycast(ox, oy, oz, dx, dy, dz, max, 0.25),
        this.structures.raycast(ox, oy, oz, dx, dy, dz, max),
        this.furniture.raycast(ox, oy, oz, dx, dy, dz, max),
      ].filter(h => h !== null);
      return hits.sort((a, b) => a.distance - b.distance)[0] ?? null;
    });
    this.rope = new RopeRenderer(pickupMat);
    this.scene.add(this.rope.group);
    this.setupCombat(collision);
    this.setupInteraction();
    this.merchant = new WanderingMerchant(collision,
      () => createWorldMaterial(u, { vertexColors: true, objectSpace: { scale: 3, visibility: null } }));
    this.merchant.onMessage = (t, c) => this.hud.message(t, c);
    this.scene.add(this.merchant.group);
    this.dialogue = new DialogueUI($('#hud'), this.inventory, this.icons, () => this.npcContext(),
      (ok, name) => {
        this.hud.message(ok ? `Bought ${name}` : 'Not enough amber (or no room)', ok ? '#ffe08a' : '#ff9a7a');
        if (ok) this.audio.play('craft');
      },
      () => { if (!this.invUI.open) this.input.lock(); });
    this.buildMenu = new BuildMenu($('#hud'), this.inventory, this.icons, () => this.interaction.build, c => {
      this.interaction.build = c;
      this.refreshHeld();
    });
    this.buildMenu.onClose = () => { if (!this.menuOpen) this.input.lock(); };
    if (typeof save?.extra?.rested === 'number') this.rested = save.extra.rested;
    if (save?.extra?.build) this.interaction.build = { ...this.interaction.build, ...(save.extra.build as object) };
    if (save?.extra?.merchant) this.merchant.load(save.extra.merchant as never);
    if (save?.extra?.progress) Object.assign(this.progress, save.extra.progress);
    if (save?.extra?.events) this.events.load(save.extra.events as never);
    this.inventory.onChange(() => this.refreshHeld());
    this.equipment.onChange(() => { this.stats = this.equipment.stats(); });
    this.stats = this.equipment.stats();
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
    for (let i = 0; i < 20; i++) this.vegRenderer.update(focus, 0.1);
    cb.progress(1, 'Ready');
  }

  private structuresSolid(x: number, y: number, z: number) {
    return Structures.distance(this.structures.near(x, y, z, 1), x, y, z) < 0 || FurnitureSet.distance(this.furniture.colliders(x, y, z, 1), x, y, z) < 0;
  }

  private setupCombat(collision: WorldCollision) {
    const u = this.uniforms;
    const projMat = createWorldMaterial(u, { vertexColors: true, objectSpace: { scale: 3, visibility: { value: 1 } } });
    this.combat = new Combat(this.field, collision, {
      creatureMaterial: () => createWorldMaterial(u, { vertexColors: true, objectSpace: { scale: 3, visibility: null }, flatten: 1.8 }),
      projectileMaterial: projMat,
      particles: (x, y, z, nx, ny, nz, c, n, speed) => this.particles.burst(x, y, z, nx, ny, nz, c, n, { speed }),
      damageNumber: (x, y, z, t, c) => this.labels.add(x, y, z, t, c),
      drop: (id, n, x, y, z) => this.pickups.spawn(id, n, x, y, z),
      hurtPlayer: (amount, fx, fz, kb) => this.hurtPlayer(amount, fx, fz, kb),
      sound: (name, x, y, z) => this.audio.play(name, Math.hypot(x - this.player.x, y - this.player.y, z - this.player.z)),
      blast: (x, y, z, r) => this.blast(x, y, z, r),
      carve: (x, y, z, r, drops) => {
        const res = this.log.commit(this.field, 'sub', x, y, z, r, Mat.Air, drops ? 1 : 99);
        this.water.wake(x, y, z, r + 1.5);
        this.lava.wake(x, y, z, r + 1.5);
        const pad = r + 1;
        this.markSky(x - pad, z - pad, x + pad, z + pad);
        this.veg.invalidateTufts(x, z, r + 1);
        if (drops) {
          for (const [m, vol] of res.volumes) {
            const def = material(m);
            const n = def.drop ? Math.floor(vol / def.volumePerItem) : 0;
            if (n > 0) this.pickups.spawn(def.drop!, n, x, y, z, 2);
          }
        }
      },
      bossDefeated: b => {
        this.hud.message(`${b.name} has been defeated!`, '#c89aff');
        if (b.id === 'deepwyrm') {
          this.progress.bossDefeated = true;
          this.hud.message('Its scales could fire a Lumite Forge...', '#c89aff');
        } else {
          this.progress.rocDefeated = true;
          this.hud.message('The skies are calm. Its wings are yours to wear.', '#c89aff');
        }
        writeSave(this.snapshot());
      },
      pushPlayer: (fx, fz, strength) => {
        const dx = this.player.x - fx, dz = this.player.z - fz, l = Math.hypot(dx, dz) || 1;
        this.player.impulse((dx / l) * strength, strength * 0.35, (dz / l) * strength);
        this.shake = Math.min(1, this.shake + 0.3);
      },
      flash: (x, y, z, c, r, l) => this.atmosphere.lights.flash(x, y, z, c, r, l),
      shake: a => { this.shake = Math.min(1, this.shake + a); },
      killed: (c: Creature) => { if (c.def.boss) this.hud.message(`${c.def.name} has been defeated!`, '#c89aff'); },
      skyVisibility: (x, y, z) => this.sky.visibility(x, y, z),
      isNight: () => this.atmosphere.daylight < 0.3,
      biomeAt: (x, z) => this.gen.biomeAt(x, z),
      emberY: EMBER_Y,
      surfaceTop: (x, z) => this.sky.raw[Math.floor(x) + Math.floor(z) * this.sky.w],
      seaLevel: this.field.cfg.seaLevel,
      isLoaded: (x, z) => this.terrain.isLoaded(x, z),
      // Nothing spawns by a bed or door, or within the glow of a Hearth's fire.
      safeZone: (x, y, z) => this.furniture.near(x, y, z, 24).some(f => f.type === 'hearth' || ((f.type === 'bed' || f.type === 'door') && Math.hypot(f.x - x, f.y - y, f.z - z) < 18)),
      mushroomAt: (x, y, z) => this.gen.mushroomAt(x, y, z),
      inWater: (x, y, z) => this.waterLevelAt(x, y, z) !== null,
      inLava: (x, y, z) => this.lava.surfaceAt(x, y, z) !== null,
      activeEvent: () => (this.events.kind ? { kind: this.events.kind, target: this.events.target } : null),
      eventKill: () => this.onEventSignals(this.events.kill()),
    });
    this.scene.add(this.combat.group);
  }

  private setupInteraction() {
    this.interaction = new Interaction(this.field, this.structures, this.furniture, this.veg, this.inventory, this.player, this.log, {
      terrainEdited: (x, y, z, r) => this.onTerrainEdited(x, y, z, r),
      treeFelled: t => { this.onTreeFelled(t); this.audio.play('chop'); },
      treeHit: t => { this.wobble.set(t.id, 0); this.audio.play('chop'); },
      particles: (x, y, z, nx, ny, nz, c, n) => {
        this.particles.burst(x, y, z, nx, ny, nz, c, n);
        if (n >= 4) this.audio.play(c === 0x9a98a2 || c === 0x5a5470 ? 'stone' : 'mine');
      },
      message: (t, c) => this.hud.message(t, c),
      swing: () => { this.viewmodel.triggerSwing(); this.audio.play('swing'); },
      ghost: (m, p, v, r, t) => this.structureRenderer.showGhost(m, p, v, r, t),
      furnitureGhost: (t, p, v) => this.furnitureRenderer.showGhost(t, p, v),
      give: (id, n, x, y, z) => this.pickups.spawn(id, n, x, y, z),
      openChest: f => this.openChest(f),
      setSpawn: f => {
        this.spawnPoint = { x: f.x, y: f.y + 0.7, z: f.z };
        this.hud.message('Spawn point set', '#9fd0ff');
      },
      attack: def => this.attack(def),
      consume: def => this.consume(def),
      creatureHit: (o, d, r) => this.combat.rayHit(o, d, r),
      miningSpeed: () => this.stats.miningSpeed,
      interacted: () => this.audio.play('door'),
    });
  }

  // ==================================================================== actions

  private attack(def: ItemDef): number {
    const eye = this.camera.position, dir = this.dir;
    const w = def.weapon;
    if (!w) {
      // Tools swung at creatures.
      if (!def.tool) return 0;
      this.combat.melee(eye, dir, 2.6, def.tool.damage, 4);
      return def.tool.speed;
    }
    switch (w.type) {
      case 'melee': {
        this.viewmodel.triggerSwing(w.speed * 0.9);
        this.audio.play('swing');
        const dealt = this.combat.melee(eye, dir, w.reach ?? 2.6, w.damage, w.knockback);
        if (w.lifesteal && dealt > 0 && this.vitals.hp < this.vitals.maxHp) {
          const heal = Math.max(1, Math.round(Math.min(dealt, 60) * w.lifesteal));
          this.vitals.heal(heal);
          this.labels.add(this.player.x, this.player.y + 2, this.player.z, `+${heal}`, '#6aff8a');
        }
        // Slash trail.
        const trail = def.id === 'lumite_blade' ? 0x7af0ff : def.id === 'sanguine_blade' ? 0xff5a5a : 0xfff4d0;
        const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
        for (let i = 0; i < 6; i++) {
          const a = (i / 5 - 0.5) * 1.4;
          const p = eye.clone().addScaledVector(dir, 1.6).addScaledVector(side, Math.sin(a) * 1.1);
          p.y += Math.cos(a) * 0.4 - 0.3;
          this.particles.burst(p.x, p.y, p.z, dir.x, dir.y, dir.z, trail, 1, { speed: 0.6, size: 0.05, gravity: 0, life: 0.25 });
        }
        if (def.id === 'lumite_blade') this.atmosphere.lights.flash(eye.x + dir.x * 1.5, eye.y, eye.z + dir.z * 1.5, 0x46d0ff, 8, 0.2);
        return w.speed;
      }
      case 'bow': {
        const ammo = w.ammo!;
        if (!this.inventory.remove(ammo, 1)) { this.hud.message(`Out of ${item(ammo).name}s`, '#ffb070'); return 0.5; }
        const o = eye.clone().addScaledVector(dir, 0.6);
        const n = w.multishot ?? 1;
        const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
        for (let i = 0; i < n; i++) {
          const f = n > 1 ? (i / (n - 1) - 0.5) * 0.06 : 0;
          this.combat.fire('arrow', o.x, o.y - 0.1, o.z, dir.x + side.x * f, dir.y, dir.z + side.z * f, w.projectileSpeed!, w.damage, w.knockback);
        }
        this.viewmodel.triggerSwing(w.speed * 0.6);
        this.audio.play('bow');
        return w.speed;
      }
      case 'magic': {
        if (!this.vitals.useMana(w.manaCost ?? 5)) { this.hud.message('Not enough mana', '#8ab8ff'); return 0.3; }
        const o = eye.clone().addScaledVector(dir, 0.8);
        const boring = def.id === 'wyrmfang_staff', gale = def.id === 'tempest_staff';
        this.combat.fire(boring ? 'drill' : gale ? 'gust' : 'bolt', o.x, o.y - 0.15, o.z, dir.x, dir.y, dir.z, w.projectileSpeed!, w.damage, w.knockback);
        this.viewmodel.triggerSwing(w.speed);
        this.audio.play(gale ? 'gust' : 'magic');
        this.atmosphere.lights.flash(o.x, o.y, o.z, boring ? 0xc8ff90 : gale ? 0xe8f4ff : 0x46d0ff, 8, 0.15);
        return w.speed;
      }
      case 'thrown': {
        if (!this.inventory.remove(def.id, 1)) return 0;
        const o = eye.clone().addScaledVector(dir, 0.6);
        this.combat.fire('bomb', o.x, o.y, o.z, dir.x, dir.y, dir.z, w.projectileSpeed!, w.damage, w.knockback, w.blast ?? 3);
        this.viewmodel.triggerSwing(0.4);
        this.audio.play('swing');
        return w.speed;
      }
    }
    return 0;
  }

  private consume(def: ItemDef): boolean {
    if (def.id === 'hollow_horn') {
      const t = this.baseInfo();
      if (this.events.active) { this.hud.message(`${this.events.info!.name} is already under way!`, '#ffb070'); return false; }
      if (!t || Math.hypot(t.x - this.player.x, t.z - this.player.z) > 80) { this.hud.message('Sound the horn near your Hearth. It is the fire they want.', '#ffb070'); return false; }
      this.startEvent('raid');
      return true;
    }
    if (def.id === 'bucket' || def.id === 'water_bucket') {
      this.useBucket(def.id === 'water_bucket');
      return false;
    }
    if (def.id === 'gale_idol') {
      const p = this.player;
      if (this.combat.boss) { this.hud.message(`${this.combat.boss.name} is already here!`, '#ffb070'); return false; }
      if (p.y < 100 || this.sky.visibility(p.x, p.y + 1.5, p.z) < 0.6) { this.hud.message('The idol stays silent. Hold it up in the open sky, high above the land.', '#ffb070'); return false; }
      const a = p.yaw + Math.PI;
      this.combat.summonBoss(p.x + Math.sin(a) * 45, p.y + 24, p.z + Math.cos(a) * 45, 'roc');
      this.hud.message('A storm gathers... the Tempest Roc descends!', '#c89aff');
      this.audio.play('screech');
      return true;
    }
    if (def.id === 'wyrm_bait') {
      const underground = this.sky.visibility(this.player.x, this.player.y + 1.5, this.player.z) < 0.4;
      if (this.combat.boss) { this.hud.message(`${this.combat.boss.name} is already here!`, '#ffb070'); return false; }
      if (!underground && this.atmosphere.daylight > 0.3) { this.hud.message('Nothing answers in daylight. Try at night or underground.', '#ffb070'); return false; }
      this.combat.summonBoss(this.player.x + 12, Math.max(8, this.player.y - 26), this.player.z + 12);
      this.hud.message('The Deepwyrm stirs beneath you...', '#c89aff');
      this.shake = 1;
      this.audio.play('explode');
      return true;
    }
    if (def.grow) {
      const v = this.vitals;
      if (def.grow.life) {
        if (v.maxHp >= 400) { this.hud.message('Your health is already at its peak', '#ffb070'); return false; }
        v.maxHp += def.grow.life; v.hp = Math.min(v.maxHp, v.hp + def.grow.life);
        this.hud.message(`Max health increased to ${v.maxHp}`, '#ff8a9a');
      }
      if (def.grow.mana) {
        if (v.maxMana >= 200) { this.hud.message('Your mana is already at its peak', '#ffb070'); return false; }
        v.maxMana += def.grow.mana; v.mana = Math.min(v.maxMana, v.mana + def.grow.mana);
        this.hud.message(`Max mana increased to ${v.maxMana}`, '#8ab8ff');
      }
      this.particles.burst(this.player.x, this.player.y + 1.2, this.player.z, 0, 1, 0, def.grow.life ? 0xff9a3a : 0x6ac8ff, 24, { speed: 3, gravity: -1 });
      this.audio.play('magic');
      return true;
    }
    if (def.mana) {
      if (this.vitals.mana >= this.vitals.maxMana) { this.hud.message('Mana is already full', '#ffb070'); return false; }
      this.vitals.mana = Math.min(this.vitals.maxMana, this.vitals.mana + def.mana);
      this.labels.add(this.player.x, this.player.y + 2, this.player.z, `+${def.mana}`, '#7aa8ff');
      this.audio.play('drink');
      return true;
    }
    if (def.heal) {
      if (this.potionCooldown > 0) { this.hud.message(`Still queasy from the last elixir (${Math.ceil(this.potionCooldown)}s)`, '#ffb070'); return false; }
      if (this.vitals.hp >= this.vitals.maxHp) { this.hud.message('Already at full health', '#ffb070'); return false; }
      this.vitals.heal(def.heal);
      this.potionCooldown = 20;
      this.labels.add(this.player.x, this.player.y + 2, this.player.z, `+${def.heal}`, '#6aff8a');
      this.audio.play('drink');
      return true;
    }
    return false;
  }

  /**
   * Your base: the Hearths clustered around the one nearest the player
   * (within 150 m). The Cinder Siege marches on it.
   */
  baseInfo(): { x: number; z: number; size: number } | null {
    const px = this.player.x, pz = this.player.z;
    const hearths = [...this.furniture.items.values()].filter(f => f.type === 'hearth' && Math.hypot(f.x - px, f.z - pz) < 150);
    if (!hearths.length) return null;
    const anchor = hearths.reduce((a, h) => (Math.hypot(h.x - px, h.z - pz) < Math.hypot(a.x - px, a.z - pz) ? h : a));
    const cluster = hearths.filter(h => Math.hypot(h.x - anchor.x, h.z - anchor.z) < 40);
    return { x: cluster.reduce((a, h) => a + h.x, 0) / cluster.length, z: cluster.reduce((a, h) => a + h.z, 0) / cluster.length, size: cluster.length };
  }

  /** Open, dry ground near your spawn point (bed) where the merchant can camp. */
  campSpot(): { x: number; y: number; z: number } | null {
    const s = this.spawnPoint;
    for (let k = 0; k < 24; k++) {
      const a = k * 2.4, r = 7 + (k % 4) * 3;
      const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
      if (x < 4 || z < 4 || x > this.field.sx - 4 || z > this.field.sz - 4) continue;
      const hit = this.field.raycast(x, s.y + 30, z, 0, -1, 0, 60);
      if (!hit || hit.ny < 0.8 || Math.abs(hit.y - s.y) > 8) continue;
      if (this.waterLevelAt(x, hit.y + 0.3, z) !== null) continue;
      if (this.structures.near(x, hit.y, z, 3).length || this.furniture.near(x, hit.y, z, 3).length) continue;
      return { x, y: hit.y + 0.1, z };
    }
    return null;
  }

  /**
   * Surface height of the water the point is in (open sea or the liquid
   * grid), or null when dry.
   */
  waterLevelAt(x: number, y: number, z: number): number | null {
    const sea = this.field.cfg.seaLevel;
    const floor = this.gen.oceanFloor(x, z);
    if (floor !== null && y < sea && y > floor - 0.5) return sea;
    const top = this.water.surfaceAt(x, y, z);
    return top !== null && top > y ? top : null;
  }

  /** Scoop up a bucket of water, or pour one out where the player aims. */
  useBucket(full: boolean) {
    const eye = this.camera.position, d = this.dir;
    if (!full) {
      for (let t = 0.5; t < 5; t += 0.25) {
        const x = eye.x + d.x * t, y = eye.y + d.y * t, z = eye.z + d.z * t;
        if (this.field.sample(x, y, z) > 0) break;
        if (this.waterLevelAt(x, y, z) === null) continue;
        const got = this.water.take(Math.floor(x), Math.floor(y), Math.floor(z), 1);
        if (got < 0.5) continue;
        this.inventory.remove('bucket', 1);
        this.inventory.add('water_bucket', 1);
        this.audio.play('splash');
        this.particles.burst(x, y, z, 0, 1, 0, 0xcfe8ff, 10, { speed: 2 });
        return;
      }
      this.hud.message('There is no water there to scoop up', '#ffb070');
      return;
    }
    const hit = this.field.raycast(eye.x, eye.y, eye.z, d.x, d.y, d.z, 5, 0.1);
    const t = hit ? hit.distance - 0.4 : 3;
    const x = eye.x + d.x * t, y = eye.y + d.y * t, z = eye.z + d.z * t;
    const placed = this.water.add(Math.floor(x), Math.floor(y), Math.floor(z), 1);
    if (placed < 0.5) { this.hud.message('No room to pour the water there', '#ffb070'); if (placed > 0) this.water.take(Math.floor(x), Math.floor(y), Math.floor(z), placed); return; }
    this.inventory.remove('water_bucket', 1);
    this.inventory.add('bucket', 1);
    this.audio.play('splash');
  }

  /** Crater lakes, magma chambers and pools in the Ember Depths (for lights and the first fill). */
  private findLavaSources() {
    const g = this.gen, out: { x: number; y: number; z: number }[] = [];
    for (const v of g.volcanoes) {
      out.push({ x: v.x, y: v.lavaLevel + 1, z: v.z });
      out.push({ x: v.chamber.x, y: v.chamber.y - v.chamber.r * 0.3, z: v.chamber.z });
    }
    const rand = mulberry32(g.cfg.seed ^ 0x1a7a);
    const want = Math.round((g.size.x * g.size.z) / (512 * 512) * 14);
    for (let tries = 0, n = 0; n < want && tries < 2000; tries++) {
      const x = 24 + rand() * (g.size.x - 48), z = 24 + rand() * (g.size.z - 48);
      const fy = caveFloor(g, x, 8, z, EMBER_Y - 2);
      if (fy === null) continue;
      out.push({ x, y: fy + 0.5, z });
      n++;
    }
    return out;
  }

  /** Fill crater lakes, chamber floors and depth pools with lava (new worlds and older saves). */
  private fillInitialLava() {
    const g = this.gen;
    const bowl = (cx: number, cz: number, r: number, y0: number, level: number) => {
      for (let k = Math.floor(cz - r); k <= Math.ceil(cz + r); k++)
        for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
          if (Math.hypot(i + 0.5 - cx, k + 0.5 - cz) > r) continue;
          let supported = false;
          for (let j = Math.floor(y0); j <= Math.floor(level); j++) {
            const air = g.densityAt(i + 0.5, j + 0.5, k + 0.5) < 0;
            if (!air) { supported = true; continue; }
            if (!supported) break;
            this.lava.fill(i, j, k, Math.min(1, level - j));
          }
        }
    };
    for (const v of g.volcanoes) {
      bowl(v.x, v.z, v.rc * 1.2, v.floor - 3, v.lavaLevel);
      const c = v.chamber;
      bowl(c.x, c.z, c.r + 1, c.y - c.r - 1, c.y - c.r * 0.35);
    }
    for (const s of this.lavaSources.slice(g.volcanoes.length * 2)) bowl(s.x, s.z, 2.5, s.y - 2, s.y + 0.3);
    // Anything resting on a ledge the fill misjudged flows down on first visit.
    this.lava.wakeAll();
  }

  /**
   * Lava's effects each frame: it burns the player (thick and slow to wade
   * through), lights up its surroundings, and where it touches water both
   * turn to obsidian.
   */
  private updateLava(dt: number) {
    const p = this.player;
    // Glow: keep lights on the lava nearest the player.
    this.lavaLightTimer -= dt;
    if (this.lavaLightTimer <= 0) {
      this.lavaLightTimer = 0.5;
      const near = this.lavaSources.map((s, id) => ({ s, id, d: Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z) }))
        .filter(e => e.d < 70).sort((a, b) => a.d - b.d).slice(0, 2);
      const keep = new Set(near.map(e => e.id));
      for (const [id, light] of this.lavaLights) if (!keep.has(id)) { this.atmosphere.lights.remove(light); this.lavaLights.delete(id); }
      for (const e of near) if (!this.lavaLights.has(e.id))
        this.lavaLights.set(e.id, this.atmosphere.lights.add({ x: e.s.x, y: e.s.y + 2, z: e.s.z, color: new THREE.Color(0xff6a1a), range: 22, flicker: 0.6 }));
    }
    // Lava meeting water hardens into obsidian (a few cells per tick).
    this.lavaReact -= dt;
    if (this.lavaReact <= 0) {
      this.lavaReact = 0.25;
      let n = 0;
      for (const key of this.lava.cells.keys()) {
        const [i, j, k] = this.lava.unkey(key);
        if (Math.abs(i - p.x) > 80 || Math.abs(k - p.z) > 80) continue;
        const wet = [[0, 0, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]].find(([a, b, c]) => this.water.level(i + a, j + b, k + c) >= 0.2);
        if (!wet) continue;
        this.lava.take(i, j, k, 1);
        this.water.take(i + wet[0], j + wet[1], k + wet[2], 1);
        this.log.commit(this.field, 'add', i + 0.5, j + 0.5, k + 0.5, 0.95, Mat.Obsidian, 99);
        this.onTerrainEdited(i + 0.5, j + 0.5, k + 0.5, 1);
        this.particles.burst(i + 0.5, j + 1, k + 0.5, 0, 1, 0, 0xd8d8e0, 10, { speed: 2, gravity: -2, life: 1.2 });
        if (Math.hypot(i - p.x, k - p.z) < 30) this.audio.play('splash', Math.hypot(i - p.x, k - p.z));
        if (++n >= 6) break;
      }
    }
  }

  /** Fill the lakes and seed cave pools (new worlds only). */
  private fillInitialWater() {
    const g = this.gen;
    for (const l of g.lakes) {
      const R = Math.ceil(l.r * 1.3);
      for (let k = Math.floor(l.z - R); k <= Math.ceil(l.z + R); k++)
        for (let i = Math.floor(l.x - R); i <= Math.ceil(l.x + R); i++) {
          if (Math.hypot(i + 0.5 - l.x, k + 0.5 - l.z) > l.r * 1.25) continue;
          // Bottom-up so the water rests on the lake bed.
          let supported = false;
          for (let j = Math.floor(l.level - l.depth - 2); j <= Math.floor(l.level); j++) {
            const air = g.densityAt(i + 0.5, j + 0.5, k + 0.5) < 0;
            if (!air) { supported = true; continue; }
            if (!supported) break;
            this.water.fill(i, j, k, Math.min(1, l.level - j));
          }
        }
    }
    const rand = mulberry32(g.cfg.seed ^ 0x7a7e);
    const want = Math.round((g.size.x * g.size.z) / (512 * 512) * 26);
    let pools = 0;
    for (let tries = 0; pools < want && tries < 3000; tries++) {
      const x = 24 + rand() * (g.size.x - 48), z = 24 + rand() * (g.size.z - 48);
      const top = g.height(x, z) - 12;
      const y0 = 26 + Math.floor(rand() * Math.max(1, top - 26));
      const fy = caveFloor(g, x, y0, z, Math.min(top, y0 + 20));
      if (fy === null || g.mushroomAt(x, fy + 1, z) && rand() < 0.5) continue;
      const j = Math.floor(fy);
      for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++)
        for (let dj = 0; dj < 2; dj++) {
          const i = Math.floor(x) + di, k = Math.floor(z) + dk;
          if (g.densityAt(i + 0.5, j + dj + 0.5, k + 0.5) < 0) this.water.fill(i, j + dj, k, 1, true);
        }
      pools++;
    }
  }

  /** On clear nights stars streak down and land near the player as pickups. */
  /**
   * Starseeds: on clear nights seeds of light drift down from the stars like
   * dandelion seeds on the wind. Catch one in the air, or find it where it
   * lands. During a Sporefall, glowing spores fall instead.
   */
  private updateFallingStars(dt: number) {
    const night = this.atmosphere.daylight < 0.25 && this.events.kind !== 'sporefall';
    const outdoors = this.sky.visibility(this.player.x, this.player.y + 1.5, this.player.z) > 0.5;
    this.starTimer -= dt;
    if (night && outdoors && this.starTimer <= 0) {
      this.starTimer = 20 + Math.random() * 30;
      this.dropStar();
    }
    const p = this.player;
    for (let i = this.stars.length - 1; i >= 0; i--) {
      const st = this.stars[i];
      st.t += dt;
      // Lazy, looping drift: a steady wind plus a slow sway.
      const sway = Math.sin(st.t * 0.9 + st.vz) * 1.4;
      st.x += (st.vx + sway * 0.6) * dt; st.y += st.vy * dt; st.z += (st.vz + Math.cos(st.t * 0.7) * 0.8) * dt;
      if (Math.random() < 0.35) this.particles.burst(st.x, st.y, st.z, 0, -0.3, 0, Math.random() < 0.5 ? 0xbfe8ff : 0xffffff, 1, { speed: 0.3, size: 0.07, gravity: 0, life: 0.9 });
      if (Math.floor(st.t * 5) % 3 === 0) this.atmosphere.lights.flash(st.x, st.y, st.z, 0xbfe8ff, 12, 0.1);
      if (Math.hypot(st.x - p.x, st.y - (p.y + 1.1), st.z - p.z) < 1.8 && this.inventory.add('fallen_star', 1) === 0) {
        this.stars.splice(i, 1);
        this.hud.message('Caught a Starseed!', '#bfe8ff');
        this.particles.burst(st.x, st.y, st.z, 0, 1, 0, 0xbfe8ff, 18, { speed: 3, gravity: 0 });
        this.audio.play('magic');
        continue;
      }
      const inX = st.x > 2 && st.z > 2 && st.x < this.field.sx - 2 && st.z < this.field.sz - 2;
      const ground = inX ? this.sky.raw[Math.floor(st.x) + Math.floor(st.z) * this.sky.w] : -Infinity;
      if (st.y <= ground + 0.3 || st.t > 60) {
        this.stars.splice(i, 1);
        if (!inX) continue;
        this.pickups.spawn('fallen_star', 1, st.x, Math.max(st.y, ground) + 0.6, st.z, 0.5);
        this.particles.burst(st.x, ground + 0.5, st.z, 0, 1, 0, 0xbfe8ff, 16, { speed: 2.5 });
        this.atmosphere.lights.flash(st.x, ground + 1, st.z, 0xbfe8ff, 14, 0.5);
        this.audio.play('magic', Math.hypot(st.x - p.x, st.z - p.z));
      }
    }
    // Sporefall: glowing motes sift down around the player outdoors.
    const spores = this.atmosphere.sporeVisible;
    if (spores > 0.1 && outdoors) {
      for (let k = 0; k < 3; k++) {
        if (Math.random() > spores * dt * 30) continue;
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 16;
        this.particles.burst(p.x + Math.cos(a) * r, p.y + 4 + Math.random() * 10, p.z + Math.sin(a) * r, 0.3, -0.4, 0.1, Math.random() < 0.6 ? 0x7af0c8 : 0xd8ffb0, 1, { speed: 0.5, size: 0.06, gravity: 0.25, life: 5 });
      }
    }
  }

  /** Seconds of Rested left, progress toward resting, and the comfort level. */
  rested = 0;
  private restProgress = 0;
  comfort = 1;
  private comfortTimer = 0;
  private nearHearth = false;

  /**
   * Resting: under a roof (or underground) within reach of a lit Hearth, the
   * player becomes Rested after a few seconds; the rest lasts longer the more
   * comfortable the room is (see building/comfort.ts).
   */
  private updateRest(dt: number) {
    const p = this.player;
    this.rested = Math.max(0, this.rested - dt);
    this.comfortTimer -= dt;
    if (this.comfortTimer <= 0) {
      this.comfortTimer = 0.5;
      const info = comfortAt(this.furniture.near(p.x, p.y, p.z, COMFORT_RANGE), p.x, p.y + 0.5, p.z);
      const roof = this.structures.raycast(p.x, p.y + 1.7, p.z, 0, 1, 0, 8) !== null || this.sky.visibility(p.x, p.y + 1.7, p.z) < 0.35;
      this.nearHearth = info.hearth && roof && !this.vitals.dead;
      this.comfort = info.comfort;
    }
    if (!this.nearHearth) { this.restProgress = 0; this.hud.setRest(this.rested, this.comfort, null); return; }
    const full = restDuration(this.comfort);
    if (this.rested > 0) {
      // Already rested: sitting by the fire keeps it topped up.
      this.rested = Math.max(this.rested, full);
    } else {
      this.restProgress += dt;
      if (this.restProgress >= REST_TIME) {
        this.rested = full;
        this.restProgress = 0;
        this.hud.message(`You feel rested (comfort ${this.comfort})`, '#ffc890');
        this.audio.play('craft');
      }
    }
    this.hud.setRest(this.rested, this.comfort, this.rested > 0 ? null : this.restProgress / REST_TIME);
  }

  /** Announce a biome once the player has spent a moment in it, out under the sky. */
  private updateBiomeTitle(dt: number) {
    const p = this.player;
    if (this.sky.visibility(p.x, p.y + 1.5, p.z) < 0.5 || p.y > this.field.sy - 40) { this.biomeTime = 0; return; }
    const b = this.gen.biomeAt(p.x, p.z);
    if (b !== this.biomeNext) { this.biomeNext = b; this.biomeTime = 0; }
    this.biomeTime += dt;
    if (b !== this.biomeShown && this.biomeTime > 1.2) {
      this.biomeShown = b;
      this.hud.showBiome(BIOME_NAMES[b]);
    }
  }

  /** Keep real point lights on the few glowing mushrooms nearest the player. */
  private updateMushroomLights(dt: number) {
    this.mushTimer -= dt;
    if (this.mushTimer > 0) return;
    this.mushTimer = 0.5;
    const p = this.player;
    const near = this.veg.mushroomsNear(p.x, p.z, 40)
      .map(t => ({ t, d: Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z) }))
      .filter(e => e.d < 40).sort((a, b) => a.d - b.d).slice(0, 4).map(e => e.t);
    const keep = new Set(near.map(t => t.id));
    for (const [id, light] of this.mushLights) if (!keep.has(id)) { this.atmosphere.lights.remove(light); this.mushLights.delete(id); }
    for (const t of near) {
      if (this.mushLights.has(t.id)) continue;
      this.mushLights.set(t.id, this.atmosphere.lights.add({ x: t.x, y: t.y + t.height * 0.8, z: t.z, color: new THREE.Color(0x4af07a), range: 10 + t.height, flicker: 0.1 }));
    }
  }

  /** Launch a falling star that lands 15–45 m from the player. */
  dropStar() {
    // Starts high above a point near the player and drifts down over ~20 s.
    const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * 22;
    const wind = Math.random() * Math.PI * 2;
    const x = this.player.x + Math.cos(a) * d, z = this.player.z + Math.sin(a) * d;
    const y = Math.min(this.field.sy + 20, Math.max(this.player.y, this.gen.height(x, z)) + 40);
    this.stars.push({ x, y, z, vx: Math.cos(wind) * 0.9, vy: -2.1, vz: Math.sin(wind) * 0.9, t: 0 });
  }

  /** Start a world event right away (war horn, tests). */
  startEvent(kind: EventKind) {
    this.onEventSignals(this.events.start(kind, { base: this.baseInfo(), px: this.player.x, pz: this.player.z }));
  }

  private onEventSignals(signals: EventSignal[]) {
    for (const s of signals) {
      if (s.type === 'start') {
        if (s.kind === 'sporefall') {
          this.hud.message('Spores are falling from the sky...', '#7af0c8');
          this.audio.play('omen');
        } else {
          this.hud.message('The Cinderbound are coming for your fire!', '#ff9a4a');
          this.audio.play('horn');
          this.shake = Math.min(1, this.shake + 0.3);
        }
      } else if (s.type === 'end') {
        if (s.kind === 'sporefall') this.hud.message('The Sporefall settles. Dawn at last.', '#b0f0d8');
        else if (s.won) {
          const first = !this.progress.raidDefeated;
          this.progress.raidDefeated = true;
          this.combat.dismiss('raid');
          this.hud.message('The Cinder Siege is broken! The Cinderbound retreat to the mountains.', '#ffe08a');
          if (first) this.hud.message('The wandering merchant will hear of this. Expect rarer goods.', '#c89aff');
          const p = this.player;
          this.pickups.spawn('coin', 120, p.x, p.y + 1.5, p.z, 1.5);
          this.pickups.spawn('healing_potion', 3, p.x, p.y + 1.5, p.z, 1.5);
          this.audio.play('craft');
          writeSave(this.snapshot());
        } else {
          this.combat.dismiss('raid');
          this.hud.message('With no one to stop them, the Cinderbound carry off embers from your fire and leave.', '#ffb070');
        }
      }
    }
  }

  private hurtPlayer(amount: number, fx: number, fz: number, kb: number): number {
    const dealt = this.vitals.damage(amount, fx, fz, kb);
    if (!dealt) return 0;
    this.audio.play('hurt');
    this.hud.damageFlash(Math.min(1, dealt / 25 + 0.3));
    this.labels.add(this.player.x, this.player.y + 2.1, this.player.z, String(dealt), '#ff5a4a');
    this.shake = Math.min(1, this.shake + 0.35);
    if (Number.isFinite(fx) && kb > 0) {
      const dx = this.player.x - fx, dz = this.player.z - fz, l = Math.hypot(dx, dz) || 1;
      this.player.impulse((dx / l) * kb, kb * 0.55, (dz / l) * kb);
    }
    return dealt;
  }

  private blast(x: number, y: number, z: number, r: number) {
    const res = this.log.commit(this.field, 'sub', x, y, z, r, Mat.Air, 1);
    this.onTerrainEdited(x, y, z, r);
    // Blasted material drops as items.
    for (const [m, vol] of res.volumes) {
      const def = material(m);
      if (!def.drop || vol <= 0) continue;
      const n = Math.floor(vol / def.volumePerItem * 0.5);
      if (n > 0) this.pickups.spawn(def.drop, n, x, y, z, 5);
    }
  }

  private openChest(f: Placed) {
    this.invUI.chest = { slots: f.chest!, changed: () => {} };
    this.invUI.setOpen(true);
    this.input.unlock();
    this.audio.play('door');
  }

  // ==================================================================== helpers

  private refreshHeld() {
    const held = this.inventory.held;
    this.viewmodel.setItem(held?.id ?? null);
    this.hud.modeLabel = held && (item(held.id).kind !== 'tool' || item(held.id).hammer) ? this.interaction.modeLabel() : '';
    this.hud.render();
    if (!this.holdingHammer && this.buildMenu?.open) this.toggleBuildMenu(false);
    this.onHeldChange?.(this.holdingHammer);
  }

  /** Called when what the player holds changes (touch controls show the rotate button). */
  onHeldChange: ((hammer: boolean) => void) | null = null;

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

  private onTerrainEdited(x: number, y: number, z: number, r: number) {
    this.water.wake(x, y, z, r + 1.5);
    this.lava.wake(x, y, z, r + 1.5);
    const pad = r + 1;
    this.markSky(x - pad, z - pad, x + pad, z + pad);
    this.veg.invalidateTufts(x, z, r + 1);
    for (const t of this.veg.unsupportedTrees(x, z, r)) {
      // Undermined trees topple and drop their wood.
      t.alive = false;
      this.onTreeFelled(t);
      this.pickups.spawn(t.kind === 'mushroom' ? 'glowcap' : 'wood', Math.round(t.height / 2) + 2, t.x, t.y + 1, t.z);
      this.particles.burst(t.x, t.y + t.height * 0.8, t.z, 0, 1, 0, 0x3f9a55, 24);
    }
    // Mesh edited chunks immediately for responsive feedback.
    this.terrain.remeshDirty(8);
  }

  private onTreeFelled(t: Tree) {
    this.vegRenderer.removeTree();
    this.wobble.delete(t.id);
    // Occasionally a mushroom grows at the stump.
    if (t.kind !== 'mushroom' && Math.random() < 0.25) this.pickups.spawn('red_cap', 1, t.x, t.y + 0.5, t.z);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post?.resize();
  }

  /** Called once per rendered frame (UI overlays). */
  onFrame: (() => void) | null = null;

  start() {
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      this.onFrame?.();
      const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
      this.lastFrame = now;
      if (this.manual) return;
      const t0 = performance.now();
      if (!this.paused) this.update(dt);
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
      extra: {
        chunks: this.field.cfg.chunksX,
        caves: this.field.cfg.caves ?? 1,
        build: this.interaction.build,
        rested: this.rested,
        timeOfDay: this.atmosphere.timeOfDay,
        furniture: this.furniture.serialize(),
        equipment: this.equipment.serialize(),
        spawn: this.spawnPoint,
        hp: this.vitals.hp,
        maxHp: this.vitals.maxHp,
        maxMana: this.vitals.maxMana,
        merchant: this.merchant.serialize(),
        progress: this.progress,
        events: this.events.serialize(),
        water: this.water.serialize(),
        lava: this.lava.serialize(),
      },
    };
  }

  get inventoryOpen() { return this.invUI.open; }
  /** Any menu that needs the mouse cursor (inventory, dialogue). */
  get menuOpen() { return this.invUI.open || this.dialogue.open || this.buildMenu.open; }
  /** Holding the Builder's Hammer. */
  get holdingHammer() { const h = this.inventory.held; return !!h && !!item(h.id).hammer; }

  npcContext(): NpcContext {
    return {
      inv: this.inventory,
      kills: this.combat.kills,
      bossDefeated: this.progress.bossDefeated,
      raidDefeated: this.progress.raidDefeated,
      rocDefeated: this.progress.rocDefeated,
      isNight: this.atmosphere.daylight < 0.3,
      event: this.events.info?.name ?? null,
      hasStation: id => [...this.furniture.items.values()].some(f => f.type === id),
    };
  }

  // ------------------------------------------------------------ tools / tests

  /** Craft by output id using nearby stations (returns false if not possible). */
  craftItem(id: string): boolean {
    const st = this.furniture.stationsNear(this.player.x, this.player.y + 1, this.player.z);
    const r = RECIPES.find(x => x.out === id && canCraft(x, this.inventory, st));
    return !!r && craft(r, this.inventory, st);
  }

  spawnCreature(id: string, x: number, y: number, z: number) {
    return this.combat.spawn(CREATURES[id], x, y, z);
  }

  toggleInventory(open = !this.invUI.open) {
    this.invUI.setOpen(open);
    if (open) this.input.unlock(); else this.input.lock();
  }

  /** [Q] / the touch build button: with the Builder's Hammer, open or close the build menu. */
  cycleBuildMode() {
    if (!this.holdingHammer && !this.buildMenu.open) return;
    this.toggleBuildMenu();
  }

  toggleBuildMenu(open = !this.buildMenu.open) {
    if (open && this.invUI.open) this.toggleInventory(false);
    this.buildMenu.setOpen(open);
    // (Closing re-locks the pointer through the menu's onClose.)
    if (open) this.input.unlock();
  }

  /** Enter or leave the title screen (the world keeps drawing behind it). */
  setMenuMode(on: boolean) {
    this.menuMode = on;
    this.viewmodel.root.visible = !on;
    if (on) {
      this.combat.clear();
      if (this.invUI.open) this.invUI.setOpen(false);
      if (this.buildMenu.open) this.buildMenu.setOpen(false);
      if (this.dialogue.open) this.dialogue.close();
      this.menuT = Math.random() * 100;
    } else {
      this.camera.rotation.order = 'YXZ';
    }
  }

  /** Apply player settings (quality applies on the next load). */
  applySettings(s: { fov: number; sensitivity: number; invertY: boolean; volume: number; showFps: boolean }) {
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.input.sensitivity = (this.input.touchMode ? 0.0042 : 0.0022) * s.sensitivity;
    this.invertY = s.invertY;
    this.audio.setVolume(s.volume);
    this.hud.showFps = s.showFps;
  }

  /** Title screen: a slow cinematic orbit above spawn, looking out over the land. */
  private updateMenu(dt: number) {
    this.time += dt;
    this.menuT += dt;
    const s = this.gen.spawn, sea = this.field.cfg.seaLevel;
    const a = this.menuT * 0.03;
    const r = 52;
    const cx = s.x + Math.cos(a) * r, cz = s.z + Math.sin(a) * r;
    let ground = sea;
    for (const [ox, oz] of [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]]) ground = Math.max(ground, this.gen.height(cx + ox, cz + oz));
    const cam = this.camera;
    cam.position.set(cx, Math.min(this.field.sy - 8, ground + 34 + Math.sin(this.menuT * 0.2) * 2), cz);
    const ta = a + 1.35;
    const tx = s.x + Math.cos(ta) * 140, tz = s.z + Math.sin(ta) * 140;
    cam.lookAt(tx, Math.max(sea, this.gen.height(tx, tz)) + 14, tz);
    cam.updateMatrixWorld();
    const dir = this.dir.set(0, 0, -1).applyQuaternion(cam.quaternion);

    this.terrain.update(cam.position, 3);
    this.vegRenderer.update(cam.position, dt);
    this.structureRenderer.update();
    this.furnitureRenderer.update(dt, cam.position);
    this.waterRenderer.update(dt, cam.position);
    this.lavaRenderer.update(dt, cam.position);
    this.flushSky();
    const vis = this.sky.visibility(cam.position.x, cam.position.y, cam.position.z);
    this.atmosphere.underwater = 0;
    this.atmosphere.update(dt, cam.position, vis, this.time, cam.position, dir, 0, 0, 0);
    this.post.setUnderground(this.atmosphere.underground);
    this.post.setNight(1 - this.atmosphere.daylight);
    this.post.setSpore(this.atmosphere.sporeVisible);
    this.post.setWater(0);
    this.particles.update(dt, this.atmosphere.ambientAt(vis));
    this.input.endFrame();
  }

  private handleKeys() {
    const inp = this.input;
    for (let i = 0; i < HOTBAR; i++) if (inp.wasPressed(`Digit${i + 1}`)) this.inventory.select(i);
    if (inp.wheel && !this.invUI.open) this.inventory.select(this.inventory.selected + inp.wheel);
    if (inp.wasPressed('KeyQ')) this.cycleBuildMode();
    if (inp.wasPressed('KeyR') && this.holdingHammer) { this.interaction.rotate(); this.refreshHeld(); }
    this.interaction.free = this.holdingHammer && !this.input.touchMode && !!(inp.keys.has('ShiftLeft') || inp.keys.has('ShiftRight'));
    if (inp.wasPressed('F3')) this.hud.debugVisible = !this.hud.debugVisible;
    if (inp.wasPressed('F5')) this.saveGame();
    if (inp.wasPressed('F9')) location.href = `${location.pathname}?continue=1`;
    if (this.buildMenu.open && (inp.wasPressed('Escape') || inp.wasPressed('Tab'))) { this.toggleBuildMenu(false); return; }
    if (inp.wasPressed('Tab') || inp.wasPressed('KeyE')) { if (this.dialogue.open) this.dialogue.close(); this.toggleInventory(); }
  }

  // ===================================================================== update

  update(dt: number) {
    if (this.menuMode) { this.updateMenu(dt); return; }
    this.time += dt;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
    const inp = this.input;
    const alive = !this.vitals.dead;
    const active = inp.locked && !this.menuOpen && alive;
    this.handleKeys();
    this.potionCooldown = Math.max(0, this.potionCooldown - dt);

    // Equipment-derived stats.
    const st = this.stats;
    this.player.speedMul = st.moveSpeed;
    this.player.extraJumps = st.extraJumps;
    this.player.flightTime = st.flight;
    this.vitals.defense = st.defense;
    this.updateRest(dt);
    this.vitals.regenBonus = st.regen + (this.rested > 0 ? 2 : 0);
    this.vitals.manaRegenMul = this.rested > 0 ? 1.5 : 1;

    // Look.
    if (active) {
      this.player.yaw -= inp.mouseDX * inp.sensitivity;
      this.player.pitch = Math.max(-1.55, Math.min(1.55, this.player.pitch - inp.mouseDY * inp.sensitivity * (this.invertY ? -1 : 1)));
    }
    // Move.
    const k = (c: string) => (active && inp.down(c) ? 1 : 0);
    const axisF = active ? inp.axisForward : 0, axisS = active ? inp.axisStrafe : 0;
    const waterHere = this.waterLevelAt(this.player.x, this.player.y + 0.3, this.player.z);
    // Lava: thick to wade through, and it burns unless you wear Ember armor.
    const lavaHere = this.lava.surfaceAt(this.player.x, this.player.y + 0.3, this.player.z);
    if (lavaHere !== null) {
      this.player.speedMul *= 0.45;
      if (alive && !st.lavaProof) {
        this.hurtPlayer(16, NaN, NaN, 0);
        if (this.time - this.burnWarned > 4) { this.burnWarned = this.time; this.hud.message('The lava burns!', '#ff8a3a'); }
        if (Math.random() < dt * 20) this.particles.burst(this.player.x, lavaHere, this.player.z, 0, 1, 0, Math.random() < 0.5 ? 0xff7a2a : 0xffd060, 2, { speed: 2, gravity: 4, life: 0.6 });
      }
    }
    // Grappling hook (F): fire / release; jump releases; back key pays out rope.
    const hook = st.hook;
    if (!hook && this.grapple.state !== 'idle') this.grapple.release();
    if (hook && active && inp.wasPressed('KeyF')) {
      if (this.grapple.state === 'idle') {
        this.grapple.range = hook.range; this.grapple.speed = hook.speed;
        this.grapple.fire(this.camera.position.x, this.camera.position.y - 0.2, this.camera.position.z, this.dir.x, this.dir.y, this.dir.z);
        this.audio.play('bow');
      } else this.grapple.release();
    }
    if (this.grapple.state === 'attached' && active && inp.wasPressed('Space')) { this.grapple.release(true); this.audio.play('jump'); }
    const handX = this.player.x, handY = this.player.y + 1.1, handZ = this.player.z;
    const wasAttached = this.grapple.state === 'attached';
    this.grapple.update(dt, k('KeyS') ? -1 : 1, handX, handY, handZ);
    if (!wasAttached && this.grapple.state === 'attached') {
      this.audio.play('stone');
      this.particles.burst(this.grapple.x, this.grapple.y, this.grapple.z, 0, 1, 0, 0xd0d0d8, 6, { speed: 2 });
    }
    if (alive) {
      this.player.update(dt, {
        forward: Math.max(-1, Math.min(1, k('KeyW') - k('KeyS') + axisF)),
        strafe: Math.max(-1, Math.min(1, k('KeyD') - k('KeyA') + axisS)),
        jump: !!k('Space'),
        sprint: !!(k('ShiftLeft') || k('ShiftRight')),
        crouch: !!k('KeyC'),
      }, waterHere ?? lavaHere);
      // Splash on entering water, and breath while the head is under.
      if (this.player.inWater && !this.wasInWater && this.player.vy < -4) {
        this.particles.burst(this.player.x, waterHere ?? this.player.y, this.player.z, 0, 1, 0, 0xcfe8ff, 18, { speed: 4 });
        this.audio.play('splash');
      }
      this.wasInWater = this.player.inWater;
      if (this.player.flying || this.player.gliding) {
        // Feathers shed from the wings.
        this.flapTimer -= dt;
        if (this.flapTimer <= 0) {
          this.flapTimer = this.player.flying ? 0.28 : 0.6;
          this.audio.play('flap');
          const side = new THREE.Vector3(-this.dir.z, 0, this.dir.x).normalize();
          for (const sx of [-1, 1]) this.particles.burst(this.player.x + side.x * sx * 0.7, this.player.y + 1.2, this.player.z + side.z * sx * 0.7, 0, -1, 0, 0xf0f4fa, 3, { speed: 1.5, gravity: 1.5, size: 0.06, life: 0.7 });
        }
      } else this.flapTimer = 0;
      if (this.player.airJumped) {
        this.particles.burst(this.player.x, this.player.y, this.player.z, 0, -1, 0, 0xe8f4ff, 12, { speed: 3, gravity: 2 });
        this.audio.play('jump');
      }
      if (this.player.landingImpact > 0) {
        const dealt = this.vitals.land(this.player.landingImpact, st.noFallDamage);
        if (dealt) {
          this.audio.play('hurt');
          this.hud.damageFlash(0.6);
          this.labels.add(this.player.x, this.player.y + 2.1, this.player.z, String(dealt), '#ff5a4a');
        } else if (this.player.landingImpact > 8) this.audio.play('land');
      }
    }
    if (this.player.y < -10) this.player.teleport(this.spawnPoint.x, this.spawnPoint.y + 2, this.spawnPoint.z);

    // Breath: the head underwater drains it, then drowning hurts.
    {
      const head = this.player.y + this.player.eyeHeight;
      const lvl = this.waterLevelAt(this.player.x, head, this.player.z);
      const under = alive && lvl !== null && head < lvl;
      if (under) {
        this.breath = Math.max(0, this.breath - dt);
        if (this.breath <= 0) {
          this.drownTimer -= dt;
          if (this.drownTimer <= 0) { this.drownTimer = 1; this.hurtPlayer(10, NaN, NaN, 0); }
        }
      } else { this.breath = Math.min(this.maxBreath, this.breath + dt * 4); this.drownTimer = 0; }
    }
    // Death and respawn.
    this.vitals.update(dt);
    if (this.vitals.dead) {
      if (!this.deathShown) {
        this.deathShown = true;
        this.hud.message('You were slain', '#ff5a4a');
        this.audio.play('die');
        this.particles.burst(this.player.x, this.player.y + 1, this.player.z, 0, 1, 0, 0xb02030, 30, { speed: 5 });
        // Drop half the coins where you fell.
        const coins = Math.floor(this.inventory.count('coin') / 2);
        if (coins > 0 && this.inventory.remove('coin', coins)) this.pickups.spawn('coin', coins, this.player.x, this.player.y + 1, this.player.z);
      }
      if (this.vitals.respawnTimer <= 0) {
        this.vitals.respawn();
        this.player.teleport(this.spawnPoint.x, this.spawnPoint.y + 0.5, this.spawnPoint.z);
        this.deathShown = false;
      }
    }

    // Camera (with damage/explosion shake).
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const sh = this.shake * this.shake * 0.25;
    const eyeY = this.vitals.dead ? 0.3 : this.player.eyeHeight;
    this.camera.position.set(this.player.x + (Math.random() - 0.5) * sh, this.player.y + eyeY + (Math.random() - 0.5) * sh, this.player.z + (Math.random() - 0.5) * sh);
    this.guardCamera();
    this.camera.rotation.set(this.player.pitch, this.player.yaw, this.vitals.dead ? 0.6 : 0, 'YXZ');
    this.camera.updateMatrixWorld();
    const dir = this.dir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);

    // Talk to NPCs (right-click), otherwise regular interaction.
    let alt = active && inp.consumeAlt();
    const npcAim = this.merchant.pick(this.camera.position, dir, 4.5);
    if (alt && npcAim) {
      this.dialogue.show(npcAim);
      this.input.unlock();
      alt = false;
    }
    if (this.dialogue.open && this.dialogue.npc && Math.hypot(this.dialogue.npc.body.x - this.player.x, this.dialogue.npc.body.z - this.player.z) > 7) this.dialogue.close();
    this.interaction.update(dt, this.camera.position, dir, active && inp.lmb, active && inp.consumeClick(), alt);
    const held = this.inventory.held;
    if (held && (item(held.id).kind !== 'tool' || item(held.id).hammer)) {
      const label = this.interaction.modeLabel();
      if (label !== this.hud.modeLabel) { this.hud.modeLabel = label; this.hud.render(); }
    }
    this.updatePrompt();
    if (this.invUI.open) {
      this.invUI.setStations(this.furniture.stationsNear(this.player.x, this.player.y + 1, this.player.z));
      // Walking away from an open chest closes it.
      const ch = this.invUI.chest;
      if (ch && !this.furniture.near(this.player.x, this.player.y, this.player.z, 5).some(f => f.chest === ch.slots)) {
        this.invUI.chest = null;
        this.invUI.render();
      }
    }

    // Water: wake after building changes, then simulate at a fixed rate.
    if (this.structures.version !== this.structVersion || this.furniture.version !== this.furnVersion) {
      if (this.structVersion >= 0) { this.water.wake(this.player.x, this.player.y, this.player.z, 10); this.lava.wake(this.player.x, this.player.y, this.player.z, 10); }
      this.structVersion = this.structures.version; this.furnVersion = this.furniture.version;
    }
    this.waterAcc = Math.min(0.2, this.waterAcc + dt);
    while (this.waterAcc >= 1 / 15) { this.waterAcc -= 1 / 15; this.water.step(2500, this.player.x, this.player.z, 90); }
    this.waterRenderer.update(dt, this.camera.position);
    // Lava creeps: a third of water's pace, and it stops in thick tongues.
    this.lavaAcc += dt;
    while (this.lavaAcc >= 1 / 5) { this.lavaAcc -= 1 / 5; this.lava.step(900, this.player.x, this.player.z, 90); }
    this.lavaRenderer.update(dt, this.camera.position);
    this.updateLava(dt);

    // World streaming + updates.
    this.terrain.update(this.camera.position, 3);
    this.vegRenderer.update(this.camera.position, dt);
    this.structureRenderer.update();
    this.furnitureRenderer.update(dt, this.camera.position);
    {
      // Rope from the right hand to the hook head.
      const side = new THREE.Vector3(-this.dir.z, 0, this.dir.x).normalize();
      const hx = this.camera.position.x + side.x * 0.3 + this.dir.x * 0.4, hy = this.camera.position.y - 0.35, hz = this.camera.position.z + side.z * 0.3 + this.dir.z * 0.4;
      this.rope.update(this.grapple.state !== 'idle', hx, hy, hz, this.grapple.x, this.grapple.y, this.grapple.z);
    }
    this.updateFallingStars(dt);
    this.updateMushroomLights(dt);
    this.pickups.update(dt, this.player.x, this.player.y, this.player.z);
    this.onEventSignals(this.events.update(dt, {
      daylight: this.atmosphere.daylight, px: this.player.x, pz: this.player.z, base: this.baseInfo(), bossDefeated: this.progress.bossDefeated,
    }));
    const ev = this.events.kind;
    this.combat.spawnBoost = ev === 'sporefall' ? 1.8 : ev === 'raid' ? 1.6 : 1;
    this.atmosphere.sporeTarget = ev === 'sporefall' ? 1 : 0;
    this.combat.update(dt, this.player.x, this.player.y, this.player.z, this.time, this.player.vx, this.player.vz);
    const isDay = this.atmosphere.daylight >= 0.3;
    const dawn = this.wasDaylight === false && isDay, dusk = this.wasDaylight === true && !isDay;
    this.wasDaylight = isDay;
    this.merchant.update(dt, this.events.nights + 1, dawn, dusk, this.field.cfg.seed, this.progress, () => this.campSpot(), this.player.x, this.player.z, !isDay);
    this.flushSky();
    for (const [id, t] of this.wobble) {
      const nt = t + dt;
      this.vegRenderer.wobbleTree(id, nt);
      if (nt > 0.4) this.wobble.delete(id); else this.wobble.set(id, nt);
    }

    // Atmosphere.
    const cam = this.camera.position;
    const vis = this.sky.visibility(cam.x, cam.y, cam.z);
    const ember = THREE.MathUtils.smoothstep(EMBER_Y + 14 - cam.y, 0, 12);
    const shroom = this.gen.mushroomAt(cam.x, cam.y, cam.z) ? 1 : 0;
    const camWater = this.waterLevelAt(cam.x, cam.y, cam.z);
    this.atmosphere.underwater = camWater !== null && cam.y < camWater ? 1 : 0;
    // A torch in hand throws a brighter, wider light than the bare lantern glow.
    const torchLight = this.inventory.held?.id === 'torch' ? 1.2 : 0;
    this.atmosphere.update(dt, cam, vis, this.time, this.player.position, dir, st.lightBoost + torchLight, ember, shroom);
    // Drifting embers in the depths.
    if (ember > 0.3 && Math.random() < ember * 0.6) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 10;
      this.particles.burst(cam.x + Math.cos(a) * r, cam.y - 2 + Math.random() * 3, cam.z + Math.sin(a) * r, 0, 1, 0, Math.random() < 0.5 ? 0xff8a30 : 0xffc050, 1, { speed: 0.6, size: 0.04, gravity: -0.6, life: 2.5 });
    }
    this.post.setUnderground(this.atmosphere.underground);
    this.post.setNight(1 - this.atmosphere.daylight);
    this.post.setSpore(this.atmosphere.sporeVisible);
    this.post.setWater(this.atmosphere.underwater);
    const moving = Math.min(1, Math.hypot(this.player.vx, this.player.vz) / 5) * (this.player.grounded ? 1 : 0);
    const ambient = this.atmosphere.ambientAt(vis);
    this.viewmodel.update(dt, moving, Math.max(ambient, 0.25 + this.atmosphere.underground * 0.25));
    this.particles.update(dt, ambient);
    this.updateFlames(dt);

    // HUD.
    this.hud.update(dt);
    const boss = this.combat.boss;
    this.hud.setBoss(boss ? boss.name : null, boss?.hp ?? 0, boss?.maxHp ?? 1);
    this.hud.setEvent(this.events.info, this.events.progress, this.events.goal);
    this.hud.setVitals(this.vitals.hp, this.vitals.maxHp, this.vitals.mana, this.vitals.maxMana, this.vitals.defense);
    const pl = this.player;
    this.hud.setBreath(this.breath < this.maxBreath - 0.05 ? this.breath / this.maxBreath : null);
    this.updateBiomeTitle(dt);
    this.hud.setFlight(pl.flightTime > 0 && !pl.grounded && !this.vitals.dead ? pl.flightLeft / pl.flightTime : null);
    this.labels.update(dt, this.camera, window.innerWidth, window.innerHeight);
    this.minimap.draw(this.player.x, this.player.z, this.player.yaw, this.combat.creatures.map(c => ({ x: c.x, z: c.z, color: '#ff5a4a' })));
    const hours = this.atmosphere.timeOfDay * 24;
    this.hud.setClock(hours, this.atmosphere.daylight > 0.3, ev === 'sporefall', this.events.nights + 1);
    this.hud.setDeath(this.vitals.dead, this.vitals.respawnTimer);
    this.hud.setFps(this.fps);
    if (this.hud.debugVisible) {
      const s2 = this.terrain.stats, vc = this.vegRenderer.counts;
      this.hud.setDebug(
        `fps ${this.fps.toFixed(0)}  frame ${this.frameMs.toFixed(1)}ms\n` +
        `pos ${this.player.x.toFixed(1)} ${this.player.y.toFixed(1)} ${this.player.z.toFixed(1)}  sky ${vis.toFixed(2)}\n` +
        `terrain ${s2.meshes} meshes ${(s2.tris / 1000).toFixed(0)}k tris, ${s2.resident} chunks, ${s2.nodes} lod, ${s2.pending} jobs\n` +
        `trees ${vc.near}+${vc.far}  grass ${vc.grass}  calls ${this.renderer.info.render.calls}  tris ${(this.renderer.info.render.triangles / 1000).toFixed(0)}k\n` +
        `creatures ${this.combat.creatures.length}  pickups ${this.pickups.count}  lights ${this.atmosphere.lights.count}  edits ${this.log.edits.length}`,
      );
    } else this.hud.setDebug('');

    this.autosave += dt;
    if (this.autosave > 60) {
      this.autosave = 0;
      writeSave(this.snapshot());
    }

    inp.endFrame();
  }

  private updatePrompt() {
    const aim = this.interaction.aim;
    let text = '';
    const npc = this.merchant.pick(this.camera.position, this.dir, 4.5);
    if (npc) { this.hud.setPrompt(`[RMB] Talk to ${npc.def.name} ${npc.def.title}`); return; }
    if (aim?.kind === 'furniture' && aim.distance < 5) {
      const f = aim.hit.f;
      if (f.type === 'door') text = `[RMB] ${f.open ? 'Close' : 'Open'} door`;
      else if (f.type === 'chest') text = '[RMB] Open chest';
      else if (f.type === 'bed') text = '[RMB] Set spawn point';
      else if (f.type === 'workbench' || f.type === 'furnace' || f.type === 'anvil' || f.type === 'forge') text = '[Tab] Craft here';
    }
    this.hud.setPrompt(text);
  }

  /** Flickering tongues of fire rising from nearby torches, hearths and furnaces. */
  private updateFlames(dt: number) {
    const p = this.player;
    this.fireScan -= dt;
    if (this.fireScan <= 0) {
      this.fireScan = 0.25;
      this.fires = [];
      for (const f of this.furniture.near(p.x, p.y, p.z, 28)) {
        const size = f.type === 'torch' ? 1 : f.type === 'hearth' ? 2.6 : f.type === 'furnace' ? 1.8 : 0;
        const lp = size ? lightPoint(f) : null;
        if (lp) this.fires.push([lp[0], lp[1] - (f.type === 'torch' ? 0.1 : 0), lp[2], size]);
      }
    }
    // The torch in your hand burns too.
    if (this.viewmodel.flamePoint(this.flameAt)) {
      const f = this.flameAt;
      if (Math.random() < dt * 12) this.flames.burst(f.x, f.y, f.z, 0, 1, 0, Math.random() < 0.5 ? 0xffd25a : 0xff8a2a, 1, { speed: 0.35, size: 0.022, gravity: -1, life: 0.3 });
    }
    // Lava spits embers and now and then a molten pop.
    this.lavaScan -= dt;
    if (this.lavaScan <= 0) {
      this.lavaScan = 1;
      this.lavaTop = [];
      for (const key of this.lava.cells.keys()) {
        const [i, j, k] = this.lava.unkey(key);
        if (Math.abs(i - p.x) > 32 || Math.abs(k - p.z) > 32 || Math.abs(j - p.y) > 24) continue;
        const l = this.lava.level(i, j, k);
        if (l < 0.2 || this.lava.level(i, j + 1, k) > 0.05) continue;
        this.lavaTop.push([i, j + l, k]);
      }
    }
    const tops = this.lavaTop;
    if (tops.length) {
      for (let n = Math.min(40, tops.length * 0.25) * dt; n > 0; n--) {
        if (n < 1 && Math.random() > n) break;
        const [i, y, k] = tops[Math.floor(Math.random() * tops.length)];
        const pop = Math.random() < 0.08;
        this.flames.burst(i + Math.random(), y + 0.05, k + Math.random(), 0, 1, 0, pop ? 0xff5418 : Math.random() < 0.5 ? 0xffc050 : 0xff8a30, pop ? 5 : 1,
          pop ? { speed: 2.2, size: 0.07, gravity: 9, life: 0.7 } : { speed: 0.9, size: 0.035, gravity: -0.7, life: 1.4 });
      }
    }
    for (const [x, y, z, size] of this.fires) {
      if (Math.random() > dt * 14 * size) continue;
      const c = Math.random();
      this.flames.burst(x + (Math.random() - 0.5) * 0.06 * size, y, z + (Math.random() - 0.5) * 0.06 * size, 0, 1, 0,
        c < 0.4 ? 0xffd25a : c < 0.8 ? 0xff8a2a : 0xff5418, 1, { speed: 0.55, size: 0.045 * Math.sqrt(size), gravity: -1.2, life: 0.42 });
    }
    this.flames.update(dt, 1);
  }

  /**
   * Keep the eye out of solid ground: it sits above the body's top sphere, so
   * a wall leaning in at head height could otherwise slip inside the near
   * plane and show the caves behind it. Nudges the view only, not the body.
   */
  private guardCamera() {
    const c = this.camera.position, n = this.camN, CLEAR = 0.24;
    for (let k = 0; k < 2; k++) {
      const d = this.collision.distance(c.x, c.y, c.z, n);
      if (d >= CLEAR) break;
      const m = Math.min(CLEAR - d, 0.45);
      c.x += n[0] * m; c.y += n[1] * m; c.z += n[2] * m;
    }
  }

  render() {
    this.renderer.info.reset();
    this.post.render(this.scene, VIEWMODEL_LAYER);
  }
}

function tick() {
  return new Promise(r => setTimeout(r, 0));
}

/** Breadth-first distance (in columns) from every column to the nearest ocean column. */
function coastDistance(w: number, d: number, ocean: (x: number, z: number) => boolean): Uint16Array {
  const dist = new Uint16Array(w * d).fill(65535);
  const queue = new Int32Array(w * d);
  let head = 0, tail = 0;
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (ocean(x, z)) { dist[x + z * w] = 0; queue[tail++] = x + z * w; }
  while (head < tail) {
    const c = queue[head++], x = c % w, z = (c - x) / w, nd = dist[c] + 1;
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) {
      if (nx < 0 || nz < 0 || nx >= w || nz >= d) continue;
      const n = nx + nz * w;
      if (dist[n] > nd) { dist[n] = nd; queue[tail++] = n; }
    }
  }
  return dist;
}

export function savedGame() {
  return readSave();
}
