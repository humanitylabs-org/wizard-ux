/* Wizard UX core: Chats › the Space picker, the Focus strip and Activity's list and order.
 * Moved verbatim out of core/chats.js
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
window.WizCore.chatsParts.spaces = function ({ chanTags, actNeeds, actUnread, inboxRowsBody, inboxRowsClick, inboxRowsOn, agentRec, AGS, ch, CH, CHAN_STORE_MAX, chanAt, chanEmojiPick, chanEmojiSync, chanEmojiTap, chanOpen, chanStore, chanTarget, chanToEnd, chatRow, chatVars, esc, fileInGeneral, fileInSpace, focusAgents, focusOf, focusOptions, H, LIVE, norm, noteAt, noteRow, openChannel, owner, READY_ORDER_KEY, renderChatList, rerenderList, runningOpen, SEC_PAGE, setFocus, SPACE, spaceAgent, spaceContains, spaceMember, spaces, spacesOf, storeAgent, toast, W, winAgent }) {
  let elOf, idOf, renderChats, sendChat; // late-bound: chats.js declares these after the call, see bindLate
  function closeSpacePicker() {
    if (!chatVars.spacePicker) return false;
    const old = chatVars.spacePicker; chatVars.spacePicker = null;
    document.querySelector('[data-chspacepicker]')?.remove();
    old.tab?.setAttribute('aria-expanded', 'false');
    if (old.tab?.isConnected) old.tab.focus({ preventScroll: true });
    return true;
  }
  function openSpacePicker(w, agent, tab, { naming = false, sid = '', from = '', direct = false } = {}) {
    if (!focusAgents().some(a => a.id === agent)) return;
    closeSpacePicker();
    chatVars.spacePicker = { wid: owner(w.id), from, direct, agent, tab, naming, sid, busy: false, error: '', name: '' };
    renderSpacePicker();
  }
  function renderSpacePicker() {
    const p = chatVars.spacePicker; if (!p) return;
    document.querySelector('[data-chspacepicker]')?.remove();
    const w = W[p.wid], a = agentRec(p.agent), opts = focusOptions(), f = focusOf(w);
    if (!w || !focusAgents().some(a => a.id === p.agent)) { closeSpacePicker(); return; }
    const rows = opts.filter(o => o.kind === 'space' && spaceAgent(spaces().find(s => s.id === o.key)) === p.agent).sort((a, b) => b.recent - a.recent);
    const allOn = f?.kind === 'agent' && f.key === p.agent;
    // Channels: General is a place too (a chat in no channel), last as in the channel list, marked when it is there.
    const genOn = !!p.sid && SPACE.ch && !spacesOf(p.sid).length;
    // Tags on (wizard-agent-service issue 608, switch wizard/chat-tags): a chat's picker is its tags, several at once; a
    // tap adds or removes one and the sheet stays open. General reads "No tags".
    const tags = typeof chanTags === 'function' && chanTags();
    const gen = p.sid && SPACE.ch ? `<button type="button" class="ch-fopt${genOn ? ' on' : ''}" data-spgeneral aria-pressed="${genOn}"><span>${tags ? 'No tags' : 'General'}</span><small></small>${genOn ? '<b>✓</b>' : ''}</button>` : '';
    const pickTitle = tags ? 'Tags' : SPACE.ch ? 'Move to channel' : p.sid && spacesOf(p.sid).length ? `Move to ${SPACE.one}` : `Add to a ${SPACE.one}`;
    const wrap = document.createElement('div'); wrap.dataset.chspacepicker = '';
    wrap.className = 'ch-space-shade';
    wrap.innerHTML = `<div class="ch-space-picker" role="dialog" aria-modal="true" aria-label="${p.sid ? pickTitle : esc(a.label) + (SPACE.ch ? ' channels' : ' Spaces')}" style="--ch-agent-colour:${AGS()?.colour(a) || ''}"><div class="ch-space-grab" aria-hidden="true"></div><header><i></i><b>${p.sid ? pickTitle : p.direct ? (tags ? 'New tag' : 'New channel') : esc(a.label)}</b><button type="button" data-spclose aria-label="Close ${SPACE.ch ? 'channels' : 'Spaces'}">×</button></header><div class="ch-space-rows">${p.sid || p.direct ? '' : `<button type="button" class="ch-fopt${allOn ? ' on' : ''}" data-spall aria-pressed="${allOn}"><span>All ${esc(a.label)} chats</span>${allOn ? '<b>✓</b>' : ''}</button>`}${(p.direct ? [] : rows).map(o => { const on = p.sid ? spaceContains(o.key, p.sid) : f?.kind === 'space' && f.key === o.key; return `<button type="button" class="ch-fopt${on ? ' on' : ''}" data-spspace="${esc(o.key)}" aria-pressed="${on}"><span>${esc(o.label)}</span><small>${o.unread || ''}</small>${o.unread ? '<i class="ch-focus-dot" aria-label="Unread"></i>' : ''}${on ? '<b>✓</b>' : ''}</button>`; }).join('')}${gen}</div>${p.naming ? `<form class="ch-space-form"><label for="chSpaceName">${tags ? 'New tag' : SPACE.ch ? 'New channel' : 'New space'}</label><div><input id="chSpaceName" name="name" maxlength="60" placeholder="${tags ? 'Tag name' : SPACE.ch ? 'Channel name' : 'Space name'}" value="${esc(p.name)}" autocomplete="off" ${p.busy ? 'disabled' : ''}><button type="submit" ${p.busy || !p.name.trim() ? 'disabled' : ''}>${p.busy ? 'Creating…' : 'Create'}</button></div>${SPACE.ch && !p.busy && typeof chanEmojiPick === 'function' ? chanEmojiPick(p.name) : ''}${p.error ? `<p role="alert">${esc(p.error)}</p>` : ''}</form>` : '<button type="button" class="ch-space-new" data-spnew>' + (tags ? '+ New tag' : SPACE.ch ? '+ New channel' : '+ New space') + '</button>'}</div>`;
    document.body.appendChild(wrap);
    const card = wrap.firstElementChild, strip = p.direct ? null : p.tab?.closest('.ch-focus-strip') || elOf(p.wid)?.querySelector('.ch-focus-strip'), r = strip?.getBoundingClientRect(), tr = p.tab?.getBoundingClientRect();
    if (r?.height && r.top > 0 && r.top < innerHeight) { card.style.bottom = `${Math.max(8, innerHeight - r.top + 8)}px`; if (innerWidth > 640) card.style.left = `${Math.max(8, Math.min(tr?.left || r.left, innerWidth - 296))}px`; }
    // Wide screens with no strip to sit on (a feed's or an Activity row's Move to channel…): a card in the middle, not a
    // full-width bar along the bottom; the phone keeps its bottom sheet.
    else if (innerWidth > 640) Object.assign(card.style, { left: '50%', right: 'auto', top: '50%', width: 'min(360px, calc(100vw - 16px))', transform: 'translate(-50%, -50%)' });
    if (!card.style.bottom && !card.style.top) card.style.bottom = 'max(16px, env(safe-area-inset-bottom))';
    p.tab?.setAttribute('aria-expanded', 'true');
    wrap.addEventListener('click', e => {
      if (e.target === wrap && Date.now() < chatVars.focusHoldUntil) { e.preventDefault(); return; }
      if (e.target === wrap || e.target.closest('[data-spclose]')) { closeSpacePicker(); return; }
      if (p.busy) return;
      const em = e.target.closest('[data-chemoji]'); if (em) { chanEmojiTap(em); return; }
      if (e.target.closest('[data-spnew]')) { p.naming = true; renderSpacePicker(); return; }
      const s = e.target.closest('[data-spspace]');
      // Tags on: the sheet stays open, showing the chat's tags as they are now.
      const keep = typeof chanTags === 'function' && chanTags(), after = () => { if (keep && chatVars.spacePicker === p) renderSpacePicker(); };
      if (e.target.closest('[data-spgeneral]') && p.sid) { if (!keep) closeSpacePicker(); if (fileInGeneral(p.sid, p.agent)) for (const x of Object.keys(CH)) { const ww = W[x]; if (ww && !ww.thread) rerenderList(ww); } after(); return; }
      if (s && p.sid) { if (!keep) closeSpacePicker(); if (fileInSpace(s.dataset.spspace, p.sid, p.agent)) for (const x of Object.keys(CH)) { const ww = W[x]; if (ww && !ww.thread) rerenderList(ww); } after(); return; }
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
    requestAnimationFrame(() => { if (chatVars.spacePicker === p) (wrap.querySelector('input:not(:disabled)') || wrap.querySelector('[aria-pressed="true"]') || wrap.querySelector('button'))?.focus({ preventScroll: true }); });
  }
  async function createPickerSpace(p) {
    if (p !== chatVars.spacePicker || p.busy) return;
    const typed = p.name.trim();
    if (!typed || typed.length > 60 || /[\u0000-\u001f\u007f]/u.test(typed)) return;
    // Auto channel emoji (issue 1580, switch wizard/channel-auto-emoji, off by default): no emoji in front gets a fitting
    // one from the keyword map (or none, shown as 💬). An added emoji never makes a second channel of the same words:
    // "Money" is refused next to "Money", "💰 Money" or "🎯 Money". Switch off: the name is stored exactly as typed.
    let autoOn = false; try { autoOn = (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/channel-auto-emoji'); } catch (_) {}
    const name = autoOn && SPACE.ch && typeof globalThis.WizCore?.channelAutoName === 'function' ? globalThis.WizCore.channelAutoName(typed) : typed;
    const words = n => name !== typed ? globalThis.WizCore.channelFace(n).label : n;
    if (spaces().some(s => spaceAgent(s) === p.agent && (norm(s.name) === norm(name) || norm(words(s.name)) === norm(typed))) || (norm(name) === 'general' && SPACE.ch)) { p.error = SPACE.ch ? 'Already a channel' : 'Already a Space'; renderSpacePicker(); return; }
    // The channel store (wizard-ux issue 1261) holds 200 channels per agent and gives the new one its id.
    const onStore = typeof chanStore === 'function' && !!chanStore();
    if (onStore ? spaces().filter(s => spaceAgent(s) === p.agent).length >= CHAN_STORE_MAX : spaces().length >= 50) { p.error = onStore ? `Maximum ${CHAN_STORE_MAX} channels` : SPACE.ch ? 'Maximum 50 channels' : 'Maximum 50 Spaces'; renderSpacePicker(); return; }
    p.busy = true; p.error = ''; renderSpacePicker();
    let space = { id: crypto.randomUUID(), name, agent: p.agent, threads: p.sid ? [p.sid] : [], createdAt: new Date().toISOString() }, saved;
    if (onStore) { const c = await LIVE.chanStore.create(name, storeAgent(p.agent)); saved = !!c; if (c) { space = { ...space, id: c.id }; if (p.sid) spaceMember(c.id, p.sid, true, p.agent); } }
    else saved = await LIVE.prefOps([{ op: 'add', key: 'spaces', item: space }], { requireShared: true });
    if (!saved) { p.busy = false; p.error = SPACE.ch ? 'Couldn’t create channel. Try again.' : 'Couldn’t create space. Try again.'; if (chatVars.spacePicker === p) renderSpacePicker(); return; }
    if (chatVars.spacePicker === p) closeSpacePicker();
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
        timer = setTimeout(() => { if (!held) return; const t = held.tab; cancel(); chatVars.focusHoldUntil = Date.now() + 750; open(t); }, 450);
      });
      strip.addEventListener('pointermove', e => { if (held && Math.hypot(e.clientX - held.x, e.clientY - held.y) > 8) cancel(); }, { passive: true });
      for (const type of ['pointerup', 'pointercancel', 'pointerleave']) strip.addEventListener(type, cancel, { passive: true });
      strip.addEventListener('contextmenu', e => { const t = e.target.closest('[data-chfocusopt^="agent:"]'); if (t) { e.preventDefault(); cancel(); chatVars.focusHoldUntil = Date.now() + 300; open(t); } });
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
  const listSig = w => { const f = focusOf(w), cv = chanOpen(w)?.id || chatVars.chanView; return [winAgent(w), f ? f.kind + ':' + f.key : '', ch(w.id).filter || '', norm(ch(w.id).q)].concat(cv ? [cv] : [], ch(w.id).running && typeof runningOpen === 'function' && runningOpen(w) ? ['running'] : []).join('|'); };
  /* Stored list places and Activity's Ready counts; core/chats-ready.js. */
  const { ACT_SORTS, inboxKeep, inboxPlace, listSaveT, queueListPlace, storedListPlace } = window.WizCore.chatsParts.ready({ actNeeds, actUnread, CH, chanAt, elOf: (...a) => elOf(...a), H, LIST_PLACE_KEY, LIST_PLACE_TTL, listPlace, listSig, LIVE, W });
  let actOlder = false;
  // Activity with nothing in it (a fresh box): one deliberate empty state, never a stack of empty sections (issue 1731).
  const actEmpty = () => '<div class="ch-empty ch-act-empty"><b>No chats yet</b><span>Tap + to start one, or tap the orb and talk.</span><button type="button" class="ch-fclear" data-chnew data-chemptynew>New chat</button></div>';
  function activityBody(w, rows, nt, drafts = 0) {
    // Inbox rows (wizard-ux issue 1779, switch wizard/inbox-rows): only what needs him, as Signal-style rows.
    if (typeof inboxRowsOn === 'function' && inboxRowsOn(w)) return inboxRowsBody(w, rows, nt, drafts);
    const M = window.WizChatsListModel, c = ch(w.id), order = M.activitySortOf(chatVars.readyOrder);
    const keep = typeof inboxKeep === 'function' && inboxKeep(); // Inbox until archived (wizard-ux issue 1810)
    const g = M.activityGroups(LIVE.workGroups(rows), { needs: actNeeds, unread: actUnread, at: chanAt }, { order, now: Date.now(), older: actOlder, keep, place: keep && typeof inboxPlace === 'function' ? inboxPlace() : null });
    // (Inbox or Sent, wizard-ux issue 1829: with keep on a thread is in Inbox or in Sent, never both; no Working section.)
    // Alerts set to Chats: the unread ones wait in Ready with the chats (an urgent one counts as Needs you), read ones in Recent.
    const pick = (list, notes) => list.map(v => ({ id: v.id, v })).concat((notes || []).map(v => ({ id: 'notif:' + v.id, v, n: true })));
    const at = x => x.n ? noteAt(x.v) : chanAt(x.v), needs = x => x.n ? M.notificationRow(x.v).rank === 1 : actNeeds(x.v);
    // With Inbox until archived there is no Recent: a read (kept) alert waits with Snoozed, as on the AI apps sidebar.
    const ready = M.activitySort(pick(g.ready, nt?.awake), order, { at, needs }), recent = keep ? [] : M.activitySort(pick(g.recent, nt?.later), 'newest', { at });
    const snoozed = keep ? M.activitySort(pick(g.snoozed, nt?.later), 'newest', { at }) : g.snoozed.map(v => ({ id: v.id, v }));
    const row = x => x.n ? noteRow(x.v) : chatRow(x.v, null);
    const page = (k, list) => { const shown = c.more?.[k] ? list : list.slice(0, SEC_PAGE); return shown.map(row).join('') + (list.length > shown.length ? `<button class="ch-more" data-secmore="${k}">Show all ${list.length}</button>` : ''); };
    // side = a control on the header line beside the fold button (a button cannot hold a select)
    const sec = (k, label, n, inner, open = !!chatVars.secOpen[k], side = '') => { const h = `<button class="ch-sec-h" data-sectoggle="${k}" aria-expanded="${open}"><span>${label}</span>${n ? `<small>${n}</small>` : ''}<i aria-hidden="true"></i></button>`;
      return `<section class="ch-sec ch-act${open ? ' open' : ''}" data-sec="${k}">${side ? `<div class="ch-sec-hl">${h}${side}</div>` : h}${open ? `<div class="ch-sec-b">${inner()}</div>` : ''}</section>`; };
    // The one sort is a compact menu on Ready's header line (wizard-ux issue 1354), like the AI apps sidebar's: no pill row.
    // With the title bar (wizard-ux issue 1836) the sort is in the filter sheet, and Ready/Inbox loses its section row when
    // it is the list's first section; the bar shows its count.
    const actTitled = c.tbar === 'inbox';
    const sortSel = actTitled ? '' : `<label class="ch-act-sort"><select data-chactorder aria-label="Sort ${keep ? 'Inbox' : 'Ready'}">${ACT_SORTS().map(([v, l]) => `<option value="${v}"${order === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
    const older = g.older ? `<button class="ch-more ch-act-older" data-chactolder>Show older · ${g.older}</button>` : '';
    // Sends a graceful restart holds: their own Saved heading, only while there are any (wizard-ux issue 1362).
    const heldRow = s => !!globalThis.WizReach?.restartHeld?.(s), saved = g.working.filter(heldRow), working = g.working.filter(s => !heldRow(s));
    if (actTitled) c.inboxN = ready.length;
    // A section shows only while it holds something (wizard-ux issue 1731): no empty headers, lines, pills or sort menu.
    // Nothing at all: one empty state with a way to start a chat; nothing but drafts: the Drafts section above says it.
    if (!working.length && !saved.length && !ready.length && !recent.length && !g.older && !snoozed.length && !g.archive.length) return drafts ? '' : actEmpty();
    return (working.length ? sec('working', 'Working', working.length, () => working.map(s => chatRow(s, null)).join('')) : '')
      + (saved.length ? sec('saved', 'Saved', saved.length, () => saved.map(s => chatRow(s, null)).join(''), chatVars.secOpen.saved !== false) : '')
      + (ready.length ? (actTitled && !working.length && !saved.length ? `<section class="ch-sec ch-act ch-tb-main open" data-sec="ready"><div class="ch-sec-b">${page('ready', ready)}</div></section>` : sec('ready', keep ? 'Inbox' : 'Ready', ready.length, () => page('ready', ready), !!chatVars.secOpen.ready, sortSel)) : '')
      + (recent.length || g.older ? sec('recent', 'Recent', 0, () => page('recent', recent) + older) : '')
      + (snoozed.length ? sec('snoozed', 'Snoozed', snoozed.length, () => page('snoozed', snoozed)) : '')
      + (g.archive.length ? sec('archived', 'Archived', g.archive.length, () => page('archived', g.archive.map(v => ({ id: v.id, v })))) : '');
  }
  // The sort and Show older taps (Activity with Channels on); false = not one of them.
  function activityClick(e, w) {
    if (!w || w.thread) return false;
    if (typeof inboxRowsClick === 'function' && inboxRowsClick(e, w)) return true;   // a row's Archive (issue 1779)
    if (e.target.closest('[data-chactorder]')) return true;   // the sort menu: its change event picks (actSetOrder)
    if (e.target.closest('[data-chactolder]')) { actOlder = true; renderChatList(w, elOf(w.id)); return true; }
    return false;
  }
  // Ready's sort menu picked an order: stored as Chats' own Ready order (this device and the box), every list repaints.
  function actSetOrder(v) {
    if (!['newest', 'oldest', 'priority'].includes(v)) return;
    chatVars.readyOrder = v; try { localStorage.setItem(READY_ORDER_KEY, v); } catch (_) {} LIVE.putPrefs?.({ readyOrder: v });
    for (const x of Object.keys(CH)) { const ww = W[x]; if (ww && !ww.thread) renderChats(ww); }
  }
  return { activityBody, activityClick, actSetOrder, anchorListPlace, bindFocusStrip, closeSpacePicker, holdListPlace, listPlace, listSaveT, openSpacePicker, queueListPlace, restoreListPlace, storedListPlace, bindLate: v => { if ('elOf' in v) elOf = v.elOf; if ('idOf' in v) idOf = v.idOf; if ('renderChats' in v) renderChats = v.renderChats; if ('sendChat' in v) sendChat = v.sendChat; } };
};
