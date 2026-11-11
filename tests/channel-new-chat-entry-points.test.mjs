// Channels (wizard/chat-channels, wizard-ux issue 1291): with a channel's feed in front, every way of starting a new chat
// (⌥V, the bar's New voice chat button, the orb, New chat / ⌘N / ⌥Enter / the layouts' +) posts in THAT channel, the
// way the feed's own box does, never in General. A post's thread open: voice replies there. No channel: unchanged.
// The real desktop.js / chats.js / app.js / layout source runs here; only the shell around it is stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const j = x => JSON.parse(JSON.stringify(x)); // vm values are cross-realm
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const desktop = read('web/desktop/desktop.js');
const cut = (src, from, to) => { const a = src.indexOf(from); assert.ok(a >= 0, from); const b = src.indexOf(to, a); assert.ok(b > a, to); return src.slice(a, b); };
const front = cut(desktop, '  function chanFront() {', '  // A take started in a channel (wizard/chat-channels)');
const talkNew = cut(desktop, '  function talkNew(', '  const generalVoice');
const record = cut(desktop, '  async function recordReply(', '  // Dictation (Right');
const chatsWinSrc = desktop.match(/^  const chatsWin = .+;$/m)?.[0];
assert.ok(chatsWinSrc, 'desktop resolves any Chats window by id');

