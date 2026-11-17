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
  const finger = (path, { x = 300, y = 870, up = 'pointerup', dy = 0 } = {}) => {
    fire('pointerdown', { clientX: x, clientY: y, timeStamp: 0 });
    const labels = [];
    for (const [dx, t] of path) { fire('pointermove', { clientX: x + dx, clientY: y + dy, timeStamp: t }); if (cls.has('on') && labels.at(-1) !== label.textContent) labels.push(label.textContent); }
    const [dx, t] = path.at(-1); fire(up, { clientX: x + dx, clientY: y + dy, timeStamp: t + 10 });
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
  assert.equal(man.id, ID); assert.deepEqual(man.issues, ['humanitylabs-org/wizard-ux#1491']);
  const css = read('web/tweaks/wizard/bar-scrub/tweak.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of css.split('}').map(r => r.trim()).filter(Boolean)) assert.match(rule, /^html\[data-tweaks~="wizard\/bar-scrub"\] #scrub/);
  assert.match(APP, /const barScrubOn = \(\) => \{ try \{ return String\(document\.documentElement\.dataset\.tweaks \|\| ''\)\.split\(' '\)\.includes\('wizard\/bar-scrub'\)/);
});
