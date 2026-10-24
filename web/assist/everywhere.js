/* Battery (14 Oct 2026): at rest the floating orb holds a still frame, like the in-app orb.
   It used to redraw ~12 times a second over every other app whenever the screen was on.
   Touch, listening, thinking and level changes still wake it to full rate. */
window.Orb && Orb.setRestingMotion && Orb.setRestingMotion(false);
const $ = id => document.getElementById(id);
const N = window.EverywhereNative || { log(){} };
const S = { mode: 'idle', ms: 0, t0: 0, paused: false, kb: false };

function fmt(ms) { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
setInterval(() => {
  if (!document.body.classList.contains('live')) return;
  $('timer').textContent = fmt(S.ms + (S.paused ? 0 : performance.now() - S.t0));
}, 250);

/* Called by native. */
const E = window.E = {
  layout() { },
  /* mode: idle | listen | paused | think | done | type (keyboard open, idle) | typing (dictating) */
  state(o) {
    const was = S.mode;
    S.kb = !!o.kb; S.mode = o.mode || 'idle';
    const live = S.mode === 'listen' || S.mode === 'paused' || S.mode === 'typing';
    if (o.carry) { S.ms = +o.ms || 0; S.t0 = performance.now(); S.paused = S.mode === 'paused'; }   // the app's take, shown here
    else {
      if (live && !(was === 'listen' || was === 'paused' || was === 'typing')) { S.ms = 0; S.t0 = performance.now(); S.paused = false; }
      if (S.mode === 'paused' && !S.paused) { S.ms += performance.now() - S.t0; S.paused = true; }
      if (S.mode !== 'paused' && S.paused) { S.paused = false; S.t0 = performance.now(); }
    }
    document.body.classList.toggle('carry', !!o.carry);
    document.body.classList.toggle('paused', S.mode === 'paused');
    document.body.classList.toggle('kb', S.kb || S.mode === 'type' || S.mode === 'typing');
    document.body.classList.toggle('live', live);
    const busy = ['transcribe', 'sending', 'retry'].includes(S.mode);
    document.body.classList.toggle('busy', busy);
    $('processing').setAttribute('aria-label', S.mode === 'retry' ? 'Waiting to retry transcription' : 'Processing recording');
    if (busy) $('timer').textContent = S.mode === 'retry' ? 'retry…' : '•••';
    if (live) $('timer').textContent = fmt(S.ms + (S.paused ? 0 : performance.now() - S.t0));
    Orb.setMode(busy ? 'think' : S.mode);
    if (!live) Orb.setLevel(0);
    const f = +o.failed || 0; $('badge').textContent = f; $('badge').classList.toggle('on', f > 0);
  },
  level(v) { Orb.setLevel(S.paused ? 0 : +v || 0); },
};
N.log('everywhere page ready webgl=' + (window.Orb && Orb.webgl));
