/* Wizard UX core: voice capture and transcription, for shells that don't bring their own voice UI.
 * (The phone's orb has its own richer pipeline in app.js: arc controls, holds, aiming at desks.)
 *
 *   const v = WizCore.voice({ onState, onLevel })
 *   v.start()          → begins recording ('listen')
 *   v.finish()         → Promise<{ text, blob, ms }>: stops and transcribes via api/transcribe
 *                        (on failure: { text: '', blob, error }, so the caller can send the recording itself)
 *   v.cancel()         → discards
 *   v.state            → 'idle' | 'listen' | 'think'
 *   v.elapsed()        → ms recorded so far
 */
(() => {
  'use strict';
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
      V.chunks = []; V.t0 = performance.now(); V.cancelled = false; set('listen');
      try {
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('This browser has no microphone access here.');
        V.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (V.cancelled) { stop(); return false; }
        const AC = window.AudioContext || window.webkitAudioContext; V.ac = new AC();
        const src = V.ac.createMediaStreamSource(V.stream); V.an = V.ac.createAnalyser(); V.an.fftSize = 1024; src.connect(V.an);
        const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m)) || '';
        V.rec = new MediaRecorder(V.stream, mime ? { mimeType: mime } : undefined);
        V.rec.ondataavailable = e => { if (e.data && e.data.size) V.chunks.push(e.data); };
        V.rec.start(250); V.raf = requestAnimationFrame(tick);
        return true;
      } catch (e) { stop(); set('idle'); throw e; }
    }
    function cancel() { V.cancelled = true; try { V.rec && V.rec.state !== 'inactive' && (V.rec.onstop = null, V.rec.stop()); } catch (e) {} V.rec = null; stop(); set('idle'); }
    function finish(o = {}) {
      if (V.state !== 'listen') return Promise.resolve(null);
      const ms = performance.now() - V.t0;
      set('think');
      return new Promise(resolve => {
        const done = async () => {
          const blob = new Blob(V.chunks, { type: V.rec?.mimeType || 'audio/webm' });
          V.rec = null; stop();
          if (ms < 450 || blob.size < 1200) { set('idle'); return resolve({ text: '', blob: null, ms, error: 'Didn’t catch that' }); }
          // The durable outbox transcribes and keeps the recording itself: hand it the audio as is.
          if (o.transcribe === false) { set('idle'); return resolve({ text: '', blob, ms }); }
          try {
            const fd = new FormData();
            const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
            fd.append('file', blob, `voice.${ext}`); fd.append('language', 'en');
            fd.append('prompt', opts.prompt || 'Wizard voice. Names: Archimedes, Wizard, Hermes, Mizel, CineQueue, Omarchy.');
            const r = await fetch('api/transcribe', { method: 'POST', body: fd });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
            set('idle'); resolve({ text: String(j.text || '').trim(), blob, ms, sttMs: j.ms });
          } catch (e) { set('idle'); resolve({ text: '', blob, ms, error: String(e.message || e) }); }
        };
        if (!V.rec || V.rec.state === 'inactive') return done();
        V.rec.onstop = done; try { V.rec.stop(); } catch (e) { done(); }
      });
    }
    return { start, finish, cancel, get state() { return V.state; }, elapsed: () => (V.state === 'listen' ? performance.now() - V.t0 : 0) };
  }
  window.WizCore = window.WizCore || {};
  window.WizCore.voice = voice;
})();
