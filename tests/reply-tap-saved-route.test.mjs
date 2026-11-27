import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { helperWorkingHarness, liveSource } from './helpers/helper-working-harness.mjs';

// wizard-ux issue 1973, part 1 (on for everyone): a reply-button tap (or a typed reply) in a thread a scheduled run
// posted failed with "Not sent · Model provider unavailable · choose the model again". The single-thread read named the
// thread's model but no provider, the shell copied that empty provider over the row, and resolveRoute then had to guess
// the provider from the phone's model list, which had failed to load. The real chat-models.js and live.js run here.
const MODEL = 'claude-sonnet-5-5', PROVIDER = 'anthropic', SID = 'wizard_morning_1973';
const source = readFileSync(new URL('../web/core/chat-models.js', import.meta.url), 'utf8');

// The model list read fails (503) or is empty; the thread's row and its single-thread read are faked by WizLive.
function models({ list = 'fail', row = { model: MODEL, provider: '' }, detail = { model: MODEL, provider: '' } } = {}) {
  const reads = [];
  const ctx = { console, AbortSignal, Event: class {}, localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, dispatchEvent() {}, document: { addEventListener() {} }, setTimeout, clearTimeout,
    fetch: async url => {
      if (String(url).includes('/api/model/options')) return list === 'fail' ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ model: '', provider: '', providers: [] }) };
      return { ok: false, status: 404, json: async () => ({}) };
    },
    WosAgents: { isOther: () => false, get: () => null, mainRoute: () => null },
    WizLive: { session: id => (id === SID && row ? { id, ...row } : null), agentOf: () => '', sessionInfo: async id => { reads.push(id); if (detail instanceof Error) throw detail; return detail ? { id, ...detail } : null; } } };
  ctx.window = ctx; vm.runInNewContext(source, ctx);
  return { M: ctx.WosModels, reads };
}

for (const list of ['fail', 'empty']) {
  test(`model list ${list}: a send in the thread uses the provider the thread's row already has`, async () => {
    const { M, reads } = models({ list, row: { model: MODEL, provider: PROVIDER } });
    const route = await M.resolveRoute(M.snapshot(SID), { thread: SID });
    assert.deepEqual({ ...route }, { model: MODEL, provider: PROVIDER });
    assert.deepEqual(reads, [], 'no extra read when the row knows it');
  });
  test(`model list ${list}: a row with no provider asks the box for the thread's saved route and sends on it`, async () => {
    const { M, reads } = models({ list, detail: { model: MODEL, provider: PROVIDER } });
    const route = await M.resolveRoute(M.snapshot(SID), { thread: SID });
    assert.deepEqual({ ...route }, { model: MODEL, provider: PROVIDER });
    assert.deepEqual(reads, [SID]);
  });
  test(`model list ${list}: no saved route anywhere is the only error, in plain words`, async () => {
    for (const detail of [{ model: MODEL, provider: '' }, null, new Error('offline'), { model: 'claude-opus-5-5', provider: PROVIDER }]) {
      const { M } = models({ list, detail });
      await assert.rejects(M.resolveRoute(M.snapshot(SID), { thread: SID }), e => {
        assert.doesNotMatch(e.message, /Model provider unavailable/);
        assert.match(e.message, /tap the model name, pick one, then Retry/);
        return true;
      });
    }
  });
}

test('a new chat (no thread) never borrows a thread\'s route', async () => {
  const { M, reads } = models({ detail: { model: MODEL, provider: PROVIDER } });
  await assert.rejects(M.resolveRoute({ model: MODEL, provider: '' }), /pick one/);
  assert.deepEqual(reads, []);
});

// The single-thread read that names no provider never wipes the one the list row has (main and routed threads alike).
const iso = new Date().toISOString();
for (const agent of ['', 'host-profile', 'container', 'restricted']) {
  test(`a detail read without a provider keeps the row's saved provider: ${agent || 'main'}`, async () => {
    const row = { id: SID, title: 'Morning', listVersion: 1, status: 'completed', model: MODEL, provider: PROVIDER, wizard_model_lock_updated_at: 1794031394, updatedAt: iso, agent: agent || 'hermes' };
    const h = helperWorkingHarness({ source: liveSource(), row, detail: { id: SID, title: 'Morning', model: MODEL, wizard_retry_input: '', agent: { id: agent || 'hermes' } }, agent });
    h.put(h.api.normalize(structuredClone(row)));
    assert.equal(h.L.session(SID).provider, PROVIDER);
    await h.L.sessionInfo(SID);
    assert.equal(h.L.session(SID).model, MODEL);
    assert.equal(h.L.session(SID).provider, PROVIDER, 'the saved provider survives the single-thread read');
    // A read that does name a provider (the model was changed elsewhere) still wins.
    h.setDetail({ id: SID, title: 'Morning', model: 'claude-opus-5-5', provider: 'anthropic-2', wizard_retry_input: '', agent: { id: agent || 'hermes' } });
    await h.L.sessionInfo(SID);
    assert.equal(h.L.session(SID).model, 'claude-opus-5-5');
    assert.equal(h.L.session(SID).provider, 'anthropic-2');
    // A different model with no provider never keeps the old model's provider.
    h.setDetail({ id: SID, title: 'Morning', model: 'claude-fable-5-1', wizard_retry_input: '', agent: { id: agent || 'hermes' } });
    await h.L.sessionInfo(SID);
    assert.equal(h.L.session(SID).provider, '');
  });
}
