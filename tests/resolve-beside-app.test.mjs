// James, 6 Nov 2026 (AI apps desktop, window modes): "on an alert that popped up, I clicked Resolve this notification,
// and it popped it over full width behind the background of the app on the right side".
// Root cause: a notification docked beside an app panel is the Chats window's New chat. Resolve this sends it, and a New
// chat send on desktop always left to the list (leaveAfterSend); the AI apps layout turns the list into Home, and Home
// with an app panel open is the Chats desk laid out full width, under the panel (z 3). The fix keeps a New chat that a
// layout docks beside an app open in its column (host keepNewOpen), sends Resolve in place on the notification already
// shown, and the layout carries the docked notification over as a docked chat while the send is pending.
// Browser proof: tests/qa-resolve-beside-app.cjs (real clicks in tiled / centre / pair / full).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const chats = read('core/chats.js'), desk = read('desktop/desktop.js'), aad = read('layouts/ai-apps/desktop.js');

function slice(src, start) {
  const at = src.indexOf(start); assert.ok(at >= 0, 'missing ' + start);
  let depth = 0, i = src.indexOf('{', at);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(at, i + 1);
}

function leave({ phone = false, keepNew, agent }) {
  const w = { id: 'w1', thread: '__new__', ...(agent ? { agent } : {}) }, c = { readNav: 0, trail: [] };
  const ctx = { W: { w1: w }, hosted: new Map(), H: keepNew === undefined ? { keepThreadOpen: true } : { keepThreadOpen: true, keepNewOpen: id => keepNew(id) },
    keepThreadOpen: () => true, PHONE: () => phone, ch: () => c, threadBack() {}, save() {}, openChat() {} };
  vm.createContext(ctx);
  vm.runInContext(slice(chats, 'function leaveAfterSend(') + '\nthis.leaveAfterSend = leaveAfterSend;', ctx);
  return { left: ctx.leaveAfterSend('w1', '__new__', true, 'tapping Resolve this'), thread: w.thread };
}

test('a New chat docked beside an app stays open after its send; elsewhere it still leaves to the list', () => {
  const asked = [];
  const kept = leave({ keepNew: id => { asked.push(id); return true; } });
  assert.equal(kept.left, false); assert.equal(kept.thread, '__new__'); assert.deepEqual(asked, ['w1']);
  const home = leave({ keepNew: () => false });
  assert.ok(home.left); assert.equal(home.thread, null);
  const stock = leave({});
  assert.ok(stock.left); assert.equal(stock.thread, null);
});

test('main and routed-agent New chats docked beside an app follow the same post-send navigation', () => {
  // keepNewOpen is keyed by window/desk only: a host-profile, container or restricted route must not navigate differently.
  for (const agent of [undefined, 'main', 'host:alice', 'container:research', 'restricted:guest']) {
    const kept = leave({ agent, keepNew: () => true });
    assert.equal(kept.left, false, `kept open for ${agent || 'default'}`); assert.equal(kept.thread, '__new__');
    const home = leave({ agent, keepNew: () => false });
    assert.ok(home.left, `leaves to the list for ${agent || 'default'}`); assert.equal(home.thread, null);
  }
  assert.doesNotMatch(slice(chats, 'function leaveAfterSend('), /agent/i, 'post-send navigation never branches on the agent route');
});

test('desktop host keeps the New chat open only where a layout shows its desk beside an app', () => {
  // wizard-ux issue 1311 widened it: every desktop New chat stays open in its thread after its send.
  assert.match(desk, /keepNewOpen: \(\) => true,/);
  // routeShows is the AI apps layout's "this desk is on screen beside the app panel" (docked chat + app panel)
  assert.match(aad, /shows: desk => .*\(docked && !!pane && !!dockEl && deskOfNode\(dockEl\) === desk\)/);
});

test('Resolve this on the notification the window shows sends in place (no list hop)', () => {
  const line = desk.split('\n').find(l => l.includes('contextDraft: (key, item, words, draft) =>'));
  assert.ok(line);
  assert.match(line, /const inPlace = !!words && !draft && String\(key\)\.startsWith\('notifications:'\) && CHATS\.notifOpen\?\.\(w\.id\) === String\(key\)\.slice\(14\);/);
  assert.match(line, /if \(!inPlace\) \{ CHATS\.openContextDraft\(w\.id, key, item, draft\);/);
  assert.match(line, /if \(words\) CHATS\.sendChat\(w\.id, words, 'tapping Resolve this on a notification in Chats'\)/);
});

test('AI apps: the docked notification carries over as a docked chat while its send is pending (app panel open only)', () => {
  assert.match(aad, /if \(!h\.app && pane && chatThread === NOTE && !h\.thread && !h\.note && !h\.draft && !r\.home && r\.view === 'thread' && r\.thread === '__new__' && onMainChats\(r\)\) \{ draftWant = true; h\.draft = true; \}/);
  assert.match(aad, /const newChat = \(\) => \{ draftWant = false; if \(chatThread === NOTE\) chatThread = null;/);
});
