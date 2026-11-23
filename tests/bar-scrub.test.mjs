// Swiping desks (wizard-ux issues 1491, 1536; on for everyone with no switch since 1563): the whole bottom bar, orb
// included, scrubs desks; the old one-desk bar swipe and the little handle are gone. Runs the real dock gesture
// (web/app.js, sliced) in a vm with a fake dock that has no document and a CHATS with only the incognito leave guard,
// so any read of a switch or of Channels would throw. Browser proof with real touches: tests/qa-bar-scrub.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';

const read = f => withShellParts(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
const APP = read('web/app.js');
const from = APP.indexOf('  /* Swiping desks (wizard-ux#1491'), to = APP.indexOf('  /* Overview (James', from);
assert.ok(from > 0 && to > from, 'dock gesture block found');
const BLOCK = APP.slice(from, to);

function shell({ desks = 6, at = 2 } = {}) {
  const on_ = {}, cls = new Set(), label = { textContent: '' }, log = [];
  const dock = { addEventListener: (t, f) => { (on_[t] ||= []).push(f); }, setPointerCapture() {} };
  const ctx = {
    console, performance: { now: () => 0 }, innerHeight: 915, sheet: null, idx: at, HOME: 0,
    desks: Array.from({ length: desks }, (_, i) => ({ id: 'd' + i, wins: i ? ['w' + i] : [], home: !i })),
    $: () => dock, window: {}, CHATS: { beforeNavigate: () => true },
    scrub: { classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) }, querySelector: () => label },
    SC_STEP: 26, deskName: i => 'Desk ' + i, vib() {}, endDotHold() {}, liftSettings() {}, tourEv() {}, renderDots() {},
    placeTrack: (d, snap) => log.push(['track', Math.round(d), snap]), atPickerEnd: () => false,
    // Desk sections: two+ desks from the current one are parked (not rendered) like parkDesks does.
    secs: Array.from({ length: desks }, (_, i) => ({ parked: Math.abs(i - at) > 1 })),
    track: { classList: { toggle: (c, v) => { if (v) cls.add('track:' + c); else cls.delete('track:' + c); } } },
  };
  ctx.secOf = i => { const sec = ctx.secs[i]; return sec && { classList: { remove: c => { if (c === 'parked') sec.parked = false; }, add: c => { if (c === 'parked') sec.parked = true; } } }; };
  ctx.parkDesks = () => { ctx.secs.forEach((sec, i) => { sec.parked = Math.abs(i - ctx.idx) > 1; }); log.push(['park', ctx.idx]); };
  ctx.scLabel = at => { label.textContent = ctx.deskName(at); };
  ctx.goDesk = n => { ctx.idx = n; log.push(['go', n]); };
  ctx.swipeDesk = s => { ctx.idx += s; log.push(['swipe', s]); };
  vm.createContext(ctx);
  vm.runInContext(BLOCK.replace('let DS = null, dockSwiped = 0;', 'var DS = null, dockSwiped = 0;'), ctx);
  const fire = (t, e) => on_[t].forEach(f => f({ type: t, pointerId: 1, pointerType: 'touch', target: { closest: () => null }, ...e }));
  ctx.fire = fire;
  // A finger: down at (x, y), moves to each dx at its time (ms), up (or cancel) at the end.
  const finger = (path, { x = 300, y = 870, up = 'pointerup', dy = 0, upAt } = {}) => {
    fire('pointerdown', { clientX: x, clientY: y, timeStamp: 0 });
    const labels = [];
    for (const [dx, t] of path) { fire('pointermove', { clientX: x + dx, clientY: y + dy, timeStamp: t }); if (cls.has('on') && labels.at(-1) !== label.textContent) labels.push(label.textContent); }
    const [dx, t] = path.at(-1); fire(up, { clientX: x + dx, clientY: y + dy, timeStamp: upAt ?? t + 10 });
    return { labels, on: cls.has('on') };
  };
  const slow = dx => Array.from({ length: 12 }, (_, k) => [Math.round(dx * (k + 1) / 12), 100 + k * 60]);
  // A finger that starts on the orb (wizard-ux issue 1536): the dock ignores its pointerdown, the orb's gesture code calls
  // barScrubJoin once it reads the drag as sideways (14 px), and the moves and release then bubble up to the dock.
  const orbFinger = (path, { x = 206, y = 870, up = 'pointerup', joinAt = 0 } = {}) => {
    fire('pointerdown', { clientX: x, clientY: y, timeStamp: 0, target: { closest: () => ({ id: 'orbWrap' }) } });
    const join = vm.runInContext('barScrubJoin', ctx), labels = []; let joined = null;
    path.forEach(([dx, t], k) => {
      const e = { type: 'pointermove', pointerId: 1, pointerType: 'touch', clientX: x + dx, clientY: y, timeStamp: t };
      if (k === joinAt) joined = join(e, { x, y, t: 0, ts: 0 });
      if (joined) fire('pointermove', e);
      if (cls.has('on') && labels.at(-1) !== label.textContent) labels.push(label.textContent);
    });
    const [dx, t] = path.at(-1); fire(up, { clientX: x + dx, clientY: y, timeStamp: t + 10 });
    return { joined, labels };
  };
  return { ctx, finger, orbFinger, slow, log };
}

