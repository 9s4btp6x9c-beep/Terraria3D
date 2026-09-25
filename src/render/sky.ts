// Sky dome gradient and chunky low-poly clouds.

import * as THREE from 'three';
import { mulberry32 } from '../core/noise';

export class Sky {
  readonly group = new THREE.Group();
  private dome: THREE.Mesh;
  private clouds: THREE.InstancedMesh;
  private cloudData: { x: number; y: number; z: number; s: number; r: number }[] = [];
  readonly uniforms = {
    uTop: { value: new THREE.Color(0x3f63c8) },
    uHorizon: { value: new THREE.Color(0xa9c6ee) },
    uBottom: { value: new THREE.Color(0x8aa4cc) },
  };

  constructor(seed: number, private center: THREE.Vector3) {
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.uniforms,
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
        fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; varying vec3 vDir;
          void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.6)) : mix(uHorizon, uBottom, min(1.0, -h * 4.0));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
          }`,
      }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // Clouds: each is a cluster of flattened, jittered icosahedra merged into one geometry.
    const rand = mulberry32(seed ^ 0xc10d);
    const puff = new THREE.IcosahedronGeometry(1, 0);
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const g = puff.clone();
      const s = 0.6 + rand() * 0.6;
      g.scale(s * 1.4, s * 0.55, s);
      g.translate((i - 2.5) * 0.9 + rand() * 0.4, rand() * 0.25, (rand() - 0.5) * 0.9);
      parts.push(g);
    }
    const cloudGeo = mergeNonIndexed(parts);
    cloudGeo.computeVertexNormals();
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8090b0, flatShading: true, fog: false });
    const count = 48;
    this.clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, count);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2, d = 120 + rand() * 480;
      this.cloudData.push({ x: Math.cos(a) * d, y: 170 + rand() * 90, z: Math.sin(a) * d, s: 6 + rand() * 10, r: rand() * Math.PI });
    }
    this.clouds.frustumCulled = false;
    this.group.add(this.clouds);
    this.update(0);
  }

  update(time: number) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    this.cloudData.forEach((c, i) => {
      let x = c.x + time * 1.5;
      x = ((x + 600) % 1200 + 1200) % 1200 - 600;
      p.set(this.center.x + x, c.y, this.center.z + c.z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.r);
      s.setScalar(c.s);
      m.compose(p, q, s);
      this.clouds.setMatrixAt(i, m);
    });
    this.clouds.instanceMatrix.needsUpdate = true;
  }

  follow(camera: THREE.Camera) {
    this.dome.position.copy(camera.position);
  }
}

/** Merge geometries into one non-indexed geometry (position + normal + any shared attributes). */
export function mergeNonIndexed(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = geos.map(g => (g.index ? g.toNonIndexed() : g));
  const names = Object.keys(list[0].attributes).filter(n => list.every(g => g.attributes[n]));
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const itemSize = list[0].attributes[name].itemSize;
    const total = list.reduce((n, g) => n + g.attributes[name].count * itemSize, 0);
    const arr = new Float32Array(total);
    let o = 0;
    for (const g of list) {
      const a = g.attributes[name];
      for (let i = 0; i < a.count; i++)
        for (let k = 0; k < itemSize; k++) arr[o++] = a.getComponent(i, k);
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
  }
  return out;
}
