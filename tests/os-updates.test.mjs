// Settings → Updates (Automatic / Ask me, installed vs latest, Update now) over the App Manager's owner-only
// store-install listener, the same path and headers as the Store's Get.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../web/core/os-updates.js', import.meta.url), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));

async function load(reply) {
  const calls = [], registered = [];
  let refreshes = 0;
  const fetch = async (url, opts = {}) => {
    calls.push({ url, ...opts, body: opts.body && JSON.parse(opts.body) });
    const [status, body] = reply(opts.method || 'GET', opts.body && JSON.parse(opts.body));
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  const window = { WosSettings: { register: f => registered.push(f), refresh: () => refreshes++ } };
  const document = { currentScript: { src: 'https://box.ts.net/wizard-os-home/core/os-updates.js' } };
  new Function('window', 'document', 'fetch', 'location', src)(window, document, fetch, { href: 'https://box.ts.net/wizard-os-home/' });
  await tick(); await tick();
  return { U: window.WosUpdates, calls, registered, refreshes: () => refreshes };
}
const btn = osu => ({ closest: sel => (sel === '[data-osu]' ? { dataset: { osu } } : null) });
const ctx = () => { const t = []; return { t, toast: (...a) => t.push(a), render() {}, haptic() {} }; };
const STATUS = { mode: 'auto', chosen: false, installed: '0.3.15', latest: '0.3.16', update_available: true, unpinned: false, checked: true, installing: false };

test('reads the App Manager through the Store listener and registers one Settings group', async () => {
  const { U, calls, registered } = await load(() => [200, STATUS]);
  assert.equal(calls[0].url, 'https://box.ts.net/wizard-os-home/store-install/_updates');
  assert.equal(calls[0].credentials, 'same-origin');
  assert.equal(registered.length, 1);
  assert.equal(registered[0].id, 'updates');
  assert.equal(registered[0].available(), true);
  assert.equal(registered[0].page, 'release');                         // Settings › My release & updates
  const h = U.html();
  assert.doesNotMatch(h, /<h4>Updates<\/h4>/);
  assert.match(h, /<b class="rl-name" data-osu-title>Update available<\/b><small class="rl-base">Wizard OS 0\.3\.15 → 0\.3\.16<\/small>/);
  assert.match(h, /data-osu="apply"[^>]*>Update now</);
  assert.match(h, /data-osu="auto" role="radio" aria-checked="true"/);   // Automatic is the default
  assert.match(h, /data-osu="ask" role="radio" aria-checked="false"/);
});

test('up to date shows installed version and no Update button; Ask me is shown when chosen', async () => {
  const { U } = await load(() => [200, { ...STATUS, mode: 'ask', chosen: true, latest: '0.3.15', update_available: false }]);
  const h = U.html();
  assert.match(h, /Wizard OS 0\.3\.15<\/b><small class="rl-base">Up to date/);
  assert.doesNotMatch(h, /data-osu="apply"/);
  assert.match(h, /data-osu="ask" role="radio" aria-checked="true"/);
});

test('an unpinned box says it is updated by hand and offers no Update', async () => {
  const { U } = await load(() => [200, { ...STATUS, installed: null, update_available: false, unpinned: true }]);
  const h = U.html();
  assert.match(h, /Updated by hand/);
  assert.doesNotMatch(h, /data-osu="apply"/);
});

test('hidden when the App Manager has no updates route (older box or no Serve mount)', async () => {
  for (const reply of [() => [404, { error: 'no install for that app' }], () => [403, { error: 'owner only' }], () => { throw new Error('offline'); }]) {
    const { U, registered } = await load(reply);
    assert.equal(U.html(), '');
    assert.equal(registered[0].available(), false);
  }
});

test('choosing a mode and Update now POST the exact bodies with the Store headers; never force', async () => {
  let state = { ...STATUS };
  const { U, calls } = await load((method, body) => {
    if (method === 'GET') return [200, state];
    if (body.mode) { state = { ...state, mode: body.mode, chosen: true }; return [200, state]; }
    return [200, { ...state, started: true }];
  });
  const c = ctx();
  assert.equal(U.act(btn('ask'), c), true);
  await tick(); await tick();
  const post = calls.find(x => x.method === 'POST');
  assert.deepEqual(post.body, { mode: 'ask' });
  assert.equal(post.headers['X-Wizard-Store'], '1');
  assert.equal(post.headers['Content-Type'], 'application/json');
  assert.equal(U.state.mode, 'ask');
  assert.deepEqual(c.t.at(-1), ['✓', 'Updates: Ask me', 1800]);
  assert.equal(U.act(btn('apply'), c), true);
  await tick(); await tick();
  const apply = calls.filter(x => x.method === 'POST').at(-1);
  assert.deepEqual(apply.body, { action: 'apply' });
  assert.equal(U.state.installing, true);
  assert.match(U.html(), /Updating…/);
  assert.doesNotMatch(U.html(), /data-osu="apply"/);
  assert.ok(!calls.some(x => x.body && 'force' in x.body));
});

test('a refused write keeps the old state and tells the owner', async () => {
  const { U } = await load((method) => method === 'GET' ? [200, STATUS] : [403, { error: 'only the box owner can install from the Store' }]);
  const c = ctx();
  U.act(btn('ask'), c);
  await tick(); await tick();
  assert.equal(U.state.mode, 'auto');
  assert.deepEqual(c.t.at(-1), ['!', 'only the box owner can install from the Store', 2600]);
});

test('an update cut short by a reboot says interrupted, retrying, and offers Update now again', async () => {
  const { U } = await load(() => [200, { ...STATUS, installing: false, interrupted: true }]);
  const h = U.html();
  assert.match(h, /<b class="rl-name" data-osu-title>Update interrupted · retrying<\/b><small class="rl-base">Wizard OS 0\.3\.15 → 0\.3\.16 · tries again tonight, or tap Update now/);
  assert.match(h, /data-osu="apply"[^>]*>Update now</);
  const ask = await load(() => [200, { ...STATUS, mode: 'ask', chosen: true, interrupted: true }]);
  assert.match(ask.U.html(), /<b class="rl-name" data-osu-title>Update interrupted<\/b><small class="rl-base">[^<]*tap Update now to try again/);
  const old = await load(() => [200, { ...STATUS }]);              // an App Manager without the field: unchanged
  assert.match(old.U.html(), /data-osu-title>Update available<\/b>/);
});

test('channel picker: hidden on an App Manager without channels, shown with Stable checked when it has them', async () => {
  const old = await load(() => [200, STATUS]);
  assert.doesNotMatch(old.U.html(), /Release channel/);
  const { U } = await load(() => [200, { ...STATUS, channel: 'stable', stable: '0.3.16' }]);
  const h = U.html();
  assert.match(h, /data-osu="ch-stable" role="radio" aria-checked="true"/);
  assert.match(h, /data-osu="ch-latest" role="radio" aria-checked="false"[^>]*>Latest</);
  assert.match(h, /Tested\. Fixes arrive the same day\./);           // one line on what the chosen channel means
});

test('on latest with Automatic it says Automatic installs stable only; choosing a channel POSTs only {channel}', async () => {
  let state = { ...STATUS, channel: 'stable', stable: '0.3.16' };
  const { U, calls } = await load((method, body) => {
    if (method === 'GET') return [200, state];
    state = { ...state, channel: body.channel, latest: '0.3.17' }; return [200, { channel: body.channel, ...state }];
  });
  const c = ctx();
  assert.equal(U.act(btn('ch-latest'), c), true);
  await tick(); await tick();
  const post = calls.find(x => x.method === 'POST');
  assert.deepEqual(post.body, { channel: 'latest' });
  assert.equal(post.headers['X-Wizard-Store'], '1');
  assert.equal(U.state.channel, 'latest');
  assert.match(U.html(), /data-osu="ch-latest" role="radio" aria-checked="true"/);
  assert.match(U.html(), /Every approved change, within hours\. Automatic installs Stable only\./);
  assert.match(c.t[0][1], /Channel: Latest/);
  const n = calls.length;
  U.act(btn('ch-latest'), ctx()); await tick();
  assert.equal(calls.length, n);   // re-tapping the current channel sends nothing
});

test('my release: the summary names it and its base, and Your changes lists each change', async () => {
  const MINE = { name: "Miguel's release", base: { ref: 'b79c1e9', label: 'Latest b79c1e9' }, changes: [{ sha: 'abc1234', title: 'Updates shows my release', status: 'Mine', date: '2026-10-24' }] };
  const { U, calls } = await load((m, b) => [200, STATUS]);
  assert.equal(calls[0].url, 'https://box.ts.net/wizard-os-home/store-install/_updates');
  assert.equal(calls[1].url, 'https://box.ts.net/wizard-os-home/my-release.json');
  assert.doesNotMatch(U.html(), /Your changes/);                       // no my-release.json: nothing new
  const r2 = await (async () => {
    const calls = [], registered = [];
    const fetch = async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => url.endsWith('my-release.json') ? MINE : STATUS }; };
    const window = { WosSettings: { register: f => registered.push(f), refresh() {} } };
    const document = { currentScript: { src: 'https://box.ts.net/wizard-os-home/core/os-updates.js' } };
    new Function('window', 'document', 'fetch', 'location', src)(window, document, fetch, { href: 'https://box.ts.net/wizard-os-home/' });
    for (let i = 0; i < 4; i++) await tick();
    return window.WosUpdates;
  })();
  let h = r2.html();
  assert.match(h, /<b class="rl-name" data-osu-title>Miguel&#39;s release<\/b><small class="rl-base">Built on Latest b79c1e9<\/small><small>1 change of your own<\/small><span class="rl-state ready">Update available<\/span>/);   // stock update states stay
  assert.deepEqual(r2.hero(), { title: "Miguel's release", lines: ['Built on Latest b79c1e9', '1 change of your own'], state: 'Update available', tone: 'ready', mine: true });
  assert.match(h, /data-osu="mine"[^>]*aria-expanded="false"/);
  assert.doesNotMatch(h, /Updates shows my release/);
  assert.equal(r2.act(btn('mine'), ctx()), true);
  h = r2.html();
  assert.match(h, /data-osu="mine"[^>]*aria-expanded="true"/);
  assert.match(h, /data-osu-change="abc1234"><span class="rl-ct"><b>Updates shows my release<\/b><span class="rl-meta"><span class="rl-chip rl-mine">Mine<\/span><small>24 Oct<\/small><\/span><\/span><button type="button" class="rl-propose" data-osu="propose" data-sha="abc1234"/);
  assert.match(h, /<details class="rl-legend"><summary>What the labels mean<\/summary><p><b>Mine<\/b> only on your Wizard · <b>Feature<\/b> review, then Latest, then Stable · <b>Fix<\/b> fast lane to Stable\./);   // the lanes fold into one line
  assert.doesNotMatch(h, /<dl class="rl-legend"/);
  assert.equal(r2.act(btn('mine'), ctx()), true);
  assert.doesNotMatch(r2.html(), /data-osu-change/);
});

