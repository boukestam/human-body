// Bottom sheet for phone layouts: drag the handle or tab bar between three
// snap points (peek, half, full). On desktop the sheet is a static sidebar.

export const desktopMQ = window.matchMedia('(min-width: 1024px)');

export function createSheet({ app, sheet, dragZones, onChange }) {
  let snap = 'peek';
  let height = 0;

  const safeBottom = () => parseFloat(getComputedStyle(sheet).paddingBottom) || 0;
  const heights = () => {
    const h = app.clientHeight;
    return {
      peek: 122 + safeBottom(),
      half: Math.round(h * 0.5),
      full: Math.round(h - 60 - (parseFloat(getComputedStyle(document.querySelector('#topbar')).paddingTop) || 0)),
    };
  };

  function apply(px, notify = true) {
    height = px;
    app.style.setProperty('--sheet-h', `${px}px`);
    if (notify) onChange?.(px, snap);
  }

  function setSnap(name) {
    if (desktopMQ.matches) return;
    snap = name;
    apply(heights()[name]);
  }

  function nearest(px, velocity) {
    const hs = heights();
    if (velocity < -0.6) return px < hs.half ? 'half' : 'full';
    if (velocity > 0.6) return px > hs.half ? 'half' : 'peek';
    let best = 'peek', bestD = Infinity;
    for (const [k, v] of Object.entries(hs)) {
      const d = Math.abs(v - px);
      if (d < bestD) { bestD = d; best = k; }
    }
    return best;
  }

  for (const zone of dragZones) {
    let start = null;
    zone.addEventListener('pointerdown', (e) => {
      if (desktopMQ.matches || e.button > 0) return;
      start = { y: e.clientY, h: height || heights()[snap], t: performance.now(), lastY: e.clientY, lastT: performance.now(), v: 0, moved: false, id: e.pointerId };
    });
    zone.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dy = e.clientY - start.y;
      if (!start.moved && Math.abs(dy) < 6) return;
      if (!start.moved) {
        start.moved = true;
        zone.setPointerCapture(e.pointerId);
        sheet.classList.add('dragging');
      }
      const now = performance.now();
      start.v = (e.clientY - start.lastY) / Math.max(1, now - start.lastT);
      start.lastY = e.clientY;
      start.lastT = now;
      const hs = heights();
      apply(Math.min(hs.full, Math.max(hs.peek, start.h - dy)), false);
    });
    const end = (e) => {
      if (!start || e.pointerId !== start.id) return;
      const s = start;
      start = null;
      sheet.classList.remove('dragging');
      if (!s.moved) {
        if (zone.classList.contains('sheet-handle')) setSnap(snap === 'peek' ? 'half' : 'peek');
        return;
      }
      setSnap(nearest(height, s.v));
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  function layout() {
    if (desktopMQ.matches) {
      app.style.removeProperty('--sheet-h');
      height = 0;
      onChange?.(0, 'desktop');
    } else {
      setSnap(snap);
    }
  }
  desktopMQ.addEventListener('change', layout);
  window.addEventListener('resize', () => { if (!desktopMQ.matches) setSnap(snap); });
  layout();

  return {
    setSnap,
    get snap() { return snap; },
    expandAtLeast(name) {
      const order = ['peek', 'half', 'full'];
      if (order.indexOf(snap) < order.indexOf(name)) setSnap(name);
    },
  };
}
