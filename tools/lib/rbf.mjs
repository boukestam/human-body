// Smooth 3D space warp from landmark pairs: polyharmonic RBF (phi(r) = r)
// with an affine term, sampled on a regular grid and interpolated trilinearly.

function solve(A, B, n, m) {
  // In-place LU with partial pivoting; A is n×n row-major, B is n×m.
  for (let k = 0; k < n; k++) {
    let p = k, max = Math.abs(A[k * n + k]);
    for (let i = k + 1; i < n; i++) { const v = Math.abs(A[i * n + k]); if (v > max) { max = v; p = i; } }
    if (p !== k) {
      for (let j = 0; j < n; j++) { const t = A[k * n + j]; A[k * n + j] = A[p * n + j]; A[p * n + j] = t; }
      for (let j = 0; j < m; j++) { const t = B[k * m + j]; B[k * m + j] = B[p * m + j]; B[p * m + j] = t; }
    }
    const piv = A[k * n + k] || 1e-12;
    for (let i = k + 1; i < n; i++) {
      const f = A[i * n + k] / piv;
      if (!f) continue;
      const ri = i * n, rk = k * n;
      for (let j = k; j < n; j++) A[ri + j] -= f * A[rk + j];
      for (let j = 0; j < m; j++) B[i * m + j] -= f * B[k * m + j];
    }
  }
  const X = new Float64Array(n * m);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = 0; j < m; j++) {
      let s = B[i * m + j];
      for (let k = i + 1; k < n; k++) s -= A[i * n + k] * X[k * m + j];
      X[i * m + j] = s / (A[i * n + i] || 1e-12);
    }
  }
  return X;
}

// src, dst: arrays of {x,y,z}. Returns f(x,y,z) -> [x,y,z].
export function fitRBF(src, dst, lambda = 0) {
  const N = src.length;
  const n = N + 4;
  const A = new Float64Array(n * n);
  const B = new Float64Array(n * 3);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const dx = src[i].x - src[j].x, dy = src[i].y - src[j].y, dz = src[i].z - src[j].z;
      A[i * n + j] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    A[i * n + i] += lambda;
    const P = [1, src[i].x, src[i].y, src[i].z];
    for (let k = 0; k < 4; k++) { A[i * n + N + k] = P[k]; A[(N + k) * n + i] = P[k]; }
    B[i * 3] = dst[i].x - src[i].x;
    B[i * 3 + 1] = dst[i].y - src[i].y;
    B[i * 3 + 2] = dst[i].z - src[i].z;
  }
  const W = solve(A, B, n, 3);
  const cx = Float64Array.from(src, (p) => p.x), cy = Float64Array.from(src, (p) => p.y), cz = Float64Array.from(src, (p) => p.z);
  return (x, y, z) => {
    let ox = W[N * 3] + W[(N + 1) * 3] * x + W[(N + 2) * 3] * y + W[(N + 3) * 3] * z;
    let oy = W[N * 3 + 1] + W[(N + 1) * 3 + 1] * x + W[(N + 2) * 3 + 1] * y + W[(N + 3) * 3 + 1] * z;
    let oz = W[N * 3 + 2] + W[(N + 1) * 3 + 2] * x + W[(N + 2) * 3 + 2] * y + W[(N + 3) * 3 + 2] * z;
    for (let i = 0; i < N; i++) {
      const dx = x - cx[i], dy = y - cy[i], dz = z - cz[i];
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      ox += W[i * 3] * r; oy += W[i * 3 + 1] * r; oz += W[i * 3 + 2] * r;
    }
    return [x + ox, y + oy, z + oz];
  };
}

// Bakes a warp into a displacement grid for fast evaluation.
export function gridWarp(fn, min, max, step) {
  const nx = Math.ceil((max.x - min.x) / step) + 1;
  const ny = Math.ceil((max.y - min.y) / step) + 1;
  const nz = Math.ceil((max.z - min.z) / step) + 1;
  const g = new Float32Array(nx * ny * nz * 3);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = min.x + i * step, y = min.y + j * step, z = min.z + k * step;
    const [wx, wy, wz] = fn(x, y, z);
    const o = ((k * ny + j) * nx + i) * 3;
    g[o] = wx - x; g[o + 1] = wy - y; g[o + 2] = wz - z;
  }
  const clamp = (v, n) => Math.min(Math.max(v, 0), n - 1.0001);
  const apply = (x, y, z) => {
    const fx = clamp((x - min.x) / step, nx), fy = clamp((y - min.y) / step, ny), fz = clamp((z - min.z) / step, nz);
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    const u = fx - i, v = fy - j, w = fz - k;
    const out = [x, y, z];
    for (let c = 0; c < 3; c++) {
      const at = (a, b, d) => g[(((k + d) * ny + (j + b)) * nx + (i + a)) * 3 + c];
      const c00 = at(0, 0, 0) * (1 - u) + at(1, 0, 0) * u;
      const c10 = at(0, 1, 0) * (1 - u) + at(1, 1, 0) * u;
      const c01 = at(0, 0, 1) * (1 - u) + at(1, 0, 1) * u;
      const c11 = at(0, 1, 1) * (1 - u) + at(1, 1, 1) * u;
      out[c] += (c00 * (1 - v) + c10 * v) * (1 - w) + (c01 * (1 - v) + c11 * v) * w;
    }
    return out;
  };
  return { apply, grid: g, dims: [nx, ny, nz], min, step };
}

export function applyToArray(warp, arr) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i += 3) {
    const [x, y, z] = warp.apply(arr[i], arr[i + 1], arr[i + 2]);
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
  }
  return out;
}

// Farthest-point subsampling of landmark pairs.
export function subsample(pairs, max) {
  if (pairs.length <= max) return pairs;
  const chosen = [0];
  const d = new Float64Array(pairs.length).fill(Infinity);
  for (let k = 1; k < max; k++) {
    const last = pairs[chosen[chosen.length - 1]].src;
    let best = -1, bi = 0;
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i].src;
      const dd = (p.x - last.x) ** 2 + (p.y - last.y) ** 2 + (p.z - last.z) ** 2;
      if (dd < d[i]) d[i] = dd;
      if (d[i] > best) { best = d[i]; bi = i; }
    }
    chosen.push(bi);
  }
  return chosen.map((i) => pairs[i]);
}
