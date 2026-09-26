// The shared shader for everything that lives in the world (terrain, trees,
// building pieces, grass). Built on MeshLambertMaterial so we keep three.js
// shadows and fog, then extended with:
//  - world-space triplanar sampling of the pixel-art texture array
//  - dithered, pixel-snapped blending between up to 3 materials per triangle
//  - sky visibility from the SkyMap (caves/overhangs go dark)
//  - custom hemisphere ambient and a small pool of point lights (lantern,
//    torches) that are NOT darkened underground
//  - per-layer emissive glow (crystals, ores)

import * as THREE from 'three';
import { MATERIALS } from '../world/materials';
import type { SkyMap } from '../world/skymap';
import { EXTRA_EMISSIVE, EXTRA_LAYERS, TILE_METRES } from './textures';

export const MAX_POINT_LIGHTS = 8;

export interface WorldUniforms {
  uTex: { value: THREE.DataArrayTexture };
  uSky: { value: THREE.DataTexture };
  uSkySize: { value: THREE.Vector2 };
  uEmissive: { value: number[] };
  uHemiSky: { value: THREE.Color };
  uHemiGround: { value: THREE.Color };
  uCaveAmbient: { value: THREE.Color };
  uLightPos: { value: THREE.Vector4[] };
  uLightColor: { value: THREE.Color[] };
  uTime: { value: number };
  /** Per layer: how far its texture is calmed toward its own average colour. */
  uFlat: { value: number[] };
}

/**
 * How much each texture layer is calmed toward its mean colour. The painted
 * textures are busy four-colour patterns; up close that detail reads well,
 * but side by side across a cave wall or a hillside it turns to mush. Ores
 * and crystals keep their contrast (their flecks are how you spot them).
 */
function flatness(style: string): number {
  if (style === 'ore' || style === 'crystal' || style === 'plain' || style === 'flame') return 0;
  if (style === 'planks' || style === 'bricks' || style === 'metal') return 0.2;
  return 0.42;
}

export function createWorldUniforms(tex: THREE.DataArrayTexture, sky: THREE.DataTexture, skyW: number, skyD: number): WorldUniforms {
  const emissive = [...MATERIALS.map(m => m.emissive), ...(Object.keys(EXTRA_LAYERS) as (keyof typeof EXTRA_LAYERS)[]).map(k => EXTRA_EMISSIVE[k] ?? 0)];
  return {
    uTex: { value: tex },
    uSky: { value: sky },
    uSkySize: { value: new THREE.Vector2(skyW, skyD) },
    uEmissive: { value: emissive },
    uHemiSky: { value: new THREE.Color(0x9ab8e8) },
    uHemiGround: { value: new THREE.Color(0x6a5a48) },
    uCaveAmbient: { value: new THREE.Color(0x1a1726) },
    uLightPos: { value: Array.from({ length: MAX_POINT_LIGHTS }, () => new THREE.Vector4(0, -1000, 0, 1)) },
    uLightColor: { value: Array.from({ length: MAX_POINT_LIGHTS }, () => new THREE.Color(0, 0, 0)) },
    uTime: { value: 0 },
    uFlat: { value: [...MATERIALS.map(m => flatness(m.texture)), ...Object.values(EXTRA_LAYERS).map(l => flatness(l.style))] },
  };
}

/** Half-float texture of the blurred ground height, sampled by the shader. */
export function createSkyTexture(sky: SkyMap): THREE.DataTexture {
  const data = new Uint16Array(sky.w * sky.d);
  const tex = new THREE.DataTexture(data, sky.w, sky.d, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  updateSkyTexture(tex, sky);
  return tex;
}

export function updateSkyTexture(tex: THREE.DataTexture, sky: SkyMap) {
  const data = tex.image.data as Uint16Array;
  for (let i = 0; i < sky.blurred.length; i++) data[i] = THREE.DataUtils.toHalfFloat(sky.blurred[i]);
  tex.needsUpdate = true;
}

const LAYER_COUNT = MATERIALS.length + Object.keys(EXTRA_LAYERS).length;

export interface WorldMaterialOptions {
  vertexColors?: boolean;
  side?: THREE.Side;
  /**
   * Texture in object space (for moving objects: held items, pickups, icons,
   * creatures) instead of world space. `objectScale` = texture tiles per metre
   * multiplier; `visibility` overrides the sky map (null = use it).
   */
  objectSpace?: { scale: number; visibility: { value: number } | null };
  /** Multiplier on the per-layer texture calming (creatures are calmed further). */
  flatten?: number;
}

export function createWorldMaterial(u: WorldUniforms, opts: WorldMaterialOptions = {}) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: !!opts.vertexColors, side: opts.side ?? THREE.FrontSide });
  const obj = opts.objectSpace;
  const flash = { value: 0 };
  mat.userData.flash = flash;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.uniforms.uObjScale = { value: obj?.scale ?? 1 };
    shader.uniforms.uVisOverride = obj?.visibility ?? { value: -1 };
    shader.uniforms.uFlash = flash;
    shader.uniforms.uFlatMul = { value: opts.flatten ?? 1 };
    if (obj) shader.defines = { ...(shader.defines ?? {}), OBJECT_SPACE: '' };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 mats;
