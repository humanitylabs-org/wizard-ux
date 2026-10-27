// James approved the white app icon in the orb and removal of the centre dot, 27 Oct 2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../web/orb.js', import.meta.url), 'utf8');
function orb(skin = 'nebula', id = 'orb') {
  let now = 0, next, reads = 0;
  const uniforms = {}, observers = [];
  const icon = { content: true, hasChildNodes() { return this.content; } };
  const style = { display: 'grid', visibility: 'visible', opacity: '.96' };
  const host = { querySelector: () => icon, style: { setProperty() {} }, dataset: {} };
  const root = { dataset: { skin } }, device = {};
  const gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true,
    getUniformLocation: (_, key) => key, uniform1f: (key, value) => { uniforms[key] = value; } },
    { get: (obj, key) => obj[key] || (() => ({})) });
  const canvas = { id, parentElement: host, closest: () => device, clientWidth: 64, clientHeight: 64,
    getContext: () => gl, addEventListener() {} };
  const fallback = {};
  const document = { documentElement: root, hidden: false, addEventListener() {},
    getElementById: key => key === 'orb' ? canvas : fallback };
  const window = { addEventListener() {} };
  vm.runInNewContext(source, { window, document, performance: { now: () => now },
    requestAnimationFrame: fn => { next = fn; return 1; }, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {}, console,
    getComputedStyle: () => { reads++; return style; },
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} } });
  function frame() { now += 100; const fn = next; next = null; fn(now); }
  function settle() { window.Orb.press(false); for (let i = 0; i < 14; i++) frame(); }
  function drain() { for (let i = 0; next && i < 40; i++) frame(); }
  return { api: window.Orb, icon, style, root, host, observers, uniforms, frame, settle, drain, pending: () => !!next, reads: () => reads };
}

test('the orb hides its white centre dot while it shows the white app icon', () => {
  for (const skin of ['nebula', 'grove', 'tide', 'ember', 'signal']) {
    const o = orb(skin);
    o.frame();
    assert.ok(o.uniforms.core > 0 && o.uniforms.core < .55, 'fade starts smoothly, not an abrupt cut');
    o.settle();
    assert.ok(o.uniforms.core < .0001, `${skin}: visible icon removes centre glow`);
    assert.ok(o.reads() <= 15, 'at most one computed-style read per frame');
  }
  assert.match(source, /c0 \+ stars\*\.9/, 'stars retain their original brightness');
});

test('hidden, empty, transparent and CSS-hidden recording/launcher icons restore the core', () => {
  for (const state of [{ display: 'none' }, { visibility: 'hidden' }, { visibility: 'collapse' }, { opacity: '0' }, { opacity: '.5' }, { empty: true }]) {
    const o = orb(); o.settle();
    Object.assign(o.style, state); if (state.empty) o.icon.content = false;
    o.api.setMode('listen'); o.settle();
    assert.ok(o.uniforms.core > .999, `listening glow restored for ${JSON.stringify(state)}`);
    Object.assign(o.style, { display: 'grid', visibility: 'visible', opacity: '.96' }); o.icon.content = true;
    o.api.setMode('idle'); o.settle();
    assert.ok(o.uniforms.core < .0001, 'showing the icon again suppresses the core');
  }
});

test('other skins and secondary/native orbs retain their core without reading icon style', () => {
  for (const skin of ['obsidian', 'obsidian-light', 'landscapes', 'novairecito', 'sepia']) {
    const o = orb(skin); o.settle();
    assert.equal(o.uniforms.core, .55); assert.equal(o.reads(), 0);
  }
  const o = orb('nebula', 'secondary'); o.settle();
  assert.equal(o.uniforms.core, .55); assert.equal(o.reads(), 0);
});

test('icon paint and appearance changes wake a frozen idle orb without self-waking on frame styles', () => {
  const o = orb(); o.api.setRestingMotion(false); o.drain();
  assert.equal(o.pending(), false, 'resting orb is truly frozen');
  o.observers[0].fn([{ type: 'attributes', attributeName: 'style', target: o.host }]);
  assert.equal(o.pending(), false, 'per-frame CSS variables never self-wake');
  o.icon.content = false;
  o.observers[0].fn([{ type: 'childList', target: o.host }]);
  assert.equal(o.pending(), true, 'desk paint wakes the frozen orb');
  o.drain(); assert.ok(o.uniforms.core > .5499);
  o.icon.content = true;
  o.observers[1].fn([]);
  assert.equal(o.pending(), true, 'appearance changes wake the frozen orb');
  o.drain(); assert.ok(o.uniforms.core < .0001);
  o.root.dataset.skin = 'obsidian'; o.observers[1].fn([]); o.drain();
  assert.ok(o.uniforms.core > .5499, 'switching to another skin restores the original core');
});
