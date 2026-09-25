// Inventory screen: slot grid with a cursor stack (click to
// pick up / place / swap / merge, right-click to split one), tooltips,
// crafting list filtered by nearby stations, and an open chest's contents.

import type { Stack } from '../items/inventory';
import { HOTBAR, type Inventory } from '../items/inventory';
import { type ItemDef, RARITY_COLORS, type StationId, item } from '../items/items';
import { STATION_NAMES, craft, visibleRecipes } from '../items/recipes';
import type { IconAtlas } from '../render/icons';
import { icon } from './icons';

export interface SlotContainer {
  slots: (Stack | null)[];
  changed(): void;
}

export interface EquipmentView {
  /** Slot labels and their contents (armor, accessories). */
  slots: { label: string; stack: Stack | null; accepts(def: ItemDef): boolean }[];
  set(i: number, s: Stack | null): void;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export function tooltipHtml(def: ItemDef): string {
  const lines: string[] = [`<b style="color:${RARITY_COLORS[def.rarity ?? 0]}">${def.name}</b>`];
  if (def.tool) lines.push(`${def.tool.type === 'pickaxe' ? `${Math.round(def.tool.power * 100)}% pickaxe power · tier ${def.tool.tier}` : `${Math.round(def.tool.power * 100)}% axe power`}`, `${def.tool.damage} melee damage`);
  if (def.weapon) {
    const w = def.weapon;
    lines.push(`${w.damage} ${w.type === 'magic' ? 'magic' : w.type === 'bow' ? 'ranged' : w.type === 'thrown' ? 'explosive' : 'melee'} damage`);
    lines.push(`${w.speed < 0.36 ? 'Fast' : w.speed < 0.5 ? 'Average' : 'Slow'} speed · ${w.knockback >= 7 ? 'strong' : 'average'} knockback`);
    if (w.ammo) lines.push(`Uses ${item(w.ammo).name}s`);
    if (w.manaCost) lines.push(`Uses ${w.manaCost} mana`);
  }
  if (def.armor) lines.push(`${def.armor.defense} defense`);
  if (def.heal) lines.push(`Restores ${def.heal} health`);
  if (def.kind === 'material') lines.push('<span class="dim">Material</span>');
  if (def.kind === 'placeable') lines.push('<span class="dim">Can be placed</span>');
  if (def.kind === 'accessory') lines.push('<span class="dim">Equipable</span>');
  if (def.description) lines.push(`<i>${def.description}</i>`);
  return lines.join('<br>');
}

export class InventoryUI {
  private panel = $('#inventory');
  private grid = $('#inventory .grid');
  private equipEl = $('#inventory .equip');
  private chestEl = $('#inventory .chest');
  private craftList = $('#inventory .craft-list');
  private craftInfo = $('#inventory .craft-info');
  private tip = $('#tooltip');
  private cursorEl = $('#cursor-stack');
  cursor: Stack | null = null;
  open = false;
  chest: SlotContainer | null = null;
  stations = new Set<StationId>();
  private stationsKey = '';
  private recipeIndex = 0;

  constructor(private inv: Inventory, private icons: IconAtlas, private equip: EquipmentView, private onMessage: (t: string, c?: string) => void) {
    inv.onChange(() => { if (this.open) this.render(); });
    window.addEventListener('mousemove', e => {
      this.cursorEl.style.left = `${e.clientX + 6}px`;
      this.cursorEl.style.top = `${e.clientY + 6}px`;
      this.tip.style.left = `${Math.min(window.innerWidth - 260, e.clientX + 18)}px`;
      this.tip.style.top = `${Math.min(window.innerHeight - 120, e.clientY + 18)}px`;
    });
    this.panel.addEventListener('contextmenu', e => e.preventDefault());
    const close = this.panel.querySelector<HTMLButtonElement>('.close')!;
    close.innerHTML = icon('close');
    close.onclick = () => this.onClose?.();
  }

  /** Close button pressed. */
  onClose: (() => void) | null = null;

  setOpen(open: boolean) {
    this.open = open;
    this.panel.style.display = open ? 'flex' : 'none';
    if (!open) {
      this.tip.style.display = 'none';
      // Return a held stack to the inventory (never lose items).
      if (this.cursor) {
        const left = this.inv.add(this.cursor.id, this.cursor.count);
        this.cursor = left > 0 ? { id: this.cursor.id, count: left } : null;
      }
      this.chest = null;
    }
    this.render();
  }

