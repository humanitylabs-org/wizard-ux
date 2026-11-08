import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { openChats, freshRead } = require('../tools/qa-troubleshooter-entry.cjs');
const evaluate = (fn, window) => vm.runInNewContext('(' + fn.toString() + ')()', { window });

test('Troubleshooter QA uses the actual desktop Chats opener, not optional phone openWin', () => {
  let calls = 0;
  const desktop = { wins: {}, openChatsList() { calls++; this.wins.chat = { id: 'chat', app: 'chats' }; } };
  assert.equal(desktop.openWin, undefined, 'match the real __wux export');
  assert.deepEqual(Array.from(evaluate(openChats, { __wux: desktop })), ['chat']);
  assert.equal(calls, 1);
});
test('Troubleshooter QA keeps the phone opener and fails closed on missing shell APIs', () => {
  let calls = 0;
  const phone = { wins: {}, openWin(obj) { calls++; assert.equal(obj.app, 'chats'); this.wins.chat = { id: 'chat', app: obj.app }; } };
  assert.deepEqual(Array.from(evaluate(openChats, { __wos: phone })), ['chat']);
  assert.equal(calls, 1);
  assert.throws(() => evaluate(openChats, { __wux: { wins: {} } }), /openChatsList/);
  assert.throws(() => evaluate(openChats, {}), /not ready/);
});
test('Troubleshooter QA waits out an old successful refresh, then requires a fresh failed read', async () => {
  let settle, calls = 0;
  const live = { ok: true, at: 10, error: '', errorAt: 0 };
  live.loading = new Promise(resolve => { settle = () => { live.loading = null; resolve(); }; });
  live.refresh = async () => { calls++; if (live.loading) return live.loading; live.error = 'offline'; live.errorAt = 20; };
  // Reproduce the old harness: refresh() silently reuses the healthy old read.
  const old = live.refresh(); settle(); await old;
  assert.equal(live.error, '');
  live.loading = new Promise(resolve => { settle = () => { live.loading = null; resolve(); }; });
  const pending = evaluate(freshRead, { WizLive: live });
  await Promise.resolve(); assert.equal(calls, 1, 'no new request until the old refresh settles');
  settle(); const result = await pending;
  assert.equal(calls, 2); assert.equal(result.error, 'offline'); assert.equal(result.errorAt, 20); assert.equal(result.loading, false);
});
