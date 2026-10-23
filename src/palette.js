// Visual definitions: tissue appearance, per-layer defaults and colour schemes.

export const TISSUES = {
  bone: { color: '#e6d9bd', roughness: 0.62, label: 'Bone', density: 2.1, ct: 0.95, mri: 0.12 },
  cartilage: { color: '#bcd3d8', roughness: 0.35, label: 'Cartilage', density: 0.25, ct: 0.55, mri: 0.45 },
  suture: { color: '#b9a280', roughness: 0.7, label: 'Suture', density: 1.2, ct: 0.85, mri: 0.15 },
  enamel: { color: '#f5f2e9', roughness: 0.18, label: 'Enamel', density: 2.4, ct: 1, mri: 0.02 },
  toothroot: { color: '#eadbb3', roughness: 0.4, label: 'Tooth root', density: 2.0, ct: 0.97, mri: 0.05 },
  dentine: { color: '#efe2c2', roughness: 0.4, label: 'Dentine', density: 2.0, ct: 0.97, mri: 0.05 },
  muscle: { color: '#a63a2f', roughness: 0.5, label: 'Skeletal muscle', density: 0.12, ct: 0.48, mri: 0.35 },
  tendon: { color: '#e7e0cf', roughness: 0.3, label: 'Tendon', density: 0.2, ct: 0.52, mri: 0.06 },
  bursa: { color: '#d8c6a4', roughness: 0.3, label: 'Bursa', density: 0.05, ct: 0.42, mri: 0.7, opacity: 0.75 },
  fascia: { color: '#dccdb5', roughness: 0.45, label: 'Fascia', density: 0.08, ct: 0.5, mri: 0.1 },
  ligament: { color: '#d9d2bc', roughness: 0.35, label: 'Ligament', density: 0.2, ct: 0.52, mri: 0.06 },
  capsule: { color: '#cec4a8', roughness: 0.4, label: 'Joint capsule', density: 0.15, ct: 0.5, mri: 0.1, opacity: 0.85 },
  fat: { color: '#f0d277', roughness: 0.55, label: 'Fat', density: -0.1, ct: 0.3, mri: 0.95 },
  artery: { color: '#c3221f', roughness: 0.32, label: 'Artery', density: 0.18, ct: 0.6, mri: 0.03 },
  vein: { color: '#2f4fa6', roughness: 0.36, label: 'Vein', density: 0.16, ct: 0.58, mri: 0.08 },
  pulmonaryArtery: { color: '#3f62c4', roughness: 0.32, label: 'Pulmonary artery', density: 0.18, ct: 0.6, mri: 0.03 },
  pulmonaryVein: { color: '#c8302b', roughness: 0.32, label: 'Pulmonary vein', density: 0.18, ct: 0.6, mri: 0.03 },
  heartMuscle: { color: '#9d3b32', roughness: 0.42, label: 'Cardiac muscle', density: 0.2, ct: 0.55, mri: 0.38 },
  nerve: { color: '#f1d35a', roughness: 0.45, label: 'Nerve', density: 0.1, ct: 0.5, mri: 0.42 },
  greyMatter: { color: '#d8aaa0', roughness: 0.55, label: 'Grey matter', density: 0.1, ct: 0.5, mri: 0.48 },
  cerebellum: { color: '#d39b94', roughness: 0.55, label: 'Cerebellum', density: 0.1, ct: 0.5, mri: 0.5 },
  whiteMatter: { color: '#efe6da', roughness: 0.5, label: 'White matter', density: 0.12, ct: 0.53, mri: 0.66 },
  nucleus: { color: '#b98089', roughness: 0.5, label: 'Nucleus', density: 0.1, ct: 0.5, mri: 0.45 },
  csf: { color: '#79b7e3', roughness: 0.15, label: 'Cerebrospinal fluid', density: 0.0, ct: 0.42, mri: 0.08, opacity: 0.6 },
  sclera: { color: '#f4f1ea', roughness: 0.25, label: 'Sclera', density: 0.1, ct: 0.5, mri: 0.3 },
  cornea: { color: '#d4ecf7', roughness: 0.05, label: 'Cornea', density: 0.05, ct: 0.45, mri: 0.3, opacity: 0.35 },
  iris: { color: '#4d6f8e', roughness: 0.4, label: 'Iris', density: 0.1, ct: 0.5, mri: 0.3 },
  mucosa: { color: '#d77d78', roughness: 0.3, label: 'Mucosa', density: 0.1, ct: 0.5, mri: 0.4 },
  gland: { color: '#d39a6a', roughness: 0.45, label: 'Glandular tissue', density: 0.12, ct: 0.55, mri: 0.45 },
  organ: { color: '#a85a48', roughness: 0.4, label: 'Organ parenchyma', density: 0.15, ct: 0.56, mri: 0.4 },
  intestine: { color: '#d99a88', roughness: 0.35, label: 'Intestinal wall', density: -0.2, ct: 0.4, mri: 0.4 },
  bronchi: { color: '#e2cbb3', roughness: 0.35, label: 'Bronchial wall', density: -0.5, ct: 0.2, mri: 0.1 },
  lung: { color: '#e4a3a0', roughness: 0.55, label: 'Lung', density: -0.45, ct: 0.08, mri: 0.03 },
  uterus: { color: '#b4524c', roughness: 0.4, label: 'Uterine wall', density: 0.16, ct: 0.57, mri: 0.42 },
  ovary: { color: '#e3b6a6', roughness: 0.45, label: 'Ovarian tissue', density: 0.14, ct: 0.55, mri: 0.45 },
  tube: { color: '#d98d84', roughness: 0.35, label: 'Uterine tube wall', density: 0.1, ct: 0.5, mri: 0.4 },
  erectile: { color: '#b8656a', roughness: 0.4, label: 'Erectile tissue', density: 0.14, ct: 0.55, mri: 0.5 },
  breastFat: { color: '#f2d79a', roughness: 0.55, label: 'Breast fat', density: -0.08, ct: 0.3, mri: 0.95, opacity: 0.6 },
  nipple: { color: '#b9776a', roughness: 0.5, label: 'Nipple and areola', density: 0.3, ct: 0.4, mri: 0.6 },
  gallbladder: { color: '#5d8f3c', roughness: 0.25, label: 'Gallbladder', density: 0.05, ct: 0.45, mri: 0.15 },
  peritoneum: { color: '#ecd3b8', roughness: 0.3, label: 'Peritoneum', density: 0.02, ct: 0.4, mri: 0.6, opacity: 0.55 },
  duct: { color: '#8dbd5a', roughness: 0.3, label: 'Duct', density: 0.05, ct: 0.45, mri: 0.2 },
  lymph: { color: '#8cc06a', roughness: 0.4, label: 'Lymphoid tissue', density: 0.12, ct: 0.53, mri: 0.45 },
  skin: { color: '#e2ae92', roughness: 0.62, label: 'Skin', density: 0.55, ct: 0.34, mri: 0.85 },
  skinInner: { color: '#c78b78', roughness: 0.7, label: 'Skin (deep surface)', density: 0, ct: 0.34, mri: 0.85 },
  nail: { color: '#efd2c8', roughness: 0.25, label: 'Nail', density: 0.3, ct: 0.6, mri: 0.05 },
  hair: { color: '#35261d', roughness: 0.8, label: 'Hair', density: 0, ct: 0.0, mri: 0.0 },
  origin: { color: '#e04848', roughness: 0.5, label: 'Muscle origin', density: 0, ct: 0, mri: 0 },
  insertion: { color: '#3f6fe0', roughness: 0.5, label: 'Muscle insertion', density: 0, ct: 0, mri: 0 },
  reference: { color: '#3cc8ff', roughness: 0.5, label: 'Reference', density: 0, ct: 0, mri: 0, opacity: 0.7 },
};

