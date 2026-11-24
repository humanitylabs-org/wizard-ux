// The dock orb's swipes per shell view (Miguel, 1 Nov 2026, round 6):
//   - Desks: the stock swipes, all of them (sideways = previous / next desk, up = the Desks panel / app picker,
//     down = James's distraction-free mode). A layout that declares nothing never changes them.
//   - Apps and Orb (phone): a swipe up on the orb = Home (the grid / the ring), like the iPhone's home swipe; sideways
//     and down do nothing (no desk steps, no distraction-free, no Desks panel from the orb). Declared by the layout
//     through the layout-only api.phone.swipes (chrome.js ORB_SWIPES), read by app.js as WosSkinHost.orbSwipes().
//   - Tap (talk / send) and hold (local command) are the same in all three views: they never ask the swipe map.
//   - No round Back button in any view (phone Orb, phone Apps, desktop Apps): Home is the swipe up (desktop also ⌥`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { runPart, scoped } from './fixtures/r5B-parts.mjs';

const root = new URL('../', import.meta.url);
const read = p => withShellParts(readFileSync(new URL(p, root), 'utf8'));
const app = read('web/app.js');

// app.js's own decision, run as written: 'stock' = the dock's own swipe, null = nothing, 'home' = Home.
const act = vm.runInNewContext(`(${app.match(/function orbSwipeAct\(g\) \{[\s\S]*?\n  \}/)[0]})`, {});
const ORB = { up: 'home', side: null, down: null };
test('per-view orb swipe map: Desks = every stock swipe; Apps / Orb = up Home, sideways and down nothing', () => {
  // Desks (no layout map): every swipe is the stock one, distraction-free included
  for (const g of [{ mode: 'h', dy: 0 }, { mode: 'v', dy: -90 }, { mode: 'v', dy: 30 }]) assert.equal(act({ ...g, swipes: null }), 'stock', JSON.stringify(g));
  // Apps / Orb
  assert.equal(act({ mode: 'h', dx: -80, dy: 4, swipes: ORB }), null, 'sideways: no desk step');
  assert.equal(act({ mode: 'v', dy: -90, swipes: ORB }), 'home', 'up: Home');
  assert.equal(act({ mode: 'v', dy: 30, swipes: ORB }), null, 'down: no distraction-free');
  // a map that leaves a key out keeps that stock swipe
  assert.equal(act({ mode: 'v', dy: 30, swipes: { up: 'home' } }), 'stock');
  // tap and hold never ask the map
  for (const mode of ['pending', 'hold', 'still']) assert.equal(act({ mode, dy: -90, swipes: ORB }), 'stock', mode);
});

