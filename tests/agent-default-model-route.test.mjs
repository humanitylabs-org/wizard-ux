import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// James, 23 Oct 2026: a voice note picked for Philosopher ran on Opus (the main default, also in Philosopher's allowed
// list) instead of Philosopher's own default, Fable. A main-agent route must never become an agent's model choice.
const source = readFileSync(new URL('../web/core/chat-models.js', import.meta.url), 'utf8');
function models() {
  const phil = { id: 'philosopher', label: 'Philosopher', model: { provider: 'anthropic', model: 'claude-fable-5-1', allowed_models: ['claude-fable-5-1', 'claude-opus-5-5'] } };
  const allows = (a, m) => a.model.allowed_models.includes(m);
  const ctx = { console, localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, document: { addEventListener() {} },
    WosAgents: { isOther: id => id === 'philosopher', get: id => (id === 'philosopher' ? phil : null), allows,
      route: (a, m) => ({ model: m && allows(a, m) ? m : a.model.model, provider: a.model.provider, agent: a.id }) },
    WizLive: { session: () => null, agentOf: () => '' } };
  ctx.window = ctx; vm.runInNewContext(source, ctx);
  return ctx.WosModels;
}
test('a main-agent route carried into an agent pick falls back to the agent default', () => {
  const r = models().snapshot('', { model: 'claude-opus-5-5', provider: 'claude-subscription-directsdk-experimental' }, 'philosopher');
  assert.equal(r.model, 'claude-fable-5-1'); assert.equal(r.agent, 'philosopher');
});
test('a model picked in the agent\'s own picker is kept', () => {
  const r = models().snapshot('', { model: 'claude-opus-5-5', provider: 'anthropic', agent: 'philosopher' }, 'philosopher');
  assert.equal(r.model, 'claude-opus-5-5');
});
test('no choice: the agent default', () => {
  assert.equal(models().snapshot('', null, 'philosopher').model, 'claude-fable-5-1');
});
