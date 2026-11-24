// Settings › Connections (wizard-os issue 324): the App Manager's Connections view is a Settings tab, not a launcher tile.
// Runs the real web/core/settings.js: the tab shows only once the owner listener answers, hosts the view's own page
// (so its owner-only actions stay the App Manager's), routes the old app id, and never reloads the frame on a
// background refresh.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { withSettingsParts } from './fixtures/settings-parts.mjs'; // settings.js parts moved out verbatim (issue 1665)
const source = withSettingsParts(fs.readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8'));
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
  assert.match(h.root.innerHTML, /<section data-settings-feature="connections"><div class="st-embed" data-st-connections><iframe src="\/wizard-os-home\/store-install\/_connections\/\?embed=settings" title="Connections"><\/iframe><\/div><\/section>/);
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

// The real Connections page the harness drew, in a mini-dom (a window body around the Settings root on the desktop).
async function connectionsPage(shell, { wizards = false, attrs = {} } = {}) {
  const h = harness({ shell }); await tick(); h.view.focus('connections');
  const doc = createDocument();
  for (const [k, v] of Object.entries({ 'data-shell': shell, ...attrs })) doc.documentElement.setAttribute(k, v);
  doc.body.innerHTML = `<div class="win"><div class="wbody"><div class="st-root">${h.root.innerHTML}</div></div></div>`;
  // the Wizards section the page keeps below the frame (Add a Wizard)
  if (wizards) doc.querySelector('.st-page').insertAdjacentHTML('beforeend', '<section data-settings-feature="wizards"><h4>Wizards</h4></section>');
  return { h, doc };
}
// mini-dom reads `:has(> A B)` as "a child that is B"; rewrite it to the same rule it means, `:has(> A:has(B))`
// (a child A with a B inside), so the cascade answers what a browser does.
const exactHas = css => css.replace(/:has\(>\s*([^\s()>+~,]+(?:\([^()]*\))?)\s+([^()]+?)\)/g, ':has(> $1:has($2))');
const settingsCss = () => exactHas(fs.readFileSync(new URL('../web/core/settings.css', import.meta.url), 'utf8'));

test('Connections sits flush in the Settings page: the view in its Settings embed mode, no box around it', async () => {
  const css = settingsCss();
  for (const shell of ['phone', 'desktop']) {
    const { h, doc } = await connectionsPage(shell);
    const embed = doc.querySelector('.st-embed');
    assert.equal(embed.querySelector('iframe').getAttribute('src'), URL_ + '?embed=settings', 'asks the App Manager for its Settings embed mode');
    assert.ok(h.reads.includes(URL_), 'availability still asks the plain page');
    const got = cascade(embed, css);
    assert.equal(got.position?.value, 'relative', 'keeps its own box for the desktop .wbody iframe rule');
    for (const p of ['border-radius', 'background', 'border', 'box-shadow']) assert.equal(got[p], undefined, `${shell}: no ${p} around the view`);
  }
  // A borderless skin frame paints an app window with the app's canvas; Settings is not an app window.
  const frame = exactHas(fs.readFileSync(new URL('../web/core/skin-frame.css', import.meta.url), 'utf8'));
  for (const shell of ['phone', 'desktop']) {
    const { doc } = await connectionsPage(shell, { attrs: { 'data-skin-frame': 'borderless' } });
    const won = cascade(doc.querySelector('.win'), frame).background;
    assert.equal(won?.value, 'var(--sk-win)', `Settings keeps the skin material (${shell})`);
    assert.match(won.selector, /\.st-embed iframe/, `the Settings rule wins over the app-canvas rule (${shell})`);
    // an app window with a frame of its own gets the app canvas
    const app = createDocument(); app.documentElement.setAttribute('data-skin-frame', 'borderless'); app.documentElement.setAttribute('data-shell', shell);
    app.body.innerHTML = '<div class="win"><div class="wbody"><iframe></iframe></div></div>';
    assert.notEqual(cascade(app.querySelector('.win'), frame).background?.value, 'var(--sk-win)', `an app window is not Settings (${shell})`);
  }
});

// Issue 1242: on a phone the frame and the Settings page both scrolled, so the page's Wizards › Add a Wizard section
// below the frame could not be reached. The page around the frame is a fixed column now; the frame takes what is left.
// Browser proof: tests/qa-settings-connections-scroll.cjs (phone and desktop, real shells).
test('Connections page has one scroll area: the frame fills the room the Wizards section leaves, on every shell', async () => {
  const css = settingsCss();
  for (const shell of ['phone', 'desktop']) {
    const { doc } = await connectionsPage(shell, { wizards: true });
    const style = sel => cascade(doc.querySelector(sel), css), val = (sel, p) => style(sel)[p]?.value;
    assert.equal(val('.st-page', 'display'), 'flex', shell);
    assert.equal(val('.st-page', 'flex-direction'), 'column', shell);
    assert.equal(val('.st-page', 'min-height'), '0', shell);
    assert.equal(val('[data-settings-feature="wizards"]', 'flex'), 'none', `${shell}: Wizards keeps its own height`);
    assert.equal(val('[data-settings-feature="connections"]', 'flex'), '1', `${shell}: the frame section takes what is left`);
    // never shorter than the embed's own floor, so a taller Wizards section scrolls the page (issue 1670)
    assert.equal(val('[data-settings-feature="connections"]', 'min-height'), shell === 'phone' ? '240px' : '360px', shell);
    if (shell === 'phone') {
      assert.equal(val('.st-root', 'display'), 'flex');
      assert.equal(val('.st-root', 'flex-direction'), 'column');
      assert.equal(val('.st-phone', 'flex'), '1');
      assert.equal(val('.st-phone', 'min-height'), '0');
    }
  }
  // a page without the frame keeps the normal scrolling page
  const plain = createDocument(); plain.body.innerHTML = '<div class="st-root"><div class="st-inner st-phone st-in-page"><div class="st-page"><section></section></div></div></div>';
  assert.notEqual(cascade(plain.querySelector('.st-page'), css).display?.value, 'flex');
});
