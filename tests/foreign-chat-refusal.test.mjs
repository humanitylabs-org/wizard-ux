// Regression (wizard-ux issue 1235): replying in WizardOS to a chat started on Telegram showed "Not sent · message
// saved" with Retry plus a "Needs retry" panel (Retry / Choose another model / Dismiss), and the clear "started in
// another app" card only came about a minute later. Hermes refuses every reply into a chat another app owns
// (permission_denied: gateway/session_api_turn.py takes API turns only for api_server and bot_room sessions), so
// the refusal is final: the clear card shows at once, with no Retry anywhere, and the reply box says it up front.
// Run: node --test tests/foreign-chat-refusal.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { modelContext } from './fixtures/chats-list-model.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)
import { block, expression, runRecording } from './fixtures/source-slice.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
function models(tweaks = '') {
  const window = { WosAgents: { lock: () => '' } };
  const document = { documentElement: { dataset: { tweaks } } };
  vm.runInContext(read('web/core/chat-models.js'), modelContext({ window, document, localStorage: { getItem: () => null, setItem() {} }, fetch: async () => ({}), console }));
  return window.WosModels;
}
function normalizer() {
  const live = withLiveParts(read('web/live.js')), a = live.indexOf('  const READY_OR_ATTENTION'), b = live.indexOf('  /* ---- thread-seen');
  const context = modelContext({}); vm.runInContext(`${live.slice(a, b)}\nthis.normalize = normalize;`, context);
  return context.normalize;
}

test('a chat started in a messaging app is named; WizardOS chats are not', () => {
  const M = models();
  assert.equal(M.foreignApp({ source: 'telegram' }), 'Telegram');
  assert.equal(M.foreignApp({ source: 'Slack' }), 'Slack');
  assert.equal(M.foreignApp({ source: 'whatsapp_cloud' }), 'WhatsApp');
  for (const source of ['', 'api_server', 'bot_room', 'wizard-mobile', 'cron', 'webhook', 'toString', '__proto__', undefined, 7])
    assert.equal(M.foreignApp({ source }), '', String(source));
  assert.equal(M.foreignApp(null), '');
  assert.equal(M.refusal({ source: 'telegram' }), 'This chat was started in Telegram, so WizardOS can’t add to it. Your message is saved. Reply in Telegram, or start a new chat.');
  assert.equal(M.refusal({ source: 'api_server' }), '');
});

// wizard-agent-service issue 427: with the switch on, the Service sends the reply through the chat's own connection, so
// the chat takes replies (and Retry) like any other. Hermes' own refusal (an older chat on a Hermes that refuses API
// turns into it, the Service's "started in another app" words) still gets the clear card with no Retry.
test('switch wizard/messaging-chat-replies on: messaging chats take replies; a refusal still says so', () => {
  const M = models('wizard/unified-inbox wizard/messaging-chat-replies');
  assert.equal(M.foreignApp({ source: 'telegram' }), '');
  assert.equal(M.foreignApp({ source: 'slack', status: 'failed', safeError: 'The AI provider couldn’t answer' }), '');
  assert.equal(M.refusal({ source: 'telegram' }), '');
  const refused = { source: 'telegram', status: 'failed', safeError: 'This chat was started in another app, such as Telegram, so WizardOS can’t add to it. Your message is saved. Reply in that app, or start a new chat.' };
  assert.equal(M.foreignApp(refused), 'Telegram');
  assert.match(M.refusal(refused), /started in Telegram/);
  // Off (or another switch only): exactly as before.
  assert.equal(models('wizard/unified-inbox').foreignApp({ source: 'telegram' }), 'Telegram');
  // Main and routed threads (host-profile, container, restricted agents) follow the same rule: the decision reads the
  // chat's Hermes source and the Service's refusal words, never the agent, and the Service sends every kind's reply
  // through its own route (wizard-agent-service parity check messaging-chat-replies covers all four kinds).
  for (const agent of [undefined, 'hermes', 'host-research', 'container-research', 'restricted-research']) {
    assert.equal(M.foreignApp({ agent, source: 'telegram' }), '', String(agent));
    assert.equal(M.foreignApp({ agent, source: 'api_server' }), '', String(agent));
    assert.equal(M.foreignApp({ agent, ...refused }), 'Telegram', String(agent));
    assert.equal(models().foreignApp({ agent, source: 'telegram' }), 'Telegram', String(agent));
  }
});

