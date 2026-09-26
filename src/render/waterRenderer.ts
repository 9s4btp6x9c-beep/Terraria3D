// Draws the liquid grid: per 16 m region, a mesh of water surfaces. Tops are
// smoothed by averaging neighbouring levels at each corner, sides appear
// only where water drops away (waterfalls, spills), and falling water gets
// a brighter, streaming "foam" look. The shader shares the world's lighting:
// sky visibility (caves go dark), hemisphere ambient and the point lights.

import * as THREE from 'three';
import { MIN_LEVEL, WaterSim } from '../world/water';
import { MAX_POINT_LIGHTS, type WorldUniforms } from './worldMaterial';


export function createWaterMaterial(u: WorldUniforms) {
  const mat = new THREE.MeshLambertMaterial({ color: 0x3a86d8, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float foam;
varying float vFoam;
varying vec3 vWW;
varying vec3 vWN;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vFoam = foam;
vWW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uSky;
uniform vec2 uSkySize;
uniform vec3 uHemiSky;
uniform vec3 uHemiGround;
uniform vec3 uCaveAmbient;
uniform vec4 uLightPos[${MAX_POINT_LIGHTS}];
uniform vec3 uLightColor[${MAX_POINT_LIGHTS}];
uniform float uTime;
varying float vFoam;
varying vec3 vWW;
varying vec3 vWN;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    // Pixel-snapped ripples on still water, streaks on falling water.
    vec3 p = floor(vWW * 8.0) / 8.0;
    float still = sin(p.x * 1.7 + uTime * 1.3) + sin(p.z * 2.1 - uTime * 1.1) + sin((p.x + p.z) * 0.8 + uTime * 0.7);
    float streak = step(0.55, fract((p.y + uTime * 3.0) * 0.9 + sin(p.x * 3.1 + p.z * 2.3) * 0.5));
    float up = step(0.5, abs(vWN.y));
    float glint = up * step(1.9, still) + (1.0 - up) * streak * 0.6;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.9, 1.0), glint * 0.35 + vFoam * 0.45);
    diffuseColor.a = mix(diffuseColor.a, 0.9, vFoam * 0.6);
  }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  {
    float top = texture2D(uSky, (vWW.xz + 0.5) / uSkySize).r;
    float vis = smoothstep(0.0, 1.0, clamp((vWW.y - top + 10.0) / 10.0, 0.0, 1.0));
    vec3 wn = normalize(vWN);
    reflectedLight.directDiffuse *= vis;
    reflectedLight.indirectDiffuse += diffuseColor.rgb * (mix(uHemiGround, uHemiSky, abs(wn.y) * 0.5 + 0.5) * vis + uCaveAmbient * 1.5);
    for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
      vec3 L = uLightPos[i].xyz - vWW;
      float d = length(L);
      float att = clamp(1.0 - d / uLightPos[i].w, 0.0, 1.0);
      reflectedLight.directDiffuse += diffuseColor.rgb * uLightColor[i] * att * att;
    }
  }`);
  };
  mat.customProgramCacheKey = () => 'water';
  return mat;
}

/**
 * Lava: an opaque, self-lit crust of dark rock broken by bright, slowly
 * churning molten seams; falling lava is a bright streaming curtain.
 */
export function createLavaMaterial(u: WorldUniforms) {
  // Glowing: unlit and unfogged, so it shows through smoke and cave haze.
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false });
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float foam;
varying float vFoam;
varying vec3 vWW;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vFoam = foam;
vWW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
varying float vFoam;
varying vec3 vWW;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec3 p = floor(vWW * 5.0) / 5.0;
    float t = uTime * 0.3;
    // Slow large swirls plus fine cracks: dark crust plates split by glowing seams.
    float big = sin(p.x * 0.45 + t) + sin(p.z * 0.55 - t * 0.8) + sin((p.x + p.z) * 0.3 + t * 0.6);
    float fine = sin(p.x * 2.3 + p.z * 0.7 + t * 1.7) * sin(p.z * 2.1 - p.x * 0.9 - t * 1.3) + sin(p.y * 3.0 + p.x * 1.1 - t);
    float n = big * 0.55 + fine;
    float seam = smoothstep(-0.25, 0.45, n);
    vec3 crust = vec3(0.32, 0.06, 0.03), hot = vec3(1.0, 0.36, 0.04), bright = vec3(1.0, 0.72, 0.2);
    vec3 c = mix(crust, hot, seam);
    c = mix(c, bright, smoothstep(1.1, 1.9, n));
    // Falling lava streams in bright ribbons.
    float streak = step(0.5, fract((p.y + uTime * 0.8) * 0.9 + sin(p.x * 2.1 + p.z * 1.7) * 0.5));
    c = mix(c, mix(hot, bright, streak), vFoam * 0.85);
    diffuseColor.rgb = c;
  }`);
  };
  mat.customProgramCacheKey = () => 'lava';
  return mat;
}

