// A spoken declared route ("music") opens its app exactly like a tap (Archimedes, 7 Nov 2026; review of #1135):
//  1. the route is confirmed against the box's FRESH app list before anything opens; the device cache stands in only
//     when that read fails, and never for an app the registry no longer has;
//  2. it goes through the shell's own openApp, so an app that needs setup shows its normal setup sheet first;
//  3. it honours the desk the take is aimed at (opts.desk on the phone).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
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

test('apps.js: only a read of the box list confirms routes, and refreshApps says whether that read worked', () => {
  const src = read('web/core/apps.js');
  assert.match(src, /voice_routes_confirmed: trusted === true,/);
  assert.match(src, /REMOTE = \(\(\) => \{ try \{ return \(JSON\.parse\(localStorage\.getItem\(REMOTE_KEY\)[^\n]*\.map\(toTile\)/, 'cache tiles are built untrusted');
  assert.match(src, /REMOTE = list\.map\(a => toTile\(a, true\)\);/);
  const body = between(src, '  async function readRemote() {', '  const firstLoad');
  assert.match(body, /return true;/); assert.match(body, /if \(!r\.ok\) return false;/); assert.match(body, /catch \(e\) \{ return false; \}/);
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

test('phone: tapped and held takes confirm the route before opening; an unconfirmed tap stays a message', () => {
  const src = read('web/app.js');
  const tap = between(src, '        // Paint now; act only once', "      if (target == null && (v?.kind === 'chat thread'");
  assert.match(tap, /showRouted\('command'[^\n]*\n\s*const dr = await LOCAL_COMMANDS\.confirmRoute\(text\);\n\s*if \(dr\) return finishCmd\(dr, text, opts\);/);
  assert.match(src, /const loc = await LOCAL_COMMANDS\.confirm\(localParse\(text, snap, kind, typed\), text, snap, kind, typed\);/);
  assert.match(src, /const lc = await LOCAL_COMMANDS\.confirm\(localParse\(text, snap, kind\), text, snap, kind\);/);
  assert.doesNotMatch(src, /openAppRoute: \(id, url\) => window\.WizOpenApp/, 'never the setup-skipping WizOpenApp');
});

test('desktop: a spoken route opens through openApp with the setup sheet; held takes confirm first', () => {
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
  assert.ok(lambda, 'desktop executor routes through openApp');
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
  assert.match(src, /const cmd=await LOCAL_COMMANDS\.confirm\(LOCAL_COMMANDS\.parse\(it\.text,snap,'command'\),it\.text,snap,'command'\);/);
});
