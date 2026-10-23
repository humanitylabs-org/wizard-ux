import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {seeds} from '../tools/seed-skins.mjs';
const fake = createRequire(import.meta.url)('../tools/fake-skins-api.cjs');
const source = readFileSync(new URL('../web/core/skins-store.js', import.meta.url), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 5));
function boot({signer = false, info = null, sign = {denied: true}} = {}) {
  const fixture = fake(), bridgeCalls = [], s = {console, URL, TextDecoder, crypto, document: {documentElement: {dataset: {shell: 'phone'}}}, WosMySkin: {refresh: async () => {}, tryOn: () => () => {}},
    fetch: async (url, init = {}) => { const r = fixture.handle(url, init.method || 'GET', init.body ? JSON.parse(init.body) : {}); return {ok: r.status === 200, status: r.status, json: async () => JSON.parse(r.body), headers: {get: () => r.contentType}, arrayBuffer: async () => new TextEncoder().encode(r.body).buffer}; },
    WizCore: {bridge: {call: async (method, params) => {bridgeCalls.push({method, params}); if (method === 'identity.info') return info; if (method === 'identity.sign') return sign; }}}};
  s.window = s; if (signer) s.WizardNative = {postMessage() {}};
  vm.runInNewContext(source, s);
  const ctx = {render() {}, root: {querySelector() {return null;}}}, api = s.WosSkinStore;
  const click = (ls, rest = {}) => api.act(ctx, {closest: q => q === '[data-ls]' ? {dataset: {ls, ...rest}} : null});
  const input = (field, value) => api.input(ctx, {dataset: {lsField: field}, value});
  const html = () => api.html(ctx, '<b>Original picker</b>');
  const idle = async () => { for (let n = 0; n < 100; n++) { await tick(); if (!html().includes('aria-busy="true"')) return; } throw Error('Fixture did not settle'); };
  return {api, ctx, click, input, html, idle, fixture, bridgeCalls};
}
test('Store sorts featured first, escapes metadata and only embeds verified preview paths', async () => {
  const b = boot(); b.click('nav', {lsView: 'store'}); await b.idle();
  assert.ok(b.html().indexOf('Quiet Grove') < b.html().indexOf('>Paper<'));
  assert.equal(b.api._test.previewURL('https://evil.invalid/p.webp'), '');
  assert.equal(b.api._test.previewURL('/wizard/v1/skins/store/blob/' + 'a'.repeat(64)).length > 0, true);
  b.fixture.item.name = '<script>owner leak</script>'; // fixture mutation affects later fake reads only
  b.click('refresh'); for (let i = 0; i < 20 && !b.html().includes('&lt;script&gt;'); i++) await tick(); assert.doesNotMatch(b.html(), /<script>owner leak/); assert.match(b.html(), /&lt;script&gt;/);
});
test('Back unwinds detail -> Store -> Default -> outer settings, including pending work', async () => {
  const b = boot(); b.click('nav', {lsView: 'store'}); await b.idle(); b.click('detail', {lsA: b.fixture.a});
  assert.match(b.html(), /data-look-level="detail"/); assert.equal(b.api.back(b.ctx), true);
  assert.match(b.html(), /data-look-level="store"/); assert.equal(b.api.back(b.ctx), true);
  assert.match(b.html(), /Original picker/); assert.equal(b.api.back(b.ctx), false);
});
test('None/New/Add are read back; Add makes the copied skin active and displays provenance', async () => {
  const b = boot(); b.click('nav', {lsView: 'mine'}); await tick(); b.click('active', {lsId: ''}); await tick(); assert.equal(b.fixture.active, null);
  b.click('new'); b.input('name', 'My second skin'); b.click('submit'); await tick(); assert.match(b.html(), /My second skin/);
  b.click('nav', {lsView: 'store'}); await b.idle(); b.click('detail', {lsA: b.fixture.a}); b.click('add'); await tick();
  assert.equal(b.fixture.active, 'quiet-grove'); assert.match(b.html(), /forked from Quiet Grove/);
});
test('Browser cannot publish; native none offers setup; denied signature never POSTs publish', async () => {
  const browser = boot(); browser.click('nav', {lsView: 'mine'}); await tick(); assert.match(browser.html(), /disabled>Publish from your phone/); assert.equal(browser.bridgeCalls.length, 0);
  const none = boot({signer: true, info: {none: true}}); none.click('nav', {lsView: 'mine'}); await tick(); assert.match(none.html(), /Create your Wizard ID/);
  const b = boot({signer: true, info: {pubkey: 'a'.repeat(64)}}); b.click('nav', {lsView: 'mine'}); await tick(); b.click('publish', {lsId: 'my-skin'});
  assert.match(b.html(), /Publishing makes this skin public\. It can be copied and mirrored forever\./);
  b.input('name', 'Named before signing'); b.input('summary', 'A short summary'); b.click('submit'); await tick(); await tick();
  const sign = b.bridgeCalls.find(c => c.method === 'identity.sign'); assert.equal(sign.params.event.pubkey, 'a'.repeat(64)); assert.equal(sign.params.event.tags.find(t => t[0] === 'name')[1], 'Named before signing');
  assert.match(b.html(), /Signature denied\. Nothing was published\./); assert.equal(b.fixture.calls.filter(c => c.path.endsWith('/publish')).length, 0);
});
test('CSS-only seeds exactly regenerate, stay within limits, and omit executable/image packages', () => {
  const all = seeds(), exported = all.filter(s => !s.skipped); assert.deepEqual(exported.map(s => s.id), ['grove','tide','ember','signal','sepia']);
  for (const s of exported) {
    const css = readFileSync(new URL(`../seed/skins/${s.id}/skin.css`, import.meta.url), 'utf8'); assert.equal(css, s.css); assert.ok(Buffer.byteLength(css) <= 65536); assert.match(css, /html\[data-skin\]/); assert.doesNotMatch(css, /url\(|skin\.js|data-skin=["']/i);
    assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
    assert.deepEqual(JSON.parse(readFileSync(new URL(`../seed/skins/${s.id}/skin.json`, import.meta.url))), s.metadata);
  }
  assert.deepEqual(all.filter(s => s.skipped).map(s => s.id), ['novairecito','obsidian','obsidian-light','landscapes']);
});
