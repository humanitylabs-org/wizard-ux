// web/kit/wizard-sheet.js (mirror of wizard-os style/sheet.js): Back closes the top sheet. In an app that uses WizardApp,
// the shell asks the app client first (app-services.js), so each open sheet must sit on WizardApp.back and be released
// whenever it closes; window.__wizardCloseOverlay stays the fallback for apps without WizardApp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../web/kit/wizard-sheet.js', import.meta.url), 'utf8');
function el(cls) {
  const ls = {}, kids = [];
  return { className: cls, kids, style: {}, open: false,
    addEventListener: (t, f) => { (ls[t] ||= []).push(f); }, fire: (t, e = {}) => (ls[t] || []).forEach(f => f({ target: e.target, clientX: 0, clientY: 0, ...e })),
    setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }),
    closest(sel) { return sel === '.' + this.className ? this : null; } };
}
function dialog() {
  const d = el('wz-sheet'), grip = el('wz-sheet-grip'), x = el('wz-sheet-x');
  let hasGrip = false, hasX = false;
  d.querySelector = sel => sel.includes('grip') ? (hasGrip ? grip : null) : (hasX ? x : null);
  d.insertAdjacentHTML = () => { hasGrip = true; };
  grip.insertAdjacentHTML = () => { hasX = true; };
  d.showModal = () => { d.open = true; };
  d.close = () => { if (!d.open) return; d.open = false; d.fire('close'); };
  d.x = x; return d;
}
function load(withApp) {
  const overlays = [];
  const win = {};
  if (withApp) win.WizardApp = { back: { push(fn) { const h = { fn, release() { const i = overlays.indexOf(h); if (i >= 0) overlays.splice(i, 1); } }; overlays.push(h); return { release: h.release }; } } };
  // WizardApp's own back(): the top overlay's fn, then release (core/app-client.js).
  const appBack = () => { const top = overlays[overlays.length - 1]; if (!top) return false; if (top.fn() === false) return false; top.release(); return true; };
  vm.runInNewContext(src, { window: win });
  return { win, overlays, appBack };
}

test('hosted app: shell Back reaches the open sheet through WizardApp.back and closes it', () => {
  const { win, overlays, appBack } = load(true), d = dialog();
  win.WzSheet.open(d);
  assert.equal(d.open, true); assert.equal(overlays.length, 1, 'the open sheet is on WizardApp.back');
  assert.equal(appBack(), true); assert.equal(d.open, false); assert.equal(overlays.length, 0);
  assert.equal(appBack(), false, 'at root again: Back falls through to the app');
});

test('hosted app: closing by × (or Esc) releases its Back entry, so the next Back is not swallowed', () => {
  const { win, overlays, appBack } = load(true), d = dialog();
  win.WzSheet.open(d); d.fire('click', { target: d.x });
  assert.equal(d.open, false); assert.equal(overlays.length, 0);
  win.WzSheet.open(d); assert.equal(overlays.length, 1, 'reopening registers once');
  win.WzSheet.open(d); assert.equal(overlays.length, 1, 'showing an open sheet again does not double-register');
  d.close(); assert.equal(overlays.length, 0); assert.equal(appBack(), false);
});

test('app without WizardApp: the legacy window.__wizardCloseOverlay closes the top sheet', () => {
  const { win } = load(false), a = dialog(), b = dialog();
  win.WzSheet.open(a); win.WzSheet.open(b);
  assert.equal(win.__wizardCloseOverlay(), true); assert.equal(b.open, false); assert.equal(a.open, true);
  assert.equal(win.__wizardCloseOverlay(), true); assert.equal(a.open, false);
  assert.equal(win.__wizardCloseOverlay(), false);
});
