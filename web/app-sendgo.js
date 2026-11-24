/* Wizard UX phone shell › send and go for the orb and the dictation copy. Moved out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Values app.js changes over time (its reassigned lets, like the window list W and the desks) stay in app.js;
 * this code reads and writes them as appVars.<name>, app.js's get/set accessors on the same variables, so every
 * read and write is live. Loaded just before app.js. The body below keeps app.js's indentation so `git log -L` and
 * patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.sendgo = function ({ $, applyLayout, appVars, cancelVoice, CHATS, deskOf, DEV, device, dictationLate, FIELDS, LIVE, nativeFinish, nativeResume, nativeTakeAppOwned, onRecStop, orbLevel, OUTBOX, pauseNativeTake, recDone, returnMeeting, runUtterance, setVoice, toast, tourEv, txHide, txPill, txShow, V, voiceEl }) {
  /* mic: moved to app-mic.js (wizard-ux issue 1665), called once here */
  const { browserBarInset, dropWarm, MIC_OPEN_TIMEOUT_MS, MIC_WARM_MS, micNeverOpened, openRec, stopStream, warmMic, bindLate: micLate } = window.WizCore.appParts.mic({ $, cancelVoice, DEV, device, onRecStop, orbLevel, OUTBOX, returnMeeting, runUtterance, setVoice, toast, tourEv, V });
  /* Send and go for the orb (James, 10 Oct 2026: "it sits at this screen for like 10 seconds… process this in the
   * background, send them back out… allow them to keep using their phone"). The send tap steps a phone thread
   * back to the list at once, like a typed send; transcription, routing and delivery carry on behind the pill
   * above the orb. The snapshot already pins the destination, so leaving can't move the message.
   * Stays put for a hold-command, an aimed desk, a composer-mic reply (already instant), or a composer tray with
   * files (those ride with the words when they land in the thread). */
  function leaveOnSend(snap) {
    const v = snap?.view;
    if (V.kind === 'command' || V.replyTo || V.target != null || v?.kind !== 'chat thread') return false;
    const w = appVars.W[v.id]; if (!w || w.thread !== v.thread) return false;
    // The composer (words, photos, files) was taken at this tap (V.seal) and rides with the take.
    CHATS.saveDraft(v.id);
    if (!CHATS.leaveAfterSend(v.id, v.thread, v.thread === '__new__', 'voice')) return false;
    // ...and the thread is under Working before the list paints, never in Ready (live.js holdSend).
    V.hold = LIVE.holdSend?.(v.thread) || null;
    CHATS.renderChats(w); applyLayout(deskOf(v.id));
    return true;
  }
  // The thread a take is sent into (and whose composer rides with it): a composer-mic take's pinned thread, or the
  // thread open when an orb take started. A held command, or a take aimed at another desk, has none.
  function sealTarget() {
    if (V.replyTo) return { wid: V.replyTo.wid, sid: V.replyTo.sid, box: V.replyTo.box };
    const v = V.snap?.view;
    return V.kind !== 'command' && V.target == null && v?.kind === 'chat thread' && v.thread && appVars.W[v.id] ? { wid: v.id, sid: v.thread, box: v.box } : null;
  }
  /* voicesend: moved to app-voicesend.js (wizard-ux issue 1665), called once here */
  const { dropHold, finishDictation, pauseCommandCapture, recoverDictation, saveVoiceRoute, sendTapRoute, unseal } = window.WizCore.appParts.voicesend({ CHATS, LIVE, nativeFinish, nativeResume, nativeTakeAppOwned, onRecStop, pauseNativeTake, setVoice, txHide, txPill, V });
  dictationLate({ dropHold, pauseCommandCapture, saveVoiceRoute, sendTapRoute, unseal });
  micLate({ pauseCommandCapture });
  function showDictationCopy(text, durable = true, native = false) {
    txShow(text, durable || native ? 'Dictation saved · field changed · nothing sent' : 'Storage unavailable · copy these words before closing', 'dictation', '✎');
    $('#txChips').innerHTML = '<button data-dictation-copy>Copy text</button>';
    $('#txChips [data-dictation-copy]').addEventListener('click', async () => {
      try { if (DEV()?.clip) DEV().clip(text); else await window.WosChat.copyText(text); }
      catch (_) { toast('!', 'Select and copy the saved text'); }
    });
    txHide(0); // keep copy available; Settings retains the same transcript across reloads
    clearTimeout(appVars.txHideT); voiceEl.classList.add('tx');
  }
  /* transcribe: moved to app-transcribe.js (wizard-ux issue 1665), called once here */
  const { QUICK_MS, quickTake, transcribeDictation } = window.WizCore.appParts.transcribe({ FIELDS, OUTBOX, recDone, setVoice, showDictationCopy, toast, txHide, V });
  return { browserBarInset, dropHold, dropWarm, finishDictation, leaveOnSend, MIC_OPEN_TIMEOUT_MS, MIC_WARM_MS, micNeverOpened, openRec, pauseCommandCapture, QUICK_MS, quickTake, recoverDictation, saveVoiceRoute, sealTarget, sendTapRoute, stopStream, transcribeDictation, unseal, warmMic };
};
