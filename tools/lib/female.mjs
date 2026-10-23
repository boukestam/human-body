// Builds the male (Z-Anatomy) -> female (HRA Visible Human Female) space warp.
// The female keeps her own proportions, skin shape, pelvis and spine, while her
// arms are rotated into the male's anatomical-position pose.
import * as THREE from 'three';
import { soupToBVH, indexedToSoup, cast, bbox, band, centroid, extremes, principalAxis, armCentroids, perpendicular } from './landmarks.mjs';
import { fitRBF, gridWarp, subsample } from './rbf.mjs';
import { buildArmRig } from './pose.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function zSoup(z, pred, tissues) {
  const out = [];
  for (const e of z.entries) {
    if (!pred(e)) continue;
    for (const [t, a] of Object.entries(e.tissues)) if (!tissues || tissues.includes(t)) out.push(a);
  }
  return out;
}
const concat = (arrs) => {
  const n = arrs.reduce((s, a) => s + a.length, 0);
  const o = new Float32Array(n);
  let k = 0;
  for (const a of arrs) { o.set(a, k); k += a.length; }
  return o;
};
const fSoup = (nodes) => concat(nodes.map((n) => indexedToSoup(n.positions, n.indices)));

// Frame transform for HRA female data: feet on y = 0, body centred like the male.
export function femaleFrame(z, f) {
  const zSkin = bbox(concat(zSoup(z, (e) => e.layer === 'skin', ['skin'])));
  const fSkin = bbox(f.get('VH_F_skin').positions);
  return V(0, zSkin.min.y - fSkin.min.y, (zSkin.min.z + zSkin.max.z) / 2 - (fSkin.min.z + fSkin.max.z) / 2);
}

export function transformNodes(f, offset) {
  const out = new Map();
  for (const [k, n] of f) {
    const p = new Float32Array(n.positions);
    for (let i = 0; i < p.length; i += 3) { p[i] += offset.x; p[i + 1] += offset.y; p[i + 2] += offset.z; }
    out.set(k, { ...n, positions: p });
  }
  return out;
}

