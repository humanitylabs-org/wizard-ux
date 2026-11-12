// A model picked in a channel's message box (wizard-ux issue 1309; James, 12 Nov 2026: "I select Opus as a model on
// desktop, but it still displays Sonnet"). On the desktop the feed is drawn by a pane of its own (AI apps: id::side;
// classic: id::list) whose window is another id: the pick was written for the window while the label, Send, the box
// mic and the orb read the pane, so the label stayed on the default and the post went on the default model.
// The real core/chat-power.js picker and the real channel block of core/chats.js, with pane != window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const kit = readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
const power = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const OPTS = [{ value: 'claude-opus', provider: 'anthropic', name: 'Opus' }, { value: 'claude-sonnet', provider: 'anthropic', name: 'Sonnet', isGlobalDefault: true }];

// pane: the id the box is drawn in; thread: what the window behind it has open on its right (classic desktop).
function harness({ pane = 'win::side', thread = null } = {}) {
  const sent = [], toasts = [], threadSets = [], state = {}, picks = new Map(), paints = [];
  const w = { id: 'win', app: 'chats', thread, chan: { id: 'launch' } };
  const paneWin = pane === 'win' ? w : { id: pane, get thread() { return null; } };
  const box = id => (id === pane ? 'chan::launch' : id === 'win' && !w.thread ? 'chan::launch' : '');
  const ctx = { console, URL, Intl, Date, File, Blob, Response, setTimeout, clearTimeout, location: { origin: 'https://fixture.invalid', href: 'https://fixture.invalid/', hostname: 'fixture.invalid' }, navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: { addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) }, addEventListener() {},
    WizCore: { esc: String, clip: s => s }, WizConfig: { agent: () => 'Fixture' }, WizLive: { session: id => (id === 't1' ? { id: 't1', status: 'completed' } : null) },
    WosAgents: { isOther: a => !!a && a !== 'hermes', get: id => ({ id }), isPrivate: () => false },
    WosModels: { ready: true, options: OPTS, load: async () => {}, currentRoute: () => ({ model: 'claude-sonnet', provider: 'anthropic' }), privateOptions: () => [],
      defaultOption: () => OPTS[1], name: v => v, short: v => (OPTS.find(o => o.value === v) || {}).name || v, ours: () => false,
      setThreadModel: async (sid, o) => { threadSets.push([sid, o.value]); return { model: o.value, provider: o.provider }; },
      sheetHtml: opt => { paints.push(opt.cur); return { list: OPTS, html: '' }; } },
    WosOutbox: { unsent: () => [], enqueue: async it => { sent.push(it); return { ...it, sessionId: 'wizard_new_' + sent.length, durable: true }; } } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(kit, ctx); vm.runInContext(power, ctx);
  const H = { root: () => ({ querySelectorAll: () => [] }), win: id => (id === 'win' ? w : id === pane ? paneWin : null), recordReply: () => 'recording', recordingFor: () => '', viewContext: () => '', overlay() {} };
  const api = ctx.WosChatPower({ ch: () => state, CH: { win: state }, toast: (i, t) => toasts.push(t), H, renderChats() {}, renderThreadNow() {},
    owner: id => String(id).replace(/::(list|side)$/, ''), elOf: () => ({ querySelectorAll: () => [], querySelector: () => null, insertAdjacentHTML() {}, classList: { remove() {}, add() {} }, style: { removeProperty() {}, setProperty() {} } }),
    MIC_SVG: '<svg ', closeRowSheet() {}, vib() {}, isWorking: () => false, takeComposer: () => ({ text: '', files: [], done() {}, putBack() {} }), leaveAfterSend: () => false, openChat() {},
    winAgent: () => '', chanOpen: x => (!x.thread ? { id: 'launch', name: 'Launch' } : null), chanSpaceOf: x => (!x.thread ? 'launch' : null), spaceMember() {},
    chanBox: box, chanModel: id => (box(id) ? picks.get(box(id)) || null : null), setChanModel: (id, r) => { if (!box(id)) return false; picks.set(box(id), r); return true; } });
  const click = (sel, data = {}) => api.click({ target: { closest: s => (s === sel ? { dataset: data } : null) } }, pane);
  const label = () => api.modelLabel({ ...paneWin, thread: '__new__' }, null, picks.get('chan::launch') || null); // a box: null = its default
  return { api, w, sent, toasts, threadSets, state, picks, paints, click, label };
}

