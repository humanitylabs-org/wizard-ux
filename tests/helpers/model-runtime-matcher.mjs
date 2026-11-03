import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Reuse the production pure matcher, not a permissive always-true stub. This
// fixture exercises the outbox algorithm only; it does not certify native data.
const source = readFileSync(new URL('../../web/core/chat-models.js', import.meta.url), 'utf8');
const start = source.indexOf('    matchesRuntime(runtime, route) {');
const end = source.indexOf('    reconcile(sessions) {', start);
assert.ok(start >= 0 && end > start, 'production runtime matcher boundary found');
export const matchesRuntime = vm.runInNewContext('({' + source.slice(start, end) + '})').matchesRuntime;
