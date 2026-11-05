import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const pinSource = fs.readFileSync(process.env.PIN_SOURCE || new URL('web/core/home-screen-apps.js', root), 'utf8');
const storeSource = fs.readFileSync(process.env.STORE_SOURCE || new URL('web/store/store.js', root), 'utf8');
const pinFunction = pinSource.slice(pinSource.indexOf('  async function iconPNG('), pinSource.indexOf('  async function show('));
const storeFunction = storeSource.slice(storeSource.indexOf('  function icon('), storeSource.indexOf('  function action('));
const svg = "url('data:image/svg+xml,%3Csvg%3E%3C/svg%3E')";
const brandURL = '/wizard-os-home/brand/apps/hermes.svg';
function sigils() {
  const logos = new Map();
  const window = { WizCore: { appLogo: id => logos.get(id) } };
  vm.runInNewContext(read('web/core/sigils.js'), { window });
  return { window, logos };
}
function fixture(a, { mask = svg, brandMask = `url('${brandURL}')`, missing = false, fail = false, width = 512, height = 512 } = {}) {
  const { window, logos } = sigils();
  logos.set(a.id, `/wizard-os-home/store-data/app-logo/${a.id}?v=0123456789abcdef`);
  const html = window.WizSigil.html(a), requests = [], canvases = [];
  class Image {
    naturalWidth = width; naturalHeight = height;
    set src(value) { this.url = value; requests.push(value); }
    async decode() { if (fail) throw new Error('synthetic decode failure'); }
  }
  const document = { createElement(tag) {
    assert.equal(tag, 'canvas');
    const ctx = { draws: [], fills: [], letters: [], drawImage(...args) { this.draws.push(args); }, fillRect(...args) { this.fills.push({ args, color: this.fillStyle, operation: this.globalCompositeOperation }); }, fillText(...args) { this.letters.push(args); } };
    const c = { getContext: () => ctx, ctx, toDataURL(type) { assert.equal(type, 'image/png'); return 'data:image/png;base64,synthetic'; } };
    canvases.push(c); return c;
  } };
  const properties = [];
  const glyph = { classList: { contains: c => html.includes(` ${c} `) } };
  const header = { querySelector: selector => { assert.equal(selector, '.sgi'); return missing ? null : glyph; } };
  const iconPNG = vm.runInNewContext(`(${pinFunction.trim()})`, { window, document, Image, getComputedStyle: () => ({ getPropertyValue: key => { properties.push(key); return key === '--sgb' ? brandMask : mask; } }) });
  return { window, html, requests, canvases, properties, run: () => iconPNG(a, header) };
}
function assertTint(f, a) {
  assert.equal(f.canvases.length, 2);
  assert.deepEqual(f.canvases[1].ctx.fills, [{ args: [0, 0, 192, 192], color: f.window.WizSigil.of(a).color, operation: 'source-in' }]);
  assert.deepEqual(f.canvases[0].ctx.draws[0], [f.canvases[1], 0, 0]);
  assert.deepEqual(f.canvases[0].ctx.letters, []);
}
test('brand-only Hermes aliases with cached logos pin existing brand, not logo or letter', async () => {
  for (const id of ['hermes-agent', 'hermes-frontend-3']) {
    const a = { id, name: 'Hermes' }, f = fixture(a);
    assert.equal(f.window.WizSigil.of(a).logo, undefined);
    assert.ok(f.html.includes('sgi sgb sgb-hermes ' + (id === 'hermes-agent' ? 'sg-spark' : 'sg-apps')));
    await f.run();
    assert.deepEqual(f.properties, ['--sgb']);
    assert.deepEqual(f.requests, [brandURL]);
    assert.deepEqual(f.canvases[1].ctx.draws[0].slice(1), [32, 32, 128, 128]);
    assertTint(f, a);
  }
});
test('every existing HOUSE+BRAND pin preserves house source, geometry and monochrome tint', async () => {
  const { window } = sigils();
  const ids = Object.keys(window.WizSigil.brand).filter(id => Object.hasOwn(window.WizSigil.house, id));
  assert.deepEqual(ids, [
    'wizard-cloudflare', 'wizard-claude', 'wizard-chatgpt', 'wizard-tinfoil', 'wizard-google', 'wizard-youtube-music',
  ]);
  for (const id of ids) {
    const a = { id, name: id }, f = fixture(a);
    await f.run();
    assert.deepEqual(f.properties, ['--sg']);
    assert.deepEqual(f.requests, ['data:image/svg+xml,%3Csvg%3E%3C/svg%3E']);
    assert.deepEqual(f.canvases[1].ctx.draws[0].slice(1), [32, 32, 128, 128]);
    assertTint(f, a);
  }
});
test('explicit glyph on a brand-only identity still pins its existing glyph', async () => {
  const a = { id: 'hermes-agent', name: 'Hermes', icon: 'files' }, f = fixture(a);
  await f.run(); assert.deepEqual(f.properties, ['--sg']); assertTint(f, a);
});
test('same-origin custom SVG mask suppresses cached logo and keeps SVG draw geometry', async () => {
  const a = { id: 'mask-fixture', name: 'Mask', icon: '/fixture/icon.svg', colors: ['#123456'] };
  const f = fixture(a, { mask: "url('/fixture/icon.svg')" });
  assert.equal(f.window.WizSigil.of(a).logo, undefined); assert.match(f.html, /sgimg/);
  await f.run(); assert.deepEqual(f.requests, ['/fixture/icon.svg']);
  assert.deepEqual(f.canvases[1].ctx.draws[0].slice(1), [32, 32, 128, 128]); assertTint(f, a);
});
test('nonsquare PNG and WebP masks contain-fit, centre, and retain the existing tint', async () => {
  for (const [ext, width, height, geometry] of [['png', 400, 200, [32, 64, 128, 64]], ['webp', 200, 400, [64, 32, 64, 128]]]) {
    const a = { id: 'mask-fixture', name: 'Mask', icon: `/fixture/icon.${ext}` };
    const f = fixture(a, { mask: `url('${a.icon}')`, width, height }); await f.run();
    assert.deepEqual(f.requests, [a.icon]); assert.deepEqual(f.canvases[1].ctx.draws[0].slice(1), geometry); assertTint(f, a);
  }
});
test('existing data-SVG masks retain exact draw geometry, even with a raster-like suffix', async () => {
  const a = { id: 'messenger', name: 'Messenger' };
  for (const mask of [svg, "url('data:image/svg+xml,%3Csvg%3E%3C/svg%3E%23.png')"]) {
    const f = fixture(a, { mask, width: 400, height: 200 }); await f.run();
    assert.deepEqual(f.canvases[1].ctx.draws[0].slice(1), [32, 32, 128, 128]); assertTint(f, a);
  }
});
test('unbranded cached package logo keeps the unchanged cover path and PNG output', async () => {
  const a = { id: 'unknown-app', name: 'Unknown' }, f = fixture(a, { width: 400, height: 200 });
  assert.match(await f.run(), /^data:image\/png/);
  assert.deepEqual(f.requests, ['/wizard-os-home/store-data/app-logo/unknown-app?v=0123456789abcdef']);
  assert.deepEqual(f.properties, []); assert.equal(f.canvases.length, 1);
  assert.deepEqual(f.canvases[0].ctx.draws[0].slice(1), [-96, 0, 384, 192]);
  assert.deepEqual(f.canvases[0].ctx.letters, []);
});
test('missing glyph, empty mask, failed file and failed brand decode fall back without throwing', async () => {
  for (const options of [{ missing: true }, { mask: '' }, { mask: "url('/fixture/missing.svg')", fail: true }]) {
    const f = fixture({ id: 'mask-fixture', name: 'Mask', icon: '/fixture/missing.svg' }, options);
    assert.match(await f.run(), /^data:image\/png/); assert.deepEqual(f.canvases[0].ctx.letters, [['M', 96, 100]]); assert.equal(f.canvases.length, 1);
  }
  const f = fixture({ id: 'hermes-agent', name: 'Hermes' }, { fail: true });
  await f.run(); assert.deepEqual(f.requests, [brandURL]); assert.deepEqual(f.canvases[0].ctx.letters, [['H', 96, 100]]);
});
test('external, scheme, protocol-relative, query and fragment masks cause zero image loads', async () => {
  for (const url of ['https://untrusted.invalid/icon.svg', 'http://untrusted.invalid/icon.svg', '//untrusted.invalid/icon.svg', 'javascript:alert(1)', '/fixture/icon.svg?query=1', '/fixture/icon.png#fragment']) {
    // Override computed CSS only: exercise the rasterizer guard independently of the renderer's guard.
    for (const brand of [false, true]) {
      const a = brand ? { id: 'hermes-agent', name: 'Hermes' } : { id: 'mask-fixture', name: 'Mask', icon: '/fixture/icon.svg' };
      const f = fixture(a, { mask: `url('${url}')`, brandMask: `url('${url}')` }); await f.run();
      assert.deepEqual(f.requests, [], url); assert.equal(f.canvases[0].ctx.letters.length, 1, url);
    }
  }
});
function store(framed) {
  const { window } = sigils();
  const parent = { WizSigil: window.WizSigil };
  if (framed) window.WizSigil = { of() { throw new Error('must reuse hosted renderer'); } };
  return vm.runInNewContext(`(${storeFunction.trim()})`, { window, parent, framed, openId: () => '', hue: () => ['#123456', '#654321'], esc: String, DATA: '/store-data/' });
}
test('Store constructor is a valid unbranded catalog ID and retains its catalog logo in both contexts', () => {
  const declaration = storeSource.match(/const ID = (\/\^.*?\$\/);/);
  assert.ok(declaration, 'use the actual Store catalog ID validator');
  assert.equal(vm.runInNewContext(`${declaration[1]}.test('constructor')`), true);
  for (const framed of [false, true]) {
    const html = store(framed)({ id: 'constructor', name: 'Constructor', logo: true });
    assert.match(html, /<img src="\/store-data\/logo\/constructor"/); assert.doesNotMatch(html, /\bsgt\b/);
    const canonical = store(framed)({ id: 'hermes-agent', name: 'Hermes', logo: true });
    assert.match(canonical, /sgi sgb sgb-hermes/); assert.doesNotMatch(canonical, /<img/);
    const house = store(framed)({ id: 'messenger', name: 'Messenger', logo: true });
    assert.match(house, /sg-chats/); assert.doesNotMatch(house, /<img/);
  }
});
