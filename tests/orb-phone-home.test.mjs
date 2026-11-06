// Orbs view on the phone (Miguel, 31 Oct 2026; simplified 1 Nov 2026): the miguel/orb-shell tweak also wears the Orb
// layout on the phone, where it only changes Home. Guards:
//   - phone, Orbs, on Home: the desktop's orb scene (the same sky, the same Style × Colour, the same satellite list,
//     shared.js) with the orb FIXED in the middle (a take included: it never jumps to the dock and back), the
//     satellites plain still buttons on one ring clear of the orb, one big Chats pill with the Ready count; no
//     bottom bar, no spin, no bolts (Miguel found the three-slot bar version impossible to use);
//   - off Home the stock phone (its dock orb wears the same look);
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
  insertBefore(c, ref) { c.parentNode?.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); return c; }
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
  const state = { home, voice: { state: 'idle' }, running: [{ id: 'mail', open: false, playing: false }, { id: 'notes', open: false, playing: false }], badges: { notes: 3, wizard: 4 }, opened: [], lists: [], frames: 0, store: { style: 'plasma', colour: 'nebula' } };
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
    panel: { running: () => state.running }, sessions: { openList: k => state.lists.push(k) },
    phone: { home: () => homeSec, orb: () => orbWrap },
  };
  const fire = t => { for (const fn of on[t] || []) fn({ ...state.voice }); };
  return { html, device, homeSec, orbWrap, api, state, fire, find: cls => { const all = []; const walk = n => { for (const c of n.children) { if (String(c.className).split(' ').includes(cls)) all.push(c); walk(c); } }; walk(html); return all; } };
}

