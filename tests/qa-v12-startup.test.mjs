import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), fx = require('../tools/qa-proof-fixture.cjs');
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('synthetic bootstrap enables the real desktop mic capability rule before hit testing', async () => {
 const ctx = { Date, Intl, performance, URL, CustomEvent: class {}, document: { addEventListener() {} },
  location: new URL(fx.ORIGIN + '/wizard-os-home/desktop.html'),
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, dispatchEvent() {},
  fetch: async url => { const r = fx.response(url); return new Response(r.body, { status: r.status }); } };
 ctx.window = ctx;
 vm.runInNewContext(read('web/core/config.js'), ctx); await ctx.WizConfig.ready;
 assert.equal(ctx.WizConfig.live, true);
 assert.equal(ctx.WizConfig.has('voice'), true, 'missing capabilities.voice hides #micBtn');
 assert.equal(ctx.WizConfig.endpoint('transcribe'), '/wizard/voice/transcribe');
 const mic = { hidden: false };
 ctx.$ = selector => { assert.equal(selector, '#micBtn'); return mic; };
 const rule = read('web/desktop/desktop.js').match(/const paintVoiceCapability = [^\n]+/)[0];
 vm.runInNewContext(rule + '\npaintVoiceCapability();', ctx);
 assert.equal(mic.hidden, false);
 // The same real production rule must still hide the mic when voice is unavailable.
 ctx.WizConfig.has = () => false;
 vm.runInNewContext('paintVoiceCapability();', ctx); assert.equal(mic.hidden, true);
});

test('v11 refused startup paths have typed, stable synthetic answers; neighbours and writes stay refused', () => {
 fx.resetRefusals();
 const version = fx.response('/wizard-os-home/ux-version.txt');
 assert.equal(version.status, 200); assert.equal(version.contentType, 'text/plain');
 assert.match(version.body.trim(), /^[0-9a-f]{40}$/);
 assert.equal(fx.response('/wizard-os-home/ux-version.txt').body, version.body);
 const overview = fx.read('/backup/api/overview');
 assert.equal(typeof overview.backup, 'object'); assert.equal(overview.backup.configured, false);
 assert.equal(overview.active, null);
 assert.equal(fx.refused().length, 0);
 for (const p of ['/backup/api/other', '/wizard-os-home/other.txt']) assert.equal(fx.response(p).status, 451);
 for (const p of ['/backup/api/overview', '/wizard-os-home/ux-version.txt']) assert.equal(fx.response(p, 'POST').status, 451);
 fx.resetRefusals();
});

test('offline proof requires the rendered mic and nonzero geometry without weakening pointer checks', () => {
 const source = read('qa-offline-popup.cjs');
 assert.match(source, /WizConfig\.live && WizConfig\.has\('voice'\)/);
 assert.match(source, /locator\(phone \? '#orb' : '#micBtn'\)\.waitFor\(\{ state: 'visible' \}\)/);
 assert.match(source, /r\.width > 0 && r\.height > 0/);
 assert.match(source, /document\.elementFromPoint/);
 assert.match(source, /assert\.ok\(geometry\.orbHit/);
 assert.match(source, /page\.mouse\.click/);
});
