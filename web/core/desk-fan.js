/* Desk fan (James, 25 Oct 2026 prototype): hold the orb and every open desk fans out in an arc above the
 * thumb, in strip order (Home on the left). Slide onto one (it grows and the desk slides in behind the fan),
 * release to jump there; release near the orb to cancel. Positions are fixed by desk index so the thumb learns
 * them: one ring for up to 6 desks, a second outer ring for the rest (2D selection, like an art app's palette).
 * Shell-agnostic: the caller supplies items and the anchor; this module owns layout, hit-testing and paint. */
(() => {
  'use strict';
  const R1 = 112, R2 = 192, CANCEL_R = 38, PICK_SLACK = 64;
  let el = null, st = null;
  function layout(n, cx, cy, vw) {
    const inner = n <= 6 ? n : Math.min(6, Math.ceil(n / 2)), outer = n - inner;
    const ring = (count, r, a0, a1) => Array.from({ length: count }, (_, k) => {
      const a = (count === 1 ? (a0 + a1) / 2 : a0 + (a1 - a0) * k / (count - 1)) * Math.PI / 180;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), ring: r };
    });
    // Angles in screen terms: -90 is straight up. The inner ring spans a wider sweep than the outer one,
    // so items on both rings stay a thumb apart on a 360-412px phone.
    const spanFor = c => Math.min(150, 30 * Math.max(1, c - 1));
    const s1 = spanFor(inner), s2 = Math.min(120, 22 * Math.max(1, outer - 1));
    let pts = ring(inner, R1, -90 - s1 / 2, -90 + s1 / 2).concat(ring(outer, R2, -90 - s2 / 2, -90 + s2 / 2));
    // Keep the fan on screen (corner orb, narrow phones): slide it sideways as one piece.
    const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x)), pad = 30;
    const shift = minX < pad ? pad - minX : maxX > vw - pad ? vw - pad - maxX : 0;
    if (shift) pts = pts.map(p => ({ ...p, x: p.x + shift }));
    return pts;
  }
  function open({ x, y, items, current, onHover }) {
    close();
    const vw = document.documentElement.clientWidth;
    const pts = layout(items.length, x, y, vw);
    el = document.createElement('div');
    el.className = 'wdf'; el.setAttribute('role', 'listbox'); el.setAttribute('aria-label', 'Open desks');
    el.innerHTML = `<div class="wdf-veil"></div><div class="wdf-label" aria-live="polite"></div>` + items.map((it, i) =>
      `<div class="wdf-item${i === current ? ' cur' : ''}" role="option" data-i="${i}" style="left:${pts[i].x}px;top:${pts[i].y}px;--d:${i * 18}ms">${it.html}</div>`).join('');
    document.body.appendChild(el);
    st = { x, y, items, pts, sel: null, onHover };
    requestAnimationFrame(() => el && el.classList.add('on'));
    paint();
  }
  function pick(px, py) {
    if (!st) return null;
    if (Math.hypot(px - st.x, py - st.y) < CANCEL_R) return null;
    let best = null, bd = Infinity;
    st.pts.forEach((p, i) => { const d = Math.hypot(px - p.x, py - p.y); if (d < bd) { bd = d; best = i; } });
    return bd <= PICK_SLACK + (st.pts[best].ring === R2 ? 10 : 0) || bd < 140 ? best : null;
  }
  function move(px, py) {
    if (!st) return;
    const s = pick(px, py);
    if (s !== st.sel) { st.sel = s; paint(); try { navigator.vibrate && navigator.vibrate(s == null ? 4 : 8); } catch (_) {} st.onHover?.(s); }
  }
  function paint() {
    if (!el || !st) return;
    el.querySelectorAll('.wdf-item').forEach(n => n.classList.toggle('sel', +n.dataset.i === st.sel));
    const L = el.querySelector('.wdf-label');
    L.textContent = st.sel == null ? 'Slide to a desk · release here to cancel' : st.items[st.sel].label;
    L.style.top = (Math.min(...st.pts.map(p => p.y)) - 58) + 'px';
  }
  function release() { const s = st ? st.sel : null; close(); return s; }
  function close() {
    if (!el) { st = null; return; }
    const gone = el; el = null; st = null;
    gone.classList.remove('on'); gone.classList.add('off');
    setTimeout(() => gone.remove(), 180);
  }
  window.WosDeskFan = { open, move, release, close, get open_() { return !!el; }, get selected() { return st ? st.sel : null; }, _layout: layout };
})();