test('switch on: a routed Telegram thread offers Retry and its Retry sends again', async () => {
  const M = models('wizard/messaging-chat-replies'), power = read('web/core/chat-power.js');
  for (const agent of ['hermes', 'host-research', 'container-research', 'restricted-research']) {
    const s = { id: `tg-${agent}`, agent, title: 'From Telegram', source: 'telegram', status: 'failed' };
    const rows = runRecording(block(power, '  function errorRow('), { M, E: { busy: new Map() }, esc: String, signedOutFail: () => null });
    assert.match(vm.runInContext('errorRow', rows)(s, '<row>'), new RegExp(`data-errretry="tg-${agent}"`), agent);
    const toasts = [];
    const retry = runRecording(block(power, '  async function retryThread('), { M, LIVE: { session: id => (id === s.id ? s : null) },
      OUTBOX: { unsent: () => [], retry: () => true, send: () => true }, toast: (...a) => toasts.push(a), retrying: new Map() });
    await vm.runInContext('retryThread', retry)('w', s.id, {});
    assert.ok(!toasts.some(t => /lives in Telegram/.test(t[1])), `${agent}: Retry is not refused`);
  }
});

test('the list row keeps the Hermes session source the shell decides on', () => {
  const row = normalizer()({ id: 'tg1', title: 'From Telegram', source: 'telegram', status: 'failed', updated_at: '2026-11-10T00:00:00Z' });
  assert.equal(row.source, 'telegram');
});

const TG = { id: 't1', title: 'From Telegram', source: 'telegram', status: 'failed' }, OWN = { id: 'w1', title: 'Mine', source: 'api_server', status: 'failed' };

test('no Needs retry panel, no Errors-list Retry, and Retry itself refuses in such a chat', async () => {
  const M = models(), power = read('web/core/chat-power.js');
  // The thread's Needs retry panel (failureHtml, with the route helpers it reads).
  const fail = runRecording(power.slice(power.indexOf('  const failedRoute'), power.indexOf('  function failureHtml(')) + block(power, '  function failureHtml('),
    { M, failedShown: () => true, retrying: new Map(), E: { busy: new Map() }, esc: String });
  const failureHtml = vm.runInContext('failureHtml', fail);
  assert.equal(failureHtml({ id: 'w' }, TG), '', 'no Needs retry panel in a Telegram chat');
  assert.match(failureHtml({ id: 'w' }, OWN), /Needs retry/, 'a WizardOS chat still gets it');
  // The Errors list row: Dismiss only.
  const rows = runRecording(block(power, '  function errorRow('), { M, E: { busy: new Map() }, esc: String, signedOutFail: () => null });
  const errorRow = vm.runInContext('errorRow', rows);
  const foreignRow = errorRow(TG, '<row>');
  assert.match(foreignRow, /data-errdismiss="t1"/);
  assert.doesNotMatch(foreignRow, /data-errretry/);
  assert.match(errorRow(OWN, '<row>'), /data-errretry="w1"/);
  // Retry itself: refuses with the clear words and sends nothing.
  const toasts = [], sends = [];
  const retry = runRecording(block(power, '  async function retryThread('), { M, LIVE: { session: id => (id === 't1' ? TG : null) },
    OUTBOX: { unsent: () => [], retry: (...a) => sends.push(a), send: (...a) => sends.push(a) }, toast: (...a) => toasts.push(a), retrying: new Map() });
  assert.equal(await vm.runInContext('retryThread', retry)('w', 't1', {}), false);
  assert.deepEqual(toasts, [['!', 'This chat lives in Telegram · reply there', 2600]]);
  assert.deepEqual(sends, []);
});

