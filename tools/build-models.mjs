// Converts the Z-Anatomy FBX exports into compact, per-layer GLB files plus
// metadata used by the viewer. Run `npm run build:data` (see tools/fetch-data.sh).
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { weld, simplify, quantize, meshopt, dedup, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';

THREE.PropertyBinding.sanitizeNodeName = (n) => n;

const SRC = process.env.ZA_FBX || '/tmp/za/repo/Resources/Models/FBX';
const DESC_SRC = process.env.ZA_DESC || '/tmp/za/desc';
const OUT = path.resolve('public/data');
const ONLY = process.argv.slice(2);

const SYSTEM_FILES = [
  { file: 'SkeletalSystem100.fbx', system: 'Skeletal system' },
  { file: 'Joints100.fbx', system: 'Articular system' },
  { file: 'MuscularSystem100.fbx', system: 'Muscular system' },
  { file: 'CardioVascular41.fbx', system: 'Cardiovascular system' },
  { file: 'NervousSystem100.fbx', system: 'Nervous system' },
  { file: 'VisceralSystem100.fbx', system: 'Visceral systems' },
  { file: 'LymphoidOrgans100.fbx', system: 'Lymphoid system' },
  { file: 'Regions of human body100.fbx', system: 'Integumentary system' },
  { file: 'References100.fbx', system: 'Anatomical references' },
];

// Layers shown in the UI. `ratio` is the simplification target, `error` the
// maximum relative deviation the simplifier may introduce.
const LAYERS = {
  skin: { label: 'Skin', ratio: 0.45, error: 0.0006 },
  muscles: { label: 'Muscles', ratio: 0.4, error: 0.0007 },
  fasciae: { label: 'Tendons, fasciae & bursae', ratio: 0.4, error: 0.0008 },
  skeleton: { label: 'Bones & teeth', ratio: 0.45, error: 0.0006 },
  ligaments: { label: 'Joints & ligaments', ratio: 0.45, error: 0.0008 },
  heart: { label: 'Heart', ratio: 0.5, error: 0.0005 },
  arteries: { label: 'Arteries', ratio: 0.5, error: 0.0008 },
  veins: { label: 'Veins', ratio: 0.5, error: 0.0008 },
  cns: { label: 'Brain & spinal cord', ratio: 0.45, error: 0.0006 },
  nerves: { label: 'Nerves', ratio: 0.5, error: 0.0008 },
  senses: { label: 'Eye & ear', ratio: 0.6, error: 0.0005 },
  respiratory: { label: 'Respiratory system', ratio: 0.45, error: 0.0007 },
  digestive: { label: 'Digestive system', ratio: 0.45, error: 0.0007 },
  urinary: { label: 'Urinary system', ratio: 0.5, error: 0.0006 },
  reproductive: { label: 'Reproductive system', ratio: 0.5, error: 0.0006 },
  endocrine: { label: 'Endocrine glands', ratio: 0.6, error: 0.0005 },
  lymphatic: { label: 'Lymphatic system', ratio: 0.5, error: 0.0008 },
  attachments: { label: 'Muscle attachments', ratio: 0.35, error: 0.001 },
  references: { label: 'Reference lines & planes', ratio: 1, error: 0 },
};

const MUSCLE_FUNCTIONS = new Set(['Abductor', 'Adductor', 'Extension', 'Flexion', 'Flexion fingers', 'External rotation',
  'Internal rotator', 'Levator', 'Orbicularis/Constrictor', 'Depressor', 'Extensor extremities', 'Extension hand/foot',
  'Biarticular', 'Flexion hand/foot', 'Ingestion', 'Phonation', 'Superficial', 'Trapezius', 'Masticator', 'Diaphragm']);

function tissueOf(matName, layer) {
  const m = matName.replace(/\.\d+$/, '');
  if (/^Bone/.test(m)) return 'bone';
  if (/^Cartilage/.test(m)) return 'cartilage';
  if (/^Suture/.test(m)) return 'suture';
  if (m === 'Teeth') return 'enamel';
  if (m === 'Teeth-roots') return 'toothroot';
  if (m === 'Dentine') return 'dentine';
  if (MUSCLE_FUNCTIONS.has(m)) return 'muscle';
  if (m === 'Tendon') return 'tendon';
  if (m === 'Bursa') return 'bursa';
  if (m === 'Fascia') return 'fascia';
  if (m === 'Ligament') return 'ligament';
  if (m === 'Articular capsule') return 'capsule';
  if (m === 'Artery') return 'artery';
  if (m === 'Vein') return 'vein';
  if (m === 'Pulmonary artery') return 'pulmonaryArtery';
  if (m === 'Pulmonary vein') return 'pulmonaryVein';
  if (/^Nerve/.test(m)) return 'nerve';
  if (/^(Frontal lobe|Parietal lobe|Temporal lobe|Occipital lobe|Limbic lobe|Insula|Brain|Interlobar sulci)$/.test(m)) return 'greyMatter';
  if (m === 'Cerebellum') return 'cerebellum';
  if (m === 'White matter' || m === 'Brain-Inner') return 'whiteMatter';
  if (/^Nucleus/.test(m)) return layer === 'cns' || layer === 'senses' ? 'nucleus' : 'organ';
  if (m === 'LCR') return 'csf';
  if (m === 'Eye') return 'sclera';
  if (m === 'Cornea') return 'cornea';
  if (m === 'Iris') return 'iris';
  if (m === 'Mucosa' || m === 'Mucosa of stomach') return 'mucosa';
  if (m === 'Gland') return 'gland';
  if (/^Organ/.test(m)) return 'organ';
  if (m === 'Intestine') return 'intestine';
  if (/^Bronchi/.test(m)) return 'bronchi';
  if (/^Lung/.test(m)) return 'lung';
  if (m === 'Gallbladder') return 'gallbladder';
  if (m === 'Peritoneum') return 'peritoneum';
  if (m === 'Ductus') return 'duct';
  if (/^Lymph/.test(m)) return 'lymph';
  if (m === 'Skin-in') return 'skinInner';
  if (/^Skin/.test(m)) return 'skin';
  if (m === 'Nail') return 'nail';
  if (m === 'Black') return 'hair';
  if (m === 'Fat') return 'fat';
  if (/^Origin|^Muscular origin/.test(m)) return 'origin';
  if (/^End/.test(m)) return 'insertion';
  if (/^(Directions|Movement|Planes|Lines)$/.test(m)) return 'reference';
  if (m === 'Text') return null;
  return {
    skin: 'skin', muscles: 'muscle', fasciae: 'fascia', skeleton: 'bone', ligaments: 'ligament', heart: 'heartMuscle',
    arteries: 'artery', veins: 'vein', cns: 'greyMatter', nerves: 'nerve', senses: 'organ', respiratory: 'organ',
    digestive: 'organ', urinary: 'organ', reproductive: 'organ', endocrine: 'gland', lymphatic: 'lymph',
    attachments: 'origin', references: 'reference',
  }[layer];
}

function layerOf(system, groups, name, mats) {
  const has = (g) => groups.includes(g);
  switch (system) {
    case 'Skeletal system': return 'skeleton';
    case 'Articular system': return 'ligaments';
    case 'Muscular system':
      if (groups.some(g => /Tendon sheath|Bursa|Fascia|Synovial/.test(g)) || /fascia|bursa|tendon sheath|aponeurosis|retinaculum|linea alba/i.test(name)) return 'fasciae';
      return 'muscles';
    case 'Cardiovascular system':
      if (has('Heart') || has('Arteries of heart') || has('Cardiac veins')) return 'heart';
      if (has('Venous system')) return 'veins';
      return 'arteries';
    case 'Nervous system':
      if (has('Sense organs')) return 'senses';
      if (has('Peripheral nervous system')) return 'nerves';
      return 'cns';
    case 'Visceral systems':
      if (has('Respiratory system') || has('Thoracic cavity')) return 'respiratory';
      if (has('Urinary system')) return 'urinary';
      if (has('Genital systems')) return 'reproductive';
      if (has('Endocrine glands')) return 'endocrine';
      return 'digestive';
    case 'Lymphoid system': return 'lymphatic';
    case 'Integumentary system': return 'skin';
    case 'Anatomical references': return 'references';
  }
  throw new Error('unknown system ' + system);
}

const NAME_FIXES = {
  'Lat_Fis-ant-Horizont': 'Anterior horizontal ramus of lateral sulcus',
  'Lat_Fis-ant-Vertical': 'Anterior ascending ramus of lateral sulcus',
  'Lat_Fis-post': 'Posterior ramus of lateral sulcus',
  'Sulcus interm_prim-Jensen': 'Intermediate primary sulcus (Jensen)',
  '????????': 'Anterior cardiac veins',
};

function cleanName(raw) {
  let n = raw.trim();
  n = NAME_FIXES[n] || n;
  n = n.replace(/\s*\(\/\/.*\)\s*$/, '');
  return n.replace(/\*/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

// Splits "Tibia.r" / "Soleus muscle.o1r" into parts.
function parseNodeName(raw) {
  const m = raw.match(/^(.*)\.([a-z0-9]*)$/i);
  if (!m) return { base: raw, suffix: '' };
  return { base: m[1], suffix: m[2] };
}

function loadFBX(file) {
  const buf = fs.readFileSync(path.join(SRC, file));
  return new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
}

// Collects triangles of a mesh, grouped by tissue, in world space.
function extractGeometry(mesh, layer) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const index = g.index;
  const mats = [].concat(mesh.material);
  const groups = g.groups.length ? g.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
  const out = new Map();
  const v = new THREE.Vector3();
  const mtx = mesh.matrixWorld;
  // Mirrored (left/right copy) objects carry a negative scale; restore winding.
  const flip = mtx.determinant() < 0;
  const matNames = [];
  for (const grp of groups) {
    const mat = mats[grp.materialIndex] || mats[0];
    matNames.push(mat.name);
    let tissue = tissueOf(mat.name, layer);
    if (layer === 'heart' && tissue === 'muscle') tissue = 'heartMuscle';
    if (!tissue) continue;
    let arr = out.get(tissue);
    if (!arr) out.set(tissue, arr = []);
    for (let i = grp.start; i + 2 < grp.start + grp.count; i += 3) {
      for (const k of flip ? [0, 2, 1] : [0, 1, 2]) {
        const vi = index ? index.getX(i + k) : i + k;
        v.fromBufferAttribute(pos, vi).applyMatrix4(mtx);
        arr.push(v.x, v.y, v.z);
      }
    }
  }
  return { tissues: out, matNames };
}

const entries = [];
const paths = [];
const pathIndex = new Map();
const layerGeoms = Object.fromEntries(Object.keys(LAYERS).map(k => [k, []]));
const groupNames = new Set();

function internPath(p) {
  const key = p.join('\u0001');
  if (!pathIndex.has(key)) { pathIndex.set(key, paths.length); paths.push(p); }
  return pathIndex.get(key);
}

for (const { file, system } of SYSTEM_FILES) {
  console.log('Parsing', file);
  const root = loadFBX(file);
  root.updateMatrixWorld(true);
  const attachMerge = new Map();
  let kept = 0;

  const walk = (obj, groups) => {
    const { base, suffix } = parseNodeName(obj.name);
    if (/^Cross Section/.test(obj.name)) return;
    if (!obj.isMesh) {
      if (suffix === 't' || suffix === 's') return;
      let next = groups;
      if (obj.name && obj !== root) {
        const gname = cleanName(base);
        next = [...groups, gname];
        groupNames.add(gname);
      }
      for (const c of obj.children) walk(c, next);
      return;
    }
    // Meshes may carry children (e.g. muscle attachment markers on bones).
    for (const c of obj.children) walk(c, groups);
    if (/^(j|t|s|i|\d+)$/.test(suffix)) return;
    if (obj.geometry.attributes.position.count < 9) return;

    const att = suffix.match(/^([oe])(\d*)([lr]?)$/);
    if (att) {
      const kind = att[1] === 'o' ? 'Origin' : 'Insertion';
      const side = att[3];
      const muscle = cleanName(base.replace(/^\((.*)\)$/, '$1'));
      const key = `${kind}|${muscle}|${side}`;
      const { tissues } = extractGeometry(obj, 'attachments');
      let e = attachMerge.get(key);
      if (!e) {
        const boneGroups = groups.length ? groups : [];
        e = {
          name: `${kind} of ${muscle}`, side, layer: 'attachments', system: 'Muscular system',
          path: ['Muscular system', 'Muscle attachments', kind === 'Origin' ? 'Origins' : 'Insertions'],
          tissues: new Map(), ref: muscle, bone: boneGroups.at(-1),
        };
        attachMerge.set(key, e);
      }
      const t = kind === 'Origin' ? 'origin' : 'insertion';
      const arr = e.tissues.get(t) || [];
      for (const [, a] of tissues) for (const x of a) arr.push(x);
      e.tissues.set(t, arr);
      return;
    }

    const side = suffix === 'l' || suffix === 'r' ? suffix : '';
    let name = cleanName(base);
    if (name.includes('?')) return;
    let variant = false;
    const pm = name.match(/^\((.*)\)$/);
    if (pm) { name = pm[1]; variant = true; }
    const layer = layerOf(system, groups, name);
    const { tissues, matNames } = extractGeometry(obj, layer);
    if (!tissues.size) return;
    const fn = layer !== 'muscles' ? undefined : matNames.map(m => m.replace(/\.\d+$/, '')).find(m => MUSCLE_FUNCTIONS.has(m));
    const sysPath = [system, ...groups];
    entries.push({ name, side, variant, layer, system, path: sysPath, tissues, fn, rawName: base });
    kept++;
  };
  walk(root, []);
  for (const e of attachMerge.values()) entries.push(e);
  console.log(`  kept ${kept} structures, ${attachMerge.size} attachment areas`);
}

// Assign ids and per-layer geometry lists.
const meta = { layers: {}, paths, entries: [] };
for (const [k, l] of Object.entries(LAYERS)) meta.layers[k] = { label: l.label, count: 0, file: `models/${k}.glb` };

const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
});
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
fs.mkdirSync(path.join(OUT, 'models'), { recursive: true });

