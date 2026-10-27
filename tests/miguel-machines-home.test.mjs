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
test('machines-home: read-only, no owner data in the bundle, every add says coming soon', () => {
  const src = read('web/tweaks/miguel/machines-home/tweak.js');
  assert.doesNotMatch(src, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
  assert.match(src, /api\.data\.read\.app\('backup', 'overview'\)/);
  // Roles and managed Wizards come from the owner's devices registry via the Devices feed, never from this file.
  assert.doesNotMatch(src, /['"`][a-z0-9.-]+\.(com|net|org|io|solutions|ts\.net)\b/i, 'no hostnames');
  assert.doesNotMatch(src, /const (NET|MANAGED)\b/, 'no owner role table');
  assert.match(src, /S\.res\.devices\?\.managed/); assert.match(src, /d\.use === use/);
  for (const act of ["'add-managed'", "act: 'add'", "'soon'"]) assert.ok(src.includes(act));
  assert.match(src, /const soon = what => api\.toast/);
  assert.match(src, /api\.back\.push\(\(\) => closeSheet\(\)\)/, 'the sheet joins the shell Back order');
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

test('machines-home: storage above, helpers | Main | standby across, people below talking up to Main', () => {
  const src = read('web/tweaks/miguel/machines-home/tweak.js'), css = read('web/tweaks/miguel/machines-home/tweak.css');
  assert.doesNotMatch(src, /mh-humans/, 'no devices button in the header any more');
  assert.doesNotMatch(css, /\.mh-humans/);
  assert.match(src, /setLane\(rowMn, \[\.\.\.helpers, node\(main, 'main'/);
  assert.match(src, /setLane\(rowHp, \[minePeople\(\)\]/);
  assert.match(src, /setLane\(rowHp, \[managedPeople\(g\)\]/);
  assert.match(src, /g\?\.peopleCount/); assert.match(src, /g\?\.people\)/);
  assert.match(css, /\.mh-pnode \{/); assert.match(css, /\.mh-spec \{/);
});
