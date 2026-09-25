// The Deepwyrm: a burrowing, segmented worm boss that swims through the
// terrain — carving real tunnels with CSG as it goes — then erupts from the
// ground to arc through the air at the player and dives back down.
// Phase 2 (below half health): faster, spits rocks while airborne.

import * as THREE from 'three';
import { parts } from '../render/models';

const SEGMENTS = 16;
const SPACING = 1.85;

export interface BossContext {
  px: number; py: number; pz: number;
  dt: number;
  /** Is this point below the ground surface (the wyrm "swims" there)? */
  underground(x: number, y: number, z: number): boolean;
  carve(x: number, y: number, z: number, r: number): void;
  erupt(x: number, y: number, z: number): void;
  spit(x: number, y: number, z: number, tx: number, ty: number, tz: number): void;
  hurtPlayer(dmg: number, fx: number, fz: number, kb: number): void;
  worldHeight: number;
}

export class Deepwyrm {
  readonly name = 'The Deepwyrm';
  readonly maxHp = 1500;
  hp = 1500;
  readonly defense = 6;
  alive = true;
  /** Segment centres; [0] is the head. */
  readonly seg: THREE.Vector3[] = [];
  readonly radius: number[] = [];
  private vel = new THREE.Vector3();
  private carveTimer = 0;
  private spitTimer = 2;
  private wasSolid = true;
  private mode: 'burrow' | 'lunge' = 'burrow';
  private modeTime = 0;
  private lungeTarget = new THREE.Vector3();
  private surfaced = false;
  hitFlash = 0;
  leaving = false;
  readonly group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  readonly material: THREE.MeshLambertMaterial;

  constructor(x: number, y: number, z: number, material: THREE.MeshLambertMaterial) {
    this.material = material;
    for (let i = 0; i < SEGMENTS; i++) {
      this.seg.push(new THREE.Vector3(x, y - i * SPACING, z));
      this.radius.push(i === 0 ? 1.5 : i === SEGMENTS - 1 ? 0.8 : 1.25 - (i / SEGMENTS) * 0.3);
    }
    const head = parts.merge([
      parts.ico(1.35, 'scale', { detail: 1, sz: 1.25, jitter: 0.1, seed: 3 }, 0xc8d0a0),
      parts.cone(0.28, 1.1, 5, 'bone', { x: 0.7, y: -0.2, z: 1.2, rx: Math.PI / 2 - 0.3, rz: 0.4 }),
      parts.cone(0.28, 1.1, 5, 'bone', { x: -0.7, y: -0.2, z: 1.2, rx: Math.PI / 2 - 0.3, rz: -0.4 }),
      parts.cone(0.2, 0.8, 5, 'bone', { x: 0.35, y: -0.6, z: 1.35, rx: Math.PI / 2 + 0.2 }),
      parts.cone(0.2, 0.8, 5, 'bone', { x: -0.35, y: -0.6, z: 1.35, rx: Math.PI / 2 + 0.2 }),
      parts.octa(0.22, 'flame', { x: 0.55, y: 0.45, z: 1.05 }, 0xffe060),
      parts.octa(0.22, 'flame', { x: -0.55, y: 0.45, z: 1.05 }, 0xffe060),
      parts.cone(0.35, 1.2, 5, 'scale', { y: 1.35, z: -0.2, rx: -0.4 }, 0xa8b080),
      parts.cone(0.25, 0.9, 5, 'scale', { y: 1.0, z: -0.9, rx: -0.9 }, 0xa8b080),
    ]);
    const body = parts.merge([
      parts.cyl(1.2, 1.2, 1.5, 9, 'scale', { rx: Math.PI / 2 }, 0xb8c090),
      parts.cyl(1.3, 1.3, 0.35, 9, 'bone', { rx: Math.PI / 2, z: 0.55 }),
      parts.cone(0.3, 0.9, 4, 'bone', { y: 1.35, rx: -0.3 }),
      parts.cone(0.18, 0.6, 4, 'bone', { x: 1.1, y: 0.5, rz: -1.1 }),
      parts.cone(0.18, 0.6, 4, 'bone', { x: -1.1, y: 0.5, rz: 1.1 }),
    ]);
    const tail = parts.merge([parts.cone(0.9, 2.4, 8, 'scale', { z: -0.8, rx: -Math.PI / 2 }, 0xb8c090), parts.cone(0.2, 0.8, 4, 'bone', { y: 0.8, rx: -0.4 })]);
    for (let i = 0; i < SEGMENTS; i++) {
      const g = i === 0 ? head : i === SEGMENTS - 1 ? tail : body;
      const m = new THREE.Mesh(g, material);
      const s = i === 0 ? 1 : this.radius[i] / 1.2;
      m.scale.setScalar(s);
      m.castShadow = true;
      this.meshes.push(m);
      this.group.add(m);
    }
  }

  get head() { return this.seg[0]; }
  get phase2() { return this.hp < this.maxHp / 2; }

