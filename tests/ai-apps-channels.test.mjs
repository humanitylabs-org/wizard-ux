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
  const ctx = {
    W, calls, host, listeners, document: { activeElement: null }, stage: { contains: n => n === host }, WeakSet,
    CHATS: { views: { providerFor: () => 'wizard-chats', defaultId: () => 'wizard-chats' },
      renderChatList: (w, el) => { calls.push(['paint', w.id, el === host]); el.firstElementChild = {}; },
      click: (e, id) => (calls.push(['click', id]), true), justPressed: () => false, channelBack: w => (calls.push(['back', w.id, w.thread]), true),
      renderChats: () => {} },
    findWin: fn => Object.values(W).find(fn) || null, openThread: sid => calls.push(['open', sid]), syncChatsPane: id => calls.push(['sync', id]), save() {}, skinShowChats: () => W['w-main'], newChat() {},
  };
  const main = js.split('\n').find(l => l.startsWith('  const mainChats = w =>'));
  const wins = js.split('\n').find(l => l.startsWith('  const listWins = {}'));
  const listWin = js.split('\n').find(l => l.startsWith('  function listWin('));
  const pane = slice(js, '    chatChannels: host => {', "    // The picker's Apps");
  const hostWin = js.split('\n').find(l => l.startsWith('    win: id => W[id] ||')), hostOwner = js.split('\n').find(l => l.startsWith('    owner: id => String(id).replace('));
  vm.createContext(ctx);
  vm.runInContext(`${main}\n${wins}\n${listWin}\nthis.api = { ${pane} };\nthis.H = { ${hostWin}\n${hostOwner} };`, ctx);
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
  const spacesData = [{ id: 'launch', name: 'Launch', threads: ['a'] }, { id: 'box', name: 'Box', agent: 'container', threads: ['k1'] }];
  const agents = { k1: 'container', r1: 'restricted', h1: 'host' };
  const env = { document: { documentElement: { dataset: { tweaks: 'wizard/chat-channels' } } }, localStorage: { getItem: () => null, setItem() {} }, window: {},
    spacesOf: sid => spacesData.filter(s => (s.agent || 'hermes') === (agents[sid] || 'hermes') && s.threads.includes(sid)), LIVE: {} };
  vm.createContext(env);
  vm.runInContext(block + ';this.api={channelOf,chanSide};', env);
  const { channelOf, chanSide } = env.api;
  assert.equal(channelOf({ id: 'a' }), 'Launch');
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
  assert.match(js, /else if \(docked\) closeChat\(\);\n\s+else if \(api\.sessions\?\.channelBack\?\.\(\)\) paintList\(\);/, 'Esc: thread → channel → list');
  const css = read('web/layouts/ai-apps/desktop.css');
  assert.match(css, /\.aad-panel:has\(\.aad-chan:not\(\[hidden\]\) :is\(\.ch-side-chan, \.ch-side-feed\)\) > \.aad-scroll \{ display: none; \}/, 'Channels and a feed take the rows\' place');
  assert.match(css, /\.aad-row:has\(\.aad-chan-line\) \{ height: auto; min-height: 56px;/, 'two lines at 56 px');
});
