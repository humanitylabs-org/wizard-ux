// Back from a thread to its channel on the desktop (wizard-ux issue 1302; James, 11 Nov 2026: "if I open a channel and then
// I click through to a thread there's no way for me to go back to the channel currently so I think on desktop we will
// need a back button. at least when the user opens a chat from a channel"). The AI apps main column: a thread opened from
// the channel's feed shows "‹ # name" at the left of its header, and it is Esc (closeChat: the feed, at its place). A
// thread opened from Activity or the sidebar shows none. The phone (its own Back) is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withParts } from './fixtures/chats-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { deskWorld, layout } from './fixtures/ai-apps-world.mjs';
import { cascade, parseCss } from './fixtures/mini-css.mjs';
import { runRecording, block } from './fixtures/source-slice.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';

const read = f => withWebParts(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const js = read('web/layouts/ai-apps/desktop.js'), css = read('web/layouts/ai-apps/desktop.css');
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, a); const j = s.indexOf(b, i); assert.ok(j > i, b); return s.slice(i, j); };

function world() {
  const listeners = [], attrs = {};
  const cBack = { hidden: true, textContent: '', title: '', setAttribute: (k, v) => { attrs[k] = v; } };
  const c = { FEED: '__feed__', feedBox: {}, cBack, open: { id: 'apps', name: 'WizardOS Apps' }, chatThread: '__feed__', docked: true, closed: 0,
    api: { listen: (t, type, fn, opts) => listeners.push({ t, type, fn, opts }) } };
  c.feedOn = () => c.open; c.closeChat = () => { c.closed++; return true; };
  // the list beside the chat (wide, sidebar open): no list Back; tests below set c.up to the list it would go to
  c.up = ''; c.listBack = () => c.up; c.chatBack = () => c.closeChat();
  vm.createContext(c);
  vm.runInContext(between(js, '  let fromFeed = null;', '  // A channel opened in the sidebar: its feed comes') + `
    this.t = { feedPost, feedBack, feedTitle, paintBack, get fromFeed() { return fromFeed; }, set chat(v) { chatThread = v; } };`, c);
  // chatThread / docked live in the excerpt's own scope as globals of the context
  const clickOn = (attrsOf, extra = {}) => ({ target: { closest: sel => {
    if (sel === '[data-chopen], [data-chreply]') return attrsOf ? { dataset: attrsOf, closest: s => (s === '.ch-post' && extra.title !== undefined ? { dataset: { chtitle: extra.title } } : null) } : null;
    return extra[sel] || null; } } });
  const post = (sid, extra) => listeners.find(l => l.t === c.feedBox).fn(clickOn({ chopen: sid }, extra));
  const reply = (sid, extra) => listeners.find(l => l.t === c.feedBox).fn(clickOn({ chreply: sid }, extra));
  const back = () => listeners.find(l => l.t === cBack && l.type === 'click').fn();
  const paint = thread => { c.chatThread = thread; c.t.paintBack(); };
  return { c, cBack, attrs, listeners, post, reply, back, paint };
}

test('a post opened from the feed: "‹ # channel" in the header, and it does what Esc does (closeChat)', () => {
  const x = world();
  const cap = x.listeners.find(l => l.t === x.c.feedBox);
  assert.equal(cap.type, 'click'); assert.equal(cap.opts, true, 'captured before the feed opens the thread');
  x.post('s1'); x.paint('s1');
  assert.equal(x.cBack.hidden, false);
  assert.equal(x.cBack.textContent, '‹ # WizardOS Apps');
  assert.equal(x.attrs['aria-label'], 'Back to # WizardOS Apps (Esc)');
  x.back(); assert.equal(x.c.closed, 1, 'the same closeChat Esc runs: the feed again, at its place');
  x.paint('__feed__'); assert.equal(x.cBack.hidden, true, 'on the feed: no Back');
});

test('a post\'s Reply opens with Back too; a link inside a post, or the row sheet, does not count', () => {
  const x = world();
  x.reply('s2'); x.paint('s2'); assert.equal(x.cBack.hidden, false);
  const y = world();
  y.post('s3', { '.ch-post-t a[href]': {} }); y.paint('s3'); assert.equal(y.cBack.hidden, true);
  y.post('s3', { '.ch-sheet': {} }); y.paint('s3'); assert.equal(y.cBack.hidden, true);
});

