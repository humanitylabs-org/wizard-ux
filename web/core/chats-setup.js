/* Wizard UX core: Chats › setup: chat-kit names, incognito chats, Pins (and the Pins setting), Boomerang, topic
 * emojis, working / ago text, the two list layouts and the one Focus. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.setup = function ({ AGS, attOf, ch, chanStoreMove, chanStoreSpaces, chatsBack, deferredOf, elOf, focusAgents, growTa, LIVE, norm, rerenderList, toast, W }) {
  let renderChats, snoozeLast; // late-bound: chats.js declares these after the call, see bindLate
  // Parsing, Markdown, local time, drafts, copy/share and the media viewer live in chat-kit.js.
  const KIT = window.WosChat;
  const INC = window.WizCore.incognitoChats?.({ win: id => W[id], elOf: id => elOf(id), paint: id => { const w = W[id]; if (w) renderChats(w); }, grow: growTa, toast, kit: KIT });
  // Pins (core/chat-pins.js, synced per owner) and Boomerang (core/scheduled-reminders.js, loads after this file).
  const PIN0 = window.WosChatPins || { has: () => false, toggle: () => false, partition: rows => ({ pinned: [], rest: rows }) };
  // Pins can be turned off in the Filter sheet (View › Pins): no Pinned section, no Pin in the menu, no row pin. Saved
  // pins are kept, so turning Pins back on restores them.
  const PINS_KEY = 'wos.chats.pins.v1';
  const pinsOn = () => { try { return localStorage.getItem(PINS_KEY) !== '0'; } catch (e) { return true; } };
  // The retired miguel/hidden-pin tweak becomes this setting once: a device that wore it starts with Pins off.
  try {
    if (localStorage.getItem(PINS_KEY) == null) {
      const v = JSON.parse(localStorage.getItem('wos.skin-tweaks.v1') || '{}'), id = 'miguel/hidden-pin';
      const chosen = localStorage.getItem('wos.skin'), S = window.WosSkin;
      const family = chosen && (S?.families || []).find(f => f.id === S.familyOf?.(chosen));
      const owner = typeof v.preset === 'string' ? v.preset : family?.tweaks;
      const offs = Array.isArray(v.carry) ? v.carry : Array.isArray(v.off?.miguel) ? v.off.miguel : [];
      const hidden = v.mix?.[id] === true || (owner === 'miguel' && v.mix?.[id] !== false && !offs.includes(id));
      if (hidden) localStorage.setItem(PINS_KEY, '0');
    }
  } catch (e) {}
  const paintPins = () => { try { if (pinsOn()) delete document.documentElement.dataset.pins; else document.documentElement.dataset.pins = 'off'; } catch (e) {} };
  paintPins();
  // Thread tracker (tweak, off by default): strip, row dots, Reply. Read from globalThis, only when something asks.
  const PIN = { ...PIN0, on: pinsOn, has: id => pinsOn() && PIN0.has(id), toggle: id => PIN0.toggle(id), partition: (rows, keep) => pinsOn() ? PIN0.partition(rows, keep) : { pinned: [], rest: rows } };
  const BOOM = () => window.WosBoomerang || null;
  const PIN_SVG = '<svg class="ch-pin-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5-4 2-3 5-2-2-5 5-1-1 5-5-2-2 5-3 2-4Z"/></svg>';
  const TOPIC = window.WosTopicEmoji;
  // Topic emojis on Chats rows are a Novairecito skin feature (Noir + Sepia palettes; James, 22 Oct 2026).
  // Every other skin keeps the stock status icon, draft pencil and row sheet exactly as before.
  const TOPIC_SKINS = ['novairecito', 'sepia'];
  const topicOn = () => !!TOPIC && TOPIC_SKINS.includes(document.documentElement.dataset.skin || '');
  const toTurns = KIT.parseRows, md = KIT.md;
  const WORKING_ST = new Set(['submitting', 'queued', 'running', 'stopping']);
  const isWorking = s => !!s && !s.archived && WORKING_ST.has(s.status) && !(s.status === 'queued' && s.queueReason === 'provider_access');
  // Same sections, order and day boundaries as Wizard's Work view.
  // Deferred threads live at the bottom of Ready with a Deferred status (live.js groupWork), not in a section.
  const STALE_LIST = 60000; // the list re-reads every 15 s; older than a minute means a read is failing or hung
  const agoText = t => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  // Two chat-list layouts (18 Oct 2026). By day (default): Ready is today, then Yesterday and Past week.
  // By status (Miguel's): Working, Ready, Archive only, kept short by auto-archive. Chosen in the Filter sheet.
  const SECTIONS_DAY = [['errors', 'Errors'], ['working', 'Working'], ['saved', 'Saved'], ['ready', 'Ready'], ['yesterday', 'Yesterday'], ['pastWeek', 'Past week'], ['deferred', 'Snoozed'], ['archive', 'Archive']];
  const SECTIONS_STATUS = [['errors', 'Errors'], ['working', 'Working'], ['saved', 'Saved'], ['ready', 'Ready'], ['deferred', 'Snoozed'], ['archive', 'Archive']];
  const byStatus = () => LIVE.chatLayout === 'status';
  const SEC_OPEN_KEY = 'wos.chats.sections.v1';
  /* One persistent Focus (All / agent / owner-created Space), one temporary status chip and search text combine (AND).
   * Filter suggestions and the shared held/typed command grammar set these same values.
   * Back clears search/status, never the window's Focus mode. */
  const STATUS = {
    unread: { label: 'Unread', syn: ['new', 'unseen', 'unread messages', 'unread chats', 'unread threads'], empty: 'All caught up. Nothing unread.', ids: ag => { const g = LIVE.groups(ag || ''); return new Set(g.needs.concat(g.ready).map(x => x.id)); } },
    needs: { label: 'Needs you', syn: ['needs me', 'need me', 'waiting on me', 'waiting', 'approval', 'approvals', 'approval needed', 'blocked'], empty: 'Nothing is waiting on you.', test: s => !window.WizChatsListModel.isListWorking(s) && !(snoozeLast() && deferredOf(s) && !isWorking(s)) && (['waiting_for_approval', 'unknown'].includes(s.status) || (!deferredOf(s) && attOf(s)?.state === 'needs_you')) },
    check: { label: 'Check', syn: ['qa', 'q a', 'test', 'to test', 'review', 'to review', 'your call', 'judge'], empty: 'Nothing to check right now.', test: s => !deferredOf(s) && attOf(s)?.state === 'check' },
    working: { label: 'Working', syn: ['running', 'in progress', 'busy', 'active'], empty: 'Nothing is working right now.', ids: ag => new Set((LIVE.workGroups(ag ? LIVE.sessionsFor(ag) : undefined).working || []).filter(x => !globalThis.WizReach?.restartHeld?.(x)).map(x => x.id)) }, // a send a restart holds is Saved (issue 1362)
    yesterday: { label: 'Yesterday', syn: ['from yesterday'], empty: 'Nothing from yesterday.', ids: ag => new Set((LIVE.workGroups(ag ? LIVE.sessionsFor(ag) : undefined).yesterday || []).map(x => x.id)) },
    deferred: { label: 'Snoozed', syn: ['snooze', 'defer', 'deferred', 'later', 'boomerang', 'parked'], empty: 'Nothing snoozed.', test: s => deferredOf(s) || Boolean(BOOM()?.nextFor(s.id)) },
  };
  const FILTERS = STATUS; // app.js (Home cards) names a status filter
  const statusEntries = () => Object.entries(STATUS).filter(([k]) => !(snoozeLast() && k === 'deferred'));
  const subjectOf = s => String(s.attention?.subject || '').trim();
  function subjects() {
    const n = new Map(); for (const s of (LIVE.ok ? LIVE.unified() : [])) { if (s.hidden) continue; const k = subjectOf(s); if (k) n.set(k, (n.get(k) || 0) + 1); }
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  }
  /* Names → filter, for typed suggestions and the voice grammar: exact name or synonym first, then prefix. */
  function matchFilters(text, max = 3) {
    const q = norm(text); if (!q) return [];
    const out = [], seen = new Set(), push = f => { const k = f.kind + ':' + f.key; if (!seen.has(k)) { seen.add(k); out.push(f); } };
    const st = statusEntries().map(([key, f]) => ({ kind: 'status', key, label: f.label, names: [norm(f.label), ...f.syn.map(norm)] }));
    const sj = visibleSpaces().map(s => ({ kind: 'space', key: s.id, label: s.name, names: [norm(s.name)] }));
    const ag = focusAgents().map(a => ({ kind: 'agent', key: a.id, label: a.label, names: [norm(a.id), norm(a.label)] }));
    for (const f of st.concat(ag, sj)) if (f.names.includes(q)) push(f);
    if (q.length >= 2) for (const f of st.concat(ag, sj)) if (f.names.some(n => n.startsWith(q) || n.split(' ').some(w => w.length > 2 && w.startsWith(q)))) push(f);
    return out.slice(0, max);
  }
  function setFilter(w, f) { // a status key, or '' for none (the Home cards)
    const c = ch(w.id), next = f && STATUS[f] && !(snoozeLast() && f === 'deferred') ? f : '';
    if ((c.filter || '') === next && !w.thread) return false;
    if (w.thread) chatsBack(w);
    c.filter = next; if (next) c.q = '';
    rerenderList(w); return true;
  }
  // Focus belongs to the persisted owner window, never the transient desktop list pane / search state.
  // One UI vocabulary entry: rename this if the product term changes.
  const SPACE = { one: 'Space', many: 'Spaces', ch: true }, // ch: Channels wording (on for everyone, wizard-ux issue 1258)
    SPACES_KEY = 'wos.chats.spaces.v1';
  let spacesRaw = null, spacesCache = [], spaceThreads = new Map(), spacesStore = null;
  function spaces() {
    let raw = null; try { raw = localStorage.getItem(SPACES_KEY); } catch (_) {}
    if (raw !== spacesRaw) {
      spacesRaw = raw;
      try { const v = JSON.parse(raw || '[]'); spacesCache = Array.isArray(v) ? v.filter(s => s && typeof s.id === 'string' && typeof s.name === 'string' && Array.isArray(s.threads)) : []; } catch (_) { spacesCache = []; }
      spaceThreads = new Map(spacesCache.map(s => [s.id, new Set(s.threads)]));
    }
    // Channels on the Agent Service store (wizard-ux issue 1261): the store's channels, each with
    // its members, in the shape of a Space; else (switch off, store off, older service) the Spaces as before.
    spacesStore = typeof chanStoreSpaces === 'function' ? chanStoreSpaces(spacesCache) : null;
    return spacesStore ? spacesStore.list : spacesCache;
  }
  const spaceAgent = s => s?.agent || AGS()?.defaultId() || 'hermes';
  const visibleSpaces = () => spaces().filter(s => focusAgents().some(a => a.id === spaceAgent(s)));
  const focusedAgent = f => f?.kind === 'agent' ? f.key : f?.kind === 'space' ? spaceAgent(spaces().find(s => s.id === f.key)) : '';
  function spaceContains(key, sid) { spaces(); return (spacesStore ? spacesStore.sets : spaceThreads).get(key)?.has(sid) || false; }
  // A chat is in one Space of its agent at a time (James, 29 Oct 2026); more only in data an older box wrote.
  const spacesOf = sid => { const ag = LIVE.agentOf(sid) || AGS()?.defaultId() || 'hermes'; return spaces().filter(s => spaceAgent(s) === ag && spaceContains(s.id, sid)); };
  // agent: the chat's own agent when the caller knows it (the store files by agent plus id).
  function spaceMember(key, sid, add, agent) {
    if (typeof chanStoreMove === 'function') { const moved = chanStoreMove(key, sid, add, agent); if (moved !== null) return moved; }
    const list = spaces().map(s => ({ ...s, threads: s.threads.slice() })), space = list.find(s => s.id === key); if (!space) return false;
    const ids = new Set(space.threads); if (add) ids.add(sid); else ids.delete(sid);
    if (ids.size > 500) { toast('!', `${SPACE.ch ? 'Channel' : SPACE.one} is full`, 2400); return false; }
    // One member, never this device's whole list: a device that hadn't pulled would erase other edits (live.js prefOps).
    LIVE.prefOps([{ op: add ? 'add' : 'remove', key: `spaces/${key}/threads`, item: sid }]);
    return true;
  }
  // Choosing a Space for a chat files it there and only there (Move when it was in another); its current Space
  // again changes nothing. Removing stays its own row-sheet action.
  function fileInSpace(key, sid, agent) {
    const from = spacesOf(sid), name = spaces().find(x => x.id === key)?.name || (SPACE.ch ? 'channel' : SPACE.one);
    if (from.length === 1 && from[0].id === key) { toast('✓', `Already in ${name}`, 1600); return false; }
    if (!spaceMember(key, sid, true, agent)) return false;
    toast('✓', `${from.length ? 'Moved to' : 'Added to'} ${name}`, 2000); return true;
  }
  // General in the Move to channel picker (wizard-ux issue 1292): out of its channel, into no channel (the store's
  // atomic move to null). Already in General changes nothing.
  function fileInGeneral(sid, agent) {
    const from = spacesOf(sid);
    if (!from.length) { toast('✓', 'Already in General', 1600); return false; }
    let ok = false; for (const s of from) ok = spaceMember(s.id, sid, false, agent) || ok;
    if (ok) toast('✓', 'Moved to General', 2000); return ok;
  }
  return { agoText, BOOM, byStatus, fileInGeneral, fileInSpace, focusedAgent, INC, isWorking, KIT, matchFilters, md, paintPins, PIN, PIN_SVG, PINS_KEY, pinsOn, SEC_OPEN_KEY, SECTIONS_DAY, SECTIONS_STATUS, setFilter, SPACE, spaceAgent, spaceContains, spaceMember, spaces, SPACES_KEY, spacesOf, STALE_LIST, STATUS, statusEntries, subjectOf, subjects, TOPIC, topicOn, toTurns, visibleSpaces, WORKING_ST, bindLate: v => { if ('renderChats' in v) renderChats = v.renderChats; if ('snoozeLast' in v) snoozeLast = v.snoozeLast; } };
};
