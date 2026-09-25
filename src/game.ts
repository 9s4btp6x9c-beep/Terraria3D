// Game: owns the world, player and presentation systems and runs the loop.

import * as THREE from 'three';
import { Audio } from './audio/sfx';
import { FurnitureSet, type Placed } from './building/furniture';
import { Structures } from './building/structures';
import { Combat } from './entities/combat';
import type { NpcContext } from './entities/npcs';
import { Town } from './entities/town';
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
import { Viewmodel } from './render/viewmodel';
import { type WorldUniforms, createSkyTexture, createWorldMaterial, createWorldUniforms, updateSkyTexture } from './render/worldMaterial';
import { Hud } from './ui/hud';
import { DialogueUI } from './ui/dialogue';
import { InventoryUI } from './ui/inventoryUI';
import { Minimap } from './ui/minimap';
import { type Quality, detectQuality } from './ui/quality';
import { WorldLabels } from './ui/worldLabels';
import { WorldCollision } from './world/collision';
import { defaultConfig } from './world/config';
import { EMBER_Y, WorldGenerator } from './world/generator';
import { Mat, material } from './world/materials';
import { EditLog, type SaveData, readSave, writeSave } from './world/persistence';
import { SkyMap } from './world/skymap';
import { TerrainField } from './world/terrain';
import type { Tree } from './world/vegetation';
import { Vegetation } from './world/vegetation';
import { planStructures } from './world/worldStructures';
import { TerrainWorkerPool } from './world/workerPool';