// An older post (wizard-ux issue 1329): not in the loaded Activity list, so titleOf finds nothing; the header takes the
// title the post carried in the feed, on the first paint (no flicker), and only for that post.
test('an older post opened from the feed shows its own title beside Back', () => {
  const x = world();
  x.post('old1', { title: 'Plan the launch' }); x.paint('old1');
  assert.equal(x.c.t.feedTitle('old1'), 'Plan the launch');
  assert.equal(x.cBack.textContent, '‹ # WizardOS Apps');
  assert.equal(x.c.t.feedTitle('other'), '', 'another thread never borrows it');
  const r = world(); r.reply('old2', { title: 'Old ask' }); r.paint('old2'); assert.equal(r.c.t.feedTitle('old2'), 'Old ask', 'Reply too');
  const n = world(); n.post('old3'); n.paint('old3'); assert.equal(n.c.t.feedTitle('old3'), '', 'no title on the post: empty, as before');
  x.paint('a1'); assert.equal(x.c.t.feedTitle('old1'), '', 'spent once another chat is in the column');
  // the header takes the clicked post's title first (lists match by id alone: a routed post may share a main chat's
  // id), then the lists (the real paintTop); the wiring test mounts the real view, so a paintTop that ran before
  // feedTitle exists would throw there
  const top = paintTopRun({ feedTitle: sid => (sid === 'old1' ? 'Plan the launch' : '') });
  assert.equal(top.tt.textContent, 'Plan the launch', 'the post\'s own title over the list\'s');
  assert.equal(top.backAt, 'Plan the launch', 'then its Back repaints');
  assert.equal(paintTopRun({ feedTitle: () => '' }).tt.textContent, 'Main chat', 'no post title: the lists');
  assert.equal(paintTopRun({ feedTitle: () => 'x', docked: false }).tt.textContent, '', 'not docked: no title');
  // the feed's real posts (core/chats-feed.js) carry their title, and a click on one hands it to the header
  const doc = createDocument();
  doc.body.innerHTML = channelFeedPart().channelFeed({ id: 'w' }, { id: 'apps', name: 'WizardOS Apps' }, [{ id: 'old9', title: 'Ship <it>' }]);
  const f = world(); f.listeners.find(l => l.t === f.c.feedBox).fn({ target: doc.querySelector('[data-chopen]') }); f.paint('old9');
  assert.equal(f.c.t.feedTitle('old9'), 'Ship <it>');
});

// core/chats-feed.js's part factory with stand-ins for the Chats names it reads (as agent-inbox-alert-feedback.test.mjs)
function channelFeedPart() {
  const window = { WizCore: {}, WizConfig: { owner: () => 'James' } };
  vm.runInNewContext(readFileSync(new URL('../web/core/chats-feed.js', import.meta.url), 'utf8'), { window });
  const esc = v => String(v).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  return window.WizCore.chatsParts.feed({ agentName: () => 'Wizard', agentRec: id => ({ id }), ago: () => '', AGS: () => null, CHAN_CLAMP: 240,
    chanActs: {}, chanArchived: () => false, chanAt: () => 0, chanChanged: () => false, chanGenAgent: () => '', chanKey: r => r.id, chanMore: new Set(),
    chanNeeds: () => false, chanNewN: () => 0, chanPostOrder: () => 0, chanPostText: () => ({ text: 'hi' }), chanReadKey: () => 'k', chanReplies: () => null,
    chanStart: () => null, chanUnread: () => false, esc, firstAgent: () => '', firstPost: () => null, firstWant: new Set(), focusedAgent: () => '',
    focusOf: () => null, inChannel: () => true, isWorking: () => false, KIT: null, LIVE: { cardAt: () => '' }, pullFirst() {}, replyWant: new Set(), rowDraft: () => false });
}

// the real paintTop (desktop.js) on a thread in the column; everything it paints besides the title records
function paintTopRun({ feedTitle, docked = true, app = '', thread = 'old1', chatThread = null, feedOn = () => null }) {
  const c = { api: { route: () => ({ view: 'thread', thread, desk: 1 }) }, noteOn: () => false, chatWindows: () => [], focusOn: () => false,
    here: () => ({ thread: app ? null : thread, app }), onMainChats: () => true, pane: app ? { id: app } : null, NOTE: '__note__', DRAFT: '__draft__', FEED: '__feed__',
    feedOn, feedTitle, titleOf: () => 'Main chat', docked, tt: {}, root: { dataset: {} }, cX: { setAttribute() {} }, chatThread, frontApp: '', lastThread: undefined,
    behindThread: () => 'behind', paintSplit() {}, anim() {} };
  c.paintBack = () => { c.backAt = c.tt.textContent; };
  c.feedGone = () => { (c.gone = (c.gone || 0) + 1); };
  return runRecording(block(js, '  function paintTop(r = api.route()) {') + '\npaintTop();', c);
}

