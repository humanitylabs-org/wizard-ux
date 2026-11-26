// WizLinks.popup (wizard-os#796): an installed app's page opens as a pop-up in the shell's own sheet/pane, never in
// that app's own place (its window, desk or Android window), and the app keeps its services while it shows there.
// The real core/links.js runs in a vm with stand-ins for the DOM, the app list and WizAppServices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const origin = 'https://wizard.example';
const APPS = [
  { id: 'tg-style', name: 'TG style', kind: 'wizard', url: '/tg-style/' },
  { id: 'messenger', name: 'Messenger', kind: 'wizard', url: '/messenger/' },
  { id: 'wizard-music', name: 'Music', kind: 'wizard', url: '/wizard-music/index.html' },
  { id: 'camera', name: 'Camera', kind: 'native', url: '/camera/' },
];

function world({ mountOpts = { readerApp: () => null, asWindow: () => true }, mount = true, services = true } = {}) {
  const calls = [];
  class El {
    constructor() { this.handlers = {}; this.nodes = {}; this.style = {}; this.hidden = false; this.attrs = {}; this.textContent = '';
      this.classList = { add() {}, remove() {}, contains: () => false, toggle: () => false };
      const self = this; this.contentWindow = { location: { replace(u) { calls.push(['load', u]); self.loaded = u; } } }; }
    setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k] ?? null; } hasAttribute(k) { return k in this.attrs; }
    set src(v) { calls.push(['src', v]); this._src = v; } get src() { return this._src || ''; }
    replaceWith() {} removeEventListener() {} appendChild() {} remove() {} querySelector(q) { return this.nodes[q] ||= new El(); } addEventListener(n, fn) { (this.handlers[n] ||= []).push(fn); }
    get offsetWidth() { return 0; }
  }
  const document = { body: new El(), createElement: () => new El() };
  const w = { open: url => calls.push(['browser', url]), WizConfig: { raw: {}, localURL: (h, b) => new URL(h, b) },
    WizAndroidRelay: { appLink: href => (calls.push(['relay', href]), true) },
    WizCore: { apps: () => ({ APPS }), deeplink: { route: href => (calls.push(['route', href]), true), isOwn: u => u.pathname.startsWith('/wizard-os-home/'), parse: () => null } } };
  if (services) w.WizAppServices = {
    attach: (frame, o) => { calls.push(['attach', o.appId, o.path]); w.attached = o; return () => calls.push(['detach', o.appId]); },
    expectLoad: () => calls.push(['expect']),
  };
  vm.runInNewContext(readFileSync(new URL('../web/core/links.js', import.meta.url), 'utf8'), { window: w, location: new URL(origin + '/wizard-os-home/'), navigator: { userAgent: 'fixture', userActivation: { isActive: true } },
    localStorage: { getItem: () => null, setItem() {} }, document, URL, console, setTimeout: fn => fn(), clearTimeout() {}, performance: { now: () => 0 }, Date, JSON, Object, Set, Map });
  const L = mount ? w.WizLinks.mount(mountOpts) : null;
  return { w, L, calls };
}

test('a link to an installed app opens in the shell sheet, with that app\'s services, and nothing else runs', () => {
  const { w, L, calls } = world();
  assert.equal(w.WizLinks.popup('/messenger/chat/3'), true);
  assert.deepEqual(calls, [['src', origin + '/messenger/chat/3'], ['attach', 'messenger', '/messenger/']], 'a fresh frame at the page; no app window, desk, Android window or deep link');
  assert.equal(L.isOpen(), true);
  assert.equal(L.state().title, 'Messenger');
  assert.equal(w.attached.isFront(), true);
  // closing it (✕, drag down, Back, Esc all end in close/back) lets the app's services go
  assert.equal(L.back(), true);
  assert.equal(L.isOpen(), false);
  assert.deepEqual(calls.filter(c => c[0] === 'detach'), [['detach', 'messenger']]);
  assert.equal(w.attached.isFront(), false);
});

test('an app whose address is a file names its folder; the longest installed path wins', () => {
  const { w, calls } = world();
  assert.equal(w.WizLinks.popup(origin + '/wizard-music/track/9'), true);
  assert.deepEqual(calls[1], ['attach', 'wizard-music', '/wizard-music/index.html']);
});

test('anything that is not another installed app page says no, so the caller keeps its own route', () => {
  for (const href of ['https://elsewhere.example/messenger/', '/wizard-os-home/?session=1', '/unknown-app/', '/camera/', '/messenger/photo.png', '/messenger/export.pdf', 'mailto:a@b.c', '']) {
    const { w, L, calls } = world();
    assert.equal(w.WizLinks.popup(href), false, href);
    assert.deepEqual(calls, [], href);
    assert.equal(L.isOpen(), false, href);
  }
});

test('only a shell sheet takes pop-ups: the main shell (readerApp) or the one-app window (popups: true)', () => {
  assert.equal(world({ mount: false }).w.WizLinks.popup('/messenger/'), false, 'no sheet mounted');
  assert.equal(world({ mountOpts: { mode: 'sheet' } }).w.WizLinks.popup('/messenger/'), false, 'an auxiliary mount (App Setup)');
  assert.equal(world({ mountOpts: { mode: 'sheet', popups: true } }).w.WizLinks.popup('/messenger/'), true, 'the one-app window');
  const refused = world({ mountOpts: { mode: 'sheet', popups: true, allowURL: () => false } });
  assert.equal(refused.w.WizLinks.popup('/messenger/'), false, 'the sheet\'s own allowURL still applies');
});

test('without app services (an older page) the sheet still shows the app', () => {
  const { w, L, calls } = world({ services: false });
  assert.equal(w.WizLinks.popup('/messenger/'), true);
  assert.equal(L.isOpen(), true);
  assert.deepEqual(calls, [['src', origin + '/messenger/']]);
});

test('a second pop-up lets the first app\'s services go before the next attaches', () => {
  const { w, calls } = world();
  w.WizLinks.popup('/messenger/');
  w.WizLinks.popup('/wizard-music/');
  assert.deepEqual(calls.filter(c => c[0] !== 'load' && c[0] !== 'src'), [['attach', 'messenger', '/messenger/'], ['detach', 'messenger'], ['attach', 'wizard-music', '/wizard-music/index.html']]);
});
