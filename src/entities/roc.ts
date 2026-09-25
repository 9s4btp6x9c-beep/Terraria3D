// The Tempest Roc: a storm bird that rules the high sky. It circles above
// the player loosing volleys of feathers, rears up with a screech and dives
// talons-first, then climbs away. Below half health it calls Gale Swifts to
// its side and beats the air into gusts that shove the player off balance.

import * as THREE from 'three';
import { parts } from '../render/models';
import type { Boss, BossContext } from './boss';

const { box, cone, ico, octa, taper, merge } = parts;

type Mode = 'circle' | 'windup' | 'dive' | 'climb' | 'leave';

/** Hit spheres in the roc's local frame (x right, y up, z forward). */
const HIT: [number, number, number, number][] = [
  [0, 0, 0, 2.0], [0, 0.5, 2.6, 1.1], [0, -0.2, -2.4, 1.2],
  [2.6, 0.3, 0, 1.3], [-2.6, 0.3, 0, 1.3], [5.2, 0.4, -0.4, 1.2], [-5.2, 0.4, -0.4, 1.2],
];

export class TempestRoc implements Boss {
  readonly id = 'roc' as const;
  readonly name = 'The Tempest Roc';
  readonly maxHp = 2200;
  hp = 2200;
  readonly defense = 10;
  alive = true;
  leaving = false;
  hitFlash = 0;
  readonly group = new THREE.Group();
  readonly center: THREE.Vector3;
  private vel = new THREE.Vector3();
  private mode: Mode = 'circle';
  private modeTime = 0;
  private angle = Math.random() * Math.PI * 2;
  private volley = 1.5;
  private summoned = 0;
  private gustTimer = 6;
  private diveTarget = new THREE.Vector3();
  private hitCooldown = 0;
  private flap = 0;
  private bank = 0;
  private wings: { shoulder: THREE.Group; elbow: THREE.Group; side: number }[] = [];
  private legs: THREE.Group[] = [];
  private tmp = new THREE.Vector3();
  private m4 = new THREE.Matrix4();

  constructor(x: number, y: number, z: number, readonly material: THREE.MeshLambertMaterial) {
    this.center = new THREE.Vector3(x, y, z);
    this.build();
    this.group.position.copy(this.center);
  }

  get phase2() { return this.hp < this.maxHp / 2; }
  get departed() { return this.leaving && this.modeTime > 6; }

  private build() {
    const mat = this.material;
    const back = 0x4e628e, belly = 0xe8ecf4, gold = 0xffe08a;
    const add = (g: THREE.BufferGeometry, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const pivot = (parent: THREE.Object3D, x: number, y: number, z: number) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      parent.add(g);
      return g;
    };
    const body = pivot(this.group, 0, 0, 0);
    add(merge([
      ico(1.5, 'feather', { sx: 1.0, sy: 0.85, sz: 1.9, detail: 1, jitter: 0.06, seed: 31 }, back),
      ico(1.2, 'feather', { y: -0.4, z: 0.2, sx: 0.9, sy: 0.7, sz: 1.6, detail: 1 }, belly),
      // Neck, head and hooked beak.
      ico(0.75, 'feather', { y: 0.55, z: 1.9, sy: 0.9 }, back),
      ico(0.8, 'feather', { y: 0.75, z: 2.6, detail: 1 }, back),
      ico(0.55, 'feather', { y: 0.45, z: 2.8, sx: 0.9 }, belly),
      cone(0.34, 1.0, 5, 'gold', { y: 0.65, z: 3.55, rx: Math.PI / 2 + 0.25 }, gold),
      cone(0.16, 0.45, 4, 'gold', { y: 0.3, z: 3.85, rx: Math.PI }, gold),
      octa(0.14, 'flame', { x: 0.45, y: 1.0, z: 2.95 }, 0x9af0ff),
      octa(0.14, 'flame', { x: -0.45, y: 1.0, z: 2.95 }, 0x9af0ff),
      // Crest of storm-gold plumes.
      ...[0, 1, 2].map(i => taper(0.24, 1.3 - i * 0.2, 0.05, 0.25, 1, 'feather', { y: 1.4 + i * 0.05, z: 2.3 - i * 0.35, rx: -0.9 - i * 0.2 }, i === 0 ? gold : 0xf4f0e0)),
      // Tail fan.
      ...[-2, -1, 0, 1, 2].map(i => taper(0.5, 2.4, 0.06, 0.4, 1, 'feather', { x: i * 0.35, y: 0.1, z: -3.4, rx: -Math.PI / 2 + 0.12, rz: i * 0.2 }, Math.abs(i) === 2 ? 0x2e3a5a : back)),
      // Lightning streaks along the back.
      box(0.08, 0.06, 2.2, 'lumiteMetal', { y: 1.2, z: -0.2 }),
    ]), body);
    // Talons.
    for (const side of [1, -1]) {
      const hip = pivot(body, side * 0.6, -1.0, 0.2);
      add(merge([
        box(0.3, 1.0, 0.3, 'feather', { y: -0.4 }, back),
        box(0.18, 0.8, 0.18, 'gold', { y: -1.2 }, 0xc8a050),
        ...[-0.25, 0, 0.25].map(x => cone(0.08, 0.5, 4, 'bone', { x, y: -1.6, z: 0.3, rx: Math.PI / 2 + 0.8 }, 0x2a2a30)),
      ]), hip);
      this.legs.push(hip);
    }
    // Wings: two hinged segments each, with long primaries at the tip.
    for (const side of [1, -1]) {
      const shoulder = pivot(body, side * 1.1, 0.5, 0.3);
      add(merge([
        taper(3.2, 0.2, 2.2, 1, 0.75, 'feather', { x: side * 1.6 }, back),
        taper(3.2, 0.15, 1.0, 1, 0.8, 'feather', { x: side * 1.6, y: -0.12, z: -1.2 }, belly),
        box(3.0, 0.06, 0.08, 'lumiteMetal', { x: side * 1.6, y: 0.12, z: 1.05 }),
      ]), shoulder);
      const elbow = pivot(shoulder, side * 3.2, 0, 0);
      add(merge([
        taper(3.0, 0.15, 1.8, 1, 0.4, 'feather', { x: side * 1.5, z: -0.2, ry: side * 0.2 }, back),
        ...[0, 1, 2, 3, 4].map(i => taper(0.35, 0.08, 2.4, 0.3, 1, 'feather', { x: side * (2.2 + i * 0.35), z: -0.9 - i * 0.12, ry: side * (0.3 + i * 0.16) }, i > 2 ? 0x2e3a5a : 0x3e4e78)),
      ]), elbow);
      this.wings.push({ shoulder, elbow, side });
    }
    this.group.scale.setScalar(1.15);
  }

