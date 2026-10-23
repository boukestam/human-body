// Structures modelled procedurally for the female body, where neither source
// has them (or only has male versions): head hair, eyebrows, the urethra,
// clitoris, vestibular bulbs, greater vestibular glands and ovarian vessels.
// Every model is anchored to landmarks of the HRA female body and sized from
// published adult female measurements.
import * as THREE from 'three';
import { soupToBVH, indexedToSoup, cast, bbox, band, centroid } from './landmarks.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const nodePoints = (f, name) => {
  const parts = [...f.values()].filter((n) => n.name === name || n.path.includes(name));
  if (!parts.length) return null;
  const n = parts.reduce((s, p) => s + p.positions.length, 0);
  const o = new Float32Array(n);
  let k = 0;
  for (const p of parts) { o.set(p.positions, k); k += p.positions.length; }
  return o;
};
const boxCentre = (pts) => bbox(pts).getCenter(V(0, 0, 0));

// Positions / indices accumulator.
class MeshBuilder {
  constructor() { this.pos = []; this.idx = []; }
  vertex(p) { this.pos.push(p.x, p.y, p.z); return this.pos.length / 3 - 1; }
  tri(a, b, c) { if (a !== b && b !== c && a !== c) this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  mesh() {
    const m = { positions: Float32Array.from(this.pos), indices: Uint32Array.from(this.idx) };
    return orientOutward(m);
  }
}

function signedVolume({ positions: p, indices: idx }) {
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}
function orientOutward(m) {
  if (signedVolume(m) < 0) for (let t = 0; t < m.indices.length; t += 3) { const a = m.indices[t + 1]; m.indices[t + 1] = m.indices[t + 2]; m.indices[t + 2] = a; }
  return m;
}

// A closed slab between an outer and an inner grid surface over (i, j), where
// i wraps around. Cells are kept where keep(i, j) is true; open borders get walls.
function slab(outer, inner, ni, nj, keep, b = new MeshBuilder()) {
  const O = [], I = [];
  for (let i = 0; i < ni; i++) {
    O.push([]); I.push([]);
    for (let j = 0; j < nj; j++) { O[i].push(b.vertex(outer[i][j])); I[i].push(b.vertex(inner[i][j])); }
  }
  const has = (i, j) => j >= 0 && j < nj - 1 && keep((i + ni) % ni, j);
  for (let i = 0; i < ni; i++) {
    const i1 = (i + 1) % ni;
    for (let j = 0; j < nj - 1; j++) {
      if (!has(i, j)) continue;
      b.quad(O[i][j], O[i][j + 1], O[i1][j + 1], O[i1][j]);
      b.quad(I[i][j], I[i1][j], I[i1][j + 1], I[i][j + 1]);
      if (!has(i, j - 1)) b.quad(O[i][j], O[i1][j], I[i1][j], I[i][j]);
      if (!has(i, j + 1)) b.quad(O[i][j + 1], I[i][j + 1], I[i1][j + 1], O[i1][j + 1]);
      if (!has(i - 1, j)) b.quad(O[i][j], I[i][j], I[i][j + 1], O[i][j + 1]);
      if (!has(i + 1, j)) b.quad(O[i1][j], O[i1][j + 1], I[i1][j + 1], I[i1][j]);
    }
  }
  return b;
}

// A tube along a polyline with a per-point radius (and optional flattening
// along a given "up" vector per point); ends are closed.
export function tube(points, radius, { segments = 10, flatten = 1, up = null } = {}) {
  const b = new MeshBuilder();
  const n = points.length;
  const rings = [];
  let prevU = null;
  for (let k = 0; k < n; k++) {
    const t = points[Math.min(k + 1, n - 1)].clone().sub(points[Math.max(k - 1, 0)]).normalize();
    let u;
    if (up) u = up[k].clone().addScaledVector(t, -up[k].dot(t)).normalize();
    else if (prevU) u = prevU.clone().addScaledVector(t, -prevU.dot(t)).normalize();
    else { u = Math.abs(t.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0); u.addScaledVector(t, -u.dot(t)).normalize(); }
    prevU = u;
    const w = t.clone().cross(u);
    const r = typeof radius === 'function' ? radius(k / (n - 1)) : radius[k];
    const ring = [];
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      ring.push(b.vertex(points[k].clone().addScaledVector(w, Math.cos(a) * r).addScaledVector(u, Math.sin(a) * r * flatten)));
    }
    rings.push(ring);
  }
  for (let k = 0; k < n - 1; k++) for (let s = 0; s < segments; s++) {
    const s1 = (s + 1) % segments;
    b.quad(rings[k][s], rings[k + 1][s], rings[k + 1][s1], rings[k][s1]);
  }
  const capA = b.vertex(points[0]), capB = b.vertex(points[n - 1]);
  for (let s = 0; s < segments; s++) {
    const s1 = (s + 1) % segments;
    b.tri(capA, rings[0][s1], rings[0][s]);
    b.tri(capB, rings[n - 1][s], rings[n - 1][s1]);
  }
  return b.mesh();
}

