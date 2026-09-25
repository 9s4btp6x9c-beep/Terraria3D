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
import { EXTRA_LAYERS, TILE_METRES } from './textures';

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
}

export function createWorldUniforms(tex: THREE.DataArrayTexture, sky: THREE.DataTexture, skyW: number, skyD: number): WorldUniforms {
  const emissive = [...MATERIALS.map(m => m.emissive), ...Object.keys(EXTRA_LAYERS).map(() => 0)];
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

export function createWorldMaterial(u: WorldUniforms, opts: { vertexColors?: boolean; side?: THREE.Side } = {}) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: !!opts.vertexColors, side: opts.side ?? THREE.FrontSide });
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 mats;
attribute vec3 bary;
flat varying vec3 vMats;
varying vec3 vBary;
varying vec3 vWorld;
varying vec3 vWorldNormal;`)
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
  vMats = mats;
  vBary = bary;
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
flat varying vec3 vMats;
varying vec3 vBary;
varying vec3 vWorld;
varying vec3 vWorldNormal;

float whash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float skyVisibility(vec3 p) {
  float top = texture2D(uSky, (p.xz + 0.5) / uSkySize).r;
  return smoothstep(0.0, 1.0, clamp((p.y - top + 6.0) / 5.0, 0.0, 1.0));
}`)
      .replace('#include <map_fragment>', `
  // Pixel-snapped dither value, stable in world space.
  float dith = whash(floor(vWorld * ${(64 / TILE_METRES).toFixed(1)}) + 0.5);
  vec3 bw = vBary * vBary * vBary;
  bw /= (bw.x + bw.y + bw.z);
  float layer = dith < bw.x ? vMats.x : (dith < bw.x + bw.y ? vMats.y : vMats.z);
  layer = floor(layer + 0.5);

  vec3 an = abs(normalize(vWorldNormal)) + (dith - 0.5) * 0.12;
  vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
  vec2 uv, gx, gy;
  if (an.x > an.y && an.x > an.z) { uv = vWorld.zy; gx = dpx.zy; gy = dpy.zy; }
  else if (an.y > an.z) { uv = vWorld.xz; gx = dpx.xz; gy = dpy.xz; }
  else { uv = vWorld.xy; gx = dpx.xy; gy = dpy.xy; }
  const float TS = 1.0 / ${TILE_METRES.toFixed(1)};
  vec4 texel = textureGrad(uTex, vec3(uv * TS, layer), gx * TS, gy * TS);
  diffuseColor.rgb *= texel.rgb;
  float emissiveAmt = uEmissive[int(layer)];
`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * emissiveAmt * 1.6;
`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  {
    float vis = skyVisibility(vWorld);
    vec3 wn = normalize(vWorldNormal);
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
  mat.customProgramCacheKey = () => `world-${opts.vertexColors ? 1 : 0}`;
  return mat;
}
