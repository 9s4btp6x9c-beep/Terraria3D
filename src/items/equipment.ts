// Equipment: armor slots + accessory slots, and the derived player stats.
// Accessories are data (items.ts); adding one needs no code here.

import type { Stack } from './inventory';
import { type ItemDef, item } from './items';

export interface PlayerStats {
  defense: number;
  moveSpeed: number;
  extraJumps: number;
  noFallDamage: boolean;
  miningSpeed: number;
  lightBoost: number;
  hook: { range: number; speed: number } | null;
  regen: number;
  /** Seconds of wing flight (0 = no wings). */
  flight: number;
  setBonus: string | null;
  /** Wade through lava unharmed (full Ember armor). */
  lavaProof: boolean;
}

const SLOT_DEFS: { label: string; accepts(def: ItemDef): boolean }[] = [
  { label: 'Head', accepts: d => d.armor?.slot === 'head' },
  { label: 'Body', accepts: d => d.armor?.slot === 'body' },
  { label: 'Legs', accepts: d => d.armor?.slot === 'legs' },
  ...[1, 2, 3, 4].map(n => ({ label: `Acc ${n}`, accepts: (d: ItemDef) => d.kind === 'accessory' })),
];

export class Equipment {
  readonly items: (Stack | null)[] = new Array(SLOT_DEFS.length).fill(null);
  private listeners: (() => void)[] = [];

  onChange(fn: () => void) { this.listeners.push(fn); }

  get slots() {
    return SLOT_DEFS.map((d, i) => ({ label: d.label, stack: this.items[i], accepts: d.accepts }));
  }

  set(i: number, s: Stack | null) {
    // Accessories are unique: one of each kind equipped.
    if (s && i >= 3 && this.items.some((o, j) => j !== i && o?.id === s.id)) return;
    this.items[i] = s;
    for (const f of this.listeners) f();
  }

  /** Equip from inventory (e.g. right-click / quick equip). Returns the replaced stack. */
  equip(s: Stack): Stack | null | false {
    const def = item(s.id);
    const idx = SLOT_DEFS.findIndex((d, i) => d.accepts(def) && (i < 3 || !this.items[i]));
    const i = idx >= 0 ? idx : SLOT_DEFS.findIndex(d => d.accepts(def));
    if (i < 0) return false;
    const prev = this.items[i];
    this.set(i, { id: s.id, count: 1 });
    return prev;
  }

  stats(): PlayerStats {
    const st: PlayerStats = { defense: 0, moveSpeed: 1, extraJumps: 0, noFallDamage: false, miningSpeed: 1, lightBoost: 0, hook: null, regen: 0, flight: 0, setBonus: null, lavaProof: false };
    const sets = new Map<string, number>();
    for (const s of this.items) {
      if (!s) continue;
      const d = item(s.id);
      if (d.armor) {
        st.defense += d.armor.defense;
        if (d.armor.set) sets.set(d.armor.set, (sets.get(d.armor.set) ?? 0) + 1);
      }
      const a = d.accessory;
      if (!a) continue;
      st.moveSpeed += a.moveSpeed ?? 0;
      st.extraJumps += a.jumps ?? 0;
      st.noFallDamage ||= !!a.noFallDamage;
      st.miningSpeed += a.miningSpeed ?? 0;
      st.lightBoost += a.lightRadius ?? 0;
      st.regen += a.regen ?? 0;
      if (a.hook) st.hook = a.hook;
      st.flight = Math.max(st.flight, a.flight ?? 0);
    }
    for (const [set, n] of sets) {
      if (n < 3) continue;
      st.setBonus = set;
      if (set === 'copper') { st.defense += 2; st.miningSpeed += 0.15; }
      if (set === 'iron') { st.defense += 3; st.moveSpeed += 0.05; }
      if (set === 'ember') { st.defense += 5; st.regen += 1.5; st.lightBoost += 0.5; st.lavaProof = true; }
      if (set === 'aerite') { st.defense += 3; st.extraJumps += 1; st.moveSpeed += 0.1; st.noFallDamage = true; st.flight *= 1.35; }
    }
    return st;
  }

  serialize() { return this.items.map(s => (s ? { ...s } : null)); }
  load(data: (Stack | null)[]) {
    for (let i = 0; i < this.items.length; i++) this.items[i] = data?.[i] ? { ...data[i]! } : null;
    for (const f of this.listeners) f();
  }
}
