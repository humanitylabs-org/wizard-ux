// Channels in the AI apps desktop sidebar (wizard/chat-channels, wizard-ux issue 1256). The sidebar reuses Chats' own
// Channels code: the desktop's id::side list window of the MAIN Chats window, painted into the layout's node through
// api.sessions.channels, plus a "# channel" on each Activity row (WizChatsListModel row.channel from CHATS.channelOf).
// Runs the real adapter code from web/desktop/desktop.js, the real list model, and the real Channels block of chats.js.
// Browser QA: tests/qa-chat-channels-ai-apps.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const slice = (js, a, b) => { const i = js.indexOf(a), j = js.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return js.slice(i, j); };
const kinds = ['main', 'host-profile', 'container', 'restricted'];

// The desktop adapter: the side pane, its clicks and its Back, with routed agents' Chats windows open (and found first).
function desktopWorld() {
  const js = read('web/desktop/desktop.js'), calls = [];
  const W = {}; [...kinds.slice(1), 'main'].forEach(k => { W['w-' + k] = { id: 'w-' + k, app: 'chats', thread: `t-${k}`, agent: k === 'main' ? '' : `qa-${k}` }; });
  const listeners = [];
  const host = { nodeType: 1, dataset: {}, firstElementChild: null, contains: () => false, replaceChildren() { calls.push(['clear']); }, addEventListener: (t, fn) => listeners.push([t, fn]) };
  // the layout's node in the main chat column (the channel feed, issue 1256 design change of 11 Nov 2026)
  const col = { nodeType: 1, dataset: {}, firstElementChild: null, isConnected: true, contains: () => false, replaceChildren() { calls.push(['clear-col']); this.firstElementChild = null; }, addEventListener: (t, fn) => listeners.push([t, fn, 'col']) };
  host.isConnected = true;
  const events = [];
  const ctx = {
    W, calls, host, col, events, listeners, document: { activeElement: null }, stage: { contains: n => n === host || n === col }, WeakSet, ownsChatList: true,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } }, dispatchEvent: e => events.push([e.type, JSON.parse(JSON.stringify(e.detail))]),
    CHATS: { views: { providerFor: () => 'wizard-chats', defaultId: () => 'wizard-chats' },
      renderChatList: (w, el) => { calls.push(['paint', w.id, el === host ? true : el === col ? 'col' : false]); el.firstElementChild = {}; },
      click: (e, id) => (calls.push(['click', id]), true), justPressed: () => false,
      // Chats' own Back from a feed: the channel closes and the Focus returns to the one it was opened from
      channelBack: w => { calls.push(['back', w.id, w.thread]); const o = ctx.H.win(ctx.H.owner(w.id)); if (o?.chan) { o.focus = o.chan.prev || null; o.chan = null; } return true; },
      chanOpen: w => { const o = ctx.H.win(ctx.H.owner(w.id)); return o?.chan ? { id: o.chan.id, name: o.chan.id[0].toUpperCase() + o.chan.id.slice(1) } : null; },
      focusOf: w => w?.focus || null, focusAgentId: w => w?.focus?.kind === 'agent' ? w.focus.key : w?.focus?.kind === 'space' ? 'hermes' : '',
      renderChats: () => {}, ch: id => (CH[id] ||= {}), forget: id => { calls.push(['forget', id]); delete CH[id]; } },
    findWin: fn => Object.values(W).find(fn) || null, openThread: sid => calls.push(['open', sid]), syncChatsPane: id => calls.push(['sync', id]), save() {}, skinShowChats: () => W['w-main'], newChat: () => calls.push(['new']),
    uid: () => 'wq' + (++n),
  };
  const CH = ctx.CH = {}; let n = 0;
  const main = js.split('\n').find(l => l.startsWith('  const mainChats = w =>'));
  const wins = js.split('\n').find(l => l.startsWith('  const listWins = {}')) + '\n' + js.split('\n').find(l => l.startsWith('  let sideHost = null, feedHost = null;'));
  const listWin = js.split('\n').find(l => l.startsWith('  function listWin('));
  const side = slice(js, '  let sideBase = null;', '  const CHATS = window.WizChatsHost.create({');
  const sideMain = slice(js, '  function sideMain() {', '  function syncChatsPane(id) {');
  const pane = slice(js, '    chatChannels: host => {', "    // The picker's Apps");
  const hostWin = js.split('\n').find(l => l.startsWith('    win: chatsWin,')), hostOwner = js.split('\n').find(l => l.startsWith('    owner: id => String(id).replace('));
  vm.createContext(ctx);
  vm.runInContext(`${side}\n${main}\n${wins}\n${listWin}\n${sideMain}\nthis.api = { ${pane} };\nthis.H = { ${hostWin}\n${hostOwner} };\nthis.sideNow = () => sideBase;\nthis.feedNow = () => feedBase;\nthis.feedPaneFor = feedPaneFor;\nthis.feedPane = feedPane;`, ctx);
  return ctx;
}
const ev = (attrs, sheet = false) => ({ target: { closest: sel => sel === '.ch-sheet' ? (sheet ? {} : null) : sel === '[data-chopen]' && attrs.chopen ? { dataset: { chopen: attrs.chopen } } : null }, stopPropagation() {} });

