/* Notifications bell on the Chats panel: a small bell beside search with the unread count from the installed
 * Notifications app (same origin /notifications/api/count; under the browser boundary the Service's shell-owned
 * notifications.count/.items/.mark operations). Tapping it opens Notifications as an ordinary app
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
  const IN = { items: [], subs: new Set(), seq: 0, seen: new Map() };
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  // The editor's short message is a preview, not the source. Keep the complete original separately, including
  // paragraphs and long diagnostic output. Legacy items without editor details use their complete body.
  const cleanItem = i => Object.freeze({ id: str(i.id, 80), title: str(i.title, 300), message: str(i.message, 8000), details: String(i.details || i.message || ''), time: Number(i.time) || 0, source: str(i.source, 40), priority: Number(i.priority) || 3, link: str(i.link, 2000), read: !!i.read, archived: !!i.archived, ...(typeof i.revision === 'string' ? { revision: str(i.revision, 40) } : {}) });
  /* Browser boundary on: the Notifications listener answers only the Agent Service adapter, so the shell document never
   * fetches /notifications/api/* itself. It asks the Service for one fixed answer through its own typed operations
   * (notifications.count / .items / .mark), like the model picker's models.claude_accounts. Off: unchanged. */
  const boundary = () => !!window.WizBrowserBoundary?.enabled;
  async function shellOp(operation, args) {
    const r = await fetch('/wizard/v1/browser-shell/call', { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, args }), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new TypeError('shell op ' + r.status);
    const v = await r.json();
    if (v?.state !== 'ok') throw new TypeError('shell op ' + (v?.state || 'bad'));
    return v;
  }
  async function readItems() {
    if (boundary()) return shellOp('notifications.items', {});
    const r = await fetch('/notifications/api/items?view=all&limit=200', { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok) throw new TypeError('items ' + r.status);
    return r.json();
  }
  async function readCount() {
    if (boundary()) return (await shellOp('notifications.count', {})).counts;
    const r = await fetch('/notifications/api/count', { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok) throw new TypeError('count ' + r.status);
    return r.json();
  }
  async function writeMarks(ids, marks) {
    if (!boundary()) {
      const r = await fetch('/notifications/api/mark', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, ...marks }) });
      return r.ok;
    }
    // Compare-and-set on the revisions the owner saw; an item without one (not loaded yet) is not written.
    const items = ids.map(id => ({ id, expectedRevision: (IN.seen.get(id) || '') })).filter(i => i.expectedRevision);
    if (!items.length) return false;
    const key = crypto.randomUUID ? crypto.randomUUID() : '00000000-0000-4000-8000-' + String(Date.now()).padStart(12, '0').slice(-12);
    await shellOp('notifications.mark', { items, marks: { ...marks }, operationKey: key });
    return true;
  }
  async function loadItems() {
    if (!IN.subs.size || !installed()) return;
    const seq = ++IN.seq;
    try {
      const d = await readItems();
      if (seq !== IN.seq || !Array.isArray(d.items)) return;
      const before = JSON.stringify(IN.items);
      IN.items = Object.freeze(d.items.filter(i => i && i.id).map(cleanItem).sort((a, b) => b.time - a.time));
      IN.seen = new Map(IN.items.filter(i => i.revision).map(i => [i.id, i.revision]));
      for (const fn of [...IN.subs]) { try { fn(IN.items); } catch (e) {} }
      if (before !== JSON.stringify(IN.items)) inboxChanged();
    } catch (e) {}
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
    ids = (ids || []).map(String).filter(Boolean); if (!ids.length || !installed()) return false;
    // Moves at once; a failed write puts it back on the reload below. Archiving also marks read (the server does too).
    const next = { ...marks, ...(marks.archived ? { read: true } : {}) };
    IN.items = Object.freeze(IN.items.map(i => ids.includes(i.id) ? Object.freeze({ ...i, ...next }) : i)); for (const fn of [...IN.subs]) { try { fn(IN.items); } catch (e) {} }
    inboxChanged();
    let ok = false;
    try { ok = await writeMarks(ids, marks); } catch (e) {}
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
      let d;
      try { d = await readCount(); } catch (e) { nextAt = Date.now() + 60000; return; }
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
  // Opaque Notifications frame (browser trust preview): it cannot post a count. After each write the shell proved
  // through a typed operation, the shell re-reads the count itself; the badge stays in its one place.
  addEventListener('wizard:browser-data-written', e => { if (e.detail?.appId === 'notifications') refresh(true); });
  document.addEventListener('click', e => {
    if (!e.target.closest('[data-chbell]')) return;
    e.preventDefault(); e.stopPropagation();
    if (typeof window.WizOpenApp === 'function') window.WizOpenApp('notifications');
  }, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  addEventListener('wizard:apps', () => { refresh(); paint(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  setTimeout(refresh, 800);
  window.WosBell = { html, refresh, paint, watch, mark, readyCount, item: id => IN.items.find(i => i.id === String(id)) || null, items: () => IN.items, icon: BELL, get state() { return { ...S }; } };
})();
