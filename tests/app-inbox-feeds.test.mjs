// App inbox feeds (Wizard OS inbox feed v1): an installed app that serves /<app>/api/inbox puts its "needs you"
// items (what its badge counts) into the one inbox beside Notifications items, with its own buttons. Done/Snooze
// marks cover the item's activity time, so newer activity in the app brings it back; the app's own action posts
// to /<app>/api/inbox/act and only for actions the app declared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../web/core/notif-bell.js', import.meta.url), 'utf8');
function load(feeds, marks = {}) {
  const S = { posts: [], gets: [], feeds, marks };
  const json = (d, ok = true) => ({ ok, headers: { get: () => 'application/json' }, json: async () => d });
  const fetch = async (url, o = {}) => {
    S.gets.push(url);
    if (o.method === 'POST') { S.posts.push([url, JSON.parse(o.body)]); if (url.includes('/api/mark')) { const b = JSON.parse(o.body); for (const id of b.ids) S.marks[id] = { read: !!(b.read || b.archived), archived: !!b.archived, at: b.at?.[id] || 0 }; } return json({ ok: true }); }
    if (url.includes('/notifications/api/items')) return json({ items: [{ id: 'n1', time: 100, title: 'Cron', message: 'ran' }] });
    if (url.includes('/notifications/api/count')) return json({ unread: 1, needs: 0 });
    if (url.includes('/notifications/api/marks')) return json({ marks: S.marks });
    const m = /^\/([a-z0-9-]+)\/api\/inbox$/.exec(url);
    if (m) return S.feeds[m[1]] ? json({ inbox: 1, items: S.feeds[m[1]] }) : { ok: false, status: 404, headers: { get: () => 'text/html' }, json: async () => ({}) };
    return json({});
  };
  const apps = { APPS: [{ id: 'messenger', kind: 'wizard', source: 'apps.json', name: 'Messenger' }, { id: 'files', kind: 'wizard', source: 'apps.json', name: 'Files' }, { id: 'wizard', kind: 'chats', name: 'Chats' }] };
  const win = { WizCanOpen: () => true, WizAppOpen: () => false, addEventListener() {}, dispatchEvent() {}, CustomEvent: class {},
    WizCore: { apps: () => apps, backendApps: () => [{ id: 'notifications' }], appMetadata: id => ({ id, name: id === 'messenger' ? 'Messenger' : id }) } };
  const ctx = { window: win, document: { addEventListener() {}, querySelectorAll: () => [] }, addEventListener() {}, setInterval() {}, setTimeout() {},
    fetch, CustomEvent: class {}, location: { origin: 'http://x' } };
  win.window = win; vm.runInNewContext(src, ctx);
  return { B: win.WosBell, S };
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const chat = (over = {}) => ({ key: 'chat:!a', title: 'Carlos', text: '2 new · see you at 5', time: 200, priority: 3, open: '#/chat/a',
  actions: [{ id: 'reply', label: 'Reply', input: true }, { id: 'draft', label: 'Draft me a reply', ask: 'Draft it' }, { id: 'read', label: 'Mark as read' }, { id: 'bad id!', label: 'x' }], ...over });

test('an app feed joins Notifications items, with its app, key, open path and declared buttons', async () => {
  const { B, S } = load({ messenger: [chat()] });
  let got = []; B.watch(i => { got = i; }); await settle();
  const a = got.find(i => i.app === 'messenger'); assert.ok(a, 'the app item is listed');
  assert.match(a.id, /^a-messenger-[0-9a-f]{16}$/); assert.equal(a.appName, 'Messenger'); assert.equal(a.key, 'chat:!a');
  assert.equal(a.open, '#/chat/a'); assert.equal(a.read, false);
  assert.deepEqual(a.actions.map(x => x.id), ['reply', 'draft', 'read'], 'only well-formed actions survive');
  assert.ok(got.some(i => i.id === 'n1'), 'Notifications items stay');
  assert.ok(!S.gets.includes('/wizard/api/inbox') && !S.gets.includes('/notifications/api/inbox'), 'Chats and Notifications are never probed as feeds');
});

test('an app without a feed is not asked again on the next read', async () => {
  const { B, S } = load({ messenger: [chat()] });
  B.watch(() => {}); await settle();
  const before = S.gets.filter(u => u === '/files/api/inbox').length; assert.equal(before, 1);
  await B.mark(['n1'], { read: true }); await settle();
  assert.equal(S.gets.filter(u => u === '/files/api/inbox').length, 1);
});

test('Done on an app item marks the activity it covers; newer activity brings it back unread', async () => {
  const feeds = { messenger: [chat()] };
  const { B, S } = load(feeds);
  let got = []; B.watch(i => { got = i; }); await settle();
  const id = got.find(i => i.app).id;
  await B.mark([id], { archived: true, read: true }); await settle();
  assert.equal(S.posts.find(p => p[0].includes('/api/mark'))[1].at[id], 200, 'the mark carries the item time');
  assert.equal(got.find(i => i.id === id).archived, true);
  feeds.messenger = [chat({ time: 300, text: '3 new' })];
  await B.mark(['n1'], { read: true }); await settle();
  const back = got.find(i => i.id === id); assert.equal(back.archived, false); assert.equal(back.read, false); assert.equal(back.message, '3 new');
});

test('an app action posts key, action and text to that app, and only declared non-ask actions', async () => {
  const { B, S } = load({ messenger: [chat()] });
  let got = []; B.watch(i => { got = i; }); await settle();
  const id = got.find(i => i.app).id;
  assert.equal(await B.act(id, 'reply', 'On my way'), true);
  assert.deepEqual(S.posts.at(-1), ['/messenger/api/inbox/act', { key: 'chat:!a', action: 'reply', text: 'On my way' }]);
  const n = S.posts.length;
  assert.equal(await B.act(id, 'draft'), false, 'an ask goes to Wizard, never to the app');
  assert.equal(await B.act(id, 'delete'), false, 'an undeclared action is refused');
  assert.equal(await B.act('n1', 'read'), false, 'a Notifications item has no app actions');
  assert.equal(S.posts.length, n);
});

test('feed text is data: unsafe open paths are dropped and fields are bounded', async () => {
  const { B } = load({ messenger: [chat({ key: 'k2', open: 'https://evil.example/x', title: 'x'.repeat(900) }), { title: 'no key' }] });
  let got = []; B.watch(i => { got = i; }); await settle();
  const apps = got.filter(i => i.app);
  assert.equal(apps.length, 1, 'an item without a key is skipped');
  assert.equal(apps[0].open, ''); assert.equal(apps[0].title.length, 300);
});
