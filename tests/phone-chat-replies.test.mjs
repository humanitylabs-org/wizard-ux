// Chat replies as Chats notifications (wizard-ux issue 1619, switch wizard/phone-chat-replies, off by default).
// The real device.js hand-over runs in a vm with a stand-in Android bridge and box: with the switch on and the phone's
// per-app reader on, an accepted send goes to the box (POST /wizard/v1/phone/reply-notes) and the native reply watcher
// is not asked to poll it; anything else keeps today's watcher. The native rules are JVM tests (AppNotifyPolicyTest),
// the box half is wizard-agent-service tests/phone-reply-notes.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { experienceRuntime } from './fixtures/skin-palettes-harness.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SWITCH = 'wizard/phone-chat-replies';
const device = read('web/device.js');
const handover = device.slice(device.indexOf('  /* Chat replies as Chats notifications'), device.indexOf('  /* Reading a thread anywhere'));

function phone({ on = false, reader = true, oldApp = false, box = 202, agent = '', title = 'Trip plan' } = {}) {
  const watched = [], posted = [], logs = [];
  let sent = null;
  const dev = { version: () => '0.10.68', watchRun: (...a) => watched.push(a) };
  if (!oldApp) dev.appNotifyOn = () => reader;
  const c = {
    JSON, console, Promise,
    document: { documentElement: { dataset: { tweaks: on ? 'wizard/desktop-chats ' + SWITCH : 'wizard/desktop-chats' } } },
    DEV: () => dev, W$: () => ({ live: { session: id => ({ id, title }) } }), log: (...a) => logs.push(a.join(' ')),
    OUTBOX: { onSent: fn => { sent = fn; } },
    fetch: async (url, init) => { posted.push([url, init.method, JSON.parse(init.body)]); if (box === 'down') throw new Error('offline'); return { status: box }; },
  };
  vm.createContext(c);
  vm.runInContext(handover, c);
  return {
    watched, posted, logs,
    send: (item = {}) => sent({ sessionId: 'thread-1619', text: 'plan my trip', ...(agent ? { agent } : {}), ...item }, { runId: 'wizardq_1619' }),
  };
}

test('switch off: today\'s reply watcher, nothing goes to the box', async () => {
  const p = phone();
  await p.send();
  assert.deepEqual(p.posted, []);
  assert.deepEqual(p.watched, [['thread-1619', 'wizardq_1619', 'Trip plan']]);
});

test('switch on with the per-app reader on: the box follows the run and the phone does not poll it', async () => {
  const p = phone({ on: true });
  await p.send();
  assert.deepEqual(p.posted, [['/wizard/v1/phone/reply-notes', 'POST', { session: 'thread-1619', run: 'wizardq_1619', title: 'Trip plan' }]]);
  assert.deepEqual(p.watched, [], 'ReplyWatcher is not asked to poll this run');
});

test('a routed agent\'s thread names its agent', async () => {
  const p = phone({ on: true, agent: 'helper' });
  await p.send();
  assert.equal(p.posted[0][2].agent, 'helper');
  assert.deepEqual(p.watched, []);
});

test('anything the box refuses, or a phone that cannot read Notifications, keeps the watcher', async () => {
  for (const box of [404, 409, 403, 500, 'down']) {
    const p = phone({ on: true, box });
    await p.send();
    assert.equal(p.posted.length, 1);
    assert.deepEqual(p.watched, [['thread-1619', 'wizardq_1619', 'Trip plan']], `box answered ${box}`);
  }
  for (const opts of [{ reader: false }, { oldApp: true }]) {
    const p = phone({ on: true, ...opts });
    await p.send();
    assert.deepEqual(p.posted, [], JSON.stringify(opts));
    assert.equal(p.watched.length, 1);
  }
});

test('the bell never lists a chat reply the box posted for the phone; every other item stays', async () => {
  const bell = read('web/core/notif-bell.js');
  const lines = bell.slice(bell.indexOf('  const chatReply = '), bell.indexOf('  async function loadItems()'));
  const items = [
    { id: 'r1', from: 'chats', tags: ['app:chats', 'chat-reply'], title: 'Trip plan' },
    { id: 'n1', tags: [], title: 'Backup failed' },
    { id: 'm1', from: 'messenger', tags: ['app:messenger', 'chat-reply'], title: 'Not ours' },
  ];
  const c = { fetch: async () => ({ ok: true, json: async () => ({ items, counts: {} }) }) };
  vm.createContext(c);
  vm.runInContext(lines + '\nglobalThis.readNotes = readNotes;', c);
  const got = await c.readNotes();
  assert.deepEqual(got.items.map(i => i.id), ['n1', 'm1']);
});

test('the switch is in the catalog, off by default, and names its issue', async () => {
  const { E, active } = experienceRuntime(); await E.refresh();
  const row = E.state.tweaks.find(t => t.id === SWITCH);
  assert.ok(row, 'listed'); assert.equal(row.on, false, 'off by default');
  assert.equal((await E.defaults())[SWITCH], false); assert.ok(!active().includes(SWITCH), 'not loaded');
  const m = JSON.parse(read('web/tweaks/wizard/phone-chat-replies/manifest.json'));
  assert.equal(row.name, m.name); assert.equal(m.id, SWITCH);
  assert.deepEqual(m.issues, ['humanitylabs-org/wizard-ux#1619']);
});
