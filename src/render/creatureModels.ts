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

/**
 * Burrling: a hopping seed-pod covered in hooked burrs, with a sprout on top.
 * Variants swap the pod's surface (`skin`) and tint.
 */
function burrling(mat: THREE.Material, tint: number, skin = 'burr'): CreatureVisual {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  const spikes: THREE.BufferGeometry[] = [];
  // Burr spikes spread evenly over the upper pod (golden-angle spiral).
  for (let i = 0; i < 16; i++) {
    const y = 1 - (i + 0.5) / 16 * 1.3, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.4;
    const dx = Math.cos(a) * r, dz = Math.sin(a) * r;
    if (dz > 0.55 && y > -0.2 && y < 0.6) continue; // keep the face clear
    const g = new THREE.ConeGeometry(0.06, 0.24, 4).translate(0, 0.12, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, y * 0.78, dz).normalize()));
    g.translate(dx * 0.46, 0.4 + y * 0.36, dz * 0.46);
    spikes.push(g);
  }
  mesh(merge([
    ico(0.52, skin, { y: 0.4, sy: 0.78, detail: 1, jitter: 0.12, seed: 3 }, tint),
    ...spikes.map(g => partOf(g, skin, mulTint(0xd8d0b0, tint))),
    // Face: two glowing slit eyes and a seam of a mouth.
    box(0.13, 0.07, 0.04, 'flame', { x: 0.14, y: 0.5, z: 0.43, rz: -0.2 }, 0xfff0a0),
    box(0.13, 0.07, 0.04, 'flame', { x: -0.14, y: 0.5, z: 0.43, rz: 0.2 }, 0xfff0a0),
    box(0.22, 0.03, 0.04, 'plain', { y: 0.34, z: 0.46 }, 0x1a1410),
    // Sprout.
    cyl(0.025, 0.035, 0.22, 5, 'bark', { y: 0.82 }, 0x9ac468),
    taper(0.16, 0.02, 0.09, 0.4, 1, 'leaves', { x: 0.08, y: 0.94, rz: -0.6 }, 0xb8e070),
    taper(0.13, 0.02, 0.08, 0.4, 1, 'leaves', { x: -0.07, y: 0.92, rz: 0.7 }, 0xb8e070),
  ]), mat, body);
  let squash = 0;
  return {
    root,
    animate(c, dt) {
      const target = c.grounded ? (c.cooldown < 0.25 ? -0.25 : 0) : Math.max(-0.2, Math.min(0.35, c.vy * 0.04));
      squash += (target - squash) * Math.min(1, dt * 12);
      body.scale.set(1 - squash * 0.5, 1 + squash, 1 - squash * 0.5);
      body.rotation.y = Math.sin(c.t * 1.7) * 0.15;
    },
  };
}

/** Re-tag a prebuilt geometry's layer and tint (spikes built with lookAt). */
function partOf(g: THREE.BufferGeometry, layer: string, tint: number) {
  return parts.part(g, layer, tint);
}

/**
 * Rootwalker: a lurching figure of braided roots with a knotted head, ember
 * eyes and moss on its shoulders. `skin` swaps the bark (Sporebound).
 */
