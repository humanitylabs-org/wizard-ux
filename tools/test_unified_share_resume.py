"""Resume controller tests use labelled unit fixtures, never claim Android proof."""
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import qa_unified_share_release_packet as packet
import qa_unified_share_resume as resume


class ResumePacketTest(unittest.TestCase):
    def checkpoint(self) -> dict:
        return dict(status='FAIL', source_revision=resume.PRODUCT_REVISION,
                    phases=[dict(name=n, exit_code=0) for n in sorted(resume.PASSED_PHASES)] +
                           [dict(name='signed-upgrade-82', exit_code=1)],
                    release_junit=dict(tests=392, failures=0, errors=0, skipped=0),
                    signed_apk=dict(sha256=resume.APK_SHA256))

    def test_verified_checkpoint_only(self):
        prior = self.checkpoint()
        browser = dict(passed=30, failed=0)
        opacity = dict(checked=680, failures=0, see_through=[])
        resume.inherited_gates(prior, browser, opacity)
        for name in resume.PASSED_PHASES:
            changed = copy.deepcopy(prior)
            next(p for p in changed['phases'] if p['name'] == name)['exit_code'] = 1
            with self.subTest(phase=name), self.assertRaises(ValueError):
                resume.inherited_gates(changed, browser, opacity)
        for key, value in [('status', 'PASS'), ('source_revision', 'other'), ('release_junit', {}),
                           ('signed_apk', {}), ('phases', prior['phases'][:-1])]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                resume.inherited_gates(dict(prior, **{key: value}), browser, opacity)
        with self.assertRaises(ValueError):
            resume.inherited_gates(prior, dict(passed=29, failed=1), opacity)
        with self.assertRaises(ValueError):
            resume.inherited_gates(prior, browser, dict(checked=680, failures=1, see_through=[]))

    def test_product_projection_retains_hash_and_mode_and_no_tools(self):
        files = {'android/a': dict(sha256='a', mode=0o644), 'web/b': dict(sha256='b', mode=0o644),
                 'tools/a': dict(sha256='c', mode=0o755)}
        self.assertEqual(resume.product_files(files), {k: files[k] for k in ('android/a', 'web/b')})

    def exercise(self, native_failure=False):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as name:
            root = Path(name)
            native = root / 'native'; native.mkdir()
            (native / 'android-seal.json').write_text('{}')
            prior = root / 'prior'; (prior / 'evidence/screenshots').mkdir(parents=True)
            for skin in ('nebula', 'grove'):
                for sheet in ('share-sheet', 'share-picker'):
                    (prior / 'evidence/screenshots' / ('in-shell-' + skin + '-' + sheet + '.png')).write_bytes(b'UNIT SHOT, NOT IMAGE')
            apk = root / 'unit.apk'; apk.write_bytes(b'UNIT FIXTURE, NOT APK')
            apk_sha = hashlib.sha256(apk.read_bytes()).hexdigest()
            cfg = dict(revision='unit', prior_packet=str(prior), release_job=str(root / 'release'), node='/unit/node')
            commands = []
            upgrade_checks = ['owned emulator serial is absent', 'synthetic app data marker survives in-place update',
                              'published release upgrades in place with same UID',
                              'install preserves the exact pre-launch origin preferences', 'owner origin silently persisted',
                              'app update never signs the owner out (no Connect after offline upgrade)']

            class UnitProcess:
                def __init__(self, argv, **kw):
                    commands.append(argv)
                    self.pid = 123456789
                    self.returncode = 0
                    output = kw['stdout']
                    phase = Path(output.name).stem
                    if phase == 'signed-certificate':
                        output.write('Signer #1 certificate SHA-256 digest: ' + packet.SIGNER)
                    elif phase == 'signed-package':
                        output.write("package: name='ai.wizards.os' versionCode='86' versionName='0.10.22'")
                    elif phase == 'signed-upgrade-82':
                        (root / 'upgrade82').mkdir()
                        (root / 'upgrade82/emulator.log').write_text('UNIT LOG')
                        (root / 'upgrade82/device').mkdir()
                        (root / 'upgrade82/avd').mkdir()
                        (root / 'upgrade82/receipt.json').write_text(json.dumps(dict(ok=True,
                            checks=[dict(name=n, passed=True) for n in upgrade_checks])))
                    elif phase == 'synthetic-native-share':
                        out = native / 'android-evidence'; out.mkdir()
                        for home in ('android_avd_home', 'android_user_home', 'android_emulator_home'):
                            (out / home).mkdir()
                        (out / 'acceptance.json').write_text(json.dumps(dict(
                            status='FAIL' if native_failure else 'PASS_SYNTHETIC_ANDROID_DEBUG_ONLY',
                            emulator=dict(started=True, stopped=True, serial_absent=True, serial='emulator-5580'))))
                        if native_failure:
                            self.returncode = 1
                def poll(self):
                    return self.returncode

            with patch.object(resume, 'validate_inputs', return_value=apk), \
                 patch.object(resume, 'APK_SHA256', apk_sha), \
                 patch.object(resume.shutil, 'disk_usage', return_value=SimpleNamespace(free=300 * 1024**3)), \
                 patch.object(resume.subprocess, 'Popen', UnitProcess), \
                 patch.object(resume.subprocess, 'run', return_value=SimpleNamespace(stdout='List of devices attached\n')), \
                 patch.object(resume.signal, 'signal'), patch.object(packet, 'verify') as verify:
                if native_failure:
                    with self.assertRaisesRegex(RuntimeError, 'synthetic-native-share failed'):
                        resume.main(root, cfg, 'unit-seal', 999, packet)
                else:
                    self.assertEqual(resume.main(root, cfg, 'unit-seal', 999, packet), 0)
                    verify.assert_called_once_with(root, 'unit-seal')
            result = json.loads((root / 'acceptance.json').read_text())
            self.assertEqual([p['name'] for p in result['phases']],
                             ['signed-certificate', 'signed-package', 'signed-upgrade-82', 'synthetic-native-share'])
            self.assertTrue(result['cleanup']['avd_cleanup_safe'])
            self.assertEqual(result['cleanup_serials_checked'], ['emulator-5686', 'emulator-5580'])
            self.assertFalse((root / 'upgrade82/device').exists())
            self.assertFalse((native / 'android-evidence/android_avd_home').exists())
            self.assertFalse((root / 'gradle-user').exists())
            self.assertTrue((root / 'artifacts/wizard-os-0.10.22.apk').exists())
            self.assertFalse(any('worker.py' in arg or ':app:assembleRelease' in arg for cmd in commands for arg in cmd))
            self.assertEqual(result['status'] == 'FAIL', native_failure)
            with self.assertRaisesRegex(SystemExit, 'already executed'):
                resume.main(root, cfg, 'unit-seal', 999, packet)

    def test_resume_runs_only_remaining_gates_and_cleans_owned_homes(self):
        self.exercise()

    def test_failed_native_gate_keeps_signed_apk_and_cleans_owned_homes(self):
        self.exercise(native_failure=True)


if __name__ == '__main__':
    unittest.main()
