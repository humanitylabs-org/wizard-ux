import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Miguel, 30 Oct 2026: with Messenger open, Reload said "Finish recording or save your work first" and never
// said who was holding it. The toast now names the app, and a second tap reloads anyway. Recordings still wait.
const src = readFileSync(new URL('../web/core/web-update.js', import.meta.url), 'utf8');

function load(blocking, { host = false, now = 1_000_000 } = {}) {
  const toasts = [], logs = []; let reloads = 0; let t = now;
  const D = class extends Date { static now() { return t; } };
  const listeners = {};
  const ctx = {
    console, Date: D, URL, Promise, Set, Map,
    setTimeout: (f, ms) => { const h = setTimeout(f, ms); h.unref(); return h; }, setInterval: () => 0, clearInterval() {}, clearTimeout() {},
    navigator: { onLine: true }, fetch: async () => ({ ok: false }),
    location: { pathname: '/wizard-os-home/', href: 'https://box/wizard-os-home/', reload() { reloads++; } },
    document: { currentScript: { src: 'https://box/wizard-os-home/core/web-update.js' }, hidden: false, querySelector: () => null,
      querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, body: { appendChild() {} },
      createElement: () => ({ setAttribute() {}, classList: { add() {} } }) },
    addEventListener(k, f) { listeners[k] = f; },
    WizCore: { apps: () => ({ APPS: [{ id: 'messenger', name: 'Messenger' }, { id: 'notes', name: 'Notes' }] }) },
    WizAppServices: { update: { reloadPlan: () => ({ ok: !blocking.length, keeps: null, blocking, recording: blocking.some(b => b.kind === 'capture') }) } },
  };
  ctx.window = ctx; vm.runInNewContext(src, ctx);
  ctx.WizWebUpdate.init({ shell: 'phone', busy: () => host, toast: (i, m) => toasts.push(m), log: (...a) => logs.push(a.join(' ')) });
  return { api: ctx.WizWebUpdate, toasts, logs, reloads: () => reloads, advance: ms => { t += ms; } };
}
const flush = () => new Promise(r => setTimeout(r, 0));

test('an app work hold names the app, and a second tap reloads anyway', async () => {
  const w = load([{ appId: 'messenger', kind: 'work', reason: 'Messenger unsent work' }]);
  assert.equal(w.api.reload('tap'), false);
  assert.match(w.toasts.at(-1), /^Messenger is still saving · tap Reload again to reload anyway$/);
  assert.equal(w.api.reload('tap'), true);
  await flush(); await new Promise(r => setTimeout(r, 500)); // the tap burst waits 450 ms before reloading
  assert.equal(w.reloads(), 1);
  assert.ok(w.logs.some(l => l.startsWith('web:reload-anyway messenger') || l.includes('reload-anyway')));
});

test('the override expires: a second tap after 8 s only warns again', () => {
  const w = load([{ appId: 'messenger', kind: 'work', reason: 'x' }]);
  w.api.reload('tap'); w.advance(9000);
  assert.equal(w.api.reload('tap'), false);
  assert.equal(w.toasts.length, 2);
  assert.equal(w.reloads(), 0);
});

test('two apps are both named', () => {
  const w = load([{ appId: 'messenger', kind: 'work', reason: 'x' }, { appId: 'notes', kind: 'work', reason: 'y' }]);
  w.api.reload('tap');
  assert.match(w.toasts.at(-1), /^Messenger and Notes are still saving · tap Reload again/);
});

test('a recording is never overridden, however often Reload is tapped', () => {
  const w = load([{ appId: 'messenger', kind: 'capture', reason: 'Recording' }]);
  // A recording is armable (reloads when it ends), so the second tap cancels instead of forcing.
  w.api.reload('tap'); w.api.reload('tap'); w.api.reload('tap');
  assert.equal(w.reloads(), 0);
});

test("the shell's own busy work (uploads, voice) is never overridden", () => {
  const w = load([{ appId: 'messenger', kind: 'work', reason: 'x' }], { host: true });
  w.api.reload('tap'); w.api.reload('tap');
  assert.equal(w.reloads(), 0);
  assert.match(w.toasts.at(-1), /Finish recording or save your work first/);
});

test('nothing holding: Reload reloads on the first tap', async () => {
  const w = load([]);
  assert.equal(w.api.reload('tap'), true);
  await new Promise(r => setTimeout(r, 500));
  assert.equal(w.reloads(), 1);
});
