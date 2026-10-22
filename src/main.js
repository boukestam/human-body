import * as THREE from 'three';
import './style.css';
import { Viewer, BODY_CENTER } from './viewer.js';
import { AnatomyModel } from './model.js';
import { XRay } from './xray.js';
import { SectionView, AXES } from './section.js';
import { SliceController } from './slice.js';
import { setLayerOpacity, setColorScheme, getHighlight, clipPlanes, allMaterials, setWireframe } from './materials.js';
import { LAYER_GROUPS, LAYER_COLORS, DEFAULT_VISIBLE, TISSUES, VIEW_PRESETS, MUSCLE_FUNCTION_COLORS } from './palette.js';
import { getDescription } from './descriptions.js';
import { buildTree } from './tree.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const viewer = new Viewer($('#canvas-host'));
const model = new AnatomyModel();
viewer.scene.add(model.root);
const xray = new XRay(viewer, model);
const sectionView = new SectionView($('#section-canvas'), {
  onHover: (it, e) => {
    const f = $('#section-footer');
    f.textContent = it?.structure ? `${it.structure.label} — ${TISSUES[it.tissue]?.label || it.tissue}` : sliceInfo();
    void e;
  },
  onPick: (it, e) => {
    if (it?.structure) select([it.structure], { add: e.shiftKey, point: null });
  },
});
const slice = new SliceController(viewer, model, sectionView);

const state = {
  mode: 'normal',
  selection: [],
  selectionPoint: null,
  selectionLabel: '',
  selectedGroup: null,
  hover: null,
  fade: false,
  explode: 0,
  layerUI: {},
};

// ---------------------------------------------------------------- loading
async function init() {
  await model.loadMeta();
  buildLayerPanel();
  tree.build();
  const order = Object.keys(model.layers).sort((a, b) => (DEFAULT_VISIBLE.has(b) ? 1 : 0) - (DEFAULT_VISIBLE.has(a) ? 1 : 0));
  for (const k of order) model.layers[k].visible = DEFAULT_VISIBLE.has(k);
  const total = order.reduce((s, k) => s + (model.layers[k].bytes || 1), 0);
  let done = 0;
  const progress = () => {
    let loaded = 0;
    for (const k of order) {
      const l = model.layers[k];
      loaded += (l.loaded ? 1 : l.progress || 0) * (l.bytes || 1);
      const ui = state.layerUI[k];
      if (ui) ui.bar.style.width = `${(l.loaded ? 1 : l.progress || 0) * 100}%`;
    }
    $('#loading-bar').style.width = `${(loaded / total) * 100}%`;
  };
  // Load visible layers first (in parallel), then the rest in the background.
  const loadOne = async (k) => {
    $('#loading-detail').textContent = `${model.layers[k].label}…`;
    await model.loadLayer(k, progress);
    done++;
    progress();
    onLayerLoaded(k);
  };
  const first = order.filter((k) => DEFAULT_VISIBLE.has(k));
  await Promise.all(first.map(loadOne));
  computeBounds();
  $('#loading').classList.add('hidden');
  viewer.requestRender();
  applyHash();
  for (const k of order.filter((k) => !DEFAULT_VISIBLE.has(k))) await loadOne(k);
  void done;
}

function onLayerLoaded(k) {
  const l = model.layers[k];
  l.group.visible = l.visible;
  const ui = state.layerUI[k];
  if (ui) ui.progressRow.classList.add('hidden');
  if (xray.enabled) xray.applyMaterials();
  applyExplode();
  refreshHighlights();
  tree.refresh();
  if (slice.enabled) slice.recomputeSection();
  viewer.requestRender();
}

function computeBounds() {
  const box = new THREE.Box3();
  for (const s of model.structures) if (s?.root && s.layer !== 'references') box.union(s.box);
  if (!box.isEmpty()) slice.setBounds(box);
}

