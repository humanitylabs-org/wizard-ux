import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// The shared app kit (James, 23 Oct 2026): one live wizard-ui.css served by the shell, skins layered after the app.
const kit = readFileSync(new URL('../web/kit/wizard-ui.css', import.meta.url), 'utf8');
const client = readFileSync(new URL('../web/core/app-client.js', import.meta.url), 'utf8');

test('kit is look-only and names the real chat', () => {
  assert.match(kit, /Rule 4: look only/);
  assert.match(kit, /WizardApp\.nav\.openThread/);
  assert.doesNotMatch(kit, /\.ch-compose|composer:/i);
  assert.match(kit, /\.wz-field-row, \.wz-compose/, 'legacy class names keep their look');
});

test('hosted apps swap the vendored kit and layer the active skin after their own styles', () => {
  assert.match(client, /const KIT = '\/wizard-os-home\/kit\/wizard-ui\.css'/);
  assert.match(client, /core\\\/skins\\\.css/);
  assert.match(client, /dataset\.skinPkg\)\.filter\(l => !l\.disabled\)/, 'disabled skin packages are not mirrored');
  assert.match(client, /getElementById\('wosMySkin'\)/, 'My skin is mirrored last');
  assert.match(client, /if \(framed\) \{ try \{ syncSkinLayer\(layer\);/, 'every appearance push re-syncs the layer');
});

// App design rules v0 (wizard-os#265, style/APP-DESIGN-RULES.md): the window is the page, one sheet that closes five ways.
test('kit follows the app design rules: no frame cap, container columns, the one sheet', () => {
  const frame = kit.match(/^\.wz-app \{[^}]*\}/m)[0];
  assert.doesNotMatch(frame, /max-width/, 'rule 1: no max-width on the app frame');
  assert.match(frame, /container: wz-app \/ inline-size/, 'rule 2: layout follows the window, not the device');
  assert.match(kit, /@container wz-app \(min-width: 600px\) \{ \.wz-grid/);
  assert.match(kit, /\.wz-sheet-x \{/);
  assert.match(kit, /@media \(max-width: 599px\) \{\n  \.wz-sheet \{ width: 100%/, 'narrow windows get a bottom sheet');
  const sheet = readFileSync(new URL('../web/kit/wizard-sheet.js', import.meta.url), 'utf8');
  assert.match(sheet, /window\.WzSheet = \{ open: show, close, wire \}/);
  assert.match(sheet, /window\.__wizardCloseOverlay = \(\) =>/, 'Back closes the top sheet first');
  assert.match(sheet, /if \(dy > 70\) close\(d\)/, 'swipe down on the grip closes');
});

// Browser boundary (wizard-os#133): a sandboxed app cannot read the shell, so the layer comes with the theme. The app
// takes only same-origin stylesheet paths and a bounded My skin.
test('sandboxed app: the skin layer comes from the theme message, same-origin .css paths only', () => {
  const src = client.slice(client.indexOf('  function skinSource(layer) {'), client.indexOf('  function syncSkinLayer(layer) {'));
  assert.ok(src.length > 100);
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
