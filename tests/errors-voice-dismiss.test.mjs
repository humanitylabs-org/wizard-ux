import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Regression: tapping Dismiss on a failed voice note in the Errors section showed
// "Could not save dismissal · original kept". The generic Chats click handler grabbed every
// [data-obdismiss] first and called OUTBOX.dismissBubble, which (correctly) refuses 'failed'
// items, so the Errors row's own confirm → delete flow in chat-power.js never ran.
const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const power = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
const outbox = readFileSync(new URL('../web/outbox.js', import.meta.url), 'utf8');

test('Errors voice rows are rendered inside [data-errob] with their own Dismiss', () => {
  assert.match(power, /data-errob="\$\{esc\(it\.id\)\}"[\s\S]{0,600}data-obdismiss="\$\{esc\(it\.id\)\}"/);
  assert.match(power, /const od = t\.closest\('\[data-obdismiss\]'\); if \(od\)/);
});

test('generic bubble Dismiss skips Errors voice rows so chat-power handles them', () => {
  const at = chats.indexOf("e.target.closest('[data-obdismiss]')");
  assert.ok(at > 0, 'generic dismiss handler present');
  const line = chats.slice(chats.lastIndexOf('\n', at), chats.indexOf('\n', at));
  assert.match(line, /!e\.target\.closest\('\[data-errob\]'\)\s*&&/, 'guard must exclude [data-errob]');
  assert.ok(at < chats.indexOf('if (PW && PW.click(e, id)) return true;'), 'PW.click still runs after the generic handlers');
});

test('dismissBubble still refuses failed items (custody rule unchanged)', () => {
  assert.match(outbox, /if \(!it \|\| !\['empty', 'held', 'sent'\]\.includes\(it\.state\)/);
});