// The three sidebar opens in desktop.js (an Activity row's click, the rail's openChat, ⌥↓ / ⌥↑ stepReady), each run
// with a post opened from the feed (fromFeed) and a feed brought in front of an app (feedFocus) before it.
function sidebarOpens() {
  const ctx = extra => { const c = { fromFeed: { sid: 'p1' }, feedFocus: 'app', opened: [], q: false, ...extra };
    c.api = { sessions: { open: id => c.opened.push(id) }, listen: (t, type, fn) => { c.click = fn; }, route: () => ({}) }; return c; };
  const at = js.indexOf("api.listen(b, 'click', () => { if (q) setSearch(false);");
  const row = runRecording(js.slice(at, js.indexOf('\n', at)), ctx({ s: { id: 'x1', note: false } })); row.click();
  const rail = runRecording(block(js, '  function openChat(id, key) {') + "\nopenChat('x1', 'ready');", ctx({ panes: { get: () => ({ focus: 'chats' }), set() {} } }));
  const step = runRecording(block(js, '  function stepReady(dir) {') + '\nstepReady(1);', ctx({ readyIds: () => ['x1', 'x2'], here: () => ({}), stepAt: null,
    readyStep: ids => ({ id: ids[0], wrapped: false }) }));
  return { 'an Activity row': row, 'the rail': rail, '⌥↓ / ⌥↑': step };
}

test('a thread opened from Activity or the sidebar has no Back; another chat spends the post\'s Back', () => {
  const x = world();
  x.paint('a1'); assert.equal(x.cBack.hidden, true, 'never opened from the feed');
  x.post('s1'); x.paint('s1'); assert.equal(x.cBack.hidden, false);
  x.paint('a1'); assert.equal(x.cBack.hidden, true, 'an Activity thread in the column');
  x.paint('s1'); assert.equal(x.cBack.hidden, true, 'the same post later, from Activity: no Back');
  const y = world();
  y.post('s1'); y.paint('s1'); y.c.open = { id: 'other', name: 'Other' }; y.paint('s1');
  assert.equal(y.cBack.hidden, true, 'its channel no longer the one open');
  const z = world(); z.post('s1'); z.c.docked = false; z.paint('s1'); assert.equal(z.cBack.hidden, true, 'not docked: none');
  const n = world(); n.c.open = null; n.post('s1'); n.paint('s1'); assert.equal(n.cBack.hidden, true, 'no feed open: none');
});

test('wiring: the Back sits left of the title, every sidebar open clears it, the header repaints it; tokens only', async () => {
  // the real desktop AI apps view, drawn on the small DOM
  const d = deskWorld(), { w } = d;
  w.html.setAttribute('data-shell', 'desktop'); w.html.setAttribute('data-layout', 'ai-apps');
  (await layout()).default(w.api);
  const cBack = w.q('.aad-cback');
  assert.ok(cBack, 'the chat header has a Back');
  const top = cBack.parentNode.children;
  assert.equal(top[0], cBack, 'left of everything');
  assert.ok(top[1].classList.contains('aad-tt'), 'then the title');
  assert.ok(top.at(-1).classList.contains('aad-cx'), 'the close stays last');
  assert.equal(cBack.tagName, 'BUTTON'); assert.equal(cBack.getAttribute('type'), 'button');
  assert.equal(cBack.hidden, true, 'hidden until a thread is opened from a feed');
  // its look: tokens only, and hidden means gone
  const sheet = parseCss(css), look = cascade(cBack, sheet);
  for (const k of ['color', 'background', 'border-color']) if (look[k]) assert.doesNotMatch(look[k].value.replace(/var\([^)]*\)/g, ''), /#[0-9a-f]{3,8}\b|rgb/i, `${k} from tokens`);
  cBack.setAttribute('hidden', '');
  assert.equal(cascade(cBack, sheet).display?.value, 'none');
  // every sidebar open clears it (Activity row, the rail, ⌥↓ / ⌥↑; sidebarOpens runs each) and the header repaints it
  // (paintTop calls paintBack after the title: the older post test runs it)
  for (const [how, o] of Object.entries(sidebarOpens())) {
    assert.equal(o.fromFeed, null, `${how}: the post's Back is spent`);
    assert.equal(o.feedFocus, null, `${how}: the feed's app hand-back is forgotten`);
    assert.deepEqual(o.opened, ['x1'], `${how}: then the chat opens`);
  }
  // Back never exits (AGENTS.md): the button is the in-page Esc path only (the first test clicks it: closeChat);
  // closeChat swaps the column, no history step.
  const up = between(js, '  function chatBack() {', '\n  }\n') + '\n  }';
  const back = env => runRecording(up + '\nglobalThis.back = chatBack;', { one: () => false, peekable: () => false, FEED: '__feed__', chatThread: null, ...env });
  const refused = back({ listBack: () => '', closeChat: () => false });
  assert.equal(refused.back(), false, 'Back is closeChat first: nothing closed, Back goes on');
  const closed = back({ listBack: () => '', closeChat: () => true });
  assert.equal(closed.back(), true);
  for (const c of [refused, closed]) assert.ok(!c.calls.some(([n]) => /^(history|location)\b|\.back$/.test(n)), 'no history navigation in the list Back either');
  const close = js.slice(js.indexOf('  function closeChat() {'), js.indexOf('\n  }\n', js.indexOf('  function closeChat() {'))) + '\n  }';
  const shut = runRecording(close + '\nglobalThis.close = closeChat;', { docked: true, FEED: '__feed__', chatThread: '__feed__', feedBack: () => false });
  assert.equal(shut.close(), true);
  assert.equal(shut.chatThread, null, 'Esc on the feed itself still closes the feed');
  assert.ok(shut.calls.some(([n]) => n === 'api.sessions.channelBack'), 'through Chats\' own channel Back');
  assert.ok(!shut.calls.some(([n]) => /^(history|location)\b/.test(n)), 'no history navigation in the Back path');
  assert.equal(runRecording(close + '\nglobalThis.close = closeChat;', { docked: false }).close(), false, 'not docked: nothing to close');
  assert.doesNotMatch(read('web/layouts/ai-apps/layout.js'), /aad-cback|fromFeed/, 'the phone is unchanged');
});

