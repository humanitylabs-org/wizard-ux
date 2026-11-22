// Tiny bridge-only regression. This does not launch a browser or claim product acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { runPictureQa } from './fixtures/r7A-qa-picture-harness.mjs';
const text = fs.readFileSync(new URL('../tools/qa-screen-picture-translate.cjs', import.meta.url), 'utf8');
const start = text.indexOf('await page.addInitScript(') + 'await page.addInitScript('.length;
const end = text.indexOf('\n        }, {jpeg:', start) + '\n        }'.length;
const install = text.slice(start, end);
function bridge() {
  const replies = [], context = {window: {}, S: {translated: (id, value) => replies.push(value)}, setTimeout: fn => fn()};
  const setup = vm.runInNewContext('(' + install + ')', context);
  setup({jpeg: '', read: {lines: []}, mapping: {'ข้าจะไปออกรบ': "I'm heading to battle"}, chromeLabels: ['Copy translation','Select text','Ask Wizard']});
  return {translate: context.window.ScreenNative.translate, replies};
}
test('verdict matchers accept the real multiline pill and reject unrelated verdicts', async () => {
  // the whole QA run (fake Chromium): the baseline page's false English verdict is recognised from its real pill text
  for (const pill of ['Already in\nEnglish\n▾', 'Already in English']) {
    const r = await runPictureQa({ baselinePill: pill });
    assert.equal(r.thrown, null, JSON.stringify(pill)); assert.notEqual(r.exitCode, 1, JSON.stringify(pill));
    assert.ok(r.checks.some(c => /^baseline .*: false English verdict bypasses vision$/.test(c)), JSON.stringify(pill));
  }
  const other = await runPictureQa({ baselinePill: 'Thai → English' });
  assert.ok(other.thrown || other.exitCode === 1, 'a translated pill on the baseline is not taken for its false verdict');
  assert.ok(!other.checks.some(c => /false English verdict/.test(c)));
});
test('synthetic English chrome returns identity, without inventing inference', () => {
  const h = bridge(); h.translate('1', JSON.stringify(['Copy translation','Select text','Ask Wizard']), 'English');
  assert.equal(JSON.stringify(h.replies[0].items), JSON.stringify(['Copy translation','Select text','Ask Wizard']));
});
test('recorded Thai mapping is preserved', () => {
  const h = bridge(); h.translate('1', JSON.stringify(['ข้าจะไปออกรบ']), 'English');
  assert.equal(h.replies[0].items[0], "I'm heading to battle");
});
test('unrecorded input and different target still refuse', () => {
  const h = bridge();
  assert.throws(() => h.translate('1', '["unrecorded"]', 'English'), /No recorded inference/);
  assert.throws(() => h.translate('1', '["Copy translation"]', 'French'), /No recorded inference/);
});
test('capture waits for a stable, fully onscreen sheet after its transform finishes', () => {
  const start = text.indexOf('function sheetCaptureReady()');
  const end = text.indexOf('\n}',start) + 2;
  let bounds = {left:8,top:585,right:352,bottom:950,width:344,height:365}, transform = 'matrix(1, 0, 0, 1, 0, 200)';
  const context = {window:{},innerWidth:360,innerHeight:780,
    document:{querySelector:()=>({getBoundingClientRect:()=>bounds,classList:{contains:()=>true}})},
    getComputedStyle:()=>({transform})};
  const ready = vm.runInNewContext('(' + text.slice(start,end) + ')',context);
  for(let i=0;i<5;i++) assert.equal(ready(),false,'transitional clipped frame must fail');
  transform = 'none';
  assert.equal(ready(),false,'stable but offscreen sheet must fail');
  bounds = {...bounds,top:383,bottom:748};
  assert.equal(ready(),false,'first final frame is insufficient');
  assert.equal(ready(),false);
  assert.equal(ready(),false);
  assert.equal(ready(),true,'three unchanged frame intervals after settling');
  bounds = {...bounds,top:382,bottom:747};
  assert.equal(ready(),false,'movement resets stability');
});
test('historical bridge rejects the exact synthetic English control', () => {
  const old = install.replace(' && !chromeLabels.includes(t)', '').replace('mapping[t] ?? t', 'mapping[t]');
  const context = {window: {}, setTimeout() {}};
  vm.runInNewContext('(' + old + ')', context)({jpeg:'',read:{lines:[]},mapping:{},chromeLabels:['Copy translation']});
  assert.throws(() => context.window.ScreenNative.translate('1','["Copy translation"]','English'), /No recorded inference/);
});
test('replay contract is the overlay: no panel expectation, geometry required, no invented place', async () => {
  assert.doesNotMatch(text, /trans\?\.text|state\.pic\.some|scrollTop = sel\.scrollHeight/, 'the old panel contract is gone');
  assert.doesNotMatch(text, /_drop|linesOnly/);
  assert.doesNotMatch(text, /--wz-ink/);
  // An honest page passes every check: baseline, lines-only (nothing placed) and the geometry candidate, both skins.
  const ok = await runPictureQa();
  assert.equal(ok.receipt.ok, true, JSON.stringify(ok.receipt.checks.filter(c => !c.ok)));
  assert.equal(ok.receipt.geometry, true);
  for (const skin of ['nebula', 'grove']) for (const v of ['baseline', 'lines-only', 'candidate']) assert.ok(ok.checks.includes(`${v} ${skin}: no runtime errors`), `${v} ${skin} ran`);
  assert.ok(!ok.checks.some(c => /panel opens|text panel/.test(c) && !/no automatic panel/.test(c)), 'no check expects a panel');
  // The skin roles it applies are the Appearance --wz-* roles.
  assert.ok(ok.roles.includes('--wz-text') && ok.roles.includes('--wz-panel'));
  // The outside tap is the hit-tested point outsideTarget chose, not a fixed spot.
  assert.ok(ok.actions.some(a => a[0] === 'tap' && a[1] === 33 && a[2] === 444));
  assert.ok(!ok.actions.some(a => a[0] === 'tap' && a[1] === 345 && a[2] === 100));
  // A page that paints a line with no recorded box (an invented place) fails the lines-only check.
  const invented = await runPictureQa({ invent: true });
  assert.equal(invented.receipt.ok, false); assert.equal(invented.exitCode, 1);
  assert.deepEqual(invented.receipt.checks.filter(c => !c.ok).map(c => c.name).filter(n => /no place invented/.test(n)),
    ['lines-only nebula: no place invented (nothing painted for the picture)', 'lines-only grove: no place invented (nothing painted for the picture)']);
  // No geometry recording: the candidate does not run and the run fails rather than claim the overlay.
  const none = await runPictureQa({ geometry: false });
  assert.equal(none.receipt.geometry, false); assert.equal(none.receipt.ok, false);
  assert.ok(!none.checks.some(c => c.startsWith('candidate')));
  assert.deepEqual(none.receipt.checks.at(-1), { name: 'geometry recording present (overlay acceptance requires it)', ok: false });
  // The two recordings stay separate: a plain (lines-only) recording with boxes is refused before anything runs.
  const mixed = await runPictureQa({ plainBoxes: true });
  assert.match(String(mixed.thrown?.message), /historical plain recording is lines-only/);
  assert.equal(mixed.actions.length, 0);
});

