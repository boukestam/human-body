import * as THREE from 'three';
import './style.css';
import { Viewer, BODY_CENTER } from './viewer.js';
import { AnatomyModel } from './model.js';
import { XRay } from './xray.js';
import { SectionView, AXES } from './section.js';
import { SliceController } from './slice.js';
import { setColorScheme, clipPlanes, setWireframe } from './materials.js';
import { MODE } from './parts.js';
import { Picker } from './picker.js';
import { SEXES } from './model.js';
import { LAYER_GROUPS, LAYER_COLORS, DEFAULT_VISIBLE, TISSUES, VIEW_PRESETS, MUSCLE_FUNCTION_COLORS } from './palette.js';
import { getDescription } from './descriptions.js';
import { buildTree } from './tree.js';
import { createSheet, desktopMQ } from './sheet.js';
import { Animator, ANIMATIONS, ANIMATION_CONTEXT } from './animation.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Range inputs show their filled portion through the --p custom property.
const paintRange = (r) => r.style.setProperty('--p', `${((r.value - r.min) / ((r.max - r.min) || 1)) * 100}%`);
const paintRanges = (root = document) => root.querySelectorAll('input[type=range]').forEach(paintRange);
document.addEventListener('input', (e) => { if (e.target.type === 'range') paintRange(e.target); });

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
const picker = new Picker(viewer, model);
const animator = new Animator(viewer, model, {
  loadLayer: (k) => model.loadLayer(k).then(() => onLayerLoaded(k)),
  onStatus: (text) => { $('#anim-status').textContent = text; },
});

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
  model.setSex(initialSex());
  buildLayerPanel();
  updateSexUI();
  tree.build();
  const order = Object.keys(model.layers).sort((a, b) => (DEFAULT_VISIBLE.has(b) ? 1 : 0) - (DEFAULT_VISIBLE.has(a) ? 1 : 0));
  for (const k of order) model.layers[k].visible = DEFAULT_VISIBLE.has(k);
  const total = order.reduce((s, k) => s + (model.layers[k].bytes[model.sex] || 1), 0);
  let done = 0;
  const progress = () => {
    let loaded = 0;
    for (const k of order) {
      const l = model.layers[k];
      const done = model.isLoaded(k);
      loaded += (done ? 1 : l.progress || 0) * (l.bytes[model.sex] || 1);
      const ui = state.layerUI[k];
      if (ui) ui.bar.style.width = `${(done ? 1 : l.progress || 0) * 100}%`;
    }
    $('#loading-bar').style.width = `${(loaded / total) * 100}%`;
  };
  // Load visible layers first (in parallel), then the rest in the background.
  const loadOne = async (k) => {
    $('#loading-detail').textContent = `${model.layers[k].label}…`;
    await model.loadLayer(k, model.sex, progress);
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
  // Phones load hidden layers on demand to save data and memory.
  if (desktopMQ.matches) for (const k of order.filter((k) => !DEFAULT_VISIBLE.has(k))) await loadOne(k);
  void done;
}

function onLayerLoaded(k) {
  const l = model.layers[k];
  l.group.visible = l.visible && l.opacity > 0.01;
  const ui = state.layerUI[k];
  if (ui && model.isLoaded(k)) ui.progressRow.classList.add('hidden');
  applyExplode();
  refreshHighlights();
  tree.refresh();
  if (slice.enabled) slice.recomputeSection();
  viewer.requestRender();
}