test('a slow drag left steps one desk to the right per 26 px, with the label, and lands there', () => {
  const s = shell();
  const r = s.finger(s.slow(-84));
  assert.deepEqual(r.labels, ['Desk 2', 'Desk 3', 'Desk 4', 'Desk 5'], 'the label is up from the moment the scrub starts');
  assert.equal(s.ctx.idx, 5); assert.deepEqual(s.log.at(-1), ['go', 5]); assert.equal(r.on, false, 'label hides on release');
});

test('release lands from the start desk, so goDesk runs its desk-leave work (Codex P2 on PR 1587)', () => {
  const s = shell(), from = [];
  s.ctx.goDesk = n => { from.push(s.ctx.idx); s.ctx.idx = n; };
  s.finger(s.slow(-84)); assert.deepEqual(from, [2], 'goDesk sees the desk the scrub started on'); assert.equal(s.ctx.idx, 5);
  const o = shell(), of = []; o.ctx.goDesk = n => { of.push(o.ctx.idx); o.ctx.idx = n; };
  o.orbFinger(o.slow(-84), { joinAt: 1 }); assert.deepEqual(of, [2], 'same from the orb'); assert.equal(o.ctx.idx, 5);
});

test('drag right goes to the left; on Home it does nothing', () => {
  const s = shell({ at: 4 }); s.finger(s.slow(60)); assert.equal(s.ctx.idx, 2);
  const h = shell({ at: 0 }); h.finger(h.slow(120)); assert.equal(h.ctx.idx, 0);
});

test('a short quick flick still moves exactly one desk', () => {
  const s = shell(); s.finger([[-20, 20], [-45, 60]]);
  assert.equal(s.ctx.idx, 3); assert.deepEqual(s.log.at(-1), ['swipe', 1]);
  const r = shell(); r.finger([[25, 20], [48, 70]]); assert.equal(r.ctx.idx, 1);
});

// wizard-ux issue 1536 kick-back: on James's phone a natural quick swipe ended inside the flick time and moved one desk.
test('a fast long swipe lands by distance, like a slow one (not one desk)', () => {
  const s = shell({ at: 1 }); s.finger([[-30, 20], [-80, 50], [-110, 80]]);
  assert.equal(s.ctx.idx, 5, '110 px in 90 ms: four desks over'); assert.deepEqual(s.log.at(-1), ['go', 5]);
  const t = shell({ at: 0 }); t.finger([[-20, 16], [-50, 40], [-78, 70]]);
  assert.equal(t.ctx.idx, 3, '78 px (3 x 26) in 80 ms: three desks');
  const r = shell({ at: 5 }); r.finger([[30, 20], [110, 80]]); assert.equal(r.ctx.idx, 1, 'fast long swipe right');
});

test('a drag that held still past the flick time before release still scrubs (no last move)', () => {
  const s = shell(); s.finger([[-30, 40], [-84, 90]], { upAt: 400 });
  assert.equal(s.ctx.idx, 5);
  const h = shell(); h.finger([[-30, 40], [-84, 90]]); assert.equal(h.ctx.idx, 5, 'released at once: by distance too');
});

