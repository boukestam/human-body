import * as THREE from 'three';
import { TISSUES } from './palette.js';
import { clipPlanes } from './materials.js';

const HULL_OFFSET = 100;

// Radiograph simulation: accumulates density-weighted thickness of every
// visible closed surface (back faces add depth, front faces subtract it),
// then maps the line integral to film brightness with Beer–Lambert falloff.
// The skin is handled separately (channel B) and cross-checked against the
// nearest/farthest skin depth so gaps in the skin patches don't punch holes.
export class XRay {
  constructor(viewer, model) {
    this.viewer = viewer;
    this.model = model;
    this.enabled = false;
    this.params = { exposure: 0.07, contrast: 1.1, sharpen: 0.9, invert: false, highlight: true };
    const r = viewer.renderer;
    const gl = r.getContext();
    const floatBlend = !!gl.getExtension('EXT_float_blend') && !!gl.getExtension('EXT_color_buffer_float');
    const rtOpts = {
      type: floatBlend ? THREE.FloatType : THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    };
    this.target = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.hullTarget = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.refDepth = { value: 300 };
    this.materials = new Map();
    this.selectedSet = new Set();

    const clipVert = /* glsl */`
      #include <clipping_planes_pars_vertex>
      varying float vDepth;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`;
    this.clipVert = clipVert;

    this.hullMaterial = new THREE.ShaderMaterial({
      uniforms: { uRef: this.refDepth },
      vertexShader: clipVert,
      fragmentShader: /* glsl */`
        #include <clipping_planes_pars_fragment>
        uniform float uRef;
        varying float vDepth;
        void main() {
          #include <clipping_planes_fragment>
          float d = vDepth - uRef;
          gl_FragColor = vec4(${HULL_OFFSET.toFixed(1)} + d, ${HULL_OFFSET.toFixed(1)} - d, 0.0, 0.0);
        }`,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.MaxEquation,
      clipping: true,
      clippingPlanes: clipPlanes,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: {
        tAcc: { value: this.target.texture },
        tHull: { value: this.hullTarget.texture },
        uTexel: { value: new THREE.Vector2() },
        uExposure: { value: 0.05 },
        uContrast: { value: 1.3 },
        uSharpen: { value: 0.8 },
        uInvert: { value: 0 },
        uSkin: { value: TISSUES.skin.density },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform sampler2D tAcc, tHull;
        uniform vec2 uTexel;
        uniform float uExposure, uContrast, uSharpen, uInvert, uSkin;
        float lineIntegral(vec2 uv) {
          vec4 acc = texture2D(tAcc, uv);
          vec2 h = texture2D(tHull, uv).rg;
          float span = h.r > 0.0 ? max(h.r + h.g - ${(2 * HULL_OFFSET).toFixed(1)}, 0.0) : 0.0;
          float skin = acc.b > 0.35 * span ? min(acc.b, span) : span;
          return max(acc.r + skin * uSkin, 0.0);
        }
        float film(vec2 uv) {
          return 1.0 - exp(-lineIntegral(uv) * uExposure);
        }
        void main() {
          float c = film(vUv);
          float blur = 0.0;
          for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) blur += film(vUv + vec2(float(x), float(y)) * uTexel * 1.5);
          blur /= 25.0;
          c = clamp(c + (c - blur) * uSharpen * 2.0, 0.0, 1.0);
          c = pow(c, 1.0 / uContrast);
          float sel = 1.0 - exp(-max(texture2D(tAcc, vUv).g, 0.0) * 0.25);
          float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
          c = clamp(c + n * 0.025, 0.0, 1.0);
          if (uInvert > 0.5) c = 1.0 - c;
          vec2 q = vUv - 0.5;
          float vig = 1.0 - dot(q, q) * 0.55;
          vec3 col = mix(vec3(0.015, 0.02, 0.03), vec3(0.93, 0.97, 1.0), c) * vig;
          col = mix(col, vec3(1.0, 0.62, 0.18) * (0.35 + 0.9 * c), clamp(sel, 0.0, 0.75));
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    }));
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  // channel: 0 = tissue (R), 1 = skin hull (B), -1 = nothing
  materialFor(tissue, selected, sign = 1, sheet = false, channel = 0) {
    const key = `${tissue}|${selected ? 1 : 0}|${sign}|${sheet ? 1 : 0}|${channel}`;
    let m = this.materials.get(key);
    if (m) return m;
    const density = channel === 1 ? sign : (TISSUES[tissue]?.density ?? 0.1) * sign;
    m = new THREE.ShaderMaterial({
      uniforms: {
        uDensity: { value: channel < 0 ? 0 : density },
        uRef: this.refDepth,
        uSel: { value: selected ? 1 : 0 },
        uSheet: { value: sheet ? 1 : 0 },
        uChannel: { value: channel },
      },
      vertexShader: this.clipVert,
      fragmentShader: /* glsl */`
        #include <clipping_planes_pars_fragment>
        uniform float uDensity, uRef, uSel, uSheet, uChannel;
        varying float vDepth;
        void main() {
          #include <clipping_planes_fragment>
          // Closed surfaces integrate thickness; open ones act as thin sheets.
          float d = uSheet > 0.5 ? 0.35 : (vDepth - uRef) * (gl_FrontFacing ? -1.0 : 1.0);
          float v = d * uDensity;
          gl_FragColor = uChannel > 0.5 ? vec4(0.0, v * uSel, v, 0.0) : vec4(v, d * uSel, 0.0, 0.0);
        }`,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      clipping: true,
      clippingPlanes: clipPlanes,
    });
    this.materials.set(key, m);
    return m;
  }

  setSelected(structures) {
    this.selectedSet = new Set(structures);
    if (this.enabled) this.applyMaterials();
  }

  applyMaterials() {
    for (const m of this.model.meshes) {
      const s = m.userData.structure;
      if (!s.root) continue;
      const sel = this.params.highlight && this.selectedSet.has(s);
      const t = m.userData.tissue;
      if (t === 'skin') {
        m.material = this.materialFor(t, sel, s.sign, false, 1);
        continue;
      }
      if (t === 'skinInner') {
        m.material = this.materialFor(t, false, 1, false, -1);
        continue;
      }
      const sheet = s.open > 0.04;
      m.material = this.materialFor(sheet ? t : s.xrayTissue, sel, sheet ? 1 : s.sign, sheet);
    }
  }

  enable(on) {
    this.enabled = on;
    if (on) {
      this.applyMaterials();
      this.viewer.renderOverride = (r, scene, camera) => this.render(r, scene, camera);
    } else {
      this.viewer.renderOverride = null;
    }
    this.viewer.requestRender();
  }

  render(r, scene, camera) {
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    for (const t of [this.target, this.hullTarget]) if (t.width !== size.x || t.height !== size.y) t.setSize(size.x, size.y);
    this.refDepth.value = camera.position.distanceTo(this.viewer.controls.target);
    const hidden = [];
    for (const c of scene.children) if (c.userData.noXray && c.visible) { c.visible = false; hidden.push(c); }

    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.target);
    r.clear(true, false, false);
    r.render(scene, camera);

    // Nearest / farthest skin depth (max blending).
    r.setRenderTarget(this.hullTarget);
    r.clear(true, false, false);
    const skin = this.model.layers.skin;
    if (skin?.loaded && skin.group.visible) {
      const vis = this.model.root.children.map((g) => g.visible);
      this.model.root.children.forEach((g) => (g.visible = g === skin.group));
      const swapped = [];
      for (const s of skin.structures) for (const m of s.meshes) {
        if (m.userData.tissue !== 'skin') { if (m.visible) { m.visible = false; swapped.push([m, null]); } continue; }
        swapped.push([m, m.material]);
        m.material = this.hullMaterial;
      }
      r.render(scene, camera);
      for (const [m, mat] of swapped) { if (mat) m.material = mat; else m.visible = true; }
      this.model.root.children.forEach((g, i) => (g.visible = vis[i]));
    }

    hidden.forEach((c) => (c.visible = true));
    r.setRenderTarget(null);
    const u = this.quad.material.uniforms;
    u.uTexel.value.set(1 / size.x, 1 / size.y);
    u.uExposure.value = this.params.exposure;
    u.uContrast.value = this.params.contrast;
    u.uSharpen.value = this.params.sharpen;
    u.uInvert.value = this.params.invert ? 1 : 0;
    u.uSkin.value = TISSUES.skin.density;
    r.render(this.quadScene, this.quadCamera);
  }
}
