import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/apps.js', import.meta.url), 'utf8');
// The launcher picks up apps the agent or `wam` installed, without a reload or focus change; an unchanged list
// rebuilds nothing, a hidden page polls nothing, and there is never more than one timer.
function fixture({ cached = null } = {}) {
  let apps = [{ id: 'files', name: 'Files', url: '/apps/files/' }];
  const timers = new Map(); let nextTimer = 1; const fetches = []; const events = [];
  const store = new Map(cached ? [['wux.apps.v1', JSON.stringify(cached)]] : []);
  const doc = { hidden: false, handlers: [], addEventListener(type, fn) { if (type === 'visibilitychange') this.handlers.push(fn); } };
  const window = {
    WizCore: { norm: s => String(s).toLowerCase() },
    WizConfig: { ready: Promise.resolve(), endpoint: () => '/wizard/v1/apps' },
    dispatchEvent: e => events.push(e),
  };
  const context = {
    window, document: doc, localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    fetch: async (url) => { fetches.push(url); return { ok: true, json: async () => ({ apps }) }; },
    setTimeout: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id), CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    location: { href: 'https://box/wizard-os-home/', origin: 'https://box' }, URL,
  };
  vm.runInNewContext(source, context);
  const flush = () => new Promise(r => setImmediate(r));
  return {
    registry: window.WizCore.apps, timers, fetches, events, doc,
    setApps: list => { apps = list; },
    tick: async () => { const [[id, t]] = [...timers]; timers.delete(id); t.fn(); await flush(); await flush(); },
    flush,
  };
}
test('a new app appears without a reload; an unchanged poll rebuilds nothing', async () => {
  const f = fixture();
  const shell = f.registry('mobile').APPS;
  await f.flush(); await f.flush();
  assert.ok(shell.some(a => a.id === 'files'));
  const rebuilt = () => f.events.filter(e => e.type === 'wizard:apps').length;
  const before = rebuilt();
  await f.tick();
  assert.equal(rebuilt(), before, 'unchanged list: no rebuild');
  f.setApps([{ id: 'files', name: 'Files', url: '/apps/files/' }, { id: 'hello-view', name: 'Hello View', url: '/apps/hello-view/' }]);
  await f.tick();
  assert.equal(rebuilt(), before + 1);
  assert.ok(shell.some(a => a.id === 'hello-view'), 'installed by the agent: on the launcher');
  assert.equal(f.timers.size, 1, 'one timer');
});
test('a cached identical list is not rebuilt at start; hidden pages stop polling and resume on focus', async () => {
  const f = fixture({ cached: [{ id: 'files', name: 'Files', url: '/apps/files/' }] });
  f.registry('desktop');
  const start = f.events.length;
  await f.flush(); await f.flush();
  assert.equal(f.events.length, start, 'same as the cache: nothing rebuilt');
  assert.equal(f.timers.size, 1);
  f.doc.hidden = true; f.doc.handlers.forEach(fn => fn());
  assert.equal(f.timers.size, 0, 'hidden: no timer');
  const n = f.fetches.length;
  f.doc.hidden = false; f.doc.handlers.forEach(fn => fn());
  await f.flush();
  assert.equal(f.fetches.length, n + 1, 'focus refreshes once');
  assert.equal(f.timers.size, 1, 'and polling resumes with one timer');
});
