// A model picked in a channel's message box (wizard-ux issue 1309; James, 12 Nov 2026: "I select Opus as a model on
// desktop, but it still displays Sonnet"). On the desktop the feed is drawn by a pane of its own (AI apps: id::side;
// classic: id::list) whose window is another id: the pick was written for the window while the label, Send, the box
// mic and the orb read the pane, so the label stayed on the default and the post went on the default model.
// The real core/chat-power.js picker and the real channel block of core/chats.js, with pane != window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withAppParts } from './fixtures/app-parts.mjs';
import { withParts } from './fixtures/chats-parts.mjs';
import { withDesktopParts } from './fixtures/desktop-parts.mjs';
import { between, block, runRecording } from './fixtures/source-slice.mjs'; // chats.js parts moved out verbatim (issue 1665)
const kit = readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
const power = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
const chats = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
const OPTS = [{ value: 'claude-opus', provider: 'anthropic', name: 'Opus' }, { value: 'claude-sonnet', provider: 'anthropic', name: 'Sonnet', isGlobalDefault: true }];

// pane: the id the box is drawn in; thread: what the window behind it has open on its right (classic desktop).
function harness({ pane = 'win::side', thread = null, refuse = false } = {}) {
  const sent = [], toasts = [], threadSets = [], state = {}, picks = new Map(), paints = [], sheets = [];
  const w = { id: 'win', app: 'chats', thread, chan: { id: 'launch' } };
  const paneWin = pane === 'win' ? w : { id: pane, get thread() { return null; } };
  const box = id => (id === pane ? 'chan::launch' : id === 'win' && !w.thread ? 'chan::launch' : '');
  const ctx = { console, URL, Intl, Date, File, Blob, Response, setTimeout, clearTimeout, location: { origin: 'https://fixture.invalid', href: 'https://fixture.invalid/', hostname: 'fixture.invalid' }, navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: { addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) }, addEventListener() {},
    WizCore: { esc: String, clip: s => s }, WizConfig: { agent: () => 'Fixture' }, WizLive: { session: id => (id === 't1' ? { id: 't1', status: 'completed' } : null) },
    WosAgents: { isOther: a => !!a && a !== 'hermes', get: id => ({ id }), isPrivate: () => false },
    WosModels: { ready: true, options: OPTS, load: async () => {}, currentRoute: () => ({ model: 'claude-sonnet', provider: 'anthropic' }), privateOptions: () => [{ value: 'p-model', provider: 'p', name: 'Private', agent: 'private-agent', private: true }],
      defaultOption: () => OPTS[1], name: v => v, short: v => (OPTS.find(o => o.value === v) || {}).name || v, ours: () => false,
      setThreadModel: async (sid, o) => { threadSets.push([sid, o.value]); return { model: o.value, provider: o.provider }; },
      sheetHtml: opt => { paints.push(opt.cur); sheets.push(opt); return { list: OPTS, html: '' }; } },
    WosOutbox: { unsent: () => [], enqueue: async it => { sent.push(it); return { ...it, sessionId: 'wizard_new_' + sent.length, durable: true }; } } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(kit, ctx); vm.runInContext(power, ctx);
  const H = { root: () => ({ querySelectorAll: () => [] }), win: id => (id === 'win' ? w : id === pane ? paneWin : null), recordReply: () => 'recording', recordingFor: () => '', viewContext: () => '', overlay() {} };
  const api = ctx.WosChatPower({ ch: () => state, CH: { win: state }, toast: (i, t) => toasts.push(t), H, renderChats() {}, renderThreadNow() {},
    owner: id => String(id).replace(/::(list|side)$/, ''), elOf: () => ({ querySelectorAll: () => [], querySelector: () => null, insertAdjacentHTML() {}, classList: { remove() {}, add() {} }, style: { removeProperty() {}, setProperty() {} } }),
    MIC_SVG: '<svg ', closeRowSheet() {}, vib() {}, isWorking: () => false, takeComposer: () => ({ text: '', files: [], done() {}, putBack() {} }), leaveAfterSend: () => false, openChat() {},
    winAgent: () => '', chanOpen: x => (!x.thread ? { id: 'launch', name: 'Launch' } : null), chanSpaceOf: x => (!x.thread ? 'launch' : null), spaceMember() {},
    chanBox: box, chanModel: id => (box(id) ? picks.get(box(id)) || null : null), setChanModel: (id, r) => { if (!box(id) || refuse) return false; picks.set(box(id), r); return true; } });
  const click = (sel, data = {}) => api.click({ target: { closest: s => (s === sel ? { dataset: data } : null) } }, pane);
  const label = () => api.modelLabel({ ...paneWin, thread: '__new__' }, null, picks.get('chan::launch') || null); // a box: null = its default
  return { api, w, sent, toasts, threadSets, state, picks, paints, sheets, click, label };
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

test('classic: the channel box menu lists no private models, and a refused pick never lands on the window (review #1396)', () => {
  const h = harness({ pane: 'win::list', thread: 't1' });
  h.click('[data-chmodel]');
  assert.ok(!h.sheets.at(-1).priv?.length, 'no private models in a channel box menu');
  const r = harness({ pane: 'win::list', thread: 't1', refuse: true });
  r.click('[data-chmodel]'); r.click('[data-mpick]', { mpick: '0' });
  assert.equal(r.state.newModel, undefined, 'the window\'s New chat pick is untouched');
  assert.equal(r.picks.size, 0);
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
  // the shell's modelRoute by box key: the box the take started in, whatever channel is in front now
  const r = sendRoutes(); r.setChanModel('win', { model: 'claude-opus', provider: 'anthropic' });
  r.open.cur = { id: 'voice', name: 'Voice' };
  assert.equal(r.modelRoute('win', '__new__', 'chan::launch').model, 'claude-opus', 'the box it started in');
  assert.notEqual(r.modelRoute('win', '__new__').model, 'claude-opus', 'without the box: the channel in front');
  // every voice take hands its box to modelRoute (the real shell lines, run)
  const app = (p => readFileSync(new URL('../web/' + p, import.meta.url), 'utf8'));
  const desk = withDesktopParts(app('desktop/desktop.js'));
  const asked = ctx => (ctx.calls || []).filter(c => c[0] === 'CHATS.modelRoute').map(c => c.slice(1));
  const tap = runRecording(`${block(app('app-voicesend.js'), '  function sendTapRoute(snap, pin) {')}\nthis.f = sendTapRoute;`, { window: { WosModels: { snapshot: () => null } } });
  tap.f({ route: {} }, { wid: 'w', sid: '__new__', box: 'chan::launch' }); tap.f({ route: {}, view: { id: 'w', thread: null, box: 'chan::voice' } }, null);
  assert.deepEqual(asked(tap), [['w', '__new__', 'chan::launch'], ['w', '__new__', 'chan::voice']], 'phone orb Send: the pinned box, else the view\'s');
  const reply = runRecording(`this.f = V => {\n${between(app('app-reply.js'), '      V.snap ||= sendSnap();', '\n')}\n};`, {});
  reply.f({ snap: { route: {} }, replyTo: { wid: 'w', sid: '__new__', box: 'chan::launch' } });
  assert.deepEqual(asked(reply), [['w', '__new__', 'chan::launch']], 'a parked reply keeps its box');
  const dv = runRecording(`${between(desk, '        const resolveRoute = () =>', '\n')}\nthis.f = resolveRoute;`, { vFeedback: null, forceNew: false, f: null, vTarget: 'w', vSnapshot: { thread: null }, vBox: 'chan::launch' });
  dv.f(); dv.forceNew = true; dv.f();
  assert.deepEqual(asked(dv), [['w', '__new__', 'chan::launch'], ['w', '__new__', undefined]], 'desktop voice: the box, none for a forced New chat');
  const dm = runRecording(`${between(desk, 'vRouteAt = () => CHATS.modelRoute(wid,sid,box || undefined);', ' vRoute = vRouteAt();')}\nvRouteAt();`, { wid: 'w', sid: '__new__', box: 'chan::launch' });
  assert.deepEqual(asked(dm), [['w', '__new__', 'chan::launch']], 'desktop box mic: its box');
});

// The real sendChat (core/chats-send.js, as tests/app-share-wizard.test.mjs runs it) with a window's New chat pick.
async function send({ space, route, fail = false }) {
  const start = chats.indexOf('  async function sendChat('), end = chats.indexOf('  const picker =', start);
  const c = { draft: '', files: [], newModel: { model: 'claude-sonnet', provider: 'anthropic' } }, enqueued = [];
  const sandbox = { window: {}, INC: null, W: { w1: { id: 'w1', app: 'chats', thread: '__new__' } }, ch: () => c, joinWords: (a, b) => [a, b].filter(Boolean).join('\n\n'), focusOf: () => null,
    PW: { newModel: x => x.newModel, follow() {} }, winAgent: () => '', AGS: () => null, KIT: { drafts: { get: () => ({}), clear() {}, set() {}, setReply() {} } }, LIVE: {}, setDraft() {}, toast() {},
    OUTBOX: { async enqueue(it) { if (fail) throw new Error('disk full'); enqueued.push(it); return { durable: true, sessionId: 'wizard_n1' }; } }, spaceMember() {}, openChat() {},
    viewContext: () => '', isWorking: () => false, pendRef: f => f, renderChats() {}, applyLayout() {}, deskOf: () => 0, leaveAfterSend: () => false };
  vm.runInNewContext(chats.slice(start, end) + ';this.sendChat=sendChat;', sandbox);
  await sandbox.sendChat('w1', 'Ship it', 'typing', null, { sid: '__new__', away: true, ...(space !== undefined ? { space } : {}), ...(route ? { route } : {}) }).catch(() => null);
  return { c, enqueued };
}

test('a typed channel post leaves the window\'s New chat pick alone (review)', async () => {
  const opus = { model: 'claude-opus', provider: 'anthropic' };
  const post = await send({ space: 'launch', route: opus });
  assert.equal(post.enqueued[0].model, 'claude-opus', 'the post goes on the box\'s pick');
  assert.equal(post.c.newModel?.model, 'claude-sonnet', 'the window\'s New chat pick is kept');
  const failed = await send({ space: 'launch', route: opus, fail: true });
  assert.equal(failed.c.newModel?.model, 'claude-sonnet', 'a failed post never puts the box pick on the window');
  // A plain New chat send uses the window's pick once (cleared), and gets it back if the save fails.
  const plain = await send({ route: opus });
  assert.equal(plain.c.newModel, null);
  const plainFail = await send({ route: opus, fail: true });
  assert.equal(plainFail.c.newModel?.model, 'claude-opus');
});

// The real channel block with channelSend (core/chats-chanbox.js) and the shell's modelRoute (the createChats export).
function sendRoutes() {
  const a = chats.indexOf('  function chanDraftKey(w) {'), b = chats.indexOf('  // The feed\'s newest post sits at the bottom');
  const sa = chats.indexOf('  async function channelSend(wid, form) {'), sb = chats.indexOf('  // A Not sent channel post taken back', sa);
  const ma = chats.indexOf('modelRoute: (wid, sid, box) =>'), mb = chats.indexOf('}, winAgent,', ma);
  assert.ok(a > 0 && b > a && sa > 0 && sb > sa && ma > 0 && mb > ma);
  const wins = { win: { id: 'win', thread: null }, plain: { id: 'plain', thread: null } }, open = { cur: { id: 'launch', name: 'Launch' } }, sent = [], c = { draft: '', files: [] };
  const ctx = { W: wins, CH: { win: c, plain: {} }, ch: id => (id === 'plain' ? { newModel: { model: 'claude-haiku' } } : c), chanOpen: w => (w.id === 'win' ? open.cur : null), chanArchived: () => false, winAgent: () => '',
    elOf: id => ({ id, querySelector: () => null }), renderChatList() {}, KIT: { drafts: { get: () => ({ text: '', files: [] }), set() {}, clear() {} } }, PREVIEW: {}, fileUrl: String, CLIP_SVG: '', esc: String,
    hasContent: () => false, attachTray: () => '', H: {}, pendRef: f => f, AGS: () => null, CHAN_SENDING: [], growTa() {}, syncSend() {}, chanToEnd() {}, chanRepaint() {}, FIRST: new Map(), CHAN_TEXT_MAX: 4000,
    viewContext: () => '', sendChat: async (wid, text, how, a, opts) => { sent.push(opts); return { sessionId: 's1' }; },
    PW: { ensureModels() {}, modelLabel: (w, s, pick) => `<b class="ch-mlabel">${pick ? pick.model : 'default'}</b>`, micBtn: () => '', newModel: x => x.newModel },
    window: { WosModels: { snapshot: (sid, nm, agent) => ({ sid, model: nm?.model || null, agent }) } }, Map };
  vm.createContext(ctx);
  vm.runInContext(chats.slice(a, b) + chats.slice(sa, sb) + `;const routes = { ${chats.slice(ma, mb + 1)} };this.api={chanDraftKey,boxModel,chanModel,setChanModel,chanComposer,channelSend,modelRoute:routes.modelRoute};`, ctx);
  return { ...ctx.api, wins, open, sent };
}

test('Send and the orb read the box\'s pick', async () => {
  const f = sendRoutes();
  f.setChanModel('win', { model: 'claude-opus', provider: 'anthropic' });
  // Send in the box: the post rides on the box's pick, filed into its channel.
  const form = { querySelector: () => ({ value: 'Ship it' }) };
  await f.channelSend('win', form);
  assert.equal(f.sent[0].route?.model, 'claude-opus', 'channelSend: the box pick'); assert.equal(f.sent[0].space, 'launch');
  // The orb / ⌥V route: a take for a box, the window's channel, or a plain New chat's own pick.
  assert.equal(f.modelRoute('win', '__new__', 'chan::launch').model, 'claude-opus');
  assert.equal(f.modelRoute('win', '__new__').model, 'claude-opus', 'the window shows the channel: its box pick');
  assert.equal(f.modelRoute('plain', '__new__').model, 'claude-haiku', 'a plain New chat: its own pick');
  assert.equal(f.modelRoute('win', 't1').model, null, 'a reply keeps its thread\'s model');
  // The label in the box.
  assert.match(f.chanComposer(f.wins.win, f.open.cur), />claude-opus</, 'the label');
  // The whole export is one line: a // comment inside it would silently drop every later entry.
  // The whole export is one line: a // comment inside it would silently drop every later entry. Run the real line.
  const exp = chats.slice(chats.indexOf('  return { beforeNavigate'), chats.indexOf('\n', chats.indexOf('  return { beforeNavigate')));
  assert.doesNotMatch(exp, /\/\/ /);
  const E = runRecording(`this.api = (() => {\n${between(chats, '  return { beforeNavigate', '\n};')}\n})();`, { W: { w1: { id: 'w1' } } });
  for (const k of ['renderChatList', 'chanModel', 'boxModel', 'setChanModel', 'sendChat', 'modelRoute']) assert.ok(k in E.api, k);
  E.api.chanModel('w1'); assert.deepEqual(E.calls.filter(c => c[0] === 'chanModel').map(c => c[1].id), ['w1'], 'chanModel: by window id');
});
