// Historical production outbox at wizard-ux 3190f46; upgrade regression producer.
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
  const conversationWork = new Map();
  // Unreconciled fallback rows must not overwrite or replay an inaccessible primary receipt.
  const quarantine = new Set();
  const unconfirmed = 'Could not confirm steering · original kept. Not retried: the run may already have received it.';
  let db = null, opening = null, ready = null, recovered = false, pumping = false, timer = 0;
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
    if(x.parkedDraft?.parts64){it.parkedDraft={...x.parkedDraft,parts:x.parkedDraft.parts64.map(part=>decode({audio64:part.data,audioType:part.type}).audio)};delete it.parkedDraft.parts64;}
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
    if (quarantine.has(it.id)) return it;
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
        if(copy.parkedDraft?.parts){x.parkedDraft={...copy.parkedDraft,parts:undefined,parts64:await Promise.all(copy.parkedDraft.parts.map(async part=>({type:part.type,data:await encode(part)})))};}
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
    delete it.parkedDraft; // a deletion tombstone must not retain hidden audio parts
    await put(it);
    // Never erase the durable terminal marker: an inaccessible legacy/fallback store may
    // still contain an older sendable copy. A small marker wins on every future recovery.
    // Keep sealKey/nativeId too, so their independent owners cannot restore a duplicate.
    if (it.durable) {
      const marker = { id, state: 'sent', sentAt: it.sentAt, updatedAt: it.updatedAt,
        createdAt: it.createdAt, sealKey: it.sealKey, nativeId: it.nativeId, nativeIds: it.nativeIds, meetingEventId: it.meetingEventId, compact: true };
      items.set(id, marker); await put(marker);
    }
    emit();
  }
  function recover(it, durable = true) {
    if (it.kind === 'conversation' && it.state !== 'sent') { it.state = 'held'; it.error = 'App voice input recording kept · retry original or copy transcript; never sent to Chats'; }
    if (it.kind === 'dictation' && it.state === 'transcribing') it.state = 'held';
    if (it.state === 'capturing') { it.state = 'held'; it.error = 'Interrupted recording · original bytes kept'; }
    if (it.steerDispatch === 'started' && it.state !== 'sent') { it.state = 'unconfirmed'; it.error = unconfirmed; }
    if (it.state === 'sending') it.state = 'waiting';
    if (it.state === 'processing' || it.state === 'preparing') { it.state = it.intent === 'command' ? 'held' : 'failed'; it.error = 'Interrupted before sending · recording kept. Retry sends to its original destination.'; }
    it.durable = durable;
    const old = items.get(it.id);
    if (!old || (old.state !== 'sent' && (it.state === 'sent' || (it.updatedAt || it.createdAt) > (old.updatedAt || old.createdAt) || (it.steerDispatch === 'started' && (it.updatedAt || it.createdAt) === (old.updatedAt || old.createdAt))))) items.set(it.id, it);
  }
  function load() {
    if (ready) return ready;
    ready = (async () => {
      const recoveredIds = new Set();
      try {
        await open(); for (const it of await tx('readonly', s => s.getAll()) || []) { recoveredIds.add(it.id); recover(it); }
        recovered = true;
      } catch (_) { db = null; recovered = false; }
      const fallback = x => {
        recoveredIds.add(x.id);
        if (!recovered && !items.has(x.id)) quarantine.add(x.id);
        recover(decode(x));
      };
      try {
        for (const it of JSON.parse(localStorage.getItem(LS) || '[]')) fallback(it);
        for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) fallback(JSON.parse(localStorage.getItem(key)));
        if (recovered) quarantine.clear();
        // Migrate the legacy array before removing it, including old missing-audio warnings.
        let migrated = true;
        for (const x of JSON.parse(localStorage.getItem(LS) || '[]')) { const it = items.get(x.id); if (it && (quarantine.has(it.id) || !(await put(it)).durable)) migrated = false; }
        if (migrated) { try { localStorage.removeItem(LS); } catch (_) {} }
      } catch (_) { recovered = false; for (const id of recoveredIds) quarantine.add(id); }
      const C = window.WosCarry;
      if (C && Array.isArray(C.outbox)) {
        let safe = true;
        for (const x of C.outbox) { if (!items.has(x.id)) recover(decode(x), false); const it = items.get(x.id); if (!(await put(it)).durable) safe = false; }
        if (safe) { window.WosCarry = null; try { C.done(); } catch (_) {} }
      }
      emit(); schedule();
    })().finally(() => { if (!recovered) ready = null; });
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
  async function bounded(fn, ms = 45000) {
    const controller = new AbortController(); let timer;
    try { return await Promise.race([Promise.resolve().then(() => fn(controller.signal)),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new HttpError(0, 'Request timed out · original kept')); }, ms); })]); }
    finally { clearTimeout(timer); }
  }
  async function transcribe(it) {
    try { return (await bounded(signal => window.WizConfig.transcribe(it.audio, { prompt: window.WizConfig.voicePrompt(), signal }), 45000)).text; }
    catch (e) { throw new HttpError(e.status || 0, e.message); }
  }
  async function uploadAudio(it) {
    const ext = /wav/.test(it.audioType) ? 'wav' : /mp4|m4a/.test(it.audioType) ? 'm4a' : /ogg/.test(it.audioType) ? 'ogg' : /aac/.test(it.audioType) ? 'aac' : 'webm';
    const name = `wizard-voice-${new Date(it.createdAt).toISOString().replace(/[:.]/g, '-')}.${ext}`;
    const r = await call('/wizard/files/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Wizard-Filename': name, 'X-Wizard-Mime': it.audioType || 'audio/webm' }, body: it.audio });
    const f = (await r.json()).file || {};
    if (!f.id) throw new HttpError(502, 'Wizard Files returned no id');
    return { id: String(f.id), name: String(f.filename || name), mime: String(f.mime || it.audioType || ''), bytes: Number(f.bytes) || it.audio.size };
  }
  async function keepAudio(it) {
    if (it.audio && !it.audioFile) {
      it.audioFile = await uploadAudio(it); it.files = [...(it.files || []).filter(f => f.id !== it.audioFile.id), it.audioFile]; await put(it);
    }
  }
  async function deliver(it) {
    if (it.kind === 'conversation') throw new HttpError(409, 'App voice input messages use explicit conversation delivery only');
    if (!it.model || !it.provider) throw new HttpError(409, 'No confirmed model route · choose a model before retrying');
    if (it.body) {
      const frozen = JSON.parse(it.body);
      if (frozen.model !== it.model || frozen.provider !== it.provider || frozen.session_id !== it.sessionId || (frozen.agent || '') !== (it.agent || '') || frozen.require_model_lock !== true)
        throw new HttpError(409, 'Stored route does not match this message · original message kept');
    }
    // When local writes fail, server audio custody comes before slower transcription.
    await keepAudio(it); // protect the original bytes before any STT, even on a healthy device
    if (!it.text && it.audio) {
      const text = String(await transcribe(it) || '').trim(), typed = String(it.typed || '').trim();
      if (!text && !typed) { it.state = 'empty'; it.error = 'No speech in that recording · original recording kept'; await put(it); return; }
      it.text = [typed, text].filter(Boolean).join('\n\n').slice(0, 64000); await put(it);
    }
    await keepAudio(it);
    const fileIds = [...new Set((it.files || []).map(f => f.id).filter(Boolean))];
    if (fileIds.length > 8) throw new HttpError(409, 'Too many attachments including the recording · originals kept');
    const aq = it.agent ? `?agent=${encodeURIComponent(it.agent)}` : '';
    const input = it.text || `Please use the attached ${fileIds.length === 1 ? 'file' : 'files'}.`;
    // Freeze an exact-run steer separately from new-run admission. This endpoint has NO
    // durable idempotency ledger: persist intent before dispatch and never replay ambiguity.
    if (it.steerRunId) {
      if (it.steerDispatch === 'started') { it.state = 'unconfirmed'; it.error = unconfirmed; await put(it); return; }
      if (!it.steerBody) {
        it.steerBody = JSON.stringify({ input, model: it.model, provider: it.provider, require_model_lock: true,
          ...(it.agent ? { agent: it.agent } : {}), ...(fileIds.length ? { wizard_file_ids: fileIds } : {}) });
        it.steerTarget = it.steerRunId;
      }
      const frozen = JSON.parse(it.steerBody);
      if (it.steerTarget !== it.steerRunId || frozen.model !== it.model || frozen.provider !== it.provider ||
          (frozen.agent || '') !== (it.agent || '') || frozen.require_model_lock !== true)
        throw new HttpError(409, 'Stored steer route changed · original kept');
      // Refuse to mutate without a durable dispatch journal, even if audio was uploaded.
      it.steerDispatch = 'started'; await put(it);
      if (!it.durable) { delete it.steerDispatch; throw new HttpError(409, 'Device save failed · steering not dispatched; original kept'); }
      let receipt;
      try {
        const r = await call(`/wizard/hermes/v1/runs/${encodeURIComponent(it.steerTarget)}/steer` + aq,
          { method: 'POST', headers: { ...J, 'Idempotency-Key': it.id }, body: it.steerBody });
        receipt = await r.json();
        if (receipt?.accepted !== true || ('run_id' in receipt && receipt.run_id !== it.steerTarget)) throw new Error('Invalid steer receipt');
      } catch (e) {
        // Explicit client rejection is retryable against the SAME run. Timeout/server/JSON
        // failure is ambiguous, not evidence of rejection, and cannot fall back to admission.
        if (e.status >= 400 && e.status < 500 && e.status !== 408) {
          it.steerDispatch = 'rejected'; it.state = 'failed'; it.error = reason(e);
        } else { it.state = 'unconfirmed'; it.error = unconfirmed; }
        it.attempts = (it.attempts || 0) + 1; it.lastAttemptAt = now();
        it.nextAt = 0; await put(it); return;
      }
      return done(it, { steered: true, steerQueued: receipt.status === 'queued', runId: it.steerTarget });
    }
    if (it.kind === 'new' && !it.sessionReady) {
      try { await call('/wizard/hermes/api/sessions' + aq, { method: 'POST', headers: J, body: JSON.stringify({ source: 'wizard-mobile', id: it.sessionId, model: it.model, provider: it.provider, ...(it.agent ? { agent: it.agent } : {}) }) }); }
      catch (e) { if (e.status !== 409) throw e; }
      it.sessionReady = true; await put(it);
    }
    if (!it.body) {
      const body = { session_id: it.sessionId, input };
      if (it.instructions) body.instructions = String(it.instructions).slice(0, 2000);
      if (fileIds.length) body.wizard_file_ids = fileIds;
      Object.assign(body, { model: it.model, provider: it.provider, require_model_lock: true });
      if (it.agent) body.agent = it.agent;
      it.body = JSON.stringify(body); await put(it);
    }
    const r = await call('/wizard/hermes/v1/runs' + aq, { method: 'POST', headers: { ...J, 'Idempotency-Key': it.id }, body: it.body });
    let run; try { run = await r.json(); } catch (_) { throw new HttpError(502, 'Wizard’s send receipt was lost'); }
    const runId = run.run_id || run.id;
    if (!runId) throw new HttpError(502, 'Wizard returned no send receipt');
    return done(it, { steered: false, runId, userMessageId: run.user_message_id || null });
  }
  async function done(it, res) {
    if (it.audio && !it.audioFile?.id) throw new HttpError(502, 'No recording upload receipt · original kept');
    Object.assign(it, { state: 'sent', sentAt: now(), runId: res.runId, userMessageId: res.userMessageId || null, steered: !!res.steered, steerQueued: !!res.steerQueued, error: '' });
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
        const due = [...items.values()].filter(it => !quarantine.has(it.id) && it.kind !== 'dictation' && ['queued', 'waiting'].includes(it.state) && (it.nextAt || 0) <= now()).sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!due) break;
        await attempt(due);
      }
      for (const it of [...items.values()]) if (it.state === 'sent' && !it.compact && it.durable && now() - it.sentAt > 10 * 60e3) await del(it.id);
    } finally { pumping = false; schedule(); }
  }
  function schedule(ms) {
    clearTimeout(timer);
    if (ms == null) {
      const next = [...items.values()].filter(it => !quarantine.has(it.id) && it.state === 'waiting').map(it => it.nextAt || 0);
      if (!recovered || [...items.values()].some(it => it.storageError || !it.durable)) next.push(now() + 5000);
      if ([...items.values()].some(it => !quarantine.has(it.id) && it.kind !== 'dictation' && it.state === 'queued')) next.push(now());
      if (!next.length) return;
      ms = Math.max(0, Math.min(...next) - now());
    }
    timer = setTimeout(pump, ms);
  }
  const newSessionId = () => `wizard_${now()}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  function make(o) {
    return { id: o.nativeId ? 'wos-native-' + o.nativeId : 'wos-' + crypto.randomUUID(), createdAt: now(), attempts: 0, state: 'preparing',
      meetingEventId: o.meetingEventId || '', parkedDraft: o.parkedDraft || null, nativeIds: [...new Set([...(o.nativeIds || []), o.nativeId].filter(Boolean))],
      kind: o.kind === 'conversation' ? 'conversation' : o.kind === 'reply' ? 'reply' : 'new', conversation: o.conversation || null, sessionId: o.kind === 'conversation' ? '' : o.sessionId || newSessionId(), steerRunId: o.meetingEventId ? '' : o.steerRunId || '',
      text: String(o.text || '').trim(), typed: o.audio && !String(o.text || '').trim() ? String(o.typed || '').trim() : '', instructions: o.instructions || '', files: (o.files || []).map(f => ({ ...f })),
      audio: o.audio || null, audioType: o.audio?.type || '', model: o.model || '', provider: o.provider || '',
      sealKey: o.sealKey || '', nativeId: o.nativeId || '', agent: o.agent || '', wid: o.wid || '', how: o.how || '', intent: o.intent || 'message', source: o.source || 'chat', title: String(o.text || o.typed || '').slice(0, 60), durable: false };
  }
  function notice() {
    const troubled = [...items.values()].filter(it => !quarantine.has(it.id) && it.state !== 'sent' && (it.storageError || !it.durable));
    if (!troubled.length) return quarantine.size ? 'Saved items waiting for device storage verification · not sending these items.' : '';
    return troubled.some(it => !it.durable)
      ? 'Device save failed · kept in this tab. Retrying storage; keep Wizard open.'
      : 'Device save failed · complete backup kept. Retrying storage.';
  }
  function paintNotice() {
    if (!document.body) return;
    const text = notice();
    const hosts = [...document.querySelectorAll('.ch-compose')].filter(el => el.getClientRects().length && getComputedStyle(el).display !== 'none');
    // Send-and-go may already have left the composer. Keep the same calm notice beside the voice dock.
    const dock = document.querySelector('#voice') || document.querySelector('.dbar') || document.querySelector('#voicePill')?.parentElement;
    if (dock && !hosts.length) hosts.push(dock);
    for (const el of document.querySelectorAll('[data-custody-notice]')) if (!hosts.includes(el.parentElement)) el.remove();
    for (const host of hosts) {
      let el = host.querySelector('[data-custody-notice]');
      if (!text) { el?.remove(); continue; }
      if (!el) { el = document.createElement('small'); el.dataset.custodyNotice = ''; el.className = 'ch-custody-notice'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); host.appendChild(el); }
      el.textContent = text;
    }
  }
  const api = {
    async sendConversation(o) {
      await load();
      const existing = (o.captureId && items.get(o.captureId)) || (o.nativeId && api.nativeItem(o.nativeId));
      const it = existing?.kind === 'conversation' ? existing : await api.stage({ ...o, kind: 'conversation' });
      await api.transition(it.id, 'held', 'Sending to ' + (o.conversation?.label || 'App voice input'));
      return api.retryConversation(it.id);
    },
    retryConversation(id) {
      if (conversationWork.has(id)) return conversationWork.get(id);
      const work = (async () => {
        await load(); const it = items.get(id);
        if (!it || it.kind !== 'conversation' || quarantine.has(id) || it.state === 'sent') return it;
        it.state = 'transcribing'; it.error = ''; await put(it);
        try {
          if (it.files?.length) throw new Error('App voice input does not support attachments · audio and files kept; nothing sent');
          if (!it.text && it.audio) { it.text = String(await transcribe(it) || '').trim(); await put(it); }
          if (!it.text) throw new Error('No speech detected · App voice input recording kept');
          // A durable journal owns bytes, text, destination and the SAME request identity
          // before the app may mutate anything. No audio upload to an ordinary Chat.
          if (!it.durable || it.storageError) throw new Error('Device save failed · App voice input message not dispatched; keep this tab open');
          if (!window.WizAppServices?.conversation) throw new Error('App voice input conversation unavailable');
          it.state = 'sending'; await put(it);
          const receipt = await bounded(() => window.WizAppServices.conversation.deliver(it.conversation, { request_id: it.id, text: it.text, files: it.files }));
          if (receipt?.accepted !== true || receipt.request_id !== it.id) throw new Error('App voice input receipt uncertain');
          it.state = 'sent'; it.sentAt = now(); it.error = ''; await put(it);
          // Keep original bytes until the normal durable terminal-marker cleanup.
        } catch (e) { it.state = 'held'; it.error = String(e.message || e) + ' · retry original in Recordings'; await put(it); }
        return it;
      })().finally(() => conversationWork.delete(id));
      conversationWork.set(id, work); return work;
    },
    // Dictation shares this store and transcriber, but NEVER enters message delivery.
    async retainDictation(audio, captureId = null) {
      await load();
      const it = captureId ? await api.stage({ audio, captureId }) : make({ audio });
      Object.assign(it, { kind: 'dictation', state: 'held', text: '', error: '' });
      await put(it); return it;
    },
    async transcribeDictation(id) {
      await load();
      const it = items.get(id);
      if (it?.kind === 'conversation' && it.text) return it; // copy/transcribe NEVER dispatches
      if (!it || !it.audio || ['sent', 'sending', 'processing', 'capturing', 'transcribing'].includes(it.state)) return null;
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
    recordings() { return [...items.values()].filter(it => it.audio && it.state !== 'capturing' && (it.kind === 'dictation' || it.kind === 'capture' || it.storageError || ['empty', 'held', 'failed', 'unconfirmed'].includes(it.state))); },

    // Stage original audio before the phone's pre-send transcription/router, with its sealed route.
    async stage(o) {
      await load();
      const prior = o.captureId && items.get(o.captureId);
      if (prior?.captureWrite) await prior.captureWrite;
      const existing = o.nativeId && api.nativeItem(o.nativeId);
      if (existing && existing !== prior) return existing;
      if (prior && (quarantine.has(prior.id) || prior.state === 'sent' || prior.body || prior.steerBody)) return prior;
      const it = make(o); if (prior) { it.id = prior.id; it.createdAt = prior.createdAt; it.nativeId ||= prior.nativeId; it.nativeIds = [...new Set([...(prior.nativeIds || []), prior.nativeId, ...it.nativeIds].filter(Boolean))]; }
      // Parking is held at its first durable boundary, even before transition.
      it.state = it.parkedDraft ? 'held' : 'processing'; await put(it); schedule(); return it;
    },
    capture(blob, id, parts) {
      let it = items.get(id);
      if (!it) { it = make({ audio: blob }); it.id = id; it.kind = 'capture'; it.state = 'capturing'; items.set(id, it); }
      if ((it.kind !== 'capture' && !it.parkedDraft) || it.state === 'sent') return Promise.resolve(it);
      if(it.parkedDraft && parts)it.parkedDraft.parts=parts;
      it.audio = blob;
      // One pending write per capture; the next flush takes the latest chunks, not an unbounded backlog.
      if (!it.captureWrite) {
        const work = put(it).then(() => { delete it.captureWrite; if (it.audio !== blob && (it.kind === 'capture'||it.parkedDraft)) return api.capture(it.audio, id); return it; });
        Object.defineProperty(it, 'captureWrite', { value: work, writable: true, configurable: true, enumerable: false });
      }
      return it.captureWrite;
    },
    async protect(id) { const it = items.get(id); if (it) await keepAudio(it); return it; },
    // Callers must await this instead of mutating a recovered item only in RAM.
    async transition(id, state, error = '') {
      const it = items.get(id); if (!it || quarantine.has(id) || it.steerDispatch === 'started' || it.state === 'sent') return it;
      if (!['empty', 'held', 'failed'].includes(state)) throw new Error('Invalid custody transition');
      Object.assign(it, { state, error, nextAt: 0 }); await put(it); schedule(); return it;
    },
    get recoveryComplete() { return recovered; },
    quarantined(id) { return quarantine.has(id); },
    ownsSeal(key) { return [...items.values()].some(it => it.sealKey === key); },
    nativeItem(id) { return [...items.values()].find(it => it.nativeId === id || it.nativeIds?.includes(id)); },
    async enqueue(o) {
      if (o.conversation || o.kind === 'conversation') return api.sendConversation(o);
      if (o.captureId) { const staged = await api.stage(o); o = { ...o, custodyId: staged.id }; }
      const M = window.WosModels, AG = window.WosAgents;
      const agent0 = o.kind === 'reply' ? (o.agent || window.WizLive?.agentOf?.(o.sessionId) || '') : String(o.agent || '');
      const agent = agent0 && AG?.isOther(agent0) ? agent0 : '';
      let snapshot = o.model ? { model: o.model, provider: o.provider || '' } : null, routeError;
      try { if (!snapshot && o.nativeId) throw new Error('Saved recording model route unavailable · original kept'); snapshot = M?.snapshot(o.kind === 'reply' ? o.sessionId : '', snapshot, agent) || snapshot; }
      catch (e) { routeError = e; }
      await load();
      const held = (o.custodyId && items.get(o.custodyId)) || (o.nativeId && api.nativeItem(o.nativeId));
      const it = held || make({ ...o, agent, ...(snapshot || {}) });
      if (held) {
        if (held.state === 'sent' || held.body || held.steerBody || quarantine.has(held.id)) return held;
        // Preserve the original route/destination/id. Routing is allowed to choose a local command;
        // message delivery always retains the send-time thread and selected provider.
        Object.assign(it, { text: String(o.text || '').trim(), typed: o.typed || it.typed, files: [...(it.files || []), ...(o.files || [])].filter((f, i, all) => all.findIndex(x => x.id === f.id) === i), instructions: o.instructions || it.instructions, wid: o.wid || it.wid });
      }
      await put(it); // own the entire submission even if route discovery fails
      try {
        if (routeError) throw routeError;
        if (!M) throw new Error('Model selector unavailable · reload Wizard before sending');
        const route = await bounded(() => M.resolveRoute(held && it.model ? { model: it.model, provider: it.provider, ...(it.agent ? { agent: it.agent } : {}) } : snapshot), 15000);
        if (it.model && (route.model !== it.model || (it.provider && route.provider !== it.provider))) throw new Error('Selected route changed · original message kept');
        Object.assign(it, route, { state: 'queued' });
        if (it.agent) window.WizLive?.pinAgent?.(it.sessionId, it.agent);
      } catch (e) { it.state = 'failed'; it.error = String(e.message || e); }
      await put(it); pump(); return it;
    },
    retry(id) { const it = items.get(id); if (!it || quarantine.has(id) || it.steerDispatch === 'started' || it.kind === 'dictation' || ['sent', 'unconfirmed', 'sending', 'processing', 'preparing', 'missing', 'held'].includes(it.state)) return; Object.assign(it, { state: 'waiting', threadHidden: false, nextAt: 0, attempts: Math.min(it.attempts || 0, AUTO_TRIES - 1) }); put(it).then(pump); },
    retryAll() { for (const it of items.values()) if (it.kind !== 'dictation' && it.state === 'waiting') Object.assign(it, { state: 'waiting', nextAt: 0, attempts: Math.min(it.attempts || 0, AUTO_TRIES - 1) }); Promise.all([...items.values()].map(put)).then(pump); },
    unsent() { return [...items.values()].filter(it => !['dictation', 'capture'].includes(it.kind) && it.state !== 'sent').sort((a, b) => a.createdAt - b.createdAt); },
    forThread(sessionId, wid) { return [...items.values()].filter(it => !it.compact && !(['empty', 'held', 'sent'].includes(it.state) && it.threadHidden) && !['dictation', 'conversation'].includes(it.kind) && (it.sessionId === sessionId || (wid && it.wid === wid && it.kind === 'new' && it.state !== 'sent'))).sort((a, b) => a.createdAt - b.createdAt); },
    dismissEmpty(id) { return this.get(id)?.state === 'sent' ? Promise.resolve(false) : this.dismissBubble(id); },
    async dismissBubble(id) {
      // Hide only the local presentation; accepted work and original recovery custody stay untouched.
      const it = items.get(id); if (!it || !['empty', 'held', 'sent'].includes(it.state) || quarantine.has(id) || conversationWork.has(id)) return false;
      it.threadHidden = true; await put(it);
      if (!it.durable) { delete it.threadHidden; emit(); return false; }
      return true; // Presentation only: original audio and upload receipt remain recoverable.
    },
    get(id) { return items.get(id) || null; },
    landed(id) { const it = items.get(id); if (it?.state === 'sent') del(id); },
    async remove(id) { const it = items.get(id); if (!it || quarantine.has(id) || ['sending', 'transcribing', 'processing'].includes(it.state)) return false; await del(id); return !!items.get(id)?.durable; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onSent(fn) { sentHooks.add(fn); return () => sentHooks.delete(fn); },
    notice, paintNotice, pump, load, bounded, _items: items, AUTO_TRIES, BACKOFF,
  };
  addEventListener('beforeunload', e => { if ([...items.values()].some(it => it.state !== 'sent' && !it.durable)) { e.preventDefault(); e.returnValue = ''; } });
  addEventListener('online', () => api.retryAll());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { for (const it of items.values()) if (it.state === 'waiting') it.nextAt = 0; pump(); } });
  window.WosOutbox = api;
  load().then(() => schedule(0));
})();
