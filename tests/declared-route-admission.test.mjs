// A spoken declared route ("music") opens its app exactly like a tap (Archimedes, 7 Nov 2026; review of #1135):
//  1. the route is confirmed against the box's FRESH app list before anything opens; the device cache stands in only
//     when that read fails, and never for an app the registry no longer has;
//  2. it goes through the shell's own openApp, so an app that needs setup shows its normal setup sheet first;
//  3. it honours the desk the take is aimed at (opts.desk on the phone).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { block as sliceBlock, runRecording } from './fixtures/source-slice.mjs';

const read = p => withShellParts(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const between = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, `${a} .. ${b}`); return src.slice(i, j); };
const ROUTE = { words: ['music', 'shazam'], open: '?view=identify&listen=1', rest_param: 'q' };
const music = (confirmed, routes = [ROUTE]) => ({ id: 'wizard-music', name: 'Music', url: '/wizard-music/', voice_routes: routes, voice_routes_confirmed: confirmed });

function commands({ APP, refresh }) {
  const box = { URL, console, location: { origin: 'https://fixture.invalid' } }; box.window = box;
  box.WizCore = { norm: s => String(s).toLowerCase().replace(/[.!?]+$/, '').trim(), refreshApps: refresh };
  box.WizConfig = { stripAddress: s => s };
  vm.runInNewContext(read('web/core/commands.js'), box);
  const find = s => ['music', 'Music', 'wizard-music'].includes(s) ? APP['wizard-music'] || null : null;
  return { box, parser: box.WosCommands.create({ APP, CHATS: {}, appByName: find, findApp: find, quickSearch: () => null, sendSnap: () => ({}) }) };
}

test('fresh list first: a route only the device cache declares does not open once the box says otherwise', async () => {
  const APP = { 'wizard-music': music(false) };
  let reads = 0;
  const { parser } = commands({ APP, refresh: async () => { reads++; APP['wizard-music'] = music(true, []); return true; } });
  assert.ok(parser.declaredRoute('music'), 'the cache paints the take as a command at once');
  assert.equal(await parser.confirmRoute('music'), null, 'the fresh list no longer declares it');
  assert.equal(reads, 1, 'one read of the box list');
  // Held: it parses again on the fresh list (now the bare app name).
  const held = await parser.confirm(parser.parse('music', {}, 'command'), 'music', {}, 'command');
  assert.equal(held.action, 'open_app');
});

test('fresh list first: a route the box confirms opens, marked fresh, at the fresh declaration', async () => {
  const APP = { 'wizard-music': music(false, [{ ...ROUTE, open: '?view=old' }]) };
  const { parser, box } = commands({ APP, refresh: async () => { APP['wizard-music'] = music(true); return true; } });
  const c = await parser.confirmRoute('music play Jazz');
  assert.equal(c.confirmed, 'fresh'); assert.equal(c.app, 'wizard-music');
  assert.equal(c.url, '/wizard-music/?view=identify&listen=1&q=play+Jazz', 'the fresh declaration, not the cached one');
  let seen = null;
  assert.equal(box.WosCommands.execute(c, 'music', { openAppRoute: (id, url) => { seen = [id, url]; return true; } }), true);
  assert.deepEqual(seen, ['wizard-music', c.url]);
});

test('read failed: the cached route stands in, but never for an app the registry no longer has', async () => {
  const APP = { 'wizard-music': music(false) };
  const { parser } = commands({ APP, refresh: async () => false });
  assert.equal((await parser.confirmRoute('music')).confirmed, 'cached');
  const thrown = commands({ APP, refresh: async () => { throw new Error('offline'); } });
  assert.equal((await thrown.parser.confirmRoute('music')).confirmed, 'cached');
  delete APP['wizard-music'];   // a fresh read earlier removed it: uninstalled
  assert.equal(await parser.confirmRoute('music'), null);
});

test('no path skips confirmation: execute refuses an unconfirmed route', () => {
  const APP = { 'wizard-music': music(true) };
  const { parser, box } = commands({ APP, refresh: async () => true });
  const raw = parser.parse('music', {}, 'command');
  assert.equal(raw.action, 'open_app_route'); assert.equal(raw.confirmed, undefined);
  let opened = false;
  assert.equal(box.WosCommands.execute(raw, 'music', { openAppRoute: () => { opened = true; return true; } }), false);
  assert.equal(opened, false);
});

