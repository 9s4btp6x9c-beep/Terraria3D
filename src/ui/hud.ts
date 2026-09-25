// DOM HUD: hotbar, held-item label, vitals (health/mana), message feed,
// interaction prompt, damage flash and debug readout.

import { HOTBAR, type Inventory } from '../items/inventory';
import { RARITY_COLORS, item } from '../items/items';
import type { IconAtlas } from '../render/icons';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export class Hud {
  private hotbar = $('#hotbar');
  private itemName = $('#itemname');
  private messages = $('#messages');
  private debug = $('#debug');
  private prompt = $('#prompt');
  private vitals = $('#vitals');
  private flash = $('#flash');
  private bossbar = $('#bossbar');
  private bossKey = '';
  debugVisible = false;
  modeLabel = '';
  private lastVitals = '';
  private flashT = 0;

  constructor(private inv: Inventory, private icons: IconAtlas) {
    inv.onChange(() => this.render());
    this.hotbar.addEventListener('mousedown', e => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.slot');
      if (el?.dataset.hot) this.inv.select(Number(el.dataset.hot));
    });
    this.render();
  }

  render() {
    let html = '';
    for (let i = 0; i < HOTBAR; i++) {
      const s = this.inv.slots[i];
      const sel = i === this.inv.selected ? ' sel' : '';
      let inner = `<span class="key">${i + 1}</span>`;
      if (s) {
        inner += this.icons.img(item(s.id));
        if (s.count > 1) inner += `<span class="count">${s.count}</span>`;
      }
      html += `<div class="slot${sel}" data-hot="${i}">${inner}</div>`;
    }
    this.hotbar.innerHTML = html;
    const held = this.inv.held;
    if (held) {
      const def = item(held.id);
      this.itemName.innerHTML = `<span style="color:${RARITY_COLORS[def.rarity ?? 0]}">${def.name}</span>${this.modeLabel ? `<small>${this.modeLabel}</small>` : ''}`;
    } else this.itemName.innerHTML = '';
  }

  /** Health as hearts (20 hp each) and mana as stars, Terraria-style. */
  setVitals(hp: number, maxHp: number, mana: number, maxMana: number, defense: number) {
    const key = `${Math.ceil(hp)}/${maxHp}/${Math.floor(mana)}/${maxMana}/${defense}`;
    if (key === this.lastVitals) return;
    this.lastVitals = key;
    const hearts: string[] = [];
    for (let i = 0; i < maxHp / 20; i++) {
      const f = Math.max(0, Math.min(1, (hp - i * 20) / 20));
      hearts.push(`<span class="heart" style="--f:${f}"></span>`);
    }
    const stars: string[] = [];
    for (let i = 0; i < maxMana / 20; i++) {
      const f = Math.max(0, Math.min(1, (mana - i * 20) / 20));
      stars.push(`<span class="star" style="--f:${f}"></span>`);
    }
    this.vitals.innerHTML = `<div class="hp-label">Life ${Math.ceil(hp)}/${maxHp}${defense ? ` · <span class="def">🛡 ${defense}</span>` : ''}</div>` +
      `<div class="hearts">${hearts.join('')}</div>` + (maxMana > 0 ? `<div class="stars">${stars.join('')}</div>` : '');
  }

  setBoss(name: string | null, hp = 0, max = 1) {
    const key = name ? `${name}${Math.ceil(hp)}` : '';
    if (key === this.bossKey) return;
    this.bossKey = key;
    this.bossbar.style.display = name ? 'block' : 'none';
    if (name) this.bossbar.innerHTML = `<div class="name">${name}</div><div class="bar"><div style="width:${Math.max(0, (hp / max) * 100).toFixed(1)}%"></div></div>`;
  }

  damageFlash(strength = 1) {
    this.flashT = Math.min(1, this.flashT + 0.5 * strength);
  }

  setPrompt(text: string) {
    if (this.prompt.textContent !== text) this.prompt.textContent = text;
    this.prompt.style.display = text ? 'block' : 'none';
  }

  update(dt: number) {
    this.flashT = Math.max(0, this.flashT - dt * 2.5);
    this.flash.style.opacity = String(this.flashT * 0.45);
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
