// Back from a thread to its channel on the desktop (wizard-ux issue 1302; James, 11 Nov 2026: "if I open a channel and then
// I click through to a thread there's no way for me to go back to the channel currently so I think on desktop we will
// need a back button. at least when the user opens a chat from a channel"). The AI apps main column: a thread opened from
// the channel's feed shows "‹ # name" at the left of its header, and it is Esc (closeChat: the feed, at its place). A
// thread opened from Activity or the sidebar shows none. The phone (its own Back) is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const js = read('web/layouts/ai-apps/desktop.js'), css = read('web/layouts/ai-apps/desktop.css');
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, a); const j = s.indexOf(b, i); assert.ok(j > i, b); return s.slice(i, j); };

function world() {
  const listeners = [], attrs = {};
  const cBack = { hidden: true, textContent: '', title: '', setAttribute: (k, v) => { attrs[k] = v; } };
  const c = { FEED: '__feed__', feedBox: {}, cBack, open: { id: 'apps', name: 'WizardOS Apps' }, chatThread: '__feed__', docked: true, closed: 0,
    api: { listen: (t, type, fn, opts) => listeners.push({ t, type, fn, opts }) } };
  c.feedOn = () => c.open; c.closeChat = () => { c.closed++; return true; };
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
  // id), then the lists; feedTitle is hoisted (paintTop can run before its line)
  assert.match(js, /chatThread \? feedTitle\(chatThread\) \|\| titleOf\(chatThread\) : '';\n    tt\.textContent = docked \? t : '';/);
  assert.match(js, /\n  function feedTitle\(sid\) \{/);
  // the feed's posts carry their title
  assert.match(read('web/core/chats.js'), /data-chrow="\$\{esc\(chanKey\(s\)\)\}" data-chtitle="\$\{esc\(s\.title \|\| ''\)\}">/);
});

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

test('wiring: the Back sits left of the title, every sidebar open clears it, the header repaints it; tokens only', () => {
  assert.match(js, /const cBack = el\('button', 'aad-cback', \{ type: 'button' \}\); cBack\.hidden = true;\n  cTop\.append\(cBack, tt, cX\);/);
  assert.match(js, /tt\.textContent = docked \? t : ''; tt\.title = t; paintBack\(\);/);
  assert.match(js, /stepAt = s\.id; fromFeed = null; api\.sessions\.open\(s\.id\);/, 'an Activity row');
  assert.match(js, /noteWant = id\.startsWith\('notif:'\); fromFeed = null; api\.sessions\.open\(id\);/, 'the rail');
  assert.match(js, /noteWant = nx\.id\.startsWith\('notif:'\); fromFeed = null; api\.sessions\.open\(nx\.id\);/, '⌥↓ / ⌥↑');
  // Back never exits (AGENTS.md): the button is the in-page Esc path only; closeChat swaps the column, no history step.
  assert.match(js, /api\.listen\(cBack, 'click', \(\) => closeChat\(\)\);/);
  const close = js.slice(js.indexOf('  function closeChat() {'), js.indexOf('\n  }\n', js.indexOf('  function closeChat() {')));
  assert.doesNotMatch(close, /history\.|location\.|\.back\(/, 'no history navigation in the Back path');
  assert.match(close, /if \(chatThread === FEED\)[^\n]*channelBack\?\.\(\)/, 'Esc on the feed itself still closes the feed');
  const rule = css.match(/\.aad-cback \{([^}]+)\}/)[1];
  assert.doesNotMatch(rule.replace(/var\([^)]*\)/g, ''), /#[0-9a-f]{3,8}\b|rgb/i, 'colours from tokens');
  assert.match(css, /\.aad-cback\[hidden\] \{ display: none; \}/);
  assert.doesNotMatch(read('web/layouts/ai-apps/layout.js'), /aad-cback|fromFeed/, 'the phone is unchanged');
});

