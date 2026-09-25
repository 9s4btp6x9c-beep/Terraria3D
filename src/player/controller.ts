// First-person character controller. The body is a stack of spheres that is
// pushed out of the world's signed-distance field. Walkable contacts under
// the feet resolve vertically (no sliding on slopes); everything else
// resolves along the surface normal.

import type { WorldCollision } from '../world/collision';

export interface MoveInput {
  forward: number; // -1..1
  strafe: number;  // -1..1
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
}

export const PLAYER_RADIUS = 0.4;
const STAND_SPHERES = [0.4, 0.95, 1.45];
const CROUCH_SPHERES = [0.4, 0.8];
const WALKABLE = 0.55;

export class PlayerController {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  yaw = 0; pitch = 0;
  grounded = false;
  crouching = false;
  inWater = false;
  /** Seconds since last grounded (coyote time). */
  private airTime = 0;
  private jumpHeld = false;
  private n: [number, number, number] = [0, 0, 0];

  walkSpeed = 5.2;
  sprintSpeed = 8.2;
  crouchSpeed = 2.4;
  jumpSpeed = 8.4;
  gravity = 24;

  constructor(private world: WorldCollision) {}

  get eyeHeight() { return this.crouching ? 1.1 : 1.62; }

  teleport(x: number, y: number, z: number) {
    this.x = x; this.y = y; this.z = z;
    this.vx = this.vy = this.vz = 0;
  }

  update(dt: number, input: MoveInput, waterLevel: number | null) {
    dt = Math.min(dt, 0.05);
    this.world.prepare(this.x, this.y + 1, this.z);
    this.crouching = input.crouch || (this.crouching && !this.canStand());
    this.inWater = waterLevel !== null && this.y + 0.9 < waterLevel;

    // Desired horizontal velocity from input, relative to view yaw.
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * input.forward + cos * input.strafe;
    let wz = -cos * input.forward - sin * input.strafe;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    const speed = this.crouching ? this.crouchSpeed : input.sprint ? this.sprintSpeed : this.walkSpeed;
    const accel = this.grounded ? 60 : this.inWater ? 10 : 14;
    const tx = wx * speed * (this.inWater ? 0.6 : 1), tz = wz * speed * (this.inWater ? 0.6 : 1);
    this.vx += clampStep(tx - this.vx, accel * dt);
    this.vz += clampStep(tz - this.vz, accel * dt);

    // Jumping / swimming / gravity.
    if (this.inWater) {
      this.vy -= 5 * dt;
      if (input.jump) this.vy += 18 * dt;
      this.vy *= Math.pow(0.2, dt);
    } else {
      this.airTime = this.grounded ? 0 : this.airTime + dt;
      if (input.jump && !this.jumpHeld && this.airTime < 0.12) {
        this.vy = this.jumpSpeed;
        this.grounded = false;
        this.airTime = 1;
      }
      this.vy -= this.gravity * dt;
      this.vy = Math.max(this.vy, -50);
    }
    this.jumpHeld = input.jump;

    // Integrate in substeps so we never tunnel through thin geometry.
    const wasGrounded = this.grounded;
    this.grounded = false;
    const dist = Math.hypot(this.vx, this.vy, this.vz) * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.2));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      this.x += this.vx * h; this.y += this.vy * h; this.z += this.vz * h;
      this.resolve();
    }

    // Stick to the ground when walking down slopes.
    if (wasGrounded && !this.grounded && this.vy <= 0 && !this.inWater) {
      const d = this.world.distance(this.x, this.y + PLAYER_RADIUS, this.z, this.n);
      if (d < PLAYER_RADIUS + 0.35 && this.n[1] > WALKABLE) {
        this.y -= (d - PLAYER_RADIUS) / this.n[1];
        this.grounded = true;
        this.vy = 0;
      }
    }
  }

  private spheres() { return this.crouching ? CROUCH_SPHERES : STAND_SPHERES; }

  private resolve() {
    const n = this.n;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      const sph = this.spheres();
      for (let i = 0; i < sph.length; i++) {
        const cy = this.y + sph[i];
        const d = this.world.distance(this.x, cy, this.z, n);
        if (d >= PLAYER_RADIUS) continue;
        const push = PLAYER_RADIUS - d;
        moved = true;
        if (i === 0 && n[1] > WALKABLE) {
          // Standing on walkable ground: lift straight up, no sideways slide.
          this.y += Math.min(push / n[1], 0.6);
          if (this.vy < 0) this.vy = 0;
          this.grounded = true;
        } else {
          this.x += n[0] * push; this.y += n[1] * push; this.z += n[2] * push;
          const vn = this.vx * n[0] + this.vy * n[1] + this.vz * n[2];
          if (vn < 0) { this.vx -= vn * n[0]; this.vy -= vn * n[1]; this.vz -= vn * n[2]; }
          if (n[1] > WALKABLE) this.grounded = true;
        }
      }
      if (!moved) break;
    }
  }

  private canStand(): boolean {
    for (const off of STAND_SPHERES) if (this.world.distance(this.x, this.y + off, this.z, this.n) < PLAYER_RADIUS - 0.05) return false;
    return true;
  }

  /** True if a sphere at (x,y,z) with radius r overlaps the player body. */
  overlaps(x: number, y: number, z: number, r: number): boolean {
    for (const off of this.spheres()) {
      const dx = x - this.x, dy = y - (this.y + off), dz = z - this.z;
      if (dx * dx + dy * dy + dz * dz < (r + PLAYER_RADIUS) ** 2) return true;
    }
    return false;
  }
}

function clampStep(v: number, max: number) {
  return Math.max(-max, Math.min(max, v));
}