// Catmull-Rom resampling of a few control points into a smooth polyline.
export function spline(ctrl, n) {
  const c = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  return c.getSpacedPoints(n - 1);
}

// ---------------------------------------------------------------- head
export function headFrame(f) {
  const skin = f.get('VH_F_skin');
  const eyes = ['L', 'R'].map((S) => boxCentre(Float32Array.from([...nodePoints(f, `VH_F_retina_${S}`), ...nodePoints(f, `VH_F_cornea_${S}`)])));
  const mid = eyes[0].clone().add(eyes[1]).multiplyScalar(0.5);
  const cranium = bbox(band(skin.positions, mid.y, mid.y + 30, (x) => Math.abs(x - mid.x) < 13));
  const centre = V(mid.x, mid.y + 1, (cranium.min.z + cranium.max.z) / 2);
  const S = soupToBVH([indexedToSoup(skin.positions, skin.indices)]);
  return { eyes, mid, centre, top: cranium.max.y, S };
}

// Shoulder-length hair: a closed shell over the scalp (outside a hairline that
// frames the face) that hangs straight down below the widest part of the head.
export function femaleHair(f, frame = headFrame(f)) {
  const { centre: H, mid, S } = frame;
  const eyeY = mid.y;
  const NA = 180, NJ = 90;
  // Each column runs from the crown down a meridian of the dome (u in [0, D])
  // and then hangs vertically (1 cm of u per cm of drop).
  const D = 16;
  const yEnd = (a) => eyeY - 17 + 0.9 * Math.sin(a * 9) + 0.35 * Math.sin(a * 17 + 1);
  // Distance from o to the outermost skin surface along d (covers the ears).
  const outerR = (o, d, max = 40) => { const p = cast(S, o.clone().addScaledVector(d, max), d.clone().negate(), max); return p ? p.distanceTo(o) : 0; };
  const strands = (a) => 0.11 * Math.sin(a * 52 + 2.5 * Math.sin(a * 6)) + 0.05 * Math.sin(a * 131);
  const front = (a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) * 180 / Math.PI;
  const hairline = (a) => {
    const d = front(a);
    if (d > 78) return -Infinity;
    return eyeY + 6.4 - 2.2 * smooth(16, 50, d) - 6.8 * smooth(50, 75, d);
  };
  const outer = [], inner = [];
  for (let i = 0; i < NA; i++) {
    const a = (i / NA) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const horiz = V(sa, 0, ca);
    let rEq = 0;
    const point = (u) => {
      if (u <= D) {
        const phi = (u / D) * Math.PI / 2;
        const d = V(Math.sin(phi) * sa, Math.cos(phi), Math.sin(phi) * ca);
        const r = outerR(H, d);
        const k = smooth(0, 0.5, phi);
        const thick = 0.75 + 0.55 * smooth(0.6, 1.5, phi) + strands(a) * k;
        return { o: H.clone().addScaledVector(d, r + thick), i: H.clone().addScaledVector(d, r + 0.06), y: H.y + Math.cos(phi) * r, rOut: r + thick, contact: false };
      }
      const below = u - D;
      const y = H.y - below;
      const o = V(H.x, y, H.z);
      const rs = outerR(o, horiz);
      const end = yEnd(a);
      const curl = smooth(end + 4, end, y);
      const nominal = rEq - 2.0 * smooth(0, 16, below) - 0.9 * curl;
      const rOut = Math.max(rs + 0.45 + 0.3 * curl, nominal);
      const thick = 1.25 - 0.85 * curl;
      return { o: o.clone().addScaledVector(horiz, rOut), i: o.clone().addScaledVector(horiz, Math.max(rs + 0.08, rOut - thick)), y, contact: y < eyeY - 9 && rs > nominal - 0.2 };
    };
    rEq = point(D).rOut;
    // Find where this column leaves the hair region.
    let uEnd = 0;
    for (let u = 0.05; ; u += 0.05) {
      const p = point(u);
      const stop = p.y < hairline(a) || (u > D && (p.y < yEnd(a) || p.contact));
      if (stop || u > D + 40) { uEnd = u - 0.05; break; }
    }
    const O = [], I = [];
    for (let j = 0; j < NJ; j++) {
      const p = point(Math.max(0, uEnd) * (j / (NJ - 1)));
      O.push(p.o); I.push(p.i);
    }
    outer.push(O); inner.push(I);
  }
  return slab(outer, inner, NA, NJ, () => true).mesh();
}

