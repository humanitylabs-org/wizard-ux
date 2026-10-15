/* Wizard UX core: voice capture and transcription, for shells that don't bring their own voice UI.
 * (The phone's orb has its own richer pipeline in app.js: arc controls, holds, aiming at desks.)
 *
 *   const v = WizCore.voice({ onState, onLevel })
 *   v.start()          → begins recording ('listen')
 *   v.finish()         → Promise<{ text, blob, ms }>: stops and transcribes via api/transcribe
 *                        (on failure: { text: '', blob, error }, so the caller can send the recording itself)
 *   v.cancel()         → keeps takes ≥15 s in the shared cancelled-recordings store
 *   v.state            → 'idle' | 'listen' | 'think'
 *   v.elapsed()        → ms recorded so far
 */
(() => {
  'use strict';
  // Opening a Bluetooth headset's mic flips the headset from music (A2DP) to call mode (HFP):
  // music goes muffled, quiet or drops out while you talk (James, 14 Oct). Record from the
  // computer's built-in mic instead, so headphones keep playing music. A USB/wired mic the
  // user plugged in still wins; no built-in mic → the system default, as before.
  const BLUETOOTH = /bluetooth|bluez|airpods|beats|buds|headset|hands-?free|\bh[fs]p\b|wh-1000|wf-1000|bose|jabra|soundcore|pixel buds/i;
  const BUILT_IN = /built-?in|internal|digital mic|macbook|laptop|analog stereo|front mic|dmic/i;
  const WIRED = /usb|yeti|rode|shure|scarlett|focusrite|audio interface|webcam|brio|c9[0-9]{2}/i;
  async function pickMic() {
    try {
      if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return null; // phones route mics themselves
      const ins = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId && !/^(default|communications)$/.test(d.deviceId));
      if (!ins.some(d => d.label)) return null; // no permission yet: labels hidden
      if (ins.some(d => WIRED.test(d.label) && !BLUETOOTH.test(d.label))) return null;
      const builtIn = ins.find(d => BUILT_IN.test(d.label) && !BLUETOOTH.test(d.label));
      return builtIn ? builtIn.deviceId : null;
    } catch (e) { return null; }
  }
  const BASE = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  async function openMic() {
    const id = await pickMic();
    if (id) {
      try { return await navigator.mediaDevices.getUserMedia({ audio: { ...BASE, deviceId: { exact: id } } }); }
      catch (e) { if (e && e.name === 'NotAllowedError') throw e; } // device vanished: fall back to the default
    }
    return navigator.mediaDevices.getUserMedia({ audio: BASE });
  }
  function voice(opts = {}) {
    const V = { state: 'idle', chunks: [], rec: null, stream: null, ac: null, an: null, t0: 0, raf: 0 };
    const set = st => { V.state = st; try { opts.onState && opts.onState(st); } catch (e) {} };
    const stop = () => {
      try { V.stream && V.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
      try { V.ac && V.ac.close(); } catch (e) {}
      cancelAnimationFrame(V.raf); V.stream = V.ac = V.an = null;
      try { opts.onLevel && opts.onLevel(0); } catch (e) {}
    };
    const tick = () => {
      if (V.an && opts.onLevel) {
        const a = new Uint8Array(V.an.fftSize); V.an.getByteTimeDomainData(a);
        let s = 0; for (let k = 0; k < a.length; k++) { const x = (a[k] - 128) / 128; s += x * x; }
        opts.onLevel(Math.min(1, Math.sqrt(s / a.length) * 4.2));
      }
      if (V.state === 'listen') V.raf = requestAnimationFrame(tick);
    };
    async function start() {
      if (V.state !== 'idle') return false;
      const shared = window.WizAppCapture?.getState?.();
      if (shared?.active || shared?.recording || shared?.hold) throw Object.assign(new Error('Microphone held by ' + (shared.appId || 'another app')), { code: 'busy', appId: shared.appId });
      V.pausedMs = 0; V.pauseAt = 0; V.chunks = []; V.captureId = 'capture-' + crypto.randomUUID(); V.t0 = performance.now(); V.cancelled = false; set('listen');
      try {
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('This browser has no microphone access here.');
        V.stream = await openMic();
        if (V.cancelled) { stop(); return false; }
        const AC = window.AudioContext || window.webkitAudioContext; V.ac = new AC();
        const src = V.ac.createMediaStreamSource(V.stream); V.an = V.ac.createAnalyser(); V.an.fftSize = 1024; src.connect(V.an);
        const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m)) || '';
        V.rec = new MediaRecorder(V.stream, mime ? { mimeType: mime } : undefined);
        const captureId = V.captureId, chunks = V.chunks;
        V.rec.ondataavailable = e => { if (e.data && e.data.size) { chunks.push(e.data); window.WosOutbox?.capture(new Blob(chunks, { type: V.rec?.mimeType || 'audio/webm' }), captureId); } };
        V.rec.start(250); V.raf = requestAnimationFrame(tick);
        return true;
      } catch (e) { stop(); set('idle'); throw e; }
    }
    function cancel() {
      V.cancelled = true; const id = V.captureId; if (id) window.WosOutbox?.transition(id, 'held', 'Cancelled recording · original kept');
      const rec = V.rec, chunks = V.chunks, ms = (V.pauseAt || performance.now()) - V.t0 - (V.pausedMs || 0);
      const keep = () => {
        if (!chunks.length) return;
        const blob = new Blob(chunks, { type: rec?.mimeType || 'audio/webm' });
        if (id) Promise.resolve(window.WosOutbox?.capture(blob, id)).then(() => window.WosOutbox?.transition(id, 'held', 'Cancelled recording · original kept'));
        if (ms >= 15000) window.WosCancelled?.keepWeb(blob, ms, false, '', 'desktop');
      };
      // Capture this take before another recorder can replace V; onstop includes the final chunk.
      try { if (rec && rec.state !== 'inactive') { rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); }; rec.onstop = keep; rec.stop(); } else keep(); } catch (_) { keep(); }
      V.rec = null; stop(); set('idle');
    }
    function finish(o = {}) {
      if (!['listen', 'paused'].includes(V.state)) return Promise.resolve(null);
      const ms = performance.now() - V.t0 - (V.pausedMs || 0) - (V.pauseAt ? performance.now() - V.pauseAt : 0);
      set('think');
      return new Promise(resolve => {
        const done = async () => {
          const blob = new Blob(V.chunks, { type: V.rec?.mimeType || 'audio/webm' });
          V.rec = null; stop();
          if (ms < 450 || blob.size < 1200) { set('idle'); return resolve({ text: '', blob: null, ms, error: 'Didn’t catch that' }); }
          // The durable outbox transcribes and keeps the recording itself: hand it the audio as is.
          if (o.transcribe === false) { set('idle'); return resolve({ text: '', blob, ms, captureId: V.captureId }); }
          try {
            const j = await window.WizConfig.transcribe(blob, { prompt: opts.prompt || window.WizConfig.voicePrompt() });
            set('idle'); resolve({ text: String(j.text || '').trim(), blob, ms, sttMs: j.ms });
          } catch (e) { set('idle'); resolve({ text: '', blob, ms, error: String(e.message || e) }); }
        };
        if (!V.rec || V.rec.state === 'inactive') return done();
        V.rec.onstop = done; try { V.rec.stop(); } catch (e) { done(); }
      });
    }
    function pause() { if (V.state !== 'listen' || V.rec?.state !== 'recording') return false; if (!window.WosCaptureTools.setPaused(V.rec,true)) return false; V.pauseAt = performance.now(); set('paused'); return true; }
    function resume() { if (V.state !== 'paused' || V.rec?.state !== 'paused') return false; if (!window.WosCaptureTools.setPaused(V.rec,false)) return false; V.pausedMs += performance.now() - V.pauseAt; V.pauseAt = 0; set('listen'); V.raf = requestAnimationFrame(tick); return true; }
    return { start, finish, cancel, pause, resume, get state() { return V.state; }, elapsed: () => (['listen','paused'].includes(V.state) ? (V.pauseAt || performance.now()) - V.t0 - (V.pausedMs || 0) : 0) };
  }
  window.WizCore = window.WizCore || {};
  window.WizCore.voice = voice;
  window.WizCore.voice.pickMic = pickMic;
})();
