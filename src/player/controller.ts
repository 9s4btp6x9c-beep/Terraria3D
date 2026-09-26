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
/** Wing climb speed and glide sink rate (m/s). */
const FLIGHT_RISE = 7.5;
const GLIDE_FALL = 2.6;

export class PlayerController {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  yaw = 0; pitch = 0;
  grounded = false;
  crouching = false;
  inWater = false;
  /** Movement speed multiplier (accessories). */
  speedMul = 1;
  /** Extra mid-air jumps (double-jump accessories) and how many remain. */
  extraJumps = 0;
  private airJumps = 0;
  /** Downward speed at the moment of the last landing (for fall damage). */
  landingImpact = 0;
  /** Set when an air jump fires this frame (for effects). */
  airJumped = false;
  /** Wings: seconds of powered flight per take-off (0 = none). */
  flightTime = 0;
  /** Flight seconds left before landing again. */
  flightLeft = 0;
  /** This frame: rising on wings / gliding down on them. */
  flying = false;
  gliding = false;
  /** World extents; the player is kept inside [margin, size - margin]. */
  bounds: { x: number; z: number } | null = null;
  /** Seconds since last grounded (coyote time). */
  private airTime = 0;
  private jumpHeld = false;
  /** The head pressed into a low ceiling while standing (crouch next frame). */
  private headBumped = false;
  private n: [number, number, number] = [0, 0, 0];
  private n2: [number, number, number] = [0, 0, 0];

  walkSpeed = 5.2;
  sprintSpeed = 8.2;
  crouchSpeed = 2.4;
  jumpSpeed = 8.4;
  gravity = 24;

  constructor(private world: WorldCollision) {}

  /** Eye height above the feet, eased so crouching and standing never pop the view. */
  private eye = 1.62;
  get eyeHeight() { return this.eye; }

  get position() { return { x: this.x, y: this.y, z: this.z }; }

  /** Knockback / explosion push. */
  impulse(x: number, y: number, z: number) {
    this.vx += x; this.vy += y; this.vz += z;
    if (y > 0) this.grounded = false;
  }

  teleport(x: number, y: number, z: number) {
    this.x = x; this.y = y; this.z = z;
    this.eye = this.crouching ? 1.1 : 1.62;
    this.vx = this.vy = this.vz = 0;
  }

  update(dt: number, input: MoveInput, waterLevel: number | null) {
    dt = Math.min(dt, 0.05);
    this.world.prepare(this.x, this.y + 1, this.z);
    // Duck under low ceilings instead of fighting them (the feet push up, the
    // head pushes down, and the view would shudder between the two).
    this.crouching = input.crouch || this.headBumped || (this.crouching && !this.canStand());
    this.headBumped = false;
    const eyeTarget = this.crouching ? 1.1 : 1.62;
    this.eye += (eyeTarget - this.eye) * Math.min(1, dt * 14);
    if (Math.abs(eyeTarget - this.eye) < 0.002) this.eye = eyeTarget;
    this.inWater = waterLevel !== null && this.y + 0.9 < waterLevel;

    // Desired horizontal velocity from input, relative to view yaw.
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * input.forward + cos * input.strafe;
    let wz = -cos * input.forward - sin * input.strafe;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    const speed = (this.crouching ? this.crouchSpeed : input.sprint ? this.sprintSpeed : this.walkSpeed) * this.speedMul;
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
      this.airJumped = false;
      if (this.grounded) { this.airJumps = this.extraJumps; this.flightLeft = this.flightTime; }
      if (input.jump && !this.jumpHeld && this.airTime < 0.12) {
        this.vy = this.jumpSpeed;
        this.grounded = false;
        this.airTime = 1;
      } else if (input.jump && !this.jumpHeld && this.airJumps > 0 && !this.grounded) {
        this.vy = this.jumpSpeed * 0.95;
        this.airJumps--;
        this.airJumped = true;
      }
      this.vy -= this.gravity * dt;
      this.vy = Math.max(this.vy, -50);
      // Wings: holding jump in the air climbs until the flight time runs
      // out, then the wings glide (a slow, safe descent).
      this.flying = this.gliding = false;
      if (this.flightTime > 0 && input.jump && !this.grounded && this.airTime > 0.2 && !this.airJumped) {
        if (this.flightLeft > 0) {
          // Powered flight cancels gravity and eases toward the climb speed.
          this.vy += this.gravity * dt;
          this.vy += (FLIGHT_RISE - this.vy) * Math.min(1, dt * 4);
          this.flightLeft = Math.max(0, this.flightLeft - dt);
          this.flying = true;
        } else if (this.vy < -GLIDE_FALL) {
          this.vy = -GLIDE_FALL;
          this.gliding = true;
        }
      }
    }
    this.jumpHeld = input.jump;

