// Stuck orb in iPhone Safari (Miguel, 26 Oct 2026): he tapped the orb, the take started, and a second tap did nothing;
// his later takes never reached the box. When the browser has not opened the microphone yet (getUserMedia still
// unanswered, as iPhone Safari can leave it), the old finishVoice() only set a latch and returned: the orb kept
// "listening" and nothing on screen answered. These run the real phone-shell functions from web/app.js in node:vm.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');
const TOUR_CSS = readFileSync(new URL('../web/core/tour.css', import.meta.url), 'utf8');
const fn = (start, end) => { const a = APP.indexOf(start); assert.ok(a >= 0, start + ' exists'); return APP.slice(a, APP.indexOf(end, a)); };

function shell(V) {
  const calls = [];
  const ctx = vm.createContext({
    V, parking: false, window: {}, performance: { now: () => 1000 }, console,
    sendSnap: () => ({ view: null, route: { model: 'm', provider: 'p' } }),
    sealTarget: () => null, CHATS: { modelRoute: () => ({ model: 'm', provider: 'p' }), takeComposer: () => ({}) },
    leaveOnSend: () => calls.push('leaveOnSend'), toast: (i, t) => calls.push('toast:' + t), tourEv: (type, d) => calls.push('tour:' + type + ':' + (d?.text || '')),
    cancelVoice: q => { calls.push('cancel:' + !!q); V.state = 'idle'; }, setVoice: s => { calls.push('setVoice:' + s); V.state = s; },
    txPill: () => {}, onRecStop: () => calls.push('onRecStop'), pauseCommandCapture: () => calls.push('pause'), finishDictation: () => calls.push('dictation'),
    nativeFinish: () => calls.push('nativeFinish'), saveVoiceRoute() {}, shock() {},
  });
  // finishVoice as shipped, plus the helper it calls (absent on the old code, where the latch path never reaches it).
  vm.runInContext(fn('  function finishVoice() {', '  async function cancelVoice(') + '\n' +
    (APP.includes('  function micNeverOpened(') ? fn('  function micNeverOpened(', "  $('#txChips').addEventListener") : 'function micNeverOpened() {}'), ctx);
  return { ctx, calls };
}

test('a second tap while the microphone has not opened ends the take visibly (never a silent latch)', () => {
  const V = { state: 'listen', kind: 'auto', rec: null, native: null, parts: [], chunks: [], snap: null, files: [] };
  const { ctx, calls } = shell(V);
  ctx.finishVoice();
  assert.ok(calls.includes('cancel:true'), 'the take is cancelled: ' + JSON.stringify(calls));
  assert.equal(V.state, 'idle', 'the orb is back to idle and takes the next tap');
  assert.ok(calls.some(c => /^toast:The microphone didn’t start/.test(c)), 'a visible message says why');
  assert.ok(calls.some(c => /^tour:voicefail:The microphone didn’t start/.test(c)), 'the first-run tour hears it too (it hides toasts)');
  assert.ok(!calls.includes('leaveOnSend'), 'nothing was recorded, so nothing navigates as if it was sent');
});

test('a borrowed meeting microphone goes straight back, with no empty recording kept (Codex P2 on #567)', () => {
  const loan = { id: 'event-1' };
  const V = { state: 'listen', kind: 'auto', rec: null, native: null, parts: [], chunks: [], snap: null, files: [], meetingLoan: loan };
  const { ctx, calls } = shell(V);
  const ended = [];
  ctx.window.WosOrbHandoff = { end: (l, o) => { ended.push([l, o]); return Promise.resolve(); } };
  let loanAtCancel = 'unset';
  ctx.cancelVoice = q => { loanAtCancel = V.meetingLoan; calls.push('cancel:' + !!q); V.state = 'idle'; };
  ctx.finishVoice();
  assert.equal(loanAtCancel, null, 'cancelVoice no longer sees the loan, so it keeps no recording custody');
  return Promise.resolve().then(() => Promise.resolve()).then(() => {
    assert.equal(ended.length, 1); assert.equal(ended[0][0], loan); assert.equal(ended[0][1].status, 'cancelled', 'the loan is returned as cancelled');
    assert.ok(calls.includes('cancel:true'));
  });
});

test('a held command released before the microphone opens keeps its latch (unchanged)', () => {
  const V = { state: 'command', kind: 'command', rec: null, native: null, parts: [], chunks: [], snap: null, files: [] };
  const { ctx, calls } = shell(V);
  ctx.finishVoice();
  assert.ok(!calls.includes('cancel:true'), JSON.stringify(calls));
  assert.equal(V.stopAsked, true);
});