// ---------------------------------------------------------------- layers panel
function buildLayerPanel() {
  const host = $('#tab-layers');
  host.innerHTML = '';
  const actions = el('div', 'layer-actions');
  const mk = (label, fn) => { const b = el('button', null, label); b.onclick = fn; actions.append(b); };
  mk('Show all', () => setLayers(Object.keys(model.layers).filter((k) => k !== 'references' && k !== 'attachments')));
  mk('Hide all', () => setLayers([]));
  mk('Default', () => setLayers([...DEFAULT_VISIBLE]));
  host.append(actions);
  for (const g of LAYER_GROUPS) {
    host.append(el('div', 'layer-group-title', g.label));
    for (const k of g.layers) {
      const l = model.layers[k];
      const row = el('div', 'layer');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = DEFAULT_VISIBLE.has(k);
      const dot = el('span', 'dot');
      dot.style.background = LAYER_COLORS[k];
      const name = el('span', 'name', esc(l.label));
      const count = el('span', 'count', l.count.toLocaleString());
      const range = el('input', 'opacity');
      range.type = 'range'; range.min = 0; range.max = 1; range.step = 0.01; range.value = 1;
      range.title = 'Opacity';
      const progressRow = el('div', 'progress', '<div></div>');
      row.append(cb, dot, name, range, count, progressRow);
      host.append(row);
      row.addEventListener('click', (e) => {
        if (e.target === range || e.target === cb) return;
        cb.checked = !cb.checked;
        setLayerVisible(k, cb.checked);
      });
      cb.addEventListener('change', () => setLayerVisible(k, cb.checked));
      range.addEventListener('input', () => {
        l.opacity = +range.value;
        setLayerOpacity(k, l.opacity);
        l.group.visible = l.visible && l.opacity > 0.01;
        viewer.requestRender();
      });
      state.layerUI[k] = { cb, range, bar: progressRow.firstChild, progressRow };
    }
  }
}

function setLayers(keys) {
  const on = new Set(keys);
  for (const k of Object.keys(model.layers)) setLayerVisible(k, on.has(k), true);
  afterVisibilityChange();
}

function setLayerVisible(k, on, batch = false) {
  const l = model.layers[k];
  l.visible = on;
  l.group.visible = on && l.opacity > 0.01;
  if (state.layerUI[k]) state.layerUI[k].cb.checked = on;
  if (on && !l.loaded) model.loadLayer(k).then(() => onLayerLoaded(k));
  if (!batch) afterVisibilityChange();
}

function setLayerOpacityUI(k, v) {
  const l = model.layers[k];
  l.opacity = v;
  setLayerOpacity(k, v);
  l.group.visible = l.visible && v > 0.01;
  if (state.layerUI[k]) state.layerUI[k].range.value = v;
}

function afterVisibilityChange() {
  hideTooltip();
  tree.refresh();
  if (slice.enabled) slice.recomputeSection();
  viewer.requestRender();
}

// ---------------------------------------------------------------- tree
const tree = buildTree($('#tab-tree'), model, {
  onSelectStructure: (s) => { select([s], { focus: true }); },
  onSelectGroup: (path) => selectGroup(path),
  onToggle: (structures, show) => {
    for (const s of structures) {
      s.hidden = !show;
      if (s.root) s.root.visible = show;
      if (show && !model.layers[s.layer].visible) setLayerVisible(s.layer, true, true);
    }
    afterVisibilityChange();
  },
  isSelected: (s) => state.selection.includes(s),
});

// ---------------------------------------------------------------- selection
function refreshHighlights() {
  const sel = new Set(state.selection);
  const fade = state.fade && sel.size > 0;
  for (const m of model.meshes) {
    const s = m.userData.structure;
    if (xray.enabled) continue;
    let mat = m.userData.baseMaterial;
    if (sel.has(s)) mat = getHighlight(mat, 'select');
    else if (state.hover === s) mat = getHighlight(mat, fade ? 'ghost' : 'hover');
    else if (fade) mat = getHighlight(mat, 'ghost');
    m.material = mat;
  }
  xray.setSelected(state.selection);
  sectionView.selected = sel;
  if (slice.enabled) sectionView.draw();
  viewer.requestRender();
}

function select(structures, { add = false, focus = false, point = null } = {}) {
  structures = structures.filter(Boolean);
  hideTooltip();
  if (add) {
    const set = new Set(state.selection);
    for (const s of structures) set.has(s) ? set.delete(s) : set.add(s);
    state.selection = [...set];
  } else {
    state.selection = structures;
  }
  state.selectedGroup = null;
  state.selectionPoint = point;
  if (focus) state.fade = true;
  for (const s of state.selection) {
    if (s.hidden) { s.hidden = false; if (s.root) s.root.visible = true; }
    if (!model.layers[s.layer].visible) setLayerVisible(s.layer, true, true);
  }
  refreshHighlights();
  renderInfo();
  tree.refresh();
  if (state.selection.length === 1) tree.reveal(state.selection[0]);
  updateHash();
  if (focus && state.selection.length) focusSelection();
  if (focus) $('#left').classList.remove('open');
}

