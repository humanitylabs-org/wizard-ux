// James, 29 Oct 2026: "we used to have moving bars to signal it could hear the user's voice."
// Exercise the real phone sampling + fan-out, not a separate meter implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = process.env.QA_VOICE_METER_ROOT || fileURLToPath(new URL('../', import.meta.url));
const read = p => readFileSync(resolve(root, p), 'utf8');
const app = read('web/app.js'), css = read('web/styles.css'), html = read('web/index.html');
function extract(name) {
  const at = app.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} exists`);
  let depth = 0, i = app.indexOf('{', at);
  for (; i < app.length; i++) { if (app[i] === '{') depth++; else if (app[i] === '}' && --depth === 0) break; }
  return app.slice(at, i + 1);
}
function capture({ native = false, amplitude = 0, state = 'listen', sim = false } = {}) {
  const meter = {}, transcript = {}, shader = [], skin = [], timer = {};
  let now = 1000, nativeReads = 0, amp = amplitude;
  const V = { state, acc: 0, t0: 0, native: native ? 'native-take' : null, sim,
    an: native || sim ? null : { fftSize: 16, getByteTimeDomainData(a) { a.fill(128 + amp); } } };
  const style = target => ({ setProperty(k, v) { target[k] = Number(v); } });
  const tick = new Function('V', 'Orb', 'tx', '$', 'window', 'performance', 'requestAnimationFrame', 'DEV', 'fmtT',
    `${extract('orbLevel')}\n${extract('tick')}\nreturn tick;`)(
    V, { setLevel(v) { shader.push(v); } }, { style: style(transcript) },
    s => s === '#voiceMeter' ? { style: style(meter) } : timer,
    { WosSkinHost: { level(v) { skin.push(v); } } }, { now: () => now }, () => 1,
    () => ({ recLevel() { nativeReads++; return amp; } }), String);
  return { V, meter, transcript, shader, skin, tick, sample(v) { amp = v; now += 100; tick(); }, get nativeReads() { return nativeReads; } };
}
const level = c => c.meter['--voice-meter-level'];

test("James's moving voice-level bars remain in the orb, independent of the hidden Listening card", () => {
  const orb = html.slice(html.indexOf('id="orbWrap"'), html.indexOf('id="dotsR"'));
  assert.match(orb, /id="voiceMeter" class="voice-meter" aria-hidden="true"/);
  assert.equal((orb.match(/<i><\/i>/g) || []).length, 7);
  assert.match(css, /\.voice-meter\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /\.voice-meter\s*\{[^}]*background:\s*var\(--wz-panel/);
  assert.match(css, /\.device:is\(\[data-voice="listen"\], \[data-voice="command"\]\) \.voice-meter\s*\{\s*display:\s*flex/);
  assert.match(css, /\.voice-meter\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.voice-meter i\s*\{[^}]*var\(--voice-meter-level, 0\)/);
  assert.doesNotMatch(css.match(/\.voice-meter i\s*\{[^}]*\}/)?.[0] || '', /animation:/);
});

test('browser silence, soft speech, loud speech and silence drive the same real sample to bars, shader and skin', () => {
  const c = capture();
  c.sample(0); assert.equal(level(c), 0);
  c.sample(4); const soft = level(c); assert.ok(soft > 0 && soft < .5);
  c.sample(24); assert.ok(level(c) > soft);
  assert.equal(level(c), c.shader.at(-1)); assert.equal(level(c), c.skin.at(-1));
  assert.equal(level(c), c.transcript['--lvl']);
  c.sample(0); assert.equal(level(c), 0);
});

test('native phone recLevel is still polled and reaches both visible bars and orb shader', () => {
  const c = capture({ native: true });
  c.sample(0); assert.equal(level(c), 0);
  c.sample(10); const soft = level(c); assert.ok(soft > 0);
  c.sample(75); assert.equal(level(c), 1); assert.ok(level(c) > soft);
  assert.equal(c.nativeReads, 3); assert.equal(c.shader.at(-1), 1); assert.equal(c.skin.at(-1), 1);
  c.sample(0); assert.equal(level(c), 0);
});

for (const native of [false, true]) {
  test(`${native ? 'native' : 'browser'} pause has no voice movement; resume follows fresh speech`, () => {
    const c = capture({ native }); c.sample(24); assert.ok(level(c) > 0);
    c.V.state = 'paused'; c.sample(24); assert.equal(level(c), 0); assert.equal(c.shader.at(-1), 0);
    c.V.state = 'listen'; c.sample(8); assert.ok(level(c) > 0);
  });
}

test('held commands use the same live microphone bars', () => {
  const c = capture({ state: 'command' }); c.sample(24); assert.ok(level(c) > 0);
});

test('no microphone and simulated demo takes never fake hearing on the meter', () => {
  const c = capture({ sim: true }); c.tick(); assert.equal(level(c), 0);
  c.V.sim = false; c.tick(); assert.equal(level(c), 0); assert.equal(c.shader.at(-1), 0);
});

test('leaving capture clears the sample immediately, without waiting for the next animation frame', () => {
  assert.match(extract('setVoice'), /if \(s !== 'listen' && s !== 'command'\) orbLevel\(0\)/);
  const c = capture(); c.sample(24);
  for (const state of ['paused', 'think', 'idle']) { c.V.state = state; c.sample(24); assert.equal(level(c), 0); }
});

test('invalid native levels cannot poison the meter or WebGL uniform', () => {
  const c = capture({ native: true }); c.sample(Infinity);
  assert.ok(Number.isFinite(level(c))); assert.ok(Number.isFinite(c.shader.at(-1)));
  c.sample(NaN); assert.equal(level(c), 0);
});
