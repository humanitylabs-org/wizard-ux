/* Wizard UX core: the Errors section's ways out (#12) and the failed-thread recovery (#11). Shared by every shell.
 *
 * Legacy endpoints (wizard-mobile ff86db8c api.ts / controller.ts):
 *   GET  /wizard/attention                         → { attention: [{ id, kind, thread_id, session_id, title, detail, failed_at, can_retry }] }
 *   POST /wizard/attention/:id/retry               → recovery of a failed background activity (only when can_retry)
 *   POST /wizard/attention/:id/dismiss             → remove it from the Errors list
 *   POST /wizard/session-failure/:id/dismiss       → clear a failed/interrupted thread's “Needs retry” (history kept)
 * Retrying a failed thread re-sends its last request through the durable outbox (retryServerFailedSession):
 * same thread, same model unless another one was picked.
 *
 *   WosErrors.load(force)     → Promise<items[]>  (cached 30 s)
 *   WosErrors.items           → attention items still shown
 *   WosErrors.retryAttention(id) / dismissAttention(id) → Promise<boolean>
 *   WosErrors.dismissFailure(sessionId, row?)           → true: the card is gone at once (issue 1488); the save to
 *                                                         Wizard goes on quietly in the background, retried, never a toast
 *   WosErrors.dismissed(row | sessionId)                → true while that failure stays dismissed on this device
 * A dismissal is kept per agent + thread in localStorage (wos.failure-dismissals.v1) until a newer request or run, so a
 * reload or a slow/refused save never brings the card back. Routed agents' threads post { agent_id } (Agent Service
 * keeps each agent's own fence).
 */
