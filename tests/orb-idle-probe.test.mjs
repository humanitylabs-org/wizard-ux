import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { installRafProbe, frozenIdle } = createRequire(import.meta.url)('../tools/qa-orb-idle-probe.cjs');

function fixture() {
  let now = 0, seq = 0;
  const jobs = new Map();
  const host = { __draws: 0, performance: { now: () => now },
    document: { hidden: false }, Orb: { mode: 'idle', webgl: true },
    setTimeout(fn, delay) { const id = ++seq; jobs.set(id, { at: now + delay, fn }); return id; },
    requestAnimationFrame(fn) { return this.setTimeout(() => fn(now), 100); },
    cancelAnimationFrame(id) { jobs.delete(id); } };
  installRafProbe(host);
  function advance(target) {
    while (true) {
      const next = [...jobs].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      now = next[1].at; jobs.delete(next[0]); next[1].fn();
    }
    now = target;
  }
  function draw() { host.__draws++; if (now < 1600) host.requestAnimationFrame(draw); }
  return { host, advance, draw, jobs };
}

test('exact historical 1500/300 sample races legitimate 1600-ms settling; drain barrier preserves strict freeze', async () => {
  const f = fixture(); f.host.requestAnimationFrame(f.draw); f.advance(1500);
  const old = f.host.__draws; f.advance(1800);
  assert.notEqual(f.host.__draws, old, 'old harness rejects an unchanged renderer');
  const g = fixture(); g.host.requestAnimationFrame(g.draw);
  const result = frozenIdle(g.host); g.advance(2200);
  const evidence = await result;
  assert.equal(evidence.pass, true); assert.equal(evidence.settled.elapsed, 1600);
  assert.equal(evidence.final.elapsed - evidence.settled.elapsed, 300);
  assert.equal(evidence.final.draws, evidence.settled.draws);
});

test('a single late draw fails without restarting or tolerating a frame', async () => {
  const f = fixture(), result = frozenIdle(f.host);
  f.host.setTimeout(() => f.host.__draws++, 100); f.advance(400);
  const evidence = await result;
  assert.equal(evidence.pass, false); assert.match(evidence.error, /must stay frozen/);
  assert.equal(evidence.samples.at(-1).draws, 1);
});

test('permanent rAF idle regression fails boundedly with rejected samples retained', async () => {
  const f = fixture();
  function spin() { f.host.__draws++; f.host.requestAnimationFrame(spin); }
  f.host.requestAnimationFrame(spin);
  const result = frozenIdle(f.host); f.advance(6100);
  const evidence = await result;
  assert.equal(evidence.pass, false); assert.match(evidence.error, /never drained/);
  assert.equal(evidence.samples.at(-1).elapsed, 6000);
});

test('cancel removes only its own rAF; hidden, mode drift and context loss cannot pass', async () => {
  const f = fixture(), id = f.host.requestAnimationFrame(() => assert.fail('cancelled callback ran'));
  f.host.cancelAnimationFrame(id); assert.equal(f.host.__orbPendingRafs.size, 0); f.advance(100);
  for (const corrupt of [h => { h.document.hidden = true; }, h => { h.Orb.mode = 'think'; }, h => { h.Orb.webgl = false; }]) {
    const g = fixture(); corrupt(g.host); const evidence = await frozenIdle(g.host);
    assert.equal(evidence.pass, false); assert.equal(evidence.samples.length, 1);
  }
});

test('actual published-style orb scheduler drains without harness touching product state', async () => {
  const f = fixture(), canvas = { width: 128, height: 128, clientWidth: 64, hidden: false,
    parentElement: { style: { setProperty() {} }, dataset: {} }, addEventListener() {},
    getContext: () => new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true,
      drawArrays: () => f.host.__draws++ }, { get: (o, k) => o[k] || (() => ({})) }) };
  f.host.addEventListener = () => {};
  f.host.document = { hidden: false, documentElement: { dataset: {} }, addEventListener() {},
    getElementById: id => id === 'orb' ? canvas : { hidden: true } };
  const context = { window: f.host, document: f.host.document, performance: f.host.performance,
    requestAnimationFrame: f.host.requestAnimationFrame.bind(f.host), cancelAnimationFrame: f.host.cancelAnimationFrame.bind(f.host),
    setTimeout: f.host.setTimeout.bind(f.host), clearTimeout: id => f.jobs.delete(id), console };
  vm.runInNewContext(readFileSync(new URL('../web/orb.js', import.meta.url), 'utf8'), context);
  f.host.Orb.setRestingMotion(false); f.host.Orb.setMode('idle');
  const result = frozenIdle(f.host); f.advance(2500);
  const evidence = await result; assert.equal(evidence.pass, true);
  assert.ok(evidence.settled.elapsed >= 1600); assert.equal(evidence.final.draws, evidence.settled.draws);
});
