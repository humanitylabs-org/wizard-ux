/* Orbs view on the phone (Miguel, 31 Oct 2026; experimental). Worn by the same miguel/orb-shell tweak as the desktop
 * (layout.js hands the phone shell here), so the Desks | Orbs switch flips it per device, no reload.
 *
 *   Only Home changes. On Home the phone shows the desktop's orb scene: the same night sky (shared.js paintSky), the
 *   same orb in the same Style × Colour kept per device (styles.js renderer, shared.js lookOf: the desktop's own drawing
 *   code and stored choice), centred as the hero, with the same status satellites orbiting it (shared.js orbitApps: the
 *   one list the desktop floats; the phone adapter says what is running = the apps on its desks). Home's own top stays:
 *   the which-Wizard menu, the Desks | Orbs switch, the AI fuel gauge and the gear (Settings).
 *
 *   Continuity: the orb IS the dock orb. On Home it grows up out of the dock into the centre; when anything opens
 *   (Chats, a thread, an app, another desk) or a voice take starts, it shrinks back into the dock (about 250 ms, eased,
 *   no bounce) and the dock orb wears the same Style × Colour. The dock orb's gestures are the stock ones, unchanged:
 *   a press on the centre orb is handed to the dock orb as it starts (same pointer), so tap talks, hold commands and
 *   the swipes (up, down, sideways) do exactly what they do on the dock.
 *
 *   Everything else (Chats, threads, apps, desks, sheets, swipes) is the phone as it is. Desks (the tweak off) brings
 *   the stock Home back exactly: every node here is removed and the stock orb shows again.
 *
 * Motion: one loop, only while the page is visible; the sky and satellites only on Home; about 30 fps; reduced motion
 * = still frames and no flight. Colours are the tweak's skin-layer tokens (--ob-*). Everything through the layout API. */
import { renderer } from './styles.js';
import { lookOf, palettes, starsFor, paintSky, orbitApps, glyphOf, colourOf, hash, boltPainter } from './shared.js';