// Esc on an app desk keeps the owner's view (wizard-ux issues 1330, 1325): a post's thread back to its feed, the feed
// closed and a plain chat closed all leave 50/50 / centred / full as they were.
test('closeChat: channel steps and a plain chat closing keep the view mode', () => {
  const src = between(js, '  function closeChat() {', '  function setWide(on) {');
  const run = ({ thread, fromFeed = false, mode = 'pair' }) => {
    const c = { FEED: '__feed__', docked: true, chatThread: thread, noteWant: false, draftWant: false, calls: [], mode, feedFocus: null, pane: null,
      panes: { get: () => ({ mode: c.mode }) }, feedBack: () => (fromFeed ? { id: 'launch', name: 'Launch' } : null),
      windowMode: (m, s) => { c.calls.push(`mode:${m}:${s}`); c.mode = m; }, anim: () => {}, paintTop: () => c.calls.push('paint'), feedGone: () => {},
      api: { sessions: { channelBack: () => { c.calls.push('channelBack'); return true; }, newChat: () => c.calls.push('newChat') } } };
    vm.createContext(c); vm.runInContext(`${src}\nthis.ok = closeChat(); this.after = chatThread;`, c);
    return c;
  };
  for (const mode of ['pair', 'centre', 'full']) {
    const feed = run({ thread: '__feed__', mode });
    assert.equal(feed.mode, mode, `the feed closed keeps ${mode}`); assert.deepEqual(feed.calls, ['channelBack', 'paint']);
    const post = run({ thread: 'qa-p12', fromFeed: true, mode });
    assert.equal(post.mode, mode, `a post's thread back to its feed keeps ${mode}`); assert.deepEqual(post.calls, ['newChat']);
    const plain = run({ thread: 'qa-g1', mode });
    assert.equal(plain.mode, mode, `a plain chat closing keeps ${mode}`); assert.deepEqual(plain.calls, ['newChat'], 'a new chat takes the chat slot');
    assert.equal(plain.after, null);
  }
  for (const thread of ['__feed__', 'qa-g1']) assert.equal(run({ thread, mode: 'tiled' }).calls.some(x => x.startsWith('mode:')), false);
});

