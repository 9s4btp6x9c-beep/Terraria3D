// Renders all building pieces as one merged mesh (rebuilt when the structure
// set changes) plus a translucent placement ghost.

import * as THREE from 'three';
import { type BuildTexture, PIECES, type Part, type Piece, type PieceShape, type Structures } from '../building/structures';
import { mergeNonIndexed } from './sky';
import { layerOf } from './textures';
import { tagLayer } from './vegetationRenderer';

/** Geometry for one part in piece-local space. */
function partGeometry(part: Part): THREE.BufferGeometry {
  const [hx, hy, hz] = part.h;
  let g: THREE.BufferGeometry;
  if (part.wedge) {
    // Visual steps inside the collision ramp.
    const steps = 5, parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < steps; i++) {
      const h = ((i + 1) / steps) * hy * 2;
      const b = new THREE.BoxGeometry(hx * 2, h, (hz * 2) / steps);
      b.translate(0, -hy + h / 2, -hz + (i + 0.5) * (hz * 2) / steps);
      parts.push(b);
    }
    g = mergeNonIndexed(parts);
  } else if (part.slope !== undefined) {
    const shape = new THREE.Shape();
    shape.moveTo(-hx, -hy);
    shape.lineTo(hx, -hy);
    shape.lineTo(hx, -hy + hx * 2 * part.slope);
    shape.closePath();
    g = new THREE.ExtrudeGeometry(shape, { depth: hz * 2, bevelEnabled: false });
    g.translate(0, 0, -hz);
  } else {
    g = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
  }
  if (part.tilt) g.rotateX(part.tilt);
  g.translate(part.c[0], part.c[1], part.c[2]);
  return g.index ? g.toNonIndexed() : g;
}

/** Geometry for a piece in world space. */
export function pieceGeometry(p: Omit<Piece, 'id' | 'hp'>): THREE.BufferGeometry {
  const parts = PIECES[p.shape].parts(p).map(part => {
    const g = partGeometry(part);
    if (g.attributes.uv) g.deleteAttribute('uv');
    g.clearGroups();
    return tagLayer(g, layerOf(part.layer ?? p.texture));
  });
  const g = mergeNonIndexed(parts);
  g.rotateY(p.rot * Math.PI / 2);
  g.translate(p.x, p.y, p.z);
  g.computeVertexNormals();
  return g;
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
      const geo = mergeNonIndexed(pieces.map(p => pieceGeometry(p)));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.meshes.set(key, mesh);
      this.group.add(mesh);
    }
    this.structures.dirtyRegions.clear();
  }

  showGhost(shape: PieceShape | 'blob' | 'level' | null, pos: { x: number; y: number; z: number; rot: number; ext?: number } | null, valid: boolean, radius = 1, texture: BuildTexture = 'planks') {
    if (!shape || !pos) { this.ghost.visible = false; return; }
    this.ghost.geometry.dispose();
    this.ghost.geometry = shape === 'blob'
      ? new THREE.IcosahedronGeometry(radius, 1).translate(pos.x, pos.y, pos.z)
      : shape === 'level'
        ? new THREE.CylinderGeometry(radius, radius, 0.12, 20).translate(pos.x, pos.y + 0.06, pos.z)
        : pieceGeometry({ shape, texture, ...pos });
    this.ghostMat.color.setHex(valid ? 0x66ff88 : 0xff5544);
    this.ghost.visible = true;
  }
}