entries.forEach((e, i) => {
  e.id = i;
  layerGeoms[e.layer].push(e);
});

let totalTris = 0;
for (const [layer, list] of Object.entries(layerGeoms)) {
  meta.layers[layer].count = list.length;
  if (ONLY.length && !ONLY.includes(layer)) continue;
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(layer);
  const materials = new Map();
  const matFor = (t) => {
    if (!materials.has(t)) materials.set(t, doc.createMaterial(t));
    return materials.get(t);
  };
  for (const e of list) {
    const node = doc.createNode(String(e.id));
    const mesh = doc.createMesh(String(e.id));
    for (const [tissue, arr] of e.tissues) {
      const positions = new Float32Array(arr);
      const idx = new Uint32Array(positions.length / 3);
      for (let i = 0; i < idx.length; i++) idx[i] = i;
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer))
        .setMaterial(matFor(tissue));
      mesh.addPrimitive(prim);
    }
    node.setMesh(mesh);
    scene.addChild(node);
  }
  const cfg = LAYERS[layer];
  await doc.transform(dedup({ keepUniqueNames: true }), weld());
  if (cfg.ratio < 1) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: cfg.ratio, error: cfg.error, lockBorder: true }));
  }
  // Tag structures that are not watertight (used by the X-ray renderer). The
  // check spans all primitives of a mesh, joined by vertex position.
  for (const m of doc.getRoot().listMeshes()) {
    const ids = new Map();
    const edges = new Map();
    for (const p of m.listPrimitives()) {
      const pos = p.getAttribute('POSITION').getArray();
      const idx = p.getIndices().getArray();
      const vid = new Int32Array(pos.length / 3);
      for (let i = 0; i < vid.length; i++) {
        const key = `${pos[i * 3].toFixed(3)},${pos[i * 3 + 1].toFixed(3)},${pos[i * 3 + 2].toFixed(3)}`;
        let id = ids.get(key);
        if (id === undefined) ids.set(key, (id = ids.size));
        vid[i] = id;
      }
      for (let i = 0; i < idx.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const a = vid[idx[i + k]], b = vid[idx[i + ((k + 1) % 3)]];
          const key = a < b ? a * 4194304 + b : b * 4194304 + a;
          edges.set(key, (edges.get(key) || 0) + 1);
        }
      }
    }
    let border = 0;
    for (const c of edges.values()) if (c === 1) border++;
    const open = +(border / Math.max(1, edges.size)).toFixed(4);
    for (const p of m.listPrimitives()) p.setExtras({ open });
  }
  await doc.transform(
    prune(),
    quantize({ quantizePosition: 14, cleanup: false }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
  totalTris += tris;
  const file = path.join(OUT, 'models', `${layer}.glb`);
  await io.write(file, doc);
  meta.layers[layer].tris = tris;
  meta.layers[layer].bytes = fs.statSync(file).size;
  console.log(`${layer}: ${list.length} structures, ${tris} tris, ${(fs.statSync(file).size / 1e6).toFixed(2)} MB`);
}
console.log('total tris', totalTris);

// Descriptions keyed by structure / group name.
const descFiles = new Map();
for (const f of fs.existsSync(DESC_SRC) ? fs.readdirSync(DESC_SRC) : []) {
  descFiles.set(f.replace(/\.txt$/, '').replace(/^\((.*)\)$/, '$1').toLowerCase(), f);
}
function readDesc(name) {
  const f = descFiles.get(name.toLowerCase());
  if (!f) return null;
  let txt = fs.readFileSync(path.join(DESC_SRC, f), 'utf8').replace(/\r/g, '');
  const lines = txt.split('\n').map(l => l.trim());
  let url = null;
  const paras = [];
  let cur = [];
  for (const l of lines) {
    if (/^https?:\/\//.test(l)) { url = l; continue; }
    if (!l) { if (cur.length) { paras.push(cur.join(' ')); cur = []; } continue; }
    if (l.startsWith('!')) continue;
    if (l === l.toUpperCase() && /[A-Z]/.test(l) && l.length < 90) continue;
    cur.push(l);
  }
  if (cur.length) paras.push(cur.join(' '));
  let text = paras.join('\n').replace(/\(\s*,\s*/g, '(').replace(/\(\s*\)/g, '').replace(/ {2,}/g, ' ').trim();
  if (text.length > 6000) text = text.slice(0, text.lastIndexOf('\n', 6000)) || text.slice(0, 6000);
  if (!text && !url) return null;
  return { text, url };
}

const descShards = Array.from({ length: 16 }, () => ({}));
const hash = (s) => { let h = 0; for (const c of s.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 16; };
const wanted = new Set([...entries.map(e => e.name), ...entries.map(e => e.ref).filter(Boolean), ...groupNames, ...SYSTEM_FILES.map(s => s.system)]);
let descCount = 0;
for (const name of wanted) {
  const d = readDesc(name);
  if (!d) continue;
  descShards[hash(name)][name.toLowerCase()] = d;
  descCount++;
}
fs.mkdirSync(path.join(OUT, 'desc'), { recursive: true });
descShards.forEach((s, i) => fs.writeFileSync(path.join(OUT, 'desc', `${i}.json`), JSON.stringify(s)));
console.log('descriptions', descCount, 'of', wanted.size);

for (const e of entries) {
  const o = { i: e.id, n: e.name, l: e.layer, p: internPath(e.path), t: [...e.tissues.keys()] };
  if (e.side) o.s = e.side;
  if (e.variant) o.v = 1;
  if (e.fn) o.f = e.fn;
  if (e.ref) o.r = e.ref;
  if (e.bone) o.b = e.bone;
  meta.entries.push(o);
}
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta));
console.log('entries', meta.entries.length, 'paths', paths.length);
