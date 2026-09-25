// Slot-based inventory with stacking. The first HOTBAR slots form the hotbar.

import { item } from './items';

export interface Stack { id: string; count: number }

export const HOTBAR = 9;

export class Inventory {
  readonly slots: (Stack | null)[];
  selected = 0;
  private listeners: (() => void)[] = [];

  constructor(size = 36) {
    this.slots = new Array(size).fill(null);
  }

  onChange(fn: () => void) { this.listeners.push(fn); }
  private emit() { for (const f of this.listeners) f(); }

  get held(): Stack | null { return this.slots[this.selected]; }

  count(id: string): number {
    return this.slots.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0);
  }

  /** Adds items, returns how many did not fit. */
  add(id: string, count: number): number {
    const max = item(id).maxStack;
    for (const s of this.slots) {
      if (count <= 0) break;
      if (s && s.id === id && s.count < max) {
        const n = Math.min(count, max - s.count);
        s.count += n; count -= n;
      }
    }
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(count, max);
        this.slots[i] = { id, count: n };
        count -= n;
      }
    }
    this.emit();
    return count;
  }

  /** Removes up to `count`; returns true if the full amount was available. */
  remove(id: string, count: number): boolean {
    if (this.count(id) < count) return false;
    for (let i = this.slots.length - 1; i >= 0 && count > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const n = Math.min(count, s.count);
        s.count -= n; count -= n;
        if (s.count === 0) this.slots[i] = null;
      }
    }
    this.emit();
    return true;
  }

  swap(a: number, b: number) {
    [this.slots[a], this.slots[b]] = [this.slots[b], this.slots[a]];
    this.emit();
  }

  /** Notify listeners after slots were mutated directly (UI drag/drop). */
  touch() { this.emit(); }

  hasRoomFor(id: string, count: number): boolean {
    const max = item(id).maxStack;
    let room = 0;
    for (const s of this.slots) room += !s ? max : s.id === id ? max - s.count : 0;
    return room >= count;
  }

  select(i: number) {
    this.selected = ((i % HOTBAR) + HOTBAR) % HOTBAR;
    this.emit();
  }

  serialize(): (Stack | null)[] { return this.slots.map(s => (s ? { ...s } : null)); }

  load(data: (Stack | null)[]) {
    for (let i = 0; i < this.slots.length; i++) this.slots[i] = data[i] ? { ...data[i]! } : null;
    this.emit();
  }
}
