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
 *     - under the orb: its name and a caption line (what the take is doing); the real keys as the hint line.
 *   v5 (Miguel, 31 Oct 2026), in thirds: LEFT the STOCK Chats list, docked for good (api.panel.dock: the same window,
 *   Ready / Working / Archive, its sort, search, pins, every tweak and every Chats key), full height under the bar in a
 *   softer glass; a handle on its edge (or ⌥\\) folds it to a slim strip with the Ready count. CENTRE the orb scene.
 *   v6 (Miguel, 31 Oct 2026): THE ORB NEVER MOVES. It stays at the screen's centre; panels only cover the sides. A
 *   thread picked in the list (a click, ⌥↓) opens in a column right beside the list (closing it folds it back into the
 *   list); an app (a satellite, All apps) opens in the right third, one at a time. Both can be open together. An open
 *   app's satellite stops drifting and pins between the orb and its panel, and an electric bolt in the orb's colour
 *   runs orb → app → panel (a quieter one runs orb → chat column). Each panel's ‹ goes back to the one before, ✕ / Esc
 *   closes it; Done, Snooze, a send or ‹ close the chat column and put the keyboard back in the list. The desks are
 *   untouched underneath: turning the Orb off brings them back exactly.
 *
 *   v7 (Miguel, 31 Oct 2026): eight shader-drawn styles (styles.js). ⌥C or a held orb is the orb's own command take:
 *   it tightens into a bright core inside a turning ring, a caption under it says what it is doing, and the result
 *   lands there too (the app's satellite pins and the bolt runs to it; music says what plays; no match offers ↵ to ask
 *   the agent instead). No toasts and no bar pill for it here. Satellites are ambient status, not a launcher: only apps
 *   running in the panel (a closed app panel only hides, its app keeps running with a soft glow ring) and apps with
 *   an unread count float; nothing else. Right-click one: Open / Close (really quits it). Keys: hold LEFT ⌥ for bare
 *   app letters, ⌥\\ list open / folded, ⌥⇧\\ list wide, ⌥⇧C close the chat column, ⌥⇧A hide the app panel.
 *
 * Motion runs only while the page is visible, at about 30 fps; reduced motion = still frames. Colours are skin-layer
 * tokens (--ob-*, the wearing tweak's tweak.css), read lazily. Everything goes through the layout API
 * (core/skin-host.js); no shell internals, no second composer. */
import { STYLES, RETIRED, renderer, mix } from './styles.js';
import { assignKeys, keyOf, isLeftAlt, HOLD_MS } from './keys.js';
import { COLOURS, has, lookOf, palettes, starsFor, paintSky, A, regular, orbitApps as orbitList, glyphOf, colourOf } from './shared.js';
import phone from './phone.js';

export default function setup(api) {
  // The phone wears the same scene on Home only (phone.js: same look, sky and satellites; the rest stays the phone's).
  if (api.env.shell === 'phone') return phone(api);
  if (api.env.shell !== 'desktop') return () => {};
  const doc = document, root = doc.documentElement;
  const HOLD_MS = 420, STRIP = 46;
  const SVG = 'http://www.w3.org/2000/svg';
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = (tag, cls, attrs = {}) => { const n = doc.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } return n; };
  const icon = paths => { const s = doc.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); for (const d of paths) { const p = doc.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p); } return s; };
  const I = { apps: ['M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z'], fold: ['m9.5 6 6 6-6 6'], unfold: ['m14.5 6-6 6 6 6'] };
  const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return h; };

  /* ---------- the scene ---------- */
  const scene = el('section', 'ob-scene', { 'aria-label': 'Home', 'aria-live': 'off' });
  const sky = el('canvas', 'ob-sky', { 'aria-hidden': 'true' });
  const field = el('div', 'ob-field', { role: 'toolbar', 'aria-label': 'Apps' });
  const orbWrap = el('div', 'ob-orbwrap');
  const orbCv = el('canvas', 'ob-orbc', { 'aria-hidden': 'true' });
  const orbBtn = el('button', 'ob-orb', { type: 'button', 'aria-label': 'Talk · hold for a command', title: 'Click to talk · hold (or ⌥C) for a command' });
  orbWrap.append(orbCv, orbBtn);
  const caption = el('div', 'ob-caption', { role: 'status' });
  const capText = el('span', 'ob-cap-t'), capAsk = el('button', 'ob-cap-ask', { type: 'button' }); capAsk.hidden = true;
  caption.append(capText, capAsk);
  // The hold-⌥ letters of apps that aren't floating right now: a quiet row under the orb, only while ⌥ is held.
  const keyRow = el('div', 'ob-keyrow', { 'aria-hidden': 'true' });
  // Right-click a satellite: Open / Close.
  const menu = el('div', 'ob-menu', { role: 'menu' }); menu.hidden = true;
  // The docked Chats list's fold handle (on its right edge) and, folded, the slim strip with the Ready count.
  const MK = /Mac/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || '') ? '⌥' : 'Alt+';
  const foldBtn = el('button', 'ob-fold', { type: 'button', title: 'Hide conversations (' + MK + '\\) · wide list: ' + MK + '⇧\\', 'aria-label': 'Hide conversations', 'aria-keyshortcuts': 'Alt+Backslash Alt+Shift+Backslash' });
  foldBtn.append(icon(I.unfold));
  const strip = el('button', 'ob-strip', { type: 'button', title: 'Show conversations (' + MK + '\\)', 'aria-keyshortcuts': 'Alt+Backslash' });
  const badge = el('b', 'ob-badge');
  strip.append(icon(I.fold), badge, el('span', 'ob-strip-l', { text: 'Chats' }));
  const mac = /Mac/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || '');
  const native = !!globalThis.webkit?.messageHandlers?.wizardNative;
  const mod = mac ? '⌥' : 'Alt+';
  // The bottom of the scene: one quiet search pill, the always-there way to open any app: it opens the shell's own
  // launcher in its apps-first mode (⌥O: installed apps, type a name, ↵ opens it; no app by that name widens to ⌘K /
  // ⌥Space to find a thread or ask). The key hint
  // lives in it) with the Look button beside it.
  const dock = el('div', 'ob-dock');
  const hint = el('button', 'ob-search', { type: 'button', title: 'Search apps or ask (' + mod + 'Space) · all apps: ' + MK + 'O', 'aria-label': 'Search apps or ask', 'aria-keyshortcuts': 'Alt+O Alt+Space' });
  hint.append(icon(['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 20 20']), el('span', 'ob-search-l', { text: 'Search apps or ask…' }), el('kbd', '', { text: mod + 'Space' }), el('i', '', { text: '·', 'aria-hidden': 'true' }), el('kbd', 'is-talk', { text: native ? 'Right ⌘' : mod + 'V', title: 'to talk' }));
  api.listen(hint, 'click', () => api.apps.all());
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
  dock.append(hint, picker);
  scene.append(sky, field, orbWrap, caption, keyRow, dock, foldBtn, strip);   // no name label: the orb is the entity
  api.mount(scene);

  /* ---------- colours: skin-layer tokens, normalised to #rrggbb so alpha can be appended (shared.js) ---------- */
  const palette = palettes(doc);

  /* ---------- voice ---------- */
  const modeOf = v => !v || v.state === 'idle' ? 'idle' : v.state === 'think' ? 'thinking' : v.state === 'paused' ? 'paused' : 'listening';
  let voice = api.voice.state(), level = 0, lvlTarget = 0, flash = 0, lastMode = 'idle', wasCommand = false, cmdOn = false, cmdK = 0, cmdSafe = null;
  api.orb.onLevel(v => { lvlTarget = Math.max(0, Math.min(1, +v || 0)); });
  /* The caption under the orb: what the take is doing, then (a command) what came of it. A result stays a few seconds;
   * a miss offers to ask the agent instead (↵ or a click), until Esc, a click elsewhere or the next take. */
  let capOff = null, capBack = null, pendingAsk = '';
  const agentName = () => api.agents.here()?.label || 'your agent';
  function say(text, { hold = 0, ask = '', tone = '' } = {}) {
    capOff?.(); capOff = null; capBack?.(); capBack = null; pendingAsk = ask;
    capText.textContent = text; caption.dataset.tone = tone;
    capAsk.hidden = !ask; if (ask) { capAsk.replaceChildren(el('kbd', '', { text: '↵' }), doc.createTextNode(' ask ' + agentName() + ' instead')); capBack = api.back.push(() => say('')); }
    caption.classList.toggle('is-on', !!text);
    if (hold) capOff = api.after(hold, () => { if (modeOf(voice) === 'idle') say(''); });
  }
  function askNow() {
    const words = pendingAsk; if (!words) return;
    say(''); if (api.voice.ask(words)) { flash = Math.max(flash, .7); say('Sent to ' + agentName() + ' · a new chat', { hold: 2600 }); }
  }
  api.listen(capAsk, 'click', askNow);
  const onVoice = v => {
    voice = v; const m = modeOf(v);
    scene.dataset.voice = m;
    if (m === 'idle') lvlTarget = 0;
    // a command take stays in command state while its words are worked out (the recorder is already idle then)
    const working = m === 'idle' && !!v.command;
    cmdOn = !!v.command && (m !== 'idle' || working); scene.dataset.cmd = cmdOn ? 'on' : '';
    cmdSafe?.(); cmdSafe = working ? api.after(15000, () => { cmdOn = false; scene.dataset.cmd = ''; if (capText.textContent === 'Working it out…') say(''); }) : null;
    // a command take that finishes: one sharp ring ("doing it")
    if (lastMode === 'listening' && m !== 'listening' && wasCommand) flash = 1;
    lastMode = m; if (m === 'listening') wasCommand = !!v.command; else if (m === 'idle') wasCommand = false;
    if (working) say('Working it out…', { tone: 'cmd' });
    else if (m !== 'idle') say(m === 'thinking' ? (v.command ? 'Working it out…' : 'Sending…') : m === 'paused' ? 'Paused' : v.command ? 'Say a command · let go or ⌥C to run it' : 'Listening… click me to send', { tone: v.command ? 'cmd' : '' });
    else if (!pendingAsk && !capOff) say('');
    wake(); if (reduced) still();
  };
  api.on('voice', onVoice);
  // The command take's result, here instead of a toast: done = what happened, miss = ↵ asks the agent instead.
  api.voice.onCommand(r => {
    cmdOn = false; scene.dataset.cmd = ''; cmdSafe?.(); cmdSafe = null;
    const q = r.text ? '“' + String(r.text).trim().replace(/[.!?]+$/, '') + '”' : '';
    if (r.result === 'done') {
      flash = 1;
      const app = r.app ? api.apps.list().find(a => a.id === r.app) : null;
      say(r.music ? '♪ Now playing · ' + q : app ? 'Opening ' + app.name : 'Done · ' + q, { hold: r.music ? 4200 : 2400, tone: r.music ? 'music' : 'ok' });
    } else if (r.result === 'miss') say('No command for ' + (q || 'that'), { ask: String(r.text || '').trim(), hold: 9000, tone: 'miss' });
    else if (r.result === 'silent') say('Didn’t hear anything', { hold: 1800 });
    else if (r.result === 'kept') say('Couldn’t make that out · the recording is kept', { hold: 3200 });
  });
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
  // Kept per device: style + colour (shared.js lookOf: the same stored choice the phone wears).
  let { styleId, colourId } = lookOf(api);
  const sx = sky.getContext('2d'), ox = orbCv.getContext('2d');
  const mk = n => { const c = el('canvas'); c.width = c.height = n; return c; };
  let W = 0, H = 0, DPR = 1, O = 300, stars = [], drawOrb = renderer(styleId, mk);
  // The orb never moves: the scene's centre is the screen's centre whatever is open (panels only cover the sides).
  let cx = 0, fit = 1;
  function size() {
    const w = scene.clientWidth, h = scene.clientHeight; if (!w || !h) return false;
    if (w === W && h === H) return true;
    W = w; H = h; DPR = Math.min(2, globalThis.devicePixelRatio || 1);
    sky.width = Math.round(W * DPR); sky.height = Math.round(H * DPR); sx.setTransform(DPR, 0, 0, DPR, 0, 0);
    O = Math.round(Math.min(W * .34, H * (H < 800 ? .32 : .36), 300));
    scene.style.setProperty('--orb', O + 'px');
    orbCv.width = orbCv.height = Math.round(O * 2 * DPR);
    stars = starsFor(W, H);
    aim(); paintApps(); placeSats(0);
    return true;
  }
  function drawSky(t, lv) { paintSky(sx, { W, H, gx: cx || W / 2, cy: H * .46, t, lv, P: palette(colourId), stars }); }
  const frameOf = (t, lv, state, fl, blink, col = colourId, cmd = 0) => ({ t, lv, state, fl, blink, cmd, P: palette(col) });

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
    const n = Math.round(52 * DPR);
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
  // glyphOf / colourOf: shared.js (the phone draws its satellites with the same marks)
  let appSig = '', sats = [];
  // Each app is just its own mark, clean-cut on the sky: its logo (a tile logo stays a tile, a free-form logo stays
  // free-form) or its glyph in its own colour. No plate, ring or bubble behind it; only a soft shadow for legibility.
  const tileProbe = el('canvas'); tileProbe.width = tileProbe.height = 16;
  const isTile = im => { try { const x = tileProbe.getContext('2d', { willReadFrequently: true }); x.clearRect(0, 0, 16, 16); x.drawImage(im, 0, 0, 16, 16); const d = x.getImageData(0, 0, 16, 16).data, at = (i, j) => d[(j * 16 + i) * 4 + 3];
    return [at(3, 8), at(12, 8), at(8, 3), at(8, 12)].every(v => v > 200) && [at(0, 0), at(15, 0), at(0, 15), at(15, 15)].some(v => v > 200 || v < 60); } catch (_) { return true; } };
  function sat(a) {
    const b = el('button', 'ob-sat', { type: 'button', 'aria-label': 'Open ' + a.name, 'data-app': a.id, 'aria-haspopup': 'menu' });
    b.style.setProperty('--c', colourOf(a));
    const face = el('span', 'ob-sat-face');
    if (/\bsglogo\b/.test(a.icon || '')) { const tpl = doc.createElement('template'); tpl.innerHTML = a.icon; face.append(tpl.content); b.classList.add('is-logo'); } // shell-made logo markup (WizSigil)
    else face.append(el('i', `sgi sg-${glyphOf(a)}`, { 'aria-hidden': 'true' }));
    const count = el('b', 'ob-sat-badge', { 'aria-hidden': 'true' }); count.hidden = true;
    const kc = el('kbd', 'ob-sat-key', { 'aria-hidden': 'true' });
    // running out of sight: a soft halo on the mark itself and a tiny dot under it (never a ring around it);
    // playing: three tiny bars in the dot's place
    const eq = el('i', 'ob-sat-eq', { 'aria-hidden': 'true' }); eq.append(el('i', ''), el('i', ''), el('i', ''));
    b.append(face, count, el('i', 'ob-sat-run', { 'aria-hidden': 'true' }), eq, kc, el('b', 'ob-sat-n', { text: a.name }));
    keyEls.set(a.id, kc);
    api.listen(b, 'click', () => { openMenu(null); api.apps.open(a.id); });
    api.listen(b, 'contextmenu', e => { e.preventDefault(); const r = b.getBoundingClientRect(); openMenu(a, Number.isFinite(e.clientX) && e.clientX ? e.clientX : r.x + r.width / 2, Number.isFinite(e.clientY) && e.clientY ? e.clientY : r.y + r.height / 2); });
    api.apps.logo(a.id).then(url => {
      if (!url) return;
      const im = el('img', 'ob-logo', { alt: '', src: url, draggable: 'false' });
      im.decode().then(() => { face.replaceChildren(im); b.classList.add('is-logo'); b.classList.toggle('is-tile', isTile(im)); }, () => {});
    });
    badgeOf.set(b, { node: count, name: a.name }); paintBadge(b, a.id);
    return b;
  }
  /* ---------- badges: the shell's own app counts (desk marks, dock), live ---------- */
  const badgeOf = new WeakMap();
  let badgeMap = api.apps.badges(m => { badgeMap = m; paintApps(); for (const s of sats) paintBadge(s.el, s.id); });
  function paintBadge(b, id) {
    const n = badgeMap[id] || 0, rec = badgeOf.get(b); if (!rec) return;
    const { node, name } = rec;
    node.textContent = n > 99 ? '99+' : n ? String(n) : ''; node.hidden = !n;
    b.setAttribute('aria-label', 'Open ' + name + (n ? ` · ${n} new` : '') + (b.dataset.run === 'hidden' ? ' · running' : ''));
  }
  /* Satellites are ambient status, not a launcher (Miguel, v7): only (a) apps running in the panel (shown, or hidden
   * and still running) and (b) regular apps with an unread count float. Agents, connectors, agent apps, system and
   * in-development apps never float for a count (the shell's own kinds: core/app-kinds.js); everything stays one
   * search away (the search pill / ⌥O, ⌥Space, a command, the ⌥ letters); no All apps satellite. Nothing running and nothing new: just the orb. */
  const orbitApps = () => orbitList(api, badgeMap);   // shared.js: the one list the phone floats too
  let satScale = 1;
  function fits(n) {
    if (!W) return { cap: n, scale: 1 };
    const perim = r => 2 * Math.PI * Math.sqrt((r * r + (r * .34) ** 2) / 2), cap = s => Math.floor((perim(O * 1.65) + perim(O * 1.65 / 1.32)) / (64 * s));
    for (const sc of [1, .86, .74]) if (n <= cap(sc)) return { cap: n, scale: sc };
    return { cap: Math.max(1, cap(.74) - 1), scale: .74 };
  }
  const runOf = a => a.run ? (a.run.open ? 'open' : 'hidden') : '';
  function paintApps() {
    const every = orbitApps(), fit = fits(every.length), apps = every.slice(0, fit.cap);
    const sig = apps.map(a => a.id + ':' + a.name + ':' + a.icon.length).join('|') + '|' + fit.scale;
    // state only (running, playing, badge-only): repaint in place, the orbit keeps turning
    const paintState = () => { for (const s of sats) { const a = apps.find(x => x.id === s.id); if (!a) continue; s.el.dataset.run = runOf(a); s.el.classList.toggle('is-playing', !!a.run?.playing); s.el.classList.toggle('is-new', !a.run); paintBadge(s.el, s.id); } };
    if (sig === appSig) { paintState(); return; }
    appSig = sig; satScale = fit.scale;
    keyEls.clear();
    // more than fit: the rest stay one search away (the pill), never an All apps satellite
    const items = apps.map(a => ({ id: a.id, el: sat(a) }));
    field.replaceChildren(...items.map(i => i.el));
    // the concept's two rings, apps alternating between them at even steps round the orb, all drifting the same slow
    // way: neighbours always sit on different rings and two apps never slide onto each other
    const was = new Map(sats.map(s => [s.id, s]));
    sats = items.map((it, i) => ({ ...it, a: i / items.length * Math.PI * 2 + .4, ring: i % 2 ? 1 : 1.32, speed: .035, pk: was.get(it.id)?.pk || 0 }));
    extra = null; paintState(); paintKeys();
    placeSats(0);
  }
  /* ---------- right-click a satellite: Open / Close (Close really quits it; a badge-only app has only Open) ---------- */
  let menuOff = null;
  function openMenu(a, x = 0, y = 0) {
    menuOff?.(); menuOff = null;
    if (!a) { menu.hidden = true; return; }
    const running = api.panel.running().some(r => r.id === a.id);
    const item = (label, fn) => { const b = el('button', 'ob-menu-i', { type: 'button', role: 'menuitem', text: label }); api.listen(b, 'click', () => { openMenu(null); fn(); }); return b; };
    menu.replaceChildren(el('div', 'ob-menu-h', { text: a.name }), item('Open', () => api.apps.open(a.id)), ...(running ? [item('Close', () => { api.panel.quit(a.id); api.after(30, paintApps); })] : []));
    menu.hidden = false;   // fixed: at the pointer, kept on screen
    menu.style.left = Math.round(Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))) + 'px'; menu.style.top = Math.round(Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))) + 'px';
    menuOff = api.back.push(() => openMenu(null));
    menu.children[1]?.focus({ preventScroll: true });
  }
  api.listen(menu, 'keydown', e => { const k = { ArrowDown: 1, ArrowUp: -1 }[e.key]; if (!k) return; e.preventDefault(); const bs = [...menu.children].filter(n => n.tagName === 'BUTTON'), i = bs.indexOf(doc.activeElement); bs[(i + k + bs.length) % bs.length]?.focus(); });
  /* ---------- hold the LEFT ⌥ for app letters (keys.js): bare letters, only while it is held ----------
   * After HOLD_MS with no other key, every floating app shows its letter and the apps that aren't floating show theirs
   * in a quiet row under the orb; a letter then opens that app (over the desktop's own ⌥ keys, only while shown).
   * Released, or any other key, or the window losing focus: gone at once. Right ⌥ never shows them. */
  const keyEls = new Map();
  let keyMap = {}, byKey = new Map(), altHeld = false, altCancel = null, keysOn = false;
  const keyApps = () => api.apps.list().filter(a => regular(a) || api.panel.running().some(r => r.id === a.id));
  function paintKeys() {
    const list = keyApps();
    keyMap = assignKeys(list.map(a => ({ id: a.id, name: a.name })), api.storage.get('keys') || {});
    api.storage.set('keys', { ...(api.storage.get('keys') || {}), ...keyMap });
    byKey = new Map(Object.entries(keyMap).map(([id, k]) => [k, id]));
    for (const [id, kc] of keyEls) { const k = keyMap[id] || ''; kc.textContent = k; kc.hidden = !k; }
    const floating = new Set(sats.map(s => s.id));
    keyRow.replaceChildren(...list.filter(a => keyMap[a.id] && !floating.has(a.id)).slice(0, 18).map(a => { const c = el('span', 'ob-keyrow-i'); c.append(el('b', '', { text: keyMap[a.id] }), el('span', '', { text: a.name })); return c; }));
  }
  const showKeys = on => { keysOn = !!on; scene.dataset.keys = on ? 'on' : ''; };
  const dropHold = () => { altHeld = false; altCancel?.(); altCancel = null; showKeys(false); };
  const typingIn = t => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
  let maxed = api.storage.get('listMax') === true;
  api.keys.on({
    hold: true,
    down(e) {
      if (!home) return false;
      if (e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight') {
        if (isLeftAlt(e) && !e.repeat && !e.metaKey && !e.ctrlKey && !e.shiftKey) { altHeld = true; altCancel?.(); altCancel = api.after(HOLD_MS, () => { if (altHeld) { paintKeys(); showKeys(true); } }); }
        return false;
      }
      if (keysOn && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        const k = keyOf(e), id = k && byKey.get(k);
        if (id) { dropHold(); if (!e.repeat) api.apps.open(id); return true; }
      }
      dropHold();
      const alt = e.altKey && !e.metaKey && !e.ctrlKey;
      // ⌥\ the list open ⇄ folded (from wide: back to open); ⌥⇧\ the list wide ⇄ open
      if (alt && e.code === 'Backslash') { if (!e.repeat) { if (e.shiftKey) widen(!maxed); else if (maxed) widen(false); else fold(!folded); } return true; }
      // ⌥⇧C closes the chat column, ⌥⇧A hides the app panel (it keeps running; its satellite glows)
      if (alt && e.shiftKey && (e.code === 'KeyC' || e.code === 'KeyA')) { if (!e.repeat) api.panel.close(e.code === 'KeyC' ? 'chat' : 'app'); return true; }
      if (pendingAsk && e.key === 'Enter' && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && !typingIn(e.target)) { askNow(); return true; }
      return false;
    },
    up(e) { if (isLeftAlt(e) || e.key === 'Alt') dropHold(); },
  });
  api.listen(globalThis, 'blur', dropHold);
  // The ⌥/ guide: these keys on the things they act on.
  api.keys.guide(() => [
    { el: folded ? strip : foldBtn, key: '\\', word: folded ? 'Show list' : 'Fold list' },
    ...(folded ? [] : [{ el: grip.list, key: '⇧\\', word: maxed ? 'Narrower' : 'Wide list', at: 'inside-l' }]),
    { el: grip.chat, key: '⇧C', word: 'Close chat', at: 'inside-l' }, { el: grip.app, key: '⇧A', word: 'Hide app', at: 'inside-l' },
    { el: orbBtn, key: 'C', word: 'Command', at: 'below' },
  ]);
  // An app opened that has no satellite (from the search pill, beyond the ones that fit): a satellite of its own while it is open.
  let extra = null;
  function pinExtra() {
    const id = G.app?.id || null;
    if (extra && extra.id !== id) { const gone = extra; extra = null; sats = sats.filter(s => s !== gone); gone.el.remove(); }
    if (!id || sats.some(s => s.id === id)) return;
    const a = api.apps.list().find(x => x.id === id); if (!a) return;
    extra = { id, el: sat(a), a: 0, ring: 1, speed: 0, pk: 1 };
    extra.el.classList.add('is-extra'); field.append(extra.el); sats.push(extra);
  }
  // An app open in the panel: its satellite stops drifting and pins between the orb and the panel (eased there and
  // back); the bolts run orb → it → the panel's edge.
  const smooth = v => v * v * (3 - 2 * v);
  function placeSats(dt) {
    if (!W) return;
    const cy = H * .46, pinId = G.app ? G.app.id : null;
    for (const s of sats) {
      if (!reduced) s.a += s.speed * dt;
      const rx = O * 1.65 * s.ring / 1.32 * fit, ry = rx * .34 / Math.max(.5, fit);
      let x = cx + Math.cos(s.a) * rx, y = cy + Math.sin(s.a) * ry - O * .12;
      const depth = Math.sin(s.a); // >0 in front of the orb, <0 behind it
      let sc = (.78 + .22 * (depth + 1) / 2) * satScale, op = .55 + .45 * (depth + 1) / 2;
      const want = pinId && s.id === pinId ? 1 : 0;
      s.pk = reduced ? want : (s.pk || 0) + (want - (s.pk || 0)) * Math.min(1, dt * 5);
      if (s.pk < .002) s.pk = 0;
      const k = smooth(Math.min(1, s.pk));
      if (k > 0) { x += (G.pinX - x) * k; y += (cy - y) * k; sc += (1.1 - sc) * k; op += (1 - op) * k; }
      s.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${sc.toFixed(3)})`;
      s.el.style.zIndex = k > 0 ? 8 : depth > 0 ? 7 : 4;
      s.el.style.opacity = op.toFixed(3);
      s.el.classList.toggle('is-pinned', k > .5);
      s.x = x; s.y = y; s.sc = sc;
    }
  }

  /* ---------- conversations: the stock Chats list, docked on the left (shell panel); folded = a slim strip ---------- */
  let folded = api.storage.get('folded') === true, readyCount = -1;
  function paintReady() {
    const L = api.sessions.list();
    const n = L ? L.ready.filter(s => !s.snoozed).length : 0;
    if (readyCount >= 0 && n > readyCount) flash = Math.max(flash, .6);   // something new is ready: a soft ring
    readyCount = n;
    badge.textContent = n ? String(n) : ''; badge.hidden = !n;
    strip.setAttribute('aria-label', n ? `Show conversations · ${n} ready` : 'Show conversations');
  }
  function fold(on) {
    folded = !!on; api.storage.set('folded', folded); if (folded && maxed) { maxed = false; api.storage.set('listMax', false); }
    api.panel.dock(!folded);
    paintFold();
  }
  function paintFold() { scene.dataset.fold = folded ? 'folded' : maxed ? 'wide' : 'open'; strip.hidden = !folded; foldBtn.hidden = folded; }
  api.listen(foldBtn, 'click', () => fold(true));
  api.listen(strip, 'click', () => fold(false));
  // Wide: the list stretches to the orb's edge (the orb stays where it is); a chat opened meanwhile uses the usual width.
  function widen(on) {
    maxed = !!on; api.storage.set('listMax', maxed);
    if (maxed && folded) fold(false); else { paintFold(); if (W) aim(); }
  }

  /* ---------- motion: one ~30 fps loop, only while the scene is in front and the page is visible ---------- */
  let running = false, lastT = 0, cancel = null, home = null, blinkAt = 3;
  /* ---------- the panels around a fixed orb ----------
   * The orb stays at the screen's centre, always (it never moves or recentres). Panels only cover the sides:
   *   - the docked list on the left (its width: --ob-col-w);
   *   - a chat in a column right beside it (--ob-chat-w), as wide as fits before the orb; on a smaller screen the
   *     orb steps down in size where it stands so the column still fits beside it;
   *   - an app in the right third (--ob-app-w), its satellite pinned between the orb and the panel.
   * The widths are worked out here (they depend on the orb's size) and handed to layout.css as variables. */
  let G = { L: 0, chatR: 0, appL: 0, k: 1, r: 0, pinX: 0, chat: null, app: null };
  const GAP = 34, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function aim() {
    if (!W) return;
    const st = api.panel.state(), r = O * .3;
    const D = defaults(), lim = limits();
    const chatNow = !!st?.chat, wide = maxed && !folded && !chatNow;
    const listW = wide ? Math.round(Math.max(D.list, W / 2 - r - GAP)) : Math.round(sized.list ? clamp(sized.list, lim.list[0], lim.list[1]) : D.list), L = folded ? STRIP : listW;
    let C = Math.round(sized.chat ? clamp(sized.chat, lim.chat[0], lim.chat[1]) : D.chat);
    let A = Math.round(sized.app ? clamp(sized.app, lim.app[0], lim.app[1]) : D.app);
    // never overlapping: the chat column gives way first, then the app panel
    const room = W - 12 - L - 8;
    if (C + A > room) { C = Math.max(lim.chat[0], room - A); if (C + A > room) A = Math.max(240, room - C); }
    const chat = st?.chat || null, app = st?.app || null;
    const chatR = L + C;
    const k = chat ? clamp((W / 2 - chatR - GAP) / r, .45, 1) : 1;   // the orb fits beside an open chat, in place
    const appL = W - 12 - A;
    const orbR = W / 2 + r * k;
    G = { L, chatR, appL, k, r, chat, app, pinX: Math.round((orbR + appL) / 2) };
    cx = W / 2;
    root.style.setProperty('--ob-col-w', listW + 'px'); root.style.setProperty('--ob-chat-w', C + 'px');
    root.style.setProperty('--ob-beside-left', L + 'px'); root.style.setProperty('--ob-app-w', A + 'px');
    const left = (folded ? STRIP : listW) + (chat ? C : 0);
    scene.style.setProperty('--ob-cx', Math.round(cx) + 'px'); scene.style.setProperty('--ob-k', k.toFixed(3));
    scene.style.setProperty('--ob-left', Math.round(left) + 'px');
    scene.style.setProperty('--ob-free', Math.round(Math.max(160, (app ? appL : W) - left)) + 'px');
    const half = Math.min(W / 2 - left, (app ? appL : W) - W / 2) - 16;   // room either side of the orb's axis
    scene.dataset.dock = half < 190 ? 'compact' : '';
    placeGrips(listW, L, C, A, !!chat, !!app);
    pinExtra();
  }
  /* ---------- resizable panels: a thin grip on the inner edge of the list, the chat column and the app panel ----------
   * Drag (or ←/→, ⇧ for bigger steps) to resize live; kept per device; a double click (or Enter) goes back to the
   * default. Limits keep each readable and the three never overlap; the orb stays where it is. */
  let sized = { ...(api.storage.get('widths') || {}) };
  const defaults = () => { const r = O * .3, L = folded ? STRIP : Math.round(clamp(W * .22, 280, 400));
    let C = W / 2 - L - r - GAP; C = C >= 360 ? Math.min(C, W / 3, 520) : clamp(W / 2 - L - r * .7 - GAP, 300, 360);
    return { list: Math.round(clamp(W * .22, 280, 400)), chat: Math.round(C), app: Math.round(Math.max(360, Math.min(W / 3 - 12, W / 2 - r - 120))) }; };
  const limits = () => ({ list: [260, 520], chat: [Math.min(360, W * .45), Math.max(360, W * .45)], app: [Math.min(360, W * .6), Math.max(360, W * .6)] });
  const grips = el('div', 'ob-grips');
  const NAMES = { list: 'Resize the conversations list', chat: 'Resize the chat', app: 'Resize the app' };
  const grip = {};
  for (const id of ['list', 'chat', 'app']) {
    const g = el('div', 'ob-grip', { role: 'separator', 'aria-orientation': 'vertical', tabindex: '0', 'aria-label': NAMES[id], title: NAMES[id] + ' · double-click: back to default', 'data-grip': id });
    g.hidden = true; grips.append(g); grip[id] = g;
    // a drag: the pointer's x against the panel's fixed edge (the list and chat grow right, the app grows left)
    let drag = null;
    const widthAt = x => id === 'list' ? x : id === 'chat' ? x - G.L : (W - 12) - x;
    api.listen(g, 'pointerdown', e => { if (e.button) return; e.preventDefault(); try { g.setPointerCapture(e.pointerId); } catch (_) {} drag = { left: grips.getBoundingClientRect().left }; g.classList.add('is-drag'); scene.dataset.resizing = id; });
    api.listen(g, 'pointermove', e => { if (!drag) return; set(id, widthAt(e.clientX - drag.left), false); });
    const end = () => { if (!drag) return; drag = null; g.classList.remove('is-drag'); delete scene.dataset.resizing; save(); };
    api.listen(g, 'pointerup', end); api.listen(g, 'pointercancel', end);
    api.listen(g, 'dblclick', () => { delete sized[id]; save(); aim(); });
    api.listen(g, 'keydown', e => {
      const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (e.key === 'Enter') { e.preventDefault(); delete sized[id]; save(); aim(); return; }
      if (!dir) return; e.preventDefault();
      const cur = id === 'list' ? G.L : id === 'chat' ? G.chatR - G.L : W - 12 - G.appL;
      set(id, cur + dir * (id === 'app' ? -1 : 1) * (e.shiftKey ? 48 : 16), true);
    });
  }
  function set(id, w, keep) { const [lo, hi] = limits()[id]; sized = { ...sized, [id]: Math.round(clamp(w, lo, hi)) }; aim(); if (keep) save(); }
  function save() { api.storage.set('widths', sized); }
  function placeGrips(listW, L, C, A, chatOpen, appOpen) {
    const lim = limits(), show = (id, on, x, now) => { const g = grip[id]; g.hidden = !on; if (!on) return;
      g.style.left = Math.round(x) + 'px'; g.setAttribute('aria-valuenow', String(Math.round(now))); g.setAttribute('aria-valuemin', String(Math.round(lim[id][0]))); g.setAttribute('aria-valuemax', String(Math.round(lim[id][1]))); };
    show('list', !folded && !(maxed && !chatOpen), L, listW); show('chat', chatOpen, L + C, C); show('app', appOpen, W - 12 - A, A);
  }
  function paintPanel() {
    const st = api.panel.state(), k = st?.kind || null;
    const sig = `${k}|${st?.list?.width || 0}|${folded}|${st?.chat ? 1 : 0}|${st?.app?.id || ''}`;
    scene.dataset.panel = k || ''; scene.dataset.chat = st?.chat ? 'open' : ''; scene.dataset.app = st?.app ? 'open' : '';
    if (W) aim();
    if (sig === panelSig) return; panelSig = sig;
    api.frame(() => { if (!W) return; aim(); if (reduced) still(); });  // the panels' places, once laid out
    api.after(480, () => { if (W) { aim(); if (reduced) still(); } });   // and once they have slid in
  }
  /* ---------- the bolts: the orb powering what is open ----------
   * Jagged lightning in the orb's colour on the sky canvas: orb → the pinned app → the app panel's edge, and a quieter
   * one orb → the chat column. Re-struck a few times a second, with a spark running along it; reduced motion = one
   * still, glowing line. */
  const bolts = { chat: 0, app: 0 };   // 0..1, eased in when a panel has arrived, out when it closes
  let boltSeed = 1, boltAt = 0;
  function jag(x1, y1, x2, y2, seed, amp) {
    let pts = [[x1, y1], [x2, y2]], a = amp, rnd = seed;
    const r = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647 - .5; };
    for (let d = 0; d < 5; d++) {
      const next = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
        const off = r() * a, mx = (ax + bx) / 2 - dy / len * off, my = (ay + by) / 2 + dx / len * off;
        next.push([mx, my], pts[i]);
      }
      pts = next; a *= .55;
    }
    // pinned at both ends: the jitter fades to nothing at the orb and at the target
    const n = pts.length - 1;
    return pts.map(([x, y], i) => { const u = i / n, t = Math.sin(Math.PI * u), bx = x1 + (x2 - x1) * u, by = y1 + (y2 - y1) * u; return [bx + (x - bx) * t, by + (y - by) * t]; });
  }
  function stroke(pts, w, col) { sx.lineWidth = w; sx.strokeStyle = col; sx.beginPath(); sx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) sx.lineTo(pts[i][0], pts[i][1]); sx.stroke(); }
  function glowAt(x, y, rad, col, a) { const g = sx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, A(col, a)); g.addColorStop(1, A(col, 0)); sx.fillStyle = g; sx.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
  function bolt(x1, y1, x2, y2, t, strength, seed, P) {
    if (strength <= .01 || Math.abs(x2 - x1) < 6) return;
    const c = P.c, len = Math.hypot(x2 - x1, y2 - y1), amp = Math.max(9, Math.min(30, len * .34));
    const main = jag(x1, y1, x2, y2, seed, amp), twin = jag(x1, y1, x2, y2, seed * 7 + 3, amp * 1.15), third = jag(x1, y1, x2, y2, seed * 13 + 5, amp * .7);
    sx.lineCap = 'round'; sx.lineJoin = 'round';
    // the air around it glows, then a faint second and third arc, then the hot core
    stroke(main, 24, A(c[0], .045 * strength)); stroke(main, 11, A(c[0], .11 * strength)); stroke(main, 5, A(c[1], .2 * strength));
    stroke(twin, 2.2, A(c[0], .35 * strength)); stroke(twin, .8, A(c[2], .5 * strength));
    stroke(third, 1.2, A(c[1], .3 * strength));
    stroke(main, 2.4, A(c[2], .85 * strength)); stroke(main, 1, A(P.white, strength));
    // short forks off the main strike
    let rnd = seed;
    const r = () => { rnd = (rnd * 48271) % 2147483647; return rnd / 2147483647; };
    for (let f = 0; f < 3; f++) {
      const i = 5 + Math.floor(r() * (main.length - 10)), [fx, fy] = main[i] || main[0], ang = (r() - .5) * 2.6 + Math.atan2(y2 - y1, x2 - x1), fl = Math.max(10, len * (.14 + r() * .18));
      const fork = jag(fx, fy, fx + Math.cos(ang) * fl, fy + Math.sin(ang) * fl, seed + f * 101, fl * .45).slice(0, 22);
      stroke(fork, 4, A(c[0], .12 * strength)); stroke(fork, .9, A(c[2], .6 * strength));
    }
    // contact: where it leaves and where it lands, and a spark of energy running along it
    glowAt(x1, y1, 16, c[1], .4 * strength); glowAt(x2, y2, 26, c[0], .5 * strength); glowAt(x2, y2, 7, P.white, .75 * strength);
    if (!reduced) { const u = (t * 1.4 + seed % 7 / 7) % 1, i = Math.floor(u * (main.length - 1)), [px, py] = main[i]; glowAt(px, py, 18, c[2], .6 * strength); glowAt(px, py, 4.5, P.white, strength); }
  }
  function drawBolts(t, dt) {
    const P = palette(colourId), cy = H * .46;
    const step = (k, on) => reduced ? (on ? 1 : 0) : Math.max(0, Math.min(1, k + (on ? dt * 2.2 : -dt * 5)));
    bolts.chat = step(bolts.chat, !!G.chat); bolts.app = step(bolts.app, !!G.app);
    if (!bolts.chat && !bolts.app) return;
    if (!reduced && t - boltAt > .09) { boltAt = t; boltSeed = 1 + (hash(boltSeed + ':' + Math.floor(t * 100)) % 2147483000); }   // a fresh strike
    const seed = reduced ? 977 : boltSeed, R = G.r * G.k * .97, flick = reduced ? 1 : .82 + .18 * Math.sin(t * 37);
    sx.save(); sx.globalCompositeOperation = 'lighter';
    if (bolts.chat) bolt(cx - R, cy, G.chatR, cy, t, bolts.chat * .62 * flick, seed + 11, P);
    if (bolts.app) {
      const s = sats.find(x => x.id === G.app?.id), half = 24 * (s?.sc || 1.1);
      if (s && s.pk > .6) {
        const pin = smooth(Math.min(1, (s.pk - .6) / .4)) * bolts.app * flick;
        bolt(cx + R, cy, s.x - half, s.y, t, pin, seed + 23, P);
        bolt(s.x + half, s.y, G.appL, cy, t, pin, seed + 41, P);
        glowAt(s.x, s.y, 46, P.c[0], .22 * pin);
      } else if (!s) bolt(cx + R, cy, G.appL, cy, t, bolts.app * flick, seed + 23, P);
    }
    sx.restore();
  }
  let panelSig = '';
  // A click on the open sky (not the orb or an app) folds the picker; the list stays.
  api.listen(scene, 'pointerdown', e => {
    if (e.button) return;
    const bare = e.target === scene || e.target === sky || e.target === field;
    if (!pop.hidden && !picker.contains(e.target)) openPop(false);
  });
  function draw(now) {
    const t = now / 1000, dt = lastT ? Math.min(.1, (now - lastT) / 1000) : 0;
    lastT = now;
    if (!size()) return;
    level += (lvlTarget - level) * .25;
    if (flash > 0) flash = Math.max(0, flash - dt * 1.5);
    const blink = t > blinkAt && t < blinkAt + .14; if (t > blinkAt + .14) blinkAt = t + 2.5 + ((hash(Math.floor(t)) % 300) / 100);
    drawSky(t, level);
    cmdK = reduced ? (cmdOn ? 1 : 0) : cmdK + ((cmdOn ? 1 : 0) - cmdK) * Math.min(1, dt * 7);
    drawOrb(ox, orbCv.width, frameOf(t, level, modeOf(voice), flash, blink, colourId, cmdK));
    if (++runN > 45) { runN = 0; paintApps(); }   // running / playing apps change without an event now and then
    placeSats(dt);
    drawBolts(t, dt);
    if (!pop.hidden && (frameN++ & 1)) previews(t);
    if (++pickN > 90) { pickN = 0; paintPick(t); }
  }
  let frameN = 0, pickN = 0, runN = 0;
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
  api.listen(globalThis, 'resize', () => { if (home) { size(); aim(); if (reduced) still(); } });

  /* ---------- visibility: the scene shows only while Home is in front ---------- */
  function paintVisible() {
    const h = !!api.route().home;
    if (h !== home) {
      home = h; root.dataset.orbScene = h ? 'home' : 'desk';
      scene.classList.toggle('is-on', h); scene.inert = !h; grips.hidden = !h;
      if (!h) openMenu(null);
      wake();
      if (h) api.frame(() => { size(); aim(); });
    }
  }
  function paint() {
    paintVisible(); paintPanel();
    if (!home) return;
    paintReady(); paintApps();
  }
  api.mount(grips);        // above the panels: the grips sit on their edges
  api.mount(menu);         // the right-click menu too (a satellite can sit beside a panel)
  api.listen(doc, 'pointerdown', e => { if (!menu.hidden && !menu.contains(e.target)) openMenu(null); }, true);
  api.panel.claim();        // no desks: the Chats list docked on the left; a thread or an app opens in the panel on the right
  api.panel.park(true);     // closing an app's panel only hides it; it keeps running (its satellite glows) until Close
  api.panel.dock(!folded);
  paintFold();
  api.desk.emptyHome();
  api.on('route', paint);
  api.on('home', paint);   // every Home repaint (live threads, outbox) lands here
  paintLook();
  paint();
  onVoice(voice);

  return () => { running = false; cancel?.(); delete root.dataset.orbScene; for (const v of ['--ob-col-w', '--ob-chat-w', '--ob-beside-left', '--ob-app-w']) root.style.removeProperty(v); };
}
