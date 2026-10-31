/* Orb layout (Miguel, 31 Oct 2026). Desktop only; worn by the miguel/orb-shell tweak, off by default.
 *
 *   Home (an empty desk, or ⌥` Home) becomes one calm scene over the skin's own wallpaper:
 *     - a living entity, not a clean circle: an irregular shape that drifts gently round the middle and follows the
 *       take and the microphone level. Three looks (picker bottom right, kept per device): Nebula (Paper Shaders'
 *       metaballs, vendored), Glitch (dithered pixels, RGB split and slice tears) and Swarm (a particle cloud).
 *       Click = talk (a new chat; click again to send). Hold = a local command (release runs it).
 *     - the owner's apps float round it at loose, wandering spots (never on the entity, the threads or the edges,
 *       never on each other), each wearing its own logo when the Store has one, else its designed glyph.
 *     - Ready threads under it, all of them, each with Snooze and Done; Working is one quiet chip ("1 working").
 *   Any open window takes over (the scene recedes; a lone window opens as a centred card); closing the last one
 *   brings it back. With windows open a small blob at the top left goes back Home.
 *
 * Motion runs only while the scene is in front and the page is visible, at 30 fps; reduced motion = still.
 * Everything goes through the layout API (core/skin-host.js); no shell internals, no second composer. */