function computeBounds() {
  const box = new THREE.Box3();
  for (const s of model.structures) if (s && model.geo(s) && s.layer !== 'references') box.union(model.geo(s).box);
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
  const sexRow = el('div', 'sex-row', `<span>Body</span><div class="seg">${Object.entries(SEXES).map(([k, v]) => `<button data-sex="${k}">${v}</button>`).join('')}</div>`);
  sexRow.querySelectorAll('button').forEach((b) => (b.onclick = () => setSex(b.dataset.sex)));
  host.append(sexRow, actions);
  for (const g of LAYER_GROUPS) {
    const box = el('div', 'layer-group');
    box.append(el('div', 'layer-group-title', g.label));
    host.append(box);
    for (const k of g.layers) {
      const l = model.layers[k];
      const row = el('div', 'layer');
      row.style.setProperty('--c', LAYER_COLORS[k]);
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = DEFAULT_VISIBLE.has(k);
      const dot = el('span', 'dot');
      dot.style.background = LAYER_COLORS[k];
      const name = el('span', 'name', esc(l.label));
      const count = el('span', 'count', '');
      const range = el('input', 'opacity');
      range.type = 'range'; range.min = 0; range.max = 1; range.step = 0.01; range.value = 1;
      range.title = 'Opacity';
      const progressRow = el('div', 'progress', '<div></div>');
      row.append(cb, dot, name, range, count, progressRow);
      box.append(row);
      row.addEventListener('click', (e) => {
        if (e.target === range || e.target === cb) return;
        cb.checked = !cb.checked;
        setLayerVisible(k, cb.checked);
      });
      cb.addEventListener('change', () => setLayerVisible(k, cb.checked));
      range.addEventListener('input', () => {
        setLayerOpacityUI(k, +range.value);
        viewer.requestRender();
      });
      state.layerUI[k] = { row, cb, range, count, bar: progressRow.firstChild, progressRow };
    }
  }
  paintRanges(host);
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
  if (on && !model.isLoaded(k)) {
    state.layerUI[k]?.progressRow.classList.remove('hidden');
    model.loadLayer(k, model.sex, () => {
      const ui = state.layerUI[k];
      if (ui) ui.bar.style.width = `${(l.progress || 0) * 100}%`;
    }).then(() => onLayerLoaded(k));
  }
  if (!batch) afterVisibilityChange();
}

function setLayerOpacityUI(k, v) {
  const l = model.layers[k];
  l.opacity = v;
  l.mats.layerOpacity.value = v;
  l.group.visible = l.visible && v > 0.01;
  model.updatePasses(state.fade && state.selection.length > 0);
  if (state.layerUI[k]) { state.layerUI[k].range.value = v; paintRange(state.layerUI[k].range); }
}

function afterVisibilityChange() {
  hideTooltip();
  refreshHighlights();
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
      if (show && !model.layers[s.layer].visible) setLayerVisible(s.layer, true, true);
    }
    afterVisibilityChange();
  },
  isSelected: (s) => state.selection.includes(s),
});

// ---------------------------------------------------------------- selection
function refreshHighlights() {
  const sel = new Set(state.selection);
  const fade = state.fade && sel.size > 0 && !xray.enabled;
  model.refreshState((s) => {
    if (sel.has(s)) return MODE.select;
    if (fade) return MODE.ghost;
    if (state.hover === s && !xray.enabled) return MODE.hover;
    return MODE.normal;
  });
  model.updatePasses(fade);
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
    if (s.hidden) s.hidden = false;
    if (!model.layers[s.layer].visible) setLayerVisible(s.layer, true, true);
  }
  refreshHighlights();
  renderInfo();
  tree.refresh();
  if (state.selection.length === 1) tree.reveal(state.selection[0]);
  updateHash();
  if (focus && state.selection.length) focusSelection();
  if (state.selection.length) showInfoTab();
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
  showInfoTab();
}

function focusSelection() {
  const box = new THREE.Box3();
  for (const s of state.selection) { const g = model.geo(s); if (g) box.union(g.box.clone().translate(s.offset)); }
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
  for (const s of state.selection) s.hidden = true;
  clearSelection();
  afterVisibilityChange();
}

function isolateSelection() {
  if (!state.selection.length) return;
  const keep = new Set(state.selection);
  for (const s of model.structures) {
    if (!s) continue;
    s.hidden = !keep.has(s);
  }
  afterVisibilityChange();
  focusSelection();
}

function showAll() {
  for (const s of model.structures) {
    if (!s) continue;
    s.hidden = false;
  }
  afterVisibilityChange();
}

