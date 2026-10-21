/* Setup — Wizard OS system app `setup` (contract: phone-setup-tailscale "Setup app").
 * Design: Claude Fable, two rounds on 14 Oct 2026; Archimedes built it as specified.
 *
 * Screens are in-app layers on the shared WizardApp Back client; the frame's URL never changes:
 *   checklist (root) → "Use Wizard on your phone" → overflow menu → disconnect sheet.
 *   Back closes the top layer; at the checklist the app declines and the shell takes the step (Home). Never exits.
 * Agent Service API (owner-only, same origin):
 *   GET /wizard/v1/setup · POST /wizard/v1/setup/seen · GET /wizard/v1/setup/phone
 *   POST /wizard/v1/setup/phone/start · POST /wizard/v1/setup/phone/reset
 * Polling: GET …/setup/phone every 2 s only while the phone screen is actually on screen (IntersectionObserver against
 * the shell's viewport, so another desk or workspace stops it) and the page is visible; one immediate fetch on return.
 * Links leave through ordinary target=_blank anchors: the shell's frame guard hands them to the system browser
 * (Mac app, Android app) or a new tab. The app never calls window.open.
 * QR codes are drawn locally from vendor/qrcode.js (MIT, see provenance.json); no address leaves the device. */
(() => {
  'use strict';
  const API = '/wizard/v1/setup';
  const STEPS = new Set(['unavailable', 'off', 'signin', 'https', 'serving', 'phone_seen']);
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const log = s => { window.__setupLog = (window.__setupLog || []).concat(s).slice(-80); };
  const framed = parent !== window;
  const root = document.documentElement;

  // Layout follows the shell this frame lives in (phone desks or desktop windows); standalone guesses from the device.
  const layout = (() => {
    let k = ''; try { if (framed) k = parent.document.documentElement.dataset.shell || ''; } catch (e) {}
    if (k === 'phone' || k === 'desktop') return k;
    return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600 ? 'phone' : 'desktop';
  })();
  root.dataset.layout = layout;
  if (!framed) root.setAttribute('data-standalone', '');
  const phoneLayout = layout === 'phone';
  const shellApi = () => { try { return framed ? parent : null; } catch (e) { return null; } };
  const ownerName = () => { try { const n = shellApi()?.WizConfig?.owner?.(); if (typeof n === 'string') return n.trim(); } catch (e) {} return S.owner; };
  const tourPending = () => { try { return !!shellApi()?.WosSetupLaunch?.tourPending; } catch (e) { return false; } };
  const tourAvailable = () => { try { return phoneLayout && !!shellApi()?.WosSetupLaunch && !!shellApi()?.WosTour; } catch (e) { return false; } };

  const S = {
    owner: '',
    list: { status: 'loading', data: null },
    firstRun: false, seenPosted: false, seenTries: 0,
    screen: 'list',
    phone: { status: 'loading', data: null, banner: false },
    starting: false, startUntil: 0, opErr: '', openedAuth: '',
    menu: false, sheet: false,
  };

  async function api(method, path) {
    try {
      const r = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store',
        ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}) });
      if (r.status === 401 || r.status === 403) return { kind: 'denied' };
      if (r.status === 404) return { kind: 'missing' };
      if (!r.ok) return { kind: 'neterr', status: r.status };
      const j = await r.json().catch(() => null);
      return j && typeof j === 'object' ? { kind: 'ok', data: j } : { kind: 'neterr' };
    } catch (e) { return { kind: 'neterr' }; }
  }
  const validPhone = d => d && STEPS.has(d.step);
  const str = v => (typeof v === 'string' && v ? v : '');
  const httpUrl = v => { const s = str(v); try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch (e) { return ''; } };

  // The native Connect screen consumes an origin, never credentials or an arbitrary deep link.
  function connectPayload(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash) return '';
      return 'wizard://connect?origin=' + encodeURIComponent(u.origin);
    } catch (e) { return ''; }
  }

  /* ---------------- data ---------------- */
  async function loadList() {
    const r = await api('GET', API);
    if (r.kind === 'ok') {
      S.list = { status: 'ok', data: r.data };
      if (r.data.first_run === true) S.firstRun = true;
      window.WosRecommended?.load();
      if (r.data.first_run === false) window.WosRecommended?.prefetch();
    } else S.list = { status: r.kind, data: S.list.data };
    renderList();
    if (S.firstRun && !S.seenPosted) postSeen();
  }
  async function postSeen() {
    if (S.seenPosted || S.seenTries >= 2) return;
    S.seenTries++; S.seenPosted = true;
    const r = await api('POST', API + '/seen');
    log('seen:' + r.kind);
    if (r.kind !== 'ok') S.seenPosted = false; // one retry, on the next return to the page
    else window.WosRecommended?.prefetch(); // after first Setup is recorded; WAM persists/resumes the pull-only job
  }
  let phoneSeq = 0;
  async function loadPhone() {
    const seq = ++phoneSeq;
    const r = await api('GET', API + '/phone');
    if (seq !== phoneSeq) return;
    if (r.kind === 'ok' && validPhone(r.data)) applyPhone(r.data);
    else if (r.kind === 'denied' || r.kind === 'missing') { S.phone = { status: r.kind, data: null, banner: false }; S.starting = false; }
    else if (S.phone.data) S.phone.banner = true;
    else S.phone = { status: 'neterr', data: null, banner: false };
    if (S.starting && Date.now() > S.startUntil) { S.starting = false; S.opErr = 'That didn’t work. Try again.'; log('start:timeout'); }
    renderPhone();
  }
  function applyPhone(d) {
    S.phone = { status: 'ok', data: d, banner: false };
    if (!S.starting) return;
    const auth = httpUrl(d.auth_url);
    if (d.step === 'signin' && auth) { S.starting = false; if (S.openedAuth !== auth) { S.openedAuth = auth; openOutside(auth); } }
    else if (['https', 'serving', 'phone_seen', 'unavailable'].includes(d.step) || str(d.error)) S.starting = false;
  }
  async function start() {
    S.starting = true; S.opErr = ''; S.startUntil = Date.now() + 15000; log('start');
    renderPhone();
    const r = await api('POST', API + '/phone/start');
    if (r.kind === 'ok' && validPhone(r.data)) applyPhone(r.data);
    else if (r.kind === 'denied' || r.kind === 'missing') { S.starting = false; S.phone = { status: r.kind, data: null, banner: false }; }
    else { S.starting = false; S.opErr = 'That didn’t work. Try again.'; }
    renderPhone(); schedule(S.starting ? 1000 : 2000);
  }
  async function reset() {
    closeSheet();
    const r = await api('POST', API + '/phone/reset');
    if (r.kind === 'ok') {
      S.openedAuth = ''; S.opErr = '';
      applyPhone(validPhone(r.data) ? r.data : { ...(S.phone.data || {}), step: 'off', auth_url: null, https_enable_url: null, wizard_url: null, device_name: null, phones: [], error: null });
      toast('Disconnected');
    } else if (r.kind === 'denied' || r.kind === 'missing') S.phone = { status: r.kind, data: null, banner: false };
    else S.opErr = 'That didn’t work. Try again.';
    renderPhone(); schedule(2000);
  }

  /* ---------------- polling: only while the phone screen is on screen ---------------- */
  let pollT = 0, inView = false;
  const wantPoll = () => S.screen === 'phone' && document.visibilityState === 'visible' && inView && !['denied', 'missing'].includes(S.phone.status);
  function schedule(ms) {
    clearTimeout(pollT); pollT = 0;
    if (!wantPoll()) return;
    pollT = setTimeout(async () => { pollT = 0; if (!wantPoll()) return; await loadPhone(); schedule(S.starting ? 1000 : 2000); }, ms);
  }
  function nudge() { if (wantPoll()) schedule(0); }
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => {
    const was = inView; inView = es.some(e => e.isIntersecting);
    if (inView && !was) nudge(); else if (!inView) schedule(0);
  }) : null;
  if (io) io.observe($('phone')); else inView = true;
  // The checklist refreshes whenever it comes back into view (Back from the phone screen, another desk, the tour).
  const ioList = 'IntersectionObserver' in window ? new IntersectionObserver(es => { if (S.screen === 'list' && es.some(e => e.isIntersecting)) { renderList(); loadList(); } }) : null;
  if (ioList) ioList.observe($('list'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') { schedule(0); return; }
    if (S.screen === 'phone') nudge(); else loadList();
    if (S.firstRun && !S.seenPosted) postSeen();
  });
  const onFocus = () => { if (S.screen === 'phone') nudge(); };
  addEventListener('focus', onFocus);
  try { if (framed) { parent.addEventListener('focus', onFocus); addEventListener('pagehide', () => { try { parent.removeEventListener('focus', onFocus); } catch (e) {} }); } } catch (e) {}

  /* ---------------- layers + Back ---------------- */
  const WA = window.WizardApp;
  let menuHold = null, sheetHold = null;
  function openPhone() {
    if (S.screen === 'phone') return;
    S.screen = 'phone'; S.opErr = '';
    if (S.phone.status !== 'ok') S.phone = { status: 'loading', data: null, banner: false }; // a refused/missing/failed answer is re-asked, never remembered
    $('list').hidden = true; $('phone').hidden = false; scrollTo(0, 0);
    renderPhone(); log('screen:phone');
    if (!io) nudge(); // with an observer, the first intersection starts polling
    else if (inView) nudge();
  }
  function closePhone() {
    if (S.screen !== 'phone') return false;
    closeSheet(); closeMenu();
    S.screen = 'list'; schedule(0); phoneSeq++; S.starting = false;
    $('phone').hidden = true; $('list').hidden = false; scrollTo(0, 0);
    log('screen:list'); if (!ioList) loadList(); else renderList();
    return true;
  }
  function openMenu() { if (S.menu) return; S.menu = true; $('menu').hidden = false; $('scrim').hidden = false; menuHold = WA?.back.push(() => { closeMenu(true); return true; }); }
  function closeMenu(fromBack) { if (!S.menu) return; S.menu = false; $('menu').hidden = true; if (!S.sheet) $('scrim').hidden = true; const h = menuHold; menuHold = null; if (!fromBack) h?.release(); }
  function openSheet() { closeMenu(); S.sheet = true; $('sheet').hidden = false; $('scrim').hidden = false; sheetHold = WA?.back.push(() => { closeSheet(true); return true; }); }
  function closeSheet(fromBack) { if (!S.sheet) return; S.sheet = false; $('sheet').hidden = true; $('scrim').hidden = true; const h = sheetHold; sheetHold = null; if (!fromBack) h?.release(); }
  WA?.back.register({ canGoBack: () => S.screen === 'phone', back: () => closePhone() });
  window.__setup = { get state() { return S; }, get polling() { return !!pollT; }, get inView() { return inView; }, back: () => WA ? WA.back : null, layout };

  /* ---------------- leaving Wizard ---------------- */
  function openOutside(url) {
    log('out:' + url);
    const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------------- render: checklist ---------------- */
  const CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  function renderList() {
    const L = S.list, owner = ownerName();
    let h = '<h1>Setup</h1>';
    if (S.firstRun) h += `<p class="greet">${owner ? `Hi ${esc(owner)}. ` : ''}Make this Wizard yours.</p>`;
    if (L.status === 'denied') { $('list').innerHTML = h + '<div class="state"><p>Only Wizard’s owner can use Setup.</p></div>'; return; }
    if (L.status === 'missing') { $('list').innerHTML = h + '<div class="state"><p>This Wizard doesn’t have Setup yet.</p><p class="muted">Update Wizard, then come back.</p></div>'; return; }
    const item = (L.data?.items || []).find(i => i && i.id === 'phone') || { id: 'phone', title: 'Use Wizard on your phone', state: '' };
    const st = L.status === 'loading' ? 'loading' : L.status === 'neterr' ? 'neterr' : item.state;
    const line = { loading: 'Checking…', neterr: 'Can’t check right now.', todo: 'From anywhere, not just at home.', in_progress: 'Not finished. Pick up where you left off.', done: 'Your phone is connected.' }[st] || 'From anywhere, not just at home.';
    const end = st === 'done' ? `<svg class="okmark" viewBox="0 0 24 24" aria-label="Done"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>` : st === 'in_progress' ? `<span class="dot" aria-label="In progress"></span>${CHEV}` : CHEV;
    h += `<div class="rows"><button class="row" data-act="open-phone" data-state="${esc(st)}"><span class="ic" aria-hidden="true">📱</span><span class="bd"><b>${esc(str(item.title) || 'Use Wizard on your phone')}</b><small>${line}</small></span><span class="end">${end}</span></button></div>`;
    if (L.status === 'neterr') h += '<button class="link" data-act="retry-list">Try again</button>';
    if (L.status === 'ok') h += window.WosRecommended?.html() || '';
    h += `<p class="foot">${phoneLayout && tourPending() ? 'The 30-second tour starts when you go back to Home.' : 'You can come back to Setup any time.'}</p>`;
    if (tourAvailable()) h += '<button class="link" data-act="tour">Show the 30-second tour</button>';
    $('list').innerHTML = h;
  }

  /* ---------------- render: phone screen ---------------- */
  const glyph = (kind, n) => kind === 'done' ? `<span class="gl done" data-g="done">${CHECK}</span>`
    : kind === 'working' ? `<span class="gl working" data-g="working" aria-label="Working"><i></i></span>`
    : kind === 'attn' ? `<span class="gl attn" data-g="attn" aria-label="Needs you">!</span>`
    : `<span class="gl ${kind === 'locked' ? 'locked' : 'todo'}" data-g="${kind}">${n}</span>`;
  const shown = u => { try { const x = new URL(u); return (x.host + (x.pathname === '/' ? '' : x.pathname) + x.search); } catch (e) { return u; } };
  const urlRow = u => `<div class="url" data-url="${esc(u)}"><span class="u" title="${esc(u)}" data-full="${esc(shown(u))}">${esc(shown(u))}</span><button class="copy" data-act="copy" data-url="${esc(u)}">Copy</button></div>`;
  const out = (cls, u, label) => `<a class="btn ${cls}" href="${esc(u)}" target="_blank" rel="noopener" data-out>${label}</a>`;
  const qr = u => `<div class="qr" data-qr="${esc(u)}" role="img" aria-label="QR code for ${esc(shown(u))}"><canvas></canvas></div>`;
  const step = (n, g, title, body, extra = '', cls = '') => `<div class="step ${cls}" data-step="${n}">${glyph(g, n)}<div class="sb"><h2>${title}</h2>${body}${extra}</div></div>`;

  function step1(d) {
    const T = 'Sign in to Tailscale on this Wizard';
    const err = str(d.error), auth = httpUrl(d.auth_url), https = httpUrl(d.https_enable_url);
    if (S.starting) return step(1, 'working', T, '<p>Getting the sign-in page ready…</p>');
    if (d.step === 'serving' || d.step === 'phone_seen') {
      const e = err && d.step === 'serving' ? `<p class="err">${esc(err)}</p>` : '';
      return step(1, 'done', T, `<p>This Wizard is on your network as ${esc(str(d.device_name) || 'your private address')}.</p>${e}`);
    }
    const body = {
      off: '<p>Takes about a minute. Opens in your browser.</p>',
      signin: '<p>Sign in on the Tailscale page, then come back here. If the page didn’t open, tap below.</p>',
      https: '<p>One switch left. Tap below, then press Enable HTTPS on the page that opens. Wizard notices when it’s done.</p>',
    }[d.step] || '';
    const failed = S.opErr || err;
    if (failed) return step(1, 'attn', T, body + `<p class="err">${esc(failed)}</p>`, '<div class="act"><button class="btn primary" data-act="start">Try again</button></div>');
    if (d.step === 'off') return step(1, 'todo', T, body, '<div class="act"><button class="btn primary" data-act="start">Sign in with Tailscale</button></div>');
    if (d.step === 'signin') return step(1, 'working', T, body, `<div class="act">${auth ? out('primary', auth, 'Open the sign-in page') : '<button class="btn primary" data-act="start">Open the sign-in page</button>'}</div>`);
    if (d.step === 'https') return step(1, 'attn', T, body, https ? `<div class="act">${out('primary', https, 'Turn on secure addresses')}</div>` : '');
    return step(1, 'todo', T, body);
  }
  function step2(d) {
    const T = 'Get Tailscale on your phone', inst = httpUrl(d.install_url) || 'https://tailscale.com/download';
    const phones = Array.isArray(d.phones) ? d.phones.filter(p => p && typeof p === 'object') : [];
    const found = phones.length ? `<p>${phones[0].name ? `Found ${esc(phones[0].name)}.` : 'Found your phone.'}</p>` : '';
    const lead = '<p>Install it and sign in with the same Tailscale account.</p>';
    if (phoneLayout) return step(2, phones.length ? 'done' : 'todo', T, found + lead, `<div class="act">${out('secondary', inst, 'Get Tailscale')}</div>${urlRow(inst)}`);
    return step(2, phones.length ? 'done' : 'todo', T, '', `<div class="split"><div>${found}${lead}<p class="muted">Scan with your phone’s camera.</p></div>${qr(inst)}</div>${urlRow(inst)}`);
  }
  function step3(d) {
    const T = 'Open Wizard on your phone', payload = connectPayload(d.wizard_url), wiz = payload ? httpUrl(d.wizard_url) : '';
    if (!(d.step === 'serving' || d.step === 'phone_seen') || !wiz) return step(3, 'locked', T, '<p>Your Wizard’s address appears here after step 1.</p>', '', 'locked');
    const seen = d.step === 'phone_seen', err = seen && str(d.error) ? `<p class="err">${esc(d.error)}</p>` : '';
    const text = seen ? '<p>Your phone is connected. Add Wizard to your home screen.</p><p class="muted">Safari: Share, then Add to Home Screen. Chrome: the menu, then Add to Home screen.</p>'
      : phoneLayout ? '<p>Open this address in your phone’s browser.</p><p class="muted">This turns green once your phone connects.</p>'
      : '<p>Scan with your phone, then open the link.</p><p class="muted">This turns green once your phone connects.</p>';
    if (phoneLayout) return step(3, seen ? 'done' : 'todo', T, text + err, `<div class="act">${out('primary', wiz, 'Open Wizard at this address')}</div>${urlRow(wiz)}`);
    return step(3, seen ? 'done' : 'todo', T, '', `<div class="split"><div>${text}${err}</div>${qr(payload)}</div>${urlRow(wiz)}`);
  }

  let lastPhoneHtml = '', lastGlyphs = {}, scrolledTo3 = false;
  function renderPhone() {
    const P = S.phone, d = P.data;
    const menuOk = P.status === 'ok' && d && ['signin', 'https', 'serving', 'phone_seen'].includes(d.step);
    let h = `<div class="bar"><button class="backb" data-act="back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>Setup</button>${menuOk ? '<button class="more" data-act="menu" aria-label="More">···</button>' : ''}</div>`;
    h += '<h1>Use Wizard on your phone</h1>';
    if (P.status === 'denied') h += '<div class="state"><p>Only Wizard’s owner can do this.</p></div>';
    else if (P.status === 'missing') h += '<div class="state"><p>This Wizard doesn’t have Setup yet.</p><p class="muted">Update Wizard, then come back.</p></div>';
    else if (P.status === 'ok' && d.step === 'unavailable') h += '<div class="state"><p>This Wizard can’t make a private connection yet, so phone setup isn’t available here.</p><p class="muted">If you built this Wizard yourself, it needs the private-access helper.</p></div>';
    else {
      h += '<p class="intro">Wizard joins your private Tailscale network so your phone can reach it from anywhere.</p>';
      if (P.banner) h += '<div class="banner" role="status">Wizard can’t check on this right now. Trying again.</div>';
      h += '<div class="steps">';
      if (P.status === 'loading') h += step(1, 'working', 'Sign in to Tailscale on this Wizard', '<p>Checking…</p>') + step(2, 'locked', 'Get Tailscale on your phone', '', '', 'locked') + step(3, 'locked', 'Open Wizard on your phone', '', '', 'locked');
      else if (P.status === 'neterr') h += step(1, 'attn', 'Sign in to Tailscale on this Wizard', '<p>Can’t check right now.</p>', '<div class="act"><button class="btn primary" data-act="retry-phone">Try again</button></div>') + step(2, 'locked', 'Get Tailscale on your phone', '', '', 'locked') + step(3, 'locked', 'Open Wizard on your phone', '', '', 'locked');
      else h += step1(d) + step2(d) + step3(d);
      h += '</div>';
    }
    if (h === lastPhoneHtml) return;
    lastPhoneHtml = h;
    const el = $('phone'); el.innerHTML = h;
    // Transitions: a glyph that just turned done fades in; step 3 lifts from 45 % when it unlocks (and on the phone
    // layout scrolls into view once).
    const g = {};
    el.querySelectorAll('.step').forEach(s => {
      const n = s.dataset.step, k = s.querySelector('.gl')?.dataset.g; g[n] = k;
      if (k === 'done' && lastGlyphs[n] && lastGlyphs[n] !== 'done') s.querySelector('.gl').classList.add('pop');
      if (n === '3' && lastGlyphs[n] === 'locked' && k !== 'locked') {
        s.classList.add('unlock');
        if (phoneLayout && !scrolledTo3) { scrolledTo3 = true; const r = s.getBoundingClientRect(); if (r.bottom > innerHeight) s.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      }
    });
    lastGlyphs = g;
    drawQrs(el); fitUrls(el);
  }

  /* ---------------- QR + address rows ---------------- */
  function drawQrs(scope) {
    if (typeof window.qrcode !== 'function') return;
    const dpr = Math.max(1, Math.min(4, window.devicePixelRatio || 1));
    scope.querySelectorAll('.qr[data-qr]').forEach(box => {
      const c = box.querySelector('canvas'), q = window.qrcode(0, 'M');
      q.addData(box.dataset.qr); q.make();
      const n = q.getModuleCount(), quiet = 4, cells = n + quiet * 2;
      const cell = Math.max(1, Math.floor((144 * dpr) / cells)); // whole device pixels per module: crisp edges
      const px = cell * cells; c.width = px; c.height = px; c.style.width = c.style.height = (px / dpr) + 'px';
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, px, px); x.fillStyle = '#000';
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) x.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
      box.dataset.modules = n;
    });
  }
  // Long addresses are shortened in the middle (both ends are what people recognise); Copy always copies it whole.
  function fitUrls(scope) {
    scope.querySelectorAll('.url .u').forEach(u => {
      const full = u.dataset.full; u.textContent = full;
      if (u.scrollWidth <= u.clientWidth + 1) return;
      let lo = 4, hi = full.length;
      while (lo < hi) { const m = (lo + hi + 1) >> 1, a = Math.ceil(m / 2), b = Math.floor(m / 2); u.textContent = full.slice(0, a) + '…' + full.slice(full.length - b); if (u.scrollWidth <= u.clientWidth + 1) lo = m; else hi = m - 1; }
      const a = Math.ceil(lo / 2), b = Math.floor(lo / 2); u.textContent = full.slice(0, a) + '…' + full.slice(full.length - b);
    });
  }
  let fitT = 0; addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(() => fitUrls($('phone')), 120); });
  async function copy(url) {
    let ok = false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); ok = true; } } catch (e) {}
    if (!ok) { try { const t = document.createElement('textarea'); t.value = url; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;opacity:0;top:0'; document.body.appendChild(t); t.select(); ok = document.execCommand('copy'); t.remove(); } catch (e) { ok = false; } }
    log('copy:' + (ok ? 'ok' : 'fail'));
    toast(ok ? 'Copied' : 'Couldn’t copy. Select the address instead.');
  }
  let toastT = 0;
  function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 1500); }

  /* ---------------- taps ---------------- */
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act], [data-out], .url');
    if (!t) return;
    if (t.matches('[data-out]')) { log('out:' + t.href); return; } // the anchor itself leaves; the shell routes it outside
    const act = t.dataset.act;
    if (!act && t.matches('.url')) { if (phoneLayout) copy(t.dataset.url); return; }
    if (act === 'open-phone') openPhone();
    else if (act === 'back') closePhone();
    else if (act === 'retry-list') { S.list.status = 'loading'; renderList(); loadList(); }
    else if (act === 'retry-phone') { S.phone.status = 'loading'; renderPhone(); loadPhone().then(() => schedule(2000)); }
    else if (act === 'start') start();
    else if (act === 'menu') openMenu();
    else if (act === 'ask-reset') openSheet();
    else if (act === 'cancel-reset') closeSheet();
    else if (act === 'reset') reset();
    else if (act === 'copy') { e.stopPropagation(); copy(t.dataset.url); }
    else if (act === 'tour') { try { parent.postMessage({ type: 'wizard:setup:tour' }, location.origin); } catch (er) {} log('tour'); setTimeout(renderList, 50); }
  });
  $('scrim').addEventListener('click', () => { closeSheet(); closeMenu(); });

  /* ---------------- boot ---------------- */
  window.WosRecommended?.init(renderList, () => S.screen === 'list' && !document.hidden);
  try { WA?.ready({ name: 'Setup' }); } catch (e) {}
  renderList(); if (!ioList) loadList();
  // Owner name for the greeting: the shell's settings when hosted, else the bootstrap the shell reads.
  if (!framed || !shellApi()?.WizConfig) fetch('/wizard/v1/bootstrap', { credentials: 'same-origin', cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(b => { const n = b?.settings?.owner?.name; if (typeof n === 'string' && n.trim()) { S.owner = n.trim(); renderList(); } }).catch(() => {});
  addEventListener('wizard:theme', () => fitUrls($('phone')));
})();
