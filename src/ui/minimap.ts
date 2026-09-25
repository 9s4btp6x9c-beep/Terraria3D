// Top-down minimap: surface material colours shaded by height, water, and a
// player arrow. Regions are refreshed after terrain edits.

import { Mat, material } from '../world/materials';
import type { SkyMap } from '../world/skymap';
import type { TerrainField } from '../world/terrain';

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private baseCtx: CanvasRenderingContext2D;
  private img: ImageData;

  constructor(private canvas: HTMLCanvasElement, private field: TerrainField, private sky: SkyMap, private seaLevel: number) {
    this.ctx = canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.base.width = field.sx; this.base.height = field.sz;
    this.baseCtx = this.base.getContext('2d')!;
    this.img = this.baseCtx.createImageData(field.sx, field.sz);
    this.refresh(0, 0, field.sx - 1, field.sz - 1);
  }

  refresh(x0: number, z0: number, x1: number, z1: number) {
    const f = this.field, d = this.img.data;
    x0 = Math.max(0, Math.floor(x0)); z0 = Math.max(0, Math.floor(z0));
    x1 = Math.min(f.sx - 1, Math.ceil(x1)); z1 = Math.min(f.sz - 1, Math.ceil(z1));
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const h = this.sky.raw[x + z * f.sx];
        const i = (x + z * f.sx) * 4;
        let r: number, g: number, b: number;
        if (h < this.seaLevel) {
          const deep = Math.min(1, (this.seaLevel - h) / 12);
          r = 60 - deep * 30; g = 120 - deep * 40; b = 200 - deep * 40;
        } else {
          const m = f.materialNear(x, h - 0.3, z);
          const c = material(m === Mat.Air ? Mat.Stone : m).palette[0];
          const shade = 0.7 + Math.min(0.5, (h - this.seaLevel) / 120);
          const hx = this.sky.raw[Math.min(f.sx - 1, x + 1) + z * f.sx] - h;
          const light = 1 + Math.max(-0.25, Math.min(0.25, -hx * 0.12));
          r = ((c >> 16) & 255) * shade * light; g = ((c >> 8) & 255) * shade * light; b = (c & 255) * shade * light;
        }
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
      }
    this.baseCtx.putImageData(this.img, 0, 0);
  }

  /** Draw the map centred on the player (zoomed view of the local area). */
  draw(px: number, pz: number, yaw: number, markers: { x: number; z: number; color: string }[] = []) {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const view = 128; // metres across
    const scale = W / view;
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#1c3050';
    c.fillRect(0, 0, W, H);
    c.drawImage(this.base, px - view / 2, pz - view / 2, view, view, 0, 0, W, H);
    for (const m of markers) {
      const mx = (m.x - px) * scale + W / 2, my = (m.z - pz) * scale + H / 2;
      if (mx < 0 || my < 0 || mx > W || my > H) continue;
      c.fillStyle = m.color;
      c.fillRect(mx - 2, my - 2, 4, 4);
    }
    // Player arrow.
    c.save();
    c.translate(W / 2, H / 2);
    c.rotate(-yaw);
    c.fillStyle = '#fff';
    c.strokeStyle = '#000';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -7); c.lineTo(5, 6); c.lineTo(0, 3); c.lineTo(-5, 6); c.closePath();
    c.fill(); c.stroke();
    c.restore();
  }
}
