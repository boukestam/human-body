import * as THREE from 'three';
import { TISSUES } from './palette.js';
import { partAppearance } from './materials.js';

// Exact planar cross-sections of the visible meshes, drawn as a 2D atlas /
// CT / MRI-style image.

export const AXES = {
  // u: image right, v: image up (radiological display conventions)
  transverse: { normal: new THREE.Vector3(0, 1, 0), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1), label: 'Transverse (axial)' },
  coronal: { normal: new THREE.Vector3(0, 0, 1), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0), label: 'Coronal (frontal)' },
  sagittal: { normal: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 0, -1), v: new THREE.Vector3(0, 1, 0), label: 'Sagittal' },
};

// parts: visible parts with geometry ranges for `sex`; hullParts: skin parts
// always used for the body outline.
export function computeSection(parts, sex, axisKey, position, hullParts = []) {
  const set = new Set(parts);
  const all = [...parts, ...hullParts.filter((p) => !set.has(p))];
  const axis = AXES[axisKey];
  const n = axis.normal;
  const comp = n.x ? 'x' : n.y ? 'y' : 'z';
  const items = [];
  const solids = new Map();
  const skinChains = [];
  const skinParts = [];
  for (const part of all) {
    const tissue = part.tissue;
    if (tissue !== 'skin' && (tissue === 'skinInner' || tissue === 'hair' || !set.has(part))) continue;
    // Skin is cut a hair off the plane so mesh seams lying in it (the midline
    // of a symmetric body) do not break the outline.
    const loops = slicePart(part, sex, axis, comp, tissue === 'skin' ? position + 0.02 : position);
    if (tissue === 'skin') {
      skinParts.push(part);
      if (loops) for (const l of loops) skinChains.push(l);
      continue;
    }
    if (!loops) continue;
    if (SHEETS.has(tissue) || part.structure.layer === 'fasciae') {
      markOpen(loops);
      pushItem(items, part, loops);
      continue;
    }
    let list = solids.get(part.structure);
    if (!list) solids.set(part.structure, (list = []));
    list.push({ part, loops });
  }
  // A structure's surface can be split over several meshes (a skull bone and
  // its sutures), so the open pieces of all its parts are joined end to end
  // before what is left open is closed with a straight edge.
  for (const list of solids.values()) {
    const own = list.map(({ loops }) => loops.filter((l) => l.closed));
    const pool = [];
    list.forEach(({ loops }, k) => { for (const l of loops) if (!l.closed) pool.push({ pts: Array.from(l.pts), tag: k }); });
    // Sutures are thin strips along a bone's edges: a joined outline belongs to the bone.
    const weight = list.map(({ part }) => (part.tissue === 'suture' ? 0.05 : 1));
    for (const j of joinTagged(pool, 1, weight)) own[j.tag].push({ pts: new Float32Array(j.pts), closed: true });
    list.forEach(({ part }, k) => { if (own[k].length) pushItem(items, part, own[k]); });
  }
  if (skinChains.length) {
    let body = joinChains(skinChains);
    if (body.some((l) => l.gap > 1)) {
      // Patchy skin: also cut it just either side of the plane to bridge seams.
      const chains = [...skinChains];
      for (const dp of [-0.25, 0.25]) for (const part of skinParts) for (const l of slicePart(part, sex, axis, comp, position + dp) || []) chains.push(l);
      body = rasterBody(chains);
    }
    let area = 0;
    for (const l of body) area += Math.abs(polyArea(l.pts));
    items.push({ part: null, structure: null, tissue: 'body', loops: body, area: area * 1.0001, isBody: true });
  }
  items.sort((a, b) => b.area - a.area);
  return items;
}

