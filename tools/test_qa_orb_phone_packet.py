import importlib.util
import hashlib
import io
import os
import json
from pathlib import Path
import tempfile
import tarfile
import unittest
from unittest import mock
import zipfile

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('orb_packet', HERE / 'qa_orb_phone_packet.py')
assert spec and spec.loader
packet = importlib.util.module_from_spec(spec); spec.loader.exec_module(packet)
spec2 = importlib.util.spec_from_file_location('orb_native', HERE / 'qa_orb_release_native.py')
assert spec2 and spec2.loader
native = importlib.util.module_from_spec(spec2); spec2.loader.exec_module(native)


class PacketTests(unittest.TestCase):
    def verify_synthetic_job(self, signing, owner, env, signed=True):
        # Exercise the production validator; only filesystem/archive seams are fake.
        payload = b'synthetic validator source'
        digest = hashlib.sha256(payload).hexdigest()
        cfg = dict(host='forum', java='21', cap_sync=False,
                   tasks=packet.SIGNED_TASKS if signed else packet.DEBUG_TASKS,
                   expected_signer=packet.SIGNER if signed else None,
                   signing_env=signing, owner_config=owner,
                   revision='synthetic-revision', manifest_sha256='synthetic-manifest',
                   files={'tools/qa_orb_phone_packet.py': {'sha256': digest}})
        entry = dict(revision=cfg['revision'], manifest_sha256=cfg['manifest_sha256'],
                     files={'job.json': digest, 'source.tar.gz': digest})
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode='w:gz') as tar:
            member = tarfile.TarInfo('tools/qa_orb_phone_packet.py')
            member.size = len(payload)
            tar.addfile(member, io.BytesIO(payload))
        archive.seek(0)
        with tarfile.open(fileobj=archive, mode='r:gz') as tar:
            with mock.patch.dict(os.environ, env, clear=True), \
                 mock.patch.object(Path, 'is_symlink', return_value=False), \
                 mock.patch.object(Path, 'read_text', return_value=json.dumps(cfg)), \
                 mock.patch.object(packet, 'sha', return_value=digest), \
                 mock.patch.object(packet.tarfile, 'open', return_value=tar):
                return packet.verify_job('/srv/work/AndroidBuilds/jobs/synthetic', entry, signed)

    def test_signed_config_other_administrator(self):
        signing = '/home/build-admin/secure/signing.env'
        owner = '/home/build-admin/secure/owner.properties'
        result = self.verify_synthetic_job(signing, owner, {
            'WIZARD_SIGNING_ENV': signing, 'WIZARD_OWNER_CONFIG': owner})
        self.assertEqual(result['signing_env'], signing)
        self.assertEqual(result['owner_config'], owner)

    def test_signed_config_spaces(self):
        signing = '/srv/build/private config/signing env'
        owner = '/srv/build/private config/owner properties'
        self.verify_synthetic_job(signing, owner, {
            'WIZARD_SIGNING_ENV': signing, 'WIZARD_OWNER_CONFIG': owner})

    def test_signed_config_must_match_trusted_environment(self):
        signing, owner = '/srv/build/signing.env', '/srv/build/owner.properties'
        env = {'WIZARD_SIGNING_ENV': signing, 'WIZARD_OWNER_CONFIG': owner}
        for actual_signing, actual_owner in [('/srv/build/other.env', owner),
                                             (signing, '/srv/build/other.properties'),
                                             (None, owner), (signing, None)]:
            with self.subTest(signing=actual_signing, owner=actual_owner):
                with self.assertRaises(AssertionError):
                    self.verify_synthetic_job(actual_signing, actual_owner, env)

    def test_signed_config_rejects_missing_empty_relative_environment(self):
        for key in ['WIZARD_SIGNING_ENV', 'WIZARD_OWNER_CONFIG']:
            for invalid in [None, '', 'relative/config', '   ']:
                with self.subTest(key=key, invalid=invalid):
                    env = {'WIZARD_SIGNING_ENV': '/srv/build/signing.env',
                           'WIZARD_OWNER_CONFIG': '/srv/build/owner.properties'}
                    if invalid is None:
                        del env[key]
                    else:
                        env[key] = invalid
                    with self.assertRaises(AssertionError):
                        self.verify_synthetic_job(env.get('WIZARD_SIGNING_ENV'),
                                                  env.get('WIZARD_OWNER_CONFIG'), env)

    def test_debug_config_none_regardless_of_environment(self):
        for env in [{}, {'WIZARD_SIGNING_ENV': '/srv/build/signing.env',
                         'WIZARD_OWNER_CONFIG': '/srv/build/owner.properties'},
                    {'WIZARD_SIGNING_ENV': '', 'WIZARD_OWNER_CONFIG': 'relative'}]:
            with self.subTest(env=env):
                self.verify_synthetic_job(None, None, env, signed=False)
                for signing, owner in [('/srv/build/signing.env', None),
                                       (None, '/srv/build/owner.properties'), ('', None), (None, '')]:
                    with self.subTest(signing=signing, owner=owner):
                        with self.assertRaises(AssertionError):
                            self.verify_synthetic_job(signing, owner, env, signed=False)

    def test_scopes(self):
        self.assertEqual(packet.SIGNED_TASKS, [':app:assembleRelease', ':app:testReleaseUnitTest', ':app:lintRelease'])
        self.assertEqual(packet.DEBUG_TASKS, [':app:assembleDebug'])
        self.assertEqual(packet.SIGNER, native.SIGNER)

    def test_focused_files_exist(self):
        source = HERE.parent
        for name in ['orb-render-recovery', 'orb-icon-core', 'owner-skins-guard', 'manager-orb-route']:
            self.assertTrue((source / 'tests' / (name + '.test.mjs')).is_file())

    def test_actual_control_window_names(self):
        java = (HERE.parent / 'android/app/src/main/java/ai/wizards/os/everywhere/EverywhereService.java').read_text()
        qa = (HERE / 'qa_orb_release_native.py').read_text()
        for name in ['WizardEverywhere', 'WizOrbCtl-pause', 'WizOrbCtl-cancel']:
            self.assertIn('"' + name + '"', java)
            self.assertIn("'" + name + "'", qa)

    def test_packaged_asset_binding(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d); source = p / 'source'; assist = source / 'android/app/src/main/assets/assist'
            assist.mkdir(parents=True); (source / 'web').mkdir()
            (assist / 'orb.js').write_bytes(b'exact renderer'); (source / 'web/orb.js').write_bytes(b'exact renderer')
            apk = p / 'one.apk'
            with zipfile.ZipFile(apk, 'w') as z: z.write(assist / 'orb.js', 'assets/assist/orb.js')
            native.check_assets(apk, source)
            (assist / 'orb.js').write_bytes(b'drift')
            with self.assertRaises(AssertionError): native.check_assets(apk, source)

    def test_junit_complete_and_no_skip(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d); results = p / 'source/android/app/build/test-results/testReleaseUnitTest'; results.mkdir(parents=True)
            x = results / 'TEST-case.xml'; x.write_text('<testsuite tests="392" failures="0" errors="0" skipped="0"/>')
            self.assertEqual(packet.junit_counts(p)['tests'], 392)
            x.write_text('<testsuite tests="392" failures="0" errors="0" skipped="1"/>')
            with self.assertRaises(AssertionError): packet.junit_counts(p)

    def test_native_capture_requires_later_review(self):
        source = (HERE / 'qa_orb_release_native.py').read_text()
        self.assertIn('Parent must visually inspect', source)
        self.assertNotIn('from PIL', source)
        self.assertNotIn('setWebContentsDebuggingEnabled', source)


if __name__ == '__main__': unittest.main()
