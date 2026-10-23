import * as THREE from 'three';
import { sharedUniforms, FLOW } from './materials.js';

// Physiological animations: the heartbeat with pulses running out through the
// arteries and blood returning through the veins, nerve impulses, and
// peristalsis carrying food along the gut. Each needs, per layer and body, the
// distance of every vertex along its structure, computed once in a worker.

export const ANIMATIONS = {
  blood: { label: 'Heartbeat & blood flow', layers: { heart: FLOW.heart, arteries: FLOW.artery, veins: FLOW.vein }, show: ['heart', 'arteries', 'veins'] },
  nerves: { label: 'Nerve impulses', layers: { nerves: FLOW.nerve, cns: FLOW.brain }, show: ['nerves', 'cns'] },
  digestion: { label: 'Digestion', layers: { digestive: FLOW.gut }, show: ['digestive'] },
};

// Shown faded behind every animation, for orientation.
export const ANIMATION_CONTEXT = { skeleton: 0.22 };

const GLOW = {
  [FLOW.artery]: new THREE.Color(1.0, 0.16, 0.1).multiplyScalar(1.4),
  [FLOW.vein]: new THREE.Color(0.35, 0.6, 1.0).multiplyScalar(1.1),
  [FLOW.nerve]: new THREE.Color(1.0, 0.78, 0.3).multiplyScalar(2.4),
  [FLOW.brain]: new THREE.Color(0.55, 0.75, 1.0).multiplyScalar(0.45),
  [FLOW.gut]: new THREE.Color(1.0, 0.5, 0.15).multiplyScalar(0.7),
  [FLOW.heart]: new THREE.Color(0.7, 0.04, 0.04).multiplyScalar(0.35),
};

const needsFlow = (kind) => kind !== FLOW.heart && kind !== FLOW.brain;

// The digestive canal in the order food passes through it.
const GUT = ['Oropharynx', 'Laryngopharynx', 'Oesophagus', 'Stomach', 'Duodenum', 'Jejunum', 'Ileum', 'Terminal ileum',
  'Caecum', 'Ascending colon', 'Transverse colon', 'Descending colon', 'Sigmoid colon', 'Rectum'];
const COLON = ['Caecum', 'Ascending colon', 'Transverse colon', 'Descending colon', 'Sigmoid colon'];

export class Animator {
  constructor(viewer, model, { loadLayer, onStatus } = {}) {
    this.viewer = viewer;
    this.model = model;
    this.loadLayer = loadLayer || ((k) => model.loadLayer(k));
    this.onStatus = onStatus || (() => {});
    this.active = new Set();
    this.speed = 1;
    this.time = 0;
    this.jobs = new Map();
    this.jobId = 0;
    this.worker = null;
    viewer.tickHooks.push((dt) => this.#tick(dt));
  }

  get running() {
    return this.active.size > 0;
  }

  async set(name, on) {
    if (on) this.active.add(name); else this.active.delete(name);
    await this.refresh();
  }

  // Applies the active animations to the current body, computing what is missing.
  async refresh() {
    const token = (this.token = (this.token || 0) + 1);
    const sex = this.model.sex;
    const wanted = {};
    for (const name of this.active) Object.assign(wanted, ANIMATIONS[name].layers);
    for (const [k, l] of Object.entries(this.model.layers)) {
      if (!(k in wanted)) l.mats.flowKind.value = FLOW.none;
    }
    const pending = Object.entries(wanted).filter(([k, kind]) => needsFlow(kind) && !this.model.layers[k].data[sex]?.flowReady);
    if (pending.length) this.onStatus('Preparing animation…');
    try {
      if ('heart' in wanted || 'arteries' in wanted || 'veins' in wanted) await this.#heartCenter(sex);
      for (const [k, kind] of Object.entries(wanted)) {
        if (needsFlow(kind)) await this.#ensureFlow(k, sex); else await this.loadLayer(k);
        if (token !== this.token || this.model.sex !== sex) return;
        const l = this.model.layers[k];
        l.mats.flowKind.value = kind;
        l.mats.flowColor.value.copy(GLOW[kind]);
      }
      this.onStatus('');
    } catch (err) {
      console.error(err);
      if (token === this.token) this.onStatus('Could not prepare the animation.');
    }
    this.viewer.requestRender();
  }

  #tick(dt) {
    if (!this.active.size) return false;
    this.time += dt * this.speed;
    const T = sharedUniforms.uBeatPeriod.value;
    const ph = (this.time / T) % 1;
    const bump = (x) => (x > 0 && x < 1 ? Math.sin(Math.PI * x) ** 2 : 0);
    sharedUniforms.uTime.value = this.time;
    sharedUniforms.uBeat.value.set(bump(ph / 0.35), bump((ph - 0.78) / 0.17));
    return true;
  }