// Cross-section loops of one part with the plane at `position` (null if none).
function slicePart(part, sex, axis, comp, position) {
  const r = part.ranges[sex];
  if (!r) return null;
  const off = part.structure.offset;
  if (r.box.min[comp] + off[comp] > position || r.box.max[comp] + off[comp] < position) return null;
  const U = axis.u, V = axis.v;
  const ci = comp === 'x' ? 0 : comp === 'y' ? 1 : 2;
  const { array: A, stride, start, scale, offset } = r.decode;
  const v0 = r.vStart, vc = r.vCount;
  // World positions of this part's vertices.
  const pos = new Float32Array(vc * 3);
  for (let i = 0; i < vc; i++) {
    const b = start + (v0 + i) * stride;
    pos[i * 3] = A[b] * scale[0] + offset[0] + off.x;
    pos[i * 3 + 1] = A[b + 1] * scale[1] + offset[1] + off.y;
    pos[i * 3 + 2] = A[b + 2] * scale[2] + offset[2] + off.z;
  }
  const d = new Float32Array(vc);
  for (let i = 0; i < vc; i++) d[i] = pos[i * 3 + ci] - position;
  const segA = [], segB = [], pts = [];
  const edgePoint = new Map();
  const pointFor = (a, b) => {
    const key = a < b ? a * vc + b : b * vc + a;
    let id = edgePoint.get(key);
    if (id !== undefined) return id;
    const t = d[a] / (d[a] - d[b]);
    const x = pos[a * 3] + (pos[b * 3] - pos[a * 3]) * t;
    const y = pos[a * 3 + 1] + (pos[b * 3 + 1] - pos[a * 3 + 1]) * t;
    const z = pos[a * 3 + 2] + (pos[b * 3 + 2] - pos[a * 3 + 2]) * t;
    id = pts.length / 2;
    pts.push(x * U.x + y * U.y + z * U.z, x * V.x + y * V.y + z * V.z);
    edgePoint.set(key, id);
    return id;
  };
  const index = r.index;
  for (let t = r.iStart; t < r.iStart + r.iCount; t += 3) {
    const a = index[t] - v0, b = index[t + 1] - v0, c = index[t + 2] - v0;
    const sa = d[a] >= 0, sb = d[b] >= 0, sc = d[c] >= 0;
    if (sa === sb && sb === sc) continue;
    let p, q;
    if (sa === sb) { p = pointFor(b, c); q = pointFor(c, a); }
    else if (sa === sc) { p = pointFor(a, b); q = pointFor(b, c); }
    else { p = pointFor(c, a); q = pointFor(a, b); }
    if (p !== q) { segA.push(p); segB.push(q); }
  }
  return segA.length ? chain(segA, segB, pts) : null;
}

function chain(segA, segB, pts) {
  const adj = new Map();
  const add = (k, s) => { const l = adj.get(k); if (l) l.push(s); else adj.set(k, [s]); };
  for (let i = 0; i < segA.length; i++) { add(segA[i], i); add(segB[i], i); }
  const used = new Uint8Array(segA.length);
  const loops = [];
  for (let s0 = 0; s0 < segA.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const seq = [segA[s0], segB[s0]];
    // extend forward
    for (let dir = 0; dir < 2; dir++) {
      for (;;) {
        const end = dir === 0 ? seq[seq.length - 1] : seq[0];
        const cand = adj.get(end);
        let next = -1;
        if (cand) for (const s of cand) if (!used[s]) { next = s; break; }
        if (next < 0) break;
        used[next] = 1;
        const other = segA[next] === end ? segB[next] : segA[next];
        if (dir === 0) seq.push(other); else seq.unshift(other);
        if (other === (dir === 0 ? seq[0] : seq[seq.length - 1])) break;
      }
    }
    const closed = seq[0] === seq[seq.length - 1];
    const out = new Float32Array(seq.length * 2);
    for (let i = 0; i < seq.length; i++) { out[i * 2] = pts[seq[i] * 2]; out[i * 2 + 1] = pts[seq[i] * 2 + 1]; }
    loops.push({ pts: out, closed });
  }
  return loops;
}

// Tissues modelled as thin sheets rather than closed volumes.
const SHEETS = new Set(['fascia', 'capsule', 'peritoneum']);

