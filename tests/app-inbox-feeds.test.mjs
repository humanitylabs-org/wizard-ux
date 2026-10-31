// App inbox feeds (Wizard OS inbox feed v1): an installed app that serves /<app>/api/inbox puts its "needs you"
// items (what its badge counts) into the one inbox beside Notifications items, with its own buttons. Done/Snooze
// marks cover the item's activity time, so newer activity in the app brings it back; the app's own action posts
// to /<app>/api/inbox/act and only for actions the app declared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../web/core/notif-bell.js', import.meta.url), 'utf8');
function load(feeds, marks = {}, { on = true, sources = {} } = {}) {
  const S = { posts: [], gets: [], feeds, marks, sources };
  const json = (d, ok = true) => ({ ok, headers: { get: () => 'application/json' }, json: async () => d });
  const fetch = async (url, o = {}) => {
    S.gets.push(url);
    if (o.method === 'POST') { S.posts.push([url, JSON.parse(o.body)]); if (url.includes('/api/sources')) { const b = JSON.parse(o.body); S.sources = { ...S.sources, [b.app]: { chats: b.chats, phone: true } }; return json({ ok: true, sources: S.sources }); } if (url.includes('/api/mark')) { const b = JSON.parse(o.body); for (const id of b.ids) S.marks[id] = { read: !!(b.read || b.archived), archived: !!b.archived, at: b.at?.[id] || 0 }; } return json({ ok: true }); }
    if (url.includes('/notifications/api/items')) return json({ items: [{ id: 'n1', time: 100, title: 'Cron', message: 'ran' }] });
    if (url.includes('/notifications/api/count')) return json({ unread: 1, needs: 0 });
    if (url.includes('/notifications/api/marks')) return json({ marks: S.marks });
    if (url.includes('/notifications/api/sources')) return json({ sources: S.sources });
    const m = /^\/([a-z0-9-]+)\/api\/inbox$/.exec(url);
    if (m) return S.feeds[m[1]] ? json({ inbox: 1, items: S.feeds[m[1]] }) : { ok: false, status: 404, headers: { get: () => 'text/html' }, json: async () => ({}) };
    return json({});
  };
  const apps = { APPS: [{ id: 'messenger', kind: 'wizard', source: 'apps.json', name: 'Messenger' }, { id: 'files', kind: 'wizard', source: 'apps.json', name: 'Files' }, { id: 'wizard', kind: 'chats', name: 'Chats' }] };
  const win = { WosSkinHost: { inboxList: true }, WizCanOpen: () => true, WizAppOpen: () => false, addEventListener() {}, dispatchEvent() {}, CustomEvent: class {},
    WizCore: { apps: () => apps, backendApps: () => [{ id: 'notifications' }], appMetadata: id => ({ id, name: id === 'messenger' ? 'Messenger' : id }) } };
  const ctx = { window: win, document: { addEventListener() {}, querySelectorAll: () => [] }, addEventListener() {}, setInterval() {}, setTimeout() {},
    fetch, CustomEvent: class {}, location: { origin: 'http://x' } };
  const ls = new Map(); ctx.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, String(v)) };
  win.window = win; vm.runInNewContext(src, ctx);
  if (on) win.WosBell.feeds(true);
  return { B: win.WosBell, S, ls };
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

const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
// Off by default: the feeds are a tweak's (miguel/inbox holds api.inbox.feeds). Until one holds them, the inbox is
// the stock Notifications-only path: no app is asked for a feed, no app item, no feed state saved on the device.
test('feeds off (stock): no app is ever asked for a feed and marks stay the plain Notifications ones', async () => {
  const { B, S, ls } = load({ messenger: [chat()] }, {}, { on: false });
  let got = []; B.watch(i => { got = i; }); await settle();
  same(got.map(i => i.id), ['n1'], 'only Notifications items');
  assert.equal(S.gets.filter(u => /\/api\/(inbox|marks|sources)/.test(u)).length, 0, 'no feed, marks or sources reads');
  await B.mark(['n1'], { read: true }); await settle();
  same(S.posts.map(p => p[0]), ['/notifications/api/mark']); assert.equal('at' in S.posts[0][1], false);
  assert.equal(S.gets.filter(u => /\/api\/inbox/.test(u)).length, 0);
  assert.equal(ls.size, 0, 'nothing kept on the device');
  assert.equal(B.readyCount(), 1);
  same(await B.sources.list(), [], 'no per-app choice to offer');
  assert.equal(await B.sources.set('messenger', { chats: false }), false);
});

test('turning the feeds off drops app items at once; on again brings them back', async () => {
  const { B } = load({ messenger: [chat()] });
  let got = []; B.watch(i => { got = i; }); await settle();
  assert.equal(got.filter(i => i.app).length, 1);
  B.feeds(false); await settle();
  assert.equal(got.filter(i => i.app).length, 0); assert.equal(B.readyCount(), 1);
  const id = 'a-messenger-' + '0'.repeat(16);
  assert.equal(await B.act(id, 'read'), false);
  B.feeds(true); await settle();
  assert.equal(got.filter(i => i.app).length, 1);
});

