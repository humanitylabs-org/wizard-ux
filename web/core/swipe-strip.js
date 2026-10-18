/* Swipe strip (phone): chat list ⇄ thread ⇄ whatever the thread opened, by finger, anywhere.
 *
 *   List ──swipe left──▶ last thread ──swipe left──▶ next desk (the link / app / browser it opened)
 *   List ◀──swipe right── thread     ◀──swipe right── next desk (from its left edge)
 *
 * - In a thread, a horizontal swipe anywhere works (the page follows the finger).
 * - In the list, rows keep their own swipes (read / actions), so the forward swipe starts at the right edge.
 * - On a desk opened from a thread (link, bound view, app), a strip along the left edge drags back.
 * Desk moves reuse the shell's own track (placeTrack/goDesk), so the next desk slides in under the finger.
 * Everything else (Back, bottom-bar swipe, row gestures) is unchanged.
 */
(() => {
  'use strict';
  const S = () => window.__wos;
  const EDGE = 26, LOCK = 10, GO = 70, VGO = 0.45;
  const lastThread = {};
  try { Object.assign(lastThread, JSON.parse(localStorage.getItem('wos.swipe.last') || '{}')); } catch (e) {}
  const saveLast = () => { try { localStorage.setItem('wos.swipe.last', JSON.stringify(lastThread)); } catch (e) {} };

  function focusWin() { const s = S(); if (!s) return null; const d = s.desks[s.idx]; return d && s.wins[d.focus] ? { id: d.focus, w: s.wins[d.focus] } : null; }
  function nextDeskUsable() { const s = S(); const d = s.desks[s.idx + 1]; return !!(d && d.wins && d.wins.length); }
  function remember() {
    const s = S(); if (!s) return;
    for (const [id, w] of Object.entries(s.wins)) if (w.app === 'chats' && w.thread && w.thread !== '__new__' && lastThread[id] !== w.thread) { lastThread[id] = w.thread; saveLast(); }
  }
  setInterval(remember, 700);

  // Edge strips on desks opened from a thread (frames can't hand their touches to the shell).
  function addEdges() {
    const s = S(); if (!s) return;
    for (const el of document.querySelectorAll('#track .win[data-win]')) {
      const w = s.wins[el.dataset.win], want = !!(w && (w.from || w.bound) && w.app !== 'chats');
      const has = el.querySelector(':scope > .ss-edge');
      if (want && !has) { const e = document.createElement('div'); e.className = 'ss-edge'; e.setAttribute('aria-hidden', 'true'); el.appendChild(e); }
      else if (!want && has) has.remove();
    }
  }
  setInterval(addEdges, 600);
  const css = document.createElement('style');
  css.textContent = `.ss-edge{position:absolute;left:0;top:0;bottom:0;width:${EDGE}px;z-index:30;touch-action:none}
  .ss-move{will-change:transform}.ss-anim{transition:transform 240ms cubic-bezier(.2,.8,.2,1),opacity 240ms}`;
  document.head.appendChild(css);

  let G = null, blockClick = 0;
  const blocker = e => { if (Date.now() < blockClick) { e.stopImmediatePropagation(); e.preventDefault(); } };
  window.addEventListener('click', blocker, true);

  function begin(e) {
    const s = S(); if (!s || e.button > 0 || s.sheet || (s.links && s.links.isOpen && s.links.isOpen())) return;
    if (e.target.closest('input, textarea, select, [contenteditable], .mviewer, .ms-track, #dock, #orbWrap, .sheet, .overview')) return;
    const winEl = e.target.closest('#track .win[data-win]'); if (!winEl) return;
    const f = focusWin(); if (!f || f.id !== winEl.dataset.win) return;
    const r = winEl.getBoundingClientRect(), x = e.clientX - r.left;
    const edgeStrip = e.target.classList.contains('ss-edge');
    let kind = null;
    if (edgeStrip) kind = 'back-desk';
    else if (f.w.app === 'chats' && f.w.thread) kind = 'thread';
    else if (f.w.app === 'chats' && !f.w.thread && x > r.width - EDGE * 1.6) kind = 'list';
    if (!kind) return;
    G = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), lx: e.clientX, lt: performance.now(), v: 0, kind, wid: f.id, w: f.w, el: winEl.querySelector('[data-chats]') || winEl, lock: edgeStrip ? 'h' : null, act: null };
    if (edgeStrip) { try { e.target.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); }
  }
  function move(e) {
    if (!G || e.pointerId !== G.id) return;
    const dx = e.clientX - G.x, dy = e.clientY - G.y, now = performance.now();
    if (!G.lock) {
      if (Math.hypot(dx, dy) < LOCK) return;
      G.lock = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'h' : 'v';
      if (G.lock === 'v') { G = null; return; }
      try { (e.target.setPointerCapture ? e.target : document.body).setPointerCapture(e.pointerId); } catch (_) {}
    }
    e.preventDefault(); e.stopPropagation();
    G.v = (e.clientX - G.lx) / Math.max(1, now - G.lt); G.lx = e.clientX; G.lt = now;
    const s = S();
    // Decide what this drag means from its direction, and show it under the finger.
    if (G.kind === 'thread') G.act = dx > 0 ? 'to-list' : (nextDeskUsable() ? 'to-next' : null);
    else if (G.kind === 'list') G.act = dx < 0 ? (lastThread[G.wid] ? 'to-thread' : (nextDeskUsable() ? 'to-next' : null)) : null;
    else if (G.kind === 'back-desk') G.act = dx > 0 && s.idx > 0 ? 'to-prev' : null;
    if (G.act === 'to-next' || G.act === 'to-prev') { reset(G.el); s.placeTrack && s.placeTrack(dx, false); }
    else if (G.act === 'to-list' || G.act === 'to-thread') { if (s.placeTrack) s.placeTrack(0, false); G.el.classList.add('ss-move'); G.el.classList.remove('ss-anim'); G.el.style.transform = `translate3d(${dx}px,0,0)`; G.el.style.opacity = String(1 - Math.min(.5, Math.abs(dx) / 700)); }
    else { reset(G.el); s.placeTrack && s.placeTrack(dx * .15, false); }
  }
  function reset(el) { if (!el) return; el.classList.remove('ss-move', 'ss-anim'); el.style.transform = ''; el.style.opacity = ''; }
  function end(e) {
    if (!G || e.pointerId !== G.id) return; const g = G; G = null;
    if (g.lock !== 'h') return;
    blockClick = Date.now() + 350;
    const s = S(), dx = e.clientX - g.x, far = Math.abs(dx) > GO || Math.abs(g.v) > VGO;
    const fire = e.type !== 'pointercancel' && far && g.act && ((dx < 0) === (g.act === 'to-next' || g.act === 'to-thread'));
    if (!fire) { if (s.placeTrack) s.placeTrack(0, true); slideBack(g.el); return; }
    if (g.act === 'to-next') { reset(g.el); s.goDesk(s.idx + 1); }
    else if (g.act === 'to-prev') s.goDesk(s.idx - 1);
    else if (g.act === 'to-list') slideOut(g.el, 1, () => { s.chats.threadBack ? s.chats.threadBack(s.wins[g.wid]) : s.chats.chatsBack(s.wins[g.wid]); slideIn(g.wid, -1); });
    else if (g.act === 'to-thread') slideOut(g.el, -1, () => { s.chats.openChat(g.wid, lastThread[g.wid]); slideIn(g.wid, 1); });
    try { navigator.vibrate && navigator.vibrate(8); } catch (_) {}
  }
  function slideBack(el) { if (!el || !el.style.transform) return; el.classList.add('ss-anim'); el.style.transform = 'translate3d(0,0,0)'; el.style.opacity = '1'; setTimeout(() => reset(el), 260); }
  function slideOut(el, dir, then) { el.classList.add('ss-anim'); el.style.transform = `translate3d(${dir * 100}%,0,0)`; el.style.opacity = '.4'; setTimeout(() => { reset(el); then(); }, 200); }
  function slideIn(wid, from) {
    requestAnimationFrame(() => {
      const el = document.querySelector(`#track .win[data-win="${wid}"] [data-chats]`); if (!el) return;
      el.classList.add('ss-move'); el.style.transform = `translate3d(${from * 30}%,0,0)`; el.style.opacity = '.4';
      requestAnimationFrame(() => { el.classList.add('ss-anim'); el.style.transform = 'translate3d(0,0,0)'; el.style.opacity = '1'; setTimeout(() => reset(el), 260); });
    });
  }
  document.addEventListener('pointerdown', begin, true);
  document.addEventListener('pointermove', move, { capture: true, passive: false });
  document.addEventListener('pointerup', end, true);
  document.addEventListener('pointercancel', end, true);
  window.WosSwipeStrip = { lastThread, get active() { return G; } };
})();
