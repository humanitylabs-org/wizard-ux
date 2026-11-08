/* Orbs view on the phone (Miguel, 31 Oct 2026; simplified 1 Nov 2026). Worn by the same miguel/orb-shell tweak as the
 * desktop (layout.js hands the phone shell here), so the Desks | Orb | Apps switch flips it per device, no reload.
 *
 *   Only Home changes, and it stays simple (Miguel found the three-slot bottom bar, the orb jumping between the
 *   centre and the bar, the spin and the bolts impossible to use, 1 Nov 2026):
 *     - the desktop's night sky (shared.js paintSky) and orb in the same Style × Colour kept per device (styles.js
 *       renderer, shared.js lookOf), FIXED in the middle of Home. It never flies anywhere; it only slides with the
 *       Home desk like everything on it. Tap talks, hold commands, as the dock orb's (a press on it is handed to the
 *       dock orb as it starts, same pointer, so the stock tap and hold run unchanged).
 *     - the same status satellites as the desktop (shared.js orbitApps: the apps on your desks and apps with
 *       something new) as plain buttons standing still on one ring around the orb: tap = open that app (its desk).
 *       Big targets (48 px), never on the orb, nothing moving under the finger.
 *     - one large Chats pill under the orb, in thumb reach where the dock sits, with the Ready count: tap = the
 *       stock Chats list.
 *     - no bottom bar on Home (the stock dock steps aside there; the orb in the middle is the orb). Home's own top
 *       stays: the which-Wizard menu, the Desks | Orb | Apps switch, the AI fuel gauge and the gear.
 *   Everywhere (1 Nov 2026, round 4): the stock desk switcher is gone on every screen (layouts/apps/chrome.css): only the
 *   dock orb is left, floating at the bottom centre exactly where it sits, with its stock gestures and the same Style ×
 *   Colour; on Home the big centre orb is the orb, so the dock orb shows (a plain fade) once something is open. A swipe
 *   up on the orb goes Home (the ring), like the iPhone's home swipe; sideways and down do nothing here (chrome.js
 *   ORB_SWIPES, round 6: no Back button, no desk steps, no distraction-free from the orb). A small + beside the Chats
 *   pill opens the sheet of every app not open yet (the Apps view's own, chrome.js); a pick opens it on a desk of its
 *   own and it joins the ring. Everything else (Chats, threads, apps, desks, sheets) is the stock phone. Desks (the
 *   tweak off) brings the stock Home and dock back exactly.
 *
 * Motion: one loop, only while the page is visible; the sky and orb drawn about 30 times a second on Home only;
 * reduced motion = still frames. Colours are the tweak's skin-layer tokens (--ob-*). Everything through the layout API. */
import { renderer } from './styles.js';
import { lookOf, palettes, starsFor, paintSky, orbitApps, glyphOf, colourOf } from './shared.js';
import { viewChrome } from '../apps/chrome.js';