// wizard-ux issue 1536 (James, 18 Nov): while the finger is down, each step shows the desk it points at, not only its name.
test('each scrub step un-parks the hovered desk so it is on screen before release; settling parks again', () => {
  const s = shell({ at: 0 }), seen = [];
  s.ctx.fire('pointerdown', { clientX: 300, clientY: 870, timeStamp: 0 });
  for (const [dx, t] of [[-14, 100], [-40, 300], [-66, 500], [-92, 700]]) {
    s.ctx.fire('pointermove', { clientX: 300 + dx, clientY: 870, timeStamp: t });
    seen.push([s.ctx.idx, s.ctx.secs[s.ctx.idx].parked, s.ctx.secs[s.ctx.idx + 1]?.parked]);
    assert.equal(s.ctx.scrub.classList.contains('track:bar-scrubbing'), true, 'quick slide while scrubbing');
  }
  assert.deepEqual(seen, [[0, false, false], [1, false, false], [2, false, false], [3, false, false]], 'hovered desk and the next one render');
  assert.deepEqual(s.ctx.secs.map(x => x.parked), [true, false, false, false, false, true], 'desks left behind (3+ away) are parked again mid-scrub');
  s.ctx.fire('pointerup', { clientX: 208, clientY: 870, timeStamp: 900 });
  assert.equal(s.ctx.idx, 3); assert.equal(s.ctx.scrub.classList.contains('track:bar-scrubbing'), false, 'normal slide after release');
  const c = shell({ at: 0 }); c.finger(c.slow(-84), { up: 'pointercancel' });
  assert.equal(c.ctx.idx, 0); assert.deepEqual(c.log.at(-1), ['park', 0], 'cancelled: back on the start desk, far desks parked again');
  assert.deepEqual(c.ctx.secs.map(x => x.parked), [false, false, true, true, true, true]);
});

test('a drag that rises or is cancelled puts the desk back where it started', () => {
  const s = shell(); s.finger(s.slow(-84), { dy: -40 }); assert.equal(s.ctx.idx, 2);
  const c = shell(); c.finger(c.slow(-84), { up: 'pointercancel' }); assert.equal(c.ctx.idx, 2);
  const e = shell(); e.finger(e.slow(-84), { y: 900 }); assert.equal(e.ctx.idx, 2, 'home-indicator strip is the system\'s');
});

test('no switch: the scrub is the only bar path, in the catalogue and code there is no wizard/bar-scrub and no handle', () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(!JSON.stringify(cat).includes('bar-scrub'), 'not in the catalogue');
  assert.equal(existsSync(new URL('../web/tweaks/wizard/bar-scrub', import.meta.url)), false, 'package folder is gone');
  assert.doesNotMatch(APP, /bar-scrub(?!bing)|barScrubOn|\bSC_?=|SC\.live/, 'no switch check and no handle gesture left in app.js');
  assert.doesNotMatch(read('web/styles.css'), /\.scrub(\.on)? i\b/, 'no handle CSS');
  assert.doesNotMatch(BLOCK, /placeTrack\(d \* 1\.1|\.sc\b/, 'the old follow-the-finger one-desk swipe is gone');
  // The label box the shell builds (app-overview.js) holds only the label, no handle bar.
  const ov = readFileSync(new URL('../web/app-overview.js', import.meta.url), 'utf8'), at = ov.indexOf("  scrub.innerHTML = ");
  const docked = [], made = { className: '', innerHTML: '' };
  vm.runInNewContext(ov.slice(at, ov.indexOf('\n', at)), { scrub: made, $: () => ({ appendChild: n => docked.push(n) }) });
  assert.equal(made.innerHTML, '<span class="sc-label"></span>', 'the label box has no handle bar inside');
  assert.deepEqual(docked, [made], 'it sits on the dock');
  // the label box takes no touches, the bar under it scrubs: the real styles.css cascaded on the box the shell docked
  const doc = createDocument(), mk = ov.slice(ov.indexOf('  const scrub = document.createElement('), ov.indexOf('\n', ov.indexOf('  const scrub = document.createElement(')));
  const box = vm.runInNewContext(`(() => { ${mk}\n return scrub; })()`, { document: doc }); doc.body.appendChild(box);
  assert.equal(cascade(box, read('web/styles.css'))['pointer-events']?.value, 'none');
});

