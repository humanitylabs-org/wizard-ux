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
  before(c) { const p = this.parentNode; if (!p) return; c.parentNode?.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = p; p.children.splice(p.children.indexOf(this), 0, c); }
  after(c) { const p = this.parentNode; if (!p) return; c.parentNode?.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = p; p.children.splice(p.children.indexOf(this) + 1, 0, c); }
  get nextSibling() { const p = this.parentNode; return p ? p.children[p.children.indexOf(this) + 1] || null : null; }
  get outerHTML() { return `<${this.tagName} ${JSON.stringify(this.attrs)} ${this.className}>${this.textContent || ''}${this.children.map(c => c.outerHTML).join('')}</${this.tagName}>`; }
  setPointerCapture(id) { this.captured = id; }
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
  const html = new El('html'), body = new El('body'), device = new El('div'), homeSec = new El('section'), dock = new El('div'), orbWrap = new El('div');
  html.append(body); body.append(device); device.append(homeSec, dock); dock.append(orbWrap); dock.id = 'dock';
  html.dataset.shell = 'phone'; html.dataset.layout = 'orb';
  orbWrap.rect = { left: 162, top: 767, width: 66, height: 66 };
  const doc = { documentElement: html, body, hidden: false, createElement: t => new El(t), addEventListener() {}, removeEventListener() {} };
  Object.assign(globalThis, { document: doc, getComputedStyle: () => ({ getPropertyValue: n => n === '--ob-look-nebula' ? '#7c5cff, #c26bff, #4cc9ff, #ff6bd6' : '' }), matchMedia: () => ({ matches: false }), devicePixelRatio: 2,
    PointerEvent: class { constructor(type, init) { Object.assign(this, init, { type }); } } });
  const state = { home, app: null, desk: 0, voice: { state: 'idle' }, running: [{ id: 'mail', open: false, playing: false }], badges: { notes: 3 }, opened: [], lists: 0, claimed: [], frames: 0, store: { style: 'plasma', colour: 'nebula' } };
  const on = {}, offs = [];
  const apps = [{ id: 'mail', name: 'Mail', icon: '<span class="ic sg-mail"></span>' }, { id: 'music', name: 'Music', icon: '' }, { id: 'notes', name: 'Notes', icon: '' }, { id: 'agents', name: 'Agents', icon: '', agent: true }, { id: 'settings', name: 'Settings', icon: '', system: true }];
  const api = {
    env: { shell: 'phone', edgeInset: 24 }, route: () => ({ home: state.home, app: state.app, desk: state.desk, thread: null }), on: (t, fn) => { (on[t] ||= []).push(fn); return () => {}; },
    asset: n => 'layouts/orb/' + n, mount: n => { device.append(n); return () => n.remove(); },
    listen: (t, type, fn) => { t.addEventListener?.(type, fn); offs.push(() => t.removeEventListener?.(type, fn)); return () => {}; },
    frame: () => { state.frames++; return () => {}; }, after: () => () => {},
    voice: { state: () => state.voice, tap() {} }, orb: { onLevel() {} },
    storage: { get: k => state.store[k] ?? null, set: (k, v) => { state.store[k] = v; } },
    apps: { list: () => apps.map(a => ({ ...a })), badges: () => ({ ...state.badges }), logo: () => Promise.resolve(null), open: id => state.opened.push(id) },
    panel: { running: () => state.running },
    phone: { home: () => homeSec, orb: () => orbWrap, mark: id => { if (!['mail', 'music', 'notes', 'wizard'].includes(id)) return null; const m = new El('span'); m.className = 'dsg'; m.attrs['data-mark'] = id; return m; } },
    nav: { openList: () => { state.lists++; } },
    gesture: { claim: id => { state.claimed.push(id); return true; } },
  };
  const fire = t => { for (const fn of on[t] || []) fn({ ...state.voice }); };
  return { html, device, homeSec, dock, orbWrap, api, state, fire, find: cls => { const all = []; const walk = n => { for (const c of n.children) { if (String(c.className).split(' ').includes(cls)) all.push(c); walk(c); } }; walk(html); return all; } };
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
  assert.match(ph, /import \{ renderer \} from '\.\/styles\.js';/); assert.match(ph, /import \{ lookOf, palettes, starsFor, paintSky, orbitApps, glyphOf, colourOf, hash, boltPainter \} from '\.\/shared\.js';/);
  assert.match(ph, /const \{ bolt \} = boltPainter\(bx, reduced\);/, 'the bolt is the desktop\'s own drawing (shared.js), never a fork');
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