(() => {
  'use strict';
  const J = { 'Content-Type': 'application/json' };
  const post = async (path, body = {}) => {
    const r = await fetch(path, { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: J, body: JSON.stringify(body) });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    return true;
  };
  function normalize(j) {
    return (Array.isArray(j?.attention) ? j.attention : []).map(v => {
      if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !v.id) return null;
      const t = typeof v.failed_at === 'number' ? v.failed_at * 1000 : Date.parse(String(v.failed_at ?? ''));
      return { id: v.id, kind: String(v.kind || 'failed_activity'), sessionId: typeof v.session_id === 'string' ? v.session_id : '', threadId: typeof v.thread_id === 'string' ? v.thread_id : '',
        title: String(v.title || 'Wizard work needs attention'), detail: String(v.detail || ''), failedAt: isFinite(t) ? t : NaN, canRetry: v.can_retry === true };
    }).filter(Boolean);
  }
  // Failed-thread dismissals (issue 1488): applied on this device at once, saved to Wizard in the background.
  const DKEY = 'wos.failure-dismissals.v1', KEEP_MS = 30 * 864e5, MAX_RECS = 200, RETRY_S = [2, 5, 15, 30, 60, 120, 300];
  const agentOfRow = (s, sid) => {
    // A row knows its own agent (a routed thread may share its id with a main one); an id alone asks the live store.
    if (!s || typeof s !== 'object' || !('agent' in s)) return window.WizLive?.agentOf?.(sid) || '';
    const a = typeof s.agent === 'string' ? s.agent : s.agent?.id || '';
    return a && window.WosAgents?.isOther?.(a) ? a : '';
  };
  const recKey = (agent, sid) => `${agent || ''}|${sid}`;
  let recCache = null, recRaw = null;
  function readRecs() {
    let raw = null; try { raw = localStorage.getItem(DKEY); } catch (_) {}
    if (recCache && raw === recRaw) return recCache;
    let v = {}; try { v = JSON.parse(raw || '{}') || {}; } catch (_) { v = {}; }
    if (typeof v !== 'object' || Array.isArray(v)) v = {};
    recCache = v; recRaw = raw; return v;
  }
  function writeRecs(recs) {
    const now = Date.now(), keep = Object.entries(recs).filter(([, r]) => r && now - (r.at || 0) < KEEP_MS).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_RECS);
    recCache = Object.fromEntries(keep);
    try { recRaw = JSON.stringify(recCache); localStorage.setItem(DKEY, recRaw); } catch (_) { recRaw = null; }
  }
  // A newer owner request or a new run is a new failure: the card may show again.
  function newerThan(s, rec) {
    const t = Date.parse(s.lastUserAt || ''), was = Date.parse(rec.userAt || '');
    if (isFinite(t) && isFinite(was) && t > was) return true;
    if (isFinite(t) && !isFinite(was) && t > rec.at) return true;
    return !!(rec.runId && s.runId && s.runId !== rec.runId);
  }
  const timers = new Map();
  async function sendDismissal(key) {
    clearTimeout(timers.get(key)); timers.delete(key);
    const rec = readRecs()[key]; if (!rec || rec.sent) return;
    let ok = false;
    try { await post(`/wizard/session-failure/${encodeURIComponent(rec.sid)}/dismiss`, rec.agent ? { agent_id: rec.agent } : {}); ok = true; } catch (_) {}
    const recs = readRecs(), cur = recs[key]; if (!cur || cur.at !== rec.at) return;
    if (ok) { cur.sent = true; writeRecs(recs); return; }
    cur.tries = (cur.tries || 0) + 1; writeRecs(recs);
    // Quiet: no toast. Tries again with a growing pause; after the last one, on the next load or when back online.
    if (cur.tries < RETRY_S.length) timers.set(key, setTimeout(() => sendDismissal(key), RETRY_S[cur.tries] * 1000));
  }
  const resendAll = () => { for (const [key, r] of Object.entries(readRecs())) if (r && !r.sent && !timers.has(key)) sendDismissal(key); };
  const E = {
    items: [], ready: false, at: 0, loading: null, busy: new Map(), gone: new Set(), listeners: new Set(),
    onChange(fn) { E.listeners.add(fn); return () => E.listeners.delete(fn); },
    emit() { for (const fn of E.listeners) { try { fn(); } catch (e) { console.error(e); } } },
    load(force) {
      if (E.loading) return E.loading;
      if (!force && E.ready && Date.now() - E.at < 30e3) return Promise.resolve(E.items);
      E.loading = fetch('/wizard/attention', { cache: 'no-store', credentials: 'same-origin' })
        .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
        .then(j => { const prev = JSON.stringify(E.items); E.items = normalize(j).filter(x => !E.gone.has(x.id)); E.ready = true; E.at = Date.now(); if (JSON.stringify(E.items) !== prev) E.emit(); return E.items; })
        .catch(() => E.items)
        .finally(() => { E.loading = null; });
      return E.loading;
    },
    normalize,
    async _attention(id, action) {
      const it = E.items.find(x => x.id === id); if (!it || E.busy.has(id)) return false;
      if (action === 'retry' && !it.canRetry) return false;
      E.busy.set(id, action); E.emit();
      try { await post(`/wizard/attention/${encodeURIComponent(id)}/${action}`); E.gone.add(id); E.items = E.items.filter(x => x.id !== id); return true; }
      catch (e) { return false; }
      finally { E.busy.delete(id); E.emit(); }
    },
    retryAttention(id) { return E._attention(id, 'retry'); },
    dismissAttention(id) { return E._attention(id, 'dismiss'); },
    dismissFailure(sid, row) {
      if (!sid || typeof sid !== 'string') return false;
      const s = row && row.id === sid ? row : window.WizLive?.session?.(sid), agent = agentOfRow(s, sid), recs = readRecs();
      recs[recKey(agent, sid)] = { agent, sid, at: Date.now(), userAt: s?.lastUserAt || '', runId: s?.runId || '', sent: false, tries: 0 };
      writeRecs(recs); E.emit();
      sendDismissal(recKey(agent, sid));
      return true;
    },
    dismissed(x) {
      const s = x && typeof x === 'object' ? x : null, sid = s ? s.id : x;
      if (!sid) return false;
      const recs = readRecs(), key = recKey(agentOfRow(s || window.WizLive?.session?.(sid), sid), sid), rec = recs[key];
      if (!rec) return false;
      if (s && newerThan(s, rec)) { delete recs[key]; writeRecs(recs); return false; }
      return true;
    },
  };
  window.WosErrors = E;
  setTimeout(resendAll, 1500);
  window.addEventListener?.('online', resendAll);
})();
