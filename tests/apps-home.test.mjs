// Apps view (Miguel, 1 Nov 2026): a third view beside Desks and Orb, on the phone and (round 4) the desktop. Guards:
//   - the switch: Desks | Orb | Apps on both shells, mutually exclusive: a tap switches every view tweak to match, the
//     worn view does nothing, the lit option follows html[data-layout];
//   - Apps on the phone: Home is an app grid with ONE icon per desk (each desk is one app), in desk order, Chats first
//     with its Ready count, a + tile last; a tap opens that desk (Chats: the stock list); the stock Home widgets step
//     aside; no stock desk switcher on any screen; no Back button: a swipe up on the orb goes Home;
//   - the + sheet: the picker's apps minus Chats and every app already open; a pick opens it on a desk of its own;
//   - Apps on the desktop: a launchpad, one icon per desk, Chats first, +, the orb at the bottom centre (drag up = Home);
//   - Desks = the stock shell: the tweak off leaves no grid, no flag, no layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fixture } from './fixtures/tweaks.mjs';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const settle = () => new Promise(r => setTimeout(r, 15));

class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this.dataset = {}; this.attrs = {}; this.className = ''; this.hidden = false; this.listeners = {}; this.textContent = '';
    const st = {}; this.style = Object.assign(st, { setProperty(k, v) { st[k] = v; }, getPropertyValue: k => st[k] || '' });
    const self = this; this.classList = { add(c) { self.className = (self.className + ' ' + c).trim(); }, remove(c) { self.className = self.className.split(' ').filter(x => x !== c).join(' '); }, contains: c => self.className.split(' ').includes(c) }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...n) { for (const c of n) { if (typeof c === 'string') continue; c.parentNode?.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = this; this.children.push(c); } }
  insertBefore(c, ref) { c.parentNode?.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); return c; }
  focus() {}
  setPointerCapture() {}
  decode() { return Promise.resolve(); }
  get firstChild() { return this.children[0] || null; }
  replaceChildren(...n) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...n); }
  remove() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; } }
  querySelector() { return null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.tagName === 'HTML'; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener() {}
  dispatchEvent(e) { for (const fn of this.listeners[e.type] || []) fn(e); return true; }
}

function appsWorld({ shell = 'phone' } = {}) {
  const html = new El('html'), body = new El('body'), device = new El('div'), homeSec = new El('section'), dock = new El('div'), orbWrap = new El('div');
  html.append(body); body.append(device); device.append(homeSec, dock); dock.append(orbWrap); dock.id = 'dock';
  globalThis.document = { documentElement: html, body, createElement: t => new El(t) };
  const state = { desks: [{ desk: 1, id: 'mail', name: 'Mail' }, { desk: 2, id: 'wizard', name: 'Chats' }, { desk: 3, id: 'music', name: 'Music' }, { desk: 5, id: 'files', name: 'Files' }],
    badges: { wizard: 7, mail: 2 }, gone: [], lists: [], on: {}, home: true, openedDesk: [], backs: [], homes: 0, voice: [] };
  const mark = id => { const m = new El('span'); m.className = 'dsg'; m.style.setProperty('--c', '#7c5cff'); m.id = id; return m; };
  const apps = [{ id: 'mail', name: 'Mail' }, { id: 'music', name: 'Music' }, { id: 'files', name: 'Files', system: true }, { id: 'notes', name: 'Notes' }, { id: 'maps', name: 'Maps' },
    { id: 'wizard-claude', name: 'Claude', connector: true }, { id: 'agents', name: 'Agents', agent: true }, { id: 'mail-next', name: 'Mail next', dev: true }];
  const api = {
    env: { shell }, route: () => ({ home: state.home, desk: state.desk ?? 0 }), on: (t, fn) => { (state.on[t] ||= []).push(fn); return () => {}; },
    listen: (t, type, fn) => { t.addEventListener(type, fn); return () => {}; },
    mount: n => { device.append(n); return () => n.remove(); }, after: () => () => {},
    back: { push: fn => { state.backs.push(fn); return () => { state.backs.splice(state.backs.indexOf(fn), 1); }; } },
    apps: { list: () => apps.map(a => ({ ...a })), badges: watch => { state.watch = watch; return { ...state.badges }; }, logo: () => Promise.resolve(null), open: id => state.openedDesk.push('open:' + id), openDesk: id => state.openedDesk.push(id) },
    sessions: { openList: k => state.lists.push(k) }, nav: { goDesk: i => state.gone.push(i) },
    desks: { list: () => state.desks.map(d => ({ ...d })) },
    desk: { home: () => { state.homes++; } },
    voice: { state: () => ({ state: 'idle' }), talk: () => state.voice.push('talk'), command: () => { state.voice.push('command'); return 'voice'; } },
    orb: { ready: () => Promise.resolve(false), create: () => null, onLevel() {} },
    phone: { home: () => homeSec, desks: () => state.desks.map(d => ({ ...d })), mark, orb: () => orbWrap,
      swipes: m => { state.swipes = m; return () => { state.swipes = 'released'; }; } },
  };
  const find = cls => { const all = []; const walk = n => { for (const c of n.children) { if (String(c.className).split(' ').includes(cls)) all.push(c); walk(c); } }; walk(html); return all; };
  return { html, device, homeSec, dock, orbWrap, api, state, find, fire: t => { for (const fn of state.on[t] || []) fn(); } };
}

