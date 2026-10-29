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

/* Optional thin-shell device.recording controls. Full Android / old hosts retain their own controls.
   The host exposes no start/send/read authority: just v1 pause/resume/cancel for the displayed take. */
(() => {
  'use strict';
  const port = window.wizardOrbPort;
  const cancel = document.getElementById('shellCancel');
  const pause = document.getElementById('shellPause');
  let state = {id: null, state: 'idle'}, pending = '', sequence = 0, timeout;
  const render = () => {
    cancel.disabled = pause.disabled = pending || !state.id;
    pause.textContent = state.state === 'paused' ? 'Resume' : 'Pause';
    pause.setAttribute('aria-label', pause.textContent + ' recording');
  };
  if (!port || typeof port.postMessage !== 'function' || !cancel || !pause) return;
  window.WosShellOrb = {
    v: 1,
    status(value) {
      state = value;
      if (state.state === 'recording' || state.state === 'paused') {
        E.state({mode: state.state === 'paused' ? 'paused' : 'listen', carry: true, ms: state.ms});
      }
      render();
    }
  };
  document.body.classList.add('shell-orb');
  port.onmessage = event => {
    let answer;
    try { answer = JSON.parse(event.data); } catch (_) { return; }
    if (answer.v !== 1 || answer.id !== pending) return;
    clearTimeout(timeout); pending = '';
    if (answer.result) state = answer.result;
    render();
  };
  function command(method, on) {
    if (pending || !state.id) return;
    pending = 'orb-' + (++sequence); render();
    timeout = setTimeout(() => { pending = ''; render(); }, 3000);
    const params = {id: state.id};
    if (method === 'pause') params.on = on;
    port.postMessage(JSON.stringify({v: 1, id: pending, method: 'device.recording.' + method, params}));
  }
  cancel.addEventListener('click', () => command('cancel'));
  pause.addEventListener('click', () => command('pause', state.state !== 'paused'));
  render();
})();
