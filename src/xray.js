import * as THREE from 'three';
import { TISSUES } from './palette.js';
import { clipPlanes } from './materials.js';
import { PART_VERTEX_PARS } from './parts.js';

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
    this.highlight = { value: 1 };

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
          float skin = acc.b > 0.6 * span ? min(acc.b, span) : span;
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

  // Accumulation material: density-weighted signed depth per fragment.
  #makeMaterials() {
    const vert = (extra) => /* glsl */`
      #include <clipping_planes_pars_vertex>
      ${PART_VERTEX_PARS}
      varying float vDepth;
      varying vec4 vXray;
      varying float vSel;
      void main() {
        ivec2 pc = partCoord(partId);
        vec4 st = texelFetch(tPartState, pc, 0);
        vXray = texelFetch(tPartXray, pc, 0);
        vSel = st.g > 1.5 && st.g < 2.5 ? 1.0 : 0.0;
        vec4 w = modelMatrix * vec4(position, 1.0);
        w.xyz += texelFetch(tPartOffset, pc, 0).xyz;
        vec4 mvPosition = viewMatrix * w;
        vDepth = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
        ${extra}
        if (st.r < 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        #include <clipping_planes_vertex>
      }`;
    const common = {
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      clipping: true,
      clippingPlanes: clipPlanes,
    };
    this.accumMaterial = new THREE.ShaderMaterial({
      ...common,
      uniforms: { ...this.model.store.uniforms, uRef: this.refDepth, uHighlight: this.highlight },
      vertexShader: vert(''),
      fragmentShader: /* glsl */`
        #include <clipping_planes_pars_fragment>
        uniform float uRef, uHighlight;
        varying float vDepth;
        varying vec4 vXray;
        varying float vSel;
        void main() {
          #include <clipping_planes_fragment>
          if (vXray.b < -0.5) discard;
          // Closed surfaces integrate thickness; open ones act as thin sheets.
          float d = vXray.g > 0.5 ? 0.35 : (vDepth - uRef) * (gl_FrontFacing ? -1.0 : 1.0);
          float v = d * vXray.r;
          float sel = vSel * uHighlight;
          gl_FragColor = vXray.b > 0.5 ? vec4(0.0, v * sel, v, 0.0) : vec4(v, d * sel, 0.0, 0.0);
        }`,
      blendEquation: THREE.AddEquation,
      blendEquationAlpha: THREE.AddEquation,
    });
    // Nearest / farthest skin depth (max blending), robust to gaps in the skin.
    this.hullMaterial = new THREE.ShaderMaterial({
      ...common,
      uniforms: { ...this.model.store.uniforms, uRef: this.refDepth },
      vertexShader: vert('if (vXray.b < 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);'),
      fragmentShader: /* glsl */`
        #include <clipping_planes_pars_fragment>
        uniform float uRef;
        varying float vDepth;
        varying vec4 vXray;
        varying float vSel;
        void main() {
          #include <clipping_planes_fragment>
          float d = vDepth - uRef;
          gl_FragColor = vec4(${HULL_OFFSET.toFixed(1)} + d, ${HULL_OFFSET.toFixed(1)} - d, 0.0, 0.0);
        }`,
      blendEquation: THREE.MaxEquation,
      blendEquationAlpha: THREE.MaxEquation,
    });
  }

  enable(on) {
    this.enabled = on;
    if (on && !this.accumMaterial) this.#makeMaterials();
    this.viewer.renderOverride = on ? (r, scene, camera) => this.render(r, scene, camera) : null;
    this.viewer.requestRender();
  }

  // Draws only the opaque copy of every layer mesh (each part exactly once).
  #withLayerMeshes(scene, fn) {
    const hidden = [];
    for (const c of scene.children) if (c.userData.noXray && c.visible) { c.visible = false; hidden.push(c); }
    this.model.withSinglePass(fn);
    hidden.forEach((o) => (o.visible = true));
  }

  render(r, scene, camera) {
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    for (const t of [this.target, this.hullTarget]) if (t.width !== size.x || t.height !== size.y) t.setSize(size.x, size.y);
    this.refDepth.value = camera.position.distanceTo(this.viewer.controls.target);
    this.highlight.value = this.params.highlight ? 1 : 0;
    const prevOverride = scene.overrideMaterial;
    r.setClearColor(0x000000, 0);
    this.#withLayerMeshes(scene, () => {
      r.setRenderTarget(this.target);
      r.clear(true, false, false);
      scene.overrideMaterial = this.accumMaterial;
      r.render(scene, camera);
      r.setRenderTarget(this.hullTarget);
      r.clear(true, false, false);
      const skin = this.model.layers.skin;
      if (skin?.visible && this.model.isLoaded('skin')) {
        const vis = this.model.root.children.map((g) => g.visible);
        this.model.root.children.forEach((g) => (g.visible = g === skin.group));
        scene.overrideMaterial = this.hullMaterial;
        r.render(scene, camera);
        this.model.root.children.forEach((g, i) => (g.visible = vis[i]));
      }
    });
    scene.overrideMaterial = prevOverride;
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
