// The wandering merchant. Nobody moves in: every few days, at dawn, the
// merchant arrives with a pack cart and camps near your spawn point (your bed,
// or where you first arrived), sells a handful of goods drawn from a pool that
// grows as you progress, and moves on at dusk. Talk to him for tips.

import * as THREE from 'three';
import { mulberry32 } from '../core/noise';
import { parts } from '../render/models';
import { buildNpcVisual, type NpcVisual } from '../render/npcModels';
import type { WorldCollision } from '../world/collision';
import { MERCHANT, MERCHANT_STOCK, Npc, type ShopEntry } from './npcs';

/** Days between visits (a visit lasts from dawn until dusk). */
const VISIT_EVERY = [2, 3];
/** How many goods he brings besides torches and red elixirs. */
const EXTRA_GOODS = 5;

export interface MerchantState {
  /** Day number of the next visit. */
  next: number;
  /** Present right now: camp position and today's goods. */
  camp: { x: number; y: number; z: number; stock: ShopEntry[] } | null;
}

export interface Progress { bossDefeated: boolean; rocDefeated: boolean; raidDefeated: boolean }

export class WanderingMerchant {
  readonly group = new THREE.Group();
  npc: Npc | null = null;
  private visual: NpcVisual | null = null;
  private cart: THREE.Mesh | null = null;
  state: MerchantState = { next: 2, camp: null };
  onMessage: (text: string, color?: string) => void = () => {};

  constructor(private world: WorldCollision, private material: () => THREE.Material) {}

  /** Goods for a visit: staples plus a seeded handful from the unlocked pool. */
  static stockFor(day: number, seed: number, p: Progress): ShopEntry[] {
    const rand = mulberry32(seed * 131 + day * 7919);
    const open = MERCHANT_STOCK.filter(s => s.weight < 99 && (!s.after || (s.after === 'boss' ? p.bossDefeated : s.after === 'roc' ? p.rocDefeated : p.raidDefeated)));
    const out: ShopEntry[] = MERCHANT_STOCK.filter(s => s.weight >= 99).map(({ item, count, price }) => ({ item, count, price }));
    while (out.length < EXTRA_GOODS + 2 && open.length) {
      const total = open.reduce((a, s) => a + s.weight, 0);
      let r = rand() * total, i = 0;
      while ((r -= open[i].weight) > 0) i++;
      const [s] = open.splice(i, 1);
      out.push({ item: s.item, count: s.count, price: s.price });
    }
    return out;
  }

  /**
   * @param day      current day number (1-based)
   * @param dawn     true on the frame night turns into day
   * @param dusk     true on the frame day turns into night
   * @param campAt   where to camp (near the player's spawn point), or null if nowhere suitable
   */
  update(dt: number, day: number, dawn: boolean, dusk: boolean, seed: number, progress: Progress, campAt: () => { x: number; y: number; z: number } | null, px: number, pz: number, night: boolean) {
    if (dawn && !this.state.camp && day >= this.state.next) {
      const spot = campAt();
      if (spot) {
        this.arrive({ ...spot, stock: WanderingMerchant.stockFor(day, seed, progress) });
        const rand = mulberry32(seed + day);
        this.state.next = day + VISIT_EVERY[0] + Math.floor(rand() * (VISIT_EVERY[1] - VISIT_EVERY[0] + 1));
        this.onMessage('A wandering merchant has set up camp nearby.', '#ffe08a');
      }
    }
    if (dusk && this.state.camp) {
      this.leave();
      this.onMessage('The merchant packs up his cart and moves on.', '#c8b8a0');
    }
    const n = this.npc;
    if (!n || !this.visual) return;
    if (Math.hypot(n.body.x - px, n.body.z - pz) > 90) return; // frozen when far
    n.update(dt, this.world, night, px, pz);
    this.visual.root.position.set(n.body.x, n.body.y, n.body.z);
    this.visual.root.rotation.y = n.body.yaw;
    this.visual.animate(n, dt);
  }

  /** Put the merchant and his cart at a camp (arrival or loading a save). */
  arrive(camp: NonNullable<MerchantState['camp']>) {
    this.leave();
    this.state.camp = camp;
    this.npc = new Npc({ ...MERCHANT, shop: camp.stock }, { x: camp.x, y: camp.y, z: camp.z });
    this.visual = buildNpcVisual(this.npc, this.material());
    this.group.add(this.visual.root);
    this.cart = new THREE.Mesh(cartModel(), this.material());
    this.cart.position.set(camp.x + 1.8, camp.y, camp.z + 0.6);
    this.cart.rotation.y = 0.6;
    this.cart.castShadow = true;
    this.group.add(this.cart);
  }

  leave() {
    if (this.visual) this.group.remove(this.visual.root);
    if (this.cart) this.group.remove(this.cart);
    this.npc = null; this.visual = null; this.cart = null;
    this.state.camp = null;
  }

  /** The merchant along a ray within reach. */
  pick(o: THREE.Vector3, d: THREE.Vector3, reach: number): Npc | null {
    const n = this.npc;
    if (!n) return null;
    const b = n.body;
    const tx = b.x - o.x, ty = b.y + 0.9 - o.y, tz = b.z - o.z;
    const t = tx * d.x + ty * d.y + tz * d.z;
    if (t < 0 || t > reach) return null;
    const ex = tx - d.x * t, ey = ty - d.y * t, ez = tz - d.z * t;
    return ex * ex + (ey * 0.55) ** 2 + ez * ez < 0.45 * 0.45 ? n : null;
  }

  serialize(): MerchantState {
    return { next: this.state.next, camp: this.state.camp && { ...this.state.camp, stock: this.state.camp.stock.map(s => ({ ...s })) } };
  }

  load(s: MerchantState | undefined) {
    if (!s) return;
    this.state.next = s.next;
    if (s.camp) this.arrive(s.camp);
  }
}

/** A two-wheeled pack cart with a striped canopy and hanging lantern. */
function cartModel() {
  const { box, cyl, octa, taper, merge } = parts;
  return merge([
    box(1.3, 0.12, 0.8, 'planks', { y: 0.5 }),
    box(1.3, 0.35, 0.06, 'planks', { y: 0.72, z: 0.37 }),
    box(1.3, 0.35, 0.06, 'planks', { y: 0.72, z: -0.37 }),
    box(0.06, 0.35, 0.8, 'planks', { x: 0.62, y: 0.72 }),
    ...[0.37, -0.37].map(z => cyl(0.36, 0.36, 0.08, 10, 'planks', { y: 0.36, z, rx: Math.PI / 2 }, 0x8a6040)),
    cyl(0.04, 0.04, 0.9, 5, 'metal', { y: 0.36, rx: Math.PI / 2 }),
    box(1.0, 0.05, 0.06, 'planks', { x: -1.1, y: 0.52 }),
    ...[[0.55, 0.35], [0.55, -0.35], [-0.55, 0.35], [-0.55, -0.35]].map(([x, z]) => box(0.05, 0.8, 0.05, 'planks', { x, y: 1.2, z })),
    taper(1.35, 0.35, 0.95, 1, 0.2, 'cloth', { y: 1.72 }),
    box(0.5, 0.35, 0.4, 'fabric', { x: -0.2, y: 0.75 }, 0xc8a070),
    box(0.35, 0.28, 0.35, 'fabric', { x: 0.3, y: 0.72, z: 0.05 }, 0x7a5236),
    octa(0.07, 'flame', { x: 0.62, y: 1.35, z: 0.45 }, 0xffd070),
  ]);
}
