import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
// A box whose Hermes default is the legacy Claude Code route (one login, no rotation) must start new
// chats on the ready Hermes Claude pool's same model; explicit thread picks and pool-less boxes stay.
const source = readFileSync(new URL('../web/core/chat-models.js', import.meta.url), 'utf8');
const SUB = 'claude-subscription-directsdk-experimental';
const options = ({ nativeAuth = true, nativeModels = ['claude-opus-5-5', 'claude-sonnet-5-5'] } = {}) => ({
  provider: SUB, model: 'claude-opus-5-5[1m]', providers: [
    { slug: SUB, authenticated: true, models: ['claude-opus-5-5[1m]', 'claude-sonnet-5-5'] },
    { slug: 'openai-codex', authenticated: true, models: ['gpt-6.1-sol'] },
    { slug: 'anthropic', authenticated: nativeAuth, models: nativeModels },
  ] });
async function load(connection, opts = {}, fail = false) {
  const window = {};
  const fetch = async url => {
    if (url.includes('wizard-claude')) { if (fail) throw Error('offline'); return { ok: true, json: async () => connection }; }
    return { ok: true, json: async () => (url.includes('model/options') ? options(opts) : null) };
  };
  vm.runInNewContext(source, { window, fetch, AbortSignal, console });
  await window.WosModels.load();
  return window.WosModels;
}
const native = { accounts: [{ id: 'legacy-claude-code', status: 'ready' }, { id: 'acct-2', status: 'ready' }] };
const opus = M => M.visible().find(o => M.family(o.value, o.provider) === 'claude:opus');

test('legacy default + ready pool: new chats, the Opus slot and send all use the pool', async () => {
  const M = await load(native);
  assert.equal(M.defaultOption().provider, 'anthropic');
  assert.equal(M.defaultOption().value, 'claude-opus-5-5');
  assert.deepEqual({ ...M.snapshot('') }, { model: 'claude-opus-5-5', provider: 'anthropic' });
  assert.equal((await M.resolveRoute(M.snapshot(''))).provider, 'anthropic');
  assert.equal(opus(M).provider, 'anthropic');
  assert.equal(M.options.filter(o => o.isGlobalDefault).length, 1);
  // The legacy route stays available under More models.
  assert(M.options.some(o => o.provider === SUB && o.value === 'claude-opus-5-5[1m]'));
});

test('an explicit legacy pick is never rewritten', async () => {
  const M = await load(native);
  const pick = { model: 'claude-opus-5-5[1m]', provider: SUB };
  assert.deepEqual({ ...M.snapshot('', pick) }, pick);
  assert.equal((await M.resolveRoute(pick)).provider, SUB);
  assert.equal(M.visible(pick.model, pick.provider).find(o => M.family(o.value, o.provider) === 'claude:opus').provider, SUB);
});

test('no ready pool keeps the legacy default', async () => {
  for (const c of [null, { accounts: [] }, { accounts: [{ id: 'legacy-claude-code', status: 'ready' }] }, { accounts: [{ id: 'acct-2', status: 'expired' }] }]) {
    const M = await load(c);
    assert.equal(M.defaultOption().provider, SUB, JSON.stringify(c));
    assert.equal(M.snapshot('').provider, SUB);
  }
  assert.equal((await load(native, {}, true)).defaultOption().provider, SUB);
});

test('pool without the same model, or not signed in to Hermes, keeps the legacy default', async () => {
  assert.equal((await load(native, { nativeModels: ['claude-sonnet-5-5'] })).defaultOption().provider, SUB);
  assert.equal((await load(native, { nativeModels: ['claude-opus-5-6'] })).defaultOption().provider, SUB);
  assert.equal((await load(native, { nativeAuth: false })).defaultOption().provider, SUB);
});
