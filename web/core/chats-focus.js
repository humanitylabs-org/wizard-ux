/* Wizard UX core: Chats › a thread shown as the page (document scrolling, its chrome and tracker), moving a thread
 * to a channel, the Space in front and the Focus agents. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Values chats.js changes over time (its
 * reassigned lets) stay in chats.js; this code reads and writes them as chatVars.<name>, chats.js's get/set
 * accessors on the same variables, so every read and write is live. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.focus = function ({ agentRec, AGS, androidDocument, ch, chanStoreMove, chanStoreSpaces, chatsBack, chatVars, growTa, H, LIVE, norm, OUTBOX, owner, renderChatList, renderThread, save, toast, W, winAgent }) {
  let attOf, chanHold, channelBack, chanOwnPost, closeSpacePicker, deferredOf, elOf, openSpacePicker, PAGE, PW, rowAgent; // late-bound: chats.js declares these after the call, see bindLate
  const scrollBox = nb => nb && chatVars.docOwner?.contains(nb) ? document.scrollingElement : nb;
  // The one admission check for measuring, saving and restoring either scroll mode.
  function threadOnScreen(nb) {
    const el = nb?.closest('[data-chats]');
    return !!(el && nb.isConnected && H.visible().includes(el.dataset.chats) && el.getClientRects().length
      && nb.getClientRects().length && nb.querySelector('[data-morph-key]') && scrollBox(nb).clientHeight
      && (!androidDocument || chatVars.docOwner === el));
  }
  const threadViewportTop = (nb, base) => globalThis.WosThreadTracker?.viewportTop(nb, base) ?? base;
  function watchTracker(w, nb) {
    if (!w?.thread || !globalThis.WosThreadTracker?.onFor?.(LIVE.agentOf?.(w.thread) || '')) return;
    globalThis.WosThreadTracker.watch(nb, { sid: w.thread, agent: LIVE.agentOf?.(w.thread) || '',
      active: () => W[w.id]?.thread === w.thread && threadOnScreen(nb) && (typeof H.front === 'function' ? H.front() === w.id : H.visible().length === 1 && H.visible()[0] === w.id) });
  }
  function sizeDocumentChrome() {
    if (!chatVars.docOwner) return;
    const root = document.documentElement, vv = window.visualViewport;
    const keyboard = Math.max(0, innerHeight - (vv ? vv.height + vv.offsetTop : innerHeight));
    const header = chatVars.docOwner.querySelector('.ch-head'), composer = chatVars.docOwner.querySelector('.ch-compose'), sw = chatVars.docOwner.querySelector('.ch-swrow');
    root.style.setProperty('--wos-doc-head', (header?.getBoundingClientRect().height || 0) + 'px');
    root.style.setProperty('--wos-doc-compose', (composer?.getBoundingClientRect().height || 0) + 'px');
    root.style.setProperty('--wos-doc-switch', (sw?.getBoundingClientRect().height || 0) + 'px');
    root.style.setProperty('--wos-doc-keyboard', keyboard + 'px');
    const dock = document.getElementById('dock'), ds = dock && getComputedStyle(dock);
    const dockInset = dock && ds.display !== 'none' && ds.visibility !== 'hidden' && Number(ds.opacity) > 0
      ? Math.max(0, innerHeight - dock.getBoundingClientRect().top) : 0;
    // Preserve the shell's orb / navigation pill; it must not cover the composer.
    root.style.setProperty('--wos-doc-bottom', Math.max(keyboard, dockInset) + 'px');
  }
  function restoreVisibleThreads() {
    const next = new Set(H.visible().map(id => elOf(id)?.querySelector('.ch-msgs')).filter(Boolean));
    for (const nb of next) if (!chatVars.visibleThreads.has(nb)) PW?.resume(nb);
    chatVars.visibleThreads = next;
  }
  function syncDocumentThread() {
    if (!androidDocument) return restoreVisibleThreads();
    const next = H.visible().map(id => elOf(id)).find(el => el?.querySelector('.ch-thread') && el.getClientRects().length) || null;
    const root = document.documentElement;
    const returning = next !== chatVars.docOwner;
    if (returning) {
      // Leaving document scroll puts the desk track's slide, the window padding and the header back in one style change.
      // With their transitions live that change animated: Back from a thread rode the track in from the side while the
      // list dropped down from the top (wizard-ux issue 1564). Swap the mode with transitions held, then hand them back.
      const path = [...document.querySelectorAll('.wos-doc-path,.wos-doc-thread')], held = path.map(n => n.style.transition);
      path.forEach(n => { n.style.transition = 'none'; n.classList.remove('wos-doc-path', 'wos-doc-thread'); });
      chatVars.docResize?.disconnect(); chatVars.docResize = null; chatVars.docObserved = [];
      chatVars.docOwner = next;
      root.classList.toggle('wos-doc-scroll', !!next);
      if (!next && document.scrollingElement.scrollTop) window.scrollTo(0, 0);
      if (path.length) { void root.offsetHeight; path.forEach((n, i) => { n.style.transition = held[i]; }); }
      if (!next) return;
      next.classList.add('wos-doc-thread');
      for (let n = next; n && n !== root; n = n.parentElement) n.classList.add('wos-doc-path');
    }
    if (!next) return;
    // A skin's Web Animations filter/scale on the device also creates a fixed
    // containing block even at its identity keyframe. End those shell animations.
    for (let n = next; n && n !== root; n = n.parentElement) n.getAnimations?.().forEach(a => a.cancel());
    sizeDocumentChrome();
    if (returning) PW?.resume(next.querySelector('.ch-msgs'));
    // Re-renders replace the composer. Observe its new node, not a detached one, and only re-observe when the nodes
    // changed: this runs on every DOM change, and a fresh observer reports every node at once, which pulled the page
    // back to the bottom each frame while the orb's recording UI updated (James, 24 Oct: couldn't scroll up while recording).
    const nodes = [...next.querySelectorAll('.ch-head,.ch-compose,.ch-swrow'), document.getElementById('dock')].filter(Boolean);
    if (typeof ResizeObserver === 'function' && (!chatVars.docResize || nodes.length !== chatVars.docObserved.length || nodes.some((n, i) => n !== chatVars.docObserved[i]))) {
      chatVars.docResize?.disconnect(); chatVars.docObserved = nodes;
      const sizes = new WeakMap();
      chatVars.docResize = new ResizeObserver(entries => {
        let changed = false;
        for (const e of entries) { const h = Math.round(e.contentRect.height), was = sizes.get(e.target); sizes.set(e.target, h); if (was !== undefined && was !== h) changed = true; }
        sizeDocumentChrome();
        if (changed) PW?.reflow(next.querySelector('.ch-msgs'));
      });
      nodes.forEach(n => chatVars.docResize.observe(n));
    }
  }
  {
    const queueDocumentThread = () => { if (!chatVars.docFrame) chatVars.docFrame = requestAnimationFrame(() => { chatVars.docFrame = 0; syncDocumentThread(); }); };
    // The composer sits above the bottom bar's measured strip. That strip changes without any size change when the bar
    // finishes its corner animation (it measured as 0 mid-fade) and while the app is away, so measure again when the
    // animation ends and on resume (James, 8 Nov 2026: the composer kept a stale gap after the Android app resumed).
    for (const ev of ['visibilitychange', 'pageshow', 'focus']) (ev === 'visibilitychange' ? document : window).addEventListener(ev, queueDocumentThread);
    document.addEventListener('animationend', e => { if (e.target?.id === 'dock') queueDocumentThread(); }, true);
    // Desk changes / Back / closing a hosted thread must relinquish document scrolling too.
    new MutationObserver(queueDocumentThread).observe(document.body, { childList: true, subtree: true });
    const device = document.getElementById('device');
    if (device) new MutationObserver(queueDocumentThread).observe(device, { attributes: true, attributeFilter: ['class'] });
    const deskTrack = H.root().querySelector('.track') || (H.root().matches?.('.track') ? H.root() : null);
    if (deskTrack) new MutationObserver(queueDocumentThread).observe(deskTrack, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('scroll', e => {
      if (e.target !== document || !chatVars.docOwner) return;
      const nb = chatVars.docOwner.querySelector('.ch-msgs'); if (!threadOnScreen(nb)) return;
      nb.dispatchEvent(new Event('scroll')); // existing save / following / scroll-idle guards
      const w = H.win(chatVars.docOwner.dataset.chats), c = w && ch(w.id);
      if (w && document.scrollingElement.scrollTop <= 1 && c.show < (c.turns?.length || 0) && !c.docEarlier) {
        c.docEarlier = true;
        c.show = (c.show || PAGE) + PAGE;
        renderThread(w, chatVars.docOwner, true);
        setTimeout(() => { c.docEarlier = false; }, 350);
      }
    }, { passive: true });
    const resizeDocument = () => {
      if (!chatVars.docOwner) return;
      sizeDocumentChrome(); requestAnimationFrame(() => PW?.reflow(chatVars.docOwner?.querySelector('.ch-msgs')));
    };
    window.visualViewport?.addEventListener('resize', resizeDocument);
    window.addEventListener('resize', resizeDocument);
  }
  /* Pins, Boomerang, topic emojis, list layouts and the Focus; core/chats-setup.js. */
  const { agoText, BOOM, byStatus, fileInGeneral, fileInSpace, focusedAgent, INC, isWorking, KIT, matchFilters, md, paintPins, PIN, PIN_SVG, PINS_KEY, pinsOn, SEC_OPEN_KEY, SECTIONS_DAY, SECTIONS_STATUS, setFilter, SPACE, spaceAgent, spaceContains, spaceMember, spaces, SPACES_KEY, spacesOf, STALE_LIST, STATUS, statusEntries, subjectOf, subjects, TOPIC, topicOn, toTurns, visibleSpaces, WORKING_ST, bindLate: setupLate } = window.WizCore.chatsParts.setup({ AGS: (...a) => AGS(...a), attOf: (...a) => attOf(...a), ch, chanStoreMove, chanStoreSpaces, chatsBack, deferredOf: (...a) => deferredOf(...a), elOf: (...a) => elOf(...a), focusAgents, growTa, LIVE, norm, rerenderList, toast, W });
  // Move to channel… from a row a layout draws itself (the AI apps Activity rows): the same picker as a feed's row menu.
  function moveToChannel(wid, sid) {
    const w = W[wid]; if (!w || !sid) return false;
    // The row's own owner (Activity keeps the main row when a routed thread shares its id), not the id-global pin.
    const row = LIVE.session?.(sid), agent = row ? rowAgent(row) : LIVE.agentOf(sid) || AGS()?.defaultId() || 'hermes';
    openSpacePicker(w, agent, null, { sid }); return !!chatVars.spacePicker;
  }
  /* A Space open in front is where James is working: every new thread started there (composer, orb, voice,
   * launcher) joins it (James, 25 Oct 2026). A Chats composer files its own (Space fixed at send, below) and opts
   * out here; every other new thread is announced by the outbox once saved, and the Chats window in front decides:
   * on its list or a new chat, focused on a Space of the agent the thread goes to. space: false opts out. */
  function spaceInFront(agent) {
    const id = H.front?.(), w = id && W[owner(id)];
    if (!w || w.app !== 'chats' || (w.thread && w.thread !== '__new__')) return '';
    const f = focusOf(w), sp = f?.kind === 'space' && spaces().find(s => s.id === f.key);
    return sp && spaceAgent(sp) === (agent || AGS()?.defaultId() || 'hermes') ? sp.id : '';
  }
  OUTBOX?.onNew?.((it, o) => {
    if (o?.space === false) return;
    const key = spaceInFront(it.agent || '');
    if (key) spaceMember(key, it.sessionId, true, it.agent || '');
    if (key && typeof chanOwnPost === 'function') chanOwnPost(key, it.agent || ''); // its feed shows it (issue 1291)
  });
  window.addEventListener('storage', e => { if (e.key === SPACES_KEY) window.dispatchEvent(new Event('wos:prefs')); });
  function focusOf(w) {
    const o = (w && W[owner(w.id)]) || w, f = o?.focus;
    // Old automatic subject focuses migrate to All, as do deleted Spaces.
    // Hidden agents leave discovery only: an existing route to one (or its Space) stays valid.
    const censusReady = AGS()?.ready && AGS()?.available && !AGS()?.error;
    if (f?.kind === 'subject' || (censusReady && ((f?.kind === 'space' && !spaces().some(s => s.id === f.key && routeAgents().some(a => a.id === spaceAgent(s)))) || (f?.kind === 'agent' && !routeAgents().some(a => a.id === f.key))))) { o.focus = null; save(); return null; }
    return f && ['agent', 'space'].includes(f.kind) && typeof f.key === 'string' && f.key ? f : null;
  }
  function routeAgents() { const A = window.WosAgents; return A?.list?.length ? A.list : [agentRec('')]; }
  function focusAgents() { return routeAgents().filter(a => !a.hidden); }
  function matchesFocus(f, s) { return !f || (f.kind === 'space' ? spaceContains(f.key, s.id) && (LIVE.agentOf(s.id) || AGS()?.defaultId() || 'hermes') === focusedAgent(f) : f.key === AGS()?.defaultId() ? !LIVE.agentOf(s.id) : LIVE.agentOf(s.id) === f.key); }
  function focusMatches(w, s) { return matchesFocus(focusOf(w), s); }
  // The rows a layout that draws its own chat list (AI apps sidebar) shows for this window's Focus; null = All (no filter).
  function focusRows(w) {
    if (!focusOf(w)) return null;
    const a = winAgent(w);
    return (a ? LIVE.sessionsFor(a) : LIVE.unified()).filter(s => !s.hidden && focusMatches(w, s));
  }
  // The agent the window's Focus routes to ('' = All), the default agent included; for a layout's own picker.
  function focusAgentId(w) { return focusedAgent(focusOf(w)); }
  function setFocus(w, f) {
    const o = W[owner(w.id)] || w; if (!o) return false;
    closeSpacePicker();
    if (o.thread) chatsBack(o); // saves the old agent's draft before changing its route
    o.focus = f && ['agent', 'space'].includes(f.kind) && f.key ? { kind: f.kind, key: String(f.key) } : null;
    // Each agent tab remembers its last choice (James, 25 Oct 2026): All → Archimedes returns to the Space he left, not All Archimedes.
    if (o.focus) o.agentFocus = { ...(o.agentFocus || {}), [focusedAgent(o.focus)]: o.focus };
    const ids = new Set([o.id, o.id + '::list', w.id]);
    for (const id of ids) { const c = ch(id); c.sheet = false; c.focus = false; c.newModel = null; c.listHTML = ''; c.readNav = (c.readNav || 0) + 1; window.WizCore.chatSearch?.cancel(id); const ww = W[id]; if (ww) rerenderList(ww); }
    save(); H.layout(o.id); return true;
  }
  function rememberedFocus(w, agent) {
    // The agent tab opens the agent (its label never names a channel, wizard-ux issue 1340).
    return { kind: 'agent', key: agent };
  }
  function addFilter(w, f) { if (!f) return false; if (f.kind === 'space' || f.kind === 'agent') return setFocus(w, f); const c = ch(w.id); if (w.thread) chatsBack(w); c.filter = f.key; c.filterFrom = null; rerenderList(w); return true; }
  function rerenderList(w) { const el = elOf(w.id); if (el && !w.thread) { ch(w.id).listPlace = null; ch(w.id).listPending = null; renderChatList(w, el); const sc = el.querySelector('.ch-scroll'); if (sc) sc.scrollTop = 0; if (typeof chanHold === 'function') chanHold(w.id); } }
  /* Back on a filtered list: search text first, then the most recent chip. */
  function clearFilter(w) {
    if (!w || w.thread) return false;
    const c = ch(w.id);
    if (c.q) { c.q = ''; window.WizCore.chatSearch?.cancel(w.id); rerenderList(w); return 'search'; }
    if (!c.filter) return typeof channelBack === 'function' && channelBack(w) ? 'channel' : false;
    c.filter = ''; c.lastChip = '';
    rerenderList(w); return 'chip';
  }
  const hasFilter = w => { const c = ch(w.id); return !!c.filter; };
  /* Channels view (wizard-ux issue 1254). A channel IS a Space (same
   * storage, same one-Space-per-chat rule); chats in no Space make a virtual General that is never stored. Activity
   * is today's list plus a muted "# channel" on each row. Channels lists the Spaces (pinned first, then A–Z or Z–A,
   * General last, archived ones in a folded Archive); opening one is a Space Focus drawn as a feed of posts, each the
   * owner's first message with its pictures, so the New chat button files into it through the Space-fixed-at-send path.
   * Back: thread → channel → list. James's review (10 Nov 2026) set the post, wording, order, sheet and Archive. */
  const CHAN_VIEW_KEY = 'wos.chats.view.v1', CHAN_GENERAL = '__general__', CHAN_DAY = 864e5;
  // Sort, pins and archive live on this device until Agent Service has shared fields for them (wizard-agent-service
  // issue 447). An archived channel leaves Archive once nothing in it moved for this many days (a setting can come later).
  const CHAN_PREFS_KEY = 'wos.chats.channel-prefs.v1', CHAN_ARCHIVE_PRUNE_DAYS = 30, CHAN_CLAMP = 200, CHAN_TEXT_MAX = 4000;
  return { addFilter, agoText, BOOM, byStatus, CHAN_ARCHIVE_PRUNE_DAYS, CHAN_CLAMP, CHAN_DAY, CHAN_GENERAL, CHAN_PREFS_KEY, CHAN_TEXT_MAX, CHAN_VIEW_KEY, clearFilter, fileInGeneral, fileInSpace, focusAgentId, focusAgents, focusedAgent, focusMatches, focusOf, focusRows, hasFilter, INC, isWorking, KIT, matchesFocus, matchFilters, md, moveToChannel, paintPins, PIN, PIN_SVG, PINS_KEY, pinsOn, rememberedFocus, rerenderList, scrollBox, SEC_OPEN_KEY, SECTIONS_DAY, SECTIONS_STATUS, setFilter, setFocus, setupLate, SPACE, spaceAgent, spaceContains, spaceMember, spaces, spacesOf, STALE_LIST, STATUS, statusEntries, subjectOf, subjects, syncDocumentThread, threadOnScreen, threadViewportTop, TOPIC, topicOn, toTurns, visibleSpaces, watchTracker, WORKING_ST, bindLate: v => { if ('attOf' in v) attOf = v.attOf; if ('chanHold' in v) chanHold = v.chanHold; if ('channelBack' in v) channelBack = v.channelBack; if ('chanOwnPost' in v) chanOwnPost = v.chanOwnPost; if ('closeSpacePicker' in v) closeSpacePicker = v.closeSpacePicker; if ('deferredOf' in v) deferredOf = v.deferredOf; if ('elOf' in v) elOf = v.elOf; if ('openSpacePicker' in v) openSpacePicker = v.openSpacePicker; if ('PAGE' in v) PAGE = v.PAGE; if ('PW' in v) PW = v.PW; if ('rowAgent' in v) rowAgent = v.rowAgent; } };
};
