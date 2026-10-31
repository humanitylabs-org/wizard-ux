/* Orb layout (Miguel, 31 Oct 2026). Desktop only; worn by the miguel/orb-shell tweak, off by default.
 *
 *   Home (an empty desk, or ⌥` Home) becomes one calm scene over the skin's own wallpaper:
 *     - the shell's real orb (orb.js, the same one as the phone dock) large in the middle, following the take and
 *       the microphone level. Click = talk (a new chat; click again to send). Hold = a local command (release runs
 *       it), the classic "tap to talk, hold for a command".
 *     - the owner's quick apps (Home's app chips) orbit it; a click opens the app in its normal window. The last
 *       one opens every app (⌥O).
 *     - Working and Ready threads sit under it as pills: a spinner while working, amber when one needs you. A pill
 *       opens the thread in the stock Chats window; Snooze and Done run Chats' own actions.
 *   Any open window takes over (the scene recedes); closing the last one brings it back. With windows open a small
 *   orb at the top left goes back Home. The bar keeps only what still matters: the AI fuel gauge, updates and
 *   Settings (where Settings › Look › Tweaks turns this off).
 *
 * Everything goes through the layout API (core/skin-host.js); no shell internals, no second composer. */
export default function setup(api) {
  if (api.env.shell !== 'desktop') return () => {};
  const doc = document, root = doc.documentElement;
  const HOLD_MS = 420, MAX_APPS = 11, MAX_READY = 4, MAX_WORKING = 2;
  const SVG = 'http://www.w3.org/2000/svg';
  const el = (tag, cls, attrs = {}) => { const n = doc.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } return n; };
  const icon = paths => { const s = doc.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); for (const d of paths) { const p = doc.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p); } return s; };
  const I = { snooze: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z', 'M12 8v4.5l3 2'], done: ['m5 12.5 4.5 4.5L19 7.5'], apps: ['M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z'], look: ['M4 7h10M18 7h2M4 17h4M12 17h8', 'M16 5v4M10 15v4'] };

  /* ---------- the scene ---------- */
  const scene = el('section', 'ob-scene', { 'aria-label': 'Home', 'aria-live': 'off' });
  const stageEl = el('div', 'ob-stage');
  const orbit = el('div', 'ob-orbit', { role: 'toolbar', 'aria-label': 'Apps' });
  const orbBtn = el('button', 'ob-orb', { type: 'button', 'aria-label': 'Talk · hold for a command' });
  const glass = el('span', 'ob-glass', { 'aria-hidden': 'true' });
  const cv = el('canvas', 'ob-cv'); cv.width = 256; cv.height = 256;
  const fb = el('img', 'ob-fb', { alt: '', src: 'robert-thread-orb.png' }); fb.hidden = true;
  glass.append(cv, fb); orbBtn.append(glass);
  const name = el('div', 'ob-name');
  const state = el('div', 'ob-state', { role: 'status' });
  stageEl.append(orbit, orbBtn, name, state);
  const threads = el('div', 'ob-threads', { role: 'list', 'aria-label': 'Working and ready' });
  const hint = el('div', 'ob-hint');
  hint.append(el('span', '', { text: 'Click the orb to talk' }), el('i', '', { 'aria-hidden': 'true' }), el('span', '', { text: 'hold it for a command' }), el('i', '', { 'aria-hidden': 'true' }), el('kbd', '', { text: '⌥Space' }), el('span', '', { text: 'search' }));
  const out = el('button', 'ob-out', { type: 'button', title: 'Settings › Look › Tweaks: turn Orb desktop off for the classic desktop', 'aria-label': 'Classic desktop: open Settings › Look' });
  out.append(icon(I.look), el('span', '', { text: 'Classic desktop' }));
  scene.append(stageEl, threads, hint, out);
  // With windows open: a small orb top left goes back to the scene (⌥` still works).
  const mini = el('button', 'ob-mini', { type: 'button', title: 'Home (⌥`)', 'aria-label': 'Home' });
  mini.append(el('span', 'ob-mini-orb', { 'aria-hidden': 'true' }), el('span', 'ob-mini-dot', { 'aria-hidden': 'true' }));
  api.mount(scene); api.mount(mini);

  /* ---------- the orb: the shell's own orb.js ---------- */
  let eng = null;
  const modeOf = v => !v || v.state === 'idle' ? 'idle' : v.state === 'think' ? 'think' : v.state === 'paused' ? 'paused' : v.command ? 'command' : 'listen';
  let voice = api.voice.state();
  api.orb.ready().then(ok => {
    if (!ok || eng) return;
    eng = api.orb.create(cv, fb, { R: .62 });
    if (!eng) { glass.classList.add('flat'); return; }
    eng.setMode(modeOf(voice)); paintVisible();
  });
  api.orb.onLevel(v => eng?.setLevel(v));
  api.on('voice', v => {
    voice = v; eng?.setMode(modeOf(v));
    scene.dataset.voice = modeOf(v);
    state.textContent = v.state === 'idle' ? '' : v.state === 'think' ? 'Sending…' : v.state === 'paused' ? 'Paused' : v.command ? 'Listening for a command · let go to run it' : 'Listening · click to send';
  });
  // Click = talk / send; hold = a command take that runs on release.
  let press = null;
  api.listen(orbBtn, 'pointerdown', e => {
    if (e.button) return;
    const p = { held: false, started: null, cancel: null }; press = p;
    try { orbBtn.setPointerCapture(e.pointerId); } catch (_) {} // a hold that drifts off the orb still ends on it
    eng?.press(true);
    p.cancel = api.after(HOLD_MS, () => { if (press !== p || modeOf(voice) !== 'idle') return; p.held = true; p.started = Promise.resolve(api.voice.command()); });
  });
  const release = run => {
    const p = press; press = null; if (!p) return; p.cancel?.(); eng?.press(false);
    if (!run) return;
    if (p.held) p.started.then(r => { if (r === 'voice') api.voice.command(); });
    else api.voice.talk();
  };
  api.listen(orbBtn, 'pointerup', () => release(true));
  api.listen(orbBtn, 'pointercancel', () => release(false));
  api.listen(orbBtn, 'keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) api.voice.talk(); } });
  api.listen(orbBtn, 'contextmenu', e => e.preventDefault());

  /* ---------- apps around the orb ---------- */
  let appSig = '';
  function paintApps() {
    const apps = api.apps.list().slice(0, MAX_APPS), sig = apps.map(a => a.id + ':' + a.name + ':' + a.icon.length).join('|');
    if (sig === appSig) return; appSig = sig;
    const items = apps.map(a => {
      const b = el('button', 'ob-app', { type: 'button', title: a.name, 'aria-label': 'Open ' + a.name });
      const tpl = doc.createElement('template'); tpl.innerHTML = a.icon; // shell-made sigil markup (WizSigil.box)
      b.append(tpl.content, el('span', 'ob-app-n', { text: a.name }));
      api.listen(b, 'click', () => api.apps.open(a.id));
      return b;
    });
    const all = el('button', 'ob-app ob-all', { type: 'button', title: 'All apps (⌥O)', 'aria-label': 'All apps' });
    all.append(el('span', 'ic', {}), el('span', 'ob-app-n', { text: 'All apps' })); all.firstChild.append(icon(I.apps));
    api.listen(all, 'click', () => api.apps.all());
    items.push(all);
    // Even spacing on one tilted ring; CSS turns --a into a slow orbit (paused on hover, still with reduced motion).
    items.forEach((b, i) => b.style.setProperty('--a', (i * 360 / items.length - 90).toFixed(2) + 'deg'));
    orbit.replaceChildren(...items);
  }

  /* ---------- Working and Ready under the orb ---------- */
  let threadSig = '';
  function pill(s) {
    const row = el('div', 'ob-pill is-' + s.kind + (s.needs ? ' is-needs' : '') + (s.unread ? ' is-new' : ''), { role: 'listitem' });
    const open = el('button', 'ob-pill-open', { type: 'button', title: s.title, 'aria-label': `${s.kind === 'working' ? 'Working' : s.needs ? 'Needs you' : 'Ready'}: ${s.title}` });
    open.append(el('span', 'ob-pill-mark', { 'aria-hidden': 'true' }), el('span', 'ob-pill-t', { text: s.title }));
    if (s.kind === 'working') open.append(el('small', 'ob-pill-k', { text: 'working' }));
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
    if (!L) { if (threadSig !== 'off') { threadSig = 'off'; threads.replaceChildren(el('div', 'ob-quiet', { text: 'Connecting…' })); } return; }
    const ready = L.ready.filter(s => !s.snoozed), working = L.working;
    const shownR = ready.slice(0, MAX_READY), shownW = working.slice(0, MAX_WORKING);
    const moreR = ready.length - shownR.length, moreW = working.length - shownW.length;
    const sig = JSON.stringify([shownR.map(s => [s.id, s.title, s.needs, s.unread, s.actions]), shownW.map(s => [s.id, s.title]), moreR, moreW]);
    if (sig === threadSig) return; threadSig = sig;
    const rows = [...shownR, ...shownW].map(pill);
    const more = (n, kind) => { const b = el('button', 'ob-more', { type: 'button', text: `+${n} ${kind}` }); api.listen(b, 'click', () => api.sessions.openList(kind)); return b; };
    if (moreR > 0 || moreW > 0) { const m = el('div', 'ob-pill-more', { role: 'listitem' }); if (moreR > 0) m.append(more(moreR, 'ready')); if (moreW > 0) m.append(more(moreW, 'working')); rows.push(m); }
    if (!rows.length) rows.push(el('div', 'ob-quiet', { text: 'All clear' }));
    threads.replaceChildren(...rows);
    const needs = ready.some(s => s.needs || s.unread);
    mini.classList.toggle('has-news', needs);
    mini.setAttribute('aria-label', needs ? 'Home · something is ready for you' : 'Home');
  }

  /* ---------- visibility: the scene shows only while Home is in front ---------- */
  let home = null;
  function paintVisible() {
    const h = !!api.route().home;
    if (h !== home) {
      home = h; root.dataset.orbScene = h ? 'home' : 'desk';
      scene.classList.toggle('is-on', h); scene.inert = !h;
      mini.hidden = h;
    }
    eng?.sleep(!h);
  }
  function paint() {
    paintVisible();
    if (!home) return;
    name.textContent = api.agents.here()?.label || 'Wizard';
    paintApps(); paintThreads();
  }
  api.listen(out, 'click', () => api.desk.look());
  api.listen(mini, 'click', () => api.desk.home());
  api.on('route', paint);
  api.on('home', paint);   // every Home repaint (live threads, outbox) lands here
  paint();

  return () => { delete root.dataset.orbScene; eng?.sleep(true); };
}
