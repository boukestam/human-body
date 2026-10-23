// Builds the viewer's model data for both sexes.
//
//   male   = Z-Anatomy (+ caecum / rectum / ileum from the HRA male, registered)
//   female = Z-Anatomy warped onto the HRA Visible Human Female body, minus
//            male-only structures, plus the HRA female reproductive organs,
//            breasts, uterine vessels and gut segments.
//
// Output: public/data/models/{m,f}/<layer>.glb (one merged mesh per layer),
// public/data/meta.json and sharded descriptions. See tools/fetch-data.sh.
import fs from 'node:fs';
import path from 'node:path';
import { extractZAnatomy } from './lib/za.mjs';
import { loadHRA } from './lib/hra.mjs';
import { buildFemaleWarp } from './lib/female.mjs';
import { registerGut } from './lib/supplement.mjs';
import { headFrame, femaleHair, femaleEyebrow, femalePelvis } from './lib/procedural.mjs';
import { LAYERS } from './lib/layers.mjs';
import { FEMALE_STRUCTURES, GUT_STRUCTURES, MALE_ONLY, DESC_ALIASES } from './lib/hra-catalog.mjs';
import { weld, fromIndexed, simplify, compact, structureStats, ready as meshReady } from './lib/mesh.mjs';
import { soupToBVH } from './lib/landmarks.mjs';
import * as THREE from 'three';
import { writeLayer, ready as gltfReady } from './lib/gltf.mjs';
import { writeDescriptions } from './lib/descriptions.mjs';

const OUT = path.resolve('public/data');
const log = (...a) => console.log(...a);
const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

await meshReady;
await gltfReady;

const z = extractZAnatomy();
const fRaw = await loadHRA('f');
const mRaw = await loadHRA('m');
log(`sources loaded (${elapsed()})`);

const { warp, femaleNodes } = buildFemaleWarp(z, fRaw, { log: (m) => log('  ' + m) });
log(`female warp ready (${elapsed()})`);

// ------------------------------------------------------------------ female procedural models
const warpArray = (a) => {
  const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 3) { const p = warp.apply(a[i], a[i + 1], a[i + 2]); o[i] = p[0]; o[i + 1] = p[1]; o[i + 2] = p[2]; }
  return o;
};
const zEntry = (key) => {
  const [name, side = ''] = key.split(/ (?=[lr]$)/);
  return z.entries.find((x) => x.name === name && x.side === side);
};
const zWarped = (key) => {
  const arrs = Object.values(zEntry(key).tissues);
  const all = new Float32Array(arrs.reduce((n, a) => n + a.length, 0));
  let k = 0;
  for (const a of arrs) { all.set(a, k); k += a.length; }
  return warpArray(all);
};
const frame = headFrame(femaleNodes);
const pelvis = femalePelvis(femaleNodes, zWarped, (m) => log('  ' + m));
// Female geometry replacing the warped Z-Anatomy one, keyed by 'name|side'.
const femaleReplace = new Map([
  ['Hairs of head|', femaleHair(femaleNodes, frame)],
  ['Hairs of eyebrow|l', femaleEyebrow(femaleNodes, 1, frame)],
  ['Hairs of eyebrow|r', femaleEyebrow(femaleNodes, -1, frame)],
  ['Pubic hairs|', pelvis.pubicHair],
  ['Urinary bladder|', pelvis.bladder],
]);
const femaleDeform = new Map([['Ureter|l', pelvis.ureterDeform.l], ['Ureter|r', pelvis.ureterDeform.r]]);
const FEMALE_EXT = ['Visceral systems', 'Genital systems', 'Female genital system', 'Female external genitalia'];
const procedural = [
  ['Female urethra', '', 'urinary', 'duct', ['Visceral systems', 'Urinary system'], pelvis.urethra],
  ['Glans of clitoris', '', 'reproductive', 'erectile', [...FEMALE_EXT, 'Clitoris'], pelvis.glans],
  ['Body of clitoris', '', 'reproductive', 'erectile', [...FEMALE_EXT, 'Clitoris'], pelvis.clitoralBody],
  ['Crus of clitoris', 'l', 'reproductive', 'erectile', [...FEMALE_EXT, 'Clitoris'], pelvis.crura.l],
  ['Crus of clitoris', 'r', 'reproductive', 'erectile', [...FEMALE_EXT, 'Clitoris'], pelvis.crura.r],
  ['Bulb of vestibule', 'l', 'reproductive', 'erectile', FEMALE_EXT, pelvis.bulbs.l],
  ['Bulb of vestibule', 'r', 'reproductive', 'erectile', FEMALE_EXT, pelvis.bulbs.r],
  ['Greater vestibular gland', 'l', 'reproductive', 'gland', FEMALE_EXT, pelvis.glands.l],
  ['Greater vestibular gland', 'r', 'reproductive', 'gland', FEMALE_EXT, pelvis.glands.r],
  ['Ovarian artery', 'l', 'arteries', 'artery', zEntry('Left testicular artery').path, pelvis.ovarian.artery.l],
  ['Ovarian artery', 'r', 'arteries', 'artery', zEntry('Left testicular artery').path, pelvis.ovarian.artery.r],
  ['Ovarian vein', 'l', 'veins', 'vein', zEntry('Left testicular vein').path, pelvis.ovarian.vein.l],
  ['Ovarian vein', 'r', 'veins', 'vein', zEntry('Left testicular vein').path, pelvis.ovarian.vein.r],
];
log(`female procedural models ready (${elapsed()})`);

