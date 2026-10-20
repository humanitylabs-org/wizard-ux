import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');

function runtime(saved = {}) {
  const store = new Map(Object.entries(saved));
  const props = new Map();
  const documentElement = {
    dataset: { shell: 'desktop' },
    style: {
      setProperty: (key, value) => props.set(key, value),
      removeProperty: key => props.delete(key),
    },
  };
  const context = vm.createContext({
    console,
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById() { return null; },
      documentElement,
      querySelector() { return null; },
    },
    localStorage: {
      getItem: key => store.get(key) || null,
      setItem: (key, value) => store.set(key, value),
    },
    dispatchEvent() {},
    CustomEvent: class {},
    addEventListener() {},
    setTimeout() {},
    performance: { now: () => 0 },
    Math,
  });
  vm.runInContext('window = this', context);
  vm.runInContext(read('web/core/skins.js'), context);
  return { context, store, props, documentElement };
}

test('Sepia is a selectable, persisted warm-light skin without changing the existing skin order', () => {
  const { context, store, props, documentElement } = runtime();
  const before = ['nebula', 'grove', 'tide', 'ember', 'signal', 'obsidian', 'obsidian-light'];
  assert.deepEqual([...context.WosSkin.list.slice(0, 7).map(s => s.id)], before);
  assert.deepEqual([...context.WosSkin.list.slice(7).map(s => s.id)], ['sepia', 'landscapes']);

  assert.equal(context.WosSkin.set('sepia'), 'sepia');
  assert.equal(context.WosSkin.current, 'sepia');
  assert.equal(documentElement.dataset.skin, 'sepia');
  assert.equal(store.get('wos.skin'), 'sepia');
  assert.equal(props.get('--bg'), 'rgba(243,234,210,1)');
  assert.equal(props.get('--ink'), 'rgba(51,43,34,1)');

  const reloaded = runtime(Object.fromEntries(store));
  assert.equal(reloaded.context.WosSkin.current, 'sepia');
  assert.equal(reloaded.documentElement.dataset.skin, 'sepia');
});

test('Sepia owns its paper treatment and light color scheme', () => {
  const js = read('web/core/skins.js');
  const css = read('web/core/skins.css');
  assert.match(js, /sepia:\s*\{/);
  assert.match(js, /vintage paper/i);
  assert.match(css, /html\[data-skin="sepia"\]\s*\{\s*color-scheme:\s*light/);
  assert.match(css, /html\[data-skin="sepia"\]\s+\.home-time/);
  assert.doesNotMatch(css, /(?:^|\})\s*(?:body|\.win|button)\s*\{[^}]*font(?:-family)?\s*:/m);
});
