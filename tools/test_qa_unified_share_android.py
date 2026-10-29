#!/usr/bin/env python3
"""Small controller unit tests; no SDK, builds, browser or emulator is started."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('unified_android_runner', HERE / 'qa_unified_share_android.py')
assert SPEC is not None and SPEC.loader is not None
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class ControllerTest(unittest.TestCase):
    def test_bounds(self):
        xml = '<hierarchy><node text="Share synthetic PDF" bounds="[10,20][110,80]"/></hierarchy>'
        self.assertEqual(runner.native_bounds(xml, 'Share synthetic PDF'), [60, 50])
        self.assertIsNone(runner.native_bounds(xml, 'Private'))

    def test_content_description(self):
        xml = '<hierarchy><node content-desc="Close" bounds="[0,0][20,20]"/></hierarchy>'
        self.assertEqual(runner.native_bounds(xml, 'Close'), [10, 10])

    def test_zero_size_not_tappable(self):
        self.assertIsNone(runner.native_bounds('<hierarchy><node text="Hidden" bounds="[0,0][0,0]"/></hierarchy>', 'Hidden'))

    def prepared(self, root):
        payload = (HERE / 'qa_unified_share_android.py').read_bytes()
        files = {'tools/qa_unified_share_android.py': {'sha256': hashlib.sha256(payload).hexdigest(), 'mode': 420}}
        cfg = dict(host='forum', java='21', cap_sync=False, signing_env=None, expected_signer=None,
                   tasks=[':app:testDebugUnitTest', ':app:assembleDebug'], revision='synthetic-unit-source-only',
                   manifest_sha256=hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest(), files=files)
        with tarfile.open(root / 'source.tar.gz', 'w:gz') as tf:
            item = tarfile.TarInfo('tools/qa_unified_share_android.py'); item.size = len(payload)
            tf.addfile(item, io.BytesIO(payload))
        (root / 'job.json').write_text(json.dumps(cfg))
        (root / 'worker.py').write_text('# unit fixture only\n')
        return cfg

    def seal(self, root, cfg):
        data = {'revision': cfg['revision'], 'source_manifest_sha256': cfg['manifest_sha256'],
                'files': {n: runner.sha(root / n) for n in ('source.tar.gz', 'job.json', 'worker.py')}}
        p = root / 'seal.json'; p.write_text(json.dumps(data))
        return p, runner.sha(p)

    def case(self, mutation=None, rebuild=False):
        with tempfile.TemporaryDirectory(prefix='unified-controller-', dir=os.environ['TMPDIR']) as d:
            root = Path(d); cfg = self.prepared(root); path, digest = self.seal(root, cfg)
            if mutation:
                mutation(root, cfg)
            if rebuild:
                path, digest = self.seal(root, cfg)
            return runner.verify_seal(root, path, digest)

    def test_good_seal(self):
        _, cfg = self.case()
        self.assertEqual(cfg['host'], 'forum')

    def test_changed_worker_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'staged input drift'):
            self.case(lambda r, c: (r / 'worker.py').write_text('# changed'))

    def test_signing_refused(self):
        def mutate(r, c):
            c['signing_env'] = '/never/read/owner.env'; (r / 'job.json').write_text(json.dumps(c))
        with self.assertRaisesRegex(RuntimeError, 'debug-only'):
            self.case(mutate, rebuild=True)

    def test_release_task_refused(self):
        def mutate(r, c):
            c['tasks'] = [':app:assembleRelease']; (r / 'job.json').write_text(json.dumps(c))
        with self.assertRaisesRegex(RuntimeError, 'Gradle scope'):
            self.case(mutate, rebuild=True)

    def test_archive_drift_refused(self):
        def mutate(r, c):
            with tarfile.open(r / 'source.tar.gz', 'w:gz') as tf:
                item = tarfile.TarInfo('extra'); item.size = 1; tf.addfile(item, io.BytesIO(b'x'))
        with self.assertRaisesRegex(RuntimeError, 'archive/member'):
            self.case(mutate, rebuild=True)

    def test_seal_digest_refused(self):
        with tempfile.TemporaryDirectory(prefix='unified-controller-', dir=os.environ['TMPDIR']) as d:
            root = Path(d); cfg = self.prepared(root); p, _ = self.seal(root, cfg)
            with self.assertRaisesRegex(RuntimeError, 'seal digest'):
                runner.verify_seal(root, p, '0' * 64)

    def test_fixture_thread_contract(self):
        text = (HERE / 'share-fixture.mjs').read_text()
        for name in ('qa_private_thread', 'qa_existing_thread', 'qa_second_thread'):
            self.assertIn('S.sessions.' + name, text)
            self.assertIn(name, (HERE / 'qa_unified_share_android.py').read_text())

    def test_external_sender_native_contract(self):
        text = (HERE / 'unified-share-sender/SenderActivity.java').read_text()
        for token in ('Intent.ACTION_SEND', 'Intent.EXTRA_STREAM', 'Intent.EXTRA_TEXT', 'Emailing x.pdf',
                      'FLAG_GRANT_READ_URI_PERMISSION', 'ai.wizards.os.share.ShareActivity'):
            self.assertIn(token, text)
        manifest = (HERE / 'unified-share-sender/AndroidManifest.xml').read_text()
        self.assertIn('android:exported="false" android:grantUriPermissions="true"', manifest)

    def test_both_native_origin_hooks_before_first_launch(self):
        text = (HERE / 'qa_unified_share_android.py').read_text()
        install = text.index("rig.adb_cmd('install', '-r', '-g', apk)")
        launch = text.index("rig.sx('am start -W -n ' + PKG", install)
        configure = text[install:launch]
        self.assertIn('files/qa_home.txt', configure)
        self.assertIn('files/qa_origin.txt', configure)

    def test_host_guard_refuses_vps(self):
        import subprocess
        result = subprocess.run(['python3', str(HERE / 'qa_unified_share_android.py'), '--seal', '/unused', '--seal-sha256', '0' * 64], capture_output=True, text=True)
        if os.uname().nodename != 'forum':
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('forum staged runner only', result.stderr)


if __name__ == '__main__':
    unittest.main()
