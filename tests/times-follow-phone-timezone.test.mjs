// James, Tokyo, 27 Oct 2026: thread timestamps stayed on Bangkok time while his
// phone was on Tokyo time. Times on screen follow the phone's own clock; the
// settings zone is only the fallback when the device reports none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = `
const fs = require('fs'), vm = require('vm');
const c = { localStorage: { getItem: () => JSON.stringify({ settings: { clock: { timezone: 'Asia/Bangkok', day_starts_at: '06:00' }, agent: { name: 'A' }, owner: { name: '' } } }), setItem() {} },
  document: { addEventListener() {}, querySelector() { return null; } }, fetch: async () => ({ ok: false, status: 503 }),
  location: { origin: 'http://x', href: 'http://x/', protocol: 'http:' }, addEventListener() {}, dispatchEvent() {}, CustomEvent: class {} };
c.window = c; vm.createContext(c);
if (process.argv[2] === 'nozone') vm.runInContext("{ const RO = Intl.DateTimeFormat.prototype.resolvedOptions; Intl.DateTimeFormat.prototype.resolvedOptions = function () { return { ...RO.call(this), timeZone: undefined }; }; }", c);
vm.runInContext(fs.readFileSync(process.argv[1] + '/web/core/config.js', 'utf8'), c);
const t = Date.parse('2026-10-27T14:13:00Z');
console.log(JSON.stringify({ zone: c.WizConfig.timeZone(), home: c.WizConfig.homeZone(), hm: c.WizConfig.hm(t), h: c.WizConfig.dayParts(t).h }));
`;
const root = fileURLToPath(new URL('..', import.meta.url));
const run = (tz, mode = '') => JSON.parse(execFileSync(process.execPath, ['-e', script, root, mode], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }).trim().split('\n').pop());

test('times on screen follow the phone timezone when travelling', () => {
  const r = run('Asia/Tokyo');
  assert.equal(r.zone, 'Asia/Tokyo');
  assert.equal(r.hm, '23:13');
  assert.equal(r.h, 23);
  assert.equal(r.home, 'Asia/Bangkok', 'the settings zone stays the server home zone');
});

test('back home the phone and settings agree', () => {
  const r = run('Asia/Bangkok');
  assert.equal(r.zone, 'Asia/Bangkok');
  assert.equal(r.hm, '21:13');
});

test('a phone that reports no zone falls back to the settings zone, not UTC', () => {
  const r = run('Asia/Tokyo', 'nozone');
  assert.equal(r.zone, 'Asia/Bangkok');
  assert.equal(r.hm, '21:13');
  assert.equal(r.home, 'Asia/Bangkok');
});

test('the Snooze timezone hint no longer names Bangkok as the default', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(root + '/web/core/scheduled-reminders.js', 'utf8');
  assert.doesNotMatch(src, /Bangkok by default/);
  assert.doesNotMatch(src, /DEFAULT_ZONE\s*=\s*'Asia\/Bangkok'/);
});
