/* Wizard UX submission custody. Keep original bytes until an upload receipt and run receipt.
 * IndexedDB first; complete per-item localStorage backup second; RAM plus a persistent warning last.
 * IDs, destination and model/provider belong to the submission, never to the retrying screen.
 */
(() => {
  'use strict';
  if (document.documentElement.dataset.leaving) return;
  const DB = 'wos-outbox', STORE = 'items', LS = 'wos.outbox.fallback', PREFIX = LS + '.v2.';
  const BACKOFF = [2000, 5000, 15000, 30000, 60000, 120000], AUTO_TRIES = BACKOFF.length;
  // Agent Service allows 180 seconds of STT; leave time for upload/response transit.
  const TRANSCRIBE_TIMEOUT_MS = 195000;
  const J = { 'Content-Type': 'application/json' }, listeners = new Set(), sentHooks = new Set();
  const items = new Map(), writes = new Map(), encodings = new WeakMap();
  const conversationWork = new Map(), transcriptWork = new Map(), removeErrors = new Map();
  // One authority check for explicit retry and automatic delivery. Terminal/ambiguous
  // custody is not a queue. Empty speech requires a per-recording choice, never bulk.
  function eligible(it, states) {
    return !!it && !localCompletions.has(it.id) && !it.localCompleted && !quarantine.has(it.id) && ['new', 'reply'].includes(it.kind) &&
      (it.intent !== 'command' || it.deliveryRequested === true) && it.steerDispatch !== 'started' && states.includes(it.state);
  }
  // An agent-bound message rides on one of that agent's own models: its allowed pick, otherwise its default.
  // A main-agent route that rode along on a staged take (Opus on a Private note) is never sent or rejected as-is.
  function fitAgentRoute(it) {
    const AG = window.WosAgents, a = it?.agent && AG?.get?.(it.agent);
    if (!a?.model || it.body || !AG.allows || !AG.route || (it.model && AG.allows(a, it.model))) return false;
    const r = AG.route(a, ''); if (!r?.model) return false;
    Object.assign(it, { model: r.model, provider: r.provider }); return true;
  }
  function queueRetry(it, states) {
    if (!eligible(it, states)) return false;
    // Claim synchronously before the first persistence await: a double tap cannot
    // reset an in-flight attempt back to waiting and cause a second dispatch.
    Object.assign(it, { state: 'queued', threadHidden: false, nextAt: 0, attempts: Math.min(it.attempts || 0, AUTO_TRIES - 1) });
    put(it).then(pump); return true;
  }
  function wake() {
    for (const it of items.values()) if (eligible(it, ['waiting'])) it.nextAt = 0;
    pump();
  }
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
    // A live recording rewrites its audio every second. Once it is safely stored, those rewrites change nothing
    // anyone shows, so they must not repaint every open chat (the screen looked like it kept refreshing).
    const quiet = it.state === 'capturing' && it.durable === true && !it.storageError;
    const copy = { ...it }; delete copy.durable; delete copy.storageError;
    try {
      await open(); await tx('readwrite', s => s.put(copy));
      it.durable = true; it.storageError = '';
      try { localStorage.removeItem(PREFIX + it.id); } catch (_) {}
    } catch (e) {
      it.storageError = String(e.message || 'Device storage unavailable'); it.durable = false;
      try {
        const { audio, pendingBlobs, ...x } = copy; // file bytes still uploading stay in RAM (the page's own upload)
        if (audio) x.audio64 = await encode(audio);
        if(copy.parkedDraft?.parts){x.parkedDraft={...copy.parkedDraft,parts:undefined,parts64:await Promise.all(copy.parkedDraft.parts.map(async part=>({type:part.type,data:await encode(part)})))};}
        localStorage.setItem(PREFIX + it.id, JSON.stringify(x));
        it.durable = true;
      } catch (_) { /* Keep the entire item and Blob in RAM; the notice stays until custody is durable. */ }
    }
    if (!(quiet && it.durable === true && !it.storageError)) emit();
    return it;
  }
  const localCompletions = new Set();
  function put(it) {
    const current = items.get(it.id);
    if (current?.completion === 'local' && current !== it) return Promise.resolve(current);
    if (!localCompletions.has(it.id)) items.set(it.id, it);
    it.updatedAt = now();
    return serial(it.id, () => {
      const owner = items.get(it.id);
      // A queued storage retry must never resurrect a locally completed take.
      if (owner !== it) return owner || it;
      return persist(it);
    });
  }
  async function del(id) {
    const it = items.get(id); if (!it) return;
    // A tombstone survives an interrupted delete, preventing stale IDB/fallback rows from replaying.
    Object.assign(it, { state: 'sent', sentAt: now(), audio: null, error: '' });
    delete it.parkedDraft; delete it.pendingBlobs; // a deletion tombstone must not retain hidden audio parts
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
  // A successful on-device action is terminal custody, without an agent receipt
  // or onSent notification. Never consume a sealed message or unrelated draft.
  function localCompletable(it) {
    return !!it && !quarantine.has(it.id) && ['new', 'reply', 'dictation'].includes(it.kind) &&
      ['processing', 'held'].includes(it.state) && !it.deliveryRequested && !it.body && !it.steerBody &&
      !it.steerDispatch && !it.runId && !it.parkedDraft && !String(it.typed || '').trim() &&
      !(it.files || []).some(f => f.id !== it.audioFile?.id);
  }
  // A held-orb take is a command, never a message. Earlier builds parked routed commands here as
  // "Delivery not confirmed" or "completion unconfirmed" although nothing was ever due for delivery.
  // Unheard takes (STT failed) and interrupted captures keep their audio; fresh rows (<10 min) may still settle.
  const SETTLED_COMMAND = /^(Command accepted · completion unconfirmed|Delivery not confirmed · original recording kept; not queued for retry|Music didn’t confirm|Command completed · device cleanup failed)/;
  function settledCommand(it) { return it.intent === 'command' && SETTLED_COMMAND.test(String(it.error || '')) && !!String(it.recoveryText || it.text || '').trim() && now() - (it.updatedAt || it.createdAt || 0) > 10 * 60 * 1000; }
  async function completeLocal(id) {
    const it = items.get(id);
    if (!localCompletable(it) || localCompletions.has(id)) return false;
    localCompletions.add(id);
    // Persist a terminal marker before releasing any bytes. A quota/IDB failure
    // keeps the original owner, and never authorizes native acknowledgement.
    const marker = { id, state: 'sent', completion: 'local', compact: true,
      sentAt: now(), updatedAt: now(), createdAt: it.createdAt, sealKey: it.sealKey,
      nativeId: it.nativeId, nativeIds: it.nativeIds, meetingEventId: it.meetingEventId };
    try {
      return await serial(id, async () => {
        if (items.get(id) !== it || !localCompletable(it)) return false;
        await persist(marker);
        if (marker.durable) { items.set(id, marker); emit(); schedule(); return true; }
        Object.assign(it, { state: 'held', localCompleted: true, error: 'Command completed · device cleanup failed; recording kept' });
        await persist(it); schedule(); return false;
      });
    } finally { localCompletions.delete(id); }
  }
  function recover(it, durable = true) {
    // Upgrade pre-flag explicit sends without granting held commands delivery intent.
    // Only enqueue could produce queued/waiting/sending; a sealed admission/steer
    // envelope also proves the old delivery path ran. Keep its exact key/body/route.
    if (it.intent === 'command' && it.deliveryRequested === undefined && ['new', 'reply'].includes(it.kind)) {
      let sealed = false;
      try {
        const body = JSON.parse(it.body || it.steerBody || 'null');
        sealed = !!body && !!it.model && !!it.provider && body.model === it.model && body.provider === it.provider &&
          (body.agent || '') === (it.agent || '') && body.require_model_lock === true &&
          (it.body ? body.session_id === it.sessionId : it.steerTarget === it.steerRunId && !!it.steerRunId);
      } catch (_) {}
      if (['queued', 'waiting', 'sending'].includes(it.state) || (it.state === 'failed' && sealed)) it.deliveryRequested = true;
    }
    if (it.kind === 'conversation' && it.state !== 'sent') { it.state = 'held'; it.error = 'App voice input recording kept · retry original or copy transcript; never sent to Chats'; }
    if (it.kind === 'dictation' && it.state === 'transcribing') it.state = 'held';
    if (it.state === 'capturing') { it.state = 'held'; it.error = 'Interrupted recording · original bytes kept'; }
    if (it.steerDispatch === 'started' && it.state !== 'sent') { it.state = 'unconfirmed'; it.error = unconfirmed; }
    if (it.state === 'sending') it.state = 'waiting';
    // Older builds exhausted durable retries. Revive only identifiable transport
    // failures with delivery authority; an ambiguous steer remains unconfirmed.
    if (it.state === 'failed' && eligible(it, ['failed']) &&
        (/Couldn[’']t reach Wizard|Wizard was unavailable|Request timed out|HTTP (408|425|429)\b/.test(it.error || '') ||
         [408, 425, 429].includes(it.errorStatus) || it.errorStatus >= 500)) {
      it.state = 'waiting'; it.nextAt = 0;
    }
    /* Reload during a voice send (James, 22 Oct 2026: "I have to wait like five, maybe even ten seconds before it lets me
     * reload"). A tap take whose destination and model route were fixed at stage time is handed to the outbox
     * (handOff): a reload no longer waits for upload + transcription, and the new page finishes the same send under
     * the same id (Idempotency-Key). Commands and unsealed routes keep the old interrupted-and-kept behaviour. */
    if (it.state === 'processing' && it.resumeOnReload && resumable(it)) {
      if (!it.text && it.recoveryText) it.text = [String(it.typed || '').trim(), it.recoveryText].filter(Boolean).join('\n\n').slice(0, 64000);
      Object.assign(it, { state: 'queued', deliveryRequested: true, nextAt: 0, resumedAfterReload: true }); delete it.resumeOnReload;
    }
    if (it.state === 'processing' || it.state === 'preparing') { it.state = it.intent === 'command' ? 'held' : 'failed'; it.error = it.intent === 'command' ? 'Interrupted command · original recording kept; not queued to an agent' : 'Interrupted before sending · recording kept. Retry sends to its original destination.'; }
    it.durable = durable;
    const old = items.get(it.id);
    if (!old || (old.state !== 'sent' && (it.state === 'sent' || (it.updatedAt || it.createdAt) > (old.updatedAt || old.createdAt) || (it.steerDispatch === 'started' && (it.updatedAt || it.createdAt) === (old.updatedAt || old.createdAt))))) items.set(it.id, it);
  }
  const resumable = it => !!it && ['new', 'reply'].includes(it.kind) && it.intent !== 'command' && !!it.model && !!it.provider &&
    !!it.audio && !it.parkedDraft && !it.meetingEventId && !it.steerDispatch && !it.body && !it.steerBody && !it.localCompleted;
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
      // Only this version's explicit completion receipt qualifies. Old generic
      // 'handled' labels also covered pending music/app work, so keep those.
      for (const it of [...items.values()]) {
        if (recovered && it.completion === 'local') await put(it); // move fallback receipts into the available primary store
        else if (it.state === 'held' && (it.localCompleted || settledCommand(it))) await completeLocal(it.id);
      }
      emit(); schedule();
    })().finally(() => { if (!recovered) ready = null; });
    return ready;
  }
  class HttpError extends Error { constructor(status, msg, code = '') { super(msg || 'HTTP ' + status); this.status = status; this.code = code; } }
  async function call(path, init = {}) {
    let r;
    try { r = await fetch(path, { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(45000), ...init }); }
    catch (_) { throw new HttpError(0, 'Couldn’t reach Wizard'); }
    if (!r.ok) { let m = ''; try { m = (await r.json()).error || ''; } catch (_) {} throw new HttpError(r.status, typeof m === 'string' ? m : m.message || '', typeof m === 'object' ? m.code || '' : ''); }
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
    try { return (await bounded(signal => window.WizConfig.transcribe(it.audio, { prompt: window.WizConfig.voicePrompt(), signal }), TRANSCRIBE_TIMEOUT_MS)).text; }
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
  /* Attachments sent while still uploading (James, 19 Oct 2026: "Send the message and process it in the
   * background"). The message carries placeholders { id: 'pending:<key>' } (core/uploads.js WizUploads.pending);
   * their bytes are kept with the message (up to PENDING_KEEP_BYTES; bigger ones live with the page's running
   * upload), and delivery swaps each placeholder for its Wizard Files receipt first. A file that can never upload
   * (refused, too large, bytes lost with a closed page) is dropped with a note to the agent, so the words still go. */
  const PENDING_KEEP_BYTES = 25 * 1048576;
  const PEND = () => window.WizUploads?.pending || null;
  const isPendingId = id => typeof id === 'string' && id.startsWith('pending:');
  function keepPending(files) {
    const out = {}; let room = PENDING_KEEP_BYTES;
    for (const f of files || []) {
      if (!isPendingId(f?.id)) continue;
      const b = PEND()?.blobOf(f.id);
      if (b instanceof Blob && b.size <= room) { out[f.id] = b; room -= b.size; }
    }
    return out;
  }
  async function settlePending(it) {
    const list = (it.files || []).filter(f => isPendingId(f?.id));
    if (!list.length) return;
    const P = PEND(); if (!P) throw new HttpError(0, 'Attachments still uploading');
    const missing = [];
    for (const f of list) {
      let got = null;
      try { got = await P.settle(f, it.pendingBlobs?.[f.id]); }
      catch (e) {
        if (!e.permanent) throw new HttpError(Number(e.status) >= 500 ? Number(e.status) : 0, `Attachment still uploading · ${e.message || 'retrying'}`);
        missing.push(`${f.name || 'a file'} (${String(e.message || 'upload refused').replace(/\.$/, '')})`);
      }
      const ref = got?.id ? { id: String(got.id), name: got.name || f.name, mime: got.mime || f.mime, bytes: Number(got.bytes) || f.bytes } : null;
      it.files = (it.files || []).map(x => x.id === f.id ? ref : x).filter((x, i, all) => x && all.findIndex(y => y && y.id === x.id) === i);
      if (it.pendingBlobs) delete it.pendingBlobs[f.id];
      P.forget(f.id);
      await put(it);
    }
    if (missing.length) {
      it.instructions = [`Note from Wizard: ${missing.length === 1 ? 'an attachment' : `${missing.length} attachments`} sent with this message could not be uploaded from the device and ${missing.length === 1 ? 'is' : 'are'} missing: ${missing.join('; ')}. Tell the user so they can attach ${missing.length === 1 ? 'it' : 'them'} again.`, it.instructions].filter(Boolean).join('\n').slice(0, 2000);
      await put(it);
    }
  }
  async function deliver(it) {
    if (it.kind === 'conversation') throw new HttpError(409, 'App voice input messages use explicit conversation delivery only');
    if (fitAgentRoute(it)) await put(it);
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
    await settlePending(it); // attachments sent while still uploading: their receipts, before the run is admitted
    // An agent without file access still hears the voice note: its transcript is the message, and the recording
    // stays in the owner's custody instead of riding along as a file the agent may not open.
    const noFiles = !!it.agent && window.WosAgents?.get?.(it.agent)?.permissions?.files === 'none';
    const fileIds = [...new Set((it.files || []).filter(f => !(noFiles && f.id === it.audioFile?.id)).map(f => f.id).filter(Boolean))];
    // A run the service refused for files was never admitted: rebuild it without the recording.
    if (noFiles && it.body && /agent_files_disabled/.test(it.error || '')) it.body = '';
    if (fileIds.length > 8) throw new HttpError(409, 'Too many attachments including the recording · originals kept');
    const aq = it.agent ? `?agent=${encodeURIComponent(it.agent)}` : '';
    const words = it.text || `Please use the attached ${fileIds.length === 1 ? 'file' : 'files'}.`;
    const input = it.reply && window.WosChat?.reply ? window.WosChat.reply.attach(words, it.reply) : words;
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
        // A typed rejection proves this dispatch was NOT accepted. Only a matching
        // terminal run permits replacing the stale steer with a same-thread turn.
        // Status alone (or missing transcript text) never proves non-acceptance.
        const rejected = e.status >= 400 && e.status < 500 && e.status !== 408;
        it.steerDispatch = rejected ? 'rejected' : 'started';
        await put(it); // crash before reconciliation must never replay ambiguity
        let terminal = false;
        // Hermes forgets a finished run after a while and answers 404 run_not_found; the run lookup below
        // still proves it terminal in this thread, so the message becomes a same-thread turn instead of failing.
        if ((e.status === 409 && e.code === 'run_not_accepting_steer') || (e.status === 404 && e.code === 'run_not_found')) {
          try {
            const r = await call(`/wizard/hermes/v1/runs/${encodeURIComponent(it.steerTarget)}` + aq);
            const run = await r.json();
            terminal = (run.run_id || run.id) === it.steerTarget && run.session_id === it.sessionId &&
              ['completed', 'failed', 'cancelled', 'interrupted', 'expired'].includes(run.status);
          } catch (_) { /* unknown status: keep the rejected message for explicit Retry */ }
        }
        if (terminal) {
          // Freeze from the dispatched envelope, not the current composer/route.
          // Persist the handoff BEFORE admission; a lost receipt now replays only
          // this byte-identical, idempotent new turn, never the rejected steer.
          it.body = JSON.stringify({ ...frozen, session_id: it.sessionId,
            ...(it.instructions ? { instructions: String(it.instructions).slice(0, 2000) } : {}) });
          it.rejectedSteerRunId = it.steerTarget;
          it.steerRunId = ''; delete it.steerBody; delete it.steerTarget;
          await put(it);
        } else {
          it.state = rejected ? 'failed' : 'unconfirmed'; it.error = rejected ? reason(e) : unconfirmed;
          it.attempts = (it.attempts || 0) + 1; it.lastAttemptAt = now();
          it.nextAt = 0; await put(it); return;
        }
      }
      if (receipt) return done(it, { steered: true, steerQueued: receipt.status === 'queued', runId: it.steerTarget });
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
    delete it.audio; delete it.pendingBlobs;
    await put(it);
    for (const fn of sentHooks) try { fn(it, res); } catch (e) { console.error(e); }
  }
  async function attempt(it) {
    it.state = 'sending'; await put(it);
    try { await deliver(it); }
    catch (e) {
      it.attempts = (it.attempts || 0) + 1; it.error = reason(e); it.errorStatus = e.status || 0; it.lastAttemptAt = now();
      // Never silently abandon a transient failure, even with durable custody.
      if (transient(e)) { it.state = 'waiting'; it.nextAt = now() + BACKOFF[Math.min(it.attempts - 1, BACKOFF.length - 1)]; }
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
        const due = [...items.values()].filter(it => eligible(it, ['queued', 'waiting']) && (it.nextAt || 0) <= now()).sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!due) break;
        await attempt(due);
      }
      for (const it of [...items.values()]) if (it.state === 'sent' && !it.compact && it.durable && now() - it.sentAt > 10 * 60e3) await del(it.id);
    } finally { pumping = false; schedule(); }
  }
  function schedule(ms) {
    clearTimeout(timer);
    if (ms == null) {
      const next = [...items.values()].filter(it => eligible(it, ['waiting'])).map(it => it.nextAt || 0);
      if (!recovered || [...items.values()].some(it => it.storageError || !it.durable)) next.push(now() + 5000);
      if ([...items.values()].some(it => eligible(it, ['queued']))) next.push(now());
      if (!next.length) return;
      ms = Math.max(0, Math.min(...next) - now());
    }
    timer = setTimeout(pump, ms);
  }
  const replyOf = o => window.WosChat?.reply?.clean(o?.reply) || null;
  const newSessionId = () => `wizard_${now()}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  function make(o) {
    return { id: o.nativeId ? 'wos-native-' + o.nativeId : 'wos-' + crypto.randomUUID(), createdAt: now(), attempts: 0, state: 'preparing',
      meetingEventId: o.meetingEventId || '', parkedDraft: o.parkedDraft || null, nativeIds: [...new Set([...(o.nativeIds || []), o.nativeId].filter(Boolean))],
      kind: o.kind === 'conversation' ? 'conversation' : o.kind === 'reply' ? 'reply' : 'new', conversation: o.conversation || null, sessionId: o.kind === 'conversation' ? '' : o.sessionId || newSessionId(), steerRunId: o.meetingEventId ? '' : o.steerRunId || '',
      text: String(o.text || '').trim(), typed: o.audio && !String(o.text || '').trim() ? String(o.typed || '').trim() : '', instructions: o.instructions || '', files: (o.files || []).map(f => ({ ...f })),
      audio: o.audio || null, audioType: o.audio?.type || '', model: o.model || '', provider: o.provider || '',
      pendingBlobs: keepPending(o.files), sealKey: o.sealKey || '', nativeId: o.nativeId || '', agent: o.agent || '', wid: o.wid || '', how: o.how || '', intent: o.intent || 'message', deliveryRequested: false, source: o.source || 'chat', title: String(o.text || o.typed || '').slice(0, 60), durable: false,
      // A Notifications Reply: the item, framed after his words only in the message that is delivered (deliver()).
      ...(replyOf(o) ? { reply: replyOf(o) } : {}) };
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
    // Recovery transcription is a read of retained audio, NOT a delivery transition.
    // Keep frozen send text/body, state, receipts and reason unchanged (even unconfirmed).
    async keepTranscript(id, text) { const it = items.get(id); if (!it || it.state === 'sent' || quarantine.has(id)) return; it.recoveryText = String(text || '').trim(); await put(it); },
    transcribingRecording(id) { return transcriptWork.has(id); },
    transcribeRecording(id) {
      if (transcriptWork.has(id)) return transcriptWork.get(id);
      const it = items.get(id);
      if (!it?.audio || quarantine.has(id) || !['held', 'empty', 'failed', 'unconfirmed'].includes(it.state)) return Promise.resolve(null);
      const work = (async () => {
        try { it.recoveryText = String(await transcribe(it) || '').trim(); it.recoveryError = it.recoveryText ? '' : 'No speech detected · original kept'; }
        catch (e) { it.recoveryError = String(e.message || e); }
        await put(it); return it;
      })().finally(() => { transcriptWork.delete(id); emit(); });
      transcriptWork.set(id, work); emit(); return work;
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
      if (prior && (localCompletions.has(prior.id) || prior.localCompleted || quarantine.has(prior.id) || prior.state === 'sent' || prior.body || prior.steerBody)) return prior;
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
    // Hand a staged tap take to the outbox so a reload can finish it (see recover). True once that is on device storage.
    async handOff(id) {
      const it = items.get(id);
      if (!it || it.state !== 'processing' || quarantine.has(id) || localCompletions.has(id) || !resumable(it)) return false;
      if (it.resumeOnReload && it.durable) return true;
      it.resumeOnReload = true; await put(it);
      return !!it.durable && !it.storageError;
    },
    handedOff(id) { const it = items.get(id); return !!it && it.durable === true && !it.storageError && (it.state === 'processing' ? !!it.resumeOnReload : it.state !== 'capturing'); },
    async protect(id) { const it = items.get(id); if (it) await keepAudio(it); return it; },
    // Callers must await this instead of mutating a recovered item only in RAM.
    async transition(id, state, error = '') {
      const it = items.get(id); if (!it || localCompletions.has(id) || quarantine.has(id) || it.steerDispatch === 'started' || it.state === 'sent') return it;
      if (!['empty', 'held', 'failed'].includes(state)) throw new Error('Invalid custody transition');
      Object.assign(it, { state, error, nextAt: 0 }); await put(it); schedule(); return it;
    },
    completeLocal,
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
        if (localCompletions.has(held.id) || held.localCompleted || held.state === 'sent' || held.body || held.steerBody || quarantine.has(held.id)) return held;
        // The delivery caller names the agent (an orb pick); a staged take that lost it must not fall back to the main agent.
        if (agent && !it.agent) { it.agent = agent; if (snapshot) Object.assign(it, snapshot); }
        fitAgentRoute(it);
        // Preserve the original route/destination/id. Routing is allowed to choose a local command;
        // message delivery always retains the send-time thread and selected provider.
        Object.assign(it, { text: String(o.text || '').trim(), typed: o.typed || it.typed, files: [...(it.files || []), ...(o.files || [])].filter((f, i, all) => all.findIndex(x => x.id === f.id) === i), instructions: o.instructions || it.instructions, wid: o.wid || it.wid, ...(replyOf(o) || it.reply ? { reply: replyOf(o) || it.reply } : {}),
          pendingBlobs: { ...(it.pendingBlobs || {}), ...keepPending(o.files) } });
      }
      // Only the delivery caller (including an explicit Send-to-agent choice) may
      // promote a command. Recovery and reconnect never create this authorization.
      it.deliveryRequested = true;
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
    canRetry(it) { return eligible(typeof it === 'string' ? items.get(it) : it, ['failed', 'waiting', 'empty']); },
    retry(id) { return queueRetry(items.get(id), ['failed', 'waiting', 'empty']); },
    retryAll(agent) { let n = 0; for (const it of items.values()) if ((agent === undefined || (it.agent || '') === agent) && queueRetry(it, ['failed', 'waiting'])) n++; return n; },
    retryFeedback(n) { return n ? `Queued ${n === true || n === 1 ? 'retry' : n + ' retries'} · originals kept until confirmed` : 'Nothing eligible to retry · originals kept'; },
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
    async remove(id) {
      // Re-check device storage first: a recovery that clears quarantine makes this an ordinary delete.
      if (quarantine.has(id) && !recovered) await load().catch(() => {});
      const it = items.get(id); removeErrors.delete(id);
      if (!it) { removeErrors.set(id, 'not a recording this page holds'); return false; } // never claim an unknown id
      // A recording with nothing left to deliver: a sent message's leftover audio, or a take with no delivery intent.
      const inert = it.state === 'sent' || (['capture', 'dictation'].includes(it.kind) && !it.deliveryRequested && !it.body && !it.steerBody && !it.steerDispatch);
      // Busy states only block while work is really running in this page; a state left over from an interrupted
      // transcription or send (nothing running) must not make an inert take undeletable.
      const active = transcriptWork.has(id) || conversationWork.has(id);
      if (['sending', 'transcribing', 'processing'].includes(it.state) && (!inert || active)) { removeErrors.set(id, 'it is still being ' + (it.state === 'transcribing' ? 'transcribed' : 'sent')); return false; }
      if (quarantine.has(id) && !inert) { removeErrors.set(id, 'device storage isn’t answering yet'); return false; }
      if (quarantine.has(id)) {
        // Quarantine stops a fallback copy from replaying or overwriting an unreadable primary receipt. The owner's
        // explicit Delete of a recording that never had delivery intent (cancelled/interrupted take, dictation) can
        // do neither: it writes a terminal tombstone, which wins over every other copy on every future recovery.
        // Messages with delivery intent stay quarantined until storage is verified (James, 21 Oct 2026: ten
        // recovered takes refused Delete with "Deletion not saved" while the phone's IndexedDB was unavailable).
        quarantine.delete(id);
      }
      try { await del(id); } catch (e) { removeErrors.set(id, String(e?.message || e)); }
      if (items.get(id)?.durable && !items.get(id)?.storageError) return true;
      if (!inert) { removeErrors.set(id, items.get(id)?.storageError || removeErrors.get(id) || 'device storage refused the write'); return !!items.get(id)?.durable; }
      // Writes are failing (full or broken device storage, 21 Oct 2026: Delete still refused after the quarantine fix).
      // Erase every stored copy instead: deleting frees space where a write cannot. The in-memory tombstone keeps the
      // take from being re-imported this session; with no stored copy left, nothing can bring it back after a reload.
      let erased = false;
      try { await open(); await tx('readwrite', s => s.delete(id)); erased = true; } catch (e) { removeErrors.set(id, String(e?.message || e)); }
      let fallbackClear = true;
      try {
        localStorage.removeItem(PREFIX + id);
        const legacy = JSON.parse(localStorage.getItem(LS) || '[]');
        if (legacy.some(x => x?.id === id)) localStorage.setItem(LS, JSON.stringify(legacy.filter(x => x?.id !== id)));
      } catch (_) { fallbackClear = false; }
      const marker = items.get(id); if (marker) await put(marker).catch(() => {}); // space was just freed: retry the tombstone
      emit();
      if ((erased && fallbackClear) || (items.get(id)?.durable && !items.get(id)?.storageError)) { removeErrors.delete(id); return true; }
      if (!removeErrors.has(id)) removeErrors.set(id, items.get(id)?.storageError || 'device storage refused the delete');
      return false;
    },
    removeError(id) { return removeErrors.get(id) || ''; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onSent(fn) { sentHooks.add(fn); return () => sentHooks.delete(fn); },
    notice, paintNotice, pump, load, bounded, TRANSCRIBE_TIMEOUT_MS, _items: items, AUTO_TRIES, BACKOFF,
  };
  addEventListener('beforeunload', e => { if ([...items.values()].some(it => it.state !== 'sent' && !it.durable)) { e.preventDefault(); e.returnValue = ''; } });
  addEventListener('online', wake);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  window.WosOutbox = api;
  load().then(() => schedule(0));
})();
