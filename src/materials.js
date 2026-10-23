import * as THREE from 'three';
import { TISSUES, NAME_COLORS, SYSTEM_COLORS, MUSCLE_FUNCTION_COLORS } from './palette.js';
import { PART_VERTEX_PARS } from './parts.js';

// Uniforms shared by every anatomy material.
export const sharedUniforms = {
  uCaps: { value: 0 },
  uTime: { value: 0 },
  uBeatPeriod: { value: 0.85 },
  uBeat: { value: new THREE.Vector2() },
  uHeartCenter: { value: new THREE.Vector3() },
};

// Animation of a layer, read by its shaders (see animation.js).
export const FLOW = { none: 0, artery: 1, vein: 2, nerve: 3, gut: 4, heart: 5, brain: 6 };

// Per-vertex displacement and glow of the animations. flow.x is the distance
// along the structure from its source (cm), flow.y a random phase (< 0: still).
const FLOW_VERTEX = /* glsl */`
vFlowGlow = 0.0;
if (uFlowKind > 5.5) {
  vec3 q = partWorld.xyz * 0.55;
  float a = sin(q.x * 1.3 + uTime * 2.1) * sin(q.y * 0.9 - uTime * 1.6) * sin(q.z * 1.7 + uTime * 1.3 + q.x);
  vFlowGlow = pow(max(a, 0.0), 4.0);
} else if (uFlowKind > 4.5) {
  vec3 hd = partWorld.xyz - uHeartCenter;
  float squeeze = mix(uBeat.x, uBeat.y, smoothstep(-1.0, 3.0, hd.y));
  partWorld.xyz = uHeartCenter + hd * (1.0 - 0.07 * squeeze);
  vFlowGlow = squeeze;
} else if (uFlowKind > 0.5 && flow.y >= 0.0) {
  vec3 nW = normalize(mat3(modelMatrix) * objectNormal);
  if (uFlowKind < 1.5) {
    float s = fract(uTime / uBeatPeriod - 0.12 - flow.x / 55.0);
    float g = smoothstep(0.0, 0.04, s) * exp(-s * 6.0);
    partWorld.xyz += nW * g * 0.07;
    vFlowGlow = g;
  } else if (uFlowKind < 2.5) {
    float s = fract((uTime * 10.0 + flow.x) / 12.0);
    vFlowGlow = smoothstep(0.0, 0.05, s) * exp(-s * 5.0);
  } else if (uFlowKind < 3.5) {
    float x = (uTime * 45.0 - flow.x) / 45.0 + flow.y * 7.0;
    float s = fract(x);
    float fire = step(0.35, fract(sin((floor(x) + flow.y * 131.0) * 12.9898) * 43758.5453));
    float g = fire * smoothstep(0.0, 0.01, s) * exp(-s * 14.0);
    partWorld.xyz += nW * g * 0.05;
    vFlowGlow = g;
  } else {
    float s = (fract((uTime * 6.0 - flow.x) / 40.0) - 0.5) * 40.0;
    float bolus = exp(-s * s / 7.0);
    float ring = exp(-(s - 4.5) * (s - 4.5) / 3.0);
    partWorld.xyz += nW * (0.75 * bolus - 0.3 * ring);
    vFlowGlow = bolus;
  }
}`;

export const clipPlanes = [];

let colorScheme = 'realistic';
let wireframe = false;
const layerMaterials = [];

const VARIED = new Set(['muscle', 'bone', 'greyMatter', 'whiteMatter', 'cerebellum', 'nucleus', 'heartMuscle', 'ligament', 'lymph', 'organ', 'gland']);
const NAMED = new Set(['organ', 'gland', 'mucosa', 'heartMuscle', 'lymph', 'intestine', 'bronchi', 'lung', 'duct', 'cartilage', 'sclera', 'peritoneum']);

function nameColor(name) {
  for (const [re, c] of NAME_COLORS) if (re.test(name)) return c;
  return null;
}

// Display colour (linear) and roughness of one part.
export function partAppearance(s, tissue) {
  const t = TISSUES[tissue] || TISSUES.organ;
  let c;
  if (colorScheme === 'systems') {
    c = new THREE.Color(SYSTEM_COLORS[s.layer] || '#ccc');
    if (tissue === 'tendon' || tissue === 'cartilage') c.lerp(new THREE.Color('#ffffff'), 0.55);
  } else if (colorScheme === 'function' && s.layer !== 'muscles' && s.layer !== 'attachments') {
    c = new THREE.Color(t.color).lerp(new THREE.Color('#808080'), 0.6);
  } else if (colorScheme === 'function' && tissue === 'muscle') {
    c = new THREE.Color(MUSCLE_FUNCTION_COLORS[s.fn] || '#888');
  } else {
    const override = NAMED.has(tissue) || s.layer === 'senses' ? nameColor(s.name) : null;
    c = new THREE.Color(override || t.color);
    // Small tonal variation between neighbouring structures keeps boundaries readable.
    if (VARIED.has(tissue)) c.offsetHSL(0, 0, ((((s.id * 2654435761) >>> 0) % 7) - 3) * 0.014);
  }
  return { color: c, roughness: t.roughness, opacity: Math.min(t.opacity ?? 1, s.opacity ?? 1) };
}

