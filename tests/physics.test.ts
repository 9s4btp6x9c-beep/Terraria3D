import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Structures } from '../src/building/structures';
import { PlayerController } from '../src/player/controller';
import { LightPool } from '../src/render/atmosphere';
import { createWorldUniforms } from '../src/render/worldMaterial';
import { WorldCollision } from '../src/world/collision';
import { defaultConfig } from '../src/world/config';
import { DENSITY_CLAMP, TerrainField } from '../src/world/terrain';

/** A field made purely from a density function (no chunks resident). */
function world(density: (x: number, y: number, z: number) => number) {
  const field = new TerrainField({ ...defaultConfig(1), chunksX: 2, chunksZ: 2 });
  field.fallback = (x, y, z) => Math.max(-DENSITY_CLAMP, Math.min(DENSITY_CLAMP, density(x, y, z)));
  const player = new PlayerController(new WorldCollision(field, new Structures(), null, null));
  return { field, player };
}

const still = { forward: 0, strafe: 0, jump: false, sprint: false, crouch: false };

/** Run `frames` frames at 60 fps; returns the eye heights seen. */
function run(player: PlayerController, frames: number) {
  const eyes: number[] = [];
  for (let i = 0; i < frames; i++) {
    player.update(1 / 60, still, null);
    eyes.push(player.y + player.eyeHeight);
  }
  return eyes;
}

const travel = (v: number[]) => v.slice(1).reduce((s, x, i) => s + Math.abs(x - v[i]), 0);

describe('player collision', () => {
  it('stands still on a floor whose density jumps steeply (no bouncing)', () => {
    // Solid clamped right up to a sharp step, as under the Ember Depths.
    const { player } = world((_x, y) => (y <= 5 ? 8 : -5.5));
    player.teleport(20, 6, 20);
    run(player, 60);
    expect(travel(run(player, 120))).toBeLessThan(0.01);
    expect(player.grounded).toBe(true);
  });

  it('ducks under a low ceiling and stays ducked without flickering', () => {
    // Floor at y = 5, ceiling at 6.7: too low to stand in.
    const { player } = world((_x, y) => Math.max(5 - y, y - 6.7));
    player.teleport(20, 5.05, 20);
    run(player, 30);
    expect(player.crouching).toBe(true);
    const eyes = run(player, 120);
    expect(travel(eyes)).toBeLessThan(0.01);
    expect(player.crouching).toBe(true);
  });

  it('climbs out of solid rock instead of sinking through it', () => {
    // Deep inside the clamped interior the density is flat (no gradient).
    const { player } = world((_x, y) => 30 - y);
    player.teleport(20, 12, 20);
    run(player, 180);
    expect(player.y).toBeGreaterThan(29);
  });
});

describe('light pool', () => {
  it('fades lights in and out instead of strobing, and flashes never evict them', () => {
    const tex = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1);
    const u = createWorldUniforms(tex, new THREE.DataTexture(new Uint16Array(1), 1, 1), 1, 1);
    const pool = new LightPool();
    // A ring of 12 torches (more than there are slots), no flicker.
    const ids = Array.from({ length: 12 }, (_, i) => pool.add({ x: Math.cos(i / 2) * (8 + i), y: 0, z: Math.sin(i / 2) * (8 + i), color: new THREE.Color(1, 1, 1), range: 10 }));
    expect(ids.length).toBe(12);
    const cam = new THREE.Vector3();
    const brightness = () => {
      const m = new Map<string, number>();
      for (let i = 1; i < u.uLightPos.value.length; i++) {
        const p = u.uLightPos.value[i];
        if (p.y > -500) m.set(`${p.x.toFixed(3)},${p.z.toFixed(3)}`, u.uLightColor.value[i].r);
      }
      return m;
    };
    const dt = 1 / 60;
    let prev = brightness();
    for (let f = 0; f < 400; f++) {
      // Wander the camera around, and throw sparks now and then.
      cam.set(Math.sin(f / 40) * 12, 0, Math.cos(f / 55) * 12);
      if (f % 7 === 0) pool.flash(cam.x + 1, 0, cam.z, 0xffffff, 6, 0.2);
      pool.update(dt, cam, u, f * dt);
      const now = brightness();
      for (const key of new Set([...prev.keys(), ...now.keys()])) {
        const a = prev.get(key) ?? 0, b = now.get(key) ?? 0;
        // Flashes live at the camera, so only torches are checked here.
        const torch = ids.some((_, i) => key === `${(Math.cos(i / 2) * (8 + i)).toFixed(3)},${(Math.sin(i / 2) * (8 + i)).toFixed(3)}`);
        if (torch) expect(Math.abs(b - a)).toBeLessThanOrEqual(dt * 4 + 1e-6);
      }
      prev = now;
    }
  });
});
