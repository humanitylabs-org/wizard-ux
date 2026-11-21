/* Wizard UX phone shell › orb voice takes: saved dictation takes and their recovery, keeping the screen on, and
 * which recorder a take uses (native, Wizard Shell or in-page). Moved verbatim out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Loaded just before app.js. The body below keeps app.js's
 * indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.dictation = function ({ $, cancelVoice, CHATS, FIELDS, finishVoice, generalVoiceSnap, onRecStop, OUTBOX, replyTake, sendSnap, startVoice, tick, toast, txHide, V }) {
  let dropHold, pauseCommandCapture, renderVoiceFiles, saveVoiceRoute, sendTapRoute, setVoice, txPill, unseal; // late-bound: app.js declares these after the call, see bindLate
  const DICTATION_KEY = 'wos.dictation-takes.v1';
  const DICTATION_RECOVERY_KEY = 'wos.dictation-recovery.v1';
  function dictationRecovery(id, meta) {
    const rows = JSON.parse(localStorage.getItem(DICTATION_RECOVERY_KEY) || '{}');
    if (meta === false) delete rows[id];
    else if (meta) rows[id] = { ...rows[id], ...meta, id, kind: 'dictation', send: false };
    if (meta !== undefined) localStorage.setItem(DICTATION_RECOVERY_KEY, JSON.stringify(rows));
    return rows;
  }
  window.__wosDictationRecovery = () => { try { return Object.values(dictationRecovery()); } catch (_) { return []; } };
  function dictationTake(id, keep) {
    try {
      const rows = JSON.parse(localStorage.getItem(DICTATION_KEY) || '{}');
      if (keep === true) { rows[id] = true; localStorage.setItem(DICTATION_KEY, JSON.stringify(rows)); }
      if (keep === false) { delete rows[id]; localStorage.setItem(DICTATION_KEY, JSON.stringify(rows)); }
      return rows[id] === true;
    } catch (_) { if (keep) throw new Error('Could not save dictation provenance'); return false; }
  }
  window.__wosDictationTake = id => dictationTake(id) || voiceTake(id)?.kind === 'dictation';
  function startOrbVoice() { return startVoice(FIELDS.refresh() ? 'dictation' : 'auto'); }

  // Keep the screen on while the orb records or transcribes: a screen lock mid-dictation pauses the WebView and loses the take.
  // Native shell (0.5.1+) sets FLAG_KEEP_SCREEN_ON; browsers and PWAs use the Screen Wake Lock API.
  const keepAwake = on => window.WosCaptureTools.awake(on);
  window.__wosAwake = () => window.WosCaptureTools.awakeWanted;
  // Native shell (0.7.0, native parity): the orb records in Android's foreground-service recorder
  // (WizardOSDevice), so a take keeps going with the screen off or the app in the background, and
  // survives an app kill on disk. Browsers/PWAs and older shells keep the in-page MediaRecorder.
  // When James leaves the app mid-take, the floating orb (Everywhere) shows and drives this same take
  // through __wosVoiceCmd below; it never starts a second recorder.
  // Wizard Shell (android/shell): the same recorder surface over wizardDevicePort, only when it offers device.recording.
  const DEV = () => { const d = window.WizardOSDevice; return d && typeof d.recStart === 'function' ? d : window.WosDeviceRecording?.device() || null; };
  function nativeBlob(id, expected) {
    return DEV()?.fetched?.(id)?.blob || window.WosDevice.readRecording(id, expected);
  }
  /* Stop (or claim an already-stopped) native take and hand its audio to the normal pipeline. */
  function nativeTakeAppOwned(id) {
    const shared = window.WizAppCapture?.getState?.();
    if(V.meetingLoan?.native && V.native===id && shared?.voiceBorrow?.id===V.meetingLoan.id) return false;
    const loan=window.WosOrbHandoff?.nativeTake(id);
    if(loan && !shared?.nativeDeviceTakeIds?.includes(id) && (!shared?.active || shared.meetingId===loan.meetingId))return false;
    return !!shared?.active || !!shared?.nativeDeviceTakeIds?.includes(id);
  }
  function pauseNativeTake(on) {
    if (!V.native || nativeTakeAppOwned(V.native)) return false;
    try { if (JSON.parse(DEV()?.recActive?.() || 'null')?.id !== V.native) return false; DEV().recPause(on); return true; } catch (_) { return false; }
  }
  const VOICE_RECOVERY_KEY = 'wos.voice-recovery.v1';
  function voiceRecovery(id, meta) {
    const rows = JSON.parse(localStorage.getItem(VOICE_RECOVERY_KEY) || '{}');
    if (meta === false) delete rows[id];
    else rows[id] = { ...rows[id], ...meta, id, send: false };
    localStorage.setItem(VOICE_RECOVERY_KEY, JSON.stringify(rows));
  }
  window.__wosVoiceRecovery = () => { try { return Object.values(JSON.parse(localStorage.getItem(VOICE_RECOVERY_KEY) || '{}')); } catch (_) { return []; } };
  const nativeFetching = new Set();
  function nativeFinish(id, stopped) {
    if (nativeTakeAppOwned(id)) { setVoice('paused'); toast('🎙', 'This recording belongs to another app'); return; }
    // The shell recorder stops and reads asynchronously: fetch both first, then finish exactly as below.
    const shell = DEV();
    if (shell?.fetch && !shell.fetched(id)) {
      if (nativeFetching.has(id)) return;
      nativeFetching.add(id);
      shell.fetch(id).then(() => { nativeFetching.delete(id); nativeFinish(id, stopped); }, () => {
        nativeFetching.delete(id); V.native = null; setVoice('idle'); txHide(); toast('!', 'Could not read recording · original kept on this phone');
      });
      return;
    }
    // Notification/Everywhere Send enters here directly, bypassing finishVoice. Seal the model before claiming
    // audio or awaiting STT. A recreated page restores the last route saved for this native take.
    if (V.kind === 'dictation' || window.__wosDictationTake(id)) {
      const dev = DEV(); let meta;
      // Preserve a reload-visible exact-ID recovery owner BEFORE a destructive native claim.
      try { dictationRecovery(id, { ms: V.acc, state: 'retained' }); }
      catch (_) { pauseNativeTake(true); setVoice(stopped ? 'idle' : 'paused'); toast('!', 'Storage unavailable · dictation remains on the device'); return; }
      try { meta = stopped ? (JSON.parse(dev.recPending() || '[]').find(t => t.id === id) || window.__wosDictationRecovery().find(t => t.id === id)) : JSON.parse(dev.recStop(id)); } catch (_) {}
      V.native = null; V.kind = 'dictation';
      if (!meta) { setVoice('idle'); txHide(); toast('!', 'Dictation retained · could not read recording'); return; }
      V.acc = Math.max(V.acc, Number(meta.ms) || 0);
      try { dictationRecovery(id, meta); } catch (_) { /* the exact-ID marker above remains durable */ }
      try { return onRecStop(nativeBlob(id, Number(meta.bytes)), id); }
      catch (_) { V.field?.release(); V.field = null; setVoice('idle'); txHide(); toast('!', 'Dictation retained · could not read audio · reopen recording recovery'); return; }
    }
    const hadSnap = !!V.snap;
    const saved = window.__wosVoiceRecovery().find(t => t.id === id);
    const recoveredLoan=window.WosOrbHandoff?.takeSnap(id);
    // A live general take keeps its own start snapshot (window, new chat); only a recovered one is rebuilt (wizard-ux#1218).
    const liveGeneral = hadSnap && V.snap.general && !V.snap.resumed;
    const snap = recoveredLoan ? {...V.snap,...recoveredLoan} : (saved?.general && !liveGeneral ? { ...generalVoiceSnap(), route: window.WosModels.voiceRoute(id) } : V.snap || sendSnap());
    if (saved?.general) { V.kind = 'general'; V.target = null; V.replyTo = null; }
    try {
      const nativePin = saved?.conversation;
      if (!snap.meetingEventId && nativePin && V.target == null && !V.replyTo && V.kind !== 'command') snap.conversation = nativePin; // old token fails closed after shell reload
      else if (!hadSnap) snap.conversation = null; // never infer a recovered native destination from today's focus
      // A live take sent from the recording notification reads the model at that Send too, for its pinned destination
      // (wizard-ux#1218). A take recovered after reload keeps its saved route.
      if (!snap.conversation && hadSnap && !V.snap.resumed) {
        const live = sendTapRoute(snap, V.replyTo || (snap.view?.thread ? { wid: snap.view.id, sid: snap.view.thread } : null));
        if (live?.model && live?.provider) snap.route = live;
      }
      if (!snap.conversation && !(snap.route?.model&&snap.route?.provider)) {
        const pin = V.replyTo || (snap.view?.thread ? { wid: snap.view.id, sid: snap.view.thread } : null);
        snap.route = (!hadSnap && window.WosModels.voiceRoute(id)) || CHATS.modelRoute(pin?.wid, pin?.sid || '');
      }
      if (!snap.conversation && !(snap.route?.model&&snap.route?.provider)) { snap.route = null; window.WosModels.load?.(); throw new Error('Choose a model before sending'); }
      if (!snap.conversation) saveVoiceRoute(id, snap.route); V.snap = snap;
    } catch (e) {
      // The native file remains on disk; no claim, transcription or inference happens on an uncertain route.
      dropHold(); unseal();
      if (JSON.parse(DEV()?.recActive?.() || 'null')?.id === id) { V.native = id; pauseCommandCapture(); }
      else { V.native = null; setVoice('idle'); txHide(); }
      toast('!', 'Recording saved · ' + String(e.message || e), 3200); return;
    }
    const dev = DEV(); let meta = null;
    // recStop in shipped shells implicitly claims. Journal a reload-visible owner before
    // that bridge call; already-stopped takes are read without recClaim.
    try { voiceRecovery(id, { kind: V.kind, ms: V.acc }); }
    catch (_) { pauseNativeTake(true); setVoice(stopped ? 'idle' : 'paused'); toast('!', 'Storage unavailable · recording remains on device'); return; }
    try {
      meta = stopped ? (JSON.parse(dev.recPending() || '[]').find(t => t.id === id) || window.__wosVoiceRecovery().find(t => t.id === id)) : JSON.parse(dev.recStop(id));
      if (meta?.id === id) voiceRecovery(id, meta);
    } catch (e) { meta = null; }
    V.native = null;
    if (!meta || meta.id !== id) { dropHold(); unseal(); setVoice('idle'); txHide(); toast('!', 'Could not read recording · original kept on device'); return; }
    // A shipped kind-less recActive bridge reveals the original mode only after an explicit stop.
    // Preserve command routing even when its older take had no page-side provenance at recovery.
    if (!snap.general && ['auto', 'command', 'dictation'].includes(meta.kind)) V.kind = meta.kind;
    V.acc = Math.max(V.acc, (V.nativeSegmentBase||0)+(Number(meta.ms) || 0));
    try { return onRecStop(nativeBlob(id, Number(meta.bytes)), id); }
    catch (e) { dropHold(); unseal(); setVoice('idle'); txHide(); toast('!', String(e.message || 'Recording retained · could not read audio'), 4000); }
  }
  const releasedTakes = new Set();
  const recDone = id => {
    if (!id || releasedTakes.has(id) || !DEV()?.recDone) return;
    try { DEV().recDone(id); releasedTakes.add(id); window.WosModels.forgetVoiceRoute(id); dictationTake(id, false); dictationRecovery(id, false); voiceRecovery(id, false); } catch (e) {}
  };
  /* The page was reloaded or recreated while the native take kept going: pick the orb back up. */
  // Positive provenance for the shipped kind-less native ABI. Never infer ownership by claiming audio.
  const VOICE_TAKE_KEY = 'wos.voice-take.v1';
  function voiceTake(id, kind) {
    try {
      if (kind) localStorage.setItem(VOICE_TAKE_KEY, JSON.stringify({ id, kind }));
      const row = JSON.parse(localStorage.getItem(VOICE_TAKE_KEY) || 'null');
      return row?.id === id && ['auto', 'command', 'dictation'].includes(row.kind) ? row : null;
    } catch (_) { return null; }
  }
  window.__wosVoiceTake = id => voiceTake(id);
  function nativeResume(a) {
    if (V.state !== 'idle' || !a?.id) return false;
    // Recovery can precede any Chats/model-picker visit, just like a cold first recording.
    // Warm authority now; the exact route still seals at Send and remains fail-closed.
    window.WosModels?.load().catch(() => {});
    const kind = window.__wosDictationTake(a.id) || a.kind === 'dictation' ? 'dictation' : (a.kind || voiceTake(a.id)?.kind) === 'command' ? 'command' : 'auto';
    V.captureEpoch = (V.captureEpoch || 0) + 1;
    V.field?.release(); V.field = null; // page recreation can never reconstruct a DOM capability
    const savedGeneral = window.__wosVoiceRecovery().find(t => t.id === a.id)?.general === true;
    const knownReply = kind === 'dictation' || savedGeneral ? null : replyTake(a.id);
    const prior = knownReply?.custodyId ? OUTBOX.get(knownReply.custodyId) : null, draft = prior?.parkedDraft;
    if (knownReply?.custodyId && (!draft || prior.state !== 'held' || !prior.durable)) return false;
    Object.assign(V, { native: a.id, kind, target: null, resumed: true, snap: window.WosOrbHandoff?.takeSnap(a.id)||null, seal: null, replyTo: knownReply, chunks: [], acc: Number(a.ms) || 0, t0: performance.now(), sim: false, stopAsked: false, sendAsked: false, cancelled: false, an: null, files: [], pickPaused: false });
    V.parts=[];V.custodyCapture=null;V.nativeSegmentBase=0;V.meetingLoan=window.WosOrbHandoff?.forTake(a.id)||null;
    if(draft)Object.assign(V,{parts:draft.parts||[prior.audio],custodyCapture:prior.id,snap:draft.snap,files:draft.files||[],nativeSegmentBase:draft.acc||0,acc:(draft.acc||0)+(Number(a.ms)||0),resumeNative:true,seal:{text:draft.typed||'',files:draft.sealFiles||[],reply:draft.sealReply||null,done:()=>{},putBack:()=>{}}});
    if (savedGeneral && !V.snap?.meetingEventId) { V.kind = 'general'; V.snap = { ...generalVoiceSnap(), route: window.WosModels.voiceRoute(a.id) }; }
    // A take resumed after a reload keeps the route it had; only a take started on this page reads the model at Send (wizard-ux#1218).
    if (V.snap) V.snap = { ...V.snap, resumed: true };
    renderVoiceFiles();
    setVoice(a.paused ? 'paused' : 'listen');
    txPill(a.paused ? '⏸' : '✦', kind === 'dictation' ? 'Dictation kept · tap orb to transcribe & copy' : a.paused ? 'Paused · recording kept · tap orb to resume' : 'Still recording · tap orb to send', kind === 'dictation' ? 'dictation' : 'agent'); txHide(2600);
    V.raf = requestAnimationFrame(tick);
    return true;
  }
  // Tell the native shell what the orb is doing, so leaving WizardOS mid-recording shows the floating orb
  // (timer, Pause, Cancel, tap to send). Never auto-sends: going quiet only ever pauses nothing.
  function voiceElapsed() { return Math.round((V.acc || 0) + (V.state === 'listen' || V.state === 'command' ? performance.now() - (V.t0 || performance.now()) : 0)); }
  function reportVoice(s) {
    try { const n = window.WizardOSNative; if (n && typeof n.appVoice === 'function') n.appVoice(s, voiceElapsed()); } catch (e) {}
  }
  // The floating orb's controls while WizardOS is in the background.
  window.__wosVoiceCmd = cmd => {
    if (V.state !== 'listen' && V.state !== 'paused' && V.state !== 'command') return false;
    if (cmd === 'send') finishVoice();
    else if (cmd === 'cancel') cancelVoice();
    else if (cmd === 'pause') $('#arcPause').click();
    return true;
  };
  return { DEV, dictationTake, keepAwake, nativeBlob, nativeFinish, nativeResume, nativeTakeAppOwned, pauseNativeTake, recDone, reportVoice, startOrbVoice, voiceElapsed, voiceRecovery, voiceTake, bindLate: v => { if ('dropHold' in v) dropHold = v.dropHold; if ('pauseCommandCapture' in v) pauseCommandCapture = v.pauseCommandCapture; if ('renderVoiceFiles' in v) renderVoiceFiles = v.renderVoiceFiles; if ('saveVoiceRoute' in v) saveVoiceRoute = v.saveVoiceRoute; if ('sendTapRoute' in v) sendTapRoute = v.sendTapRoute; if ('setVoice' in v) setVoice = v.setVoice; if ('txPill' in v) txPill = v.txPill; if ('unseal' in v) unseal = v.unseal; } };
};