// Eyebrow: a flat, tapering band lying on the skin above the eye.
export function femaleEyebrow(f, side, frame = headFrame(f)) {
  const { eyes, S, centre: H } = frame;
  const E = eyes[side > 0 ? 0 : 1];
  const ctrl = [[-1.55, 1.25], [-0.6, 1.75], [0.55, 2.05], [1.5, 1.85], [2.35, 1.3]].map(([x, y]) => V(E.x + side * x, E.y + y, E.z));
  const pts = spline(ctrl, 26).map((p) => {
    const o = V(p.x, p.y, H.z);
    const hit = cast(S, o, V(0, 0, 1), 20);
    return hit || p;
  });
  const up = pts.map((p) => p.clone().sub(H).normalize());
  const lifted = pts.map((p, k) => p.clone().addScaledVector(up[k], 0.06));
  const width = (t) => (0.42 - 0.27 * t) * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t * 0.97 + 0.015))), 0.35);
  return tube(lifted, width, { segments: 10, flatten: 0.22, up });
}


// ---------------------------------------------------------------- pelvis
const lowest = (pts) => { let b = null; for (let i = 0; i < pts.length; i += 3) if (!b || pts[i + 1] < b.y) b = V(pts[i], pts[i + 1], pts[i + 2]); return b; };
const highest = (pts) => { let b = null; for (let i = 0; i < pts.length; i += 3) if (!b || pts[i + 1] > b.y) b = V(pts[i], pts[i + 1], pts[i + 2]); return b; };
const pathLength = (pts) => pts.reduce((s, p, i) => (i ? s + p.distanceTo(pts[i - 1]) : 0), 0);

export function ellipsoid(c, axes, radii, nu = 16, nv = 10) {
  const b = new MeshBuilder();
  const [ax, ay, az] = axes;
  const top = b.vertex(c.clone().addScaledVector(az, radii[2]));
  const rings = [];
  for (let j = 1; j < nv; j++) {
    const th = (j / nv) * Math.PI;
    const ring = [];
    for (let i = 0; i < nu; i++) {
      const ph = (i / nu) * Math.PI * 2;
      ring.push(b.vertex(c.clone().addScaledVector(ax, Math.sin(th) * Math.cos(ph) * radii[0]).addScaledVector(ay, Math.sin(th) * Math.sin(ph) * radii[1]).addScaledVector(az, Math.cos(th) * radii[2])));
    }
    rings.push(ring);
  }
  const bot = b.vertex(c.clone().addScaledVector(az, -radii[2]));
  for (let i = 0; i < nu; i++) {
    const i1 = (i + 1) % nu;
    b.tri(top, rings[0][i], rings[0][i1]);
    for (let j = 0; j < rings.length - 1; j++) b.quad(rings[j][i], rings[j + 1][i], rings[j + 1][i1], rings[j][i1]);
    b.tri(bot, rings[rings.length - 1][i1], rings[rings.length - 1][i]);
  }
  return b.mesh();
}

