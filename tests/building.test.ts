import { describe, expect, it } from 'vitest';
import { Structures, pieceSDF } from '../src/building/structures';
import { defaultConfig } from '../src/world/config';
import { WorldGenerator } from '../src/world/generator';
import { EditLog } from '../src/world/persistence';
import { TerrainField } from '../src/world/terrain';
import { fillChunk } from '../src/world/terrainJobs';

describe('building pieces', () => {
  it('floor SDF is negative inside and positive above', () => {
    const s = new Structures();
    const p = s.add({ shape: 'floor', texture: 'planks', x: 1, y: 10, z: 1, rot: 0 });
    expect(pieceSDF(p, 1, 10.1, 1)).toBeLessThan(0);
    expect(pieceSDF(p, 1, 11, 1)).toBeCloseTo(0.75, 2);
  });

  it('stairs rise away from the player', () => {
    const s = new Structures();
    // Player looking toward -z (yaw 0): stairs should rise toward -z.
    const pos = Structures.snap('stairs', 3, 10, 3, 0, 1, 0, 0);
    const p = s.add({ shape: 'stairs', texture: 'planks', ...pos });
    const near = pieceSDF(p, pos.x, pos.y + 1.2, pos.z + 0.8);
    const far = pieceSDF(p, pos.x, pos.y + 1.2, pos.z - 0.8);
    expect(far).toBeLessThan(near);
  });

  it('walls snap to the nearest cell edge', () => {
    const w = Structures.snap('wall', 2.2, 5, 3, 0, 1, 0, 0);
    expect(w.x).toBe(2);
    expect(w.rot).toBe(1);
  });

  it('raycast hits a placed wall', () => {
    const s = new Structures();
    s.add({ shape: 'wall', texture: 'planks', x: 5, y: 0, z: 10, rot: 0 });
    const hit = s.raycast(5, 1, 5, 0, 0, 1, 10);
    expect(hit).not.toBeNull();
    expect(hit!.z).toBeCloseTo(9.9, 1);
    expect(hit!.nz).toBeLessThan(-0.9);
  });
});

describe('persistence', () => {
  it('replaying the edit log reproduces the edited field exactly', () => {
    const cfg = { ...defaultConfig(99), chunksX: 8, chunksZ: 8 };
    const gen = new WorldGenerator(cfg);
    const make = () => {
      const f = new TerrainField(cfg);
      for (const c of f.chunks) if (c.cx >= 3 && c.cx <= 4 && c.cz >= 3 && c.cz <= 4) fillChunk(gen, c);
      return f;
    };
    const a = make();
    const log = new EditLog(cfg);
    const y = gen.height(128, 128);
    for (let i = 0; i < 6; i++) log.commit(a, 'sub', 128.123 + i * 0.7, y - 2.456, 128.3, 1.35, 0, 0);
    log.commit(a, 'add', 130, y + 1, 130, 1.1, 3, 99);

    const b = make();
    for (const e of JSON.parse(JSON.stringify(log.edits))) b.applyEdit(e);
    for (let x = 120; x < 140; x++)
      for (let yy = Math.floor(y) - 6; yy < y + 4; yy++)
        for (let z = 120; z < 140; z++) {
          expect(b.density(x, yy, z)).toBe(a.density(x, yy, z));
          expect(b.material(x, yy, z)).toBe(a.material(x, yy, z));
        }
  });
});