/* ---------- the bottom bar, spin and bolt (Miguel, 31 Oct 2026) ---------- */
const visibleKids = n => n.children.filter(c => !c.hidden);
test('phone, Orbs: one three-slot bottom bar (last-used other app · orb · Chats), the stock switcher only hidden in Orbs', async () => {
  const P = phoneWorld();
  const { default: phone } = await import(new URL('web/layouts/orb/phone.js', root) + '?bar');
  P.state.running = [{ id: 'mail', open: false }, { id: 'music', open: false }, { id: 'wizard', open: false }];
  const off = phone(P.api);
  const [barL, orb, barR] = P.dock.children;
  assert.equal(orb, P.orbWrap, 'the dock orb is the centre slot');
  assert.equal(barL.attrs['data-obp-slot'], 'left'); assert.equal(barR.attrs['data-obp-slot'], 'right');
  assert.equal(P.dock.children.length, 3, 'nothing else lands in the bar');
  for (const b of [barL, barR]) assert.equal(b.children.length, 1, 'one button a side, never a row');
  const [btnL] = barL.children, [btnR] = barR.children;
  assert.equal(btnR.children[0].attrs['data-mark'], 'wizard', 'right: Chats in the dock\'s own mark (with its Ready count)');
  assert.ok(['mail', 'music'].includes(btnL.children[0].attrs['data-mark']), 'left: a running app other than Chats');
  // the app used last wins the left slot; the one in front never shows there
  P.state.home = false; P.state.desk = 2; P.state.app = 'music'; P.fire('route');
  P.state.desk = 1; P.state.app = 'mail'; P.state.running = [{ id: 'mail', open: true }, { id: 'music', open: false }, { id: 'wizard', open: false }]; P.fire('route');
  assert.equal(btnL.children[0].attrs['data-mark'], 'music', 'left = last used, other than the app in front');
  P.state.home = true; P.state.app = null; P.state.desk = 0; P.state.running = [{ id: 'mail', open: false }, { id: 'music', open: false }]; P.fire('route');
  assert.equal(btnL.children[0].attrs['data-mark'], 'mail', 'on Home: the app used last');
  assert.deepEqual(P.state.store.recent.slice(0, 2), ['mail', 'music'], 'kept per device');
  btnL.dispatchEvent({ type: 'click' }); assert.deepEqual(P.state.opened, ['mail'], 'left opens that app the stock way');
  btnR.dispatchEvent({ type: 'click' }); assert.equal(P.state.lists, 1, 'right opens the Chats list');
  // never more than three things: the two slot buttons and the orb
  assert.ok(visibleKids(barL).length + visibleKids(barR).length + 1 <= 3);
  // nothing else running: just the orb and Chats
  P.state.running = []; P.fire('route'); P.state.app = 'x'; P.fire('route');
  assert.equal(btnL.hidden, true, 'no other app: the left slot is empty, nothing shifts');
  // Desks: the slots go, the stock switcher comes back
  off(); assert.deepEqual(P.dock.children, [P.orbWrap]);
});

