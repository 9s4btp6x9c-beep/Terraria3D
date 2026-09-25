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
  raidDefeated: boolean;
  rocDefeated: boolean;
  isNight: boolean;
  /** Name of the running world event, if any. */
  event: string | null;
  hasStation(id: string): boolean;
}

export const NPCS: NpcDef[] = [
  {
    id: 'surveyor', name: 'Aldo', title: 'the Lamplighter',
    canArrive: () => true,
    colors: { shirt: 0x4a8a5a, pants: 0x5a4a3a, hair: 0x6a4a2a },
    lines: ctx => {
      const t: string[] = [];
      if (!ctx.hasStation('workbench')) t.push('First light, then everything else. Ten wood makes a Workbench — Tab opens crafting.');
      else if (!ctx.hasStation('hearth')) t.push('Stone, wood and two torches make a Hearth. No settler stays where there is no fire to sit by.');
      else if (!ctx.hasStation('furnace')) t.push('Stone, wood and three torches make a Furnace. Smelt your ore into bars.');
      else if (!ctx.hasStation('anvil')) t.push('Iron ore glints pale in the rock. Five iron bars make an Anvil for real tools and armor.');
      if (ctx.inv.count('gel') === 0) t.push('Burrlings ooze sap when you pop them. Sap and wood make torches, and you will want a lot of torches.');
      t.push('I keep the lamps lit so folk can find their way home. A room with a door, a Hearth and a bed is a home.');
      t.push('Heartroots grow in the caves: roots curled round a little ember. Break one open and the warmth stays with you.');
      t.push('On clear nights the stars shed seeds of light. They drift slow — run and catch them before they fade at dawn.');
      t.push('West of here the roots of something enormous rise out of the moss. The Rootwold. Their wood rings like stone.');
      t.push('Out on the salt flats lie the bones of titans. Nobody knows what killed them. Bring me a rib and I\'ll sleep worse.');
      t.push('The Amberwood bleeds resin that glows. Pell pays in amber, so you could say money grows on trees there.');
      t.push('Stay clear of the Riftlands at dusk. The ground is split to the bone, and the light down there is the wrong colour.');
      t.push('Old cabins are buried under the hills. Their chests hold boots, charms and other trinkets.');
      t.push('The islands up high are laced with aerite — pale blue ore, light as air. A grappling hook helps you reach them.');
      if (!ctx.rocDefeated) t.push('Gale Swifts nest on the islands. Enough of their feathers and some aerite make an idol, and a great bird answers it.');
      else t.push('You brought down the Tempest Roc! With its wings you can finally reach every island.');
      if (ctx.isNight) t.push('Rootwalkers pull themselves out of the soil after dark, and Drifters come down from the clouds. Keep a lamp burning.');
      if (ctx.event === 'Sporefall') t.push('Spores! Breathe through your sleeve. The things that walk in this light drop Sporeglass, if you are brave.');
      else t.push('Some nights the sky turns green and spores fall like snow. Everything that walks in it has gone to rot.');
      if (!ctx.bossDefeated) t.push('Something vast burrows beneath us. Drive a Tremor Totem into the ground at night and it will come.');
      else t.push('You beat the Deepwyrm! Its scales can be forged into gear that bites through the Ember Depths.');
      if (ctx.bossDefeated && !ctx.raidDefeated) t.push('The Hollowfolk will have felt the Deepwyrm fall. Expect them to march on this town, or call them with a war horn.');
      if (ctx.event === 'The Hollow March') t.push('They\'re marching! Hold the line. They lose heart once enough of them fall.');
      return t;
    },
  },
  {
    id: 'merchant', name: 'Pell', title: 'the Wayfarer',
    canArrive: ctx => ctx.inv.count('coin') >= 30,
    colors: { shirt: 0x6a3a8a, pants: 0x3a3048, hair: 0xd8d0c0, hat: 0x3a2a4a },
    lines: () => [
      'Amber, friend. Real amber, with the spark still in it. Show me some and I\'ll show you my pack.',
      'Torches, draughts, arrows. I walked them here from three biomes away, so the price is the price.',
      'I once traded a bomb to a Burrling. It ate it. We were both disappointed.',
      'Salt from the Flats keeps meat and mends wounds. Brew it at a Hearth with a red cap if you don\'t believe me.',
    ],
    shop: [
      { item: 'torch', count: 5, price: 3 },
      { item: 'healing_potion', count: 1, price: 12 },
      { item: 'wooden_arrow', count: 25, price: 6 },
      { item: 'bomb', count: 3, price: 15 },
      { item: 'glass_bottle', count: 2, price: 2 },
      { item: 'red_cap', count: 1, price: 4 },
      { item: 'gel', count: 5, price: 5 },
      { item: 'salt_lamp', count: 1, price: 20 },
      { item: 'grappling_hook', count: 1, price: 150 },
    ],
  },
  {
    id: 'tinkerer', name: 'Wren', title: 'the Clockwright',
    canArrive: ctx => ctx.raidDefeated,
    colors: { shirt: 0xc07a2a, pants: 0x4a4a58, hair: 0xa84a2a },
    lines: ctx => [
      'I followed the Hollow March here to see who could turn it back. Turns out it was you.',
      'Boots, jars, charms. I rebuild whatever the Hollowfolk leave behind, springs and all. For a price.',
      'A Delver\'s Band and Burrowing Claws together? You\'d dig faster than the Deepwyrm.',
      ctx.isNight ? 'Night work is the best work. Fewer interruptions — mostly.' : 'Have you tried jumping twice? No? Then you need an Updraft Jar.',
    ],
    shop: [
      { item: 'swift_boots', count: 1, price: 220 },
      { item: 'updraft_jar', count: 1, price: 280 },
      { item: 'feather_charm', count: 1, price: 180 },
      { item: 'miners_band', count: 1, price: 320 },
      { item: 'hollow_horn', count: 1, price: 90 },
      { item: 'bomb', count: 5, price: 20 },
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
