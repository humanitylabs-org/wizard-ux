import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

// WizardOS updating on a Mac (core/os-update-flow.js, WosUpdateFlow.paused): every send waits, including app voice
// input, which the outbox delivers directly (retryConversation → WizAppServices.conversation.deliver) instead of
// through pump(). Codex P1 on wizard-ux#1498: that direct path went out during the update.
const source = readFileSync(process.env.OUTBOX_TEST_SOURCE || new URL('../web/outbox.js', import.meta.url), 'utf8');

function client() {
  const rows = new Map(), listeners = new Map(), delivered = [];
  const indexedDB = { open() {
    const r = {};
    queueMicrotask(() => {
      r.result = { close() {}, objectStoreNames: { contains: () => true }, transaction() {
        const tx = { objectStore() { return {
          getAll() { return { result: [...rows.values()].map(x => structuredClone(x)) }; },
          put(value) { rows.set(value.id, structuredClone(value)); return {}; },
        }; } };
        setImmediate(() => tx.oncomplete?.()); return tx;
      } }; r.onsuccess();
    }); return r;
  } };
  const flow = { paused: true };
  const ctx = { console, Blob, AbortController, AbortSignal, indexedDB, crypto: { randomUUID },
    document: { documentElement: { dataset: {} }, body: null, addEventListener() {}, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, removeItem() {}, setItem() {} },
    addEventListener(type, fn) { (listeners.get(type) || listeners.set(type, []).get(type)).push(fn); },
    clearTimeout, setTimeout(fn, ms) { const t = setTimeout(fn, ms); t.unref(); return t; },
    fetch: async () => { throw new Error('no network in this test'); },
    WosModels: { snapshot: (_, route) => route, resolveRoute: async route => route },
    WosAgents: { isOther: a => !!a, get: () => ({ permissions: {} }) },
    WosUpdateFlow: flow,
    WizAppServices: { conversation: { deliver: async (conv, body) => { delivered.push(body); return { accepted: true, request_id: body.request_id }; } } },
  };
  ctx.window = ctx; vm.runInNewContext(source, ctx);
  const fire = (type, detail) => { for (const fn of listeners.get(type) || []) fn({ detail }); };
  return { api: ctx.WosOutbox, flow, delivered, fire };
}

async function until(fn) {
  for (let i = 0; i < 400; i++) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('timed out');
}

test('app voice input waits while WizardOS updates and goes once the update is over', async () => {
  const c = client();
  const it = await c.api.sendConversation({ conversation: { app: 'wizard-manager', label: 'Manager' }, text: 'turn the lights off' });
  assert.equal(c.delivered.length, 0, 'nothing reaches the app while WizardOS updates');
  assert.equal(it.state, 'held');
  assert.match(it.error, /WizardOS updates/);
  c.flow.paused = false;
  c.fire('wos:sending-paused', { paused: false });
  await until(() => c.delivered.length === 1 && c.api.get(it.id)?.state === 'sent');
  assert.equal(c.delivered[0].text, 'turn the lights off');
  assert.equal(c.delivered[0].request_id, it.id);
  c.fire('wos:sending-paused', { paused: false });          // a second "over" never sends it twice
  await new Promise(r => setTimeout(r, 30));
  assert.equal(c.delivered.length, 1);
});

test('without an update, app voice input is delivered at once (unchanged)', async () => {
  const c = client(); c.flow.paused = false;
  const it = await c.api.sendConversation({ conversation: { app: 'wizard-manager', label: 'Manager' }, text: 'hello' });
  assert.equal(it.state, 'sent');
  assert.equal(c.delivered.length, 1);
});