export class WaterRenderer {
  readonly group = new THREE.Group();
  private meshes = new Map<number, THREE.Mesh>();
  private timer = 0;

  /**
   * `buried(x, y, z)`: is this point under the terrain surface (cave water)?
   * `shore(i, j, k)`: is this cell filled by terrain (not a building)? The
   * surface is carried one cell into such shore cells so the ground, not the
   * 1 m liquid grid, draws the waterline.
   */
  constructor(private sim: WaterSim, private material: THREE.Material, private buried: (x: number, y: number, z: number) => boolean,
    private shore: ((i: number, j: number, k: number) => boolean) | null = null) {
    this.group.renderOrder = 6;
  }

  update(dt: number, cam?: THREE.Vector3) {
    // Cave water is only drawn near the camera; lakes stay visible from afar.
    if (cam) for (const m of this.meshes.values()) {
      const c = m.geometry.boundingSphere!.center;
      m.visible = Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z) < (m.userData.buried ? 60 : 350);
    }
    this.timer -= dt;
    if (this.timer > 0 || !this.sim.dirty.size) return;
    this.timer = 0.08;
    // Rebuild a bounded number of regions per pass (nearest-first is not
    // needed: edits are local, so the dirty set is small).
    const regions = [...this.sim.dirty].slice(0, 24);
    for (const rk of regions) this.sim.dirty.delete(rk);
    const buckets = new Map<number, number[]>(regions.map(r => [r, []]));
    for (const key of this.sim.cells.keys()) {
      const [i, j, k] = this.sim.unkey(key);
      const b = buckets.get(this.sim.regionKey(i, j, k));
      if (b) b.push(key);
    }
    for (const [rk, keys] of buckets) this.rebuild(rk, keys);
  }

  /** Rebuild everything (after loading a save). */
  rebuildAll() {
    for (const m of this.meshes.values()) { this.group.remove(m); m.geometry.dispose(); }
    this.meshes.clear();
    const buckets = new Map<number, number[]>();
    for (const key of this.sim.cells.keys()) {
      const [i, j, k] = this.sim.unkey(key);
      const rk = this.sim.regionKey(i, j, k);
      (buckets.get(rk) ?? buckets.set(rk, []).get(rk)!).push(key);
    }
    for (const [rk, keys] of buckets) this.rebuild(rk, keys);
    this.sim.dirty.clear();
  }

  private rebuild(rk: number, keys: number[]) {
    const old = this.meshes.get(rk);
    if (old) { this.group.remove(old); old.geometry.dispose(); this.meshes.delete(rk); }
    if (!keys.length) return;
    const pos: number[] = [], nor: number[] = [], foam: number[] = [];
    const sim = this.sim;
    const wet = (i: number, j: number, k: number) => sim.level(i, j, k) >= MIN_LEVEL;
    // Effective height of a cell's water column top within layer j.
    const eff = (i: number, j: number, k: number) => (wet(i, j + 1, k) ? 1 : sim.level(i, j, k));
    const corner = (i: number, j: number, k: number) => {
      // Average of the (up to four) wet cells sharing this corner.
      let s = 0, n = 0;
      for (const [a, c] of [[i - 1, k - 1], [i, k - 1], [i - 1, k], [i, k]]) {
        if (!wet(a, j, c)) continue;
        s += eff(a, j, c); n++;
      }
      return n ? s / n : 0;
    };
    const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], f: number) => {
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      for (let q = 0; q < 6; q++) { nor.push(...n); foam.push(f); }
    };
    for (const key of keys) {
      const [i, j, k] = sim.unkey(key);
      const l = sim.level(i, j, k);
      if (l < MIN_LEVEL) continue;
      const falling = !sim.solid(i, j - 1, k) && sim.level(i, j - 1, k) < 0.99;
      const f = falling ? 1 : 0;
      const above = wet(i, j + 1, k);
      const h00 = above ? j + 1 : j + Math.max(0.02, corner(i, j, k));
      const h10 = above ? j + 1 : j + Math.max(0.02, corner(i + 1, j, k));
      const h01 = above ? j + 1 : j + Math.max(0.02, corner(i, j, k + 1));
      const h11 = above ? j + 1 : j + Math.max(0.02, corner(i + 1, j, k + 1));
      if (!above) quad([i, h00, k], [i, h01, k + 1], [i + 1, h11, k + 1], [i + 1, h10, k], [0, 1, 0], f);
      // Sides where the neighbour is open and lower.
      const side = (a: number, c: number, p0: number[], p1: number[], t0: number, t1: number, n: number[]) => {
        if (sim.solid(a, j, c) || sim.sea(a, j, c)) return;
        const nl = sim.level(a, j, c);
        const own = above ? 1 : l;
        if (nl >= own - 0.02 || (nl > 0 && wet(a, j + 1, c))) return;
        const b = j + (nl >= MIN_LEVEL ? nl : 0);
        if (Math.max(t0, t1) - b < 0.02) return;
        quad([p0[0], b, p0[1]], [p1[0], b, p1[1]], [p1[0], Math.max(b, t1), p1[1]], [p0[0], Math.max(b, t0), p0[1]], n, f);
      };
      side(i - 1, k, [i, k + 1], [i, k], h01, h00, [-1, 0, 0]);
      side(i + 1, k, [i + 1, k], [i + 1, k + 1], h10, h11, [1, 0, 0]);
      side(i, k - 1, [i, k], [i + 1, k], h00, h10, [0, 0, -1]);
      side(i, k + 1, [i + 1, k + 1], [i, k + 1], h11, h01, [0, 0, 1]);
      // Underside of hanging / falling water.
      if (!sim.solid(i, j - 1, k) && !wet(i, j - 1, k)) quad([i, j, k], [i + 1, j, k], [i + 1, j, k + 1], [i, j, k + 1], [0, -1, 0], f);
    }
    // Shoreline: carry the top surface one cell into the surrounding ground
    // (each shore cell once: drawn by the region holding its first resting
    // water neighbour, so it is never doubled or dropped at region borders). Where the ground
    // rises above the water it hides the extra surface; where it dips below
    // the waterline inside a "solid" cell, the water now covers it instead
    // of stopping in a square step.
    if (this.shore) {
      const seen = new Set<number>();
      for (const key of keys) {
        const [i, j, k] = sim.unkey(key);
        if (sim.level(i, j, k) < MIN_LEVEL || wet(i, j + 1, k) || (!sim.solid(i, j - 1, k) && sim.level(i, j - 1, k) < 0.99)) continue;
        for (let dc = -1; dc <= 1; dc++) for (let da = -1; da <= 1; da++) {
          const a = i + da, c = k + dc;
          if ((!da && !dc) || wet(a, j, c)) continue;
          const sk = sim.key(a, j, c);
          if (seen.has(sk)) continue;
          seen.add(sk);
          if (!this.shore(a, j, c)) continue;
          // Height: the mean of the resting water around it.
          let s = 0, n = 0, owner = -1;
          for (let z = c - 1; z <= c + 1; z++) for (let x = a - 1; x <= a + 1; x++)
            if (wet(x, j, z) && !wet(x, j + 1, z)) { s += sim.level(x, j, z); n++; if (owner < 0) owner = sim.regionKey(x, j, z); }
          if (!n || owner !== rk) continue;
          const h = s / n;
          const at = (x: number, z: number) => { const v = corner(x, j, z); return j + Math.max(0.02, v > 0 ? v : h); };
          quad([a, at(a, c), c], [a, at(a, c + 1), c + 1], [a + 1, at(a + 1, c + 1), c + 1], [a + 1, at(a + 1, c), c], [0, 1, 0], 0);
        }
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('foam', new THREE.Float32BufferAttribute(foam, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.material);
    m.renderOrder = 6;
    const c = g.boundingSphere!.center;
    m.userData.buried = this.buried(c.x, c.y + 2, c.z);
    this.group.add(m);
    this.meshes.set(rk, m);
  }
}
