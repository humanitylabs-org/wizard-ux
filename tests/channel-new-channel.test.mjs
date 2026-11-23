// Channels (wizard/chat-channels): + New channel (wizard-ux issue 1308), the sidebar tab deciding + / ⌥N / the voice
// key (issue 1310) and a desktop New chat staying open after its send (issue 1311). James, 12 Nov 2026: "When I hit the
// plus button, while I'm on the channel view, I guess I would intuitively expect this to create a new channel"; "when
// I'm in the activity view and I hit the plus button … I would expect it to create a new thread"; "when I hit send …
// it closed the chat and just showed my background". The shipped source runs here; only the shell around it is stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { between, block, runRecording } from './fixtures/source-slice.mjs';

const j = x => JSON.parse(JSON.stringify(x));
const read = p => withShellParts(withWebParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8')));
const chats = withParts(read('web/core/chats.js')), desktop = read('web/desktop/desktop.js'), aad = read('web/layouts/ai-apps/desktop.js');
const cut = (src, from, to) => { const a = src.indexOf(from); assert.ok(a >= 0, from); const b = src.indexOf(to, a + from.length); assert.ok(b > a, to); return src.slice(a, b); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// --- the list row and the form it opens (chats.js) ---
function list({ agents = [{ id: 'hermes' }], view = 'channels', open = null, q = '', archived = [], focused = '' } = {}) {
  const calls = [], wins = { w1: { id: 'w1', thread: null }, 'w1::side': { id: 'w1::side', thread: null } };
  const ctx = {
    calls, esc, chanView: view, chanArchOpen: false, chanCarried: true, chanCarryAfter: 0,
    W: wins, channelsOn: () => true, chanOpen: () => open, norm: s => String(s || '').trim().toLowerCase(), ch: () => ({ q }),
    elOf: () => ({ querySelector: () => null }), focusAgents: () => agents, focusOf: () => null, focusedAgent: () => focused, AGS: () => ({ defaultId: () => 'hermes' }),
    channelsFor: (w, o = {}) => o.archived ? archived : [{ id: 'b', name: 'Beta' }, { id: '__general__', name: 'General', general: true }],
    channelLine: c => `<div class="ch-chan" data-chchan="${c.id}"></div>`, chanGenAgent: () => '', chanPruned: () => false, chanElsewhere: () => false, H: {}, chanStore: () => null,
    openSpacePicker: (w, a, tab, o) => { calls.push(['picker', w.id, a, j(o)]); ctx.spacePicker = { o }; }, spacePicker: null,
  };
  vm.createContext(ctx);
  vm.runInContext(cut(chats, '  const chanNewAgent = w =>', '  /* Channel posts: first message') + '\nthis.channelsBody = channelsBody; this.chanNewForm = chanNewForm;', ctx);
  return ctx;
}

test('1308: the Channels list ends with an accent + New channel row after General, before Archive', () => {
  const c = list({ archived: [{ id: 'old', name: 'Old' }] }), html = c.channelsBody(c.W.w1, []);
  const gen = html.indexOf('data-chchan="__general__"'), add = html.indexOf('data-chchannew'), arch = html.indexOf('data-sec="chan-archive"');
  assert.ok(gen >= 0 && add > gen && arch > add, 'General, then + New channel, then Archive');
  assert.match(html, /<button type="button" class="ch-chan-add" data-chchannew aria-haspopup="dialog">[^]*New channel<\/b><\/button>/);
  assert.doesNotMatch(list({ agents: [] }).channelsBody({ id: 'w1' }, []), /data-chchannew/, 'no agent to own a channel: no row');
  // A list still on an agent that is hidden now gets no row: its channel is never filed under another agent (Codex P1).
  const hidden = list({ agents: [{ id: 'hermes' }, { id: 'pi' }], focused: 'philosopher' });
  assert.doesNotMatch(hidden.channelsBody(hidden.W.w1, []), /data-chchannew/); assert.equal(hidden.chanNewForm(hidden.W.w1), false);
  const pi = list({ agents: [{ id: 'hermes' }, { id: 'pi' }], focused: 'pi' }); assert.equal(pi.chanNewForm(pi.W.w1), true); assert.equal(pi.calls[0][2], 'pi', 'the list\'s own agent');
  // The list's own round + (phone, classic) on the Channels list starts a new chat, as on Activity (issue 1489).
  // (its rendered aria-label: '1489: the Channels list + starts a new chat in the list's own agent window' below)
  assert.doesNotMatch(chats, /fabNew/);
  // The rendered row, cascaded with the real chats.css: one line high like the channels, in the skin accent.
  const doc = createDocument(); doc.body.innerHTML = `<div class="chats">${html}</div>`;
  const row = doc.querySelector('.ch-chan-add'); assert.ok(row, 'the row renders');
  const won = cascade(row, read('web/core/chats.css'));
  assert.equal(won['min-height']?.value, '44px', 'one line high like the channels');
  assert.match(won.color?.value || '', /^var\(--wz-accent\b/, 'in the skin accent');
});

test('1489: only the + New channel row opens the name form; the shells\' + never does', () => {
  const c = list();
  assert.equal(c.chanNewForm(c.W['w1::side']), true);
  assert.deepEqual(j(c.calls), [['picker', 'w1::side', 'hermes', { naming: true, from: 'w1::side', direct: true }]], 'naming form, opened straight on its input');
  assert.doesNotMatch(chats, /function chanNew\(|chanCompose, chanNew,/, 'no shell entry point to the form');
  // The shells' + / ⌥N never reach the form: the 1489 tests below run each of them.
  // A tap on the rendered row (real channelClick) opens the form for its window, on that row.
  const doc = createDocument(); doc.body.innerHTML = c.channelsBody(c.W.w1, []);
  const btn = doc.querySelector('[data-chchannew]'), w = { id: 'w1', thread: null };
  const tap = runRecording(block(chats, '  function channelClick(') + '\nthis.channelClick = channelClick;', { channelSheetClick: () => false });
  assert.equal(tap.channelClick({ target: btn }, 'w1', w), true, 'the row tap is handled');
  const forms = tap.calls.filter(x => x[0] === 'chanNewForm');
  assert.equal(forms.length, 1, 'the row opens the form'); assert.equal(forms[0][1], w); assert.equal(forms[0][2], btn);
  // Esc in the picker (real keydown handler): a direct form closes; a naming step opened from the picker steps back.
  const esc = p => {
    const on = {}, calls = [];
    const k = runRecording(between(chats, "    wrap.addEventListener('keydown', e => {", '    requestAnimationFrame(() =>'), { calls, p, wrap: { addEventListener: (t, f) => { on[t] = f; } },
      renderSpacePicker: () => calls.push(['render']), closeSpacePicker: () => calls.push(['close']) });
    on.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {}, target: { tagName: 'INPUT' } });
    return { calls: j(k.calls.filter(x => x[0] === 'render' || x[0] === 'close')), naming: p.naming };
  };
  assert.deepEqual(esc({ naming: true, busy: false, direct: true }), { calls: [['close']], naming: true }, 'Esc on a direct form cancels it');
  assert.deepEqual(esc({ naming: true, busy: false, direct: false }), { calls: [['render']], naming: false }, 'Esc on the picker\'s naming step goes back to the picker');
});

// --- creating: the empty feed, never the "Fill my new Space" chat ---
async function create(channelsOn, name = 'Test') {
  const calls = [], p = { wid: 'w1', from: 'w1::side', agent: 'hermes', name, sid: '', busy: false }; create.picker = p;
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
  for (const name of ['General', ' general ', 'alpha']) {
    assert.deepEqual(await create(true, name), [], `${name}: nothing created`); assert.equal(create.picker.error, 'Already a channel', name);
  }
  const off = await create(false);
  assert.deepEqual(off.at(-1), ['sendChat', 'Fill my new Space “T'], 'classic Spaces (switch off) keep their auto-fill');
});

// --- the shell's + / ⌥N (desktop.js): never a new channel (issue 1489) ---
const line = (src, from) => { const a = src.indexOf(from); assert.ok(a >= 0, from); return src.slice(a, src.indexOf('\n', a)); };
test('1489: + / ⌥N on the Channels list (AI apps sidebar or a classic Chats window) start a new chat, not a channel', () => {
  assert.doesNotMatch(desktop, /function chanNew\(|chatChannelNew/);
  // ⌥N (desktop-pickany.js): the channel box in front takes it, else a New chat. Never a channel.
  const keys = readFileSync(new URL('../web/desktop/desktop-pickany.js', import.meta.url), 'utf8');
  const altN = post => {
    const calls = [];
    const ctx = { calls, menu: false, alt: true, shift: false, code: 'KeyN', e: { repeat: false }, hit: fn => (fn(), true), closePalette() {}, toggleKeys() {}, closeSettings() {}, closeUsage() {},
      chanPost: () => (calls.push('chanPost'), post), newChat: () => calls.push('newChat') };
    vm.runInNewContext(`(() => { ${line(keys, "    if ((menu || alt) && !shift && code === 'KeyN') return hit(")} return false; })()`, ctx);
    return j(calls);
  };
  assert.deepEqual(altN(true), ['chanPost'], '⌥N with a channel box in front: its box');
  assert.deepEqual(altN(false), ['chanPost', 'newChat'], '⌥N on the list: a New chat');
  // The desktop shell hands the layouts its channel post and tab (desktop-boot.js) ...
  const boot = readFileSync(new URL('../web/desktop/desktop-boot.js', import.meta.url), 'utf8');
  const shell = vm.runInNewContext(`({ ${line(boot, '    chatChannelPost: () =>')}\n${line(boot, '    chatChannelView: () =>')} })`, { chanPost: () => 'posted', CHATS: { chanView: () => 'channels' } });
  assert.equal(shell.chatChannelPost(), 'posted'); assert.equal(shell.chatChannelView(), 'channels');
  // ... and the layout API (skin-host-shellapi.js) passes them on; channelNew never makes a channel.
  const api = readFileSync(new URL('../web/core/skin-host-shellapi.js', import.meta.url), 'utf8');
  const sessions = on => vm.runInNewContext(`({ ${line(api, '        channelPost: () =>')}\n${line(api, '        channelNew: () =>')}\n${line(api, '        channelView: () =>')} })`,
    { live: () => on, skinHostVars: { shell: shell } });
  assert.equal(sessions(true).channelNew(), false, 'kept for layouts built against it, never a channel');
  assert.equal(sessions(true).channelView(), 'channels'); assert.equal(sessions(true).channelPost(), true);
  assert.equal(sessions(false).channelView(), '', 'a layout that is not live gets nothing');
});

// --- the AI apps sidebar's + (layouts/ai-apps/desktop.js): its tab decides ---
function aiPlus({ view, feed = null, thread = null, post = true, made = true }) {
  const calls = [];
  const ctx = { calls, FEED: '__feed__', chatThread: thread, feedOn: () => feed, closeMenu: () => calls.push('closeMenu'), newChat: () => calls.push('newChat'),
    api: { sessions: { channelView: () => view, channelPost: () => (calls.push('channelPost'), post), channelNew: () => (calls.push('channelNew'), made) } } };
  vm.createContext(ctx);
  vm.runInContext(cut(aad, '  const plus = () =>', '  api.listen(newBtn') + '\nthis.plus = plus;', ctx);
  ctx.plus(); return calls;
}
// The sidebar's + and the round + in the list (real desktop-home.js wiring and newChat), on a fake api.
function aiWired({ thread = null, feed = null } = {}) {
  const on = new Map(), newBtn = { id: 'newBtn' }, rNew = { id: 'rNew' };
  const ctx = { newBtn, rNew, FEED: '__feed__', chatThread: thread, feedOn: () => feed,
    api: { listen: (el, type, fn) => on.set(el.id + ':' + type, fn), sessions: { channelView: () => 'activity', channelPost: () => false,
      newChat: () => ctx.calls.push(['api.sessions.newChat']), channelBack: () => ctx.calls.push(['api.sessions.channelBack']) } }, calls: [] };
  runRecording(between(aad, '  const newChat = () =>', '\n') + '\n' + between(aad, '  const plus = () =>', '\n') + '\n' + between(aad, '  api.listen(newBtn', '\n'), ctx);
  return { ctx, on, fired: () => ctx.calls.filter(x => x[0] === 'api.sessions.newChat' || x[0] === 'api.sessions.channelBack').map(x => x[0]) };
}

test('1310: the AI apps + follows the sidebar tab, not a feed left in the main column', () => {
  const FEED = '__feed__', general = { id: '__general__', name: 'General' };
  assert.deepEqual(aiPlus({ view: 'activity', feed: general, thread: FEED }), ['newChat'], 'Activity: a blank new chat (newChat closes the feed), never General\'s box');
  assert.deepEqual(aiPlus({ view: 'channels', feed: general, thread: FEED }), ['channelPost', 'closeMenu'], 'Channels › General: its box');
  assert.deepEqual(aiPlus({ view: 'channels' }), ['newChat'], 'Channels list, none open: a blank new chat, never a channel (issue 1489)');
  assert.deepEqual(aiPlus({ view: 'activity' }), ['newChat'], 'Activity with nothing open: New chat');
  for (const btn of ['newBtn', 'rNew']) {
    const a = aiWired(); a.on.get(btn + ':click')(); assert.deepEqual(a.fired(), ['api.sessions.newChat'], `${btn} click: the + (a New chat on Activity)`);
  }
  // ⌥N runs the same plus: channel-new-chat-entry-points.test.mjs runs the desktop-keys.js KeyN line.
  const left = aiWired({ thread: FEED, feed: general }); left.on.get('newBtn:click')();
  assert.equal(left.ctx.chatThread, null, 'newChat closes the leftover feed first');
  assert.deepEqual(left.fired(), ['api.sessions.channelBack', 'api.sessions.newChat'], 'the feed is left before the New chat');
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
  // The desktop host's real keepNewOpen (desktop-sideview.js), with Home (AI apps panel mode) open or not.
  const host = homeOpen => runRecording(`this.host = {${between(desktop, '    keepNewOpen:', '\n')}\n};`, { desktopVars: { homeOpen }, homeOpen }).host.keepNewOpen;
  for (const homeOpen of [false, true]) {
    assert.equal(host(homeOpen)('w1'), true, `every desktop New chat stays open (homeOpen ${homeOpen})`);
    assert.deepEqual(run(host(homeOpen)), { left: false, thread: '__new__' }, 'no list hop: the column keeps the chat');
  }
  assert.deepEqual(j(run(() => false)), { left: {}, thread: null }, 'control: a host that does not keep it leaves to the list');
  // Following the allocated thread id after the save: phone-chat-after-action.test.mjs runs sendChat for it
  // ('phone New chat text, stay: follow allocated thread only when staying').
});

// --- 1328 / 1489: the phone's + (stock Chats list button and the AI apps phone layout) on the Channels list ---
test('1489: on the phone, + on the Channels list with no channel open starts a new chat', () => {
  const app = read('web/app.js');
  assert.doesNotMatch(app, /chatChannelNew/, 'no new-channel route from the phone shell');
  const view = v => runRecording(`this.o = {${between(app, '\n    chatChannelView:', '\n')}\n};`, { CHATS: { chanView: () => v } }).o.chatChannelView();
  assert.equal(view('channels'), 'channels'); assert.equal(view(''), '', 'switch off');
  // The phone AI apps layout's round +: Activity = New chat; Channels = the open channel's box, else New chat.
  const phone = read('web/layouts/ai-apps/layout.js');
  const line = between(phone, "\n  api.listen(newBtn, 'click',", '\n');
  const plus = ({ view, post = false }) => {
    const calls = [], on = {}, ctx = { calls, newBtn: {}, closeMenu: () => calls.push('closeMenu'), closeSheet: () => {}, closeDrawer: () => {}, goHome: () => calls.push('newChat'),
      api: { listen: (el, type, fn) => { if (el === ctx.newBtn) on[type] = fn; }, sessions: { channelView: () => view, channelPost: () => (calls.push('channelPost'), post), channelNew: () => (calls.push('channelNew'), true) } } };
    vm.createContext(ctx); vm.runInContext(line, ctx); on.click(); return calls;
  };
  assert.deepEqual(plus({ view: 'channels' }), ['channelPost', 'newChat'], 'Channels list, none open: a new chat, never a channel');
  assert.deepEqual(plus({ view: 'channels', post: true }), ['channelPost', 'closeMenu'], 'a channel open: its box');
  assert.deepEqual(plus({ view: 'activity', post: true }), ['newChat'], 'Activity: a normal New chat (issue 1310)');
  assert.deepEqual(plus({ view: '' }), ['channelPost', 'newChat'], 'switch off: New chat');
});

// --- 1489: main and routed agents alike, the Channels list's round + is the list's own New chat ---
test('1489: the Channels list + starts a new chat in the list\'s own agent window, for main and routed agents', () => {
  const fabLine = between(chats, '    const fab = feed ?', '\n');
  const click = cut(chats, "    if (e.target.closest('[data-chnew]')) {", "    const dx = e.target.closest('[data-chdraftx]');");
  for (const [kind, agent, name] of [['main', '', ''], ['host-ops', 'host-ops', 'Host'], ['box', 'box', 'Box'], ['locked', 'locked', 'Locked']]) {
    const names = { 'host-ops': 'Host', box: 'Box', locked: 'Locked' };
    const ctx = { feed: null, AGID: agent, esc, agentName: a => names[a], chanComposer: () => '' };
    vm.createContext(ctx); vm.runInContext(fabLine.replace('const fab', 'this.fab'), ctx);
    assert.doesNotMatch(ctx.fab, /data-chchannew|New channel/, `${kind}: never the name form`);
    assert.match(ctx.fab, new RegExp(`class="ch-fab" data-chnew data-chfab aria-label="${agent ? `New chat with ${name}` : 'New chat'}"`), kind);
    // The tap: a blank New chat in the list's owner window (the routed agent's own window), with no form.
    const listId = agent ? `agent-${agent}::list` : 'w1::list', ownerId = agent ? `agent-${agent}` : 'w1', opened = [];
    const run = { ch: () => ({ q: '' }), owner: id => id.replace('::list', ''), openNewDraft: (o, r) => opened.push([o, r]), setDraft() {}, elOf: () => null, setTimeout() {},
      window: { WizCore: {} }, e: { target: { closest: sel => (sel === '[data-chnew]' ? {} : null) } }, id: listId };
    vm.createContext(run); vm.runInContext(`this.r = (() => {\n${click}\n    return false; })();`, run);
    assert.equal(run.r, true, kind); assert.deepEqual(j(opened), [[ownerId, '']], `${kind}: a blank new chat in its own window`);
  }
});