// Colour overrides for specific named organs (applied to generic tissues).
export const NAME_COLORS = [
  [/liver/i, '#7d2f24'],
  [/kidney|renal pelvis/i, '#8c3a2f'],
  [/spleen/i, '#6c2838'],
  [/pancrea/i, '#e3b483'],
  [/stomach|oesophagus|duodenum|jejunum|pharynx/i, '#d98f86'],
  [/colon|appendix|taenia|caecum/i, '#d4a08c'],
  [/omentum|mesocolon|meso-appendix/i, '#f0d48a'],
  [/thyroid|parathyroid/i, '#b5503d'],
  [/suprarenal/i, '#d8a14a'],
  [/hypophysis|pineal/i, '#c9867a'],
  [/testis|epididymis/i, '#e2c3b5'],
  [/prostate|seminal gland/i, '#c79a83'],
  [/penis|glans/i, '#c98a7e'],
  [/bladder|ureter|urethra/i, '#d6a594'],
  [/tongue/i, '#c4625f'],
  [/gingiva/i, '#d9827c'],
  [/palate|uvula/i, '#d98a83'],
  [/parotid|submandibular gland|sublingual gland|lacrimal gland/i, '#d8aa78'],
  [/trachea|bronch/i, '#e3cbb2'],
  [/lobe of (left|right) lung/i, '#e6a7a3'],
  [/pleura/i, '#f1d8d2'],
  [/epiglottis/i, '#e6d2bd'],
  [/thymus/i, '#d7b6a0'],
  [/tonsil/i, '#c97a76'],
  [/ventricle|atrium|papillary/i, '#9d3b32'],
  [/leaflet|valve/i, '#e6d3bd'],
  [/lens$/i, '#f2ecd2'],
  [/vitreous|chamber of eyeball/i, '#cfe6f2'],
  [/retina/i, '#d0705a'],
  [/cochlea|vestibule|tympanic/i, '#e3cdb6'],
];