  setStations(s: Set<StationId>) {
    const key = [...s].sort().join(',');
    if (key === this.stationsKey) return;
    this.stationsKey = key;
    this.stations = s;
    if (this.open) this.render();
  }

  private slotHtml(s: Stack | null, attrs: string, extraClass = '', label = '') {
    let inner = label && !s ? `<span class="label">${label}</span>` : '';
    if (s) {
      const def = item(s.id);
      inner += this.icons.img(def);
      if (s.count > 1) inner += `<span class="count">${s.count}</span>`;
    }
    return `<div class="slot ${extraClass}" ${attrs}>${inner}</div>`;
  }

  render() {
    this.cursorEl.innerHTML = this.cursor ? this.icons.img(item(this.cursor.id)) + (this.cursor.count > 1 ? `<span class="count">${this.cursor.count}</span>` : '') : '';
    this.cursorEl.style.display = this.cursor ? 'block' : 'none';
    if (!this.open) return;
    let g = '';
    for (let i = 0; i < this.inv.slots.length; i++) g += this.slotHtml(this.inv.slots[i], `data-inv="${i}"`, i < HOTBAR ? 'hot' : '');
    this.grid.innerHTML = g;
    this.equipEl.innerHTML = this.equip.slots.map((e, i) => this.slotHtml(e.stack, `data-eq="${i}"`, 'eq', e.label)).join('');
    if (this.chest) {
      this.chestEl.style.display = 'grid';
      this.chestEl.innerHTML = this.chest.slots.map((s, i) => this.slotHtml(s, `data-ch="${i}"`)).join('');
    } else this.chestEl.style.display = 'none';
    this.renderCrafting();
    this.bind();
  }

  private renderCrafting() {
    const list = visibleRecipes(this.inv, this.stations);
    this.recipeIndex = Math.min(this.recipeIndex, Math.max(0, list.length - 1));
    const st = [...this.stations].map(s => STATION_NAMES[s]).join(', ') || 'Crafting by hand';
    this.craftList.innerHTML = `<div class="stations">${this.stations.size ? `Near: ${st}` : st}</div>` + list.map(({ r, ok }, i) =>
      `<div class="recipe ${ok ? 'ok' : 'no'} ${i === this.recipeIndex ? 'sel' : ''}" data-rc="${i}">${this.icons.img(item(r.out))}<span>${item(r.out).name}${r.count > 1 ? ` ×${r.count}` : ''}</span></div>`).join('');
    const cur = list[this.recipeIndex];
    if (!cur) { this.craftInfo.innerHTML = '<span class="dim">Gather materials to discover recipes.</span>'; return; }
    const { r, ok } = cur;
    this.craftInfo.innerHTML =
      `<div class="title">${this.icons.img(item(r.out))}<b style="color:${RARITY_COLORS[item(r.out).rarity ?? 0]}">${item(r.out).name}</b></div>` +
      r.in.map(([id, n]) => `<div class="${this.inv.count(id) >= n ? 'have' : 'need'}">${this.icons.img(item(id), 'mini')} ${n} ${item(id).name} <span class="dim">(${this.inv.count(id)})</span></div>`).join('') +
      `<div class="dim">Station: ${r.station ? STATION_NAMES[r.station] : 'none'}${r.station && !this.stations.has(r.station) ? ' <span class="need">(not nearby)</span>' : ''}</div>` +
      `<div class="actions"><button class="craft-btn px-btn gold" ${ok ? '' : 'disabled'}>Craft</button><button class="craft-btn5 px-btn" ${ok ? '' : 'disabled'}>Craft 5</button></div>`;
    const doCraft = (times: number) => {
      let n = 0;
      for (let k = 0; k < times; k++) if (craft(r, this.inv, this.stations)) n++; else break;
      if (n) this.onMessage(`Crafted ${item(r.out).name}${r.count * n > 1 ? ` ×${r.count * n}` : ''}`, '#ffe08a');
      else this.onMessage('Not enough room in inventory', '#ff9a7a');
      this.render();
    };
    this.craftInfo.querySelector<HTMLButtonElement>('.craft-btn')!.onclick = () => doCraft(1);
    this.craftInfo.querySelector<HTMLButtonElement>('.craft-btn5')!.onclick = () => doCraft(5);
  }

