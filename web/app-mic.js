/* Wizard UX phone shell › the microphone for a take: the browser bar inset, a mic that never opened, a mic the
 * system took away, and the pre-warmed mic for hold-for-command. Moved verbatim out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Loaded just before app.js. The body below keeps app.js's
 * indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.mic = function ({ $, cancelVoice, DEV, device, onRecStop, orbLevel, OUTBOX, returnMeeting, runUtterance, setVoice, toast, tourEv, V }) {
  let pauseCommandCapture; // late-bound: app.js declares these after the call, see bindLate
  /* A browser tab (not the installed app) can draw its own toolbar over the bottom of the page: iPhone Safari's bottom
   * bar does, and only the visual viewport knows it. The dock, the orb and its Cancel/Pause controls would then sit
   * under the toolbar, where taps go to Safari and the orb looks frozen. Lift everything above the visible bottom
   * (--vv-b feeds --safe-b). Never while typing: the keyboard also shrinks the visual viewport and the composers
   * handle it themselves. Installed apps and the native shells have no browser bar, so this stays 0 there. */
  function browserBarInset() {
    const vv = window.visualViewport, root = document.documentElement;
    const mm = q => { try { return matchMedia(q).matches; } catch (e) { return false; } };
    if (!vv || navigator.standalone === true || mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)') || DEV() || window.WizardOSNative) return;
    let cur = 0;
    const set = v => {
      if (v === cur) return;
      cur = v; root.style.setProperty('--vv-b', v + 'px'); root.dataset.browserBar = v ? String(v) : '';
      window.__vvLog = (window.__vvLog || []).concat('vv-b:' + v).slice(-20);
    };
    // A browser bar covers 6–160 px. Anything taller is the on-screen keyboard, which the composers handle
    // themselves: then no bar inset at all, so the keyboard is never mistaken for a bar and no stale bar height stays
    // on top of it. Measured by size, not focus: a focused field with a hardware keyboard still has Safari's bar.
    const BAR_MAX = 160;
    const apply = () => {
      const shown = vv.offsetTop + vv.height, bottom = device.getBoundingClientRect().bottom;
      const cover = Math.round(bottom - shown);
      set(cover > 6 && cover <= BAR_MAX ? cover : 0);
    };
    vv.addEventListener('resize', apply); vv.addEventListener('scroll', apply); addEventListener('resize', apply);
    addEventListener('focusout', () => setTimeout(apply, 350)); addEventListener('orientationchange', () => setTimeout(apply, 350));
    apply();
  }
  // The microphone never opened for this take (no answer from the browser, or a second tap before it did): end the
  // take, keep nothing (nothing was recorded) and say why where the person is looking (the tour hides toasts).
  const MIC_OPEN_TIMEOUT_MS = 8000;
  async function micNeverOpened(why) {
    if (V.rec || V.native || V.state === 'idle') return;
    window.__voiceLog = (window.__voiceLog || []).concat('mic-never-opened:' + why).slice(-20);
    // A microphone borrowed from a browser meeting goes straight back: nothing was recorded, so no recording custody
    // (cancelVoice would otherwise keep an empty "cancelled meeting interruption"). returnMeeting keeps the loan and
    // says so when the return fails; the take then stays, and the next tap tries the return again.
    if (V.meetingLoan && !V.parts.length && !(V.chunks || []).length) {
      // First invalidate the capture still opening, so a microphone that opens during the handoff is stopped at once
      // (openRec checks the epoch) and never becomes a live recorder behind the stop gesture.
      V.captureEpoch = (V.captureEpoch || 0) + 1;
      await returnMeeting({ status: 'cancelled' });
      if (V.meetingLoan) { tourEv('voicefail', { text: 'The microphone didn’t start, and the meeting still has it. Tap the orb to try again.' }); return; }
      if (V.rec || V.native || V.state === 'idle') return;
    }
    cancelVoice(true);
    const text = why === 'timeout' ? 'The microphone didn’t start. Allow it for this site, then tap the orb again.' : 'The microphone didn’t start, so nothing was recorded. Tap the orb to try again.';
    toast('🎙', text, 5200); tourEv('voicefail', { text });
  }
  $('#txChips').addEventListener('click', e => { const b = e.target.closest('[data-sim]'); if (!b) return; const k = V.kind; cancelVoice(true); runUtterance(b.dataset.sim, k); });
  // Only a tap (or Cancel) ends a take. If Android takes the mic away (a call, another app, the system), the
  // part recorded so far is kept and the take pauses: tap the orb to send it, or Pause to carry on recording.
  async function browserMicIsExternal() {
    const d = window.WizardOSDevice; if (!d || typeof d.micRoute !== 'function') return false;
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 120));
      let v = 'unknown'; try { v = String(d.micRoute()); } catch (_) { return false; }
      if (v === 'external') return true;
      if (v !== 'unknown') return false;
    }
    return false;
  }
  async function openMic() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: micAudio() });
    // The phone's own mic only (18 Oct 2026): a take Android puts on a Bluetooth or external mic is refused.
    if (await browserMicIsExternal()) { stream.getTracks().forEach(t => t.stop()); const e = new Error("Android moved the microphone to a Bluetooth or external device. Wizard records only from the phone's own mic. Try again, or choose another mic in Settings → Microphone."); e.code = 'external_mic'; throw e; }
    micGranted = true;
    return stream;
  }
  // Phones (ux#1705): echo cancellation, noise suppression or auto gain make Android/iOS open the mic as a voice
  // call, which pauses or ducks music from other apps and drops Bluetooth earbuds to call quality. All three off there.
  function micAudio() {
    const ua = String(navigator.userAgent || '');
    const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
    return phone ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 } }
      : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  }
  /* Pre-warmed microphone (Miguel, 31 Oct 2026: hold-for-command was slow to really listen). A press held still on the
   * orb for MIC_WARM_MS opens the browser mic while the hold is still deciding, so by the time a hold becomes a command
   * (or a slow tap becomes a message) the stream is already open and recording starts at once: the iPhone's
   * getUserMedia (often 300-800 ms) leaves the critical path. Tap and hold mean exactly what they did; only the mic
   * opens sooner. Never a permission prompt (only once the mic is known to be allowed), never with the native
   * recorder, and released as the press ends unless that press started a take. */
  const MIC_WARM_MS = 90;
  let micGranted = false, MW = null;
  try { navigator.permissions?.query?.({ name: 'microphone' })?.then(p => { micGranted = micGranted || p.state === 'granted'; p.onchange = () => { micGranted = p.state === 'granted'; }; }, () => {}); } catch (_) {}
  function warmMic() {
    if (MW || V.state !== 'idle' || !micGranted || DEV() || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return;
    // an app or meeting holding the mic is handed over by startVoice (WosOrbHandoff) first: never open a second stream
    const shared = window.WizAppCapture?.getState?.(); if (V.admitting || shared?.active || shared?.recording || shared?.hold) return;
    const w = MW = { p: openMic() };
    w.p.catch(() => { if (MW === w) MW = null; });
  }
  // The take opening now takes the warm stream (synchronously, before its first await); a press that ends any other way drops it.
  function takeWarm() { const w = MW; MW = null; return w ? w.p : null; }
  function dropWarm() { const w = MW; MW = null; if (w) w.p.then(s => s.getTracks().forEach(t => t.stop()), () => {}); }
  async function openRec(epoch = V.captureEpoch) {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('nomic');
    const stream = await (takeWarm() || openMic());
    if (epoch !== V.captureEpoch || V.cancelled || V.state === 'idle') { stream.getTracks().forEach(t => t.stop()); return false; }
    V.stream = stream;
    const AC = window.AudioContext || window.webkitAudioContext; V.ac = new AC();
    const src = V.ac.createMediaStreamSource(V.stream); V.an = V.ac.createAnalyser(); V.an.fftSize = 1024; src.connect(V.an);
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m)) || '';
    const rec = V.rec = new MediaRecorder(V.stream, mime ? { mimeType: mime } : undefined);
    V.mime = rec.mimeType || mime || 'audio/webm';
    const captureId = V.custodyCapture || (V.custodyCapture = 'capture-' + crypto.randomUUID());
    window.WosOrbHandoff?.bind(V.meetingLoan,captureId,V.snap);
    rec.ondataavailable = e => { if (epoch === V.captureEpoch && !V.cancelled && e.data && e.data.size) { V.chunks.push(e.data); const parts=[...V.parts,new Blob(V.chunks,{type:rec.mimeType||V.mime})];OUTBOX.capture(new Blob(parts, { type: rec.mimeType || V.mime || 'audio/webm' }), captureId,parts); } };
    rec.onstop = () => { if (epoch !== V.captureEpoch || V.cancelled) return; return V.state === 'think' ? onRecStop() : onRecInterrupted(rec); };
    // A track ended by the system stops the recorder too; onstop handles it.
    V.stream.getAudioTracks().forEach(tr => tr.addEventListener('ended', () => { try { rec.state !== 'inactive' && rec.stop(); } catch (e) {} }));
    rec.start(250);
    if (V.state === 'paused' || (V.stopAsked && V.kind === 'command')) pauseCommandCapture();
    return true;
  }
  function onRecInterrupted(rec) {
    if (V.cancelled || V.rec !== rec || (V.state !== 'listen' && V.state !== 'paused' && V.state !== 'command')) return;
    if (V.chunks.length) V.parts.push(new Blob(V.chunks, { type: V.mime || 'audio/webm' }));
    V.chunks = [];
    if (V.state !== 'paused') V.acc += performance.now() - V.t0;
    stopStream(); V.rec = null; orbLevel(0);
    setVoice('paused');
    $('#txRouteText').textContent = V.kind === 'dictation' ? 'Dictation interrupted · kept · tap orb to transcribe' : 'Mic interrupted · kept · tap the orb to send';
    toast('⏸', 'Mic interrupted · your recording is kept');
  }
  function stopStream() { try { V.stream && V.stream.getTracks().forEach(t => t.stop()); } catch (e) {} try { V.ac && V.ac.close(); } catch (e) {} V.stream = null; V.ac = null; V.an = null; }
  return { browserBarInset, dropWarm, MIC_OPEN_TIMEOUT_MS, MIC_WARM_MS, micNeverOpened, openRec, stopStream, warmMic, bindLate: v => { if ('pauseCommandCapture' in v) pauseCommandCapture = v.pauseCommandCapture; } };
};
