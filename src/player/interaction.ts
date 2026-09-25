// Aiming and item use: mining terrain with pickaxes, felling trees with axes,
// removing building pieces and furniture, placing pieces / furniture /
// terrain material, using consumables and weapons, and right-click
// interaction (doors, chests, beds).

import * as THREE from 'three';
import { FURNITURE, type FurnitureHit, FurnitureSet, type Placed, bounds } from '../building/furniture';
import { PIECES, SHAPES, type PieceHit, Structures } from '../building/structures';
import type { Inventory } from '../items/inventory';
import { type FurnitureId, type ItemDef, type PieceShape, item } from '../items/items';
import type { EditLog } from '../world/persistence';
import { Mat, material } from '../world/materials';
import type { RayHit, TerrainField } from '../world/terrain';
import type { Tree, Vegetation } from '../world/vegetation';
import type { PlayerController } from './controller';

export type BuildMode = PieceShape | 'blob';

export interface InteractionHooks {
  terrainEdited(x: number, y: number, z: number, r: number): void;
  treeFelled(tree: Tree): void;
  treeHit(tree: Tree): void;
  particles(x: number, y: number, z: number, nx: number, ny: number, nz: number, color: number, count: number): void;
  message(text: string, color?: string): void;
  swing(): void;
  ghost(mode: BuildMode | null, pos: { x: number; y: number; z: number; rot: number } | null, valid: boolean, radius?: number): void;
  furnitureGhost(type: FurnitureId | null, pos: { x: number; y: number; z: number; rot: number; wall?: [number, number, number] } | null, valid: boolean): void;
  /** Give items to the player (spawns a pickup at the source position). */
  give(id: string, count: number, x: number, y: number, z: number): void;
  openChest(f: Placed): void;
  setSpawn(f: Placed): void;
  /** Use a weapon; returns seconds until it can be used again (0 = not used). */
  attack(def: ItemDef): number;
  /** Consume an item (potions); returns true if consumed. */
  consume(def: ItemDef): boolean;
  /** Nearest creature along the ray within reach (for melee tools). */
  creatureHit?(o: THREE.Vector3, d: THREE.Vector3, reach: number): number | null;
  /** Mining speed multiplier from equipment. */
  miningSpeed(): number;
  /** Feedback for doors opening/closing etc. */
  interacted?(what: string): void;
}

type Aim =
  | { kind: 'terrain'; hit: RayHit; distance: number }
  | { kind: 'piece'; hit: PieceHit; distance: number }
  | { kind: 'furniture'; hit: FurnitureHit; distance: number }
  | { kind: 'tree'; tree: Tree; x: number; y: number; z: number; distance: number };

const BUILD_REACH = 7;
const MINE_WORK_SCALE = 1.8;

export class Interaction {
  private cooldown = 0;
  private dig = { x: 0, y: 0, z: 0, mat: -1, work: 0 };
  private pendingVolume = new Map<string, number>();
  private modeIndex = new Map<string, number>();
  private lastWarn = 0;
  aim: Aim | null = null;

  constructor(
    private field: TerrainField,
    private structures: Structures,
    private furniture: FurnitureSet,
    private veg: Vegetation,
    private inv: Inventory,
    private player: PlayerController,
    private log: EditLog,
    private hooks: InteractionHooks,
  ) {}

  modesFor(def: ItemDef): BuildMode[] {
    const modes: BuildMode[] = [];
    if (def.terrain !== undefined) modes.push('blob');
    if (def.build) modes.push(...SHAPES);
    return modes;
  }

  currentMode(): BuildMode | null {
    const held = this.inv.held;
    if (!held) return null;
    const modes = this.modesFor(item(held.id));
    if (modes.length === 0) return null;
    return modes[(this.modeIndex.get(held.id) ?? 0) % modes.length];
  }

  cycleMode() {
    const held = this.inv.held;
    if (!held) return;
    const n = this.modesFor(item(held.id)).length;
    if (n > 1) this.modeIndex.set(held.id, ((this.modeIndex.get(held.id) ?? 0) + 1) % n);
  }

  modeLabel(): string {
    const m = this.currentMode();
    if (!m) return '';
    const cost = m === 'blob' ? 1 : PIECES[m].cost;
    const name = m === 'blob' ? 'Terrain fill' : PIECES[m].name;
    return `${name} · cost ${cost} · [Q] cycle`;
  }