// A channel opened with an app centred (wizard-ux issue 1344): its feed comes to the front the way a chat does (the
// chat slot takes the focus), and closing the feed gives the front back to the app, in the same view.
test('feedOpened brings the feed to the front; closing the feed gives it back to the app', () => {
  const opened = between(js, '  function feedOpened(open) {', "  api.listen(globalThis, 'wos:channel-feed'"); // (with feedGone: closeEvent runs it)
  const close = between(js, '  function closeChat() {', '  function setWide(on) {');
  const desk = ({ mode = 'centre', focus = 'app', app = 'pages', fromFeed = false } = {}) => {
    const c = { FEED: '__feed__', docked: true, chatThread: null, noteWant: false, draftWant: false, calls: [], mode, focus, pane: app ? { id: app } : null,
      panes: { get: () => ({ mode: c.mode, focus: c.focus }), set: v => { if (v.mode) c.mode = v.mode; if (v.focus) { c.focus = v.focus; c.calls.push('focus:' + v.focus); } } },
      here: () => ({ app }), mainChats: () => ({ desk: 1 }), feedBack: () => (fromFeed ? { id: 'launch' } : null), unpeek: () => c.calls.push('unpeek'),
      one: () => false, oneSplit: () => true, oneList: true, oneSeen: undefined,
      windowMode: (m, s) => { c.calls.push(`mode:${m}:${s}`); c.mode = m; }, anim: () => {}, paintTop: () => c.calls.push('paint'),
      api: { route: () => ({ view: 'thread', thread: '__new__' }), sessions: { channelBack: () => true, newChat: () => c.calls.push('newChat') } } };
    vm.createContext(c);
    vm.runInContext(`${opened}\n${close}\nthis.open = () => feedOpened({ id: 'launch' }); this.closeEvent = () => feedOpened(null); this.close = () => closeChat();
      Object.defineProperty(this, 'thread', { get: () => chatThread, set: v => { chatThread = v; } });`, c);
    return c;
  };
  for (const mode of ['centre', 'full', 'pair']) {
    const c = desk({ mode });
    c.open();
    assert.equal(c.thread, '__feed__'); assert.equal(c.focus, 'chats', `${mode}: the feed in front`); assert.equal(c.mode, mode, `${mode}: the view stays`);
    c.close();
    assert.equal(c.focus, 'app', `${mode}: Esc on the feed brings the app back to the front`); assert.equal(c.mode, mode, `${mode}: still ${mode}`);
  }
  const chatFirst = desk({ focus: 'chats' }); chatFirst.open(); chatFirst.close();
  assert.equal(chatFirst.focus, 'chats', 'the chat was in front before: it stays'); assert.ok(!chatFirst.calls.some(x => x.startsWith('focus:')));
  // a post's thread opened from the feed, back to the feed: the feed keeps the front; then the feed closed: the app
  const post = desk(); post.open(); post.thread = 'qa-p12';
  const viaPost = desk({ fromFeed: true }); viaPost.open(); viaPost.thread = 'qa-p12'; viaPost.close();
  assert.equal(viaPost.focus, 'chats', 'the post back to its feed keeps the feed in front');
  viaPost.thread = '__feed__'; viaPost.close(); assert.equal(viaPost.focus, 'app', 'then the feed closed: the app');
  // a plain chat closing forgets the feed's app (no stale hand-back later)
  post.close(); post.focus = 'chats'; post.thread = '__feed__'; post.close(); assert.equal(post.focus, 'chats');
  // the feed's own Back to channels (wos:channel-feed with no channel open): the app gets the front back, as on Esc
  const own = desk(); own.open(); assert.equal(own.focus, 'chats'); own.closeEvent();
  assert.equal(own.focus, 'app', 'Back to channels gives the front back'); assert.equal(own.mode, 'centre');
  // opening a chat from the sidebar, the rail or ⌥↓ forgets the feed's app: that chat keeps the front
  for (const [how, o] of Object.entries(sidebarOpens())) assert.equal(o.feedFocus, null, how);
  // the feed gone on a repaint (its channel closed while it was in the column, an app in front): the same hand-back
  const gone = paintTopRun({ feedTitle: () => '', app: 'pages', chatThread: '__feed__' });
  assert.equal(gone.gone, 1, 'feedGone'); assert.equal(gone.chatThread, 'behind', 'the thread behind it docks');
  const kept = paintTopRun({ feedTitle: () => '', app: 'pages', chatThread: '__feed__', feedOn: () => ({ id: 'launch', name: 'Launch' }) });
  assert.equal(kept.gone, undefined, 'its channel still open: no hand-back'); assert.equal(kept.chatThread, '__feed__');
  // no app open: nothing to give the front back to
  const bare = desk({ app: '' }); bare.pane = null; bare.open(); bare.close(); assert.equal(bare.focus, 'chats');
});