test('my release: each change gets a status chip from my-release.json (default Mine), and the toggle works even while busy or before the App Manager answers', async () => {
  const MINE = { name: 'My release', base: { ref: 'b79c1e9' }, changes: [
    { sha: 'a', title: 'A', status: 'Proposed feature' }, { sha: 'b', title: 'B', status: 'Proposed fix' },
    { sha: 'c', title: 'C' }, { sha: 'd', title: 'D', status: 'Merged' }] };
  const fetch = async (url) => url.endsWith('my-release.json') ? { ok: true, status: 200, json: async () => MINE } : { ok: false, status: 404, json: async () => ({}) };
  const registered = [], window = { WosSettings: { register: f => registered.push(f), refresh() {} } };
  const document = { currentScript: { src: 'https://box.ts.net/wizard-os-home/core/os-updates.js' } };
  new Function('window', 'document', 'fetch', 'location', src)(window, document, fetch, { href: 'https://box.ts.net/wizard-os-home/' });
  for (let i = 0; i < 4; i++) await tick();
  const U = window.WosUpdates;
  assert.equal(registered[0].available(), true, 'a box with my-release.json still shows My release when the App Manager is silent');
  assert.equal(U.hero().title, 'My release');
  assert.match(U.hero().lines[0], /Built on b79c1e9/);
  assert.match(U.html(), /<small>1 mine · 1 feature · 1 fix · 1 merged<\/small>/);
  assert.doesNotMatch(U.html(), /data-osu="(auto|ask|apply)"/);   // no App Manager: no install choices to offer
  assert.equal(U.act(btn('mine'), ctx()), true);
  const h = U.html();
  for (const [sha, cls, label] of [['a', 'feature', 'Proposed feature'], ['b', 'fix', 'Proposed fix'], ['c', 'mine', 'Mine'], ['d', 'merged', 'Merged']])
    assert.match(h, new RegExp(`data-osu-change="${sha}">[\\s\\S]*?<span class="rl-chip rl-${cls}">${label}</span>`), sha);
  assert.equal(U.kind('proposed FIX'), 'fix');
  assert.equal(U.kind(undefined), 'mine');
});

