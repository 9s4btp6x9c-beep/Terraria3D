import { describe, expect, it } from 'vitest';
import { PIECES, Structures, pieceSDF } from '../src/building/structures';
import { editSample } from '../src/world/edits';

// Aim at a point with a surface normal, player looking toward -z (yaw 0) unless given.
const place = (s: Structures, shape: Parameters<Structures['place']>[0], x: number, y: number, z: number, n: [number, number, number] = [0, 1, 0], yaw = 0, opts = {}) =>
  s.place(shape, x, y, z, n[0], n[1], n[2], yaw, opts);

/** A 1-cell room: floor at y=10 in cell (1,1) with walls on all four edges. */
function room() {
  const s = new Structures();
  s.add({ shape: 'floor', texture: 'planks', x: 1, y: 10, z: 1, rot: 0 });
  for (const [x, z, rot] of [[1, 0, 0], [1, 2, 0], [0, 1, 1], [2, 1, 1]]) s.add({ shape: 'wall', texture: 'planks', x, y: 10.25, z, rot });
  return s;
}

describe('snapping to what is built', () => {
  it('a wall aimed at a floor edge stands on the floor top', () => {
    const s = new Structures();
    s.add({ shape: 'floor', texture: 'planks', x: 1, y: 10, z: 1, rot: 0 });
    const p = place(s, 'wall', 1.3, 10.25, 0.1);
    expect(p).toMatchObject({ x: 1, z: 0, y: 10.25, snapped: true });
  });

  it('a wall aimed anywhere on another wall stacks exactly on top of it', () => {
    const s = room();
    for (const y of [10.6, 11.5, 12.4]) {
      const p = place(s, 'wall', 1.2, y, 0.1, [0, 0, 1]);
      expect(p.y).toBeCloseTo(12.75, 5);
      expect([p.x, p.z]).toEqual([1, 0]);
    }
  });

  it('a floor aimed at a wall top becomes the next storey', () => {
    const s = room();
    const p = place(s, 'floor', 1.1, 12.75, 0.05, [0, 1, 0], Math.PI); // looking toward +z, over the wall
    expect(p).toMatchObject({ x: 1, z: 1, y: 12.75 });
  });

  it('floors lie level with their neighbours on uneven ground', () => {
    const s = new Structures();
    s.add({ shape: 'floor', texture: 'planks', x: 1, y: 10, z: 1, rot: 0 });
    // The ground in the next cell is 0.8 m lower; the new floor still lines up.
    const p = place(s, 'floor', 3.2, 9.3, 1.1);
    expect(p).toMatchObject({ x: 3, z: 1, y: 10 });
    // Free placement ignores neighbours.
    expect(place(s, 'floor', 3.2, 9.3, 1.1, [0, 1, 0], 0, { free: true }).y).toBe(9.25);
  });

  it('roofs rest on wall tops and continue each other up the slope', () => {
    const s = room();
    const yaw = Math.PI; // looking toward +z: panels rise toward +z
    const a = place(s, 'roof', 1, 12.6, 1, [0, 1, 0], yaw);
    expect(a).toMatchObject({ x: 1, z: 1, rot: 0, y: 12.75 });
    s.add({ shape: 'roof', texture: 'planks', x: a.x, y: a.y, z: a.z, rot: a.rot });
    const b = place(s, 'roof', 1, 14.6, 3, [0, 1, 0], yaw);
    expect(b).toMatchObject({ x: 1, z: 3, y: 14.75 });
    // The panel rises toward its front.
    const r = s.add({ shape: 'roof', texture: 'planks', x: 1, y: 0, z: 1, rot: 0 });
    expect(pieceSDF(r, 1, 1.9, 1.95)).toBeLessThan(0.2);
    expect(pieceSDF(r, 1, 1.9, 0.05)).toBeGreaterThan(1);
  });

  it('foundations stand above the highest ground and reach below the lowest', () => {
    const s = new Structures();
    const ground = (x: number) => 20 + (x - 2) * 0.6; // slopes up toward +x
    const p = place(s, 'foundation', 3, ground(3), 3, [0, 1, 0], 0, { ground: (x: number) => ground(x) });
    const hi = ground(3.9), lo = ground(2.1);
    expect(p.y + PIECES.foundation.top).toBeGreaterThanOrEqual(hi);
    expect(p.y - (p.ext ?? 0)).toBeLessThan(lo);
    const f = s.add({ shape: 'foundation', texture: 'bricks', x: p.x, y: p.y, z: p.z, rot: 0, ext: p.ext });
    expect(pieceSDF(f, 3, lo - 0.2, 3)).toBeLessThan(0);
  });

  it('gables are triangles: tall at one end, nothing at the other', () => {
    const s = new Structures();
    const g = s.add({ shape: 'gable', texture: 'planks', x: 0, y: 0, z: 0, rot: 0 });
    expect(pieceSDF(g, 0.9, 1.7, 0)).toBeLessThan(0);
    expect(pieceSDF(g, -0.9, 1.7, 0)).toBeGreaterThan(0.5);
    // [R] flips it.
    const f = s.add({ shape: 'gable', texture: 'planks', x: 10, y: 0, z: 0, rot: 2 });
    expect(pieceSDF(f, 10 - 0.9, 1.7, 0)).toBeLessThan(0);
  });

  it('a doorway leaves a walk-through opening', () => {
    const s = new Structures();
    const d = s.add({ shape: 'doorway', texture: 'planks', x: 0, y: 0, z: 0, rot: 0 });
    expect(pieceSDF(d, 0, 1, 0)).toBeGreaterThan(0.3);
    expect(pieceSDF(d, 0.8, 1, 0)).toBeLessThan(0);
  });
});

describe('level ground', () => {
  it('cuts above the target height and fills below it, fading at the rim', () => {
    const e: [number, number, number, number, number, number, number] = [2, 0, 10, 0, 2.6, 2, 0];
    const out: [number] = [0];
    // A hump of dirt (solid) one metre above the target becomes air.
    expect(editSample(2, 2, 0, 1, 0, e, out)).toBeLessThan(0);
    // A dip (air) one metre below becomes solid dirt.
    expect(editSample(-2, 0, 0, -1, 0, e, out)).toBeGreaterThan(0);
    expect(out[0]).toBe(2);
    // Outside the radius nothing changes.
    expect(Number.isNaN(editSample(2, 2, 3, 1, 0, e, out))).toBe(true);
  });
});
