import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { parseCss, cascade } from './fixtures/mini-css.mjs';
import { between, block, runRecording } from './fixtures/source-slice.mjs';
import { scoped } from './fixtures/r5B-parts.mjs';
import { appClient } from './fixtures/app-client-harness.mjs';

// The shared app kit (James, 23 Oct 2026): one live wizard-ui.css served by the shell, skins layered after the app.
const kit = readFileSync(new URL('../web/kit/wizard-ui.css', import.meta.url), 'utf8');
const client = readFileSync(new URL('../web/core/app-client.js', import.meta.url), 'utf8');

// The real kit stylesheet through a small cascade (tests/fixtures/mini-css.mjs), on the markup an app writes.
const kitRules = parseCss(kit);
function kitEl(html, pick, media = () => false) { const doc = createDocument(); doc.body.innerHTML = html; return cascade(doc.body.querySelector(pick), kitRules, { media }); }
const values = won => Object.fromEntries(Object.entries(won).map(([k, v]) => [k, v.value]));

test('kit is look-only and names the real chat', () => {
  const row = values(kitEl('<div class="wz-app"><div class="wz-field-row"></div></div>', '.wz-field-row')), compose = values(kitEl('<div class="wz-app"><form class="wz-compose"></form></div>', '.wz-compose'));
  assert.equal(row.display, 'flex'); assert.deepEqual(compose, row, 'legacy class names keep their look');
  assert.doesNotMatch(kit, /\.ch-compose|composer:/i);
  // An app opens the real chat through the SDK instead of drawing its own composer (WizardApp.nav.openThread).
  const shell = []; const c = appClient({ service: { nav: { openThread: (id, o) => { shell.push([id, o]); return true; } } } });
  c.api.nav.openThread('s1', { draft: 'hi' }); assert.equal(shell.length, 1); assert.equal(shell[0][0], 's1');
});

// The app client's real skin layer (web/core/app-client.js skinSource + syncSkinLayer) in an app page framed by a
// mini-dom shell page.
function framedApp() {
  const shell = scoped(createDocument({ url: 'https://box.test/wizard-os-home/' })), page = scoped(createDocument({ url: 'https://box.test/wizard-music/' }));
  shell.head.innerHTML = '<link rel="stylesheet" href="/wizard-os-home/styles.css"><link rel="stylesheet" href="/wizard-os-home/core/skins.css?v=3"><link rel="stylesheet" data-skin-pkg="grove" href="/wizard-os-home/skins/grove/skin.css"><link rel="stylesheet" data-skin-pkg="old" disabled href="/wizard-os-home/skins/old/skin.css"><style id="wosMySkin">.wz-btn{color:red}</style>';
  for (const l of shell.head.querySelectorAll('link')) l.href = 'https://box.test' + l.getAttribute('href');
  page.head.innerHTML = '<link rel="stylesheet" href="vendor/wizard-ui.css"><style class="own">.app{}</style>';
  const cut = between(client, "  const KIT = '/wizard-os-home/kit/wizard-ui.css'", '  function applyTheme(a, layer) {');
  const ctx = runRecording(`${cut}\nthis.syncSkinLayer = syncSkinLayer;`, { document: page, parent: { document: shell }, location: new URL('https://box.test/wizard-music/'), opaque: false, URL });
  const heads = () => page.head.children.map(n => n.dataset.wzShared ? `${n.dataset.wzShared}:${new URL(n.href).pathname}` : n.localName === 'style' ? (n.dataset.wzMySkin !== undefined ? `mine:${n.textContent}` : 'own') : 'wzSkinLayer' in n.dataset ? `layer:${new URL(n.href).pathname}` : `vendored${n.disabled ? ':off' : ''}`);
  return { shell, page, ctx, heads };
}
test('hosted apps swap the vendored kit and layer the active skin after their own styles', () => {
  const a = framedApp();
  assert.equal(a.ctx.syncSkinLayer(), true);
  assert.deepEqual(a.heads(), ['vendored', 'tokens:/wizard-os-home/kit/wizard-tokens.css', 'kit:/wizard-os-home/kit/wizard-ui.css', 'own', 'layer:/wizard-os-home/core/skins.css', 'layer:/wizard-os-home/skins/grove/skin.css', 'mine:.wz-btn{color:red}'],
    'the shared kit beside the vendored one; core/skins.css, enabled skin packages, then My skin, after the app\'s own styles (a disabled package is not mirrored)');
  for (const l of a.page.head.querySelectorAll('[data-wz-shared]')) for (const h of l.listeners.load || []) h.f();
  assert.equal(a.heads()[0], 'vendored:off', 'the vendored copy goes once the shared kit and tokens load');
  a.shell.querySelector('[data-skin-pkg="grove"]').setAttribute('disabled', ''); a.shell.getElementById('wosMySkin').remove();
  a.ctx.syncSkinLayer(); assert.deepEqual(a.heads().slice(3), ['own', 'layer:/wizard-os-home/core/skins.css'], 'a skin change follows: gone package and My skin leave');
  // Every appearance push re-syncs the layer (applyTheme, framed).
  const synced = [], apply = runRecording(`${block(client, '  function applyTheme(a, layer) {')}\nthis.applyTheme = applyTheme;`, { VERSION: 1, TOKENS: ['bg'], framed: true, currentTheme: null, syncSkinLayer: l => synced.push(l), document: { documentElement: { style: { setProperty() {} }, dataset: {}, setAttribute() {} } }, window: {}, themes: [], notify() {}, dispatchEvent() {}, CustomEvent: class {} });
  for (const revision of [1, 2]) assert.equal(apply.applyTheme({ version: 1, revision, presentation: 'window', colorScheme: 'dark', skin: 'grove', tokens: { bg: '#000' } }, { n: revision }), true);
  assert.deepEqual(synced.map(l => l.n), [1, 2]);
});

