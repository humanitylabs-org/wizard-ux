import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
  assert.match(client, /if \(framed\) \{ try \{ syncSkinLayer\(\);/, 'every appearance push re-syncs the layer');
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
