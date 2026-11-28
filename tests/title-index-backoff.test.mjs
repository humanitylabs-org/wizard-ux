import test from 'node:test';
import assert from 'node:assert/strict';
import { helperWorkingHarness, liveSource } from './helpers/helper-working-harness.mjs';

// wizard-ux issue 2055: on James's box the search title index read (fields=slim) answered 502 every time, and the
// shell asked for it again on every list read, holding the box for about a second each time a thread opened.
const row = { id: 'wizard_title_backoff', title: 'Synthetic', source: 'wizard-mobile', status: 'completed', message_count: 2,
  wizard_last_user_at: 100, wizard_last_assistant_at: 200 };
function harness(slimStatus) {
  const h = helperWorkingHarness({ source: liveSource(), row, detail: { session: row } });
  const slim = [];
  h.context.fetch = async (url) => {
    const u = new URL(url, 'https://test.invalid');
    if (u.pathname === '/wizard/hermes/api/sessions' && u.searchParams.get('fields') === 'slim') {
      slim.push(String(url));
      if (slimStatus() !== 200) return { ok: false, status: slimStatus(), json: async () => ({ error: 'upstream_unavailable' }) };
      return { ok: true, status: 200, json: async () => ({ object: 'list', data: [], fields: 'slim', build: 'b1', account_scope: 'synthetic', snapshot: 's', has_more: false }) };
    }
    if (u.pathname === '/wizard/hermes/api/sessions') return { ok: true, status: 200, json: async () => ({ data: [structuredClone(row)], list_version: 1, window: 'archive-50', has_more: false, build: 'b1', snapshot: 's' }) };
    if (u.pathname === '/wizard/thread-seen') return { ok: true, status: 200, json: async () => ({ state: { initializedAt: Date.now(), threads: {} } }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const run = async () => { for (const t of h.timers.splice(0)) if (t.ms === 0) await t.fn(); await new Promise(r => setTimeout(r, 0)); };
  return { ...h, slim, run };
}
test('a refused title index read is not repeated on every list read, and is asked again after 5 minutes', async () => {
  let status = 502;
  const h = harness(() => status);
  await h.L.refresh(); await h.run();
  assert.equal(h.slim.length, 1);
  for (let i = 0; i < 4; i++) { h.advance(15000); await h.L.refresh(); await h.run(); }
  assert.equal(h.slim.length, 1, 'four more list reads ask nothing more of the broken index');
  status = 200; h.advance(5 * 60000);
  await h.L.refresh(); await h.run();
  assert.equal(h.slim.length, 2, 'asked again after the wait');
  h.advance(15000); await h.L.refresh(); await h.run();
  assert.equal(h.slim.length, 2, 'a loaded index with the same build is not read again');
});
