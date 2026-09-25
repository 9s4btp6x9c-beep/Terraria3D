// DOM HUD: hotbar, held-item label, vitals (health/mana), message feed,
// interaction prompt, damage flash and debug readout.

import { HOTBAR, type Inventory } from '../items/inventory';
import { RARITY_COLORS, item } from '../items/items';
import type { IconAtlas } from '../render/icons';
import { icon } from './icons';

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
  private eventbar = $('#eventbar');
  private flight = $('#flight');
  private breath = $('#breath');
  private breathShown = -1;
  private flightShown = -1;
  private eventKey = '';
  debugVisible = false;
  showFps = false;
  private clockEl = $('#clock');
  private clockKey = '';
  private death = $('#death');
  private deathKey = '';
  private fpsEl = $('#fps');
  private fpsT = 0;
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
    this.vitals.innerHTML = `<div class="label"><span>Life <span class="num">${Math.ceil(hp)}/${maxHp}</span></span>${defense ? `<span class="def">${icon('shield')}${defense}</span>` : ''}</div>` +
      `<div class="hearts">${hearts.join('')}</div>` + (maxMana > 0 ? `<div class="stars">${stars.join('')}</div>` : '');
  }

  setBoss(name: string | null, hp = 0, max = 1) {
    const key = name ? `${name}${Math.ceil(hp)}` : '';
    if (key === this.bossKey) return;
    this.bossKey = key;
    this.bossbar.style.display = name ? 'block' : 'none';
    if (name) this.bossbar.innerHTML = `<div class="name">${name}</div><div class="bar"><div style="width:${Math.max(0, (hp / max) * 100).toFixed(1)}%"></div></div>`;
  }

  /** World event banner; `goal` > 0 shows a progress bar. */
  setEvent(ev: { name: string; color: string; subtitle: string } | null, progress = 0, goal = 0) {
    const key = ev ? `${ev.name}${progress}/${goal}` : '';
    if (key === this.eventKey) return;
    this.eventKey = key;
    this.eventbar.style.display = ev ? 'block' : 'none';
    if (!ev) return;
    const bar = goal > 0 ? `<div class="bar"><div style="width:${Math.min(100, (progress / goal) * 100).toFixed(1)}%"></div></div>` : '';
    this.eventbar.innerHTML = `<div class="name" style="color:${ev.color}">${ev.name}</div>` +
      `<div class="sub">${goal > 0 ? `${ev.subtitle} · ${progress} / ${goal}` : ev.subtitle}</div>${bar}`;
  }

  /** Breath bubbles (null hides them). */
  setBreath(f: number | null) {
    const n = f === null ? -1 : Math.ceil(f * 10);
    if (n === this.breathShown) return;
    this.breathShown = n;
    this.breath.style.display = f === null ? 'none' : 'flex';
    if (f !== null) this.breath.innerHTML = Array.from({ length: 10 }, (_, i) => `<span class="bubble${i < n ? '' : ' gone'}"></span>`).join('');
  }

  /** Wing flight meter under the crosshair (null hides it). */
  setFlight(f: number | null) {
    const v = f === null ? -1 : Math.round(f * 40) / 40;
    if (v === this.flightShown) return;
    this.flightShown = v;
    this.flight.style.display = f === null ? 'none' : 'block';
    if (f !== null) (this.flight.firstElementChild as HTMLElement).style.width = `${(v * 100).toFixed(0)}%`;
  }

  damageFlash(strength = 1) {
    this.flashT = Math.min(1, this.flashT + 0.5 * strength);
  }

  /** Interaction hint; "[RMB] Talk" shows the key as a keycap. */
  setPrompt(text: string) {
    if (this.prompt.dataset.text !== text) {
      this.prompt.dataset.text = text;
      const m = /^\[([^\]]+)\]\s*(.*)$/.exec(text);
      this.prompt.innerHTML = m ? `<span class="key">${m[1]}</span>${m[2]}` : text;
    }
    this.prompt.style.display = text ? 'block' : 'none';
  }

  /** Time of day under the minimap with a pixel sun or moon. */
  setClock(hours: number, day: boolean, blood: boolean, dayCount: number) {
    const hh = String(Math.floor(hours)).padStart(2, '0'), mm = String(Math.floor((hours % 1) * 60)).padStart(2, '0');
    const key = `${hh}${mm}${day}${blood}${dayCount}`;
    if (key === this.clockKey) return;
    this.clockKey = key;
    const ic = day ? `<span class="sun">${icon('sun')}</span>` : `<span class="${blood ? 'blood' : 'moon'}">${icon('moon')}</span>`;
    this.clockEl.innerHTML = `${ic}<span>${hh}:${mm}</span><span class="day">Day ${dayCount}</span>`;
  }

  /** Death screen with the respawn countdown. */
  setDeath(dead: boolean, respawnIn: number) {
    const key = dead ? String(Math.ceil(respawnIn)) : '';
    if (key === this.deathKey) return;
    this.deathKey = key;
    this.death.style.display = dead ? 'flex' : 'none';
    if (dead) (this.death.querySelector('p') as HTMLElement).textContent = `Respawning in ${Math.max(1, Math.ceil(respawnIn))}`;
  }

  setFps(fps: number) {
    this.fpsEl.style.display = this.showFps ? 'block' : 'none';
    if (!this.showFps) return;
    if ((this.fpsT = (this.fpsT + 1) % 15) === 0) this.fpsEl.textContent = `${Math.round(fps)} FPS`;
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