test('Apps on the phone: one icon per desk in desk order, Chats first with its Ready count; a tap opens that desk', async () => {
  const P = appsWorld();
  const { default: setup } = await import(new URL('web/layouts/apps/layout.js', root));
  const off = setup(P.api);
  assert.equal(P.html.dataset.appsHome, 'on');
  const grid = P.homeSec.children.find(c => c.className === 'ap-grid'); assert.ok(grid, 'the grid lives in the Home desk (it slides with Home)');
  const icons = () => grid.children.filter(b => !b.classList.contains('ap-plus')).map(b => [b.attrs['data-app'], b.attrs['data-desk'] ?? null]);
  assert.deepEqual(icons(), [['wizard', null], ['mail', '1'], ['music', '3'], ['files', '5']], 'Chats first, then one icon per desk (the Chats desk is the Chats icon)');
  assert.ok(grid.children.at(-1).classList.contains('ap-plus'), 'the grid ends with a + tile');
  const [chats, mail] = grid.children;
  assert.equal(chats.attrs['aria-label'], 'Chats, 7 unread'); assert.equal(chats.children[1].textContent, '7'); assert.equal(chats.children[1].hidden, false);
  assert.equal(mail.attrs['aria-label'], 'Mail, 2 new'); assert.equal(grid.children[2].children[1].hidden, true, 'no count, no badge');
  assert.equal(mail.children[2].textContent, 'Mail', 'the label under the icon');
  assert.equal(mail.style['--c'], '#7c5cff', 'the app\'s own colour from the dock\'s mark');
  mail.dispatchEvent({ type: 'click' }); assert.deepEqual(P.state.gone, [1], 'tap = that desk');
  chats.dispatchEvent({ type: 'click' }); assert.deepEqual(P.state.lists, ['ready'], 'Chats = the stock Chats list');
  // a new desk (an app opened) or a closed one: the grid follows; counts follow live
  P.state.desks.push({ desk: 6, id: 'notes', name: 'Notes' }); P.fire('route');
  assert.deepEqual(icons().map(i => i[0]), ['wizard', 'mail', 'music', 'files', 'notes']);
  P.state.watch({ wizard: 2 }); assert.equal(grid.children[0].attrs['aria-label'], 'Chats, 2 unread'); assert.equal(grid.children[1].children[1].hidden, true);
  off();
  assert.ok(!P.homeSec.children.some(c => c.className === 'ap-grid'), 'Desks: no grid left'); assert.equal(P.html.dataset.appsHome, undefined);
  assert.equal(P.html.dataset.viewChrome, undefined, 'the dock switcher is back (chrome.css only matches while worn)'); assert.equal(P.find('vc-back').length, 0, 'no Back left');
});

