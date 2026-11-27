/* WizardOS — live Wizard data: sessions, shared read state, real sends.
 * Read-state semantics mirror wizard-mobile src/threadSeen.ts exactly, and the
 * state is the same record Wizard itself uses (localStorage + /wizard/thread-seen),
 * so opening a chat anywhere clears it everywhere. */
(() => {
  'use strict';
  if (document.documentElement.dataset.leaving) return; // core/shell.js is switching to the other shell
  /* seen: moved to live-seen.js (wizard-ux issue 1665), called once here */
  const { assistantAt, fingerprint, handledOf, handledRev, hasNew, iso, keyOf, later, MAX, merge, normalize, readLocal, recordFor, resendSeen, SCOPE, SEEN_BASE, SEEN_KEY, seenKeyOf, seenRecord, WEEK, WORKING, writeLocal, bindLate: seenLate } = window.WizCore.liveParts.seen({  });
  /* ---- network ---- */
  const J = { 'Content-Type': 'application/json' };
  const THREAD_ROWS_MAX = 50000; // threadRows' ceiling: 100 pages of 500
  async function req(path, init = {}) {
    if (!init.signal && (!init.method || init.method === 'GET') && /^\/wizard\/hermes\/api\/sessions\/[^/?]+(?:\/messages\?|\?view=detail)/.test(path)) {
      if (globalThis.AbortSignal?.timeout) init = { ...init, signal: AbortSignal.timeout(12000) };
    }
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
  const SEARCH_CLIENT=globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).slice(2);
  const LIST_DEADLINE = 30000;
  const listSignal = () => typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(LIST_DEADLINE) } : {};
  async function fetchSessions(full, agent = '', onFirst = null) {
    const read = ++titleRead;
    const out = []; let snapshot = '', meta = null, resets = 0, build = '';
    const overrides = JSON.stringify(listOverrides(agent));
    for (let offset = 0; offset < 100000; ) {
      const slim = LIST_SUPPORT.get(agent) !== false;
      const q = `${slim ? `view=list&window=archive-50&overrides=${encodeURIComponent(overrides)}&` : ''}limit=100&offset=${offset}&include_children=false${snapshot ? `&snapshot=${encodeURIComponent(snapshot)}` : ''}${agent ? `&agent=${encodeURIComponent(agent)}` : ''}`;
      let p;
      // A read that hangs must not leave Chats looking current: give up after LIST_DEADLINE and say so (offline).
      try { p = await (await req(`/wizard/hermes/api/sessions?${q}`, listSignal())).json(); }
      catch (e) {
        if (slim && offset === 0 && [400,404].includes(e.status)) { LIST_SUPPORT.set(agent,false); continue; }
        if (offset > 0 && e.status === 409 && resets++ < 1) { offset=0; snapshot=''; out.length=0; continue; }
        throw e;
      }
      if (slim && p.list_version === 1 && p.window !== 'archive-50') { LIST_SUPPORT.set(agent,false); snapshot=''; out.length=0; offset=0; continue; }
      if (p.list_version === 1) LIST_SUPPORT.set(agent,true);
      if (!snapshot && typeof p.snapshot === 'string') snapshot = p.snapshot;
      // The slim title index is re-read only when the list's build moved (wizard-ux issue 1693): the window
      // hashes the same selection for both shapes, so an unchanged build means an unchanged index. Checked on the
      // first page, so a head-only poll of a long list also refreshes search when something changed.
      if (!build && typeof p.build === 'string') { build = p.build; if (TITLE_INDEX.get(agent)?.build !== build) setTimeout(()=>{void fetchTitleIndex(agent)},0); }
      if (p.window === 'archive-50') meta = { archiveTotal:p.archive_total, archiveReturned:p.archive_returned, cursor:p.archive_cursor };
      const rows = p.data || p.sessions || p.items || [];
      out.push(...rows.map(normalize).filter(Boolean));
      offset += rows.length;
      const more = typeof p.has_more === 'boolean' ? p.has_more : typeof p.pagination?.has_more === 'boolean' ? p.pagination.has_more : rows.length >= 100;
      if (!more) return { sessions:out, complete:true, meta, titleRead:read };
      if (!rows.length) throw new Error('Incomplete session window');
      if (!full) return { sessions:out, complete:false, meta, titleRead:read };
      if (onFirst && offset === rows.length) await onFirst({ sessions:out.slice(), complete:false, meta, titleRead:read });
    }
    throw new Error('Session window limit reached');
  }
  // A compact, scope-separated title/preview index. Never persist private-agent rows.
  const TITLE_PREFIX='wos.chats.titles.v1:', TITLE_INDEX=new Map(), TITLE_LOADING=new Map();
  let titleAccount='', titleEpoch=0;
  function clearTitleIndex() {
    TITLE_INDEX.clear(); TITLE_LOADING.clear(); titleAccount=''; titleEpoch++;
    try { for(const k of Object.keys(localStorage)) if(k.startsWith(TITLE_PREFIX)) localStorage.removeItem(k); } catch {}
    window.WizCore?.chatSearch?.reset?.();
  }
  window.addEventListener('wizard-account-change',()=>{ RENAMES.clear(); clearTitleIndex(); });
  function indexRow(raw,scope) {
    if(!raw?.id || (raw.agent || 'hermes')!==(scope || 'hermes')) return null;
    return normalize({...raw,listVersion:1,agent:scope||'',agent_id:scope||'hermes',updatedAt:raw.cardTime||raw.updatedAt,activityAt:raw.cardTime||raw.activityAt,previewAt:raw.cardTime||raw.previewAt});
  }
  async function fetchTitleIndex(scope='') {
    if(TITLE_LOADING.has(scope)) return TITLE_LOADING.get(scope);
    const read = ++titleRead;
    const task=(async()=>{
      let cursor='', snapshot='', offset=0, build='', rows=[], epoch=titleEpoch;
      const overrides=JSON.stringify(listOverrides(scope));
      for(let pages=0; pages<30; pages++) {
        const p=new URLSearchParams({view:'list',window:'archive-50',fields:'slim',limit:'500',offset:String(offset),include_children:'false',overrides});
        if(scope) p.set('agent',scope); if(cursor) p.set('cursor',cursor); else if(snapshot) p.set('snapshot',snapshot);
        const value=await (await req(`/wizard/hermes/api/sessions?${p}`,listSignal())).json();
        if(epoch!==titleEpoch) return;
        if(value.fields!=='slim' || !value.build) return; // an older service: retain existing search
        if(!scope && value.account_scope) {
          let previous=titleAccount;
          try { previous ||= localStorage.getItem(TITLE_PREFIX+'account')||''; } catch {}
          if(previous && previous!==value.account_scope) { clearTitleIndex(); epoch=titleEpoch; }
          titleAccount=value.account_scope;
          try { localStorage.setItem(TITLE_PREFIX+'account',titleAccount); } catch {}
        }
        const key=TITLE_PREFIX+(titleAccount||SCOPE)+':'+(scope||'hermes');
        if(!build) {
          build=value.build; snapshot=value.snapshot;
          if(TITLE_INDEX.get(scope)?.build===build) return;
          // Validate the account and the current server build before using any persisted rows.
          if(!scope && titleAccount) try {
            const cached=JSON.parse(localStorage.getItem(key)||'null');
            if(cached?.build===build && Array.isArray(cached.rows) && cached.rows.length<=10000) { TITLE_INDEX.set(scope,cached); store.emit(); return; }
          } catch {}
        }
        rows.push(...(value.data||[]).map(raw=>indexRow(raw,scope)).filter(Boolean));
        if(rows.length>10000) throw new Error('Title index limit reached');
        if(value.has_more && !cursor) { offset+=value.data.length; continue; }
        if(value.archive_cursor) { cursor=value.archive_cursor; offset=0; continue; }
        rows.forEach(s=>applyTitle(s,read));
        const entry={build,rows}; TITLE_INDEX.set(scope,entry);
        if(!scope && titleAccount) try { const data=JSON.stringify(entry); if(data.length<2000000) localStorage.setItem(key,data); } catch {}
        store.emit(); return;
      }
    })().catch(e=>{if(e.status===403) clearTitleIndex();}).finally(()=>{ if(TITLE_LOADING.get(scope)===task) TITLE_LOADING.delete(scope); });
    TITLE_LOADING.set(scope,task); return task;
  }
  /* Saved background results (Agent Service GET /wizard/background-results, wizard-agent-service #14).
   * On for everyone (wizard-agent-service #14). Read-only discovery merged into
   * Chats; it never starts a model. A result older than the normal list window adds its original thread once.
   * While the Service reports it is still scanning, re-read briefly (bounded to one minute). */
  // Each saved result shows with its reason and Dismiss (wizard-agent-service issue 469, on for everyone).
  // The Service's reason on its own saved-result Needs you; Done/Archive on a row that says it also dismiss it.
  const SAVED_RESULT_ASK = 'A helper finished after this chat closed';
  const savedResultAsk = s => !!s && (!!s.backgroundResult || s.attention?.state === 'needs_you' && s.attention?.ask === SAVED_RESULT_ASK);
  /* Quiet replies (wizard-ux issue 1808; on for everyone since wizard-ux issue 1778): the box
   * marks a thread whose newest run answered the owner's reply that asked for nothing ("Sent to Miguel, done") and
   * that ended done or fyi (Agent Service quietReply). That answer is not new to him: no unread dot, no count, not in
   * Inbox / Ready; Sent shows it Done. An ask on the row (needs you, check), a failure or a run still going never is.
   * Main agent only: the Sent log is the owner's to the main agent, so a routed agent's row (host-profile, container,
   * restricted) never counts as quiet. */
  function quietReply(s) {
    return !!s && s.quietReply === true && (!s.agent || s.agent === 'hermes') && !s.critical
      && !['needs_you', 'check'].includes(s.attention?.state) && !['failed', 'interrupted', 'waiting_for_approval', 'unknown'].includes(s.status)
      && !globalThis.WizChatsListModel?.isListWorking?.(s);
  }
  let backgroundPollTimer = null, backgroundPollUntil = 0;
  // Results this device already continued (or found stale). A discovery read that started before the tap can land
  // after it; it must never bring the Continue panel back. Ids are per result, so this only ever grows a little.
  const BACKGROUND_SETTLED = new Set();
  function scheduleBackgroundPoll() {
    if (backgroundPollTimer || document.hidden) return;
    if (!backgroundPollUntil) backgroundPollUntil = Date.now() + 60000;
    if (Date.now() > backgroundPollUntil) return;
    backgroundPollTimer = setTimeout(() => { backgroundPollTimer = null; if (!document.hidden) L.refresh(); }, 1000);
  }
  async function mergeBackgroundResults(sessions, isCurrent = () => true) {
    let p;
    try { p = await (await req('/wizard/background-results', listSignal())).json(); }
    catch (e) { return; } // an older Agent Service lacks this route; normal Chats still works
    if (!isCurrent()) return;
    if (p?.scanning) scheduleBackgroundPoll();
    else { if (backgroundPollTimer) clearTimeout(backgroundPollTimer); backgroundPollTimer = null; backgroundPollUntil = 0; }
    const pending = new Set((Array.isArray(p?.results) ? p.results : []).map(r => r?.id).filter(id => id && !BACKGROUND_SETTLED.has(id)));
    const reasons = new Map((Array.isArray(p?.results) ? p.results : []).filter(r => typeof r?.reason === 'string' && r.reason).map(r => [r.id, r.reason.slice(0, 160)]));
    const withReason = b => (b && reasons.has(b.id) ? { ...b, reason: reasons.get(b.id) } : b);
    // The listing is authoritative: a result continued elsewhere (another device) clears here too.
    for (const s of sessions) if (s.backgroundResult && (WORKING.has(s.status) || !pending.has(s.backgroundResult.id))) s.backgroundResult = null;
    // Only the main agent's threads: the Service route is scoped to the main agent (agent_id hermes).
    const byId = new Map(sessions.map(row => [row.id, row]));
    for (const raw of Array.isArray(p?.sessions) ? p.sessions : []) {
      const s = normalize(raw); if (!s || !s.backgroundResult || !pending.has(s.backgroundResult.id)) continue;
      const current = byId.get(s.id);
      // A thread that is working again keeps its own run in charge; never replace it with a manufactured state.
      if (current) { if (WORKING.has(current.status)) continue; current.backgroundResult = withReason(s.backgroundResult); current.attention = s.attention; }
      else { s.backgroundResult = withReason(s.backgroundResult); sessions.push(s); byId.set(s.id, s); }
    }
    for (const s of sessions) if (s.backgroundResult && !s.backgroundResult.reason && reasons.has(s.backgroundResult.id)) s.backgroundResult = withReason(s.backgroundResult);
  }
  const FULL_EVERY = 3 * 60 * 1000;
  /* Other agents' list reads (wizard-ux issue 1693): every 15 s poll used to walk every agent's whole list, so a
   * reload sent ~128 reads. Now each agent follows the main list's rule (a full walk every FULL_EVERY, the head page
   * in between), one read per agent at a time, none to an agent whose status is error, and an agent whose list
   * answers 404 waits FULL_EVERY before the next try. id -> { fullAt, holdUntil, holdStatus, read } */
  const AGENT_POLL = new Map();
  /* work: moved to live-work.js (wizard-ux issue 1665), called once here */
  const { AG, AGENT_OF, AGENT_SEEN, AGENT_SEEN_KEY, AGENT_WAIT, aq, ARCH_KEY, archiveAfterDays, byOldest, byPriority, cardAt, chatLayout, DAY, fetchDispositions, fetchSeen, groupSwitch, groupWork, inWorking, isDeferred, isErr, LAYOUT_KEY, needsApproval, otherAgent, prefOps, putPrefs, putSeen, readyRank, rq, sectionTime, snoozeLast, STALE_AFTER, bindLate: workLate } = window.WizCore.liveParts.work({ J, req });
  seenLate({ otherAgent, putSeen });
  /* ---- thread actions: Done / Close & file / Defer / Restore (controller.ts fileSession, setThreadDeferred, restoreSession) ----
   * Applied to the list at once (optimistic) and kept over refreshes until the write settles; a failed write puts
   * the thread back. Restoring an archived thread remembers when, in the key Wizard uses, so it lands in Ready. */
  const RESTORED_KEY = 'wizard.mobile.restored-threads.v1';
  const OVER = new Map(); // id -> { archived?, deferred?, restoredAt? } while a write is in flight
  // A title write has its own reconciliation fence: disposition actions settle on
  // time alone, but a cached list/detail can still carry the old title after PATCH.
  const RENAMES = new Map();
  let titleRead = 0;
  const titleScope = s => `${s.agent || 'hermes'}:${s.id}`;
  function applyTitle(s, read = 0, authoritative = false) {
    const o = RENAMES.get(titleScope(s)); if (!o) return s;
    if (o.settled && read > o.settled) {
      if (authoritative && read > o.confirmed) { o.title = s.title; o.confirmed = read; o.dirty = false; }
      // A differing snapshot may be stale OR another owner's newer edit. Only
      // a fresh canonical detail read can distinguish them; never pin forever.
      else if (!authoritative && s.title !== o.title && read > o.confirmed) o.dirty = true;
    }
    s.title = o.title; return s;
  }
  function confirmTitle(store, id, entry) {
    if (entry.reading || (entry.confirmed && !entry.dirty)) return;
    // Lists/indexes are cached snapshots; a new detail GET goes to canonical
    // session storage. Another owner's rename may win before ours is observed.
    entry.reading = store.sessionInfo(id).then(s => {
      if (s && RENAMES.get(titleScope(s)) === entry) {
        paintTitle(store, s, entry.title); writeSnap(store); store.emit();
      }
    }).catch(() => {}).finally(() => { entry.reading = null; });
  }
  function paintTitle(store, session, title) {
    const key = titleScope(session);
    const rows = [...store.sessions, ...Object.values(store.agentSessions).flat(), ...DETAIL.values(),
      ...[...SPACE_ROWS.values()].map(e => e.row), ...[...TITLE_INDEX.values()].flatMap(e => e.rows)];
    for (const row of rows) if (row && titleScope(row) === key) row.title = title;
    session.title = title;
  }
  const readRestored = () => { try { const v = JSON.parse(localStorage.getItem(RESTORED_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
  const writeRestored = v => { try { localStorage.setItem(RESTORED_KEY, JSON.stringify(v)); } catch (e) {} };
  function applyLocal(s, read = 0) {
    applyTitle(s, read);
    const rename = RENAMES.get(titleScope(s));
    if (rename?.settled && (!rename.confirmed || rename.dirty)) confirmTitle(L, s.id, rename);
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

  /* ---- a send puts its thread in Working at once (James, 10 Oct 2026: "move it out of the ready list immediately
   * and into working… I don't want to see the thread I just replied to in my feed and then have a UX update") ----
   * Every reply / new chat in the outbox holds its thread in Working, with a status that follows the message:
   * Sending… (leaving the phone) → Offline · will retry (Wizard unreachable) → Starting… (Wizard accepted it)
   * → Working (Wizard lists the run). The hold outlives stale list reads and releases to Wizard's own truth when
   * this run settles (its idempotency key = the outbox item id); 2 min after acceptance it releases anyway.
   * A message that truly can't be sent puts the thread back where it was (the pill keeps Retry/Edit). */
  const PEND = new Map(); // sessionId -> { key, kind, text, at, state: 'sending'|'waiting'|'sent', sentAt, runId }
  const STOPPING = new Map(); // runId -> when Stop was asked (applyLocal)
  const STOP_SEND_MS = 15000, STOP_FOLLOW_MS = [800, 800, 900, 1500, 2000, 3000, 4000, 7000]; // gaps between re-reads, ~20 s in all
  // Every row of a run: the lists, rows read on their own (search, direct lookup, Spaces) and the thread Stop was tapped on.
  const runRows = (L, runId, sid = '') => [...new Set([L.sessions || [], ...Object.values(L.agentSessions || {}), [...DETAIL.values()],
    [...SPACE_ROWS.values()].map(x => x?.row), sid ? [L.session?.(sid)] : []].flat())].filter(x => x && x.runId === runId);
  // The tap: every row of this run says Stopping… now. Returns how to put them back if the Stop never arrives.
  function markStopping(L, runId, sid) {
    if (!runId || STOPPING.has(runId)) return () => {};
    STOPPING.set(runId, Date.now());
    const before = runRows(L, runId, sid).filter(s => WORKING.has(s.status) && s.status !== 'stopping').map(s => [s, s.status]);
    for (const [s] of before) s.status = 'stopping';
    if (before.length) L.emit();
    return () => { for (const [s, st] of before) if (s.status === 'stopping') s.status = st; };
  }
  // After a delivered Stop: re-read until no row of this run is still working (the run usually settles in a second or two).
  function followStop(L, runId, sid) {
    let i = 0;
    const next = () => {
      if (i >= STOP_FOLLOW_MS.length || !STOPPING.has(runId)) return;
      setTimeout(async () => {
        let read = true; try { await L.refresh(); } catch { read = false; } // a failed read proves nothing: try again
        const rows = runRows(L, runId, sid);
        if (!read || !rows.length || rows.some(s => WORKING.has(s.status))) next(); else STOPPING.delete(runId);
      }, STOP_FOLLOW_MS[i++]);
    };
    next();
  }
  const PEND_MAX = 2 * 60e3;
  const PLACEHOLDER_TITLES = new Set(['', 'New chat', 'Untitled chat', 'Chat']);
  // A send a graceful restart holds (the 202 restart_pending receipt, p.held / it.restartPending) stays this device's
  // until the restart is over, however long the wait: the box may list a new chat's held first message late or not at
  // all, and the chat must stay under Saved meanwhile (wizard-ux issue 1362). Without a known restart: PEND_MAX.
  const pendOver = (sentAt, held) => !!sentAt && Date.now() - sentAt > PEND_MAX && !(held && globalThis.WizReach?.restart?.());
  // Admission is not completion: the newest receipt can arrive with an older thread status.
  // Keep the bounded hold through active acknowledgement, so a late stale poll cannot undo it.
  const confirmed = (s, p) => {
    const st = s.orig ? s.orig.status : s.status, run = s.orig ? s.orig.runId : s.runId;
    const sameKey = !!p.key && s.lastRunKey === p.key;
    // A queued sign-in wait is an acknowledged failed start, not active work.
    // Release that send's optimistic spinner immediately, but keep a newer
    // explicit retry's hold until its own receipt arrives.
    if (s.queueReason === 'provider_access' && (sameKey || (!!p.runId && run === p.runId))) return true;
    if ((sameKey || (!!p.runId && run === p.runId)) && WORKING.has(st)) p.acknowledged = true;
    return sameKey && !WORKING.has(st) && !WORKING.has(s.lastRunStatus);
  };
  /* The send tap itself (James, 10 Oct 2026: "the thread I just exited moving to working immediately… It should just
   * automatically disappear" from Ready). An orb send reaches the outbox only after transcription and routing (seconds,
   * longer on a bad line), so the thread is held in Working from the tap: replaced by the outbox item the moment it
   * exists, released if the take turns out empty or becomes a phone command, and never longer than TAP_MAX. */
  const TAPS = new Map(); // sessionId -> { at, until }
  const CANCELLING = new Set(); // sessionIds whose pending send the owner stopped before its run existed
  let stopMarks = null; // set by L.cancelSend's block below
  const TAP_MAX = 60e3;
  const RELEASED = new Set(); // outbox item ids whose hold is over (so a later outbox change doesn't re-hold them)
  function applyPend(s) {
    const p = PEND.get(s.id);
    if (p && (confirmed(s, p) || pendOver(p.sentAt, p.held))) { RELEASED.add(p.key); PEND.delete(s.id); unPend(s); return; }
    if (!p) { if (s.pend !== undefined) unPend(s); return; }
    if (!s.orig) s.orig = { status: s.status, runId: s.runId, assignedAt: s.assignedAt, requestAt: s.requestAt };
    const at = new Date(p.at).toISOString();
    // Already working (a message into a live run) keeps Wizard's status; anything else is held in Working.
    if ((!WORKING.has(s.orig.status) || s.queueReason === 'provider_access') && !['waiting_for_approval', 'unknown'].includes(s.orig.status)) {
      s.status = p.state === 'sent' ? 'running' : 'submitting';
      s.runId = p.runId || ''; // never an older finished run (a quick second reply must not try to steer it)
      s.assignedAt = at; s.requestAt = at;
    } else if (s.status === 'stopping' && !CANCELLING.has(s.id) && !(s.runId && STOPPING.has(s.runId))) s.status = s.orig.status;
    // What the row says: Sending… → (Offline · will retry) → Starting… → (Wizard reports the run) Working.
    s.pend = p.acknowledged ? '' : p.state === 'sent' ? 'starting' : p.state;
    // Stop tapped before the run existed: Stopping… until the send is withdrawn (or its run is stopped). A run Stop
    // (STOPPING) keeps its Stopping… through outbox repaints too, not only through list reads (applyLocal).
    if ((CANCELLING.has(s.id) || (s.runId && STOPPING.has(s.runId))) && WORKING.has(s.status)) s.status = 'stopping';
    s.pendText = p.text; // shown in the row; s.preview stays Wizard's so read-state fingerprints are untouched
    // A new chat the box already lists under a stand-in name ("New chat" until its first turn runs, which a restart
    // can hold for minutes) shows the owner's own words from the tap, like the row this device made (issue 1432).
    if (p.kind === 'new' && p.text && PLACEHOLDER_TITLES.has(String(s.title || '').trim())) s.title = p.text.slice(0, 60);
    // Accepted but held by a graceful restart (outbox restartPending): saved on the box, not running (wizard-ux issue 1362).
    if (p.held) s.restartPending = true; else delete s.restartPending;
  }
  function unPend(s) {
    if (s.orig) { for (const [k, v] of Object.entries(s.orig)) { if (v === undefined) delete s[k]; else s[k] = v; } }
    delete s.orig; delete s.pend; delete s.pendText; delete s.restartPending;
  }
  // Re-read the outbox: which threads are held, and in what state. Returns true when anything changed.
  function syncPending(OB) {
    stopMarks?.(OB); // takes stopped before they reached the outbox (L.cancelSend) are withdrawn on arrival
    const before = [...PEND].map(([k, p]) => k + p.key + p.state).join();
    const latest = new Map();
    for (const it of OB._items.values()) {
      if ((it.kind !== 'reply' && it.kind !== 'new') || !it.sessionId || it.compact || it.withdrawn) continue;
      // An orb take still asking the router whether it is a background task, or one that was (issue
      // 1588): no Working row. A take the router keeps visible drops the mark and lists as usual.
      if (it.dump === true || it.dumped) continue;
      const tap = TAPS.get(it.sessionId); if (tap && it.createdAt >= tap.at) TAPS.delete(it.sessionId);
      // Custody without delivery intent must neither own Sending nor hide an older real send.
      if (OB.quarantined?.(it.id) || ['failed', 'empty', 'held', 'unconfirmed'].includes(it.state) || (it.state === 'sent' && it.steered)) continue;
      const cur = latest.get(it.sessionId); if (!cur || it.createdAt > cur.createdAt) latest.set(it.sessionId, it);
    }
    // Deleted / taken back to edit. A message Wizard already accepted keeps its hold when its outbox item goes:
    // an open thread pane (desktop) retires the item as soon as the words land in the transcript, seconds before
    // the list reports the run, and dropping the hold then flashed the thread back into Ready with Done
    // (James, 20 Oct 2026). That hold still ends on Wizard's own truth (confirmed) or PEND_MAX.
    for (const [sid, p] of PEND) if (!latest.has(sid) && !(p.state === 'sent' && !String(p.key).startsWith('tap:'))) PEND.delete(sid);
    for (const [sid, it] of latest) {
      const known = PEND.get(sid);
      if (RELEASED.has(it.id) || (it.state === 'sent' && !known && pendOver(it.sentAt || 1, it.restartPending === true))) { if (known?.key === it.id) PEND.delete(sid); continue; } // already settled
      const text = String(it.text || it.typed || '').replace(/\s+/g, ' ').trim() || (it.audio || it.audioFile ? '🎙 Voice note' : (it.files || []).length ? '📎 Attachment' : '');
      if (it.agent && otherAgent(it.agent)) AGENT_OF.set(sid, it.agent);
      PEND.set(sid, { acknowledged: known?.key === it.id && known.acknowledged, key: it.id, kind: it.kind, text, at: it.createdAt, state: it.state === 'sent' ? 'sent' : it.state === 'waiting' ? 'waiting' : 'sending', sentAt: it.sentAt || 0, runId: it.runId || '', agent: it.agent && otherAgent(it.agent) ? it.agent : '', held: it.state === 'sent' && it.restartPending === true });
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
  // Private first (wizard-ux issue 1728): the main list is the default private agent's, so it is never kept on disk.
  const mainPrivate = () => { const A = AG(), d = A?.defaultId?.(); return !!d && !!A.isPrivate?.(A.get?.(d)); };
  function writeSnap(store) {
    if (!store.ok || store.cached) return;
    if (mainPrivate()) { try { localStorage.removeItem(SNAP_KEY); } catch (_) {} return; }
    try {
      const act = s => Date.parse(s.activityAt || s.updatedAt || '') || 0;
      const rows = store.sessions.filter(s => s && s.id && !s.optimistic && !s.synthetic && !s.hidden && !(s.agent && otherAgent(s.agent)))
        .sort((a, b) => act(b) - act(a)).slice(0, SNAP_N).map(s => clipDeep(s.listVersion === 1 ? { ...s, request:'', renames:[], detailNeeded:true } : s));
      localStorage.setItem(SNAP_KEY, JSON.stringify({ schema: 1, at: store.at || Date.now(), sessions: rows, deferred: store.deferred || {} }));
      store.snapAt = Date.now();
    } catch (e) { try { localStorage.removeItem(SNAP_KEY); } catch (_) {} }
  }

  /* A Space is an explicit membership list, not an archive window. Read only its
   * missing members, four at a time across all windows. Keep these rows in memory,
   * outside unified()/the disk snapshot, so All and agent Focus keep their windows.
   * Successful reads refresh on the existing full-walk cadence; failures retry no
   * more than once a minute. Repaints/polls never fan out duplicate requests. */
  // Hydrated members are archived rows: any new activity brings them back through the
  // ordinary list (loaded rows win), so they refresh rarely (~60 x 2.6 KB reads per half hour).
  const SPACE_ROWS = new Map(), SPACE_QUEUE = [], SPACE_EVERY = 30 * 60 * 1000;
  let spaceReads = 0;
  function drainSpaceReads() {
    while (!document.hidden && spaceReads < 4 && SPACE_QUEUE.length) {
      const [id, entry] = SPACE_QUEUE.shift(); spaceReads++;
      (async () => {
        const agent = L.agentOf(id);
        const read = ++titleRead;
        try {
          const p = await (await req(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}?view=detail${agent ? `&agent=${encodeURIComponent(agent)}` : ''}`, listSignal())).json();
          const s = normalize(p.session || p);
          if (!s || s.id !== id || L.agentOf(id) !== agent || (agent && s.agent && s.agent !== agent)) throw new Error('Thread scope changed');
          if (otherAgent(s.agent)) {
            const A = AG(), a = A?.get(s.agent);
            // An id in preferences is not permission to discover a private agent.
            if (!a || (!agent && A.isPrivate(a))) throw new Error('Thread scope changed');
            AGENT_OF.set(id, s.agent);
          }
          if (agent) s.agent = agent;
          applyTitle(s, read);
          entry.row = s.hidden ? null : s;
          entry.failed = false;
        } catch (_) { entry.row = null; entry.failed = true; }
        finally {
          entry.at = Date.now(); entry.pending = false; spaceReads--;
          drainSpaceReads(); L.emit();
        }
      })();
    }
  }

  /* ---- store ---- */
  function listOverrides(agent = '') {
    const out = {}, scoped = id => (L.agentOf(id) || '') === (otherAgent(agent) ? agent : '');
    for (const [id, at] of Object.entries(readRestored())) if (scoped(id) && Date.now()-Date.parse(at)<WEEK) out[id]={restoredAt:at};
    for (const [key,d] of Object.entries(L.deferred)) {
      const id=key.replace(/^agent\/[^/]+\//,'').replace(/^[a-z]+:/,''); if (!scoped(id)) continue;
      out[id]={...(d.deferred ? {deferred:true} : {restoredAt:d.updatedAt}),...out[id]};
    }
    for (const [id,o] of OVER) if (scoped(id)) {
      const fields={}; for (const k of ['archived','deferred','restoredAt']) if (o.patch[k] !== undefined) fields[k]=o.patch[k];
      out[id]={...out[id],...fields};
    }
    return out;
  }
  /* channels: moved to live-channels.js (wizard-ux issue 1665), called once here */
  const { agentInbox, channelDaily, channelReads, channelStore, sentLog } = window.WizCore.liveParts.channels({});
  /* ---- end agent inbox ---- */
  const L = {
    windows: {},
    ok: false, error: '', sessions: [], seen: readLocal(), deferred: {}, at: 0, listeners: new Set(), loading: null,
    // cached: the list on screen is the stored snapshot (cachedAt = when it was read live); cleared by the first fresh read.
    cached: false, cachedAt: 0, snapAt: 0,
    agentSessions: {}, agentStatus: {}, // non-default agents: id -> sessions / { ok, error, at }
    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    // ticks: how many times the list changed (Chats keys its derived channel membership on it).
    ticks: 0,
    emit() { this.ticks++; for (const fn of this.listeners) { try { fn(this); } catch (e) { console.error(e); } } },
    // Archived threads are read (James, 24 Oct 2026): Archive (Done, or aged past archiveAfterDays) never shows unread.
    isNew(s) { return !this.inArchive(s) && !this.quietReply?.(s) && hasNew(s, this.seenOf(s)); },
    quietReply,
    // Same rule as groupWork's Archive section, without the per-row day maths.
    inArchive(s) {
      if (!s || s.hidden || needsApproval(s) || inWorking(s) || isDeferred(s) || isErr(s)) return false;
      if (s.archived) return true;
      const d = archiveAfterDays(), t = sectionTime(s);
      return !!d && isFinite(t) && t <= Date.now() - d * DAY;
    },
    // Visible unread: idle threads the Chats list shows unread (not working, hidden, archived or snoozed). Focus badges
    // (agents, Spaces) count only these, so a dot never points at nothing.
    // Snoozed is never unread (wizard-os issue 510): with Snooze = bottom of Ready a snoozed thread sits in Ready's tail
    // (and in the AI apps view's Snoozed), so it must not light the Ready badge while Ready shows nothing new.
    visibleUnread(rows) { const g = groupWork(rows || []), out = []; for (const [k, list] of Object.entries(g)) if (k !== 'archive' && k !== 'deferred' && k !== 'working') for (const s of list) if (hasNew(s, this.seenOf(s)) && !this.quietReply?.(s) && !(snoozeLast() && isDeferred(s) && !inWorking(s))) out.push(s); return out; },
    // Server-owned, agent-qualified receipts: activity metadata only, never transcript text.
    seenOf(s) { return this.seen; },
    seenRecord(s) { return this.seen?.threads?.[seenKeyOf(s)]; },
    // The box's snooze record for a thread (thread-dispositions), also for one the list never carries (issue 1928).
    dispositionOf(s) { return (s && this.deferred?.[seenKeyOf(s)]) || null; },
    workGroups(sessions, now) { return groupWork(sessions || this.unified(), now); },
    readyByPriority: byPriority,
    readyRank,
    readyByOldest: byOldest,
    get archiveAfterDays() { return archiveAfterDays(); },
    get chatLayout() { return chatLayout(); },
    get groupSwitch() { return groupSwitch(); },
    set chatLayout(v) { const x = v === 'status' ? 'status' : 'day'; try { localStorage.setItem(LAYOUT_KEY, x); } catch (e) {} putPrefs({ chatLayout: x }); },
    set archiveAfterDays(d) { try { localStorage.setItem(ARCH_KEY, String(d)); } catch (e) {} putPrefs({ archiveAfterDays: d }); },
    putPrefs,
    // The phone bar's pinned slot (wizard-ux#1929): this device at once, then the box for every device.
    setPhoneSlot: id => { const v = typeof id === 'string' && /^[A-Za-z0-9._-]{0,80}$/.test(id) ? id : ''; try { localStorage.setItem('wos.phone.slot.v1', v); } catch (_) {} return putPrefs({ phoneSlot: v }); },
    workingOrder: () => { try { return window.WizChatsListModel.workingOrderOf(localStorage.getItem('wos.chats.workingOrder.v1')); } catch (_) { return 'alphabetical'; } },
    setWorkingOrder: o => {
      if (!window.WizChatsListModel.WORKING_SORTS.some(([v]) => v === o)) return false;
      try { if (localStorage.getItem('wos.chats.workingOrder.v1') === o) return true; localStorage.setItem('wos.chats.workingOrder.v1', o); } catch (_) {}
      // Paint now, reconcile the shared preference afterwards, just like Ready.
      window.dispatchEvent(new Event('wos:prefs'));
      putPrefs({ workingOrder: o }); return true;
    },
    prefOps,
    cardAt,
    groups(agent = '') {
      const now = Date.now(), needs = [], ready = [], working = [];
      for (const s of this.sessionsFor(agent)) {
        if (s.archived || s.hidden) continue;
        const def = this.deferred[seenKeyOf(s)]?.deferred;
        if (globalThis.WizChatsListModel.isListWorking(s)) { working.push(s); continue; }
        if (snoozeLast() && isDeferred(s)) continue; // snoozeOrder('last'): not Needs you until restored/replied
        if (['waiting_for_approval', 'unknown'].includes(s.status)) { needs.push(s); continue; }
        if (s.status === 'queued' && s.queueReason === 'provider_access' && !globalThis.WosErrors?.dismissed?.(s)) { needs.push(s); continue; }
        if (def) continue;
        const at = Date.parse(assistantAt(s) || s.activityAt || s.updatedAt);
        if (isFinite(at) && at < now - WEEK) continue;
        if (!hasNew(s, this.seenOf(s)) || this.quietReply?.(s)) continue;
        if (s.status === 'failed' || s.status === 'interrupted' || s.critical) needs.push(s); else ready.push(s);
      }
      const t = s => Date.parse(assistantAt(s) || s.activityAt || s.updatedAt) || 0;
      for (const g of [needs, ready, working]) g.sort((a, b) => t(b) - t(a));
      return { needs, ready, working };
    },
    // chat-power.js: a Continue tap settled this saved background result (#14); hide it for good on this device.
    /* Dismiss the Service's saved-result Needs you (wizard-agent-service issue 469, on for everyone): kept on
     * the box, so every device's next list read drops it. No id = every saved result of the thread (Done, Archive).
     * Main agent's threads only (the Service route is the main agent's). Resolves true once the box has it. */
    async dismissBackground(sid, id = '') {
      const s = this.session(sid);
      if (!s || otherAgent(this.ownerOf(s))) return false;
      try {
        const r = await fetch('/wizard/background-results/dismiss', { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: J, body: JSON.stringify({ session_id: sid, ...(id ? { id } : {}) }) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok && r.status !== 409) return false;
        for (const x of [id, ...(Array.isArray(out.ids) ? out.ids : [])]) if (typeof x === 'string' && x) BACKGROUND_SETTLED.add(x);
        const c = this.session(sid); if (c?.backgroundResult && (!id || c.backgroundResult.id === id)) c.backgroundResult = null;
        this.emit(); return true;
      } catch (_) { return false; }
    },
    // Done and Archive on a thread whose Needs you the Service added (issue 469): dismiss it on the box too.
    dismissSaved(s) { if (savedResultAsk(s)) void this.dismissBackground(s.id); },
    backgroundSettled(id) { if (typeof id === 'string' && id) BACKGROUND_SETTLED.add(id); for (const s of this.sessions || []) if (s.backgroundResult?.id === id) s.backgroundResult = null; },
    async refresh() {
      if (this.loading) return this.loading;
      this.loading = (async () => {
        try {
          const started = Date.now();
          // Coming back to a list that is already old (phone woke, slow server): repaint now so Chats says it is updating.
          this.loadingAt = started; if (this.at && started - this.at > STALE_AFTER) this.emit();
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
            const d = deferred[seenKeyOf(s)];
            delete s.deferred; delete s.deferredAt; delete s.restoredAt;
            if (d) { if (d.deferred) { s.deferred = true; s.deferredAt = d.updatedAt; } else s.restoredAt = d.updatedAt; }
            applyLocal(s, got.titleRead);
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
          // Retry device-local reads after reconnect/reload; failed writes must not strand a private receipt.
          // Once per record version (wizard-ux issue 1428), never on every list read.
          resendSeen(this, merged, remote);
          this.ok = true; this.error = ''; this.at = Date.now(); this.cached = false;
          setTimeout(preload, 0); // main-list truth, before unrelated runtimes
          };
          // Only a cold list paints early; a later full walk replaces a list that is already on screen in one go.
          // A stored snapshot counts as on screen: painting page 1 over it, then the full walk, then other agents'
          // threads made a reload flicker through four different lists (James, 23 Oct 2026). From a snapshot the
          // list now changes once, straight to the fresh one.
          // A first run anywhere (no read state on device or server) waits for the whole list, which it marks read.
          const fromSnap = this.cached;
          const early = !this.ok && full ? async page => { const [d, r] = await side; if (!merge(readLocal(), merge(this.seen, r))) return; apply(page, d, r); this.emit(); } : null;
          const got = await fetchSessions(full, '', early);
          const [deferred, remote] = await side;
          apply(got, deferred, remote);
          const backgroundSessions = this.sessions;
          // Paint the ordinary list and start routed reads without waiting for saved-result discovery.
          void mergeBackgroundResults(backgroundSessions, () => this.sessions === backgroundSessions).then(() => {
            if (this.sessions !== backgroundSessions) return;
            writeSnap(this); this.emit();
          }).catch(() => {});
          if (Date.now() - this.snapAt > SNAP_EVERY) writeSnap(this);
          // Other agents' threads merge in after the main list is on screen; one slow agent never holds Chats.
          // Replacing a snapshot, they get a short head start so main and agents land in the same repaint.
          const agents = this.refreshAgents(deferred);
          if (fromSnap) await Promise.race([agents, new Promise(r => setTimeout(r, AGENT_WAIT))]);
          this.emit();
          await agents;
        } catch (e) { this.error = e.status === 403 ? 'access' : 'offline'; this.errorAt = Date.now(); }
        finally { this.loading = null; this.emit(); }
      })();
      return this.loading;
    },
    /* Each non-default agent's threads, from that agent (agent=<id>). One agent failing never hides another. */
    async refreshAgents(deferred = this.deferred, only = '') {
      const A = AG(); if (!A) return;
      if (!A.ready) await A.load().catch(() => {});
      const others = A.others(), known = others.map(a => a.id), now = Date.now();
      for (const k of Object.keys(this.agentSessions)) if (!known.includes(k)) { delete this.agentSessions[k]; delete this.agentStatus[k]; }
      for (const k of [...AGENT_POLL.keys()]) if (!known.includes(k)) AGENT_POLL.delete(k);
      // A removed agent's threads stop opening under it (wizard-agent-service issue 649): only a read agents list,
      // hidden agents included, decides; a failed read keeps every mapping.
      if (!A.error && Array.isArray(A.list) && A.list.length) { const all = new Set([...A.list.map(a => a.id), ...known]); for (const [sid, a] of AGENT_OF) if (!all.has(a)) AGENT_OF.delete(sid); }
      const due = others.filter(a => {
        if (only && a.id !== only) return false;
        const p = AGENT_POLL.get(a.id);
        if (a.status === 'error') { // its list 404s: show it as not reachable, never poll it
          const prev = this.agentStatus[a.id]; this.agentSessions[a.id] = this.agentSessions[a.id] || [];
          this.agentStatus[a.id] = prev?.ok ? { ok: true, error: 'offline', at: prev.at } : { ok: false, error: 'offline', at: prev?.at || now };
          return false;
        }
        return only || !p?.holdUntil || now >= p.holdUntil || p.holdStatus !== (a.status || '');
      });
      await Promise.all(due.map(a => {
        const id = a.id, p = AGENT_POLL.get(id) || {}; AGENT_POLL.set(id, p);
        // One list read per agent at a time: a poll joins the read in flight; a read for this agent alone
        // (a send just landed) waits for it, then reads again so it sees the new state.
        if (p.read && !only) return p.read;
        const before = p.read;
        const mine = (async () => {
          if (before) await before.catch(() => {});
          const full = !p.fullAt || Date.now() - p.fullAt > FULL_EVERY;
          try {
            const got = await fetchSessions(full, id);
            p.holdUntil = 0;
            if (got.meta) this.windows[id] = got.meta;
            let list = got.sessions.filter(s => !s.agent || s.agent === id).map(s => { s.agent = id; AGENT_OF.set(s.id, id); return s; });
            if (got.complete) {
              p.fullAt = Date.now();
              // A thread this agent's whole list no longer holds and the main list does is the main agent's: an
              // earlier wrong list (issue 649) must not keep opening it here.
              const mine = new Set(list.map(s => s.id)), main = new Set((this.sessions || []).map(s => s.id));
              for (const [sid, a] of AGENT_OF) if (a === id && !mine.has(sid) && main.has(sid)) AGENT_OF.delete(sid);
            }
            else { const fresh = new Set(list.map(s => s.id)); list = list.concat((this.agentSessions[id] || []).filter(s => !fresh.has(s.id) && !s.optimistic)); }
            for (const s of list) {
              const d = deferred[seenKeyOf(s)];
              delete s.deferred; delete s.deferredAt; delete s.restoredAt;
              if (d) { if (d.deferred) { s.deferred = true; s.deferredAt = d.updatedAt; } else s.restoredAt = d.updatedAt; }
              applyLocal(s, got.titleRead);
            }
            addSynthetic(list, id);
            window.WosModels?.reconcile(list);
            this.agentSessions[id] = list; this.agentStatus[id] = { ok: true, error: '', at: Date.now() };
          } catch (e) {
            // Same contract as the main list: a failed refresh keeps the threads already shown and marks them
            // Not up to date (with the real last-read time); only an agent never read yet shows the connection card.
            const prev = this.agentStatus[id], error = e.status === 403 ? 'access' : 'offline';
            this.agentSessions[id] = this.agentSessions[id] || [];
            this.agentStatus[id] = prev?.ok && error !== 'access' ? { ok: true, error, at: prev.at } : { ok: false, error, at: Date.now() };
            // No list there (404): back off instead of re-asking on every poll; the retry tries the list shape again.
            if (e.status === 404) { p.holdUntil = Date.now() + FULL_EVERY; p.holdStatus = a.status || ''; LIST_SUPPORT.delete(id); }
          } finally { if (p.read === mine) p.read = null; }
        })();
        return (p.read = mine);
      }));
      let migrated = false, state = merge(readLocal(),this.seen) || {initializedAt:Date.now(),threads:{}};
      for (const s of Object.values(this.agentSessions).flat()) {
        const old = AGENT_SEEN.threads[keyOf(s)];
        if (old) { state.threads[seenKeyOf(s)] = {...later(state.threads[seenKeyOf(s)],old),previewFingerprint:'private'}; delete AGENT_SEEN.threads[keyOf(s)]; migrated=true; }
      }
      if (migrated) {
        this.seen=state;writeLocal(state);
        try { localStorage.setItem(AGENT_SEEN_KEY,JSON.stringify(AGENT_SEEN)); } catch {}
        putSeen(state).then(r=>{this.seen=merge(this.seen,r);writeLocal(this.seen);this.emit();}).catch(()=>{});
      }
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
    // peek: badges/strip read loaded + already-hydrated rows only; never start reads.
    // agent: the Space's owner. A routed agent's Space member beyond its list window has no
    // AGENT_OF yet; the owner-made Space scopes its read (the proxy still enforces that agent).
    spaceSessions(ids, { peek = false, agent = '' } = {}) {
      const loaded = new Map(this.unified().map(s => [s.id, s])), rows = [];
      const scope = otherAgent(agent) && AG()?.get(agent) ? agent : '';
      let pending = false, failed = false;
      for (const id of new Set(ids)) {
        if (typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(id)) continue;
        if (loaded.has(id)) { const s = loaded.get(id); if (!s.hidden) rows.push(s); continue; }
        if (scope && !AGENT_OF.has(id)) AGENT_OF.set(id, scope);
        let entry = SPACE_ROWS.get(id);
        if (!peek && !document.hidden && (!entry || (!entry.pending && Date.now() - entry.at >= (entry.failed ? STALE_AFTER : SPACE_EVERY)))) {
          if (!entry) { entry = { row: null, at: 0 }; SPACE_ROWS.set(id, entry); }
          entry.pending = true; SPACE_QUEUE.push([id, entry]);
        }
        pending ||= !!entry?.pending; failed ||= !!entry?.failed;
        const s = entry?.row;
        // Removed agents and scope changes cannot resurrect a cached row.
        if (!s || s.hidden || (otherAgent(s.agent) && (!AG()?.get(s.agent) || this.agentOf(id) !== s.agent))) continue;
        const d = this.deferred[seenKeyOf(s)];
        delete s.deferred; delete s.deferredAt; delete s.restoredAt;
        if (d) { if (d.deferred) { s.deferred = true; s.deferredAt = d.updatedAt; } else s.restoredAt = d.updatedAt; }
        applyLocal(s); rows.push(s);
      }
      if (!peek) drainSpaceReads();
      return { rows, pending, failed };
    },
    // A private agent's thread (by id): its rows carry the lock and its words never enter another agent's context.
    // A main-list thread is private when the default agent is (private first, wizard-ux issue 1728: its rows are that agent's).
    isPrivate(id) { const A = AG(); if (!A || !id || id === '__new__') return false; const a = this.agentOf(id) || A.defaultId?.() || ''; return !!a && !!A.isPrivate?.(A.get?.(a)); },
    statusFor(agent = '') { return otherAgent(agent) ? (this.agentStatus[agent] || { ok: false, error: '' }) : { ok: this.ok, error: this.error, cached: this.cached, cachedAt: this.cachedAt, loading: !!this.loading, at: this.at || 0 }; },
    // The non-default agent a thread is pinned to, or '' for the main agent.
    agentOf(id) { if (!id || id === '__new__') return ''; const a = AGENT_OF.get(id); return a && otherAgent(a) ? a : ''; },
    pinAgent(id, agent) { if (id && agent && otherAgent(agent)) AGENT_OF.set(id, agent); },
    // ids, or the row objects themselves: a caller holding the row a window shows (a routed thread that shares its
    // id with a main one) marks that row, never the id-first main match.
    markSeen(ids) {
      const all = (Array.isArray(ids) ? ids : [ids]).map(id => id && typeof id === 'object' ? id : this.session(id)).filter(Boolean);
      const ts = Date.now();
      const list = all;
      if (!list.length) return;
      const records = list.map(s => [seenKeyOf(s), s]);
      let state = merge(readLocal(), this.seen) || { initializedAt: ts, threads: {} };
      const threads = { ...state.threads };
      for (const [k, s] of records) threads[k] = seenRecord(threads[k], s, ts);
      state = { ...state, threads };
      this.seen = state; writeLocal(state); this.emit();
      putSeen(state).then(r => { this.seen = merge(this.seen, r); writeLocal(this.seen); this.emit(); }).catch(() => {});
    },
    /* Mark done (wizard-ux issue 1317): read as of now (the green markers) and handled through the reply it shows (the
     * amber Needs you), in the same synced seen record. Rows as for markSeen. Resolves true once the box has it. */
    markHandled(ids) {
      const list = (Array.isArray(ids) ? ids : [ids]).map(id => id && typeof id === 'object' ? id : this.session(id)).filter(Boolean);
      if (!list.length) return Promise.resolve(false);
      const ts = Date.now();
      let state = merge(readLocal(), this.seen) || { initializedAt: ts, threads: {} };
      const threads = { ...state.threads };
      for (const s of list) {
        const k = seenKeyOf(s), rec = seenRecord(threads[k], s, ts), rev = handledRev(s), was = Date.parse(rec.handledThrough ?? '');
        threads[k] = isFinite(Date.parse(rev)) && !(was > Date.parse(rev)) ? { ...rec, handledThrough: rev } : rec;
      }
      state = { ...state, threads };
      this.seen = state; writeLocal(state); this.emit();
      // Done also clears a saved-result Needs you the Service added (issue 469), on the box for every device.
      for (const s of list) this.dismissSaved?.(s);
      return putSeen(state).then(r => { this.seen = merge(this.seen, r); writeLocal(this.seen); this.emit(); return true; }).catch(() => false);
    },
    handled(s) { return !!s && handledOf(s, this.seen); },
    async markUnread(ids) {
      const list = (Array.isArray(ids) ? ids : [ids]).map(id => this.session(id)).filter(Boolean);
      if (!list.length) return false;
      const before = merge(readLocal(), this.seen) || { initializedAt: Date.now(), threads: {} };
      const unreadAt = Math.max(Date.now(), ...list.map(s => (before.threads[seenKeyOf(s)]?.seenAt ?? 0) + 1));
      const threads = { ...before.threads };
      for (const s of list) {
        const key = seenKeyOf(s), prior = threads[key];
        threads[key] = { ...recordFor(s, prior?.seenAt ?? 0), ...(prior?.assistantActivityAt ? { assistantActivityAt: prior.assistantActivityAt } : {}), ...(prior?.handledThrough ? { handledThrough: prior.handledThrough } : {}), unreadAt };
      }
      const pending = { ...before, threads };
      this.seen = pending; writeLocal(pending); this.emit();
      try {
        const remote = await putSeen(pending);
        if (!list.every(s => (remote?.threads?.[seenKeyOf(s)]?.unreadAt ?? -1) >= unreadAt)) throw new Error('Unread marker was not saved');
        this.seen = merge(this.seen, remote); writeLocal(this.seen); this.emit();
        // A second device may have read the thread while this write was in
        // flight. Its newer seenAt wins; do not claim the row was marked.
        return list.every(s => {
          const record = this.seen?.threads?.[seenKeyOf(s)];
          return (record?.unreadAt ?? -1) > (record?.seenAt ?? 0);
        });
      } catch (e) {
        const current = this.seen || pending, rolledBack = { ...current, threads: { ...current.threads } };
        for (const s of list) {
          const key = seenKeyOf(s);
          if (rolledBack.threads[key]?.unreadAt !== unreadAt) continue;
          if (before.threads[key]) rolledBack.threads[key] = before.threads[key]; else delete rolledBack.threads[key];
        }
        this.seen = rolledBack; writeLocal(rolledBack); this.emit();
        return false;
      }
    },
    session(id) {
      const s = this.sessions.find(x => x.id === id); if (s) return s;
      for (const list of Object.values(this.agentSessions)) { const a = list.find(x => x.id === id); if (a) return a; }
      return DETAIL.get(id) || SPACE_ROWS.get(id)?.row || this.chanStore?.find(id) || null;
    },
    /* The row a Chats window actually shows. An agent window reads its own list, so a routed agent and main can
     * share one thread id without either window resolving the other owner's row. Main windows keep session(). */
    sessionFor(id, agent = '') {
      if (!otherAgent(agent)) return this.session(id);
      const a = (this.agentSessions[agent] || []).find(x => x.id === id); if (a) return a;
      const d = DETAIL.get(id); if (d && d.agent === agent) return d;
      const c = this.chanStore?.find(id, agent); if (c) return c;
      const f = this.session(id); return f && this.ownerOf(f) === agent ? f : null;
    },
    // The owning agent of one row object ('' for main), from the row itself rather than the id-only pin map.
    ownerOf(s) {
      if (!s) return '';
      if (otherAgent(s.agent)) return s.agent;
      for (const [a, list] of Object.entries(this.agentSessions)) if (otherAgent(a) && list.includes(s)) return a;
      return '';
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
      if (opts.fileIds?.length) body.wizard_file_ids = [...new Set(opts.fileIds)];
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
          if (opts.fileIds?.length) steer.wizard_file_ids = [...new Set(opts.fileIds)];
          await req(`/wizard/hermes/v1/runs/${encodeURIComponent(s.runId)}/steer${aq(id)}`, { method: 'POST', headers: J, body: JSON.stringify(steer) });
          return { steered: true, runId: s.runId };
        } catch (e) { if (e.code === 'dispatch_already_attempted' || ![404, 409, 410].includes(e.status)) throw e; }
      }
      const body = { session_id: id, input, ...route, require_model_lock: true };
      if (opts.instructions) body.instructions = String(opts.instructions).slice(0, 2000);
      if (opts.fileIds?.length) body.wizard_file_ids = [...new Set(opts.fileIds)];
      const r = await req('/wizard/hermes/v1/runs' + aq(id), { method: 'POST', headers: { ...J, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
      const run = await r.json().catch(() => ({}));
      const runId = run.run_id || run.id || '';
      if (s) Object.assign(s, { status: 'running', runId, lastUserAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      this.emit(); setTimeout(() => this.refresh(), 3000);
      return { steered: false, runId };
    },
    /* Full message history of one thread (oldest first), paged like Wizard. */
    async messages(id) {
      // A trusted list row or explicit agent pin already establishes scope.
      // Optional detail must not delay current answers; cold links discover first.
      const knownScope = this.agentOf(id) || (this.listTrusted?.() && this.sessions.some(s => s.id === id && !s.optimistic));
      if (!knownScope && (!this.session(id) || this.session(id).detailNeeded)) await this.sessionInfo(id);
      const rows = [], signal = globalThis.AbortSignal?.timeout?.(12000);
      for (let offset = 0; offset < 5000; offset += 500) {
        const p = await (await req(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}/messages?order=oldest&limit=500&offset=${offset}&include_compacted=true&view=wizard${aq(id, '&')}`, { signal })).json();
        const page = p.data || p.messages || p.items || [];
        rows.push(...page);
        const n = Number(p.pagination?.returned ?? page.length);
        if (!isFinite(n) || n < 500 || !page.length) break;
      }
      return rows;
    },
    /* The first page of one thread's history (oldest first): the Channels feed's post is its first owner message.
     * The caller names the row's own agent ('' = main): a main and a routed thread can share one id. */
    async firstMessages(id, agent = '', limit = 20) {
      const a = otherAgent(agent) ? agent : '';
      const p = await (await req(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}/messages?order=oldest&limit=${Math.max(1, Math.min(50, limit | 0))}&offset=0&include_compacted=true&view=wizard${a ? `&agent=${encodeURIComponent(a)}` : ''}`, { signal: globalThis.AbortSignal?.timeout?.(12000) })).json();
      const page = p.data || p.messages || p.items || [];
      // How many rows the service itself returned (its view=wizard page can hold fewer): only a page it returned short
      // of the limit is the whole thread (wizard-ux issue 1269).
      const n = Number(p.pagination?.returned ?? page.length);
      const more = p.has_more === true || p.pagination?.has_more === true, lim = Math.max(1, Math.min(50, limit | 0));
      page.returned = Math.max(isFinite(n) ? n : 0, page.length, more ? lim : 0);
      return page;
    },
    /* One thread's whole history (oldest first) for the row's own agent: the Channels feed counts the replies James
     * sees from it (wizard-ux issue 1266), because message_count also counts tool calls, results and status rows. */
    // Read to the end (each page has its own timeout); a history past THREAD_ROWS_MAX comes back marked truncated, so
    // the caller never takes a part for the whole.
    async threadRows(id, agent = '') {
      const a = otherAgent(agent) ? agent : '', rows = [];
      for (let offset = 0; ; offset += 500) {
        if (offset >= THREAD_ROWS_MAX) { rows.truncated = true; break; }
        const p = await (await req(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}/messages?order=oldest&limit=500&offset=${offset}&include_compacted=true&view=wizard${a ? `&agent=${encodeURIComponent(a)}` : ''}`, { signal: globalThis.AbortSignal?.timeout?.(12000) })).json();
        const page = p.data || p.messages || p.items || [];
        rows.push(...page);
        const n = Number(p.pagination?.returned ?? page.length);
        if (!isFinite(n) || n < 500 || !page.length) break;
      }
      return rows;
    },
    // When this row was last read (ms): replies after it are new. 0 = never read.
    readAt(s) {
      const r = s && this.seen?.threads?.[seenKeyOf(s)]; if (!r) return 0;
      const a = Date.parse(r.assistantActivityAt ?? ''); return isFinite(a) ? a : Number(r.seenAt) || 0;
    },
    async searchSessions(q, agent = '', signal, onBatch) {
      const read = ++titleRead;
      const scopes=otherAgent(agent)?[agent]:['',...(AG()?.others()||[]).filter(a=>a.privacy!=='private').map(a=>a.id)];
      const settled=await Promise.allSettled(scopes.map(async scope=>{
        const found=[]; let snapshot='', resets=0, legacy=false;
        for(let offset=0; offset<100000;) {
          const params=new URLSearchParams({view:'list',q,limit:'100',offset:String(offset),include_children:'false'});
          if(!legacy) params.set('mode','body');
          if(scope) params.set('agent',scope); if(snapshot) params.set('snapshot',snapshot);
          let p;
          try { p=await (await req(`/wizard/hermes/api/sessions?${params}`,{signal,headers:{'X-Wizard-Search-Scope':`${SEARCH_CLIENT}:${scope||'hermes'}`}})).json(); }
          catch(e) {
            if([400,404,501].includes(e.status)) { if(!legacy) {legacy=true;continue;} return null; }
            if(e.status===409 && offset && resets++<1) {offset=0;snapshot='';found.length=0;continue;}
            throw e;
          }
          if(p.list_version!==1 || !Number.isInteger(p.search_total)) return null;
          const body=p.mode==='body'||p.mode==='titles';
          const available=this.searchRows(scope).filter(s=>(s.agent||'hermes')===(scope||'hermes'));
          snapshot=p.snapshot||snapshot;
          for(const raw of p.data||[]) {
            if((raw.agent||'hermes')!==(scope||'hermes')) continue;
            const s=body ? {...(available.find(s=>s.id===raw.id)||indexRow({id:raw.id,agent:raw.agent,title:'Chat'},scope)),searchSnippet:raw.snippet} : normalize(raw);
            if(!s) continue;
            applyTitle(s, read);
            if(signal?.aborted) throw new DOMException('Aborted','AbortError');
            if(scope) AGENT_OF.set(s.id,scope);
            found.push(s);
          }
          found.partial=!!p.partial;
          if(!signal?.aborted) onBatch?.(found);
          if(body || !p.has_more) return found;
          if(!p.data?.length) throw new Error('Incomplete search'); offset+=p.data.length;
        }
        throw new Error('Search limit reached');
      }));
      if(signal?.aborted) throw new DOMException('Aborted','AbortError');
      const good=settled.filter(x=>x.status==='fulfilled'&&Array.isArray(x.value));
      const failed=settled.filter(x=>x.status==='rejected');
      const fallbackScopes=scopes.filter((_,i)=>settled[i].status==='fulfilled'&&settled[i].value===null);
      if(!good.length && !fallbackScopes.length && failed.length) throw failed[0].reason;
      const found=good.flatMap(x=>x.value); found.partial=failed.length>0; found.capped=good.some(x=>x.value.partial); found.fallbackScopes=fallbackScopes; // capped: the server showed only its newest message matches
      return found;
    },
    searchRows(agent='') {
      const scopes=otherAgent(agent)?[agent]:['',...(AG()?.others()||[]).filter(a=>a.privacy!=='private').map(a=>a.id)];
      const rows=new Map();
      for(const scope of scopes) {
        for(const s of TITLE_INDEX.get(scope)?.rows||[]) rows.set(`${scope}:${s.id}`,s);
        for(const s of (scope?this.agentSessions[scope]||[]:this.sessions)) rows.set(`${scope}:${s.id}`,s);
      }
      return [...rows.values()].map(s=>applyTitle(s));
    },
    rememberSearch(s) { if(s?.id) { if(otherAgent(s.agent)) AGENT_OF.set(s.id,s.agent); DETAIL.set(s.id,s); while(DETAIL.size>300) DETAIL.delete(DETAIL.keys().next().value); } },
    async sessionInfo(id) {
      const read = ++titleRead;
      let agent = this.agentOf(id);
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
      // A direct link can arrive before the scoped lists. Learn the authoritative
      // server target before the first history read or reply; never overwrite a known scope.
      if (!agent && otherAgent(s.agent) && s.id === id) { agent = s.agent; AGENT_OF.set(id, agent); }
      // An unscoped read goes to the default agent (core/agents.js routeAgent): on a box whose default is a private
      // agent its detail names that agent, which is still this thread's own scope (wizard-agent-service issue 631).
      const route = (typeof AG === 'function' && AG()?.routeAgent?.()) || '';
      if (s.agent && (s.agent || 'hermes') !== (agent || route || 'hermes')) throw new Error('Thread scope changed');
      // ... and its row stays a main-list row (agent '', as the list's own rows): one seen/side-state key, not two.
      if (agent) s.agent = agent; else if (route && s.agent === route) s.agent = '';
      const list = agent ? (this.agentSessions[agent] = this.agentSessions[agent] || []) : this.sessions;
      applyTitle(s, read, true);
      const i = list.findIndex(x => x.id === id);
      if (s.id !== id || (s.agent && otherAgent(s.agent) && s.agent !== agent)) throw new Error('Thread scope changed');
      // The detail read carries no run state for a live thread (only the list projects runs and helpers), so an
      // empty status there must not settle the row: a Working thread used to flash into Ready whenever its history
      // was preloaded or opened, until the next list read put it back. A status the detail does report still wins.
      const run = s.status ? { queueReason: s.queueReason, status: s.status } : {};
      if (i >= 0) list[i] = { ...list[i], title: s.title, request: s.request, retryRunId: s.retryRunId, ...run, safeError: s.safeError, reconnect: s.reconnect, renames: s.renames, detailNeeded: false,
        ...(s.model ? { model: s.model, provider: s.provider, modelLockAt: s.modelLockAt } : {}) };
      else if (this.windows[agent || route || 'hermes']) DETAIL.set(id, { ...s, detailNeeded: false });
      else list.push({ ...s, detailNeeded: false });
      applyLocal(i >= 0 ? list[i] : DETAIL.get(id) || s);
      return s;
    },
    /* Open / Send to inbox (wizard-ux issue 1570): the row moves on the tap frame (Open lists
     * it, Send drops it), then the box is told; a refusal puts the row back and throws. Main agent threads only. */
    async inboxMove(kind, id, opts = {}) {
      if (!this.agentInbox || (kind !== 'open' && kind !== 'send')) throw new Error('Agent inbox unavailable');
      // The main agent's own row only: a routed thread may share the id (agentSessions), and is never the one moved.
      // Issue 631: also the private default agent's, while the box names one (its wizard/private-routing switch on).
      const priv = (typeof this.agentInbox.privateDefault === 'function' && this.agentInbox.privateDefault()) || '';
      const mine = a => !otherAgent(a || '') || (!!priv && a === priv);
      const detail = DETAIL.get(id), fromDetail = !!detail && mine(detail.agent || '');
      let s = this.sessions.find(x => x.id === id) || (fromDetail ? detail : null) || (priv && opts.agent === priv ? (this.agentSessions?.[priv] || []).find(x => x.id === id) || null : null), added = false;
      if (s && !mine(this.ownerOf(s))) throw Object.assign(new Error('Only the main agent’s threads move'), { status: 409 });
      const owner = s ? this.ownerOf(s) : opts.agent === priv ? priv : '';
      if (priv && owner === priv) opts = { ...opts, agent: priv };
      const was = s ? !!s.hidden : null;
      if (kind === 'open') {
        if (!s && opts.title) s = normalize({ id, title: opts.title, updated_at: opts.at ? new Date(opts.at).toISOString() : new Date().toISOString(), hidden: false });
        if (s) { s.hidden = false; if (!this.sessions.includes(s)) { this.sessions.unshift(s); if (s === detail) DETAIL.delete(id); added = true; } }
      } else if (s) s.hidden = true;
      this.emit();
      try { return await this.agentInbox.move(kind, id, opts); }
      catch (e) {
        // Put it back where it was: the hidden flag, and a thread only read by id back in the detail cache.
        if (s) { s.hidden = was ?? kind === 'open'; if (added) { this.sessions = this.sessions.filter(x => x !== s); if (s === detail) DETAIL.set(id, s); } }
        this.emit(); throw e;
      }
      finally { setTimeout(() => this.refresh(), 800); }
    },
    /* ---- thread actions ---- */
    busy(id) { const o = OVER.get(id); return !!o && !o.settled; },
    async _act(id, patch, write, capMs = 60000) {
      const s = this.session(id); if (!s || this.busy(id)) return false;
      // A hidden worker thread is never in the list, so the next list read would drop the row this action patches and
      // its Undo would find nothing to restore (wizard-ux issue 1928): keep it readable by id.
      if (s.hidden && !DETAIL.has(id)) DETAIL.set(id, s);
      const snap = { archived: s.archived, deferred: s.deferred, deferredAt: s.deferredAt, restoredAt: s.restoredAt };
      const entry = { patch }; OVER.set(id, entry); Object.assign(s, patch); this.emit();
      // Safety: a write that never answers must not pin the thread out of its list (or block the next tap) forever; after capMs it counts as failed and the thread is restored (Close & file polls for up to 10 minutes, so it gets 11).
      let stall; const cap = new Promise((_, no) => { stall = setTimeout(() => no(new Error('write timed out')), capMs); });
      try { await Promise.race([write(s), cap]); clearTimeout(stall); entry.settled = Date.now(); this.emit(); setTimeout(() => this.refresh(), 50); return true; }
      catch (e) {
        clearTimeout(stall); if (OVER.get(id) === entry) OVER.delete(id);
        const c = this.session(id);
        if (c) { Object.assign(c, snap); if (snap.deferred === undefined) delete c.deferred; if (snap.deferredAt === undefined) delete c.deferredAt; if (snap.restoredAt === undefined) delete c.restoredAt; }
        this.emit(); return false;
      }
    },
    // Done: archive the thread (PATCH archived). Close & file: the Helm filing route, idempotent by command id.
    // Only the owner's Archive/Done action calls this; tracker Dismiss/Seen never archives (James, 8 Nov 2026).
    archive(id, { file = false } = {}) {
      // Done marks the thread read too, so it stays read on every client and if it is ever restored.
      if (this.session(id) && hasNew(this.session(id), this.seenOf(this.session(id)))) this.markSeen(id);
      // Archive also clears a saved-result Needs you the Service added (issue 469), so restoring it brings no stale ask:
      // only once the archive itself succeeded (a failed archive keeps the result Continue-able).
      const saved = this.session(id);
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
      }, file ? 11 * 60000 : 60000).then(ok => {
        if (ok) this.dismissSaved?.(saved);
        // A background task's waiting record goes with its thread (wizard-ux issue 1928): its Inbox row too.
        if (ok) try { void this.agentInbox?.archiveThread?.(id); } catch (_) {}
        return ok;
      });
    },
    // Stop exactly the watcher on the row the owner pressed: `agent` is the window's agent scope ('' = main).
    async stopWatching(id, agent) {
      const s = agent === undefined ? this.session(id) : this.sessionFor(id, agent);
      if (!s) return false;
      const owner = this.ownerOf(s);
      // One Stop per row at a time: a second tap shares the first request's answer instead of racing it to a
      // zero-count reply and reporting a failure for a stop that worked.
      const key = `${owner}\u0000${id}`, stopping = (this._stopping ||= new Map());
      if (stopping.has(key)) return stopping.get(key);
      if (this.busy(id) || !s.followUp?.active) return false;
      const pending = (async () => {
        try {
          const result = await (await req('/wizard/follow-ups/stop', { method: 'POST', headers: J,
            body: JSON.stringify({ session_id: id, ...(owner ? { agent_id: owner } : {}) }) })).json();
          if (result?.ok !== true || !Number.isSafeInteger(result.stopped) || result.stopped < 1) throw new Error('follow-up stop not confirmed');
          s.followUp = null; this.emit(); setTimeout(() => this.refresh(), 50); return true;
        } catch (e) { return false; } finally { stopping.delete(key); }
      })();
      stopping.set(key, pending);
      return pending;
    },
    async _defer(id, deferred) {
      const s = this.session(id); if (!s) throw new Error('gone');
      const ag = this.agentOf(id);
      const p = await (await req('/wizard/thread-dispositions', { method: 'PUT', headers: J, body: JSON.stringify({ sessionId: id, runtime: s.runtime || 'direct', deferred, ...(ag && ag !== 'hermes' ? { agent_id: ag } : {}) }) })).json();
      if (p?.record?.deferred !== deferred || !isFinite(Date.parse(p.record.updatedAt))) throw new Error('Thread disposition was not saved.');
      this.deferred[seenKeyOf(s)] = p.record;
      return p.record;
    },
    defer(id) { return this._act(id, { deferred: true, deferredAt: new Date().toISOString() }, () => this._defer(id, true)); },
    /* Rename: James's own title for a thread. It locks the name: the agent never renames it after this. */
    async rename(id, title) {
      const s = this.session(id), t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!s || !t || this.busy(id)) return false;
      const key = titleScope(s), previous = RENAMES.get(key);
      if (previous && !previous.settled) return false;
      if (t === s.title) return true;
      const before = s.title, entry = { title:t, settled:0, confirmed:0 };
      RENAMES.set(key, entry); paintTitle(this, s, t); this.emit();
      try {
        const r = await fetch(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}${aq(id)}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t }) });
        if (!r.ok) { let msg = ''; try { msg = (await r.json())?.error?.message || ''; } catch (e) {} throw Object.assign(new Error(msg || 'rename failed'), { status: r.status }); }
        entry.settled = ++titleRead;
        confirmTitle(this, id, entry);
        writeSnap(this);
        setTimeout(() => this.refresh(), 50); return true;
      } catch (e) {
        if (RENAMES.get(key) === entry) {
          if (previous) RENAMES.set(key, previous); else RENAMES.delete(key);
          paintTitle(this, s, before);
        }
        this.emit(); return /already in use/i.test(e.message) ? 'taken' : false;
      }
    },
    // Restore: a deferred thread comes back to Work; an archived (or aged-out) one is un-archived and lands in Ready.
    restore(id) {
      const s = this.session(id); if (!s) return Promise.resolve(false);
      const at = new Date().toISOString();
      if (s.deferred && !s.archived) return this._act(id, { deferred: false, restoredAt: at }, () => this._defer(id, false));
      return this._act(id, { archived: false, deferred: false, restoredAt: at }, async () => {
        await req(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}${aq(id)}`, { method: 'PATCH', headers: J, body: JSON.stringify({ archived: false }) });
        writeRestored({ ...readRestored(), [id]: at });
      }).then(ok => {
        // Undo / Restore brings back the waiting record its archive took (wizard-ux issue 1928).
        if (ok) try { void this.agentInbox?.restoreThread?.(id); } catch (_) {}
        return ok;
      });
    },
    /* One thread's own state by id, stored nowhere (wizard-ux issue 1928): the Inbox reads a hidden worker thread's
     * archived / snoozed / status line this way, since the list never carries it. Null when the box has no such thread. */
    async peekSession(id) {
      const p = await (await req(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}${aq(id)}`, { cache: 'no-store' })).json();
      const raw = p?.session || p;
      return raw && (raw.id || raw.session_id) ? normalize(raw) : null;
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
    /* Stop shows “Stopping…” on the tap itself, before the request leaves (wizard-ux issue 1576: on desktop the press
     * looked ignored while the POST was in flight, and a repaint brought the Stop button back). A Stop that can't be
     * delivered in STOP_SEND_MS puts the row back and throws, so the caller says so. Once delivered, the list is
     * re-read quickly until the run has settled, instead of waiting for the next 15 s poll. */
    async stop(runId, sid = '') {
      // A deadline on every WebView: AbortSignal.timeout is missing on iOS 16.0-16.3 (see core/status.js).
      const ac = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ac ? setTimeout(() => ac.abort(), STOP_SEND_MS) : 0;
      const sent = req(`/wizard/hermes/v1/runs/${encodeURIComponent(runId)}/stop${rq(runId)}`, ac ? { method: 'POST', signal: ac.signal } : { method: 'POST' }); // on the wire before the repaint
      sent.catch(() => {}); // awaited below; never an unhandled rejection while the repaint runs
      const undo = markStopping(this, runId, sid);
      try { await sent; } catch (error) { STOPPING.delete(runId); undo(); this.emit(); this.refresh().catch?.(() => {}); throw error; }
      finally { clearTimeout(timer); }
      STOPPING.set(runId, Date.now());
      const rows = runRows(this, runId, sid).filter(s => WORKING.has(s.status) && s.status !== 'stopping'); for (const s of rows) s.status = 'stopping'; if (rows.length) this.emit();
      followStop(this, runId, sid);
    },
  };
  workLate({ L });
  // Wizard (in its desk, or another tab) writes the same key when a chat is opened.
  addEventListener('storage', e => { if (e.key === SEEN_KEY || e.key === SEEN_BASE) { L.seen = merge(L.seen, readLocal()); L.emit(); } });
  // Open on the last snapshot (see SNAP_KEY). at stays 0, so the connection banner never counts it as a live read.
  { const snap = readSnap(); if (snap && snap.sessions.length) { L.sessions = snap.sessions; L.deferred = snap.deferred || {}; for (const s of L.sessions) applyLocal(s); L.ok = true; L.cached = true; L.cachedAt = snap.at; } }
  document.addEventListener('visibilitychange', () => { if (document.hidden) writeSnap(L); });
  addEventListener('pagehide', () => writeSnap(L));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) L.refresh(); });
  setInterval(() => { if (!document.hidden) L.refresh(); }, 15000);
  // outbox.js loads after this file: follow it once every script has run.
  /* streams: moved to live-streams.js (wizard-ux issue 1665), called once here */
  const { applyStopMarks, pendingFor, STOP_MARK_MS, STOP_MARKS, withdrawSends } = window.WizCore.liveParts.streams({ AG, iso, L, otherAgent, PEND, PEND_MAX, RELEASED, req, syncPending, unPend });
  stopMarks = applyStopMarks;
  L.cancelSend = async (sid, runId = '') => {
    const OB = window.WosOutbox;
    if (!sid || CANCELLING.has(sid)) return { outcome: 'busy', runIds: [], items: [] };
    CANCELLING.add(sid); resync(); L.emit();
    try {
      const at = Date.now(), p = PEND.get(sid), tapped = TAPS.has(sid);
      // A run already known is stopped at once, never after the withdrawals (a steer still in flight answers late).
      const known = [...new Set([runId, p?.runId].filter(Boolean))];
      const stops = known.map(id => L.stop(id, sid).then(() => null, e => e)); // settled here, thrown below
      const w = OB ? await withdrawSends(OB, pendingFor(OB, sid)) : { items: [], started: [] };
      if (tapped) { STOP_MARKS.set(sid, { at, until: at + STOP_MARK_MS }); TAPS.delete(sid); }
      const later = [...new Set(w.started)].filter(id => !known.includes(id));
      const failed = (await Promise.all([...stops, ...later.map(id => L.stop(id, sid).then(() => null, e => e))])).find(Boolean);
      if (failed) throw failed;
      const runIds = [...known, ...later];
      return { outcome: runIds.length ? 'stopped' : w.items.length || tapped ? 'cancelled' : 'none', runIds, items: w.items };
    } finally { CANCELLING.delete(sid); resync(); L.emit(); }
  };
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
  const revOf = s => s ? [s.messageCount, s.lastAssistantAt, s.lastUserAt].join('|') : '';
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
  // What the transcript contains, as the list reports it: message count and the newest user/assistant times.
  // Status and tool activity are left out, so they never invalidate a copy whose messages are unchanged.
  const ckOf = s => s ? [s.messageCount, s.lastAssistantAt, s.lastUserAt].join('|') : '';
  L.contentKey = ckOf;
  // The list can vouch for a copy only after a live list read since the page last came to the front: a stored
  // snapshot or a list from before the phone slept describes the same old transcript the copy has.
  let shownAt = Date.now();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) shownAt = Date.now(); });
  L.listTrusted = () => !L.cached && (L.at || 0) >= shownAt;
  // A stored copy paints only when it matches what the live list says the thread holds. Painting an older copy
  // showed the previous reply for 1-2 s before the fresh read replaced it (James, 24 Oct 2026); a skeleton is
  // honest, an outdated reply is not.
  L.cachedMessages = id => {
    const c = keepable(id) && TC.get(id), s = L.session(id); if (!c || !s || !L.listTrusted()) return null;
    return String(c.rev || '').split('|').slice(0, 3).join('|') === ckOf(s) ? c.rows : null;
  };
  // No answer from Wizard at all (offline, plane wifi): the last copy this device kept, whatever its age. chats.js
  // shows it only after a read has failed, labelled as a saved copy, and the next good read replaces it.
  L.savedMessages = id => { const c = keepable(id) && TC.get(id); return c && Array.isArray(c.rows) ? { rows: c.rows, at: c.at || 0 } : null; };
  // A thread the server answered 404 for is gone: drop its memory and IndexedDB copy so a reopen can't repaint it.
  L.forgetMessages = async id => {
    if (!id) return; TC.delete(id);
    const db = await tcOpen(); if (!db) return;
    try { db.transaction('t', 'readwrite').objectStore('t').delete(id); } catch (e) {}
  };
  const saving = () => !!navigator.connection?.saveData;
  L.warm = id => {
    const s = L.session(id); if (!s || s.archived || s.optimistic || document.hidden || saving() || INFLIGHT.size >= 2 || INFLIGHT.has(id) || !keepable(id)) return;
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
      const want = [...(g.ready || []), ...(g.errors || []), ...(g.working || [])].filter(s => !s.archived && !s.hidden && !s.optimistic && !s.synthetic && keepable(s.id)).slice(0, 16);
      for (const s of want) {
        if (document.hidden || saving() || !L.session(s.id)) break;
        if (INFLIGHT.size >= 2 && !INFLIGHT.has(s.id)) continue;
        const c = TC.get(s.id);
        if (c && c.rev === revOf(s)) continue;
        if (c && WORKING.has(s.status) && Date.now() - c.at < 60000) continue;
        try { await bgRead(s.id); } catch (e) {}
        await new Promise(r => setTimeout(r, 120));
      }
    } finally { pfBusy = false; }
  }

  /* The channel store (above): feed rows get this device's local state like hydrated Space rows (spaceSessions), and a
   * routed agent's row is pinned to that agent unless the main list already holds the same id. */
  L.chanStore = channelStore({ req, normalize, emit: () => L.emit(), onError: () => window.dispatchEvent(new Event('wos:prefs-error')),
    onRow: (s, agent) => {
      if (agent && !AGENT_OF.has(s.id) && !L.sessions.some(x => x.id === s.id)) AGENT_OF.set(s.id, agent);
      const d = L.deferred[seenKeyOf(s)];
      if (d) { if (d.deferred) { s.deferred = true; s.deferredAt = d.updatedAt; } else s.restoredAt = d.updatedAt; }
      applyLocal(s); return s;
    } });
  L.chanReads = channelReads({ req, emit: () => L.emit() });
  L.chanDaily = channelDaily({ req, emit: () => L.emit() });
  L.agentInbox = agentInbox({ req, emit: () => L.emit() });
  L.sentLog = sentLog({ req, emit: () => L.emit() }); // the Sent tab (wizard-ux issue 1778)
  try { addEventListener('focus', () => { L.chanStore.fresh(); L.chanReads.fresh(); }); document.addEventListener('visibilitychange', () => { if (!document.hidden) { L.chanStore.fresh(); L.chanReads.fresh(); } }); } catch (e) {}

  window.WizLive = L;
  window.__wizLiveInternals = { hasNew, recordFor, merge, fingerprint, normalize };
})();
