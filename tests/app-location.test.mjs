// Location only for the apps that ask for it (wizard-ux issue 1629, on for everyone: the switch wizard/app-location is gone).
// The real core/apps.js runs in a vm: an app frame gets `geolocation` in its `allow` only when the box's own app list
// says the app declared `permissions: [geolocation]`; every other frame says `geolocation 'none'`.
// The real android-relay.js tells older Android apps (which kept a copy of the switch) it is on. The phone and desktop
// renderers run with it; the Android side is AppLocationTest.java.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { withAppParts } from './fixtures/app-parts.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const GONE_SWITCH = 'wizard/app-location';
const BASE = 'microphone; clipboard-read; clipboard-write; autoplay; fullscreen';
const MAPS = { id: 'maps', name: 'Maps', url: '/maps/', source: 'apps.json', type: 'service', category: 'app', permissions: ['geolocation'] };
const NOTES = { id: 'wizard-notes', name: 'Notes', url: '/notes/', source: 'apps.json', type: 'view', category: 'app' };

async function shell({ tweaks = 'wizard/desktop-chats', snapshot = { apps: [MAPS, NOTES] }, cached = null, frames = [] } = {}) {
  const storage = new Map(), observers = [];
  if (cached) storage.set('wux.apps.v1', JSON.stringify(cached));
  const root = { attrs: { 'data-tweaks': tweaks }, getAttribute(k) { return this.attrs[k] ?? null; } };
  const window = { WizCore: { norm: s => s.toLowerCase() }, WizConfig: { endpoint: () => '/apps' }, dispatchEvent() {} };
  let answer = snapshot;
  const ctx = { window, document: { hidden: false, documentElement: root, addEventListener() {}, querySelectorAll: sel => sel === 'iframe[allow]' ? frames : [] },
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe(node, o) { this.node = node; this.o = o; } },
    CustomEvent: class {}, URL, location: new URL('https://wizard.test/wizard-os-home/'),
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    addEventListener() {}, fetch: async () => ({ ok: answer !== null, json: async () => answer }) };
  vm.runInNewContext(read('web/core/apps.js'), ctx);
  if (snapshot !== null) await window.WizCore.appsLoaded();
  const flip = v => { root.attrs['data-tweaks'] = v; for (const o of observers) if (o.node === root && o.o.attributeFilter?.includes('data-tweaks')) o.fn([]); };
  const relist = async next => { answer = next; await window.WizCore.refreshApps?.(); };
  return { allow: (o, base = BASE) => window.WizCore.frameAllow(base, o), flip, relist, window };
}

// A frame as the shell draws it: attributes plus a same-origin page that can be reloaded.
function frame(attrs, href) {
  const f = { attrs: { ...attrs }, reloads: 0, srcSets: 0, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { if (k === 'src') this.srcSets++; this.attrs[k] = v; },
    get src() { return this.attrs.src || ''; } };
  f.contentWindow = { location: { href: href || attrs.src || '', reload: () => { f.reloads++; } } };
  return f;
}

test('no switch: only the app that declared location (Maps) gets it; any other app stays blocked', async () => {
  for (const tweaks of ['', 'wizard/desktop-chats', GONE_SWITCH]) {
    const s = await shell({ tweaks });
    assert.equal(s.allow({ id: 'maps' }), BASE + '; geolocation', `tweaks "${tweaks}"`);
    assert.equal(s.allow({ url: '/maps/' }), BASE + '; geolocation');
    assert.equal(s.allow({ id: 'wizard-notes' }), BASE + "; geolocation 'none'");
    assert.equal(s.allow({ id: 'unknown' }), BASE + "; geolocation 'none'");
    assert.equal(s.allow({}), BASE + "; geolocation 'none'");
  }
});

test('the old switch going on or off changes nothing on an open Maps frame (no reloads, location stays)', async () => {
  const maps = frame({ 'data-own-app': 'maps', src: '/maps/', allow: BASE + '; geolocation' });
  const notes = frame({ 'data-own-app': 'wizard-notes', src: '/notes/', allow: BASE + "; geolocation 'none'" });
  const s = await shell({ tweaks: GONE_SWITCH, frames: [maps, notes] });
  s.flip(''); s.flip(GONE_SWITCH); s.flip('');
  assert.equal(maps.attrs.allow, BASE + '; geolocation');
  assert.equal(notes.attrs.allow, BASE + "; geolocation 'none'");
  assert.deepEqual([maps.reloads, notes.reloads], [0, 0]);
  assert.equal(s.allow({ id: 'maps' }), BASE + '; geolocation');
});

