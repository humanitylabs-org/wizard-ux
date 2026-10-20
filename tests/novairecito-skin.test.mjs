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
  assert.deepEqual([...context.WosSkin.list.slice(6).map(s => s.id)], ['obsidian', 'obsidian-light', 'landscapes']);

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

test('Novairecito is a visual-only package scoped to its own skin', () => {
  const js = read('web/core/skins.js');
  const css = read('web/skins/novairecito/skin.css');
  assert.match(js, /id: 'novairecito', pkg: \{ css: true, dir: 'novairecito' \}/);
  assert.doesNotMatch(js, /id: 'novairecito', pkg: \{[^}]*js:/);
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
    assert.match(match[1].trim(), /^html\[data-skin="novairecito"\]/);
  }
});