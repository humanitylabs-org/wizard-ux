/* Wizard UX core: resumable uploads (Agent Service v1, /wizard/v1/uploads).
 *
 * One upload path for every attachment, any size (James, 14 Oct 2026: "handle chat attachments seamlessly behind
 * the scenes instead of rejecting something the user is trying to do"). The file is sent in chunks cut with
 * Blob.slice, so nothing is ever held in memory whole; each chunk is a PATCH carrying Upload-Offset. When the
 * network drops or the Wizard restarts, the client waits (backoff), asks the server where it got to (GET) and
 * carries on from that byte. The server only refuses when the file would not fit on its disk.
 *
 *   WizUploads.supported()                    the box advertises capabilities.resumable_uploads
 *   WizUploads.upload(file, { signal, onProgress(sent, total, state) })
 *        → { id, name, mime, bytes }          the Wizard Files receipt (id works as a wizard_file_id)
 *        state: 'uploading' | 'reconnecting' | 'finishing'
 *   Errors meant for the user carry .user = true (e.g. "Not enough space on your Wizard").
 */
(() => {
  'use strict';
  const MIB = 1048576;
  const MIN_CHUNK = 256 * 1024, MAX_CHUNK = 64 * MIB, DEFAULT_CHUNK = 8 * MIB;
  const STALL_MS = 45000;          // no bytes moving for this long → treat the request as lost and reconcile
  const GIVE_UP_MS = 30 * 60000;   // continuous failure without progress for this long → stop and say so
  const abortErr = () => Object.assign(new Error('Upload cancelled'), { name: 'AbortError' });
  const userErr = (m, extra = {}) => Object.assign(new Error(m), { user: true }, extra);
  const NO_SPACE = 'Not enough space on your Wizard for that file.';
  const sleep = (ms, signal) => new Promise((res, rej) => {
    if (signal?.aborted) return rej(signal.reason || abortErr());
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); rej(signal.reason || abortErr()); }, { once: true });
  });
  /* 1 s, 2 s, 4 s … capped at 30 s, with jitter so many tabs don't hammer a restarting Wizard together. */
  const backoff = n => Math.min(30000, 1000 * 2 ** Math.min(n, 5)) * (0.75 + Math.random() * 0.5);
  const newId = () => 'web-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));

  function supported() {
    const C = window.WizConfig;
    return !!(C && C.raw && C.raw.bootstrap && C.has('resumable_uploads'));
  }
  const base = () => (window.WizConfig && window.WizConfig.endpoint('uploads')) || '/wizard/v1/uploads';

  async function call(method, url, body, signal) {
    let r;
    try {
      r = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', signal,
        headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      if (signal?.aborted) throw signal.reason || abortErr();
      return { status: 0, j: {} };
    }
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j };
  }

  /* One chunk. XHR rather than fetch: only XHR reports upload progress inside a chunk. Never rejects for HTTP
   * statuses; a lost connection resolves as status 0 so the caller reconciles. */
  function patch(url, blob, offset, onBytes, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason || abortErr());
      const x = new XMLHttpRequest();
      let stall = 0, done = false;
      const finish = v => { if (done) return; done = true; clearTimeout(stall); signal?.removeEventListener('abort', stop); resolve(v); };
      const arm = () => { clearTimeout(stall); stall = setTimeout(() => { try { x.abort(); } catch (e) {} finish({ status: 0, j: {} }); }, STALL_MS); };
      const stop = () => { done = true; clearTimeout(stall); try { x.abort(); } catch (e) {} reject(signal.reason || abortErr()); };
      x.open('PATCH', url);
      x.withCredentials = true;
      x.setRequestHeader('Content-Type', 'application/offset+octet-stream');
      x.setRequestHeader('Upload-Offset', String(offset));
      x.upload.onprogress = e => { arm(); onBytes(e.loaded); };
      x.onload = () => {
        let j = {}; try { j = JSON.parse(x.responseText || '{}'); } catch (e) {}
        const h = x.getResponseHeader('Upload-Offset');
        finish({ status: x.status, offset: h == null || h === '' ? NaN : Number(h), j });
      };
      x.onerror = x.ontimeout = () => finish({ status: 0, j: {} });
      x.onabort = () => { if (!done) finish({ status: 0, j: {} }); };
      signal?.addEventListener('abort', stop, { once: true });
      arm();
      x.send(blob);
    });
  }

  const transient = s => s === 0 || s === 408 || s === 425 || s === 429 || s >= 500 && s !== 507;
  /* Plain words for the Agent Service's refusals (server/uploads.mjs); never a bare status for a known code. */
  const TOO_LARGE = 'That file is too large for this Wizard.';
  const words = (s, j = {}) => {
    const e = String(j.error || '');
    if (s === 507 || e === 'insufficient_storage') return NO_SPACE;
    if (e === 'file_too_large' || s === 413) return TOO_LARGE;
    if (e === 'sha256_mismatch' || s === 422) return 'The file changed while uploading · attach it again.';
    if (s === 404 || s === 410) return 'The upload expired on your Wizard · attach the file again.';
    if (e === 'client_upload_id_conflict') return 'That upload clashed with an earlier one · attach the file again.';
    if (s === 400 && j.field === 'bytes') return 'Empty files can’t be attached.';
    return `Upload failed (${s}).`;
  };

  async function upload(file, { signal, onProgress } = {}) {
    const total = file.size, name = file.name || 'upload', mime = file.type || 'application/octet-stream';
    const report = (sent, state) => { try { onProgress && onProgress(Math.min(sent, total), total, state); } catch (e) {} };
    const clientId = newId();
    let fails = 0, lastMove = Date.now();
    const wait = async () => {
      if (Date.now() - lastMove > GIVE_UP_MS) throw userErr('Couldn’t reach your Wizard · the upload stopped. Try attaching again.');
      fails++;
      await sleep(backoff(fails), signal);
    };
    const space = s => { if (s === 507) throw userErr(NO_SPACE, { status: 507, code: 'insufficient_storage' }); };

    // 1) Create (idempotent on client_upload_id, so a retried POST returns the same upload).
    let up;
    for (;;) {
      const r = await call('POST', base(), { client_upload_id: clientId, filename: name, mime, bytes: total }, signal);
      space(r.status);
      if (r.status >= 200 && r.status < 300 && r.j && r.j.upload_id) { up = r.j; break; }
      if (!transient(r.status)) throw userErr(r.status === 404 || r.status === 405 ? `Wizard Files is unavailable (${r.status}).` : words(r.status, r.j), { status: r.status });
      report(0, 'reconnecting');
      await wait();
    }
    const url = `${base()}/${encodeURIComponent(up.upload_id)}`;
    const chunk = Math.max(MIN_CHUNK, Math.min(MAX_CHUNK, Number(up.chunk_bytes) || DEFAULT_CHUNK));
    let offset = Number(up.offset) || 0, status = up.status, receipt = up.file || null;
    let conflicts = 0;
    report(offset, 'uploading');

    // Ask the server where it got to (after a lost request, a restart, a 5xx).
    const reconcile = async () => {
      const r = await call('GET', url, null, signal);
      if (r.status === 200 && Number.isFinite(Number(r.j.offset))) {
        offset = Number(r.j.offset); status = r.j.status; if (r.j.file) receipt = r.j.file;
        return true;
      }
      if (r.status === 404) throw userErr('The upload expired on your Wizard · attach the file again.', { status: 404, code: 'expired' });
      return false;
    };

    for (;;) {
      // 2) Bytes, from the server's offset.
      while (status !== 'complete' && offset < total) {
        const end = Math.min(total, offset + chunk);
        const at = offset;
        const r = await patch(url, file.slice(at, end), at, n => report(at + n, 'uploading'), signal);
        if (r.status === 204 || r.status === 200) {
          offset = Number.isFinite(r.offset) && r.offset >= at ? r.offset : end;
          fails = 0; conflicts = 0; lastMove = Date.now();
          report(offset, 'uploading');
          continue;
        }
        if (r.status === 409 && Number.isFinite(Number(r.j.offset))) {
          // The server has a different byte count (an earlier chunk landed after all, or only partly): resume there.
          if (++conflicts > 20) throw userErr('The upload got out of step with your Wizard · attach the file again.');
          offset = Number(r.j.offset); report(offset, 'uploading');
          continue;
        }
        space(r.status);
        if (r.status === 404) throw userErr('The upload expired on your Wizard · attach the file again.', { status: 404, code: 'expired' });
        if (!transient(r.status)) throw userErr(words(r.status, r.j), { status: r.status, code: r.j.error || 'refused' });
        report(offset, 'reconnecting');
        await wait();
        try { if (await reconcile()) report(offset, 'uploading'); } catch (e) { throw e; }
      }
      // 3) Complete (idempotent): verifies the size and files it in Wizard Files.
      if (receipt && receipt.id) break;
      report(total, 'finishing');
      const r = await call('POST', `${url}/complete`, null, signal);
      if (r.status === 200 || r.status === 201) { receipt = r.j.file || r.j; if (receipt && receipt.id) break; throw new Error('Wizard Files returned an invalid upload receipt.'); }
      if (r.status === 409) { if (!(await reconcile())) await wait(); continue; } // not all bytes there: send the rest
      space(r.status);
      if (!transient(r.status)) throw userErr(words(r.status, r.j), { status: r.status, code: r.j.error || 'refused' });
      report(total, 'reconnecting');
      await wait();
    }
    report(total, 'finishing');
    return { id: String(receipt.id), name: String(receipt.filename || name), mime: String(receipt.mime || mime), bytes: Number(receipt.bytes) || total };
  }

  window.WizUploads = { supported, upload, NO_SPACE };
})();