// The phone dock orb's real gesture code (web/app-orbswipe.js) on a mini-dom orb: press, slide, release.
// `swipes` is what WosSkinHost.orbSwipes() hands the press (a layout's map, or null = stock); timers are manual.
function orb({ swipes = null, upDesks = false, corner = false, idx = 2, sheet = null } = {}) {
  const doc = scoped(createDocument()), orbWrap = doc.createElement('div'), device = doc.createElement('div'), dockEl = doc.createElement('div');
  dockEl.id = 'dock'; dockEl.appendChild(orbWrap); doc.body.append(device, dockEl); if (corner) device.classList.add('orb-corner');
  let reads = 0; const timers = [], calls = [];
  const appVars = { G: null, idx, sheet, desks: [{ id: 'home' }, { id: 'd1' }, { id: 'd2' }, { id: 'd3' }], W: {} };
  const rec = name => (...a) => { calls.push([name, ...a]); };
  const given = { $: sel => doc.querySelector(sel) || doc.createElement('div'), appVars, device, orbWrap, HOME: 0, V: { state: 'idle' }, generalTarget: doc.createElement('div'), launcher: doc.createElement('div'), inboxEl: doc.createElement('div'),
    orbUpDesks: () => upDesks, pillOvOpen: () => false, mayHoldCommand: () => true, barScrubJoin: () => false, atPickerEnd: () => false, deskName: () => 'Desk', clip: s => s, FIELDS: { refresh: () => false },
    Orb: { press() {} }, dropWarm() {}, vib() {}, tourEv() {}, closeMenu() {}, deskSigil: () => '', APPS: [] };
  for (const n of ['swipeDesk', 'openSheet', 'setZen', 'startOrbVoice', 'startVoice', 'finishVoice', 'openOverview', 'placeTrack', 'closeSheets', 'closeOverview', 'liftSettings', 'renderLauncher', 'warmMic']) given[n] = rec(n);
  given.goDesk = i => { calls.push(['goDesk', i]); appVars.idx = i; };
  let clock = 0; // each pointer event is 100 ms after the last: a slow, deliberate finger
  const ctx = { document: doc, performance: { now: () => clock }, queueMicrotask, setTimeout: (fn, ms) => timers.push({ fn, ms }), clearTimeout: () => {},
    window: { WosSkinHost: { orbSwipes: () => { reads++; return swipes; } }, WosCreateOrbSwitcher() {}, WizConfig: { agent: () => 'Wizard' } } };
  runPart('web/app-orbswipe.js', 'appParts', 'orbswipe', given, ctx);
  const fire = (type, x, y) => (clock += 100, orbWrap.dispatchEvent({ type, pointerId: 1, isPrimary: true, clientX: x, clientY: y, timeStamp: clock }));
  return {
    calls, appVars, orbWrap, reads: () => reads,
    // a swipe: press at (200, 700), slide by (dx, dy) in steps, let go
    swipe(dx, dy) { fire('pointerdown', 200, 700); for (const k of [0.25, 0.5, 1]) fire('pointermove', 200 + dx * k, 700 + dy * k); fire('pointerup', 200 + dx, 700 + dy); return calls.map(c => c[0]); },
    tap() { fire('pointerdown', 200, 700); fire('pointerup', 200, 700); return calls.map(c => c[0]); },
    hold() { fire('pointerdown', 200, 700); timers.find(t => t.ms === 380).fn(); fire('pointerup', 200, 700); return calls.map(c => c[0]); },
  };
}
const OWN = { up: 'home', side: null, down: null };
const moved = names => names.filter(n => !['warmMic'].includes(n));

test('app.js: the layout swipe runs before every stock swipe branch, and the stock branches are untouched', () => {
  // Desks (no map): sideways = desk step, up = the launcher (or the Desks panel), down = distraction-free.
  assert.deepEqual(moved(orb().swipe(-120, 0)).filter(n => n !== 'placeTrack'), ['swipeDesk']); assert.deepEqual(orb().calls.length, 0);
  let o = orb(); o.swipe(-120, 0); assert.deepEqual(o.calls.find(c => c[0] === 'swipeDesk'), ['swipeDesk', 1]);
  o = orb(); o.swipe(120, 0); assert.deepEqual(o.calls.find(c => c[0] === 'swipeDesk'), ['swipeDesk', -1]);
  o = orb(); o.swipe(0, -200); assert.deepEqual(o.calls.find(c => c[0] === 'openSheet'), ['openSheet', 'launcher']);
  o = orb(); o.swipe(0, 40); assert.deepEqual(o.calls.find(c => c[0] === 'setZen'), ['setZen', true]);
  o = orb({ upDesks: true }); o.swipe(0, -200); assert.ok(o.calls.some(c => c[0] === 'openOverview' && c[1] === 'pill'), 'our skins: up opens the Desks panel');
  o = orb({ upDesks: true }); o.swipe(0, 40); assert.deepEqual(o.calls.find(c => c[0] === 'setZen'), ['setZen', true]);
  // A layout's own map wins first: nothing follows the finger, up = Home, sideways and down nothing.
  for (const upDesks of [false, true]) {
    o = orb({ swipes: OWN, upDesks }); assert.deepEqual(moved(o.swipe(-120, 0)), [], 'sideways: no desk step, no track slide');
    o = orb({ swipes: OWN, upDesks }); assert.deepEqual(moved(o.swipe(0, 40)), [], 'down: no distraction-free');
    o = orb({ swipes: OWN, upDesks }); assert.deepEqual(moved(o.swipe(0, -200)), ['goDesk'], 'up: Home, nothing else (no launcher, no Desks panel)');
    assert.deepEqual(o.calls[0], ['goDesk', 0]); assert.equal(o.appVars.lastMove.from, 'd2', 'the iPhone swipe-home undo still applies');
  }
  o = orb({ swipes: OWN }); assert.deepEqual(moved(o.swipe(0, -30)), [], 'a short swipe up is not Home');
  o = orb({ swipes: OWN, idx: 0 }); o.swipe(0, -200); assert.equal(o.calls.length, 0, 'already Home: no move');
  o = orb({ swipes: { up: 'home' } }); o.swipe(0, 40); assert.deepEqual(o.calls.find(c => c[0] === 'setZen'), ['setZen', true], 'a key a map leaves out keeps its stock swipe');
  o = orb({ corner: true }); assert.deepEqual(moved(o.swipe(-120, 0)), [], 'the Chats corner orb keeps its stock rule in Desks: a slid finger never swipes the shell');
  o = orb({ corner: true, swipes: OWN }); assert.deepEqual(moved(o.swipe(0, -200)), ['goDesk'], 'with a map the corner orb swipes Home');
  o = orb({ swipes: OWN }); o.swipe(0, -200); o.swipe(-120, 0); assert.equal(o.reads(), 2, 'read once per press');
});

