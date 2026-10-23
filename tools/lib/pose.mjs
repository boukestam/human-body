// Rotates the male's arms about the shoulder joints (linear blend skinning).
// Per-point weights come from the labelled skin regions: points whose nearby
// skin belongs to the upper limb follow the arm, blended in below the shoulder.
import * as THREE from 'three';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

class PointGrid {
  constructor(points, labels, cell) {
    this.cell = cell;
    this.map = new Map();
    for (let i = 0; i < points.length / 3; i++) {
      const k = this.key(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
      let b = this.map.get(k);
      if (!b) this.map.set(k, (b = []));
      b.push(i);
    }
    this.points = points;
    this.labels = labels;
  }
  key(x, y, z) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  // Gaussian-weighted mean label within radius r (null if no samples).
  mean(x, y, z, r) {
    const c = this.cell, n = Math.ceil(r / c);
    const ix = Math.floor(x / c), iy = Math.floor(y / c), iz = Math.floor(z / c);
    let sw = 0, sl = 0;
    const s2 = (r * 0.5) ** 2;
    for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) for (let d = -n; d <= n; d++) {
      const bucket = this.map.get(`${ix + a},${iy + b},${iz + d}`);
      if (!bucket) continue;
      for (const i of bucket) {
        const dx = this.points[i * 3] - x, dy = this.points[i * 3 + 1] - y, dz = this.points[i * 3 + 2] - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r * r) continue;
        const w = Math.exp(-d2 / (2 * s2));
        sw += w;
        sl += w * this.labels[i];
      }
    }
    return sw > 0 ? sl / sw : null;
  }
}

export function buildArmRig(skinSamples, arms) {
  // skinSamples: { points: Float32Array, labels: Float32Array (1 = upper limb) }
  const grid = new PointGrid(skinSamples.points, skinSamples.labels, 3);
  const armness = (x, y, z) => {
    for (const r of [3, 6, 12, 24]) {
      const m = grid.mean(x, y, z, r);
      if (m !== null) return m;
    }
    return 0;
  };
  const tmp = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const ident = new THREE.Quaternion();
  return function pose(x, y, z) {
    let out = [x, y, z];
    for (const arm of arms) {
      if (x * arm.side <= 0) continue;
      const s = (x - arm.pivot.x) * arm.dir.x + (y - arm.pivot.y) * arm.dir.y + (z - arm.pivot.z) * arm.dir.z;
      const ramp = smoothstep(-5, 7, s);
      if (ramp <= 0) continue;
      const w = ramp * smoothstep(0.15, 0.85, armness(x, y, z));
      if (w <= 0.001) continue;
      q.slerpQuaternions(ident, arm.rotation, w);
      tmp.set(x - arm.pivot.x, y - arm.pivot.y, z - arm.pivot.z).applyQuaternion(q).add(arm.pivot);
      out = [tmp.x, tmp.y, tmp.z];
    }
    return out;
  };
}
