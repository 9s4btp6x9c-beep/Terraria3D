// Dropped items: small spinning copies of the item model that pop out of
// mined terrain, felled trees and defeated creatures, bounce on the ground
// and fly into the player's inventory when near (a gentle magnet).

import * as THREE from 'three';
import type { Inventory } from '../items/inventory';
import { item } from '../items/items';
import { itemModel } from './models';

interface Pickup {
  id: string; count: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
  mesh: THREE.Mesh;
  scale: number;
}

const MAGNET = 4.2;
const COLLECT = 0.9;
const MAX_PICKUPS = 160;

export class Pickups {
  readonly group = new THREE.Group();
  private list: Pickup[] = [];

  constructor(
    private material: THREE.Material,
    private solid: (x: number, y: number, z: number) => boolean,
    private inv: Inventory,
    private onCollect: (id: string, count: number) => void,
  ) {}

  spawn(id: string, count: number, x: number, y: number, z: number, burst = 2.5) {
    // Merge into a nearby identical pickup to keep counts low.
    for (const p of this.list) {
      if (p.id === id && p.age < 0.4 && (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2 < 1) { p.count += count; return; }
    }
    if (this.list.length >= MAX_PICKUPS) {
      // Oldest pickup goes straight to the inventory rather than vanishing.
      const old = this.list.shift()!;
      this.collect(old);
    }
    const geo = itemModel(item(id));
    const mesh = new THREE.Mesh(geo, this.material);
    const scale = Math.min(1.4, 0.2 / (geo.boundingSphere?.radius ?? 0.2));
    mesh.scale.setScalar(scale);
    mesh.castShadow = true;
    this.group.add(mesh);
    const a = Math.random() * Math.PI * 2;
    this.list.push({ id, count, x, y, z, vx: Math.cos(a) * burst * 0.4, vy: burst, vz: Math.sin(a) * burst * 0.4, age: 0, mesh, scale });
  }

  private collect(p: Pickup): boolean {
    const left = this.inv.add(p.id, p.count);
    const got = p.count - left;
    if (got > 0) this.onCollect(p.id, got);
    p.count = left;
    return left === 0;
  }

  update(dt: number, px: number, py: number, pz: number) {
    const cy = py + 0.9;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      const dx = px - p.x, dy = cy - p.y, dz = pz - p.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const canTake = p.age > 0.35 && this.inv.hasRoomFor(p.id, 1);
      if (canTake && d < MAGNET) {
        // Fly to the player, accelerating as it gets closer.
        const sp = 9 + (MAGNET - d) * 6;
        p.vx += (dx / d * sp - p.vx) * Math.min(1, dt * 10);
        p.vy += (dy / d * sp - p.vy) * Math.min(1, dt * 10);
        p.vz += (dz / d * sp - p.vz) * Math.min(1, dt * 10);
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (d < COLLECT && this.collect(p)) {
          this.group.remove(p.mesh);
          this.list.splice(i, 1);
          continue;
        }
      } else {
        p.vy -= 20 * dt;
        const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
        if (this.solid(nx, ny - 0.12, nz)) {
          if (this.solid(p.x, p.y + 0.3, p.z)) p.y += 0.5; // got buried: pop out
          p.vy = Math.abs(p.vy) > 2 ? Math.abs(p.vy) * 0.35 : 0;
          p.vx *= 0.6; p.vz *= 0.6;
        } else { p.x = nx; p.y = ny; p.z = nz; }
      }
      // Despawn after 5 minutes.
      if (p.age > 300) { this.group.remove(p.mesh); this.list.splice(i, 1); continue; }
      p.mesh.position.set(p.x, p.y + 0.12 + Math.sin(p.age * 3) * 0.05, p.z);
      p.mesh.rotation.y = p.age * 1.8;
    }
  }

  get count() { return this.list.length; }

  serialize() { return this.list.map(p => ({ id: p.id, count: p.count, x: p.x, y: p.y, z: p.z })); }
}