test('the sidebar pane is the MAIN Chats window\'s id::side list, never a routed agent\'s window', () => {
  const x = desktopWorld();
  assert.equal(x.api.chatChannels(x.host), true);
  assert.equal(x.host.dataset.chats, 'w-main::side');
  assert.deepEqual(x.calls.filter(c => c[0] === 'paint'), [['paint', 'w-main::side', true]]);
  for (const k of kinds.slice(1)) assert.ok(!JSON.stringify(x.calls).includes('w-' + k), `${k}: its window is never painted or touched`);
  for (const k of kinds) assert.equal(x.W['w-' + k].thread, `t-${k}`, `${k}: its own thread kept`);
  // The host lookups treat id::side like the desktop's id::list pane: the same window, owned by the main window.
  assert.equal(x.H.win('w-main::side').id, 'w-main::side');
  assert.equal(x.H.win('w-main::side').thread, null, 'a list window: never a thread of its own');
  assert.equal(x.H.owner('w-main::side'), 'w-main');
  assert.equal(x.H.owner('w-main::list'), 'w-main');
  assert.equal(x.H.win('w-nope::side'), undefined);
  // A node outside the stage is refused (the layout API also checks it is one of the layout's own mounted nodes).
  const stray = { ...x.host, dataset: {} }; x.calls.length = 0;
  assert.equal(x.api.chatChannels(stray), false); assert.deepEqual(x.calls, [['clear']]);
});

test('a post opens in the main Chats like a sidebar row; every other tap goes through Chats\' own click on id::side', () => {
  const x = desktopWorld(); x.api.chatChannels(x.host); x.api.chatChannels(x.host);
  assert.equal(x.listeners.filter(([t]) => t === 'click').length, 1, 'one click listener however often it repaints');
  const click = x.listeners[0][1];
  x.calls.length = 0; click(ev({ chopen: 's-routed' }));
  assert.deepEqual(x.calls, [['open', 's-routed']], 'a post opens through openThread (the main Chats window), nothing else');
  x.calls.length = 0; click(ev({}));
  assert.deepEqual(x.calls, [['click', 'w-main::side'], ['sync', 'w-main']]);
  x.calls.length = 0; click(ev({ chopen: 's-1' }, true));
  assert.deepEqual(x.calls, [['click', 'w-main::side'], ['sync', 'w-main']], 'a tap inside the channel sheet is the sheet\'s');
  // Back from a feed: the main window's side list (thread → channel → list), never a routed window.
  x.calls.length = 0; assert.equal(x.api.chatChannelBack(), true);
  assert.deepEqual(x.calls, [['back', 'w-main::side', null]]);
});

