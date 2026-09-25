// Keyboard/mouse state with pointer lock, plus analog/virtual inputs used by
// the touch controls. When pointer lock is unavailable (embedded pages),
// mouse movement still drives the camera ("free look").

export class Input {
  readonly keys = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  lmb = false;
  rmb = false;
  private lmbPressed = false;
  private rmbPressed = false;
  locked = false;
  sensitivity = 0.0022;
  /** Analog movement from a virtual joystick (-1..1). */
  axisForward = 0;
  axisStrafe = 0;
  /** Touch mode: no pointer lock, virtual buttons. */
  touchMode = false;
  /** Pointer lock failed (e.g. sandboxed iframe): use free mouse look. */
  freeLook = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', e => {
      if (['Tab', 'F3', 'F5', 'F9', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (this.freeLook && e.code === 'Escape') this.setFreeLookActive(false);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.lmb = this.rmb = false; });
    canvas.addEventListener('mousedown', e => {
      if (!this.locked || this.touchMode) return;
      if (e.button === 0) { this.lmb = true; this.lmbPressed = true; }
      if (e.button === 2) { this.rmb = true; this.rmbPressed = true; }
    });
    window.addEventListener('mouseup', e => {
      if (this.touchMode) return;
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) this.rmb = false;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('mousemove', e => {
      if (!this.locked || this.touchMode) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('wheel', e => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      if (this.freeLook || this.touchMode) return;
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.lmb = this.rmb = false; }
    });
    document.addEventListener('pointerlockerror', () => {
      // Embedded without pointer-lock permission: fall back to free look.
      this.freeLook = true;
      this.setFreeLookActive(true);
    });
  }

  private freeLookListener: ((active: boolean) => void) | null = null;
  /** Called when free-look (no pointer lock) mode starts/stops. */
  onFreeLook(fn: (active: boolean) => void) { this.freeLookListener = fn; }
  private setFreeLookActive(on: boolean) {
    this.locked = on;
    if (!on) { this.lmb = this.rmb = false; }
    this.freeLookListener?.(on);
  }

  lock() {
    if (this.touchMode) { this.locked = true; return; }
    if (this.freeLook) { this.setFreeLookActive(true); return; }
    try {
      const r = this.canvas.requestPointerLock?.() as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => { this.freeLook = true; this.setFreeLookActive(true); });
    } catch {
      this.freeLook = true;
      this.setFreeLookActive(true);
    }
  }

  unlock() {
    if (this.touchMode) return; // touch UI stays interactive; menus are tapped
    if (this.freeLook) { this.locked = false; this.lmb = this.rmb = false; return; }
    document.exitPointerLock?.();
  }

  /** True once per physical key press. */
  wasPressed(code: string) { return this.pressed.has(code); }
  down(code: string) { return this.keys.has(code); }
  consumeClick() { const c = this.lmbPressed; this.lmbPressed = false; return c; }
  consumeAlt() { const c = this.rmbPressed; this.rmbPressed = false; return c; }

  // ---- virtual controls (touch)
  press(code: string) { if (!this.keys.has(code)) this.pressed.add(code); this.keys.add(code); }
  release(code: string) { this.keys.delete(code); }
  tap(code: string) { this.pressed.add(code); }
  setUse(down: boolean) { if (down && !this.lmb) this.lmbPressed = true; this.lmb = down; }
  interact() { this.rmbPressed = true; }
  look(dx: number, dy: number) { this.mouseDX += dx; this.mouseDY += dy; }

  endFrame() {
    this.pressed.clear();
    this.mouseDX = this.mouseDY = 0;
    this.wheel = 0;
    this.lmbPressed = false;
    this.rmbPressed = false;
  }
}