// core/apps.js booted on a device that cached the box's list earlier; fetch answers as the test says.
function appsModule(answer) {
  const store = new Map([['wux.apps.v1', JSON.stringify([music(true)])]]);
  const win = { WizCore: { norm: s => String(s).toLowerCase() }, WizConfig: { endpoint: k => (k === 'apps' ? '/wizard/v1/apps' : '') }, location: { origin: 'http://x', pathname: '/' },
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) } };
  const ctx = { window: win, document: { addEventListener() {}, hidden: false }, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    localStorage: win.localStorage, location: win.location, addEventListener() {}, setTimeout, clearTimeout, console, URL,
    fetch: async url => { const a = await answer(url); if (a instanceof Error) throw a; return { ok: a.ok !== false, status: a.ok === false ? 503 : 200, json: async () => a.body }; } };
  ctx.self = win; ctx.globalThis = ctx;
  vm.createContext(ctx); vm.runInContext(readFileSync(new URL('../web/core/apps.js', import.meta.url), 'utf8'), ctx);
  return { core: win.WizCore, tile: () => win.WizCore.apps('mobile').APP['wizard-music'] };
}
test('apps.js: only a read of the box list confirms routes, and refreshApps says whether that read worked', async () => {
  let answer = new Error('offline');
  const m = appsModule(() => answer);
  assert.equal(m.tile().voice_routes_confirmed, false, 'a cached tile is built untrusted, whatever it said when cached');
  assert.deepEqual(JSON.parse(JSON.stringify(m.tile().voice_routes)), [ROUTE], 'its routes still paint the take');
  assert.equal(await m.core.refreshApps(), false, 'a failed read says so');
  assert.equal(m.tile().voice_routes_confirmed, false);
  for (const bad of [{ ok: false, body: { apps: [music(false)] } }, { body: { nope: true } }]) { answer = bad; assert.equal(await m.core.refreshApps(), false, JSON.stringify(bad)); assert.equal(m.tile().voice_routes_confirmed, false); }
  answer = { body: { apps: [music(false)] } };
  assert.equal(await m.core.refreshApps(), true, 'a fresh list from the box');
  assert.equal(m.tile().voice_routes_confirmed, true, 'read from the box itself: confirmed');
});

// The phone shell's own openApp, source-executed with the shell's helpers stubbed.
function phone({ gate = (a, resume) => resume() } = {}) {
  const src = read('web/app.js');
  const placed = [], paged = [], gated = [];
  const ctx = {
    window: { WosAppSetup: { gate: (a, resume, o) => { gated.push(a.id); return gate(a, resume, o); } } },
    openingEnd() {}, closeSheets() {}, CHATS: {},
    placeApp: (mine, obj, opts, refresh) => { const w = { id: 'w1', app: 'frame', appId: obj.appId }; placed.push({ obj, opts, existing: mine(w) }); if (refresh) refresh(w, 0); return w; },
    framePage: (w, rel) => { paged.push([w.id, rel]); return true; },
    hostedOpenable: id => id === 'wizard-music' ? { id, kind: 'wizard', url: '/wizard-music/' } : null,
    appAt: rel => rel.startsWith('/wizard-music/') ? { id: 'wizard-music' } : null,
  };
  ctx.window.window = ctx.window;
  const lambda = /openAppRoute: (\(id, url\) => \{[^\n]*?\}), musicDone/.exec(src);
  assert.ok(lambda, 'app.js executor routes through openApp');
  vm.runInNewContext(`${between(src, '  function openApp(a, extra = {}, opts = {}) {', '  /* Move an open window')}\nthis.openApp = openApp; this.route = opts => ${lambda[1]};`, ctx);
  return { ...ctx, placed, paged, gated };
}

test('phone: a spoken route opens through openApp: setup sheet first, then the app at the declared page', () => {
  let resume = null;
  const k = phone({ gate: (a, r) => { resume = r; return true; } });
  const url = '/wizard-music/?view=identify&listen=1';
  assert.equal(k.route({ snap: {} })('wizard-music', url), true);
  assert.deepEqual(k.gated, ['wizard-music'], 'the normal setup sheet gate');
  assert.equal(k.placed.length, 0, 'nothing opens before setup settles');
  resume();
  assert.equal(k.placed.length, 1);
  assert.equal(k.placed[0].obj.url, url); assert.equal(k.placed[0].obj.app, 'frame');
  assert.equal(k.placed[0].existing, true, 'reuses the app\'s normal window like a tap');
  assert.deepEqual(k.paged, [['w1', url]], 'an open window goes to the declared page');
  // Another app's page or an app that isn't installed never opens.
  assert.equal(k.route({})('wizard-music', '/other/'), false);
  assert.equal(k.route({})('nope', '/nope/'), false);
});

test('phone: an aimed take opens on the desk it was aimed at', () => {
  const k = phone();
  k.route({ desk: 3, snap: {} })('wizard-music', '/wizard-music/?view=identify');
  assert.equal(k.placed[0].opts.desk, 3);
});

test('phone: a plain tile tap is unchanged (no page, no refresh hook)', () => {
  const k = phone();
  k.openApp({ id: 'wizard-music', kind: 'wizard', url: '/wizard-music/' });
  assert.equal(k.placed[0].obj.url, undefined); assert.deepEqual(k.paged, []);
});

