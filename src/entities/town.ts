// Town: registered houses, resident NPCs, periodic housing checks and NPC
// arrivals. Rendering of NPCs lives here as well (few objects).

import * as THREE from 'three';
import { checkHousing, type HousingResult } from '../building/housing';
import type { FurnitureSet } from '../building/furniture';
import type { Structures } from '../building/structures';
import { buildNpcVisual, type NpcVisual } from '../render/npcModels';
import type { WorldCollision } from '../world/collision';
import type { TerrainField } from '../world/terrain';
import { NPCS, Npc, type NpcContext } from './npcs';

export interface House { x: number; y: number; z: number; npc: string | null }

export class Town {
  readonly group = new THREE.Group();
  readonly houses: House[] = [];
  readonly npcs: Npc[] = [];
  private visuals = new Map<Npc, NpcVisual>();
  private autoTimer = 3;
  private arriveTimer = 8;
  onMessage: (text: string, color?: string) => void = () => {};

  constructor(
    private field: TerrainField,
    private structures: Structures,
    private furniture: FurnitureSet,
    private world: WorldCollision,
    private material: () => THREE.Material,
  ) {}

  check(x: number, y: number, z: number): HousingResult {
    return checkHousing(this.field, this.structures, this.furniture, x, y, z);
  }

  /** Validate the room around a point and register it as a house if valid. */
  tryRegister(x: number, y: number, z: number, announce: boolean): HousingResult {
    const r = this.check(x, y, z);
    if (!r.ok) {
      if (announce) this.onMessage(`Not valid housing: ${r.missing.join(', ')}`, '#ffb070');
      return r;
    }
    const known = this.houses.find(h => Math.hypot(h.x - r.center.x, h.y - r.center.y, h.z - r.center.z) < 3);
    if (known) {
      if (announce) this.onMessage(known.npc ? `This house belongs to ${NPCS.find(n => n.id === known.npc)!.name}.` : 'This house is valid and vacant.', '#9fd0ff');
      return r;
    }
    this.houses.push({ x: r.center.x, y: r.center.y - 1, z: r.center.z, npc: null });
    this.onMessage('This room is valid housing! Someone may move in soon.', '#9fd0ff');
    return r;
  }

  private spawnNpc(defId: string, house: House) {
    const def = NPCS.find(n => n.id === defId)!;
    const npc = new Npc(def, { x: house.x, y: house.y, z: house.z });
    house.npc = defId;
    this.npcs.push(npc);
    const v = buildNpcVisual(npc, this.material());
    this.visuals.set(npc, v);
    this.group.add(v.root);
    return npc;
  }

  update(dt: number, px: number, py: number, pz: number, night: boolean, ctx: NpcContext) {
    // Auto-validate rooms the player stands in when a door is nearby.
    this.autoTimer -= dt;
    if (this.autoTimer <= 0) {
      this.autoTimer = 3;
      if (this.furniture.near(px, py, pz, 8).some(f => f.type === 'door')) this.tryRegister(px, py, pz, false);
    }
    // Arrivals.
    this.arriveTimer -= dt;
    if (this.arriveTimer <= 0) {
      this.arriveTimer = 10;
      const vacant = this.houses.find(h => !h.npc);
      if (vacant) {
        const def = NPCS.find(d => !this.npcs.some(n => n.def.id === d.id) && d.canArrive(ctx));
        if (def) {
          this.spawnNpc(def.id, vacant);
          this.onMessage(`${def.name} ${def.title} has arrived!`, '#c89aff');
        }
      }
    }
    for (const n of this.npcs) {
      if (Math.hypot(n.body.x - px, n.body.z - pz) > 90) continue; // frozen when far
      n.update(dt, this.world, night, px, pz);
      const v = this.visuals.get(n)!;
      v.root.position.set(n.body.x, n.body.y, n.body.z);
      v.root.rotation.y = n.body.yaw;
      v.animate(n, dt);
    }
  }

  /** NPC along a ray within reach. */
  pick(o: THREE.Vector3, d: THREE.Vector3, reach: number): Npc | null {
    let best: Npc | null = null, bt = reach;
    for (const n of this.npcs) {
      const b = n.body;
      const tx = b.x - o.x, ty = b.y + 0.9 - o.y, tz = b.z - o.z;
      const t = tx * d.x + ty * d.y + tz * d.z;
      if (t < 0 || t > bt) continue;
      const ex = tx - d.x * t, ey = ty - d.y * t, ez = tz - d.z * t;
      if (ex * ex + (ey * 0.55) ** 2 + ez * ez < 0.45 * 0.45) { best = n; bt = t; }
    }
    return best;
  }

  serialize() {
    return { houses: this.houses.map(h => ({ ...h })), npcs: this.npcs.map(n => ({ id: n.def.id, x: n.body.x, y: n.body.y, z: n.body.z })) };
  }

  load(data: { houses: House[]; npcs: { id: string; x: number; y: number; z: number }[] } | undefined) {
    if (!data) return;
    for (const h of data.houses) this.houses.push({ ...h });
    for (const s of data.npcs) {
      const house = this.houses.find(h => h.npc === s.id);
      if (!house) continue;
      const n = this.spawnNpc(s.id, house);
      n.body.x = s.x; n.body.y = s.y; n.body.z = s.z;
    }
  }
}
