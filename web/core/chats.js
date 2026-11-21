/* Wizard UX core: Chats, a native Wizard client on the Wizard API. Shared by every shell.
 *
 * A list of threads, a thread view and a composer, on Wizard's own read state and the durable outbox.
 * The shell owns windows and layout and hands this module a host:
 *   win(id)          → { id, thread } for a Chats window (thread: null = list, '__new__' = new chat)
 *   root()           → element that contains every [data-chats=id] node of this shell
 *   save()           → persist the shell's window state
 *   layout(id)       → that window's content changed shape (re-tile, re-measure)
 *   toast(icon, text, ms), title(w), viewContext(id, how)
 *   visible()        → ids of windows on screen (their open threads count as read)
 *   front()          → (optional) id of the window in front; a new thread started while it shows a Space joins it
 *   editUnsent(item) → put an unsent message back into a composer
 *   newChatHint      → the line under "New chat" (the phone mentions the orb, the desktop its keys)
 *   openLink(url, title) → (optional) open a private-origin link in a window of this shell; return true if it did
 *   openApp(id, srcEl) → (optional) open an installed app, remembering the source window so Back returns to it
 *   keepThreadOpen   → (optional) desktop retains existing threads on sends and state actions
 *   keepNewOpen(id)  → (optional) a new chat sent from this window stays open (a chat docked beside an app panel)
 *   owner(id)        → (optional) the window a pane belongs to (the desktop's list pane id::list → id)
 *   overlay(open)         → (optional) the media viewer opened/closed (the phone arms its Back guard)
 *   vib(ms)               → (optional) haptic tick
 *   threadShown(id, el)   → (optional) a window painted a loaded thread (el) or its list (null); the phone binds
 *                           the view the latest reply links to that thread (bound views, app.js)
 *
 * Parsing, Markdown, local time, drafts, copy/share and the media viewer live in core/chat-kit.js
 * (window.WosChat), loaded before this file by both shells.
 *
 * The body below the shims is kept line-for-line identical to the original mobile code it came from
 * (app.js, Chats section), so in-flight branches that edit that section port over with
 * `tools/port-chats-patch.sh <branch>`.
 */
window.WizCore = window.WizCore || {};
// Retire legacy pinned windows before either shell normalizes/persists its desks.
// Preserve ordinary extra Chats/provider windows; only the old agent windows are folded away.
window.WizCore.migrateChatsFocus = function (wins, desks) {
  let main = Object.values(wins).find(w => w?.app === 'chats' && !w.agent && (!w.chatsProvider || w.chatsProvider === 'wizard-chats'));
  const dropped = new Set();
  for (const w of Object.values(wins)) if (w?.app === 'chats' && w.agent) {
    if (main) { dropped.add(w.id); delete wins[w.id]; }
    else { w.focus = { kind: 'agent', key: w.agent }; delete w.agent; w.chatsProvider = 'wizard-chats'; main = w; }
  }
  return desks.filter(d => {
    if (!d || !Array.isArray(d.wins)) return true; // desktop repairs malformed stored desks below
    const hadLegacy = d.wins.some(id => dropped.has(id));
    d.wins = d.wins.filter(id => !dropped.has(id));
    if (!d.wins.includes(d.focus)) d.focus = d.wins[0] || null;
    return !hadLegacy || d.wins.length || d.home;
  });
};
/* Channel emoji (wizard-ux issue 1506, switch wizard/chat-channels): a channel shows an emoji where the # was. The
 * emoji is the start of the channel's own name ("🚀 Launch"), so it syncs and renames with the name, a channel whose
 * owner already typed an emoji in front keeps it, and nothing new is stored. General is #️⃣; a name with no emoji
 * gets 💬. channelFace(name, general) → { emoji, label, own, title }; channelEmojiName(name, emoji) puts (or, with '', takes
 * off) the emoji in front of a name. The AI apps desktop reads these too. Issue 1523: a name that is only an emoji has
 * no words (label '', title the emoji once); taking that emoji off gives the name 'Channel' (shown with 💬); and an
 * emoji that would push the name past 60 characters gives '' (the caller says so) instead of cutting the name. */
