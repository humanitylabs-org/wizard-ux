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
