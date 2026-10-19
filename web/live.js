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
  const READY_OR_ATTENTION = new Set(['completed', 'failed', 'interrupted', 'waiting_for_approval', 'unknown']);
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
    if (item.listVersion === 1) return { safeError:'', critical:false, waitingOn:'', helperStatus:null, attention:null, ...item, runtime: 'direct', request: '', renames: [], detailNeeded: true };
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
      safeError: typeof item.wizard_safe_error === 'string' ? item.wizard_safe_error : '',
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
      helperStatus: item.wizard_helper_status && typeof item.wizard_helper_status === 'object' ? item.wizard_helper_status : null,
      // What the finished thread asks of James (the agent's hidden status line): needs_you / check / done / fyi.
      attention: attentionOf(item.wizard_attention),
      // Thread titles (Agent Service thread-titles.mjs): every rename with its time, so the thread shows
      // "Renamed from …" right after the reply that renamed it. The list shows only the current title.
      renames: Array.isArray(item.wizard_title_renames) ? item.wizard_title_renames.filter(r => r && typeof r.from === 'string' && isFinite(r.at)).slice(-6).map(r => ({ from: r.from.slice(0, 120), to: String(r.to || '').slice(0, 120), at: Number(r.at), by: r.by === 'you' ? 'you' : 'agent' })) : [],
      // The thread's model route (chat-models.js shows and changes it).
      model: typeof item.model === 'string' ? item.model : '', provider: typeof item.provider === 'string' ? item.provider : '',
      modelLockAt: Number(item.wizard_model_lock_updated_at) || 0,
      // The last thing asked (Retry on a failed thread sends it again: controller.ts retryServerFailedSession).
      request: typeof item.wizard_retry_input === 'string' ? item.wizard_retry_input : userText,
      // Agents MVP: the agent this thread is pinned to (server metadata). '' = the main agent.
      agent: typeof item.agent === 'string' ? item.agent : item.agent && typeof item.agent === 'object' && typeof item.agent.id === 'string' ? item.agent.id : '',
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
    if (!r.ok) { let detail; try { detail = (await r.json()).error; } catch {} const e = new Error(detail?.message || 'HTTP ' + r.status); e.status = r.status; e.code = detail?.code; throw e; }
    return r;
  }
  /* Every thread Wizard lists (same endpoint, same paging). A full walk runs at boot and
   * every few minutes; in between only the first page is re-read and merged over it,
   * so the Chats list always holds the whole history, including the archive.
   * Battery (14 Oct 2026): the list is ordered by last activity, so any thread that changes
   * rises to page 1. The between-walk poll used to re-read ~6 pages (~1 MB) every 15 s;
   * one page carries the same news. The full walk still catches edits that don't bump activity. */
  const LIST_SUPPORT = new Map(), DETAIL = new Map();
  async function fetchSessions(full, agent = '', onFirst = null) {
    const out = []; let snapshot = '', meta = null, resets = 0;
    const overrides = JSON.stringify(listOverrides(agent));
    for (let offset = 0; offset < 100000; ) {
      const slim = LIST_SUPPORT.get(agent) !== false;
      const q = `${slim ? `view=list&window=archive-50&overrides=${encodeURIComponent(overrides)}&` : ''}limit=100&offset=${offset}&include_children=false${snapshot ? `&snapshot=${encodeURIComponent(snapshot)}` : ''}${agent ? `&agent=${encodeURIComponent(agent)}` : ''}`;
      let p;
      try { p = await (await req(`/wizard/hermes/api/sessions?${q}`)).json(); }
      catch (e) {
        if (slim && offset === 0 && [400,404].includes(e.status)) { LIST_SUPPORT.set(agent,false); continue; }
        if (offset > 0 && e.status === 409 && resets++ < 1) { offset=0; snapshot=''; out.length=0; continue; }
        throw e;
      }
      if (slim && p.list_version === 1 && p.window !== 'archive-50') { LIST_SUPPORT.set(agent,false); snapshot=''; out.length=0; offset=0; continue; }
      if (p.list_version === 1) LIST_SUPPORT.set(agent,true);
      if (!snapshot && typeof p.snapshot === 'string') snapshot = p.snapshot;
      if (p.window === 'archive-50') meta = { archiveTotal:p.archive_total, archiveReturned:p.archive_returned, cursor:p.archive_cursor };
      const rows = p.data || p.sessions || p.items || [];
      out.push(...rows.map(normalize).filter(Boolean));
      offset += rows.length;
      const more = typeof p.has_more === 'boolean' ? p.has_more : typeof p.pagination?.has_more === 'boolean' ? p.pagination.has_more : rows.length >= 100;
      if (!more) return { sessions:out, complete:true, meta };
      if (!rows.length) throw new Error('Incomplete session window');
      if (!full) return { sessions:out, complete:false, meta };
      if (onFirst && offset === rows.length) await onFirst({ sessions:out.slice(), complete:false, meta });
    }
    throw new Error('Session window limit reached');
  }
  const FULL_EVERY = 3 * 60 * 1000;
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
  // The owner's day: their time zone and day_starts_at from Wizard OS settings (WizConfig).
  const workDayStart = (now = Date.now()) => window.WizConfig.dayStart(now);
  const WORKING_SECTION = new Set(['submitting', 'queued', 'running', 'waiting_for_approval', 'stopping']);
  const isErr = s => s.status === 'failed' || s.status === 'interrupted';
  const needsApproval = s => ['waiting_for_approval', 'unknown'].includes(s.status);
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
  // Opinionated: auto-archive age is the owner's choice (Archive header selector); 0 = never. Default one week.
  const ARCH_KEY = 'wos.chats.archiveAfter.v1';
  // Chat-list layout: 'day' (Ready = today, then Yesterday, Past week; the default) or 'status' (Working / Ready / Archive).
  const LAYOUT_KEY = 'wos.chats.layout.v1';
  const chatLayout = () => { try { return localStorage.getItem(LAYOUT_KEY) === 'status' ? 'status' : 'day'; } catch (e) { return 'day'; } };
  const archiveAfterDays = () => { try { const v = localStorage.getItem(ARCH_KEY); if (v != null && isFinite(+v)) return +v; } catch (e) {} return 7; };
  // Agent Service owns box-wide preferences. localStorage is only an offline cache.
  const PREFS_URL = '/wizard/v1/ui-preferences';
  let prefsWrites = Promise.resolve(), prefsPending = 0, prefsRevision = 0;
  const prefsFields = {
    archiveAfterDays: ['wos.chats.archiveAfter.v1', v => Number.isInteger(v) && [0, 1, 3, 7, 14, 30].includes(v), String],
    compact: ['wos.chats.compact.v1', v => typeof v === 'boolean', v => v ? '1' : '0'],
    chatLayout: ['wos.chats.layout.v1', v => v === 'day' || v === 'status', String],
    readyOrder: ['wos.chats.readyOrder.v1', v => ['newest', 'oldest', 'priority', 'subject'].includes(v), String],
    subjectOrder: ['wos.chats.subjectOrder.v1', v => Array.isArray(v) && v.every(x => typeof x === 'string'), JSON.stringify],
  };
  let prefsOff = false;
  const putPrefs = patch => {
    if (prefsOff) return prefsWrites;
    prefsPending++; prefsRevision++;
    prefsWrites = prefsWrites.then(async () => {
      try {
        const r = await req(PREFS_URL, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
        if (r.status === 404) { prefsOff = true; return; } // this Agent Service has no shared preferences yet: keep the choice on this device, quietly
        if (!r.ok) throw new Error('Preferences unavailable');
      } catch (e) { window.dispatchEvent(new Event('wos:prefs-error')); }
      finally { prefsPending--; }
    });
    return prefsWrites;
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
      let changed = false;
      for (const [name, [key, valid, encode]] of Object.entries(prefsFields)) if (valid(j[name])) {
        const value = encode(j[name]);
        if (localStorage.getItem(key) !== value) { localStorage.setItem(key, value); changed = true; }
      }
      if (changed) window.dispatchEvent(new Event('wos:prefs'));
    } catch (e) { /* Older/offline service: retain this device's cached choice, never reset it. */ }
  };
  pullPrefs(); setInterval(pullPrefs, 30000);
  try { addEventListener('focus', pullPrefs); } catch (e) {}
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
    const readyB = workDayStart(now), yB = readyB - DAY, archDays = archiveAfterDays(), archB = archDays ? now - archDays * DAY : -Infinity;
    for (const s of sessions) {
      if (s.hidden) continue;
      const t = sectionTime(s);
      if (needsApproval(s)) g.ready.push(s);
      else if (inWorking(s)) g.working.push(s);
      else if (isDeferred(s)) g.ready.push(s);
      else if (isErr(s)) g.errors.push(s);
      else if (s.archived) g.archive.push(s);
      else if (isFinite(t) && t <= archB) g.archive.push(s);
      else if (chatLayout() === 'status') g.ready.push(s); // By status: everything not yet archived is Ready
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
    if (!WORKING.has(s.orig.status) && !['waiting_for_approval', 'unknown'].includes(s.orig.status)) {
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
      if ((it.kind !== 'reply' && it.kind !== 'new') || !it.sessionId || it.compact) continue;
      const tap = TAPS.get(it.sessionId); if (tap && it.createdAt >= tap.at) TAPS.delete(it.sessionId);
      // Custody without delivery intent must neither own Sending nor hide an older real send.
      if (OB.quarantined?.(it.id) || ['failed', 'empty', 'held', 'unconfirmed'].includes(it.state) || (it.state === 'sent' && it.steered)) continue;
      const cur = latest.get(it.sessionId); if (!cur || it.createdAt > cur.createdAt) latest.set(it.sessionId, it);
    }
    for (const [sid, p] of PEND) if (!latest.has(sid)) PEND.delete(sid); // deleted / taken back to edit
    for (const [sid, it] of latest) {
      const known = PEND.get(sid);
      if (RELEASED.has(it.id) || (it.state === 'sent' && !known && Date.now() - (it.sentAt || 0) > PEND_MAX)) { if (known?.key === it.id) PEND.delete(sid); continue; } // already settled
      const text = String(it.text || it.typed || '').replace(/\s+/g, ' ').trim() || (it.audio || it.audioFile ? '🎙 Voice note' : (it.files || []).length ? '📎 Attachment' : '');
      if (it.agent && otherAgent(it.agent)) AGENT_OF.set(sid, it.agent);
      PEND.set(sid, { key: it.id, kind: it.kind, text, at: it.createdAt, state: it.state === 'sent' ? 'sent' : it.state === 'waiting' ? 'waiting' : 'sending', sentAt: it.sentAt || 0, runId: it.runId || '', agent: it.agent && otherAgent(it.agent) ? it.agent : '' });
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
    for (const [a, list] of Object.entries(L.agentSessions)) {
      for (const s of list) if (PEND.has(s.id) || s.pend !== undefined) applyPend(s);
      L.agentSessions[a] = list.filter(s => !(s.synthetic && !PEND.has(s.id)));
      addSynthetic(L.agentSessions[a], a);
    }
    return before !== [...PEND].map(([k, p]) => k + p.key + p.state).join();
  }
  // A new chat is listed before Wizard has created it, so it lands in Working the moment it is sent.
  function addSynthetic(list, agent = '') {
    for (const [sid, p] of PEND) {
      if (p.kind !== 'new' || (p.agent || '') !== agent || list.some(s => s.id === sid)) continue;
      const at = new Date(p.at).toISOString();
      const s = { id: sid, runtime: 'direct', title: (p.text || 'New chat').slice(0, 60), status: 'submitting', updatedAt: at, preview: p.text, previewRole: 'user', source: 'wizard-mobile', optimistic: true, synthetic: true, agent };
      list.unshift(s); applyPend(s);
    }
  }
  const commandId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  /* ---- last list snapshot (James, 18 Oct 2026) ----
   * Chats opens on the list this device last saw, marked "Updating…", while the fresh read runs, instead of an empty
   * "Connecting to Wizard…" box. The main agent's threads only: a private agent's rows are never written to storage
   * (they merge in from that agent as before). Newest SNAP_N threads, long text clipped; written at most once a
   * minute and when the page is hidden. Nothing is ever sent from it: every action re-reads the live list. */
  const SNAP_KEY = `wos.chats.snapshot.v1:${SCOPE}`, SNAP_N = 150, SNAP_EVERY = 60 * 1000;
  const clipDeep = v => typeof v === 'string' ? (v.length > 600 ? v.slice(0, 600) : v) : v && typeof v === 'object' ? (Array.isArray(v) ? v.slice(0, 20).map(clipDeep) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clipDeep(x)]))) : v;
  function readSnap() {
    try {
      const v = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null');
      return v && v.schema === 1 && Array.isArray(v.sessions) && isFinite(v.at) ? v : null;
    } catch (e) { return null; }
  }
  function writeSnap(store) {
    if (!store.ok || store.cached) return;
    try {
      const act = s => Date.parse(s.activityAt || s.updatedAt || '') || 0;
      const rows = store.sessions.filter(s => s && s.id && !s.optimistic && !s.synthetic && !s.hidden && !(s.agent && otherAgent(s.agent)))
        .sort((a, b) => act(b) - act(a)).slice(0, SNAP_N).map(s => clipDeep(s.listVersion === 1 ? { ...s, request:'', renames:[], detailNeeded:true } : s));
      localStorage.setItem(SNAP_KEY, JSON.stringify({ schema: 1, at: store.at || Date.now(), sessions: rows, deferred: store.deferred || {} }));
      store.snapAt = Date.now();
    } catch (e) { try { localStorage.removeItem(SNAP_KEY); } catch (_) {} }
  }

  /* ---- store ---- */
  function listOverrides(agent = '') {
    const out = {}, scoped = id => (L.agentOf(id) || '') === (otherAgent(agent) ? agent : '');
    for (const [id, at] of Object.entries(readRestored())) if (scoped(id) && Date.now()-Date.parse(at)<WEEK) out[id]={restoredAt:at};
    for (const [key,d] of Object.entries(L.deferred)) {
      const id=key.replace(/^direct:/,''); if (!scoped(id)) continue;
      out[id]={...(d.deferred ? {deferred:true} : {restoredAt:d.updatedAt}),...out[id]};
    }
    for (const [id,o] of OVER) if (scoped(id)) {
      const fields={}; for (const k of ['archived','deferred','restoredAt']) if (o.patch[k] !== undefined) fields[k]=o.patch[k];
      out[id]={...out[id],...fields};
    }
    return out;
  }
  const L = {
    windows: {},
    ok: false, error: '', sessions: [], seen: readLocal(), deferred: {}, at: 0, listeners: new Set(), loading: null,
    // cached: the list on screen is the stored snapshot (cachedAt = when it was read live); cleared by the first fresh read.
    cached: false, cachedAt: 0, snapAt: 0,
    agentSessions: {}, agentStatus: {}, // non-default agents: id -> sessions / { ok, error, at }
    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    emit() { for (const fn of this.listeners) { try { fn(this); } catch (e) { console.error(e); } } },
    isNew(s) { return hasNew(s, this.seenOf(s)); },
    // A non-default agent's read state stays on this device (never PUT to the main agent's thread-seen store).
    seenOf(s) { return s && s.agent && otherAgent(s.agent) ? AGENT_SEEN : this.seen; },
    workGroups(sessions, now) { return groupWork(sessions || this.unified(), now); },
    readyByPriority: byPriority,
    get archiveAfterDays() { return archiveAfterDays(); },
    get chatLayout() { return chatLayout(); },
    set chatLayout(v) { const x = v === 'status' ? 'status' : 'day'; try { localStorage.setItem(LAYOUT_KEY, x); } catch (e) {} putPrefs({ chatLayout: x }); },
    set archiveAfterDays(d) { try { localStorage.setItem(ARCH_KEY, String(d)); } catch (e) {} putPrefs({ archiveAfterDays: d }); },
    putPrefs,
    cardAt,
    groups(agent = '') {
      const now = Date.now(), needs = [], ready = [], working = [];
      for (const s of this.sessionsFor(agent)) {
        if (s.archived || s.hidden) continue;
        const def = this.deferred[keyOf(s)]?.deferred;
        if (['waiting_for_approval', 'unknown'].includes(s.status)) { needs.push(s); continue; }
        if (WORKING.has(s.status)) { working.push(s); continue; }
        if (def) continue;
        const at = Date.parse(s.lastAssistantAt || s.activityAt || s.updatedAt);
        if (isFinite(at) && at < now - WEEK) continue;
        if (!hasNew(s, this.seenOf(s))) continue;
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
          const side = Promise.all([fetchDispositions(), fetchSeen().catch(() => null)]);
          const apply = (got, deferred, remote) => {
          // The main list holds the main agent's threads only, even if a server ever lists another agent's here.
          if (got.meta) this.windows.hermes = got.meta;
          let sessions = got.sessions.filter(s => !otherAgent(s.agent));
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
          this.ok = true; this.error = ''; this.at = Date.now(); this.cached = false;
          };
          // Only a cold list paints early; a later full walk replaces a list that is already on screen in one go.
          // A first run anywhere (no read state on device or server) waits for the whole list, which it marks read.
          const early = (!this.ok || this.cached) && full ? async page => { const [d, r] = await side; if (!merge(readLocal(), merge(this.seen, r))) return; apply(page, d, r); this.emit(); } : null;
          const got = await fetchSessions(full, '', early);
          const [deferred, remote] = await side;
          apply(got, deferred, remote);
          if (Date.now() - this.snapAt > SNAP_EVERY) writeSnap(this);
          // Other agents' threads merge in after the main list is on screen; one slow agent never holds Chats.
          this.emit();
          await this.refreshAgents(deferred);
        } catch (e) { this.error = e.status === 403 ? 'access' : 'offline'; }
        finally { this.loading = null; this.emit(); }
      })();
      return this.loading;
    },
    /* Each non-default agent's threads, from that agent (agent=<id>). One agent failing never hides another. */
    async refreshAgents(deferred = this.deferred) {
      const A = AG(); if (!A) return;
      if (!A.ready) await A.load().catch(() => {});
      const ids = A.others().map(a => a.id);
      for (const k of Object.keys(this.agentSessions)) if (!ids.includes(k)) { delete this.agentSessions[k]; delete this.agentStatus[k]; }
      await Promise.all(ids.map(async id => {
        try {
          const got = await fetchSessions(true, id);
          if (got.meta) this.windows[id] = got.meta;
          const list = got.sessions.filter(s => !s.agent || s.agent === id).map(s => { s.agent = id; AGENT_OF.set(s.id, id); return s; });
          for (const s of list) {
            const d = deferred[keyOf(s)];
            delete s.deferred; delete s.restoredAt;
            if (d) { if (d.deferred) s.deferred = true; else s.restoredAt = d.updatedAt; }
            applyLocal(s);
          }
          addSynthetic(list, id);
          window.WosModels?.reconcile(list);
          this.agentSessions[id] = list; this.agentStatus[id] = { ok: true, error: '', at: Date.now() };
        } catch (e) {
          this.agentSessions[id] = this.agentSessions[id] || [];
          this.agentStatus[id] = { ok: false, error: e.status === 403 ? 'access' : 'offline', at: Date.now() };
        }
      }));
    },
    // The threads of one agent; '' (or the default agent) = the unified list the owner's main Chats shows.
    sessionsFor(agent = '') { return otherAgent(agent) ? (this.agentSessions[agent] || []) : this.unified(); },
    // Every agent's threads, main first; an id listed by two agents counts once. Order is the caller's (groupWork sorts).
    unified() {
      const extra = Object.entries(this.agentSessions).filter(([a, list]) => otherAgent(a) && list.length);
      if (!extra.length) return this.sessions;
      const seen = new Set(this.sessions.map(s => s.id)), out = this.sessions.slice();
      for (const [, list] of extra) for (const s of list) if (!seen.has(s.id)) { seen.add(s.id); out.push(s); }
      return out;
    },
    // A private agent's thread (by id): its rows carry the lock and its words never enter another agent's context.
    isPrivate(id) { const a = this.agentOf(id), A = AG(); return !!a && !!A && A.isPrivate(A.get(a)); },
    statusFor(agent = '') { return otherAgent(agent) ? (this.agentStatus[agent] || { ok: false, error: '' }) : { ok: this.ok, error: this.error, cached: this.cached, cachedAt: this.cachedAt, loading: !!this.loading }; },
    // The non-default agent a thread is pinned to, or '' for the main agent.
    agentOf(id) { if (!id || id === '__new__') return ''; const a = AGENT_OF.get(id); return a && otherAgent(a) ? a : ''; },
    pinAgent(id, agent) { if (id && agent && otherAgent(agent)) AGENT_OF.set(id, agent); },
    markSeen(ids) {
      const all = (Array.isArray(ids) ? ids : [ids]).map(id => this.session(id)).filter(Boolean);
      const ts = Date.now();
      const mine = all.filter(s => s.agent && otherAgent(s.agent));
      if (mine.length) { for (const s of mine) AGENT_SEEN.threads[keyOf(s)] = recordFor(s, ts); try { localStorage.setItem(AGENT_SEEN_KEY, JSON.stringify(AGENT_SEEN)); } catch (e) {} this.emit(); }
      const list = all.filter(s => !mine.includes(s));
      if (!list.length) return;
      let state = merge(readLocal(), this.seen) || { initializedAt: ts, threads: {} };
      const threads = { ...state.threads };
      for (const s of list) threads[keyOf(s)] = recordFor(s, ts);
      state = { ...state, threads };
      this.seen = state; writeLocal(state); this.emit();
      putSeen(state).then(r => { this.seen = merge(this.seen, r); writeLocal(this.seen); this.emit(); }).catch(() => {});
    },
    session(id) {
      const s = this.sessions.find(x => x.id === id); if (s) return s;
      for (const list of Object.values(this.agentSessions)) { const a = list.find(x => x.id === id); if (a) return a; }
      return DETAIL.get(id) || null;
    },
    chatUrl(id) { return id ? `/wizard/?session=${encodeURIComponent(id)}` : '/wizard/?view=work'; },
    /* A real Archimedes request: same admission path the Wizard app uses.
     * `instructions` rides as Hermes's per-run ephemeral system prompt: the agent
     * sees which view James was looking at, the thread itself stays clean. */
    async send(input, opts = {}) {
      const M = window.WosModels;
      if (!M) throw new Error('Model selector unavailable · reload Wizard');
      const agent = opts.agent && otherAgent(opts.agent) ? opts.agent : '';
      const route = await M.resolveRoute(M.snapshot('', opts.model ? { model: opts.model, provider: opts.provider } : null, agent));
      const id = `wizard_${Date.now()}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
      if (agent) AGENT_OF.set(id, agent);
      await req('/wizard/hermes/api/sessions' + aq(id), { method: 'POST', headers: J, body: JSON.stringify({ source: 'wizard-mobile', id, ...(agent ? { agent } : {}) }) });
      const body = { session_id: id, input, ...route, require_model_lock: true };
      if (opts.instructions) body.instructions = String(opts.instructions).slice(0, 2000);
      if (opts.fileIds?.length) body.wizard_file_ids = opts.fileIds.slice(0, 8);
      const r = await req('/wizard/hermes/v1/runs' + aq(id), { method: 'POST', headers: { ...J, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
      const run = await r.json().catch(() => ({}));
      const runId = run.run_id || run.id || '';
      const row = { id, runtime: 'direct', title: input.slice(0, 60), status: 'running', runId, updatedAt: new Date().toISOString(), lastUserAt: new Date().toISOString(), preview: input, source: 'wizard-mobile', agent };
      if (agent) (this.agentSessions[agent] = this.agentSessions[agent] || []).unshift(row); else this.sessions.unshift(row);
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
          const active = await (await req(`/wizard/hermes/v1/runs/${encodeURIComponent(s.runId)}${aq(id)}`)).json();
          if (!M.matchesRuntime(active.runtime, route))
            throw Object.assign(new Error('Queue on the selected model'), { status: 409 });
          const steer = { input, ...route, require_model_lock: true };
          if (opts.fileIds?.length) steer.wizard_file_ids = opts.fileIds.slice(0, 8);
          await req(`/wizard/hermes/v1/runs/${encodeURIComponent(s.runId)}/steer${aq(id)}`, { method: 'POST', headers: J, body: JSON.stringify(steer) });
          return { steered: true, runId: s.runId };
        } catch (e) { if (e.code === 'dispatch_already_attempted' || ![404, 409, 410].includes(e.status)) throw e; }
      }
      const body = { session_id: id, input, ...route, require_model_lock: true };
      if (opts.instructions) body.instructions = String(opts.instructions).slice(0, 2000);
      if (opts.fileIds?.length) body.wizard_file_ids = opts.fileIds.slice(0, 8);
      const r = await req('/wizard/hermes/v1/runs' + aq(id), { method: 'POST', headers: { ...J, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
      const run = await r.json().catch(() => ({}));
      const runId = run.run_id || run.id || '';
      if (s) Object.assign(s, { status: 'running', runId, lastUserAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      this.emit(); setTimeout(() => this.refresh(), 3000);
      return { steered: false, runId };
    },
    /* Full message history of one thread (oldest first), paged like Wizard. */
    async messages(id) {
      if (!this.session(id) || this.session(id).detailNeeded) await this.sessionInfo(id);
      const rows = [];
      for (let offset = 0; offset < 5000; offset += 500) {
        const p = await (await req(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}/messages?order=oldest&limit=500&offset=${offset}&include_compacted=true&view=wizard${aq(id, '&')}`)).json();
        const page = p.data || p.messages || p.items || [];
        rows.push(...page);
        const n = Number(p.pagination?.returned ?? page.length);
        if (!isFinite(n) || n < 500 || !page.length) break;
      }
      return rows;
    },
    async searchSessions(q, agent = '', signal, onBatch) {
      const scopes = otherAgent(agent) ? [agent] : ['', ...(AG()?.others() || []).map(a=>a.id)];
      const settled = await Promise.allSettled(scopes.map(async scope => {
        const found=[]; let snapshot='', resets=0;
        for(let offset=0; offset<100000;) {
          const params=new URLSearchParams({view:'list',q,limit:'100',offset:String(offset),include_children:'false'});
          if(scope) params.set('agent',scope); if(snapshot) params.set('snapshot',snapshot);
          let p;
          try { p=await (await req(`/wizard/hermes/api/sessions?${params}`,{signal})).json(); }
          catch(e) {
            if([400,404].includes(e.status)) return null;
            if(e.status===409 && offset && resets++<1) {offset=0;snapshot='';found.length=0;continue;}
            throw e;
          }
          if(p.list_version!==1 || !Number.isInteger(p.search_total)) return null;
          snapshot=p.snapshot || snapshot;
          const rows=p.data||p.sessions||p.items||[];
          for(const raw of rows) {
            const s=normalize(raw); if(!s || (s.agent||'hermes')!==(scope||'hermes')) continue;
            if(signal?.aborted) throw new DOMException('Aborted','AbortError');
            if(scope) AGENT_OF.set(s.id,scope);
            found.push(s);
          }
          if(!p.has_more) { if(!signal?.aborted) onBatch?.(found); return found; }
          if(!rows.length) throw new Error('Incomplete search');
          offset+=rows.length;
        }
        throw new Error('Search limit reached');
      }));
      if(signal?.aborted) throw new DOMException('Aborted','AbortError');
      const good=settled.filter(x=>x.status==='fulfilled' && Array.isArray(x.value));
      const failed=settled.filter(x=>x.status==='rejected');
      if(!good.length) { if(failed.length) throw failed[0].reason; return null; }
      const found=good.flatMap(x=>x.value); found.partial=good.length!==scopes.length;
      return found;
    },
    rememberSearch(s) { if(s?.id) { if(otherAgent(s.agent)) AGENT_OF.set(s.id,s.agent); DETAIL.set(s.id,s); while(DETAIL.size>300) DETAIL.delete(DETAIL.keys().next().value); } },
    async sessionInfo(id) {
      const agent = this.agentOf(id);
      let p;
      try { p = await (await req(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}?view=detail${aq(id,'&')}`)).json(); }
      catch(e) { if (![400,404].includes(e.status)) throw e; p = await (await req(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}${aq(id)}`)).json(); }
      const raw = p.session || p;
      if (!raw?.id && !raw?.session_id) return null;
      // Older services do not have view=detail. Their preview may itself be clipped
      // at 1,000, so recover visible original input from history rather than trusting it.
      if (!Object.prototype.hasOwnProperty.call(raw,'wizard_retry_input')) {
        raw.wizard_retry_input='';
        for(let offset=0; offset<100000; offset+=100) {
          const page=await (await req(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}/messages?order=latest&limit=100&offset=${offset}&include_compacted=true&view=wizard${aq(id,'&')}`)).json();
          const rows=page.data||page.messages||page.items||[], turns=window.WosChat?.parseRows(rows)||[];
          const user=turns.slice().reverse().find(t=>t.u?.text);
          if(user) { raw.wizard_retry_input=user.u.text; break; }
          if(page.has_more===false || (page.has_more!==true && rows.length<100)) break;
          if(!rows.length || offset>=99900) throw new Error('Incomplete retry history');
        }
      }
      const s = normalize(raw); if (!s) return null;
      if (s.agent && (s.agent || 'hermes') !== (agent || 'hermes')) throw new Error('Thread scope changed');
      if (agent) s.agent = agent;
      const list = agent ? (this.agentSessions[agent] = this.agentSessions[agent] || []) : this.sessions;
      const i = list.findIndex(x => x.id === id);
      if (s.id !== id || (s.agent && otherAgent(s.agent) && s.agent !== agent)) throw new Error('Thread scope changed');
      if (i >= 0) list[i] = { ...list[i], title: s.title, request: s.request, renames: s.renames, detailNeeded: false,
        ...(s.model ? { model: s.model, provider: s.provider, modelLockAt: s.modelLockAt } : {}) };
      else if (this.windows[agent || 'hermes']) DETAIL.set(id, { ...s, detailNeeded: false });
      else list.push({ ...s, detailNeeded: false });
      applyLocal(i >= 0 ? list[i] : DETAIL.get(id) || s);
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
        if (!file) { await req(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}${aq(id)}`, { method: 'PATCH', headers: J, body: JSON.stringify({ archived: true }) }); return; }
        const ag = this.agentOf(id);
        let r = await fetch('/wizard/filings' + aq(id), { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: J, body: JSON.stringify({ session_id: id, client_command_id: commandId(), runtime: s.runtime || 'direct', ...(ag ? { agent: ag } : {}) }) });
        const until = Date.now() + 10 * 60000; let wait = 500;
        while (r.status === 202 && Date.now() < until) {
          await new Promise(res => setTimeout(res, wait)); wait = Math.min(2000, wait + 250);
          r = await fetch(`/wizard/filings/${encodeURIComponent(id)}/status${aq(id)}`, { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: J, body: JSON.stringify({ runtime: s.runtime || 'direct' }) });
        }
        if (!r.ok || r.status === 202) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      });
    },
    async _defer(id, deferred) {
      const s = this.session(id); if (!s) throw new Error('gone');
      const ag = this.agentOf(id);
      const p = await (await req('/wizard/thread-dispositions' + aq(id), { method: 'PUT', headers: J, body: JSON.stringify({ sessionId: id, runtime: s.runtime || 'direct', deferred, ...(ag ? { agent: ag } : {}) }) })).json();
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
        const r = await fetch(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}${aq(id)}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t }) });
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
        await req(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}${aq(id)}`, { method: 'PATCH', headers: J, body: JSON.stringify({ archived: false }) });
        writeRestored({ ...readRestored(), [id]: at });
      });
    },
    /* ---- the live run: status, approval, stop (api.ts run/approve/stop) ---- */
    async run(runId) { return (await req(`/wizard/hermes/v1/runs/${encodeURIComponent(runId)}${rq(runId)}`)).json(); },
    async runCapabilities(runId) { return (await req(`/wizard/hermes/v1/capabilities${rq(runId)}`)).json(); },
    async approve(runId, choice, requestId, generation) {
      const body = { choice }; if (requestId) body.request_id = requestId;
      if (generation !== undefined) body.execution_generation = generation;
      await req(`/wizard/hermes/v1/runs/${encodeURIComponent(runId)}/approval${rq(runId)}`, { method: 'POST', headers: J, body: JSON.stringify(body) });
    },
    async clarify(runId, answer, requestId, generation) {
      return req(`/wizard/hermes/v1/runs/${encodeURIComponent(runId)}/clarify${rq(runId)}`, { method: 'POST', headers: J, body: JSON.stringify({ request_id: requestId, execution_generation: generation, answer }) });
    },
    async resolveUnknown(runId, admissionId, generation) {
      return req(`/wizard/hermes/v1/runs/${encodeURIComponent(runId)}/resolve-unknown${rq(runId)}`, { method: 'POST', headers: J, body: JSON.stringify({ admission_id: admissionId, execution_generation: generation }) });
    },
    async stop(runId) {
      try { await req(`/wizard/hermes/v1/runs/${encodeURIComponent(runId)}/stop${rq(runId)}`, { method: 'POST' }); }
      catch (error) { STOPPING.delete(runId); await this.refresh(); throw error; }
      STOPPING.set(runId, Date.now());
      const s = [this.sessions, ...Object.values(this.agentSessions)].flat().find(x => x.runId === runId); if (s) { applyLocal(s); this.emit(); }
      setTimeout(() => this.refresh(), 2500);
    },
  };
  // Wizard (in its desk, or another tab) writes the same key when a chat is opened.
  addEventListener('storage', e => { if (e.key === SEEN_KEY || e.key === SEEN_BASE) { L.seen = merge(L.seen, readLocal()); L.emit(); } });
  // Open on the last snapshot (see SNAP_KEY). at stays 0, so the connection banner never counts it as a live read.
  { const snap = readSnap(); if (snap && snap.sessions.length) { L.sessions = snap.sessions; L.deferred = snap.deferred || {}; for (const s of L.sessions) applyLocal(s); L.ok = true; L.cached = true; L.cachedAt = snap.at; } }
  document.addEventListener('visibilitychange', () => { if (document.hidden) writeSnap(L); });
  addEventListener('pagehide', () => writeSnap(L));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) L.refresh(); });
  setInterval(() => { if (!document.hidden) L.refresh(); }, 15000);
  // outbox.js loads after this file: follow it once every script has run.
  function attachOutbox() {
    const OB = window.WosOutbox; if (!OB || L._outbox) return; L._outbox = true;
    const sync = () => { if (syncPending(OB)) L.emit(); };
    OB.onChange(sync); OB.load().then(sync).catch(() => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attachOutbox); else setTimeout(attachOutbox, 0);
  // A new or changed agent: read its threads now (not at the next poll), then repaint.
  const attachAgents = () => { const A = AG(); if (!A || L._agents) return; L._agents = true; A.onChange(() => { if (L.ok) L.refreshAgents().then(() => L.emit()); else L.emit(); }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attachAgents); else setTimeout(attachAgents, 0);
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

  /* ---- thread open speed (18 Oct 2026, Miguel: "whenever I click on any session it just is extremely snappy") ----
   * 1. Thread cache: every history read is kept on this device (IndexedDB, newest 40 threads), so a thread
   *    paints at once from its last copy while the fresh read lands and replaces it. Server rows only; private
   *    agents' threads are never stored.
   * 2. Preload: after each live list read, Errors/Working/Ready threads whose revision changed are read in the
   *    background, one at a time, never while hidden, on Data Saver, or from the cached list. Never archived threads.
   * 3. Warm: pointing at (desktop) or touching a row starts its read; the open joins that same request. */
  const TC_DB = 'wos-thread-cache', TC_MAX = 40, TC_BYTES = 2.5e6;
  const TC = new Map(), INFLIGHT = new Map();
  const revOf = s => s ? [s.messageCount, s.lastAssistantAt, s.lastUserAt, s.activityAt, s.status].join('|') : '';
  const keepable = id => !!id && !L.agentOf(id) && !(L.isPrivate && L.isPrivate(id));
  let tcDb = null;
  const tcOpen = () => tcDb || (tcDb = new Promise(res => {
    try { const r = indexedDB.open(TC_DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('t', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null); }
    catch (e) { res(null); }
  }));
  const tcReady = (async () => {
    const db = await tcOpen(); if (!db) return;
    await new Promise(res => {
      try { const q = db.transaction('t').objectStore('t').getAll(); q.onsuccess = () => { for (const v of q.result || []) if (v && v.id && Array.isArray(v.rows) && !TC.has(v.id)) TC.set(v.id, v); res(); }; q.onerror = () => res(); }
      catch (e) { res(); }
    });
  })();
  async function tcPut(id, rows, rev) {
    if (!keepable(id) || !Array.isArray(rows)) return;
    let n = 0; try { n = JSON.stringify(rows).length; } catch (e) { return; }
    if (n > TC_BYTES) return;
    const v = { id, rows, rev, at: Date.now() }; TC.set(id, v);
    const evict = [...TC.values()].sort((a, b) => b.at - a.at).slice(TC_MAX).map(x => x.id);
    for (const k of evict) TC.delete(k);
    const db = await tcOpen(); if (!db) return;
    try { const st = db.transaction('t', 'readwrite').objectStore('t'); st.put(v); for (const k of evict) st.delete(k); } catch (e) {}
  }
  const fetchMessages = L.messages;
  // A background read (warm/preload) can be joined by one thread open; an open never joins another open's read,
  // so A -> B -> A always starts a new, independent read generation.
  const startRead = (id, claimed) => {
    const rev = revOf(L.session(id));
    const p = fetchMessages.call(L, id).then(rows => { tcPut(id, rows, rev); return rows; });
    const e = { p, claimed }; INFLIGHT.set(id, e); const done = () => { if (INFLIGHT.get(id) === e) INFLIGHT.delete(id); }; p.then(done, done);
    return p;
  };
  L.messages = function (id) {
    const e = INFLIGHT.get(id); if (e && !e.claimed) { e.claimed = true; return e.p; }
    return startRead(id, true);
  };
  const bgRead = id => { const e = INFLIGHT.get(id); return e ? e.p : startRead(id, false); };
  L.cachedMessages = id => (keepable(id) && TC.get(id)?.rows) || null;
  const saving = () => !!navigator.connection?.saveData;
  L.warm = id => {
    const s = L.session(id); if (!s || s.archived || s.optimistic || saving() || INFLIGHT.has(id) || !keepable(id)) return;
    const c = TC.get(id); if (c && c.rev === revOf(s) && !WORKING.has(s.status)) return;
    bgRead(id).catch(() => {});
  };
  let pfBusy = false;
  async function preload() {
    if (pfBusy || document.hidden || !L.ok || L.cached || L.error || saving()) return;
    pfBusy = true;
    try {
      await tcReady;
      const g = groupWork(L.sessions);
      const want = [...(g.errors || []), ...(g.working || []), ...(g.ready || [])].filter(s => !s.archived && !s.hidden && !s.optimistic && !s.synthetic && keepable(s.id)).slice(0, 16);
      for (const s of want) {
        if (document.hidden || !L.session(s.id)) continue;
        const c = TC.get(s.id);
        if (c && c.rev === revOf(s)) continue;
        if (c && WORKING.has(s.status) && Date.now() - c.at < 60000) continue;
        try { await bgRead(s.id); } catch (e) {}
        await new Promise(r => setTimeout(r, 120));
      }
    } finally { pfBusy = false; }
  }
  const baseRefresh = L.refresh;
  L.refresh = function (...a) { const p = baseRefresh.apply(this, a); Promise.resolve(p).then(() => setTimeout(preload, 400), () => {}); return p; };
  window.WizLive = L;
  window.__wizLiveInternals = { hasNew, recordFor, merge, fingerprint, normalize };
})();
