import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../web/core/notif-bell.js', import.meta.url), 'utf8');
function load(open) {
  const win = { WizCanOpen: () => true, WizAppOpen: () => open.v, addEventListener() {}, dispatchEvent() {}, CustomEvent: class {} };
  const ctx = { window: win, document: { addEventListener() {}, querySelectorAll: () => [] }, addEventListener() {}, setInterval() {}, setTimeout() {}, fetch: async () => ({ ok: false }), location: { origin: 'x' } };
  win.window = win; vm.runInNewContext(src, ctx); return win.WosBell;
}

// One or the other, never both: the bell shows only while no Notifications window (and so no badge) is open.
test('bell shows when Notifications is not open', () => {
  const o = { v: false }, B = load(o);
  assert.match(B.html(), /class="ch-bell"[^>]*aria-label="Notifications"/);
  assert.doesNotMatch(B.html(), / hidden/);
});
test('bell is hidden while a Notifications window is open', () => {
  const o = { v: true }, B = load(o);
  assert.match(B.html(), /data-chbell hidden/);
  o.v = false; assert.doesNotMatch(B.html(), / hidden/);
});
test('both shells expose WizAppOpen and repaint the bell on window changes', () => {
  for (const f of ['../web/app.js', '../web/desktop/desktop.js']) {
    const s = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.match(s, /window\.WizAppOpen = id =>/);
    assert.match(s, /window\.WosBell\?\.paint\?\.\(\)/);
  }
});

// A shell newer than its cached notif-bell.js (iPhone PWA after an update) must still start: an older bell had
// html/refresh but no paint, and `WosBell?.paint()` threw "paint is not a function" at boot (Robert, 24 Oct 2026).
test('shells tolerate an older bell module without paint or html', () => {
  for (const f of ['../web/app.js', '../web/desktop/desktop.js', '../web/core/chats.js']) {
    const s = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(s, /WosBell\?\.(paint|html)\(/, `${f} calls a bell method without ?.()`);
  }
  const win = { WosBell: { refresh() {}, html: () => '' } };
  assert.doesNotThrow(() => { win.WosBell?.paint?.(); });
  assert.equal(({ WosBell: { refresh() {} } }).WosBell?.html?.() || '', '');
});
