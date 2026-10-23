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

// Short descriptions for structures without a Z-Anatomy description file.
const EXTRA = {
  'Ovarian artery': { text: 'The ovarian artery is a paired branch of the abdominal aorta that supplies the ovary. It arises just below the renal arteries, descends on the psoas major muscle behind the peritoneum, crosses the ureter and the external iliac vessels at the pelvic brim and enters the suspensory ligament of the ovary. It then runs in the mesovarium to the hilum of the ovary and also sends branches to the uterine tube, anastomosing with the uterine artery in the broad ligament. It corresponds to the testicular artery in the male.', url: null },
  'Ovarian vein': { text: 'The ovarian vein drains the ovary. It begins as the pampiniform plexus in the broad ligament near the ovary and uterine tube, ascends in the suspensory ligament of the ovary and then on the psoas major muscle. The right ovarian vein opens into the inferior vena cava, while the left ovarian vein ends in the left renal vein. It corresponds to the testicular vein in the male.', url: null },
  'Greater vestibular gland': { text: "The greater vestibular glands (Bartholin's glands) are two pea-sized glands, about 0.5 to 1 cm across, lying behind and to each side of the vaginal orifice, at the posterior ends of the vestibular bulbs and deep to the bulbospongiosus muscle. Each gland drains through a duct about 2 cm long that opens into the vestibule between the hymen and the labium minus, at about the 4 and 8 o'clock positions. They secrete mucus that lubricates the vestibule. They are homologous to the bulbourethral glands of the male.", url: null },
  'Glans of clitoris': { text: 'The glans of the clitoris is the small, highly sensitive, rounded end of the clitoris, visible at the front junction of the labia minora above the external urethral orifice and partly covered by the clitoral hood (prepuce). It is formed of erectile tissue and is densely supplied by the dorsal nerve of the clitoris. It is homologous to the glans penis.', url: null },
  'Body of clitoris': { text: 'The body of the clitoris is formed by the two joined corpora cavernosa. It extends from the glans upwards towards the lower border of the pubic symphysis, to which it is attached by the suspensory ligament of the clitoris. There it bends sharply (the genu) and divides into the two crura, which run along the ischiopubic rami. It is homologous to the shaft of the penis.', url: null },
  'Female urethra': { text: 'The female urethra is about 4 cm long and 6 mm wide. It begins at the internal urethral orifice at the neck of the bladder, runs downwards and forwards behind the pubic symphysis, embedded in the anterior wall of the vagina, and opens at the external urethral orifice in the vestibule, about 2.5 cm behind the glans of the clitoris and directly in front of the vaginal orifice. It is surrounded by the internal and external urethral sphincters.', url: null },
};

export const hashName = (s) => { let h = 0; for (const c of s.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 16; };

export function writeDescriptions(outDir, names, aliases = {}) {
  const files = index();
  const shards = Array.from({ length: 16 }, () => ({}));
  let count = 0;
  for (const name of new Set(names)) {
    const d = readDesc(files, name) || (aliases[name] && readDesc(files, aliases[name])) || EXTRA[name] || null;
    if (!d) continue;
    shards[hashName(name)][name.toLowerCase()] = d;
    count++;
  }
  fs.mkdirSync(outDir, { recursive: true });
  shards.forEach((s, i) => fs.writeFileSync(path.join(outDir, `${i}.json`), JSON.stringify(s)));
  return count;
}
