// Issue 1799: a failed send the Agent Service diagnosed as "sign-in expired" (wizard_reconnect) shows the sign-in card
// only while that subscription still reads signed out. Signed back in (the live /wizard/ai-usage reading, or before it
// arrives the box's app_status), the thread, its Chats row and the Errors row offer the ordinary Retry. When this
// device saw the subscription go from signed out to signed in, the held send goes again once on its own.
// Real usage.js and chat-models.js in a vm; the readings are the Agent Service /wizard/ai-usage shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const claudeOut = { id: 'claude', name: 'Claude', status: 'unavailable', limits: [], error: { code: 'expired', message: 'Claude sign-in has expired.' } };
const claudeOk = { id: 'claude', name: 'Claude', status: 'ok', limits: [{ id: 'weekly', label: 'Weekly', remainingPercent: 60 }] };
const gptOk = { id: 'codex', name: 'ChatGPT', status: 'ok', limits: [{ id: 'weekly', label: 'Weekly', remainingPercent: 40 }] };
const gptOut = { id: 'codex', name: 'ChatGPT', status: 'unavailable', limits: [], error: { code: 'signed_out' } };

function boot() {
  const events = [];
  const ctx = { document: { documentElement: { dataset: { tweaks: 'wizard/failure-reason' } }, addEventListener() {}, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, console, Set, Map,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } }, fetch: () => new Promise(() => {}) };
  ctx.window = ctx; ctx.addEventListener = () => {}; ctx.dispatchEvent = e => { events.push(e); return true; };
  ctx.WosChat = { esc: s => String(s ?? '') };
  vm.runInNewContext(read('web/core/usage.js'), ctx);
  vm.runInNewContext(read('web/core/chat-models.js'), ctx);
  const set = providers => { ctx.WosUsage.at = Date.now(); ctx.WosUsage.snap = ctx.WosUsage.normalize({ providers }); };
  return { U: ctx.WosUsage, M: ctx.WosModels, set, events };
}
const held = (provider, appStatus = 'unknown', extra = {}) => ({ id: 't1', status: 'failed', model: provider === 'claude' ? 'claude-haiku-4-5' : 'gpt-6.2-astra', provider,
  reconnect: { provider, appId: 'wizard-' + provider, name: provider === 'claude' ? 'Claude' : 'ChatGPT', runId: 'run_1', installed: true, appStatus }, ...extra });

test('signed back in: the stale sign-in card becomes a plain Retry (Claude and ChatGPT)', () => {
  const b = boot(); b.set([claudeOk, gptOk]);
  for (const p of ['claude', 'chatgpt']) {
    const s = held(p, 'expired');
    assert.equal(b.M.reconnect(s), null, p);
    const html = b.M.failureHtml({ s, canRetry: true });
    assert.doesNotMatch(html, /sign-in expired|Sign in to|disconnected|on its own/, p);
    for (const control of ['data-chretry', 'data-chretrymodel', 'data-chdismiss']) assert.ok(html.includes(control), `${p}: ${control}`);
  }
});

test('still signed out: the sign-in card stays, with its one Sign in button', () => {
  const b = boot(); b.set([claudeOut, gptOut]);
  for (const p of ['claude', 'chatgpt']) {
    const s = held(p, 'connected'); // the live reading wins over the box's earlier app_status
    assert.ok(b.M.reconnect(s), p);
    const html = b.M.failureHtml({ s, canRetry: true });
    assert.match(html, /sign-in expired/, p); assert.match(html, /data-recovery-run="run_1"/, p); assert.doesNotMatch(html, /data-chretry/, p);
  }
});

test('only the failed provider counts: ChatGPT signed in does not clear a Claude diagnosis', () => {
  const b = boot(); b.set([claudeOut, gptOk]);
  assert.ok(b.M.reconnect(held('claude')));
  assert.equal(b.M.reconnect(held('chatgpt')), null);
});

test('before the live reading arrives, the box\'s app_status decides', () => {
  const b = boot();
  assert.equal(b.M.reconnect(held('claude', 'connected')), null);
  assert.ok(b.M.reconnect(held('claude', 'expired')));
  assert.ok(b.M.reconnect(held('claude', 'unknown')));
});

test('signed in again, the named provider_auth reason is not shown either', () => {
  const b = boot(); b.set([claudeOk]);
  const s = { id: 't2', status: 'failed', model: 'claude-haiku-4-5', provider: 'claude', runError: { code: 'provider_auth', provider: 'claude', message: '' } };
  assert.equal(b.M.runError(s), null);
  assert.match(b.M.failureHtml({ s, canRetry: true }), /Needs retry/);
  b.set([claudeOut]);
  assert.equal(b.M.runError(s)?.code, 'provider_auth');
});

test('the reading tells open chats when a subscription comes back, naming what is signed in', () => {
  const b = boot(); b.set([claudeOut]); b.set([claudeOk]);
  const last = b.events.at(-1);
  assert.equal(last.type, 'wos:ai-signin'); assert.deepEqual([...last.detail.signedOut], []); assert.deepEqual([...last.detail.signedIn], ['claude']);
  assert.deepEqual([...b.events.at(-2).detail.signedOut], ['claude']);
  assert.equal(b.U.signedIn('claude'), true); assert.equal(b.U.signedIn('chatgpt'), null);
});

