// First-person held item: the item's own 3D model gripped in a blocky arm
// that hangs from a shoulder just off the bottom-right of the screen. Swings
// turn the whole arm at the shoulder (not just the wrist), so a pick or sword
// is driven away from the player the way a real swing would be.
//
// The arm and item live on their own render layer: the world is drawn first,
// then the depth buffer is cleared and the held item is drawn over it with
// normal depth testing (see PostFX), so it never clips into walls, is never
// crossed by world outlines, and its own faces sort correctly.

import * as THREE from 'three';
import { type ItemDef, item } from '../items/items';
import { itemModel, part } from './models';
import { mergeNonIndexed } from './sky';

/** Render layer for the first-person overlay. */
export const VIEWMODEL_LAYER = 1;

type Pose = 'swing' | 'slash' | 'bow' | 'hold' | 'staff';

function poseFor(def: ItemDef): Pose {
  if (def.kind === 'tool') return 'swing';
  if (def.weapon?.type === 'melee') return 'slash';
  if (def.weapon?.type === 'bow') return 'bow';
  if (def.weapon?.type === 'magic') return 'staff';
  return 'hold';
}

/** Sleeve from the shoulder (origin) forward along -z to the hand. */
const ARM_LEN = 0.5;
function armGeometry() {
  const sleeve = part(new THREE.BoxGeometry(0.12, 0.12, 0.42).translate(0, 0, -0.21), 'fabric', 0x46548a);
  const cuff = part(new THREE.BoxGeometry(0.13, 0.13, 0.05).translate(0, 0, -0.43), 'fabric', 0xb89a5a);
  const hand = part(new THREE.BoxGeometry(0.1, 0.1, 0.1).translate(0, 0, -ARM_LEN), 'plain', 0xd8a07a);
  return mergeNonIndexed([sleeve, cuff, hand]);
}

const ease = (t: number) => t * t * (3 - 2 * t);

export class Viewmodel {
  readonly root = new THREE.Group();
  /** Rotates the whole arm (and what it holds) about the shoulder. */
  private shoulder = new THREE.Group();
  /** The item's grip, at the hand. */
  private grip = new THREE.Group();
  private itemMesh: THREE.Mesh;
  private arm: THREE.Mesh;
  private currentId: string | null = null;
  private pose: Pose = 'hold';
  private swing = 0;
  private swingDur = 0.3;
  private draw = 0;
  private bob = 0;
  private equipT = 1;

  /**
   * @param material   dedicated object-space world material
   * @param visibility the material's sky-visibility override, driven per frame
   */
  constructor(camera: THREE.Camera, material: THREE.Material, private visibility: { value: number }) {
    material.depthTest = true;
    material.depthWrite = true;
    material.transparent = false;
    this.itemMesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.arm = new THREE.Mesh(armGeometry(), material);
    for (const m of [this.itemMesh, this.arm]) {
      m.frustumCulled = false;
      m.layers.set(VIEWMODEL_LAYER);
    }
    this.root.add(this.shoulder);
    this.shoulder.add(this.arm);
    this.shoulder.add(this.grip);
    this.grip.add(this.itemMesh);
    this.grip.position.set(0, 0.01, -ARM_LEN);
    this.shoulder.position.set(0.46, -0.52, -0.12);
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
    const bs = this.itemMesh.geometry.boundingSphere!;
    // Held blocks and small items are normalised to fit the hand; tools and
    // weapons keep their proportions at a hand-held size.
    const scale = this.pose === 'hold' ? Math.min(1.1, 0.13 / bs.radius) : Math.min(0.54, 0.26 / bs.radius);
    this.itemMesh.scale.setScalar(scale);
    this.itemMesh.position.set(0, 0, 0);
    this.itemMesh.rotation.set(0, 0, 0);
    switch (this.pose) {
      // Picks, axes and hammers are modelled with the head across x: turn them
      // so the working edge points away from the player, seen half in profile.
      case 'swing': this.itemMesh.rotation.set(0, 0.45, 0); this.itemMesh.position.set(0, -0.04, 0); break;
      // Blades show a little of their flat, edge leading.
      case 'slash': this.itemMesh.rotation.set(0, 0.35, 0); this.itemMesh.position.set(0, -0.04, 0); break;
      case 'bow': this.itemMesh.rotation.set(0, Math.PI / 2, 0); this.itemMesh.position.set(0, -0.3 * scale, 0); break;
      case 'staff': this.itemMesh.position.set(0, -0.12, 0); break;
      default: this.itemMesh.position.set(-bs.center.x * scale, -bs.center.y * scale + 0.06, -bs.center.z * scale - 0.02);
    }
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
    const k = this.swing > 0 ? 1 - this.swing : 0; // 0 -> 1 through the swing
    // A quick wind-up (first fifth), a hard strike, then an eased recovery.
    const strike = this.swing > 0 ? (k < 0.2 ? -ease(k / 0.2) * 0.25 : k < 0.5 ? -0.25 + ease((k - 0.2) / 0.3) * 1.25 : 1 - ease((k - 0.5) / 0.5)) : 0;
    const bobX = Math.sin(this.bob) * 0.014 * moving, bobY = Math.abs(Math.cos(this.bob)) * 0.02 * moving;
    const drop = (1 - ease(this.equipT)) * 0.4;

    const sh = this.shoulder, g = this.grip;
    sh.position.set(0.46 + bobX, -0.52 + bobY - drop, -0.12);
    switch (this.pose) {
      case 'swing':
        // Arm raised forward, tool leaning away; the strike drops the whole
        // arm forward and down across the body.
        sh.rotation.set(0.36 - strike * 0.55, 0.2 + strike * 0.3, strike * 0.2);
        g.rotation.set(-0.3 - strike * 0.85, 0, 0.5);
        break;
      case 'slash':
        // A diagonal cut from upper right to lower left.
        sh.rotation.set(0.38 - strike * 0.5, 0.18 + strike * 0.6, -strike * 0.3);
        g.rotation.set(-0.3 - strike * 0.6, 0, 0.5 + strike * 0.5);
        break;
      case 'bow':
        // Held up in front, pulled toward the eye as it draws.
        sh.rotation.set(0.5, 0.42, 0);
        sh.position.z = -0.12 + this.draw * 0.1;
        g.rotation.set(0, 0, -0.12);
        break;
      case 'staff':
        // Pointed forward; casting thrusts it out.
        sh.rotation.set(0.38 + strike * 0.2, 0.22, 0);
        sh.position.z = -0.12 - Math.max(0, strike) * 0.12;
        g.rotation.set(-0.35, 0, 0.2);
        break;
      default:
        // Held out in the palm; using it dips the arm forward.
        sh.rotation.set(0.38 - Math.max(0, strike) * 0.4, 0.25, 0);
        g.rotation.set(-0.2, 0.4 + Math.sin(this.bob * 0.5) * 0.04, 0);
    }
  }
}
