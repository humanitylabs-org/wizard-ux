"""Controller contracts only; no build, APK, emulator or owner data proof."""
import copy
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import qa_android_connect as qa


class SignedUpgradePreparationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=os.environ['TMPDIR'])
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.apk = self.root / 'source/artifact.apk'
        self.apk.parent.mkdir()
        self.apk.write_bytes(b'EXPLICIT UNIT FIXTURE, NOT AN APK')
        self.config = dict(origin='https://unit.invalid', candidate_version_code=84, candidate_version_name='0.10.20')
        self.receipt = dict(status='ok', job=str(self.root), artifacts=[dict(path='artifact.apk',
            sha256=hashlib.sha256(self.apk.read_bytes()).hexdigest(), signer_sha256=qa.SIGNER,
            aapt2=dict(package='ai.wizards.os', version_code='84', version_name='0.10.20'))])
        self.fields = dict(ORIGIN='https://unit.invalid', HOME_URL='https://unit.invalid/wizard-os-home/')

    def test_exact_artifact_controller_acceptance(self):
        with patch.object(qa, 'apk_build_config', return_value=self.fields):
            self.assertEqual(qa.signed_artifact(self.receipt, self.config), self.apk)

    def test_wrong_signature_bytes_version_and_receipt_refused(self):
        for key, value in [('signer_sha256', 'legacy-key'), ('sha256', 'wrong')]:
            receipt = copy.deepcopy(self.receipt); receipt['artifacts'][0][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                qa.signed_artifact(receipt, self.config)
        for key, value in [('version_code', '85'), ('version_name', '0.10.21')]:
            receipt = copy.deepcopy(self.receipt); receipt['artifacts'][0]['aapt2'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                qa.signed_artifact(receipt, self.config)
        receipt = copy.deepcopy(self.receipt); receipt['status'] = 'failed'
        with self.assertRaises(ValueError): qa.signed_artifact(receipt, self.config)

    def test_empty_or_wrong_encoded_origin_refused(self):
        for fields in ({}, dict(ORIGIN='', HOME_URL=''), dict(ORIGIN='https://wrong.invalid', HOME_URL='')):
            with self.subTest(fields=fields), patch.object(qa, 'apk_build_config', return_value=fields), self.assertRaises(ValueError):
                qa.signed_artifact(self.receipt, self.config)

    def test_upgrade_controller_has_distinct_unseeded_baselines_and_durable_forum_path(self):
        source = Path(qa.__file__).read_text()
        for text in ['--upgrade-only', 'empty-default-recovery', 'pre_pref_baseline',
                     'install preserves the exact pre-launch origin preferences',
                     '/srv/work/heavy/production/worker.lock', "['-accel', 'kvm']", 'owned emulator serial is absent']:
            self.assertIn(text, source)
        self.assertNotIn("shell('echo", source)

    def test_synthetic_paired_upgrade_is_explicit_and_retains_real_baseline_checks(self):
        source = Path(qa.__file__).read_text()
        for text in ['synthetic-fixture-paired', 'synthetic app data marker survives in-place update',
                     'unpaired published baseline naturally shows Connect', 'authenticated_owner_proof',
                     'published generic baseline has empty encoded defaults']:
            self.assertIn(text, source)

    def test_vps_refused_before_any_subprocess(self):
        with patch.object(qa.sys, 'platform', 'linux'), patch.object(qa, 'FORUM', False), patch.object(qa.subprocess, 'run') as run:
            with self.assertRaisesRegex(SystemExit, 'Trusted'):
                qa.main()
            run.assert_not_called()


if __name__ == '__main__': unittest.main()