// ------------------------------------------------------------------ entries
const entries = [];
for (const e of z.entries) {
  const maleOnly = e.layer === 'reproductive' || MALE_ONLY.test(e.name);
  entries.push({ ...e, sex: maleOnly ? 'm' : undefined, src: 'za', tissueList: Object.keys(e.tissues) });
}
for (const s of FEMALE_STRUCTURES) {
  const node = femaleNodes.get(s.node);
  if (!node) { log('  missing HRA node', s.node); continue; }
  entries.push({ ...s, src: 'hra', node, tissueList: [s.tissue] });
}
for (const g of GUT_STRUCTURES) entries.push({ ...g, src: 'gut', tissueList: [g.tissue] });
for (const [name, side, layer, tissue, p, mesh] of procedural) entries.push({ name, side, layer, tissue, path: p, sex: 'f', src: 'proc', mesh, tissueList: [tissue] });

let partCount = 0;
entries.forEach((e, i) => {
  e.id = i;
  e.partStart = partCount;
  partCount += e.tissueList.length;
});
log(`${entries.length} structures, ${partCount} parts`);

// ------------------------------------------------------------------ gut registration
const pointsOf = (names, xform) => {
  const out = {};
  for (const n of names) {
    const [name, side = ''] = n.split(/ (?=[lr]$)/);
    const e = z.entries.find((x) => x.name === name && x.side === side);
    if (!e) continue;
    const arrs = Object.values(e.tissues);
    const all = new Float32Array(arrs.reduce((s, a) => s + a.length, 0));
    let k = 0;
    for (const a of arrs) { all.set(a, k); k += a.length; }
    // Subsample triangle soups (every 3rd vertex) for speed.
    const sub = new Float32Array(Math.floor(all.length / 9) * 3);
    for (let i = 0; i < sub.length / 3; i++) sub.set(all.subarray(i * 9, i * 9 + 3), i * 3);
    out[n] = xform ? warpArray(sub) : sub;
  }
  return out;
};
const gutTargets = ['Ascending colon', 'Descending colon', 'Sigmoid colon', 'Urinary bladder', 'Sacrum', 'Coccyx', 'Hip bone l', 'Hip bone r'];
const gutNodes = GUT_STRUCTURES.map((g) => g.node);
const gut = {
  m: registerGut(mRaw, 'VH_M_', pointsOf(gutTargets), gutNodes, (m) => log(m)),
  f: registerGut(femaleNodes, 'VH_F_', pointsOf(gutTargets, true), gutNodes, (m) => log(m)),
};
log(`gut registered (${elapsed()})`);

