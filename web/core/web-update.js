/* Wizard OS · "Update ready" banner, shared by both shells (James, 14 Oct: "if I ask for a change on mobile,
 * the same change should reflect on desktop in a way that fits that form factor").
 *
 * Owns everything about a web/ update: noticing it (ux-version.txt, the git tree id of web/), naming the
 * thread(s) that made it (ux-changes.json), the banner with Thread / Threads ▾ beside Reload, Back/Esc folding
 * the list, and the guarded reload. A shell supplies only the host: where the banner mounts, how to open a
 * thread, when a reload is unsafe, what to save first. Layout lives in each shell's CSS (#dvWeb):
 * phone = glass strip under the status bar, desktop = pill in the top bar. Reloads only when tapped; a tap
 * made while a recording would be lost waits for that recording to end (see reload()). */
(() => {
  'use strict';
  const BASE = new URL('../', document.currentScript.src);
  const url = p => new URL(p, BASE).href;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let H = null; // host
  const log = (...a) => { try { H?.log?.(...a); } catch (_) {} };

  /* What changed is read from ux-version.txt, rewritten by the repo's commit/merge/checkout hooks
   * (tools/write-ux-version.sh), so any committed web change flips it. The Agent Service sends no
   * ETag/Last-Modified, so without the version file fall back to headers over every script and stylesheet the
   * page actually loaded (James, 11 Oct). */
  const assets = () => {
    const base = BASE.href, page = location.pathname.split('/').pop() || 'index.html', out = new Set([page]);
    document.querySelectorAll('script[src], link[rel="stylesheet"][href]').forEach(el => {
      const u = new URL(el.getAttribute('src') || el.getAttribute('href'), location.href);
      if (u.origin === location.origin && u.href.startsWith(base) && !/(^|\/)(data|summaries)\.js$/.test(u.pathname)) out.add(u.pathname.slice(BASE.pathname.length));
    });
    return [...out];
  };
  let print0 = '', printNow = '', pending = false, lastCheck = 0, changes = [], listOpen = false;
  const loadedAt = Date.now();
  async function fingerprint() {
    try {
      const r = await fetch(url('ux-version.txt'), { cache: 'no-store', credentials: 'same-origin' });
      const v = r.ok ? (await r.text()).trim() : '';
      if (/^[0-9a-f]{7,64}$/i.test(v)) return 'v:' + v;
    } catch (e) { return ''; }
    const parts = await Promise.all(assets().map(async a => {
      try {
        // GET (some proxies mishandle HEAD); only the headers are read, the body is dropped unread.
        const r = await fetch(url(a), { cache: 'no-store', credentials: 'same-origin' });
        try { r.body?.cancel(); } catch (e) {}
        if (!r.ok) return a + ':' + r.status;
        const lm = r.headers.get('last-modified') || '', et = r.headers.get('etag') || '', len = r.headers.get('content-length') || '';
        return a + ':' + (et || lm + '/' + len);
      } catch (e) { return null; }
    }));
    return parts.includes(null) ? '' : parts.join('|');
  }
  // Keeps checking while the banner is up, so a second deploy adds its thread to the banner too.
  async function check(force) {
    if ((!force && Date.now() - lastCheck < 60e3) || !navigator.onLine) return;
    lastCheck = Date.now();
    const p = await fingerprint(); if (!p) return;
    if (!print0) { print0 = printNow = p; return; }
    if (p === print0 || p === printNow) return;
    printNow = p;
    if (!pending) { pending = true; log('web:changed'); }
    await loadChanges(); window.WizAppServices?.update.announce({ version: p, changes }); render();
  }
  /* Which threads made the update: ux-changes.json lists every web/ change newest first with the thread that
   * committed it. Take the ones since the version this page loaded; one row per thread. */
  async function loadChanges() {
    if (!print0.startsWith('v:')) { changes = []; return; }
    try {
      const r = await fetch(url('ux-changes.json'), { cache: 'no-store', credentials: 'same-origin' });
      const d = r.ok ? await r.json() : null; const ups = Array.isArray(d?.updates) ? d.updates : [];
      const mine = print0.slice(2); let since = [];
      const k = ups.findIndex(u => u.before === mine);
      if (k >= 0) since = ups.slice(0, k + 1);
      else since = ups.filter(u => u.at * 1000 > loadedAt - 60e3).slice(0, 8);
      if (!since.length && ups[0]) since = [ups[0]];
      const out = [], seen = new Map();
      for (const u of since) for (const c of u.changes || []) {
        const key = c.thread || 'c:' + c.sha;
        if (seen.has(key)) continue;
        const row = { thread: c.thread || null, title: c.title || '', what: c.what || '' }; seen.set(key, row); out.push(row);
      }
      changes = out.slice(0, 8);
    } catch (e) { changes = []; }
  }
  // "Wizard OS · Bound views" → "Bound views": the banner already says what updated.
  const shortTitle = t => { const s = String(t || '').trim(); const i = s.indexOf(' · '); return (i > 0 && i < 24 ? s.slice(i + 3) : s) || ''; };
  const rowName = c => shortTitle(c.title) || c.what || 'A change';
  function goThread(id) {
    listOpen = false; render();
    if (!id) return;
    log('web:thread'); try { H?.openThread?.(id); } catch (_) {}
  }
  /* Reload safety (James, 18 Oct: "every time I try to reload it says please finish the recording first").
   * The host says when its own work is in flight (voice, a sheet, uploads); app services say which app holds
   * and recorders are in play. A native meeting (Android foreground service) keeps recording through a reload
   * and Mizel reattaches to it, so it no longer blocks. A recording that lives in this page (browser mic) or a
   * save in progress turns Reload into "Reload when recording ends": the reload then happens by itself, once,
   * right after the recording stops and saves. Nothing else ever reloads on its own. */
  function hostBusy() { try { return !!H?.busy?.(); } catch (_) { return true; } }
  function plan() {
    const svc = window.WizAppServices?.update;
    let p = null;
    try { p = svc?.reloadPlan?.() || null; } catch (_) { p = { ok: false, keeps: null, blocking: [{ kind: 'capture' }], recording: true }; }
    if (!p) { const b = !!svc?.busy?.(); p = { ok: !b, keeps: null, blocking: b ? [{ kind: 'work' }] : [], recording: false }; }
    return { ...p, host: hostBusy() };
  }
  function busy() { const p = plan(); return p.host || !p.ok; }
  let armed = null, going = false, armTimer = 0;
  // A wait worth arming: a recording/save that will end on its own, or app work beside a meeting that survives.
  // Never armed while the meeting's microphone is lent to the orb: that voice message ends by itself, but its
  // send follows straight after, and a reload mid-send is exactly what this guard is for.
  const loan = p => (p.blocking || []).some(b => b.reason === 'microphone_loan');
  // Otherwise arm only for a recording, or for the kept meeting app's own quick save (its notes); another app's
  // unsaved work is never a reason to reload on its own later.
  const armable = p => !p.host && !loan(p) && (p.recording || (!!p.keeps && (p.blocking || []).every(b => b.appId === p.keeps.appId)));
  function arm(p) {
    armed = { at: Date.now(), recording: p.recording };
    log('web:reload-armed', p.recording ? 'recording' : 'saving');
    H?.toast?.('◌', p.recording ? 'Reloads when the recording ends' : 'Reloads as soon as it’s saved', 2200);
    clearInterval(armTimer); armTimer = setInterval(maybeFire, 1000); // host busy (voice, uploads) has no event
    render();
  }
  function disarm(why) { if (!armed) return; armed = null; clearInterval(armTimer); armTimer = 0; log('web:reload-disarmed', why || ''); render(); }
  function maybeFire() {
    if (!armed || going) return;
    const p = plan();
    if (p.host || !p.ok) { if (!!p.recording !== armed.recording) { armed.recording = !!p.recording; render(); } return; }
    disarm('ready'); void go('deferred', p);
  }
  async function go(why, p) {
    if (going) return false; going = true;
    try { H?.beforeReload?.(); } catch (_) {}
    window.WizAppReadingPosition?.flush();
    if (p?.keeps) {
      log('web:reload-keeps', p.keeps.appId);
      try { await window.WizAppServices?.update.prepareReload?.(p); } catch (_) {}
    }
    log('web:reload', why); window.__wosReloading = why; location.reload(); return true;
  }
  function reload(why) {
    if (going) return false;
    if (armed && why === 'tap') { disarm('tap'); H?.toast?.('◌', 'Reload cancelled', 1400); return false; }
    const p = plan();
    if (!p.host && p.ok) { void go(why, p); return true; }
    if (armable(p)) { arm(p); return false; }
    H?.toast?.('◌', loan(p) ? 'Finish the voice message first' : 'Finish recording or save your work first', 2000); return false;
  }
  /* The banner says which thread the update came from and links there, so you can see what a reload brings
   * (James, 12 Oct): "Update ready / Bound views  [Thread] [Reload]". Several threads: "[Threads ▾]" opens a
   * short list; Back/Esc closes the list. Nothing known (no change list): "Wizard OS was updated". */
  function render() {
    if (!pending || !H) return;
    let el = document.getElementById('dvWeb');
    if (!el) {
      el = document.createElement('div'); el.id = 'dvWeb'; el.className = 'dv-update web'; el.setAttribute('role', 'status');
      el.dataset.shell = H.shell || '';
      const at = H.mount?.() || document.body; H.prepend ? at.prepend(el) : at.appendChild(el);
      el.addEventListener('click', e => {
        if (e.target.closest('[data-web="go"]')) { reload('tap'); return; }
        const t = e.target.closest('[data-web-thread]'); if (t) { goThread(t.dataset.webThread); return; }
        if (e.target.closest('[data-web="list"]')) { listOpen = !listOpen; log('web:list', listOpen ? 'open' : 'close'); render(); }
      });
    }
    const linked = changes.filter(c => c.thread), names = changes.map(rowName);
    // Desktop has no toast near the card: say it in place. Armed = Reload was tapped and waits for the end.
    const wait = armed ? (armed.recording ? 'Update ready · reloads after the recording' : 'Update ready · reloads once saved')
      : H.shell === 'desktop' && busy() ? 'Update ready · finish recording first' : '';
    const held = !!wait && (H.shell === 'desktop' || !!armed);
    const head = held ? wait : 'Update ready';
    // Two lines so the thread name gets the width: "Update ready" small, the thread it came from bold.
    const msg = !changes.length ? (held ? wait : 'Wizard OS was updated')
      : `<small>${esc(head)}</small><b>${esc(names[0])}</b>`;
    const sec = !linked.length ? '' : changes.length === 1
      ? `<button class="later dv-wt" data-web-thread="${esc(linked[0].thread)}" aria-label="Open the thread: ${esc(names[0])}" title="Open the thread that made this update">Thread</button>`
      : `<button class="later dv-wt" data-web="list" aria-expanded="${listOpen}" aria-label="Show the ${changes.length} threads in this update">Threads${listOpen ? ' ▴' : ' ▾'}</button>`;
    const list = listOpen && changes.length > 1 ? `<div class="dv-wl" role="list">${changes.map(c => c.thread
      ? `<button class="dv-wr" role="listitem" data-web-thread="${esc(c.thread)}"><b>${esc(rowName(c))}</b>${c.title && c.what ? `<small>${esc(c.what)}</small>` : ''}<span class="dv-wgo">›</span></button>`
      : `<div class="dv-wr static" role="listitem"><b>${esc(rowName(c))}</b><small>No thread</small></div>`).join('')}</div>` : '';
    el.classList.toggle('open', !!list);
    const mark = changes.length ? '' : `<span class="dv-ui">${window.WizBrand?.html || '✦'}</span>`;
    el.innerHTML = `<div class="dv-wtop">${mark}<span class="dv-um${changes.length ? ' two' : ''}">${changes.length ? msg : esc(msg)}</span>${sec}${armed ? `<button data-web="go" class="armed" aria-pressed="true" title="Tap to cancel the waiting reload">${armed.recording ? 'Reload when recording ends' : 'Reload when saved'}</button>` : '<button data-web="go" title="Reload Wizard OS into the new version">Reload</button>'}</div>${list}`;
  }
  // Back (phone) / Esc (desktop): fold an open thread list first. Returns true when it took the press.
  function back() { if (listOpen && pending) { listOpen = false; render(); return true; } return false; }

  let polling = false;
  function init(host) {
    H = host || {};
    if (pending) render();
    if (polling) return;
    polling = true;
    setTimeout(() => check(true), 1500);
    setInterval(() => { if (!document.hidden) check(false); }, 60e3); // one tiny text file a minute
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(false); });
    addEventListener('wos-native-resume', () => check(false));
    addEventListener('wizard:app-holds', () => { if (armed) maybeFire(); if (pending) render(); });
    addEventListener('wizard-app-capture-state', () => { if (armed) maybeFire(); });
  }
  window.WizWebUpdate = Object.freeze({
    init, check, back, reload, busy, render, plan,
    get armed() { return !!armed; },
    get pending() { return pending; },
    _state: () => ({ pending, print0: !!print0, changes, listOpen }),
  });
  // Older name used by hosted-app QA and the app services layer.
  window.WizAppUpdates = Object.freeze({ check: () => check(true), busy });
})();
