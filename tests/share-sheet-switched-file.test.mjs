// wizard-ux issue 1625: a file shared in a window that never opened Messenger still offers Messenger when its own
// share-files switch is on (read ahead from the App Manager's switch catalog, never by loading Messenger, never waited on).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(new URL('../web/core/share-sheet.js', import.meta.url), 'utf8');
const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
function load({ catalog, apps = { messenger: { kind: 'wizard', name: 'Messenger' } }, hang = false } = {}) {
  let ops = null; const calls = [];
  const fetch = async (url, opts) => {
    // The share-people file on the box (wizard-ux issue 1627) is read at load: none here, and not a catalog read.
    if (url === '/wizard/v1/pages/wizard-share/people.json') return { ok: false, status: 403, json: async () => ({}) };
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
const settle = () => new Promise(r => setTimeout(r, 20));

test('switch on, Messenger never opened here: the switch catalog is read ahead and Messenger takes files', async () => {
  const { S, calls } = load({ catalog: on(true) });
  assert.equal(S.wants('file'), false, 'nothing known before the read');
  S.prime('file'); S.prime('file'); await settle();
  assert.equal(calls.length, 1, 'one read, cached');
  assert.equal(calls[0].url, '/wizard-os-home/store-install/_feature-switches');
  assert.equal(calls[0].opts.method, undefined, 'a read, never a flip');
  assert.equal(S.wants('file'), true);
  assert.equal(S.wants('image'), false, 'only the switched kind');
});

test('Share never waits for the catalog: the sheet or the system share comes in the same tap', async () => {
  const slow = load({ hang: true });
  let sync = false;
  const p = slow.S.show({ file: md() }, () => { sync = true; return Promise.resolve('unsupported'); });
  assert.equal(sync, true, 'the fallback ran inside the gesture, before any await');
  assert.equal(await p, 'unsupported');
  assert.equal(slow.calls.length, 1, 'and it read ahead for the next share');
  const t = load({ catalog: on(true) });
  await t.S.show({ text: 'hi' }, async () => 'shared').catch(() => {}); // no DOM here: the sheet itself is in the browser QA
  assert.equal(t.calls.length, 0, 'text never needs the catalog');
});

test('switch off or Messenger not installed: a file goes straight out, as before', async () => {
  for (const opts of [{ catalog: on(false) }, { catalog: on(true), apps: { calendar: { kind: 'wizard', name: 'Calendar' } } }]) {
    const { S, calls } = load(opts);
    S.prime('file'); await settle();
    assert.equal(await S.show({ file: md() }, async () => 'unsupported'), 'unsupported');
    assert.equal(S.wants('file'), false);
    if (opts.apps) assert.equal(calls.length, 0, 'no catalog read without an installed receiver that needs it');
  }
});

test('the switch state wins over an old registration; an unknown switch keeps the registration', async () => {
  const off = load({ catalog: on(false) });
  off.S.register('messenger', { accepts: ['text', 'url', 'image', 'file'] });
  assert.equal(off.S.wants('file'), true, 'before the read: the registration');
  off.S.prime('file'); await settle();
  assert.equal(off.S.wants('file'), false, 'Messenger would refuse the file with its switch off');
  const old = load({ catalog: { switches: [], apps: [] } });
  old.S.register('messenger', { accepts: ['text', 'url', 'image', 'file'] });
  old.S.prime('file'); await settle();
  assert.equal(old.S.wants('file'), true);
  const gone = load(); // an App Manager without the catalog (404)
  gone.S.prime('file'); await settle();
  assert.equal(gone.S.wants('file'), false);
});
