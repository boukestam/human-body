// Registers HRA gut segments (caecum, rectum, ileum) onto a Z-Anatomy-based
// body: a global affine fit from matching organs, then local snaps so the
// caecum meets the ascending colon and the rectum continues the sigmoid colon.
import * as THREE from 'three';
import { centroid, principalAxis, extremes } from './landmarks.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const concat = (arrs) => {
  const o = new Float32Array(arrs.reduce((s, a) => s + a.length, 0));
  let k = 0;
  for (const a of arrs) { o.set(a, k); k += a.length; }
  return o;
};
const toVecs = (a, step = 1) => { const o = []; for (let i = 0; i < a.length; i += 3 * step) o.push(V(a[i], a[i + 1], a[i + 2])); return o; };

// Least-squares affine map src -> dst (arrays of Vector3).
function fitAffine(src, dst) {
  // Solve for 3 rows of [a b c d] minimising |[x y z 1]·row - target|.
  const ATA = Array.from({ length: 4 }, () => new Float64Array(4));
  const ATb = [new Float64Array(4), new Float64Array(4), new Float64Array(4)];
  src.forEach((s, i) => {
    const r = [s.x, s.y, s.z, 1];
    const t = [dst[i].x, dst[i].y, dst[i].z];
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) ATA[a][b] += r[a] * r[b];
      for (let c = 0; c < 3; c++) ATb[c][a] += r[a] * t[c];
    }
  });
  // Mild regularisation towards a pure translation keeps the fit sane.
  for (let a = 0; a < 3; a++) ATA[a][a] += 1e-3;
  const solve4 = (M, b) => {
    const A = M.map((r, i) => [...r, b[i]]);
    for (let k = 0; k < 4; k++) {
      let p = k;
      for (let i = k + 1; i < 4; i++) if (Math.abs(A[i][k]) > Math.abs(A[p][k])) p = i;
      [A[k], A[p]] = [A[p], A[k]];
      for (let i = 0; i < 4; i++) {
        if (i === k) continue;
        const f = A[i][k] / A[k][k];
        for (let j = k; j < 5; j++) A[i][j] -= f * A[k][j];
      }
    }
    return A.map((r, i) => r[4] / r[i]);
  };
  const rows = ATb.map((b) => solve4(ATA, b));
  return (p) => V(
    rows[0][0] * p.x + rows[0][1] * p.y + rows[0][2] * p.z + rows[0][3],
    rows[1][0] * p.x + rows[1][1] * p.y + rows[1][2] * p.z + rows[1][3],
    rows[2][0] * p.x + rows[2][1] * p.y + rows[2][2] * p.z + rows[2][3],
  );
}

// Centroid of the points at one end of a tube-like segment.
function endCentroid(points, dir, which = 1, frac = 0.12) {
  const vs = toVecs(points);
  const proj = vs.map((p) => p.dot(dir));
  const lo = Math.min(...proj), hi = Math.max(...proj);
  const cut = which > 0 ? hi - (hi - lo) * frac : lo + (hi - lo) * frac;
  const sel = vs.filter((p, i) => (which > 0 ? proj[i] >= cut : proj[i] <= cut));
  const c = V(0, 0, 0);
  sel.forEach((p) => c.add(p));
  return c.multiplyScalar(1 / sel.length);
}

/**
 * hra: Map of HRA nodes (already in the target body's frame for the female,
 * or the male HRA frame), prefix 'VH_F_' | 'VH_M_'.
 * target: { 'Ascending colon': Float32Array, ... } point sets of the body.
 * Returns Map(nodeSuffix -> { positions, indices }) in the body's frame.
 */
