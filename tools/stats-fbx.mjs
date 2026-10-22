import fs from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
THREE.PropertyBinding.sanitizeNodeName = (n) => n;
const file = process.argv[2];
const buf = fs.readFileSync(file);
const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
const suffix = {}; const mats = {}; let tris = 0, meshes = 0; const sample = {};
root.traverse(o => {
  const m = o.name.match(/\.([a-z0-9]+)$/i); const s = (o.isMesh ? 'M:' : 'G:') + (m ? m[1] : '-');
  suffix[s] = (suffix[s] || 0) + 1; (sample[s] ||= []).length < 6 && sample[s].push(o.name);
  if (o.isMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; for (const mm of [].concat(o.material)) mats[mm.name] = (mats[mm.name] || 0) + 1; }
});
console.log(file.split('/').pop(), { meshes, tris });
console.log(suffix); console.log(sample);
console.log(Object.entries(mats).sort((a, b) => b[1] - a[1]).map(e => e.join(':')).join('  '));
