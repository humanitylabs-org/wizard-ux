import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';

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
  const { context } = runtime();
  assert.deepEqual(JSON.parse(JSON.stringify(context.WosSkin.pkgOf('novairecito'))), { css: true, dir: 'novairecito' }, 'a look only: no skin script (wizard-ux#1190)');
  assert.equal(context.WosSkin.pkgOf('nebula'), null, 'other skins load no package');
  // the package's CSS on a selected pin: only under Novairecito
  const css = read('web/skins/novairecito/skin.css');
  const pin = skin => { const d = createDocument(); d.documentElement.setAttribute('data-skin', skin); d.body.innerHTML = '<button class="ch-pin-toggle" aria-pressed="true"></button>'; return d.body.firstElementChild; };
  const on = cascade(pin('novairecito'), css), head = cascade(pin('novairecito'), css, { pseudo: '::after' });
  assert.equal(on.color?.value, '#7f1d1d', 'selected pin bodies are visibly darker');
  assert.equal(head.background?.value, '#ef4444', 'selected pins add an independent red head accent');
  const svg = pin('novairecito'); svg.innerHTML = '<svg><path></path></svg>';
  assert.equal(cascade(svg.querySelector('svg'), css)['fill-opacity']?.value, '1', 'selected pin bodies are a solid silhouette');
  for (const skin of ['nebula', 'obsidian']) {
    const el = pin(skin); el.innerHTML = '<svg><path></path></svg>';
    for (const [node, pseudo] of [[el, ''], [el, '::after'], [el.querySelector('svg'), '']]) assert.deepEqual(cascade(node, css, { pseudo }), {}, `${skin}: nothing from Novairecito`);
  }
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
    assert.match(match[1].trim(), /^html\[data-skin="novairecito"\]/);
  }
});