// app.js handleText (the phone's one entry for a spoken or typed take) with the real command parser above.
function phoneTake(refresh) {
  const APP = { 'wizard-music': music(false) };
  const { parser, box } = commands({ APP, refresh: async () => refresh(APP) });
  const src = read('web/app.js'), seen = { finished: [], agent: [], routed: [] };
  const ctx = runRecording(between(src, '  const localParse = (text, snap, kind, typed = false) =>', '\n') + '\n' + sliceBlock(src, '  async function handleText(text, kind, typed, sttMs, target, snap) {') + '\nglobalThis.handleText = handleText;', {
    $: () => ({}), LOCAL_COMMANDS: parser, window: { WosCommands: box.WosCommands, WizConfig: { agent: () => 'Wizard', endpoint: () => '' } }, performance, OUTBOX: { get: () => null }, takeFiles: () => [],
    finishCmd: (c, text) => { seen.finished.push({ action: c.action, confirmed: c.confirmed, url: c.url, text }); return 'opened'; },
    toAgent: (text, label) => { seen.agent.push(text); return 'sent'; }, showRouted: (k, label) => seen.routed.push(label) });
  return { take: (text, kind) => ctx.handleText(text, kind, false, 0, null, { view: { kind: 'home' } }), seen };
}
test('phone: tapped and held takes confirm the route before opening; an unconfirmed tap stays a message', async () => {
  const fresh = APP => { APP['wizard-music'] = music(true); return true; };
  for (const kind of ['tap', 'command']) {
    const p = phoneTake(fresh);
    assert.equal(await p.take('music', kind), 'opened', kind);
    assert.deepEqual(p.seen.finished.map(c => [c.action, c.confirmed]), [['open_app_route', 'fresh']], `${kind}: opens only the route the box confirmed`);
    assert.deepEqual(p.seen.agent, [], `${kind}: nothing goes to the agent`);
  }
  const gone = phoneTake(APP => { APP['wizard-music'] = music(true, []); return true; });
  assert.equal(await gone.take('music', 'tap'), 'sent');
  assert.deepEqual(gone.seen.finished, [], 'the fresh list no longer declares it: nothing opens');
  assert.deepEqual(gone.seen.agent, ['music'], 'the tap stays a message');
  assert.doesNotMatch(read('web/app.js'), /openAppRoute: \(id, url\) => window\.WizOpenApp/, 'never the setup-skipping WizOpenApp');
});

test('desktop: a spoken route opens through openApp with the setup sheet; held takes confirm first', async () => {
  const src = read('web/desktop/desktop.js');
  const made = [], paged = [], focused = [], gated = [];
  let resume = null, existing = null;
  const ctx = {
    window: { WosAppSetup: { gate: (a, r) => { gated.push(a.id); resume = r; return true; } } },
    newWin: (obj, opts) => { made.push({ obj, opts }); return { id: 'n1' }; },
    findWin: fn => existing && fn(existing) ? existing : null, focusWin: id => focused.push(id), framePage: (w, rel) => paged.push([w.id, rel]),
    hostedOpenable: id => id === 'wizard-music' ? { id, kind: 'wizard', url: '/wizard-music/' } : null,
    appAt: rel => rel.startsWith('/wizard-music/') ? { id: 'wizard-music' } : null, CHATS: {}, ws: [],
  };
  ctx.window.window = ctx.window;
  const lambda = /openAppRoute:(\(id,url\)=>\{[^\n]*?\}),musicDone/.exec(src);
  vm.runInNewContext(`${between(src, '  function openApp(a, opts = {}) {', '  // Prefer this workspace, then any.')}\nthis.route = ${lambda[1]};`, ctx);
  const url = '/wizard-music/?view=identify&listen=1';
  assert.equal(ctx.route('wizard-music', url), true);
  assert.deepEqual(gated, ['wizard-music']); assert.equal(made.length, 0, 'setup sheet first');
  resume();
  assert.equal(made[0].obj.url, url); assert.equal(made[0].obj.appId, 'wizard-music');
  existing = { id: 'e1', app: 'frame', appId: 'wizard-music' };
  resume();
  assert.deepEqual(focused, ['e1']); assert.deepEqual(paged, [['e1', url]], 'an open window goes to the declared page');
  assert.equal(ctx.route('wizard-music', '/elsewhere/'), false);
  // a held command take (the real desktop finish): the parsed command is confirmed before anything runs
  const take = async confirmed => {
    const order = [];
    const T = runRecording(`this.f = async (it, snap) => {\n${between(src, '        const cmd=await LOCAL_COMMANDS.confirm(', '      } finally {')}};`, {
      LOCAL_COMMANDS: { parse: (text, snap, kind) => (order.push(['parse', text, kind]), { action: 'open_app', id: 'wizard-music' }), confirm: async (cmd, text, snap, kind) => (order.push(['confirm', cmd.action, kind]), confirmed ? cmd : null) },
      executeCommand: cmd => (order.push(['execute', cmd.action]), true), OUTBOX: { completeLocal: async () => true }, commandSaid() {} });
    const r = await T.f({ id: 'o1', text: 'open music' }, {});
    return { r, order };
  };
  const yes = await take(true);
  assert.deepEqual(yes.order, [['parse', 'open music', 'command'], ['confirm', 'open_app', 'command'], ['execute', 'open_app']], 'held takes confirm first'); assert.equal(yes.r, 'local');
  const no = await take(false);
  assert.deepEqual(no.order.map(x => x[0]), ['parse', 'confirm'], 'not confirmed: nothing runs'); assert.equal(no.r, 'none');
});
