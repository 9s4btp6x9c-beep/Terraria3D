// Post-processing: dark silhouette outlines from depth discontinuities, mild
// colour grading, vignette and a touch of ordered dithering. Deliberately
// restrained so the scene stays readable.

import * as THREE from 'three';

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const frag = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform vec3 uOutline;
uniform float uUnderground;
varying vec2 vUv;

float linearDepth(vec2 uv) {
  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int idx = i.x + i.y * 4;
  int m[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
  return float(m[idx]) / 16.0 - 0.5;
}

void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  float dc = linearDepth(vUv);
  float dl = linearDepth(vUv - vec2(uTexel.x, 0.0));
  float dr = linearDepth(vUv + vec2(uTexel.x, 0.0));
  float du = linearDepth(vUv + vec2(0.0, uTexel.y));
  float dd = linearDepth(vUv - vec2(0.0, uTexel.y));
  // Inverse depth is affine across planar surfaces, so its Laplacian is ~0 on
  // flat/grazing ground and large at silhouettes. Negative Laplacian = we are
  // on the nearer side of a depth step -> crisp outlines hugging the closer
  // object (including against the sky).
  float wc = 1.0 / dc;
  float lap = (1.0 / dl + 1.0 / dr + 1.0 / du + 1.0 / dd) - 4.0 * wc;
  float rel = -lap / wc;
  float line = smoothstep(0.12, 0.3, rel) * (1.0 - smoothstep(uFar * 0.55, uFar * 0.95, dc));
  col = mix(col, uOutline, line * 0.85);

  // Grading: gentle contrast + saturation, cooler shadows underground.
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, 1.0);
  col = (col - 0.5) * 1.06 + 0.5;
  col = mix(col, col * vec3(0.9, 0.95, 1.1), uUnderground * 0.5);

  // Vignette.
  vec2 v = vUv - 0.5;
  col *= 1.0 - dot(v, v) * (0.35 + uUnderground * 0.5);

  // Ordered dither before 8-bit output hides banding and adds retro grain.
  col += bayer4(gl_FragCoord.xy) / 64.0;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  #include <colorspace_fragment>
}`;

export class PostFX {
  readonly target: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;

  constructor(private renderer: THREE.WebGLRenderer, private camera: THREE.PerspectiveCamera, msaa = 4) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const depthTexture = new THREE.DepthTexture(size.x, size.y);
    depthTexture.type = THREE.UnsignedIntType;
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      depthTexture,
      samples: msaa,
      type: THREE.HalfFloatType,
    });
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: depthTexture },
        uTexel: { value: new THREE.Vector2(1 / size.x, 1 / size.y) },
        uNear: { value: camera.near },
        uFar: { value: camera.far },
        uOutline: { value: new THREE.Color(0x14121c) },
        uUnderground: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  setUnderground(v: number) {
    this.mat.uniforms.uUnderground.value = v;
  }

  resize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(size.x, size.y);
    this.mat.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
  }

  render(scene: THREE.Scene) {
    this.mat.uniforms.uNear.value = this.camera.near;
    this.mat.uniforms.uFar.value = this.camera.far;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.cam);
  }
}
