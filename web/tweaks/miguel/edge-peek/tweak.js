/* Edge peek: when a view is bound beside a chat thread, the edge where it leans in is a handle. Tap it, or swipe it
 * toward the middle (the shell's one swipe threshold), to move across; on that view the thread's edge on the left
 * takes you back. The next dock dot and the handle glow a few times when it appears (tweak.css; off for reduced
 * motion). The handle never prevents a default, so the OS's own edge gestures (iOS back swipe) win as before:
 * their pointercancel is ignored. */
export default function setup(api) {
  if (api.env.shell === 'desktop') return () => {};
  const el = document.createElement('button');
  el.type = 'button'; el.className = 'bound-grab'; el.hidden = true;
  let side = 0, g = null;
  const go = () => { const s = side; if (s) api.nav.goDesk(api.route().desk + s); };
  api.listen(el, 'pointerdown', e => {
    g = { x: e.clientX, y: e.clientY, at: performance.now(), id: e.pointerId, moved: false };
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
  });
  api.listen(el, 'pointermove', e => { if (g && e.pointerId === g.id && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 10) g.moved = true; });
  const end = e => {
    if (!g || e.pointerId !== g.id) return; const s = g; g = null;
    if (e.type === 'pointercancel') return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    const inward = side > 0 ? dx < 0 : dx > 0;
    if (!s.moved || (inward && api.gesture.intent(dx, dy, performance.now() - s.at))) go();
  };
  api.listen(el, 'pointerup', end); api.listen(el, 'pointercancel', end);
  api.listen(el, 'click', e => { if (e.detail === 0) go(); }); // keyboard / switch access
  api.listen(el, 'animationend', () => el.classList.remove('glow'));
  const paint = next => {
    if (next === side) return;
    side = next; g = null;
    el.hidden = !side;
    el.classList.toggle('right', side > 0); el.classList.toggle('left', side < 0);
    el.setAttribute('aria-label', side > 0 ? 'Show the view beside this thread' : 'Back to the thread');
    el.classList.remove('glow');
    if (side) { void el.offsetWidth; el.classList.add('glow'); }
  };
  if (!api.slot.mount('device-edge', el)) return () => {}; // the phone screen; no slot on other shells
  paint(api.route().beside | 0);
  api.on('beside', b => paint(b.side | 0));
  return () => { g = null; };
}
