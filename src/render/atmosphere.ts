// Atmosphere: day/night cycle, sun & moon light with shadows, sky dome, stars,
// clouds, fog (switching to cave fog underground), the sea plane and the pool
// of point lights (player lantern, torches, furnaces, projectiles) that the
// world shader evaluates.

import * as THREE from 'three';
import { mulberry32 } from '../core/noise';
import { Sky } from './sky';
import { MAX_POINT_LIGHTS, type WorldUniforms } from './worldMaterial';

/** Full day length in seconds (day ~62%, night ~38%). */
export const DAY_LENGTH = 960;

const C = (hex: number) => new THREE.Color(hex);
// Keyframes over time of day (0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset).
const SKY_TOP = [[0, C(0x070a1c)], [0.2, C(0x0d1430)], [0.27, C(0x4a62b0)], [0.35, C(0x3f63c8)], [0.65, C(0x3f63c8)], [0.73, C(0x5a4e9a)], [0.8, C(0x0d1430)], [1, C(0x070a1c)]] as const;
const SKY_HORIZON = [[0, C(0x10183a)], [0.2, C(0x1c2448)], [0.26, C(0xf0a070)], [0.33, C(0xa9c6ee)], [0.67, C(0xa9c6ee)], [0.74, C(0xf08a5a)], [0.8, C(0x1c2448)], [1, C(0x10183a)]] as const;
const SPORE_TOP = C(0x05241f);
const SPORE_HORIZON = C(0x1e6a52);
const CAVE_FOG = C(0x0b0a12);
const EMBER_FOG = C(0x2a0c08);
// Caves are dim, never pitch black: you can always make out the rock.
const CAVE_AMBIENT = C(0x4a4c64);
const SHROOM_FOG = C(0x061a0c);
const SHROOM_AMBIENT = C(0x164a26);
const EMBER_AMBIENT = C(0x3a140c);

function sampleKeys(keys: readonly (readonly [number, THREE.Color])[], t: number, out: THREE.Color) {
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, c0] = keys[i], [t1, c1] = keys[i + 1];
    if (t >= t0 && t <= t1) return out.copy(c0).lerp(c1, (t - t0) / (t1 - t0));
  }
  return out.copy(keys[0][1]);
}

interface LightSource { x: number; y: number; z: number; color: THREE.Color; range: number; flicker?: number }

/**
 * Chooses which point lights feed the shader each frame (nearest first).
 * There are only a few slots, so lights that lose theirs fade out and new
 * ones fade in, and a light already shining is favoured to keep its slot:
 * torches never snap off and on (strobe) as the camera moves or a spark
 * flashes nearby.
 */
export class LightPool {
  private statics = new Map<number, LightSource>();
  private transient: (LightSource & { life: number; max: number })[] = [];
  /** Current brightness (0..1) of each static light that holds or is leaving a slot. */
  private weight = new Map<number, number>();
  private nextId = 1;

  add(src: LightSource): number {
    const id = this.nextId++;
    this.statics.set(id, src);
    return id;
  }

  remove(id: number) { this.statics.delete(id); this.weight.delete(id); }

  flash(x: number, y: number, z: number, color: number, range: number, life: number) {
    this.transient.push({ x, y, z, color: new THREE.Color(color), range, life, max: life });
  }

