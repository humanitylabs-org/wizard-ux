/* Pure Chats list model. No DOM, storage, clocks or I/O: adapters supply facts.
 * Classic scripts and ES layouts share this one instance; renderers own their markup. */
(function (root) {
  'use strict';
  if (root.WizChatsListModel) return; // also imported by ES layouts after classic boot
const STATES = [['needs', 'Needs you'], ['approval', 'Needs approval'], ['failed', 'Error'], ['check', 'Your call'], ['fyi', 'FYI'], ['done', 'Done'], ['deferred', 'Snoozed'], ['none', 'Ready']];
const KNOWN = new Set(STATES.map(s => s[0]));
/** One row's status: the shell's own (row.state), else what the row says (needs / a note). */
function stateOf(r) {
  const s = r && typeof r.state === 'string' ? r.state : '';
  if (KNOWN.has(s)) return s;
  if (r?.note && r.snoozed) return 'deferred';   // round 18: a read (kept) notification sits with the snoozed, as in stock
  return r?.needs ? 'needs' : r?.note ? 'fyi' : 'none';
}
/** Ready grouped by status in STATES order: [{ state, word, rows }], empty groups left out. */
function stateGroups(rows) {
  const by = new Map(STATES.map(([k]) => [k, []]));
  for (const r of rows || []) by.get(stateOf(r)).push(r);
  return STATES.map(([state, word]) => ({ state, word, rows: by.get(state) })).filter(g => g.rows.length);
}
const READY_SORTS = Object.freeze([['priority', 'Priority'], ['newest', 'Newest'], ['oldest', 'Oldest']]);
const sortOf = o => o === 'newest' || o === 'oldest' ? o : 'priority';
const PRIORITY_TIP = 'Priority: needs approval first, then Needs you, Your call, FYI, Done, then the rest; newest first within each. ' +
  'Notifications rank by their own priority (4–5 with Needs you, 3 with Your call, the rest with FYI).';
const atOf = r => Date.parse(r?.at) || 0;
/** A row's Priority rank (stock live.js readyRank: 0 approval, 1 needs you, 2 your call, 3 FYI, 4 done, 5 no status,
 * 9 snoozed at the bottom); the shell sends it as row.rank, else it is read from the row's status. */
function rankOf(r) {
  if (Number.isFinite(r?.rank)) return r.rank;
  if (r?.note) return r.needs ? 1 : 3;
  return { approval: 0, needs: 1, failed: 1, check: 2, fyi: 3, done: 4, deferred: 9 }[r?.state] ?? 5;
}
/** Ready in the chosen order (pure). Newest / Oldest: approvals first and snoozed last (stock's pins), time in
 * between; Priority: by rank, newest first inside each. Read notifications last, newest first (Oldest: oldest). */
const compareTime = (a, b, order) => (order === 'oldest' ? atOf(a) - atOf(b) : atOf(b) - atOf(a)) || String(a.sortTitle ?? a.title ?? '').localeCompare(String(b.sortTitle ?? b.title ?? ''));
const WORKING_SORTS = Object.freeze([['alphabetical', 'A to Z'], ['newest', 'Newest first'], ['oldest', 'Oldest first']]);
const workingOrderOf = o => o === 'newest' || o === 'oldest' ? o : 'alphabetical';
const workingTitle = r => String(r?.title || 'New chat');
// Older/imported running sessions may lack request timestamps. Keep Ready's
// card clock unchanged, but still make Working's time choices meaningful.
const workingAt = (s, live) => live.cardAt?.(s) || [s.updatedAt, s.createdAt].find(v => Number.isFinite(Date.parse(v ?? ''))) || '';
const workingCollator = new Intl.Collator(undefined, { sensitivity: 'base' });
/** Working is independent of Ready: visible titles A to Z by default, newest ties.
 * Pins remain first where a surface includes them; no attention/snooze priority. */
function workingSort(rows, order) {
  const o = workingOrderOf(order);
  return (rows || []).slice().sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)
    || (o === 'alphabetical' ? workingCollator.compare(workingTitle(a), workingTitle(b)) || atOf(b) - atOf(a) : compareTime(a, b, o)));
}
function readySort(rows, order) {
  const o = sortOf(order), list = (rows || []).slice(), later = list.filter(r => r.note && r.snoozed), main = list.filter(r => !(r.note && r.snoozed));
  const t = (a, b) => compareTime(a, b, o);
  const pin = r => { const k = rankOf(r); return k === 0 ? 0 : k === 9 ? 2 : 1; };
  main.sort(o === 'priority' ? (a, b) => rankOf(a) - rankOf(b) || t(a, b) : (a, b) => pin(a) - pin(b) || t(a, b));
  later.sort(t);
  return [...main, ...later];
}
/** Round 18 item 4 (Miguel, 3 Nov 2026: the open sidebar built on the folded rail): Ready grouped by status exactly
 * as the rail counts it (stateGroups: STATES order), each group's rows in the chosen order (group first, then the sort
 * inside it); plain chats last under 'No status'. [{ state, word, rows }]. Pure. */