test('no main Chats window (a fresh desktop, a restored one without it): the tabs still paint, on a stand-in off the desks', () => {
  const x = desktopWorld(); for (const k of Object.keys(x.W)) delete x.W[k];
  assert.equal(x.api.chatChannels(x.host), true, 'the pane paints with no Chats window at all');
  const sb = x.sideNow(); assert.ok(sb && /^side-/.test(sb.id), 'a stand-in list window');
  assert.equal(x.host.dataset.chats, sb.id + '::side');
  assert.deepEqual(x.calls.filter(c => c[0] === 'paint'), [['paint', sb.id + '::side', true]]);
  assert.deepEqual(Object.keys(x.W), [], 'never put on a desk or into the saved windows');
  // Chats resolves it like any list window: its id::side pane, owned by the stand-in.
  assert.equal(x.H.win(sb.id), sb); assert.equal(x.H.win(sb.id + '::side').id, sb.id + '::side'); assert.equal(x.H.win(sb.id + '::side').thread, null);
  assert.equal(x.H.owner(sb.id + '::side'), sb.id);
  // Its taps go through Chats' click; a post opens in the main Chats (openThread makes one); Back works on it.
  const click = x.listeners[0][1];
  x.calls.length = 0; click(ev({})); assert.deepEqual(x.calls, [['click', sb.id + '::side'], ['sync', sb.id]]);
  x.calls.length = 0; click(ev({ chopen: 's-1' })); assert.deepEqual(x.calls, [['open', 's-1']]);
  x.calls.length = 0; x.H.win(sb.id + '::side').thread = 's-2'; assert.deepEqual(x.calls, [['open', 's-2']], 'a thread picked in it opens in the main Chats');
  x.calls.length = 0; x.H.win(sb.id + '::side').thread = '__new__'; assert.deepEqual(x.calls, [['new']]);
  x.calls.length = 0; assert.equal(x.api.chatChannelBack(), true); assert.deepEqual(x.calls, [['back', sb.id + '::side', null]]);
  // Painting again keeps the same stand-in (its open channel and scroll stay).
  x.api.chatChannels(x.host); assert.equal(x.sideNow(), sb);
});

test('a Chats window on another Chats view is not the main one: the stand-in backs the pane, that window is left alone', () => {
  const x = desktopWorld(); x.CHATS.views.providerFor = w => w.id === 'w-main' ? 'other-chats' : 'wizard-chats';
  assert.equal(x.api.chatChannels(x.host), true);
  assert.match(x.host.dataset.chats, /^side-.*::side$/);
  assert.equal(x.W['w-main'].thread, 't-main');
});

