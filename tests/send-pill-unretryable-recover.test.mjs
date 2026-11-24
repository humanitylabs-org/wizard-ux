import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { between, block, runRecording } from './fixtures/source-slice.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';

// Codex review on #438: with two or more unreadable recordings and no Wizard copy, the send pill offered
// "Retry all", which queues none of them, leaving no way to reach Unsent and delete them.
const src = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));

// The real sendPill (chats-drafts.js) rendered into the mini DOM, and the real pill tap line (chats-bind.js).
function pill(items, { recover = true, retryable = () => false } = {}) {
  const calls = [], c = {};
  const ctx = runRecording(block(src, '  function sendPill(items, w) {') + '\nglobalThis.sendPill = sendPill;', { calls,
    ch: () => c, esc: String, clip: s => s, LIVE: { ok: true, session: () => null }, reachLabel: () => 'Waiting for Wizard', troubleshoot: '', CHECK_SVG: '',
    OUTBOX: { canRetry: retryable, quarantined: () => false, get: () => null }, H: recover ? { recoverUnsent: id => calls.push(['recoverUnsent', id]) } : {}, window: {} });
  const doc = createDocument(); doc.body.innerHTML = ctx.sendPill(items, { id: 'w1' });
  const buttons = doc.body.querySelectorAll('.ch-pill button').map(b => b.textContent);
  const tap = sel => {
    const H = recover ? { recoverUnsent: id => calls.push(['recoverUnsent', id]) } : {};
    const t = runRecording(`globalThis.tap = e => {\n${between(src, "    const recovery = e.target.closest('[data-obrecover]');", '\n')}\n  return false; };`, { H });
    return t.tap({ target: doc.body.querySelector(sel) });
  };
  return { doc, buttons, tap, recovered: () => calls.filter(x => x[0] === 'recoverUnsent').map(x => x[1]) };
}
const take = (id, state, extra = {}) => ({ id, kind: 'reply', sessionId: 's' + id, state, audio: { size: 4 }, ...extra });

test('send pill routes several unretryable items to Unsent instead of a no-op Retry all', () => {
  const stuck = pill([take('a', 'failed'), take('b', 'waiting')]);
  assert.deepEqual(stuck.buttons, ['Recover'], 'no Retry all that would queue none of them');
  assert.equal(stuck.doc.body.querySelector('[data-obrecover]').dataset.obrecover, 'a');
  assert.equal(stuck.tap('[data-obrecover]'), true);
  assert.deepEqual(stuck.recovered(), ['a'], 'Recover opens Unsent at the first of them');
  // one of them can still be retried: Retry all stays
  assert.deepEqual(pill([take('a', 'failed'), take('b', 'failed')], { retryable: it => it.id === 'b' }).buttons, ['Retry all']);
  // a shell without the Unsent screen keeps the old pill
  assert.deepEqual(pill([take('a', 'failed'), take('b', 'failed')], { recover: false }).buttons, ['Retry all']);
});
