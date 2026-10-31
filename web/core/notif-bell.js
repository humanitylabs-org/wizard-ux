/* Notifications bell on the Chats panel: a small bell beside search with the unread count from the installed
 * Notifications app (same origin, /notifications/api/count). Tapping it opens Notifications as an ordinary app
 * window, so it sits on a desk you can swipe to. Hidden entirely when no Notifications app is installed, and
 * hidden while a Notifications window is open: its desk mark already carries the same count as a badge, so the
 * owner sees one or the other, never both. Shells expose WizAppOpen(id) and call WosBell.paint() on window changes. */
(() => {
  'use strict';
  const S = { unread: 0, needs: 0, ok: false, at: 0 };
  const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>';
  // Installed: openable as an app window, or present as a screenless agent app (its inbox then lives in Chats).
  const installed = () => !!((window.WizCanOpen && window.WizCanOpen('notifications')) || window.WizCore?.backendApps?.().some(a => a.id === 'notifications'));
  function html() {
    if (!installed()) return '';
    if (typeof window.WizAppOpen === 'function' && window.WizAppOpen('notifications')) return '<button type="button" class="ch-bell" data-chbell hidden aria-hidden="true" tabindex="-1"></button>';
    const n = S.unread, lbl = n ? `Notifications, ${n} unread` : 'Notifications';
    return `<button type="button" class="ch-bell${S.needs ? ' needs' : ''}" data-chbell aria-label="${lbl}">${BELL}${n ? `<b>${n > 99 ? '99+' : n}</b>` : ''}</button>`;
  }
  function paint() {
    window.WizCore?.workspaceNav?.setCount('notifications', S.unread);
    for (const b of document.querySelectorAll('[data-chbell]')) {
      const h = html(); if (!h) { b.remove(); continue; }
      const t = document.createElement('div'); t.innerHTML = h; const nb = t.firstElementChild;
      if (b.outerHTML !== nb.outerHTML) b.replaceWith(nb);
    }
  }
  /* Inbox items for a trusted tweak (skin-host `inbox` capability): newest first, each with read / archived. Fetched only
   * while something watches, on the bell's own cadence. Text stays data; the tweak renders it with textContent. */
  const IN = { items: [], subs: new Set(), seq: 0 };
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  // The editor's short message is a preview, not the source. Keep the complete original separately, including
  // paragraphs and long diagnostic output. Legacy items without editor details use their complete body.
  const cleanItem = i => Object.freeze({ id: str(i.id, 128), title: str(i.title, 300), message: str(i.message, 8000), details: String(i.details || i.message || ''), time: Number(i.time) || 0, source: str(i.source, 40), priority: Number(i.priority) || 3, link: str(i.link, 2000), read: !!i.read, archived: !!i.archived,
    ...(i.app ? { app: str(i.app, 64), appName: str(i.appName, 80), key: str(i.key, 200), open: str(i.open, 500), actions: i.actions || Object.freeze([]) } : {}) });

  /* App inbox feeds (Wizard OS inbox feed v1, docs in agent_notes inbox-feed-contract.md): an installed app that
   * serves GET /<app>/api/inbox lists the things that need the owner now (what its badge counts), one item per thing.
   * Its items join the Notifications items here, so the inbox in Chats (and later the phone) shows them with the
   * app's own buttons. A thing handled in the app leaves its feed, so its row clears everywhere by itself. Done /
   * Snooze without an app action are inbox marks (Notifications /api/marks) covering the item's activity time:
   * newer activity brings it back. Which apps have a feed is learnt once per app (6 h for a "no").
   * OFF unless a trusted package holds it (skin-host api.inbox.feeds → feeds(true)): until then no app is ever
   * asked for a feed and everything below is the stock Notifications-only path. Per app, the owner can keep its
   * items in the app instead (Notifications /api/sources, chats: false, the same on every device): no rows, no
   * count here; the app keeps its own badge.
   * Only a definite answer (404/405/410, or a 200 that is not a feed) counts as "no feed", and a "no" is asked again
   * after 30 min: an app that was restarting (502/503, timeout) or gained its feed later shows up by itself. (v1 kept
   * any first failure as "no" for 6 h, so a device that first asked while Messenger restarted showed no rows.)
   * Instant (contract v1.1): a feed that also carries `watch` (a path under the app) and `version` gets ONE long
   * poll, GET /<app>/<watch>?v=<version>, that the app answers as soon as its feed changes (with the new feed) or
   * after ~25 s. Only for apps that declare it, only while this page is visible and a package watches the feeds;
   * errors back off 5 s, 30 s, then 2 min. Every other app stays on the shared cadence. */
  const FEED_KEY = 'wos.inbox.feeds.v2', MARK_KEY = 'wos.inbox.appmarks.v1', NO_AGAIN = 30 * 60e3, RETRY = 2 * 60e3;
  const FEED_SKIP = new Set(['notifications', 'wizard', 'wizard-agent-service', 'wizard-ux', 'setup', 'side-button', 'pages']);
  const FD = { on: false, known: null, last: {}, marks: null, sources: null, watch: {}, fresh: {}, retry: {} };
  const known = () => FD.known || (FD.known = (() => { try { return JSON.parse(localStorage.getItem(FEED_KEY) || '{}') || {}; } catch (e) { return {}; } })());
  const saveKnown = () => { try { localStorage.setItem(FEED_KEY, JSON.stringify(known())); } catch (e) {} };
  const APPID = /^[a-z0-9][a-z0-9-]{0,63}$/, ACTID = /^[a-z0-9_-]{1,32}$/;
  const hash = t => { let a = 0x811c9dc5, b = 0x01000193; for (const c of String(t)) { const k = c.codePointAt(0); a = Math.imul(a ^ k, 16777619) >>> 0; b = Math.imul(b ^ k, 2246822519) >>> 0; } return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0'); };
  const appItemId = (app, key) => 'a-' + app + '-' + hash(key);
  const timed = (p, ms = 4000) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
  function feedApps() {
    const ids = new Set();
    try { for (const a of window.WizCore?.apps?.('mobile')?.APPS || []) if (a && a.kind === 'wizard' && a.source) ids.add(a.id); } catch (e) {}
    try { for (const a of window.WizCore?.backendApps?.() || []) if (a) ids.add(a.id); } catch (e) {}
    return [...ids].filter(id => APPID.test(String(id)) && !FEED_SKIP.has(id));
  }
  const appName = id => { try { return window.WizCore?.appMetadata?.(id)?.name || [...(window.WizCore?.apps?.('mobile')?.APPS || [])].find(a => a.id === id)?.name || id; } catch (e) { return id; } };
  // A feed, null when the app definitely has none, or a throw when it could not answer now (restarting, offline).
  async function getFeed(id) {
    const r = await timed(fetch(`/${id}/api/inbox`, { cache: 'no-store', credentials: 'same-origin', redirect: 'error' }));
    if (!r.ok) { if ([404, 405, 410].includes(r.status)) return null; throw new Error('feed ' + r.status); }
    if (!/json/.test(r.headers.get('content-type') || '')) return null;
    const d = await r.json();
    if (!(d && d.inbox === 1 && Array.isArray(d.items))) return null;
    noteWatch(id, d);
    return d.items;
  }
  const WATCH_PATH = /^[a-z0-9][a-z0-9_-]{0,31}(?:\/[a-z0-9][a-z0-9_-]{0,31}){0,3}$/;
  function noteWatch(id, d) {
    const ok = typeof d.watch === 'string' && WATCH_PATH.test(d.watch) && typeof d.version === 'string' && d.version.length <= 64;
    if (ok) FD.watch[id] = { path: d.watch, v: d.version }; else delete FD.watch[id];
  }
  const cleanActions = acts => Object.freeze((Array.isArray(acts) ? acts : []).filter(a => a && ACTID.test(String(a.id)) && String(a.label || '').trim()).slice(0, 4)
    .map(a => Object.freeze({ id: String(a.id), label: str(String(a.label).trim(), 40), ...(a.input === true ? { input: true } : {}), ...(typeof a.ask === 'string' && a.ask.trim() ? { ask: str(a.ask.trim(), 1000) } : {}) })));
  function fromFeed(app, raw) {
    const key = str(raw && raw.key, 200); if (!key) return null;
    const open = typeof raw.open === 'string' && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(raw.open) ? str(raw.open.replace(/^\/+/, ''), 500) : '';
    const text = str(raw.text, 2000);
    return { id: appItemId(app, key), app, appName: appName(app), key, title: str(raw.title, 300), message: text, details: text, time: Number(raw.time) || 0, source: app,
      priority: Math.max(1, Math.min(5, Number(raw.priority) || 3)), link: '', open, actions: cleanActions(raw.actions) };
  }
  async function loadMarks() {
    try { const r = await timed(fetch('/notifications/api/marks', { cache: 'no-store', credentials: 'same-origin' })); if (r.ok) { const d = await r.json(); if (d && d.marks) { FD.marks = d.marks; return; } } } catch (e) {}
    if (!FD.marks) try { FD.marks = JSON.parse(localStorage.getItem(MARK_KEY) || '{}') || {}; } catch (e) { FD.marks = {}; }
  }
  // Which apps show in Chats (absent = shown). Read with every feed read, so a change on one device reaches the rest.
  async function loadSources() {
    if (!installed()) { FD.sources = {}; return FD.sources; }
    try { const r = await timed(fetch('/notifications/api/sources', { cache: 'no-store', credentials: 'same-origin' })); if (r.ok) { const d = await r.json(); if (d && d.sources && typeof d.sources === 'object') FD.sources = d.sources; } } catch (e) {}
    return FD.sources || {};
  }
  const shown = (app, src = FD.sources || {}) => !(src[app] && src[app].chats === false);
  const withMarks = list => { const M = FD.marks || {}; return list.map(it => { const m = M[it.id]; const covers = m && Number(m.at) >= it.time; return { ...it, read: !!(covers && (m.read || m.archived)), archived: !!(covers && m.archived) }; }); };
  async function loadFeeds() {
    const now = Date.now(), apps = feedApps(), out = [];
    const [src] = await Promise.all([loadSources(), ...apps.map(async id => {
      const k = known()[id];
      if (k && k.s === 'no' && now - k.at < NO_AGAIN) return;
      if (!(k && k.s === 'yes') && FD.retry[id] && now < FD.retry[id]) return;
      try {
        const items = await getFeed(id);
        if (!items) { if (!k || k.s !== 'yes') { known()[id] = { s: 'no', at: now }; saveKnown(); } else if (FD.last[id]) out.push(...FD.last[id].items); return; }
        delete FD.retry[id];
        if (!k || k.s !== 'yes') { known()[id] = { s: 'yes', at: now }; saveKnown(); }
        // The app's long poll delivered a newer feed while this read was on its way: keep that one.
        if ((FD.fresh[id] || 0) > now && FD.last[id]) { out.push(...FD.last[id].items); return; }
        const list = items.slice(0, 50).map(it => fromFeed(id, it)).filter(Boolean);
        FD.last[id] = { at: now, items: list }; out.push(...list);
      } catch (e) {
        // A feed that stops answering keeps its last items a few minutes (no flicker), then they go. It is never
        // written off for it: asked again in 2 min (or on the next read once it has answered before).
        if (FD.last[id] && now - FD.last[id].at < 5 * 60e3) out.push(...FD.last[id].items);
        if (!(k && k.s === 'yes')) FD.retry[id] = now + RETRY;
      }
    })]);
    const kept = out.filter(it => shown(it.app, src));
    if (kept.length) await loadMarks();
    syncWatches();
    return withMarks(kept);
  }
  /* One long poll per app that declared `watch`. It replaces only that app's items when the feed changed. */
  const WT = new Map(), BACKOFF = [5e3, 30e3, 120e3];
  const watching = () => FD.on && IN.subs.size > 0 && !document.hidden;
  function syncWatches() {
    const want = watching() ? new Set(Object.keys(FD.watch).filter(id => known()[id]?.s === 'yes')) : new Set();
    for (const [id, w] of WT) if (!want.has(id)) { w.stop = true; try { w.ctl?.abort(); } catch (e) {} clearTimeout(w.timer); w.wake?.(); WT.delete(id); }
    for (const id of want) if (!WT.has(id)) { const w = { fails: 0, stop: false }; WT.set(id, w); void runWatch(id, w); }
  }
  const pause = (w, ms) => new Promise(res => { w.wake = res; w.timer = setTimeout(res, ms); });
  async function runWatch(id, w) {
    while (!w.stop) {
      const spec = FD.watch[id]; if (!spec) break;
      const ctl = new AbortController(), t0 = Date.now(); w.ctl = ctl;
      const limit = setTimeout(() => { try { ctl.abort(); } catch (e) {} }, 40000);
      let d = null;
      try {
        const r = await fetch(`/${id}/${spec.path}?v=${encodeURIComponent(spec.v)}`, { cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: ctl.signal });
        if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) throw new Error('watch ' + r.status);
        d = await r.json();
        if (!d || d.inbox !== 1 || typeof d.version !== 'string') throw new Error('watch shape');
      } catch (e) {
        clearTimeout(limit); if (w.stop) break;
        await pause(w, BACKOFF[Math.min(w.fails++, BACKOFF.length - 1)]); continue;
      }
      clearTimeout(limit); if (w.stop) break;
      w.fails = 0;
      if (d.changed === true && Array.isArray(d.items)) await fromWatch(id, d);
      else if (FD.watch[id] === spec) FD.watch[id] = { ...spec, v: d.version };
      // An app that answers at once without news would spin: never ask again sooner than 1 s after a quiet answer.
      if (d.changed !== true && Date.now() - t0 < 1000) await pause(w, 5000);
    }
    if (WT.get(id) === w) WT.delete(id);
  }
  async function fromWatch(id, d) {
    noteWatch(id, d);
    if (!FD.on) return;
    const now = Date.now(), list = d.items.slice(0, 50).map(it => fromFeed(id, it)).filter(Boolean);
    FD.last[id] = { at: now, items: list }; FD.fresh[id] = now + 1;
    const src = FD.sources || {};
    const kept = list.filter(it => shown(it.app, src));
    if (kept.length && !FD.marks) await loadMarks();
    const next = Object.freeze([...IN.items.filter(i => i.app !== id), ...withMarks(kept)].filter(i => i && i.id).map(cleanItem).sort((a, b) => b.time - a.time));
    if (JSON.stringify(next) === JSON.stringify(IN.items)) return;
    IN.items = next; emit();
  }
  // Stock: the Notifications app's items only.
  async function loadNotes() {
    if (!IN.subs.size || !installed()) return;
    const seq = ++IN.seq;
    try {
      const r = await fetch('/notifications/api/items?view=all&limit=200', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) return;
      const d = await r.json();
      if (seq !== IN.seq || !Array.isArray(d.items)) return;
      const before = JSON.stringify(IN.items);
      IN.items = Object.freeze(d.items.filter(i => i && i.id).map(cleanItem).sort((a, b) => b.time - a.time));
      for (const fn of [...IN.subs]) { try { fn(IN.items); } catch (e) {} }
      if (before !== JSON.stringify(IN.items)) inboxChanged();
    } catch (e) {}
  }
  async function loadItems() {
    if (!FD.on) return loadNotes();
    if (!IN.subs.size) return;
    const seq = ++IN.seq;
    try {
      const [notes, apps] = await Promise.all([
        installed() ? fetch('/notifications/api/items?view=all&limit=200', { cache: 'no-store', credentials: 'same-origin' }).then(r => r.ok ? r.json() : null, () => null) : null,
        loadFeeds().catch(() => []),
      ]);
      if (seq !== IN.seq) return;
      const base = notes && Array.isArray(notes.items) ? notes.items : IN.items.filter(i => !i.app);
      const before = JSON.stringify(IN.items);
      IN.items = Object.freeze([...base, ...apps].filter(i => i && i.id).map(cleanItem).sort((a, b) => b.time - a.time));
      for (const fn of [...IN.subs]) { try { fn(IN.items); } catch (e) {} }
      if (before !== JSON.stringify(IN.items)) inboxChanged();
    } catch (e) {}
  }
  /* An app's own button on one of its items: POST /<app>/api/inbox/act { key, action, text }. The item usually
   * leaves the app's feed afterwards; the list reloads at once. */
  async function act(id, action, text) {
    const it = FD.on ? IN.items.find(i => i.id === String(id)) : null; if (!it || !it.app || !it.actions.some(a => a.id === action && !a.ask)) return false;
    let ok = false;
    try {
      const r = await timed(fetch(`/${it.app}/api/inbox/act`, { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: it.key, action, ...(text ? { text: String(text).slice(0, 8000) } : {}) }) }), 15000);
      ok = r.ok;
    } catch (e) {}
    if (ok) { IN.items = Object.freeze(IN.items.filter(i => i.id !== it.id)); for (const fn of [...IN.subs]) { try { fn(IN.items); } catch (e) {} } inboxChanged(); }
    await loadItems();
    return ok;
  }
  const emit = () => { for (const fn of [...IN.subs]) { try { fn(IN.items); } catch (e) {} } inboxChanged(); };
  // skin-host only (api.inbox.feeds): on while a trusted package holds it. Off drops app items at once.
  function feeds(on) {
    on = on === true; if (on === FD.on) return;
    FD.on = on;
    if (!on) { FD.last = {}; FD.watch = {}; syncWatches(); IN.seq++; if (IN.items.some(i => i.app)) { IN.items = Object.freeze(IN.items.filter(i => !i.app)); emit(); } }
    loadItems();
  }
  /* The per-app choice, for a Settings page (skin-host api.inbox.sources, while feeds are on): every installed app
   * that has a feed, with whether it shows in Chats. set() saves it on the box (Notifications /api/sources). */
  async function sourceList() {
    if (!FD.on) return [];
    // The choice is re-read with every feed read; ask the box only when nothing has been read yet.
    const src = FD.sources || await loadSources(), k = known();
    return feedApps().filter(id => k[id] && k[id].s === 'yes').map(id => ({ id, name: appName(id), chats: shown(id, src) }));
  }
  async function setSource(app, patch) {
    if (!FD.on || !APPID.test(String(app)) || !installed() || typeof patch?.chats !== 'boolean') return false;
    let ok = false;
    try {
      const r = await timed(fetch('/notifications/api/sources', { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: String(app), chats: patch.chats }) }), 8000);
      if (r.ok) { const d = await r.json(); if (d && d.sources) FD.sources = d.sources; ok = true; }
    } catch (e) {}
    if (ok && !patch.chats && IN.items.some(i => i.app === app)) { IN.items = Object.freeze(IN.items.filter(i => i.app !== app)); emit(); }
    await loadItems();
    return ok;
  }
  function watch(fn) {
    if (typeof fn !== 'function') return () => {};
    IN.subs.add(fn); if (IN.items.length) { try { fn(IN.items); } catch (e) {} }
    loadItems();
    return () => { IN.subs.delete(fn); syncWatches(); };
  }
  function inboxChanged() { window.dispatchEvent(new CustomEvent('wizard:notifications')); }
  // Same rows as Chats Ready, including quiet/snoozed ones, never completed ones.
  const readyCount = () => window.WosSkinHost?.inboxList ? IN.items.filter(i => !i.archived).length : 0;
  async function mark(ids, marks) {
    ids = (ids || []).map(String).filter(Boolean); if (!ids.length) return false;
    const appIds = FD.on ? ids.filter(id => id.startsWith('a-')) : [];
    if (!installed() && appIds.length < ids.length) return false;
    // Moves at once; a failed write puts it back on the reload below. Archiving also marks read (the server does too).
    const next = { ...marks, ...(marks.archived ? { read: true } : {}) };
    IN.items = Object.freeze(IN.items.map(i => ids.includes(i.id) ? Object.freeze({ ...i, ...next }) : i)); for (const fn of [...IN.subs]) { try { fn(IN.items); } catch (e) {} }
    inboxChanged();
    // An app item's mark covers its activity as of now: newer activity in the app brings it back.
    const at = {}; for (const id of appIds) { const it = IN.items.find(i => i.id === id); at[id] = it ? it.time : Date.now() / 1000; }
    if (appIds.length) { FD.marks = { ...(FD.marks || {}) }; for (const id of appIds) FD.marks[id] = { ...(FD.marks[id] || {}), ...next, at: at[id] }; try { localStorage.setItem(MARK_KEY, JSON.stringify(FD.marks)); } catch (e) {} }
    let ok = !installed();
    try {
      if (installed()) { const r = await fetch('/notifications/api/mark', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, ...marks, ...(appIds.length ? { at } : {}) }) }); ok = r.ok; }
    } catch (e) {}
    await refresh(true); await loadItems();
    return ok;
  }
  // At most one count read every 10 s (60 s after a failure): a burst of registry events must
  // never become a request storm against the Notifications app (26 Oct 2026: ~50 req/s).
  // An owner action (mark) forces a read; one landing during an in-flight read reruns once right after it.
  let inflight = false, nextAt = 0, again = false;
  async function refresh(force) {
    if (!installed()) return;
    if (inflight) { if (force === true) again = true; return; }
    if (force !== true && Date.now() < nextAt) return;
    inflight = true; nextAt = Date.now() + 10000;
    loadItems();
    try {
      const r = await fetch('/notifications/api/count', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) { nextAt = Date.now() + 60000; return; }
      const d = await r.json();
      const ch = d.unread !== S.unread || d.needs !== S.needs;
      Object.assign(S, { unread: d.unread | 0, needs: d.needs | 0, ok: true, at: Date.now() });
      if (ch) { paint(); window.dispatchEvent(new CustomEvent('wizard:notifications', { detail: { ...S } })); }
    } catch (e) { nextAt = Date.now() + 60000; } finally { inflight = false; if (again) { again = false; refresh(true); } }
  }
  // The Notifications window tells us its count as soon as something is marked read.
  addEventListener('message', e => {
    const d = e.data; if (e.origin !== location.origin || !d || d.type !== 'wizard:notifications:count') return;
    S.unread = d.unread | 0; S.needs = d.needs | 0; paint(); loadItems();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('[data-chbell]')) return;
    e.preventDefault(); e.stopPropagation();
    if (typeof window.WizOpenApp === 'function') window.WizOpenApp('notifications');
  }, true);
  document.addEventListener('visibilitychange', () => { syncWatches(); if (!document.hidden) refresh(); });
  addEventListener('wizard:apps', () => { refresh(); paint(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  setTimeout(refresh, 800);
  window.WosBell = { html, refresh, paint, watch, mark, act, feeds, sources: Object.freeze({ list: sourceList, set: setSource }), readyCount, item: id => IN.items.find(i => i.id === String(id)) || null, items: () => IN.items, icon: BELL, get state() { return { ...S }; } };
})();