test('tap and hold are identical in all three views: the press, tap and hold paths never read the swipe map', () => {
  let touched = 0; const watched = () => new Proxy({ ...OWN }, { has: (t, k) => (touched++, k in t), get: (t, k) => (touched++, t[k]) });
  for (const swipes of [null, watched(), { up: 'new', side: null, down: null }]) {
    assert.deepEqual(orb({ swipes }).tap(), ['startOrbVoice'], 'tap: talk');
    const o = orb({ swipes }); assert.deepEqual(o.hold(), ['startVoice', 'finishVoice'], 'hold: a command, released = sent');
    assert.deepEqual(o.calls[0], ['startVoice', 'command']);
  }
  assert.equal(touched, 0, 'the map is never read on a tap or a hold');
});

test('skin-host: the orb swipe map stays generic (no view names in core); the shared chrome declares the dock swipes on the phone only', async () => {
  // The phone Apps and Orb views that wore a swipe map went in wizard-ux issue 1338; the generic api.phone.swipes stays.
  const { orbSwipeMap } = runPart('web/core/skin-host-rows.js', 'skinHostParts', 'rows', { isDoc: () => false }).out;
  const map = m => ({ ...orbSwipeMap(m) });
  assert.deepEqual(map({ up: 'home', side: null, down: null }), { up: 'home', side: null, down: null });
  assert.deepEqual(map({ up: 'new' }), { up: 'new' }, 'a key left out keeps the stock swipe');
  assert.deepEqual(map({ up: 'stock', side: 'desk', down: 'orb-shell', apps: 'home' }), { side: null, down: null }, 'only generic acts: anything else is inert, unknown keys dropped');
  assert.deepEqual(map({ up: 'apps-home' }), { up: null }, 'no view names in core');
  // the desktop Apps orb is the layout's own button: chrome.js only declares the dock swipes on the phone
  const { viewChrome, ORB_SWIPES } = await import(new URL('web/layouts/apps/chrome.js', root).href);
  const was = globalThis.document;
  try {
    const run = (shell, opts = {}) => {
      const doc = createDocument(); globalThis.document = doc; doc.documentElement.style = { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' };
      const asked = [], dock = { offsetWidth: 66, getBoundingClientRect: () => ({ left: 0, top: 0, width: 66, height: 66 }) };
      viewChrome({ env: { shell }, mount: () => () => {}, listen() {}, after() {}, phone: { orb: () => dock, swipes: m => { asked.push(m); return () => {}; } }, apps: { inset: () => () => {}, list: () => [] } }, { openIds: () => [], ...opts });
      return asked;
    };
    assert.deepEqual(run('phone'), [ORB_SWIPES], 'phone: the views\' swipes');
    const own = { up: 'new', side: null, down: null }; assert.deepEqual(run('phone', { swipes: own }), [own], 'or a view\'s own (AI apps: up = a New chat to type in)');
    assert.deepEqual(run('desktop'), [], 'desktop: none');
  } finally { globalThis.document = was; }
});

test('no round Back button in the shared view chrome; its orb swipes: up = Home, sideways and down nothing', async () => {
  const files = ['web/layouts/apps/chrome.js', 'web/layouts/apps/chrome.css'];
  for (const f of files) assert.ok(!/vc-back|paintBack|chrome\.back/.test(read(f)), `${f}: Back is gone`);
  const { ORB_SWIPES } = await import(new URL('web/layouts/apps/chrome.js', root));
  assert.deepEqual({ ...ORB_SWIPES }, ORB);
  for (const f of files.filter(f => f.endsWith('.js'))) assert.ok(!/Math\.random/.test(read(f)), f);
});