// ---------------------------------------------------------------- info panel
function renderInfo() {
  const right = $('#right');
  const info = $('#info');
  const sel = state.selection;
  const tabBtn = $('#tab-info-btn');
  if (!sel.length) {
    const wasShown = !right.classList.contains('hidden');
    right.classList.add('hidden');
    tabBtn.classList.remove('has-dot');
    info.innerHTML = '<div class="empty">Tap any structure, or search for one, to see its details here.</div>';
    if (wasShown) requestAnimationFrame(() => viewer.resize());
    return;
  }
  tabBtn.classList.add('has-dot');
  const wasHidden = right.classList.contains('hidden');
  right.classList.remove('hidden');
  if (wasHidden && desktopMQ.matches) requestAnimationFrame(() => viewer.resize());
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
  const anim = single && animationFor(single);
  if (anim) html += `<button class="btn ${animator.active.has(anim) ? 'primary' : ''}" data-act="animate">${animator.active.has(anim) ? 'Stop animation' : 'Animate'}</button>`;
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
      if (act === 'animate') setAnimation(anim, !animator.active.has(anim));
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
  getDescription(descName).then(async (d) => {
    if (token !== renderInfo.token) return;
    if (d) return show(d);
    // Fall back to the muscle (for attachments) or the nearest named parent group.
    for (const alt of [single?.ref, ...(single ? [...single.path].reverse() : [])]) {
      if (!alt) continue;
      const d2 = await getDescription(alt);
      if (d2) return show(d2, alt);
    }
    show(null);
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
    if (!s || !model.inBody(s)) continue;
    for (let i = 1; i <= s.path.length; i++) {
      const key = s.path.slice(0, i).join('›');
      if (!groups.has(key)) groups.set(key, s.path.slice(0, i));
    }
  }
  searchIndex = [
    ...[...groups.values()].map((p) => ({ type: 'group', path: p, text: p[p.length - 1].toLowerCase() })),
    ...model.structures.filter((s) => s && model.inBody(s)).map((s) => ({ type: 's', s, text: (s.name + ' ' + (s.side === 'l' ? 'left' : s.side === 'r' ? 'right' : '')).toLowerCase() })),
  ];
}
let searchActive = 0;
function runSearch() {
  const q = searchInput.value.trim().toLowerCase();
  const box = $('#search-results');
  const tabs = ['#tab-layers', '#tab-tree', '#tab-info'];
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
      r.innerHTML = `<span class="dot group"></span><span class="t">${hl(it.path[it.path.length - 1])} <span class="muted">· group</span></span><span class="p">${esc(it.path.slice(0, -1).join(' › '))}</span>`;
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
searchInput.addEventListener('focus', () => sheet.setSnap('full'));
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

function showTab(tab) {
  document.querySelectorAll('#left-tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
  for (const t of ['layers', 'tree', 'info']) $(`#tab-${t}`).classList.toggle('hidden', t !== tab);
  if (tab === 'tree' && state.selection.length === 1) tree.reveal(state.selection[0]);
}
document.querySelectorAll('#left-tabs button').forEach((b) => {
  b.onclick = () => {
    showTab(b.dataset.tab);
    sheet.expandAtLeast('half');
  };
});

// On phones the details live in the sheet's Info tab; on desktop in the right panel.
function placeInfo() {
  const info = $('#info');
  const host = desktopMQ.matches ? $('#right') : $('#tab-info');
  if (info.parentElement !== host) host.append(info);
  if (desktopMQ.matches && $('#left-tabs .active')?.dataset.tab === 'info') showTab('layers');
}
desktopMQ.addEventListener('change', placeInfo);
placeInfo();

function showInfoTab() {
  if (desktopMQ.matches) return;
  if (searchInput.value) { searchInput.value = ''; runSearch(); }
  searchInput.blur();
  showTab('info');
  // In slice mode the 2D section sits above the sheet, so keep the sheet low.
  if (state.mode === 'slice') return;
  if (sheet.snap === 'full') sheet.setSnap('half');
  else sheet.expandAtLeast('half');
}

const sheet = createSheet({
  app: $('#app'),
  sheet: $('#left'),
  dragZones: [$('#sheet-handle'), $('#left-tabs')],
  onChange: (px) => {
    viewer.showHelper = desktopMQ.matches;
    viewer.setBottomInset(px);
  },
});
viewer.camera.position.copy(viewer.homePosition());

// ---------------------------------------------------------------- picking & hover
const canvas = viewer.renderer.domElement;
let down = null;
let hoverTimer = 0;
let activePointers = 0;
let lastPointerType = 'mouse';
let lastTap = null;
canvas.addEventListener('pointerdown', (e) => {
  activePointers++;
  lastPointerType = e.pointerType;
  closePopovers();
  down = activePointers === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
});
const pointerEnd = () => { activePointers = Math.max(0, activePointers - 1); };
canvas.addEventListener('pointercancel', () => { pointerEnd(); down = null; });
canvas.addEventListener('pointerup', (e) => {
  pointerEnd();
  if (!down) return;
  const tol = e.pointerType === 'touch' ? 10 : 4;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > tol;
  const long = performance.now() - down.t > 600;
  down = null;
  if (moved || long || e.button !== 0) return;
  if (desktopMQ.matches && viewer.viewHelper.handleClick(e)) return;
  // Touch double-tap focuses the structure, like double-click with a mouse.
  const now = performance.now();
  if (e.pointerType !== 'mouse' && lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
    lastTap = null;
    focusAt(e);
    return;
  }
  lastTap = { t: now, x: e.clientX, y: e.clientY };
  const hit = picker.pick(e.clientX, e.clientY);
  if (hit) select([hit.structure], { add: e.shiftKey, point: hit.point.clone() });
  else if (!e.shiftKey) clearSelection();
});
canvas.addEventListener('dblclick', (e) => { if (lastPointerType === 'mouse') focusAt(e); });
function focusAt(e) {
  const hit = picker.pick(e.clientX, e.clientY);
  if (hit) {
    select([hit.structure], { point: hit.point.clone() });
    const s = hit.structure;
    const box = model.geo(s).box.clone().translate(s.offset);
    const size = box.getSize(new THREE.Vector3()).length();
    const dir = viewer.camera.position.clone().sub(viewer.controls.target).normalize();
    viewer.flyTo(hit.point, hit.point.clone().addScaledVector(dir, Math.max(size * 1.4, 12)));
  }
}
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  if (e.buttons) { hideTooltip(); return; }
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => doHover(e), 40);
});
canvas.addEventListener('pointerleave', () => { clearTimeout(hoverTimer); setHover(null); hideTooltip(); });

