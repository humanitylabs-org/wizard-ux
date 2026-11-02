import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
// Browser trust preview (wizard-os spec/browser-trust-shell-intents §6): under the listener gate the Claude app's own
// /api/accounts answers only the Agent Service adapter, so the shell model picker reads ONE shell-owned typed
// operation instead (POST /wizard/v1/browser-shell/call models.claude_accounts) and keeps native Claude routes and
// the limit note. Flag off keeps the direct read. Real Chromium: tools/qa-browser-recovery-surfaces.cjs.
const source = readFileSync(new URL('../web/core/chat-models.js', import.meta.url), 'utf8');
const SUB = 'claude-subscription-directsdk-experimental';
const payload = { provider: 'openai-codex', model: 'gpt-6.1-sol', providers: [
  { slug: 'openai-codex', authenticated: true, models: ['gpt-6.1-sol'] },
  { slug: SUB, authenticated: true, models: ['claude-opus-5-5[1m]'] },
  { slug: 'anthropic', authenticated: true, models: ['claude-opus-5-5'] }] };
const full = () => ({ fetchedAt: new Date().toISOString(), limits: [{ id: 'session:session', usedPercent: 100, remainingPercent: 0 }] });
function models({ boundary, shell = { state: 'ok', accounts: [{ id: 'account', source: 'pool', status: 'ready', usage: full() }] }, status = 200 }) {
  const window = boundary ? { WizBrowserBoundary: { enabled: true } } : {};
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, init });
    if (url === '/wizard/v1/browser-shell/call') return { ok: status === 200, status, json: async () => shell };
    if (url.includes('wizard-claude')) return { ok: false, status: 403, json: async () => ({ error: 'browser_request_refused' }) };   // the gate
    return { ok: true, json: async () => url.includes('model/options') ? payload : null };
  };
  vm.runInNewContext(source, { window, fetch, AbortSignal, console });
  return { M: window.WosModels, requests };
}
const opus = M => M.visible().find(o => M.family(o.value, o.provider) === 'claude:opus');

test('boundary on: one shell-owned typed read, never the app listener; native route and limit note kept', async () => {
  const { M, requests } = models({ boundary: true });
  await M.load();
  assert.ok(!requests.some(r => r.url.includes('/wizard-claude/')), 'the shell never asks the Claude app directly');
  const read = requests.find(r => r.url === '/wizard/v1/browser-shell/call');
  assert.equal(read.init.method, 'POST');
  assert.deepEqual(JSON.parse(read.init.body), { operation: 'models.claude_accounts', args: {} });
  assert.equal(opus(M).provider, 'anthropic');
  assert.match(M.claudeNote(), /Every listed Claude account reports a limit/);
  assert.doesNotMatch(M.claudeNote(), /not answering/);
});

test('boundary on: unavailable says "not answering"; absent or an older Service (404) says nothing and keeps legacy', async () => {
  let t = models({ boundary: true, shell: { state: 'unavailable' } }); await t.M.load();
  assert.match(t.M.claudeNote(), /Claude app not answering/);
  assert.equal(opus(t.M).provider, SUB);
  t = models({ boundary: true, shell: { state: 'absent' } }); await t.M.load();
  assert.equal(t.M.claudeNote(), '');
  t = models({ boundary: true, status: 404, shell: { error: 'not_found' } }); await t.M.load();
  assert.equal(t.M.claudeNote(), '');
  t = models({ boundary: true, status: 502, shell: { error: 'backend_failed' } }); await t.M.load();
  assert.match(t.M.claudeNote(), /not answering/);
});

test('boundary on, before this change (negative control): the direct read is refused and the note and native route vanish', async () => {
  // What the shell did before: read /wizard-claude/api/accounts from its own document. The gate answers 403.
  const legacy = source.replace("window.WizBrowserBoundary?.enabled\n        ? fetch('/wizard/v1/browser-shell/call'", "false\n        ? fetch('/wizard/v1/browser-shell/call'");
  assert.notEqual(legacy, source);
  const window = { WizBrowserBoundary: { enabled: true } };
  const fetch = async url => url.includes('wizard-claude') ? { ok: false, status: 403, json: async () => ({}) } : { ok: true, json: async () => url.includes('model/options') ? payload : null };
  vm.runInNewContext(legacy, { window, fetch, AbortSignal, console });
  await window.WosModels.load();
  assert.equal(window.WosModels.claudeNote(), '');
  assert.equal(opus(window.WosModels).provider, SUB, 'native Claude route lost: the picker falls back to the legacy single login');
});

test('boundary off: unchanged direct read', async () => {
  const { M, requests } = models({ boundary: false });
  await M.load();
  assert.ok(requests.some(r => r.url === '/wizard-claude/api/accounts'));
  assert.ok(!requests.some(r => r.url === '/wizard/v1/browser-shell/call'));
});