function selectGroup(path) {
  const list = model.structuresUnder(path);
  state.selection = list;
  state.selectedGroup = path;
  state.selectionPoint = null;
  state.fade = true;
  const layers = new Set(list.map((s) => s.layer));
  for (const k of layers) if (!model.layers[k].visible) setLayerVisible(k, true, true);
  refreshHighlights();
  renderInfo();
  tree.refresh();
  afterVisibilityChange();
  updateHash();
  focusSelection();
}

function focusSelection() {
  const box = new THREE.Box3();
  for (const s of state.selection) if (s.root) box.union(s.box.clone().translate(s.root.position));
  if (box.isEmpty()) return;
  viewer.frameBox(box);
}

function clearSelection() {
  hideTooltip();
  state.selection = [];
  state.selectedGroup = null;
  state.selectionPoint = null;
  refreshHighlights();
  renderInfo();
  tree.refresh();
  updateHash();
}

function hideSelection() {
  for (const s of state.selection) { s.hidden = true; if (s.root) s.root.visible = false; }
  clearSelection();
  afterVisibilityChange();
}

function isolateSelection() {
  if (!state.selection.length) return;
  const keep = new Set(state.selection);
  for (const s of model.structures) {
    if (!s) continue;
    s.hidden = !keep.has(s);
    if (s.root) s.root.visible = !s.hidden;
  }
  afterVisibilityChange();
  focusSelection();
}

function showAll() {
  for (const s of model.structures) {
    if (!s) continue;
    s.hidden = false;
    if (s.root) s.root.visible = true;
  }
  afterVisibilityChange();
}

// ---------------------------------------------------------------- info panel
function renderInfo() {
  const right = $('#right');
  const info = $('#info');
  const sel = state.selection;
  if (!sel.length) { right.classList.add('hidden'); viewer.resize(); return; }
  const wasHidden = right.classList.contains('hidden');
  right.classList.remove('hidden');
  if (wasHidden) requestAnimationFrame(() => viewer.resize());
  const group = state.selectedGroup;
  const single = sel.length === 1 ? sel[0] : null;
  const title = group ? group[group.length - 1] : single ? single.label : `${sel.length} structures`;
  const path = group ? group.slice(0, -1) : single ? single.path : [];
  let html = `<button class="icon-btn small close" id="info-close" title="Close">✕</button>`;
  html += `<h2>${esc(title)}</h2>`;
  html += `<div class="crumbs">${path.map((p, i) => `<a data-depth="${i}">${esc(p)}</a>`).join(' › ')}</div>`;
  if (single) {
    const l = model.layers[single.layer];
    html += '<div class="badges">';
    html += `<span class="badge"><i style="background:${LAYER_COLORS[single.layer]}"></i>${esc(l.label)}</span>`;
    for (const t of single.tissues) html += `<span class="badge"><i style="background:${TISSUES[t]?.color}"></i>${esc(TISSUES[t]?.label || t)}</span>`;
    if (single.fn) html += `<span class="badge"><i style="background:${MUSCLE_FUNCTION_COLORS[single.fn]}"></i>Action group: ${esc(single.fn)}</span>`;
    if (single.side) html += `<span class="badge">${single.side === 'l' ? 'Left side' : 'Right side'}</span>`;
    if (single.variant) html += `<span class="badge" title="Inconstant structure / anatomical variant">Variant</span>`;
    if (single.bone) html += `<span class="badge">On: ${esc(single.bone)}</span>`;
    html += '</div>';
  }
  html += '<div class="actions">';
  html += '<button class="btn primary" data-act="focus">Focus</button>';
  html += '<button class="btn" data-act="hide">Hide</button>';
  html += '<button class="btn" data-act="isolate">Isolate</button>';
  html += '<button class="btn" data-act="showall">Show all</button>';
  html += `<button class="btn ${state.fade ? 'primary' : ''}" data-act="fade" title="Make everything else translucent">Fade others</button>`;
  if (single?.side) html += '<button class="btn" data-act="other">Other side</button>';
  if (single?.ref) html += '<button class="btn" data-act="muscle">Show muscle</button>';
  html += '</div>';
  if (!single) {
    html += `<div class="muted">${sel.length} structures</div><ul class="list">${sel.slice(0, 300).map((s) => `<li data-id="${s.id}">${esc(s.label)}</li>`).join('')}</ul>`;
  }
  html += '<div class="desc" id="desc"><span class="muted">Loading description…</span></div>';
  info.innerHTML = html;
  info.scrollTop = 0;
  $('#info-close').onclick = clearSelection;
  info.querySelectorAll('.crumbs a').forEach((a) => {
    a.onclick = () => selectGroup(path.slice(0, +a.dataset.depth + 1));
  });
  info.querySelectorAll('.list li').forEach((li) => {
    li.onclick = () => select([model.structures[+li.dataset.id]], { focus: true });
  });
  info.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = () => {
      const act = b.dataset.act;
      if (act === 'focus') focusSelection();
      if (act === 'hide') hideSelection();
      if (act === 'isolate') isolateSelection();
      if (act === 'showall') showAll();
      if (act === 'fade') { state.fade = !state.fade; b.classList.toggle('primary', state.fade); refreshHighlights(); }
      if (act === 'other') select([model.counterpart(single)], { focus: true });
      if (act === 'muscle') {
        const m = model.layers.muscles.structures.find((x) => x.name.toLowerCase() === single.ref.toLowerCase() && x.side === single.side)
          || model.layers.muscles.structures.find((x) => x.name.toLowerCase().startsWith(single.ref.toLowerCase().replace(/ muscle$/, '')) && x.side === single.side);
        if (m) select([m], { focus: true });
      }
    };
  });
  const descName = group ? group[group.length - 1] : single ? single.name : null;
  const token = (renderInfo.token = (renderInfo.token || 0) + 1);
  const target = $('#desc');
  if (!descName) { target.innerHTML = ''; return; }
  getDescription(descName).then((d) => {
    if (token !== renderInfo.token) return;
    if (!d && single?.ref) return getDescription(single.ref).then((d2) => show(d2, single.ref));
    show(d);
  });
  function show(d, aboutName) {
    if (token !== renderInfo.token) return;
    if (!d) { target.innerHTML = '<span class="muted">No description available for this structure.</span>'; return; }
    const paras = d.text.split('\n').filter(Boolean).map((p) => {
      const h = p.match(/^=+\s*(.*?)\s*=+$/);
      return h ? `<h4>${esc(h[1])}</h4>` : `<p>${esc(p)}</p>`;
    }).join('');
    target.innerHTML = (aboutName ? `<p class="muted">About the ${esc(aboutName)}:</p>` : '') + paras +
      (d.url ? `<div class="src">Source: <a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(decodeURIComponent(d.url.replace(/^https?:\/\//, '')))}</a> (CC BY-SA)</div>` : '');
  }
}

