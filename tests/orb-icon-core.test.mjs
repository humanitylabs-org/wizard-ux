// James approved the white app icon in the orb and removal of the centre dot, 27 Oct 2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { shader } from './fixtures/s1-glsl.mjs';
const source = readFileSync(new URL('../web/orb.js', import.meta.url), 'utf8');
function orb(skin = 'nebula', id = 'orb', inDock = false) {
  let now = 0, next, reads = 0;
  const uniforms = {}, observers = [], sources = [];
  const icon = { content: true, hasChildNodes() { return this.content; } };
  const style = { display: 'grid', visibility: 'visible', opacity: '.96' };
  const host = { querySelector: () => icon, style: { setProperty() {} }, dataset: {} };
  const root = { dataset: { skin } }, device = {};
  const gl = new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true,
    getUniformLocation: (_, key) => key, uniform1f: (key, value) => { uniforms[key] = value; }, shaderSource: (_, src) => sources.push(src) },
    { get: (obj, key) => obj[key] || (() => ({})) });
  const canvas = { id, parentElement: host, closest: sel => sel === '#dock' ? (inDock ? {} : null) : device, clientWidth: 64, clientHeight: 64,
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
  return { api: window.Orb, sources, icon, style, root, host, observers, uniforms, frame, settle, drain, pending: () => !!next, reads: () => reads };
}

// The fragment shader the orb really compiles, drawn on the CPU (no GPU here): one 48 px orb, idle colours.
let drawn;
function draw() {
  if (drawn) return drawn;
  const o = orb(); o.frame();
  const frag = o.sources.find(x => /gl_FragColor/.test(x));
  const s = shader(frag, { probe: ['stars', 'spec', 'arc', 'qr'] });
  const base = { res: [48, 48], t: 1.3, lvl: 0, energy: .2, spin: .3, ring: 0, press: 0, R: .5, sparkle: 1, cA: [.1, .05, .2], cB: [.3, .2, .6], cC: [.6, .4, .9] };
  const px = (x, y, u) => s.pixel([x, y], { ...base, ...u });
  const all = []; for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) { const pr = px(x, y, { core: 0, gloss: 0 }).probes; if (pr.qr !== undefined) all.push({ x, y, ...pr }); }
  return (drawn = { px, all });
}
const lum = c => c[0] + c[1] + c[2];

test('the orb hides its white centre dot while it shows the white app icon', () => {
  for (const skin of ['nebula', 'grove', 'tide', 'ember', 'signal']) {
    const o = orb(skin);
    o.frame();
    assert.ok(o.uniforms.core > 0 && o.uniforms.core < .55, 'fade starts smoothly, not an abrupt cut');
    o.settle();
    assert.ok(o.uniforms.core < .0001, `${skin}: visible icon removes centre glow`);
    assert.ok(o.reads() <= 15, 'at most one computed-style read per frame');
  }
  // in the real shader: the centre dot follows core, while the stars keep their full brightness with core at 0
  const d = draw(), centre = d.all.reduce((a, b) => b.qr < a.qr ? b : a);
  assert.ok(lum(d.px(centre.x, centre.y, { core: .55, gloss: 0 }).color) - lum(d.px(centre.x, centre.y, { core: 0, gloss: 0 }).color) > .5, 'centre dot drawn at core .55, gone at 0');
  const stars = d.all.filter(p => p.stars > .5 && !d.all.some(q => q.stars > 0 && Math.abs(q.x - p.x) + Math.abs(q.y - p.y) === 1));
  assert.ok(stars.length >= 2, 'the idle orb has stars');
  for (const p of stars) {
    const at = (x, y) => d.px(x, y, { core: 0, gloss: 0 }).color[1];
    const around = (at(p.x - 1, p.y) + at(p.x + 1, p.y) + at(p.x, p.y - 1) + at(p.x, p.y + 1)) / 4;
    assert.ok(at(p.x, p.y) - around > .5 * p.stars, `star at ${p.x},${p.y} still shines with the centre dot hidden`);
  }
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

test("James 29 Oct: the white top-left shine on the orb goes while the white app icon shows, and returns when listening", () => {
  for (const skin of ['nebula', 'grove', 'tide', 'ember', 'signal']) {
    const o = orb(skin); o.settle();
    assert.ok(o.uniforms.gloss < .002, `${skin}: no white shine behind the icon`);
    o.style.display = 'none'; o.api.setMode('listen'); o.settle();
    assert.ok(o.uniforms.gloss > .999, `${skin}: shine back while listening`);
  }
  // in the real shader: gloss 0 takes the white highlight and arc out, gloss 1 draws them white
  const d = draw(), shine = d.all.reduce((a, b) => b.spec > a.spec ? b : a), arc = d.all.reduce((a, b) => b.arc > a.arc ? b : a);
  assert.ok(shine.spec > .5 && shine.x < 24 && shine.y > 24, `the highlight sits top left (GL y runs up): ${JSON.stringify(shine)}`);
  for (const p of [shine, arc]) {
    const on = d.px(p.x, p.y, { core: 0, gloss: 1 }).color, off = d.px(p.x, p.y, { core: 0, gloss: 0 }).color;
    const add = on.slice(0, 3).map((v, i) => v - off[i]);
    assert.ok(Math.min(...add) > .15, `gloss 1 adds the shine at ${p.x},${p.y}: ${add}`);
    assert.ok(Math.max(...add) - Math.min(...add) < .02, 'and it is white');
  }
  const o = orb('obsidian'); o.settle();
  assert.ok(o.uniforms.gloss > .999, 'other skins keep their shine');
});

// Phone bar (wizard-ux issue 1533, on for everyone): the phone's own dock orb drops its sparkles, the swirl stays;
// every other orb (Everywhere's floating orb, other skins, desktop, agent orbs) keeps them. No switch decides it.
test('the phone dock orb has no sparkles, every other orb keeps them, in the real shader', () => {
  const cases = [['nebula', 'orb', true, undefined, 0], ['grove', 'orb', true, undefined, 0], ['signal', 'orb', true, undefined, 0],
    ['nebula', 'orb', false, undefined, 1], ['obsidian', 'orb', true, undefined, 1],
    ['nebula', 'agentOrb', true, undefined, 1], ['nebula', 'orb', true, 'desktop', 1]];
  for (const [skin, id, inDock, shell, want] of cases) {
    const o = orb(skin, id, inDock); if (shell) o.root.dataset.shell = shell; o.frame();
    assert.equal(o.uniforms.sparkle, want, `${skin} #${id} ${inDock ? 'in the dock' : 'floating'} ${shell || 'phone'}`);
  }
  const d = draw(), lit = d.all.filter(p => p.stars > 0);
  assert.ok(lit.length > 0, 'the shader draws some sparkles');
  let most = 0;
  for (const p of lit) {
    const on = d.px(p.x, p.y, { core: 0, gloss: 0, sparkle: 1 }).color, off = d.px(p.x, p.y, { core: 0, gloss: 0, sparkle: 0 }).color;
    assert.ok(lum(on) > lum(off), `sparkle at ${p.x},${p.y} goes with sparkle 0`); most = Math.max(most, lum(on) - lum(off));
  }
  assert.ok(most > .5, `a sparkle is a bright point (${most})`);
  const plain = d.all.find(p => !(p.stars > 0));
  assert.deepEqual(d.px(plain.x, plain.y, { core: 0, gloss: 0, sparkle: 0 }).color, d.px(plain.x, plain.y, { core: 0, gloss: 0, sparkle: 1 }).color, 'the swirl stays');
});
