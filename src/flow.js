// Path distances for the animations: for every vertex of a layer mesh, the
// distance travelled along the structure from its source (the heart for blood
// vessels, the brain and spinal cord for nerves, the mouth for the gut).
// Output per vertex: [distance in cm, phase]; phase < 0 marks vertices that are
// not animated. Runs in a worker; positions are in world space.

class Heap {
  constructor(n) { this.k = new Float64Array(n); this.v = new Int32Array(n); this.n = 0; }
  push(key, val) {
    if (this.n === this.k.length) {
      const k = new Float64Array(this.n * 2); k.set(this.k); this.k = k;
      const v = new Int32Array(this.n * 2); v.set(this.v); this.v = v;
    }
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= key) break;
      this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p;
    }
    this.k[i] = key; this.v[i] = val;
  }
  pop() {
    const top = this.v[0];
    const key = this.k[--this.n], val = this.v[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && this.k[c + 1] < this.k[c]) c++;
      if (this.k[c] >= key) break;
      this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c;
    }
    this.k[i] = key; this.v[i] = val;
    return top;
  }
}

// Spatial hash over a subset of points (open addressing, typed arrays).
class Grid {
  constructor(P, ids, cell) {
    this.P = P; this.cell = cell;
    const m = ids.length;
    let size = 16;
    while (size < m * 2) size <<= 1;
    this.mask = size - 1;
    this.cx = new Int32Array(size); this.cy = new Int32Array(size); this.cz = new Int32Array(size);
    this.used = new Uint8Array(size);
    this.head = new Int32Array(size).fill(-1);
    this.next = new Int32Array(m);
    this.items = Int32Array.from(ids);
    for (let t = 0; t < m; t++) {
      const i = this.items[t];
      const s = this.slot(Math.floor(P[i * 3] / cell), Math.floor(P[i * 3 + 1] / cell), Math.floor(P[i * 3 + 2] / cell), true);
      this.next[t] = this.head[s];
      this.head[s] = t;
    }
  }
  slot(x, y, z, create) {
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & this.mask;
    for (;;) {
      if (!this.used[h]) {
        if (!create) return -1;
        this.used[h] = 1; this.cx[h] = x; this.cy[h] = y; this.cz[h] = z;
        return h;
      }
      if (this.cx[h] === x && this.cy[h] === y && this.cz[h] === z) return h;
      h = (h + 1) & this.mask;
    }
  }
  // Nearest point within maxR (or -1), skipping points rejected by filter.
  nearest(x, y, z, maxR, filter) {
    const c = this.cell, r = Math.ceil(maxR / c);
    const cx = Math.floor(x / c), cy = Math.floor(y / c), cz = Math.floor(z / c);
    const P = this.P, items = this.items, next = this.next;
    let best = -1, bd = maxR * maxR;
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
      const s = this.slot(cx + i, cy + j, cz + k, false);
      if (s < 0) continue;
      for (let t = this.head[s]; t >= 0; t = next[t]) {
        const q = items[t];
        const dx = P[q * 3] - x, dy = P[q * 3 + 1] - y, dz = P[q * 3 + 2] - z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd && (!filter || filter(q))) { bd = d; best = q; }
      }
    }
    return best;
  }
}

function bounds(P, ids) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const i of ids) for (let k = 0; k < 3; k++) { const v = P[i * 3 + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  return [lo, hi];
}

// Nearest source point for any query point, approximately: a voxel grid over
// the given bounds stores the nearest source of each cell, propagated outwards.
function nearestField(S, sIds, box, cell) {
  const lo = box[0].map((v) => v - 2 * cell), hi = box[1].map((v) => v + 2 * cell);
  const dim = lo.map((v, k) => Math.max(1, Math.ceil((hi[k] - v) / cell)));
  const N = dim[0] * dim[1] * dim[2];
  const near = new Int32Array(N).fill(-1);
  const best = new Float64Array(N).fill(Infinity);
  const clampCell = (v, k) => Math.min(dim[k] - 1, Math.max(0, Math.floor((v - lo[k]) / cell)));
  const cellOf = (x, y, z) => clampCell(x, 0) + dim[0] * (clampCell(y, 1) + dim[1] * clampCell(z, 2));
  const heap = new Heap(1024);
  const centreDist = (s, X, Y, Z) => Math.hypot(S[s * 3] - (lo[0] + (X + 0.5) * cell), S[s * 3 + 1] - (lo[1] + (Y + 0.5) * cell), S[s * 3 + 2] - (lo[2] + (Z + 0.5) * cell));
  for (const s of sIds) {
    const c = cellOf(S[s * 3], S[s * 3 + 1], S[s * 3 + 2]);
    const X = c % dim[0], Y = Math.floor(c / dim[0]) % dim[1], Z = Math.floor(c / (dim[0] * dim[1]));
    const d = centreDist(s, X, Y, Z);
    if (d < best[c]) { best[c] = d; near[c] = s; heap.push(d, c); }
  }
  while (heap.n) {
    const c = heap.pop();
    const X = c % dim[0], Y = Math.floor(c / dim[0]) % dim[1], Z = Math.floor(c / (dim[0] * dim[1]));
    const s = near[c];
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = X + dx, y = Y + dy, z = Z + dz;
      if (x < 0 || y < 0 || z < 0 || x >= dim[0] || y >= dim[1] || z >= dim[2]) continue;
      const nc = x + dim[0] * (y + dim[1] * z);
      const d = centreDist(s, x, y, z);
      if (d < best[nc] - 1e-9) { best[nc] = d; near[nc] = s; heap.push(d, nc); }
    }
  }
  return (x, y, z) => near[cellOf(x, y, z)];
}

