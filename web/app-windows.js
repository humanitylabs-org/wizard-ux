/* Wizard UX phone shell › window and desk titles, desk sections and making a window. Moved out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Values app.js changes over time (its reassigned lets, like the window list W and the desks) stay in app.js;
 * this code reads and writes them as appVars.<name>, app.js's get/set accessors on the same variables, so every
 * read and write is live. Loaded just before app.js. The body below keeps app.js's indentation so `git log -L` and
 * patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.windows = function ({ $, $$, agentApp, agentWin, APP, appVars, CHATS, esc, HOME, ico, LIVE, MAXW, OUTBOX, parkDesks, refreshModes, RELOAD_BTN, renderChats, store, syncImmersive, track, winApp }) {
  let closeWin, paintHome, renderApp, renderDots, renderEmpty, renderFrame, renderHome, renderMoons, rideSettings, syncReviewChip, watchFrames; // late-bound: app.js declares these after the call, see bindLate
  function winTitle(w) {
    if (!w) return '';
    if (w.app === 'chats' && !w.thread) { const title = CHATS.listTitle?.(w); if (title) return title; }
    if (agentWin(w) && !w.thread) return `${agentApp(w).name} · Chats`;
    if (w.app === 'chats') return w.thread === '__new__' ? 'New chat' : w.thread ? (LIVE?.session(w.thread)?.title || OUTBOX?.forThread(w.thread)[0]?.title || 'Thread') : 'Chats';
    return winApp(w).name;
  }
  function deskTitle(i) {
    const d = appVars.desks[i]; if (!d.wins.length) return i === HOME ? 'Home' : 'Empty';
    const f = appVars.W[d.focus] || appVars.W[d.wins[0]];
    return d.wins.length > 1 ? `${winTitle(f)} +${d.wins.length - 1}` : winTitle(f);
  }
  // Short name for the bottom label and scrubber: the app ("Chats"), never a long thread title.
  function deskName(i) {
    const d = appVars.desks[i]; if (!d.wins.length) return i === HOME ? 'Home' : 'Empty';
    const f = appVars.W[d.focus] || appVars.W[d.wins[0]], n = f.app === 'frame' || f.app === 'chats' ? winApp(f).name : winTitle(f);
    return d.wins.length > 1 ? `${n} +${d.wins.length - 1}` : n;
  }
  const deskOf = id => appVars.desks.findIndex(d => d.wins.includes(id));
  const winEl = id => track.querySelector(`.win[data-win="${id}"]`);
  const focusedWin = () => appVars.W[appVars.desks[appVars.idx].focus] || null;

  function winBody(w) {
    switch (w.app) {
      case 'chats': return `<div class="chats" data-chats="${w.id}"></div>`;
      case 'pages': return '<div class="pg-host"></div>';
      case 'feature': return '<div class="shared-feature"></div>';
      case 'frame': return renderFrame(w);
      default: return renderApp(w);
    }
  }
  /* Lazy app frames: an app window on a desk out of view gets its page only when that desk first comes into view,
   * so opening the shell with twenty restored desks loads the desk in view (plus the last two desks used here),
   * not twenty apps at once. Until then the window holds the same loading veil an app shows while its page loads.
   * Once loaded an app stays loaded (off-screen it is parked, as before). */
  const RECENT_KEEP = 3; // the desk in view and the two used before it
  const recentDesks = () => { const r = store.get('recentDesks', []); return Array.isArray(r) ? r.filter(x => typeof x === 'string').slice(0, RECENT_KEEP) : []; };
  const bootRecent = new Set(recentDesks()); // read once, before this session starts noting desks
  function noteRecent() {
    const id = appVars.desks[appVars.idx]?.id, r = recentDesks(); if (!id || r[0] === id) return;
    store.set('recentDesks', [id, ...r.filter(x => x !== id)].slice(0, RECENT_KEEP));
  }
  function frameWanted(w) {
    const i = deskOf(w.id);
    return i < 0 || i === appVars.idx || bootRecent.has(appVars.desks[i].id);
  }
  // The desk in view gets its windows' pages now (app.js parkDesks calls this whenever desks move or change).
  function wakeDesk() {
    const sec = secOf(appVars.idx); if (!sec) return;
    for (const b of $$('.wbody[data-lazy-frame]', sec)) {
      const el = b.closest('.win'), w = el && appVars.W[el.dataset.win]; if (!w) continue;
      b.removeAttribute('data-lazy-frame'); b.innerHTML = winBody(w); watchFrames(el);
    }
    noteRecent();
  }
  function makeWin(w) {
    // Legacy inline-app descriptors retain their id, desk and pin; the registry now owns their view.
    if (APP[w.app]?.kind === 'wizard' && APP[w.app]?.url) { w.appId = w.app; w.app = 'frame'; }
    const a = winApp(w);
    const el = document.createElement('article');
    const rv = !!(w.from && w.from.sid);
    el.className = `win app-${w.app}${['app-store', 'agents', 'setup'].includes(w.appId) ? ' store-window' : ''}${agentWin(w) ? ' agent-chats' : ''}${rv ? ' reviewing' : ''}${w.bound ? ' bound' : ''}`; el.dataset.win = w.id;
    el.innerHTML = `<header class="wbar">${w.app === 'chats' ? window.WosAgents.titlebar(w.agent || '', 'wic', 'wt') : `${ico('span', 'wic', a)}<span class="wt">${esc(winTitle(w))}</span>`}${window.WosBoundView.badge(w)}
      ${w.from && !w.workflow ? '<button class="wb wpin wopen" data-wact="detach" aria-label="Open as an app on its own desk" title="Keep a copy open on its own desk"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg><span>Open app</span></button>' : ''}
      ${w.app === 'frame' ? window.WosOwnViews?.marker(a) || '' : ''}${w.app === 'frame' && window.WosAppRoute ? window.WosAppRoute.slot(w.appId) : ''}${refreshModes.length ? RELOAD_BTN : ''}<button class="wb" data-wact="full" aria-label="Full screen"><svg viewBox="0 0 24 24"><path class="i-grow" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><path class="i-shrink" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg></button>
      <button class="wb" data-wact="close" aria-label="Close window"><svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg></button></header>
      <div class="wbody">${winBody(w)}</div><div class="shield" aria-hidden="true"></div>`;
    // A frame not yet wanted leaves the window before the window is placed, so it never starts loading.
    const f = w.app === 'frame' && w.appId !== 'troubleshooter' && !frameWanted(w) && el.querySelector('.wbody iframe.appframe');
    if (f) { f.remove(); $('.wbody', el).setAttribute('data-lazy-frame', ''); }
    return el;
  }
  function mountWin(w, el) {
    if (w.app === 'feature') window.WosFeatures.mount(w.featureId, el.querySelector('.shared-feature'),w.featureOptions);
    if (w.app === 'pages') window.WosPages.mount(el.querySelector('.pg-host'), {slug:w.pageSlug || '', close:() => closeWin(w.id)});
    if (w.app === 'chats') renderChats(w);
    watchFrames(el);
  }
  // Desk sections are keyed by desk id and laid out with CSS order, so reordering, merging or closing desks
  // never re-parents a section (which would reload every app in it).
  function secOf(i) { const d = appVars.desks[i]; return d ? track.querySelector(`.desk[data-did="${d.id}"]`) : null; }
  function isReviewDesk(i) { const d = appVars.desks[i]; return !!(d && d.wins.some(id => appVars.W[id]?.from?.sid)); }
  function deskShell(i) {
    const d = appVars.desks[i];
    return `<section class="desk${d.home ? ' home-desk' : ''}" data-did="${d.id}" data-desk="${i}" style="order:${i}" aria-label="${esc(deskTitle(i))}"><div class="glance">${d.home ? renderHome() : renderEmpty(i)}</div><div class="tiles" data-n="0"></div></section>`;
  }
  function syncDesks() {
    const ids = new Set(appVars.desks.map(d => d.id));
    $$('.desk', track).forEach(sec => { if (!ids.has(sec.dataset.did)) sec.remove(); });
    appVars.desks.forEach((d, i) => {
      let sec = secOf(i);
      if (!sec) { track.insertAdjacentHTML('beforeend', deskShell(i)); sec = secOf(i); renderDesk(i); }
      sec.style.order = String(i); sec.dataset.desk = String(i);
      sec.classList.toggle('review-desk', isReviewDesk(i));
    });
    placeTrack(0, false); renderDots(); parkDesks(false);
  }
  function buildDesks() {
    track.innerHTML = appVars.desks.map((_, i) => deskShell(i)).join('');
    appVars.desks.forEach((_, i) => renderDesk(i));
    placeTrack(0, false); renderDots(); renderMoons(); parkDesks(true);
  }
  /* Sync one desk's DOM with its window list without reloading live windows. */
  function renderDesk(i) {
    const sec = secOf(i); if (!sec) return;
    const d = appVars.desks[i], tiles = $('.tiles', sec);
    $$('.win', tiles).forEach(el => { if (!d.wins.includes(el.dataset.win)) el.remove(); });
    d.wins.forEach(id => {
      let el = winEl(id);
      if (!el) { el = makeWin(appVars.W[id]); tiles.appendChild(el); mountWin(appVars.W[id], el); }
      else if (el.parentElement !== tiles) tiles.appendChild(el);
    });
    if (!d.wins.length) { if (d.home) paintHome($('.glance', sec), renderHome()); else $('.glance', sec).innerHTML = renderEmpty(i); }
    sec.classList.toggle('review-desk', isReviewDesk(i));
    applyLayout(i);
  }
  function applyLayout(i) {
    const d = appVars.desks[i], sec = secOf(i); if (!sec) return;
    const tiles = $('.tiles', sec), n = Math.min(d.wins.length, MAXW);
    tiles.dataset.n = String(n);
    tiles.classList.toggle('has-full', !!(d.full && d.focus));
    sec.classList.toggle('has-wins', n > 0);
    d.wins.forEach((id, k) => {
      const el = winEl(id); if (!el) return;
      el.style.gridArea = 'abcd'[k];
      el.classList.toggle('focus', id === d.focus && n > 1);
      el.classList.toggle('solo', n === 1);
      el.classList.toggle('full', !!d.full && id === d.focus);
      const t = $('.wt', el); if (t && appVars.W[id].app !== 'chats') t.textContent = winTitle(appVars.W[id]);
    });
    sec.setAttribute('aria-label', deskTitle(i));
    if (i === appVars.idx) { syncImmersive(); syncReviewChip(); }
  }
  function refreshWin(id) {
    const w = appVars.W[id], el = winEl(id); if (!w || !el) return;
    if (w.app === 'chats') renderChats(w);
    else if (w.app !== 'frame') $('.wbody', el).innerHTML = winBody(w);
    applyLayout(deskOf(id));
  }
  function placeTrack(dx, anim) {
    track.classList.toggle('anim', !!anim);
    track.style.transform = `translate3d(calc(${-appVars.idx * 100}% + ${dx}px),0,0)`;
    if (appVars.stDesk) rideSettings(dx, anim); // Settings stays on its desk and slides with it (James, 21 Oct 2026)
    $('.nebula').style.transform = `translate3d(${(-appVars.idx + 2) * -3 + dx * .01}%,0,0)`;
    window.WosScenery?.still('stars'); // scenery hook: star parallax follows the desk (one still frame; core/scenery.js)
  }
  return { applyLayout, buildDesks, deskName, deskOf, focusedWin, isReviewDesk, makeWin, mountWin, placeTrack, renderDesk, secOf, syncDesks, wakeDesk, winEl, winTitle, bindLate: v => { if ('closeWin' in v) closeWin = v.closeWin; if ('paintHome' in v) paintHome = v.paintHome; if ('renderApp' in v) renderApp = v.renderApp; if ('renderDots' in v) renderDots = v.renderDots; if ('renderEmpty' in v) renderEmpty = v.renderEmpty; if ('renderFrame' in v) renderFrame = v.renderFrame; if ('renderHome' in v) renderHome = v.renderHome; if ('renderMoons' in v) renderMoons = v.renderMoons; if ('rideSettings' in v) rideSettings = v.rideSettings; if ('syncReviewChip' in v) syncReviewChip = v.syncReviewChip; if ('watchFrames' in v) watchFrames = v.watchFrames; } };
};
