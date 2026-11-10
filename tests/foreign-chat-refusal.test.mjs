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

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
function models() {
  const window = { WosAgents: { lock: () => '' } };
  const document = { documentElement: { dataset: { tweaks: '' } } };
  vm.runInContext(read('web/core/chat-models.js'), modelContext({ window, document, localStorage: { getItem: () => null, setItem() {} }, fetch: async () => ({}), console }));
  return window.WosModels;
}
function normalizer() {
  const live = read('web/live.js'), a = live.indexOf('  const READY_OR_ATTENTION'), b = live.indexOf('  /* ---- thread-seen');
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

test('the list row keeps the Hermes session source the shell decides on', () => {
  const row = normalizer()({ id: 'tg1', title: 'From Telegram', source: 'telegram', status: 'failed', updated_at: '2026-11-10T00:00:00Z' });
  assert.equal(row.source, 'telegram');
});

test('no Needs retry panel, no Errors-list Retry, and Retry itself refuses in such a chat', () => {
  const power = read('web/core/chat-power.js');
  assert.match(power, /if \(!M \|\| !failedShown\(s\) \|\| M\.foreignApp\?\.\(s\)\) return '';/);
  assert.match(power, /let s = LIVE\.session\(sid\); if \(!s \|\| !OUTBOX\) return false;\n.*\n    if \(M\?\.foreignApp\?\.\(s\)\) \{ toast\(.*\); return false; \}$/m);
  const row = power.slice(power.indexOf('function errorRow('), power.indexOf('function errorsExtra('));
  const foreignRow = row.slice(row.indexOf('M?.foreignApp?.(s)'), row.indexOf('\n', row.indexOf('M?.foreignApp?.(s)')));
  assert.match(foreignRow, /data-errdismiss/);
  assert.doesNotMatch(foreignRow, /data-errretry/);
});

test('the thread shows the clear card at once, with Dismiss and without Retry; the reply box says it up front', () => {
  const chats = read('web/core/chats.js');
  // Refused as soon as the thread failed or a message is marked Not sent, not only once the Service's words arrive.
  assert.match(chats, /const refused = !working && !!foreign && \(\['failed', 'interrupted'\]\.includes\(s\?\.status\) \|\| !!s\?\.safeError\n\s*\|\| shown\.some\(tn => \['failed', 'interrupted'\]\.includes\(tn\.u\?\.queue\?\.status\)\)\);/);
  // The Not sent bubble's Retry needs c.retryRunId, which a foreign chat never gets.
  assert.match(chats, /c\.retryRunId = !working && !foreign && s\?\.retryRunId \|\| '';/);
  const card = chats.slice(chats.indexOf('+ (refused ?'), chats.indexOf('+ approvalHtml(c, s)'));
  assert.match(card, /<b>Reply not sent<\/b><p>\$\{esc\(window\.WosModels\.refusal\(s\)\)\}<\/p>/);
  assert.match(card, /data-chdismiss>Dismiss/);
  assert.doesNotMatch(card.slice(0, card.indexOf(': (!runErr')), /data-chretry|Choose another model/);
  assert.match(card, /: \(!runErr && s\?\.safeError && !s\?\.reconnect && !foreign && /, 'no second, generic Reply not sent card beside it');
  assert.match(chats, /placeholder="\$\{!isNew && window\.WosModels\?\.foreignApp\?\.\(s\) \? `This chat lives in \$\{esc\(window\.WosModels\.foreignApp\(s\)\)\} · reply there`/);
  assert.match(chats, /if \(p\.state === 'failed'\) return `[^`]*\$\{OUTBOX\.canRetry\(p\) && !window\.WosModels\?\.foreignApp\?\.\(s\) \?/);
});

test('a Not sent bubble without a retry run shows no Retry button (what a foreign chat gets)', () => {
  const src = read('web/core/chats.js');
  const fn = src.slice(src.indexOf('  function turnHtml('), src.indexOf('    else if (tn.note) h += noteHtml(tn.note);'));
  const ctx = { replyCard: () => '', userMedia: () => '', md: s => s, timeTag: () => '', quoteBtn: () => '', msgIds: () => '' };
  vm.runInNewContext(`${fn} return h; }; this.turnHtml = turnHtml;`, ctx);
  const tn = { u: { text: 'hi', at: 1, queue: { status: 'failed', runId: 'wizardq_1' } } };
  assert.match(ctx.turnHtml({ retryRunId: '' }, tn, true), /Not sent · message saved/);
  assert.doesNotMatch(ctx.turnHtml({ retryRunId: '' }, tn, true), /data-chretry/);
  assert.match(ctx.turnHtml({ retryRunId: 'wizardq_1' }, tn, true), /data-chretry/);
});
