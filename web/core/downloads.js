/* WizardOS · in-app Downloads (James, 7 Nov 2026).
 *
 * Android's download manager only drops a quiet notification in the tray. On the Android app the shell now tells
 * the page when a download finishes (an event on the private wizardDownloadsPort, posted by MainActivity) and this module shows:
 *   1. a banner INSIDE Wizard: "Downloaded · name · size · Open" (one tap opens the file in the app that handles
 *      it, e.g. a PDF viewer). Auto-dismisses after ~6 s; tapping the banner opens the sheet;
 *   2. the Downloads sheet: recent downloads, progress for in-flight ones, Open for finished ones.
 * Reopen later: Settings → Downloads (WosSettings.register) or the banner.
 *
 * Skin: one look in every skin. Only --wz-* roles (opaque --wz-panel / --wz-panel-raised for the floating banner
 * and sheet; the scrim may dim), exactly like the update banner (.dv-update) and the Share sheet.
 * Without the native port (desktop browser, an older Android app, a WebView without message listeners) the module
 * does nothing at all.
 *
 *   WosDownloads.available()   → true only where the Android app gives the shell window.wizardDownloadsPort
 *   WosDownloads.show()/.hide() the sheet (also .toggle); .isOpen(); .back() closes one layer (Back / Esc)
 *   WosDownloads.banner(item)  → the finished-download banner (also what a native "done" push calls)
 *   WosDownloads.open(id)      → Promise of "ok" | "missing" | "none" (Open one file: banner / sheet button)
 *
 * Native contract (android/.../downloads/DownloadsCallerPolicy.java, Downloads.java, DownloadsPolicy.java).
 * One message port, protocol v1, given ONLY to the shell's main frame on the Wizard origin (addWebMessageListener,
 * like wizardScreenPort); hosted-app iframes and other pages are refused natively and get no answer:
 *   page → native  JSON string {v:1, id, method:'list'|'open'|'cancel'|'remove', params?:{id}}
 *   native → page  JSON string {v:1, id, ok:true, result} | {v:1, id, ok:false, error}
 *     list   → result {"v":1,"items":[{id,name,mime,size,got,status,started,finished}]}
 *     open   → "ok" | "missing" | "none";  cancel / remove → "ok" | "missing"
 *   port message {v:1, event:{type:'start'|'done'|'failed'|'sync', item?}} (native → page; no global entry point exists)
 * The old WizardOSNative.downloads* JavascriptInterface methods no longer exist and are never used here.
 */
