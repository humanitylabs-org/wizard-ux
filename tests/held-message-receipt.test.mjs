import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const start = source.indexOf('  function pendingState(');
const end = source.indexOf('  // Failed thread reads retry', start);
function receipt(p, s) {
  const c = vm.createContext({ OUTBOX: { quarantined: () => false }, H: {}, esc: String,
    window: { WizConfig: { agent: () => 'Wizard' } }, CHECK_SVG: '✓',
    KIT: { reply: { clean: () => null } }, replyCard: () => '', userMedia: () => '', md: String });
  vm.runInContext(source.slice(start, end), c);
  return c.pendingHtml(p, { media: [] }, s);
}
const pending = { id: 'send', state: 'sent', runId: 'held-run', text: 'A saved request' };
test('held message says Waiting for sign-in, not Sent or Dismiss', () => {
  const html = receipt(pending, { reconnect: { runId: 'held-run' }, status: 'failed' });
  assert.match(html, /Waiting for sign-in/);
  assert.doesNotMatch(html, />Sent<|Dismiss/);
  assert.match(source, /pend\.map\(p => pendingHtml\(p, c, s\)\)/);
});
test('held receipt stays waiting until the automatic resend completes', () => {
  for (const status of ['queued', 'running', 'waiting_for_approval']) {
    const html = receipt(pending, { lastRunKey: 'wizard-saved-retry-held-run', lastRunStatus: status });
    assert.match(html, /Waiting for sign-in/, status);
    assert.doesNotMatch(html, />Sent</, status);
  }
  for (const status of ['failed', 'interrupted', 'cancelled']) {
    const failed = receipt(pending, { lastRunKey: 'wizard-saved-retry-held-run', lastRunStatus: status });
    assert.match(failed, /Not sent · message saved/); assert.doesNotMatch(failed, />Sent<|Waiting for sign-in/);
  }
  const html = receipt(pending, { lastRunKey: 'wizard-saved-retry-held-run', lastRunStatus: 'completed' });
  assert.match(html, />Sent</);
  assert.doesNotMatch(html, /Waiting for sign-in/);
});
test('an older send and ordinary or steered sends keep their receipts', () => {
  for (const s of [undefined, { reconnect: { runId: 'different-run' } }, { lastRunKey: 'wizard-saved-retry-different-run', lastRunStatus: 'running' }]) {
    assert.match(receipt(pending, s), />Sent</);
  }
  assert.match(receipt({ ...pending, steered: true }, {}), /Delivered · Wizard sees it next step/);
});