test('the first main Chats window takes over the stand-in; a channel left open in the sidebar (the earlier design) moves to the main column\'s feed', () => {
  const x = desktopWorld(); const main = x.W['w-main']; for (const k of Object.keys(x.W)) delete x.W[k];
  x.api.chatChannels(x.host); const sb = x.sideNow();
  sb.chan = { id: 'launch', prev: null }; sb.focus = { kind: 'space', key: 'launch' }; x.CH[sb.id] = { chanFilter: 'needs' };
  main.focus = { kind: 'agent', key: 'hermes' }; x.W['w-main'] = main;   // openThread from a post made the main Chats
  x.host.firstElementChild = {}; x.calls.length = 0;
  assert.equal(x.api.chatChannels(x.host), true);
  assert.equal(x.sideNow(), null, 'the stand-in is gone');
  assert.equal(x.host.dataset.chats, 'w-main::side');
  assert.equal(x.CH['w-main'].chanFilter, 'needs');
  assert.ok(x.calls.some(c => c[0] === 'forget' && c[1] === sb.id + '::side'));
  // The channel is not left in the sidebar: it is the main column's feed now, and the sidebar's Focus is its own again.
  const fb = x.feedNow(); assert.ok(fb && /^feed-/.test(fb.id), 'the feed window');
  assert.equal(fb.chan.id, 'launch'); assert.deepEqual(JSON.parse(JSON.stringify(fb.focus)), { kind: 'space', key: 'launch' });
  assert.equal(main.chan, null); assert.deepEqual(JSON.parse(JSON.stringify(main.focus)), { kind: 'agent', key: 'hermes' });
  assert.deepEqual(x.events, [['wos:channel-feed', { open: { id: 'launch', name: 'Launch' } }]], 'the layout is told: it shows the feed in the column');
  assert.deepEqual(x.calls.filter(c => c[0] === 'paint').at(-1), ['paint', 'w-main::side', true], 'the sidebar painted on the new window');
  // Back before the pane repaints (no feed open yet): the new main window takes the channel over first, so Back leaves it.
  const z = desktopWorld(); const m3 = z.W['w-main']; for (const k of Object.keys(z.W)) delete z.W[k];
  z.api.chatChannels(z.host); const sb3 = z.sideNow(); sb3.chan = { id: 'launch', prev: null }; z.W['w-main'] = m3; z.calls.length = 0;
  assert.equal(z.api.chatChannelBack(), true);
  assert.equal(z.sideNow(), null); assert.deepEqual(z.calls.filter(c => c[0] === 'back'), [['back', 'w-main::side', null]]);
  // No Chats window and no stand-in yet: Back has nothing to do.
  const e = desktopWorld(); for (const k of Object.keys(e.W)) delete e.W[k]; assert.equal(e.api.chatChannelBack(), false); assert.equal(e.sideNow(), null);
  // A main window with its own open channel (saved by the earlier design): carried to the feed on the next paint.
  const y = desktopWorld(); const m2 = y.W['w-main']; m2.chan = { id: 'box', prev: { kind: 'agent', key: 'hermes' } }; m2.focus = { kind: 'space', key: 'box' };
  y.api.chatChannels(y.host);
  assert.equal(y.feedNow().chan.id, 'box'); assert.equal(m2.chan, null); assert.deepEqual(JSON.parse(JSON.stringify(m2.focus)), { kind: 'agent', key: 'hermes' });
  assert.deepEqual(JSON.parse(JSON.stringify(y.api.chatFeedOpen())), { id: 'box', name: 'Box' });
});

test('a channel opened from the sidebar pane opens in the main column\'s own feed window (off the desks, never saved); the sidebar\'s window keeps its Focus', () => {
  const x = desktopWorld(), main = x.W['w-main']; main.focus = { kind: 'space', key: 'launch' };
  const keys = Object.keys(x.W).sort();
  x.api.chatChannels(x.host);
  const pane = x.H.win('w-main::side'), to = x.feedPaneFor(pane), fb = x.feedNow();
  assert.ok(fb && /^feed-/.test(fb.id)); assert.equal(to.id, fb.id + '::side');
  assert.deepEqual(JSON.parse(JSON.stringify(fb.focus)), { kind: 'agent', key: 'hermes' }, 'a fresh open starts from the sidebar\'s agent, never the Space it held');
  assert.deepEqual(main.focus, { kind: 'space', key: 'launch' }, 'the sidebar\'s own window is untouched');
  assert.deepEqual(Object.keys(x.W).sort(), keys, 'never put on a desk or into the saved windows');
  // Chats resolves it like the stand-in: its id::side pane, owned by the feed window; a thread picked opens in the main Chats.
  assert.equal(x.H.win(fb.id), fb); assert.equal(x.H.win(to.id).id, to.id); assert.equal(x.H.owner(to.id), fb.id);
  x.calls.length = 0; x.H.win(to.id).thread = 's-9'; assert.deepEqual(x.calls, [['open', 's-9']]);
  // Only the sidebar's pane opens elsewhere: the feed window itself, the classic list pane and a plain window open in place.
  assert.equal(x.feedPaneFor(x.H.win(to.id)), null); assert.equal(x.feedPane(x.H.win(to.id)), false);
  assert.equal(x.feedPane({ id: 'w-main::list' }), false); assert.equal(x.feedPane(main), false); assert.equal(x.feedPane(pane), true);
  // Main and routed agents alike: the feed starts on the agent the sidebar lists (General = that agent's own chats).
  for (const k of kinds) { main.focus = k === 'main' ? null : { kind: 'agent', key: `qa-${k}` }; x.feedPaneFor(pane);
    assert.deepEqual(JSON.parse(JSON.stringify(x.feedNow().focus)), main.focus, `${k}: the feed's agent`); assert.equal(x.feedNow().chan, null); }
  // A layout that does not own the chat list (Classic): no feed window at all.
  x.ownsChatList = false; assert.equal(x.feedPane(pane), false);
});

