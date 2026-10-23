import * as THREE from 'three';
import { PART_VERTEX_PARS } from './parts.js';
import { clipPlanes } from './materials.js';

const MAX_DEPTH = 4000;

// Picks the part under a screen point by rendering a 1×1 pixel id/depth pass.
export class Picker {
  constructor(viewer, model) {
    this.viewer = viewer;
    this.model = model;
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
    this.pixel = new Uint8Array(4);
    this.material = null;
  }

  #makeMaterial() {
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...this.model.store.uniforms },
      vertexShader: /* glsl */`
        #include <clipping_planes_pars_vertex>
        ${PART_VERTEX_PARS}
        varying float vId;
        varying float vDepth;
        void main() {
          ivec2 pc = partCoord(partId);
          vec4 st = texelFetch(tPartState, pc, 0);
          vId = partId;
          vec4 w = modelMatrix * vec4(position, 1.0);
          w.xyz += texelFetch(tPartOffset, pc, 0).xyz;
          vec4 mvPosition = viewMatrix * w;
          vDepth = -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
          // Hidden and faded ("ghost") parts cannot be picked.
          if (st.r < 0.5 || st.g > 2.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
          #include <clipping_planes_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <clipping_planes_pars_fragment>
        varying float vId;
        varying float vDepth;
        void main() {
          #include <clipping_planes_fragment>
          float id = floor(vId + 1.5);
          float d = clamp(vDepth / ${MAX_DEPTH.toFixed(1)}, 0.0, 1.0) * 65535.0;
          gl_FragColor = vec4(floor(id / 256.0) / 255.0, mod(id, 256.0) / 255.0, floor(d / 256.0) / 255.0, mod(floor(d), 256.0) / 255.0);
        }`,
      side: THREE.DoubleSide,
      clipping: true,
      clippingPlanes: clipPlanes,
    });
  }

  // Returns { part, structure, point } or null.
  pick(clientX, clientY) {
    if (!this.material) this.#makeMaterial();
    const v = this.viewer;
    const r = v.renderer, scene = v.scene, camera = v.camera;
    const rect = r.domElement.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
    const view = camera.view && camera.view.enabled ? { ...camera.view } : null;
    const offY = view ? view.offsetY : 0;
    camera.setViewOffset(rect.width, rect.height, Math.floor(x), Math.floor(y) + offY, 1, 1);

    const hidden = [];
    for (const c of scene.children) if (c.userData.noXray && c.visible) { c.visible = false; hidden.push(c); }
    const prevOverride = scene.overrideMaterial;
    scene.overrideMaterial = this.material;
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    this.model.withSinglePass(() => r.render(scene, camera));
    r.readRenderTargetPixels(this.target, 0, 0, 1, 1, this.pixel);
    r.setRenderTarget(null);
    scene.overrideMaterial = prevOverride;
    hidden.forEach((o) => (o.visible = true));
    if (view) camera.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    v.requestRender();

    const [a, b, c, d] = this.pixel;
    const id = a * 256 + b - 1;
    if (id < 0) return null;
    const part = this.model.parts[id];
    if (!part) return null;
    const depth = ((c * 256 + d) / 65535) * MAX_DEPTH;
    // Reconstruct the world-space hit point along the view ray.
    const ndc = new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const point = ray.ray.origin.clone().addScaledVector(ray.ray.direction, depth / Math.max(1e-6, ray.ray.direction.dot(forward)));
    return { part, structure: part.structure, point };
  }
}
