// Channels (wizard/chat-channels): + New channel (wizard-ux issue 1308), the sidebar tab deciding + / ⌥N / the voice
// key (issue 1310) and a desktop New chat staying open after its send (issue 1311). James, 12 Nov 2026: "When I hit the
// plus button, while I'm on the channel view, I guess I would intuitively expect this to create a new channel"; "when
// I'm in the activity view and I hit the plus button … I would expect it to create a new thread"; "when I hit send …
// it closed the chat and just showed my background". The shipped source runs here; only the shell around it is stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const j = x => JSON.parse(JSON.stringify(x));
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const chats = read('web/core/chats.js'), desktop = read('web/desktop/desktop.js'), aad = read('web/layouts/ai-apps/desktop.js');
const cut = (src, from, to) => { const a = src.indexOf(from); assert.ok(a >= 0, from); const b = src.indexOf(to, a + from.length); assert.ok(b > a, to); return src.slice(a, b); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// --- the list row and the form it opens (chats.js) ---
function list({ agents = [{ id: 'hermes' }], view = 'channels', open = null, q = '', archived = [] } = {}) {
  const calls = [], wins = { w1: { id: 'w1', thread: null }, 'w1::side': { id: 'w1::side', thread: null } };
  const ctx = {
    calls, esc, chanView: view, chanArchOpen: false, chanCarried: true, chanCarryAfter: 0,
    W: wins, channelsOn: () => true, chanOpen: () => open, norm: s => String(s || '').trim().toLowerCase(), ch: () => ({ q }),
    elOf: () => ({ querySelector: () => null }), focusAgents: () => agents, focusOf: () => null, focusedAgent: () => '',
    channelsFor: (w, o = {}) => o.archived ? archived : [{ id: 'b', name: 'Beta' }, { id: '__general__', name: 'General', general: true }],
    channelLine: c => `<div class="ch-chan" data-chchan="${c.id}"></div>`, chanPruned: () => false, chanElsewhere: () => false, H: {}, chanStore: () => null,
    openSpacePicker: (w, a, tab, o) => { calls.push(['picker', w.id, a, j(o)]); ctx.spacePicker = { o }; }, spacePicker: null,
  };
  vm.createContext(ctx);
  vm.runInContext(cut(chats, '  const chanNewAgent = w =>', '  /* A post is the owner') + '\nthis.channelsBody = channelsBody; this.chanNew = chanNew;', ctx);
  return ctx;
}

test('1308: the Channels list ends with an accent + New channel row after General, before Archive', () => {
  const c = list({ archived: [{ id: 'old', name: 'Old' }] }), html = c.channelsBody(c.W.w1, []);
  const gen = html.indexOf('data-chchan="__general__"'), add = html.indexOf('data-chchannew'), arch = html.indexOf('data-sec="chan-archive"');
  assert.ok(gen >= 0 && add > gen && arch > add, 'General, then + New channel, then Archive');
  assert.match(html, /<button type="button" class="ch-chan-add" data-chchannew aria-haspopup="dialog">[^]*New channel<\/b><\/button>/);
  assert.doesNotMatch(list({ agents: [] }).channelsBody({ id: 'w1' }, []), /data-chchannew/, 'no agent to own a channel: no row');
  const css = read('web/tweaks/wizard/chat-channels/tweak.css');
  assert.match(css, /\.ch-chan-add \{[^}]*min-height: 44px;[^}]*color: var\(--wz-accent/, 'one line high like the channels, in the skin accent');
});

test('1308: chanNew opens the existing name form only on the Channels list with no channel open', () => {
  const c = list();
  assert.equal(c.chanNew('w1::side'), true);
  assert.deepEqual(j(c.calls), [['picker', 'w1::side', 'hermes', { naming: true, from: 'w1::side', direct: true }]], 'naming form, opened straight on its input');
  for (const [why, o] of [['Activity tab', { view: 'activity' }], ['a channel open', { open: { id: 'b' } }], ['a search typed', { q: 'x' }]]) {
    const d = list(o); assert.equal(d.chanNew('w1'), false, why); assert.equal(d.calls.length, 0, why);
  }
  assert.match(cut(chats, '  function channelClick(', '  /* The channel'), /const nc = e\.target\.closest\('\[data-chchannew\]'\); if \(nc\) \{ chanNewForm\(w, nc\); return true; \}/, 'the row opens the form');
  assert.match(chats, /if \(p\.naming && !p\.busy && !p\.direct\) \{ p\.naming = false; renderSpacePicker\(\); \} else closeSpacePicker\(\);/, 'Esc on a direct form cancels it');
});

// --- creating: the empty feed, never the "Fill my new Space" chat ---
async function create(channelsOn) {
  const calls = [], p = { wid: 'w1', from: 'w1::side', agent: 'hermes', name: 'Test', sid: '', busy: false };
  const ctx = {
    calls, SPACE: { get ch() { return channelsOn; } }, spacePicker: p, CHAN_STORE_MAX: 200, crypto: { randomUUID: () => 'uuid' },
    W: { w1: { id: 'w1' }, 'w1::side': { id: 'w1::side' } }, spaces: () => [{ id: 'a', name: 'Alpha', agent: 'hermes' }], spaceAgent: s => s.agent, norm: s => s.toLowerCase(),
    chanStore: () => ({}), storeAgent: a => a, LIVE: { chanStore: { create: async (name, agent) => (calls.push(['create', name, agent]), { id: 'ch-new' }) }, prefOps: async () => true },
    spaceMember() {}, renderSpacePicker() {}, closeSpacePicker: () => { ctx.spacePicker = null; calls.push(['close']); },
    chanTarget: w => (calls.push(['target', w.id]), { id: 'feed::side' }), openChannel: (w, id) => (calls.push(['open', w.id, id]), true), chanToEnd: (id, f) => calls.push(['end', id, f]),
    setTimeout: fn => fn(), setFocus: (w, f) => calls.push(['focus', w.id, j(f)]), sendChat: async (...a) => (calls.push(['sendChat', a[1].slice(0, 20)]), {}), toast() {},
  };
  vm.createContext(ctx);
  vm.runInContext(cut(chats, '  async function createPickerSpace(p) {', '  function bindFocusStrip(') + '\nthis.createPickerSpace = createPickerSpace;', ctx);
  await ctx.createPickerSpace(p);
  return j(calls);
}

test('1308: creating a channel opens its empty feed with the box focused and sends no agent chat', async () => {
  const on = await create(true);
  assert.deepEqual(on, [['create', 'Test', 'hermes'], ['close'], ['target', 'w1::side'], ['open', 'feed::side', 'ch-new'], ['end', 'feed::side', true], ['end', 'feed::side', true]]);
  assert.ok(!on.some(c => c[0] === 'sendChat'), 'no "Fill my new Space" chat with channels on');
  // General is always a channel (wizard-ux issue 1308): its name is taken.
  assert.match(chats, /norm\(s\.name\) === norm\(name\)\) \|\| \(SPACE\.ch && norm\(name\) === 'general'\)\) \{ p\.error = SPACE\.ch \? 'Already a channel'/);
  const off = await create(false);
  assert.deepEqual(off.at(-1), ['sendChat', 'Fill my new Space “T'], 'classic Spaces (switch off) keep their auto-fill');
});

