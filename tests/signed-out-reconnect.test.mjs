// Issue 1487: a send that failed because the owner's subscription is signed out says why and offers Reconnect (not a
// useless Retry), and Home's AI zone and Resources › AI accounts carry the same Reconnect button instead of a sentence.
// Real usage.js, resources.js and chat-models.js in a vm; the signed-out reading is the Agent Service /wizard/ai-usage shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SUB = 'claude-subscription-directsdk-experimental';
const claudeOut = { id: 'claude', name: 'Claude', status: 'unavailable', fetchedAt: new Date().toISOString(), limits: [],
  error: { code: 'signed_out', message: 'Claude is not signed in. Open the Claude app and press Connect.' } };
const claudeOk = { id: 'claude:two', provider: 'claude', name: 'Claude', status: 'ok', fetchedAt: new Date().toISOString(), limits: [{ id: 'weekly', label: 'Weekly', remainingPercent: 60 }] };
const gptOk = { id: 'codex', name: 'ChatGPT', status: 'ok', fetchedAt: new Date().toISOString(), limits: [{ id: 'weekly', label: 'Weekly', remainingPercent: 40 }] };

function boot() {
  const events = [], on = {}, opened = [];
  const ctx = { document: { documentElement: { dataset: { tweaks: '' } }, hidden: false, addEventListener: (t, f) => { on[t] = f; }, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} }, queueMicrotask() {}, setTimeout, clearTimeout, AbortController, console, Set, Map,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    fetch: () => new Promise(() => {}) };
  ctx.window = ctx; ctx.addEventListener = () => {}; ctx.dispatchEvent = e => { events.push(e); return true; };
  ctx.WosChat = { esc: s => String(s ?? '') }; ctx.WizOpenApp = (app, path) => (opened.push([app, path]), true);
  vm.runInNewContext(read('web/core/usage.js'), ctx);
  const source = read('web/core/resources.js');
  vm.runInNewContext(source.replace('window.WosResources={', 'globalThis.__resourcesState=S;window.WosResources={'), ctx);
  vm.runInNewContext(read('web/core/chat-models.js'), ctx);
  const set = providers => { const snap = ctx.WosUsage.normalize({ providers }); ctx.__resourcesState.ai = snap; ctx.WosUsage.snap = snap; ctx.WosUsage.at = Date.now(); };
  return { ctx, U: ctx.WosUsage, M: ctx.WosModels, set, events, home: () => ctx.WosResources.home(), details: () => ctx.WosUsage.html(), opened,
    // resources.js's real click listener on a [data-res-signin] button
    tapSignin: (app, reconnect = true) => on.click({ preventDefault() {}, target: { closest: q => (q === '[data-res-signin]' ? { dataset: { resSignin: app }, hasAttribute: k => reconnect && k === 'data-res-reconnect' } : null) } }) };
}
const failed = (provider, model = 'claude-fable-5-1') => ({ id: 'philosopher', status: 'failed', model, provider });