  update(dt: number, cam: THREE.Vector3, u: WorldUniforms, time: number) {
    const slots = MAX_POINT_LIGHTS - 1;
    this.transient = this.transient.filter(l => (l.life -= dt) > 0);
    const dist = (l: LightSource) => (l.x - cam.x) ** 2 + (l.y - cam.y) ** 2 + (l.z - cam.z) ** 2;
    // Flashes are brief: they take at most two slots, and only spare ones.
    const flashes = this.transient.map(l => ({ l, k: l.life / l.max, d: dist(l) })).filter(e => e.d < 60 * 60).sort((a, b) => a.d - b.d).slice(0, 2);
    const statics: { id: number; l: LightSource; d: number }[] = [];
    for (const [id, l] of this.statics) {
      const d = dist(l);
      if (d > 90 * 90) continue;
      // Hysteresis: a lit light ranks as if a little closer than it is.
      statics.push({ id, l, d: (this.weight.get(id) ?? 0) > 0 ? d * 0.7 : d });
    }
    statics.sort((a, b) => a.d - b.d);
    const want = new Set(statics.slice(0, slots).map(e => e.id));
    // Lights keep their slot while fading out; a newcomer starts fading in
    // only once a slot is free, so no light is ever cut off mid-fade.
    let held = statics.filter(e => this.weight.has(e.id)).length;
    const rate = dt * 4;
    for (const e of statics) {
      const w = this.weight.get(e.id) ?? 0;
      if (w === 0 && (!want.has(e.id) || held >= slots)) continue;
      if (w === 0) held++;
      const nw = want.has(e.id) ? Math.min(1, w + rate) : Math.max(0, w - rate);
      if (nw > 0) this.weight.set(e.id, nw); else this.weight.delete(e.id);
    }
    for (const id of this.weight.keys()) if (!statics.some(e => e.id === id)) this.weight.delete(id);
    // Fill the slots with the lit statics, and flashes in any left over.
    const out: { l: LightSource; k: number }[] = statics.filter(e => this.weight.has(e.id)).map(e => ({ l: e.l, k: this.weight.get(e.id)! }));
    for (const e of flashes) if (out.length < slots) out.push(e);
    for (let i = 1; i < MAX_POINT_LIGHTS; i++) {
      const e = out[i - 1];
      if (!e) { u.uLightPos.value[i].set(0, -1000, 0, 1); u.uLightColor.value[i].setRGB(0, 0, 0); continue; }
      // Flicker: a few slow, incommensurate waves (smooth at any frame rate).
      const fl = e.l.flicker ?? 0;
      const f = fl ? 1 + (Math.sin(time * 7.3 + e.l.x) * 0.05 + Math.sin(time * 11.1 + e.l.z * 1.7) * 0.035 + Math.sin(time * 17.9 + e.l.x + e.l.z) * 0.02) * fl : 1;
      u.uLightPos.value[i].set(e.l.x, e.l.y, e.l.z, e.l.range);
      u.uLightColor.value[i].copy(e.l.color).multiplyScalar(e.k * f);
    }
  }

  get count() { return this.statics.size; }
}

export class Atmosphere {
  readonly lights = new LightPool();
  readonly sun: THREE.DirectionalLight;
  private sky: Sky;
  private stars: THREE.Points;
  private water: THREE.Mesh;
  private fog: THREE.Fog;
  /** 0..1, 0 = midnight. */
  timeOfDay = 0.3;
  /** 0 at night .. 1 at full day. */
  daylight = 1;
  /** 0 outdoors .. 1 deep underground (smoothed). */
  underground = 0;
  /** 1 while the camera is under water. */
  underwater = 0;
  private oceanMask = { value: null as THREE.DataTexture | null };
  private oceanSize = { value: new THREE.Vector2(1, 1) };
  /** Sporefall strength (smoothed toward `sporeTarget`). */
  spore = 0;
  sporeTarget = 0;
  /** Sporefall tint as currently visible (0 by day). */
  sporeVisible = 0;
  cycle = true;
  private tmp = new THREE.Color();
  private horizon = new THREE.Color();
  private sunDir = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();

