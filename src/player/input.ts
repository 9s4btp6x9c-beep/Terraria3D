// Keyboard/mouse state with pointer lock.

export class Input {
  readonly keys = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  lmb = false;
  rmb = false;
  private lmbPressed = false;
  locked = false;
  sensitivity = 0.0022;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', e => {
      if (['Tab', 'F3', 'F5', 'F9', 'Space'].includes(e.code) || (e.ctrlKey && e.code !== 'KeyR')) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.lmb = this.rmb = false; });
    canvas.addEventListener('mousedown', e => {
      if (!this.locked) return;
      if (e.button === 0) { this.lmb = true; this.lmbPressed = true; }
      if (e.button === 2) this.rmb = true;
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) this.rmb = false;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('wheel', e => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.lmb = this.rmb = false; }
    });
  }

  lock() { this.canvas.requestPointerLock?.(); }
  unlock() { document.exitPointerLock?.(); }

  /** True once per physical key press. */
  wasPressed(code: string) { return this.pressed.has(code); }
  down(code: string) { return this.keys.has(code); }
  consumeClick() { const c = this.lmbPressed; this.lmbPressed = false; return c; }

  endFrame() {
    this.pressed.clear();
    this.mouseDX = this.mouseDY = 0;
    this.wheel = 0;
    this.lmbPressed = false;
  }
}
