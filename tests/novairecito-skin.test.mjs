import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
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
  assert.deepEqual(JSON.parse(JSON.stringify(context.WosSkin.pkgOf('novairecito'))), { css: true, js: true, when: 'always', dir: 'novairecito' });
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

// The real skin.js loading screen over a mini DOM; animations are stand-ins the test finishes by hand.
async function boot({ width = 390, height = 844 } = {}) {
  const doc = createDocument(), anims = [], listens = [];
  const animated = n => { n.animate = (frames, opts) => { let done; const a = { frames, opts, finished: new Promise(r => { done = r; }), cancel() {} }; a.finish = () => done(); anims.push(a); return a; }; return n; };
  const make = doc.createElement; doc.createElement = t => animated(make(t)); animated(doc.body);
  const was = { document: globalThis.document, window: globalThis.window };
  globalThis.document = doc; globalThis.window = { innerWidth: width, innerHeight: height };
  try {
    const { default: setup } = await import(new URL('web/skins/novairecito/skin.js', root).href);
    const stop = setup({ listen: (node, type, fn) => listens.push({ node, type, fn }) });
    return { doc, anims, listens, stop, video: doc.querySelector('.nv-boot video'), shown: () => !!doc.querySelector('.nv-boot'), restore: () => Object.assign(globalThis, was) };
  } catch (e) { Object.assign(globalThis, was); throw e; }
}
const settle = () => new Promise(r => setImmediate(r));

test('Novairecito opens with the expanding orb loading screen on phone and desktop', async () => {
  const pointed = [];
  const phone = await boot();
  try {
    assert.ok(phone.shown(), 'the loading screen is up');
    assert.match(phone.video.getAttribute('src') ?? phone.video.src, /orb-portrait\.mp4$/); assert.match(phone.video.poster, /orb-portrait\.jpg$/);
    pointed.push(phone.video.getAttribute('src') ?? phone.video.src, phone.video.poster);
    assert.equal(phone.video.muted, true, 'muted, so autoplay is allowed');
    // the video ending (or failing) lets the shell open
    const ended = phone.listens.find(l => l.node === phone.video && l.type === 'ended'), error = phone.listens.find(l => l.node === phone.video && l.type === 'error');
    assert.ok(ended && error); assert.equal(ended.fn, error.fn, 'one exit for both');
    ended.fn(); phone.anims.forEach(a => a.finish()); await settle();
    assert.equal(phone.shown(), false, 'gone once its exit has played');
  } finally { phone.restore(); }
  const desk = await boot({ width: 1440, height: 900 });
  try {
    assert.match(desk.video.src, /orb-landscape\.mp4$/); assert.match(desk.video.poster, /orb-landscape\.jpg$/);
    pointed.push(desk.video.src, desk.video.poster);
    // the loader can never trap the shell: a safety timer that exits even if the video never plays
    const safety = desk.anims.find(a => a.opts.fill === 'none'); assert.ok(safety && safety.opts.duration <= 10000, 'a bounded safety');
    safety.finish(); await settle(); desk.anims.forEach(a => a.finish()); await settle();
    assert.equal(desk.shown(), false);
  } finally { desk.restore(); }
  const quit = await boot();
  try { quit.stop(); assert.equal(quit.shown(), false, 'the skin\'s teardown removes it at once'); } finally { quit.restore(); }
  // every file the loader pointed at (phone and desktop, video and poster) is shipped beside the skin, and real media
  const media = [...new Set(pointed)].map(u => u.split('/').pop()).sort();
  assert.deepEqual(media, ['orb-landscape.jpg', 'orb-landscape.mp4', 'orb-portrait.jpg', 'orb-portrait.mp4']);
  for (const f of media) assert.ok(statSync(new URL(`web/skins/novairecito/${f}`, root)).size > 10000, f);
});