// Esc full screen (wizard-ux issue 1325; James, 12 Nov 2026: "going back shouldn't change the user's selected view"): a
// channel post's thread in the chat column, full screen, goes back to its feed and stays full screen, as its Back button
// does; anything else in full screen (an app, a plain chat, the feed itself) still leaves full screen first.
test('Esc in full screen: a post from the feed goes back to the feed and keeps full screen', () => {
  const src = between(js, '  api.back.surface?.(() => {', '    const a = doc.activeElement;');
  const run = ({ focus = 'chats', back = true, inApp = false, fullFrom = 'tiled', list = '' }) => {
    const act = {}, c = { calls: [], fullFrom, doc: { activeElement: act }, lastSurface: focus === 'chats' ? 'chat' : 'app', globalThis: {},
      pane: { el: { contains: n => inApp && n === act, querySelector: () => null } }, chatsEl: () => ({ contains: n => !inApp && n === act }),
      panes: { get: () => ({ mode: 'full', focus }) }, feedBack: () => (back ? { id: 'launch', name: 'Launch' } : null),
      closeChat: () => { c.calls.push('closeChat'); return true; }, windowMode: m => c.calls.push('mode:' + m),
      listBack: () => list, chatBack: () => { c.calls.push('closeChat'); return true; },
      api: { back: { surface: fn => { c.fn = fn; } } } };
    vm.createContext(c); vm.runInContext(`${src}  });\nthis.ok = this.fn();`, c);
    return c;
  };
  const post = run({}); assert.equal(post.ok, true); assert.deepEqual(post.calls, ['closeChat'], 'the feed again, still full screen');
  assert.deepEqual(run({ inApp: true }).calls, ['closeChat'], 'a stale focus in the hidden app frame does not win');
  assert.deepEqual(run({ back: false }).calls, ['mode:tiled'], 'nothing open in the column (Home): Esc leaves full screen');
  // full screen hides the list: a chat from it (or the feed) goes back to that list first, still full screen (James, 12 Nov 2026)
  for (const list of ['Activity', 'Channels']) assert.deepEqual(run({ back: false, list }).calls, ['closeChat'], `${list}: Back to the list, full screen kept`);
  assert.deepEqual(run({ focus: 'app', inApp: true }).calls, ['mode:tiled'], 'the app full screen: unchanged');
  // full screen entered from 50/50 or centred: leaving it goes back to that view, not tiled
  for (const fullFrom of ['pair', 'centre']) {
    assert.deepEqual(run({ back: false, fullFrom }).calls, ['mode:' + fullFrom], `a plain chat: Esc back to ${fullFrom}`);
    assert.deepEqual(run({ focus: 'app', inApp: true, fullFrom }).calls, ['mode:' + fullFrom], `the app: Esc back to ${fullFrom}`);
  }
});

