import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const live = fs.readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
// The read-state functions only (thread-seen block), with the helpers they lean on.
function api() {
  const ctx = { otherAgent: a => !!a && a !== 'hermes', READY_OR_ATTENTION: new Set(['completed', 'failed', 'interrupted', 'waiting_for_approval', 'unknown']) };
  vm.createContext(ctx);
  vm.runInContext(live.slice(live.indexOf('  const vis = v =>'), live.indexOf('  function later(')) + '\nthis.api = { hasNew, recordFor, assistantAt };', ctx);
  return ctx.api;
}
// A scheduled report (Topics roundup) appended to a thread: the list's model-reply time stays old,
// the latest message is the new report. Shapes match the live list (23 Oct 2026).
const topics = { id: 't', runtime: 'direct', lastAssistantAt: '2026-10-14T08:37:15.080Z', previewRole: 'assistant', previewAt: '2026-10-23T01:04:08.524Z', messageCount: 373, preview: 'Wizard Topics · Fri 23 Oct', updatedAt: '2026-10-14T08:32:27.356Z' };
const seenBefore = { initializedAt: 1, threads: { 'direct:t': { assistantActivityAt: '2026-10-14T08:37:15.080Z', messageCount: 370, seenAt: Date.parse('2026-10-20T07:22:01Z'), updatedAt: topics.updatedAt } } };

test('a report appended after the last read makes the thread unread (Ready / bold row)', () => {
  const { hasNew } = api();
  assert.equal(hasNew(topics, seenBefore), true);
});
test('opening it clears it, and it stays read until the next report', () => {
  const { hasNew, recordFor } = api();
  const after = { ...seenBefore, threads: { 'direct:t': recordFor(topics, Date.parse('2026-10-23T05:40:00Z')) } };
  assert.equal(hasNew(topics, after), false);
  assert.equal(hasNew({ ...topics, previewAt: '2026-10-24T01:00:00.000Z', messageCount: 374 }, after), true);
});
test('a normal model reply still drives read state; an older preview never hides it', () => {
  const { hasNew, assistantAt } = api();
  const s = { ...topics, lastAssistantAt: '2026-10-23T02:00:00.000Z', previewAt: '2026-10-23T02:00:00.000Z' };
  assert.equal(assistantAt(s), '2026-10-23T02:00:00.000Z');
  assert.equal(assistantAt({ ...s, previewAt: '2026-10-01T00:00:00.000Z' }), '2026-10-23T02:00:00.000Z');
  assert.equal(assistantAt({ ...s, previewRole: 'user', previewAt: '2026-10-24T00:00:00.000Z' }), '2026-10-23T02:00:00.000Z');
  assert.equal(hasNew(s, seenBefore), true);
});
test('Ready keeps a thread whose only fresh news is a report (week cutoff and order use the same time)', () => {
  assert.match(live, /const at = Date\.parse\(assistantAt\(s\) \|\| s\.activityAt \|\| s\.updatedAt\);/);
  assert.match(live, /const t = s => Date\.parse\(assistantAt\(s\) \|\| s\.activityAt \|\| s\.updatedAt\) \|\| 0;/);
});
