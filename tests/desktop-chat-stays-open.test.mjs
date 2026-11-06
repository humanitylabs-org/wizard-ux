import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const desktop = read('web/desktop/desktop.js'), core = read('web/core/chats.js');
const cut = (source, from, to) => {
  const a = source.indexOf(from), b = source.indexOf(to, a);
  assert.ok(a >= 0 && b > a, from); return source.slice(a, b);
};
function fixture(desktopHost = true) {
  const w = { id: 'chat', app: 'chats', thread: 'same' }, state = { trail: [], readNav: 0 };
  const row = { id: 'same', status: 'ready', title: 'Synthetic conversation' }, listeners = {}, backs = [];
  const H = { keepThreadOpen: desktopHost, changed() {} };
  const context = { H, W: { chat: w }, CH: { chat: state }, CHATS: { isHosted: () => false, markVisibleThreadsSeen() {}, holdList: () => false, renderChatList() {}, loadThread() {} },
    window: { addEventListener: (name, fn) => { listeners[name] = fn; } },
    LIVE: { onChange: fn => { listeners.live = fn; }, markUnread: async () => true, archive: async () => true, restore: async () => true },
    PHONE: () => !desktopHost, hosted: new Map(), ch: () => state, owner: id => id, rowOf: () => row,
    ACT: { done: {}, file: {}, restore: {}, unread: {} }, vib() {}, closeRowSheet() {}, followUpActive: () => false,
    toast() {}, snoozeLast: () => false, renderChats() {}, save() {}, applyLayout() {}, deskOf: () => 0,
    threadBack: x => { backs.push(x.thread); x.thread = null; },
    paintBar() {}, syncChatsPane() {}, winEl: () => ({ querySelector: () => null }),
    ws: [{ wins: ['chat'] }], cur: 0, homeOpen: false, hudPaint() {}, document: { activeElement: null },
  };
  vm.createContext(context);
  vm.runInContext(cut(core, '  function leaveAfterSend(', '\n  function ',), context);
  vm.runInContext(cut(core, '  async function threadAct(', '\n  /* Threads and alerts'), context);
  vm.runInContext(cut(core, "  window.addEventListener('wos:boomerang-set'", '  // A scheduled Snooze'), context);
  vm.runInContext(cut(desktop, '  if (LIVE) LIVE.onChange(', '\n  OUTBOX?.onChange('), context);
  return { context, w, row, listeners, backs };
}
test('Classic desktop keeps the same open thread through Ready → Working → Ready, even after send', () => {
  const f = fixture();
  assert.match(desktop, /keepThreadOpen: true/);
  assert.doesNotMatch(desktop, /toNewChat|send:new-chat/);
  assert.equal(f.context.leaveAfterSend('chat', 'same', false), false);
  for (const status of ['running', 'ready', 'done', 'seen']) {
    f.row.status = status; f.listeners.live(); assert.equal(f.w.thread, 'same', status);
  }
});
for (const a of ['done', 'file', 'unread', 'restore']) test(`desktop ${a} changes state without leaving the thread; phone retains its behaviour`, async () => {
  for (const desktopHost of [true, false]) {
    const f = fixture(desktopHost); await f.context.threadAct('chat', 'same', a);
    assert.equal(f.w.thread, desktopHost || a === 'restore' ? 'same' : null);
  }
});
for (const name of ['wos:boomerang-set', 'wos:snooze-someday']) test(`${name} leaves desktop open but still closes phone`, () => {
  for (const desktopHost of [true, false]) {
    const f = fixture(desktopHost); f.listeners[name]({ detail: { session: 'same', label: 'Later' } });
    assert.equal(f.w.thread, desktopHost ? 'same' : null);
  }
});
test('phone reply still returns to the list and desktop hosted reply stays in place', () => {
  const phone = fixture(false); phone.context.leaveAfterSend('chat', 'same', false);
  assert.equal(phone.w.thread, null);
  const desktop = fixture(); desktop.context.hosted.set('chat', {});
  assert.equal(desktop.context.leaveAfterSend('chat', 'same', false), false);
  assert.equal(desktop.w.thread, 'same'); assert.equal(desktop.context.hosted.has('chat'), true);
});

for (const agent of ['', 'philosopher']) test(`desktop explicit unread survives real synchronous live emits (${agent || 'main'}) until navigation`, async () => {
  const f = fixture(), c = f.context, storage = new Map(), puts = [];
  Object.assign(c, { AbortSignal, navigator: {}, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) },
    setInterval() {}, setTimeout() {}, addEventListener() {}, dispatchEvent() {}, CustomEvent: class {},
    fetch: async (_url, init = {}) => { const state = init.body ? JSON.parse(init.body) : {}; puts.push(state); return {ok:true,json:async()=>({state})}; },
    WizConfig: { dayStart:n=>n-n%864e5 }, WosAgents: { isOther:id=>id!=='hermes',get:id=>({id,privacy:'standard'}) } });
  c.window = c; c.document = { readyState:'loading',hidden:false,documentElement:{dataset:{}}, addEventListener(){} };
  vm.runInContext(read('web/core/chats-list-model.js'), c);
  vm.runInContext(read('web/live.js'), c);
  const L = c.LIVE = c.WizLive; L.ok = true; L.seen = {initializedAt:1,threads:{}};
  const row = {id:'same',runtime:'direct',title:'Synthetic',status:'completed',updatedAt:'2026-11-06T00:00:00Z',lastAssistantAt:'2026-11-06T00:00:00Z',messageCount:2};
  if (agent) { L.agentSessions[agent] = [row]; L.pinAgent('same',agent); } else L.sessions = [row];
  c.rowOf = () => row; c.desks = [{wins:['chat']}]; c.idx = 0; c.isHosted = () => false; c.attended = () => true;
  vm.runInContext(cut(core, '  function markVisibleThreadsSeen(', '\n  const elOf'), c);
  c.CHATS.markVisibleThreadsSeen = () => c.markVisibleThreadsSeen();
  L.markSeen('same'); await Promise.resolve();
  L.onChange(() => { c.markVisibleThreadsSeen(); });
  await c.threadAct('chat','same','unread');
  assert.equal(f.w.thread,'same'); assert.equal(L.isNew(row),true,'explicit unread was not consumed by its own emit');
  c.markVisibleThreadsSeen(); assert.equal(L.isNew(row),true,'poll/repaint preserves marker');
  c.ch('chat').readNav++; c.markVisibleThreadsSeen();
  assert.equal(L.isNew(row),false,'navigating/reopening permits normal automatic read again');
});
