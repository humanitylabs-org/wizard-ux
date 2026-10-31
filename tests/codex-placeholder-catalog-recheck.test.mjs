import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Hermes serves an offline placeholder ChatGPT catalogue (no Astra, older Sol) while a sign-in renews or the pool
// switches accounts. The switch must recheck soon and repaint, not hold the placeholder for the 5-minute cache.
const source = readFileSync(new URL('../web/core/chat-models.js', import.meta.url), 'utf8');
const PLACEHOLDER = ['gpt-6-sol', 'gpt-6-sol-900k', 'gpt-6-luna', 'gpt-5.6-sol'];
const LIVE = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'];
const body = models => ({ provider: 'anthropic', model: 'claude-opus-5-5', providers: [
  { slug: 'anthropic', authenticated: true, models: ['claude-opus-5-5'] },
  { slug: 'openai-codex', authenticated: true, models }] });

function harness(answers) {
  const timers = [], events = [];
  let calls = 0;
  const fetch = async url => {
    if (!String(url).includes('/model/options')) return { ok: false, status: 404, json: async () => null };
    const models = answers[Math.min(calls++, answers.length - 1)];
    return { ok: true, status: 200, json: async () => body(models) };
  };
  const ctx = { console, fetch, AbortSignal: { timeout: () => undefined }, Event: class { constructor(t) { this.type = t; } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {} },
    document: { documentElement: { dataset: {}, getAttribute: () => null }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
    addEventListener() {}, dispatchEvent: e => events.push(e.type) };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  return { M: ctx.WosModels, timers, events, calls: () => calls };
}
const settle = () => new Promise(r => setImmediate(r));
const runNext = async h => { const t = h.timers.shift(); t.fn(); await settle(); await settle(); return t.ms; };
const codex = M => [...M.options.filter(o => o.provider === 'openai-codex').map(o => o.value)];

test('a placeholder ChatGPT catalogue is rechecked soon and listeners are told when the real list arrives', async () => {
  const h = harness([PLACEHOLDER, LIVE]);
  await h.M.load(true);
  assert.deepEqual(codex(h.M), PLACEHOLDER);
  assert.equal(h.timers.length, 1);
  assert.ok(h.timers[0].ms <= 10e3);
  await runNext(h);
  assert.deepEqual(codex(h.M), LIVE);
  assert.deepEqual([...h.events], ['wos:models']);
  assert.equal(h.timers.length, 0, 'no further rechecks once Astra is listed');
});

test('a plan without Astra settles after a bounded number of rechecks', async () => {
  const h = harness([PLACEHOLDER]);
  await h.M.load(true);
  let tries = 0;
  while (h.timers.length) { await runNext(h); tries += 1; assert.ok(tries < 10); }
  assert.equal(tries, 3);
  assert.deepEqual([...h.events], [], 'an unchanged list does not repaint');
});

test('the real catalogue schedules no recheck', async () => {
  const h = harness([LIVE]);
  await h.M.load(true);
  assert.equal(h.timers.length, 0);
  assert.equal(h.M.stale(), false);
});
