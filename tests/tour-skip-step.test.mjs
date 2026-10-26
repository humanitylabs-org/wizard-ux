// First-run tour (web/core/tour.js), Miguel 24 Oct 2026: the "Command" beat (hold the orb, say "Open Calendar")
// is gone from the tour, and every beat can be skipped on its own ("Skip this step") while "Skip tour" still ends
// the whole thing. Runs the real tour.js in node:vm against a tiny DOM stand-in and drives it the way the shell does
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
  let timers = [];
  const store = new Map(), calls = [], created = [];
  const document = { createElement: () => { const e = mk(); created.push(e); return e; }, querySelector: () => null };
  const window = { addEventListener() {} };
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
    dismissVoice: () => calls.push('dismissVoice'), say: (t, k) => calls.push(`say:${k}:${t}`),
  };
  T.attach(H);
  const tour = () => created.find(e => e._l.click && /tr-copy/.test(e.innerHTML));
  const q = s => (s === '.tr-stage' ? tour() : tour().querySelector('.tr-copy')).querySelector(s);
  const tap = sel => tour()._l.click.forEach(f => f({ target: { closest: s => (s === sel ? {} : null) } }));
  const runTimers = () => { const t = timers; timers = []; t.forEach(x => x.fn()); };
  const view = () => ({ step: T.step, active: T.active, sub: q('small').textContent, copy: q('b').textContent, next: q('.tr-nx').innerHTML, alt: q('.tr-alt').innerHTML });
  return { T, H, calls, store, tour, q, tap, runTimers, view };
}

test('the tour has no Command beat: Talk, Hide, then the end card, counted "of 2" where nothing can be installed', () => {
  const t = boot();
  assert.deepEqual([...t.T.beats], ['Talk', 'Hide', 'Install', 'Done']);
  assert.ok(t.T.start('qa'));
  let v = t.view();
  assert.equal(v.step, 1); assert.equal(v.sub, '1 of 2 · Talk'); assert.match(v.copy, /Tap the orb and say hello/);
  assert.equal((t.tour().innerHTML.match(/<i><\/i>/g) || []).length, 2, 'two progress dots, one per beat');
  t.tap('[data-tnext]'); v = t.view();
  assert.equal(v.step, 2); assert.equal(v.sub, '2 of 2 · Hide'); assert.match(v.copy, /Swipe the orb down/);
  t.tap('[data-tnext]'); v = t.view();
  assert.equal(v.step, t.T.DONE); assert.equal(v.sub, ''); assert.match(v.copy, /Everything you see is customizable/);
  assert.doesNotMatch(t.q('.tr-stage').innerHTML, /command|tr-gi hold/i, 'end card shows Tap + Swipe only');
});

test('no beat teaches a command (voice or typed), and the typed fallback has no command button', () => {
  for (const noMic of [false, true]) {
    const t = boot({ noMic });
    t.T.start('qa');
    for (let i = 0; i < 3; i++) {
      const v = t.view();
      assert.doesNotMatch(v.copy + v.alt, /Open Calendar|Open Files|Hold the orb and say “Open|command|data-tsay|tr-cmd/i, `beat ${v.step} (noMic=${noMic})`);
      t.tap('[data-tnext]');
    }
  }
  assert.doesNotMatch(SRC, /title: 'Command'/);
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
  for (const at of [1, 2]) {
    const t = boot();
    t.T.start('qa'); if (at === 2) t.tap('[data-tnext]');
    assert.equal(t.T.step, at);
    assert.match(t.tour().innerHTML, /data-tskip>Skip tour</);
    t.tap('[data-tskip]');
    assert.ok(!t.T.active); assert.equal(t.store.get('wos.tour.v1'), 'true');
    assert.ok(t.calls.some(c => /toast:.*help/.test(c)));
  }
});

test('Talk still advances only on a real sent message; Hide on hide + bring back', () => {
  const t = boot();
  t.T.start('qa');
  t.T.event('nospeech'); t.runTimers();
  assert.equal(t.T.step, 1);
  t.T.event('sent', { text: 'hello' }); assert.match(t.view().copy, /^Sent\./);
  t.runTimers(); assert.equal(t.T.step, 2);
  t.T.event('zen', { on: true }); assert.match(t.view().copy, /Swipe up from the bottom/);
  t.T.event('zen', { on: false }); t.runTimers(); assert.equal(t.T.step, t.T.DONE);
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

test('a hold during Hide is a wrong gesture too: what it opened closes, Hide stays (Codex P2 on #456)', () => {
  for (const ev of [['command', { ok: true, text: 'Settings' }], ['nomatch', { text: 'x' }]]) {
    const t = boot();
    t.T.start('qa'); t.tap('[data-tnext]'); t.calls.length = 0;
    t.T.event(...ev);
    assert.equal(t.T.step, 2);
    assert.match(t.view().copy, /That was a hold\. Swipe the orb down instead\./);
    assert.ok(['dismissVoice', 'closeSheets', 'home'].every(c => t.calls.includes(c)), JSON.stringify(t.calls));
    t.runTimers(); assert.equal(t.T.step, 2); assert.match(t.view().copy, /Swipe the orb down to hide/);
  }
});

test('skipping Hide while the bars are hidden brings them back first', () => {
  const t = boot();
  t.T.start('qa'); t.tap('[data-tnext]');
  t.T.event('zen', { on: true });
  t.tap('[data-tnext]');
  assert.ok(t.calls.includes('zen:false')); assert.equal(t.T.step, t.T.DONE);
});

test('Back still steps back: beat 2 → beat 1, beat 1 skips the tour', () => {
  const t = boot();
  t.T.start('qa'); t.tap('[data-tnext]');
  assert.equal(t.T.back(), 'tour-step'); assert.equal(t.T.step, 1);
  assert.equal(t.T.back(), 'tour-skip'); assert.ok(!t.T.active);
});

test('Help sheet keeps commands and Practice again', () => {
  assert.match(SRC, /a: 'Hold the orb', b: 'A command for the phone/);
  assert.match(SRC, /data-hsgo>Practice again</);
  assert.match(SRC, /if \(e\.target\.closest\('\[data-hsgo\]'\)\) \{ closeHelp\(\); return start\('help'\); \}/);
});
