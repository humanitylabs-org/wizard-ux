/* Orb layout (Miguel, 31 Oct 2026). Desktop only; worn by the miguel/orb-shell tweak, off by default.
 *
 *   Home (an empty desk, or ⌥` Home) becomes the scene of the approved concept (Files › Pages › orb-shell-concept),
 *   ported as it was drawn there:
 *     - a dark starfield sky with a soft glow behind the orb, over the skin's wallpaper (the same calm night scene on
 *       light and dark skins);
 *     - the concept's glassy orb in the middle (inner swirling colour, halo, listening rings, a sharp ring when a command
 *       runs), following the real take (voice events) and the mic level (api.orb.onLevel). Four looks from the
 *       concept, picked by a quiet swatch row bottom right and kept per device: Nebula, Ember, Tide, Oracle (a face).
 *       Click = talk (a new chat; click again to send). Hold = a local command (release runs it).
 *     - the owner's apps as round glass satellites on two tilted orbits (front bigger and brighter, behind dimmer),
 *       drifting slowly; the label shows on hover; a click opens the app. The app's own logo, else its glyph.
 *     - under the orb: its name, a caption line (what the take is doing), then the conversations as the concept's
 *       pills: every Ready thread glows amber (Snooze and Done on hover), at most two rows then "+N more" (the Ready
 *       list); Working is one quiet spinner pill ("1 working").
 *     - the real keys as the hint line near the bottom.
 *   Any open window takes over (the scene recedes); closing the last one brings it back. With windows open a small orb
 *   at the top left goes back Home.
 *
 * Motion runs only while the scene is in front and the page is visible, at about 30 fps; reduced motion = still frames.
 * Colours are skin-layer tokens (--ob-*, the wearing tweak's tweak.css), read lazily. Everything goes through the
 * layout API (core/skin-host.js); no shell internals, no second composer. */
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
  const picker = el('div', 'ob-looks', { role: 'radiogroup', 'aria-label': 'Orb look' });
  scene.append(sky, field, orbWrap, name, caption, threads, hint, picker);
  // With windows open: a small orb at the top left goes back to the scene (⌥` still works).
  const mini = el('button', 'ob-mini', { type: 'button', title: 'Home (⌥`)', 'aria-label': 'Home' });
  mini.append(el('span', 'ob-mini-orb', { 'aria-hidden': 'true' }), el('span', 'ob-mini-dot', { 'aria-hidden': 'true' }));
  api.mount(scene); api.mount(mini);

  /* ---------- colours: skin-layer tokens, normalised to #rrggbb so alpha can be appended ---------- */
  const probe = el('canvas').getContext('2d');
  const norm = c => { if (!c || !probe) return ''; probe.fillStyle = 'black'; probe.fillStyle = c; const v = probe.fillStyle; return /^#[0-9a-f]{6}$/i.test(v) ? v : ''; };
  const cssVar = n => getComputedStyle(root).getPropertyValue(n).trim();
  const tokens = { at: -1e9 };
  function colours(look) {
    const now = performance.now();
    if (tokens.look === look && tokens.ok && now - tokens.at < 5000) return tokens;
    const list = cssVar('--ob-look-' + look).split(',').map(s => norm(s.trim())).filter(Boolean);
    const acc = norm(cssVar('--ob-v1')) || norm(cssVar('--wz-accent')) || norm('slateblue');   // tokens not loaded yet
    Object.assign(tokens, { look, at: now, ok: list.length >= 4, c: list.length >= 4 ? list.slice(0, 4) : [acc, acc, acc, acc],
      white: norm(cssVar('--ob-white')) || norm('white'), core: norm(cssVar('--ob-core')) || norm('black'), face: norm(cssVar('--ob-face')) || norm('white') });
    return tokens;
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

  /* ---------- sky + orb, drawn like the concept ---------- */
  const LOOKS = [['nebula', 'Nebula'], ['ember', 'Ember'], ['tide', 'Tide'], ['oracle', 'Oracle']];
  const stored = api.storage.get('look');
  let lookId = LOOKS.some(l => l[0] === stored) ? stored : 'nebula';
  const sx = sky.getContext('2d'), ox = orbCv.getContext('2d');
  let W = 0, H = 0, DPR = 1, O = 300, stars = [];
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
    placeSats(0); fitThreads();
    return true;
  }
  function drawSky(t, lv) {
    const P = colours(lookId), c = P.c, cx = W / 2, cy = H * .46;
    sx.clearRect(0, 0, W, H);
    const g = sx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * .7);
    g.addColorStop(0, A(c[0], .16 + lv * .1)); g.addColorStop(.35, A(c[1], .05)); g.addColorStop(1, 'transparent');
    sx.fillStyle = g; sx.fillRect(0, 0, W, H);
    sx.fillStyle = P.white;
    for (const s of stars) { sx.globalAlpha = .25 + .45 * (.5 + .5 * Math.sin(t * s.s + s.p)); sx.beginPath(); sx.arc(s.x, s.y, s.r, 0, 7); sx.fill(); }
    sx.globalAlpha = 1;
  }
  function drawOrb(ctx, px, t, lv, state, fl, blink) {
    const P = colours(lookId), c = P.c, face = lookId === 'oracle', cx = px / 2, cy = px / 2;
    const breathe = 1 + Math.sin(t * 1.3) * .015;
    const R = px * .3 * breathe * (1 + lv * .12 + (state === 'listening' ? .05 : 0));
    ctx.clearRect(0, 0, px, px);
    // halo
    const halo = ctx.createRadialGradient(cx, cy, R * .6, cx, cy, R * 1.65);
    halo.addColorStop(0, A(c[0], .5 + lv * .3)); halo.addColorStop(.5, A(c[1], .12)); halo.addColorStop(1, 'transparent');
    ctx.fillStyle = halo; ctx.fillRect(0, 0, px, px);
    // listening waves
    if (state === 'listening') for (let i = 0; i < 3; i++) {
      const k = (t * .9 + i / 3) % 1; ctx.strokeStyle = A(c[2], (1 - k) * .45); ctx.lineWidth = px * .004;
      ctx.beginPath(); ctx.arc(cx, cy, R * (1.05 + k * .55), 0, 7); ctx.stroke();
    }
    // body
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();
    const base = ctx.createRadialGradient(cx, cy - R * .3, R * .1, cx, cy, R);
    base.addColorStop(0, A(c[0], .55)); base.addColorStop(1, P.core); ctx.fillStyle = base; ctx.fillRect(0, 0, px, px);
    ctx.globalCompositeOperation = 'screen';
    const spin = state === 'thinking' ? 3.2 : state === 'listening' ? 1.8 : 1;
    for (let i = 0; i < 5; i++) {
      const a = t * .35 * spin * (i % 2 ? 1 : -1.2) + i * 1.26;
      const rr = R * (.38 + .12 * Math.sin(t * .7 + i));
      const bx = cx + Math.cos(a) * rr, by = cy + Math.sin(a * 1.3) * rr * .8;
      const br = R * (.55 + .1 * Math.sin(t + i * 2) + lv * .2);
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, A(c[i % 4], .75)); g.addColorStop(1, A(c[i % 4], 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, br, 0, 7); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // glass highlight
    const hl = ctx.createRadialGradient(cx - R * .35, cy - R * .45, 0, cx - R * .35, cy - R * .45, R * .7);
    hl.addColorStop(0, A(P.white, .28)); hl.addColorStop(1, A(P.white, 0)); ctx.fillStyle = hl; ctx.fillRect(0, 0, px, px);
    // Oracle: calm eyes and a mouth that moves with the voice
    if (face) {
      ctx.strokeStyle = A(P.face, .92); ctx.lineCap = 'round'; ctx.lineWidth = px * .009;
      ctx.shadowColor = P.face; ctx.shadowBlur = px * .03;
      const ey = cy - R * .12, ex = R * .3, open = blink ? .02 : (state === 'listening' ? .16 : .1);
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * ex, ey, R * .13, R * open, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); }
      const mo = state === 'listening' ? R * (.02 + .08 * lv) : state === 'thinking' ? R * (.03 + .03 * Math.abs(Math.sin(t * 6))) : R * .012;
      ctx.beginPath(); ctx.ellipse(cx, cy + R * .32, R * .16, mo, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
    // rim
    ctx.strokeStyle = A(c[3], .35 + lv * .3); ctx.lineWidth = px * .004; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    // command flash: one sharp ring that says "doing it"
    if (fl > 0) { ctx.strokeStyle = A(P.white, fl * .9); ctx.lineWidth = px * .006 * fl; ctx.beginPath(); ctx.arc(cx, cy, R * (1 + (1 - fl) * .9), 0, 7); ctx.stroke(); }
  }
  function useLook(id) {
    lookId = LOOKS.some(l => l[0] === id) ? id : 'nebula'; tokens.look = '';
    scene.dataset.look = lookId; mini.dataset.look = lookId;
    for (const b of picker.children) b.setAttribute('aria-checked', String(b.dataset.look === lookId));
    if (reduced) still();
  }
  for (const [id, label] of LOOKS) {
    const b = el('button', 'ob-look', { type: 'button', role: 'radio', 'data-look': id, 'aria-checked': 'false', title: label, 'aria-label': 'Orb look: ' + label });
    api.listen(b, 'click', () => { if (id !== lookId) { api.storage.set('look', id); useLook(id); } });
    picker.append(b);
  }

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
    const cx = W / 2, cy = H * .46;
    for (const s of sats) {
      if (!reduced) s.a += s.speed * dt;
      const rx = O * 1.65 * s.ring / 1.32, ry = rx * .34;
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
    const news = ready.some(s => s.needs || s.unread);
    mini.classList.toggle('has-news', news);
    mini.setAttribute('aria-label', news ? 'Home · something is ready for you' : 'Home');
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
  function draw(now) {
    const t = now / 1000, dt = lastT ? Math.min(.1, (now - lastT) / 1000) : 0;
    lastT = now;
    if (!size()) return;
    level += (lvlTarget - level) * .25;
    if (flash > 0) flash = Math.max(0, flash - dt * 1.5);
    const blink = t > blinkAt && t < blinkAt + .14; if (t > blinkAt + .14) blinkAt = t + 2.5 + ((hash(Math.floor(t)) % 300) / 100);
    drawSky(t, level);
    drawOrb(ox, orbCv.width, t, level, modeOf(voice), flash, blink);
    placeSats(dt);
  }
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
      mini.hidden = h;
      wake();
      if (h) api.frame(() => { size(); fitThreads(); });
    }
  }
  function paint() {
    paintVisible();
    if (!home) return;
    name.textContent = api.agents.here()?.label || 'Wizard';
    paintThreads(); paintApps();
  }
  api.desk.emptyHome();     // no desk numbers here: closing the last window of a desk comes back to the orb
  api.listen(mini, 'click', () => api.desk.home());
  api.on('route', paint);
  api.on('home', paint);   // every Home repaint (live threads, outbox) lands here
  useLook(lookId);
  paint();
  onVoice(voice);

  return () => { running = false; cancel?.(); delete root.dataset.orbScene; };
}