test('chatFeed paints the feed window into the column\'s node, nothing when no channel is open; Back closes the feed first and tells the layout', () => {
  const x = desktopWorld(); x.api.chatChannels(x.host);
  x.calls.length = 0;
  assert.equal(x.api.chatFeed(x.col), null, 'no feed window yet'); assert.equal(x.api.chatFeedOpen(), null);
  const to = x.feedPaneFor(x.H.win('w-main::side')), fb = x.feedNow();
  assert.equal(x.api.chatFeed(x.col), null, 'a feed window with no channel open');
  fb.chan = { id: 'launch', prev: fb.focus }; fb.focus = { kind: 'space', key: 'launch' }; x.calls.length = 0;
  assert.deepEqual(JSON.parse(JSON.stringify(x.api.chatFeed(x.col))), { id: 'launch', name: 'Launch' });
  assert.equal(x.col.dataset.chats, to.id);
  assert.deepEqual(x.calls, [['paint', to.id, 'col']], 'only the feed window is painted there');
  assert.deepEqual(JSON.parse(JSON.stringify(x.api.chatFeedOpen())), { id: 'launch', name: 'Launch' });
  // Its posts open in the main Chats (the column's thread); its other taps are Chats' own on the feed window.
  const click = x.listeners.find(l => l[2] === 'col')[1];
  x.calls.length = 0; click(ev({ chopen: 's-1' })); assert.deepEqual(x.calls, [['open', 's-1']]);
  x.calls.length = 0; x.events.length = 0; click(ev({}));
  assert.deepEqual(x.calls.slice(0, 1), [['click', to.id]]);
  assert.deepEqual(x.events, [['wos:channel-feed', { open: { id: 'launch', name: 'Launch' } }]], 'a tap in the feed (its back arrow) lets the layout follow');
  // Back: the feed closes (the column empties), the layout is told; the sidebar repaints without the mark.
  x.calls.length = 0; x.events.length = 0;
  assert.equal(x.api.chatChannelBack(), true);
  assert.deepEqual(x.calls[0], ['back', to.id, null]);
  assert.ok(x.calls.some(c => c[0] === 'paint' && c[1] === 'w-main::side' && c[2] === true), 'the sidebar list repainted');
  assert.deepEqual(x.events, [['wos:channel-feed', { open: null }]]);
  assert.equal(x.api.chatFeedOpen(), null); assert.equal(x.api.chatFeed(x.col), null);
  assert.equal(x.W['w-main'].chan, undefined, 'the sidebar window never held a channel');
  // A node outside the stage is refused.
  assert.equal(x.api.chatFeed({ ...x.col, dataset: {}, replaceChildren() {} }), null);
});

test('Activity rows carry their "# channel" from CHATS.channelOf (main and routed rows alike); none with the switch off', () => {
  const ctx = modelContext({}), M = ctx.WizChatsListModel;
  const rows = ['main', ...kinds.slice(1)].map(k => ({ id: `s-${k}`, title: `${k} chat`, status: 'completed', agent: k === 'main' ? '' : `qa-${k}` }));
  const names = { 's-main': 'Launch', 's-host-profile': 'Host ops', 's-container': 'Box', 's-restricted': 'General' };
  let on = true;
  const facts = { live: { isNew: () => false, cardAt: () => '' }, chats: { stiKind: () => 'none', threadActions: () => [], channelOf: s => on ? names[s.id] : '' }, pins: null };
  const list = M.sessionList({ ready: rows }, facts);
  assert.deepEqual(Object.fromEntries(list.ready.map(r => [r.id, r.channel])), names);
  on = false;
  assert.ok(M.sessionList({ ready: rows }, facts).ready.every(r => !('channel' in r)), 'switch off: the rows as today');
  delete facts.chats.channelOf;
  assert.ok(M.sessionList({ ready: rows }, facts).ready.every(r => !('channel' in r)), 'an adapter without Channels: the rows as today');
});

