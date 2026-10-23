// Parses the Z-Anatomy FBX exports into a flat list of anatomical structures
// with world-space triangle soups grouped by tissue. Results are cached.
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

THREE.PropertyBinding.sanitizeNodeName = (n) => n;

const SRC = process.env.ZA_FBX || '/tmp/za/repo/Resources/Models/FBX';
const CACHE = process.env.ZA_CACHE || '/tmp/za/cache.v8';

export const SYSTEM_FILES = [
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

export const MUSCLE_FUNCTIONS = new Set(['Abductor', 'Adductor', 'Extension', 'Flexion', 'Flexion fingers', 'External rotation',
  'Internal rotator', 'Levator', 'Orbicularis/Constrictor', 'Depressor', 'Extensor extremities', 'Extension hand/foot',
  'Biarticular', 'Flexion hand/foot', 'Ingestion', 'Phonation', 'Superficial', 'Trapezius', 'Masticator', 'Diaphragm']);

export function tissueOf(matName, layer) {
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

export function cleanName(raw) {
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


export function extractZAnatomy({ useCache = true } = {}) {
  if (useCache && fs.existsSync(CACHE)) return v8.deserialize(fs.readFileSync(CACHE));
  const entries = [];
  const groupNames = new Set();
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

  // Plain, serialisable form: tissue -> Float32Array of triangle-soup positions.
  for (const e of entries) e.tissues = Object.fromEntries([...e.tissues].map(([t, a]) => [t, new Float32Array(a)]));
  const out = { entries, groupNames: [...groupNames], systems: SYSTEM_FILES.map((s) => s.system) };
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, v8.serialize(out));
  return out;
}
