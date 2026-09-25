// On-screen touch controls: a virtual joystick (left), drag-to-look (right
// half of the screen) and action buttons. Everything feeds the regular Input
// object so the game logic is identical for touch and keyboard/mouse.

import type { Input } from '../player/input';
import { icon } from './icons';

interface Actions {
  inventory(): void;
  cycleMode(): void;
  pause(): void;
  /** True while a menu (inventory, dialogue) needs the screen. */
  menuOpen(): boolean;
}

const LOOK_SENS = 2.2; // screen pixels -> Input mouse units (scaled by sensitivity)

export class TouchControls {
  private root: HTMLDivElement;
  private stick: HTMLDivElement;
  private knob: HTMLDivElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private looks = new Map<number, { x: number; y: number }>();

  private menu = false;

  constructor(private input: Input, private actions: Actions) {
    input.touchMode = true;
    input.sensitivity = 0.0042;
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.innerHTML = `
      <div class="look"></div>
      <button class="menu" data-b="menu" aria-label="Pause">${icon('menu')}</button>
      <div class="stick"><div class="knob"></div></div>
      <div class="btns">
        <button data-b="use" class="big" style="grid-area:use" aria-label="Use">${icon('pick')}</button>
        <button data-b="jump" style="grid-area:jump" aria-label="Jump">${icon('jump')}</button>
        <button data-b="act" style="grid-area:act" aria-label="Interact">${icon('hand')}</button>
        <button data-b="hook" style="grid-area:hook" aria-label="Grappling hook">${icon('hook')}</button>
        <button data-b="mode" style="grid-area:mode" aria-label="Build shape">${icon('cycle')}</button>
        <button data-b="inv" style="grid-area:inv" aria-label="Inventory">${icon('bag')}</button>
        <button data-b="crouch" style="grid-area:crouch" aria-label="Crouch">${icon('crouch')}</button>
        <button data-b="rot" style="grid-area:rot" aria-label="Rotate piece">${icon('cycle')}</button>
      </div>`;
    document.body.appendChild(this.root);
    this.stick = this.root.querySelector('.stick')!;
    this.knob = this.root.querySelector('.knob')!;
    const look = this.root.querySelector<HTMLDivElement>('.look')!;

    // Joystick.
    this.stick.addEventListener('pointerdown', e => {
      e.preventDefault();
      this.stickId = e.pointerId;
      const r = this.stick.getBoundingClientRect();
      this.stickOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      this.stick.setPointerCapture(e.pointerId);
      this.moveStick(e.clientX, e.clientY);
    });
    this.stick.addEventListener('pointermove', e => { if (e.pointerId === this.stickId) this.moveStick(e.clientX, e.clientY); });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.input.axisForward = this.input.axisStrafe = 0;
      this.input.release('ShiftLeft');
      this.knob.style.transform = 'translate(-50%, -50%)';
    };
    this.stick.addEventListener('pointerup', endStick);
    this.stick.addEventListener('pointercancel', endStick);

    // Drag to look (anywhere not covered by other controls).
    look.addEventListener('pointerdown', e => {
      e.preventDefault();
      look.setPointerCapture(e.pointerId);
      this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    look.addEventListener('pointermove', e => {
      const p = this.looks.get(e.pointerId);
      if (!p) return;
      this.input.look((e.clientX - p.x) * LOOK_SENS / 4.2, (e.clientY - p.y) * LOOK_SENS / 4.2);
      p.x = e.clientX; p.y = e.clientY;
    });
    const endLook = (e: PointerEvent) => this.looks.delete(e.pointerId);
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);

    // Buttons.
    this.root.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
      const kind = b.dataset.b!;
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        b.classList.add('on');
        b.setPointerCapture(e.pointerId);
        switch (kind) {
          case 'use': this.input.setUse(true); break;
          case 'jump': this.input.press('Space'); break;
          case 'crouch': this.input.press('KeyC'); break;
          case 'act': this.input.interact(); break;
          case 'hook': this.input.tap('KeyF'); break;
          case 'mode': actions.cycleMode(); break;
          case 'rot': this.input.tap('KeyR'); break;
          case 'inv': actions.inventory(); break;
          case 'menu': actions.pause(); break;
        }
      });
      const up = () => {
        b.classList.remove('on');
        if (kind === 'use') this.input.setUse(false);
        if (kind === 'jump') this.input.release('Space');
        if (kind === 'crouch') this.input.release('KeyC');
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });
  }

  /** Hide the controls while a menu is up (menus are tapped directly). */
  update() {
    const menu = this.actions.menuOpen();
    if (menu === this.menu) return;
    this.menu = menu;
    this.root.classList.toggle('menu-open', menu);
    if (menu) this.releaseAll();
  }

  private releaseAll() {
    this.stickId = null;
    this.looks.clear();
    this.input.axisForward = this.input.axisStrafe = 0;
    this.input.setUse(false);
    for (const k of ['ShiftLeft', 'Space', 'KeyC']) this.input.release(k);
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.root.querySelectorAll('button.on').forEach(b => b.classList.remove('on'));
  }

  private moveStick(x: number, y: number) {
    const max = 50;
    let dx = x - this.stickOrigin.x, dy = y - this.stickOrigin.y;
    const d = Math.hypot(dx, dy);
    if (d > max) { dx *= max / d; dy *= max / d; }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    this.input.axisStrafe = dx / max;
    this.input.axisForward = -dy / max;
    // Full push = sprint.
    if (d > max * 0.95) this.input.press('ShiftLeft'); else this.input.release('ShiftLeft');
  }

  /** Holding the Builder's Hammer: the shape button opens the build menu and a rotate button appears. */
  setHammer(on: boolean) {
    this.root.classList.toggle('hammer', on);
    const mode = this.root.querySelector<HTMLButtonElement>('[data-b="mode"]');
    if (mode) { mode.innerHTML = icon(on ? 'hammer' : 'cycle'); mode.setAttribute('aria-label', on ? 'Build menu' : 'Build shape'); }
  }

  setVisible(v: boolean) {
    this.root.style.display = v ? 'block' : 'none';
    if (!v) this.releaseAll();
  }
}
