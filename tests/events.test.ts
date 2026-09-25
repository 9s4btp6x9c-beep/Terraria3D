import { describe, expect, it } from 'vitest';
import { WorldEvents, type EventWorld } from '../src/entities/events';

const world = (daylight: number, extra: Partial<EventWorld> = {}): EventWorld => ({
  daylight, px: 100, pz: 100, town: { x: 100, z: 100, npcs: 2 }, bossDefeated: false, ...extra,
});

/** Advance through `n` full day/night cycles, collecting signals. */
function cycle(ev: WorldEvents, n: number, extra: Partial<EventWorld> = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(...ev.update(1, world(1, extra)));
    out.push(...ev.update(1, world(0, extra)));
  }
  out.push(...ev.update(1, world(1, extra)));
  return out;
}

describe('world events', () => {
  it('the first night is never a Blood Moon', () => {
    const ev = new WorldEvents(() => 0);
    ev.update(1, world(1));
    const s = ev.update(1, world(0));
    expect(s).toEqual([]);
    expect(ev.kind).toBeNull();
  });

  it('a later night can bring the Blood Moon, which ends at dawn', () => {
    const ev = new WorldEvents(() => 0);
    cycle(ev, 1);
    const start = ev.update(1, world(0));
    expect(start).toEqual([{ type: 'start', kind: 'blood_moon' }]);
    expect(ev.kind).toBe('blood_moon');
    const end = ev.update(1, world(1));
    expect(end[0]).toEqual({ type: 'end', kind: 'blood_moon', won: true });
    expect(ev.kind).toBeNull();
  });

  it('with bad luck nothing happens', () => {
    const ev = new WorldEvents(() => 0.99);
    const s = cycle(ev, 10, { bossDefeated: true });
    expect(s).toEqual([]);
  });

  it('raids need the boss defeated and a town with two residents', () => {
    const ev = new WorldEvents(() => 0.2); // above the Blood Moon odds, below the raid odds
    expect(cycle(ev, 3, { bossDefeated: false })).toEqual([]);
    expect(cycle(ev, 3, { bossDefeated: true, town: { x: 100, z: 100, npcs: 1 } })).toEqual([]);
    const s = cycle(ev, 1, { bossDefeated: true });
    expect(s).toContainEqual({ type: 'start', kind: 'raid' });
    expect(ev.goal).toBe(46);
  });

  it('killing enough raiders wins the raid', () => {
    const ev = new WorldEvents();
    ev.start('raid', { town: { x: 0, z: 0, npcs: 0 }, px: 0, pz: 0 });
    for (let i = 0; i < 29; i++) expect(ev.kill()[0].type).toBe('progress');
    expect(ev.kill()).toEqual([{ type: 'end', kind: 'raid', won: true }]);
    expect(ev.active).toBe(false);
  });

  it('abandoning the town loses the raid', () => {
    const ev = new WorldEvents();
    ev.start('raid', { town: { x: 0, z: 0, npcs: 0 }, px: 0, pz: 0 });
    let s = ev.update(10, world(1, { px: 500, pz: 0 }));
    expect(s).toEqual([]);
    s = ev.update(15, world(1, { px: 500, pz: 0 }));
    expect(s).toEqual([{ type: 'end', kind: 'raid', won: false }]);
  });

  it('a Blood Moon loaded in daylight ends straight away', () => {
    const ev = new WorldEvents(() => 0.99);
    ev.load({ kind: 'blood_moon', progress: 0, goal: 0, target: null, nights: 3 });
    expect(ev.update(1, world(1))).toEqual([{ type: 'end', kind: 'blood_moon', won: true }]);
  });

  it('round-trips through a save', () => {
    const ev = new WorldEvents();
    ev.start('raid', { town: { x: 5, z: 6, npcs: 1 }, px: 0, pz: 0 });
    ev.kill();
    const copy = new WorldEvents();
    copy.load(JSON.parse(JSON.stringify(ev.serialize())));
    expect(copy.kind).toBe('raid');
    expect(copy.progress).toBe(1);
    expect(copy.target).toEqual({ x: 5, z: 6 });
  });
});