// ---------------------------------------------------------------- search
const searchInput = $('#search');
let searchIndex = null;
function buildSearchIndex() {
  const groups = new Map();
  for (const s of model.structures) {
    if (!s) continue;
    for (let i = 1; i <= s.path.length; i++) {
      const key = s.path.slice(0, i).join('›');
      if (!groups.has(key)) groups.set(key, s.path.slice(0, i));
    }
  }
  searchIndex = [
    ...[...groups.values()].map((p) => ({ type: 'group', path: p, text: p[p.length - 1].toLowerCase() })),
    ...model.structures.filter(Boolean).map((s) => ({ type: 's', s, text: (s.name + ' ' + (s.side === 'l' ? 'left' : s.side === 'r' ? 'right' : '')).toLowerCase() })),
  ];
}
let searchActive = 0;
function runSearch() {
  const q = searchInput.value.trim().toLowerCase();
  const box = $('#search-results');
  const tabs = ['#tab-layers', '#tab-tree'];
  if (!q) {
    box.classList.add('hidden');
    $('#left-tabs').classList.remove('hidden');
    const active = document.querySelector('#left-tabs .active').dataset.tab;
    tabs.forEach((t) => $(t).classList.toggle('hidden', t !== `#tab-${active}`));
    return;
  }
  if (!searchIndex) buildSearchIndex();
  tabs.forEach((t) => $(t).classList.add('hidden'));
  $('#left-tabs').classList.add('hidden');
  box.classList.remove('hidden');
  const words = q.split(/\s+/);
  const scored = [];
  for (const it of searchIndex) {
    if (!words.every((w) => it.text.includes(w))) continue;
    let score = it.text.startsWith(q) ? 0 : it.text.includes(' ' + words[0]) ? 1 : 2;
    if (it.type === 'group') score -= 0.5;
    score += it.text.length / 200;
    scored.push([score, it]);
  }
  scored.sort((a, b) => a[0] - b[0]);
  const top = scored.slice(0, 120);
  box.innerHTML = '';
  if (!top.length) { box.append(el('div', 'empty', 'No matching structures')); return; }
  const hl = (t) => { let h = esc(t); for (const w of words) h = h.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>'); return h; };
  top.forEach(([, it], i) => {
    const r = el('div', 'result' + (i === searchActive ? ' active' : ''));
    if (it.type === 'group') {
      r.innerHTML = `<span class="dot" style="background:transparent;border:1px solid #8b98a8"></span><span class="t">${hl(it.path[it.path.length - 1])} <span class="muted">· group</span></span><span class="p">${esc(it.path.slice(0, -1).join(' › '))}</span>`;
      r.onclick = () => selectGroup(it.path);
    } else {
      const s = it.s;
      r.innerHTML = `<span class="dot" style="background:${LAYER_COLORS[s.layer]}"></span><span class="t">${hl(s.label)}</span><span class="p">${esc(s.path.slice(1).join(' › ') || s.path[0])}</span>`;
      r.onclick = () => select([s], { focus: true });
    }
    box.append(r);
  });
}
searchInput.addEventListener('input', () => { searchActive = 0; runSearch(); });
searchInput.addEventListener('keydown', (e) => {
  const items = [...document.querySelectorAll('#search-results .result')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    searchActive = THREE.MathUtils.clamp(searchActive + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1);
    items.forEach((r, i) => r.classList.toggle('active', i === searchActive));
    items[searchActive]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    items[searchActive]?.click();
  } else if (e.key === 'Escape') {
    searchInput.value = '';
    runSearch();
    searchInput.blur();
  }
});

document.querySelectorAll('#left-tabs button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('#left-tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $('#tab-layers').classList.toggle('hidden', b.dataset.tab !== 'layers');
    $('#tab-tree').classList.toggle('hidden', b.dataset.tab !== 'tree');
    if (b.dataset.tab === 'tree' && state.selection.length === 1) tree.reveal(state.selection[0]);
  };
});