// Opacity overrides for specific structures (so inner anatomy stays visible).
export const NAME_OPACITY = [
  [/^pleura$|vitreous|chamber of eyeball/i, 0.35],
  [/greater omentum|lesser omentum/i, 0.6],
  [/dura|falx|tentorium/i, 0.55],
];

export const LAYER_GROUPS = [
  { label: 'Integument', layers: ['skin'] },
  { label: 'Musculoskeletal', layers: ['muscles', 'fasciae', 'skeleton', 'ligaments', 'attachments'] },
  { label: 'Cardiovascular', layers: ['heart', 'arteries', 'veins'] },
  { label: 'Nervous', layers: ['cns', 'nerves', 'senses'] },
  { label: 'Viscera', layers: ['respiratory', 'digestive', 'urinary', 'reproductive', 'endocrine'] },
  { label: 'Immune', layers: ['lymphatic'] },
  { label: 'Orientation', layers: ['references'] },
];

export const LAYER_COLORS = {
  skin: '#e2ae92', muscles: '#c0453a', fasciae: '#d8ccb4', skeleton: '#e8dcc0', ligaments: '#bdb59e',
  heart: '#a83a30', arteries: '#d6302a', veins: '#3b5fc0', cns: '#e0b0a8', nerves: '#f2d35a', senses: '#9cc6e8',
  respiratory: '#ef9f9b', digestive: '#cf8c6e', urinary: '#c87d68', reproductive: '#b48ac4', endocrine: '#d8a14a',
  lymphatic: '#8cc06a', attachments: '#e05050', references: '#3cc8ff',
};

// Distinct colours per layer for the "systems" colour scheme.
export const SYSTEM_COLORS = {
  skin: '#f0b48f', muscles: '#e0483c', fasciae: '#e8d27a', skeleton: '#f5f0e0', ligaments: '#8fd0c0',
  heart: '#ff4d6d', arteries: '#ff2e2e', veins: '#2e6bff', cns: '#ff9de2', nerves: '#ffe23d', senses: '#5ee0ff',
  respiratory: '#7cf0b0', digestive: '#ffa64d', urinary: '#d4ff5e', reproductive: '#b980ff', endocrine: '#ffcc00',
  lymphatic: '#3dff8a', attachments: '#ff6060', references: '#3cc8ff',
};

// Z-Anatomy groups muscles by primary action; used for the "function" colour scheme.
export const MUSCLE_FUNCTION_COLORS = {
  'Abductor': '#e6194b', 'Adductor': '#3cb44b', 'Extension': '#4363d8', 'Flexion': '#f58231',
  'Flexion fingers': '#ffb366', 'External rotation': '#911eb4', 'Internal rotator': '#42d4f4', 'Levator': '#f032e6',
  'Orbicularis/Constrictor': '#bfef45', 'Depressor': '#fabed4', 'Extensor extremities': '#6f8ff0',
  'Extension hand/foot': '#2f4fb0', 'Biarticular': '#dcbeff', 'Flexion hand/foot': '#c0611d', 'Ingestion': '#9a6324',
  'Phonation': '#fffac8', 'Superficial': '#aaffc3', 'Trapezius': '#808000', 'Masticator': '#ffd8b1', 'Diaphragm': '#469990',
};

export const DEFAULT_VISIBLE = new Set([
  'muscles', 'skeleton', 'ligaments', 'heart', 'arteries', 'veins', 'cns', 'nerves', 'senses',
  'respiratory', 'digestive', 'urinary', 'reproductive', 'endocrine', 'lymphatic',
]);

// Structures hidden on start even when their layer is shown (they would cover others).
// Hidden at start: coverings, and subdivisions that coincide with a whole organ.
export const DEFAULT_HIDDEN_NAMES = /^(spinal dura|falx cerebri|tentorium cerebelli|pleura|greater omentum|.* segment of liver \(\w+\))$/i;

// Visible layers for each view preset.
export const VIEW_PRESETS = {
  xray: ['skin', 'skeleton', 'respiratory', 'heart', 'digestive', 'urinary', 'cns'],
};
