import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
// Extract complete, unchanged production declarations at named neighbouring declarations.
// These are the actual shell count producers/listeners, not replacement count callbacks.
function between(src, start, end) {
  const a = src.indexOf(start), b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `production boundaries: ${start}`);
  return src.slice(a, b);
}
const phone = read('web/app.js'), desktop = read('web/desktop/desktop.js');
async function load(shell, { mode = true, unread = 2, liveOK = true } = {}) {
  const listeners = new Map(), events = [], requests = [], nodes = new Map();
  const addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  };
  const dispatchEvent = event => {
    events.push(event.type);
    for (const fn of listeners.get(event.type) || []) fn(event);
    return true;
  };
  const $ = key => {
    if (!nodes.has(key)) nodes.set(key, { innerHTML: '', hidden: false, textContent: '',
      setAttribute() {}, classList: { contains: () => false } });
    return nodes.get(key);
  };
  const storage = new Map();
  const window = { addEventListener, dispatchEvent, WosSkinHost: { inboxList: mode, changed() {} },
    WizConfig: { dayStart: n => n - n % 864e5 },
    WizCore: { backendApps: () => [{ id: 'notifications' }] } };
  const context = vm.createContext({ window, addEventListener, dispatchEvent,
    document: { documentElement: { dataset: {} }, querySelectorAll: () => [], addEventListener() {} },
    navigator: {}, AbortSignal,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    location: { origin: 'https://wizard.example.test' },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    setTimeout() {}, setInterval() {}, queueMicrotask() {},
    fetch: async url => { requests.push(url); return { ok: true, json: async () => url.includes('/items')
      ? { items: [{ id: 'unread-a' }, { id: 'unread-b' }, { id: 'quiet', read: true }, { id: 'done', archived: true, read: true }] }
      : { unread, needs: 0 } }; },
    $, $$: () => [],
    CHATS_APP: { id: 'wizard' }, APP: { wizard: { id: 'wizard' } },
    // Layout/Home work is outside this count regression; no production count function is mocked.
    paintOrbBadge() {}, refreshHome() {}, paintFocus() {}, layout() {}, hudMount() {},
    stage: {}, ws: [], W: {}, appOf: w => w, MOD: 'Alt+', homeOpen: false, pal: { hidden: true }, afterRender: null,
  });
  vm.runInContext(read('web/live.js'), context);
  const LIVE = window.WizLive, at = new Date(Date.now() - 60000).toISOString();
  LIVE.ok = liveOK; LIVE.seen = { initializedAt: 1, threads: {} };
  LIVE.sessions = ['chat-a', 'chat-b'].map(id => ({ id, title: id, runtime: 'direct', status: 'completed',
    attention: { state: 'needs_you' }, updatedAt: at, previewAt: at, lastAssistantAt: at,
    previewRole: 'assistant', preview: 'Synthetic reply', messageCount: 2 }));
  LIVE.markSeen('chat-a'); // Both stay Ready; only chat-b contributes an unread badge.
  context.LIVE = LIVE; context.live = () => LIVE.groups();
  vm.runInContext(read('web/core/workspace-navigation.js'), context);
  context.C = window.WizCore;
  vm.runInContext(process.env.NOTIF_SOURCE ? readFileSync(process.env.NOTIF_SOURCE, 'utf8') : read('web/core/notif-bell.js'), context);
  if (shell === 'phone') {
    vm.runInContext(between(phone, '  function moonAngle(k, count) {', '  function paintOrbBadge() {'), context);
    vm.runInContext(phone.split('\n').find(line => line.includes("window.addEventListener('wizard:notifications'")), context);
  } else {
    vm.runInContext(between(desktop, '  function paintBar() {', '  function tickClock()'), context);
    vm.runInContext(between(desktop, '  function render() {', '  let afterRender ='), context);
    vm.runInContext(desktop.split('\n').filter(line => line.includes("addEventListener('wizard:notifications'") || line.includes("addEventListener('wizard:app-counts'")).join('\n'), context);
  }
  window.WosBell.watch(() => {});
  await window.WosBell.refresh(true);
  await new Promise(resolve => setImmediate(resolve));
  return { window, counts: window.WizCore.workspaceNav.counts, events, requests,
    prefs: () => dispatchEvent({ type: 'wos:prefs' }),
    setMode: value => { window.WosSkinHost.inboxList = value; dispatchEvent({ type: 'wos:prefs' }); } };
}

for (const shell of ['phone', 'desktop']) {
  for (const unread of [0, 2]) {
    test(`${shell}: both preference transitions refresh actual Chats badge immediately (unread=${unread})`, async () => {
      const h = await load(shell, { unread });
      assert.equal(h.window.WizLive.workGroups().ready.length, 2, 'reading does not remove Ready rows');
      assert.equal(h.window.WosBell.readyCount(), 3, 'Ready keeps read/snoozed notification rows');
      assert.equal(h.counts.wizard, 3, 'one unread chat + two unread notification rows');
      assert.equal(h.counts.notifications || 0, 0);
      const reads = h.requests.length;
      h.setMode(false);
      assert.equal(h.counts.wizard, 1, 'routed notification rows leave the stored Chats count synchronously');
      assert.equal(h.counts.notifications || 0, unread);
      h.setMode(true);
      assert.equal(h.counts.wizard, 3, 'only unread notification rows return synchronously');
      assert.equal(h.counts.notifications || 0, 0);
      assert.equal(h.requests.length, reads, 'preference refresh needs no fetch/poll/timer');
    });
  }
  test(`${shell}: initially off, enable, unrelated preferences, disable; unavailable live data`, async () => {
    const h = await load(shell, { mode: false, liveOK: false });
    assert.equal(h.counts.wizard || 0, 0);
    assert.equal(h.counts.notifications, 2);
    h.setMode(true);
    assert.equal(h.counts.wizard, 2, 'only unread notification rows count while live chats are unavailable');
    const before = h.events.filter(type => type === 'wizard:notifications').length;
    h.prefs(); h.prefs();
    assert.equal(h.events.filter(type => type === 'wizard:notifications').length, before,
      'unrelated preferences do not trigger full shell notification renders');
    h.setMode(false);
    assert.equal(h.counts.wizard, 0);
    assert.equal(h.counts.notifications, 2);
  });
}

test('missing skin host remains off and preference paint stays safe', async () => {
  const h = await load('phone', { mode: false });
  delete h.window.WosSkinHost;
  assert.doesNotThrow(h.prefs);
  assert.equal(h.window.WosBell.readyCount(), 0);
  assert.equal(h.counts.notifications, 2);
});