function doHover(e) {
  const hit = picker.pick(e.clientX, e.clientY);
  const s = hit?.structure || null;
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
      const g = s && model.geo(s);
      if (!g) { pin.classList.add('hidden'); return; }
      p = g.center.clone().add(s.offset);
      if (state.selectedGroup) {
        const box = new THREE.Box3();
        for (const x of sel) if (model.geo(x)) box.union(model.geo(x).box);
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
  const p = new URLSearchParams();
  if (model.sex === 'f') p.set('sex', 'f');
  if (state.selectedGroup) p.set('group', state.selectedGroup.join('/'));
  else if (sel.length === 1) p.set('s', sel[0].label);
  const h = p.toString();
  history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
}

// ---------------------------------------------------------------- body (sex)
function initialSex() {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('sex');
  let stored = null;
  try { stored = localStorage.getItem('sex'); } catch { /* storage unavailable */ }
  const s = fromHash || stored;
  return s === 'f' ? 'f' : 'm';
}

function updateSexUI() {
  document.querySelectorAll('[data-sex]').forEach((b) => b.classList.toggle('active', b.dataset.sex === model.sex));
  for (const [k, ui] of Object.entries(state.layerUI)) {
    const n = model.layers[k].counts[model.sex] || 0;
    ui.count.textContent = n.toLocaleString();
    ui.row.classList.toggle('hidden', n === 0);
  }
}

async function setSex(sex) {
  if (sex === model.sex) return;
  model.setSex(sex);
  try { localStorage.setItem('sex', sex); } catch { /* storage unavailable */ }
  state.selection = state.selection.filter((s) => model.inBody(s));
  if (state.hover && !model.inBody(state.hover)) state.hover = null;
  searchIndex = null;
  if (searchInput.value) runSearch();
  updateSexUI();
  tree.build();
  const pending = Object.values(model.layers).filter((l) => l.visible && !model.isLoaded(l.key));
  if (pending.length) {
    $('#loading').classList.remove('hidden');
    $('#loading-bar').style.width = '0%';
    let done = 0;
    await Promise.all(pending.map((l) => model.loadLayer(l.key, sex, () => {}).then(() => {
      done++;
      $('#loading-detail').textContent = `${SEXES[sex]} body · ${l.label}`;
      $('#loading-bar').style.width = `${(done / pending.length) * 100}%`;
      onLayerLoaded(l.key);
    })));
    $('#loading').classList.add('hidden');
  }
  computeBounds();
  applyExplode();
  refreshHighlights();
  renderInfo();
  updateHash();
  if (animator.running) animator.refresh();
  if (slice.enabled) slice.recomputeSection();
  viewer.requestRender();
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
    const g = s && model.geo(s);
    if (!g) continue;
    s.offset.set(g.center.x * k * 1.6, (g.center.y - BODY_CENTER.y) * k * 0.35, g.center.z * k * 2.2);
    for (const p of s.parts) model.store.setOffset(p.id, s.offset.x, s.offset.y, s.offset.z);
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
document.querySelectorAll('#render-style-seg button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('#render-style-seg button').forEach((x) => x.classList.toggle('active', x === b));
    setRenderStyle(b.dataset.style);
  };
});
function setRenderStyle(style) {
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
}

