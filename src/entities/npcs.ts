// The wandering merchant: data (dialogue, stock pool) and the walking body
// shared with other NPCs. There are no settlers; see entities/merchant.ts for
// when the merchant visits and where he camps.

import type { Inventory } from '../items/inventory';
import type { WorldCollision } from '../world/collision';
import { Creature, type CreatureDef } from './creatures';

export interface ShopEntry { item: string; count: number; price: number }

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  lines(ctx: NpcContext): string[];
  shop?: ShopEntry[];
  colors: { shirt: number; pants: number; hair: number; hat?: number };
}

export interface NpcContext {
  inv: Inventory;
  kills: number;
  bossDefeated: boolean;
  raidDefeated: boolean;
  rocDefeated: boolean;
  isNight: boolean;
  /** Name of the running world event, if any. */
  event: string | null;
  hasStation(id: string): boolean;
}

/** Something the merchant may bring; `after` gates it behind progress. */
export interface StockItem extends ShopEntry { weight: number; after?: 'boss' | 'roc' | 'siege' }

/** Everything the merchant might carry. Each visit he brings a handful. */
export const MERCHANT_STOCK: StockItem[] = [
  { item: 'torch', count: 5, price: 3, weight: 99 },
  { item: 'healing_potion', count: 1, price: 12, weight: 99 },
  { item: 'mana_potion', count: 1, price: 14, weight: 6 },
  { item: 'wooden_arrow', count: 25, price: 6, weight: 6 },
  { item: 'bomb', count: 3, price: 15, weight: 5 },
  { item: 'glass_bottle', count: 2, price: 2, weight: 4 },
  { item: 'red_cap', count: 2, price: 6, weight: 4 },
  { item: 'rootwood', count: 10, price: 18, weight: 3 },
  { item: 'salt', count: 10, price: 14, weight: 3 },
  { item: 'fossil', count: 5, price: 30, weight: 2 },
  { item: 'salt_lamp', count: 1, price: 20, weight: 3 },
  { item: 'amber_lantern', count: 1, price: 45, weight: 2 },
  { item: 'grappling_hook', count: 1, price: 150, weight: 3 },
  { item: 'swift_boots', count: 1, price: 220, weight: 2 },
  { item: 'updraft_jar', count: 1, price: 280, weight: 2 },
  { item: 'feather_charm', count: 1, price: 180, weight: 2 },
  { item: 'miners_band', count: 1, price: 320, weight: 2 },
  { item: 'glow_charm', count: 1, price: 260, weight: 1 },
  { item: 'wyrm_bait', count: 1, price: 60, weight: 2 },
  { item: 'aerite_ore', count: 6, price: 40, weight: 2, after: 'boss' },
  { item: 'hollow_horn', count: 1, price: 90, weight: 3, after: 'boss' },
  { item: 'gale_idol', count: 1, price: 150, weight: 1, after: 'boss' },
  { item: 'lumite_bar', count: 3, price: 90, weight: 1, after: 'siege' },
];

export const MERCHANT: NpcDef = {
  id: 'merchant', name: 'Pell', title: 'the Wandering Merchant',
  colors: { shirt: 0x6a3a8a, pants: 0x3a3048, hair: 0xd8d0c0, hat: 0x3a2a4a },
  lines: ctx => {
    const t: string[] = [
      'Amber, friend. Real amber, with the spark still in it. Show me some and I will show you my pack.',
      'I never stay long. By nightfall I am on the road again, and the pack changes every time.',
      'I once traded a bomb to a Blob. It ate it. We were both disappointed.',
      'Salt from the Flats keeps meat and mends wounds. Brew it at a Hearth with a red cap if you don\'t believe me.',
      'Build on foundations, friend. They stay level on any slope, and I have seen too many houses slide downhill.',
      'Red crystals grow in the caves. Break one and drink in its essence and you will stand up to a lot more.',
      'On clear nights seeds of light drift down. Catch five and they condense into Blue Essence.',
      'The Rootwold, the salt flats, the Amberwood: every land has its own stone and wood. I buy from all of them.',
    ];
    if (!ctx.hasStation('hearth')) t.push('No fire yet? Stone, wood and two torches make a Hearth. Rest by it under a roof and you will feel it.');
    if (!ctx.bossDefeated) t.push('Something vast burrows under this land. Drive a Tremor Totem into the ground at night and it will come to you.');
    else t.push('You felled the Deepwyrm! Now the Cinderbound will have felt it. They come up from the mountains for fire when the deep goes quiet.');
    if (ctx.isNight) t.push('Out after dark? The Rootwalkers pull themselves from the soil, and Drifters come down from the clouds.');
    if (ctx.event === 'Sporefall') t.push('Spores! Cover your mouth. The things walking in this light drop Sporeglass, if you are brave.');
    if (ctx.event === 'The Cinder Siege') t.push('The Cinderbound are here for your fire! Hold them off and they give up.');
    return t;
  },
  shop: [],
};

/** Physics body shape for people. */
const NPC_BODY: CreatureDef = {
  id: 'npc', name: 'Traveller', hp: 250, damage: 0, defense: 10, speed: 1.6, ai: 'walker', radius: 0.35, height: 1.8, kbResist: 1,
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
        // Potter about the camp; stay close to it at night.
        const r = night ? 1.5 : 5;
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
