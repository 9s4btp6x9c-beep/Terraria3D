// Floating world-anchored labels: damage numbers, heal numbers and pickup
// notices, projected to the screen every frame. Pooled DOM elements.

import * as THREE from 'three';

interface Label { el: HTMLDivElement; x: number; y: number; z: number; t: number; life: number; vy: number }

export class WorldLabels {
  private root: HTMLElement;
  private pool: HTMLDivElement[] = [];
  private live: Label[] = [];
  private v = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none';
    parent.appendChild(this.root);
  }

  add(x: number, y: number, z: number, text: string, color: string, big = false) {
    const el = this.pool.pop() ?? document.createElement('div');
    el.textContent = text;
    el.style.cssText = `position:absolute;left:0;top:0;font-weight:bold;font-size:${big ? 22 : 17}px;color:${color};` +
      'text-shadow:2px 2px 0 #000,-1px -1px 0 #000;white-space:nowrap;will-change:transform';
    this.root.appendChild(el);
    this.live.push({ el, x: x + (Math.random() - 0.5) * 0.4, y, z: z + (Math.random() - 0.5) * 0.4, t: 0, life: 0.9, vy: 1.8 });
  }

  update(dt: number, camera: THREE.Camera, w: number, h: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i];
      l.t += dt;
      l.y += l.vy * dt;
      l.vy -= 2.5 * dt;
      if (l.t > l.life) {
        l.el.remove();
        this.pool.push(l.el);
        this.live.splice(i, 1);
        continue;
      }
      this.v.set(l.x, l.y, l.z).project(camera);
      if (this.v.z > 1) { l.el.style.opacity = '0'; continue; }
      const sx = (this.v.x * 0.5 + 0.5) * w, sy = (-this.v.y * 0.5 + 0.5) * h;
      const pop = l.t < 0.1 ? 1 + (0.1 - l.t) * 5 : 1;
      l.el.style.opacity = String(Math.min(1, (l.life - l.t) * 3));
      l.el.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-50%) scale(${pop.toFixed(2)})`;
    }
  }
}
