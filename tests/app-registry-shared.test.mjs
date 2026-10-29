// James, 26 Oct 2026: "App is really buggy, crashing and messages not sending." WizCore.apps(shell) built a new
// registry per call; each build fired 'wizard:apps' and stayed subscribed, so the home-screen icon refresh
// (which calls apps('mobile') on every 'wizard:apps') looped ~10x/s, leaked listeners until Android killed the
// app, and dragged the Notifications count poll to ~50 req/s. Each shell gets one shared registry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../web/core/apps.js', import.meta.url), 'utf8');

function boot() {
  let events = 0;
  const store = new Map();
  const win = {
    WizCore: {}, location: { origin: 'http://x', pathname: '/' },
    addEventListener() {}, removeEventListener() {},
    dispatchEvent(e) { if (e.type === 'wizard:apps') events++; return true; },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  };
  const ctx = { window: win, document: { addEventListener() {}, hidden: false }, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    localStorage: win.localStorage, location: win.location, addEventListener() {}, fetch: async () => ({ ok: false }), setTimeout, clearTimeout, console };
  ctx.self = win; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { win, events: () => events };
}

test('apps(shell) returns one shared registry and does not re-announce on lookup', () => {
  const { win, events } = boot();
  const a = win.WizCore.apps('mobile');
  const after = events();
  for (let i = 0; i < 50; i++) assert.equal(win.WizCore.apps('mobile'), a);
  assert.equal(events(), after, 'looking up the registry must not dispatch wizard:apps');
  assert.notEqual(win.WizCore.apps('desktop'), a);
});