export default function phone(api) {
  const doc = document, root = doc.documentElement;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = (tag, cls, attrs = {}) => { const n = doc.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } return n; };
  const FLY = 250;

  /* ---------- nodes: the sky inside the Home desk (it slides with Home); the orb and its satellites in one layer over
   * the desks and under the dock and sheets; a small canvas inside the dock orb ---------- */
  const css = el('link', '', { rel: 'stylesheet', href: api.asset('phone.css') || '' });
  const sky = el('canvas', 'obp-sky', { 'aria-hidden': 'true' });
  const layer = el('div', 'obp-layer', { 'aria-hidden': 'false' });
  const field = el('div', 'obp-field', { role: 'group', 'aria-label': 'Open and new apps' });
  const orbBox = el('div', 'obp-orb');
  const orbCv = el('canvas', 'obp-orbc', { 'aria-hidden': 'true' });
  const orbBtn = el('button', 'obp-orbbtn', { type: 'button', 'aria-label': 'Wizard orb. Tap to talk, hold for a command, swipe up for apps, down to hide the bars, sideways for desks.' });
  // the sky under the orbit takes a sideways drag (spins the satellites); the bolt canvas sits over everything open
  const spin = el('div', 'obp-spin', { 'aria-hidden': 'true' });
  const boltCv = el('canvas', 'obp-bolt', { 'aria-hidden': 'true' });
  orbBox.append(orbCv, orbBtn); layer.append(spin, field, orbBox, boltCv);
  const dockCv = el('canvas', 'obp-dockc', { 'aria-hidden': 'true' });
  /* the bottom bar: one slot each side of the dock orb, in the dock's own marks (left: the app used last, other than
   * the one in front; right: Chats with its Ready count). The stock desk switcher steps aside (phone.css). */
  const slot = side => { const box = el('div', `desk-dots ${side} sym obp-slots`, { 'data-obp-slot': side }); const b = el('button', 'ddot sig filled d1 obp-slotbtn', { type: 'button' }); box.append(b); return [box, b]; };
  const [barL, btnL] = slot('left'), [barR, btnR] = slot('right');
  btnR.classList.add('obp-chats');
  layer.hidden = true; sky.hidden = true; barL.hidden = barR.hidden = true;
  api.mount(css); api.mount(layer);
  let cssReady = false;
  api.listen(css, 'load', () => { cssReady = true; layer.hidden = false; sky.hidden = false; barL.hidden = barR.hidden = false; paint(); });
  // the stock orb steps aside only while the phone wears the scene (phone.css: html[data-orb-phone])
  root.dataset.orbPhone = 'on';

  /* ---------- the look: the desktop's stored Style × Colour, its colours and drawing code ---------- */
  const palette = palettes(doc);
  const look = lookOf(api);
  const mk = n => { const c = el('canvas'); c.width = c.height = n; return c; };
  const drawBig = renderer(look.styleId, mk), drawSmall = renderer(look.styleId, mk);
  const sx = sky.getContext('2d'), ox = orbCv.getContext('2d'), dx = dockCv.getContext('2d'), bx = boltCv.getContext('2d');
  const { bolt } = boltPainter(bx, reduced);   // the desktop's own bolt drawing (shared.js)

  /* ---------- voice: the same take and level the dock orb shows ---------- */
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

  /* ---------- size: the orb centred as the hero, the sky the Home desk's size ---------- */
  let W = 0, H = 0, DPR = 1, O = 0, cy = 0, stars = [];
  function size() {
    const w = layer.clientWidth, h = layer.clientHeight; if (!w || !h) return false;
    if (w === W && h === H) return true;
    W = w; H = h; DPR = Math.min(2, globalThis.devicePixelRatio || 1);
    O = Math.round(Math.min(W * .74, H * .38, 320)); cy = Math.round(H * .5);
    layer.style.setProperty('--obp-orb', O + 'px'); layer.style.setProperty('--obp-cy', cy + 'px');
    orbCv.width = orbCv.height = Math.round(O * DPR);
    boltCv.width = Math.round(W * DPR); boltCv.height = Math.round(H * DPR); bx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // the drag band: the orbit's height and a margin, never the screen edges (the system's back swipe lives there)
    const band = Math.round(orbitRx() * .5 * 1.32 + 40), edge = Math.max(20, +api.env.edgeInset || 0);
    Object.assign(spin.style, { top: (cy - band) + 'px', height: band * 2 + 'px', left: edge + 'px', right: edge + 'px' });
    stars = starsFor(W, H);
    sizeSky(); placeSats(0);
    return true;
  }
  function sizeSky() {
    const w = sky.clientWidth, h = sky.clientHeight; if (!w || !h) return;
    const pw = Math.round(w * DPR), ph = Math.round(h * DPR);
    if (sky.width !== pw || sky.height !== ph) { sky.width = pw; sky.height = ph; sx.setTransform(DPR, 0, 0, DPR, 0, 0); }
  }

  /* ---------- satellites: the shared list (shared.js orbitApps), each app's own mark on two tilted orbits ---------- */
  let badgeMap = api.apps.badges(m => { badgeMap = m; paintApps(); paintBar(); });
  let appSig = '', sats = [];
  function sat(a) {
    const b = el('button', 'ob-sat obp-sat', { type: 'button', 'aria-label': 'Open ' + a.name, 'data-app': a.id });
    b.style.setProperty('--c', colourOf(a));
    const face = el('span', 'ob-sat-face');
    face.append(el('i', `sgi sg-${glyphOf(a)}`, { 'aria-hidden': 'true' }));
    const count = el('b', 'ob-sat-badge', { 'aria-hidden': 'true' }); count.hidden = true;
    b.append(face, count, el('i', 'ob-sat-run', { 'aria-hidden': 'true' }));
    api.listen(b, 'click', () => api.apps.open(a.id));
    api.apps.logo(a.id).then(url => {
      if (!url) return;
      const im = el('img', 'ob-logo', { alt: '', src: url, draggable: 'false' });
      im.decode().then(() => { face.replaceChildren(im); b.classList.add('is-logo'); }, () => {});
    });
    return { b, count, name: a.name };
  }
  function paintApps() {
    const apps = orbitApps(api, badgeMap).slice(0, 10);
    const sig = apps.map(a => a.id + ':' + a.name + ':' + a.icon.length).join('|');
    if (sig !== appSig) {
      appSig = sig;
      const was = new Map(sats.map(s => [s.id, s]));
      sats = apps.map((a, i) => { const old = was.get(a.id); const s = old || { id: a.id, ...sat(a) }; s.a = i / apps.length * Math.PI * 2 + .4; s.ring = i % 2 ? 1 : 1.32; return s; });   // s.a: its place; phase turns them all
      field.replaceChildren(...sats.map(s => s.b));
      placeSats(0);
    }
    for (const s of sats) {
      const a = apps.find(x => x.id === s.id), n = badgeMap[s.id] || 0;
      s.count.textContent = n > 99 ? '99+' : n ? String(n) : ''; s.count.hidden = !n;
      s.b.dataset.run = a?.run ? (a.run.open ? 'open' : 'hidden') : ''; s.b.classList.toggle('is-new', !a?.run);
      s.b.setAttribute('aria-label', 'Open ' + s.name + (n ? ` · ${n} new` : '') + (a?.run ? ' · open on a desk' : ''));
    }
  }
  // the desktop's two tilted rings, opened up for a tall screen: as wide as the phone allows, a little deeper
  const orbitRx = () => Math.min(W / 2 - 28, O * .9);
  let phase = 0, spinV = 0;   // the orbit's turn (radians) and a flick's leftover speed (radians a second)
  function placeSats(dt) {
    if (!W) return;
    if (dt && !reduced) { phase += (.035 + spinV) * dt; spinV *= Math.exp(-dt * 2.4); if (Math.abs(spinV) < .01) spinV = 0; }
    const out = orbitRx();
    for (const s of sats) {
      const a = s.a + phase, rx = out * s.ring / 1.32, ry = rx * .5;
      const x = W / 2 + homeX + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;   // they ride with the Home desk
      const depth = Math.sin(a), sc = .8 + .2 * (depth + 1) / 2, op = .55 + .45 * (depth + 1) / 2;
      s.b.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${sc.toFixed(3)})`;
      s.b.style.zIndex = depth > 0 ? 7 : 4; s.b.style.opacity = op.toFixed(3);   // in front of the orb (5) or behind it
    }
  }

  /* ---------- spin: a sideways drag on the Home sky (or on a satellite) turns the orbit, like a ring under the finger
   * (the near side follows the finger, so it turns the way you push it); let go mid-flick and it coasts to a calm stop.
   * Vertical moves stay the page's (touch-action: pan-y), the orb keeps its own gestures (it sits above), a tap on a
   * satellite still opens it, and a satellite let go after a spin does not open. Reduced motion: no coasting. ---------- */
  let drag = null, spunAt = 0;
  function spinDown(e) {
    if (!home || e.isPrimary === false || (e.pointerType === 'mouse' && e.button)) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, lt: e.timeStamp || performance.now(), v: 0, on: false, el: e.currentTarget };
    spinV = 0;
  }
  function spinMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }   // a vertical move: the page's
      if (Math.abs(dx) < 8) return;
      drag.on = true; api.gesture.claim(e.pointerId); try { drag.el.setPointerCapture(e.pointerId); } catch (_) {}
    }
    const L = layer.getBoundingClientRect(), near = e.clientY - L.top > cy ? -1 : 1;
    const da = near * (e.clientX - drag.lx) / Math.max(60, orbitRx()), now = e.timeStamp || performance.now();
    phase += da; drag.v = drag.v * .4 + da / (Math.max(8, now - drag.lt) / 1000) * .6; drag.lx = e.clientX; drag.lt = now;
    placeSats(0);
  }
  function spinUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.on) { spunAt = performance.now(); const idle = (e.timeStamp || performance.now()) - drag.lt; if (!reduced && e.type === 'pointerup' && idle < 90) spinV = Math.max(-5, Math.min(5, drag.v)); }
    drag = null;
  }
  for (const n of [spin, field]) {
    api.listen(n, 'pointerdown', spinDown); api.listen(n, 'pointermove', spinMove);
    api.listen(n, 'pointerup', spinUp); api.listen(n, 'pointercancel', spinUp);
  }
  api.listen(field, 'click', e => { if (performance.now() - spunAt < 350) { e.preventDefault(); e.stopPropagation(); } }, true);

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

  /* ---------- where the orb is: the centre of Home, or the dock ---------- */
  let home = false, at = '', flyOff = null;
  // up in the middle while Home is (mostly) in view and no take runs; a desk sliding in or a take: in the dock
  const want = () => home && modeOf(voice) === 'idle' && Math.abs(homeX) < W * .5 ? 'centre' : 'dock';
  function dockMatrix() {
    const host = api.phone.orb(), r = host?.getBoundingClientRect(), L = layer.getBoundingClientRect();
    if (!r || !r.width || !O) return null;
    const side = r.width * 1.76, k = side / O;   // the stock orb canvas is 176% of its box (styles.css .orb)
    return `translate(${(r.left + r.width / 2 - L.left - W / 2).toFixed(1)}px, ${(r.top + r.height / 2 - L.top - cy).toFixed(1)}px) scale(${k.toFixed(4)})`;
  }
  function place(next, animate) {
    if (next === at) return; const from = at; at = next;
    flyOff?.(); flyOff = null;
    layer.dataset.at = next; root.dataset.orbAt = next;
    const m = dockMatrix(), fly = animate && !reduced && !!m && !!from && cssReady;
    if (next === 'dock') {
      if (!fly) { orbBox.style.transition = 'none'; orbBox.style.transform = m || ''; orbBox.dataset.show = ''; dockCv.dataset.show = 'on'; return; }
      orbBox.dataset.show = 'fly'; orbBox.style.transition = `transform ${FLY}ms cubic-bezier(.3, .7, .2, 1), opacity ${FLY}ms ease`; orbBox.style.transform = m;
      flyOff = api.after(FLY, () => { orbBox.dataset.show = ''; dockCv.dataset.show = 'on'; });
    } else {
      dockCv.dataset.show = '';
      if (!fly) { orbBox.style.transition = 'none'; orbBox.style.transform = ''; orbBox.dataset.show = 'on'; return; }
      orbBox.style.transition = 'none'; orbBox.style.transform = m; orbBox.dataset.show = 'fly';
      void orbBox.getBoundingClientRect();   // start from the dock, then grow into place
      orbBox.style.transition = `transform ${FLY}ms cubic-bezier(.3, .7, .2, 1)`; orbBox.style.transform = '';
      flyOff = api.after(FLY, () => { orbBox.dataset.show = 'on'; });
    }
  }

  /* ---------- motion: one loop while the page is visible; the follow (satellites ride with the Home desk while it is
   * dragged) every frame, the drawing about 30 times a second ---------- */
  let running = false, lastT = 0, cancel = null, homeX = 0;
  function follow() {
    const sec = api.phone.home(); if (!sec) return;
    const x = Math.round(sec.getBoundingClientRect().left - layer.getBoundingClientRect().left);
    if (x !== homeX) { homeX = x; placeSats(0); if (at) place(want(), true); }
  }
  function draw(now) {
    const t = now / 1000, dt = lastT ? Math.min(.1, (now - lastT) / 1000) : 0; lastT = now;
    if (!size()) return;
    level += (lvlTarget - level) * .25;
    if (flash > 0) flash = Math.max(0, flash - dt * 1.5);
    const P = palette(look.colourId);
    if (home) { sizeSky(); paintSky(sx, { W: sky.clientWidth, H: sky.clientHeight, gx: sky.clientWidth / 2, cy: Math.round(sky.clientHeight * .5), t, lv: level, P, stars }); placeSats(dt); }
    const cmd = voice?.kind === 'command' || voice?.state === 'command' ? 1 : 0;
    if (orbBox.dataset.show) drawBig(ox, orbCv.width, frameOf(t, cmd));
    if (dockCv.dataset.show && dockCv.isConnected) {
      const n = Math.round((dockCv.clientWidth || 100) * DPR); if (n && dockCv.width !== n) dockCv.width = dockCv.height = n;
      drawSmall(dx, dockCv.width, frameOf(t, cmd));
    }
    drawStrike(now, t, dt);
    if (++runN > 45) { runN = 0; paintApps(); paintBar(); }
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
  api.listen(globalThis, 'resize', () => { W = 0; size(); if (at) { const a = at; at = ''; place(a, false); } if (reduced) still(); });

  /* ---------- the bottom bar: the left slot is the app used last (other than the one in front), the right one is
   * Chats; each tap opens it the stock way (the app's own desk, the Chats list). The marks are the dock's own
   * (api.phone.mark: logo or sigil, colour, live count), so the bar looks like the phone it sits in. ---------- */
  let recent = (Array.isArray(api.storage.get('recent')) ? api.storage.get('recent') : []).filter(x => typeof x === 'string').slice(0, 12);
  function noteRecent(r) {
    const id = r.app && !['chats', 'wizard'].includes(r.app) ? r.app : null;
    if (!id || recent[0] === id) return;
    recent = [id, ...recent.filter(x => x !== id)].slice(0, 12); api.storage.set('recent', recent);
  }
  function leftApp() {
    const kinds = new Map(api.apps.list().map(a => [a.id, a]));
    const run = api.panel.running().filter(r => !r.open && r.id !== 'wizard' && !kinds.get(r.id)?.agent && !kinds.get(r.id)?.connector);
    const rank = id => { const i = recent.indexOf(id); return i < 0 ? 99 : i; };
    return run.map((r, i) => ({ id: r.id, k: rank(r.id) * 100 + i })).sort((a, b) => a.k - b.k)[0]?.id || null;
  }
  const markOf = id => { const m = api.phone.mark(id); return m ? [m, m.outerHTML] : [null, '']; };
  let leftId = null, sigL = null, sigR = null;
  function paintBar() {
    const id = leftApp(), [mL, hL] = id ? markOf(id) : [null, ''];
    if (id + hL !== sigL) {
      sigL = id + hL; leftId = id;
      btnL.replaceChildren(...(mL ? [mL] : [])); btnL.hidden = !mL;
      const a = id && api.apps.list().find(x => x.id === id), n = id ? badgeMap[id] || 0 : 0;
      btnL.setAttribute('aria-label', a ? `Open ${a.name}${n ? ` · ${n} new` : ''}` : '');
    }
    const [mR, hR] = markOf('wizard');
    if (hR !== sigR) {
      sigR = hR; btnR.replaceChildren(...(mR ? [mR] : [])); btnR.hidden = !mR;
      const n = badgeMap.wizard || 0; btnR.setAttribute('aria-label', `Chats${n ? ` · ${n} ready` : ''}`);
    }
  }
  api.listen(btnL, 'click', () => { if (leftId) api.apps.open(leftId); });
  api.listen(btnR, 'click', () => api.nav.openList());

  /* ---------- the bolt: whatever opens (an app, Chats, a thread) is struck from the bar's orb with the desktop's own
   * lightning (shared.js boltPainter): it grows in as the orb lands in the dock, holds a moment and fades, so it says
   * "the orb opened this" without sitting over what you read. Reduced motion: one still strike, then gone. ---------- */
  const STRIKE = 650;
  let strikeKey = '', strikeAt = 0, strikeEnd = 0, strike = 0, struck = false, boltSeed = 1, boltAt = 0, onLight = false;
  // light screens (Light, Landscapes Light): added light vanishes on white, so the strike is painted over, not added
  function lightScreen() {
    const v = getComputedStyle(root).getPropertyValue('--bg').trim(); if (!v) return false;
    bx.fillStyle = 'black'; bx.fillStyle = v; const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(bx.fillStyle); if (!m) return false;
    return .2126 * parseInt(m[1], 16) + .7152 * parseInt(m[2], 16) + .0722 * parseInt(m[3], 16) > 140;
  }
  function aimStrike(r) {
    const key = r.home ? '' : `${r.desk}|${r.app || ''}|${r.thread || ''}`;
    if (key === strikeKey) return; const fromHome = !strikeKey; strikeKey = key;
    if (!key || !cssReady || modeOf(voice) !== 'idle') return;
    strikeAt = performance.now() + (fromHome ? FLY : 0); strikeEnd = strikeAt + STRIKE; onLight = lightScreen();
    if (reduced) { api.after(strikeAt - performance.now(), () => { strike = 1; paintStrike(performance.now() / 1000); }); api.after(strikeEnd - performance.now() + 300, () => { strike = 0; paintStrike(0); }); }
  }
  function paintStrike(t) {
    bx.clearRect(0, 0, W, H); struck = strike > 0; if (!struck) return;
    const host = api.phone.orb(), r = host?.getBoundingClientRect(), L = layer.getBoundingClientRect(); if (!r?.width) return;
    const x1 = r.left + r.width / 2 - L.left, y1 = r.top - L.top + r.height * .12;
    const seed = reduced ? 977 : boltSeed, x2 = W / 2 + ((seed % 9) - 4) * W * .012, y2 = Math.max(H * .18, y1 - H * .52);
    bx.save(); bx.globalCompositeOperation = onLight ? 'source-over' : 'lighter';
    bolt(x1, y1, x2, y2, t, strike * (reduced ? 1 : .82 + .18 * Math.sin(t * 37)), seed + 23, palette(look.colourId));
    bx.restore();
  }
  function drawStrike(now, t, dt) {
    if (reduced) return;
    const want = strikeAt && now >= strikeAt && now < strikeEnd;
    strike = Math.max(0, Math.min(1, strike + (want ? dt * 4 : -dt * 3.2)));
    if (!strike) { if (struck) paintStrike(t); if (now > strikeEnd) strikeAt = 0; return; }
    if (t - boltAt > .09) { boltAt = t; boltSeed = 1 + (hash(boltSeed + ':' + Math.floor(t * 100)) % 2147483000); }   // a fresh strike
    paintStrike(t);
  }

  /* ---------- Home or not: the scene on Home only; the orb where it belongs ---------- */
  function attach() {
    const sec = api.phone.home(); if (sec && sky.parentNode !== sec) sec.prepend(sky);   // a rebuilt desk strip: back in
    const host = api.phone.orb(); if (host && dockCv.parentNode !== host) host.append(dockCv);
    if (host?.parentNode && (barL.nextSibling !== host || host.nextSibling !== barR)) { host.before(barL); host.after(barR); }
  }
  function paint() {
    attach();
    const r = api.route(), h = !!r.home;
    noteRecent(r); aimStrike(r); paintBar();
    if (h !== home) {
      home = h; root.dataset.orbScene = h ? 'home' : 'desk';
      layer.classList.toggle('is-home', h); sky.classList.toggle('is-home', h); field.inert = !h;
      if (h) { paintApps(); api.frame(() => { size(); sizeSky(); }); }
    }
    if (size()) place(want(), true);
  }
  api.on('route', paint);
  api.on('home', paint);
  paint(); wake();

  return () => {
    running = false; cancel?.(); flyOff?.();
    sky.remove(); dockCv.remove(); barL.remove(); barR.remove();
    delete root.dataset.orbPhone; delete root.dataset.orbScene; delete root.dataset.orbAt;
  };
}