function pushItem(items, part, loops) {
  let area = 0;
  for (const l of loops) if (!l.open) area += Math.abs(polyArea(l.pts));
  items.push({ part, structure: part.structure, tissue: part.tissue, loops, area });
}

// Joins open chains (from several parts, each tagged) end to end; each result
// keeps the tag that contributed most of its (weighted) points.
function joinTagged(pool, tol, weight) {
  const out = [];
  while (pool.length) {
    const first = pool.pop();
    let cur = first.pts;
    const count = new Map([[first.tag, cur.length]]);
    for (;;) {
      const ex = cur[cur.length - 2], ey = cur[cur.length - 1];
      let best = -1, bestD = Math.min(tol * tol, (cur[0] - ex) ** 2 + (cur[1] - ey) ** 2), rev = false;
      for (let i = 0; i < pool.length; i++) {
        const c = pool[i].pts;
        const d0 = (c[0] - ex) ** 2 + (c[1] - ey) ** 2;
        const d1 = (c[c.length - 2] - ex) ** 2 + (c[c.length - 1] - ey) ** 2;
        if (d0 < bestD) { bestD = d0; best = i; rev = false; }
        if (d1 < bestD) { bestD = d1; best = i; rev = true; }
      }
      if (best < 0) break;
      const { pts, tag } = pool.splice(best, 1)[0];
      let c = pts;
      if (rev) { c = []; for (let i = pts.length - 2; i >= 0; i -= 2) c.push(pts[i], pts[i + 1]); }
      cur = cur.concat(c);
      count.set(tag, (count.get(tag) || 0) + c.length);
    }
    if (cur.length < 6) continue;
    let tag = first.tag, most = 0;
    for (const [t, n] of count) if (n * weight[t] > most) { most = n * weight[t]; tag = t; }
    out.push({ pts: cur, tag, gap: Math.hypot(cur[0] - cur[cur.length - 2], cur[1] - cur[cur.length - 1]) });
  }
  return out;
}

// Flags chains of sheet-like structures that are really open, as opposed to
// outlines with a small gap from an imperfect mesh.
function markOpen(loops) {
  for (const l of loops) {
    if (l.closed) continue;
    const a = l.pts, n = a.length;
    let len = 0;
    for (let i = 2; i < n; i += 2) len += Math.hypot(a[i] - a[i - 2], a[i + 1] - a[i - 1]);
    const gap = Math.hypot(a[n - 2] - a[0], a[n - 1] - a[1]);
    l.open = gap > Math.max(0.6, 0.12 * len);
  }
}

// Joins open boundary chains from separate skin patches into closed outlines.
function joinChains(chains, tol = 2.5) {
  const closed = chains.filter((c) => c.closed);
  const open = chains.filter((c) => !c.closed).map((c) => Array.from(c.pts));
  const result = closed.map((c) => ({ pts: c.pts, closed: true }));
  while (open.length) {
    let cur = open.pop();
    for (;;) {
      const ex = cur[cur.length - 2], ey = cur[cur.length - 1];
      // Closing onto its own start beats bridging to another patch.
      let best = -1, bestD = Math.min(tol * tol, (cur[0] - ex) ** 2 + (cur[1] - ey) ** 2), rev = false;
      for (let i = 0; i < open.length; i++) {
        const c = open[i];
        const d0 = (c[0] - ex) ** 2 + (c[1] - ey) ** 2;
        const d1 = (c[c.length - 2] - ex) ** 2 + (c[c.length - 1] - ey) ** 2;
        if (d0 < bestD) { bestD = d0; best = i; rev = false; }
        if (d1 < bestD) { bestD = d1; best = i; rev = true; }
      }
      if (best < 0) break;
      let c = open.splice(best, 1)[0];
      if (rev) { const r = []; for (let i = c.length - 2; i >= 0; i -= 2) r.push(c[i], c[i + 1]); c = r; }
      cur = cur.concat(c);
    }
    if (cur.length >= 6) result.push({ pts: new Float32Array(cur), closed: true, gap: Math.hypot(cur[0] - cur[cur.length - 2], cur[1] - cur[cur.length - 1]) });
  }
  return result;
}

