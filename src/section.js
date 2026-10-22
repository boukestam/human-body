import * as THREE from 'three';
import { TISSUES } from './palette.js';

// Exact planar cross-sections of the visible meshes, drawn as a 2D atlas /
// CT / MRI-style image.

export const AXES = {
  // u: image right, v: image up (radiological display conventions)
  transverse: { normal: new THREE.Vector3(0, 1, 0), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1), label: 'Transverse (axial)' },
  coronal: { normal: new THREE.Vector3(0, 0, 1), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0), label: 'Coronal (frontal)' },
  sagittal: { normal: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 0, -1), v: new THREE.Vector3(0, 1, 0), label: 'Sagittal' },
};

export function computeSection(meshes, axisKey, position) {
  const axis = AXES[axisKey];
  const n = axis.normal, U = axis.u, V = axis.v;
  const comp = n.x ? 'x' : n.y ? 'y' : 'z';
  const items = [];
  const skinChains = [];
  for (const mesh of meshes) {
    const box = mesh.geometry.boundingBox;
    const off = mesh.parent?.position || { x: 0, y: 0, z: 0 };
    if (box.min[comp] + off[comp] > position || box.max[comp] + off[comp] < position) continue;
    const pos = mesh.geometry.attributes.position.array;
    const index = mesh.geometry.index.array;
    const vcount = pos.length / 3;
    const ci = comp === 'x' ? 0 : comp === 'y' ? 1 : 2;
    const p0 = position - off[comp];
    const d = new Float32Array(vcount);
    for (let i = 0; i < vcount; i++) d[i] = pos[i * 3 + ci] - p0;
    const segA = [], segB = [], pts = [];
    const edgePoint = new Map();
    const pointFor = (a, b) => {
      const key = a < b ? a * vcount + b : b * vcount + a;
      let id = edgePoint.get(key);
      if (id !== undefined) return id;
      const t = d[a] / (d[a] - d[b]);
      const x = pos[a * 3] + (pos[b * 3] - pos[a * 3]) * t + off.x;
      const y = pos[a * 3 + 1] + (pos[b * 3 + 1] - pos[a * 3 + 1]) * t + off.y;
      const z = pos[a * 3 + 2] + (pos[b * 3 + 2] - pos[a * 3 + 2]) * t + off.z;
      id = pts.length / 2;
      pts.push(x * U.x + y * U.y + z * U.z, x * V.x + y * V.y + z * V.z);
      edgePoint.set(key, id);
      return id;
    };
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      const sa = d[a] >= 0, sb = d[b] >= 0, sc = d[c] >= 0;
      if (sa === sb && sb === sc) continue;
      let p, q;
      if (sa === sb) { p = pointFor(b, c); q = pointFor(c, a); }
      else if (sa === sc) { p = pointFor(a, b); q = pointFor(b, c); }
      else { p = pointFor(c, a); q = pointFor(a, b); }
      if (p !== q) { segA.push(p); segB.push(q); }
    }
    if (!segA.length) continue;
    const loops = chain(segA, segB, pts);
    const tissue = mesh.userData.tissue;
    if (tissue === 'skin') {
      for (const l of loops) skinChains.push(l);
      continue;
    }
    if (tissue === 'skinInner' || tissue === 'hair') continue;
    let area = 0;
    for (const l of loops) area += Math.abs(polyArea(l.pts));
    items.push({ mesh, structure: mesh.userData.structure, tissue, loops, area });
  }
  if (skinChains.length) {
    const body = joinChains(skinChains);
    let area = 0;
    for (const l of body) area += Math.abs(polyArea(l.pts));
    items.push({ mesh: null, structure: null, tissue: 'body', loops: body, area: area * 1.0001, isBody: true });
  }
  items.sort((a, b) => b.area - a.area);
  return items;
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

// Joins open boundary chains from separate skin patches into closed outlines.
function joinChains(chains, tol = 2.5) {
  const closed = chains.filter((c) => c.closed);
  const open = chains.filter((c) => !c.closed).map((c) => Array.from(c.pts));
  const result = closed.map((c) => ({ pts: c.pts, closed: true }));
  while (open.length) {
    let cur = open.pop();
    for (;;) {
      const ex = cur[cur.length - 2], ey = cur[cur.length - 1];
      let best = -1, bestD = tol * tol, rev = false;
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
    if (cur.length >= 6) result.push({ pts: new Float32Array(cur), closed: true });
  }
  return result;
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
    c.addEventListener('pointerdown', (e) => { drag = { x: e.offsetX, y: e.offsetY, moved: false }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => {
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
      const it = this.hitTest(e.offsetX, e.offsetY);
      if (it !== this.hover) {
        this.hover = it;
        this.draw();
      }
      this.onHover?.(it, e);
    });
    c.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) this.onPick?.(this.hitTest(e.offsetX, e.offsetY), e);
      drag = null;
    });
    c.addEventListener('pointerleave', () => { this.hover = null; this.onHover?.(null); this.draw(); });
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
    for (const l of item.loops) {
      const a = l.pts;
      p.moveTo(a[0], a[1]);
      for (let i = 2; i < a.length; i += 2) p.lineTo(a[i], a[i + 1]);
      p.closePath();
    }
    item.path = p;
    return p;
  }

  hitTest(x, y) {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    this.#transform(ctx);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.isBody) continue;
      if (ctx.isPointInPath(this.#path(it), x * dpr, y * dpr, 'evenodd')) return it;
    }
    return null;
  }

  colorOf(item) {
    const t = item.tissue;
    if (this.palette === 'atlas') {
      if (item.isBody) return '#e7c3a4';
      return '#' + item.mesh.userData.baseMaterial.color.getHexString();
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
      ctx.fill(p, 'evenodd');
      if (this.palette === 'atlas') {
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = lw;
        ctx.stroke(p);
      } else if (this.palette === 'mri' && (it.tissue === 'bone' || it.tissue === 'toothroot')) {
        ctx.strokeStyle = '#050505';
        ctx.lineWidth = lw * 3;
        ctx.stroke(p);
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
      for (const l of it.loops) { const a = Math.abs(polyArea(l.pts)); if (a > bestA) { bestA = a; best = l.pts; } }
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