// ------------------------------------------------------------------ geometry
// meshes[sex][entryId] = [{ tissue, partId, mesh }]
const meshes = { m: new Map(), f: new Map() };
for (const e of entries) {
  const cfg = LAYERS[e.layer];
  const parts = { m: [], f: [] };
  e.tissueList.forEach((tissue, k) => {
    const partId = e.partStart + k;
    if (e.src === 'za') {
      const male = simplify(weld(e.tissues[tissue]), cfg.ratio, cfg.error);
      if (e.sex !== 'f') parts.m.push({ tissue, partId, mesh: male });
      const key = `${e.name}|${e.side || ''}`;
      if (e.sex === 'm') return;
      if (femaleReplace.has(key)) {
        if (k === 0) parts.f.push({ tissue, partId, mesh: simplify(fromIndexed(femaleReplace.get(key).positions, femaleReplace.get(key).indices), cfg.ratio, cfg.error) });
      } else {
        const positions = warpArray(male.positions);
        parts.f.push({ tissue, partId, mesh: { positions: femaleDeform.has(key) ? femaleDeform.get(key)(positions) : positions, indices: male.indices } });
      }
    } else if (e.src === 'proc') {
      parts.f.push({ tissue, partId, mesh: simplify(fromIndexed(e.mesh.positions, e.mesh.indices), cfg.ratio, cfg.error) });
    } else if (e.src === 'hra') {
      parts.f.push({ tissue, partId, mesh: simplify(fromIndexed(e.node.positions, e.node.indices), cfg.ratio, cfg.error, 12000) });
    } else if (e.src === 'gut') {
      for (const sex of ['m', 'f']) {
        const g = gut[sex].get(e.node);
        if (g) parts[sex].push({ tissue, partId, mesh: simplify(fromIndexed(g.positions, g.indices), cfg.ratio, cfg.error, 12000) });
      }
    }
  });
  for (const sex of ['m', 'f']) if (parts[sex].length) meshes[sex].set(e.id, parts[sex]);
}
log(`geometry processed (${elapsed()})`);

// ------------------------------------------------------------------ female skin
// The female skin layer uses the real female skin surface, split into the
// Z-Anatomy skin regions by assigning each triangle to the nearest warped region.
let femaleSkinSign = 1;
{
  const node = femaleNodes.get('VH_F_skin');
  const fskin = simplify(fromIndexed(node.positions, node.indices), 0.4, 0.0004);
  const regions = entries.filter((e) => e.layer === 'skin' && e.src === 'za' && meshes.f.get(e.id)?.some((p) => p.tissue === 'skin'));
  const soups = [];
  const triEntry = [];
  for (const e of regions) {
    const m = meshes.f.get(e.id).find((p) => p.tissue === 'skin').mesh;
    const soup = new Float32Array(m.indices.length * 3);
    for (let i = 0; i < m.indices.length; i++) soup.set(m.positions.subarray(m.indices[i] * 3, m.indices[i] * 3 + 3), i * 3);
    soups.push(soup);
    for (let t = 0; t < m.indices.length / 3; t++) triEntry.push(e.id);
  }
  const { bvh } = soupToBVH(soups);
  const buckets = new Map();
  const c = new THREE.Vector3();
  const target = {};
  const p = fskin.positions, idx = fskin.indices;
  let vol = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, d = idx[t + 2] * 3;
    c.set((p[a] + p[b] + p[d]) / 3, (p[a + 1] + p[b + 1] + p[d + 1]) / 3, (p[a + 2] + p[b + 2] + p[d + 2]) / 3);
    const hit = bvh.closestPointToPoint(c, target);
    const id = triEntry[hit.faceIndex];
    let list = buckets.get(id);
    if (!list) buckets.set(id, (list = []));
    list.push(idx[t], idx[t + 1], idx[t + 2]);
    vol += p[a] * (p[b + 1] * p[d + 2] - p[b + 2] * p[d + 1]) - p[a + 1] * (p[b] * p[d + 2] - p[b + 2] * p[d]) + p[a + 2] * (p[b] * p[d + 1] - p[b + 1] * p[d]);
  }
  femaleSkinSign = vol < 0 ? -1 : 1;
  for (const e of regions) {
    const parts = meshes.f.get(e.id).filter((x) => x.tissue !== 'skin' && x.tissue !== 'skinInner');
    const tris = buckets.get(e.id);
    if (tris) parts.push({ tissue: 'skin', partId: e.partStart + e.tissueList.indexOf('skin'), mesh: compact({ positions: p, indices: Uint32Array.from(tris) }) });
    e.femaleSkin = true;
    if (parts.length) meshes.f.set(e.id, parts); else meshes.f.delete(e.id);
  }
  log(`female skin: ${idx.length / 3} triangles over ${buckets.size} regions (${elapsed()})`);
}

