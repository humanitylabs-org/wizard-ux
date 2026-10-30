// Regression (20 Oct 2026): Opus failed because the Claude sign-in had expired, and the thread only showed
// Hermes' generic "Your request was not processed." with a Retry that can't work. The Agent Service now names the
// connection app (wizard_reconnect); the failed-thread panel says so plainly and opens that app.
// Run: node --test tests/provider-reconnect.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const FIELD = { kind: 'provider_signed_out', provider: 'claude', app_id: 'wizard-claude', app_name: 'Claude', installed: true, app_status: 'expired' };

function models() {
  const window = { WosAgents: { lock: () => '' } };
  vm.runInContext(read('web/core/chat-models.js'), vm.createContext({ window, localStorage: { getItem: () => null, setItem() {} }, fetch: async () => ({}), console }));
  return window.WosModels;
}
function kit() {
  const ctx = { location: { origin: 'https://w.example', hostname: 'w.example', href: 'https://w.example/wizard-os-home/' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, navigator: {},
    document: { addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) },
    addEventListener() {}, setTimeout, clearTimeout, console, URL, Intl, Date };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(read('web/core/chat-kit.js'), ctx);
  return ctx.WosChat;
}
function live() {
  const src = read('web/live.js');
  // normalize() is internal; lift reconnectOf the way it is defined there and prove the field shapes.
  const body = src.slice(src.indexOf('  const RECONNECT = {'), src.indexOf('  const ATTN = new Set('));
  return new Function(`${body}; return reconnectOf;`)();
}

test('live.js keeps only the known connection apps from wizard_reconnect', () => {
  const reconnectOf = live();
  assert.deepEqual({ ...reconnectOf(FIELD) }, { provider: 'claude', appId: 'wizard-claude', name: 'Claude', runId: '', installed: true });
  assert.deepEqual({ ...reconnectOf({ ...FIELD, provider: 'chatgpt', app_id: 'wizard-chatgpt', installed: false }) }, { provider: 'chatgpt', appId: 'wizard-chatgpt', name: 'ChatGPT', runId: '', installed: false });
  for (const bad of [null, {}, { ...FIELD, app_id: 'evil' }, { ...FIELD, kind: 'x' }, { ...FIELD, provider: 'tinfoil' }]) assert.equal(reconnectOf(bad), null);
  assert.match(read('web/live.js'), /reconnect: reconnectOf\(item\.wizard_reconnect\)/);
});

test('a diagnosed sign-in failure shows Sign in, not Retry', () => {
  const M = models();
  const html = M.failureHtml({ s: { id: 's1', status: 'failed', model: 'claude-opus-5-5', provider: 'claude-subscription-directsdk-experimental',
    safeError: 'Claude is signed out. Open Claude to reconnect, then tap Retry.', reconnect: { provider: 'claude', appId: 'wizard-claude', name: 'Claude', installed: true } }, busy: '', canRetry: true });
  assert.match(html, /Claude sign-in expired/);
  assert.match(html, /This message is saved\. Sign in to Claude and it will send to Opus on its own\./);
  const buttons = [...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map(m => m[1]);
  assert.deepEqual(buttons, ['Sign in to Claude']);
  assert.match(html, /data-chreconnect="wizard-claude" data-recovery-run=""/);
  assert.doesNotMatch(html, /not processed/);
});

test('diagnosed ChatGPT failures use the same focused repair path when the connection app is missing', () => {
  const html = models().failureHtml({ s: { id: 's2', status: 'failed', reconnect: { provider: 'chatgpt', appId: 'wizard-chatgpt', name: 'ChatGPT', installed: false } }, busy: '', canRetry: true });
  assert.match(html, /data-chreconnect="wizard-chatgpt" data-recovery-run="">Sign in to ChatGPT</);
  assert.match(html, /ChatGPT sign-in expired/);
  const power = read('web/core/chat-power.js');
  assert.match(power, /window\.WizOpenApp\?\.\('troubleshooter'/);
  assert.match(power, /H\.openLink\?\.\(`\/troubleshoot\/\?provider=/);
  assert.match(power, /const RECONNECT_APPS = new Set\(\['wizard-claude', 'wizard-chatgpt'\]\)/);
});

test('ordinary failures keep the old panel exactly (negative control)', () => {
  const html = models().failureHtml({ s: { id: 's3', status: 'failed', model: 'claude-opus-5-5', provider: 'anthropic' }, busy: '', canRetry: true });
  assert.match(html, /Needs retry/);
  assert.doesNotMatch(html, /data-chreconnect/);
});

test("Hermes' failed_turn notice is marked, and hidden only when a reconnect panel replaces it", () => {
  const turns = kit().parseRows([
    { role: 'user', content: 'Plan my week', timestamp: 1 },
    { role: 'assistant', content: 'Your request was not processed. Send it again if you still want me to carry it out.', display_kind: 'failed_turn', timestamp: 2 },
  ]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].a.failed, true);
  const chats = read('web/core/chats.js');
  assert.match(chats, /if \(last && reconnect && tn\.a\?\.failed\) tn = \{ \.\.\.tn, a: null \};/);
  assert.match(chats, /turnHtml\(c, tn, k === arr\.length - 1, working, s\?\.helperStatus, s\?\.reconnect\)/);
  assert.match(chats, /s\?\.safeError && !s\?\.reconnect && s\?\.queueReason !== 'provider_access' \?/);
});

test('the reconnect click is handled before Retry in the panel and in Errors rows', () => {
  const power = read('web/core/chat-power.js');
  const at = power.indexOf("t.closest('[data-chreconnect]')");
  assert.ok(at > 0 && at < power.indexOf("t.closest('[data-chretry]')") && at < power.indexOf("t.closest('[data-errretry]')"));
  assert.match(power, /data-chreconnect="\$\{esc\(s\.reconnect\.appId\)\}"/);
});
