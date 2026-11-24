/* Wizard UX phone shell › transcribing a dictation and the quick command (a short tap take is a command).
 * Moved verbatim out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Loaded just before app.js. The body below keeps app.js's
 * indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.transcribe = function ({ FIELDS, OUTBOX, recDone, setVoice, showDictationCopy, toast, txHide, V }) {
  async function transcribeDictation(blobs, nid, captureId = null) {
    const epoch = V.captureEpoch, target = V.field, ms = V.acc;
    const op = V.dictationOp = { blobs, ms, nid, epoch, abort: new AbortController() };
    const live = () => V.captureEpoch === epoch && !V.cancelled && V.dictationOp === op;
    let timer;
    try {
      if (ms < 450 || blobs.reduce((n, b) => n + b.size, 0) < 1200) {
        if (live()) { target?.release(); V.field = null; setVoice('idle'); txHide(); toast('◌', 'No speech detected · nothing inserted'); }
        recDone(nid); return;
      }
      const words = [];
      for (const part of blobs) {
        // WebView can report offline while the configured voice endpoint works.
        // The bounded request below is the evidence; retain audio on real failure.
        const result = await Promise.race([
          window.WizConfig.transcribe(part, { prompt: window.WizConfig.voicePrompt(), language: 'en', signal: op.abort.signal }),
          new Promise((_, reject) => { timer = setTimeout(() => { op.abort.abort(); reject(new Error('Transcription timed out')); }, OUTBOX.TRANSCRIBE_TIMEOUT_MS); }),
        ]);
        clearTimeout(timer);
        if (!live()) return;
        words.push(String(result.text || '').trim());
      }
      const text = words.filter(Boolean).join(' ');
      if (!text) { recDone(nid); target?.release(); V.field = null; setVoice('idle'); txHide(); toast('◌', 'No speech detected · nothing inserted'); return; }
      const inserted = await FIELDS.insert(target, text);
      target?.release(); V.field = null;
      if (!inserted) {
        // Never re-resolve a lost field or use the agent outbox as an audio recovery mechanism.
        const kept = await window.WosCancelled.retainWeb(new Blob(blobs, { type: blobs[0]?.type }), ms, text);
        if (kept) { recDone(nid); if (captureId) await OUTBOX.remove(captureId); }
        if (!live()) return;
        setVoice('idle'); showDictationCopy(text, kept, !!nid);
      } else { recDone(nid); setVoice('idle'); txHide(); }
    } catch (error) {
      if (!live()) return;
      target?.release(); V.field = null;
      const kept = await window.WosCancelled.retainWeb(new Blob(blobs, { type: blobs[0]?.type }), ms);
      if (kept) { recDone(nid); if (captureId) await OUTBOX.remove(captureId); } // otherwise native audio remains on disk
      if (!live()) return;
      setVoice('idle'); txHide();
      toast('!', kept ? 'Dictation retained in Settings → Cancelled recordings · transcribe & copy' : nid ? 'Dictation kept on device · reopen recording recovery to retry' : 'Storage unavailable · kept only while this page stays open · retry saving in Settings', 6000);
    } finally { clearTimeout(timer); if (V.dictationOp === op) V.dictationOp = null; }
  }
  /* Quick command (James, 25 Oct 2026): a tap take shorter than QUICK_MS is a command; longer goes to the agent.
   * Only a plain tap take qualifies: replies pinned to a thread composer, app voice input, general takes, review
   * feedback, captures and takes carrying files or composer text stay messages. A quick take with no command match
   * still goes where a tap take always went (so a short "ship it" in a thread still reaches that thread).
   * Opt-in (Orb switcher settings, default off): the live rule stays "a tap on the orb is a message to the agent". */
  const QUICK_MS = 3000;
  function quickTake(kind, snap, replyTo, target, ms) {
    if (!window.WosOrbSwitcher?.active() || !window.WosOrbSwitcher.get().quickTakes) return false; // Orb switcher › "Short takes run as commands" (off: a tap is always a message)
    if (kind !== 'auto' || replyTo || target != null || !snap || snap.general || snap.conversation || snap.meetingEventId || V.meetingLoan) return false;
    if (snap.seal || V.seal || V.files?.length || snap.view?.review || snap.view?.mode === 'capture') return false;
    return (ms || 0) < QUICK_MS;
  }
  return { QUICK_MS, quickTake, transcribeDictation };
};
