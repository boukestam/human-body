// Reads HuBMAP Human Reference Atlas "united" body models (CC BY 4.0) and
// returns every mesh node in world space, converted to centimetres.
import fs from 'node:fs';
import v8 from 'node:v8';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mat4, vec3 } from 'gl-matrix';

const DIR = process.env.HRA_DIR || '/tmp/hra/united';
export const HRA_FILES = { f: '3d-vh-f-united.glb', m: 'VH_M_United.glb' };

// Returns Map(name -> { name, path, positions: Float32Array (cm), indices: Uint32Array })
export async function loadHRA(sex) {
  const cache = `${DIR}/${sex}.cache.v8`;
  if (fs.existsSync(cache)) return v8.deserialize(fs.readFileSync(cache));
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(`${DIR}/${HRA_FILES[sex]}`);
  const nodes = new Map();
  const walk = (node, parentMatrix, path) => {
    const m = mat4.multiply(mat4.create(), parentMatrix, node.getMatrix());
    const name = node.getName();
    const mesh = node.getMesh();
    if (mesh) {
      const pos = [];
      const idx = [];
      for (const prim of mesh.listPrimitives()) {
        const a = prim.getAttribute('POSITION');
        const base = pos.length / 3;
        const v = [0, 0, 0];
        for (let i = 0; i < a.getCount(); i++) {
          a.getElement(i, v);
          const w = vec3.transformMat4(vec3.create(), v, m);
          pos.push(w[0] * 100, w[1] * 100, w[2] * 100);
        }
        const ind = prim.getIndices();
        if (ind) for (let i = 0; i < ind.getCount(); i++) idx.push(base + ind.getScalar(i));
        else for (let i = 0; i < a.getCount(); i++) idx.push(base + i);
      }
      // Mirrored nodes flip the winding.
      if (mat4.determinant(m) < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
      nodes.set(name, { name, path, positions: new Float32Array(pos), indices: new Uint32Array(idx) });
    }
    for (const c of node.listChildren()) walk(c, m, [...path, name]);
  };
  for (const n of doc.getRoot().listScenes()[0].listChildren()) walk(n, mat4.create(), []);
  fs.writeFileSync(cache, v8.serialize(nodes));
  return nodes;
}

// All mesh nodes whose name or ancestors match `re`.
export function select(nodes, re) {
  return [...nodes.values()].filter((n) => re.test(n.name) || n.path.some((p) => re.test(p)));
}