export function mergeMeshes(list) {
  const n = list.reduce((s, m) => s + m.positions.length, 0);
  const positions = new Float32Array(n);
  const indices = [];
  let o = 0;
  for (const m of list) {
    positions.set(m.positions, o);
    for (const i of m.indices) indices.push(i + o / 3);
    o += m.positions.length;
  }
  return { positions, indices: Uint32Array.from(indices) };
}

// Centre line of a vessel mesh running mostly vertically: centroids of 1 cm
// slices from the top, with the mean radius of each slice.
export function vesselCentreline(soup, step = 1) {
  const b = bbox(soup);
  const out = [];
  for (let y = b.max.y; y > b.min.y; y -= step) {
    const s = band(soup, y - step, y);
    if (s.length < 9) continue;
    const c = centroid(s);
    let r = 0;
    for (let i = 0; i < s.length; i += 3) r += Math.hypot(s[i] - c.x, s[i + 1] - c.y, s[i + 2] - c.z);
    out.push({ p: c, r: (r / (s.length / 3)) });
  }
  return out;
}

// Pushes centre line points out of a surface (given as soups) so a tube of
// radius r keeps the given clearance.
function clearOf(points, r, bvhs, clearance = 0.1) {
  const target = {};
  return points.map((p) => {
    const q = p.clone();
    for (let it = 0; it < 4; it++) {
      for (const { bvh } of bvhs) {
        const hit = bvh.closestPointToPoint(q, target);
        if (!hit) continue;
        const d = q.distanceTo(hit.point);
        if (d < r + clearance && d > 1e-4) q.addScaledVector(q.clone().sub(hit.point).normalize(), r + clearance - d);
      }
    }
    return q;
  });
}

// Counts surface crossings along +y to test whether a point is inside a closed skin.
function insideSkin(S, p) {
  const ray = new THREE.Ray(p.clone(), V(0, 1, 0));
  const hits = S.bvh.raycast(ray, THREE.DoubleSide);
  return hits.length % 2 === 1;
}
function distanceTo(S, p) {
  const hit = S.bvh.closestPointToPoint(p, {});
  return hit ? hit.distance : Infinity;
}

