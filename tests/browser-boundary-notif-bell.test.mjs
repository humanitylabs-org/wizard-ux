import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
// Rehearsal finding (wizard-os 389, KVM alongside box): under the browser boundary the Chats bell still fetched
// /notifications/api/count, /api/items and /api/mark from the shell document. The Notifications listener gate answers
// only the Agent Service adapter (401/403), so the bell lost its count and the skin-host inbox its items. Boundary on:
// the bell uses the Service's shell-owned typed operations (notifications.count / .items / .mark), like the model
// picker's models.claude_accounts. Boundary off: the direct reads, unchanged.
const source = readFileSync(new URL('../web/core/notif-bell.js', import.meta.url), 'utf8');
const items = [{ id: 'n1', title: 'A', message: 'a', time: 2, priority: 3, link: '', source: 'agent', read: false, flag: false, archived: false, revision: 'r-aaaaaaaaaaaaaaaa' },
  { id: 'n2', title: 'B', message: 'b', time: 1, priority: 3, link: '', source: 'agent', read: false, flag: false, archived: false, revision: 'r-bbbbbbbbbbbbbbbb' }];

function bell({ boundary, src = source }) {
  const calls = [];
  const listeners = {};
  const ctx = {
    console, AbortSignal, JSON, Map, Set, Object, Date, Promise, Number, String, Array, CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i?.detail } },
    crypto: { randomUUID: () => '12345678-1234-4123-8123-123456789abc' },
    WizBrowserBoundary: boundary ? { enabled: true } : undefined,
    WizCanOpen: () => true,
    addEventListener: (t, f) => { listeners[t] = f }, dispatchEvent: () => true,
    document: { hidden: false, addEventListener() {}, querySelectorAll: () => [] },
    setInterval: () => 0, setTimeout: () => 0,
    fetch: async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      if (url.startsWith('/notifications/')) return boundary ? { ok: false, status: 401, json: async () => ({ error: 'adapter_credential_required' }) }
        : { ok: true, status: 200, json: async () => url.includes('count') ? { unread: 2, needs: 0 } : url.includes('items') ? { items } : { ok: true } };
      const op = JSON.parse(init.body).operation;
      const v = op === 'notifications.count' ? { state: 'ok', counts: { unread: 2, needs: 1, flagged: 0 } }
        : op === 'notifications.items' ? { state: 'ok', counts: {}, items } : { state: 'ok', items: [], marks: {}, operationKey: 'k' };
      return { ok: true, status: 200, json: async () => v };
    },
  };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
  return { B: ctx.WosBell, calls };
}
const tick = () => new Promise(r => setTimeout(r, 5));

test('boundary on: count, items and marks go through the shell-owned typed operations, never the app listener', async () => {
  const { B, calls } = bell({ boundary: true });
  B.watch(() => {});
  await B.refresh(true); await tick();
  assert.equal(B.state.unread, 2);
  assert.equal(B.state.needs, 1);
  assert.deepEqual(B.items().map(i => i.id), ['n1', 'n2']);
  assert.equal(await B.mark(['n2'], { read: true }), true);
  assert.ok(!calls.some(c => c.url.startsWith('/notifications/')), 'the shell never asks the Notifications listener');
  const ops = calls.map(c => c.body?.operation);
  assert.ok(ops.includes('notifications.count') && ops.includes('notifications.items'));
  const write = calls.find(c => c.body?.operation === 'notifications.mark');
  assert.deepEqual(write.body.args, { items: [{ id: 'n2', expectedRevision: 'r-bbbbbbbbbbbbbbbb' }], marks: { read: true }, operationKey: '12345678-1234-4123-8123-123456789abc' });
});

test('boundary off: the direct same-origin reads and the plain mark write, unchanged', async () => {
  const { B, calls } = bell({ boundary: false });
  B.watch(() => {});
  await B.refresh(true); await tick();
  assert.equal(B.state.unread, 2);
  await B.mark(['n1'], { read: true });
  assert.ok(!calls.some(c => c.url === '/wizard/v1/browser-shell/call'));
  assert.deepEqual(calls.find(c => c.url === '/notifications/api/mark').body, { ids: ['n1'], read: true });
});

test('boundary on, before this change (negative control): the direct reads are refused and the bell stays empty', async () => {
  const legacy = source.replace("const boundary = () => !!window.WizBrowserBoundary?.enabled;", 'const boundary = () => false;');
  assert.notEqual(legacy, source);
  const { B, calls } = bell({ boundary: true, src: legacy });
  B.watch(() => {});
  await B.refresh(true); await tick();
  assert.equal(B.state.unread, 0);
  assert.equal(B.items().length, 0);
  assert.ok(calls.some(c => c.url.startsWith('/notifications/api/')));
});
