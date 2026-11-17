// Issue 1487: a send that failed because the owner's subscription is signed out says why and offers Reconnect (not a
// useless Retry), and Home's AI zone and Resources › AI accounts carry the same Reconnect button instead of a sentence.
// Real usage.js, resources.js and chat-models.js in a vm; the signed-out reading is the Agent Service /wizard/ai-usage shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SUB = 'claude-subscription-directsdk-experimental';
const claudeOut = { id: 'claude', name: 'Claude', status: 'unavailable', fetchedAt: new Date().toISOString(), limits: [],
  error: { code: 'signed_out', message: 'Claude is not signed in. Open the Claude app and press Connect.' } };
const claudeOk = { id: 'claude:two', provider: 'claude', name: 'Claude', status: 'ok', fetchedAt: new Date().toISOString(), limits: [{ id: 'weekly', label: 'Weekly', remainingPercent: 60 }] };
const gptOk = { id: 'codex', name: 'ChatGPT', status: 'ok', fetchedAt: new Date().toISOString(), limits: [{ id: 'weekly', label: 'Weekly', remainingPercent: 40 }] };

function boot() {
  const events = [];
  const ctx = { document: { documentElement: { dataset: { tweaks: '' } }, hidden: false, addEventListener() {}, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} }, queueMicrotask() {}, setTimeout, clearTimeout, AbortController, console, Set, Map,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    fetch: () => new Promise(() => {}) };
  ctx.window = ctx; ctx.addEventListener = () => {}; ctx.dispatchEvent = e => { events.push(e); return true; };
  ctx.WosChat = { esc: s => String(s ?? '') };
  vm.runInNewContext(read('web/core/usage.js'), ctx);
  const source = read('web/core/resources.js');
  vm.runInNewContext(source.replace('window.WosResources={', 'globalThis.__resourcesState=S;window.WosResources={'), ctx);
  vm.runInNewContext(read('web/core/chat-models.js'), ctx);
  const set = providers => { const snap = ctx.WosUsage.normalize({ providers }); ctx.__resourcesState.ai = snap; ctx.WosUsage.snap = snap; ctx.WosUsage.at = Date.now(); };
  return { ctx, U: ctx.WosUsage, M: ctx.WosModels, set, events, home: () => ctx.WosResources.home(), details: () => ctx.WosUsage.html() };
}
const failed = (provider, model = 'claude-fable-5-1') => ({ id: 'philosopher', status: 'failed', model, provider });

test('a failed send on a signed-out Claude subscription names the reason and offers Reconnect, not Retry', () => {
  const b = boot(); b.set([claudeOut, gptOk]);
  for (const provider of [SUB, 'anthropic', 'claude', '']) {
    const html = b.M.failureHtml({ s: failed(provider), canRetry: true });
    assert.match(html, /This didn’t send because your Claude subscription is disconnected/, provider);
    assert.match(html, /<button type="button" data-chreconnect="wizard-claude" data-recovery-run="">Reconnect Claude<\/button>/, provider);
    assert.doesNotMatch(html, /data-chretry |data-chretry>|Needs retry|>Retry</, provider);
    assert.match(html, /data-chretrymodel/); assert.match(html, /data-chdismiss/);
    assert.ok(html.indexOf('data-chreconnect') < html.indexOf('data-chretrymodel'), 'Reconnect is the primary (first) button');
  }
});

test('main and every routed agent kind get the same card; an Agent Service reason other than sign-in wins', () => {
  const b = boot(); b.set([claudeOut]);
  // main, host-profile, container and restricted rows (routed ids may equal a main id: the card reads only its own row).
  for (const [kind, agent] of [['main', ''], ['host-ops', 'host'], ['box', 'container'], ['locked', 'restricted']]) {
    const html = b.M.failureHtml({ s: { ...failed(SUB), id: 'same-id', agent, agentKind: kind }, canRetry: true });
    assert.match(html, /Reconnect Claude/, kind); assert.doesNotMatch(html, /data-chretry /, kind);
  }
  for (const code of ['network', 'provider_quota']) {
    const html = b.M.failureHtml({ s: { ...failed(SUB), runError: { code, provider: 'claude' } }, canRetry: true });
    assert.doesNotMatch(html, /Reconnect Claude|disconnected/, code); assert.match(html, /data-chretry/, code);
  }
  assert.match(b.M.failureHtml({ s: { ...failed(SUB), runError: { code: 'provider_auth', provider: 'claude' } }, canRetry: true }), /Reconnect Claude/);
});

