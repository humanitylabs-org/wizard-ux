import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { parseCss } from './fixtures/mini-css.mjs';
import { skeleton, styles } from './fixtures/w5-css.mjs';

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
  assert.deepEqual([...context.WosSkin.list.map(s => s.id)],
    ['nebula', 'grove', 'tide', 'ember', 'signal', 'novairecito', 'sepia', 'obsidian', 'obsidian-light', 'landscapes', 'landscapes-light']);
  assert.equal(context.WosSkin.familyOf('sepia'), 'novairecito', 'Sepia is a colour of Novaire’s skin');

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
  const { context } = runtime();
  const css = read('web/skins/sepia/skin.css');
  // Its own package stylesheet, and its description.
  assert.equal(JSON.stringify(context.WosSkin.pkgOf('sepia')), '{"css":true,"dir":"sepia"}');
  assert.match(context.WosSkin.list.find(x => x.id === 'sepia').who, /vintage paper/i);
  assert.ok(fs.existsSync(new URL('web/skins/sepia/skin.css', root)));
  // Worn: a light colour scheme and its own clock face; any other skin: nothing from this sheet.
  const page = skin => { const doc = createDocument(); doc.documentElement.setAttribute('data-skin', skin); doc.body.innerHTML = '<div class="home"><div class="home-time">09:41</div></div><div class="win"><button>OK</button></div>'; return doc; };
  const sepia = page('sepia'), grove = page('grove');
  assert.equal(styles(sepia.documentElement, [css])['color-scheme'], 'light');
  assert.match(styles(sepia.querySelector('.home-time'), [css])['font-family'] || '', /Sk Fraunces/);
  for (const sel of ['body', '.win', 'button']) assert.equal(styles(sepia.querySelector(sel), [css])['font-family'], undefined, `${sel}: no shell-wide font`);
  assert.deepEqual(styles(grove.documentElement, [css]), {});
  assert.deepEqual(styles(grove.querySelector('.home-time'), [css]), {});
  // Every rule reaches its markup only under Sepia: drawn under Sepia it applies, under Grove nothing does.
  let rules = 0;
  for (const rule of parseCss(css)) {
    if (rule.media.length) continue;
    for (const sel of rule.selectors) {
      const m = /^html((?:\[[^\]]+\]|:not\([^)]*\)|:is\([^)]*\)|:where\([^)]*\))*)(?:\s+(.*))?$/.exec(sel);
      assert.ok(m && /\[data-skin="sepia"\]/.test(m[1]), `scoped to Sepia: ${sel}`);
      let built; try { const doc = createDocument(); built = m[2] ? skeleton(doc, m[2]) : { el: doc.documentElement, states: [], pseudo: /::[\w-]+$/.exec(sel)?.[0] || '' }; built.doc = doc; } catch (_) { continue; }
      const { el, states, pseudo, doc } = built;
      doc.documentElement.setAttribute('data-skin', 'grove');
      assert.deepEqual(styles(el, [css], { states, pseudo }), {}, `nothing under another skin: ${sel}`);
      rules++;
    }
  }
  assert.ok(rules > 5, `rules drawn (${rules})`);
});