test('phone, Orbs, on Home: the orb fixed in the middle, still satellites to tap, one Chats pill; the stock phone elsewhere', async () => {
  const P = phoneWorld();
  const { default: phone } = await import(new URL('web/layouts/orb/phone.js', root));
  const off = phone(P.api);
  assert.equal(P.html.dataset.orbPhone, 'on', 'the stock dock drawing steps aside only while the scene is mounted');
  assert.equal(P.homeSec.children[0].className, 'obp-sky', 'the sky lives in the Home desk (it slides with the desks)');
  const layer = P.find('obp-layer')[0]; assert.ok(layer && layer.parentNode === P.device, 'the orb layer over the desks');
  assert.ok(P.orbWrap.children.some(c => c.className === 'obp-dockc'), 'the dock orb draws in the stock orb\'s own box');
  assert.equal(P.html.dataset.orbScene, 'home'); assert.equal(P.html.dataset.orbAt, 'centre', 'on Home the orb is in the middle');
  assert.ok(layer.classList.contains('is-home')); assert.equal(P.find('obp-orb')[0].dataset.show, 'on');
  // satellites: exactly the open apps (the shared list: one per desk; a count alone floats nothing)
  const sats = P.find('obp-sat').filter(b => b.attrs['data-app'] !== '+add');
  assert.deepEqual(sats.map(b => b.attrs['data-app']).sort(), ['mail', 'notes']);
  // the + is the ring's last place (Miguel, 2 Nov 2026: one +, at the end of the circle; no separate + by the pill)
  assert.equal(P.find('obp-sat').at(-1).attrs['data-app'], '+add'); assert.equal(P.find('obp-plus').length, 0);
  P.find('obp-sat').at(-1).dispatchEvent({ type: 'click' }); assert.equal(P.find('vc-sheet').length, 1, 'the + opens the app sheet');
  P.find('vc-x')[0].dispatchEvent({ type: 'click' });
  assert.equal(sats.find(b => b.attrs['data-app'] === 'mail').dataset.run, 'hidden', 'open on a desk: a quiet dot');
  // still, on one ring around the orb, clear of the sphere (its hit area is 60% of the canvas) by a whole target
  const O = parseFloat(layer.style['--obp-orb']), cy = parseFloat(layer.style['--obp-cy']);
  const at = b => b.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/).slice(1).map(Number);
  const before = sats.map(at);
  for (const [x, y] of before) assert.ok(Math.hypot(x - 195, y - cy) >= O * .3 + 24, 'a satellite never sits on the orb');
  assert.ok(before.every(([x]) => x - 24 >= 0 && x + 24 <= 390), 'inside the screen');
  P.fire('route'); P.fire('home'); assert.deepEqual(sats.map(at), before, 'they never move by themselves');
  sats.find(b => b.attrs['data-app'] === 'notes').dispatchEvent({ type: 'click' }); assert.deepEqual(P.state.opened, ['notes'], 'tap = open that app');
  // the Chats pill: Ready count, opens the stock Chats list
  const pill = P.find('obp-chats')[0]; assert.ok(pill, 'one Chats pill');
  assert.equal(pill.attrs['aria-label'], 'Chats, 4 ready'); assert.equal(P.find('obp-chats-n')[0].textContent, '4 ready');
  pill.dispatchEvent({ type: 'click' }); assert.deepEqual(P.state.lists, ['ready']);
  // a press on the centre orb is the dock orb's own gesture (same pointer, same place)
  const btn = P.find('obp-orbbtn')[0];
  btn.dispatchEvent({ type: 'pointerdown', pointerId: 7, isPrimary: true, clientX: 195, clientY: 420, button: 0, buttons: 1, preventDefault() {} });
  const handed = P.orbWrap.dispatched?.find(e => e.type === 'pointerdown');
  assert.ok(handed && handed.pointerId === 7 && handed.clientY === 420 && handed.isPrimary, 'handed to the dock orb with the same pointer');
  // a take started on Home stays in the middle (no jump to the dock and back)
  P.state.voice = { state: 'listen' }; P.fire('voice'); assert.equal(P.html.dataset.orbAt, 'centre');
  P.state.voice = { state: 'idle' }; P.fire('voice'); assert.equal(P.html.dataset.orbAt, 'centre');
  // a thread / an app / another desk: the stock phone (its dock orb in the same look)
  P.state.home = false; P.fire('route');
  assert.equal(P.html.dataset.orbAt, 'dock'); assert.equal(P.html.dataset.orbScene, 'desk'); assert.ok(!layer.classList.contains('is-home'));
  assert.equal(P.find('obp-dockc')[0].dataset.show, 'on'); assert.equal(P.find('obp-orb')[0].dataset.show, '');
  P.state.home = true; P.fire('route'); assert.equal(P.html.dataset.orbAt, 'centre');
  // Desks: everything it put anywhere goes, so the stock Home and the stock dock orb are exactly back
  off(); for (const n of [...P.find('obp-layer'), ...P.find('obp-sky')]) n.remove();   // api.mount nodes go with the layer (skin-host)
  assert.equal(P.find('obp-sky').length + P.find('obp-dockc').length, 0);
  assert.equal(P.html.dataset.orbPhone, undefined); assert.equal(P.html.dataset.orbAt, undefined); assert.equal(P.html.dataset.orbScene, undefined);
});

test('phone, Orbs: every open app floats (one satellite per desk; the ring widens to fit); past the screen\'s room a +N opens the sheet', async () => {
  for (const n of [14, 30]) {
    const P = phoneWorld();
    P.state.running = Array.from({ length: n }, (_, i) => ({ id: 'app' + i, open: false, playing: false }));
    const { default: phone } = await import(new URL('web/layouts/orb/phone.js', root));
    const off = phone(P.api);
    const layer = P.find('obp-layer')[0]; layer.clientWidth = 390; layer.clientHeight = 844;
    for (const fn of P.find('obp-chats')) fn.offsetTop = 734;
    P.fire('route'); P.fire('home');
    const sats = P.find('obp-sat'), ids = sats.map(b => b.attrs['data-app']);
    const at = b => b.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/).slice(1).map(Number);
    const pts = sats.map(at);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) assert.ok(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) >= 48, `satellites never overlap (${n} open)`);
    assert.ok(pts.every(([x]) => x - 24 >= 0 && x + 24 <= 390), 'inside the screen');
    assert.equal(ids.at(-1), '+add', 'the + always takes the last place');
    if (n === 14) assert.deepEqual(ids.slice(0, -1), P.state.running.map(r => r.id), 'all 14 open apps float');
    else {
      const more = sats.at(-1), shown = ids.length - 1;
      assert.equal(more.children.at(-1).textContent, '+' + (n - shown), 'too many for the ring: the + says how many more');
      more.dispatchEvent({ type: 'click' }); assert.ok(P.find('vc-sheet').length === 1, '+N opens the sheet (its Open level lists every one)');
    }
    off();
  }
});

