import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../web/core/chat-models.js', import.meta.url), 'utf8');
const payload = (registered = true) => ({ provider: 'anthropic', model: 'claude-opus-5-5', providers: [
  { slug: 'anthropic', is_current: true, authenticated: true, models: ['claude-opus-5-5'] },
  { slug: 'openai-codex', authenticated: true, models: ['gpt-6-astra', 'gpt-6.1-sol'] },
  ...(registered ? [{ slug: 'wizard-tinfoil', name: 'Tinfoil', is_user_defined: true, authenticated: true, models: ['exact/catalog-model'] }] : []),
  { slug: 'unconfigured', is_user_defined: true, authenticated: false, models: ['not-available'] },
] });
function harness({ registered = true, stored = true, ackProvider = 'custom', requested = 'custom:wizard-tinfoil', unavailable = false } = {}) {
  const calls = [];
  const window = {};
  const ctx = vm.createContext({ window, AbortSignal, localStorage: { getItem: () => null }, fetch: async (url, init) => {
    calls.push({ url, init });
    if (url === '/wizard-tinfoil/api/connection') {
      if (unavailable) throw new Error('unavailable');
      return { ok: true, json: async () => ({ provider: 'tinfoil', credentialStored: stored, credentialVerified: false, status: stored ? 'pending' : 'not_connected' }) };
    }
    if (url === '/wizard/hermes/api/model/options') return { ok: true, json: async () => payload(registered) };
    if (url.endsWith('/model')) return { ok: true, json: async () => ({ runtime: { model_lock: 'accepted', model: 'exact/catalog-model', provider: ackProvider, requested: { provider: requested }, selection_version: 7 } }) };
    throw new Error(`Unexpected call: ${url}`);
  } });
  vm.runInContext(code, ctx);
  return { M: window.WosModels, calls };
}
const menu = M => M.popHtml({ mode: 'new', cur: { model: 'claude-opus-5-5', provider: 'anthropic' }, all: false });

test('non-current custom endpoint remains available without changing the global default', async () => {
  const { M } = harness(); await M.load();
  assert.equal(M.find('exact/catalog-model', 'wizard-tinfoil').value, 'exact/catalog-model');
  assert.equal(M.find('not-available'), null);
  assert.equal(M.defaultOption().value, 'claude-opus-5-5');
  assert.equal(M.defaultOption().provider, 'anthropic');
  const { html, list } = menu(M);
  assert.deepEqual(Array.from(list, o => M.short(o.value, o.provider)), ['Opus', 'Astra', 'GPT 6.1 Sol', 'Tinfoil']);
  assert.deepEqual([...html.matchAll(/<b>([^<]+)<\/b>/g)].map(m => m[1]), ['Opus', 'Astra', 'Sol', 'Tinfoil']);
  assert.equal(list[3].agent, undefined);
  assert.doesNotMatch(html, /Private agent|Set up Tinfoil/);
  assert.equal(M.tinfoil.credentialVerified, false); // saved is not claimed authenticated
});

for (const scenario of [{ registered: false }, { stored: false }, { unavailable: true }]) {
  test(`missing route/key/status is disabled and links to the connection app: ${JSON.stringify(scenario)}`, async () => {
    const { M, calls } = harness(scenario); await M.load();
    const { html, list } = menu(M);
    assert.match(html, /disabled aria-disabled="true"/);
    assert.match(html, /href="\/wizard-tinfoil\/"/);
    assert.equal(list.length, 3);
    assert.equal(M.defaultOption().value, 'claude-opus-5-5');
    assert.ok(calls.every(c => !c.init?.method));
  });
}

test('same session switches to the exact custom route, accepts canonical custom acknowledgement, never generates', async () => {
  const { M, calls } = harness(); await M.load();
  const option = menu(M).list[3];
  const route = await M.setThreadModel('existing/session', option);
  assert.equal(route.model, 'exact/catalog-model');
  assert.equal(route.provider, 'custom:wizard-tinfoil');
  const writes = calls.filter(c => c.init?.method);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url, '/wizard/hermes/api/sessions/existing%2Fsession/model');
  assert.deepEqual(JSON.parse(writes[0].init.body), { model: 'exact/catalog-model', provider: 'custom:wizard-tinfoil', require_model_lock: true });
  assert.equal(M.snapshot('existing/session').provider, 'custom:wizard-tinfoil');
  assert.equal(M.defaultOption().value, 'claude-opus-5-5');
  assert.ok(!calls.some(c => /runs|completions|\/agents/.test(c.url)));
});

test('rejects a custom acknowledgement for another endpoint', async () => {
  const { M } = harness({ requested: 'custom:wrong' }); await M.load();
  await assert.rejects(M.setThreadModel('existing', menu(M).list[3]), /did not confirm/);
  assert.equal(M.selections.size, 0);
});

test('missing key also blocks direct route resolution and retry catalogues', async () => {
  const { M } = harness({ stored: false }); await M.load();
  assert.equal(M.options.some(o => o.provider === 'wizard-tinfoil'), false);
  await assert.rejects(M.resolveRoute({ model: 'exact/catalog-model', provider: 'custom:wizard-tinfoil' }), /Set up Tinfoil/);
});
