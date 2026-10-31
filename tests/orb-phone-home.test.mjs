// Orbs view on the phone (Miguel, 31 Oct 2026; experimental): the miguel/orb-shell tweak now also wears the Orb layout
// on the phone, where it only changes Home. Guards:
//   - phone, Orbs, on Home: the desktop's orb scene (the same sky, the same Style × Colour, the same satellite list,
//     shared.js) with the orb centred; the dock orb wears the same look; off Home (a thread, an app, another desk) or
//     during a take the orb is back in the dock;
//   - Desks (the tweak off) restores the stock phone Home exactly: every node goes, the flags that hide the stock orb go;
//   - the desktop is untouched: its layout code never reaches the phone part, phone CSS can't match the desktop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fixture } from './fixtures/tweaks.mjs';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');

/* ---------- a small DOM, enough for phone.js ---------- */
const ctx2d = () => new Proxy({}, { get: (t, k) => k in t ? t[k] : (k === 'fillStyle' ? '#000000' : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.nodeType = 1; this.children = []; this.parentNode = null; this.dataset = {}; this.attrs = {}; this.className = ''; this.hidden = false; this.inert = false; this.listeners = {};
    const st = {}; this.style = Object.assign(st, { setProperty(k, v) { st[k] = v; }, removeProperty(k) { delete st[k]; } });
    const self = this; this.classList = { set: new Set(), add(...c) { c.forEach(x => this.set.add(x)); }, remove(...c) { c.forEach(x => this.set.delete(x)); }, toggle(c, on) { (on ?? !this.set.has(c)) ? this.set.add(c) : this.set.delete(c); return this.set.has(c); }, contains(c) { return this.set.has(c) || self.className.split(' ').includes(c); } };
    this.clientWidth = 390; this.clientHeight = 844; this.width = 0; this.height = 0; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...n) { for (const c of n) { if (typeof c === 'string') continue; c.parentNode?.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = this; this.children.push(c); } }
  appendChild(c) { this.append(c); return c; }
  prepend(c) { c.parentNode?.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = this; this.children.unshift(c); }
  replaceChildren(...n) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...n); }
  remove() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; } }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.tagName === 'HTML'; }
  getContext(kind) { return kind === '2d' ? (this._c ||= ctx2d()) : null; }
  getBoundingClientRect() { return this.rect || { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter(f => f !== fn); }
  dispatchEvent(e) { (this.dispatched ||= []).push(e); for (const fn of this.listeners[e.type] || []) fn(e); return true; }
  decode() { return Promise.resolve(); }
  focus() {}
}
function phoneWorld({ home = true } = {}) {
  const html = new El('html'), body = new El('body'), device = new El('div'), homeSec = new El('section'), orbWrap = new El('div');
  html.append(body); body.append(device); device.append(homeSec, orbWrap);
  html.dataset.shell = 'phone'; html.dataset.layout = 'orb';
  orbWrap.rect = { left: 162, top: 767, width: 66, height: 66 };
  const doc = { documentElement: html, body, hidden: false, createElement: t => new El(t), addEventListener() {}, removeEventListener() {} };
  Object.assign(globalThis, { document: doc, getComputedStyle: () => ({ getPropertyValue: n => n === '--ob-look-nebula' ? '#7c5cff, #c26bff, #4cc9ff, #ff6bd6' : '' }), matchMedia: () => ({ matches: false }), devicePixelRatio: 2,
    PointerEvent: class { constructor(type, init) { Object.assign(this, init, { type }); } } });
  const state = { home, voice: { state: 'idle' }, running: [{ id: 'mail', open: false, playing: false }], badges: { notes: 3 }, opened: [], frames: 0, store: { style: 'plasma', colour: 'nebula' } };
  const on = {}, offs = [];
  const apps = [{ id: 'mail', name: 'Mail', icon: '<span class="ic sg-mail"></span>' }, { id: 'notes', name: 'Notes', icon: '' }, { id: 'agents', name: 'Agents', icon: '', agent: true }, { id: 'settings', name: 'Settings', icon: '', system: true }];
  const api = {
    env: { shell: 'phone' }, route: () => ({ home: state.home }), on: (t, fn) => { (on[t] ||= []).push(fn); return () => {}; },
    asset: n => 'layouts/orb/' + n, mount: n => { device.append(n); return () => n.remove(); },
    listen: (t, type, fn) => { t.addEventListener?.(type, fn); offs.push(() => t.removeEventListener?.(type, fn)); return () => {}; },
    frame: () => { state.frames++; return () => {}; }, after: () => () => {},
    voice: { state: () => state.voice, tap() {} }, orb: { onLevel() {} },
    storage: { get: k => state.store[k] ?? null, set: (k, v) => { state.store[k] = v; } },
    apps: { list: () => apps.map(a => ({ ...a })), badges: () => ({ ...state.badges }), logo: () => Promise.resolve(null), open: id => state.opened.push(id) },
    panel: { running: () => state.running },
    phone: { home: () => homeSec, orb: () => orbWrap },
  };
  const fire = t => { for (const fn of on[t] || []) fn({ ...state.voice }); };
  return { html, device, homeSec, orbWrap, api, state, fire, find: cls => { const all = []; const walk = n => { for (const c of n.children) { if (String(c.className).split(' ').includes(cls)) all.push(c); walk(c); } }; walk(html); return all; } };
}

