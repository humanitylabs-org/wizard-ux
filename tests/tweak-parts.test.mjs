// Replaceable parts (core/parts.js): a tweak swaps a named front-end part whole, without editing core files,
// so updates never wipe it and never need a rebase. docs/TWEAKS.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fixture, read } from './fixtures/tweaks.mjs';

function parts() {
  const events = [], window = { dispatchEvent: e => events.push(e.type) };
  vm.runInNewContext(read('web/core/parts.js'), { window, Event: class { constructor(t) { this.type = t; } }, console });
  return { P: window.WosParts, events };
}
const stockPins = () => { const ids = []; return { ids: () => ids.slice(), has: id => ids.includes(id), toggle: id => { const at = ids.indexOf(id); if (at >= 0) { ids.splice(at, 1); return false; } ids.push(id); return true; }, partition: rows => ({ pinned: rows.filter(r => ids.includes(r.id)), rest: rows.filter(r => !ids.includes(r.id)) }), sync: () => 'stock-sync' }; };
const PINS = { version: 1, methods: ['ids', 'has', 'toggle', 'partition'], event: 'wos:chat-pins' };

test('core calls a part through one facade: stock until replaced, back to stock when the tweak goes', () => {
  const { P, events } = parts(), stock = stockPins();
  const pins = P.define('pins', PINS, stock);
  assert.equal(pins, P.use('pins'));
  pins.toggle('a'); assert.deepEqual([...pins.ids()], ['a']);
  assert.equal(pins.sync(), 'stock-sync', 'stock-only extras stay reachable');
  const off = P.replace('pins', { ids: () => ['x'], has: id => id === 'x', toggle: () => true, partition: rows => ({ pinned: [], rest: rows }) }, { owner: 'my-skin', version: 1 });
  assert.equal(typeof off, 'function');
  assert.deepEqual([...pins.ids()], ['x']);
  assert.equal(P.list()[0].replacedBy, 'my-skin');
  off();
  assert.deepEqual([...pins.ids()], ['a']);
  assert.deepEqual(events, ['wos:chat-pins', 'wos:chat-pins'], 'replacing and restoring repaint the list');
});

test('a replacement that throws falls back to stock for that call', () => {
  const { P } = parts(), stock = stockPins(); stock.toggle('a');
  const pins = P.define('pins', PINS, stock);
  P.replace('pins', { ids: () => { throw new Error('boom'); }, has: () => false, toggle: () => true, partition: rows => ({ pinned: [], rest: rows }) }, { owner: 't', version: 1 });
  assert.deepEqual([...pins.ids()], ['a']);
});

test('refusals: wrong contract version, missing methods, unknown part, already taken', () => {
  const { P } = parts(); P.define('pins', PINS, stockPins());
  const ok = { ids: () => [], has: () => false, toggle: () => false, partition: rows => ({ pinned: [], rest: rows }) };
  assert.equal(P.replace('pins', ok, { owner: 'a', version: 2 }), 'version');
  assert.equal(P.replace('pins', { ids: () => [] }, { owner: 'a', version: 1 }), 'methods');
  assert.equal(P.replace('nope', ok, { owner: 'a' }), 'unknown');
  assert.equal(typeof P.replace('pins', ok, { owner: 'a', version: 1 }), 'function');
  assert.equal(P.replace('pins', ok, { owner: 'b', version: 1 }), 'taken');
  assert.equal(P.define('pins', PINS, stockPins()), null, 'a part is defined once');
});

test('pins are the first part: chat-pins.js defines it and chats.js calls the part', () => {
  assert.match(read('web/core/chat-pins.js'), /WosParts\?\.define\('pins', \{ version: 1, methods: \['ids', 'has', 'toggle', 'partition'\], event: 'wos:chat-pins' \}, api\)/);
  assert.match(read('web/core/chats.js'), /const PIN = window\.WosParts\?\.use\('pins'\) \|\| window\.WosChatPins/);
  for (const page of ['web/index.html', 'web/desktop.html']) {
    const html = read(page);
    assert.ok(html.indexOf('core/parts.js') > 0 && html.indexOf('core/parts.js') < html.indexOf('core/chat-pins.js'), `${page}: parts.js loads before chat-pins.js`);
  }
});

