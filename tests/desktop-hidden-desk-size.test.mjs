import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Execute the production layout/tile functions. This is a geometry fixture, not browser acceptance.
const js = readFileSync(process.env.QA_DESKTOP_JS || new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const source = js.slice(js.indexOf('  function layout() {'), js.indexOf('  /* ---- heads-up chat'));
const css = readFileSync(process.env.QA_DESKTOP_CSS || new URL('../web/desktop/desktop.css', import.meta.url), 'utf8');
function harness({ mono = [false, false], wins = [['a'], ['b']], home = false, barHeight = 34 } = {}) {
  const classes = () => {
    const values = new Set();
    return { toggle(k, on) { on ? values.add(k) : values.delete(k); }, contains: k => values.has(k) };
  };
  const body = { classList: classes(), appendChild() {} };
  const nodes = Object.fromEntries(wins.flat().map(id => [id, { style: {}, classList: classes() }]));
  const desks = wins.map((ids, i) => ({ wins: ids, focus: ids[0], mono: mono[i], split: 0.5 }));
  const reads = [], writes = [];
  for (const [id, node] of Object.entries(nodes)) node.style = new Proxy({}, { set(o, k, v) { writes.push(id); o[k] = v; return true; } });
  const hosts = desks.map((_, i) => ({
    get clientWidth() { reads.push(i); return 1400; },
    get clientHeight() { reads.push(i); return body.classList.contains('desktop-fullscreen') ? 900 : 900 - barHeight; }
  }));
  const exit = {};
  const ctx = vm.createContext({
    ws: desks, cur: 0, homeOpen: home, MOD: 'Ctrl+', W: {},
    document: { body, documentElement: {}, getElementById: () => exit },
    getComputedStyle: () => ({ getPropertyValue: () => '1200' }),
    $: selector => selector === '#bar' ? { getBoundingClientRect: () => ({ height: barHeight }) } : null,
    wsEl: i => hosts[i], winEl: id => nodes[id],
    splitOf: d => d.split, toggleMono() {},
  });
  vm.runInContext(readFileSync(new URL('../web/core/pane-layout.js', import.meta.url), 'utf8') + '\nconst C = globalThis.WizCore;\n' + source, ctx);
  return { ctx, nodes, body, hosts, reads, writes, run: () => vm.runInContext('layout()', ctx) };
}

for (const frontMono of [false, true]) for (const hiddenMono of [false, true]) {
  test(`background geometry uses its own chrome: foreground=${frontMono}, background=${hiddenMono}`, () => {
    const h = harness({ mono: [frontMono, hiddenMono] }); h.run();
    assert.equal(h.nodes.a.style.height, `${frontMono ? 900 : 850}px`);
    assert.equal(h.nodes.b.style.height, `${hiddenMono ? 900 : 850}px`);
    assert.equal(h.nodes.a.classList.contains('full'), frontMono);
    assert.equal(h.nodes.b.classList.contains('full'), hiddenMono);
    assert.equal(h.body.classList.contains('desktop-fullscreen'), frontMono);
    const before = { ...h.nodes.b.style };
    h.ctx.cur = 1; h.run();
    assert.deepEqual({ ...h.nodes.b.style }, before, 'switching desks must not resize an already mounted app');
  });
}
test('Home sizes all restored windows without enabling global fullscreen', () => {
  const h = harness({ mono: [true, false], home: true }); h.run();
  assert.equal(h.body.classList.contains('desktop-fullscreen'), false);
  assert.equal(h.nodes.a.style.height, '900px'); assert.equal(h.nodes.b.style.height, '850px');
});
test('empty foreground still sizes a background desk; missing windows are harmless', () => {
  const h = harness({ wins: [[], ['b', 'stale']] }); delete h.nodes.stale; h.run();
  assert.equal(h.nodes.b.style.height, '850px'); assert.ok(+h.nodes.b.style.width.slice(0, -2) > 0);
});
test('background split, stack and requested columns keep their eventual geometry', () => {
  for (const ids of [['b', 'c'], ['b', 'c', 'd']]) for (const share of [false, true]) {
    const h = harness({ wins: [['a'], ids] }); if (share) h.ctx.W.b = { share: 0.4 };
    h.run(); const before = Object.fromEntries(ids.map(id => [id, { ...h.nodes[id].style }]));
    h.ctx.cur = 1; h.run();
    assert.deepEqual(Object.fromEntries(ids.map(id => [id, { ...h.nodes[id].style }])), before);
  }
});
test('uses the measured bar height, not a fixed 34px assumption', () => {
  const h = harness({ mono: [true, false], barHeight: 52 }); h.run();
  assert.equal(h.nodes.b.style.height, '832px');
});
test('background fullscreen chrome is scoped to each desk, not the foreground body', () => {
  assert.match(css, /\.wsp \.win\.full \{[^}]*border: 0/);
  assert.match(css, /\.wsp \.win\.full \.wbar \{ display: none; \}/);
});
test('multi-window monocle tracks the focused app and can leave fullscreen', () => {
  const h = harness({ mono: [false, true], wins: [['a'], ['b', 'c']] }); h.run();
  assert.equal(h.nodes.b.classList.contains('full'), true);
  assert.equal(h.nodes.c.classList.contains('gone'), true);
  h.ctx.ws[1].mono = false; h.run();
  assert.equal(h.nodes.b.classList.contains('full'), false);
  assert.equal(h.nodes.c.classList.contains('gone'), false);
  assert.equal(h.nodes.b.style.height, '850px');
});
test('Home hides every desktop host, including the mono desk', () => {
  assert.match(js, /host\.hidden = homeOpen \|\| i !== cur/);
  assert.match(css, /\.wsp\[hidden\] \{[^}]*visibility: hidden/);
});
test('skin-frame and Appearance presentation use the same desk-local fullscreen state', () => {
  const skin = readFileSync(process.env.QA_SKIN_FRAME_CSS || new URL('../web/core/skin-frame.css', import.meta.url), 'utf8');
  const appearance = readFileSync(process.env.QA_APPEARANCE_JS || new URL('../web/core/appearance-host.js', import.meta.url), 'utf8');
  assert.match(skin, /html\[data-skin-frame\] \.wsp \.win\.full \{ border: 0; border-radius: 0; padding: 0; \}/);
  assert.match(skin, /html\[data-skin-frame\] \.wsp \.win\.full > \.wbar \{ display: none; \}/);
  const block = appearance.match(/const IMMERSIVE = [\s\S]*?const presentation =[^;]+;/)?.[0];
  assert.ok(block);
  const context = vm.createContext({}); vm.runInContext(block + '\nglobalThis.present = presentation;', context);
  for (const foregroundFull of [false, true]) for (const ownMono of [false, true]) {
    const frame = { closest: selectors => selectors.split(',').some(s => ownMono && (s.trim() === '.wsp .win.full' || (foregroundFull && s.trim() === 'body.desktop-fullscreen .win.full'))) ? {} : null };
    assert.equal(context.present(frame), ownMono ? 'immersive' : 'window');
  }
});
