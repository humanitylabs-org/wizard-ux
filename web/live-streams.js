/* Wizard UX live data › open-thread delta streams (L.openRunStream), following the outbox once it loads, and Stop on a thread
 * whose send is still pending (withdrawing queued sends, stop marks). Moved verbatim out of live.js (wizard-ux issue 1665: split the giant front-end
 * files, no behaviour change). live.js calls this once, where the code used to be, with the closure names it reads,
 * and keeps the names it returns under their old names. Loaded just before live.js everywhere that loads it. The
 * body below keeps live.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.liveParts = window.WizCore.liveParts || {};
window.WizCore.liveParts.streams = function ({ AG, iso, L, otherAgent, PEND, PEND_MAX, RELEASED, req, syncPending, unPend }) {
  /* Open-thread delta subscriptions. Read-only: a failed stream never replays a send.
   * Hermes uses unnamed SSE data frames with data.event; other runtimes name events. */
  const RUN_STREAMS = new Map();
  L.openRunStream = function (sid, agent, runId, paint, target = null) {
    // Explicit ephemeral target: reuse SSE/progress/Stop, never ordinary catalogs/outbox.
    const base = target?.base;
    if (target && !/^\/wizard\/v1\/agents\/[a-z0-9][a-z0-9-]{0,40}\/incognito\/incog_[a-f0-9]{32}$/.test(base || '')) return null;
    const read = target?.read || req;
    const registry = window.WosAgents;
    const rec = registry?.get(agent || registry.defaultId());
    if ((!target && ((agent && !rec) || rec?.privacy === 'private')) || !window.EventSource || !runId) return null;
    const key = JSON.stringify([agent, sid, runId, base]);
    let r = RUN_STREAMS.get(key);
    if (!r) {
      r = { text: '', steps: [], live: false, terminal: false, listeners: new Set(), frame: null, stopped: false };
      RUN_STREAMS.set(key, r);
      const url = base ? `${base}/v1/runs/${encodeURIComponent(runId)}` : `/wizard/hermes/v1/runs/${encodeURIComponent(runId)}${agent ? '?agent=' + encodeURIComponent(agent) : ''}`;
      const notify = () => {
        if (r.frame != null || r.stopped) return;
        r.frame = requestAnimationFrame(() => { r.frame = null; for (const fn of r.listeners) fn(r); });
      };
      const close = () => { r.source?.close(); r.source = null; };
      const terminal = async status => { if (r.terminal) return; r.terminal = true; r.status = status; close();
        // One final read releases the ephemeral service busy latch and recovers non-delta output.
        if (target) { try { r.result = await (await read(url)).json(); r.status = r.result.status || status; } catch (_) { r.status = 'failed'; } }
        notify();
      };
      // Resume across drops (spotty wifi, a phone waking up): Hermes and the Agent Service number every frame (SSE id
      // and data.seq) and replay the run on each new read, so a reconnect skips every frame this stream already showed.
      // Unnumbered streams keep the old rule: reconnect only before any answer bytes, never duplicate text.
      let retries = 0, lastSeq = -1, numbered = false;
      const BACKOFF = [500, 1000, 2000, 4000, 8000, 15000, 30000], MAX_RETRIES = 20, STALL_MS = 90000;
      const event = e => {
        if (r.stopped || r.terminal) return;
        let d; try { d = JSON.parse(e.data); } catch (_) { return; }
        if ((d.session_id && d.session_id !== sid) || (d.run_id && d.run_id !== runId)) return;
        const type = d.event || e.type;
        r.seenAt = Date.now();
        // The replay lost frames this stream never showed: the text would have a hole, so drop it and let the
        // transcript read bring the answer (still reading steps and the end of the run).
        if (type === 'replay.truncated') {
          if (lastSeq >= 0 && Number(d.oldest_retained_seq) > lastSeq + 1 && !r.gap) { r.gap = true; r.text = ''; notify(); }
          return;
        }
        const seq = Number.isInteger(d.seq) ? d.seq : /^\d+$/.test(e.lastEventId || '') ? Number(e.lastEventId) : null;
        if (seq != null) { if (seq <= lastSeq) return; lastSeq = seq; numbered = true; retries = 0; }
        if (type === 'message.delta' && typeof d.delta === 'string') { if (!r.gap) { r.text += d.delta; notify(); } }
        // Live steps, like the CLI: the tool that is running and the ones just finished.
        if (type === 'tool.started' && d.tool) { const id = d.tool_call_id || d.step_id || d.id; r.steps = [...r.steps, { ...(typeof id === 'string' && id ? { id } : {}), tool: String(d.tool), preview: typeof d.preview === 'string' ? d.preview : '', done: false }].slice(-4); notify(); }
        if (type === 'tool.completed' && d.tool) {
          const id = d.tool_call_id || d.step_id || d.id;
          const i = r.steps.findLastIndex(s => !s.done && (typeof id === 'string' && id ? s.id === id : s.tool === String(d.tool)));
          if (i >= 0) { r.steps = r.steps.map((s, n) => n === i ? { ...s, done: true, error: !!d.error } : s); notify(); }
          // An open app window named by this tool reads its data again (WizAppServices fresh data, issue 1243).
          try { window.dispatchEvent(new CustomEvent('wizard:agent-tool', { detail: { tool: String(d.tool) } })); } catch (_) {}
        }
        // reasoning.available is deliberately not answer text.
        if (['run.completed', 'run.failed', 'run.cancelled', 'run.interrupted'].includes(type)) void terminal(type.slice(4));
      };
      const canResume = () => !r.stopped && !r.terminal && (numbered || !r.text);
      const connect = () => {
        clearTimeout(r.reconnect); r.reconnect = null;
        if (r.stopped || r.terminal || r.source) return;
        if (!numbered) r.steps = []; // an unnumbered reconnect replays the run from its first event
        try {
          r.seenAt = Date.now(); // a new read gets the full stall window to open, however slow the link
          r.source = new window.EventSource(base ? `${url}/events` : `/wizard/hermes/v1/runs/${encodeURIComponent(runId)}/events${agent ? '?agent=' + encodeURIComponent(agent) : ''}`);
          r.source.onmessage = event;
          for (const name of ['message.delta', 'tool.started', 'tool.completed', 'run.completed', 'run.failed', 'run.cancelled', 'run.interrupted', 'replay.truncated']) r.source.addEventListener(name, event);
          r.source.onopen = () => { r.live = true; r.seenAt = Date.now(); };
          r.source.onerror = () => {
            r.live = false;
            close();
            // Another read of the same run, never another admission/send. Offline waits for the network to return.
            if (!canResume() || retries >= MAX_RETRIES) return;
            if (window.navigator?.onLine === false) { r.waitingOnline = true; return; }
            r.reconnect = setTimeout(connect, BACKOFF[Math.min(retries++, BACKOFF.length - 1)]);
          };
        } catch (_) { close(); }
      };
      // Back online or back in front: read again now instead of waiting out the backoff (a few more tries at most).
      const resumeNow = () => {
        if (window.document?.hidden || window.navigator?.onLine === false || r.source || !canResume()) return;
        r.waitingOnline = false; retries = Math.min(retries, MAX_RETRIES - 3); connect();
      };
      window.addEventListener?.('online', resumeNow);
      window.document?.addEventListener('visibilitychange', resumeNow);
      connect();
      const poll = async () => {
        if (r.stopped || r.terminal) return;
        try {
          const d = await (await read(url)).json();
          if (r.stopped) return;
          if ((d.run_id || d.id) === runId && d.session_id === sid && ['completed', 'failed', 'cancelled', 'interrupted'].includes(d.status)) void terminal(d.status);
          // Wizard answers but the stream has been silent past several keepalives: a half-open connection (plane wifi).
          else if (r.source && r.live && numbered && Date.now() - (r.seenAt || 0) > STALL_MS) { r.live = false; close(); connect(); }
          // Some systems never fire 'online': a status read that worked is proof enough.
          else if (!r.source && r.waitingOnline) resumeNow();
        } catch (_) { /* connectivity recovery is the ordinary read poll, never another send */ }
        // The status read is only the safety net while the live stream is open.
        if (!r.stopped && !r.terminal) r.timer = setTimeout(poll, r.live ? 10000 : 1500);
      };
      r.dispose = () => {
        r.stopped = true; close(); clearTimeout(r.timer); clearTimeout(r.reconnect); if (r.frame != null) cancelAnimationFrame(r.frame);
        window.removeEventListener?.('online', resumeNow); window.document?.removeEventListener('visibilitychange', resumeNow); RUN_STREAMS.delete(key);
      };
      r.timer = setTimeout(poll, 500);
    }
    r.listeners.add(paint);
    return { snapshot: r, close() { r.listeners.delete(paint); if (!r.listeners.size) r.dispose(); } };
  };
  L.pendingRun = sid => PEND.get(sid)?.runId || (window.WosOutbox?.forThread(sid) || [])
    .filter(it => it.state === 'sent' && it.runId && Date.now() - (it.sentAt || it.createdAt) < PEND_MAX)
    .sort((a, b) => b.createdAt - a.createdAt)[0]?.runId || '';

  function attachOutbox() {
    const OB = window.WosOutbox; if (!OB || L._outbox) return; L._outbox = true;
    const sync = () => { if (syncPending(OB)) L.emit(); };
    OB.onChange(sync); OB.load().then(sync).catch(() => {});
    // Separate-agent sessions are raw gateway rows, not the main agent's run
    // queue. Follow the accepted receipt, rather than waiting 15 s for that list.
    const watches = new Map();
    const follow = it => {
      if (!otherAgent(it.agent) || !it.runId || it.steered || !['new','reply'].includes(it.kind)) return;
      const sid = it.sessionId, runId = it.runId;
      if (watches.get(sid) === runId) return;
      watches.set(sid, runId); L.pinAgent(sid, it.agent);
      const tick = async () => {
        if (watches.get(sid) !== runId) return;
        try {
          if (!document.hidden) {
            const run = await (await req(`/wizard/hermes/v1/runs/${encodeURIComponent(runId)}?agent=${encodeURIComponent(it.agent)}`)).json();
            if (watches.get(sid) !== runId) return;
            if ((run.run_id || run.id) === runId && run.session_id === sid && ['completed','failed','cancelled','interrupted','expired'].includes(run.status)) {
              await L.refreshAgents(L.deferred, it.agent);
              if (watches.get(sid) !== runId) return;
              // Older services list raw profile sessions without run keys/status.
              // The exact terminal receipt still settles this send, never a newer one.
              const pending = PEND.get(sid);
              if (!pending || (pending.runId === runId && pending.key === it.id)) {
                if (pending) { RELEASED.add(pending.key); PEND.delete(sid); }
                const s = L.session(sid);
                if (s && (!s.runId || s.runId === runId || s.pend)) {
                  unPend(s); Object.assign(s, { status: run.status, lastRunStatus: run.status, lastRunKey: it.id, runId: '' });
                  if (run.updated_at) s.lastAssistantAt = iso(run.updated_at);
                }
              }
              L.emit(); if (watches.get(sid) === runId) watches.delete(sid); return;
            }
          }
        } catch (_) { /* uncertain reads keep following the same receipt, never resend */ }
        setTimeout(tick, document.hidden ? 3000 : 500);
      };
      tick();
    };
    // The receipt already carries the run id (PEND → s.runId, so Stop works at once); read Wizard's list soon after
    // admission too, instead of waiting for the 15 s poll, so the thread's own status follows the real run.
    const readSoon = it => { if (!it.steered && !otherAgent(it.agent) && ['new', 'reply'].includes(it.kind)) setTimeout(() => { if (!document.hidden) L.refresh(); }, 800); };
    OB.onSent(it => { follow(it); readSoon(it); });
    OB.load().then(() => { for (const it of OB._items.values()) if (it.state === 'sent' && Date.now() - it.sentAt < PEND_MAX) follow(it); }).catch(() => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attachOutbox); else setTimeout(attachOutbox, 0);
  // A new or changed agent: read its threads now (not at the next poll), then repaint.
  const attachAgents = () => { const A = AG(); if (!A || L._agents) return; L._agents = true; A.onChange(() => { if (L.ok) L.refreshAgents().then(() => L.emit()); else L.emit(); }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attachAgents); else setTimeout(attachAgents, 0);
  L.pending = id => PEND.get(id) || null;
  /* Stop on a thread with a pending send (Miguel, 28 Oct 2026: the Stop button came only after upload, transcription
   * and the next list read). Everything sent to the thread and not yet admitted is withdrawn from the outbox (also a
   * reply queued to steer the live run, so a rejected steer never turns into a new turn); the live run and any run
   * whose POST had already left (its receipt's id) are stopped. An orb take still being transcribed on the phone (only
   * the send tap's hold so far) is withdrawn whenever it reaches the outbox: a stop mark outlasts phone transcription.
   * Resolves { outcome: 'stopped' | 'cancelled' | 'none' | 'busy', runIds, items }. */
  const STOPPABLE = ['preparing', 'processing', 'queued', 'waiting', 'sending'];
  const STOP_MARKS = new Map(); // sessionId -> { at, until }: takes begun before this Stop are withdrawn on arrival
  const STOP_MARK_MS = 5 * 60e3; // the outbox allows 195 s of transcription; phone-side routing comes on top
  const pendingFor = (OB, sid, before = Infinity) => OB ? [...OB._items.values()].filter(it => it.sessionId === sid && ['new', 'reply'].includes(it.kind) &&
    !it.compact && !it.cancelled && STOPPABLE.includes(it.state) && (it.createdAt || 0) <= before) : [];
  async function withdrawSends(OB, list) {
    const res = await Promise.all(list.map(it => OB.cancel(it.id)));
    const items = res.filter(r => r?.outcome === 'cancelled').map(r => r.item);
    for (const it of items) RELEASED.add(it.id);
    return { items, started: res.filter(r => r?.outcome === 'started' && r.runId).map(r => r.runId) };
  }
  function applyStopMarks(OB) {
    for (const [sid, m] of STOP_MARKS) {
      if (Date.now() > m.until) { STOP_MARKS.delete(sid); continue; }
      const late = pendingFor(OB, sid, m.at);
      if (late.length) withdrawSends(OB, late).then(r => { for (const id of r.started) L.stop(id).catch(() => {}); L.emit(); }).catch(() => {});
    }
  }
  return { applyStopMarks, pendingFor, STOP_MARK_MS, STOP_MARKS, withdrawSends };
};
