import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Codex review on #438: with two or more unreadable recordings and no Wizard copy, the send pill offered
// "Retry all", which queues none of them, leaving no way to reach Unsent and delete them.
const src = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');

test('send pill routes several unretryable items to Unsent instead of a no-op Retry all', () => {
  const body = src.slice(src.indexOf('function sendPill('), src.indexOf("const spin = failed.length", src.indexOf('function sendPill(')));
  assert.match(body, /!one && H\.recoverUnsent && items\.every\(it => \['failed', 'waiting'\]\.includes\(it\.state\) && !OUTBOX\.canRetry\(it\)\)\)/);
  assert.match(body, /data-obrecover="\$\{esc\(items\[0\]\.id\)\}">Recover</);
});