test('a Maps frame drawn before the box\'s app list arrived (fresh start, ?open=maps) gains location once the list says so', async () => {
  // The shell draws from the device cache, which never grants, so the first frame says 'none'.
  const maps = frame({ 'data-own-app': 'maps', class: 'appframe', src: '/maps/', allow: BASE + "; geolocation 'none'" }, 'https://wizard.test/maps/');
  const pinned = frame({ class: 'appframe', src: '/maps/', allow: BASE + "; geolocation 'none'" }, 'about:blank');
  const notes = frame({ 'data-own-app': 'wizard-notes', class: 'appframe', src: '/notes/', allow: BASE + "; geolocation 'none'" });
  const hidden = frame({ class: 'appframe', 'data-voice-service': 'maps', src: '/maps/', allow: "geolocation 'none'" });
  const settings = frame({ src: '/maps/embed', allow: "geolocation 'none'" });
  const s = await shell({ snapshot: null, cached: [MAPS], frames: [maps, pinned, notes, hidden, settings] });
  assert.equal(s.allow({ id: 'maps' }), BASE + "; geolocation 'none'", 'before the box answers');
  await new Promise(r => setTimeout(r, 0)); // the first read (the box did not answer) has settled
  await s.relist({ apps: [MAPS, NOTES] });
  assert.equal(maps.attrs.allow, BASE + '; geolocation');
  assert.equal(pinned.attrs.allow, BASE + '; geolocation', 'the pinned app page too (by its address)');
  assert.deepEqual([maps.reloads, pinned.reloads], [1, 0], 'a frame still on its blank first page restarts from its src instead');
  assert.equal(pinned.srcSets, 1);
  for (const f of [notes, hidden, settings]) assert.equal(f.attrs.allow.endsWith("geolocation 'none'"), true);
  assert.deepEqual([notes.reloads, hidden.reloads, settings.reloads], [0, 0, 0]);
  await s.relist({ apps: [MAPS, NOTES] });
  assert.equal(maps.reloads, 1, 'a second read of the same list reloads nothing');
});

test('an app that stops declaring location loses it on the next box read', async () => {
  const maps = frame({ 'data-own-app': 'maps', src: '/maps/', allow: BASE + '; geolocation' });
  const s = await shell({ frames: [maps] });
  assert.equal(maps.reloads, 0);
  await s.relist({ apps: [{ ...MAPS, permissions: [] }, NOTES] });
  assert.equal(maps.attrs.allow, BASE + "; geolocation 'none'");
  assert.equal(maps.reloads, 1);
});

test('a link sheet page gets location only under a declaring app\'s address; an app at the site root never claims all', async () => {
  const root = { id: 'rooty', name: 'Rooty', url: '/', source: 'apps.json', permissions: ['geolocation'] };
  const s = await shell({ snapshot: { apps: [MAPS, NOTES, root] } });
  const sheet = 'microphone; clipboard-read; clipboard-write; fullscreen';
  assert.equal(s.allow({ url: 'https://wizard.test/maps/?q=cafe' }, sheet), sheet + '; geolocation');
  assert.equal(s.allow({ url: '/maps/place/1' }, sheet), sheet + '; geolocation');
  assert.equal(s.allow({ url: '/notes/' }, sheet), sheet + "; geolocation 'none'");
  assert.equal(s.allow({ url: '/mapsx/' }, sheet), sheet + "; geolocation 'none'");
  assert.equal(s.allow({ url: 'https://elsewhere.example/maps/' }, sheet), sheet + "; geolocation 'none'");
  assert.equal(s.allow({ url: '/wizard-os-home/' }, sheet), sheet + "; geolocation 'none'");
});

test('only the box\'s own list grants it: a device cache, a malformed value or another power never does', async () => {
  const cachedOnly = await shell({ snapshot: null, cached: [MAPS] });
  assert.equal(cachedOnly.allow({ id: 'maps' }), BASE + "; geolocation 'none'");
  const odd = await shell({ snapshot: { apps: [{ ...MAPS, permissions: 'geolocation' }, { ...NOTES, permissions: ['camera', 'microphone'] }] } });
  assert.equal(odd.allow({ id: 'maps' }), BASE + "; geolocation 'none'");
  assert.equal(odd.allow({ id: 'wizard-notes' }), BASE + "; geolocation 'none'");
});

