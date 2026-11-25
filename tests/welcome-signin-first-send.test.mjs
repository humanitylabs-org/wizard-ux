// wizard-ux#1811 (and #1805): on the desktop shell the model list is read at boot, before the Welcome signs an AI in,
// and cached for 5 minutes. The first message then found no model and failed "Model unavailable" without asking the
// box again. A send with no model in a cached list re-reads the box once; the Welcome refreshes the list on sign-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/chat-models.js', import.meta.url), 'utf8');
const welcome = readFileSync(new URL('../web/core/welcome.js', import.meta.url), 'utf8');

function box() {
  const state = { signed: false, reads: 0 };
  const fetch = async url => {
    if (url.includes('model/options')) state.reads++;
    const j = url.includes('model/options') ? (state.signed
      ? { provider: 'openai-codex', model: 'gpt-6.1-sol', providers: [{ slug: 'openai-codex', authenticated: true, models: ['gpt-6.1-sol'] }] }
      : { provider: '', model: '', providers: [] }) : null;
    return { ok: true, status: 200, json: async () => j };
  };
  const window = {};
  vm.runInNewContext(source, { window, fetch, AbortSignal, console, Date, setTimeout: () => 0, clearTimeout() {} });
  return { M: window.WosModels, state };
}

test('a send right after a sign-in re-reads the cached empty model list and routes to the new AI', async () => {
  const { M, state } = box();
  await M.load(); // boot: no AI yet
  assert.equal(M.snapshot(''), null);
  state.signed = true; // the Welcome signs ChatGPT in; the list is still the cached empty one
  const route = await M.resolveRoute(M.snapshot(''));
  assert.deepEqual({ ...route }, { model: 'gpt-6.1-sol', provider: 'openai-codex' });
  assert.equal(state.reads, 2, 'asked the box once more');
});

test('with still no AI on the box the send fails as before, after one re-read', async () => {
  const { M, state } = box();
  await M.load();
  await assert.rejects(M.resolveRoute(null), /Model unavailable/);
  assert.equal(state.reads, 2);
});

test('a send with a model never re-reads the list', async () => {
  const { M, state } = box(); state.signed = true;
  await M.load();
  const route = await M.resolveRoute(M.snapshot(''));
  assert.equal(route.model, 'gpt-6.1-sol');
  assert.equal(state.reads, 1);
});

test('the Welcome refreshes the shell model list when it sees the AI signed in', () => {
  const at = welcome.indexOf('if (ok === true) {');
  assert.ok(at > 0);
  const next = welcome.slice(at, at + 600);
  assert.match(next, /WosModels[\s\S]*load\(true\)[\s\S]*wos:models/);
});
