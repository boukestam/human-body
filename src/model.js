import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { makeLayerMaterials, partAppearance } from './materials.js';
import { PartStore, MODE } from './parts.js';
import { NAME_OPACITY, DEFAULT_HIDDEN_NAMES, TISSUES } from './palette.js';

const BASE = import.meta.env.BASE_URL + 'data/';
export const SEXES = { m: 'Male', f: 'Female' };

// Holds every structure and, per layer and sex, one merged mesh. Per-part
// state lives in the PartStore textures.

// Smooth, area-weighted vertex normals as a normalised Int16 attribute.
function vertexNormals(geo) {
  const pos = geo.getAttribute('position');
  const idx = geo.index.array;
  const n = pos.count;
  const p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { p[i * 3] = pos.getX(i); p[i * 3 + 1] = pos.getY(i); p[i * 3 + 2] = pos.getZ(i); }
  const acc = new Float32Array(n * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    acc[a] += nx; acc[a + 1] += ny; acc[a + 2] += nz;
    acc[b] += nx; acc[b + 1] += ny; acc[b + 2] += nz;
    acc[c] += nx; acc[c + 1] += ny; acc[c + 2] += nz;
  }
  const out = new Int16Array(n * 3);
  for (let i = 0; i < n * 3; i += 3) {
    const l = Math.hypot(acc[i], acc[i + 1], acc[i + 2]) || 1;
    out[i] = Math.round((acc[i] / l) * 32767); out[i + 1] = Math.round((acc[i + 1] / l) * 32767); out[i + 2] = Math.round((acc[i + 2] / l) * 32767);
  }
  return new THREE.BufferAttribute(out, 3, true);
}