test('the phone and desktop app frames, drawn by their real renderers, take their allow from frameAllow', async () => {
  // Each shell's real frame markup (phone app-frame.js renderFrameCore, desktop desktop-resize.js bodyHtml), drawn with
  // the real core/apps.js frameAllow: Maps gets location; Notes never does.
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
  const s = await shell();
  for (const [shellName, code, call] of [['phone', phone, 'renderFrameCore(w, a)'], ['desktop', desk, 'bodyHtml(w)']]) {
    assert.equal(drawnAllow(s, code, call, MAPS), BASE + '; geolocation', `${shellName} Maps`);
    assert.equal(drawnAllow(s, code, call, NOTES), BASE + "; geolocation 'none'", `${shellName} Notes`);
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

function relay({ native = true, session = '' } = {}) {
  const switches = [], timers = [];
  const root = { dataset: { tweaks: 'wizard/desktop-chats' }, setAttribute() {} };
  const href = 'https://wizard.example/wizard-os-home/' + (session ? '?app-session=' + session : '');
  const c = { URL, URLSearchParams, console, JSON, Date, Proxy, Reflect, location: new URL(href),
    document: { readyState: 'complete', hidden: false, documentElement: root, body: { appendChild() {} }, querySelectorAll: () => [],
      createElement: () => ({}), getElementById: () => null, addEventListener() {} },
    MutationObserver: class { observe() {} },
    navigator: {}, dispatchEvent() {}, CustomEvent: class {}, localStorage: { getItem: () => null, setItem() {} },
    setInterval() {}, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    addEventListener() {} };
  c.window = c;
  c.WizCore = { apps: () => ({ APPS: [], APP: {} }) };
  if (native) c.WizardOSNative = { appLocationSwitch: v => switches.push(v) };
  vm.createContext(c);
  for (const f of ['web/core/home-screen-policy.js', 'web/core/deeplink.js', 'web/core/android-relay.js']) vm.runInContext(read(f), c);
  const settle = () => { for (const t of timers.filter(t => t.ms === 5000)) t.fn(); };
  return { switches, settle };
}

test('the main page tells older Android apps (with a copy of the old switch) it is on, once; app windows never do', () => {
  const main = relay();
  assert.deepEqual(main.switches, [true]);
  main.settle();
  assert.deepEqual(main.switches, [true], 'never off, never again');
  const pinned = relay({ session: 'maps' });
  pinned.settle();
  assert.deepEqual(pinned.switches, []);
  assert.doesNotThrow(() => relay({ native: false }).settle());
});

test('the switch is gone, and a saved on/off for it is cleared from the device and never requested', async () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(!cat.tweaks.includes(GONE_SWITCH) && !(cat.defaults || []).includes(GONE_SWITCH));
  assert.equal(existsSync(new URL('../web/tweaks/wizard/app-location', import.meta.url)), false);
  assert.ok(!Object.values(JSON.parse(read('skill/help.json'))).some(g => g && typeof g === 'object' && Object.hasOwn(g, GONE_SWITCH)));
  const storage = new Map([['wos.skin', 'obsidian'], ['wos.channel.v1', 'latest'],
    ['wos.skin-tweaks.v1', JSON.stringify({ version: 1, off: {}, preset: 'none', mix: { [GONE_SWITCH]: true, 'miguel/send-and-go': true }, defaultsMigrated: true, machinesHomeMoved: true, miguelLayoutMoved: true })]]);
  let active = [];
  const window = { WosSkin: { current: 'obsidian', families: [], familyOf: () => 'mizel' }, WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, loadTweaks: async ids => { active = ids; } },
    addEventListener() {}, dispatchEvent() {} };
  vm.runInNewContext(read('web/core/experience.js'), { window, setTimeout, document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {} }, Event, URL, AbortSignal, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(read('web/' + url.pathname.split('/wizard-os-home/')[1])) }) });
  await window.WosExperience.refresh();
  const now = JSON.parse(storage.get('wos.skin-tweaks.v1'));
  assert.equal(Object.hasOwn(now.mix, GONE_SWITCH), false); assert.equal(now.mix['miguel/send-and-go'], true, 'other choices kept');
  assert.ok(!active.includes(GONE_SWITCH));
  assert.ok(!window.WosExperience.state.tweaks.some(t => t.id === GONE_SWITCH), 'not offered as a switch');
});
