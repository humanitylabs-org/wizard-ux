// Location only for the apps that ask for it (wizard-ux issue 1629, switch wizard/app-location, off by default).
// The real core/apps.js runs in a vm: an app frame gets `geolocation` in its `allow` only while the switch is on AND the
// box's own app list says the app declared `permissions: [geolocation]`; every other frame says `geolocation 'none'`.
// The real android-relay.js copies the switch to the Android app. The phone and desktop renderers run with it; the Android side is AppLocationTest.java.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { withAppParts } from './fixtures/app-parts.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SWITCH = 'wizard/app-location';
const BASE = 'microphone; clipboard-read; clipboard-write; autoplay; fullscreen';
const MAPS = { id: 'maps', name: 'Maps', url: '/maps/', source: 'apps.json', type: 'service', category: 'app', permissions: ['geolocation'] };
const NOTES = { id: 'wizard-notes', name: 'Notes', url: '/notes/', source: 'apps.json', type: 'view', category: 'app' };

async function shell({ on = false, snapshot = { apps: [MAPS, NOTES] }, cached = null, frames = [] } = {}) {
  const storage = new Map(), observers = [];
  if (cached) storage.set('wux.apps.v1', JSON.stringify(cached));
  const root = { attrs: { 'data-tweaks': on ? 'wizard/desktop-chats ' + SWITCH : 'wizard/desktop-chats' }, getAttribute(k) { return this.attrs[k] ?? null; } };
  const window = { WizCore: { norm: s => s.toLowerCase() }, WizConfig: { endpoint: () => '/apps' }, dispatchEvent() {} };
  let answer = snapshot;
  const ctx = { window, document: { hidden: false, documentElement: root, addEventListener() {}, querySelectorAll: sel => sel === 'iframe[allow]' ? frames : [] },
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe(node, o) { this.node = node; this.o = o; } },
    CustomEvent: class {}, URL, location: new URL('https://wizard.test/wizard-os-home/'),
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    addEventListener() {}, fetch: async () => ({ ok: answer !== null, json: async () => answer }) };
  vm.runInNewContext(read('web/core/apps.js'), ctx);
  if (snapshot !== null) await window.WizCore.appsLoaded();
  const flip = v => { root.attrs['data-tweaks'] = v ? SWITCH : ''; for (const o of observers) if (o.node === root && o.o.attributeFilter?.includes('data-tweaks')) o.fn([]); };
  const relist = async next => { answer = next; await window.WizCore.refreshApps?.(); };
  return { allow: (o, base = BASE) => window.WizCore.frameAllow(base, o), flip, relist, window };
}

// A frame as the shell draws it: attributes plus a same-origin page that can be reloaded.
function frame(attrs, href) {
  const f = { attrs: { ...attrs }, reloads: 0, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; },
    get src() { return this.attrs.src || ''; } };
  f.contentWindow = { location: { href: href || attrs.src || '', reload: () => { f.reloads++; } } };
  return f;
}

test('switch off: every app frame, Maps too, says geolocation \'none\' (denied with no prompt, as before)', async () => {
  const s = await shell();
  assert.equal(s.allow({ id: 'maps' }), BASE + "; geolocation 'none'");
  assert.equal(s.allow({ id: 'wizard-notes' }), BASE + "; geolocation 'none'");
  assert.equal(s.allow({ url: '/maps/' }), BASE + "; geolocation 'none'");
});

test('switch on: only the app that declared location (Maps) gets it; any other app stays blocked', async () => {
  const s = await shell({ on: true });
  assert.equal(s.allow({ id: 'maps' }), BASE + '; geolocation');
  assert.equal(s.allow({ id: 'wizard-notes' }), BASE + "; geolocation 'none'");
  assert.equal(s.allow({ id: 'unknown' }), BASE + "; geolocation 'none'");
  assert.equal(s.allow({}), BASE + "; geolocation 'none'");
  s.flip(false);
  assert.equal(s.allow({ id: 'maps' }), BASE + "; geolocation 'none'", 'reads the switch at every frame, never a stale copy');
});