const dist3 = (P, a, b) => {
  const x = P[a * 3] - P[b * 3], y = P[a * 3 + 1] - P[b * 3 + 1], z = P[a * 3 + 2] - P[b * 3 + 2];
  return Math.sqrt(x * x + y * y + z * z);
};

// Mesh edges of the selected vertices plus extra edges, as an adjacency list (CSR).
function buildGraph(n, index, active, extra) {
  const deg = new Int32Array(n);
  for (let t = 0; t < index.length; t += 3) {
    if (!active[index[t]]) continue;
    deg[index[t]] += 2; deg[index[t + 1]] += 2; deg[index[t + 2]] += 2;
  }
  for (let i = 0; i < extra.length; i++) deg[extra[i]]++;
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + deg[i];
  const fill = start.slice(0, n);
  const adj = new Int32Array(start[n]);
  const add = (a, b) => { adj[fill[a]++] = b; adj[fill[b]++] = a; };
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    if (!active[a]) continue;
    add(a, b); add(b, c); add(c, a);
  }
  for (let i = 0; i < extra.length; i += 2) add(extra[i], extra[i + 1]);
  return { start, adj };
}

// Shortest paths over the graph, optionally limited to vertices with allow[v].
function dijkstra(P, g, dist, seeds, allow) {
  const heap = new Heap(1024);
  for (const [v, d] of seeds) if (d < dist[v]) { dist[v] = d; heap.push(d, v); }
  while (heap.n) {
    const u = heap.pop();
    const du = dist[u];
    for (let e = g.start[u]; e < g.start[u + 1]; e++) {
      const w = g.adj[e];
      if (allow && !allow[w]) continue;
      const nd = du + dist3(P, u, w);
      if (nd < dist[w]) { dist[w] = nd; heap.push(nd, w); }
    }
  }
}

// Joins coincident vertices (seams) and, when bridge > 0, touching parts.
function contactEdges(P, ids, partOf, bridge) {
  const weld = 0.02, r = Math.max(weld, bridge);
  const grid = new Grid(P, ids, r);
  const { items, next, head } = grid;
  const out = [];
  for (const i of ids) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], pi = partOf[i];
    const cx = Math.floor(x / r), cy = Math.floor(y / r), cz = Math.floor(z / r);
    let same = -1, sd = weld * weld, other = -1, od = bridge * bridge;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const s = grid.slot(cx + a, cy + b, cz + c, false);
      if (s < 0) continue;
      for (let t = head[s]; t >= 0; t = next[t]) {
        const q = items[t];
        const dx = P[q * 3] - x, dy = P[q * 3 + 1] - y, dz = P[q * 3 + 2] - z;
        const d = dx * dx + dy * dy + dz * dz;
        if (partOf[q] === pi) { if (q > i && d < sd) { sd = d; same = q; } }
        else if (d < od) { od = d; other = q; }
      }
    }
    if (same >= 0) out.push(i, same);
    if (other >= 0) out.push(i, other);
  }
  return out;
}

