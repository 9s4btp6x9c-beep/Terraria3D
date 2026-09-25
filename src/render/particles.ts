// Pooled debris/spark particles in a single InstancedMesh. Chunky tumbling
// low-poly bits with gravity and bounce — one draw call for all of them.

import * as THREE from 'three';

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number;
  spin: number;
  gravity: number;
}

const POOL = 600;

export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private ps: P[] = [];
  private free: number[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(private groundTest: (x: number, y: number, z: number) => boolean) {
    const geo = new THREE.OctahedronGeometry(1, 0);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: false, fog: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, POOL);
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3);
    for (let i = 0; i < POOL; i++) {
      this.ps.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0, spin: 0, gravity: 0 });
      this.free.push(i);
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
  }

  /** Burst of debris at a point, flying mostly along the normal. */
  burst(x: number, y: number, z: number, nx: number, ny: number, nz: number, color: number, count: number, opts: { speed?: number; size?: number; gravity?: number; life?: number } = {}) {
    const speed = opts.speed ?? 4, size = opts.size ?? 0.09;
    for (let k = 0; k < count; k++) {
      const i = this.free.pop();
      if (i === undefined) return;
      const p = this.ps[i];
      p.x = x; p.y = y; p.z = z;
      const rx = Math.random() - 0.5, ry = Math.random() - 0.5, rz = Math.random() - 0.5;
      const sp = speed * (0.4 + Math.random() * 0.8);
      p.vx = (nx + rx * 1.4) * sp; p.vy = (ny + ry * 1.4 + 0.5) * sp; p.vz = (nz + rz * 1.4) * sp;
      p.max = p.life = (opts.life ?? 0.9) * (0.6 + Math.random() * 0.8);
      p.size = size * (0.5 + Math.random());
      p.spin = (Math.random() - 0.5) * 20;
      p.gravity = opts.gravity ?? 18;
      const shade = 0.75 + Math.random() * 0.4;
      this.c.setHex(color).multiplyScalar(shade);
      this.mesh.setColorAt(i, this.c);
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number, brightness: number) {
    let any = false;
    for (let i = 0; i < POOL; i++) {
      const p = this.ps[i];
      if (p.life <= 0) continue;
      any = true;
      p.life -= dt;
      if (p.life <= 0) {
        this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        this.free.push(i);
        continue;
      }
      p.vy -= p.gravity * dt;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      if (p.gravity > 0 && this.groundTest(nx, ny, nz)) {
        p.vy = Math.abs(p.vy) * 0.3; p.vx *= 0.5; p.vz *= 0.5; p.spin *= 0.5;
      } else { p.x = nx; p.y = ny; p.z = nz; }
      const t = p.life / p.max;
      const sc = p.size * Math.min(1, t * 3);
      this.e.set(p.life * p.spin, p.life * p.spin * 0.7, 0);
      this.q.setFromEuler(this.e);
      this.mesh.setMatrixAt(i, this.m.compose(this.p.set(p.x, p.y, p.z), this.q, this.s.setScalar(sc)));
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).color.setScalar(0.35 + brightness * 0.65);
  }
}
