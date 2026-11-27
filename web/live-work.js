/* Wizard UX live data › agents' own thread lists, the Work sections (port of
 * wizard-mobile workSections.ts), shared-list operations (Spaces, subject order), dispositions and the read-state
 * fetch/put. Moved verbatim out of live.js (wizard-ux issue 1665: split the giant front-end
 * files, no behaviour change). live.js calls this once, where the code used to be, with the closure names it reads,
 * and keeps the names it returns under their old names. Loaded just before live.js everywhere that loads it. The
 * body below keeps live.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.liveParts = window.WizCore.liveParts || {};
window.WizCore.liveParts.work = function ({ J, req }) {
  let L; // late-bound: live.js declares these after the call, see bindLate
  const AGENT_WAIT = 1200; // ms a snapshot reload waits for other agents' threads before its one repaint
  const STALE_AFTER = 60 * 1000; // the list polls every 15 s, so a minute without a fresh read is worth saying
  /* ---- agents (Agents MVP): each non-default agent's threads are read from its own list (agent=<id>), always
   * through the owner's own Agent Service. Every thread/run call for such a thread names its agent, so a private
   * agent's #59 seal still refuses id-only reads from anything else.
   * Unified Chats (wizard-os spec/AGENTS.md, 18 Oct 2026): the owner's main Chats list (and its Ready/unread counts)
   * merges every agent's threads by recency; `L.sessions` stays the main agent's own list (search, status, links). ---- */
  const AG = () => window.WosAgents || null;
  const otherAgent = id => { const a = AG(); return !!id && (a ? a.isOther(id) : id !== 'hermes'); };
  const AGENT_OF = new Map(); // sessionId -> agent id, for threads of non-default agents (incl. not yet listed)
  const AGENT_SEEN_KEY = 'wos.agentSeen.v1';
  const AGENT_SEEN = (() => { try { const v = JSON.parse(localStorage.getItem(AGENT_SEEN_KEY) || 'null'); if (v && v.threads) return v; } catch (e) {} return { initializedAt: Date.now(), threads: {} }; })();
  const aq = (sid, sep = '?') => { const a = L.agentOf(sid); return a ? `${sep}agent=${encodeURIComponent(a)}` : ''; };
  const runAgent = runId => { for (const list of [L.sessions, ...Object.values(L.agentSessions)]) { const s = list.find(x => x.runId === runId); if (s) return L.agentOf(s.id); } return ''; };
  const rq = (runId, sep = '?') => { const a = runAgent(runId); return a ? `${sep}agent=${encodeURIComponent(a)}` : ''; };

  /* ---- Work sections: exact port of wizard-mobile src/workSections.ts ---- */
  const DAY = 864e5;
  // The owner's day: their time zone and day_starts_at from WizardOS settings (WizConfig).
  const workDayStart = (now = Date.now()) => window.WizConfig.dayStart(now);
  const WORKING_SECTION = new Set(['submitting', 'queued', 'running', 'waiting_for_approval', 'stopping']);
  // A failure the owner dismissed on this device is no error any more (issue 1488; the Agent Service drops it too).
  const isErr = s => (s.status === 'failed' || s.status === 'interrupted' || (s.status === 'queued' && s.queueReason === 'provider_access')) && !globalThis.WosErrors?.dismissed?.(s);
  const needsApproval = s => ['waiting_for_approval', 'unknown'].includes(s.status);
  const inWorking = s => window.WizChatsListModel.isListWorking(s);
  const firstValid = (...v) => v.find(x => isFinite(Date.parse(x ?? ''))) ?? '';
  const cardAt = s => (WORKING_SECTION.has(s.status) && !needsApproval(s) && !isErr(s)) || isErr(s)
    ? firstValid(s.assignedAt, s.requestAt, s.lastUserAt, s.previewRole === 'user' ? s.previewAt : undefined)
    : firstValid(s.previewAt, s.activityAt, s.lastUserAt, s.updatedAt);
  const newestFirst = (l, r) => {
    const a = Date.parse(cardAt(l)), b = Date.parse(cardAt(r));
    if (isFinite(a) !== isFinite(b)) return isFinite(a) ? -1 : 1;
    return (isFinite(a) ? b - a : 0) || l.title.localeCompare(r.title);
  };
  // Opinionated: auto-archive age is the owner's choice (Archive header selector); 0 = never. Default one week.
  const ARCH_KEY = 'wos.chats.archiveAfter.v1';
  // Chat-list layout: 'day' (Ready = today, then Yesterday, Past week; the default) or 'status' (Working / Ready / Archive).
  const LAYOUT_KEY = 'wos.chats.layout.v1';
  // A tweak asked the skin host for Snooze = lowest priority, bottom of Ready (api.nav.snoozeOrder('last'); docs/snooze-last.md).
  const snoozeLast = () => { try { return window.WosSkinHost?.snoozeOrder === 'last'; } catch (e) { return false; } };
  // A tweak can ask for one Group by day switch instead of the Layout picker: `html { --wos-chats-group-switch: on; }`.
  // It then works identically on every skin and keeps the stored By day/By status choice.
  const groupSwitch = () => { try { return getComputedStyle(document.documentElement).getPropertyValue('--wos-chats-group-switch').trim() === 'on'; } catch (e) { return false; } };
  const chatLayout = () => { try { return localStorage.getItem(LAYOUT_KEY) === 'status' ? 'status' : 'day'; } catch (e) { return 'day'; } };
  const archiveAfterDays = () => { try { const v = localStorage.getItem(ARCH_KEY); if (v != null && isFinite(+v)) return +v; } catch (e) {} return 7; };
  // Agent Service owns box-wide preferences. localStorage is only an offline cache.
  const PREFS_URL = '/wizard/v1/ui-preferences';
  let prefsWrites = Promise.resolve(), prefsPending = 0, prefsRevision = 0;
  const prefsFields = {
    archiveAfterDays: ['wos.chats.archiveAfter.v1', v => Number.isInteger(v) && [0, 1, 3, 7, 14, 30].includes(v), String],
    compact: ['wos.chats.compact.v1', v => typeof v === 'boolean', v => v ? '1' : '0'],
    chatLayout: ['wos.chats.layout.v1', v => v === 'day' || v === 'status', String],
    chatAfterAction: ['wos.chats.afterAction.v1', v => v === 'stay' || v === 'list', String],
    workingOrder: ['wos.chats.workingOrder.v1', v => ['alphabetical', 'newest', 'oldest'].includes(v), String],
    readyOrder: ['wos.chats.readyOrder.v1', v => ['newest', 'oldest', 'priority', 'subject'].includes(v), String],
    subjectOrder: ['wos.chats.subjectOrder.v1', v => Array.isArray(v) && v.every(x => typeof x === 'string'), JSON.stringify],
    // Pinned chats (core/chat-pins.js): the same pins on every device.
    pinnedChats: ['wos.chats.pinned.v2', v => Array.isArray(v) && v.every(x => typeof x === 'string'), JSON.stringify],
    spaces: ['wos.chats.spaces.v1', v => Array.isArray(v), JSON.stringify],
    // Short answer first (skin-host replySummary): on, how long replies start, and the short answer's length.
    replySummary: ['wos.chats.replySummary.v1', v => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.on === 'boolean', JSON.stringify],
    // The owner's other Wizards for the switcher (core/workspaces.js): the same list on every device of this box.
    savedWizards: ['wos.workspaces.box.v1', v => Array.isArray(v), JSON.stringify],
    // The phone bar's pinned slot (app-sections.js, wizard-ux#1929): an app id, '' = Messenger.
    phoneSlot: ['wos.phone.slot.v1', v => typeof v === 'string' && /^[A-Za-z0-9._-]{0,80}$/.test(v), String],
  };
  let prefsOff = false;
  const putPrefs = (patch, { requireShared = false } = {}) => {
    if (prefsOff) return Promise.resolve(!requireShared);
    prefsPending++; prefsRevision++;
    prefsWrites = prefsWrites.then(async () => {
      try {
        const r = await req(PREFS_URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
        if (r.status === 404) { prefsOff = true; return !requireShared; } // this Agent Service has no shared preferences yet: keep the choice on this device, quietly
        if (!r.ok) throw new Error('Preferences unavailable');
        return true;
      } catch (e) { window.dispatchEvent(new Event('wos:prefs-error')); return false; }
      finally { prefsPending--; }
    });
    return prefsWrites;
  };
  // The shared preferences as this device shows them: the service's values plus this device's queued list edits.
  const acceptPrefs = (j, only = null) => {
    if (!only) window.WizLauncher?.accept(j);
    const v = applyPrefOps(j, queuedOps());
    let changed = false;
    for (const [name, [key, valid, encode]] of Object.entries(prefsFields)) if ((!only || only.has(name)) && name === 'savedWizards' && !Array.isArray(j?.savedWizards)) {
      // A box without saved Wizards (an older or rolled-back Agent Service): drop the cache, so the switcher keeps
      // this device's own list instead of showing edits the box never stored.
      if (localStorage.getItem(key) != null) { localStorage.removeItem(key); changed = true; }
    } else if ((!only || only.has(name)) && valid(v[name])) {
      const value = encode(v[name]);
      if (localStorage.getItem(key) !== value) { localStorage.setItem(key, value); changed = true; }
    }
    if (changed) window.dispatchEvent(new Event('wos:prefs'));
  };
  const pullPrefs = async () => {
    if (prefsPending || prefsOff) return;
    const rev = prefsRevision;
    try {
      const r = await req(PREFS_URL, { cache: 'no-store' });
      if (r.status === 404) { prefsOff = true; return; }
      if (!r.ok) return;
      const j = await r.json();
      if (!j || prefsPending || rev !== prefsRevision) return;
      acceptPrefs(j);
    } catch (e) { /* Older/offline service: retain this device's cached choice, never reset it. */ }
  };
  /* Shared lists (Spaces and their members, subject order) change by item operation, never by saving this device's
   * whole cached list: a device that hadn't pulled yet used to erase another device's or an agent's edit (same bug
   * as pins, wizard-ux #670). Each edit is queued here (kept across reloads and offline spells), shown at once, and
   * sent as Agent Service PATCH operations, applied atomically to the stored lists. An older service (405) gets the
   * same operations replayed onto a fresh read, written and read back. Pins keep their own queue (core/chat-pins.js). */
  const OPS_KEY = 'wos.prefs.ops.v1', SPACE_OP = /^spaces\/([a-z0-9-]{1,48})\/(threads|name)$/, WIZARD_OP = /^savedWizards\/([A-Za-z0-9._:-]{1,120})\/name$/;
  const opField = o => SPACE_OP.test(o.key) ? 'spaces' : WIZARD_OP.test(o.key) ? 'savedWizards' : o.key;
  const originOf = u => { try { return new URL(u).origin; } catch (e) { return ''; } };
  // The same operations as Agent Service applies (server/ui-preferences.mjs applyUiPreferenceOps); each is idempotent.
  function applyPrefOps(prefs, ops) {
    const next = { ...prefs };
    for (const { op, key, item, items } of ops) {
      const sub = SPACE_OP.exec(key), list = Array.isArray(next[opField({ key })]) ? next[opField({ key })] : [];
      const wiz = WIZARD_OP.exec(key);
      // Saved Wizards: adding is a no-op for an id or address already saved; renaming a forgotten one is a no-op.
      if (key === 'savedWizards') next.savedWizards = op === 'add' ? (list.some(w => w.id === item.id || (!!originOf(w.url) && originOf(w.url) === originOf(item.url))) ? list : list.concat(item)) : list.filter(w => w.id !== item);
      else if (wiz) next.savedWizards = list.map(w => w.id === wiz[1] ? { ...w, name: item } : w);
      else if (key === 'pinnedChats' || key === 'subjectOrder') next[key] = op === 'front' ? [...new Set(items)].concat(list.filter(x => !items.includes(x))).slice(0, 60)
        : op === 'add' ? (list.includes(item) ? list : list.concat(item)) : list.filter(x => x !== item);
      else if (key === 'spaces') next.spaces = op === 'add' ? (list.some(s => s.id === item.id) ? list : list.map(s => (s.agent || 'hermes') === (item.agent || 'hermes') && s.threads.some(t => item.threads.includes(t)) ? { ...s, threads: s.threads.filter(t => !item.threads.includes(t)) } : s).concat(item)) : list.filter(s => s.id !== item);
      // One Space per chat (James, 29 Oct 2026), as the Agent Service applies it: adding moves the chat out of that
      // agent's other Spaces in the same edit.
      else if (sub) { const to = list.find(s => s.id === sub[1]), mine = s => (s.agent || 'hermes') === (to?.agent || 'hermes');
        next.spaces = list.map(s => s.id !== sub[1] ? (to && sub[2] === 'threads' && op === 'add' && mine(s) && s.threads.includes(item) ? { ...s, threads: s.threads.filter(t => t !== item) } : s)
          : sub[2] === 'name' ? { ...s, name: item }
          : { ...s, threads: op === 'add' ? (s.threads.includes(item) ? s.threads : s.threads.concat(item)) : s.threads.filter(t => t !== item) }); }
    }
    return next;
  }
  const queuedOps = () => { try { const v = JSON.parse(localStorage.getItem(OPS_KEY) || '[]'); return Array.isArray(v) ? v.filter(o => o && typeof o.op === 'string' && typeof o.key === 'string') : []; } catch (e) { return []; } };
  const setQueue = ops => { try { localStorage.setItem(OPS_KEY, JSON.stringify(ops.slice(-200))); } catch (e) {} };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let patchOff = false, opsRetry = 0, opsTimer = 0;
  // req() throws on any HTTP error; these answers decide what happens next, so read their status.
  const ask = (url, init) => req(url, init).catch(e => { if (e?.status) return { ok: false, status: e.status }; throw e; });
  async function sendOps(ops) {
    if (!patchOff) {
      const r = await ask(PREFS_URL, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops }) });
      if (r.status === 404) { prefsOff = true; return null; }
      if (r.ok) return await r.json();
      if (r.status === 400) return 'invalid';
      if (r.status !== 405 && r.status !== 501) throw new Error('Preferences unavailable');
      patchOff = true;
    }
    const fields = [...new Set(ops.map(opField))], get = async () => { const g = await ask(PREFS_URL, { cache: 'no-store' }); if (g.status === 404) prefsOff = true; if (!g.ok) throw new Error('Preferences unavailable'); return g.json(); };
    // Two devices can both read before either writes: read back, and replay onto the newer list if ours didn't stick.
    // This narrows the loss window to one read-to-write round trip; only the service's PATCH makes it atomic.
    for (let pass = 0; pass < 6; pass++) {
      const fresh = await get(), next = applyPrefOps(fresh, ops), patch = {};
      for (const f of fields) if (!same(next[f], fresh[f])) patch[f] = next[f];
      if (!Object.keys(patch).length) return fresh;
      const w = await ask(PREFS_URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      if (w.status === 400) return 'invalid';
      if (!w.ok) throw new Error('Preferences unavailable');
      const back = await get(), again = applyPrefOps(back, ops);
      if (fields.every(f => same(again[f], back[f]))) return back;
    }
    throw new Error('Preferences busy');
  }
  // direct: send these now without queueing (a new Space appears only once the box has it); else send the queue.
  const syncOps = (direct = null) => {
    prefsPending++; prefsRevision++;
    prefsWrites = prefsWrites.then(async () => {
      try {
        const ops = direct || queuedOps();
        if (!ops.length) return true; // an earlier pass already delivered this edit
        if (prefsOff) return !direct;
        const j = await sendOps(ops);
        if (j === null) return !direct; // no shared preferences on this service: the edit stays on this device
        // Drop only what this pass delivered; an edit made meanwhile stays queued.
        if (!direct) { const now = queuedOps(); setQueue(same(now.slice(0, ops.length), ops) ? now.slice(ops.length) : now); }
        opsRetry = 0;
        const lists = new Set(ops.concat(queuedOps()).map(opField)); // only the lists: a newer scalar choice may still be on its way
        if (j === 'invalid') { // the box can never take these: show its lists again
          window.dispatchEvent(new Event('wos:prefs-error'));
          try { const g = await req(PREFS_URL, { cache: 'no-store' }); if (g.ok) acceptPrefs(await g.json(), lists); } catch (e) {}
          return false;
        }
        acceptPrefs(j, lists);
        return true;
      } catch (e) {
        if (direct) { window.dispatchEvent(new Event('wos:prefs-error')); return false; }
        opsRetry = Math.min(opsRetry + 1, 6); // offline or busy: the edit stays queued and shown; try again later
        if (typeof setTimeout === 'function') { clearTimeout(opsTimer); opsTimer = setTimeout(() => syncOps(), 2000 * 2 ** opsRetry); }
        return false;
      } finally { prefsPending--; }
    });
    return prefsWrites;
  };
  const prefOps = (ops, { requireShared = false } = {}) => {
    if (requireShared) return syncOps(ops);
    if (!prefsOff) setQueue(queuedOps().concat(ops));
    // Shown at once: this device's cached lists with the edit applied.
    const fields = [...new Set(ops.map(opField))], local = {};
    for (const f of fields) try { local[f] = JSON.parse(localStorage.getItem(prefsFields[f][0]) || '[]'); } catch (e) { local[f] = []; }
    const next = applyPrefOps(local, ops);
    for (const f of fields) try { localStorage.setItem(prefsFields[f][0], prefsFields[f][2](next[f])); } catch (e) {}
    window.dispatchEvent(new Event('wos:prefs'));
    return prefsOff ? Promise.resolve(true) : syncOps();
  };
  pullPrefs(); setInterval(pullPrefs, 30000);
  if (queuedOps().length) syncOps();
  // A phone coming back to the foreground fires visibilitychange/pageshow, rarely focus: pull then too, so pins and
  // other shared choices made on another device show at once instead of up to 30s later.
  try {
    addEventListener('focus', pullPrefs); addEventListener('pageshow', pullPrefs); addEventListener('online', () => { if (queuedOps().length) syncOps(); pullPrefs(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullPrefs(); });
  } catch (e) {}
  const sectionTime = s => Math.max(...[s.restoredAt, s.assignedAt, s.previewAt, s.requestAt, s.activityAt, s.lastUserAt, s.updatedAt].map(v => Date.parse(v ?? '')).filter(isFinite));
  // Ready has two orders (James, 10 Oct 2026: "Newest … the newest appears at the top … another option, priority"):
  //   Newest   = approvals pinned, then pure recency, status labels ignored (groupWork's default).
  //   Priority = approvals, then needs you, then things to test, then everything else (newest first within each).
  // Status labels never move a thread between days (James, 11 Oct 2026: Ready, Yesterday and Past week stay
  // filtered by day in Newest and Priority); Priority reorders within each day: Ready, Yesterday and Past week
  // (James, 23 Oct 2026).
  // Snoozed (deferred) threads leave the list (James, 23 Oct 2026: "It doesn't remove the thread from my list,
  // which is the purpose of snoozing it"; supersedes 10 Oct "bottom of today"). They wait in the collapsed Snoozed
  // section until their return time, Restore or Done. A message James sends after snoozing brings the thread back.
  const isDeferred = s => window.WizChatsListModel.deferred(s);
  // Priority ranks every status line, so Done threads (nothing left to do) sink below FYI answers and unlabelled
  // threads come last: with only needs you / check ranked, most of Ready tied and Priority read like Newest.
  const readyRank = s => window.WizChatsListModel.sessionRank(s, { approval: needsApproval(s), snoozeLast: snoozeLast() });
  const byPriority = list => window.WizChatsListModel.orderSessions(list, 'priority', { at: cardAt, rank: readyRank });
  // Oldest (James, 23 Oct 2026: "oldest messages at the top … the newest one at the bottom"): Newest's pins kept
  // (approvals first, deferred last), only time reversed in between. The same order applies to Yesterday and Past week.
  // snoozeOrder('last'): Snooze is a lower place in Ready, ahead of no unsnoozed row (even approvals).
  const byOldest = list => window.WizChatsListModel.orderSessions(list, 'oldest', { at: cardAt, rank: readyRank });
  function groupWork(sessions, now = Date.now()) {
    const g = { errors: [], working: [], ready: [], yesterday: [], pastWeek: [], deferred: [], archive: [] };
    const readyB = workDayStart(now), yB = readyB - DAY, archDays = archiveAfterDays(), archB = archDays ? now - archDays * DAY : -Infinity;
    const layout = chatLayout();   // once per pass, not per thread
    for (const s of sessions) {
      if (s.hidden) continue;
      const t = sectionTime(s);
      if (s.archived) g.archive.push(s);
      else if (snoozeLast() && isDeferred(s) && !inWorking(s)) g.ready.push(s);
      else if (inWorking(s)) g.working.push(s);
      else if (needsApproval(s)) g.ready.push(s);
      else if (isDeferred(s)) g.deferred.push(s);
      else if (isErr(s)) g.errors.push(s);
      else if (isFinite(t) && t <= archB) g.archive.push(s);
      else if (layout === 'status') g.ready.push(s); // By status: everything not yet archived is Ready
      else if (!isFinite(t) || t < yB) g.pastWeek.push(s);
      else if (t < readyB) g.yesterday.push(s);
      else g.ready.push(s);
    }
    for (const list of Object.values(g)) list.sort(newestFirst);
    // Newest: approvals pinned, then recency; deferred threads always last (Priority re-sorts with readyRank).
    g.ready = window.WizChatsListModel.orderSessions(g.ready, 'newest', { at: cardAt, rank: readyRank });
    return g;
  }
  async function fetchDispositions() {
    try { return (await (await req('/wizard/thread-dispositions')).json()).state || {}; } catch (e) { return {}; }
  }
  async function fetchSeen() { return (await (await req('/wizard/thread-seen')).json()).state || null; }
  async function putSeen(state) {
    const p = await (await req('/wizard/thread-seen', { method: 'PUT', headers: J, body: JSON.stringify(state) })).json();
    return p.state || state;
  }

  return { AG, AGENT_OF, AGENT_SEEN, AGENT_SEEN_KEY, AGENT_WAIT, aq, ARCH_KEY, archiveAfterDays, byOldest, byPriority, cardAt, chatLayout, DAY, fetchDispositions, fetchSeen, groupSwitch, groupWork, inWorking, isDeferred, isErr, LAYOUT_KEY, needsApproval, otherAgent, prefOps, putPrefs, putSeen, readyRank, rq, sectionTime, snoozeLast, STALE_AFTER, bindLate: v => { if ('L' in v) L = v.L; } };
};