// Esc on an app desk keeps the owner's view (wizard-ux issue 1330; see 1325): a post's thread back to its feed, and the
// feed closed, leave 50/50 / centred / full as they were; only a plain chat closing from them goes back to tiled.
test('closeChat: channel steps keep the view mode; a plain chat still goes back to tiled', () => {
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
    assert.equal(plain.mode, 'tiled', `a plain chat closing from ${mode}: tiled, as before`);
  }
  assert.equal(run({ thread: '__feed__', mode: 'tiled' }).calls.includes('mode:tiled:chats'), false);
});

// A channel opened with an app centred (wizard-ux issue 1344): its feed comes to the front the way a chat does (the
// chat slot takes the focus), and closing the feed gives the front back to the app, in the same view.
test('feedOpened brings the feed to the front; closing the feed gives it back to the app', () => {
  const opened = between(js, '  function feedOpened(open) {', "  api.listen(globalThis, 'wos:channel-feed'");
  assert.match(opened, /function feedGone\(\)/, 'the hand-back helper sits with feedOpened');
  const close = between(js, '  function closeChat() {', '  function setWide(on) {');
  const desk = ({ mode = 'centre', focus = 'app', app = 'pages', fromFeed = false } = {}) => {
    const c = { FEED: '__feed__', docked: true, chatThread: null, noteWant: false, draftWant: false, calls: [], mode, focus, pane: app ? { id: app } : null,
      panes: { get: () => ({ mode: c.mode, focus: c.focus }), set: v => { if (v.mode) c.mode = v.mode; if (v.focus) { c.focus = v.focus; c.calls.push('focus:' + v.focus); } } },
      here: () => ({ app }), mainChats: () => ({ desk: 1 }), feedBack: () => (fromFeed ? { id: 'launch' } : null),
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
  for (const re of [/noteWant = !!s\.note; feedFocus = null; stepAt = s\.id;/, /feedFocus = null; railLast = key; stepAt = id;/, /feedFocus = null; stepAt = nx\.id;/]) assert.match(js, re);
  // the feed gone on a repaint (its channel closed while it was in the column): the same hand-back
  assert.match(js, /else if \(chatThread === FEED \? !feedOn\(\) : !chatThread\) \{ if \(chatThread === FEED\) feedGone\(\); chatThread = !chatThread && feedOn\(\) \? FEED : behindThread\(\); \}/);
  // no app open: nothing to give the front back to
  const bare = desk({ app: '' }); bare.pane = null; bare.open(); bare.close(); assert.equal(bare.focus, 'chats');
});

// Esc full screen (wizard-ux issue 1325; James, 12 Nov 2026: "going back shouldn't change the user's selected view"): a
// channel post's thread in the chat column, full screen, goes back to its feed and stays full screen, as its Back button
// does; anything else in full screen (an app, a plain chat, the feed itself) still leaves full screen first.
test('Esc in full screen: a post from the feed goes back to the feed and keeps full screen', () => {
  const src = between(js, '  api.back.surface?.(() => {', '    const a = doc.activeElement;');
  const run = ({ focus = 'chats', back = true, inApp = false }) => {
    const act = {}, c = { calls: [], doc: { activeElement: act }, lastSurface: focus === 'chats' ? 'chat' : 'app', globalThis: {},
      pane: { el: { contains: n => inApp && n === act, querySelector: () => null } }, chatsEl: () => ({ contains: n => !inApp && n === act }),
      panes: { get: () => ({ mode: 'full', focus }) }, feedBack: () => (back ? { id: 'launch', name: 'Launch' } : null),
      closeChat: () => { c.calls.push('closeChat'); return true; }, windowMode: m => c.calls.push('mode:' + m),
      api: { back: { surface: fn => { c.fn = fn; } } } };
    vm.createContext(c); vm.runInContext(`${src}  });\nthis.ok = this.fn();`, c);
    return c;
  };
  const post = run({}); assert.equal(post.ok, true); assert.deepEqual(post.calls, ['closeChat'], 'the feed again, still full screen');
  assert.deepEqual(run({ back: false }).calls, ['mode:tiled'], 'a plain chat or the feed: Esc leaves full screen');
  assert.deepEqual(run({ focus: 'app', inApp: true }).calls, ['mode:tiled'], 'the app full screen: unchanged');
});
