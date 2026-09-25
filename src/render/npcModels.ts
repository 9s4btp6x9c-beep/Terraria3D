// Townsfolk models: chunky low-poly humans (textured clothes, hair, optional
// hat and beard) with a simple walk/idle animation.

import * as THREE from 'three';
import type { Npc } from '../entities/npcs';
import { parts } from './models';

const { box, merge } = parts;

export interface NpcVisual { root: THREE.Group; animate(n: Npc, dt: number): void }

export function buildNpcVisual(n: Npc, mat: THREE.Material): NpcVisual {
  const c = n.def.colors;
  const skin = 0xe0aa84;
  const root = new THREE.Group();
  const add = (g: THREE.BufferGeometry, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const pivot = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  const hipL = pivot(root, 0.11, 0.86, 0), hipR = pivot(root, -0.11, 0.86, 0);
  for (const h of [hipL, hipR]) add(merge([box(0.17, 0.8, 0.2, 'fabric', { y: -0.4 }, c.pants), box(0.19, 0.1, 0.27, 'plain', { y: -0.81, z: 0.04 }, 0x3a2a1e)]), h);
  const torso = pivot(root, 0, 0.86, 0);
  add(merge([
    box(0.46, 0.62, 0.26, 'fabric', { y: 0.31 }, c.shirt),
    box(0.48, 0.08, 0.28, 'plain', { y: 0.03 }, 0x4a3020),
    box(0.06, 0.08, 0.02, 'gold', { y: 0.03, z: 0.15 }),
  ]), torso);
  const head = pivot(torso, 0, 0.64, 0);
  const headParts = [
    box(0.32, 0.32, 0.3, 'plain', { y: 0.16 }, skin),
    box(0.06, 0.06, 0.02, 'plain', { x: 0.07, y: 0.19, z: 0.155 }, 0x1a1a24),
    box(0.06, 0.06, 0.02, 'plain', { x: -0.07, y: 0.19, z: 0.155 }, 0x1a1a24),
    box(0.1, 0.03, 0.02, 'plain', { y: 0.08, z: 0.155 }, 0x9a5a4a),
    box(0.34, 0.1, 0.32, 'fur', { y: 0.34 }, c.hair),
    box(0.34, 0.18, 0.08, 'fur', { y: 0.24, z: -0.13 }, c.hair),
  ];
  if (c.hat) headParts.push(box(0.46, 0.04, 0.44, 'fabric', { y: 0.38 }, c.hat), box(0.3, 0.2, 0.3, 'fabric', { y: 0.49 }, c.hat), box(0.31, 0.04, 0.31, 'gold', { y: 0.42 }));
  if (n.def.id === 'merchant') headParts.push(box(0.26, 0.16, 0.06, 'fur', { y: 0.02, z: 0.16 }, c.hair));
  add(merge(headParts), head);
  const shL = pivot(torso, 0.3, 0.56, 0), shR = pivot(torso, -0.3, 0.56, 0);
  for (const s of [shL, shR]) add(merge([box(0.13, 0.5, 0.15, 'fabric', { y: -0.25 }, c.shirt), box(0.11, 0.12, 0.12, 'plain', { y: -0.56 }, skin)]), s);
  return {
    root,
    animate(npc) {
      const b = npc.body;
      const sp = Math.min(1, Math.hypot(b.vx, b.vz) / 1.4);
      const ph = b.t * 7;
      hipL.rotation.x = Math.sin(ph) * 0.5 * sp;
      hipR.rotation.x = -Math.sin(ph) * 0.5 * sp;
      shL.rotation.x = -Math.sin(ph) * 0.45 * sp;
      shR.rotation.x = Math.sin(ph) * 0.45 * sp + (npc.talking ? -0.6 + Math.sin(b.t * 5) * 0.3 : 0);
      head.rotation.y = npc.talking ? 0 : Math.sin(b.t * 0.7) * 0.25;
      torso.position.y = 0.86 + Math.sin(b.t * 2) * 0.01;
    },
  };
}