// App design rules v0 (wizard-os#265, style/APP-DESIGN-RULES.md): the window is the page, one sheet that closes five ways.
test('kit follows the app design rules: no frame cap, container columns, the one sheet', () => {
  const frame = kitEl('<main class="wz-app"></main>', '.wz-app');
  assert.equal(frame['max-width'], undefined, 'rule 1: no max-width on the app frame');
  assert.equal(frame.container?.value, 'wz-app / inline-size', 'rule 2: layout follows the window, not the device');
  const grid = media => kitEl('<main class="wz-app"><div class="wz-grid"></div></main>', '.wz-grid', media)['grid-template-columns']?.value;
  assert.equal(grid(() => false), '1fr'); assert.equal(grid(m => m === '@container wz-app (min-width: 600px)'), 'repeat(2, minmax(0, 1fr))', 'two columns in a wide window');
  const sheet = media => kitEl('<dialog class="wz-sheet"></dialog>', '.wz-sheet', media).width?.value;
  assert.equal(sheet(() => false), 'min(520px, calc(100% - 24px))'); assert.equal(sheet(m => m === '@media (max-width: 599px)'), '100%', 'narrow windows get a bottom sheet');
  // The real sheet script (web/kit/wizard-sheet.js): grip and × added, closes by ×, Back and a swipe down on the grip.
  const doc = scoped(createDocument()), window = {};
  runRecording(readFileSync(new URL('../web/kit/wizard-sheet.js', import.meta.url), 'utf8'), { window });
  const mk = () => { const d = doc.createElement('dialog'); d.className = 'wz-sheet'; d.innerHTML = '<h2>T</h2>'; d.showModal = () => { d.open = true; }; d.close = () => { d.open = false; d.dispatchEvent({ type: 'close' }); }; doc.body.appendChild(d); return d; };
  const d1 = window.WzSheet.open(mk()); assert.equal(d1.open, true);
  assert.deepEqual(d1.children.map(c => c.className), ['wz-sheet-grip', 'wz-sheet-x', ''], 'grip and × added');
  d1.querySelector('.wz-sheet-x').click(); assert.equal(d1.open, false, '× closes');
  const d2 = window.WzSheet.open(mk()), d3 = window.WzSheet.open(mk());
  assert.equal(window.__wizardCloseOverlay(), true); assert.equal(d3.open, false); assert.equal(d2.open, true, 'Back closes the top sheet first');
  const grip = d2.querySelector('.wz-sheet-grip'); grip.setPointerCapture = () => {};
  const drag = dy => { for (const [type, y] of [['pointerdown', 0], ['pointermove', dy], ['pointerup', dy]]) grip.dispatchEvent({ type, clientY: y, pointerId: 1 }); };
  drag(40); assert.equal(d2.open, true, 'a short drag springs back'); drag(90); assert.equal(d2.open, false, 'swipe down on the grip closes');
  assert.equal(window.__wizardCloseOverlay(), false, 'nothing left open');
});

// Browser boundary (wizard-os#133): a sandboxed app cannot read the shell, so the layer comes with the theme. The app
// takes only same-origin stylesheet paths and a bounded My skin.
test('sandboxed app: the skin layer comes from the theme message, same-origin .css paths only', () => {
  const src = client.slice(client.indexOf('  function skinSource(layer) {'), client.indexOf('  function syncSkinLayer(layer) {'));
  const origin = 'https://box.example.ts.net';
  const g = { URL, opaque: true, location: { origin }, parent: { get document() { throw new Error('cross-origin'); } } };
  vm.createContext(g); vm.runInContext(src, g);
  const out = v => JSON.parse(JSON.stringify(g.skinSource(v)));
  assert.equal(g.skinSource(undefined), null, 'no layer: nothing to mirror, never reads the parent');
  assert.deepEqual(out({ sheets: ['/wizard-os-home/core/skins.css', '/wizard-os-home/skins/grove/skin.css?v=2', '/wizard-os-home/core/skins.css',
    'https://evil.example/x.css', '//evil.example/x.css', '/wizard-os-home/core/app.js', 7], mine: '.wz-btn{color:red}' }), {
    want: [origin + '/wizard-os-home/core/skins.css', origin + '/wizard-os-home/skins/grove/skin.css?v=2'], css: '.wz-btn{color:red}' });
  assert.equal(out({ sheets: [], mine: 'x'.repeat(65537) }).css, '', 'an oversized My skin is dropped');
  g.opaque = false;
  assert.equal(g.skinSource({ sheets: ['/wizard-os-home/core/skins.css'] }), null, 'same-origin apps read their parent, never the message');
});
