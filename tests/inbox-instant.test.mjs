// Instant app items (inbox feed contract v1.1): a feed that carries `watch` + `version` gets one long poll
// (GET /<app>/<watch>?v=<version>) that the app answers when its feed changes. The new item lands without any
// other read, only for apps that declare it, only while the page is visible and a package watches the feeds, and
// errors back off 5 s / 30 s / 2 min. Also: a failed first probe (restart, timeout) never writes an app off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../web/core/notif-bell.js', import.meta.url), 'utf8');
const json = (d, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => d });
const chat = (key, title, time) => ({ key, title, text: 'hi', time, priority: 3, open: '#chat=' + key, actions: [{ id: 'read', label: 'Mark as read' }] });

function load({ feeds = {}, watch = { messenger: true }, ls: seed = {}, feedStatus = {} } = {}) {
  const S = { gets: [], waits: [], delays: [], feeds, version: { messenger: 'v1' }, feedStatus };
  const fetch = (url, o = {}) => {
    S.gets.push(url);
    if (url.includes('/notifications/api/items')) return Promise.resolve(json({ items: [] }));
    if (url.includes('/notifications/api/count')) return Promise.resolve(json({ unread: 0, needs: 0 }));
    if (url.includes('/notifications/api/marks')) return Promise.resolve(json({ marks: {} }));
    if (url.includes('/notifications/api/sources')) return Promise.resolve(json({ sources: {} }));
    const w = /^\/([a-z0-9-]+)\/api\/inbox\/wait\?v=(.*)$/.exec(url);
    if (w) return new Promise((resolve, reject) => {
      const entry = { app: w[1], v: decodeURIComponent(w[2]), resolve: d => resolve(typeof d === 'number' ? json({ error: 'x' }, d) : json(d)), aborted: false };
      o.signal?.addEventListener('abort', () => { entry.aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
      S.waits.push(entry);
    });
    const m = /^\/([a-z0-9-]+)\/api\/inbox$/.exec(url);
    if (m) {
      const st = S.feedStatus[m[1]]; if (st) return Promise.resolve(json({}, st));
      if (!S.feeds[m[1]]) return Promise.resolve({ ok: false, status: 404, headers: { get: () => 'text/html' }, json: async () => ({}) });
      return Promise.resolve(json({ inbox: 1, items: S.feeds[m[1]], ...(watch[m[1]] ? { watch: 'api/inbox/wait', version: S.version[m[1]] } : {}) }));
    }
    return Promise.resolve(json({}));
  };
  const apps = { APPS: ['messenger', 'morning-report', 'files'].map(id => ({ id, kind: 'wizard', source: 'apps.json', name: id })) };
  const listeners = {};
  const doc = { hidden: false, addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, querySelectorAll: () => [] };
  const win = { WosSkinHost: { inboxList: true }, WizCanOpen: () => true, WizAppOpen: () => false, addEventListener() {}, dispatchEvent() {}, CustomEvent: class {},
    WizCore: { apps: () => apps, backendApps: () => [{ id: 'notifications' }], appMetadata: id => ({ id, name: id }) } };
  // Back-off pauses are recorded and run at once; the 40 s safety abort stays a real (unref'd) timer.
  const setT = (fn, ms) => { if (ms === 40000) { const t = setTimeout(fn, ms); t.unref?.(); return t; } if (ms >= 5000) S.delays.push(ms); return setTimeout(fn, ms >= 5000 ? 0 : ms); };
  const ctx = { window: win, document: doc, addEventListener() {}, setInterval() {}, setTimeout: setT, clearTimeout, AbortController, Date,
    fetch, CustomEvent: class {}, location: { origin: 'http://x' } };
  const ls = new Map(Object.entries(seed)); ctx.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, String(v)) };
  win.window = win; vm.runInNewContext(src, ctx);
  const visible = v => { doc.hidden = !v; for (const f of listeners.visibilitychange || []) f(); };
  return { B: win.WosBell, S, ls, visible };
}
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const open = S => S.waits.filter(w => !w.aborted && !w.done);
const answer = (S, d) => { const w = open(S)[0]; assert.ok(w, 'a wait is open'); w.done = true; w.resolve(d); return w; };

test('a declaring app gets exactly one wait; a change it returns becomes a row with no other read', async () => {
  const { B, S } = load({ feeds: { messenger: [], 'morning-report': [chat('ed:1', 'Report', 50)] }, watch: { messenger: true } });
  B.feeds(true); let got = []; B.watch(i => { got = i; }); await settle();
  assert.equal(open(S).length, 1, 'one wait'); assert.equal(open(S)[0].app, 'messenger'); assert.equal(open(S)[0].v, 'v1');
  assert.ok(!S.waits.some(w => w.app === 'morning-report'), 'apps without watch stay on the cadence');
  const reads = S.gets.length, t = Date.now();
  answer(S, { inbox: 1, changed: true, version: 'v2', watch: 'api/inbox/wait', items: [chat('chat:a', 'Carlos', 300)] });
  await settle();
  const row = got.find(i => i.app === 'messenger');
  assert.ok(row, 'the new item is listed'); assert.equal(row.title, 'Carlos'); assert.equal(row.read, false);
  assert.ok(Date.now() - t < 1000, 'well under a second after the wait returned');
  assert.ok(got.some(i => i.app === 'morning-report'), 'other apps keep their items');
  assert.equal(S.gets.slice(reads).filter(u => /\/api\/inbox$|api\/items/.test(u)).length, 0, 'no other feed or items read');
  assert.equal(open(S).length, 1, 'the next wait is open'); assert.equal(open(S)[0].v, 'v2', 'with the new version');
  answer(S, { inbox: 1, changed: true, version: 'v3', watch: 'api/inbox/wait', items: [] }); await settle();
  assert.equal(got.filter(i => i.app === 'messenger').length, 0, 'read in the app: the row leaves at once');
});