test('an app kept out of Chats (Notifications /api/sources chats:false): no rows, no count; still offered in Settings', async () => {
  const { B, S } = load({ messenger: [chat()], files: [chat({ key: 'f1', title: 'File' })] }, {}, { sources: { messenger: { chats: false, phone: true } } });
  let got = []; B.watch(i => { got = i; }); await settle();
  same(got.filter(i => i.app).map(i => i.app), ['files'], 'Messenger items stay in Messenger');
  assert.equal(B.readyCount(), 2, 'its items are not counted (Notifications + Files)');
  const list = await B.sources.list();
  same(list.map(r => [r.id, r.name, r.chats]), [['messenger', 'Messenger', false], ['files', 'files', true]], 'every app with a feed, hidden ones too');
  // Switching it back on is saved on the box (JSON) and the items return.
  assert.equal(await B.sources.set('messenger', { chats: true }), true); await settle();
  same(S.posts.at(-1), ['/notifications/api/sources', { app: 'messenger', chats: true }]);
  assert.ok(got.some(i => i.app === 'messenger'));
  // And off again hides them at once.
  assert.equal(await B.sources.set('messenger', { chats: false }), true); await settle();
  assert.equal(got.some(i => i.app === 'messenger'), false); assert.equal(B.readyCount(), 2);
  assert.equal(await B.sources.set('Bad Id', { chats: false }), false); assert.equal(await B.sources.set('files', { chats: 'no' }), false);
});

// Chats shows app buttons and sends typed words to an app only while the feeds are held (WosSkinHost.inboxFeeds).
test('chats.js gates every app-item control on the held feeds', () => {
  const c = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
  assert.match(c, /const feedsOn = \(\) => !!window\.WosSkinHost\?\.inboxFeeds;/);
  assert.match(c, /if \(!it\?\.app \|\| it\.archived \|\| !feedsOn\(\)\) return \[\];/, 'no app buttons');
  assert.match(c, /const noteInput = it => it\?\.app && feedsOn\(\)/, 'no typing to the app');
  assert.match(c, /how === 'typing in the Chats window' && !winAgent\(w\) && feedsOn\(\)/, 'typed words go to Wizard as stock');
  const h = readFileSync(new URL('../web/core/skin-host.js', import.meta.url), 'utf8');
  assert.match(h, /get inboxFeeds\(\) \{ return inboxFeeds\.size > 0; \}/);
  assert.doesNotMatch(h, /miguel\/(app-)?inbox/, 'core never names a package');
  assert.doesNotMatch(c + readFileSync(new URL('../web/core/notif-bell.js', import.meta.url), 'utf8'), /miguel\/(app-)?inbox/);
  // Keep <App> in its app: only on an app item, only while the feeds holder offers it.
  assert.match(c, /const noteKeep = it => it\?\.app && !it\.archived && feedsOn\(\) && window\.WosSkinHost\?\.inboxKeep \? \['keep'\] : \[\];/);
  assert.match(h, /get inboxKeep\(\) \{ for \(const h of inboxFeeds\.values\(\)\) if \(h\.keep\) return true; return false; \}/);
});

// The per-app choice is on the item and under Archive (Miguel, 31 Oct 2026): no Settings page for it.
test('no Notifications page in Settings; packages cannot add one', () => {
  const st = readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8');
  const h = readFileSync(new URL('../web/core/skin-host.js', import.meta.url), 'utf8');
  assert.doesNotMatch(st, /id: 'notifications', title: 'Notifications'/);
  assert.match(h, /const SETTINGS_PAGES = Object\.freeze\(\['overview', 'ai', 'network', 'storage'\]\);/);
});

// A toast with Undo: a separate adapter, so every plain toast is byte-for-byte the stock one.
test('a package toast may carry one button; plain toasts are unchanged', async () => {
  const { fixture } = await import('./fixtures/tweaks.mjs');
  const f = fixture(); let api;
  f.host._test.setImporter(async () => ({ default: value => { api = value; return () => {}; } }));
  await f.host.loadTweaks(['miguel/inbox'], f.slots, { teamAuthors: ['miguel'] });
  let ran = 0;
  api.toast('Plain'); api.toast('Kept', { action: 'Undo', run: () => { ran++; } });
  assert.deepEqual(f.toasts, ['Plain', 'Kept']); assert.equal(f.toastActs.length, 1); assert.equal(f.toastActs[0].label, 'Undo');
  f.toastActs[0].run(); assert.equal(ran, 1);
  await f.clear(); f.toastActs[0].run(); assert.equal(ran, 1, 'a dead package\'s Undo does nothing');
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'), desk = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
  assert.match(app, /toastAct: \(text, act\) => toast\('◇', esc\(String\(text \?\? ''\)\), 5000, act\),/);
  assert.match(desk, /toastAct: \(text, act\) => toast\('◇', text, 5000, act\),/);
});
