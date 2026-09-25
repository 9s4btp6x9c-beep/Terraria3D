// Low-poly, textured creature models with procedural animation. Each model is
// a small hierarchy of meshes (so limbs can swing) sharing one per-creature
// material (for the white hit flash).

import * as THREE from 'three';
import type { Creature } from '../entities/creatures';
import { item } from '../items/items';
import { itemModel, parts } from './models';

const { box, cyl, ico, octa, cone, taper, merge } = parts;

export interface CreatureVisual {
  root: THREE.Group;
  animate(c: Creature, dt: number): void;
}

function mesh(g: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function pivot(parent: THREE.Object3D, x: number, y: number, z: number) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

function glob(mat: THREE.Material, tint: number): CreatureVisual {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  mesh(merge([
    ico(0.55, 'gel', { y: 0.42, sy: 0.78, detail: 1, jitter: 0.08, seed: 3 }, tint),
    ico(0.07, 'plain', { x: 0.22, y: 0.62, z: 0.34, sy: 1.4 }, 0x101018),
    ico(0.07, 'plain', { x: -0.22, y: 0.62, z: 0.34, sy: 1.4 }, 0x101018),
    ico(0.025, 'plain', { x: 0.24, y: 0.67, z: 0.4 }, 0xffffff),
    ico(0.025, 'plain', { x: -0.2, y: 0.67, z: 0.4 }, 0xffffff),
    ico(0.12, 'gel', { x: 0.2, y: 0.78, z: -0.1, sy: 0.5 }, 0xffffff),
  ]), mat, body);
  let squash = 0;
  return {
    root,
    animate(c, dt) {
      const target = c.grounded ? (c.cooldown < 0.25 ? -0.25 : 0) : Math.max(-0.2, Math.min(0.35, c.vy * 0.04));
      squash += (target - squash) * Math.min(1, dt * 12);
      body.scale.set(1 - squash * 0.5, 1 + squash, 1 - squash * 0.5);
    },
  };
}

function shambler(mat: THREE.Material): CreatureVisual {
  const root = new THREE.Group();
  const skin = 0x8aa070, rag = 0x5a6a80;
  const hipL = pivot(root, 0.13, 0.95, 0), hipR = pivot(root, -0.13, 0.95, 0);
  mesh(merge([box(0.16, 0.9, 0.18, 'cloth', { y: -0.45 }, 0x4a4040), box(0.18, 0.1, 0.26, 'plain', { y: -0.9, z: 0.04 }, 0x3a3030)]), mat, hipL);
  mesh(merge([box(0.16, 0.9, 0.18, 'cloth', { y: -0.45 }, 0x4a4040), box(0.18, 0.1, 0.26, 'plain', { y: -0.9, z: 0.04 }, 0x3a3030)]), mat, hipR);
  const torso = pivot(root, 0, 0.95, 0);
  mesh(merge([
    taper(0.46, 0.62, 0.26, 1.1, 1, 'cloth', { y: 0.31 }, rag),
    box(0.48, 0.08, 0.28, 'cloth', { y: 0.05 }, 0x3a3a48),
    box(0.1, 0.25, 0.02, 'cloth', { x: 0.12, y: -0.05, z: 0.13, rz: 0.3 }, rag),
  ]), mat, torso);
  const head = pivot(torso, 0, 0.66, 0.02);
  mesh(merge([
    box(0.3, 0.32, 0.3, 'plain', { y: 0.16 }, skin),
    box(0.07, 0.05, 0.03, 'flame', { x: 0.07, y: 0.2, z: 0.15 }, 0xff4020),
    box(0.07, 0.05, 0.03, 'flame', { x: -0.07, y: 0.2, z: 0.15 }, 0xff4020),
    box(0.2, 0.06, 0.04, 'plain', { y: 0.05, z: 0.15 }, 0x2a1a1a),
    box(0.32, 0.08, 0.32, 'cloth', { y: 0.33 }, 0x3a2a24),
  ]), mat, head);
  const shL = pivot(torso, 0.3, 0.55, 0), shR = pivot(torso, -0.3, 0.55, 0);
  for (const sh of [shL, shR]) mesh(merge([box(0.13, 0.62, 0.14, 'cloth', { y: -0.3 }, rag), box(0.12, 0.14, 0.13, 'plain', { y: -0.66 }, skin)]), mat, sh);
  return {
    root,
    animate(c) {
      const sp = Math.min(1, Math.hypot(c.vx, c.vz) / 2);
      const ph = c.t * 6;
      hipL.rotation.x = Math.sin(ph) * 0.6 * sp;
      hipR.rotation.x = -Math.sin(ph) * 0.6 * sp;
      // Classic outstretched arms, swaying.
      shL.rotation.x = -1.35 + Math.sin(ph * 0.5) * 0.12;
      shR.rotation.x = -1.35 - Math.sin(ph * 0.5 + 1) * 0.12;
      torso.rotation.z = Math.sin(ph) * 0.06 * sp;
      head.rotation.z = Math.sin(c.t * 1.3) * 0.2;
    },
  };
}

function gloomwisp(mat: THREE.Material): CreatureVisual {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0.5, 0);
  mesh(merge([
    ico(0.42, 'plain', { detail: 1 }, 0xf0e8e0),
    ico(0.2, 'plain', { z: 0.3, sz: 0.4 }, 0xb02030),
    ico(0.09, 'plain', { z: 0.4, sz: 0.4 }, 0x080808),
    ico(0.04, 'plain', { x: 0.06, y: 0.07, z: 0.45 }, 0xffffff),
    box(0.02, 0.2, 0.01, 'plain', { x: 0.2, y: 0.18, z: 0.3, rz: 0.8 }, 0xc04040),
    box(0.02, 0.18, 0.01, 'plain', { x: -0.2, y: -0.12, z: 0.32, rz: -0.6 }, 0xc04040),
  ]), mat, body);
  const tails: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const p = pivot(body, (i - 1) * 0.16, (i % 2) * 0.1 - 0.05, -0.32);
    mesh(merge([taper(0.12, 0.7, 0.1, 0.2, 0.2, 'cloth', { y: 0.35, rx: 0 }, 0x6a1a2a)]), mat, p).rotation.x = -Math.PI / 2;
    tails.push(p);
  }
  return {
    root,
    animate(c) {
      body.position.y = 0.5 + Math.sin(c.t * 2) * 0.08;
      tails.forEach((t, i) => { t.rotation.x = Math.sin(c.t * 5 + i) * 0.4; t.rotation.y = Math.cos(c.t * 4 + i * 2) * 0.3; });
    },
  };
}

