import test from 'node:test';
import assert from 'node:assert/strict';
import { helperWorkingHarness, liveSource } from './helpers/helper-working-harness.mjs';

// wizard-ux issue 2055: after the phone comes back to the front, a tapped Ready thread waited 3-5 s for a whole
// Chats list read before the copy this phone had already saved could paint. That one thread's detail read (~0.1 s)
// now vouches for the saved copy when it names the same message count and newest owner/reply times; otherwise
// nothing paints early (never an older reply, James 24 Oct 2026).
const row = { id: 'wizard_saved_copy', title: 'Synthetic Ready', source: 'wizard-mobile', status: 'completed', message_count: 2,
  wizard_retry_input: 'Synthetic request', wizard_last_user_at: 100, wizard_last_assistant_at: 200, wizard_activity_at: 200 };
const messages = [{id:1,role:'user',content:'Synthetic request',timestamp:100},{id:2,role:'assistant',content:'SYNTHETIC_SAVED_ANSWER',timestamp:200}];
async function saved(agent = '') {
  const h = helperWorkingHarness({ source: liveSource(), row, detail: { session: row }, agent });
  const original = h.context.fetch, reads = [];
  h.context.fetch = async (url, init) => {
    reads.push(String(url));
    if (String(url).includes('/messages?')) return { ok: true, json: async () => ({ data: structuredClone(messages), has_more: false }) };
    return original(url, init);
  };
  await h.poll(); await h.L.messages(row.id);
  // The list on screen is the stored snapshot again (the phone was away): it can no longer vouch for the copy.
  h.L.cached = true;
  reads.length = 0;
  return { ...h, reads };
}
test('a saved copy paints from its own detail read when that thread still holds the same messages', async () => {
  const h = await saved();
  assert.equal(h.L.cachedMessages(row.id), null, 'the list cannot vouch right after the phone comes back');
  const rows = await h.L.verifiedCopy(row.id);
  assert.equal(rows.at(-1).content, 'SYNTHETIC_SAVED_ANSWER');
  assert.equal(h.reads.filter(u => u.includes('view=detail')).length, 1, 'one detail read');
  assert.equal(h.reads.filter(u => u.includes('/messages?') || /sessions\?/.test(u)).length, 0, 'no list or history read needed to paint');
});
test('a newer reply on the box keeps the saved copy unpainted', async () => {
  const h = await saved();
  h.setDetail({ session: { ...row, message_count: 4, wizard_last_user_at: 250, wizard_last_assistant_at: 300 } });
  assert.equal(await h.L.verifiedCopy(row.id), null);
  h.setDetail({ session: { ...row, wizard_last_assistant_at: 201 } });
  assert.equal(await h.L.verifiedCopy(row.id), null);
});
test('a list read that lands during the detail read and names a newer reply wins over a matching detail', async () => {
  const h = await saved();
  const release = h.deferDetail();
  const pending = h.L.verifiedCopy(row.id);
  // The resume's list read lands first and already shows the newer reply; the detail read answered for the old one.
  h.L.cached = false; h.L.at = Date.now() + 1;
  h.L.sessions[0] = { ...h.L.sessions[0], messageCount: 4, lastAssistantAt: new Date(300e3).toISOString() };
  release();
  assert.equal(await pending, null);
});
test('an older service whose detail names no reply times never vouches', async () => {
  const h = await saved();
  const { wizard_last_user_at, wizard_last_assistant_at, ...older } = row;
  h.setDetail({ session: older });
  assert.equal(await h.L.verifiedCopy(row.id), null);
});
for (const agent of ['synthetic-profile', 'synthetic-container', 'synthetic-restricted', 'synthetic-private']) test(`a ${agent} thread is never stored, so nothing is verified for it`, async () => {
  const h = await saved(agent);
  assert.equal(await h.L.verifiedCopy(row.id), null);
  assert.equal(h.reads.filter(u => u.includes('view=detail')).length, 0);
});
