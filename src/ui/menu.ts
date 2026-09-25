// Front-end screens: loading (with tips), title (over the live world),
// new world, settings, controls, pause and the "press to start" prompt.
// Plain DOM, styled by ui/styles.css. Arrow keys / Enter navigate lists.

import { icon, type IconName } from './icons';
import { type Settings, saveSettings } from './settings';

export interface MenuHooks {
  isTouch: boolean;
  /** Describes the world that is loaded (null = freshly generated, unsaved). */
  saveInfo: () => { seed: number; savedAt: number } | null;
  seed: () => number;
  play(): void;
  newWorld(seed: number): void;
  save(): void;
  quitToTitle(): void;
  settings: Settings;
  applySettings(s: Settings): void;
  sound(name: 'hover' | 'click'): void;
}

const TIPS = [
  ['Mining', 'Copper and iron yield to your first pickaxe. Deepstone and glowing lumite need iron.'],
  ['Hearth and home', 'An enclosed room with a door, a lit Hearth and a bed or chair is a home. Settlers move into homes.'],
  ['Heartroots', 'Root cages with an ember core grow on cave floors. Break one and use it to raise your Vigor.'],
  ['Starseeds', 'On clear nights seeds of light drift down from the stars. Catch five to seal a Glim Vessel.'],
  ['The Sporefall', 'Some nights glowing spores rain from a green sky and fungal horrors walk. Their Sporeglass makes fine gear.'],
  ['The Rootwold', 'Petrified roots arch over the moss. Their wood is stone-hard: carve it into mauls and longbows.'],
  ['Ossuary Flats', 'Titans died on the salt pan long ago. Their bones make a pickaxe that bites fast and deep.'],
  ['Amberwood', 'The autumn forest bleeds glowing resin. Amber is the coin of Hollowdeep, so dig it out.'],
  ['Water', 'Tunnels dug from the coast below sea level will flood. Buckets carry water where you need it.'],
  ['The Deepwyrm', 'Something vast burrows beneath the world. A Tremor Totem, used at night or underground, calls it.'],
  ['Sky Islands', 'The floating islands hold aerite ore and old shrines. A grappling hook helps you reach them.'],
  ['Mushroom Caverns', 'Deep halls glow blue with giant mushrooms. Their glowcaps brew Glim Draughts.'],
  ['Breath', 'Watch the bubbles when you swim under water. Surface before they run out.'],
  ['Flight', 'Roc Wings let you fly while you hold jump, then glide down safely.'],
];

const DESKTOP_CONTROLS: [string, string[]][] = [
  ['Move', ['W', 'A', 'S', 'D']], ['Look', ['Mouse']], ['Jump / swim up', ['Space']], ['Sprint', ['Shift']],
  ['Crouch', ['C']], ['Use, attack, place', ['LMB']], ['Interact, talk', ['RMB']], ['Hotbar', ['1-9', 'Wheel']],
  ['Inventory & crafting', ['Tab', 'E']], ['Build shape', ['Q']], ['Grappling hook', ['F']], ['Check housing', ['H']],
  ['Save world', ['F5']], ['Pause', ['Esc']], ['Fly (with wings)', ['Hold Space']], ['Debug readout', ['F3']],
];
const TOUCH_CONTROLS: [string, IconName | string][] = [
  ['Move (push fully to sprint)', 'Left stick'], ['Look', 'Drag right side'], ['Use, attack, place', 'pick'], ['Jump / swim up', 'jump'],
  ['Crouch', 'crouch'], ['Interact, talk', 'hand'], ['Grappling hook', 'hook'], ['Build shape', 'cycle'], ['Inventory & crafting', 'bag'], ['Pause', 'menu'],
];

export class Menu {
  private root = document.querySelector('#menu') as HTMLElement;
  private screens = new Map<string, HTMLElement>();
  private current = 'loading';
  private backTo = 'title';
  private tipTimer = 0;

  constructor(private hooks: MenuHooks) {
    this.screens.set('loading', this.root.querySelector('#loading') as HTMLElement);
    this.build();
    this.setTip();
    this.tipTimer = window.setInterval(() => this.setTip(), 6000);
    window.addEventListener('keydown', e => this.onKey(e));
  }

  get visible() { return this.root.classList.contains('show'); }
  get screen() { return this.current; }

  // ---------------------------------------------------------------- build

