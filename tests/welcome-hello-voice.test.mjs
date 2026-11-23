// Welcome › Say hello by voice (wizard-ux issue 1730): the card has a mic that drives the shell's own dictation, so a
// new owner can speak the first message. The real web/core/welcome.js runs in node:vm (tests/fixtures/welcome-harness.mjs)
// with a fake shell voice: the hooks the shells hand over (dictate, dictateCancel, voice). Real-browser proof on both
// shells with a fake microphone: tests/qa-welcome-hello-voice.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { fakeBox, device } from './fixtures/welcome-harness.mjs';

const read = p => withShellParts(fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const title = d => (/<h2[^>]*>([^<]*)<\/h2>/.exec(d.html()) || [])[1];

// The shell's dictation as Welcome sees it: dictate() starts a take (or stops one), voice() reports its state.
function fakeVoice({ start = true } = {}) {
  const v = { state: 'idle', calls: [], cancels: 0 };
  v.hooks = {
    voice: () => ({ state: v.state, kind: v.state === 'idle' ? '' : 'dictation' }),
    dictate: () => { if (v.refuse) return false; v.calls.push(v.state); if (!start) return false; if (v.state === 'idle') v.state = 'listen'; else if (v.state === 'listen') v.state = 'think'; return true; },
    dictateCancel: () => { v.cancels++; v.state = 'idle'; },
  };
  return v;
}
async function atHello(v, opts = {}) {
  const box = fakeBox({ signedIn: true, firstRun: true }), sent = [];
  const d = device(box, { skins: { list: [{ id: 'nebula', name: 'Nebula', t: {} }], current: 'nebula', set() {} }, send: async t => (sent.push(t), { sessionId: 's1' }), ...opts });
  await d.boot(v ? { ...d.hooks, ...v.hooks } : d.hooks);
  d.ctx.WizConfig.has = cap => cap === 'voice'; // this box has a transcriber (bootstrap capabilities.voice)
  d.press('next');
  assert.equal(title(d), 'Say hello');
  return { d, sent };
}

test('Say hello shows a mic labelled "Speak your first message" when the shell has voice; none without it', async () => {
  const { d } = await atHello(fakeVoice());
  assert.match(d.html(), /<button type="button" class="wl-mic" data-wl="mic" aria-pressed="false" aria-label="Speak your first message"/);
  assert.match(d.html(), /Type or speak your first message to Oscar\./);
  const plain = await atHello(null);
  assert.doesNotMatch(plain.d.html(), /wl-mic/, 'an older shell with no voice hook keeps the plain box');
});

test('tap the mic, speak, tap again: the shell dictates into the box, and Send sends exactly those words', async () => {
  const v = fakeVoice(), { d, sent } = await atHello(v);
  d.press('mic');
  assert.deepEqual(v.calls, ['idle'], 'the first tap starts the shell\'s dictation');
  assert.equal(d.doc.activeElement, d.nodes.textarea, 'the box has focus, so the shell\'s dictation writes into it');
  await d.advance(2000);
  await d.submit(); // Enter while the take is open does nothing: the words land in the box first
  assert.deepEqual(sent, []);
  d.press('mic');
  assert.deepEqual(v.calls, ['idle', 'listen'], 'the second tap stops the take');
  await d.advance(300);
  d.nodes.textarea.value = 'What can you do for me?'; v.state = 'idle'; // the transcriber typed the words
  await d.advance(300);
  assert.ok(d.log().includes('mic:end:listen+think:words'), d.log().join(' '));
  assert.ok(d.W.active, 'speaking never sends by itself: the owner sees the words first');
  await d.submit();
  assert.deepEqual(sent, ['What can you do for me?']);
});

test('the microphone can\'t start (permission denied): a plain message, and typing plus Send still work', async () => {
  const v = fakeVoice(), { d, sent } = await atHello(v);
  d.press('mic'); v.state = 'idle'; // the shell opened the take and the mic refused at once
  await d.advance(2000);
  assert.ok(d.log().includes('mic:end:'), d.log().join(' '));
  d.press('back'); d.press('next'); // repaint: the message is part of the card
  await d.submit('Typed instead');
  assert.deepEqual(sent, ['Typed instead']);
});

test('no voice on this shell right now (dictate says no): it says so plainly, and nothing waits on it', async () => {
  const v = fakeVoice({ start: false }), { d, sent } = await atHello(v);
  d.press('mic');
  assert.ok(d.log().includes('mic:none'));
  await d.submit('Hello');
  assert.deepEqual(sent, ['Hello']);
});

test('a Wizard with no transcriber: the mic says voice is not set up, records nothing, and typing works', async () => {
  const v = fakeVoice(), { d, sent } = await atHello(v);
  d.ctx.WizConfig.has = cap => cap !== 'voice';
  d.press('mic');
  assert.deepEqual(v.calls, [], 'no take is started');
  assert.ok(d.log().includes('mic:no-voice'));
  await d.submit('Hello');
  assert.deepEqual(sent, ['Hello']);
});

test('a Stop tap the shell can\'t take yet (mic still opening) keeps the take; the next tap stops it', async () => {
  const v = fakeVoice(), { d } = await atHello(v);
  d.press('mic'); await d.advance(300);
  v.refuse = true; // the desktop's mic is still opening
  d.press('mic');
  assert.ok(d.log().includes('mic:stop-wait'));
  v.refuse = false;
  d.press('mic');
  assert.deepEqual(v.calls, ['idle', 'listen'], 'the second, accepted Stop reached the shell');
  assert.ok(d.log().includes('mic:stop'));
});

test('Back while listening cancels the take, so it never types into a box that is gone', async () => {
  const v = fakeVoice(), { d } = await atHello(v);
  d.press('mic'); await d.advance(500);
  d.W.back();
  assert.equal(v.cancels, 1);
  assert.equal(title(d), 'Pick a skin');
});

test('both shells hand Welcome their own dictation (no second recorder in Welcome)', async () => {
  const hooks = (file, env) => {
    const s = read(file), a = s.indexOf('window.WosWelcome?.boot({'), b = s.indexOf('} });', a) + 5;
    const ctx = { ...env, window: { WosWelcome: { boot: h => { ctx.h = h; } }, __deeplinkLog: [] } };
    vm.createContext(ctx); vm.runInContext(s.slice(a, b), ctx); return ctx.h;
  };
  // Phone: the orb's startVoice('dictation') into the focused field, finishVoice to stop, cancelVoice on Back.
  const P = { V: { state: 'idle', kind: 'auto' }, calls: [] };
  const phone = hooks('web/app-boot.js', { ...P, APP: {}, FIELDS: { refresh: () => P.field }, startVoice: k => { P.calls.push('start:' + k); P.V.state = 'listen'; P.V.kind = k; }, finishVoice: () => P.calls.push('finish'), cancelVoice: () => P.calls.push('cancel') });
  P.field = null; assert.equal(phone.dictate(), false, 'no focused field: no take');
  P.field = { el: 'box' }; assert.equal(phone.dictate(), true);
  assert.deepEqual({ ...phone.voice() }, { state: 'listen', kind: 'dictation' });
  phone.dictate(); phone.dictateCancel();
  assert.deepEqual(P.calls, ['start:dictation', 'finish', 'cancel']);
  // Desktop: the dictate key's own dictate().
  const D = { calls: [] };
  let opened; const E = { APP: {}, VOICE: { state: 'idle' }, vMode: 'dictate', dictationFinishing: false, welcomeMicStart: null, fields: () => ({ refresh: () => ({}) }),
    dictate: a => { D.calls.push(a || 'toggle'); if (!a && E.VOICE.state === 'idle') { E.VOICE.state = 'listen'; E.vMode = 'dictate'; return new Promise(r => { opened = r; }); } return 'done'; }, findApp: () => null, openApp() {} };
  const desk = hooks('web/desktop/desktop.js', E);
  assert.equal(desk.dictate(), true);
  // Stop while the microphone is still opening: refused (the Welcome keeps listening), never a second dictate().
  assert.equal(desk.dictate(), false);
  assert.deepEqual(D.calls, ['toggle']);
  opened('dictating'); await new Promise(r => setTimeout(r, 0));
  assert.equal(desk.dictate(), true, 'once the mic is open, Stop goes through');
  assert.deepEqual(D.calls, ['toggle', 'toggle']);
  // The Welcome itself records nothing and transcribes nothing.
  const w = read('web/core/welcome.js');
  assert.doesNotMatch(w, /getUserMedia|MediaRecorder|transcribe\(/);
});