export function registerGut(hra, prefix, target, wanted, log = console.log) {
  const node = (n) => [...hra.values()].filter((x) => x.name === prefix + n || x.path.includes(prefix + n)).map((x) => x.positions);
  // Pelvic bones give a reliable frame for the pelvic gut; colon centroids
  // add the abdominal context.
  const bones = (re) => concat([...hra.values()].filter((x) => re.test(x.name)).map((x) => x.positions));
  const src = {
    'Hip bone l': bones(new RegExp(`^${prefix}(ilium|ischium|pubis)_(compact|spongy)_bone_L$`)),
    'Hip bone r': bones(new RegExp(`^${prefix}(ilium|ischium|pubis)_(compact|spongy)_bone_R$`)),
    Sacrum: concat(node('sacrum')),
    Coccyx: concat(node('coccyx')),
    'Ascending colon': concat(node('ascending_colon')),
    'Descending colon': concat(node('descending_colon')),
    'Urinary bladder': concat([...hra.values()].filter((x) => x.name.startsWith(prefix) && /urinary_bladder|trigone/.test(x.name)).map((x) => x.positions)),
  };
  const s = [], d = [];
  for (const [k, a] of Object.entries(src)) {
    if (!a.length || !target[k]?.length) { log(`  gut registration: no ${k}`); continue; }
    s.push(centroid(a)); d.push(centroid(target[k]));
    if (/Hip bone|Sacrum|Coccyx/.test(k)) {
      const se = extremes(a), de = extremes(target[k]);
      se.forEach((p, i) => { s.push(p); d.push(de[i]); });
    }
  }
  const affine = fitAffine(s, d);
  let err = 0;
  s.forEach((p, i) => { err += affine(p).distanceTo(d[i]); });
  log(`  gut registration (${prefix}): ${s.length} landmarks, mean residual ${(err / s.length).toFixed(1)} cm`);
  const xf = (a) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i += 3) { const p = affine(V(a[i], a[i + 1], a[i + 2])); o[i] = p.x; o[i + 1] = p.y; o[i + 2] = p.z; } return o; };

  const out = new Map();
  for (const w of wanted) {
    const n = [...hra.values()].find((x) => x.name === prefix + w);
    if (n) out.set(w, { positions: xf(n.positions), indices: n.indices });
  }
  // Snap the caecum (and what hangs off it) under the ascending colon.
  const asc = target['Ascending colon'];
  if (out.has('caecum') && asc?.length) {
    const ascBottom = endCentroid(asc, V(0, 1, 0), -1, 0.08);
    const caeTop = endCentroid(out.get('caecum').positions, V(0, 1, 0), 1, 0.15);
    const delta = ascBottom.clone().sub(caeTop).add(V(0, -1.0, 0));
    const anchor = centroid(out.get('caecum').positions);
    for (const k of ['caecum', 'ileocecal_valve', 'ileum_terminal', 'ileum']) {
      const a = out.get(k)?.positions;
      if (!a) continue;
      for (let i = 0; i < a.length; i += 3) {
        // The ileum follows the snap near the caecum and fades out further away.
        const dist = Math.hypot(a[i] - anchor.x, a[i + 1] - anchor.y, a[i + 2] - anchor.z);
        const w = k === 'ileum' ? Math.exp(-(dist * dist) / (2 * 10 * 10)) : 1;
        a[i] += delta.x * w; a[i + 1] += delta.y * w; a[i + 2] += delta.z * w;
      }
    }
    log(`  caecum snapped by ${delta.length().toFixed(1)} cm`);
  }
  // Snap the rectum to the end of the sigmoid colon closest to it.
  const sig = target['Sigmoid colon'];
  if (out.has('rectum') && sig?.length) {
    const ax = principalAxis(toVecs(sig, 4)).dir;
    const top = endCentroid(out.get('rectum').positions, V(0, 1, 0), 1, 0.12);
    const ends = [endCentroid(sig, ax, 1), endCentroid(sig, ax, -1)];
    const sacrum = target.Sacrum?.length ? centroid(target.Sacrum) : top;
    const end = ends.sort((a, b) => a.distanceTo(sacrum) - b.distanceTo(sacrum))[0];
    const delta = end.clone().sub(top);
    const a = out.get('rectum').positions;
    for (let i = 0; i < a.length; i += 3) { a[i] += delta.x; a[i + 1] += delta.y; a[i + 2] += delta.z; }
    log(`  rectum snapped by ${delta.length().toFixed(1)} cm`);
  }
  return out;
}