// Female pelvic structures. `z(name)` returns the warped Z-Anatomy soup of a
// structure ('Name' or 'Name l').
export function femalePelvis(f, z, log = () => {}) {
  const skin = f.get('VH_F_skin');
  const S = soupToBVH([indexedToSoup(skin.positions, skin.indices)]);
  const vag = nodePoints(f, 'VH_F_vagina');
  const vb = bbox(vag);
  const vagBand = (y, h = 0.5) => band(vag, y - h / 2, y + h / 2);
  const V0 = centroid(vagBand(vb.min.y + 0.3, 0.6));
  const mx = V0.x;
  const anteriorWall = (y) => { const s = vagBand(y); let m = -Infinity; for (let i = 2; i < s.length; i += 3) m = Math.max(m, s[i]); return m; };
  const N = boxCentre(nodePoints(f, 'VH_F_urinary_bladder_neck_smooth_muscle'));
  const sym = z('Pubic symphysis');
  const symLow = lowest(sym);
  const hip = { l: z('Hip bone l'), r: z('Hip bone r') };
  const IT = { l: lowest(hip.l), r: lowest(hip.r) };
  const boneBVH = [soupToBVH([hip.l, hip.r, sym])];
  const vagNode = f.get('VH_F_vagina');
  const vagBVH = soupToBVH([indexedToSoup(vagNode.positions, vagNode.indices)]);
  const out = {};
  const report = (name, pts, r) => {
    const inside = pts.every((p) => insideSkin(S, p));
    const minSkin = Math.min(...pts.map((p) => distanceTo(S, p)));
    log(`${name}: length ${pathLength(pts).toFixed(2)} cm, diameter ${(2 * r).toFixed(2)} cm, inside skin ${inside}, min skin distance ${minSkin.toFixed(2)} cm`);
  };

  // Urethra: bladder neck to the external orifice in the vestibule, in front
  // of the anterior vaginal wall. Adult female: ~4 cm long, ~6 mm wide.
  const U = V(mx, V0.y - 0.55, anteriorWall(V0.y) + 1.0);
  const uCtrl = [N, N.clone().lerp(U, 0.33), N.clone().lerp(U, 0.66), U].map((p, k) => {
    const q = p.clone();
    if (k === 1 || k === 2) q.z = Math.max(q.z - 0.15, anteriorWall(q.y) + 0.55);
    return q;
  });
  const urethra = spline(uCtrl, 24);
  report('urethra', urethra, 0.3);
  out.urethra = tube(urethra, (t) => 0.3 - 0.04 * t, { segments: 12 });

  // Clitoris. Glans at the anterior end of the vestibule ~2.5 cm in front of the
  // urethral orifice and ~0.7 cm under the skin; the body runs up to the lower
  // border of the pubic symphysis, bends, and splits into two crura that run
  // along the ischiopubic rami.
  const frontSkinZ = (y) => { const s = band(skin.positions, y - 0.3, y + 0.3, (x) => Math.abs(x - mx) < 0.6); let m = -Infinity; for (let i = 2; i < s.length; i += 3) m = Math.max(m, s[i]); return m; };
  let G = null;
  for (let y = U.y; y < U.y + 4; y += 0.05) {
    const g = V(mx, y, frontSkinZ(y) - 1.1);
    if (g.distanceTo(U) >= 2.5) { G = g; break; }
  }
  const K = V(mx, symLow.y - 0.35, symLow.z + 0.95);
  const body = spline([G, G.clone().lerp(K, 0.5).add(V(0, -0.1, 0.25)), K], 16);
  const bodyDir = K.clone().sub(G).normalize();
  report('clitoral body', body, 0.45);
  out.glans = ellipsoid(G.clone().addScaledVector(bodyDir, -0.25), [V(1, 0, 0), V(0, 0, 1).cross(bodyDir).normalize().cross(bodyDir).normalize(), bodyDir], [0.32, 0.3, 0.45]);
  out.clitoralBody = tube(body, (t) => 0.3 + 0.15 * Math.sin(Math.PI * Math.min(1, t * 1.2)), { segments: 12 });
  log(`glans ${G.toArray().map((v) => v.toFixed(2))}, glans-urethral orifice ${G.distanceTo(U).toFixed(2)} cm`);

  const crura = {};
  for (const [s, side] of [[1, 'l'], [-1, 'r']]) {
    const ram = IT[side].clone().sub(symLow);
    const along = (t) => symLow.clone().addScaledVector(ram, t).add(V(-s * 0.7, -0.75, 0));
    const ctrl = [K, K.clone().add(V(s * 0.6, -0.15, -0.6)), along(0.22), along(0.4), along(0.58)];
    let pts = spline(ctrl, 30);
    pts = clearOf(pts, 0.35, boneBVH, 0.08);
    report(`crus ${side}`, pts, 0.35);
    crura[side] = tube(pts, (t) => 0.38 - 0.18 * t * t, { segments: 12 });
  }
  out.crura = crura;

  // Vestibular bulbs: beside the urethral and vaginal orifices, from the
  // clitoral body back to the greater vestibular glands (~4-5 cm long).
  const bulbs = {}, glands = {};
  for (const [s, side] of [[1, 'l'], [-1, 'r']]) {
    const A = G.clone().lerp(U, 0.45).add(V(s * 0.7, 0.25, 0));
    const M = V(mx + s * 1.45, U.y + 0.35, U.z - 0.35);
    const P = V(mx + s * 1.75, V0.y - 0.15, V0.z - 0.85);
    let pts = spline([A, M, P], 24);
    pts = clearOf(pts, 0.5, [vagBVH], 0.1);
    report(`vestibular bulb ${side}`, pts, 0.55);
    bulbs[side] = tube(pts, (t) => 0.15 + 0.42 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.85)) * smooth(0, 0.6, t), { segments: 12, flatten: 0.55, up: pts.map(() => V(1, 0, 0)) });
    // Greater vestibular (Bartholin) gland: ~1 cm, at the posterior end of the
    // bulb, with its ~2 cm duct opening beside the vaginal orifice.
    const B = P.clone().add(V(s * 0.1, -0.15, -0.55));
    const opening = V(mx + s * 0.85, V0.y - 0.25, V0.z - 0.15);
    const duct = spline([B, B.clone().lerp(opening, 0.5).add(V(0, -0.15, 0)), opening], 12);
    log(`Bartholin gland ${side}: ${B.toArray().map((v) => v.toFixed(2))}, inside skin ${insideSkin(S, B)}, duct ${pathLength(duct).toFixed(2)} cm`);
    glands[side] = mergeMeshes([ellipsoid(B, [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)], [0.4, 0.38, 0.5]), tube(duct, () => 0.07, { segments: 6 })]);
  }
  out.bulbs = bulbs;
  out.glands = glands;
  // Ovarian arteries and veins: the upper course of the gonadal vessels is the
  // same in both sexes (aorta below the renal arteries / left renal vein / IVC,
  // down on the psoas). At the pelvic brim they turn into the suspensory
  // ligament of the ovary and reach the ovary instead of the inguinal canal.
  const ovarian = { artery: {}, vein: {} };
  for (const [side, S2] of [['l', 'L'], ['r', 'R']]) {
    const lig = nodePoints(f, `VH_F_suspensory_ligament_of_ovary_${S2}`);
    const lb = bbox(lig);
    const T = centroid(band(lig, lb.max.y - 0.6, lb.max.y + 0.1));
    const Lm = centroid(band(lig, (lb.min.y + lb.max.y) / 2 - 0.4, (lb.min.y + lb.max.y) / 2 + 0.4));
    const Lb = centroid(band(lig, lb.min.y - 0.1, lb.min.y + 0.6));
    const ov = nodePoints(f, side === 'l' ? 'VH_F_left_ovary' : 'VH_F_right_ovary');
    const oc = boxCentre(ov);
    const pole = centroid(band(ov, bbox(ov).max.y - 0.5, bbox(ov).max.y + 0.1)).lerp(oc, 0.35);
    for (const kind of ['artery', 'vein']) {
      const src = z(kind === 'artery' ? (side === 'l' ? 'Left testicular artery' : 'Right testicular artery r') : (side === 'l' ? 'Left testicular vein' : 'Right testicular vein'));
      const cl = vesselCentreline(src);
      const radii = cl.map((c) => c.r).sort((a, b) => a - b);
      const r = Math.min(kind === 'artery' ? 0.12 : 0.22, Math.max(kind === 'artery' ? 0.08 : 0.15, radii[radii.length >> 1]));
      const upper = [];
      for (const c of cl) {
        if (c.p.y < T.y + 2.5) break;
        if (!upper.length || upper[upper.length - 1].distanceTo(c.p) > 1.8) upper.push(c.p);
      }
      const ctrl = [...upper, T.clone().add(V(0, 0.8, 0)), T, Lm, Lb, pole];
      const pts = spline(ctrl, Math.max(20, Math.round(pathLength(ctrl) / 0.6)));
      log(`ovarian ${kind} ${side}: length ${pathLength(pts).toFixed(1)} cm, diameter ${(2 * r).toFixed(2)} cm, origin ${pts[0].toArray().map((v) => v.toFixed(1))}`);
      ovarian[kind][side] = tube(pts, () => r, { segments: 8 });
    }
  }
  out.ovarian = ovarian;

  // Bladder: the female bladder sits lower and further forward than the warped
  // male one, below the uterus; the ureters are bent onto its ureteral orifices.
  out.bladder = mergeMeshes(['VH_F_fundus_of_urinary_bladder_dome', 'VH_F_fundus_of_urinary_bladder_base', 'VH_F_urinary_bladder_neck_smooth_muscle']
    .map((n) => f.get(n)).filter(Boolean).map((n) => ({ positions: n.positions, indices: n.indices })));
  out.ureterDeform = {};
  for (const [side, S2, s] of [['l', 'L', 1], ['r', 'R', -1]]) {
    const ur = z(`Ureter ${side}`);
    const e = centroid(band(ur, lowest(ur).y - 0.1, lowest(ur).y + 0.6));
    const orifice = boxCentre(nodePoints(f, `VH_F_ureteral_orifice_${S2}`));
    const t = orifice.clone().add(V(s * 0.6, 0.4, -0.9));
    const d = t.clone().sub(e);
    log(`ureter ${side}: end moved ${d.length().toFixed(2)} cm onto the bladder`);
    out.ureterDeform[side] = (a) => {
      const o = new Float32Array(a.length);
      const q = V(0, 0, 0);
      for (let i = 0; i < a.length; i += 3) {
        q.set(a[i], a[i + 1], a[i + 2]);
        const w = 1 - smooth(0, 14, q.distanceTo(e));
        o[i] = a[i] + d.x * w; o[i + 1] = a[i + 1] + d.y * w; o[i + 2] = a[i + 2] + d.z * w;
      }
      return o;
    };
  }
  out.pubicHair = femalePubicHair(S, { mx, symLow, G, V0, frontSkinZ });
  out.landmarks = { V0, U, G, K, N, symLow, IT };
  return out;
}