// Body silhouette from skin outlines that do not join up end to end (skin made
// of overlapping patches): the outlines are drawn as thick lines on a grid, the
// outside is flood-filled, and the filled body is shrunk back by the line
// thickness (a morphological closing) and traced with marching squares.
function rasterBody(chains, R = 0.6) {
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (const c of chains) for (let i = 0; i < c.pts.length; i += 2) {
    const u = c.pts[i], v = c.pts[i + 1];
    if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v;
  }
  const res = Math.max(0.12, Math.max(maxU - minU, maxV - minV) / 700);
  const pad = R * 2 + res * 2;
  const u0 = minU - pad, v0 = minV - pad;
  const W = Math.ceil((maxU - minU + 2 * pad) / res) + 1, H = Math.ceil((maxV - minV + 2 * pad) / res) + 1;
  const wall = new Uint8Array(W * H);
  const rc = Math.ceil(R / res);
  const disk = [];
  for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) if (dx * dx + dy * dy <= rc * rc) disk.push(dx + dy * W);
  for (const c of chains) {
    const a = c.pts;
    for (let i = 2; i < a.length; i += 2) {
      const len = Math.hypot(a[i] - a[i - 2], a[i + 1] - a[i - 1]);
      const n = Math.max(1, Math.ceil(len / (res * 0.7)));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = Math.round((a[i - 2] + (a[i] - a[i - 2]) * t - u0) / res), y = Math.round((a[i - 1] + (a[i + 1] - a[i - 1]) * t - v0) / res);
        const o = x + y * W;
        for (const d of disk) wall[o + d] = 1;
      }
    }
  }
  // Flood-fill the outside from the border.
  const outside = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let qh = 0, qt = 0;
  const push = (i) => { if (!outside[i] && !wall[i]) { outside[i] = 1; queue[qt++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push(x + (H - 1) * W); }
  for (let y = 0; y < H; y++) { push(y * W); push(W - 1 + y * W); }
  while (qh < qt) {
    const i = queue[qh++], x = i % W;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (i >= W) push(i - W);
    if (i < W * (H - 1)) push(i + W);
  }
  // Chamfer distance (in cells) from the outside.
  const D = new Float32Array(W * H);
  const BIG = 1e9;
  for (let i = 0; i < W * H; i++) D[i] = outside[i] ? 0 : BIG;
  const d1 = 1, d2 = Math.SQRT2;
  for (let y = 1; y < H; y++) for (let x = 1; x < W - 1; x++) {
    const i = x + y * W;
    if (!D[i]) continue;
    D[i] = Math.min(D[i], D[i - 1] + d1, D[i - W] + d1, D[i - W - 1] + d2, D[i - W + 1] + d2);
  }
  for (let y = H - 2; y >= 0; y--) for (let x = W - 2; x > 0; x--) {
    const i = x + y * W;
    if (!D[i]) continue;
    D[i] = Math.min(D[i], D[i + 1] + d1, D[i + W] + d1, D[i + W + 1] + d2, D[i + W - 1] + d2);
  }
  // Marching squares at distance R.
  const iso = R / res;
  const segA = [], segB = [], pts = [];
  const ids = new Map();
  const point = (i, j) => {
    const key = i < j ? i * W * H + j : j * W * H + i;
    let id = ids.get(key);
    if (id !== undefined) return id;
    const t = (iso - D[i]) / (D[j] - D[i]);
    const xi = i % W, yi = (i / W) | 0, xj = j % W, yj = (j / W) | 0;
    id = pts.length / 2;
    pts.push(u0 + (xi + (xj - xi) * t) * res, v0 + (yi + (yj - yi) * t) * res);
    ids.set(key, id);
    return id;
  };
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const a = x + y * W, b = a + 1, c = a + W + 1, d = a + W;
    const k = (D[a] > iso ? 1 : 0) | (D[b] > iso ? 2 : 0) | (D[c] > iso ? 4 : 0) | (D[d] > iso ? 8 : 0);
    if (k === 0 || k === 15) continue;
    const e = [[a, b], [b, c], [c, d], [d, a]];
    const edges = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 0], [1, 2]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[2, 0]], 10: [[0, 1], [2, 3]], 11: [[2, 1]], 12: [[1, 3]], 13: [[1, 0]], 14: [[0, 3]] }[k];
    for (const [p, q] of edges) { segA.push(point(...e[p])); segB.push(point(...e[q])); }
  }
  return chain(segA, segB, pts).filter((l) => l.pts.length >= 8).map((l) => ({ pts: l.pts, closed: true }));
}

