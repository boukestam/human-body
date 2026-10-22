const BASE = import.meta.env.BASE_URL + 'data/desc/';
const shards = new Map();

function hash(s) {
  let h = 0;
  for (const c of s.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 16;
}

function shard(i) {
  if (!shards.has(i)) shards.set(i, fetch(`${BASE}${i}.json`).then((r) => r.json()).catch(() => ({})));
  return shards.get(i);
}

export async function getDescription(name) {
  const data = await shard(hash(name));
  return data[name.toLowerCase()] || null;
}