// Smooth 2D value noise in [0, 1].
function valueNoise(x, y) {
  const h = (i, j) => { let n = (i * 374761393 + j * 668265263) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
  const i = Math.floor(x), j = Math.floor(y);
  const fx = x - i, fy = y - j;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = h(i, j) + (h(i + 1, j) - h(i, j)) * sx;
  const b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * sx;
  return a + (b - a) * sy;
}

// Pubic hair: a thin, uneven layer over the mons pubis and labia majora with a
// horizontal upper border (the typical female distribution).
function femalePubicHair(S, { mx, symLow, G, V0, frontSkinZ }) {
  const NU = 60, NV = 44;
  const yTop = symLow.y + 4.6, yBot = G.y - 1.4;
  const C = V(mx, symLow.y - 1, symLow.z - 5);
  const outer = [], inner = [];
  for (let i = 0; i < NU; i++) {
    const u = (i / (NU - 1)) * 2 - 1;
    const O = [], I = [];
    for (let j = 0; j < NV; j++) {
      const v = j / (NV - 1);
      const y = yTop + (yBot - yTop) * v;
      const below = smooth(G.y + 1.5, yBot, y);
      const half = 6.8 - 4.9 * Math.pow(v, 0.8) - 0.3 * below;
      const x = mx + u * half * (1 - 0.06 * (1 - v) * Math.cos(u * Math.PI));
      const T = V(x, y, frontSkinZ(y));
      const d = T.clone().sub(C).normalize();
      const hit = S.bvh.closestPointToPoint(T, {}).point.clone();
      const n = d;
      const curl = 0.65 * valueNoise(u * 9, v * 7) + 0.35 * valueNoise(u * 23 + 5, v * 19 + 3);
      const edge = smooth(1, 0.6, Math.abs(u)) * smooth(0, 0.15, v) * smooth(1, 0.85, v);
      const thick = (0.12 + 0.22 * curl) * edge + 0.02;
      O.push(hit.clone().addScaledVector(n, thick));
      I.push(hit.clone().addScaledVector(n, -0.04));
    }
    outer.push(O); inner.push(I);
  }
  return slab(outer, inner, NU, NV, (i) => i < NU - 1).mesh();
}

// Moves the vertices of `mesh` that lie inside or behind any of the `blockers`
// (indexed meshes), seen from `centre(p)`, to just in front of them. Used to
// seat the breasts from the reference body on the warped chest wall.
export function pushOutOf(mesh, blockers, centre, clearance = 0.15, reach = 10) {
  const S = soupToBVH(blockers.map((m) => indexedToSoup(m.positions, m.indices)));
  const p = new Float32Array(mesh.positions);
  const q = V(0, 0, 0);
  const ray = new THREE.Ray();
  let moved = 0;
  for (let i = 0; i < p.length; i += 3) {
    q.set(p[i], p[i + 1], p[i + 2]);
    const d = q.clone().sub(centre(q)).normalize();
    ray.set(q, d);
    let far = -1;
    for (const h of S.bvh.raycast(ray, THREE.DoubleSide)) if (h.distance < reach && h.distance > far) far = h.distance;
    if (far < 0) continue;
    q.addScaledVector(d, far + clearance);
    p[i] = q.x; p[i + 1] = q.y; p[i + 2] = q.z;
    moved++;
  }
  return { mesh: { positions: p, indices: mesh.indices }, moved };
}

// Occupancy grid of a set of (possibly leaky) meshes inside a box: each
// horizontal slice is filled with even-odd scanlines, the same rule the 2D
// cross-section view uses, so "inside" matches what a section shows.
export function occupancy(meshes, box, res = 0.25) {
  const nx = Math.ceil((box.max.x - box.min.x) / res), ny = Math.ceil((box.max.y - box.min.y) / res), nz = Math.ceil((box.max.z - box.min.z) / res);
  const grid = new Uint8Array(nx * ny * nz);
  for (const m of meshes) {
    const p = m.positions, I = m.indices;
    const mb = bbox(p);
    const j0 = Math.max(0, Math.floor((mb.min.y - box.min.y) / res)), j1 = Math.min(ny - 1, Math.ceil((mb.max.y - box.min.y) / res));
    for (let j = j0; j <= j1; j++) {
      const y = box.min.y + (j + 0.5) * res;
      const segs = [];
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const da = p[a + 1] - y, db = p[b + 1] - y, dc = p[c + 1] - y;
        if ((da > 0 && db > 0 && dc > 0) || (da <= 0 && db <= 0 && dc <= 0)) continue;
        const pts = [];
        for (const [u, w, du, dw] of [[a, b, da, db], [b, c, db, dc], [c, a, dc, da]]) {
          if ((du > 0) === (dw > 0)) continue;
          const k = du / (du - dw);
          pts.push(p[u] + (p[w] - p[u]) * k, p[u + 2] + (p[w + 2] - p[u + 2]) * k);
        }
        if (pts.length === 4) segs.push(pts);
      }
      if (!segs.length) continue;
      for (let k = 0; k < nz; k++) {
        const z = box.min.z + (k + 0.5) * res;
        const xs = [];
        for (const [x1, z1, x2, z2] of segs) if ((z1 > z) !== (z2 > z)) xs.push(x1 + ((z - z1) / (z2 - z1)) * (x2 - x1));
        if (xs.length < 2) continue;
        xs.sort((u, w) => u - w);
        for (let q = 0; q + 1 < xs.length; q += 2) {
          const i0 = Math.max(0, Math.ceil((xs[q] - box.min.x) / res - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[q + 1] - box.min.x) / res - 0.5));
          for (let i = i0; i <= i1; i++) grid[i + nx * (j + ny * k)] = 1;
        }
      }
    }
  }
  const at = (x, y, z) => {
    const i = Math.floor((x - box.min.x) / res), j = Math.floor((y - box.min.y) / res), k = Math.floor((z - box.min.z) / res);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return 0;
    return grid[i + nx * (j + ny * k)];
  };
  return { at, res };
}

