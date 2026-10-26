// First-run tour (web/core/tour.js). Miguel 24 Oct 2026: no "Command" beat, and every beat can be skipped on its own
// ("Skip this step") while "Skip tour" still ends the whole thing. Miguel 26 Oct 2026: three beats, each labelled
// "Step N of 3": Talk, Reply (open Chats, type a reply), Done (his approved words). No Hide and no Install beat. Runs the real tour.js in node:vm against a tiny DOM stand-in and drives it the way the shell does
// (WosTour.event, taps on the tour's own buttons).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../web/core/tour.js', import.meta.url), 'utf8');

function mk() {
  const kids = new Map(), set = new Set();
  return {
    dataset: {}, style: { setProperty(k, v) { this[k] = v; } }, innerHTML: '', textContent: '', hidden: false, offsetWidth: 1, _l: {},
    classList: { add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)), contains: c => set.has(c),
      toggle: (c, on) => { if (on === undefined) on = !set.has(c); if (on) set.add(c); else set.delete(c); return on; } },
    setAttribute() {}, appendChild: c => c, remove() {}, focus() {}, blur() {},
    addEventListener(t, f) { (this._l[t] ||= []).push(f); },
    querySelector(s) { if (!kids.has(s)) kids.set(s, mk()); return kids.get(s); },
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 60, height: 60 }),
  };
}

function boot({ noMic = false } = {}) {
  const sentHooks = new Set();
  const outbox = { onSent(fn) { sentHooks.add(fn); return () => sentHooks.delete(fn); } };
  let timers = [];
  const store = new Map(), calls = [], created = [];
  const document = { createElement: () => { const e = mk(); created.push(e); return e; }, querySelector: () => null };
  const window = { addEventListener() {}, WosOutbox: outbox };
  const ctx = vm.createContext({
    window, document, console,
    getComputedStyle: () => ({ paddingTop: '64px', paddingBottom: '16px' }),
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    requestAnimationFrame: fn => fn(),
  });
  vm.runInContext(SRC, ctx, { filename: 'tour.js' });
  const T = window.WosTour;
  const H = {
    device: mk(), orbWrap: mk(), noMic: () => noMic, cmdExample: () => 'Open Calendar',
    goHome: () => calls.push('home'), prepare: () => calls.push('prepare'), toast: (...a) => calls.push('toast:' + a[1]), vib() {},
    closeSheets: () => calls.push('closeSheets'), setZen: on => { calls.push('zen:' + on); T.event('zen', { on }); },
    dismissVoice: () => calls.push('dismissVoice'), say: (t, k) => calls.push(`say:${k}:${t}`), openChats: () => calls.push('openChats'),
  };
  T.attach(H);
  const tour = () => created.find(e => e._l.click && /tr-copy/.test(e.innerHTML));
  const q = s => (s === '.tr-stage' ? tour() : tour().querySelector('.tr-copy')).querySelector(s);
  const tap = sel => tour()._l.click.forEach(f => f({ target: { closest: s => (s === sel ? {} : null) } }));
  const runTimers = () => { const t = timers; timers = []; t.forEach(x => x.fn()); };
  const view = () => ({ step: T.step, active: T.active, sub: q('small').textContent, copy: q('b').textContent, next: q('.tr-nx').innerHTML, alt: q('.tr-alt').innerHTML });
  const delivered = it => [...sentHooks].forEach(f => f(it, {}));
  return { T, H, calls, store, tour, q, tap, runTimers, view, delivered, sentHooks };
}


const DONE_TEXT = 'You’re set. This is your own server, and your Wizard can do a lot on it. Apps add new skills, like Files, a web Browser, Calendar, Music or video editing. Ask your Wizard what apps you have, or what’s in the App Store.';
const typedReply = (o = {}) => ({ kind: 'reply', source: 'chat', sessionId: 'thread-1', text: 'thanks!', createdAt: Date.now() + 1, ...o });

