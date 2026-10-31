"""Preparation/seal tests ONLY: no build, emulator or fabricated acceptance."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import qa_unified_share_forum_packet as packet


class ForumPacketTest(unittest.TestCase):
    def test_capacity_counts_full_peak_and_200_gib_reserve(self):
        required = packet.RESERVE + packet.FOOTPRINT
        self.assertEqual(packet.RESERVE, 214748364800)
        self.assertFalse(packet.capacity(required - 1)['pass_gate'])
        self.assertTrue(packet.capacity(required)['pass_gate'])

    def test_exact_seal_readback_then_drift_is_refused(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as name:
            root = Path(name)
            cfg = dict(revision='a' * 40, host='forum', version_code=86)
            (root / 'packet.json').write_text(json.dumps(cfg))
            (root / 'source.tar.gz').write_bytes(b'SYNTHETIC UNIT ARCHIVE BYTES, NOT SOURCE')
            seal = dict(revision=cfg['revision'], files={n: packet.sha(root / n) for n in ('packet.json', 'source.tar.gz')})
            (root / 'packet-seal.json').write_text(json.dumps(seal))
            digest = packet.sha(root / 'packet-seal.json')
            self.assertEqual(packet.verify(root, digest), cfg)
            with self.assertRaisesRegex(ValueError, 'packet seal drift'):
                packet.verify(root, 'wrong')
            (root / 'source.tar.gz').write_bytes(b'DRIFT')
            with self.assertRaisesRegex(ValueError, 'sealed input drift'):
                packet.verify(root, digest)

    def test_full_junit_count_and_skips_are_not_relaxed(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as name:
            root = Path(name); xml = root / 'TEST-synthetic.xml'
            xml.write_text('<testsuite tests="392" failures="0" errors="0" skipped="0"/>')
            self.assertEqual(packet.junit(root)['tests'], 392)
            xml.write_text('<testsuite tests="384" failures="0" errors="0" skipped="0"/>')
            with self.assertRaises(ValueError): packet.junit(root)
            xml.write_text('<testsuite tests="392" failures="0" errors="0" skipped="1"/>')
            with self.assertRaises(ValueError): packet.junit(root)

    def test_vps_refused_before_subprocess_or_network(self):
        with patch.object(packet.sys, 'argv', ['packet', '--seal-sha256', 'unit']), \
             patch.object(packet.subprocess, 'Popen') as start, \
             patch.object(packet.urllib.request, 'urlopen') as fetch:
            with self.assertRaisesRegex(SystemExit, 'forum durable jobs only'):
                packet.main()
            start.assert_not_called(); fetch.assert_not_called()

    def test_gate_inventory_remains_one_forum_packet(self):
        source = Path(packet.__file__).read_text()
        for expected in ('signed-upgrade-82', 'synthetic-native-share', 'browser-share', 'opaque-overlays',
                         'apksigner', 'verify', '--print-certs', 'ANDROID_AVD_HOME', 'GRADLE_USER_HOME',
                         'ANDROID_USER_HOME', 'in-shell-', 'packet-seal.json', 'finally:', 'stop_process(current)'):
            self.assertIn(expected, source)
        self.assertNotIn('ce4ebabe', source)


if __name__ == '__main__': unittest.main()