for (const [where, pane] of [['AI apps feed pane', 'win::side'], ['classic list pane', 'win::list'], ['phone (the window itself)', 'win']]) {
  test(`${where}: picking Opus in the box is the box's own pick, shown at once, and rides with its voice post`, async () => {
    const h = harness({ pane });
    assert.match(h.label(), />Sonnet</, 'the default before a pick');
    h.click('[data-chmodel]');
    assert.equal(h.paints.length, 1, 'the menu opened from the box'); assert.equal(h.paints[0].model, 'claude-sonnet', 'its tick: the box default');
    h.click('[data-mpick]', { mpick: '0' }); // Opus
    assert.deepEqual(JSON.parse(JSON.stringify(h.picks.get('chan::launch'))), { model: 'claude-opus', provider: 'anthropic' });
    assert.match(h.label(), />Opus</, 'the label reads the pick');
    assert.equal(h.state.newModel, undefined, 'the window\'s New chat pick is untouched');
    assert.match(h.toasts.at(-1), /Opus/);
    h.click('[data-chmodel]'); assert.equal(h.paints.at(-1).model, 'claude-opus', 'reopened, the menu ticks the pick');
    h.state.newModel = { model: 'claude-sonnet', provider: 'anthropic' }; // a separate New chat pick on the window
    await h.api.sendVoiceTo(pane, '__new__', new Blob(['a']), [], false); // the box mic, no route handed in
    assert.equal(h.sent[0].model, 'claude-opus'); assert.equal(h.sent[0].provider, 'anthropic');
    assert.equal(h.state.newModel?.model, 'claude-sonnet', 'a channel take never clears the window\'s New chat pick (review)');
  });
}

test('classic: a pick in the list pane\'s channel box never changes the thread open on the right', async () => {
  const h = harness({ pane: 'win::list', thread: 't1' });
  h.click('[data-chmodel]'); h.click('[data-mpick]', { mpick: '0' });
  await new Promise(r => setImmediate(r));
  assert.deepEqual(h.threadSets, [], 'no thread model change');
  assert.equal(h.picks.get('chan::launch')?.model, 'claude-opus');
});

test('with no box pick the label shows the default, never the window\'s New chat pick (review)', () => {
  const h = harness();
  h.state.newModel = { model: 'claude-opus', provider: 'anthropic' };
  assert.match(h.label(), />Sonnet</);
  h.click('[data-chmodel]'); assert.equal(h.paints.at(-1).model, 'claude-sonnet', 'the menu ticks the same default');
});

test('a New chat\'s pick still goes to the window, never into a channel box', () => {
  const h = harness({ pane: 'win', thread: '__new__' });
  h.click('[data-chmodel]'); h.click('[data-mpick]', { mpick: '0' });
  assert.equal(h.state.newModel?.model, 'claude-opus'); assert.equal(h.picks.size, 0);
});

// The real channel block: one pick per box (agent + channel), read by the label, Send and modelRoute.
function channels() {
  const a = chats.indexOf('  function chanDraftKey(w) {'), b = chats.indexOf('  // The feed\'s newest post sits at the bottom');
  assert.ok(a > 0 && b > a);
  const wins = { win: { id: 'win', thread: null }, 'win::side': { id: 'win::side', thread: null } }, open = { cur: { id: 'launch', name: 'Launch' } }, painted = [], c = {};
  const ctx = { W: wins, CH: { win: {}, 'win::side': {} }, ch: () => c, chanOpen: () => open.cur, chanArchived: () => false, winAgent: () => '', elOf: id => ({ id }), renderChatList: (x, el) => painted.push(el.id),
    KIT: { drafts: { get: () => ({ text: '', files: [] }), set() {} } }, PREVIEW: {}, fileUrl: String, CLIP_SVG: '', esc: String, hasContent: () => false, attachTray: () => '',
    PW: { ensureModels() {}, modelLabel: (w, s, pick) => `<b class="ch-mlabel">${pick ? pick.model : 'default'}</b>`, micBtn: () => '' }, Map };
  vm.createContext(ctx); vm.runInContext(chats.slice(a, b) + ';this.api={chanDraftKey,boxModel,chanModel,setChanModel,chanComposer};', ctx);
  return { ...ctx.api, wins, open, painted, c };
}

