/* Wizard UX desktop shell › retained recordings: the card that lists takes kept in the outbox, to send again or
 * discard. Moved verbatim out of desktop/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The desktop shell (desktop/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after
 * it declares them, before anything here can run. Loaded just before desktop/desktop.js. The body below keeps
 * desktop.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.desktopParts = window.WizCore.desktopParts || {};
window.WizCore.desktopParts.recovery = function ({ esc, LIVE, OUTBOX, toast }) {
  // Recovery is a view of the existing outbox, not a second recorder/store/native pipeline.
  const recovery = document.createElement('section');
  recovery.id = 'recordingRecovery'; recovery.className = 'recording-recovery';
  recovery.setAttribute('aria-label', 'Retained recordings'); recovery.hidden = true;
  document.body.appendChild(recovery);
  function recordingMeta(it) {
    const thread = it.kind === 'dictation' ? 'Dictation'
      : it.kind === 'new' ? 'New chat'
      : LIVE?.session?.(it.sessionId)?.title || (it.sessionId ? 'Existing chat' : 'Voice message');
    const at = Number(it.createdAt) || 0;
    const stamp = at ? new Date(at).toLocaleString() : '';
    const bytes = Number(it.audio?.size) || 0;
    const size = bytes ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : '';
    return [thread, stamp, size].filter(Boolean).join(' · ');
  }
  /* The card is the shell's own (Settings' kit: wz-card, wz-button). Discard asks again IN the card, never with the
   * browser's confirm dialog: Wizard for Mac's WKWebView has no confirm panel, so it answered 'no' and Discard did
   * nothing (Miguel, 4 Nov 2026: a no-speech take stuck on screen). A take with no speech offers Discard first. */
  let discardArm = { id: '', at: 0 };
  const discardArmed = id => discardArm.id === id && Date.now() - discardArm.at < 4000;
  function paintRecordings() {
    const focusedDiscard = document.activeElement?.dataset?.recordDiscard;
    const takes = window.WosOutbox?.recordings() || [];
    recovery.hidden = !takes.length;
    recovery.innerHTML = takes.map(it => {
      const empty = it.state === 'empty' && !(it.recoveryText || it.text), armed = discardArmed(it.id);
      const retry = `<button class="wz-button ${empty ? 'quiet' : ''}" data-record-retry="${esc(it.id)}" ${['transcribing', 'sending'].includes(it.state) ? 'disabled' : ''}>${it.kind === 'conversation' ? 'Retry original to app' : OUTBOX.canRetry(it) ? 'Retry send' : 'Transcribe only'}</button>`;
      const discard = `<button class="wz-button ${empty || armed ? 'destructive' : 'quiet'}" data-record-discard="${esc(it.id)}"${armed ? ' data-armed' : ''} ${it.state === 'transcribing' ? 'disabled' : ''}>${armed ? 'Confirm discard' : 'Discard'}</button>`;
      return `<article class="wz-card">
      <strong>${it.kind === 'dictation' ? 'Dictation' : 'Voice recording'} kept</strong>
      <p class="recording-meta">${esc(recordingMeta(it))}</p>
      <p class="recording-why">${esc(it.state === 'transcribing' ? 'Transcribing…' : it.error || ((it.recoveryText || it.text) ? 'Transcript ready · copy it below.' : 'Ready to retry transcription.'))}</p>
      <p class="recording-store" role="status">${esc(it.storageError ? (it.durable ? 'Device save failed · complete backup kept; retrying.' : 'Device save failed · not saved. Keep this tab open; download before reload.') : (it.durable ? 'Saved on this device · available after reload.' : 'Saving recording…'))}</p>
      ${it.recoveryText || it.text ? `<textarea readonly aria-label="Recovered transcript">${esc(it.recoveryText || it.text)}</textarea>` : ''}
      <div class="recording-acts">${empty ? discard : retry}${it.recoveryText || it.text ? `<button class="wz-button quiet" data-record-copy="${esc(it.id)}">Copy transcript</button>` : ''}<button class="wz-button quiet" data-record-download="${esc(it.id)}">Download audio</button>${empty ? retry : discard}</div>
    </article>`;
    }).join('');
    if (focusedDiscard) [...(recovery.querySelectorAll?.('[data-record-discard]') || [])].find(b => b.dataset.recordDiscard === focusedDiscard)?.focus({ preventScroll: true });
  }
  recovery.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const O = window.WosOutbox;
    const id = b.dataset.recordRetry || b.dataset.recordDownload || b.dataset.recordCopy || b.dataset.recordDiscard;
    const it = O.get(id); if (!it) return;
    if (b.dataset.recordRetry) {
      if (it.kind === 'conversation') await O.retryConversation(id);
      else if (O.canRetry(it)) toast('↻', O.retryFeedback(O.retry(id)), 2400); else await O.transcribeRecording(id);
    } else if (b.dataset.recordDownload) {
      if (!(it.audio instanceof Blob) || !it.audio.size) { toast('!', 'Audio is unavailable · keep this tab open', 3200); return; }
      let url = '';
      try {
        url = URL.createObjectURL(it.audio);
        const a = document.createElement('a');
        const ext = /mp4|m4a/.test(it.audioType) ? 'm4a' : /ogg/.test(it.audioType) ? 'ogg' : /wav/.test(it.audioType) ? 'wav' : 'webm';
        a.href = url; a.download = `wizard-recording-${id}.${ext}`; a.rel = 'noopener'; a.hidden = true;
        document.body.appendChild(a); a.click(); a.remove();
        toast('↓', 'Audio download requested · check Downloads', 2600);
      } catch (error) {
        console.error('Retained recording download failed', error);
        toast('!', 'Audio download failed · recording is still kept', 3200);
      }
      if (url) setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else if (b.dataset.recordCopy) {
      try { await navigator.clipboard.writeText(it.recoveryText || it.text); toast('📋', 'Transcript copied · recording kept until you discard it', 2600); }
      catch (e) { toast('!', 'Select and copy the transcript above', 2600); }
    } else if (b.dataset.recordDiscard) {
      if (!discardArmed(id)) { discardArm = { id, at: Date.now() }; paintRecordings(); setTimeout(() => { if (discardArm.id === id && !discardArmed(id)) { discardArm = { id: '', at: 0 }; paintRecordings(); } }, 4100); return; }
      discardArm = { id: '', at: 0 }; b.disabled = true; b.textContent = 'Discarding…';
      let ok = false; try { ok = await O.remove(id); } catch (_) {}
      paintRecordings();
      toast(ok ? '✕' : '!', ok ? 'Recording discarded' : `Not discarded · ${O.removeError?.(id) || 'try again'}`, ok ? 1800 : 3200);
    }
  });
  window.WosOutbox?.onChange(paintRecordings);
  window.WosOutbox?.load().then(paintRecordings);
  return {  };
};
