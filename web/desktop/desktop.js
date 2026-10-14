/* Wizard UX desktop shell.
 *
 * Omarchy's paradigm, made for Wizard: numbered workspaces along the top bar, windows that tile
 * themselves (one fills the workspace, two split side by side, more stack on the right), and a
 * keyboard for everything. No orb, no swipes. Voice is a key: tap Right ⌘ to talk to Archimedes, tap Right ⌥ to dictate.
 *
 * Shared with the phone (web/core/*, live.js, outbox.js): the app registry, the Chats client,
 * Wizard's live data and read state, the durable outbox, voice capture and the native bridge.
 *
 * Keys use ⌥ (Option/Alt) as the window-manager modifier, so they never fight the browser's ⌘ keys:
 *   ⌘K / ⌥Space   search and launch           ⌥1…⌥9      go to workspace
 *   ⌥Enter        new chat                    ⇧⌥1…9      send window to workspace
 *   Right ⌘ tap   talk (tap again to send)    ⌥←↑→↓/HJKL focus window
 *   Right ⌥ tap   dictate (tap again: insert at the cursor, else copy)
 *   ⌥I            inbox                       ⇧⌥←→       swap window
 *   ⌘W / ⌥W       close app                   ⌥F         full screen
 *   ⌥/            all keys                    ⌥[ ⌥]      previous / next workspace
 *   Esc           close the top layer (never leaves the app)
 */