function duskwing(mat: THREE.Material): CreatureVisual {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0.35, 0);
  mesh(merge([
    ico(0.18, 'fur', { sy: 1.15, detail: 1 }),
    ico(0.13, 'fur', { y: 0.16, z: 0.08 }),
    cone(0.05, 0.14, 4, 'fur', { x: 0.07, y: 0.3, z: 0.06 }),
    cone(0.05, 0.14, 4, 'fur', { x: -0.07, y: 0.3, z: 0.06 }),
    octa(0.025, 'flame', { x: 0.05, y: 0.19, z: 0.19 }, 0xff3030),
    octa(0.025, 'flame', { x: -0.05, y: 0.19, z: 0.19 }, 0xff3030),
    cone(0.012, 0.05, 3, 'plain', { x: 0.03, y: 0.09, z: 0.19, rx: Math.PI }, 0xffffff),
    cone(0.012, 0.05, 3, 'plain', { x: -0.03, y: 0.09, z: 0.19, rx: Math.PI }, 0xffffff),
  ]), mat, body);
  const wing = (side: number) => {
    const p = pivot(body, side * 0.12, 0.05, 0);
    mesh(merge([
      taper(0.5, 0.02, 0.36, 0.2, 0.4, 'fur', { x: side * 0.25, rz: side * Math.PI / 2 }, 0x9a88a0),
      box(0.5, 0.03, 0.03, 'fur', { x: side * 0.25, y: 0.01, z: 0.15 }),
    ]), mat, p);
    return p;
  };
  const wl = wing(1), wr = wing(-1);
  return {
    root,
    animate(c) {
      const f = Math.sin(c.t * 22) * 0.9;
      wl.rotation.z = f; wr.rotation.z = -f;
      body.position.y = 0.35 + Math.sin(c.t * 22) * 0.04;
    },
  };
}

function rockmite(mat: THREE.Material): CreatureVisual {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0.36, 0);
  mesh(merge([
    ico(0.34, 'chitin', { z: -0.25, sx: 1, sy: 0.7, sz: 1.2, jitter: 0.15, seed: 4 }, 0xb0aab8),
    ico(0.28, 'chitin', { z: 0.12, sy: 0.72, jitter: 0.15, seed: 5 }, 0xc0bac8),
    ico(0.2, 'chitin', { y: 0.02, z: 0.42, sy: 0.8 }, 0xa09aa8),
    ico(0.14, 'stone', { x: 0.1, y: 0.22, z: -0.28, jitter: 0.4, seed: 6 }),
    ico(0.12, 'stone', { x: -0.12, y: 0.2, z: -0.05, jitter: 0.4, seed: 8 }),
    cone(0.035, 0.18, 4, 'bone', { x: 0.08, y: -0.05, z: 0.6, rx: Math.PI / 2, rz: -0.3 }),
    cone(0.035, 0.18, 4, 'bone', { x: -0.08, y: -0.05, z: 0.6, rx: Math.PI / 2, rz: 0.3 }),
    octa(0.03, 'flame', { x: 0.08, y: 0.1, z: 0.58 }, 0xffe040),
    octa(0.03, 'flame', { x: -0.08, y: 0.1, z: 0.58 }, 0xffe040),
  ]), mat, body);
  const legs: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) {
    const side = i < 3 ? 1 : -1, row = i % 3;
    const p = pivot(body, side * 0.22, -0.02, 0.28 - row * 0.3);
    mesh(merge([
      box(0.36, 0.05, 0.05, 'chitin', { x: side * 0.18, y: 0.05, rz: side * 0.35 }),
      box(0.05, 0.36, 0.05, 'chitin', { x: side * 0.36, y: -0.1 }),
    ]), mat, p);
    legs.push(p);
  }
  return {
    root,
    animate(c) {
      const sp = Math.min(1, Math.hypot(c.vx, c.vz) / 1.5);
      legs.forEach((l, i) => {
        const ph = c.t * 12 + (i % 2 === (i < 3 ? 0 : 1) ? 0 : Math.PI);
        l.rotation.y = Math.sin(ph) * 0.4 * sp;
        l.rotation.z = Math.max(0, Math.cos(ph)) * 0.25 * sp * (i < 3 ? 1 : -1);
      });
      body.position.y = 0.36 + Math.abs(Math.sin(c.t * 12)) * 0.03 * sp;
    },
  };
}