test('a take that is really recording still sends on the second tap (unchanged)', () => {
  const rec = { state: 'recording', stopped: 0, stop() { this.stopped++; } };
  const V = { state: 'listen', kind: 'auto', rec, native: null, parts: [], chunks: [], snap: null, files: [], t0: 0, acc: 0 };
  const { ctx, calls } = shell(V);
  ctx.finishVoice();
  assert.equal(rec.stopped, 1); assert.ok(calls.includes('setVoice:think')); assert.ok(!calls.includes('cancel:true'));
});

test('a microphone request the browser never answers times out into the same visible end', () => {
  const start = fn('  async function startVoice(', '  async function openRec(');
  assert.match(start, /const micWatch = setTimeout\(\(\) => \{[^}]*micNeverOpened\('timeout'\)/, 'startVoice arms a watchdog');
  assert.match(start, /clearTimeout\(micWatch\)/, 'and clears it once the microphone opens or fails');
  assert.match(APP, /const MIC_OPEN_TIMEOUT_MS = \d{4,5};/);
  const V = { state: 'listen', kind: 'auto', rec: null, native: null, parts: [] };
  const { ctx, calls } = shell(V);
  ctx.micNeverOpened('timeout');
  assert.ok(calls.some(c => /^toast:The microphone didn’t start\. Allow it for this site/.test(c)), JSON.stringify(calls));
  assert.equal(V.state, 'idle');
});

test('a browser bar over the bottom of the page lifts the dock, orb and Cancel above it (visual viewport)', () => {
  assert.match(CSS, /--safe-b: calc\(env\(safe-area-inset-bottom, 0px\) \+ var\(--vv-b, 0px\)\);/);
  const body = fn('  function browserBarInset() {', '  // The microphone never opened');
  const listeners = {}, vvl = {}, style = {};
  const vv = { offsetTop: 0, height: 659, addEventListener: (t, f) => (vvl[t] = f) };
  const root = { style: { setProperty: (k, v) => (style[k] = v) }, dataset: {} };
  const ctx = vm.createContext({
    window: { visualViewport: vv }, navigator: {}, matchMedia: () => ({ matches: false }), DEV: () => null,
    document: { documentElement: root, activeElement: null }, device: { getBoundingClientRect: () => ({ bottom: 659 }) },
    addEventListener: (t, f) => (listeners[t] = f), setTimeout: f => f(), innerHeight: 659,
  });
  vm.runInContext(body + '\nbrowserBarInset();', ctx);
  assert.equal(style['--vv-b'], undefined, 'nothing covers the page: no lift');
  vv.height = 579; vvl.resize();
  assert.equal(style['--vv-b'], '80px', 'Safari\'s bottom bar covers 80 px: everything lifts by 80 px');
  ctx.document.activeElement = { tagName: 'TEXTAREA' }; vv.height = 300; vvl.resize();
  assert.equal(style['--vv-b'], '0px', 'typing: the keyboard replaces the bar, so no bar inset stays on top of the keyboard handling (Codex P2 on #567)');
  vv.height = 579; vvl.resize(); assert.equal(style['--vv-b'], '0px', 'still typing: never re-lifted');
  ctx.document.activeElement = null; vvl.resize();
  assert.equal(style['--vv-b'], '80px', 'keyboard gone, the bar is back: lift again');
  vv.height = 659; vvl.resize();
  assert.equal(style['--vv-b'], '0px');
  // Installed app (standalone) and the native shells have no browser bar.
  const st = {}; const c2 = vm.createContext({ window: { visualViewport: { ...vv, height: 500, addEventListener() {} } }, navigator: { standalone: true }, matchMedia: () => ({ matches: false }), DEV: () => null,
    document: { documentElement: { style: { setProperty: (k, v) => (st[k] = v) }, dataset: {} }, activeElement: null }, device: { getBoundingClientRect: () => ({ bottom: 659 }) }, addEventListener() {}, setTimeout: f => f(), innerHeight: 659 });
  vm.runInContext(body + '\nbrowserBarInset();', c2);
  assert.deepEqual(st, {});
  assert.match(APP, /buildDesks\(\); setVoice\('idle'\); armBack\(\);\n  browserBarInset\(\);/, 'runs at boot');
});

test('during a take in the first-run tour, the orb and its controls sit above everything the tour draws', () => {
  const z = sel => Number((TOUR_CSS.match(new RegExp('\\.device\\.touring:is\\(\\[data-voice="listen"\\], \\[data-voice="paused"\\], \\[data-voice="command"\\]\\) ' + sel + ' \\{ z-index: (\\d+); \\}')) || [])[1]);
  assert.ok(z('#dock') > 90 && z('#voice') > z('#dock'), 'dock above the tour, the Cancel/Pause arcs above the dock (as without the tour)');
  assert.match(TOUR_CSS, /^\.tour \{ position: absolute; inset: 0; z-index: 90; pointer-events: none;/m);
});