test('the real channelOf / chanSide: names per agent, only with the switch on; only id::side is a sidebar pane', () => {
  const src = read('web/core/chats.js');
  const block = slice(src, '  /* Channels view (switch wizard/chat-channels', '  function clearAll(w)');
  // 'x' is both a main thread (in Launch) and a container agent's thread (in Box): the row's own owner decides.
  const spacesData = [{ id: 'launch', name: 'Launch', threads: ['a', 'x'] }, { id: 'box', name: 'Box', agent: 'container', threads: ['k1', 'x'] }, { id: 'ops', name: 'Ops', agent: 'host', threads: ['x'] }];
  const agents = { k1: 'container', r1: 'restricted', h1: 'host', x: 'container' }; // the id-only pin points at one of them
  const env = { document: { documentElement: { dataset: { tweaks: 'wizard/chat-channels' } } }, localStorage: { getItem: () => null, setItem() {} }, window: {},
    spaces: () => spacesData, spaceAgent: s => s?.agent || 'hermes', spaceContains: (key, sid) => !!spacesData.find(s => s.id === key)?.threads.includes(sid),
    AGS: () => ({ defaultId: () => 'hermes' }), LIVE: { ownerOf: s => s.owner ?? agents[s.id] ?? '', agentOf: id => agents[id] || '' } };
  vm.createContext(env);
  vm.runInContext(block + ';this.api={channelOf,chanSide};', env);
  const { channelOf, chanSide } = env.api;
  assert.equal(channelOf({ id: 'a' }), 'Launch');
  assert.equal(channelOf({ id: 'x', owner: '' }), 'Launch', 'same id: the main row is in the main Space');
  assert.equal(channelOf({ id: 'x', owner: 'container' }), 'Box', 'same id: the container row is in its own Space');
  assert.equal(channelOf({ id: 'x', owner: 'host' }), 'Ops', 'same id: the host-profile row is in its own Space');
  assert.equal(channelOf({ id: 'x', owner: 'restricted' }), 'General', 'same id: the restricted row, filed nowhere, is in General');
  assert.equal(channelOf({ id: 'k1' }), 'Box', 'a container agent\'s row is in its own agent\'s Space');
  assert.equal(channelOf({ id: 'r1' }), 'General', 'a restricted agent\'s unfiled row is in General');
  assert.equal(channelOf({ id: 'h1' }), 'General', 'a host-profile agent\'s unfiled row is in General');
  assert.equal(chanSide({ id: 'w1::side' }), true);
  for (const id of ['w1', 'w1::list', 'side']) assert.equal(chanSide({ id }), false, id);
  env.document.documentElement.dataset.tweaks = '';
  assert.equal(channelOf({ id: 'a' }), '', 'switch off: no channel');
  assert.equal(chanSide({ id: 'w1::side' }), false, 'switch off: the pane paints nothing');
});