uniform float uObjScale;
flat varying vec3 vMats;
varying vec3 vBary;
varying vec3 vWorld;
varying vec3 vWorldNormal;
varying vec3 vTexPos;
varying vec3 vTexNormal;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
{
  vec4 wp = vec4(transformed, 1.0);
  vec3 wn = objectNormal;
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
    wn = mat3(instanceMatrix) * wn;
  #endif
  wp = modelMatrix * wp;
  vWorld = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * wn);
  #ifdef OBJECT_SPACE
    vTexPos = transformed * uObjScale;
    vTexNormal = objectNormal;
  #elif defined(USE_INSTANCING)
    // Instances (trees) carry their texture with them, so a tree that sways
    // when struck moves as one piece instead of sliding under its bark.
    vTexPos = instanceMatrix[3].xyz + transformed * length(instanceMatrix[0].xyz);
    vTexNormal = objectNormal;
  #else
    vTexPos = vWorld;
    vTexNormal = vWorldNormal;
  #endif
  vMats = mats;
  // Geometry is non-indexed: the corner index gives the barycentric weights.
  int corner = gl_VertexID % 3;
  vBary = vec3(corner == 0, corner == 1, corner == 2);
}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2DArray uTex;
uniform sampler2D uSky;
uniform vec2 uSkySize;
uniform float uEmissive[${LAYER_COUNT}];
uniform vec3 uHemiSky;
uniform vec3 uHemiGround;
uniform vec3 uCaveAmbient;
uniform vec4 uLightPos[${MAX_POINT_LIGHTS}];
uniform vec3 uLightColor[${MAX_POINT_LIGHTS}];
uniform float uTime;
uniform float uVisOverride;
uniform float uFlash;
uniform float uFlat[${LAYER_COUNT}];
uniform float uFlatMul;
flat varying vec3 vMats;
varying vec3 vBary;
varying vec3 vWorld;
varying vec3 vWorldNormal;
varying vec3 vTexPos;
varying vec3 vTexNormal;

float whash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float skyVisibility(vec3 p) {
  if (uVisOverride >= 0.0) return uVisOverride;
  float top = texture2D(uSky, (p.xz + 0.5) / uSkySize).r;
  return smoothstep(0.0, 1.0, clamp((p.y - top + 6.0) / 5.0, 0.0, 1.0));
}`)
      .replace('#include <map_fragment>', `
  // Pixel-snapped dither value, stable in world space.
  float dith = whash(floor(vTexPos * ${(64 / TILE_METRES).toFixed(1)}) + 0.5);
  vec3 an = abs(normalize(vTexNormal)) + (dith - 0.5) * 0.12;
  vec3 dpx = dFdx(vTexPos), dpy = dFdy(vTexPos);
  vec2 uv, gx, gy;
  if (an.x > an.y && an.x > an.z) { uv = vTexPos.zy; gx = dpx.zy; gy = dpy.zy; }
  else if (an.y > an.z) { uv = vTexPos.xz; gx = dpx.xz; gy = dpy.xz; }
  else { uv = vTexPos.xy; gx = dpx.xy; gy = dpy.xy; }
  const float TS = 1.0 / ${TILE_METRES.toFixed(1)};
  // Up to three materials per triangle, blended smoothly over a narrow band
  // near the middle (a speckled dither between them read as noise).
  vec3 lm = floor(vMats + 0.5);
  vec3 bw = vBary * vBary * vBary * vBary;
  bw /= (bw.x + bw.y + bw.z);
  if (lm.y == lm.x) { bw.x += bw.y; bw.y = 0.0; }
  if (lm.z == lm.x) { bw.x += bw.z; bw.z = 0.0; }
  else if (lm.z == lm.y) { bw.y += bw.z; bw.z = 0.0; }
  vec3 texCol = vec3(0.0);
  float emissiveAmt = 0.0;
  for (int li = 0; li < 3; li++) {
    float w = li == 0 ? bw.x : li == 1 ? bw.y : bw.z;
    if (w < 0.004) continue;
    float layer = li == 0 ? lm.x : li == 1 ? lm.y : lm.z;
    vec3 t = textureGrad(uTex, vec3(uv * TS, layer), gx * TS, gy * TS).rgb;
    // Calm the texture toward its own average (its smallest mip).
    vec3 mean = textureLod(uTex, vec3(0.5, 0.5, layer), 8.0).rgb;
    t = mix(t, mean, clamp(uFlat[int(layer)] * uFlatMul, 0.0, 0.8));
    texCol += t * w;
    emissiveAmt += uEmissive[int(layer)] * w;
  }
  diffuseColor.rgb *= texCol;
`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * emissiveAmt * 1.6 + vec3(uFlash);
`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  {
    vec3 wn = normalize(vWorldNormal);
    // Sample the sky map a little way out along the surface: a cliff face or
    // a pit wall takes its light from the open column it faces.
    float vis = skyVisibility(vWorld + vec3(wn.x, 0.0, wn.z) * 1.2);
    reflectedLight.directDiffuse *= vis;
    vec3 hemi = mix(uHemiGround, uHemiSky, wn.y * 0.5 + 0.5);
    reflectedLight.indirectDiffuse += diffuseColor.rgb * (hemi * vis + uCaveAmbient);
    for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
      vec3 L = uLightPos[i].xyz - vWorld;
      float d = length(L);
      float range = uLightPos[i].w;
      float att = clamp(1.0 - d / range, 0.0, 1.0);
      att *= att;
      float ndl = max(dot(wn, L / max(d, 1e-3)), 0.0) * 0.75 + 0.25;
      reflectedLight.directDiffuse += diffuseColor.rgb * uLightColor[i] * att * ndl;
    }
  }
`);
  };
  mat.customProgramCacheKey = () => `world-${opts.vertexColors ? 1 : 0}-${obj ? 1 : 0}`;
  return mat;
}
