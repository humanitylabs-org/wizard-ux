// Phone bar scrub (wizard-ux issue 1491, switch wizard/bar-scrub, off by default): the whole bottom bar does what the
// little handle under the orb did, in the bar's own direction, and the handle is hidden. Runs the real dock gesture
// (web/app.js, sliced) in a vm with a fake dock. Browser proof with real touches: tests/qa-bar-scrub.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const ID = 'wizard/bar-scrub';
const APP = read('web/app.js');
const from = APP.indexOf('  /* Swipe anywhere on the bottom bar'), to = APP.indexOf('  /* Overview (James', from);
assert.ok(from > 0 && to > from, 'dock gesture block found');
const BLOCK = APP.slice(from, to);

function shell({ on = true, desks = 6, at = 2 } = {}) {
  const on_ = {}, cls = new Set(), label = { textContent: '' }, log = [];
  const dock = { addEventListener: (t, f) => { (on_[t] ||= []).push(f); }, setPointerCapture() {} };
  const ctx = {
    console, performance: { now: () => 0 }, innerHeight: 915, sheet: null, idx: at, HOME: 0,
    desks: Array.from({ length: desks }, (_, i) => ({ id: 'd' + i, wins: i ? ['w' + i] : [], home: !i })),
    document: { documentElement: { dataset: { tweaks: on ? 'wizard/desktop-chats ' + ID : 'wizard/desktop-chats' } } },
    $: () => dock, window: {}, CHATS: { beforeNavigate: () => true },
    scrub: { classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) }, querySelector: () => label },
    SC_STEP: 26, deskName: i => 'Desk ' + i, vib() {}, endDotHold() {}, liftSettings() {}, tourEv() {}, renderDots() {},
    placeTrack: (d, snap) => log.push(['track', Math.round(d), snap]), atPickerEnd: () => false,
  };
  ctx.scLabel = at => { label.textContent = ctx.deskName(at); };
  ctx.goDesk = n => { ctx.idx = n; log.push(['go', n]); };
  ctx.swipeDesk = s => { ctx.idx += s; log.push(['swipe', s]); };
  vm.createContext(ctx);
  vm.runInContext(BLOCK.replace('let DS = null, dockSwiped = 0;', 'var DS = null, dockSwiped = 0;'), ctx);
  const fire = (t, e) => on_[t].forEach(f => f({ type: t, pointerId: 1, pointerType: 'touch', target: { closest: () => null }, ...e }));
  // A finger: down at (x, y), moves to each dx at its time (ms), up (or cancel) at the end.
  const finger = (path, { x = 300, y = 870, up = 'pointerup', dy = 0, upAt } = {}) => {
    fire('pointerdown', { clientX: x, clientY: y, timeStamp: 0 });
    const labels = [];
    for (const [dx, t] of path) { fire('pointermove', { clientX: x + dx, clientY: y + dy, timeStamp: t }); if (cls.has('on') && labels.at(-1) !== label.textContent) labels.push(label.textContent); }
    const [dx, t] = path.at(-1); fire(up, { clientX: x + dx, clientY: y + dy, timeStamp: upAt ?? t + 10 });
    return { labels, on: cls.has('on') };
  };
  const slow = dx => Array.from({ length: 12 }, (_, k) => [Math.round(dx * (k + 1) / 12), 100 + k * 60]);
  return { ctx, finger, slow, log };
}

test('switch on: a slow drag left steps one desk to the right per 26 px, with the label, and lands there', () => {
  const s = shell();
  const r = s.finger(s.slow(-84));
  assert.deepEqual(r.labels, ['Desk 3', 'Desk 4', 'Desk 5']);
  assert.equal(s.ctx.idx, 5); assert.deepEqual(s.log.at(-1), ['go', 5]); assert.equal(r.on, false, 'label hides on release');
});

test('switch on: drag right goes to the left; on Home it does nothing', () => {
  const s = shell({ at: 4 }); s.finger(s.slow(60)); assert.equal(s.ctx.idx, 2);
  const h = shell({ at: 0 }); h.finger(h.slow(120)); assert.equal(h.ctx.idx, 0);
});

test('switch on: a quick flick still moves exactly one desk', () => {
  const s = shell(); s.finger([[-30, 20], [-80, 50], [-110, 80]]);
  assert.equal(s.ctx.idx, 3); assert.deepEqual(s.log.at(-1), ['swipe', 1]);
  const r = shell(); r.finger([[30, 20], [110, 80]]); assert.equal(r.ctx.idx, 1);
});

