// James 29 Oct: recurring white/cyan floating orb. These test confirmed renderer
// defects; they do not claim a synthetic context loss reproduces his screenshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(process.env.ORB_TEST_SOURCE || new URL('../web/orb.js', import.meta.url), 'utf8');

function fixture({ fail = false } = {}) {
  let now = 0, seq = 0, builds = 0, draws = 0, generation = 0;
  const pending = new Map(), timers = new Map(), events = {}, uniforms = {};
  const gl = new Proxy({
    createProgram: () => { builds++; return { generation }; },
    getShaderParameter: () => !fail, getProgramParameter: () => !fail,
    getUniformLocation: (_, name) => ({ name, generation }),
    uniform1f: (loc, value) => { assert.equal(loc.generation, generation, 'no stale uniform locations'); uniforms[loc.name] = value; },
    drawArrays: () => { draws++; },
  }, { get: (obj, key) => obj[key] || (() => ({})) });
  const canvas = { id: 'orb', width: 128, height: 128, clientWidth: 64, clientHeight: 64,
    parentElement: { style: { setProperty() {} }, dataset: {} }, hidden: false,
    getContext: () => gl, addEventListener: (name, fn) => { events[name] = fn; } };
  const fallback = { hidden: true };
  const window = { ORB_R: .64, addEventListener() {} };
  const document = { hidden: false, documentElement: { dataset: {} }, addEventListener() {},
    getElementById: id => id === 'orb' ? canvas : fallback };
  vm.runInNewContext(source, { window, document, performance: { now: () => now }, console: { warn() {} },
    requestAnimationFrame: fn => { pending.set(++seq, fn); return seq; }, cancelAnimationFrame: id => pending.delete(id),
    setTimeout: fn => { timers.set(++seq, fn); return seq; }, clearTimeout: id => timers.delete(id) });
  function frame() { now += 100; const fns = [...pending.values()]; pending.clear(); for (const fn of fns) fn(now); }
  function drain() { for (let i = 0; pending.size && i < 40; i++) frame(); }
  function lose() { let prevented = false; events.webglcontextlost({ preventDefault() { prevented = true; } }); assert.ok(prevented); }
  function restore() { generation++; assert.equal(typeof events.webglcontextrestored, 'function', 'context restoration must rebuild the existing renderer'); events.webglcontextrestored(); }
  return { api: window.Orb, canvas, fallback, uniforms, frame, drain, lose, restore,
    fail: on => { fail = on; }, builds: () => builds, draws: () => draws, pending: () => pending.size + timers.size };
}

test('all shader smoothstep edges are ordered: no driver-dependent reversed ramps', () => {
  const shader = source.match(/const FRAG = `([\s\S]*?)`;/)[1];
  const ramps = [...shader.matchAll(/smoothstep\(\s*([^,]+),\s*([^,]+),/g)];
  assert.ok(ramps.length >= 5);
  for (const Rr of [.48, .5, .64, .67]) for (const [, lo, hi] of ramps) {
    const edge = expression => Function('Rr', `return (${expression})`)(Rr);
    assert.ok(edge(lo) < edge(hi), `undefined smoothstep(${lo}, ${hi}, ...) at Rr=${Rr}`);
  }
});

test('Android assist uses the exact same repaired renderer', () => {
  if (process.env.ORB_TEST_SOURCE) return; // Old-source negative control tests behavior, not candidate mirroring.
  assert.equal(source, readFileSync(new URL('../android/app/src/main/assets/assist/orb.js', import.meta.url), 'utf8'));
});

test('context loss shows existing fallback, reports unavailable GL and stops drawing', () => {
  const o = fixture(); o.api.setRestingMotion(false); o.drain();
  assert.equal(o.api.webgl, true); const draws = o.draws();
  o.lose(); o.api.setMode('listen'); o.api.setLevel(.6); o.frame();
  assert.equal(o.canvas.hidden, true); assert.equal(o.fallback.hidden, false);
  assert.equal(o.api.webgl, false, 'webgl must reflect loss, not only startup success');
  assert.equal(o.draws(), draws); assert.equal(o.pending(), 0, 'lost context must not run a permanent live rAF loop');
});

test('repeated restore recreates GPU resources and wakes frozen idle without changing mode or level', () => {
  const o = fixture(); o.api.setRestingMotion(false); o.drain();
  assert.equal(o.pending(), 0);
  for (const mode of ['idle', 'listen', 'paused', 'type', 'typing', 'think']) {
    o.api.setMode(mode); o.api.setLevel(.4); o.drain(); const before = o.builds();
    o.lose(); o.restore(); o.frame();
    assert.equal(o.builds(), before + 1); assert.equal(o.api.webgl, true);
    assert.equal(o.canvas.hidden, false); assert.equal(o.fallback.hidden, true);
    assert.equal(o.api.mode, mode); assert.ok(o.uniforms.lvl > .39); assert.equal(o.uniforms.R, .64);
    o.drain();
  }
  o.api.setMode('idle'); o.drain(); assert.equal(o.pending(), 0, 'idle battery policy retained');
});

test('restore while asleep remains asleep until host wakes it', () => {
  const o = fixture(); o.frame(); o.api.sleep(true); o.lose(); const draws = o.draws(); o.restore();
  o.frame(); assert.equal(o.draws(), draws); assert.equal(o.pending(), 0);
  o.api.sleep(false); o.frame(); assert.ok(o.draws() > draws);
});

test('failed initialization or restore keeps fallback, never advertises a working GPU', () => {
  const initial = fixture({ fail: true }); initial.frame();
  assert.equal(initial.api.webgl, false); assert.equal(initial.canvas.hidden, true); assert.equal(initial.fallback.hidden, false);
  assert.equal(initial.pending(), 0);
  const o = fixture(); o.frame(); o.lose(); o.fail(true); o.restore(); o.frame();
  assert.equal(o.api.webgl, false); assert.equal(o.canvas.hidden, true); assert.equal(o.fallback.hidden, false);
  assert.equal(o.pending(), 0);
});
