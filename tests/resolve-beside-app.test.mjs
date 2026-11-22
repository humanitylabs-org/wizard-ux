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
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { between, runRecording } from './fixtures/source-slice.mjs';

const read = p => withShellParts(withWebParts(readFileSync(new URL('../web/' + p, import.meta.url), 'utf8')));
const chats = withParts(read('core/chats.js')), desk = read('desktop/desktop.js'), aad = read('layouts/ai-apps/desktop.js');

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

// The real lines, each run on its own: the desktop's Chats host options (desktop-sideview.js), its contextDraft hook
// (desktop-boot.js), and the AI apps view's route `shows` and its notification-to-chat carry (desktop-keys.js,
// desktop-home.js), with recorders for everything they call (tests/fixtures/source-slice.mjs).
const raw = p => readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const sideview = raw('desktop/desktop-sideview.js'), boot = raw('desktop/desktop-boot.js'), keys = raw('layouts/ai-apps/desktop-keys.js'), home = raw('layouts/ai-apps/desktop-home.js');
const valueAfter = (src, key, next) => between(src, key, next).slice(key.length).trim().replace(/,$/, '');

test('desktop host keeps the New chat open only where a layout shows its desk beside an app', () => {
  // wizard-ux issue 1311 widened it: every desktop New chat stays open in its thread after its send.
  const keepNewOpen = runRecording(`globalThis.f = ${valueAfter(sideview, 'keepNewOpen:', '\n')};`, {}).f;
  assert.equal(keepNewOpen(), true);
  // routeShows is the AI apps layout's "this desk is on screen beside the app panel" (docked chat + app panel)
  const shows = (vars, slots = []) => runRecording(`globalThis.f = ${valueAfter(keys, 'shows:', '\n  });')};`,
    { aadVars: vars, panes: { get: () => ({ slots }) }, deskOfNode: n => n.desk, Number }).f;
  const dock = { desk: 2 };
  assert.equal(shows({ docked: true, pane: { desk: 3 }, dockEl: dock })(2), true, 'the Chats desk while its chat is docked beside an open app');
  assert.equal(shows({ docked: true, pane: null, dockEl: dock })(2), false, 'no app panel: not beside anything');
  assert.equal(shows({ docked: false, pane: { desk: 3 }, dockEl: dock })(2), false, 'not docked');
  assert.equal(shows({ docked: true, pane: { desk: 3 }, dockEl: dock })(1), false, 'another desk');
  assert.equal(shows({ pane: { desk: 3 } }, ['app'])(3), true, 'the app panel\'s own desk');
});

function contextDraft({ notifOpen = 'n42', homeOpen = false } = {}) {
  const calls = [], rec = name => (...a) => { calls.push([name, ...a]); };
  const CHATS = { notifOpen: () => notifOpen, openContextDraft: rec('CHATS.openContextDraft'), renderChats: rec('CHATS.renderChats'), sendChat: rec('CHATS.sendChat') };
  const ctx = runRecording(`globalThis.f = ${valueAfter(boot, 'contextDraft:', '\n    models:')};`,
    { desktopVars: { homeOpen }, skinChatsWin: () => ({ id: 'w1' }), String, setTimeout: () => 0, CHATS, calls });
  return { run: (...a) => { ctx.calls.length = 0; const r = ctx.f(...a); return { r, calls: ctx.calls.map(c => c[0]) }; }, ctx };
}

test('Resolve this on the notification the window shows sends in place (no list hop)', () => {
  const c = contextDraft();
  const shown = c.run('notifications:n42', { title: 'Disk' }, 'Resolve this', null);
  assert.equal(shown.r, true);
  assert.ok(!shown.calls.includes('CHATS.openContextDraft'), 'the notification already shown is not reopened as a draft');
  const send = c.ctx.calls.find(x => x[0] === 'CHATS.sendChat');
  assert.deepEqual(send, ['CHATS.sendChat', 'w1', 'Resolve this', 'tapping Resolve this on a notification in Chats'], 'sent in place');
  const other = c.run('notifications:n7', { title: 'Other' }, 'Resolve this', null);
  assert.deepEqual(other.calls.filter(n => n.startsWith('CHATS.') && n !== 'CHATS.notifOpen'), ['CHATS.openContextDraft', 'CHATS.renderChats', 'CHATS.sendChat'], 'another notification is opened, then sent');
  const draft = c.run('notifications:n42', { title: 'Disk' }, 'Resolve this', { text: 'mine' });
  assert.ok(draft.calls.includes('CHATS.openContextDraft'), 'a draft of its own is opened first');
  const noWords = c.run('notifications:n42', { title: 'Disk' }, '', null);
  assert.ok(!noWords.calls.includes('CHATS.sendChat'), 'no words: nothing sent');
});

test('AI apps: the docked notification carries over as a docked chat while its send is pending (app panel open only)', () => {
  const line = between(keys, '    if (!h.app && aadVars.pane && aadVars.chatThread === NOTE', '\n');
  const carry = ({ pane = { desk: 3 }, chatThread = 'NOTE', r = { home: false, view: 'thread', thread: '__new__' }, h = {} } = {}) => {
    const ctx = runRecording(`${line}\nglobalThis.out = { h, aadVars };`, { h: { ...h }, r, aadVars: { pane, chatThread }, NOTE: 'NOTE', onMainChats: () => true });
    return ctx.out;
  };
  const on = carry();
  assert.equal(on.h.draft, true, 'the New chat it became shows as the docked chat'); assert.equal(on.aadVars.draftWant, true);
  assert.notEqual(carry({ pane: null }).h.draft, true, 'no app panel: nothing to dock beside');
  assert.notEqual(carry({ chatThread: 'thread-1' }).h.draft, true, 'only a notification carries over');
  assert.notEqual(carry({ r: { home: true, view: 'thread', thread: '__new__' } }).h.draft, true, 'Home is Home');
  // a New chat of its own drops the carried notification
  const newChat = between(home, '  const newChat = () => {', '\n');
  const n = runRecording(`${newChat}\nnewChat(); globalThis.out = aadVars;`, { aadVars: { draftWant: true, chatThread: 'NOTE' }, NOTE: 'NOTE', FEED: 'FEED', feedOn: () => false, api: { sessions: { newChat() {} } } });
  assert.equal(n.out.draftWant, false); assert.equal(n.out.chatThread, null);
});
