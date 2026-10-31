import assert from 'node:assert/strict';
import shared from '../../wizard/unified-inbox/contract.mjs';
export default async function check(f) {
  // Everything the shared inbox does, this package does too (it loads instead of it).
  await shared(f);
  await f.mount('miguel/inbox');
  const tick = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0)); };
  const all = (n, cls, out = []) => { if ((n.className || '').split(' ').includes(cls)) out.push(n); n.children.forEach(c => all(c, cls, out)); return out; };
  const text = n => n.nodeType === 3 ? n.textContent : n.children.length ? n.children.map(text).join('') : (n.textContent || '');
  const slot = name => f.doc.body.querySelector(`[data-slot="${name}"]`);
  // Holding the feeds is what turns them on; stock Chats never asks an app for one.
  assert.equal(f.inbox.feedsOn, true, 'app feeds are on while the package lives');
  assert.equal(f.host.inboxFeeds, true, 'Chats shows app buttons while it is held');
  assert.equal(f.host.inboxKeep, true, 'and offers Keep <App> in its app');
  assert.equal(f.host.inboxThreads, true, 'notification threads, as the shared inbox');
  const msg = { id: 'a-messenger-0123456789abcdef', app: 'messenger', appName: 'Messenger', key: 'chat:!a', title: 'Carlos', message: '2 new', time: 5, read: false, archived: false,
    actions: [{ id: 'reply', label: 'Reply', input: true }, { id: 'draft', label: 'Draft me a reply', ask: 'Draft a reply. Don’t send it.' }, { id: 'read', label: 'Mark as read' }] };
  const rep = { id: 'a-morning-report-0123456789abcdef', app: 'morning-report', appName: 'Morning Report', key: 'edition:1', title: 'Today', message: 'New edition', time: 4, read: false, archived: false, actions: [] };
  f.inbox.push([msg, rep, { id: 'n1', title: 'Cron', message: 'ran', time: 3, read: false, archived: false }]); await tick();
  // The app's own buttons.
  assert.equal(f.inbox.act('app', msg.id), true); assert.deepEqual(f.inbox.opened.splice(0), [['messenger']], 'Open opens the app');
  assert.equal(f.inbox.act('x:read', msg.id), true); await tick(); assert.deepEqual(f.inbox.appActs.splice(0), [[msg.id, 'read']], 'a plain action runs in the app');
  assert.equal(f.inbox.act('x:draft', msg.id), true); assert.deepEqual(f.inbox.replies.splice(0), [[msg.id, 'Draft a reply. Don’t send it.']], 'an ask goes to Wizard with the item');
  assert.equal(f.inbox.act('x:nope', msg.id), true); await tick(); assert.deepEqual(f.inbox.appActs, [], 'an undeclared action does nothing');
  // Done = the app's finishing action when it has one; otherwise the inbox mark. Snooze is the inbox's.
  assert.equal(f.inbox.act('done', msg.id), true); await tick(); assert.deepEqual(f.inbox.appActs.splice(0), [[msg.id, 'read']], 'Done on Messenger = Mark as read');
  f.inbox.act('done', rep.id); assert.deepEqual(f.inbox.done.splice(0), [rep.id], 'Done without an app action is the inbox mark');
  f.inbox.act('snooze', msg.id); assert.equal(JSON.stringify(f.inbox.sets.splice(0)), JSON.stringify([[msg.id, { read: true }]]));
  f.inbox.act('done', 'n1'); assert.deepEqual(f.inbox.done.splice(0), ['n1'], 'notifications keep their Done');
  // Keep <App> in its app: saved on the box, a toast with Undo; Undo brings it back.
  f.inbox.sources = [{ id: 'messenger', name: 'Messenger', chats: true }, { id: 'morning-report', name: 'Morning Report', chats: true }];
  f.toasts.splice(0); f.toastActs.splice(0);
  assert.equal(f.inbox.act('keep', msg.id), true); await tick();
  assert.equal(JSON.stringify(f.inbox.sourceSets.splice(0)), JSON.stringify([['messenger', { chats: false }]]), 'kept in its app, on the box');
  assert.equal(f.toasts.at(-1), 'Messenger stays in its app'); assert.equal(f.toastActs.at(-1).label, 'Undo');
  f.toastActs.at(-1).run(); await tick();
  assert.equal(JSON.stringify(f.inbox.sourceSets.splice(0)), JSON.stringify([['messenger', { chats: true }]]), 'Undo brings it back');
  assert.equal(f.toasts.at(-1), 'Messenger is back in Chats');
  f.inbox.act('keep', 'n1'); await tick(); assert.deepEqual(f.inbox.sourceSets, [], 'a notification has no Keep');
  // Under Archive: the apps kept in their apps, one line; a tap on a name brings that app back.
  assert.equal(all(slot('archive-top'), 'ai-kept').length, 0, 'no line while every app shows in Chats');
  f.inbox.sources = [{ id: 'messenger', name: 'Messenger', chats: false }, { id: 'mail', name: 'Mail', chats: false }, { id: 'morning-report', name: 'Morning Report', chats: true }];
  f.inbox.push([rep]); await tick();
  const line = all(slot('archive-top'), 'ai-kept')[0]; assert.ok(line, 'a line under Archive');
  assert.equal(text(line), 'Kept in their apps: Messenger, Mail');
  const names = all(line, 'ai-kept-app'); assert.deepEqual(names.map(b => b.dataset.aiKept), ['messenger', 'mail']);
  names[1].fire('click', {}); await tick();
  assert.equal(JSON.stringify(f.inbox.sourceSets.splice(0)), JSON.stringify([['mail', { chats: true }]]));
  assert.equal(f.toasts.at(-1), 'Mail is back in Chats');
  assert.deepEqual(all(slot('archive-top'), 'ai-kept-app').map(b => b.dataset.aiKept), ['messenger']);
  // No Settings page: the choice lives on the item and under Archive.
  assert.equal(f.settings.length, 0, 'nothing in Settings');
  await f.clear();
  assert.equal(f.inbox.feedsOn, false, 'off with the package'); assert.equal(f.host.inboxFeeds, false); assert.equal(f.host.inboxKeep, false);
  assert.equal(all(slot('archive-top'), 'ai-kept').length, 0, 'the line goes with it');
  await f.mount('miguel/inbox');
}