  private computeAim(o: THREE.Vector3, d: THREE.Vector3, reach: number): Aim | null {
    let best: Aim | null = null;
    const th = this.field.raycast(o.x, o.y, o.z, d.x, d.y, d.z, reach);
    if (th) best = { kind: 'terrain', hit: th, distance: th.distance };
    const ph = this.structures.raycast(o.x, o.y, o.z, d.x, d.y, d.z, reach);
    if (ph && (!best || ph.distance < best.distance)) best = { kind: 'piece', hit: ph, distance: ph.distance };
    const fh = this.furniture.raycast(o.x, o.y, o.z, d.x, d.y, d.z, reach);
    if (fh && (!best || fh.distance < best.distance)) best = { kind: 'furniture', hit: fh, distance: fh.distance };
    for (const t of this.veg.treesNear(o.x, o.z, reach + 2)) {
      const hit = rayCylinder(o, d, t);
      if (hit !== null && hit < reach && (!best || hit < best.distance))
        best = { kind: 'tree', tree: t, x: o.x + d.x * hit, y: o.y + d.y * hit, z: o.z + d.z * hit, distance: hit };
    }
    return best;
  }

  /**
   * @param useHeld  primary button held
   * @param clicked  primary button pressed this frame
   * @param alt      secondary button pressed this frame (interact)
   */
  update(dt: number, eye: THREE.Vector3, dir: THREE.Vector3, useHeld: boolean, clicked: boolean, alt: boolean) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const held = this.inv.held;
    const def = held ? item(held.id) : null;
    const mode = this.currentMode();
    const reach = def?.tool ? def.tool.reach : BUILD_REACH;
    this.aim = this.computeAim(eye, dir, reach);

    if (alt && this.interact()) return;
    if (!mode) this.hooks.ghost(null, null, false);
    if (!def?.furniture) this.hooks.furnitureGhost(null, null, false);

    if (mode && def) { this.updateBuild(def, mode, useHeld, clicked); return; }
    if (def?.furniture) { this.updatePlaceFurniture(def, useHeld, clicked); return; }
    if (!def || !useHeld || this.cooldown > 0) return;