// Shared harness for My release: my-release.json plus an App Manager reply, optional shell hooks.
async function mineBox(MINE, status = STATUS, extra = {}) {
  const fetch = async (url) => url.endsWith('my-release.json') ? { ok: true, status: 200, json: async () => MINE }
    : status ? { ok: true, status: 200, json: async () => status } : { ok: false, status: 404, json: async () => ({}) };
  const registered = [], window = { WosSettings: { register: f => registered.push(f), refresh() {} }, ...extra };
  const document = { currentScript: { src: 'https://box.ts.net/wizard-os-home/core/os-updates.js' } };
  new Function('window', 'document', 'fetch', 'location', src)(window, document, fetch, { href: 'https://box.ts.net/wizard-os-home/' });
  for (let i = 0; i < 4; i++) await tick();
  return { U: window.WosUpdates, window, registered };
}
const pbtn = sha => ({ closest: sel => (sel === '[data-osu]' ? { dataset: { osu: 'propose', sha } } : null) });
const RELEASE = { name: "Miguel's release", base: { ref: 'b79c1e9', label: 'Latest b79c1e9' }, changes: [
  { sha: 'aaa1111', title: 'Docs: skins are look, the My release layer (web/mine) is behaviour and layout (wizard-os#186)', status: 'Mine', date: '2026-10-23' },
  { sha: 'bbb2222', title: 'feat(chats): send-and-go opens a fresh New chat', label: 'Sends open a fresh chat', status: 'Mine' },
  { sha: 'ccc3333', title: 'fix: Store toast on 502 (#99)', status: 'Proposed fix' },
  { sha: 'ddd4444', title: 'Workspace sync', status: 'Proposed feature' },
  { sha: 'eee5555', title: 'Old thing', status: 'Merged' }] };

