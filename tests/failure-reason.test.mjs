// Regression (wizard-ux#166): an expired ChatGPT subscription showed "Error: <your message>" in Chats > Errors and
// Hermes' generic "Your request was not processed." in the thread. When the Agent Service names the reason
// (wizard_last_run_error), the off-by-default wizard/failure-reason tweak says it plainly and orders the ways out.
// Run: node --test tests/failure-reason.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { modelContext } from './fixtures/chats-list-model.mjs';
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)
import { withParts } from './fixtures/chats-parts.mjs';
import { between, runRecording } from './fixtures/source-slice.mjs';
import { lookBox } from './fixtures/r5A-experience.mjs';
import { onSkin } from './fixtures/w5-css.mjs'; // chats.js parts moved out verbatim (issue 1665)

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const TWEAK = 'wizard/failure-reason';

function models(tweaks = TWEAK) {
  const window = { WosAgents: { lock: () => '' } };
  const document = { documentElement: { dataset: { tweaks } } };
  vm.runInContext(read('web/core/chat-models.js'), modelContext({ window, document, localStorage: { getItem: () => null, setItem() {} }, fetch: async () => ({}), console }));
  return window.WosModels;
}
function runErrorOf() {
  const src = withLiveParts(read('web/live.js'));
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
  // Detail and compact rows through the real normalize(): 'main and routed threads (host-profile, container,
  // restricted) carry and render the same reason' below.
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

// The Errors row's preview line (core/chats-rows.js) and the failed thread's turns and notice (core/chats-threadpaint.js),
// cut from the real chats.js (parts put back) and run with the real WosModels.
function rowPreview(M, s) {
  const chats = withParts(read('web/core/chats.js'));
  const code = between(chats, '    const rerr = needs && !working', '    const priv = privRow(s)');
  const ctx = runRecording(code + '\nthis.pv = pv;', { window: { WosModels: M }, s, needs: true, working: false, trackedAsk: false, at: null, A: null, def: false,
    lab: '<em class="att error">Error:</em> ', esc: String, clip: x => x, LIVE: {}, globalThis: {} });
  return ctx.pv;
}
function threadMsgs(M, s) {
  const chats = withParts(read('web/core/chats.js'));
  const code = between(chats, '      const runErr = !working && !!window.WosModels?.runError?.(s);', '\n    }\n    // The Daily view');
  const turns = [];
  const ctx = runRecording('let msgs;\n' + code + '\nthis.msgs = msgs;', { window: { WosModels: M }, s, working: false, held: false, pend: [], shown: [{ u: { text: 'How is your day' } }], all: [], from: 0,
    c: { show: 20 }, isNew: false, w: { id: 'w1', thread: s.id }, TAG: '', esc: String, PW: null, needsMark: undefined, replyStd: undefined, turnAt: () => 0, KIT: { time: { dayKey: () => '', day: () => '' } },
    turnHtml: (c, tn, last, working, helper, quiet) => { turns.push(quiet); return `<div class="turn">${quiet ? '' : '<div class="failed_turn">Your request was not processed.</div>'}</div>`; },
    approvalHtml: () => '', pendingHtml: () => '', STI: {}, globalThis: {} });
  return { html: ctx.msgs, quiet: turns };
}

test('Errors row and thread use the reason in place of "Error: <message>" and the generic failed_turn bubble', async () => {
  const s = failed('provider_billing', { safeError: 'Your request was not processed.' });
  const on = models(), off = models('');
  const line = on.runError(s).line;
  assert.match(line, /ChatGPT/);
  // The row: the reason, not "Error: <your message>"; without the tweak, the old line.
  assert.equal(rowPreview(on, s), line);
  assert.equal(rowPreview(off, s), '<em class="att error">Error:</em> How is your day');
  // The thread: the reason quiets the generic failed_turn bubble and the duplicate "Reply not sent" notice.
  const t = threadMsgs(on, s);
  assert.deepEqual(t.quiet, [true]); assert.doesNotMatch(t.html, /failed_turn|Reply not sent/);
  const o = threadMsgs(off, s);
  assert.deepEqual(o.quiet, [false]); assert.match(o.html, /<b>Reply not sent<\/b><p>Your request was not processed\.<\/p>/);
  // The switch: listed, its own id, its CSS scoped to it.
  const tw = 'web/tweaks/wizard/failure-reason/';
  // (its manifest id matches its folder: the repo-wide tweak lint, tests/fixtures/tweak-lint.mjs)
  // The real Settings › Look switch list (core/experience.js) on the real catalog: listed, off.
  const box = await lookBox(), row = box.row(TWEAK);
  assert.ok(row, 'Settings › Look lists the switch'); assert.equal(row.on, false, 'off by default'); assert.ok(!box.active().includes(TWEAK));
  const css = read(tw + 'tweak.css');
  const label = attrs => onSkin([css], '.ch-fail.reason .lb', { skin: '', attrs })['text-transform'];
  assert.equal(label({ 'data-tweaks': 'wizard/desktop-chats wizard/failure-reason' }), 'none', 'the reason label, with the switch on');
  assert.equal(label({ 'data-tweaks': 'wizard/desktop-chats' }), undefined, 'nothing without it');
});

// Agent chat parity (AGENTS.md): the same failed run on the main agent and on a routed host-profile, container and
// restricted agent normalizes through the real live.js normalize() (detail rows and compact list rows) and renders
// the same reason and actions.
function normalizer() {
  const live = withLiveParts(read('web/live.js')), a = live.indexOf('  const READY_OR_ATTENTION'), b = live.indexOf('  /* ---- thread-seen');
  const context = modelContext({}); vm.runInContext(`${live.slice(a, b)}\nthis.normalize = normalize;`, context);
  return context.normalize;
}
const ERR = { code: 'provider_billing', provider: 'openai-codex', message: 'Your ChatGPT plan has ended.' };
const detailRow = agent => ({ id: `s-${agent || 'main'}`, title: 'How is your day', status: 'failed', wizard_last_run_status: 'failed', model: 'gpt-6-sol', provider: 'openai-codex',
  last_user_message: { role: 'user', content: 'How is your day' }, wizard_last_run_error: ERR, ...(agent ? { agent } : {}) });
const compactRow = agent => ({ listVersion: 1, id: `s-${agent || 'main'}`, title: 'How is your day', status: 'failed', runId: '', lastRunStatus: 'failed', model: 'gpt-6-sol', provider: 'openai-codex',
  preview: 'How is your day', agent: agent || '', runError: ERR });

test('main and routed threads (host-profile, container, restricted) carry and render the same reason', () => {
  const normalize = normalizer(), M = models();
  const render = s => { const r = M.runError(s); return { line: r?.line, buttons: buttons(M.failureHtml({ s, busy: '', canRetry: true })) }; };
  const main = render(normalize(detailRow('')));
  assert.deepEqual(main, { line: 'ChatGPT isn’t available: subscription ended', buttons: ['Choose another model', 'Retry', 'Dismiss'] });
  for (const kind of ['host-profile', 'container', 'restricted']) {
    const d = normalize(detailRow(kind)), c = normalize(compactRow(kind));
    assert.equal(d.agent, kind); assert.equal(c.agent, kind);
    assert.deepEqual({ ...d.runError }, { ...ERR }, `${kind} detail`);
    assert.deepEqual({ ...c.runError }, { ...ERR }, `${kind} compact`);
    assert.deepEqual(render(d), main, `${kind} detail render`);
    assert.deepEqual(render(c), main, `${kind} compact render`);
  }
  // A compact row is data too: an unknown code is dropped, never rendered.
  assert.equal(normalize({ ...compactRow('container'), runError: { code: 'evil', message: '<b>x</b>' } }).runError, null);
  assert.equal(normalize({ ...detailRow('restricted'), wizard_last_run_error: { code: 'evil' } }).runError, null);
});
