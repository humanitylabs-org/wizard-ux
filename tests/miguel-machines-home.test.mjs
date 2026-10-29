import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, read } from './fixtures/tweaks.mjs';

// Miguel's Machines-on-Home tweak and the two narrow host hooks it needs (home-main mount + api.on('home'),
// data.read.app). Stock Home stays plain markup: the slot is empty and takes no space without a package.
test('Home repaints keep a home-main mount in place and tell only home listeners', async () => {
  const f = fixture(); let api, homes = 0, renders = 0;
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel'] });
  const node = f.doc.createElement('section');
  assert.equal(api.slot.mount('home-main', node), true);
  api.on('home', () => homes++); api.on('render', () => renders++);
  // A repaint: the host keeps the mounted node and moves it into the new slot.
  const el = f.doc.createElement('div'), slot = node.parentNode; el.append(slot);
  Object.defineProperty(slot, 'childNodes', { get() { return this.children; } });
  let fresh;
  el.querySelector = q => (q === '[data-slot="home-main"]' ? (fresh || slot) : null);
  Object.defineProperty(el, 'innerHTML', { set() { fresh = f.doc.createElement('div'); fresh.setAttribute('data-slot', 'home-main'); el.replaceChildren(fresh); } });
  f.host.paintHome(el, '<div data-slot="home-main"></div>');
  assert.equal(node.parentNode, fresh); assert.equal(homes, 1); assert.equal(renders, 0, 'chats render listeners are not woken by Home');
  await f.clear(); f.host.paintHome(el, '<div data-slot="home-main"></div>'); assert.equal(homes, 1, 'no home events after teardown');
});
test("api.on('home') needs layout; data.read.app is trusted-only, GET-only and path-bounded", async () => {
  const f = fixture(); let api; const asked = [];
  f.ctx.fetch = async (url, opts) => { if (String(url).includes('/tweaks/')) return { ok: true, json: async () => JSON.parse(read('web/tweaks/' + String(url).split('/tweaks/')[1].split('?')[0])) }; asked.push([String(url), opts.method, opts.credentials]); return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ backup: { state: 'ok' } }) }; };
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/machines-home'], f.slots);
  assert.equal(api.data, undefined, 'untrusted authors get no data reads at all');
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel'] });
  assert.deepEqual(await api.data.read.app('backup', 'overview'), { backup: { state: 'ok' } });
  assert.deepEqual(asked, [['https://wizard.test/backup/api/overview', 'GET', 'same-origin']]);
  for (const [id, path] of [['../x', 'overview'], ['backup', '../../wizard/v1/my-skin'], ['backup', 'a?b=1'], ['Backup', 'overview'], ['backup', '//evil.test/x']]) assert.equal(await api.data.read.app(id, path), null);
  assert.equal(asked.length, 1);
  await f.clear(); assert.equal(await api.data.read.app('backup', 'overview'), null, 'inert after teardown');
  const g = fixture(); let nav;
  g.host._test.setImporter(async () => ({ default: a => { nav = a; return () => {}; } }));
  await g.host.loadTweaks(['miguel/send-and-go'], g.slots);
  assert.throws(() => nav.on('home', () => {}), /home requires layout/);
  await g.clear();
});
test('stock Home markup carries an empty home-main slot that takes no space; core never names the package', () => {
  const app = read('web/app.js'), desk = read('web/desktop/desktop.js'), host = read('web/core/skin-host.js');
  assert.match(app, /<div class="home"><div data-slot="home-main" hidden><\/div><nav class="home-tools"/);
  assert.match(desk, /<div class="home-in mine-home"><div data-slot="home-main" hidden><\/div>/);
  assert.match(desk, /<div class="home-in"><div data-slot="home-main" hidden><\/div>/);
  assert.doesNotMatch(app + desk, /\.innerHTML = (renderHome|homeHtml)\(/, 'every Home paint goes through paintHome');
  assert.match(read('web/tweaks/miguel/machines-home/tweak.css'), /\[data-slot="home-main"\]:has\(> \.mh-root\) \{ flex: 1 1 auto; min-height: 0; display: flex;/, 'the package shows the hidden slot itself');
  assert.doesNotMatch(app + desk + host + read('web/core/resources.js'), /machines-home/);
  assert.ok(JSON.parse(read('web/tweaks/miguel/profile.json')).tweaks.includes('miguel/machines-home'));
});
test('machines-home: read-only, no owner data in the bundle', () => {
  const src = read('web/tweaks/miguel/machines-home/tweak.js');
  assert.doesNotMatch(src, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
  assert.match(src, /api\.data\.read\.app\('backup', 'overview'\)/);
  // Roles, names and managed Wizards come from the owner's devices registry via the Devices feed, never from this file.
  assert.doesNotMatch(src, /['"`][a-z0-9.-]+\.(com|net|org|io|solutions|ts\.net)\b/i, 'no hostnames');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /Miguel|Oscar|HomeServer/, 'no owner names');
  assert.match(src, /reg\(\)\.this\?\.wizard/); assert.match(src, /reg\(\)\.this\?\.owner/);
  assert.match(src, /'add-managed'/);
});
test('api.back.push: newest package overlay closes first on shell Back; released and teardown entries are gone', async () => {
  const f = fixture(); let api; const closed = [];
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel'] });
  assert.equal(f.host.back(), false, 'nothing open: Back goes on to the shell');
  const r1 = api.back.push(() => closed.push(1)); api.back.push(() => closed.push(2));
  assert.equal(f.host.back(), true); assert.deepEqual(closed, [2]);
  r1(); assert.equal(f.host.back(), false); r1();
  api.back.push(() => closed.push(3)); await f.clear();
  assert.equal(f.host.back(), false, 'teardown removes open entries'); assert.deepEqual(closed, [2]);
  const app = read('web/app.js'), desk = read('web/desktop/desktop.js');
  assert.match(app, /if \(window\.WosSkinHost\?\.back\?\.\(\)\) return 'tweak-overlay';.*\n    if \(window\.WosResources\?\.back\(\)\)/);
  assert.match(desk, /if \(window\.WosSkinHost\?\.back\?\.\(\)\) return 'tweak-overlay';/);
});

test('machines-home: one inline map, the same on every workspace', () => {
  const src = read('web/tweaks/miguel/machines-home/tweak.js'), css = read('web/tweaks/miguel/machines-home/tweak.css');
  assert.doesNotMatch(src, /showModal|'dialog'|mh-panel|mh-sheet|managedCard/, 'no cards, sheets or side panels');
  assert.doesNotMatch(src, /ICONS|ico\(/, 'no icons on the map');
  assert.match(src, /\[main, \.\.\.others\]/); assert.match(src, /sort\(\(a, b\) => power\(b\) - power\(a\)\)/, 'Main first, then by power');
  assert.match(src, /qualifies\(m\.id\) \? 'standby' : 'helper'/);
  assert.match(src, /S\.open\.has\('p:' \+ p\.id\)/, 'a person expands to their devices in place');
  assert.match(src, /data: \{ nick: r\.id, auto: r\.auto \}/, 'every account has its nickname field in the AI list');
  assert.match(src, /value: r\.nick \|\| r\.auto/, 'the current nickname is the field value, not a faint placeholder');
  assert.doesNotMatch(src, /r\.left \+ '%' \}\), h\('b'/, 'no percentage at rest');
  assert.match(src, /api\.data\.read\.sessions\?\.counts\(\)/); assert.match(src, /api\.data\.read\.sessions\?\.open\(d\.open\)/);
  assert.match(src, /agoS\(st\.age\) \+ ' ago'/);
  assert.match(css, /:is\(\.home, \.home-in\):has\(\[data-slot="home-main"\] > \.mh-root\) \.constellation \{ display: none; \}/);
  assert.doesNotMatch(css, /mh-orbit|mh-spin|rotate\(360/, 'nothing spins');
  for (const b of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'innerHTML', 'localStorage', 'querySelector']) assert.ok(!src.includes(b), b);
  const host = read('web/core/skin-host.js'), app = read('web/app.js'), desk = read('web/desktop/desktop.js');
  assert.match(host, /\.\.\.\(trusted \? \{ sessions: Object\.freeze/, 'sessions is trusted-only');
  for (const s of [app, desk]) { assert.match(s, /sessions: \(\) => \{/); assert.match(s, /openSessions: kind =>/); }
});

test('machines-home: simple at rest, more on tap (one AI gauge, storage size, one details toggle)', () => {
  const src = read('web/tweaks/miguel/machines-home/tweak.js'), css = read('web/tweaks/miguel/machines-home/tweak.css');
  assert.match(src, /cls: 'mh-gauge'/, 'one AI fuel tag, not a battery per subscription');
  assert.match(src, /cls: 'mh-g-cells'/, 'the tag fills cells from E to F');
  assert.doesNotMatch(src, /mh-batt/, 'batteries are gone');
  assert.match(src, /text: 'E'/); assert.match(src, /text: 'AI'/);
  assert.match(src, /api\.models\?\.default\?\.\(\)/, 'the gauge follows the default model');
  assert.match(src, /data: \{ resSignin: app \}/, 'Sign out / Sign in open that app through the shell');
  assert.match(src, /btn\('Sign out', appOf\(r\.kind\), 'is-out'\)/, 'Sign out next to each account');
  assert.match(src, /'\+ Sign in to another account'/); assert.match(src, /signable\(\)\.map\(p => btn\(p\.name, p\.app\)\)/, 'one Sign in, then pick the service');
  assert.doesNotMatch(src, /Sign in or out/);
  assert.match(src, /TOP_UP\[r\.kind\]/, 'prepaid services link to add credit');
  assert.match(src, /repository_bytes/, 'storage shows how much is stored');
  assert.match(src, /cls: 'mh-details', data: \{ toggle: 'bars' \}/, 'one Show details toggle under all machines');
  assert.match(src, /map\.classList\.toggle\('is-details', S\.bars\)/, 'details fold with a class, no rebuild');
  assert.match(css, /grid-template-rows: 0fr/); assert.match(css, /transition: grid-template-rows 480ms/, 'details ease open');
  assert.match(src, /const around = \(main, others\)/, 'Main in the middle, helpers alternate right and left');
  assert.match(src, /data: \{ machine: m\.id \}/); assert.match(src, /api\.nav\?\.ask\?\./, 'helper actions ask the agent');
  assert.match(src, /'Disconnected'/); assert.match(src, /dots\(x\.working, 'work'\)/, 'a dot per chat inside Main, no numbers');
  assert.match(src, /cls: 'mh-act-why'/, 'each blocked action says why');
  assert.match(src, /api\.inbox\?\.watch/, 'a bell with the unread count');
  assert.match(src, /bars: api\.storage\.get\('details'\) !== 'off'/, 'details shown by default');
  assert.doesNotMatch(src, /'Hide details'|'Show details'/, 'chevron only, no words');
  assert.match(src, /flip\('signin'\); renderAIList\(\)/, 'Sign in opens the service picker even while the button has focus');
  assert.doesNotMatch(src, /Cloudflare app connected/);
  assert.doesNotMatch(css, /mh-breathe/, 'Main stays still so the working dots read');
  assert.doesNotMatch(src, /data: \{ toggle: 'bars' \}, 'aria-label': `\$\{m\.name\}/, 'tapping a machine no longer folds the bars');
  assert.doesNotMatch(css, /violet|#7A5CFF/i, 'no violet nodes');
});
test('machines-home: calm repaints (last readings first, motion once, parts redraw only when they change)', () => {
  const src = read('web/tweaks/miguel/machines-home/tweak.js'), css = read('web/tweaks/miguel/machines-home/tweak.css');
  assert.match(src, /api\.storage\.set\('res'/); assert.match(src, /S\.res = api\.storage\.get\('res'\)/, 'paints the last good readings at once');
  assert.match(src, /api\.storage\.set\('backup', S\.backup\)/);
  assert.match(src, /const nw = cls => fresh \? cls \+ ' mh-new' : cls/); assert.match(src, /fresh = false;/);
  assert.match(css, /\.mh-new:is\(\.mh-node/, 'entry motion hangs off .mh-new only');
  assert.doesNotMatch(css, /\.mh-map\.is-switch|^\.mh-bars \{[^}]*animation/m);
  assert.match(src, /if \(key === wired && lines\.firstChild\) return;/, 'wires stay put while nothing moved');
  assert.match(src, /!aiList\.contains\?\.\(document\.activeElement\)/, 'a nickname being typed is never rebuilt');
  assert.match(css, /html\[data-tweaks~="miguel\/machines-home"\] \.home > :is\(\.home-top, \.home-gap, \[data-home-resources\]\)/, 'stock Home is hidden as soon as the package is listed');
});
test('tweak stylesheets are listed and loaded from the first frame; reapplying keeps them; a failed package drops out', async () => {
  const host = read('web/core/skin-host.js');
  assert.match(host, /const EXPECT_KEY = 'wos\.tweaks\.expect'/);
  assert.match(host, /l\.setAttribute\('blocking', 'render'\)/);
  assert.match(host, /for \(const id of want\) tweakCss\(id\);\n    expected\.clear\(\); for \(const id of want\) expected\.add\(id\);\n    for \(const a of \[\.\.\.tweaks\.values\(\)\]\) dispose\(a, 'replace'\);/, 'new links before old ones go');
  const f = fixture();
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel'] });
  assert.ok(f.doc.documentElement.dataset.tweaks.includes('miguel/machines-home'));
  assert.equal(f.doc.head.children.filter(l => String(l.href).includes('machines-home/tweak.css')).length, 1, 'one stylesheet');
  assert.deepEqual(JSON.parse(f.ctx.localStorage.getItem('wos.tweaks.expect')), ['miguel/machines-home']);
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel'] });
  assert.equal(f.doc.head.children.filter(l => String(l.href).includes('machines-home/tweak.css')).length, 1, 'reapplying swaps, never doubles');
  await f.clear();
  assert.equal(f.doc.documentElement.dataset.tweaks, ''); assert.equal(f.doc.head.children.length, 0);
  assert.deepEqual(JSON.parse(f.ctx.localStorage.getItem('wos.tweaks.expect')), []);
});
test('paintHome with unchanged markup leaves a mounted view in place (no detach, no restarted motion)', async () => {
  const f = fixture(); let api, homes = 0, writes = 0;
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel'] });
  api.on('home', () => homes++);
  const el = f.doc.createElement('div'); let slot = f.doc.createElement('div'); slot.setAttribute('data-slot', 'home-main');
  Object.defineProperty(slot, 'childNodes', { get() { return this.children; } });
  el.querySelector = q => (q === '[data-slot="home-main"]' ? slot : null);
  Object.defineProperty(el, 'innerHTML', { set() { writes++; slot = f.doc.createElement('div'); slot.setAttribute('data-slot', 'home-main'); Object.defineProperty(slot, 'childNodes', { get() { return this.children; } }); el.replaceChildren(slot); } });
  f.host.paintHome(el, '<div data-slot="home-main"></div>');
  const node = f.doc.createElement('section'); slot.append(node);
  f.host.paintHome(el, '<div data-slot="home-main"></div>');
  assert.equal(writes, 1, 'same markup with a mounted view: no rewrite'); assert.equal(node.parentNode, slot); assert.equal(homes, 2);
  f.host.paintHome(el, '<div data-slot="home-main"></div><p></p>');
  assert.equal(writes, 2, 'new markup is written'); assert.equal(node.parentNode, slot, 'and the view moves along');
  await f.clear();
});

test('api.nav.ask: trusted only, namespaced home: key, sends through the shell contextDraft', async () => {
  const f = fixture(); let api;
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/machines-home'], f.slots, { teamAuthors: ['miguel'] });
  assert.equal(api.nav.ask('oscarvps-standby', { title: 'HostingerVPS · Make standby', message: 'checks' }, 'Make HostingerVPS my standby device.'), true);
  assert.deepEqual(f.inbox.replies.at(-1), ['home:oscarvps-standby', '', 'Make HostingerVPS my standby device.'], 'lands as an unsent draft');
  api.nav.ask('now', {}, 'Back up now.', { send: true }); assert.deepEqual(f.inbox.replies.at(-1), ['home:now', 'Back up now.'], 'send: true sends');
  assert.equal(api.nav.ask('../x', {}, ''), true); assert.equal(f.inbox.replies.at(-1)[0], 'home:x', 'unsafe characters are dropped');
  await f.loadTweaks?.(); await f.host.loadTweaks(['miguel/machines-home'], f.slots);
  assert.throws(() => api.nav.ask('a', {}, ''), /Trusted navigation required|Cannot read/);
  await f.clear();
});

test('machines-home: Home is one glance; the full views live in Settings › System', () => {
  const src = read('web/tweaks/miguel/machines-home/tweak.js'), host = read('web/core/skin-host.js'), set = read('web/core/settings.js');
  const man = JSON.parse(read('web/tweaks/miguel/machines-home/manifest.json'));
  assert.ok(man.capabilities.includes('settings'));
  for (const page of ['overview', 'ai', 'network', 'storage']) assert.match(src, new RegExp(`api\\.settings\\?\\.section\\('[a-z]+', '${page}'`), page);
  assert.match(src, /api\.slot\.mount\('dock-end', barBox, -1\)/, 'desktop: the glance sits in the top bar');
  assert.match(src, /fillTabs\(homeWs\)/, 'the Wizard switcher travels with the glance');
  assert.match(src, /api\.settings\?\.open\?\.\(d\.go\)/, 'strip parts open their Settings page');
  assert.doesNotMatch(src, /h\('header', \{ cls: 'mh-top' \}/, 'no separate switcher above the strip');
  assert.match(host, /if \(caps\.has\('settings'\)\) api\.settings = Object\.freeze/);
  assert.match(host, /if \(!trusted \|\| a\.dead\) throw new Error\('Trusted settings required'\)/);
  assert.match(set, /\{ id: 'overview', title: 'Your network', group: 'System', available: filled\('overview'\) \}/, 'System pages hide until a package fills them');
  assert.match(set, /class="st-navgroup"/);
});