// James, 12 Nov 2026 (Mac app window ~600 px, a thread full screen, no way back): "Make sure the user always has a back
// button in chats. It either takes them back to the channels or the chats list, wherever is one level above where they
// were last." Wherever the sidebar's list is not beside the column (the rail of a narrow window, folded, full screen),
// the column's header names the list one level up and Back / Esc shows it over the page; beside it, no Back.
test('listBack: the list one level up whenever it is not beside the chat; chatBack shows it over the page', () => {
  const src = between(js, '  function listBack() {', '  function setWide(on) {');
  const run = ({ thread = 'qa-g1', side = 'rail', mode = 'tiled', view = 'activity', docked = true, fromFeed = false, one = false, narrow = true, folded = false, oneList = false, oneSplit = false, pane = null } = {}) => {
    const c = { FEED: '__feed__', DRAFT: '__draft__', chatThread: thread, docked, peek: false, offPeek: null, folded, calls: [],
      root: { dataset: { aadSide: side } }, panes: { get: () => ({ mode }) }, one: () => one, narrow: () => narrow, oneList, pane, oneSplit: () => oneSplit, paintTop: () => c.calls.push('top'),
      feedBack: () => (fromFeed ? { id: 'launch', name: 'Launch' } : null), paintSide: () => c.calls.push('side:' + (c.peek ? 'over' : side)),
      closeChat: () => { c.calls.push('closeChat'); c.chatThread = null; return true; },
      api: { sessions: { channelView: () => view }, back: { push: fn => { c.calls.push('back.push'); c.pop = fn; return () => c.calls.push('back.off'); } } } };
    c.peekable = () => c.narrow() || c.folded || c.panes.get().mode === 'full';
    vm.createContext(c); vm.runInContext(`${src}\nthis.up = listBack(); this.go = chatBack;`, c);
    return c;
  };
  // where the list is not beside: the name of the list it returns to
  assert.equal(run().up, 'Activity', 'narrow (the rail): a chat from Activity');
  assert.equal(run({ view: '' }).up, 'Chats', 'Channels off: the chats list');
  assert.equal(run({ view: 'channels' }).up, 'Channels');
  assert.equal(run({ thread: '__feed__', view: 'channels' }).up, 'Channels', 'a channel\'s feed: the channel list');
  assert.equal(run({ side: 'open', narrow: false, mode: 'full' }).up, 'Activity', 'full screen hides the sidebar');
  assert.equal(run({ side: 'rail', narrow: false, folded: true }).up, 'Activity', 'the sidebar folded to the rail');
  // where it is beside, or another Back owns it: none
  assert.equal(run({ side: 'open', narrow: false }).up, '', 'the list beside the chat: no Back');
  for (const mode of ['pair', 'centre']) assert.equal(run({ side: 'open', narrow: false, mode }).up, '', `${mode}: the sidebar still shows`);
  assert.equal(run({ fromFeed: true }).up, '', 'a post from the feed keeps its own "‹ # channel"');
  assert.equal(run({ thread: null }).up, '', 'Home / a new chat is the root');
  assert.equal(run({ thread: '__draft__' }).up, '', 'an app\'s Reply draft');
  assert.equal(run({ docked: false }).up, '', 'nothing docked');
  // one app at a time (James, 12 Nov 2026): the chat alone (under 680 px) names its list; the list itself, the list beside
  // it, or an app in front: none. Back shows the list (the chat stays open behind it), no peek over the page
  assert.equal(run({ one: true }).up, 'Activity', 'one app at a time, the chat alone: Back to its list');
  assert.equal(run({ one: true, oneList: true }).up, '', 'the list (the root)');
  assert.equal(run({ one: true, oneSplit: true }).up, '', 'the list beside the chat');
  assert.equal(run({ one: true, pane: { id: 'notes' } }).up, '', 'an app in front');
  { const o = run({ one: true }); assert.equal(o.go(), true); assert.deepEqual(o.calls, ['top'], 'the list in front, the chat kept'); assert.equal(o.oneList, true); }
  // Back: the column closes one level, then the list over the page, its own Back (Esc) / a tap outside closes it
  const c = run(); assert.equal(c.go(), true);
  assert.deepEqual(c.calls, ['closeChat', 'back.push', 'side:over'], 'the chat closed, then the list over the page');
  c.pop(); assert.equal(c.peek, false, 'Esc again: the list closes; the root stays in Wizard');
  // beside it: Back is closeChat alone (no peek), as Esc was
  const w = run({ side: 'open', narrow: false }); w.go(); assert.deepEqual(w.calls, ['closeChat']);
  const p = run({ fromFeed: true }); p.go(); assert.deepEqual(p.calls, ['closeChat'], 'a post to its feed, no list');
  // the sidebar's mode follows peek wherever the list is not beside (the real sideWant / syncSide)
  const sides = between(js, '  const narrow = () => (globalThis.innerWidth', '  function paintSide(relayout = true) {');
  const side = env => { const c = { innerWidth: 1440, one: () => false, oneSplit: () => false, oneList: false, pane: null, folded: false, peek: false, offPeek: null,
    root: { dataset: { aadSide: 'open', aadChat: '', aadSplit: '' } }, CROWDED_FROM: 900, DOCKED_FROM: 900, mode: 'tiled', ...env };
    c.panes = { get: () => ({ mode: c.mode }) }; c.paintSide = () => { c.painted = (c.painted || 0) + 1; };
    return runRecording(sides + '\nglobalThis.want = sideWant; globalThis.sync = syncSide;', c); };
  assert.equal(side({ peek: true, mode: 'full' }).want(), 'over', 'full screen: Back peeks the list over');
  assert.equal(side({ peek: true, innerWidth: 600 }).want(), 'over', 'narrow too');
  assert.equal(side({ innerWidth: 600 }).want(), 'rail'); assert.equal(side({ folded: true }).want(), 'rail');
  assert.equal(side({ peek: true }).want(), 'open', 'wide, not folded: peek means nothing, the list is beside');
  { const s1 = side({ peek: true, offPeek: () => { s1.released = true; } }); s1.sync(); assert.equal(s1.peek, false, 'the list beside again: peek ends'); assert.equal(s1.released, true); }
  { const s2 = side({ peek: true, mode: 'full', root: { dataset: { aadSide: 'over' } } }); s2.sync(); assert.equal(s2.peek, true); assert.equal(s2.painted, undefined, 'full screen keeps it'); }
  { const s3 = side({ peek: true, one: () => true, mode: 'full' }); s3.sync(); assert.equal(s3.peek, false, 'one app at a time: no peek'); }
  // paintSide repaints the Back after the sizes
  const ps = runRecording(block(js, '  function paintSide(relayout = true) {') + '\npaintSide(false);', { sideWant: () => 'over', root: { dataset: {} }, reduced: () => true });
  const order = ps.calls.map(([n]) => n);
  assert.ok(order.includes('paintBack') && order.indexOf('applySizes') < order.indexOf('paintBack'), order.join());
  // Esc is the same Back in every mode: full screen is the Esc test below; tiled, docked: chatBack; else channel Back
  const surf = block(js, '  api.back.surface?.(() => {');
  const esc = env => { const c = { calls: [], doc: { activeElement: null }, pane: null, one: () => false, docked: true, panes: { get: () => ({ mode: 'tiled' }) },
    chatBack: () => { c.calls.push('chatBack'); return true; }, paintList: () => c.calls.push('paintList'), lastSurface: 'chat', ...env };
    c.api = { back: { surface: fn => { c.fn = fn; } }, sessions: { channelBack: () => { c.calls.push('channelBack'); return true; } } };
    runRecording(surf + ');', c); return { ok: c.fn(), calls: c.calls }; };
  assert.deepEqual(esc({}), { ok: true, calls: ['chatBack'] }, 'docked: Esc is the chat\'s Back');
  assert.deepEqual(esc({ docked: false }), { ok: true, calls: ['channelBack', 'paintList'] }, 'nothing docked: Channels\' own Back');
  // full screen shows the list over it when Back asks for it (the real desktop.css on the sidebar)
  const sheet = parseCss(css), html = createDocument().documentElement;
  for (const [k, v] of Object.entries({ 'data-shell': 'desktop', 'data-layout': 'ai-apps', 'data-aad-mode': 'full' })) html.setAttribute(k, v);
  const sideEl = createDocument().createElement('div'); sideEl.className = 'aad-side'; html.appendChild(sideEl);
  assert.equal(cascade(sideEl, sheet).display?.value, 'none', 'full screen: no sidebar');
  html.setAttribute('data-aad-side', 'over');
  assert.notEqual(cascade(sideEl, sheet).display?.value, 'none', 'Back asked for it: the list over the page');
});