(() => {
  'use strict';
  if (window.WosDownloads) return;
  const SEEN = 'wos.downloads.seen.v1';       // newest finished download already announced (ms)
  const BANNER_MS = 6000, FRESH_MS = 10 * 60 * 1000, POLL_MS = 900;
  const STATUS = new Set(['pending', 'running', 'paused', 'done', 'failed', 'gone']);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // The shell takes the port into this closure and removes it from window. Hosted apps run in same-origin iframes and
  // can reach parent.*; with the property gone (and postMessage / addEventListener bound now) parent.wizardDownloadsPort is
  // not there for them. Defence in depth only: a same-origin app still shares the shell's authority (docs/android-downloads-port.md).
  // JSON is captured now, before any hosted frame exists, so a later swap of JSON.stringify / parse in the shared realm
  // cannot rewrite what goes to native or what is read back. Same-origin hosted apps remain able to tamper with OTHER
  // globals: this is bounded hardening, not isolation (docs/android-downloads-port.md, "Same-origin hosted apps").
  const JS = { stringify: JSON.stringify.bind(JSON), parse: JSON.parse.bind(JSON) };
  const trusted = e => !!e && e.isTrusted === true;   // a real tap/click; a script's dispatchEvent() / click() is false
  let held = null;
  function takePort() {
    if (held) return held;
    const p = window.wizardDownloadsPort;
    if (!p || typeof p.postMessage !== 'function') return null;
    const post = p.postMessage.bind(p);
    const on = typeof p.addEventListener === 'function' ? p.addEventListener.bind(p) : null;
    held = { postMessage: post, listen: fn => { if (on) on('message', fn); else p.onmessage = fn; } };
    try { delete window.wizardDownloadsPort; } catch (_) {}
    if ('wizardDownloadsPort' in window) { try { Object.defineProperty(window, 'wizardDownloadsPort', { value: undefined, configurable: true, writable: false }); } catch (_) {} }
    return held;
  }
  const native = () => held || takePort();
  // request/reply over the port; resolves to the native result, or null if the port is absent, refuses, or stays silent
  const V = 1, ASK_MS = 8000, asking = new Map(); let seq = 0, listening = false;
  function onNative(ev) {
    let m; try { m = JS.parse(typeof ev === 'string' ? ev : ev?.data); } catch (_) { return; }
    if (!m || m.v !== V) return;
    if (m.event && typeof m.event === 'object' && m.id === undefined) return onNativeEvent(m.event);   // native -> page, same private port
    const p = asking.get(m.id); if (!p) return;
    asking.delete(m.id); clearTimeout(p.timer);
    p.resolve(m.ok === true ? { result: m.result } : null);
  }
  function listen(pt) {
    if (listening) return; listening = true;
    pt.listen(onNative);
  }
  function ask(method, params) {
    return new Promise(resolve => {
      const pt = native(); if (!pt) return resolve(null);
      listen(pt);
      const id = 'dl' + (++seq);
      const timer = setTimeout(() => { if (asking.delete(id)) resolve(null); }, ASK_MS);
      asking.set(id, { resolve, timer });
      try { pt.postMessage(JS.stringify({ v: V, id, method, params: params || {} })); }
      catch (_) { clearTimeout(timer); asking.delete(id); resolve(null); }
    });
  }
  const toast = (i, t, ms) => { try { (window.__wos || window.__wux)?.toast?.(i, t, ms); } catch (_) {} };
  const nextFrame = fn => (window.requestAnimationFrame || (f => setTimeout(f, 16)))(fn);

  let items = [], loaded = false, seenAt = 0, sheet = null, bannerEl = null, bannerId = '', rowItem = new WeakMap(), bannerTimer = 0, poll = 0, opening = new Set();
  try { seenAt = Number(localStorage.getItem(SEEN)) || 0; } catch (_) {}
  const markSeen = at => { if (at > seenAt) { seenAt = at; try { localStorage.setItem(SEEN, String(at)); } catch (_) {} } };

  /* ---- data ---- */
  function clean(it) {
    if (!it || typeof it !== 'object') return null;
    const id = String(it.id ?? ''); if (!/^\d{1,18}$/.test(id)) return null;
    const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
    return { id, name: String(it.name || 'download').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120), mime: String(it.mime || '').slice(0, 100),
      size: num(it.size) > 0 ? num(it.size) : -1, got: Math.max(0, num(it.got)), status: STATUS.has(it.status) ? it.status : 'pending',
      started: num(it.started), finished: num(it.finished) };
  }
  async function read() {
    const r = await ask('list');
    const o = r?.result;
    return o && Array.isArray(o.items) ? o.items.map(clean).filter(Boolean) : null;
  }
  async function refresh() {
    const l = await read(), before = rowSummary();   // compared after the await: concurrent refreshes must not both count as a change
    if (l) { items = l; loaded = true; if (rowSummary() !== before) settingsChanged(); }
    return items;
  }
  // Settings shows only a count line. Repaint it only when THAT changes: a growing byte count must not repaint the row, because
  // the row's html() asks native again (that was an unbounded request loop while a transfer ran).
  const rowSummary = () => (loaded ? items.filter(inFlight).length + '/' + items.length : '');
  function settingsChanged() { try { window.WosSettings?.refresh?.(); } catch (_) {} }   // the Settings row text follows the list
  const inFlight = it => it.status === 'pending' || it.status === 'running' || it.status === 'paused';

  /* ---- labels ---- */
  function fmtSize(n) {
    if (!(n > 0)) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0).replace(/\.0$/, '')} MB`;
    return `${(n / 1073741824).toFixed(1)} GB`;
  }
  function when(ms) {
    if (!ms) return '';
    try { const s = window.WizCore?.ago?.(new Date(ms).toISOString()); if (s) return s; } catch (_) {}
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const pct = it => (it.size > 0 ? Math.max(0, Math.min(100, Math.floor((it.got / it.size) * 100))) : -1);
  const ICON = {
    file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/></svg>',
    warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5"/><path d="M12 16.5v.01"/><path d="M10.3 4.2L2.9 17.3A2 2 0 0 0 4.6 20h14.8a2 2 0 0 0 1.7-2.7L13.7 4.2a2 2 0 0 0-3.4 0z"/></svg>',
  };

  /* ---- open / cancel / remove (the tap paints first, the native call follows) ---- */
  async function open(id) {
    if (!native() || !/^\d{1,18}$/.test(String(id))) return 'missing';
    const a = await ask('open', { id: String(id) });
    const r = a && typeof a.result === 'string' ? a.result : 'missing';
    if (r === 'missing') toast('!', 'That file is no longer on this phone', 2600);
    else if (r === 'none') toast('!', 'No app can open this file', 2600);
    return r;
  }
  function openTap(btn, id) {
    if (!btn || opening.has(id)) return;
    opening.add(id);
    const label = btn.textContent;
    btn.classList.add('busy'); btn.disabled = true; btn.textContent = 'Opening…'; // same frame as the tap
    nextFrame(() => setTimeout(async () => {
      const r = await open(id);
      opening.delete(id);
      if (r === 'ok' && bannerEl && bannerId === id) hideBanner();
      if (btn.isConnected) { btn.classList.remove('busy'); btn.disabled = false; btn.textContent = label; }
      if (r === 'missing') { await refresh(); paint(); }
    }, 0));
  }
  function cancelTap(btn, id) {
    const n = native(); if (!n) return;
    const row = btn.closest('.wdl-row'); btn.disabled = true; btn.textContent = 'Cancelling…';
    const b4 = rowSummary();
    items = items.filter(x => x.id !== id); row?.remove(); if (!items.length) paint();   // paint first, reconcile after
    if (rowSummary() !== b4) settingsChanged();               // the local change already moved the Settings count line
    nextFrame(() => setTimeout(async () => { await ask('cancel', { id }); await refresh(); paint(); }, 0));
  }
  function removeTap(btn, id) {
    const n = native(); if (!n) return;
    const b4 = rowSummary();
    items = items.filter(x => x.id !== id); btn.closest('.wdl-row')?.remove(); if (!items.length) paint();
    if (rowSummary() !== b4) settingsChanged();
    nextFrame(() => setTimeout(() => { ask('remove', { id }); }, 0));
  }

  /* ---- swipe to dismiss (switch wizard/download-swipe, wizard-ux issue 1343) ----
   * James: the banner and the sheet must go away with a swipe. The banner follows the finger up or sideways once a press
   * moves past the tap slop; the sheet's panel follows a pull down from its grip or title, or from the list while the list
   * is at its top. On release a long drag or a fast flick dismisses (the shell's sheet rule, app.js sheetDrag: 90 px, or
   * a flick past 30 px), anything shorter springs back. Dismissing only hides: no cancel or remove is ever sent, so the
   * download keeps running and stays in Settings → Downloads. With the switch off no handler acts and no style changes. */
  const SWIPE = 'wizard/download-swipe', SLOP = 8;
  const swipeOn = () => { try { return (document.documentElement.dataset.tweaks || '').split(' ').includes(SWIPE); } catch (_) { return false; } };
  const clock = () => { try { return performance.now(); } catch (_) { return Date.now(); } };
  const flung = (d, ms) => d > 90 || (d > 30 && d / (ms || 1) > 0.6);
  // Returns a check for the click handler: true once for the click that ends a drag (a drag is never also a tap).
  function bannerSwipe(el) {
    let g = null, dragged = false;
    const paint = (dx, dy) => {
      el.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : '';
      const far = Math.max(Math.abs(dx) / Math.max(1, el.offsetWidth || 320), -dy / 120);
      el.style.opacity = dx || dy ? String(Math.max(0.4, 1 - far * 0.5)) : '';
    };
    el.addEventListener('pointerdown', e => {
      dragged = false;
      if (!swipeOn() || !trusted(e) || (e.button || 0) !== 0) { g = null; return; }
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, t: clock(), on: false, dx: 0, dy: 0 };
    });
    el.addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.on) {
        if (Math.hypot(dx, dy) < SLOP) return;
        g.on = true; el.classList.add('wdl-dragging');
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
      }
      g.dx = dx; g.dy = Math.min(0, dy);                   // up or sideways: it never slides down over the dock
      paint(g.dx, g.dy);                                   // on the frame of the move: the banner is under the finger
    });
    const end = e => {
      if (!g || (e && e.pointerId !== g.id)) return;
      const was = g; g = null;
      if (!was.on) return;
      dragged = true; el.classList.remove('wdl-dragging');
      const side = Math.abs(was.dx) >= -was.dy, dist = side ? Math.abs(was.dx) : -was.dy;
      if (e?.type !== 'pointercancel' && flung(dist, clock() - was.t)) {
        const w = Math.max(window.innerWidth || 0, 400);
        el.style.transform = side ? `translate(${was.dx < 0 ? -w : w}px, ${was.dy}px)` : `translate(${was.dx}px, ${was.dy - 160}px)`;
        el.style.opacity = '0';
        if (bannerEl === el) hideBanner();
      } else paint(0, 0);                                  // springs back (the CSS eases it home)
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    return () => { const d = dragged; dragged = false; return d; };
  }
  function sheetSwipe(el) {
    const panel = el.querySelector('.wdl-panel'), scrim = el.querySelector('.wdl-scrim');
    let g = null, pulled = false;
    if (!panel) return () => false;
    el.addEventListener('pointerdown', () => { pulled = false; });   // every new press starts clean (also on the scrim)
    const handle = t => !!t?.closest?.('.wdl-grip, .wdl-title');
    const begin = (x, y, fromHandle) => { pulled = false; g = swipeOn() ? { x, y, t: clock(), on: false, dy: 0, fromHandle } : null; };
    const move = (x, y) => {
      if (!g) return false;
      const dx = x - g.x, dy = y - g.y;
      if (!g.on) {
        if (Math.hypot(dx, dy) < SLOP) return false;
        // Only a pull DOWN, and from the list only while it is scrolled to its top: otherwise the list just scrolls.
        if (dy <= 0 || Math.abs(dx) > dy || (!g.fromHandle && panel.scrollTop > 0)) { g = null; return false; }
        g.on = true; el.classList.add('wdl-dragging');
      }
      g.dy = Math.max(0, dy);
      panel.style.transform = g.dy ? `translateY(${g.dy}px)` : '';
      if (scrim) scrim.style.opacity = g.dy ? String(Math.max(0, 1 - g.dy / Math.max(1, panel.offsetHeight || 400))) : '';
      return true;
    };
    const end = cancelled => {
      const was = g; g = null;
      if (!was || !was.on) return;
      pulled = true; el.classList.remove('wdl-dragging');
      if (!cancelled && flung(was.dy, clock() - was.t)) {
        panel.style.transform = 'translateY(100%)'; if (scrim) scrim.style.opacity = '0';
        if (sheet === el) hide();
      } else { panel.style.transform = ''; if (scrim) scrim.style.opacity = ''; }
    };
    // Touch: touch events, so a pull at the list's top can stop the list's own (empty) scroll once it is a pull.
    panel.addEventListener('touchstart', e => { const t = e.touches?.[0]; if (!t || e.touches.length > 1) { g = null; return; } begin(t.clientX, t.clientY, handle(e.target)); }, { passive: true });
    panel.addEventListener('touchmove', e => { const t = e.touches?.[0]; if (t && move(t.clientX, t.clientY) && e.cancelable) e.preventDefault(); }, { passive: false });
    panel.addEventListener('touchend', () => end(false)); panel.addEventListener('touchcancel', () => end(true));
    // A mouse drags the grip (phone shell in a desktop browser); touch pointers are handled above.
    let mouse = null;
    panel.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || !trusted(e) || !handle(e.target)) return;
      mouse = e.pointerId; begin(e.clientX, e.clientY, true);
      try { panel.setPointerCapture(e.pointerId); } catch (_) {}
    });
    panel.addEventListener('pointermove', e => { if (e.pointerId === mouse) move(e.clientX, e.clientY); });
    const up = e => { if (e.pointerId !== mouse) return; mouse = null; end(e.type === 'pointercancel'); };
    panel.addEventListener('pointerup', up); panel.addEventListener('pointercancel', up);
    return () => { const d = pulled; pulled = false; return d; };
  }

  /* ---- banner ---- */
  function hideBanner() {
    clearTimeout(bannerTimer); bannerTimer = 0;
    const el = bannerEl; bannerEl = null; if (!el) return;
    el.classList.remove('on'); el.style.pointerEvents = 'none'; setTimeout(() => el.remove(), 180);
  }
  // Lift above the composer when the shell's own chat composer is showing; a hosted app's composer sits in its
  // frame, so keep clear of a typical one there. Desktop shells place it top-right (CSS).
  function lift() {
    if (document.documentElement.dataset.shell === 'desktop') return 0;
    try {
      const c = [...document.querySelectorAll('.ch-compose')].find(e => e.getClientRects().length);
      if (c) { const r = c.getBoundingClientRect(); return Math.max(0, Math.round(innerHeight - r.top)); }
    } catch (_) {}
    return 0;
  }
  function banner(item) {
    const it = clean(item); if (!it) return false;
    if (it.status === 'failed') { toast('!', `Couldn’t download ${it.name}`, 3200); return true; }
    if (it.status !== 'done') return false;
    if (sheet) { markSeen(it.finished || Date.now()); return true; } // the sheet is already showing it
    hideBanner(); markSeen(it.finished || Date.now());
    const el = document.createElement('div');
    el.className = 'wdl wdl-banner'; bannerId = it.id; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.style.setProperty('--wdl-lift', lift() + 'px');
    const size = fmtSize(it.size);
    el.innerHTML = `<button type="button" class="wdl-main" aria-label="Downloads"><span class="wdl-ic">${ICON.file}</span><span class="wdl-tx"><b>Downloaded</b><small>${esc(it.name)}${size ? ' · ' + esc(size) : ''}</small></span></button><button type="button" class="wdl-open">Open</button>`;
    const openBtn = el.querySelector('.wdl-open'), mainBtn = el.querySelector('.wdl-main');   // the shell's own buttons, held here
    const swiped = bannerSwipe(el);                         // switch wizard/download-swipe; inert while it is off
    el.addEventListener('click', e => {
      if (!trusted(e)) return;                              // only a real tap: never a script's dispatchEvent / click()
      if (swiped()) return;                                 // the release of a drag is not a tap
      const b = e.target?.closest?.('button'); if (!b) return;
      if (b === openBtn) return openTap(b, it.id);
      if (b === mainBtn) { hideBanner(); show(); }
    });
    el.addEventListener('pointerdown', () => { clearTimeout(bannerTimer); bannerTimer = 0; });
    document.body.appendChild(el); bannerEl = el;
    nextFrame(() => el.classList.add('on'));
    bannerTimer = setTimeout(() => { if (bannerEl === el) hideBanner(); }, BANNER_MS);
    return true;
  }

  /* ---- sheet ---- */
  function rowHtml(it) {
    const size = fmtSize(it.size), p = pct(it);
    let meta, act, ic = ICON.file, extra = '';
    if (inFlight(it)) {
      ic = ICON.down;
      meta = it.status === 'paused' ? 'Paused' : it.status === 'pending' && !(it.got > 0) ? 'Starting…' : `Downloading…${p >= 0 ? ' ' + p + '%' : ''}`;
      extra = `<span class="wdl-bar${p < 0 ? ' indet' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100"${p >= 0 ? ` aria-valuenow="${p}"` : ''}><i style="width:${p < 0 ? 40 : p}%"></i></span>`;
      act = `<button type="button" class="wdl-act ghost" data-wdl="cancel">Cancel</button>`;
    } else if (it.status === 'done') {
      meta = [size, when(it.finished || it.started)].filter(Boolean).join(' · ');
      act = `<button type="button" class="wdl-act" data-wdl="open">Open</button>`;
    } else if (it.status === 'failed') {
      ic = ICON.warn; meta = 'Couldn’t download';
      act = `<button type="button" class="wdl-act ghost" data-wdl="remove">Remove</button>`;
    } else {
      ic = ICON.warn; meta = 'No longer on this phone';
      act = `<button type="button" class="wdl-act ghost" data-wdl="remove">Remove</button>`;
    }
    return `<div class="wdl-row${it.status === 'failed' || it.status === 'gone' ? ' bad' : ''}"><span class="wdl-ic">${ic}</span><span class="wdl-tx"><b>${esc(it.name)}</b><small>${esc(meta)}</small>${extra}</span>${act}</div>`;
  }
  function paint() {
    if (!sheet) return;
    const list = sheet.querySelector('.wdl-list'); if (!list) return;
    list.innerHTML = items.length ? items.map(rowHtml).join('') : loaded ? '<p class="wdl-empty">No downloads yet. Files you download from Wizard appear here.</p>' : '<p class="wdl-empty">Loading…</p>';
    // The shell remembers which record each row it drew stands for. Taps are resolved from this map, never from
    // attributes in the DOM, so rewriting the markup (or adding a lookalike row) cannot redirect an action.
    rowItem = new WeakMap();
    [...list.querySelectorAll('.wdl-row')].forEach((row, i) => { if (items[i]) rowItem.set(row, items[i]); });
  }
  async function tick() {
    if (!sheet) return;
    const before = JS.stringify(items);
    await refresh();
    if (sheet && JS.stringify(items) !== before) paint();
    if (sheet && !items.some(inFlight) && !sheet.dataset.idle) sheet.dataset.idle = '1';
  }
  function show() {
    if (!native()) return false;
    if (sheet) return true;
    hideBanner();
    const el = document.createElement('div');
    el.className = 'wdl wdl-sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Downloads');
    el.innerHTML = '<div class="wdl-scrim"></div><div class="wdl-panel"><div class="wdl-grip"></div><h2 class="wdl-title">Downloads</h2><div class="wdl-list"></div></div>';
    sheet = el; paint();                                   // the tap paints first; the list follows from native
    refresh().then(() => { if (sheet === el) paint(); });
    // Outside tap closes; a press that began inside the panel and released outside does not.
    let downOutside = false;
    el.addEventListener('pointerdown', e => { downOutside = !e.target.closest('.wdl-panel'); });
    el.addEventListener('pointercancel', () => { downOutside = false; });
    const pulled = sheetSwipe(el);                           // switch wizard/download-swipe; inert while it is off
    el.addEventListener('click', e => {
      if (!trusted(e)) return;                              // only a real tap: never a script's dispatchEvent / click()
      if (pulled()) return;                                 // the release of a pull is not a tap
      const b = e.target?.closest?.('.wdl-act');
      if (b) {
        const it = rowItem.get(b.closest('.wdl-row'));
        if (!it) return;                                    // not a row the shell drew
        if (it.status === 'done') return openTap(b, it.id);
        if (inFlight(it)) return cancelTap(b, it.id);
        return removeTap(b, it.id);
      }
      if (e.target?.closest?.('.wdl-panel')) return;
      if (downOutside || e.detail === 0) hide();
    });
    document.body.appendChild(el);
    nextFrame(() => el.classList.add('on'));
    clearInterval(poll); poll = setInterval(tick, POLL_MS);
    markSeen(Date.now());
    return true;
  }
  function hide() {
    if (!sheet) return false;
    const el = sheet; sheet = null; clearInterval(poll); poll = 0;
    el.classList.remove('on'); el.style.pointerEvents = 'none'; setTimeout(() => el.remove(), 180);
    return true;
  }
  const back = () => (hide() ? 'downloads' : null); // Back / Esc: one layer, never leaves the app

  /* ---- native push ---- */
  function freshUnseen() {
    const now = Date.now();
    return items.filter(i => i.status === 'done' && i.finished > seenAt && now - i.finished < FRESH_MS).sort((a, b) => b.finished - a.finished)[0] || null;
  }
  // Events arrive ONLY on the private port ({v:1, event}); there is no global to call. An earlier version exposed
  // window.__wosDownloads, and a hosted app could use it to make the shell read the native list and paint the real name of any
  // id it guessed (PR review). The event is still only a nudge: what is shown comes from the native list.
  function onNativeEvent(ev) {
    if (!ev || typeof ev !== 'object') return true;
    if (!native()) return true;
    if (ev.type === 'done' || ev.type === 'failed') {
      const want = String(ev.item?.id ?? '');
      refresh().then(() => { if (sheet) paint(); const it = items.find(i => i.id === want); if (it) banner(it); });
    }
    else if (ev.type === 'start') refresh().then(() => { if (sheet) paint(); });
    else if (ev.type === 'sync') refresh().then(() => { if (sheet) paint(); const f = freshUnseen(); if (f) banner(f); });
    return true;
  }

  /* ---- Settings entry: a row to reopen the sheet later ---- */
  function registerSettings() {
    const S = window.WosSettings; if (!S?.register) return;
    try {
      S.register({ id: 'downloads', page: 'phone', aliases: ['downloads'], available: () => !!native(),
        html() {
          refresh();                                         // asks native; the row text follows the last list received
          const run = items.filter(inFlight).length;
          const sub = run ? `${run} downloading` : items.length ? `${items.length} recent` : 'Files you download appear here';
          return `<div class="st-group"><h4>Downloads</h4><button class="st-row wz-row" data-st="downloads"><span class="st-tx"><b>Downloads</b><small>${esc(sub)}</small></span><span class="st-go">›</span></button></div>`;
        },
        act(ctx, el) { if (!el.closest('[data-st="downloads"]')) return false; show(); return true; } });
    } catch (_) {}
  }
  registerSettings();
  // Eagerly, before any hosted frame exists. The first list request also tells native which page document to send events to.
  if (takePort()) { listen(held); refresh(); }

  // Public surface: three booleans/closers the shell's Back/Escape owners need. No list, no state, no way to open, cancel,
  // remove or show: those stay in this closure and run only from real taps on the shell's own sheet and banner.
  // The test harness splices a private probe in front of this line; production exports nothing else.
  window.WosDownloads = Object.freeze({ available: () => !!native(), isOpen: () => !!sheet, back });
})();