function hollowMiner(mat: THREE.Material): CreatureVisual {
  const root = new THREE.Group();
  const bone = (g: THREE.BufferGeometry[]) => merge(g);
  const hipL = pivot(root, 0.12, 0.92, 0), hipR = pivot(root, -0.12, 0.92, 0);
  for (const h of [hipL, hipR]) mesh(bone([box(0.08, 0.88, 0.08, 'bone', { y: -0.44 }), box(0.12, 0.08, 0.2, 'bone', { y: -0.9, z: 0.04 })]), mat, h);
  const torso = pivot(root, 0, 0.92, 0);
  mesh(bone([
    box(0.34, 0.1, 0.2, 'bone', { y: 0.02 }),
    box(0.06, 0.6, 0.06, 'bone', { y: 0.32, z: -0.06 }),
    ...[0, 1, 2, 3].map(i => box(0.4 - i * 0.04, 0.05, 0.24, 'bone', { y: 0.25 + i * 0.1 })),
    box(0.5, 0.08, 0.14, 'bone', { y: 0.62 }),
    box(0.3, 0.3, 0.02, 'cloth', { x: 0.05, y: 0.3, z: 0.13, rz: 0.1 }, 0x4a3a30),
  ]), mat, torso);
  const head = pivot(torso, 0, 0.68, 0);
  mesh(bone([
    box(0.28, 0.26, 0.28, 'bone', { y: 0.14 }),
    box(0.22, 0.08, 0.24, 'bone', { y: -0.01, z: 0.02 }),
    box(0.07, 0.07, 0.02, 'metal', { x: 0.07, y: 0.14, z: 0.14 }, 0x101010),
    box(0.07, 0.07, 0.02, 'metal', { x: -0.07, y: 0.14, z: 0.14 }, 0x101010),
    octa(0.02, 'flame', { x: 0.07, y: 0.14, z: 0.16 }, 0x80ffff),
    octa(0.02, 'flame', { x: -0.07, y: 0.14, z: 0.16 }, 0x80ffff),
    cyl(0.2, 0.21, 0.12, 8, 'metal', { y: 0.3 }, 0xd0b060),
    cyl(0.25, 0.25, 0.03, 8, 'metal', { y: 0.25 }, 0xd0b060),
    box(0.1, 0.08, 0.06, 'flame', { y: 0.32, z: 0.2 }),
  ]), mat, head);
  const shL = pivot(torso, 0.28, 0.6, 0), shR = pivot(torso, -0.28, 0.6, 0);
  mesh(bone([box(0.07, 0.62, 0.07, 'bone', { y: -0.31 })]), mat, shL);
  mesh(bone([box(0.07, 0.62, 0.07, 'bone', { y: -0.31 })]), mat, shR);
  const pick = new THREE.Mesh(itemModel(item('iron_pickaxe')), mat);
  pick.position.set(0, -0.6, 0.05);
  pick.rotation.set(Math.PI / 2, 0, 0);
  shR.add(pick);
  return {
    root,
    animate(c) {
      const sp = Math.min(1, Math.hypot(c.vx, c.vz) / 2);
      const ph = c.t * 7;
      hipL.rotation.x = Math.sin(ph) * 0.55 * sp;
      hipR.rotation.x = -Math.sin(ph) * 0.55 * sp;
      shL.rotation.x = -Math.sin(ph) * 0.4 * sp;
      // Throwing arm winds up just before the next throw.
      const r = c.def.ranged!;
      const wind = c.cooldown < 0.4 ? (0.4 - c.cooldown) / 0.4 : c.cooldown > r.interval * 0.8 ? 1 - (c.cooldown - r.interval * 0.8) * 6 : 0;
      shR.rotation.x = -wind * 2.6 + Math.sin(ph) * 0.3 * sp;
      head.rotation.y = Math.sin(c.t * 0.9) * 0.3;
    },
  };
}

export function buildCreatureVisual(id: string, mat: THREE.Material): CreatureVisual {
  switch (id) {
    case 'glob': return glob(mat, 0xffffff);
    case 'deep_glob': return glob(mat, 0x80a8ff);
    case 'shambler': return shambler(mat);
    case 'gloomwisp': return gloomwisp(mat);
    case 'duskwing': return duskwing(mat);
    case 'rockmite': return rockmite(mat);
    case 'hollow_miner': return hollowMiner(mat);
    default: return glob(mat, 0xff80ff);
  }
}