  private build() {
    const add = (id: string, html: string) => {
      const el = document.createElement('div');
      el.className = 'screen';
      el.id = id;
      el.innerHTML = html;
      this.root.appendChild(el);
      this.screens.set(id, el);
      return el;
    };
    const logo = '<div class="logo"><span class="word">Hollowdeep</span><span class="tag">Dig. Build. Delve.</span></div>';
    const title = add('title', `${logo}
      <nav class="menu-list">
        <button class="menu-item" data-a="play"></button>
        <button class="menu-item" data-a="new">New World</button>
        <button class="menu-item" data-a="settings">Settings</button>
        <button class="menu-item" data-a="controls">Controls</button>
      </nav>
      <div class="menu-foot"><span>Build 0.13</span><span class="keys"><span><kbd>Up</kbd><kbd>Down</kbd> choose</span><span><kbd>Enter</kbd> select</span></span></div>`);
    this.bindActions(title);

    add('ready', `${logo}<div class="press">${this.hooks.isTouch ? 'Tap' : 'Click'} to enter the world</div>`).onclick = () => this.hooks.play();

    const pause = add('pause', `<div class="menu-panel"><h2>Paused</h2>
      <nav class="menu-list">
        <button class="menu-item" data-a="resume">Resume</button>
        <button class="menu-item" data-a="settings">Settings</button>
        <button class="menu-item" data-a="controls">Controls</button>
        <button class="menu-item" data-a="save">Save World</button>
        <button class="menu-item" data-a="quit">Save &amp; Quit to Title</button>
      </nav></div>`);
    this.bindActions(pause);

    const nw = add('newworld', `<div class="menu-panel"><h2>New World</h2>
      <p>Every seed shapes a different world: its hills, caves, lakes, islands and biomes.</p>
      <div class="field"><label for="seed-input">World seed</label><input id="seed-input" type="text" inputmode="numeric" maxlength="9"><button class="px-btn" data-a="random">Random</button></div>
      <p class="note warn" data-warn></p>
      <div class="foot"><button class="px-btn" data-a="back">Back</button><button class="px-btn gold" data-a="create">Create World</button></div></div>`);
    this.bindActions(nw);

    const st = add('settings', `<div class="menu-panel"><h2>Settings</h2>
      <div class="field"><label>Graphics quality</label><div class="seg" data-seg="quality">
        <button data-v="auto">Auto</button><button data-v="low">Low</button><button data-v="medium">Medium</button><button data-v="high">High</button></div><span></span></div>
      <div class="field"><label for="set-fov">Field of view</label><input id="set-fov" type="range" min="60" max="100" step="1"><output data-for="fov"></output></div>
      <div class="field"><label for="set-sens">Look sensitivity</label><input id="set-sens" type="range" min="0.25" max="3" step="0.05"><output data-for="sensitivity"></output></div>
      <div class="field"><label for="set-vol">Volume</label><input id="set-vol" type="range" min="0" max="1" step="0.05"><output data-for="volume"></output></div>
      <div class="field"><label>Invert look</label><button class="toggle" data-toggle="invertY" aria-label="Invert look"></button><span></span></div>
      <div class="field"><label>Show frame rate</label><button class="toggle" data-toggle="showFps" aria-label="Show frame rate"></button><span></span></div>
      <div class="field"><label>Fullscreen</label><button class="px-btn" data-a="fullscreen">Toggle</button><span></span></div>
      <p class="note" data-quality-note></p>
      <div class="foot"><button class="px-btn gold" data-a="back">Done</button></div></div>`);
    this.bindActions(st);
    this.bindSettings(st);

    const touch = this.hooks.isTouch;
    const rows = touch
      ? TOUCH_CONTROLS.map(([what, how]) => `<div class="row"><span>${what}</span><span class="keys">${how.includes(' ') ? `<kbd>${how}</kbd>` : icon(how as IconName)}</span></div>`)
      : DESKTOP_CONTROLS.map(([what, keys]) => `<div class="row"><span>${what}</span><span class="keys">${keys.map(k => `<kbd>${k}</kbd>`).join('')}</span></div>`);
    const ct = add('controls', `<div class="menu-panel"><h2>Controls</h2><div class="controls-grid">${rows.join('')}</div>
      <div class="foot"><button class="px-btn gold" data-a="back">Done</button></div></div>`);
    this.bindActions(ct);
  }

  private bindActions(el: HTMLElement) {
    el.querySelectorAll<HTMLButtonElement>('[data-a]').forEach(b => {
      b.addEventListener('mouseenter', () => { if (b.classList.contains('menu-item')) this.hooks.sound('hover'); });
      b.addEventListener('click', e => { e.stopPropagation(); this.hooks.sound('click'); this.action(b.dataset.a!); });
    });
  }

  private action(a: string) {
    switch (a) {
      case 'play': case 'resume': this.hooks.play(); break;
      case 'new': this.openNewWorld(); break;
      case 'settings': this.open('settings', this.current); break;
      case 'controls': this.open('controls', this.current); break;
      case 'save': this.hooks.save(); break;
      case 'quit': this.hooks.quitToTitle(); break;
      case 'back': this.open(this.backTo); break;
      case 'random': (this.root.querySelector('#seed-input') as HTMLInputElement).value = String(randomSeed()); break;
      case 'create': {
        const v = (this.root.querySelector('#seed-input') as HTMLInputElement).value.trim();
        const seed = /^\d+$/.test(v) ? Number(v) : hashSeed(v || String(randomSeed()));
        this.hooks.newWorld(seed);
        break;
      }
      case 'fullscreen':
        try {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen();
        } catch { /* not allowed here */ }
        break;
    }
  }