function rootwalker(mat: THREE.Material, tint = 0xffffff, spores = 'rootbark'): CreatureVisual {
  const root = new THREE.Group();
  // Sporebound: the same body gone pale and rotten, sprouting glowing caps.
  const skin = spores === 'spore' ? 'rootbark' : spores;
  const bark = mulTint(0xffffff, tint), moss = spores === 'spore' ? 0x7af0c8 : 0xb4c066;
  const eye = spores === 'spore' ? 0x7af0c8 : 0xff8a30;
  const hipL = pivot(root, 0.13, 0.95, 0), hipR = pivot(root, -0.13, 0.95, 0);
  for (const h of [hipL, hipR]) mesh(merge([
    taper(0.16, 0.92, 0.18, 0.7, 0.7, skin, { y: -0.46, rx: Math.PI }, bark),
    // Splayed root toes.
    ...[-0.5, 0, 0.5].map(a => cone(0.04, 0.26, 4, skin, { x: Math.sin(a) * 0.1, y: -0.9, z: 0.1 + Math.cos(a) * 0.04, rx: Math.PI / 2 + 0.3, rz: a }, bark)),
  ]), mat, h);
  const torso = pivot(root, 0, 0.95, 0);
  mesh(merge([
    // Braided trunk: three twisted strands.
    ...[0, 1, 2].map(k => taper(0.2, 0.7, 0.2, 1.2, 1.2, skin, { x: Math.cos(k * 2.1) * 0.09, y: 0.36, z: Math.sin(k * 2.1) * 0.07, ry: k * 0.7, rz: (k - 1) * 0.08 }, bark)),
    ico(0.14, 'mossleaves', { x: 0.24, y: 0.72, sy: 0.6, jitter: 0.3, seed: 12 }, moss),
    ico(0.12, 'mossleaves', { x: -0.22, y: 0.7, sy: 0.6, jitter: 0.3, seed: 13 }, moss),
  ]), mat, torso);
  const head = pivot(torso, 0, 0.74, 0.02);
  mesh(merge([
    ico(0.19, skin, { y: 0.16, sy: 1.15, jitter: 0.25, seed: 14 }, bark),
    octa(0.045, 'flame', { x: 0.07, y: 0.19, z: 0.16 }, eye),
    octa(0.045, 'flame', { x: -0.07, y: 0.19, z: 0.16 }, eye),
    // Twig antlers.
    cone(0.025, 0.3, 4, skin, { x: 0.1, y: 0.4, rz: -0.5 }, bark),
    cone(0.025, 0.26, 4, skin, { x: -0.1, y: 0.38, rz: 0.6 }, bark),
    ...(spores === 'spore' ? [ico(0.1, 'spore', { x: 0.06, y: 0.34, sy: 0.45 }), ico(0.07, 'spore', { x: -0.1, y: 0.28, z: 0.06, sy: 0.45 })] : []),
  ]), mat, head);
  const shL = pivot(torso, 0.26, 0.64, 0), shR = pivot(torso, -0.26, 0.64, 0);
  for (const sh of [shL, shR]) mesh(merge([
    taper(0.11, 0.7, 0.11, 0.6, 0.6, skin, { y: -0.35, rx: Math.PI }, bark),
    ...[-0.3, 0, 0.3].map(a => cone(0.025, 0.2, 4, skin, { x: Math.sin(a) * 0.05, y: -0.74, z: Math.cos(a) * 0.03, rx: Math.PI, rz: a }, bark)),
  ]), mat, sh);
  return {
    root,
    animate(c) {
      const sp = Math.min(1, Math.hypot(c.vx, c.vz) / 2);
      const ph = c.t * 5;
      hipL.rotation.x = Math.sin(ph) * 0.55 * sp;
      hipR.rotation.x = -Math.sin(ph) * 0.55 * sp;
      // Long arms swing low and reach forward when it lunges.
      const reach = c.attack > 0 ? 1.3 : 0.35;
      shL.rotation.x = -reach - Math.sin(ph) * 0.35 * sp;
      shR.rotation.x = -reach + Math.sin(ph) * 0.35 * sp;
      shL.rotation.z = 0.12; shR.rotation.z = -0.12;
      torso.rotation.x = 0.18 + Math.sin(ph * 2) * 0.03 * sp;
      torso.rotation.z = Math.sin(ph) * 0.08 * sp;
      head.rotation.z = Math.sin(c.t * 1.1) * 0.25;
    },
  };
}

/**
 * Drifter: a sky-jellyfish — a translucent bell with a glowing core, trailing
 * slow, rippling tendrils. It hunts by night, drifting down onto prey.
 */