test('turning the switch off takes location back from an open Maps frame (here or from another device): allow + reload', async () => {
  const maps = frame({ 'data-own-app': 'maps', src: '/maps/', allow: BASE + '; geolocation' });
  const sheet = frame({ allow: 'microphone; clipboard-read; clipboard-write; fullscreen; geolocation' }, 'https://wizard.test/maps/?q=x');
  const notes = frame({ 'data-own-app': 'wizard-notes', src: '/notes/', allow: BASE + "; geolocation 'none'" });
  const s = await shell({ on: true, frames: [maps, sheet, notes] });
  s.flip(true);
  assert.equal(maps.reloads + sheet.reloads + notes.reloads, 0, 'nothing changes while it stays allowed');
  s.flip(false);
  assert.equal(maps.attrs.allow, BASE + "; geolocation 'none'");
  assert.equal(sheet.attrs.allow, "microphone; clipboard-read; clipboard-write; fullscreen; geolocation 'none'");
  assert.deepEqual([maps.reloads, sheet.reloads, notes.reloads], [1, 1, 0]);
  s.flip(true);
  assert.equal(maps.attrs.allow, BASE + "; geolocation 'none'", 'never grants on its own; the next frame drawn asks');
  assert.equal(maps.reloads, 1);
});

test('an app that stops declaring location loses it on the next box read', async () => {
  const maps = frame({ 'data-own-app': 'maps', src: '/maps/', allow: BASE + '; geolocation' });
  const s = await shell({ on: true, frames: [maps] });
  assert.equal(maps.reloads, 0);
  await s.relist({ apps: [{ ...MAPS, permissions: [] }, NOTES] });
  assert.equal(maps.attrs.allow, BASE + "; geolocation 'none'");
  assert.equal(maps.reloads, 1);
});

test('a link sheet page gets location only under a declaring app\'s address; an app at the site root never claims all', async () => {
  const root = { id: 'rooty', name: 'Rooty', url: '/', source: 'apps.json', permissions: ['geolocation'] };
  const s = await shell({ on: true, snapshot: { apps: [MAPS, NOTES, root] } });
  const sheet = 'microphone; clipboard-read; clipboard-write; fullscreen';
  assert.equal(s.allow({ url: 'https://wizard.test/maps/?q=cafe' }, sheet), sheet + '; geolocation');
  assert.equal(s.allow({ url: '/maps/place/1' }, sheet), sheet + '; geolocation');
  assert.equal(s.allow({ url: '/notes/' }, sheet), sheet + "; geolocation 'none'");
  assert.equal(s.allow({ url: '/mapsx/' }, sheet), sheet + "; geolocation 'none'");
  assert.equal(s.allow({ url: 'https://elsewhere.example/maps/' }, sheet), sheet + "; geolocation 'none'");
  assert.equal(s.allow({ url: '/wizard-os-home/' }, sheet), sheet + "; geolocation 'none'");
});

test('only the box\'s own list grants it: a device cache, a malformed value or another power never does', async () => {
  const cachedOnly = await shell({ on: true, snapshot: null, cached: [MAPS] });
  assert.equal(cachedOnly.allow({ id: 'maps' }), BASE + "; geolocation 'none'");
  const odd = await shell({ on: true, snapshot: { apps: [{ ...MAPS, permissions: 'geolocation' }, { ...NOTES, permissions: ['camera', 'microphone'] }] } });
  assert.equal(odd.allow({ id: 'maps' }), BASE + "; geolocation 'none'");
  assert.equal(odd.allow({ id: 'wizard-notes' }), BASE + "; geolocation 'none'");
});

test('the phone and desktop app frames, drawn by their real renderers, take their allow from frameAllow', async () => {
  // Each shell's real frame markup (phone app-frame.js renderFrameCore, desktop desktop-resize.js bodyHtml), drawn with
  // the real core/apps.js frameAllow: Maps gets location only with the switch on; Notes never does.
  const raw = p => withAppParts(withShellParts(read(p)));
  const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const drawnAllow = (s, code, call, a) => {
    const w = { id: 'w1', app: 'frame', appId: a.id, url: a.url };
    const doc = createDocument();
    doc.body.innerHTML = runRecording(code + `\nthis.out = ${call};`, { window: { WizCore: s.window.WizCore, WosBoundView: { badge: () => '' }, WosAgents: {} },
      esc, a, w, appOf: () => a, winApp: () => a, winTitle: () => a.name, ico: () => '', desktopVars: { hud: null }, globalThis: {}, MOD: '⌥', reloadable: () => false }).out;
    return doc.querySelector('iframe')?.getAttribute('allow');
  };
  const phone = block(raw('web/app-frame.js'), '  function renderFrameCore('), desk = block(raw('web/desktop/desktop-resize.js'), '  function bodyHtml(');
  for (const on of [false, true]) {
    const s = await shell({ on });
    for (const [shellName, code, call] of [['phone', phone, 'renderFrameCore(w, a)'], ['desktop', desk, 'bodyHtml(w)']]) {
      assert.equal(drawnAllow(s, code, call, MAPS), BASE + (on ? '; geolocation' : "; geolocation 'none'"), `${shellName} Maps, switch ${on}`);
      assert.equal(drawnAllow(s, code, call, NOTES), BASE + "; geolocation 'none'", `${shellName} Notes, switch ${on}`);
    }
  }
});