function readyGroups(rows, order) {
  return stateGroups(rows).map(g => ({ ...g, word: g.state === 'none' ? 'No status' : g.word, rows: readySort(g.rows, order) }));
}
/** Round 24c (Miguel, 4 Nov 2026: "they should be one and the same, just use project"): Ready grouped by each chat's
 * project, the part of its title before ' · ' ("WizardOS · Hotkeys" → WizardOS), a sub-header per project, its rows
 * in the chosen order. Projects with something waiting on him first, then the bigger ones, then A–Z; notifications
 * under 'Notifications' and titles with no project under 'Other', both last. [{ state: 'proj:<name>', word, rows }]. Pure. */
const NOTES_PROJECT = 'Notifications', NO_PROJECT = 'Other';
const projectOf = r => {
  if (r?.note) return NOTES_PROJECT;
  const t = String(r?.title || '').replace(/\s+/g, ' ').trim(), i = t.indexOf('·');
  return (i > 0 ? t.slice(0, i).trim() : '') || NO_PROJECT;
};
/** round 26 (Miguel, 4 Nov 2026: the project shows once, on its group's header): a row's title under a By project
 * header, without its 'Project ·' part ("WizardOS · Hotkeys" → Hotkeys); titles with no project stay whole. Pure. */
const titleInProject = r => {
  const t = String(r?.title || ''), i = t.indexOf('·');
  if (r?.note || i <= 0 || !t.slice(0, i).trim()) return t;
  return t.slice(i + 1).trim() || t;
};
function projectGroups(rows, order) {
  const by = new Map();
  for (const r of rows || []) { const k = projectOf(r); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  const tail = k => k === NO_PROJECT ? 2 : k === NOTES_PROJECT ? 1 : 0, waits = k => by.get(k).filter(r => rankOf(r) <= 1).length;
  return [...by.keys()].sort((a, b) => tail(a) - tail(b) || waits(b) - waits(a) || by.get(b).length - by.get(a).length || a.localeCompare(b))
    .map(k => ({ state: 'proj:' + k, word: k, rows: readySort(by.get(k), order) }));
}
/** Ready's grouping: 'status' (sub-headers per status), 'project' (per project) or 'none' (one list in the chosen
 * Sort). Any other value reads as 'none'. */
const GROUP_MODES = Object.freeze([['status', 'By status'], ['project', 'By project'], ['none', 'One list']]);
const groupMode = m => m === 'status' || m === 'project' ? m : 'none';
/** Ready as one list, in the order it is drawn (⌥↓ / ⌥↑ walk exactly this). By status / By project: the groups in
 * turn. One list (James, 4 Nov 2026: "One list, Newest" must read newest first, not Needs you on top): the chosen
 * Sort alone (readySort: stock's pins, approvals first and snoozed last). */
const readyFlat = (rows, order, mode) => {
  const m = groupMode(mode);
  if (m === 'none') return readySort(rows, order);
  return (m === 'project' ? projectGroups(rows, order) : readyGroups(rows, order)).flatMap(g => g.rows);
};
/** The ⌥↓ / ⌥↑ step through a list of ids (stock stepReady): from the one in front, the next / previous, wrapping;
 * from elsewhere, the top. Returns { id, wrapped } (null when the list is empty). */
function readyStep(ids, cur, dir) {
  const n = (ids || []).length; if (!n) return null;
  const i = cur == null ? -1 : ids.indexOf(cur);
  if (i < 0) return { id: ids[0], wrapped: false };
  const j = (i + (dir < 0 ? -1 : 1) + n) % n;
  return { id: ids[j], wrapped: dir > 0 ? j < i : j > i };
}


const sessionTitle = s => s.title || 'New chat';
/** A live controller receipt outranks attention/preview-derived completion. No
 * receipt means no inference: an old run id alone must never pin Working. */
function executionStatus(status, runId, runStatus) {
  if (['waiting_for_approval', 'unknown', 'stopping'].includes(status)) return status;
  return runId && ['submitting', 'queued', 'running', 'stopping'].includes(runStatus) ? runStatus : status;
}
/** List lifecycle only: real run/queue or background helper, never tracker items.
 * Runtime controls must still use their own run predicate, not helper liveness. */
function isListWorking(s) {
  if (!s || s.archived) return false;
  if (s.background) return true;
  const working = ['submitting', 'queued', 'running', 'stopping'];
  const liveRun = !!s.runId && working.includes(s.lastRunStatus);
  const helper = s.helperStatus;
  // A helper actually running keeps the thread in Working whatever its last run did, including an
  // interrupted/failed one (James, 7 Nov 2026: Ready only when every worker has stopped). The error
  // card stays in the thread; approval and recovery gates keep their own place.
  if (helper?.phase === 'running' && helper.pending > 0 && !['waiting_for_approval', 'unknown'].includes(s.status)) return true;
  // A helper-wait status is not execution evidence once every helper has stopped.
  if (s.waitingOn === 'helper' && !liveRun && helper?.pending === 0 && helper.phase !== 'running'
      && (helper.phase === 'stalled' || helper.failed === true)) return false;
  return working.includes(s.status) && !(s.status === 'queued' && s.queueReason === 'provider_access');
}
/** Project raw sessions once, with the shell's read/actions/attention facts. */
function sessionRow(s, kind, { live, chats, pins } = {}) {
  const fresh = !!live.isNew?.(s), state = chats.stiKind?.(s) || '';
  return { id: s.id, title: sessionTitle(s), kind, at: kind === 'working' ? workingAt(s, live) : live.cardAt?.(s) || '',
    rank: state === 'failed' ? 1 : Number.isFinite(live.readyRank?.(s)) ? live.readyRank(s) : undefined,
    snoozed: !!s.deferred, unread: fresh, pinned: !!pins?.has(s.id),
    ...(kind === 'working' && ['needs_you', 'check'].includes(s.attention?.state) && s.attention.ask ? { workingAsk: s.attention, background: s.background || '' } : {}),
    needs: s.status === 'waiting_for_approval' || s.attention?.state === 'needs_you', state,
    // its "# channel" while Channels is on (wizard-ux issue 1256: the AI apps sidebar's Activity rows)
    ...(chats.channelOf?.(s) ? { channel: chats.channelOf(s) } : {}),
    // and, for an agent other than the main one, that agent's name after it (wizard-ux issue 1336: "# Chats · Philosopher")
    ...(chats.channelOf?.(s) && chats.agentLabelOf?.(s) ? { agentName: chats.agentLabelOf(s) } : {}),
    // Move to channel… (wizard-ux issue 1292): the same picker as a channel feed's row menu, only while Channels is on
    // Mark done (wizard-ux issue 1317): only while its switch and Channels are on (chats.canMarkDone)
    actions: [...(pins ? ['pin'] : []), 'rename', ...(chats.canMarkDone?.(s) ? ['markdone'] : []), ...(kind === 'ready' && !fresh ? ['unread'] : []), ...(chats.channelOf?.(s) ? ['move'] : []),
      ...chats.threadActions(s, null).filter(a => ['snooze', 'done', 'restore'].includes(a))] };
}
const deferred = s => !!s.deferred && !s.archived && !(Date.parse(s.lastUserAt) > Date.parse(s.deferredAt));
function sessionList(groups, facts) {
  if (!groups) return null;
  const snoozed = s => deferred(s) && !['waiting_for_approval', 'unknown'].includes(s.status);
  const ready = [...(groups.errors || []), ...(groups.ready || []), ...(groups.yesterday || []), ...(groups.pastWeek || [])];
  const rows = (list, kind) => list.map(s => sessionRow(s, kind, facts));
  return { working: rows(groups.working || [], 'working'), ready: rows(ready.filter(s => !snoozed(s)), 'ready'),
    snoozed: rows([...(groups.deferred || []), ...ready.filter(snoozed)], 'snoozed'), archive: rows((groups.archive || []).slice(0, 200), 'archive') };
}
/** Raw session rank also used by WizLive's public compatibility helpers. */
function sessionRank(s, { approval = ['waiting_for_approval', 'unknown'].includes(s.status), snoozeLast = false, failed = false } = {}) {
  return snoozeLast && deferred(s) ? 9 : approval ? 0 : deferred(s) ? 9 : failed ? 1 : ({ needs_you: 1, check: 2, fyi: 3, done: 4 }[s.attention?.state] || 5);
}
/** Keep raw payloads outside the row schema so renderers receive their original objects. */
function orderSessions(list, order, { at, rank, state } = {}) {
  return readySort((list || []).map(s => ({ id: s.id, title: sessionTitle(s), at: at(s), rank: rank(s), state: state?.(s), value: s })), order).map(r => r.value);
}
const sortNotes = (items, order) => readySort(items.map(n => notificationRow(n)), order).map(r => r.value);
function notificationRow(it, items = it.items || []) {
  const priority = items.length > 1 ? Math.max(...items.map(i => Number(i.priority) || 3)) : Number(it.priority);
  return { id: it.id, title: it.title || '', sortTitle: it.title || '', at: new Date((Number(it.time) || 0) * 1000).toISOString(),
    note: true, snoozed: !!it.read, rank: priority >= 4 ? 1 : priority === 3 ? 2 : 3, value: it };
}
/** Combine sessions and notes before drawing; the same comparator owns both. */
function mixedRows(list, notes, order, facts, { timeOnly = false } = {}) {
  const rows = list.map(s => ({ id: s.id, title: sessionTitle(s), at: facts.at(s), rank: timeOnly ? 9 : facts.rank(s), value: s }));
  const ns = notes.map(n => notificationRow(n));
  if (timeOnly) for (const n of ns) { n.rank = 9; n.snoozed = false; }
  return readySort([...rows, ...ns], order);
}
/** Subject is attention metadata, not a title-derived project. Saved order wins. */
function subjectGroups(list, notes, { subject, waits, saved = [] } = {}) {
  const by = new Map(), add = (k, value, note) => { if (!by.has(k)) by.set(k, { key: k, rows: [], notes: [] }); by.get(k)[note ? 'notes' : 'rows'].push(value); };
  for (const s of list) add(subject(s) || 'Other', s, false);
  for (const n of notes) add(NOTES_PROJECT, n, true);
  const rank = new Map(saved.map((k, i) => [k, i]));
  const count = g => g.rows.length + g.notes.length;
  const waiting = g => g.rows.filter(waits).length + g.notes.filter(n => notificationRow(n).rank === 1).length;
  return [...by.values()].sort((a, b) => (rank.get(a.key) ?? 1e9) - (rank.get(b.key) ?? 1e9)
    || Number(a.key === 'Other') - Number(b.key === 'Other') || waiting(b) - waiting(a) || count(b) - count(a) || a.key.localeCompare(b.key))
    .map(g => ({ ...g, waiting: waiting(g), size: count(g) }));
}
function priorityGroups(list, notes, rank) {
  const by = new Map(), add = (r, value, note) => { if (!by.has(r)) by.set(r, { rank: r, rows: [], notes: [] }); by.get(r)[note ? 'notes' : 'rows'].push(value); };
  for (const s of list) add(rank(s), s, false);
  for (const n of notes) add(notificationRow(n).rank, n, true);
  return [...by.values()].sort((a, b) => a.rank - b.rank);
}
/* Activity as a short "what needs me" list (wizard-ux issue 1336, with Channels on; James, 12 Nov 2026). Working, then
 * Ready, which holds only threads waiting on the owner (amber, until addressed) and finished unread ones (green, until
 * opened), then Recent (everything else, newest first, about a week back, "Show older" for the rest of the live window),
 * then Snoozed and Archived. One sort for the view, stored as Chats' own Ready order (newest / oldest / priority, shared
 * across devices): Newest first, Oldest first, Needs you first. Sections come from the shell's own classification
 * (LIVE.workGroups), never a second status policy. Pure. */
const ACTIVITY_SORTS = Object.freeze([['newest', 'Newest first'], ['oldest', 'Oldest first'], ['priority', 'Needs you first']]);
const activitySortOf = o => o === 'oldest' || o === 'priority' ? o : 'newest';
const ACTIVITY_RECENT_DAYS = 7, DAY_MS = 864e5;
// One marker per row, the same three meanings everywhere: working (spinner), needs (amber) and new (green); amber wins.
const activityMark = ({ working, needs, unread }) => working ? 'working' : needs ? 'needs' : unread ? 'new' : '';
const msOf = v => typeof v === 'number' ? v : Date.parse(v ?? '') || 0;
/** Rows in the view's order. at(r) and needs(r) read a row (raw session or projected row); ties by id. */
function activitySort(rows, order, { at = r => msOf(r?.at), needs = r => r?.mark === 'needs' } = {}) {
  const o = activitySortOf(order), id = r => String(r?.id ?? '');
  const t = (a, b) => (o === 'oldest' ? at(a) - at(b) : at(b) - at(a)) || (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0);
  return (rows || []).slice().sort(o === 'priority' ? (a, b) => Number(!!needs(b)) - Number(!!needs(a)) || t(a, b) : t);
}
/** The sections from the shell's groups (LIVE.workGroups) and its facts: needs(s), unread(s), at(s) in ms.
 * { working, ready, recent, older (how many Recent rows "Show older" would add), snoozed, archive }. Pure. */
function activityGroups(groups, { needs, unread, at }, { order = 'newest', now = 0, days = ACTIVITY_RECENT_DAYS, older = false } = {}) {
  if (!groups) return null;
  const snoozed = s => deferred(s) && !['waiting_for_approval', 'unknown'].includes(s.status);
  const rest = [...(groups.errors || []), ...(groups.ready || []), ...(groups.yesterday || []), ...(groups.pastWeek || [])];
  const ready = [], recent = [], snz = [...(groups.deferred || [])];
  for (const s of rest) (snoozed(s) ? snz : needs(s) || unread(s) ? ready : recent).push(s);
  const newest = rows => activitySort(rows, 'newest', { at });
  const cut = now - days * DAY_MS, all = newest(recent), within = all.filter(s => at(s) >= cut);
  return { working: activitySort(groups.working || [], order === 'priority' ? 'newest' : order, { at }), ready: activitySort(ready, order, { at, needs }),
    recent: older ? all : within, older: older ? 0 : all.length - within.length, snoozed: newest(snz), archive: newest(groups.archive || []) };
}
/** The same sections as rows for a layout that draws its own list (sessionRow, plus each row's marker). */
function activityList(groups, facts, opts = {}) {
  const c = facts.chats, at = s => msOf(facts.live.cardAt?.(s)) || msOf(s.updatedAt) || msOf(s.createdAt);
  const needs = s => !!c.activityNeeds?.(s), unread = s => !!c.activityUnread?.(s);
  const g = activityGroups(groups, { needs, unread, at }, opts); if (!g) return null;
  const rows = (list, kind) => list.slice(0, 200).map(s => ({ ...sessionRow(s, kind, facts), mark: activityMark({ working: kind === 'working', needs: needs(s), unread: unread(s) }) }));
  return { working: rows(g.working, 'working'), ready: rows(g.ready, 'ready'), recent: rows(g.recent, 'ready'), older: g.older,
    snoozed: rows(g.snoozed, 'snoozed'), archive: rows(g.archive, 'archive') };
}
const visibleIds = (rows, order, mode) => readyFlat(rows, order, mode).map(r => r.id);
/** Subgroup pills count canonical projected unread rows, never the Ready inventory. */
/** The one unread tally for raw threads (+ notification rows): every Ready-side number is this, never the list length. */
const unreadThreads = (rows, isNew, notes) => new Set((rows || []).filter(s => isNew(s)).map(s => s.id)).size + (notes || []).filter(n => !n.read).length;
const unreadCount = rows => new Set((rows || []).filter(r => r.unread).map(r => r.id)).size;
root.WizChatsListModel = Object.freeze({ STATES, stateOf, stateGroups, WORKING_SORTS, workingOrderOf, workingAt, workingSort, READY_SORTS, sortOf, PRIORITY_TIP, rankOf, readySort, executionStatus, isListWorking,
  readyGroups, NOTES_PROJECT, NO_PROJECT, projectOf, titleInProject, projectGroups, GROUP_MODES, groupMode, readyFlat,
  readyStep, visibleIds, ACTIVITY_SORTS, activitySortOf, ACTIVITY_RECENT_DAYS, activityMark, activitySort, activityGroups, activityList, unreadCount, unreadThreads, compareTime, deferred, sessionRow, sessionList, sessionRank, orderSessions, notificationRow, sortNotes, mixedRows, subjectGroups, priorityGroups });
})(globalThis);