test('Apps on the desktop: a launchpad, one icon per desk (Chats first, + last), no Back, the orb at the bottom on every screen (drag up = Home)', async () => {
  const P = appsWorld({ shell: 'desktop' });
  P.state.desks = [{ desk: 0, id: 'mail', name: 'Mail' }, { desk: 1, id: 'wizard', name: 'Chats' }, { desk: 2, id: 'music', name: 'Music' }];
  const { default: setup } = await import(new URL('web/layouts/apps/layout.js', root));
  const off = setup(P.api);
  const grid = P.find('apd-grid')[0]; assert.ok(grid && P.find('apd')[0].parentNode === P.device, 'mounted on the stage');
  const ids = () => grid.children.map(b => b.attrs['data-app'] ?? '+');
  assert.deepEqual(ids(), ['wizard', 'mail', 'music', '+add'], 'Chats first, one icon per desk, + last');
  assert.equal(grid.children[0].attrs['data-desk'], '1', 'Chats is the Chats desk');
  assert.equal(grid.children[0].attrs['aria-label'], 'Chats, 7 unread'); assert.equal(grid.children[1].attrs['aria-label'], 'Mail, 2 new');
  assert.equal(P.html.dataset.appsDesk, 'home'); assert.equal(P.html.dataset.viewChrome, 'desktop');
  assert.equal(P.find('vc-back').length, 0, 'no Back button');
  assert.ok(P.find('apd-orbbtn')[0], 'the orb is there on Home');
  assert.equal(P.state.swipes, undefined, 'the desktop orb is the layout\'s own: no dock swipe map');
  grid.children[2].dispatchEvent({ type: 'click' }); assert.deepEqual(P.state.gone, [2], 'an icon opens its desk');
  // away from Home: the grid steps aside, the orb stays (still no Back)
  P.state.home = false; P.state.desk = 2; P.fire('route');
  assert.equal(P.html.dataset.appsDesk, 'desk'); assert.equal(P.find('apd-home')[0].hidden, true); assert.equal(P.find('vc-back').length, 0);
  assert.ok(P.find('apd-orbbtn')[0].parentNode, 'the orb floats on every screen');
  // the orb: a click talks; a sideways drag does nothing (no desk steps); a drag up = Home (the grid)
  const ob = P.find('apd-orbbtn')[0], gone = P.state.gone.length;
  ob.dispatchEvent({ type: 'pointerdown', button: 0, clientX: 600, clientY: 700, pointerId: 1 }); ob.dispatchEvent({ type: 'pointerup' });
  assert.deepEqual(P.state.voice, ['talk']);
  for (const [dx, dy] of [[-70, 0], [70, 0], [0, 60]]) {
    ob.dispatchEvent({ type: 'pointerdown', button: 0, clientX: 600, clientY: 700, pointerId: 1 }); ob.dispatchEvent({ type: 'pointermove', clientX: 600 + dx, clientY: 700 + dy }); ob.dispatchEvent({ type: 'pointerup' });
  }
  assert.equal(P.state.gone.length, gone, 'sideways / down: no desk step'); assert.equal(P.state.homes, 0, 'and not Home'); assert.deepEqual(P.state.voice, ['talk'], 'a drag never talks');
  ob.dispatchEvent({ type: 'pointerdown', button: 0, clientX: 600, clientY: 700, pointerId: 1 }); ob.dispatchEvent({ type: 'pointermove', clientX: 610, clientY: 630 }); ob.dispatchEvent({ type: 'pointerup' });
  assert.equal(P.state.homes, 1, 'drag up = Home (the grid)'); assert.deepEqual(P.state.voice, ['talk']);
  P.state.home = true; P.fire('route');
  ob.dispatchEvent({ type: 'pointerdown', button: 0, clientX: 600, clientY: 700, pointerId: 1 }); ob.dispatchEvent({ type: 'pointermove', clientX: 600, clientY: 620 }); ob.dispatchEvent({ type: 'pointerup' });
  assert.equal(P.state.homes, 1, 'on Home a drag up does nothing more (⌥` would toggle away; this never does)');
  // the + sheet on the desktop: every app not open yet, a pick opens it on a desk of its own
  P.state.home = true; P.fire('route');
  grid.children.at(-1).dispatchEvent({ type: 'click' });
  const sheet = P.find('vc-sheet')[0]; assert.ok(sheet, 'the sheet opens');
  assert.deepEqual(P.find('vc-app').map(b => b.attrs['data-app']), ['files', 'notes', 'maps']);
  P.find('vc-app')[1].dispatchEvent({ type: 'click' }); assert.deepEqual(P.state.openedDesk, ['notes']); assert.equal(P.find('vc-sheet').length, 0, 'and closes');
  off(); for (const n of P.find('apd')) n.remove();
  assert.equal(P.html.dataset.appsDesk, undefined); assert.equal(P.html.dataset.viewChrome, undefined);
});

test('the + sheet lists the stock picker\'s apps minus Chats and every app already open; Back / Esc / the backdrop close it', async () => {
  const { notOpen } = await import(new URL('web/layouts/apps/chrome.js', root));
  const list = [{ id: 'wizard', name: 'Chats' }, { id: 'mail', name: 'Mail' }, { id: 'files', name: 'Files', system: true }, { id: 'x', name: 'X', connector: true }, { id: 'a', name: 'A', agent: true }, { id: 'n', name: 'N', dev: true }, { id: 'music', name: 'Music' }];
  assert.deepEqual(notOpen(list, ['mail', 'wizard']).map(a => a.id), ['files', 'music'], 'system apps stay (the picker shows them); connectors, agents, test copies and open apps go');
  const P = appsWorld();
  const { default: setup } = await import(new URL('web/layouts/apps/layout.js', root));
  const off = setup(P.api);
  const plus = P.find('ap-plus')[0]; plus.dispatchEvent({ type: 'click' });
  assert.deepEqual(P.find('vc-app').map(b => b.attrs['data-app']), ['notes', 'maps'], 'Mail, Music and Files are open on desks already');
  assert.equal(P.state.backs.length, 1, 'the open sheet joins the Back order'); P.state.backs[0](); assert.equal(P.find('vc-sheet').length, 0);
  plus.dispatchEvent({ type: 'click' }); P.find('vc-scrim')[0].dispatchEvent({ type: 'click' }); assert.equal(P.find('vc-sheet').length, 0, 'the backdrop closes it');
  plus.dispatchEvent({ type: 'click' }); P.find('vc-app')[0].dispatchEvent({ type: 'click' });
  assert.deepEqual(P.state.openedDesk, ['notes'], 'a pick opens it on a desk of its own'); assert.equal(P.state.backs.length, 0);
  // the new desk shows up as its own icon
  P.state.desks.push({ desk: 6, id: 'notes', name: 'Notes' }); P.fire('route');
  assert.ok(P.find('ap-icon').some(b => b.attrs['data-app'] === 'notes'));
  plus.dispatchEvent({ type: 'click' }); assert.deepEqual(P.find('vc-app').map(b => b.attrs['data-app']), ['maps']);
  off();
});

