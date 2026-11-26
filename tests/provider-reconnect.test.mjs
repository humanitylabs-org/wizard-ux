import { modelContext, runWithChatsModel } from './fixtures/chats-list-model.mjs';
// Regression (20 Oct 2026): Opus failed because the Claude sign-in had expired, and the thread only showed
// Hermes' generic "Your request was not processed." with a Retry that can't work. The Agent Service now names the
// connection app (wizard_reconnect); the failed-thread panel says so plainly and opens that app.
// Run: node --test tests/provider-reconnect.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)
import { between, block, runRecording } from './fixtures/source-slice.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const FIELD = { kind: 'provider_signed_out', provider: 'claude', app_id: 'wizard-claude', app_name: 'Claude', installed: true, app_status: 'expired' };

function models() {
  const window = { WosAgents: { lock: () => '' } };
  vm.runInContext(read('web/core/chat-models.js'), modelContext({ window, localStorage: { getItem: () => null, setItem() {} }, fetch: async () => ({}), console }));
  return window.WosModels;
}
function kit() {
  const ctx = { location: { origin: 'https://w.example', hostname: 'w.example', href: 'https://w.example/wizard-os-home/' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, navigator: {},
    document: { addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) },
    addEventListener() {}, setTimeout, clearTimeout, console, URL, Intl, Date };
  ctx.window = ctx; modelContext(ctx); vm.runInContext(read('web/core/chat-kit.js'), ctx);
  return ctx.WosChat;
}
function live() {
  const src = withLiveParts(read('web/live.js'));
  // normalize() is internal; lift reconnectOf the way it is defined there and prove the field shapes.
  const body = src.slice(src.indexOf('  const RECONNECT = {'), src.indexOf('  const ATTN = new Set('));
  return new Function(`${body}; return reconnectOf;`)();
}