test('my release: no "Up to date" pill; a quiet "Rebuilt hourly · last …" line from built_at instead', async () => {
  const built = new Date(Date.now() - 20 * 60e3).toISOString();
  const upToDate = { ...STATUS, mode: 'ask', chosen: true, latest: '0.3.15', update_available: false };
  const { U } = await mineBox({ ...RELEASE, built_at: built }, upToDate);
  const h = U.hero();
  assert.equal(h.state, '', 'his own release is always current: no pill');
  assert.deepEqual(h.lines, ['Built on Latest b79c1e9', '5 changes of your own', 'Rebuilt hourly · last 20 min ago']);
  assert.doesNotMatch(U.html(), /Up to date|rl-state/);
  const none = await mineBox(RELEASE, upToDate);                       // built_at missing: the line is left out
  assert.deepEqual(none.U.hero().lines, ['Built on Latest b79c1e9', '5 changes of your own']);
  assert.equal(none.U.hero().state, '');
  const bad = await mineBox({ ...RELEASE, built_at: 'not a date' }, upToDate);
  assert.equal(bad.U.hero().lines.length, 2);
  for (const [s, state, tone] of [[{ ...STATUS }, 'Update available', 'ready'], [{ ...STATUS, installing: true }, 'Updating…', 'busy'], [{ ...STATUS, interrupted: true, mode: 'ask' }, 'Update interrupted', 'ready']]) {
    const r = await mineBox({ ...RELEASE, built_at: built }, s);
    assert.equal(r.U.hero().state, state); assert.equal(r.U.hero().tone, tone);
  }
  assert.equal(U.ago(new Date(Date.now() - 3 * 3600e3).toISOString()), '3 h ago');
  assert.equal(U.ago(new Date().toISOString()), 'just now');
  const stock = await load(() => [200, upToDate]);                     // stock boxes keep "Up to date"
  assert.match(stock.U.html(), /Wizard OS 0\.3\.15<\/b><small class="rl-base">Up to date/);
});