function drifter(mat: THREE.Material, tint = 0xffffff, skin = 'jelly'): CreatureVisual {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0.75, 0);
  const bellG = new THREE.SphereGeometry(0.46, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
  bellG.scale(1, 0.72, 1);
  const core = skin === 'spore' ? 0x7af0c8 : 0xffe8a0;
  mesh(merge([
    parts.part(bellG, skin, tint),
    cyl(0.46, 0.34, 0.08, 9, skin, { y: -0.02 }, mulTint(0xc8c0ff, tint)),
    ico(0.16, 'flame', { y: 0.14, detail: 1 }, core),
    ico(0.05, 'plain', { x: 0.16, y: 0.2, z: 0.3 }, 0x101018),
    ico(0.05, 'plain', { x: -0.16, y: 0.2, z: 0.3 }, 0x101018),
    ...[0, 1, 2, 3, 4, 5].map(k => ico(0.04, 'flame', { x: Math.cos(k) * 0.4, y: 0.02, z: Math.sin(k) * 0.4 }, core)),
  ]), mat, body);
  const tendrils: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const p = pivot(body, Math.cos(a) * 0.24, -0.04, Math.sin(a) * 0.24);
    const upper = pivot(p, 0, 0, 0);
    mesh(merge([taper(0.07, 0.42, 0.07, 0.5, 0.5, skin, { y: -0.21, rx: Math.PI }, mulTint(0xe0d8ff, tint))]), mat, upper);
    const lower = pivot(upper, 0, -0.42, 0);
    mesh(merge([taper(0.04, 0.38, 0.04, 0.3, 0.3, skin, { y: -0.19, rx: Math.PI }, mulTint(0xf0e8ff, tint))]), mat, lower);
    tendrils.push(upper, lower);
  }
  return {
    root,
    animate(c) {
      // The bell pulses to swim; tendrils trail and ripple behind the beat.
      const pulse = Math.sin(c.t * 3.2);
      body.scale.set(1 + pulse * 0.07, 1 - pulse * 0.08, 1 + pulse * 0.07);
      body.position.y = 0.75 + Math.sin(c.t * 3.2 - 0.6) * 0.07;
      tendrils.forEach((t, i) => {
        const k = Math.floor(i / 2), low = i % 2;
        t.rotation.x = Math.sin(c.t * 2.4 + k + low * 0.9) * (0.2 + low * 0.25) - c.vz * 0.02;
        t.rotation.z = Math.cos(c.t * 2 + k * 1.7 + low) * (0.15 + low * 0.2);
      });
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

/** Sporeling: a waddling mushroom with a glowing cap and stubby legs. */
function sporeling(mat: THREE.Material): CreatureVisual {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0.28, 0);
  mesh(merge([
    taper(0.34, 0.42, 0.3, 0.8, 0.8, 'mushstem', { y: 0.2 }),
    box(0.06, 0.07, 0.02, 'plain', { x: 0.08, y: 0.3, z: 0.14 }, 0x101820),
    box(0.06, 0.07, 0.02, 'plain', { x: -0.08, y: 0.3, z: 0.14 }, 0x101820),
    box(0.1, 0.03, 0.02, 'plain', { y: 0.2, z: 0.14 }, 0x5a4a44),
  ]), mat, body);
  const cap = pivot(body, 0, 0.45, 0);
  mesh(merge([
    parts.merge([ico(0.36, 'glowcap', { y: 0.06, sy: 0.5, detail: 1, jitter: 0.08, seed: 51 })]),
    cyl(0.33, 0.14, 0.06, 8, 'mushstem', { y: 0.02 }, 0x9ab8d0),
    ico(0.04, 'plain', { x: 0.14, y: 0.2, z: 0.1 }, 0xe0fcff),
    ico(0.035, 'plain', { x: -0.16, y: 0.17, z: -0.06 }, 0xe0fcff),
    ico(0.03, 'plain', { x: 0.02, y: 0.23, z: -0.14 }, 0xe0fcff),
  ]), mat, cap);
  const legs = [0.1, -0.1].map(x => {
    const p = pivot(body, x, 0.02, 0);
    mesh(merge([box(0.1, 0.24, 0.12, 'mushstem', { y: -0.12 }), box(0.12, 0.05, 0.16, 'mushstem', { y: -0.25, z: 0.02 }, 0xb8ae9a)]), mat, p);
    return p;
  });
  const arms = [0.19, -0.19].map(x => {
    const p = pivot(body, x, 0.3, 0);
    mesh(merge([box(0.07, 0.2, 0.07, 'mushstem', { y: -0.1 })]), mat, p);
    return p;
  });
  return {
    root,
    animate(c) {
      const sp = Math.min(1, Math.hypot(c.vx, c.vz) / 2);
      const ph = c.t * 9;
      legs[0].rotation.x = Math.sin(ph) * 0.6 * sp;
      legs[1].rotation.x = -Math.sin(ph) * 0.6 * sp;
      arms[0].rotation.x = -Math.sin(ph) * 0.5 * sp;
      arms[1].rotation.x = Math.sin(ph) * 0.5 * sp;
      body.rotation.z = Math.sin(ph) * 0.12 * sp;
      cap.rotation.z = Math.sin(ph + 0.6) * 0.1 * sp;
      cap.position.y = 0.45 + Math.abs(Math.sin(ph)) * 0.03 * sp;
    },
  };
}

/** Glowmoth: a fuzzy moth with broad luminous wings. */
function glowmoth(mat: THREE.Material, skin = 'glowcap'): CreatureVisual {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0.5, 0);
  const leaf = skin !== 'glowcap', fur = leaf ? 0x8a5a3a : 0xd8d0e8, eye = leaf ? 0xffd060 : 0x9af0ff;
  mesh(merge([
    ico(0.13, 'fur', { sz: 1.9, detail: 1 }, fur),
    ico(0.1, 'fur', { z: 0.22 }, leaf ? 0xa06a40 : 0xe8e4f4),
    octa(0.03, 'flame', { x: 0.05, y: 0.04, z: 0.3 }, eye),
    octa(0.03, 'flame', { x: -0.05, y: 0.04, z: 0.3 }, eye),
    box(0.012, 0.2, 0.012, 'fur', { x: 0.05, y: 0.13, z: 0.34, rx: 0.6, rz: -0.3 }, 0x8a82a0),
    box(0.012, 0.2, 0.012, 'fur', { x: -0.05, y: 0.13, z: 0.34, rx: 0.6, rz: 0.3 }, 0x8a82a0),
  ]), mat, body);
  const wing = (side: number) => {
    const p = pivot(body, side * 0.08, 0.04, 0.05);
    mesh(merge([
      taper(0.5, 0.02, 0.42, 0.6, 1.2, skin, { x: side * 0.26, z: 0.06, rz: side * Math.PI / 2 }),
      taper(0.36, 0.02, 0.3, 0.5, 1.1, skin, { x: side * 0.2, z: -0.26, rz: side * Math.PI / 2, ry: side * 0.3 }, leaf ? 0xe0a060 : 0x9ad8ff),
      ico(0.05, 'plain', { x: side * 0.3, y: 0.02, z: 0.08 }, leaf ? 0x5a2a14 : 0xffffff),
    ]), mat, p);
    return p;
  };
  const wl = wing(1), wr = wing(-1);
  return {
    root,
    animate(c) {
      const f = Math.sin(c.t * 16) * 0.8;
      wl.rotation.z = f; wr.rotation.z = -f;
      body.position.y = 0.5 + Math.sin(c.t * 4) * 0.1;
    },
  };
}

