import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';
import { desktopKeys, desktopSource } from './fixtures/desktop-keys-harness.mjs';
const source = withShellParts(withWebParts(readFileSync(new URL('../web/core/escape-back.js', import.meta.url), 'utf8')));
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
  // the desktop's real onKey: Escape goes to its Back step and never reaches a layout's own keys
  const layout = [];
  const k = desktopKeys({ globalThis: { WosSkinHost: { key: e => { layout.push(e.key); return true; } } } });
  const esc = k.key('Escape', { altKey: false });
  assert.ok(k.names().includes('desktopBack'), 'Escape: the shell\'s Back');
  assert.equal(esc.defaultPrevented, true); assert.deepEqual(layout, [], 'before any layout key');
  k.key('KeyJ'); assert.deepEqual(layout, ['KeyJ'], 'other keys still reach the layout first');
  // desktopBack hands Escape to the shared registry (escape-back.js) with the recording, surface and fallback steps
  const back = runRecording(block(desktopSource, '  function desktopBack(event) {') + '\nglobalThis.back = desktopBack;', { escapeBack: fixture(), VOICE: { state: 'idle' }, window: {} });
  assert.equal(back.back({ key: 'Escape' }), '', 'a bare desktop: nothing to peel');
  assert.ok(back.calls.some(c => c[0] === 'escStep'), 'the window step comes last');
  // a layout that owns the list: the core list paints nothing under it (and empties what was there)
  const chats = withShellParts(withWebParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8')));
  let cleared = 0;
  const el = { innerHTML: '<old list>', replaceChildren() { cleared++; } };
  const list = runRecording(block(chats, '  function renderChatList(') + '\nglobalThis.render = renderChatList;', { H: { ownsChatList: () => true }, chanSide: null });
  list.render({ id: 'w1', thread: null }, el);
  assert.equal(cleared, 1); assert.equal(el.innerHTML, '<old list>', 'not painted');
  assert.ok(!list.calls.some(c => c[0] === 'syncListTitle'), 'stops before any list work');
});