test('phone: the same stored Style × Colour and drawing code as the desktop, never a second copy; no bar, spin or bolts', () => {
  const strip = f => read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const ph = strip('web/layouts/orb/phone.js'), lay = read('web/layouts/orb/layout.js');
  assert.match(ph, /import \{ renderer \} from '\.\/styles\.js';/); assert.match(ph, /import \{ lookOf, palettes, starsFor, paintSky, orbitApps, glyphOf, colourOf \} from '\.\/shared\.js';/);
  assert.match(ph, /const look = lookOf\(api\);/); assert.match(ph, /const every = orbitApps\(api, badgeMap\)/, 'the shared list: every open app, badged first');
  assert.ok(!/--ob-look-|createRadialGradient|16807/.test(ph), 'no colours or sky of its own');
  assert.match(lay, /if \(api\.env\.shell === 'phone'\) return phone\(api\);\n  if \(api\.env\.shell !== 'desktop'\) return \(\) => \{\};/, 'the desktop path is unchanged below the phone hand-off');
  // the rejected round stays gone: no bottom bar slots, no spin pad or drift, no bolt, no flight between centre and dock
  assert.ok(!/boltPainter|bolt\(|obp-spin|obp-slot|dotsL|dotsR|recent|phase|s\.a \+=|dockMatrix|FLY/.test(ph), 'no bar, spin, drift, bolt or flight');
  assert.ok(!/Math\.random/.test(ph));
  // the stock gestures stay on the dock orb
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
  // Home has no bottom bar (the stock dock steps aside there only), big targets: 48 px satellites, a 56 px Chats pill
  const raw = read('web/layouts/orb/phone.css');
  assert.match(raw, /\[data-orb-phone\]\[data-orb-scene="home"\] #dock \{ opacity: 0; pointer-events: none;/);
  assert.match(raw, /\.obp-sat \{\n  position: absolute; left: 0; top: 0; width: 48px; height: 48px;/);
  assert.match(raw, /\.obp-chats \{[^}]*height: 56px;[^}]*bottom: calc\(var\(--safe-b, 0px\) \+ 22px\)|\.obp-chats \{[^}]*bottom: calc\(var\(--safe-b, 0px\) \+ 22px\)[^}]*height: 56px;/);
  assert.ok(!/data-show="fly"|obp-slot|obp-spin/.test(raw));
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

test('Orbs: every satellite shows its name, always (Miguel, 2 Nov 2026); the ring spaces them for it', () => {
  const ph = read('web/layouts/orb/phone.js'), pcss = read('web/layouts/orb/phone.css'), js = read('web/layouts/orb/layout.js'), css = read('web/layouts/orb/layout.css');
  assert.match(ph, /el\('b', 'obp-sat-n', \{ 'aria-hidden': 'true', text: softName\(a\.name\) \}\)/);
  assert.match(ph, /const SAT = 48, GAP = SAT \+ 18;/);
  assert.match(pcss, /\.obp-sat-n \{/); assert.doesNotMatch(pcss.slice(pcss.indexOf('.obp-sat-n {')), /opacity: 0/, 'never hidden');
  assert.match(js, /const SP = 86;/);
  const n = /\.ob-sat-n \{([^}]*)\}/.exec(css)[1]; assert.match(n, /opacity: \.9/); assert.doesNotMatch(n, /opacity: 0/, 'shown without a hover');
});

test('phone Orb: press and hold a satellite = Open · Close (stays installed), the Apps view\'s own menu', () => {
  assert.match(read('web/layouts/orb/phone.js'), /chrome\.menuOn\(b, a, \{ onOpen: \(\) => api\.apps\.open\(a\.id\), onClosed: \(\) => api\.after\(60, paintApps\) \}\);/);
});