/** Gale Swift: a sleek storm-blue bird with swept wings and a forked tail. */
function galeSwift(mat: THREE.Material, skin?: string): CreatureVisual {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0.45, 0);
  // Bonepicker: a bald, bone-pale carrion bird of the salt flats.
  const bony = skin === 'bone';
  const back = bony ? 0x8a7a68 : 0x6a84b8, belly = bony ? 0xe6dcc0 : 0xf4f6fa;
  mesh(merge([
    ico(0.22, 'feather', { sx: 0.9, sy: 0.8, sz: 1.7, detail: 1 }, back),
    ico(0.17, 'feather', { y: -0.06, z: 0.05, sx: 0.85, sy: 0.7, sz: 1.5 }, belly),
    ico(0.15, bony ? 'bone' : 'feather', { y: 0.08, z: 0.36, sy: 0.9 }, bony ? 0xf0e4c8 : back),
    cone(0.05, 0.16, 4, 'gold', { y: 0.06, z: 0.54, rx: Math.PI / 2 }),
    octa(0.028, 'flame', { x: 0.08, y: 0.12, z: 0.44 }, bony ? 0xff5a3a : 0xffe060),
    octa(0.028, 'flame', { x: -0.08, y: 0.12, z: 0.44 }, bony ? 0xff5a3a : 0xffe060),
    taper(0.05, 0.22, 0.03, 0.4, 1, 'feather', { y: 0.2, z: 0.3, rx: -0.9 }, back),
    // Forked tail.
    taper(0.08, 0.4, 0.02, 0.3, 1, 'feather', { x: 0.07, y: 0.02, z: -0.5, rx: -Math.PI / 2 + 0.15, rz: 0.25 }, back),
    taper(0.08, 0.4, 0.02, 0.3, 1, 'feather', { x: -0.07, y: 0.02, z: -0.5, rx: -Math.PI / 2 + 0.15, rz: -0.25 }, back),
  ]), mat, body);
  const wing = (side: number) => {
    const shoulder = pivot(body, side * 0.16, 0.06, 0.05);
    mesh(merge([
      taper(0.46, 0.03, 0.34, 1, 0.7, 'feather', { x: side * 0.23 }, back),
      taper(0.46, 0.02, 0.12, 1, 0.8, 'feather', { x: side * 0.23, y: -0.02, z: -0.2 }, belly),
    ]), mat, shoulder);
    const elbow = pivot(shoulder, side * 0.46, 0, 0);
    mesh(merge([
      taper(0.5, 0.025, 0.26, 1, 0.3, 'feather', { x: side * 0.25, z: -0.04, ry: side * 0.25 }, back),
      ...[0, 1, 2].map(i => taper(0.06, 0.02, 0.32, 0.3, 1, 'feather', { x: side * (0.35 + i * 0.07), z: -0.18 - i * 0.03, ry: side * (0.4 + i * 0.15) }, bony ? 0x5a4a3e : 0x4a5a88)),
    ]), mat, elbow);
    return { shoulder, elbow };
  };
  const wl = wing(1), wr = wing(-1);
  return {
    root,
    animate(c) {
      const climb = Math.max(-1, Math.min(1, c.vy / 6));
      // Powerful beats when climbing, long glides when diving.
      const beat = Math.sin(c.t * (climb > 0 ? 14 : 8)) * (0.35 + Math.max(0, climb) * 0.5);
      const glide = climb < -0.3 ? 0.3 : 0;
      wl.shoulder.rotation.z = beat + glide; wr.shoulder.rotation.z = -beat - glide;
      wl.elbow.rotation.z = beat * 0.6; wr.elbow.rotation.z = -beat * 0.6;
      body.rotation.x = -climb * 0.35;
      body.rotation.z = Math.sin(c.t * 2 + c.uid) * 0.15;
    },
  };
}

