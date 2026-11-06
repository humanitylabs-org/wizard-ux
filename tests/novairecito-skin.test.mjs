import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');

function runtime(saved = {}) {
  const store = new Map(Object.entries(saved));
  const props = new Map();
  const documentElement = {
    dataset: { shell: 'phone' },
    style: { setProperty: (k, v) => props.set(k, v), removeProperty: k => props.delete(k) },
  };
  const context = vm.createContext({
    console,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    document: { documentElement, readyState: 'loading', addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } },
    addEventListener() {}, CustomEvent: class {}, devicePixelRatio: 1,
    Math,
  });
  vm.runInContext('window = this', context);
  vm.runInContext(read('web/core/skins.js'), context);
  return { context, store, props, documentElement };
}

test('Novairecito is selectable, persisted and leaves the established skin order intact', () => {
  const { context, store, props, documentElement } = runtime();
  assert.deepEqual([...context.WosSkin.list.slice(0, 5).map(s => s.id)], ['nebula', 'grove', 'tide', 'ember', 'signal']);
  assert.equal(context.WosSkin.list[5].id, 'novairecito');
  assert.deepEqual([...context.WosSkin.list.slice(6).map(s => s.id)].filter(id => id !== 'sepia'), ['obsidian', 'obsidian-light', 'landscapes', 'landscapes-light']);

  assert.equal(context.WosSkin.set('novairecito'), 'novairecito');
  assert.equal(context.WosSkin.current, 'novairecito');
  assert.equal(documentElement.dataset.skin, 'novairecito');
  assert.equal(store.get('wos.skin'), 'novairecito');
  assert.equal(props.get('--bg'), 'rgba(5,3,10,1)');
  assert.equal(props.get('--violet'), 'rgba(148,108,255,1)');

  const reloaded = runtime(Object.fromEntries(store));
  assert.equal(reloaded.context.WosSkin.current, 'novairecito');
  assert.equal(reloaded.documentElement.dataset.skin, 'novairecito');
});

test('Novairecito is a package scoped to its own skin', () => {
  const js = read('web/core/skins.js');
  const css = read('web/skins/novairecito/skin.css');
  assert.match(js, /id: 'novairecito', pkg: \{ css: true, js: true, when: 'always', dir: 'novairecito' \}/);
  assert.match(css, /html\[data-skin="novairecito"\] \.ch-pin-toggle\[aria-pressed="true"\]/, 'selected pin styling stays in Novairecito');
  assert.match(css, /color:\s*#7f1d1d/, 'selected pin bodies are visibly darker');
  assert.match(css, /fill-opacity:\s*1/, 'selected pin bodies are a solid silhouette');
  assert.match(css, /\.ch-pin-toggle\[aria-pressed="true"\]::after/, 'selected pins add an independent head accent');
  assert.match(css, /background:\s*#ef4444/, 'selected pin heads use a recognizable red');
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
    assert.match(match[1].trim(), /^html\[data-skin="novairecito"\]/);
  }
});
test('Novairecito opens with the expanding orb loading screen on phone and desktop', () => {
  const src = read('web/skins/novairecito/skin.js');
  assert.match(src, /orb-portrait\.mp4/); assert.match(src, /orb-landscape\.mp4/);
  assert.match(src, /export default function setup\(api\)/);
  assert.match(src, /SAFETY_MS = \d+/, 'the loader can never trap the shell');
  assert.match(src, /'ended', exit/); assert.match(src, /'error', exit/);
  for (const f of ['orb-portrait.mp4', 'orb-landscape.mp4', 'orb-portrait.jpg', 'orb-landscape.jpg'])
    assert.ok(readFileSync(new URL(`web/skins/novairecito/${f}`, root)).length > 10000, f);
});
