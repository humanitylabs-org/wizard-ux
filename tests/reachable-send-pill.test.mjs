import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the production renderer, not a second implementation of its branches.
const source = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const start = source.indexOf('  function sendPill(items, w) {');
const end = source.indexOf('\n  // Rotate one storage write:', start);
assert.ok(start >= 0 && end > start);
function render(items, diagnosis = { layer: 'send', short: 'Reconnecting…' }) {
  const ctx = { ch: () => ({}), LIVE: { ok: true, session: () => ({ title: 'Synthetic chat' }) },
    OUTBOX: { canRetry: () => true, quarantined: () => false }, H: {},
    reach: () => diagnosis, troubleshoot: '<button data-chtroubleshoot>Open Troubleshooter</button>',
    esc: s => String(s), clip: s => s, CHECK_SVG: '', setTimeout, clearTimeout };
  vm.runInNewContext(source.slice(start, end) + '\nthis.render = sendPill;', ctx);
  const before = JSON.stringify(items);
  const html = ctx.render(items, { id: 'synthetic-window' });
  assert.equal(JSON.stringify(items), before, 'rendering preserves original message custody');
  return html;
}
test('healthy probes leave a visible, actionable saved-message card, not a connection claim', () => {
  const html = render([{ id: 'synthetic-one', kind: 'reply', sessionId: 'synthetic-thread', state: 'waiting' }]);
  assert.match(html, /Message not sent · retrying/);
  assert.match(html, /data-sendpill="1"/);
  assert.match(html, /data-obretry="synthetic-one"/);
  assert.match(html, /data-chtroubleshoot/);
  assert.doesNotMatch(html, /Wizard reachable/);
});
test('several waiting messages retain their count and Retry all action', () => {
  const html = render(['one', 'two'].map(id => ({ id, kind: 'reply', state: 'waiting' })));
  assert.match(html, /2 messages not sent · retrying/);
  assert.match(html, /data-obretryall/);
});
test('an actual diagnosed outage still names the connection failure in the saved-message card', () => {
  assert.match(render([{ id: 'synthetic', state: 'waiting' }], { layer: 'tailscale', short: 'Can’t reach Wizard · retrying' }), /Can’t reach Wizard · retrying/);
});
test('permanent and unconfirmed failures keep their distinct, actionable custody feedback', () => {
  assert.match(render([{ id: 'synthetic', state: 'failed' }]), /Not sent/);
  assert.match(render([{ id: 'synthetic', state: 'unconfirmed' }]), /Could not confirm · originals kept/);
});
