import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { styleOf } from './fixtures/mini-css.mjs';
import { runRecording, block } from './fixtures/source-slice.mjs';

// Execute the production layout/tile functions. This is a geometry fixture, not browser acceptance.
const js = withShellParts(readFileSync(process.env.QA_DESKTOP_JS || new URL('../web/desktop/desktop.js', import.meta.url), 'utf8'));
const source = js.slice(js.indexOf('  function layout() {'), js.indexOf('  /* ---- heads-up chat'));
const css = withShellParts(readFileSync(process.env.QA_DESKTOP_CSS || new URL('../web/desktop/desktop.css', import.meta.url), 'utf8'));
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
  vm.runInContext(withShellParts(readFileSync(new URL('../web/core/pane-layout.js', import.meta.url), 'utf8')) + '\nconst C = globalThis.WizCore;\n' + source, ctx);
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
  // The real layout() decides which windows are full; desktop.css then paints each desk's own chrome.
  const h = harness({ mono: [false, true] }); h.run();
  const doc = createDocument();
  doc.body.innerHTML = '<div class="wsp"><div class="win" data-win="a"><div class="wbar"></div></div></div><div class="wsp" hidden><div class="win" data-win="b"><div class="wbar"></div></div></div>';
  for (const id of ['a', 'b']) doc.querySelector(`[data-win="${id}"]`).classList.toggle('full', h.nodes[id].classList.contains('full'));
  doc.body.classList.toggle('desktop-fullscreen', h.body.classList.contains('desktop-fullscreen'));
  const a = doc.querySelector('[data-win="a"]'), b = doc.querySelector('[data-win="b"]');
  assert.equal(styleOf(b, css, 'border'), '0', 'the background full window has no frame');
  assert.equal(styleOf(b.querySelector('.wbar'), css, 'display'), 'none', 'nor a title bar');
  assert.notEqual(styleOf(a.querySelector('.wbar'), css, 'display'), 'none', 'the foreground window keeps its title bar');
  assert.notEqual(styleOf(a, css, 'border'), '0');
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
  // The real render(): each desk host is hidden at Home and when it is not the current desk.
  const paint = ({ homeOpen, cur }) => {
    const doc = createDocument(); doc.body.innerHTML = '<div id="stage"><div class="wsp"></div><div class="wsp"></div></div><div id="desktopHome"></div>';
    const hosts = doc.querySelectorAll('.wsp');
    runRecording(block(js, '  function render() {') + '\nrender();', {
      ws: [{ id: 'd1', wins: ['a'], mono: true }, { id: 'd2', wins: ['b'] }], W: { a: { id: 'a' }, b: { id: 'b' } }, cur, homeOpen, document: doc, globalThis: {},
      stage: doc.querySelector('#stage'), wsEl: i => hosts[i], $$: () => [], $: q => doc.querySelector(q), pal: { hidden: true }, palDesk: null });
    return hosts.map(h => h.hidden);
  };
  assert.deepEqual(paint({ homeOpen: true, cur: 0 }), [true, true], 'Home hides every host, the mono desk too');
  assert.deepEqual(paint({ homeOpen: false, cur: 0 }), [false, true]);
  assert.deepEqual(paint({ homeOpen: false, cur: 1 }), [true, false]);
  // A hidden host keeps its layout box (so background sizes stay) but is not seen or hit.
  const doc = createDocument(); doc.body.innerHTML = '<div class="wsp" hidden></div>';
  const host = doc.querySelector('.wsp');
  assert.equal(styleOf(host, css, 'visibility'), 'hidden'); assert.equal(styleOf(host, css, 'display'), 'block'); assert.equal(styleOf(host, css, 'pointer-events'), 'none');
});

test('skin-frame and Appearance presentation use the same desk-local fullscreen state', () => {
  const skin = withShellParts(readFileSync(process.env.QA_SKIN_FRAME_CSS || new URL('../web/core/skin-frame.css', import.meta.url), 'utf8'));
  const appearance = withShellParts(readFileSync(process.env.QA_APPEARANCE_JS || new URL('../web/core/appearance-host.js', import.meta.url), 'utf8'));
  // the real skin-frame.css on a desk's full-screen window: no frame, no title bar (only under a skin frame)
  const doc = createDocument(); doc.body.innerHTML = '<div class="wsp"><div class="win full"><div class="wbar"></div></div></div>';
  const win = doc.querySelector('.win'), bar = doc.querySelector('.wbar');
  doc.documentElement.setAttribute('data-skin-frame', '');
  for (const [k, v] of [['border-radius', '0'], ['padding', '0']]) assert.equal(styleOf(win, skin, k), v, k);
  assert.match(String(styleOf(win, skin, 'border')), /^0/);
  assert.equal(styleOf(bar, skin, 'display'), 'none');
  doc.documentElement.removeAttribute('data-skin-frame');
  assert.notEqual(styleOf(bar, skin, 'display'), 'none', 'without a skin frame the bar stays');
  const block = appearance.match(/const IMMERSIVE = [\s\S]*?const presentation =[^;]+;/)?.[0];
  const context = vm.createContext({}); vm.runInContext(block + '\nglobalThis.present = presentation;', context);
  for (const foregroundFull of [false, true]) for (const ownMono of [false, true]) {
    const frame = { closest: selectors => selectors.split(',').some(s => ownMono && (s.trim() === '.wsp .win.full' || (foregroundFull && s.trim() === 'body.desktop-fullscreen .win.full'))) ? {} : null };
    assert.equal(context.present(frame), ownMono ? 'immersive' : 'window');
  }
});