// The in-page touch helpers, against a small geometric DOM double (css px, 411x914 like qa-screen-page).
const { outsideTarget, sheetSettled, hitTarget } = createRequire(import.meta.url)('../tools/qa-screen-hit.cjs');
function dom(boxes) {
  const els = Object.entries(boxes).map(([id, b]) => ({ id, className: b.cls || '', sel: b.sel, show: b.show !== false, disabled: false,
    classList: { contains: c => c === 'show' && b.show !== false }, contains(o) { return o === this; },
    getBoundingClientRect: () => ({ left: b.r[0], top: b.r[1], right: b.r[2], bottom: b.r[3], width: b.r[2] - b.r[0], height: b.r[3] - b.r[1] }) }));
  const layer = { id: 'layer', tagName: 'DIV' };
  const inside = (e, x, y) => { const r = e.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  const ctx = { innerWidth: 411, innerHeight: 914, window: {},
    getComputedStyle: e => ({ display: 'block', visibility: e.show ? 'visible' : 'hidden', transform: 'none' }),
    document: { getElementById: id => id === 'layer' ? layer : els.find(e => e.id === id),
      querySelectorAll: () => els.filter(e => e.sel),
      elementFromPoint: (x, y) => [...els].reverse().find(e => e.show && e.hit !== false && inside(e, x, y)) || layer } };
  ctx.window = ctx;
  return ctx;
}
const run = (fn, ctx, arg) => vm.runInNewContext('(' + fn.toString() + ')(' + JSON.stringify(arg) + ')', ctx);
test('outside target avoids the bottom-docked picked sheet where r1 tapped (200,760), chrome and paint', () => {
  const ctx = dom({ sheet: { r: [8, 701, 403, 858], sel: true, cls: 'sheet show' }, close: { r: [10, 32, 46, 68], sel: true },
    orig: { r: [300, 32, 400, 68], sel: true }, pill: { r: [110, 86, 300, 124], sel: true },
    p0: { r: [18, 112, 340, 148], sel: true }, p1: { r: [18, 165, 360, 195], sel: true }, p2: { r: [10, 225, 220, 260], sel: true } });
  const t = run(outsideTarget, ctx);
  assert.ok(t.point, JSON.stringify(t));
  assert.equal(t.hit, 'layer');
  assert.ok(t.point.y < 701 - 24 && t.point.y > 260 + 24, 'clear of the sheet and the painted lines: ' + JSON.stringify(t.point));
  assert.ok(!(t.point.x >= 8 && t.point.x <= 403 && t.point.y >= 701 && t.point.y <= 858));
  assert.equal(t.obstacles.length, 7);
});
test('outside target refuses when nothing is clear, and never returns a point not on the layer', () => {
  const full = dom({ sheet: { r: [0, 0, 411, 914], sel: true } });
  assert.equal(run(outsideTarget, full).point, null);
  const covered = dom({ cover: { r: [0, 0, 411, 914], sel: false } }); // an unlisted element over everything
  assert.equal(run(outsideTarget, covered).point, null);
});
test('settle waits need three unchanged frames in the wanted state; copy target must be hit-testable', () => {
  const ctx = dom({ tbar: { r: [8, 784, 403, 857], sel: true }, tCopy: { r: [16, 790, 140, 850], sel: false } });
  const settled = () => run(sheetSettled, ctx, ['tbar', true]);
  assert.deepEqual([settled(), settled(), settled(), settled()], [false, false, false, true]);
  assert.equal(run(sheetSettled, ctx, ['tbar', false]), false, 'a shown sheet is not dismissed');
  const ok = run(hitTarget, ctx, 'tCopy');
  assert.equal(ok.ok, true); assert.equal(ok.hit, 'tCopy');
  const blocked = dom({ tCopy: { r: [16, 790, 140, 850] }, sheet: { r: [8, 701, 403, 858] } }); // a sheet on top
  assert.equal(run(hitTarget, blocked, 'tCopy').ok, false);
});
test('--metrics-only is opt-in: only the geometry candidate and the two layout checks; default runs unchanged', async () => {
  const m = await runPictureQa({ metricsOnly: true });
  assert.equal(m.receipt.mode, 'exact-layout-diagnostic');
  assert.deepEqual(m.checks, ['nebula', 'grove'].flatMap(skin => [`candidate ${skin}: every painted line fits its own box (no clipped wrap)`, `candidate ${skin}: no painted line covers another`]));
  assert.deepEqual(m.actions.filter(a => a[0] !== 'goto'), [], 'nothing tapped or clicked');
  assert.deepEqual(m.actions.map(a => a[1]), ['screen.html', 'screen.html'], 'only the current page, no baseline');
  assert.deepEqual(m.shots, ['candidate-nebula-overlay.png', 'candidate-grove-overlay.png'], 'a settled overlay screenshot per skin');
  // Default: every run and every interaction, as before.
  const d = await runPictureQa();
  assert.match(d.receipt.mode, /^recorded-installed-private-inference-replay/);
  for (const kept of ['baseline nebula: false English verdict bypasses vision', 'lines-only grove: unplaced lines remain copyable',
    'candidate nebula: Original reveals the untouched picture', 'candidate grove: real outside tap dismisses and keeps the overlay',
    'candidate grove: Copy translation (hit-tested) has each recovered line exactly once']) assert.ok(d.checks.includes(kept), kept);
  assert.ok(d.actions.some(a => a[0] === 'click' && a[1] === '#orig'));
  assert.ok(d.actions.some(a => a[0] === 'tap' && a[1] === 77 && a[2] === 820), 'Copy tapped where hitTarget found it');
  // The receipt is written in finally, even when a run fails part-way.
  const failed = await runPictureQa({ failWait: true });
  assert.equal(failed.receipt?.ok, false); assert.match(failed.receipt.error, /timeout/);
  const failedMetrics = await runPictureQa({ metricsOnly: true, failWait: true });
  assert.equal(failedMetrics.receipt?.mode, 'exact-layout-diagnostic');
});