  async #heartCenter(sex) {
    await this.loadLayer('heart');
    const box = new THREE.Box3();
    for (const s of this.model.layers.heart.structures) if (s.geo[sex]) box.union(s.geo[sex].box);
    if (!box.isEmpty()) box.getCenter(sharedUniforms.uHeartCenter.value);
  }

  async #ensureFlow(key, sex) {
    const layer = this.model.layers[key];
    await this.loadLayer(key);
    const d = layer.data[sex];
    if (d.flowReady) return;
    d.flowJob ||= (async () => {
      const config = await this.#config(key, sex);
      const geo = d.geometry;
      const flow = await this.#run({ ...geometryJob(this.model, layer, sex, geo), config });
      geo.setAttribute('flow', new THREE.BufferAttribute(flow, 2));
      d.flowReady = true;
    })();
    try { await d.flowJob; } finally { d.flowJob = null; }
  }

  async #config(key, sex) {
    const m = this.model;
    const inBody = (s) => (!s.sex || s.sex === sex) && s.geo[sex];
    const partsOf = (list) => list.filter(inBody).flatMap((s) => s.parts.filter((p) => p.ranges[sex]).map((p) => p.id));
    const structures = m.layers[key].structures;
    if (key === 'arteries' || key === 'veins') {
      return { type: 'tree', parts: partsOf(structures), sourcePoint: sharedUniforms.uHeartCenter.value.toArray(), bridge: 0.3 };
    }
    if (key === 'nerves') {
      await this.loadLayer('cns');
      const cns = m.layers.cns.data[sex].geometry;
      const all = worldPositions(m, m.layers.cns, sex, cns);
      const n = all.length / 3, step = 4;
      const pts = new Float32Array(Math.ceil(n / step) * 3);
      for (let i = 0, j = 0; i < n; i += step, j += 3) { pts[j] = all[i * 3]; pts[j + 1] = all[i * 3 + 1]; pts[j + 2] = all[i * 3 + 2]; }
      return { type: 'tree', parts: partsOf(structures), sourcePoints: pts, bridge: 0.3, touch: 1.5 };
    }
    const named = (names) => partsOf(structures.filter((s) => names.includes(s.name)));
    return {
      type: 'sequence',
      steps: GUT.map((n) => named([n])),
      followers: [
        [partsOf(structures.filter((s) => /taenia/i.test(s.name))), named(COLON)],
        [named(['Ileal orifice', 'Vermiform appendix']), named(['Caecum', 'Terminal ileum'])],
      ],
    };
  }

  #run(job) {
    this.worker ||= new Worker(new URL('./flow-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const { id, flow, error } = e.data;
      const j = this.jobs.get(id);
      this.jobs.delete(id);
      if (error) j?.reject(new Error(error)); else j?.resolve(flow);
    };
    const id = ++this.jobId;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      this.worker.postMessage({ id, job }, [job.positions.buffer, job.index.buffer]);
    });
  }
}

// World-space positions of a layer geometry (positions are quantised).
function worldPositions(model, layer, sex, geo) {
  const pos = geo.getAttribute('position');
  const part = layer.structures.flatMap((s) => s.parts).find((p) => p.ranges[sex]);
  const { array: a, stride, start, scale, offset } = part.ranges[sex].decode;
  const n = pos.count;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const b = start + i * stride;
    out[i * 3] = a[b] * scale[0] + offset[0];
    out[i * 3 + 1] = a[b + 1] * scale[1] + offset[1];
    out[i * 3 + 2] = a[b + 2] * scale[2] + offset[2];
  }
  return out;
}

function geometryJob(model, layer, sex, geo) {
  return {
    positions: worldPositions(model, layer, sex, geo),
    index: geo.index.array.slice(),
    parts: geo.userData.parts.map((r) => [r[0], r[1], r[2]]),
  };
}