export default function phone(api) {
  const doc = document, root = doc.documentElement;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = (tag, cls, attrs = {}) => { const n = doc.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } return n; };
  const SAT = 48, GAP = SAT + 18;   // GAP: centre to centre on the ring, room for each name under its mark   // a satellite's tap target (px), the phone's comfortable minimum and then some

  /* ---------- nodes: the sky inside the Home desk (it slides with Home); the orb, its satellites and the Chats pill in
   * one layer over the desks and under every sheet; a small canvas inside the dock orb ---------- */
  const css = el('link', '', { rel: 'stylesheet', href: api.asset('phone.css') || '' });
  const sky = el('canvas', 'obp-sky', { 'aria-hidden': 'true' });
  const layer = el('div', 'obp-layer', { 'aria-hidden': 'false' });
  const field = el('div', 'obp-field', { role: 'group', 'aria-label': 'Your apps' });
  const orbBox = el('div', 'obp-orb');
  const orbCv = el('canvas', 'obp-orbc', { 'aria-hidden': 'true' });
  const orbBtn = el('button', 'obp-orbbtn', { type: 'button', 'aria-label': 'Wizard orb. Tap to talk, hold for a command.' });
  orbBox.append(orbCv, orbBtn);
  const chats = el('button', 'obp-chats', { type: 'button', 'aria-label': 'Chats' });
  const chatsWord = el('span', 'obp-chats-word', { text: 'Chats' }), chatsN = el('span', 'obp-chats-n');
  chats.append(chatsWord, chatsN);
  // the small + beside the pill: the sheet of every app not open yet (chrome.js, the same as the Apps view's)
  const desks = () => (api.desks?.list || api.phone.desks)?.() || [];
  const chrome = viewChrome(api, { openIds: () => desks().map(d => d.id) });
  // One + (Miguel, 2 Nov 2026): the ring's last place, after the last app clockwise from the top; it opens the app sheet.
  const plus = chrome.plus('ob-sat obp-sat obp-add', 'Add an app', (b, ico) => { b.setAttribute('data-app', '+add'); const f = el('span', 'ob-sat-face'); f.append(ico); b.append(f, el('b', 'obp-sat-n', { 'aria-hidden': 'true', text: 'Add' })); });
  const plusMore = el('b', 'obp-add-n', { 'aria-hidden': 'true' }); plusMore.hidden = true; plus.append(plusMore);
  layer.append(field, orbBox, chats);
  const dockCv = el('canvas', 'obp-dockc', { 'aria-hidden': 'true' });
  layer.hidden = true; sky.hidden = true;
  api.mount(css); api.mount(layer);
  api.listen(css, 'load', () => { layer.hidden = false; sky.hidden = false; W = 0; paint(); });
  // the stock orb drawing (and, on Home, the stock dock) step aside only while the phone wears the scene (phone.css)
  root.dataset.orbPhone = 'on';

  /* ---------- the look: the desktop's stored Style × Colour, its colours and drawing code ---------- */
  const palette = palettes(doc);
  const look = lookOf(api);
  const mk = n => { const c = el('canvas'); c.width = c.height = n; return c; };
  const drawBig = renderer(look.styleId, mk), drawSmall = renderer(look.styleId, mk);
  const sx = sky.getContext('2d'), ox = orbCv.getContext('2d'), dx = dockCv.getContext('2d');

  /* ---------- voice: the same take and level the dock orb shows (a take started here is drawn right here) ---------- */
  const modeOf = v => !v || v.state === 'idle' ? 'idle' : v.state === 'think' || v.state === 'done' ? 'thinking' : v.state === 'paused' ? 'paused' : 'listening';
  let voice = api.voice.state(), level = 0, lvlTarget = 0, flash = 0, lastMode = 'idle';
  api.orb.onLevel(v => { lvlTarget = Math.max(0, Math.min(1, +v || 0)); });
  api.on('voice', v => {
    voice = v; const m = modeOf(v);
    if (m === 'idle') lvlTarget = 0;
    if (lastMode !== 'idle' && m === 'idle') flash = .6;   // a take handed off: one soft ring
    lastMode = m; paint(); wake(); if (reduced) still();
  });
  const frameOf = (t, cmd) => ({ t, lv: level, state: modeOf(voice), fl: flash, blink: false, cmd, P: palette(look.colourId) });

  /* ---------- size: the orb in the middle of the room between Home's top and the Chats pill; one ring around it ---------- */
  let W = 0, H = 0, DPR = 1, O = 0, cy = 0, R = 0, R0 = 0, Rmax = 0, stars = [];
  function size() {
    const w = layer.clientWidth, h = layer.clientHeight; if (!w || !h) return false;
    if (w === W && h === H) return true;
    W = w; H = h; DPR = Math.min(2, globalThis.devicePixelRatio || 1);
    // the free room: under Home's top (the switch and the fuel gauge) and above the Chats pill
    const top = Math.min(150, H * .17), pillTop = chats.offsetTop || H - 110, room = Math.max(160, pillTop - top);
    // the sphere is ~60% of its canvas; the ring sits a thumb's width outside it and inside the screen's edges
    O = Math.round(Math.max(150, Math.min(W * .6, room * .6, 260)));
    // every open app floats (one satellite per desk): the ring widens to fit them, up to the screen's edges
    Rmax = Math.round(Math.min(W / 2 - SAT / 2 - 8, room / 2 - SAT / 2 - 4));
    R0 = Math.round(Math.min(O * .3 + SAT / 2 + 22, Rmax)); R = ringFor(sats.length);
    cy = Math.round(top + room / 2);
    layer.style.setProperty('--obp-orb', O + 'px'); layer.style.setProperty('--obp-cy', cy + 'px');
    orbCv.width = orbCv.height = Math.round(O * DPR);
    stars = starsFor(W, H);
    sizeSky(); paintApps(); placeSats();   // the ring holds as many as this size allows
    return true;
  }
  function sizeSky() {
    const w = sky.clientWidth, h = sky.clientHeight; if (!w || !h) return;
    const pw = Math.round(w * DPR), ph = Math.round(h * DPR);
    if (sky.width !== pw || sky.height !== ph) { sky.width = pw; sky.height = ph; sx.setTransform(DPR, 0, 0, DPR, 0, 0); }
  }

  /* ---------- satellites: the shared list (shared.js orbitApps), each app's own mark, still, on one ring ---------- */
  let badgeMap = api.apps.badges(m => { badgeMap = m; paintApps(); paintChats(); });
  let appSig = '', sats = [];
  // a long single word may break in its middle (a soft hyphen), so it stays inside its slot on the ring
  const softName = n => String(n || '').replace(/[A-Za-z]{12,}/g, w => w.slice(0, Math.ceil(w.length / 2)) + '\u00ad' + w.slice(Math.ceil(w.length / 2)));
  function sat(a) {
    const b = el('button', 'ob-sat obp-sat', { type: 'button', 'aria-label': 'Open ' + a.name, 'data-app': a.id });
    b.style.setProperty('--c', colourOf(a));
    const face = el('span', 'ob-sat-face');
    face.append(el('i', `sgi sg-${glyphOf(a)}`, { 'aria-hidden': 'true' }));
    const count = el('b', 'ob-sat-badge', { 'aria-hidden': 'true' }); count.hidden = true;
    // its name always under it (Miguel, 2 Nov 2026), small; a long one ends in …
    b.append(face, count, el('i', 'ob-sat-run', { 'aria-hidden': 'true' }), el('b', 'obp-sat-n', { 'aria-hidden': 'true', text: softName(a.name) }));
    api.listen(b, 'click', () => api.apps.open(a.id));
    // press and hold: Open · Close (stays installed), the same menu as the Apps view (Miguel, 2 Nov 2026)
    chrome.menuOn(b, a, { onOpen: () => api.apps.open(a.id), onClosed: () => api.after(60, paintApps) });
    api.apps.logo(a.id).then(url => {
      if (!url) return;
      const im = el('img', 'ob-logo', { alt: '', src: url, draggable: 'false' });
      im.decode().then(() => { face.replaceChildren(im); b.classList.add('is-logo'); }, () => {});
    });
    return { b, count, name: a.name };
  }
  function paintApps() {
    // the + always takes the last place; more open apps than fit: the + says how many more (its sheet lists them all)
    const every = orbitApps(api, badgeMap), cap = W ? ringCap() : every.length + 1, over = Math.max(0, every.length - (cap - 1));
    const apps = [...every.slice(0, cap - 1), { id: '+add', name: 'Add an app', icon: '' }];
    plusMore.textContent = over ? '+' + over : ''; plusMore.hidden = !over; plus.classList.toggle('has-more', !!over);
    plus.setAttribute('aria-label', over ? `Add an app · ${over} more open` : 'Add an app');
    const sig = apps.map(a => a.id + ':' + a.name + ':' + (a.icon || '').length).join('|') + '|' + (W ? ringCap() : 0);
    if (sig !== appSig) {
      appSig = sig;
      const was = new Map(sats.map(s => [s.id, s])), from = was.get('+add')?.a, first = !sats.length;
      // evenly round the ring from the top, clockwise, the + last; fixed places (a satellite never moves under the
      // finger). When the list changes everyone glides to the new place (phone.css), and a newly opened app grows out
      // of the +'s old place: it was added to the end of the circle.
      const born = [];
      sats = apps.map((a, i) => { const s = was.get(a.id) || { id: a.id, ...(a.id === '+add' ? { b: plus, count: el('b'), name: a.name } : sat(a)) }; const ta = -Math.PI / 2 + i / apps.length * Math.PI * 2;
        if (!was.has(a.id) && !first && from != null && !reduced) { s.a = from; born.push([s, ta]); s.b.classList.add('is-born'); } else s.a = ta; return s; });
      // only what changed: re-inserting a kept node would replay its fade-in
      const keep = new Set(sats.map(s => s.b));
      for (const n of [...field.children]) if (!keep.has(n)) n.remove();
      for (const s of sats) if (s.b.parentNode !== field) field.append(s.b);
      placeSats();
      if (born.length) api.frame(() => api.frame(() => { for (const [s, ta] of born) s.a = ta; placeSats(); api.after(700, () => { for (const [s] of born) s.b.classList.remove('is-born'); }); }));
    }
    for (const s of sats) {
      if (s.id === '+add') continue;
      const a = apps.find(x => x.id === s.id), n = badgeMap[s.id] || 0;
      s.count.textContent = n ? (api.apps.badgeText?.(s.id) || (n > 99 ? '99+' : n ? String(n) : '')) : ''; s.count.hidden = !n;
      s.b.dataset.run = a?.run ? (a.run.open ? 'open' : 'hidden') : ''; s.b.classList.toggle('is-new', !a?.run);
      s.b.setAttribute('aria-label', 'Open ' + s.name + (n ? ` · ${n} new` : '') + (a?.run ? ' · on a desk' : ''));
    }
  }
  // the ring's radius for n satellites: the resting one, wider when n needs it (a whole target + 6 px apart), at most Rmax
  const ringFor = n => Math.round(Math.max(R0, Math.min(Rmax, n * GAP / (2 * Math.PI))));
  // how many fit on the widest ring; more than that: the last place is +N (the sheet, whose Open lists every one)
  const ringCap = () => Math.max(1, Math.floor(2 * Math.PI * Rmax / GAP));
  function placeSats() {
    if (!W) return;
    R = ringFor(sats.length);
    for (const s of sats) {
      const x = W / 2 + homeX + Math.cos(s.a) * R, y = cy + Math.sin(s.a) * R;   // they ride with the Home desk
      s.b.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    orbBox.style.transform = homeX ? `translateX(${homeX}px)` : '';
    chats.style.transform = homeX ? `translateX(${homeX}px)` : '';
    const pw = chats.offsetWidth; if (pw > 0) layer.style.setProperty('--obp-pill-w', pw + 'px');
  }

  /* ---------- the Chats pill: the stock Chats list, with the Ready count ---------- */
  function paintChats() {
    const n = badgeMap.wizard || 0;
    chatsN.textContent = n ? `${n > 99 ? '99+' : n} ready` : '';
    chatsN.hidden = !n; chats.classList.toggle('has-ready', !!n);
    chats.setAttribute('aria-label', n ? `Chats, ${n} ready` : 'Chats');
  }
  api.listen(chats, 'click', () => api.sessions.openList('ready'));

  /* ---------- the press: the centre orb hands its pointer to the dock orb, whose stock gestures run unchanged ---------- */
  api.listen(orbBtn, 'pointerdown', e => {
    const host = api.phone.orb(); if (!host || e.isPrimary === false) return;
    e.preventDefault();
    orbBox.classList.add('is-pressed');
    const init = { bubbles: true, cancelable: true, composed: true, pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: true, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, button: e.button, buttons: e.buttons, width: e.width, height: e.height, pressure: e.pressure };
    host.dispatchEvent(new PointerEvent('pointerdown', init));
  });
  const unpress = () => orbBox.classList.remove('is-pressed');
  api.listen(globalThis, 'pointerup', unpress, true); api.listen(globalThis, 'pointercancel', unpress, true);
  api.listen(orbBtn, 'contextmenu', e => e.preventDefault());
  api.listen(orbBtn, 'keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); api.voice.tap(); } });

  /* ---------- motion: one loop while the page is visible; the follow (everything rides with the Home desk while it is
   * dragged) every frame, the drawing about 30 times a second ---------- */
  let running = false, lastT = 0, cancel = null, homeX = 0, home = false;
  function follow() {
    const sec = api.phone.home(); if (!sec) return;
    const x = Math.round(sec.getBoundingClientRect().left - layer.getBoundingClientRect().left);
    if (x !== homeX) { homeX = x; placeSats(); }
  }
  function draw(now) {
    const t = now / 1000, dt = lastT ? Math.min(.1, (now - lastT) / 1000) : 0; lastT = now;
    if (!size()) return;
    level += (lvlTarget - level) * .25;
    if (flash > 0) flash = Math.max(0, flash - dt * 1.5);
    const cmd = voice?.kind === 'command' || voice?.state === 'command' ? 1 : 0;
    if (home) {
      sizeSky(); paintSky(sx, { W: sky.clientWidth, H: sky.clientHeight, gx: sky.clientWidth / 2, cy, t, lv: level, P: palette(look.colourId), stars });
      drawBig(ox, orbCv.width, frameOf(t, cmd));
    } else if (dockCv.isConnected) {
      const n = Math.round((dockCv.clientWidth || 100) * DPR); if (n && dockCv.width !== n) dockCv.width = dockCv.height = n;
      drawSmall(dx, dockCv.width, frameOf(t, cmd));
    }
    if (++runN > 45) { runN = 0; paintApps(); }
  }
  let runN = 0;
  function loop(now) {
    cancel = null; if (!running) return;
    follow();
    if (now - lastT >= 30) draw(now);
    cancel = api.frame(loop);
  }
  function still() { api.frame(now => { lastT = 0; follow(); draw(now); }); }
  function wake() {
    const awake = !doc.hidden;
    if (awake && !reduced && !running) { running = true; lastT = 0; cancel = api.frame(loop); }
    else if ((!awake || reduced) && running) { running = false; cancel?.(); cancel = null; }
    if (reduced && awake) still();
  }
  api.listen(doc, 'visibilitychange', wake);
  api.listen(globalThis, 'resize', () => { W = 0; size(); if (reduced) still(); });

  /* ---------- Home or not: the scene on Home only (the orb stays in the middle there, a take included) ---------- */
  function attach() {
    const sec = api.phone.home(); if (sec && sky.parentNode !== sec) sec.prepend(sky);   // a rebuilt desk strip: back in
    const host = api.phone.orb(); if (host && dockCv.parentNode !== host) host.append(dockCv);
  }
  function paint() {
    attach();
    const h = !!api.route().home;
    if (h !== home) {
      home = h; root.dataset.orbScene = h ? 'home' : 'desk'; root.dataset.orbAt = h ? 'centre' : 'dock';
      layer.classList.toggle('is-home', h); sky.classList.toggle('is-home', h); layer.inert = !h;
      orbBox.dataset.show = h ? 'on' : ''; dockCv.dataset.show = h ? '' : 'on';
      if (h) { paintApps(); paintChats(); api.frame(() => { W = 0; size(); sizeSky(); }); }
    }
    size();
  }
  api.on('route', paint);
  api.on('home', paint);
  paintChats(); paint(); wake();

  return () => {
    running = false; cancel?.();
    sky.remove(); dockCv.remove(); chrome.dispose();
    delete root.dataset.orbPhone; delete root.dataset.orbScene; delete root.dataset.orbAt;
  };
}
