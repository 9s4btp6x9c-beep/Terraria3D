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
const CAVE_FOG = C(0x0b0a12);
const EMBER_FOG = C(0x2a0c08);
const CAVE_AMBIENT = C(0x1a1726);
const EMBER_AMBIENT = C(0x3a140c);

function sampleKeys(keys: readonly (readonly [number, THREE.Color])[], t: number, out: THREE.Color) {
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, c0] = keys[i], [t1, c1] = keys[i + 1];
    if (t >= t0 && t <= t1) return out.copy(c0).lerp(c1, (t - t0) / (t1 - t0));
  }
  return out.copy(keys[0][1]);
}

interface LightSource { x: number; y: number; z: number; color: THREE.Color; range: number; flicker?: number }

/** Chooses which point lights feed the shader each frame (nearest first). */
export class LightPool {
  private statics = new Map<number, LightSource>();
  private transient: (LightSource & { life: number; max: number })[] = [];
  private nextId = 1;

  add(src: LightSource): number {
    const id = this.nextId++;
    this.statics.set(id, src);
    return id;
  }

  remove(id: number) { this.statics.delete(id); }

  flash(x: number, y: number, z: number, color: number, range: number, life: number) {
    this.transient.push({ x, y, z, color: new THREE.Color(color), range, life, max: life });
  }

  update(dt: number, cam: THREE.Vector3, u: WorldUniforms, time: number) {
    this.transient = this.transient.filter(l => (l.life -= dt) > 0);
    const all: { l: LightSource; k: number; d: number }[] = [];
    for (const l of this.statics.values()) all.push({ l, k: 1, d: (l.x - cam.x) ** 2 + (l.y - cam.y) ** 2 + (l.z - cam.z) ** 2 });
    for (const l of this.transient) all.push({ l, k: l.life / l.max, d: (l.x - cam.x) ** 2 + (l.y - cam.y) ** 2 + (l.z - cam.z) ** 2 - 400 });
    all.sort((a, b) => a.d - b.d);
    for (let i = 1; i < MAX_POINT_LIGHTS; i++) {
      const e = all[i - 1];
      if (!e || e.d > 90 * 90) { u.uLightPos.value[i].set(0, -1000, 0, 1); u.uLightColor.value[i].setRGB(0, 0, 0); continue; }
      const f = e.l.flicker ? 1 + Math.sin(time * 13 + e.l.x) * 0.06 * e.l.flicker + Math.sin(time * 29 + e.l.z) * 0.04 * e.l.flicker : 1;
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
  cycle = true;
  private tmp = new THREE.Color();
  private horizon = new THREE.Color();
  private sunDir = new THREE.Vector3();

  constructor(scene: THREE.Scene, private renderer: THREE.WebGLRenderer, private u: WorldUniforms,
    center: THREE.Vector3, seed: number, seaLevel: number, shadowSize: number) {
    this.sun = new THREE.DirectionalLight(0xfff2dc, 2.8);
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
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWaterWorld;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uSky; uniform vec2 uSkySize; uniform float uSea; uniform float uTime; varying vec3 vWaterWorld;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  vec2 suv = (vWaterWorld.xz + 0.5) / uSkySize;
  if (suv.x > 0.0 && suv.y > 0.0 && suv.x < 1.0 && suv.y < 1.0 && texture2D(uSky, suv).r > uSea + 2.5) discard;`)
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

  /**
   * @param cam        camera position
   * @param visibility sky visibility at the camera (0 = enclosed)
   */
  update(dt: number, cam: THREE.Vector3, visibility: number, time: number, focus: { x: number; y: number; z: number }, lanternDir: THREE.Vector3, lanternBoost = 0, ember = 0) {
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

    // Light colours.
    const dusk = 1 - Math.min(1, Math.abs(sunUp) * 4);
    if (isDay) {
      this.sun.color.setRGB(1, 0.95 - dusk * 0.25, 0.86 - dusk * 0.45);
      this.sun.intensity = 2.8 * THREE.MathUtils.smoothstep(sunUp, -0.05, 0.2);
    } else {
      this.sun.color.setRGB(0.5, 0.6, 1.0);
      this.sun.intensity = 0.32 * THREE.MathUtils.smoothstep(-sunUp, 0.0, 0.25);
    }
    const d = this.daylight;
    this.u.uHemiSky.value.setRGB(0.64 * d + 0.05, 0.76 * d + 0.07, 0.96 * d + 0.15);
    this.u.uHemiGround.value.setRGB(0.44 * d + 0.03, 0.37 * d + 0.03, 0.3 * d + 0.06);

    // Sky + fog.
    sampleKeys(SKY_TOP, t, this.sky.uniforms.uTop.value);
    sampleKeys(SKY_HORIZON, t, this.horizon);
    this.sky.uniforms.uHorizon.value.copy(this.horizon);
    this.sky.uniforms.uBottom.value.copy(this.horizon).multiplyScalar(0.8);
    this.tmp.copy(CAVE_FOG).lerp(EMBER_FOG, ember);
    this.fog.color.copy(this.horizon).lerp(this.tmp, ug);
    this.u.uCaveAmbient.value.copy(CAVE_AMBIENT).lerp(EMBER_AMBIENT, ember);
    this.fog.near = 90 - ug * 82;
    this.fog.far = 560 - ug * 480;
    this.renderer.setClearColor(this.fog.color);
    (this.stars.material as THREE.PointsMaterial).opacity = (1 - d) * (1 - ug);
    this.stars.visible = d < 0.95 && ug < 0.95;
    this.stars.position.copy(cam);
    this.stars.rotation.y = t * Math.PI * 2;
    this.sky.group.visible = ug < 0.98;
    this.sky.setBrightness(0.25 + 0.75 * d, this.tmp.copy(this.horizon));
    this.sky.follow(cam);
    this.sky.update(time);

    // Shadow camera follows the player (snapped to texels to avoid shimmer).
    const snap = 140 / this.sun.shadow.mapSize.x;
    const px = Math.round(focus.x / snap) * snap, pz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(px, focus.y, pz);
    this.sun.position.set(px + this.sunDir.x * 200, focus.y + this.sunDir.y * 200, pz + this.sunDir.z * 200);

    // Lantern (slot 0): brighter underground and at night.
    const lp = this.u.uLightPos.value[0];
    lp.set(cam.x + lanternDir.x * 0.5, cam.y + 0.2, cam.z + lanternDir.z * 0.5, 13 + lanternBoost * 5);
    this.u.uLightColor.value[0].setRGB(1.0, 0.72, 0.42).multiplyScalar(0.3 + Math.max(ug, (1 - d) * 0.6) * 0.9 + lanternBoost * 0.3);
    this.u.uTime.value = time;
    this.lights.update(dt, cam, this.u, time);
  }

  /** 0..1 how bright ambient light is for unlit objects (viewmodel, particles). */
  ambientAt(visibility: number) {
    return Math.max(0.3, visibility * (0.35 + this.daylight * 0.65));
  }
}
