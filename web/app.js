/* WizardOS — home shell prototype */
(async () => {
  'use strict';
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
  function migrateFive() {
    const oW = store.get('wins', null), oD = store.get('desks3', null);
    if (!oW || typeof oW !== 'object' || !Array.isArray(oD)) return false;
    W = {}; desks = [blank({ id: 'home', home: true })];
    const hasChats = d => d.wins.some(id => oW[id]?.app === 'chats');
    const order = oD.map((d, i) => ({ d, i })).filter(x => x.d && Array.isArray(x.d.wins) && x.d.wins.some(id => oW[id]));
    order.sort((x, y) => (hasChats(y.d) - hasChats(x.d)) || x.i - y.i); // Chats right of Home, the rest in their old order
    for (const { d } of order) {
      const wins = d.wins.filter(id => oW[id]).slice(0, MAXW); wins.forEach(id => { W[id] = JSON.parse(JSON.stringify(oW[id])); });
      desks.push(blank({ wins, focus: wins.includes(d.focus) ? d.focus : wins[wins.length - 1], full: !!d.full }));
    }
    return true;
  }
  // A fresh layout must not persist auto-open desks from compatibility defaults or a stale cache: the shell
  // may paint before synced preferences arrive (waitForShell), so seed only once the first load has settled.
  const launcherSettled = () => window.WizLauncher?.settled !== false;
  // Starter apps are a brand-new device's first look, never the owner's open apps (James, 6 Nov 2026: "things keep
  // popping open, particularly the Topics app"). They are marked `seed` (device-only: workspace sync never sends them),
  // seed only into the layout this boot created, and never on a device that has already joined the shared workspaces.
  let freshBoot = false;
  const joinedWorkspaces = () => !!store.get('wsync.v2.phone', null)?.base;
  function seedApps() {
    if (!freshBoot || joinedWorkspaces()) return;
    for (const appId of (window.WizLauncher?.get('autoOpen') || [])) if (APP[appId] && !Object.values(W).some(w => w.app === 'frame' && w.appId === appId)) { const id = newId(); W[id] = { id, app: 'frame', appId, seed: true }; desks.push(blank({ wins: [id], focus: id })); }
  }
  function freshLayout() {
    W = {}; desks = [blank({ id: 'home', home: true })]; freshBoot = true;
    const c = { id: newId(), app: 'chats', thread: null }; W[c.id] = c; desks.push(blank({ wins: [c.id], focus: c.id }));
    if (launcherSettled()) seedApps();
  }
  const okStrip = () => W && typeof W === 'object' && Array.isArray(desks) && desks.length > 0 && desks[0] && desks[0].home && desks.every(d => d && d.id && Array.isArray(d.wins));
  if (!okStrip()) { if (migrateFive()) store.set('stripSeeded', true); else { freshLayout(); store.set('stripSeeded', launcherSettled() && !!window.WizLauncher?.get('autoOpen').some(id => APP[id])); } }
  window.WosFeatures.pruneWindows(W);
  desks = window.WizCore.migrateChatsFocus(W, desks);
  /* Upgrade: starter windows the previous shell opened carry no `seed` mark. Until this device first joins the shared
   * workspaces nothing it holds has reached the box, so its auto-open apps are still starter apps: mark them, and the
   * first join drops them instead of pushing them to every device. A joined device's windows already synced as before. */
  function markLegacyStarters(wins, autoOpen, joined) {
    if (joined) return 0;
    const auto = new Set(autoOpen || []); let n = 0;
    for (const w of Object.values(wins || {})) if (w && w.app === 'frame' && auto.has(w.appId) && !w.seed) { w.seed = true; n++; }
    return n;
  }
  markLegacyStarters(W, window.WizLauncher?.get('autoOpen'), joinedWorkspaces());
  // Recorder (formerly Mizel.ai) moved from the old Meetings view (/meetings/, /mizel-preview/) to the canonical Mizel Live view.
  // A frame window remembers the page it was on, so a saved Mizel desk would keep the retired view: move it.
  Object.values(W).forEach(w => { if (w && w.app === 'frame' && w.appId === 'mizel' && /^\/(meetings|mizel-preview|apps)(\/|$)|^\/$/.test(w.url || '')) delete w.url; });
  // Apps from the Agent Service can arrive after first paint (fresh install, cleared cache): a frame window
  // painted before its app was known has no page yet, so draw that desk again once the app list lands.
  const reframe = () => {
    for (const w of Object.values(W)) if (APP[w.app]?.kind === 'wizard' && APP[w.app]?.url) { w.appId = w.app; w.app = 'frame'; winEl(w.id)?.remove(); }
    desks.forEach((d, i) => { if (d.wins.some(id => { const w = W[id], u = w?.app === 'frame' && !w.url && APP[w.appId]?.url;
      if (!u) return false; const f = document.querySelector(`.win[data-win="${id}"] iframe`); if (f && f.getAttribute('src') === u) return false;
      winEl(id)?.remove(); return true; })) { try { renderDesk(i); } catch (e) {} } });
  };
  const lateLayout = () => {
    if (!launcherSettled() || store.get('stripSeeded', false) || !window.WizLauncher?.get('autoOpen').some(id => APP[id])) return;
    seedApps(); store.set('stripSeeded', true); try { save(); syncDesks(); } catch (e) {}
  };
  window.addEventListener('wizard:apps', () => { lateLayout(); reframe(); });
  window.WizLauncher?.ready?.then?.(() => lateLayout());
  setTimeout(reframe, 0); setTimeout(reframe, 1500);
  desks.forEach(d => {
    d.wins = d.wins.filter(id => W[id]).slice(0, MAXW);
    if (!d.wins.includes(d.focus)) d.focus = d.wins[d.wins.length - 1] || null;
    if (!d.wins.length) d.full = false;
  });
  if (desks[0].wins.length) { const d = blank({ wins: desks[0].wins, focus: desks[0].focus }); desks[0] = blank({ id: 'home', home: true }); desks.splice(1, 0, d); }
  desks = desks.filter((d, i) => i === 0 || d.wins.length);
  Object.keys(W).forEach(id => { if (!desks.some(d => d.wins.includes(id))) delete W[id]; });
  // Reopen exactly where he left off: remember the desk itself, not its position (empty desks are pruned on
  // load, which used to shift the saved position onto the next desk to the right).
  let idx = (() => { const id = store.get('idxDesk', ''), at = id ? desks.findIndex(d => d.id === id) : -1; return at >= 0 ? at : store.get('idx4', HOME); })();
  if (!(idx >= 0 && idx < desks.length)) idx = HOME;
  const save = () => { store.set('wins4', W); store.set('strip', desks); store.set('idx4', idx); store.set('idxDesk', desks[idx]?.id || ''); window.WosWorkspaceSync?.current?.changed(); };

  /* Live Wizard state: inbox, unread, working come from the real Wizard backend. */
  // Thread emojis are Wizard's own (same-origin storage), read fresh each render.
  let EMO = {}, emoAt = 0;
  const emoOf = id => { if (Date.now() - emoAt > 2000) { try { EMO = JSON.parse(localStorage.getItem('wizard.thread-emojis.v1') || '{}'); } catch (e) {} emoAt = Date.now(); } return EMO[`direct:${id}`] || window.WizBrand.html; };
  const live = () => (LIVE && LIVE.ok ? LIVE.groups() : { needs: [], ready: [], working: [] });
  const ago = window.WizCore.ago;

  /* ---------------- window model ---------------- */
  const track = $('#track');
  /* ---------------- Chats ----------------
   * The Chats client (list, thread, composer, attachments, voice notes, unsent bubbles) is shared with
   * the desktop shell: web/core/chats.js. The phone hands it windows on desks. */
  /* Generic window-refresh adapter: a layout+navigation package may ask for ↻ beside ✕ in every window bar (same
   * in-place refresh as desktop ⌥R) and opt Chats out of pull-to-refresh. Nothing changes while no package holds it. */
  const refreshModes = [];
  const RELOAD_BTN = '<button class="wb" data-wact="reload" aria-label="Refresh"><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg></button>';
  function syncReloadButtons() {
    const on = refreshModes.length > 0;
    for (const bar of track.querySelectorAll('.win > .wbar')) {
      const b = bar.querySelector(':scope > [data-wact="reload"]');
      if (on && !b) bar.querySelector(':scope > [data-wact="full"]')?.insertAdjacentHTML('beforebegin', RELOAD_BTN); else if (!on && b) b.remove();
    }
  }
  const windowRefreshAdapter = { use(options) {
    const mode = Object.freeze({ ...options }); refreshModes.push(mode); syncReloadButtons();
    let released = false;
    return () => { if (released) return; released = true; const at = refreshModes.indexOf(mode); if (at >= 0) refreshModes.splice(at, 1); syncReloadButtons(); };
  } };
  const CHATS = window.WizChatsHost.create({
    win: id => W[id],
    pullRefresh: () => !refreshModes.some(m => m.pull === false),
    root: () => track,
    save: () => save(),
    layout: id => applyLayout(deskOf(id)),
    toast: (...a) => toast(...a),
    title: w => winTitle(w),
    viewContext: (id, how) => viewContext(id, how),
    visible: () => desks[idx].wins,
    front: () => desks[idx].focus,
    editUnsent: it => editUnsent(it),
    recoverUnsent: id => { openSettings('unsent'); window.WosSettings.focusUnsent(id); },
    openUnsent: () => openSettings(true),
    newChatHint: 'Type below, or tap the orb and talk.',
    // The composer's mic (#13): the orb's own recorder, pinned to this thread.
    recordReply: (wid, sid) => recordReply(wid, sid),
    dictationField: () => FIELDS && V.kind === 'dictation' && V.state !== 'idle' ? V.field?.el : null,
    captureBusy: () => V.state !== 'idle' || !!V.admitting || !!window.WizAppCapture?.getState?.()?.active,
    recordingFor: () => (V.replyTo && (V.state === 'listen' || V.state === 'paused') ? V.replyTo.sid : ''),
    // The thread a recording take will go into (its composer rides along); Send in that composer finishes the take.
    voiceInto: () => (V.state === 'listen' || V.state === 'paused' ? sealTarget()?.sid || '' : ''),
    finishVoice: () => finishVoice(),
    // A private-origin link in a message opens in a window on this desk: the shell never navigates away.
    openLink: (url, title) => openLinkDesk(url, null),
    // An installed app opened from a Chats row/card remembers this window, so Back (or the app's own done/dismiss) lands here.
    openApp: (id, srcEl) => { const a = hostedOpenable(id); if (!a) return false; const srcId = srcEl?.closest?.('.win')?.dataset.win; const go = () => openApp(a, {}, srcId && W[srcId] ? { from: fromOf(srcId) } : {}); return window.WosSkinHost?.routeOpen?.('app', { id, path: '' }, go) ? true : go(); },
    overlay: open => { if (open) { closeMenu(); armBack(); } },
    vib: ms => vib(ms),
    threadShown: (wid, el) => threadShown(wid, el),
    openThread: (sid, options) => openWizardThread(sid, options),
  });
  const { CH, ch, renderChats, renderChatList, renderThread, loadThread, openChat, chatsBack, sendChat, refreshCompose, toggleVoice, markVisibleThreadsSeen, MIC_SVG } = CHATS;
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
  function winTitle(w) {
    if (!w) return '';
    if (w.app === 'chats' && !w.thread) { const title = CHATS.listTitle?.(w); if (title) return title; }
    if (agentWin(w) && !w.thread) return `${agentApp(w).name} · Chats`;
    if (w.app === 'chats') return w.thread === '__new__' ? 'New chat' : w.thread ? (LIVE?.session(w.thread)?.title || OUTBOX?.forThread(w.thread)[0]?.title || 'Thread') : 'Chats';
    return winApp(w).name;
  }
  function deskTitle(i) {
    const d = desks[i]; if (!d.wins.length) return i === HOME ? 'Home' : 'Empty';
    const f = W[d.focus] || W[d.wins[0]];
    return d.wins.length > 1 ? `${winTitle(f)} +${d.wins.length - 1}` : winTitle(f);
  }
  // Short name for the bottom label and scrubber: the app ("Chats"), never a long thread title.
  function deskName(i) {
    const d = desks[i]; if (!d.wins.length) return i === HOME ? 'Home' : 'Empty';
    const f = W[d.focus] || W[d.wins[0]], n = f.app === 'frame' || f.app === 'chats' ? winApp(f).name : winTitle(f);
    return d.wins.length > 1 ? `${n} +${d.wins.length - 1}` : n;
  }
  const deskOf = id => desks.findIndex(d => d.wins.includes(id));
  const winEl = id => track.querySelector(`.win[data-win="${id}"]`);
  const focusedWin = () => W[desks[idx].focus] || null;

  function winBody(w) {
    switch (w.app) {
      case 'chats': return `<div class="chats" data-chats="${w.id}"></div>`;
      case 'pages': return '<div class="pg-host"></div>';
      case 'feature': return '<div class="shared-feature"></div>';
      case 'frame': return renderFrame(w);
      default: return renderApp(w);
    }
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
  function secOf(i) { const d = desks[i]; return d ? track.querySelector(`.desk[data-did="${d.id}"]`) : null; }
  function isReviewDesk(i) { const d = desks[i]; return !!(d && d.wins.some(id => W[id]?.from?.sid)); }
  function deskShell(i) {
    const d = desks[i];
    return `<section class="desk${d.home ? ' home-desk' : ''}" data-did="${d.id}" data-desk="${i}" style="order:${i}" aria-label="${esc(deskTitle(i))}"><div class="glance">${d.home ? renderHome() : renderEmpty(i)}</div><div class="tiles" data-n="0"></div></section>`;
  }
  function syncDesks() {
    const ids = new Set(desks.map(d => d.id));
    $$('.desk', track).forEach(sec => { if (!ids.has(sec.dataset.did)) sec.remove(); });
    desks.forEach((d, i) => {
      let sec = secOf(i);
      if (!sec) { track.insertAdjacentHTML('beforeend', deskShell(i)); sec = secOf(i); renderDesk(i); }
      sec.style.order = String(i); sec.dataset.desk = String(i);
      sec.classList.toggle('review-desk', isReviewDesk(i));
    });
    placeTrack(0, false); renderDots(); parkDesks(false);
  }
  function buildDesks() {
    track.innerHTML = desks.map((_, i) => deskShell(i)).join('');
    desks.forEach((_, i) => renderDesk(i));
    placeTrack(0, false); renderDots(); renderMoons(); parkDesks(true);
  }
  /* Sync one desk's DOM with its window list without reloading live windows. */
  function renderDesk(i) {
    const sec = secOf(i); if (!sec) return;
    const d = desks[i], tiles = $('.tiles', sec);
    $$('.win', tiles).forEach(el => { if (!d.wins.includes(el.dataset.win)) el.remove(); });
    d.wins.forEach(id => {
      let el = winEl(id);
      if (!el) { el = makeWin(W[id]); tiles.appendChild(el); mountWin(W[id], el); }
      else if (el.parentElement !== tiles) tiles.appendChild(el);
    });
    if (!d.wins.length) { if (d.home) paintHome($('.glance', sec), renderHome()); else $('.glance', sec).innerHTML = renderEmpty(i); }
    sec.classList.toggle('review-desk', isReviewDesk(i));
    applyLayout(i);
  }
  function applyLayout(i) {
    const d = desks[i], sec = secOf(i); if (!sec) return;
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
      const t = $('.wt', el); if (t && W[id].app !== 'chats') t.textContent = winTitle(W[id]);
    });
    sec.setAttribute('aria-label', deskTitle(i));
    if (i === idx) { syncImmersive(); syncReviewChip(); }
  }
  function refreshWin(id) {
    const w = W[id], el = winEl(id); if (!w || !el) return;
    if (w.app === 'chats') renderChats(w);
    else if (w.app !== 'frame') $('.wbody', el).innerHTML = winBody(w);
    applyLayout(deskOf(id));
  }
  function placeTrack(dx, anim) {
    track.classList.toggle('anim', !!anim);
    track.style.transform = `translate3d(calc(${-idx * 100}% + ${dx}px),0,0)`;
    if (stDesk) rideSettings(dx, anim); // Settings stays on its desk and slides with it (James, 21 Oct 2026)
    $('.nebula').style.transform = `translate3d(${(-idx + 2) * -3 + dx * .01}%,0,0)`;
    window.WosScenery?.still('stars'); // scenery hook: star parallax follows the desk (one still frame; core/scenery.js)
  }
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
  function swipeDesk(step) {
    const from = desks[idx]?.id;
    // The ＋ is the next destination after the last occupied desk, for swipes as well as taps.
    if (step > 0 && idx === desks.length - 1) newDesk(); else goDesk(idx + step);
    // Only a swipe can be the iPhone's swipe home in disguise (undoLastMove below).
    if (desks[idx]?.id !== from) lastMove = { from, at: Date.now() };
  }
  /* iPhone: a quick swipe home along the bottom edge also reaches the dock and flips a desk just as the app
   * goes away, so it reopens one desk over. A desk SWIPE in the last moment before the page is hidden was
   * that swipe, not a choice: put the desk back. Opening an app is never undone: its file picker or camera
   * hides the page too, and that put James back on Chats mid-message (James, 26 Oct 2026). */
  let lastMove = null;
  const undoLastMove = () => {
    if (!lastMove || Date.now() - lastMove.at > 1500) return;
    const back = desks.findIndex(d => d.id === lastMove.from); lastMove = null;
    if (back >= 0 && back !== idx) { idx = back; placeTrack(0, false); renderDots(); save(); }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) undoLastMove(); });
  addEventListener('pagehide', undoLastMove);
  function atPickerEnd() { const d = desks[idx]; return idx === desks.length - 1 && !d.home && !d.wins.length; }
  function goDesk(n, silent, keepSettings = false) {
    n = Math.max(0, Math.min(desks.length - 1, n));
    // An empty desk (one the ＋ made, left without picking an app) goes away as soon as you leave it.
    const from = desks[idx], to = desks[n];
    if (from !== to && !CHATS.beforeNavigate(to?.wins || [])) { placeTrack(0, true); return; }
    if (from && to && from !== to && !from.home && !from.wins.length) { desks = desks.filter(d => d !== from); syncDesks(); n = desks.indexOf(to); }
    const moved = from !== to;
    if (moved && sheet === 'settings' && !keepSettings) liftSettings(from && from.id); // explicit navigation parks Settings on the desk you leave
    idx = n;
    if (moved) lastMove = null; // a tap, link or app open is a choice; swipeDesk re-marks swipes
    if (moved) window.WosResources?.back();
    // A Home card's chip is a quick look: leaving the Chats desk puts it back to all chats. Chips James picks stay.
    if (moved) for (const id in W) { const c = CHATS.CH[id]; if (W[id].app === 'chats' && c?.fromCard && !desks[n].wins.includes(id)) { c.fromCard = false; c.coach = false; CHATS.setFilter(W[id], ''); } }
    placeTrack(0, true); renderDots(); save(); scheduleParking(); syncImmersive(); syncReviewChip(); syncBound();
    window.WosScenery?.[idx === HOME ? 'poke' : 'update'](); // scenery hook: Home animates, any other desk freezes it
    window.WosSetupLaunch?.desk(idx === HOME); // a first-run tour held back for Setup starts on the first return Home
    if (moved && LINKS && LINKS.isOpen()) LINKS.close(); // a link is a peek over this desk: moving desks dismisses it
    if (moved) vib(8);
    // An empty New desk already titles itself and its search pill sits where the label would flash.
    if (!silent && (desks[idx].home || desks[idx].wins.length)) announce(`<b>${esc(deskName(idx))}</b>`);
    markVisibleThreadsSeen();
    window.WosResources?.sync();
    window.WosSkinHost?.changed();
  }
  function announce(html) {
    const L = $('#deskLabel'); L.innerHTML = html; L.classList.add('show'); document.body.classList.add('labeling');
    clearTimeout(labelT); labelT = setTimeout(() => { L.classList.remove('show'); document.body.classList.remove('labeling'); }, 1300);
  }
  // Any number of desks: up to three each side (Home always shows at the far left), a faint tick for more.
  // Desk sigils (James, 12 Oct 2026): each neighbour shows the glyph of the app it holds, bare (no tile), in
  // that app's colour; Home is a house; an empty desk is a faint ring; a desk with several windows carries a
  // small count. The current desk is the orb. Each is a thumb-sized button, so one tap jumps there.
  const deskSigil = i => window.WizCore.workspaceNav.icon(desks[i], W, winApp);
  /* The current desk's app icon, kept inside the orb (#orbApp, hidden). Skins may show it so the orb reads as sitting
   * on top of the app in view; nothing changes unless a skin unhides it. */
  let orbAppHtml = null;
  function paintOrbApp() {
    const wrap = $('#orbWrap'); if (!wrap || !desks[idx]) return;
    let el = document.getElementById('orbApp');
    if (!el) { el = document.createElement('span'); el.id = 'orbApp'; el.className = 'orb-app'; el.hidden = true; el.setAttribute('aria-hidden', 'true'); wrap.appendChild(el); }
    const h = deskSigil(idx); if (h !== orbAppHtml) { orbAppHtml = h; el.innerHTML = h; window.WizSigil.orb(el); }
  }
  function renderDots() {
    window.WosBell?.paint?.();
    if (typeof paintOrbBadge === 'function') try { paintOrbBadge(); } catch (_) {}
    paintOrbApp();
    const mk = i => `<button class="ddot sig${desks[i].wins.length ? ' filled' : ''}${desks[i].home ? ' dhome' : ''}${isReviewDesk(i) ? ' review' : ''}" data-goto="${i}" aria-label="${esc(deskName(i))}">${deskSigil(i)}</button>`;
    $('#dotsL').className = 'desk-dots left'; $('#dotsR').className = 'desk-dots right';
    const L = []; for (let i = Math.max(0, idx - 3); i < idx; i++) L.push(i);
    const R = []; for (let i = idx + 1; i <= Math.min(desks.length - 1, idx + 3); i++) R.push(i);
    const homeExtra = L.length && L[0] > 0;
    $('#dotsL').innerHTML = (homeExtra ? mk(0) + (L[0] > 1 ? '<i class="dmore"></i>' : '') : '') + L.map(mk).join('');
    $('#dotsR').innerHTML = R.map(mk).join('') + (R.length && R[R.length - 1] < desks.length - 1 ? '<i class="dmore"></i>' : '')
      + (atPickerEnd() ? '' : '<button class="ddot sig dplus" data-plus aria-label="New desk: pick an app"><span class="dsg"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span></button>');
  }
  /* Dots: tap = jump to that desk. Long-press any dot = peek every desk as a
   * stack of cards (Android recents feel); tap a card to land there. */
  let dotHold = null, peekEl = null, peekJustOpened = 0;
  $('#dock').addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-goto]'); if (!b) return;
    dotHold = setTimeout(() => { dotHold = null; peekJustOpened = Date.now(); openOverview(); ovTapBlock = Date.now() + 500; /* the click that ends the long-press must not land on the overview */ }, 420);
  });
  const endDotHold = () => { clearTimeout(dotHold); dotHold = null; };
  $('#dock').addEventListener('pointerup', endDotHold); $('#dock').addEventListener('pointercancel', endDotHold); $('#dock').addEventListener('pointerleave', endDotHold);
  $('#dock').addEventListener('click', e => {
    if (e.target.closest('[data-plus]')) { if (Date.now() - dockSwiped < 400) return; newDesk(); tourEv('desk-plus', {}); return; }
    const b = e.target.closest('[data-goto]'); if (!b) return;
    if (Date.now() - peekJustOpened < 600 || Date.now() - dockSwiped < 400) return;
    closeOverview(); goDesk(+b.dataset.goto); tourEv('desk', { home: idx === HOME });
  });
  $('#dock').addEventListener('contextmenu', e => { if (e.target.closest('[data-goto]')) e.preventDefault(); });
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
  const barScrubBack = s => { if (s.live) { idx = s.start; placeTrack(0, true); renderDots(); parkDesks(false); } s.live = false; barScrubPeek(false); scrub.classList.remove('on'); };
  // The hovered desk and its neighbours render while the scrub points at it (parked desks skip rendering); the track
  // slides quicker so the desk follows each step. Desks the scrub has left behind (3+ away; 2 away may still be sliding
  // out) are parked again at once, and settling (goDesk / barScrubBack) parks the rest.
  const barScrubPeek = n => {
    track.classList.toggle('bar-scrubbing', n !== false);
    if (n !== false) desks.forEach((_, i) => { const d = Math.abs(i - n); if (d <= 1) secOf(i)?.classList.remove('parked'); else if (d > 2) secOf(i)?.classList.add('parked'); });
  };
  // Where the scrub points: counted from x0, set when the scrub went live (12 px before that point, the slop).
  const barScrubAt = (s, x) => Math.max(0, Math.min(desks.length - 1, s.start - Math.round((x - s.x0) / SC_STEP)));
  const barScrubLive = (s, e) => { s.live = true; s.x0 = e.clientX - Math.sign(e.clientX - s.x) * 12; barScrubPeek(s.at); placeTrack(0, true); scrub.classList.add('on'); scLabel(s.at); vib(10); };
  // The orb's sideways drag hands its finger to the bar scrub (the orb keeps tap, hold and up/down). Its moves and
  // release bubble from #orbWrap to #dock, so the dock's own handlers below run the scrub from here on.
  const barScrubJoin = (e, g) => {
    if ((sheet && sheet !== 'settings') || DS) return false;
    DS = { x: g.x, y: g.y, t: g.t, id: e.pointerId, h: true, ts: g.ts ?? e.timeStamp, start: idx, at: idx, live: false, up: false };
    endDotHold(); if (sheet === 'settings') liftSettings();
    barScrubLive(DS, e); return true;
  };
  const barScrubDrop = () => { if (DS) barScrubBack(DS); DS = null; };
  $('#dock').addEventListener('pointerdown', e => {
    if (e.target.closest('#orbWrap') || (sheet && sheet !== 'settings')) return; // Settings never blocks a desk swipe
    if (e.pointerType === 'touch' && e.clientY > innerHeight - 22) return; // iOS home-indicator strip: the system's swipe
    DS = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, h: false, ts: e.timeStamp, start: idx, at: idx, live: false, up: false };
  });
  $('#dock').addEventListener('pointermove', e => {
    if (!DS || e.pointerId !== DS.id) return;
    const dx = e.clientX - DS.x, dy = e.clientY - DS.y;
    if (!DS.h && window.WosSkinHost?.claimed(e.pointerId)) { DS = null; return; } // a skin gesture owns this finger
    if (!DS.h) { if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy)) return; DS.h = true; endDotHold(); if (sheet === 'settings') liftSettings(); try { $('#dock').setPointerCapture(e.pointerId); } catch (_) {} }
    if (DS.up) return;
    if (dy < -30) { DS.up = true; barScrubBack(DS); placeTrack(0, true); return; } // going up: the iPhone's swipe out
    if (!DS.live) barScrubLive(DS, e);
    const n = barScrubAt(DS, e.clientX);
    if (n !== DS.at && !CHATS.beforeNavigate(desks[n]?.wins || [])) return;
    if (n !== DS.at) { DS.at = n; vib(6); idx = n; barScrubPeek(n); placeTrack(0, true); renderDots(); scLabel(n); }
  });
  const dockEnd = e => {
    if (!DS || e.pointerId !== DS.id) return; const s = DS; DS = null;
    if (!s.h) return;
    const dx = e.clientX - s.x, quick = e.timeStamp - s.ts < BAR_FLICK_MS;
    dockSwiped = Date.now();
    // A cancelled touch or one that rose is the system's swipe out: the desk goes back to where it started.
    if (s.up || e.type === 'pointercancel' || e.clientY - s.y < -30) { barScrubBack(s); return; }
    // A short quick flick moves exactly one desk, the way the finger travelled in total (wizard-ux#1601: decided at
    // release from the whole travel and time, not from steps crossed, so a flick that arrives as one or two merged
    // moves is one desk too). A quick swipe that travelled further lands by distance, below.
    if (quick && Math.abs(dx) < BAR_FLICK_STEPS * SC_STEP) {
      // Under BAR_FLICK_MIN px (finger drift on a dock control, Codex P2 on PR 1603) is no swipe: the desk stays.
      const dir = Math.abs(dx) >= BAR_FLICK_MIN ? -Math.sign(dx) : 0;
      barScrubBack(s); if (dir) { swipeDesk(dir); tourEv('desk', { home: idx === HOME }); } return;
    }
    // The last move may not have come in before the release: land where the finger let go. A quick long swipe counts
    // its whole travel from touch-down, first move included (a lone far first move is not lost to the slop).
    const n = quick ? Math.max(0, Math.min(desks.length - 1, s.start - Math.round(dx / SC_STEP))) : barScrubAt(s, e.clientX);
    if (n !== s.at && (n === s.start || CHATS.beforeNavigate(desks[n]?.wins || []))) s.at = n;
    // The scrub moved idx as it went; land from the start desk so goDesk runs its desk-leave work (Resources, a Home
    // card's Chats chip, an empty desk going away, an open link) exactly as a tap or flick does.
    barScrubPeek(false); scrub.classList.remove('on'); idx = s.start; goDesk(s.at, true); tourEv('desk', { home: idx === HOME });
  };
  $('#dock').addEventListener('pointerup', dockEnd); $('#dock').addEventListener('pointercancel', dockEnd);
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
  function renderOverview() {
    const open = desks.filter(d => !d.home && d.wins.length).length;
    const inner = `<div class="ov-head"><b>Desks</b><span>${open} open</span><button class="ov-done" data-ovdone>Done</button></div>
      <div class="ov-grid">${desks.map((_, i) => ovCard(i)).join('')}<button class="ov-card ov-add" data-ovadd aria-label="New desk: pick an app"><span aria-hidden="true">＋</span><b>New desk</b></button></div>
      <p class="ov-hint">Hold and drag to reorder · pinch two desks together to merge · spread one apart to split</p>`;
    // Pill mode: the same content inside a panel that grows out of the bottom pill; the rest of the screen is a tap-to-close scrim.
    const keep = ovEl.querySelector('.ov-scroll')?.scrollTop || 0;
    // Pill mode is the dock itself with room to spare: the same desk icons and badges in a grid, an ✕ where the pill was.
    const cell = i => {
      const d = desks[i], here = i === idx, name = d.home ? 'Home' : deskName(i);
      return `<div class="ov-card ov-cell${here ? ' here' : ''}${d.home ? ' ov-home' : ''}" data-ov="${d.id}" role="button" tabindex="0"${here ? ' aria-current="true"' : ''} aria-label="${esc(name)}${here ? ', current desk' : ''}"><span class="ov-ic">${deskSigil(i)}</span><span class="ov-nm">${esc(name)}</span>${d.home ? '' : `<button class="ov-x" data-ovx="${d.id}" aria-label="Close ${esc(name)}">✕</button>${ovDl(d)}`}</div>`;
    };
    const pillInner = `<div class="ov-grid">${desks.map((_, i) => cell(i)).join('')}<button class="ov-card ov-cell ov-new" data-ovadd aria-label="New desk: pick an app"><span class="ov-ic"><span class="dsg"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="3.2" stroke-dasharray="3.1 2.6"/></svg></span></span><span class="ov-nm">New desk</span></button></div>`;
    ovEl.innerHTML = ovEl.classList.contains('ov-pill') ? `<div class="ov-sheet"><div class="ov-scroll">${pillInner}</div><button class="ov-close" data-ovdone aria-label="Close desks"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>` : inner;
    const sh = ovEl.querySelector('.ov-scroll'); if (sh) sh.scrollTop = keep;
  }
  /* Miguel's skins: swiping up on the orb opens this same overview as an extension of the bottom pill (mode 'pill'):
   * the pill grows upward into a panel holding every desk; the orb stays as its handle (tap or swipe down closes). */
  function openOverview(mode) {
    if (!ovEl) { ovEl = document.createElement('div'); ovEl.id = 'overview'; ovEl.className = 'ov'; device.appendChild(ovEl); bindOverview(ovEl); }
    closeSheets(true); if (LINKS && LINKS.isOpen()) LINKS.close();
    const pill = mode === 'pill' && orbUpVar() === 'pill';
    if (!ovEl.classList.contains('open')) { ovEl.classList.toggle('ov-pill', pill); device.classList.toggle('ov-pill-open', pill); }
    const wasOpen = ovEl.classList.contains('open');
    renderOverview(); void ovEl.offsetWidth;
    if (pill && !wasOpen) flyFromDock();
    ovEl.classList.add('open'); device.classList.add('ov-open');
    ovEl.querySelector('.ov-card.here')?.scrollIntoView({ block: pill ? 'nearest' : 'center' });
    armBack(); vib(14); window.__ovLog = (window.__ovLog || []).concat('open').slice(-30);
  }
  // Each desk icon rises out of its own spot in the pill (the orb for the desk in view) to its place in the grid.
  function flyFromDock() {
    ovEl.querySelectorAll('.ov-cell').forEach(c => {
      const i = c.dataset.ov ? posOf(c.dataset.ov) : -1, ic = c.querySelector('.ov-ic'); if (!ic) return;
      const src = i === idx ? $('#orbWrap') : i >= 0 ? document.querySelector(`#dock [data-goto="${i}"] .dsg`) : document.querySelector('#dock .dnew .dsg');
      const to = ic.getBoundingClientRect(); let dx = 0, dy = 0;
      if (src) { const f = src.getBoundingClientRect(); dx = f.left + f.width / 2 - (to.left + to.width / 2); dy = f.top + f.height / 2 - (to.top + to.height / 2); }
      else dy = 60;
      try { ic.animate([{ transform: `translate(${dx}px, ${dy}px)`, opacity: src ? 1 : 0 }, { transform: 'none', opacity: 1 }], { duration: 340, easing: 'cubic-bezier(.2,.9,.25,1)' }); } catch (_) {}
    });
  }
  function closeOverview() { if (!ovEl || !ovEl.classList.contains('open')) return false; ovEl.classList.remove('open'); device.classList.remove('ov-open', 'ov-pill-open'); ovEl.classList.remove('editing'); return true; }
  const pillOvOpen = () => !!(ovEl && ovEl.classList.contains('open') && ovEl.classList.contains('ov-pill'));
  window.addEventListener('wizard:app-counts', () => { if (ovEl && ovEl.classList.contains('open') && !OV) renderOverview(); });
  const openPeek = () => openOverview(), closePeek = () => closeOverview();
  const posOf = did => desks.findIndex(d => d.id === did);
  function ovLog(s) { window.__ovLog = (window.__ovLog || []).concat(s).slice(-30); }
  function bindOverview(el) {
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('keydown', e => {
      const c = e.target.closest('[data-ov]');
      if (c && e.target === c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); c.click(); }
    });
    el.addEventListener('click', e => {
      if (Date.now() < ovTapBlock) return;
      if (e.target.closest('[data-ovdone]')) return closeOverview();
      const dl = e.target.closest('[data-ovdl]');
      if (dl) { if (overviewMode().appAction !== 'home-screen') return; const a = ovDeskApp(desks[posOf(dl.dataset.ovdl)]); if (a) window.WizHomeScreenApps?.offer(a); return; }
      const x = e.target.closest('[data-ovx]'); if (x) { closeDesk(posOf(x.dataset.ovx)); if (desks.length) renderOverview(); return; }
      if (e.target.closest('[data-ovadd]')) { closeOverview(); return newDesk(); }
      const c = e.target.closest('[data-ov]'); if (c) { const i = posOf(c.dataset.ov); closeOverview(); if (i >= 0) goDesk(i); return; }
      if (el.classList.contains('editing') && !e.target.closest('[data-ov]') && e.target !== el) { el.classList.remove('editing'); return; }
      if (e.target === el || e.target.classList.contains('ov-grid') || e.target.classList.contains('ov-scroll')) closeOverview();
    });
    const cardAt = (x, y) => { const t = document.elementFromPoint(x, y); return t && t.closest ? t.closest('.ov-card[data-ov]') : null; };
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    el.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        clearTimeout(OV?.hold); if (OV?.drag) endDrag(false);
        const [p, q] = e.touches, a = cardAt(p.clientX, p.clientY), b = cardAt(q.clientX, q.clientY);
        OV = { pinch: true, a, b, d0: dist(p, q), s: 1 }; return;
      }
      if (e.touches.length !== 1) return;
      const t = e.touches[0], c = cardAt(t.clientX, t.clientY);
      OV = { x: t.clientX, y: t.clientY, c, moved: false, drag: false };
      if (c && !c.classList.contains('ov-home') && !e.target.closest('.ov-x, .ov-dl')) OV.hold = setTimeout(() => { if (OV && !OV.moved && !OV.pinch) startDrag(c, t.clientX, t.clientY); }, 380);
    }, { passive: true });
    el.addEventListener('touchmove', e => {
      if (!OV) return;
      if (OV.pinch && e.touches.length === 2) {
        if (e.cancelable) e.preventDefault();
        OV.s = dist(e.touches[0], e.touches[1]) / OV.d0;
        const same = OV.a && OV.a === OV.b;
        el.querySelectorAll('.ov-card.merging, .ov-card.splitting').forEach(c => c.classList.remove('merging', 'splitting'));
        if (!same && OV.a && OV.b && OV.s < .85) { OV.a.classList.add('merging'); OV.b.classList.add('merging'); }
        if (same && OV.s > 1.15) OV.a.classList.add('splitting');
        return;
      }
      const t = e.touches[0]; if (!t) return;
      if (!OV.drag) { if (Math.hypot(t.clientX - OV.x, t.clientY - OV.y) > 9) { OV.moved = true; clearTimeout(OV.hold); } return; }
      if (e.cancelable) e.preventDefault();
      moveDrag(t.clientX, t.clientY);
    }, { passive: false });
    const end = e => {
      if (!OV) return;
      if (OV.pinch) {
        if (e.touches && e.touches.length) return; // wait for both fingers
        const q = OV; OV = null; ovTapBlock = Date.now() + 400;
        el.querySelectorAll('.ov-card.merging, .ov-card.splitting').forEach(c => c.classList.remove('merging', 'splitting'));
        if (q.a && q.b && q.a !== q.b && q.s < .72) { mergeDesks(q.a.dataset.ov, q.b.dataset.ov); renderOverview(); }
        else if (q.a && q.a === q.b && q.s > 1.3) { splitDesk(q.a.dataset.ov); renderOverview(); }
        return;
      }
      clearTimeout(OV.hold);
      // Arrange/download tweak: held and let go in place just stays in arrange mode (✕ and download buttons), no sheet.
      if (arrangeDesks() && OV.drag && !OV.reordered) { endDrag(false); el.classList.add('editing'); ovTapBlock = Date.now() + 400; OV = null; return; }
      if (OV.drag && !OV.reordered && e.changedTouches?.[0] && Math.hypot(e.changedTouches[0].clientX - OV.dx, e.changedTouches[0].clientY - OV.dy) < 12) {
        // Held and let go in place: nothing moved, so offer Add to home screen for a one-app desk (drag still reorders).
        const d = desks[posOf(OV.card.dataset.ov)], w = d && d.wins.length === 1 ? W[d.wins[0]] : null, a = w?.app === 'frame' ? APP[w.appId] : null;
        endDrag(false); ovTapBlock = Date.now() + 400; OV = null;
        if (a) window.WizHomeScreenApps?.offer(a);
        return;
      }
      if (OV.drag) { endDrag(true); ovTapBlock = Date.now() + 400; }
      else if (el.classList.contains('ov-pill') && e.changedTouches?.[0]) {
        // Pill mode: a clear swipe down (list at its top) folds it back into the pill.
        const t = e.changedTouches[0], dy = t.clientY - OV.y, dx = t.clientX - OV.x, sc = el.querySelector('.ov-scroll');
        if (dy > 70 && dy > Math.abs(dx) * 1.3 && (!sc || sc.scrollTop <= 0)) { ovTapBlock = Date.now() + 400; OV = null; closeOverview(); return; }
      }
      OV = null;
    };
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
    function startDrag(c, x, y) {
      OV.drag = true; OV.card = c; OV.dx = x; OV.dy = y; OV.reordered = false; const r = c.getBoundingClientRect(); OV.ox = x - r.left; OV.oy = y - r.top;
      c.classList.add('drag'); el.classList.add('dragging', 'editing'); vib(16); ovLog('drag');
      OV.ghost = c.cloneNode(true); OV.ghost.classList.add('ghost'); OV.ghost.style.width = r.width + 'px'; OV.ghost.style.height = r.height + 'px'; el.appendChild(OV.ghost);
      moveDrag(x, y);
    }
    function moveDrag(x, y) {
      const dr = el.getBoundingClientRect();
      OV.ghost.style.transform = `translate(${x - OV.ox - dr.left}px, ${y - OV.oy - dr.top}px) scale(1.04)`;
      OV.ghost.style.visibility = 'hidden'; const over = cardAt(x, y); OV.ghost.style.visibility = '';
      if (over && over !== OV.card) {
        const grid = el.querySelector('.ov-grid'), cards = [...grid.querySelectorAll('.ov-card[data-ov]')];
        const a = cards.indexOf(OV.card), b = cards.indexOf(over);
        // Home stays first, but its drop zone means "first app", before Chats or any other tab.
        // Rejecting Home as a target made the left edge feel like a pinned Chats slot.
        const before = over.classList.contains('ov-home') || a < b ? over.nextSibling : over;
        if (before !== OV.card) { grid.insertBefore(OV.card, before); OV.reordered = true; vib(6); }
      }
      // Near the top or bottom edge: scroll so far desks can be reached while dragging.
      const sc = el.querySelector('.ov-scroll'), sr = sc ? sc.getBoundingClientRect() : dr, so = sc || el;
      if (y < sr.top + 50) so.scrollTop -= 12; else if (y > sr.bottom - 50) so.scrollTop += 12;
    }
    function endDrag(commit) {
      const c = OV.card; c.classList.remove('drag'); el.classList.remove('dragging'); OV.ghost?.remove();
      if (commit) reorderDesks([...el.querySelectorAll('.ov-grid .ov-card[data-ov]')].map(x => x.dataset.ov));
      renderOverview();
    }
  }
  function reorderDesks(order) {
    const cur = desks[idx]?.id, by = Object.fromEntries(desks.map(d => [d.id, d]));
    const next = [desks[0], ...order.filter(id => id !== desks[0].id && by[id]).map(id => by[id])];
    desks.forEach(d => { if (!next.includes(d)) next.push(d); });
    desks = next; idx = Math.max(0, posOf(cur)); syncDesks(); save(); ovLog('reorder');
  }
  // Drop desks that lost their last window and keep the same desk in front (or the one asked for).
  function pruneDesks(prefer) {
    const cur = desks[idx]?.id, at = idx;
    desks = desks.filter((d, i) => i === 0 || d.wins.length);
    let n = posOf(prefer || cur); if (n < 0) n = posOf(cur);
    if (n < 0) n = Math.max(0, Math.min(at - 1, desks.length - 1));
    idx = Math.min(idx, desks.length - 1); syncDesks(); goDesk(n, true); save();
  }
  function mergeDesks(aId, bId) {
    let a = posOf(aId), b = posOf(bId); if (a < 0 || b < 0 || a === b) return false;
    if (a > b) [a, b] = [b, a];
    if (desks[a].home || desks[b].home) { toast('⌂', 'Home stays on its own'); return false; }
    if (desks[a].wins.length + desks[b].wins.length > MAXW) { toast('▦', 'A desk holds up to four windows'); return false; }
    const keep = desks[a].id, cur = desks[idx].id === desks[b].id ? keep : desks[idx].id;
    desks[a].wins.push(...desks[b].wins); desks[a].full = false; desks[b].wins = [];
    renderDesk(a); pruneDesks(cur); vib([8, 30, 8]); ovLog('merge'); return true;
  }
  function splitDesk(did) {
    const i = posOf(did); if (i < 1) return false; const d = desks[i]; if (d.wins.length < 2) return false;
    const rest = d.wins.filter(id => id !== d.focus), first = d.focus && d.wins.includes(d.focus) ? d.focus : d.wins[0];
    d.wins = [first]; d.focus = first; d.full = false;
    rest.filter(id => id !== first).forEach((id, k) => desks.splice(i + 1 + k, 0, blank({ wins: [id], focus: id })));
    if (idx > i) idx += rest.length;
    renderDesk(i); syncDesks(); save(); vib([8, 30, 8]); ovLog('split'); return true;
  }
  function closeDesk(i) {
    const d = desks[i]; if (!d || d.home) return false;
    const name = deskName(i);
    [...d.wins].forEach(id => { closeAppPlayback(W[id]); delete W[id]; delete CH[id]; }); d.wins = [];
    renderDesk(i); pruneDesks(); toast('✕', `Closed ${esc(name)}`); ovLog('close'); return true;
  }

  /* The desk scrub's name label (the bar scrub above shows it); it takes no touches, the bar under it scrubs. */
  const scrub = document.createElement('div'); scrub.id = 'scrub'; scrub.className = 'scrub';
  scrub.innerHTML = '<span class="sc-label"></span>'; $('#dock').appendChild(scrub);
  const SC_STEP = 26;
  function scLabel(at) { scrub.querySelector('.sc-label').textContent = deskName(at); }

  /* ---------------- window operations ---------------- */
  /* Every new thing opens on its own desk, right beside the one in front (James, 12 Oct 2026: apps always open
   * in a new tab, as one shell rule, never a per-app setting). Only an explicit user placement (opts.desk from a
   * user aim, opts.here) may share an existing desk; app openers pass opts through and never pick a desk. */
  // Directly beside the desk in front, Home included (James, 11 Oct 2026: from Home, Yesterday and every other
  // app open on the desk right next to Home; Chats just moves one to the right).
  // With workspace sync on, desk order is shared by every device, so a phone-only placement reshuffles the owner's
  // other devices too (Miguel, 1 Nov 2026: Backup and Calendar kept jumping to desktops 1 and 2). Then a new app
  // opens on a new desk at the end, and an app already open opens on its desk where it is (bringBeside).
  const sharedDeskOrder = () => { const s = window.WosWorkspaceSync?.current; return !!s && s.on && !s.absent; };
  function insertPos() { return sharedDeskOrder() ? desks.length : idx + 1; }
  function openWin(obj, opts = {}) {
    if (obj.app === 'chats' && !obj.agent && !obj.chatsProvider) obj = { ...obj, chatsProvider: CHATS.views.defaultId() };
    const w = { id: newId(), ...obj }; W[w.id] = w;
    let t = opts.desk != null ? Math.max(0, Math.min(desks.length - 1, opts.desk)) : opts.here ? idx : -1;
    if (t >= 0 && (desks[t].home || desks[t].wins.length >= MAXW)) t = -1;
    if (t < 0 && !desks[idx].home && !desks[idx].wins.length) t = idx; // the empty desk in front takes it
    if (t < 0) { t = insertPos(); desks.splice(t, 0, blank({ wins: [w.id], focus: w.id })); syncDesks(); }
    else { const d = desks[t]; d.wins.push(w.id); d.focus = w.id; d.full = false; }
    renderDesk(t); save(); renderDots();
    if (opts.stay) return w; // opened beside, out of view (a bound view): the desk in front stays in front
    if (t !== idx) goDesk(t, true);
    announce(`Opened <b>${esc(winApp(w).name)}</b>`);
    return w;
  }
  function closeAppPlayback(w) {
    window.WizBackgroundAudio?.closeApp(w?.appId)?.catch(() => toast('♫', 'Audio could not stop. Pause it from the media controls.'));
  }
  function closeWin(id, quiet, preservePlayback = false) {
    if (W[id]?.app === 'pages' && !window.WosPages.canClose(winEl(id)?.querySelector('.pg-host'))) return;
    const i = deskOf(id); if (i < 0) return;
    const w = W[id], d = desks[i], name = winTitle(w);
    if (!CHATS.beforeLeave(id)) return;
    if (!preservePlayback) closeAppPlayback(w);
    CHATS.closeHosted(id); CHATS.forget(id);
    if (quiet) { d.wins = d.wins.filter(x => x !== id); delete W[id]; delete CH[id]; if (d.focus === id) d.focus = d.wins[d.wins.length - 1] || null; if (!d.wins.length) d.full = false; renderDesk(i); pruneDesks(); return; }
    // ✕ on a bound view: it stays closed for this reply (opening the thread again, or a new reply, binds again).
    if (w.bound) { boundOff[w.bound] = w.bsid + '|' + w.bkey; boundManager?.dismiss(w); }
    const back = w.from && i === idx && desks.some(x => x.id === w.from.desk) ? w.from : null;
    d.wins = d.wins.filter(x => x !== id); delete W[id]; delete CH[id];
    if (d.focus === id) d.focus = d.wins[d.wins.length - 1] || null;
    if (!d.wins.length) d.full = false;
    renderDesk(i); pruneDesks(back && !d.wins.length ? back.desk : null); vib(8);
    if (back && W[back.win] && deskOf(back.win) === idx) focusWin(back.win);
    if (back) announce(`Back to <b>${esc(clip(back.title || deskName(idx), 40))}</b>`); else toast('✕', `Closed ${esc(name)}`);
  }
  // Move a window onto another desk (to = a desk index), or onto a desk of its own (to = 'own').
  function moveWin(id, to) {
    const from = deskOf(id); if (from < 0) return false;
    if (to === 'own') {
      if (desks[from].wins.length < 2) return false;
      const f = desks[from]; f.wins = f.wins.filter(x => x !== id); if (f.focus === id) f.focus = f.wins[f.wins.length - 1] || null; f.full = false;
      desks.splice(from + 1, 0, blank({ wins: [id], focus: id })); renderDesk(from); syncDesks(); renderDesk(from + 1); save(); goDesk(from + 1, true);
      announce(`<b>${esc(winApp(W[id]).name)}</b> has its own desk`); return true;
    }
    if (to < 1 || to >= desks.length || to === from) return false;
    if (desks[to].wins.length >= MAXW) { toast('▦', `${esc(deskName(to))} is full`); return false; }
    const f = desks[from]; f.wins = f.wins.filter(x => x !== id); if (f.focus === id) { f.focus = f.wins[f.wins.length - 1] || null; f.full = false; } if (!f.wins.length) f.full = false;
    const d = desks[to]; d.wins.push(id); d.focus = id; d.full = false;
    renderDesk(from); renderDesk(to); const dest = d.id; pruneDesks(dest);
    announce(`Moved to <b>${esc(deskName(idx))}</b>`);
    return true;
  }
  function focusWin(id) {
    const i = deskOf(id); if (i < 0 || desks[i].focus === id) return;
    desks[i].focus = id; applyLayout(i); save();
    window.WosSkinHost?.changed();
  }
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
  function setZen(on, quiet) {
    on = !!on; if (on === zen) return; zen = on;
    device.classList.toggle('zen', on); store.set('zen', on);
    clearTimeout(zenTipT); device.classList.remove('zen-tip');
    if (on && !quiet) {
      try { armBack(); } catch (e) {}
      void device.offsetWidth; device.classList.add('zen-tip');
      zenTipT = setTimeout(() => device.classList.remove('zen-tip'), 2400);
      const n = store.get('zenTips', 0);
      if (n < 3) { store.set('zenTips', n + 1); toast('↑', 'Swipe up from the bottom to bring the orb back', 2200); }
    }
    if (!quiet) { vib(on ? 8 : 6); tourEv('zen', { on }); }
  }
  function clearDesk(i) { closeDesk(i); }
  /* Apps open as windows. Views reuse a review window already on this desk. */
  function mountLinks() {
    if (LINKS || !window.WizLinks) return;
    LINKS = window.WizLinks.mount({
      // An installed Reader preview paints its loading frame in this tap task, just like desktop previews.
      // Do not send it through the launcher's asynchronous setup check; ordinary app links still use that gate.
      readerApp: () => APP.browser, readerOpen: href => openLinkDesk(href, null, true),
      parent: device, mode: 'sheet',
      onKeep: (url, title) => { const a = APPS.find(x => x.url && x.url.replace(/[#?].*$/, '') === url.replace(/[#?].*$/, '')); if (a) openApp(a); else { const o = appAt(url); openWin({ app: 'frame', url, title: o ? o.name : title, ...(o ? { appId: o.id } : {}) }); } },
      onChange: on => { device.classList.toggle('link-open', on); if (on) { closeSheets(true); armBack(); } },
    });
    // Phone (James, 10 Oct 2026): a tapped link opens on its own desk beside this one (see openLinkDesk).
    LINKS.route = (href, from) => openLinkDesk(href, from);
    window.WizLinks.intercept(device, LINKS);
  }
  /* A tapped internal link opens on its own desk right beside the one it came from, full screen at once.
   * Tapped in a Chats thread, that desk is in thread-feedback mode: amber edge, "Review" tag, and the orb sends what
   * James says as feedback to that thread. Back or ✕ closes it and lands on the thread again; Pin keeps it
   * as a normal desk. Links tapped inside a review desk navigate that same window (Back steps back). */
  function linkTitle(u) {
    const seg = decodeURIComponent(u.pathname.replace(/\/+$/, '').split('/').filter(Boolean)[0] || u.hostname);
    const app = APPS.find(x => x.url && u.pathname.startsWith(x.url.replace(/[#?].*$/, '')));
    return app ? app.name : seg.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  // Where a tapped link came from: Back or ✕ on what it opened closes that and lands here again.
  function fromOf(srcId) {
    const src = W[srcId], sid = src?.app === 'chats' && src.thread && src.thread !== '__new__' ? src.thread : '';
    return { desk: desks[deskOf(srcId)]?.id || desks[idx].id, win: srcId || '', sid, title: sid ? (LIVE?.session(sid)?.title || winTitle(src)) : (src ? winTitle(src) : '') };
  }
  function openLinkDesk(href, fromEl, setupChecked = false) {
    let u; try { u = new URL(href, location.href); } catch (e) { return false; }
    if (u.origin !== location.origin) return false;
    const srcId = (fromEl && fromEl.closest ? fromEl.closest('.win')?.dataset.win : '') || desks[idx].focus;
    const src = W[srcId], rel = u.pathname + u.search + u.hash;
    const pageSlug = window.WosPages?.match(href);
    if (pageSlug) return !!openWin({app:'pages', appId:'pages', pageSlug, from:fromOf(srcId)});
    // Without the Pages API preserve the ordinary link sheet, not a privileged frame.
    if (/^\/pages\//.test(u.pathname)) return false;
    const targetApp = appAt(rel);
    if (targetApp && !setupChecked && window.WosAppSetup)
      return window.WosAppSetup.gate(targetApp, () => openLinkDesk(href, fromEl, true));
    // a layout placing the shell's opens (apps.routeOpens): an app's page where it shows that app
    const routed = window.WosSkinHost?.routeOpen?.('link', { url: rel, title: '', app: targetApp ? targetApp.id : '' }, () => linkDesk(u, rel, srcId));
    return routed ? routed.value !== false : linkDesk(u, rel, srcId);
  }
  function linkDesk(u, rel, srcId) {
    const src = W[srcId];
    if (src && src.from && src.app === 'frame') { const f = winEl(srcId)?.querySelector('iframe'); if (f) { try { window.WizAppServices?.expectLoad?.(f); f.contentWindow.location.href = u.href; } catch (e) { f.src = u.href; } return true; } }
    const open = Object.values(W).find(w => w.from && w.url === rel); if (open) { goDesk(deskOf(open.id)); return true; }
    const from = fromOf(srcId);
    window.__ovLog = (window.__ovLog || []).concat('link:' + rel).slice(-30);
    const owner = appAt(rel); // a page inside an installed app opens as that app, with its services
    return !!openWin({ app: 'frame', appId: owner ? owner.id : 'link', url: rel, title: owner ? owner.name : linkTitle(u), from });
  }
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
  function threadShown(wid, el) {
    if (boundBusy) return;
    boundManager ||= window.WosBoundView.create({ windows: () => Object.values(W), win: id => W[id], findApp, APP, linkTitle,
      visible: id => deskOf(id) === idx, from: fromOf, title: winTitle, close: id => closeWin(id, true, true),
      open: (obj, origin) => { openWin(obj, { stay:true }); boundTip(origin); },
      reload: id => { save(); const f = winEl(id)?.querySelector('iframe'); if (f) f.src = f.src; }, changed: syncPeek });
    boundManager.shown(wid, el);
  }
  // Re-check every open thread (after a desk change) and drop bound views whose thread went away.
  function syncBound() {
    if (boundBusy) return;
    for (const w of Object.values(W)) if (w.bound && deskOf(w.id) >= 0) { const c = W[w.bound]; if (!c || deskOf(c.id) < 0 || c.thread !== w.bsid) { boundBusy = true; try { closeWin(w.id, true, true); } finally { boundBusy = false; } } }
    const f = W[desks[idx]?.focus];
    if (f && f.app === 'chats' && f.thread && f.thread !== '__new__') { const el = winEl(f.id)?.querySelector('[data-chats]'); if (el && el.querySelector('.ch-thread') && CHATS.ch(f.id).loadedFor === f.thread) threadShown(f.id, el); }
    syncPeek();
  }
  function boundTip(wid) {
    const n = store.get('boundTips', 0); if (n >= 3) return;
    store.set('boundTips', n + 1);
    const b = boundOf(wid); if (b) toast('▸', `<b>${esc(clip(winTitle(b), 28))}</b> is open beside this thread · tap or swipe the right edge to look`, 2600);
  }
  /* The peek (James, 12 Oct 2026: no tab, the bottom bar swipe is enough): on the thread the bound desk leans
   * 36 px in from the right; on the bound view its thread leans 12 px in from the left. The leaning edge is a
   * handle too (core/edge-peek.js, told through WosSkinHost.beside): tap or swipe it to move across. */
  function syncPeek() {
    const f = W[desks[idx]?.focus], b0 = f && f.app === 'chats' && f.thread ? boundOf(f.id) : null, b = b0 && b0.bsid === f.thread ? b0 : null;
    const on = !!(b && deskOf(b.id) === idx + 1);
    const owner = f?.bound ? W[f.bound] : null;
    const left = !!(owner && owner.thread === f.bsid && deskOf(owner.id) === idx - 1);
    const nsec = on ? secOf(idx + 1) : null;
    const psec = left ? secOf(idx - 1) : null;
    const hsec = on ? secOf(idx) : null;
    const vsec = left ? secOf(idx) : null;
    $$('.desk.bound-peek', track).forEach(s => { if (s !== nsec) s.classList.remove('bound-peek'); });
    $$('.desk.bound-chat-peek', track).forEach(s => { if (s !== psec) s.classList.remove('bound-chat-peek'); });
    $$('.desk.bound-host', track).forEach(s => { if (s !== hsec) s.classList.remove('bound-host'); });
    $$('.desk.bound-view-host', track).forEach(s => { if (s !== vsec) s.classList.remove('bound-view-host'); });
    if (nsec) nsec.classList.add('bound-peek');
    if (psec) psec.classList.add('bound-chat-peek');
    if (hsec) hsec.classList.add('bound-host');
    if (vsec) vsec.classList.add('bound-view-host');
    device.classList.toggle('bound-peeking', on);
    device.classList.toggle('bound-view-peeking', left);
    window.WosSkinHost?.beside?.();
  }
  // "Open app": a normal copy on a desk of its own, beside the bound one; the bound view stays with the thread.
  function detachBound(id) {
    const w = W[id]; if (!w || !w.from) return;
    if (!w.bound) return pinWin(id); // a manually opened review becomes its own app desk
    const href = frameHref(id) || w.url || '';
    const a = w.appId && w.appId !== 'link' ? (APP[w.appId] || findApp(w.appId)) : null;
    if (a) {
      const here = Object.keys(W).find(k => W[k].app === 'frame' && W[k].appId === a.id && !W[k].from && deskOf(k) >= 0);
      if (here) { bringBeside(here); goDesk(deskOf(here), true); focusWin(here); }
      else openWin({ app: 'frame', appId: a.id, ...(href && href !== a.url ? { url: href } : {}) });
    } else openWin({ app: 'frame', appId: 'link', url: href, title: winTitle(w) });
    toast('↗', `${esc(clip(winTitle(w), 30))} has its own desk now · the review view stays with the thread`, 2200);
  }
  function pinWin(id) {
    const w = W[id]; if (!w || !w.from) return;
    delete w.from; save();
    const el = winEl(id); if (el) { el.classList.remove('reviewing'); el.querySelector('[data-wact="detach"]')?.remove(); el.querySelector('.rv-tag')?.remove(); }
    applyLayout(deskOf(id)); renderDots(); syncReviewChip(); toast('↗', 'Open app · it now has its own desk', 1600);
  }
  /* Review mode: the amber orb ring is the only lasting marker (James, 10 Oct 2026: no persistent chip).
   * The first time a review desk opens, a one-off card explains it; tap anywhere or Back dismisses it. */
  let rvCoach = null;
  function closeReviewCoach() { if (!rvCoach) return false; const el = rvCoach; rvCoach = null; el.classList.remove('open'); setTimeout(() => el.remove(), 240); return true; }
  function showReviewCoach(f) {
    if (rvCoach || store.get('rvCoached', false)) return;
    store.set('rvCoached', true);
    rvCoach = document.createElement('div'); rvCoach.className = 'rv-coach'; rvCoach.setAttribute('role', 'dialog'); rvCoach.setAttribute('aria-label', 'Review mode');
    rvCoach.innerHTML = `<div class="rv-card"><div class="rv-h"><i></i>Review mode</div>
      <p><b>Tap the orb and talk.</b> Your feedback goes to <b>${esc(clip(LIVE?.session(f.from.sid)?.title || (f.from.title !== 'Thread' && f.from.title) || 'the thread you came from', 48))}</b>.</p>
      <p><b>Open app</b> keeps the app on its own desk${f.bound ? ", while this review stays with the thread" : ""}.</p>
      <p>${f.bound ? "<b>Tap the left edge</b> or swipe right on the bottom bar to return to the thread. <b>Back</b> returns too; leaving the thread closes its review view." : "<b>Back</b> or <b>✕</b> closes the review and takes you back."}</p>
      <button class="rv-ok" type="button">Got it</button></div>`;
    rvCoach.addEventListener('click', () => closeReviewCoach());
    device.appendChild(rvCoach); void rvCoach.offsetWidth; rvCoach.classList.add('open');
  }
  function syncReviewChip() {
    const f = desks[idx] ? W[desks[idx].focus] : null, on = !!(f && f.from && f.from.sid);
    device.classList.toggle('reviewing', on);
    if (on) showReviewCoach(f); else closeReviewCoach();
  }
  /* Quick search: results open in the link sheet over whatever James is doing (no thread, no desk change). */
  function openSearch(query, tab) {
    const url = searchUrl(query, tab); if (!url) return false;
    closeSheets(true); mountLinks(); if (!LINKS) return false;
    LINKS.open(url); return true;
  }
  /* opening: moved to app-opening.js (wizard-ux issue 1665), called once here */
  const { framePage, openingEnd, openingReady, tapOpen } = window.WizCore.appParts.opening({ closeSheets, openApp, save, store, vib, winApp, winEl });
  function placeApp(mine, obj, opts = {}, refresh) {
    const here = opts.desk == null ? Object.keys(W).find(id => deskOf(id) >= 0 && mine(W[id])) : null;
    openingReady();
    if (!here) { const w = openWin(obj, opts); openingEnd(); return w; }
    delete W[here].seed; // the owner opened it himself: a starter app becomes one of his open apps (and syncs)
    if (W[here].app !== 'chats') bringBeside(here);
    const t = deskOf(here);
    if (refresh) refresh(W[here], t);
    if (t !== idx) goDesk(t, true);
    focusWin(here); save(); openingEnd();
    return W[here];
  }
  // Hosted Wizard apps (App Store, System) ask the shell to open another installed app in its own window.
  const hostedOpenable = id => { const a = APP[id]; if (!a?.url || a.kind !== 'wizard') return null; try { if (new URL(a.url, location.origin).origin !== location.origin) return null; } catch (e) { return null; } return a; };
  window.WizCanOpen = id => !!hostedOpenable(id);
  window.WizAppOpen = id => Object.values(W).some(w => w && w.appId === id);
  window.WizOpenApp = (id, path = '') => {
    const x = hostedOpenable(id); if (!x) return false;
    if (!path) { const r = window.WosSkinHost?.routeOpen?.('app', { id, path: '' }, () => openApp(x)); return r ? true : openApp(x); }
    let u; try { u = new URL(path, location.href); } catch (_) { return false; }
    const rel = u.pathname + u.search + u.hash;
    if (u.origin !== location.origin || appAt(rel)?.id !== id) return false;
    // An explicit repair action is an app workflow, not a page sent for review.
    const go = () => !!openWin({ app: 'frame', appId: id, url: rel, from: { ...fromOf(desks[idx].focus), sid: '' }, workflow: true });
    // a layout placing the shell's opens (apps.routeOpens): the app where it shows apps, at that page
    return window.WosSkinHost?.routeOpen?.('app', { id, path: rel }, go) ? true : go();
  };
  // An app the Store just installed: re-check the registry (as Welcome does) with a visible Starting…, never a
  // silent no-op. One wait per app; a second tap while it waits joins it. Gives up after about a minute.
  const OPEN_WAIT = new Map();
  function whenOpenable(id) {
    const now = hostedOpenable(id); if (now) return Promise.resolve(now);
    if (OPEN_WAIT.has(id)) return OPEN_WAIT.get(id);
    const label = () => esc(APP[id]?.name || 'The app');
    const p = (async () => {
      for (let i = 0; i < 30; i++) {
        try { await window.WizCore.refreshApps?.(); } catch (_) {}
        const a = hostedOpenable(id); if (a) return a;
        if (i === 0) toast('◌', `${label()} is starting…`, 4000);
        await new Promise(r => setTimeout(r, i < 5 ? 1000 : 2000));
      }
      toast('◌', `${label()} is installed but still starting. Try again in a moment.`, 4000);
      return null;
    })().finally(() => OPEN_WAIT.delete(id));
    OPEN_WAIT.set(id, p); return p;
  }
  // Only trusted system windows may ask; check the actual sender frame, never a claimed app id.
  addEventListener('message', async e => {
    const d = e.data; if (e.origin !== location.origin || !d || d.type !== 'wizard:open-app' || typeof d.id !== 'string') return;
    const host = [...document.querySelectorAll('iframe')].find(f => f.contentWindow === e.source)?.closest('[data-win]');
    const w = host && W[host.dataset.win]; if (!w || !['app-store', 'agents', 'setup'].includes(w.appId)) return;
    // A just-installed app may still be starting (its page and route land a few seconds after the Store says
    // Installed, longer during a WizardOS update): say so and open it once the registry has its page (#1651).
    const a = await whenOpenable(d.id); if (!a) return;
    const here = host.isConnected && W[host.dataset.win] === w;
    if (openApp(a) !== false && here && d.replace === true && w.appId === 'app-store') closeWin(host.dataset.win, true);   // Get more: the app takes the Store's place
  });
  /* App → agent binding: an app's settings sheet (core/app-route.js). Its Agents button opens the Agents app
   * at that agent; Agents frames may ask for an app's sheet. */
  window.WosAppRoute?.init({ openAgents: (id, o = {}) => { openApp(APP.agents); const msg = o.newPreset ? { type: 'wizard:agents-new', preset: o.newPreset } : id ? { type: 'wizard:agents-show', id } : null; if (msg) [400, 1100, 2200].forEach(t => setTimeout(() => { for (const f of document.querySelectorAll('iframe[title="Agents"]')) f.contentWindow?.postMessage(msg, location.origin); }, t)); } });
  addEventListener('message', e => {
    const d = e.data; if (e.origin !== location.origin || !d || d.type !== 'wizard:app-route' || typeof d.id !== 'string') return;
    const host = [...document.querySelectorAll('iframe')].find(f => f.contentWindow === e.source)?.closest('[data-win]');
    const w = host && W[host.dataset.win]; if (!w || !['agents', 'app-store'].includes(w.appId)) return;
    window.WosAppRoute?.request(d);
  });
  /* The Agents app opens an agent's own Chats. Only those frames may ask; the agent must exist. */
  addEventListener('message', e => {
    const d = e.data; if (e.origin !== location.origin || !d || d.type !== 'wizard:open-agent-chats' || typeof d.id !== 'string') return;
    const host = [...document.querySelectorAll('iframe')].find(f => f.contentWindow === e.source)?.closest('[data-win]');
    const w = host && W[host.dataset.win]; if (!w || !['agents'].includes(w.appId)) return;
    openAgentChats(d.id, { backTo: w.id, thread: d.thread === '__new__' ? '__new__' : '' });
  });
  /* Agent shortcuts select Focus in the main Chats window; no per-agent window or desk. */
  async function openAgentChats(id, o = {}) {
    const AG = window.WosAgents; if (!AG || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(String(id || ''))) return false;
    if (!AG.get(id)) await AG.load(true);
    if (!AG.get(id)) { toast('!', 'That agent isn’t on this Wizard', 2000); return false; }
    closeSheets(true);
    const w = placeApp(mainChats, { app: 'chats', thread: null });
    if (!w) return false;
    CHATS.setFocus(w, { kind: 'agent', key: id });
    if (w && o.thread === '__new__') CHATS.openNewDraft(w.id, '');
    LIVE?.refreshAgents?.().then(() => LIVE.emit());
    return o.share ? { id: w.id, agentId: id } : true;
  }
  window.WizOpenAgentChats = openAgentChats;
  window.WosAppSetup?.init({ getApp: id => APP[id], isFront: id => focusedWin()?.appId === id });
  function openApp(a, extra = {}, opts = {}) {
    if (!a) return false;
    if (a.id === 'setup' && window.WosWelcome) { openingEnd(a.id); closeSheets(true); window.WosWelcome.open(); return true; } // Setup is the Welcome modal now
    if (a.id === 'pages') { closeSheets(true); placeApp(w => w.app === 'pages' && !w.from, {app:'pages', appId:'pages'}, opts); return true; }
    // A launcher link to one of the agent's Pages opens in the Pages window (pages are sandboxed, opaque-origin documents).
    const pageSlug = a.url && window.WosPages?.match(a.url);
    if (pageSlug) { closeSheets(true); placeApp(w => w.app === 'pages' && w.pageSlug === pageSlug, {app:'pages', appId:'pages', pageSlug}, opts); return true; }
    if (a.id !== 'troubleshooter' && a.kind === 'wizard' && a.url && !opts.setupChecked && window.WosAppSetup)
      return window.WosAppSetup.gate(a, () => openApp(a, extra, { ...opts, setupChecked: true }), { settled: () => openingEnd(a.id) });
    if (a.id === 'side-button') { closeSheets(true); if (idx !== HOME) goDesk(HOME); sideButtonTap(true); return true; }
    if (a.kind === 'chats') {
      if (a.agent) return openAgentChats(a.agent);
      const chatsProvider = a.chatsProvider || CHATS.views.defaultId();
      placeApp(w => w.app === 'chats' && !w.agent && CHATS.views.providerFor(w) === chatsProvider, { app: 'chats', thread: null, chatsProvider }, opts);
      return true;
    }
    if (a.kind === 'wizard' && a.url && opts.from) {
      // Opened from a link in a thread (James, 12 Oct 2026): Back closes it and lands on that thread again,
      // exactly like any other link. A copy already opened from a link is reused; a normal desk of the app is left alone.
      placeApp(w => w.app === 'frame' && w.appId === a.id && w.from, { app: 'frame', appId: a.id, from: opts.from }, {}, w => { w.from = opts.from; });
      return true;
    }
    // extra.path: one of the app's own pages (a spoken declared route), opened exactly like a tap, then at that page.
    if (a.kind === 'wizard' && a.url) { const path = extra.path || ''; placeApp(w => w.app === 'frame' && w.appId === a.id && !w.from, { app: 'frame', appId: a.id, ...(path ? { url: path } : {}) }, opts, path ? w => framePage(w, path) : null); return true; }
    const q = extra.query || '';
    placeApp(w => w.app === 'app' && w.appId === a.id, { app: 'app', appId: a.id, query: q }, opts, q ? (w, t) => { w.query = q; renderDesk(t); } : null);
    return true;
  }
  /* Move an open window to where a new app would open (insertPos: right beside this desk, Home included.
   * A window alone on its desk takes its whole desk along; one sharing a desk gets a desk of its own. */
  function bringBeside(id) {
    if (sharedDeskOrder()) return;
    const from = deskOf(id); if (from < 0 || from === idx) return;
    const t = insertPos(); if (from === t) return;
    if (desks[from].wins.length === 1) {
      const [d] = desks.splice(from, 1); desks.splice(from < t ? t - 1 : t, 0, d);
      if (idx > from && idx <= t) idx--; // keep the desk in front (Home) the same desk
    } else {
      const f = desks[from]; f.wins = f.wins.filter(x => x !== id); if (f.focus === id) f.focus = f.wins[f.wins.length - 1] || null; f.full = false;
      desks.splice(t, 0, blank({ wins: [id], focus: id })); renderDesk(from);
    }
    syncDesks(); save();
  }
  /* Notifications = the Chats list itself: unfiltered, out of any thread, scrolled to the top (Working, Ready). */
  function openChatsList() {
    closeSheets(true);
    let here = Object.keys(W).find(id => mainChats(W[id]) && deskOf(id) >= 0);
    if (!here) { openApp(APP.wizard); here = Object.keys(W).find(id => mainChats(W[id]) && deskOf(id) >= 0); }
    if (!here) return;
    const t = deskOf(here); if (t !== idx) goDesk(t, true);
    focusWin(here); const w = W[here], d = desks[t]; if (d.full && d.focus !== here) setFull(d.focus, false);
    const c = CHATS.ch(here); c.q = ''; c.sheet = false; c.fromCard = false; c.coach = false; c.filterFrom = null;
    if (!CHATS.setFilter(w, '')) CHATS.renderChats(w);
    requestAnimationFrame(() => { const sc = winEl(here)?.querySelector('.ch-scroll'); if (sc) sc.scrollTop = 0; });
  }
  // The Chats window in front as it is (its thread kept; opened if there is none): the AI apps view's main screen.
  function showChats() {
    // A layout's deferred Home -> Chats preparation is not an owner navigation.
    // Keep the same Settings sheet/page over the new view, without closing,
    // reopening, or parking it back on the Home desk we are preparing behind it.
    const keepSettings = sheet === 'settings';
    if (!keepSettings) closeSheets(true);
    let here = Object.keys(W).find(id => mainChats(W[id]) && deskOf(id) >= 0);
    if (!here) { openApp(APP.wizard, {}, { stay: keepSettings }); here = Object.keys(W).find(id => mainChats(W[id]) && deskOf(id) >= 0); }
    if (!here) return null;
    const t = deskOf(here); if (t !== idx) goDesk(t, true, keepSettings);
    focusWin(here); return W[here];
  }
  /* Home's Unread and Working cards: the Chats window, filtered to just those threads. Back clears the filter
   * and returns to the desk the card was tapped on. */
  function openChatsFiltered(f, opts = {}) {
    closeSheets(true);
    const from = desks[idx].id;
    let here = Object.keys(W).find(id => mainChats(W[id]) && deskOf(id) >= 0);
    if (!here) { openApp(APP.wizard); here = Object.keys(W).find(id => mainChats(W[id]) && deskOf(id) >= 0); }
    if (!here) return;
    const t = deskOf(here); if (t !== idx) goDesk(t, true);
    focusWin(here); const w = W[here], d = desks[t]; if (d.full && d.focus !== here) setFull(d.focus, false);
    const c = CHATS.ch(here); c.q = ''; c.sheet = false; c.lastChip = 'status';
    // The chip is the same one James can add himself from the filter button; the first time, one coach line.
    c.coach = !store.get('chipCoached', false); store.set('chipCoached', true);
    c.fromCard = !!opts.card;
    c.filter = ''; CHATS.setFilter(w, f); c.filterFrom = opts.from === undefined ? from : opts.from;
  }

  /* ---------------- side button (WizardOS Android app only) ----------------
   * The switch lives on Home. One tap: WizardOS asks for the microphone in place, then opens the one system page
   * Android keeps for itself (pick WizardOS as the assistant). Back in WizardOS, the app pushes the new state to
   * window.__wosSideButton and the card turns green on its own. Once the side button has really reached Wizard
   * OS, the card disappears. */
  const NATIVE = () => window.WizardOSNative && typeof window.WizardOSNative.sideButton === 'function';
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
  function renderSettings() {
    if (!settingsView) settingsView = window.WosSettings.mount($('#settingsBody'), settingsContext());
    else settingsView.render();
  }
  function openFilesScreen() {
    closeSheets(true);
    let wid = chatsWinAny();
    if (!wid) { const w = openWin({ app: 'chats', thread: null }); if (!w) return; wid = w.id; }
    focusWin(wid); renderChats(W[wid]);
    setTimeout(() => CHATS.PW?.openFiles(wid), 30);
  }
  function openSettings(focus) {
    openSheet('settings');
    settingsView?.focus(focus === true ? 'unsent' : focus);
  }
  function unsentAction(id, origin, action) { return window.WosSettings.unsentAction(settingsContext(), id, origin, action); }
  // Edit puts the words back in a composer (the thread's, or a new chat's) and takes the item out of the queue.
  function editUnsent(it) {
    if (it.state === 'unconfirmed' || OUTBOX?.quarantined(it.id)) { toast('!', it.error || 'Waiting for device storage verification · original kept', 3200); return; }
    if (it.body) { toast('!', 'Delivery is uncertain · retry this submission to reconcile before editing', 3000); return; }
    closeSheets(true);
    const known = it.kind === 'reply' || LIVE?.session(it.sessionId);
    let wid;
    if (known) { openWizardThread(it.sessionId); wid = desks[idx].focus; }
    else {
      const agent = it.agent || '';
      const w = openWin({ app: 'chats', thread: null, ...(agent ? { agent } : {}) }); if (!w) return;
      wid = w.id; focusWin(wid); openChat(wid, '__new__');
    }
    if (!window.WosSettings.moveDraft({ chats: CHATS, wid: wid, item: it, outbox: OUTBOX, toast })) return; renderChats(W[wid]);
    setTimeout(() => { const ta = track.querySelector(`[data-chats="${wid}"] textarea`); ta?.focus(); }, 50);
  }
  // Empty desks (the New desk's app grid) drawn again, unless someone is typing in their search.
  function repaintNewDesks(onlyChanged) {
    desks.forEach((d, i) => { if (!d.wins.length && !d.home) { const g = secOf(i)?.querySelector('.glance'); if (g && !g.querySelector('[data-ndq]')?.value && document.activeElement?.closest('.glance') !== g) { const html = renderEmpty(i); if (!onlyChanged || g._wosNd !== html) { g.innerHTML = html; g._wosNd = html; } } } });
  }
  // ux#1646: a fresh app list redraws the New desk, so an app that gained its page leaves Agent apps for Apps.
  window.addEventListener('wizard:apps', () => { try { repaintNewDesks(true); } catch (_) {} });
  let lastUnsentSig = '';
  function onUnsentChange() {
    readNativeUnsent();
    if (sheet === 'settings') renderSettings();
    if (sheet === 'inbox') renderInbox();
    refreshHome(); renderMoons();
    repaintNewDesks();
    for (const id of Object.keys(W)) { const w = W[id]; if ((w.app === 'chats' || CHATS.isHosted(id)) && w.thread) { const el = track.querySelector(`[data-chats="${id}"]`); if (el) renderThread(w, el); } }
    for (const id of Object.keys(W)) { const w = W[id]; if (w.app === 'chats' && !w.thread) { const el = track.querySelector(`[data-chats="${id}"]`); if (el && el.querySelector('.ch-list')) CHATS.renderChatList(w, el); } }
    // Tell Android how many app messages are stuck, so it can say so in a notification while the app is closed.
    const failed = OUTBOX ? OUTBOX.unsent().filter(x => x.state === 'failed') : [];
    const sig = failed.map(x => x.id).join(',');
    if (sig !== lastUnsentSig) { lastUnsentSig = sig; try { NATIVE() && window.WizardOSNative.appUnsent && window.WizardOSNative.appUnsent(failed.length, failed[0]?.text || ''); } catch (e) {} }
  }
  OUTBOX?.onChange(onUnsentChange);
  window.__wosUnsent = () => { onUnsentChange(); return true; };
  window.__wosEverywhere = () => { if (sheet === 'settings') renderSettings(); return true; };
  /* home: moved to app-home.js (wizard-ux issue 1665), called once here */
  const { renderHome, bindLate: homeLate } = window.WizCore.appParts.home({ $, DOWL, gearBtn, live, LIVE, MON, refreshHome: (...a) => refreshHome(...a), sideCard, unsentCard });
  const refreshHome = force => { if (!desks[HOME].wins.length) { const g = secOf(HOME)?.querySelector('.glance'); if (g) paintHome(g, renderHome()); } };
  // Home repaints go through the skin host so a tweak's home-main mount survives (plain innerHTML without one).
  function paintHome(el, html) { if (window.WosSkinHost?.paintHome) window.WosSkinHost.paintHome(el, html); else el.innerHTML = html; }

  /* ---------------- empty desk, app cards, maps, frames ---------------- */
  /* ＋ after the last desk (James, 12 Oct 2026): jump straight to a new desk at the end of the strip. An empty desk
   * is a page of app tiles, not a pop-up: tap one and it opens right here. Leave without picking and the desk goes. */
  function newDesk() {
    const last = desks.length - 1;
    if (last > 0 && !desks[last].wins.length) return goDesk(last);
    foldOpen.agents = foldOpen.dev = false; desks.push(blank({})); syncDesks(); renderDots(); goDesk(desks.length - 1, true); // the empty desk titles itself; a label flash would cover its search pill
  }
  /* Swipe up on the orb opens Desks instead of Apps when a skin's CSS (or the owner's
   * My skin) sets `--wos-orb-swipe-up` on <html>: `desks` = the regular overview, `pill` = Miguel's pill panel (the skin
   * or My skin then carries the .ov-pill styling, as Miguel's skin.css does). */
  const orbUpVar = () => { try { return getComputedStyle(document.documentElement).getPropertyValue('--wos-orb-swipe-up').trim(); } catch (_) { return ''; } };
  const orbUpDesks = () => ['desks', 'pill'].includes(orbUpVar());
  /* App kinds (core/app-kinds.js, shared with the desktop selector): Apps, Agent apps, Agents, Connectors, system apps
   * first and ringed; every group ends with a "+ Get ..." tile for its App Store section, and Agents also has
   * "+ Build agents" (the Agents app, where agents are made and managed). */
  const AK = window.WosAppKinds;
  const { isSystem } = AK;
  const appKinds = () => AK.kinds(APPS, APP);
  const sysMark = html => html.replace('class="lapp', 'class="lapp lapp-sys').replace('<span class="nm">', '<span class="nm" title="System app">');
  const backTile = a => `<button class="lapp lapp-back${isSystem(a) ? ' lapp-sys' : ''}" data-appinfo="${esc(a.id)}" data-name="${esc(a.name)}" style="--i:${tileN++}">${ico('span', 'ic', a)}<span class="nm">${esc(a.name)}</span></button>`;
  const kindTile = a => a.url || a.kind !== 'wizard' ? (isSystem(a) ? sysMark(appTile(a)) : appTile(a)) : backTile(a);
  const plusTile = (attrs, label) => `<button class="lapp lapp-get" ${attrs}><span class="ic">+</span><span class="nm">${esc(label)}</span></button>`;
  const getTile = k => plusTile(`data-storekind="${AK.GET[k][0]}"`, AK.GET[k][1]);
  // System apps lead their group in the same grid; their purple tile (skin.css .lapp-sys) marks them, no label or box.
  function sysSplit(list, tile) { return AK.sysFirst(list).map(tile).join(''); }
  function kindGroups(order) {
    const K = appKinds();
    const grp = (k, body) => `<div class="lgroup kg-${k}"><h4>${AK.LABELS[k]}</h4><div class="lgrid">${body}${getTile(k)}</div></div>`;
    const G = {
      apps: grp('apps', sysSplit(K.apps, kindTile)),
      wiz: grp('wiz', sysSplit(K.wiz, backTile)),
      agents: grp('agents', sysSplit(K.agents, kindTile) + (K.builder ? plusTile('data-app="agents"', 'Build agents') : '')),
      conns: grp('conns', sysSplit(K.conns, kindTile)),
    };
    // Apps are for people; Agent apps, Agents and Connectors are mostly for agents: one "For agents" section,
    // folded by default (each open of the sheet or a New desk starts folded), tap the row to open it.
    const fa = order.filter(k => k !== 'apps' && G[k]);
    const n = (K.wiz.length + K.agents.length + K.conns.length);
    const fold = (key, label, count, body) => `<div class="forag fa-${key}${foldOpen[key] ? ' open' : ''}" data-fold="${key}"><button type="button" class="fa-row" data-fatoggle="${key}" aria-expanded="${!!foldOpen[key]}"><span>${label}</span><small>${count}</small><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><div class="fa-body">${body}</div></div>`;
    const dev = order.includes('apps') && K.dev.length ? fold('dev', 'In development', K.dev.length, `<div class="lgroup kg-dev"><h4>In development</h4><div class="lgrid">${K.dev.map(kindTile).join('')}</div></div>`) : '';
    const folded = fa.length ? fold('agents', 'For agents', n, fa.map(k => G[k]).join('')) : '';
    return (order.includes('apps') ? G.apps : '') + dev + folded;
  }
  // "+ Get ..." tiles open the App Store on that section (store.js reads ?kind=).
  function openStoreKind(kind) {
    closeSheets(); // not quiet: the Apps sheet must close even when it was opened without a tracked sheet
    const url = AK.storeUrl(kind), id = Object.keys(W).find(k => W[k].appId === 'app-store' && deskOf(k) >= 0);
    if (id) { const f = winEl(id)?.querySelector('iframe'); W[id].url = url; if (f) f.src = url; const t = deskOf(id); if (t !== idx) goDesk(t, true); focusWin(id); save(); return; }
    openWin({ app: 'frame', appId: 'app-store', url });
  }
  const foldOpen = { agents: false, dev: false };
  document.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('[data-fatoggle]'); if (!t) return;
    e.stopPropagation(); const key = t.dataset.fatoggle || 'agents'; foldOpen[key] = !foldOpen[key];
    document.querySelectorAll(`.forag[data-fold="${key}"]`).forEach(el => { el.classList.toggle('open', foldOpen[key]); el.querySelector('[data-fatoggle]')?.setAttribute('aria-expanded', String(foldOpen[key])); });
  }, true);
  // The tile was drawn as an agent app; the app may have gained its page since (ux#1646): decide at the tap.
  function openAppInfo(el, fromSheet) { AK.pageOrSheet(APP, el.dataset.appinfo, el.dataset.name || '', a => tapOpen(a, el, fromSheet)); }
  function renderEmpty(i) {
    // Miguel's app kinds are every skin's New desk (James, 23 Oct 2026): Apps with system apps first and ringed, then
    // Wizard apps, Agents and Connectors folded under "For agents".
    // Search apps (James, 23 Oct 2026): a pill at bottom centre, above the dock; typing filters every group in place
    // (For agents unfolds while a query is on), Enter opens the first match.
    tileN = 0; return `<div class="desk-scroll new-desk kinds"><div class="nd-head"><b>New desk</b><span>Pick an app to open here</span></div>${kindGroups(['apps', 'wiz', 'agents', 'conns'])}<p class="nd-none" hidden>No app matches</p></div><form class="nd-search" role="search" data-ndsearch><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input type="search" data-ndq placeholder="Search apps" aria-label="Search apps" autocomplete="off" enterkeyhint="go"></form>`;
  }
  /* frame: moved to app-frame.js (wizard-ux issue 1665), called once here */
  const { probeFrame, renderApp, renderFrame, selfPop, takeSelfPop, tameHistory, watchEarly } = window.WizCore.appParts.frame({ APP, esc, ico, winApp });
  // Closed means closed: an app with no window left on any desk stops its microphone (take saved for recovery).
  window.WizAppServices?.trackOpenApps?.(() => desks.flatMap(d => d.wins).map(id => W[id]).filter(Boolean).flatMap(w => [w.appId, w.servicesAs]));
  function watchFrames(root) {
    $$('[data-recovery]', root).forEach(el => window.WizReach.mountRecovery(el, W[el.closest('.win')?.dataset.win]?.url));
    $$('iframe.appframe', root).forEach(f => {
      // A sandboxed repair page (browser boundary) is never read: core/reach.js talks to it over the boundary channel.
      if (f.closest('[data-recovery]')) { if (!f._watched) { f._watched = true; f.addEventListener('load', () => { if (!f.hidden && !(window.WizBrowserBoundary?.owns(f) && f.hasAttribute('sandbox'))) bridgeFrame(f); }); } return; }
      if (f._watched) return; f._watched = true;
      // servicesAs: a companion view gets its owning installed app's Back/services.
      const w = W[f.closest('.win')?.dataset.win], a = w && APP[w.servicesAs || w.appId];
      if (a?.url) f._appDetach = window.WizAppServices?.attach(f, { appId: a.id, path: a.url, isFront: () => desks[idx].focus === w.id && desks[idx].wins.includes(w.id) && !sheet && !menuFor && !CHATS.isHosted(w.id) && !device.classList.contains('st-parked'), openThread: (sid, opts) => { const r = window.WosSkinHost?.routeOpen?.('thread', { sid, from: a.id }, () => { if (!CHATS.prepThread(sid, opts)) return false; closeSheets(true); openWizardThread(sid); return true; }); return r ? r.value === true : CHATS.openHosted(w.id, f, sid, opts); }, back: () => { if (desks[idx].focus !== w.id) return false; const did = backStep(w.id); if (did) { window.__backLog = (window.__backLog || []).concat('app-done:' + did).slice(-30); } return !!did; }, openContextDraft: (key, text) => { const go = () => { closeSheets(true); const cw = placeApp(mainChats, { app: 'chats', thread: null }, {}); if (!cw) throw new Error('Chats unavailable'); const receipt = CHATS.openContextDraft(cw.id, key, text); CHATS.renderChats(cw); return receipt; }; const r = window.WosSkinHost?.routeOpen?.('draft', { from: a.id }, go); if (r) { if (!r.value) throw new Error('Chats unavailable'); return r.value; } return go(); }, isVisible: () => desks[idx].wins.includes(w.id) && (!desks[idx].full || desks[idx].focus === w.id) && !sheet && !menuFor && !CHATS.isHosted(w.id) });
      watchEarly(f);
      const wrap = f.closest('.frame-wrap');
      if (f.dataset.probe) { wrap.classList.remove('loading'); wrap.classList.add('coming'); f.removeAttribute('src'); probeFrame(f, f.dataset.probe); }
      // The loading veil lifts when the app's page has loaded (or after 12 s, so a slow app is never hidden for good).
      const unveil = () => wrap?.classList.remove('loading'); setTimeout(unveil, 12000);
      f.addEventListener('load', () => {
        let ok = false, why = '';
        try { if (f.contentWindow.location.href !== 'about:blank') unveil(); } catch (e) { unveil(); }
        try { const doc = f.contentDocument; why = doc ? doc.location.href : 'nodoc'; ok = !!doc && doc.location.href !== 'about:blank'; } catch (e) { ok = false; why = 'x:' + e.name; }
        window.__frameLog = (window.__frameLog || []).concat(why).slice(-40); // bounded: the shell may run for weeks
        // Browser boundary: a sandboxed app is never readable, so unreadable is not refused. It talks by postMessage.
        if (window.WizBrowserBoundary?.enabled && f.hasAttribute('sandbox')) { wrap?.classList.remove('blocked'); return; }
        if (why === 'about:blank') {
          // A frame that had a real page and is back on blank was traversed by the Back key (cross-document, so no
          // popstate fires). That press belongs to the shell: take the step and restore the app in place.
          if (f._lastUrl) { const u = f._lastUrl; f._lastUrl = ''; onBack(); ensureGuard(true); try { window.WizAppServices?.expectLoad?.(f); f.contentWindow.location.replace(u); } catch (e) {} }
          return;
        }
        if (ok) { try { f._lastUrl = f.contentWindow.location.href; } catch (e) {} }
        wrap?.classList.toggle('blocked', !ok);
        if (ok) bridgeFrame(f);
        if (ok) { const sec = f.closest('.desk'); if (sec && sec.dataset.did !== desks[idx]?.id) frameSetHidden(f, true); } // opened or reloaded off-screen: park at once
        if (ok) { try { const id = f.closest('.win')?.dataset.win, w = W[id], t = (f.contentDocument.title || '').trim(); if (w && w.appId === 'link' && t && t !== w.title) { w.title = t.slice(0, 60); save(); applyLayout(deskOf(id)); renderDots(); } } catch (e) {} }
      });
    });
  }
  function bridgeFrame(f) {
    const id = f.closest('.win')?.dataset.win; if (!id) return;
    let win; try { win = f.contentWindow; } catch (e) { return; }
    try { if (LINKS && window.WizLinks?.guardFrame) window.WizLinks.guardFrame(win, (W[id] && (APP[W[id].appId]?.url || W[id].url)) || win.location.pathname, LINKS); } catch (e) {}
    try { if (W[id]) { const here = win.location.pathname + win.location.search + (W[id].appId === 'troubleshooter' ? win.location.hash : ''); const want = APP[W[id].appId]?.url || '';
      // Remember only pages inside this app (never the placeholder "/" or where it redirects), or a frame
      // painted before its app was known would stick on the wrong page for good.
      const home = (want.split(/[?#]/)[0] || '').replace(/[^/]*$/, '');
      if (home && home !== '/' && here.startsWith(home)) { W[id].url = here; save(); } } } catch (e) {}
    try { win.document.addEventListener('pointerdown', () => { focusWin(id); armBack(); }, true); } catch (e) {}
    // Hosted-app history is tamed; Back never becomes permission to leave Wizard.
    tameHistory(win);
    // A hosted app may push its own Back guard at boot (same URL) before the shell can tame it. Popping such an
    // entry is the user pressing Back: the shell takes that step and the app never sees it. Popping a real in-app
    // navigation (the URL changes) stays the app's own back step.
    try { win.__wosHref = win.location.href; } catch (e) {}
    try { win.addEventListener('popstate', e => {
      if (!f.isConnected || !W[id] || f.contentWindow !== win) return; // a removed preview owns no shell navigation
      if (win.WizardApp?.hosted && e.state?.__wizardApp?.version === 1) { takeSelfPop(win); return; }
      if (Date.now() < dropUntil) { e.stopImmediatePropagation(); ignorePop = 0; dropUntil = 0; return; } // the shell's guard drop landed here
      // The app (or the shell on its behalf) stepped back through the app's own entry: the app's step.
      if (takeSelfPop(win)) { try { win.__wosHref = win.location.href; } catch (x) {} return; }
      let same = false; try { same = win.location.href === win.__wosHref; win.__wosHref = win.location.href; } catch (x) {}
      // The app keeps its own back step only when it is the focused window on the desk in view, nothing is
      // open over it, and the pop really changed its page. Anything else (an app on another desk, a boot-time
      // guard, a stray hash entry) is the user's Back for the shell, so a Back is never silently swallowed.
      const wid = f.closest('.win')?.dataset.win;
      const mine = !same && wid && desks[idx]?.focus === wid && desks[idx].wins.includes(wid) && !sheet && !menuFor && V.state === 'idle' && !document.querySelector('.peek.open, .ov.open');
      if (mine) return;
      e.stopImmediatePropagation();
      guardOn = history.state?.wos === 'guard'; // the shell's own guard is still under the popped app entry
      onBack();
      ensureGuard(true);
    }, true); } catch (e) {}
    try { FIELDS?.bind(win.document); } catch (e) {}
    try { bindWinPinch(win.document, id); } catch (e) {}
    try { armFrameBack(f, win); } catch (e) {} // another origin (Troubleshooter's direct line) can't be read
    shareCutout();
    frameEdge(f); setTimeout(() => { if (f.isConnected) frameEdge(f); }, 800); // apps that paint their theme after boot
  }
  // Frame metadata never grants voice delivery. Installed capability + shared receiver own it.
  function frameNav(id) { try { return winEl(id)?.querySelector('iframe')?.contentWindow?.navigation || null; } catch (e) { return null; } }
  function frameHref(id) { try { const l = winEl(id)?.querySelector('iframe')?.contentWindow?.location; return l ? l.pathname + l.search : ''; } catch (e) { return ''; } }

  // A Chats window: the one on this desk, else any desk's (and go there).
  function chatsWinAny() {
    let wid = desks[idx].wins.find(x => mainChats(W[x])); if (wid) return wid;
    const d = desks.findIndex(dd => dd.wins.some(x => mainChats(W[x]))); if (d < 0) return '';
    goDesk(d, true); return desks[d].wins.find(x => mainChats(W[x]));
  }
  /* Open a real thread: in a Chats window on this desk, else any Chats window, else a new one here. */
  function openWizardThread(id, opts = {}) {
    if (!id) return;
    // Any agent's thread opens in the main Chats window, without changing its list Focus.
    const mine = x => mainChats(W[x]);
    let wid = desks[idx].wins.find(mine);
    if (!wid) { const d = desks.findIndex(dd => dd.wins.some(mine)); if (d >= 0) { wid = desks[d].wins.find(mine); goDesk(d, true); } }
    if (!wid) { const w = openWin({ app: 'chats', thread: null }, opts); if (!w) return; wid = w.id; }
    focusWin(wid); openChat(wid, id);
  }

  /* ---------------- window interactions ---------------- */
  // Focus follows the finger. Double-tap a title bar toggles full screen.
  let lastBarTap = { id: '', t: 0 };
  track.addEventListener('pointerdown', e => {
    const we = e.target.closest('.win'); if (we) focusWin(we.dataset.win);
  }, true);
  function ndFilter(input) {
    const nd = input.closest('.glance')?.querySelector('.new-desk'); if (!nd) return null;
    // Names first ("Wiza" finds the Wizard apps, not every app whose blurb says Wizard); descriptions only when no name fits.
    const n = norm(input.value); let first = null;
    const tiles = [...nd.querySelectorAll('.lapp')].map(t => { const a = APP[t.dataset.app || t.dataset.appinfo], nm = norm(t.querySelector('.nm')?.textContent);
      return { t, nm, byName: nm.split(' ').some(w => w.startsWith(n)) || nm.startsWith(n), byDesc: norm(a?.desc).includes(n) || nm.includes(n) }; });
    const named = tiles.some(x => x.byName);
    for (const x of tiles) {
      const hit = !n || (named ? x.byName : x.byDesc); x.t.hidden = !hit;
      if (hit && n && (!first || (x.nm.startsWith(n) && !first.s))) first = { t: x.t, s: x.nm.startsWith(n) };
    }
    for (const g of nd.querySelectorAll('.lgroup')) g.hidden = !!n && !g.querySelector('.lapp:not([hidden])');
    for (const fa of nd.querySelectorAll('.forag')) { fa.classList.toggle('searching', !!n); fa.hidden = !!n && !fa.querySelector('.lapp:not([hidden])'); }
    nd.querySelector('.nd-none').hidden = !n || !!first;
    nd.classList.toggle('nd-q', !!n);
    return first?.t || null;
  }
  track.addEventListener('input', e => { if (e.target.matches?.('[data-ndq]')) ndFilter(e.target); });
  track.addEventListener('submit', e => {
    const f = e.target.closest?.('[data-ndsearch]'); if (!f) return;
    e.preventDefault(); const inp = f.querySelector('[data-ndq]'); const t = ndFilter(inp); if (!t) return;
    inp.blur(); t.click();
  });
  track.addEventListener('click', e => {
    const say = e.target.closest('[data-say]'); if (say) return runUtterance(say.dataset.say, 'auto');
    const sk = e.target.closest('.new-desk [data-storekind]'); if (sk) return openStoreKind(sk.dataset.storekind);
    const info = e.target.closest('.new-desk [data-appinfo]'); if (info) return openAppInfo(info);
    const pick = e.target.closest('.new-desk [data-app]');
    if (pick) { tapOpen(APP[pick.dataset.app], pick); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'inbox') return openSheet('inbox');
    if (act === 'settings') return openSettings(false);
    if (act === 'unsent') return openSettings(true);
    if (act === 'ready') return openApp(APP.wizard);
    if (act === 'unread' || act === 'working') return openChatsFiltered(act, { card: true });
    if (act === 'side-button') return sideButtonTap(false);
    if (act === 'agents') return openApp(APP.agents);
    if (act === 'side-button-hide') { store.set('sideHidden', true); return refreshHome(true); }
    const we = e.target.closest('.win'); if (!we) return;
    const id = we.dataset.win, w = W[id]; if (!w) return;
    const wa = e.target.closest('[data-wact]')?.dataset.wact;
    if (wa === 'close') return closeWin(id);
    if (wa === 'pin') return pinWin(id);
    if (wa === 'detach') return detachBound(id);
    if (wa === 'reload') return reloadWin(id);
    if (wa === 'full') { const d = desks[deskOf(id)]; return setFull(id, !(d.full && d.focus === id)); }

    if (e.target.closest('.wbar')) {
      // Use the input timestamp, not handling time: a busy page (an app loading in
      // another tile) must not turn a quick double-tap into two single taps.
      const now = e.timeStamp || performance.now();
      if (lastBarTap.id === id && now - lastBarTap.t < 450) { lastBarTap = { id: '', t: 0 }; const d = desks[deskOf(id)]; return setFull(id, !(d.full && d.focus === id)); }
      lastBarTap = { id, t: now }; return;
    }
    if ((w.app === 'chats' || CHATS.isHosted(id)) && CHATS.click(e, id)) return;
  });
  track.addEventListener('dblclick', e => {
    const bar = e.target.closest('.wbar'); if (!bar || e.target.closest('[data-wact]')) return;
    const id = bar.closest('.win')?.dataset.win; if (!id || lastBarTap.t === -1) return;
    const d = desks[deskOf(id)]; if (!d) return;
    // The click handler may already have toggled on the second tap; only act if it did not.
    if (!(d.full && d.focus === id) && performance.now() - fullAt > 600) setFull(id, true);
  });
  CHATS.bind(track);

  /* Window actions live in the title bar; desk arrangement lives in the overview. */
  const menuEl = $('#wmenu');
  let menuFor = null;
  function closeMenu() { menuFor = null; menuEl?.classList.remove('open'); }

  /* Pinch a window: spread to fill the screen, pinch in to tile it again. */
  function bindWinPinch(root, fixedId) {
    if (root._wpinch) return; root._wpinch = true;
    let p = null;
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    root.addEventListener('touchstart', e => {
      if (e.touches.length !== 2) return;
      const t0 = e.touches[0].target, el = t0.closest ? t0 : t0.parentElement;
      const id = fixedId || el.closest('.win')?.dataset.win;
      if (!id) { if (el.closest('.desk')) p = { id: null, d0: dist(e.touches[0], e.touches[1]), s: 1 }; return; }
      // A framed app that zooms its own content (maps, photos, PDFs) opts out of the shell's pinch with
      // <meta name="wizard-os-pinch" content="app">; Back and the bottom-edge swipe still leave full screen.
      if (fixedId && pinchClaimed(fixedId)) return;
      p = { id, d0: dist(e.touches[0], e.touches[1]), s: 1 };
    }, { passive: true, capture: true });
    root.addEventListener('touchmove', e => {
      if (!p || e.touches.length !== 2) return;
      // Two fingers on a window belong to the shell: keep a scrolling list from eating the pinch.
      if (e.cancelable) e.preventDefault();
      p.s = dist(e.touches[0], e.touches[1]) / p.d0;
      const we = p.id && winEl(p.id); if (we) we.style.setProperty('--pinch', String(Math.max(.9, Math.min(1.06, 1 + (p.s - 1) * .25))));
    }, { passive: false, capture: true });
    const end = () => {
      if (!p) return; const q = p; p = null;
      if (!q.id) { if (q.s < .75) openOverview(); return; }
      const we = winEl(q.id); if (we) we.style.removeProperty('--pinch');
      const d = desks[deskOf(q.id)]; if (!d) return;
      if (q.s > 1.25 && !(d.full && d.focus === q.id)) setFull(q.id, true);
      else if (q.s < (device.classList.contains('immersive') ? .72 : .8) && d.full) setFull(q.id, false);
      else if (q.s < .75 && !d.full) openOverview(); // already zoomed out to the desk: one more pinch shows every desk
    };
    root.addEventListener('touchend', e => { if (p && e.touches.length < 2) end(); }, { capture: true });
    root.addEventListener('touchcancel', end, { capture: true });
  }
  bindWinPinch(track);
  function pinchClaimed(id) { try { return winEl(id)?.querySelector('iframe')?.contentDocument?.querySelector('meta[name="wizard-os-pinch"]')?.content === 'app'; } catch (e) { return false; } }

  /* Bottom edge in immersive full screen: swipe up from anywhere along it to leave full screen.
   * The window follows the finger (shrinks a touch), past ~56 px or a quick flick it returns to tiles. */
  const immEdge = document.createElement('div'); immEdge.id = 'immEdge'; immEdge.className = 'imm-edge';
  immEdge.innerHTML = '<i></i>'; immEdge.setAttribute('aria-hidden', 'true'); device.appendChild(immEdge);
  // A click listener makes the strip a real tap target, so the browser's touch adjustment never snaps an
  // edge touch onto the composer just above it.
  immEdge.addEventListener('click', e => e.preventDefault());
  immEdge.addEventListener('touchmove', e => { if (IE && e.cancelable) e.preventDefault(); }, { passive: false });
  let IE = null;
  const immWin = () => { const d = desks[idx]; return d && d.full && d.focus ? winEl(d.focus) : null; };
  immEdge.addEventListener('pointerdown', e => {
    if (!device.classList.contains('immersive')) return;
    e.preventDefault(); try { immEdge.setPointerCapture(e.pointerId); } catch (_) {}
    IE = { y: e.clientY, x: e.clientX, t: performance.now(), id: e.pointerId, dy: 0 };
  });
  immEdge.addEventListener('pointermove', e => {
    if (!IE || e.pointerId !== IE.id) return;
    IE.dy = Math.min(0, e.clientY - IE.y);
    const p = Math.min(1, -IE.dy / 160), we = immWin();
    if (we) { we.style.transition = 'none'; we.style.transform = `translateY(${IE.dy * .35}px) scale(${1 - p * .08})`; we.style.borderRadius = `${p * 22}px`; }
    immEdge.classList.toggle('pull', -IE.dy > 12);
  });
  const immEnd = e => {
    if (!IE || e.pointerId !== IE.id) return; const s = IE; IE = null;
    immEdge.classList.remove('pull');
    const we = immWin(); if (we) { we.style.transition = ''; we.style.transform = ''; we.style.borderRadius = ''; }
    const v = s.dy / ((performance.now() - s.t) || 1);
    if (e.type !== 'pointercancel' && (s.dy < -56 || (s.dy < -18 && v < -.45))) { const d = desks[idx]; if (d.full && d.focus) setFull(d.focus, false); }
  };
  immEdge.addEventListener('pointerup', immEnd); immEdge.addEventListener('pointercancel', immEnd);
  // The keyboard is up: the bottom edge belongs to the text field, not the shell.
  setInterval(() => {
    if (!immOn) return;
    let a = document.activeElement;
    try { if (a && a.tagName === 'IFRAME') a = a.contentDocument?.activeElement; } catch (e) {}
    device.classList.toggle('imm-typing', !!a && (/^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName) || a.isContentEditable));
  }, 400);

  /* ---------------- sheets ---------------- */
  const launcher = $('#launcher'), inboxEl = $('#inbox'), settingsEl = $('#settings');
  let sheet = null;
  const sheetOpen = () => !!sheet;
  /* Settings belongs to a desk (James, 21 Oct 2026): "the settings menu can stay open on the home screen; it
   * shouldn't block me from viewing my other desktops." A desk swipe (dock or orb) or a dot tap with Settings open
   * lifts it onto the desk it was opened on: it slides with that desk, the other desks are live and unblurred, and
   * landing back on that desk shows it again exactly as left (scroll kept). Opening Settings elsewhere moves it. */
  function liftSettings(deskId) {
    if (sheet !== 'settings') return;
    stDesk = deskId || (desks[idx] && desks[idx].id); sheet = null;
    device.classList.remove('sheet-open'); device.classList.add('st-parked');
    settingsEl.inert = true; settingsEl.setAttribute('aria-hidden', 'true');
    window.WosResources?.sync(); window.WosScenery?.update();
  }
  function dropParkedSettings() {
    stDesk = null; device.classList.remove('st-parked');
    settingsEl.inert = false; settingsEl.removeAttribute('aria-hidden');
    settingsEl.style.transition = ''; settingsEl.style.transform = ''; settingsEl.style.opacity = '';
  }
  function rideSettings(dx, anim) {
    const at = desks.findIndex(d => d.id === stDesk);
    if (at < 0) { settingsEl.classList.remove('open'); dropParkedSettings(); return; } // its (empty) desk went away
    const off = (at - idx) * (device.clientWidth || innerWidth) + dx;
    settingsEl.style.transition = anim ? 'transform 520ms var(--ease)' : 'none';
    settingsEl.style.transform = `translate3d(${off}px,0,0)`;
    // home again: Settings is the open sheet once more. Not while a bar scrub is live (wizard-ux#1516): the scrub snaps the
    // track on its start desk before it steps, and that snap must not re-open the Settings it just parked.
    if (at === idx && !dx && !sheet && !(DS && DS.live)) {
      dropParkedSettings(); if (anim) settingsEl.style.transition = 'transform 520ms var(--ease)';
      sheet = 'settings'; device.classList.add('sheet-open'); tourEv('sheet', { which: 'settings' }); // same handoff as openSheet
      window.WosResources?.sync(); window.WosScenery?.update();
    }
  }
  function openSheet(which, q) {
    // The pull-down notifications panel is retired (James, 18 Oct 2026): every way in (the Inbox tile, "open
    // inbox"/"notifications", the critical banner, the arrow key) opens Chats, whose Working and Ready
    // sections hold the same threads and which can stay open on a desk.
    if (which === 'inbox') return openChatsList();
    closeSheets(true); closeMenu();
    if (which === 'settings' && stDesk) dropParkedSettings(); // Settings opened on this desk moves here
    sheet = which; device.classList.add('sheet-open'); device.dataset.sheet = which; tourEv('sheet', { which });
    window.WosResources?.back(); window.WosResources?.sync();
    if (which === 'launcher') { foldOpen.agents = foldOpen.dev = false; renderLauncher(q || ''); launcher.classList.add('open'); const s = $('#search'); s.value = q || ''; window.WizCore.refreshApps?.({afterPending:true}); }
    else if (which === 'settings') { settingsFocus = document.activeElement; renderSettings(); settingsEl.classList.add('open'); $('#settingsBody').scrollTop = 0; settingsView?.focus(); }
    else { renderInbox(); inboxEl.classList.add('open'); }
    [launcher, inboxEl, settingsEl].forEach(el => { if (el === settingsEl && stDesk) return; el.style.transform = ''; el.style.opacity = ''; });
    window.WosScenery?.update(); // scenery hook: a sheet over Home freezes the background
    vib(6);
  }
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
  /* Swipe the grip down to close Settings, like every sheet (wizard-os#265 rule 7). Only the grip drags; the body scrolls. */
  { const grip = settingsEl.querySelector('.sheet-grip'); let y0 = null, dy = 0, t0 = 0;
    grip?.addEventListener('pointerdown', e => { if (sheet !== 'settings') return; y0 = e.clientY; dy = 0; t0 = performance.now(); settingsEl.style.transition = 'none'; try { grip.setPointerCapture(e.pointerId); } catch (_) {} });
    grip?.addEventListener('pointermove', e => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); settingsEl.style.transform = `translateY(${dy}px)`; });
    const end = () => { if (y0 == null) return; y0 = null; settingsEl.style.transition = ''; if (dy > 90 || dy / ((performance.now() - t0) || 1) > .6) closeSheets(); else settingsEl.style.transform = ''; };
    grip?.addEventListener('pointerup', end); grip?.addEventListener('pointercancel', end); }
  settingsEl.addEventListener('click', e => {
    if (e.target.closest('[data-stclose]')) return closeSheets();

  });

  function appTile(a) { return `<button class="lapp" data-app="${a.id}" style="--i:${tileN++}">${ico('span', 'ic', a, a.kind === 'native' ? '<span class="badge">APK</span>' : '')}<span class="nm">${esc(a.name)}</span></button>`; }
  function appRow(a, sel) { const k = a.kind === 'view' ? 'view' : a.kind === 'native' ? 'native' : 'app'; return `<button class="lrow ${sel ? 'sel' : ''}" data-app="${a.id}">${ico('span', 'ic', a)}<span class="nm">${esc(a.name)}<small>${esc(a.desc)}</small></span><span class="kind ${k}">${k === 'native' ? 'Android' : k === 'view' ? 'View' : 'Wizard'}</span></button>`; }
  // live: a background refresh (sessions poll, app list). It repaints only when the content changed and never
  // moves the scroll, so an open Apps sheet stays still instead of redrawing every 15 s (James, 10 Oct).
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
  // This desk's windows sit right above the search bar, nearest the thumb.
  function deskBar() {
    const d = desks[idx]; if (!d.wins.length) return '';
    const rows = d.wins.map(id => { const w = W[id], a = winApp(w), full = d.full && d.focus === id;
      return `<div class="dwin${id === d.focus ? ' on' : ''}">${ico('span', 'ic', a)}<span class="nm">${esc(winTitle(w))}</span>
        <span class="acts"><button data-dw="full" data-id="${id}">${full ? 'Tile' : 'Full'}</button>${idx > 0 ? `<button data-dw="left" data-id="${id}" aria-label="Move to desk ${idx}">←</button>` : ''}${idx < desks.length - 1 ? `<button data-dw="right" data-id="${id}" aria-label="Move to desk ${idx + 2}">→</button>` : ''}<button data-dw="close" data-id="${id}" aria-label="Close">✕</button></span></div>`; }).join('');
    return `<div class="deskbar"><div class="dh"><b>${esc(deskName(idx))}</b><span>${d.wins.length} window${d.wins.length === 1 ? '' : 's'}</span></div>${rows}</div>`;
  }
  window.addEventListener('wizard:apps', () => { if (sheet === 'launcher') renderLauncher($('#search').value, true); });
  $('#search').addEventListener('input', e => renderLauncher(e.target.value));
  $('#searchForm').addEventListener('submit', e => {
    e.preventDefault(); const q = $('#search').value.trim(); if (!q) return;
    const sel = $('#launcherBody .lrow.sel');
    if (sel?.dataset.app) { launch(APP[sel.dataset.app], sel); return; }
    closeSheets(); runUtterance(q, 'command', true);
  });
  function launch(a, el) { tapOpen(a, el, true); }
  // Arrange/download tweak: hold no longer opens Add to home screen on app lists (the Desks download button does).
  window.WizHomeScreenApps?.attach(launcher, id => APP[id], { available: () => overviewMode().appHold !== false });
  // Miguel's skins open apps from the New desk grid (swipe up shows Desks, not the Apps sheet): same long-press there.
  window.WizHomeScreenApps?.attach(track, id => APP[id], { available: () => overviewMode().appHold !== false, rows: '.new-desk [data-app]', live: row => !!row.closest('.new-desk') && row.getClientRects().length > 0 });
  launcher.addEventListener('click', e => {
    const sk = e.target.closest('[data-storekind]'); if (sk) return openStoreKind(sk.dataset.storekind);
    const a = e.target.closest('[data-app]'); if (a) return launch(APP[a.dataset.app], a);
    const bi = e.target.closest('[data-appinfo]'); if (bi) { closeSheets(); return openAppInfo(bi, true); }
    const t = e.target.closest('[data-thread]'); if (t) { closeSheets(); return openWizardThread(t.dataset.thread); }
    const dw = e.target.closest('[data-dw]');
    if (dw) {
      const id = dw.dataset.id, k = dw.dataset.dw, i = deskOf(id);
      if (k === 'close') { closeWin(id); renderLauncher(''); return; }
      closeSheets();
      if (k === 'full') { const d = desks[i]; setFull(id, !(d.full && d.focus === id)); }
      else if (k === 'left') moveWin(id, i - 1); else if (k === 'right') moveWin(id, i + 1);
      return;
    }
    const qs = e.target.closest('[data-qsearch]'); if (qs) { openSearch(qs.dataset.qsearch, qs.dataset.qtab); return; }
    const c = e.target.closest('[data-cmd]'); if (c) { closeSheets(); runUtterance(c.dataset.cmd, 'command', true); }
  });
  /* inbox: moved to app-inbox.js (wizard-ux issue 1665), called once here */
  const { refreshRecStrips, renderInbox, renderMoons } = window.WizCore.appParts.inbox({ $, ago, CHATS_APP, clip, closeSheets, emoOf, esc, inboxEl, live, LIVE, onUnsentChange, openWizardThread, OUTBOX, paintOrbBadge, toast, unsentAction, unsentAll, unsentRow, vib });
  homeLate({ renderMoons });
  function paintOrbBadge() {
    const N = window.WizCore.workspaceNav, n = desks[idx] ? N.deskCount(desks[idx], W, winApp) : 0;
    $('#orbBadge').textContent = n ? N.fmt(n, N.deskMore?.(desks[idx], W, winApp)) : ''; $('#orbBadge').hidden = !n;
  }
  addEventListener('wizard:app-counts', () => { renderDots(); paintOrbBadge(); });
  // One place reacts to live changes: reads anywhere, new replies, finished runs.
  if (LIVE) LIVE.onChange(() => {
    renderMoons(); refreshHome(); markVisibleThreadsSeen(); refreshRecStrips();
    if (sheet === 'inbox') renderInbox(); if (sheet === 'launcher') renderLauncher($('#search').value, true);
    for (const id of Object.keys(W)) {
      const w = W[id]; if (w.app !== 'chats' && !CHATS.isHosted(id)) continue;
      const el = track.querySelector(`[data-chats="${id}"]`); if (!el) continue;
      if (!w.thread) { if (!el.contains(document.activeElement) && !CHATS.holdList(id)) renderChatList(w, el); }
      else loadThread(w);
    }
    desks.forEach((_, i) => applyLayout(i));
  });
  // Open threads poll a little faster than the session list while Archimedes works.
  setInterval(() => {
    if (document.hidden) return;
    for (const id of desks[idx].wins) { const w = W[id]; if ((w?.app === 'chats' || CHATS.isHosted(id)) && w.thread && w.thread !== '__new__') loadThread(w); }
  }, 4000);

  /* ---------------- toast ---------------- */
  /* ↻ (window-refresh adapter): refresh the window in place, the same contract as desktop ⌥R. Chats refetches its
   * list and open thread, app frames reload where they are, built-in views remount. Nothing closes or moves. */
  function reloadWin(id) {
    const w = W[id], el = winEl(id); if (!w || !el) return;
    if (w.appId === 'troubleshooter') { el.querySelector('[data-recovery-check]')?.click(); window.WizReach?.reloadRepair(el.querySelector('iframe')); return; }
    if (w.app === 'chats' || CHATS.isHosted(id)) {
      window.WizCore.refreshApps?.();
      Promise.resolve(LIVE?.refresh?.()).catch(() => {}).then(() => {
        const cw = W[id]; if (!cw) return;
        if (cw.thread && cw.thread !== '__new__') loadThread(cw, true);
        else { const host = track.querySelector(`[data-chats="${id}"]`); if (host && host.querySelector('.ch-list')) renderChatList(cw, host); }
      });
      if (w.app === 'chats') return toast('↻', 'Refreshed', 900);
    }
    const f = el.querySelector('.wbody iframe');
    if (f) { try { f.contentWindow.location.reload(); } catch (e) { f.src = f.src; return toast('↻', 'Restarted', 1100); } }
    else { const fresh = makeWin(w); fresh.className = el.className; fresh.style.cssText = el.style.cssText; el.replaceWith(fresh); mountWin(w, fresh); applyLayout(deskOf(id)); }
    toast('↻', 'Refreshed', 900);
  }
  let toastT = 0;
  function toast(icon, text, ms = 2200) {
    const t = $('#toast'); delete t.dataset.opening; t.classList.remove('got-it'); t.innerHTML = `<span class="ti">${window.WizBrand.icon(icon)}</span><span>${text}</span>`; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  /* ---------------- voice ---------------- */
  const V = { state: 'idle', kind: 'auto', route: store.get('routeV', 0) >= 2 ? store.get('route', 'auto') : (store.set('routeV', 2), store.set('route', 'auto'), 'auto'), rec: null, stream: null, chunks: [], parts: [], ac: null, an: null, t0: 0, acc: 0, raf: 0, sim: false, stopAsked: false, cancelled: false, simText: '' };
  const voiceEl = $('#voice'), tx = $('#transcript');
  // Shared DOM seals also serve the desktop dictation bridge, without changing its key ownership.
  var FIELDS = window.WizCore.focusedField.create({
    frames: () => $$('iframe.appframe').filter(f => { const id = f.closest('.win')?.dataset.win; return !!W[id] && !!APP[W[id].appId]; }),
    admit: (c, el) => {
      const win = c.frame?.closest('.win') || el.closest('.win');
      if (win && (desks[idx]?.focus !== win.dataset.win || !desks[idx]?.wins.includes(win.dataset.win))) return false;
      if (c.frame && (sheet || device.classList.contains('ov-open'))) return false;
      return !!el.getClientRects().length;
    },
    controls: el => !!el?.closest?.('#orbWrap, .arc'),
    onChange: () => paintFieldOrb(),
  });
  $$('iframe.appframe').forEach(f => { try { FIELDS.bind(f.contentDocument); } catch (_) {} });
  function paintFieldOrb() {
    const field = FIELDS?.current;
    const dictating = V.kind === 'dictation' && V.state !== 'idle';
    device.classList.toggle('field-dictation', !!field || dictating);
    device.classList.toggle('dictation-recording', dictating);
    $('#dictationStatus').textContent = dictating && V.state === 'think' ? 'Transcribing…' : '';
    if (V.state === 'idle') Orb.setMode(field ? 'type' : 'idle');
    else if (dictating && V.state === 'listen') Orb.setMode('typing');
    $('#orbWrap').setAttribute('aria-label', dictating ? 'Stop dictation and insert text' : field ? 'Dictate into focused text field' : 'Talk to Wizard');
    const w = W[desks[idx]?.focus];
    const corner = !!desks[idx]?.full && (w?.app === 'chats' || !!field || dictating);
    device.classList.toggle('orb-corner', corner);
    if (w?.app !== 'chats') trackCornerLift(false);
    // Field refresh can run after recording starts; keep its destination accessible.
    if (document.getElementById('generalVoice')) paintVoiceDestination();
  }
  /* dictation: moved to app-dictation.js (wizard-ux issue 1665), called once here */
  const { DEV, dictationTake, keepAwake, nativeBlob, nativeFinish, nativeResume, nativeTakeAppOwned, pauseNativeTake, recDone, reportVoice, startOrbVoice, voiceElapsed, voiceRecovery, voiceTake, bindLate: dictationLate } = window.WizCore.appParts.dictation({ $, cancelVoice, CHATS, FIELDS, finishVoice, generalVoiceSnap, onRecStop, OUTBOX, replyTake, sendSnap, startVoice, tick, toast, txHide, V });
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
  async function returnMeeting(detail) {
    const loan=V.meetingLoan;if(!loan)return;
    try{await window.WosOrbHandoff.end(loan,detail);V.meetingLoan=null;}
    catch(e){toast('!', 'Meeting remains paused · '+e.message,4000);}
  }
  async function parkReply() {
    if(parking||parkedReply||V.state!=='paused'||!V.replyTo)throw Error('Reply is not ready to borrow');
    parking=true;
    try{
      if(V.files.some(f=>f.uploading)||CHATS.composerBusy(V.replyTo.wid,V.replyTo.sid))throw Error('Wait for attachments before borrowing');
      V.snap ||= sendSnap();if(!(V.snap.route?.model&&V.snap.route?.provider))V.snap.route=CHATS.modelRoute(V.replyTo.wid,V.replyTo.sid,V.replyTo.box||undefined);
      if(!(V.snap.route?.model&&V.snap.route?.provider)){V.snap.route=null;throw Error('Choose a model before parking the reply');}
      let parkedNativeId=null;
      if(V.native){const id=V.native;voiceRecovery(id,{kind:V.kind,ms:V.acc});const dev=DEV();if(dev.fetch&&!dev.fetched(id))await dev.fetch(id);const meta=JSON.parse(dev.recStop(id)||'null');if(!meta?.id)throw Error('Native reply is still held');V.parts.push(nativeBlob(id,meta.bytes));V.native=null;V.resumeNative=true;parkedNativeId=id;}
      if(V.rec && V.rec.state!=='inactive')await new Promise(resolve=>{V.rec.onstop=resolve;V.rec.stop();});
      if(V.chunks.length)V.parts.push(new Blob(V.chunks,{type:V.mime}));V.chunks=[];stopStream();V.rec=null;
      if(!V.seal){const seal=CHATS.takeComposer(V.replyTo.wid,V.replyTo.sid,V.replyTo.box);V.seal=seal.text||seal.files.length||seal.reply?seal:null;}
      const draft={replyTo:{...V.replyTo},snap:structuredClone(V.snap),acc:V.acc,files:V.files.map(f=>({...f})),typed:V.seal?.text||'',sealFiles:V.seal?.files||[],sealReply:V.seal?.reply||null,parts:V.parts.slice(),kind:V.kind,resumeNative:!!V.resumeNative};
      const it=await OUTBOX.stage({captureId:V.custodyCapture,nativeId:parkedNativeId,audio:new Blob(V.parts,{type:V.parts[0]?.type}),kind:'reply',sessionId:V.replyTo.sid,...V.snap.route,parkedDraft:draft});
      await OUTBOX.transition(it.id,'held','Reply paused · return to resume or send');
      if(!it.durable)throw Error('Device save failed · reply retained here; microphone not borrowed');
      if(parkedNativeId)recDone(parkedNativeId); // exact original bytes now have durable parked custody
      V.custodyCapture=it.id;
      parkedReply={...V,parts:V.parts.slice(),chunks:[],files:V.files.slice(),rec:null,stream:null,ac:null,an:null,native:null};
      cancelAnimationFrame(V.raf);setVoice('idle');
      txPill('⏸','Reply paused · '+V.replyTo.sid,'agent');
    }finally{parking=false;}
  }
  function restoreReply() {
    if(!parkedReply)return false;
    const epoch=(V.captureEpoch||0)+1,saved=parkedReply;parkedReply=null;
    Object.assign(V,saved,{captureEpoch:epoch,stopAsked:true,sendAsked:false,cancelled:false,dictationOp:null,field:null,meetingLoan:null});
    cancelAnimationFrame(V.raf);clearTimeout(txHideT);setVoice('paused');renderVoiceFiles();tick();
    $('#arcPause small').textContent='Resume';$('#arcPause').setAttribute('aria-label','Resume paused reply');
    txPill('⏸','Reply paused · '+(LIVE.session(V.replyTo.sid)?.title||V.replyTo.sid),'agent',V.snap?.route?.model||'');
    $('#orbWrap').setAttribute('aria-label','Resume paused reply to '+V.replyTo.sid);
    return true;
  }
  async function recoverParkedReply(id) {
    if(V.state!=='idle'||parkedReply)return false;
    const item=OUTBOX.get(id),d=item?.parkedDraft;if(!d||!item.audio||item.state!=='held')return false;
    parkedReply={...V,...d,parts:d.parts||[item.audio],chunks:[],rec:null,native:null,custodyCapture:id,
      seal:{text:d.typed||'',files:d.sealFiles||[],reply:d.sealReply||null,done:()=>{},putBack:()=>{}},target:null};
    return restoreReply();
  }
  function recordReply(wid, sid) {
    if (V.state === 'think') return 'busy';
    if (V.state === 'listen' || V.state === 'paused') {
      // Tapping a composer mic while a voice reply records sends it, always to the thread it was started in.
      if (V.replyTo) { shock(); finishVoice(); return 'sent'; }
      return 'busy';
    }
    // A second mic tap while a meeting is lending its microphone sends this reply as soon as the take opens, like the orb.
    if (V.admitting) { if (V.admitReply) { V.admitSend = true; return 'sent'; } return 'busy'; }
    if (V.state !== 'idle' || !sid) return 'busy';
    // One recorder pathway (James, 18 Oct 2026: "the orb works … shouldn't the microphone button be triggering the same
    // pathway"): startVoice owns admission, so a Mizel meeting lends its microphone to the composer mic exactly as it
    // does to the orb, and the reply pin is set before the take opens (it survives the asynchronous loan).
    startVoice('auto', { replyTo: { wid, sid, steerRunId: CHATS.isWorking(LIVE.session(sid)) ? LIVE.session(sid)?.runId || '' : '', ...(sid === '__new__' ? { box: CHATS.chanBox?.(wid) || '', ...(typeof CHATS.chanSpaceOf?.(W[wid]) === 'string' ? { space: CHATS.chanSpaceOf(W[wid]) } : {}) } : {}) } });
    // No pill (James, 10 Oct 2026: "a giant pillbox pops up and covers my orb … I know I'm replying. The orb
    // animates."): the lit mic, the orb and its timer already say a reply is recording.
    return 'recording';
  }
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
  /* mic: moved to app-mic.js (wizard-ux issue 1665), called once here */
  const { browserBarInset, dropWarm, MIC_OPEN_TIMEOUT_MS, MIC_WARM_MS, micNeverOpened, openRec, stopStream, warmMic, bindLate: micLate } = window.WizCore.appParts.mic({ $, cancelVoice, DEV, device, onRecStop, orbLevel, OUTBOX, returnMeeting, runUtterance, setVoice, toast, tourEv, V });
  /* Send and go for the orb (James, 10 Oct 2026: "it sits at this screen for like 10 seconds… process this in the
   * background, send them back out… allow them to keep using their phone"). The send tap steps a phone thread
   * back to the list at once, like a typed send; transcription, routing and delivery carry on behind the pill
   * above the orb. The snapshot already pins the destination, so leaving can't move the message.
   * Stays put for a hold-command, an aimed desk, a composer-mic reply (already instant), or a composer tray with
   * files (those ride with the words when they land in the thread). */
  function leaveOnSend(snap) {
    const v = snap?.view;
    if (V.kind === 'command' || V.replyTo || V.target != null || v?.kind !== 'chat thread') return false;
    const w = W[v.id]; if (!w || w.thread !== v.thread) return false;
    // The composer (words, photos, files) was taken at this tap (V.seal) and rides with the take.
    CHATS.saveDraft(v.id);
    if (!CHATS.leaveAfterSend(v.id, v.thread, v.thread === '__new__', 'voice')) return false;
    // ...and the thread is under Working before the list paints, never in Ready (live.js holdSend).
    V.hold = LIVE.holdSend?.(v.thread) || null;
    CHATS.renderChats(w); applyLayout(deskOf(v.id));
    return true;
  }
  // The thread a take is sent into (and whose composer rides with it): a composer-mic take's pinned thread, or the
  // thread open when an orb take started. A held command, or a take aimed at another desk, has none.
  function sealTarget() {
    if (V.replyTo) return { wid: V.replyTo.wid, sid: V.replyTo.sid, box: V.replyTo.box };
    const v = V.snap?.view;
    return V.kind !== 'command' && V.target == null && v?.kind === 'chat thread' && v.thread && W[v.id] ? { wid: v.id, sid: v.thread, box: v.box } : null;
  }
  /* voicesend: moved to app-voicesend.js (wizard-ux issue 1665), called once here */
  const { dropHold, finishDictation, pauseCommandCapture, recoverDictation, saveVoiceRoute, sendTapRoute, unseal } = window.WizCore.appParts.voicesend({ CHATS, LIVE, nativeFinish, nativeResume, nativeTakeAppOwned, onRecStop, pauseNativeTake, setVoice, txHide, txPill, V });
  dictationLate({ dropHold, pauseCommandCapture, saveVoiceRoute, sendTapRoute, unseal });
  micLate({ pauseCommandCapture });
  function showDictationCopy(text, durable = true, native = false) {
    txShow(text, durable || native ? 'Dictation saved · field changed · nothing sent' : 'Storage unavailable · copy these words before closing', 'dictation', '✎');
    $('#txChips').innerHTML = '<button data-dictation-copy>Copy text</button>';
    $('#txChips [data-dictation-copy]').addEventListener('click', async () => {
      try { if (DEV()?.clip) DEV().clip(text); else await window.WosChat.copyText(text); }
      catch (_) { toast('!', 'Select and copy the saved text'); }
    });
    txHide(0); // keep copy available; Settings retains the same transcript across reloads
    clearTimeout(txHideT); voiceEl.classList.add('tx');
  }
  /* transcribe: moved to app-transcribe.js (wizard-ux issue 1665), called once here */
  const { QUICK_MS, quickTake, transcribeDictation } = window.WizCore.appParts.transcribe({ FIELDS, OUTBOX, recDone, setVoice, showDictationCopy, toast, txHide, V });
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
  // The tap that starts recording must not also press an arc button: the arc fans out from under the finger, so the
  // same tap's click lands on it (Attach is on top, so the file picker opened). A fixed time window failed on a busy
  // phone, where that click arrives late (James, 23 Oct 2026). An arc button now takes a pointer click only when the
  // press also started on it; keyboard and programmatic clicks (detail 0) are untouched.
  let arcPress = null;
  window.addEventListener('pointerdown', e => { arcPress = e.target?.closest?.('.arc') || null; }, true);
  $('#voice').addEventListener('click', e => {
    const arc = e.target.closest('.arc'); if (!arc) return;
    const pressed = arcPress === arc; arcPress = null;
    if (e.detail > 0 && !pressed) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  $('#arcCancel').addEventListener('click', () => cancelVoice());
  $('#arcPause').addEventListener('click', () => {
    if(parking)return;
    if(V.state==='paused' && window.WizAppCapture?.getState?.().recording && !V.meetingLoan){toast('🎙','Microphone held by another recording · reply remains paused');return;}
    if (V.state === 'listen' || V.state === 'command') { V.stopAsked = true; V.sendAsked = false; V.acc += performance.now() - V.t0; try { window.WosCaptureTools.setPaused(V.rec,true); } catch (e) {} if (V.native) pauseNativeTake(true); setVoice('paused'); vib(6); }
    else if (V.state === 'paused' && !V.native && !V.rec && V.parts.length) {
      if(V.resumeNative && DEV()){
        const id=DEV().recStart(V.kind)||'';
        if(!id){toast('!','Could not resume · original reply remains paused');return;}
        V.nativeSegmentBase=V.acc;V.native=id;voiceTake(id,V.kind);replyTake(id,{...V.replyTo,custodyId:V.custodyCapture});if(V.snap?.route)saveVoiceRoute(id,V.snap.route);
        V.stopAsked=false;V.sendAsked=false;V.t0=performance.now();setVoice('listen');V.raf=requestAnimationFrame(tick);vib(6);return;
      }
      V.stopAsked = false; V.sendAsked = false;   // after a mic interruption: carry on with a fresh part
      V.t0 = performance.now(); setVoice('listen'); V.raf = requestAnimationFrame(tick); vib(6);
      openRec().catch(() => { V.acc += performance.now() - V.t0; V.resumeBlocked = true; setVoice('paused'); toast('⏸', 'The mic is busy · tap the orb to send what you have'); });
    }
    else if (V.state === 'paused') { V.stopAsked = false; V.sendAsked = false; V.t0 = performance.now(); try { window.WosCaptureTools.setPaused(V.rec,false); } catch (e) {} if (V.native) pauseNativeTake(false); setVoice('listen'); V.raf = requestAnimationFrame(tick); vib(6); }
  });
  // The file picker is a separate screen on Android: pause the take while it is open, resume on return.
  $('#arcAttach').addEventListener('click', () => {
    if (V.state !== 'listen' && V.state !== 'paused') return;
    const failed=V.files.filter(f=>f.error&&f.local);if(failed.length){for(const f of failed)uploadVoiceFile(f.local,V.files,f);return;}
    if (V.state === 'listen') { $('#arcPause').click(); V.pickPaused = true; }
    // Android app: the same Camera / Photo or video / File menu as the chat composer (ux#1634).
    if (window.WosContextMenu?.attach) window.WosContextMenu.attach(voicePicker, $('#arcAttach'), { label: 'Attach to this take', onCancel: pickerBack });
    else voicePicker.click();
  });
  const pickerBack = () => { if (!V.pickPaused) return; V.pickPaused = false; if (V.state === 'paused') $('#arcPause').click(); };
  voicePicker.addEventListener('change', pickerBack); voicePicker.addEventListener('cancel', pickerBack);

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
  /* ---------------- view-aware voice ----------------
   * The orb always knows which window is in front. A view can
   *  - capture: everything said with a tap goes to that view (hold still forces a command);
   *  - auto: a tap goes to the open thread or to Archimedes, never through command routing;
   *  - say nothing: the utterance goes to Archimedes, who is told what was on screen.
   * Chats threads are auto. Framed apps require the installed receives_voice_input capability
   * and the shared WizardApp.voiceInput receiver; app-authored meta tags grant nothing. */
  function viewOf(id) {
    const w = W[id]; if (!w) return null;
    // A channel's feed in front (wizard/chat-channels, wizard-ux issue 1258): a tap take starts a new chat in that
    // channel, exactly like its message box (whose words and pictures ride with it), pinned to that channel's Space,
    // and the window stays on the feed. A routed agent's channel keeps that agent's own voice path (below).
    const chan = w.app === 'chats' && !w.thread ? CHATS.chanOpen?.(w) : null, pin = chan ? { kind: 'chat thread', thread: '__new__', channel: chan.name, space: chan.general ? '' : chan.id, box: CHATS.chanBox?.(id) || '', chanAgent: CHATS.winAgent(w) || '' } : {};
    if (agentWin(w) || (w.app === 'chats' && (!w.thread || w.thread === '__new__') && CHATS.winAgent(w))) {
      // A Focus list/draft has the same destination as the former per-agent window. Existing threads keep theirs.
      const a = agentApp({ ...w, agent: CHATS.winAgent(w) || w.agent });
      return { id, mode: 'auto', kind: w.thread ? 'chat thread' : w.agent ? 'agent chats' : 'thread list', thread: w.thread || '', agent: a.agent, agentLabel: a.name, private: a.private,
        name: a.private ? `${a.name} chats (private agent)` : w.thread ? `${a.name} thread “${winTitle(w)}”` : `${a.name} chats`, ...pin };
    }
    // Issue 1523: the channel by its emoji and words ("🚀 Launch channel"), as the Chats list shows it.
    if (chan) return { id, mode: 'auto', ...pin, name: `${window.WizCore?.channelFace?.(chan.name, !!chan.general)?.title || '# ' + chan.name} channel` };
    // Unified Chats: a private agent's thread open in the main Chats is named like its own Chats, never by title.
    if (w.app === 'chats' && w.thread && LIVE?.isPrivate?.(w.thread)) { const ag = window.WosAgents?.get(LIVE.agentOf(w.thread)) || { id: LIVE.agentOf(w.thread), label: 'Private' };
      return { id, mode: 'auto', kind: 'chat thread', thread: w.thread, agent: ag.id, agentLabel: ag.label, private: true, name: `${ag.label} thread (private agent)` }; }
    // A new chat on a Private model in the main Chats: what is said here goes to that agent (never the router).
    if (mainChats(w) && w.thread === '__new__') { const nm = CHATS.ch?.(id)?.newModel, AGx = window.WosAgents, ag = nm?.agent && AGx?.isOther(nm.agent) ? AGx.get(nm.agent) : null;
      if (ag && AGx.isPrivate(ag)) return { id, mode: 'auto', kind: 'chat thread', thread: '__new__', agent: ag.id, agentLabel: ag.label, private: true, name: `New ${ag.label} chat (private agent)` }; }
    if ((w.app === 'chats' || CHATS.isHosted(id)) && w.thread) return { id, mode: 'auto', kind: 'chat thread', thread: w.thread, name: w.thread === '__new__' ? 'New chat' : `Chats thread “${winTitle(w)}”` };
    if (w.app === 'frame' && w.from && w.from.sid) return { id, mode: '', kind: 'review', review: true, thread: w.from.sid, threadTitle: w.from.title || '', name: `Review of ${winTitle(w)}`, url: frameHref(id) || w.url };
    if (w.app === 'frame') return { id, mode: '', kind: 'app', name: winApp(w).name, url: frameHref(id) || winApp(w).url };
    if (w.app === 'chats') return { id, mode: '', kind: 'thread list', name: 'Chats' };
    return { id, mode: '', kind: 'app', name: winTitle(w) };
  }
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
  function viewContext(id, how = 'voice', snap = null) {
    if(snap?.meetingEventId)return ''; // explicit request only: no recording title, notes, transcript or screen
    const S = snap || sendSnap(id), v = S.view, others = S.others;
    const z = v?.z ? ` at ${v.z.level} level${v.z.day ? ` (${v.z.day})` : v.z.week ? ` (week of ${v.z.week})` : ''}` : '';
    return [
      `[WizardOS context] ${window.WizConfig.owner() || 'The user'} sent this by ${how} from Wizard UX on their phone.`,
      v ? `Window in front: ${v.name} (${v.kind}${v.url ? `, ${v.url}` : ''})${z}.` : `They were on desk ${S.desk + 1} with no window open.`,
      S.screen ? `Visible on screen: ${S.screen}` : '',
      others.length ? `Also open on this desk: ${others.join(', ')}.` : '',
      'When they say "this", "here", or "it", they likely mean that window. Use this as background only.',
    ].filter(Boolean).join(' ');
  }
  // Review mode: what James says about the page goes to the thread that linked it, sent through a Chats window.
  function reviewSink(v) {
    const src = W[W[v.id]?.from?.win]; if (src && src.app === 'chats') return src.id;
    return Object.keys(W).find(k => mainChats(W[k])) || '';
  }
  function reviewContext(v) {
    return [`[WizardOS context] ${window.WizConfig.owner() || 'The user'} sent this by voice from Wizard UX on their phone while reviewing a page this thread linked.`,
      `Page under review: ${v.name.replace(/^Review of /, '')} (${v.url}).`,
      (s => s ? `Visible on screen: ${s}` : '')(window.WizScreen?.read(winEl(v.id)) || ''),
      'Treat the message as feedback on that page; "this", "here" and "it" mean that page.'].filter(Boolean).join(' ');
  }
  async function sendReview(v, text, audio, files = [], route = null, custodyId = null) {
    try { route ||= window.WosModels.snapshot(v.thread); }
    catch (e) {
      const it = custodyId ? OUTBOX.get(custodyId) : await OUTBOX.stage({ kind: 'reply', sessionId: v.thread, text, audio, files });
      if (it) await OUTBOX.transition(it.id, 'held', 'Feedback route unavailable · original kept');
      setVoice('idle'); toast('!', 'Feedback kept for its original thread · model route unavailable', 3200);
      return it || { outcome: 'retained' };
    }
    window.__ovLog = (window.__ovLog || []).concat('review-send:' + v.thread).slice(-30);
    return window.WosBoundView.feedback(OUTBOX, { thread: v.thread, url: v.url, route, custodyId, context: reviewContext(v) }, text, audio, files);
  }
  // A take started in front of a channel (wizard/chat-channels) is filed into that channel, wherever James is by Send.
  const pinSpace = v => typeof v?.space === 'string' && v.thread === '__new__' ? { space: v.space } : {};
  function deliverToView(v, text, snap) {
    if (v.review) return sendReview(v, text, snap?.audio || null, [], snap?.route, snap?.custodyId);
    const w = W[v.id]; if (!w) return false;
    // The thread that was open when James sent, even if the window shows another one by now.
    if ((w.app === 'chats' || v.kind === 'chat thread') && (v.thread || w.thread)) { return sendChat(v.id, text, 'voice, aimed at this thread', snap?.audio || null, { custodyId: snap?.custodyId, sid: v.thread || w.thread, route: snap?.route, seal: snap?.seal || false, ...pinSpace(v), instructions: viewContext(v.id, 'voice, aimed at this thread', snap) }); }
    // No unacknowledged postMessage delivery to arbitrary/self-asserted frames.
    return false;
  }

  /* ---------------- routing ---------------- */
  /* On the Chats list, only a held orb can filter and search it:
   *   clear filter | all chats | show everything      → chips off
   *   filter [by] X | only X | show [me] [only] X [only] → chip X (status or subject), else search X
   *   search [for] X | find X                          → search text
   * A held orb with any other words on the list keeps doing what it always did (open apps, etc.). */
  const LOCAL_COMMANDS = window.WosCommands.create({ CHATS, APP, appByName, findApp, quickSearch, sendSnap });
  const localParse = (text, snap, kind, typed = false) => LOCAL_COMMANDS.parse(text, snap, kind, typed);
  async function handleText(text, kind, typed, sttMs, target, snap) {
    const sttNote = sttMs ? ` · heard in ${sttMs} ms` : '';
    snap = snap || sendSnap();
    if (snap.general) return toAgent(text, 'To ' + snapAgentName(snap), { snap, files: typed ? [] : takeFiles() });
    if (snap.conversation && kind !== 'command' && target == null) {
      const it = await OUTBOX.sendConversation({ conversation: snap.conversation, text, audio: snap.audio || null, files: typed ? [] : takeFiles(), source: 'orb' });
      setVoice('idle'); txHide();
      toast(it.state === 'sent' ? '✦' : '!', it.state === 'sent' ? 'Sent to ' + snap.conversation.label : it.error, 5000);
      return it;
    }
    // Quick take (under QUICK_MS): try it as a command first (on-device grammar, then the router off-thread).
    // No match: it continues below as an ordinary tap take, so nothing short is ever lost.
    if (kind === 'quick') {
      const qo = target == null ? { snap } : { desk: target, snap };
      const loc = localParse(text, snap, 'command');
      if (loc) { snap.quickRan = true; showRouted('command', `Quick command · on-device${sttNote}`); return finishCmd(loc, text, qo); }
      if (window.WosTour?.isHelp(text) && snap.view?.kind !== 'chat thread') { snap.quickRan = true; setVoice('idle'); txHide(0); return window.WosTour.openHelp(); }
      const routeUrl = snap.view?.kind !== 'chat thread' && window.WizConfig.endpoint('route');
      // A take marked as a possible background task (wizard/agent-inbox, issue 1588) asks for it in this one call.
      const dumpAsk = OUTBOX.get?.(snap.custodyId)?.dump === true;
      if (routeUrl) try {
        setVoice('think'); if (isPill()) tx.dataset.detail = 'Quick command? · routing'; else $('#txRouteText').textContent = 'Quick command? · routing';
        const r = await fetch(routeUrl, { method: 'POST', signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, force: '', view: null, apps: APPS.filter(a => a.kind !== 'view').map(a => a.name), ...(dumpAsk ? { accept_dump: true } : {}) }) });
        const j = await r.json(); const c = r.ok && j.cmd || {};
        if (dumpAsk && r.ok) snap.dumpAsked = true; // answered: the outbox never asks again
        if (dumpAsk && c.route === 'dump' && c.record_id) { setVoice('idle'); txHide(0); gotIt(c.title); return { outcome: 'local' }; }
        if (c.route === 'command' && !c.then_agent) { snap.quickRan = true; showRouted('command', `Quick command · ${j.ms} ms${sttNote}`); return finishCmd(c, text, qo); }
      } catch (_) {}
      kind = 'auto';
    }
    // A bare "help" is not special in a tapped voice message.
    if (!window.WosCommands.isMessageTake(kind, typed) && window.WosTour?.isHelp(text) && (kind === 'command' || snap.view?.kind !== 'chat thread')) { setVoice('idle'); txHide(0); return window.WosTour.openHelp(); }
    const opts = target == null ? { snap } : { desk: target, snap };
    $('#txText').textContent = text;
    const v = snap.view;
    /* Agents MVP: in an agent's Chats, a tap utterance goes to that agent (its open thread, else a new chat with
     * it), never to the main agent and never through the cloud router. A held orb is still a phone command, but
     * only on-device commands run; anything else offers the choices and sends nothing. */
    if (v?.agent && target == null) {
      if (kind === 'command' && !typed) { const lc = await LOCAL_COMMANDS.confirm(localParse(text, snap, kind), text, snap, kind); if (lc) { showRouted('command', `Command · on-device${sttNote}`); return finishCmd(lc, text, opts); } return holdNoMatch(text, opts); }
      const files = typed ? [] : takeFiles(), seal = typed ? null : snap.seal || null;
      setVoice('idle'); txPill('✦', `To ${v.agentLabel}${v.thread && v.thread !== '__new__' ? ' · this thread' : ' · new chat'}${sttNote}`, 'agent'); txHide(1400);
      return sendChat(v.id, text, `voice, in ${v.agentLabel}’s chats`, snap.audio || null, { custodyId: snap.custodyId, sid: v.thread || '__new__', route: snap.route, files, seal: seal || false, ...pinSpace(v), instructions: viewContext(v.id, `voice, in ${v.agentLabel}’s chats`, snap) });
    }
    // Attached files mean "look at this": skip command routing and send words + files together. So do words,
    // photos or files waiting in the thread's composer (snap.seal): one message, never a command.
    const files = typed ? [] : takeFiles();
    const seal = typed ? null : snap.seal || null;
    if (files.length || seal) {
      const nf = files.length + (seal ? seal.files.length : 0);
      const with_ = [seal?.text.trim() ? 'your text' : '', nf ? (nf === 1 ? '1 file' : `${nf} files`) : '', seal?.reply ? 'the notification' : ''].filter(Boolean).join(' + ');
      if (target == null && v?.review) { setVoice('idle'); txPill('✦', 'Feedback waiting to send with ' + (files.length === 1 ? '1 file' : `${files.length} files`), 'agent'); txHide(1400); return sendReview(v, text, snap.audio || null, files, snap.route, snap.custodyId); }
      if (target == null && v?.kind === 'chat thread' && W[v.id]) { setVoice('idle'); txPill('✦', 'Waiting to send with ' + with_, 'agent'); txHide(1400); return sendChat(v.id, text, 'voice, aimed at this thread', snap.audio || null, { custodyId: snap.custodyId, sid: v.thread, route: snap.route, files, seal: seal || false, ...pinSpace(v), instructions: viewContext(v.id, 'voice, aimed at this thread', snap) }); }
      const all = withSealFiles(files, seal);
      return toAgent(CHATS.joinWords(seal?.text, text), `To ${window.WizConfig.agent()} · with ${with_}` + sttNote, { ...opts, files: all, reply: seal?.reply || null }).then(item => { seal?.done(item); return item; });
    }
    // Registered app delivery and composer custody above are not commands. All other tap takes
    // use the normal message destination, without local parsing, cloud routing or no-match cards.
    if (window.WosCommands.isMessageTake(kind, typed)) {
      // A tapped take whose first word is a declared app route ("music") opens that app, outside threads, before
      // anything goes to the agent (James, 7 Nov: a tapped "Music" became a new chat instead of song ID).
      if (target == null && !(v?.kind === 'chat thread' || v?.review || v?.mode === 'capture')) {
        // Paint now; act only once the box's fresh app list confirms the route (else it is a message as usual).
        if (LOCAL_COMMANDS.declaredRoute?.(text)) {
          showRouted('command', `Command · on-device${sttNote}`);
          const dr = await LOCAL_COMMANDS.confirmRoute(text);
          if (dr) return finishCmd(dr, text, opts);
        }
      }
      if (target == null && (v?.kind === 'chat thread' || v?.review || v?.mode === 'capture')) return toView(v, text, `To ${v.name}${sttNote}`, snap);
      return toAgent(text, `To ${window.WizConfig.agent()}${sttNote}`, opts);
    }
    const t0 = performance.now();
    const loc = await LOCAL_COMMANDS.confirm(localParse(text, snap, kind, typed), text, snap, kind, typed);
    if (loc) {
      const ms = Math.max(1, Math.round(performance.now() - t0));
      showRouted('command', `Command · on-device · ${ms} ms${sttNote}`);
      return finishCmd(loc, text, opts);
    }
    // A held take with no on-device match still asks the router (force: 'command'); only a non-command
    // answer falls back to the no-match choice card, so nothing is ever sent without a tap.
    // A capturing view takes a tap utterance as-is.
    if (kind !== 'command' && v?.mode === 'capture' && target == null) return toView(v, text, `To ${v.name}${sttNote}`, snap);
    // An open thread owns what James says: unless it is a phone command (or aimed at another desk), it goes
    // into that thread (steering the live run), never a new thread. New threads start from the list or New chat.
    const intoThread = kind !== 'command' && target == null && (v?.kind === 'chat thread' || v?.review);
    // A held orb is a command for the interface, never a message (James, 10 Oct 2026: "the long press is me
    // saying I want to issue a command that I want the interface to respond to"). When nothing matches, it
    // offers the choices and sends nothing until one is tapped. On a review desk a tap sends feedback to the
    // thread the link came from.
    const toAgentOrThread = label => kind === 'command' && !typed ? holdNoMatch(text, opts)
      : intoThread ? toView(v, text, v.review ? `To “${clip(v.threadTitle || 'the thread', 30)}” · feedback${sttNote}` : `To this thread${sttNote}`, snap) : toAgent(text, label, opts);
    setVoice('think'); if (isPill()) tx.dataset.detail = 'Routing · DeepSeek Flash'; else $('#txRouteText').textContent = 'Routing · DeepSeek Flash';
    try {
      const view = v && v.mode && kind !== 'command' && target == null ? { name: v.name, kind: v.kind } : null;
      const routeUrl = window.WizConfig.endpoint('route');
      if (!routeUrl) return toAgentOrThread(`To ${window.WizConfig.agent()}${sttNote}`);
      const r = await fetch(routeUrl, { method: 'POST', signal: AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, force: kind === 'command' ? 'command' : '', view, apps: APPS.filter(a => a.kind !== 'view').map(a => a.name) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'router');
      const c = j.cmd || {};
      if (c.route === 'view' && view) return toView(v, text, `To ${v.name} · routed in ${j.ms} ms${sttNote}`, snap);
      if (c.route === 'command') {
        showRouted('command', `Command · DeepSeek Flash · ${j.ms} ms${sttNote}`);
        const ran = finishCmd(c, text, opts);
        if (c.then_agent) { await new Promise(resolve => setTimeout(resolve, 1500)); return toAgent(String(c.then_agent), `Opened ${c.app || 'app'} · follow-up to ${window.WizConfig.agent()}`, opts); }
        return ran;
      }
      return toAgentOrThread(`To ${window.WizConfig.agent()} · routed in ${j.ms} ms${sttNote}`);
    } catch (e) {
      return toAgentOrThread(`Router offline · sent to ${window.WizConfig.agent()}`);
    }
  }
  /* Hold-command with no command match: a choice card, nothing is sent until James taps. */
  const NOMATCH_MS = 4000;
  function holdNoMatch(text, opts) {
    tourEv('nomatch', { text });
    setVoice('idle'); vib(12);
    const q = String(text || '').trim().replace(/[.!?,\s]+$/, '');
    // A long held take is a message, not a missed command (James, 18 Oct: a 40 s task vanished with the 4 s card).
    // It keeps the card until he taps Send or ×, with Send first and no search chips.
    const long = q.split(/\s+/).length > 20;
    txShow(text, long ? 'Not a command · tap Send to keep it' : 'No command matched · nothing sent', 'command', '⚡');
    const btn = (k, label) => `<button data-hold="${k}">${esc(label)}</button>`;
    $('#txChips').innerHTML = long ? btn('agent', `Send to ${window.WizConfig.agent()}`)
      : (searchUrl(q) ? btn('search', 'Search the web') + btn('images', 'Image search') : '') + btn('agent', `Send to ${window.WizConfig.agent()}`);
    V.holdText = q; V.holdOpts = opts; V.holdLong = long;
    window.__backLog = (window.__backLog || []).concat('hold:nomatch').slice(-30);
    if (long) clearTimeout(txHideT); else txHide(NOMATCH_MS); // James (11 Oct): 9 s lingered far too long; × closes it at once
    return long ? { outcome: 'held-message' } : false;
  }
  function showRouted(kind, label) {
    if (isPill()) {
      const short = kind === 'agent' ? 'Waiting to send'
        : kind === 'view' ? 'Sent ' + label.split(' · ')[0].replace(/^To /, 'to ')
        : ($('#txText').textContent || 'Done');
      return txPill(kind === 'command' ? '⚡' : kind === 'view' ? '◧' : '✦', short, kind, label);
    }
    tx.className = 'transcript ' + kind; window.WizBrand.paint($('#txRouteIcon'), kind === 'command' ? '⚡' : kind === 'view' ? '◧' : '✦'); $('#txRouteText').textContent = label;
  }
  function finishCmd(c, text, opts) {
    setVoice('done'); vib([8, 40, 8]);
    // Music only acknowledges acceptance; its done/fail receipt settles the recording later.
    let settle = null;
    const done = /^(music|play_music)$/.test(c?.action || '') ? new Promise(r => { settle = r; }) : null;
    const ok = execute(c, text, settle ? { ...opts, musicDone: settle } : opts);
    tourEv('command', { ok: !!ok, text });
    if (!ok) { $('#txRouteText').textContent += ' · no match'; }
    setTimeout(() => { if (V.state === 'done') setVoice('idle'); }, 900);
    txHide(ok ? (isPill() ? 1200 : 1300) : 3200);
    return { outcome: ok ? (window.WosCommands.completedLocally(c, ok) ? 'local' : 'local-pending') : 'unhandled', done: ok ? done : null };
  }
  async function toView(v, text, label, snap) {
    showRouted('view', label); setVoice('done'); vib([8, 40, 8]);
    const ok = await deliverToView(v, text, snap);
    if (!ok) return toAgent(text, `${v.name} didn’t take it · sent to ${window.WizConfig.agent()}`, { snap });
    if (!v.thread || W[v.id]?.thread === v.thread) focusWin(v.id); // never pull James back from where he went since
    setTimeout(() => { if (V.state === 'done') setVoice('idle'); }, 900);
    txHide(isPill() ? 1200 : 1500);
    return ok === true ? { outcome: 'local-pending' } : ok;
  }
  function execute(c, text, opts = {}) {
    return window.WosCommands.execute(c, text, {
      search: openSearch, settings: openSettings,
      focused: () => W[opts.snap?.id || desks[idx].focus], chats: CHATS, chatList: () => openSheet('inbox'), launcher: q => openSheet('launcher', q),
      findApp, openApp: app => openApp(app, {}, opts), openAppRoute: (id, url) => { const a = hostedOpenable(id); return !!a && appAt(url)?.id === id && openApp(a, { path: url }, opts) !== false; }, musicDone: opts.musicDone, layout: c => {
        const a = c.action, f = opts.snap?.id || desks[idx].focus;
    if (a === 'desk') {
      const to = c.to; closeSheets();
      if (to === 'next') goDesk(idx + 1); else if (to === 'prev') goDesk(idx - 1); else if (to === 'home') goDesk(HOME); else if (+to >= 1) goDesk(+to - 1);
      return true;
    }
    if (a === 'clear_desk') { clearDesk(idx); return true; }
    if (a === 'close_window') { if (!f) return false; closeWin(f); return true; }
    if (a === 'fullscreen') { if (!f) return false; setFull(f, c.on !== false); return true; }
    if (a === 'move_window') { if (!f) return false; const to = c.to === 'prev' || c.to === 'left' ? idx - 1 : c.to === 'next' || c.to === 'right' ? idx + 1 : +c.to - 1; return moveWin(f, to); }
        return false;
      }
    });
  }
  /* A new request to Archimedes. It is delegated in the background: James stays exactly where he is
   * (no Chats window opens, no desk switch, no thread takes focus). The new thread shows up in Chats,
   * Working and the Inbox like any other, and he opens it when he chooses. */
  async function toAgent(text, label, opts = {}) {
    tourEv('sent', { text });
    showRouted('agent', label); setVoice('agent'); vib(10);
    setTimeout(() => { setVoice('idle'); }, 1200);
    txHide(isPill() ? 1400 : 2600);
    const ctx = viewContext(desks[idx].focus, opts.how || 'voice', opts.snap);
    // Chats new-voice uses the shared draft path, including Space membership, but no composer or screen context.
    if (opts.snap?.newChatWid && W[opts.snap.newChatWid]?.app === 'chats') {
      return sendChat(opts.snap.newChatWid, text, 'new voice chat', opts.audio || opts.snap.audio || null, { custodyId: opts.snap.custodyId, sid: '__new__', route: opts.snap.route, seal: false, files: opts.files || [], instructions: 'Explicit new voice chat. No foreground app or private thread context shared.' });
    }
    // Saved before it is sent: a dropped connection can delay this, never lose it.
    const item = await OUTBOX.enqueue({ sealKey: opts.snap?.seal?.key, custodyId: opts.snap?.custodyId, kind: 'new', text, typed: opts.typed || '', ...(opts.snap?.route || {}), instructions: ctx, audio: opts.audio || opts.snap?.audio || null, source: opts.source || 'orb', files: opts.files || [], ...(opts.reply ? { reply: opts.reply } : {}), ...(opts.snap?.dumpAsked ? { dump: false } : {}) });
    renderMoons(); refreshHome(); renderDots();
    return item;
  }
  /* Orb dump (switch wizard/agent-inbox, off by default; wizard-ux issue 1588): a plain new take to the main agent, said
   * away from any thread (home, an app, the Chats list), is offered to the router as a possible background task (the
   * outbox asks with accept_dump). A take aimed anywhere (a thread, a review, a capture view, an agent's or a channel's
   * chats, a desk, the general button, a meeting) or carrying composer words, files or a reply is never one. */
  function dumpTake(snap, rt, aimAt, kind) {
    try { if (!(document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/agent-inbox')) return false; } catch (_) { return false; }
    const v = snap?.view;
    return !rt && aimAt == null && kind !== 'command' && !snap.general && !snap.conversation && !snap.meetingEventId && !V.meetingLoan
      && !snap.seal && !snap.newChatWid && !(snap.route?.agent && window.WosAgents?.isOther?.(snap.route.agent)) && !V.files?.length
      && !(v && (v.review || v.mode === 'capture' || v.agent || v.channel || v.kind === 'chat thread' || (v.thread && v.thread !== '__new__')));
  }
  // The box took it as a background task: "Got it" with its title, no navigation, nothing new in Chats.
  function gotIt(title) {
    title = String(title || '').slice(0, 80);
    toast('✦', `<b>Got it</b>${title ? ' · ' + esc(title) : ''}`, 2600);
    $('#toast').classList.add('got-it');
  }
  OUTBOX?.onDump?.(it => gotIt(it.dumped?.title));
  OUTBOX?.onSent((it, res) => {
    if (it.kind === 'new' && LIVE && !LIVE.session(it.sessionId)) {
      LIVE.sessions.unshift({ id: it.sessionId, runtime: 'direct', title: (it.text || 'Voice note').slice(0, 60), status: 'running', runId: res.runId, updatedAt: new Date().toISOString(), lastUserAt: new Date().toISOString(), preview: it.text, source: 'wizard-mobile' });
      LIVE.markSeen(it.sessionId);
    } else if (LIVE?.session(it.sessionId)?.synthetic) LIVE.markSeen(it.sessionId);
    // A reply's thread is already held in Working with its live status by live.js (PEND), until Wizard lists the run.
    if (it.attempts) toast('✦', res.steered ? 'Delivered · steering the live run' : `Delivered to ${window.WizConfig.agent()}`, 2000);
    // First-try orb sends were already confirmed by the pill above the orb: no second banner.
    else if (res.steered) toast('✦', 'Sent · steering the live run', 1800);
    LIVE?.emit(); setTimeout(() => LIVE?.refresh(), 3000);
    for (const id of Object.keys(W)) if ((W[id].app === 'chats' || CHATS.isHosted(id)) && W[id].thread === it.sessionId) setTimeout(() => W[id] && loadThread(W[id], true), 1500);
  });

  /* ---------------- orb gestures ----------------
   * Tap: talk. Hold: command (it opens on the desk beside this one). Swipe: left/right desks, up apps, down inbox. */
  const orbWrap = $('#orbWrap');
  const voiceDestination = document.createElement('div');
  voiceDestination.id = 'voiceDestination'; voiceDestination.setAttribute('role', 'status');
  const generalTarget = document.createElement('button');
  generalTarget.id = 'generalVoice'; generalTarget.className = 'general-voice';
  generalTarget.textContent = 'Record for ' + window.WizConfig.agent();
  generalTarget.setAttribute('aria-label', generalTarget.textContent);
  /* Labels align with the dock's top edge; keep them outside its stacking
   * context so recording controls cannot obscure the destination text. */
  device.append(voiceDestination, generalTarget);
  generalTarget.addEventListener('click', () => {
    if (V.state === 'idle') startVoice('general');
    else if (V.snap?.general && ['listen', 'paused'].includes(V.state)) finishVoice();
  });
  function snapAgentName(snap) {
    const id = snap?.route?.agent, a = id && window.WosAgents?.get(id);
    return a ? a.label : window.WizConfig.agent();
  }
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
  function shock() { const s = $('.orb-shock'); s.classList.remove('go'); void s.offsetWidth; s.classList.add('go'); }
  /* A worn layout's own orb swipes (WosSkinHost.orbSwipes, e.g. the Orb and Apps views: up = Home, the rest nothing).
   * 'stock' = the dock's own swipe below; Desks declares none, so it is always 'stock' there. Tap and hold never ask. */
  function orbSwipeAct(g) {
    const s = g && g.swipes, k = !g ? '' : g.mode === 'h' ? 'side' : g.mode === 'v' ? (g.dy < 0 ? 'up' : 'down') : '';
    return !s || !k || !(k in s) ? 'stock' : s[k];
  }
  // Home from the orb: as a desk swipe it may be the iPhone's own swipe home in disguise (undoLastMove puts it back)
  function orbSwipeHome() {
    const from = desks[idx]?.id;
    if (sheet) closeSheets(true);
    if (pillOvOpen()) closeOverview();
    if (idx !== HOME) goDesk(HOME);
    if (desks[idx]?.id !== from) lastMove = { from, at: Date.now() };
  }
  /* A New chat to type in from the orb (the AI apps view, round 5: tap the orb to talk, swipe it up to type): the Chats
   * window's New chat with the cursor in its composer, focused inside the swipe's own release so the phone's keyboard
   * comes up (iOS raises it only for a focus made while handling the touch). */
  function orbSwipeNew() {
    if (sheet) closeSheets(true);
    if (pillOvOpen()) closeOverview();
    const w = showChats(); if (!w) return;
    CHATS.openChat(w.id, '__new__');
    const ta = winEl(w.id)?.querySelector('.ch-compose textarea');
    if (ta) { ta.focus({ preventScroll: true }); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {} }
  }
  orbWrap.addEventListener('contextmenu', e => e.preventDefault());
  orbWrap.addEventListener('pointerdown', e => {
    if (G || e.isPrimary === false) return;
    e.preventDefault(); try { orbWrap.setPointerCapture(e.pointerId); } catch (_) {} closeMenu();
    G = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), ts: e.timeStamp, mode: 'pending', dx: 0, dy: 0, aim: null };
    Orb.press(true);
    G.corner = device.classList.contains('orb-corner'); G.ovWas = pillOvOpen(); G.upDesks = orbUpDesks(); G.swipes = window.WosSkinHost?.orbSwipes?.() || null;
    if (V.state === 'idle') G.warm = setTimeout(() => { if (G && G.mode === 'pending') warmMic(); }, MIC_WARM_MS);
    // Hold = Orb switcher radial (James, 31 Oct 2026): a semicircle of wedges above the thumb. Slide onto one, release to
    // choose; the voice command lives in one wedge and needs a dwell. The corner orb (full-screen Chats) only talks:
    // there a hold stays the plain hold-command it always was.
    if (window.WosOrbSwitcher?.active() && !G.corner && !sheet && !G.ovWas) G.hold = setTimeout(() => { if (G && G.mode === 'pending') openRadial(G); }, window.WosOrbSwitcher.HOLD_OPEN_MS);
    else if (mayHoldCommand()) G.hold = setTimeout(() => { if (G && G.mode === 'pending') { G.mode = 'hold'; G.holdAt = performance.now(); if(V.state==='idle'||(V.state==='paused'&&V.replyTo)){vib(18);G.start=startVoice('command');}else{G.refused=true;toast('⏸','Pause your reply before a command');} } }, 380);
  });
  function openRadial(g) {
    if (!window.WosOrbSwitcher?.active()) return;
    g.mode = 'radial'; vib(18); closeMenu();
    const r = orbWrap.getBoundingClientRect();
    window.WosOrbSwitcher.open({ x: r.left + r.width / 2, y: r.top + r.height / 2, fromX: g.x, fromY: g.y });
  }
  /* Orb switcher host: what the radial needs from the shell, and nothing else. App placement stays the shell's
   * (openApp -> placeApp), the voice command is the ordinary startVoice('command') / finishVoice(). */
  const appGlyph = a => window.WizCore.workspaceNav.icon({ wins: ['_'], focus: '_' }, { _: {} }, () => a);
  const orbSwitcherHost = {
    apps: () => [{ id: 'home', name: 'Home', html: deskSigil(HOME) }].concat(APPS.filter(a => a.kind !== 'native' && a.kind !== 'view' && !window.WizCore.isMaintenanceApp(a))
      .map(a => ({ id: a.id, name: a.name, html: appGlyph(a) }))),
    // Exactly one entry per desktop, in strip order (including empty desktops). All app ids
    // on a split desktop suppress duplicate outer pins, not just its focused window's id.
    openItems: () => desks.map((d, i) => {
      const fw = W[d.focus] || W[d.wins[0]];
      return { id: d.home ? 'home' : fw ? winApp(fw).id || 'desk:' + d.id : 'desk:' + d.id,
        name: d.home ? 'Home' : deskName(i), html: deskSigil(i), desk: i, cur: i === idx,
        appIds: d.home ? ['home'] : d.wins.map(w => winApp(W[w]).id).filter(Boolean) };
    }),
    // The hovered desk slides in behind the radial so James sees where he will land. Parked desks (two+ away) render
    // nothing, so the hovered one is woken first; release re-parks via goDesk / parkDesks.
    hover: desk => { const w = track.getBoundingClientRect().width || innerWidth; if (desk != null && desk !== idx) secOf(desk)?.classList.remove('parked'); placeTrack(desk == null ? 0 : (idx - desk) * w, false); },
    vib, armBack: () => armBack(), cancelGesture: () => endGesture(null, true),
    voice: {
      enabled: () => (V.state === 'idle' || (V.state === 'paused' && !!V.replyTo)) && mayHoldCommand(),
      start: () => startVoice('command'),
      active: () => V.kind === 'command' && V.state === 'command',
      finish: () => finishVoice(),
      cancel: () => cancelVoice(true),
      pause: () => { V.stopAsked = true; pauseCommandCapture(); }, // capture lost: keep the take paused with controls, never discard
    },
  };
  // Core dock behaviour: no skin recipe or old tweak switch can disable it.
  window.WosCreateOrbSwitcher(orbSwitcherHost);

  // Slide-to-aim is retired (James, 11 Oct 2026): a held command already opens on the desk beside this one, so
  // sliding while holding does nothing (no desk label, no aim). A hold that starts travelling at once is a swipe.
  const aimFor = () => null;
  orbWrap.addEventListener('pointermove', e => {
    if (!G || e.pointerId !== G.pointerId) return; G.dx = e.clientX - G.x; G.dy = e.clientY - G.y;
    if (G.mode === 'radial') { window.WosOrbSwitcher.move(e.clientX, e.clientY); return; }
    if (G.mode === 'scrub') return; // the bar scrub has this finger (barScrubJoin); the dock's handlers run it
    // A hold that starts travelling right after it fired was really a swipe (slow frame ate the moves).
    if (G.mode === 'hold' && G.holdAt && performance.now() - G.holdAt < 600 && (Math.hypot(G.dx, G.dy) > 34 || (G.dy > 16 && G.dy > Math.abs(G.dx) * 1.4)) && !(G.dy < -20 && Math.abs(G.dx) < 100)) {
      cancelVoice(true); G.mode = 'pending';
    }
    if (G.mode === 'hold') {
      const box = generalTarget.getBoundingClientRect();
      // The compact target touches the orb: require deliberate upward travel,
      // so ordinary hold/release (including finger jitter) remains a command.
      G.general = G.dy < -16 && e.clientX >= box.left - 16 && e.clientX <= box.right + 16 && e.clientY >= box.top - 16 && e.clientY <= box.bottom + 16;
      generalTarget.classList.toggle('selected', G.general);
      voiceDestination.textContent = G.general ? 'Release: keep talking to ' + window.WizConfig.agent() : 'Release: command · slide onto ' + window.WizConfig.agent();
      // Aim: slide toward the desk this command should land on.
      G.aim = G.corner ? null : aimFor(G.dx);
      orbWrap.dataset.dir = G.aim == null ? '' : (G.aim < idx ? `← Desk ${G.aim + 1}` : `Desk ${G.aim + 1} →`);
      device.classList.toggle('aiming', G.aim != null);
      $('#txRouteText').textContent = G.aim == null ? 'Command · release to run' : `Command · opens on desk ${G.aim + 1}`;
      return;
    }
    // Swipes work in every voice state: recording or sending never locks navigation.
    if (G.mode === 'pending' && Math.hypot(G.dx, G.dy) > 14 && G.corner && !G.swipes) { clearTimeout(G.hold); G.mode = 'still'; }
    if (G.mode === 'still') return; // the corner orb only talks: a slid finger cancels, it never swipes the shell
    // A downward slide commits sooner (10 px): the orb sits near the bottom of the glass, so there is little room below it.
    if (G.mode === 'pending' && (Math.hypot(G.dx, G.dy) > 14 || (G.dy > 10 && G.dy > Math.abs(G.dx) * 1.4))) {
      clearTimeout(G.hold); G.mode = Math.abs(G.dx) > Math.abs(G.dy) ? 'h' : 'v'; orbWrap.classList.add('dragging');
      // wizard-ux#1536: the orb on the bar is part of the scrub surface, so its sideways swipe is the bar scrub.
      if (G.mode === 'h' && !G.corner && !G.ovWas && !(G.swipes && orbSwipeAct(G) !== 'stock') && orbWrap.closest('#dock') && barScrubJoin(e, G)) { G.mode = 'scrub'; orbWrap.classList.remove('dragging'); return; }
    }
    // A layout's own swipe (Orb / Apps): nothing follows the finger; only the hint for Home.
    if (G.swipes && orbSwipeAct(G) !== 'stock') { orbWrap.dataset.dir = G.dy < -40 ? ({ home: '↑ Home', new: '↑ New chat' }[orbSwipeAct(G)] || '') : ''; return; }
    if (G.mode === 'h' && sheet === 'settings') liftSettings(); // swipe away from Settings: it stays on its desk
    if (G.mode === 'h' && !sheet) {
      let dx = G.dx; if ((idx === 0 && dx > 0) || (atPickerEnd() && dx < 0)) dx *= .28;
      placeTrack(dx * 1.1, false);
      orbWrap.dataset.dir = Math.abs(G.dx) > 50 ? (G.dx < 0 ? (idx < desks.length - 1 ? `${clip(deskName(idx + 1), 16)} →` : atPickerEnd() ? '' : 'New desk →') : (idx > 0 ? `← ${clip(deskName(idx - 1), 16)}` : '')) : '';
    } else if (G.mode === 'v') {
      if (G.upDesks && !sheet) {
        // Our skins: up grows the pill into the desks panel (once, mid-swipe); down while it is open closes it.
        if (G.dy < -40 && !pillOvOpen() && !G.ovWas) { G.ovOpened = true; openOverview('pill'); }
        orbWrap.dataset.dir = '';
        return;
      }
      if (!sheet && G.dy < 0) {
        const p = Math.min(1, Math.abs(G.dy) / 240);
        launcher.classList.add('dragging');
        if (!launcher._rendered) { renderLauncher(''); launcher._rendered = true; }
        launcher.style.transform = `translateY(calc(${(1 - p) * 100}% + ${(1 - p) * 160}px))`;
        launcher.style.opacity = String(Math.min(1, p * 1.6));
      } else if (!sheet) { launcher.style.transform = ''; launcher.style.opacity = ''; }
      // Down: the bar follows the finger a little, then hides (distraction-free). Little room below the orb, so short.
      if (!sheet && V.state === 'idle') $('#dock').style.transform = G.dy > 0 ? `translateY(${Math.min(G.dy, 40) * .5}px)` : '';
      orbWrap.dataset.dir = sheet ? (Math.abs(G.dy) > 40 ? 'Close' : '') : G.dy < -40 ? '↑ Apps' : G.dy > 12 && V.state === 'idle' ? '↓ Hide' : '';
    }
  });
  // The orb's tap on a running take (the dock orb, or a layout's agent orb).
  // James 20 Oct: a tap on a paused take resumes it and never sends. Send is the next tap, once it records again.
  // Only a take that cannot resume (mic held by another recording, or the last resume found the mic busy) still sends.
  function orbTapBusy() {
    if (V.admitting) { V.admitSend = true; return; }
    if (V.state === 'paused') {
      // Dictation keeps its own contract: a tap on a paused dictation transcribes into the sealed field (nothing is sent).
      if (V.kind === 'dictation' || V.resumeBlocked || (window.WizAppCapture?.getState?.().recording && !V.meetingLoan)) { shock(); return finishVoice(); }
      return $('#arcPause').click();
    }
    if (V.state === 'listen') { shock(); return finishVoice(); }
    // sending: a tap on the orb does nothing until the take is handed off
  }
  function endGesture(e, cancelled) {
    if (!G || (e?.pointerId != null && e.pointerId !== G.pointerId)) return; const g = G; G = null;
    // a take this press starts has taken the warm mic by then (openRec claims it before its first await)
    clearTimeout(g.hold); clearTimeout(g.warm); queueMicrotask(dropWarm); Orb.press(false); orbWrap.classList.remove('dragging'); orbWrap.dataset.dir = ''; device.classList.remove('aiming'); generalTarget.classList.remove('selected');
    const vt = (performance.now() - g.t) || 1;
    if (g.mode === 'scrub') { if (cancelled) barScrubDrop(); return; } // the dock's pointerup lands the scrub
    // Our skins, desks panel open: the orb is its handle. Any tap or swipe on it closes the panel (nothing else fires).
    if (g.ovWas && pillOvOpen()) { if (!cancelled && g.mode !== 'hold') { closeOverview(); return; } }
    if (g.ovOpened) { if (cancelled) closeOverview(); return; }
    // A layout's own swipe (Orb / Apps): up far or fast enough = Home; a swipe it set to null does nothing.
    const own = orbSwipeAct(g);
    if (own !== 'stock') { if ((own === 'home' || own === 'new') && !cancelled && (g.dy < -70 || g.dy / vt < -.55)) { if (own === 'new') orbSwipeNew(); else orbSwipeHome(); } return; }
    if (g.upDesks && g.mode === 'v' && !sheet) { if (g.dy < -70 || g.dy / vt < -.55) openOverview('pill'); else if (!cancelled && V.state === 'idle' && (g.dy > 18 || (g.dy > 8 && g.dy / vt > .3))) setZen(true); return; }
    if (g.mode === 'pending' && !cancelled) {
      if (sheet) return closeSheets();
      if(V.admitting){V.admitSend=true;return;}
      if(V.state==='paused'&&V.replyTo&&FIELDS.refresh())return startVoice('dictation');
      if (V.state === 'idle') return window.WosSkinHost?.orbTap?.() ? undefined : startOrbVoice();
      return orbTapBusy();
    } else if (g.mode === 'radial') {
      const out = window.WosOrbSwitcher?.release(cancelled) || { kind: 'none' };
      placeTrack(0, true); parkDesks(false);
      if (out.kind === 'open' && out.id === 'home') execute({ action: 'desk', to: 'home' });
      else if (out.kind === 'open') { const a = APP[out.id]; if (a) openApp(a); } // every pin uses shared placement, including already-open apps
      else if (out.kind === 'customize') window.WosOrbSwitcher.openSettings();
    } else if (g.mode === 'hold') {

      if(g.refused)return; // a refused hold always consumes its release; never sends a reply
      if(g.start){g.start.then(()=>{if(V.kind!=='command')return;if(cancelled)pauseCommandCapture();else finishVoice();});return;}
      // Capture loss is not explicit Cancel. Keep the take paused with controls, never discard it.
      if (cancelled) { V.stopAsked = true; pauseCommandCapture(); return; }
      if (g.general) {
        // Synchronous latch before finishVoice: same recorder, no send on this release.
        V.kind = 'general'; V.snap = generalVoiceSnap(); V.target = null; V.replyTo = null;
        V.stopAsked = false; V.sendAsked = false;
        if (V.native) {
          try { voiceRecovery(V.native, { kind: 'general', general: true, conversation: null }); saveVoiceRoute(V.native, V.snap.route); }
          catch (_) { V.stopAsked = true; pauseCommandCapture(); toast('!', 'General destination could not be saved · recording kept'); return; }
        }
        setVoice('listen'); txHide(0); return;
      }
      V.target = g.aim;
      return finishVoice();
    } else if (g.mode === 'h') {
      if (sheet) return;  // launcher etc.; Settings was lifted onto its desk when the drag began
      if (cancelled || g.dy < -40) return placeTrack(0, true); // went up: the iPhone's swipe out, never a desk swipe
      const v = g.dx / vt;
      if (g.dx < -60 || v < -.5) { swipeDesk(1); tourEv('desk', { home: idx === HOME }); } else if (g.dx > 60 || v > .5) { swipeDesk(-1); tourEv('desk', { home: idx === HOME }); } else placeTrack(0, true);
    } else if (g.mode === 'v') {
      [launcher, inboxEl].forEach(el => el.classList.remove('dragging'));
      launcher._rendered = inboxEl._rendered = false; $('#dock').style.transform = '';
      if (sheet) { if ((sheet === 'launcher' && g.dy > 40) || (sheet === 'inbox' && g.dy < -40) || (sheet === 'settings' && Math.abs(g.dy) > 40)) closeSheets(); else if (g.dy < -40) openSheet('launcher'); return; }
      const v = g.dy / vt;
      if (g.dy < -70 || v < -.55) openSheet('launcher');
      else if (!cancelled && V.state === 'idle' && (g.dy > 18 || (g.dy > 8 && v > .3))) setZen(true);
      else { launcher.style.transform = ''; launcher.style.opacity = ''; }
    } else if (g.mode === 'still') {
      // The full-screen Chats corner orb only talks, but a clear downward slide hides it too.
      if (!cancelled && V.state === 'idle' && g.dy > 18 && g.dy > Math.abs(g.dx)) setZen(true);
    }
  }
  orbWrap.addEventListener('pointerup', e => endGesture(e, false));
  orbWrap.addEventListener('pointercancel', e => endGesture(e, true));
  orbWrap.addEventListener('lostpointercapture', e => endGesture(e, true));
  // Capture may move with the dock/immersive DOM. Id matching makes duplicate and unrelated releases inert.
  window.addEventListener('pointerup', e => endGesture(e, !orbWrap.hasPointerCapture(e.pointerId)), true);
  window.addEventListener('pointercancel', e => endGesture(e, true), true);
  window.addEventListener('blur', () => endGesture(null, true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) endGesture(null, true); });
  orbWrap.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (V.state === 'idle') { if (!window.WosSkinHost?.orbTap?.()) startOrbVoice(); } else finishVoice(); } });
  orbWrap.tabIndex = 0;

  /* Distraction-free, forgiving start (James, 18 Oct 2026): the swipe down may begin a little above the orb. Passive
   * touch watch over the strip above the orb: taps and scrolls there behave exactly as before; only a clear, mostly
   * vertical drag down of ~26 px hides the bars. Touch events (not pointer) so a list that starts scrolling under
   * the finger does not cancel the watch. */
  let ZA = null;
  document.addEventListener('touchstart', e => {
    ZA = null;
    if (zen || sheet || G || e.touches.length !== 1 || V.state !== 'idle') return;
    if (device.classList.contains('immersive') && !device.classList.contains('orb-corner')) return;
    if (e.target.closest && e.target.closest('#orbWrap, #zenEdge, #immEdge')) return;
    const t = e.touches[0], r = orbWrap.getBoundingClientRect(); if (!r.width) return;
    if (t.clientX < r.left - 48 || t.clientX > r.right + 48 || t.clientY < r.top - 72 || t.clientY > r.top + 6) return;
    ZA = { x: t.clientX, y: t.clientY };
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', e => {
    if (!ZA || e.touches.length !== 1) { ZA = null; return; }
    const t = e.touches[0], dx = t.clientX - ZA.x, dy = t.clientY - ZA.y;
    if (dy < -12 || Math.abs(dx) > 44) { ZA = null; return; }
    if (dy > 26 && dy > Math.abs(dx) * 1.4) { ZA = null; setZen(true); }
  }, { capture: true, passive: true });
  ['touchend', 'touchcancel'].forEach(t => document.addEventListener(t, () => { ZA = null; }, { capture: true, passive: true }));

  /* Bottom edge while distraction-free: swipe up anywhere along it to bring the bars back. A real >=24 px target so
   * touch adjustment never hands the swipe to a composer above it (see immEdge). */
  const zenEdge = document.createElement('div'); zenEdge.id = 'zenEdge'; zenEdge.className = 'zen-edge';
  zenEdge.innerHTML = '<i></i>'; zenEdge.setAttribute('aria-label', 'Swipe up to show the orb'); device.appendChild(zenEdge);
  zenEdge.addEventListener('click', e => e.preventDefault());
  zenEdge.addEventListener('touchmove', e => { if (ZE && e.cancelable) e.preventDefault(); }, { passive: false });
  let ZE = null;
  zenEdge.addEventListener('pointerdown', e => {
    if (!zen) return; e.preventDefault(); try { zenEdge.setPointerCapture(e.pointerId); } catch (_) {}
    ZE = { y: e.clientY, t: performance.now(), id: e.pointerId, dy: 0 };
  });
  zenEdge.addEventListener('pointermove', e => {
    if (!ZE || e.pointerId !== ZE.id) return; ZE.dy = Math.min(0, e.clientY - ZE.y);
    zenEdge.classList.toggle('pull', -ZE.dy > 10);
    if (-ZE.dy > 22 && zen) { ZE = null; zenEdge.classList.remove('pull'); setZen(false); } // reveal as soon as the intent is clear
  });
  const zenEnd = e => {
    if (!ZE || e.pointerId !== ZE.id) return; const s = ZE; ZE = null; zenEdge.classList.remove('pull');
    const v = s.dy / ((performance.now() - s.t) || 1);
    if (e.type !== 'pointercancel' && s.dy < -8 && v < -.3) setZen(false);
  };
  zenEdge.addEventListener('pointerup', zenEnd); zenEdge.addEventListener('pointercancel', zenEnd);
  // Every load starts with the orb and bars showing (James, 18 Oct); distraction-free is a per-session choice.
  store.set('zen', false);

  /* ---------------- Back never leaves WizardOS ----------------
   * Android Back is an in-app back gesture, one step at a time:
   *   recording → menu → sheet → the focused window's own back (thread → list,
   *   framed app history, review dive) → full screen → Home desk.
   * At Home every Back is consumed, including repeated presses. Two mechanisms:
   *   1. CloseWatcher (Chrome 120+) consumes Back, re-armed after every press,
   *      in this document and in every same-origin framed app;
   *   2. a history guard entry pushed during a user gesture; popstate → one step. */
  let guardOn = history.state?.wos === 'guard', ignorePop = 0;
  const watchers = new Set();
  const phoneBack = window.WizEscapeBack.create();
  window.WizEscapeBack.installOwners(phoneBack, { chats: () => CHATS, links: () => LINKS,
    afterTour: () => { if (settingsReturn === 'help') { settingsReturn = ''; openSettings(); $('#settingsBody [data-st="help"]')?.focus(); } },
    afterChat: () => { if (settingsReturn === 'files') { settingsReturn = ''; openSettings(); $('#settingsBody [data-st="files"]')?.focus(); } },
  });
  phoneBack.watch(() => document.querySelector('#txChips [data-handoff], #txChips [data-hold]'), () => { $('#txChips').innerHTML = ''; V.holdText = ''; txHide(0); }, 'draft');
  phoneBack.watch(() => ovEl?.classList.contains('open'), closeOverview, 'overview');
  phoneBack.watch(() => rvCoach, closeReviewCoach, 'review-coach');
  phoneBack.watch(() => menuFor, closeMenu, 'menu');
  phoneBack.watch(() => sheet, ({ outside }) => { if (sheet === 'settings' && !outside && settingsView?.back()) return 'settings-page'; closeSheets(); return 'sheet'; }, 'sheet');
  window.WosBack = Object.freeze({ names: phoneBack.names, escape(e) { e.preventDefault?.(); e.stopImmediatePropagation?.(); if (!e.repeat && !e.isComposing) return onBack(); } });
  function hostedBack(f) {
    const frame = winEl(f.id)?.querySelector('iframe');
    // A sandboxed app (browser boundary) answers later; at its root the shell's next Back step runs then.
    const result = window.WizAppServices?.back(frame, () => backStep(f.id));
    return result || 'notReady';
  }
  function backStep(skipHosted, { outside = false } = {}) {
    window.WosSettings?.cancelWait?.(); // every Back path (native, CloseWatcher, history) drops a System link still waiting
    // The Review coach promises that Back closes the review, not just this first-use hint.
    // Outside still dismisses only the hint; Back continues to the Reader's own history, then its chat.
    if (rvCoach && !outside) closeReviewCoach();
    const transient = phoneBack.run({ outside, recording: () => {
      // Retain/pause phone capture; only desktop Escape discards its voice note.
      if (!V.snap?.general || !['listen', 'command'].includes(V.state)) return false;
      V.stopAsked = true; pauseCommandCapture(); return 'recording';
    } }); if (transient) return transient;

    const d = desks[idx], f = W[d.focus];
    if (f && CHATS.isHosted(f.id)) return CHATS.threadBack(f);
    if (f) {
      if (f.app === 'pages') { if (window.WosPages.back(winEl(f.id)?.querySelector('.pg-host'))) return 'pages'; closeWin(f.id); return 'pages-close'; }
      if (f.app === 'chats' && f.thread) return CHATS.threadBack(f);
      if (f.app === 'chats' && (CHATS.hasFilter(f) || CHATS.ch(f.id).q)) {
        const c = CHATS.ch(f.id), back = c.filterFrom, did = CHATS.clearFilter(f);
        // A Home card's chip: one Back takes it off and goes back to Home, the way James came.
        if (did === 'chip' && !CHATS.hasFilter(f)) { c.fromCard = false; c.coach = false; c.filterFrom = null; const p = back ? desks.findIndex(x => x.id === back) : -1; if (p >= 0 && p !== idx) goDesk(p); }
        if (did) return did === 'search' ? 'search' : 'filter';
      }
      if (f.app === 'chats' && CHATS.channelBack?.(f)) return 'channel'; // a channel's feed → Channels (wizard/chat-channels)
      if (f.app === 'chats' && CHATS.readyBack?.()) return 'ready-order'; // Priority / By subject → Newest
      // An agent's Chats opened from the Agents app: Back returns to that app (still open), never out.
      if (agentWin(f) && f.backTo && W[f.backTo] && deskOf(f.backTo) >= 0 && deskOf(f.backTo) !== idx) { const t = deskOf(f.backTo); f.backTo = ''; save(); goDesk(t); return 'agent-back'; }
      if (f.app === 'frame' && skipHosted !== f.id) {
        const result = hostedBack(f);
        if (['handled', 'pending', 'stay'].includes(result)) return 'hosted';
        if (result === 'notReady') { const nav = frameNav(f.id); if (nav?.canGoBack) { try { selfPop(winEl(f.id).querySelector('iframe').contentWindow); } catch (e) {} nav.back(); return 'frame'; } }
      }
      if (window.WizCompanionPane?.back(f.id)) return 'companion-back';
      if (d.full) { setFull(f.id, false); return 'tile'; }
      // A bound view: Back slides back to its thread; the view stays beside it until James leaves the thread.
      if (f.bound && W[f.bound] && deskOf(f.bound) >= 0) { goDesk(deskOf(f.bound)); return 'bound-back'; }
      if (f.from) { closeWin(f.id); return 'review-close'; } // a link's desk: Back closes it and lands where it came from
    }
    if (zen) { setZen(false); return 'zen'; }
    if (idx !== HOME) { goDesk(HOME); return 'home'; }
    return null;
  }
  /* A browser or OS back swipe (iOS Safari's left edge, Chrome's overscroll, Android's edge) that starts under a finger
   * a skin gesture has claimed (api.gesture.claim, e.g. a layout's edge drawer) belongs to that gesture: it is not
   * also a Back step. Nothing claims a finger in Desks, so every Back there is unchanged. */
  const ownedSwipe = () => !!window.WosSkinHost?.claimedLately?.();
  function onBack() {
    const did = backStep();
    window.__backLog = (window.__backLog || []).concat(did || 'root').slice(-30);
    if (!did) toast('⌂', "You're home", 1200);
    return did || 'root';
  }
  function makeWatcher(win, rearm) {
    if (!win || !('CloseWatcher' in win)) return null;
    try {
      const w = new win.CloseWatcher();
      w.onclose = () => { watchers.delete(w); if (!ownedSwipe()) onBack(); setTimeout(rearm, 0); };
      watchers.add(w); return w;
    } catch (e) { return null; }
  }
  let topWatcher = null;
  function armBack() {
    if (!topWatcher || !watchers.has(topWatcher)) topWatcher = makeWatcher(window, () => { topWatcher = null; armBack(); });
    ensureGuard();
  }
  function armFrameBack(f, win) {
    if (win._wosWatcher && watchers.has(win._wosWatcher)) return;
    const rearm = () => { try { if (f.contentWindow === win) { win._wosWatcher = null; armFrameBack(f, win); } } catch (e) {} };
    win._wosWatcher = makeWatcher(win, rearm);
  }
  function disarmAll() { for (const w of [...watchers]) { watchers.delete(w); try { w.destroy(); } catch (e) {} } topWatcher = null; $$('iframe.appframe').forEach(f => { try { f.contentWindow._wosWatcher = null; } catch (e) {} }); }
  function rearmFrames() { $$('iframe.appframe').forEach(f => { try { const w = f.contentWindow; if (w && w.document.readyState !== 'loading') armFrameBack(f, w); } catch (e) {} }); }
  // History guard: only pushed during a user gesture, so Chrome never skips it.
  function ensureGuard(force) {
    if (guardOn || (!force && !navigator.userActivation?.isActive)) return;
    history.pushState({ wos: 'guard' }, ''); guardOn = true;
  }
  var dropUntil = 0; // retained for hosted-frame programmatic-pop accounting
  addEventListener('popstate', e => {
    // Landing on a guard entry means the Back key popped something stacked above it (a hosted app's entry or a
    // second guard). We never navigate forward, so every pop is a user Back: never swallow one.
    guardOn = e.state?.wos === 'guard';
    if (ignorePop) { ignorePop--; dropUntil = 0; return; }
    if (Date.now() < dropUntil) { dropUntil = 0; return; } // our own guard drop surfacing late (counts once)
    // a back swipe of the browser / OS under a finger a skin gesture owns (a layout's edge drawer) is that gesture's
    if (ownedSwipe()) { ensureGuard(true); return; }
    onBack();
    // A consumed step re-arms at once, so the next Back (even with no tap in
    // between) is caught too, including at Home.
    ensureGuard(true);
  });
  // Every touch is a user activation: refresh the watchers and the guard then.
  // (Touch only grants activation on pointerup/click, so listen to all three.)
  for (const ev of ['pointerdown', 'pointerup', 'click']) addEventListener(ev, () => { { armBack(); rearmFrames(); } }, true);
  addEventListener('keydown', () => { armBack(); }, true);
  if (history.state?.wos !== 'root' && history.state?.wos !== 'guard') history.replaceState({ wos: 'root' }, '');
  if (history.state?.wos === 'guard') guardOn = true;

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !('CloseWatcher' in window)) { onBack(); return; }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowRight') goDesk(idx + 1);
    else if (e.key === 'ArrowLeft') goDesk(idx - 1);
    else if (e.key === 'ArrowUp') { sheet === 'inbox' ? closeSheets() : openSheet('launcher'); }
    else if (e.key === 'ArrowDown') { sheet === 'launcher' ? closeSheets() : openSheet('inbox'); }
    else if (e.key === '/') { e.preventDefault(); openSheet('launcher'); setTimeout(() => $('#search').focus(), 50); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { LIVE && LIVE.refresh(); markVisibleThreadsSeen(); } });

  // The phone keeps a still resting orb; live voice/agent feedback stays animated.
  // Shared native Everywhere hosts retain their existing cadence.
  Orb.setRestingMotion?.(false);

  /* Starfield + Nebula drift + skin canvases: core/scenery.js (battery-gated decorative motion). */

  /* ---------------- boot ---------------- */
  buildDesks(); setVoice('idle'); armBack();
  browserBarInset();
  /* Workspace sync (core/workspace-sync.js): the same desks on every device. Home stays this phone's own; a desk
   * with more windows than the phone tiles keeps the rest in d.more so they are never dropped from the shared copy. */
  window.WosWorkspaceSync?.create({
    shell: 'phone',
    title: w => winApp(w)?.name || w.title || w.appId,
    read: () => ({ desks: desks.filter(d => !d.home).map(d => ({ id: d.id, wins: [...d.wins.map(id => W[id]).filter(Boolean), ...(d.more || [])] })) }),
    apply(state, o = {}) {
      if (!state) { const i = posOf(o.focus); if (i > 0) { closeSheets(true); goDesk(i); } return; }
      const here = desks[idx]?.id, at = idx;
      // Joining the owner's shared workspaces: his open apps replace this device's starter apps (seed), so a phone
      // whose storage was reset never shows starter apps he did not open (James, 6 Nov 2026).
      if (o.join && state.desks.length) desks = desks.filter(d => {
        if (d.home || !d.wins.some(id => W[id]?.seed)) return true;
        d.wins = d.wins.filter(id => { if (!W[id]?.seed) return true; winEl(id)?.remove(); delete W[id]; return false; });
        if (!d.wins.includes(d.focus)) d.focus = d.wins[d.wins.length - 1] || null;
        return d.wins.length > 0;
      });
      const r = window.WosWorkspaceSync.reconcile(desks.slice(1), W, state, { fresh: id => blank({ id }), max: MAXW });
      r.removed.forEach(id => { closeAppPlayback(W[id]); CHATS.closeHosted(id); CHATS.forget(id); delete W[id]; delete CH[id]; });
      desks = [desks[0], ...r.desks].map(d => { if (!d.wins.length) d.full = false; return d; });
      syncDesks(); desks.forEach((_, i) => renderDesk(i));
      idx = posOf(here); if (idx < 0) idx = Math.max(0, Math.min(at, desks.length - 1));
      placeTrack(0, false); renderDots(); save();
    },
  });
  // Decorative motion lives only on a visible, recently touched Home with nothing over it (core/scenery.js).
  window.WosScenery?.attach({ device, homeInView: () => idx === HOME && !desks[idx]?.full, deskIdx: () => idx });
  if (LIVE) LIVE.refresh();
  $('#clock').textContent = window.WizConfig.hm();
  window.addEventListener('wizard:config', () => { const t = $('#homeTime'), c = $('#clock'), hm = window.WizConfig.hm(); if (t) t.textContent = hm; if (c) c.textContent = hm; });
  /* First run: the practice tour (core/tour.js). Say "help" or Settings → Gestures & help to see it again. */
  window.WosTour?.attach({
    device, orbWrap, shock, vib, toast,
    setMode: m => Orb.setMode(m),
    goHome: () => { if (idx !== HOME) goDesk(HOME, true); },
    workingCard: () => track.querySelector('.home-desk [data-act="working"]'),
    cmdExample: () => (findApp('calendar') ? 'Open Calendar' : 'Open Files'),
    noMic: () => NOMIC,
    closeSheets: () => closeSheets(),
    setZen: on => setZen(on),
    dismissVoice: () => { $('#txChips').innerHTML = ''; V.holdText = ''; txHide(1200); },
    prepare: () => { if (V.state !== 'idle') cancelVoice(true); closeMenu(); closeOverview(); closeSheets(true); const d = desks[idx]; if (d.full && d.focus) setFull(d.focus, false); },
    say: (t, kind) => runUtterance(t, kind || 'auto'),
    openChats: () => { closeSheets(); openChatsList(); },
    atHome: () => idx === HOME && !sheet,
  });
  const firstRun = !store.get('coached', false) && !window.WosTour?.done();
  // Setup (core/setup-launch.js) opens first on a box's first run; the tour then waits for the first return to Home.
  // First run is the Welcome modal (core/welcome.js): connect an AI, pick a look, send a first message. It replaces
  // the automatic Setup window and gesture tour (Miguel, 29 Oct 2026); "help" and ?view=tour still open the tour.
  void firstRun;
  window.WosWelcome?.boot({ app: id => APP[id] || null, openStore: () => { const a = APP['app-store']; if (a) openApp(a); },
    deeplinked: () => (window.__deeplinkLog || []).length > 0, busy: () => V.state !== 'idle',
    // One main Chats window, and the new thread opens in it as soon as it is saved.
    send: async text => { closeSheets(true); const w = placeApp(mainChats, { app: 'chats', thread: null }); if (!w) throw new Error('Chats unavailable'); const it = await sendChat(w.id, text, 'the first message, from the Welcome screen', null, { sid: '__new__', away: true }); if (it?.sessionId) window.WosWelcome.whenThreadExists(it.sessionId, sid => openWizardThread(sid)); return it || null; } });
  // Native shell (WizardOS Android app): the app hands every hardware/gesture Back to the shell. A step that
  // undoes something returns its name; at the true root the shell stays put and says so. The app never exits
  // on Back (James's rule), just like the browser guard above.
  window.__wosNativeBack = () => {
    const did = backStep();
    window.__backLog = (window.__backLog || []).concat(did ? 'native:' + did : 'native:root').slice(-30);
    if (!did) toast('⌂', "You're home", 1200);
    return did || 'root';
  };
  if (/WizardOS-Android\//.test(navigator.userAgent)) document.documentElement.classList.add('native-app');
  // Assistant handoff (side-key app → WizardOS). 'listen' opens the orb listening; 'say' shows the words as a
  // draft that James sends with one tap — another app can never make Archimedes act on its own.
  let threadHandoffGeneration = 0;
  window.__wosHandoff = h => {
    // A side-button handoff means James already knows the gestures: clear the first-run coach so the draft is visible.
    if (window.WosTour?.active) window.WosTour.finish('handoff');
    if (!h || typeof h !== 'object') return false;
    closeSheets(); if (idx !== HOME && h.action !== 'thread') goDesk(HOME);
    if (h.action === 'listen') { if (V.state === 'idle') startVoice('auto'); return true; }
    if (h.action === 'thread' && h.id) {
      const id = String(h.id), generation = ++threadHandoffGeneration;
      // Android 0.9.15's share notification carries only thread_id. On a cold start or just-shared
      // thread its owning agent is not cached yet: resolve agent lists BEFORE opening Chats.
      // Never open a private notification in main while the refresh is still in flight.
      Promise.resolve(LIVE?.refreshAgents?.()).then(() => {
        if (generation !== threadHandoffGeneration) return;
        if (!LIVE?.agentOf?.(id) && Object.values(LIVE?.agentStatus || {}).some(s => !s.ok)) {
          toast('◉', 'Could not locate that chat · reconnect and tap again'); return;
        }
        openWizardThread(id); LIVE?.refresh();
      }).catch(() => { if (generation === threadHandoffGeneration) toast('◉', 'Could not locate that chat · reconnect and tap again'); });
      return true;
    }
    if (APP[h.action]?.kind === 'wizard') return openApp(APP[h.action]);
    // Photos is its own app: older WizardOS builds still ask for Settings › photos-backup (notification, native screen).
    if (h.action === 'settings' && (h.focus === 'photos-backup' || h.focus === 'photos')) { if (!window.WizOpenApp?.('photos')) toast('▣', 'Photos backup lives in the Photos app · install it from the App Store', 3200); return true; }
    if (h.action === 'unsent' || h.action === 'settings') { onUnsentChange(); openSettings(h.action === 'unsent' || (typeof h.focus === 'string' && window.WosSettings?.features.some(f => f.id === h.focus) ? h.focus : undefined)); return true; }
    if (h.action === 'side-button') { store.set('sideHidden', false); refreshHome(true); if (SIDE && (SIDE.step === 'mic' || SIDE.step === 'assistant')) sideButtonTap(false); else toast('◉', 'Side button is on. Hold it to talk.', 2600); return true; }
    const text = String(h.text || '').trim().slice(0, 2000);
    if (h.action !== 'say' || !text) return false;
    if (V.state !== 'idle') cancelVoice(true);
    clearTimeout(txHideT);
    // Talking to Wizard is sending: no draft, no confirm — same as the orb.
    window.__backLog = (window.__backLog || []).concat('handoff:say').slice(-30);
    runUtterance(text, 'auto');
    return true;
  };
  /* choice: moved to app-choice.js (wizard-ux issue 1665), called once here */
  const {  } = window.WizCore.appParts.choice({ $, APP, APPS, cancelVoice, closeSheets, FIELDS, findApp, finishVoice, mountLinks, NOMATCH_MS, openApp, openSearch, openSheet, openWizardThread, OUTBOX, startVoice, toAgent, toast, tx, txHide, V });
  // Shared app command delivery; compatibility ownership is confined to voice-legacy.
  window.WosAppVoice?.install({
    apps: () => APP,
    findWin: appId => {
      const mine = id => W[id]?.app === 'frame' && W[id].appId === appId;
      return desks[idx].wins.find(mine) || Object.keys(W).find(id => mine(id) && deskOf(id) >= 0) || null;
    },
    open: appId => { closeSheets(true); const w = placeApp(x => x.app === 'frame' && x.appId === appId && !x.from, { app: 'frame', appId }); return w ? w.id : null; },
    frameOf: id => winEl(id)?.querySelector('iframe.appframe') || null,
    toast,
  });
  window.__wos = {
    get links() { return LINKS; },
    get voiceBorrowing() { return parking || !!parkedReply || !!V.admitting; },
    openAgentChats,
    live: LIVE, openPeek, closePeek, openOverview, closeOverview, mergeDesks, splitDesk, reorderDesks, closeDesk, openLinkDesk, pinWin, openWizardThread, goDesk, openSheet, closeSheets, runUtterance, openApp, openWin, closeWin, moveWin, setFull, focusWin, openChat, sendChat, onBack, viewContext, viewOf, execute, handleText, quickTake, QUICK_MS,
    HOME, get idx() { return idx; }, get desks() { return desks; }, get ovLog() { return window.__ovLog || []; }, get wins() { return W; }, get voice() { return V.state; }, get voiceHandedOff() { return !!V.handedOff && OUTBOX.handedOff?.(V.handedOff); }, get sheet() { return sheet; },
    get back() { return { watchers: watchers.size, guardOn, exitArmed: false, log: window.__backLog || [] }; },
    openSearch,
    startVoice, finishVoice, cancelVoice, recoverDictation, recoverParkedReply, outbox: OUTBOX, openSettings, unsentAll, renderSettings,
    canSearch: () => !!APP['wizard-search'], chats: CHATS, chat: CHATS.KIT, get viewer() { return CHATS.KIT.viewer.state; }, threadAct: CHATS.threadAct, openRowSheet: CHATS.openRowSheet,
    // web/device.js (share, recovery, update banner, hot reload) works through these.
    chatState: ch, addFiles: CHATS.addFiles, uploadFile: CHATS.uploadFile, renderChats, refreshCompose, toAgent, toast, txShow, txHide, setVoice, nativeFinish, nativeResume, recDone, get V() { return V; },
    reset() { Object.keys(localStorage).filter(k => k.startsWith('wos.')).forEach(k => localStorage.removeItem(k)); location.reload(); },
  };

  /* ---------------- banners, deep links, voice card (core/status.js, core/deeplink.js, core/voice-status.js) ---------------- */
  const chatsInFront = () => { const f = W[desks[idx].focus]; return f?.app === 'chats' && f.thread && f.thread !== '__new__' ? f.thread : ''; };
  window.WizCore.status?.attach({ openChats: () => openSheet('inbox'), inboxOpen: () => sheet === 'inbox', current: chatsInFront });
  window.WizCore.voiceStatus?.onChange(() => { if (sheet === 'settings') renderSettings(); });
  // The list may still be loading: wait for the section (up to ~5 s), open it, bring it into view.
  function showSection(k, tries = 50) {
    if (!k) return;
    const sec = track.querySelector(`.win[data-win="${desks[idx].focus}"] [data-sec="${k}"]`);
    if (!sec) { if (tries > 0) setTimeout(() => showSection(k, tries - 1), 100); return; }
    if (!sec.classList.contains('open')) sec.querySelector('[data-sectoggle]')?.click();
    const target = track.querySelector(`.win[data-win="${desks[idx].focus}"] [data-sec="${k}"]`);
    const scroller = target?.closest('.ch-scroll');
    if (scroller) scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  }
  window.WosFeatures.install({
    context: () => {const id=desks[idx].focus,v=viewOf(id);return {id,view:{kind:v?.kind,appId:W[id]?.appId}};},
    openFeature: (id,opts) => {closeSheets(true);return openWin({app:'feature',featureId:id,featureOptions:opts,title:window.WosFeatures.entries.find(f=>f.id===id)?.title});},
    command: (text,snap=sendSnap()) => { const c = localParse(text, snap, 'command'); return c ? execute(c, text,{snap}) : false; }
  });
  window.WizCore.deeplink?.handle({
    // ?session= takes exactly the path the Android app's ACTION_THREAD intent takes.
    thread: id => window.__wosHandoff({ action: 'thread', id }),
    view(v, section, installQuery) {
      if (window.WosTour?.active && v !== 'tour') window.WosTour.finish('deeplink');
      if (v === 'tour') return window.WosTour?.start('link');
      if (v === 'help') { closeSheets(true); return window.WosTour?.openHelp(); }
      closeSheets(true);
      if (v === 'home') { window.WosResources?.back(); return goDesk(0, true); }
      if (v === 'apps') return openSheet('launcher');
      if (v === 'install') {
        // The Store window must exist now to receive the link; the Store needs no setup check of its own.
        window.WosAppSetup?.close(); // an earlier app's pending check or sheet must not reopen it over the Store
        openApp(APP['app-store'], {}, { setupChecked: true });
        const w=Object.values(W).find(w=>w.appId==='app-store');
        return window.WizCore.deeplink.installInFrame(w && document.querySelector(`[data-win="${w.id}"] iframe`),installQuery);
      }
      if (v === 'store') return openApp(APP['app-store']);
      if (v === 'agents') return openApp(APP.agents);
      if (window.WosFeatures.open(v)) return;
      if (window.WosSettings.route(v, openSettings)) return;
      if (v === 'files') { const a = findApp('files') || APP.files; if (a) return openApp(a); toast('◇', 'Files isn’t on this Wizard', 1800); return; }
      // work / chats: the Chats window, at the asked-for section.
      const here = desks.findIndex(d => d.wins.some(x => mainChats(W[x])));
      if (here >= 0 && here !== idx) goDesk(here, true);
      openApp(APP.wizard);
      const cw = W[desks[idx].focus]; if (mainChats(cw) && cw.thread) chatsBack(cw);
      showSection(section);
    },
    app(id, srcEl) {
      // Android, switch wizard/app-windows (wizard-os issue 650): a link to an app (also one this app was opened with) opens its own window.
      if (window.WizAndroidRelay?.openAppWindow?.(id)) return;
      // A tapped link inside a window (a Chats thread) remembers where it came from.
      const srcId = srcEl && srcEl.closest ? srcEl.closest('.win')?.dataset.win : '';
      const opts = srcId && W[srcId] ? { from: fromOf(srcId) } : {};
      const a = APP[id] || (!id.startsWith('agent:') && findApp(id, true)); if (a) return openApp(a, {}, opts);
      Promise.resolve(window.WizCore.appsLoaded?.()).then(() => { if (window.WizAndroidRelay?.openAppWindow?.(id)) return; const b = APP[id] || (!id.startsWith('agent:') && findApp(id, true)); if (b) openApp(b, {}, opts); });
    },
    video: item => { closeSheets(true); return CHATS.KIT.viewer.open([item]); },
    agent: id => openAgentChats(id),
    toast,
  });
  window.WizCore.deeplink?.consume();
  /* Skin packages (core/skin-host.js): the only shell surface a skin script can drive. Each call goes through
   * the shell's own functions, so the Back contract and desk rules hold for every skin. */
  function agentInfo(a) {
    const AG = window.WosAgents;
    // The main agent goes by the owner's name for it (Archimedes), not its harness label.
    const label = a.is_default ? (window.WizConfig?.agent() || a.label || a.id) : (a.label || a.id);
    return { id: a.id, label, colour: AG ? AG.colour(a) : '#b99bff', private: a.privacy === 'private', main: !!a.is_default, status: a.status || '' };
  }
  /* Who the agent orb sends to, from what is in front: an agent's Chats, a thread that belongs to an agent,
   * an app bound to an agent (Agents › app bindings), else the main agent. */
  function agentHere() {
    const AG = window.WosAgents, def = AG?.defaultId() || 'hermes';
    const f = desks[idx]?.focus, w = f && W[f];
    let id = '', why = 'main', app = '';
    if (w && w.app === 'chats' && (!w.thread || w.thread === '__new__') && CHATS.winAgent(w)) { id = CHATS.winAgent(w); why = 'chats'; }
    else if (w && (w.app === 'chats' || CHATS.isHosted(f)) && w.thread && AG?.isOther(LIVE?.agentOf?.(w.thread))) { id = LIVE.agentOf(w.thread); why = 'thread'; }
    else if (w?.appId) {
      const b = AG?.binding?.(w.appId);
      if (b?.agent && AG.isOther(b.agent) && AG.get(b.agent)) { id = b.agent; why = 'app'; app = APP[w.appId]?.name || w.appId; }
    }
    const a = AG?.get(id || def) || { id: id || def, label: window.WizConfig?.agent() || 'Hermes', is_default: !id, appearance: {} };
    return { ...agentInfo(a), why, app };
  }
  /* The agent orb's tap / pick. No pick = the screen's own destination (the classic tap). */
  function talkTo(id) {
    if (V.state !== 'idle') return orbTapBusy();
    const AG = window.WosAgents, here = agentHere();
    const target = id || here.id;
    if (target === here.id && here.why !== 'app') return startVoice('auto');
    if (!AG?.isOther(target)) return startVoice('general');
    return startVoice('general', { agent: target });
  }
  const skinChatsWin = () => { const f = desks[idx]?.focus; if (W[f]?.app === 'chats') return W[f]; const id = desks[idx]?.wins.find(x => W[x]?.app === 'chats'); return id ? W[id] : null; };
  window.WosSkinHost?.attach({
    overview: overviewAdapter,
    windowRefresh: windowRefreshAdapter,
    route() { const w = skinChatsWin(), f = W[desks[idx]?.focus]; let ag = ''; try { ag = agentHere().id; } catch (_) {} return { view: w ? (w.thread ? 'thread' : 'list') : 'desk', thread: w?.thread || null, desk: idx, app: f ? (f.appId || f.app || null) : null, agent: ag || null, beside: device.classList.contains('bound-peeking') ? 1 : device.classList.contains('bound-view-peeking') ? -1 : 0, home: idx === HOME }; },
    back: () => backStep(), escapeOverlay: close => phoneBack.push(close),
    openList: () => openChatsList(),
    openThread: id => openWizardThread(id),
    goDesk: i => goDesk(i),
    // Ready / Working counts as Home shows them, and the same lists their cards open (data.read.sessions).
    sessions: () => { const G = LIVE && LIVE.ok ? LIVE.workGroups() : null; return G ? { working: (G.working || []).length, ready: window.WizCore.workspaceNav.chatsCount(LIVE) } : null; },   // ready = unread, as Home's Ready card
    openSessions: kind => (kind === 'working' ? openChatsFiltered('working', { card: true }) : openChatsList()),  // Ready = the whole list, any old filter cleared
    newThread: () => { const w = skinChatsWin(); if (w) CHATS.openChat(w.id, '__new__'); },
    openSettings: page => openSettings(page),
    // Inbox tweak: answer a notification in this Chats window (the Notifications Reply path); words send it at once.
    contextDraft: (key, item, words, draft) => { let w = skinChatsWin(); if (!w) { openChatsList(); w = skinChatsWin(); } if (!w) return false; CHATS.openContextDraft(w.id, key, item, draft); CHATS.renderChats(w); if (words) CHATS.sendChat(w.id, words, 'tapping Resolve this on a notification in Chats'); return true; },
    models: () => { const w = skinChatsWin(); return w ? CHATS.tweakModels(w.id) : []; },
    model: (choice, alive) => { const w = skinChatsWin(); return w ? CHATS.tweakModel(w.id, choice, alive) : null; },
    deskCount: () => desks.length,
    root() { const w = skinChatsWin(); return w ? track.querySelector(`[data-chats="${w.id}"]`) : null; },
    dock: () => $('#dock'),
    locked: pointerId => !!(DS && DS.id === pointerId && DS.h),
    // Skin scripts pass plain text (file names, error messages): escaped, like the desktop toast.
    toast: text => toast('◇', esc(String(text ?? '')), 2400),
    // Layouts (two-orb): who the screen routes to, and the orb's recorder.
    agents: () => (window.WosAgents?.visible?.() || window.WosAgents?.list || []).map(agentInfo),
    agentHere: () => agentHere(),
    agentSigil: id => { const AG = window.WosAgents, a = AG?.get(id); return a ? AG.sigil(a, 'ag-sig') : ''; },
    openAgent: id => openAgentChats(id),
    voiceState: () => ({ state: V.state, kind: V.kind || '', agent: V.state === 'idle' ? '' : (V.snap?.route?.agent || V.snap?.view?.agent || (V.replyTo?.sid && LIVE?.agentOf?.(V.replyTo.sid)) || window.WosAgents?.defaultId() || '') }),
    talk: id => talkTo(id),
    voiceTap: () => (V.state === 'idle' ? talkTo('') : orbTapBusy()),
    dictate: () => { if (V.state !== 'idle' || !FIELDS?.refresh()) return false; startVoice('dictation'); return true; },
    voiceCancel: () => cancelVoice(),
    relayout: () => { try { syncImmersive(); } catch (_) {} },
    /* Layouts on the phone (skin layout API; the Orb and Apps views that used most of it went in issue 1338): the apps (the same rows and kinds as the
     * desktop's), opening one (its desk, or a new one), what is running (the app on each desk, one per app: the Orbs
     * satellites), the Home desk's section and the dock orb's box. */
    apps: () => { const AK = window.WosAppKinds; return (AK ? AK.kinds(APPS, APP).apps : APPS.filter(a => a.url && !a.agent)).slice().sort((x, y) => x.name.localeCompare(y.name)).map(a => ({ id: a.id, name: a.name, icon: ico('span', 'ic', a), system: !!AK?.isSystem?.(a), dev: !!AK?.inDev?.(a), connector: !!AK?.isConnector?.(a), agent: !!a.agent || a.kind === 'chats' })); },
    openApp: id => !!APP[id] && openApp(APP[id]) !== false,
    // The Orb and Apps views' app sheet: every app by kind (core/app-kinds.js rows) and opening any of them
    appKinds: () => window.WosAppKinds?.rows ? window.WosAppKinds.rows(APPS, APP, a => ico('span', 'ic', a)) : null,
    openAnyApp: (id, open) => !!window.WosAppKinds?.openRow?.(APPS, APP, id, open),
    panelRunning: () => { const run = new Map(); desks.forEach((d, i) => { if (d.home || !d.wins.length) return; const w = W[d.focus] || W[d.wins[0]], id = w && (w.appId || winApp(w).id); if (id && !run.get(id)?.open) run.set(id, { id, open: i === idx, playing: false }); }); return [...run.values()]; },
    // The Orb and Apps views' app sheet: close an app (every desk showing it), and an App Store page on a desk of its own.
    closeApp: id => { let n = 0; for (let i = desks.length - 1; i >= 0; i--) { const d = desks[i]; if (!d.home && d.wins.some(x => W[x] && (W[x].appId || winApp(W[x]).id) === id) && closeDesk(i)) n++; } return n > 0; },
    openStore: id => { const S = APP['app-store']; if (!S?.url) return false; Object.keys(W).filter(x => W[x]?.appId === 'app-store' && deskOf(x) >= 0).forEach(x => closeWin(x, true));
      const u = new URL(S.url, location.origin); u.searchParams.set('app', id); u.searchParams.set('open', '1'); return !!openWin({ app: 'frame', appId: 'app-store', url: u.pathname + u.search }); },
    homeHost: () => secOf(HOME),
    orbHost: () => orbWrap,
    chatsSurfaces: () => Object.keys(W).filter(id => W[id]?.app === 'chats').map(id => CHATS.surface(id)).filter(Boolean),
    // The Apps view's Home grid: one entry per desk (each desk is one app), in desk order, with the app it shows.
    // A layout placing the shell's opens (apps.routeOpens): the app's own window at one of its own pages
    showAppPath: (id, path) => { let u; try { u = new URL(path, location.href); } catch (_) { return false; } const rel = u.pathname + u.search + u.hash;
      if (u.origin !== location.origin || appAt(rel)?.id !== id) return false;
      const mine = x => x?.app === 'frame' && x.appId === id && !x.from, w = mine(W[desks[idx].focus]) ? W[desks[idx].focus] : Object.values(W).find(x => mine(x) && deskOf(x.id) >= 0); if (!w) return false;
      return framePage(w, rel); },
    phoneDesks: () => desks.map((d, i) => { if (d.home || !d.wins.length) return null; const w = W[d.focus] || W[d.wins[0]]; if (!w) return null; const a = winApp(w); return { desk: i, id: w.appId || a.id || '', name: a.name || w.title || '' }; }).filter(Boolean),
    // An app's mark exactly as the dock draws it (its logo or sigil, its colour): the Apps view's icons.
    phoneMark: id => { const a = id === CHATS_APP.id ? { app: 'chats' } : APP[id] ? { app: 'frame', appId: id } : null; return a ? window.WizCore.workspaceNav.icon({ wins: ['m'], focus: 'm' }, { m: a }, winApp) : ''; },
    /* The AI apps view (layouts/ai-apps): its drawer's chats (Working, Ready; the rest for its search), each with the
     * actions Chats' row sheet offers, acted on through Chats' own paths; the Chats window as it is; a New chat in it. */
    // Activity with Channels on (wizard-ux issue 1336): every agent's chats as Working, Ready, Recent, Snoozed, Archived.
    activityList: (o = {}) => window.WizChatsListModel.activityList(LIVE?.ok ? LIVE.workGroups() : null, { live: LIVE, chats: CHATS, pins: window.WosChatPins }, { order: o.order, older: !!o.older, now: Date.now() }),
    sessionList: () => window.WizChatsListModel.sessionList(LIVE?.ok ? LIVE.workGroups() : null, { live: LIVE, chats: CHATS, pins: window.WosChatPins }),
    sessionAct: (sid, act) => {
      // Move to channel… (wizard-ux issue 1292): Chats' own picker, over the view as it is (no trip to Chats).
      if (act === 'move') { const find = () => Object.keys(W).find(id => mainChats(W[id]) && deskOf(id) >= 0); let here = find();
        // No Chats yet: open one beside, out of view (stay), so the view in front stays in front.
        if (!here) { openApp(APP.wizard, {}, { stay: true }); here = find(); }
        return !!here && !!CHATS.moveToChannel?.(here, sid); }
      if (act === 'pin') { const P = window.WosChatPins; if (!P) return false; const on = P.toggle(sid); toast('⌖', on ? 'Pinned' : 'Unpinned', 1400); return true; }
      if (act === 'markdone') return !!CHATS.markDone?.(Object.keys(W).find(id => mainChats(W[id])) || '', sid); // in place (issue 1317)
      const w = showChats(); if (!w) return false;
      if (act === 'rename') { CHATS.openRenameSheet(w.id, sid); return true; }
      CHATS.threadAct(w.id, sid, act); return true;
    },
    showChats: () => !!showChats(),
    newChat: () => { const w = showChats(); if (!w) return false; CHATS.openChat(w.id, '__new__'); return true; },
    // New chat with a channel's feed in front (wizard-ux issue 1291): that feed's own box, never General.
    chatChannelPost: () => { const w = W[desks[idx]?.focus]; return w?.app === 'chats' && !w.thread && !!CHATS.chanCompose?.(w.id); },
    // The Chats list's tab: 'activity' or 'channels' ('' with the switch off). It decides what + does (issue 1310).
    chatChannelView: () => CHATS.chanView?.() || '',
    appOrb: () => { const f = frontAppFrame(); return f ? window.WizAppServices?.orb?.of(f) || null : null; },
    appOrbTap: () => { const f = frontAppFrame(); return !!f && !!window.WizAppServices?.orb?.tap(f); },
    // Now playing (api.media): an app's own name and mark, and bringing that app to the front.
    mediaApp: id => { const a = APP[id]; return a ? { name: a.name || id, icon: ico('span', 'np-ic', a) } : null; },
    mediaOpen: id => !!window.WizOpenApp?.(id),
  });
  // The app window in front (no sheet over it): the only app that may wear the agent orb.
  function frontAppFrame() {
    const f = desks[idx]?.focus, w = f && W[f];
    if (!w?.appId || sheet || menuFor || CHATS.isHosted(f)) return null;
    return track.querySelector(`.win[data-win="${f}"] iframe.appframe`);
  }
})();
