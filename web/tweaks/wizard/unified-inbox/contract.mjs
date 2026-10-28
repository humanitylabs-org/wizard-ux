import assert from 'node:assert/strict';
export default async function check(f) {
  const find = (n, cls) => (n.className || '').split(' ').includes(cls) ? n : n.children.map(c => find(c, cls)).find(Boolean);
  const all = (n, cls, out = []) => { if ((n.className || '').split(' ').includes(cls)) out.push(n); n.children.forEach(c => all(c, cls, out)); return out; };
  const inSlot = name => { const s = f.doc.body.querySelector(`[data-slot="${name}"]`); return s ? all(s, 'ui-row') : []; };
  assert.equal(find(f.doc.body, 'ui-inbox'), undefined, 'nothing mounted while the inbox is empty');
  f.inbox.push([
    { id: 'n1', title: 'Backup failed', message: 'Disk full', time: 3, source: 'cron', read: false, archived: false },
    { id: 'n2', title: '', message: 'Video ready\nhttps://example.com/v', time: 2, read: false, archived: false },
    { id: 's1', title: 'Snoozed one', message: 'later', time: 1, read: true, archived: false },
    { id: 'd1', title: 'Old', message: 'done', time: 0, read: true, archived: true },
  ]);
  assert.equal(inSlot('ready-top').length + inSlot('ready-end').length, 0, 'unread and snoozed are Chats rows, not slot blocks');
  assert.equal(f.host.inboxList, true, 'Chats lists them among the chats');
  const btn = find(f.doc.body, 'ui-done-btn'); assert.match(btn.textContent, /Completed notifications · 1/);
  assert.equal(inSlot('archive-top').length, 0, 'completed stay folded'); btn.fire('click', {}); assert.equal(inSlot('archive-top').length, 1, 'and open on tap');
  f.inbox.act('open', 'n1'); assert.deepEqual(f.inbox.replies.splice(0), [['n1', '']], 'a tap opens it in the chat window (nothing sent)');
  inSlot('archive-top')[0].fire('click', {}); assert.deepEqual(f.inbox.replies.splice(0), [['d1', '']], 'a completed one opens too');
  assert.deepEqual(f.inbox.done, [], 'opening changes nothing');
  f.inbox.act('done', 'n1'); assert.deepEqual(f.inbox.done.splice(0), ['n1'], 'Done archives');
  f.inbox.act('snooze', 'n2'); assert.equal(JSON.stringify(f.inbox.sets.splice(0)), JSON.stringify([['n2', { read: true }]]), 'Snooze keeps it, read');
  f.inbox.act('restore', 'd1'); assert.equal(JSON.stringify(f.inbox.sets.splice(0)), JSON.stringify([['d1', { read: false, archived: false }]]), 'Restore brings it back unread');
  f.inbox.act('resolve', 'n2'); const [rid, words] = f.inbox.replies.splice(0)[0]; assert.equal(rid, 'n2'); assert.match(words, /^Resolve this notification/);
  f.host.emit('sent', { thread: '__new__', isNew: true, reply: 'notifications:n2' }); assert.deepEqual(f.inbox.done.splice(0), ['n2'], 'a sent reply finishes it');
  f.host.emit('sent', { thread: '__new__', isNew: true, reply: '' }); assert.deepEqual(f.inbox.done, [], 'other sends leave notifications alone');
  f.inbox.push([]); assert.equal(find(f.doc.body, 'ui-done'), undefined, 'gone when there are none');
  assert.equal(f.host.inboxThreads, true, 'notification threads on while the package lives');
  await f.clear(); assert.equal(f.inbox.watchers(), 0, 'teardown stops watching'); assert.equal(f.host.inboxThreads, false, 'and turns notification threads off'); assert.equal(f.host.inboxList, false, 'and the list rows');
}
