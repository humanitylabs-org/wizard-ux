import assert from 'node:assert/strict';
export default async function check(f) {
  const find = (n, cls) => (n.className || '').split(' ').includes(cls) ? n : n.children.map(c => find(c, cls)).find(Boolean);
  const all = (n, cls, out = []) => { if ((n.className || '').split(' ').includes(cls)) out.push(n); n.children.forEach(c => all(c, cls, out)); return out; };
  const box = () => find(f.doc.body, 'ui-inbox');
  assert.equal(box(), undefined, 'nothing mounted while the inbox is empty');
  f.inbox.push([{ id: 'n1', title: 'Backup failed', message: 'Disk full on the backup target', time: 1, source: 'cron', priority: 4, link: '' }, { id: 'n2', title: '', message: 'Video ready\nsee https://example.com/v', time: 2, source: 'wizard', priority: 3, link: '' }]);
  const b = box(); assert.ok(b, 'unread notifications mount'); assert.equal(b.parentNode?.dataset.slot, 'ready-top', 'in the Ready slot');
  assert.equal(all(b, 'ui-item').length, 2, 'one yellow thread per notification');
  assert.equal(all(b, 'ui-open').length, 0, 'closed until tapped');
  const head = all(b, 'ui-row')[0]; head.fire('click', {}); assert.equal(all(box(), 'ui-open').length, 1, 'a tap opens the one message');
  const acts = all(box(), 'ui-act'); assert.deepEqual(acts.map(a => a.textContent), ['Done', 'Reply', 'Resolve this']);
  acts[0].fire('click', { stopPropagation() {} }); assert.deepEqual(f.inbox.done.splice(0), ['n1'], 'Done marks it done, no chat');
  assert.equal(f.inbox.replies.length, 0);
  all(box(), 'ui-row')[0].fire('click', {}); all(box(), 'ui-act')[1].fire('click', { stopPropagation() {} });
  assert.deepEqual(f.inbox.replies.splice(0), [['n1', '']], 'Reply opens a draft without sending');
  assert.deepEqual(f.inbox.done, [], 'an unsent reply keeps the notification');
  f.host.emit('sent', { thread: '__new__', isNew: true, reply: 'notifications:n1' }); assert.deepEqual(f.inbox.done.splice(0), ['n1'], 'sending the reply finishes it');
  all(box(), 'ui-row')[1].fire('click', {}); all(box(), 'ui-act').filter(a => a.textContent === 'Resolve this').at(-1).fire('click', { stopPropagation() {} });
  const [rid, words] = f.inbox.replies.splice(0)[0]; assert.equal(rid, 'n2'); assert.match(words, /^Resolve this notification/, 'Resolve this sends a fixed ask');
  f.host.emit('sent', { thread: '__new__', isNew: true, reply: '' }); assert.deepEqual(f.inbox.done, [], 'other sends leave notifications alone');
  f.inbox.push([]); assert.equal(box(), undefined, 'gone when nothing is unread');
  f.inbox.push([{ id: 'n3', title: 'x', message: 'y', time: 3 }]); await f.clear(); assert.equal(box(), undefined, 'teardown removes it'); assert.equal(f.inbox.watchers(), 0, 'teardown stops watching');
}