// ---------------------------------------------------------------- picking & hover
const canvas = viewer.renderer.domElement;
let down = null;
let hoverTimer = 0;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
  down = null;
  if (moved || e.button !== 0) return;
  if (viewer.viewHelper.handleClick(e)) return;
  const hit = viewer.pick(e.clientX, e.clientY, model.visibleMeshes(), clipPlanes);
  if (hit) select([hit.object.userData.structure], { add: e.shiftKey, point: hit.point.clone() });
  else if (!e.shiftKey) clearSelection();
});
canvas.addEventListener('dblclick', (e) => {
  const hit = viewer.pick(e.clientX, e.clientY, model.visibleMeshes(), clipPlanes);
  if (hit) {
    select([hit.object.userData.structure], { point: hit.point.clone() });
    const s = hit.object.userData.structure;
    const box = s.box.clone().translate(s.root.position);
    const size = box.getSize(new THREE.Vector3()).length();
    const dir = viewer.camera.position.clone().sub(viewer.controls.target).normalize();
    viewer.flyTo(hit.point, hit.point.clone().addScaledVector(dir, Math.max(size * 1.4, 12)));
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.buttons) { hideTooltip(); return; }
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => doHover(e), 40);
});
canvas.addEventListener('pointerleave', () => { clearTimeout(hoverTimer); setHover(null); hideTooltip(); });

function doHover(e) {
  const hit = viewer.pick(e.clientX, e.clientY, model.visibleMeshes(), clipPlanes);
  const s = hit?.object.userData.structure || null;
  setHover(s);
  if (s) {
    const rect = $('#stage').getBoundingClientRect();
    const tip = $('#tooltip');
    tip.innerHTML = `${esc(s.label)}<small>${esc(model.layers[s.layer].label)} · ${esc(s.path[s.path.length - 1])}</small>`;
    tip.style.left = `${e.clientX - rect.left}px`;
    tip.style.top = `${e.clientY - rect.top}px`;
    tip.classList.remove('hidden');
  } else hideTooltip();
}
function hideTooltip() { $('#tooltip').classList.add('hidden'); }
function setHover(s) {
  if (state.hover === s) return;
  state.hover = s;
  if (!xray.enabled) refreshHighlights();
}