function polyArea(p) {
  let a = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += (p[j] + p[i]) * (p[j + 1] - p[i + 1]);
  return a / 2;
}

export class SectionView {
  constructor(canvas, { onHover, onPick }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.items = [];
    this.axis = 'transverse';
    this.palette = 'atlas';
    this.labels = true;
    this.view = { cx: 0, cy: 0, scale: 1 };
    this.fitKey = '';
    this.selected = new Set();
    this.hover = null;
    this.onHover = onHover;
    this.onPick = onPick;
    this.bounds = null;
    this.#bind();
  }

  #bind() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0015);
      const [wx, wy] = this.toWorld(e.offsetX, e.offsetY);
      this.view.scale *= f;
      this.view.cx = wx - (wx - this.view.cx) / f;
      this.view.cy = wy - (wy - this.view.cy) / f;
      this.draw();
    }, { passive: false });
    // Touch: one finger pans, two fingers pinch-zoom, a tap selects.
    const pts = new Map();
    let pinch = null;
    const zoomAt = (sx, sy, f) => {
      const [wx, wy] = this.toWorld(sx, sy);
      this.view.scale *= f;
      this.view.cx = wx - (wx - this.view.cx) / f;
      this.view.cy = wy - (wy - this.view.cy) / f;
    };
    const pinchState = () => {
      const [a, b] = [...pts.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    c.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      c.setPointerCapture(e.pointerId);
      if (pts.size === 2) { pinch = pinchState(); drag = null; }
      else if (pts.size === 1) drag = { x: e.offsetX, y: e.offsetY, moved: false };
    });
    c.addEventListener('pointermove', (e) => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pinch && pts.size === 2) {
        const p = pinchState();
        zoomAt(p.x, p.y, p.d / Math.max(1, pinch.d));
        this.view.cx -= (p.x - pinch.x) / this.view.scale;
        this.view.cy += (p.y - pinch.y) / this.view.scale;
        pinch = p;
        this.draw();
        return;
      }
      if (drag) {
        const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
        if (drag.moved) {
          this.view.cx -= dx / this.view.scale;
          this.view.cy += dy / this.view.scale;
          drag.x = e.offsetX; drag.y = e.offsetY;
          this.draw();
          return;
        }
      }
      if (e.pointerType !== 'mouse') return;
      const it = this.hitTest(e.offsetX, e.offsetY);
      if (it !== this.hover) {
        this.hover = it;
        this.draw();
      }
      this.onHover?.(it, e);
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (drag && !drag.moved && e.type === 'pointerup') {
        const it = this.hitTest(e.offsetX, e.offsetY);
        if (e.pointerType !== 'mouse') { this.hover = it; this.onHover?.(it, e); this.draw(); }
        this.onPick?.(it, e);
      }
      drag = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'mouse') return; this.hover = null; this.onHover?.(null); this.draw(); });
    c.addEventListener('dblclick', () => { this.fitKey = ''; this.fit(); this.draw(); });
    new ResizeObserver(() => this.draw()).observe(c);
  }

  setBounds(box) {
    this.bounds = box;
  }

  fit() {
    const w = this.canvas.clientWidth || 300, h = this.canvas.clientHeight || 200;
    if (this.items.length) {
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      for (const it of this.items) for (const l of it.loops) {
        const a = l.pts;
        for (let i = 0; i < a.length; i += 2) {
          if (a[i] < minU) minU = a[i]; if (a[i] > maxU) maxU = a[i];
          if (a[i + 1] < minV) minV = a[i + 1]; if (a[i + 1] > maxV) maxV = a[i + 1];
        }
      }
      if (maxU > minU) {
        this.view.cx = (minU + maxU) / 2;
        this.view.cy = (minV + maxV) / 2;
        this.view.scale = Math.min(w / (maxU - minU), h / (maxV - minV)) * 0.88;
        return;
      }
    }
    const b = this.bounds;
    if (!b) return;
    const A = AXES[this.axis];
    const corners = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      corners.push([x * A.u.x + y * A.u.y + z * A.u.z, x * A.v.x + y * A.v.y + z * A.v.z]);
    }
    const us = corners.map((c) => c[0]), vs = corners.map((c) => c[1]);
    const minU = Math.min(...us), maxU = Math.max(...us), minV = Math.min(...vs), maxV = Math.max(...vs);
    this.view.cx = (minU + maxU) / 2;
    this.view.cy = (minV + maxV) / 2;
    this.view.scale = Math.min(w / (maxU - minU), h / (maxV - minV)) * 0.92;
  }

  setItems(items, axis) {
    this.items = items;
    if (axis !== this.axis || !this.fitKey) {
      this.axis = axis;
      this.fitKey = axis;
      this.fit();
    }
    this.hover = null;
    this.draw();
  }

  toWorld(x, y) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return [(x - w / 2) / this.view.scale + this.view.cx, -(y - h / 2) / this.view.scale + this.view.cy];
  }

  #transform(ctx) {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const s = this.view.scale * dpr;
    ctx.setTransform(s, 0, 0, -s, (w / 2 - this.view.cx * this.view.scale) * dpr, (h / 2 + this.view.cy * this.view.scale) * dpr);
  }

  #path(item) {
    if (item.path) return item.path;
    const p = new Path2D();
    const line = new Path2D();
    let lines = false;
    for (const l of item.loops) {
      const a = l.pts;
      const q = l.open ? line : p;
      q.moveTo(a[0], a[1]);
      for (let i = 2; i < a.length; i += 2) q.lineTo(a[i], a[i + 1]);
      if (l.open) lines = true;
      else p.closePath();
    }
    item.path = p;
    item.linePath = lines ? line : null;
    return p;
  }

  // Line width (world units) for open, sheet-like cuts.
  #sheetWidth() {
    return Math.max(0.12, 1.6 / this.view.scale);
  }

  hitTest(x, y) {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    this.#transform(ctx);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.isBody) continue;
      if (ctx.isPointInPath(this.#path(it), x * dpr, y * dpr, 'evenodd')) return it;
      if (it.linePath) {
        ctx.lineWidth = Math.max(this.#sheetWidth(), 6 / this.view.scale);
        if (ctx.isPointInStroke(it.linePath, x * dpr, y * dpr)) return it;
      }
    }
    return null;
  }

  colorOf(item) {
    const t = item.tissue;
    if (this.palette === 'atlas') {
      if (item.isBody) return '#e7c3a4';
      item.hex ||= '#' + partAppearance(item.structure, item.tissue).color.getHexString();
      return item.hex;
    }
    const key = this.palette === 'ct' ? 'ct' : 'mri';
    let g = item.isBody ? (key === 'ct' ? 0.3 : 0.88) : TISSUES[t]?.[key] ?? 0.5;
    const v = Math.round(Math.min(1, Math.max(0, g)) * 255);
    return `rgb(${v},${v},${v})`;
  }

  draw() {
    const c = this.canvas, ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.palette === 'atlas' ? '#0b0f14' : '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    this.#transform(ctx);
    const lw = 1 / (this.view.scale * dpr);
    for (const it of this.items) {
      const p = this.#path(it);
      ctx.fillStyle = this.colorOf(it);
      if (it.isBody) {
        // The body silhouette is the union of the skin outlines.
        for (const l of it.loops) {
          const q = new Path2D();
          q.moveTo(l.pts[0], l.pts[1]);
          for (let i = 2; i < l.pts.length; i += 2) q.lineTo(l.pts[i], l.pts[i + 1]);
          q.closePath();
          ctx.fill(q, 'nonzero');
        }
      } else ctx.fill(p, 'evenodd');
      if (this.palette === 'atlas') {
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = lw;
        ctx.stroke(p);
      } else if (this.palette === 'mri' && (it.tissue === 'bone' || it.tissue === 'toothroot')) {
        ctx.strokeStyle = '#050505';
        ctx.lineWidth = lw * 3;
        ctx.stroke(p);
      }
      if (it.linePath) {
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = this.#sheetWidth();
        ctx.lineJoin = 'round';
        ctx.stroke(it.linePath);
      }
    }
    for (const it of this.items) {
      const sel = it.structure && this.selected.has(it.structure);
      if (!sel && it !== this.hover) continue;
      const p = this.#path(it);
      ctx.fillStyle = sel ? 'rgba(40,200,255,0.35)' : 'rgba(255,240,140,0.25)';
      ctx.fill(p, 'evenodd');
      ctx.strokeStyle = sel ? '#38d0ff' : '#ffe680';
      ctx.lineWidth = lw * 2;
      ctx.stroke(p);
      if (it.linePath) {
        ctx.lineWidth = this.#sheetWidth() * 2;
        ctx.stroke(it.linePath);
      }
    }
    if (this.labels) this.#drawLabels(ctx, dpr);
    this.#drawOrientation(ctx, dpr, w, h);
  }

  #drawLabels(ctx, dpr) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const placed = [];
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const seen = new Set();
    const sorted = this.items.filter((i) => !i.isBody && i.structure).sort((a, b) => b.area - a.area);
    for (const it of sorted) {
      const pxArea = it.area * this.view.scale * this.view.scale;
      if (pxArea < 900) break;
      if (seen.has(it.structure)) continue;
      // centroid of the largest loop
      let best = null, bestA = 0;
      for (const l of it.loops) { if (l.open) continue; const a = Math.abs(polyArea(l.pts)); if (a > bestA) { bestA = a; best = l.pts; } }
      if (!best) continue;
      let cx = 0, cy = 0;
      for (let i = 0; i < best.length; i += 2) { cx += best[i]; cy += best[i + 1]; }
      cx /= best.length / 2; cy /= best.length / 2;
      const sx = (cx - this.view.cx) * this.view.scale + w / 2;
      const sy = -(cy - this.view.cy) * this.view.scale + h / 2;
      const text = it.structure.name.length > 28 ? it.structure.name.slice(0, 26) + '…' : it.structure.name;
      const tw = ctx.measureText(text).width + 8;
      const r = { x: sx - tw / 2, y: sy - 8, w: tw, h: 16 };
      if (r.x < 0 || r.y < 0 || r.x + r.w > w || r.y + r.h > h) continue;
      if (placed.some((q) => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h)) continue;
      placed.push(r);
      seen.add(it.structure);
      ctx.fillStyle = 'rgba(8,12,18,0.62)';
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 4);
      ctx.fill();
      ctx.fillStyle = '#e8eef5';
      ctx.fillText(text, sx, sy + 0.5);
      if (placed.length > 40) break;
    }
  }

  #drawOrientation(ctx, dpr, w, h) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(160,200,255,0.85)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lab = {
      transverse: ['R', 'L', 'A', 'P'],
      coronal: ['R', 'L', 'S', 'I'],
      sagittal: ['A', 'P', 'S', 'I'],
    }[this.axis];
    ctx.fillText(lab[0], 12, h / 2);
    ctx.fillText(lab[1], w - 12, h / 2);
    ctx.fillText(lab[2], w / 2, 12);
    ctx.fillText(lab[3], w / 2, h - 12);
  }
}