  constructor(scene: THREE.Scene, private renderer: THREE.WebGLRenderer, private u: WorldUniforms,
    center: THREE.Vector3, seed: number, seaLevel: number, shadowSize: number) {
    this.sun = new THREE.DirectionalLight(0xfff2dc, 2.8);
    this.sun.layers.enable(1); // also lights the first-person held item (render/viewmodel.ts)
    this.sun.castShadow = shadowSize > 0;
    this.sun.shadow.mapSize.set(Math.max(512, shadowSize), Math.max(512, shadowSize));
    const s = this.sun.shadow.camera;
    s.left = -70; s.right = 70; s.top = 70; s.bottom = -70; s.near = 1; s.far = 420;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.06;
    scene.add(this.sun, this.sun.target);
    this.fog = new THREE.Fog(0xa9c6ee, 90, 560);
    scene.fog = this.fog;

    this.sky = new Sky(seed, center);
    scene.add(this.sky.group);

    // Stars.
    const rand = mulberry32(seed ^ 0x57a5);
    const pos: number[] = [];
    for (let i = 0; i < 900; i++) {
      const a = rand() * Math.PI * 2, y = rand() * 0.95 + 0.05;
      const r = Math.sqrt(1 - y * y);
      pos.push(Math.cos(a) * r * 850, y * 850, Math.sin(a) * r * 850);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    this.water = this.makeWater(center, seaLevel);
    scene.add(this.water);
  }

  private makeWater(center: THREE.Vector3, level: number) {
    const geo = new THREE.PlaneGeometry(4000, 4000, 1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: 0x2f73c8, transparent: true, opacity: 0.8, emissive: 0x0a2248 });
    // The sea is one plane; hide it wherever the column is covered by land so
    // it never shows up inside caves that dip below sea level. A pixel ripple
    // pattern keeps it in style with the textures.
    mat.onBeforeCompile = shader => {
      shader.uniforms.uSky = this.u.uSky;
      shader.uniforms.uSkySize = this.u.uSkySize;
      shader.uniforms.uTime = this.u.uTime;
      shader.uniforms.uSea = { value: level };
      shader.uniforms.uOcean = this.oceanMask;
      shader.uniforms.uOceanSize = this.oceanSize;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWaterWorld;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uOcean; uniform vec2 uOceanSize; uniform float uSea; uniform float uTime; varying vec3 vWaterWorld;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  // Only the true ocean shows the sea plane (dug pits inland stay dry).
  vec2 suv = (vWaterWorld.xz + 0.5) / uOceanSize;
  if (suv.x > 0.0 && suv.y > 0.0 && suv.x < 1.0 && suv.y < 1.0 && texture2D(uOcean, suv).r < 0.5) discard;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec2 p = floor(vWaterWorld.xz * 4.0) / 4.0;
    float w = sin(p.x * 0.9 + uTime * 1.3) + sin(p.y * 1.1 - uTime * 1.1) + sin((p.x + p.y) * 0.4 + uTime * 0.7);
    diffuseColor.rgb *= 0.92 + step(1.6, w) * 0.25;
  }`);
    };
    const water = new THREE.Mesh(geo, mat);
    water.position.set(center.x, level, center.z);
    water.receiveShadow = true;
    water.renderOrder = 5;
    return water;
  }

  /** Mark ocean columns (the sea plane is hidden everywhere else). */
  setOceanMask(w: number, d: number, ocean: (x: number, z: number) => boolean) {
    const data = new Uint8Array(w * d);
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) data[x + z * w] = ocean(x + 0.5, z + 0.5) ? 255 : 0;
    const tex = new THREE.DataTexture(data, w, d, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    this.oceanMask.value = tex;
    this.oceanSize.value.set(w, d);
  }

  /**
   * @param cam        camera position
   * @param visibility sky visibility at the camera (0 = enclosed)
   */
  private shroom = 0;

  update(dt: number, cam: THREE.Vector3, visibility: number, time: number, focus: { x: number; y: number; z: number }, lanternDir: THREE.Vector3, lanternBoost = 0, ember = 0, shroom = 0) {
    if (this.cycle) this.timeOfDay = (this.timeOfDay + dt / DAY_LENGTH) % 1;
    const t = this.timeOfDay;
    // Sun path: rises in the east (+x), sets in the west, tilted south.
    const ang = (t - 0.25) * Math.PI * 2;
    const sunUp = Math.sin(ang);
    this.daylight = THREE.MathUtils.smoothstep(sunUp, -0.12, 0.25);
    const isDay = sunUp > -0.05;
    this.sunDir.set(Math.cos(ang), Math.abs(sunUp) * 0.9 + 0.15, 0.35).normalize();
    if (!isDay) this.sunDir.x = -this.sunDir.x; // moon mirrors the sun

    this.underground += ((1 - visibility) - this.underground) * Math.min(1, dt * 3);
    const ug = this.underground;
    this.spore += (this.sporeTarget - this.spore) * Math.min(1, dt * 0.5);
    // The red tint only shows at night (it fades out as the sun rises).
    const bl = this.spore * (1 - THREE.MathUtils.smoothstep(sunUp, -0.1, 0.1));
    this.sporeVisible = bl;

    // Light colours.
    const dusk = 1 - Math.min(1, Math.abs(sunUp) * 4);
    if (isDay) {
      this.sun.color.setRGB(1, 0.95 - dusk * 0.25, 0.86 - dusk * 0.45);
      this.sun.intensity = 2.8 * THREE.MathUtils.smoothstep(sunUp, -0.05, 0.2);
    } else {
      this.sun.color.setRGB(0.5 + bl * 0.5, 0.6 - bl * 0.35, 1.0 - bl * 0.72);
      this.sun.intensity = (0.32 + bl * 0.2) * THREE.MathUtils.smoothstep(-sunUp, 0.0, 0.25);
    }
    const d = this.daylight;
    this.u.uHemiSky.value.setRGB(0.64 * d + 0.05 + bl * 0.1, 0.76 * d + 0.07 - bl * 0.03, 0.96 * d + 0.15 - bl * 0.1);
    this.u.uHemiGround.value.setRGB(0.44 * d + 0.03, 0.37 * d + 0.03, 0.3 * d + 0.06);

    // Sky + fog.
    sampleKeys(SKY_TOP, t, this.sky.uniforms.uTop.value).lerp(SPORE_TOP, bl);
    sampleKeys(SKY_HORIZON, t, this.horizon).lerp(SPORE_HORIZON, bl * 0.85);
    this.sky.uniforms.uHorizon.value.copy(this.horizon);
    this.sky.uniforms.uBottom.value.copy(this.horizon).multiplyScalar(0.8);
    this.shroom += (shroom - this.shroom) * Math.min(1, dt * 1.5);
    this.tmp.copy(CAVE_FOG).lerp(SHROOM_FOG, this.shroom).lerp(EMBER_FOG, ember);
    this.fog.color.copy(this.horizon).lerp(this.tmp, ug);
    this.u.uCaveAmbient.value.copy(CAVE_AMBIENT).lerp(SHROOM_AMBIENT, this.shroom).lerp(EMBER_AMBIENT, ember);
    this.fog.near = 90 - ug * 82;
    this.fog.far = 560 - ug * 480;
    if (this.underwater > 0) {
      // Murky blue water: short fog that also darkens in caves.
      this.fog.color.setRGB(0.08, 0.26, 0.42).multiplyScalar(0.35 + 0.65 * (1 - ug));
      this.fog.near = 0.5; this.fog.far = 26;
    }
    this.renderer.setClearColor(this.fog.color);
    (this.stars.material as THREE.PointsMaterial).opacity = (1 - d) * (1 - ug) * (1 - bl * 0.6);
    this.stars.visible = d < 0.95 && ug < 0.95;
    this.stars.position.copy(cam);
    this.stars.rotation.y = t * Math.PI * 2;
    this.sky.group.visible = ug < 0.98;
    this.sky.setBrightness(0.25 + 0.75 * d, this.tmp.copy(this.horizon));
    this.sky.follow(cam);
    // The visible disc follows the true arc (the light direction is clamped
    // above the horizon to keep shadows sane).
    const vis = isDay ? this.tmpDir.set(Math.cos(ang), sunUp, 0.35) : this.tmpDir.set(-Math.cos(ang), -sunUp, 0.35);
    this.sky.setCelestial(cam, vis.normalize(), isDay, isDay ? THREE.MathUtils.smoothstep(sunUp, -0.05, 0.1) : THREE.MathUtils.smoothstep(-sunUp, -0.05, 0.1), bl);
    this.sky.update(time);

    // Shadow camera follows the player (snapped to texels to avoid shimmer).
    const snap = 140 / this.sun.shadow.mapSize.x;
    const px = Math.round(focus.x / snap) * snap, pz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(px, focus.y, pz);
    this.sun.position.set(px + this.sunDir.x * 200, focus.y + this.sunDir.y * 200, pz + this.sunDir.z * 200);

    // Lantern (slot 0): brighter underground and at night.
    const lp = this.u.uLightPos.value[0];
    lp.set(cam.x + lanternDir.x * 0.5, cam.y + 0.2, cam.z + lanternDir.z * 0.5, 13 + ug * 4 + lanternBoost * 5);
    this.u.uLightColor.value[0].setRGB(1.0, 0.72, 0.42).multiplyScalar(0.3 + Math.max(ug, (1 - d) * 0.6) * 0.9 + lanternBoost * 0.3);
    this.u.uTime.value = time;
    this.lights.update(dt, cam, this.u, time);
  }

  /** 0..1 how bright ambient light is for unlit objects (viewmodel, particles). */
  ambientAt(visibility: number) {
    return Math.max(0.3, visibility * (0.35 + this.daylight * 0.65));
  }
}