test('a quiet timeout just waits again with the same version', async () => {
  const { B, S } = load({ feeds: { messenger: [] } });
  B.feeds(true); B.watch(() => {}); await settle();
  answer(S, { inbox: 1, changed: false, version: 'v1', watch: 'api/inbox/wait' });
  // A quiet answer that came back at once is held 5 s (no spin), then the next wait opens.
  await settle(); assert.deepEqual(S.delays, [5000]); await new Promise(r => setTimeout(r, 5)); await settle();
  assert.equal(open(S).length, 1); assert.equal(open(S)[0].v, 'v1');
});

test('errors back off 5 s, 30 s, then 2 min, and a success resets it', async () => {
  const { B, S } = load({ feeds: { messenger: [] } });
  B.feeds(true); B.watch(() => {}); await settle();
  for (let i = 0; i < 4; i++) { answer(S, 502); await settle(); await new Promise(r => setTimeout(r, 2)); await settle(); }
  assert.deepEqual(S.delays, [5000, 30000, 120000, 120000]);
  S.delays.length = 0;
  answer(S, { inbox: 1, changed: true, version: 'v2', watch: 'api/inbox/wait', items: [] }); await settle();
  answer(S, 502); await settle(); assert.deepEqual(S.delays, [5000]);
});

test('no wait while hidden, without a package holding the feeds, or without a watcher', async () => {
  const { B, S, visible } = load({ feeds: { messenger: [] } });
  B.watch(() => {}); await settle();
  assert.equal(S.waits.length, 0, 'feeds off (stock): no wait'); assert.equal(S.gets.filter(u => u.includes('/api/inbox')).length, 0);
  B.feeds(true); await settle(); assert.equal(open(S).length, 1);
  visible(false); await settle(); assert.equal(open(S).length, 0, 'hidden: the wait is closed');
  visible(true); await settle(); assert.equal(open(S).length, 1, 'visible again: one wait');
  B.feeds(false); await settle(); assert.equal(open(S).length, 0, 'feeds off: closed');
  const { B: B2, S: S2 } = load({ feeds: { messenger: [] } });
  B2.feeds(true); const stop = B2.watch(() => {}); await settle(); assert.equal(open(S2).length, 1);
  stop(); await settle(); assert.equal(open(S2).length, 0, 'nobody watching: closed');
});

test('an unsafe watch path is ignored', async () => {
  const { B, S } = load({ feeds: { messenger: [] } });
  S.version.messenger = 'v1';
  const real = S.feeds; S.feeds = real;
  B.feeds(true); B.watch(() => {}); await settle();
  assert.equal(open(S).length, 1);
  answer(S, { inbox: 1, changed: true, version: 'v2', watch: '../../wizard/v1/x', items: [] }); await settle();
  assert.equal(open(S).length, 0, 'a watch path outside the app is never requested');
});

test('a first probe that fails (restart, 502) never writes the app off; the old v1 "no" is not used', async () => {
  const old = JSON.stringify({ messenger: { s: 'no', at: Date.now() - 60e3 } });
  const { B, S, ls } = load({ feeds: { messenger: [chat('chat:a', 'Carlos', 300)] }, ls: { 'wos.inbox.feeds.v1': old }, feedStatus: { messenger: 502 } });
  B.feeds(true); let got = []; B.watch(i => { got = i; }); await settle();
  assert.equal(S.gets.filter(u => u === '/messenger/api/inbox').length, 1, 'v1 "no" ignored: asked');
  assert.equal(JSON.parse(ls.get('wos.inbox.feeds.v2') || '{}').messenger, undefined, 'a 502 is not saved as "no feed"');
  delete S.feedStatus.messenger;
  await B.mark(['x'], { read: true }); await settle();
  assert.equal(S.gets.filter(u => u === '/messenger/api/inbox').length, 1, 'not hammered: retried after 2 min');
  const { B: B3, S: S3 } = load({ feeds: { messenger: [chat('chat:a', 'Carlos', 300)] }, ls: { 'wos.inbox.feeds.v2': JSON.stringify({ messenger: { s: 'no', at: Date.now() - 31 * 60e3 } }) } });
  B3.feeds(true); let got3 = []; B3.watch(i => { got3 = i; }); await settle();
  assert.ok(got3.some(i => i.app === 'messenger'), 'a "no" older than 30 min is asked again and the rows show');
  assert.equal(open(S3).length, 1);
  void got; void S3;
});

test('a 404 is still a definite "no" for 30 minutes', async () => {
  const { B, S, ls } = load({ feeds: {} });
  B.feeds(true); B.watch(() => {}); await settle();
  assert.equal(JSON.parse(ls.get('wos.inbox.feeds.v2')).files.s, 'no');
  await B.mark(['x'], { read: true }); await settle();
  assert.equal(S.gets.filter(u => u === '/files/api/inbox').length, 1);
});