test('three beats, each labelled "Step N of 3": Talk, Reply, Done; no Hide, Install or Command beat', () => {
  const t = boot();
  assert.deepEqual([...t.T.beats], ['Talk', 'Reply', 'Done']);
  assert.equal(t.T.DONE, 3);
  assert.ok(t.T.start('qa'));
  let v = t.view();
  assert.equal(v.step, 1); assert.equal(v.sub, 'Step 1 of 3 · Talk'); assert.equal(v.copy, 'Tap the orb and say hello. Tap again to send.');
  assert.equal((t.tour().innerHTML.match(/<i><\/i>/g) || []).length, 3, 'three progress dots, one per beat');
  t.tap('[data-tnext]'); v = t.view();
  assert.equal(v.step, 2); assert.equal(v.sub, 'Step 2 of 3 · Reply'); assert.equal(v.copy, 'Open Chats to see your Wizard’s answer, then type a reply.');
  t.tap('[data-tnext]'); v = t.view();
  assert.equal(v.step, 3); assert.equal(v.sub, 'Step 3 of 3 · Done'); assert.equal(v.copy, DONE_TEXT);
  assert.doesNotMatch(SRC, /title: '(Hide|Install|Command)'/);
  assert.doesNotMatch(SRC, /Swipe the orb down to hide|Add Wizard to your Home Screen|installOffer|data-tinstall/);
  assert.doesNotMatch(t.q('.tr-stage').innerHTML, /tr-gi|Swipe/, 'end card no longer teaches the swipe-to-hide gesture');
});

test('no beat teaches a command (voice or typed), and the typed fallback has no command button', () => {
  for (const noMic of [false, true]) {
    const t = boot({ noMic });
    t.T.start('qa');
    if (noMic) assert.equal(t.view().copy, 'Type “hello” and send it to your Wizard.', 'no microphone: typed fallback on Talk');
    for (let i = 0; i < 3; i++) {
      const v = t.view();
      assert.doesNotMatch(v.copy + v.alt, /Open Calendar|Open Files|Hold the orb and say “Open|command|data-tsay|tr-cmd/i, `beat ${v.step} (noMic=${noMic})`);
      t.tap('[data-tnext]');
    }
  }
});

test('"Skip this step" moves one beat on, the tour keeps running, and is not offered on the end card', () => {
  const t = boot();
  t.T.start('qa');
  assert.match(t.view().next, /data-tnext[^>]*>Skip this step</);
  t.tap('[data-tnext]');
  assert.ok(t.T.active); assert.equal(t.T.step, 2); assert.equal(t.store.get('wos.tour.v1'), undefined, 'a skipped step does not finish the tour');
  assert.match(t.view().next, /Skip this step/);
  t.tap('[data-tnext]');
  assert.equal(t.T.step, t.T.DONE); assert.equal(t.view().next, '', 'end card: no per-step skip, a tap finishes');
  assert.equal(t.T.skipStep(), false);
  t.tap('[data-tother]'); // a plain tap anywhere on the end card
  assert.ok(!t.T.active); assert.equal(t.store.get('wos.tour.v1'), 'true', 'completion marks the tour done');
  assert.ok(!t.calls.some(c => c.startsWith('toast:')), 'finishing is not reported as a skip');
});

test('"Skip tour" still exits the whole tour from any beat', () => {
  for (const at of [1, 2, 3]) {
    const t = boot();
    t.T.start('qa'); for (let i = 1; i < at; i++) t.tap('[data-tnext]');
    assert.equal(t.T.step, at);
    assert.match(t.tour().innerHTML, /data-tskip>Skip tour</);
    t.tap('[data-tskip]');
    assert.ok(!t.T.active); assert.equal(t.store.get('wos.tour.v1'), 'true');
    assert.ok(t.calls.some(c => /toast:.*help/.test(c)));
  }
});

test('Talk advances only on a real sent message; Reply only on a delivered typed reply in a chat thread', () => {
  const t = boot();
  t.T.start('qa');
  t.T.event('nospeech'); t.runTimers();
  assert.equal(t.T.step, 1);
  t.T.event('sent', { text: 'hello' }); assert.match(t.view().copy, /^Sent\./);
  t.runTimers(); assert.equal(t.T.step, 2);
  assert.equal(t.sentHooks.size, 1, 'Reply listens for delivered messages');
  // Not a typed reply in a thread: a new chat, a voice note, a recording from the orb, an empty text, a local command.
  for (const it of [typedReply({ kind: 'new', sessionId: '' }), typedReply({ audio: {} }), typedReply({ audioFile: { id: 'wf_1' } }), typedReply({ captureId: 'capture-1' }), typedReply({ source: 'orb' }), typedReply({ text: '  ' }), typedReply({ nativeId: 'n1' }), typedReply({ sessionId: '' })]) {
    t.delivered(it); assert.equal(t.T.step, 2, JSON.stringify(it));
  }
  t.T.event('sent', { text: 'a voice note' }); t.runTimers(); assert.equal(t.T.step, 2, 'an orb message is not the typed reply');
  t.delivered(typedReply({ createdAt: 1 })); assert.equal(t.T.step, 2, 'a reply typed before this beat began does not count');
  t.delivered(typedReply()); assert.equal(t.T.step, t.T.DONE, 'a typed reply delivered in a thread finishes Reply');
  assert.equal(t.sentHooks.size, 0, 'the listener is released once Reply is over');
});

