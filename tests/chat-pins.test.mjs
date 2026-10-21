import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = () => read('web/core/chat-pins.js');

function pins(initial = {}) {
  const store = new Map(Object.entries(initial));
  const events = [];
  const listeners = {};
  const window = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    dispatchEvent(event) { events.push(event.type); for (const fn of listeners[event.type] || []) fn(event); },
  };
  const context = {
    window,
    Event: class { constructor(type) { this.type = type; } },
    localStorage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
    },
  };
  vm.createContext(context);
  vm.runInContext(source(), context);
  return { api: window.WosChatPins, store, events };
}

test('pin order is stable, rows are partitioned once, and unpin restores normal order', () => {
  const p = pins();
  assert.equal(p.api.toggle('b'), true);
  assert.equal(p.api.toggle('a'), true);
  assert.deepEqual([...p.api.ids()], ['b', 'a']);
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  let split = p.api.partition(rows, row => !row.archived);
  assert.deepEqual([...split.pinned].map(x => x.id), ['b', 'a']);
  assert.deepEqual([...split.rest].map(x => x.id), ['c']);
  assert.equal(new Set([...split.pinned, ...split.rest]).size, rows.length);
  assert.equal(p.api.toggle('b'), false);
  split = p.api.partition(rows, row => !row.archived);
  assert.deepEqual([...split.pinned].map(x => x.id), ['a']);
  assert.deepEqual([...split.rest].map(x => x.id), ['b', 'c']);
});

test('pins persist through reload and archived rows retain normal archive semantics', () => {
  const first = pins();
  first.api.toggle('thread-2');
  first.api.toggle('thread-1');
  const second = pins(Object.fromEntries(first.store));
  assert.deepEqual([...second.api.ids()], ['thread-2', 'thread-1']);
  const rows = [{ id: 'thread-1', archived: true }, { id: 'thread-2' }, { id: 'thread-3' }];
  const split = second.api.partition(rows, row => !row.archived);
  assert.deepEqual([...split.pinned].map(x => x.id), ['thread-2']);
  assert.deepEqual([...split.rest].map(x => x.id), ['thread-1', 'thread-3']);
  assert.equal(second.api.scope, 'device');
});

test('both shells load pins before Chats and expose menu plus direct row controls', () => {
  for (const page of ['web/index.html', 'web/desktop.html']) {
    const html = read(page);
    assert.ok(html.indexOf('core/chat-pins.js') > -1, `${page} loads pin state`);
    assert.ok(html.indexOf('core/chat-pins.js') < html.indexOf('core/chats.js'), `${page} loads pin state first`);
  }
  const chats = read('web/core/chats.js');
  const css = read('web/core/chats.css');
  assert.match(chats, /data-rspin/);
  assert.match(chats, /Unpin|Pin/);
  assert.match(chats, /data-sec="pinned"/);
  assert.match(chats, /PIN\.partition\(hit/);
  assert.match(chats, /data-chpin=/, 'each sidebar row has a direct pin control');
  assert.match(chats, /aria-pressed=/, 'the pin control exposes pressed state');
  assert.match(chats, /Pin chat:|Unpin chat:/, 'the pin control has an action label');
  assert.match(chats, /class="ch-pin-svg"/, 'the control uses a recognizable SVG, not an emoji');
  assert.match(css, /\.ch-pin-toggle:focus-visible/, 'keyboard focus reveals the control');
  assert.match(css, /pointer: coarse/, 'touch layouts keep the control discoverable');
});