test('the + sheet is three levels in one flow: Open (✕ closes it), Installed (tap opens it), Get more (the App Store; tap = its Store page); one search filters all three', async () => {
  const { openApps, matches, FLOAT_INSET } = await import(new URL('web/layouts/apps/chrome.js', root));
  assert.deepEqual(openApps([{ id: 'mail', name: 'Mail' }], [{ id: 'wizard', name: 'Chats' }, { id: 'mail', name: 'x' }, { id: 'pr', name: 'PR board' }, { id: 'mail', name: 'x' }]).map(a => a.name), ['Mail', 'PR board'], 'one per open app, desk order, never Chats');
  assert.ok(matches({ name: 'Movies' }, 'mov') && matches({ name: 'X', summary: 'watch queue' }, 'queue') && !matches({ name: 'Mail' }, 'zz') && matches({ name: 'Mail' }, ''));
  assert.ok(FLOAT_INSET.phone >= 90 && FLOAT_INSET.desktop >= 76, 'room under the last item clears the floating orb');
  const P = appsWorld();
  const closed = [], got = [], insets = [];
  let storeDone; const storeP = new Promise(r => { storeDone = r; });
  Object.assign(P.api.apps, { close: id => { closed.push(id); P.state.desks = P.state.desks.filter(d => d.id !== id); return true; }, store: () => storeP, get: id => { got.push(id); return true; }, inset: px => { insets.push(px); return () => insets.push('off'); } });
  P.api.after = (ms, fn) => { fn(); return () => {}; };
  const { default: setup } = await import(new URL('web/layouts/apps/layout.js', root));
  const off = setup(P.api);
  assert.deepEqual(insets, [96], 'the view asks the shell for room under hosted apps\' last item');
  P.find('ap-plus')[0].dispatchEvent({ type: 'click' });
  const heads = () => P.find('vc-sec-h').map(h => h.children[0].textContent);
  assert.deepEqual(heads(), ['Open', 'Installed', 'Get more'], 'the three levels, in order');
  assert.deepEqual(P.find('vc-open').map(b => b.attrs['data-open']), ['mail', 'music', 'files'], 'level 1: every app with a desk (= the icons)');
  assert.deepEqual(P.find('vc-app').map(b => b.attrs['data-app']), ['notes', 'maps'], 'level 2: installed, not open');
  assert.ok(P.find('vc-empty').some(e => /App Store/.test(e.textContent)), 'level 3 loads from the App Store');
  storeDone([{ id: 'movies', name: 'Movies', summary: 'Your watch queue' }, { id: 'health', name: 'Health', summary: '' }]); await settle();
  assert.deepEqual(P.find('vc-get').map(b => b.attrs['data-store']), ['movies', 'health'], 'level 3: in the App Store, not installed');
  // ✕ on an open app closes it: its desk goes and it is back under Installed
  P.find('vc-close')[0].dispatchEvent({ type: 'click' });
  assert.deepEqual(closed, ['mail']);
  assert.deepEqual(P.find('vc-open').map(b => b.attrs['data-open']), ['music', 'files']);
  assert.deepEqual(P.find('vc-app').map(b => b.attrs['data-app']), ['mail', 'notes', 'maps'], 'a closed app goes back to Installed');
  // one search filters all three
  const q = P.find('vc-q')[0]; q.value = 'mo'; q.dispatchEvent({ type: 'input' });
  assert.deepEqual([P.find('vc-open').length, P.find('vc-app').length, P.find('vc-get').map(b => b.attrs['data-store'])], [0, 0, ['movies']]);
  // a Store app opens its own Store page (its Get), and the sheet closes
  P.find('vc-get')[0].dispatchEvent({ type: 'click' });
  assert.deepEqual(got, ['movies']); assert.equal(P.find('vc-sheet').length, 0);
  // the open tile goes to that app's desk
  P.find('ap-plus')[0].dispatchEvent({ type: 'click' }); P.find('vc-hit')[0].dispatchEvent({ type: 'click' });
  assert.deepEqual(P.state.openedDesk, ['music']);
  off(); assert.deepEqual(insets, [96, 'off'], 'Desks: no room asked any more');
});

