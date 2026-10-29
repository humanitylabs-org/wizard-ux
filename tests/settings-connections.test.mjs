// Settings › Connections (wizard-os issue 324): the App Manager's Connections view is a Settings tab, not a launcher tile.
// Runs the real web/core/settings.js: the tab shows only once the owner listener answers, hosts the view's own page
// (so its owner-only actions stay the App Manager's), routes the old app id, and never reloads the frame on a
// background refresh.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8');
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
const URL_ = '/wizard-os-home/store-install/_connections/';

function harness({ status = 200, shell = 'phone' } = {}) {
  const reads = [], storage = new Map();
  const s = { console, Map, Set, Date, String, URL, CSS: { escape: String }, setTimeout, document: { activeElement: null }, navigator: { userAgent: 'Desktop' }, location: { host: 'box.test', href: 'https://box.test/wizard-os-home/index.html' }, localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) } };
  s.window = s;
  s.WizCore = { refreshApps: async () => {} };
  s.WizChatsHost = { defaultId: () => 'wizard-chats', installed: () => [{ id: 'wizard-chats', name: 'Chats' }] };
  s.fetch = async url => { reads.push(String(url)); return { ok: String(url) === URL_ ? status === 200 : true, status: String(url) === URL_ ? status : 200, json: async () => ({}) }; };
  vm.runInNewContext(source, s);
  let iframe = false;
  const frameWin = { location: { origin: 'https://box.test' }, overlays: 0, map: false, clicks: 0,
    __wizardCloseOverlay() { if (frameWin.overlays > 0) { frameWin.overlays--; return true; } return false; },
    document: { querySelector: sel => (sel === '[data-cm-seelist]' && frameWin.map ? { getClientRects: () => [1], click() { frameWin.map = false; frameWin.clicks++; } } : null) } };
  s.location.origin = 'https://box.test';
  const root = { innerHTML: '', scrollTop: 0, dataset: {}, classList: { add() {} }, contains: () => false,
    querySelector: sel => (sel === '[data-st-connections] iframe' && iframe ? { contentWindow: frameWin } : null), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  let onLive = null;
  const view = s.WosSettings.mount(root, { shell, live: { ok: true, onChange: f => { onLive = f; return () => {}; } }, helpSub: 'Help' });
  return { s, root, view, reads, frameWin, mountFrame: () => { iframe = /data-st-connections><iframe/.test(root.innerHTML); }, liveChange: () => onLive?.() };
}
const tabs = html => [...html.matchAll(/data-st-page="([a-z-]+)"/g)].map(m => m[1]);

test('Connections tab: hidden until the owner listener answers, then listed as one Settings tab', async () => {
  const h = harness();
  assert.ok(!tabs(h.root.innerHTML).includes('connections'), 'not shown before the listener answers');
  await tick();
  assert.ok(h.reads.includes(URL_), 'asks the App Manager listener on this origin');
  assert.ok(tabs(h.root.innerHTML).includes('connections'));
  assert.match(h.root.innerHTML, /<b>Connections<\/b>/);
});

test('Connections tab: a non-owner device, or a box without the listener, never sees the tab', async () => {
  for (const status of [403, 404]) {
    const h = harness({ status }); await tick();
    assert.ok(!tabs(h.root.innerHTML).includes('connections'), String(status));
    assert.equal(h.s.WosSettings.route('connections', h.view.focus), true);
    assert.doesNotMatch(h.root.innerHTML, /data-st-connections/, 'a deep link cannot open an unavailable page');
  }
});

test('Connections page hosts the App Manager view itself, and the old app id and view link open it', async () => {
  const h = harness(); await tick();
  for (const alias of ['connections', 'app-connections']) {
    h.view.focus(); assert.equal(h.s.WosSettings.route(alias, h.view.focus), true); assert.equal(h.view.page, 'connections', alias);
  }
  assert.match(h.root.innerHTML, /<section data-settings-feature="connections"><div class="st-embed" data-st-connections><iframe src="\/wizard-os-home\/store-install\/_connections\/" title="Connections"><\/iframe><\/div><\/section>/);
  assert.match(h.root.innerHTML, /<h3 tabindex="-1">Connections<\/h3>/);
  const desktop = harness({ shell: 'desktop' }); await tick(); desktop.view.focus('connections');
  assert.match(desktop.root.innerHTML, /st-desktop[^]*data-st-connections><iframe/);
});

test('Connections page: background refreshes never reload the frame; leaving the page renders again', async () => {
  const h = harness(); await tick();
  h.view.focus('connections'); h.mountFrame();
  const before = h.root.innerHTML;
  h.root.innerHTML = 'FRAME KEPT'; h.liveChange(); h.s.WosSettings.refresh();
  assert.equal(h.root.innerHTML, 'FRAME KEPT', 'a live poll or refresh leaves the mounted frame alone');
  h.view.back();
  assert.notEqual(h.root.innerHTML, 'FRAME KEPT'); assert.equal(h.view.page, '');
  assert.ok(before.includes('data-st-connections'));
});

test('Connections deep link on a cold start waits for the listener, then opens the page', async () => {
  const h = harness();
  assert.equal(h.s.WosSettings.route('connections', h.view.focus), true); // before the availability answer
  assert.doesNotMatch(h.root.innerHTML, /data-st-connections/);
  await tick();
  assert.equal(h.view.page, 'connections');
  assert.match(h.root.innerHTML, /data-st-connections><iframe/);
  const no = harness({ status: 403 });
  no.s.WosSettings.route('app-connections', no.view.focus); await tick();
  assert.equal(no.view.page, ''); assert.doesNotMatch(no.root.innerHTML, /data-st-connections/);
  const moved = harness();
  moved.s.WosSettings.route('connections', moved.view.focus); moved.view.focus('chats-default'); await tick();
  assert.equal(moved.view.page, 'chats', 'choosing another page first cancels the pending link');
});

test('Back inside Connections closes its pop-up, then leaves the map, then leaves the page', async () => {
  const h = harness(); await tick();
  h.view.focus('connections'); h.mountFrame();
  h.frameWin.overlays = 1; h.frameWin.map = true;
  assert.equal(h.view.back(), true); assert.equal(h.frameWin.overlays, 0); assert.equal(h.view.page, 'connections', 'pop-up first');
  assert.equal(h.view.back(), true); assert.equal(h.frameWin.clicks, 1); assert.equal(h.view.page, 'connections', 'then map to list');
  assert.equal(h.view.back(), true); assert.equal(h.view.page, '', 'then out of the page, never out of Settings in one go');
});
