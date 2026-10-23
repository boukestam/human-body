// Corresponding landmarks between two bodies (source = Z-Anatomy male, target =
// HRA female) used to build the space warp. Skin correspondences are found by
// casting rays at matching normalised heights / angles around body parts.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export function soupToBVH(soups) {
  let n = 0;
  for (const s of soups) n += s.length;
  const pos = new Float32Array(n);
  let o = 0;
  for (const s of soups) { pos.set(s, o); o += s.length; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const bvh = new MeshBVH(geo, { maxLeafSize: 8 });
  return { geo, bvh, pos };
}

export function indexedToSoup(positions, indices) {
  const out = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i] * 3;
    out[i * 3] = positions[v]; out[i * 3 + 1] = positions[v + 1]; out[i * 3 + 2] = positions[v + 2];
  }
  return out;
}

const ray = new THREE.Ray();
const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

// First surface hit along a ray (null if none within maxDist).
export function cast(mesh, origin, dir, maxDist = 80) {
  ray.origin.copy(origin);
  ray.direction.copy(dir).normalize();
  const hit = mesh.bvh.raycastFirst(ray, material, 0, maxDist);
  return hit ? hit.point.clone() : null;
}

export function bbox(points) {
  const b = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < points.length; i += 3) b.expandByPoint(v.set(points[i], points[i + 1], points[i + 2]));
  return b;
}

// Points of a soup lying in a horizontal band.
export function band(points, y0, y1, filter = () => true) {
  const out = [];
  for (let i = 0; i < points.length; i += 3) {
    const y = points[i + 1];
    if (y >= y0 && y < y1 && filter(points[i], y, points[i + 2])) out.push(points[i], y, points[i + 2]);
  }
  return out;
}

export function centroid(points) {
  const c = new THREE.Vector3();
  const n = points.length / 3;
  for (let i = 0; i < points.length; i += 3) { c.x += points[i]; c.y += points[i + 1]; c.z += points[i + 2]; }
  return n ? c.multiplyScalar(1 / n) : c;
}

// Extremal points of a point set along a fixed set of directions.
const DIRS = [];
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) DIRS.push(new THREE.Vector3(x, y, z).normalize());
export function extremes(points) {
  const out = [];
  for (const d of DIRS) {
    let best = -Infinity, bi = 0;
    for (let i = 0; i < points.length; i += 3) {
      const s = points[i] * d.x + points[i + 1] * d.y + points[i + 2] * d.z;
      if (s > best) { best = s; bi = i; }
    }
    out.push(new THREE.Vector3(points[bi], points[bi + 1], points[bi + 2]));
  }
  return out;
}

// Principal axis of a point cloud.
export function principalAxis(pts) {
  const c = new THREE.Vector3();
  for (const p of pts) c.add(p);
  c.multiplyScalar(1 / pts.length);
  // power iteration on the covariance matrix
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i * 3 + j] += d[i] * d[j];
  }
  let v = new THREE.Vector3(0, -1, 0);
  for (let k = 0; k < 50; k++) {
    v = new THREE.Vector3(
      cov[0] * v.x + cov[1] * v.y + cov[2] * v.z,
      cov[3] * v.x + cov[4] * v.y + cov[5] * v.z,
      cov[6] * v.x + cov[7] * v.y + cov[8] * v.z,
    ).normalize();
  }
  if (v.y > 0) v.negate();
  return { center: c, dir: v };
}

// Arm skin points: points beyond the gap separating the arm from the torso.
export function armCentroids(skinPts, side, yFrom, yTo, step = 1.5) {
  const out = [];
  for (let y = yFrom; y < yTo; y += step) {
    const xs = [];
    for (let i = 0; i < skinPts.length; i += 3) {
      const py = skinPts[i + 1];
      if (py < y || py >= y + step) continue;
      const x = skinPts[i] * side;
      if (x > 4) xs.push([x, i]);
    }
    if (xs.length < 10) continue;
    xs.sort((a, b) => a[0] - b[0]);
    let gapAt = -1, gap = 0;
    for (let k = 1; k < xs.length; k++) {
      const g = xs[k][0] - xs[k - 1][0];
      if (g > gap) { gap = g; gapAt = k; }
    }
    if (gap < 1.2 || gapAt < 0) continue;
    const arm = xs.slice(gapAt);
    if (arm.length < 6) continue;
    const c = new THREE.Vector3();
    for (const [, i] of arm) c.add(new THREE.Vector3(skinPts[i], skinPts[i + 1], skinPts[i + 2]));
    out.push(c.multiplyScalar(1 / arm.length));
  }
  return out;
}

// A unit vector perpendicular to `axis`, preferring `hint`.
export function perpendicular(axis, hint) {
  return hint.clone().sub(axis.clone().multiplyScalar(hint.dot(axis))).normalize();
}
