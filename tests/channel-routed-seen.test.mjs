// Channels unread (wizard-ux issue 1259): the real live.js markSeen given a row object marks that row's own receipt,
// so a routed post sharing its id with a main thread clears only itself. The id form keeps today's behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';
const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
function harness() {
  const storage = new Map();
  const c = { console, AbortSignal, document: { documentElement: { dataset: {} }, readyState: 'loading', hidden: false, addEventListener() {} }, navigator: {},
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    setInterval() {}, setTimeout() {}, addEventListener() {}, dispatchEvent() {}, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    WizConfig: { dayStart: n => n - n % 864e5 }, WosAgents: { isOther: id => !!id && id !== 'hermes', get: id => ({ id, privacy: 'standard' }) },
    fetch: async () => ({ ok: true, json: async () => ({}) }) };
  c.window = c; modelContext(c); vm.runInContext(live, c);
  const L = c.WizLive; L.ok = true; L.seen = { initializedAt: 1, threads: {} };
  return L;
}
const at = new Date(Date.now() - 60000).toISOString();
const row = (id, extra = {}) => ({ id, title: id, updatedAt: at, runtime: 'direct', status: 'completed', previewRole: 'assistant', preview: 'Synthetic reply', previewAt: at, lastAssistantAt: at, messageCount: 2, ...extra });

for (const agent of ['qa-host', 'qa-container', 'qa-restricted']) {
  test(agent + ': markSeen(row) clears the routed post only; the main thread with the same id stays unread', () => {
    const L = harness(), main = row('same'), routed = row('same', { agent });
    L.sessions = [main]; L.agentSessions[agent] = [routed];
    assert.equal(L.isNew(main), true); assert.equal(L.isNew(routed), true);
    assert.equal(L.session('same'), main, 'the id-only lookup finds the main row first');
    L.markSeen(routed);
    assert.equal(L.isNew(routed), false, 'routed post read');
    assert.equal(L.isNew(main), true, 'main thread still unread');
    assert.ok(L.seen.threads[`agent/${agent}/direct:same`]);
  });
}
test('main: markSeen(id) keeps today\'s behaviour', () => {
  const L = harness(), main = row('m1');
  L.sessions = [main];
  L.markSeen('m1'); assert.equal(L.isNew(main), false);
  L.markSeen(['missing']); L.markSeen(null);
});
