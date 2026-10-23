// Writes one layer as a single merged, quantised, meshopt-compressed mesh.
// Every vertex carries the id of the part (structure × tissue) it belongs to;
// the parts table maps ids to vertex / index ranges.
import fs from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
});

export const ready = MeshoptEncoder.ready;

// parts: [{ partId, mesh: { positions, indices } }]. Normals are computed by the client.
export async function writeLayer(file, name, parts, extras) {
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.mesh.positions.length / 3; ni += p.mesh.indices.length; }
  const pos = new Float32Array(nv * 3);
  const pid = new Uint16Array(nv);
  const idx = new Uint32Array(ni);
  const table = [];
  let v = 0, i = 0;
  for (const p of parts) {
    const n = p.mesh.positions.length / 3;
    pos.set(p.mesh.positions, v * 3);
    pid.fill(p.partId, v, v + n);
    for (let k = 0; k < p.mesh.indices.length; k++) idx[i + k] = p.mesh.indices[k] + v;
    table.push([p.partId, v, n, i, p.mesh.indices.length]);
    v += n;
    i += p.mesh.indices.length;
  }
  const doc = new Document();
  const buffer = doc.createBuffer();
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', pos))
    .setAttribute('_PART', acc('SCALAR', pid))
    .setIndices(acc('SCALAR', idx))
    .setExtras({ parts: table, ...extras });
  const mesh = doc.createMesh(name).addPrimitive(prim);
  doc.createScene(name).addChild(doc.createNode(name).setMesh(mesh));
  await doc.transform(
    quantize({ pattern: /^POSITION$/, quantizePosition: 14, cleanup: false }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  await io.write(file, doc);
  return { tris: ni / 3, bytes: fs.statSync(file).size };
}
