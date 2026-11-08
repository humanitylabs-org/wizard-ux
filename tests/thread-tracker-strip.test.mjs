import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const start = chats.indexOf("  window.addEventListener('wos:thread-tracker',");
const end = chats.indexOf('\n  // Changed elsewhere', start);
test('strip presence paints synchronously through a held thread render and captures before chrome changes', () => {
  let handler, strip = null, wanted = true;
  const calls = [];
  const nb = { closest: () => root };
  const root = { querySelector: () => ({ insertAdjacentHTML(where, html) {
    calls.push(['insert', where, html]); strip = { remove() { calls.push(['remove']); strip = null; } };
  } }) };
  const el = { querySelector: sel => sel === '[data-tt-strip]' ? strip : sel === '.ch-msgs' ? nb : null };
  vm.runInNewContext(chats.slice(start, end), {
    window: { addEventListener: (_, fn) => { handler = fn; } }, CH: { w: {} }, W: { w: { id: 'w', thread: 't' } }, elOf: () => el,
    LIVE: {}, WosThreadTracker: { stripHtml: () => wanted ? '<strip>' : '' },
    PW: { capture(n) { assert.equal(n, nb); calls.push(['capture', !!strip]); }, resume(n) { assert.equal(n, nb); calls.push(['resume', !!strip]); } },
    syncDocumentThread() { calls.push(['sync']); },
    // A user selecting/scrolling holds the normal full-thread renderer. Chrome must not use it.
    renderThreadLive() { calls.push(['held-render']); },
  });
  handler({});
  assert.ok(strip); assert.deepEqual(calls, [['capture', false], ['insert', 'afterend', '<strip>'], ['sync'], ['resume', true]]);
  calls.length = 0; wanted = false; handler({});
  assert.equal(strip, null); assert.deepEqual(calls, [['capture', true], ['remove'], ['sync'], ['resume', false]]);
});