test('Tinfoil signed out: Reconnect goes to its Connect step', () => {
  const b = boot(); b.set([{ id: 'tinfoil', name: 'Tinfoil', status: 'signed_out', limits: [] }]);
  assert.match(b.M.failureHtml({ s: failed('tinfoil', 'deepseek-v4-1-flash'), canRetry: true }), /data-chreconnect="wizard-tinfoil" data-recovery-run="">Reconnect Tinfoil/);
  assert.match(b.details(), /data-res-signin="wizard-tinfoil" data-res-reconnect="1">Reconnect Tinfoil/);
  assert.match(read('web/core/resources.js'), /si\.hasAttribute\('data-res-reconnect'\)&&app==='wizard-tinfoil'\?'\/wizard-tinfoil\/\?connect=1'/);
  assert.match(read('web/core/chat-power.js'), /appId === 'wizard-tinfoil' \? '\/wizard-tinfoil\/\?connect=1'/);
});

test('the same for ChatGPT; other providers and working subscriptions keep Retry', () => {
  const b = boot(); b.set([{ ...gptOk, status: 'signed_out', limits: [] }, claudeOk]);
  assert.match(b.M.failureHtml({ s: failed('openai-codex', 'gpt-6.1-sol'), canRetry: true }), /Reconnect ChatGPT/);
  for (const s of [failed(SUB), failed('openrouter', 'glm-5.3'), { ...failed(SUB), status: 'interrupted', provider: 'tinfoil' }]) {
    const html = b.M.failureHtml({ s, canRetry: true });
    assert.match(html, /data-chretry /, s.provider); assert.doesNotMatch(html, /Reconnect/, s.provider);
  }
  // One of two Claude accounts still signed in: Claude still works, so Retry stays.
  b.set([claudeOut, claudeOk]);
  assert.match(b.M.failureHtml({ s: failed(SUB), canRetry: true }), /data-chretry /);
});

test('after reconnecting, the card offers Retry (send again) and the chats repaint on the change', () => {
  const b = boot(); b.set([claudeOut]);
  assert.match(b.M.failureHtml({ s: failed(SUB), canRetry: true }), /Reconnect Claude/);
  assert.deepEqual([...b.events.at(-1).detail.signedOut], ['claude']);
  b.set([{ ...claudeOut, status: 'ok', error: null, limits: [{ id: 'weekly', label: 'Weekly', remainingPercent: 90 }] }]);
  assert.equal(b.events.at(-1).type, 'wos:ai-signin'); assert.equal(b.events.at(-1).detail.signedOut.length, 0);
  const n = b.events.length; b.set([claudeOk]); assert.equal(b.events.length, n, 'no repaint when nothing changed');
  const html = b.M.failureHtml({ s: failed(SUB), canRetry: true });
  assert.match(html, /data-chretry /); assert.doesNotMatch(html, /Reconnect/);
  // An Agent Service diagnosis keeps its own panel (troubleshooter recovery that re-sends the saved run).
  b.set([claudeOut]);
  assert.match(b.M.failureHtml({ s: { ...failed(SUB), reconnect: { name: 'Claude', provider: 'claude', appId: 'wizard-claude', runId: 'r1' } }, canRetry: true }), /data-recovery-run="r1">Sign in to Claude/);
});

test('Home AI zone and Resources › AI accounts show a working Reconnect button for a signed-out account', () => {
  const b = boot(); b.set([claudeOut, gptOk]);
  const btn = /<button type="button" class="us-reconnect" data-res-signin="wizard-claude" data-res-reconnect="1">Reconnect Claude<\/button>/;
  const home = b.home();
  assert.match(home, btn);
  assert.ok(home.indexOf('rs-reconnect') > home.indexOf('data-res-open="ai"'), 'beside the AI zone, never nested inside its button');
  assert.doesNotMatch(home.slice(home.indexOf('data-res-open="ai"'), home.indexOf('rs-reconnect')), /<button/);
  assert.match(b.details(), btn);
  assert.doesNotMatch(b.details(), /Reconnect ChatGPT/);
  b.set([claudeOk, gptOk]);
  assert.doesNotMatch(b.home(), /Reconnect/); assert.doesNotMatch(b.details(), /Reconnect/);
  // The tap: resources.js opens the app straight at its Reconnect step.
  assert.match(read('web/core/resources.js'), /si\.hasAttribute\('data-res-reconnect'\)&&RECONNECT_APPS\.has\(app\)\?`\/\$\{app\}\/\?reconnect=1`/);
});

test('Reconnect on the card opens the Claude app at Connect when there is no saved run to recover', () => {
  const src = read('web/core/chat-power.js');
  assert.match(src, /if \(!runId && \(RECONNECT_APPS\.has\(appId\) \|\| appId === 'wizard-tinfoil'\)\) \{ const path = .*: `\/\$\{appId\}\/\?reconnect=1`; if \(!window\.WizOpenApp\?\.\(appId, path\)\) location\.assign\(path\); return true; \}/);
  assert.match(src, /addEventListener\?\.\('wos:ai-signin', \(\) => rerenderAll\(\)\)/);
});
