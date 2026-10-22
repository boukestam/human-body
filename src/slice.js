import * as THREE from 'three';
import { clipPlanes, sharedUniforms } from './materials.js';
import { AXES, computeSection } from './section.js';

export class SliceController {
  constructor(viewer, model, sectionView) {
    this.viewer = viewer;
    this.model = model;
    this.section = sectionView;
    this.enabled = false;
    this.axis = 'transverse';
    this.positions = { transverse: 128, coronal: 0, sagittal: 0.4 };
    this.flip = false;
    this.slab = 0;
    this.showPlane = true;
    this.bounds = new THREE.Box3(new THREE.Vector3(-35, 0, -16), new THREE.Vector3(35, 175, 16));
    this.pending = false;
    this.onUpdate = null;

    const planeMat = new THREE.MeshBasicMaterial({ color: '#38d0ff', transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
    this.planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), planeMat);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: '#38d0ff', transparent: true, opacity: 0.8 }));
    this.planeMesh.add(edges);
    this.planeMesh.renderOrder = 10;
    this.planeGroup = new THREE.Group();
    this.planeGroup.add(this.planeMesh);
    this.planeGroup.userData.noXray = true;
    this.planeGroup.visible = false;
    viewer.scene.add(this.planeGroup);
  }

  get position() { return this.positions[this.axis]; }

  range() {
    const comp = AXES[this.axis].normal.x ? 'x' : AXES[this.axis].normal.y ? 'y' : 'z';
    return [this.bounds.min[comp], this.bounds.max[comp]];
  }

  setBounds(box) {
    this.bounds.copy(box);
    this.section.setBounds(box);
  }

  enable(on) {
    this.enabled = on;
    sharedUniforms.uCaps.value = on ? 1 : 0;
    this.planeGroup.visible = on && this.showPlane;
    if (!on) clipPlanes.length = 0;
    this.update();
  }

  set(opts) {
    Object.assign(this, opts);
    this.update();
  }

  setPosition(v) {
    const [a, b] = this.range();
    this.positions[this.axis] = THREE.MathUtils.clamp(v, a, b);
    this.update();
  }

  update() {
    if (this.enabled) {
      const n = AXES[this.axis].normal;
      const p = this.position;
      clipPlanes.length = 0;
      // Keep the half-space on the "negative" side unless flipped, so the cut
      // surface faces the default camera.
      const keep = this.flip ? n.clone() : n.clone().negate();
      clipPlanes.push(new THREE.Plane(keep, this.flip ? -p : p));
      if (this.slab > 0) {
        const other = keep.clone().negate();
        const q = this.flip ? p + this.slab : p - this.slab;
        clipPlanes.push(new THREE.Plane(other, this.flip ? q : -q));
      }
      this.#updatePlaneMesh();
      this.planeGroup.visible = this.showPlane;
      this.#scheduleSection();
    }
    this.viewer.requestRender();
    this.onUpdate?.();
  }

  #updatePlaneMesh() {
    const A = AXES[this.axis];
    const b = this.bounds;
    const size = b.getSize(new THREE.Vector3());
    const pad = 1.08;
    const m = this.planeMesh;
    m.position.copy(b.getCenter(new THREE.Vector3()));
    m.rotation.set(0, 0, 0);
    if (this.axis === 'transverse') {
      m.rotation.x = -Math.PI / 2;
      m.scale.set(size.x * pad, size.z * pad * 1.4, 1);
      m.position.y = this.position;
    } else if (this.axis === 'coronal') {
      m.scale.set(size.x * pad, size.y * pad, 1);
      m.position.z = this.position;
    } else {
      m.rotation.y = Math.PI / 2;
      m.scale.set(size.z * pad * 1.4, size.y * pad, 1);
      m.position.x = this.position;
    }
    void A;
  }

  #scheduleSection() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.recomputeSection();
    });
  }

  recomputeSection() {
    if (!this.enabled) return;
    const items = computeSection(this.model.visibleMeshes(), this.axis, this.position);
    this.section.setItems(items, this.axis);
  }

  // Name of the vertebra at the current transverse level.
  vertebralLevel() {
    if (this.axis !== 'transverse') return '';
    const y = this.position;
    const verts = this.model.layers.skeleton?.structures.filter((s) => /^(Vertebra [CTL]\d+|Atlas|Axis|Sacrum|Coccyx)/.test(s.name) && s.root);
    if (!verts?.length) return '';
    let best = null, bestD = Infinity;
    for (const s of verts) {
      const d = Math.abs(s.center.y - y);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best || bestD > 6) return '';
    const m = best.name.match(/\(([CTL]\d)\)|([CTL]\d+)/);
    const lvl = m ? (m[1] || m[2]) : best.name;
    return `Vertebral level ≈ ${lvl}`;
  }
}
