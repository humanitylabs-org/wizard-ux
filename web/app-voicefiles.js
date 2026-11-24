/* Wizard UX phone shell › the orb's voice state and the files that ride along with a take (picker, uploads,
 * the shape the outbox sends). Moved verbatim out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Loaded just before app.js. The body below keeps app.js's
 * indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.voicefiles = function ({ $, CHATS, device, FIELDS, keepAwake, paintFieldOrb, paintVoiceDestination, reportVoice, toast, tourEv, tx, V, voiceEl }) {
  function setVoice(s) {
    V.state = s; device.dataset.voice = s; tourEv('voice', { state: s }); queueMicrotask(() => window.WosSkinHost?.voice?.(s)); if (s === 'listen' || s === 'idle') V.resumeBlocked = false;
    $('#arcPause small').textContent=s==='paused'?'Resume':'Pause';$('#arcPause').setAttribute('aria-label',s==='paused'?'Resume recording':'Pause recording');
    CHATS.PW?.paintMic((s === 'listen' || s === 'paused') && !!V.replyTo, V.replyTo?.sid || '');
    reportVoice(s);
    keepAwake(s === 'listen' || s === 'paused' || s === 'command' || s === 'think');
    Orb.setMode({ idle: 'idle', listen: 'listen', command: 'command', paused: 'paused', think: 'think', done: 'done', agent: 'agent' }[s] || 'idle');
    voiceEl.classList.toggle('on', s === 'listen' || s === 'paused' || s === 'command');
    voiceEl.classList.toggle('cmd', V.kind === 'command' && s !== 'idle' && s !== 'listen' && s !== 'paused' && s !== 'command');
    voiceEl.setAttribute('aria-hidden', String(s === 'idle'));
    if (s === 'idle') FIELDS.refresh(); else paintFieldOrb();
    paintVoiceDestination();
  }
  // The Auto/Agent toggle is gone: the router always decides (commands run, the rest goes to Archimedes).
  V.route = 'auto';
  // Third arc button: attach a photo or file to this take. It rides along with what you say.
  V.files = [];
  const voicePicker = Object.assign(document.createElement('input'), { type: 'file', multiple: true, hidden: true });
  voicePicker.dataset.voiceFiles='';document.body.appendChild(voicePicker);
  function renderVoiceFiles() {
    const n = V.files.length, b = $('#arcAttach');
    b.disabled = V.kind === 'dictation'; $('#arcScreen').disabled = V.kind === 'dictation';
    b.classList.toggle('has', n > 0); b.classList.toggle('busy', V.files.some(f => f.uploading));
    $('#attachCount').textContent = n ? String(n) : '';
    $('#attachLabel').textContent = V.files.some(f => f.uploading) ? 'Uploading' : n ? (n === 1 ? '1 file' : `${n} files`) : 'Attach';
  }
  const sameTake = files => V.files === files && (V.state === 'listen' || V.state === 'paused');
  function releaseScreenOperation(op) {
    if (V.screenOp !== op) return;
    V.screenOp = null;
    device.classList.remove('capturing-screen');
    $('#arcScreen').disabled = false; $('#arcScreen').classList.remove('busy');
  }
  function cancelTakeFiles() {
    for (const f of V.files || []) f.abort?.abort();
    if (V.screenOp) { const op = V.screenOp; op.abort.abort(); releaseScreenOperation(op); }
  }
  async function uploadVoiceFile(file, files, f) {
    await window.WosCaptureTools.uploadRow(CHATS.uploadFile, file, f, { active: () => sameTake(files) && files.includes(f), changed: renderVoiceFiles });
    if (sameTake(files) && f.error) toast('!', f.error + ' · original file kept; tap Attach to retry', 3200);
  }
  voicePicker.addEventListener('change', async () => {
    const list = [...voicePicker.files], files = V.files; voicePicker.value = '';
    if (!sameTake(files)) return;
    // Every picked file joins the take at once, each tracked with its bytes, so a send before the uploads finish
    // takes them all (James, 27 Oct 2026: picked two images, sent while the second was uploading, only the first
    // arrived). Adding one row per finished upload left later files out of a send that happened in between.
    const rows = list.map(file => {
      const f = { name: file.name, mime: file.type, bytes: file.size, uploading: true, local: file };
      window.WizUploads?.pending?.track(f, file);
      files.push(f); return [file, f];
    });
    if (!rows.length) return;
    renderVoiceFiles();
    // One at a time; a row a send already took (handedOff) still uploads, because its message waits on it.
    for (const [file, f] of rows) {
      if (!f.handedOff && (!sameTake(files) || !files.includes(f))) { f.upSettle?.fail(new Error('Attachment removed')); continue; }
      await uploadVoiceFile(file, files, f);
    }
  });
  $('#arcScreen').addEventListener('click', async () => {
    if (!sameTake(V.files) || $('#arcScreen').disabled) return;
    const files = V.files;
    // Reserve before asynchronous capture so an immediate Send cannot omit the screenshot.
    const f = { name: 'Screenshot', mime: 'image/png', uploading: true };
    files.push(f); renderVoiceFiles();
    const op = { files, abort: new AbortController() }; V.screenOp = op; f.abort = op.abort;
    // Tracked from the reservation: a Send during capture takes it as pending and the shot follows the message.
    const st = window.WizUploads?.pending?.track(f, null);
    const screen = $('#arcScreen'); screen.disabled = true; screen.classList.add('busy');
    const conceal = () => {
      if (V.screenOp !== op || op.abort.signal.aborted) return () => {};
      device.classList.add('capturing-screen');
      return () => { if (V.screenOp === op) device.classList.remove('capturing-screen'); };
    };
    try {
      // The capture adapter conceals chrome only at actual sampling, after the desktop picker returns.
      const file = await window.WosScreenCapture.capture({ signal: op.abort.signal, conceal });
      if (!f.handedOff && (!sameTake(files) || !files.includes(f) || V.screenOp !== op)) { st?.fail(new Error('Screenshot cancelled')); return; }
      Object.assign(f, { name: file.name, mime: file.type, bytes: file.size });
      await uploadVoiceFile(file, files, f);
      if (sameTake(files) && f.id) toast('▣', 'Screenshot attached', 1800);
    } catch (e) {
      st?.fail(e);
      const i = files.indexOf(f); if (i >= 0) files.splice(i, 1);
      if (sameTake(files)) { renderVoiceFiles(); toast('!', e.message || 'Screen capture failed · not attached', 3200); }
    } finally { releaseScreenOperation(op); }
  });
  // The take's files in the shape the outbox sends as wizard_file_ids. One still uploading goes as a pending
  // placeholder (WizUploads.pending) that the outbox swaps for its receipt before delivery.
  const PEND = window.WizUploads?.pending;
  const takeFiles = () => V.files.map(f => PEND ? PEND.ref(f) : (f.id && !f.uploading ? { id: f.id, name: f.name, mime: f.mime, bytes: f.bytes } : null)).filter(f => f && f.id);
  // The take's own files plus the thread composer's (seal), each file once. Never a count cap (James, 6 Nov 2026):
  // only real size limits (upload, inline image budget) apply.
  const withSealFiles = (files, seal) => [...(files || []), ...(seal ? seal.files || [] : [])].filter((f, i, a) => f && f.id && a.findIndex(x => x.id === f.id) === i);
  function txShow(text, label, cls, icon) {
    tx.className = 'transcript ' + (cls || '');
    window.WizBrand.paint($('#txRouteIcon'), icon || '✦');
    $('#txRouteText').innerHTML = label || '';
    $('#txText').textContent = text || '';
    $('#txChips').innerHTML = '';
    voiceEl.classList.add('tx');
  }
  // After the orb is tapped to send, the card shrinks to a one-line pill above the orb
  // ("Sending…" → "Sent to Archimedes") and fades. The words James said never cover the screen;
  // they are already in the thread. Timing/router detail rides in data-detail for diagnostics.
  function txPill(icon, label, cls, detail) {
    tx.className = 'transcript brief ' + (cls || '');
    window.WizBrand.paint($('#txRouteIcon'), icon || '✦');
    $('#txRouteText').textContent = label || '';
    tx.dataset.detail = detail || '';
    $('#txChips').innerHTML = '';
    voiceEl.classList.add('tx');
  }
  const isPill = () => tx.classList.contains('brief');
  return { cancelTakeFiles, isPill, renderVoiceFiles, setVoice, takeFiles, txPill, txShow, uploadVoiceFile, voicePicker, withSealFiles };
};
