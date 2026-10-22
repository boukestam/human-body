import { LAYER_COLORS } from './palette.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Hierarchical anatomy browser (system › region › structure), rendered lazily.
export function buildTree(host, model, { onSelectStructure, onSelectGroup, onToggle, isSelected }) {
  let root = null;
  const open = new Set();

  function build() {
    root = { name: '', path: [], children: new Map(), structures: [], all: [] };
    for (const s of model.structures) {
      if (!s) continue;
      let node = root;
      node.all.push(s);
      for (const p of s.path) {
        if (!node.children.has(p)) node.children.set(p, { name: p, path: [...node.path, p], children: new Map(), structures: [], all: [] });
        node = node.children.get(p);
        node.all.push(s);
      }
      node.structures.push(s);
    }
    for (const c of root.children.values()) open.add(key(c.path));
    render();
  }

  const key = (path) => path.join('\u0001');

  function visibleState(list) {
    let on = 0;
    for (const s of list) if (!s.hidden && model.layers[s.layer].visible) on++;
    return on === 0 ? 'off' : on === list.length ? 'on' : 'mixed';
  }

  function renderNode(node, container) {
    const kids = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const c of kids) {
      const row = document.createElement('div');
      row.className = 'tree-row';
      const isOpen = open.has(key(c.path));
      const vs = visibleState(c.all);
      row.innerHTML = `<span class="caret ${isOpen ? 'open' : ''}">▶</span><span class="eye ${vs === 'off' ? 'off' : ''}" title="Show / hide">${vs === 'mixed' ? '◐' : '●'}</span><span class="label">${esc(c.name)}</span><span class="n">${c.all.length}</span>`;
      row.querySelector('.caret').onclick = (e) => { e.stopPropagation(); toggleOpen(c.path); };
      row.querySelector('.eye').onclick = (e) => { e.stopPropagation(); onToggle(c.all, vs !== 'on'); };
      row.querySelector('.label').onclick = () => onSelectGroup(c.path);
      row.ondblclick = () => toggleOpen(c.path);
      container.append(row);
      if (isOpen) {
        const sub = document.createElement('div');
        sub.className = 'tree-children';
        renderNode(c, sub);
        container.append(sub);
      }
    }
    const leaves = [...node.structures].sort((a, b) => a.name.localeCompare(b.name) || a.side.localeCompare(b.side));
    for (const s of leaves) {
      const row = document.createElement('div');
      row.className = 'tree-row leaf' + (isSelected(s) ? ' selected' : '');
      row.dataset.id = s.id;
      const shown = !s.hidden && model.layers[s.layer].visible;
      row.innerHTML = `<span class="caret"></span><span class="eye ${shown ? '' : 'off'}" title="Show / hide" style="color:${LAYER_COLORS[s.layer]}">●</span><span class="label">${esc(s.name)}${s.side ? `<span class="side">${s.side.toUpperCase()}</span>` : ''}</span>`;
      row.querySelector('.eye').onclick = (e) => { e.stopPropagation(); onToggle([s], !shown); };
      row.querySelector('.label').onclick = () => onSelectStructure(s);
      container.append(row);
    }
  }

  function toggleOpen(path) {
    const k = key(path);
    if (open.has(k)) open.delete(k); else open.add(k);
    render();
  }

  function render() {
    if (!root) return;
    const scroll = host.scrollTop;
    host.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'tree';
    renderNode(root, t);
    host.append(t);
    host.scrollTop = scroll;
  }

  let pending = false;
  function refresh() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  }

  function reveal(s) {
    for (let i = 1; i <= s.path.length; i++) open.add(key(s.path.slice(0, i)));
    render();
    requestAnimationFrame(() => host.querySelector(`[data-id="${s.id}"]`)?.scrollIntoView({ block: 'nearest' }));
  }

  return { build, refresh, reveal };
}
