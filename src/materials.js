import * as THREE from 'three';
import { TISSUES, NAME_COLORS, SYSTEM_COLORS, MUSCLE_FUNCTION_COLORS } from './palette.js';

// Uniforms shared by every anatomy material.
export const sharedUniforms = {
  uCaps: { value: 0 },
};

export const clipPlanes = [];

const cache = new Map();
const highlightCache = new Map();
let colorScheme = 'realistic';

function nameColor(name) {
  for (const [re, c] of NAME_COLORS) if (re.test(name)) return c;
  return null;
}

function patchShader(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCaps = sharedUniforms.uCaps;
    shader.uniforms.uHighlight = material.userData.highlightUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uCaps;
uniform vec4 uHighlight;`)
      .replace('#include <opaque_fragment>', `
#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
if (diffuseColor.a < 0.999) {
  float fres = 1.0 - abs(dot(normalize(vViewPosition), normal));
  diffuseColor.a = clamp(diffuseColor.a * mix(0.45, 1.6, fres * fres), 0.0, 1.0);
}
outgoingLight = mix(outgoingLight, uHighlight.rgb * (0.35 + 0.65 * max(dot(normal, normalize(vViewPosition)), 0.0)), uHighlight.a);
if (!gl_FrontFacing) {
  if (uCaps > 0.5) {
    float grain = fract(sin(dot(floor(gl_FragCoord.xy * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
    outgoingLight = mix(diffuseColor.rgb * 0.82, uHighlight.rgb, uHighlight.a * 0.7) * (0.96 + grain * 0.06);
    diffuseColor.a = 1.0;
  } else {
    outgoingLight *= 0.55;
  }
}
gl_FragColor = vec4(outgoingLight, diffuseColor.a);`);
  };
  material.customProgramCacheKey = () => 'anatomy';
}

export function colorFor(desc) {
  if (colorScheme === 'systems') {
    const base = new THREE.Color(SYSTEM_COLORS[desc.layer] || '#ccc');
    if (desc.tissue === 'tendon' || desc.tissue === 'cartilage') base.lerp(new THREE.Color('#ffffff'), 0.55);
    return base;
  }
  if (colorScheme === 'function' && desc.layer === 'muscles' && desc.tissue === 'muscle') {
    return new THREE.Color(MUSCLE_FUNCTION_COLORS[desc.fn] || '#888');
  }
  if (colorScheme === 'function' && desc.layer !== 'muscles' && desc.layer !== 'attachments') {
    return new THREE.Color(TISSUES[desc.tissue]?.color || '#ccc').lerp(new THREE.Color('#808080'), 0.6);
  }
  const c = new THREE.Color(desc.override || TISSUES[desc.tissue]?.color || '#cccccc');
  if (desc.vary !== undefined && desc.vary !== 3) c.offsetHSL(0, 0, (desc.vary - 3) * 0.014);
  return c;
}

const VARIED = new Set(['muscle', 'bone', 'greyMatter', 'whiteMatter', 'cerebellum', 'nucleus', 'heartMuscle', 'ligament', 'lymph', 'organ', 'gland']);

const GENERIC = new Set(['organ', 'gland', 'mucosa', 'heartMuscle', 'lymph', 'intestine', 'bronchi', 'lung', 'duct', 'cartilage', 'sclera', 'peritoneum']);

// One material per (layer, tissue, colour override, muscle function).
export function getMaterial(layer, tissue, structure) {
  const override = GENERIC.has(tissue) || (layer === 'senses') ? nameColor(structure.name) : null;
  const fn = layer === 'muscles' && tissue === 'muscle' ? structure.fn || '' : '';
  // Small tonal variation between neighbouring structures makes boundaries readable.
  const vary = VARIED.has(tissue) ? ((structure.id * 2654435761) >>> 0) % 7 : 3;
  const key = `${layer}|${tissue}|${override || ''}|${fn}|${structure.opacity ?? ''}|${vary}`;
  let m = cache.get(key);
  if (m) return m;
  const t = TISSUES[tissue] || TISSUES.organ;
  m = new THREE.MeshStandardMaterial({
    roughness: t.roughness,
    metalness: 0,
    side: THREE.DoubleSide,
    clippingPlanes: clipPlanes,
  });
  m.userData = {
    layer, tissue, override, fn, vary,
    baseOpacity: Math.min(t.opacity ?? 1, structure.opacity ?? 1),
    layerOpacity: 1,
    highlightUniform: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  m.color.copy(colorFor(m.userData));
  patchShader(m);
  applyOpacity(m);
  cache.set(key, m);
  return m;
}

export function applyOpacity(m) {
  const o = m.userData.baseOpacity * m.userData.layerOpacity;
  const transparent = o < 0.999;
  if (m.transparent !== transparent) m.needsUpdate = true;
  m.transparent = transparent;
  m.opacity = o;
  m.depthWrite = !transparent;
}

export function setLayerOpacity(layer, value) {
  for (const m of cache.values()) {
    if (m.userData.layer !== layer) continue;
    m.userData.layerOpacity = value;
    applyOpacity(m);
  }
  for (const [key, h] of highlightCache) {
    const src = h.userData.source;
    h.opacity = key.endsWith('ghost') ? Math.min(src.opacity, 0.1) : Math.max(src.opacity, 0.85);
  }
}

export function setColorScheme(scheme) {
  colorScheme = scheme;
  for (const m of cache.values()) m.color.copy(colorFor(m.userData));
  for (const h of highlightCache.values()) h.color.copy(h.userData.source.color);
}

export function getColorScheme() {
  return colorScheme;
}

// Highlighted copy of a material (selection / hover tint).
export function getHighlight(material, kind) {
  const key = material.uuid + kind;
  let h = highlightCache.get(key);
  if (h) return h;
  h = material.clone();
  h.userData = { ...material.userData, source: material, highlightUniform: { value: new THREE.Vector4() } };
  const v = h.userData.highlightUniform.value;
  if (kind === 'select') v.set(0.15, 0.85, 1.0, 0.42);
  else if (kind === 'hover') v.set(1.0, 0.95, 0.55, 0.22);
  else v.set(0, 0, 0, 0);
  h.clippingPlanes = clipPlanes;
  h.opacity = kind === 'ghost' ? Math.min(material.opacity, 0.1) : Math.max(material.opacity, 0.85);
  h.transparent = h.opacity < 0.999;
  h.depthWrite = !h.transparent;
  patchShader(h);
  h.customProgramCacheKey = () => 'anatomy';
  highlightCache.set(key, h);
  return h;
}

export function allMaterials() {
  return [...cache.values(), ...highlightCache.values()];
}
