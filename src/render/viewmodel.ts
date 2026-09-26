// First-person held item, in the style of block games: one plain, blocky arm
// reaching in from the bottom-right corner, holding a flat pixel-art tool
// sprite (see heldSprites.ts) or the item's model. The arm and whatever it
// holds are one rigid piece that turns about the shoulder: a swing drives the
// whole arm down and across toward the crosshair, and the tool never moves
// on its own at the wrist.
//
// The arm and item live on their own render layer: the world is drawn first,
// then the depth buffer is cleared and the held item is drawn over it with
// normal depth testing (see PostFX), so it never clips into walls, is never
// crossed by world outlines, and its own faces sort correctly.

import * as THREE from 'three';
import { type ItemDef, item } from '../items/items';
import { heldSprite } from './heldSprites';
import { itemModel, part } from './models';
import { mergeNonIndexed } from './sky';

/** Render layer for the first-person overlay. */
export const VIEWMODEL_LAYER = 1;

type Pose = 'swing' | 'bow' | 'hold' | 'staff';

function poseFor(def: ItemDef): Pose {
  if (def.kind === 'tool' || def.weapon?.type === 'melee') return 'swing';
  if (def.weapon?.type === 'bow') return 'bow';
  if (def.weapon?.type === 'magic') return 'staff';
  return 'hold';
}

/** Arm length from the shoulder (origin) forward along -z to the fist. */
const ARM_LEN = 0.56;
/** A plain block arm: a shirt sleeve at the shoulder, then bare forearm and fist. */
function armGeometry() {
  const w = 0.13;
  return mergeNonIndexed([
    part(new THREE.BoxGeometry(w, w, 0.2).translate(0, 0, -0.1), 'plain', 0x4a5a94),
    part(new THREE.BoxGeometry(w, w, ARM_LEN - 0.2).translate(0, 0, -0.2 - (ARM_LEN - 0.2) / 2), 'plain', 0xd8a07a),
  ]);
}

const ease = (t: number) => t * t * (3 - 2 * t);

/** Shoulder rest position (camera space), just off the bottom-right of the view. */
const SHOULDER = new THREE.Vector3(0.42, -0.47, -0.06);

export class Viewmodel {
  readonly root = new THREE.Group();
  /** Rotates and moves the whole arm and what it holds, as one piece. */
  private shoulder = new THREE.Group();
  /** The item's grip, fixed in the fist. */
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
    this.grip.position.set(0, 0, -ARM_LEN + 0.04);
    this.shoulder.position.copy(SHOULDER);
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
    const sprite = heldSprite(def);
    this.itemMesh.geometry = sprite ?? itemModel(def);
    this.itemMesh.visible = true;
    this.itemMesh.position.set(0, 0, 0);
    this.itemMesh.rotation.set(0, 0, 0);
    this.itemMesh.scale.setScalar(1);
    if (sprite) {
      // The fist closes round the handle: the sprite's grip is its origin.
      // Tools lean away from you, head up and toward the crosshair, turned so
      // you see them half in profile; bows are held upright.
      if (this.pose === 'bow') this.grip.rotation.set(-0.1, -0.35, 0.3);
      else this.grip.rotation.set(-0.62, -0.72, 0.18);
      return;
    }
    // Anything else sits on the palm, normalised to a hand-held size.
    const bs = this.itemMesh.geometry.boundingSphere!;
    const scale = this.pose === 'hold' ? Math.min(1.1, 0.12 / bs.radius) : Math.min(0.5, 0.24 / bs.radius);
    this.itemMesh.scale.setScalar(scale);
    if (this.pose === 'hold') {
      this.itemMesh.position.set(-bs.center.x * scale, -bs.center.y * scale + 0.1, -bs.center.z * scale);
      this.grip.rotation.set(0, 0.6, 0);
    } else {
      this.itemMesh.position.set(0, -0.1, 0);
      this.grip.rotation.set(-0.4, 0, 0.15);
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
    // Swing curves: `arc` rises and falls over the whole stroke (the arm's
    // sweep), `snap` peaks early (the quick drive forward).
    const arc = this.swing > 0 ? Math.sin(Math.sqrt(k) * Math.PI) : 0;
    const snap = this.swing > 0 ? Math.sin(k * k * Math.PI) : 0;
    const bobX = Math.sin(this.bob) * 0.012 * moving, bobY = -Math.abs(Math.cos(this.bob)) * 0.018 * moving;
    const drop = (1 - ease(this.equipT)) * 0.45;

    const sh = this.shoulder;
    sh.position.set(SHOULDER.x + bobX, SHOULDER.y + bobY - drop, SHOULDER.z);
    switch (this.pose) {
      case 'swing':
        // Arm reaching forward and a little up; the stroke sweeps the whole
        // arm down and in toward the crosshair and back.
        sh.position.x -= arc * 0.16;
        sh.position.y += arc * 0.1 + Math.sin(Math.sqrt(k) * Math.PI * 2) * 0.03;
        sh.position.z -= snap * 0.1;
        sh.rotation.set(0.28 - arc * 0.4 - snap * 0.25, 0.12 + arc * 0.5, -snap * 0.3);
        break;
      case 'bow':
        // Held out in front, pulled back toward the eye as it draws.
        sh.position.x -= 0.06;
        sh.position.y += 0.1;
        sh.position.z += this.draw * 0.1;
        sh.rotation.set(0.32 + this.draw * 0.05, 0.28, 0);
        break;
      case 'staff':
        // Pointed ahead; casting thrusts the arm forward.
        sh.position.z -= snap * 0.12;
        sh.rotation.set(0.24 - arc * 0.2, 0.14, 0);
        break;
      default:
        // Held out on the palm; using it dips the arm forward.
        sh.rotation.set(0.24 - arc * 0.45, 0.16 + arc * 0.2, 0);
    }
  }
}