// ------------------------------------------------------------------ output
fs.rmSync(path.join(OUT, 'models'), { recursive: true, force: true });
const meta = { layers: {}, paths: [], entries: [], partCount };
const pathIndex = new Map();
const internPath = (p) => {
  const key = p.join('\u0001');
  if (!pathIndex.has(key)) { pathIndex.set(key, meta.paths.length); meta.paths.push(p); }
  return pathIndex.get(key);
};
for (const [k, l] of Object.entries(LAYERS)) meta.layers[k] = { label: l.label, count: {}, bytes: {}, tris: {} };

for (const sex of ['m', 'f']) {
  fs.mkdirSync(path.join(OUT, 'models', sex), { recursive: true });
  for (const layer of Object.keys(LAYERS)) {
    const parts = [];
    const structs = {};
    let count = 0;
    for (const e of entries) {
      if (e.layer !== layer) continue;
      const ps = meshes[sex].get(e.id);
      if (!ps) continue;
      count++;
      const st = structureStats(ps);
      if (sex === 'f' && e.femaleSkin) st.sign = femaleSkinSign;
      structs[e.id] = [st.sign, st.open, st.dominant];
      for (const p of ps) parts.push({ partId: p.partId, mesh: p.mesh });
    }
    const file = path.join(OUT, 'models', sex, `${layer}.glb`);
    const { tris, bytes } = await writeLayer(file, layer, parts, { structs });
    Object.assign(meta.layers[layer].count, { [sex]: count });
    Object.assign(meta.layers[layer].tris, { [sex]: tris });
    Object.assign(meta.layers[layer].bytes, { [sex]: bytes });
    log(`${sex}/${layer}: ${count} structures, ${tris} tris, ${(bytes / 1e6).toFixed(2)} MB`);
  }
}

for (const e of entries) {
  const o = { i: e.id, n: e.name, l: e.layer, p: internPath(e.path), t: e.tissueList, q: e.partStart };
  if (e.side) o.s = e.side;
  if (e.variant) o.v = 1;
  if (e.fn) o.f = e.fn;
  if (e.ref) o.r = e.ref;
  if (e.bone) o.b = e.bone;
  if (e.sex) o.x = e.sex;
  if (e.src !== 'za') o.src = e.src === 'proc' ? 'proc' : 'hra';
  meta.entries.push(o);
}
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta));

const names = [...entries.map((e) => e.name), ...entries.map((e) => e.ref).filter(Boolean), ...entries.flatMap((e) => e.path)];
const n = writeDescriptions(path.join(OUT, 'desc'), names, DESC_ALIASES);
log(`descriptions: ${n}; done in ${elapsed()}`);