// Rigid translation (searched on a grid within `maxShift`) that leaves the
// fewest vertices of a group of meshes inside the `blockers`, with a small
// penalty per cm moved so organs stay as close as possible to where they were
// registered. The meshes keep their shape exactly.
export function separateRigid(meshes, blockers, { maxShift = 2.5, step = 0.5, penalty = 0.01 } = {}) {
  const pts = Float32Array.from(meshes.flatMap((m) => Array.from(m.positions)));
  const occ = occupancy(blockers, bbox(pts).expandByScalar(maxShift + 1));
  const buried = (tx, ty, tz) => { let c = 0; for (let i = 0; i < pts.length; i += 3) if (occ.at(pts[i] + tx, pts[i + 1] + ty, pts[i + 2] + tz)) c++; return c; };
  const before = buried(0, 0, 0);
  let best = { score: before, t: V(0, 0, 0), count: before };
  const n = pts.length / 3;
  for (let x = -maxShift; x <= maxShift + 1e-6; x += step) for (let y = -maxShift; y <= maxShift + 1e-6; y += step) for (let z = -maxShift; z <= maxShift + 1e-6; z += step) {
    const d = Math.hypot(x, y, z);
    if (d > maxShift + 1e-6) continue;
    const c = buried(x, y, z);
    const score = c + penalty * n * d;
    if (score < best.score) best = { score, t: V(x, y, z), count: c };
  }
  const out = meshes.map((m) => {
    const p = new Float32Array(m.positions);
    for (let i = 0; i < p.length; i += 3) { p[i] += best.t.x; p[i + 1] += best.t.y; p[i + 2] += best.t.z; }
    return { positions: p, indices: m.indices };
  });
  return { meshes: out, shift: best.t, before, after: best.count };
}