// Pinned label for the selection.
const labelsHost = $('#labels');
const pin = el('div', 'pin hidden', '<div class="tag"></div><div class="stem"></div>');
labelsHost.append(pin);
viewer.renderHooks.push({
  afterRender() {
    const sel = state.selection;
    if (sel.length !== 1 && !state.selectedGroup) { pin.classList.add('hidden'); return; }
    let p = state.selectionPoint;
    if (!p) {
      const s = sel[0];
      if (!s?.root) { pin.classList.add('hidden'); return; }
      p = s.center.clone().add(s.root.position);
      if (state.selectedGroup) {
        const box = new THREE.Box3();
        for (const x of sel) if (x.root) box.union(x.box);
        p = box.getCenter(new THREE.Vector3());
      }
    }
    const sp = viewer.projectToScreen(p);
    if (!sp.visible) { pin.classList.add('hidden'); return; }
    pin.classList.remove('hidden');
    pin.firstChild.textContent = state.selectedGroup ? state.selectedGroup[state.selectedGroup.length - 1] : sel[0].label;
    pin.style.left = `${sp.x}px`;
    pin.style.top = `${sp.y}px`;
  },
});

// ---------------------------------------------------------------- deep links
function updateHash() {
  const sel = state.selection;
  const h = state.selectedGroup ? 'group=' + encodeURIComponent(state.selectedGroup.join('/'))
    : sel.length === 1 ? 's=' + encodeURIComponent(sel[0].label) : '';
  history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
}

async function applyHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('s')) {
    const s = model.structures.find((x) => x && x.label === p.get('s'));
    if (s) {
      await model.loadLayer(s.layer).then(() => onLayerLoaded(s.layer));
      select([s], { focus: true });
    }
  } else if (p.get('group')) {
    const path = p.get('group').split('/');
    const list = model.structuresUnder(path);
    await Promise.all([...new Set(list.map((s) => s.layer))].map((k) => model.loadLayer(k).then(() => onLayerLoaded(k))));
    selectGroup(path);
  }
}

// ---------------------------------------------------------------- explode
function applyExplode() {
  const k = state.explode;
  for (const s of model.structures) {
    if (!s?.root) continue;
    s.root.position.set(s.center.x * k * 1.6, (s.center.y - BODY_CENTER.y) * k * 0.35, s.center.z * k * 2.2);
  }
  viewer.requestRender();
}
$('#explode').addEventListener('input', (e) => {
  state.explode = +e.target.value;
  applyExplode();
  if (slice.enabled) slice.recomputeSection();
});

// ---------------------------------------------------------------- view bar
document.querySelectorAll('#view-bar [data-view]').forEach((b) => {
  b.onclick = () => (b.dataset.view === 'reset' ? viewer.resetView() : viewer.setView(b.dataset.view));
});

let renderStyle = 'solid';
let styleSaved = null;
$('#render-style').addEventListener('change', (e) => {
  const style = e.target.value;
  if (renderStyle === 'glass' && styleSaved) {
    for (const [k, v] of Object.entries(styleSaved)) setLayerOpacityUI(k, v);
    styleSaved = null;
  }
  renderStyle = style;
  setWireframe(style === 'wireframe');
  if (style === 'glass') {
    styleSaved = Object.fromEntries(Object.keys(model.layers).map((k) => [k, model.layers[k].opacity]));
    for (const k of Object.keys(model.layers)) setLayerOpacityUI(k, ['skeleton', 'heart', 'cns'].includes(k) ? 0.55 : 0.22);
  }
  viewer.requestRender();
});

// ---------------------------------------------------------------- modes
const modePanel = $('#mode-panel');
let savedLayers = null;

function setMode(mode) {
  if (state.mode === mode) return;
  const prev = state.mode;
  state.mode = mode;
  document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  if (prev === 'xray') {
    xray.enable(false);
    if (savedLayers) {
      setLayers(savedLayers.visible);
      for (const [k, v] of Object.entries(savedLayers.opacity)) setLayerOpacityUI(k, v);
      savedLayers = null;
    }
    refreshHighlights();
  }
  if (prev === 'slice') {
    slice.enable(false);
    $('#section-dock').classList.add('hidden');
  }
  modePanel.classList.toggle('hidden', mode === 'normal');
  if (mode === 'xray') {
    savedLayers = {
      visible: Object.keys(model.layers).filter((k) => model.layers[k].visible),
      opacity: Object.fromEntries(Object.keys(model.layers).map((k) => [k, model.layers[k].opacity])),
    };
    setLayers(VIEW_PRESETS.xray);
    for (const k of Object.keys(model.layers)) setLayerOpacityUI(k, 1);
    xray.enable(true);
    buildXrayPanel();
    if (viewer.camera.position.distanceTo(viewer.controls.target) < 150) viewer.resetView();
  }
  if (mode === 'slice') {
    if (state.explode) { state.explode = 0; $('#explode').value = 0; applyExplode(); }
    slice.enable(true);
    $('#section-dock').classList.remove('hidden');
    buildSlicePanel();
    sliceCamera();
  }
  viewer.requestRender();
}

