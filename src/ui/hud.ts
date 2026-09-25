// DOM HUD: hotbar, held-item label, message feed, debug readout and the
// inventory panel.

import { HOTBAR, type Inventory } from '../items/inventory';
import { item } from '../items/items';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export class Hud {
  private hotbar = $('#hotbar');
  private itemName = $('#itemname');
  private messages = $('#messages');
  private debug = $('#debug');
  private invPanel = $('#inventory');
  private invGrid = $('#inventory .grid');
  private pendingSwap: number | null = null;
  debugVisible = false;
  inventoryOpen = false;
  modeLabel = '';

  constructor(private inv: Inventory) {
    inv.onChange(() => this.render());
    this.render();
  }

  private slotHtml(i: number, withKey: boolean) {
    const s = this.inv.slots[i];
    const sel = i === this.inv.selected && withKey ? ' sel' : '';
    const swap = this.pendingSwap === i ? ' sel' : '';
    let inner = withKey ? `<span class="key">${i + 1}</span>` : '';
    if (s) {
      const def = item(s.id);
      inner += `<div class="icon${def.kind === 'tool' ? ' tool' : ''}" style="background:${def.color}"></div>`;
      if (s.count > 1) inner += `<span class="count">${s.count}</span>`;
    }
    return `<div class="slot${sel}${swap}" data-slot="${i}" title="${s ? item(s.id).name : ''}">${inner}</div>`;
  }

  render() {
    let html = '';
    for (let i = 0; i < HOTBAR; i++) html += this.slotHtml(i, true);
    this.hotbar.innerHTML = html;
    const held = this.inv.held;
    this.itemName.innerHTML = held ? `${item(held.id).name}${this.modeLabel ? `<small>${this.modeLabel}</small>` : ''}` : '';
    if (this.inventoryOpen) {
      let g = '';
      for (let i = 0; i < this.inv.slots.length; i++) g += this.slotHtml(i, false);
      this.invGrid.innerHTML = g;
      this.invGrid.querySelectorAll<HTMLElement>('.slot').forEach(el => {
        el.onclick = () => {
          const i = Number(el.dataset.slot);
          if (this.pendingSwap === null) this.pendingSwap = i;
          else { this.inv.swap(this.pendingSwap, i); this.pendingSwap = null; }
          this.render();
        };
      });
    }
  }

  setInventoryOpen(open: boolean) {
    this.inventoryOpen = open;
    this.pendingSwap = null;
    this.invPanel.style.display = open ? 'block' : 'none';
    this.render();
  }

  message(text: string, color = '#f4ecd8') {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.color = color;
    this.messages.appendChild(el);
    while (this.messages.children.length > 6) this.messages.firstChild!.remove();
    setTimeout(() => { el.style.opacity = '0'; }, 2500);
    setTimeout(() => el.remove(), 3100);
  }

  setDebug(text: string) {
    this.debug.style.display = this.debugVisible ? 'block' : 'none';
    if (this.debugVisible) this.debug.textContent = text;
  }
}