function hash01(n) {
  let h = Math.imul(n, 2654435761) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// Branching networks (vessels, nerves): each connected piece starts at its
// vertex closest to the source and shares one random phase.
function treeFlow(P, index, partOf, ids, cfg) {
  const n = P.length / 3;
  const active = new Uint8Array(n);
  for (const i of ids) active[i] = 1;
  const g = buildGraph(n, index, active, contactEdges(P, ids, partOf, cfg.bridge));
  let toSource;
  if (cfg.sourcePoint) {
    const [sx, sy, sz] = cfg.sourcePoint;
    toSource = (i) => Math.hypot(P[i * 3] - sx, P[i * 3 + 1] - sy, P[i * 3 + 2] - sz);
  } else {
    const S = cfg.sourcePoints;
    const sIds = Array.from({ length: S.length / 3 }, (_, i) => i);
    const [blo, bhi] = bounds(P, ids);
    const [slo, shi] = bounds(S, sIds);
    const box = [blo.map((v, k) => Math.min(v, slo[k])), bhi.map((v, k) => Math.max(v, shi[k]))];
    const field = nearestField(S, sIds, box, 2);
    toSource = (i) => {
      const s = field(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      return Math.hypot(S[s * 3] - P[i * 3], S[s * 3 + 1] - P[i * 3 + 1], S[s * 3 + 2] - P[i * 3 + 2]);
    };
  }
  const comp = new Int32Array(n).fill(-1);
  const dist = new Float64Array(n).fill(Infinity);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) out[i * 2 + 1] = -1;
  let nc = 0;
  const stack = [];
  for (const s of ids) {
    if (comp[s] >= 0) continue;
    let bd = Infinity;
    comp[s] = nc; stack.push(s);
    const members = [], md = [];
    while (stack.length) {
      const u = stack.pop();
      members.push(u);
      const d = toSource(u);
      md.push(d);
      if (d < bd) bd = d;
      for (let e = g.start[u]; e < g.start[u + 1]; e++) {
        const w = g.adj[e];
        if (comp[w] < 0 && active[w]) { comp[w] = nc; stack.push(w); }
      }
    }
    // Enter wherever the piece touches the source (or at its closest point).
    const limit = Math.max(bd + 0.5, cfg.touch || 0);
    const seeds = [];
    for (let k = 0; k < members.length; k++) if (md[k] <= limit) seeds.push([members[k], md[k]]);
    dijkstra(P, g, dist, seeds);
    const phase = hash01(nc + 1);
    for (const u of members) { out[u * 2] = dist[u]; out[u * 2 + 1] = phase; }
    nc++;
  }
  return out;
}

// A tube made of consecutive parts (the gut): each part continues from where
// the previous one ends. Followers take the value of the nearest tube vertex.
function sequenceFlow(P, index, partOf, verts, cfg) {
  const n = P.length / 3;
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) out[i * 2 + 1] = -1;
  const dist = new Float64Array(n).fill(Infinity);
  const steps = cfg.steps.map((pids) => pids.flatMap((p) => verts[p] || [])).filter((a) => a.length);
  const all = steps.flat();
  const active = new Uint8Array(n);
  for (const i of all) active[i] = 1;
  const g = buildGraph(n, index, active, contactEdges(P, all, partOf, 0));
  let prev = null;
  for (const ids of steps) {
    const seeds = [];
    if (!prev) {
      let top = -Infinity;
      for (const i of ids) top = Math.max(top, P[i * 3 + 1]);
      for (const i of ids) if (P[i * 3 + 1] > top - 1) seeds.push([i, top - P[i * 3 + 1]]);
    } else {
      // Enter where this part comes closest to the previous one.
      const [alo, ahi] = bounds(P, ids), [blo, bhi] = bounds(P, prev);
      const box = [alo.map((v, k) => Math.min(v, blo[k])), ahi.map((v, k) => Math.max(v, bhi[k]))];
      const field = nearestField(P, prev, box, 0.75);
      const near = [];
      let minD = Infinity;
      for (const i of ids) {
        const q = field(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        const d = dist3(P, i, q);
        near.push([i, q, d]);
        if (d < minD) minD = d;
      }
      // Of the places where the parts touch, the junction is the one furthest
      // along the previous part (coiled loops touch in many places).
      let far = -Infinity;
      for (const [, q, d] of near) if (d < minD + 0.8 && dist[q] > far) far = dist[q];
      for (const [i, q, d] of near) if (d < minD + 0.8 && dist[q] > far - 3) seeds.push([i, dist[q] + d]);
    }
    // Limited to this part so that touching loops are not short-cut.
    const own = new Uint8Array(n);
    for (const i of ids) own[i] = 1;
    dijkstra(P, g, dist, seeds, own);
    const done = ids.filter((i) => dist[i] < Infinity);
    for (const i of done) { out[i * 2] = dist[i]; out[i * 2 + 1] = 0; }
    if (done.length) prev = done;
  }
  // Attached structures move with the nearest vertex of the parts they lie on.
  for (const [pids, onto] of cfg.followers) {
    const followers = pids.flatMap((p) => verts[p] || []);
    const tube = onto.flatMap((p) => verts[p] || []).filter((i) => dist[i] < Infinity);
    if (!followers.length || !tube.length) continue;
    const grid = new Grid(P, tube, 1);
    for (const i of followers) {
      const q = grid.nearest(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], 3);
      if (q >= 0) { out[i * 2] = dist[q]; out[i * 2 + 1] = 0; }
    }
  }
  return out;
}

// positions: world-space Float32Array; parts: [partId, vStart, vCount, ...] rows.
export function computeFlow({ positions, index, parts, config }) {
  const n = positions.length / 3;
  const partOf = new Int32Array(n).fill(-1);
  const verts = {};
  for (const [pid, v0, vc] of parts) {
    const a = new Array(vc);
    for (let k = 0; k < vc; k++) { a[k] = v0 + k; partOf[v0 + k] = pid; }
    verts[pid] = a;
  }
  if (config.type === 'sequence') return sequenceFlow(positions, index, partOf, verts, config);
  const ids = config.parts.flatMap((p) => verts[p] || []);
  return treeFlow(positions, index, partOf, ids, config);
}
