import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../web/core/chat-models.js', import.meta.url), 'utf8');
const legacy = 'claude-subscription-directsdk-experimental';
const payload = { provider: legacy, model: 'claude-opus-5-5', providers: [
  { slug: legacy, authenticated: true, models: ['claude-opus-5-5'] },
  { slug: 'anthropic', authenticated: true, models: ['claude-opus-5-5'] },
] };
function harness(accounts) {
  let rows = accounts;
  const requests = [];
  const window = {};
  const fetch = async (url, init) => {
    requests.push([url, init]);
    if (url.includes('wizard-claude')) return rows instanceof Error ? Promise.reject(rows) : { ok: true, json: async () => rows };
    return { ok: true, json: async () => url.includes('model/options') ? payload : null };
  };
  vm.runInNewContext(source, { window, fetch, AbortSignal, console });
  return { M: window.WosModels, requests, setRows(next) { rows = next; } };
}
const row = (id, status) => ({ id, status });
test('quota-limited pool remains the default Opus route and warns without switching provider', async () => {
  const h = harness({ accounts: [row('legacy-claude-code', 'exhausted'), row('native-oscar', 'rate_limited')] });
  await h.M.load();
  assert.equal(h.M.defaultOption().provider, 'anthropic');
  const compact = h.M.popHtml({ mode: 'new', cur: { model: 'claude-opus-5-5', provider: 'anthropic' } });
  assert.equal(compact.list.find(o => h.M.family(o.value, o.provider) === 'claude:opus').provider, 'anthropic');
  assert.match(compact.html, /Every listed Claude account reports a limit/);
  assert.match(h.M.sheetHtml({ mode: 'thread', cur: { model: 'claude-opus-5-5', provider: 'anthropic' }, all: true }).html, /Changing accounts alone may not restore this model/);
  assert(h.M.options.some(o => o.provider === legacy), 'explicit legacy choice remains');
  assert.equal(h.requests.filter(([url]) => url.includes('/sessions/')).length, 0, 'reading quota never changes a thread');
});
test('unknown, stale, or mixed account states never claim whole-pool exhaustion', async () => {
  for (const accounts of [null, { accounts: [] }, { accounts: [row('legacy-claude-code', 'ready'), row('native', 'exhausted')] },
    { accounts: [row('legacy-claude-code', 'exhausted'), row('native', 'unavailable')] }]) {
    const h = harness(accounts); await h.M.load(); assert.doesNotMatch(h.M.claudeNote(), /Every listed Claude account/);
  }
  const h = harness({ accounts: [row('legacy-claude-code', 'exhausted'), row('native', 'exhausted')] });
  await h.M.load(); assert.match(h.M.claudeNote(), /Every listed Claude account/);
  h.setRows(Object.assign(new Error('offline'), { name: 'AbortError' })); await h.M.load(true);
  assert.doesNotMatch(h.M.claudeNote(), /Every listed Claude account/);
  assert.match(h.M.claudeNote(), /not answering/);
});
test('live-shaped connected/ok rows with full session and weekly meters show the limit', async () => {
  const meter = (id, usedPercent) => ({ id, usedPercent, remainingPercent: 100 - usedPercent });
  const fetchedAt = new Date().toISOString();
  const h = harness({ accounts: [
    { ...row('legacy-claude-code', 'connected'), usage: { fetchedAt, limits: [meter('session:session', 100), meter('weekly_all:weekly', 21)] } },
    { ...row('native-oscar', 'ok'), usage: { fetchedAt, limits: [meter('session:session', 0), meter('weekly_all:weekly', 100), meter('weekly_scoped:Fable', 0)] } },
  ] });
  await h.M.load();
  assert.equal(h.M.defaultOption().provider, 'anthropic');
  assert.match(h.M.claudeNote(), /Every listed Claude account reports a limit/);
  assert.doesNotMatch(h.M.claudeNote(), /all Claude models/);
  const stale = new Date(Date.now() - 20 * 60e3).toISOString();
  h.setRows({ accounts: [
    { ...row('legacy-claude-code', 'connected'), usage: { fetchedAt: stale, limits: [meter('session:session', 100)] } },
    { ...row('native-oscar', 'ok'), usage: { fetchedAt, limits: [meter('weekly_all:weekly', 100)] } },
  ] });
  await h.M.load(true);
  assert.doesNotMatch(h.M.claudeNote(), /Every listed Claude account/);
});

test('sign-out is not quota: absent native grant does not reroute legacy', async () => {
  const h = harness({ accounts: [row('legacy-claude-code', 'ready'), row('native', 'invalid')] });
  await h.M.load(); assert.equal(h.M.defaultOption().provider, legacy);
  assert.doesNotMatch(h.M.claudeNote(), /every connected account/);
});
