/* Wizard UX core: banners that sit above every screen, in both shells (feature/chat-polish).
 *
 *   Connection  "Offline — …" / "Reconnecting…" / "Back online" (2 s), from the browser's online state and
 *               from whether the last Wizard read worked (WizLive.error === 'offline').
 *   Critical    "N critical issues need attention · View" (opens Chats on the phone) for threads Wizard marked critical
 *               (attention_level === 'critical'), except ones already shown as errors and the thread in front.
 *   Fatal       "Wizard needs attention · <message> · Reload": the shell failed to start (an uncaught error and
 *               no shell API a few seconds after load), or a caller hands one over with WizCore.status.fatal().
 *
 * Loaded right after core/config.js so it can see boot errors. A shell plugs in with
 *   WizCore.status.attach({ openChats(), inboxOpen(), current() })     current() = the thread in front, or ''
 * Back: WizCore.status.back() closes the fatal card (Chats' closeOverlay asks it first), returns a step name or ''.
 */
(() => {
  'use strict';
  const C = window.WizCore = window.WizCore || {};
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const agent = () => { try { return window.WizConfig?.agent() || 'Wizard'; } catch (e) { return 'Wizard'; } };
  let netOpen = false;
  let H = {}, net = navigator.onLine === false ? 'offline' : 'online', restoredT = 0, critHidden = '', fatalMsg = '', fatalOpen = false;
  const log = s => { window.__statusLog = (window.__statusLog || []).concat(s).slice(-40); };

  /* ---------- boot errors → fatal card ---------- */
  const bootErrors = [];
  addEventListener('error', e => { if (!shellUp()) bootErrors.push(String(e.message || e.error || 'Script error')); }, true);
  addEventListener('unhandledrejection', e => { if (!shellUp()) bootErrors.push(String(e.reason?.message || e.reason || 'Promise rejected')); });
  function shellUp() { return !!(window.__wos || window.__wux); }
  addEventListener('load', () => setTimeout(() => {
    if (shellUp() || document.documentElement.dataset.leaving) return;
    // A boot error is most often a phone mixing cached files from two releases: reload once to fetch one matching
    // set before showing the card (Robert's iPhone, 24 Oct 2026). Once per minute per tab, so a real bug can't loop.
    if (bootErrors.length) try {
      const k = 'wos.bootReloadAt', t = +sessionStorage.getItem(k) || 0;
      if (Date.now() - t > 60e3) { sessionStorage.setItem(k, String(Date.now())); log('fatal:auto-reload'); location.reload(); return; }
    } catch (e) {}
    fatal(bootErrors.length ? `${agent()} couldn’t start on this device: ${bootErrors[0].replace(/^Uncaught\s+/, '').slice(0, 160)}` : `${agent()} couldn’t start on this device.`);
  }, 2500));

  /* ---------- DOM ---------- */
  function host() { return document.getElementById('device') || document.body; }
  function box() {
    let el = document.getElementById('wxBanners');
    if (!el) { el = document.createElement('div'); el.id = 'wxBanners'; el.className = 'wx-banners'; host().appendChild(el); el.addEventListener('click', onClick); }
    return el;
  }
  function onClick(e) {
    if (e.target.closest('[data-wxtroubleshoot]')) { window.WizReach?.open(); return; }
    if (e.target.closest('[data-wxmore]')) { netOpen = !netOpen; log('net:' + (netOpen ? 'open' : 'fold')); unfold(); return; }
    if (e.target.closest('[data-wxretry]')) { window.WosOutbox?.retryAll(); LIVE()?.refresh(); return; }
    if (e.target.closest('[data-wxcrit-x]')) { critHidden = critSig(); log('critical:dismiss'); render(); return; }
    if (e.target.closest('[data-wxcrit]')) { log('critical:open'); H.openChats?.(); render(); }
  }
  function unfold() {
    const b = document.querySelector?.('#wxBanners .wx-banner.net'); if (!b?.classList) return;
    b.classList.toggle('open', netOpen); b.querySelector('[data-wxmore]')?.setAttribute('aria-expanded', String(netOpen));
  }
  const LIVE = () => window.WizLive || null;

  /* ---------- connection state ---------- */
  function setNet(n) {
    if (n === net || (n === 'online' && net === 'restored')) return;
    const was = net; clearTimeout(restoredT);
    // Coming back from offline/reconnecting says so for 2 s, then the banner goes.
    if (n === 'online' && (was === 'offline' || was === 'reconnecting')) {
      n = 'restored';
      restoredT = setTimeout(() => { if (net === 'restored') { net = 'online'; log('net:online'); render(); } }, 2000);
    }
    net = n; log('net:' + n);
    render();
  }
  // Browser connectivity is a hint: Android/VPN networks can report offline while
  // Wizard is reachable. Only a NEW successful read may overrule an offline event;
  // cached sessions and local optimistic updates are not connectivity evidence.
  let offlineReadAt = 0;
  function fromLive() {
    const L = LIVE(); if (!L) return;
    if (L.ok && !L.error && L.at > offlineReadAt) return setNet('online');
    if (navigator.onLine === false) return setNet('offline');
    if (L.error) { if (net !== 'offline' || navigator.onLine) setNet('reconnecting'); return; }
  }
  addEventListener('offline', () => {
    const L = LIVE(); offlineReadAt = L?.at || 0;
    setNet('offline');
    // Verify against Wizard itself, even if the browser never emits 'online'.
    L?.refresh();
  });
  addEventListener('online', () => { setNet('reconnecting'); const L = LIVE(); if (L) L.refresh(); else setNet('online'); });

  /* ---------- critical issues (legacy attention.ts) ---------- */
  const ERR = new Set(['failed', 'interrupted']);
  function criticals() {
    const L = LIVE(); if (!L?.ok) return [];
    const cur = H.current?.() || '';
    return L.sessions.filter(s => s.critical && !s.hidden && !s.archived && !ERR.has(s.status) && s.id !== cur);
  }
  const critSig = () => criticals().map(s => s.id).sort().join(',');

  /* ---------- render ---------- */
  let lastHtml = '';
  function render() {
    const parts = [];
    const waiting = window.WosOutbox?.unsent().some(it => it.state === 'waiting');
    if (!(net === 'offline' || net === 'reconnecting' || waiting)) netOpen = false;
    if (net === 'offline' || net === 'reconnecting' || waiting) {
      const diagnosis = window.WizReach?.failure();
      const full = diagnosis?.message || 'Checking the connection to Wizard. Messages are kept on this device while we retry.';
      // One quiet pill in both shells (James, 22 Oct): short line + two small taps; tapping the line unfolds the full
      // diagnosis under it. It never grows into a card that pushes the screen down.
      const kind = net === 'offline' ? 'offline' : 'reconnecting';
      const short = String(diagnosis?.short || 'Reconnecting to Wizard').replace(/ · retrying$/, ''); // the spinner already says it
      parts.push(`<div class="wx-banner net ${kind}" role="status" title="${esc(full)}" data-wxnet="${kind}"><span class="wx-row"><span class="wx-spin" aria-hidden="true"></span><button type="button" class="wx-s" data-wxmore aria-expanded="false" aria-label="${esc(full)}">${esc(short)}</button><span class="wx-actions"><button type="button" data-wxretry aria-label="Retry now">Retry</button><button type="button" data-wxtroubleshoot aria-label="Open Troubleshooter">Troubleshoot</button></span></span><span class="wx-m">${esc(full)}</span></div>`);
    }
    else if (net === 'restored') parts.push(`<div class="wx-banner net restored" role="status" data-wxnet="restored"><span class="wx-i">✓</span><span class="wx-m">Back online</span></div>`);
    const crit = criticals(), sig = crit.map(s => s.id).sort().join(',');
    if (crit.length && sig !== critHidden && !H.inboxOpen?.()) {
      const n = crit.length;
      const detail = `Tap to see ${n === 1 ? 'the critical issue' : 'the critical issues'}.`;
      parts.push(`<div class="wx-banner crit" role="alert" data-wxcritbox><button class="wx-crit" data-wxcrit title="${esc(detail)}" aria-label="${n} critical ${n === 1 ? 'issue needs' : 'issues need'} attention. ${esc(detail)}"><span class="wx-i">!</span><span class="wx-m">${n} critical ${n === 1 ? 'issue needs' : 'issues need'} attention<small> · ${esc(detail)}</small></span><span class="wx-go" aria-hidden="true">View ›</span></button><button class="wx-x" data-wxcrit-x aria-label="Hide until something changes">×</button></div>`);
    }
    const html = parts.join('');
    if (html === lastHtml && document.getElementById('wxBanners')) return;
    lastHtml = html;
    const el = box(); el.innerHTML = html; el.hidden = !html; unfold();
    // The unfolded diagnosis floats over the screen; only the one-line pill makes room.
    document.documentElement.style?.setProperty('--wx-banner-height', `${Math.ceil((el.getBoundingClientRect?.().height || 28) - (el.querySelector?.('.wx-banner.net.open .wx-m')?.getBoundingClientRect?.().height || 0)) + 10}px`);
    document.getElementById('device')?.classList.toggle('wx-on', !!html);
    document.documentElement.classList.toggle('wx-banner-on', !!html);
  }

  /* ---------- fatal card ---------- */
  function fatal(message) {
    fatalMsg = String(message || 'Something went wrong.'); fatalOpen = true; log('fatal');
    let el = document.getElementById('wxFatal');
    if (!el) {
      el = document.createElement('div'); el.id = 'wxFatal'; el.className = 'wx-fatal'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'wxFatalT');
      (document.body || document.documentElement).appendChild(el);
      el.addEventListener('click', e => {
        if (e.target.closest('[data-wxreload]')) { log('fatal:reload'); location.reload(); }
        if (e.target.closest('[data-wxfatal-x]')) closeFatal();
      });
    }
    el.innerHTML = `<div class="wx-fcard"><div class="wx-fi" aria-hidden="true">!</div><b id="wxFatalT">${esc(agent())} needs attention</b><p>${esc(fatalMsg)}</p><p class="wx-fnote">Your drafts and unsent messages are saved on this device.</p><button class="wx-reload" data-wxreload>Reload</button><button class="wx-fx" data-wxfatal-x>Not now</button></div>`;
    el.hidden = false; setTimeout(() => el.querySelector('[data-wxreload]')?.focus(), 0);
  }
  function closeFatal() { const el = document.getElementById('wxFatal'); if (!el || el.hidden) return false; el.hidden = true; fatalOpen = false; log('fatal:close'); return true; }

  C.status = {
    attach(h) { H = Object.assign({}, H, h || {}); fromLive(); render(); const L = LIVE(); if (L && !L.__wxStatus) { L.__wxStatus = true; L.onChange(() => { fromLive(); render(); }); } const O = window.WosOutbox; if (O && !O.__wxStatus) { O.__wxStatus = true; O.onChange(render); } },
    refresh() { fromLive(); render(); },
    fatal, back: () => (closeFatal() ? 'fatal' : ''),
    get state() { return { net, critical: criticals().map(s => s.id), fatal: fatalOpen ? fatalMsg : '' }; },
  };
  // Cheap catch-all for things with no event (the thread in front changed, the inbox opened or closed).
  addEventListener('wizreachchange', render);
  addEventListener('resize', () => { lastHtml = ''; render(); });
  setInterval(() => { if (!document.hidden && document.getElementById('wxBanners')) render(); }, 1200);
})();