test('phone, Orbs, on Home: the desktop orb scene (shared sky, look and satellites), the orb centred, the dock orb in the same look', async () => {
  const P = phoneWorld();
  const { default: phone } = await import(new URL('web/layouts/orb/phone.js', root));
  const off = phone(P.api);
  assert.equal(P.html.dataset.orbPhone, 'on', 'the stock dock drawing steps aside only while the scene is mounted');
  assert.equal(P.homeSec.children[0].className, 'obp-sky', 'the sky lives in the Home desk (it slides with the desks)');
  const layer = P.find('obp-layer')[0]; assert.ok(layer && layer.parentNode === P.device, 'the orb layer over the desks');
  assert.ok(P.orbWrap.children.some(c => c.className === 'obp-dockc'), 'the dock orb draws in the stock orb\'s own box');
  assert.equal(P.html.dataset.orbScene, 'home'); assert.equal(P.html.dataset.orbAt, 'centre', 'on Home the orb is up in the middle');
  assert.ok(layer.classList.contains('is-home'));
  // satellites: exactly the shared list (running apps + regular apps with a count; never agents or system apps)
  assert.deepEqual(P.find('obp-sat').map(b => b.attrs['data-app']).sort(), ['mail', 'notes']);
  assert.equal(P.find('obp-sat').find(b => b.attrs['data-app'] === 'mail').dataset.run, 'hidden', 'open on a desk: a quiet dot');
  // a press on the centre orb is the dock orb's own gesture (same pointer, same place)
  const btn = P.find('obp-orbbtn')[0];
  btn.dispatchEvent({ type: 'pointerdown', pointerId: 7, isPrimary: true, clientX: 195, clientY: 420, button: 0, buttons: 1, preventDefault() {} });
  const handed = P.orbWrap.dispatched?.find(e => e.type === 'pointerdown');
  assert.ok(handed && handed.pointerId === 7 && handed.clientY === 420 && handed.isPrimary, 'handed to the dock orb with the same pointer');
  // a thread / an app / another desk: back into the dock
  P.state.home = false; P.fire('route');
  assert.equal(P.html.dataset.orbAt, 'dock'); assert.equal(P.html.dataset.orbScene, 'desk'); assert.ok(!layer.classList.contains('is-home'));
  // Home again: up in the middle; a take starts: down into the dock where its controls are
  P.state.home = true; P.fire('route'); assert.equal(P.html.dataset.orbAt, 'centre');
  P.state.voice = { state: 'listen' }; P.fire('voice'); assert.equal(P.html.dataset.orbAt, 'dock');
  P.state.voice = { state: 'idle' }; P.fire('voice'); assert.equal(P.html.dataset.orbAt, 'centre');
  // Desks: everything it put anywhere goes, so the stock Home and the stock dock orb are exactly back
  off(); for (const n of [...P.find('obp-layer'), ...P.find('obp-sky')]) n.remove();   // api.mount nodes go with the layer (skin-host)
  assert.equal(P.find('obp-sky').length + P.find('obp-dockc').length, 0);
  assert.equal(P.html.dataset.orbPhone, undefined); assert.equal(P.html.dataset.orbAt, undefined); assert.equal(P.html.dataset.orbScene, undefined);
});

test('phone: the same stored Style × Colour and drawing code as the desktop, never a second copy', () => {
  const strip = f => read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const ph = strip('web/layouts/orb/phone.js'), lay = read('web/layouts/orb/layout.js');
  assert.match(ph, /import \{ renderer \} from '\.\/styles\.js';/); assert.match(ph, /import \{ lookOf, palettes, starsFor, paintSky, orbitApps, glyphOf, colourOf \} from '\.\/shared\.js';/);
  assert.match(ph, /const look = lookOf\(api\);/); assert.match(ph, /orbitApps\(api, badgeMap\)/);
  assert.ok(!/--ob-look-|createRadialGradient|16807/.test(ph), 'no colours or sky of its own');
  assert.match(lay, /if \(api\.env\.shell === 'phone'\) return phone\(api\);\n  if \(api\.env\.shell !== 'desktop'\) return \(\) => \{\};/, 'the desktop path is unchanged below the phone hand-off');
  // calm, quick motion (~250 ms, eased, no bounce); the stock gestures stay on the dock orb
  assert.match(ph, /const FLY = 250;/); assert.match(ph, /cubic-bezier\(\.3, \.7, \.2, 1\)/); assert.ok(!/cubic-bezier\([^)]*-|[^.\d]1\.[1-9]\d*\)/.test(ph.match(/cubic-bezier\([^)]*\)/g).join(' ')), 'no overshoot');
  assert.match(ph, /host\.dispatchEvent\(new PointerEvent\('pointerdown', init\)\)/);
});

