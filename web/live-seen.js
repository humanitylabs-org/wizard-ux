/* Wizard UX live data › list constants, row normalising (normalize, status, attention) and thread-seen read state
 * (exact port of wizard-mobile threadSeen.ts: fingerprints, merge, resend, local copy). Moved verbatim out of live.js (wizard-ux issue 1665: split the giant front-end
 * files, no behaviour change). live.js calls this once, where the code used to be, with the closure names it reads,
 * and keeps the names it returns under their old names. Loaded just before live.js everywhere that loads it. The
 * body below keeps live.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.liveParts = window.WizCore.liveParts || {};
window.WizCore.liveParts.seen = function ({  }) {
  let otherAgent, putSeen; // late-bound: live.js declares these after the call, see bindLate
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
    .replace(/\n*^\[WIZARD_REPLY_V1\]\n[\s\S]*?\n^\[\/WIZARD_REPLY_V1\][ \t]*$/m, ' ') // a Notifications Reply's framed item (quoted lines can't close it)
    .replace(/\n*\[WIZARD_REPLY_TO_V1\]\{[^\n]*?\}(?:\n[\s\S]*?)?\[\/WIZARD_REPLY_TO_V1\]/g, ' ') // a Thread tracker quote
    .replace(/\[WIZARD_FILES_V1\]\s*([\s\S]*?)\s*\[\/WIZARD_FILES_V1\]/g, (_, j) => chipLabel(j))
    .replace(/\[WIZARD_FILE_CHIPS_V1\]\s*([\s\S]*?)\s*\[\/WIZARD_FILE_CHIPS_V1\]/g, (_, j) => chipLabel(j))
    .replace(/\[WIZARD_IMAGE_INTENT_V1\][\s\S]*?\[\/WIZARD_IMAGE_INTENT_V1\]/g, ' ')
    .replace(/\[WIZARD_TWEAK_V1\](?:[\s\S]*?\[\/WIZARD_TWEAK_V1\]|[\s\S]*$)/g, ' ') // a tweak card (core/chat-kit.js tweakIds); unterminated: to the end
    .replace(/\[WIZARD_ACTION_V1\](?:[\s\S]*?\[\/WIZARD_ACTION_V1\]|[\s\S]*$)/g, ' ') // an action card (core/chat-kit.js actionIds)
    .replace(/^Please use the attached files?\.\s*/, '')
    .replace(/<memory-context>[\s\S]*?<\/memory-context>/g, ' ')
    .replace(/\[(?:Browser dogfooding|System note)[^\]]*\][\s\S]*$/m, ' ')
    .replace(/[#*_`>]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Only the two connection apps Wizard knows; anything else in the field is ignored.
  const RECONNECT = { claude: ['wizard-claude', 'Claude'], chatgpt: ['wizard-chatgpt', 'ChatGPT'] };
  function reconnectOf(v) {
    const app = v && typeof v === 'object' && v.kind === 'provider_signed_out' ? RECONNECT[v.provider] : null;
    if (!app || v.app_id !== app[0]) return null;
    // app_status: what the connection app reads now (Agent Service decorateReconnect); core/chat-models.js reconnect.
    return { provider: v.provider, appId: app[0], name: app[1], runId: String(v.run_id || ''), installed: v.installed !== false,
      appStatus: ['connected', 'signed_out', 'expired'].includes(v.app_status) ? v.app_status : 'unknown' };
  }
  const ATTN = new Set(['needs_you', 'check', 'done', 'fyi']);
  function attentionOf(v) {
    if (!v || typeof v !== 'object' || !ATTN.has(v.state)) return null;
    const ask = String(v.ask || '').replace(/\s+/g, ' ').trim().slice(0, 140); if (!ask) return null;
    return { state: v.state, ask, subject: String(v.subject || '').replace(/\s+/g, ' ').trim().slice(0, 40) };
  }
  function followUpOf(v) {
    if (!v || typeof v !== 'object' || v.active !== true || !Number.isSafeInteger(v.count) || v.count < 1) return null;
    const names = Array.isArray(v.names) ? v.names.map(name => String(name).replace(/\s+/g, ' ').trim().slice(0, 160)).filter(Boolean).slice(0, 3) : [];
    const nextRun = optIso(v.nextRun);
    return { active: true, count: v.count, names, ...(nextRun ? { nextRun } : {}) };
  }
  // Why the last run failed (Agent Service wizard_last_run_error, wizard-ux#166): a known code plus the provider.
  // Only the off-by-default wizard/failure-reason tweak shows it (core/chat-models.js runError).
  const RUN_ERROR_CODES = new Set(['provider_auth', 'provider_billing', 'provider_quota', 'network', 'unknown']);
  function runErrorOf(v) {
    if (!v || typeof v !== 'object' || !RUN_ERROR_CODES.has(v.code)) return null;
    const one = (x, n) => (typeof x === 'string' ? x : '').replace(/\s+/g, ' ').trim().slice(0, n);
    return { code: v.code, provider: one(v.provider, 60), message: one(v.message, 200) };
  }
  function normalize(item) {
    if (item.listVersion === 1) {
      const s = { safeError:'', reconnect:null, runError:null, critical:false, waitingOn:'', helperStatus:null, attention:null, ...item, runError: runErrorOf(item.runError), status: globalThis.WizChatsListModel.executionStatus(item.status, item.runId, item.lastRunStatus), runtime: 'direct', request: '', renames: [], detailNeeded: true };
      // Chats channels (wizard-ux issue 1261): the row's channel id and first owner request, checked after the spread.
      if (!(typeof s.channel === 'string' && /^[a-z0-9-]{1,48}$/.test(s.channel))) delete s.channel;
      // Tags (wizard-agent-service issue 608, switch wizard/chat-tags): every channel the chat carries, primary first.
      if (Array.isArray(s.tags)) s.tags = s.tags.filter(t => typeof t === 'string' && /^[a-z0-9-]{1,48}$/.test(t)).slice(0, 200); else delete s.tags;
      if (typeof s.firstRequest === 'string') s.firstRequest = s.firstRequest.slice(0, 400); else delete s.firstRequest;
      // wizard-ux issue 1808: the box's quiet-reply mark (live.js quietReply), only ever true.
      if (s.quietReply !== true) delete s.quietReply;
      return s;
    }
    const id = item.id || item.session_id; if (!id) return null;
    const raw = String(item.status || item.run_status || '');
    const status = globalThis.WizChatsListModel.executionStatus(ALIASES[raw] || raw || undefined, item.wizard_run_id, ALIASES[item.wizard_last_run_status] || item.wizard_last_run_status);
    const lastUserAt = optIso(item.wizard_last_user_at ?? item.last_user_at);
    const lastAssistantAt = optIso(item.wizard_last_assistant_at ?? item.last_assistant_at);
    const latest = item.latest_message && typeof item.latest_message === 'object' ? item.latest_message : null;
    const lastUser = item.last_user_message && typeof item.last_user_message === 'object' ? item.last_user_message : null;
    const working = WORKING.has(status) || status === 'waiting_for_approval';
    const latestText = clean(text(latest?.content ?? latest?.text));
    const userText = clean(text(lastUser?.content ?? lastUser?.text) || text(item.wizard_request_preview));
    const preview = working ? (item.wizard_helper_status ? (latestText || clean(text(item.preview)) || userText) : (userText || latestText)) : (latestText || userText || clean(text(item.preview)));
    const latestAt = optIso(latest?.timestamp ?? latest?.created_at);
    const userAt = optIso(lastUser?.timestamp ?? lastUser?.created_at);
    return {
      id, runtime: 'direct',
      title: String(item.title || item.name || 'Untitled chat'),
      source: item.source || '',
      status,
      queueReason: item.queue_reason === 'provider_access' ? 'provider_access' : '',
      safeError: typeof item.wizard_safe_error === 'string' ? item.wizard_safe_error : '',
      // The AI provider's sign-in expired (Agent Service provider-reconnect.mjs): the connection app that fixes it.
      reconnect: reconnectOf(item.wizard_reconnect),
      runError: runErrorOf(item.wizard_last_run_error),
      archived: !!item.archived, hidden: !!item.hidden,
      messageCount: Number.isSafeInteger(item.message_count) ? item.message_count : undefined,
      lastUserAt, lastAssistantAt,
      updatedAt: lastUserAt ?? iso(item.wizard_started_at ?? item.updated_at ?? item.last_active ?? item.started_at),
      activityAt: optIso(item.wizard_activity_at) || optIso(item.last_active),
      // When the thread was started (never moves): a channel feed keeps its posts in this order (issue 1289).
      startedAt: optIso(item.wizard_started_at ?? item.started_at),
      runId: String(item.wizard_run_id || ''),
      // The idempotency key of the newest run Wizard knows for this thread (= the outbox item id for our sends).
      lastRunKey: String(item.wizard_last_run_idempotency_key || ''),
      lastRunStatus: ALIASES[item.wizard_last_run_status] || String(item.wizard_last_run_status || ''),
      preview, previewRole: latest?.role === 'assistant' ? 'assistant' : latest?.role === 'user' ? 'user' : undefined,
      previewAt: latestAt,
      requestAt: userAt || lastUserAt,
      assignedAt: optIso(item.wizard_assigned_at),
      critical: (item.wizard_attention_level || item.attention_level) === 'critical',
      waitingOn: item.wizard_waiting_on === 'helper' ? 'helper' : '',
      helperStatus: item.wizard_helper_status && typeof item.wizard_helper_status === 'object' ? item.wizard_helper_status : null,
      background: ['helper', 'heavy'].includes(item.wizard_background) ? item.wizard_background : '',
      // A saved background result waiting for one-tap Continue (Agent Service background-results.mjs), shown by
      // chat-power.js (on for everyone since wizard-agent-service #14).
      // The Service adds its plain reason (wizard-agent-service issue 469).
      backgroundResult: /^bg_[0-9a-f]{32}$/.test(item.wizard_background_result?.id || '') && item.wizard_background_result?.session_id === id
        ? { id: item.wizard_background_result.id, ...(typeof item.wizard_background_result.reason === 'string' && item.wizard_background_result.reason ? { reason: item.wizard_background_result.reason.slice(0, 160) } : {}) } : null,
      // What the finished thread asks of James (the agent's hidden status line): needs_you / check / done / fyi.
      attention: attentionOf(item.wizard_attention),
      // A durable quiet one-shot checker bound to this thread. The prompt never reaches the list.
      followUp: followUpOf(item.wizard_follow_up),
      // Thread titles (Agent Service thread-titles.mjs): every rename with its time, so the thread shows
      // "Renamed from …" right after the reply that renamed it. The list shows only the current title.
      renames: Array.isArray(item.wizard_title_renames) ? item.wizard_title_renames.filter(r => r && typeof r.from === 'string' && isFinite(r.at)).slice(-6).map(r => ({ from: r.from.slice(0, 120), to: String(r.to || '').slice(0, 120), at: Number(r.at), by: r.by === 'you' ? 'you' : 'agent' })) : [],
      // The thread's model route (chat-models.js shows and changes it).
      model: typeof item.model === 'string' ? item.model : '', provider: typeof item.provider === 'string' ? item.provider : '',
      modelLockAt: Number(item.wizard_model_lock_updated_at) || 0,
      // The last thing asked (Retry on a failed thread sends it again: controller.ts retryServerFailedSession).
      retryRunId: typeof item.wizard_retry_run_id === 'string' ? item.wizard_retry_run_id : '',
      request: typeof item.wizard_retry_input === 'string' ? item.wizard_retry_input : userText,
      // Agents MVP: the agent this thread is pinned to (server metadata). '' = the main agent.
      agent: typeof item.agent === 'string' ? item.agent : item.agent && typeof item.agent === 'object' && typeof item.agent.id === 'string' ? item.agent.id : '',
      ...(typeof item.channel === 'string' && /^[a-z0-9-]{1,48}$/.test(item.channel) ? { channel: item.channel } : {}),
      ...(typeof item.firstRequest === 'string' ? { firstRequest: item.firstRequest.slice(0, 400) } : {}),
      // wizard-ux issue 1808: the newest answer was to the owner's reply that asked for none (live.js quietReply).
      ...(item.wizard_quiet_reply === true || item.quietReply === true ? { quietReply: true } : {}),
    };
  }

  /* ---- thread-seen: exact port of wizard-mobile semantics ---- */
  const vis = v => (typeof v === 'string' ? v : '').replace(/\s+/gu, ' ').trim().slice(0, 80).toLocaleLowerCase();
  function fingerprint(v) { let h = 2166136261; for (const c of vis(v)) { h ^= c.codePointAt(0) ?? 0; h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  const keyOf = s => `${s.runtime}:${s.id}`;
  // Side state (seen, snoozed) for another agent's thread is keyed agent/<id>/<runtime>:<id> on the server; the
  // dispositions route takes agent_id in the body and refuses any query string (so agent snoozes used to fail).
  const seenKeyOf = s => s.agent && s.agent !== 'hermes' ? `agent/${s.agent}/${keyOf(s)}` : keyOf(s);
  // The newest assistant message the list knows. lastAssistantAt counts model replies only; reports that apps and
  // scheduled jobs append (Topics roundup, daily moves, audits) arrive as the latest message (previewAt) without moving
  // it, so those threads came in already read (James, 23 Oct 2026). Take whichever is newer.
  function assistantAt(s) {
    const c = [s.lastAssistantAt, s.previewRole === 'assistant' ? s.previewAt : undefined].filter(v => isFinite(Date.parse(v ?? '')));
    return c.length > 1 && Date.parse(c[1]) > Date.parse(c[0]) ? c[1] : c[0];
  }
  function recordFor(s, seenAt) {
    const a = assistantAt(s);
    return { ...(typeof s.messageCount === 'number' ? { messageCount: s.messageCount } : {}), ...(s.status && s.status !== 'submitting' ? { status: s.status } : {}),
      updatedAt: s.updatedAt, previewFingerprint: s.agent && otherAgent(s.agent) ? 'private' : fingerprint(s.preview), ...(a ? { assistantActivityAt: a } : {}), seenAt };
  }
  function hasNew(s, state) {
    if (!state) return false;
    const r = state.threads[seenKeyOf(s)]; if (!r) return true;
    if ((r.unreadAt ?? -1) > r.seenAt) return true;
    const cur = Date.parse(assistantAt(s) ?? ''), seenA = Date.parse(r.assistantActivityAt ?? '');
    const comparable = typeof s.messageCount === 'number' && typeof r.messageCount === 'number';
    // A row read from a thread's detail alone (a hidden thread opened by link) has no preview: no evidence of a change,
    // and treating it as one kept it unread however often it was marked (a thread-seen write storm, agent-service 631).
    const previewChanged = !otherAgent(s.agent) && !comparable && !!vis(s.preview) && fingerprint(s.preview) !== r.previewFingerprint;
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
    const unreadAt = Math.max(l.unreadAt ?? -1, r.unreadAt ?? -1);
    const la = Date.parse(l.assistantActivityAt ?? ''), ra = Date.parse(r.assistantActivityAt ?? '');
    const aa = !isFinite(la) ? r.assistantActivityAt : !isFinite(ra) ? l.assistantActivityAt : ra > la ? r.assistantActivityAt : l.assistantActivityAt;
    // Mark done (wizard-ux issue 1317): the newer "handled through" of the two is kept, whichever record wins.
    const lh = Date.parse(l.handledThrough ?? ''), rh = Date.parse(r.handledThrough ?? '');
    const ht = !isFinite(lh) ? (isFinite(rh) ? r.handledThrough : '') : !isFinite(rh) ? l.handledThrough : rh > lh ? r.handledThrough : l.handledThrough;
    return { ...pick, ...(aa ? { assistantActivityAt: aa } : {}), ...(ht ? { handledThrough: ht } : {}), seenAt, ...(unreadAt >= 0 ? { unreadAt } : {}) };
  }
  /* Marking a row read never forgets a newer revision this device already knows was read (wizard-ux issue 1266):
   * the Channels feed can mark a row from a list read older than the record (a stale refresh, another device's
   * write). The record keeps the newer of the two revisions, read as of now; replies newer than both stay unread. */
  function seenRecord(prior, s, seenAt) {
    const fresh = recordFor(s, seenAt); if (!prior) return fresh;
    const { unreadAt, ...kept } = later(prior, fresh);
    return { ...kept, seenAt: Math.max(seenAt, prior.seenAt || 0) };
  }
  /* Mark done (wizard-ux issue 1317): the revision a thread was handled through is its own newest reply time (else
   * updatedAt), a server time, so device clocks never matter. A later reply moves past it and the markers come back. */
  const handledRev = s => assistantAt(s) || s.updatedAt || '';
  function handledOf(s, state) {
    const r = state?.threads?.[seenKeyOf(s)], h = Date.parse(r?.handledThrough ?? ''), cur = Date.parse(handledRev(s));
    return isFinite(h) && isFinite(cur) && cur <= h;
  }
  function merge(a, b) {
    if (!a) return b; if (!b) return a;
    const threads = { ...a.threads };
    for (const [k, r] of Object.entries(b.threads)) threads[k] = later(threads[k], r);
    // Same order as the box keeps its 500 (Agent Service thread-seen.mjs: the later of seenAt and unreadAt, then key), so
    // both sides drop the same record at the cap. Ordering by seenAt alone kept a record here that the box had dropped,
    // and the re-send below then never caught up (wizard-ux issue 1428).
    const at = r => Math.max(r.seenAt, r.unreadAt ?? -1);
    const entries = Object.entries(threads).sort((x, y) => at(y[1]) - at(x[1]) || x[0].localeCompare(y[0])).slice(0, MAX);
    return { initializedAt: Math.min(a.initializedAt, b.initializedAt), threads: Object.fromEntries(entries) };
  }
  /* Re-sending reads the box does not have yet (after a reconnect or reload; a failed write must not strand a read).
   * wizard-ux issue 1428: a record the box never keeps (past its cap, a private thread it withholds) made every list
   * read PUT the whole 138 KB state again and repaint, about 6 times a second on a phone, and Chats never loaded.
   * Now each record version is re-sent once, one write at a time; a failed write lets it try again on a later read.
   * A reply that changes nothing here does not repaint. */
  const SEEN_SENT = new Map(); // seen key -> the seenAt already re-sent
  let seenSending = false;
  function sameRecord(a, b) {
    if (a === b) return true; if (!a || !b) return false;
    const ka = Object.keys(a); return ka.length === Object.keys(b).length && ka.every(k => a[k] === b[k]);
  }
  function sameSeen(a, b) {
    if (a === b) return true; if (!a || !b || a.initializedAt !== b.initializedAt) return false;
    const ka = Object.keys(a.threads); return ka.length === Object.keys(b.threads).length && ka.every(k => sameRecord(a.threads[k], b.threads[k]));
  }
  function seenBehind(state, remote) {
    return Object.entries(state?.threads || {}).filter(([k, r]) => r.seenAt > (remote?.threads?.[k]?.seenAt || 0) && SEEN_SENT.get(k) !== r.seenAt);
  }
  function resendSeen(store, state, remote) {
    if (seenSending) return null;
    const behind = seenBehind(state, remote); if (!behind.length) return null;
    for (const [k, r] of behind) SEEN_SENT.set(k, r.seenAt);
    if (SEEN_SENT.size > MAX * 4) for (const k of [...SEEN_SENT.keys()]) if (!state.threads[k]) SEEN_SENT.delete(k);
    seenSending = true;
    return putSeen(state).then(r => {
      const next = merge(store.seen, r); if (sameSeen(next, store.seen)) return;
      store.seen = next; writeLocal(next); store.emit();
    }, () => { for (const [k, r] of behind) if (SEEN_SENT.get(k) === r.seenAt) SEEN_SENT.delete(k); }).finally(() => { seenSending = false; });
  }
  function readLocal() {
    try {
      const raw = localStorage.getItem(SEEN_KEY) ?? localStorage.getItem(SEEN_BASE); if (!raw) return null;
      const v = JSON.parse(raw); return isFinite(v.initializedAt) && v.threads && typeof v.threads === 'object' ? v : null;
    } catch (e) { return null; }
  }
  function writeLocal(state) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(state)); } catch (e) {} }

  return { assistantAt, fingerprint, handledOf, handledRev, hasNew, iso, keyOf, later, MAX, merge, normalize, readLocal, recordFor, resendSeen, SCOPE, SEEN_BASE, SEEN_KEY, seenKeyOf, seenRecord, WEEK, WORKING, writeLocal, bindLate: v => { if ('otherAgent' in v) otherAgent = v.otherAgent; if ('putSeen' in v) putSeen = v.putSeen; } };
};