  private container(el: HTMLElement): { get(): Stack | null; set(s: Stack | null): void; accepts(def: ItemDef): boolean } | null {
    if (el.dataset.inv !== undefined) {
      const i = Number(el.dataset.inv);
      return { get: () => this.inv.slots[i], set: s => { this.inv.slots[i] = s; }, accepts: () => true };
    }
    if (el.dataset.ch !== undefined && this.chest) {
      const i = Number(el.dataset.ch), ch = this.chest;
      return { get: () => ch.slots[i], set: s => { ch.slots[i] = s; ch.changed(); }, accepts: () => true };
    }
    if (el.dataset.eq !== undefined) {
      const i = Number(el.dataset.eq), e = this.equip;
      return { get: () => e.slots[i].stack, set: s => e.set(i, s), accepts: d => e.slots[i].accepts(d) };
    }
    return null;
  }

  private bind() {
    const all = this.panel.querySelectorAll<HTMLElement>('.slot');
    all.forEach(el => {
      el.onmousedown = e => {
        e.preventDefault();
        const c = this.container(el);
        if (!c) return;
        if (e.shiftKey) this.quickMove(el, c);
        else if (e.button === 2) this.takeOne(c);
        else this.clickSlot(c);
        this.inv.touch();
        this.render();
      };
      el.onmouseenter = () => {
        const s = this.container(el)?.get();
        if (!s) { this.tip.style.display = 'none'; return; }
        this.tip.innerHTML = tooltipHtml(item(s.id));
        this.tip.style.display = 'block';
      };
      el.onmouseleave = () => { this.tip.style.display = 'none'; };
    });
    this.craftList.querySelectorAll<HTMLElement>('.recipe').forEach(el => {
      el.onclick = () => { this.recipeIndex = Number(el.dataset.rc); this.renderCrafting(); this.bindRecipes(); };
    });
  }

  private bindRecipes() {
    this.craftList.querySelectorAll<HTMLElement>('.recipe').forEach(el => {
      el.onclick = () => { this.recipeIndex = Number(el.dataset.rc); this.renderCrafting(); this.bindRecipes(); };
    });
  }

  private clickSlot(c: { get(): Stack | null; set(s: Stack | null): void; accepts(def: ItemDef): boolean }) {
    const s = c.get();
    if (this.cursor && !c.accepts(item(this.cursor.id))) { this.onMessage("That doesn't go there", '#ff9a7a'); return; }
    if (this.cursor && s && s.id === this.cursor.id) {
      const max = item(s.id).maxStack;
      const n = Math.min(this.cursor.count, max - s.count);
      s.count += n; this.cursor.count -= n;
      c.set(s);
      if (this.cursor.count <= 0) this.cursor = null;
      return;
    }
    c.set(this.cursor);
    this.cursor = s;
  }

  private takeOne(c: { get(): Stack | null; set(s: Stack | null): void }) {
    const s = c.get();
    if (!s) return;
    if (this.cursor && this.cursor.id !== s.id) return;
    if (this.cursor && this.cursor.count >= item(s.id).maxStack) return;
    this.cursor = { id: s.id, count: (this.cursor?.count ?? 0) + 1 };
    s.count--;
    c.set(s.count > 0 ? s : null);
  }

  /** Shift-click: move a stack between the chest and the inventory. */
  private quickMove(el: HTMLElement, c: { get(): Stack | null; set(s: Stack | null): void }) {
    const s = c.get();
    if (!s) return;
    if (el.dataset.ch !== undefined) {
      const left = this.inv.add(s.id, s.count);
      c.set(left > 0 ? { id: s.id, count: left } : null);
    } else if (el.dataset.inv !== undefined && this.chest) {
      const ch = this.chest;
      let left = s.count;
      const max = item(s.id).maxStack;
      for (let i = 0; i < ch.slots.length && left > 0; i++) {
        const t = ch.slots[i];
        if (t && t.id === s.id && t.count < max) { const n = Math.min(left, max - t.count); t.count += n; left -= n; }
      }
      for (let i = 0; i < ch.slots.length && left > 0; i++) if (!ch.slots[i]) { ch.slots[i] = { id: s.id, count: left }; left = 0; }
      ch.changed();
      c.set(left > 0 ? { id: s.id, count: left } : null);
    }
  }
}