// --- the shell's + / ⌥N (desktop.js) ---
function shellNew({ owns = true, view = 'channels', feed = null, side = true, focused = null, open = null } = {}) {
  const asked = [];
  const ctx = { asked, ownsChatList: owns, feedOpen: () => feed, focused: () => focused, sideMain: () => ({ id: 'main' }),
    sideHost: side ? { isConnected: true, closest: () => null } : { isConnected: true, closest: () => ({}) },
    CHATS: { chanView: () => view, chanOpen: () => open, chanNew: wid => (asked.push(wid), true) } };
  vm.createContext(ctx); vm.runInContext(cut(desktop, '  function chanNew() {', '  // A take started in a channel') + '\nthis.chanNew = chanNew;', ctx);
  return ctx;
}

test('1308: + / ⌥N on the Channels list (AI apps sidebar or a classic Chats window) opens the new-channel form', () => {
  const a = shellNew(); assert.equal(a.chanNew(), true); assert.deepEqual(a.asked, ['main::side']);
  for (const [why, o] of [['Activity tab', { view: 'activity' }], ['switch off', { view: '' }], ['a feed open in the column', { feed: { id: 'x' } }], ['sidebar folded to the rail', { side: false }]]) {
    const s = shellNew(o); assert.equal(s.chanNew(), false, why); assert.deepEqual(s.asked, [], why);
  }
  const c = shellNew({ owns: false, focused: { id: 'w7', app: 'chats' } }); assert.equal(c.chanNew(), true); assert.deepEqual(c.asked, ['w7::list'], 'classic: the window\'s list pane');
  assert.equal(shellNew({ owns: false, focused: { id: 'w7', app: 'chats' }, open: { id: 'b' } }).chanNew(), false, 'classic with a channel open: its box (chanPost) instead');
  assert.equal(shellNew({ owns: false, focused: { id: 'a', app: 'frame' } }).chanNew(), false);
  assert.match(desktop, /code === 'KeyN'\) return hit\(\(\) => \{[^\n]*chanPost\(\) \|\| chanNew\(\) \|\| newChat\(\); \}\);/, '⌥N: channel box, else new channel, else New chat');
  assert.match(desktop, /chatChannelNew: \(\) => chanNew\(\),\n    chatChannelView: \(\) => CHATS\.chanView\?\.\(\) \|\| '',/);
  const host = read('web/core/skin-host.js');
  assert.match(host, /channelNew: \(\) => live\(\) \? !!shell\.chatChannelNew\?\.\(\) : false,/);
  assert.match(host, /channelView: \(\) => live\(\) \? shell\.chatChannelView\?\.\(\) \|\| '' : '',/);
});