export class AnatomyModel {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'anatomy';
    this.structures = [];
    this.parts = [];
    this.layers = {};
    this.paths = [];
    this.sex = 'm';
    this.store = null;
  }

  async loadMeta() {
    const meta = await (await fetch(BASE + 'meta.json')).json();
    this.meta = meta;
    this.paths = meta.paths;
    this.store = new PartStore(meta.partCount);
    for (const [key, l] of Object.entries(meta.layers)) {
      const group = new THREE.Group();
      group.name = key;
      this.root.add(group);
      const mats = makeLayerMaterials(this.store);
      this.layers[key] = {
        key, label: l.label, counts: l.count, bytes: l.bytes, group, mats,
        visible: false, opacity: 1, structures: [], data: {}, progress: 0,
      };
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
        sex: e.x || null,
        external: !!e.src,
        hidden: DEFAULT_HIDDEN_NAMES.test(e.n),
        offset: new THREE.Vector3(),
        geo: {},
        parts: [],
      };
      for (const [re, o] of NAME_OPACITY) if (re.test(s.name)) s.opacity = o;
      s.label = displayName(s);
      e.t.forEach((tissue, k) => {
        const part = { id: e.q + k, tissue, structure: s, ranges: {} };
        s.parts.push(part);
        this.parts[part.id] = part;
      });
      this.structures[s.id] = s;
      this.layers[s.layer].structures.push(s);
    }
    this.refreshAppearance();
    return meta;
  }

  // Structures that exist in the current body.
  inBody(s) {
    return !s.sex || s.sex === this.sex;
  }

  refreshAppearance() {
    for (const p of this.parts) {
      if (!p) continue;
      const a = partAppearance(p.structure, p.tissue);
      this.store.setColor(p.id, a.color, a.roughness);
      p.baseOpacity = a.opacity;
    }
  }

  // Visibility / highlight state of every part.
  refreshState(modeOf = () => MODE.normal) {
    for (const p of this.parts) {
      if (!p) continue;
      const s = p.structure;
      const visible = this.inBody(s) && !s.hidden && !!s.geo[this.sex];
      this.store.setState(p.id, visible, modeOf(s), p.baseOpacity ?? 1);
    }
  }

  // Only draw a layer's transparent pass when something in it is translucent,
  // and skip its opaque pass when the whole layer is faded.
  updatePasses(fade = false) {
    for (const l of Object.values(this.layers)) {
      const d = l.data[this.sex];
      if (!d?.opaque) continue;
      let translucent = fade || l.opacity < 0.999;
      if (!translucent) {
        for (const s of l.structures) {
          if (s.hidden || !this.inBody(s)) continue;
          if (s.parts.some((p) => (p.baseOpacity ?? 1) < 0.999)) { translucent = true; break; }
        }
      }
      d.transparent.visible = translucent;
      d.opaque.visible = l.opacity >= 0.999 || fade;
    }
  }

  // Runs fn with every loaded layer drawn exactly once (opaque copy only); used
  // by passes that override the material (picking, X-ray).
  withSinglePass(fn) {
    const saved = [];
    for (const l of Object.values(this.layers)) {
      const d = l.data[this.sex];
      if (!d?.opaque) continue;
      saved.push([d, d.opaque.visible, d.transparent.visible]);
      d.opaque.visible = true;
      d.transparent.visible = false;
    }
    try { fn(); } finally { for (const [d, o, t] of saved) { d.opaque.visible = o; d.transparent.visible = t; } }
  }

  layerData(key, sex = this.sex) {
    return this.layers[key].data[sex];
  }

  isLoaded(key, sex = this.sex) {
    return !!this.layers[key].data[sex]?.loaded;
  }

  async loadLayer(key, sex = this.sex, onProgress) {
    const layer = this.layers[key];
    const d = (layer.data[sex] ||= { loaded: false });
    if (d.loaded || d.loading) return d.loading;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const url = `${BASE}models/${sex}/${key}.glb`;
    d.loading = (async () => {
      // Retry dropped downloads (flaky mobile connections) before giving up.
      for (let attempt = 0; ; attempt++) {
        try {
          const gltf = await loader.loadAsync(url, (ev) => {
            if (ev.total) layer.progress = ev.loaded / ev.total;
            onProgress?.(layer);
          });
          this.#ingest(layer, sex, gltf.scene);
          d.loaded = true;
          return layer;
        } catch (err) {
          if (attempt >= 2) { d.loading = null; throw err; }
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
    })();
    return d.loading;
  }

  #ingest(layer, sex, scene) {
    scene.updateMatrixWorld(true);
    let src = null;
    scene.traverse((o) => { if (o.isMesh) src = o; });
    const geo = src.geometry;
    geo.setAttribute('partId', geo.getAttribute('_part'));
    geo.deleteAttribute('_part');
    if (!geo.getAttribute('normal')) geo.setAttribute('normal', vertexNormals(geo));
    const matrix = src.matrixWorld.clone();
    const make = (material, order) => {
      const m = new THREE.Mesh(geo, material);
      m.matrixAutoUpdate = false;
      m.matrix.copy(matrix);
      m.matrixWorld.copy(matrix);
      m.frustumCulled = false;
      m.renderOrder = order;
      m.userData.layer = layer.key;
      return m;
    };
    const opaque = make(layer.mats.opaque, 0);
    const transparent = make(layer.mats.transparent, 1);
    transparent.userData.transparentPass = true;
    const group = new THREE.Group();
    group.add(opaque, transparent);
    group.visible = sex === this.sex;
    layer.group.add(group);

    // Positions are quantised (KHR_mesh_quantization): world = q * scale + offset.
    const pos = geo.getAttribute('position');
    const e = matrix.elements;
    const norm = pos.normalized ? (pos.array instanceof Int16Array ? 1 / 32767 : pos.array instanceof Uint16Array ? 1 / 65535 : 1) : 1;
    const decode = { array: pos.array, stride: pos.isInterleavedBufferAttribute ? pos.data.stride : pos.itemSize, start: pos.offset || 0, scale: [e[0] * norm, e[5] * norm, e[10] * norm], offset: [e[12], e[13], e[14]] };
    const index = geo.index.array;
    const { parts: table, structs } = geo.userData;
    const a = decode.array, st = decode.stride, o0 = decode.start, sc = decode.scale, of = decode.offset;
    for (const [pid, vStart, vCount, iStart, iCount] of table) {
      const part = this.parts[pid];
      const box = new THREE.Box3();
      for (let v = vStart; v < vStart + vCount; v++) {
        const b = o0 + v * st;
        const x = a[b] * sc[0] + of[0], y = a[b + 1] * sc[1] + of[1], z = a[b + 2] * sc[2] + of[2];
        if (x < box.min.x) box.min.x = x; if (x > box.max.x) box.max.x = x;
        if (y < box.min.y) box.min.y = y; if (y > box.max.y) box.max.y = y;
        if (z < box.min.z) box.min.z = z; if (z > box.max.z) box.max.z = z;
      }
      part.ranges[sex] = { vStart, vCount, iStart, iCount, box, decode, index };
    }
    for (const s of layer.structures) {
      const stat = structs[s.id];
      if (!stat) continue;
      const box = new THREE.Box3();
      for (const p of s.parts) if (p.ranges[sex]) box.union(p.ranges[sex].box);
      s.geo[sex] = { box, center: box.getCenter(new THREE.Vector3()), sign: stat[0], open: stat[1], dominant: stat[2] };
    }
    Object.assign(layer.data[sex], { group, opaque, transparent, geometry: geo });
    if (sex === this.sex) this.updateXray(layer);
  }

  // X-ray attenuation parameters per part (they depend on the body's geometry).
  updateXray(layer) {
    for (const s of layer.structures) {
      const g = s.geo[this.sex];
      if (!g) continue;
      for (const p of s.parts) {
        if (p.tissue === 'skin') this.store.setXray(p.id, g.sign, false, 1);
        else if (p.tissue === 'skinInner' || p.tissue === 'hair') this.store.setXray(p.id, 0, false, -1);
        else if (g.open > 0.04) this.store.setXray(p.id, TISSUES[p.tissue]?.density ?? 0.1, true, 0);
        else this.store.setXray(p.id, (TISSUES[g.dominant]?.density ?? 0.1) * g.sign, false, 0);
      }
    }
  }

  setSex(sex) {
    this.sex = sex;
    for (const l of Object.values(this.layers)) {
      for (const [k, d] of Object.entries(l.data)) if (d.group) d.group.visible = k === sex;
      this.updateXray(l);
    }
  }

  // Geometry of a structure in the current body.
  geo(s) {
    return s.geo[this.sex];
  }

  structuresUnder(pathPrefix) {
    const n = pathPrefix.length;
    return this.structures.filter((s) => s && this.inBody(s) && s.path.length >= n && pathPrefix.every((p, i) => s.path[i] === p));
  }

  counterpart(s) {
    if (!s.side) return null;
    const other = s.side === 'l' ? 'r' : 'l';
    return this.layers[s.layer].structures.find((x) => x.name === s.name && x.side === other && this.inBody(x)) || null;
  }

  isShown(s) {
    return this.inBody(s) && !!s.geo[this.sex] && this.layers[s.layer].visible && !s.hidden;
  }

  // Parts currently drawn (for cross-sections).
  visibleParts() {
    const out = [];
    for (const l of Object.values(this.layers)) {
      if (!l.visible || l.opacity <= 0.02 || !this.isLoaded(l.key)) continue;
      for (const s of l.structures) if (this.isShown(s)) for (const p of s.parts) if (p.ranges[this.sex]) out.push(p);
    }
    return out;
  }
}

export function displayName(s) {
  const side = s.side === 'l' ? ' (left)' : s.side === 'r' ? ' (right)' : '';
  return s.name.charAt(0).toUpperCase() + s.name.slice(1) + side;
}
