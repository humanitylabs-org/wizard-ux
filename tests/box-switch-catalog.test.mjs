// Box-side feature switches read by wizard-app-manager (wam/feature_switches.py) can only be turned on when this
// shell's catalog lists them: `set_switch` refuses any id that is not a catalog tweak. Keep each one listed, off by
// default, with a manifest whose id matches. wizard-ux#974: wizard/link-token-repair was missing, so the agent's
// gateway-token repair (wizard-app-manager#497) could never be turned on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../web/tweaks/', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('catalog.json', root), 'utf8'));
const BOX_SWITCHES = ['wizard/update-bug-reports', 'wizard/app-updates-list', 'wizard/link-token-repair', 'wizard/graceful-restart'];

for (const id of BOX_SWITCHES) {
  test(`${id} is a switch the App Manager accepts, off by default`, () => {
    assert.ok(catalog.tweaks.includes(id), `${id} missing from catalog.json tweaks`);
    assert.ok(!(catalog.defaults || []).includes(id), `${id} must stay off by default`);
    const manifest = JSON.parse(readFileSync(new URL(`${id}/manifest.json`, root), 'utf8'));
    assert.equal(manifest.id, id);
    assert.ok(!manifest.view, 'a shell view is not a feature switch');
  });
}
