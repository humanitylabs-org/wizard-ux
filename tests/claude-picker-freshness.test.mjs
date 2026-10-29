// Issue #572: Claude models were missing for up to 5 minutes after sign-in, and vanished silently when the Claude app
// did not answer. The picker refetches a list older than ~15 s on open, and says when the Claude app is not answering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/chat-models.js', import.meta.url), 'utf8');
const power = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
const SUB = 'claude-subscription-directsdk-experimental';
const payload = { provider: 'openai-codex', model: 'gpt-6.1-sol', providers: [
  { slug: 'openai-codex', authenticated: true, models: ['gpt-6.1-sol'] },
  { slug: SUB, authenticated: true, models: ['claude-opus-5-5[1m]'] } ] };
function models(claude) {
  const window = {};
  const fetch = async url => {
    if (url.includes('wizard-claude')) return claude();
    return { ok: true, status: 200, json: async () => url.includes('model/options') ? payload : null };
  };
  vm.runInNewContext(source, { window, fetch, AbortSignal, console, Date });
  return window.WosModels;
}
const NOTE = 'Claude app not answering';

test('picker catalogue TTL remains ~15 s and every open revalidates sign-in' , async () => {
  const M = models(async () => ({ ok: true, status: 200, json: async () => ({ accounts: [] }) }));
  assert.equal(M.stale(), true);
  await M.load();
  assert.equal(M.stale(), false);
  M.at = Date.now() - 16e3;
  assert.equal(M.stale(), true);
  const open = power.slice(power.indexOf("openSheet({ type: 'model'"), power.indexOf('function openFiles'));
  assert.match(open, /M\.load\(M\.ready\)/, 'every open revalidates, which includes stale catalogues');
  assert.doesNotMatch(open, /if \(M\.stale|if \(!M\.ready\)/, 'fresh-cache opens must not hide a new sign-in');
});

test('a Claude app that errors or times out is named in the picker', async () => {
  for (const claude of [async () => ({ ok: false, status: 502, json: async () => null }),
    async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }]) {
    const M = models(claude); await M.load();
    assert.equal(M.claudeDown, true);
    assert(M.popHtml({ mode: 'new', cur: null }).html.includes(NOTE));
    assert(M.sheetHtml({ mode: 'new', cur: null }).html.includes(NOTE));
  }
});

test('no Claude app installed (404 or the host HTML fallback) stays quiet', async () => {
  for (const claude of [async () => ({ ok: false, status: 404, json: async () => null }),
    async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } })]) {
    const M = models(claude); await M.load();
    assert.equal(M.claudeDown, false);
    assert(!M.popHtml({ mode: 'new', cur: null }).html.includes(NOTE));
  }
});
