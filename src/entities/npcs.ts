// Town NPCs: data-driven definitions, arrival rules, homes, dialogue and
// shops. NPCs move into valid houses (see building/housing.ts), wander near
// home by day and stay inside at night.

import type { Inventory } from '../items/inventory';
import type { WorldCollision } from '../world/collision';
import { Creature, type CreatureDef } from './creatures';

export interface ShopEntry { item: string; count: number; price: number }

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  /** Arrival condition (checked when a vacant house exists). */
  canArrive(ctx: NpcContext): boolean;
  lines(ctx: NpcContext): string[];
  shop?: ShopEntry[];
  colors: { shirt: number; pants: number; hair: number; hat?: number };
}

export interface NpcContext {
  inv: Inventory;
  kills: number;
  bossDefeated: boolean;
  isNight: boolean;
  hasStation(id: string): boolean;
}

export const NPCS: NpcDef[] = [
  {
    id: 'surveyor', name: 'Aldo', title: 'the Surveyor',
    canArrive: () => true,
    colors: { shirt: 0x4a8a5a, pants: 0x5a4a3a, hair: 0x6a4a2a },
    lines: ctx => {
      const t: string[] = [];
      if (!ctx.hasStation('workbench')) t.push('Punch-drunk on wood? Craft a Workbench from 10 wood (Tab opens crafting), then place it.');
      else if (!ctx.hasStation('furnace')) t.push('Stone, wood and three torches make a Furnace. Smelt ore into bars in it.');
      else if (!ctx.hasStation('anvil')) t.push('Iron ore glints pale in the rock. Five iron bars make an Anvil for real tools and armor.');
      if (ctx.inv.count('gel') === 0) t.push('Globs drop gel. Gel and wood make torches — you will want lots of those underground.');
      t.push('Copper and iron can be mined with your starter pickaxe. Deepstone and glowing lumite need an Iron Pickaxe.');
      t.push('Old cabins are buried under the hills. Their chests hold boots, charms and other trinkets.');
      t.push('Those floating islands up high? Someone built shrines up there. Maybe a grappling hook would help.');
      t.push('Hollow Miners in the deep caves sometimes carry a barbed hook. With iron bars, that makes a grappling hook (press F).');
      if (ctx.isNight) t.push('Shamblers roam the surface at night. A house with a door keeps the worst of them away.');
      if (!ctx.bossDefeated) t.push('Something enormous burrows beneath us. Wyrm Bait from the anvil will call it — if you dare, and at night.');
      else t.push('You beat the Deepwyrm! Its scales can be forged into gear that bites through the Ember Depths.');
      return t;
    },
  },
  {
    id: 'merchant', name: 'Pell', title: 'the Merchant',
    canArrive: ctx => ctx.inv.count('coin') >= 30,
    colors: { shirt: 0x6a3a8a, pants: 0x3a3048, hair: 0xd8d0c0, hat: 0x3a2a4a },
    lines: () => [
      'Coins, coins, coins! Show me some and I will show you my wares.',
      'Torches, potions, arrows — everything an adventurer needs. At a fair price, of course.',
      'I once sold a bomb to a Glob. Never again.',
    ],
    shop: [
      { item: 'torch', count: 5, price: 3 },
      { item: 'healing_potion', count: 1, price: 12 },
      { item: 'wooden_arrow', count: 25, price: 6 },
      { item: 'bomb', count: 3, price: 15 },
      { item: 'glass_bottle', count: 2, price: 2 },
      { item: 'red_cap', count: 1, price: 4 },
      { item: 'gel', count: 5, price: 5 },
      { item: 'grappling_hook', count: 1, price: 150 },
    ],
  },
];

/** Physics body shape for townsfolk. */
const NPC_BODY: CreatureDef = {
  id: 'npc', name: 'Townsperson', hp: 250, damage: 0, defense: 10, speed: 1.6, ai: 'walker', radius: 0.35, height: 1.8, kbResist: 1,
  drops: [], spawn: null, color: 0xffffff,
};

export class Npc {
  body: Creature;
  target: { x: number; z: number } | null = null;
  wait = 2;
  talking = false;

  constructor(readonly def: NpcDef, public home: { x: number; y: number; z: number }) {
    this.body = new Creature(NPC_BODY, home.x, home.y, home.z);
  }

  update(dt: number, world: WorldCollision, night: boolean, px: number, pz: number) {
    const b = this.body;
    b.t += dt;
    let wantX = 0, wantZ = 0;
    if (this.talking) {
      b.yaw = Math.atan2(px - b.x, pz - b.z);
      this.target = null;
    } else {
      this.wait -= dt;
      if (!this.target && this.wait <= 0) {
        // Day: wander around home; night: stay inside.
        const r = night ? 1.5 : 7;
        const a = Math.random() * Math.PI * 2, k = Math.random() * r;
        this.target = { x: this.home.x + Math.cos(a) * k, z: this.home.z + Math.sin(a) * k };
      }
      if (this.target) {
        const dx = this.target.x - b.x, dz = this.target.z - b.z, d = Math.hypot(dx, dz);
        if (d < 0.4 || b.stuck > 1.5) { this.target = null; this.wait = 2 + Math.random() * 4; b.stuck = 0; }
        else { wantX = (dx / d) * 1.6; wantZ = (dz / d) * 1.6; b.yaw = Math.atan2(dx, dz); }
      }
    }
    b.vx += (wantX - b.vx) * Math.min(1, dt * 6);
    b.vz += (wantZ - b.vz) * Math.min(1, dt * 6);
    const ox = b.x, oz = b.z;
    b.physics(dt, world);
    b.stuck = this.target && Math.hypot(b.x - ox, b.z - oz) < 0.3 * dt ? b.stuck + dt : 0;
    // Never wander off: return home if far (e.g. home rebuilt elsewhere).
    if (Math.hypot(b.x - this.home.x, b.z - this.home.z) > 20) { b.x = this.home.x; b.y = this.home.y; b.z = this.home.z; }
  }

  /** A random line of dialogue. */
  chat(ctx: NpcContext) {
    const lines = this.def.lines(ctx);
    return lines[Math.floor(Math.random() * lines.length)];
  }
}

export function buy(inv: Inventory, e: ShopEntry): boolean {
  if (inv.count('coin') < e.price || !inv.hasRoomFor(e.item, e.count)) return false;
  inv.remove('coin', e.price);
  inv.add(e.item, e.count);
  return true;
}