// ---------------------------------------------------------------- animations
const GUT_ANIMATED = /pharynx|oesophagus|stomach|duodenum|jejunum|ileum|caecum|colon|rectum|taenia/i;
function animationFor(s) {
  if (['heart', 'arteries', 'veins'].includes(s.layer)) return 'blood';
  if (s.layer === 'nerves' || s.layer === 'cns') return 'nerves';
  if (s.layer === 'digestive' && GUT_ANIMATED.test(s.name)) return 'digestion';
  return null;
}

let layersBeforeAnimation = null;
function setAnimation(name, on) {
  if (on === animator.active.has(name)) return;
  if (on) {
    if (state.mode === 'xray') setMode('normal');
    if (!animator.running) {
      layersBeforeAnimation = {
        visible: Object.keys(model.layers).filter((k) => model.layers[k].visible),
        opacity: Object.fromEntries(Object.keys(model.layers).map((k) => [k, model.layers[k].opacity])),
      };
    }
    // Show only the animated systems, with the skeleton faded behind them.
    const shown = new Set([...animator.active, name].flatMap((n) => ANIMATIONS[n].show));
    for (const k of Object.keys(ANIMATION_CONTEXT)) shown.add(k);
    setLayers([...shown]);
    for (const [k, v] of Object.entries(ANIMATION_CONTEXT)) setLayerOpacityUI(k, Math.min(v, model.layers[k].opacity));
  }
  animator.set(name, on);
  if (!on && animator.running) {
    setLayers([...new Set([...animator.active].flatMap((n) => ANIMATIONS[n].show)), ...Object.keys(ANIMATION_CONTEXT)]);
  }
  if (!on && !animator.running && layersBeforeAnimation) {
    setLayers(layersBeforeAnimation.visible);
    for (const [k, v] of Object.entries(layersBeforeAnimation.opacity)) setLayerOpacityUI(k, v);
    layersBeforeAnimation = null;
    viewer.requestRender();
  }
  updateAnimationUI();
  if (state.selection.length) renderInfo();
}
function updateAnimationUI() {
  document.querySelectorAll('#anim-bar [data-anim]').forEach((cb) => { cb.checked = animator.active.has(cb.dataset.anim); });
  $('#fab-anim').classList.toggle('active', animator.running || !$('#anim-bar').classList.contains('hidden'));
}
document.querySelectorAll('#anim-bar [data-anim]').forEach((cb) => {
  cb.addEventListener('change', () => setAnimation(cb.dataset.anim, cb.checked));
});
document.querySelectorAll('#anim-speed button').forEach((b) => {
  b.onclick = () => {
    animator.speed = +b.dataset.speed;
    document.querySelectorAll('#anim-speed button').forEach((x) => x.classList.toggle('active', x === b));
  };
});

// ---------------------------------------------------------------- modes
const modePanel = $('#mode-panel');
modePanel.addEventListener('click', (e) => {
  if (e.target.closest('h4') && !desktopMQ.matches) modePanel.classList.toggle('expanded');
});
let savedLayers = null;