(() => {
  'use strict';
  if (document.documentElement.dataset.leaving) return; // core/shell.js is switching to the other shell
  const C = window.WizCore;
  const { esc, clip, norm, ago, emoOf } = C;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const LIVE = window.WizLive;
  const OUTBOX = window.WosOutbox || null;
  const { APPS, APP, findApp, searchApps, quickSearch, searchUrl } = C.apps('desktop');
  const store = C.store('wux.desk.');
  const freshDesk = () => ({ id: 'd' + uid(), wins: [], focus: null, mono: false });
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const MOD = IS_MAC ? '⌥' : 'Alt+';
  const CMD = IS_MAC ? '⌘' : 'Ctrl+';

  /* ---------------- state ----------------
   * W: windows by id ({ id, app: 'chats'|'frame', appId, thread, url })
   * ws: workspaces [{ wins: [ids in tiling order], focus, mono }] */
  let W = store.get('wins', null), ws = store.get('ws', null), cur = store.get('cur', 0);
  if (!W || typeof W !== 'object' || Array.isArray(W) || !Array.isArray(ws) || !ws.length) {
    W = {}; ws = [freshDesk()];
    // First run: Chats on 1, so Wizard opens on the thing you use most.
    const id = uid(); W[id] = { id, app: 'chats', thread: null }; ws[0].wins.push(id); ws[0].focus = id;
  }
  const placed = new Set(), deskIds = new Set();
  ws = ws.map(d => {
    d = d && typeof d === 'object' ? d : freshDesk();
    if (typeof d.id !== 'string' || !/^dw[a-z0-9]+$/.test(d.id) || deskIds.has(d.id)) d.id = freshDesk().id;
    deskIds.add(d.id);
    d.wins = (Array.isArray(d.wins) ? d.wins : []).filter(id => W[id] && !placed.has(id) && placed.add(id));
    if (!d.wins.includes(d.focus)) d.focus = d.wins[0] || null;
    d.mono = !!d.mono && d.wins.length > 0; return d;
  });
  if (!Number.isInteger(cur) || cur < 0 || cur >= ws.length) cur = 0;
  // Migrate fixed workspaces once: retain every populated desktop and the active desktop.
  // Empty desktops deliberately created after this migration persist across reloads.
  if (store.get('layoutVersion', 0) < 2) {
    const active = ws[cur]; ws = ws.filter(d => d.wins.length || d === active); cur = ws.indexOf(active);
  }
  store.set('layoutVersion', 2);
  Object.keys(W).forEach(id => { if (!ws.some(d => d.wins.includes(id))) delete W[id]; });
  if (!(cur >= 0 && cur < ws.length)) cur = 0;
  function uid() { return 'w' + Math.random().toString(36).slice(2, 9); }
  const save = () => { store.set('wins', W); store.set('ws', ws); store.set('cur', cur); };
  const wsOf = id => ws.findIndex(d => d.wins.includes(id));
  let homeOpen = store.get('homeOpen', false) === true;
  const focused = () => homeOpen ? null : W[ws[cur].focus] || null;
  save(); // Persist normalization before the layout-version marker can affect another boot.

  /* ---------------- chats (shared core) ---------------- */
  const stage = $('#stage');
  const CHATS = C.chats({
    win: id => W[id] || (/::list$/.test(id) && W[id.slice(0, -6)] ? listWin(id.slice(0, -6)) : undefined),
    root: () => stage,
    save,
    layout: id => { syncChatsPane(id); },
    toast: (...a) => toast(...a),
    title: w => winTitle(w),
    viewContext: (id, how) => viewContext(id, how),
    visible: () => homeOpen ? [] : ws[cur].wins,
    editUnsent: it => editUnsent(it),
    newChatHint: `Type below and press ${CMD}Enter, or press ${MOD}⇧V for a new voice chat.`,
    owner: id => String(id).replace(/::list$/, ''),
    // The composer's mic (#13): the same recorder as Right ⌘, pinned to this thread.
    recordReply: (wid, sid) => recordReply(wid, sid),
    recordingFor: () => (vReply && VOICE.state === 'listen' ? vReply.sid : ''),
    // The thread a recording take will go into (its composer rides along); Send in that composer finishes the take.
    voiceInto: () => (VOICE.state === 'listen' && vMode === 'talk' ? (vReply?.sid || (vTarget && W[vTarget]?.thread) || '') : ''),
    finishVoice: () => talk('send'),
    // A private-origin link in a message opens as a window on this workspace; the shell never navigates away.
    openLink: (url, title) => !!newWin({ app: 'frame', appId: 'link', url, title }),
    changed: () => { for (const id of Object.keys(W)) if (W[id].app === 'chats') syncChatsPane(id); },
  });

  /* ---------------- windows ---------------- */
  // App icons are sigils (core/sigils.js): one silhouette, one bite, one colour per app.
  const ico = (tag, cls, a, extra) => window.WizSigil ? window.WizSigil.box(tag, cls, a, extra) : `<${tag} class="${cls}" style="--g1:${a.g?.[0]};--g2:${a.g?.[1]}">${a.icon || '◇'}${extra || ''}</${tag}>`;
  function appOf(w) {
    if (!w) return null;
    if (w.app === 'chats') return APP.wizard;
    return APP[w.appId] || { name: w.title || w.url || 'App', icon: '◇', g: ['#444a60', '#22263a'], url: w.url };
  }
  function winTitle(w) {
    if (!w) return '';
    if (w.app === 'chats') {
      if (w.thread === '__new__') return 'New chat';
      if (w.thread) return LIVE?.session(w.thread)?.title || OUTBOX?.forThread(w.thread)[0]?.title || 'Thread';
      return 'Chats';
    }
    return appOf(w).name;
  }
  function viewContext(id, how = 'typing') {
    const w = homeOpen && !id ? null : W[id || ws[cur].focus], others = homeOpen ? [] : ws[cur].wins.filter(x => x !== w?.id).map(x => winTitle(W[x]));
    const a = appOf(w);
    return [
      `[Wizard OS context] ${window.WizConfig.owner() || 'The user'} sent this by ${how} from Wizard UX on their desktop (workspace ${cur + 1}).`,
      w ? `Window in front: ${winTitle(w)}${a?.url ? ` (${a.url})` : ''}.` : homeOpen ? 'Home screen in front.' : 'No window was open.',
      (s => s ? `Visible on screen: ${s}` : '')(w && w.app !== 'chats' ? (window.WizScreen?.read(winEl(w.id)) || '') : ''),
      others.length ? `Also open on this workspace: ${others.join(', ')}.` : '',
      'When they say "this", "here", or "it", they likely mean that window. Use this as background only.',
    ].filter(Boolean).join(' ');
  }

  function newWin(obj, opts = {}) {
    leaveHome();
    const t = Number.isInteger(opts.ws) && ws[opts.ws] ? opts.ws : cur;
    const id = uid(); W[id] = { id, ...obj };
    const d = ws[t];
    // New windows go next to the focused one, like a tiling WM.
    const at = d.focus ? d.wins.indexOf(d.focus) + 1 : d.wins.length;
    d.wins.splice(at, 0, id); d.focus = id; d.mono = false;
    save();
    if (t !== cur) goWs(t); else render();
    return W[id];
  }
  function closeWin(id) {
    const t = wsOf(id); if (t < 0) return;
    const d = ws[t], i = d.wins.indexOf(id);
    CHATS.saveDraft(id);
    d.wins.splice(i, 1); delete W[id]; CHATS.forget(id);
    if (d.focus === id) d.focus = d.wins[Math.min(i, d.wins.length - 1)] || null;
    if (d.wins.length < 2) d.mono = false;
    save(); render();
  }
  function focusWin(id, { scroll = true } = {}) {
    const t = wsOf(id); if (t < 0) return;
    const fromHome = homeOpen;
    leaveHome();
    if (t !== cur) goWs(t);
    // goWs may prune an empty desktop and reindex the destination; use its new
    // current index, not the pre-navigation index of this stable window ID.
    if (!fromHome && ws[cur].focus === id && document.querySelector(`.win[data-win="${id}"].focus`)) return;
    ws[cur].focus = id; save(); paintFocus();
    if (scroll) focusInside(id);
    CHATS.markVisibleThreadsSeen();
  }
  function focusInside(id) {
    if (homeOpen) return;
    const el = winEl(id); if (!el) return;
    const w = W[id];
    if (w.app === 'chats') {
      const ta = el.querySelector('.pane-main textarea');
      if (w.thread && ta) { ta.focus({ preventScroll: true }); return; }
      const s = el.querySelector('[data-chsearch]'); if (s && !w.thread) return; // don't steal focus into search
    }
    el.focus({ preventScroll: true });
  }
  function moveWin(id, t) {
    const from = wsOf(id); if (from < 0 || t === from || t < 0 || t >= ws.length) return;
    const d = ws[from]; d.wins = d.wins.filter(x => x !== id); if (d.focus === id) d.focus = d.wins[0] || null; if (d.wins.length < 2) d.mono = false;
    ws[t].wins.push(id); ws[t].focus = id;
    save(); render(); toast('→', `Moved to ${t + 1}`, 1000);
  }
  function swapWin(dir) {
    const d = ws[cur], i = d.wins.indexOf(d.focus), j = i + dir;
    if (i < 0 || j < 0 || j >= d.wins.length) return;
    [d.wins[i], d.wins[j]] = [d.wins[j], d.wins[i]]; save(); layout();
  }
  function toggleMono() {
    if (homeOpen) return; // Home must not alter a parked desktop's fullscreen preference.
    const d = ws[cur]; if (!d.wins.length) return;
    d.mono = !d.mono; save(); layout();
    if (d.mono && !store.get('fullHint', false)) {
      store.set('fullHint', true); toast('⤢', `${MOD}F, Esc or Back leaves full screen`, 2200);
    }
  }

  /* Open an app the desktop way: Chats and apps already open get focused, not duplicated. */
  // Hosted Wizard apps (App Store, System) ask the shell to open another installed app in its own window.
  const hostedOpenable = id => { const a = APP[id]; if (!a?.url || a.kind !== 'wizard') return null; try { if (new URL(a.url, location.origin).origin !== location.origin) return null; } catch (e) { return null; } return a; };
  window.WizCanOpen = id => !!hostedOpenable(id);
  // Only the App Store and System windows may ask; the sender is checked by its actual frame, not by anything it says.
  addEventListener('message', e => {
    const d = e.data; if (e.origin !== location.origin || !d || d.type !== 'wizard:open-app' || typeof d.id !== 'string') return;
    const host = [...document.querySelectorAll('iframe')].find(f => f.contentWindow === e.source)?.closest('[data-win]');
    const w = host && W[host.dataset.win]; if (!w || !['app-store', 'system'].includes(w.appId)) return;
    const a = hostedOpenable(d.id); if (a) openApp(a);
  });
  function openApp(a, opts = {}) {
    if (!a) return false;
    if (a.kind === 'view' && a.view === 'inbox') { openInbox(); return true; }
    if (a.kind === 'chats') {
      const ex = !opts.fresh && findWin(w => w.app === 'chats');
      if (ex) { focusWin(ex.id); return true; }
      newWin({ app: 'chats', thread: null }, opts); return true;
    }
    if (a.url) {
      const ex = !opts.fresh && findWin(w => w.app === 'frame' && w.appId === a.id);
      if (ex) { focusWin(ex.id); return true; }
      newWin({ app: 'frame', appId: a.id }, opts); return true;
    }
    if (a.href) { window.open(a.href, '_blank', 'noopener'); return true; }
    return false;
  }
  // Prefer this workspace, then any.
  function findWin(fn) {
    const here = ws[cur].wins.map(id => W[id]).find(fn); if (here) return here;
    return Object.values(W).find(fn) || null;
  }
  function openThread(sid, opts = {}) {
    if (!sid) return;
    let w = !opts.fresh && (ws[cur].wins.map(id => W[id]).find(x => x.app === 'chats') || findWin(x => x.app === 'chats'));
    if (!w) w = newWin({ app: 'chats', thread: null }, opts);
    focusWin(w.id); CHATS.openChat(w.id, sid);
    setTimeout(() => focusInside(w.id), 30);
  }
  function newChat(opts = {}) {
    let w = !opts.fresh && (ws[cur].wins.map(id => W[id]).find(x => x.app === 'chats'));
    if (!w) w = newWin({ app: 'chats', thread: null }, opts);
    focusWin(w.id); CHATS.openNewDraft(w.id, '');
    syncChatsPane(w.id); setTimeout(() => focusInside(w.id), 30);
    return w;
  }
  function editUnsent(it) {
    const known = it.kind === 'reply' || (LIVE && LIVE.session(it.sessionId));
    const w = known ? (openThread(it.sessionId), focused()) : newChat();
    if (!w) return;
    CHATS.setDraft(w.id, it.text || it.typed || '', (it.files || []).filter(f => f !== it.audioFile));
    OUTBOX.remove(it.id); CHATS.renderChats(w); syncChatsPane(w.id);
  }

  /* ---------------- rendering ---------------- */
  const winEl = id => stage.querySelector(`.win[data-win="${id}"]`);
  function wsEl(i) {
    const d = ws[i]; if (!d) return null;
    let el = stage.querySelector(`.wsp[data-desk="${d.id}"]`);
    if (!el) { el = document.createElement('div'); el.className = 'wsp'; el.dataset.desk = d.id; stage.appendChild(el); }
    el.dataset.ws = i; return el;
  }
  function winHtml(w) {
    const a = appOf(w);
    return `<div class="wbar" data-drag>${ico('span', 'ic', a)}<span class="t">${esc(winTitle(w))}</span>
      ${a.url ? `<button data-wact="pop" title="Open in a browser tab" aria-label="Open in a browser tab">↗</button>` : ''}
      <button data-wact="mono" title="Full screen (${CMD}F / ${MOD}F)" aria-label="Full screen">⤢</button>
      <button data-wact="close" title="Close app (⌘W / ${MOD}W)" aria-label="Close window">✕</button></div>
      <div class="wbody">${bodyHtml(w)}</div>`;
  }
  function bodyHtml(w) {
    if (w.app === 'chats') return `<div class="dchats" data-thread="${esc(w.thread || '')}" style="--list-w:${listW()}px"><div class="pane-list"><div class="chats" data-chats="${w.id}::list"></div></div>
      <div class="pane-split" data-split role="separator" aria-orientation="vertical" aria-label="Resize the thread list" tabindex="0" title="Drag to resize · double-click to reset"></div>
      <div class="pane-main"><div class="chats" data-chats="${w.id}"></div><div class="pane-empty"><div><b>Your conversations, side by side.</b><br>Choose a chat on the left, or start one.<br><button type="button" class="pane-newchat" data-panenew>Start a new chat</button><br><kbd>↑</kbd><kbd>↓</kbd> move through chats · <kbd>/</kbd> search · <kbd>${MOD}Enter</kbd> new chat · <kbd>${CMD}K</kbd> launch · <kbd>${MOD}⇧V</kbd> new voice chat</div></div></div></div>`;
    const a = appOf(w), url = w.url || a.url || '/';
    return `<iframe src="${esc(url)}" title="${esc(a.name)}" allow="microphone; clipboard-read; clipboard-write; autoplay; fullscreen"></iframe>
      <div class="frame-fallback"><div><b>${esc(a.name)} can’t show in a window</b><a href="${esc(url)}" target="_blank" rel="noopener">Open it in a tab ↗</a></div></div>`;
  }
  /* Chats on the desktop: list on the left, thread on the right, both from the shared Chats client.
   * The list pane is a second Chats "window" (id::list) that always shows the list. */
  const listWins = {};
  function listWin(id) { return listWins[id] || (listWins[id] = { id: id + '::list', get thread() { return null; }, set thread(v) { if (v) { const w = W[id]; if (w) { w.thread = v; save(); CHATS.renderChats(w); syncChatsPane(id); } } } }); }
  function syncChatsPane(id) {
    const base = String(id).replace(/::list$/, ''); const w = W[base]; if (!w || w.app !== 'chats') return;
    const el = winEl(base); if (!el) return;
    const box = el.querySelector('.dchats'); if (box) box.dataset.thread = w.thread || '';
    $$('.ch-row', el).forEach(r => r.classList.toggle('cur', r.dataset.chopen === w.thread));
    const t = el.querySelector('.wbar .t'); if (t) t.textContent = winTitle(w);
    el.setAttribute('aria-label', winTitle(w));
    if (focused()?.id === base) document.title = `${winTitle(w)} · Wizard`;
  }
  /* ---- the list/thread divider: drag, arrow keys, double-click to reset; one width for every Chats window ---- */
  const LIST_W = [220, 640, 340];
  function listW() { const v = +store.get('listW', LIST_W[2]); return v >= LIST_W[0] && v <= LIST_W[1] ? v : LIST_W[2]; }
  function setListW(px) { px = Math.round(Math.max(LIST_W[0], Math.min(LIST_W[1], px))); store.set('listW', px); $$('.dchats', stage).forEach(b => b.style.setProperty('--list-w', px + 'px')); return px; }
  let split = null;
  stage.addEventListener('pointerdown', e => {
    const s = e.target.closest('[data-split]'); if (!s || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const box = s.closest('.dchats'); split = { box, left: box.getBoundingClientRect().left };
    s.setPointerCapture?.(e.pointerId); document.documentElement.classList.add('splitting');
  });
  addEventListener('pointermove', e => { if (split) setListW(e.clientX - split.left); });
  addEventListener('pointerup', () => { if (!split) return; split = null; document.documentElement.classList.remove('splitting'); });
  stage.addEventListener('dblclick', e => { if (e.target.closest('[data-split]')) { e.stopPropagation(); setListW(LIST_W[2]); } }, true);
  stage.addEventListener('keydown', e => {
    if (!e.target.matches?.('[data-split]')) return;
    const d = { ArrowLeft: -24, ArrowRight: 24 }[e.key]; if (!d) return;
    e.preventDefault(); e.stopPropagation(); setListW(listW() + d);
  });
  /* ---- keyboard through the thread list: ↑/↓ (or j/k) open the previous/next chat, / searches ---- */
  function listRows(id) { return $$('.pane-list .ch-row[data-chopen], .pane-list .ch-row[data-chdraft]', winEl(id) || document.createElement('div')); }
  function stepThread(id, dir) {
    const w = W[id]; if (!w || w.app !== 'chats') return false;
    const rows = listRows(id); if (!rows.length) return false;
    let i = rows.findIndex(r => r.classList.contains('kbd'));
    if (i < 0) i = rows.findIndex(r => r.dataset.chopen && r.dataset.chopen === w.thread);
    const j = i < 0 ? (dir > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, i + dir));
    const r = rows[j]; if (!r) return false;
    if (r.dataset.chopen) CHATS.openChat(id, r.dataset.chopen); else CHATS.openNewDraft(id, r.dataset.chdraft);
    syncChatsPane(id);
    const again = listRows(id)[j]; if (again) { $$('.pane-list .ch-row.kbd', winEl(id)).forEach(x => x.classList.remove('kbd')); again.classList.add('kbd'); again.focus({ preventScroll: true }); again.scrollIntoView({ block: 'nearest' }); }
    log('list:' + (r.dataset.chopen || r.dataset.chdraft));
    return true;
  }
  function mountWin(w, host) {
    const el = document.createElement('section');
    el.className = 'win'; el.dataset.win = w.id; el.tabIndex = -1; el.setAttribute('aria-label', winTitle(w));
    el.innerHTML = winHtml(w); host.appendChild(el);
    if (w.app === 'chats') {
      CHATS.renderChatList(listWin(w.id), el.querySelector(`[data-chats="${w.id}::list"]`));
      if (w.thread) CHATS.renderChats(w);
      syncChatsPane(w.id);
    } else watchFrame(el.querySelector('iframe'), el);
    return el;
  }
  function watchFrame(f, el) {
    if (!f) return;
    const w = W[el.dataset.win], a = w && APP[w.appId];
    if (a?.url) f._appDetach = window.WizAppServices?.attach(f, { appId: a.id, path: a.url });
    f.addEventListener('load', () => {
      // A refused frame (CSP frame-ancestors / X-Frame-Options) lands on an unreadable error document.
      let bad = false;
      try { const d = f.contentDocument; bad = !d || /^chrome-error:|^about:blank/.test(d.URL || '') && f.getAttribute('src') !== 'about:blank'; } catch (e) { bad = true; }
      el.querySelector('.frame-fallback')?.classList.toggle('on', bad);
      // Clicking inside a same-origin app focuses its window; Esc inside it still reaches the shell.
      try {
        const doc = f.contentDocument; if (!doc || doc.__wuxHooked) return; doc.__wuxHooked = true;
        doc.addEventListener('pointerdown', () => focusWin(el.dataset.win, { scroll: false }), true);
        doc.addEventListener('keydown', e => onKey(e, true), true);
        try { const w0 = W[el.dataset.win]; if (LINKS && window.WizLinks?.guardFrame) window.WizLinks.guardFrame(f.contentWindow, (w0 && ((APP[w0.appId] || {}).url || w0.url)) || f.contentWindow.location.pathname, LINKS); } catch (e) {}
      } catch (e) {}
    });
  }
  function render() {
    // Stable desktop IDs preserve hosted apps, composers and scroll when desktop indices shift.
    $$('.win', stage).forEach(el => { if (!W[el.dataset.win]) { el.querySelector('iframe')?._appDetach?.(); el.remove(); } });
    for (let i = 0; i < ws.length; i++) {
      const host = wsEl(i), d = ws[i];
      // Keep live windows (iframes keep their state); add new ones, drop closed ones.
      // Move surviving DOM nodes between hosts rather than remounting an iframe or draft.
      for (const id of d.wins) { const ex = stage.querySelector(`.win[data-win="${id}"]`); if (!ex) mountWin(W[id], host); else if (ex.parentNode !== host) host.appendChild(ex); }
      host.hidden = homeOpen || i !== cur;
      let home = host.querySelector('.home');
      if (!d.wins.length) { if (!home) { home = document.createElement('div'); home.className = 'home'; host.appendChild(home); } home.innerHTML = homeHtml(i); }
      else if (home) home.remove();
    }
    $$('.wsp', stage).forEach(el => { if (!ws.some(d => d.id === el.dataset.desk)) el.remove(); });
    const home = $('#desktopHome');
    home.hidden = !homeOpen;
    if (homeOpen) home.innerHTML = homeHtml(null);
    layout(); paintBar(); paintFocus();
  }
  /* Tiling: capped windows form a centered group; 2 split; 3+ = master + stack.
   * Host-window fullscreen keeps this readable width; explicit monocle remains immersive. */
  function layout() {
    const host = wsEl(cur), d = ws[cur];
    // Apply chrome before measuring, including a single app, reload and workspace switches.
    const full = !homeOpen && !!d.mono && !!d.wins.length;
    document.body.classList.toggle('desktop-fullscreen', full);
    const W_ = host.clientWidth, H_ = host.clientHeight, g = full ? 0 : 8;
    const n = d.wins.length;
    const rects = {};
    if (!n || homeOpen) return;
    const configuredMax = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--desktop-window-max-width'));
    const maxWidth = configuredMax > 0 ? configuredMax : 1200;
    // Columns on request: a window that sets `share` (Video Editor's video + Feedback pair) lays the desktop out as
    // side-by-side columns in window order; windows without a share split what is left equally.
    const shared = !d.mono && n >= 2 && n <= 4 && d.wins.some(id => W[id]?.share > 0);
    if (d.mono) d.wins.forEach(id => { rects[id] = id === d.focus || n === 1 ? [g, g, W_ - 2 * g, H_ - 2 * g] : null; });
    else if (shared) {
      const avail = Math.max(0, W_ - (n + 1) * g), asked = d.wins.reduce((t, id) => t + (W[id]?.share > 0 ? W[id].share : 0), 0);
      const rest = d.wins.filter(id => !(W[id]?.share > 0)).length, scale = rest ? Math.min(1, 0.8 / asked) : 1 / asked;
      const free = rest ? (1 - asked * scale) / rest : 0;
      let x = g; for (const id of d.wins) { const w = Math.round(avail * (W[id]?.share > 0 ? W[id].share * scale : free)); rects[id] = [x, g, w, H_ - 2 * g]; x += w + g; }
    } else if (n === 1) {
      const width = Math.min(maxWidth, Math.max(0, W_ - 2 * g));
      rects[d.wins[0]] = [(W_ - width) / 2, g, width, H_ - 2 * g];
    } else if (n === 2) {
      const half = Math.min(maxWidth, Math.max(0, (W_ - 3 * g) / 2));
      const left = (W_ - 2 * half - g) / 2;
      rects[d.wins[0]] = [left, g, half, H_ - 2 * g]; rects[d.wins[1]] = [left + g + half, g, half, H_ - 2 * g];
    } else {
      const available = Math.max(0, W_ - 3 * g);
      const naturalMaster = Math.round(available * 0.56);
      const mw = Math.min(maxWidth, naturalMaster), sw = Math.min(maxWidth, available - naturalMaster);
      const left = (W_ - mw - sw - g) / 2, k = n - 1, sh = (H_ - (k + 1) * g) / k;
      rects[d.wins[0]] = [left, g, mw, H_ - 2 * g];
      d.wins.slice(1).forEach((id, j) => { rects[id] = [left + g + mw, g + j * (sh + g), sw, sh]; });
    }
    for (const id of d.wins) {
      const el = winEl(id); if (!el) continue; const r = rects[id];
      el.classList.toggle('gone', !r);
      el.classList.toggle('full', full && id === d.focus);
      if (r) Object.assign(el.style, { left: r[0] + 'px', top: r[1] + 'px', width: r[2] + 'px', height: r[3] + 'px' });
    }
  }
  function paintFocus() {
    const d = ws[cur];
    $$('.win', stage).forEach(el => el.classList.toggle('focus', el.dataset.win === d.focus));
    const f = focused(); document.title = f ? `${winTitle(f)} · Wizard` : 'Wizard';
    if (d.mono) layout();
  }
  function goWs(i, { from } = {}) {
    if (!Number.isInteger(i) || i < 0 || i >= ws.length) return;
    if (i === cur) { if (homeOpen) { leaveHome(); if (focused()) focusInside(focused().id); CHATS.markVisibleThreadsSeen(); } return; }
    homeOpen = false; store.set('homeOpen', false);
    // Preserve the later-approved empty-desktop pruning contract.
    const target = ws[i], left = ws[cur], prune = !left.wins.length && ws.length > 1;
    const prev = cur;
    if (prune) { ws.splice(cur, 1); i = ws.indexOf(target); }
    lastWs = prune ? i : prev; cur = i; save();
    const el = wsEl(i); el.classList.add(i >= prev ? 'from-r' : 'from-l');
    render(); requestAnimationFrame(() => el.classList.remove('from-r', 'from-l'));
    CHATS.markVisibleThreadsSeen();
  }

  function newDesktop() {
    ws.push(freshDesk()); goWs(ws.length - 1); return ws[cur];
  }
  function closeDesktop() {
    if (homeOpen || ws[cur].wins.length || ws.length === 1) return false;
    const previous = lastWs !== cur && ws[lastWs] ? ws[lastWs] : ws[cur > 0 ? cur - 1 : 1];
    ws.splice(cur, 1); cur = ws.indexOf(previous); lastWs = cur; save(); render();
    if (focused()) focusInside(focused().id); CHATS.markVisibleThreadsSeen(); return true;
  }
  function closeCurrent() { const f = focused(); if (f) { closeWin(f.id); return 'app'; } return closeDesktop() ? 'desktop' : 'root'; }

  /* ---------------- top bar ---------------- */
  function paintBar() {
    const L = LIVE?.ok ? LIVE.groups() : { needs: [], ready: [], working: [] };
    $('#logo').setAttribute('aria-current', homeOpen ? 'page' : 'false');
    $('#wsList').innerHTML = ws.map((d, i) => {
      const hot = d.wins.some(id => { const w = W[id]; if (w?.app !== 'chats' || !w.thread) return false; const s = LIVE?.session(w.thread); return s && LIVE.isNew(s); });
      const names = d.wins.map(id => winTitle(W[id])).join(', ');
      return `<button class="ws${!homeOpen && i === cur ? ' cur' : ''}${d.wins.length ? ' used' : ''}${hot ? ' hot' : ''}" data-ws="${i}" aria-label="Desktop ${i + 1}" title="${esc(names || 'Empty desktop')} (${MOD}${i + 1})">${i + 1}</button>`;
    }).join('') + `<button class="ws ws-add" data-newdesk aria-label="New desktop" title="New desktop (${CMD}T / ${MOD}T${ws.length < 9 ? ` / ${MOD}${ws.length + 1}` : ''})">+</button>`;
    const st = $('#status');
    if (!LIVE?.ok) st.innerHTML = `<span class="off">${LIVE?.error === 'access' ? 'Sign in to Wizard' : 'Connecting…'}</span>`;
    else st.innerHTML = `${L.needs.length ? `<span title="Needs you"><i class="st needs"></i>${L.needs.length}</span>` : ''}<span title="Unread"><i class="st unread"></i>${L.ready.length}</span>${L.working.length ? `<span title="Working"><i class="st working"></i>${L.working.length}</span>` : ''}`;
  }
  function tickClock() { const C = window.WizConfig; $('#clock').textContent = C.dateLabel() + '  ' + C.hm(); }
  setInterval(tickClock, 15000); tickClock(); window.addEventListener('wizard:config', tickClock);
  $('#wsList').addEventListener('click', e => { if (e.target.closest('[data-newdesk]')) return newDesktop(); const b = e.target.closest('[data-ws]'); if (b) goWs(+b.dataset.ws); });
  $('#logo').addEventListener('click', () => goHome());
  $('#searchBtn').addEventListener('click', () => openPalette());
  $('#status').addEventListener('click', () => toggleInbox());
  $('#clock').addEventListener('click', () => goHome());
  $('#keysBtn').addEventListener('click', () => toggleKeys());
  $('#micBtn').addEventListener('click', () => talk());
  $('#voiceCancel').addEventListener('click', () => vMode === 'dictate' ? dictate('cancel') : talk('cancel'));
  // No transcriber on this Wizard: the mic button hides (the outbox still keeps typed messages safe).
  window.WizConfig?.ready.then(() => { $('#micBtn').hidden = !window.WizConfig.has('voice'); });

  /* Home is a root view, separate from desktops: every open app and draft stays mounted. */
  function leaveHome() {
    if (!homeOpen) return;
    homeOpen = false; store.set('homeOpen', false); render();
  }
  function goHome() {
    for (const id of Object.keys(W)) if (W[id].app === 'chats') CHATS.saveDraft(id);
    closePalette(); toggleKeys(false); closeInbox(); closeSettings(); closeUsage();
    window.WizWebUpdate?.back(); // Preserve the accepted shared banner; fold its navigation list.
    LINKS?.close();
    for (let i = 0; i < 20 && CHATS.closeOverlay(); i++) { /* Close navigation sheets, never the recorder. */ }
    homeOpen = true; store.set('homeOpen', true); render();
    $('#desktopHome').focus({ preventScroll: true });
  }

  /* ---------------- home (root / empty workspace) ---------------- */
  function homeHtml(i) {
    const L = LIVE?.ok ? LIVE.groups() : { needs: [], ready: [], working: [] };
    const n = new Date();
    const rows = list => list.slice(0, 6).map(s => `<button class="home-row" data-thread="${esc(s.id)}"><span class="emo">${emoOf(s.id)}</span><span class="nm">${esc(s.title)}</span><time>${esc(ago(LIVE.cardAt(s)))}</time></button>`).join('') || '<div class="home-none">Nothing here.</div>';
    const quick = ['wizard', 'wizard-signal', 'wisdom', 'shopping', 'mizel', 'files', 'console', 'legacy-wizard', 'system', 'app-store'].map(id => APP[id]).filter(Boolean);
    return `<div class="home-in">
      <div class="home-time">${window.WizConfig.hm()}</div>
      <div class="home-date">${window.WizConfig.dateLabel(Date.now(), { weekday: 'long', day: 'numeric', month: 'long' })}${i == null ? '' : ` · Desktop ${i + 1}`}</div>
      <div class="home-line">${LIVE?.ok ? `<b>${L.needs.length} need${L.needs.length === 1 ? 's' : ''} you</b>, ${L.ready.length} unread, ${L.working.length} working.` : 'Connecting to Wizard…'}</div>
      <div class="home-cols"><div class="home-card"><h4>Needs you · Unread</h4>${rows(L.needs.concat(L.ready))}</div><div class="home-card"><h4>Working</h4>${rows(L.working)}</div></div>
      <div class="home-apps">${quick.map(a => `<button class="app-chip" data-app="${a.id}">${ico('i', '', a)}${esc(a.name)}</button>`).join('')}</div>
      <div class="home-keys"><span><kbd>${CMD}K</kbd> search and launch</span><span><kbd>${MOD}Enter</kbd> new chat</span><span><kbd>${MOD}⇧V</kbd> new voice chat</span><span><kbd>${CMD}T</kbd> / <kbd>${MOD}T</kbd> new desktop</span><span><kbd>${MOD}/</kbd> all keys</span></div>
    </div>`;
  }
  stage.addEventListener('click', e => {
    const hr = e.target.closest('.home [data-thread]'); if (hr) return openThread(hr.dataset.thread);
    const ap = e.target.closest('.home [data-app]'); if (ap) return openApp(APP[ap.dataset.app]);
  });

  /* ---------------- window interactions ---------------- */
  stage.addEventListener('pointerdown', e => { const el = e.target.closest('.win'); if (el) focusWin(el.dataset.win, { scroll: false }); }, true);
  stage.addEventListener('click', e => {
    const el = e.target.closest('.win'); if (!el) return;
    const id = el.dataset.win, w = W[id];
    const act = e.target.closest('[data-wact]')?.dataset.wact;
    if (act === 'close') return closeWin(id);
    if (act === 'mono') return toggleMono();
    if (act === 'pop') { const a = appOf(w); let href = a.url; try { href = el.querySelector('iframe').contentWindow.location.href; } catch (err) {} return window.open(href, '_blank', 'noopener'); }
    if (w?.app === 'chats') {
      // Rows in the list pane open in this window's thread pane.
      const row = e.target.closest('[data-chopen]');
      if (row && e.target.closest('.pane-list') && CHATS.justPressed()) { e.stopPropagation(); return; } // a long-press/right-click just opened the actions sheet
      if (row && e.target.closest('.pane-list') && !e.target.closest('.ch-sheet')) { e.stopPropagation(); CHATS.openChat(id, row.dataset.chopen); syncChatsPane(id); setTimeout(() => focusInside(id), 20); return; }
      if (e.target.closest('.pane-list [data-chnew]') || e.target.closest('[data-panenew]')) { e.stopPropagation(); CHATS.openNewDraft(id, ''); syncChatsPane(id); setTimeout(() => focusInside(id), 20); return; }
      const dr = e.target.closest('.pane-list [data-chdraft]'); if (dr && !e.target.closest('[data-chdraftx]')) { e.stopPropagation(); CHATS.openNewDraft(id, dr.dataset.chdraft); syncChatsPane(id); setTimeout(() => focusInside(id), 20); return; }
      const cid = e.target.closest('[data-chats]')?.dataset.chats; if (cid && CHATS.click(e, cid)) { syncChatsPane(id); return; }
    }
  });
  stage.addEventListener('dblclick', e => { if (e.target.closest('.wbar') && !e.target.closest('[data-wact]')) toggleMono(); });
  CHATS.bind(stage);
  // List pane search lives on the ::list window; keep thread selection painted after it re-renders.
  stage.addEventListener('input', e => { if (e.target.matches('[data-chsearch]')) { const id = e.target.closest('.win')?.dataset.win; if (id) syncChatsPane(id); } });

  /* Drag a window by its title bar: drop on another window to swap, or on a workspace number to move it. */
  let drag = null;
  stage.addEventListener('pointerdown', e => {
    const bar = e.target.closest('.wbar'); if (!bar || e.target.closest('[data-wact]') || e.button !== 0) return;
    drag = { id: bar.closest('.win').dataset.win, x: e.clientX, y: e.clientY, on: false };
  });
  addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.on && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) { drag.on = true; winEl(drag.id)?.classList.add('drag'); }
    if (!drag.on) return;
    const t = document.elementFromPoint(e.clientX, e.clientY);
    $$('.drop-target, .ws.drop').forEach(x => x.classList.remove('drop-target', 'drop'));
    const over = t?.closest('.win'); if (over && over.dataset.win !== drag.id) over.classList.add('drop-target');
    const wsb = t?.closest('.ws'); if (wsb) wsb.classList.add('drop');
  });
  addEventListener('pointerup', e => {
    if (!drag) return; const d = drag; drag = null;
    winEl(d.id)?.classList.remove('drag');
    const t = d.on ? document.elementFromPoint(e.clientX, e.clientY) : null;
    $$('.drop-target, .ws.drop').forEach(x => x.classList.remove('drop-target', 'drop'));
    if (!t) return;
    const wsb = t.closest('.ws'); if (wsb) return moveWin(d.id, +wsb.dataset.ws);
    const over = t.closest('.win');
    if (over && over.dataset.win !== d.id) { const L = ws[cur].wins, a = L.indexOf(d.id), b = L.indexOf(over.dataset.win); if (a >= 0 && b >= 0) { [L[a], L[b]] = [L[b], L[a]]; save(); layout(); } }
  });
  addEventListener('resize', () => layout());

  /* ---------------- palette: one box for apps, threads, commands and asking Archimedes ---------------- */
  const pal = $('#palette'), palIn = $('#palInput'), palList = $('#palList');
  // The agent's name comes from Wizard OS settings; keep static labels in step with it.
  const nameLabels = () => {
    const n = window.WizConfig.agent();
    palIn.placeholder = `Open an app, find a thread, or ask ${n}…`;
    document.querySelectorAll('[data-agent-name]').forEach(el => { el.textContent = n; });
  };
  nameLabels(); window.addEventListener('wizard:config', nameLabels);
  let palItems = [], palSel = 0;
  function commands() {
    return [
      { kind: 'cmd', name: 'Get apps', icon: '+', run: () => openApp(APP['app-store']) },
      { kind: 'cmd', name: 'Your system', icon: '◈', run: () => openApp(APP.system) },
      { kind: 'cmd', name: 'New desktop', icon: '+', keys: `${CMD}T / ${MOD}T`, run: () => newDesktop() },
      { kind: 'cmd', name: 'Next desktop', icon: '→', keys: `${CMD}⇧]`, run: () => goWs((cur + 1) % ws.length) },
      { kind: 'cmd', name: 'Previous desktop', icon: '←', keys: `${CMD}⇧[`, run: () => goWs((cur - 1 + ws.length) % ws.length) },
      { kind: 'cmd', name: 'New chat', icon: '✎', keys: `${CMD}N / ${MOD}Enter`, run: () => newChat({ fresh: true }) },
      { kind: 'cmd', name: 'New voice chat', icon: '🎙', keys: `${CMD}⇧N / ${MOD}⇧V`, run: () => talkNew() },
      { kind: 'cmd', name: `Talk to ${window.WizConfig.agent()}`, icon: '🎙', keys: 'Right ⌘', run: () => talk() },
      { kind: 'cmd', name: 'Dictate', icon: '✎', keys: 'Right ⌥', run: () => dictate() },
      { kind: 'cmd', name: 'Inbox', icon: '⬇', keys: `${MOD}I`, run: () => openInbox() },
      ...(window.WosFiles ? [{ kind: 'cmd', name: 'Files', icon: '▤', run: () => openFiles() }] : []),
      ...(window.WosUsage ? [{ kind: 'cmd', name: 'AI usage', icon: '◔', run: () => openUsage() }] : []),
      { kind: 'cmd', name: 'Close app / empty desktop', icon: '✕', keys: `${CMD}W / ${MOD}W`, run: () => closeCurrent() },
      { kind: 'cmd', name: 'Full screen', icon: '⤢', keys: `${CMD}F / ${MOD}F`, run: () => toggleMono() },
      { kind: 'cmd', name: 'Keyboard shortcuts', icon: '⌨', keys: `${MOD}/`, run: () => toggleKeys(true) },
      { kind: 'cmd', name: 'Settings', icon: '⚙', keys: `${MOD},`, run: () => openSettings() },
      { kind: 'cmd', name: 'Use the phone layout here', icon: '📱', run: () => { location.href = './?shell=phone'; } },
      { kind: 'cmd', name: 'Reset desktop layout', icon: '↺', run: () => { Object.keys(localStorage).filter(k => k.startsWith('wux.desk.')).forEach(k => localStorage.removeItem(k)); location.reload(); } },
    ];
  }
  function palBuild(q) {
    const n = norm(q), out = [];
    const apps = (n ? searchApps(q) : APPS.filter(a => a.kind !== 'view')).filter(a => a.kind !== 'native').slice(0, n ? 8 : 12)
      .map(a => ({ kind: 'app', app: a, name: a.name, sub: a.desc, icon: a.icon, g: a.g, run: o => openApp(a, o) }));
    const sessions = LIVE?.ok ? LIVE.sessions.filter(s => !s.hidden) : [];
    let threads;
    if (n) threads = sessions.map(s => { const t = norm(s.title), p = norm(s.preview); const sc = t.startsWith(n) ? 3 : t.includes(n) ? 2 : p.includes(n) ? 1 : 0; return [sc, s]; }).filter(x => x[0]).sort((a, b) => b[0] - a[0] || Date.parse(LIVE.cardAt(b[1])) - Date.parse(LIVE.cardAt(a[1]))).slice(0, 8).map(x => x[1]);
    else { const L = LIVE?.ok ? LIVE.groups() : { needs: [], ready: [], working: [] }; threads = [...L.needs, ...L.ready, ...L.working].slice(0, 6); }
    const th = threads.map(s => ({ kind: 'thread', name: s.title, sub: ago(LIVE.cardAt(s)) + (LIVE.isNew(s) ? ' · unread' : WORKING_ST.has(s.status) ? ' · working' : ''), icon: emoOf(s.id), run: o => openThread(s.id, o) }));
    const cmds = commands().filter(c => !n || norm(c.name).includes(n));
    // Quick search: web + AI overview, or images, in the right-half link pane (no new thread).
    let searchGrp = null;
    if (n && searchUrl(q)) {
      const qs = quickSearch(q) || { query: q, tab: 'all' };
      const go = tab => () => { const u = searchUrl(qs.query, tab); if (u && LINKS) LINKS.open(u); };
      const items = [{ kind: 'search', name: `Search: “${clip(qs.query, 70)}”`, sub: 'AI overview + web results', icon: '⌕', g: ['#8f63ff', '#2a1a66'], run: go('all') },
        { kind: 'search', name: `Image search: “${clip(qs.query, 70)}”`, sub: 'Images', icon: '▦', g: ['#ff5ccf', '#5c3bff'], run: go('images') }];
      if (qs.tab === 'images') items.reverse();
      searchGrp = { grp: 'Search', items, strong: !!quickSearch(q)?.strong };
    }
    // With a query, apps lead (James: "music" → Wizard Music first, under the cursor), then threads,
    // then commands; "Ask" goes last unless nothing else matched. With no query, attention threads lead.
    if (n) {
      if (apps.length) out.push({ grp: 'Apps', items: apps });
      if (th.length) out.push({ grp: 'Threads', items: th });
    } else {
      if (th.length) out.push({ grp: 'Needs you · unread · working', items: th });
      if (apps.length) out.push({ grp: 'Apps', items: apps });
    }
    if (cmds.length) out.push({ grp: 'Commands', items: cmds });
    if (n) out.push({ grp: 'Ask', items: [{ kind: 'ask', name: `Ask ${window.WizConfig.agent()}: “${clip(q, 70)}”`, icon: '✦', keys: `${CMD}Enter`, run: () => ask(q) }] });
    // "image search …" / "search the web …" leads; otherwise Search sits just above Ask.
    if (searchGrp) { if (searchGrp.strong) out.unshift(searchGrp); else out.splice(Math.max(0, out.length - 1), 0, searchGrp); }
    return out;
  }
  const WORKING_ST = new Set(['submitting', 'queued', 'running', 'stopping']);
  function palRender() {
    const groups = palBuild(palIn.value); palItems = groups.flatMap(g => g.items); palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
    let k = 0;
    palList.innerHTML = groups.map(g => `<div class="pal-grp">${esc(g.grp)}</div>` + g.items.map(it => { const i = k++; return `<button class="pal-it${i === palSel ? ' sel' : ''}" data-i="${i}" role="option">${it.app ? ico('span', 'ic', it.app) : `<span class="ic" style="--g1:${it.g?.[0] || '#3a2a6a'};--g2:${it.g?.[1] || '#241a44'}">${it.kind === 'ask' ? window.WizBrand.html : it.icon || '◇'}</span>`}<span class="nm">${esc(it.name)}${it.sub ? `<small>${esc(clip(it.sub, 60))}</small>` : ''}</span>${it.keys ? `<span class="hint"><kbd>${esc(it.keys)}</kbd></span>` : ''}</button>`; }).join('')).join('') || '<div class="pal-empty">Nothing yet.</div>';
    palList.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
  function openPalette(q = '') { pal.hidden = false; palIn.value = q; palSel = 0; palRender(); palIn.focus(); palIn.select(); }
  function closePalette() { pal.hidden = true; const f = focused(); if (f) focusInside(f.id); }
  function palRun(i, o = {}) { const it = palItems[i]; if (!it) return; closePalette(); it.run(o); }
  palIn.addEventListener('input', () => { palSel = 0; palRender(); });
  palIn.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); palSel = (palSel + 1) % Math.max(1, palItems.length); palRender(); }
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); palSel = (palSel - 1 + palItems.length) % Math.max(1, palItems.length); palRender(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && palIn.value.trim()) { const q = palIn.value; closePalette(); return ask(q); }
      palRun(palSel, { fresh: e.shiftKey });
    }
  });
  palList.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) palRun(+b.dataset.i, { fresh: e.shiftKey }); });
  pal.addEventListener('pointerdown', e => { if (e.target === pal) closePalette(); });

  /* Ask Archimedes from anywhere: a new thread, through the durable outbox, delegated in the background.
   * Nothing opens or takes focus; the thread shows up in Chats and the Inbox when James wants it. */
  async function ask(text, how = 'typing in the desktop launcher', audio = null, route = null) {
    text = String(text || '').trim(); if (!text && !audio) return;
    const ctx = viewContext(null, how);
    await OUTBOX.enqueue({ ...(route || {}), kind: 'new', text, audio, instructions: ctx, source: 'orb', how });
    if (!audio) toast('✦', `New thread started · ${window.WizConfig.agent()} is on it`, 1600);
  }

  /* Wizard Files (#23): the shared Files sheet, in a Chats window (attaches to its open thread, else starts a new chat). */
  function openFiles() {
    let w = ws[cur].wins.map(id => W[id]).find(x => x.app === 'chats') || findWin(x => x.app === 'chats');
    if (!w) w = newWin({ app: 'chats', thread: null });
    focusWin(w.id);
    setTimeout(() => CHATS.PW?.openFiles(w.thread ? w.id : w.id + '::list'), 30);
  }
  /* AI usage (#24): the same panel as the phone's Settings, in a card. */
  const usageEl = document.createElement('div');
  usageEl.className = 'keys usage-ov'; usageEl.hidden = true;
  usageEl.innerHTML = '<div class="keys-card" role="dialog" aria-label="AI usage"><div class="keys-head"><b>AI usage</b><small>Quota left on each subscription, and when it resets.</small><button class="x" data-close="usage" aria-label="Close">✕</button></div><div class="usage-body" data-usage-host></div></div>';
  document.body.appendChild(usageEl);
  const paintUsage = () => { if (!usageEl.hidden) usageEl.querySelector('[data-usage-host]').innerHTML = window.WosUsage.html(); };
  function openUsage() { usageEl.hidden = false; paintUsage(); window.WosUsage.load(Date.now() - (window.WosUsage.at || 0) > 60e3).then(paintUsage); }
  function closeUsage() { if (usageEl.hidden) return false; usageEl.hidden = true; return true; }
  usageEl.addEventListener('click', e => {
    if (e.target === usageEl || e.target.closest('[data-close]')) return closeUsage();
    if (e.target.closest('[data-usage-refresh]')) { window.WosUsage.load(true).then(paintUsage); paintUsage(); }
  });

  /* ---------------- inbox drawer ---------------- */
  const ib = $('#inbox');
  let ibSel = 0;
  function renderInbox() {
    if (ib.hidden) return;
    const L = LIVE?.ok ? LIVE.groups() : { needs: [], ready: [], working: [] };
    const unsent = OUTBOX ? OUTBOX.unsent() : [];
    $('#ibSub').textContent = LIVE?.ok ? `${L.needs.length} need you · ${L.ready.length} unread · ${L.working.length} working` : 'Connecting…';
    const row = (s, k) => `<button class="ib-row" data-thread="${esc(s.id)}"><span class="emo">${emoOf(s.id)}</span><span class="bd"><b>${esc(s.title)}</b><span>${esc(clip(s.preview || '', 140))}</span></span><time>${esc(ago(LIVE.cardAt(s)))}</time>${k === 'ready' ? `<span class="rd" data-read="${esc(s.id)}">Mark read</span>` : ''}</button>`;
    const sec = (k, label, list) => `<div class="ib-sec" data-k="${k}"><h4>${label}${list.length ? ` · ${list.length}` : ''}</h4>${list.length ? list.map(s => row(s, k)).join('') : '<div class="ib-none">None</div>'}</div>`;
    $('#ibBody').innerHTML = (unsent.length ? `<div class="ib-sec" data-k="unsent"><h4>Not sent yet · ${unsent.length}</h4>${unsent.map(u => `<div class="ib-row"><span class="emo">⏳</span><span class="bd"><b>${esc(clip(u.text || 'Voice note', 60))}</b><span>${esc(u.state === 'failed' ? 'Not sent · ' + (u.error || '') : 'Sending…')}</span></span></div>`).join('')}</div>` : '')
      + sec('needs', 'Needs you', L.needs) + sec('ready', 'Unread', L.ready) + sec('working', 'Working', L.working);
    const rows = $$('.ib-row[data-thread]', ib); ibSel = Math.min(ibSel, rows.length - 1); rows[ibSel]?.classList.add('sel');
  }
  function openInbox() { ib.hidden = false; ibSel = 0; renderInbox(); }
  function closeInbox() { ib.hidden = true; }
  function toggleInbox() { ib.hidden ? openInbox() : closeInbox(); }
  ib.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) return closeInbox();
    const rd = e.target.closest('[data-read]'); if (rd) { e.stopPropagation(); LIVE.markSeen(rd.dataset.read); return; }
    const r = e.target.closest('[data-thread]'); if (r) { closeInbox(); openThread(r.dataset.thread); }
  });

  /* ---------------- settings (⌥, or the palette): connection and the voice provider, read-only ---------------- */
  const setEl = document.createElement('div');
  setEl.id = 'dsettings'; setEl.className = 'keys dsettings'; setEl.hidden = true;
  document.body.appendChild(setEl);
  function renderSettings() {
    if (setEl.hidden) return;
    const st = LIVE?.ok ? 'Connected' : LIVE?.error === 'access' ? 'Sign-in needed' : 'Connecting…';
    setEl.innerHTML = `<div class="keys-card set-card" role="dialog" aria-label="Settings"><div class="keys-head"><b>Settings</b><small>Wizard on this computer</small><button class="x" data-close aria-label="Close">✕</button></div>
      <div class="set-body"><div class="st-group"><h4>Wizard</h4><div class="st-row static"><span class="st-ic">◇</span><span class="st-tx"><b>${esc(st)}</b><small>Desktop · ${esc(location.host)}</small></span></div></div>
      ${C.voiceStatus?.card() || ''}</div></div>`;
  }
  function openSettings() { setEl.hidden = false; renderSettings(); setEl.querySelector('[data-close]')?.focus(); }
  function closeSettings() { setEl.hidden = true; const f = focused(); if (f) focusInside(f.id); }
  setEl.addEventListener('click', e => { if (e.target === setEl || e.target.closest('[data-close]')) closeSettings(); });
  C.voiceStatus?.onChange(() => renderSettings());

  /* ---------------- keys sheet ---------------- */
  const KEYS = [
    ['Launch', [[`${CMD}K  or  ${MOD}Space`, `Search apps, threads, commands; or ask ${window.WizConfig.agent()}`], [`${CMD}N  or  ${MOD}Enter`, 'New chat'], [`${CMD}⇧N  or  ${MOD}⇧V`, 'New voice chat (press again to send)'], [`${MOD}I`, 'Inbox'], ['Right ⌘ (tap)', `Talk to ${window.WizConfig.agent()} (tap again to send; Cancel discards)`], ['Right ⌥ (paused)', 'Wizard PWA dictation is paused; your system voice tool keeps this key']]],
    ['Desktops', [[`${CMD}T  or  ${MOD}T`, 'New desktop'], [`${CMD}⇧[  ${CMD}⇧]  or  Ctrl+Tab`, 'Previous / next desktop'], [`${CMD}W  or  ${MOD}W`, 'Close focused app; press again on empty desktop to close it']]],
    ['Desktop shortcuts', [[`${MOD}1 … ${MOD}9`, 'Go to workspace'], [`⇧${MOD}1 … 9`, 'Send window to workspace'], [`${MOD}[  ${MOD}]`, 'Previous / next workspace'], [`${MOD}Tab`, 'Back to the last workspace']]],
    ['Windows', [[`${CMD}← ↑ → ↓`, 'Focus app in this desktop'], [`${MOD}H J K L`, 'Focus app (browser alternative)'], [`⇧${MOD}← →`, 'Swap window'], [`${CMD}F  or  ${MOD}F`, 'Full screen'], [`⌘W / ${MOD}W`, 'Close app']]],
    ['Chats', [[`${MOD}↑  ${MOD}↓`, 'Previous / next selected chat'], [`${CMD}Enter`, 'Send'], ['Enter', 'New line'], ['Esc', 'Back to the thread list'], ['↑ ↓  or  j k', 'Previous / next chat (in the list)'], [`⇧${MOD}J  ⇧${MOD}K`, 'Next / previous chat (anywhere)'], ['/', 'Search chats and messages'], [`${MOD},`, 'Settings']]],
    ['Wizard for Mac (works in any app)', [['Caps Lock', 'Search and launch'], ['Caps Lock + letter', 'Jump to a bound app'], ['Right ⌘', 'Talk to Wizard from anywhere'], ['Right ⌥', 'Dictate into any app']]],
  ];
  const keysEl = $('#keys');
  const nativeDesktop = !!window.webkit?.messageHandlers?.wizardNative;
  $('#keys .keys-head small').textContent = nativeDesktop ? 'Wizard owns ⌘N, ⌘T and ⌘W. Desktops open on demand.' : 'Browser owns ⌘N/T/W. Use ⌥Enter (chat), ⌥T (desktop), ⌥W (close), ⌥⇧V (new voice).';
  $('#keysBody').innerHTML = KEYS.map(([h, rows]) => `<h4>${h}</h4>` + rows.map(([k, d]) => `<div class="krow"><span>${esc(d)}</span><span>${k.split(/\s{2,}/).map(x => `<kbd>${esc(x)}</kbd>`).join(' or ')}</span></div>`).join('')).join('');
  function toggleKeys(on) { keysEl.hidden = on == null ? !keysEl.hidden : !on; }
  keysEl.addEventListener('click', e => { if (e.target === keysEl || e.target.closest('[data-close]')) toggleKeys(false); });

  /* ---------------- voice: Right ⌘ talk, Right ⌥ dictate (taps), mic button ----------------
   * Tap to start, tap again to send (never hold). Lands in the focused thread when one is open,
   * otherwise starts a new thread. Audio goes through the durable outbox: transcribed there,
   * kept as a voice note, retried if the network drops. */
  const pill = $('#voicePill'), mic = $('#micBtn');
  let vTarget = null, vTimer = 0, vMode = 'talk', dTarget = null, vReply = null, vNewChat = false, vNewKey = `${CMD}⇧N`, vContext = '';
  const VOICE = C.voice({
    onState: st => {
      pill.hidden = st === 'idle'; pill.classList.toggle('think', st === 'think'); mic.classList.toggle('on', st !== 'idle');
      CHATS.PW?.paintMic(st === 'listen' && !!vReply, vReply?.sid || '');
      $('#clock').hidden = st !== 'idle';
      pill.classList.toggle('dict', vMode === 'dictate');
      $('#voiceKey').textContent = vMode === 'dictate' ? 'Right ⌥' : vNewChat ? vNewKey : 'Right ⌘';
      $('#voiceAct').textContent = vMode === 'dictate' ? 'insert' : 'send';
      $('#voiceText').textContent = vMode === 'dictate' ? (st === 'think' ? 'Transcribing…' : 'Dictating')
        : st === 'think' ? 'Sending…' : vTarget ? `Listening · to “${clip(winTitle(W[vTarget]), 28)}”` : 'Listening · new chat';
      clearInterval(vTimer);
      if (st === 'listen') vTimer = setInterval(() => { const s = Math.floor(VOICE.elapsed() / 1000); $('#voiceTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 250);
    },
    onLevel: l => { $('#voiceLvl').style.width = Math.round(l * 100) + '%'; },
  });
  // A separate chord always starts a new thread, even with an existing thread focused.
  // Never retarget an in-flight reply/dictation or discard it when the new-voice chord is pressed.
  function talkNew(key = `${CMD}⇧N`) {
    if (VOICE.state === 'idle') return talk('start', true, key);
    if (VOICE.state === 'listen' && vMode === 'talk' && vNewChat) return talk('send');
    toast('🎙', 'Finish the current recording before starting a new voice chat', 2400);
    return 'busy';
  }
  async function talk(action = 'toggle', forceNew = false, newKey = `${CMD}⇧N`) {
    if (VOICE.state === 'think') return 'busy';
    if (action === 'cancel') { if (VOICE.state !== 'idle') { vReply = null; VOICE.cancel(); toast('✕', 'Cancelled', 1000); } return 'none'; }
    if (VOICE.state !== 'idle' && vMode === 'dictate') return 'busy';
    if (VOICE.state === 'idle') {
      if (action === 'send') return 'none';
      vMode = 'talk'; vNewChat = forceNew; vNewKey = newKey;
      const f = focused(); vTarget = !forceNew && f?.app === 'chats' && f.thread ? f.id : null;
      vReply = vTarget ? { wid: f.id, sid: f.thread } : null;
      vContext = viewContext(vTarget, forceNew ? 'voice, new chat' : 'voice, aimed at this thread');
      $('#voiceTime').textContent = '0:00';
      try { await VOICE.start(); } catch (e) { toast('🎙', 'Microphone unavailable: ' + (e.message || e), 3200); return 'none'; }
      return 'voice';
    }
    if (action === 'start') return 'voice';
    const rp = vReply; vReply = null; // the thread a composer-mic take belongs to, fixed before anything else runs
    const aimSid = vTarget && W[vTarget]?.thread; // the thread in front at the send key, before any await
    // Text, photos and voice go as ONE message (legacy H4): that thread's composer, taken at the send key.
    const sealAt = rp ? rp : aimSid ? { wid: vTarget, sid: aimSid } : null;
    if (sealAt && CHATS.composerBusy(sealAt.wid, sealAt.sid)) { vReply = rp; toast('…', 'Still uploading · send when it finishes', 2000); return 'busy'; }
    let modelRoute;
    try { modelRoute = CHATS.modelRoute(sealAt?.wid, sealAt?.sid || ''); }
    catch (e) { vReply = rp; toast('!', String(e.message || e), 2400); return 'busy'; }
    const t = sealAt ? CHATS.takeComposer(sealAt.wid, sealAt.sid) : null;
    const sealed = t && (t.text || t.files.length) ? t : false;
    const r = await VOICE.finish({ transcribe: false });
    if ((!r || !r.blob) && sealed) sealed.putBack();
    if (!r || !r.blob) { toast('🎙', r?.error || 'Didn’t catch that', 1600); return 'none'; }
    const w = vTarget && W[vTarget];
    if (rp) { CHATS.sendVoiceTo(rp.wid, rp.sid, r.blob, [], sealed, modelRoute); toast('✦', 'Voice reply · sent to this thread', 1400); return 'sent'; }
    if (w && aimSid) CHATS.sendChat(w.id, '', 'voice, aimed at this thread', r.blob, { sid: aimSid, seal: sealed, route: modelRoute });
    else {
      if (sealed) sealed.putBack();
      if (aimSid && aimSid !== '__new__') OUTBOX.enqueue({ ...modelRoute, kind: 'reply', sessionId: aimSid, audio: r.blob, text: '', instructions: vContext, how: 'voice, aimed at this thread', source: 'orb' });
      else ask('', 'voice', r.blob, modelRoute);
    }
    toast('✦', `Sent to ${window.WizConfig.agent()}`, 1400);
    return 'sent';
  }

  // Composer mic: tap to record a reply to this thread, tap again (or Right ⌘) to send it there. The thread is
  // fixed when recording starts, so switching threads mid-take can't send it somewhere else.
  async function recordReply(wid, sid) {
    if (VOICE.state === 'think') return 'busy';
    if (VOICE.state === 'listen') { if (vReply) return talk('send'); return 'busy'; } // sends to the thread it was started in
    if (!sid) return 'busy';
    vMode = 'talk'; vNewChat = false; vTarget = wid; vReply = { wid, sid }; vContext = viewContext(wid, 'voice, aimed at this thread');
    $('#voiceTime').textContent = '0:00';
    try { await VOICE.start(); } catch (e) { vReply = null; toast('🎙', 'Microphone unavailable: ' + (e.message || e), 3200); return 'none'; }
    return 'recording';
  }

  // Dictation (Right ⌥): speech to text where you're typing. In a text field the words go in at the cursor;
  // anywhere else they land on the clipboard. (Wizard for Mac does this in every app, natively.)
  const editable = el => !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|url|email|)$/i.test(el.type || '')));
  function insertAt(el, text) {
    if (!el || !el.isConnected) return false;
    el.focus({ preventScroll: true });
    if (el.isContentEditable) return document.execCommand('insertText', false, text);
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    const pre = a > 0 && !/\s$/.test(el.value.slice(0, a)) ? ' ' : '';
    el.setRangeText(pre + text, a, b, 'end'); el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  async function dictate(action = 'toggle') {
    if (VOICE.state === 'think') return 'busy';
    if (VOICE.state !== 'idle' && vMode === 'talk') return 'busy';
    if (action === 'cancel') { if (VOICE.state !== 'idle') { VOICE.cancel(); toast('✕', 'Cancelled', 1000); } return 'none'; }
    if (VOICE.state === 'idle') {
      vMode = 'dictate'; vNewChat = false; vTarget = null;
      dTarget = editable(document.activeElement) ? document.activeElement : null;
      $('#voiceTime').textContent = '0:00';
      try { await VOICE.start(); } catch (e) { vMode = 'talk'; toast('🎙', 'Microphone unavailable: ' + (e.message || e), 3200); return 'none'; }
      return 'dictating';
    }
    const r = await VOICE.finish({ transcribe: true });
    vMode = 'talk';
    const text = (r && r.text || '').trim();
    if (!text) { toast('🎙', r?.error ? 'Transcription failed: ' + r.error : 'Didn’t catch that', 2200); return 'none'; }
    window.__wuxLastDictation = text;
    if (insertAt(dTarget, text)) { dTarget = null; return 'inserted'; }
    dTarget = null;
    try { await navigator.clipboard.writeText(text); toast('📋', `Copied: “${clip(text, 60)}” · ⌘V to paste`, 2600); return 'copied'; }
    catch (e) { toast('✎', clip(text, 120), 6000); return 'shown'; }
  }

  // Right ⌘ / Right ⌥ as tap keys: press and release alone, quickly (a chord like ⌘C never counts).
  // Inside Wizard for Mac the native app owns these keys system-wide and sends wizard:orb, so the page stands down.
  const NATIVE_KEYS = !!window.webkit?.messageHandlers?.wizardNative;
  let tapKey = null, tapAt = 0, tapChord = false;
  addEventListener('keydown', e => {
    if (NATIVE_KEYS) return;
    // Pause PWA dictation so the system's Right Option voice tool owns the key.
    // Reversible desktop switches are staged separately; native/OS bindings stay intact.
    if (e.code === 'MetaRight' && !e.repeat) {
      const others = (e.code === 'MetaRight' ? e.altKey : e.metaKey) || e.ctrlKey || e.shiftKey;
      tapKey = e.code; tapAt = performance.now(); tapChord = others; return;
    }
    if (tapKey) tapChord = true;
  }, true);
  addEventListener('keyup', e => {
    if (NATIVE_KEYS || e.code !== tapKey) return;
    const ok = !tapChord && performance.now() - tapAt < 450; tapKey = null;
    if (!ok) return;
    e.preventDefault();
    if (e.code === 'MetaRight') { log('key:right-cmd'); talk(); } else { log('key:right-opt'); dictate(); }
  }, true);
  addEventListener('blur', () => { tapKey = null; });

  /* ---------------- keyboard ---------------- */
  const typing = t => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  let lastWs = cur;
  function dirFocus(dx, dy) {
    const d = ws[cur]; if (d.wins.length < 2) return;
    const me = winEl(d.focus)?.getBoundingClientRect(); if (!me) return;
    const cx = me.left + me.width / 2, cy = me.top + me.height / 2;
    let best = null, bs = Infinity;
    for (const id of d.wins) {
      if (id === d.focus) continue; const r = winEl(id)?.getBoundingClientRect(); if (!r || winEl(id).classList.contains('gone')) continue;
      const x = r.left + r.width / 2 - cx, y = r.top + r.height / 2 - cy;
      if ((dx && Math.sign(x) !== dx) || (dy && Math.sign(y) !== dy)) continue;
      const s = Math.abs(dx ? x : y) + Math.abs(dx ? y : x) * 2; if (s < bs) { bs = s; best = id; }
    }
    if (!best && d.mono) { const i = d.wins.indexOf(d.focus); best = d.wins[(i + (dx || dy) + d.wins.length) % d.wins.length]; }
    if (best) focusWin(best);
  }
  // Esc peels one layer: palette → keys → inbox → voice → thread → (nothing: stays put, never leaves).
  function escStep() {
    if (!pal.hidden) { closePalette(); return 'palette'; }
    if (window.WizWebUpdate?.back()) return 'update-list'; // the update card's thread list folds first
    if (CHATS.KIT?.viewer?.isOpen() && CHATS.KIT.viewer.close()) return 'viewer'; // an image opened from a link sits above the sheet
    if (LINKS && LINKS.isOpen()) { LINKS.back(); return 'link'; }
    if (!keysEl.hidden) { toggleKeys(false); return 'keys'; }
    if (closeUsage()) return 'usage';
    if (setEl && !setEl.hidden) { closeSettings(); return 'settings'; }
    if (!ib.hidden) { closeInbox(); return 'inbox'; }
    const ov = CHATS.closeOverlay(); if (ov) return ov; // media viewer, then the thread actions sheet
    // Leave fullscreen before navigating the app underneath; preserve its thread and draft.
    if (homeOpen) return '';
    if (ws[cur].mono) { toggleMono(); return 'mono'; }
    // Back navigates while recording; only the explicit Cancel control may discard audio.
    const f = focused();
    if (f?.app === 'chats' && f.thread) { const r = CHATS.threadBack(f); syncChatsPane(f.id); winEl(f.id)?.focus({ preventScroll: true }); return r; }
    if (f?.app === 'frame') {
      const result = window.WizAppServices?.back(winEl(f.id)?.querySelector('iframe'));
      if (['handled', 'pending', 'stay'].includes(result)) return 'hosted';
    }
    if (f?.appId === 'app-store' || f?.appId === 'system') {
      if (!ws[cur].mono) { closeWin(f.id); return 'store-parent'; }
    }
    return '';
  }
  function onKey(e, fromFrame = false) {
    const k = e.key, code = e.code, alt = e.altKey && !e.metaKey && !e.ctrlKey, shift = e.shiftKey;
    const digit = /^Digit([1-9])$/.exec(code);
    const hit = fn => { e.preventDefault(); e.stopPropagation(); fn(); };
    // The native Mac menu forwards ⌘W here instead of closing its NSWindow. Always consume at
    // the desktop root too; closing the last internal app leaves an empty workspace.
    if ((e.metaKey || e.ctrlKey) && !(e.metaKey && e.ctrlKey) && !e.altKey && !shift && code === 'KeyW') return hit(() => { if (!e.repeat) closeCurrent(); });
    if (((e.metaKey || e.ctrlKey) && !(e.metaKey && e.ctrlKey) && !e.altKey) || alt) {
      if (code === 'KeyT' && !shift) return hit(() => { if (!e.repeat) { closePalette(); closeInbox(); toggleKeys(false); closeSettings(); closeUsage(); newDesktop(); } });
      if ((e.metaKey || e.ctrlKey) && shift && (code === 'BracketLeft' || code === 'BracketRight')) return hit(() => goWs((cur + (code === 'BracketRight' ? 1 : -1) + ws.length) % ws.length));
    }
    if (e.ctrlKey && !e.metaKey && !e.altKey && code === 'Tab') return hit(() => goWs((cur + (shift ? -1 : 1) + ws.length) % ws.length));
    if (e.metaKey && !e.ctrlKey && !e.altKey && !shift) {
      const direction = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[code];
      if (direction) return hit(() => dirFocus(...direction));
      if (code === 'KeyF') return hit(() => { if (!e.repeat) toggleMono(); });
    }
    if (alt && !shift && (code === 'ArrowUp' || code === 'ArrowDown') && focused()?.app === 'chats') return hit(() => stepThread(focused().id, code === 'ArrowDown' ? 1 : -1));
    // Native ⌘N / Ctrl+N: fresh composer; ⇧ adds new-chat voice. Browser-safe voice: ⌥⇧V.
    // Browser-owned ⌘N/⌘⇧N can stay with the browser; ⌥Enter/⌥⇧V reach Wizard in tabs.
    if (((e.metaKey || e.ctrlKey) && !(e.metaKey && e.ctrlKey) && !e.altKey && code === 'KeyN') || (alt && shift && code === 'KeyV')) return hit(() => {
      if (e.repeat) return;
      closePalette(); closeInbox(); toggleKeys(false); closeSettings(); closeUsage();
      if (shift) talkNew(alt ? `${MOD}⇧V` : `${CMD}⇧N`); else newChat({ fresh: true });
    });
    // ⌘K / Ctrl+K, ⌥Space: palette, from anywhere (even while typing).
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (k === 'k' || k === 'K')) return hit(() => (pal.hidden ? openPalette() : closePalette()));
    if (alt && code === 'Space') return hit(() => (pal.hidden ? openPalette() : closePalette()));
    // Link pane: ⌘Enter keeps it as a window, ⌘⇧Enter opens it in the browser.
    if (LINKS && LINKS.isOpen() && (e.metaKey || e.ctrlKey) && k === 'Enter') return hit(() => LINKS.el.querySelector(shift ? '[data-ls="out"]' : '[data-ls="keep"]')?.click());
    if (k === 'Escape' && LINKS && LINKS.isOpen() && fromFrame) { const did = escStep(); if (did) { e.preventDefault(); e.stopPropagation(); } return; }
    if (k === 'Escape') { const did = escStep(); if (did || fromFrame) { e.preventDefault(); e.stopPropagation(); } log('esc:' + (did || 'root')); return; }
    if (!pal.hidden) return; // the palette owns the keyboard while open
    if (setEl && !setEl.hidden && !(e.altKey && code === 'Comma')) return; // so does Settings (⌥, closes it)
    // Chats: ↑/↓ or j/k walk the thread list (from the list, the search box or an empty thread pane), / focuses search.
    {
      const f = focused(), plain = !e.altKey && !e.metaKey && !e.ctrlKey;
      const inList = !!e.target.closest?.('.pane-list'), inSearch = e.target.matches?.('[data-chsearch]');
      if (f?.app === 'chats' && ib.hidden && keysEl.hidden && plain && !fromFrame) {
        const free = !typing(e.target) || inSearch;
        if (free && (inList || inSearch || !f.thread || e.target === winEl(f.id)) && (k === 'ArrowDown' || k === 'ArrowUp' || (!inSearch && (k === 'j' || k === 'k')))) { if (stepThread(f.id, k === 'ArrowDown' || k === 'j' ? 1 : -1)) return hit(() => {}); }
        if (k === '/' && !typing(e.target)) return hit(() => { const s = winEl(f.id)?.querySelector('[data-chsearch]'); if (s) { s.focus(); s.select(); } });
        if (k === 'Enter' && inSearch) { const r = listRows(f.id)[0]; if (r) return hit(() => { stepThread(f.id, 1); focusInside(f.id); }); }
      }
      // ⌥⇧J / ⌥⇧K: next / previous chat from anywhere in the Chats window, even mid-sentence.
      if (f?.app === 'chats' && e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && (code === 'KeyJ' || code === 'KeyK')) return hit(() => stepThread(f.id, code === 'KeyJ' ? 1 : -1));
    }
    if (!e.altKey || e.metaKey || e.ctrlKey) {
      // Inbox navigation without modifiers.
      if (!ib.hidden && !typing(e.target)) {
        const rows = $$('.ib-row[data-thread]', ib);
        if (k === 'ArrowDown' || k === 'j') return hit(() => { ibSel = Math.min(rows.length - 1, ibSel + 1); renderInbox(); });
        if (k === 'ArrowUp' || k === 'k') return hit(() => { ibSel = Math.max(0, ibSel - 1); renderInbox(); });
        if (k === 'Enter' && rows[ibSel]) return hit(() => { closeInbox(); openThread(rows[ibSel].dataset.thread); });
      }
      return;
    }
    // ⌥ (Option/Alt) keys. Use e.code: on a Mac, ⌥ turns e.key into symbols (⌥V = √).
    // ⌥N past the last desktop is the + slot (James, 14 Oct: "⌥2 should still work with one desktop").
    // It opens a desktop there; ⌥⇧N moves the focused app into that new desktop. Further digits stay inert.
    if (digit) return hit(() => {
      const i = +digit[1] - 1, plus = i === ws.length;
      if (plus && e.repeat) return;
      if (shift) { const f = focused(); if (!f) return; if (plus) ws.push(freshDesk()); moveWin(f.id, i); }
      else if (plus) newDesktop();
      else { lastWs = cur; goWs(i); }
    });
    if (code === 'Enter') return hit(() => newChat({ fresh: shift }));
    if (code === 'KeyI') return hit(() => toggleInbox());
    if (code === 'KeyW') return hit(() => { if (!e.repeat) closeCurrent(); });
    if (code === 'KeyF') return hit(() => { if (!e.repeat) toggleMono(); });
    if (code === 'Slash') return hit(() => toggleKeys());
    if (code === 'Comma') return hit(() => (setEl.hidden ? openSettings() : closeSettings()));
    if (code === 'BracketLeft') return hit(() => { lastWs = cur; goWs((cur - 1 + ws.length) % ws.length); });
    if (code === 'BracketRight') return hit(() => { lastWs = cur; goWs((cur + 1) % ws.length); });
    if (code === 'Tab') return hit(() => { const t = lastWs; lastWs = cur; goWs(t); });
    const dir = { ArrowLeft: [-1, 0], KeyH: [-1, 0], ArrowRight: [1, 0], KeyL: [1, 0], ArrowUp: [0, -1], KeyK: [0, -1], ArrowDown: [0, 1], KeyJ: [0, 1] }[code];
    // ⌥ arrows are word/paragraph jumps while typing on a Mac: leave them to the text field (⌥HJKL still move focus).
    if (dir && /^Arrow/.test(code) && typing(e.target)) return;
    if (dir) return hit(() => { if (shift && dir[0]) swapWin(dir[0]); else dirFocus(dir[0], dir[1]); });
  }
  addEventListener('keydown', e => onKey(e), true);
  // Composer: ⌘/Ctrl+Enter sends (shared Chats binds it); Enter stays a newline, as in the phone.
  const log = s => { window.__wuxLog = (window.__wuxLog || []).concat(s).slice(-40); };

  /* ---------------- browser Back never leaves the app ----------------
   * The desktop has Esc for layers, but a mouse back button or ⌘[ still fires popstate. Keep one guard
   * entry and treat Back as Esc; at the root it stays put and says so. */
  // AppServices owns the single history guard when available. Running both guards
  // peeled two layers and appended a second entry on every Back.
  // Keep the boot sentinel: a direct Home entry must survive Back before the
  // first pointer gesture arms AppServices. Only one popstate consumer is installed.
  if (history.state?.wux !== 'guard') { history.replaceState({ wux: 'root' }, ''); history.pushState({ wux: 'guard' }, ''); }
  if (!window.WizAppServices?.guardBack) {
    addEventListener('popstate', () => {
      const did = escStep(); log('back:' + (did || 'root'));
      history.pushState({ wux: 'guard' }, '');
      if (!did) toast('⌂', 'You’re home · Back never leaves Wizard', 1400);
    });
  }

  /* ---------------- live data ---------------- */
  if (LIVE) LIVE.onChange(() => {
    paintBar(); renderInbox(); CHATS.markVisibleThreadsSeen();
    for (const id of Object.keys(W)) {
      const w = W[id]; if (w.app !== 'chats') continue;
      const el = winEl(id); if (!el) continue;
      const lp = el.querySelector(`[data-chats="${id}::list"]`);
      if (lp && !lp.contains(document.activeElement) && !CHATS.holdList(id + '::list')) CHATS.renderChatList(listWin(id), lp);
      if (w.thread) CHATS.loadThread(w);
      syncChatsPane(id);
    }
    const d = ws[cur]; if (!d.wins.length) { const h = wsEl(cur).querySelector('.home'); if (h) h.innerHTML = homeHtml(cur); }
    if (homeOpen) $('#desktopHome').innerHTML = homeHtml(null);
  });
  OUTBOX?.onChange(() => { renderInbox(); for (const id of ws[cur].wins) { const w = W[id]; if (w?.app === 'chats' && w.thread) { const el = stage.querySelector(`[data-chats="${id}"]`); if (el) CHATS.renderThread(w, el); } } });
  OUTBOX?.onSent((it, res) => {
    if (it.kind === 'new' && LIVE && !LIVE.session(it.sessionId)) {
      LIVE.sessions.unshift({ id: it.sessionId, runtime: 'direct', title: (it.text || 'Voice note').slice(0, 60), status: 'running', runId: res.runId, updatedAt: new Date().toISOString(), lastUserAt: new Date().toISOString(), preview: it.text, source: 'wizard-mobile' });
      LIVE.markSeen(it.sessionId);
    } else if (LIVE?.session(it.sessionId)?.synthetic) LIVE.markSeen(it.sessionId);
    // A reply's thread is already held in Working with its live status by live.js (PEND), until Wizard lists the run.
    if (res.steered) toast('✦', 'Sent · steering the live run', 1600);
    LIVE?.emit(); setTimeout(() => LIVE?.refresh(), 3000);
    for (const id of Object.keys(W)) if (W[id].app === 'chats' && W[id].thread === it.sessionId) setTimeout(() => W[id] && CHATS.loadThread(W[id], true), 1500);
  });
  // Open threads poll a little faster while Archimedes works.
  setInterval(() => { if (document.hidden) return; for (const id of ws[cur].wins) { const w = W[id]; if (w?.app === 'chats' && w.thread && w.thread !== '__new__') CHATS.loadThread(w); } }, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { LIVE?.refresh(); CHATS.markVisibleThreadsSeen(); } });

  /* ---------------- toast ---------------- */
  let toastT = 0;
  function toast(icon, text, ms = 2000) { const t = $('#toast'); t.innerHTML = `<span>${window.WizBrand.icon(esc(icon))}</span><span>${esc(text)}</span>`; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }

  /* ---------------- native bridge (Wizard for Mac drives this by events) ---------------- */
  let dictationFields = null;
  C.bridge.handle({
    orb: d => talk(d.action || 'toggle'),
    open(path, d) {
      const sid = d.thread || (String(path).match(/[?&]session=([^&#]+)/) || [])[1];
      if (sid) return openThread(decodeURIComponent(sid));
      if (/^\/?apps\/?$/.test(path) || /^\/?search\/?$/.test(path)) return openPalette();
      if (/^\/?inbox\/?$/.test(path)) return openInbox();
      if (d.app) return openApp(findApp(d.app) || APP[d.app]);
      if (/^\/wizard\/?(\?.*)?$/.test(path)) return openApp(APP.wizard);
      const base = String(path).replace(/[#?].*$/, '');
      const a = APPS.find(x => x.url && x.url.replace(/[#?].*$/, '') === base);
      if (a) return openApp(a);
      if (path && path.startsWith('/')) newWin({ app: 'frame', url: path, title: path });
    },
    dictation(text) {
      const fields = dictationFields || (dictationFields = window.WizCore.focusedField.create({
        frames: () => $$('iframe', stage).filter(f => { const w = W[f.closest('[data-win]')?.dataset.win]; return !!APP[w?.appId]; }),
        admit: (c, el) => { const win = c.frame?.closest('[data-win]') || el.closest('[data-win]'); return (!win || win.dataset.win === ws[cur].focus) && !!el.getClientRects().length; },
      }));
      const target = fields.capture();
      if (target) { fields.insert(target, text); target.release(); return; }
      const f = focused();
      if (f?.app === 'chats' && f.thread && CHATS.insertText(f.id, text)) return;
      if (f?.app === 'chats') { newChat(); setTimeout(() => CHATS.insertText(focused().id, text), 60); return; }
    },
    back() { const did = escStep(); log('native-back:' + (did || 'root')); },
  });

  /* ---------------- deep links + boot ---------------- */
  render();
  // In-app browser (core/links.js): links tapped in Wizard open in a right-half pane.
  const LINKS = window.WizLinks ? window.WizLinks.mount({
    parent: document.body, mode: 'pane',
    onKeep: (url, title) => { const a = APPS.find(x => x.url && x.url.replace(/[#?].*$/, '') === url.replace(/[#?].*$/, '')); if (a) openApp(a, { fresh: false }); else newWin({ app: 'frame', url, title }); },
  }) : null;
  if (LINKS) window.WizLinks.intercept(document.body, LINKS);
  LIVE?.refresh();
  /* Deep links (core/deeplink.js): ?session= opens the thread in a Chats window, ?view= a screen, ?video= the player.
   * Back/Esc then walks thread → list → stays; the page is never left. */
  C.deeplink.handle({
    thread: sid => openThread(sid),
    view(v, section) {
      if (v === 'home') return goHome();
      if (v === 'inbox') return openInbox();
      if (v === 'apps') return openPalette();
      if (v === 'store') return openApp(APP['app-store']);
      if (v === 'system') return openApp(APP.system);
      if (v === 'settings' || v === 'usage') return openSettings();
      if (v === 'files') { const a = findApp('files') || APP.files; if (a) return openApp(a); return toast('◇', 'Files isn’t on this Wizard', 1800); }
      if (v === 'day' || v === 'week' || v === 'month') { const a = APP['v-' + v]; if (a?.url) return openApp(a); }
      openApp(APP.wizard);
      { const f = focused(); if (f?.app === 'chats' && f.thread) { CHATS.chatsBack(f); syncChatsPane(f.id); } }
      const show = (tries = 50) => { const f = focused(); const sec = f && winEl(f.id)?.querySelector(`.pane-list [data-sec="${section}"]`); if (!sec) { if (tries > 0) setTimeout(() => show(tries - 1), 100); return; } if (!sec.classList.contains('open')) sec.querySelector('[data-sectoggle]')?.click(); winEl(f.id)?.querySelector(`.pane-list [data-sec="${section}"]`)?.scrollIntoView({ block: 'start' }); };
      if (section) show();
    },
    app(id) {
      const a = APP[id] || findApp(id); if (a) return openApp(a);
      // Cold launch: the registered app list may still be loading. The same deep link must work in either shell.
      Promise.resolve(C.appsLoaded?.()).then(() => { const b = APP[id] || findApp(id); if (b) openApp(b); });
    },
    video: item => CHATS.KIT.viewer.open([item]),
    toast,
  });
  C.deeplink.consume();
  C.status?.attach({ openInbox, inboxOpen: () => !ib.hidden, current: () => { const f = focused(); return f?.app === 'chats' && f.thread !== '__new__' ? f.thread || '' : ''; } });
  const f0 = focused(); if (f0) setTimeout(() => focusInside(f0.id), 50);

  /* "Update ready" pill in the top bar: the same banner as the phone (core/web-update.js), names the thread that made the
   * update with a Thread button that opens it in a window here; Reload is held while recording or uploading. */
  window.WizWebUpdate?.init({
    shell: 'desktop', log: (...a) => { window.__wuxLog = (window.__wuxLog || []).concat(a.join(' ')).slice(-80); },
    mount: () => document.querySelector('#bar .bar-r') || document.body, prepend: true,
    openThread: sid => openThread(sid),
    busy: () => VOICE.state !== 'idle' || Object.values(W).some(win => (CHATS.ch(win.id)?.files || []).some(f => f.uploading)),
    beforeReload: () => { for (const el of document.querySelectorAll('[data-compose]')) el.dispatchEvent(new Event('input', { bubbles: true })); },
    toast,
  });
  window.__wux = {
    get links() { return LINKS; },
    shell: 'desktop', get ws() { return ws; }, get wins() { return W; }, get cur() { return cur; }, live: LIVE, outbox: OUTBOX, chats: CHATS,
    get homeOpen() { return homeOpen; }, goHome,
    goWs, newDesktop, closeDesktop, closeCurrent, newWin, closeWin, focusWin, moveWin, openApp, openThread, newChat, openPalette, closePalette, openInbox, talk, ask, escStep, viewContext,
    openFiles, openUsage, recordReply,
    openSettings, closeSettings, stepThread, setListW, get listW() { return listW(); },
    get voice() { return VOICE.state; }, get log() { return window.__wuxLog || []; },
  };
  window.WizAppServices?.guardBack(() => {
    const did = escStep(); log('back:' + (did || 'root'));
    if (!did) toast('⌂', 'You’re home · Back never leaves Wizard', 1400);
    return true;
  }, toast);
})();
