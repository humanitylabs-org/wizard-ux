import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
for (const shell of ['phone', 'desktop']) test(`${shell}: a nested app link cannot bypass required setup or lose its path`, () => {
  const file = shell === 'phone' ? '../web/app.js' : '../web/desktop/desktop.js';
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const name = shell === 'phone' ? 'openLinkDesk' : 'openAppLink';
  const start = source.indexOf(`  function ${name}(`), end = shell === 'phone' ? source.indexOf('  /* ---------------- bound views', start) : source.indexOf('  window.WosAppSetup?.init', start);
  assert(start >= 0 && end > start);
  const created = [], app = { id: 'recorder', name: 'Recorder', url: '/apps/recorder/' };
  let continuation, checks = 0;
  const ctx = { URL, location: { href: 'https://fixture.invalid/', origin: 'https://fixture.invalid' },
    W: {}, desks: [{ focus: null }], idx: 0, appAt: () => app, fromOf: () => ({ win: 'source' }),
    openWin: x => { created.push(x); return x; }, newWin: x => { created.push(x); return x; },
    WosAppSetup: { gate(a, resume) { assert.equal(a.id, app.id); checks++; continuation = resume; return true; } } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source.slice(start, end), ctx);
  const url = '/apps/recorder/history?recording=synthetic#details';
  assert.equal(ctx[name](url, null), true); assert.equal(checks, 1); assert.equal(created.length, 0);
  // Back/cancel simply discards the continuation: no app is constructed beforehand.
  continuation(); assert.equal(checks, 1); assert.equal(created.length, 1);
  assert.equal(created[0].url, url); assert.equal(created[0].appId, app.id);
});
