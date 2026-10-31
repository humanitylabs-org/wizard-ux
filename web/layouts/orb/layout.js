/* Orb layout (Miguel, 31 Oct 2026). Desktop only; worn by the miguel/orb-shell tweak, off by default.
 *
 *   All in on the orb: no desks, no workspace numbers. The scene of the approved concept (Files › Pages ›
 *   orb-shell-concept) is always in front:
 *     - a dark starfield sky with a soft glow behind the orb, over the skin's wallpaper (the same calm night scene on
 *       light and dark skins);
 *     - the orb in the middle, following the real take (voice events) and the mic level (api.orb.onLevel). Its look is
 *       a Style × a Colour, picked in a quiet popover bottom right (live previews) and kept per device: seven styles
 *       (styles.js: Glass, Oracle, Plasma, Swarm, Hologram, Glitch, Chrome) in nine colours (Nebula, Ember, Tide, Gold,
 *       Mono, Emerald, Rose, Arctic, and the skin's own accent). Click = talk (a new chat; click again to send).
 *       Hold = a local command (release runs it).
 *     - the owner's apps as round glass satellites on two tilted orbits (front bigger and brighter, behind dimmer),
 *       drifting slowly; the label shows on hover; a click opens the app. The app's own logo, else its glyph.
 *     - under the orb: its name, a caption line (what the take is doing), then the conversations as the concept's
 *       pills: every Ready thread glows amber (Snooze and Done on hover), at most two rows then "+N more" (the Ready
 *       list); Working is one quiet spinner pill ("1 working").
 *     - the real keys as the hint line near the bottom.
 *   Whatever opens (a pill, "+N more", the Working pill, a satellite, the voice) shows in ONE panel that slides in from
 *   the right over the scene, like the concept's conversation panel: the real Chats thread or app window, hosted by
 *   the shell (api.panel: desktop.js keeps it outside the desks). The scene moves left to stay in view. ✕, Esc or a
 *   click on the sky slides it away; opening another thing replaces it. The desks are untouched underneath: turning the
 *   Orb off brings them back exactly.
 *
 * Motion runs only while the page is visible, at about 30 fps; reduced motion = still frames. Colours are skin-layer
 * tokens (--ob-*, the wearing tweak's tweak.css), read lazily. Everything goes through the layout API
 * (core/skin-host.js); no shell internals, no second composer. */
import { STYLES, renderer, mix } from './styles.js';