function sliceCamera() {
  const t = new THREE.Vector3(0, slice.axis === 'transverse' ? slice.position : BODY_CENTER.y, 0);
  const dirs = { transverse: new THREE.Vector3(0.35, 1.1, 0.9), coronal: new THREE.Vector3(0.6, 0.25, 1), sagittal: new THREE.Vector3(1, 0.25, 0.45) };
  const dist = slice.axis === 'transverse' ? 170 : 300;
  viewer.flyTo(t, t.clone().addScaledVector(dirs[slice.axis].normalize(), dist));
}

function sliceInfo() {
  const [a, b] = slice.range();
  const p = slice.position;
  const lvl = slice.vertebralLevel();
  const what = slice.axis === 'transverse' ? `${p.toFixed(1)} cm above floor` : slice.axis === 'coronal' ? `${p >= 0 ? p.toFixed(1) + ' cm anterior' : (-p).toFixed(1) + ' cm posterior'}` : `${Math.abs(p).toFixed(1)} cm ${p >= 0 ? 'left' : 'right'} of midline`;
  void a; void b;
  return `${what}${lvl ? ' · ' + lvl : ''} · scroll to zoom, drag to pan, double-click to fit`;
}

function buildSlicePanel() {
  const [a, b] = slice.range();
  modePanel.innerHTML = `
    <h4>Slice plane</h4>
    <div class="ctl"><div class="seg" id="slice-axis">
      ${Object.entries(AXES).map(([k, v]) => `<button data-axis="${k}" class="${k === slice.axis ? 'active' : ''}">${v.label.split(' ')[0]}</button>`).join('')}
    </div></div>
    <div class="ctl"><label>Position <span id="slice-pos-val"></span></label>
      <input type="range" id="slice-pos" min="${a}" max="${b}" step="0.1" value="${slice.position}" /></div>
    <div class="ctl"><label>Slab thickness <span id="slab-val">${slice.slab ? slice.slab.toFixed(1) + ' cm' : 'off'}</span></label>
      <input type="range" id="slice-slab" min="0" max="20" step="0.25" value="${slice.slab}" /></div>
    <div class="row">
      <label class="chk"><input type="checkbox" id="slice-flip" ${slice.flip ? 'checked' : ''}/> Flip side</label>
      <label class="chk"><input type="checkbox" id="slice-plane" ${slice.showPlane ? 'checked' : ''}/> Show plane</label>
    </div>
    <div class="level" id="slice-level"></div>`;
  const posInput = $('#slice-pos');
  $('#section-dock').classList.toggle('portrait', slice.axis !== 'transverse');
  const updateLabels = () => {
    $('#slice-pos-val').textContent = slice.position.toFixed(1) + ' cm';
    $('#slice-level').textContent = slice.vertebralLevel();
    $('#section-title').textContent = `${AXES[slice.axis].label} section`;
    $('#section-footer').textContent = sliceInfo();
  };
  slice.onUpdate = updateLabels;
  updateLabels();
  posInput.addEventListener('input', () => slice.setPosition(+posInput.value));
  $('#slice-slab').addEventListener('input', (e) => {
    slice.set({ slab: +e.target.value });
    $('#slab-val').textContent = slice.slab ? slice.slab.toFixed(1) + ' cm' : 'off';
  });
  $('#slice-flip').addEventListener('change', (e) => slice.set({ flip: e.target.checked }));
  $('#slice-plane').addEventListener('change', (e) => slice.set({ showPlane: e.target.checked }));
  $('#slice-axis').querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => {
      slice.axis = btn.dataset.axis;
      buildSlicePanel();
      slice.update();
      sliceCamera();
    };
  });
}