test('phone CSS: the stock desk switcher steps aside only in Orbs on the phone; slots in the thumb corners; Desks and desktop untouched', () => {
  const css = read('web/layouts/orb/phone.css');
  const S = 'html[data-shell="phone"][data-layout="orb"][data-orb-phone]';
  assert.ok(css.includes(`${S} #dock > :is(#dotsL, #dotsR) { display: none !important; }`));
  assert.ok(css.includes(`${S} #dock > .obp-slots.left { justify-content: flex-start; }`) && css.includes(`${S} #dock > .obp-slots.right { justify-content: flex-end; }`));
  assert.match(css, /#dock > \.obp-slots \{\n  flex: 1 1 0; min-width: 0;/, 'each side shrinks with the screen, so the bar never overflows');
  assert.ok(css.includes(`${S} .device.orb-corner #dock > .obp-slots { display: none !important; }`));
  // nobody else hides the stock switcher; the desktop layout never draws a bar
  for (const f of ['web/tweaks/miguel/orb-shell/tweak.css', 'web/tweaks/miguel/orb-switch/tweak.css', 'web/layouts/orb/layout.css']) assert.ok(!/dotsL|dotsR|obp-slots/.test(read(f)), f);
  assert.ok(!/obp-slots|phone\.mark|boltCv/.test(read('web/layouts/orb/layout.js')), 'the desktop path is untouched');
  // the shell draws the marks: the dock's own icon, behind a layout-only hook
  assert.match(read('web/app.js'), /phoneMark: id => \{ const a = id === CHATS_APP\.id \? \{ app: 'chats' \} : APP\[id\] \? \{ app: 'frame', appId: id \} : null; return a \? window\.WizCore\.workspaceNav\.icon\(/);
  assert.match(read('web/core/skin-host.js'), /mark: id => \{\n          const h = live\(\) && typeof id === 'string' && id \? shell\.phoneMark\?\.\(id\) : '';/);
});

test('phone, Orbs Home: a sideways drag on the sky spins the orbit (vertical stays the page\'s); a spun satellite does not open', async () => {
  const P = phoneWorld();
  P.state.running = [{ id: 'mail', open: false }, { id: 'music', open: false }];
  const { default: phone } = await import(new URL('web/layouts/orb/phone.js', root) + '?spin');
  phone(P.api);
  const spin = P.find('obp-spin')[0], sats = P.find('obp-sat');
  assert.ok(spin && spin.style.left === '24px' && spin.style.right === '24px', 'never on the system back-swipe edges');
  const before = sats.map(s => s.style.transform).join();
  const ev = (type, x, y, extra = {}) => ({ type, pointerId: 3, isPrimary: true, pointerType: 'touch', button: 0, clientX: x, clientY: y, timeStamp: 1000 + x, currentTarget: spin, preventDefault() {}, ...extra });
  // vertical: nothing moves, nobody claims the finger
  spin.dispatchEvent(ev('pointerdown', 200, 300)); spin.dispatchEvent(ev('pointermove', 202, 330)); spin.dispatchEvent(ev('pointerup', 202, 330));
  assert.equal(sats.map(s => s.style.transform).join(), before); assert.deepEqual(P.state.claimed, []);
  // sideways: the orbit turns under the finger
  spin.dispatchEvent(ev('pointerdown', 100, 300)); for (const x of [110, 140, 180]) spin.dispatchEvent(ev('pointermove', x, 300));
  assert.notEqual(sats.map(s => s.style.transform).join(), before, 'the satellites moved'); assert.deepEqual(P.state.claimed, [3], 'the finger is the spin\'s');
  spin.dispatchEvent(ev('pointerup', 180, 300));
  const field = P.find('obp-field')[0]; let stopped = false;
  field.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.ok(stopped, 'the click that ends a spin never opens a satellite');
  const ph = read('web/layouts/orb/phone.js');
  assert.match(ph, /if \(dt && !reduced\) \{ phase \+= \(\.035 \+ spinV\) \* dt; spinV \*= Math\.exp\(-dt \* 2\.4\);/, 'calm momentum with friction, none with reduced motion');
  assert.match(ph, /if \(!reduced && e\.type === 'pointerup' && idle < 90\) spinV = Math\.max\(-5, Math\.min\(5, drag\.v\)\);/);
  assert.match(read('web/layouts/orb/phone.css'), /\.obp-spin \{ position: absolute; z-index: 3; pointer-events: none; touch-action: pan-y; \}/, 'under the orb and satellites; vertical scroll stays native');
});

test('phone, Orbs: what opens is struck from the bar\'s orb with the desktop\'s bolt; Home and takes never', () => {
  const ph = read('web/layouts/orb/phone.js');
  assert.match(ph, /const key = r\.home \? '' : `\$\{r\.desk\}\|\$\{r\.app \|\| ''\}\|\$\{r\.thread \|\| ''\}`;/, 'an app, Chats or a thread opening');
  assert.match(ph, /if \(!key \|\| !cssReady \|\| modeOf\(voice\) !== 'idle'\) return;/);
  assert.match(ph, /strikeAt = performance\.now\(\) \+ \(fromHome \? FLY : 0\); strikeEnd = strikeAt \+ STRIKE;/, 'after the orb has landed in the dock');
  assert.match(ph, /bolt\(x1, y1, x2, y2, t, strike \* \(reduced \? 1 : \.82 \+ \.18 \* Math\.sin\(t \* 37\)\), seed \+ 23, palette\(look\.colourId\)\);/);
  assert.ok(!/Math\.random/.test(ph));
});

