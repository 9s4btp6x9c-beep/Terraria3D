// DOM HUD: hotbar, held-item label, vitals (Vigor/Glim), message feed,
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
    // Pointer events cover mouse and touch alike (taps select immediately).
    this.hotbar.addEventListener('pointerdown', e => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.slot');
      if (el?.dataset.hot) { e.preventDefault(); e.stopPropagation(); this.inv.select(Number(el.dataset.hot)); }
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

  /**
   * Vigor (health) as a segmented ember gauge and Glim (the light that fuels
   * staves) as a thinner gauge beneath it. Each notch is 20 points, so the
   * gauges visibly lengthen as Heartroots and Glim Vessels are used.
   */
  setVitals(hp: number, maxHp: number, mana: number, maxMana: number, defense: number) {
    const key = `${Math.ceil(hp)}/${maxHp}/${Math.floor(mana)}/${maxMana}/${defense}`;
    if (key === this.lastVitals) return;
    this.lastVitals = key;
    const gauge = (cls: string, v: number, max: number, per: number) =>
      `<div class="gauge ${cls}" style="--w:${Math.round(40 + max * per)}px;--n:${Math.max(1, max / 20)}"><div class="fill" style="width:${(100 * Math.max(0, v) / max).toFixed(1)}%"></div><div class="notches"></div></div>`;
    this.vitals.innerHTML =
      `<div class="label"><span class="vig">${icon('flame')}Vigor <span class="num">${Math.ceil(hp)}/${maxHp}</span></span>${defense ? `<span class="def">${icon('shield')}${defense}</span>` : ''}</div>` +
      gauge('vigor', hp, maxHp, 0.7) +
      (maxMana > 0 ? `<div class="label glim-label"><span class="glm">${icon('drop')}Glim <span class="num">${Math.floor(mana)}/${maxMana}</span></span></div>` + gauge('glim', mana, maxMana, 0.9) : '');
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
  private biomeTimer = 0;
  /** Show the name of the land the player just entered, then fade it out. */
  showBiome(name: string) {
    const el = document.querySelector<HTMLElement>('#biome-title');
    if (!el) return;
    el.innerHTML = `<div class="name">${name}</div><div class="rule"></div>`;
    el.classList.add('show');
    clearTimeout(this.biomeTimer);
    this.biomeTimer = window.setTimeout(() => el.classList.remove('show'), 3200);
  }

  private restKey = '';
  /**
   * The Rested buff under the vitals: time left and comfort, or a filling
   * bar while resting by a Hearth (`progress` 0..1).
   */
  setRest(seconds: number, comfort: number, progress: number | null) {
    const el = document.querySelector<HTMLElement>('#buffs');
    if (!el) return;
    const key = progress !== null ? `p${Math.round(progress * 20)}${comfort}` : seconds > 0 ? `r${Math.ceil(seconds)}${comfort}` : '';
    if (key === this.restKey) return;
    this.restKey = key;
    if (!key) { el.innerHTML = ''; return; }
    if (progress !== null) {
      el.innerHTML = `<div class="buff resting">${icon('flame')}<span>Resting · comfort ${comfort}</span><i style="width:${Math.round(progress * 100)}%"></i></div>`;
      return;
    }
    const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
    el.innerHTML = `<div class="buff">${icon('flame')}<span>Rested · comfort ${comfort}</span><b>${m}:${String(s).padStart(2, '0')}</b></div>`;
  }

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