// --- the AI apps sidebar's + (layouts/ai-apps/desktop.js): its tab decides ---
function aiPlus({ view, feed = null, thread = null, post = true, made = true }) {
  const calls = [];
  const ctx = { calls, FEED: '__feed__', chatThread: thread, feedOn: () => feed, closeMenu: () => calls.push('closeMenu'), newChat: () => calls.push('newChat'),
    api: { sessions: { channelView: () => view, channelPost: () => (calls.push('channelPost'), post), channelNew: () => (calls.push('channelNew'), made) } } };
  vm.createContext(ctx);
  vm.runInContext(cut(aad, '  const newOrPost = () =>', '  api.listen(newBtn') + '\nthis.plus = plus;', ctx);
  ctx.plus(); return calls;
}

test('1310: the AI apps + follows the sidebar tab, not a feed left in the main column', () => {
  const FEED = '__feed__', general = { id: '__general__', name: 'General' };
  assert.deepEqual(aiPlus({ view: 'activity', feed: general, thread: FEED }), ['newChat'], 'Activity: a blank new chat (newChat closes the feed), never General\'s box');
  assert.deepEqual(aiPlus({ view: 'channels', feed: general, thread: FEED }), ['channelPost', 'closeMenu'], 'Channels › General: its box');
  assert.deepEqual(aiPlus({ view: 'channels' }), ['channelNew', 'closeMenu'], 'Channels list, none open: a new channel');
  assert.deepEqual(aiPlus({ view: 'activity', made: false }), ['channelNew', 'newChat'], 'Activity with nothing open: New chat');
  assert.match(aad, /const newChat = \(\) => \{[^\n]*if \(chatThread === FEED \|\| feedOn\(\)\) \{ chatThread = null; api\.sessions\.channelBack\?\.\(\); \}/, 'newChat closes the leftover feed first');
});

// --- the voice key with a leftover feed (desktop.js chanFront) ---
test('1310: the voice key on Activity starts a new chat even with a feed left in the column; on Channels it posts there', () => {
  const front = cut(desktop, '  function chanFront() {', '  // A voice take into the channel in front');
  const run = view => {
    const ctx = { focused: () => ({ id: 'main', app: 'chats', thread: '__new__' }), feedBase: { id: 'feed-1' }, feedOpen: () => ({ id: '__general__', name: 'General' }),
      feedHost: { isConnected: true, dataset: { chats: 'feed-1::side' }, closest: () => null }, LIVE: { session: id => ({ id }) },
      CHATS: { chanView: () => view, chanOpen: () => null, channelOf: () => '' } };
    vm.createContext(ctx); vm.runInContext(front + '\nthis.chanFront = chanFront;', ctx);
    return j(ctx.chanFront());
  };
  assert.equal(run('activity'), null, 'Activity: no channel in front');
  assert.deepEqual(run('channels'), { wid: 'feed-1::side', sid: '__new__' });
});

// --- 1311: a desktop New chat stays open in its thread after its send ---
test('1311: on the desktop a sent New chat stays open and follows its new thread (AI apps column and classic desks)', () => {
  const src = cut(chats, '  function leaveAfterSend(', '  /* One send carries');
  const run = keepNewOpen => {
    const w = { id: 'w1', thread: '__new__' };
    const ctx = { W: { w1: w }, hosted: new Map(), H: { keepThreadOpen: true, keepNewOpen }, keepThreadOpen: () => true, PHONE: () => false,
      ch: () => ({ readNav: 0, trail: [] }), threadBack() {}, save() {}, openChat() {} };
    vm.createContext(ctx); vm.runInContext(src + '\nthis.leaveAfterSend = leaveAfterSend;', ctx);
    return { left: ctx.leaveAfterSend('w1', '__new__', true, 'typing'), thread: w.thread };
  };
  const host = desktop.match(/keepNewOpen: (.+),\n/)?.[1]; assert.ok(host, 'desktop host keepNewOpen');
  assert.equal(host, '() => true', 'every desktop New chat, whether Home (AI apps panel mode) is open or not');
  assert.deepEqual(run(vm.runInNewContext(host)), { left: false, thread: '__new__' }, 'no list hop: the column keeps the chat');
  assert.match(chats, /if \(isNew && !left && !opts\.away && it\?\.sessionId && W\[wid\] === w && w\.thread === sid && c\.readNav === navAtSend\) openChat\(wid, it\.sessionId\);/, 'then it follows the new thread id');
});
