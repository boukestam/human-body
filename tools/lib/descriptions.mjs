// Structure descriptions (Wikipedia extracts shipped with Z-Anatomy), sharded
// into 16 JSON files keyed by lower-case name.
import fs from 'node:fs';
import path from 'node:path';

const DESC_SRC = process.env.ZA_DESC || '/tmp/za/desc';

function index() {
  const files = new Map();
  for (const f of fs.existsSync(DESC_SRC) ? fs.readdirSync(DESC_SRC) : []) {
    files.set(f.replace(/\.txt$/, '').replace(/^\((.*)\)$/, '$1').toLowerCase(), f);
  }
  return files;
}

function readDesc(files, name) {
  const f = files.get(name.toLowerCase());
  if (!f) return null;
  const lines = fs.readFileSync(path.join(DESC_SRC, f), 'utf8').replace(/\r/g, '').split('\n').map((l) => l.trim());
  let url = null;
  const paras = [];
  let cur = [];
  for (const l of lines) {
    if (/^https?:\/\//.test(l)) { url = l; continue; }
    if (!l) { if (cur.length) { paras.push(cur.join(' ')); cur = []; } continue; }
    if (l.startsWith('!')) continue;
    if (l === l.toUpperCase() && /[A-Z]/.test(l) && l.length < 90) continue;
    cur.push(l);
  }
  if (cur.length) paras.push(cur.join(' '));
  let text = paras.join('\n').replace(/\(\s*,\s*/g, '(').replace(/\(\s*\)/g, '').replace(/ {2,}/g, ' ').trim();
  if (text.length > 6000) text = text.slice(0, text.lastIndexOf('\n', 6000)) || text.slice(0, 6000);
  if (!text && !url) return null;
  return { text, url };
}

export const hashName = (s) => { let h = 0; for (const c of s.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 16; };

export function writeDescriptions(outDir, names, aliases = {}) {
  const files = index();
  const shards = Array.from({ length: 16 }, () => ({}));
  let count = 0;
  for (const name of new Set(names)) {
    const d = readDesc(files, name) || (aliases[name] && readDesc(files, aliases[name]));
    if (!d) continue;
    shards[hashName(name)][name.toLowerCase()] = d;
    count++;
  }
  fs.mkdirSync(outDir, { recursive: true });
  shards.forEach((s, i) => fs.writeFileSync(path.join(outDir, `${i}.json`), JSON.stringify(s)));
  return count;
}
