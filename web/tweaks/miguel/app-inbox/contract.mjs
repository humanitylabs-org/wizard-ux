import assert from 'node:assert/strict';
export default async function check(f) {
  const tick = () => new Promise(r => setTimeout(r, 0));
  const all = (n, cls, out = []) => { if ((n.className || '').split(' ').includes(cls)) out.push(n); n.children.forEach(c => all(c, cls, out)); return out; };
  // Holding the feeds is what turns them on; stock Chats never asks an app for one.
  assert.equal(f.inbox.feedsOn, true, 'app feeds are on while the package lives');
  assert.equal(f.host.inboxFeeds, true, 'Chats shows app buttons while it is held');
  const msg = { id: 'a-messenger-0123456789abcdef', app: 'messenger', appName: 'Messenger', key: 'chat:!a', title: 'Carlos', message: '2 new', time: 5, read: false, archived: false,
    actions: [{ id: 'reply', label: 'Reply', input: true }, { id: 'draft', label: 'Draft me a reply', ask: 'Draft a reply. Don’t send it.' }, { id: 'read', label: 'Mark as read' }] };
  const rep = { id: 'a-morning-report-0123456789abcdef', app: 'morning-report', appName: 'Morning Report', key: 'edition:1', title: 'Today', message: 'New edition', time: 4, read: false, archived: false, actions: [] };
  f.inbox.push([msg, rep, { id: 'n1', title: 'Cron', message: 'ran', time: 3, read: false, archived: false }]);
  // The app's own buttons.
  assert.equal(f.inbox.act('app', msg.id), true); assert.deepEqual(f.inbox.opened.splice(0), [['messenger']], 'Open opens the app');
  assert.equal(f.inbox.act('x:read', msg.id), true); await tick(); assert.deepEqual(f.inbox.appActs.splice(0), [[msg.id, 'read']], 'a plain action runs in the app');
  assert.equal(f.inbox.act('x:draft', msg.id), true); assert.deepEqual(f.inbox.replies.splice(0), [[msg.id, 'Draft a reply. Don’t send it.']], 'an ask goes to Wizard with the item');
  assert.deepEqual(f.inbox.appActs, [], 'and never to the app');
  assert.equal(f.inbox.act('x:nope', msg.id), true); await tick(); assert.deepEqual(f.inbox.appActs, [], 'an undeclared action does nothing');
  // Done = the app's finishing action when it has one; otherwise it is the notifications package's (none mounted here).
  assert.equal(f.inbox.act('done', msg.id), true); await tick(); assert.deepEqual(f.inbox.appActs.splice(0), [[msg.id, 'read']], 'Done on Messenger = Mark as read');
  assert.equal(f.inbox.act('done', rep.id), false, 'an app without a finishing action falls through');
  assert.equal(f.inbox.act('snooze', msg.id), false, 'Snooze is not this package’s');
  assert.equal(f.inbox.act('done', 'n1'), false, 'notifications are not this package’s');
  assert.deepEqual(f.inbox.done, []);
  // Settings › Notifications: one switch per app with a feed.
  const sec = f.settings.find(s => s.page === 'notifications'); assert.ok(sec, 'a section on the Notifications page');
  const slot = f.doc.createElement('div'); sec.painted({}, { firstElementChild: slot });
  f.inbox.sources = [{ id: 'messenger', name: 'Messenger', chats: true }, { id: 'mail', name: 'Mail', chats: false }];
  f.inbox.push([msg]); await tick(); await tick();
  const rows = all(slot, 'ai-row'); assert.equal(rows.length, 2, 'every app with a feed');
  assert.deepEqual(rows.map(r => [r.dataset.aiApp, r.attrs['aria-checked']]), [['messenger', 'true'], ['mail', 'false']]);
  assert.ok(all(slot, 'st-note')[0].textContent.includes('badge'), 'one line on what off means');
  rows[0].fire('click', {}); await tick(); await tick();
  assert.equal(JSON.stringify(f.inbox.sourceSets.splice(0)), JSON.stringify([['messenger', { chats: false }]]), 'a tap saves it on the box');
  assert.equal(all(slot, 'ai-row')[0].attrs['aria-checked'], 'false');
  // Together with the notifications package: Done without an app action, Snooze and Resolve go there.
  await f.host.loadTweaks(['wizard/unified-inbox', 'miguel/app-inbox'], f.slots, { teamAuthors: ['miguel', 'wizard'] });
  f.inbox.push([msg, rep]);
  f.inbox.act('done', rep.id); assert.deepEqual(f.inbox.done.splice(0), [rep.id], 'Done falls back to the inbox mark');
  f.inbox.act('done', msg.id); await tick(); assert.deepEqual(f.inbox.appActs.splice(0), [[msg.id, 'read']], 'still the app’s Mark as read');
  assert.deepEqual(f.inbox.done, []);
  f.inbox.act('snooze', msg.id); assert.equal(JSON.stringify(f.inbox.sets.splice(0)), JSON.stringify([[msg.id, { read: true }]]));
  f.inbox.act('app', rep.id); assert.deepEqual(f.inbox.opened.splice(0), [['morning-report']]);
  await f.host.loadTweaks(['wizard/unified-inbox'], f.slots, { teamAuthors: ['miguel', 'wizard'] });
  assert.equal(f.inbox.feedsOn, false, 'off with the package'); assert.equal(f.host.inboxFeeds, false);
  f.inbox.act('app', rep.id); assert.deepEqual(f.inbox.opened, [], 'no app buttons without it');
  assert.equal(f.settings.some(s => s.page === 'notifications'), false, 'and no Settings section');
  await f.host.loadTweaks(['miguel/app-inbox'], f.slots, { teamAuthors: ['miguel', 'wizard'] });
  await f.clear(); assert.equal(f.inbox.feedsOn, false); assert.equal(f.host.inboxFeeds, false); assert.equal(f.settings.length, 0);
}