window.WizCore.CHANNEL_EMOJI = ['💬', '🚀', '📌', '💡', '🛠️', '📅', '🎯', '📚', '🎨', '🎵', '💰', '🏠', '✈️', '❤️', '🌱', '⭐', '🔥', '🧪', '📝', '🤖', '👥', '🎉', '⚙️', '🌍'];
window.WizCore.channelFace = function channelFace(name, general = false) {
  const n = String(name || ''), m = n.match(/^(?:\p{RI}\p{RI}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:[\u{E0020}-\u{E007E}]+\u{E007F})?[\uFE0E\uFE0F]?\p{EMod}?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{EMod}?)*)/u);
  if (general) return { emoji: '#️⃣', label: n || 'General', own: false, title: `#️⃣ ${n || 'General'}` };
  if (!m) return { emoji: '💬', label: n, own: false, title: `💬 ${n}` };
  const bare = n.slice(m[0].length).replace(/^[\s\uFE0F]+/u, '');
  return { emoji: m[0], label: bare, own: true, bare, title: bare ? `${m[0]} ${bare}` : m[0] };
};
window.WizCore.channelEmojiName = function channelEmojiName(name, emoji) {
  const f = window.WizCore.channelFace(name), bare = f.own ? f.bare : String(name || '').trim();
  if (!emoji) return bare || 'Channel';
  // The 60-character limit (UTF-16, as the stores count it): a name that has no room for the emoji is never cut.
  const t = (emoji + (bare ? ' ' + bare : '')).trim();
  return t.length > 60 ? '' : t;
};
window.WizCore.chats = function createChats(H) {
  'use strict';
  const { esc, clip, norm, ago, emoOf } = window.WizCore;
  const LIVE = window.WizLive;
  const OUTBOX = window.WosOutbox || null;
  const reach = () => window.WizReach?.failure() || { short: 'Reconnecting…' };
  // Short line for a failing request; operation 'send' | 'read' (WizReach.label owns the wording).
  const reachLabel = (operation, count) => window.WizReach?.label ? window.WizReach.label(operation, { count }) : reach().short;
  const troubleshoot = '<button type="button" class="pbtn" data-chtroubleshoot>Open Troubleshooter</button>';
  /* ---- shims: the original body's names, backed by the host ---- */
  const W = new Proxy({}, { get: (_, id) => (typeof id === 'string' ? H.win(id) : undefined) });
  const track = { querySelector: sel => H.root().querySelector(sel) };
  const save = () => H.save();
  const toast = (...a) => H.toast(...a);
  const viewContext = (id, how) => H.viewContext(id, how);
  const winTitle = w => isHosted(w.id) ? LIVE?.session(w.thread)?.title || 'Thread' : H.title(w);
  const deskOf = id => id;
  const applyLayout = id => H.layout(id);
  const idx = 0, desks = [{ get wins() { return H.visible(); } }];
  const vib = ms => { if (H.vib) return H.vib(ms); try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
  /* ---- end shims ---- */

  // A hosted thread borrows the exact standard chat UI without replacing its app iframe.
  // Entries and thread fields are ephemeral: shell persistence must still restore the app.
  const hosted = new Map();
  // Apps admitted to open the standard thread over their window (app-services.js keeps the same list).
  // Wisdom (James, 22 Oct 2026): Ask AI is the real Chats thread, never an app-built chat.
  function openHosted(wid, frame, sid, opts = {}) {
    const w = W[wid];
    if (!w || !window.WizLauncher?.hasHostedThread(w.appId) || !frame?.isConnected || frame.closest('[data-win]')?.dataset.win !== wid) return false;
    // Refuse replacement while any hosted thread is open; the app is not front.
    if (opts.draft && hosted.has(wid)) return false;
    if (!prepThread(sid, opts)) return false;
    if (hosted.has(wid)) closeHosted(wid);
    const layer = document.createElement('div'); layer.className = 'chats hosted-thread'; layer.dataset.chats = wid;
    layer.style.cssText = 'position:absolute;inset:0;z-index:5;background:var(--wz-base,var(--base,#15151d));display:flex;flex-direction:column;min-height:0';
    const container = frame.parentElement;
    const oldPosition = container.style.position;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    const previous = Object.getOwnPropertyDescriptor(w, 'thread');
    Object.defineProperty(w, 'thread', { value: null, writable: true, configurable: true, enumerable: false });
    const entry = { frame, layer, container, oldPosition, previous, w };
    hosted.set(wid, entry);
    frame.inert = true; frame.style.visibility = 'hidden'; container.append(layer);
    openChat(wid, sid);
    if (opts.draft) requestAnimationFrame(() => { if (hosted.get(wid) === entry) layer.querySelector('.ch-compose textarea')?.focus({preventScroll:true}); });
    return true;
  }
  // What an app's thread brings along, wherever it opens (over the app, or the main Chats for a layout that keeps
  // chats apart from apps): its agent, and its item as the reply beside the thread's draft. False = not allowed.
  function prepThread(sid, opts = {}) {
    const rp = opts?.reply ? KIT.reply.clean(opts.reply) : null;
    // A newly-created agent thread may not be in the next session-list refresh yet.
    if (opts?.agent != null) {
      const a = typeof opts.agent === 'string' ? window.WosAgents?.get(opts.agent) : null;
      if (!a || a.status !== 'running' || !window.WosAgents.isOther(opts.agent) || typeof LIVE.pinAgent !== 'function') return false;
      if (opts.draft && !KIT.drafts.admit('direct:' + sid, opts.draft.text, rp)) return false;
      LIVE.pinAgent(sid, opts.agent);
    }
    else if (opts.draft && !KIT.drafts.admit('direct:' + sid, opts.draft.text, rp)) return false;
    // An app item (Wisdom passage) rides beside this thread's draft as its reply, framed only into the next message.
    // It never replaces one already waiting there, and the composer stays the owner's own words.
    if (rp && sid !== '__new__' && !KIT.drafts.get('direct:' + sid).reply) KIT.drafts.setReply('direct:' + sid, rp);
    return true;
  }
  function closeHosted(wid) {
    const entry = hosted.get(wid); if (!entry) return false;
    saveDraft(wid); const c = ch(wid); c.readNav = (c.readNav || 0) + 1;
    c.trail = []; c.loadedFor = ''; c.draftFor = '';
    hosted.delete(wid); entry.layer.remove(); entry.frame.inert = false; entry.frame.style.visibility = '';
    entry.container.style.position = entry.oldPosition;
    if (entry.previous) Object.defineProperty(entry.w, 'thread', entry.previous); else delete entry.w.thread;
    return true;
  }
  const isHosted = wid => hosted.has(wid);
  const CH = {}; // per window: { q, turns, loadedFor, loading, pending, err, at, show, files }
  const ch = id => (CH[id] = CH[id] || { q: '', turns: null, loadedFor: '', pending: [], at: 0 });
  // Android's built-in WebView capture scrolls the DOCUMENT, never an overflow div.
  // Keep the real thread and delegated events in their existing shell DOM.
  // Document scrolling needs an APK that dropped the custom scroll capture and scroll proxy; such APKs
  // say so in their user agent. Older APKs (any version line) keep inner-div scrolling.
  const androidDocument = /\bWizardOS-DocScroll\b/.test(navigator.userAgent);
  let docOwner = null, docFrame = 0, docResize = null, docObserved = [], visibleThreads = new Set();
  const scrollBox = nb => nb && docOwner?.contains(nb) ? document.scrollingElement : nb;
  // The one admission check for measuring, saving and restoring either scroll mode.
  function threadOnScreen(nb) {
    const el = nb?.closest('[data-chats]');
    return !!(el && nb.isConnected && H.visible().includes(el.dataset.chats) && el.getClientRects().length
      && nb.getClientRects().length && nb.querySelector('[data-morph-key]') && scrollBox(nb).clientHeight
      && (!androidDocument || docOwner === el));
  }
  const threadViewportTop = (nb, base) => globalThis.WosThreadTracker?.viewportTop(nb, base) ?? base;
  function watchTracker(w, nb) {
    if (!w?.thread || !globalThis.WosThreadTracker?.onFor?.(LIVE.agentOf?.(w.thread) || '')) return;
    globalThis.WosThreadTracker.watch(nb, { sid: w.thread, agent: LIVE.agentOf?.(w.thread) || '',
      active: () => W[w.id]?.thread === w.thread && threadOnScreen(nb) && (typeof H.front === 'function' ? H.front() === w.id : H.visible().length === 1 && H.visible()[0] === w.id) });
  }
  function sizeDocumentChrome() {
    if (!docOwner) return;
    const root = document.documentElement, vv = window.visualViewport;
    const keyboard = Math.max(0, innerHeight - (vv ? vv.height + vv.offsetTop : innerHeight));
    const header = docOwner.querySelector('.ch-head'), composer = docOwner.querySelector('.ch-compose'), sw = docOwner.querySelector('.ch-swrow');
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
    for (const nb of next) if (!visibleThreads.has(nb)) PW?.resume(nb);
    visibleThreads = next;
  }
  function syncDocumentThread() {
    if (!androidDocument) return restoreVisibleThreads();
    const next = H.visible().map(id => elOf(id)).find(el => el?.querySelector('.ch-thread') && el.getClientRects().length) || null;
    const root = document.documentElement;
    const returning = next !== docOwner;
    if (returning) {
      // Leaving document scroll puts the desk track's slide, the window padding and the header back in one style change.
      // With their transitions live that change animated: Back from a thread rode the track in from the side while the
      // list dropped down from the top (wizard-ux issue 1564). Swap the mode with transitions held, then hand them back.
      const path = [...document.querySelectorAll('.wos-doc-path,.wos-doc-thread')], held = path.map(n => n.style.transition);
      path.forEach(n => { n.style.transition = 'none'; n.classList.remove('wos-doc-path', 'wos-doc-thread'); });
      docResize?.disconnect(); docResize = null; docObserved = [];
      docOwner = next;
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
    if (typeof ResizeObserver === 'function' && (!docResize || nodes.length !== docObserved.length || nodes.some((n, i) => n !== docObserved[i]))) {
      docResize?.disconnect(); docObserved = nodes;
      const sizes = new WeakMap();
      docResize = new ResizeObserver(entries => {
        let changed = false;
        for (const e of entries) { const h = Math.round(e.contentRect.height), was = sizes.get(e.target); sizes.set(e.target, h); if (was !== undefined && was !== h) changed = true; }
        sizeDocumentChrome();
        if (changed) PW?.reflow(next.querySelector('.ch-msgs'));
      });
      nodes.forEach(n => docResize.observe(n));
    }
  }
  {
    const queueDocumentThread = () => { if (!docFrame) docFrame = requestAnimationFrame(() => { docFrame = 0; syncDocumentThread(); }); };
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
      if (e.target !== document || !docOwner) return;
      const nb = docOwner.querySelector('.ch-msgs'); if (!threadOnScreen(nb)) return;
      nb.dispatchEvent(new Event('scroll')); // existing save / following / scroll-idle guards
      const w = H.win(docOwner.dataset.chats), c = w && ch(w.id);
      if (w && document.scrollingElement.scrollTop <= 1 && c.show < (c.turns?.length || 0) && !c.docEarlier) {
        c.docEarlier = true;
        c.show = (c.show || PAGE) + PAGE;
        renderThread(w, docOwner, true);
        setTimeout(() => { c.docEarlier = false; }, 350);
      }
    }, { passive: true });
    const resizeDocument = () => {
      if (!docOwner) return;
      sizeDocumentChrome(); requestAnimationFrame(() => PW?.reflow(docOwner?.querySelector('.ch-msgs')));
    };
    window.visualViewport?.addEventListener('resize', resizeDocument);
    window.addEventListener('resize', resizeDocument);
  }
  /* Pins, Boomerang, topic emojis, list layouts and the Focus; core/chats-setup.js. */
  const { agoText, BOOM, byStatus, fileInGeneral, fileInSpace, focusedAgent, INC, isWorking, KIT, matchFilters, md, paintPins, PIN, PIN_SVG, PINS_KEY, pinsOn, SEC_OPEN_KEY, SECTIONS_DAY, SECTIONS_STATUS, setFilter, SPACE, spaceAgent, spaceContains, spaceMember, spaces, SPACES_KEY, spacesOf, STALE_LIST, STATUS, statusEntries, subjectOf, subjects, TOPIC, topicOn, toTurns, visibleSpaces, WORKING_ST, bindLate: setupLate } = window.WizCore.chatsParts.setup({ AGS: (...a) => AGS(...a), attOf: (...a) => attOf(...a), ch, channelsOn: (...a) => channelsOn(...a), chanStoreMove, chanStoreSpaces, chatsBack, deferredOf: (...a) => deferredOf(...a), elOf: (...a) => elOf(...a), focusAgents, growTa, LIVE, norm, rerenderList, toast, W });
  // Move to channel… from a row a layout draws itself (the AI apps Activity rows): the same picker as a feed's row menu.
  function moveToChannel(wid, sid) {
    const w = W[wid]; if (!w || !sid || typeof channelsOn !== 'function' || !channelsOn()) return false;
    // The row's own owner (Activity keeps the main row when a routed thread shares its id), not the id-global pin.
    const row = LIVE.session?.(sid), agent = row ? rowAgent(row) : LIVE.agentOf(sid) || AGS()?.defaultId() || 'hermes';
    openSpacePicker(w, agent, null, { sid }); return !!spacePicker;
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
    // With channels on, the agent tab opens the agent (its label never names a channel, wizard-ux issue 1340).
    const o = W[owner(w.id)] || w, m = typeof channelsOn === 'function' && channelsOn() ? null : o?.agentFocus?.[agent];
    return m?.kind === 'space' && spaces().some(s => s.id === m.key && spaceAgent(s) === agent) ? m : { kind: 'agent', key: agent };
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
  /* Channels view (switch wizard/chat-channels, off by default; wizard-ux issue 1254). A channel IS a Space (same
   * storage, same one-Space-per-chat rule); chats in no Space make a virtual General that is never stored. Activity
   * is today's list plus a muted "# channel" on each row. Channels lists the Spaces (pinned first, then A–Z or Z–A,
   * General last, archived ones in a folded Archive); opening one is a Space Focus drawn as a feed of posts, each the
   * owner's first message with its pictures, so the New chat button files into it through the Space-fixed-at-send path.
   * Back: thread → channel → list. James's review (10 Nov 2026) set the post, wording, order, sheet and Archive. */
  const CHAN_SWITCH = 'wizard/chat-channels', CHAN_VIEW_KEY = 'wos.chats.view.v1', CHAN_GENERAL = '__general__', CHAN_DAY = 864e5;
  // Sort, pins and archive live on this device until Agent Service has shared fields for them (wizard-agent-service
  // issue 447). An archived channel leaves Archive once nothing in it moved for this many days (a setting can come later).
  const CHAN_PREFS_KEY = 'wos.chats.channel-prefs.v1', CHAN_ARCHIVE_PRUNE_DAYS = 30, CHAN_CLAMP = 200, CHAN_TEXT_MAX = 4000;
  const channelsOn = () => { try { return (document.documentElement.dataset.tweaks || '').split(' ').includes(CHAN_SWITCH); } catch (_) { return false; } };
  let chanView = (() => { try { return localStorage.getItem(CHAN_VIEW_KEY) === 'channels' ? 'channels' : 'activity'; } catch (_) { return 'activity'; } })();
  const chanExpanded = new Set(), chanMore = new Set();
  let chanArchOpen = false;
  /* Mark done and Needs you; core/chats-done.js. */
  const { canMarkDone, chanArchived, chanNeeds, chanPrefs, handledNow, jumpGo, jumpOpened, jumpPillsHtml, MARK_DONE_SVG, markDone, markDoneOn, needsAsk, needsLand, needsMark, needsReplied, needsThreadOn, paintFeedJump, paintJump, replyStd, setChanPrefs, bindLate: doneLate } = window.WizCore.chatsParts.done({ attOf: (...a) => attOf(...a), ch, CH, CHAN_PREFS_KEY, channelsOn, chanSeenPaint, chanStore: (...a) => chanStore(...a), chanStorePrefs, elOf: (...a) => elOf(...a), esc, isWorking, LIVE, owner: (...a) => owner(...a), paintListsNow, renderThreadNow, rowOf: (...a) => rowOf(...a), scrollBox, threadOnScreen, threadViewportTop, toast, vib, W });
  /* Phase 2 (wizard-ux issue 1261; wizard-agent-service issue 440, docs/chats-channels.md): with the switch on and the
   * box's channel store answering (GET /wizard/v1/channels is 200; 404 while its WIZARD_CHANNEL_STORE is off or on an
   * older service), the channels, their sort, pins and archive are the box's, the same on every device (this also
   * covers wizard-agent-service issue 447), and the seeded Alerts channel sits pinned at the top like any pin. A chat's
   * channel is its list row's `channel` (else the ui-preferences projection the store serves, or a move this device
   * just made); filing and moving are the store's atomic PUT membership with the row's own agent. A channel feed adds
   * the channel's own list (view=list&channel=) to the live rows. With the store off everything stays on Spaces. */
  const chanStore = () => (channelsOn() && LIVE.chanStore?.state?.()) || null;
  const storeAgent = a => !a || a === (AGS()?.defaultId() || 'hermes') ? 'hermes' : a;
  const CHAN_STORE_MAX = 200, CHAN_FEED_DAYS = 30;
  function chanStorePrefs(st) {
    const pins = st.channels.filter(c => c.pinned).sort((a, b) => a.pinOrder - b.pinOrder || (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0)).map(c => c.id);
    return { sort: st.sort, pins, archived: Object.fromEntries(st.channels.filter(c => c.archived).map(c => [c.id, c.archivedAt || c.createdAt || new Date(0).toISOString()])), store: true };
  }
  // A sort, pin or archive edit: the store's PATCH when it is on, else this device's prefs (p already changed).
  function chanPrefEdit(p, body) { if (p.store && LIVE.chanStore) LIVE.chanStore.patch(body); else setChanPrefs(p); }
  let chanStoreMemo = null;
  function chanStoreSpaces(proj) {
    const st = chanStore(); if (!st) return null;
    const S = LIVE.chanStore, tick = LIVE.ticks || 0;
    if (chanStoreMemo && chanStoreMemo.rev === st.rev && chanStoreMemo.proj === proj && chanStoreMemo.tick === tick) return chanStoreMemo;
    const byId = new Map(st.channels.map(c => [c.id, c])), where = new Map();
    for (const sp of proj) { const c = byId.get(sp.id); if (c) for (const t of sp.threads) where.set(c.agent + '|' + t, c.id); }
    // A row's own channel outranks the projection (newest 500 of open channels only); a move made here outranks both.
    for (const list of [LIVE.sessions || [], ...Object.values(LIVE.agentSessions || {}), S.rows?.() || []]) for (const s of list) if (s && typeof s.channel === 'string') where.set(storeAgent(rowAgent(s)) + '|' + s.id, s.channel);
    for (const [k, to] of S.moves?.() || []) where.set(k, to);
    const threads = new Map(st.channels.map(c => [c.id, []]));
    for (const [k, cid] of where) { const c = cid && byId.get(cid), i = k.indexOf('|'); if (c && k.slice(0, i) === c.agent) threads.get(cid).push(k.slice(i + 1)); }
    const list = st.channels.map(c => ({ id: c.id, name: c.name, ...(c.agent === 'hermes' ? {} : { agent: c.agent }), threads: threads.get(c.id), createdAt: c.createdAt, ...(c.kind ? { kind: c.kind } : {}) }));
    chanStoreMemo = { rev: st.rev, proj, tick, list, sets: new Map(list.map(s => [s.id, new Set(s.threads)])) };
    return chanStoreMemo;
  }
  // Filing on the store: true/false as spaceMember answers, null = the store is off (Spaces as before). The chat goes
  // only into its own agent's channel (the store would refuse another's with a 409).
  function chanStoreMove(key, sid, add, agent) {
    const st = chanStore(); if (!st) return null;
    const c = st.channels.find(x => x.id === key); if (!c) return false;
    const a = agent === undefined ? c.agent : storeAgent(agent);
    if (a !== c.agent || (!add && !spaceContains(key, sid))) return false;
    LIVE.chanStore.move(sid, add ? key : null, a);
    return true;
  }
  // The row a window shows for this id, by its own agent (a main and a routed thread can share an id).
  const chanRowAgent = (wid, sid) => { const r = rowOf(wid, sid); return r && r.id === sid ? rowAgent(r) : undefined; };
  // A channel's feed: the live rows plus the channel's own list from the store (newest posts of the last 30 days).
  function chanFeedRows(open, rows) {
    if (!open || open.general || open.agentFeed || !chanStore()) return rows;
    const f = LIVE.chanStore.feed(open.id, storeAgent(open.agent));
    if (!f?.rows?.length) return rows;
    const have = new Set(rows.map(chanKey)), cut = Date.now() - CHAN_FEED_DAYS * CHAN_DAY;
    return rows.concat(f.rows.filter(s => !s.hidden && !have.has(chanKey(s)) && chanAt(s) >= cut));
  }
  // Once per device, the first time the store answers: this device's own pins and archive move onto it (a pin or an
  // archive is only ever added, never undone here; the sort stays the box's, since another device may have chosen it).
  // Recorded as carried only once every write landed; a failed one is tried again a minute later.
  const CHAN_CARRY_KEY = 'wos.chats.channel-prefs.carried.v1';
  let chanCarried = false, chanCarryAfter = 0;
  async function chanCarry() {
    const st = chanStore(); if (!st) return false;
    try { if (localStorage.getItem(CHAN_CARRY_KEY)) return true; } catch (_) { return false; }
    let v = null; try { v = JSON.parse(localStorage.getItem(CHAN_PREFS_KEY) || 'null'); } catch (_) {}
    const byId = new Map(st.channels.map(c => [c.id, c])), edits = [];
    if (v && typeof v === 'object') {
      const arch = v.archived && typeof v.archived === 'object' ? v.archived : {};
      for (const id of Array.isArray(v.pins) ? v.pins : []) { const c = byId.get(id); if (c && !c.pinned && !c.archived && !arch[id]) edits.push({ id, pinned: true }); }
      for (const id of Object.keys(arch)) { const c = byId.get(id); if (c && !c.archived) edits.push({ id, archived: true, ...(c.pinned ? { pinned: false } : {}) }); }
    }
    const done = (await Promise.all(edits.map(b => LIVE.chanStore.patch(b)))).every(r => r && r.ok);
    if (done) { try { localStorage.setItem(CHAN_CARRY_KEY, new Date().toISOString()); } catch (_) {} }
    else { chanCarried = false; chanCarryAfter = Date.now() + 60e3; }
    return done;
  }
  /* Channel list, order, a row's channel and opening a channel; core/chats-channels.js. */
  const { chanAt, chanElsewhere, chanFace, chanName, channelBack, channelOf, channelsFor, chanOpen, chanPostOrder, chanPruned, chanSide, chanSwitchedOff, chanTarget, chanTitle, DAILY_HIST, DAILY_LAST, DAILY_OPEN, dailyChan, inChannel, openChannel, rowAgent, bindLate: channelsLate } = window.WizCore.chatsParts.channels({ agentName: (...a) => agentName(...a), AGS: (...a) => AGS(...a), CHAN_ARCHIVE_PRUNE_DAYS, CHAN_DAY, CHAN_GENERAL, chanAgentId: (...a) => chanAgentId(...a), channelsOn, chanPrefs, chanStore, focusAgents, focusedAgent, focusOf, H, LIVE, openDaily, owner: (...a) => owner(...a), save, setFocus, spaceAgent, spaceContains, spaces, spacesOf, visibleSpaces, W });
  let dailyNext = null;
  // Only while the window still shows the thread Daily opened (a list window may move its thread without openChat).
  const dailyOn = w => !!w?.daily && w.daily.sid === w.thread && channelsOn() && !!LIVE.chanDaily && !!dailyChan(w.daily.id);
  const dailyState = w => dailyOn(w) ? LIVE.chanDaily.state(w.daily.id) : null;
  const dailyName = w => dailyOn(w) ? dailyChan(w.daily.id).name : '';
  const dailyHead = st => st?.days?.[0]?.sessionId || '__new__';
  const dailyPin = (sid, agent) => { if (sid && sid !== '__new__' && agent && agent !== 'hermes') LIVE.pinAgent?.(sid, agent); };
  function dailyLast(id, sid) {
    let v = {}; try { v = JSON.parse(localStorage.getItem(DAILY_LAST) || '{}') || {}; } catch (_) {}
    if (sid === undefined) return typeof v[id] === 'string' ? v[id] : '';
    v[id] = sid; try { localStorage.setItem(DAILY_LAST, JSON.stringify(v)); } catch (_) {}
    return sid;
  }
  // A tap on Daily: its newest thread in this window (the AI apps sidebar: in the main chat column, as a row tap does).
  // The box is asked again on every tap (another device may have started today's thread): a quick answer picks the
  // thread, a slow one lets the kept copy open at once and moves the view on when it lands (dailyFollow).
  const DAILY_WAIT = 800;
  function openDaily(w, id) {
    const c0 = dailyChan(id); if (!c0 || !LIVE.chanDaily || !w) return false;
    let done = false; const start = w.thread;
    const go = () => {
      if (done) return true; done = true;
      if (w.thread !== start) return false; // the window moved on while the box was asked
      const st = LIVE.chanDaily.state(id);
      if (!st.ok && !st.days.length) return openChannel(w, id, true); // never read and unreachable: the plain feed
      const sid = dailyHead(st); st.days.forEach(d => dailyPin(d.sessionId, c0.agent));
      dailyNext = { sid, daily: { id, agent: c0.agent }, at: Date.now() };
      openChat(w.id, sid);
      if (fresh) fresh.then(() => dailyFollow(id, sid));
      return true;
    };
    const fresh = Promise.resolve(LIVE.chanDaily.read(id)).catch(() => {});
    const st = LIVE.chanDaily.state(id);
    fresh.then(go);
    if (st.ok || st.days.length) setTimeout(go, DAILY_WAIT);
    return true;
  }
  // The days read after a Daily view opened on the kept copy: a newer day there moves every window still showing that
  // view on the thread it opened, words in its box going along.
  function dailyFollow(id, sid) {
    const st = LIVE.chanDaily?.state(id), head = dailyHead(st); if (!st || head === sid || head === '__new__') return;
    if (sid !== '__new__' && !(st.days.findIndex(d => d.sessionId === head) < st.days.findIndex(d => d.sessionId === sid))) return;
    for (const wid of Object.keys(CH)) {
      const w = W[wid]; if (!w || !dailyOn(w) || w.daily.id !== id || w.thread !== sid) continue;
      const ta = elOf(wid)?.querySelector?.('.ch-compose textarea'); if (ta) ch(wid).draft = ta.value;
      saveDraft(wid);
      dailyNext = { sid: head, daily: { id, agent: w.daily.agent }, at: Date.now(), from: draftKey(w) };
      openChat(wid, head);
    }
  }
  // openChat's hook: the thread a Daily tap (or a send that moved to a new day) opened takes the Daily view; any other
  // open leaves it. A draft typed on the day before follows the view to the new day's thread.
  function dailyClaim(w, sid) {
    const n = dailyNext;
    if (n && n.sid === sid && Date.now() - n.at < 5000) {
      // A Chats list window (the AI apps sidebar's id::side) sets its base window's thread: that window takes the view.
      const lw = /::(list|side)$/.test(String(w.id)) && W[String(w.id).replace(/::(list|side)$/, '')];
      if (lw && lw !== w && lw.thread === sid) w = lw;
      dailyNext = null; w.daily = { id: n.daily.id, agent: n.daily.agent, sid };
      const last = dailyLast(n.daily.id), from = n.from || (last && last !== sid ? 'direct:' + last : '');
      const to = sid === '__new__' ? '' : 'direct:' + sid;
      if (from && to && from !== to) {
        const a = KIT.drafts.get(from), b = KIT.drafts.get(to);
        if (hasContent(a.text, a.files) && !hasContent(b.text, b.files)) { KIT.drafts.set(to, a.text, a.files); KIT.drafts.clear(from); loadDraft(w); }
      }
      if (sid !== '__new__') dailyLast(n.daily.id, sid);
      save();
      if (lw === w) { const el = elOf(w.id); if (el) renderThread(w, el); }
      return true;
    }
    if (w.daily) { delete w.daily; save(); }
    return false;
  }
  // sendChat's hook: the thread a send from the Daily view goes to, pinned at the tap: today's, as the box names it.
  // When the day moved on (or this is the day's first post) and the window still shows the view, it opens today's thread
  // first, taking the box with it. Unreachable: the day thread on screen at the tap takes it (the words are never lost).
  async function dailyTarget(w) {
    const d = w?.daily; if (!d || !dailyOn(w)) return '';
    const was = w.thread;
    let r = null; try { r = await LIVE.chanDaily.today(d.id); } catch (_) { return was; }
    if (!r?.sessionId) return was;
    dailyPin(r.sessionId, d.agent);
    if (r.sessionId === was) return was;
    if (W[w.id] === w && w.daily === d && w.thread === was) {
      // The box as it is now: the words being sent already left it (the send clears the field before it asks).
      const ta = elOf(w.id)?.querySelector?.('.ch-compose textarea'); if (ta) ch(w.id).draft = ta.value;
      saveDraft(w.id);
      dailyNext = { sid: r.sessionId, daily: d, at: Date.now(), from: draftKey(w) };
      openChat(w.id, r.sessionId);
    }
    LIVE.chanDaily.read(d.id);
    return r.sessionId;
  }
  /* The Daily view, unread and Activity marks; core/chats-daily.js. */
  const { actMark, actNeeds, actRowMark, actUnread, agentLabelOf, chanDraftMark, chanUnread, chanUnreadN, dailyClick, dailyHtml, dailyLinkTo, dailyWatch, draftTag, rowDraft, bindLate: dailyLate } = window.WizCore.chatsParts.daily({ agentName: (...a) => agentName(...a), AGS: (...a) => AGS(...a), CH, chanElsewhere, chanNeeds, channelsOn, chanOpen, clip, DAILY_HIST, DAILY_OPEN, dailyOn, dailyPin, dailyState, deferredOf: (...a) => deferredOf(...a), elOf: (...a) => elOf(...a), esc, holdList: (...a) => holdList(...a), isWorking, KIT, LIVE, renderChatList, renderThread, rowAgent, toTurns, W });
  // Activity always shows every agent (the agent chips left it): a list still focused on one agent or a Space from
  // before goes back to All, unless a channel's or an agent's feed is open in it. A window opened for one agent keeps it.
  function actAllAgents(w, side = false) {
    if (!channelsOn() || side || chanView !== 'activity' || !w || chanOpen(w)) return false;
    const o = W[owner(w.id)] || w; if (!o || !o.focus || o.agent) return false;
    o.focus = null; save(); return true;
  }
  /* Agents in the Channels list (issue 1336; James: "putting them in the channels section … have that collapsed"): a
   * folded Agents row just above Archive, one line per visible agent (the main one first), each with a channel's own
   * aggregate marker. An agent opens like a channel: a feed of every thread with that agent across its channels (its
   * Focus), whose message box starts a new thread with it in General. Hidden while only one agent is installed. */
  const CHAN_AGENT = '@agent:';
  let chanAgentsOpen = false;
  const chanAgentId = id => typeof id === 'string' && id.startsWith(CHAN_AGENT) ? id.slice(CHAN_AGENT.length) : '';
  function chanAgentsList() {
    const ags = typeof focusAgents === 'function' ? focusAgents() : [], main = AGS()?.defaultId?.() || 'hermes';
    return ags.length > 1 ? ags.slice().sort((a, b) => Number(b.id === main || !!b.is_default) - Number(a.id === main || !!a.is_default)) : [];
  }
  function chanAgentsSec(rows) {
    const list = chanAgentsList(); if (!list.length) return '';
    const lines = chanAgentsOpen ? list.map(a => {
      const mine = rows.filter(s => !s.archived && rowAgent(s) === a.id), un = chanUnreadN(mine);
      const name = typeof agentName === 'function' ? agentName(a.id) : (a.label || a.id);
      return `<div class="ch-chan ch-chan-agent${un ? ' unread' : ''}" data-morph-key="chan:${esc(CHAN_AGENT + a.id)}"><div class="ch-chan-r"><button type="button" class="ch-chan-open" data-chchan="${esc(CHAN_AGENT + a.id)}" title="Open ${esc(name)}"><span class="ch-chan-sig" aria-hidden="true">${AGS()?.sigil?.(agentRec(a.id)) || ''}</span><b>${esc(name)}</b>${typeof chanDraftMark === 'function' ? chanDraftMark({ id: CHAN_AGENT + a.id, agent: a.id }) : ''}${chanMark(mine, false, un)}</button></div></div>`;
    }).join('') : '';
    return `<section class="ch-sec ch-chan-agents${chanAgentsOpen ? ' open' : ''}" data-sec="chan-agents"><button type="button" class="ch-sec-h" data-chchanagents aria-expanded="${chanAgentsOpen}"><span>Agents</span><small>${list.length}</small><i aria-hidden="true"></i></button>${chanAgentsOpen ? `<div class="ch-sec-b">${lines}</div>` : ''}</section>`;
  }
  /* Undo after an archive and channel read-mark names; core/chats-undo.js. */
  const { actRestore, actUndo, CHAN_READ_KEY, CHAN_READ_MAX, CHAN_READ_MS, CHAN_READ_SYNC, CHAN_READ_UP_MS, chanActs } = window.WizCore.chatsParts.undo({ channelsOn, esc, LIVE, paintListsNow, toast, vib });
  let chanReadDoc = null, chanReadT = 0, chanReadPaintT = 0;
  let chanReadUpAt = -Infinity;
  // The box's marks (key -> ms) while Channels are on and the box keeps them, else null.
  const chanReadBox = () => {
    try { if (!(document.documentElement.dataset.tweaks || '').split(' ').includes(CHAN_READ_SYNC)) return null; } catch (_) { return null; }
    const box = (typeof LIVE !== 'undefined' && LIVE.chanReads?.marks?.()) || null;
    if (box && Date.now() - chanReadUpAt >= CHAN_READ_UP_MS) chanReadUp(box);
    return box;
  };
  /* This device's marks that are ahead of the box's go up: after each local write, and at most every CHAN_READ_UP_MS
   * when the box answers, so a write that failed (offline, busy) or one made while the switch was off still reaches
   * the box later. Once the box has them nothing is sent. */
  function chanReadUp(box) {
    chanReadUpAt = Date.now();
    const up = Object.entries(chanReads().at).filter(([k, t]) => !(box[k] >= t)).sort((x, y) => y[1] - x[1]).slice(0, 300);
    if (up.length) LIVE.chanReads.push(Object.fromEntries(up));
  }
  function chanReadParse() {
    let v = null; try { v = JSON.parse(localStorage.getItem(CHAN_READ_KEY) || 'null'); } catch (_) {}
    if (!v || typeof v !== 'object' || !Number.isFinite(v.since) || !v.at || typeof v.at !== 'object') return null;
    return { since: v.since, at: Object.fromEntries(Object.entries(v.at).filter(([, t]) => Number.isFinite(t))) };
  }
  function chanReads() {
    if (chanReadDoc) return chanReadDoc;
    const v = chanReadParse(); chanReadDoc = v || { since: Date.now(), at: {} };
    if (!v) chanReadSave(true); // since is kept at once: it must not move on the next load
    return chanReadDoc;
  }
  // Written with the newer of each mark (another tab of this device may have moved one meanwhile), newest kept.
  function chanReadSave(now = false) {
    const put = () => {
      clearTimeout(chanReadT); chanReadT = 0; const d = chanReadDoc; if (!d) return;
      const was = chanReadParse(); if (was) { d.since = Math.min(d.since, was.since); for (const [k, t] of Object.entries(was.at)) if (!(d.at[k] >= t)) d.at[k] = t; }
      const at = Object.entries(d.at).sort((a, b) => b[1] - a[1]).slice(0, CHAN_READ_MAX); d.at = Object.fromEntries(at);
      try { localStorage.setItem(CHAN_READ_KEY, JSON.stringify({ since: d.since, at: d.at })); } catch (_) {}
      // The same marks to the box (issue 471): every one this device holds ahead of it.
      const box = chanReadBox(); if (box) chanReadUp(box);
    };
    if (now) put(); else if (!chanReadT) chanReadT = setTimeout(put, CHAN_READ_MS);
  }
  try {
    window.addEventListener('pagehide', () => { if (chanReadT) chanReadSave(true); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && chanReadT) chanReadSave(true); });
    window.addEventListener('storage', e => { if (e.key === CHAN_READ_KEY && !chanReadT) { chanReadDoc = null; chanReadPaint(); } });
  } catch (_) {}
  // A channel is its agent and id. General focused on one agent shows only that agent's posts, so it has its own mark
  // (general|<agent>); the All General covers every agent's, so reading it to a time reads each focused one too.
  const chanReadKey = (c, gAg = '') => !c || c.agentFeed ? '' : c.general || c.id === CHAN_GENERAL ? (gAg ? 'general|' + storeAgent(gAg) : 'general') : storeAgent(c.agent) + '|' + c.id;
  const chanReadOwn = key => { const d = chanReads(), box = chanReadBox(), own = d.at[key] ?? d.since; return box && Number.isFinite(box[key]) ? Math.max(own, box[key]) : own; };
  const chanReadAt = key => { const own = chanReadOwn(key); return key.startsWith('general|') ? Math.max(own, chanReadOwn('general')) : own; };
  const chanGenAgent = w => { try { return focusAgentId(W[owner(w.id)] || w) || ''; } catch (_) { return ''; } };
  // Changed after the mark. A working post waits for its reply; a Done or snoozed-last one is not new (Activity's rule).
  const chanChanged = (s, mark) => !isWorking(s) && !s.archived && !(snoozeLast() && deferredOf(s)) && chanAt(s) > mark && !(typeof handledNow === 'function' && handledNow(s));
  const chanNewCount = (c, rows, gAg = '') => { const mark = chanReadAt(chanReadKey(c, gAg)); return rows.filter(s => chanChanged(s, mark)).length; };
  // Only ever forward. The channel lists on screen (the phone's list, the desktop's sidebar pane) show it at once.
  function chanReadTo(key, t) {
    if (!key || !Number.isFinite(t)) return false;
    const d = chanReads(); if (t <= chanReadOwn(key)) return false;
    d.at[key] = t; chanReadSave();
    clearTimeout(chanReadPaintT); chanReadPaintT = setTimeout(chanReadPaint, 120);
    return true;
  }
  function chanReadPaint() { if (!channelsOn()) return; for (const id of Object.keys(CH)) { const x = W[id]; if (!x || x.thread || chanOpen(x) || holdList(id)) continue; const el = elOf(id); if (el) renderChatList(x, el); } }
  // Issue 1380: the box's channel list changed (right after Channels turns on, its first answer brings Alerts): the
  // lists on screen show it at once, also one the shells' Live repaint skips while focus sits inside it.
  let chanListSig = '';
  LIVE?.onChange?.(() => {
    if (!channelsOn()) { chanListSig = ''; return; }
    // every field the list shows or sorts by (another device's sort, pin order or reorder too, Codex P2)
    const st = chanStore(), sig = st ? JSON.stringify([st.sort, st.channels]) : '';
    if (sig === chanListSig) return;
    chanListSig = sig; clearTimeout(chanReadPaintT); chanReadPaintT = setTimeout(chanReadPaint, 120);
  });
  /* How far the owner has read a feed: every post whose top is above the bottom of his view, but never past a post of
   * the channel that changed and he has not seen: one still below the view, or one the feed's filter (Open, Needs you)
   * leaves out (the mark is a time and the feed is in posting order: a new reply on an old post must not read a newer
   * post he has not reached). At the end of an unfiltered feed that is its newest post. */
  function chanReadFeed(wid, sc, feed) {
    const w = W[wid], open = w && chanOpen(w), m = chanActs[wid];
    if (!open || !m || m.key !== chanReadKey(open, open.general ? chanGenAgent(w) : '') || !sc?.clientHeight || !feed) return false;
    const mark = chanReadAt(m.key), edge = sc.getBoundingClientRect().top + sc.clientHeight, past = new Set();
    for (const n of feed.querySelectorAll('[data-morph-key]')) if (n.getBoundingClientRect().top < edge) { past.add(n.dataset.morphKey); if (n.dataset.chrow) past.add('row:' + n.dataset.chrow); }
    let seen = -Infinity, cap = Infinity;
    for (const p of m.rows) {
      if (p.shown && (past.has('row:' + p.row) || past.has(p.post))) seen = Math.max(seen, p.at);
      else if (p.changed && p.at > mark) cap = Math.min(cap, p.at - 1);
    }
    return chanReadTo(m.key, Math.min(seen, cap));
  }
  // Opening a post marks it read (LIVE.markSeen). The desktop keeps the feed on screen beside the thread, and its
  // list pane skips Live repaints while focus is inside it (the tapped post), so the feed is painted here at once:
  // the line and the channel are already read when Back lands on them, never a frame late.
  // The row to mark read when a thread opens from a window: with Channels on, the window's own row (rowOf: a routed
  // channel's post can share its id with a main thread, and the id-only lookup would mark the main one), else the id.
  function chanSeenRow(wid, sid) {
    if (!channelsOn()) return sid;
    const r = rowOf(wid, sid);
    return r && r !== LIVE.session(sid) ? r : sid;
  }
  function chanSeenPaint() {
    if (!channelsOn()) return;
    // Activity too (issue 1336): an opened green thread leaves Ready at once, also in the list pane beside the thread
    // that the desktop's Live repaint skips while focus is inside it.
    for (const id of Object.keys(CH)) { const x = W[id]; if (!x || x.thread || !(chanOpen(x) || chanView === 'activity') || holdList(id)) continue; const el = elOf(id); if (el) renderChatList(x, el); }
  }
  /* A channel's line in the list; core/chats-chanline.js. */
  const { chanMark, channelLine, chanNewAgent } = window.WizCore.chatsParts.chanline({ AGS: (...a) => AGS(...a), CHAN_DAY, chanAt, chanDraftMark, chanExpanded, chanFace, chanNeeds, chanNewCount, chanPrefs, chanStore, chanUnread, chanUnreadN, esc, focusAgents, focusedAgent, focusOf, inChannel, isWorking, PIN_SVG, spaceAgent, spaces });
  // + New channel (wizard-ux issue 1308): the existing name form, opened straight on its input; Esc or outside cancels.
  function chanNewForm(w, tab = null) {
    const a = w && chanNewAgent(w); if (!a) return false;
    openSpacePicker(w, a, tab, { naming: true, from: w.id, direct: true });
    return !!spacePicker;
  }
  // Only the list's + New channel row opens it: + / ⌥N on the Channels list start a new chat (wizard-ux issue 1489).
  function channelsBody(w, rows) {
    if (typeof chanCarry === 'function' && !chanCarried && Date.now() >= chanCarryAfter && chanStore()) { chanCarried = true; chanCarry(); }
    const now = Date.now(), arch = channelsFor(w, { archived: true }).filter(c => !chanPruned(c, rows, now));
    // The channel whose feed shows in the main column (AI apps sidebar): marked in the list, which stays as it is.
    const cur = chanElsewhere(w) ? String(H.channelCurrent?.() || '') : '', gAg = chanGenAgent(w), dAg = typeof winAgent === 'function' ? winAgent(w) : ''; // (tests slice the list without it)
    // Archive: folded by default, in the Activity Archive section's own style; its chats stay where they are.
    const archSec = arch.length ? `<section class="ch-sec ch-chan-arch${chanArchOpen ? ' open' : ''}" data-sec="chan-archive"><button type="button" class="ch-sec-h" data-chchanarch aria-expanded="${chanArchOpen}"><span>Archive</span><small>${arch.length}</small><i aria-hidden="true"></i></button>${chanArchOpen ? `<div class="ch-sec-b">${arch.map(c => channelLine(c, rows, now, cur, gAg, dAg)).join('')}</div>` : ''}</section>` : '';
    // + New channel (wizard-ux issue 1308): the list's last row after General, in the accent colour; it opens the
    // existing name form (openSpacePicker naming) for the agent this list shows.
    const add = chanNewAgent(w) ? '<button type="button" class="ch-chan-add" data-chchannew aria-haspopup="dialog"><span class="ch-chan-hash" aria-hidden="true">+</span><b>New channel</b></button>' : '';
    // Agents (issue 1336): a folded row just above Archive, so Archive stays last.
    const agents = typeof chanAgentsSec === 'function' ? chanAgentsSec(rows) : '';
    return `<div class="ch-chan-list">${channelsFor(w).map(c => channelLine(c, rows, now, cur, gAg, dAg)).join('')}${add}${agents}${archSec}</div>`;
  }
  /* Channel posts (switch wizard/chat-channels): first message, words, reply counts, feed place; core/chats-posts.js. */
  const { chanHold, chanKey, chanNewN, chanPostText, chanRepaint, chanReplies, chanScrolled, chanStart, chanUser, chanUserAt, FIRST, firstAgent, firstPost, firstWant, pullFirst, replyWant } = window.WizCore.chatsParts.posts({ ch, CH, CHAN_TEXT_MAX, chanChanged, chanGenAgent, channelsOn, chanOpen, chanReadAt, chanReadFeed, chanReadKey, elOf: (...a) => elOf(...a), holdList: (...a) => holdList(...a), isWorking, LIVE, mediaOfFile: (...a) => mediaOfFile(...a), owner: (...a) => owner(...a), paintFeedJump, rerenderList, rowAgent, toTurns, W });
  channelsLate({ chanHold, chanUserAt });
  doneLate({ chanUser });
  /* A channel's feed; core/chats-feed.js. */
  const { channelFeed, bindLate: feedLate } = window.WizCore.chatsParts.feed({ agentName: (...a) => agentName(...a), agentRec, ago, AGS: (...a) => AGS(...a), CHAN_CLAMP, chanActs, chanArchived, chanAt, chanChanged, chanGenAgent, chanKey, chanMore, chanNeeds, chanNewN, chanPostOrder, chanPostText, chanReadKey, chanReplies, chanStart, chanUnread, esc, firstAgent, firstPost, firstWant, focusedAgent, focusOf, inChannel, isWorking, KIT, LIVE, pullFirst, replyWant });
  function chanHead(w, open) {
    if (open) return `<div class="ch-chan-h"><button type="button" class="ch-chan-back" data-chchanback aria-label="Back to channels"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button><b>${open.agentFeed ? `<span class="ch-chan-sig" aria-hidden="true">${AGS()?.sigil?.(agentRec(open.agent)) || ''}</span>` : `<span class="ch-chan-hash ch-chan-emo"${chanFace(open).label ? ' aria-hidden="true"' : ''}>${esc(chanFace(open).emoji)}</span>`}${esc(open.agentFeed ? open.name : chanFace(open).label)}</b></div>`;
    const sort = chanView === 'channels' ? orderBar('Sort channels', 'data-chchansort', ['az', 'za'], chanPrefs().sort, o => o === 'az' ? 'A–Z' : 'Z–A') : '';
    return `<div class="ch-chan-tabs">${orderBar('Chats view', 'data-chview', ['channels', 'activity'], chanView, o => o === 'activity' ? 'Activity' : 'Channels')}${sort}</div>`;
  }
  // Long-press, right-click or Shift+F10 on a channel: the row action sheet's own markup, with channel actions.
  function openChannelSheet(wid, cid, trigger = null) {
    const el = track.querySelector(`[data-chats="${wid}"]`), sp = cid !== CHAN_GENERAL && spaces().find(s => s.id === cid);
    if (!el || !channelsOn() || (cid !== CHAN_GENERAL && !sp)) return false;
    closeRowSheet();
    const p = chanPrefs(), pinned = p.pins.includes(cid), arch = !!p.archived[cid], name = sp ? sp.name : 'General';
    el.insertAdjacentHTML('beforeend', `<div class="ch-sheet" role="dialog" aria-label="Channel actions"><div class="ch-sheet-b"><div class="ch-sheet-t">${esc(chanTitle(sp ? name : { name, general: true }))}</div>
      ${sp ? `<button type="button" data-rschpin>${PIN_SVG}${pinned ? 'Unpin' : 'Pin'}</button><button type="button" data-rschrename>${RENAME_SVG}Rename</button><button type="button" data-rschemoji><span class="ch-sheet-emo" aria-hidden="true">${esc(chanFace(name).emoji)}</span>Emoji…</button><button type="button" data-rscharch>${ACT.done.icon}${arch ? 'Restore' : 'Archive channel'}</button>` : ''}
      ${typeof markDoneOn === 'function' && markDoneOn() ? `<button type="button" data-rschread>${MARK_DONE_SVG}Mark channel read</button>` : ''}
      ${arch ? '' : `<button type="button" data-rschnew><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>New post</button>`}</div></div>`);
    rowSheet = { wid, chan: cid, trigger };
    el.querySelector('.ch-sheet button')?.focus({ preventScroll: true });
    vib(10); return true;
  }
  /* Channel emoji; core/chats-chanemoji.js. */
  const { chanEmojiPick, chanEmojiSync, chanEmojiTap, chanSetEmoji, openChannelEmoji } = window.WizCore.chatsParts.chanemoji({ chanFace, channelsOn, chanRenameTo, esc, norm, openEmojiSheet, spaceAgent, spaces, toast });
  function openChannelRename(wid, cid) {
    const el = track.querySelector(`[data-chats="${wid}"]`), sp = spaces().find(s => s.id === cid); if (!el || !sp) return;
    closeRowSheet();
    el.insertAdjacentHTML('beforeend', `<div class="ch-sheet" role="dialog" aria-label="Rename channel"><form class="ch-sheet-b ch-rename" data-chrnform>
      <div class="ch-sheet-t">Rename channel</div>
      <input type="text" name="t" maxlength="60" value="${esc(sp.name)}" autocomplete="off" enterkeyhint="done" aria-label="Channel name">${chanEmojiPick(sp.name)}
      <div class="ch-rename-b"><button type="button" data-rncancel>Cancel</button><button type="submit" class="go">Save</button></div></form></div>`);
    rowSheet = { wid, chan: cid, rename: true };
    const inp = el.querySelector('.ch-rename input'); if (inp) { inp.focus(); inp.select(); }
  }
  /* Mark channel read (issue 1317, with Mark done): the channel's read point moves to now (issue 1316) and its posts'
   * green New reply words clear (LIVE.markSeen of the posts that have one). Amber Needs you is cleared only per thread. */
  function chanMarkRead(w, cid) {
    if (!w || !markDoneOn()) return false;
    const sp = cid !== CHAN_GENERAL && spaces().find(x => x.id === cid), c = sp ? { id: cid, name: sp.name, agent: spaceAgent(sp) } : { id: CHAN_GENERAL, name: 'General', general: true };
    const ag = !c.general && AGS()?.isOther?.(c.agent) ? c.agent : winAgent(W[owner(w.id)] || w), rows = (LIVE.sessionsFor ? LIVE.sessionsFor(ag || '') : LIVE.unified()).filter(s => !s.hidden);
    const mine = rows.filter(s => !s.archived && inChannel(c, s)), unread = mine.filter(chanUnread);
    chanReadTo(chanReadKey(c, c.general ? chanGenAgent(w) : ''), Date.now());
    if (unread.length) LIVE.markSeen(unread);
    clearTimeout(chanReadPaintT); chanReadPaint(); paintListsNow();
    toast('✓', `${chanTitle(c)} read`, 1400);
    return true;
  }
  function chanRepaintAll() { for (const id of Object.keys(CH)) { const x = W[id]; if (x && !x.thread) rerenderList(x); } }
  // One item edit (spaces/<id>/name), never this device's whole list (live.js prefOps).
  function submitChannelRename(form) {
    if (!rowSheet?.rename || !rowSheet.chan) return;
    const cid = rowSheet.chan, sp = spaces().find(s => s.id === cid), t = form.querySelector('input').value.replace(/\s+/g, ' ').trim();
    if (!sp) { closeRowSheet(); return; }
    if (!t || t.length > 60 || /[\u0000-\u001f\u007f]/u.test(t)) { form.querySelector('input').focus(); return; }
    if (spaces().some(s => s.id !== cid && spaceAgent(s) === spaceAgent(sp) && norm(s.name) === norm(t))) { toast('!', 'Already a channel with that name', 2200); return; }
    closeRowSheet();
    chanRenameTo(cid, t);
  }
  function chanRenameTo(cid, t) {
    const sp = spaces().find(s => s.id === cid); if (!sp || !t || t.length > 60) return false;
    if (spaces().some(s => s.id !== cid && spaceAgent(s) === spaceAgent(sp) && norm(s.name) === norm(t))) { toast('!', 'Already a channel with that name', 2200); return false; }
    if (t === sp.name) return true;
    if (chanStore()) LIVE.chanStore.patch({ id: cid, name: t }); // the store's channel (issue 1261)
    else LIVE.prefOps([{ op: 'set', key: `spaces/${cid}/name`, item: t }]);
    chanRepaintAll(); toast('✎', 'Renamed', 1400);
    return true;
  }
  function channelSheetClick(e) {
    if (!rowSheet?.chan) return false;
    const { wid, chan: cid } = rowSheet, w = W[wid] || W[owner(wid)], p = chanPrefs(), name = spaces().find(s => s.id === cid)?.name || 'General';
    if (e.target.closest('[data-rschpin]')) { const on = !p.pins.includes(cid); p.pins = on ? p.pins.concat(cid) : p.pins.filter(x => x !== cid); chanPrefEdit(p, { id: cid, pinned: on }); closeRowSheet(); chanRepaintAll(); toast('⌖', on ? 'Pinned' : 'Unpinned', 1400); return true; }
    if (e.target.closest('[data-rschrename]')) { openChannelRename(wid, cid); return true; }
    if (e.target.closest('[data-rschemoji]')) { openChannelEmoji(wid, cid); return true; }
    const em = e.target.closest('[data-chemoji]'); if (em) { chanEmojiTap(em); return true; }
    if (e.target.closest('[data-rscharch]')) {
      const arch = !p.archived[cid], wasPinned = p.pins.includes(cid);
      if (arch) { p.archived[cid] = new Date().toISOString(); p.pins = p.pins.filter(x => x !== cid); } else delete p.archived[cid];
      chanPrefEdit(p, { id: cid, archived: arch, ...(arch && wasPinned ? { pinned: false } : {}) }); closeRowSheet(); chanRepaintAll(); toast('✓', `${arch ? 'Archived' : 'Restored'} # ${name}`, 1800); return true;
    }
    if (e.target.closest('[data-rschread]')) { closeRowSheet(); chanMarkRead(w, cid); return true; }
    if (e.target.closest('[data-rschnew]')) { closeRowSheet(); const t = w && chanTarget(w); if (t && openChannel(t, cid)) chanToEnd(t.id, true); return true; }
    return false;
  }
  // Turning the switch on or off repaints the lists at once (an open feed falls back to the list it came from).
  let chanWas = null;
  try { window.addEventListener('wos:experience', () => { const on = channelsOn(); if (chanWas === on) return; chanWas = on; for (const id of Object.keys(CH)) { const x = H.win(id); if (x && (x.app === 'chats' || /::side$/.test(id)) && !x.thread) rerenderList(x); } }); } catch (_) {}
  // The channel taps; false = not a channel control. Each paints on the same frame.
  function channelClick(e, id, w) {
    if (!channelsOn() || !w) return false;
    if (channelSheetClick(e)) return true;
    if (w.thread) return false;
    const v = e.target.closest('[data-chview]'); if (v) { chanView = v.dataset.chview === 'channels' ? 'channels' : 'activity'; try { localStorage.setItem(CHAN_VIEW_KEY, chanView); } catch (_) {} rerenderList(w); return true; }
    const so = e.target.closest('[data-chchansort]'); if (so) { const p = chanPrefs(); p.sort = so.dataset.chchansort === 'za' ? 'za' : 'az'; chanPrefEdit(p, { sort: p.sort }); chanRepaintAll(); return true; }
    if (e.target.closest('[data-chchanarch]')) { chanArchOpen = !chanArchOpen; renderChatList(w, elOf(id)); return true; }
    if (e.target.closest('[data-chchanagents]')) { chanAgentsOpen = !chanAgentsOpen; renderChatList(w, elOf(id)); return true; }
    const x = e.target.closest('[data-chchanx]'); if (x) { const k = x.dataset.chchanx; if (chanExpanded.has(k)) chanExpanded.delete(k); else chanExpanded.add(k); renderChatList(w, elOf(id)); return true; }
    const c0 = e.target.closest('[data-chchan]'); if (c0) { openChannel(w, c0.dataset.chchan); return true; }
    const nc = e.target.closest('[data-chchannew]'); if (nc) { chanNewForm(w, nc); return true; }
    if (e.target.closest('[data-chchanback]')) { channelBack(w); return true; }
    const jp = e.target.closest('[data-chjump]'); if (jp && typeof jumpGo === 'function') { jumpGo(id, jp.dataset.chjump); return true; } // issue 1440: the feed's pills
    // Reply under an agent's post: its thread opens with the composer ready, so the reply continues that thread.
    const rp = e.target.closest('[data-chreply]'); if (rp) { openChat(id, rp.dataset.chreply); const focus = () => { const ta = (elOf(owner(id)) || elOf(id))?.querySelector('.ch-compose textarea'); if (ta) ta.focus({ preventScroll: true }); return !!ta; }; setTimeout(() => { if (!focus()) setTimeout(focus, 250); }, 60); return true; }
    const mo = e.target.closest('[data-chpostmore]'); if (mo) { const k = mo.dataset.chpostmore; if (chanMore.has(k)) chanMore.delete(k); else chanMore.add(k); renderChatList(w, elOf(id)); return true; }
    // A photo opens the shared media viewer (Back closes it: closeOverlay → KIT.viewer.close).
    const im = e.target.closest('[data-chpostimg]'); if (im) { const s = LIVE.sessionFor ? LIVE.sessionFor(im.dataset.chpostimg, im.dataset.chpostag || '') : LIVE.session(im.dataset.chpostimg), fp = s ? firstPost(s) : null, g = fp ? (fp.none && fp.agent ? fp.agent.media : fp.media) || [] : []; if (g.length) KIT.viewer.open(g, Math.min(g.length - 1, Math.max(0, +im.dataset.i || 0))); return true; }
    return false;
  }
  /* A channel's message box, its own posts and Sending…; core/chats-chanbox.js. */
  const { boxModel, chanCompose, chanComposer, chanDraftKey, chanDropSending, chanEditUnsent, chanModel, channelSend, chanOwnPost, chanSending, chanSpaceOf, chanToEnd, setChanModel, bindLate: chanboxLate } = window.WizCore.chatsParts.chanbox({ AGS: (...a) => AGS(...a), ch, CH, CHAN_TEXT_MAX, chanArchived, channelsOn, chanOpen, chanRepaint, chanTitle, elOf: (...a) => elOf(...a), esc, FIRST, firstAgent, focusAgentId, growTa, H, KIT, OUTBOX, owner: (...a) => owner(...a), renderChatList, spaceContains, toast, viewContext, W, winAgent });
  feedLate({ chanSending });
  function clearAll(w) { const c = ch(w.id); c.filter = ''; c.q = ''; c.filterFrom = null; window.WizCore.chatSearch?.cancel(w.id); rerenderList(w); }
  function setQuery(w, q) { const c = ch(w.id); if (w.thread) chatsBack(w); c.q = String(q || ''); rerenderList(w); }
  const SEC_DEFAULT = { errors: true, working: true, saved: true, ready: true, yesterday: true, pastWeek: false, deferred: false, archive: false, recent: true, snoozed: false, archived: false };
  let secOpen = (() => { try { return { ...SEC_DEFAULT, ...JSON.parse(localStorage.getItem(SEC_OPEN_KEY) || '{}') }; } catch (e) { return { ...SEC_DEFAULT }; } })();
  /* Status marks, loading placeholders and the New chat face; core/chats-status.js. */
  const { ATT, attOf, deferredOf, newChatHtml, SEC_PAGE, skelRows, skelThread, STI, STI_LAB, STI_TIP, stiBadge, stiKind, bindLate: statusLate } = window.WizCore.chatsParts.status({ agentName: (...a) => agentName(...a), agentRec, AGS: (...a) => AGS(...a), esc, H, handledNow, isWorking });
  // Unified Chats: in the owner's main list, a private agent's row wears the lock. data-wiz-private keeps its words out
  // of the screen text sent as context with a message to another agent (core/screen-text.js).
  let rowListAgent = '', rowChan = false;
  // " · Philosopher" after a row's channel for a thread of another agent (issue 1336; tests slice rows without it).
  const agentTail = s => { const l = typeof agentLabelOf === 'function' ? agentLabelOf(s) : ''; return l ? ' · ' + esc(l) : ''; };
  const privRow = s => !rowListAgent && !!LIVE.isPrivate?.(s.id);
  function chatRow(s, snip, searchStatus = '') {
    const working = isWorking(s), unread = !working && LIVE.isNew(s), needs = ['waiting_for_approval', 'unknown'].includes(s.status) || s.status === 'failed' || s.status === 'interrupted';
    // Deferred (bottom of Ready): the status reads Deferred in place of Needs you / Your call, then its one line.
    const def = deferredOf(s) && !working && (snoozeLast() || !needs);
    const at = def ? null : attOf(s), A = at && ATT[at.state], quiet = !!at && (at.state === 'done' || at.state === 'fyi');
    // The row icon says what the thread wants from James (replaced the per-thread ✦ star, 10 Oct 2026).
    // Bold means unread once a thread is Ready; Working stays regular even when new activity is accumulating.
    const kind = stiKind(s);
    // The icon's meaning in words, in the icon's colour, at the preview's own weight (James, 10 Oct 2026:
    // "most people won't know what those icons mean … same color as the icon … don't make it any brighter or bolder").
    const lab = s.status === 'unknown' && !def ? '<em class="att approval">Needs recovery:</em> ' : STI_LAB[kind] ? `<em class="att ${kind}">${STI_LAB[kind]}:</em> ` : '';
    // Working rows: no background-helper pill (the spinner already says it) and, with the thread tracker on, no
    // 'Needs you:' line either: the tracker's dots carry the asks (James, 7 Nov 2026). Tracker off keeps the line.
    const inWorking = working || !!window.WizChatsListModel?.isListWorking(s); // a background helper is Working too
    const trackedAsk = inWorking && at && ['needs_you', 'check'].includes(at.state) && !!globalThis.WosThreadTracker?.onFor?.(LIVE.agentOf ? LIVE.agentOf(s.id) : ''); // main agent only
    // The named failure reason (wizard/failure-reason tweak, core/chat-models.js runError) replaces "Error: <your message>".
    const rerr = needs && !working ? window.WosModels?.runError?.(s) : null;
    const pv = trackedAsk ? workLabel(s) + ' · ' + esc(clip((working && s.pendText) || s.preview || '', 110))
      : working && at && ['needs_you', 'check'].includes(at.state) ? `<em class="att ${A.cls}">${A.label}:</em> ` + esc(clip(at.ask, 140)) : s.reconnect && needs ? esc(s.reconnect.name) + ' sign-in expired' : rerr ? esc(rerr.line) : working ? workLabel(s) + ' · ' + esc(clip((working && s.pendText) || s.preview || '', 110))
      : needs ? lab + esc(clip(s.preview || '', 110))
      : def ? lab + esc(clip(attOf(s)?.ask || s.preview || '', 140))
      : at ? lab + esc(clip(at.ask, 140))
      : esc(clip(s.preview || '', 110));
    const priv = privRow(s), plock = priv ? `<i class="ch-plock" title="Private agent" aria-label="Private">${AGS()?.lock?.() || ''}</i>` : '';
    const stock = `<span class="emo sti ${kind}" title="${STI_TIP[kind]}" aria-label="${STI_TIP[kind]}">${STI[kind]}</span>`;
    const topic = topicOn() && TOPIC.get(`thread:${s.id}`, [subjectOf(s), s.title, s.preview].filter(Boolean).join(' '));
    const mark = !topic ? stock : `<span class="ch-topic-mark" data-chpick="thread:${esc(s.id)}" title="Choose topic emoji"><span class="ch-topic-emoji" aria-hidden="true">${topic}</span><span class="emo sti ${kind} ch-topic-status" title="${STI_TIP[kind]}" aria-label="${STI_TIP[kind]}">${STI[kind]}</span></span>`;
    const pinned = PIN.has(s.id), boom = BOOM()?.dueFor(s.id).length ? ' due' : BOOM()?.nextFor(s.id) ? ' set' : '';
    return `<div class="ch-row-wrap${s.reconnect && needs ? ' diagnosed' : ''}${pinned ? ' pinned' : ''}" data-morph-key="row:${esc(s.id)}"><button data-part="thread-row" class="ch-row${unread ? ' unread' : ''}${snip ? ' bodyhit' : ''}${at ? ' att-' + A.cls : ''}${def ? ' deferred' : ''}${priv ? ' private' : ''}" data-chopen="${esc(s.id)}" aria-haspopup="dialog" aria-keyshortcuts="Shift+F10" title="Open thread · hold or open the context menu for actions"${quiet ? ' data-quiet="1"' : ''}${priv ? ' data-wiz-private=""' : ''}>${mark}
      <span class="bd"><span class="tp"><b>${plock}${esc(s.title)}</b>${globalThis.WosThreadTracker?.on() ? globalThis.WosThreadTracker.dots(s.id, LIVE.agentOf ? LIVE.agentOf(s.id) : '') : ''}<time>${esc(ago(LIVE.cardAt(s)))}</time></span>
      ${typeof rowChan !== 'undefined' && rowChan ? `<span class="ch-chan-line">${typeof draftTag === 'function' ? draftTag(s) : ''}${esc(typeof chanTitle === 'function' ? chanTitle(chanName(s)) : '# ' + chanName(s))}${typeof agentTail === 'function' ? agentTail(s) : ''}</span>` : ''}${snip ? `<span class="pv snip" data-chsnip>${snip.html}</span>` : `<span class="pv">${typeof rowChan !== 'undefined' && rowChan ? `<span class="ch-chan-tag">${esc(typeof chanTitle === 'function' ? chanTitle(chanName(s)) : '# ' + chanName(s))}${typeof agentTail === 'function' ? agentTail(s) : ''}</span> · ` : ''}${typeof rowChan !== 'undefined' && rowChan && typeof draftTag === 'function' ? draftTag(s) : ''}${pv}</span>`}${searchStatus ? `<span class="ch-search-status">${esc(searchStatus)}</span>` : ''}</span>${boom ? `<i class="ch-boom${boom}" title="${boom === ' due' ? 'Back for you' : 'Snoozed'}" aria-label="${boom === ' due' ? 'Back for you' : 'Snoozed'}">◷</i>` : ''}${typeof rowChan !== 'undefined' && rowChan && typeof actRowMark === 'function' ? actRowMark(s) : ''}</button>${s.reconnect && needs ? `<button type="button" class="ch-row-signin" data-chreconnect="${esc(s.reconnect.appId)}" data-recovery-run="${esc(s.reconnect.runId || '')}">Sign in</button>` : ''}${PIN.on?.() !== false ? `<button type="button" data-part="pin-button" class="ch-pin-toggle" data-chpin="${esc(s.id)}" aria-label="${pinned ? 'Unpin' : 'Pin'} chat: ${esc(s.title)}" aria-pressed="${pinned}" title="${pinned ? 'Unpin' : 'Pin'}">${PIN_SVG}</button>` : ''}</div>`;
  }
  /* Agent inbox (switch wizard/agent-inbox): Running view, Open / Send to inbox, sweep card, alert feedback; core/chats-running.js. */
  const { alertFeedback, alertsHtml, INBOX_SVG, inboxCanSend, inboxHeadHtml, inboxMove, runningBack, runningBody, runningGo, runningHead, runningOn, runningOpen, runningRow, sweepAnswer, sweepHtml, sweepLater, sweepYesToAll } = window.WizCore.chatsParts.running({ ago, ch, CH, chanStore, clip, esc, H, KIT, LIVE, paintListsNow, PIN, renderThreadNow, rerenderList, STI, storeAgent, toast, W, winAgent });
  feedLate({ alertsHtml });
  channelsLate({ runningBack });
  /* Ready has three orders (James, 10 Oct 2026): Newest (pure recency, labels don't move rows), Priority
   * (needs you, then test this, then the rest) and By subject (the roundup, kept live). */
  const READY_ORDER_KEY = 'wos.chats.readyOrder.v1', READY_ORDERS = ['newest', 'priority', 'subject'];
  const READY_ORDER_LABEL = { newest: 'Newest', priority: 'Priority', subject: 'By subject' };
  let readyOrder = (() => {
    try {
      const v = localStorage.getItem(READY_ORDER_KEY); if (READY_ORDERS.includes(v) || v === 'oldest') return v;
      if (localStorage.getItem('wos.chats.readyBySubject.v1') === '1') return 'subject'; // the old two-way toggle
    } catch (e) {}
    return 'newest';
  })();
  window.addEventListener('wos:prefs', () => {
    try { const v = localStorage.getItem(READY_ORDER_KEY); if (READY_ORDERS.includes(v) || v === 'oldest') readyOrder = v; } catch (e) {}
    for (const id of Object.keys(CH)) if (W[id]) renderChats(W[id]);
  });
  /* Shell events, after-actions, Auto-archive picker and Working order; core/chats-events.js. */
  const { archSel, keepThreadOpen, showBoomMessage, waitsOn, workingOrdered, bindLate: eventsLate } = window.WizCore.chatsParts.events({ attOf, ch, CH, deferredOf, H, holdList: (...a) => holdList(...a), isWorking, leaveFinishedThread, LIVE, renderThreadNow, toast, topicOn, W });
  const readyOrdered = list => window.WizChatsListModel.orderSessions(list, readyOrder, { at: s => LIVE.cardAt(s), rank: sesRank });
  // List mode can end while no list is on screen (a thread, search): let the watcher go on the host's change event too.
  window.addEventListener('wos:prefs', () => { if (notesOff && !window.WosSkinHost?.inboxList) { notesOff(); notesOff = null; } });
  function readyBody(list, rowFn, nt = null, sec = 'ready') {
    const later = nt ? window.WizChatsListModel.sortNotes(nt.later, readyOrder).map(noteRow).join('') : '', awake = nt ? nt.awake : [];
    // Subject grouping must not pull a snoozed row ahead of another subject's awake rows.
    // Keep one order bar, then all awake groups, then the snoozed tail (no new category).
    if (snoozeLast() && list.some(deferredOf)) return readyBody(list.filter(s => !deferredOf(s)), rowFn, nt && { awake, later: [] }, sec) + withNotes(list.filter(deferredOf), nt ? nt.later : [], rowFn, true);
    const bar = orderBar('Order Ready', 'data-rdyorder', READY_ORDERS, readyOrder, o => READY_ORDER_LABEL[o]);
    // Yesterday and Past week follow Ready's order but carry no controls: the order bar and subject moves live on Ready
    // only, so a move never rewrites the saved subject order from a partial list.
    const top = sec === 'ready' ? bar : '', mk = k => sec === 'ready' ? `subj:${k}` : `subj:${sec}:${k}`;
    if (readyOrder === 'priority') return top + priorityGroups(list, awake, rowFn, sec) + later;
    if (readyOrder !== 'subject') return top + withNotes(list, awake, rowFn) + later;
    const groups = window.WizChatsListModel.subjectGroups(list, awake, { subject: s => attOf(s)?.subject, waits: waitsOn, saved: subjOrder() });
    const ar = (dir, k, off, label, glyph) => `<button type="button" data-subjmove="${dir}" data-subjkey="${esc(k)}" aria-label="${label} ${esc(k)}"${off ? ' disabled' : ''}>${glyph}</button>`;
    return top + groups.map((g, i) => { const k = g.key, l = g.rows, wN = g.waiting, last = i === groups.length - 1;
      return `<div class="ch-subj" data-morph-key="${esc(mk(k))}"><span>${esc(k)}</span><small>${wN ? `${wN} waiting · ` : ''}${window.WizChatsListModel.unreadThreads(l, s => LIVE.isNew(s), g.notes) || ''}</small>${sec === 'ready' ? `<span class="ch-subj-mv" role="group" aria-label="Reorder ${esc(k)}">${ar('top', k, !i, 'Move to top', '<span class="ch-subj-2up" aria-hidden="true"><i>↑</i><i>↑</i></span>')}${ar('up', k, !i, 'Move up', '↑')}${ar('down', k, last, 'Move down', '↓')}</span>` : ''}</div>` + withNotes(l, g.notes, rowFn); }).join('') + later;
  }
  /* One order bar for Ready and Working (same pills, classes and behaviour): Newest is one button, and tapping it
   * again flips it to Oldest (label shows Oldest). Declared here so the readyBody block carries it. */
  function orderBar(label, attr, orders, cur, word) {
    return `<div class="ch-rdy-bar" role="group" aria-label="${label}">${orders.map(o => { const on = cur === o || (o === 'newest' && cur === 'oldest'); return `<button type="button" ${attr}="${o}" aria-pressed="${on}"${on ? ' class="on"' : ''}>${o === 'newest' && cur === 'oldest' ? 'Oldest' : word(o)}</button>`; }).join('')}</div>`;
  }
  function nextOrder(cur, o, orders) { return o === 'newest' && (cur === 'newest' || cur === 'oldest') ? (cur === 'newest' ? 'oldest' : 'newest') : orders.includes(o) ? o : cur; }
  // Working reuses Ready's bar: A to Z · Newest (tap again: Oldest). The value is the shared Working preference.
  const WORKING_ORDERS = ['alphabetical', 'newest'], WORKING_ORDER_LABEL = { alphabetical: 'A to Z', newest: 'Newest' };
  function workingOrderBar() { return orderBar('Order Working', 'data-workorder', WORKING_ORDERS, LIVE.workingOrder?.() || 'alphabetical', o => WORKING_ORDER_LABEL[o]); }
  /* Notifications listed in Ready like any chat (a live package holds WosSkinHost.inboxList): unread ones are awake
   * rows that Newest / Oldest place by when they arrived, Priority by their own priority (4–5 beside Needs you, 3
   * beside Test this, the rest with everything else) and By subject under their own "Notifications" subject. Read
   * and kept (snoozed) ones join the snoozed tail. A tap opens one in the chat window (the package's act('open')). */
  let notesOff = null, notesT = 0;
  function notes() {
    const on = !!window.WosSkinHost?.inboxList;
    if (on && !notesOff && window.WosBell?.watch) notesOff = window.WosBell.watch(() => { clearTimeout(notesT); notesT = setTimeout(() => { for (const id of Object.keys(CH)) { const w = W[id]; if (w && !w.thread && !holdList(id)) renderChats(w); } }, 60); });
    else if (!on && notesOff) { notesOff(); notesOff = null; }
    if (!on) return null;
    const all = (window.WosBell?.items?.() || []).filter(i => i && i.id && !i.archived);
    return { awake: fold(all.filter(i => !i.read)), later: fold(all.filter(i => i.read)) };
  }
  /* Notification rows and Priority groups; core/chats-notes.js. */
  const { fold, noteAt, noteIcon, notePlain, noteRow, noteSiblings, noteSrcName, noteTitle, priorityGroups, sesRank, bindLate: notesLate } = window.WizCore.chatsParts.notes({ ago, clip, esc, LIVE, stiKind, withNotes });
  // The snoozed tail is one time-ordered run (Oldest reverses it), snoozed notes included, whatever the order.
  function withNotes(list, nts, rowFn, timeOnly = false) {
    return window.WizChatsListModel.mixedRows(list, nts, readyOrder, { at: s => LIVE.cardAt(s), rank: sesRank }, { timeOnly })
      .map(r => r.note ? noteRow(r.value) : rowFn(r.value)).join('');
  }
  /* Android Back on the list puts Ready back to Newest, the default (James, 12 Oct 2026: "go back to the default
   * thread list, which is sequential", so no reach to the top bar). Runs after search and filter chips come off. */
  function readyBack() {
    if (readyOrder === 'newest') return false;
    readyOrder = 'newest'; try { localStorage.setItem(READY_ORDER_KEY, readyOrder); } catch (e) {} LIVE.putPrefs?.({ readyOrder });
    for (const x of Object.keys(CH)) { const ww = W[x]; if (ww) renderChats(ww); }
    return true;
  }
  /* By subject order, drafts and notification threads; core/chats-drafts.js. */
  const { draftRow, moveSubject, newDrafts, noteMoreHtml, noteRouteHtml, noteStackHtml, noteTactsHtml, notifAct, notifDoneAll, notifOf, notifRoute, openContextDraft, openNewDraft, sendPill, subjOrder, workLabel, bindLate: draftsLate } = window.WizCore.chatsParts.drafts({ ago, ch, CH, chatsBack, clip, elOf: (...a) => elOf(...a), esc, H, holdList: (...a) => holdList(...a), keepThreadOpen, KIT, LIVE, noteAt, notePlain, noteQuiet: (...a) => noteQuiet(...a), noteSiblings, noteSrcName, noteTitle, openChat, OUTBOX, owner: (...a) => owner(...a), PHONE: (...a) => PHONE(...a), reachLabel, renderChatList, renderChats: (...a) => renderChats(...a), saveDraft, setFocus, toast, TOPIC, topicOn, troubleshoot, vib, W, winAgent });
  /* Thread tracker (Reply, go to a message), reply summary, Compact list and the Filter sheet's Focus; core/chats-tracker.js. */
  const { CHEV_SVG, COG_SVG, COMPACT_KEY, compactOn, discardDraft, filterSheet, focusLabel, focusOption, focusOptions, jumpToMessage, leadText, listTitle, noteQuiet, quoteMessage, regenOn, replyBubble, replyCard, setSummaryOpen, snoozeLast, summaryOf, summaryStartsOpen, syncListTitle, bindLate: trackerLate } = window.WizCore.chatsParts.tracker({ agentName: (...a) => agentName(...a), agentRec, AGS: (...a) => AGS(...a), byStatus, ch, CH, chanArchived, channelsOn, chanOpen, clip, draftKey: (...a) => draftKey(...a), elOf: (...a) => elOf(...a), esc, focusAgents, focusedAgent, focusOf, focusUseful, holdList: (...a) => holdList(...a), KIT, LIVE, matchesFocus, notifOf, owner: (...a) => owner(...a), pinsOn, refreshReply: (...a) => refreshReply(...a), rememberedFocus, renderChatList, renderThread, renderThreadLive, renderThreadNow, saveDraft, scrollBox, spaceAgent, spaces, statusEntries, syncDocumentThread, threadViewportTop, toast, toTurns, track, visibleSpaces, W });
  eventsLate({ snoozeLast });
  statusLate({ snoozeLast });
  notesLate({ snoozeLast });
  setupLate({ snoozeLast });
  dailyLate({ snoozeLast });
  /* Focus only appears once there is something to switch between (James, 24 Oct 2026): a second agent, or an
   * owner-made Space. A one-agent install sees no strip and no Focus section. */
  function focusUseful() { return focusAgents().length > 1 || visibleSpaces().length > 0; }
  function focusStrip(w) {
    const opts = focusOptions(), solo = focusAgents().length === 1;
    return focusUseful() ? `<nav class="ch-focus-strip" aria-label="Chats focus">${opts.filter(o => o.kind === 'all' || o.kind === (solo ? 'space' : 'agent')).map(o => focusOption(w, o, true)).join('')}${solo ? '<button type="button" class="ch-focus-tab" data-chspacenew aria-label="' + (typeof channelsOn === 'function' && channelsOn() ? 'New channel' : 'New Space') + '" aria-haspopup="dialog" aria-expanded="false"><span aria-hidden="true">＋</span></button>' : ''}</nav>` : '';
  }
  // One local picker, rendered through the same Focus options as the filter sheet.
  let spacePicker = null, focusHoldUntil = 0;
  function closeSpacePicker() {
    if (!spacePicker) return false;
    const old = spacePicker; spacePicker = null;
    document.querySelector('[data-chspacepicker]')?.remove();
    old.tab?.setAttribute('aria-expanded', 'false');
    if (old.tab?.isConnected) old.tab.focus({ preventScroll: true });
    return true;
  }
  function openSpacePicker(w, agent, tab, { naming = false, sid = '', from = '', direct = false } = {}) {
    if (!focusAgents().some(a => a.id === agent)) return;
    closeSpacePicker();
    spacePicker = { wid: owner(w.id), from, direct, agent, tab, naming, sid, busy: false, error: '', name: '' };
    renderSpacePicker();
  }
  function renderSpacePicker() {
    const p = spacePicker; if (!p) return;
    document.querySelector('[data-chspacepicker]')?.remove();
    const w = W[p.wid], a = agentRec(p.agent), opts = focusOptions(), f = focusOf(w);
    if (!w || !focusAgents().some(a => a.id === p.agent)) { closeSpacePicker(); return; }
    const rows = opts.filter(o => o.kind === 'space' && spaceAgent(spaces().find(s => s.id === o.key)) === p.agent).sort((a, b) => b.recent - a.recent);
    const allOn = f?.kind === 'agent' && f.key === p.agent;
    // Channels: General is a place too (a chat in no channel), last as in the channel list, marked when it is there.
    const genOn = !!p.sid && SPACE.ch && !spacesOf(p.sid).length;
    const gen = p.sid && SPACE.ch ? `<button type="button" class="ch-fopt${genOn ? ' on' : ''}" data-spgeneral aria-pressed="${genOn}"><span>General</span><small></small>${genOn ? '<b>✓</b>' : ''}</button>` : '';
    const pickTitle = SPACE.ch ? 'Move to channel' : p.sid && spacesOf(p.sid).length ? `Move to ${SPACE.one}` : `Add to a ${SPACE.one}`;
    const wrap = document.createElement('div'); wrap.dataset.chspacepicker = '';
    wrap.className = 'ch-space-shade';
    wrap.innerHTML = `<div class="ch-space-picker" role="dialog" aria-modal="true" aria-label="${p.sid ? pickTitle : esc(a.label) + (SPACE.ch ? ' channels' : ' Spaces')}" style="--ch-agent-colour:${AGS()?.colour(a) || ''}"><div class="ch-space-grab" aria-hidden="true"></div><header><i></i><b>${p.sid ? pickTitle : p.direct ? 'New channel' : esc(a.label)}</b><button type="button" data-spclose aria-label="Close ${SPACE.ch ? 'channels' : 'Spaces'}">×</button></header><div class="ch-space-rows">${p.sid || p.direct ? '' : `<button type="button" class="ch-fopt${allOn ? ' on' : ''}" data-spall aria-pressed="${allOn}"><span>All ${esc(a.label)} chats</span>${allOn ? '<b>✓</b>' : ''}</button>`}${(p.direct ? [] : rows).map(o => { const on = p.sid ? spaceContains(o.key, p.sid) : f?.kind === 'space' && f.key === o.key; return `<button type="button" class="ch-fopt${on ? ' on' : ''}" data-spspace="${esc(o.key)}" aria-pressed="${on}"><span>${esc(o.label)}</span><small>${o.unread || ''}</small>${o.unread ? '<i class="ch-focus-dot" aria-label="Unread"></i>' : ''}${on ? '<b>✓</b>' : ''}</button>`; }).join('')}${gen}</div>${p.naming ? `<form class="ch-space-form"><label for="chSpaceName">${SPACE.ch ? 'New channel' : 'New space'}</label><div><input id="chSpaceName" name="name" maxlength="60" placeholder="${SPACE.ch ? 'Channel name' : 'Space name'}" value="${esc(p.name)}" autocomplete="off" ${p.busy ? 'disabled' : ''}><button type="submit" ${p.busy || !p.name.trim() ? 'disabled' : ''}>${p.busy ? 'Creating…' : 'Create'}</button></div>${SPACE.ch && !p.busy && typeof chanEmojiPick === 'function' ? chanEmojiPick(p.name) : ''}${p.error ? `<p role="alert">${esc(p.error)}</p>` : ''}</form>` : '<button type="button" class="ch-space-new" data-spnew>' + (SPACE.ch ? '+ New channel' : '+ New space') + '</button>'}</div>`;
    document.body.appendChild(wrap);
    const card = wrap.firstElementChild, strip = p.direct ? null : p.tab?.closest('.ch-focus-strip') || elOf(p.wid)?.querySelector('.ch-focus-strip'), r = strip?.getBoundingClientRect(), tr = p.tab?.getBoundingClientRect();
    if (r?.height && r.top > 0 && r.top < innerHeight) { card.style.bottom = `${Math.max(8, innerHeight - r.top + 8)}px`; if (innerWidth > 640) card.style.left = `${Math.max(8, Math.min(tr?.left || r.left, innerWidth - 296))}px`; }
    // Wide screens with no strip to sit on (a feed's or an Activity row's Move to channel…): a card in the middle, not a
    // full-width bar along the bottom; the phone keeps its bottom sheet.
    else if (innerWidth > 640) Object.assign(card.style, { left: '50%', right: 'auto', top: '50%', width: 'min(360px, calc(100vw - 16px))', transform: 'translate(-50%, -50%)' });
    if (!card.style.bottom && !card.style.top) card.style.bottom = 'max(16px, env(safe-area-inset-bottom))';
    p.tab?.setAttribute('aria-expanded', 'true');
    wrap.addEventListener('click', e => {
      if (e.target === wrap && Date.now() < focusHoldUntil) { e.preventDefault(); return; }
      if (e.target === wrap || e.target.closest('[data-spclose]')) { closeSpacePicker(); return; }
      if (p.busy) return;
      const em = e.target.closest('[data-chemoji]'); if (em) { chanEmojiTap(em); return; }
      if (e.target.closest('[data-spnew]')) { p.naming = true; renderSpacePicker(); return; }
      const s = e.target.closest('[data-spspace]');
      if (e.target.closest('[data-spgeneral]') && p.sid) { closeSpacePicker(); if (fileInGeneral(p.sid, p.agent)) for (const x of Object.keys(CH)) { const ww = W[x]; if (ww && !ww.thread) rerenderList(ww); } return; }
      if (s && p.sid) { closeSpacePicker(); if (fileInSpace(s.dataset.spspace, p.sid, p.agent)) for (const x of Object.keys(CH)) { const ww = W[x]; if (ww && !ww.thread) rerenderList(ww); } return; }
      if (s || e.target.closest('[data-spall]')) { closeSpacePicker(); setFocus(w, s ? { kind: 'space', key: s.dataset.spspace } : { kind: 'agent', key: p.agent }); }
    });
    wrap.addEventListener('input', e => { if (e.target.name === 'name') { p.name = e.target.value; wrap.querySelector('[type="submit"]').disabled = !p.name.trim(); if (typeof chanEmojiSync === 'function') chanEmojiSync(e.target.form); } });
    wrap.querySelector('form')?.addEventListener('submit', e => { e.preventDefault(); createPickerSpace(p); });
    wrap.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (p.naming && !p.busy && !p.direct) { p.naming = false; renderSpacePicker(); } else closeSpacePicker(); return; }
      if (e.target.tagName === 'INPUT' && e.key !== 'Tab') return;
      const items = [...wrap.querySelectorAll('button:not(:disabled),input:not(:disabled)')], i = items.indexOf(document.activeElement);
      if (['Tab', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowUp' || e.shiftKey ? -1 : 1) + items.length) % items.length; items[next]?.focus(); }
    });
    requestAnimationFrame(() => { if (spacePicker === p) (wrap.querySelector('input:not(:disabled)') || wrap.querySelector('[aria-pressed="true"]') || wrap.querySelector('button'))?.focus({ preventScroll: true }); });
  }
  async function createPickerSpace(p) {
    if (p !== spacePicker || p.busy) return;
    const name = p.name.trim();
    if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/u.test(name)) return;
    if (spaces().some(s => spaceAgent(s) === p.agent && norm(s.name) === norm(name)) || (norm(name) === 'general' && SPACE.ch)) { p.error = SPACE.ch ? 'Already a channel' : 'Already a Space'; renderSpacePicker(); return; }
    // The channel store (wizard-ux issue 1261) holds 200 channels per agent and gives the new one its id.
    const onStore = typeof chanStore === 'function' && !!chanStore();
    if (onStore ? spaces().filter(s => spaceAgent(s) === p.agent).length >= CHAN_STORE_MAX : spaces().length >= 50) { p.error = onStore ? `Maximum ${CHAN_STORE_MAX} channels` : SPACE.ch ? 'Maximum 50 channels' : 'Maximum 50 Spaces'; renderSpacePicker(); return; }
    p.busy = true; p.error = ''; renderSpacePicker();
    let space = { id: crypto.randomUUID(), name, agent: p.agent, threads: p.sid ? [p.sid] : [], createdAt: new Date().toISOString() }, saved;
    if (onStore) { const c = await LIVE.chanStore.create(name, storeAgent(p.agent)); saved = !!c; if (c) { space = { ...space, id: c.id }; if (p.sid) spaceMember(c.id, p.sid, true, p.agent); } }
    else saved = await LIVE.prefOps([{ op: 'add', key: 'spaces', item: space }], { requireShared: true });
    if (!saved) { p.busy = false; p.error = SPACE.ch ? 'Couldn’t create channel. Try again.' : 'Couldn’t create space. Try again.'; if (spacePicker === p) renderSpacePicker(); return; }
    if (spacePicker === p) closeSpacePicker();
    if (p.sid) return; // Row discovery creates a collection with this thread, never an agent run.
    const w = W[p.wid]; if (!w) return;
    // Channels (wizard-ux issue 1308): the new channel's empty feed opens with its box focused, where the list was
    // (the AI apps sidebar's opens in the main column). No "Fill my new Space" agent chat: that stays for classic Spaces.
    if (SPACE.ch) { const t = chanTarget(W[p.from] || w); if (t && openChannel(t, space.id)) { chanToEnd(t.id, true); setTimeout(() => chanToEnd(t.id, true), 150); } return; }
    setFocus(w, { kind: 'space', key: space.id });
    const it = await sendChat(w.id, `Fill my new Space “${name}” (id ${space.id}): find my existing threads that belong in it and add them with your Spaces tool, then tell me how many you added and list a few. Search only your own agent’s threads (${p.agent}); do not change other Spaces.`, 'creating a Space in Chats', null, { sid: '__new__', away: true, seal: false, captureId: 'space-fill:' + space.id });
    if (!it) toast('!', `${SPACE.ch ? 'Channel' : 'Space'} created; fill message wasn’t saved. Ask the agent to fill it from a new chat.`, 5000);
  }

  function bindFocusStrip(el) {
    const strip = el.querySelector('.ch-focus-strip'); if (!strip) return;
    if (!strip._focusBound) {
      strip._focusBound = true;
      let held = null, timer = 0;
      const cancel = () => { clearTimeout(timer); timer = 0; held = null; };
      const open = tab => { const w = W[idOf(tab)]; if (w) openSpacePicker(w, tab.dataset.chfocusopt.slice(6), tab); };
      strip.addEventListener('pointerdown', e => {
        const tab = e.target.closest('[data-chfocusopt^="agent:"]'); if (!tab || e.button > 0) return;
        cancel(); held = { tab, x: e.clientX, y: e.clientY };
        timer = setTimeout(() => { if (!held) return; const t = held.tab; cancel(); focusHoldUntil = Date.now() + 750; open(t); }, 450);
      });
      strip.addEventListener('pointermove', e => { if (held && Math.hypot(e.clientX - held.x, e.clientY - held.y) > 8) cancel(); }, { passive: true });
      for (const type of ['pointerup', 'pointercancel', 'pointerleave']) strip.addEventListener(type, cancel, { passive: true });
      strip.addEventListener('contextmenu', e => { const t = e.target.closest('[data-chfocusopt^="agent:"]'); if (t) { e.preventDefault(); cancel(); focusHoldUntil = Date.now() + 300; open(t); } });
      strip.addEventListener('keydown', e => { const t = e.target.closest('[data-chfocusopt^="agent:"]'); if (t && (e.key === 'ArrowUp' || e.key === 'ContextMenu' || e.key === 'F10' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); open(t); } });
      // Native horizontal scrolling owns this gesture, not an ancestor's desk swipe.
      // Do not preventDefault: taps and the browser's pan-x scrolling stay native.
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel'])
        strip.addEventListener(type, e => e.stopPropagation(), { passive: true });
    }
    const active = strip.querySelector('[aria-pressed="true"]');
    // Scroll only the row (scrollIntoView would also move the containing desk/list).
    if (active && strip._activeFocus !== active.dataset.chfocusopt) {
      strip._activeFocus = active.dataset.chfocusopt;
      requestAnimationFrame(() => {
        if (!active.isConnected) return;
        const a = active.getBoundingClientRect(), r = strip.getBoundingClientRect();
        if (a.left < r.left + 10) strip.scrollLeft += a.left - r.left - 10;
        else if (a.right > r.right - 10) strip.scrollLeft += a.right - r.right + 10;
      });
    }
  }
  /* List places (the return bookmark); core/chats-places.js. */
  const { anchorListPlace, holdListPlace, LIST_PLACE_KEY, LIST_PLACE_TTL, listPlace, restoreListPlace } = window.WizCore.chatsParts.places({ ch, elOf: (...a) => elOf(...a) });
  const listSig = w => { const f = focusOf(w), cv = typeof channelsOn === 'function' && channelsOn() ? (chanOpen(w)?.id || chanView) : ''; return [winAgent(w), f ? f.kind + ':' + f.key : '', ch(w.id).filter || '', norm(ch(w.id).q)].concat(cv ? [cv] : [], ch(w.id).running && typeof runningOpen === 'function' && runningOpen(w) ? ['running'] : []).join('|'); };
  /* Stored list places and Activity's Ready counts; core/chats-ready.js. */
  const { ACT_SORTS, listSaveT, queueListPlace, storedListPlace } = window.WizCore.chatsParts.ready({ actNeeds, actUnread, CH, chanAt, channelsOn, elOf: (...a) => elOf(...a), H, LIST_PLACE_KEY, LIST_PLACE_TTL, listPlace, listSig, LIVE, W });
  let actOlder = false;
  function activityBody(w, rows, nt) {
    const M = window.WizChatsListModel, c = ch(w.id), order = M.activitySortOf(readyOrder);
    const g = M.activityGroups(LIVE.workGroups(rows), { needs: actNeeds, unread: actUnread, at: chanAt }, { order, now: Date.now(), older: actOlder });
    // Alerts set to Chats: the unread ones wait in Ready with the chats (an urgent one counts as Needs you), read ones in Recent.
    const pick = (list, notes) => list.map(v => ({ id: v.id, v })).concat((notes || []).map(v => ({ id: 'notif:' + v.id, v, n: true })));
    const at = x => x.n ? noteAt(x.v) : chanAt(x.v), needs = x => x.n ? M.notificationRow(x.v).rank === 1 : actNeeds(x.v);
    const ready = M.activitySort(pick(g.ready, nt?.awake), order, { at, needs }), recent = M.activitySort(pick(g.recent, nt?.later), 'newest', { at });
    const row = x => x.n ? noteRow(x.v) : chatRow(x.v, null);
    const page = (k, list) => { const shown = c.more?.[k] ? list : list.slice(0, SEC_PAGE); return shown.map(row).join('') + (list.length > shown.length ? `<button class="ch-more" data-secmore="${k}">Show all ${list.length}</button>` : ''); };
    // side = a control on the header line beside the fold button (a button cannot hold a select)
    const sec = (k, label, n, inner, open = !!secOpen[k], side = '') => { const h = `<button class="ch-sec-h" data-sectoggle="${k}" aria-expanded="${open}"><span>${label}</span><small>${n || ''}</small><i aria-hidden="true"></i></button>`;
      return `<section class="ch-sec ch-act${open ? ' open' : ''}" data-sec="${k}">${side ? `<div class="ch-sec-hl">${h}${side}</div>` : h}${open ? `<div class="ch-sec-b">${inner()}</div>` : ''}</section>`; };
    // The one sort is a compact menu on Ready's header line (wizard-ux issue 1354), like the AI apps sidebar's: no pill row.
    const sortSel = `<label class="ch-act-sort"><select data-chactorder aria-label="Sort Ready">${ACT_SORTS().map(([v, l]) => `<option value="${v}"${order === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
    const older = g.older ? `<button class="ch-more ch-act-older" data-chactolder>Show older · ${g.older}</button>` : '';
    // Sends a graceful restart holds: their own Saved heading, only while there are any (wizard-ux issue 1362).
    const heldRow = s => !!globalThis.WizReach?.restartHeld?.(s), saved = g.working.filter(heldRow), working = g.working.filter(s => !heldRow(s));
    return sec('working', 'Working', working.length, () => working.length ? working.map(s => chatRow(s, null)).join('') : '<span class="ch-none">None</span>')
      + (saved.length ? sec('saved', 'Saved', saved.length, () => saved.map(s => chatRow(s, null)).join(''), secOpen.saved !== false) : '')
      + sec('ready', 'Ready', ready.length, () => ready.length ? page('ready', ready) : '<span class="ch-none">Nothing needs you.</span>', !!secOpen.ready, sortSel)
      + sec('recent', 'Recent', 0, () => (recent.length ? page('recent', recent) : '<span class="ch-none">Nothing else this week.</span>') + older)
      + sec('snoozed', 'Snoozed', g.snoozed.length, () => g.snoozed.length ? page('snoozed', g.snoozed.map(v => ({ id: v.id, v }))) : '<span class="ch-none">Nothing snoozed.</span>')
      + sec('archived', 'Archived', g.archive.length, () => g.archive.length ? page('archived', g.archive.map(v => ({ id: v.id, v }))) : '<span class="ch-none">Nothing archived.</span>');
  }
  // The sort and Show older taps (Activity with Channels on); false = not one of them.
  function activityClick(e, w) {
    if (!w || w.thread || typeof channelsOn !== 'function' || !channelsOn()) return false;
    if (e.target.closest('[data-chactorder]')) return true;   // the sort menu: its change event picks (actSetOrder)
    if (e.target.closest('[data-chactolder]')) { actOlder = true; renderChatList(w, elOf(w.id)); return true; }
    return false;
  }
  // Ready's sort menu picked an order: stored as Chats' own Ready order (this device and the box), every list repaints.
  function actSetOrder(v) {
    if (!['newest', 'oldest', 'priority'].includes(v)) return;
    readyOrder = v; try { localStorage.setItem(READY_ORDER_KEY, v); } catch (_) {} LIVE.putPrefs?.({ readyOrder: v });
    for (const x of Object.keys(CH)) { const ww = W[x]; if (ww && !ww.thread) renderChats(ww); }
  }
  function renderChatList(w, el) {
    if (globalThis.WosThreadTracker?.on()) globalThis.WosThreadTracker.loadCounts();
    // A layout which owns the list supplies its own sidebar. Do not paint a
    // second, CSS-covered list underneath it (including a thread returning Back).
    // The AI apps sidebar's Channels pane (wizard-ux issue 1256) is this same list for the main Chats window, drawn
    // into the sidebar as the id::side window while the switch is on: tabs, the channel list, a feed and its box.
    const side = typeof chanSide === 'function' && chanSide(w);
    if (!side) {
      // Switched off with a feed open in the sidebar: its Focus goes back to the one before the channel.
      if (H.ownsChatList?.() && typeof chanSwitchedOff === 'function' && chanSwitchedOff(w)) H.layout?.(owner(w.id));
      if (H.ownsChatList?.()) { el?.replaceChildren(); return; }
    }
    syncListTitle(w);
    closeStream(ch(w.id));
    if (!el) return;
    if (el.dataset) delete el.dataset.draftFor; // a list holds no thread's box: the next thread paint reads its own draft (issue 1444)
    if (H.renderView?.(w, el, () => renderChatList(w, el), 'list')) return;
    ch(w.id).heldList = false;
    H.threadShown?.(w.id, null); // the list is showing: nothing is bound to this window
    if (typeof actAllAgents === 'function') actAllAgents(w, side); // Activity shows every agent (issue 1336)
    const c = ch(w.id), n = norm(c.q);
    const AGID = winAgent(w), LST = LIVE.statusFor ? LIVE.statusFor(AGID) : { ok: LIVE.ok, error: LIVE.error };
    rowListAgent = AGID;
    // (the AI apps sidebar's pane opens its channels in the main column: it never draws a feed, wizard-ux issue 1256)
    const chanOn = typeof channelsOn === 'function' && channelsOn(), feed = chanOn && !(typeof chanElsewhere === 'function' && chanElsewhere(w)) ? chanOpen(w) : null; // tests slice this renderer without the Channels block
    if (!chanOn && typeof chanSwitchedOff === 'function' && chanSwitchedOff(w)) { syncListTitle(w); H.layout?.(owner(w.id)); }
    // The main column's feed window draws a feed or nothing (never the tabs or the channel list: those stay in the sidebar).
    if (side && !feed && typeof chanElsewhere === 'function' && typeof H.channelsElsewhere === 'function' && !chanElsewhere(w)) { el.replaceChildren(); return; }
    rowChan = chanOn && !feed;
    const runView = !side && typeof runningOpen === 'function' && runningOpen(w), runRow = !side && !runView && !feed && typeof runningRow === 'function' ? runningRow(w) : ''; // wizard-ux issue 1569
    if (!AGID) window.WizAppExtensions?.poll();
    const F = c.filter && STATUS[c.filter] ? STATUS[c.filter] : null, focus = focusOf(w);
    const fids = F?.ids ? F.ids(AGID) : null;
    const space = focus?.kind === 'space' ? spaces().find(s => s.id === focus.key) : null;
    const members = space && LST.ok ? LIVE.spaceSessions?.(space.threads, { agent: spaceAgent(space) }) : null;
    const all = (LST.ok ? (members ? members.rows : n && LIVE.searchRows ? LIVE.searchRows(AGID) : LIVE.sessionsFor ? LIVE.sessionsFor(AGID) : LIVE.sessions).filter(s => !s.hidden) : []).filter(s => (!F || (fids ? fids.has(s.id) : F.test(s))) && focusMatches(w, s));
    const filtered = !!(F || focus);
    // The default main-agent Focus is still the owner's inbox. Spaces and other agents are not.
    // Subscribe before the empty-list branch: notifications can be the only Ready rows.
    const listNotes = !n && !F && !AGID && focus?.kind !== 'space' ? notes() : null;
    const listNotesN = listNotes ? listNotes.awake.length + listNotes.later.length : 0;
    const titleHit = n ? all.filter(s => window.WizCore.chatSearch.relevance(s, n).coverage) : all;
    // Message bodies: searched lazily in the background (core/chat-search.js); hits stream in with a snippet.
    // Search is scoped to this window's agent, including routed agents and indexed body-only rows.
    const BS = window.WizCore.chatSearch, queryAt = c.q, searchNav = c.readNav;
    const bs = n && BS ? BS.query(w.id, queryAt, () => {
      const current = W[w.id], e2 = elOf(w.id); if (current && !current.thread && winAgent(current) === AGID && c.readNav === searchNav && e2 && ch(w.id).q === queryAt && e2.querySelector('.ch-list') && !holdList(w.id)) renderChatList(w, e2);
    }, AGID) : null;
    if (!n && BS) BS.cancel(w.id);
    const snips = bs ? bs.hits : new Map();
    const seen = new Set(titleHit.map(s => s.id));
    const hit = titleHit.concat(all.filter(s => !seen.has(s.id) && snips.has(s.id)));
    const hitIds = new Set(hit.map(s=>s.id));
    for (const s of bs?.rows?.values() || []) if (!hitIds.has(s.id) && !s.hidden && (!F || (fids ? fids.has(s.id) : F.test(s))) && focusMatches(w, s)) { hit.push(s); hitIds.add(s.id); }
    // Pinned live chats get one fixed section at the top (archived pins stay in Archive); search and filters still
    // decide which rows are eligible first.
    const split = n ? { pinned: [], rest: hit } : PIN.partition(hit, s => !s.archived && !(snoozeLast() && deferredOf(s))), pinnedRows = split.pinned;
    const groups = LIVE.workGroups(split.rest);
    // Sends a graceful restart holds get their own Saved heading, never counted as Working (wizard-ux issue 1362).
    const heldRow = s => !!globalThis.WizReach?.restartHeld?.(s);
    if (groups.working?.some(heldRow)) { groups.saved = groups.working.filter(heldRow); groups.working = groups.working.filter(s => !heldRow(s)); }
    // SEARCH_RELEVANCE (chat-search.js): coverage → relevance × bounded recency; Archive/pins are neutral.
    const ranked = n ? BS.rank(hit, n, LIVE.cardAt, snips) : [];
    // Reuse groupWork's classification (including automatic Archive and snooze), not a second status policy.
    const searchLabels = { errors: 'Error', working: 'Working', saved: 'Saved', ready: 'Ready', yesterday: 'Ready', pastWeek: 'Ready', deferred: 'Snoozed', archive: 'Archive' };
    const searchStatus = new Map(n ? Object.entries(groups).flatMap(([k, rows]) => rows.map(s => [s.id, k !== 'archive' && deferredOf(s) && !isWorking(s) ? 'Snoozed' : searchLabels[k]])) : []);
    const hitCount = () => hit.length;
    const coachLine = () => c.coach ? '<span class="ch-coach">Filtered. Tap ✕ to see all chats.</span>' : '';
    const ownerId = owner(w.id), curThread = W[ownerId]?.thread;
    const drafts = focus ? [] : newDrafts().filter(d => !n || norm(d.text).includes(n));
    c.more = c.more || {};
    const chip = (k, label) => `<span class="ch-chip ${k}" data-chchip="${k}"><i class="ch-fdot ${k === 'status' ? c.filter : 'subject'}"></i>${esc(label)}<button type="button" data-chchipx="${k}" aria-label="Remove filter ${esc(label)}">✕</button></span>`;
    const chips = (F ? chip('status', F.label) : '');
    const ph = filtered ? 'Search within' : 'Search chats and messages';
    const head = side ? chanHead(w, feed) : `<div class="ch-top"><label class="ch-search${filtered ? ' has-chips' : ''}"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>${chips}<input data-chsearch placeholder="${ph}" aria-label="Search chats and messages" value="${esc(c.q)}" enterkeyhint="search" spellcheck="false">${c.q ? '<button type="button" class="ch-sclear" data-chsclear aria-label="Clear search">×</button>' : ''}<button type="button" class="ch-fbtn${filtered ? ' on' : ''}" data-chfbtn aria-label="Filter chats" aria-expanded="${c.sheet ? 'true' : 'false'}"><svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg></button></label>${AGID ? '' : (window.WosBell?.html?.() || '')}</div>`
      // Switching Focus (agent/Space) never pushes the list down with a count line (James, 25 Oct 2026); only a status filter says how many matched.
      + (chanOn ? chanHead(w, feed) : '')
      + (F && LIVE.ok ? `<div class="ch-count">${hitCount()} ${hitCount() === 1 ? 'chat' : 'chats'}${coachLine()}</div>` : '');
    // Suggestions while typing (or focused on an empty field): filters that match the words, then a new chat.
    const sug = !c.sugOff && (c.q || c.focus) ? matchFilters(c.q, 3).filter(f => !(f.kind === 'status' && f.key === c.filter) && !(f.kind === focus?.kind && f.key === focus.key)) : [];
    // Filter suggestions only. New chat lives in one place, the bottom-right button (James, 24 Oct 2026: no second New chat in search).
    const sugHtml = sug.length ? `<div class="ch-sug">${sug.map(f => `<button type="button" class="ch-sugrow" data-chsug="${f.kind}:${esc(f.key)}"><span class="ch-sugic">⌯</span><span>Filter: <b>${esc(f.label)}</b></span></button>`).join('')}</div>` : '';
    let body;
    const draftSec = drafts.length ? `<section class="ch-sec open" data-sec="drafts"><div class="ch-sec-h static"><span>Drafts</span><small>${drafts.length}</small></div><div class="ch-sec-b">${drafts.map(d => draftRow(d, d.key === 'new' && curThread === '__new__')).join('')}</div></section>` : '';
    // Messages still on the phone (the window went back to the list on send), new chats and replies: shown until
    // Wizard takes them. Local recovery is independent of list/search/server availability.
    const outNew = OUTBOX ? OUTBOX.unsent().filter(it => OUTBOX.isMessage(it) && (it.agent || '') === AGID && (it.kind === 'new' || it.kind === 'reply')) : [];
    // A message still leaving the phone already shows as its thread's "Sending…" row in Working; the pill is only
    // for trouble (offline / not sent) or a thread that isn't in the list.
    const pill = sendPill(outNew.filter(it => ['failed', 'waiting', 'unconfirmed'].includes(it.state) || (it.state === 'held' && it.lateHeld) || OUTBOX?.quarantined(it.id) || !LIVE.session(it.sessionId)), w);
    // Everything else still on the phone (orb commands and dictation, held takes, side-button takes): one row at the
    // top, the only Chats-side sign of something that could be lost. It replaces the old notifications panel's Unsent.
    const others = !AGID && H.openUnsent && window.WosSettings?.unsentAll ? window.WosSettings.unsentAll({ outbox: OUTBOX }).filter(it => !(it.origin === 'app' && (it.kind === 'new' || it.kind === 'reply'))) : [];
    const otherFail = others.filter(it => ['failed', 'empty', 'unconfirmed'].includes(it.state)).length;
    const unsentRow = others.length ? `<button type="button" class="ch-unsent${otherFail ? ' fail' : ''}" data-chunsent><span class="pip"></span><span class="tx"><b>${others.length === 1 ? '1 voice take' : others.length + ' voice takes'} ${otherFail ? 'not sent' : 'waiting to send'}</b><small>${esc(clip(others[others.length - 1].recoveryText || others[others.length - 1].text || 'Voice note', 60))}</small></span><span class="go">View</span></button>` : '';
    if (false) {}
    else if (!LST.ok && !LST.error) body = draftSec + skelRows(AGID ? `Connecting to ${agentName(AGID)}` : 'Connecting to Wizard');
    else if (!LST.ok) body = draftSec + `<div class="ch-empty">${esc(window.WizReach?.failure().message || 'Checking the connection to Wizard…')}</div>`;
    // Channels (wizard/chat-channels): the live window only (James, 9 Nov 2026: older chats are reached by asking the agent).
    else if (feed && !n && !F) { const live = new Set((LIVE.sessionsFor ? LIVE.sessionsFor(AGID) : LIVE.sessions).map(s => s.id)), mine = all.filter(s => live.has(s.id)); body = channelFeed(w, feed, typeof chanFeedRows === 'function' ? chanFeedRows(feed, mine) : mine); }
    else if (chanOn && chanView === 'channels' && !n && !F) body = channelsBody(w, all);
    // Activity as a short what-needs-me list (issue 1336): Working, Ready, Recent, then folded Snoozed and Archived.
    else if (chanOn && !side && !feed && !n && !F && typeof activityBody === 'function') body = draftSec + activityBody(w, all, listNotes);
    else if (focus?.kind === 'space' && !hit.length && !n && !F) body = `<div class="ch-empty">${esc(agentRec(focusedAgent(focus)).label)} is filling this ${SPACE.ch ? 'channel' : 'Space'}…</div>`;
    else if (AGID && !all.length && !n && !F) body = `<div class="ch-empty"><b>No chats with ${esc(agentName(AGID))} yet</b><br><button type="button" class="ch-fclear" data-chnew data-chemptynew>Start a new chat</button><br> ${agentRec(AGID).privacy === 'private' ? 'They stay with this agent: the main agent can’t search or read them.' : 'They stay in this agent’s chats.'}</div>`;
    else if (filtered && !hit.length && !listNotesN) body = `<div class="ch-empty">${n ? 'No chats match' : F ? F.empty : `No chats in ${esc(focusLabel(w))}`}<br><button type="button" class="ch-fclear" ${n || F ? 'data-chfclear' : 'data-chfbtn'}>${n || F ? 'Clear filter' : 'Change focus'}</button></div>`;
    else if (!hit.length && !drafts.length && !listNotesN) body = `<div class="ch-empty">${bs && (bs.busy || bs.scanned < Math.min(bs.want, bs.total || 0)) ? `No titles match “${esc(c.q)}” · searching messages…` : `No threads match “${esc(c.q)}”.`}</div>`;
    else if (n) {
      const shown = c.more.search ? ranked : ranked.slice(0, SEC_PAGE);
      body = `<div class="ch-search-results" data-search-results="flat">${filtered ? '' : drafts.map(d => draftRow(d, d.key === 'new' && curThread === '__new__')).join('')}${shown.map(s => chatRow(s, snips.get(s.id), searchStatus.get(s.id))).join('')}${ranked.length > shown.length ? `<button class="ch-more" data-secmore="search">Show all ${ranked.length}</button>` : ''}</div>`;
    }
    else body = (filtered ? '' : draftSec)
      + (pinnedRows.length ? `<section class="ch-sec ch-pinned open" data-sec="pinned"><div class="ch-sec-h static"><span>Pinned</span><small>${pinnedRows.length}</small></div><div class="ch-sec-b">${pinnedRows.map(s => chatRow(s, n ? snips.get(s.id) : null)).join('')}</div></section>` : '')
      + (byStatus() ? SECTIONS_STATUS : SECTIONS_DAY).map(([k, label]) => {
      const list0 = PW && k === 'errors' ? PW.errorsFilter(groups[k]) : groups[k] || [];
      // Ready's order is chosen before paging, so Priority never pages a needs-you row out of the first page.
      const dayOrdered = !n && (k === 'ready' || (!byStatus() && (k === 'yesterday' || k === 'pastWeek')));
      const list = k === 'working' ? workingOrdered(list0) : dayOrdered ? readyOrdered(list0) : k === 'archive' && !n && !filtered && Object.keys(LIVE.windows || {}).length ? list0.slice(0,50) : list0;
      // Errors also holds failed background work and voice notes that didn't send (chat-power.js #12).
      const extra = PW && k === 'errors' && !n ? PW.errorsExtra() : { n: 0, html: '' };
      const nt = k === 'ready' ? listNotes : null, notesN = nt ? nt.awake.length + nt.later.length : 0;
      if (!list.length && !extra.n && (k === 'errors' || k === 'saved' || k === 'deferred' || k === 'yesterday' || k === 'pastWeek' || n || filtered) && !notesN) return '';
      // While searching, every section with a hit opens so nothing is buried.
      const open = n ? true : secOpen[k];
      // Counts are unread only (James, 8 Nov 2026): a finished thread already read adds nothing, so Ready is never an inventory.
      // Working, Snoozed and Archive keep their place counts; they are not messages waiting.
      const unreadSec = k === 'errors' || k === 'ready' || k === 'yesterday' || k === 'pastWeek';
      const secN = unreadSec ? window.WizChatsListModel.unreadThreads(list, s => LIVE.isNew(s) && !(snoozeLast() && deferredOf(s) && !isWorking(s)), nt?.awake) : list.length + extra.n + notesN;
      const waitN = !byStatus() && (k === 'ready' || k === 'yesterday' || k === 'pastWeek') ? list.filter(s => !window.WizChatsListModel.isListWorking(s) && !(snoozeLast() && deferredOf(s) && !isWorking(s)) && (['waiting_for_approval', 'unknown'].includes(s.status) || (!deferredOf(s) && attOf(s)?.state === 'needs_you'))).length : 0;
      const windowMeta = AGID ? LIVE.windows?.[AGID] : Object.values(LIVE.windows || {}).length ? {archiveTotal:Object.values(LIVE.windows).reduce((n,x)=>n+(x.archiveTotal||0),0)} : null;
      const archiveNote = k === 'archive' && !n && !filtered && windowMeta ? `<span class="ch-none">Newest ${list.length} of ${windowMeta.archiveTotal} · search to find older chats</span>` : '';
      const shown = c.more[k] ? list : list.slice(0, SEC_PAGE);
      return `<section class="ch-sec${open ? ' open' : ''}" data-sec="${k}"><button class="ch-sec-h" data-sectoggle="${k}" aria-expanded="${open}"><span>${label}</span><small>${secN || ''}</small>${waitN ? `<b class="wait">${waitN} need you</b>` : ''}<i aria-hidden="true"></i></button>
        ${open ? `<div class="ch-sec-b">${k === 'working' && list.length ? workingOrderBar() : ''}${k === 'archive' && !n && !filtered && !AGID ? '<div data-slot="archive-top"></div>' : ''}${k === 'archive' && !n && !filtered ? archSel() : ''}${archiveNote}${k === 'ready' && !n && !filtered && !AGID ? '<div data-slot="ready-top"></div>' + (window.WizAppExtensions?.html() || '') : ''}${list.length || extra.n || notesN ? (k === 'errors' && PW ? shown.map(s => PW.errorRow(s, chatRow(s, n ? snips.get(s.id) : null))).join('') + extra.html : dayOrdered ? readyBody(shown, s => chatRow(s, null), nt, k) : shown.map(s => chatRow(s, n ? snips.get(s.id) : null)).join('')) : '<span class="ch-none">None</span>'}${list.length > shown.length ? `<button class="ch-more" data-secmore="${k}">Show all ${list.length}</button>` : ''}${k === 'ready' && !n && !filtered && !AGID ? '<div data-slot="ready-end"></div>' : ''}</div>` : ''}</section>`;
    }).join('');
    if (runView) body = runningBody();
    // Progress sits above the results (James, 25 Oct 2026: it was hidden below a long Archive); the final line stays under them.
    if (bs && LST.ok) body = BS.scanning(bs) || bs.busy ? BS.footer(bs) + body : body + BS.footer(bs);
    if (side && !feed && chanView !== 'channels') body = ''; // Activity: the tabs only; the sidebar draws its own rows
    // An unlanded return bookmark outranks the scroller's own reading: that reading is the 0 it fell to.
    // A fresh page has no scroller yet: fall back to the place this list last saved (once per page per window).
    const fresh = !el.querySelector('.ch-scroll') && !c.listPlace && !c.listPending && !c.storedTried;
    if (!el.querySelector('.ch-scroll')) c.storedTried = true;
    const place = c.listPending || listPlace(el) || c.listPlace || (fresh ? storedListPlace(w) : null);
    // Results stream in while typing: keep the search box focused with the caret where it was.
    const inp0 = el.querySelector('[data-chsearch]'), had = inp0 && document.activeElement === inp0, sel = had ? [inp0.selectionStart, inp0.selectionEnd] : null;
    // New chat: a thumb-reach button bottom-right of the list (James: never make the thumb reach the top).
    // A channel's feed has its message box instead (wizard-ux issue 1258); an archived one takes no new posts (Restore
    // first), as its sheet offers no New post.
    // On the Channels list (none open) it starts a new chat too, as on Activity; only the list's + New channel row makes a
    // channel (James, 17 Nov 2026, wizard-ux issue 1489).
    const fab = feed ? (typeof chanComposer === 'function' ? chanComposer(w, feed) : '') : `<button type="button" class="ch-fab" data-chnew data-chfab aria-label="${AGID ? esc(`New chat with ${agentName(AGID)}`) : 'New chat'}"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>`;
    // Opened on the stored snapshot: say so, with a spinner, until the first fresh read lands (live.js SNAP_KEY).
    // Never let an old list pass for the latest (James, 21 Oct 2026): a failed or hung read, or a list older than a
    // minute, says when it was last updated; a pull-to-refresh shows its own progress and an "Up to date" flash.
    const lastAt = LST.at || LST.cachedAt || 0, age = lastAt ? Date.now() - lastAt : 0, since = lastAt ? `last updated ${agoText(lastAt)}` : '';
    const spin = '<i class="ch-spin" aria-hidden="true"></i>';
    // One quiet row, never a pill pushing the list down (James, 7 Nov 2026): a status dot, the line (ellipsis when long;
    // the whole line stays in the row's title) and a compact "Troubleshoot" text action at its right end, which opens
    // the Troubleshooter exactly like every other data-chtroubleshoot control.
    const dot = '<i class="ch-sync-dot" aria-hidden="true"></i>';
    const act = '<button type="button" class="ch-sync-act" data-chtroubleshoot aria-label="Open Troubleshooter">Troubleshoot</button>';
    // The text's title carries the whole line as plain text (its parts are already escaped); the visible labels stay
    // literal markup so app-parity-gate sees them.
    const syncBar = (cls, lead, inner, extra = '', title = inner) => `<div class="ch-sync${cls ? ' ' + cls : ''}" role="status">${lead}<span title="${title}">${inner}</span>${extra}</div>`;
    const notUp = (cls, lead, rest) => syncBar(cls, lead, `<b>Not up to date</b>${rest}`, act, `Not up to date${rest}`);
    const sync = c.ptrState === 'busy' ? syncBar('', spin, `Refreshing…${LST.error || age > STALE_LIST ? ` · ${esc(since)}` : ''}`)
      : LST.error ? notUp('off', dot, ` · ${esc(reachLabel('read'))}${since ? ` · ${esc(since)}` : ''}`)
      : LST.cached ? syncBar('', spin, `Updating…${LST.cachedAt && Date.now() - LST.cachedAt > 120000 ? ` · from ${esc(agoText(LST.cachedAt))}` : ''}`)
      : LST.ok && age > STALE_LIST ? notUp('stale', LST.loading ? spin : dot, ` · ${esc(since)}${LST.loading ? ' · updating…' : ''}`)
      : c.ptrState === 'done' ? syncBar('ok', '', '<span>Up to date</span>', '', 'Up to date') : '';
    const html = side ? `<div data-part="list" class="ch-list ch-side${feed ? ' ch-side-feed' : chanView === 'channels' ? ' ch-side-chan' : ''}">${head}<div class="ch-scroll">${body}</div>${feed && typeof jumpPillsHtml === 'function' ? jumpPillsHtml() : ''}${feed ? fab : ''}</div>`
      : `<div data-part="list" class="ch-list${AGID ? ' agent' : ''}${compactOn() ? ' compact' : ''}${byStatus() ? ' by-status' : ''}"${focusedAgent(focus) ? ` style="--agc:${AGS()?.colour(agentRec(focusedAgent(focus))) || ''};--ch-agent-hue:${AGS()?.distinctHues().get(focusedAgent(focus)) ?? AGS()?.hue(agentRec(focusedAgent(focus)))}"` : ''}><div data-slot="list-top"></div>${runView ? runningHead() : head}${sync}<div class="ch-ptr" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg><span>Pull to refresh</span></div><div class="ch-scroll">${runView ? '' : sugHtml + unsentRow}${runRow}${body}</div>${feed && typeof jumpPillsHtml === 'function' ? jumpPillsHtml() : ''}${pill}${runView ? '' : fab}${feed || chanOn ? '' : focusStrip(w)}${c.sheet ? filterSheet(w, c) : ''}</div>`;
    // Unchanged list reads keep the same nodes, caret, scroll and text selection.
    // A thread/list remount invalidates the identity guard even when its HTML matches.
    if (c.listHTML === html && c.listRoot === el.firstElementChild) { PW?.paint(w.id, el); return; }
    // A live tick (a timer, a relative time, one Working row) patches only what changed: rows, spinners, scroll
    // and any open sheet stay put (James, 23 Oct 2026: whole-list rebuilds flickered on every update).
    const root = el.firstElementChild;
    if (c.listRoot === root && root?.classList.contains('ch-list') && window.WosMorph?.morph(root, html)) {
      clearReading(w.id); c.listHTML = html;
      // The morph keeps a typed field's live value; a cleared search (×, Back, a chip) must empty the box too.
      const box = root.querySelector('[data-chsearch]'); if (box && !c.q && box.value) box.value = '';
      const cta = feed && root.querySelector('[data-chchanform] textarea'); if (cta && typeof growTa === 'function') growTa(cta); // the morph drops its measured height
      // The auto-archive picker is a saved setting, not a draft: show the saved value after every repaint, or a
      // window painted before the choice changed (another desk, another device, first paint) keeps saying "1 week".
      const arch = root.querySelector('[data-archafter]'); if (arch && arch.value !== String(LIVE.archiveAfterDays)) arch.value = String(LIVE.archiveAfterDays);
      const aso = root.querySelector('[data-chactorder]'), asv = aso && window.WizChatsListModel?.activitySortOf(readyOrder); if (aso && aso.value !== asv) aso.value = asv;
      if (c.listPending) { if (restoreListPlace(el.querySelector('.ch-scroll'), place)) c.listPending = null; }
      else anchorListPlace(el.querySelector('.ch-scroll'), place);
    } else {
      const keepSheet = keptSheet(el);
      clearReading(w.id); el.innerHTML = html; c.listHTML = html; c.listRoot = el.firstElementChild;
      // Back from the Android app's document-scrolled thread: leave document scroll now, in this paint, so the list is
      // never drawn (or its place restored) at the thread's page offset first (wizard-ux issue 1564).
      // (typeof: tests run this function cut out of the file, without the document-scroll adapter around it.)
      if (typeof docOwner !== 'undefined' && docOwner && androidDocument && (docOwner === el || docOwner.contains(el))) syncDocumentThread();
      restoreSheet(el, keepSheet);
      if (restoreListPlace(el.querySelector('.ch-scroll'), place)) c.listPending = null;
      // After a reload the rows come from the snapshot or the first read, which can take a few seconds.
      else if (c.listPending !== place) holdListPlace(w, el, place, fresh ? 8000 : 3000);
    }
    PW?.paint(w.id, el);
    if (chanOn && typeof chanHold === 'function') chanHold(w.id); // a channel's feed holds its place (issue 1263)
    bindFocusStrip(el);
    window.WosSkinHost?.rendered('list', el);
    if (had) { const inp = el.querySelector('[data-chsearch]'); inp.focus(); try { inp.setSelectionRange(sel[0], sel[1]); } catch (e) {} }
  }
  function toggleSection(w, k) {
    secOpen = { ...secOpen, [k]: !secOpen[k] };
    try { localStorage.setItem(SEC_OPEN_KEY, JSON.stringify(secOpen)); } catch (e) {}
    const el = track.querySelector(`[data-chats="${w.id}"]`); if (el) renderChatList(w, el);
  }
  /* Attachments and voice notes; core/chats-attach.js. */
  const { addFiles, attachTray, CHECK_SVG, CLIP_SVG, fileUrl, hasContent, mediaOfFile, MIC_SVG, PEND, pendRef, PREVIEW, refreshCompose, refreshReply, syncSend, timeTag, toggleVoice, turnAt, turnHtml, UPLOAD_ABORT, uploadFile, userMedia, bindLate: attachLate } = window.WizCore.chatsParts.attach({ ch, CHEV_SVG, clip, COG_SVG, draftKey: (...a) => draftKey(...a), draftsLate, elOf: (...a) => elOf(...a), esc, fileRef: (...a) => fileRef(...a), INC, KIT, leadText, md, needsThreadOn, regenOn, replyBubble, replyCard, saveDraft, summaryOf, summaryStartsOpen, sweepHtml, toast, track, W, winAgent });
  dailyLate({ turnHtml });
  chanboxLate({ attachTray, CLIP_SVG, fileUrl, hasContent, pendRef, PREVIEW, syncSend });
  /* Thread actions (Snooze / Archive) and the action icons; core/chats-threadacts.js. */
  const { ACT, followUpActive, threadActions } = window.WizCore.chatsParts.threadacts({ isWorking, LIVE, WORKING_ST });
  draftsLate({ ACT });
  // Notification-thread only: hand it to the agent to stop or fix (the package sends the ask).
  const NACT = { resolve: { label: 'Resolve this', icon: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0 5 5L12 19l-3 1 1-3 7.7-7.7M5 5l3 3"/></svg>', hint: 'Ask Wizard to stop these or fix the cause' }, restore: { ...ACT.restore, label: 'Restore', hint: 'Move back to your inbox' } };
  draftsLate({ NACT });
  const actionLabel = (s, a, compact = false) => a === 'done' && followUpActive(s) ? 'Archive for now'
    : a === 'stop_watch' && compact ? 'Stop' : ACT[a].label;
  const owner = id => (H.owner ? H.owner(id) : id);
  /* ---- Agents MVP: per-agent Chats. A window pinned to a non-default agent (w.agent) lists only that agent's
   * threads and starts new chats on it. Focus derives that same route; the thread keeps its
   * conversation title and model picker without repeating the agent banner. ---- */
  const AGS = () => window.WosAgents || null;
  function winAgent(w) { const o = (w && W[owner(w.id)]) || w; const f = focusOf(o), id = focusedAgent(f) || o?.agent || ''; const A = AGS(); return id && (!A || A.isOther(id)) ? id : ''; }
  // The thread row this window shows. A window focused on an agent lists that agent's rows, so a same-id thread
  // opened from it is that agent's row; anything else (All, the main agent, a main thread opened from a link while
  // an agent is focused) keeps the shared lookup. Watcher actions then scope to this row's own owner.
  const rowOf = (wid, sid) => { const a = winAgent(W[owner(wid)]); return (a && LIVE.sessionFor ? LIVE.sessionFor(sid, a) : null) || LIVE.session(sid); };
  /* Thread tracker Resume = an ordinary owner message through this window's own send path; it never takes the composer's
   * draft, quote or files and never leaves the thread (the spinner flips in the tracker). The agent comes from this
   * window's scope (the row it shows, else its own agent), carried explicitly; if the id-only lookup names a different
   * agent the send is refused (the tracker restores the rows) rather than delivered to the wrong agent. */
  function resumeTracked(id, w, text) {
    const sid = w.thread, how = 'tapping Resume in the thread tracker', A = AGS(), row = rowOf(id, sid);
    const other = a => !!a && (!A || A.isOther(a));
    const scoped = (other(row?.agent) ? row.agent : '') || winAgent(W[owner(id)] || w) || '';
    if (scoped !== ((LIVE.agentOf && LIVE.agentOf(sid)) || '')) return Promise.resolve(null);
    const it = sendChat(id, text, how, null, { sid, away: true, instructions: viewContext(id, how), ...(scoped ? { agent: scoped } : {}) });
    PW?.follow(id, true, sid); return it;
  }
  // AI Look up (core/lookup-pop.js): which agent/thread the words sit in. Private agents, private threads and Incognito
  // never use a cloud model, so the selection menu hides Look up there (the Agent Service refuses them too).
  function lookupScope(id) {
    const w = W[id]; if (!w) return null;
    const sid = w.thread && w.thread !== '__new__' ? String(w.thread) : '';
    const agent = winAgent(w) || (sid && LIVE.agentOf ? LIVE.agentOf(sid) : '') || '';
    const priv = !!INC?.active(id) || !!(sid && LIVE.isPrivate?.(sid)) || !!AGS()?.isPrivate(agentRec(agent)); // '' is the default agent, checked too
    let title = ''; try { title = winTitle(w) || ''; } catch (e) {}
    return { session: sid, agent, private: priv, frame: `${agentName(agent)}${title ? ' · ' + title : ''}`.slice(0, 80) };
  }
  function agentRec(id) {
    const A = AGS();
    if (!id) { const d = A?.get(A.defaultId()); return d || { id: 'hermes', label: window.WizConfig.agent(), privacy: 'standard', appearance: { glyph: 'wizard' }, model: {}, is_default: true }; }
    return A?.get(id) || { id, label: id, privacy: 'standard', appearance: {}, model: {}, missing: true };
  }
  // The agent name used in composer hints and receipts: the open agent's label, else the main agent's name.
  const agentName = id => id ? agentRec(id).label : window.WizConfig.agent();
  // Read the drawn list, not workGroups(): filters, Space Focus, sort, folded sections and
  // Show more have already decided what is here. Keep that order while a phone shows its thread.
  function archiveListOrder(wid, sid) {
    const own = window.WosSkinHost?.chatArchiveOrder?.(sid);
    if (own != null) return own;
    const el = elOf(wid + '::list') || elOf(wid);
    const rows = [...(el?.querySelectorAll('.ch-list [data-chopen]') || [])];
    const row = rows.find(r => r.dataset.chopen === sid);
    if (!row) return ch(wid).archiveOrder || [];
    const section = row.closest('.ch-sec, .ch-search-results') || row.closest('.ch-list');
    return rows.filter(r => (r.closest('.ch-sec, .ch-search-results') || r.closest('.ch-list')) === section).map(r => r.dataset.chopen);
  }
  function archiveAdvance(w, sid) {
    const ids = archiveListOrder(w.id, sid).filter(id => id === sid || (rowOf(w.id, id) && !rowOf(w.id, id).archived));
    const at = ids.indexOf(sid), nx = at < 0 ? null : ids[at + 1] || ids[at - 1];
    ch(w.id).archiveOrder = ids;
    // Reuse the ordinary opener: it saves the draft and clears the link trail. Back goes to
    // the list, never the archived thread. No neighbour also discards that trail explicitly.
    if (nx) openChat(w.id, nx);
    else { ch(w.id).trail = []; chatsBack(w); }
  }
  // The one "I'm finished with this thread" landing, shared by Archive and Snooze (James, 8 Nov 2026): desktop opens the next
  // chat in the drawn list, the phone goes straight to the chats list (no step up the link trail), whatever the After-actions setting.
  function leaveFinishedThread(w, sid) {
    if (!w || !sid || w.thread !== sid) return false;
    if (!PHONE()) archiveAdvance(w, sid);
    else { ch(w.id).trail = []; chatsBack(w); }
    return true;
  }
  // Repaint every chats list from the already-patched LIVE state on the tap's own frame. The holds that normally defer a
  // repaint (swipe tray, long press, actions sheet, reading) guard against a poll reshuffling rows under a finger; the
  // owner's own action is the one repaint that must never wait.
  let paintForced = false;
  function paintListsNow() {
    closeSwipe(true); paintForced = true;
    try { for (const id of Object.keys(CH)) { const x = W[id]; if (x && !x.thread) renderChats(x); } } finally { paintForced = false; }
    H.changed?.();
    window.WosSkinHost?.rendered?.('chats-list', null); // a layout that draws its own list (AI apps sidebar) re-reads it now too
  }
  /* Row actions for threads, alerts and channel lines; core/chats-rowacts.js. */
  const { NOTE_ACT, noteRowAct, ROW_MENU, rowMenu, threadAct, bindLate: rowactsLate } = window.WizCore.chatsParts.rowacts({ ACT, actRestore, actUndo, BOOM, ch, CH, closeRowSheet, followUpActive, H, keepThreadOpen, leaveFinishedThread, LIVE, markDone, notifAct, openChannelSheet, openRowSheet, owner, paintListsNow, rowOf, threadBack, toast, vib, W });
  let rowSheet = null; // { wid, sid?, nid?, trigger }
  function rowActions(s) {
    const acts = threadActions(s, null);
    return LIVE.workGroups([s]).ready.length > 0 && !LIVE.isNew(s) ? ['unread', ...acts] : acts;
  }
  function openRowSheet(wid, sid, nid = '') {
    const s = nid ? window.WosBell?.item?.(nid) : rowOf(wid, sid), el = track.querySelector(`[data-chats="${wid}"]`); if (!s || !el || (nid && s.archived)) return;
    closeRowSheet();
    const trigger = Array.from(el.querySelectorAll(nid ? '[data-chnotif]' : '[data-chopen]')).find(row => (nid ? row.dataset.chnotif : row.dataset.chopen) === (nid || sid)) || null;
    const grp = nid && trigger?.dataset.chnotifGroup ? [s, ...noteSiblings(s)].filter(i => !!i.read === !!s.read).map(i => i.id) : null;
    const acts = nid ? ['done', ...(s.read ? ['unread'] : ['snooze'])] : rowActions(s);
    el.insertAdjacentHTML('beforeend', `<div class="ch-sheet" role="dialog" aria-label="${nid ? 'Alert' : 'Thread'} actions"><div class="ch-sheet-b"><div class="ch-sheet-t">${esc(nid ? grp && grp.length > 1 ? `${noteSrcName(s)} · ${grp.length}` : notePlain(s.title) || 'Alert' : s.title)}</div>
      ${nid ? '<button type="button" data-rsopen><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>Open</button>' : ''}
      ${!nid && typeof canMarkDone === 'function' && canMarkDone(s) ? `<button type="button" data-rsmarkdone>${MARK_DONE_SVG}Mark done</button>` : ''}
      ${nid ? '' : `<button type="button" data-rsrename>${RENAME_SVG}Rename</button>
      ${PIN.on?.() !== false ? `<button type="button" data-part="pin-action" data-rspin>${PIN_SVG}${PIN.has(sid) ? 'Unpin' : 'Pin'}</button>` : ''}
      ${typeof inboxCanSend === 'function' && inboxCanSend(wid, s) ? `<button type="button" data-rsinbox>${INBOX_SVG}Send to inbox</button>` : ''}
      <button type="button" data-rsspacepicker>${PIN_SVG}${SPACE.ch ? 'Move to channel…' : spacesOf(sid).length ? `Move to ${SPACE.one}…` : `Add to a ${SPACE.one}…`}</button>
      ${spacesOf(sid).map(space => `<button type="button" data-rsspace="${esc(space.id)}" data-add="false">${PIN_SVG}Remove from ${SPACE.ch ? 'channel' : SPACE.one} · ${esc(space.name)}</button>`).join('')}
      ${topicOn() ? `<button type="button" data-rsemo><span class="ch-sheet-emoji">${TOPIC.get(`thread:${sid}`, [subjectOf(s), s.title, s.preview].filter(Boolean).join(' '))}</span>Choose emoji</button>` : ''}`}
      ${acts.map(a => `<button type="button" data-rsact="${a}">${(nid ? NOTE_ACT : ACT)[a].icon}${nid ? NOTE_ACT[a].label + (grp && grp.length > 1 ? ` all ${grp.length}` : '') : actionLabel(s, a)}</button>`).join('')}
      ${acts.length ? '' : `<p class="ch-sheet-n">${isWorking(s) || ['waiting_for_approval', 'unknown'].includes(s.status) ? `${window.WizConfig.agent()} is still on this one.` : 'Nothing to file yet.'}</p>`}</div></div>`);
    rowSheet = { wid, sid, nid, trigger, grp };
    el.querySelector('.ch-sheet button')?.focus({ preventScroll: true });
    vib(10);
  }
  const emojiCategoryHtml = category => `<section class="ch-emoji-category"><h3>${esc(category.label)}</h3><div class="ch-emoji-grid">${category.emoji.map(emoji => `<button type="button" data-chtopicemoji="${emoji}" aria-label="Use ${emoji}">${emoji}</button>`).join('')}</div></section>`;
  const emojiRenderState = new WeakMap();
  function appendEmojiCategory(scroll) {
    const state = emojiRenderState.get(scroll); if (!state || state.index >= state.categories.length) return false;
    const sentinel = scroll.querySelector('[data-chemosentinel]');
    sentinel?.insertAdjacentHTML('beforebegin', emojiCategoryHtml(state.categories[state.index++]));
    if (state.index >= state.categories.length) sentinel?.remove();
    return true;
  }
  function startEmojiCategories(scroll, categories) {
    if (!scroll) return;
    const list = Array.from(categories || []);
    scroll.innerHTML = list.length ? '<span data-chemosentinel aria-hidden="true"></span>' : '<p class="ch-emoji-empty" role="status">No emojis found. Try another word.</p>';
    scroll.scrollTop = 0;
    emojiRenderState.set(scroll, { categories: list, index: 0 });
    appendEmojiCategory(scroll);
    scroll.onscroll = () => {
      const state = emojiRenderState.get(scroll);
      if (!state || state.index >= state.categories.length || scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 320) return;
      appendEmojiCategory(scroll);
    };
  }
  function renderEmojiSearch(sheet, query) {
    const results = TOPIC.search(query), scroll = sheet?.querySelector('[data-chemoresults]'), clear = sheet?.querySelector('[data-chemoclear]');
    if (!scroll) return;
    startEmojiCategories(scroll, results);
    if (clear) clear.hidden = !String(query || '').trim();
  }
  function openEmojiSheet(wid, key, label) {
    const el = track.querySelector(`[data-chats="${wid}"]`); if (!el || !key) return;
    closeRowSheet();
    el.insertAdjacentHTML('beforeend', `<div class="ch-sheet" role="dialog" aria-label="Choose topic emoji"><div class="ch-sheet-b ch-emoji-sheet"><div class="ch-sheet-t">${esc(label || 'Choose emoji')}</div><label class="ch-emoji-search"><span aria-hidden="true">⌕</span><input type="search" data-chemosearch aria-label="Search emojis" placeholder="Search emojis" autocomplete="off" autocapitalize="none" spellcheck="false"><button type="button" data-chemoclear aria-label="Clear emoji search" hidden>×</button></label><div class="ch-emoji-scroll" data-chemoresults></div></div></div>`);
    const scroll = el.querySelector('.ch-emoji-sheet [data-chemoresults]');
    startEmojiCategories(scroll, TOPIC.categories);
    rowSheet = { wid, key, emoji: true }; vib(8);
  }
  /* Rename (long-press a thread, or tap the title inside it). James's name locks the thread: the agent keeps it. */
  const RENAME_SVG = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>';
  function openRenameSheet(wid, sid) {
    const s = LIVE.session(sid), el = track.querySelector(`[data-chats="${wid}"]`); if (!s || !el) return;
    closeRowSheet();
    el.insertAdjacentHTML('beforeend', `<div class="ch-sheet" role="dialog" aria-label="Rename thread"><form class="ch-sheet-b ch-rename" data-rnform>
      <div class="ch-sheet-t">Rename thread</div>
      <input type="text" name="t" maxlength="60" value="${esc(s.title)}" autocomplete="off" enterkeyhint="done" aria-label="Thread name">
      <p class="ch-sheet-n">Use a short project name, such as Messenger. Your name sticks; ${esc(window.WizConfig.agent())} won’t rename it.</p>
      <div class="ch-rename-b"><button type="button" data-rncancel>Cancel</button><button type="submit" class="go">Save</button></div></form></div>`);
    rowSheet = { wid, sid, rename: true };
    const inp = el.querySelector('.ch-rename input'); if (inp) { inp.focus(); inp.select(); }
  }
  async function submitRename(form) {
    if (!rowSheet?.rename) return;
    const { wid, sid } = rowSheet, t = form.querySelector('input').value.replace(/\s+/g, ' ').trim();
    if (!t) { form.querySelector('input').focus(); return; }
    closeRowSheet();
    const paint = () => {
      for (const id of Object.keys(CH)) { const x = W[id]; if (x) renderChats(x); } H.changed?.();
      const w = W[wid]; if (w && w.thread === sid) renderThreadNow(w);
    };
    // This action owns its paint: a focused rename field/list hold must not wait
    // for the PATCH or the next poll to notify the phone and AI apps sidebar.
    const saving = LIVE.rename(sid, t); paint();
    const r = await saving;
    if (r === true) toast('✎', 'Renamed', 1400);
    else toast('!', r === 'taken' ? 'Another thread already has that name' : 'Couldn’t rename · kept the old name', 2600);
    paint();
  }
  /* Live repaints rebuild the chat pane; an open sheet (rename, thread actions) and its focused field survive them,
   * or Rename closed itself before a new name could be typed (Novaire, 21 Oct 2026). */
  function keptSheet(el) {
    const sh = rowSheet && el.querySelector(':scope > .ch-sheet'); if (!sh) return null;
    const f = sh.contains(document.activeElement) ? document.activeElement : null;
    return { sh, f, sel: f && 'selectionStart' in f ? [f.selectionStart, f.selectionEnd] : null };
  }
  function restoreSheet(el, k) {
    if (!k || !rowSheet) return;
    el.appendChild(k.sh);
    if (k.f && k.f.isConnected) { k.f.focus({ preventScroll: true }); if (k.sel) try { k.f.setSelectionRange(k.sel[0], k.sel[1]); } catch (_) {} }
  }
  // The reply's ⚙: how long the agent writes the short answer (box-wide; new replies only).
  function openLengthSheet(wid, trigger) {
    const el = track.querySelector(`[data-chats="${wid}"]`), R = window.WosSkinHost?.replySummary; if (!el || !R) return;
    closeRowSheet();
    const cur = R.get().length;
    el.insertAdjacentHTML('beforeend', `<div class="ch-sheet" role="dialog" aria-label="Short answer length"><div class="ch-sheet-b ch-rlen"><div class="ch-sheet-t">Short answer length</div><div role="radiogroup" aria-label="Short answer length">${R.lengths.map(l => `<button type="button" role="radio" aria-checked="${l.id === cur}" data-rslen="${l.id}"><span class="ch-rlen-dot" aria-hidden="true">${l.id === cur ? '◉' : '○'}</span><span class="ch-rlen-tx"><b>${esc(l.name)}</b><small>${esc(l.hint)}</small></span></button>`).join('')}</div><p class="ch-sheet-n">Applies to new replies; earlier ones keep theirs.</p></div></div>`);
    rowSheet = { wid, trigger, rlen: true };
    el.querySelector('.ch-rlen [aria-checked="true"]')?.focus({ preventScroll: true });
  }
  function closeRowSheet() {
    if (!rowSheet) return false;
    const trigger = rowSheet.trigger;
    H.root().querySelectorAll('.ch-sheet').forEach(n => n.remove()); rowSheet = null;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    return true;
  }
  /* Approvals in a thread and repainting around a field; core/chats-approvals.js. */
  const { approvalHtml, chooseApproval, loadApproval, rebuildAround } = window.WizCore.chatsParts.approvals({ ch, esc, KIT, LIVE, renderThreadNow, toast, W });
  function renderThreadNow(w) { const el = track.querySelector(`[data-chats="${w.id}"]`); if (el && w.thread) renderThread(w, el); }
  /* Selecting text in a working thread; core/chats-select.js. */
  const { clearReading, readGuard, readingIn, scheduleHeld, SCROLL_IDLE, SEL, selectingIn, TOUCH } = window.WizCore.chatsParts.select({ ch, CH, flushHeld, idOf: (...a) => idOf(...a) });
  function renderThreadLive(w) { const el = track.querySelector(`[data-chats="${w.id}"]`); if (el && w.thread) renderLive(w, el); }
  function renderLive(w, el) {
    const c = ch(w.id);
    if (selectingIn(el)) { c.held = true; return; }
    c.held = false; renderThread(w, el);
  }
  function flushHeld() {
    for (const id of Object.keys(CH)) {
      const c = CH[id], w = W[id]; if (!w || (!c.held && !c.heldList)) continue;
      const el = elOf(id); if (!el) { c.held = c.heldList = false; continue; }
      if (document.hidden) continue;
      if (w.thread) {
        c.heldList = false;
        if (c.held && !selectingIn(el)) { c.held = false; renderThread(w, el); }
      } else {
        c.held = false;
        if (c.heldList && !holdList(id)) renderChatList(w, el);
      }
    }
  }
  let selT = 0;
  document.addEventListener('wos-scroll-capture-end', () => queueMicrotask(flushHeld));
  document.addEventListener('selectionchange', () => {
    const s = window.getSelection?.(), on = !!s && !s.isCollapsed;
    if (!on) SEL.since = 0; else if (!SEL.since) SEL.since = Date.now();
    clearTimeout(selT); selT = setTimeout(flushHeld, 250);
  });
  setInterval(flushHeld, 10000); // bounded recovery for lost touch/selection-end or an external sheet close
  const PAGE = 60;
  trackerLate({ PAGE });
  /* Thread streaming and a thread's working state; core/chats-stream.js. */
  const { closeStream, keepLoadedImages, syncStream, threadState, bindLate: streamLate } = window.WizCore.chatsParts.stream({ agentName, agentRec, ago, elOf: (...a) => elOf(...a), esc, isWorking, LIVE, md, renderThreadLive, snoozeLast, stiKind, W });
  function renderThread(w, el, keep) {
    if (INC?.render(w.id, el)) return;
    if (H.renderView?.(w, el, () => renderThread(w, el, keep), 'thread')) return;
    ch(w.id).held = false; // explicit actions/navigation may repaint immediately
    const c = ch(w.id), isNew = w.thread === '__new__', s = isNew ? null : rowOf(w.id, w.thread);
    // The thread's own agent (pinned at creation); a new chat belongs to the window's agent.
    const TAG = isNew ? (winAgent(w) || (AGS()?.isOther(c.newModel?.agent) ? c.newModel.agent : '')) : (LIVE.agentOf ? LIVE.agentOf(w.thread) : '');
    // Unified Chats: a private agent's thread opened from the owner's main list says so in its header.
    const incognitoAction = isNew && INC && window.WizCore.incognitoOptIn?.enabled(agentRec(TAG)) ? '<button type="button" class="pbtn ch-incog-toggle" role="switch" aria-checked="false" data-incog-start aria-label="Incognito"><span>Incognito</span><span class="sw" aria-hidden="true"><i></i></span></button>' : '';
    const privTag = !winAgent(w) && TAG && AGS()?.isPrivate(agentRec(TAG)) ? `<span class="ch-privtag" data-wiz-private="" title="Private agent: ${esc(agentName(TAG))}">${AGS().lock()}<span>Private</span></span>` : '';
    const state = threadState(s, TAG), working = state.working, held = working && !!globalThis.WizReach?.restartHeld?.(s);
    const sub = isNew ? `Starts a new thread with ${agentName(TAG)}` : state.sub;
    const storedTurns = (c.loadedFor === w.thread || c.cachedFor === w.thread) && turnsCurrent(c, s) ? c.turns || [] : null;
    const turns = storedTurns && reconcileSent(storedTurns, OUTBOX ? OUTBOX.forThread(w.thread) : [], s);
    c.media = []; c.texts = [];
    let msgs;
    // A message the transcript on screen already shows is never drawn again below it as pending: reopening a thread
    // painted the cached transcript (your message, then the reply) and the outbox copy still "Sending…" under both
    // until the server read retired it (James, 23 Oct 2026).
    const pend = pendingFor(w).filter(p => !(turns && (localSent(turns, p) || echoed(turns, p) || retryShown(turns, p))));
    const carry = isNew && c.carry && TAG ? `<div class="ch-carry" role="note"><b>${AGS()?.lock?.() || ''}Continues “${esc(clip(c.carry.title, 60))}” privately</b><span>Your first message takes the last ${c.carry.n === 1 ? 'message' : `${c.carry.n} messages`} with it as quoted context. That thread stays as it is.</span><button type="button" data-chcarryx>Don’t include</button></div>` : '';
    const NV = isNew && !pend.length ? notifOf(w) : null;
    const noteBox = NV && el.dataset.notificationId === NV.id ? el.querySelector('.ch-msgs') : null;
    const notificationScroll = noteBox ? scrollBox(noteBox).scrollTop : 0;
    const NQ = !!NV && noteQuiet();
    if (NV) msgs = `<div class="msg a ch-notif" data-morph-key="notif:${esc(NV.id)}"><div class="bub">${md(NV.item?.message ?? NV.reply.message)}</div>${NV.item?.details && NV.item.details !== NV.item.message ? `<section class="ch-notif-details" aria-label="Original alert"><h2>Original alert</h2><div class="ch-notif-original">${esc(NV.item.details)}</div></section>` : ''}<div class="mmeta">${NV.item?.time ? timeTag(NV.item.time * 1000) : ''}<span class="ch-notif-src">${NV.item?.source === 'cron' ? 'Scheduled job' : NV.item?.app ? esc(NV.item.appName || NV.item.app) : 'Notification'}</span></div></div>`;
    if (NQ) msgs = noteStackHtml(NV, `<div class="bub">${md(NV.item?.message ?? NV.reply.message)}</div>${NV.item?.details && NV.item.details !== NV.item.message ? `<section class="ch-notif-details" aria-label="Original alert"><h2>Original alert</h2><div class="ch-notif-original">${esc(NV.item.details)}</div></section>` : ''}`, noteTactsHtml(NV, true));
    // The rest waiting from the same app, under it (its row in the list was one fold), with Done all.
    if (NV) msgs += noteMoreHtml(NV);
    // The same Badge | Chats picker as Settings › Notifications, above the notification.
    if (NV) msgs = noteRouteHtml(NV) + msgs;   // (quiet: its own line already sits under the note)
    else if (isNew && !pend.length) msgs = newChatHtml(TAG) + `<div class="ch-empty nc-classic"><b>${TAG && AGS()?.isPrivate(agentRec(TAG)) ? `New private chat` : 'New chat'}</b><br>${esc(H.newChatHint || 'Type below.')}</div>${carry}`;
    // A thread answered 404 in this open is gone: that verdict wins over cached turns and queued sends.
    else if (!isNew && c.goneFor === w.thread && c.goneNav === c.readNav && !threadAlive(w, w.thread)) msgs = threadErrHtml(c);
    else if (!turns && !isNew && !pend.length) msgs = c.err && (c.failN > 1 || c.err !== 'Couldn’t load this thread') ? threadErrHtml(c) : skelThread();
    else {
      const all = turns || [];
      if (c.showFor !== w.thread) {
        const shown = PW?.RP.read(w.thread)?.shown;
        c.show = Number.isInteger(shown) ? Math.max(PAGE, Math.min(all.length, shown)) : PAGE; c.showFor = w.thread;
      }
      const from = Math.max(0, all.length - c.show), shown = all.slice(from);
      let day = '';
      // A named failure reason (wizard/failure-reason tweak) is a notice in the failed panel, not a Wizard reply:
      // it hides Hermes' generic failed_turn bubble and the duplicate "Reply not sent" line.
      const runErr = !working && !!window.WosModels?.runError?.(s);
      // Issue 1500: a send that failed on a signed-out/expired subscription shows the Reconnect card only, never Hermes'
      // generic "not processed… send it again" line above it.
      const signedOut = !working && !!PW?.signedOutFail?.(s);
      // Issue 1235: a chat another app owns (Telegram, Slack …) refuses every reply, so its Not sent bubble has no
      // Retry and the clear card shows at once: on a failed thread or a Not sent message, without waiting for the
      // Service's words (they used to land about a minute after the generic Needs retry panel).
      const foreign = window.WosModels?.foreignApp?.(s) || '';
      const refused = !working && !!foreign && (['failed', 'interrupted'].includes(s?.status) || !!s?.safeError
        || shown.some(tn => ['failed', 'interrupted'].includes(tn.u?.queue?.status)));
      c.retryRunId = !working && !foreign && s?.retryRunId || ''; // the saved request a Not sent bubble's Retry sends (turnHtml)
      // Renames show where they happened ("Renamed from …"), so the old name still finds its place in the thread.
      const firstAt = shown.length ? turnAt(shown[0]) : Infinity;
      const rns = (s?.renames || []).map(r => ({ ...r, ms: r.at * 1000 })).filter(r => from === 0 || !(r.ms < firstAt)).sort((a, b) => a.ms - b.ms);
      const rnHtml = r => `<div class="ch-renamed"><span>${r.by === 'you' ? 'You renamed this from' : 'Renamed from'} “${esc(r.from)}”</span></div>`;
      const rnBefore = at => { let out = ''; while (rns.length && isFinite(at) && rns[0].ms <= at) out += rnHtml(rns.shift()); return out; };
      const need = typeof needsMark === 'function' && !isNew && s ? needsMark(w.id, w.thread, s, shown) : { k: -1, html: '' }; // issue 1331
      c.restartHeld = held; // turnHtml: a held send's last turn is not live (wizard-ux issue 1362)
      c.stopping = s?.status === 'stopping'; // turnHtml: the live work line says Stopping… from the tap (issue 1576)
      msgs = (from > 0 ? `<button type="button" class="ch-earlier" data-chearlier>Load earlier messages · ${from} more</button>` : '')
        + shown.map((tn, k, arr) => {
          const at = turnAt(tn), dk = KIT.time.dayKey(at);
          const div = dk && dk !== day ? `<div class="ch-day"><span>${esc(KIT.time.day(at))}</span></div>` : '';
          if (dk) day = dk;
          return rnBefore(at) + div + turnHtml(c, tn, k === arr.length - 1, working, s?.helperStatus, s?.reconnect || !!runErr || signedOut, !!globalThis.WosThreadTracker?.onFor?.(TAG) || (typeof replyStd === 'function' && replyStd(TAG)), k === need.k ? need.html : '');
        }).join('')
        + rns.splice(0).map(rnHtml).join('')
        + (refused ? `<div class="appr" role="status" data-chrefused><b>Reply not sent</b><p>${esc(window.WosModels.refusal(s))}</p>${['failed', 'interrupted'].includes(s?.status) ? '<div class="appr-b"><button type="button" class="no" data-chdismiss>Dismiss</button></div>' : ''}</div>`
          : (!runErr && !signedOut && s?.safeError && !s?.reconnect && s?.queueReason !== 'provider_access' ? `<div class="appr" role="status"><b>Reply not sent</b><p>${esc(s.safeError)}</p></div>` : ''))
        + approvalHtml(c, s)
        + pend.map(p => pendingHtml(p, c, s)).join('')
        // A send a graceful restart holds: one quiet saved line, never a Working timer (wizard-ux issue 1362).
        + (held ? `<div class="ch-held-line" role="status" data-restart-held>${STI.held}<span>Saved · sends after Wizard restarts</span></div>` : '')
        + (pend.some(p => ['queued', 'sending', 'waiting'].includes(p.state)) && !working ? `<details class="steps live"><summary><i class="dots"><b></b><b></b><b></b></i> ${pend.some(p => p.state === 'waiting') ? 'Waiting for Wizard · will retry' : 'Sending'}</summary></details>` : '');
    }
    // The Daily view (issue 1469): earlier days folded above the open day, an empty Today under it before today's first post.
    const DL = !NV && typeof dailyHtml === 'function' ? dailyHtml(w, c) : null;
    if (DL) msgs = isNew && !pend.length ? DL.above + DL.below : DL.above + msgs + DL.below;
    msgs += syncStream(w, c, turns, TAG);
    // A saved copy painted after a failed read says so, so it never passes for a fresh one.
    // Only within the open whose read failed; the next good read clears it.
    if (!isNew && turns && c.savedFor === w.thread && c.savedNav === c.readNav)
      msgs += `<div class="ch-renamed ch-saved" role="status"><span>Saved copy${c.savedAt ? ' from ' + esc(new Date(c.savedAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })) : ''} · can’t reach Wizard right now</span></div>`;
    const acts = isNew ? [] : threadActions(s, turns);
    const box = el.querySelector('.ch-msgs');
    PW?.capture(box); // save the shared eye-line record before rows above it change
    const dkey = draftKey(w);
    // Only the thread's own box counts: a channel feed's box left in this element (Back from a post lands on its feed)
    // holds that channel's words, never this thread's (wizard-ux issue 1444: the thread's draft showed as the emptied box).
    const ta0 = el.querySelector('textarea'), oldTa = ta0 && !ta0.closest?.('[data-chchanform]') ? ta0 : null;
    const draft = oldTa && el.dataset.draftFor === dkey ? oldTa.value : (c.draftFor === dkey ? c.draft || '' : loadDraft(w));
    const hadFocus = el.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA';
    // Live status/model paints must not replace a sealed dictation target in this same composer.
    // Navigation to another thread still destroys it: never transfer a seal to the new draft.
    // Same draft = same textarea: live repaints (new steps in a working thread) reuse the owner's field so the caret,
    // selection, undo history and scroll stay put. James, 21 Oct 2026: typing at the bottom of a long reply in a working
    // thread, every repaint threw the box back to the top. Navigation to another thread still gets a fresh field.
    const keepTa = oldTa && el.dataset.draftFor === dkey ? oldTa : null;
    const keepRange = keepTa && [keepTa.selectionStart, keepTa.selectionEnd, keepTa.selectionDirection];
    const keepScroll = keepTa ? keepTa.scrollTop : 0;
    // Stop shows the moment a send is pending (Sending…/Starting…, upload, transcription), not only once the run
    // id arrives: before the run exists it withdraws the send (LIVE.cancelSend), after that it stops the run.
    const canStop = working && !held && s.status !== 'stopping' && (!!s.runId || s.pend !== undefined); // a send a restart holds is saved, not running (issue 1432)
    const rpl = !(isNew && TAG) ? KIT.drafts.get(dkey).reply : null; // an app item (Notifications, Wisdom passage) waiting with this draft
    PW?.ensureModels();
    // The model lives in the message box, bottom-right (James 18 Oct 2026); the header keeps the whole width for the title.
    // Miguel's skins (Dark, Light, Landscapes): a slide switch row above the composer replaces the in-box label.
    const msw = PW?.modelSwitch && s !== undefined ? PW.modelSwitch(w, s) : '';
    const mlabel = PW?.modelLabel && !msw ? PW.modelLabel(w, s) : '';
    const chip = PW && !PW.modelLabel ? PW.modelChip(w, s) : '';
    const fail = PW && !isNew && turns ? PW.failureHtml(w, s) : '';
    const tacts = NV ? (NQ ? '' : noteTactsHtml(NV, false))
      : acts.length && turns && !pend.length ? `<div class="ch-tacts" data-part="thread-actions">${typeof needsAsk === 'function' && needsAsk(s) && canMarkDone(s) ? `<button type="button" class="ch-tact-md" data-chmarkdone aria-label="Mark done: clear Needs you" title="Mark done">${MARK_DONE_SVG}<span>Mark done</span></button>` : ''}${acts.map(a => `<button type="button" data-chact="${a}" aria-label="${ACT[a].hint}" title="${ACT[a].hint}">${ACT[a].icon}<span>${actionLabel(s, a, true)}</span></button>`).join('')}</div>` : '';
    clearReading(w.id);
    // Live repaints rebuild the thread. Keep each already-loaded photo node so it doesn't blank and reload (flicker).
    const keepImgs = keepLoadedImages(el);
    const keepSheet = keptSheet(el);
    const openContexts = el.dataset.draftFor === dkey ? new Set([...el.querySelectorAll('[data-run-original][open]')].map(e => e.dataset.runOriginal)) : new Set();
    const threadHTML = `<div data-part="thread" class="ch-thread${TAG ? ' agent' : ''}${NV ? ' ch-notif-thread' : ''}"${TAG ? ` style="--agc:${AGS()?.colour(agentRec(TAG)) || ''}"` : ''}>
      <div class="ch-head"><button class="ch-back" data-chback aria-label="Back to threads"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>${s && !isNew && stiKind(s) !== 'none' ? stiBadge(s, ' ch-head-sti') : ''}<div class="ti" title="${esc(sub)}">${s && !DL ? `<button type="button" class="ti-b" data-chrename aria-label="Rename thread"><b>${esc(winTitle(w))}</b></button>` : `<b>${esc(NV ? NV.reply.title || NV.item?.title || 'Notification' : DL ? (typeof chanTitle === 'function' ? chanTitle(dailyName(w)) : '# ' + dailyName(w)) : winTitle(w))}</b>${NQ ? `<span class="ch-notif-hsrc"><span class="ch-notif-hic" aria-hidden="true">${NV.item ? noteIcon(NV.item) : window.WosBell?.icon || ''}</span>${esc(NV.item?.source === 'cron' ? 'Scheduled job' : NV.item?.appName || NV.item?.app || 'Notifications')}${NV.item?.time ? ` · ${timeTag(NV.item.time * 1000)}` : ''}</span>` : ''}`}${privTag}</div>${chip}${incognitoAction}${typeof inboxHeadHtml === 'function' && s && !isNew ? inboxHeadHtml(w, s) : ''}<span data-slot="thread-header-actions"></span></div>
      ${s && !isNew && globalThis.WosThreadTracker?.on() ? globalThis.WosThreadTracker.stripHtml(s.id, TAG) : ''}${s && BOOM() ? BOOM().banner(s.id) : ''}<div class="ch-msgs">${msgs}${tacts}${fail}</div>${PW ? PW.latestBtn() : ''}${s && !isNew && typeof jumpPillsHtml === 'function' ? jumpPillsHtml() : ''}
      ${msw ? `<div class="ch-swrow">${msw}<span data-slot="thread-switch-row-end"></span></div>` : '<div data-slot="thread-switch-row-end"></div>'}<form data-slot="composer-end" data-part="composer" class="ch-compose${hasContent(draft, c.files || []) ? ' has-text' : ''}${rpl ? ' has-reply' : ''}" data-chform>${replyBubble(rpl)}${attachTray(c)}<div class="ch-row2"><button type="button" class="ch-attach" data-chattach aria-label="Attach photos or files">${CLIP_SVG}</button><div class="ch-field"><textarea rows="1" placeholder="${!isNew && window.WosModels?.foreignApp?.(s) ? `This chat lives in ${esc(window.WosModels.foreignApp(s))} · reply there` : working && !held ? `Steer ${esc(agentName(TAG))}…` : `Message ${esc(agentName(TAG))}`}" enterkeyhint="enter">${esc(draft)}</textarea>${mlabel}</div>${PW ? PW.micBtn(w.id) : ''}${canStop ? `<button type="button" class="ch-stop" data-chstop aria-label="Stop ${esc(window.WizConfig.agent())}"><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg></button>` : ''}<button type="submit" class="ch-send" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></div></form>
    </div>`;
    // A focused composer must never leave the page during a live repaint: iPhone Safari closes the keyboard the
    // moment a focused field is detached and will not reopen it from script, so the owner saw a caret and no
    // keyboard in any working thread (Miguel, 22 Oct 2026). Rebuild everything around the field instead.
    // A live repaint of the same thread (new step, helper timer, streamed words) patches only what changed: messages,
    // photos, the composer field (focus, caret, keyboard) and the reading place stay exactly as they are
    // (James, 23 Oct 2026: whole-thread rebuilds flickered while a reply was working).
    const troot = el.firstElementChild;
    const morphed = !!keepTa && troot?.dataset.part === 'thread' && troot.contains(keepTa) && !!window.WosMorph?.morph(troot, threadHTML, {
      keep: (n, f) => { if (n !== keepTa) return false; const ph = f.getAttribute('placeholder'); if (ph !== null && n.placeholder !== ph) n.placeholder = ph; return true; },
    });
    if (!morphed) {
      if (!(keepTa && hadFocus && rebuildAround(el, threadHTML, keepTa))) {
        el.innerHTML = threadHTML;
        if (keepTa) { const fresh = el.querySelector('.ch-compose textarea'); keepTa.placeholder = fresh.placeholder; fresh.replaceWith(keepTa); }
      }
      restoreSheet(el, keepSheet);
    }
    for (const detail of el.querySelectorAll('[data-run-original]')) if (detail.open !== openContexts.has(detail.dataset.runOriginal)) detail.open = openContexts.has(detail.dataset.runOriginal);
    if (!morphed) keepImgs(el);
    el.dataset.draftFor = dkey; c.draft = draft; c.draftFor = dkey;
    el.dataset.notificationId = NV?.id || '';
    syncDocumentThread();
    const nb = el.querySelector('.ch-msgs');
    PW?.position(w, el, nb, { turns, working, notification: NV?.id, notificationScroll });
    watchTracker(w, nb);
    if (hadFocus) { const ta = el.querySelector('textarea'); ta.focus({ preventScroll: true }); ta.setSelectionRange(...(keepRange || [ta.value.length, ta.value.length])); }
    growTa(el.querySelector('textarea'));
    // Re-attaching a field resets its scroll to the top; put the owner's view back where it was.
    if (keepTa && !morphed) keepTa.scrollTop = keepScroll;
    // Desktop renders before revealing its thread pane. Measure once it is visible,
    // retaining a usable first layout even before the user types or a live repaint runs.
    const field = el.querySelector('textarea');
    requestAnimationFrame(() => { if (field?.isConnected && field === el.querySelector('textarea')) growTa(field); });
    PW?.paint(w.id, el);
    if (DL && typeof dailyWatch === 'function') dailyWatch(w, el);
    // A returned message Boomerang opens on its message, once.
    if (s && turns && !keep) { const r = BOOM()?.focusFor(s.id); if (r && showBoomMessage(el, r.anchor_at)) BOOM().focusedOn(r.id); }
    // The shell may bind the view this thread's latest reply links (phone: bound views beside the thread).
    if (!isNew && turns) H.threadShown?.(w.id, el);
    window.WosSkinHost?.rendered('thread', el);
  }
  /* ---- drafts: one per thread (and one for a new chat), kept across reloads ---- */
  // An agent's new chat keeps its own slot ('agentnew:<id>'), so it never shows in (or takes) the main Drafts.
  const draftKey = w => w.thread === '__new__' ? (winAgent(w) ? 'agentnew:' + winAgent(w) : 'new') : (!w.thread && typeof chanDraftKey === 'function' && chanDraftKey(w)) || 'direct:' + w.thread;
  function loadDraft(w) {
    const c = ch(w.id), key = draftKey(w), d = KIT.drafts.get(key);
    c.draftFor = key; c.draft = d.text;
    c.files = d.files.map(f => ({ ...f, key: Math.random().toString(36).slice(2), preview: /^image\//.test(f.mime || '') ? (PREVIEW[f.id] || fileUrl(f.id)) : '' }));
    return d.text;
  }
  // Saves the window's box only while its words belong to the box the window now shows (c.draftFor): stale words of
  // another box (a channel's, a thread left) never write over, or empty, this box's draft (wizard-ux issue 1444).
  function saveDraft(wid) { if (INC?.active(wid)) return; const w = W[wid], c = ch(wid); if (!w || (!w.thread && !(typeof chanDraftKey === 'function' && chanDraftKey(w)))) return; const key = draftKey(w); if (c.draftFor !== key) return; KIT.drafts.set(key, c.draft || '', c.files || []); }
  // Words typed (or dictated) into a box are saved under that box's own key: a channel box under its channel, a thread's
  // box under the thread it was painted for, whatever the window's state says by then.
  function typedInto(id, ta) {
    const c = ch(id), form = ta.form || ta.closest?.('form'), el = elOf(id);
    const mk = form?.dataset?.morphKey || '', own = form?.dataset && 'chchanform' in form.dataset ? (mk.startsWith('chanbox:') ? mk.slice(8) : '') : el?.dataset?.draftFor || '';
    const w = W[id], key = w ? draftKey(w) : '';
    if (own && own !== key) { if (!INC?.active(id)) KIT.drafts.set(own, ta.value, KIT.drafts.get(own).files); return; }
    if (own) c.draftFor = own;
    c.draft = ta.value; saveDraft(id);
  }
  function openMedia(wid, k) {
    const c = ch(wid), list = c.media || [], m = list[k]; if (!m) return;
    // Photos swipe as one gallery (this thread, oldest first); a file or video opens on its own.
    if (m.kind === 'image') { const g = list.filter(x => x.kind === 'image'); return KIT.viewer.open(g, g.indexOf(m)); }
    KIT.viewer.open([m], 0);
  }
  KIT.K.notify = (icon, text) => toast(icon, text, 1800);
  KIT.K.onChange = open => H.overlay?.(open);
  /* Pull to refresh (James, 21 Oct 2026): at the top of a Chats list, drag down and let go to re-read the list now.
   * Listeners stay passive so native scrolling, desk swipes and row swipes keep their ownership; the pull only engages
   * on a clearly downward drag that starts with the list already at the top. The finger on the list holds list
   * re-renders (readGuard), so the indicator can be painted directly while dragging. */
  const PTR_GO = 48, PTR_MAX = 84;
  let ptr = null;
  function paintPull(p, d) {
    const el = p.sc.parentElement?.querySelector(':scope > .ch-ptr'); if (!el) return;
    el.classList.remove('out'); el.style.height = d + 'px';
    const go = d >= PTR_GO; el.classList.toggle('go', go);
    const tx = el.querySelector('span'); if (tx) tx.textContent = go ? 'Release to refresh' : 'Pull to refresh';
  }
  function endPull() {
    const p = ptr; ptr = null; if (!p?.on) return;
    const el = p.sc.parentElement?.querySelector(':scope > .ch-ptr');
    if (el) { el.classList.add('out'); el.style.height = '0px'; el.classList.remove('go'); }
    if (p.d >= PTR_GO) pullRefresh(p.wid);
  }
  function repaintList(wid) { const w = H.win(wid), el = elOf(wid); if (w && !w.thread && el && el.querySelector('.ch-list') && !holdList(wid)) renderChatList(w, el); }
  function pullRefresh(wid) {
    const c = ch(wid); if (!wid || c.ptrState === 'busy') return;
    vib(10); clearTimeout(c.ptrT); c.ptrState = 'busy'; repaintList(wid);
    const agent = winAgent(H.win(wid));
    Promise.resolve(LIVE.refresh()).catch(() => {}).then(() => {
      const st = LIVE.statusFor ? LIVE.statusFor(agent) : { error: LIVE.error };
      c.ptrState = st.error ? '' : 'done'; repaintList(wid);
      if (c.ptrState) c.ptrT = setTimeout(() => { c.ptrState = ''; repaintList(wid); }, 1600);
    });
  }
  function bindPull(root) {
    // James's own touch or wheel on the list owns its scroll from here: drop any return bookmark still being held.
    const own = e => { const sc = e.target.closest?.('.ch-list > .ch-scroll'); const id = sc && idOf(sc); if (id) { ch(id).listPending = null; if (typeof chanUser === 'function') chanUser(id); } };
    root.addEventListener('wheel', own, { capture: true, passive: true });
    for (const t of ['touchmove', 'pointerdown', 'keydown']) root.addEventListener(t, own, { capture: true, passive: true });
    root.addEventListener('touchstart', e => {
      own(e);
      ptr = null;
      if (H.pullRefresh?.() === false) return; // a package moved refresh to the ↻ in the window bar
      if (e.touches.length !== 1) return;
      const sc = e.target.closest?.('.ch-list > .ch-scroll'); if (!sc || sc.scrollTop > 0) return;
      if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const t = e.touches[0]; ptr = { sc, wid: idOf(sc), x: t.clientX, y: t.clientY, y0: 0, on: false, d: 0 };
    }, { capture: true, passive: true });
    root.addEventListener('touchmove', e => {
      if (!ptr) return; const t = [...e.touches][0]; if (!t || e.touches.length !== 1) { endPull(); return; }
      const dx = t.clientX - ptr.x, dy = t.clientY - ptr.y;
      if (!ptr.on) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { ptr = null; return; } // a desk or row swipe
        if (dy < -6 || ptr.sc.scrollTop > 0) { ptr = null; return; } // scrolling the list
        if (dy < 12 || dy < Math.abs(dx) * 1.5) return;
        ptr.on = true; ptr.y0 = dy; if (lp) { clearTimeout(lp.t); lp.row.style.transform = ''; lp = null; }
      }
      ptr.d = Math.max(0, Math.min(PTR_MAX, (dy - ptr.y0) * 0.5));
      paintPull(ptr, ptr.d);
    }, { capture: true, passive: true });
    root.addEventListener('touchend', endPull, { capture: true, passive: true });
    root.addEventListener('touchcancel', () => { if (ptr) ptr.d = 0; endPull(); }, { capture: true, passive: true });
  }
  /* Long-press or swipe left on a thread row → thread actions (listeners in bind()). */
  let lp = null, lpUntil = 0, lpHeld = null;
  /* Gmail-style swipe (Novaire, 23 Oct 2026): in the Novairecito phone skin family, swipe a row left and it stays
   * open over two explicit buttons: Recall (🪄, schedule a return) and Done (Archive, restorable). Swiping never
   * performs an action. Tapping elsewhere, scrolling or swiping back closes it; list repaints wait while open. */
  let swipeOpen = null; // { wid, sid, wrap }
  const SWIPE_W = 148;
  const ownerSwipe = () => document.documentElement.dataset.shell === 'phone' && ['novairecito', 'sepia'].includes(document.documentElement.dataset.skin || '');
  function swipeActs(sid) {
    const s = LIVE.session(sid), acts = threadActions(s, null);
    const file = acts.includes('done') ? 'done' : acts.includes('restore') ? 'restore' : '';
    return { recall: !!BOOM(), file };
  }
  function swipeTray(wrap, sid) {
    let tray = wrap.querySelector(':scope > .ch-swipe-acts'); if (tray) return tray;
    const a = swipeActs(sid), s = LIVE.session(sid), t = esc(s?.title || 'chat');
    const btn = (k, cls, glyph, label, aria) => `<button type="button" class="ch-swipe-act ${cls}" data-chswipe="${k}" aria-label="${aria} ${t}" tabindex="-1">${glyph}<span>${label}</span></button>`;
    wrap.insertAdjacentHTML('afterbegin', `<div class="ch-swipe-acts" aria-hidden="true">${a.recall ? btn('recall', 'recall', '<i aria-hidden="true">🪄</i>', 'Recall', 'Recall') : ''}${a.file ? btn(a.file, a.file, ACT[a.file].icon, ACT[a.file].label, ACT[a.file].hint + ':') : ''}</div>`);
    tray = wrap.firstElementChild; tray.style.setProperty('--n', String((a.recall ? 1 : 0) + (a.file ? 1 : 0)) || '1');
    return tray;
  }
  function swipeA11y(wrap, open) {
    const tray = wrap?.querySelector(':scope > .ch-swipe-acts'); if (!tray) return;
    tray.setAttribute('aria-hidden', open ? 'false' : 'true');
    for (const b of tray.querySelectorAll('button')) b.tabIndex = open ? 0 : -1;
    if (!open && tray.contains(document.activeElement)) wrap.querySelector('.ch-row')?.focus?.({ preventScroll: true });
  }
  function closeSwipe(instant) {
    if (!swipeOpen) return false;
    const { wrap, wid } = swipeOpen; swipeOpen = null;
    const row = wrap.querySelector('.ch-row'); swipeA11y(wrap, false);
    if (row) { if (instant) row.style.transition = 'none'; row.style.transform = ''; if (instant) requestAnimationFrame(() => { row.style.transition = ''; }); }
    wrap.style.setProperty('--sw', '0px');
    wrap.classList.remove('swiping', 'swiped');
    setTimeout(() => { if (swipeOpen?.wrap !== wrap) wrap.querySelector(':scope > .ch-swipe-acts')?.remove(); }, instant ? 0 : 180);
    const c = CH[wid]; if (c?.heldList) setTimeout(() => repaintList(wid), 200);
    return true;
  }
  // Long-press / swipe / right-click on rows, and paste-to-attach; bound to each shell's root in bind().
  function bindGestures(root) {
    root.addEventListener('touchstart', e => {
      const node = e.target.closest?.('.ch-msgs, .ch-scroll'); if (!node) return;
      const g = readGuard(node); g.at = Date.now();
      for (const t of e.changedTouches) { g.touches.add(t.identifier); TOUCH.set(t.identifier, g); }
    }, { capture: true, passive: true });
    root.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) { const g = TOUCH.get(t.identifier); if (g) g.at = Date.now(); }
    }, { capture: true, passive: true });
    root.addEventListener('scroll', e => {
      if (!e.target.matches?.('.ch-msgs, .ch-scroll')) return;
      if (e.target.matches('.ch-list > .ch-scroll')) { const id = idOf(e.target); if (id) { queueListPlace(id); if (typeof chanScrolled === 'function') chanScrolled(id, e.target); } }
      if (swipeOpen) closeSwipe(true);
      if (typeof paintFeedJump === 'function' && e.target.matches('.ch-list > .ch-scroll')) { const id = idOf(e.target); if (id) paintFeedJump(id, e.target); } // issue 1440: the feed's pills
      const g = readGuard(e.target); g.until = Date.now() + SCROLL_IDLE; scheduleHeld();
    }, { capture: true, passive: true });
    // A finger on the messages holds background re-renders (see selectingIn) until it lifts.
    root.addEventListener('pointerdown', e => { const m = e.target.closest?.('.ch-msgs'); if (m && e.button <= 0) Object.assign(SEL, { down: m, at: Date.now(), x: e.clientX, y: e.clientY }); }, true);
    const lift = () => { if (!SEL.down) return; SEL.down = null; clearTimeout(selT); selT = setTimeout(flushHeld, 350); };
    // A quick tap away from the selected words clears the selection, as anywhere on Android (WebView keeps it when
    // the tap lands on the non-selectable shell around the bubbles).
    root.addEventListener('pointerup', e => {
      const quick = SEL.down && Date.now() - SEL.at < 450 && Math.hypot(e.clientX - SEL.x, e.clientY - SEL.y) < 10;
      const s = window.getSelection?.();
      if (quick && s && !s.isCollapsed && s.rangeCount && !e.target.closest?.('button, a, textarea, input')) {
        const r = s.getRangeAt(0), anchor = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
        const hit = [...r.getClientRects()].some(b => e.clientX >= b.left - 4 && e.clientX <= b.right + 4 && e.clientY >= b.top - 4 && e.clientY <= b.bottom + 4);
        if (!hit && anchor && root.contains(anchor) && anchor.closest('.ch-msgs')) s.removeAllRanges();
      }
      lift();
    }, true);
    root.addEventListener('pointercancel', e => { if (e.pointerType !== 'touch') lift(); }, true);
    // Speed: pointing at (desktop) or touching a row starts its history read; the open joins that request.
    root.addEventListener('pointerover', e => { if (e.pointerType !== 'mouse') return; const row = e.target.closest?.('.ch-list [data-chopen]'); if (row && row !== root._warmRow) { root._warmRow = row; clearTimeout(root._warmT); root._warmT = setTimeout(() => LIVE.warm?.(row.dataset.chopen), 90); } });
    root.addEventListener('pointerdown', e => {
      const row = e.target.closest(ROW_MENU); if (!row || e.button > 0) return;
      if (row.dataset.chopen) LIVE.warm?.(row.dataset.chopen);
      const wid = idOf(row);
      const wrap = row.closest('.ch-row-wrap');
      // A touch on another row (or the open one) first closes an open swipe, like Gmail.
      const wasOpen = swipeOpen && swipeOpen.wrap === wrap;
      if (swipeOpen && !wasOpen) closeSwipe();
      const swipe = !!row.dataset.chopen && e.pointerType !== 'mouse' && ownerSwipe();
      lp = { row, wrap, wid, sid: row.dataset.chopen, nid: row.dataset.chnotif, swipe, page: e.pointerType === 'touch' && !!row.dataset.chchan && !!row.closest('.ch-list')?.querySelector('.ch-chan-tabs [data-chview]'), base: swipe && wasOpen ? -SWIPE_W : 0, pid: e.pointerId, pointerId: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, moved: false, t: setTimeout(() => { if (!lp || lp.moved || window.WosSkinHost?.claimed(lp.pid)) return; lpUntil = Date.now() + 700; if (swipeOpen) closeSwipe(true); lpHeld = lp.pid; rowMenu(lp.wid, lp.row); lp = null; }, 480) };
    });
    root.addEventListener('pointermove', e => {
      if (!lp) return;
      if (window.WosSkinHost?.claimed(e.pointerId)) { clearTimeout(lp.t); lp.row.style.transform = ''; lp = null; return; } // a skin gesture owns this finger
      const dx = e.clientX - lp.x, dy = e.clientY - lp.y;
      if (!lp.swipe) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { clearTimeout(lp.t); lp.row.style.transform = ''; lp = null; return; }
        if (Math.abs(dx) > 10) clearTimeout(lp.t);
        // A channel row on the Channels page leaves a sideways touch to the page swipe (issue 1467: Channels → Activity).
        if (dx < 0 && !lp.page) { lp.dx = dx; lp.row.style.transform = `translateX(${Math.max(dx, -90)}px)`; }
        return;
      }
      if (!lp.moved && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { clearTimeout(lp.t); if (!lp.base) lp.row.style.transform = ''; lp = null; return; }
      if (Math.abs(dx) > 10) { clearTimeout(lp.t); if (!lp.moved) { lp.moved = true; swipeTray(lp.wrap, lp.sid); lp.wrap.classList.add('swiping'); lp.row.style.transition = 'none'; try { lp.row.setPointerCapture?.(lp.pointerId); } catch (_) {} } }
      if (!lp.moved) return;
      const w = lp.wrap.clientWidth || 360, off = Math.min(0, Math.max(lp.base + dx, -w * 0.9));
      lp.dx = off; lp.row.style.transform = `translateX(${off}px)`; lp.wrap.style.setProperty('--sw', `${-off}px`);
      lp.wrap.classList.toggle('commit', off < -w * 0.5);
    });
    const lpEnd = () => {
      if (lpHeld !== null) { lpHeld = null; lpUntil = Date.now() + 700; }
      if (!lp) return; const q = lp; lp = null; clearTimeout(q.t);
      if (!q.swipe) {
        q.row.style.transform = '';
        // Preserve the stock gesture outside Novairecito phone skins and on desktop.
        if (q.dx < -60 && q.row.dataset.quiet === '1' && threadActions(rowOf(q.wid, q.sid), null).includes('done')) { lpUntil = Date.now() + 700; threadAct(q.wid, q.sid, 'done'); }
        else if (q.dx < -60) { lpUntil = Date.now() + 700; if (!q.row.dataset.chchan) openRowSheet(q.wid, q.sid, q.nid); else rowMenu(q.wid, q.row); }
        return;
      }
      if (!q.moved) return;
      try { q.row.releasePointerCapture?.(q.pointerId); } catch (_) {}
      q.row.style.transition = ''; lpUntil = Date.now() + 500;
      if (q.dx < -SWIPE_W * 0.4) { q.row.style.transform = `translateX(${-SWIPE_W}px)`; q.wrap.style.setProperty('--sw', `${SWIPE_W}px`); q.wrap.classList.add('swiped'); swipeOpen = { wid: q.wid, sid: q.sid, wrap: q.wrap }; swipeA11y(q.wrap, true); vib(6); return; }
      swipeOpen = { wid: q.wid, sid: q.sid, wrap: q.wrap }; closeSwipe();
    };
    const lpCancel = () => {
      if (lpHeld !== null) { lpHeld = null; lpUntil = Date.now() + 700; }
      if (!lp) return; const q = lp; lp = null; clearTimeout(q.t);
      try { q.row.releasePointerCapture?.(q.pointerId); } catch (_) {}
      q.row.style.transition = ''; q.row.style.transform = q.base ? `translateX(${-SWIPE_W}px)` : '';
      if (q.base) { q.wrap.style.setProperty('--sw', `${SWIPE_W}px`); q.wrap.classList.remove('swiping'); q.wrap.classList.add('swiped'); swipeOpen = { wid: q.wid, sid: q.sid, wrap: q.wrap }; swipeA11y(q.wrap, true); }
      else { q.wrap.style.setProperty('--sw', '0px'); q.wrap.classList.remove('swiping', 'swiped'); q.wrap.querySelector(':scope > .ch-swipe-acts')?.remove(); }
    };
    root.addEventListener('pointerup', lpEnd); root.addEventListener('pointercancel', lpCancel);
    // Right-click (a mouse) opens the same sheet; a touch long-press already did.
    root.addEventListener('contextmenu', e => { const row = e.target.closest(ROW_MENU); if (!row) return; e.preventDefault(); if (!rowSheet && !lp) { lpUntil = Date.now() + 700; rowMenu(idOf(row), row); } });
    // Paste, drag/drop and the Enter policy come from the shared WizComposerInput (web/core/composer-input.js), the
    // same implementation apps get as WizardApp.composer: files go to addFiles (the paperclip upload path), text
    // pastes insert from the event snapshot (dictation-app safe), an empty paste explains how to get the take back.
    window.WizComposerInput.bind(root, {
      field: '.ch-compose textarea', zone: '.ch-compose',
      onFiles: (files, ta) => addFiles(idOf(ta), files),
      notice: msg => toast('!', msg, 4200),
    });
  }
  /* Durable outbox and reading a thread: core/chats-outbox.js. */
  const { echoed, loadThread, localSent, pendingFor, pendingHtml, reconcileSent, renderChats, retryShown, threadAlive, threadErrHtml, turnsCurrent } = window.WizCore.chatsParts.outbox({ ch, CH, CHECK_SVG, elOf: (...a) => elOf(...a), esc, H, INC, isWorking, KIT, LIVE, loadApproval, md, MIC_SVG, needsLand, OUTBOX, PEND, reach, reachLabel, renderChatList, renderLive, renderThread, renderThreadLive, replyCard, rowOf, syncListTitle, toTurns, track, troubleshoot, userMedia, W });
  eventsLate({ renderChats });
  streamLate({ loadThread });
  rowactsLate({ renderChats });
  setupLate({ renderChats });
  /* Thread trail: a thread opened from a link inside another thread remembers where it came from, so Back,
   * Done and Defer step back to that thread instead of the list (James clicks through a summary thread's links,
   * reviews each one, taps Done, and lands back on the summary). Opening a thread any other way starts a fresh trail. */
  function openChat(wid, sid, opts = {}) {
    window.WizCore.chatSearch?.park(wid); // Back returns to these results, not a fresh search
    const w = W[wid]; if (!w) return;
    if (INC?.active(wid) && !INC.close(wid)) return;
    if (opts.via === 'link' && w.daily && typeof dailyLinkTo === 'function' && dailyLinkTo(w, sid)) return; // issue 1469
    if (!w.thread) { const c0 = ch(wid), place = c0.listPending || listPlace(elOf(wid)); c0.listPending = null; if (place) c0.listPlace = place; }
    const listOrder = archiveListOrder(wid, sid);
    if (w.thread) saveDraft(wid);
    closeRowSheet();
    const c = ch(wid); c.archiveOrder = listOrder; c.approval = null; c.cachedFor = ''; // a cached paint belongs to one open only
    c.err = ''; c.failN = 0; clearTimeout(c.retryT); // a read error belongs to the thread that failed, never the next one opened
    c.readNav = (c.readNav || 0) + 1;
    if (w.thread !== sid) H.threadShown?.(wid, null); // close the old preview immediately, even while the new thread loads
    if (opts.via === 'link' && w.thread && w.thread !== '__new__' && w.thread !== sid) {
      // A thread left from the Daily view comes back in it (issue 1653): the same earlier days above, so the same place.
      // Kept per trail entry (index-aligned with the trail; the trail can hold one thread twice, once in each view).
      const t = c.trail || [], td = (c.trailDaily || []).slice(0, t.length); while (td.length < t.length) td.push(null);
      td.push(typeof dailyOn === 'function' && dailyOn(w) ? { sid: w.thread, id: w.daily.id, agent: w.daily.agent } : null);
      c.trail = t.concat(w.thread).slice(-20); c.trailDaily = td.slice(-20);
    } else if (!opts.keepTrail) c.trail = [];
    PW?.opened(wid, sid, !!opts.back);
    if (sid === '__new__' && w.thread !== '__new__') c.newAt = Date.now(); // a fresh new chat: nothing older shows in it
    w.thread = sid; save(); loadDraft(w);
    if (typeof dailyClaim === 'function') dailyClaim(w, sid); // issue 1469: a Daily tap's thread shows the Daily view
    if (typeof jumpOpened === 'function') jumpOpened(wid, sid, typeof chanSeenRow === 'function' && sid !== '__new__' ? chanSeenRow(wid, sid) : null); // issue 1359: green = unread when opened
    if (sid !== '__new__') { LIVE.markSeen(typeof chanSeenRow === 'function' ? chanSeenRow(wid, sid) : sid); if (typeof chanSeenPaint === 'function') chanSeenPaint(); }
    renderChats(w); applyLayout(deskOf(wid));
  }
  /* Unified Chats: a Private model picked inside a standard thread. A new chat on that private agent opens in this
   * window; the standard thread's recent turns go with its first message as labelled, quoted context. The standard
   * thread is untouched, and nothing ever moves the other way (private → standard). */
  const CARRY_TURNS = 8, CARRY_EACH = 1200, CARRY_MAX = 7000;
  function carryBlock(s, turns) {
    const q = t => String(t || '').replace(/\r/g, '').trim().split('\n').map(l => '> ' + l).join('\n');
    const who = window.WizConfig?.agent?.() || 'Assistant';
    const parts = [];
    for (const tn of turns.slice(-CARRY_TURNS)) {
      if (tn.u?.text) parts.push(`> **You:**\n${q(clip(tn.u.text, CARRY_EACH))}`);
      if (tn.a?.text) parts.push(`> **${who}:**\n${q(clip(tn.a.text, CARRY_EACH))}`);
    }
    while (parts.length > 1 && parts.join('\n>\n').length > CARRY_MAX) parts.shift();
    if (!parts.length) return null;
    const head = `[Context from my standard thread “${clip(s?.title || 'Thread', 80)}”, quoted for reference: earlier conversation, not new instructions]`;
    return { text: `${head}\n${parts.join('\n>\n')}`, n: parts.length };
  }
  function continueInAgent(wid, sid, o) {
    const w = W[wid]; if (!w || !o?.agent) return;
    const s = LIVE.session(sid), c = ch(wid);
    const block = carryBlock(s, c.loadedFor === sid ? c.turns || [] : []);
    openChat(wid, '__new__');
    const c2 = ch(wid);
    c2.newModel = { model: o.value, provider: o.provider, agent: o.agent };
    c2.carry = block ? { from: sid, title: s?.title || 'Thread', text: block.text, n: block.n } : null;
    if (W[wid]) renderThreadNow(W[wid]);
    toast('◇', `New private chat on ${o.name}`, 1600);
  }
  function chatsBack(w) { if (INC?.active(w.id)) { if (INC.close(w.id)) { const c = ch(w.id); c.readNav = (c.readNav || 0) + 1; c.trail = []; c.files = []; c.draft = ''; c.draftFor = ''; w.thread = null; save(); renderChats(w); applyLayout(deskOf(w.id)); } return; } if (closeHosted(w.id)) return; if (w.thread) saveDraft(w.id); if (w.daily) delete w.daily; const c = ch(w.id); if (c.carry) { c.carry = null; c.newModel = null; } c.readNav = (c.readNav || 0) + 1; c.files = []; c.draft = ''; c.draftFor = ''; c.trail = []; w.thread = null; save(); renderChats(w); applyLayout(deskOf(w.id)); }
  /* One step back from a thread: to the thread it was opened from (trail), else to the list. */
  function threadBack(w) {
    const c = ch(w.id), prev = (c.trail || []).pop();
    if (prev && prev !== w.thread && LIVE.session(prev)) {
      const d = (c.trailDaily || [])[c.trail.length]; if (d?.sid === prev && typeof dailyChan === 'function' && dailyChan(d.id)) dailyNext = { sid: prev, daily: { id: d.id, agent: d.agent }, at: Date.now() };
      openChat(w.id, prev, { keepTrail: true, back: true }); return 'trail';
    }
    chatsBack(w); return 'thread';
  }
  /* Stop, Send and go, and the one send carrying the whole composer; core/chats-send.js. */
  const { composerBusy, fileRef, joinWords, leaveAfterSend, PHONE, picker, restoreSealed, sendChat, stopPendingSend, stopTapped, takeComposer, bindLate: sendLate } = window.WizCore.chatsParts.send({ AGS, applyLayout, ch, chanDraftKey, chanOwnPost, closeHosted, dailyTarget, deskOf, elOf: (...a) => elOf(...a), focusOf, growTa, H, hosted, INC, isWorking, keepThreadOpen, KIT, LIVE, needsReplied, openChat, openHosted, OUTBOX, PEND, pendRef, refreshCompose, refreshReply, renderChats, renderThreadNow, save, setDraft, spaceMember, syncSend, threadBack, toast, viewContext, W, winAgent });
  chanboxLate({ sendChat });
  let pickFor = '';
  picker.addEventListener('change', () => { const list = [...picker.files]; picker.value = ''; if (pickFor && W[pickFor] && list.length) addFiles(pickFor, list); });
  // Empty composers keep the model name in the free bottom-right corner. As soon as there is a draft, the name gets
  // its own strip below the textarea so its 40px tap target can never intercept text selection or editing. The mirror
  // still catches placeholder collisions and scrolling states where the editable area cannot safely share the corner.
  let mirror = null;
  function fitLabel(root) {
    const ta = root?.matches?.('textarea') ? root : root?.querySelector('.ch-field textarea');
    const lab = ta?.parentElement?.querySelector('.ch-mlabel');
    if (!ta || !lab) return;
    const lw = lab.offsetWidth; if (!lw || !ta.clientWidth) return;
    const cs = getComputedStyle(ta), padL = parseFloat(cs.paddingLeft) || 0, padR = 14;
    ta.style.paddingRight = `${padR}px`;
    const inner = ta.clientWidth - padL - padR;
    if (!mirror) { mirror = document.createElement('div'); mirror.setAttribute('aria-hidden', 'true'); mirror.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;pointer-events:none'; document.body.appendChild(mirror); }
    mirror.style.width = `${inner}px`; mirror.style.font = cs.font; mirror.style.letterSpacing = cs.letterSpacing; mirror.style.lineHeight = cs.lineHeight;
    const text = ta.value || ta.placeholder || '';
    mirror.textContent = text; const end = document.createElement('span'); end.textContent = '\u200b'; mirror.appendChild(end);
    const lastEnd = end.offsetLeft; // x where the last line ends
    const lineHeight = parseFloat(cs.lineHeight) || 0;
    const lineCount = lineHeight > 0 ? Math.round(mirror.offsetHeight / lineHeight) : 1;
    const room = inner - lw + 12; // last-line text may come within ~8px of the label's visible name (the label has 10px inner padding)
    // The name gets its own strip for every draft: its 40px tap target otherwise sits on top of the editable row and
    // steals taps used to place or drag the selection. Keep the measured fallbacks for an empty placeholder collision
    // or scrolling box too, because those states cannot safely share the editable area.
    const scrolls = ta.scrollHeight > ta.clientHeight + 2;
    const hasDraft = ta.value.length > 0;
    ta.style.paddingBottom = '';
    ta.parentElement.classList.toggle('lab-row', hasDraft || lineCount >= 3 || lastEnd > room || scrolls);
  }
  function growTa(ta) {
    if (!ta) return;
    const top = ta.scrollTop; // collapsing to 'auto' to measure clamps the scroll; keep the owner's view
    ta.style.height = 'auto';
    if (ta.getClientRects().length && ta.clientWidth) ta.style.height = Math.min(Math.max(42, ta.scrollHeight + 2), 140) + 'px';
    fitLabel(ta);
    if (ta.scrollTop !== top) ta.scrollTop = top;
  }
  // While a thread is on screen AND James is at that screen, new replies count as read (same rule as Wizard).
  // "At the screen" = the page was opened, brought to the front, touched, clicked, typed in or scrolled within
  // ATTEND_MS. A window left open on a thread (James, 14 Oct 2026: a Mac tab sat on "Our PRs" and marked its new
  // reply read while he was on his phone) keeps the reply unread everywhere until he comes back: his first input
  // there re-runs this check, so the thread he is actually looking at still clears at once.
  const ATTEND_MS = 60e3;
  let lastPresence = Date.now();
  const attended = () => !document.hidden && Date.now() - lastPresence < ATTEND_MS;
  function presence() {
    const wasAway = Date.now() - lastPresence >= ATTEND_MS; lastPresence = Date.now();
    if (wasAway) setTimeout(markVisibleThreadsSeen, 0);
  }
  // Real input only: a 'scroll' event also fires when a new reply auto-scrolls the thread, which is not James.
  for (const t of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(t, presence, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) lastPresence = Date.now(); }, true);
  function markVisibleThreadsSeen() {
    if (!LIVE?.ok || !attended()) return;
    for (const id of desks[idx].wins) {
      const w = W[id]; if ((w?.app !== 'chats' && !isHosted(id)) || !w.thread || w.thread === '__new__') continue;
      const hold = ch(id).unreadHold; if (hold?.sid === w.thread && hold.nav === ch(id).readNav) continue;
      const r = typeof chanSeenRow === 'function' ? chanSeenRow(id, w.thread) : w.thread, s = typeof r === 'object' ? r : LIVE.session(w.thread); if (s && LIVE.isNew(s)) LIVE.markSeen(r);
    }
  }

  const elOf = id => H.root().querySelector(`[data-chats="${id}"]`);
  const idOf = t => t.closest('[data-chats]')?.dataset.chats || '';
  /* Clicks inside a Chats window. Returns true when it handled the click. */
  function click(e, id) {
    if (INC?.click(id, e)) return true;
    if (e.target.closest('.ch-back[data-incog-close]')) { chatsBack(W[id]); return true; }
    if (e.target.closest('[data-incog-close]')) { if (INC?.close(id)) renderChats(W[id]); return true; }
    if (e.target.closest('[data-incog-off]')) { INC?.close(id); renderChats(W[id]); return true; }
    if (e.target.closest('[data-incog-start]')) { const w = W[id]; if (!w || w.thread !== '__new__') return true; if (H.captureBusy?.()) { renderChats(w); toast('!', 'Finish recording before starting Incognito', 2600); return true; } const c = ch(id), agentId = winAgent(w) || c.newModel?.agent; const a = AGS()?.get(agentId); if (window.WizCore.incognitoOptIn?.enabled(a)) { saveDraft(id); void INC?.start(id, a); } return true; }
    if (e.target.closest('[data-chtroubleshoot]')) { window.WizReach?.open(); return true; }
    const w = H.win(id); if (!w) return false;
    // A tweak card's switch: flips on this frame, Settings › Look's toggle underneath (core/settings.js tweakCardTap).
    const twk = e.target.closest('[data-chat-tweak]'); if (twk) { window.WosSettings?.tweakCardTap?.(twk, (i, t) => toast(i, t, 2400)); return true; }
    // Thread tracker: the strip's own taps, Reply on a message, and the quote header's jump (all inert with the tweak off).
    if (globalThis.WosThreadTracker?.onFor?.(LIVE.agentOf && w.thread ? LIVE.agentOf(w.thread) : '')) {
      const resume = text => resumeTracked(id, w, text);
      if (globalThis.WosThreadTracker.click(e, { sid: w.thread, agent: LIVE.agentOf && w.thread ? LIVE.agentOf(w.thread) : '', jump: a => jumpToMessage(id, a), resume })) return true;
      const mq = e.target.closest('[data-mquote]'); if (mq) { quoteMessage(w, mq.closest('.msg')); return true; }
    }
    // Issue 1331: Reply on any message in the main agent's threads, and the thread's own Mark done.
    if (typeof replyStd === 'function' && replyStd(LIVE.agentOf && w.thread ? LIVE.agentOf(w.thread) : '')) { const mq = e.target.closest('[data-mquote]'); if (mq) { quoteMessage(w, mq.closest('.msg')); return true; } }
    if (e.target.closest('[data-chmarkdone]') && w.thread) { markDone(id, w.thread, true); return true; }
    const jp = e.target.closest('[data-chjump]'); if (jp && w.thread && typeof jumpGo === 'function') { jumpGo(id, jp.dataset.chjump); return true; } // issue 1359
    const qj = e.target.closest('[data-ttjump]'); if (qj) { jumpToMessage(id, { message_id: qj.dataset.ttjump || null, at: +qj.dataset.ttjumpAt || 0 }); return true; }
    const hc = e.target.closest('[data-helper-continue]');
    if (hc) {
      if (hc.disabled) return true; hc.disabled=true; hc.textContent='Resuming…';
      fetch(hc.dataset.preview ? '/wizard/preview/helper-continue' : '/wizard/helper-continue', {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:w.thread})})
        .then(async r=>{ if(!r.ok) throw new Error(r.status===409 ? 'Already active or no longer resumable' : 'Could not resume'); await LIVE.refresh(); toast('↻','Continuing the same request',1800); })
        .catch(err=>{ hc.disabled=false; hc.textContent=hc.dataset.preview ? 'Try Continue · example only' : 'Continue'; toast('!',''+err.message,2600); });
      return true;
    }
    const failedDismiss = e.target.closest('[data-obdismissfailed]'); if (failedDismiss) {
      if (failedDismiss.disabled) return true;
      failedDismiss.disabled = true;
      const gone = OUTBOX.get?.(failedDismiss.dataset.obdismissfailed);
      Promise.resolve(OUTBOX.dismissFailed(failedDismiss.dataset.obdismissfailed)).then(ok => {
        if (!ok) failedDismiss.disabled = false;
        // A dismissed channel post leaves its feed now (issue 1293), not when its "Sending…" post times out.
        if (ok && gone?.kind === 'new' && typeof chanDropSending === 'function' && chanDropSending(gone)) chanRepaint();
        // A pressed desktop list temporarily holds background paints. An explicit
        // dismissal must update its own pill now, rather than wait for a later poll.
        const current = H.win(id);
        if (ok && current && !current.thread) renderChatList(current, elOf(id));
        H.toast(ok ? '✓' : '!', ok ? 'Dismissed · original kept in Unsent messages' : 'Could not save dismissal · original kept', 2400);
      }).catch(() => { failedDismiss.disabled = false; H.toast('!', 'Could not save dismissal · original kept', 2400); });
      return true;
    }
    // Errors-section voice rows own their Dismiss (confirm → delete).
    const dismiss = !e.target.closest('[data-errob]') && e.target.closest('[data-obdismiss]'); if (dismiss) {
      const sent = OUTBOX.get(dismiss.dataset.obdismiss)?.state === 'sent';
      Promise.resolve(OUTBOX.dismissBubble(dismiss.dataset.obdismiss)).then(ok => {
        H.toast(ok ? '✓' : '!', ok ? (sent ? 'Sent bubble dismissed · message stays in this chat' : 'Bubble dismissed · recording kept in Unsent messages') : 'Could not save dismissal · original kept', 2400);
      }); return true;
    }
    const discard = e.target.closest('[data-obdiscard]'); if (discard) {
      if (discard.disabled) return true;
      const item = OUTBOX.get(discard.dataset.obdiscard);
      if (!item?.lateHeld || item.state !== 'held') return true;
      discard.disabled = true;
      const sid = w.thread, nav = ch(id).readNav;
      Promise.resolve(OUTBOX.remove(item.id)).then(ok => {
        if (!ok) { discard.disabled = false; H.toast('!', 'Could not save discard · original kept', 2400); return; }
        if ((!PHONE() || !keepThreadOpen()) && H.win(id) === w && w.thread === sid && ch(id).readNav === nav && sid) threadBack(w);
      }).catch(() => { discard.disabled = false; H.toast('!', 'Could not save discard · original kept', 2400); });
      return true;
    }
    const recovery = e.target.closest('[data-obrecover]'); if (recovery) { H.recoverUnsent?.(recovery.dataset.obrecover); return true; }
    const rb = e.target.closest('[data-obretry]'); if (rb) { H.toast('↻', OUTBOX.retryFeedback(OUTBOX.retry(rb.dataset.obretry)), 2400); return true; }
    if (e.target.closest('[data-chunsent]')) { H.openUnsent?.(); return true; }
    if (e.target.closest('[data-chrunning]')) { runningGo(w, true); return true; }
    if (e.target.closest('[data-chrunback]')) { runningBack(w); return true; }
    const ro = e.target.closest('[data-chrunopen]'); if (ro) { openChat(id, ro.dataset.chrunopen); return true; }
    const io = e.target.closest('[data-chinboxopen]'); if (io) { inboxMove('open', io.dataset.chinboxopen, { title: io.dataset.title || '' }); return true; }
    const swb = e.target.closest('[data-chsweep]'); if (swb) { if (!swb.disabled) sweepAnswer(swb.dataset.card, swb.dataset.chsweep, swb.dataset.opt); return true; }
    // Running on the sweep card: the desktop's list pane (id::list) shows the Running view next to the thread; with one
    // pane (phone) the thread steps back to the list first.
    if (e.target.closest('[data-chsweeprunning]')) {
      const o = W[owner(w.id)] || w, lw = W[o.id + '::list'];
      if (lw && runningOn(lw)) runningGo(lw, true); else if (runningOn(o)) { chatsBack(o); runningGo(o, true); } else H.toast('·', 'The Running view is in the Chats window', 2000);
      return true;
    }
    const swa = e.target.closest('[data-chsweepall]'); if (swa) { if (!swa.disabled) sweepYesToAll(swa.dataset.chsweepall); return true; }
    const swl = e.target.closest('[data-chsweeplater]'); if (swl) { sweepLater(swl.dataset.chsweeplater); return true; }
    const afb = e.target.closest('[data-chalertfb]'); if (afb) { if (!afb.disabled) alertFeedback(afb.dataset.id, afb.dataset.chalertfb, !!afb.closest('.ch-al-i.collapsed')); return true; }
    if (window.WizAppExtensions?.handle(e)) return true;
    if (e.target.closest('[data-obretryall]')) { H.toast('↻', OUTBOX.retryFeedback(OUTBOX.retryAll(winAgent(w))), 2400); return true; }
    const eb = e.target.closest('[data-obedit]'); if (eb) { const it = OUTBOX.get(eb.dataset.obedit); if (it && !(typeof chanEditUnsent === 'function' && chanEditUnsent(id, it))) H.editUnsent(it); return true; }
    if (PW && PW.click(e, id)) return true;
    const sw = e.target.closest('[data-chswipe]');
    if (sw && swipeOpen) { const { wid: rw, sid } = swipeOpen, k = sw.dataset.chswipe; closeSwipe(true);
      if (k === 'recall') { const s = LIVE.session(sid); BOOM()?.open({ sessionId: sid, targetKind: 'thread', context: s?.title || 'This thread', note: s?.attention?.ask || '' }); }
      else threadAct(rw, sid, k); return true; }
    if (justPressed() && e.target.closest('[data-chopen], [data-chnotif], [data-chchan]')) return true; // a long-press/swipe just opened the actions sheet
    if (swipeOpen) { closeSwipe(); if (e.target.closest('.ch-list')) return true; } // a tap anywhere closes an open swipe first
    const pick = topicOn() && e.target.closest('[data-chpick]'); if (pick) { const key = pick.dataset.chpick, sid = key.startsWith('thread:') ? key.slice(7) : '', s = sid && LIVE.session(sid); openEmojiSheet(id, key, s?.title || 'Draft emoji'); return true; }
    const pn = e.target.closest('[data-chpin]'); if (pn) { const on = PIN.toggle(pn.dataset.chpin); vib(8); toast('⌖', on ? 'Pinned' : 'Unpinned', 1400); return true; }
    const nr = e.target.closest('.ch-list .ch-notif-row[data-chnotif]'); if (nr) { window.WosSkinHost?.inboxAct?.('open', nr.dataset.chnotif); return true; }
    if (typeof channelClick === 'function' && channelClick(e, id, w)) return true;
    // A link inside a channel post (issue 1287) is the link, not a tap on the post: it takes the link paths below.
    const o = e.target.closest('[data-chopen]'); if (o && !e.target.closest('.ch-post-t a[href]')) { openChat(id, o.dataset.chopen); return true; }
    if (typeof dailyClick === 'function' && dailyClick(e, id, w)) return true;
    if (e.target.closest('[data-chback]')) { threadBack(w); return true; }
    if (e.target.closest('[data-chretry]')) { const c = ch(id); clearTimeout(c.retryT); c.failN = 1; renderThreadLive(w); loadThread(w, true); return true; }
    if (e.target.closest('[data-chcarryx]')) { ch(id).carry = null; renderThreadNow(w); return true; }
    if (e.target.closest('[data-chreplyx]')) { saveDraft(id); KIT.drafts.setReply(draftKey(w), null); refreshReply(id); elOf(id)?.querySelector('.ch-compose textarea')?.focus({ preventScroll: true }); return true; }
    if (e.target.closest('[data-chnew]')) { const c = ch(id), text = (c.q || '').trim(); c.q = ''; c.focus = false; window.WizCore.chatSearch?.cancel(id); const o = owner(id); openNewDraft(o, '');
      if (text) { setDraft(o, text, []); setTimeout(() => { const ta = elOf(o)?.querySelector('.ch-compose textarea'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 60); } return true; }
    const dx = e.target.closest('[data-chdraftx]'); if (dx) { discardDraft(dx.dataset.chdraftx); renderChatList(w, elOf(id)); return true; }
    const dr = e.target.closest('[data-chdraft]'); if (dr) { openNewDraft(owner(id), dr.dataset.chdraft); return true; }
    if (e.target.closest('[data-chbsmore]')) { window.WizCore.chatSearch?.more(id); renderChatList(w, elOf(id)); return true; }
    const cx = e.target.closest('[data-chchipx]'); if (cx) { const c = ch(id); c.filter = ''; c.filterFrom = null; c.coach = false; rerenderList(w); return true; }
    const newSpace = e.target.closest('[data-chspacenew]');
    if (newSpace) { openSpacePicker(w, focusAgents()[0].id, newSpace, { naming: true }); return true; }
    const fp = e.target.closest('[data-chfocusopt]'); if (fp) {
      if (Date.now() < focusHoldUntil) return true;
      const [kind, ...parts] = fp.dataset.chfocusopt.split(':'), key = parts.join(':');
      if (fp.classList.contains('ch-focus-tab') && kind === 'agent' && focusedAgent(focusOf(w)) === key) openSpacePicker(w, key, fp);
      else setFocus(w, kind === 'agent' ? rememberedFocus(w, key) : { kind, key });
      return true;
    }
    if (e.target.closest('[data-chfbtn]')) { const c = ch(id); c.sheet = c.sheet === 'status' ? false : 'status'; c.focus = false; rerenderList(w); return true; }
    if (e.target.closest('[data-chfclear]')) { const c = ch(id); c.sheet = false; c.coach = false; clearAll(w); return true; }
    if (e.target.closest('[data-chgroupday]')) { LIVE.chatLayout = byStatus() ? 'day' : 'status'; for (const x of Object.keys(CH)) { const ww = W[x]; if (ww) renderChats(ww); } return; }
    const lay = e.target.closest('[data-chlayout]'); if (lay) { LIVE.chatLayout = lay.dataset.chlayout; for (const x of Object.keys(CH)) { const ww = W[x]; if (ww) renderChats(ww); } return; }
    if (e.target.closest('[data-chpins]')) { const on = !pinsOn(); try { localStorage.setItem(PINS_KEY, on ? '1' : '0'); } catch (err) {} paintPins(); for (const x of Object.keys(CH)) { const ww = W[x]; if (ww) renderChats(ww); } return; }
    if (e.target.closest('[data-chcompact]')) { const on = !compactOn(); try { localStorage.setItem(COMPACT_KEY, on ? '1' : '0'); } catch (err) {} LIVE.putPrefs?.({ compact: on }); for (const x of Object.keys(CH)) { const ww = W[x]; if (ww) renderChats(ww); } return; }
    const fo = e.target.closest('[data-chfopt]'); if (fo) { const c = ch(id), [k, ...r] = fo.dataset.chfopt.split(':'), key = r.join(':'); c.sheet = false; c.coach = false;
      if (k === 'status') { c.filter = c.filter === key ? '' : key; c.filterFrom = null; }
      c.lastChip = k; rerenderList(w); return true; }
    if (e.target.closest('[data-chfsheet]') && !e.target.closest('.ch-fcard')) { ch(id).sheet = false; rerenderList(w); return true; }
    const sg = e.target.closest('[data-chsug]'); if (sg) { const c = ch(id), [k, ...r] = sg.dataset.chsug.split(':'), key = r.join(':'); c.q = ''; c.focus = false; c.coach = false;
      if (k === 'status') { c.filter = key; c.filterFrom = null; } else setFocus(w, { kind: k, key }); c.lastChip = k; window.WizCore.chatSearch?.cancel(id); rerenderList(w); return true; }
    if (e.target.closest('[data-chsclear]')) { ch(id).q = ''; window.WizCore.chatSearch?.cancel(id); renderChatList(w, elOf(id)); elOf(id)?.querySelector('[data-chsearch]')?.focus(); return true; }
    if (typeof activityClick === 'function' && activityClick(e, w)) return true;
    const sec = e.target.closest('[data-sectoggle]'); if (sec) { toggleSection(w, sec.dataset.sectoggle); return true; }
    const sm = e.target.closest('[data-subjmove]');
    if (sm) { const shown = [...(sm.closest('[data-sec]') || document).querySelectorAll('[data-subjmove="up"]')].map(b => b.dataset.subjkey);
      if (!sm.disabled && moveSubject(sm.dataset.subjkey, sm.dataset.subjmove, shown)) for (const x of Object.keys(CH)) { const ww = W[x]; if (ww) renderChats(ww); } return true; }
    const wo = e.target.closest('[data-workorder]');
    if (wo) { const cur = LIVE.workingOrder?.() || 'alphabetical'; LIVE.setWorkingOrder?.(nextOrder(cur, wo.dataset.workorder, WORKING_ORDERS)); return true; }
    const rg = e.target.closest('[data-rdyorder]');
    if (rg) { readyOrder = nextOrder(readyOrder, rg.dataset.rdyorder, READY_ORDERS); try { localStorage.setItem(READY_ORDER_KEY, readyOrder); } catch (err) {} LIVE.putPrefs?.({ readyOrder }); for (const x of Object.keys(CH)) { const ww = W[x]; if (ww) renderChats(ww); } return true; }
    const more = e.target.closest('[data-secmore]'); if (more) { const c = ch(id); c.more = { ...(c.more || {}), [more.dataset.secmore]: true }; renderChatList(w, elOf(id)); return true; }
    // Android app: Camera / Photo or video / File menu (ux#1634); elsewhere the plain file dialog.
    const att = e.target.closest('[data-chattach]');
    if (att) { pickFor = id; if (window.WosContextMenu?.attach) window.WosContextMenu.attach(picker, att, { label: 'Attach pictures or files' }); else { picker.accept = ''; picker.click(); } return true; }
    const rm = e.target.closest('[data-attrm]'); if (rm) { const c = ch(id); UPLOAD_ABORT.get(rm.dataset.attrm)?.abort(); c.files = (c.files || []).filter(f => f.key !== rm.dataset.attrm); refreshCompose(id); saveDraft(id); return true; }
    const rsa = e.target.closest('[data-rsact]'); if (rsa && rowSheet) { const { wid: rw, sid, nid, grp } = rowSheet; closeRowSheet(); if (nid) void noteRowAct(nid, rsa.dataset.rsact, grp); else threadAct(rw, sid, rsa.dataset.rsact); return true; }
    if (e.target.closest('[data-chemoclear]') && rowSheet?.emoji) { const sheet = e.target.closest('.ch-emoji-sheet'), input = sheet?.querySelector('[data-chemosearch]'); if (input) { input.value = ''; renderEmojiSearch(sheet, ''); input.focus(); } return true; }
    const emoji = e.target.closest('[data-chtopicemoji]'); if (emoji && rowSheet?.emoji && String(rowSheet.key).startsWith('chanemoji:')) { const cid = rowSheet.key.slice(10); closeRowSheet(); chanSetEmoji(cid, emoji.dataset.chtopicemoji); return true; }
    if (emoji && rowSheet?.emoji) { const { key } = rowSheet; if (TOPIC.set(key, emoji.dataset.chtopicemoji)) { closeRowSheet(); for (const x of Object.keys(CH)) { const ww = W[x]; if (ww && !ww.thread) renderChats(ww); } toast(emoji.dataset.chtopicemoji, 'Topic emoji saved', 1400); } return true; }
    if (e.target.closest('[data-rsemo]') && rowSheet?.sid) { const { wid: rw, sid } = rowSheet, s = LIVE.session(sid); openEmojiSheet(rw, `thread:${sid}`, s?.title || 'Choose emoji'); return true; }
    if (e.target.closest('[data-rsspacepicker]') && rowSheet?.sid) {
      const { sid, trigger } = rowSheet; closeRowSheet();
      openSpacePicker(w, LIVE.agentOf(sid) || AGS()?.defaultId() || 'hermes', trigger, { sid }); return true;
    }
    const rsSpace = e.target.closest('[data-rsspace]');
    if (rsSpace && rowSheet?.sid) { const { sid } = rowSheet, add = rsSpace.dataset.add === 'true', name = spaces().find(x => x.id === rsSpace.dataset.rsspace)?.name || (SPACE.ch ? 'channel' : SPACE.one); const rag = typeof chanRowAgent === 'function' ? chanRowAgent(rowSheet.wid, sid) : undefined; closeRowSheet(); if (spaceMember(rsSpace.dataset.rsspace, sid, add, rag)) toast('✓', `${add ? 'Added to' : 'Removed from'} ${name}`, 2000); return true; }
    if (e.target.closest('[data-rsmarkdone]') && rowSheet?.sid) { const { wid: rw, sid } = rowSheet; closeRowSheet(); markDone(rw, sid); return true; }
    if (e.target.closest('[data-rsinbox]') && rowSheet?.sid) { const { sid } = rowSheet, r = LIVE.session(sid); closeRowSheet(); inboxMove('send', sid, { title: r?.title || '', utterance: [r?.firstRequest, r?.request].find(x => typeof x === 'string' && x.trim()) || '' }); return true; }
    if (e.target.closest('[data-rspin]') && rowSheet?.sid) { const { sid } = rowSheet, on = PIN.toggle(sid); closeRowSheet(); toast('⌖', on ? 'Pinned' : 'Unpinned', 1400); return true; }
    if (e.target.closest('[data-rsrename]') && rowSheet) { const { wid: rw, sid } = rowSheet; openRenameSheet(rw, sid); return true; }
    if (e.target.closest('[data-rncancel]') && rowSheet) { closeRowSheet(); return true; }
    if (e.target.closest('[data-chrename]') && w.thread && w.thread !== '__new__' && LIVE.session(w.thread)) { openRenameSheet(id, w.thread); return true; }
    if (e.target.closest('[data-rsopen]') && rowSheet?.nid) { const { nid } = rowSheet; closeRowSheet(); window.WosSkinHost?.inboxAct?.('open', nid); return true; }
    // The lift that ends a long-press can land on the sheet's backdrop (the row sat under it): keep the sheet open.
    if (rowSheet && e.target.closest('.ch-sheet') && !e.target.closest('.ch-sheet-b')) { if (e.detail === 0 || rowSheet.outsidePress) closeRowSheet(); return true; }
    if (e.target.closest('[data-boom-id]') && w.thread) { const el = elOf(id); void BOOM()?.handle(e.target, r => { if (!showBoomMessage(el, r.anchor_at)) toast('!', 'That message is no longer in this thread', 2200); }); return true; }
    const ngo = e.target.closest('.ch-notif-more [data-chnotif-go]'); if (ngo && w.thread) { window.WosSkinHost?.inboxAct?.('open', ngo.dataset.chnotifGo); return true; }
    const nda = e.target.closest('.ch-notif-more [data-chnotif-doneall]'); if (nda && w.thread) { void notifDoneAll(id, nda.dataset.chnotifDoneall); return true; }
    const nrm = e.target.closest('.ch-notif-route [data-notify-menu]'); if (nrm) { const m = nrm.nextElementSibling; if (m) { m.hidden = !m.hidden; nrm.setAttribute('aria-expanded', String(!m.hidden)); if (!m.hidden) m.querySelector('[aria-checked="true"], button')?.focus?.({ preventScroll: true }); } return true; }
    const nrt = e.target.closest('.ch-notif-route [data-notify-route]'); if (nrt && w.thread) { if (!nrt.disabled) notifRoute(id, nrt.dataset.notifyRoute, nrt.dataset.notifyTo); return true; }
    const ca = e.target.closest('[data-chact]'); if (ca && w.thread) { threadAct(id, w.thread, ca.dataset.chact); return true; }
    if (e.target.closest('[data-chstop]')) { const s = LIVE.session(w.thread), sb = e.target.closest('[data-chstop]'); stopTapped(sb); if (s && LIVE.cancelSend) { stopPendingSend(w, w.thread, s.runId || ''); } else if (s?.runId) { toast('■', 'Stopping…', 1400); LIVE.stop(s.runId).catch(() => { toast('!', 'Couldn’t stop · try again', 2600); renderThreadNow(w); }); } return true; }
    const apb = e.target.closest('[data-approve]'); if (apb) { chooseApproval(id, apb.dataset.approve, apb.dataset.controlKey, apb.closest('.appr')?.querySelector('[data-clarify-answer]')?.value); return true; }
    // Short answer ⇄ full reply. Only its own two buttons toggle, so links and text selection in the reply never do.
    // The choice is kept per reply (ch(id).rsum), so live repaints keep it.
    const rlb = e.target.closest('[data-reply-length]'); if (rlb) { openLengthSheet(id, rlb); return true; }
    const rln = e.target.closest('[data-rslen]'); if (rln && rowSheet?.rlen) { window.WosSkinHost?.replySummary?.set({ length: rln.dataset.rslen }); closeRowSheet(); toast('✓', 'New replies use this length', 1600); return true; }
    const rsb = e.target.closest('[data-reply-summary]');
    if (rsb) { const msg = rsb.closest('.msg.a.has-rsum'); if (!msg) return true; const open = !msg.classList.contains('rsum-open'), c = ch(id);
      (c.rsum = c.rsum || new Map()).set(rsb.dataset.replySummary, open); setSummaryOpen(msg, open);
      if (e.detail === 0) msg.querySelector(open ? '.rless' : '.bub > .rsum')?.focus({ preventScroll: true }); return true; }
    if (e.target.closest('[data-chearlier]')) { const c = ch(id), el = elOf(id); c.show = (c.show || PAGE) + PAGE; renderThread(w, el, true); return true; }
    const mdl = e.target.closest('[data-mdl]'); if (mdl) { e.preventDefault(); const m = ch(id).media?.[+mdl.dataset.mdl]; if (m) KIT.download(m); return true; }
    const mi = e.target.closest('[data-mi]'); if (mi) { e.preventDefault(); openMedia(id, +mi.dataset.mi); return true; }
    const ml = e.target.closest('a[data-mlink]'); if (ml) { e.preventDefault(); const u = ml.dataset.mlink; KIT.viewer.open([{ url: u, name: ml.textContent.trim() || 'File', kind: 'file', mime: '' }]); return true; }
    const sl = e.target.closest('a[data-session]'); if (sl) { e.preventDefault(); openChat(owner(id), sl.dataset.session, { via: 'link' }); return true; }
    // A private-origin link (a report, a hosted app) opens in a window of this shell: the shell never navigates away.
    const al = e.target.closest('.bub a[href], .ch-post-t a[href]');
    // A link to this app itself (…/wizard-os-home/?session=…, ?view=…, ?video=…) opens in place, never reloads.
    { const DL = window.WizCore.deeplink, href = al?.getAttribute('href'); let u = null; try { u = href ? new URL(href, location.href) : null; } catch (err) {}
      const d = u && DL?.isOwn(u) ? DL.parse(u.href) : null; // a thread link to this app's own page: same trail as a session link
      if (d?.session && !d.video) { e.preventDefault(); openChat(owner(id), d.session, { via: 'link' }); return true; } }
    if (al && window.WizCore.deeplink?.route(al.getAttribute('href'), al)) { e.preventDefault(); return true; }
    if (al && H.openLink) { let u = null; try { u = new URL(al.getAttribute('href'), location.href); } catch (err) {}
      if (u && (window.WosChat?.isHomeUrl ? window.WosChat.isHomeUrl(u) : u.origin === location.origin) && !u.pathname.startsWith('/wizard-os-home')) { e.preventDefault(); H.openLink(u.pathname + u.search + u.hash, (al.textContent || '').trim().slice(0, 40) || u.pathname); return true; } }
    const qc = e.target.closest('[data-quotecopy]');
    if (qc) {
      const text = qc.closest('blockquote[data-quote-source]')?.dataset.quoteSource || '';
      (KIT.copyRich || KIT.copyText)(text).then(ok => { qc.textContent = ok ? 'Copied' : 'Couldn’t copy'; setTimeout(() => { qc.textContent = 'Copy'; }, 1500); });
      return true;
    }
    const qs = e.target.closest('[data-quoteshare]');
    if (qs) {
      const text = qs.closest('blockquote[data-quote-source]')?.dataset.quoteSource || '';
      (qs.closest('.msg.u') ? KIT.shareText(text) : KIT.shareAssistantText(text)).then(r => {
        if (r === 'copied') toast('⧉', 'Copied · sharing isn’t available here', 1800);
        else if (r === 'unsupported' || r === 'failed') toast('!', 'Couldn’t share', 1800);
      }).catch(() => toast('!', 'Couldn’t share', 1800));
      return true;
    }
    const cc = e.target.closest('[data-codecopy]'); if (cc) { const t = cc.closest('.code')?.querySelector('pre')?.textContent || ''; KIT.copyText(t).then(ok => { cc.textContent = ok ? 'Copied' : 'Couldn’t copy'; setTimeout(() => { cc.textContent = 'Copy'; }, 1500); }); return true; }
    const cs = e.target.closest('[data-codeshare]'); if (cs) { const t = cs.closest('.code')?.querySelector('pre')?.textContent || ''; (cs.closest('.msg.u') ? KIT.shareText(t) : KIT.shareAssistantText(t)).then(r => r === 'copied' && toast('⧉', 'Copied · sharing isn’t available here', 1800)); return true; }
    const mc = e.target.closest('[data-mcopy]'); if (mc) { const t = ch(id).texts?.[+mc.dataset.mcopy] ?? ''; (KIT.copyRich || KIT.copyText)(t).then(ok => toast(ok ? '⧉' : '!', ok ? 'Copied' : 'Couldn’t copy', 1400)); return true; }
    const ms = e.target.closest('[data-mshare]'); if (ms) { const t = ch(id).texts?.[+ms.dataset.mshare] ?? ''; KIT.shareAssistantText(t).then(r => r === 'copied' ? toast('⧉', 'Copied · sharing isn’t available here', 1800) : r === 'failed' && toast('!', 'Couldn’t share', 1800)); return true; }
    const v = e.target.closest('.vnote[data-vnote]'); if (v) { e.preventDefault(); toggleVoice(v.dataset.vnote); return true; }
    return false;
  }
  /* Submit, search-as-you-type, drafts and ⌘/Ctrl+Enter, delegated from the shell's root. */
  function bind(root) {
    // A new press on the backdrop is Back immediately, even just after a hold.
    // The opening press began on the row, so its retargeted release is not a new backdrop press.
    root.addEventListener('pointerdown', e => { if (rowSheet) rowSheet.outsidePress = e.isTrusted && e.target.classList?.contains('ch-sheet'); }, true);
    root.addEventListener('pointercancel', () => { if (rowSheet) rowSheet.outsidePress = false; }, true);
    root.addEventListener('submit', e => {
      if (e.target.matches('[data-incog-form]')) { e.preventDefault(); const id = idOf(e.target), field = e.target.querySelector('textarea'), text = field.value; field.value = ''; void INC?.send(id, text); return; }
      const rn = e.target.closest('[data-rnform]'); if (rn) { e.preventDefault(); submitRename(rn); return; }
      const crn = e.target.closest('[data-chrnform]'); if (crn) { e.preventDefault(); submitChannelRename(crn); return; }
      const cf = e.target.closest('[data-chchanform]'); if (cf) { e.preventDefault(); void channelSend(idOf(cf), cf); return; }
      const f = e.target.closest('[data-chform]'); if (!f) return;
      e.preventDefault(); const id = idOf(f); const ta = f.querySelector('textarea');
      const text = ta.value; const c = ch(id);
      // A voice take into this thread is recording: Send finishes it, and the words and files here go with it.
      const into = H.voiceInto?.(); if (into && into === H.win(id)?.thread && H.finishVoice) { H.finishVoice(); return; }
      if (!text.trim() && !(c.files || []).some(f => f.id || f.uploading)) return;
      ta.value = ''; syncSend(f, c); sendChat(id, text);
    });
    root.addEventListener('focusin', e => {
      if (!e.target.matches('[data-chsearch]')) return;
      const id = idOf(e.target), c = ch(id); if (c.focus) return; c.focus = true; c.sheet = false; const el = elOf(id);
      if (el?.querySelector('.ch-scroll')) { renderChatList(H.win(id), el); const inp = el.querySelector('[data-chsearch]'); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    });
    root.addEventListener('focusout', e => {
      if (!e.target.matches('[data-chsearch]')) return;
      const id = idOf(e.target), c = ch(id);
      // A tap on a suggestion blurs the field first: let the tap land, then hide the empty-field suggestions.
      setTimeout(() => { const el = elOf(id), inp = el?.querySelector('[data-chsearch]'); if (!c.focus || (inp && document.activeElement === inp)) return; c.focus = false; if (!c.q && el?.querySelector('.ch-sug')) renderChatList(H.win(id), el); }, 260);
    });
    root.addEventListener('input', e => {
      if (e.target.matches('[data-incog-field]')) { INC?.input(idOf(e.target), e.target); return; }
      if (e.target.matches('[data-chemosearch]')) renderEmojiSearch(e.target.closest('.ch-emoji-sheet'), e.target.value);
      if (e.target.matches('[data-chsearch]')) {
        const id = idOf(e.target); ch(id).q = e.target.value; ch(id).coach = false; const el = elOf(id);
        if (el?.querySelector('.ch-scroll')) { renderChatList(H.win(id), el); const inp = el.querySelector('[data-chsearch]'); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
      }
      if (e.target.matches('[data-clarify-answer]')) { const c = ch(idOf(e.target)); if (c.approval?.kind === 'clarify') c.approval.answer = e.target.value; }
      if (e.target.matches('.ch-compose textarea')) { growTa(e.target); const id = idOf(e.target); typedInto(id, e.target); syncSend(e.target.form, ch(id)); }
    });
    root.addEventListener('change', e => {
      if (e.target.matches('[data-archafter]')) { LIVE.archiveAfterDays = +e.target.value; for (const x of Object.keys(CH)) { const ww = W[x]; if (ww) renderChats(ww); } }
      if (e.target.matches('[data-chactorder]') && typeof actSetOrder === 'function') actSetOrder(e.target.value);
    });
    root.addEventListener('keydown', e => {
      if (e.target.matches('[data-chemosearch]')) { e.stopPropagation(); if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.target.value = ''; renderEmojiSearch(e.target.closest('.ch-emoji-sheet'), ''); } return; }
      if (rowSheet && e.key === 'Escape') { e.preventDefault(); closeRowSheet(); return; }
      if (e.key === 'Escape' && globalThis.WosThreadTracker?.isOpen()) { e.preventDefault(); globalThis.WosThreadTracker.close(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[data-tt-row], [data-ttjump]') && !e.target.closest('button')) { e.preventDefault(); e.target.click(); return; }
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        const row = e.target.closest(ROW_MENU);
        if (row) { e.preventDefault(); rowMenu(idOf(row), row); return; }
      }
      // Enter / Shift+Enter / Ctrl+Enter in the composer: WizComposerInput (bound with the paste and drop handlers).
    });
    bindGestures(root); bindPull(root);
    PW?.bind(root);
  }
  /* Words from outside (dictation, a native shell) go in at the composer's cursor. */
  function insertText(id, text) {
    const ta = elOf(id)?.querySelector('.ch-compose textarea'); if (!ta || !text) return false;
    if (INC?.active(id)) { window.WizComposerInput.insertText(ta, text); INC.input(id, ta); return true; }
    const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b); ta.focus();
    ta.setSelectionRange(a + text.length, a + text.length); typedInto(id, ta); growTa(ta); syncSend(ta.form, ch(id));
    return true;
  }
  const forget = id => { INC?.close(id, true); const c = CH[id]; if (c) { closeStream(c); for (const t of [c.retryT, c.sentTimer, c.ptrT, listSaveT[id]]) clearTimeout(t); delete listSaveT[id]; } closeHosted(id); clearReading(id); delete CH[id]; };
  function justPressed() { return lpHeld !== null || Date.now() < lpUntil; }
  // A list must not re-render under an open actions sheet or a finger mid-press.
  const holdList = id => {
    if (paintForced) return false;
    const el = elOf(id), hold = rowSheet?.wid === id || (!!lp && lp.wid === id) || (!!swipeOpen && swipeOpen.wid === id && swipeOpen.wrap.isConnected) || !!PW?.holds(id) || (!!el && readingIn(el));
    if (hold) ch(id).heldList = true;
    return hold;
  };
  // Back / Esc: the media viewer, then the actions sheet. Returns what it closed, or ''.
  function closeFilterSheet() { for (const id of Object.keys(CH)) { const c = CH[id]; if (c.sheet) { c.sheet = false; const w = H.win(id); if (w) rerenderList(w); return true; } } return false; }
  const closeOverlay = () => (closeSwipe() ? 'row-swipe' : null) || (closeSpacePicker() ? 'space-picker' : null) || (closeFilterSheet() ? 'filter-sheet' : null) || (window.WizCore.status?.back() || (KIT.viewer.close() ? 'viewer' : closeRowSheet() ? 'thread-actions' : PW?.closeSheet() ? 'chat-sheet' : ''));
  function registerBack(stack, after) {
    // Each activity has its own recency, not one fixed-priority closeOverlay bucket.
    const owners = [
      ['row-swipe', () => swipeOpen, closeSwipe],
      ['space-picker', () => spacePicker, closeSpacePicker],
      ['filter-sheet', () => Object.values(CH).find(c => c.sheet), closeFilterSheet],
      ['thread-actions', () => rowSheet, closeRowSheet],
      ['chat-sheet', () => PW?.sheetOpen(), () => PW.closeSheet()],
    ];
    return owners.map(([name, active, back]) => stack.watch(active, () => { back(); after?.(); }, name));
  }
  // Put words (and already-uploaded files) back into a composer, e.g. editing an unsent message.
  function setDraft(wid, text, files) {
    if (INC?.active(wid)) { toast('!', 'Close Incognito before opening a saved draft', 2200); return; }
    const w = W[wid], c = ch(wid); if (!w) return;
    c.draft = text || ''; c.files = (files || []).map(f => ({ ...f, key: Math.random().toString(36).slice(2), preview: /^image\//.test(f.mime || '') && f.id ? (PREVIEW[f.id] || fileUrl(f.id)) : '' }));
    c.draftFor = draftKey(w); saveDraft(wid);
    const el = elOf(wid); if (el) delete el.dataset.draftFor;
  }
  // Models, Errors actions, composer mic, work receipts, reading position, Files (core/chat-power.js).
  const PW = window.WosChatPower ? window.WosChatPower({ CH, ch, toast, H, md, KIT, MIC_SVG, WORKING_ST, isWorking, scrollBox, threadOnScreen, threadViewportTop, elOf, owner, vib, renderChats, renderThreadNow, renderThreadLive, openChat, refreshCompose, saveDraft, closeRowSheet, leaveAfterSend, takeComposer, continueInAgent, winAgent, chanOpen, paintJump, chanSpaceOf, spaceMember, chanOwnPost, chanBox: wid => (W[wid] && chanDraftKey(W[wid])) || '', chanModel: wid => chanModel(W[wid]), setChanModel }) : null;
  chanboxLate({ PW });
  sendLate({ PW });
  doneLate({ PW });
  attachLate({ PW });
  trackerLate({ PW });
  restoreSealed();
  // Chats lists show new chats still in the outbox (Sending): repaint open lists when that set changes.
  let outSig = '';
  addEventListener('wizreachchange', () => {
    for (const id of Object.keys(CH)) { const w = H.win(id), el = elOf(id); if (!w || !el) continue; if (w.thread) renderThreadLive(w); else if (!holdList(id)) renderChatList(w, el); }
  });
  OUTBOX?.onChange(() => {
    restoreSealed();
    for (const it of OUTBOX._items.values()) if (it.durable && it.sealKey) KIT.drafts.clear(it.sealKey);
    const sig = OUTBOX.unsent().filter(it => it.kind === 'new' || it.kind === 'reply').map(it => it.id + ':' + it.state + ':' + (it.error || '')).join(',');
    if (sig === outSig) return; outSig = sig;
    for (const id of Object.keys(CH)) { const w = H.win(id), el = elOf(id); if (w && w.app === 'chats' && !w.thread && el && !holdList(id)) renderChatList(w, el); }
  });
  const tweakModel = (wid, choice, alive) => PW?.tweakModel(wid, choice, alive);
  return { beforeNavigate: ids => INC?.beforeNavigate(ids) ?? true, beforeLeave: (id, checkOnly = false) => !INC?.active(id) || INC.close(id, false, checkOnly), incognitoActive: id => !!INC?.active(id), tweakModels: wid => PW?.tweakModels(wid), tweakModel, openHosted, prepThread, closeHosted, isHosted, CH, ch, click, bind, PW, listTitle, modelRoute: (wid, sid, box) => { const nm = sid !== '__new__' ? null : box ? boxModel(box) : chanDraftKey(W[wid]) ? chanModel(W[wid]) : PW?.newModel(ch(wid)); return window.WosModels.snapshot(sid === '__new__' ? '' : sid || '', nm, sid === '__new__' ? (winAgent(W[wid]) || nm?.agent || '') : ''); }, winAgent, agentRec, leaveAfterSend, takeComposer, composerBusy, joinWords, sendVoiceTo: (...a) => { if (INC?.active(a[0])) { toast('!', 'Incognito is text only', 2200); return null; } return PW?.sendVoiceTo(...a); }, insertText, lookupScope, forget, renderChats, renderChatList, renderThread, loadThread, openChat, chatsBack, threadBack, setFilter, clearFilter, readyBack, channelBack, chanOpen, channelOf, activityNeeds: actNeeds, activityUnread: actUnread, activityMark: actMark, activityDraft: s => channelsOn() && rowDraft(s), agentLabelOf, moveToChannel, chanSpaceOf, chanCompose, chanView: () => channelsOn() ? chanView : '', chanBox: wid => (W[wid] && chanDraftKey(W[wid])) || '', chanModel: wid => chanModel(W[wid]), boxModel, setChanModel, setFocus, focusOf, focusMatches, focusRows, focusAgentId, addFilter, hasFilter, clearAll, setQuery, matchFilters, subjects, closeFilterSheet, sendChat, uploadFile,
    refreshCompose, toggleVoice, growTa, markVisibleThreadsSeen, addFiles, toTurns, md, MIC_SVG, CLIP_SVG, WORKING_ST, isWorking,
    registerBack, KIT, threadAct, threadActions, stiKind, notifOpen: wid => notifOf(W[owner(wid)])?.id || '', openRowSheet, openRenameSheet, closeRowSheet, closeOverlay, holdList, justPressed, setDraft, saveDraft, openNewDraft, openContextDraft, newDrafts, canMarkDone, markDone };
};
