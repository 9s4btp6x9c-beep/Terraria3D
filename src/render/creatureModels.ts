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

function glob(mat: THREE.Material, tint: number, skin = 'gel'): CreatureVisual {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  const fangs = skin === 'bloodgel' ? [
    box(0.32, 0.06, 0.06, 'plain', { y: 0.32, z: 0.5 }, 0x2a0a10),
    cone(0.045, 0.13, 4, 'bone', { x: 0.1, y: 0.25, z: 0.52, rx: Math.PI }, 0xfff8e8),
    cone(0.045, 0.13, 4, 'bone', { x: -0.1, y: 0.25, z: 0.52, rx: Math.PI }, 0xfff8e8),
  ] : [];
  mesh(merge([
    ico(0.55, skin, { y: 0.42, sy: 0.78, detail: 1, jitter: 0.08, seed: 3 }, tint),
    ...fangs,
    ico(0.07, 'plain', { x: 0.22, y: 0.62, z: 0.34, sy: 1.4 }, 0x101018),
    ico(0.07, 'plain', { x: -0.22, y: 0.62, z: 0.34, sy: 1.4 }, 0x101018),
    ico(0.025, 'plain', { x: 0.24, y: 0.67, z: 0.4 }, 0xffffff),
    ico(0.025, 'plain', { x: -0.2, y: 0.67, z: 0.4 }, 0xffffff),
    ico(0.12, skin, { x: 0.2, y: 0.78, z: -0.1, sy: 0.5 }, 0xffffff),
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

function shambler(mat: THREE.Material, tint = 0xffffff): CreatureVisual {
  const root = new THREE.Group();
  const skin = mulTint(0x8aa070, tint), rag = mulTint(0x5a6a80, tint);
  const hipL = pivot(root, 0.13, 0.95, 0), hipR = pivot(root, -0.13, 0.95, 0);
  mesh(merge([box(0.16, 0.9, 0.18, 'fabric', { y: -0.45 }, 0x4a4040), box(0.18, 0.1, 0.26, 'plain', { y: -0.9, z: 0.04 }, 0x3a3030)]), mat, hipL);
  mesh(merge([box(0.16, 0.9, 0.18, 'fabric', { y: -0.45 }, 0x4a4040), box(0.18, 0.1, 0.26, 'plain', { y: -0.9, z: 0.04 }, 0x3a3030)]), mat, hipR);
  const torso = pivot(root, 0, 0.95, 0);
  mesh(merge([
    taper(0.46, 0.62, 0.26, 1.1, 1, 'fabric', { y: 0.31 }, rag),
    box(0.48, 0.08, 0.28, 'fabric', { y: 0.05 }, 0x3a3a48),
    box(0.1, 0.25, 0.02, 'fabric', { x: 0.12, y: -0.05, z: 0.13, rz: 0.3 }, rag),
  ]), mat, torso);
  const head = pivot(torso, 0, 0.66, 0.02);
  mesh(merge([
    box(0.3, 0.32, 0.3, 'plain', { y: 0.16 }, skin),
    box(0.07, 0.05, 0.03, 'flame', { x: 0.07, y: 0.2, z: 0.15 }, 0xff4020),
    box(0.07, 0.05, 0.03, 'flame', { x: -0.07, y: 0.2, z: 0.15 }, 0xff4020),
    box(0.2, 0.06, 0.04, 'plain', { y: 0.05, z: 0.15 }, 0x2a1a1a),
    box(0.32, 0.08, 0.32, 'fabric', { y: 0.33 }, 0x3a2a24),
  ]), mat, head);
  const shL = pivot(torso, 0.3, 0.55, 0), shR = pivot(torso, -0.3, 0.55, 0);
  for (const sh of [shL, shR]) mesh(merge([box(0.13, 0.62, 0.14, 'fabric', { y: -0.3 }, rag), box(0.12, 0.14, 0.13, 'plain', { y: -0.66 }, skin)]), mat, sh);
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

function gloomwisp(mat: THREE.Material, tint = 0xffffff): CreatureVisual {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0.5, 0);
  const tinted = tint !== 0xffffff;
  mesh(merge([
    ico(0.42, 'plain', { detail: 1 }, mulTint(0xf0e8e0, tint)),
    // Tinted variants get a glowing yellow iris so they read at night.
    tinted ? ico(0.2, 'flame', { z: 0.3, sz: 0.4 }, 0xffe060) : ico(0.2, 'plain', { z: 0.3, sz: 0.4 }, 0xb02030),
    ico(0.09, 'plain', { z: 0.4, sz: 0.4 }, 0x080808),
    ico(0.04, 'plain', { x: 0.06, y: 0.07, z: 0.45 }, 0xffffff),
    box(0.02, 0.2, 0.01, 'plain', { x: 0.2, y: 0.18, z: 0.3, rz: 0.8 }, 0xc04040),
    box(0.02, 0.18, 0.01, 'plain', { x: -0.2, y: -0.12, z: 0.32, rz: -0.6 }, 0xc04040),
  ]), mat, body);
  const tails: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const p = pivot(body, (i - 1) * 0.16, (i % 2) * 0.1 - 0.05, -0.32);
    mesh(merge([taper(0.12, 0.7, 0.1, 0.2, 0.2, 'fabric', { y: 0.35, rx: 0 }, mulTint(0x6a1a2a, tint))]), mat, p).rotation.x = -Math.PI / 2;
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

function duskwing(mat: THREE.Material, tint = 0xffffff): CreatureVisual {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0.35, 0);
  mesh(merge([
    ico(0.18, 'fur', { sy: 1.15, detail: 1 }, tint),
    ico(0.13, 'fur', { y: 0.16, z: 0.08 }, tint),
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
      taper(0.5, 0.02, 0.36, 0.2, 0.4, 'fur', { x: side * 0.25, rz: side * Math.PI / 2 }, mulTint(0x9a88a0, tint)),
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

function rockmite(mat: THREE.Material, tint = 0xffffff): CreatureVisual {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0.36, 0);
  mesh(merge([
    ico(0.34, 'chitin', { z: -0.25, sx: 1, sy: 0.7, sz: 1.2, jitter: 0.15, seed: 4 }, mulTint(0xb0aab8, tint)),
    ico(0.28, 'chitin', { z: 0.12, sy: 0.72, jitter: 0.15, seed: 5 }, mulTint(0xc0bac8, tint)),
    ico(0.2, 'chitin', { y: 0.02, z: 0.42, sy: 0.8 }, mulTint(0xa09aa8, tint)),
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

function hollowMiner(mat: THREE.Material, sapper = false): CreatureVisual {
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
    box(0.3, 0.3, 0.02, 'fabric', { x: 0.05, y: 0.3, z: 0.13, rz: 0.1 }, 0x4a3a30),
  ]), mat, torso);
  const head = pivot(torso, 0, 0.68, 0);
  mesh(bone([
    box(0.28, 0.26, 0.28, 'bone', { y: 0.14 }),
    box(0.22, 0.08, 0.24, 'bone', { y: -0.01, z: 0.02 }),
    box(0.07, 0.07, 0.02, 'metal', { x: 0.07, y: 0.14, z: 0.14 }, 0x101010),
    box(0.07, 0.07, 0.02, 'metal', { x: -0.07, y: 0.14, z: 0.14 }, 0x101010),
    octa(0.02, 'flame', { x: 0.07, y: 0.14, z: 0.16 }, 0x80ffff),
    octa(0.02, 'flame', { x: -0.07, y: 0.14, z: 0.16 }, 0x80ffff),
    ...(sapper ? [
      // Leather hood and brass goggles.
      box(0.32, 0.18, 0.32, 'fabric', { y: 0.3 }, 0x6a4a30),
      box(0.3, 0.05, 0.05, 'metal', { y: 0.2, z: 0.16 }, 0x3a2a20),
      cyl(0.05, 0.05, 0.04, 6, 'gold', { x: 0.07, y: 0.2, z: 0.18, rx: Math.PI / 2 }),
      cyl(0.05, 0.05, 0.04, 6, 'gold', { x: -0.07, y: 0.2, z: 0.18, rx: Math.PI / 2 }),
    ] : [
      cyl(0.2, 0.21, 0.12, 8, 'metal', { y: 0.3 }, 0xd0b060),
      cyl(0.25, 0.25, 0.03, 8, 'metal', { y: 0.25 }, 0xd0b060),
      box(0.1, 0.08, 0.06, 'flame', { y: 0.32, z: 0.2 }),
    ]),
  ]), mat, head);
  if (sapper) {
    // Satchel of bombs on the hip.
    mesh(merge([
      box(0.2, 0.2, 0.12, 'fabric', { x: -0.22, y: 0.05, z: 0.02 }, 0x6a4a30),
      box(0.62, 0.04, 0.03, 'fabric', { y: 0.35, z: 0.11, rz: -0.8 }, 0x4a3020),
      ico(0.07, 'metal', { x: -0.2, y: 0.18, z: 0.03 }, 0x6a6878),
      ico(0.06, 'metal', { x: -0.27, y: 0.17, z: -0.02 }, 0x6a6878),
    ]), mat, torso);
  }
  const shL = pivot(torso, 0.28, 0.6, 0), shR = pivot(torso, -0.28, 0.6, 0);
  mesh(bone([box(0.07, 0.62, 0.07, 'bone', { y: -0.31 })]), mat, shL);
  mesh(bone([box(0.07, 0.62, 0.07, 'bone', { y: -0.31 })]), mat, shR);
  const tool = new THREE.Mesh(itemModel(item(sapper ? 'bomb' : 'iron_pickaxe')), mat);
  if (sapper) tool.position.set(0, -0.72, 0.02);
  else { tool.position.set(0, -0.6, 0.05); tool.rotation.set(Math.PI / 2, 0, 0); }
  shR.add(tool);
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

/** Gorehound: a lean, skinless hound with exposed ribs and a split jaw. */
function gorehound(mat: THREE.Material): CreatureVisual {
  const outer = new THREE.Group();
  const root = pivot(outer, 0, 0, 0);
  root.scale.setScalar(1.18);
  const body = pivot(root, 0, 0.62, 0);
  mesh(merge([
    taper(0.42, 0.4, 0.95, 0.85, 0.8, 'hide', { z: -0.05 }),
    ico(0.26, 'hide', { z: 0.36, y: 0.04, sx: 1.1, sy: 0.95, jitter: 0.12, seed: 21 }),
    ...[0, 1, 2, 3].map(i => box(0.46, 0.04, 0.05, 'bone', { y: -0.06 + i * 0.015, z: 0.18 - i * 0.14, rx: 0.1 })),
    box(0.06, 0.05, 0.9, 'bone', { y: 0.21, z: -0.05 }),
    ...[0, 1, 2, 3, 4].map(i => cone(0.035, 0.14, 4, 'bone', { y: 0.26, z: 0.3 - i * 0.16, rx: -0.4 })),
  ]), mat, body);
  // Head with an upper skull and a hinged lower jaw.
  const neck = pivot(body, 0, 0.12, 0.5);
  mesh(merge([
    box(0.3, 0.2, 0.36, 'hide', { y: 0.02, z: 0.14 }),
    taper(0.22, 0.12, 0.26, 0.8, 0.8, 'hide', { y: 0.0, z: 0.4, rx: Math.PI / 2 }),
    cone(0.05, 0.16, 4, 'hide', { x: 0.1, y: 0.16, z: 0.02, rx: -0.4 }),
    cone(0.05, 0.16, 4, 'hide', { x: -0.1, y: 0.16, z: 0.02, rx: -0.4 }),
    octa(0.035, 'flame', { x: 0.1, y: 0.08, z: 0.3 }, 0xffe060),
    octa(0.035, 'flame', { x: -0.1, y: 0.08, z: 0.3 }, 0xffe060),
    ...[-0.07, -0.025, 0.025, 0.07].map(x => cone(0.018, 0.08, 3, 'bone', { x, y: -0.09, z: 0.46, rx: Math.PI }, 0xfff8e8)),
  ]), mat, neck);
  const jaw = pivot(neck, 0, -0.08, 0.16);
  mesh(merge([
    box(0.2, 0.06, 0.34, 'hide', { z: 0.16 }),
    ...[-0.06, 0, 0.06].map(x => cone(0.016, 0.07, 3, 'bone', { x, y: 0.05, z: 0.28 }, 0xfff8e8)),
  ]), mat, jaw);
  const legs: THREE.Group[] = [];
  for (const [x, z] of [[0.16, 0.3], [-0.16, 0.3], [0.15, -0.38], [-0.15, -0.38]]) {
    const p = pivot(body, x, -0.1, z);
    mesh(merge([
      box(0.1, 0.32, 0.12, 'hide', { y: -0.14 }),
      box(0.07, 0.26, 0.07, 'bone', { y: -0.38, z: z > 0 ? 0.02 : -0.04 }),
      box(0.1, 0.05, 0.14, 'hide', { y: -0.5, z: 0.03 }),
    ]), mat, p);
    legs.push(p);
  }
  const tail = pivot(body, 0, 0.14, -0.5);
  mesh(merge([taper(0.07, 0.5, 0.07, 0.3, 0.3, 'hide', { y: 0.25 })]), mat, tail).rotation.x = -2.2;
  return {
    root: outer,
    animate(c) {
      const sp = Math.min(1, Math.hypot(c.vx, c.vz) / 5);
      const ph = c.t * 11;
      // Gallop: front and back pairs alternate.
      legs[0].rotation.x = Math.sin(ph) * 0.9 * sp;
      legs[1].rotation.x = Math.sin(ph + 0.4) * 0.9 * sp;
      legs[2].rotation.x = -Math.sin(ph) * 0.9 * sp;
      legs[3].rotation.x = -Math.sin(ph + 0.4) * 0.9 * sp;
      body.rotation.x = c.grounded ? Math.sin(ph) * 0.08 * sp : -Math.max(-0.4, Math.min(0.4, c.vy * 0.05));
      body.position.y = 0.62 + Math.abs(Math.cos(ph)) * 0.06 * sp;
      jaw.rotation.x = c.attack > 0 ? 0.7 : 0.15 + Math.sin(c.t * 3) * 0.1;
      neck.rotation.x = c.attack > 0 ? -0.25 : 0.05;
      tail.rotation.y = Math.sin(c.t * 7) * 0.3;
    },
  };
}

/** Hollow Brute: a hulking armoured skeleton with a studded bone club. */
function hollowBrute(mat: THREE.Material): CreatureVisual {
  const root = new THREE.Group();
  const hipL = pivot(root, 0.22, 1.25, 0), hipR = pivot(root, -0.22, 1.25, 0);
  for (const h of [hipL, hipR]) {
    mesh(merge([
      box(0.14, 0.62, 0.14, 'bone', { y: -0.3 }),
      box(0.22, 0.28, 0.24, 'iron', { y: -0.2, z: 0.02 }),
      box(0.12, 0.58, 0.12, 'bone', { y: -0.86 }),
      box(0.24, 0.12, 0.34, 'metal', { y: -1.18, z: 0.06 }, 0x5a5460),
    ]), mat, h);
  }
  const torso = pivot(root, 0, 1.25, 0);
  mesh(merge([
    box(0.6, 0.16, 0.34, 'metal', { y: 0.04 }, 0x5a4a3a),
    box(0.1, 0.8, 0.1, 'bone', { y: 0.46, z: -0.1 }),
    ...[0, 1, 2, 3].map(i => box(0.66 - i * 0.05, 0.07, 0.36, 'bone', { y: 0.34 + i * 0.13 })),
    taper(0.86, 0.36, 0.44, 1, 0.9, 'iron', { y: 0.86 }),
    box(0.3, 0.3, 0.05, 'iron', { y: 0.5, z: 0.2 }, 0xc8c0b8),
    ...[1, -1].flatMap(sx => [
      ico(0.2, 'iron', { x: sx * 0.46, y: 0.98, sy: 0.7 }),
      cone(0.06, 0.26, 5, 'bone', { x: sx * 0.52, y: 1.15, rz: -sx * 0.5 }),
    ]),
  ]), mat, torso);
  const head = pivot(torso, 0, 1.08, 0.04);
  mesh(merge([
    box(0.34, 0.32, 0.34, 'bone', { y: 0.16 }),
    box(0.3, 0.1, 0.3, 'bone', { y: -0.02, z: 0.04 }),
    box(0.09, 0.08, 0.02, 'metal', { x: 0.08, y: 0.17, z: 0.17 }, 0x101010),
    box(0.09, 0.08, 0.02, 'metal', { x: -0.08, y: 0.17, z: 0.17 }, 0x101010),
    octa(0.028, 'flame', { x: 0.08, y: 0.17, z: 0.19 }, 0x80ffff),
    octa(0.028, 'flame', { x: -0.08, y: 0.17, z: 0.19 }, 0x80ffff),
    cyl(0.22, 0.24, 0.14, 8, 'iron', { y: 0.36 }),
    cone(0.07, 0.3, 5, 'bone', { x: 0.22, y: 0.4, rz: -0.7 }),
    cone(0.07, 0.3, 5, 'bone', { x: -0.22, y: 0.4, rz: 0.7 }),
  ]), mat, head);
  const shL = pivot(torso, 0.5, 0.92, 0), shR = pivot(torso, -0.5, 0.92, 0);
  mesh(merge([box(0.13, 0.5, 0.13, 'bone', { y: -0.25 }), box(0.11, 0.48, 0.11, 'bone', { y: -0.72 }), box(0.18, 0.14, 0.18, 'metal', { y: -1.0 }, 0x5a4a3a)]), mat, shL);
  mesh(merge([box(0.13, 0.5, 0.13, 'bone', { y: -0.25 }), box(0.11, 0.48, 0.11, 'bone', { y: -0.72 }), box(0.18, 0.14, 0.18, 'metal', { y: -1.0 }, 0x5a4a3a)]), mat, shR);
  const club = new THREE.Mesh(itemModel(item('bonebreaker')), mat);
  club.scale.setScalar(1.7);
  club.position.set(0, -1.02, 0.05);
  club.rotation.set(Math.PI / 2, 0, 0);
  club.castShadow = true;
  shR.add(club);
  return {
    root,
    animate(c) {
      const sp = Math.min(1, Math.hypot(c.vx, c.vz) / 2);
      const ph = c.t * 4.5;
      hipL.rotation.x = Math.sin(ph) * 0.45 * sp;
      hipR.rotation.x = -Math.sin(ph) * 0.45 * sp;
      shL.rotation.x = -Math.sin(ph) * 0.3 * sp;
      torso.rotation.z = Math.sin(ph) * 0.05 * sp;
      // Overhead smash when it lands a hit, otherwise the club rests forward.
      const a = c.attack > 0 ? Math.sin((1 - c.attack / 0.6) * Math.PI) : 0;
      shR.rotation.x = -0.5 - a * 2.2 + Math.sin(ph) * 0.2 * sp;
      head.rotation.y = Math.sin(c.t * 0.7) * 0.25;
    },
  };
}

function mulTint(a: number, b: number) {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return ca.multiply(cb).getHex();
}

export function buildCreatureVisual(id: string, mat: THREE.Material, tint = 0xffffff, skin?: string): CreatureVisual {
  switch (id) {
    case 'glob': return glob(mat, tint, skin);
    case 'deep_glob': return glob(mat, 0x80a8ff);
    case 'shambler': return shambler(mat, tint);
    case 'gloomwisp': return gloomwisp(mat, tint);
    case 'duskwing': return duskwing(mat, tint);
    case 'rockmite': return rockmite(mat, tint);
    case 'hollow_miner': return hollowMiner(mat);
    case 'hollow_sapper': return hollowMiner(mat, true);
    case 'hollow_brute': return hollowBrute(mat);
    case 'gorehound': return gorehound(mat);
    default: return glob(mat, 0xff80ff);
  }
}