// static-rule: every iframe the shell draws has a location rule (an inventory of frame sites, not a feature)
test('every other iframe in the shell says geolocation \'none\', or asks frameAllow', () => {
  const files = [];
  const walk = d => { for (const n of readdirSync(new URL('../' + d, import.meta.url))) { const p = d + '/' + n; if (n === 'vendor' || n === 'tweaks') continue; if (statSync(new URL('../' + p, import.meta.url)).isDirectory()) walk(p); else if (/\.(js|html)$/.test(n)) files.push(p); } };
  walk('web');
  let sites = 0;
  for (const f of files) {
    const frameSource = read(f);
    for (const m of frameSource.matchAll(/<iframe\b[^>]*>|createElement\('iframe'\)[\s\S]{0,700}/g)) {
      sites++;
      const near = m[0];
      assert.ok(/geolocation/.test(near), `${f}: an iframe without a geolocation rule: ${near.slice(0, 120)}`);
      if (!/frameAllow/.test(near) && f !== 'web/install.js') assert.ok(near.includes("geolocation 'none'") || near.includes("geolocation \\'none\\'"), `${f}: ${near.slice(0, 160)}`);
    }
  }
  assert.ok(sites >= 12, `found ${sites} iframe sites`);
});

function relay({ on = false, native = true, session = '' } = {}) {
  const switches = [], timers = [], observers = [], winListeners = {};
  const root = { dataset: { tweaks: on ? 'wizard/desktop-chats ' + SWITCH : 'wizard/desktop-chats' }, setAttribute() {} };
  const href = 'https://wizard.example/wizard-os-home/' + (session ? '?app-session=' + session : '');
  const c = { URL, URLSearchParams, console, JSON, Date, Proxy, Reflect, location: new URL(href),
    document: { readyState: 'complete', hidden: false, documentElement: root, body: { appendChild() {} }, querySelectorAll: () => [],
      createElement: () => ({}), getElementById: () => null, addEventListener() {} },
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} },
    navigator: {}, dispatchEvent() {}, CustomEvent: class {}, localStorage: { getItem: () => null, setItem() {} },
    setInterval() {}, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    addEventListener: (n, f) => (winListeners[n] ||= []).push(f) };
  c.window = c;
  c.WizCore = { apps: () => ({ APPS: [], APP: {} }) };
  if (native) c.WizardOSNative = { appLocationSwitch: v => switches.push(v) };
  vm.createContext(c);
  for (const f of ['web/core/home-screen-policy.js', 'web/core/deeplink.js', 'web/core/android-relay.js']) vm.runInContext(read(f), c);
  const flip = v => { root.dataset.tweaks = v ? 'wizard/desktop-chats ' + SWITCH : 'wizard/desktop-chats'; for (const o of observers) o.fn([]); };
  const settle = () => { for (const t of timers.filter(t => t.ms === 5000)) t.fn(); };
  return { switches, flip, settle };
}

test('the main page copies the switch to the Android app: off once settled, on at once; app windows never do', () => {
  const off = relay();
  assert.deepEqual(off.switches, []);
  off.settle();
  assert.deepEqual(off.switches, [false]);
  const on = relay({ on: true });
  assert.deepEqual(on.switches, [true]);
  on.flip(false); assert.deepEqual(on.switches, [true], 'off waits until the switches settled');
  on.settle(); assert.deepEqual(on.switches, [true, false]);
  on.flip(true); assert.deepEqual(on.switches, [true, false, true]);
  const pinned = relay({ on: true, session: 'maps' });
  pinned.settle();
  assert.deepEqual(pinned.switches, []);
  assert.doesNotThrow(() => relay({ native: false, on: true }).settle());
});
