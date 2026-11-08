// Settings › Network & security shows one plain disk encryption line from the App Manager's read-only
// `wam disk status` (store-install/_disk; wizard-os spec/DISK_ENCRYPTION.md). core/disk-status.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const src = readFileSync(new URL('web/core/disk-status.js', root), 'utf8');

async function boot({ answer, clock = { t: 1e12 } } = {}) {
  const fetched = [];
  let feature = null, refreshes = 0;
  const WosSettings = { register: f => { feature = f; }, refresh: () => { refreshes++; }, features: [] };
  const fetch = async (u, opts) => {
    fetched.push({ u: String(u), opts });
    const a = typeof answer === 'function' ? answer() : answer;
    if (a instanceof Error) throw a;
    if (a === undefined) return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
    if (a && a.status) return { ok: false, status: a.status, json: async () => a.body };
    return { ok: true, status: 200, json: async () => a };
  };
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [clock.t])); } static now() { return clock.t; } }
  const ctx = vm.createContext({ window: { WosSettings }, document: { currentScript: { src: 'https://box.ts.net/wizard-os-home/core/disk-status.js' } }, location: { href: 'https://box.ts.net/wizard-os-home/' }, fetch, URL, Date: FakeDate });
  vm.runInContext(src, ctx);
  assert.ok(feature, 'registers a Settings feature');
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
  const render = async () => { feature.html(); await settle(); return feature.html(); };
  return { feature, fetched, render, settle, clock, refreshes: () => refreshes };
}
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('one row on the Network & security page, asked from the owner-only App Manager route', async () => {
  const b = await boot({ answer: { line: "Disk encrypted, unlocks with this box's security chip", level: 'ok' } });
  assert.equal(b.feature.page, 'network');
  assert.equal(b.feature.id, 'disk-encryption');
  assert.equal(text(await b.render()), "Disk Disk encryption Disk encrypted, unlocks with this box's security chip");
  assert.equal(b.fetched[0].u, 'https://box.ts.net/wizard-os-home/store-install/_disk');
  assert.equal(b.fetched[0].opts.credentials, 'same-origin');
  assert.equal(b.feature.available(), true);
});

test('the line is the App Manager\'s words, escaped and clipped', async () => {
  const b = await boot({ answer: { line: 'Not encrypted <img src=x onerror=alert(1)>\u0000' + 'x'.repeat(500), level: 'warn' } });
  const h = await b.render();
  assert.ok(!h.includes('<img'), 'escaped');
  assert.ok(text(h).length < 360, 'clipped');
  assert.match(h, /data-level="warn"/);
});

test('a box without the route shows nothing, so the page stays hidden, and is not asked again', async () => {
  const b = await boot({ answer: undefined });
  assert.equal(await b.render(), '');
  assert.equal(b.feature.available(), false);
  b.clock.t += 3600e3;
  await b.render();
  assert.equal(b.fetched.length, 1);
});

test('an error answer with its own line replaces an older "encrypted" line', async () => {
  let bad = false;
  const b = await boot({ answer: () => bad ? { status: 503, body: { line: "Couldn't check disk encryption", level: 'error' } } : { line: 'Disk encrypted', level: 'ok' } });
  assert.match(text(await b.render()), /Disk encrypted$/);
  b.clock.t += 601e3; bad = true;
  const h = await b.render();
  assert.equal(text(h), "Disk Disk encryption Couldn't check disk encryption");
  assert.match(h, /data-level="error"/);
});

test('asked at most every 10 minutes, 1 minute after a failure; a failure keeps the last good line and later says how old it is', async () => {
  let n = 0, fail = false;
  const b = await boot({ answer: () => { n++; return fail ? new Error('offline') : { line: 'Not encrypted', level: 'warn' }; } });
  await b.render(); await b.render(); await b.render();
  assert.equal(n, 1, 'no polling on every draw');
  b.clock.t += 601e3; fail = true;
  assert.equal(text(await b.render()), 'Disk Disk encryption Not encrypted', 'keeps the last good line');
  assert.equal(n, 2);
  b.clock.t += 30e3; await b.render();
  assert.equal(n, 2, 'not before a minute');
  b.clock.t += 31e3; await b.render();
  assert.equal(n, 3, 'asked again a minute after a failure, not ten');
  for (let i = 0; i < 25; i++) { b.clock.t += 61e3; await b.render(); }
  const h = await b.render();
  assert.match(text(h), /^Disk Disk encryption Not encrypted \(not rechecked since \d\d:\d\d\)$/, 'says when it was last checked');
  assert.match(h, /data-level="stale"/);
  fail = false; b.clock.t += 61e3;
  assert.equal(text(await b.render()), 'Disk Disk encryption Not encrypted', 'fresh again after an answer');
});

test('FileVault and VPS lines pass through unchanged', async () => {
  for (const line of ['Protected by FileVault on this Mac', 'Not encrypted: FileVault is off on this Mac', "Not encrypted by Wizard: relies on your provider's disk encryption, if it has any"]) {
    const b = await boot({ answer: { line, level: 'ok' } });
    assert.ok(text(await b.render()).endsWith(line));
  }
});
