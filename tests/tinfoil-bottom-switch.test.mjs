import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
function switchHarness(stored) {
  const window = {};
  const ctx = vm.createContext({ window, fetch() {}, localStorage: { getItem: () => null } });
  vm.runInContext(read('web/core/chat-models.js'), ctx);
  const M = window.WosModels;
  M.options = M.normalize({ provider: 'anthropic', model: 'claude-opus-5-5', providers: [
    { slug: 'anthropic', authenticated: true, models: ['claude-opus-5-5'] },
    { slug: 'openai-codex', authenticated: true, models: ['gpt-6-astra', 'gpt-6.1-sol'] },
    { slug: 'wizard-tinfoil', is_user_defined: true, authenticated: true, models: ['exact/catalog-model'] },
  ] });
  M.ready = true; M.tinfoil = { provider: 'tinfoil', credentialStored: stored };
  Object.assign(ctx, { M, esc: String, ch: () => ({}), newModel: () => ({ model: 'claude-opus-5-5', provider: 'anthropic' }), threadModel: s => s, agentOfWin: () => null });
  const code = read('web/core/chat-power.js');
  vm.runInContext(code.slice(code.indexOf('  const SW_NAMES ='), code.indexOf('  async function switchTo')) + '\nwindow.testSwitch = { switchOpts, modelSwitch };', ctx);
  return { M, ...window.testSwitch };
}
test('owner bottom switch adds exactly fourth Tinfoil route, preserving first three and default', () => {
  const { M, switchOpts, modelSwitch } = switchHarness(true);
  const w = { id: 'main', thread: '__new__' };
  const { opts, at } = switchOpts(w, null);
  assert.deepEqual(Array.from(opts, o => o.value), ['claude-opus-5-5', 'gpt-6-astra', 'gpt-6.1-sol', 'exact/catalog-model']);
  assert.equal(at, 0); assert.equal(opts[3].provider, 'custom:wizard-tinfoil'); assert.equal(opts[3].agent, undefined);
  assert.equal((modelSwitch(w, null).match(/role="radio"/g) || []).length, 4);
  assert.equal(M.defaultOption().value, 'claude-opus-5-5');
  const existing = switchOpts({ id: 'main', thread: 'same-session' }, { model: 'exact/catalog-model', provider: 'custom:wizard-tinfoil' });
  assert.equal(existing.at, 3);
});
test('owner fourth switch cannot select a route without its upstream key', () => {
  const { switchOpts, modelSwitch } = switchHarness(false);
  const w = { id: 'main', thread: '__new__' };
  assert.equal(switchOpts(w, null).opts[3], null);
  assert.match(modelSwitch(w, null), /data-msi="3" aria-checked="false" disabled/);
});
