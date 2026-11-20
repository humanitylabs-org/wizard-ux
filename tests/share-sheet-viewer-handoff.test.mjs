// wizard-ux issue 1630: Share from the media viewer to an app (Messenger). The viewer steps aside before the app opens,
// so the app's own Send to… picker is on top in the same tap, and the viewer never toasts "Shared" for a handoff
// (nothing is placed until the owner picks a person). Real-Chromium proof: tests/qa-share-viewer-handoff.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const sheetSrc = readFileSync(new URL('../web/core/share-sheet.js', import.meta.url), 'utf8');
const kitSrc = readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
function load({ canOpen = true, opens = true } = {}) {
  let ops = null; const log = [];
  const viewer = { open: true, isOpen() { return this.open; }, close() { log.push('viewer-close'); this.open = false; return true; } };
  const window = {
    WizCore: { apps: () => ({ APP: { messenger: { kind: 'wizard', name: 'Messenger' } } }) },
    WizCanOpen: () => canOpen, WizOpenApp: id => { log.push('open:' + id + (viewer.open ? ' (under viewer)' : '')); return opens; },
    WosChat: { viewer }, dispatchEvent: () => {}, fetch: async () => ({ ok: false, json: async () => ({}) }),
    WizAppServices: { claimShare: o => (ops ? false : (ops = o, true)) },
  };
  const ctx = { window, localStorage: store(), sessionStorage: store(), CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    document: { baseURI: 'https://box.test/wizard-os-home/desktop.html' }, location: { href: 'https://box.test/wizard-os-home/desktop.html' }, URL, requestAnimationFrame: f => f(), setTimeout, clearTimeout, File, Blob };
  vm.runInNewContext(sheetSrc, ctx);
  return { S: window.WosShareSheet, ops, log, viewer };
}
const md = () => new File(['# Trip notes\n'], 'trip-notes.md', { type: 'text/markdown' });

test('a handoff to an app closes the viewer first, then opens the app above everything', () => {
  const { S, ops, log } = load();
  assert.equal(S.handoffs(), 0);
  assert.equal(ops.deliver('messenger', { file: md() }), true);
  assert.deepEqual(log, ['viewer-close', 'open:messenger'], 'the app never opens under the viewer');
  assert.equal(S.handoffs(), 1, 'counted as a handoff, not a delivery');
});

test('an app that cannot open leaves the viewer as it was and is not a handoff', () => {
  for (const o of [{ canOpen: false, opens: false }, { canOpen: true, opens: false }]) {
    const { S, ops, log, viewer } = load(o);
    assert.equal(ops.deliver('messenger', { file: md() }), false);
    assert.equal(S.handoffs(), 0);
    if (!o.canOpen) assert.equal(viewer.open, true, 'nothing to show: the file stays open');
    assert.equal(ops.pending('messenger').length, 0, 'nothing left waiting');
  }
});

test('the viewer does not toast Shared when the sheet only handed the file to an app', () => {
  const at = kitSrc.indexOf('const share = it => {');
  const body = kitSrc.slice(at, kitSrc.indexOf('\n  }); };', at));
  assert.ok(at > 0 && body.length > 0);
  const gate = body.indexOf("if (result === 'shared' && (sheet?.handoffs?.() || 0) !== handed) return;");
  assert.ok(gate > 0, 'a handoff returns before any toast');
  assert.ok(gate < body.indexOf("K.notify('↗', 'Shared')"), 'and before the Shared toast');
  assert.ok(body.indexOf('handed = sheet?.handoffs?.()') < body.indexOf('await shareFileOpen'), 'counted before the sheet opens');
});
