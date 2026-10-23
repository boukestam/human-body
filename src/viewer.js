import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js';

export const BODY_CENTER = new THREE.Vector3(0, 88, 0);
const HOME = new THREE.Vector3(0, 100, 345);

export class Viewer {
  constructor(container) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    // Touch devices get a lower pixel-ratio cap: fill rate is the bottleneck on phones.
    this.coarse = window.matchMedia('(pointer: coarse)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.coarse ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.localClippingEnabled = true;
    renderer.autoClear = false;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.background = new THREE.Color('#0d1117');
    this.scene.background = null;
    this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color('#151d31') },
        uBottom: { value: new THREE.Color('#070a12') },
        uGlow: { value: new THREE.Color('#1a2a52') },
        uAspect: { value: 1 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform vec3 uTop, uBottom, uGlow; uniform float uAspect; varying vec2 vUv;
        void main() {
          vec3 c = mix(uBottom, uTop, smoothstep(0.0, 1.0, vUv.y));
          vec2 d = (vUv - vec2(0.5, 0.56)) * vec2(uAspect, 1.0);
          c += uGlow * exp(-dot(d, d) * 2.6);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
          gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
        }`,
      depthTest: false,
      depthWrite: false,
    }));
    this.backdrop.frustumCulled = false;
    this.backdropScene = new THREE.Scene();
    this.backdropScene.add(this.backdrop);
    this.backdropCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    const hemi = new THREE.HemisphereLight('#fff6ec', '#3a4a5c', 0.9);
    this.scene.add(hemi);
    this.camera = new THREE.PerspectiveCamera(32, 1, 1, 3000);
    this.camera.position.copy(HOME);
    const key = new THREE.DirectionalLight('#ffffff', 1.6);
    key.position.set(0.6, 0.8, 1);
    const rim = new THREE.DirectionalLight('#bcd4ff', 0.7);
    rim.position.set(-0.8, 0.4, -1);
    // Lights follow the camera so the model is always lit from the viewer's side.
    this.camera.add(key, rim);
    this.scene.add(this.camera);

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.target.copy(BODY_CENTER);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 1.1;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 900;
    this.controls.addEventListener('change', () => this.requestRender());

    this.viewHelper = new ViewHelper(this.camera, renderer.domElement);
    this.viewHelper.center = this.controls.target;
    this.viewHelper.setLabels('L', 'S', 'A');

    this.needsRender = true;
    this.renderHooks = [];
    this.renderOverride = null;
    this.timer = new THREE.Timer();
    this.anim = null;
    this.bottomInset = 0;
    this.showHelper = true;

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    renderer.setAnimationLoop(() => this.#tick());
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.backdrop.material.uniforms.uAspect.value = w / h;
    // Keep the model centred in the part of the canvas not covered by the bottom sheet.
    const shift = Math.min(this.bottomInset, h * 0.55) / 2;
    if (shift > 0) this.camera.setViewOffset(w, h, 0, shift, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.renderHooks.forEach((f) => f.resize?.(w, h));
    this.requestRender();
  }

  setBottomInset(px) {
    this.bottomInset = px;
    this.resize();
  }

  setBackdrop(top, bottom, glow) {
    const u = this.backdrop.material.uniforms;
    u.uTop.value.set(top);
    u.uBottom.value.set(bottom);
    u.uGlow.value.set(glow);
    this.background.set(bottom);
    this.requestRender();
  }

  requestRender() {
    this.needsRender = true;
  }

  #tick() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    if (this.anim) this.#stepAnim(dt);
    if (this.viewHelper.animating) {
      this.viewHelper.update(dt);
      this.needsRender = true;
    }
    if (this.controls.update()) this.needsRender = true;
    if (!this.needsRender) return;
    this.needsRender = false;
    this.render();
  }

  render() {
    const r = this.renderer;
    r.setRenderTarget(null);
    r.setClearColor(this.background, 1);
    r.clear();
    if (this.renderOverride) this.renderOverride(r, this.scene, this.camera);
    else {
      r.render(this.backdropScene, this.backdropCamera);
      r.render(this.scene, this.camera);
    }
    for (const h of this.renderHooks) h.afterRender?.();
    if (this.showHelper) this.viewHelper.render(r);
  }

  // Smooth camera transitions.
  flyTo(target, position, duration = 0.8) {
    this.anim = {
      t: 0, duration,
      fromT: this.controls.target.clone(), toT: target.clone(),
      fromP: this.camera.position.clone(), toP: position.clone(),
    };
  }

  #stepAnim(dt) {
    const a = this.anim;
    a.t = Math.min(1, a.t + dt / a.duration);
    const k = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2;
    this.controls.target.lerpVectors(a.fromT, a.toT, k);
    this.camera.position.lerpVectors(a.fromP, a.toP, k);
    this.needsRender = true;
    if (a.t >= 1) this.anim = null;
  }

  frameBox(box, dir) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1.5);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = Math.max(radius / Math.sin(fov / 2) * 0.9, 8);
    const d = dir ? dir.clone().normalize() : this.camera.position.clone().sub(this.controls.target).normalize();
    this.flyTo(center, center.clone().addScaledVector(d, dist));
  }

  setView(name) {
    const dirs = {
      anterior: [0, 0, 1], posterior: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0],
      superior: [0, 1, 0.001], inferior: [0, -1, 0.001],
    };
    const d = new THREE.Vector3(...dirs[name]).normalize();
    const target = this.controls.target.clone();
    const dist = this.camera.position.distanceTo(target);
    this.flyTo(target, target.clone().addScaledVector(d, dist));
  }

  homePosition() {
    const h = this.container.clientHeight || 1;
    const frac = Math.max(0.55, (h - Math.min(this.bottomInset, h * 0.55)) / h);
    return HOME.clone().sub(BODY_CENTER).multiplyScalar(1 / frac).add(BODY_CENTER);
  }

  resetView() {
    this.flyTo(BODY_CENTER, this.homePosition());
  }

  projectToScreen(v) {
    const p = v.clone().project(this.camera);
    const w = this.container.clientWidth, h = this.container.clientHeight;
    return { x: (p.x + 1) / 2 * w, y: (1 - p.y) / 2 * h, visible: p.z < 1 && p.z > -1 };
  }
}