function buildXrayPanel() {
  const p = xray.params;
  modePanel.innerHTML = `
    <h4>X-ray</h4>
    <div class="ctl"><label>Exposure <span id="xv-exp"></span></label><input type="range" id="x-exp" min="0.01" max="0.2" step="0.001" value="${p.exposure}" /></div>
    <div class="ctl"><label>Contrast <span id="xv-con"></span></label><input type="range" id="x-con" min="0.6" max="3" step="0.01" value="${p.contrast}" /></div>
    <div class="ctl"><label>Edge enhancement <span id="xv-sh"></span></label><input type="range" id="x-sh" min="0" max="3" step="0.01" value="${p.sharpen}" /></div>
    <div class="row">
      <label class="chk"><input type="checkbox" id="x-inv" ${p.invert ? 'checked' : ''}/> Invert (negative)</label>
      <label class="chk"><input type="checkbox" id="x-hl" ${p.highlight ? 'checked' : ''}/> Highlight selection</label>
    </div>
    <p class="muted" style="margin:10px 0 0;font-size:11.5px">Brightness is the simulated attenuation along each ray (Beer–Lambert law) through every visible layer. Toggle layers to change what is imaged.</p>`;
  const bind = (id, key, out, fmt) => {
    const i = $(id);
    const upd = () => { p[key] = +i.value; $(out).textContent = fmt(p[key]); viewer.requestRender(); };
    i.addEventListener('input', upd);
    $(out).textContent = fmt(p[key]);
  };
  bind('#x-exp', 'exposure', '#xv-exp', (v) => v.toFixed(3));
  bind('#x-con', 'contrast', '#xv-con', (v) => v.toFixed(2));
  bind('#x-sh', 'sharpen', '#xv-sh', (v) => v.toFixed(2));
  $('#x-inv').addEventListener('change', (e) => { p.invert = e.target.checked; viewer.requestRender(); });
  $('#x-hl').addEventListener('change', (e) => { p.highlight = e.target.checked; xray.applyMaterials(); viewer.requestRender(); });
}

document.querySelectorAll('#modes button').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));

$('#section-palette').addEventListener('change', (e) => { sectionView.palette = e.target.value; sectionView.draw(); });
$('#section-labels').addEventListener('change', (e) => { sectionView.labels = e.target.checked; sectionView.draw(); });
$('#section-expand').addEventListener('click', () => {
  const d = $('#section-dock');
  d.style.width = ''; d.style.height = '';
  d.classList.toggle('large');
  requestAnimationFrame(() => { sectionView.fitKey = ''; sectionView.fit(); sectionView.draw(); });
});

// ---------------------------------------------------------------- misc tools
$('#color-scheme').addEventListener('change', (e) => {
  setColorScheme(e.target.value);
  if (e.target.value === 'function' && !model.layers.muscles.visible) setLayerVisible('muscles', true);
  viewer.requestRender();
  if (slice.enabled) sectionView.draw();
});
$('#btn-screenshot').addEventListener('click', () => {
  viewer.render();
  const a = document.createElement('a');
  a.download = 'human-body.png';
  a.href = viewer.renderer.domElement.toDataURL('image/png');
  a.click();
});
$('#btn-help').addEventListener('click', () => $('#help').classList.remove('hidden'));
$('#help-close').addEventListener('click', () => $('#help').classList.add('hidden'));
$('#help').addEventListener('click', (e) => { if (e.target.id === 'help') $('#help').classList.add('hidden'); });
$('#toggle-left').addEventListener('click', () => $('#left').classList.toggle('open'));

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input[type=search], input[type=text]')) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') { clearSelection(); $('#help').classList.add('hidden'); }
  else if (k === 'h') hideSelection();
  else if (k === 'i') isolateSelection();
  else if (k === 'a') showAll();
  else if (k === 'f') focusSelection();
  else if (k === 'g') { state.fade = !state.fade; refreshHighlights(); renderInfo(); }
  else if (k === 'r') viewer.resetView();
  else if (k === '1') setMode('normal');
  else if (k === '2') setMode('xray');
  else if (k === '3') setMode('slice');
  else if (slice.enabled && (k === 'arrowup' || k === 'arrowdown')) {
    e.preventDefault();
    slice.setPosition(slice.position + (k === 'arrowup' ? 1 : -1) * (e.shiftKey ? 5 : 0.5));
    const i = $('#slice-pos');
    if (i) i.value = slice.position;
  } else if (k === '/') { e.preventDefault(); searchInput.focus(); }
});

window.__app = { viewer, model, xray, slice, select, setMode, setLayers, state, allMaterials };

init().catch((err) => {
  console.error(err);
  $('#loading-detail').textContent = 'Failed to load: ' + err.message;
});
