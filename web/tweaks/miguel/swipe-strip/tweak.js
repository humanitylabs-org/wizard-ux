export default function setup(api) {
  let last = api.storage.get('lastThread'), swipe = null;
  if (api.env.shell === 'desktop') return () => {};
  let bound = null, offs = [];
  const unbind = () => { offs.forEach(off => off()); offs = []; bound = null; };
  const sync = () => {
    const r = api.route(); if (r.thread && r.thread !== '__new__') { last = r.thread; api.storage.set('lastThread', last); }
    const root = api.part('thread') || api.part('list'); if (root === bound) return; unbind(); if (!root) return; bound = root;
    offs.push(api.listen(root, 'touchstart', e => { swipe = null; if (e.touches.length !== 1 || e.target.closest('[data-part="composer"]')) return;
      const t = e.touches[0], view = api.route().view;
      if ((view === 'list' && last && t.clientX > innerWidth - 28) || (view === 'thread' && t.clientX > api.env.edgeInset)) swipe = { x: t.clientX, y: t.clientY, at: performance.now(), view };
    }, { passive: true }));
    offs.push(api.listen(root, 'pointerdown', e => { if (e.pointerType === 'touch' && api.route().view === 'list' && last && e.clientX > innerWidth - 28) api.gesture.claim(e.pointerId); }, { passive: true }));
    offs.push(api.listen(root, 'touchend', e => { const s = swipe; swipe = null; const t = e.changedTouches[0]; if (!s || !t) return;
      const dx = t.clientX - s.x, dy = Math.abs(t.clientY - s.y); if (dx >= 0 || !api.gesture.intent(dx, dy, performance.now() - s.at)) return;
      if (s.view === 'list' && last) api.nav.openThread(last); else { const d = api.route().desk; if (d + 1 < api.nav.deskCount()) api.nav.goDesk(d + 1); }
    }, { passive: true }));
    offs.push(api.listen(root, 'touchcancel', () => { swipe = null; }, { passive: true }));
  }; sync(); api.on('render', sync); api.on('route', sync); return () => { swipe = null; unbind(); };
}
