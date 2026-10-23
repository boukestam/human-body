// Mesh processing helpers: welding, simplification, normals and per-structure
// statistics used by the X-ray renderer.
import { MeshoptSimplifier } from 'meshoptimizer';

export const ready = MeshoptSimplifier.ready;

// Merges bit-identical vertices of a triangle soup.
export function weld(soup) {
  const map = new Map();
  const pos = [];
  const idx = new Uint32Array(soup.length / 3);
  const f = new Float32Array(3);
  const u = new Uint32Array(f.buffer);
  for (let i = 0; i < idx.length; i++) {
    f[0] = soup[i * 3]; f[1] = soup[i * 3 + 1]; f[2] = soup[i * 3 + 2];
    const key = `${u[0]},${u[1]},${u[2]}`;
    let id = map.get(key);
    if (id === undefined) {
      id = pos.length / 3;
      map.set(key, id);
      pos.push(f[0], f[1], f[2]);
    }
    idx[i] = id;
  }
  // Drop degenerate triangles.
  const out = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(out) };
}

export function fromIndexed(positions, indices) {
  // Re-weld indexed input too (some sources duplicate seam vertices).
  const soup = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) soup.set(positions.subarray(indices[i] * 3, indices[i] * 3 + 3), i * 3);
  return weld(soup);
}

export function simplify(mesh, ratio, error, maxTris = Infinity) {
  const tris = mesh.indices.length / 3;
  const target = Math.max(4, Math.min(Math.floor(tris * ratio), maxTris));
  if (ratio >= 1 && tris <= maxTris) return mesh;
  const [idx] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, target * 3, error, ['LockBorder']);
  return compact({ positions: mesh.positions, indices: idx });
}

export function compact(mesh) {
  const remap = new Int32Array(mesh.positions.length / 3).fill(-1);
  const pos = [];
  const idx = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < idx.length; i++) {
    const v = mesh.indices[i];
    if (remap[v] < 0) { remap[v] = pos.length / 3; pos.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]); }
    idx[i] = remap[v];
  }
  return { positions: new Float32Array(pos), indices: idx };
}

export function computeNormals(mesh) {
  const p = mesh.positions, idx = mesh.indices;
  const n = new Float32Array(p.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) { n[v] += nx; n[v + 1] += ny; n[v + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

export function bounds(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
    if (positions[i + k] < min[k]) min[k] = positions[i + k];
    if (positions[i + k] > max[k]) max[k] = positions[i + k];
  }
  return { min, max };
}

// X-ray metadata for a structure: watertightness (fraction of border edges
// across all its parts, joined by position), winding sign and dominant tissue.
export function structureStats(parts) {
  const ids = new Map();
  const edges = new Map();
  let cx = 0, cy = 0, cz = 0, nv = 0, best = 0, dominant = null;
  for (const { tissue, mesh } of parts) {
    const pos = mesh.positions, idx = mesh.indices;
    const vid = new Int32Array(pos.length / 3);
    for (let i = 0; i < vid.length; i++) {
      const key = `${pos[i * 3].toFixed(3)},${pos[i * 3 + 1].toFixed(3)},${pos[i * 3 + 2].toFixed(3)}`;
      let id = ids.get(key);
      if (id === undefined) ids.set(key, (id = ids.size));
      vid[i] = id;
      cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2]; nv++;
    }
    for (let i = 0; i < idx.length; i += 3) for (let k = 0; k < 3; k++) {
      const a = vid[idx[i + k]], b = vid[idx[i + ((k + 1) % 3)]];
      const key = a < b ? a * 4194304 + b : b * 4194304 + a;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
    if (idx.length > best) { best = idx.length; dominant = tissue; }
  }
  let border = 0;
  for (const c of edges.values()) if (c === 1) border++;
  cx /= nv; cy /= nv; cz /= nv;
  let vol = 0;
  for (const { mesh } of parts) {
    const p = mesh.positions, idx = mesh.indices;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ax = p[a] - cx, ay = p[a + 1] - cy, az = p[a + 2] - cz;
      const bx = p[b] - cx, by = p[b + 1] - cy, bz = p[b + 2] - cz;
      const qx = p[c] - cx, qy = p[c + 1] - cy, qz = p[c + 2] - cz;
      vol += ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
    }
  }
  let sign = vol < 0 ? -1 : 1;
  // Skin patches: the outer surface must face away from the deep surface.
  const outer = parts.find((p) => p.tissue === 'skin');
  const inner = parts.find((p) => p.tissue === 'skinInner');
  if (outer && inner) {
    let ix = 0, iy = 0, iz = 0;
    const ip = inner.mesh.positions;
    for (let i = 0; i < ip.length; i += 3) { ix += ip[i]; iy += ip[i + 1]; iz += ip[i + 2]; }
    const n = ip.length / 3;
    ix /= n; iy /= n; iz /= n;
    const op = outer.mesh.positions, on = computeNormals(outer.mesh);
    let dot = 0;
    for (let i = 0; i < op.length; i += 3) dot += on[i] * (op[i] - ix) + on[i + 1] * (op[i + 1] - iy) + on[i + 2] * (op[i + 2] - iz);
    sign = dot < 0 ? -1 : 1;
  }
  return { open: +(border / Math.max(1, edges.size)).toFixed(4), sign, dominant };
}
