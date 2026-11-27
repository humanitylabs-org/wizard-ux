// wizard-ux issue 1627 (on for everyone; switch wizard/share-people-box removed): the share targets an app publishes are kept on the box, so a
// window that has never opened Messenger still shows Messenger's people. Runs the real share-sheet.js against a fake
// Agent Service Pages file API (versioned GET/PUT, 409 carrying the newer file), two browsers sharing one box.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(new URL('../web/core/share-sheet.js', import.meta.url), 'utf8');
const FILE = '/wizard/v1/pages/wizard-share/people.json';
const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function fakeBox({ pages = true } = {}) {
  const box = { text: null, version: null, n: 0, log: [] };
  box.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET'; box.log.push(`${method} ${url}`);
    if (url !== FILE) return reply(404, {});
    if (!pages) return reply(404, { error: 'not_found' });
    if (method === 'GET') return box.text == null ? reply(404, { error: 'file_not_found' }) : reply(200, { text: box.text, version: box.version });
    const { text, version } = JSON.parse(opts.body);
    if ((version ?? null) !== box.version) return reply(409, { error: 'stale_version', current: { text: box.text || '', version: box.version, exists: box.text != null } });
    box.text = text; box.version = 'v' + (++box.n); return reply(200, { version: box.version });
  };
  box.doc = () => (box.text ? JSON.parse(box.text) : null);
  return box;
}
function device(box, { ls = store(), apps = { messenger: { kind: 'wizard', name: 'Messenger' }, mail: { kind: 'wizard', name: 'Mail' } } } = {}) {
  let ops = null; const listeners = {};
  const root = { dataset: { tweaks: 'wizard/other' } };
  const window = { WizCore: { apps: () => ({ APP: apps }) }, WizOpenApp: () => true, dispatchEvent: () => {}, fetch: (u, o) => box.fetch(u, o),
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, WizAppServices: { claimShare: o => (ops ? false : (ops = o, true)) } };
  const ctx = { window, localStorage: ls, sessionStorage: store(), CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    document: { baseURI: 'https://box.test/wizard-os-home/index.html', documentElement: root }, location: { href: 'https://box.test/wizard-os-home/index.html' },
    URL, requestAnimationFrame: f => f(), setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 5)), clearTimeout, File, Blob };
  vm.runInNewContext(src, ctx);
  const S = Object.assign({}, window.WosShareSheet, ops), raw = S._people;
  S._people = k => JSON.parse(JSON.stringify(raw(k))); // vm arrays are another realm's
  const st = S._state; S._state = () => JSON.parse(JSON.stringify(st()));
  return { S, root, fire: t => (listeners[t] || []).forEach(f => f()) };
}
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));
const people = [{ id: 'tg:1', name: 'Ana Ruiz', detail: 'Telegram', lastActivity: 300 }, { id: 'tg:2', name: 'Ben Okafor', detail: 'Telegram', lastActivity: 200 }];
const publish = (d, app = 'messenger', list = people) => { d.S.register(app, { accepts: ['text', 'url'] }); d.S.setTargets(app, list); };

test('one browser keeps Messenger\'s people on the box, a fresh one shows them', async () => {
  const box = fakeBox(), a = device(box);
  publish(a); await settle();
  assert.deepEqual(box.doc().apps, { messenger: { targets: [{ id: 'tg:1', name: 'Ana Ruiz', detail: 'Telegram' }, { id: 'tg:2', name: 'Ben Okafor', detail: 'Telegram' }] } }, 'names and ids only, no activity times');
  const b = device(box); await settle();
  assert.deepEqual(b.S._people('text'), ['tg:1', 'tg:2'], 'the fresh window lists them, in Messenger\'s order');
  assert.equal(b.S._state().receivers.messenger, undefined, 'Messenger never ran there');
});

test('only a changed list is written: new activity times alone never touch the box', async () => {
  const box = fakeBox(), a = device(box);
  publish(a); await settle();
  const puts = () => box.log.filter(l => l.startsWith('PUT')).length;
  assert.equal(puts(), 1);
  a.S.setTargets('messenger', people.map(p => ({ ...p, lastActivity: p.lastActivity + 50 }))); await settle();
  assert.equal(puts(), 1);
});

test('two browsers saving at once (a stale version): both apps\' people are kept', async () => {
  const box = fakeBox(), a = device(box), b = device(box);
  await settle(); // both have read the (absent) file
  publish(a, 'messenger'); publish(b, 'mail', [{ id: 'm:1', name: 'Cara Lee', detail: 'Mail' }]);
  await settle(200);
  assert.deepEqual(Object.keys(box.doc().apps).sort(), ['mail', 'messenger']);
  const c = device(box); await settle();
  assert.deepEqual(c.S._people('text'), ['tg:1', 'tg:2'], 'Mail is not a receiver in that window yet');
  c.S.register('mail', { accepts: ['text', 'url'] }); // Mail registered there without its own list yet
  assert.deepEqual(c.S._people('text').sort(), ['m:1', 'tg:1', 'tg:2']);
});

test('this browser\'s own copy wins over the box\'s; an empty list (signed out) clears the box', async () => {
  const box = fakeBox(), a = device(box);
  publish(a); await settle();
  const b = device(box); await settle();
  publish(b, 'messenger', [{ id: 'tg:9', name: 'Dan Moss', detail: 'Telegram' }]);
  assert.deepEqual(b.S._people('text'), ['tg:9']);
  await settle();
  b.S.setTargets('messenger', []); await settle(100);
  assert.deepEqual(box.doc().apps.messenger.targets, []);
  const c = device(box); await settle();
  assert.deepEqual(c.S._people('text'), []);
});

test('people this browser cached before (an older build) go to the box at load; no Pages on the box: this browser only', async () => {
  const ls = store(), old = fakeBox({ pages: false }), a = device(old, { ls });
  publish(a); await settle();
  const box = fakeBox(); device(box, { ls }); await settle();
  assert.equal(box.doc().apps.messenger.targets.length, 2, 'a reload sends the cached list without waiting for a change');
  const ls2 = store(), b = device(box, { ls: ls2 }); await settle();
  publish(b, 'messenger', [{ id: 'tg:9', name: 'Dan Moss', detail: 'Telegram' }]); await settle(100); // another device, newer
  const puts = box.log.filter(l => l.startsWith('PUT')).length;
  const stale = device(box, { ls }); await settle(100); // the first browser reopens with its older cached list
  assert.equal(box.log.filter(l => l.startsWith('PUT')).length, puts, 'a stale cached list never overwrites the box');
  assert.deepEqual(box.doc().apps.messenger.targets, [{ id: 'tg:9', name: 'Dan Moss', detail: 'Telegram' }]);
  assert.deepEqual(stale.S._people('text'), ['tg:1', 'tg:2'], 'that browser keeps its own copy until Messenger runs there');
  const none = fakeBox({ pages: false }), d = device(none);
  publish(d); await settle();
  assert.deepEqual(d.S._people('text'), ['tg:1', 'tg:2']);
  assert.equal(none.log.filter(l => l.startsWith('PUT')).length, 0, 'a box without Pages is asked once and then left alone');
});
