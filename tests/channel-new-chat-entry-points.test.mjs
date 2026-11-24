// Channels (wizard/chat-channels, wizard-ux issue 1291): with a channel's feed in front, every way of starting a new chat
// (⌥V, the bar's New voice chat button, the orb, New chat / ⌘N / ⌥Enter / the layouts' +) posts in THAT channel, the
// way the feed's own box does, never in General. A post's thread open: voice replies there. No channel: unchanged.
// The real desktop.js / chats.js / app.js / layout source runs here; only the shell around it is stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { block, runRecording } from './fixtures/source-slice.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withDesktopParts } from './fixtures/desktop-parts.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';

const j = x => JSON.parse(JSON.stringify(x)); // vm values are cross-realm
const read = p => withShellParts(withWebParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8')));
const desktop = withDesktopParts(read('web/desktop/desktop.js'));
const cut = (src, from, to) => { const a = src.indexOf(from); assert.ok(a >= 0, from); const b = src.indexOf(to, a); assert.ok(b > a, to); return src.slice(a, b); };
const front = cut(desktop, '  function chanFront() {', '  // A take started in a channel re-reads');
const talkNew = cut(desktop, '  function talkNew(', '  const generalVoice');
const record = cut(desktop, '  async function recordReply(', '  // Dictation (Right');
const chatsWinSrc = desktop.match(/^  const chatsWin = .+;$/m)?.[0];
assert.ok(chatsWinSrc, 'desktop resolves any Chats window by id');

// agent: the channel's own agent (main, a host-profile, a container or a restricted agent) — each keeps its own channel.
function shell({ view = 'channels', foreground, feed = null, feedShown = false, agent = 'hermes', chan = { id: 'apps', name: 'WizardOS Apps', agent }, rowChannel = '' } = {}) {
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
      chanView: () => view,
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

// wizard-ux issue 1310 (James, 12 Nov 2026): the AI apps sidebar on Activity with General's feed left in the column.
test('the sidebar on Activity: ⌥V, the orb and New chat start a normal new chat, never a post in the leftover feed', async () => {
  const s = shell({ view: 'activity', foreground: { id: 'main', app: 'chats', thread: '__new__' }, feed: { id: '__general__', name: 'General' }, feedShown: true });
  assert.equal(s.chanFront(), null);
  await s.talkNew('⌥V'); assert.deepEqual(j(s.calls), [['talk', 'start', true, '⌥V']]);
  assert.equal(s.chanPost(), false); assert.equal(s.composed.length, 0, 'General\'s box is not focused');
  const back = shell({ view: 'channels', foreground: { id: 'main', app: 'chats', thread: '__new__' }, feed: { id: '__general__', name: 'General' }, feedShown: true });
  assert.equal(back.chanPost(), true, 'back on Channels › General: + focuses its box'); assert.deepEqual(j(back.composed), ['feed-1::side']);
});

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

const lineOf = (src, from) => { const a = src.indexOf(from); assert.ok(a >= 0, from); return src.slice(a, src.indexOf('\n', a)); };
const raw = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('the orb / ⌥S path and New chat keys reach the channel: wiring in desktop, phone and both AI apps layouts', async () => {
  // Desktop talk() (the orb, ⌥S, Right ⌘): a feed in the AI apps main column is the channel the take goes to.
  const talk = cut(desktop, '  async function talk(', '  // Composer mic:');
  const s = shell({ view: 'channels', foreground: { id: 'main', app: 'chats', thread: '__new__' }, feed: { id: 'apps', name: 'WizardOS Apps' }, feedShown: true });
  vm.runInContext(`var dictationFinishing = false, chanTalk = (c, k) => (calls.push(['chanTalk', c.wid, c.sid, k]), 'channel');\n${talk}`, s);
  s.CHATS.incognitoActive = () => false;
  assert.equal(await s.talk('toggle'), 'channel');
  assert.deepEqual(j(s.calls).at(-1), ['chanTalk', 'feed-1::side', '__new__', ''], 'the orb records into the feed\'s channel');
  // Desktop ⌥N, ⌥Enter and the palette's New chat (desktop-pickany.js, desktop-palpaint.js): the channel box first.
  const pick = raw('web/desktop/desktop-pickany.js'), pal = raw('web/desktop/desktop-palpaint.js');
  const key = (code, post) => {
    const calls = [];
    vm.runInNewContext(`(() => { ${lineOf(pick, "    if ((menu || alt) && !shift && code === 'KeyN') return hit(")}\n${lineOf(pick, "    if (alt && !shift && code === 'Enter') return hit(")} })()`,
      { calls, menu: false, alt: true, shift: false, code, e: { repeat: false }, hit: fn => fn(), closePalette() {}, toggleKeys() {}, closeSettings() {}, closeUsage() {}, chanPost: () => (calls.push('chanPost'), post), newChat: () => calls.push('newChat') });
    return j(calls);
  };
  for (const code of ['KeyN', 'Enter']) { assert.deepEqual(key(code, true), ['chanPost'], code); assert.deepEqual(key(code, false), ['chanPost', 'newChat'], code); }
  const palCalls = [];
  const entry = vm.runInNewContext(`(${lineOf(pal, "      { kind: 'cmd', name: 'New chat',").trim().replace(/,$/, '')})`, { MOD: '⌥', chanPost: () => (palCalls.push('chanPost'), true), newChat: () => palCalls.push('newChat') });
  entry.run(); assert.deepEqual(palCalls, ['chanPost']);
  // The shells hand layouts their channel post: desktop (desktop-boot.js), phone (app-agentorb.js), the layout API.
  const boot = raw('web/desktop/desktop-boot.js');
  assert.equal(vm.runInNewContext(`({ ${lineOf(boot, '    chatChannelPost: () =>')} })`, { chanPost: () => 'posted' }).chatChannelPost(), 'posted');
  const orbPart = raw('web/app-agentorb.js'), composed = [];
  const phone = (w, ok = true) => vm.runInNewContext(`({ ${lineOf(orbPart, '    chatChannelPost: () =>')} })`, { appVars: { W: { f: w }, desks: [{ focus: 'f' }], idx: 0 }, CHATS: { chanCompose: id => (composed.push(id), ok) } }).chatChannelPost();
  assert.equal(phone({ id: 'f', app: 'chats', thread: null }), true); assert.deepEqual(composed, ['f']);
  assert.equal(phone({ id: 'f', app: 'chats', thread: 't1' }), false, 'an open thread is not a channel box');
  assert.equal(phone({ id: 'f', app: 'frame' }), false);
  const shellapi = raw('web/core/skin-host-shellapi.js');
  const sess = on => vm.runInNewContext(`({ ${lineOf(shellapi, '        channelPost: () =>')} })`, { live: () => on, skinHostVars: { shell: { chatChannelPost: () => 1 } } });
  assert.equal(sess(true).channelPost(), true); assert.equal(sess(false).channelPost(), false);
  // Phone AI apps (layout.js): + over a channel closes the drawer onto its box; on Activity it goes Home.
  const layout = raw('web/layouts/ai-apps/layout.js');
  const phonePlus = (view, post) => {
    const calls = []; let handler;
    vm.runInNewContext(lineOf(layout, "  api.listen(newBtn, 'click', () => { if (api.sessions.channelView"), { newBtn: {}, api: { listen: (n, t, fn) => { handler = fn; }, sessions: { channelView: () => view, channelPost: () => (calls.push('post'), post) } },
      closeMenu: () => calls.push('menu'), closeSheet: () => calls.push('sheet'), closeDrawer: () => calls.push('drawer'), goHome: () => calls.push('home') });
    handler(); return j(calls);
  };
  assert.deepEqual(phonePlus('channels', true), ['post', 'menu', 'sheet', 'drawer'], 'phone +: the drawer closes over the channel box');
  assert.deepEqual(phonePlus('activity', true), ['home']);
  assert.deepEqual(phonePlus('channels', false), ['post', 'home']);
  // Desktop AI apps (desktop-home.js, run as the module): + and the rail's + share plus; ⌥N is plus; Home leaves the channel.
  const { homePart } = await import('../web/layouts/ai-apps/desktop-home.js');
  const listens = [], calls = [], btn = n => ({ n, append() {}, setAttribute() {} });
  const aadVars = { chatThread: '__feed__', pane: null };
  const api = { listen: (t, ev, fn) => listens.push([t.n, ev, fn]), desk: { attention: () => null, settings() {} }, apps: { list: () => [] },
    sessions: { channelView: () => 'channels', channelPost: () => (calls.push('post'), true), channelBack: () => calls.push('back'), newChat: () => calls.push('newChat') } };
  const H = homePart({ aadVars, api, appName: x => x, cancelBtn: btn('cancel'), closeMenu: () => calls.push('closeMenu'), closeWs() {}, desks: () => [], el: () => ({ append() {}, setAttribute() {} }),
    FEED: '__feed__', feedOn: () => (aadVars.chatThread === '__feed__' ? { id: 'apps' } : null), field: btn('field'), findBtn: btn('find'), loading() {}, newBtn: btn('new'), panes: { get: () => ({}) },
    rFind: btn('rfind'), rNew: btn('rnew'), rSet: btn('rset'), scroll: {}, setBtn: btn('set'), setSearch() {}, unpeek() {} });
  const click = n => listens.find(l => l[0] === n && l[1] === 'click')[2];
  assert.equal(click('new'), H.plus); assert.equal(click('rnew'), H.plus);
  click('new')(); assert.deepEqual(calls, ['post', 'closeMenu'], 'the feed\'s box takes the new chat');
  const hidden = []; H.bindLate({ hidePanel: o => hidden.push(o), closeAll() {}, mainChats: () => null, NOTE: '__note__', paintList() {}, wantAppFocus() {} });
  aadVars.pane = { id: 'notes' }; calls.length = 0; H.goHome();
  assert.equal(aadVars.chatThread, null, 'Home still leaves the channel'); assert.deepEqual(hidden, [{ home: false }]); assert.ok(calls.includes('newChat'));
  const keys = raw('web/layouts/ai-apps/desktop-keys.js'); let pressed = null;
  vm.runInNewContext(`(() => { ${lineOf(keys, "    if (code === 'KeyN' && !sh) return once(plus);")} })()`, { code: 'KeyN', sh: false, plus: H.plus, once: fn => { pressed = fn; return true; } });
  assert.equal(pressed, H.plus, '⌥N is the same +');
});

test('chanCompose: only a feed with its own box takes a new chat', () => {
  const chats = withParts(read('web/core/chats.js'));
  const src = cut(chats, '  function chanCompose(wid) {', '  // Posts still on their way');
  const ended = [];
  const box = { tag: 'ta' };
  const ctx = vm.createContext({ W: { feed: { id: 'feed' }, list: { id: 'list' } }, chanDraftKey: w => (w?.id === 'feed' ? 'chan:hermes:apps' : ''), elOf: id => ({ querySelector: () => (id === 'feed' ? box : null) }), chanToEnd: (...a) => ended.push(a) });
  vm.runInContext(src, ctx);
  assert.equal(ctx.chanCompose('feed'), true); assert.deepEqual(ended, [['feed', true]], 'the feed goes to its end with its box focused');
  assert.equal(ctx.chanCompose('list'), false); assert.equal(ctx.chanCompose('none'), false);
  // exported to the shells: Chats' own API object (its return line, run) hands out this chanCompose
  const ret = block(chats, '  return { beforeNavigate:');
  const mine = () => 'composed', api = runRecording(`globalThis.api = (() => {\n${ret}\n})();`, { chanCompose: mine, window: {} }).api;
  assert.equal(api.chanCompose, mine, 'exported to the shells');
});