test('the channel box pick is kept per channel, repaints every box of that channel at once and survives switching', () => {
  const f = channels();
  assert.match(f.chanComposer(f.wins['win::side'], f.open.cur), />default</);
  assert.equal(f.setChanModel('win::side', { model: 'claude-opus', provider: 'anthropic' }), true);
  assert.deepEqual(f.painted.sort(), ['win', 'win::side'], 'both boxes of #Launch repaint on the pick');
  assert.match(f.chanComposer(f.wins['win::side'], f.open.cur), />claude-opus</);
  assert.equal(f.c.newModel, undefined, 'never the window\'s New chat pick');
  f.open.cur = { id: 'voice', name: 'Voice' };
  assert.equal(f.chanModel(f.wins['win::side']), null, 'another channel keeps its own default');
  f.open.cur = { id: 'launch', name: 'Launch' };
  assert.equal(f.chanModel(f.wins.win)?.model, 'claude-opus', 'back in #Launch, the pick is still there');
  f.open.cur = { id: 'launch', name: 'Launch', agent: 'host' };
  assert.equal(f.chanModel(f.wins.win), null, 'a different agent\'s channel of the same id is its own box');
});

test('a take keeps the box it started in: modelRoute by box key, whatever channel is in front by Send (review)', () => {
  const f = channels();
  f.setChanModel('win', { model: 'claude-opus', provider: 'anthropic' }); // #Launch
  f.open.cur = { id: 'voice', name: 'Voice' }; f.setChanModel('win', { model: 'claude-haiku', provider: 'anthropic' }); // #Voice in front by Send
  assert.equal(f.boxModel('chan::launch')?.model, 'claude-opus');
  assert.equal(f.boxModel('chan::voice')?.model, 'claude-haiku');
  f.setChanModel('win', { model: 'p', provider: 'p', agent: 'restricted' }); assert.equal(f.boxModel('chan::voice')?.model, 'claude-haiku', 'never another agent\'s model');
  assert.match(chats, /modelRoute: \(wid, sid, box\) => \{ const nm = sid !== '__new__' \? null : box \? boxModel\(box\)/);
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'), desk = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
  assert.match(app, /CHATS\.modelRoute\(pin\.wid, pin\.sid, pin\.box \|\| undefined\)/); assert.match(app, /CHATS\.modelRoute\(V\.replyTo\.wid,V\.replyTo\.sid,V\.replyTo\.box\|\|undefined\)/);
  assert.match(desk, /forceNew \? undefined : vBox \|\| undefined\);/); assert.match(desk, /CHATS\.modelRoute\(wid,sid,box \|\| undefined\)/);
});

test('a typed channel post leaves the window\'s New chat pick alone (review)', () => {
  assert.match(chats, /const chanPost = isNew && typeof opts\.space === 'string';[^\n]*\n    if \(nm && !chanPost\) c\.newModel = null;/);
  assert.match(chats, /if \(nm && !chanPost\) c\.newModel = nm;/);
});

test('Send and the orb read the box\'s pick (source contract)', () => {
  assert.match(chats, /const route = chanModel\(w\);\n/, 'channelSend: the box pick');
  assert.match(chats, /box \? boxModel\(box\) : chanDraftKey\(W\[wid\]\) \? chanModel\(W\[wid\]\) : PW\?\.newModel\(ch\(wid\)\);/, 'the orb / ⌥V route');
  assert.match(chats, /PW\.modelLabel\(\{ \.\.\.w, thread: '__new__' \}, null, chanModel\(w\)\)/, 'the label');
  // The whole export is one line: a // comment inside it would silently drop every later entry.
  const exp = chats.slice(chats.indexOf('  return { beforeNavigate'), chats.indexOf('\n', chats.indexOf('  return { beforeNavigate')));
  assert.doesNotMatch(exp, /\/\/ /); assert.match(exp, /renderChatList,[^\n]*chanModel: wid => chanModel\(W\[wid\]\), setChanModel,[^\n]*sendChat,/);
});
