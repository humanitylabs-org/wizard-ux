import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs';
import { between } from './fixtures/source-slice.mjs';
// James, 7 Nov 2026: on the phone, Archive on the open thread returns to the chats list, even with "Stay on this chat".
// The real leaveFinishedThread (chats.js) and the row action's landing lines (chats-rowacts.js) run here (issue 1674).
const src = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
const acts = readFileSync(new URL('../web/core/chats-rowacts.js', import.meta.url), 'utf8');

function shell({ phone, stay }) {
  const log = [], c = { trail: ['t0'] }, ctx = { log, PHONE: () => phone, ch: () => c, chatsBack: w => log.push('list'),
    archiveAdvance: (w, sid) => log.push('next-chat'), keepThreadOpen: () => stay, threadBack: () => log.push('threadBack') };
  vm.createContext(ctx);
  vm.runInContext(`${between(src, '  function leaveFinishedThread(w, sid) {', '  // Repaint every chats list')}
this.act = (a, w, sid) => { ${between(acts, "    if (a === 'done' && w?.thread === sid) leaveFinishedThread(w, sid);", '    const msg = ')} };`, ctx);
  return { ctx, log, c };
}

test('phone Archive leaves the thread for the list regardless of the After-actions setting', () => {
  for (const stay of [false, true]) {
    const p = shell({ phone: true, stay });
    p.ctx.act('done', { id: 'w', thread: 't1' }, 't1');
    assert.deepEqual(p.log, ['list'], `phone, stay=${stay}: straight to the list`);
    assert.equal(p.c.trail.length, 0, 'the link trail is dropped');
  }
  const d = shell({ phone: false, stay: false });
  d.ctx.act('done', { id: 'w', thread: 't1' }, 't1');
  assert.deepEqual(d.log, ['next-chat'], 'desktop opens the next chat in the list');
  const other = shell({ phone: true, stay: true });
  other.ctx.act('done', { id: 'w', thread: 't2' }, 't1');
  assert.deepEqual(other.log, [], 'archiving a different chat leaves the open thread alone');
  const snooze = shell({ phone: true, stay: false });
  snooze.ctx.act('file', { id: 'w', thread: 't1' }, 't1');
  assert.deepEqual(snooze.log, ['threadBack'], 'other actions follow the After-actions setting');
});