    if (def.kind === 'consumable') {
      if (clicked && this.hooks.consume(def)) { this.inv.remove(def.id, 1); this.cooldown = 0.5; this.hooks.swing(); }
      return;
    }
    if (def.weapon) {
      const cd = this.hooks.attack(def);
      if (cd > 0) this.cooldown = cd;
      return;
    }
    if (!def.tool) return;
    this.cooldown = def.tool.speed / this.hooks.miningSpeed();
    this.hooks.swing();
    // Tools also hurt creatures in front of you.
    const creature = this.hooks.creatureHit?.(eye, dir, Math.min(reach, 3));
    const aim = this.aim;
    if (creature !== undefined && creature !== null && (!aim || creature <= aim.distance)) {
      this.hooks.attack(def);
      return;
    }
    if (!aim) return;
    if (aim.kind === 'furniture') { this.hitFurniture(aim.hit); return; }
    if (def.tool.type === 'axe') {
      if (aim.kind === 'tree') this.chop(aim.tree, aim.x, aim.y, aim.z, def.tool.power);
      else if (aim.kind === 'piece') this.hitPiece(aim.hit);
      return;
    }
    if (aim.kind === 'terrain') this.mine(aim.hit, def);
    else if (aim.kind === 'piece') this.hitPiece(aim.hit);
    else this.warn('Use an axe to fell trees');
  }

  /** Right-click on furniture. Returns true if something happened. */
  private interact(): boolean {
    const aim = this.aim;
    if (!aim || aim.kind !== 'furniture' || aim.distance > 5) return false;
    const f = aim.hit.f;
    switch (f.type) {
      case 'door':
        f.open = !f.open;
        // Don't let a closing door trap the player inside its leaf.
        if (!f.open && FurnitureSet.distance([f], this.player.x, this.player.y + 0.9, this.player.z) < 0.45) { f.open = true; return true; }
        this.furniture.changed();
        this.hooks.interacted?.('door');
        return true;
      case 'chest': this.hooks.openChest(f); return true;
      case 'bed': this.hooks.setSpawn(f); return true;
      default: return false;
    }
  }

  private warn(text: string) {
    const now = performance.now();
    if (now - this.lastWarn > 1500) { this.hooks.message(text, '#ffb070'); this.lastWarn = now; }
  }

  // ------------------------------------------------------------------ mining

  private mine(hit: RayHit, def: ItemDef) {
    const tool = def.tool!;
    const md = material(hit.material);
    if (md.tier < 0 || md.tier > tool.tier) {
      this.hooks.particles(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, 0xffe0a0, 4);
      this.warn(md.tier < 0 ? `${md.name} is unbreakable` : `${md.name} needs a stronger pickaxe`);
      return;
    }
    const same = this.dig.mat === hit.material && (this.dig.x - hit.x) ** 2 + (this.dig.y - hit.y) ** 2 + (this.dig.z - hit.z) ** 2 < tool.radius * tool.radius;
    if (!same) this.dig = { x: hit.x, y: hit.y, z: hit.z, mat: hit.material, work: 0 };
    this.dig.work += tool.power * this.hooks.miningSpeed();
    this.hooks.particles(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, md.particle, 5);
    if (this.dig.work < md.hardness * MINE_WORK_SCALE) return;
    this.dig.work = 0;

    // Carve a sphere biting into the surface along the view ray.
    const r = tool.radius;
    const cx = hit.x - hit.nx * r * 0.45, cy = hit.y - hit.ny * r * 0.45, cz = hit.z - hit.nz * r * 0.45;
    const res = this.log.commit(this.field, 'sub', cx, cy, cz, r, Mat.Air, tool.tier);
    this.hooks.particles(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, md.particle, 14);
    this.hooks.terrainEdited(cx, cy, cz, r);
    for (const [matId, vol] of res.volumes) this.collect(matId, vol);
  }

  private collect(matId: number, volume: number) {
    const md = material(matId);
    if (!md.drop || volume <= 0) return;
    const v = (this.pendingVolume.get(md.drop) ?? 0) + volume;
    const n = Math.floor(v / md.volumePerItem);
    this.pendingVolume.set(md.drop, v - n * md.volumePerItem);
    if (n > 0) this.hooks.give(md.drop, n, this.dig.x, this.dig.y, this.dig.z);
  }

  private chop(tree: Tree, x: number, y: number, z: number, power: number) {
    tree.hp -= power;
    this.hooks.treeHit(tree);
    this.hooks.particles(x, y, z, 0, 0.5, 0, 0x8a5a36, 8);
    if (tree.hp > 0) return;
    tree.alive = false;
    const wood = Math.round(tree.height / 2) + 2;
    this.hooks.give('wood', wood, tree.x, tree.y + 1.2, tree.z);
    this.hooks.particles(tree.x, tree.y + tree.height * 0.8, tree.z, 0, 1, 0, 0x3f9a55, 30);
    this.hooks.treeFelled(tree);
  }

  private hitPiece(hit: PieceHit) {
    const p = hit.piece;
    p.hp--;
    const color = p.texture === 'planks' ? 0xa8744a : 0x9a98a4;
    this.hooks.particles(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, color, 6);
    if (p.hp > 0) return;
    this.structures.remove(p.id);
    this.hooks.give(p.texture === 'planks' ? 'wood' : 'stone', PIECES[p.shape].cost, hit.x, hit.y, hit.z);
  }

  private hitFurniture(hit: FurnitureHit) {
    const f = hit.f;
    if (f.chest?.some(Boolean)) { this.warn('Empty the chest first'); return; }
    f.hp--;
    this.hooks.particles(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, f.type === 'furnace' || f.type === 'anvil' ? 0x8a8890 : 0xa8744a, 6);
    if (f.hp > 0) return;
    this.furniture.remove(f.uid);
    this.hooks.give(f.type, 1, hit.x, hit.y, hit.z);
  }

  // --------------------------------------------------------------- furniture

  private updatePlaceFurniture(def: ItemDef, useHeld: boolean, clicked: boolean) {
    const type = def.furniture!;
    const fd = FURNITURE[type];
    const aim = this.aim;
    if (!aim || aim.kind === 'tree') { this.hooks.furnitureGhost(null, null, false); return; }
    const h = aim.hit;
    const pos = FurnitureSet.snap(type, h.x, h.y, h.z, h.nx, h.ny, h.nz, this.player.yaw);
    const cand: Placed = { uid: -1, type, ...pos, hp: 1 };
    let valid = true;
    if (fd.placement === 'floor' && h.ny < 0.65) valid = false;
    if (fd.placement === 'wallslot' && (this.structures.occupied('wall', pos.x, pos.y, pos.z, pos.rot) ||
      [...this.furniture.items.values()].some(o => o.type === 'door' && Math.abs(o.x - pos.x) < 0.1 && Math.abs(o.z - pos.z) < 0.1 && Math.abs(o.y - pos.y) < 1))) valid = false;
    // No overlap with other furniture (except torches, which are tiny).
    const b = bounds(cand);
    if (valid && type !== 'torch') {
      for (const o of this.furniture.near(pos.x, pos.y, pos.z, 3)) {
        if (o.type === 'torch') continue;
        const ob = bounds(o);
        if ([0, 1, 2].every(a => Math.abs(ob.c[a] - b.c[a]) < ob.h[a] + b.h[a] - 0.02)) { valid = false; break; }
      }
    }
    // Not inside the player or buried in terrain.
    if (valid && fd.collide) {
      for (const off of [0.4, 0.95, 1.45]) if (FurnitureSet.distance([cand], this.player.x, this.player.y + off, this.player.z) < 0.4) valid = false;
      if (this.field.sample(b.c[0], b.c[1] + b.h[1] * 0.5, b.c[2]) > 0.3) valid = false;
    }
    this.hooks.furnitureGhost(type, pos, valid);
    if (valid && (clicked || (useHeld && this.cooldown <= 0)) && this.inv.remove(def.id, 1)) {
      this.cooldown = 0.3;
      this.furniture.add({ type, ...pos });
      this.hooks.swing();
      this.hooks.particles(pos.x, pos.y + 0.1, pos.z, 0, 1, 0, 0xc8a070, 6);
    }
  }

  // ---------------------------------------------------------------- building

  private updateBuild(def: ItemDef, mode: BuildMode, useHeld: boolean, clicked: boolean) {
    const aim = this.aim;
    if (!aim || aim.kind === 'tree' || aim.kind === 'furniture') { this.hooks.ghost(null, null, false); return; }
    const hp = aim.hit;
    const have = this.inv.count(def.id);

    if (mode === 'blob') {
      const r = 1.1;
      const x = hp.x + hp.nx * 0.5, y = hp.y + hp.ny * 0.5, z = hp.z + hp.nz * 0.5;
      const valid = have >= 1 && !this.player.overlaps(x, y, z, r);
      this.hooks.ghost('blob', { x, y, z, rot: 0 }, valid, r);
      if (valid && useHeld && this.cooldown <= 0) {
        this.cooldown = 0.22;
        this.inv.remove(def.id, 1);
        this.log.commit(this.field, 'add', x, y, z, r, def.terrain!, 99);
        this.hooks.terrainEdited(x, y, z, r);
        this.hooks.swing();
        this.hooks.particles(x, y, z, hp.nx, hp.ny, hp.nz, material(def.terrain!).particle, 8);
      }
      return;
    }

    const pos = Structures.snap(mode, hp.x, hp.y, hp.z, hp.nx, hp.ny, hp.nz, this.player.yaw);
    const cost = PIECES[mode].cost;
    const candidate = { id: -1, shape: mode, texture: def.build!, ...pos, hp: 1 };
    let valid = have >= cost && !this.structures.occupied(mode, pos.x, pos.y, pos.z, pos.rot);
    // Not overlapping the player.
    if (valid) {
      for (const off of [0.4, 0.95, 1.45]) {
        if (Structures.distance([candidate], this.player.x, this.player.y + off, this.player.z) < 0.38) { valid = false; break; }
      }
    }
    // Not buried in terrain.
    if (valid && this.field.sample(pos.x, pos.y + PIECES[mode].lift, pos.z) > 1.2) valid = false;
    this.hooks.ghost(mode, pos, valid);
    if (valid && (clicked || (useHeld && this.cooldown <= 0))) {
      this.cooldown = 0.25;
      this.inv.remove(def.id, cost);
      this.structures.add({ shape: mode, texture: def.build!, ...pos });
      this.hooks.swing();
    }
  }
}

/** Ray vs a tree's vertical trunk cylinder; returns distance or null. */
function rayCylinder(o: THREE.Vector3, d: THREE.Vector3, t: Tree): number | null {
  const ox = o.x - t.x, oz = o.z - t.z;
  const r = t.radius + 0.1;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-6) return null;
  const b = 2 * (ox * d.x + oz * d.z);
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = (-b - Math.sqrt(disc)) / (2 * a);
  if (s < 0) return null;
  const y = o.y + d.y * s;
  if (y < t.y - 0.5 || y > t.y + t.height * 0.8) return null;
  return s;
}