test('live.js keeps only the known connection apps from wizard_reconnect', () => {
  const reconnectOf = live();
  assert.deepEqual({ ...reconnectOf(FIELD) }, { provider: 'claude', appId: 'wizard-claude', name: 'Claude', runId: '', installed: true, appStatus: 'expired' });
  assert.deepEqual({ ...reconnectOf({ ...FIELD, provider: 'chatgpt', app_id: 'wizard-chatgpt', installed: false }) }, { provider: 'chatgpt', appId: 'wizard-chatgpt', name: 'ChatGPT', runId: '', installed: false, appStatus: 'expired' });
  for (const bad of [null, {}, { ...FIELD, app_id: 'evil' }, { ...FIELD, kind: 'x' }, { ...FIELD, provider: 'tinfoil' }]) assert.equal(reconnectOf(bad), null);
  // The real normalize() (live-seen.js) puts it on the session the panel reads.
  const lv = withLiveParts(read('web/live.js')), a = lv.indexOf('  const READY_OR_ATTENTION'), b = lv.indexOf('  /* ---- thread-seen');
  const nc = modelContext({}); vm.runInContext(`${lv.slice(a, b)}\nthis.normalize = normalize;`, nc);
  const row = extra => ({ id: 's1', title: 'Plan', status: 'failed', last_user_message: { role: 'user', content: 'Plan my week' }, ...extra });
  assert.deepEqual({ ...nc.normalize(row({ wizard_reconnect: FIELD })).reconnect }, { provider: 'claude', appId: 'wizard-claude', name: 'Claude', runId: '', installed: true, appStatus: 'expired' });
  assert.equal(nc.normalize(row({ wizard_reconnect: { ...FIELD, app_id: 'evil' } })).reconnect, null);
  assert.equal(nc.normalize(row({})).reconnect, null);
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
  // The tap's real openReconnect (chat-power.js): a saved run goes to the troubleshooter's focused repair, in the app
  // window when there is one, else as a link; only the known connection apps.
  const power = read('web/core/chat-power.js');
  const open = opens => {
    const opened = [], links = [], assigned = [];
    const r = runRecording(between(power, '  const RECONNECT_APPS = ', '  // Issue 1488:') + '\nthis.openReconnect = openReconnect;',
      { window: { WizOpenApp: (...x) => (opened.push(x), opens) }, H: { openLink: (...x) => (links.push(x), true) }, location: { assign: x => assigned.push(x) } });
    return { go: (...x) => r.openReconnect(...x), opened, links, assigned };
  };
  const inApp = open(true);
  assert.equal(inApp.go('wizard-chatgpt', false, 'run 7'), true);
  assert.deepEqual(inApp.opened, [['troubleshooter', '/troubleshoot/?provider=chatgpt&run_id=run%207']]);
  const noApp = open(false);
  assert.equal(noApp.go('wizard-chatgpt', false, 'run 7'), true);
  assert.deepEqual(noApp.links, [['/troubleshoot/?provider=chatgpt&run_id=run%207', 'Fix Wizard']], 'no app window: the same repair as a link');
  const evil = open(true);
  assert.equal(evil.go('wizard-evil', true, 'run 7'), false); assert.deepEqual([evil.opened, evil.links, evil.assigned], [[], [], []], 'an unknown app opens nothing');
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
  const chats = withParts(read('web/core/chats.js'));
  // The real turnHtml: the last failed turn loses Hermes' notice only when a reconnect panel stands in for it.
  const turn = runRecording(block(chats, '  function turnHtml(') + '\nthis.turnHtml = turnHtml;', { esc: String, md: x => String(x ?? ''), PW: null, summaryOf: () => null, msgIds: () => '', timeTag: () => '', userMedia: () => '', replyCard: () => '' });
  const notice = turns[0].a.text || turns[0].a.content || 'not processed';
  const paint = (last, reconnect) => String(turn.turnHtml({ texts: [] }, { media: [], notes: [], ...turns[0], a: { ...turns[0].a, text: notice, content: notice } }, last, false, '', reconnect, false, ''));
  assert.doesNotMatch(paint(true, true), /not processed/, 'replaced by the reconnect panel');
  assert.match(paint(true, false), /not processed/, 'kept without a reconnect panel');
  assert.match(paint(false, true), /not processed/, 'an older failed turn keeps it');
  // The real thread paint: the session's reconnect quiets the last turn and the generic Reply not sent notice.
  const M = models();
  const thread = sess => {
    const quiet = [];
    const code = between(chats, '      const runErr = !working && !!window.WosModels?.runError?.(s);', '\n    }\n    // The Daily view');
    const r = runRecording('let msgs;\n' + code + '\nthis.msgs = msgs;', { window: { WosModels: M }, s: sess, working: false, held: false, pend: [], shown: [{ u: { text: 'Plan my week' } }], all: [], from: 0,
      c: { show: 20 }, isNew: false, w: { id: 'w1', thread: sess.id }, TAG: '', esc: String, PW: null, needsMark: undefined, replyStd: undefined, turnAt: () => 0, KIT: { time: { dayKey: () => '', day: () => '' } },
      turnHtml: (c, tn, last, working, helper, q) => { quiet.push(!!q); return '<div class="turn"></div>'; }, approvalHtml: () => '', pendingHtml: () => '', STI: {}, globalThis: {} });
    return { html: r.msgs, quiet };
  };
  const safeError = 'Your request was not processed.';
  const rc = thread({ id: 's1', status: 'failed', safeError, reconnect: { provider: 'claude', appId: 'wizard-claude', name: 'Claude', installed: true } });
  assert.deepEqual(rc.quiet, [true]); assert.doesNotMatch(rc.html, /Reply not sent/);
  const plain = thread({ id: 's1', status: 'failed', safeError });
  assert.deepEqual(plain.quiet, [false]); assert.match(plain.html, /<b>Reply not sent<\/b><p>Your request was not processed\.<\/p>/);
  assert.doesNotMatch(thread({ id: 's1', status: 'failed', safeError, queueReason: 'provider_access' }).html, /Reply not sent/, 'provider access has its own card');
});

test('the reconnect click is handled before Retry in the panel and in Errors rows', async () => {
  const power = read('web/core/chat-power.js');
  const { block, runRecording } = await import('./fixtures/source-slice.mjs');
  // (the panel's data-chreconnect button: 'a diagnosed sign-in failure shows Sign in, not Retry' renders it)
  const sign = { dataset: { chreconnect: 'wizard-claude', recoveryRun: 'run_1' } };
  // the click (real chat-power click): a press on Sign in inside a panel that also has Retry opens the app, never retries
  const click = runRecording(block(power, '  function click(e, id) {') + '\nglobalThis.click = click;', { H: { win: () => ({ id: 'w1', thread: 't1' }) }, A: { owner: id => id }, W: {} });
  const nest = { closest: sel => (sel === '[data-chreconnect]' ? sign : sel === '[data-chretry]' || sel === '[data-errretry]' ? { dataset: { errretry: 't1' } } : null) };
  click.calls.length = 0;
  click.click({ target: nest, preventDefault() {}, stopPropagation() {} }, 'w1');
  const did = click.calls.map(c => c[0]).filter(n => n === 'openReconnect' || n === 'retryThread');
  assert.deepEqual(did, ['openReconnect'], 'reconnect wins over Retry');
  assert.deepEqual(JSON.parse(JSON.stringify(click.calls.find(c => c[0] === 'openReconnect'))), ['openReconnect', 'wizard-claude', true, 'run_1']);
});
