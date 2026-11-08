// Regression (wizard-ux#166): an expired ChatGPT subscription showed "Error: <your message>" in Chats > Errors and
// Hermes' generic "Your request was not processed." in the thread. When the Agent Service names the reason
// (wizard_last_run_error), the off-by-default wizard/failure-reason tweak says it plainly and orders the ways out.
// Run: node --test tests/failure-reason.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { modelContext } from './fixtures/chats-list-model.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const TWEAK = 'wizard/failure-reason';

function models(tweaks = TWEAK) {
  const window = { WosAgents: { lock: () => '' } };
  const document = { documentElement: { dataset: { tweaks } } };
  vm.runInContext(read('web/core/chat-models.js'), modelContext({ window, document, localStorage: { getItem: () => null, setItem() {} }, fetch: async () => ({}), console }));
  return window.WosModels;
}
function runErrorOf() {
  const src = read('web/live.js');
  const body = src.slice(src.indexOf('  const RUN_ERROR_CODES = new Set('), src.indexOf('  function normalize(item) {'));
  return new Function(`${body}; return runErrorOf;`)();
}
const failed = (code, extra = {}) => ({ id: 's1', status: 'failed', model: 'gpt-6-sol', provider: 'openai-codex', preview: 'How is your day',
  runError: { code, provider: 'openai-codex', message: '' }, ...extra });
const buttons = html => [...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map(m => m[1]);

test('live.js keeps only known wizard_last_run_error codes, clipped', () => {
  const of = runErrorOf();
  assert.deepEqual({ ...of({ code: 'provider_billing', provider: 'openai-codex', message: '  Plan\n ended ' }) }, { code: 'provider_billing', provider: 'openai-codex', message: 'Plan ended' });
  assert.equal(of({ code: 'provider_quota', message: 'x'.repeat(500) }).message.length, 200);
  for (const bad of [null, 'provider_auth', {}, { code: 'evil' }, { code: 'provider_auth'.toUpperCase() }]) assert.equal(of(bad), null);
  const live = read('web/live.js');
  assert.match(live, /runError: runErrorOf\(item\.wizard_last_run_error\),/);
  assert.match(live, /reconnect:null, runError:null,/);
});

test('switched off (default): no reason, the old panel exactly', () => {
  const M = models('');
  assert.equal(M.runError(failed('provider_billing')), null);
  const html = M.failureHtml({ s: failed('provider_billing'), busy: '', canRetry: true });
  assert.match(html, /Needs retry/);
  assert.deepEqual(buttons(html), ['Retry', 'Choose another model', 'Dismiss']);
  assert.doesNotMatch(html, /data-chreason/);
  assert.doesNotMatch(read('web/tweaks/catalog.json').split('"defaults"')[1], /failure-reason/);
});

test('expired subscription: plain reason, Choose another model before Retry', () => {
  const M = models();
  assert.equal(M.runError(failed('provider_billing')).line, 'ChatGPT isn’t available: subscription ended');
  const html = M.failureHtml({ s: failed('provider_billing', { runError: { code: 'provider_billing', provider: 'openai-codex', message: 'Your plan <b>ended</b>' } }), busy: '', canRetry: true });
  assert.match(html, /data-chreason="provider_billing"/);
  assert.match(html, /class="ch-fail reason model-first"/);
  assert.match(html, /Retry on ChatGPT will fail again until it’s renewed/);
  assert.match(html, /Your message is saved\./);
  assert.match(html, /Your plan &lt;b&gt;ended&lt;\/b&gt;/);
  assert.deepEqual(buttons(html), ['Choose another model', 'Retry', 'Dismiss']);
  assert.deepEqual(buttons(M.failureHtml({ s: failed('provider_quota'), busy: '', canRetry: true })), ['Choose another model', 'Retry', 'Dismiss']);
  assert.match(M.runError(failed('provider_quota', { runError: { code: 'provider_quota', provider: 'claude-subscription' } })).line, /^Claude usage limit reached$/);
});

test('network failure: says the account is fine, Retry first', () => {
  const M = models();
  const html = M.failureHtml({ s: failed('network'), busy: '', canRetry: true });
  assert.match(html, /Couldn’t reach ChatGPT: network problem/);
  assert.match(html, /Your account is fine\. Retry usually works\./);
  assert.deepEqual(buttons(html), ['Retry', 'Choose another model', 'Dismiss']);
  assert.match(M.runError(failed('unknown', { runError: { code: 'unknown', provider: 'mystery' } })).line, /^The AI provider couldn’t answer$/);
});

test('a sign-out with a connection app keeps its Sign in panel; working and retrying threads show no reason', () => {
  const M = models();
  const rc = { provider: 'chatgpt', appId: 'wizard-chatgpt', name: 'ChatGPT', installed: true };
  assert.equal(M.runError(failed('provider_auth', { reconnect: rc })), null);
  assert.match(M.failureHtml({ s: failed('provider_auth', { reconnect: rc }), busy: '', canRetry: true }), /Sign in to ChatGPT/);
  assert.equal(M.runError(failed('provider_auth', { status: 'running' })), null);
  assert.doesNotMatch(M.failureHtml({ s: failed('provider_billing'), busy: 'retry', retryLabel: 'Retrying…', canRetry: true }), /data-chreason/);
  assert.match(M.runError(failed('provider_auth')).line, /^ChatGPT isn’t available: signed out or sign-in expired$/);
});

test('Errors row and thread use the reason in place of "Error: <message>" and the generic failed_turn bubble', () => {
  const chats = read('web/core/chats.js');
  assert.match(chats, /const rerr = needs && !working \? window\.WosModels\?\.runError\?\.\(s\) : null;/);
  assert.match(chats, /: rerr \? esc\(rerr\.line\) : working \?/);
  assert.match(chats, /const runErr = !working && !!window\.WosModels\?\.runError\?\.\(s\);/);
  assert.match(chats, /\(!runErr && s\?\.safeError && !s\?\.reconnect/);
  const tw = 'web/tweaks/wizard/failure-reason/';
  assert.equal(JSON.parse(read(tw + 'manifest.json')).id, TWEAK);
  assert.ok(JSON.parse(read('web/tweaks/catalog.json')).tweaks.includes(TWEAK));
  assert.match(read(tw + 'tweak.css'), /html\[data-tweaks~="wizard\/failure-reason"\]/);
});
