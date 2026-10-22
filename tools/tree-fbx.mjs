import fs from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
THREE.PropertyBinding.sanitizeNodeName = (n) => n;
const buf = fs.readFileSync(process.argv[2]);
const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
const maxD = +(process.argv[3] || 4);
function count(o) { let n = 0; o.traverse(c => { if (c.isMesh && /\.(l|r)$|^[^.]*$/.test(c.name) && !/Cross Section/.test(c.name)) n++; }); return n; }
function walk(o, d) {
  const isG = o.name.endsWith('.g') || d === 0;
  if (isG) {
    const direct = o.children.filter(c => c.isMesh && !/\.(j|t|s|i|o\d*[lr]?|e\d*[lr]?|\d+)$/.test(c.name)).map(c => c.name);
    console.log('  '.repeat(d) + o.name + ' [' + count(o) + ']' + (direct.length && d >= maxD - 1 ? ': ' + direct.slice(0, 12).join(' | ') + (direct.length > 12 ? ' …' : '') : ''));
    if (d < maxD) for (const c of o.children) walk(c, d + 1);
  }
}
walk(root, 0);
