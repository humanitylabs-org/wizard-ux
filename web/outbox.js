/* Wizard UX submission custody. Keep original bytes until an upload receipt and run receipt.
 * IndexedDB first; complete per-item localStorage backup second; RAM plus a persistent warning last.
 * IDs, destination and model/provider belong to the submission, never to the retrying screen.
 */
(() => {
  'use strict';
  if (document.documentElement.dataset.leaving) return;
  const DB = 'wos-outbox', STORE = 'items', LS = 'wos.outbox.fallback', PREFIX = LS + '.v2.';
  const BACKOFF = [2000, 5000, 15000, 30000, 60000, 120000], AUTO_TRIES = BACKOFF.length;
  const J = { 'Content-Type': 'application/json' }, listeners = new Set(), sentHooks = new Set();
  const items = new Map(), writes = new Map(), encodings = new WeakMap();
  let db = null, opening = null, ready = null, pumping = false, timer = 0;
  const now = () => Date.now();
  const emit = () => { for (const fn of listeners) try { fn(api); } catch (e) { console.error(e); } paintNotice(); };

  function open() {
    if (db) return Promise.resolve(db);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let settled = false, r;
      const finish = (error, value) => { if (settled) { value?.close(); return; } settled = true; clearTimeout(t); error ? reject(error) : resolve(value); };
      const t = setTimeout(() => finish(new Error('Device storage did not respond')), 3000);
      try { r = indexedDB.open(DB, 1); } catch (e) { finish(e); return; }
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => {
        const d = r.result;
        if (settled) { d.close(); return; }
        db = d; d.onversionchange = () => { d.close(); if (db === d) db = null; };
        finish(null, d);
      };
      r.onerror = () => finish(r.error || new Error('Device storage unavailable'));
      r.onblocked = () => finish(new Error('Device storage blocked'));
    }).finally(() => { opening = null; });
    return opening;
  }
  function tx(mode, fn) {
    if (!db) return Promise.reject(new Error('Device storage unavailable'));
    return new Promise((resolve, reject) => {
      let t, out, settled = false;
      const finish = error => { if (settled) return; settled = true; clearTimeout(deadline); error ? reject(error) : resolve(out?.result); };
      const deadline = setTimeout(() => { try { t?.abort(); } catch (_) {} finish(new Error('Device save timed out')); }, 3000);
      try {
        t = db.transaction(STORE, mode);
        t.oncomplete = () => finish();
        t.onerror = t.onabort = () => finish(t.error || new Error('Device save failed'));
        out = fn(t.objectStore(STORE));
      } catch (e) { try { t?.abort(); } catch (_) {} finish(e); }
    });
  }
  function serial(id, fn) {
    const p = (writes.get(id) || Promise.resolve()).catch(() => {}).then(fn);
    writes.set(id, p); p.finally(() => { if (writes.get(id) === p) writes.delete(id); }).catch(() => {});
    return p;
  }
  function encode(blob) {
    if (!encodings.has(blob)) encodings.set(blob, new Promise((resolve, reject) => {
      const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = () => reject(r.error); r.readAsDataURL(blob);
    }));
    return encodings.get(blob);
  }
  function decode(x) {
    const it = { ...x }; delete it.audio64;
    if (x.audio64) {
      const bin = atob(x.audio64), bytes = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      it.audio = new Blob([bytes], { type: x.audioType || 'audio/webm' });
    }
    // An old text-only fallback must never send the text while silently abandoning its recording.
    if (it.audioType && !it.audio && !it.audioFile && it.state !== 'sent') {
      it.state = 'missing'; it.error = 'This older recording was not saved by the previous client. Its text is kept.';
    }
    return it;
  }
  async function persist(it) {
    const copy = { ...it }; delete copy.durable; delete copy.storageError;
    try {
      await open(); await tx('readwrite', s => s.put(copy));
      it.durable = true; it.storageError = '';
      try { localStorage.removeItem(PREFIX + it.id); } catch (_) {}
    } catch (e) {
      it.storageError = String(e.message || 'Device storage unavailable'); it.durable = false;
      try {
        const { audio, ...x } = copy;
        if (audio) x.audio64 = await encode(audio);
        localStorage.setItem(PREFIX + it.id, JSON.stringify(x));
        it.durable = true;
      } catch (_) { /* Keep the entire item and Blob in RAM; the notice stays until custody is durable. */ }
    }
    emit(); return it;
  }
  function put(it) {
    items.set(it.id, it); it.updatedAt = now();
    return serial(it.id, () => persist(it));
  }
  async function del(id) {
    const it = items.get(id); if (!it) return;
    // A tombstone survives an interrupted delete, preventing stale IDB/fallback rows from replaying.
    Object.assign(it, { state: 'sent', sentAt: now(), audio: null, error: '' });
    await put(it);
    await serial(id, async () => {
      try { await open(); await tx('readwrite', s => s.delete(id)); localStorage.removeItem(PREFIX + id); items.delete(id); }
      catch (_) { /* Retain the tombstone if either deletion is uncertain. */ }
    });
    emit();
  }
  function recover(it, durable = true) {
    if (it.state === 'sending') it.state = 'waiting';
    if (it.state === 'processing' || it.state === 'preparing') { it.state = 'failed'; it.error = 'Interrupted before sending · recording kept. Retry sends to its original destination.'; }
    it.durable = durable;
    const old = items.get(it.id);
    if (!old || (it.updatedAt || it.createdAt) >= (old.updatedAt || old.createdAt)) items.set(it.id, it);
  }
  function load() {
    if (ready) return ready;
    ready = (async () => {
      try { await open(); for (const it of await tx('readonly', s => s.getAll()) || []) recover(it); } catch (_) { db = null; }
      try {
        for (const it of JSON.parse(localStorage.getItem(LS) || '[]')) recover(decode(it));
        for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) recover(decode(JSON.parse(localStorage.getItem(key))));
        // Migrate the legacy array before removing it, including old missing-audio warnings.
        let migrated = true;
        for (const x of JSON.parse(localStorage.getItem(LS) || '[]')) { const it = items.get(x.id); if (it && !(await put(it)).durable) migrated = false; }
        if (migrated) localStorage.removeItem(LS);
      } catch (_) {}
      const C = window.WosCarry;
      if (C && Array.isArray(C.outbox)) {
        let safe = true;
        for (const x of C.outbox) { if (!items.has(x.id)) recover(decode(x), false); const it = items.get(x.id); if (!(await put(it)).durable) safe = false; }
        if (safe) { window.WosCarry = null; try { C.done(); } catch (_) {} }
      }
      emit(); schedule(0);
    })();
    return ready;
  }
  class HttpError extends Error { constructor(status, msg) { super(msg || 'HTTP ' + status); this.status = status; } }
  async function call(path, init = {}) {
    let r;
    try { r = await fetch(path, { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(45000), ...init }); }
    catch (_) { throw new HttpError(0, 'Couldn’t reach Wizard'); }
    if (!r.ok) { let m = ''; try { m = (await r.json()).error || ''; } catch (_) {} throw new HttpError(r.status, typeof m === 'string' ? m : m.message || ''); }
    return r;
  }
  const transient = e => !e.status || [408, 425, 429].includes(e.status) || e.status >= 500;
  function reason(e) {
    if (!e.status) return 'Couldn’t reach Wizard';
    if (e.status === 403) return 'Wizard sign-in needed';
    if (e.status === 413) return 'Too large for Wizard';
    if (e.status >= 500) return `Wizard was unavailable (${e.status})`;
    return e.message || `Wizard refused it (${e.status})`;
  }
  async function transcribe(it) {
    try { return (await window.WizConfig.transcribe(it.audio, { prompt: window.WizConfig.voicePrompt() })).text; }
    catch (e) { throw new HttpError(e.status || 0, e.message); }
  }
  async function uploadAudio(it) {
    const ext = /mp4|m4a/.test(it.audioType) ? 'm4a' : /ogg/.test(it.audioType) ? 'ogg' : /aac/.test(it.audioType) ? 'aac' : 'webm';
    const name = `wizard-voice-${new Date(it.createdAt).toISOString().replace(/[:.]/g, '-')}.${ext}`;
    const r = await call('/wizard/files/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Wizard-Filename': name, 'X-Wizard-Mime': it.audioType || 'audio/webm' }, body: it.audio });
    const f = (await r.json()).file || {};
    if (!f.id) throw new HttpError(502, 'Wizard Files returned no id');
    return { id: String(f.id), name: String(f.filename || name), mime: String(f.mime || it.audioType || ''), bytes: Number(f.bytes) || it.audio.size };
  }
  async function keepAudio(it) {
    if (it.audio && !it.audioFile) {
      it.audioFile = await uploadAudio(it); it.files = [...(it.files || []).slice(0, 7), it.audioFile]; await put(it);
    }
  }
  async function deliver(it) {
    if (!it.model || !it.provider) throw new HttpError(409, 'No confirmed model route · choose a model before retrying');
    if (it.body) {
      const frozen = JSON.parse(it.body);
      if (frozen.model !== it.model || frozen.provider !== it.provider || frozen.session_id !== it.sessionId || frozen.require_model_lock !== true)
        throw new HttpError(409, 'Stored route does not match this message · original message kept');
    }
    // When local writes fail, server audio custody comes before slower transcription.
    if (it.storageError) await keepAudio(it);
    if (!it.text && it.audio) {
      const text = String(await transcribe(it) || '').trim(), typed = String(it.typed || '').trim();
      if (!text && !typed) { it.state = 'empty'; it.error = 'No speech in that recording · original recording kept'; await put(it); return; }
      it.text = [typed, text].filter(Boolean).join('\n\n').slice(0, 64000); await put(it);
    }
    await keepAudio(it);
    const fileIds = (it.files || []).map(f => f.id).filter(Boolean).slice(0, 8);
    const input = it.text || `Please use the attached ${fileIds.length === 1 ? 'file' : 'files'}.`;
    // All outbox sends use the idempotent queue. /steer has no reconciliation contract: a lost
    // successful steer followed by a queued retry can otherwise deliver the same message twice.
    if (it.kind === 'new' && !it.sessionReady) {
      try { await call('/wizard/hermes/api/sessions', { method: 'POST', headers: J, body: JSON.stringify({ source: 'wizard-mobile', id: it.sessionId, model: it.model, provider: it.provider }) }); }
      catch (e) { if (e.status !== 409) throw e; }
      it.sessionReady = true; await put(it);
    }
    if (!it.body) {
      const body = { session_id: it.sessionId, input };
      if (it.instructions) body.instructions = String(it.instructions).slice(0, 2000);
      if (fileIds.length) body.wizard_file_ids = fileIds;
      Object.assign(body, { model: it.model, provider: it.provider, require_model_lock: true });
      it.body = JSON.stringify(body); await put(it);
    }
    const r = await call('/wizard/hermes/v1/runs', { method: 'POST', headers: { ...J, 'Idempotency-Key': it.id }, body: it.body });
    let run; try { run = await r.json(); } catch (_) { throw new HttpError(502, 'Wizard’s send receipt was lost'); }
    const runId = run.run_id || run.id;
    if (!runId) throw new HttpError(502, 'Wizard returned no send receipt');
    return done(it, { steered: false, runId });
  }
  async function done(it, res) {
    if (it.audio && !it.audioFile?.id) throw new HttpError(502, 'No recording upload receipt · original kept');
    Object.assign(it, { state: 'sent', sentAt: now(), runId: res.runId, steered: false, error: '' });
    delete it.audio;
    await put(it);
    for (const fn of sentHooks) try { fn(it, res); } catch (e) { console.error(e); }
  }
  async function attempt(it) {
    it.state = 'sending'; await put(it);
    try { await deliver(it); }
    catch (e) {
      it.attempts = (it.attempts || 0) + 1; it.error = reason(e); it.lastAttemptAt = now();
      // RAM-only submissions keep retrying for as long as this tab is alive.
      if (transient(e) && (!it.durable || it.attempts < AUTO_TRIES)) { it.state = 'waiting'; it.nextAt = now() + BACKOFF[Math.min(it.attempts - 1, BACKOFF.length - 1)]; }
      else { it.state = 'failed'; it.nextAt = 0; }
      await put(it);
    }
  }
  async function pump() {
    if (pumping) return; pumping = true;
    try {
      await load();
      for (const it of items.values()) if (it.storageError || !it.durable) await put(it);
      for (;;) {
        const due = [...items.values()].filter(it => ['queued', 'waiting'].includes(it.state) && (it.nextAt || 0) <= now()).sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!due) break;
        await attempt(due);
      }
      for (const it of [...items.values()]) if (it.state === 'sent' && it.durable && now() - it.sentAt > 10 * 60e3) await del(it.id);
    } finally { pumping = false; schedule(); }
  }
  function schedule(ms) {
    clearTimeout(timer);
    if (ms == null) {
      const next = [...items.values()].filter(it => it.state === 'waiting').map(it => it.nextAt || 0);
      if ([...items.values()].some(it => it.storageError || !it.durable)) next.push(now() + 5000);
      if (!next.length) return;
      ms = Math.max(0, Math.min(...next) - now());
    }
    timer = setTimeout(pump, ms);
  }
  const newSessionId = () => `wizard_${now()}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  function make(o) {
    return { id: 'wos-' + crypto.randomUUID(), createdAt: now(), attempts: 0, state: 'preparing',
      kind: o.kind === 'reply' ? 'reply' : 'new', sessionId: o.sessionId || newSessionId(), steerRunId: o.steerRunId || '',
      text: String(o.text || '').trim(), typed: o.audio && !String(o.text || '').trim() ? String(o.typed || '').trim() : '', instructions: o.instructions || '', files: o.files || [],
      audio: o.audio || null, audioType: o.audio?.type || '', model: o.model || '', provider: o.provider || '',
      wid: o.wid || '', how: o.how || '', source: o.source || 'chat', title: String(o.text || o.typed || '').slice(0, 60), durable: false };
  }
  function notice() {
    const troubled = [...items.values()].filter(it => it.state !== 'sent' && (it.storageError || !it.durable));
    if (!troubled.length) return '';
    return troubled.some(it => !it.durable)
      ? 'Device save failed · kept in this tab. Retrying. Keep Wizard open until sent.'
      : 'Device save failed · a backup copy is kept. Retrying the upload.';
  }
  function paintNotice() {
    if (!document.body) return;
    const text = notice();
    const hosts = [...document.querySelectorAll('.ch-compose')];
    // Send-and-go may already have left the composer. Keep the same calm notice beside the voice dock.
    const dock = document.querySelector('#voice') || document.querySelector('.dbar') || document.querySelector('#voicePill')?.parentElement;
    if (dock) hosts.push(dock);
    for (const host of hosts) {
      let el = host.querySelector('[data-custody-notice]');
      if (!text) { el?.remove(); continue; }
      if (!el) { el = document.createElement('small'); el.dataset.custodyNotice = ''; el.className = 'ch-custody-notice'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); host.appendChild(el); }
      el.textContent = text;
    }
  }
  const api = {
    // Stage original audio before the phone's pre-send transcription/router, with its sealed route.
    async stage(o) { await load(); const it = make(o); it.state = 'processing'; await put(it); return it; },
    async enqueue(o) {
      const M = window.WosModels;
      let snapshot = o.model ? { model: o.model, provider: o.provider || '' } : null, routeError;
      try { snapshot = M?.snapshot(o.kind === 'reply' ? o.sessionId : '', snapshot) || snapshot; }
      catch (e) { routeError = e; }
      await load();
      const held = o.custodyId && items.get(o.custodyId);
      const it = held || make({ ...o, ...(snapshot || {}) });
      if (held) {
        if (held.state === 'sent' || held.body) return held;
        // Preserve the original route/destination/id. Routing is allowed to choose a local command;
        // message delivery always retains the send-time thread and selected provider.
        Object.assign(it, { text: String(o.text || '').trim(), typed: o.typed || it.typed, files: o.files || it.files, instructions: o.instructions || it.instructions, wid: o.wid || it.wid });
      }
      await put(it); // own the entire submission even if route discovery fails
      try {
        if (routeError) throw routeError;
        if (!M) throw new Error('Model selector unavailable · reload Wizard before sending');
        const route = await M.resolveRoute(held && it.model ? { model: it.model, provider: it.provider } : snapshot);
        Object.assign(it, route, { state: 'queued' });
      } catch (e) { it.state = 'failed'; it.error = String(e.message || e); }
      await put(it); pump(); return it;
    },
    retry(id) { const it = items.get(id); if (!it || ['sent', 'sending', 'processing', 'preparing', 'missing'].includes(it.state)) return; Object.assign(it, { state: 'waiting', nextAt: 0, attempts: Math.min(it.attempts || 0, AUTO_TRIES - 1) }); put(it).then(pump); },
    retryAll() { for (const it of items.values()) if (it.state === 'failed' || it.state === 'waiting') Object.assign(it, { state: 'waiting', nextAt: 0, attempts: Math.min(it.attempts || 0, AUTO_TRIES - 1) }); Promise.all([...items.values()].map(put)).then(pump); },
    unsent() { return [...items.values()].filter(it => it.state !== 'sent').sort((a, b) => a.createdAt - b.createdAt); },
    forThread(sessionId, wid) { return [...items.values()].filter(it => it.sessionId === sessionId || (wid && it.wid === wid && it.kind === 'new' && it.state !== 'sent')).sort((a, b) => a.createdAt - b.createdAt); },
    get(id) { return items.get(id) || null; },
    landed(id) { const it = items.get(id); if (it?.state === 'sent') del(id); },
    remove(id) { const it = items.get(id); if (!it || it.state === 'sending') return false; del(id); return true; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onSent(fn) { sentHooks.add(fn); return () => sentHooks.delete(fn); },
    notice, paintNotice, pump, load, _items: items, AUTO_TRIES, BACKOFF,
  };
  addEventListener('beforeunload', e => { if ([...items.values()].some(it => it.state !== 'sent' && !it.durable)) { e.preventDefault(); e.returnValue = ''; } });
  addEventListener('online', () => api.retryAll());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { for (const it of items.values()) if (it.state === 'waiting') it.nextAt = 0; pump(); } });
  window.WosOutbox = api;
  load();
})();