test('switch on: a drag that held still past the flick time before release still scrubs (no last move)', () => {
  const s = shell(); s.finger([[-30, 40], [-84, 90]], { upAt: 400 });
  assert.equal(s.ctx.idx, 5);
  const h = shell(); h.finger([[-30, 40], [-84, 90]]); assert.equal(h.ctx.idx, 3, 'released at once: still a flick');
});

test('switch on: a drag that rises or is cancelled puts the desk back where it started', () => {
  const s = shell(); s.finger(s.slow(-84), { dy: -40 }); assert.equal(s.ctx.idx, 2);
  const c = shell(); c.finger(c.slow(-84), { up: 'pointercancel' }); assert.equal(c.ctx.idx, 2);
  const e = shell(); e.finger(e.slow(-84), { y: 900 }); assert.equal(e.ctx.idx, 2, 'home-indicator strip is the system\'s');
});

test('switch off: the bar keeps its one-desk swipe and never scrubs', () => {
  const s = shell({ on: false });
  const r = s.finger(s.slow(-130));
  assert.deepEqual(r.labels, []); assert.equal(s.ctx.idx, 3); assert.deepEqual(s.log.at(-1), ['swipe', 1]);
});

test('switch is a catalogued off-by-default tweak whose sheet only hides the handle', () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(cat.tweaks.includes(ID)); assert.ok(!cat.defaults.includes(ID));
  const man = JSON.parse(read('web/tweaks/wizard/bar-scrub/manifest.json'));
  assert.equal(man.id, ID); assert.deepEqual(man.shells, ['phone']); assert.deepEqual(man.issues, ['humanitylabs-org/wizard-ux#1491']);
  const css = read('web/tweaks/wizard/bar-scrub/tweak.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of css.split('}').map(r => r.trim()).filter(Boolean)) assert.match(rule, /^html\[data-tweaks~="wizard\/bar-scrub"\] #scrub/);
  assert.match(APP, /const barScrubOn = \(\) => \{ try \{ return String\(document\.documentElement\.dataset\.tweaks \|\| ''\)\.split\(' '\)\.includes\('wizard\/bar-scrub'\)/);
});

// wizard-ux#1516: with Settings open, a scrub parks it like a flick does. The real placeTrack, liftSettings,
// rideSettings and dropParkedSettings run here with the dock block; the scrub's first snap (still on the start desk)
// used to count as "home again" and re-open Settings, so it stayed open over the desk the scrub landed on.
const fn = name => { const a = APP.indexOf(`  function ${name}(`); assert.ok(a > 0, name); const b = APP.indexOf('\n  }\n', a); return APP.slice(a, b + 4); };
function settingsShell({ at = 2 } = {}) {
  const s = shell({ at }), c = s.ctx, dev = new Set(['sheet-open']);
  const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } });
  Object.assign(c, {
    sheet: 'settings', stDesk: null, innerWidth: 412, track: el(), tourEv() {},
    device: { clientWidth: 412, classList: { add: k => dev.add(k), remove: k => dev.delete(k), contains: k => dev.has(k) } },
    settingsEl: { ...el(), inert: false, setAttribute() {}, removeAttribute() {} },
  });
  const dock = c.$(); c.$ = q => q === '.nebula' ? el() : dock; delete c.placeTrack; delete c.liftSettings;
  vm.runInContext(['placeTrack', 'liftSettings', 'dropParkedSettings', 'rideSettings'].map(fn).join('\n'), c);
  return { ...s, dev };
}
test('switch on: a scrub with Settings open parks it on its desk and lands three desks over', () => {
  const s = settingsShell();
  s.ctx.goDesk = n => { s.ctx.idx = n; s.ctx.placeTrack(0, true); };
  s.finger(s.slow(-84));
  assert.equal(s.ctx.idx, 5);
  assert.equal(s.ctx.sheet, null, 'Settings is not the open sheet over desk 5');
  assert.equal(s.dev.has('sheet-open'), false); assert.equal(s.dev.has('st-parked'), true);
  assert.equal(s.ctx.stDesk, 'd2', 'parked on the desk it was opened on');
  s.ctx.goDesk(2); assert.equal(s.ctx.sheet, 'settings', 'landing back on its desk shows it again');
});
test('switch on: a scrub with Settings open that comes back to its own desk shows Settings again', () => {
  const s = settingsShell();
  s.ctx.goDesk = n => { s.ctx.idx = n; s.ctx.placeTrack(0, true); };
  s.finger([[-20, 40], [-30, 200], [-60, 300], [-10, 400]]);
  assert.equal(s.ctx.idx, 2); assert.equal(s.ctx.sheet, 'settings'); assert.equal(s.dev.has('sheet-open'), true);
});
