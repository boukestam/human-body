import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { getMaterial } from './materials.js';
import { NAME_OPACITY, DEFAULT_HIDDEN_NAMES } from './palette.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const BASE = import.meta.env.BASE_URL + 'data/';

export class AnatomyModel {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'anatomy';
    this.structures = [];
    this.layers = {};
    this.paths = [];
    this.meshes = [];
    this.meta = null;
    this.listeners = new Set();
  }

  async loadMeta() {
    const meta = await (await fetch(BASE + 'meta.json')).json();
    this.meta = meta;
    this.paths = meta.paths;
    for (const [key, l] of Object.entries(meta.layers)) {
      const group = new THREE.Group();
      group.name = key;
      this.root.add(group);
      this.layers[key] = { key, ...l, group, loaded: false, visible: false, opacity: 1, structures: [], progress: 0 };
    }
    for (const e of meta.entries) {
      const s = {
        id: e.i,
        name: e.n,
        side: e.s || '',
        layer: e.l,
        path: meta.paths[e.p],
        tissues: e.t,
        fn: e.f,
        ref: e.r,
        bone: e.b,
        variant: !!e.v,
        root: null,
        meshes: [],
        hidden: DEFAULT_HIDDEN_NAMES.test(e.n),
        center: new THREE.Vector3(),
        box: new THREE.Box3(),
        offset: new THREE.Vector3(),
      };
      for (const [re, o] of NAME_OPACITY) if (re.test(s.name)) s.opacity = o;
      s.label = displayName(s);
      this.structures[s.id] = s;
      this.layers[s.layer].structures.push(s);
    }
    return meta;
  }

  async loadLayer(key, onProgress) {
    const layer = this.layers[key];
    if (layer.loaded || layer.loading) return layer.loading;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    layer.loading = new Promise((resolve, reject) => {
      loader.load(BASE + layer.file, (gltf) => {
        this.#ingest(layer, gltf.scene);
        layer.loaded = true;
        resolve(layer);
      }, (ev) => {
        if (ev.total) layer.progress = ev.loaded / ev.total;
        onProgress?.(layer);
      }, reject);
    });
    return layer.loading;
  }

  #ingest(layer, scene) {
    scene.updateMatrixWorld(true);
    const nodes = [...scene.children];
    for (const node of nodes) {
      const s = this.structures[+node.name];
      if (!s) continue;
      const wrapper = new THREE.Group();
      wrapper.name = s.label;
      wrapper.userData.structure = s;
      const meshes = [];
      node.traverse((o) => { if (o.isMesh) meshes.push(o); });
      for (const mesh of meshes) {
        const g = mesh.geometry;
        const src = g.attributes.position;
        const pos = new Float32Array(src.count * 3);
        const v = new THREE.Vector3();
        for (let i = 0; i < src.count; i++) {
          v.fromBufferAttribute(src, i).applyMatrix4(mesh.matrixWorld);
          pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setIndex(g.index);
        geo.computeVertexNormals();
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
        const tissue = mesh.material.name;
        const m = new THREE.Mesh(geo, getMaterial(layer.key, tissue, s));
        m.userData.structure = s;
        m.userData.tissue = tissue;
        m.userData.open = g.userData.open || 0;
        m.userData.baseMaterial = m.material;
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        wrapper.add(m);
        s.meshes.push(m);
        this.meshes.push(m);
        s.box.union(geo.boundingBox);
        g.dispose();
      }
      s.box.getCenter(s.center);
      // Structure-level orientation and dominant tissue for the X-ray renderer.
      let vol = 0, best = 0;
      for (const m of s.meshes) {
        const v = signedVolume(m.geometry.attributes.position.array, m.geometry.index.array, s.center);
        vol += v;
        const n = m.geometry.index.count;
        if (n > best) { best = n; s.xrayTissue = m.userData.tissue; }
      }
      s.sign = vol < 0 ? -1 : 1;
      // Skin patches are not always closed; orient them by checking that the
      // outer surface faces away from the deep (inner) surface.
      const outer = s.meshes.find((m) => m.userData.tissue === 'skin');
      const inner = s.meshes.find((m) => m.userData.tissue === 'skinInner');
      if (outer && inner) {
        const ip = inner.geometry.attributes.position.array;
        let cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < ip.length; i += 3) { cx += ip[i]; cy += ip[i + 1]; cz += ip[i + 2]; }
        const n = ip.length / 3;
        cx /= n; cy /= n; cz /= n;
        const op = outer.geometry.attributes.position.array;
        const on = outer.geometry.attributes.normal.array;
        let dot = 0;
        for (let i = 0; i < op.length; i += 3) dot += on[i] * (op[i] - cx) + on[i + 1] * (op[i + 1] - cy) + on[i + 2] * (op[i + 2] - cz);
        s.sign = dot < 0 ? -1 : 1;
      }
      s.open = s.meshes[0]?.userData.open || 0;
      s.root = wrapper;
      wrapper.visible = !s.hidden;
      layer.group.add(wrapper);
    }
    layer.group.visible = layer.visible;
  }

  structuresUnder(pathPrefix) {
    const n = pathPrefix.length;
    return this.structures.filter((s) => s && s.path.length >= n && pathPrefix.every((p, i) => s.path[i] === p));
  }

  counterpart(s) {
    if (!s.side) return null;
    const other = s.side === 'l' ? 'r' : 'l';
    return this.layers[s.layer].structures.find((x) => x.name === s.name && x.side === other) || null;
  }

  isShown(s) {
    return !!s.root && this.layers[s.layer].visible && !s.hidden;
  }

  visibleMeshes() {
    const out = [];
    for (const l of Object.values(this.layers)) {
      if (!l.visible || !l.loaded || l.opacity <= 0.02) continue;
      for (const s of l.structures) if (!s.hidden && s.root) for (const m of s.meshes) out.push(m);
    }
    return out;
  }
}

function signedVolume(p, idx, c) {
  const cx = c.x, cy = c.y, cz = c.z;
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ax = p[a] - cx, ay = p[a + 1] - cy, az = p[a + 2] - cz;
    const bx = p[b] - cx, by = p[b + 1] - cy, bz = p[b + 2] - cz;
    const qx = p[c] - cx, qy = p[c + 1] - cy, qz = p[c + 2] - cz;
    v += ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
  }
  return v;
}

export function displayName(s) {
  const side = s.side === 'l' ? ' (left)' : s.side === 'r' ? ' (right)' : '';
  return s.name.charAt(0).toUpperCase() + s.name.slice(1) + side;
}