test('independent of Channels: the scrub block reads no switch, no Channels flag, DOM or state', () => {
  const code = BLOCK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /dataset\.tweaks|chat-channels|[Cc]hannel|chan[A-Z]|CHATS\.(?!beforeNavigate\b)/);
  // The vm has no document and CHATS has only beforeNavigate (the incognito chat's leave guard, also used by goDesk):
  // every gesture below would throw if the scrub touched either. Same result whether Channels is on or off.
  for (const chan of [false, true]) {
    // CHATS answers only beforeNavigate; Channels on/off is the one other thing it would know, and reading it throws.
    const strict = sh => { sh.ctx.CHATS = new Proxy({ beforeNavigate: () => true, channelsOn: () => chan }, { get: (o, k) => { if (k !== 'beforeNavigate') throw new Error('scrub read CHATS.' + String(k)); return o[k]; } }); return sh; };
    const s = strict(shell()), r = s.finger(s.slow(-84)); assert.equal(s.ctx.idx, 5, `scrub, Channels ${chan}`); assert.deepEqual(r.labels, ['Desk 2', 'Desk 3', 'Desk 4', 'Desk 5']);
    const f = strict(shell()); f.finger([[-20, 20], [-45, 60]]); assert.equal(f.ctx.idx, 3, 'flick');
    const l = strict(shell({ at: 1 })); l.finger([[-30, 20], [-80, 50], [-110, 80]]); assert.equal(l.ctx.idx, 5, 'fast long swipe by distance');
    const o = strict(shell()); o.orbFinger(o.slow(-84), { joinAt: 1 }); assert.equal(o.ctx.idx, 5, 'orb join');
    const c = strict(shell()); c.finger(c.slow(-84), { up: 'pointercancel' }); assert.equal(c.ctx.idx, 2, 'cancel');
    const u = strict(shell()); u.finger(u.slow(-84), { dy: -40 }); assert.equal(u.ctx.idx, 2, 'rising drag');
  }
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
test('a scrub with Settings open parks it on its desk and lands three desks over', () => {
  const s = settingsShell();
  s.ctx.goDesk = n => { s.ctx.idx = n; s.ctx.placeTrack(0, true); };
  s.finger(s.slow(-84));
  assert.equal(s.ctx.idx, 5);
  assert.equal(s.ctx.sheet, null, 'Settings is not the open sheet over desk 5');
  assert.equal(s.dev.has('sheet-open'), false); assert.equal(s.dev.has('st-parked'), true);
  assert.equal(s.ctx.stDesk, 'd2', 'parked on the desk it was opened on');
  s.ctx.goDesk(2); assert.equal(s.ctx.sheet, 'settings', 'landing back on its desk shows it again');
});
test('a scrub with Settings open that comes back to its own desk shows Settings again', () => {
  const s = settingsShell();
  s.ctx.goDesk = n => { s.ctx.idx = n; s.ctx.placeTrack(0, true); };
  s.finger([[-20, 40], [-30, 200], [-60, 300], [-10, 400]]);
  assert.equal(s.ctx.idx, 2); assert.equal(s.ctx.sheet, 'settings'); assert.equal(s.dev.has('sheet-open'), true);
});

// wizard-ux issue 1536: the scrub is live the moment the finger passes the slop, with no hold time and no first jump.
const steady = (dx, ms = 900, n = 30) => Array.from({ length: n }, (_, k) => [Math.round(dx * (k + 1) / n), Math.round(20 + ms * (k + 1) / n)]);
test('the scrub starts at once; a 20-30 px first move changes at most one desk and the label shows from the first step', () => {
  for (const first of [-20, -25, -30, 20, 30]) {
    const s = shell({ at: 2 });
    s.ctx.fire('pointerdown', { clientX: 300, clientY: 870, timeStamp: 0 });
    s.ctx.fire('pointermove', { clientX: 300 + first, clientY: 870, timeStamp: 16 });
    assert.ok(Math.abs(s.ctx.idx - 2) <= 1, `first ${first} px move: at most one desk (at ${s.ctx.idx})`);
    assert.equal(s.ctx.scrub.classList.contains('on'), true, 'label is up at once, no hold time');
    s.ctx.fire('pointerup', { clientX: 300 + first, clientY: 870, timeStamp: 400 });
    assert.ok(Math.abs(s.ctx.idx - 2) <= 1, `released after ${first} px: at most one desk`);
  }
});
test('one big first move never leaps ahead (the distance before the scrub went live is not counted)', () => {
  const s = shell({ at: 1 });
  s.ctx.fire('pointerdown', { clientX: 300, clientY: 870, timeStamp: 0 });
  s.ctx.fire('pointermove', { clientX: 230, clientY: 870, timeStamp: 30 }); // a slow frame: 70 px in the first move
  assert.equal(s.ctx.idx, 1, 'still on the start desk');
  s.ctx.fire('pointermove', { clientX: 214, clientY: 870, timeStamp: 260 });
  assert.equal(s.ctx.idx, 2, 'the next ~26 px is the very next desk');
});
test('a steady slow drag of 1, 3 or 5 x SC_STEP lands exactly that many desks away, both ways', () => {
  for (const [k, at] of [[1, 0], [3, 0], [5, 0], [1, 5], [3, 5]]) {
    const s = shell({ at }), dir = at ? 1 : -1;
    const r = s.finger(steady(dir * k * 26));
    assert.equal(s.ctx.idx, at - dir * k, `${k} steps from desk ${at}`);
    assert.equal(r.labels.length, k + 1, 'the start desk, then one label per desk stepped');
  }
});
test('a drag held from the very first move (no 180 ms pause) already steps desks', () => {
  const s = shell({ at: 0 }), seen = [];
  s.ctx.fire('pointerdown', { clientX: 300, clientY: 870, timeStamp: 0 });
  for (const [dx, t] of [[-14, 10], [-30, 30], [-56, 60], [-82, 90]]) { s.ctx.fire('pointermove', { clientX: 300 + dx, clientY: 870, timeStamp: t }); seen.push(s.ctx.idx); }
  assert.deepEqual(seen, [0, 1, 2, 3], 'desks step while the finger is still inside the old 180 ms window');
  s.ctx.fire('pointerup', { clientX: 218, clientY: 870, timeStamp: 600 });
  assert.equal(s.ctx.idx, 3);
});
test('a drag that starts on the orb scrubs exactly like one on the bar', () => {
  const bar = shell(), orb = shell();
  const a = bar.finger(bar.slow(-84)), b = orb.orbFinger(orb.slow(-84), { joinAt: 1 });
  assert.equal(b.joined, true, 'the orb hands its sideways drag to the scrub');
  assert.equal(orb.ctx.idx, bar.ctx.idx); assert.equal(orb.ctx.idx, 5); assert.deepEqual(b.labels, a.labels);
  const r = shell({ at: 4 }); r.orbFinger(r.slow(60), { joinAt: 2 }); assert.equal(r.ctx.idx, 2, 'drag right from the orb goes left');
  const h = shell({ at: 0 }); h.orbFinger(h.slow(120), { joinAt: 2 }); assert.equal(h.ctx.idx, 0, 'on Home a drag right from the orb does nothing');
  const f = shell(); f.orbFinger([[-20, 20], [-45, 50]]); assert.equal(f.ctx.idx, 3, 'a short quick flick from the orb moves one desk');
  const q = shell({ at: 1 }); q.orbFinger([[-20, 20], [-80, 50], [-110, 80]]); assert.equal(q.ctx.idx, 5, 'a fast long swipe from the orb goes by distance');
  const c = shell(); c.orbFinger(c.slow(-84), { joinAt: 1, up: 'pointercancel' }); assert.equal(c.ctx.idx, 2, 'cancelled: back to the start desk');
  const d = shell(); d.orbFinger(d.slow(-84), { joinAt: 1 }); vm.runInContext('barScrubDrop()', d.ctx); assert.equal(d.ctx.idx, 5, 'drop after release is inert');
  const g = shell(); g.ctx.fire('pointerdown', { clientX: 206, clientY: 870, timeStamp: 0, target: { closest: () => ({}) } });
  const join = vm.runInContext('barScrubJoin', g.ctx);
  join({ pointerId: 1, clientX: 180, clientY: 870, timeStamp: 100 }, { x: 206, y: 870, t: 0, ts: 0 });
  g.ctx.fire('pointermove', { clientX: 150, clientY: 870, timeStamp: 200 }); vm.runInContext('barScrubDrop()', g.ctx);
  assert.equal(g.ctx.idx, 2, 'the orb losing its finger mid-scrub puts the desk back');
});
test('an open sheet other than Settings keeps the orb\'s own gestures (the orb does not join the scrub)', () => {
  const o = shell(); o.ctx.sheet = 'launcher';
  assert.equal(vm.runInContext('barScrubJoin', o.ctx)({ pointerId: 1, clientX: 180, clientY: 870, timeStamp: 100 }, { x: 206, y: 870, t: 0, ts: 0 }), false);
  const st = shell(); st.ctx.sheet = 'settings';
  assert.equal(vm.runInContext('barScrubJoin', st.ctx)({ pointerId: 1, clientX: 180, clientY: 870, timeStamp: 100 }, { x: 206, y: 870, t: 0, ts: 0 }), true, 'Settings never blocks a scrub');
});
// The orb's real pointermove and release code (web/app-orbswipe.js), with the scrub join recorded.
function orbGesture() {
  const src = readFileSync(new URL('../web/app-orbswipe.js', import.meta.url), 'utf8');
  const a = src.indexOf("  orbWrap.addEventListener('pointermove', e => {"), b = src.indexOf('\n  });\n', a);
  const c = src.indexOf('  function endGesture(e, cancelled) {'), d = src.indexOf("    if (g.mode === 'scrub') { if (cancelled) barScrubDrop(); return; }", c);
  assert.ok(a > 0 && b > a && c > 0 && d > c);
  const log = [], move = [];
  const cls = { add() {}, remove() {}, toggle() {} };
  const orbWrap = { dataset: {}, classList: cls, closest: q => (q === '#dock' ? {} : null), addEventListener: (t, fn) => { if (t === 'pointermove') move.push(fn); } };
  const ctx = vm.createContext({ log, orbWrap, appVars: { G: null, idx: 2, desks: [{}, {}, {}, {}], sheet: null }, performance: { now: () => 1000 }, window: { WosOrbSwitcher: {} },
    barScrubJoin: (e, g) => (log.push(['join', g.mode]), true), barScrubDrop: () => log.push(['drop']), placeTrack: () => log.push(['track']), liftSettings() {}, atPickerEnd: () => false,
    orbSwipeAct: () => 'stock', cancelVoice() {}, clip: x => x, deskName: i => 'Desk ' + i, device: { classList: cls }, generalTarget: { classList: cls }, Orb: { press() {} }, dropWarm() {},
    launcher: { classList: { add: c => log.push(['launcher', c]), remove() {} }, style: {}, _rendered: true }, renderLauncher() {}, aimFor: () => null, V: { state: 'idle' }, $: () => ({ style: {}, textContent: '' }),
    queueMicrotask() {}, clearTimeout() {}, pillOvOpen: () => false, closeOverview: () => log.push(['overview']) });
  vm.runInContext(src.slice(a, b + 6) + '\n' + src.slice(c, d) + "    if (g.mode === 'scrub') { if (cancelled) barScrubDrop(); return; }\n    log.push(['orb-release', g.mode]);\n  }\nthis.end = endGesture;", ctx);
  const start = (extra = {}) => { ctx.appVars.G = { pointerId: 1, x: 200, y: 870, t: 0, mode: 'pending', ...extra }; };
  const to = (dx, dy) => move[0]({ pointerId: 1, clientX: 200 + dx, clientY: 870 + dy });
  return { ctx, get log() { return JSON.parse(JSON.stringify(log)); }, start, to, G: () => ctx.appVars.G };
}

test('the orb hands only its sideways drag to the scrub (tap, hold and up/down stay the orb\'s)', () => {
  const o = orbGesture();
  o.start(); o.to(20, 3);
  assert.equal(o.G().mode, 'scrub'); assert.deepEqual(o.log, [['join', 'h']], 'a sideways drag joins the scrub');
  o.to(60, 3); assert.deepEqual(o.log, [['join', 'h']], 'after that, its moves are the dock\'s (no orb follow)');
  o.ctx.end({ pointerId: 1 }, false); assert.deepEqual(o.log, [['join', 'h']], 'the dock\'s pointerup lands it');
  o.start(); o.to(20, 0); o.ctx.end({ pointerId: 1 }, true); assert.deepEqual(o.log.at(-1), ['drop'], 'a cancelled scrub is dropped');
  const v = orbGesture(); v.start(); v.to(2, -30);
  assert.equal(v.G().mode, 'v'); assert.deepEqual(v.log, [['launcher', 'dragging']], 'up/down stays the orb\'s (it pulls the launcher)');
  v.ctx.end({ pointerId: 1 }, false); assert.deepEqual(v.log.at(-1), ['orb-release', 'v']);
  const t = orbGesture(); t.start(); t.to(3, 2); assert.equal(t.G().mode, 'pending', 'a tap never moves past the slop');
  t.ctx.end({ pointerId: 1 }, false); assert.deepEqual(t.log, [['orb-release', 'pending']]);
  const h = orbGesture(); h.start({ mode: 'hold', holdAt: 900 }); h.ctx.generalTarget.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
  h.ctx.voiceDestination = {}; h.ctx.window.WizConfig = { agent: () => 'Wizard' };
  h.to(20, 0); assert.equal(h.G().mode, 'hold'); assert.deepEqual(h.log, [], 'a hold stays a hold');
  const c = orbGesture(); c.start({ corner: true }); c.to(30, 0); assert.equal(c.G().mode, 'still'); assert.deepEqual(c.log, [], 'the corner orb never scrubs');
});

// wizard-ux issue 1601: a short quick flick that arrives as one or two merged move events moved 0 desks (the first move
// past the slop set the scrub origin and counted no step). A flick is decided at release from its whole travel and time.
const moves = (dx, ms, n) => Array.from({ length: n }, (_, k) => [Math.round(dx * (k + 1) / n), Math.round(ms * (k + 1) / n)]);
test('a short quick flick is exactly one desk as 1, 2 or many move events, bar and orb, both ways', () => {
  for (const px of [30, 40, 44, 60]) for (const ms of [60, 91, 120, 160]) for (const n of [1, 2, 3, 8]) for (const dir of [-1, 1]) {
    const path = moves(dir * px, ms - 10, n), at = 2, want = at - dir;
    const b = shell({ at }); b.finger(path);
    assert.equal(b.ctx.idx, want, `bar ${dir * px} px / ${ms} ms in ${n} move(s)`); assert.deepEqual(b.log.at(-1), ['swipe', -dir]);
    const o = shell({ at }); o.orbFinger(path); assert.equal(o.ctx.idx, want, `orb ${dir * px} px / ${ms} ms in ${n} move(s)`);
  }
});
test('the one-move and two-move flicks from the report (30 px / 91 ms, 40-60 px single move)', () => {
  const a = shell(); a.finger([[-30, 81]]); assert.equal(a.ctx.idx, 3, 'single 30 px move, 91 ms');
  const b = shell(); b.finger([[-18, 30], [-30, 81]]); assert.equal(b.ctx.idx, 3, 'two moves');
  for (const px of [40, 50, 60]) { const c = shell(); c.finger([[px, 70]]); assert.equal(c.ctx.idx, 1, `single ${px} px move right`); }
});
test('a single-move fast long swipe lands by its whole distance, first move counted', () => {
  const a = shell({ at: 0 }); a.finger([[-100, 70]]); assert.equal(a.ctx.idx, 4, '100 px / 80 ms in one move: four desks');
  const b = shell({ at: 0, desks: 8 }); b.finger([[-160, 140]]); assert.equal(b.ctx.idx, 6, '160 px / 150 ms in one move: six desks');
  const c = shell({ at: 0, desks: 8 }); c.finger(moves(-160, 140, 6)); assert.equal(c.ctx.idx, 6, 'the same swipe as many moves lands the same');
  const o = shell({ at: 0 }); o.orbFinger([[-100, 70]]); assert.equal(o.ctx.idx, 4, 'from the orb too');
  const r = shell({ at: 5 }); r.finger([[100, 70]]); assert.equal(r.ctx.idx, 1, 'right as well');
});
test('a quick touch that drifts only just past the slop (under 20 px) stays on its desk (Codex P2 on PR 1603)', () => {
  for (const path of [[[-12, 150]], [[-14, 40], [-16, 150]], [[19, 100]]]) {
    const s = shell(); s.finger(path); assert.equal(s.ctx.idx, 2, `drift ${path.at(-1)[0]} px`);
    const o = shell(); o.orbFinger(path); assert.equal(o.ctx.idx, 2, `orb drift ${path.at(-1)[0]} px`);
  }
  const f = shell(); f.finger([[-20, 60]]); assert.equal(f.ctx.idx, 3, '20 px is a flick');
});