function setMode(mode) {
  if (state.mode === mode) return;
  const prev = state.mode;
  state.mode = mode;
  document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  if (prev === 'xray') {
    xray.enable(false);
    refreshHighlights();
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
    for (const name of [...animator.active]) setAnimation(name, false);
    savedLayers = {
      visible: Object.keys(model.layers).filter((k) => model.layers[k].visible),
      opacity: Object.fromEntries(Object.keys(model.layers).map((k) => [k, model.layers[k].opacity])),
    };
    setLayers(VIEW_PRESETS.xray);
    for (const k of Object.keys(model.layers)) setLayerOpacityUI(k, 1);
    xray.enable(true);
    refreshHighlights();
    buildXrayPanel();
    if (viewer.camera.position.distanceTo(viewer.controls.target) < 150) viewer.resetView();
  }
  if (mode === 'slice') {
    if (state.explode) { state.explode = 0; $('#explode').value = 0; paintRange($('#explode')); applyExplode(); }
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
    <div class="ctl adv"><label>Slab thickness <span id="slab-val">${slice.slab ? slice.slab.toFixed(1) + ' cm' : 'off'}</span></label>
      <input type="range" id="slice-slab" min="0" max="20" step="0.25" value="${slice.slab}" /></div>
    <div class="row adv">
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
  paintRanges(modePanel);
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
    <div class="ctl adv"><label>Contrast <span id="xv-con"></span></label><input type="range" id="x-con" min="0.6" max="3" step="0.01" value="${p.contrast}" /></div>
    <div class="ctl adv"><label>Edge enhancement <span id="xv-sh"></span></label><input type="range" id="x-sh" min="0" max="3" step="0.01" value="${p.sharpen}" /></div>
    <div class="row adv">
      <label class="chk"><input type="checkbox" id="x-inv" ${p.invert ? 'checked' : ''}/> Invert (negative)</label>
      <label class="chk"><input type="checkbox" id="x-hl" ${p.highlight ? 'checked' : ''}/> Highlight selection</label>
    </div>
    <p class="muted adv">Brightness is the simulated attenuation along each ray (Beer–Lambert law) through every visible layer. Toggle layers to change what is imaged.</p>`;
  const bind = (id, key, out, fmt) => {
    const i = $(id);
    const upd = () => { p[key] = +i.value; $(out).textContent = fmt(p[key]); viewer.requestRender(); };
    i.addEventListener('input', upd);
    $(out).textContent = fmt(p[key]);
  };
  bind('#x-exp', 'exposure', '#xv-exp', (v) => v.toFixed(3));
  bind('#x-con', 'contrast', '#xv-con', (v) => v.toFixed(2));
  bind('#x-sh', 'sharpen', '#xv-sh', (v) => v.toFixed(2));
  paintRanges(modePanel);
  $('#x-inv').addEventListener('change', (e) => { p.invert = e.target.checked; viewer.requestRender(); });
  $('#x-hl').addEventListener('change', (e) => { p.highlight = e.target.checked; viewer.requestRender(); });
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
  model.refreshAppearance();
  for (const it of sectionView.items) delete it.hex;
  if (e.target.value === 'function' && !model.layers.muscles.visible) setLayerVisible('muscles', true);
  viewer.requestRender();
  if (slice.enabled) sectionView.draw();
});
// ---------------------------------------------------------------- theme
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme(pref) {
  const theme = pref === 'auto' ? (darkMQ.matches ? 'dark' : 'light') : pref;
  document.documentElement.dataset.theme = theme;
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  viewer.setBackdrop(v('--scene-top'), v('--scene-bottom'), v('--scene-glow'));
  document.querySelector('meta[name=theme-color]').content = v('--bg');
  if (slice.enabled) sectionView.draw();
}
let themePref = 'dark';
try { themePref = localStorage.getItem('theme') || 'dark'; } catch { /* storage unavailable */ }
$('#theme').value = themePref;
applyTheme(themePref);
$('#theme').addEventListener('change', (e) => {
  themePref = e.target.value;
  try { localStorage.setItem('theme', themePref); } catch { /* storage unavailable */ }
  applyTheme(themePref);
});
darkMQ.addEventListener('change', () => { if (themePref === 'auto') applyTheme(themePref); });
paintRanges();

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
function closePopovers(except) {
  for (const id of ['#menu', '#view-bar', '#anim-bar']) if (id !== except) $(id).classList.add('hidden');
  $('#fab-view').classList.toggle('active', except === '#view-bar');
  $('#fab-anim').classList.toggle('active', except === '#anim-bar' || animator.running);
}
const togglePopover = (id) => {
  const open = $(id).classList.contains('hidden');
  closePopovers(open ? id : undefined);
  $(id).classList.toggle('hidden', !open);
};
$('#btn-menu').addEventListener('click', (e) => { e.stopPropagation(); togglePopover('#menu'); });
$('#fab-view').addEventListener('click', (e) => { e.stopPropagation(); togglePopover('#view-bar'); });
$('#fab-anim').addEventListener('click', (e) => { e.stopPropagation(); togglePopover('#anim-bar'); });
$('#fab-reset').addEventListener('click', () => { closePopovers(); viewer.resetView(); });
$('#btn-search').addEventListener('click', () => { showTab($('#left-tabs .active')?.dataset.tab || 'layers'); searchInput.focus(); });
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.popover, #btn-menu, #fab-view, #fab-anim')) closePopovers();
});

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
    if (i) { i.value = slice.position; paintRange(i); }
  } else if (k === '/') { e.preventDefault(); searchInput.focus(); }
});

window.__app = { viewer, model, xray, slice, picker, select, setMode, setLayers, setSex, state, animator, setAnimation };

init().catch((err) => {
  console.error(err);
  $('#loading-detail').textContent = 'Failed to load: ' + err.message;
});
