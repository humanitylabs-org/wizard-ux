// Test-only skin package: the smallest real use of the skin API (a swipe-right-to-go-back gesture).
// tests/skin-packages.test.mjs drives it with synthetic pointer events.
export default function setup(api) {
  const seen = { routes: [], renders: 0 };
  globalThis.__fixtureSkin = seen;
  const root = api.part('thread');
  let start = null;
  if (root) {
    api.listen(root, 'pointerdown', e => {
      if (e.clientX < api.env.edgeInset) return;      // leave the OS edge to the OS
      start = { x: e.clientX, id: e.pointerId };
      api.gesture.claim(e.pointerId);
    });
    api.listen(root, 'pointerup', e => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x; start = null;
      if (dx > 80 && api.route().view === 'thread') api.nav.back();
    });
  }
  api.on('route', r => seen.routes.push(r.view));
  api.on('render', () => { seen.renders++; });
  api.frame(() => { seen.framed = true; });
  return () => { seen.tornDown = true; };
}
