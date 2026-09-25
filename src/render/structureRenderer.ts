// Renders all building pieces as one merged mesh (rebuilt when the structure
// set changes) plus a translucent placement ghost.

import * as THREE from 'three';
import { PIECES, type Piece, type Structures } from '../building/structures';
import type { PieceShape } from '../items/items';
import { mergeNonIndexed } from './sky';
import { layerOf } from './textures';
import { tagLayer } from './vegetationRenderer';

/** Geometry for a piece in world space. */
export function pieceGeometry(shape: PieceShape, texture: 'planks' | 'bricks', x: number, y: number, z: number, rot: number): THREE.BufferGeometry {
  const def = PIECES[shape];
  const [hx, hy, hz] = def.half;
  const parts: THREE.BufferGeometry[] = [];
  if (def.wedge) {
    // Visual steps inside the collision ramp.
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const h = ((i + 1) / steps) * hy * 2;
      const g = new THREE.BoxGeometry(hx * 2, h, (hz * 2) / steps);
      g.translate(0, -hy + h / 2, -hz + (i + 0.5) * (hz * 2) / steps);
      parts.push(g);
    }
  } else {
    parts.push(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2));
  }
  const g = mergeNonIndexed(parts);
  if (def.tilt) g.rotateX(def.tilt);
  g.rotateY(rot * Math.PI / 2);
  g.translate(x, y + def.lift, z);
  return tagLayer(g, layerOf(texture));
}

export class StructureRenderer {
  readonly group = new THREE.Group();
  /** One merged mesh per 32 m region; only edited regions are rebuilt. */
  private meshes = new Map<number, THREE.Mesh>();
  readonly ghost: THREE.Mesh;
  private ghostMat: THREE.MeshBasicMaterial;

  constructor(private structures: Structures, private material: THREE.Material) {
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.35, depthWrite: false });
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMat);
    this.ghost.visible = false;
    this.group.add(this.ghost);
  }

  update() {
    if (this.structures.dirtyRegions.size === 0) return;
    for (const key of this.structures.dirtyRegions) {
      const old = this.meshes.get(key);
      if (old) { this.group.remove(old); old.geometry.dispose(); this.meshes.delete(key); }
      const pieces: Piece[] = this.structures.inRegion(key);
      if (pieces.length === 0) continue;
      const geo = mergeNonIndexed(pieces.map(p => pieceGeometry(p.shape, p.texture, p.x, p.y, p.z, p.rot)));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.meshes.set(key, mesh);
      this.group.add(mesh);
    }
    this.structures.dirtyRegions.clear();
  }

  showGhost(shape: PieceShape | 'blob' | null, pos: { x: number; y: number; z: number; rot: number } | null, valid: boolean, radius = 1) {
    if (!shape || !pos) { this.ghost.visible = false; return; }
    this.ghost.geometry.dispose();
    this.ghost.geometry = shape === 'blob'
      ? new THREE.IcosahedronGeometry(radius, 1).translate(pos.x, pos.y, pos.z)
      : pieceGeometry(shape, 'planks', pos.x, pos.y, pos.z, pos.rot);
    this.ghostMat.color.setHex(valid ? 0x66ff88 : 0xff5544);
    this.ghost.visible = true;
  }
}
