import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

const source = readFileSync(new URL('../web/core/app-services.js', import.meta.url), 'utf8');
function fixture() {
  let elapsed = 0, wall = 100000;
  const app = {location: new URL('https://fixture.invalid/wisdom/'), document: {}, addEventListener(){}, postMessage(){}};
  const frame = {tagName: 'IFRAME', src: app.location.href, isConnected: true, contentWindow: app, hasAttribute: () => false, addEventListener(){}, removeEventListener(){}};
  const window = {WizCore: {apps: () => ({APPS: [{id: 'wisdom', kind: 'wizard', url: '/wisdom/'}]})}, WizAppCapture: {reloadCheck: () => ({safe: true})}, dispatchEvent(){}};
  class ClockDate extends Date { static now() { return wall; } }
  vm.runInNewContext(source, {window, location: new URL('https://fixture.invalid/wizard-os-home/'), URL, crypto: {randomUUID}, performance: {now: () => elapsed}, Date: ClockDate, addEventListener(){}, setInterval(){}, setTimeout, clearTimeout, document: {readyState: 'loading', addEventListener(){}}, CustomEvent: class {}, navigator: {}});
  const host = window.WizAppServices;
  host.attach(frame, {appId: 'wisdom', path: '/wisdom/'});
  return {host, frame, api: host.connect(app, {}), advance(ms) { elapsed += ms; }, moveWall(ms) { wall += ms; }};
}

for (const elapsed of [1500, 1600]) test(`synchronous keeper finishing at ${elapsed}ms remains blocking`, async () => {
  const f = fixture();
  f.api.update.hold('Text draft', {keep() { f.advance(elapsed); return 'kept'; }});
  await f.host.update.keepDrafts();
  assert.equal(f.host.update.reloadPlan().ok, false);
  assert.equal(f.host.update.frames()[0].holds.length, 1);
});
test('in-budget keeper still confirms and frame-scoped preparation remains supported', async () => {
  const f = fixture();
  f.api.update.hold('Text draft', {keep() { f.advance(1499); return 'kept'; }});
  await f.host.update.keepDrafts(f.frame);
  assert.equal(f.host.update.reloadPlan().ok, true);
});
test('all keepers share a deadline and no later keeper starts after it expires', async () => {
  const f = fixture(); let laterCalls = 0;
  f.api.update.hold('First text draft', {keep() { f.advance(1501); return 'kept'; }});
  f.api.update.hold('Second text draft', {keep() { laterCalls++; return 'kept'; }});
  await f.host.update.keepDrafts();
  assert.equal(laterCalls, 0);
  assert.equal(f.host.update.reloadPlan().blocking.length, 2);
});
test('a delayed promise cannot confirm after the shared deadline', async () => {
  const f = fixture(); let finish;
  f.api.update.hold('Text draft', {keep: () => new Promise(resolve => { finish = resolve; })});
  const pending = f.host.update.keepDrafts();
  await Promise.resolve(); f.advance(1600); finish('kept'); await pending;
  assert.equal(f.host.update.reloadPlan().ok, false);
});
test('a backward wall-clock change cannot reopen an expired monotonic budget', async () => {
  const f = fixture();
  f.api.update.hold('Text draft', {keep() { f.advance(1600); f.moveWall(-100000); return 'kept'; }});
  await f.host.update.keepDrafts();
  assert.equal(f.host.update.reloadPlan().ok, false);
});