  private bindSettings(el: HTMLElement) {
    const s = this.hooks.settings;
    const commit = () => { saveSettings(s); this.hooks.applySettings(s); this.syncSettings(); };
    el.querySelectorAll<HTMLButtonElement>('[data-seg="quality"] button').forEach(b => {
      b.onclick = () => { s.quality = b.dataset.v as Settings['quality']; commit(); this.hooks.sound('click'); };
    });
    const range = (id: string, key: 'fov' | 'sensitivity' | 'volume') => {
      const input = el.querySelector(`#${id}`) as HTMLInputElement;
      input.oninput = () => { s[key] = Number(input.value); commit(); };
    };
    range('set-fov', 'fov'); range('set-sens', 'sensitivity'); range('set-vol', 'volume');
    el.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach(b => {
      b.onclick = () => { const k = b.dataset.toggle as 'invertY' | 'showFps'; s[k] = !s[k]; commit(); this.hooks.sound('click'); };
    });
    this.syncSettings();
  }

  private syncSettings() {
    const s = this.hooks.settings, el = this.screens.get('settings')!;
    el.querySelectorAll<HTMLButtonElement>('[data-seg="quality"] button').forEach(b => b.classList.toggle('on', b.dataset.v === s.quality));
    (el.querySelector('#set-fov') as HTMLInputElement).value = String(s.fov);
    (el.querySelector('#set-sens') as HTMLInputElement).value = String(s.sensitivity);
    (el.querySelector('#set-vol') as HTMLInputElement).value = String(s.volume);
    const out = (k: string, v: string) => { (el.querySelector(`output[data-for="${k}"]`) as HTMLElement).textContent = v; };
    out('fov', `${s.fov}°`); out('sensitivity', `${s.sensitivity.toFixed(2)}x`); out('volume', `${Math.round(s.volume * 100)}%`);
    el.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach(b => b.classList.toggle('on', !!s[b.dataset.toggle as 'invertY' | 'showFps']));
    (el.querySelector('[data-quality-note]') as HTMLElement).textContent = 'Graphics quality takes effect the next time the world loads.';
  }

  // -------------------------------------------------------------- screens

  private setTip() {
    const el = this.screens.get('loading')!.querySelector('.tip') as HTMLElement;
    const [t, body] = TIPS[Math.floor(Math.random() * TIPS.length)];
    el.innerHTML = `<b>${t}</b>${body}`;
  }

  setProgress(f: number, label: string) {
    const l = this.screens.get('loading')!;
    (l.querySelector('.load-bar div') as HTMLElement).style.width = `${Math.round(f * 100)}%`;
    (l.querySelector('.status') as HTMLElement).textContent = label;
  }

  open(id: string, back = 'title') {
    if (id === 'settings' || id === 'controls') this.backTo = back;
    if (id === 'title') this.refreshTitle();
    for (const [k, el] of this.screens) el.classList.toggle('show', k === id);
    this.current = id;
    this.root.classList.add('show');
    this.root.classList.toggle('dim', id !== 'title' && id !== 'loading');
    if (id !== 'loading') { window.clearInterval(this.tipTimer); this.tipTimer = 0; }
    document.body.classList.add('in-menu');
    // Focus the first item for keyboard players.
    const first = this.screens.get(id)!.querySelector<HTMLElement>('.menu-item:not(:disabled), input, .px-btn.gold');
    if (first && !this.hooks.isTouch) first.focus({ preventScroll: true });
  }

  hide() {
    this.root.classList.remove('show');
    document.body.classList.remove('in-menu');
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  private refreshTitle() {
    const btn = this.screens.get('title')!.querySelector('[data-a="play"]') as HTMLElement;
    const info = this.hooks.saveInfo();
    btn.innerHTML = info
      ? `Continue<small>Seed ${info.seed} &middot; saved ${ago(info.savedAt)}</small>`
      : `Play<small>Seed ${this.hooks.seed()} &middot; a new world awaits</small>`;
  }

  private openNewWorld() {
    const el = this.screens.get('newworld')!;
    (el.querySelector('#seed-input') as HTMLInputElement).value = String(randomSeed());
    (el.querySelector('[data-warn]') as HTMLElement).textContent = this.hooks.saveInfo()
      ? 'Creating a new world replaces your saved world.' : '';
    this.open('newworld');
  }

  private onKey(e: KeyboardEvent) {
    if (!this.visible) return;
    const el = this.screens.get(this.current);
    if (!el) return;
    if (e.code === 'Escape' && this.current !== 'title' && this.current !== 'loading' && this.current !== 'ready') {
      e.preventDefault();
      if (this.current === 'pause') this.hooks.play();
      else this.open(this.current === 'newworld' ? 'title' : this.backTo);
      return;
    }
    if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return;
    const items = [...el.querySelectorAll<HTMLElement>('.menu-item:not(:disabled)')];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(i + (e.code === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    next.focus();
    this.hooks.sound('hover');
  }
}

function randomSeed() { return Math.floor(Math.random() * 999999999) + 1; }

function hashSeed(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 999999999 + 1;
}

function ago(t: number) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}
