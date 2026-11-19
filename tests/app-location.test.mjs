// Location only for the apps that ask for it (wizard-ux issue 1629, switch wizard/app-location, off by default).
// The real core/apps.js runs in a vm: an app frame gets `geolocation` in its `allow` only while the switch is on AND the
// box's own app list says the app declared `permissions: [geolocation]`; every other frame says `geolocation 'none'`.
// The real android-relay.js copies the switch to the Android app. Every iframe the shell draws is checked from source.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SWITCH = 'wizard/app-location';
const BASE = 'microphone; clipboard-read; clipboard-write; autoplay; fullscreen';
const MAPS = { id: 'maps', name: 'Maps', url: '/maps/', source: 'apps.json', type: 'service', category: 'app', permissions: ['geolocation'] };
const NOTES = { id: 'wizard-notes', name: 'Notes', url: '/notes/', source: 'apps.json', type: 'view', category: 'app' };

async function shell({ on = false, snapshot = { apps: [MAPS, NOTES] }, cached = null } = {}) {
  const storage = new Map();
  if (cached) storage.set('wux.apps.v1', JSON.stringify(cached));
  const root = { attrs: { 'data-tweaks': on ? 'wizard/desktop-chats ' + SWITCH : 'wizard/desktop-chats' }, getAttribute(k) { return this.attrs[k] ?? null; } };
  const window = { WizCore: { norm: s => s.toLowerCase() }, WizConfig: { endpoint: () => '/apps' }, dispatchEvent() {} };
  const ctx = { window, document: { hidden: false, documentElement: root, addEventListener() {} }, CustomEvent: class {}, URL,
    location: new URL('https://wizard.test/wizard-os-home/'),
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    addEventListener() {}, fetch: async () => ({ ok: snapshot !== null, json: async () => snapshot }) };
  vm.runInNewContext(read('web/core/apps.js'), ctx);
  if (snapshot !== null) await window.WizCore.appsLoaded();
  const flip = v => { root.attrs['data-tweaks'] = v ? SWITCH : ''; };
  return { allow: (o, base = BASE) => window.WizCore.frameAllow(base, o), flip };
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

test('the shell header allows location for Wizard itself only; every iframe the shell draws says who may use it', () => {
  assert.match(read('packaging/static.conf'), /Permissions-Policy "[^"]*\bgeolocation=\(self\)/);
  assert.doesNotMatch(read('packaging/static.conf'), /geolocation=\(?\*/);
  // App frames go through frameAllow with the app's id (or the page URL in the link sheet).
  assert.match(read('web/app.js'), /<iframe class="appframe"[^\n]*allow="\$\{esc\(window\.WizCore\.frameAllow\?\.\('microphone; clipboard-read; clipboard-write; autoplay; fullscreen', \{ id: a\.id \}\)/);
  assert.match(read('web/desktop/desktop.js'), /<iframe data-own-app[^\n]*allow="\$\{esc\(window\.WizCore\.frameAllow\?\.\('microphone; clipboard-read; clipboard-write; autoplay; fullscreen', \{ id: a\.id \}\)/);
  assert.match(read('web/core/single-app-session.js'), /frame\.setAttribute\('allow', window\.WizCore\?\.frameAllow\?\.\('[^']+', \{ id: next\.id \|\| id \}\)/);
  assert.match(read('web/core/links.js'), /frame\.setAttribute\('allow', window\.WizCore\?\.frameAllow\?\.\('[^']+', \{ url \}\)[^\n]*\n\s*try \{ frame\.contentWindow\.location\.replace\(url\)/);
  // Every other iframe in the shell (and its fallbacks) says geolocation 'none', or is the pinned shell page itself.
  const files = [];
  const walk = d => { for (const n of readdirSync(new URL('../' + d, import.meta.url))) { const p = d + '/' + n; if (n === 'vendor' || n === 'tweaks') continue; if (statSync(new URL('../' + p, import.meta.url)).isDirectory()) walk(p); else if (/\.(js|html)$/.test(n)) files.push(p); } };
  walk('web');
  let sites = 0;
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/<iframe\b[^>]*>|createElement\('iframe'\)[\s\S]{0,700}/g)) {
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

test('Android: location is asked only through Android\'s prompt, only for this Wizard, never remembered by the WebView', () => {
  const main = read('android/app/src/main/java/ai/wizards/os/MainActivity.java');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android\.permission\.ACCESS_FINE_LOCATION/);
  assert.match(manifest, /android\.permission\.ACCESS_COARSE_LOCATION/);
  assert.match(main, /onGeolocationPermissionsShowPrompt\(String origin, GeolocationPermissions\.Callback callback\)/);
  const h = main.slice(main.indexOf('private void handleGeolocation('), main.indexOf('private void handleWebPermission('));
  assert.ok(h.includes('if (!AppLocation.mayAsk(AppLocation.on(this), ai.wizards.os.device.AppState.primaryOrigin(this), origin)) {\n            cb.invoke(origin, false, false);'));
  assert.match(h, /requestPermissions\(new String\[\]\{Manifest\.permission\.ACCESS_FINE_LOCATION, Manifest\.permission\.ACCESS_COARSE_LOCATION\}, REQ_LOCATION\)/);
  assert.doesNotMatch(h, /invoke\([^)]*, true\)/, 'the WebView never retains a grant');
  const r = main.slice(main.indexOf('if (code == REQ_LOCATION)'), main.indexOf('if (code == REQ_EVERYWHERE)'));
  assert.match(r, /cb\.invoke\(origin, ok && AppLocation\.mayAsk\(/);
  assert.match(main, /public void appLocationSwitch\(boolean on\) \{\s*if \(MainActivity\.this instanceof AppSessionActivity\) return;/);
});

test('the switch is listed for the Tracker and is off by default', () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(cat.tweaks.includes(SWITCH));
  assert.ok(!(cat.defaults || []).includes(SWITCH));
  const m = JSON.parse(read('web/tweaks/wizard/app-location/manifest.json'));
  assert.equal(m.id, SWITCH);
  assert.deepEqual(m.issues, ['humanitylabs-org/wizard-ux#1629']);
});
