/* Wizard OS — live Wizard data: sessions, shared read state, real sends.
 * Read-state semantics mirror wizard-mobile src/threadSeen.ts exactly, and the
 * state is the same record Wizard itself uses (localStorage + /wizard/thread-seen),
 * so opening a chat anywhere clears it everywhere. */
(() => {
  'use strict';
  if (document.documentElement.dataset.leaving) return; // core/shell.js is switching to the other shell
  const SEEN_BASE = 'wizard.thread-seen.v1';
  const SCOPE = 'wizard-account-local';
  const SEEN_KEY = `${SEEN_BASE}:${SCOPE}`;
  const MAX = 500;
  const READY_OR_ATTENTION = new Set(['completed', 'failed', 'interrupted', 'waiting_for_approval']);
  const WORKING = new Set(['submitting', 'queued', 'running', 'stopping']);
  const ALIASES = { started: 'running', accepted: 'queued', pending: 'queued', waiting: 'waiting_for_approval' };
  const WEEK = 7 * 864e5;

  const iso = v => {
    if (typeof v === 'number' && isFinite(v)) return new Date(Math.abs(v) < 1e12 ? v * 1000 : v).toISOString();
    const p = Date.parse(String(v ?? '')); return isFinite(p) ? new Date(p).toISOString() : new Date(0).toISOString();
  };
  const optIso = v => { if (v == null || v === '') return undefined; const s = iso(v); return s === new Date(0).toISOString() ? undefined : s; };
  const text = v => {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map(p => typeof p === 'string' ? p : p?.text || '').join(' ');
    if (v && typeof v === 'object') return text(v.content ?? v.text ?? '');
    return '';
  };
  const chipLabel = raw => {
    try {
      const files = JSON.parse(raw);
      if (!Array.isArray(files) || !files.length) return ' ';
      const voice = files.every(f => /^audio\//.test(f.mime || '') || /^wizard-voice-/.test(f.filename || ''));
      if (voice) return ' 🎙 Voice note ';
      const img = files.every(f => /^image\//.test(f.mime || ''));
      return img ? ` 🖼 ${files.length === 1 ? 'Photo' : files.length + ' photos'} ` : ` 📎 ${files.length === 1 ? (files[0].filename || 'File') : files.length + ' files'} `;
    } catch (e) { return ' '; }
  };
  const clean = s => String(s || '')
    .replace(/\[WIZARD_FILES_V1\]\s*([\s\S]*?)\s*\[\/WIZARD_FILES_V1\]/g, (_, j) => chipLabel(j))
    .replace(/\[WIZARD_FILE_CHIPS_V1\]\s*([\s\S]*?)\s*\[\/WIZARD_FILE_CHIPS_V1\]/g, (_, j) => chipLabel(j))
    .replace(/\[WIZARD_IMAGE_INTENT_V1\][\s\S]*?\[\/WIZARD_IMAGE_INTENT_V1\]/g, ' ')
    .replace(/^Please use the attached files?\.\s*/, '')
    .replace(/<memory-context>[\s\S]*?<\/memory-context>/g, ' ')
    .replace(/\[(?:Browser dogfooding|System note)[^\]]*\][\s\S]*$/m, ' ')
    .replace(/[#*_`>]+/g, ' ').replace(/\s+/g, ' ').trim();

  const ATTN = new Set(['needs_you', 'check', 'done', 'fyi']);
  function attentionOf(v) {
    if (!v || typeof v !== 'object' || !ATTN.has(v.state)) return null;
    const ask = String(v.ask || '').replace(/\s+/g, ' ').trim().slice(0, 140); if (!ask) return null;
    return { state: v.state, ask, subject: String(v.subject || '').replace(/\s+/g, ' ').trim().slice(0, 40) };
  }
  function normalize(item) {
    const id = item.id || item.session_id; if (!id) return null;
    const raw = String(item.status || item.run_status || '');
    const status = ALIASES[raw] || raw || undefined;
    const lastUserAt = optIso(item.wizard_last_user_at ?? item.last_user_at);
    const lastAssistantAt = optIso(item.wizard_last_assistant_at ?? item.last_assistant_at);
    const latest = item.latest_message && typeof item.latest_message === 'object' ? item.latest_message : null;
    const lastUser = item.last_user_message && typeof item.last_user_message === 'object' ? item.last_user_message : null;
    const working = WORKING.has(status) || status === 'waiting_for_approval';
    const latestText = clean(text(latest?.content ?? latest?.text));
    const userText = clean(text(lastUser?.content ?? lastUser?.text) || text(item.wizard_request_preview));
    const preview = working ? (userText || latestText) : (latestText || userText || clean(text(item.preview)));
    const latestAt = optIso(latest?.timestamp ?? latest?.created_at);
    const userAt = optIso(lastUser?.timestamp ?? lastUser?.created_at);
    return {
      id, runtime: 'direct',
      title: String(item.title || item.name || 'Untitled chat'),
      source: item.source || '',
      status,
      archived: !!item.archived, hidden: !!item.hidden,
      messageCount: Number.isSafeInteger(item.message_count) ? item.message_count : undefined,
      lastUserAt, lastAssistantAt,
      updatedAt: lastUserAt ?? iso(item.wizard_started_at ?? item.updated_at ?? item.last_active ?? item.started_at),
      activityAt: optIso(item.wizard_activity_at) || optIso(item.last_active),
      runId: String(item.wizard_run_id || ''),
      // The idempotency key of the newest run Wizard knows for this thread (= the outbox item id for our sends).
      lastRunKey: String(item.wizard_last_run_idempotency_key || ''),
      preview, previewRole: latest?.role === 'assistant' ? 'assistant' : latest?.role === 'user' ? 'user' : undefined,
      previewAt: latestAt,
      requestAt: userAt || lastUserAt,
      assignedAt: optIso(item.wizard_assigned_at),
      critical: (item.wizard_attention_level || item.attention_level) === 'critical',
      waitingOn: item.wizard_waiting_on === 'helper' ? 'helper' : '',
      // What the finished thread asks of James (the agent's hidden status line): needs_you / check / done / fyi.
      attention: attentionOf(item.wizard_attention),
      // Thread titles (Agent Service thread-titles.mjs): every rename with its time, so the thread shows
      // "Renamed from …" right after the reply that renamed it. The list shows only the current title.
      renames: Array.isArray(item.wizard_title_renames) ? item.wizard_title_renames.filter(r => r && typeof r.from === 'string' && isFinite(r.at)).slice(-6).map(r => ({ from: r.from.slice(0, 120), to: String(r.to || '').slice(0, 120), at: Number(r.at), by: r.by === 'you' ? 'you' : 'agent' })) : [],
      // The thread's model route (chat-models.js shows and changes it).
      model: typeof item.model === 'string' ? item.model : '', provider: typeof item.provider === 'string' ? item.provider : '',
      modelLockAt: Number(item.wizard_model_lock_updated_at) || 0,
      // The last thing asked (Retry on a failed thread sends it again: controller.ts retryServerFailedSession).
      request: userText,
    };
  }

  /* ---- thread-seen: exact port of wizard-mobile semantics ---- */
  const vis = v => (typeof v === 'string' ? v : '').replace(/\s+/gu, ' ').trim().slice(0, 80).toLocaleLowerCase();
  function fingerprint(v) { let h = 2166136261; for (const c of vis(v)) { h ^= c.codePointAt(0) ?? 0; h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  const keyOf = s => `${s.runtime}:${s.id}`;
  function assistantAt(s) { const v = s.lastAssistantAt ?? (s.previewRole === 'assistant' ? s.previewAt : undefined); return isFinite(Date.parse(v ?? '')) ? v : undefined; }
  function recordFor(s, seenAt) {
    const a = assistantAt(s);
    return { ...(typeof s.messageCount === 'number' ? { messageCount: s.messageCount } : {}), ...(s.status && s.status !== 'submitting' ? { status: s.status } : {}),
      updatedAt: s.updatedAt, previewFingerprint: fingerprint(s.preview), ...(a ? { assistantActivityAt: a } : {}), seenAt };
  }
  function hasNew(s, state) {
    if (!state) return false;
    const r = state.threads[keyOf(s)]; if (!r) return true;
    const cur = Date.parse(assistantAt(s) ?? ''), seenA = Date.parse(r.assistantActivityAt ?? '');
    const comparable = typeof s.messageCount === 'number' && typeof r.messageCount === 'number';
    const previewChanged = !comparable && fingerprint(s.preview) !== r.previewFingerprint;
    const countUp = comparable && s.messageCount > r.messageCount;
    const becameReady = !!s.status && s.status !== r.status && READY_OR_ATTENTION.has(s.status) && (!r.status || !READY_OR_ATTENTION.has(r.status));
    if (isFinite(cur)) return isFinite(seenA) ? cur > seenA : cur > r.seenAt;
    if (previewChanged || countUp || becameReady) return true;
    if (s.preview || typeof s.messageCount === 'number') return false;
    const u = Date.parse(s.updatedAt), su = Date.parse(r.updatedAt);
    return isFinite(u) && (!isFinite(su) || u > su);
  }
  function later(l, r) {
    if (!l) return r;
    const lu = Date.parse(l.updatedAt), ru = Date.parse(r.updatedAt);
    let pick;
    if (lu !== ru) pick = ru > lu ? r : l;
    else { const lc = l.messageCount ?? -1, rc = r.messageCount ?? -1; pick = lc !== rc ? (rc > lc ? r : l) : (r.seenAt > l.seenAt ? r : l); }
    const seenAt = Math.max(l.seenAt, r.seenAt);
    const la = Date.parse(l.assistantActivityAt ?? ''), ra = Date.parse(r.assistantActivityAt ?? '');
    const aa = !isFinite(la) ? r.assistantActivityAt : !isFinite(ra) ? l.assistantActivityAt : ra > la ? r.assistantActivityAt : l.assistantActivityAt;
    return { ...pick, ...(aa ? { assistantActivityAt: aa } : {}), seenAt };
  }
  function merge(a, b) {
    if (!a) return b; if (!b) return a;
    const threads = { ...a.threads };
    for (const [k, r] of Object.entries(b.threads)) threads[k] = later(threads[k], r);
    const entries = Object.entries(threads).sort((x, y) => y[1].seenAt - x[1].seenAt || x[0].localeCompare(y[0])).slice(0, MAX);
    return { initializedAt: Math.min(a.initializedAt, b.initializedAt), threads: Object.fromEntries(entries) };
  }
  function readLocal() {
    try {
      const raw = localStorage.getItem(SEEN_KEY) ?? localStorage.getItem(SEEN_BASE); if (!raw) return null;
      const v = JSON.parse(raw); return isFinite(v.initializedAt) && v.threads && typeof v.threads === 'object' ? v : null;
    } catch (e) { return null; }
  }
  function writeLocal(state) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(state)); } catch (e) {} }

  /* ---- network ---- */
  const J = { 'Content-Type': 'application/json' };
  async function req(path, init = {}) {
    const r = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...init });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r;
  }
  /* Every thread Wizard lists (same endpoint, same paging). A full walk runs at boot and
   * every few minutes; in between only the recent pages are re-read and merged over it,
   * so the Chats list always holds the whole history, including the archive. */
  async function fetchSessions(full) {
    const out = []; let snapshot = '';
    for (let offset = 0; offset < 5000; ) {
      const q = `limit=100&offset=${offset}&include_children=false${snapshot ? `&snapshot=${encodeURIComponent(snapshot)}` : ''}`;
      const p = await (await req(`/wizard/hermes/api/sessions?${q}`)).json();
      if (!snapshot && typeof p.snapshot === 'string') snapshot = p.snapshot;
      const rows = p.data || p.sessions || p.items || [];
      out.push(...rows.map(normalize).filter(Boolean));
      offset += rows.length;
      const more = typeof p.has_more === 'boolean' ? p.has_more : typeof p.pagination?.has_more === 'boolean' ? p.pagination.has_more : rows.length >= 100;
      if (!more || !rows.length) return { sessions: out, complete: true };
      const oldest = Math.min(...rows.map(r => { const s = normalize(r); return s ? Date.parse(s.activityAt || s.updatedAt) || Infinity : Infinity; }));
      if (!full && oldest < Date.now() - 2 * WEEK) return { sessions: out, complete: false };
    }
    return { sessions: out, complete: true };
  }
  const FULL_EVERY = 3 * 60 * 1000;

  /* ---- Work sections: exact port of wizard-mobile src/workSections.ts ---- */
  const DAY = 864e5;
  // The owner's day: their time zone and day_starts_at from Wizard OS settings (WizConfig).
  const workDayStart = (now = Date.now()) => window.WizConfig.dayStart(now);
  const WORKING_SECTION = new Set(['submitting', 'queued', 'running', 'waiting_for_approval', 'stopping']);
  const isErr = s => s.status === 'failed' || s.status === 'interrupted';
  const needsApproval = s => s.status === 'waiting_for_approval';
  const inWorking = s => WORKING_SECTION.has(s.status) && !needsApproval(s) && !isErr(s);
  const firstValid = (...v) => v.find(x => isFinite(Date.parse(x ?? ''))) ?? '';
  const cardAt = s => inWorking(s) || isErr(s)
    ? firstValid(s.assignedAt, s.requestAt, s.lastUserAt, s.previewRole === 'user' ? s.previewAt : undefined)
    : firstValid(s.previewAt, s.activityAt, s.lastUserAt, s.updatedAt);
  const newestFirst = (l, r) => {
    const a = Date.parse(cardAt(l)), b = Date.parse(cardAt(r));
    if (isFinite(a) !== isFinite(b)) return isFinite(a) ? -1 : 1;
    return (isFinite(a) ? b - a : 0) || l.title.localeCompare(r.title);
  };
  const sectionTime = s => Math.max(...[s.restoredAt, s.assignedAt, s.previewAt, s.requestAt, s.activityAt, s.lastUserAt, s.updatedAt].map(v => Date.parse(v ?? '')).filter(isFinite));
  // Ready has two orders (James, 10 Oct 2026: "Newest … the newest appears at the top … another option, priority"):
  //   Newest   = approvals pinned, then pure recency, status labels ignored (groupWork's default).
  //   Priority = approvals, then needs you, then things to test, then everything else (newest first within each).
  // Status labels never move a thread between days (James, 11 Oct 2026: Ready, Yesterday and Past week stay
  // filtered by day in Newest and Priority); Priority only reorders within Ready.
  // Deferred threads sit at the bottom of Ready marked Deferred (James, 10 Oct 2026: "defer could just go at the
  // bottom of today … and just change the status to deferred"), whatever their day and in every order, until
  // restored or done.
  const isDeferred = s => !!s.deferred && !s.archived;
  const readyRank = s => needsApproval(s) ? 0 : isDeferred(s) ? 9 : s.attention?.state === 'needs_you' ? 1 : s.attention?.state === 'check' ? 2 : 3;
  const byPriority = list => list.slice().sort((l, r) => readyRank(l) - readyRank(r) || newestFirst(l, r));
  function groupWork(sessions, now = Date.now()) {
    const g = { errors: [], working: [], ready: [], yesterday: [], pastWeek: [], deferred: [], archive: [] };
    const readyB = workDayStart(now), yB = readyB - DAY, archB = now - WEEK;
    for (const s of sessions) {
      if (s.hidden) continue;
      const t = sectionTime(s);
      if (needsApproval(s)) g.ready.push(s);
      else if (inWorking(s)) g.working.push(s);
      else if (isDeferred(s)) g.ready.push(s);
      else if (isErr(s)) g.errors.push(s);
      else if (s.archived) g.archive.push(s);
      else if (isFinite(t) && t <= archB) g.archive.push(s);
      else if (!isFinite(t) || t < yB) g.pastWeek.push(s);
      else if (t < readyB) g.yesterday.push(s);
      else g.ready.push(s);
    }
    for (const list of Object.values(g)) list.sort(newestFirst);
    // Newest: approvals pinned, then recency; deferred threads always last (Priority re-sorts with readyRank).
    g.ready.sort((l, r) => Number(needsApproval(r)) - Number(needsApproval(l)) || Number(isDeferred(l)) - Number(isDeferred(r)) || newestFirst(l, r));
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

  /* ---- thread actions: Done / Close & file / Defer / Restore (controller.ts fileSession, setThreadDeferred, restoreSession) ----
   * Applied to the list at once (optimistic) and kept over refreshes until the write settles; a failed write puts
   * the thread back. Restoring an archived thread remembers when, in the key Wizard uses, so it lands in Ready. */
  const RESTORED_KEY = 'wizard.mobile.restored-threads.v1';
  const OVER = new Map(); // id -> { archived?, deferred?, restoredAt? } while a write is in flight
  const readRestored = () => { try { const v = JSON.parse(localStorage.getItem(RESTORED_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
  const writeRestored = v => { try { localStorage.setItem(RESTORED_KEY, JSON.stringify(v)); } catch (e) {} };
  function applyLocal(s) {
    const r = readRestored()[s.id];
    if (r && !s.deferred) {
      const latest = Math.max(...[s.lastUserAt, s.lastAssistantAt, s.activityAt].map(v => Date.parse(v ?? '')).filter(isFinite));
      if (s.archived || (isFinite(latest) && latest >= Date.parse(r))) { const all = readRestored(); delete all[s.id]; writeRestored(all); }
      else if (!s.restoredAt || Date.parse(r) > Date.parse(s.restoredAt)) s.restoredAt = r;
    }
    const o = OVER.get(s.id); if (o) Object.assign(s, o.patch);
    applyPend(s);
    // A Stop James asked for shows as “Stopping…” until Wizard reports the run settled (max 2 min).
    const st = s.runId && STOPPING.get(s.runId);
    if (st) { if (!WORKING.has(s.status) || Date.now() - st > 120000) STOPPING.delete(s.runId); else s.status = 'stopping'; }
  }
  const STOPPING = new Map();

  /* ---- a send puts its thread in Working at once (James, 10 Oct 2026: "move it out of the ready list immediately
   * and into working… I don't want to see the thread I just replied to in my feed and then have a UX update") ----
   * Every reply / new chat in the outbox holds its thread in Working, with a status that follows the message:
   * Sending… (leaving the phone) → Offline · will retry (Wizard unreachable) → Starting… (Wizard accepted it)
   * → Working (Wizard lists the run). The hold outlives stale list reads and releases to Wizard's own truth as soon
   * as Wizard reports this run (its idempotency key = the outbox item id); 2 min after acceptance it releases anyway.
   * A message that truly can't be sent puts the thread back where it was (the pill keeps Retry/Edit). */
  const PEND = new Map(); // sessionId -> { key, kind, text, at, state: 'sending'|'waiting'|'sent', sentAt, runId }
  const PEND_MAX = 2 * 60e3;
  // Released only on Wizard's own word for THIS message (run idempotency key = outbox item id): no clock comparisons.
  // (or Wizard lists the very run it accepted for it, as working).
  const confirmed = (s, p) => {
    const st = s.orig ? s.orig.status : s.status, run = s.orig ? s.orig.runId : s.runId;
    return (!!p.key && s.lastRunKey === p.key) || (!!p.runId && run === p.runId && WORKING.has(st));
  };
  /* The send tap itself (James, 10 Oct 2026: "the thread I just exited moving to working immediately… It should just
   * automatically disappear" from Ready). An orb send reaches the outbox only after transcription and routing (seconds,
   * longer on a bad line), so the thread is held in Working from the tap: replaced by the outbox item the moment it
   * exists, released if the take turns out empty or becomes a phone command, and never longer than TAP_MAX. */
  const TAPS = new Map(); // sessionId -> { at, until }
  const TAP_MAX = 60e3;
  const RELEASED = new Set(); // outbox item ids whose hold is over (so a later outbox change doesn't re-hold them)
  function applyPend(s) {
    const p = PEND.get(s.id);
    if (p && (confirmed(s, p) || (p.sentAt && Date.now() - p.sentAt > PEND_MAX))) { RELEASED.add(p.key); PEND.delete(s.id); unPend(s); return; }
    if (!p) { if (s.pend !== undefined) unPend(s); return; }
    if (!s.orig) s.orig = { status: s.status, runId: s.runId, assignedAt: s.assignedAt, requestAt: s.requestAt };
    const at = new Date(p.at).toISOString();
    // Already working (a message into a live run) keeps Wizard's status; anything else is held in Working.
    if (!WORKING.has(s.orig.status) && s.orig.status !== 'waiting_for_approval') {
      s.status = p.state === 'sent' ? 'running' : 'submitting';
      s.runId = p.runId || ''; // never an older finished run (a quick second reply must not try to steer it)
      s.assignedAt = at; s.requestAt = at;
    }
    // What the row says: Sending… → (Offline · will retry) → Starting… → (Wizard reports the run) Working.
    s.pend = p.state === 'sent' ? 'starting' : p.state;
    s.pendText = p.text; // shown in the row; s.preview stays Wizard's so read-state fingerprints are untouched
  }
  function unPend(s) {
    if (s.orig) { for (const [k, v] of Object.entries(s.orig)) { if (v === undefined) delete s[k]; else s[k] = v; } }
    delete s.orig; delete s.pend; delete s.pendText;
  }
  // Re-read the outbox: which threads are held, and in what state. Returns true when anything changed.
  function syncPending(OB) {
    const before = [...PEND].map(([k, p]) => k + p.key + p.state).join();
    const latest = new Map();
    for (const it of OB._items.values()) {
      if ((it.kind !== 'reply' && it.kind !== 'new') || !it.sessionId) continue;
      const cur = latest.get(it.sessionId); if (!cur || it.createdAt > cur.createdAt) latest.set(it.sessionId, it);
    }
    for (const [sid, p] of PEND) if (!latest.has(sid) && p.state !== 'sent') PEND.delete(sid); // deleted / taken back to edit
    for (const [sid, it] of latest) {
      const tap = TAPS.get(sid); if (tap && it.createdAt >= tap.at) TAPS.delete(sid); // the message itself takes over
      const known = PEND.get(sid);
      const drop = it.state === 'failed' || it.state === 'empty' || (it.state === 'sent' && it.steered);
      if (drop) { PEND.delete(sid); continue; }
      if (RELEASED.has(it.id) || (it.state === 'sent' && !known && Date.now() - (it.sentAt || 0) > PEND_MAX)) { if (known?.key === it.id) PEND.delete(sid); continue; } // already settled
      const text = String(it.text || it.typed || '').replace(/\s+/g, ' ').trim() || (it.audio || it.audioFile ? '🎙 Voice note' : (it.files || []).length ? '📎 Attachment' : '');
      PEND.set(sid, { key: it.id, kind: it.kind, text, at: it.createdAt, state: it.state === 'sent' ? 'sent' : it.state === 'waiting' ? 'waiting' : 'sending', sentAt: it.sentAt || 0, runId: it.runId || '' });
    }
    // An orb send still being transcribed/routed: Working from the send tap (outranks an older message's state).
    for (const [sid, t] of TAPS) {
      if (Date.now() > t.until) { TAPS.delete(sid); if (PEND.get(sid)?.key === 'tap:' + t.at) PEND.delete(sid); continue; }
      PEND.set(sid, { key: 'tap:' + t.at, kind: 'reply', text: '🎙 Voice reply', at: t.at, state: 'sending', sentAt: 0, runId: '' });
    }
    for (const [sid, p] of PEND) if (String(p.key).startsWith('tap:') && !TAPS.has(sid)) PEND.delete(sid);
    // Apply to the list in hand: held threads get the overlay, released ones go back, new chats get a row.
    for (const s of L.sessions) if (PEND.has(s.id) || s.pend !== undefined) applyPend(s);
    L.sessions = L.sessions.filter(s => !(s.synthetic && !PEND.has(s.id)));
    addSynthetic(L.sessions);
    return before !== [...PEND].map(([k, p]) => k + p.key + p.state).join();
  }
  // A new chat is listed before Wizard has created it, so it lands in Working the moment it is sent.
  function addSynthetic(list) {
    for (const [sid, p] of PEND) {
      if (p.kind !== 'new' || list.some(s => s.id === sid)) continue;
      const at = new Date(p.at).toISOString();
      const s = { id: sid, runtime: 'direct', title: (p.text || 'New chat').slice(0, 60), status: 'submitting', updatedAt: at, preview: p.text, previewRole: 'user', source: 'wizard-mobile', optimistic: true, synthetic: true };
      list.unshift(s); applyPend(s);
    }
  }
  const commandId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  /* ---- store ---- */
  const L = {
    ok: false, error: '', sessions: [], seen: readLocal(), deferred: {}, at: 0, listeners: new Set(), loading: null,
    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    emit() { for (const fn of this.listeners) { try { fn(this); } catch (e) { console.error(e); } } },
    isNew(s) { return hasNew(s, this.seen); },
    workGroups(sessions, now) { return groupWork(sessions || this.sessions, now); },
    readyByPriority: byPriority,
    cardAt,
    groups() {
      const now = Date.now(), needs = [], ready = [], working = [];
      for (const s of this.sessions) {
        if (s.archived || s.hidden) continue;
        const def = this.deferred[keyOf(s)]?.deferred;
        if (s.status === 'waiting_for_approval') { needs.push(s); continue; }
        if (WORKING.has(s.status)) { working.push(s); continue; }
        if (def) continue;
        const at = Date.parse(s.lastAssistantAt || s.activityAt || s.updatedAt);
        if (isFinite(at) && at < now - WEEK) continue;
        if (!hasNew(s, this.seen)) continue;
        if (s.status === 'failed' || s.status === 'interrupted' || s.critical) needs.push(s); else ready.push(s);
      }
      const t = s => Date.parse(s.lastAssistantAt || s.activityAt || s.updatedAt) || 0;
      for (const g of [needs, ready, working]) g.sort((a, b) => t(b) - t(a));
      return { needs, ready, working };
    },
    async refresh() {
      if (this.loading) return this.loading;
      this.loading = (async () => {
        try {
          const started = Date.now();
          const full = !this.fullAt || Date.now() - this.fullAt > FULL_EVERY;
          const [got, deferred, remote] = await Promise.all([fetchSessions(full), fetchDispositions(), fetchSeen().catch(() => null)]);
          let sessions = got.sessions;
          window.WosModels?.reconcile(sessions);
          if (got.complete) this.fullAt = Date.now();
          else { const fresh = new Set(sessions.map(s => s.id)); sessions = sessions.concat(this.sessions.filter(s => !fresh.has(s.id) && !s.optimistic)); }
          for (const s of sessions) {
            const d = deferred[keyOf(s)];
            delete s.deferred; delete s.restoredAt;
            if (d) { if (d.deferred) s.deferred = true; else s.restoredAt = d.updatedAt; }
            applyLocal(s);
          }
          // A settled action stays applied until a list read that started after it lands.
          for (const [k, o] of OVER) if (o.settled && o.settled < started) OVER.delete(k);
          addSynthetic(sessions);
          this.sessions = sessions; this.deferred = deferred;
          let merged = merge(readLocal(), merge(this.seen, remote));
          if (!merged) { // first run anywhere: everything currently visible counts as read
            const ts = Date.now(); merged = { initializedAt: ts, threads: Object.fromEntries(sessions.slice(0, MAX).map(s => [keyOf(s), recordFor(s, ts)])) };
            putSeen(merged).catch(() => {});
          }
          this.seen = merged; writeLocal(merged);
          this.ok = true; this.error = ''; this.at = Date.now();
        } catch (e) { this.error = e.status === 403 ? 'access' : 'offline'; }
        finally { this.loading = null; this.emit(); }
      })();
      return this.loading;
    },
    markSeen(ids) {
      const list = (Array.isArray(ids) ? ids : [ids]).map(id => this.sessions.find(s => s.id === id)).filter(Boolean);
      if (!list.length) return;
      const ts = Date.now();
      let state = merge(readLocal(), this.seen) || { initializedAt: ts, threads: {} };
      const threads = { ...state.threads };
      for (const s of list) threads[keyOf(s)] = recordFor(s, ts);
      state = { ...state, threads };
      this.seen = state; writeLocal(state); this.emit();
      putSeen(state).then(r => { this.seen = merge(this.seen, r); writeLocal(this.seen); this.emit(); }).catch(() => {});
    },
    session(id) { return this.sessions.find(s => s.id === id) || null; },
    chatUrl(id) { return id ? `/wizard/?session=${encodeURIComponent(id)}` : '/wizard/?view=work'; },
    /* A real Archimedes request: same admission path the Wizard app uses.
     * `instructions` rides as Hermes's per-run ephemeral system prompt: the agent
     * sees which view James was looking at, the thread itself stays clean. */
    async send(input, opts = {}) {
      const M = window.WosModels;
      if (!M) throw new Error('Model selector unavailable · reload Wizard');
      const route = await M.resolveRoute(M.snapshot('', opts.model ? { model: opts.model, provider: opts.provider } : null));
      const id = `wizard_${Date.now()}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
      await req('/wizard/hermes/api/sessions', { method: 'POST', headers: J, body: JSON.stringify({ source: 'wizard-mobile', id }) });
      const body = { session_id: id, input, ...route, require_model_lock: true };
      if (opts.instructions) body.instructions = String(opts.instructions).slice(0, 2000);
      if (opts.fileIds?.length) body.wizard_file_ids = opts.fileIds.slice(0, 8);
      const r = await req('/wizard/hermes/v1/runs', { method: 'POST', headers: { ...J, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
      const run = await r.json().catch(() => ({}));
      const runId = run.run_id || run.id || '';
      this.sessions.unshift({ id, runtime: 'direct', title: input.slice(0, 60), status: 'running', runId, updatedAt: new Date().toISOString(), lastUserAt: new Date().toISOString(), preview: input, source: 'wizard-mobile' });
      this.emit(); setTimeout(() => this.refresh(), 4000);
      return { sessionId: id, runId };
    },
    /* Reply inside an existing thread: steer the live run, or start a new run. */
    async reply(id, input, opts = {}) {
      const M = window.WosModels;
      if (!M) throw new Error('Model selector unavailable · reload Wizard');
      const route = await M.resolveRoute(M.snapshot(id, opts.model ? { model: opts.model, provider: opts.provider } : null));
      const s = this.session(id);
      if (s && WORKING.has(s.status) && s.runId) {
        try {
          const active = await (await req(`/wizard/hermes/v1/runs/${encodeURIComponent(s.runId)}`)).json();
          if (!M.matchesRuntime(active.runtime, route))
            throw Object.assign(new Error('Queue on the selected model'), { status: 409 });
          const steer = { input, ...route, require_model_lock: true };
          if (opts.fileIds?.length) steer.wizard_file_ids = opts.fileIds.slice(0, 8);
          await req(`/wizard/hermes/v1/runs/${encodeURIComponent(s.runId)}/steer`, { method: 'POST', headers: J, body: JSON.stringify(steer) });
          return { steered: true, runId: s.runId };
        } catch (e) { if (![404, 409, 410].includes(e.status)) throw e; }
      }
      const body = { session_id: id, input, ...route, require_model_lock: true };
      if (opts.instructions) body.instructions = String(opts.instructions).slice(0, 2000);
      if (opts.fileIds?.length) body.wizard_file_ids = opts.fileIds.slice(0, 8);
      const r = await req('/wizard/hermes/v1/runs', { method: 'POST', headers: { ...J, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
      const run = await r.json().catch(() => ({}));
      const runId = run.run_id || run.id || '';
      if (s) Object.assign(s, { status: 'running', runId, lastUserAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      this.emit(); setTimeout(() => this.refresh(), 3000);
      return { steered: false, runId };
    },
    /* Full message history of one thread (oldest first), paged like Wizard. */
    async messages(id) {
      const rows = [];
      for (let offset = 0; offset < 5000; offset += 500) {
        const p = await (await req(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}/messages?order=oldest&limit=500&offset=${offset}&include_compacted=true&view=wizard`)).json();
        const page = p.data || p.messages || p.items || [];
        rows.push(...page);
        const n = Number(p.pagination?.returned ?? page.length);
        if (!isFinite(n) || n < 500 || !page.length) break;
      }
      return rows;
    },
    async sessionInfo(id) {
      const p = await (await req(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}`)).json();
      const s = normalize(p.session || p); if (!s) return null;
      const i = this.sessions.findIndex(x => x.id === id);
      if (i >= 0) this.sessions[i] = { ...this.sessions[i], ...s }; else this.sessions.push(s);
      applyLocal(this.sessions[i >= 0 ? i : this.sessions.length - 1]);
      return s;
    },
    /* ---- thread actions ---- */
    busy(id) { const o = OVER.get(id); return !!o && !o.settled; },
    async _act(id, patch, write) {
      const s = this.session(id); if (!s || this.busy(id)) return false;
      const snap = { archived: s.archived, deferred: s.deferred, restoredAt: s.restoredAt };
      const entry = { patch }; OVER.set(id, entry); Object.assign(s, patch); this.emit();
      try { await write(s); entry.settled = Date.now(); this.emit(); setTimeout(() => this.refresh(), 50); return true; }
      catch (e) {
        if (OVER.get(id) === entry) OVER.delete(id);
        const c = this.session(id);
        if (c) { Object.assign(c, snap); if (snap.deferred === undefined) delete c.deferred; if (snap.restoredAt === undefined) delete c.restoredAt; }
        this.emit(); return false;
      }
    },
    // Done: archive the thread (PATCH archived). Close & file: the Helm filing route, idempotent by command id.
    archive(id, { file = false } = {}) {
      return this._act(id, { archived: true, deferred: false }, async s => {
        const all = readRestored(); if (all[id]) { delete all[id]; writeRestored(all); }
        if (!file) { await req(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', headers: J, body: JSON.stringify({ archived: true }) }); return; }
        let r = await fetch('/wizard/filings', { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: J, body: JSON.stringify({ session_id: id, client_command_id: commandId(), runtime: s.runtime || 'direct' }) });
        const until = Date.now() + 10 * 60000; let wait = 500;
        while (r.status === 202 && Date.now() < until) {
          await new Promise(res => setTimeout(res, wait)); wait = Math.min(2000, wait + 250);
          r = await fetch(`/wizard/filings/${encodeURIComponent(id)}/status`, { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: J, body: JSON.stringify({ runtime: s.runtime || 'direct' }) });
        }
        if (!r.ok || r.status === 202) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      });
    },
    async _defer(id, deferred) {
      const s = this.session(id); if (!s) throw new Error('gone');
      const p = await (await req('/wizard/thread-dispositions', { method: 'PUT', headers: J, body: JSON.stringify({ sessionId: id, runtime: s.runtime || 'direct', deferred }) })).json();
      if (p?.record?.deferred !== deferred || !isFinite(Date.parse(p.record.updatedAt))) throw new Error('Thread disposition was not saved.');
      this.deferred[keyOf(s)] = p.record;
      return p.record;
    },
    defer(id) { return this._act(id, { deferred: true }, () => this._defer(id, true)); },
    /* Rename: James's own title for a thread. It locks the name: the agent never renames it after this. */
    async rename(id, title) {
      const s = this.session(id), t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!s || !t || this.busy(id)) return false;
      if (t === s.title) return true;
      const before = { title: s.title };
      Object.assign(s, { title: t }); this.emit();
      try {
        const r = await fetch(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t }) });
        if (!r.ok) { let msg = ''; try { msg = (await r.json())?.error?.message || ''; } catch (e) {} throw Object.assign(new Error(msg || 'rename failed'), { status: r.status }); }
        setTimeout(() => this.refresh(), 50); return true;
      } catch (e) { const c = this.session(id); if (c) Object.assign(c, before); this.emit(); return /already in use/i.test(e.message) ? 'taken' : false; }
    },
    // Restore: a deferred thread comes back to Work; an archived (or aged-out) one is un-archived and lands in Ready.
    restore(id) {
      const s = this.session(id); if (!s) return Promise.resolve(false);
      const at = new Date().toISOString();
      if (s.deferred && !s.archived) return this._act(id, { deferred: false, restoredAt: at }, () => this._defer(id, false));
      return this._act(id, { archived: false, deferred: false, restoredAt: at }, async () => {
        await req(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', headers: J, body: JSON.stringify({ archived: false }) });
        writeRestored({ ...readRestored(), [id]: at });
      });
    },
    /* ---- the live run: status, approval, stop (api.ts run/approve/stop) ---- */
    async run(runId) { return (await req(`/wizard/hermes/v1/runs/${encodeURIComponent(runId)}`)).json(); },
    async approve(runId, choice, requestId) {
      const body = { choice }; if (requestId) body.request_id = requestId;
      await req(`/wizard/hermes/v1/runs/${encodeURIComponent(runId)}/approval`, { method: 'POST', headers: J, body: JSON.stringify(body) });
    },
    async stop(runId) {
      await req(`/wizard/hermes/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' });
      STOPPING.set(runId, Date.now());
      const s = this.sessions.find(x => x.runId === runId); if (s) { applyLocal(s); this.emit(); }
      setTimeout(() => this.refresh(), 2500);
    },
  };
  // Wizard (in its desk, or another tab) writes the same key when a chat is opened.
  addEventListener('storage', e => { if (e.key === SEEN_KEY || e.key === SEEN_BASE) { L.seen = merge(L.seen, readLocal()); L.emit(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) L.refresh(); });
  setInterval(() => { if (!document.hidden) L.refresh(); }, 15000);
  // outbox.js loads after this file: follow it once every script has run.
  function attachOutbox() {
    const OB = window.WosOutbox; if (!OB || L._outbox) return; L._outbox = true;
    const sync = () => { if (syncPending(OB)) L.emit(); };
    OB.onChange(sync); OB.load().then(sync).catch(() => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attachOutbox); else setTimeout(attachOutbox, 0);
  L.pending = id => PEND.get(id) || null;
  const resync = () => { const OB = window.WosOutbox; if (OB && syncPending(OB)) L.emit(); };
  // Returns a token for releaseSend. '__new__' has no row to move (a new chat is listed once it is in the outbox).
  L.holdSend = sid => {
    if (!sid || sid === '__new__') return null;
    const t = { sid, at: Date.now(), until: Date.now() + TAP_MAX }; TAPS.set(sid, t);
    resync(); setTimeout(resync, TAP_MAX + 50);
    return t;
  };
  L.releaseSend = t => { if (t && TAPS.get(t.sid) === t) { TAPS.delete(t.sid); resync(); } };
  window.WizLive = L;
  window.__wizLiveInternals = { hasNew, recordFor, merge, fingerprint, normalize };
})();