test('my release: each change reads in plain words: own label, else the title without prefix or issue ref', async () => {
  const { U } = await mineBox(RELEASE);
  for (const [c, want] of [
    [{ title: 'Docs: skins are look, the My release layer (web/mine) is behaviour and layout (wizard-os#186)' }, 'Skins are look, the My release layer (web/mine) is behaviour and layout'],
    [{ title: 'fix: dock overlaps the last row' }, 'Dock overlaps the last row'],
    [{ title: 'feat(chats): Enter sends (#12)' }, 'Enter sends'],
    [{ title: 'Workspace sync: the same desks on every device (wizard-os#186)' }, 'Workspace sync: the same desks on every device'],
    [{ title: 'fix(x)!: breaking thing' }, 'Breaking thing'],
    [{ title: 'feat: x', label: 'Own words' }, 'Own words'],
    [{ title: '', sha: 'abc' }, 'abc']]) assert.equal(U.label(c), want, c.title);
  U.act(btn('mine'), ctx());
  const h = U.html();
  assert.match(h, /<b>Skins are look, the My release layer \(web\/mine\) is behaviour and layout<\/b>/);
  assert.match(h, /<b>Sends open a fresh chat<\/b>/);
  assert.match(h, /<small>23 Oct<\/small>/);
  assert.doesNotMatch(h, /wizard-os#186|Docs:|feat\(chats\)/);
});

test('my release: Propose only on Mine rows', async () => {
  const { U } = await mineBox(RELEASE);
  U.act(btn('mine'), ctx());
  const h = U.html(), rows = [...h.matchAll(/<li data-osu-change="([^"]+)">([\s\S]*?)<\/li>/g)];
  assert.equal(rows.length, 5);
  for (const [, sha, body] of rows) assert.equal(/data-osu="propose"/.test(body), ['aaa1111', 'bbb2222'].includes(sha), sha);
  assert.match(h, /data-osu="propose" data-sha="bbb2222" aria-label="Propose Sends open a fresh chat to main">Propose<\/button>/);
});

test('my release: Propose opens a fresh chat through the shell hook with the change as a reply; no hook = toast', async () => {
  const calls = [];
  const hook = (key, item) => { calls.push([key, item]); return { kind: 'unsent-draft', id: 'new:x', sent: false }; };
  const phone = await mineBox(RELEASE, STATUS, { __wos: { openContextDraft: hook } });
  const c = ctx();
  assert.equal(phone.U.act(pbtn('aaa1111'), c), true);
  assert.deepEqual(calls, [['release-change:aaa1111', { title: 'Propose to main: Skins are look, the My release layer (web/mine) is behaviour and layout', message: "Change aaa1111 from my release.\nSay feature or fix, and I'll open the PR." }]]);
  assert.equal(c.t.length, 0);
  assert.match(calls[0][0], /^[a-z][a-z0-9-]{0,40}:[A-Za-z0-9_-]{1,128}$/, 'the key is one chat-kit accepts for a reply');
  const desk = []; const d = await mineBox(RELEASE, STATUS, { __wux: { openContextDraft: (k, i) => desk.push([k, i.title]) } });
  d.U.act(pbtn('bbb2222'), ctx());
  assert.deepEqual(desk, [['release-change:bbb2222', 'Propose to main: Sends open a fresh chat']]);
  phone.U.act(pbtn('ccc3333'), ctx()); phone.U.act(pbtn('nope'), ctx());   // a proposed change, an unknown sha: nothing
  assert.equal(calls.length, 1);
  const bare = await mineBox(RELEASE, STATUS);
  const t = ctx(); assert.equal(bare.U.act(pbtn('aaa1111'), t), true);
  assert.equal(t.t[0][0], '!'); assert.match(t.t[0][1], /Couldn’t open a chat/);
  const thrown = await mineBox(RELEASE, null, { __wos: { openContextDraft: () => { throw new Error('Chats unavailable'); } } });
  const e = ctx(); thrown.U.act(pbtn('aaa1111'), e);                     // works before the App Manager answers too
  assert.deepEqual(e.t[0].slice(0, 2), ['!', 'Chats unavailable']);
});

test('shells expose openContextDraft on the same path as the Notifications Reply wiring', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const desk = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
  assert.match(app, /function openContextDraft\(key, item\) \{ closeSheets\(true\); const cw = placeApp\(mainChats, \{ app: 'chats', thread: null \}, \{\}\);[^\n]*CHATS\.openContextDraft\(cw\.id, key, item\); CHATS\.renderChats\(cw\)/);
  assert.match(app, /openThread: \(sid, opts\) => CHATS\.openHosted\(w\.id, f, sid, opts\), openContextDraft, isVisible/);
  assert.match(app, /openSettings, openContextDraft, unsentAll/);
  assert.match(desk, /function openContextDraft\(key, item\) \{ closeSettings\(\); let cw = ws\[cur\]\.wins\.map\(id => W\[id\]\)\.find\(mainChats\);[^\n]*CHATS\.openContextDraft\(cw\.id, key, item\); CHATS\.renderChats\(cw\); syncChatsPane\(cw\.id\)/);
  assert.match(desk, /openThread: \(sid, opts\) => CHATS\.openHosted\(w\.id, f, sid, opts\), openContextDraft, isVisible/);
  assert.match(desk, /openSettings, closeSettings, openContextDraft,/);
});
