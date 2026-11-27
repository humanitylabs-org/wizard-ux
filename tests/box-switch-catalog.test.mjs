// Box-side feature switches read by wizard-app-manager (wam/feature_switches.py) can only be turned on when this
// shell's catalog lists them: `set_switch` refuses any id that is not a catalog tweak. Keep each one listed, off by
// default, with a manifest whose id matches. wizard-ux#974: wizard/link-token-repair was missing, so the agent's
// gateway-token repair (wizard-app-manager#497) could never be turned on.
// Runs the real Settings › Look switch list (web/core/experience.js on a fresh device, tests/fixtures/w1-experience.mjs):
// the switch is one of this release's tweak ids, installed with its own manifest, offered as an off, non-built-in,
// non-view row, not running, and turning it on runs it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDevice } from './fixtures/w1-experience.mjs';

const BOX_SWITCHES = ['wizard/update-bug-reports', 'wizard/link-token-repair', 'wizard/graceful-restart', 'wizard/private-first-setup', 'wizard/interface-manual', 'wizard/plain-chat-titles', 'wizard/try-feature-counts', 'wizard/chat-tags', 'wizard/channel-auto-emoji', 'wizard/phone-tester-builds', 'wizard/phone-chat-replies', 'wizard/agent-approvals', 'wizard/install-agent-builds', 'wizard/private-mode', 'wizard/backup-health', 'wizard/private-routing', 'wizard/result-reader', 'wizard/first-chat-goals', 'wizard/catch-me-up'];

for (const id of BOX_SWITCHES) {
  test(`${id} is a switch the App Manager accepts, off by default`, async () => {
    const d = freshDevice();
    assert.ok((await d.E.tweakIds()).includes(id), `${id} is not a switch this release offers`);
    assert.ok(!(id in d.E.defaultChoices), `${id} must not be a release-wide default`);
    const { manifest, row, running } = await d.listing(id);
    assert.equal(manifest?.id, id, 'installed with a manifest whose id matches');
    assert.ok(!manifest.view, 'a shell view is not a feature switch');
    assert.ok(row, 'Settings › Look offers it');
    assert.equal(row.on, false, 'off by default'); assert.equal(row.builtin, false); assert.equal(row.view, '');
    assert.equal(running, false, 'not running on a fresh device');
    await d.E.toggle(id);
    assert.ok(d.active().includes(id), 'turned on, it runs');
  });
}
