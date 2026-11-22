import { modelContext, runWithChatsModel } from './fixtures/chats-list-model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)
import { withParts } from './fixtures/chats-parts.mjs';
import { between, block, runRecording } from './fixtures/source-slice.mjs';
const chats = withParts(fs.readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
const css = fs.readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8');
const live = withLiveParts(fs.readFileSync(new URL('../web/live.js', import.meta.url), 'utf8'));
// James, 7 Nov 2026: the 'Helper still working' pill is gone everywhere; the Working spinner already shows it.
test('no helper badge on any row, and its pill styling is gone', () => {
  assert.doesNotMatch(chats, /backgroundBadge|Helper still working/);
  assert.doesNotMatch(css, /\.ch-background \{/);
});
test('full list and slim list preserve the server background field without inventing Ready state', () => {
  const { normalize } = pipeline();
  for (const bg of ['helper', 'heavy']) {
    const full = normalize({ id: 'f-' + bg, status: 'completed', wizard_background: bg });
    assert.equal(full.background, bg, 'full list row');
    assert.equal(full.attention, null, 'no attention from the server: no Ready state made up');
    const slim = normalize({ listVersion: 1, id: 's-' + bg, title: 'Slim', status: 'completed', background: bg, updatedAt: '2026-11-07T10:00:00.000Z' });
    assert.equal(slim.background, bg, 'slim list row (listVersion 1) keeps the field as sent');
    assert.equal(slim.attention, null);
  }
  assert.equal(normalize({ id: 'x', status: 'completed', wizard_background: 'root' }).background, '');
});
test('Working helper rows keep their waiting label while preferring the latest reply preview', () => {
  const { normalize } = pipeline();
  const at = Date.UTC(2026, 10, 7, 10) / 1000;
  const row = helper => normalize({ id: 'h', status: 'running', wizard_waiting_on: 'helper', ...(helper ? { wizard_helper_status: { phase: 'running', pending: 2, since: at } } : {}),
    latest_message: { role: 'assistant', content: 'Two helpers are checking flights' }, last_user_message: { role: 'user', content: 'Find me a flight to Lisbon' } });
  assert.equal(row(true).preview, 'Two helpers are checking flights', 'with helpers out, the latest reply leads');
  assert.equal(row(false).preview, 'Find me a flight to Lisbon', 'a plain working row shows the request');
  // the Working row's label (core/chats-drafts.js workLabel) with the real chat-work.js helper label
  const work = vm.createContext({ window: {}, Date: { now: () => at * 1000 + 3 * 60000 } });
  vm.runInContext(fs.readFileSync(new URL('../web/core/chat-work.js', import.meta.url), 'utf8'), work);
  const label = runRecording(between(chats, '  const PEND_LABEL =', '\n') + '\n' + block(chats, '  function workLabel(s) {') + '\nglobalThis.label = workLabel;', { window: work.window });
  assert.match(label.label(row(true)), /^Waiting on 2 helpers · 3m/);
  assert.equal(label.label(row(false)), 'Waiting on a helper');
});
// Parity (AGENTS.md): run the real list normalizer and row badge for a main thread and every routed runtime kind.
function pipeline() {
  const a = live.indexOf('  const READY_OR_ATTENTION'), b = live.indexOf('  /* ---- thread-seen');
  const lines = chats.split('\n');
  const pick = re => lines.find(l => re.test(l));
  assert.ok(a > 0 && b > a, 'live.js normalizer block found');
  const context = modelContext({});
  vm.runInContext(`${live.slice(a, b)}\n${pick(/const WORKING_ST =/)}\n${pick(/const isWorking =/)}\n${pick(/const attOf =/)}\nthis.normalize = normalize;`, context);
  return context;
}
test('main and routed rows (host-profile, container, restricted) keep background from full and slim lists', () => {
  const { normalize } = pipeline();
  const ask = { state: 'needs_you', ask: 'Your QR is ready. Scan it to connect your phone', subject: 'Phone' };
  for (const kind of ['main', 'host-profile', 'container', 'restricted']) {
    const agent = kind === 'main' ? '' : `qa-${kind}`;
    const full = normalize({ id: `qr-${kind}`, status: 'completed', agent, runtimeKind: kind, wizard_attention: ask, wizard_background: 'helper' });
    assert.equal(full.agent, agent);
    assert.equal(full.background, 'helper', `${kind} full row keeps background`);
    const working = normalize({ id: `fyi-${kind}`, status: 'running', agent, wizard_attention: { state: 'fyi', ask: 'Still building' }, wizard_background: 'helper', wizard_waiting_on: 'helper' });
    assert.equal(working.waitingOn, 'helper');
    const stray = normalize({ id: `x-${kind}`, status: 'completed', agent, wizard_attention: ask, wizard_background: 'root' });
    assert.equal(stray.background, '', 'unknown background values are dropped');
  }
});
