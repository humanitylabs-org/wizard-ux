// Miguel's skin behaviour (Dark, Light, Landscapes), ported from his test port into the skin package.
// Uses only the skin API (web/skins/README.md); James's skins never load this file.
//   1. (retired) Back is a small chevron in the thread header; the dock keeps no Back button.
//   2. Defer / Done sit on the model-switch row instead of a row of their own.
//   3. Swipe strip (phone): swipe left from the list's right edge reopens the last thread;
//      swipe left inside a thread goes to the desk it opened (link / app), if there is one.
//   4. Send and go (desktop): after sending in a thread, land in a fresh New chat.
const SVGNS = 'http://www.w3.org/2000/svg';

export function setupBehaviour(api) {
  const phone = api.env.shell !== 'desktop';
  const offs = [];

  /* 1. Back lives in the thread header only (a small chevron, styled in skin.css); the dock stays the same pill
   *    everywhere. Swipe right still goes back. */
  const syncBack = () => {};

  /* 2. Defer / Done onto the switch row */
  const moveActs = () => {
    const root = api.part('thread'); if (!root) return;
    const row = root.querySelector('.ch-swrow'); if (!row) return;
    const acts = [...root.querySelectorAll('.ch-tacts')];
    const fresh = acts.find(a => !row.contains(a));
    if (!fresh) return;
    acts.filter(a => row.contains(a)).forEach(a => a.remove());
    row.appendChild(fresh);
  };

  /* 3. Swipe strip */
  let last = api.storage.get('lastThread') || null, sw = null;
  const remember = () => { const r = api.route(); if (r.view === 'thread' && r.thread && r.thread !== '__new__' && r.thread !== last) { last = r.thread; api.storage.set('lastThread', last); } };
  const bound = new WeakSet();
  const bindSwipe = root => {
    if (!phone || !root || bound.has(root)) return; bound.add(root);
    api.listen(root, 'touchstart', e => {
      sw = null; if (e.touches.length !== 1) return;
      const t = e.touches[0], view = api.route().view;
      if (e.target.closest && e.target.closest('pre, table, input, textarea, [contenteditable="true"], .ms-track')) return;
      if (view === 'list' && last && t.clientX > innerWidth - 28) sw = { x: t.clientX, y: t.clientY, t: performance.now(), view };
      else if (view === 'thread' && t.clientX > api.env.edgeInset) sw = { x: t.clientX, y: t.clientY, t: performance.now(), view };
    }, { passive: true });
    // The right-edge strip on the list owns its finger: the row under it does not also swipe to Done / actions.
    api.listen(root, 'pointerdown', e => {
      if (e.pointerType === 'touch' && api.route().view === 'list' && last && e.clientX > innerWidth - 28) api.gesture.claim(e.pointerId);
    }, { passive: true });
    const end = e => {
      const s = sw; sw = null; const t = e.changedTouches && e.changedTouches[0]; if (!s || !t || e.type === 'touchcancel') return;
      const dx = t.clientX - s.x, dy = Math.abs(t.clientY - s.y);
      if (dx >= 0 || !api.gesture.intent(dx, dy, performance.now() - s.t)) return; // the shell's one swipe threshold, leftward
      if (s.view === 'list' && last) api.nav.openThread(last);
      else if (s.view === 'thread') { const d = api.route().desk; if (d + 1 < api.nav.deskCount()) api.nav.goDesk(d + 1); }
    };
    api.listen(root, 'touchend', end, { passive: true });
    api.listen(root, 'touchcancel', end, { passive: true });
  };

  /* 4. Send and go (desktop) */
  const sendBound = new WeakSet();
  const bindSend = root => {
    if (phone || !root || sendBound.has(root)) return; sendBound.add(root);
    api.listen(root, 'submit', e => {
      const f = e.target.closest && e.target.closest('[data-chform]'); if (!f) return;
      const r = api.route(); if (r.view !== 'thread' || !r.thread || r.thread === '__new__') return;
      const ta = f.querySelector('textarea'); if (ta && !ta.value.trim() && !f.querySelector('.ch-att, .att')) return;
      // Let the shell send first, then open a fresh New chat through its own New button handler.
      api.frame(() => api.frame(() => {
        if (api.route().thread !== r.thread) return;
        const b = document.createElement('button'); b.type = 'button'; b.hidden = true; b.setAttribute('data-chnew', '');
        root.appendChild(b); b.click(); b.remove();
        api.frame(() => { const t = root.querySelector('.ch-compose textarea'); t && t.focus(); });
      }));
    });
  };

  const tick = () => { const root = api.part('thread') || api.part('list'); bindSwipe(root); bindSend(root); syncBack(); moveActs(); remember(); };
  tick();
  api.on('render', tick);
  api.on('route', tick);
  return () => { sw = null; offs.forEach(f => f()); };
}