test('Reply leaves the shell free: no wrong-gesture nudges, Back is the shell\'s own, Open Chats opens Chats', () => {
  const t = boot();
  t.T.start('qa'); t.tap('[data-tnext]'); t.calls.length = 0;
  assert.match(t.view().alt, /data-tchats[^>]*>Open Chats</);
  t.tap('[data-tchats]'); assert.deepEqual(t.calls, ['openChats']);
  for (const ev of [['command', { ok: true, text: 'Open Chats' }], ['nomatch', { text: 'x' }], ['sheet', { which: 'launcher' }], ['desk', { home: false }]]) {
    t.T.event(...ev);
    assert.equal(t.T.step, 2); assert.equal(t.view().copy, 'Open Chats to see your Wizard’s answer, then type a reply.');
  }
  assert.ok(!['home', 'closeSheets', 'dismissVoice'].some(c => t.calls.includes(c)), JSON.stringify(t.calls));
  assert.equal(t.T.back(), '', 'Back inside Chats is the shell\'s, the beat stays');
  assert.equal(t.T.step, 2);
  assert.match(SRC, /const guarded = t => active\(\) && step !== REPLY && !allowed\(t\);/, 'the tap guard is off during Reply');
});

test('Reply: away from Home (Chats open) the card gets out of the way; back on Home it returns', () => {
  const t = boot();
  let home = true; t.H.atHome = () => home;
  t.T.start('qa'); t.tap('[data-tnext]');
  const cls = () => t.tour().classList;
  assert.ok(cls().contains('tr-free') && !cls().contains('tr-away'));
  home = false; t.runTimers(); assert.ok(cls().contains('tr-away'), 'in Chats: card hidden');
  home = true; t.runTimers(); assert.ok(!cls().contains('tr-away'), 'back on Home: card shown');
  home = false; t.runTimers(); t.tap('[data-tnext]'); assert.equal(t.T.step, 3); assert.ok(!cls().contains('tr-away') && !cls().contains('tr-free'), 'the end card is never hidden');
});

test('a hold during Talk never advances it, even when it ran as a command (Codex P2 on #456)', () => {
  for (const ev of [['command', { ok: true, text: 'Open Calendar' }], ['command', { ok: false }], ['nomatch', { text: 'x' }]]) {
    const t = boot();
    t.T.start('qa'); t.calls.length = 0;
    t.T.event(...ev); t.runTimers();
    assert.equal(t.T.step, 1, `${ev[0]} ${JSON.stringify(ev[1])} keeps Talk`);
    assert.doesNotMatch(t.view().copy, /ran as a command/);
    assert.ok(t.calls.includes('home') && t.calls.includes('dismissVoice'), 'what the hold opened is put back behind Home');
  }
});

test('a take whose microphone never opened is explained in the tour copy (toasts are hidden while it runs)', () => {
  const t = boot();
  t.T.start('qa');
  t.T.event('voicefail', { text: 'The microphone didn’t start. Allow it for this site, then tap the orb again.' });
  assert.equal(t.T.step, 1); assert.match(t.view().copy, /microphone didn’t start/);
  t.runTimers(); assert.equal(t.view().copy, 'Tap the orb and say hello. Tap again to send.', 'then the Talk instruction returns');
});

test('Back: Talk skips the tour; the end card finishes it', () => {
  const t = boot();
  t.T.start('qa');
  assert.equal(t.T.back(), 'tour-skip'); assert.ok(!t.T.active);
  const u = boot(); u.T.start('qa'); u.tap('[data-tnext]'); u.tap('[data-tnext]');
  assert.equal(u.T.back(), 'tour-done'); assert.ok(!u.T.active);
});

test('Practice again replays all three beats from Talk', () => {
  const t = boot();
  t.T.start('qa'); t.tap('[data-tskip]'); assert.ok(!t.T.active);
  t.T.openHelp(); assert.ok(t.T.helpOpen);
  assert.match(SRC, /data-hsgo>Practice again</);
  assert.match(SRC, /if \(e\.target\.closest\('\[data-hsgo\]'\)\) \{ closeHelp\(\); return start\('help'\); \}/);
  assert.ok(t.T.start('help')); assert.equal(t.T.step, 1); assert.equal(t.view().sub, 'Step 1 of 3 · Talk');
});

test('Help sheet keeps commands and Practice again', () => {
  assert.match(SRC, /a: 'Hold the orb', b: 'A command for the phone/);
  assert.match(SRC, /data-hsgo>Practice again</);
});
