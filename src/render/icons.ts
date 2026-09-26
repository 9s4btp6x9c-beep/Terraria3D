// Item icons rendered from the same 3D models used in the world (so icons,
// held items and placed objects always match), then given a crisp 1px dark
// pixel outline like hand-drawn sprites.

import * as THREE from 'three';
import { PIECES, SHAPES } from '../building/structures';
import { ITEMS, type ItemDef } from '../items/items';
import { itemModel } from './models';
import { pieceGeometry } from './structureRenderer';

const SIZE = 44;

export class IconAtlas {
  private urls = new Map<string, string>();

  constructor(renderer: THREE.WebGLRenderer, material: THREE.Material) {
    const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.UnsignedByteType });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const light = new THREE.DirectionalLight(0xffffff, 3.2);
    light.position.set(2, 3, 4);
    scene.add(light);
    const cam = new THREE.PerspectiveCamera(22, 1, 0.01, 100);
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);

    const jobs: { key: string; mesh: THREE.Mesh }[] = [];
    for (const def of ITEMS.values()) {
      const mesh = new THREE.Mesh(itemModel(def), material);
      // Long items (tools, weapons) are shown diagonally, like classic sprites.
      if (def.kind === 'tool' || (def.kind === 'weapon' && def.weapon?.type !== 'thrown') || def.model.type === 'arrow') mesh.rotation.z = -Math.PI / 4;
      else if (def.model.type === 'furniture') mesh.rotation.y = -0.5;
      else mesh.rotation.y = -0.6;
      jobs.push({ key: def.id, mesh });
    }
    // Building pieces for the build menu, turned to show their shape.
    for (const shape of SHAPES) {
      const geo = pieceGeometry({ shape, texture: 'planks', x: 0, y: 0, z: 0, rot: 0, ext: shape === 'foundation' ? 0.75 : 0 })!;
      // The icon material tints by vertex colour; pieces are untinted.
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
      const mesh = new THREE.Mesh(geo, material);
      mesh.rotation.y = PIECES[shape].slot === 'edge' ? -0.45 : PIECES[shape].category === 'roof' || shape === 'stairs' ? 2.4 : -0.6;
      jobs.push({ key: `piece:${shape}`, mesh });
    }
    for (const { key, mesh } of jobs) {
      scene.add(mesh);
      mesh.updateMatrixWorld();
      const bb = new THREE.Box3().setFromObject(mesh);
      const c = bb.getCenter(new THREE.Vector3());
      const r = bb.getSize(new THREE.Vector3()).length() / 2;
      const dir = new THREE.Vector3(0.35, 0.45, 1).normalize();
      cam.position.copy(c).addScaledVector(dir, r / Math.tan((cam.fov * Math.PI) / 360) * 1.02);
      cam.lookAt(c);
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
      scene.remove(mesh);
      this.urls.set(key, outline(pixels, ctx, canvas));
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    target.dispose();
  }

  url(id: string) { return this.urls.get(id) ?? ''; }

  /** <img> markup for a building piece. */
  piece(shape: string, cls = 'icon') {
    return `<img class="${cls}" src="${this.url(`piece:${shape}`)}" alt="" draggable="false">`;
  }

  /** <img> markup for an item icon. */
  img(def: ItemDef, cls = 'icon') {
    return `<img class="${cls}" src="${this.url(def.id)}" alt="" draggable="false">`;
  }
}

/** Flip (GL rows are bottom-up), then add a 1px outline around opaque pixels. */
function outline(px: Uint8Array, ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): string {
  const img = ctx.createImageData(SIZE, SIZE);
  const d = img.data;
  const a = (x: number, y: number) => (x < 0 || y < 0 || x >= SIZE || y >= SIZE ? 0 : px[((SIZE - 1 - y) * SIZE + x) * 4 + 3]);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const src = ((SIZE - 1 - y) * SIZE + x) * 4, dst = (y * SIZE + x) * 4;
      if (px[src + 3] > 40) {
        d[dst] = px[src]; d[dst + 1] = px[src + 1]; d[dst + 2] = px[src + 2]; d[dst + 3] = 255;
      } else if (a(x - 1, y) > 40 || a(x + 1, y) > 40 || a(x, y - 1) > 40 || a(x, y + 1) > 40) {
        d[dst] = 20; d[dst + 1] = 18; d[dst + 2] = 28; d[dst + 3] = 255;
      }
    }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}