    // Integrate in substeps so we never tunnel through thin geometry.
    const wasGrounded = this.grounded;
    const fallSpeed = -this.vy;
    this.landingImpact = 0;
    this.grounded = false;
    const dist = Math.hypot(this.vx, this.vy, this.vz) * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.2));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      this.x += this.vx * h; this.y += this.vy * h; this.z += this.vz * h;
      this.resolve();
    }

    if (this.grounded && !wasGrounded && !this.inWater) this.landingImpact = Math.max(0, fallSpeed);

    // Invisible walls at the world edge (the ocean ring hides them).
    if (this.bounds) {
      const m = 2;
      if (this.x < m) { this.x = m; this.vx = Math.max(0, this.vx); }
      if (this.z < m) { this.z = m; this.vz = Math.max(0, this.vz); }
      if (this.x > this.bounds.x - m) { this.x = this.bounds.x - m; this.vx = Math.min(0, this.vx); }
      if (this.z > this.bounds.z - m) { this.z = this.bounds.z - m; this.vz = Math.min(0, this.vz); }
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
        // (Capped: deep inside rock the distance is only a bound.)
        const push = Math.min(PLAYER_RADIUS - d, 1);
        if (i > 0 && this.grounded && n[1] < 0) {
          // Overhead contact on a grounded body: slide sideways off it, never
          // down into the floor (the feet would push back up and the view
          // would shudder); if it presses in from above, duck under it.
          if (n[1] < -0.5 && push > 0.06) this.headBumped = true;
          const hl = Math.hypot(n[0], n[2]);
          if (hl < 0.2) continue;
          const side = Math.min(push / hl, 0.3);
          this.x += n[0] / hl * side; this.z += n[2] / hl * side;
          moved = true;
          continue;
        }
        moved = true;
        if (i === 0 && n[1] > WALKABLE) {
          // Standing on walkable ground: lift straight up, no sideways slide,
          // by exactly as much as clears the ground (an estimate overshoots
          // in creases and the body bobs).
          this.y += this.clearLift(cy, Math.min(push / n[1] * 1.5 + 0.02, 0.6));
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

  /** Smallest upward shift (up to `max`) that lifts the foot sphere at height `cy` clear of the ground. */
  private clearLift(cy: number, max: number): number {
    const n = this.n2;
    if (this.world.distance(this.x, cy + max, this.z, n) < PLAYER_RADIUS - 1e-3) return max;
    let lo = 0, hi = max;
    for (let k = 0; k < 7; k++) {
      const mid = (lo + hi) * 0.5;
      if (this.world.distance(this.x, cy + mid, this.z, n) >= PLAYER_RADIUS - 1e-3) hi = mid; else lo = mid;
    }
    return hi;
  }

  /** Room to stand up (with a little clearance, so ducking under a ceiling never flickers). */
  private canStand(): boolean {
    for (const off of STAND_SPHERES) if (this.world.distance(this.x, this.y + off, this.z, this.n) < PLAYER_RADIUS - 0.05 + (off > 1.2 ? 0.1 : 0)) return false;
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
