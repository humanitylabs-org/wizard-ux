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
  if (document.documentElement.dataset.leaving) return; // core/shell.js is switching to the other shell
  const DB = 'wos-outbox', STORE = 'items';
  const BACKOFF = [2000, 5000, 15000, 30000, 60000, 120000];
  const AUTO_TRIES = BACKOFF.length; // then it waits for the owner (or for the network to come back)
  const J = { 'Content-Type': 'application/json' };
  const listeners = new Set();
  let items = new Map(), db = null, ready = null, pumping = false, timer = 0;
  const now = () => Date.now();
  const emit = () => { for (const fn of listeners) { try { fn(api); } catch (e) { console.error(e); } } };

  /* ---- storage (IndexedDB; falls back to memory+localStorage text if IDB is unavailable) ---- */
  function open() {
    return new Promise((res, rej) => {
      let settled = false;
      const fail = e => { if (!settled) { settled = true; clearTimeout(deadline); rej(e || new Error('Recording storage unavailable')); } };
      const deadline = setTimeout(() => fail(new Error('Recording storage timed out')), 2000);
      let r;
      try { r = indexedDB.open(DB, 1); } catch (e) { fail(e); return; }
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onblocked = () => fail(new Error('Recording storage blocked by another window'));
      r.onsuccess = () => {
        if (settled) { r.result.close(); return; }
        settled = true; clearTimeout(deadline);
        r.result.onversionchange = () => { r.result.close(); db = null; };
        res(r.result);
      };
      r.onerror = () => fail(r.error);
    });
  }
  function tx(mode, fn) {
    if (!db) return Promise.reject(new Error('Recording storage unavailable'));
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const deadline = setTimeout(() => { try { t.abort(); } catch (e) {} rej(new Error('Recording storage timed out')); }, 3000);
      let out;
      t.oncomplete = () => { clearTimeout(deadline); res(out?.result); };
      t.onerror = t.onabort = () => { clearTimeout(deadline); rej(t.error || new Error('Recording storage transaction aborted')); };
      try { out = fn(t.objectStore(STORE)); } catch (e) { clearTimeout(deadline); try { t.abort(); } catch (_) {} rej(e); }
    });
  }
  const LS = 'wos.outbox.fallback';
  // Never write a fake recoverable voice item without its bytes to the text-only fallback.
  function lsSave() { if (db) return; try { localStorage.setItem(LS, JSON.stringify([...items.values()].filter(x => !x.audio))); } catch (e) {} }
  async function put(it) {
    items.set(it.id, it);
    try {
      const saved = { ...it, durable: true, storageError: '' };
      await tx('readwrite', s => s.put(saved));
      it.durable = true; it.storageError = '';
    } catch (e) {
      it.durable = false;
      if (it.audio) {
        it.storageError = 'Recording not saved on this device. Keep this window open; download audio before reloading.';
        if (it.kind !== 'dictation') { it.state = 'failed'; it.error = it.storageError; it.nextAt = 0; }
      }
      console.warn('outbox put', e);
    }
    lsSave(); emit(); return it.durable;
  }
  async function del(id) {
    const it = items.get(id);
    try { await tx('readwrite', s => s.delete(id)); }
    catch (e) {
      if (it?.durable) { it.error = 'Could not remove saved recording · retry discard'; emit(); return false; }
    }
    items.delete(id); lsSave(); emit(); return true;
  }
  // Unsent messages carried over from the retired legacy.wizard.example (core/carry-in.js): stored by id
  // (never twice), then the app is told it can drop its copy. Voice audio comes back as a Blob.
  async function adoptCarried() {
    const C = window.WosCarry; if (!C || !Array.isArray(C.outbox)) return;
    let saved = true;
    for (const x of C.outbox) {
      if (items.has(x.id)) { if (!items.get(x.id).durable) saved = false; continue; }
      const it = { ...x }; delete it.audio64;
      if (x.audio64) {
        try { const bin = atob(x.audio64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); it.audio = new Blob([u8], { type: x.audioType || 'audio/webm' }); }
        catch (e) { saved = false; continue; }
      }
      if (it.state === 'sending') it.state = 'waiting';
      if (!await put(it)) saved = false;
    }
    if (saved) { window.WosCarry = null; try { C.done(); } catch (e) {} }
  }
  function load() {
    if (ready) return ready;
    ready = (async () => {
      try {
        db = await open();
        const all = await tx('readonly', s => s.getAll()) || [];
        for (const it of all) { if (it.state === 'sending') it.state = 'waiting'; if (it.kind === 'dictation' && it.state === 'transcribing') it.state = 'held'; it.durable = true; it.storageError = ''; items.set(it.id, it); }
      } catch (e) {
        db = null;
        try { for (const it of JSON.parse(localStorage.getItem(LS) || '[]')) items.set(it.id, it); } catch (x) {}
      }
      await adoptCarried();
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
    const audio = it.audio.type ? it.audio : new Blob([it.audio], { type: it.audioType || 'audio/webm' });
    try { return (await window.WizConfig.transcribe(audio, { prompt: window.WizConfig.voicePrompt() })).text; }
    catch (e) { throw new HttpError(e.status || 0, e.message); }
  }
  async function uploadAudio(it) {
    const ext = /mp4|m4a/.test(it.audioType || '') ? 'm4a' : /ogg/.test(it.audioType || '') ? 'ogg' : /aac/.test(it.audioType || '') ? 'aac' : 'webm';
    const name = `wizard-voice-${new Date(it.createdAt).toISOString().replace(/[:.]/g, '-')}.${ext}`;
    const r = await call('/wizard/files/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Wizard-Filename': name, 'X-Wizard-Mime': it.audioType || 'audio/webm' }, body: it.audio });
    const f = (await r.json()).file || {};
    if (!f.id) throw new HttpError(502, 'Wizard Files returned no id');
    return { id: String(f.id), name: String(f.filename || name), mime: String(f.mime || it.audioType || ''), bytes: Number(f.bytes) || it.audio.size };
  }

  async function checkpoint(it) {
    if (!await put(it) && it.audio) throw new HttpError(409, it.storageError);
  }
  async function deliver(it) {
    if (!it.model || !it.provider) {
      if (it.body) throw new HttpError(409, 'Older message has no confirmed model · choose a model and resend');
      const M = window.WosModels;
      if (!M) throw new HttpError(409, 'Model selector unavailable · reload Wizard');
      Object.assign(it, await M.resolveRoute(M.snapshot(it.kind === 'reply' ? it.sessionId : '', it.model ? { model: it.model, provider: it.provider } : null, it.agent || '')));
      await checkpoint(it);
    }
    // A durable body from an earlier client cannot be silently admitted with no lock.
    if (it.body) {
      const frozen = JSON.parse(it.body);
      if (frozen.model !== it.model || frozen.provider !== it.provider || frozen.require_model_lock !== true)
        throw new HttpError(409, 'Older message has no model lock · choose a model and resend');
    }
    // Agents MVP: a message for a non-default agent names it on every thread/run call (agent=<id>); the server
    // pins the agent at thread creation and refuses a model outside that agent's allowed list.
    const aq = it.agent ? `?agent=${encodeURIComponent(it.agent)}` : '';
    // 1. Words: a voice item that never got its transcript gets one now.
    // Words typed or pasted with it (it.typed: a link, say) go first, then what was said: one message (legacy
    // composeVoiceTurnText). A recording with no speech still sends when it carries typed words.
    if (!it.text && it.audio) {
      const text = String(await transcribe(it) || '').trim(), typed = String(it.typed || '').trim();
      if (!text && !typed) { it.state = 'empty'; it.error = 'No speech in that recording'; await checkpoint(it); return; }
      it.text = [typed, text].filter(Boolean).join('\n\n').slice(0, 64000); await checkpoint(it);
    }
    // 2. The recording rides along as a voice note, so the original audio is on the server too.
    if (it.audio && !it.audioFile) { it.audioFile = await uploadAudio(it); it.files = [...(it.files || []), it.audioFile]; await checkpoint(it); }
    const fileIds = (it.files || []).map(f => f.id).filter(Boolean).slice(0, 8);
    const input = it.text || `Please use the attached ${fileIds.length === 1 ? 'file' : 'files'}.`;
    // 3. Steer a live run: only on the very first try. Steers have no idempotency key, so a retry
    //    becomes a queued run (with one) instead of risking a doubled steer.
    if (it.kind === 'reply' && it.steerRunId && !it.attempts) {
      try {
        const run = await (await call(`/wizard/hermes/v1/runs/${encodeURIComponent(it.steerRunId)}${aq}`)).json();
        if (!window.WosModels.matchesRuntime(run.runtime, it))
          throw new HttpError(409, 'Active run uses another model · queueing on the selected model');
        const steer = { input, model: it.model, provider: it.provider, require_model_lock: true }; if (fileIds.length) steer.wizard_file_ids = fileIds;
        const sr = await call(`/wizard/hermes/v1/runs/${encodeURIComponent(it.steerRunId)}/steer${aq}`, { method: 'POST', headers: J, body: JSON.stringify(steer) });
        const ack = await sr.json().catch(() => ({}));
        return done(it, { steered: true, runId: it.steerRunId, steerQueued: ack?.status === 'queued' });
      } catch (e) { if (![404, 409, 410].includes(e.status)) throw e; }
    }
    // 4. New chat: the session id was fixed at enqueue time; 409 means an earlier try created it.
    if (it.kind === 'new' && !it.sessionReady) {
      const sb = { source: 'wizard-mobile', id: it.sessionId };
      if (it.agent) sb.agent = it.agent;
      if (it.model) { sb.model = it.model; if (it.provider) sb.provider = it.provider; } // the picker's route for a new chat
      try { await call('/wizard/hermes/api/sessions' + aq, { method: 'POST', headers: J, body: JSON.stringify(sb) }); }
      catch (e) { if (e.status !== 409) throw e; }
      it.sessionReady = true; await checkpoint(it);
    }
    // 5. Admit the run. Same key + same bytes on every try → Wizard replays instead of duplicating.
    if (!it.body) {
      const body = { session_id: it.sessionId, input };
      if (it.instructions) body.instructions = String(it.instructions).slice(0, 2000);
      if (fileIds.length) body.wizard_file_ids = fileIds;
      if (!it.model || !it.provider) throw new HttpError(409, 'No confirmed model route · choose a model and resend');
      Object.assign(body, { model: it.model, provider: it.provider, require_model_lock: true });
      if (it.agent) body.agent = it.agent;
      it.body = JSON.stringify(body); await checkpoint(it);
    }
    const r = await call('/wizard/hermes/v1/runs' + aq, { method: 'POST', headers: { ...J, 'Idempotency-Key': it.id }, body: it.body });
    const run = await r.json().catch(() => ({}));
    return done(it, { steered: false, runId: run.run_id || run.id || '' });
  }
  async function done(it, res) {
    Object.assign(it, { state: 'sent', sentAt: now(), runId: res.runId, steered: res.steered, steerQueued: !!res.steerQueued, error: '' });
    delete it.audio; // the server has it now (voice note + transcript)
    await put(it);
    for (const fn of sentHooks) { try { fn(it, res); } catch (e) { console.error(e); } }
  }
  const sentHooks = new Set();

  async function attempt(it) {
    try { it.state = 'sending'; await checkpoint(it); await deliver(it); }
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
        const due = [...items.values()].filter(it => it.kind !== 'dictation' && (it.state === 'queued' || it.state === 'waiting') && (it.nextAt || 0) <= now()).sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!due) break;
        await attempt(due);
      }
      // Sent items stay a little while so the chat can swap the pending bubble for the real turn.
      for (const it of [...items.values()]) if ((it.state === 'sent' && now() - it.sentAt > 10 * 60e3) || (it.state === 'empty' && !it.audio && now() - it.createdAt > 60e3)) await del(it.id);
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
    // Dictation shares this store and transcriber, but NEVER enters message delivery.
    async retainDictation(audio) {
      await load();
      const it = { id: 'wos-' + crypto.randomUUID(), kind: 'dictation', state: 'held', createdAt: now(), audio, audioType: audio.type || 'audio/webm', text: '', error: '' };
      await put(it); return it;
    },
    async transcribeDictation(id) {
      await load();
      const it = items.get(id);
      if (!it || it.kind !== 'dictation' || it.state === 'transcribing') return null;
      it.state = 'transcribing'; it.error = ''; emit();
      // Even when storage is unavailable, the live Blob remains downloadable.
      if (!db) { try { db = await open(); } catch (e) {} }
      await put(it);
      try {
        it.text = String(await transcribe(it) || '').trim();
        if (!it.text) throw new Error('No speech detected · recording kept');
      } catch (e) { it.error = String(e.message || e); }
      it.state = 'held'; await put(it); return it;
    },
    recordings() { return [...items.values()].filter(it => it.audio && (it.kind === 'dictation' || it.storageError || it.state === 'empty')); },
    /* kind 'new' (new thread) or 'reply' (existing thread). Inspect durable/storageError on return. */
    async enqueue(o) {
      const M = window.WosModels;
      // The agent: a reply goes to the agent its thread is pinned to; a new chat to the agent whose Chats it was
      // written in. '' = the main agent (unchanged behaviour).
      const AG = window.WosAgents;
      const agent0 = o.kind === 'reply' ? (window.WizLive?.agentOf?.(o.sessionId) || '') : String(o.agent || '');
      const agent = agent0 && AG && AG.isOther(agent0) ? agent0 : '';
      const snapshot = M?.snapshot(o.kind === 'reply' ? o.sessionId : '', o.model ? { model: o.model, provider: o.provider } : null, agent);
      if (!M) throw new Error('Model selector unavailable · reload Wizard before sending');
      const route = await M.resolveRoute(snapshot);
      await load();
      const it = {
        id: 'wos-' + crypto.randomUUID(), createdAt: now(), attempts: 0, state: 'queued',
        kind: o.kind === 'reply' ? 'reply' : 'new', sessionId: o.sessionId || newSessionId(), steerRunId: o.steerRunId || '',
        text: String(o.text || '').trim(), typed: o.audio && !String(o.text || '').trim() ? String(o.typed || '').trim() : '', instructions: o.instructions || '', files: o.files || [],
        audio: o.audio || null, audioType: o.audio ? (o.audio.type || 'audio/webm') : '',
        wid: o.wid || '', how: o.how || '', source: o.source || 'chat', title: String(o.text || o.typed || '').slice(0, 60),
      };
      // A route chosen in the model picker (sealed with the message, like legacy's admit()).
      Object.assign(it, route);
      if (agent) { it.agent = agent; window.WizLive?.pinAgent?.(it.sessionId, agent); } else delete it.agent;
      await put(it); pump();
      return it;
    },
    async retry(id) {
      const it = items.get(id); if (!it || it.kind === 'dictation' || it.state === 'sent' || it.state === 'sending') return;
      if (!db) { try { db = await open(); } catch (e) {} }
      Object.assign(it, { state: 'waiting', nextAt: 0, attempts: Math.min(it.attempts || 0, AUTO_TRIES - 1) }); await put(it); pump();
    },
    async retryAll() {
      const retry = [...items.values()].filter(it => it.kind !== 'dictation' && (it.state === 'failed' || it.state === 'waiting'));
      for (const it of retry) await api.retry(it.id);
    },
    /* Not yet accepted by Wizard (what the Unsent list shows). */
    unsent() { return [...items.values()].filter(it => it.kind !== 'dictation' && it.state !== 'sent' && (it.state !== 'empty' || it.audio)).sort((a, b) => a.createdAt - b.createdAt); },
    /* What a chat window shows as pending bubbles: unsent, plus sent-but-not-yet-in-the-thread. */
    forThread(sessionId, wid) { return [...items.values()].filter(it => it.kind !== 'dictation' && it.state !== 'empty' && (it.sessionId === sessionId || (wid && it.wid === wid && it.kind === 'new' && it.state !== 'sent'))).sort((a, b) => a.createdAt - b.createdAt); },
    get(id) { return items.get(id) || null; },
    landed(id) { const it = items.get(id); if (it && it.state === 'sent') del(id); },
    // Dismiss a failed item for good (the Errors section's Dismiss on an unsent voice note, after a confirm).
    remove(id) { const it = items.get(id); if (!it || it.state === 'sending' || it.state === 'transcribing') return false; del(id); return true; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onSent(fn) { sentHooks.add(fn); return () => sentHooks.delete(fn); },
    pump, load,
    _items: items, AUTO_TRIES, BACKOFF,
  };
  addEventListener('beforeunload', e => {
    if ([...items.values()].some(it => it.audio && !it.durable)) { e.preventDefault(); e.returnValue = ''; }
  });
  addEventListener('online', () => api.retryAll());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { for (const it of items.values()) if (it.state === 'waiting') it.nextAt = 0; pump(); } });
  window.WosOutbox = api;
  load();
})();