export default function setup(api) {
  if (api.env.shell !== 'desktop') return () => {};
  const doc = document, root = doc.documentElement;
  const HOLD_MS = 420, MAX_APPS = 10, MAX_ROWS = 2;
  const SVG = 'http://www.w3.org/2000/svg';
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = (tag, cls, attrs = {}) => { const n = doc.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } return n; };
  const icon = paths => { const s = doc.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); for (const d of paths) { const p = doc.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p); } return s; };
  const I = { snooze: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z', 'M12 8v4.5l3 2'], done: ['m5 12.5 4.5 4.5L19 7.5'], apps: ['M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z'] };
  const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return h; };

  /* ---------- the scene ---------- */
  const scene = el('section', 'ob-scene', { 'aria-label': 'Home', 'aria-live': 'off' });
  const sky = el('canvas', 'ob-sky', { 'aria-hidden': 'true' });
  const field = el('div', 'ob-field', { role: 'toolbar', 'aria-label': 'Apps' });
  const orbWrap = el('div', 'ob-orbwrap');
  const orbCv = el('canvas', 'ob-orbc', { 'aria-hidden': 'true' });
  const orbBtn = el('button', 'ob-orb', { type: 'button', 'aria-label': 'Talk · hold for a command', title: 'Click to talk · hold for a command' });
  orbWrap.append(orbCv, orbBtn);
  const name = el('div', 'ob-name');
  const caption = el('div', 'ob-caption', { role: 'status' });
  const threads = el('div', 'ob-threads', { role: 'list', 'aria-label': 'Conversations' });
  const hint = el('div', 'ob-hint');
  const mac = /Mac/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || '');
  const native = !!globalThis.webkit?.messageHandlers?.wizardNative;
  const mod = mac ? '⌥' : 'Alt+';
  hint.append(el('kbd', '', { text: native ? 'Right ⌘' : mod + 'V' }), el('span', '', { text: 'to talk' }), el('i', '', { text: '·', 'aria-hidden': 'true' }), el('kbd', 'is-short', { text: mod + 'N' }), el('span', '', { text: 'to type' }));
  // The look picker, bottom right: a quiet button that opens Style (live previews) and Colour.
  const picker = el('div', 'ob-picker');
  const pickBtn = el('button', 'ob-pick-btn', { type: 'button', 'aria-expanded': 'false', 'aria-haspopup': 'dialog', title: 'Orb style and colour', 'aria-label': 'Orb style and colour' });
  const pickCv = el('canvas', 'ob-pick-cv', { 'aria-hidden': 'true' });
  pickBtn.append(pickCv, el('span', 'ob-pick-l', { text: 'Look' }));
  const pop = el('div', 'ob-pop', { role: 'dialog', 'aria-label': 'Orb look' }); pop.hidden = true;
  const styleRow = el('div', 'ob-styles', { role: 'radiogroup', 'aria-label': 'Style' });
  const colourRow = el('div', 'ob-colours', { role: 'radiogroup', 'aria-label': 'Colour' });
  const colourName = el('em', '');
  const h1 = el('div', 'ob-pop-h', { text: 'Style' }), h2 = el('div', 'ob-pop-h'); h2.append(el('span', '', { text: 'Colour' }), colourName);
  pop.append(h1, styleRow, h2, colourRow);
  picker.append(pop, pickBtn);
  scene.append(sky, field, orbWrap, name, caption, threads, hint, picker);
  api.mount(scene);

  /* ---------- colours: skin-layer tokens, normalised to #rrggbb so alpha can be appended ---------- */
  const probe = el('canvas').getContext('2d');
  const norm = c => { if (!c || !probe) return ''; probe.fillStyle = 'black'; probe.fillStyle = c; const v = probe.fillStyle; return /^#[0-9a-f]{6}$/i.test(v) ? v : ''; };
  const cssVar = n => getComputedStyle(root).getPropertyValue(n).trim();
  // Nine colours: eight from the tweak's tokens (--ob-look-<id>: four colours each) and the skin's own accent.
  const COLOURS = [['nebula', 'Nebula'], ['ember', 'Ember'], ['tide', 'Tide'], ['gold', 'Gold'], ['mono', 'Mono'], ['emerald', 'Emerald'], ['rose', 'Rose'], ['arctic', 'Arctic'], ['skin', 'Skin accent']];
  const pals = new Map();
  function palette(id) {
    const now = performance.now(), hit = pals.get(id);
    if (hit && hit.ok && now - hit.at < 5000) return hit;
    const white = norm(cssVar('--ob-white')) || norm('white'), core = norm(cssVar('--ob-core')) || norm('black');
    let list = id === 'skin' ? [] : cssVar('--ob-look-' + id).split(',').map(s => norm(s.trim())).filter(Boolean);
    const acc = norm(cssVar('--wz-accent')) || norm(cssVar('--ob-v1')) || norm('slateblue');
    // the skin's accent, in four shades of itself (deep, light, pale, warm)
    if (id === 'skin') list = [acc, mix(acc, white, .35), mix(acc, white, .65), mix(acc, norm(cssVar('--ob-amber')) || white, .3)];
    const ok = list.length >= 4 && !!cssVar('--ob-look-nebula');   // tokens loaded
    const p = { at: now, ok, c: list.length >= 4 ? list.slice(0, 4) : [acc, acc, acc, acc], white, core, face: norm(cssVar('--ob-face')) || white };
    pals.set(id, p); return p;
  }
  const A = (hex, a) => hex + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');

  /* ---------- voice ---------- */
  const modeOf = v => !v || v.state === 'idle' ? 'idle' : v.state === 'think' ? 'thinking' : v.state === 'paused' ? 'paused' : 'listening';
  let voice = api.voice.state(), level = 0, lvlTarget = 0, flash = 0, lastMode = 'idle', wasCommand = false;
  api.orb.onLevel(v => { lvlTarget = Math.max(0, Math.min(1, +v || 0)); });
  const onVoice = v => {
    voice = v; const m = modeOf(v);
    scene.dataset.voice = m;
    if (m === 'idle') lvlTarget = 0;
    // a command take that finishes: one sharp ring ("doing it")
    if (lastMode === 'listening' && m !== 'listening' && wasCommand) flash = 1;
    lastMode = m; if (m === 'listening') wasCommand = !!v.command; else if (m === 'idle') wasCommand = false;
    caption.textContent = m === 'idle' ? '' : m === 'thinking' ? 'Sending…' : m === 'paused' ? 'Paused' : v.command ? 'Listening for a command · let go to run it' : 'Listening… click me to send';
    caption.classList.toggle('is-on', m !== 'idle');
    wake(); if (reduced) still();
  };
  api.on('voice', onVoice);
  // Click = talk / send; hold = a command take that runs on release.
  let press = null;
  api.listen(orbBtn, 'pointerdown', e => {
    if (e.button) return;
    const p = { held: false, started: null, cancel: null }; press = p;
    try { orbBtn.setPointerCapture(e.pointerId); } catch (_) {} // a hold that drifts off still ends on it
    orbWrap.classList.add('is-pressed');
    p.cancel = api.after(HOLD_MS, () => { if (press !== p || modeOf(voice) !== 'idle') return; p.held = true; p.started = Promise.resolve(api.voice.command()); });
  });
  const release = run => {
    const p = press; press = null; if (!p) return; p.cancel?.(); orbWrap.classList.remove('is-pressed');
    if (!run) return;
    if (p.held) p.started.then(r => { if (r === 'voice') api.voice.command(); });
    else api.voice.talk();
  };
  api.listen(orbBtn, 'pointerup', () => release(true));
  api.listen(orbBtn, 'pointercancel', () => release(false));
  api.listen(orbBtn, 'keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) api.voice.talk(); } });
  api.listen(orbBtn, 'contextmenu', e => e.preventDefault());

  /* ---------- sky + orb ---------- */
  // Kept per device: style + colour. The v3 single "look" (nebula / ember / tide / oracle) maps onto them once.
  const has = (L, id) => L.some(l => l[0] === id);
  const legacy = api.storage.get('look');
  let styleId = api.storage.get('style'), colourId = api.storage.get('colour');
  if (!has(STYLES, styleId)) styleId = legacy === 'oracle' ? 'oracle' : 'glass';
  if (!has(COLOURS, colourId)) colourId = legacy === 'oracle' ? 'gold' : has(COLOURS, legacy) ? legacy : 'nebula';
  const sx = sky.getContext('2d'), ox = orbCv.getContext('2d');
  const mk = n => { const c = el('canvas'); c.width = c.height = n; return c; };
  let W = 0, H = 0, DPR = 1, O = 300, stars = [], drawOrb = renderer(styleId, mk);
  // Where the scene's centre is: the middle of what the panel leaves free (eased while it slides).
  let cx = 0, cxTarget = 0, free = 0, fit = 1;
  function size() {
    const w = scene.clientWidth, h = scene.clientHeight; if (!w || !h) return false;
    if (w === W && h === H) return true;
    W = w; H = h; DPR = Math.min(2, globalThis.devicePixelRatio || 1);
    sky.width = Math.round(W * DPR); sky.height = Math.round(H * DPR); sx.setTransform(DPR, 0, 0, DPR, 0, 0);
    O = Math.round(Math.min(W * .34, H * (H < 800 ? .32 : .36), 300));
    scene.style.setProperty('--orb', O + 'px');
    orbCv.width = orbCv.height = Math.round(O * 2 * DPR);
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    stars = Array.from({ length: Math.round(W * H / 5200) }, () => ({ x: rnd() * W, y: rnd() * H, r: rnd() * 1.1 + .2, p: rnd() * 6.3, s: .3 + rnd() }));
    aim(true); placeSats(0); fitThreads();
    return true;
  }
  function drawSky(t, lv) {
    const P = palette(colourId), c = P.c, gx = cx || W / 2, cy = H * .46;
    sx.clearRect(0, 0, W, H);
    const g = sx.createRadialGradient(gx, cy, 0, gx, cy, Math.max(W, H) * .7);
    g.addColorStop(0, A(c[0], .16 + lv * .1)); g.addColorStop(.35, A(c[1], .05)); g.addColorStop(1, 'transparent');
    sx.fillStyle = g; sx.fillRect(0, 0, W, H);
    sx.fillStyle = P.white;
    for (const s of stars) { sx.globalAlpha = .25 + .45 * (.5 + .5 * Math.sin(t * s.s + s.p)); sx.beginPath(); sx.arc(s.x, s.y, s.r, 0, 7); sx.fill(); }
    sx.globalAlpha = 1;
  }
  const frameOf = (t, lv, state, fl, blink, col = colourId) => ({ t, lv, state, fl, blink, P: palette(col) });

  /* ---------- the look picker: Style × Colour ---------- */
  const styleTiles = STYLES.map(([id, label]) => {
    const b = el('button', 'ob-st', { type: 'button', role: 'radio', 'data-style': id, 'aria-checked': 'false', title: label, 'aria-label': 'Style: ' + label });
    const cv = el('canvas', 'ob-st-cv', { 'aria-hidden': 'true' });
    b.append(cv, el('span', 'ob-st-n', { text: label }));
    api.listen(b, 'click', () => setLook(id, colourId));
    styleRow.append(b);
    return { id, b, cv, ctx: cv.getContext('2d'), draw: renderer(id, mk) };
  });
  const colourDots = COLOURS.map(([id, label]) => {
    const b = el('button', 'ob-co', { type: 'button', role: 'radio', 'data-colour': id, 'aria-checked': 'false', title: label, 'aria-label': 'Colour: ' + label });
    b.append(el('i', '', { 'aria-hidden': 'true' }));
    api.listen(b, 'click', () => setLook(styleId, id));
    colourRow.append(b);
    return { id, b, label };
  });
  const pickCtx = pickCv.getContext('2d'); let pickDraw = renderer(styleId, mk);
  function paintSwatches() {
    for (const d of colourDots) {
      const P = palette(d.id), c = P.c;
      d.b.style.setProperty('--sw', `radial-gradient(circle at 34% 30%, ${mix(c[1], P.white, .3)}, ${c[0]} 48%, ${mix(c[0], P.core, .55)} 72%, ${P.core})`);
      d.b.style.setProperty('--sw-glow', c[0]);
    }
  }
  function setLook(st, co) {
    const sChanged = st !== styleId;
    styleId = has(STYLES, st) ? st : 'glass'; colourId = has(COLOURS, co) ? co : 'nebula';
    api.storage.set('style', styleId); api.storage.set('colour', colourId);
    if (sChanged) { drawOrb = renderer(styleId, mk); pickDraw = renderer(styleId, mk); }
    paintLook();
  }
  function paintLook() {
    scene.dataset.style = styleId; scene.dataset.colour = colourId;
    for (const s of styleTiles) s.b.setAttribute('aria-checked', String(s.id === styleId));
    for (const d of colourDots) d.b.setAttribute('aria-checked', String(d.id === colourId));
    colourName.textContent = (COLOURS.find(c => c[0] === colourId) || [0, ''])[1];
    paintSwatches(); paintPick(performance.now() / 1000); previews(performance.now() / 1000);
    if (reduced) still();
  }
  // The button's own tiny orb (redrawn on a change and now and then; it never runs a loop of its own).
  function paintPick(t) {
    const n = Math.round(30 * DPR); if (pickCv.width !== n) pickCv.width = pickCv.height = n;
    pickDraw(pickCtx, n, frameOf(t, 0, 'idle', 0, false));
  }
  // Live previews while the popover is open: each style in the chosen colour.
  function previews(t) {
    if (pop.hidden) return;
    const n = Math.round(64 * DPR);
    for (const s of styleTiles) { if (s.cv.width !== n) s.cv.width = s.cv.height = n; s.draw(s.ctx, n, frameOf(t, s.id === styleId ? level : 0, s.id === styleId ? modeOf(voice) : 'idle', 0, false)); }
  }
  let popOff = null;
  function openPop(on) {
    if (on === !pop.hidden) return;
    pop.hidden = !on; pickBtn.setAttribute('aria-expanded', String(on)); picker.classList.toggle('is-open', on);
    popOff?.(); popOff = null;
    if (on) { popOff = api.back.push(() => openPop(false)); paintSwatches(); previews(performance.now() / 1000); styleTiles.find(s => s.id === styleId)?.b.focus({ preventScroll: true }); }
    if (reduced) still();
  }
  api.listen(pickBtn, 'click', () => openPop(pop.hidden));
  // Arrow keys move along a row of choices.
  for (const row of [styleRow, colourRow]) api.listen(row, 'keydown', e => {
    const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!k) return;
    const kids = [...row.children], i = kids.indexOf(doc.activeElement); if (i < 0) return;
    e.preventDefault(); const n = kids[(i + k + kids.length) % kids.length]; n.focus({ preventScroll: true }); n.click();
  });

  /* ---------- apps: round glass satellites on two tilted orbits ---------- */
  // The app's own logo first (the Store's picture of it); its designed glyph otherwise; never a bare letter.
  const GUESS = [[/crm|contact|people|profile/i, 'profile'], [/command|console|terminal/i, 'console'], [/board|\bpr\b|project|kanban/i, 'projects'], [/money|bank|finance|monarch|simplefin|teller/i, 'dollar'],
    [/health|whoop|fit/i, 'gauge'], [/music|tube|audio|podcast/i, 'music'], [/mail|google/i, 'mail'], [/home|house/i, 'home'], [/backup|cloud/i, 'cloud'], [/twitter|social|\bx\b/i, 'social'], [/data|web|bright/i, 'globe']];
  const glyphOf = a => { const m = /sg-([a-z-]+)/.exec(a.icon || ''); return m && !/\bsgl\b/.test(a.icon || '') ? m[1] : (GUESS.find(([re]) => re.test(a.id + ' ' + a.name)) || [0, 'spark'])[1]; };
  const colourOf = a => (/--c:\s*([^;"]+)/.exec(a.icon || '') || [0, 'var(--wz-accent)'])[1].trim();
  let appSig = '', sats = [];
  function sat(a) {
    const b = el('button', 'ob-sat', { type: 'button', 'aria-label': 'Open ' + a.name });
    b.style.setProperty('--c', colourOf(a));
    const face = el('span', 'ob-sat-face');
    if (/\bsglogo\b/.test(a.icon || '')) { const tpl = doc.createElement('template'); tpl.innerHTML = a.icon; face.append(tpl.content); b.classList.add('is-logo'); } // shell-made logo markup (WizSigil)
    else face.append(el('i', `sgi sg-${glyphOf(a)}`, { 'aria-hidden': 'true' }));
    b.append(face, el('b', 'ob-sat-n', { text: a.name }));
    api.listen(b, 'click', () => api.apps.open(a.id));
    api.apps.logo(a.id).then(url => {
      if (!url) return;
      const im = el('img', 'ob-logo', { alt: '', src: url, draggable: 'false' });
      im.decode().then(() => { face.replaceChildren(im); b.classList.add('is-logo'); }, () => {});
    });
    return b;
  }
  function paintApps() {
    const apps = api.apps.list().slice(0, MAX_APPS), sig = apps.map(a => a.id + ':' + a.name + ':' + a.icon.length).join('|');
    if (sig === appSig) return; appSig = sig;
    const items = apps.map(a => ({ id: a.id, el: sat(a) }));
    const all = el('button', 'ob-sat is-all', { type: 'button', 'aria-label': 'All apps (⌥O)' });
    const f = el('span', 'ob-sat-face'); f.append(icon(I.apps)); all.append(f, el('b', 'ob-sat-n', { text: 'All apps' }));
    api.listen(all, 'click', () => api.apps.all());
    items.push({ id: '~all', el: all });
    field.replaceChildren(...items.map(i => i.el));
    // the concept's two rings, apps alternating between them at even steps round the orb, all drifting the same slow
    // way: neighbours always sit on different rings and two apps never slide onto each other
    sats = items.map((it, i) => ({ ...it, a: i / items.length * Math.PI * 2 + .4, ring: i % 2 ? 1 : 1.32, speed: .035 }));
    placeSats(0);
  }
  function placeSats(dt) {
    if (!W) return;
    const cy = H * .46;
    for (const s of sats) {
      if (!reduced) s.a += s.speed * dt;
      const rx = O * 1.65 * s.ring / 1.32 * fit, ry = rx * .34 / Math.max(.5, fit);   // a narrow side: rounder orbits
      const x = cx + Math.cos(s.a) * rx, y = cy + Math.sin(s.a) * ry - O * .12;
      const depth = Math.sin(s.a); // >0 in front of the orb, <0 behind it
      const sc = .78 + .22 * (depth + 1) / 2;
      s.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${sc.toFixed(3)})`;
      s.el.style.zIndex = depth > 0 ? 7 : 4;
      s.el.style.opacity = (.55 + .45 * (depth + 1) / 2).toFixed(3);
    }
  }

  /* ---------- conversations: Ready pills (two rows, then "+N more"), Working as one quiet pill ---------- */
  let threadSig = '', readyCount = -1;
  function pill(s) {
    const row = el('div', 'ob-th is-ready' + (s.needs ? ' is-needs' : '') + (s.unread ? ' is-new' : ''), { role: 'listitem' });
    const open = el('button', 'ob-th-open', { type: 'button', title: s.title, 'aria-label': `${s.needs ? 'Needs you' : 'Ready'}: ${s.title}` });
    open.append(el('span', 'ob-dot', { 'aria-hidden': 'true' }), el('span', 'ob-th-t', { text: s.title }), el('em', '', { text: s.needs ? 'needs you' : 'ready' }));
    api.listen(open, 'click', () => api.sessions.open(s.id));
    row.append(open);
    if (s.actions.length) {
      const acts = el('span', 'ob-acts');
      for (const act of s.actions) {
        const label = act === 'done' ? 'Done' : 'Snooze';
        const b = el('button', 'ob-act is-' + act, { type: 'button', title: label, 'aria-label': `${label}: ${s.title}` });
        b.append(icon(I[act]));
        api.listen(b, 'click', e => { e.stopPropagation(); row.classList.add('is-leaving'); api.sessions.act(s.id, act); });
        acts.append(b);
      }
      row.append(acts);
    }
    return row;
  }
  const more = el('button', 'ob-th is-more', { type: 'button', role: 'listitem', title: 'Open the Ready list' });
  api.listen(more, 'click', () => api.sessions.openList('ready'));
  function paintThreads() {
    const L = api.sessions.list();
    if (!L) { if (threadSig !== 'off') { threadSig = 'off'; threads.replaceChildren(); } return; }
    const ready = L.ready.filter(s => !s.snoozed), working = L.working;
    const sig = JSON.stringify([ready.map(s => [s.id, s.title, s.needs, s.unread, s.actions]), working.map(s => [s.id, s.title])]);
    if (sig === threadSig) return; threadSig = sig;
    if (readyCount >= 0 && ready.length > readyCount) flash = Math.max(flash, .6);   // something new is ready: a soft ring
    readyCount = ready.length;
    const kids = ready.map(pill);
    kids.push(more);
    if (working.length) {
      const w = el('button', 'ob-th is-working', { type: 'button', role: 'listitem', title: working.length === 1 ? working[0].title : 'Open the Working list', 'aria-label': `${working.length} working` });
      w.append(el('span', 'ob-dot', { 'aria-hidden': 'true' }), el('em', '', { text: `${working.length} working` }));
      api.listen(w, 'click', () => working.length === 1 ? api.sessions.open(working[0].id) : api.sessions.openList('working'));
      kids.push(w);
    }
    threads.replaceChildren(...kids);
    fitThreads();
  }
  // At most two rows of Ready pills: the rest fold into "+N more" (which opens the Ready list).
  function fitThreads() {
    const pills = [...threads.children].filter(n => n.classList.contains('is-ready'));
    for (const p of pills) p.hidden = false;
    more.hidden = true;
    if (!pills.length || !threads.isConnected || !home) return;
    const top = pills[0].offsetTop, rowH = pills[0].offsetHeight + 10;
    const rowOf = n => Math.round((n.offsetTop - top) / rowH);
    const last = threads.lastElementChild;
    if (rowOf(last) < MAX_ROWS) return;
    more.hidden = false;
    let hidden = 0;
    for (let i = pills.length - 1; i >= 1; i--) {
      pills[i].hidden = true; hidden++;
      more.textContent = `+${hidden} more`;
      if (rowOf(threads.lastElementChild) < MAX_ROWS) break;
    }
    more.setAttribute('aria-label', `${hidden} more ready: open the Ready list`);
  }

  /* ---------- motion: one ~30 fps loop, only while the scene is in front and the page is visible ---------- */
  let running = false, lastT = 0, cancel = null, home = null, blinkAt = 3;
  /* ---------- the panel: whatever opens slides in on the right; the scene moves to the middle of what is left ---------- */
  let panelKind = null;
  function aim(jump = false) {
    const st = panelKind ? api.panel.state() : null, pw = st ? Math.min(W * .8, st.width || 0) : 0;
    free = Math.max(320, W - pw); cxTarget = free / 2;
    fit = pw ? Math.max(.42, Math.min(1, (free * .5 - 40) / (O * 1.65))) : 1;
    const k = pw ? Math.max(.6, Math.min(1, free / (O * 2.9))) : 1;   // a narrow free side: the orb itself steps down
    scene.style.setProperty('--ob-free', Math.round(free) + 'px'); scene.style.setProperty('--ob-k', k.toFixed(3));
    if (jump || reduced || !cx) { cx = cxTarget; scene.style.setProperty('--ob-cx', Math.round(cx) + 'px'); }
  }
  function ease(dt) {
    if (Math.abs(cxTarget - cx) < .5) { if (cx !== cxTarget) { cx = cxTarget; scene.style.setProperty('--ob-cx', Math.round(cx) + 'px'); } return; }
    cx += (cxTarget - cx) * Math.min(1, dt * 7);
    scene.style.setProperty('--ob-cx', Math.round(cx) + 'px');
  }
  function paintPanel() {
    const k = api.route().panel || null;
    if (k !== panelKind) { panelKind = k; scene.dataset.panel = k || ''; }
    if (W) aim();
    api.frame(() => { if (!W) return; aim(); fitThreads(); if (reduced) still(); });  // the panel's width, once laid out
  }
  // A click on the open sky (not the orb, an app or a pill) puts the panel away and folds the picker.
  api.listen(scene, 'pointerdown', e => {
    if (e.button) return;
    const bare = e.target === scene || e.target === sky || e.target === field;
    if (!pop.hidden && !picker.contains(e.target)) openPop(false);
    if (bare && panelKind) api.panel.close();
  });
  function draw(now) {
    const t = now / 1000, dt = lastT ? Math.min(.1, (now - lastT) / 1000) : 0;
    lastT = now;
    if (!size()) return;
    level += (lvlTarget - level) * .25;
    if (flash > 0) flash = Math.max(0, flash - dt * 1.5);
    const blink = t > blinkAt && t < blinkAt + .14; if (t > blinkAt + .14) blinkAt = t + 2.5 + ((hash(Math.floor(t)) % 300) / 100);
    ease(dt);
    drawSky(t, level);
    drawOrb(ox, orbCv.width, frameOf(t, level, modeOf(voice), flash, blink));
    placeSats(dt);
    if (!pop.hidden && (frameN++ & 1)) previews(t);
    if (++pickN > 90) { pickN = 0; paintPick(t); }
  }
  let frameN = 0, pickN = 0;
  function loop(now) {
    cancel = null; if (!running) return;
    if (now - lastT >= 30) draw(now);
    cancel = api.frame(loop);
  }
  function still() { api.frame(now => { lastT = 0; draw(now); }); }
  function wake() {
    const awake = !!home && !doc.hidden;
    if (awake && !reduced && !running) { running = true; lastT = 0; cancel = api.frame(loop); }
    else if ((!awake || reduced) && running) { running = false; cancel?.(); cancel = null; }
    if (reduced && awake) still();
  }
  api.listen(doc, 'visibilitychange', wake);
  api.listen(globalThis, 'resize', () => { if (home) { size(); fitThreads(); if (reduced) still(); } });

  /* ---------- visibility: the scene shows only while Home is in front ---------- */
  function paintVisible() {
    const h = !!api.route().home;
    if (h !== home) {
      home = h; root.dataset.orbScene = h ? 'home' : 'desk';
      scene.classList.toggle('is-on', h); scene.inert = !h;
      wake();
      if (h) api.frame(() => { size(); fitThreads(); });
    }
  }
  function paint() {
    paintVisible(); paintPanel();
    if (!home) return;
    name.textContent = api.agents.here()?.label || 'Wizard';
    paintThreads(); paintApps();
  }
  api.panel.claim();        // no desks: everything that opens shows in the panel on the right, over the scene
  api.desk.emptyHome();
  api.on('route', paint);
  api.on('home', paint);   // every Home repaint (live threads, outbox) lands here
  paintLook();
  paint();
  onVoice(voice);

  return () => { running = false; cancel?.(); delete root.dataset.orbScene; };
}