test('Chats paints the side pane only with the switch on: tabs, then the channel list or a feed with its box; the layout wires it', () => {
  const src = read('web/core/chats.js');
  const r = slice(src, '  function renderChatList(w, el) {', '    syncListTitle(w);');
  assert.match(r, /const side = typeof chanSide === 'function' && chanSide\(w\);\n\s+if \(!side\) \{[^]*if \(H\.ownsChatList\?\.\(\)\) \{ el\?\.replaceChildren\(\); return; \}\n\s+\}/, 'a layout-owned list stays empty unless it is the switched-on side pane');
  assert.match(r, /chanSwitchedOff\(w\)\) H\.layout/, 'switched off inside a feed: the Focus returns');
  assert.match(src, /const head = side \? chanHead\(w, feed\) :/, 'the pane\'s head is the Channels tabs or the feed\'s header only (no search: the sidebar has its own)');
  assert.match(src, /if \(side && !feed && chanView !== 'channels'\) body = '';/, 'Activity: the sidebar draws its own rows');
  assert.match(src, /const html = side \? `<div data-part="list" class="ch-list ch-side\$\{feed \? ' ch-side-feed' : chanView === 'channels' \? ' ch-side-chan' : ''\}">\$\{head\}<div class="ch-scroll">\$\{body\}<\/div>\$\{feed \? fab : ''\}<\/div>`/);
  assert.match(src, /readyBack, channelBack, chanOpen, channelOf,/, 'channelOf is on the Chats API');
  const host = read('web/core/skin-host.js');
  assert.match(host, /channels: node => live\(\) && node\?\.nodeType === 1 && \[\.\.\.a\.mounts\]\.some\(m => m\.contains\(node\)\) \? !!shell\.chatChannels\?\.\(node\) : false,/, 'only the layout\'s own mounted nodes');
  assert.match(host, /channelBack: \(\) => live\(\) \? !!shell\.chatChannelBack\?\.\(\) : false,/);
  const js = read('web/layouts/ai-apps/desktop.js');
  assert.match(js, /const chanBox = el\('div', 'aad-chan'\); chanBox\.hidden = true;/);
  assert.match(js, /panel\.append\(head, agentsRow, chanBox, scroll, foot\)/);
  assert.match(js, /const paintChan = \(\) => \{ const on = !q && !!api\.sessions\.channels\?\.\(chanBox\);/, 'hidden while the sidebar searches');
  assert.match(js, /if \(s\.channel\) title\.append\(el\('span', 'aad-chan-line', \{ text: `# \$\{s\.channel\}` \}\)\);/);
  assert.match(js, /else if \(docked\) closeChat\(\);\n\s+else if \(api\.sessions\?\.channelBack\?\.\(\)\) paintList\(\);/, 'Esc: a docked thread or feed first');
  // The design change of 11 Nov 2026: the feed is a chat in the column (FEED), Back from a post lands on it, Esc closes it.
  assert.match(js, /if \(!h\.app\) chatThread = h\.thread \|\| \(h\.note \? NOTE : h\.draft \? DRAFT : feedOn\(\) \? FEED : null\);/, 'no thread in the column and a channel open: its feed');
  assert.match(js, /if \(chatThread === FEED\) \{ chatThread = null; anim\('undock'\); api\.sessions\.channelBack\?\.\(\); paintTop\(\); return true; \}/, 'Esc / ✕ on the feed: nothing open');
  assert.match(js, /api\.listen\(globalThis, 'wos:channel-feed', e => feedOpened\(e\?\.detail\?\.open \|\| null\)\);/);
  assert.match(js, /const open = on \? api\.sessions\.channelFeed\?\.\(feedBox\) : null;/);
  assert.match(host, /channelFeed: node => live\(\) && node\?\.nodeType === 1 && \[\.\.\.a\.mounts\]\.some\(m => m\.contains\(node\)\) \? shell\.chatFeed\?\.\(node\) \|\| null : null,/, 'only the layout\'s own mounted nodes');
  // Chats: the sidebar's pane never draws a feed (its channels open in the feed window), the feed window nothing else.
  assert.match(src, /feed = chanOn && !\(typeof chanElsewhere === 'function' && chanElsewhere\(w\)\) \? chanOpen\(w\) : null;/, 'opening a channel never replaces the sidebar list');
  assert.match(src, /if \(side && !feed && typeof chanElsewhere === 'function' && typeof H\.channelsElsewhere === 'function' && !chanElsewhere\(w\)\) \{ el\.replaceChildren\(\); return; \}/);
  const css = read('web/layouts/ai-apps/desktop.css');
  assert.match(css, /\.aad-panel:has\(\.aad-chan:not\(\[hidden\]\) :is\(\.ch-side-chan, \.ch-side-feed\)\) > \.aad-scroll \{ display: none; \}/, 'Channels and a feed take the rows\' place');
  assert.match(css, /\.aad-row:has\(\.aad-chan-line\) \{ height: auto; min-height: 56px;/, 'two lines at 56 px');
});
