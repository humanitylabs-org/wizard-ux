import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/share-sheet.js', import.meta.url), 'utf8');
const targets = [
  { id: 'a', name: 'Test Person A', lastActivity: 100 },
  { id: 'c', name: 'Test Person C', lastActivity: 300 },
  { id: 'b', name: 'Test Person B', lastActivity: 200 },
];
function boot({ installed = true, cached = targets, recent = [] } = {}) {
  let ops, el, now = 0; const opened = [], map = new Map();
  map.set('wos.share.receivers.v1', JSON.stringify({messenger: {accepts: ['text', 'url', 'image', 'file'], targets: cached}}));
  map.set('wos.share.recent.v1', JSON.stringify(recent));
  const window = {
    WizCore: {apps: () => ({APP: installed ? {messenger: {kind: 'wizard', name: 'Messenger'}} : {}})},
    WizAppServices: {claimShare: o => (ops = o, true)},
    WizOpenApp: id => { opened.push(id); return true; }, dispatchEvent() {},
  };
  const document = {body: {appendChild() {}}, createElement() {
    const handlers = {};
    el = {style: {}, classList: {add() {}, remove() {}}, setAttribute() {}, remove() {},
      querySelector: () => null, addEventListener: (n, f) => {handlers[n] = f;}, handlers};
    return el;
  }};
  vm.runInNewContext(source, {window, document, localStorage: {getItem: k => map.get(k), setItem: (k,v) => map.set(k,v)},
    Date: class extends Date {static now() {return now;}}, File, Blob, URL, CustomEvent: class {}, requestAnimationFrame: f => f(), setTimeout: f => f()});
  const click = target => el.handlers.click({detail: 0, target});
  return { S: window.WosShareSheet, ops, opened, map, el: () => el, click,
    tick: t => {now = t;}, person: id => ({closest: selector => selector === '.shs-b' ? {} : selector === '[data-shs-app]' ? {dataset: {shsApp: 'messenger', shsTarget: id}} : null}) };
}
test('People: recent shares outrank Messenger activity, then keep its published alphabetical tail', () => {
  const b = boot({recent: ['messenger|a']});
  assert.deepEqual([...b.S._people('text')], ['a', 'c', 'b']);
  b.ops.setTargets('messenger', [{id: 'a', name: 'Test Person A'}, {id: 'b', name: 'Test Person B'}]);
  assert.deepEqual([...b.S._people('url')], ['a', 'b']);
});
test('People: legacy cached targets preserve Messenger own last-activity order without opening it', () => {
  const b = boot({cached: [{id:'c',name:'Test Person C'}, {id:'a',name:'Test Person A'}]});
  assert.deepEqual([...b.S._people('text')], ['c','a']); assert.deepEqual(b.opened, []);
});
test('People: empty cache hides the row but keeps Messenger Apps fallback, never waits', async () => {
  const b = boot({cached: []}); const receipt = b.S.show({text: 'Synthetic share'}, () => 'unsupported');
  assert.doesNotMatch(b.el().innerHTML, /data-shs-people|spinner/);
  assert.match(b.el().innerHTML, /data-shs-app="messenger"/); assert.deepEqual(b.opened, []);
  b.S.back(); assert.equal(await receipt, 'cancelled');
});
test('People: stale cached names never appear when Messenger is not installed', async () => {
  const b = boot({installed: false}); assert.deepEqual([...b.S._people('text')], []);
  assert.equal(await b.S.show({text:'Synthetic'}, () => 'copied'), 'copied');
});
test('People: a tap opens Messenger with exact target and text/url/files pending, never sends', async () => {
  for (const payload of [{text:'Synthetic'}, {url:'https://example.test/'}, {file:new File(['fixture'], 'fixture.txt')}]) {
    const b = boot(); const result = b.S.show(payload, () => 'unsupported');
    assert.match(b.el().innerHTML, /data-shs-people/); b.click(b.person('b'));
    assert.equal(await result, 'shared'); assert.deepEqual(b.opened, ['messenger']);
    const [item] = b.ops.pending('messenger'); assert.equal(item.target, 'b');
    assert.equal(item.text || item.url || item.file, payload.text || payload.url || payload.file);
    assert.equal(b.S.isOpen(), false); assert.equal(b.S._state().recent[0], 'messenger|b');
  }
});
test('People: outside tap and Back close just the sheet', async () => {
  const b = boot(); let result = b.S.show({text:'Synthetic'}, () => 'unsupported');
  b.click({closest: () => null}); assert.equal(await result, 'cancelled'); assert.equal(b.S.isOpen(), false);
  result = b.S.show({text:'Synthetic'}, () => 'unsupported');
  assert.equal(b.S.back(), 'share-sheet'); assert.equal(await result, 'cancelled'); assert.equal(b.S.back(), null);
  assert.deepEqual(b.opened, []);
});
test('People: pending custody expires at 30 minutes, not before', () => {
  const b = boot(); b.ops.deliver('messenger', {text:'Synthetic'}, 'a');
  b.tick(30*60*1000-1); assert.equal(b.ops.pending('messenger').length, 1);
  b.tick(30*60*1000); assert.equal(b.ops.pending('messenger').length, 0);
});
