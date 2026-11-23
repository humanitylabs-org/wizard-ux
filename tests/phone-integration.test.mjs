import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

// static-rule: published storage names and the version floor are a frozen inventory: renaming one loses owners' vault data
test('phone version stays at or above the Settings-style ID release (0.10.15/79) and preserves published vault storage names', () => {
  const gradle = read('android/app/build.gradle');
  assert.ok(Number(gradle.match(/versionCode (\d+)/)[1]) >= 79);
  const vault = read('android/app/src/main/java/ai/wizards/os/vault/VaultBridge.java');
  assert.match(read('android/app/src/main/java/ai/wizards/os/vault/VaultSlots.java'), /KEY_PREFIX = "wos-vault-v1-"/);
  assert.match(vault, /getSharedPreferences\("wizard-vault",/);
});

// static-rule: published storage names are a frozen inventory: the agent and owner identities never share a store
test('published agent-name identity and owner signing identity have distinct storage', () => {
  const agent = read('android/app/src/main/java/ai/wizards/os/device/WizardIdentity.java');
  const owner = read('android/app/src/main/java/ai/wizards/os/identity/KeyVault.java');
  assert.match(agent, /package ai\.wizards\.os\.device;/);
  assert.match(agent, /PREFS = "wizard-identity"/);
  assert.match(agent, /fromBootstrap\(JSONObject bootstrap\)/);
  assert.match(owner, /package ai\.wizards\.os\.identity;/);
  assert.match(owner, /getSharedPreferences\("wizard-id-v1",/);
  assert.match(owner, /ALIAS = "wizard-id-owner-wrap-v1"/);
  assert.doesNotMatch(owner, /"wizard-identity"|"wizard-vault"|"wos-vault-v1-"/);
});

test('signed release gate pins the published upgrade baseline and WizardOS signing env', () => {
  // Run the real gate's validate() and constants in Python (tools/qa_phone_release.py), with a throwaway HOME.
  const home = mkdtempSync(join(tmpdir(), 'r6a-home-'));
  const probe = `
import json, sys
sys.path.insert(0, 'tools')
import qa_phone_release as g
from pathlib import Path
good = {'revision': 'abc', 'expected_signer': g.SIGNER, 'signing_env': str(Path.home() / '.hermes/secure/wizard-os/signing.env'), 'tasks': [':app:assembleRelease']}
def why(c):
    try:
        g.validate(c, 'abc'); return 'ok'
    except ValueError as e:
        return str(e)
print(json.dumps({'old': g.OLD_SHA, 'good': why(good), 'otherEnv': why(dict(good, signing_env='/tmp/other/signing.env')), 'noEnv': why({k: v for k, v in good.items() if k != 'signing_env'}), 'drift': why(dict(good, revision='zzz'))}))
`;
  const out = JSON.parse(execFileSync('python3', ['-c', probe], { cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, HOME: home }, encoding: 'utf8' }));
  assert.equal(out.old, '643a68d497166ed5c4164b65f9bc1c1d06cb65c42d156ab78df7baa65ca5d76b', 'the published 0.10.11 baseline APK');
  assert.equal(out.good, 'ok', 'the WizardOS signing env under ~/.hermes/secure passes');
  assert.equal(out.otherEnv, 'WizardOS WOS_* signing configuration required');
  assert.equal(out.noEnv, 'WizardOS WOS_* signing configuration required');
  assert.equal(out.drift, 'prepared revision drift');
  // main() itself, run with the worker lease, the work volume, the build and the device faked: the build must be
  // 0.10.12 (76) and the upgrade step from the pinned 0.10.11 runs only then.
  const mainProbe = `
import json, sys, os, tempfile
sys.path.insert(0, 'tools')
import qa_phone_release as g
from pathlib import Path
root = Path(tempfile.mkdtemp())
def go(vn, vc):
    job = root / ('job-' + vn + '-' + str(vc)); (job / 'source').mkdir(parents=True)
    (job / 'job.json').write_text(json.dumps({'revision': 'abc', 'expected_signer': g.SIGNER, 'signing_env': str(Path.home() / '.hermes/secure/wizard-os/signing.env'), 'tasks': [':app:assembleRelease'], 'manifest_sha256': 'm'}))
    old = root / 'old.apk'; old.write_bytes(b'x'); out = root / ('out-' + vn + '-' + str(vc))
    class R: returncode = 0
    def fake_run(argv, **kw):
        if argv[1].endswith('worker.py'):
            (job / 'receipt.json').write_text(json.dumps({'status': 'ok', 'source_revision': 'abc', 'source_manifest_sha256': 'm', 'artifacts': [{'aapt2': {'package': 'ai.wizards.os', 'version_name': vn, 'version_code': vc}, 'signer_sha256': g.SIGNER, 'path': 'app.apk', 'sha256': 'd'}]}))
        return R()
    g.subprocess.run = fake_run
    g.digest = lambda p: g.OLD_SHA if str(p).endswith('old.apk') else 'd'
    g.required_work_root = lambda: root; g.java_home = lambda: '/j'; g.android_sdk = lambda: '/a'
    sys.platform = 'darwin'; os.environ['WIZARD_HEAVY_LOCK_FD'] = '0'
    sys.argv = ['qa_phone_release.py', str(job), str(old), str(out), 'abc']
    err = None
    try: g.main()
    except AssertionError: err = 'wrong build'
    rec = json.loads((out / 'receipt.json').read_text())
    return {'err': err, 'steps': [x['name'] for x in rec['steps']], 'ok': rec['ok']}
print(json.dumps({'good': go('0.10.12', 76), 'name': go('0.10.13', 76), 'code': go('0.10.12', 77)}))
`;
  const runs = JSON.parse(execFileSync('python3', ['-c', mainProbe], { cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, HOME: home }, encoding: 'utf8' }).trim().split('\n').at(-1));   // after main()'s PASS lines
  assert.deepEqual(runs.good, { err: null, steps: ['signed-release', 'signed-upgrade-0.10.11-to-0.10.12'], ok: true }, 'the 0.10.11 -> 0.10.12 upgrade step');
  for (const k of ['name', 'code']) assert.deepEqual(runs[k], { err: 'wrong build', steps: ['signed-release'], ok: false }, `expected build 0.10.12 (76): ${k}`);
});

// Not run here (wizard-ux issue 1674): this pinned Java/Swift source text and no JDK runs it in this suite. Device port wiring in AppsBridge/MainActivity; the message protocol runs in the JVM suite (DeviceMessageProtocolTest).
