/* WizardOS — home shell prototype */
(async () => {
  'use strict';
  /* Values this shell changes over time (wizard-ux issue 1665): the parts in app-*.js read and write them
   * as appVars.<name>, accessors on these same variables, so every read and write is live. */
  const appVars = {
    get boundBusy() { return boundBusy; }, set boundBusy(v) { boundBusy = v; },
    get boundManager() { return boundManager; }, set boundManager(v) { boundManager = v; },
    get boundOff() { return boundOff; }, set boundOff(v) { boundOff = v; },
    get desks() { return desks; }, set desks(v) { desks = v; },
    get dockSwiped() { return dockSwiped; }, set dockSwiped(v) { dockSwiped = v; },
    get dropUntil() { return dropUntil; }, set dropUntil(v) { dropUntil = v; },
    get DS() { return DS; }, set DS(v) { DS = v; },
    get fullAt() { return fullAt; }, set fullAt(v) { fullAt = v; },
    get G() { return G; }, set G(v) { G = v; },
    get guardOn() { return guardOn; }, set guardOn(v) { guardOn = v; },
    get idx() { return idx; }, set idx(v) { idx = v; },
    get ignorePop() { return ignorePop; }, set ignorePop(v) { ignorePop = v; },
    get immOn() { return immOn; }, set immOn(v) { immOn = v; },
    get labelT() { return labelT; }, set labelT(v) { labelT = v; },
    get lastMove() { return lastMove; }, set lastMove(v) { lastMove = v; },
    get LINKS() { return LINKS; }, set LINKS(v) { LINKS = v; },
    get menuFor() { return menuFor; }, set menuFor(v) { menuFor = v; },
    get NOMIC() { return NOMIC; }, set NOMIC(v) { NOMIC = v; },
    get OV() { return OV; }, set OV(v) { OV = v; },
    get ovEl() { return ovEl; }, set ovEl(v) { ovEl = v; },
    get ovTapBlock() { return ovTapBlock; }, set ovTapBlock(v) { ovTapBlock = v; },
    get parkedReply() { return parkedReply; }, set parkedReply(v) { parkedReply = v; },
    get parking() { return parking; }, set parking(v) { parking = v; },
    get rvCoach() { return rvCoach; }, set rvCoach(v) { rvCoach = v; },
    get settingsFocus() { return settingsFocus; }, set settingsFocus(v) { settingsFocus = v; },
    get settingsReturn() { return settingsReturn; }, set settingsReturn(v) { settingsReturn = v; },
    get settingsView() { return settingsView; }, set settingsView(v) { settingsView = v; },
    get sheet() { return sheet; }, set sheet(v) { sheet = v; },
    get SIDE() { return SIDE; }, set SIDE(v) { SIDE = v; },
    get stDesk() { return stDesk; }, set stDesk(v) { stDesk = v; },
    get tileN() { return tileN; }, set tileN(v) { tileN = v; },
    get txHideT() { return txHideT; }, set txHideT(v) { txHideT = v; },
    get W() { return W; }, set W(v) { W = v; },
    get zen() { return zen; }, set zen(v) { zen = v; },
    get zenTipT() { return zenTipT; }, set zenTipT(v) { zenTipT = v; },
  };
  if (document.documentElement.dataset.leaving || window.WizHomeScreenPolicy?.mode) return; // single-app sessions never initialize desks
  await window.WizLauncher?.waitForShell?.();

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Product name: WizardOS, always one word (James, 8 Nov 2026; wizard-os#436).
  const OS = () => 'WizardOS';
  const vib = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
  const LIVE = window.WizLive;
  const OUTBOX = window.WosOutbox || null;
  const device = $('#device');
  // In-app browser for links tapped in Wizard (core/links.js). Mounted once the window manager exists.
  let LINKS = null;
  // Desk strip (James, 10 Oct 2026): Home is pinned at the far left, Chats sits next to it, every new thing
  // opens on its own desk right beside the one in front, and a desk goes away when its last window closes.
  const HOME = 0;
  var stDesk = null; // id of the desk an open Settings stays on while you look at other desks

  /* ---------------- dates ---------------- */
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

  /* ---------------- apps ---------------- */
  // The registry lives in core/apps.js (shared with the desktop shell); the phone gets its own list.
  const { APPS, APP, findApp, appAt, appByName, quickSearch, searchUrl } = window.WizCore.apps('mobile');
  window.WizBackgroundAudio?.init(() => APP, f => { const id=f.closest('.win')?.dataset.win; return !!W[id]?.appId && deskOf(id) >= 0 && window.WizAppServices?.authorized(f); });
  const norm = window.WizCore.norm;

  /* ---------------- state ---------------- */
  const tourEv = (type, d) => { try { window.WosTour?.event?.(type, d || {}); } catch (e) { console.error(e); } };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('wos.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('wos.' + k, JSON.stringify(v)); } catch (e) {} },
  };
  /* ---------------- desks hold tiled windows ----------------
   * A desk is a workspace, not an app. It holds up to four windows tiled
   * Omarchy-style: small gaps, rounded corners, wallpaper bleeding through.
   * Windows can be focused, made full screen (pinch out or double-tap the title
   * bar), moved to another desk, or closed. Nothing is pinned anywhere. */
  const MAXW = 4;
  const newId = () => 'w' + Math.random().toString(36).slice(2, 9);
  const newDid = () => 'd' + Math.random().toString(36).slice(2, 9);
  const blank = (o = {}) => ({ id: newDid(), wins: [], focus: null, full: false, ...o });
  // New storage keys: the shipped five-desk layout (wos.wins / wos.desks3) is read once and left untouched.
  let W = store.get('wins4', null), desks = store.get('strip', null);
  /* A fresh layout, starter apps on a new device and the late layout pass; app-seed.js. */
  const { bindLate: seedLate } = window.WizCore.appParts.seed({ APP, appVars, blank, MAXW, newId, store });
  // Reopen exactly where he left off: remember the desk itself, not its position (empty desks are pruned on
  // load, which used to shift the saved position onto the next desk to the right).
  let idx = (() => { const id = store.get('idxDesk', ''), at = id ? desks.findIndex(d => d.id === id) : -1; return at >= 0 ? at : store.get('idx4', HOME); })();
  /* Saving the window model, live Wizard state, thread emojis and the reload buttons; app-model.js. */
  const { ago, ch, CH, CHATS, chatsBack, emoOf, live, loadThread, markVisibleThreadsSeen, openChat, refreshCompose, refreshModes, RELOAD_BTN, renderChatList, renderChats, renderThread, save, sendChat, track, windowRefreshAdapter, bindLate: modelLate } = window.WizCore.appParts.model({ $, appVars, finishVoice, HOME, LIVE, store, vib });
  seedLate({ save });
  const CHATS_APP = { id: 'wizard', name: 'Chats', icon: '✦', g: ['#6b46ff', '#c04dff'] };
  // App icons are sigils (core/sigils.js): one silhouette, one bite, one colour per app.
  const ico = (tag, cls, a, extra) => window.WizSigil ? window.WizSigil.box(tag, cls, a, extra) : `<${tag} class="${cls}" style="--g1:${a.g?.[0]};--g2:${a.g?.[1]}">${a.icon || '◇'}${extra || ''}</${tag}>`;
  const sig = (cls, glyph, color, fb) => window.WizSigil ? window.WizSigil.chip('span', cls, glyph, color) : `<span class="${cls}">${fb}</span>`;
  let tileN = 0;
  /* Agents MVP: a Chats window pinned to an agent (w.agent) wears that agent's sigil and name. */
  const agentWin = w => !!(w && w.app === 'chats' && w.agent);
  const mainChats = w => !!(w && w.app === 'chats' && !w.agent && CHATS.views.providerFor(w) === CHATS.views.defaultId());
  function agentApp(w) {
    const AG = window.WosAgents, a = AG?.get(w.agent) || { id: w.agent, label: w.agent, appearance: {}, privacy: 'standard' };
    const g = AG ? AG.glyph(a) : '', c = AG ? AG.colour(a) : '#b99bff';
    return { id: 'agent:' + a.id, name: a.label, icon: '✦', g: [c, c], sgc: c, sgh: window.WizSigil ? window.WizSigil.named(g || a.label.charAt(0).toUpperCase()) : '', agent: a.id, private: a.privacy === 'private' };
  }
  function winApp(w) {
    if (agentWin(w)) return agentApp(w);
    if (w.app === 'chats') return { ...CHATS_APP, sgc: window.WosAgents?.colour(window.WosAgents.get(window.WosAgents.defaultId())) || '#C1AAFF' };
    return APP[w.appId || w.app] || { name: w.title || 'Page', icon: '◇', g: ['#444a60', '#22263a'], url: w.url };
  }
  /* Window and desk titles, desk sections and making a window; app-windows.js. */
  const { applyLayout, buildDesks, deskName, deskOf, focusedWin, isReviewDesk, makeWin, mountWin, placeTrack, renderDesk, secOf, syncDesks, winEl, winTitle, bindLate: windowsLate } = window.WizCore.appParts.windows({ $, $$, agentApp, agentWin, APP, appVars, CHATS, esc, HOME, ico, LIVE, MAXW, OUTBOX, parkDesks, refreshModes, RELOAD_BTN, renderChats, syncImmersive, track, winApp });
  seedLate({ renderDesk, syncDesks, winEl });
  modelLate({ applyLayout, deskOf, winTitle });
  let labelT = 0;
  /* Parking: hosted apps on desks out of view stay loaded but go quiet, so swipes stay smooth.
   *  - Every framed app off the current desk sees document.visibilityState === 'hidden' (and a
   *    visibilitychange), exactly as if the phone screen were off: Legacy Wizard, Topics, Meetings and
   *    friends stop their polling and catch up the moment their desk lands in view.
   *  - Desks more than one swipe away also skip rendering (content-visibility), so a heavy app two
   *    desks over costs no style, layout or paint. The neighbours stay painted for the swipe itself.
   * A desk is woken only after the slide settles, so its catch-up work never lands mid-animation. */
  let parkT = 0;
  function frameSetHidden(f, hidden) {
    try {
      const d = f.contentDocument; if (!d || d.location.href === 'about:blank') return;
      if (!d.__wosVis) {
        d.__wosVis = { hidden: false };
        Object.defineProperty(d, 'hidden', { configurable: true, get: () => d.__wosVis.hidden || document.hidden });
        Object.defineProperty(d, 'visibilityState', { configurable: true, get: () => (d.__wosVis.hidden || document.hidden) ? 'hidden' : 'visible' });
      }
      if (d.__wosVis.hidden === hidden) return;
      d.__wosVis.hidden = hidden;
      if (!document.hidden) d.dispatchEvent(new Event('visibilitychange'));
    } catch (e) {}
  }
  function parkDesks(wakeCurrent) {
    desks.forEach((_, i) => {
      const sec = secOf(i); if (!sec) return;
      sec.classList.toggle('parked', Math.abs(i - idx) > 1);
      if (i !== idx || wakeCurrent) $$('iframe.appframe', sec).forEach(f => frameSetHidden(f, i !== idx));
    });
  }
  function scheduleParking() {
    parkDesks(false); clearTimeout(parkT);
    // The slide is 520 ms; a desk you only pass through never wakes, and a wake never lands mid-swipe
    // (a waking app catches up at once, which is exactly the hitch this avoids).
    const wake = () => { let busy = false; try { busy = !!(G || DS); } catch (e) {} if (busy) parkT = setTimeout(wake, 250); else parkDesks(true); };
    parkT = setTimeout(wake, 900);
  }
  let swipeBySection = null; // phone sections (wizard-ux#1929): app-sections.js, set below
  function swipeDesk(step) {
    const from = desks[idx]?.id;
    // A swipe steps through the phone sections Home, Chats, Messenger and Apps, never a new desk.
    if (typeof swipeBySection === 'function' && swipeBySection(step)) { /* moved by section */ }
    // The ＋ is the next destination after the last occupied desk, for swipes as well as taps.
    else if (step > 0 && idx === desks.length - 1) newDesk(); else goDesk(idx + step);
    // Only a swipe can be the iPhone's swipe home in disguise (undoLastMove below).
    if (desks[idx]?.id !== from) lastMove = { from, at: Date.now() };
  }
  /* iPhone: a quick swipe home along the bottom edge also reaches the dock and flips a desk just as the app
   * goes away, so it reopens one desk over. A desk SWIPE in the last moment before the page is hidden was
   * that swipe, not a choice: put the desk back. Opening an app is never undone: its file picker or camera
   * hides the page too, and that put James back on Chats mid-message (James, 26 Oct 2026). */
  let lastMove = null;
  /* Leaving an empty desk, going to a desk, the desk dots and the orb app mark; app-desks.js. */
  const { announce, atPickerEnd, deskSigil, endDotHold, goDesk, renderDots, bindLate: desksLate } = window.WizCore.appParts.desks({ $, appVars, CHATS, deskName, esc, HOME, isReviewDesk, markVisibleThreadsSeen, placeTrack, save, scheduleParking, syncDesks, syncImmersive, tourEv, vib, winApp });
  windowsLate({ renderDots });
  /* Swiping desks (wizard-ux#1491, #1536; on for everyone since #1563): the whole bottom bar, orb included, is one
   * scrub surface (dots, gaps, edges; the orb keeps its tap, hold and up/down). The scrub is live the moment the
   * finger passes the 12 px sideways slop (no hold time), counted from there, so it never jumps over the distance
   * already covered; it then steps one desk per SC_STEP px with a tick and the desk name, release lands. A SHORT touch
   * (under BAR_FLICK_STEPS = 2.5 x SC_STEP) that ends within BAR_FLICK_MS (event time, so a busy page never turns a flick
   * into a scrub) is a flick: exactly one desk the way it travelled, however many moves it came as (wizard-ux#1601;
   * under BAR_FLICK_MIN px it is drift and stays put); a fast long swipe goes by its whole distance like a slow one
   * (wizard-ux#1536 kick-back). Each step
   * shows the hovered desk itself (unparked, quick slide), so the desk is visible under the finger before release
   * (barScrubPeek). Drag left = the desk to the right. A sideways drag that starts on the orb joins the same scrub
   * (barScrubJoin, from the orb's gesture code). Nothing here reads Channels: CHATS.beforeNavigate is the incognito
   * chat's leave guard, the same one goDesk uses. */
  let DS = null, dockSwiped = 0; const BAR_FLICK_MS = 180, BAR_FLICK_STEPS = 2.5, BAR_FLICK_MIN = 20;
  /* Scrubbing along the bottom bar to step between desks; app-scrub.js. */
  const { barScrubDrop, barScrubJoin, bindLate: scrubLate } = window.WizCore.appParts.scrub({ $, appVars, BAR_FLICK_MIN, BAR_FLICK_MS, BAR_FLICK_STEPS, CHATS, endDotHold, goDesk, HOME, parkDesks, placeTrack, renderDots, secOf, swipeDesk, tourEv, track, vib });
  /* Overview (James, 10 Oct 2026): pinch in on a desk, or long-press the desk dots, to see every desk at once.
   * Tap a desk to go there · ✕ closes it · hold and drag to reorder (Home stays first) · pinch two desks
   * together to merge them into one desk · spread a desk that holds several windows to split them apart. */
  let ovEl = null, OV = null, ovTapBlock = 0;
  // Overview: the same app sigil and colour as the dock, large enough to recognize before reading.
  function ovMark(a) {
    const S = window.WizSigil, s = S.of(a.sigil || a);
    return { color: a.sgc || s.color, glyph: a.sgh || S.html(a.sigil || a) };
  }
  // Generic overview input/action adapter; packages choose a mode through the capability-gated host.
  const overviewModes = [], overviewMode = () => overviewModes.at(-1) || {};
  const arrangeDesks = () => overviewMode().hold === 'arrange';
  const overviewAdapter = { use(options) {
    const mode = Object.freeze({ ...options }); overviewModes.push(mode);
    const repaint = () => { if (ovEl?.classList.contains('open')) renderOverview(); }; repaint();
    let released = false;
    return () => { if (released) return; released = true; const at = overviewModes.indexOf(mode); if (at >= 0) overviewModes.splice(at, 1); repaint(); };
  } };
  /* Arrange/download tweak: holding a desk only arranges it (drag to reorder, ✕ to close, like an app switcher). A desk that
   * shows exactly one registered frontend app also gets a small download button beside its ✕ in arrange mode, which
   * opens the existing Add to home screen flow (native pin on Android, the two-step direct-link guide elsewhere). */
  function ovDeskApp(d) {
    const w = d && !d.home && d.wins.length === 1 ? W[d.wins[0]] : null, a = w?.app === 'frame' ? APP[w.appId] : null;
    return a && !a.system && window.WizHomeScreenApps?.canOffer?.(a) ? a : null;
  }
  function ovDl(d) {
    const a = overviewMode().appAction === 'home-screen' && ovDeskApp(d); if (!a) return '';
    const label = `Add ${esc(window.WizHomeScreenPolicy?.displayName?.(a) || a.name)} to home screen`;
    return `<button class="ov-dl" data-ovdl="${d.id}" aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14"/></svg></button>`;
  }
  function ovCard(i) {
    const d = desks[i], wins = d.wins.map(id => W[id]).filter(Boolean), rv = isReviewDesk(i), here = i === idx;
    const lead = W[d.focus] || wins[0], primary = lead ? ovMark(winApp(lead)) : { color: '#C9BEFF' };
    const second = wins.find(w => w !== lead), c2 = second ? ovMark(winApp(second)).color : primary.color;
    const name = d.home ? 'Home' : !wins.length ? 'New desk' : deskName(i);
    let body;
    if (d.home) body = `<span class="ov-symbol" style="--c:${primary.color}"><i class="sgi sg-home" aria-hidden="true"></i></span>`;
    else if (!wins.length) body = '<span class="ov-empty-symbol" aria-hidden="true">＋</span>';
    else body = wins.map(w => {
      const a = winApp(w), m = ovMark(a), same = wins.filter(x => winApp(x).id === a.id).length > 1;
      const label = same ? winTitle(w) : a.name;
      return `<span class="ov-win${w.from?.sid ? ' rv' : ''}"><span class="ov-symbol" style="--c:${m.color}">${m.glyph}</span>${wins.length > 1 ? `<em>${esc(label)}</em>` : ''}</span>`;
    }).join('');
    const cap = wins.length === 1 && winTitle(wins[0]) !== winApp(wins[0]).name ? winTitle(wins[0]) : '';
    const accessible = wins.length > 1 ? `${wins.length} windows: ${wins.map(w => winTitle(w)).join(', ')}` : name;
    return `<div class="ov-card${here ? ' here' : ''}${d.home ? ' ov-home' : ''}${rv ? ' review' : ''}" data-ov="${d.id}" role="button" tabindex="0"${here ? ' aria-current="true"' : ''} style="--ov-c:${primary.color};--ov-c2:${c2}" aria-label="${esc(accessible)}${here ? ', current desk' : ''}${rv ? ', review' : ''}">
      <div class="ov-chrome"><span class="ov-state">${here ? '<span class="ov-here">Here</span>' : ''}${rv ? '<span class="ov-review">Review</span>' : ''}</span>${d.home ? '' : `${ovDl(d)}<button class="ov-x" data-ovx="${d.id}" aria-label="Close ${esc(name)}">✕</button>`}</div>
      <div class="ov-body ov-n${Math.min(wins.length, 4)}">${body}</div>
      <div class="ov-top"><b>${esc(wins.length > 1 ? `${wins.length} windows` : name)}</b>${cap ? `<small>${esc(cap)}</small>` : ''}</div></div>`;
  }
  /* The Desks overview and the pill panel; app-overview.js. */
  const { closeAppPlayback, closeDesk, closeOverview, closePeek, closeWin, focusWin, insertPos, mergeDesks, moveWin, openOverview, openPeek, openWin, pillOvOpen, posOf, renderOverview, reorderDesks, SC_STEP, scLabel, scrub, sharedDeskOrder, splitDesk, bindLate: overviewLate } = window.WizCore.appParts.overview({ $, announce, APP, applyLayout, appVars, arrangeDesks, blank, CH, CHATS, clip, closeSheets, deskName, deskOf, deskSigil, device, esc, goDesk, MAXW, newId, ovCard, ovDeskApp, ovDl, overviewMode, renderDesk, renderDots, save, syncDesks, vib, winApp, winEl, winTitle });
  windowsLate({ closeWin });
  desksLate({ closeOverview, openOverview });
  scrubLate({ SC_STEP, scLabel, scrub });
  let fullAt = 0;
  /* Immersive full screen (James, 9 Oct): a full-screen window owns the whole display. Its title bar,
   * the bottom bar with the orb, the desk label and the phone's status bar all go away. Ways out:
   * pinch in, swipe up from the bottom edge, or Back. Chats keeps a small orb in the bottom-right
   * corner so a voice reply is always one tap away; there the orb only talks (no shell swipes). */
  var immOn = null, immTipT = 0; // var: applyLayout can run before this line during boot
  /* Edge to edge (James, 10 Oct): in immersive full screen the window reaches the very top of the glass, under
   * the camera too. The native shell reports the camera cutout height; shell-drawn windows pad their content by
   * it, and hosted apps get it as --wos-cutout on their <html> so their own top controls can clear the camera. */
  var cutTop = 0; try { cutTop = +window.WizardOSNative?.cutoutTop?.() || 0; } catch (e) {}
  function shareCutout() {
    const v = device.classList.contains("immersive") ? (cutTop || 0) : 0;
    device.style.setProperty('--cut-t', v + 'px');
    $$('iframe.appframe').forEach(f => { try { const d = f.contentDocument; if (d && d.documentElement) d.documentElement.style.setProperty('--wos-cutout', (f.closest('.win.full') ? v : 0) + 'px'); } catch (e) {} });
  }
  window.__wosCutout = px => { cutTop = Math.max(0, px | 0); shareCutout(); };
  /* Status bar (James, 10 Oct: "like Telegram"): the native shell draws this page under the status bar so the
   * background reaches the top of the glass, and reports the bar's height; --safe-t keeps content below it. */
  function setNatTop(px) { document.documentElement.style.setProperty('--nat-t', Math.max(0, px | 0) + 'px'); }
  try { setNatTop(+window.WizardOSNative?.insetTop?.() || 0); } catch (e) {}
  window.__wosTop = setNatTop;
  /* A hosted app either clears the camera itself (its CSS reads --wos-cutout) or the shell moves it below the camera
   * and paints the strip above in the app's own background colour. */
  function frameEdge(f) {
    const we = f.closest('.win'); if (!we) return;
    let own = false, bg = '', top = '';
    try {
      const d = f.contentDocument;
      own = !!d.querySelector('meta[name="wizard-os-edge"][content="cover"]');
      if (!own) for (const sh of d.styleSheets) { let t = ''; try { t = Array.from(sh.cssRules, r => r.cssText).join(''); } catch (e) {} if (t.includes('--wos-cutout')) { own = true; break; } }
      const pick = el => { const c = el && d.defaultView.getComputedStyle(el).backgroundColor; return c && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(c) ? c : ''; };
      bg = pick(d.body) || pick(d.documentElement);
      // The opaque colour actually painted along the app's top edge (a full-width header or page wrapper), so a
      // heading drawn above the app can continue it. Art without a colour yields nothing; the heading keeps its default.
      const vw = d.documentElement.clientWidth;
      for (let n = d.elementFromPoint(vw / 2, 1); n && n !== d.documentElement && !top; n = n.parentElement) {
        if (n.getBoundingClientRect().width < vw * .9) continue;
        if (n.tagName === 'IMG') {   // full-width hero art: average its top rows (same-origin images only; a tainted canvas throws)
          if (!n.complete || !n.naturalWidth) continue;
          try {
            // Sample what is on screen, not the source file: the visible top 12px under object-fit/position, through the
            // image's CSS filter, then under any full-width shade the app layers above it (first colour of its gradient).
            const cs = d.defaultView.getComputedStyle(n), r = n.getBoundingClientRect(), nw = n.naturalWidth, nh = n.naturalHeight;
            const cv = d.createElement('canvas'); cv.width = 8; cv.height = 1;
            const x = cv.getContext('2d'), band = Math.min(12, r.height);
            let sx = 0, sy = 0, sw = nw, sh = band * nh / r.height;
            if (cs.objectFit === 'cover') {
              const k = Math.max(r.width / nw, r.height / nh), [px, py] = cs.objectPosition.split(' ').map(p => p.endsWith('%') ? parseFloat(p) / 100 : .5);
              sx = (nw * k - r.width) * px / k; sy = (nh * k - r.height) * py / k; sw = r.width / k; sh = band / k;
            }
            if (cs.filter && cs.filter !== 'none') x.filter = cs.filter;
            x.drawImage(n, sx, sy, sw, Math.max(1, sh), 0, 0, 8, 1); x.filter = 'none';
            for (let s = n.nextElementSibling; s; s = s.nextElementSibling) {
              const sr = s.getBoundingClientRect(); if (sr.top > r.top + 1 || sr.width < r.width * .9) continue;
              const ss = d.defaultView.getComputedStyle(s), sg = /^linear-gradient\((?:to bottom, |180deg, )?(rgba?\([^)]*\))/.exec(ss.backgroundImage);
              for (const c of [ss.backgroundColor, sg && sg[1]]) if (c && c !== 'rgba(0, 0, 0, 0)') { x.fillStyle = c; x.fillRect(0, 0, 8, 1); }
            }
            const px = x.getImageData(0, 0, 8, 1).data, s = [0, 0, 0];
            for (let i = 0; i < 32; i += 4) for (let k = 0; k < 3; k++) s[k] += px[i + k];
            top = `rgb(${s.map(v => Math.round(v / 8)).join(', ')})`;
          } catch (e) {}
          continue;
        }
        const c = pick(n), g = /^linear-gradient\((?:to bottom, |180deg, )?(rgb\([^)]*\))/.exec(d.defaultView.getComputedStyle(n).backgroundImage);
        if (g) top = g[1]; else if (c && c.startsWith('rgb(')) top = c;
      }
      // Re-sample after in-app navigation and whenever an image finishes loading (routes render their hero art late).
      const v = d.defaultView; if (!v.__wosTopWatch) {
        let t = 0; const again = () => { clearTimeout(t); t = setTimeout(() => { if (f.isConnected) frameEdge(f); }, 150); };
        v.__wosTopWatch = 1; ['hashchange', 'popstate'].forEach(e => v.addEventListener(e, again));
        d.addEventListener('load', e => { if (e.target.tagName === 'IMG') again(); }, true);
      }
    } catch (e) {}
    we.classList.toggle('edge-own', own);
    // The heading shows `top`, else `bg`: say when that colour is light so its title takes a dark ink (skin-frame.css).
    let light = false;
    if (top || bg) try {
      // Computed colours can use sRGB, display-p3 or oklch coordinates, not just legacy RGB notation.
      // Reuse the browser's canvas conversion to sRGB instead of parsing coordinates.
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const x = cv.getContext('2d', { willReadFrequently: true });
      x.fillStyle = top || bg; x.fillRect(0, 0, 1, 1);
      let rgb = x.getImageData(0, 0, 1, 1).data;
      if (rgb[3] < 255) {
        // Text-bearing headings must be opaque. Flatten translucent app paint over
        // the phone frame's existing dark fallback, then paint exactly what we measured.
        const alpha = rgb[3] / 255;
        rgb = [15, 16, 20].map((base, i) => Math.round(rgb[i] * alpha + base * (1 - alpha)));
        const opaque = '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('');
        if (top) top = opaque; else bg = opaque;
      }
      const lin = c => (c /= 255) <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
      light = .2126 * lin(rgb[0]) + .7152 * lin(rgb[1]) + .0722 * lin(rgb[2]) > .18;
    } catch (e) {} // Inaccessible or unmeasurable apps retain light ink on the dark fallback.
    we.classList.toggle('edge-light', light);
    if (bg) we.style.setProperty('--frame-bg', bg); else we.style.removeProperty('--frame-bg');
    if (top) we.style.setProperty('--frame-top', top); else we.style.removeProperty('--frame-top');
  }
  function syncImmersive() {
    const d = desks[idx], w = d && d.full && d.focus ? W[d.focus] : null, on = !!w;
    FIELDS?.refresh();
    const corner = on && (w.app === 'chats' || !!FIELDS?.current || (FIELDS && V.kind === 'dictation' && V.state !== 'idle'));
    device.classList.toggle('immersive', on);
    device.classList.toggle('orb-corner', corner);
    window.WosScenery?.update(); // scenery hook: full screen freezes the background
    trackCornerLift(corner);
    shareCutout();
    if (on === immOn) return; immOn = on;
    try { window.WizardOSNative?.immersive?.(on); } catch (e) {}
    clearTimeout(immTipT); device.classList.remove('imm-tip');
    if (on) {
      void device.offsetWidth; device.classList.add('imm-tip');
      immTipT = setTimeout(() => device.classList.remove('imm-tip'), 2600);
      const n = store.get('immTips', 0);
      if (n < 3) { store.set('immTips', n + 1); toast('⤡', 'Pinch in or swipe up from the bottom to exit full screen'); }
    }
  }
  /* Full-screen Chats (James, 10 Oct): the orb sits in the right-hand column above the composer, high enough that
   * Done (end of a reply) and ↓ Latest (scrolled up) sit directly below it. It follows the composer's real height
   * (attachments, multi-line text, keyboard). On the thread list there is no composer: it stays in the corner. */
  let liftRO = null, liftMO = null, liftEl = null;
  function paintCornerLift() {
    const c = device.querySelector('.win.full .ch-thread .ch-compose');
    if (c !== liftEl) { try { liftRO?.disconnect(); } catch (e) {} liftEl = c; if (c && liftRO) liftRO.observe(c); }
    const h = c && c.offsetParent ? Math.round(c.getBoundingClientRect().height) : 0;
    device.style.setProperty('--comp-h', h + 'px');
    device.classList.toggle('orb-lift', h > 0);
  }
  function trackCornerLift(on) {
    if (!on) { try { liftRO?.disconnect(); liftMO?.disconnect(); } catch (e) {} liftRO = liftMO = liftEl = null; device.classList.remove('orb-lift'); device.style.removeProperty('--comp-h'); return; }
    if (!liftRO && window.ResizeObserver) { liftRO = new ResizeObserver(paintCornerLift); liftMO = new MutationObserver(paintCornerLift); liftMO.observe(track, { childList: true, subtree: true }); }
    paintCornerLift();
  }
  function setFull(id, on) {
    const i = deskOf(id); if (i < 0) return;
    const d = desks[i]; d.focus = id; d.full = !!on; fullAt = performance.now(); applyLayout(i); save(); vib(on ? 10 : 6);
  }
  /* Distraction-free (James, 18 Oct 2026): a short swipe down on the orb, or just above it, hides the bottom bar and
   * every window's title bar. The windows grow into the freed space through the inset transition the tiles already
   * use and the title bar slides up out of the window, so nothing jumps and no system bars change. Swipe up from the
   * bottom edge, or Back, brings them back. Voice still shows the bar while a take is live. This replaces the old
   * swipe-down Inbox shade (the Inbox stays reachable by voice and its other entry points). */
  var zen = false, zenTipT = 0; // var: boot restores it before later lets run
  /* Full screen, clearing a desk, and links that open on a desk of their own; app-linkdesk.js. */
  const { clearDesk, fromOf, linkTitle, mountLinks, openLinkDesk, setZen, bindLate: linkdeskLate } = window.WizCore.appParts.linkdesk({ APP, appAt, APPS, appVars, closeDesk, closeSheets, deskOf, device, goDesk, LIVE, openWin, store, tourEv, vib, winEl, winTitle });
  modelLate({ fromOf, openLinkDesk });
  /* ---------------- bound views ----------------
   * James, 12 Oct 2026: "as soon as I open the thread, I'm reading your response, but there's a view bound to it."
   * A thread whose latest reply links a page or app (the thing that was built or changed) opens that view on the
   * desk right beside the thread the moment the thread opens, out of view. The thread's right edge blends into it
   * (the next desk peeks in, with a tab carrying the app's sigil): tap the tab or swipe the bar to look. On the
   * view: the orb sends feedback to the thread (review mode), Back slides back to the thread, "Open app" keeps a
   * normal copy on a desk of its own, ✕ closes it for this reply. Leaving the thread (Back to the list, another
   * thread) closes the bound view; opening the thread again, or a new reply with a new link, binds again.
   * Binding = the first in-app link in the latest reply (an agent-declared view can replace this later). */
  var boundOff = {}, boundBusy = false;
  const boundTarget = el => window.WosBoundView.target(el, { findApp, APP, linkTitle, appAt });
  const boundOf = wid => Object.values(W).find(x => x.bound === wid && deskOf(x.id) >= 0) || null;
  // Automatic bound-view disposal is navigation, not the user's Music Close action.
  function unbind(wid) { const b = boundOf(wid); if (b) closeWin(b.id, true, true); }
  // Called by Chats whenever a window paints a loaded thread (el) or its list (null).
  let boundManager;
  /* Views bound to a thread and the peek; app-bound.js. */
  const { detachBound, pinWin, syncBound, threadShown, bindLate: boundLate } = window.WizCore.appParts.bound({ $$, APP, applyLayout, appVars, boundOf, CHATS, clip, closeWin, deskOf, device, esc, findApp, focusWin, fromOf, goDesk, linkTitle, openWin, renderDots, save, secOf, store, track, winEl, winTitle });
  modelLate({ threadShown });
  desksLate({ syncBound });
  /* Review mode: the amber orb ring is the only lasting marker (James, 10 Oct 2026: no persistent chip).
   * The first time a review desk opens, a one-off card explains it; tap anywhere or Back dismisses it. */
  let rvCoach = null;
  /* The Review coach, quick search and placing an app in a window; app-search.js. */
  const { bringBeside, closeReviewCoach, framePage, hostedOpenable, NATIVE, openAgentChats, openApp, openChatsFiltered, openChatsList, openSearch, placeApp, showChats, syncReviewChip, tapOpen, bindLate: searchLate } = window.WizCore.appParts.search({ APP, appAt, appVars, blank, CHATS, clip, closeSheets, closeWin, deskOf, device, esc, focusedWin, focusWin, fromOf, goDesk, HOME, insertPos, LIVE, mainChats, mountLinks, openWin, renderDesk, save, searchUrl, setFull, sharedDeskOrder, sideButtonTap, store, syncDesks, vib, winApp, winEl });
  modelLate({ hostedOpenable, openApp });
  windowsLate({ syncReviewChip });
  desksLate({ syncReviewChip });
  linkdeskLate({ openApp });
  boundLate({ bringBeside, syncReviewChip });
  let SIDE = null;
  try { if (NATIVE()) SIDE = JSON.parse(window.WizardOSNative.sideButton()); } catch (e) { SIDE = null; }
  function sideCard() {
    if (!SIDE || SIDE.step === 'ready' || store.get('sideHidden', false)) return '';
    const on = SIDE.step === 'press';
    const k = on ? 'Side button is on' : 'Side button';
    const v = on ? (SIDE.samsung ? 'Hold the side button and talk · power menu? tap here' : 'Hold the side button and talk') : 'Hold it to talk to Wizard, even when locked';
    const btn = on ? '' : `<span class="side-go">${SIDE.step === 'mic' ? 'Turn on' : 'Finish'}</span>`;
    return `<button class="now-card side-card ${on ? 'on' : ''}" style="--c:${on ? 'var(--green)' : 'var(--violet-2)'}" data-act="side-button" data-step="${SIDE.step}"><span class="pip ${on ? '' : 'pulse'}"></span><span class="meta"><span class="k">${k}</span><span class="v">${v}</span></span>${btn}${on ? '<span class="side-x" data-act="side-button-hide" aria-label="Hide">✕</span>' : ''}</button>`;
  }
  function sideButtonTap(fromLauncher) {
    if (!NATIVE()) { toast('◉', `The side button works in the ${OS()} app`); return; }
    if (SIDE && SIDE.step !== 'mic' && SIDE.step !== 'assistant') {
      if (fromLauncher) { store.set('sideHidden', false); refreshHome(true); }
      toast('◉', SIDE.step === 'ready' ? 'Side button is on. Hold it to talk.' : 'Side button is on. Hold it and talk.', 2600);
      // Samsung: if holding the key still opens the power menu, the tap goes straight to Samsung's Side button page.
      if (SIDE.samsung && SIDE.step === 'press') window.WizardOSNative.sideButtonSettings();
      else if (fromLauncher && SIDE.samsung) window.WizardOSNative.sideButtonSettings();
      return;
    }
    window.__backLog = (window.__backLog || []).concat('side:' + (SIDE ? SIDE.step : '?')).slice(-30);
    window.WizardOSNative.setupSideButton();
  }
  window.__wosSideButton = st => {
    if (!st || typeof st !== 'object') return false;
    const was = SIDE && SIDE.step; SIDE = st;
    if (was !== st.step) refreshHome(true);
    return true;
  };
  /* unsent: moved to app-unsent.js (wizard-ux issue 1665), called once here */
  const { gearBtn, readNativeUnsent, unsentAll, unsentCard, unsentRow } = window.WizCore.appParts.unsent({ clip, esc, NATIVE, refreshHome: (...a) => refreshHome(...a), settingsContext: (...a) => settingsContext(...a) });
  let settingsView = null;
  const settingsContext = () => ({ outbox: OUTBOX, live: LIVE, ago, toast,
    shell: 'phone', haptic: vib, visible: () => sheet === 'settings',
    helpSub: 'How the orb, desks and Back work · practice again',
    sideReady: () => SIDE?.step === 'press' || SIDE?.step === 'ready',
    changed: onUnsentChange,
    openThread: id => { closeSheets(true); openWizardThread(id); },
    editUnsent,
    restoreReply: id => { closeSheets(true); return recoverParkedReply(id); },
    openStore: id => { closeSheets(true); openWin({ app: 'frame', appId: 'app-store', url: '/wizard-os-home/store/index.html' + (id ? '?app=' + encodeURIComponent(id) : '') }); },
    chatsChanged: id => { for (const w of Object.values(W)) if (w.app === 'chats' && !w.agent) { w.chatsProvider = id; renderChats(w); } save(); },
    openLink: (url, title) => { closeSheets(true); return openLinkDesk(url, null); },
    openSub: id => {
      if (id === 'files') { settingsReturn = id; openFilesScreen(); }
      if (id === 'help') { settingsReturn = id; closeSheets(true); window.WosTour?.openHelp(); }
      if (id === 'side') { closeSheets(true); sideButtonTap(true); }
    },
  });
  let settingsReturn = '', settingsFocus = null;
  /* Settings as a sheet, unsent items, Home repaints and the New desk app cards; app-cards.js. */
  const { editUnsent, foldOpen, frameHref, frameNav, homeLate, menuEl, newDesk, onUnsentChange, openAppInfo, openFilesScreen, openSettings, openStoreKind, openWizardThread, orbUpDesks, orbUpVar, paintHome, refreshHome, renderApp, renderEmpty, renderFrame, renderHome, renderSettings, selfPop, unsentAction, watchFrames, bindLate: cardsLate } = window.WizCore.appParts.cards({ $, $$, APP, applyLayout, APPS, appTile, appVars, blank, CHATS, closeSheets, closeWin, deskOf, detachBound, device, DOWL, esc, focusWin, frameEdge, frameSetHidden, gearBtn, goDesk, HOME, ico, live, LIVE, mainChats, MON, NATIVE, norm, openApp, openChat, openChatsFiltered, openWin, OUTBOX, pinWin, placeApp, readNativeUnsent, renderChats, renderDots, renderThread, runUtterance, save, secOf, setFull, settingsContext, shareCutout, sideButtonTap, sideCard, store, syncDesks, tapOpen, track, unsentCard, winApp, winEl });
  modelLate({ editUnsent, openSettings, openWizardThread });
  windowsLate({ paintHome, renderApp, renderEmpty, renderFrame, renderHome, watchFrames });
  desksLate({ newDesk });
  overviewLate({ newDesk, orbUpVar });
  boundLate({ frameHref });
  let menuFor = null;
  /* Pinching a window to fill the screen and the bottom edge in full screen; app-pinch.js. */
  const { bindWinPinch, closeMenu, inboxEl, launcher, settingsEl } = window.WizCore.appParts.pinch({ $, appVars, deskOf, device, menuEl, openOverview, setFull, track, winEl });
  modelLate({ closeMenu });
  cardsLate({ bindWinPinch });
  let sheet = null;
  /* Settings that belongs to a desk and opening a sheet; app-deskset.js. */
  const { liftSettings, openSheet, rideSettings, bindLate: desksetLate } = window.WizCore.appParts.deskset({ $, appVars, closeMenu, closeSheets, device, foldOpen, inboxEl, launcher, openChatsList, renderLauncher, renderSettings, settingsEl, tourEv, vib });
  windowsLate({ rideSettings });
  desksLate({ liftSettings });
  scrubLate({ liftSettings });
  cardsLate({ openSheet });
  function closeSheets(quiet) {
    if (!sheet && quiet) return;
    const was = sheet; sheet = null; if (was) tourEv('sheet-closed', { which: was }); device.classList.remove('sheet-open'); delete device.dataset.sheet;
    launcher.classList.remove('open'); inboxEl.classList.remove('open'); if (!stDesk) settingsEl.classList.remove('open');
    [launcher, inboxEl, settingsEl].forEach(el => { if (el === settingsEl && stDesk) return; el.style.transform = ''; el.style.opacity = ''; });
    if (was === 'settings') settingsEl.style.transition = '';
    $('#search').blur();
    if (was === 'settings' && settingsFocus?.isConnected) settingsFocus.focus({ preventScroll: true });
    window.WosResources?.sync();
    window.WosScenery?.update(); // scenery hook: sheet closed, Home may animate again
  }
  settingsEl.setAttribute('role', 'dialog'); settingsEl.setAttribute('aria-modal', 'true');
  settingsEl.addEventListener('keydown', e => window.WosSettings.trap(e, settingsEl));
  $('#scrim').addEventListener('click', () => backStep(undefined, { outside: true }));
  /* Swipe the grip down to close Settings or Apps, like every sheet (wizard-os#265 rule 7; Apps: wizard-ux issue 1734).
   * Only the grip drags; the body scrolls. A long drag or a fast flick closes, a short slow one springs back. */
  const sheetDrag = (el, which) => { let y0 = null, dy = 0, t0 = 0;
    return { on: () => y0 != null,
      start(y) { if (sheet !== which) return false; y0 = y; dy = 0; t0 = performance.now(); el.style.transition = 'none'; return true; },
      move(y) { if (y0 == null) return; dy = Math.max(0, y - y0); el.style.transform = `translateY(${dy}px)`; },
      end() { if (y0 == null) return; y0 = null; el.style.transition = ''; if (dy > 90 || (dy > 30 && dy / ((performance.now() - t0) || 1) > .6)) closeSheets(); else el.style.transform = ''; } }; };
  for (const [el, which] of [[settingsEl, 'settings'], [launcher, 'launcher']]) { const grip = el?.querySelector('.sheet-grip'), d = sheetDrag(el, which);
    grip?.addEventListener('pointerdown', e => { if (d.start(e.clientY)) try { grip.setPointerCapture(e.pointerId); } catch (_) {} });
    grip?.addEventListener('pointermove', e => d.move(e.clientY));
    grip?.addEventListener('pointerup', d.end); grip?.addEventListener('pointercancel', d.end); }
  /* Apps: a swipe down on the app grid when it is already at its top pulls the panel down too (issue 1734). A grid
   * scrolled down only scrolls; up and sideways moves are left alone. Touch events, so the first downward move past an
   * 8 px tap slop can stop the grid's own (empty) scroll before the browser commits to it. */
  { const body = launcher?.querySelector('.launcher-body'), d = sheetDrag(launcher, 'launcher'); let x0 = 0, y0 = null;
    body?.addEventListener('touchstart', e => { const t = e.touches[0]; y0 = e.touches.length === 1 && body.scrollTop <= 0 ? t.clientY : null; x0 = t.clientX; }, { passive: true });
    body?.addEventListener('touchmove', e => {
      const t = e.touches[0]; if (!t) return;
      if (!d.on()) { if (y0 == null) return; const dy = t.clientY - y0, dx = Math.abs(t.clientX - x0);
        if (dy < 0 || dx > 8 || e.touches.length > 1) { y0 = null; return; }
        if (dy < 8) return; // tap slop (Android's 8 dp): a tile tap with a little jitter stays a tap
        if (!d.start(y0)) { y0 = null; return; } }
      if (e.cancelable) e.preventDefault(); d.move(t.clientY);
    }, { passive: false });
    const end = () => { y0 = null; d.end(); }; body?.addEventListener('touchend', end); body?.addEventListener('touchcancel', end); }
  settingsEl.addEventListener('click', e => {
    if (e.target.closest('[data-stclose]')) return closeSheets();

  });

  function appTile(a) { return `<button class="lapp" data-app="${a.id}" style="--i:${tileN++}">${ico('span', 'ic', a, a.kind === 'native' ? '<span class="badge">APK</span>' : '')}<span class="nm">${esc(a.name)}</span></button>`; }
  function appRow(a, sel) { const k = a.kind === 'view' ? 'view' : a.kind === 'native' ? 'native' : 'app'; return `<button class="lrow ${sel ? 'sel' : ''}" data-app="${a.id}">${ico('span', 'ic', a)}<span class="nm">${esc(a.name)}<small>${esc(a.desc)}</small></span><span class="kind ${k}">${k === 'native' ? 'Android' : k === 'view' ? 'View' : 'Wizard'}</span></button>`; }
  // live: a background refresh (sessions poll, app list). It repaints only when the content changed and never
  // moves the scroll, so an open Apps sheet stays still instead of redrawing every 15 s (James, 10 Oct).
  let pinSheetHtml = null; // the pin sheet's grid while pinning the Messenger slot (app-sections.js)
  function renderLauncher(q, live) {
    const body = $('#launcherBody');
    q = q.trim(); tileN = 0;
    const paint = html => {
      if (live && body.__lhtml === html) return;
      const top = body.scrollTop; body.innerHTML = html; body.__lhtml = html;
      body.scrollTop = live ? top : body.scrollHeight;
    };
    if (!q) {
      // Recent is a placement, not a second copy of the Apps catalogue. Resolve aliases before deduping.
      const pin = typeof pinSheetHtml === 'function' && pinSheetHtml(); if (pin) { paint(pin); return; } // "Pin an app here" (app-sections.js)
      const recentIds = [...new Set(store.get('recent', window.WizLauncher?.get('recents') || []).map(id => APP[id]?.id))].filter(id => APP[id] && !['app-store', 'agents'].includes(id) && APP[id].kind !== 'native' && !window.WizCore.isMaintenanceApp(APP[id])).slice(0, 4);
      const remainingApps = APPS.filter(a => !recentIds.includes(a.id) && a.id !== 'agents' && !window.WizCore.isMaintenanceApp(a) && (a.kind === 'wizard' || a.kind === 'chats' || a.kind === 'usuals'));
      paint(`<div class="lgroup"><h4>Recent</h4><div class="lgrid">${recentIds.map(id => appTile(APP[id])).join('')}</div></div>
        <div class="lgroup"><h4>Apps <span>${remainingApps.length}</span></h4><div class="lgrid">${remainingApps.map(appTile).join('')}<button class="lapp" data-storekind="apps"><span class="ic">+</span><span class="nm">Get apps</span></button></div></div>`); // preserve current tiles/order; Get apps opens the Store's Apps section, so the App Store's own tile is its one data-app entry
      return;
    }
    const n = norm(q);
    // Android apps stay voice-only ("open Maps" still routes); they never clutter the launcher.
    const hits = APPS.filter(a => a.kind !== 'native' && a.id !== 'agents' && !window.WizCore.isMaintenanceApp(a)).map(a => { const nm = norm(a.name), ds = norm(a.desc); const s = nm.startsWith(n) ? 3 : nm.includes(n) ? 2 : ds.includes(n) ? 1 : 0; return [s, a]; }).filter(x => x[0]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
    const th = (LIVE.ok ? LIVE.sessions.filter(x => !x.hidden && norm(x.title).includes(n)) : []).slice(0, 5);
    // Bottom-anchored like the rest of the sheet: the best app match sits right above the search bar, so it stays
    // in sight when the keyboard shrinks the sheet (James, 11 Oct: "searched wisdom and it didn't pop up").
    const top = hits.slice(0, 7);
    paint(`<div class="lgroup"><h4>Command</h4><button class="lrow ${hits.length ? '' : 'sel'}" data-cmd="${esc(q)}">${sig('ic', 'bolt', '#0AD3E3', '⚡')}<span class="nm">“${esc(q)}”<small>Run through the fast router</small></span><span class="kind cmd">Run</span></button></div>
      ${searchUrl(q) ? (() => { const qs = quickSearch(q) || { query: q, tab: 'all' }; return `<div class="lgroup"><h4>Search</h4><button class="lrow" data-qsearch="${esc(qs.query)}" data-qtab="all">${sig('ic', 'search', '#81B7FF', '⌕')}<span class="nm">“${esc(qs.query)}”<small>Search with an AI overview</small></span><span class="kind view">Web</span></button><button class="lrow" data-qsearch="${esc(qs.query)}" data-qtab="images">${sig('ic', 'image', '#EF90FE', '▦')}<span class="nm">“${esc(qs.query)}”<small>Image search</small></span><span class="kind view">Images</span></button></div>`; })() : ''}
      ${th.length ? `<div class="lgroup"><h4>Threads</h4>${th.map(t => `<button class="lrow" data-thread="${esc(t.id)}"><span class="ic emo">${emoOf(t.id)}</span><span class="nm">${esc(t.title)}<small>${esc(ago(t.lastAssistantAt || t.updatedAt))}${LIVE.isNew(t) ? ' · unread' : ''}</small></span><span class="kind view">Chats</span></button>`).join('')}</div>` : ''}
      ${top.length ? `<div class="lgroup"><h4>Apps &amp; views</h4>${top.slice().reverse().map(a => appRow(a, a === top[0])).join('')}</div>` : ''}`);
  }
  /* The desk bar above search and the launcher grid; app-deskbar.js. */
  const { DEV, dictationLate, dictationTake, FIELDS, keepAwake, nativeBlob, nativeFinish, nativeResume, nativeTakeAppOwned, paintFieldOrb, paintOrbBadge, pauseNativeTake, recDone, reloadWin, renderInbox, renderMoons, reportVoice, startOrbVoice, toast, tx, V, voiceEl, voiceElapsed, voiceRecovery, voiceTake } = window.WizCore.appParts.deskbar({ $, $$, ago, APP, applyLayout, appVars, cancelVoice, CHATS, CHATS_APP, clip, closeSheets, closeWin, deskName, deskOf, device, emoOf, esc, finishVoice, generalVoiceSnap, homeLate, ico, inboxEl, launcher, live, LIVE, loadThread, makeWin, markVisibleThreadsSeen, mountWin, moveWin, onRecStop, onUnsentChange, openAppInfo, openSearch, openStoreKind, openWizardThread, OUTBOX, overviewMode, paintVoiceDestination, refreshHome, renderChatList, renderDots, renderLauncher, replyTake, runUtterance, sendSnap, setFull, startVoice, store, tapOpen, tick, track, trackCornerLift, txHide, unsentAction, unsentAll, unsentRow, vib, winApp, winEl, winTitle });
  modelLate({ FIELDS, toast, V });
  windowsLate({ renderMoons });
  desksLate({ paintOrbBadge });
  overviewLate({ toast });
  linkdeskLate({ toast });
  boundLate({ toast });
  searchLate({ toast });
  cardsLate({ FIELDS, reloadWin, renderInbox, renderMoons, toast, V });
  desksetLate({ renderInbox });
  let NOMIC = false;
  /* voicefiles: moved to app-voicefiles.js (wizard-ux issue 1665), called once here */
  const { cancelTakeFiles, isPill, renderVoiceFiles, setVoice, takeFiles, txPill, txShow, uploadVoiceFile, voicePicker, withSealFiles } = window.WizCore.appParts.voicefiles({ $, CHATS, device, FIELDS, keepAwake, paintFieldOrb, paintVoiceDestination, reportVoice, toast, tourEv, tx, V, voiceEl });
  dictationLate({ renderVoiceFiles, setVoice, txPill });
  let txHideT = 0;
  // Once the card has faded, drop its choice chips too: a hidden card with chips kept the × "on" and made
  // the next Back silently clear an invisible card instead of navigating.
  function txHide(ms) {
    clearTimeout(txHideT);
    txHideT = setTimeout(() => {
      voiceEl.classList.remove('tx');
      txHideT = setTimeout(() => { if (!voiceEl.classList.contains('tx') && $('#txChips').childElementCount) { $('#txChips').innerHTML = ''; V.holdText = ''; V.holdOpts = null; } }, 320);
    }, ms || 0);
  }
  const fmtT = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function tick() {
    const el = V.acc + (V.state === 'listen' || V.state === 'command' ? performance.now() - V.t0 : 0);
    $('#timer').textContent = fmtT(el);
    paintQuickWindow(el);
    if (V.an) {
      const a = new Uint8Array(V.an.fftSize); V.an.getByteTimeDomainData(a);
      let s = 0; for (let k = 0; k < a.length; k++) { const v = (a[k] - 128) / 128; s += v * v; }
      orbLevel(V.state === 'paused' ? 0 : Math.min(1, Math.sqrt(s / a.length) * 4.2));
    } else if (V.native) {
      if (performance.now() - (V.lvlAt || 0) > 90) { V.lvlAt = performance.now(); try { V.lvl = DEV().recLevel() / 100; } catch (e) {} }
      orbLevel(V.state === 'paused' ? 0 : Math.min(1, (V.lvl || 0) * 1.6));
    } else if (V.sim) orbLevel(V.state === 'paused' ? 0 : .25 + .25 * Math.sin(performance.now() / 160) * Math.sin(performance.now() / 410));
    tx.style.setProperty('--lvl', (V.an || V.sim || V.native) ? 0.4 : 0);
    if (V.state !== 'idle' && V.state !== 'think') V.raf = requestAnimationFrame(tick);
  }
  /* The composer mic (#13): start a take that belongs to one thread; tap again (mic or orb) to send it there.
   * The pin survives a page reload during a native take (keyed by the take id), so it can never land elsewhere. */
  const REPLY_KEY = 'wos.reply-take.v1';
  function replyTake(id, val) {
    try {
      if (id === null) { localStorage.removeItem(REPLY_KEY); return null; }
      if (val) { localStorage.setItem(REPLY_KEY, JSON.stringify({ id, ...val })); return val; }
      const r = JSON.parse(localStorage.getItem(REPLY_KEY) || 'null');
      return r && r.id === id && r.sid ? { wid: W[r.wid] ? r.wid : '', sid: r.sid, steerRunId: r.steerRunId || '', custodyId:r.custodyId||'', ...(typeof r.box === 'string' ? { box: r.box } : {}), ...(typeof r.space === 'string' ? { space: r.space } : {}) } : null;
    } catch (e) { return null; }
  }
  window.__wosReplyTake = id => replyTake(id);
  let parkedReply=null, parking=false;
  /* A voice reply from a composer mic and parking a reply; app-reply.js. */
  const { parkReply, recordReply, recoverParkedReply, restoreReply, returnMeeting, bindLate: replyLate } = window.WizCore.appParts.reply({ $, appVars, CHATS, DEV, finishVoice, LIVE, nativeBlob, OUTBOX, recDone, renderVoiceFiles, sendSnap, setVoice, startVoice, tick, toast, txPill, V, voiceRecovery });
  modelLate({ recordReply });
  async function startVoice(kind, opt = {}) {
    // The Mac app sets this while it restarts for an approved update: a take started now would be cut off.
    if (window.__wizardUpdateFrozen) { toast('…', 'Wizard is preparing an update; recording is paused', 2200); return 'busy'; }
    if (CHATS.incognitoActive(opt.replyTo?.wid || focusedWin()?.id) || document.activeElement?.closest?.('[data-incog-thread]')) { toast('!', 'Incognito is text only · finish it before recording', 2600); return 'busy'; }
    V.onAt = performance.now();
    if(V.admitting||parking)return 'busy';
    if(V.state==='paused' && V.replyTo && ['dictation','command'].includes(kind)) {
      try {await parkReply();}catch(e){toast('!',esc(e.message));return 'busy';}
    }
    if (V.state !== 'idle') return;
    const initialSnap=kind==='dictation'?null:kind==='general'?generalVoiceSnap():sendSnap();
    if(initialSnap && !initialSnap.route) initialSnap.route=CHATS.modelRoute(initialSnap.view?.id,initialSnap.view?.thread||'__new__');
    // An explicit agent pick (two-orb layout's agent orb): a new chat with that agent, its own route only.
    if (initialSnap && kind === 'general' && opt.agent && window.WosAgents?.isOther(opt.agent)) {
      let r = null; try { r = window.WosModels.snapshot('', null, opt.agent); } catch (e) { toast('!', esc(e.message), 2600); return 'busy'; }
      if (!r?.agent) { toast('!', 'That agent has no model yet · open Agents', 2600); return 'busy'; }
      initialSnap.route = r;
    }
    const shared = window.WizAppCapture?.getState?.();
    let meetingLoan=null;
    if (shared?.active || shared?.recording || shared?.hold) {
      V.admitting=true;V.admitCancelled=false;V.admitSend=false;V.admitReply=opt.replyTo||null;
      try {meetingLoan=await window.WosOrbHandoff.begin();}
      catch(e){restoreReply();toast('🎙',esc(e.message),3000);return 'busy';}
      finally{V.admitting=false;V.admitReply=null;}
      if(V.admitCancelled){await window.WosOrbHandoff.end(meetingLoan,{status:'cancelled'});return;}
    }
    try { if (JSON.parse(DEV()?.recActive?.() || 'null')?.id) { if(meetingLoan)await window.WosOrbHandoff.end(meetingLoan,{status:'cancelled'});restoreReply();toast('🎙', 'An existing native recording is still held', 2200); return 'busy'; } } catch (_) { if(meetingLoan)await window.WosOrbHandoff.end(meetingLoan,{status:'cancelled'});restoreReply();return 'busy'; }
    const field = kind === 'dictation' ? FIELDS.capture() : null;
    if (kind === 'dictation' && !field) { if(meetingLoan)await window.WosOrbHandoff.end(meetingLoan,{status:'cancelled'}); restoreReply();toast('!', 'Focus a text field to dictate'); return; }
    V.field?.release(); V.field = field;
    const captureEpoch = V.captureEpoch = (V.captureEpoch || 0) + 1;
    // An app-feedback take can start before any chat/model picker opened. Warm authoritative options;
    // the exact route is still sealed at Send, and unavailable routes remain fail-closed.
    window.WosModels?.load().catch(() => {});
    clearTimeout(txHideT);
    Object.assign(V, { kind, custodyCapture: null, target: null, replyTo: opt.replyTo || null, resumed: false, snap: null, seal: null, chunks: [], parts: [], acc: 0, nativeSegmentBase:0,resumeNative:false,t0: performance.now(), sim: false, stopAsked: false, sendAsked: false, cancelled: false, an: null, simText: '', files: [], pickPaused: false }); renderVoiceFiles();
    // The take belongs where James was when he STARTED talking (James, 10 Oct 2026: "I started a thread on the chat
    // list, I clicked into a thread while I was recording it, and then I hit send and it replied to that thread").
    // Browsing to another thread mid-take, or after the send tap, never moves the message.
    V.snap = initialSnap;V.meetingLoan=meetingLoan;
    if(meetingLoan && V.snap) {V.snap.meetingEventId=meetingLoan.id;V.snap.conversation=null;V.snap.screen='';V.snap.others=[];if(V.snap.view?.kind==='app')V.snap.view=null;}
    paintVoiceDestination();
    if (V.snap && kind === 'command') V.snap.conversation = null;
    setVoice(kind === 'command' ? 'command' : 'listen');
    shock();
    // No status card while recording: the orb, timer and arc already say it. Hold-for-command keeps
    // its card (it shows where the command will land). First tap ever: a one-time tip, then never again.
    if (kind === 'command') txShow('', 'Command · release to run', 'command', '⚡');
    else if (kind === 'dictation') txHide(0);
    else { txHide(0); if (!store.get('voiceTipSeen', false)) { store.set('voiceTipSeen', true); txPill('✦', 'Listening · tap the orb again to send', 'tip'); txHide(3200); } }
    V.raf = requestAnimationFrame(tick);
    V.native = null;
    const dev = DEV();
    if (dev) { let id = ''; try { id = (meetingLoan?.native ? dev.recStartBorrowed(kind === 'general' ? 'auto' : kind,meetingLoan.id) : dev.recStart(kind === 'general' ? 'auto' : kind)) || ''; if (id && kind === 'dictation') dictationTake(id, true); if (id && V.snap?.conversation) voiceRecovery(id, { kind, conversation: V.snap.conversation }); else if (id && kind !== 'dictation') { const route = V.snap?.route || CHATS.modelRoute(V.replyTo?.wid || V.snap?.view?.id, V.replyTo?.sid || V.snap?.view?.thread || ''); if (route) saveVoiceRoute(id, route); } } catch (e) { if (id && V.snap?.conversation) { try { dev.recCancel(id); } catch (_) {} cancelVoice(true); toast('!', 'Manager destination could not be saved · nothing sent'); return; } }
      if (id && kind === 'dictation' && !dictationTake(id)) { try { dev.recCancel(id); } catch (_) {} cancelVoice(true); toast('!', 'Dictation could not be safely retained'); return; }
      if (id) { V.native = id;if (V.replyTo) replyTake(id, V.replyTo);try{window.WosOrbHandoff?.bind(meetingLoan,id,V.snap);}catch(e){await cancelVoice(true);toast('!','Could not save microphone link · original retained');return;} if (V.snap?.general) { try { voiceRecovery(id, { kind:'general', general:true, conversation:null }); saveVoiceRoute(id,V.snap.route); } catch (_) { V.stopAsked=true;pauseCommandCapture();toast('!','General destination could not be saved · recording kept');return; } } voiceTake(id, kind === 'general' ? 'auto' : kind); reportVoice(V.state); if(V.admitSend){V.admitSend=false;finishVoice();}else if (V.stopAsked) { pauseCommandCapture(); if (V.sendAsked) finishVoice(); } return; }
      if(meetingLoan?.native){await cancelVoice(true);toast('!', 'Native handoff refused · meeting restored');return;}
    } // A refused native loan NEVER falls through to browser capture.
    // The browser may never answer the microphone request (a permission prompt that never resolves): after a few
    // seconds the take ends with a message instead of a recording UI that cannot record.
    const micWatch = setTimeout(() => { if (captureEpoch === V.captureEpoch && !V.cancelled && !V.rec && !V.native && !V.sim && V.state !== 'idle' && V.state !== 'think') micNeverOpened('timeout'); }, MIC_OPEN_TIMEOUT_MS);
    try {
      const opened = await openRec(captureEpoch); clearTimeout(micWatch);
      if (!opened) return;
      if(V.admitSend){V.admitSend=false;finishVoice();}
      if (V.stopAsked && V.sendAsked) finishVoice();
    } catch (err) {
      clearTimeout(micWatch);
      if (captureEpoch !== V.captureEpoch || V.cancelled || V.state === 'idle') return;
      stopStream(); V.rec = null;
      if (err?.code === 'external_mic') { await cancelVoice(true); toast('!', 'Bluetooth has the mic · Wizard uses the phone mic · change in Settings → Microphone', 5000); return; }
      if(meetingLoan || parkedReply){await cancelVoice(true);toast('!', 'Microphone unavailable · original retained');return;}
      if (kind === 'dictation') { cancelVoice(true); toast('!', 'Microphone unavailable · nothing inserted or sent'); return; }
      V.sim = true; NOMIC = true; tourEv('nomic', { kind });
      txShow('', '', '', '✦');
      $('#txRouteText').textContent = kind === 'command' ? 'No mic here · tap a command' : 'No mic here · tap a line to simulate';
      const ex = kind === 'command'
        ? ['Open Movies', 'Zoom out', 'Next desk', 'Directions to the airport']
        : ['Show me yesterday', 'Directions to Iconsiam', 'Play something chill', 'What did we ship on Wizard this week?'];
      $('#txChips').innerHTML = `<span class="lbl">Try</span>` + ex.map(x => `<button data-sim="${esc(x)}">${esc(x)}</button>`).join('');
      if (V.stopAsked) { cancelVoice(true); }
    }
  }
  /* Send and go for the orb and the dictation copy; app-sendgo.js. */
  const { browserBarInset, dropHold, dropWarm, finishDictation, leaveOnSend, MIC_OPEN_TIMEOUT_MS, MIC_WARM_MS, micNeverOpened, openRec, pauseCommandCapture, QUICK_MS, quickTake, recoverDictation, saveVoiceRoute, sealTarget, sendTapRoute, stopStream, transcribeDictation, unseal, warmMic } = window.WizCore.appParts.sendgo({ $, applyLayout, appVars, cancelVoice, CHATS, deskOf, DEV, device, dictationLate, FIELDS, LIVE, nativeFinish, nativeResume, nativeTakeAppOwned, onRecStop, orbLevel, OUTBOX, pauseNativeTake, recDone, returnMeeting, runUtterance, setVoice, toast, tourEv, txHide, txPill, txShow, V, voiceEl });
  modelLate({ sealTarget });
  replyLate({ stopStream });
  function finishVoice() {
    if(parking)return; // sealing the original is not a new Send gesture
    if(V.admitting){V.admitSend=true;return;}
    if (V.state === 'idle' || V.state === 'think') return;
    V.sendAsked = true;
    // A tap on a take whose microphone never opened (iPhone Safari can leave getUserMedia unanswered) ends it visibly
    // instead of silently waiting for a recorder that may never come: the orb must never look frozen. Nothing was
    // recorded, so nothing is kept, sealed or navigated. Checked before the dictation dispatch so a dictation take is
    // covered too (Codex P2 on #569). A held command keeps its release latch; a no-mic sim take is handled below.
    if (!V.sim && !V.rec && !V.native && !V.parts.length && V.kind !== 'command') return micNeverOpened('tap');
    if (V.kind === 'dictation') return finishDictation();
    if (V.kind === 'command') { V.stopAsked = true; pauseCommandCapture(); }
    V.snap = V.snap || sendSnap(); // pinned when the take started; browsing since can't move it
    // A take resumed after a reload with no saved snapshot keeps the model route saved for it (wizard-ux#1218).
    if (V.resumed && V.native && !V.snap.resumed && !V.snap.route) { V.snap.resumed = true; try { V.snap.route = window.WosModels.voiceRoute(V.native); } catch (_) {} }
    if (V.target != null || V.replyTo || V.kind === 'command') V.snap.conversation = null; // only explicit gestures override
    if (V.sim) { if (V.kind === 'command') cancelVoice(true); else toast('✦', 'No mic here · nothing recorded'); return; }
    // Files still uploading (or failed with their bytes here) never hold the send: they ride as placeholders and the
    // outbox finishes them behind the message (James, 19 Oct 2026: "Send the message and process it in the background").
    // Text, photos and voice go as ONE message (legacy H4; James, 10 Oct 2026: "when I paste a link in the text
    // box and I send you a voice note … they should both be sent together"). The composer of the thread this take
    // goes into is taken now, at the tap, and rides with the recording (chats.js takeComposer).
    const sealAt = sealTarget();
    try {
      const pin = sealAt || (V.snap.view?.thread ? { wid: V.snap.view.id, sid: V.snap.view.thread } : null);
      if (!V.snap.conversation) {
        // The destination stays pinned to where the take started, but the model is read at the Send tap: a model
        // picked while recording is the one that answers (wizard-ux#1218). The route from the start of the take is
        // kept only when the selector can't be read right now (catalogue still loading).
        const live = V.snap.resumed && V.snap.route?.model && V.snap.route?.provider ? null : sendTapRoute(V.snap, pin);
        if (live?.model && live?.provider) V.snap.route = live;
        if (!(V.snap.route?.model&&V.snap.route?.provider)) { V.snap.route = null; window.WosModels.load?.(); toast('!', 'Choose a model before sending', 2200); return; }
        if (V.native) saveVoiceRoute(V.native, V.snap.route);
      }
    } catch (e) { toast('!', String(e.message || e), 2200); return; }
    if (sealAt && !V.seal) { const t = CHATS.takeComposer(sealAt.wid, sealAt.sid, sealAt.box); V.seal = t.text || t.files.length || t.reply ? t : null; }
    if (!quickTake(V.kind, V.snap, V.replyTo, V.target, V.acc + (V.state !== 'paused' ? performance.now() - V.t0 : 0))) leaveOnSend(V.snap);
    if (V.native) {
      if (V.state !== 'paused') V.acc += performance.now() - V.t0;
      setVoice('think'); txPill(V.kind === 'command' ? '⚡' : '✦', 'Sending…', V.kind === 'command' ? 'command' : 'agent', 'Transcribing · Wizard Voice Core');
      return nativeFinish(V.native, false);
    }
    if (!V.rec && V.parts.length) { setVoice('think'); txPill(V.kind === 'command' ? '⚡' : '✦', 'Sending…', V.kind === 'command' ? 'command' : 'agent', 'Transcribing · Wizard Voice Core'); onRecStop(); return; }
    if (!V.rec) { V.stopAsked = true; return; }
    if (V.state !== 'paused') V.acc += performance.now() - V.t0;
    setVoice('think'); txPill(V.kind === 'command' ? '⚡' : '✦', 'Sending…', V.kind === 'command' ? 'command' : 'agent', 'Transcribing · Wizard Voice Core');
    try { V.rec.state !== 'inactive' && V.rec.stop(); } catch (e) { onRecStop(); }
  }
  async function cancelVoice(quiet) {
    if(parking){toast('⏸','Saving paused reply · original retained');return;}
    if(V.admitting){V.admitCancelled=true;return;}
    if(V.native&&!V.meetingLoan){try{const linked=window.WosOrbHandoff?.forTake(V.native);if(linked)window.WosOrbHandoff.update(linked.id,{status:'cancelled',endedAt:Date.now()});}catch(e){toast('!','Link storage unavailable · stopping recorder; original kept');}}
    if(V.meetingLoan){
      const loan=V.meetingLoan;V.meetingLoan=null;
      if(V.native){
        const id=V.native;
        // recCancel is asynchronous on Android. Seal/close synchronously under a
        // durable recovery owner, then mark this explicitly cancelled (never queued).
        // Otherwise focus recovery can mistake the still-closing file for a Send.
        let meta;
        try { voiceRecovery(id,{kind:V.kind,ms:V.acc});const dev=DEV();if(dev.fetch&&!dev.fetched(id))await dev.fetch(id);meta=JSON.parse(dev.recStop(id)||'null'); }
        catch { setVoice('paused');V.meetingLoan=loan;toast('!','Could not close recording · original retained');return; }
        if(!meta?.id){setVoice('paused');V.meetingLoan=loan;return;}
        V.native=null;
        await window.WosOrbHandoff.end(loan,{status:'cancelled',voiceTakeId:id});
        try {
          const item=await OUTBOX.capture(nativeBlob(id,meta.bytes),'cancelled-'+id);
          await OUTBOX.transition(item.id,'held','Cancelled meeting interruption · original kept');
          if(item.durable)recDone(id);
        }catch{toast('!','Cancelled original kept on device · recovery available');}
      }
      else {
        const parts=V.parts.slice(),chunks=V.chunks,rec=V.rec;
        if(rec && rec.state!=='inactive')await new Promise(resolve=>{rec.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};rec.onstop=resolve;rec.stop();});
        stopStream();V.rec=null;
        const id=V.custodyCapture||('capture-'+crypto.randomUUID());
        const item=await OUTBOX.capture(new Blob([...parts,...chunks],{type:V.mime||'audio/webm'}),id);
        await OUTBOX.transition(id,'held','Cancelled meeting interruption · original kept');
        if(!item.durable){V.meetingLoan=loan;setVoice('paused');toast('!', 'Save failed · original retained here; keep Wizard open');return;}
        await window.WosOrbHandoff.end(loan,{status:'cancelled',voiceTakeId:id});
        V.custodyCapture=null;V.parts=[];V.chunks=[];
      }
    }
    cancelTakeFiles();
    V.captureEpoch = (V.captureEpoch || 0) + 1;
    V.field?.release(); V.field = null;
    const dictationOp = V.dictationOp; V.dictationOp = null;
    if (dictationOp) { dictationOp.abort.abort(); window.WosCancelled.retainWeb(new Blob(dictationOp.blobs, { type: dictationOp.blobs[0]?.type }), dictationOp.ms).then(kept => { if (kept) recDone(dictationOp.nid); }); }
    V.cancelled = true; if (V.replyTo) { replyTake(null); V.replyTo = null; }
    unseal();
    // A long take cancelled by accident is kept (Settings → Cancelled recordings, James 11 Oct); a quick one is gone.
    // Native takes are kept by the app's recorder on recCancel (0.9.5+); the page keeps the ones it recorded itself.
    const heldMs = voiceElapsed();
    const long = !V.sim && heldMs >= (window.WosCancelled?.KEEP_FROM_MS || 20000);
    const nativeKeeps = !!V.native && typeof DEV()?.cancelledList === 'function';
    if (V.native) { try { if (!nativeTakeAppOwned(V.native)) DEV().recCancel(V.native); } catch (e) {} V.native = null; }
    const rec = V.rec, mime = V.mime || rec?.mimeType || 'audio/webm';
    const captureId = V.custodyCapture; V.custodyCapture = null;
    if (captureId && !long) OUTBOX.remove(captureId);
    const keepWeb = parts => { const b = new Blob(parts, { type: mime }); if (captureId) { OUTBOX.capture(b, captureId).then(async () => { const item = await OUTBOX.transition(captureId, 'held', 'Cancelled recording · original kept'); toast('✕', item.durable ? 'Cancelled · saved in Recordings' : 'Device save failed · recording kept in this tab. Keep Wizard open.', 4000); }); return; } window.WosCancelled?.keepWeb(b, heldMs).then(k => { window.WosCancelled.repaint(); toast(k ? '✕' : '!', k ? 'Cancelled · saved in Settings → Cancelled recordings' : 'Device save failed · recording kept in this tab. Keep Wizard open.', 4000); }); };
    if (long && rec && window.WosCancelled) {
      // Stop the web recorder and keep what it heard (the last chunk arrives with the stop).
      const parts = V.parts.slice(), chunks = V.chunks;
      // Cancellation owns this final chunk locally, not the next take's mutable V.chunks.
      rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      try {
        if (rec.state !== 'inactive') { rec.onstop = () => keepWeb(parts.concat(chunks)); rec.stop(); }
        else keepWeb(parts.concat(chunks));
      } catch (e) { keepWeb(parts.concat(chunks)); }
    } else {
      if (long && !rec && V.parts.length && window.WosCancelled) keepWeb(V.parts.slice());
      try { rec && rec.state !== 'inactive' && (rec.onstop = null, rec.stop()); } catch (e) {}
    }
    stopStream(); V.rec = null; V.sim = false; cancelAnimationFrame(V.raf); orbLevel(0);
    setVoice('idle'); txHide(quiet ? 0 : 0);
    const kept = long && (nativeKeeps || !!rec || !!V.parts.length);
    if (!quiet || kept) { toast('✕', kept ? (nativeKeeps ? 'Cancelled · kept in Settings → Cancelled recordings' : 'Cancelled · keeping recording…') : 'Discarded', kept ? 3200 : 2200); vib(12); }
    restoreReply();
  }
  async function joinVoiceAudio(parts) {
    const ctx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:16000});
    try{
      const buffers=[];for(const part of parts)if(part.size)buffers.push(await ctx.decodeAudioData(await part.arrayBuffer()));
      const samples=buffers.reduce((n,b)=>n+b.length,0),data=new ArrayBuffer(44+samples*2),v=new DataView(data);
      const tag=(off,s)=>{for(let i=0;i<s.length;i++)v.setUint8(off+i,s.charCodeAt(i));};
      tag(0,'RIFF');v.setUint32(4,36+samples*2,true);tag(8,'WAVE');tag(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,ctx.sampleRate,true);v.setUint32(28,ctx.sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);tag(36,'data');v.setUint32(40,samples*2,true);
      let offset=44;for(const b of buffers)for(const sample of b.getChannelData(0)){v.setInt16(offset,Math.max(-32768,Math.min(32767,Math.round(sample*32767))),true);offset+=2;}
      return new Blob([data],{type:'audio/wav'});
    }finally{await ctx.close();}
  }
  async function onRecStop(nblob, nid) {
    // A native take (Android RecorderService) arrives as one blob + its id; a web take is the parts + current chunks.
    const isNative = nblob instanceof Blob; nid = isNative ? nid : '';
    const last = !isNative && V.chunks.length ? new Blob(V.chunks, { type: V.mime || V.rec?.mimeType || 'audio/webm' }) : null;
    const blobs = isNative ? V.parts.concat([nblob]) : V.parts.concat(last && last.size ? [last] : []);
    V.parts = []; V.chunks = [];
    const blob = blobs[0] || new Blob([], { type: V.mime || 'audio/webm' });
    const size = blobs.reduce((n, b) => n + b.size, 0);
    stopStream(); V.rec = null; orbLevel(0);
    if (V.cancelled) { recDone(nid); dropHold(); unseal(); return; }
    if (V.kind === 'dictation') { const id = V.custodyCapture; V.custodyCapture = null; if (id) await OUTBOX.transition(id, 'held', 'Dictation recording · original kept'); if(V.meetingLoan){const held=await OUTBOX.retainDictation(new Blob(blobs,{type:blob.type}),id);if(!held.durable){setVoice('paused');toast('!','Save failed · recording retained here');return;}await returnMeeting({status:'local',voiceTakeId:nid||held.id});} return transcribeDictation(blobs, nid, id).finally(restoreReply); }
    if (!nid && !V.meetingLoan && (V.acc < 450 || size < 1200)) { recDone(nid); dropHold(); unseal(); V.replyTo = null; replyTake(null); setVoice('idle'); txHide(); toast('◌', V.kind === 'command' ? 'Hold, speak, release' : 'Didn’t catch that'); tourEv('nospeech'); restoreReply();return; }
    // A voice reply from a thread's composer goes to that thread, as recorded: no routing, no commands,
    // straight into the durable outbox (which transcribes it and keeps the recording as a voice note).
    const snap = V.snap || window.WosOrbHandoff?.takeSnap(nid) || sendSnap(); V.snap = null;
    snap.seal = V.seal || null; V.seal = null; // the composer read at the send tap (finishVoice)
    const kind = quickTake(V.kind, snap, V.replyTo, V.target, V.acc) ? 'quick' : V.kind, aimAt = V.target;
    // One immutable owner before STT/router awaits, including native handoffs. The native
    // copy is released only after the web copy is durable or a server receipt exists.
    const rt = V.replyTo;
    const sv = snap.view, sid = rt?.sid || (aimAt == null ? sv?.thread || '' : '');
    let audio;
    try{audio = blobs.length>1 ? await joinVoiceAudio(blobs) : new Blob(blobs, { type: blob.type || 'audio/webm' });}
    catch(e){V.parts=blobs;V.snap=snap;V.seal=snap.seal;V.replyTo=rt;setVoice('paused');toast('!','Could not combine audio · originals retained; retry Send');return;}
    if (snap.conversation && kind !== 'command' && !rt && aimAt == null) {
      const captureId = V.custodyCapture; V.custodyCapture = null;
      const files = takeFiles();
      try {
        const item = await OUTBOX.sendConversation({ conversation: snap.conversation, audio, captureId, nativeId: nid, files, source: 'orb' });
        if (item?.durable || item?.state === 'sent') recDone(nid);
        toast(item?.state === 'sent' ? '✦' : '!', item?.state === 'sent' ? 'Sent to ' + snap.conversation.label : item?.error || 'Manager recording kept in Recordings', 5000);
      } finally { dropHold(); setVoice('idle'); txHide(); }
      return;
    }
    const it = await OUTBOX.stage({ ...(snap.route || {}), kind: sid && sid !== '__new__' ? 'reply' : 'new',
      sessionId: sid && sid !== '__new__' ? sid : '',
      steerRunId: snap.meetingEventId ? '' : rt?.steerRunId ?? (CHATS.isWorking(LIVE.session(sid)) ? LIVE.session(sid)?.runId || '' : ''), audio, typed: snap.seal?.text || '', ...(snap.seal?.reply ? { reply: snap.seal.reply } : {}),
      meetingEventId:snap.meetingEventId,sealKey: snap.seal?.key, captureId: V.custodyCapture, nativeId: nid, intent: kind, agent: sv?.agent || snap.route?.agent || '',
      ...(typeof dumpTake === 'function' && dumpTake(snap, rt, aimAt, kind) ? { dump: true } : {}),
      files: [...takeFiles(), ...(snap.seal?.files || [])].filter(f => f?.id),
      instructions: viewContext(sv?.id, 'voice', snap), source: 'orb', wid: rt?.wid || sv?.id || '' });
    V.custodyCapture = null;
    snap.custodyId = it.id; snap.audio = audio;
    if(V.meetingLoan){if(!it.durable){setVoice('paused');toast('!','Save failed · original retained here; meeting remains paused');return;}await returnMeeting({status:'captured',voiceTakeId:nid||it.id,deliveryKey:it.id});}
    snap.seal?.done(it);
    // A tap take with a fixed destination is the outbox's from here: Reload no longer waits for upload + transcription.
    V.handedOff = (!rt && aimAt == null && kind !== 'command' && kind !== 'quick' && !snap.general && !snap.meetingEventId && !V.meetingLoan && !sv?.review && sv?.mode !== 'capture' && await OUTBOX.handOff?.(it.id)) ? it.id : null;
    // Released a moment after this take is handled: by then its outbox item (if any) has replaced the hold.
    const hold = V.hold; V.hold = null;
    const unhold = () => { if (hold) setTimeout(() => LIVE.releaseSend?.(hold), 1500); };
    const releaseNative = () => { const held = OUTBOX.get(snap.custodyId); if (held?.durable || held?.state === 'sent') recDone(nid); };
    if (rt) {
      const files = takeFiles(); V.replyTo = null;
      setVoice('idle'); txPill('✦', 'Voice reply · waiting to send', 'agent'); txHide(1800);
      try { await CHATS.sendVoiceTo(rt.wid, rt.sid, audio, files, snap.seal || false, snap.route, snap.custodyId, null, undefined, '', rt.space); }
      catch (e) { await OUTBOX.transition(snap.custodyId, 'failed', String(e.message || e)); }
      finally { releaseNative(); unhold(); }
      return;
    }
    try {
      // Protect bytes before STT. Failed upload is retryable; it must not delete the staged take.
      await OUTBOX.protect(snap.custodyId);
      const words = []; const j = { ms: 0 };
      const prompt = window.WizConfig.voicePrompt(APPS.map(a => a.name).slice(0, 40));
      // Try the configured endpoint even when WebView's network hint is false.
      // Its bounded failure retains the take; commands never become agent messages.
      for (const part of blobs) {   // more than one part only after the mic was interrupted mid-take
        // A flaky line can hang a request for a long time: past this bound the take goes to the outbox instead.
        const jj = await OUTBOX.bounded(signal => window.WizConfig.transcribe(part, { prompt, language: 'en', signal }), OUTBOX.TRANSCRIBE_TIMEOUT_MS);
        words.push((jj.text || '').trim()); j.ms += jj.ms || 0;
      }
      const text = words.filter(Boolean).join(' ').trim();
      if (!text) {
        // A silent held take is a quick command that never happened (James, 23 Oct 2026): nothing to recover,
        // so it finishes custody instead of piling up in Unsent. A take carrying composer text or files keeps them.
        if ((kind === 'command' || kind === 'quick') && await OUTBOX.completeLocal(snap.custodyId)) {
          releaseNative(); unhold(); setVoice('idle'); txHide(); toast('◌', 'No speech heard · nothing sent'); tourEv('nospeech'); return;
        }
        await OUTBOX.transition(snap.custodyId, 'empty', 'No speech detected · original recording and composer kept together');
        releaseNative(); unhold(); setVoice('idle'); txHide();
        toast('◌', 'No speech detected · recording and text kept in Unsent'); tourEv('nospeech'); return;
      }
      await OUTBOX.keepTranscript(snap.custodyId, text);
      const outcome = await handleText(text, kind, false, j.ms, aimAt, snap);
      // A held take is a command, never a message: once routed, there is nothing left to deliver.
      // Executed, unmatched or declined commands finish custody instead of posing as failed sends.
      const settled = (kind === 'command' || snap.quickRan) && (outcome === false || outcome == null || outcome?.outcome === 'unhandled' || (outcome?.outcome === 'local-pending' && !outcome.done));
      if (settled && OUTBOX.get(snap.custodyId)?.state === 'processing') await OUTBOX.completeLocal(snap.custodyId);
      if (OUTBOX.get(snap.custodyId)?.state === 'processing') {
        const completed = outcome?.outcome === 'local' && await OUTBOX.completeLocal(snap.custodyId);
        if (!completed && OUTBOX.get(snap.custodyId)?.state === 'processing') await OUTBOX.transition(snap.custodyId, 'held', outcome?.outcome === 'held-message'
          ? 'Held take sounded like a message · kept here to send'
          : outcome?.outcome === 'local'
          ? 'Command completed · accompanying draft or attachments kept'
          : outcome?.outcome === 'local-pending' ? 'Command accepted · completion unconfirmed; original recording kept'
          : 'Delivery not confirmed · original recording kept; not queued for retry');
      }
      if (outcome?.done) {
        const id = snap.custodyId;
        outcome.done.then(ok => ok ? OUTBOX.completeLocal(id)
          : OUTBOX.get(id)?.state === 'held' && OUTBOX.transition(id, 'held', 'Music didn’t confirm · recording kept; nothing sent')).catch(() => {});
      }
      releaseNative(); unhold();
    } catch (err) {
      // A held command that can't be heard is dropped with a note, never queued for the agent as a message.
      if (kind === 'command') { await OUTBOX.transition(snap.custodyId, 'held', 'Command not heard · recording kept; nothing sent'); releaseNative(); unhold(); setVoice('idle'); txPill('⚡', 'Command not heard · nothing sent', 'command', String(err?.message || err)); txHide(2400); return; }
      // Never lose a recording: it goes to the outbox, which transcribes and sends it when Wizard is back.
      setVoice('idle');
      const aim = aimAt, sv = snap.view;
      const files = takeFiles();
      const queued = (snap.custodyId ? [snap.audio] : blobs.length ? blobs : [blob]).map((part, i) => {
        const fl = i === 0 ? files : [];   // attached files ride with the first part only
        if (aim == null && sv?.review) return sendReview(sv, '', part, fl, snap.route, snap.custodyId);
        if (aim == null && sv?.kind === 'chat thread' && W[sv.id]) return sendChat(sv.id, '', 'voice, aimed at this thread', part, { custodyId: snap.custodyId, sid: sv.thread, route: snap.route, files: fl, seal: i === 0 ? snap.seal || false : false, ...pinSpace(sv), instructions: viewContext(sv.id, 'voice, aimed at this thread', snap) });
        const sl = i === 0 ? snap.seal : null; // the window is gone: the taken composer still rides with it
        return toAgent('', 'Waiting to send · recording kept', { audio: part, desk: aim, source: 'orb', files: withSealFiles(fl, sl), typed: sl?.text || '', snap })
          .then(item => sl?.done(item));
      });
      await Promise.all(queued.map(q => Promise.resolve(q).catch(e => OUTBOX.transition(snap.custodyId, 'failed', String(e.message || e)))));
      releaseNative(); unhold();
      txPill('↻', 'Waiting to send · recording kept', 'agent', 'Couldn’t reach Wizard · retrying'); txHide(2600);
    } finally { if(kind==='command')restoreReply(); }
  }
  /* The arc buttons around the orb while it records; app-arc.js. */
  window.WizCore.appParts.arc({ $, appVars, cancelVoice, DEV, openRec, pauseNativeTake, replyTake, saveVoiceRoute, setVoice, tick, toast, uploadVoiceFile, V, vib, voicePicker, voiceTake });

  /* Typed or simulated utterance, same pipeline as voice */
  async function runUtterance(text, kind, typed) {
    // Help is a command only on explicit command/typed surfaces, never a tapped voice take.
    if (!window.WosCommands.isMessageTake(kind, typed) && window.WosTour?.isHelp(text) && (kind === 'command' || sendSnap().view?.kind !== 'chat thread')) { setVoice('idle'); txHide(0); return window.WosTour.openHelp(); }
    clearTimeout(txHideT); V.handedOff = null; V.kind = kind || 'auto';
    const snap = sendSnap();
    txShow('', typed ? 'Typed' : 'Heard', kind === 'command' ? 'command' : '', kind === 'command' ? '⚡' : '✦');
    setVoice('think'); shock();
    const el = $('#txText'); let k = 0;
    await new Promise(res => { const step = () => { k += Math.max(1, Math.round(text.length / 18)); el.textContent = text.slice(0, k); if (k < text.length) setTimeout(step, 22); else res(); }; step(); });
    handleText(text, kind, typed, 0, null, snap);
  }
  /* Which view a voice take is for; app-viewvoice.js. */
  const { viewOf } = window.WizCore.appParts.viewvoice({ agentApp, agentWin, appVars, CHATS, frameHref, LIVE, mainChats, winApp, winTitle });
  // Rides as the run's ephemeral system note: the agent knows the view, the thread stays clean.
  /* Where James was at recording start (or at a typed send). Transcription and
   * routing take seconds; by then he may have opened another thread. Everything downstream (which thread,
   * new or reply, the context note) is decided from this snapshot, never from what is in front later. */
  function sendSnap(id) {
    const d = desks[idx], fid = id || d.focus;
    const view = viewOf(fid); if (view) view.appId = W[fid]?.appId;
    // The words on screen at that moment, so "this step" or "that button" resolves. A chat thread's text is
    // already the conversation, so it is not repeated.
    const screen = view && view.kind !== 'chat thread' && !view.private ? (window.WizScreen?.read(winEl(fid)) || '') : '';
    // A private agent's window is named, never read: its thread titles stay with that agent.
    const nameOf = x => agentWin(W[x]) && agentApp(W[x]).private ? `${agentApp(W[x]).name} chats (private agent)`
      : W[x]?.app === 'chats' && W[x].thread && LIVE?.isPrivate?.(W[x].thread) ? 'A private agent’s thread' : winTitle(W[x]);
    const capability = window.WizAppServices?.voiceInput;
    const app = APP[W[fid]?.appId];
    const conversation = CHATS.isHosted(fid) ? null : capability ? capability.pin(winEl(fid)?.querySelector('iframe'), app?.id)
      : app?.receives_voice_input === true ? { appId: app.id, token: 'unavailable', label: app.name } : null;
    return { id: fid, desk: idx, view, screen, conversation, others: d.wins.filter(x => x !== fid).map(nameOf) };
  }
  /* Where a take goes: review mode, the view in front, commands and new requests; app-routing.js. */
  const { dumpTake, execute, generalTarget, handleText, localParse, NOMATCH_MS, orbWrap, pinSpace, sendReview, snapAgentName, toAgent, viewContext, voiceDestination } = window.WizCore.appParts.routing({ $, APP, appAt, appByName, APPS, appVars, CHATS, clearDesk, clip, closeSheets, closeWin, device, esc, findApp, finishVoice, focusWin, goDesk, HOME, hostedOpenable, isPill, LIVE, loadThread, mainChats, moveWin, openApp, openSearch, openSettings, openSheet, OUTBOX, quickSearch, refreshHome, renderDots, renderMoons, searchUrl, sendChat, sendSnap, setFull, setVoice, startVoice, takeFiles, toast, tourEv, tx, txHide, txPill, txShow, V, vib, winEl, withSealFiles });
  modelLate({ viewContext });
  function generalVoiceSnap() {
    // An explicit general take contains no private/app screen, composer or thread context.
    const w = W[desks[idx].focus];
    const route = w?.app === 'chats' ? CHATS.modelRoute(w.id, '__new__') : CHATS.modelRoute();
    return { id: null, desk: idx, view: null, screen: '', conversation: null, others: [], general: true, route, newChatWid: w?.app === 'chats' ? w.id : null };
  }
  function paintVoiceDestination() {
    const label = V.snap?.conversation?.label;
    const active = ['listen', 'command', 'paused'].includes(V.state) && V.kind !== 'dictation';
    voiceDestination.hidden = !active || V.state === 'command';
    voiceDestination.classList.toggle('app-voice', !!label);
    device.classList.toggle('app-voice-input', active && !!label);
    voiceDestination.textContent = label ? 'To: ' + label + ' · tap to send'
      : V.snap?.general ? 'Talking to ' + snapAgentName(V.snap) + ' · tap to send'
      : V.kind === 'command' ? 'Command · release to run · slide up for ' + window.WizConfig.agent() : 'Listening · tap to send';
    if (active) $('#orbWrap').setAttribute('aria-label', voiceDestination.textContent);
    generalTarget.hidden = V.state !== 'command';
    generalTarget.classList.toggle('hold-target', V.state === 'command');
    generalTarget.textContent = V.state === 'command' ? '↑ ' + window.WizConfig.agent() + ' · release to keep talking' : 'Record for ' + window.WizConfig.agent();
    generalTarget.setAttribute('aria-label', generalTarget.textContent);
  }
  paintVoiceDestination();
  window.addEventListener('wizard:config', paintVoiceDestination);
  // The 3-second rule, visible while talking: "Quick command" until QUICK_MS, then the agent's name.
  let quickShown = null;
  function paintQuickWindow(ms) {
    if (!window.WosOrbSwitcher?.active() && !quickShown) return; // OFF: no extra voice DOM work
    const on = V.state === 'listen' && quickTake(V.kind, V.snap || {}, V.replyTo, V.target, 0);
    const q = on ? (ms < QUICK_MS ? 'cmd' : 'agent') : null;
    const was = quickShown; quickShown = q;
    voiceDestination.classList.toggle('quick', q === 'cmd');
    if (!q) { if (was) paintVoiceDestination(); return; }
    const agent = window.WizConfig.agent();
    const want = q === 'cmd' ? '⚡ Quick command · keep talking for ' + agent : 'To ' + (V.snap?.view?.channel ? (window.WizCore?.channelFace?.(V.snap.view.channel, V.snap.view.channel === 'General')?.title || '# ' + V.snap.view.channel) : V.snap?.view?.kind === 'chat thread' ? 'this thread' : agent) + ' · tap to send';
    if (voiceDestination.textContent !== want) voiceDestination.textContent = want;
  }
  let G = null;
  function mayHoldCommand() {
    if (sheet) return false;
    const focused = FIELDS.refresh(), capture = window.WizAppCapture?.getState?.();
    // A deliberate hold during a meeting is a command even when notes retain
    // focus. Tap still dictates; startVoice retains the microphone loan checks.
    return !focused || !!(capture?.recording && capture?.meetingId);
  }
  // The dock orb's level, also handed to a layout drawing its own orb (Two orbs' agent orb).
  function orbLevel(v) { Orb.setLevel(v); window.WosSkinHost?.level?.(v); window.WosOrbSwitcher?.level(v); }
  /* Swipes and holds on the orb, and the Orb switcher; app-orbswipe.js. */
  const { orbTapBusy, shock, bindLate: orbswipeLate } = window.WizCore.appParts.orbswipe({ $, APP, APPS, appVars, atPickerEnd, barScrubDrop, barScrubJoin, cancelVoice, CHATS, clip, closeMenu, closeOverview, closeSheets, deskName, deskSigil, device, dropWarm, execute, FIELDS, finishVoice, generalTarget, generalVoiceSnap, goDesk, HOME, inboxEl, launcher, liftSettings, mayHoldCommand, MIC_WARM_MS, openApp, openOverview, openSheet, orbUpDesks, orbWrap, parkDesks, pauseCommandCapture, pillOvOpen, placeTrack, renderLauncher, saveVoiceRoute, secOf, setVoice, setZen, showChats, startOrbVoice, startVoice, store, swipeDesk, toast, tourEv, track, txHide, V, vib, voiceDestination, voiceRecovery, warmMic, winApp, winEl });
  replyLate({ shock });

  /* ---------------- Back never leaves WizardOS ----------------
   * Android Back is an in-app back gesture, one step at a time:
   *   recording → menu → sheet → the focused window's own back (thread → list,
   *   framed app history, review dive) → full screen → Home desk.
   * At Home every Back is consumed, including repeated presses. Two mechanisms:
   *   1. CloseWatcher (Chrome 120+) consumes Back, re-armed after every press,
   *      in this document and in every same-origin framed app;
   *   2. a history guard entry pushed during a user gesture; popstate → one step. */
  let guardOn = history.state?.wos === 'guard', ignorePop = 0;
  /* The phone Back step and its watchers; app-back.js. */
  const { armBack, armFrameBack, backStep, ensureGuard, onBack, ownedSwipe, phoneBack, rearmFrames, watchers } = window.WizCore.appParts.back({ $, $$, agentWin, appVars, CHATS, closeMenu, closeOverview, closeReviewCoach, closeSheets, closeWin, deskOf, frameNav, goDesk, HOME, openSettings, pauseCommandCapture, save, selfPop, setFull, setZen, toast, txHide, V, winEl });
  modelLate({ armBack });
  overviewLate({ armBack });
  linkdeskLate({ armBack });
  cardsLate({ armBack, armFrameBack, backStep, ensureGuard, onBack });
  orbswipeLate({ armBack });
  /* The Apps tile's Favorites panel and hold-for-nine switcher (wizard-ux#1955, on for everyone); app-appspanel.js. */
  const { appsPanelHold, appsPanelHoldEnd, appsPanelHoldMove, appsPanelOn, appsPanelOpen, appsPanelToggled, appsStep, appsStepping } = window.WizCore.appParts.appspanel({ $, APP, APPS, appVars, CHATS_APP, device, esc, ico, LIVE, norm, openApp, openStoreKind, phoneBack, store, tapOpen, toast, vib });
  /* The four sections around the orb (wizard-ux#1929, on for everyone); app-sections.js. */
  const { sectionsArrange, sectionsPaint, sectionsPinHtml, sectionsStops, sectionsSwipe } = window.WizCore.appParts.sections({ $, APP, APPS, appVars, appsPanelHold, appsPanelHoldEnd, appsPanelHoldMove, appsPanelOn, appsPanelOpen, appsPanelToggled, appsStep, appsStepping, CHATS_APP, closeSheets, closeWin, esc, goDesk, HOME, launcher, LIVE, mainChats, openApp, openSheet, renderDots, renderLauncher, save, store, syncDesks, toast, vib, winApp });
  pinSheetHtml = sectionsPinHtml; swipeBySection = sectionsSwipe;
  desksLate({ sectionsArrange, sectionsPaint });
  /* The Chats tile's view switcher (wizard-ux#1957, on for everyone); app-chatsswitch.js. */
  const { chatsStepper } = window.WizCore.appParts.chatsswitch({ $, appVars, CHATS, CHATS_APP, device, esc, mainChats, phoneBack, vib });
  scrubLate({ appsStep, appsStepping, chatsStepper, sectionsStops });
  sectionsPaint();
  var dropUntil = 0; // retained for hosted-frame programmatic-pop accounting
  /* The Back guard, first run, the native shell bridge and deep links; app-boot.js. */
  window.WizCore.appParts.boot({ $, APP, APPS, appVars, armBack, backStep, blank, browserBarInset, buildDesks, cancelVoice, ch, CH, CHATS, chatsBack, closeAppPlayback, closeDesk, closeMenu, closeOverview, closePeek, closeSheets, closeWin, deskOf, device, ensureGuard, execute, FIELDS, findApp, finishVoice, focusWin, fromOf, goDesk, handleText, HOME, LIVE, localParse, mainChats, markVisibleThreadsSeen, MAXW, mergeDesks, mountLinks, moveWin, nativeFinish, nativeResume, NOMATCH_MS, onBack, onUnsentChange, openAgentChats, openApp, openChat, openChatsList, openLinkDesk, openOverview, openPeek, openSearch, openSettings, openSheet, openWin, openWizardThread, orbWrap, OUTBOX, ownedSwipe, pinWin, placeApp, placeTrack, posOf, QUICK_MS, quickTake, rearmFrames, recDone, recoverDictation, recoverParkedReply, refreshCompose, refreshHome, renderChats, renderDesk, renderDots, renderSettings, reorderDesks, runUtterance, save, sendChat, sendSnap, setFull, setVoice, setZen, shock, sideButtonTap, splitDesk, startVoice, store, syncDesks, toAgent, toast, track, tx, txHide, txShow, unsentAll, V, vib, viewContext, viewOf, watchers, winApp, winEl });
  /* Skin packages (core/skin-host.js): the only shell surface a skin script can drive. Each call goes through
   * the shell's own functions, so the Back contract and desk rules hold for every skin. */
  function agentInfo(a) {
    const AG = window.WosAgents;
    // The main agent goes by the owner's name for it (Archimedes), not its harness label.
    const label = a.is_default ? (window.WizConfig?.agent() || a.label || a.id) : (a.label || a.id);
    return { id: a.id, label, colour: AG ? AG.colour(a) : '#b99bff', private: a.privacy === 'private', main: !!a.is_default, status: a.status || '' };
  }
  /* Who the agent orb talks to, and the app window in front; app-agentorb.js. */
  window.WizCore.appParts.agentorb({ $, agentInfo, APP, appAt, APPS, appVars, backStep, cancelVoice, CHATS, CHATS_APP, closeDesk, closeWin, deskOf, device, esc, FIELDS, framePage, goDesk, HOME, ico, LIVE, mainChats, openAgentChats, openApp, openChatsFiltered, openChatsList, openSettings, openWin, openWizardThread, orbTapBusy, orbWrap, overviewAdapter, phoneBack, secOf, showChats, startVoice, syncImmersive, toast, track, V, winApp, windowRefreshAdapter });
})();
