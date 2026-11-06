import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/escape-back.js', import.meta.url), 'utf8');
function fixture() { const window = {}; vm.runInNewContext(source, { window }); return window.WizEscapeBack.create(); }
test('recording cancels before app/chat focus and an open overlay, one action only', () => {
  for (const focus of ['app', 'chat']) { const d = fixture(), calls = []; d.push(() => calls.push('menu'));
    assert.equal(d.run({ recording: () => { calls.push('cancel'); return true; }, surface: () => calls.push(focus) }), 'voice-cancel');
    assert.deepEqual(calls, ['cancel']);
  }
});
test('newest transient wins, then older sheet, then focused chat', () => {
  const d = fixture(), calls = []; let sheet, menu;
  sheet = d.push(() => { calls.push('sheet'); sheet(); }); menu = d.push(() => { calls.push('menu'); menu(); });
  const surface = () => { calls.push('chat'); return true; };
  d.run({ surface }); d.run({ surface }); d.run({ surface }); assert.deepEqual(calls, ['menu', 'sheet', 'chat']);
});
test('watched legacy sheets and pushed layout menus share recency, including reopening', () => {
  const d = fixture(), calls = []; let open = false;
  d.watch(() => open, () => { calls.push('sheet'); open = false; }, 'sheet');
  open = true; d.sync(); const off = d.push(() => { calls.push('menu'); off(); });
  d.run(); d.run(); d.sync(); open = true; d.sync(); d.run();
  assert.deepEqual(calls, ['menu', 'sheet', 'sheet']);
});
test('focused app at root stays mounted; never falls through to chat or desktop', () => {
  const d = fixture(), calls = [];
  d.run({ surface: () => { calls.push('app-back-at-root'); return true; }, fallback: () => calls.push('close-chat') });
  assert.deepEqual(calls, ['app-back-at-root']);
});
test('async/false overlay callback still consumes one press', () => {
  const d = fixture(); let calls = 0; d.push(() => false);
  d.run({ surface: () => ++calls }); assert.equal(calls, 0);
});
test('bare desktop no-op makes no state/DOM changes; repeat/composition do not peel', () => {
  const d = fixture(), dom = { html: '<desktop></desktop>' }; let calls = 0;
  assert.equal(d.run(), ''); assert.deepEqual(dom, { html: '<desktop></desktop>' });
  d.push(() => calls++); for (const event of [{repeat:true}, {isComposing:true}, {keyCode:229}]) d.run({ event });
  assert.equal(calls, 0);
});
test('desktop Escape is dispatched before any layout key and legacy list has a core ownership gate', () => {
  const desktop = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
  const body = desktop.slice(desktop.indexOf('function onKey('));
  assert.ok(body.indexOf('escapeBack.run') < body.indexOf('WosSkinHost?.key'));
  const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
  assert.match(chats, /if \(H\.ownsChatList\?\.\(\)\) \{ el\?\.replaceChildren\(\); return; \}/);
});
