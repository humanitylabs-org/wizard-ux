// Landscapes (Miguel's skin): swipe right inside a thread to go back, same as Dark and Light (copy of web/skins/obsidian/skin.js).
// Ported from wizard-ux #121 into the skin package, so it ships with Obsidian and touches no other skin.
// Back goes through the shell's own Back step (api.nav.back): linked thread -> parent, thread -> list; never exits.
import { playIntro, noteSkin, toHome } from '../obsidian/intro.js';

import { engages, commits } from '../obsidian/swipe-intent.js';
import { setupBehaviour } from '../obsidian/behaviour.js';

export default function setup(api) {
  const behaviour = setupBehaviour(api);
  // Skin-switch transition (web/skins/obsidian/intro.js): plays when this skin is picked, not when the app simply reopens on it.
  // 'live' is set while this skin is the chosen one and cleared only when the owner switches away.
  let intro = null;
  if (!api.storage.get('live')) {
    api.storage.set('live', true);
    intro = playIntro({ listen: api.listen });
    toHome(api);
  } else noteSkin();
  let sw = null;
  const thread = () => { const r = api.part('thread'); return r && r.querySelector('[data-part="thread"]'); };
  const skip = t => !t || !t.closest || t.closest('pre, table, [data-part="composer"], .ms-track, input, textarea, [contenteditable="true"]');
  const reset = th => { if (!th) return; th.style.transition = 'transform .18s ease-out, opacity .18s ease-out'; th.style.transform = ''; th.style.opacity = ''; };

  const bind = root => {
    api.listen(root, 'touchstart', e => {
      sw = null;
      if (api.route().view !== 'thread' || e.touches.length !== 1) return;
      const t0 = e.touches[0];
      if (t0.clientX < api.env.edgeInset || skip(e.target) || String(window.getSelection ? window.getSelection() : '')) return;
      const th = thread(); if (!th) return;
      sw = { x: t0.clientX, y: t0.clientY, t: performance.now(), th, on: false, dx: 0 };
    }, { passive: true });
    api.listen(root, 'touchmove', e => {
      if (!sw) return;
      const t = e.touches[0], dx = t.clientX - sw.x, dy = Math.abs(t.clientY - sw.y);
      if (!sw.on) {
        if (dy > 36 && dy > dx) { sw = null; return; }
        if (engages(dx, dy)) { sw.on = true; sw.th.style.transition = 'none'; }
        else return;
      }
      sw.dx = dx;
      const s = sw;
      api.frame(() => { if (!s.on) return; s.th.style.transform = `translateX(${Math.max(0, Math.min(s.dx, 140)) * .5}px)`; s.th.style.opacity = String(1 - Math.max(0, Math.min(s.dx, 160)) / 500); });
    }, { passive: true });
    const end = e => {
      if (!sw) return; const s = sw; sw = null; s.on && reset(s.th); s.on = s.on && e.type !== 'touchcancel';
      const t1 = e.changedTouches && e.changedTouches[0]; if (!t1 || !s.on) return;
      const dx = t1.clientX - s.x, dy = Math.abs(t1.clientY - s.y);
      if (commits(dx, dy, performance.now() - s.t)) api.nav.back();
    };
    api.listen(root, 'touchend', end, { passive: true });
    api.listen(root, 'touchcancel', end, { passive: true });
  };

  // The chats container is stable across repaints; bind once per container (desks can hold several chats windows).
  const bound = new WeakSet();
  const ensure = () => { const r = api.part('thread') || api.part('list'); if (r && !bound.has(r)) { bound.add(r); bind(r); } };
  ensure();
  api.on('render', ensure);
  api.on('route', ensure);
  return reason => { behaviour(); if (sw) reset(sw.th); sw = null; intro?.stop(); if (reason === 'switch') api.storage.set('live', false); };
}
