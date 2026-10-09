/* Wizard OS outbox: nothing James says or types is lost.
 *
 * Every message is written to IndexedDB (voice audio included) BEFORE anything goes over the
 * network, then delivered with ids fixed at enqueue time:
 *   - a new chat's session id is chosen once, so a retry re-creates nothing (409 = already there);
 *   - the run is admitted with Idempotency-Key = the item id and a byte-identical body, so Wizard's
 *     run queue replays the first admission instead of starting a second run.
 * A failed attempt keeps the item and retries with backoff (2 s → 2 min); after the automatic tries
 * it waits as "Not sent · Retry". Coming back online or to the foreground retries everything.
 * The item is only dropped once Wizard has accepted it.
 *
 * Same contract as legacy Wizard Mobile's durable envelopes and Archimedes Anywhere's Saved Requests.
 */
(() => {
  'use strict';
  const DB = 'wos-outbox', STORE = 'items';
  const BACKOFF = [2000, 5000, 15000, 30000, 60000, 120000];
  const AUTO_TRIES = BACKOFF.length; // then it waits for James (or for the network to come back)
  const J = { 'Content-Type': 'application/json' };
  const listeners = new Set();
  let items = new Map(), db = null, ready = null, pumping = false, timer = 0;
  const now = () => Date.now();
  const emit = () => { for (const fn of listeners) { try { fn(api); } catch (e) { console.error(e); } } };

  /* ---- storage (IndexedDB; falls back to memory+localStorage text if IDB is unavailable) ---- */
  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  function tx(mode, fn) {
    if (!db) return Promise.resolve();
    return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const out = fn(t.objectStore(STORE)); t.oncomplete = () => res(out?.result); t.onerror = () => rej(t.error); });
  }
  const LS = 'wos.outbox.fallback';
  function lsSave() { if (db) return; try { localStorage.setItem(LS, JSON.stringify([...items.values()].map(({ audio, ...x }) => x))); } catch (e) {} }
  async function put(it) { items.set(it.id, it); lsSave(); try { await tx('readwrite', s => s.put(it)); } catch (e) { console.warn('outbox put', e); } emit(); }
  async function del(id) { items.delete(id); lsSave(); try { await tx('readwrite', s => s.delete(id)); } catch (e) {} emit(); }
  function load() {
    if (ready) return ready;
    ready = (async () => {
      try {
        db = await open();
        const all = await tx('readonly', s => s.getAll()) || [];
        for (const it of all) { if (it.state === 'sending') it.state = 'waiting'; items.set(it.id, it); }
      } catch (e) {
        db = null;
        try { for (const it of JSON.parse(localStorage.getItem(LS) || '[]')) items.set(it.id, it); } catch (x) {}
      }
      emit(); schedule(0);
    })();
    return ready;
  }

  /* ---- network ---- */
  class HttpError extends Error { constructor(status, msg) { super(msg || 'HTTP ' + status); this.status = status; } }
  async function call(path, init = {}) {
    let r;
    try { r = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...init }); }
    catch (e) { throw new HttpError(0, 'Couldn’t reach Wizard'); }
    if (!r.ok) { let m = ''; try { m = (await r.json()).error || ''; } catch (e) {} throw new HttpError(r.status, typeof m === 'string' ? m : (m.message || '')); }
    return r;
  }
  // Network trouble, gateway restarts, overload: try again. Anything else needs a human.
  const transient = e => !e.status || e.status === 408 || e.status === 425 || e.status === 429 || e.status >= 500;
  function reason(e) {
    if (!e.status) return 'Couldn’t reach Wizard';
    if (e.status === 403) return 'Wizard sign-in needed';
    if (e.status === 413) return 'Too large for Wizard';
    if (e.status >= 500) return `Wizard was unavailable (${e.status})`;
    return e.message || `Wizard refused it (${e.status})`;
  }

  async function transcribe(it) {
    const fd = new FormData();
    const ext = /mp4|m4a/.test(it.audioType || '') ? 'm4a' : /ogg/.test(it.audioType || '') ? 'ogg' : 'webm';
    fd.append('file', it.audio, `voice.${ext}`); fd.append('language', 'en');
    fd.append('prompt', 'Wizard OS voice request to Archimedes. Names: Archimedes, Wizard, Hermes, Miguel, Thales, Mizel.');
    const r = await call('/wizard-os-home/api/transcribe', { method: 'POST', body: fd });
    return String((await r.json()).text || '').trim();
  }
  async function uploadAudio(it) {
    const ext = /mp4|m4a/.test(it.audioType || '') ? 'm4a' : /ogg/.test(it.audioType || '') ? 'ogg' : 'webm';
    const name = `wizard-voice-${new Date(it.createdAt).toISOString().replace(/[:.]/g, '-')}.${ext}`;
    const r = await call('/wizard/files/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Wizard-Filename': name, 'X-Wizard-Mime': it.audioType || 'audio/webm' }, body: it.audio });
    const f = (await r.json()).file || {};
    if (!f.id) throw new HttpError(502, 'Wizard Files returned no id');
    return { id: String(f.id), name: String(f.filename || name), mime: String(f.mime || it.audioType || ''), bytes: Number(f.bytes) || it.audio.size };
  }

  async function deliver(it) {
    // 1. Words: a voice item that never got its transcript gets one now.
    if (!it.text && it.audio) {
      const text = await transcribe(it);
      if (!text) { it.state = 'empty'; it.error = 'No speech in that recording'; await put(it); return; }
      it.text = text; await put(it);
    }
    // 2. The recording rides along as a voice note, so the original audio is on the server too.
    if (it.audio && !it.audioFile) { it.audioFile = await uploadAudio(it); it.files = [...(it.files || []), it.audioFile]; await put(it); }
    const fileIds = (it.files || []).map(f => f.id).filter(Boolean).slice(0, 8);
    const input = it.text || `Please use the attached ${fileIds.length === 1 ? 'file' : 'files'}.`;
    // 3. Steer a live run: only on the very first try. Steers have no idempotency key, so a retry
    //    becomes a queued run (with one) instead of risking a doubled steer.
    if (it.kind === 'reply' && it.steerRunId && !it.attempts) {
      try {
        const steer = { input }; if (fileIds.length) steer.wizard_file_ids = fileIds;
        await call(`/wizard/hermes/v1/runs/${encodeURIComponent(it.steerRunId)}/steer`, { method: 'POST', headers: J, body: JSON.stringify(steer) });
        return done(it, { steered: true, runId: it.steerRunId });
      } catch (e) { if (![404, 409, 410].includes(e.status)) throw e; }
    }
    // 4. New chat: the session id was fixed at enqueue time; 409 means an earlier try created it.
    if (it.kind === 'new' && !it.sessionReady) {
      try { await call('/wizard/hermes/api/sessions', { method: 'POST', headers: J, body: JSON.stringify({ source: 'wizard-mobile', id: it.sessionId }) }); }
      catch (e) { if (e.status !== 409) throw e; }
      it.sessionReady = true; await put(it);
    }
    // 5. Admit the run. Same key + same bytes on every try → Wizard replays instead of duplicating.
    if (!it.body) {
      const body = { session_id: it.sessionId, input };
      if (it.instructions) body.instructions = String(it.instructions).slice(0, 2000);
      if (fileIds.length) body.wizard_file_ids = fileIds;
      it.body = JSON.stringify(body); await put(it);
    }
    const r = await call('/wizard/hermes/v1/runs', { method: 'POST', headers: { ...J, 'Idempotency-Key': it.id }, body: it.body });
    const run = await r.json().catch(() => ({}));
    return done(it, { steered: false, runId: run.run_id || run.id || '' });
  }
  async function done(it, res) {
    Object.assign(it, { state: 'sent', sentAt: now(), runId: res.runId, steered: res.steered, error: '' });
    delete it.audio; // the server has it now (voice note + transcript)
    await put(it);
    for (const fn of sentHooks) { try { fn(it, res); } catch (e) { console.error(e); } }
  }
  const sentHooks = new Set();

  async function attempt(it) {
    it.state = 'sending'; await put(it);
    try { await deliver(it); }
    catch (e) {
      it.attempts = (it.attempts || 0) + 1; it.error = reason(e); it.lastAttemptAt = now();
      if (transient(e) && it.attempts < AUTO_TRIES) { it.state = 'waiting'; it.nextAt = now() + BACKOFF[it.attempts - 1]; }
      else { it.state = 'failed'; it.nextAt = 0; }
      await put(it);
    }
  }
  async function pump() {
    if (pumping) return; pumping = true;
    try {
      await load();
      for (;;) {
        const due = [...items.values()].filter(it => (it.state === 'queued' || it.state === 'waiting') && (it.nextAt || 0) <= now()).sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!due) break;
        await attempt(due);
      }
      // Sent items stay a little while so the chat can swap the pending bubble for the real turn.
      for (const it of [...items.values()]) if ((it.state === 'sent' && now() - it.sentAt > 10 * 60e3) || (it.state === 'empty' && now() - it.createdAt > 60e3)) await del(it.id);
    } finally { pumping = false; schedule(); }
  }
  function schedule(ms) {
    clearTimeout(timer);
    if (ms == null) {
      const next = [...items.values()].filter(it => it.state === 'waiting').map(it => it.nextAt || 0);
      if (!next.length) return;
      ms = Math.max(0, Math.min(...next) - now());
    }
    timer = setTimeout(pump, ms);
  }
  const newSessionId = () => `wizard_${now()}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;

  const api = {
    /* kind 'new' (new thread) or 'reply' (existing thread). Persisted before this resolves. */
    async enqueue(o) {
      await load();
      const it = {
        id: 'wos-' + crypto.randomUUID(), createdAt: now(), attempts: 0, state: 'queued',
        kind: o.kind === 'reply' ? 'reply' : 'new', sessionId: o.sessionId || newSessionId(), steerRunId: o.steerRunId || '',
        text: String(o.text || '').trim(), instructions: o.instructions || '', files: o.files || [],
        audio: o.audio || null, audioType: o.audio ? (o.audio.type || 'audio/webm') : '',
        wid: o.wid || '', how: o.how || '', source: o.source || 'chat', title: String(o.text || '').slice(0, 60),
      };
      await put(it); pump();
      return it;
    },
    retry(id) { const it = items.get(id); if (!it || it.state === 'sent' || it.state === 'sending') return; Object.assign(it, { state: 'waiting', nextAt: 0, attempts: Math.min(it.attempts || 0, AUTO_TRIES - 1) }); put(it).then(pump); },
    retryAll() { for (const it of items.values()) if (it.state === 'failed' || it.state === 'waiting') Object.assign(it, { state: 'waiting', nextAt: 0, attempts: Math.min(it.attempts || 0, AUTO_TRIES - 1) }); Promise.all([...items.values()].map(put)).then(pump); },
    remove: del,
    /* Not yet accepted by Wizard (what the Unsent list shows). */
    unsent() { return [...items.values()].filter(it => it.state !== 'sent' && it.state !== 'empty').sort((a, b) => a.createdAt - b.createdAt); },
    /* What a chat window shows as pending bubbles: unsent, plus sent-but-not-yet-in-the-thread. */
    forThread(sessionId, wid) { return [...items.values()].filter(it => it.state !== 'empty' && (it.sessionId === sessionId || (wid && it.wid === wid && it.kind === 'new' && it.state !== 'sent'))).sort((a, b) => a.createdAt - b.createdAt); },
    get(id) { return items.get(id) || null; },
    landed(id) { const it = items.get(id); if (it && it.state === 'sent') del(id); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onSent(fn) { sentHooks.add(fn); return () => sentHooks.delete(fn); },
    pump, load,
    _items: items, AUTO_TRIES, BACKOFF,
  };
  addEventListener('online', () => api.retryAll());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { for (const it of items.values()) if (it.state === 'waiting') it.nextAt = 0; pump(); } });
  window.WosOutbox = api;
  load();
})();