/** Rotfang: a lean, rotting hound with bared ribs, a split jaw and fungus sprouting along its spine. */
function rotfang(mat: THREE.Material): CreatureVisual {
  const outer = new THREE.Group();
  const root = pivot(outer, 0, 0, 0);
  root.scale.setScalar(1.18);
  const body = pivot(root, 0, 0.62, 0);
  mesh(merge([
    taper(0.42, 0.4, 0.95, 0.85, 0.8, 'rotfur', { z: -0.05 }),
    ico(0.26, 'rotfur', { z: 0.36, y: 0.04, sx: 1.1, sy: 0.95, jitter: 0.12, seed: 21 }),
    ...[0, 1, 2, 3].map(i => box(0.46, 0.04, 0.05, 'bone', { y: -0.06 + i * 0.015, z: 0.18 - i * 0.14, rx: 0.1 })),
    box(0.06, 0.05, 0.9, 'bone', { y: 0.21, z: -0.05 }),
    ...[0, 1, 2, 3, 4].map(i => cone(0.035, 0.14, 4, 'bone', { y: 0.26, z: 0.3 - i * 0.16, rx: -0.4 })),
    // Glowing caps sprouting from the spine.
    ...[[0.08, 0.3, 0.16, 0.12], [-0.09, 0.28, -0.02, 0.1], [0.06, 0.27, -0.24, 0.13], [-0.05, 0.29, 0.3, 0.08]].flatMap(([x, y, z, r]) => [
      cyl(0.025, 0.03, r * 0.9, 5, 'mushstem', { x, y: y + r * 0.3, z }),
      ico(r, 'spore', { x, y: y + r * 0.8, z, sy: 0.45 }),
    ]),
  ]), mat, body);
  // Head with an upper skull and a hinged lower jaw.
  const neck = pivot(body, 0, 0.12, 0.5);
  mesh(merge([
    box(0.3, 0.2, 0.36, 'rotfur', { y: 0.02, z: 0.14 }),
    taper(0.22, 0.12, 0.26, 0.8, 0.8, 'rotfur', { y: 0.0, z: 0.4, rx: Math.PI / 2 }),
    cone(0.05, 0.16, 4, 'rotfur', { x: 0.1, y: 0.16, z: 0.02, rx: -0.4 }),
    cone(0.05, 0.16, 4, 'rotfur', { x: -0.1, y: 0.16, z: 0.02, rx: -0.4 }),
    octa(0.035, 'flame', { x: 0.1, y: 0.08, z: 0.3 }, 0x7af0c8),
    octa(0.035, 'flame', { x: -0.1, y: 0.08, z: 0.3 }, 0x7af0c8),
    ...[-0.07, -0.025, 0.025, 0.07].map(x => cone(0.018, 0.08, 3, 'bone', { x, y: -0.09, z: 0.46, rx: Math.PI }, 0xfff8e8)),
  ]), mat, neck);
  const jaw = pivot(neck, 0, -0.08, 0.16);
  mesh(merge([
    box(0.2, 0.06, 0.34, 'rotfur', { z: 0.16 }),
    ...[-0.06, 0, 0.06].map(x => cone(0.016, 0.07, 3, 'bone', { x, y: 0.05, z: 0.28 }, 0xfff8e8)),
  ]), mat, jaw);
  const legs: THREE.Group[] = [];
  for (const [x, z] of [[0.16, 0.3], [-0.16, 0.3], [0.15, -0.38], [-0.15, -0.38]]) {
    const p = pivot(body, x, -0.1, z);
    mesh(merge([
      box(0.1, 0.32, 0.12, 'rotfur', { y: -0.14 }),
      box(0.07, 0.26, 0.07, 'bone', { y: -0.38, z: z > 0 ? 0.02 : -0.04 }),
      box(0.1, 0.05, 0.14, 'rotfur', { y: -0.5, z: 0.03 }),
    ]), mat, p);
    legs.push(p);
  }
  const tail = pivot(body, 0, 0.14, -0.5);
  mesh(merge([taper(0.07, 0.5, 0.07, 0.3, 0.3, 'rotfur', { y: 0.25 })]), mat, tail).rotation.x = -2.2;
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

/** Mossback: a slow, armoured crawler carrying a mossy boulder of a shell with a sapling on top. */
function mossback(mat: THREE.Material): CreatureVisual {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0.42, 0);
  mesh(merge([
    ico(0.6, 'mossleaves', { y: 0.2, sx: 1, sy: 0.62, sz: 1.2, detail: 1, jitter: 0.18, seed: 31 }),
    cyl(0.6, 0.66, 0.12, 9, 'rootbark', { y: -0.02, rx: 0 }, 0x8a7058),
    ico(0.2, 'stone', { x: 0.28, y: 0.42, z: -0.2, jitter: 0.4, seed: 32 }),
    cyl(0.03, 0.045, 0.34, 5, 'rootbark', { x: -0.1, y: 0.68, z: -0.1 }),
    ico(0.16, 'mossleaves', { x: -0.1, y: 0.9, z: -0.1, sy: 0.7, jitter: 0.3, seed: 33 }, 0xc8d070),
    // Head: a blunt, beaked stone snout.
    box(0.34, 0.26, 0.34, 'chitin', { y: 0.02, z: 0.78 }, 0x8a9a6a),
    cone(0.12, 0.18, 4, 'bone', { y: -0.04, z: 1.0, rx: Math.PI / 2 }, 0xd8d0b0),
    octa(0.04, 'flame', { x: 0.12, y: 0.1, z: 0.94 }, 0xffe060),
    octa(0.04, 'flame', { x: -0.12, y: 0.1, z: 0.94 }, 0xffe060),
  ]), mat, body);
  const legs: THREE.Group[] = [];
  for (const [x, z] of [[0.46, 0.4], [-0.46, 0.4], [0.46, -0.4], [-0.46, -0.4]]) {
    const p = pivot(body, x, -0.08, z);
    mesh(merge([box(0.22, 0.34, 0.24, 'chitin', { y: -0.17 }, 0x6a7a52), box(0.26, 0.08, 0.3, 'chitin', { y: -0.34, z: 0.03 }, 0x5a6a44)]), mat, p);
    legs.push(p);
  }
  return {
    root,
    animate(c) {
      const sp = Math.min(1, Math.hypot(c.vx, c.vz) / 1.5);
      const ph = c.t * 6;
      legs.forEach((l, i) => { l.rotation.x = Math.sin(ph + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.45 * sp; });
      body.rotation.z = Math.sin(ph) * 0.05 * sp;
      body.position.y = 0.42 + Math.abs(Math.sin(ph)) * 0.03 * sp;
    },
  };
}

function mulTint(a: number, b: number) {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return ca.multiply(cb).getHex();
}

export function buildCreatureVisual(id: string, mat: THREE.Material, tint = 0xffffff, skin?: string): CreatureVisual {
  switch (id) {
    case 'burrling': return burrling(mat, tint, skin);
    case 'rootwalker': return rootwalker(mat, tint, skin);
    case 'drifter': return drifter(mat, tint, skin);
    case 'duskwing': return duskwing(mat, tint);
    case 'rockmite': return rockmite(mat, tint);
    case 'hollow_miner': return hollowMiner(mat);
    case 'hollow_sapper': return hollowMiner(mat, true);
    case 'hollow_brute': return hollowBrute(mat);
    case 'rotfang': return rotfang(mat);
    case 'gale_swift': return galeSwift(mat, skin);
    case 'sporeling': return sporeling(mat);
    case 'glowmoth': return glowmoth(mat, skin);
    case 'mossback': return mossback(mat);
    default: return burrling(mat, tint, skin);
  }
}