export function buildFemaleWarp(z, fRaw, { log = console.log } = {}) {
  const offset = femaleFrame(z, fRaw);
  const f = transformNodes(fRaw, offset);
  const pairs = [];
  const add = (src, dst, w = 'skin') => { if (src && dst) pairs.push({ src, dst, kind: w }); };

  // ------------------------------------------------------------- arm pose
  // Rotate the male arms at the shoulder to the female's arm angle first, so
  // the smooth warp only has to absorb shape differences.
  const fSkinNode = f.get('VH_F_skin');
  const rawZSkin = concat(zSoup(z, (e) => e.layer === 'skin', ['skin', 'nail']));
  const samplePts = [], sampleLabels = [];
  for (const e of z.entries) {
    if (e.layer !== 'skin') continue;
    const lab = e.path.includes('Regions of upper limb') ? 1 : 0;
    for (const a of Object.values(e.tissues)) for (let i = 0; i < a.length; i += 6) { samplePts.push(a[i], a[i + 1], a[i + 2]); sampleLabels.push(lab); }
  }
  const zEntry = (name, side = '') => z.entries.find((e) => e.name === name && e.side === side);
  const rawBone = (name, side) => { const e = zEntry(name, side); return e ? concat(Object.values(e.tissues)) : null; };
  const arms = [];
  for (const [side, sd] of [[1, 'l'], [-1, 'r']]) {
    const hum = rawBone('Humerus', sd);
    const hb = bbox(hum);
    const pivotZ = centroid(band(hum, hb.max.y - 4, hb.max.y + 1));
    const za = principalAxis(armCentroids(rawZSkin, side, 60, 130));
    const fa = principalAxis(armCentroids(fSkinNode.positions, side, 55, 125));
    arms.push({ side, pivot: pivotZ, dir: za.dir, rotation: new THREE.Quaternion().setFromUnitVectors(za.dir, fa.dir) });
    log(`arm ${sd}: rotate ${(za.dir.angleTo(fa.dir) * 180 / Math.PI).toFixed(1)}° about ${pivotZ.toArray().map((v) => v.toFixed(1))}`);
  }
  const pose = buildArmRig({ points: Float32Array.from(samplePts), labels: Float32Array.from(sampleLabels) }, arms);
  const poseArr = (a) => {
    const o = new Float32Array(a.length);
    for (let i = 0; i < a.length; i += 3) { const p = pose(a[i], a[i + 1], a[i + 2]); o[i] = p[0]; o[i + 1] = p[1]; o[i + 2] = p[2]; }
    return o;
  };

  // ------------------------------------------------------------- skin meshes
  const zSkinSoup = poseArr(rawZSkin);
  const fSkinSoup = indexedToSoup(fSkinNode.positions, fSkinNode.indices);
  const ZS = soupToBVH([zSkinSoup]);
  const FS = soupToBVH([fSkinSoup]);
  const zPts = zSkinSoup, fPts = fSkinNode.positions;

  // ------------------------------------------------------------- skeleton
  const zByName = (name, side = '') => z.entries.find((e) => e.name === name && e.side === side);
  const zBone = (name, side) => { const e = zByName(name, side); return e ? poseArr(concat(Object.values(e.tissues))) : null; };
  const fNode = (name) => {
    const parts = [...f.values()].filter((n) => n.name === name || n.path.includes(name));
    return parts.length ? concat(parts.map((n) => n.positions)) : undefined;
  };
  const fUnion = (re) => concat([...f.values()].filter((n) => re.test(n.name)).map((n) => n.positions));

  const vert = [];
  const zVertName = (k) => (k === 'C1' ? 'Atlas (C1)' : k === 'C2' ? 'Axis (C2)' : `Vertebra ${k}`);
  for (let i = 1; i <= 7; i++) vert.push([`C${i}`, zBone(zVertName(`C${i}`)), fNode(`VH_F_cervical_vertebra_${i}`)]);
  for (let i = 1; i <= 12; i++) vert.push([`T${i}`, zBone(zVertName(`T${i}`)), fNode(`VH_F_thoracic_vertebra_${i}`)]);
  const levels = {};
  for (const [k, zb, fb] of vert) {
    if (!zb || !fb) { log('missing vertebra', k); continue; }
    const zc = centroid(zb), fc = centroid(fb);
    levels[k] = { z: zc, f: fc };
    add(zc, fc, 'bone');
  }
  // Lumbar: the female has six lumbar vertebrae; map by fraction along the column.
  const zL = [1, 2, 3, 4, 5].map((i) => centroid(zBone(`Vertebra L${i}`)));
  const fL = [1, 2, 3, 4, 5, 6].map((i) => centroid(fNode(`VH_F_lumbar_vertebra_${i}`)));
  const fLumbarAt = (t) => {
    const s = t * (fL.length - 1);
    const i = Math.min(Math.floor(s), fL.length - 2);
    return fL[i].clone().lerp(fL[i + 1], s - i);
  };
  zL.forEach((p, i) => add(p, fLumbarAt(i / (zL.length - 1)), 'bone'));
  for (const [zn, fn] of [['Sacrum', 'VH_F_sacrum'], ['Coccyx', 'VH_F_coccyx']]) {
    const zb = zBone(zn), fb = fNode(fn);
    add(centroid(zb), centroid(fb), 'bone');
  }
  for (const [side, S] of [['l', 'L'], ['r', 'R']]) {
    const zb = zBone('Hip bone', side);
    const fb = fUnion(new RegExp(`^VH_F_(ilium|ischium|pubis)_(compact|spongy)_bone_${S}$`));
    const fe = extremes(fb);
    extremes(zb).forEach((p, d) => add(p, fe[d], 'bone'));
    add(centroid(zb), centroid(fb), 'bone');
    // Leg bones: slice centroids along the femur/tibia/fibula.
    const zLeg = concat(['Femur', 'Patella', 'Tibia', 'Fibula'].map((n) => zBone(n, side)));
    const fLeg = fNode(`VH_F_lower_limb_${S}`);
    const zb2 = bbox(zLeg), fb2 = bbox(fLeg);
    for (let t = 0.04; t <= 0.97; t += 0.06) {
      const zy = zb2.min.y + t * (zb2.max.y - zb2.min.y), fy = fb2.min.y + t * (fb2.max.y - fb2.min.y);
      const zc = band(zLeg, zy - 0.8, zy + 0.8), fc = band(fLeg, fy - 0.8, fy + 0.8);
      if (zc.length > 9 && fc.length > 9) add(centroid(zc), centroid(fc), 'bone');
    }
    levels['knee' + side] = { z: zb2.min.y + 0.5 * (zb2.max.y - zb2.min.y), f: fb2.min.y + 0.5 * (fb2.max.y - fb2.min.y) };
    levels['ankle' + side] = { z: zb2.min.y, f: fb2.min.y };
  }

  // ------------------------------------------------------------- body heights
  const sole = { z: bbox(zPts).min.y, f: bbox(fPts).min.y };
  const top = { z: bbox(zPts).max.y, f: bbox(fPts).max.y };
  const crotchOf = (pts, from) => {
    for (let y = from; y < from + 120; y += 0.5) if (band(pts, y, y + 0.5, (x) => Math.abs(x) < 1.0).length > 2) return y;
    return from + 80;
  };
  // The male's external genitalia are separate meshes, so skin alone gives the crotch.
  const symphysis = (pts) => { let m = Infinity; for (let i = 0; i < pts.length; i += 3) if (Math.abs(pts[i]) < 3 && pts[i + 1] < m) m = pts[i + 1]; return m; };
  const zPelvis = concat([zBone('Hip bone', 'l'), zBone('Hip bone', 'r')]);
  const fPelvis = fUnion(/^VH_F_(ilium|ischium|pubis)_(compact|spongy)_bone_[LR]$/);
  const crotch = { z: symphysis(zPelvis) - 4, f: symphysis(fPelvis) - 4 };
  void crotchOf;
  const ankle = { z: (levels.anklel.z + levels.ankler.z) / 2, f: (levels.anklel.f + levels.ankler.f) / 2 };
  const knee = { z: (levels.kneel.z + levels.kneer.z) / 2, f: (levels.kneel.f + levels.kneer.f) / 2 };
  const iliac = { z: bbox(zBone('Hip bone', 'l')).max.y, f: bbox(fUnion(/^VH_F_ilium_compact_bone_L$/)).max.y };
  const yOf = (k) => ({ z: levels[k].z.y, f: levels[k].f.y });
  const T12 = yOf('T12'), T6 = yOf('T6'), T1 = yOf('T1'), C3 = yOf('C3');
  log('levels z/f', JSON.stringify({ sole, ankle, knee, crotch, iliac, T12, T1, C3, top }, (k, v) => (typeof v === 'number' ? +v.toFixed(1) : v)));

  // Piecewise-linear height correspondence through a list of levels.
  const heights = (list, steps) => {
    const out = [];
    for (let s = 0; s < list.length - 1; s++) {
      const a = list[s], b = list[s + 1];
      const n = steps[s];
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        out.push({ z: a.z + (b.z - a.z) * t, f: a.f + (b.f - a.f) * t });
      }
    }
    return out;
  };

  // Torso & neck: rays from the body axis at matching heights.
  const midZ = (pts, y) => {
    const b = band(pts, y - 0.8, y + 0.8, (x) => Math.abs(x) < 5);
    if (b.length < 6) return null;
    let lo = Infinity, hi = -Infinity;
    for (let i = 2; i < b.length; i += 3) { lo = Math.min(lo, b[i]); hi = Math.max(hi, b[i]); }
    return hi - lo > 8 ? (lo + hi) / 2 : null;
  };
  const torsoLevels = heights([{ z: crotch.z + 2, f: crotch.f + 2 }, iliac, T12, T6, T1, C3], [5, 6, 6, 6, 4]);
  for (const h of torsoLevels) {
    const zz = midZ(zPts, h.z), fz = midZ(fPts, h.f);
    if (zz === null || fz === null) continue;
    for (let a = 0; a < 360; a += 15) {
      const th = (a * Math.PI) / 180;
      const d = V(Math.sin(th), 0, Math.cos(th));
      add(cast(ZS, V(0, h.z, zz), d), cast(FS, V(0, h.f, fz), d));
    }
  }
  // Head: rays from the head centre in all upward / sideways directions.
  const headCentre = (pts, y0, y1) => centroid(band(pts, y0, y1));
  const zh = headCentre(zPts, C3.z + 8, top.z), fh = headCentre(fPts, C3.f + 8, top.f);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < 90; i++) {
    const y = 1 - (i / 89) * 1.6;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const d = V(Math.cos(golden * i) * r, y, Math.sin(golden * i) * r);
    if (d.y < -0.55) continue;
    add(cast(ZS, zh, d), cast(FS, fh, d));
  }
  // Legs: rays from each leg's centre.
  for (const side of [1, -1]) {
    for (const h of heights([{ z: ankle.z + 3, f: ankle.f + 3 }, knee, { z: crotch.z - 2, f: crotch.f - 2 }], [6, 8])) {
      const zc = centroid(band(zPts, h.z - 0.6, h.z + 0.6, (x) => x * side > 0.5));
      const fc = centroid(band(fPts, h.f - 0.6, h.f + 0.6, (x) => x * side > 0.5));
      for (let a = 0; a < 360; a += 22.5) {
        const th = (a * Math.PI) / 180;
        const d = V(Math.sin(th), 0, Math.cos(th));
        add(cast(ZS, zc, d), cast(FS, fc, d));
      }
    }
    // Feet: extremal points below the ankle.
    const zf = band(zPts, sole.z - 1, ankle.z, (x) => x * side > 0);
    const ff = band(fPts, sole.f - 1, ankle.f, (x) => x * side > 0);
    const fe = extremes(ff);
    extremes(zf).forEach((p, d) => add(p, fe[d]));
    add(centroid(zf), centroid(ff));
  }

  // ------------------------------------------------------------- arms
  // The female keeps her own (slightly abducted) arm pose. Arm landmarks are
  // parameterised from the shoulder joint to the wrist; the female wrist
  // distance is the male one scaled by body height.
  const heightRatio = (top.f - sole.f) / (top.z - sole.z);
  const mapY = (y) => {
    const ls = [T12, T6, T1, C3];
    for (let i = 0; i < ls.length - 1; i++) if (y <= ls[i + 1].z || i === ls.length - 2) {
      const t = (y - ls[i].z) / (ls[i + 1].z - ls[i].z);
      return ls[i].f + t * (ls[i + 1].f - ls[i].f);
    }
  };
  for (const [side, sd] of [[1, 'l'], [-1, 'r']]) {
    const hum = zBone('Humerus', sd);
    const fore = concat([zBone('Radius', sd), zBone('Ulna', sd)]);
    const hb = bbox(hum), fb = bbox(fore);
    const zp = centroid(band(hum, hb.max.y - 4, hb.max.y + 1));
    const zw = centroid(band(fore, fb.min.y - 1, fb.min.y + 3));
    const zdir = zw.clone().sub(zp).normalize();
    const zLen = zw.distanceTo(zp);
    const fc = armCentroids(fPts, side, crotch.f - 25, T1.f - 6);
    const fa = principalAxis(fc);
    const fy = mapY(zp.y);
    const fp = fa.center.clone().addScaledVector(fa.dir, (fy - fa.center.y) / fa.dir.y);
    const fLen = zLen * heightRatio;
    const zu = perpendicular(zdir, V(0, 0, 1)), zv = zdir.clone().cross(zu);
    const fu = perpendicular(fa.dir, V(0, 0, 1)), fv = fa.dir.clone().cross(fu);
    log(`arm ${sd}: shoulder ${zp.toArray().map((v) => v.toFixed(1))} -> ${fp.toArray().map((v) => v.toFixed(1))}, abduction diff ${(zdir.angleTo(fa.dir) * 180 / Math.PI).toFixed(1)}°`);
    for (let t = 0.12; t <= 1.0; t += 0.055) {
      const zo = zp.clone().addScaledVector(zdir, t * zLen), fo = fp.clone().addScaledVector(fa.dir, t * fLen);
      for (let a = 0; a < 360; a += 30) {
        const th = (a * Math.PI) / 180;
        const zd = zu.clone().multiplyScalar(Math.cos(th)).addScaledVector(zv, Math.sin(th));
        const fd = fu.clone().multiplyScalar(Math.cos(th)).addScaledVector(fv, Math.sin(th));
        add(cast(ZS, zo, zd, 12), cast(FS, fo, fd, 12), 'arm');
      }
    }
    // Hand: centroid and the point farthest along the arm.
    const handOf = (pts, p0, dir, len) => {
      const out = [];
      for (let i = 0; i < pts.length; i += 3) {
        const p = V(pts[i], pts[i + 1], pts[i + 2]);
        const s2 = p.clone().sub(p0).dot(dir);
        const radial = p.clone().sub(p0).addScaledVector(dir, -s2).length();
        if (s2 > len + 2 && radial < 12) out.push(p.x, p.y, p.z);
      }
      return out;
    };
    const zh2 = handOf(zPts, zp, zdir, zLen), fh2 = handOf(fPts, fp, fa.dir, fLen);
    if (zh2.length && fh2.length) {
      add(centroid(zh2), centroid(fh2), 'arm');
      const far = (pts, p0, dir) => { let b = -1, bp = null; for (let i = 0; i < pts.length; i += 3) { const p = V(pts[i], pts[i + 1], pts[i + 2]); const d = p.clone().sub(p0).dot(dir); if (d > b) { b = d; bp = p; } } return bp; };
      add(far(zh2, zp, zdir), far(fh2, fp, fa.dir), 'arm');
    }
  }

  // ------------------------------------------------------------- fit
  const disp = pairs.map((p) => p.src.distanceTo(p.dst));
  const med = [...disp].sort((a, b) => a - b)[Math.floor(disp.length / 2)];
  // Drop pairs whose displacement disagrees with their neighbours'.
  const dv = pairs.map((p) => p.dst.clone().sub(p.src));
  const kept = pairs.filter((p, i) => {
    if (disp[i] > Math.max(30, med * 5)) return false;
    const mean = V(0, 0, 0);
    let n = 0;
    for (let j = 0; j < pairs.length; j++) {
      if (j === i || pairs[j].src.distanceTo(p.src) > 7) continue;
      mean.add(dv[j]);
      n++;
    }
    return n < 3 || dv[i].distanceTo(mean.multiplyScalar(1 / n)) < 6;
  });
  log(`landmarks: ${pairs.length} (${kept.length} kept), median displacement ${med.toFixed(1)} cm`);
  const used = subsample(kept, 1400);
  const fn = fitRBF(used.map((p) => p.src), used.map((p) => p.dst), 0.5);
  let err = 0;
  for (const p of kept) { const [x, y, zz] = fn(p.src.x, p.src.y, p.src.z); err += p.dst.distanceTo(V(x, y, zz)); }
  log(`mean landmark residual ${(err / kept.length).toFixed(2)} cm`);
  const box = bbox(zPts).expandByScalar(12);
  box.min.y = Math.min(box.min.y, -5);
  const grid = gridWarp(fn, box.min, box.max, 1.25);
  const warp = { apply: (x, y, zz) => { const p = pose(x, y, zz); return grid.apply(p[0], p[1], p[2]); } };
  return { warp, offset, pairs: kept, femaleNodes: f };
}
