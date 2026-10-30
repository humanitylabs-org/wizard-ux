/* Setup — Wizard OS system app `setup` (contract: phone-setup-tailscale "Setup app").
 * Design: Claude Fable, two rounds on 14 Oct 2026; Archimedes built it as specified.
 *
 * Screens are in-app layers on the shared WizardApp Back client; the frame's URL never changes:
 *   checklist (root) → "Connect another device" → overflow menu → disconnect sheet.
 *   Back closes the top layer; at the checklist the app declines and the shell takes the step (Home). Never exits.
 * Agent Service API (owner-only, same origin):
 *   GET /wizard/v1/setup · POST /wizard/v1/setup/seen · GET /wizard/v1/setup/phone
 *   POST /wizard/v1/setup/phone/start · POST /wizard/v1/setup/phone/reset
 * Links leave through ordinary target=_blank anchors: the shell's frame guard hands them to the system browser
 * (Mac app, Android app) or a new tab. The app never calls window.open.
 * The phone screen is the shared phone-connect component (../core/phone-connect.js), the same one Settings and Mac
 * onboarding show. QR codes are drawn locally from vendor/qrcode.js (MIT, see provenance.json); no address leaves the device. */
(() => {
  'use strict';
  const API = '/wizard/v1/setup';
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
    listVisible: false,
    firstRun: false, seenPosted: false, seenTries: 0,
    screen: 'list',
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
  const str = v => (typeof v === 'string' && v ? v : '');


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
  /* ---------------- phone screen: the shared phone-connect component (web/core/phone-connect.js) ----------------
   * The same component as Settings › Phones & devices and Mac onboarding. It polls only while the phone screen is
   * actually on screen (IntersectionObserver against the shell's viewport, so another desk or workspace stops it) and
   * the page is visible. */
  let inView = false;
  const PC = window.WizPhoneConnect.create({
    api: window.WizPhoneConnect.serviceApi(API + '/phone'),
    layout: phoneLayout ? 'phone' : 'desktop',
    active: () => S.screen === 'phone' && inView,
    onChange: () => renderBar(),
  });
  async function reset() {
    closeSheet();
    const ok = await PC.reset();
    toast(ok ? 'Disconnected' : 'That didn’t work. Try again.');
  }
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => {
    const was = inView; inView = es.some(e => e.isIntersecting);
    if (inView && !was) PC.refresh();
  }) : null;
  if (io) io.observe($('phone')); else inView = true;
  // The checklist refreshes whenever it comes back into view (Back from the phone screen, another desk, the tour).
  const ioList = 'IntersectionObserver' in window ? new IntersectionObserver(es => { S.listVisible = es.some(e => e.isIntersecting); if (S.screen === 'list' && S.listVisible) { renderList(); loadList(); } }) : null;
  if (ioList) ioList.observe($('list'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || S.screen === 'phone') return;
    loadList();
    if (S.firstRun && !S.seenPosted) postSeen();
  });

  /* ---------------- layers + Back ---------------- */
  const WA = window.WizardApp;
  function openPhone(another = false) {
    if (S.screen === 'phone') return;
    S.screen = 'phone';
    $('list').hidden = true; $('phone').hidden = false; scrollTo(0, 0);
    renderPhone(); log('screen:phone');
    if (another) PC.connectAnother();
    else if (PC.connecting) PC.back();
    PC.refresh();
  }
  function closePhone() {
    if (S.screen !== 'phone') return false;
    closeSheet(); closeMenu();
    S.screen = 'list';
    $('phone').hidden = true; $('list').hidden = false; scrollTo(0, 0);
    log('screen:list'); if (!ioList) loadList(); else renderList();
    return true;
  }
  function openMenu() { if (S.menu) return; S.menu = true; window.WzSheet.open($('menu')); }
  function closeMenu() { if (!S.menu) return; window.WzSheet.close($('menu')); S.menu = false; }
  $('menu').addEventListener('close', () => { S.menu = false; });
  function openSheet() { closeMenu(); S.sheet = true; window.WzSheet.open($('sheet')); }
  function closeSheet() { if (!S.sheet) return; window.WzSheet.close($('sheet')); S.sheet = false; }
  $('sheet').addEventListener('close', () => { S.sheet = false; });
  WA?.back.register({ canGoBack: () => S.screen === 'phone', back: () => PC.back() || closePhone() });
  window.__setup = { get state() { return S; }, get phone() { return { status: PC.status, view: PC.view }; }, get inView() { return inView; }, back: () => WA ? WA.back : null, layout };

  /* ---------------- render: checklist ---------------- */
  const CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  function renderList() {
    const L = S.list, owner = ownerName();
    let h = '<header class="wz-head"><h1>Setup</h1></header>';
    if (S.firstRun) h += `<p class="greet">${owner ? `Hi ${esc(owner)}. ` : ''}Make this Wizard yours.</p>`;
    if (L.status === 'denied') { $('list').innerHTML = h + '<div class="state"><p>Only Wizard’s owner can use Setup.</p></div>'; return; }
    if (L.status === 'missing') { $('list').innerHTML = h + '<div class="state"><p>This Wizard doesn’t have Setup yet.</p><p class="muted">Update Wizard, then come back.</p></div>'; return; }
    const item = (L.data?.items || []).find(i => i && i.id === 'phone') || { id: 'phone', title: 'Connect another device', state: '' };
    const st = L.status === 'loading' ? 'loading' : L.status === 'neterr' ? 'neterr' : item.state;
    const line = st === 'done' && item.phone_ready === true ? 'Ready to open on your device.'
      : { loading: 'Checking…', neterr: 'Can’t check right now.', todo: 'From anywhere, not just at home.', in_progress: 'Not finished. Pick up where you left off.', done: 'Your device is connected.' }[st] || 'From anywhere, not just at home.';
    const end = st === 'done' ? `<svg class="okmark" viewBox="0 0 24 24" aria-label="Done"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>` : st === 'in_progress' ? `<span class="dot" aria-label="In progress"></span>${CHEV}` : CHEV;
    h += `<div class="rows"><button class="row wz-row" data-act="open-phone" data-state="${esc(st)}"><span class="ic" aria-hidden="true">📱</span><span class="bd"><b>${st === 'done' ? 'Device connected' : 'Connect another device'}</b><small>${line}</small></span><span class="end">${end}</span></button></div>`;
    // Preserve the approved Setup entry: a separate tinted action below the completed checklist row.
    if (st === 'done') h += '<button class="wz-button add-device" data-act="list-connect-device">Connect another device</button>';
    if (L.status === 'neterr') h += '<button class="link wz-button secondary" data-act="retry-list">Try again</button>';
    if (L.status === 'ok') h += window.WosRecommended?.html() || '';
    h += '<p class="foot custom" data-customize>Everything you see is customizable. Try asking your Wizard for one change.</p>';
    h += `<p class="foot">${phoneLayout && tourPending() ? 'The 30-second tour starts when you go back to Home.' : 'You can come back to Setup any time.'}</p>`;
    if (tourAvailable()) h += '<button class="link wz-button secondary" data-act="tour">Show the 30-second tour</button>';
    $('list').innerHTML = h;
  }

  /* ---------------- render: phone screen ---------------- */
  // The screen's own frame (Back, the ··· menu once there is something to disconnect, the title); the component
  // renders everything below it and keeps its state across redraws.
  function renderBar() {
    const bar = $('phone').querySelector('.bar'); if (!bar) return;
    const menuOk = PC.on || PC.settingUp;
    const h = `<button class="backb wz-button secondary" data-act="back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>Setup</button>${menuOk ? '<button class="more wz-icon-button" data-act="menu" aria-label="More">···</button>' : ''}`;
    if (bar.innerHTML !== h) bar.innerHTML = h;
  }
  function renderPhone() {
    const el = $('phone');
    if (!el.querySelector('[data-phone-connect]')) {
      el.innerHTML = '<div class="bar"></div><h1>Connect another device</h1><div class="pc-host" data-phone-connect></div>';
      PC.attach(el.querySelector('[data-phone-connect]'));
    }
    renderBar();
  }

  let toastT = 0;
  function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 1500); }

  /* ---------------- taps ---------------- */
  document.addEventListener('click', e => {
    if (e.target.closest('[data-pc="flow-done"]')) { closePhone(); return; }
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'open-phone') openPhone();
    else if (act === 'list-connect-device') openPhone(true);
    else if (act === 'back') closePhone();
    else if (act === 'retry-list') { S.list.status = 'loading'; renderList(); loadList(); }
    else if (act === 'menu') openMenu();
    else if (act === 'ask-reset') openSheet();
    else if (act === 'cancel-reset') closeSheet();
    else if (act === 'reset') reset();
    else if (act === 'tour') { try { parent.postMessage({ type: 'wizard:setup:tour' }, location.origin); } catch (er) {} log('tour'); setTimeout(renderList, 50); }
  });
  $('scrim').addEventListener('click', () => { closeSheet(); closeMenu(); });

  /* ---------------- boot ---------------- */
  window.WosRecommended?.init(renderList, () => S.screen === 'list' && !document.hidden && (!ioList || S.listVisible));
  try { WA?.ready({ name: 'Setup' }); } catch (e) {}
  renderList(); if (!ioList) loadList();
  // Owner name for the greeting: the shell's settings when hosted, else the bootstrap the shell reads.
  if (!framed || !shellApi()?.WizConfig) fetch('/wizard/v1/bootstrap', { credentials: 'same-origin', cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(b => { const n = b?.settings?.owner?.name; if (typeof n === 'string' && n.trim()) { S.owner = n.trim(); renderList(); } }).catch(() => {});
})();
