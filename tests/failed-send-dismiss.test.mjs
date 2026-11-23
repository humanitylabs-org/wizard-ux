import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { client } from './fixtures/outbox-client.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';
const chats = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8')) + readFileSync(new URL('../web/core/chats-outbox.js', import.meta.url), 'utf8');
const item = (id, extra = {}) => ({ id, kind: 'reply', state: 'failed', sessionId: 'test-thread', text: 'Switch', error: 'No confirmed model route', createdAt: Date.now(), ...extra });
const tick = () => new Promise(r => setTimeout(r, 25));
// This is an outbox custody unit, not routed UI parity. Actual Focus/list/thread coverage:
// QA_DISMISS_ONLY=1 node qa/scripts/qa-voice-custody-callers.cjs (qa-failed-send-dismiss.cjs).
  test('outbox custody: selected failure persisted; no admission/stop and original retained', async t => {
    const rows = new Map(), p = client(rows); t.after(p.close); await tick();
    const failed = item('failed', { audio: new Blob(['original']) });
    const accepted = item('accepted', { state: 'sent', runId: 'active-run' });
    const other = item('other');
    for (const it of [failed, accepted, other]) p.api._items.set(it.id, it);
    assert.equal(await p.api.dismissFailed('failed'), true);
    assert.equal(p.api.forThread('test-thread').some(x => x.id === 'failed'), false);
    assert.equal(p.api.canRetry('failed'), false);
    assert.equal(p.api.retry('failed'), false);
    assert.equal(accepted.runId, 'active-run'); assert.equal(accepted.state, 'sent');
    assert.equal(other.state, 'failed'); assert.equal(p.api.canRetry(other), true);
    assert.equal(p.api.unsent().find(x => x.id === 'failed').audio.size, 8);
    assert.equal(rows.get('failed').threadHidden, true);
    p.close(); const reloaded = client(rows); t.after(reloaded.close); await tick();
    assert.equal(reloaded.api.get('failed').state, 'held');
    assert.equal(reloaded.api.forThread('test-thread').length, 0);
    assert.equal(reloaded.api.retryAll(), 0);
    assert.equal(p.calls.length + reloaded.calls.length, 0);
  });
test('stale button cannot dismiss accepted, queued, unconfirmed or active work', async t => {
  const p = client(); t.after(p.close); await tick();
  for (const state of ['sent', 'queued', 'sending', 'waiting', 'unconfirmed', 'processing']) {
    const it = item(state, { state }); p.api._items.set(it.id, it);
    assert.equal(await p.api.dismissFailed(it.id), false); assert.equal(it.state, state);
  }
  const steer = item('steer', { steerDispatch: 'started' }); p.api._items.set(steer.id, steer);
  assert.equal(await p.api.dismissFailed('steer'), false);
  assert.equal(await p.api.dismissFailed('missing'), false); assert.equal(p.calls.length, 0);
});
test('failed persistence keeps the bubble and permits retry, never claiming dismissal', async t => {
  const p = client(new Map(), true); t.after(p.close); await tick();
  const it = item('failed'); p.api._items.set(it.id, it);
  assert.equal(await p.api.dismissFailed(it.id), false);
  assert.equal(it.state, 'failed'); assert.equal(it.cancelled, undefined); assert.equal(it.threadHidden, undefined);
  assert.equal(p.api.forThread('test-thread').length, 1); assert.equal(p.api.canRetry(it), true);
});
test('thread bubble and single-message pill expose Dismiss; click uses item API, never run Stop', async () => {
  const raw = f => readFileSync(new URL('../web/core/' + f, import.meta.url), 'utf8');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const buttons = html => { const d = createDocument(); d.body.innerHTML = html; return d.querySelectorAll('button').map(b => [...b.attrs.keys()].find(k => k.startsWith('data-ob')) + '=' + (b.getAttribute([...b.attrs.keys()].find(k => k.startsWith('data-ob'))) ?? '')); };
  // the thread bubble (real pendingState) for a failed send: Retry, Edit and Dismiss on that item
  const bubble = runRecording(block(raw('chats-outbox.js'), '  function pendingState(') + '\nglobalThis.state = pendingState;',
    { esc, H: {}, OUTBOX: { quarantined: () => false, canRetry: () => true }, window: { WosModels: {} } }).state;
  const failed = item('f1');
  assert.deepEqual(buttons(bubble(failed, {})), ['data-obretry=f1', 'data-obedit=f1', 'data-obdismissfailed=f1']);
  // the single-message pill over the list (real sendPill)
  const pill = runRecording(block(raw('chats-drafts.js'), '  function sendPill(items, w) {') + '\nglobalThis.pill = sendPill;',
    { esc, clip: (t, n) => String(t).slice(0, n), H: {}, LIVE: { ok: true, session: () => ({ title: 'Plans' }) }, ch: () => ({}), CHECK_SVG: '', troubleshoot: '', Date, setTimeout, clearTimeout,
      OUTBOX: { get: () => null, canRetry: () => true, quarantined: () => false, lateLabel: () => '' }, window: { WizConfig: { agent: () => 'Wizard' }, WosModels: {} }, reachLabel: () => '' }).pill;
  assert.ok(buttons(pill([failed], { id: 'w1' })).includes('data-obdismissfailed=f1'), 'one failed message: the pill has Dismiss');
  assert.ok(!buttons(pill([failed, item('f2')], { id: 'w1' })).some(b => b.startsWith('data-obdismissfailed')), 'several: no single Dismiss');
  // the click (real chats-bind.js handler): the item API, never a run Stop, a send cancel or a retry
  const handler = raw('chats-bind.js'), from = handler.indexOf('    const failedDismiss =');
  const code = handler.slice(from, handler.indexOf('    // Errors-section voice rows', from));
  const btn = { disabled: false, dataset: { obdismissfailed: 'f1' } };
  const dismissed = [];
  const ctx = runRecording(`globalThis.click = e => { ${code}\n };`, { id: 'w1', OUTBOX: { get: () => failed, dismissFailed: x => { dismissed.push(x); return true; } }, H: { win: () => null, toast: (...a) => ctx.calls.push(['toast', ...a]) }, Promise });
  assert.equal(ctx.click({ target: { closest: sel => (sel === '[data-obdismissfailed]' ? btn : null) } }), true);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(dismissed, ['f1']); assert.equal(btn.disabled, true);
  assert.ok(ctx.calls.some(c => c[0] === 'toast' && /Dismissed/.test(c[2])));
  assert.ok(!ctx.calls.some(([n]) => /^(LIVE|cancelSend|OUTBOX)/.test(n)), 'never a run Stop, cancelSend or retry');
  assert.doesNotMatch(code, /LIVE\.stop|cancelSend|OUTBOX\.retry/);
});
