import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { withShellParts } from './fixtures/shell-parts.mjs';
const require = createRequire(import.meta.url), fx = require('../tools/qa-proof-fixture.cjs');
const read = name => withShellParts(readFileSync(new URL('../' + name, import.meta.url), 'utf8'));

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

test('offline proof requires the rendered mic and nonzero geometry without weakening pointer checks', async () => {
  // the proof script's own steps (qa/scripts/qa-offline-popup.cjs), run against a fake page
  const source = readFileSync(new URL('../qa/scripts/qa-offline-popup.cjs', import.meta.url), 'utf8');
  const lineOf = k => { const i = source.indexOf(k); if (i < 0) return `throw new Error(${JSON.stringify('missing step: ' + k)})`; return source.slice(source.lastIndexOf('\n', i) + 1, source.indexOf('\n', i)); };
  const steps = (phone, page, WizConfig) => vm.runInNewContext(`(async () => {\n${lineOf('await page.waitForFunction(() => WizConfig.live')}\n${lineOf("await page.locator(phone ? '#orb' : '#micBtn').waitFor(")}\n${lineOf('await page.mouse.click(')}\n})()`, { phone, page, WizConfig });
  for (const phone of [true, false]) {
    const log = [], box = { x: 10, y: 20, width: 40, height: 60 };
    const page = { waitForFunction: async fn => log.push(['ready', fn()]), locator: sel => ({ waitFor: async o => log.push(['wait', sel, o.state]), boundingBox: async () => box }), mouse: { click: async (x, y) => log.push(['click', x, y]) } };
    await steps(phone, page, { live: true, has: k => k === 'voice' });
    const sel = phone ? '#orb' : '#micBtn';
    assert.deepEqual(log, [['ready', true], ['wait', sel, 'visible'], ['click', 30, 50]], 'the rendered mic, then a real pointer at its centre');
    const off = []; await steps(phone, { ...page, waitForFunction: async fn => off.push(fn()) }, { live: true, has: () => false });
    assert.deepEqual(off, [false], 'a box without voice is not ready');
  }
  // the hit test itself: nonzero geometry, the orb (or its wrap) under its own centre, never the offline card
  const geo = source.slice(source.indexOf('const geometry = await page.evaluate(') + 'const geometry = await page.evaluate('.length, source.indexOf('}, phone);', source.indexOf('const geometry = await page.evaluate(')) + 1);
  const run = ({ w = 40, h = 60, hit = 'orb', cardInWrap = false } = {}) => {
    const el = (id, parent = null) => ({ id, tagName: 'DIV', parent, contains(n) { for (; n; n = n.parent) if (n === this) return true; return false; }, closest(s) { for (let n = this; n; n = n.parent) if ('#' + n.id === s) return n; return null; } });
    const wrap = el('orbWrap'), orb = el('orb', wrap), card = el('card', cardInWrap ? wrap : null), inner = el('cardText', card); card.parentElement = { getAttribute: () => 'false' };
    orb.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: h, bottom: h });
    card.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 50, bottom: 50 });
    const document = { querySelector: s => (s === '.wx-off-card' ? card : s === '#orb' || s === '#micBtn' ? orb : null), elementFromPoint: () => ({ orb, wrap, card: inner }[hit] || null) };
    return vm.runInNewContext(`(${geo})(true)`, { document, getComputedStyle: () => ({ backgroundColor: 'rgb(0, 0, 0)' }), JSON }).orbHit;
  };
  assert.equal(run(), true); assert.equal(run({ hit: 'wrap' }), true, '#orbWrap legitimately owns the hit');
  assert.equal(run({ w: 0 }), false, 'an unrendered orb fails'); assert.equal(run({ h: 0 }), false);
  assert.equal(run({ hit: 'card' }), false, 'the card covering it fails'); assert.equal(run({ hit: 'card', cardInWrap: true }), false, 'even a card drawn inside the orb\'s wrap'); assert.equal(run({ hit: 'none' }), false);
});