export default function setup(api) {
  if (api.env.shell !== 'desktop') return () => {};
  const doc = document, root = doc.documentElement;
  const HOLD_MS = 420, MAX_APPS = 12;
  const SVG = 'http://www.w3.org/2000/svg';
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = (tag, cls, attrs = {}) => { const n = doc.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } return n; };
  const icon = paths => { const s = doc.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); for (const d of paths) { const p = doc.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p); } return s; };
  const I = { snooze: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z', 'M12 8v4.5l3 2'], done: ['m5 12.5 4.5 4.5L19 7.5'], apps: ['M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z'], look: ['M4 7h10M18 7h2M4 17h4M12 17h8', 'M16 5v4M10 15v4'] };
  const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return h; };
  const rng = seed => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  /* ---------- the scene ---------- */
  const scene = el('section', 'ob-scene', { 'aria-label': 'Home', 'aria-live': 'off' });
  const stageEl = el('div', 'ob-stage');
  const field = el('div', 'ob-field', { role: 'toolbar', 'aria-label': 'Apps' });
  const ent = el('div', 'ob-ent');
  const orbBtn = el('button', 'ob-orb', { type: 'button', 'aria-label': 'Talk · hold for a command' });
  const body = el('span', 'ob-body', { 'aria-hidden': 'true' });
  orbBtn.append(body);
  const name = el('div', 'ob-name');
  const state = el('div', 'ob-state', { role: 'status' });
  ent.append(orbBtn, name, state);
  stageEl.append(field, ent);
  const threads = el('div', 'ob-threads', { role: 'region', 'aria-label': 'Ready threads' });
  const hint = el('div', 'ob-hint');
  hint.append(el('span', '', { text: 'Click to talk' }), el('i', '', { 'aria-hidden': 'true' }), el('span', '', { text: 'hold for a command' }), el('i', '', { 'aria-hidden': 'true' }), el('kbd', '', { text: '⌥Space' }), el('span', '', { text: 'search' }));
  const picker = el('div', 'ob-looks', { role: 'radiogroup', 'aria-label': 'Look' });
  const out = el('button', 'ob-out', { type: 'button', title: 'Settings › Look › Tweaks: turn Orb desktop off for the classic desktop', 'aria-label': 'Classic desktop: open Settings › Look' });
  out.append(icon(I.look), el('span', '', { text: 'Classic desktop' }));
  scene.append(stageEl, threads, hint, picker, out);
  // With windows open: a small living blob at the top left goes back to the scene (⌥` still works).
  const mini = el('button', 'ob-mini', { type: 'button', title: 'Home (⌥`)', 'aria-label': 'Home' });
  mini.append(el('span', 'ob-mini-blob', { 'aria-hidden': 'true' }), el('span', 'ob-mini-dot', { 'aria-hidden': 'true' }));
  api.mount(scene); api.mount(mini);

  /* ---------- voice ---------- */
  const modeOf = v => !v || v.state === 'idle' ? 'idle' : v.state === 'think' ? 'think' : v.state === 'paused' ? 'paused' : v.command ? 'command' : 'listen';
  let voice = api.voice.state(), level = 0, lvlTarget = 0;
  api.orb.onLevel(v => { lvlTarget = Math.max(0, Math.min(1, +v || 0)); });
  const onVoice = v => {
    voice = v; const m = modeOf(v);
    scene.dataset.voice = m;
    if (m === 'idle') lvlTarget = 0;
    state.textContent = v.state === 'idle' ? '' : v.state === 'think' ? 'Sending…' : v.state === 'paused' ? 'Paused' : v.command ? 'Listening for a command · let go to run it' : 'Listening · click to send';
    wake();
  };
  api.on('voice', onVoice);
  // Click = talk / send; hold = a command take that runs on release.
  let press = null;
  api.listen(orbBtn, 'pointerdown', e => {
    if (e.button) return;
    const p = { held: false, started: null, cancel: null }; press = p;
    try { orbBtn.setPointerCapture(e.pointerId); } catch (_) {} // a hold that drifts off still ends on it
    orbBtn.classList.add('is-pressed');
    p.cancel = api.after(HOLD_MS, () => { if (press !== p || modeOf(voice) !== 'idle') return; p.held = true; p.started = Promise.resolve(api.voice.command()); });
  });
  const release = run => {
    const p = press; press = null; if (!p) return; p.cancel?.(); orbBtn.classList.remove('is-pressed');
    if (!run) return;
    if (p.held) p.started.then(r => { if (r === 'voice') api.voice.command(); });
    else api.voice.talk();
  };
  api.listen(orbBtn, 'pointerup', () => release(true));
  api.listen(orbBtn, 'pointercancel', () => release(false));
  api.listen(orbBtn, 'keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) api.voice.talk(); } });
  api.listen(orbBtn, 'contextmenu', e => e.preventDefault());

  /* ---------- the entity's looks ---------- */
  // Wizard violet on every skin (Miguel), with a cool and a warm companion; a command take leans amber.
  // The colours are skin-layer tokens (--ob-v1…5, the tweak's tweak.css); the shell accent if they are missing.
  const cssVar = n => getComputedStyle(root).getPropertyValue(n).trim();
  const palette = () => [1, 2, 3, 4, 5].map(i => cssVar('--ob-v' + i) || cssVar('--wz-accent') || 'violet');
  const dpr = () => Math.min(1.5, globalThis.devicePixelRatio || 1);
  // A smooth, irregular closed outline: r(θ) = 1 + a few slow sines (an organic, blobs-style shape, drawn in-house).
  const wob = (th, t, k = 1) => 1 + k * (.075 * Math.sin(3 * th + t * .9) + .055 * Math.sin(5 * th - t * 1.3 + 1.7) + .04 * Math.sin(2 * th + t * .6 + 4.1) + .025 * Math.sin(7 * th + t * 1.9));

  /* Nebula: Paper Shaders' metaballs (vendor/paper-shaders, Apache-2.0) on a transparent back: a cluster of soft balls
   * that merge and split, so the silhouette is never a circle. Its own loop stops while asleep or the tab is hidden. */
  function nebula(host) {
    let mount = null, dead = false, speed = .55, slept = false, last = '';
    (async () => {
      try {
        const [{ ShaderMount }, { metaballsFragmentShader }, { getShaderNoiseTexture }, { getShaderColorFromString }] = await Promise.all([
          import('./vendor/paper-shaders/shader-mount.js'), import('./vendor/paper-shaders/shaders/metaballs.js'),
          import('./vendor/paper-shaders/get-shader-noise-texture.js'), import('./vendor/paper-shaders/get-shader-color-from-string.js')]);
        const noise = getShaderNoiseTexture(); if (noise && !(noise.complete && noise.naturalWidth)) await noise.decode();
        if (dead) return;
        const colors = palette().map(c => getShaderColorFromString(c));
        mount = new ShaderMount(host, metaballsFragmentShader, {
          u_colorBack: [0, 0, 0, 0], u_colors: colors, u_colorsCount: colors.length, u_size: .88, u_count: 14, u_noiseTexture: noise,
          u_fit: 1, u_scale: .68, u_rotation: 0, u_offsetX: 0, u_offsetY: 0, u_originX: .5, u_originY: .5, u_worldWidth: 0, u_worldHeight: 0,
        }, { premultipliedAlpha: true, alpha: true }, slept || reduced ? 0 : speed, 4000, 1, 380 * 380);
        host.classList.add('is-live');
      } catch (_) { if (!dead) host.classList.add('is-flat'); }   // no WebGL2: the CSS body underneath still reads
    })();
    return {
      tick(t, lv, m) {
        if (!mount) return;
        const want = m === 'think' ? 1.6 : m === 'listen' || m === 'command' ? .9 + lv * 2.6 : .55;
        // Balls kept inside the middle two thirds (u_scale) and large enough to stay one body; louder = more of them.
        const s = Math.round((.86 + lv * .1 + (m === 'idle' ? 0 : .02)) * 100) / 100, c = m === 'think' ? 18 : m === 'idle' ? 14 : 15 + Math.round(lv * 4);
        const k = `${s}|${c}`; if (k !== last) { last = k; mount.setUniforms({ u_size: s, u_count: c }); }
        if (Math.abs(want - speed) > .05) { speed = want; mount.setSpeed(speed); }
      },
      sleep(v) { slept = v; mount?.setSpeed(v || reduced ? 0 : speed); },
      destroy() { dead = true; mount?.dispose(); host.replaceChildren(); },
    };
  }

  /* Glitch, in the spirit of Archimedes' glitch look: a dithered pixel entity with an RGB split, scanlines and
   * sliced tears that fire more often while it listens (PowerGlitch's slice / shake idea, done in one small canvas). */
  function glitch(host) {
    const cv = el('canvas'), N = 84, img = new ImageData(N, N), d = img.data;
    const low = el('canvas'); low.width = low.height = N; const lc = low.getContext('2d');
    host.append(cv); const ctx = cv.getContext('2d');
    const B = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];   // 4×4 Bayer matrix
    const rowShift = new Float32Array(N); let tear = 0, tearAt = 1.5, seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const fit = () => { const s = Math.round(host.clientWidth * dpr()); if (s && cv.width !== s) cv.width = cv.height = s; };
    function draw(t, lv, m) {
      fit(); if (!cv.width) return;
      const k = 1 + lv * .9 + (m === 'think' ? .4 : 0), split = 1.2 + lv * 4 + (tear > 0 ? 3 : 0);
      if (t > tearAt || t < tearAt - 10) {
        tear = .16 + rnd() * .22; tearAt = t + (m === 'listen' || m === 'command' ? .5 + rnd() * 1.2 : 1.8 + rnd() * 3.4);
        rowShift.fill(0);
        for (let b = 0; b < 4; b++) { const y = Math.floor(rnd() * N), h = 1 + Math.floor(rnd() * 7), dx = (rnd() - .5) * 16; for (let j = 0; j < h && y + j < N; j++) rowShift[y + j] = dx; }
      }
      const tearing = tear > 0; tear = Math.max(0, tear - 1 / 30);
      const amber = m === 'command';
      const sample = (x, y) => {
        const dx = (x - N / 2) / (N * .36), dy = (y - N / 2) / (N * .36), r = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
        const edge = wob(th, t * 1.4, k);
        if (r > edge) return -1;
        // a banded body (the dither shows everywhere), a hot core that pulses with the voice
        return Math.max(0, .2 + (1 - r / edge) ** 1.25 * (.95 + lv * .5) + .14 * Math.sin(th * 4 + t * 2 + r * 9) + .08 * Math.sin(y * .9 + t * 6));
      };
      for (let y = 0; y < N; y++) {
        const sh = tearing ? rowShift[y] : 0, scan = y % 3 === 2 ? .5 : 1;
        for (let x = 0; x < N; x++) {
          const xs = x - sh, th = B[(y & 3) * 4 + (x & 3)] / 16;
          const vg = sample(xs, y), r = sample(xs - split, y) > th ? 1 : 0, g = vg > th ? 1 : 0, b = sample(xs + split, y) > th ? 1 : 0;
          const i = (y * N + x) * 4;
          // two-tone dither: lit pixels in violet with magenta / cyan fringes, the rest of the body in deep ink, so the
          // shape holds on light and photo skins too
          if (!r && !g && !b) { const ink = vg >= 0; d[i] = 34; d[i + 1] = 16; d[i + 2] = 64; d[i + 3] = ink ? (scan < 1 ? 120 : 200) : 0; continue; }
          // violet body; the split edges show magenta and cyan fringes
          d[i] = (amber ? 255 : 196) * r * scan; d[i + 1] = (amber ? 176 : 150) * g * scan * (r && b ? 1 : .55); d[i + 2] = (amber ? 60 : 255) * b * scan;
          d[i + 3] = 255;
        }
      }
      lc.putImageData(img, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(low, 0, 0, cv.width, cv.height);
    }
    return { tick: draw, still: draw, sleep() {}, destroy() { host.replaceChildren(); } };
  }

  /* Swarm: a cloud of motes circling an irregular, breathing centre; near neighbours link faintly (constellation
   * style). Louder speech spreads it out; sending pulls it into a tight spin. */
  function swarm(host) {
    const cv = el('canvas'); host.append(cv); const ctx = cv.getContext('2d'), PALETTE = palette();
    const R = rng(42), P = Array.from({ length: 190 }, () => ({ a: R() * Math.PI * 2, r: .25 + R() * .75, s: (.12 + R() * .35) * (R() < .5 ? -1 : 1), z: R(), p: R() * 9, c: PALETTE[Math.floor(R() * PALETTE.length)] }));
    const fit = () => { const s = Math.round(host.clientWidth * dpr()); if (s && cv.width !== s) cv.width = cv.height = s; };
    function draw(t, lv, m) {
      fit(); const S = cv.width; if (!S) return;
      ctx.clearRect(0, 0, S, S);
      const C = S / 2, spread = (m === 'think' ? .62 : 1) * (1 + lv * .45), spin = m === 'think' ? 2.4 : 1 + lv * 1.5;
      const pts = P.map(q => {
        const a = q.a + t * q.s * spin, rr = q.r * wob(a, t, 1.4) * spread;
        return [C + Math.cos(a) * rr * S * .3 + Math.sin(t * .7 + q.p) * S * .02, C + Math.sin(a) * rr * S * .27 + Math.cos(t * .5 + q.p) * S * .02, q];
      });
      // additive light on dark skins; plain ink on light ones (adding violet to a bright photo washes it out)
      const light = /-light$/.test(root.dataset.skin || '');
      ctx.globalCompositeOperation = light ? 'source-over' : 'lighter'; ctx.lineWidth = Math.max(1, S / 420); ctx.strokeStyle = PALETTE[light ? 2 : 1];
      const near = (S * .085) ** 2;
      for (let i = 0; i < pts.length; i += 2) for (let j = i + 1; j < pts.length; j += 3) {
        const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1], dd = dx * dx + dy * dy;
        if (dd < near) { ctx.globalAlpha = .22 * (1 - dd / near); ctx.beginPath(); ctx.moveTo(pts[i][0], pts[i][1]); ctx.lineTo(pts[j][0], pts[j][1]); ctx.stroke(); }
      }
      for (const [x, y, q] of pts) { const s = (1.3 + q.z * 2.4) * (S / 300) * (1 + lv * .5); ctx.fillStyle = q.c; ctx.globalAlpha = .55 + q.z * .45; ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    return { tick: draw, still: draw, sleep() {}, destroy() { host.replaceChildren(); } };
  }

  const LOOKS = [['nebula', 'Nebula', nebula], ['glitch', 'Glitch', glitch], ['swarm', 'Swarm', swarm]];
  const stored = api.storage.get('look');
  let look = null, lookId = LOOKS.some(l => l[0] === stored) ? stored : 'nebula';
  function useLook(id) {
    const L = LOOKS.find(l => l[0] === id) || LOOKS[0]; lookId = L[0];
    look?.destroy(); body.replaceChildren(); body.className = 'ob-body'; ent.dataset.look = lookId;
    look = L[2](body);
    for (const b of picker.children) b.setAttribute('aria-checked', String(b.dataset.look === lookId));
    look.sleep(!home); wake();
  }
  for (const [id, label] of LOOKS) {
    const b = el('button', 'ob-look', { type: 'button', role: 'radio', 'data-look': id, 'aria-checked': 'false', title: `Look: ${label}` });
    b.append(el('i', 'ob-look-sw', { 'aria-hidden': 'true' }), el('span', '', { text: label }));
    api.listen(b, 'click', () => { if (id !== lookId) { api.storage.set('look', id); useLook(id); } });
    picker.append(b);
  }

  /* ---------- apps float round it ---------- */
  // The app's own logo first (the Store's picture of it); its designed glyph otherwise; never a bare letter.
  const GUESS = [[/crm|contact|people|profile/i, 'profile'], [/command|console|terminal/i, 'console'], [/board|\bpr\b|project|kanban/i, 'projects'], [/money|bank|finance|monarch|simplefin|teller/i, 'dollar'],
    [/health|whoop|fit/i, 'gauge'], [/music|tube|audio|podcast/i, 'music'], [/mail|google/i, 'mail'], [/home|house/i, 'home'], [/backup|cloud/i, 'cloud'], [/twitter|social|\bx\b/i, 'social'], [/data|web|bright/i, 'globe']];
  const glyphOf = a => { const m = /sg-([a-z-]+)/.exec(a.icon || ''); return m && !/\bsgl\b/.test(a.icon || '') ? m[1] : (GUESS.find(([re]) => re.test(a.id + ' ' + a.name)) || [0, 'spark'])[1]; };
  const colourOf = a => (/--c:\s*([^;"]+)/.exec(a.icon || '') || [0, 'var(--wz-accent)'])[1].trim();
  let appSig = '', tiles = [];
  function tile(a) {
    const b = el('button', 'ob-app', { type: 'button', title: a.name, 'aria-label': 'Open ' + a.name });
    const face = el('span', 'ob-tile'); face.style.setProperty('--c', colourOf(a));
    if (/\bsglogo\b/.test(a.icon || '')) { const tpl = doc.createElement('template'); tpl.innerHTML = a.icon; face.append(tpl.content); face.classList.add('is-logo'); } // shell-made logo markup (WizSigil)
    else { face.append(el('i', `sgi sg-${glyphOf(a)}`, { 'aria-hidden': 'true' })); face.classList.add('is-glyph'); }
    b.append(face, el('span', 'ob-app-n', { text: a.name }));
    api.listen(b, 'click', () => api.apps.open(a.id));
    api.apps.logo(a.id).then(url => {
      if (!url) return;
      const im = el('img', 'ob-logo', { alt: '', src: url, draggable: 'false' });
      im.decode().then(() => { face.replaceChildren(im); face.classList.remove('is-glyph'); face.classList.add('is-logo'); }, () => {});
    });
    return b;
  }
  function paintApps() {
    const apps = api.apps.list().slice(0, MAX_APPS), sig = apps.map(a => a.id + ':' + a.name + ':' + a.icon.length).join('|');
    if (sig === appSig) return; appSig = sig;
    const items = apps.map(a => ({ id: a.id, el: tile(a) }));
    const all = el('button', 'ob-app ob-all', { type: 'button', title: 'All apps (⌥O)', 'aria-label': 'All apps' });
    const f = el('span', 'ob-tile is-all'); f.append(icon(I.apps)); all.append(f, el('span', 'ob-app-n', { text: 'All apps' }));
    api.listen(all, 'click', () => api.apps.all());
    items.push({ id: '~all', el: all });
    field.replaceChildren(...items.map(i => i.el));
    tiles = items.map(i => { const r = rng(hash(i.id)); return { ...i, x: 0, y: 0, ph: r() * 6.3, ph2: r() * 6.3, w1: .11 + r() * .09, w2: .08 + r() * .08, ax: 9 + r() * 9, ay: 7 + r() * 8 }; });
    place();
  }
  // Loose spots, chosen per app (seeded by its id) and again on resize: inside the stage, off the entity's whole drift
  // area and the words under it, off the edges, at least a tile and a gap from every other app.
  let W = 0, H = 0, drift = { ax: 0, ay: 0, r: 0 };
  function measure() {
    W = stageEl.clientWidth; H = stageEl.clientHeight;
    drift = { ax: reduced ? 0 : Math.min(W * .07, 110), ay: reduced ? 0 : Math.min(H * .05, 30), r: orbBtn.offsetWidth / 2 || 120 };
  }
  function place() {
    measure(); if (!W || !H || !tiles.length) return;
    const T = 56, gap = 30, edge = 36, top = 14, bottom = 8;
    const ex = drift.r + drift.ax + T * .55, ey = drift.r + drift.ay + T * .45, eyDown = ey + 40;   // name + state under it
    const inEnt = (x, y) => { const cx = x + T / 2 - W / 2, cy = y + T / 2 - H / 2; return (cx / ex) ** 2 + (cy / (cy > 0 ? eyDown : ey)) ** 2 < 1; };
    const done = [];
    for (const t of tiles) {
      // Best of a few random candidates (the one farthest from every app already placed): loose and uneven like
      // the mockup, but spread over the whole stage instead of bunching on one side.
      const r = rng(hash(t.id) ^ (W * 7 + H * 13));
      let spot = null, far = -1;
      for (let i = 0, found = 0; i < 600 && found < 14; i++) {
        const x = edge + r() * (W - 2 * edge - T), y = top + r() * (H - top - bottom - T);
        if (inEnt(x, y)) continue;
        const dd = done.length ? Math.min(...done.map(o => Math.hypot(o.x - x, o.y - y))) : 1e9;
        if (dd <= T + gap) continue;
        found++; const score = Math.min(dd, 1e6) + r() * 40;
        if (score > far) { far = score; spot = { x, y }; }
      }
      // A crowded small window: the least-crowded free spot on a grid, so nothing ever sits on the entity.
      if (!spot) {
        let bd = -1;
        for (let y = top; y < H - T - bottom; y += 12) for (let x = edge; x < W - T - edge; x += 12) {
          if (inEnt(x, y)) continue; const dd = done.length ? Math.min(...done.map(o => Math.hypot(o.x - x, o.y - y))) : 1e9;
          if (dd > bd) { bd = dd; spot = { x, y }; }
        }
        spot ||= { x: edge, y: top };
      }
      t.x = spot.x; t.y = spot.y; done.push(spot);
    }
    tick(performance.now(), true);
  }

  /* ---------- Ready threads, Working as one quiet chip ---------- */
  let threadSig = '', workOpen = false;
  const head = el('div', 'ob-th-head');
  const readyTitle = el('span', 'ob-th-title');
  const workChip = el('button', 'ob-working', { type: 'button', 'aria-expanded': 'false' }); workChip.hidden = true;
  const workPop = el('div', 'ob-work-pop', { role: 'list', 'aria-label': 'Working' }); workPop.hidden = true;
  const list = el('div', 'ob-ready', { role: 'list', 'aria-label': 'Ready' });
  head.append(readyTitle, workChip);
  threads.append(workPop, head, list);
  const closeWork = () => { workOpen = false; workPop.hidden = true; workChip.setAttribute('aria-expanded', 'false'); };
  api.listen(workChip, 'click', () => { workOpen = !workOpen; workPop.hidden = !workOpen; workChip.setAttribute('aria-expanded', String(workOpen)); });
  function pill(s) {
    const row = el('div', 'ob-pill is-ready' + (s.needs ? ' is-needs' : '') + (s.unread ? ' is-new' : ''), { role: 'listitem' });
    const open = el('button', 'ob-pill-open', { type: 'button', title: s.title, 'aria-label': `${s.needs ? 'Needs you' : 'Ready'}: ${s.title}` });
    open.append(el('span', 'ob-pill-mark', { 'aria-hidden': 'true' }), el('span', 'ob-pill-t', { text: s.title }));
    api.listen(open, 'click', () => api.sessions.open(s.id));
    row.append(open);
    for (const act of s.actions) {
      const b = el('button', 'ob-act is-' + act, { type: 'button', title: act === 'done' ? 'Done' : 'Snooze', 'aria-label': `${act === 'done' ? 'Done' : 'Snooze'}: ${s.title}` });
      b.append(icon(I[act]), el('span', '', { text: act === 'done' ? 'Done' : 'Snooze' }));
      api.listen(b, 'click', e => { e.stopPropagation(); row.classList.add('is-leaving'); api.sessions.act(s.id, act); });
      row.append(b);
    }
    return row;
  }
  function paintThreads() {
    const L = api.sessions.list();
    if (!L) { if (threadSig !== 'off') { threadSig = 'off'; readyTitle.textContent = ''; workChip.hidden = true; list.replaceChildren(el('div', 'ob-quiet', { text: 'Connecting…' })); } return; }
    const ready = L.ready.filter(s => !s.snoozed), working = L.working;
    const sig = JSON.stringify([ready.map(s => [s.id, s.title, s.needs, s.unread, s.actions]), working.map(s => [s.id, s.title])]);
    if (sig === threadSig) return; threadSig = sig;
    readyTitle.replaceChildren(...(ready.length ? [el('span', '', { text: 'Ready' }), el('b', '', { text: String(ready.length) })] : []));
    list.replaceChildren(...(ready.length ? ready.map(pill) : [el('div', 'ob-quiet', { text: 'Nothing waiting for you' })]));
    workChip.hidden = !working.length;
    workChip.replaceChildren(el('span', 'ob-spin', { 'aria-hidden': 'true' }), el('span', '', { text: `${working.length} working` }));
    workChip.setAttribute('aria-label', `${working.length} working: show them`);
    const rows = working.map(s => { const b = el('button', 'ob-work-row', { type: 'button', role: 'listitem', title: s.title }); b.append(el('span', 'ob-spin', { 'aria-hidden': 'true' }), el('span', 'ob-pill-t', { text: s.title })); api.listen(b, 'click', () => api.sessions.open(s.id)); return b; });
    const all = el('button', 'ob-work-all', { type: 'button', text: 'Open the Working list' }); api.listen(all, 'click', () => api.sessions.openList('working'));
    workPop.replaceChildren(...rows, all);
    if (!working.length && workOpen) closeWork();
    const needs = ready.some(s => s.needs || s.unread);
    mini.classList.toggle('has-news', needs);
    mini.setAttribute('aria-label', needs ? 'Home · something is ready for you' : 'Home');
  }

  /* ---------- motion: one 30 fps loop, only while the scene is in front and the page is visible ---------- */
  let running = false, lastT = 0, cancel = null, home = null;
  function tick(now, still = false) {
    const t = now / 1000;
    level += (lvlTarget - level) * .25;
    const dx = drift.ax * (.62 * Math.sin(t * .071 + .4) + .38 * Math.sin(t * .113 + 2.1)), dy = drift.ay * (.6 * Math.sin(t * .089 + 1.3) + .4 * Math.sin(t * .137 + 4.4));
    ent.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px))`;
    body.style.setProperty('--lvl', level.toFixed(3));
    for (const p of tiles) {
      const ox = reduced ? 0 : p.ax * Math.sin(t * p.w1 + p.ph), oy = reduced ? 0 : p.ay * Math.cos(t * p.w2 + p.ph2);
      p.el.style.transform = `translate(${(p.x + ox).toFixed(1)}px, ${(p.y + oy).toFixed(1)}px)`;
    }
    if (!still) look?.tick(t, level, modeOf(voice));
  }
  function loop(now) {
    cancel = null; if (!running) return;
    if (now - lastT >= 33) { lastT = now; tick(now); }
    cancel = api.frame(loop);
  }
  function wake() {
    const awake = !!home && !doc.hidden;
    look?.sleep(!awake);
    if (awake && !reduced && !running) { running = true; cancel = api.frame(loop); }
    else if ((!awake || reduced) && running) { running = false; cancel?.(); cancel = null; }
    if (reduced && awake) api.frame(now => { tick(now, true); look?.still?.(4, 0, modeOf(voice)); });
  }
  api.listen(doc, 'visibilitychange', wake);
  api.listen(globalThis, 'resize', () => { if (home) place(); });

  /* ---------- visibility: the scene shows only while Home is in front ---------- */
  function paintVisible() {
    const h = !!api.route().home;
    if (h !== home) {
      home = h; root.dataset.orbScene = h ? 'home' : 'desk';
      scene.classList.toggle('is-on', h); scene.inert = !h;
      mini.hidden = h;
      if (!h && workOpen) closeWork();
      wake();
    }
  }
  function paint() {
    paintVisible();
    if (!home) return;
    name.textContent = api.agents.here()?.label || 'Wizard';
    paintThreads(); paintApps();
    if (stageEl.clientWidth !== W || stageEl.clientHeight !== H) place();
  }
  api.desk.emptyHome();     // no desk numbers here: closing the last window of a desk comes back to the entity
  api.listen(out, 'click', () => api.desk.look());
  api.listen(mini, 'click', () => api.desk.home());
  api.on('route', paint);
  api.on('home', paint);   // every Home repaint (live threads, outbox) lands here
  paint();
  useLook(lookId);
  onVoice(voice);

  return () => { running = false; cancel?.(); look?.destroy(); delete root.dataset.orbScene; };
}
