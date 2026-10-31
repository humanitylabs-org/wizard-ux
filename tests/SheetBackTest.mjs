// Back on the share sheet never discards with a single press (James's standing rule). Ported from the live Android
// SheetBackTest.java (same three cases), plus the web-only "nothing to lose" and wiring checks.
// Named SheetBackTest.mjs on purpose: app-parity-gate inventories the live module `sheetbacktest`; `npm test` runs it explicitly.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const win = {}; vm.runInNewContext(read('web/core/sheetback.js'), {window: win});
const {create, Action, WINDOW_MS} = win.WizSheetBack;

test('window matches the live Android value', () => assert.equal(WINDOW_MS, 2000));

test('back from a chooser returns to the sheet and the sheet stays open', () => {
  const b = create();
  b.openChooser();
  assert.equal(b.back(1000), Action.CLOSE_CHOOSER);
  assert.equal(b.chooserOpen(), false);
  assert.equal(b.back(10000), Action.WARN); // a single Back on the sheet only warns: still open
});

test('only a second Back within the window cancels', () => {
  const b = create();
  assert.equal(b.back(0), Action.WARN);
  assert.equal(b.back(WINDOW_MS + 1), Action.WARN); // too late: warns again
  assert.equal(b.back(WINDOW_MS + 500), Action.CANCEL);
});

test('closing a chooser never counts towards cancel', () => {
  const b = create();
  assert.equal(b.back(0), Action.WARN);
  b.openChooser();
  assert.equal(b.back(100), Action.CLOSE_CHOOSER);
  assert.equal(b.back(200), Action.WARN); // the earlier warning was reset by the chooser
  assert.equal(b.back(300), Action.CANCEL);
});

test('the window edge is inclusive, as on Android', () => {
  const b = create();
  assert.equal(b.back(5000), Action.WARN);
  assert.equal(b.back(5000 + WINDOW_MS), Action.CANCEL);
});

test('a sheet with nothing to lose cancels on the first Back', () => {
  const b = create();
  assert.equal(b.back(0, false), Action.CANCEL);
  assert.equal(b.back(1, true), Action.WARN); // content appears: warns, never discards on one press
});

test('a closed chooser counter cannot go negative', () => {
  const b = create();
  b.closeChooser(); b.closeChooser();
  assert.equal(b.back(0), Action.WARN);
});

test('share wizard routes Back/Escape through the policy; Cancel, X and scrim stay immediate; both shells load it first', () => {
  const sw = read('web/core/share-wizard.js');
  assert.match(sw, /WizSheetBack/);
  assert.match(sw, /if \(e\.target\.closest\('\[data-dvclose\]'\)\) return a\.picker \? a\.closePicker\(\) : finish\('cancelled'\);/);
  for (const f of ['index.html', 'desktop.html']) {
    const h = read('web/' + f), s = h.indexOf('core/sheetback.js'), w = h.indexOf('core/share-wizard.js');
    assert.ok(s > 0 && w > s, f + ': sheetback.js loads before share-wizard.js');
  }
});
