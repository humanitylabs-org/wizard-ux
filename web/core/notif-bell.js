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
   * newer activity brings it back. Which apps have a feed is learnt once per app (6 h for a "no"). */
  const FEED_KEY = 'wos.inbox.feeds.v1', MARK_KEY = 'wos.inbox.appmarks.v1';
  const FEED_SKIP = new Set(['notifications', 'wizard', 'wizard-agent-service', 'wizard-ux', 'setup', 'side-button', 'pages']);
  const FD = { known: (() => { try { return JSON.parse(localStorage.getItem(FEED_KEY) || '{}') || {}; } catch (e) { return {}; } })(), last: {}, marks: null };
  const saveKnown = () => { try { localStorage.setItem(FEED_KEY, JSON.stringify(FD.known)); } catch (e) {} };
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
  async function getFeed(id) {
    const r = await timed(fetch(`/${id}/api/inbox`, { cache: 'no-store', credentials: 'same-origin', redirect: 'error' }));
    if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) return null;
    const d = await r.json();
    return d && d.inbox === 1 && Array.isArray(d.items) ? d.items : null;
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
  async function loadFeeds() {
    const now = Date.now(), apps = feedApps(), out = [];
    await Promise.all(apps.map(async id => {
      const k = FD.known[id];
      if (k && k.s === 'no' && now - k.at < 6 * 3600e3) return;
      try {
        const items = await getFeed(id);
        if (!items) { if (!k || k.s !== 'yes') { FD.known[id] = { s: 'no', at: now }; saveKnown(); } else if (FD.last[id]) out.push(...FD.last[id].items); return; }
        if (!k || k.s !== 'yes') { FD.known[id] = { s: 'yes', at: now }; saveKnown(); }
        const list = items.slice(0, 50).map(it => fromFeed(id, it)).filter(Boolean);
        FD.last[id] = { at: now, items: list }; out.push(...list);
      } catch (e) {
        // A feed that stops answering keeps its last items a few minutes (no flicker), then they go.
        if (FD.last[id] && now - FD.last[id].at < 5 * 60e3) out.push(...FD.last[id].items);
        else if (!k) { FD.known[id] = { s: 'no', at: now }; saveKnown(); }
      }
    }));
    if (out.length) await loadMarks();
    const M = FD.marks || {};
    return out.map(it => { const m = M[it.id]; const covers = m && Number(m.at) >= it.time; return { ...it, read: !!(covers && (m.read || m.archived)), archived: !!(covers && m.archived) }; });
  }
  async function loadItems() {
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
    const it = IN.items.find(i => i.id === String(id)); if (!it || !it.app || !it.actions.some(a => a.id === action && !a.ask)) return false;
    let ok = false;
    try {
      const r = await timed(fetch(`/${it.app}/api/inbox/act`, { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: it.key, action, ...(text ? { text: String(text).slice(0, 8000) } : {}) }) }), 15000);
      ok = r.ok;
    } catch (e) {}
    if (ok) { IN.items = Object.freeze(IN.items.filter(i => i.id !== it.id)); for (const fn of [...IN.subs]) { try { fn(IN.items); } catch (e) {} } inboxChanged(); }
    await loadItems();
    return ok;
  }
  function watch(fn) {
    if (typeof fn !== 'function') return () => {};
    IN.subs.add(fn); if (IN.items.length) { try { fn(IN.items); } catch (e) {} }
    loadItems();
    return () => { IN.subs.delete(fn); };
  }
  function inboxChanged() { window.dispatchEvent(new CustomEvent('wizard:notifications')); }
  // Same rows as Chats Ready, including quiet/snoozed ones, never completed ones.
  const readyCount = () => window.WosSkinHost?.inboxList ? IN.items.filter(i => !i.archived).length : 0;
  async function mark(ids, marks) {
    ids = (ids || []).map(String).filter(Boolean); if (!ids.length) return false;
    const appIds = ids.filter(id => id.startsWith('a-'));
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
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  addEventListener('wizard:apps', () => { refresh(); paint(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  setTimeout(refresh, 800);
  window.WosBell = { html, refresh, paint, watch, mark, act, readyCount, item: id => IN.items.find(i => i.id === String(id)) || null, items: () => IN.items, icon: BELL, get state() { return { ...S }; } };
})();