test('phone, Apps and Orb: no stock desk switcher on any screen, the dock orb stays where it is; no Back: the orb swipes up = Home', async () => {
  const P = appsWorld();
  const { default: setup } = await import(new URL('web/layouts/apps/layout.js', root));
  const off = setup(P.api);
  assert.equal(P.find('vc-back').length, 0, 'no Back button on Home');
  P.state.home = false; P.fire('route'); assert.equal(P.find('vc-back').length, 0, 'nor on an opened app / thread / Chats');
  assert.deepEqual({ ...P.state.swipes }, { up: 'home', side: null, down: null }, 'the dock orb: up = Home, sideways and down nothing');
  assert.equal(P.dock.children.length, 1, 'only the orb in the dock row');
  off(); assert.equal(P.state.swipes, 'released', 'Desks: the stock swipes are back');
  const css = read('web/layouts/apps/chrome.css').replace(/\/\*[\s\S]*?\*\//g, '');
  // the switcher goes on every screen (never gated on Home), only while a view wears the chrome
  assert.match(css, /html\[data-view-chrome="phone"\] #dock > :is\(#dotsL, #dotsR, \.scrub\) \{ display: none !important; \}/);
  assert.ok(!/data-orb-scene|home-desk/.test(css), 'not just on Home');
  assert.ok(!/vc-back/.test(css + read('web/layouts/apps/layout.css')), 'no Back button styles left');
  for (const sel of [...css.matchAll(/([^{}@]+)\{[^{}]*\}/g)].map(m => m[1].trim()).filter(x => !/^(from|to)$/.test(x))) for (const part of sel.split(/,(?![^(]*\))/)) assert.ok(part.trim().startsWith('html[data-view-chrome'), `chrome.css reaches Desks: ${part.trim()}`);
  // the Orb view wears the same chrome (+ beside the Chats pill, the same swipes), and no Back either
  const ph = read('web/layouts/orb/phone.js');
  assert.match(ph, /import \{ viewChrome \} from '\.\.\/apps\/chrome\.js';/);
  assert.match(ph, /const plus = chrome\.plus\('ob-sat obp-sat obp-add', 'Add an app'/);
  assert.ok(!/chrome\.back|paintBack|vc-back/.test(ph + read('web/layouts/apps/chrome.js') + read('web/layouts/apps/desktop.js') + read('web/layouts/apps/layout.js')), 'no Back anywhere');
  assert.ok(!/fly|FLY|animate\(/.test(ph), 'the orb never flies between the centre and the dock');
});

test('Desks unchanged: the desktop and phone stock paths never meet Apps CSS unless worn; Apps wears on the desktop too', async () => {
  const css = read('web/layouts/apps/layout.css').replace(/@import[^;]+;/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const sel of [...css.matchAll(/([^{}@]+)\{[^{}]*\}/g)].map(m => m[1].trim()).filter(x => !/^(from|to)$/.test(x))) for (const part of sel.split(/,(?![^(]*\))/))
    assert.ok(/^html\[data-shell="(phone|desktop)"\]\[data-layout="apps"\]/.test(part.trim()), `unscoped: ${part.trim()}`);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css + read('web/layouts/apps/chrome.css')), 'colours are tokens');
  for (const f of ['layout.js', 'desktop.js', 'chrome.js']) { const js = read('web/layouts/apps/' + f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''); assert.ok(!/Math\.random|innerHTML|localStorage|setTimeout|setInterval/.test(js), f); }
  const f = fixture({ shell: 'desktop' });
  await f.mount('miguel/apps-home'); await settle();
  assert.equal(f.host.layout, 'apps', 'the desktop wears Apps too'); assert.ok(f.doc.head.children.some(l => /layouts\/apps\/layout\.css/.test(l.href || '')));
  await f.clear(); assert.equal(f.host.layout, 'classic'); assert.ok(!f.doc.head.children.some(l => /layouts\//.test(l.href || '')));
  // desktop adapter: one entry per desk (empty desks left out; a Chats desk is 'wizard'); + opens on a desk of its own
  const dj = read('web/desktop/desktop.js');
  const fn = dj.match(/deskApps: (\(\) => ws\.map[^\n]*),\n/)[1];
  const run = vm.runInNewContext(`(${fn})`, { ws: [{ wins: ['a'], focus: 'a' }, { wins: [] }, { wins: ['c', 'd'], focus: 'd' }, { wins: ['e'], focus: 'e' }],
    W: { a: { app: 'frame', appId: 'mail' }, c: { app: 'frame', appId: 'notes' }, d: { app: 'chats' }, e: { app: 'frame', appId: 'music' } },
    appOf: w => w.app === 'chats' ? { id: 'wizard', name: 'Wizard' } : { id: w.appId, name: w.appId[0].toUpperCase() + w.appId.slice(1) }, winTitle: () => '' });
  assert.deepEqual(JSON.parse(JSON.stringify(run())), [{ desk: 0, id: 'mail', name: 'Mail' }, { desk: 2, id: 'wizard', name: 'Chats' }, { desk: 3, id: 'music', name: 'Music' }]);
  const openSrc = dj.slice(dj.indexOf('openAppDesk: ') + 'openAppDesk: '.length, dj.indexOf('    // A layout placing the shell', dj.indexOf('openAppDesk: '))).trim().replace(/,$/, '');
  const ws = [{ wins: ['mail'], focus: 'mail' }], calls = [];
  const open = vm.runInNewContext(`(${openSrc})`, { ws, cur: 0, W: { mail: { appId: 'mail' } }, APP: { mail: { id: 'mail' }, store: { id: 'store' } }, freshDesk: () => ({ wins: [] }), goWs: desk => calls.push(['go', desk]), openApp: (app, opts) => { calls.push(['open', app.id, opts?.ws]); return true; } });
  assert.equal(open('mail'), true); assert.deepEqual(calls.pop(), ['go', 0], 'reuse existing app desk');
  assert.equal(open('store'), true); assert.deepEqual(calls.pop(), ['open', 'store', 1], 'normal opens still get their own desk');
  assert.equal(open('store', desk => { calls.push(['trusted', desk]); return true; }), true);
  assert.deepEqual(calls.pop(), ['trusted', 2], 'a routed, already-checked open keeps its original continuation');
  ws[0].wins = [];
  assert.equal(open('store'), true); assert.deepEqual(calls.pop(), ['open', 'store', undefined], 'empty current desk remains the stock target');
  assert.equal(open('unknown'), false);
  const host = read('web/core/skin-host.js');
  assert.match(host, /openDesk: \(id, place = null\) => live\(\) && typeof id === 'string' && id \? !!\(shell\.openAppDesk \? shell\.openAppDesk\(id, typeof place === 'function' \? place : null\) : shell\.openApp\?\.\(id\)\) : false,/);
  assert.match(host, /list: \(\) => \{ const l = live\(\) \? \(shell\.deskApps \|\| shell\.phoneDesks\)\?\.\(\) : null;/);
});

test('Desks = the stock phone: Apps off releases the layout and its CSS; Apps on the phone wears it', async () => {
  const f = fixture({ shell: 'phone' });
  await f.mount('miguel/apps-home'); await settle();
  assert.equal(f.host.layout, 'apps'); assert.equal(f.doc.documentElement.dataset.layout, 'apps');
  assert.ok(f.doc.head.children.some(l => /layouts\/apps\/layout\.css/.test(l.href || '')));
  await f.clear();
  assert.equal(f.host.layout, 'classic'); assert.equal(f.doc.documentElement.dataset.layout, undefined);
  assert.ok(!f.doc.head.children.some(l => /layouts\//.test(l.href || '')));
  const tw = read('web/tweaks/miguel/apps-home/tweak.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const sel of [...tw.matchAll(/([^{}@]+)\{[^{}]*\}/g)].map(m => m[1].trim())) for (const part of sel.split(/,(?![^(]*\))/)) assert.ok(/^html\[data-layout="apps"\]|^html\[data-shell="(phone|desktop)"\]\[data-layout="apps"\]/.test(part.trim()), `apps-home tweak.css reaches past the Apps view: ${part.trim()}`);
});

test('Apps view: listed under Miguel, never a default, a mutually exclusive shell view (manifest view: Apps)', async () => {
  assert.equal(JSON.parse(read('web/tweaks/miguel/apps-home/manifest.json')).view, 'Apps');
  // catalog: listed under Miguel, never a default; not turned on by any migration
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(cat.tweaks.includes('miguel/apps-home') && !cat.defaults.includes('miguel/apps-home'));
  assert.ok(!/apps-home/.test(read('web/core/experience.js')));
});

test('the phone adapter lists one entry per desk (Home and empty desks left out) and the layout API hands it out', () => {
  const app = read('web/app.js'), host = read('web/core/skin-host.js');
  const fn = app.match(/phoneDesks: (\(\) => desks\.map[^\n]*),\n/)[1];
  const run = vm.runInNewContext(`(${fn})`, { desks: [{ home: true, wins: [] }, { wins: ['a'], focus: 'a' }, { wins: [] }, { wins: ['c'], focus: 'c' }],
    W: { a: { appId: 'mail' }, c: { app: 'chats' } }, winApp: w => w.app === 'chats' ? { id: 'wizard', name: 'Chats' } : { id: w.appId, name: 'Mail' } });
  assert.deepEqual(JSON.parse(JSON.stringify(run())), [{ desk: 1, id: 'mail', name: 'Mail' }, { desk: 3, id: 'wizard', name: 'Chats' }]);
  assert.match(host, /desks: \(\) => \{ const l = live\(\) \? shell\.phoneDesks\?\.\(\) : null;/);
  assert.match(host, /Object\.freeze\(\{ id: 'apps', name: 'Apps',/);
  assert.match(host, /const VIEW_LAYOUTS = new Set\(\['orb', 'apps', 'ai-apps'\]\);/);
  assert.match(host, /if \(VIEW_LAYOUTS\.has\(layoutId\) && standardLayout !== layoutId && !\(layoutHolder && tweaks\.has\(layoutHolder\)\)\) setLayout\('classic'\);/, 'only an unowned stale Apps layout goes back to Desks');
  assert.ok(!/Math\.random/.test(read('web/layouts/apps/layout.js')));
});

test('three levels on both shells: close an app (its desk goes), an App Store page on its own desk (Get there), the app opens in the Store\'s place once installed; full-screen room for hosted apps', () => {
  const app = read('web/app.js'), desk = read('web/desktop/desktop.js'), host = read('web/core/skin-host.js'), store = read('web/store/store.js'), status = read('web/store/store-status.js');
  for (const [name, src] of [['phone', app], ['desktop', desk]]) {
    assert.match(src, /closeApp: id => \{/, `${name}: closeApp adapter`);
    assert.match(src, /openStore: id => \{ const S = APP\['app-store'\]; if \(!S\?\.url\) return false;/, `${name}: openStore opens the Store app itself (never a second store)`);
    assert.match(src, /u\.searchParams\.set\('app', id\); u\.searchParams\.set\('open', '1'\);/, `${name}: the Store page of that app, open once installed`);
    assert.match(src, /d\.replace === true && w\.appId === 'app-store'\) closeWin\(host\.dataset\.win/, `${name}: only the Store's own frame may hand its place to the new app`);
  }
  assert.match(store, /get\('open'\) === '1' && openId\(a\)\) parent\.postMessage\(\{ type: 'wizard:open-app', id: openId\(a\), replace: true \}, location\.origin\);/, 'the Store opens it right after a successful Get (no needs sheet)');
  assert.match(status, /export const hostAppId = a => HOST_ALIASES\[a\?\.id\]\?\.id \|\| a\?\.id \|\| '';/);
  assert.match(host, /x\.type === 'view' && isUserApp\(x\)/, 'Get more lists the Store\'s Apps only');
  assert.match(host, /store-data\/wizard\/v1\/index\/search\?limit=100/, 'the Store\'s own listing route');
  assert.match(host, /new d\.defaultView\.CSSStyleSheet\(\)/, 'room under the last item via CSSOM (passes an app\'s style-src)');
  assert.match(host, /insetSheets\.get\(d\)/, 'one sheet per document, not per window (a frame\'s window outlives its blank first document)');
  const chrome = read('web/layouts/apps/chrome.css'), lay = read('web/layouts/apps/layout.css');
  assert.match(chrome, /\.tiles\[data-n="1"\]:not\(\.has-full\):has\(> \.win\.solo\.app-frame\) \{ top: 0; left: 0; right: 0; bottom: 0; \}/, 'phone: an app alone on its desk is edge to edge');
  assert.match(chrome, /> \.win\.solo\.app-frame:not\(\.wos-inset-bar\)::after \{/, 'phone: the fade, except over an app\'s own bottom bar');
  assert.match(lay, /#stage > \.wsp \{ bottom: 76px; \}/, 'desktop Apps: Chats and tiled windows still end above the orb');
  assert.match(lay, /:has\(> \.win:not\(\.gone\) iframe\[data-own-app\]\):not\(:has\(> \.win:not\(\.gone\) ~ \.win:not\(\.gone\)\)\) \{ inset: -8px; \}/, 'desktop Apps: an app alone on its desk is full screen');
});

test('the sheet by kind (Miguel, 2 Nov 2026): Already open and For agents fold to one row each; Apps (with apps made on this Wizard) open; no App Store list unless searching', async () => {
  const P = appsWorld(), opened = [], got = [];
  P.api.after = (ms, fn) => { fn(); return () => {}; };
  const K = { apps: [{ id: 'files', name: 'Files', icon: '', system: true }, { id: 'mail', name: 'Mail', icon: '' }, { id: 'notes', name: 'Notes', icon: '' }],
    wiz: [{ id: 'transcriber', name: 'Transcriber', icon: '', system: true }], agents: [{ id: 'carlos', name: 'Carlos', icon: '' }, { id: 'agents', name: 'Build agents', icon: '' }],
    conns: [{ id: 'wizard-claude', name: 'Claude', icon: '', system: true }, { id: 'music', name: 'Music', icon: '' }], dev: [{ id: 'pr-board', name: 'PR board', icon: '' }] };
  Object.assign(P.api.apps, { kinds: () => structuredClone(K), openAny: id => { opened.push(id); return true; }, get: id => { got.push(id); return true; },
    store: () => Promise.resolve([{ id: 'movies', name: 'Movies', summary: 'Your watch queue' }, { id: 'old-notes', name: 'notes', summary: 'Notes under another Store id' }]) });
  const { default: setup } = await import(new URL('web/layouts/apps/layout.js', root));
  const off = setup(P.api);
  P.find('ap-plus')[0].dispatchEvent({ type: 'click' }); await settle();
  const heads = () => P.find('vc-sec-h').map(h => h.children[0].textContent), folds = () => P.find('vc-fold').map(h => h.children[0].textContent);
  assert.deepEqual(folds(), ['Already open', 'For agents'], 'two folded rows'); assert.deepEqual(heads(), ['Apps'], 'only Apps is open');
  assert.deepEqual(P.find('vc-app').map(b => b.attrs['data-app']), ['notes', 'pr-board'], 'an app made on this Wizard is just an app; open apps (mail, music, files) and Chats left out');
  assert.equal(P.find('vc-fold')[1].children[1].textContent, '4', 'For agents counts what it holds');
  assert.equal(P.find('vc-get').length, 0, 'no App Store list'); assert.equal(P.find('vc-store').length, 1, 'one row opens the App Store');
  P.find('vc-fold')[1].dispatchEvent({ type: 'click' });
  assert.deepEqual(heads(), ['Apps', 'Agent apps', 'Agents', 'Connectors']);
  assert.deepEqual(P.find('vc-app').map(b => b.attrs['data-app']), ['notes', 'pr-board', 'transcriber', 'carlos', 'agents', 'wizard-claude']);
  P.find('vc-fold')[1].dispatchEvent({ type: 'click' }); assert.deepEqual(heads(), ['Apps']);
  P.find('vc-fold')[0].dispatchEvent({ type: 'click' });
  assert.deepEqual(P.find('vc-open').map(b => b.attrs['data-open']), ['mail', 'music', 'files'], 'unfolded: each open app with its ✕');
  P.find('vc-fold')[0].dispatchEvent({ type: 'click' }); assert.equal(P.find('vc-open').length, 0);
  const q = P.find('vc-q')[0]; q.value = 'mu'; q.dispatchEvent({ type: 'input' });
  assert.deepEqual(P.find('vc-open').map(b => b.attrs['data-open']), ['music'], 'a search shows its open matches');
  q.value = 'mov'; q.dispatchEvent({ type: 'input' });
  assert.deepEqual(P.find('vc-get').map(b => b.attrs['data-store']), ['movies'], 'a search also looks in the App Store'); assert.ok(heads().includes('In the App Store'));
  q.value = 'not'; q.dispatchEvent({ type: 'input' });
  assert.equal(P.find('vc-get').length, 0, 'an app you already have, listed under another Store id, is not offered again');
  q.value = 'trans'; q.dispatchEvent({ type: 'input' });
  assert.deepEqual(heads(), ['Agent apps'], 'a search opens For agents to its matches');
  P.find('vc-app')[0].dispatchEvent({ type: 'click' });
  assert.deepEqual(opened, ['transcriber'], 'an agent app opens through openAny (its settings sheet)'); assert.equal(P.find('vc-sheet').length, 0);
  off();
});

test('apps.kinds / openAny: the launcher kinds for layouts, shared by both shells', () => {
  const ak = read('web/core/app-kinds.js'), host = read('web/core/skin-host.js'), app = read('web/app.js'), desk = read('web/desktop/desktop.js');
  assert.match(ak, /const agents = K\.agents\.filter\(a => a\.id !== 'wizard'\)\.map\(row\);/, 'the main agent is Chats, never a tile');
  assert.match(ak, /window\.WosAppRoute\?\.open\(a\.id, \{ name: a\.name \}\); return true;/, 'an agent app without a screen shows its settings');
  for (const s of [app, desk]) assert.match(s, /appKinds: \(\) => window\.WosAppKinds\?\.rows \? window\.WosAppKinds\.rows\(APPS, APP, a => ico\('span', 'ic', a\)\) : null,/);
  assert.match(app, /openAnyApp: \(id, open\) => !!window\.WosAppKinds\?\.openRow\?\.\(APPS, APP, id, open\),/);
  assert.match(desk, /openAnyApp: \(id, open\) => !!window\.WosAppKinds\?\.openRow\?\.\(APPS, APP, id, globalThis\.WosSkinHost\?\.panelMode \? x => openApp\(APP\[x\]\) !== false : open\),/, 'the Orb opens it in its panel, never a fresh empty desk');
  assert.match(host, /kinds: \(\) => \{ const k = live\(\) \? shell\.appKinds\?\.\(\) : null; return k \? structuredClone\(k\) : null; \},/);
  assert.match(host, /openAny: id => live\(\) && typeof id === 'string' && \/\^\[a-z0-9\]\[a-z0-9-\]\{0,63\}\$\/\.test\(id\) && shell\.openAnyApp/);
});

test('Apps view grid (both shells): Chats first, badged apps next, the rest in desk order, + last labelled Add; a new app grows in', () => {
  for (const f of ['web/layouts/apps/desktop.js', 'web/layouts/apps/layout.js']) {
    const js = read(f);
    assert.match(js, /const litFirst = out => \[out\[0\], \.\.\.out\.slice\(1\)\.filter\(i => \(badgeMap\[i\.id\] \|\| 0\) > 0\), \.\.\.out\.slice\(1\)\.filter\(i => !\(\(badgeMap\[i\.id\] \|\| 0\) > 0\)\)\];/, f);
    assert.match(js, /return litFirst\(out\);/, f);
    assert.match(js, /let badgeMap = api\.apps\.badges\(m => \{ badgeMap = m; paint\(\); \}\);/, f + ': a badge reorders');
    assert.match(js, /bornIf\(!first, icon\(i/, f + ': only after the first paint');
    assert.match(js, /text: 'Add' \}\)\); \}\);/, f);
  }
  assert.match(read('web/layouts/apps/chrome.css'), /html\[data-view-chrome\] \.vc-born \{ animation: vc-born/);
});

test('Apps view icons: right-click (desktop) / long press (phone) = Open · Close · stays installed; Chats never closes', () => {
  const c = read('web/layouts/apps/chrome.js');
  assert.match(c, /item\('Open', \(\) => onOpen\?\.\(\)\), \.\.\.\(running === false \? \[\] : \[item\('Close · stays installed', \(\) => \{ api\.apps\.close\?\.\(a\.id\); onClosed\?\.\(\); \}, ' is-close'\)\]\)/, 'Open · Close (AI apps round 16: extra items first, no Close for an app not running; both opt-in)');
  assert.match(c, /if \(!b \|\| !a \|\| a\.id === CHATS\) return;/, 'no menu on Chats');
  assert.match(c, /if \(shell !== 'phone'\) return;/, 'the long press is the phone\'s; the desktop uses right-click');
  assert.match(c, /if \(p\?\.fired\) \{ e\.preventDefault\(\); e\.stopImmediatePropagation\?\.\(\); p = null; \}/, 'the click ending a long press does not also open the app');
  assert.match(c, /dispose\(\) \{ close\(\); menuClose\(\);/);
  for (const f of ['web/layouts/apps/desktop.js', 'web/layouts/apps/layout.js']) assert.match(read(f), /chrome\.menuOn\(b, item, \{ onOpen: go, onClosed: \(\) => api\.after\(60, paint\) \}\);/, f);
});
