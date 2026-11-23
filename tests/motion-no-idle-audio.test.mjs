// wizard-ux issue 1723: the motion kit holds no audio output while it is quiet. A running AudioContext is an open
// output stream (a shared Bluetooth speaker switches to the phone), so a tap makes none, a muted chime makes none, and
// a chime's context is closed shortly after its last tone. The assist surface copy is the same file.
// Browser proof in real Chromium: tests/qa-no-idle-audio-output.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const WEB = new URL('../web/motion/wizard-motion.js', import.meta.url);
const ASSIST = new URL('../android/app/src/main/assets/assist/wizard-motion.js', import.meta.url);
const SURFACE = new URL('../android/app/src/main/assets/assist/surface.html', import.meta.url);

function load() {
  const made = [], listeners = [], timers = [];
  const node = () => ({ connect(n) { return n || node(); }, gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, frequency: {}, start() {}, stop() {} });
  class AudioContext {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; made.push(this); }
    createGain() { return node(); } createOscillator() { return node(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  const W = { AudioContext, addEventListener: (type, fn) => listeners.push([type, fn]), matchMedia: () => ({ matches: false }) };
  const ctx = vm.createContext({ window: W, navigator: {}, setTimeout: (fn, ms) => (timers.push({ fn, ms }), timers.length), clearTimeout: id => { if (timers[id - 1]) timers[id - 1].fn = null; } });
  vm.runInContext(fs.readFileSync(WEB, 'utf8'), ctx);
  const fire = () => { const live = timers.filter(t => t.fn); timers.length = 0; for (const t of live) t.fn(); return live; };
  return { M: W.WizardMotion, made, listeners, fire };
}

test('loading the kit and tapping opens no audio output', () => {
  const { M, made, listeners } = load();
  assert.deepEqual(listeners.filter(([type]) => /pointer|touch|mouse|click|key/.test(type)), [], 'no gesture listener opens audio');
  assert.equal(M.sound.unlock(), null, 'unlock() opens nothing');
  assert.equal(made.length, 0);
});

test('a muted chime makes no AudioContext', () => {
  const { M, made } = load();
  M.sound.muted = true; M.chime('sent');
  assert.equal(made.length, 0);
});

test('a chime opens one output and closes it within 1 s of the tone ending', () => {
  const { M, made, fire } = load();
  M.chime([523, .3, .07]);
  assert.equal(made.length, 1); assert.equal(made[0].state, 'running');
  M.chime([660, .5, .07]);
  assert.equal(made.length, 1, 'chimes close together share one output');
  const [last] = fire();
  assert.ok(last.ms >= 500 && last.ms <= 1500, `let go after the last tone ends (${last.ms} ms)`);
  assert.equal(made[0].state, 'closed');
  M.chime('tick');
  assert.equal(made.length, 2, 'the next chime opens a fresh output');
});

test('the assist surface uses the same kit and does not unlock audio on taps', () => {
  assert.equal(fs.readFileSync(ASSIST, 'utf8'), fs.readFileSync(WEB, 'utf8'), 'assist copy of wizard-motion.js matches web/motion');
  assert.doesNotMatch(fs.readFileSync(SURFACE, 'utf8'), /sound\.unlock\(/);
});
