// Settings › Look › Window opacity (Miguel, 27 Oct 2026): one per-device slider for the glass behind every window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { settingsWorld } from './fixtures/r5A-settings.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { noImports } from './fixtures/r7A-css.mjs';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

function boot(saved = {}) {
  const store = new Map(Object.entries(saved));
  const props = new Map();
  const root = { dataset: {}, style: { setProperty: (k, v) => props.set(k, v), removeProperty: k => props.delete(k) } };
  const events = [];
  const ctx = {
    console, Math, Number, JSON, Object, Array, Set, Map, String, Error, parseFloat, isFinite,
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { documentElement: root, readyState: 'loading', addEventListener() {}, querySelector: () => null, createElement: () => ({}) },
    addEventListener() {}, dispatchEvent: e => events.push(e.type), CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    requestAnimationFrame() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('web/core/skins.js'), ctx);
  return { S: ctx.window.WosSkin, props, root, store, events };
}

test('untouched: every skin paints its own glass and no override marker', () => {
  const { S, props, root } = boot({ 'wos.skin': 'grove' });
  assert.equal(S.glass, null);
  assert.equal(props.get('--sk-win'), 'rgba(8,15,10,0.84)');
  assert.equal(root.dataset.winGlass, undefined);
  const nebula = boot();
  assert.equal(nebula.props.has('--sk-win'), false, 'Nebula still sets nothing');
});

test('a chosen opacity keeps the skin tint, persists per device, and applies to every skin incl. Nebula', () => {
  const b = boot({ 'wos.skin': 'landscapes' });
  assert.equal(b.S.setGlass(0.9), 0.9);
  assert.equal(b.props.get('--sk-win'), 'rgba(16,14,22,0.9)');
  assert.equal(b.root.dataset.winGlass, '');
  assert.equal(b.store.get('wos.window.opacity'), '0.9');
  assert.ok(b.events.includes('wos:window-glass'));
  b.S.set('nebula');
  assert.equal(b.props.get('--sk-win'), 'rgba(12,8,26,0.9)');
  const again = boot({ 'wos.skin': 'tide', 'wos.window.opacity': '0.7' });
  assert.equal(again.props.get('--sk-win'), 'rgba(4,26,34,0.7)');
});

test('values clamp to 60–100 %, junk is ignored, and reset returns to the skin glass', () => {
  const b = boot({ 'wos.skin': 'ember', 'wos.window.opacity': 'nope' });
  assert.equal(b.S.glass, null);
  assert.equal(b.S.setGlass(0.2), 0.6);
  assert.equal(b.S.setGlass(5), 1);
  assert.equal(b.S.setGlass(null), null);
  assert.equal(b.store.has('wos.window.opacity'), false);
  assert.equal(b.props.get('--sk-win'), 'rgba(16,9,5,0.85)');
  assert.equal(b.root.dataset.winGlass, undefined);
});

// The real Settings (mini-dom, tests/fixtures/r5A-settings.mjs) over the real skins.js above: Look's slider sets the
// glass; the marker skins.js writes then goes through every page stylesheet (mini-css cascade) on a Nebula window.
test('Settings › Look carries the slider; CSS routes every window through the shared token only when chosen', () => {
  const b = boot({ 'wos.skin': 'nebula' });
  const w = settingsWorld({ shell: 'desktop', scope: { WosSkin: b.S } });
  w.open('appearance');
  const range = w.root.querySelector('[data-settings-feature="window-glass"] input[data-wg-range]');
  assert.ok(range, 'Look shows the window opacity slider');
  assert.equal(range.getAttribute('type'), 'range');
  const windowBg = (page, chosen) => {
    const html = read('web/' + page), sheets = [...html.split('</head>')[0].matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
    const css = noImports(sheets.map(f => read('web/' + f))).join('\n');
    const d = createDocument(); d.documentElement.setAttribute('data-skin', 'nebula');
    d.documentElement.setAttribute('data-shell', page === 'desktop.html' ? 'desktop' : 'phone');
    if (chosen) d.documentElement.setAttribute('data-win-glass', '');
    d.body.innerHTML = '<div class="win"><div class="wbody"></div></div>';
    return cascade(d.querySelector('.win'), css).background?.value || '';
  };
  for (const page of ['desktop.html', 'index.html']) assert.notEqual(windowBg(page, false), 'var(--sk-win)', page + ': untouched, Nebula keeps its own window');
  range.value = '75'; range.dispatchEvent({ type: 'input', bubbles: true });
  assert.equal(b.S.glass, 0.75, 'moving the slider sets the glass');
  assert.equal(b.root.dataset.winGlass, '', 'skins.js marks the page');
  for (const page of ['desktop.html', 'index.html']) assert.equal(windowBg(page, b.root.dataset.winGlass !== undefined), 'var(--sk-win)', page + ': chosen, every window uses the shared token');
});
