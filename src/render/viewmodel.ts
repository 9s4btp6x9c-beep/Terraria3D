// First-person held item: the item's own 3D model in a low-poly hand, with
// snappy per-type animations (tool/sword swing, bow draw, place bob, drink).

import * as THREE from 'three';
import { type ItemDef, item } from '../items/items';
import { itemModel, part } from './models';
import { mergeNonIndexed } from './sky';

type Pose = 'swing' | 'bow' | 'hold' | 'staff';

function poseFor(def: ItemDef): Pose {
  if (def.kind === 'tool') return 'swing';
  if (def.weapon?.type === 'melee') return 'swing';
  if (def.weapon?.type === 'bow') return 'bow';
  if (def.weapon?.type === 'magic') return 'staff';
  return 'hold';
}

function armGeometry() {
  const sleeve = part(new THREE.BoxGeometry(0.085, 0.085, 0.42).translate(0, 0, 0.23), 'fabric', 0x46548a);
  const cuff = part(new THREE.BoxGeometry(0.095, 0.095, 0.04).translate(0, 0, 0.03), 'fabric', 0xb89a5a);
  const hand = part(new THREE.BoxGeometry(0.075, 0.07, 0.085).translate(0, 0, -0.035), 'plain', 0xd8a07a);
  const thumb = part(new THREE.BoxGeometry(0.028, 0.03, 0.05).translate(-0.042, 0.022, -0.04), 'plain', 0xc88c6a);
  return mergeNonIndexed([sleeve, cuff, hand, thumb]);
}

export class Viewmodel {
  readonly root = new THREE.Group();
  private pivot = new THREE.Group();
  private itemMesh: THREE.Mesh;
  private arm: THREE.Mesh;
  private currentId: string | null = null;
  private pose: Pose = 'hold';
  private swing = 0;
  private swingDur = 0.3;
  private draw = 0;
  private bob = 0;
  private equipT = 1;
  private tool = false;

  /**
   * @param material   dedicated object-space world material (depth test is disabled
   *                   so the held item never clips into walls)
   * @param visibility the material's sky-visibility override, driven per frame
   */
  constructor(camera: THREE.Camera, material: THREE.Material, private visibility: { value: number }) {
    material.depthTest = false;
    // Drawn in the transparent pass (after water) so nothing washes over it.
    material.transparent = true;
    material.depthWrite = true; // still write depth so the outline pass sees it
    this.itemMesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.arm = new THREE.Mesh(armGeometry(), material);
    for (const m of [this.itemMesh, this.arm]) {
      m.renderOrder = 1000;
      m.frustumCulled = false;
    }
    this.root.add(this.pivot);
    this.pivot.add(this.itemMesh);
    this.root.add(this.arm);
    this.root.position.set(0.34, -0.3, -0.52);
    camera.add(this.root);
  }

  setItem(id: string | null) {
    if (id === this.currentId) return;
    this.currentId = id;
    this.equipT = 0;
    if (!id) {
      this.itemMesh.visible = false;
      this.pose = 'hold';
      return;
    }
    const def = item(id);
    this.pose = poseFor(def);
    this.itemMesh.geometry = itemModel(def);
    this.itemMesh.visible = true;
    // Normalise the size of held blocks/furniture.
    const bs = this.itemMesh.geometry.boundingSphere!;
    // Held blocks/furniture are normalised; long tools/weapons are shrunk so
    // they read like a hand-held item rather than filling the screen.
    const scale = this.pose === 'hold' ? Math.min(1.1, 0.16 / bs.radius) : Math.min(0.5, 0.25 / bs.radius);
    this.itemMesh.scale.setScalar(scale);
    this.itemMesh.position.set(0, 0, 0);
    this.itemMesh.rotation.set(0, 0, 0);
    // Picks and axes are modelled with the head across x; turn them so the
    // head points away from the player and the swing strikes forward.
    this.tool = def.kind === 'tool';
    if (this.tool) this.itemMesh.rotation.set(0, Math.PI / 2, 0);
    if (this.pose === 'hold') this.itemMesh.position.set(-bs.center.x * scale, -bs.center.y * scale + 0.02, -bs.center.z * scale);
    if (this.pose === 'bow') this.itemMesh.rotation.set(0, Math.PI / 2, 0);
  }

  /** Trigger a use animation lasting `duration` seconds. */
  triggerSwing(duration = 0.3) {
    this.swing = 1;
    this.swingDur = Math.max(0.12, duration);
  }

  /** Bow draw amount 0..1 (while charging). */
  setDraw(v: number) { this.draw = v; }

  update(dt: number, moving: number, brightness: number) {
    this.visibility.value = brightness;
    this.swing = Math.max(0, this.swing - dt / this.swingDur);
    this.equipT = Math.min(1, this.equipT + dt * 5);
    this.bob += dt * moving * 9;
    const s = this.swing > 0 ? Math.sin((1 - this.swing) * Math.PI) : 0;
    const k = 1 - this.swing; // 0 -> 1 through the swing
    const bobX = Math.sin(this.bob) * 0.012 * moving, bobY = Math.abs(Math.cos(this.bob)) * 0.016 * moving;
    const drop = (1 - this.equipT) * 0.35;

    const p = this.pivot;
    switch (this.pose) {
      case 'swing': {
        // Wind up (raise and pull back), then strike down and forward.
        const a = this.swing > 0 ? (k < 0.3 ? -k * 1.6 : -0.48 + (k - 0.3) * 2.2) : 0;
        if (this.tool) {
          // Picks and axes: held upright in profile, head forward.
          p.position.set(bobX + 0.03, bobY - drop - 0.04 - s * 0.05, -s * 0.06);
          p.rotation.set(-0.12 - a * 1.5, 1.0, 0.18);
        } else {
          // Blades: flat of the blade toward the player, a diagonal slash.
          p.position.set(bobX + 0.02, bobY - drop - 0.04 - s * 0.04, -s * 0.05);
          p.rotation.set(-0.05 - a * 1.1, 0.3 - s * 0.3, 0.2 + s * 0.7);
        }
        break;
      }
      case 'bow':
        p.position.set(-0.12 + bobX, 0.02 + bobY - drop, -0.05 + this.draw * 0.06);
        p.rotation.set(0, 0.1, -0.15);
        break;
      case 'staff':
        p.position.set(bobX, bobY - drop - 0.05 + s * 0.04, -s * 0.12);
        p.rotation.set(-0.35 - s * 0.5, 0.2, 0.25);
        break;
      default:
        p.position.set(bobX, bobY - drop - s * 0.1, -s * 0.15);
        p.rotation.set(-0.3 + s * 0.5, 0.5 + Math.sin(this.bob * 0.5) * 0.05, 0.1);
    }
    // The arm follows the grip.
    this.arm.position.set(p.position.x + 0.02, p.position.y - 0.02, p.position.z + 0.02);
    this.arm.rotation.set(0.25 + p.rotation.x * 0.3, 0.35, 0);
  }
}