// agent: the channel's own agent (main, a host-profile, a container or a restricted agent) — each keeps its own channel.
function shell({ foreground, feed = null, feedShown = false, agent = 'hermes', chan = { id: 'apps', name: 'WizardOS Apps', agent }, rowChannel = '' } = {}) {
  const calls = [], composed = [];
  const feedWin = { id: 'feed-1::side', app: 'chats', get thread() { return null; } };
  const ctx = {
    calls, composed, MOD: '⌥', VOICE: { state: 'idle' }, vMode: 'talk', vNewChat: false, vChanKey: false, vNewKey: '⌥V',
    focused: () => foreground,
    feedBase: feed ? { id: 'feed-1' } : null,
    feedHost: feed ? { isConnected: true, dataset: { chats: 'feed-1::side' }, closest: () => (feedShown ? null : {}) } : null,
    feedOpen: () => feed,
    LIVE: { session: id => ({ id }), isWorking: () => false },
    W: foreground ? { [foreground.id]: foreground } : {}, sideWin: () => undefined, listWin: () => feedWin,
    CHATS: {
      chanOpen: w => (w?.chan ? chan : null),
      chanSpaceOf: w => (w && !w.thread && (w.chan || w === feedWin) ? (chan.general ? '' : chan.id) : null),
      channelOf: () => rowChannel,
      chanCompose: wid => (composed.push(wid), true),
      chanBox: () => `chan:${agent}:${chan.id}`, incognitoActive: () => false, isWorking: () => false, modelRoute: () => ({ model: 'm', provider: 'p', agent }),
    },
    talk: (...a) => (calls.push(['talk', ...a]), 'voice'),
    toast: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(`${chatsWinSrc.replace('const chatsWin', 'var chatsWin')}\nvar recordReply = async (wid, sid) => { calls.push(['reply', wid, sid]); return 'recording'; };\n${front}\n${talkNew}`, ctx);
  return ctx;
}

for (const agent of ['hermes', 'host-ops', 'box', 'locked']) {
  test(`⌥V with a classic ${agent} channel feed in front records a new post in that channel, and ⌥V again sends it`, async () => {
    const s = shell({ agent, foreground: { id: 'w1', app: 'chats', thread: null, chan: { id: 'apps' } } });
    assert.equal(await s.talkNew('⌥V'), 'voice');
    assert.deepEqual(j(s.calls), [['reply', 'w1', '__new__']], 'the feed box mic path, never a General new chat');
    assert.equal(s.vChanKey, true); assert.equal(s.vNewKey, '⌥V');
    s.VOICE.state = 'listen'; s.talkNew('⌥V');
    assert.deepEqual(j(s.calls).at(-1), ['talk', 'send'], 'the same key sends the take');
  });

  test(`${agent}: the AI apps main-column feed counts as the channel in front (orb, ⌥V, New chat)`, async () => {
    const s = shell({ agent, foreground: { id: 'main', app: 'chats', thread: '__new__' }, feed: { id: 'apps', name: 'WizardOS Apps' }, feedShown: true });
    assert.deepEqual(j(s.chanFront()), { wid: 'feed-1::side', sid: '__new__' });
    await s.talkNew('Click the orb');
    assert.deepEqual(j(s.calls), [['reply', 'feed-1::side', '__new__']]);
    assert.equal(s.chanPost(), true); assert.deepEqual(j(s.composed), ['feed-1::side'], 'New chat goes to the feed box');
  });
}

test('a post\'s thread open from a channel: ⌥V replies in that thread; New chat is not hijacked', async () => {
  const c = shell({ foreground: { id: 'w1', app: 'chats', thread: 'post-7', chan: { id: 'apps' } }, rowChannel: 'WizardOS Apps' });
  await c.talkNew();
  assert.deepEqual(j(c.calls), [['reply', 'w1', 'post-7']]);
  assert.equal(c.chanPost(), false);
  const a = shell({ foreground: { id: 'main', app: 'chats', thread: 'post-7' }, feed: { id: 'apps', name: 'WizardOS Apps' }, feedShown: false, rowChannel: 'WizardOS Apps' });
  await a.talkNew(); assert.deepEqual(j(a.calls), [['reply', 'main', 'post-7']], 'AI apps: a post opened from the feed');
  const other = shell({ foreground: { id: 'main', app: 'chats', thread: 'elsewhere' }, feed: { id: 'apps', name: 'WizardOS Apps' }, feedShown: false, rowChannel: 'General' });
  await other.talkNew(); assert.deepEqual(j(other.calls), [['talk', 'start', true, '⌥V']], 'a thread from another channel keeps ⌥V = new chat');
  // Classic: the window keeps its channel when a notification or an app opens an unrelated thread in it.
  const unrelated = shell({ foreground: { id: 'w1', app: 'chats', thread: 'alert-3', chan: { id: 'apps' } }, rowChannel: 'General' });
  await unrelated.talkNew(); assert.deepEqual(j(unrelated.calls), [['talk', 'start', true, '⌥V']], 'an unrelated thread in a channel window is never replied to by ⌥V');
});

test('no channel in front: ⌥V, the orb and New chat behave exactly as before', async () => {
  for (const fg of [{ id: 'w1', app: 'chats', thread: null }, { id: 'w1', app: 'chats', thread: '__new__' }, { id: 'w1', app: 'chats', thread: 't1' }, { id: 'a', app: 'frame' }, null]) {
    const s = shell({ foreground: fg });
    await s.talkNew('⌥V');
    assert.deepEqual(j(s.calls), [['talk', 'start', true, '⌥V']]);
    assert.equal(s.chanPost(), false); assert.equal(s.composed.length, 0);
  }
  // An app in front with an AI apps feed beside it: the app keeps its own voice.
  const app = shell({ foreground: { id: 'a', app: 'frame' }, feed: { id: 'apps', name: 'WizardOS Apps' }, feedShown: true });
  await app.talkNew(); assert.deepEqual(j(app.calls), [['talk', 'start', true, '⌥V']]);
});

test('recordReply files a new post from the AI apps feed (no desk window) into that channel\'s Space', async () => {
  const ctx = { calls: [], vReply: null, VOICE: { state: 'idle', start: async () => {} }, dictationFinishing: false, $: () => ({}), toast() {}, commandSnapshot: () => ({}), viewContext: () => '',
    WosCaptureTools: { take: () => ({ close() {} }) }, paintVoiceFiles() {}, loadVoiceModels: async () => {}, chanRoute: r => r, W: {}, LIVE: { session: () => null },
    sideWin: id => (id === 'feed-1' ? { id: 'feed-1' } : undefined) };
  const feedWin = { id: 'feed-1::side', get thread() { return null; } };
  ctx.listWin = () => feedWin;
  ctx.CHATS = { incognitoActive: () => false, chanBox: () => 'chan:hermes:apps', modelRoute: () => ({ model: 'm', provider: 'p' }), isWorking: () => false,
    uploadFile() {}, chanSpaceOf: w => (w === feedWin ? 'apps' : null) };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(`var vFiles=null,vRoute=null,vRouteAt=null,strictReply=false,vConversation=null,vFeedback=null,commandTake=false,vSnapshot=null,vMode='',vNewChat=false,vChanKey=true,vTarget=null,vContext='';\n${chatsWinSrc.replace('const chatsWin', 'var chatsWin')}\n${record}`, ctx);
  assert.equal(await ctx.recordReply('feed-1::side', '__new__'), 'recording');
  assert.equal(ctx.vReply.space, 'apps', 'filed into the feed\'s channel, not General');
  assert.equal(ctx.vReply.box, 'chan:hermes:apps');
  assert.equal(vm.runInContext('vChanKey', ctx), false, 'a box-mic take is not a key take until chanTalk says so');
});

test('the orb / ⌥S path and New chat keys reach the channel: wiring in desktop, phone and both AI apps layouts', () => {
  const talk = cut(desktop, '  async function talk(', '  // Composer mic:');
  assert.match(talk, /action === 'toggle' && !forceNew\) \{ const c = chanFront\(\); if \(c && c\.wid !== focused\(\)\?\.id && c\.sid === '__new__'\) return chanTalk\(c, ''\);/);
  assert.match(desktop, /code === 'KeyN'\) return hit\(\(\) => \{[^\n]*chanPost\(\) \|\| newChat\(\); \}\);/);
  assert.match(desktop, /code === 'Enter'\) return hit\(\(\) => \{ if \(!e\.repeat\) chanPost\(\) \|\| newChat\(\); \}\);/);
  assert.match(desktop, /name: 'New chat'[^\n]*run: \(\) => chanPost\(\) \|\| newChat\(\)/);
  assert.match(desktop, /chatChannelPost: \(\) => chanPost\(\),/);
  assert.match(read('web/core/skin-host.js'), /channelPost: \(\) => live\(\) \? !!shell\.chatChannelPost\?\.\(\) : false,/);
  assert.match(read('web/app.js'), /chatChannelPost: \(\) => \{ const w = W\[desks\[idx\]\?\.focus\]; return w\?\.app === 'chats' && !w\.thread && !!CHATS\.chanCompose\?\.\(w\.id\); \},/);
  assert.match(read('web/layouts/ai-apps/layout.js'), /api\.listen\(newBtn, 'click', \(\) => \{ if \(api\.sessions\.channelPost\?\.\(\)\) \{ closeMenu\(\); closeSheet\(\); closeDrawer\(\); \} else goHome\(\); \}\);/, 'phone +: the drawer closes over the channel box');
  const aad = read('web/layouts/ai-apps/desktop.js');
  assert.match(aad, /api\.listen\(newBtn, 'click', newOrPost\); api\.listen\(rNew, 'click', newOrPost\);/);
  assert.match(aad, /code === 'KeyN' && !sh\) return once\(newOrPost\)/);
  assert.match(aad, /const goHome = \(\) => \{[^\n]*newChat\(\); \};/, 'Home still leaves the channel');
});

test('chanCompose: only a feed with its own box takes a new chat', () => {
  const chats = read('web/core/chats.js');
  const src = cut(chats, '  function chanCompose(wid) {', '  // Posts still on their way');
  const ended = [];
  const box = { tag: 'ta' };
  const ctx = { W: { feed: { id: 'feed' }, list: { id: 'list' } }, chanDraftKey: w => (w?.id === 'feed' ? 'chan:hermes:apps' : ''), elOf: id => ({ querySelector: () => (id === 'feed' ? box : null) }), chanToEnd: (...a) => ended.push(a) };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  assert.equal(ctx.chanCompose('feed'), true); assert.deepEqual(ended, [['feed', true]], 'the feed goes to its end with its box focused');
  assert.equal(ctx.chanCompose('list'), false); assert.equal(ctx.chanCompose('none'), false);
  assert.match(chats, /chanSpaceOf, chanCompose, chanBox:/, 'exported to the shells');
});