  update(ctx: BossContext) {
    const { dt } = ctx;
    const c = this.center;
    this.modeTime += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    (this.material.userData.flash as { value: number }).value = this.hitFlash * 0.7;
    const p2 = this.phase2;
    const want = this.tmp;
    let speed = 16, steer = 1.6;

    if (this.leaving && this.mode !== 'leave') { this.mode = 'leave'; this.modeTime = 0; }
    switch (this.mode) {
      case 'circle': {
        this.angle += dt * (p2 ? 0.55 : 0.4);
        const r = 24;
        want.set(ctx.px + Math.cos(this.angle) * r, ctx.py + 14 + Math.sin(this.modeTime * 0.8) * 3, ctx.pz + Math.sin(this.angle) * r);
        this.volley -= dt;
        if (this.volley <= 0) {
          this.volley = p2 ? 1.3 : 2;
          ctx.feathers(c.x, c.y - 0.5, c.z, ctx.px + ctx.pvx * 0.4, ctx.py + 1, ctx.pz + ctx.pvz * 0.4, p2 ? 5 : 3, p2 ? 24 : 20);
          ctx.sound('flap');
        }
        if (p2) {
          this.gustTimer -= dt;
          if (this.gustTimer <= 0 && Math.hypot(c.x - ctx.px, c.z - ctx.pz) < 34) {
            this.gustTimer = 7;
            ctx.gust(c.x, c.y, c.z, 13);
            ctx.sound('gust');
          }
        }
        if (this.modeTime > (p2 ? 4.5 : 6.5)) {
          this.mode = 'windup';
          this.modeTime = 0;
          ctx.sound('screech');
          if (p2 && this.summoned < 6) {
            for (const s of [1, -1]) ctx.summon('gale_swift', c.x + s * 4, c.y, c.z);
            this.summoned += 2;
          }
        }
        break;
      }
      case 'windup': {
        // Rear up and hang in the air, then commit to the dive.
        want.copy(c).addScaledVector(this.vel, -0.2);
        want.y += 1.5;
        speed = 4; steer = 3;
        if (this.modeTime > 0.8) {
          this.mode = 'dive';
          this.modeTime = 0;
          this.diveTarget.set(ctx.px + ctx.pvx * 0.35, ctx.py + 0.8, ctx.pz + ctx.pvz * 0.35);
          const d = this.diveTarget.clone().sub(c).normalize();
          this.vel.copy(d).multiplyScalar(p2 ? 36 : 30);
        }
        break;
      }
      case 'dive': {
        // Straight, fast and committed: dodge sideways to avoid it.
        want.copy(c).addScaledVector(this.vel, 1);
        speed = p2 ? 36 : 30; steer = 0.3;
        const past = c.y < this.diveTarget.y - 1 || this.modeTime > 1.8 || c.distanceTo(this.diveTarget) < 1.5;
        if (past) { this.mode = 'climb'; this.modeTime = 0; }
        break;
      }
      case 'climb': {
        want.set(c.x + this.vel.x, ctx.py + 18, c.z + this.vel.z);
        speed = 20; steer = 2;
        if (this.modeTime > 1.6) {
          this.mode = 'circle';
          this.modeTime = 0;
          this.angle = Math.atan2(c.z - ctx.pz, c.x - ctx.px);
        }
        break;
      }
      case 'leave':
        want.set(c.x + this.vel.x * 2, c.y + 40, c.z + this.vel.z * 2);
        speed = 24;
        break;
    }

    // Steer toward the target point.
    const desired = want.sub(c);
    const dist = desired.length() || 1;
    desired.multiplyScalar(Math.min(speed, dist * 2) / dist);
    const prevX = this.vel.x, prevZ = this.vel.z;
    this.vel.lerp(desired, Math.min(1, dt * steer));
    // Keep clear of terrain (except when committed to a dive).
    const clearance = ctx.distance(c.x, c.y, c.z);
    if (clearance < 4 && this.mode !== 'dive') this.vel.y = Math.max(this.vel.y, 10);
    if (clearance < 1.5 && this.mode === 'dive') { this.mode = 'climb'; this.modeTime = 0; this.vel.y = 12; }
    c.addScaledVector(this.vel, dt);
    c.y = Math.min(c.y, ctx.worldHeight + 50);

    // Contact damage: body and talons.
    const dx = ctx.px - c.x, dy = ctx.py + 0.9 - c.y, dz = ctx.pz - c.z;
    if (this.hitCooldown <= 0 && dx * dx + dy * dy + dz * dz < 2.6 * 2.6) {
      ctx.hurtPlayer(this.mode === 'dive' ? (p2 ? 48 : 40) : 26, c.x, c.z, this.mode === 'dive' ? 18 : 10);
      this.hitCooldown = 0.8;
    }

    // Visuals: face along velocity, bank into turns, flap or tuck the wings.
    this.group.position.copy(c);
    const sp = this.vel.length();
    if (sp > 0.5) {
      const yaw = Math.atan2(this.vel.x, this.vel.z);
      const pitch = -Math.asin(Math.max(-1, Math.min(1, this.vel.y / sp)));
      const turn = (Math.atan2(this.vel.x, this.vel.z) - Math.atan2(prevX, prevZ) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      this.bank += (-turn / Math.max(dt, 1e-3) * 0.35 - this.bank) * Math.min(1, dt * 3);
      this.bank = Math.max(-0.7, Math.min(0.7, this.bank));
      this.group.rotation.set(pitch * 0.8, yaw, this.bank, 'YXZ');
    }
    const tucked = this.mode === 'dive' ? 1 : 0;
    const rate = this.mode === 'windup' ? 9 : this.mode === 'climb' ? 7 : 3.2;
    this.flap += dt * rate;
    const beat = Math.sin(this.flap) * (this.mode === 'windup' ? 0.9 : 0.55);
    for (const w of this.wings) {
      w.shoulder.rotation.z = w.side * (beat * (1 - tucked) + tucked * 0.2);
      w.shoulder.rotation.y = -w.side * tucked * 1.0;
      w.elbow.rotation.z = w.side * (beat * 0.5 * (1 - tucked) - tucked * 0.2);
      w.elbow.rotation.y = -w.side * tucked * 0.9;
    }
    for (const l of this.legs) l.rotation.x = this.mode === 'dive' ? -1.2 : this.mode === 'windup' ? -0.6 : 0.3;
  }

  private spheres(): { x: number; y: number; z: number; r: number }[] {
    this.group.updateMatrixWorld();
    this.m4.copy(this.group.matrixWorld);
    const s = this.group.scale.x;
    return HIT.map(([x, y, z, r]) => {
      const v = this.tmp.set(x, y, z).applyMatrix4(this.m4);
      return { x: v.x, y: v.y, z: v.z, r: r * s };
    });
  }

  hitTest(x: number, y: number, z: number, r: number): number {
    const sph = this.spheres();
    for (let i = 0; i < sph.length; i++) {
      const s = sph[i];
      if ((s.x - x) ** 2 + (s.y - y) ** 2 + (s.z - z) ** 2 < (s.r + r) ** 2) return i;
    }
    return -1;
  }

  rayHit(o: THREE.Vector3, d: THREE.Vector3, reach: number): number | null {
    let best: number | null = null;
    for (const s of this.spheres()) {
      const tx = s.x - o.x, ty = s.y - o.y, tz = s.z - o.z;
      const t = tx * d.x + ty * d.y + tz * d.z;
      if (t < 0 || t > reach + s.r) continue;
      const ex = tx - d.x * t, ey = ty - d.y * t, ez = tz - d.z * t;
      if (ex * ex + ey * ey + ez * ez < s.r * s.r && (best === null || t < best)) best = t;
    }
    return best;
  }

  points() {
    return this.spheres().map(s => new THREE.Vector3(s.x, s.y, s.z));
  }

  drops(): [string, number][] {
    return [['roc_plume', 18 + Math.floor(Math.random() * 10)], ['roc_wings', 1], ['tempest_staff', 1], ['sky_feather', 15],
      ['coin', 250 + Math.floor(Math.random() * 120)], ['healing_potion', 6]];
  }
}
