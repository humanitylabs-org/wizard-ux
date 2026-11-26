/* Get set up (wizard-ux issue 1837, switch wizard/get-set-up, off by default). James, 25 Nov 2026: onboarding must not
 * overwhelm, so the accounts a Wizard can help with become an ongoing, optional list in Setup instead of first-run
 * steps. Right after the phone row: Email, Messages, Money, Calendar and Bring what your old AI knows (the Importer).
 * Each row says what it unlocks and whether it is done; nothing here is required to use Wizard.
 *
 * Done comes from the app itself, read on the box only while that app is installed (same origin, the owner's own
 * session, never a key): Mail api/accounts `connected`, Messenger api/unified/connectors (a connected network, as its
 * own Accounts page counts them), Finances api/overview (bank accounts), Calendar api/live `connected` or a saved iCal
 * source, Importer api/imports (something came in). An app that can't answer shows the row as not started.
 * Tap: an installed app opens (the shell's open-app message, as Recommended next does), where its own connect screen
 * is; an app not installed yet opens the Store at that app with open=1, so it installs and then opens.
 * The switch is read from the shell around this frame (data-tweaks); off, html() is '' and nothing is read. */
(() => {
  'use strict';
  const SWITCH = 'wizard/get-set-up';
  const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const imported = i => !!i && typeof i === 'object' && ['imported', 'partly'].includes(i.state || ((i.imported_at || i.archived_at) ? 'imported' : 'scanned'));
  const ROWS = [
    { id: 'wizard-mail', name: 'Email', ic: '✉️', line: 'I can sort your email and draft replies.',
      reads: [['api/accounts', 'mail', j => j.connected === true]] },
    { id: 'messenger', name: 'Messages', ic: '💬', line: 'I can keep up with your chats in one inbox.',
      reads: [['api/unified/connectors', '', j => (Array.isArray(j.providers) ? j.providers : []).some(p => p && (p.state === 'connected' || (Array.isArray(p.logins) && p.logins.length > 0)))]] },
    { id: 'finances', name: 'Money', ic: '💳', line: 'I can follow your spending and accounts.',
      reads: [['api/overview', '', j => (Array.isArray(j.accounts) && j.accounts.length > 0) || (Array.isArray(j.hidden_accounts) && j.hidden_accounts.length > 0)]] },
    { id: 'wizard-calendar', name: 'Calendar', ic: '📅', line: 'I can see your day and plan around it.',
      reads: [['api/live', 'calendar', j => j.connected === true], ['api/sources', 'calendar', j => Array.isArray(j.sources) && j.sources.length > 0]] },
    { id: 'importer', name: 'Bring what your old AI knows', ic: '🧠', line: 'I learn what ChatGPT or Claude already know about you.',
      reads: [['api/imports', 'importer', j => (Array.isArray(j.imports) ? j.imports : []).some(imported)]] },
  ];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const framed = () => { try { return parent !== window; } catch (_) { return false; } };
  // The shell paints its switches on its own <html>; Setup standalone (or a test) may carry them on its own.
  function on() {
    let t = '';
    try { if (framed()) t = parent.document.documentElement.getAttribute('data-tweaks') || ''; } catch (_) {}
    if (!t) try { t = document.documentElement.getAttribute('data-tweaks') || ''; } catch (_) {}
    return String(t).split(/\s+/).includes(SWITCH);
  }
  // urls: app id -> its address on this box (installed), or null when the list said it isn't; done: id -> boolean.
  let urls = null, status = 'idle', changed = () => {}, seq = 0;
  const done = new Map();
  const tsig = ms => { try { if (AbortSignal.timeout) return AbortSignal.timeout(ms); } catch (_) {} return undefined; };
  async function readJson(url, mark) {
    try {
      const headers = { Accept: 'application/json' };
      if (mark) headers['X-Wizard-Request'] = mark;
      const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', headers, signal: tsig(6000) });
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      return j && typeof j === 'object' ? j : null;
    } catch (_) { return null; }
  }
  function appsEndpoint() {
    try { const e = framed() && parent.WizConfig?.endpoint?.('apps'); if (typeof e === 'string' && e) return e; } catch (_) {}
    return '/wizard/v1/apps';
  }
  // Only an app on this same origin is read: its address comes from the box's own list.
  function sameOrigin(url) {
    try { const u = new URL(url, location.href); return u.origin === location.origin ? u : null; } catch (_) { return null; }
  }
  async function readApps() {
    const j = await readJson(appsEndpoint());
    if (!j || !Array.isArray(j.apps)) return false;
    const next = {};
    for (const r of ROWS) {
      const a = j.apps.find(x => x && x.id === r.id);
      next[r.id] = a && typeof a.url === 'string' && a.url ? a.url : null;
    }
    urls = next; return true;
  }
  async function readDone(row) {
    const base = urls?.[row.id] && sameOrigin(urls[row.id]);
    if (!base) return false;
    const dir = new URL(base.pathname.replace(/[^/]*$/, ''), base);
    for (const [path, mark, test] of row.reads) {
      const j = await readJson(new URL(path, dir).href, mark);
      try { if (j && test(j)) return true; } catch (_) {}
    }
    return false;
  }
  async function load() {
    if (!on()) return;
    const mine = ++seq;
    if (!urls) { status = 'loading'; changed(); }
    const ok = await readApps();
    if (mine !== seq) return;
    if (!ok && !urls) { status = 'error'; changed(); return; }
    status = 'ok'; changed();
    const results = await Promise.all(ROWS.map(r => readDone(r)));
    if (mine !== seq) return;
    ROWS.forEach((r, i) => done.set(r.id, results[i]));
    changed();
  }
  const CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  const TICK = '<svg class="okmark" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  function html() {
    if (!on()) return '';
    let h = '<section class="get-set-up" aria-label="Get set up" data-get-set-up><h2>Get set up</h2><p class="intro">Optional. Connect what you want, whenever you want, or just ask me.</p><div class="rows">';
    for (const r of ROWS) {
      const isDone = done.get(r.id) === true, installed = !!urls?.[r.id];
      const state = isDone ? 'done' : 'todo';
      const word = isDone ? 'Done' : 'Not started';
      h += `<button class="row wz-row" data-gsu="${esc(r.id)}" data-state="${state}" data-installed="${installed ? 1 : 0}">` +
        `<span class="ic" aria-hidden="true">${r.ic}</span><span class="bd"><b>${esc(r.name)}</b><small>${esc(r.line)}</small></span>` +
        `<span class="end"><span class="gsu-state">${word}</span>${isDone ? TICK : CHEV}</span></button>`;
    }
    h += '</div>';
    if (status === 'error') h += '<p class="muted gsu-note">Can’t check what’s connected right now.</p>';
    return h + '</section>';
  }
  function openApp(id) {
    if (framed()) { try { parent.postMessage({ type: 'wizard:open-app', id }, location.origin); return; } catch (_) {} }
    location.href = '../?open=' + encodeURIComponent(id);
  }
  // Not installed: the Store's page for that app; open=1 makes the Store open the app once it is in.
  function openStore(id) {
    const u = new URL('../store/index.html?app=' + encodeURIComponent(id) + '&open=1', location.href);
    try { if (framed() && parent.WizOpenApp?.('app-store', u.pathname + u.search)) return; } catch (_) {}
    if (framed()) { try { parent.postMessage({ type: 'wizard:open-app', id: 'app-store' }, location.origin); return; } catch (_) {} }
    location.href = u.href;
  }
  function tap(id) {
    if (!ID.test(id) || !ROWS.some(r => r.id === id) || !on()) return false;
    if (urls?.[id]) openApp(id); else openStore(id);
    return true;
  }
  document.addEventListener('click', e => {
    const b = e.target?.closest?.('[data-gsu]');
    if (b) tap(b.dataset.gsu);
  });
  // The switch can flip while Setup is open (Settings, another device): draw or drop the list at once.
  try {
    if (framed() && typeof MutationObserver === 'function') {
      new MutationObserver(() => { changed(); if (on()) load(); }).observe(parent.document.documentElement, { attributes: true, attributeFilter: ['data-tweaks'] });
    }
  } catch (_) {}
  window.WosGetSetUp = { html, load, tap, on, ROWS,
    init(render) { changed = render; },
    get state() { return { status, urls, done: Object.fromEntries(done) }; },
  };
})();