export function setColorScheme(scheme) {
  colorScheme = scheme;
}

export function getColorScheme() {
  return colorScheme;
}

export function setWireframe(on) {
  wireframe = on;
  for (const m of layerMaterials) m.wireframe = on;
}

// The two materials drawing one layer: an opaque pass and a transparent pass.
// Each draws only the parts whose effective opacity matches its pass.
export function makeLayerMaterials(store) {
  const layerOpacity = { value: 1 };
  const flowKind = { value: FLOW.none };
  const flowColor = { value: new THREE.Color(0, 0, 0) };
  const make = (pass) => {
    const m = new THREE.MeshStandardMaterial({
      metalness: 0,
      roughness: 0.5,
      side: THREE.DoubleSide,
      clippingPlanes: clipPlanes,
      wireframe,
      transparent: pass === 1,
      depthWrite: pass === 0,
    });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, store.uniforms, sharedUniforms, { uLayerOpacity: layerOpacity, uPass: { value: pass }, uFlowKind: flowKind, uFlowColor: flowColor });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
${PART_VERTEX_PARS}
uniform float uLayerOpacity;
uniform float uPass;
attribute vec2 flow;
uniform float uFlowKind;
uniform float uTime;
uniform float uBeatPeriod;
uniform vec2 uBeat;
uniform vec3 uHeartCenter;
varying float vFlowGlow;
varying vec4 vPartColor;
varying float vPartMode;
varying float vPartAlpha;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
ivec2 pc = partCoord(partId);
vec4 pState = texelFetch(tPartState, pc, 0);
vec3 partOffset = texelFetch(tPartOffset, pc, 0).xyz;
vPartColor = texelFetch(tPartColor, pc, 0);
vPartMode = pState.g;
float pAlpha = pState.b * uLayerOpacity;
if (pState.g > 2.5) pAlpha = min(pAlpha, 0.05);
else if (pState.g > 0.5) pAlpha = max(pAlpha, 0.85);
vPartAlpha = pAlpha;
bool partDraw = pState.r > 0.5 && ((uPass > 0.5) == (pAlpha < 0.999));`)
        .replace('#include <project_vertex>', `
vec4 partWorld = modelMatrix * vec4(transformed, 1.0);
partWorld.xyz += partOffset;
${FLOW_VERTEX}
vec4 mvPosition = viewMatrix * partWorld;
gl_Position = projectionMatrix * mvPosition;
if (!partDraw) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uCaps;
uniform vec3 uFlowColor;
varying float vFlowGlow;
varying vec4 vPartColor;
varying float vPartMode;
varying float vPartAlpha;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = vPartColor.rgb;
diffuseColor.a = vPartAlpha;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = vPartColor.a;`)
        .replace('#include <opaque_fragment>', `
#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
if (diffuseColor.a < 0.999) {
  float fres = 1.0 - abs(dot(normalize(vViewPosition), normal));
  diffuseColor.a = clamp(diffuseColor.a * mix(0.45, 1.6, fres * fres), 0.0, 1.0);
}
outgoingLight += uFlowColor * vFlowGlow;
vec4 hl = vPartMode > 1.5 && vPartMode < 2.5 ? vec4(0.1, 0.78, 1.0, 0.5) : vPartMode > 0.5 && vPartMode < 1.5 ? vec4(1.0, 0.95, 0.55, 0.22) : vec4(0.0);
outgoingLight = mix(outgoingLight, hl.rgb * (0.35 + 0.65 * max(dot(normal, normalize(vViewPosition)), 0.0)), hl.a);
if (!gl_FrontFacing) {
  if (uCaps > 0.5) {
    float grain = fract(sin(dot(floor(gl_FragCoord.xy * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
    outgoingLight = mix(diffuseColor.rgb * 0.82, hl.rgb, hl.a * 0.7) * (0.96 + grain * 0.06);
    diffuseColor.a = 1.0;
  } else {
    outgoingLight *= 0.8;
  }
}
gl_FragColor = vec4(outgoingLight, diffuseColor.a);`);
    };
    m.customProgramCacheKey = () => `anatomy-${pass}`;
    layerMaterials.push(m);
    return m;
  };
  return { opaque: make(0), transparent: make(1), layerOpacity, flowKind, flowColor };
}