test('a failed send on a signed-out Claude subscription names the reason and offers Reconnect, not Retry', () => {
  const b = boot(); b.set([claudeOut, gptOk]);
  for (const provider of [SUB, 'claude', '']) {
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
  b.tapSignin('wizard-tinfoil'); b.tapSignin('wizard-tinfoil', false);
  assert.deepEqual(b.opened, [['wizard-tinfoil', '/wizard-tinfoil/?connect=1'], ['wizard-tinfoil', '']], 'Reconnect opens Tinfoil at its Connect step');
  // the card's Reconnect: run in 'Reconnect on the card opens the Claude app at Connect when there is no saved run to recover'
});

test('issue 1755: a Tinfoil thread on its real Hermes route (custom:wizard-tinfoil) also offers Reconnect Tinfoil', () => {
  const b = boot(); b.set([{ id: 'tinfoil', name: 'Tinfoil', status: 'signed_out', limits: [] }]);
  for (const provider of ['custom:wizard-tinfoil', 'wizard-tinfoil', 'custom:tinfoil-operator', 'tinfoil']) {
    const s = { id: 'x', status: 'failed', model: 'kimi-k2', provider };
    assert.equal(b.M.signedOutFail(s)?.appId, 'wizard-tinfoil', provider);
    const html = b.M.failureHtml({ s, canRetry: true });
    assert.match(html, /Tinfoil disconnected/, provider);
    assert.match(html, /data-chreconnect="wizard-tinfoil" data-recovery-run="">Reconnect Tinfoil/, provider);
    assert.doesNotMatch(html, /data-chretry |Needs retry/, provider);
  }
  // Tinfoil signed in: the same thread keeps Retry.
  b.set([{ id: 'tinfoil', name: 'Tinfoil', status: 'ok', fetchedAt: new Date().toISOString(), limits: [] }]);
  assert.equal(b.M.signedOutFail({ id: 'x', status: 'failed', model: 'kimi-k2', provider: 'custom:wizard-tinfoil' }), null);
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
  b.tapSignin('wizard-claude'); assert.deepEqual(b.opened, [['wizard-claude', '/wizard-claude/?reconnect=1']]);
});

// openReconnect, rerenderAll and the wos:ai-signin listener from chat-power.js, plus its [data-chreconnect] click line.
function reconnectCard({ opens = false } = {}) {
  const src = read('web/core/chat-power.js');
  const cut = (x, y) => { const i = src.indexOf(x), j = src.indexOf(y, i); assert.ok(i >= 0 && j > i, x); return src.slice(i, j); };
  const click = src.split('\n').find(l => l.startsWith("    const rc = t.closest('[data-chreconnect]');"));
  assert.ok(click, 'click line');
  const opened = [], assigned = [], links = [], listeners = {}, painted = [];
  const ctx = { opened, assigned, links, painted, location: { assign: p => assigned.push(p) },
    A: { CH: { w1: {}, w2: {} }, renderChats: w => painted.push(w.id) }, H: { win: id => ({ id }), openLink: (u, t) => (links.push([u, t]), true), changed() {} } };
  ctx.window = { WizOpenApp: (id, path) => (opened.push([id, path]), opens), addEventListener: (t, f) => { listeners[t] = f; } };
  vm.createContext(ctx);
  vm.runInContext(`${cut('  const RECONNECT_APPS = ', '  // Issue 1488:')}${cut('  function rerenderAll()', '\n\n  /* Errors section extras')}\nfunction click(t) {\n${click}\n  return false;\n}\nthis.click = click;`, ctx);
  const tap = (app, run = '') => ctx.click({ closest: sel => (sel === '[data-chreconnect]' ? { dataset: { chreconnect: app, recoveryRun: run } } : null) });
  return { ...ctx, tap, listeners };
}
test('Reconnect on the card opens the Claude app at Connect when there is no saved run to recover', () => {
  const r = reconnectCard({ opens: true });
  assert.equal(r.tap('wizard-claude'), true);
  assert.equal(r.tap('wizard-chatgpt'), true);
  assert.equal(r.tap('wizard-tinfoil'), true);
  assert.deepEqual(r.opened, [['wizard-claude', '/wizard-claude/?reconnect=1'], ['wizard-chatgpt', '/wizard-chatgpt/?reconnect=1'], ['wizard-tinfoil', '/wizard-tinfoil/?connect=1']]);
  assert.deepEqual(r.assigned, []);
  // A saved run goes to the troubleshooter's recovery that re-sends it.
  r.tap('wizard-claude', 'run 1');
  assert.deepEqual(r.opened.at(-1), ['troubleshooter', '/troubleshoot/?provider=claude&run_id=run%201']);
  // No app window (WizOpenApp refuses): the page goes there itself.
  const off = reconnectCard();
  off.tap('wizard-claude');
  assert.deepEqual(off.assigned, ['/wizard-claude/?reconnect=1']);
  // A sign-in change repaints every Chats window, so cards switch between Reconnect and Retry.
  off.listeners['wos:ai-signin']();
  assert.deepEqual(off.painted, ['w1', 'w2']);
});

// Issue 1500: an expired sign-in, the desktop Errors row, the generic line above the card, the app's own sentence,
// the Anthropic API key and the doubled name.
const claudeExpired = { id: 'claude', name: 'Claude', status: 'unavailable', fetchedAt: null, limits: [],
  error: { code: 'expired', message: 'Claude sign-in has expired.' } };
const gptExpiredAccounts = { id: 'codex', name: 'ChatGPT', status: 'ok', accounts: [
  { id: 'codex:main', providerId: 'codex', providerName: 'ChatGPT', name: 'ChatGPT', status: 'unavailable', limits: [],
    error: { code: 'expired', message: 'ChatGPT sign-in needs reconnecting.' } }] };

test('issue 1500: an expired sign-in (whole family or per account) gets Reconnect, not Retry', () => {
  const b = boot(); b.set([claudeExpired, gptExpiredAccounts]);
  const c = b.M.failureHtml({ s: failed(SUB), canRetry: true });
  assert.match(c, /your Claude subscription is disconnected/); assert.match(c, /Reconnect Claude/); assert.doesNotMatch(c, /data-chretry |>Retry</);
  const g = b.M.failureHtml({ s: failed('openai-codex', 'gpt-6.1-sol'), canRetry: true });
  assert.match(g, /Reconnect ChatGPT/); assert.doesNotMatch(g, /data-chretry |>Retry</);
  assert.match(b.home(), /Reconnect Claude/); assert.match(b.home(), /Reconnect ChatGPT/);
  assert.match(b.details(), /Reconnect Claude/); assert.match(b.details(), /Reconnect ChatGPT/);
  // A provider_error is not a sign-in: Retry stays.
  b.set([{ ...claudeExpired, error: { code: 'provider_error', message: 'Usage unavailable' } }]);
  assert.match(b.M.failureHtml({ s: failed(SUB), canRetry: true }), /data-chretry /);
});

test('issue 1500: no "Open the Claude app and press Connect" beside the Reconnect button; the title names Claude once', () => {
  const b = boot(); b.set([claudeOut, gptOk]);
  const d = b.details();
  assert.match(d, /Reconnect Claude/); assert.doesNotMatch(d, /press Connect|Open the Claude app/);
  const lb = /<span class="lb">([^<]*)<\/span>/.exec(b.M.failureHtml({ s: failed(SUB), canRetry: true }))[1];
  assert.equal((lb.match(/Claude/g) || []).length, 1, lb);
});

test('issue 1500: an Anthropic API-key route never shows the subscription card', () => {
  const b = boot(); b.set([claudeOut]);
  const html = b.M.failureHtml({ s: failed('anthropic'), canRetry: true });
  assert.doesNotMatch(html, /Reconnect|disconnected/); assert.match(html, /data-chretry /);
  assert.equal(b.M.signedOutFail(failed('anthropic')), null);
});

test('issue 1500: the Errors row (desktop sidebar) offers Reconnect and no Retry while signed out', () => {
  const b = boot(); b.set([claudeExpired]);
  const src = read('web/core/chat-power.js');
  const body = src.slice(src.indexOf('  function errorRow(s, rowHtml) {'), src.indexOf('  function errorsExtra() {'));
  const helpers = src.slice(src.indexOf('  const failedRoute = s =>'), src.indexOf('  function failureHtml(w, s) {'));
  // threadModel stands for the id-only lookup: with a routed id equal to a main one it reads the OTHER thread's
  // route (here a working OpenRouter model). The row's own model must win (Codex P1).
  const make = () => vm.runInNewContext(`(function(){ const esc = s => String(s ?? ''); const E = { busy: new Map() }; const M = window.WosModels;
    const retrying = new Map(); const threadModel = s => ({ model: 'glm-5.3', provider: 'openrouter' });
    ${helpers} ${body} return errorRow; })()`, b.ctx);
  const errorRow = make();
  for (const [kind, agent] of [['main', ''], ['host-ops', 'host'], ['box', 'container'], ['locked', 'restricted']]) {
    const row = errorRow({ ...failed(SUB), id: 'same-id', agent, agentKind: kind }, '<button data-chopen="same-id">row</button>');
    assert.match(row, /data-chreconnect="wizard-claude" data-recovery-run="">Reconnect Claude/, kind);
    assert.doesNotMatch(row, /data-errretry|>Retry</, kind); assert.match(row, /data-errdismiss/, kind);
  }
  // A chat another app owns (Telegram, Slack …) stays Dismiss-only: no reply can ever deliver there (Codex P2).
  b.ctx.WosModels.foreignApp = s => (s.source === 'telegram' ? 'Telegram' : '');
  const foreign = errorRow({ ...failed(SUB), source: 'telegram' }, '');
  assert.doesNotMatch(foreign, /Reconnect|data-errretry/); assert.match(foreign, /data-errdismiss/);
  b.set([claudeOk]);
  assert.match(errorRow(failed(SUB), ''), /data-errretry/);
});

// The thread body block of chats.js (failed run → turns → Reply not sent line), run with the real turnHtml.
function threadBody(s, { signedOut }) {
  const src = withParts(read('web/core/chats.js'));
  const cut = (x, y) => { const i = src.indexOf(x), j = src.indexOf(y, i); assert.ok(i >= 0 && j > i, x); return src.slice(i, j); };
  const ctx = { window: { WizConfig: { agent: () => 'Archimedes' }, WosModels: { runError: () => null, foreignApp: () => '' } }, document: {},
    PW: { workHtml: () => '', signedOutFail: () => (signedOut ? { provider: 'claude' } : null) }, replyCard: () => '', userMedia: () => '', md: x => x, timeTag: () => '',
    summaryOf: () => null, mediaBlock: () => '', regenOn: () => false, esc: x => x, quoteBtn: () => '', msgIds: () => '', COPY_SVG: '', SHARE_SVG: '', CHECK_SVG: '',
    KIT: { time: { dayKey: () => '', day: () => '' } }, turnAt: () => 1, approvalHtml: () => '', pend: [], pendingHtml: () => '', held: false, STI: {}, isNew: false, w: { id: 'w', thread: 't' }, TAG: '' };
  vm.createContext(ctx);
  vm.runInContext(read('web/core/chat-kit.js'), ctx);
  vm.runInContext(cut('function runContextHtml(', 'const turnAt ='), ctx);
  const turns = ctx.window.WosChat.parseRows([{ role: 'user', content: 'What is virtue?', timestamp: 1 },
    { role: 'assistant', content: 'Your request was not processed. Send it again if you still want me to carry it out.', timestamp: 2 }]);
  assert.equal(turns.at(-1).a.failed, true);
  Object.assign(ctx, { s, working: false, c: { texts: [], media: [] }, all: turns, from: 0, shown: turns, day: '' });
  return vm.runInContext(`let msgs;\n${cut('      const runErr = !working', '    }\n    // The Daily view')}msgs`, ctx);
}
test('issue 1500: the generic "not processed… send it again" line is hidden above a Reconnect card', () => {
  const s = { id: 't', status: 'failed', safeError: 'Claude is not signed in.' };
  const out = threadBody(s, { signedOut: true });
  assert.match(out, /What is virtue\?/, 'his message stays');
  assert.doesNotMatch(out, /not processed|Send it again/, 'no generic failed bubble');
  assert.doesNotMatch(out, /Reply not sent/, 'no duplicate Reply not sent line');
  // A failure that is not a sign-out keeps both.
  const plain = threadBody(s, { signedOut: false });
  assert.match(plain, /not processed/);
  assert.match(plain, /<b>Reply not sent<\/b><p>Claude is not signed in\.<\/p>/);
});

test('issue 1500: Hermes\' plain-text failure boundary (older Hermes, no display_kind) is marked like failed_turn', () => {
  const ctx = { location: { origin: 'https://w.example', hostname: 'w.example', href: 'https://w.example/' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {}, document: { addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) }, addEventListener() {}, setTimeout, clearTimeout, console, URL, Intl, Date };
  ctx.window = ctx;
  vm.runInNewContext(read('web/core/chat-kit.js'), ctx);
  const KIT = ctx.WosChat;
  const rows = text => [{ role: 'user', content: 'What is virtue?', timestamp: 1 }, { role: 'assistant', content: text, timestamp: 2 }];
  assert.equal(KIT.parseRows(rows('Your request was not processed. Send it again if you still want me to carry it out.')).at(-1).a.failed, true);
  assert.equal(KIT.parseRows(rows('Virtue is a settled habit.')).at(-1).a.failed, undefined);
});