export interface LoadCallbacks { progress(fraction: number, label: string): void }

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(78, 1, 0.1, 1000);
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
  town!: Town;
  private dialogue!: DialogueUI;
  /** World progression flags (bosses defeated, events). */
  progress = { bossDefeated: false, raidDefeated: false };
  readonly events = new WorldEvents();
  private rope!: RopeRenderer;
  private pool!: TerrainWorkerPool;
  private uniforms!: WorldUniforms;
  private skyTex!: THREE.DataTexture;
  private vegRenderer!: VegetationRenderer;
  private structureRenderer!: StructureRenderer;
  private furnitureRenderer!: FurnitureRenderer;
  private particles!: Particles;
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
  private time = 0;
  private autosave = 0;
  private skyDirty: [number, number, number, number] | null = null;
  private skyTexDirty = false;
  private wobble = new Map<number, number>();
  private dir = new THREE.Vector3();
  private shake = 0;
  private potionCooldown = 0;
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
    const cfg = defaultConfig(save?.seed ?? seed);
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
      if (typeof ex.hp === 'number') this.vitals.hp = Math.max(1, ex.hp);
    } else {
      // Generated cabins and sky shrines, built from regular pieces/furniture.
      const plan = planStructures(this.gen);
      for (const p of plan.pieces) this.structures.add(p);
      for (const f of plan.furniture) this.furniture.add(f);
      this.inventory.add('copper_pickaxe', 1);
      this.inventory.add('copper_axe', 1);
      this.inventory.add('wooden_sword', 1);
      this.inventory.add('torch', 12);
      this.inventory.add('wood', 20);
      this.inventory.add('healing_potion', 2);
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
      this.markSky(x0, z0, x0 + 31, z0 + 31);
      this.veg.invalidateTufts(x0 + 16, z0 + 16, 20);
    };
    this.scene.add(this.terrain.group);

    this.vegRenderer = new VegetationRenderer(this.veg, worldMat, plantMat, this.quality.grass, this.quality.trees);
    this.scene.add(this.vegRenderer.group);
    this.structureRenderer = new StructureRenderer(this.structures, worldMat);
    this.scene.add(this.structureRenderer.group);

    const center = new THREE.Vector3(this.field.sx / 2, 0, this.field.sz / 2);
    this.atmosphere = new Atmosphere(this.scene, this.renderer, u, center, cfg.seed, cfg.seaLevel, this.quality.shadowSize);
    this.atmosphere.timeOfDay = (save?.extra?.timeOfDay as number | undefined) ?? 0.34;
    this.furnitureRenderer = new FurnitureRenderer(this.furniture, furnMat, this.atmosphere.lights);
    this.scene.add(this.furnitureRenderer.group);

    this.particles = new Particles((x, y, z) => this.field.sample(x, y, z) > 0);
    this.scene.add(this.particles.mesh);
    this.viewmodel = new Viewmodel(this.camera, viewMat, viewVis);
    this.post = new PostFX(this.renderer, this.camera, this.quality.msaa);

    // Player.
    const collision = new WorldCollision(this.field, this.structures, this.veg, this.furniture);
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
    this.town = new Town(this.field, this.structures, this.furniture, collision,
      () => createWorldMaterial(u, { vertexColors: true, objectSpace: { scale: 3, visibility: null } }));
    this.town.onMessage = (t, c) => this.hud.message(t, c);
    this.scene.add(this.town.group);
    this.dialogue = new DialogueUI($('#hud'), this.inventory, this.icons, () => this.npcContext(),
      (ok, name) => {
        this.hud.message(ok ? `Bought ${name}` : 'Not enough coins (or no room)', ok ? '#ffe08a' : '#ff9a7a');
        if (ok) this.audio.play('craft');
      },
      () => { if (!this.invUI.open) this.input.lock(); });
    if (save?.extra?.town) this.town.load(save.extra.town as never);
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
      creatureMaterial: () => createWorldMaterial(u, { vertexColors: true, objectSpace: { scale: 3, visibility: null } }),
      projectileMaterial: projMat,
      particles: (x, y, z, nx, ny, nz, c, n, speed) => this.particles.burst(x, y, z, nx, ny, nz, c, n, { speed }),
      damageNumber: (x, y, z, t, c) => this.labels.add(x, y, z, t, c),
      drop: (id, n, x, y, z) => this.pickups.spawn(id, n, x, y, z),
      hurtPlayer: (amount, fx, fz, kb) => this.hurtPlayer(amount, fx, fz, kb),
      sound: (name, x, y, z) => this.audio.play(name, Math.hypot(x - this.player.x, y - this.player.y, z - this.player.z)),
      blast: (x, y, z, r) => this.blast(x, y, z, r),
      carve: (x, y, z, r, drops) => {
        const res = this.log.commit(this.field, 'sub', x, y, z, r, Mat.Air, drops ? 1 : 99);
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
      bossDefeated: () => {
        this.progress.bossDefeated = true;
        this.hud.message('The Deepwyrm has been defeated!', '#c89aff');
        this.hud.message('Its scales could fire a Lumite Forge...', '#c89aff');
        writeSave(this.snapshot());
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
      safeZone: (x, y, z) => this.furniture.near(x, y, z, 18).some(f => f.type === 'bed' || f.type === 'door'),
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
      ghost: (m, p, v, r) => this.structureRenderer.showGhost(m, p, v, r),
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
        this.combat.fire('arrow', o.x, o.y - 0.1, o.z, dir.x, dir.y, dir.z, w.projectileSpeed!, w.damage, w.knockback);
        this.viewmodel.triggerSwing(w.speed * 0.6);
        this.audio.play('bow');
        return w.speed;
      }
      case 'magic': {
        if (!this.vitals.useMana(w.manaCost ?? 5)) { this.hud.message('Not enough mana', '#8ab8ff'); return 0.3; }
        const o = eye.clone().addScaledVector(dir, 0.8);
        const boring = def.id === 'wyrmfang_staff';
        this.combat.fire(boring ? 'drill' : 'bolt', o.x, o.y - 0.15, o.z, dir.x, dir.y, dir.z, w.projectileSpeed!, w.damage, w.knockback);
        this.viewmodel.triggerSwing(w.speed);
        this.audio.play('magic');
        this.atmosphere.lights.flash(o.x, o.y, o.z, boring ? 0xc8ff90 : 0x46d0ff, 8, 0.15);
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
      const t = this.townInfo();
      if (this.events.active) { this.hud.message(`${this.events.info!.name} is already under way!`, '#ffb070'); return false; }
      if (!t || Math.hypot(t.x - this.player.x, t.z - this.player.z) > 80) { this.hud.message('Sound the horn near a town with residents — that is what the raiders want.', '#ffb070'); return false; }
      this.startEvent('raid');
      return true;
    }
    if (def.id === 'wyrm_bait') {
      const underground = this.sky.visibility(this.player.x, this.player.y + 1.5, this.player.z) < 0.4;
      if (this.combat.boss) { this.hud.message('The Deepwyrm is already here!', '#ffb070'); return false; }
      if (!underground && this.atmosphere.daylight > 0.3) { this.hud.message('Nothing answers in daylight. Try at night or underground.', '#ffb070'); return false; }
      this.combat.summonBoss(this.player.x + 12, Math.max(8, this.player.y - 26), this.player.z + 12);
      this.hud.message('The Deepwyrm stirs beneath you...', '#c89aff');
      this.shake = 1;
      this.audio.play('explode');
      return true;
    }
    if (def.heal) {
      if (this.potionCooldown > 0) { this.hud.message(`Potion sickness (${Math.ceil(this.potionCooldown)}s)`, '#ffb070'); return false; }
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
   * The town nearest the player: the cluster of occupied houses around the
   * closest one (stray valid rooms such as explored cabins don't count).
   */
  townInfo(): { x: number; z: number; npcs: number } | null {
    const occupied = this.town.houses.filter(h => h.npc);
    if (!occupied.length) return null;
    const px = this.player.x, pz = this.player.z;
    const anchor = occupied.reduce((a, h) => (Math.hypot(h.x - px, h.z - pz) < Math.hypot(a.x - px, a.z - pz) ? h : a));
    const cluster = occupied.filter(h => Math.hypot(h.x - anchor.x, h.z - anchor.z) < 60);
    return { x: cluster.reduce((a, h) => a + h.x, 0) / cluster.length, z: cluster.reduce((a, h) => a + h.z, 0) / cluster.length, npcs: cluster.length };
  }

  /** Start a world event right away (war horn, tests). */
  startEvent(kind: EventKind) {
    this.onEventSignals(this.events.start(kind, { town: this.townInfo(), px: this.player.x, pz: this.player.z }));
  }

  private onEventSignals(signals: EventSignal[]) {
    for (const s of signals) {
      if (s.type === 'start') {
        if (s.kind === 'blood_moon') {
          this.hud.message('The Blood Moon is rising...', '#ff6a6a');
          this.audio.play('omen');
        } else {
          this.hud.message('The Hollowfolk are marching on your town!', '#e6dcc0');
          this.audio.play('horn');
          this.shake = Math.min(1, this.shake + 0.3);
        }
      } else if (s.type === 'end') {
        if (s.kind === 'blood_moon') this.hud.message('The Blood Moon sets. Dawn at last.', '#ffb0a0');
        else if (s.won) {
          const first = !this.progress.raidDefeated;
          this.progress.raidDefeated = true;
          this.combat.dismiss('raid');
          this.hud.message('The Hollow Raid has been repelled!', '#ffe08a');
          if (first) this.hud.message('Word of your victory will spread...', '#c89aff');
          const p = this.player;
          this.pickups.spawn('coin', 120, p.x, p.y + 1.5, p.z, 1.5);
          this.pickups.spawn('healing_potion', 3, p.x, p.y + 1.5, p.z, 1.5);
          this.audio.play('craft');
          writeSave(this.snapshot());
        } else {
          this.combat.dismiss('raid');
          this.hud.message('With no one to stop them, the raiders loot the outskirts and leave.', '#ffb070');
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
    // Blasted material drops as items (like Terraria bombs).
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
      this.pickups.spawn('wood', Math.round(t.height / 2) + 2, t.x, t.y + 1, t.z);
      this.particles.burst(t.x, t.y + t.height * 0.8, t.z, 0, 1, 0, 0x3f9a55, 24);
    }
    // Mesh edited chunks immediately for responsive feedback.
    this.terrain.remeshDirty(8);
  }

  private onTreeFelled(t: Tree) {
    this.vegRenderer.removeTree();
    this.wobble.delete(t.id);
    // Occasionally a mushroom grows at the stump.
    if (Math.random() < 0.25) this.pickups.spawn('red_cap', 1, t.x, t.y + 0.5, t.z);
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
      extra: {
        timeOfDay: this.atmosphere.timeOfDay,
        furniture: this.furniture.serialize(),
        equipment: this.equipment.serialize(),
        spawn: this.spawnPoint,
        hp: this.vitals.hp,
        town: this.town.serialize(),
        progress: this.progress,
        events: this.events.serialize(),
      },
    };
  }

  get inventoryOpen() { return this.invUI.open; }
  /** Any menu that needs the mouse cursor (inventory, dialogue). */
  get menuOpen() { return this.invUI.open || this.dialogue.open; }

  npcContext(): NpcContext {
    return {
      inv: this.inventory,
      kills: this.combat.kills,
      bossDefeated: this.progress.bossDefeated,
      raidDefeated: this.progress.raidDefeated,
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

  cycleBuildMode() {
    this.interaction.cycleMode();
    this.refreshHeld();
  }

  private handleKeys() {
    const inp = this.input;
    for (let i = 0; i < HOTBAR; i++) if (inp.wasPressed(`Digit${i + 1}`)) this.inventory.select(i);
    if (inp.wheel && !this.invUI.open) this.inventory.select(this.inventory.selected + inp.wheel);
    if (inp.wasPressed('KeyQ')) this.cycleBuildMode();
    if (inp.wasPressed('F3')) this.hud.debugVisible = !this.hud.debugVisible;
    if (inp.wasPressed('F5')) this.saveGame();
    if (inp.wasPressed('F9')) location.href = `${location.pathname}?continue=1`;
    if (inp.wasPressed('Tab') || inp.wasPressed('KeyE')) { if (this.dialogue.open) this.dialogue.close(); this.toggleInventory(); }
    if (inp.wasPressed('KeyH')) this.town.tryRegister(this.player.x, this.player.y, this.player.z, true);
  }

  // ===================================================================== update

  update(dt: number) {
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
    this.vitals.defense = st.defense;
    this.vitals.regenBonus = st.regen;

    // Look.
    if (active) {
      this.player.yaw -= inp.mouseDX * inp.sensitivity;
      this.player.pitch = Math.max(-1.55, Math.min(1.55, this.player.pitch - inp.mouseDY * inp.sensitivity));
    }
    // Move.
    const k = (c: string) => (active && inp.down(c) ? 1 : 0);
    const axisF = active ? inp.axisForward : 0, axisS = active ? inp.axisStrafe : 0;
    const outdoorsHere = this.sky.visibility(this.player.x, this.player.y + 1, this.player.z) > 0.5;
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
      }, outdoorsHere ? this.field.cfg.seaLevel : null);
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

    // Death and respawn.
    this.vitals.update(dt);
    if (this.vitals.dead) {
      if (!this.deathShown) {
        this.deathShown = true;
        this.hud.message('You were slain...', '#ff5a4a');
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
    this.camera.rotation.set(this.player.pitch, this.player.yaw, this.vitals.dead ? 0.6 : 0, 'YXZ');
    this.camera.updateMatrixWorld();
    const dir = this.dir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);

    // Talk to NPCs (right-click), otherwise regular interaction.
    let alt = active && inp.consumeAlt();
    const npcAim = this.town.pick(this.camera.position, dir, 4.5);
    if (alt && npcAim) {
      this.dialogue.show(npcAim);
      this.input.unlock();
      alt = false;
    }
    if (this.dialogue.open && this.dialogue.npc && Math.hypot(this.dialogue.npc.body.x - this.player.x, this.dialogue.npc.body.z - this.player.z) > 7) this.dialogue.close();
    this.interaction.update(dt, this.camera.position, dir, active && inp.lmb, active && inp.consumeClick(), alt);
    const held = this.inventory.held;
    if (held && item(held.id).kind !== 'tool') {
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

    // World streaming + updates.
    this.terrain.update(this.camera.position, 3);
    this.vegRenderer.update(this.camera.position, dt);
    this.structureRenderer.update();
    this.furnitureRenderer.update(dt);
    {
      // Rope from the right hand to the hook head.
      const side = new THREE.Vector3(-this.dir.z, 0, this.dir.x).normalize();
      const hx = this.camera.position.x + side.x * 0.3 + this.dir.x * 0.4, hy = this.camera.position.y - 0.35, hz = this.camera.position.z + side.z * 0.3 + this.dir.z * 0.4;
      this.rope.update(this.grapple.state !== 'idle', hx, hy, hz, this.grapple.x, this.grapple.y, this.grapple.z);
    }
    this.pickups.update(dt, this.player.x, this.player.y, this.player.z);
    this.onEventSignals(this.events.update(dt, {
      daylight: this.atmosphere.daylight, px: this.player.x, pz: this.player.z, town: this.townInfo(), bossDefeated: this.progress.bossDefeated,
    }));
    const ev = this.events.kind;
    this.combat.spawnBoost = ev === 'blood_moon' ? 1.8 : ev === 'raid' ? 1.6 : 1;
    this.atmosphere.bloodTarget = ev === 'blood_moon' ? 1 : 0;
    this.combat.update(dt, this.player.x, this.player.y, this.player.z, this.time);
    this.town.update(dt, this.player.x, this.player.y, this.player.z, this.atmosphere.daylight < 0.3, this.npcContext());
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
    this.atmosphere.update(dt, cam, vis, this.time, this.player.position, dir, st.lightBoost, ember);
    // Drifting embers in the depths.
    if (ember > 0.3 && Math.random() < ember * 0.6) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 10;
      this.particles.burst(cam.x + Math.cos(a) * r, cam.y - 2 + Math.random() * 3, cam.z + Math.sin(a) * r, 0, 1, 0, Math.random() < 0.5 ? 0xff8a30 : 0xffc050, 1, { speed: 0.6, size: 0.04, gravity: -0.6, life: 2.5 });
    }
    this.post.setUnderground(this.atmosphere.underground);
    this.post.setNight(1 - this.atmosphere.daylight);
    this.post.setBlood(this.atmosphere.bloodVisible);
    const moving = Math.min(1, Math.hypot(this.player.vx, this.player.vz) / 5) * (this.player.grounded ? 1 : 0);
    const ambient = this.atmosphere.ambientAt(vis);
    this.viewmodel.update(dt, moving, Math.max(ambient, 0.25 + this.atmosphere.underground * 0.25));
    this.particles.update(dt, ambient);

    // HUD.
    this.hud.update(dt);
    const boss = this.combat.boss;
    this.hud.setBoss(boss ? boss.name : null, boss?.hp ?? 0, boss?.maxHp ?? 1);
    this.hud.setEvent(this.events.info, this.events.progress, this.events.goal);
    this.hud.setVitals(this.vitals.hp, this.vitals.maxHp, this.vitals.mana, this.vitals.maxMana, this.vitals.defense);
    this.labels.update(dt, this.camera, window.innerWidth, window.innerHeight);
    this.minimap.draw(this.player.x, this.player.z, this.player.yaw, this.combat.creatures.map(c => ({ x: c.x, z: c.z, color: '#ff5a4a' })));
    const hours = this.atmosphere.timeOfDay * 24;
    const clock = `${String(Math.floor(hours)).padStart(2, '0')}:${String(Math.floor((hours % 1) * 60)).padStart(2, '0')} ${this.atmosphere.daylight > 0.3 ? '☀' : '☾'}`;
    const clockEl = $('#clock');
    if (clockEl.textContent !== clock) clockEl.textContent = clock;
    clockEl.style.color = ev === 'blood_moon' ? '#ff7a6a' : '';
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
    const npc = this.town.pick(this.camera.position, this.dir, 4.5);
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
