// Grappling hook: fire a hook along the view ray; it flies out, latches onto
// terrain / building pieces and then acts as a rope. The rope reels in
// (pull toward the anchor, climb walls and ledges); holding "back" pays out
// rope so the player swings on a pendulum. Jump releases with a boost.

import type { PlayerController } from './controller';

export type HookState = 'idle' | 'flying' | 'attached';

export interface HookRaycast {
  (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): { x: number; y: number; z: number; distance: number } | null;
}

export class Grapple {
  state: HookState = 'idle';
  /** Hook head position. */
  x = 0; y = 0; z = 0;
  private dx = 0; private dy = 0; private dz = 0;
  private travelled = 0;
  ropeLength = 0;
  range = 26;
  speed = 22;

  constructor(private player: PlayerController, private cast: HookRaycast) {}

  fire(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) {
    this.state = 'flying';
    this.x = ox; this.y = oy; this.z = oz;
    this.dx = dx; this.dy = dy; this.dz = dz;
    this.travelled = 0;
  }

  release(jumpBoost = false) {
    if (this.state === 'attached' && jumpBoost) this.player.impulse(0, 6, 0);
    this.state = 'idle';
  }

  /**
   * @param reel  +1 reel in (default), -1 let out, 0 hold length
   * @returns true while the hook controls the player's motion
   */
  update(dt: number, reel: number, handX: number, handY: number, handZ: number): boolean {
    if (this.state === 'flying') {
      const step = 70 * dt;
      const hit = this.cast(this.x, this.y, this.z, this.dx, this.dy, this.dz, step);
      if (hit) {
        this.x = hit.x; this.y = hit.y; this.z = hit.z;
        this.state = 'attached';
        this.ropeLength = Math.hypot(this.x - handX, this.y - handY, this.z - handZ);
        return true;
      }
      this.x += this.dx * step; this.y += this.dy * step; this.z += this.dz * step;
      this.travelled += step;
      if (this.travelled > this.range) this.state = 'idle';
      return false;
    }
    if (this.state !== 'attached') return false;

    const p = this.player;
    const px = p.x, py = p.y + 1.1, pz = p.z;
    let rx = this.x - px, ry = this.y - py, rz = this.z - pz;
    const dist = Math.hypot(rx, ry, rz) || 1;
    rx /= dist; ry /= dist; rz /= dist;

    if (reel > 0) this.ropeLength = Math.max(1.2, this.ropeLength - this.speed * dt);
    else if (reel < 0) this.ropeLength = Math.min(this.range + 4, this.ropeLength + 8 * dt);

    if (reel > 0 && dist > this.ropeLength) {
      // Pull toward the anchor at hook speed (keeps some sideways momentum).
      const want = Math.min(this.speed, (dist - 1.1) * 8);
      const k = Math.min(1, dt * 12);
      p.vx += (rx * want - p.vx) * k;
      p.vy += (ry * want - p.vy) * k + 24 * dt; // cancel gravity while reeling
      p.vz += (rz * want - p.vz) * k;
    } else if (dist > this.ropeLength) {
      // Pendulum: remove outward radial velocity and pull back onto the rope.
      const radial = p.vx * rx + p.vy * ry + p.vz * rz;
      if (radial < 0) { p.vx -= rx * radial; p.vy -= ry * radial; p.vz -= rz * radial; }
      const fix = (dist - this.ropeLength) * 10;
      p.vx += rx * fix * dt * 10; p.vy += ry * fix * dt * 10; p.vz += rz * fix * dt * 10;
    }
    if (reel > 0 && dist < 1.4) {
      // Arrived: hang in place.
      p.vx *= 0.5; p.vz *= 0.5; p.vy = Math.max(p.vy, 0) * 0.5 + 24 * dt;
    }
    // Rope snaps if stretched far beyond range (e.g. teleport).
    if (dist > this.range + 12) this.state = 'idle';
    return true;
  }
}