test('phone CSS can only match the phone wearing the scene; the desktop and Desks never see it', () => {
  const css = read('web/layouts/orb/phone.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}@]+)\{[^{}]*\}/g)].map(m => m[1].trim()).filter(sel => sel && !/^(to|from|\d+%)$/.test(sel));
  assert.ok(rules.length > 15);
  for (const sel of rules) for (const part of sel.split(/,(?![^(]*\))/)) assert.ok(part.trim().startsWith('html[data-shell="phone"][data-layout="orb"][data-orb-phone]'), `unscoped: ${part.trim()}`);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css), 'colours are the tweak\'s tokens');
  const tw = read('web/tweaks/miguel/orb-shell/tweak.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const sel of [...tw.matchAll(/([^{}@]+)\{[^{}]*\}/g)].map(m => m[1].trim())) for (const part of sel.split(/,(?![^(]*\))/)) {
    const p = part.trim(); assert.ok(p === 'html[data-layout="orb"]' || p.startsWith('html[data-shell="phone"][data-layout="orb"] .home-desk'), `orb-shell tweak.css reaches past the Orbs Home: ${p}`);
  }
  // Desks gives back the stock Home: only the Orbs layout hides anything there
  assert.match(tw, /html\[data-shell="phone"\]\[data-layout="orb"\] \.home-desk \.home > :not\(\[data-slot="home-main"\], \.home-tools\) \{ display: none !important; \}/);
  // the desktop layout CSS stays desktop-only (tests/orb-layout.test.mjs checks every selector)
  assert.ok(!read('web/layouts/orb/layout.css').includes('data-shell="phone"'));
});

test('Desks restores the stock phone: the tweak off releases the layout and its CSS', async () => {
  const f = fixture({ shell: 'phone' });
  await f.mount('miguel/orb-shell');
  assert.equal(f.doc.documentElement.dataset.layout, 'orb');
  await f.clear();
  assert.equal(f.host.layout, 'classic'); assert.equal(f.doc.documentElement.dataset.layout, undefined);
  assert.ok(!f.doc.head.children.some(l => /layouts\//.test(l.href || '')));
});

test('the phone adapter: Home in the route, the same app rows as the desktop, what is running = the app on each desk', () => {
  const app = read('web/app.js'), host = read('web/core/skin-host.js');
  assert.match(app, /: 0, home: idx === HOME \}; \},/);
  assert.match(app, /apps: \(\) => \{ const AK = window\.WosAppKinds; .*system: !!AK\?\.isSystem\?\.\(a\), dev: !!AK\?\.inDev\?\.\(a\), connector: !!AK\?\.isConnector\?\.\(a\), agent: !!a\.agent \|\| a\.kind === 'chats' \}\)\); \},/);
  assert.match(app, /panelRunning: \(\) => \{ const run = new Map\(\); desks\.forEach\(\(d, i\) => \{ if \(d\.home \|\| !d\.wins\.length\) return;/);
  assert.match(app, /homeHost: \(\) => secOf\(HOME\),\n    orbHost: \(\) => orbWrap,/);
  // the hosts are a layout-only extra (skins and tweaks never get them)
  assert.match(host, /phone: Object\.freeze\(\{\n        home: \(\) => live\(\) \? shell\.homeHost\?\.\(\) \|\| null : null,\n        orb: \(\) => live\(\) \? shell\.orbHost\?\.\(\) \|\| null : null,/);
  const run = vm.runInNewContext(`(${app.match(/panelRunning: (\(\) => \{[^\n]*\}),\n/)[1]})`, { desks: [{ home: true, wins: [] }, { wins: ['a'], focus: 'a' }, { wins: ['b', 'c'], focus: 'c' }, { wins: ['d'], focus: 'd' }],
    W: { a: { appId: 'mail' }, b: { appId: 'music' }, c: { app: 'chats' }, d: { appId: 'mail' } }, idx: 3, winApp: w => ({ id: w.app === 'chats' ? 'wizard' : w.appId }), Map });
  assert.deepEqual(JSON.parse(JSON.stringify(run())), [{ id: 'mail', open: true, playing: false }, { id: 'wizard', open: false, playing: false }], 'one per app, the focused window of each desk');
});

test('skins and tweaks never get the phone hosts', async () => {
  const f = fixture({ shell: 'phone' }); let api;
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/orb-shell'], f.slots, { teamAuthors: ['miguel'] });
  assert.equal(api.phone, undefined);
  await f.clear();
});
