import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryCard } from './fixtures/r6B-recovery.mjs';

const take = (o = {}) => ({ id: 'r1', kind: 'reply', sessionId: 's1', state: 'failed', durable: true, createdAt: Date.UTC(2026, 10, 2, 9, 30), audio: new Blob([new Uint8Array(17 * 1024 + 5)]), audioType: 'audio/mp4', ...o });

test('retained recordings identify their source, time and size', () => {
  const at = take().createdAt;
  const c = recoveryCard([take()], { sessions: { s1: { title: 'Trip to Chiang Mai' } } });
  assert.equal(c.card.hidden, false);
  assert.equal(c.card.querySelector('.recording-meta').textContent, `Trip to Chiang Mai · ${new Date(at).toLocaleString()} · 18 KB`);
  const meta = t => recoveryCard([t]).card.querySelector('.recording-meta').textContent;
  assert.equal(meta(take({ sessionId: 'gone', audio: null, createdAt: 0 })), 'Existing chat', 'an unknown thread, no time, no bytes');
  assert.equal(meta(take({ kind: 'dictation', audio: new Blob(['x']), createdAt: 0 })), 'Dictation · 1 KB');
  assert.equal(meta(take({ kind: 'new', audio: null, createdAt: 0 })), 'New chat');
});

test('retained audio downloads through a connected link with visible feedback', async () => {
  const c = recoveryCard([take()]);
  await c.press('[data-record-download]');
  // some desktop browsers ignore programmatic downloads from detached links
  assert.deepEqual(c.downloads, [{ href: 'blob:take', download: 'wizard-recording-r1.m4a', connected: true, hidden: true }]);
  assert.equal(c.doc.querySelectorAll('a').length, 0, 'the link is removed again');
  assert.deepEqual(c.toasts.map(t => t[1]), ['Audio download requested · check Downloads']);
  assert.deepEqual(c.revoked, ['blob:take']);
  const f = recoveryCard([take()], { createObjectURL: () => { throw new Error('no blob URLs'); } });
  await f.press('[data-record-download]');
  assert.deepEqual(f.toasts.map(t => t[1]), ['Audio download failed · recording is still kept']); assert.equal(f.downloads.length, 0);
});