  update(ctx: BossContext) {
    const { dt } = ctx;
    const h = this.head;
    this.modeTime += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
    (this.material.userData.flash as { value: number }).value = this.hitFlash * 0.7;
    const inside = ctx.underground(h.x, h.y, h.z);
    const surge = this.mode === 'lunge' && !this.surfaced ? 1.6 : 1;
    const speed = (this.phase2 ? 17 : 13) * (this.leaving ? 1.3 : 1) * surge;
    const target = new THREE.Vector3();

    if (this.leaving) {
      target.set(h.x + this.vel.x, -50, h.z + this.vel.z);
    } else if (this.mode === 'burrow') {
      // Circle below the player, then launch upward through the ground.
      const a = this.modeTime * 0.9;
      target.set(ctx.px + Math.cos(a) * 14, ctx.py - 14, ctx.pz + Math.sin(a) * 14);
      if (this.modeTime > (this.phase2 ? 3 : 4.5) && inside) {
        this.mode = 'lunge';
        this.modeTime = 0;
        this.surfaced = false;
        this.lungeTarget.set(ctx.px, ctx.py + 9, ctx.pz);
      }
    } else {
      // Burst up through the ground at the player, arc over, dive back in.
      if (!inside) this.surfaced = true;
      target.copy(this.lungeTarget);
      if (this.surfaced) target.set(h.x + this.vel.x * 2, h.y - 30, h.z + this.vel.z * 2);
      if (this.modeTime > 8 || (this.surfaced && inside)) { this.mode = 'burrow'; this.modeTime = 0; }
    }

    // Steering: underground it swims freely; in the air it follows a ballistic arc.
    const desired = target.sub(h);
    const dist = desired.length() || 1;
    desired.multiplyScalar(speed / dist);
    if (inside) {
      this.vel.lerp(desired, Math.min(1, dt * (surge > 1 ? 3.5 : 2.2)));
    } else {
      this.vel.x += (desired.x - this.vel.x) * Math.min(1, dt * 0.6);
      this.vel.z += (desired.z - this.vel.z) * Math.min(1, dt * 0.6);
      this.vel.y -= 16 * dt;
    }
    h.addScaledVector(this.vel, dt);
    if (h.y > ctx.worldHeight - 4) { h.y = ctx.worldHeight - 4; this.vel.y = Math.min(0, this.vel.y); }
    if (h.y < 5) { h.y = 5; this.vel.y = Math.abs(this.vel.y); }

    // Leave real tunnels behind.
    this.carveTimer -= dt;
    if (inside && this.carveTimer <= 0) {
      this.carveTimer = 0.22;
      ctx.carve(h.x, h.y, h.z, 1.7);
    }
    if (inside !== this.wasSolid) ctx.erupt(h.x, h.y, h.z);
    this.wasSolid = inside;

    // Spit rocks while airborne in phase 2.
    this.spitTimer -= dt;
    if (this.phase2 && !inside && this.spitTimer <= 0 && !this.leaving) {
      this.spitTimer = 0.9;
      ctx.spit(h.x, h.y, h.z, ctx.px, ctx.py + 1, ctx.pz);
    }

    // Body follows as a chain.
    for (let i = 1; i < SEGMENTS; i++) {
      const prev = this.seg[i - 1], cur = this.seg[i];
      const d = cur.distanceTo(prev);
      if (d > SPACING) cur.lerp(prev, (d - SPACING) / d);
    }

    // Contact damage with any segment.
    for (let i = 0; i < SEGMENTS; i++) {
      const s = this.seg[i];
      const dx = ctx.px - s.x, dz = ctx.pz - s.z;
      const dy = Math.max(0, Math.abs(ctx.py + 0.9 - s.y) - 0.6);
      if (dx * dx + dy * dy + dz * dz < (this.radius[i] + 0.5) ** 2) {
        ctx.hurtPlayer(i === 0 ? 38 : 26, s.x, s.z, 11);
        break;
      }
    }

    // Visuals: orient each segment along the chain.
    for (let i = 0; i < SEGMENTS; i++) {
      const m = this.meshes[i];
      m.position.copy(this.seg[i]);
      const ahead = i === 0 ? this.seg[0].clone().add(this.vel) : this.seg[i - 1];
      m.lookAt(ahead);
    }
  }

  /** Index of the segment hit by a sphere, or -1. */
  hitTest(x: number, y: number, z: number, r: number): number {
    for (let i = 0; i < SEGMENTS; i++) {
      const s = this.seg[i];
      if ((s.x - x) ** 2 + (s.y - y) ** 2 + (s.z - z) ** 2 < (this.radius[i] + r) ** 2) return i;
    }
    return -1;
  }

  /** Distance along a ray to the nearest segment, or null. */
  rayHit(o: THREE.Vector3, d: THREE.Vector3, reach: number): number | null {
    let best: number | null = null;
    for (let i = 0; i < SEGMENTS; i++) {
      const s = this.seg[i];
      const tx = s.x - o.x, ty = s.y - o.y, tz = s.z - o.z;
      const t = tx * d.x + ty * d.y + tz * d.z;
      if (t < 0 || t > reach + this.radius[i]) continue;
      const ex = tx - d.x * t, ey = ty - d.y * t, ez = tz - d.z * t;
      if (ex * ex + ey * ey + ez * ez < this.radius[i] ** 2 && (best === null || t < best)) best = t;
    }
    return best;
  }
}
