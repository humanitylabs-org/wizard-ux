// wizard-ux issue 1625: a file shared in a window that never opened Messenger still offers Messenger when its own
// share-files switch is on (read from the App Manager's switch catalog, never by loading Messenger).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(new URL('../web/core/share-sheet.js', import.meta.url), 'utf8');
const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
function load({ catalog, apps = { messenger: { kind: 'wizard', name: 'Messenger' } }, hang = false } = {}) {
  let ops = null; const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (hang) return new Promise(() => {});
    if (catalog === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => catalog };
  };
  const window = { WizCore: { apps: () => ({ APP: apps }) }, WizOpenApp: () => true, dispatchEvent: () => {}, fetch, WizAppServices: { claimShare: o => (ops ? false : (ops = o, true)) } };
  const ctx = { window, localStorage: store(), sessionStorage: store(), CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    document: { baseURI: 'https://box.test/wizard-os-home/desktop.html' }, location: { href: 'https://box.test/wizard-os-home/desktop.html' }, URL, requestAnimationFrame: f => f(), setTimeout, clearTimeout, File, Blob };
  vm.runInNewContext(src, ctx);
  return { S: Object.assign({}, window.WosShareSheet, ops), calls };
}
const md = () => new File(['# Trip notes\n'], 'trip-notes.md', { type: 'text/markdown' });
const on = v => ({ switches: [{ id: 'messenger:share-files', kind: 'app', on: v }], apps: [{ id: 'messenger', name: 'Messenger' }] });

test('switch on, Messenger never opened here: a file share asks the switch catalog and offers Messenger', async () => {
  const { S, calls } = load({ catalog: on(true) });
  assert.equal(S.wants('file'), false, 'nothing known before the share');
  let out = null;
  const shown = S.show({ file: md() }, async () => { out = 'native'; return 'unsupported'; }).catch(e => e); // no DOM here: render throws
  await new Promise(r => setTimeout(r, 20));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/wizard-os-home/store-install/_feature-switches');
  assert.equal(calls[0].opts.method, undefined, 'a read, never a flip');
  assert.equal(out, null, 'the sheet opened instead of going straight out');
  assert.equal(S.wants('file'), true);
  assert.match(String(await shown), /createElement/, 'it went on to draw the sheet (checked for real in tests/qa-share-file-fresh-window.cjs)');
});

test('switch off or Messenger not installed: a file goes straight out, as before', async () => {
  for (const opts of [{ catalog: on(false) }, { catalog: on(true), apps: { calendar: { kind: 'wizard', name: 'Calendar' } } }]) {
    const { S, calls } = load(opts);
    assert.equal(await S.show({ file: md() }, async () => 'unsupported'), 'unsupported');
    assert.equal(S.wants('file'), false);
    if (opts.apps) assert.equal(calls.length, 0, 'no catalog read without an installed receiver that needs it');
  }
});

test('the switch state wins over an old registration; an unknown switch keeps the registration', async () => {
  const off = load({ catalog: on(false) });
  off.S.register('messenger', { accepts: ['text', 'url', 'image', 'file'] });
  await off.S.show({ file: md() }, async () => 'unsupported');
  assert.equal(off.S.wants('file'), false, 'Messenger would refuse the file with its switch off');
  const old = load({ catalog: { switches: [], apps: [] } });
  old.S.register('messenger', { accepts: ['text', 'url', 'image', 'file'] });
  await old.S.show({ file: md() }, async () => 'unsupported').catch(() => {});
  assert.equal(old.S.wants('file'), true);
});

test('text shares never wait for the catalog; a slow App Manager never holds the sheet', async () => {
  const t = load({ catalog: on(true) });
  const drawn = await t.S.show({ text: 'hi' }, async () => 'shared').catch(e => e);
  assert.match(String(drawn), /createElement/, 'it drew the sheet (no DOM here)');
  assert.equal(t.calls.length, 0);
  const slow = load({ hang: true });
  const at = Date.now();
  assert.equal(await slow.S.show({ file: md() }, async () => 'unsupported'), 'unsupported');
  assert.ok(Date.now() - at < 3000, 'gave up waiting');
});