// A narrow window (one app at a time, the list alone; wizard-ux issue 1452): a channel picked in the list shows its feed,
// also when a feed was already open behind the list (opened wide, then the window narrowed). paintOne alone only sees
// the column's thread change, and the feed is always FEED, so the list stayed over it and the click did nothing.
test('narrow window: a channel picked in the list shows its feed, also over a feed already open behind it', () => {
  const opened = between(js, '  function feedOpened(open) {', "  api.listen(globalThis, 'wos:channel-feed'");
  const run = ({ width = 420, pane = null, oneList = true, oneSeen = '__feed__' } = {}) => {
    const c = { FEED: '__feed__', chatThread: '__feed__', noteWant: false, draftWant: false, calls: [], pane, oneList, oneSeen, feedFocus: null,
      one: () => width < 1100, oneSplit: () => width >= 680,
      panes: { get: () => ({ mode: 'tiled', focus: 'chats' }), set: () => {} },
      here: () => ({ app: pane?.id || null }), mainChats: () => ({ desk: 1 }), unpeek: () => {}, paintTop: () => c.calls.push('paint'),
      api: { route: () => ({ view: 'thread', thread: '__new__' }), sessions: { newChat: () => c.calls.push('newChat') } } };
    vm.createContext(c);
    vm.runInContext(`${opened}\nfeedOpened({ id: 'voice' }); this.after = { oneList, oneSeen };`, c);
    return c;
  };
  for (const width of [640, 420]) {
    const c = run({ width });
    assert.equal(c.after.oneList, false, `${width}: the feed shows, not the list`); assert.equal(c.after.oneSeen, '__feed__');
    assert.ok(c.calls.includes('paint'), 'painted');
    assert.equal(run({ width, oneSeen: undefined }).after.oneList, false, `${width}: a first channel too`);
    assert.equal(run({ width, pane: { id: 'notes', desk: 5 } }).after.oneList, true, `${width}: an app in front keeps its own level`);
  }
  // with the list beside the chat (from 680) or a wide window the list never covers the feed: nothing changes
  for (const width of [960, 1440]) assert.equal(run({ width }).after.oneList, true, `${width}: unchanged`);
});
