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

    def test_vps_refused_before_any_subprocess(self):
        with patch.object(qa.sys, 'platform', 'linux'), patch.object(qa, 'FORUM', False), patch.object(qa.subprocess, 'run') as run:
            with self.assertRaisesRegex(SystemExit, 'Trusted'):
                qa.main()
            run.assert_not_called()


class PacketPreparationTest(unittest.TestCase):
    def test_capacity_preserves_reserve_plus_every_retained_working_set(self):
        import qa_unified_share_release_packet as packet
        required = packet.RESERVE + packet.FOOTPRINT
        self.assertFalse(packet.capacity(required - 1)['pass_gate'])
        self.assertTrue(packet.capacity(required)['pass_gate'])
        self.assertEqual(packet.FOOTPRINT, 22 * 1024**3 + 256 * 1024**2)

    def test_every_parent_review_gate_is_required_for_exact_seal_and_source(self):
        import qa_unified_share_release_packet as packet
        gates = ('independent_review_passed', 'version84_custody_resolved', 'live_and_feed_rechecked',
                 'signing_provisioned', 'baseline_receipt_traced', 'notification_visual_limit_accepted_for_rerun')
        good = dict(seal_sha256='test-seal', revision='test-revision', **dict.fromkeys(gates, True))
        packet.authorize(good, 'test-seal', 'test-revision')
        for key in (*gates, 'seal_sha256', 'revision'):
            bad = dict(good); bad.pop(key)
            with self.subTest(key=key), self.assertRaises(ValueError):
                packet.authorize(bad, 'test-seal', 'test-revision')


if __name__ == '__main__': unittest.main()