test('the thread shows the clear card at once, with Dismiss and without Retry; the reply box says it up front', () => {
  const M = models(), paint = read('web/core/chats-threadpaint.js'), outbox = read('web/core/chats-outbox.js');
  // Refused as soon as the thread failed or a message is marked Not sent, not only once the Service's words arrive.
  const decide = paint.slice(paint.indexOf('      const foreign = window.WosModels?.foreignApp?.(s)'), paint.indexOf('      // Renames show where they happened'));
  const run = (s, shown = [], working = false) => {
    const c = {}; const r = runRecording(`${decide}\nthis.out = { refused, retryRunId: c.retryRunId };`, { window: { WosModels: M }, s, shown, working, c });
    return { ...r.out };
  };
  assert.deepEqual(run({ ...TG, retryRunId: 'q1' }), { refused: true, retryRunId: '' }, 'failed: refused at once; the Not sent Retry has no run');
  assert.equal(run({ ...TG, status: 'idle' }, [{ u: { queue: { status: 'failed' } } }]).refused, true, 'a Not sent message is enough');
  assert.equal(run({ ...TG, status: 'idle', safeError: 'x' }).refused, true);
  assert.equal(run({ ...TG, status: 'idle' }).refused, false, 'nothing failed: no card');
  assert.equal(run(TG, [], true).refused, false, 'not while it works');
  assert.deepEqual(run({ ...OWN, retryRunId: 'q1' }), { refused: false, retryRunId: 'q1' }, 'a WizardOS chat keeps its Retry');
  // The card itself: the refusal words and Dismiss; refused wins over the generic Reply not sent card.
  const cardSrc = paint.slice(paint.indexOf('(refused ? `'), paint.indexOf('\n        + approvalHtml(c, s)'));
  const card = (s, refused) => runRecording(`this.out = ${cardSrc};`, { window: { WosModels: M }, esc: String, s, refused, runErr: false, signedOut: false }).out;
  const shown = card({ ...TG, safeError: 'Generic words' }, true);
  assert.equal(shown, `<div class="appr" role="status" data-chrefused><b>Reply not sent</b><p>${M.refusal(TG)}</p><div class="appr-b"><button type="button" class="no" data-chdismiss>Dismiss</button></div></div>`);
  assert.doesNotMatch(shown, /data-chretry|Choose another model|Generic words/, 'no second, generic Reply not sent card beside it');
  assert.match(card({ ...OWN, safeError: 'Generic words' }, false), /<b>Reply not sent<\/b><p>Generic words<\/p>/);
  // The reply box says it up front.
  const ph = expression(paint, '${!isNew && window.WosModels?.foreignApp?.(s)');
  const place = (s, isNew = false) => runRecording(`this.out = \`${ph}\`;`, { window: { WosModels: M }, esc: String, s, isNew }).out;
  assert.match(place(TG), /^This chat lives in Telegram · reply there/);
  assert.doesNotMatch(place(OWN), /This chat lives in/);
  // A pending Not sent line in the thread offers no Retry for such a chat.
  const pendSrc = outbox.slice(outbox.indexOf("    if (p.state === 'failed') return `"), outbox.indexOf('\n', outbox.indexOf("    if (p.state === 'failed') return `")));
  const pend = s => runRecording(`this.out = (() => { ${pendSrc} })();`, { window: { WosModels: M }, esc: String, s, p: { id: 'o1', state: 'failed', error: 'x' }, OUTBOX: { canRetry: () => true }, recover: '' }).out;
  assert.doesNotMatch(pend(TG), /data-obretry/);
  assert.match(pend(OWN), /data-obretry="o1"/);
});

test('a Not sent bubble without a retry run shows no Retry button (what a foreign chat gets)', () => {
  const src = withParts(read('web/core/chats.js'));
  const fn = src.slice(src.indexOf('  function turnHtml('), src.indexOf('    else if (tn.note) h += noteHtml(tn.note);'));
  const ctx = { replyCard: () => '', userMedia: () => '', md: s => s, timeTag: () => '', quoteBtn: () => '', msgIds: () => '' };
  vm.runInNewContext(`${fn} return h; }; this.turnHtml = turnHtml;`, ctx);
  const tn = { u: { text: 'hi', at: 1, queue: { status: 'failed', runId: 'wizardq_1' } } };
  assert.match(ctx.turnHtml({ retryRunId: '' }, tn, true), /Not sent · message saved/);
  assert.doesNotMatch(ctx.turnHtml({ retryRunId: '' }, tn, true), /data-chretry/);
  assert.match(ctx.turnHtml({ retryRunId: 'wizardq_1' }, tn, true), /data-chretry/);
});

test('a routed agent thread from Telegram is refused the same way: the decision reads only the session source', () => {
  const M = models();
  assert.equal(M.foreignApp({ id: 'r1', agent: 'research', source: 'telegram' }), 'Telegram');
  assert.equal(M.foreignApp({ id: 'r2', agent: 'research', source: 'api_server' }), '');
  assert.equal(M.refusal({ agent: 'research', source: 'slack' }), M.refusal({ source: 'slack' }));
});

test('the chat-list send pill offers no Retry for a failed reply into such a chat', () => {
  const M = models(), drafts = read('web/core/chats-drafts.js');
  const sessions = { t1: TG, w1: OWN };
  const pill = items => runRecording(`${block(drafts, '  function sendPill(')}\nthis.out = sendPill(items, { id: 'w' });`, {
    window: { WosModels: M }, esc: String, clip: v => v, ch: () => ({}), LIVE: { ok: true, session: id => sessions[id] },
    OUTBOX: { get: () => null, quarantined: () => false, canRetry: () => true }, troubleshoot: '', items }).out;
  const item = (id, sessionId) => ({ id, kind: 'reply', sessionId, state: 'failed', text: 'hi' });
  assert.doesNotMatch(pill([item('o1', 't1')]), /data-obretry/, 'one failed reply into Telegram: no Retry');
  assert.match(pill([item('o1', 'w1')]), /data-obretry="o1"/, 'a WizardOS chat keeps Retry');
  assert.doesNotMatch(pill([item('o1', 't1'), item('o2', 't1')]), /data-obretryall/, 'all foreign: no Retry all');
  assert.match(pill([item('o1', 't1'), item('o2', 'w1')]), /data-obretryall>Retry all<\/button>/);
});