function withParts(manifests) {
  const f = fixture({ manifests });
  vm.runInNewContext(read('web/core/parts.js'), f.ctx);
  const stock = stockPins();
  f.ctx.window.WosParts.define('pins', PINS, stock);
  return { f, P: f.ctx.window.WosParts, stock };
}
const manifest = (id, extra = {}) => ({ id, name: 'Pins fix', version: '1.0.0', author: id.split('/')[0], apiVersion: JSON.parse(read('web/core/slots.json')).apiVersion, capabilities: ['parts', 'prefs'], parts: { pins: 1 }, ...extra });

test('a tweak with the parts capability replaces pins for its lifetime', async () => {
  const id = 'miguel/pins-fix', { f, P } = withParts({ [id]: manifest(id) });
  let api;
  f.host._test.setImporter(async () => ({ default: a => { api = a; a.parts.replace('pins', { ids: () => ['t'], has: x => x === 't', toggle: () => true, partition: rows => ({ pinned: [], rest: rows }) }, { version: 1 }); return () => {}; } }));
  await f.host.loadTweaks([id], f.slots, { teamAuthors: ['miguel'] });
  assert.equal(typeof api.prefs.get, 'function');
  assert.deepEqual([...P.use('pins').ids()], ['t']);
  await f.host.loadTweaks([], f.slots);
  assert.deepEqual([...P.use('pins').ids()], [], 'turning the tweak off restores stock pins');
});

test('after an update changes the part, the tweak pauses with a plain note instead of breaking pins', async () => {
  const id = 'miguel/pins-fix', { f, P } = withParts({ [id]: manifest(id, { parts: { pins: 0 } }) });
  let ran = false;
  f.host._test.setImporter(async () => ({ default: () => { ran = true; return () => {}; } }));
  await f.host.loadTweaks([id], f.slots, { teamAuthors: ['miguel'] });
  assert.equal(ran, false);
  assert.equal(f.host.tweakState.includes(id), false);
  assert.match(f.toasts.at(-1), /paused after an update · ask your Wizard to update it/);
  assert.equal(P.list()[0].replacedBy, null);
});

test('authors outside the team cannot replace parts', async () => {
  const id = 'stranger/pins-fix', { f } = withParts({ [id]: manifest(id) });
  let api;
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks([id], f.slots, { teamAuthors: ['miguel'] });
  assert.equal(api.parts, undefined);
  assert.equal(api.prefs, undefined);
});

test("the owner's own tweak (My skin script) gets parts and prefs", () => {
  assert.match(read('web/core/skin-host.js'), /mod\.default\(Object\.freeze\(\{ \.\.\.makeApi\(a\), parts: partsApi\(a\), prefs: prefsApi\(a\) \}\)\)/);
});

test('the docs example (pins as the owner\'s own tweak) passes the My skin lint and really replaces pins', async () => {
  const code = read('docs/TWEAKS.md').match(/```js\n([\s\S]*?)```/)[1];
  const { f, P } = withParts({});
  assert.equal(f.host.scriptProblem(code), null);
  let shared = ['wizard_desk'];
  const puts = [];
  f.ctx.Blob = Blob; f.ctx.URL = { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL() {} };
  f.ctx.fetch = async () => ({ ok: true, json: async () => ({ pinnedChats: shared.slice() }) });
  f.ctx.window.WizLive = { putPrefs: async patch => { puts.push(patch); shared = patch.pinnedChats; return true; } };
  f.host._test.setImporter(async () => vm.runInNewContext(`(() => { ${code.replace('export default function setup', 'function setup')}; return { default: setup }; })()`, f.ctx));
  assert.equal(await f.host.loadPersonal(new TextEncoder().encode(code), () => true), true);
  await new Promise(r => setTimeout(r, 10));
  const pins = P.use('pins');
  assert.deepEqual([...pins.ids()], ['wizard_desk'], 'reads the shared list');
  assert.equal(pins.toggle('wizard_phone'), true);
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual([...shared], ['wizard_desk', 'wizard_phone'], 'writes onto the fresh shared list');
  f.host.stopPersonal();
  assert.equal(P.list()[0].replacedBy, null, 'turning My skin off restores stock pins');
});
