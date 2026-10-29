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
from unittest.mock import Mock, patch
from typing import Any

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('unified_android_runner', HERE / 'qa_unified_share_android.py')
assert SPEC is not None and SPEC.loader is not None
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class ControllerTest(unittest.TestCase):
    def test_shared_orb_assets_match_canonical_web_bytes(self):
        for name in ('orb.js', 'robert-thread-orb.png', 'robert-listening-galaxy.png'):
            self.assertEqual((HERE.parent / 'web' / name).read_bytes(),
                             (HERE.parent / 'android/app/src/main/assets/assist' / name).read_bytes(), name)

    def test_actual_android_requires_verified_boot(self):
        report = runner.initial_report(dict(revision='unit-only', manifest_sha256='unit-only'), 'unit-only')
        self.assertFalse(report['actual_android'])
        report['emulator'] = {'started': True}
        self.assertFalse(report['actual_android'])
        for sdk, users in [('35', 'RUNNING_LOCKED'), ('34', 'RUNNING_UNLOCKED')]:
            with self.assertRaisesRegex(RuntimeError, 'runtime not ready'):
                runner.record_android_boot(report, sdk, users)
            self.assertFalse(report['actual_android'])
        runner.record_android_boot(report, '35\n', 'User #0: state=RUNNING_UNLOCKED')
        self.assertTrue(report['actual_android'])
        self.assertEqual(report['emulator']['sdk'], '35')

    def test_junit_failure_is_collected_before_build_refusal(self):
        with tempfile.TemporaryDirectory(prefix='unified-junit-', dir=os.environ['TMPDIR']) as d:
            root = Path(d)
            junit = root / 'source/android/app/build/test-results/testDebugUnitTest'
            junit.mkdir(parents=True)
            xml = junit / 'TEST-fixture.xml'
            xml.write_text('<testsuite name="unit.fixture" tests="2" failures="1" errors="0" skipped="0">'
                           '<testcase name="pass"/><testcase name="androidOrbIsTheAppOrb">'
                           '<failure type="ArrayComparisonFailure" message="orb.js differs">stack</failure>'
                           '</testcase></testsuite>')
            counts, failures, hashes = runner.collect_junit(root)
            self.assertEqual(counts, dict(tests=2, failures=1, errors=0, skipped=0))
            self.assertEqual(hashes[str(xml.relative_to(root))], runner.sha(xml))
            self.assertEqual(failures[0]['type'], 'ArrayComparisonFailure')
            with self.assertRaisesRegex(RuntimeError, 'androidOrbIsTheAppOrb: orb.js differs'):
                runner.require_build(1, {'status': 'failed'}, {}, counts, failures)

    def test_build_failure_without_junit_still_has_diagnostic(self):
        with self.assertRaisesRegex(RuntimeError, 'worker exit=1, status=failed'):
            runner.require_build(1, {'status': 'failed', 'error': 'route failed'}, {},
                                 dict(tests=0, failures=0, errors=0, skipped=0), [])

    def test_message_less_assertion_still_has_diagnostic(self):
        self.assertEqual(runner.exception_detail(AssertionError()), 'AssertionError: AssertionError()')
        self.assertEqual(runner.exception_detail(RuntimeError('detail')), 'RuntimeError: detail')

    def test_successful_build_requires_source_identity_and_nonempty_passing_junit(self):
        cfg = dict(revision='unit-only', manifest_sha256='unit-manifest')
        build = dict(status='ok', source_revision=cfg['revision'], source_manifest_sha256=cfg['manifest_sha256'])
        counts = dict(tests=2, failures=0, errors=0, skipped=0)
        runner.require_build(0, build, cfg, counts, [])
        for altered in (dict(tests=0, failures=0, errors=0, skipped=0), dict(counts, failures=1)):
            with self.assertRaisesRegex(RuntimeError, 'JUnit did not pass'):
                runner.require_build(0, build, cfg, altered, [])
        with self.assertRaisesRegex(RuntimeError, 'source identity mismatch'):
            runner.require_build(0, dict(build, source_revision='wrong'), cfg, counts, [])

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
        self.assertIn('send.setClipData(ClipData.newRawUri("Synthetic PDF", uri));', text)
        self.assertIn('send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);', text)
        self.assertNotRegex(text, r'\.setClipData\([^;]+\)\s*\.')

    def reuse_fixture(self, base):
        # Synthetic controller inputs only, never an APK or Android acceptance claim.
        old, root = base / 'old', base / 'qa'
        old.mkdir(); root.mkdir()
        cfg = self.prepared(old)
        payloads = {'tools/qa_unified_share_android.py': (HERE / 'qa_unified_share_android.py').read_bytes() + b'\n# old fixture\n',
                    'android/source-marker': b'unit-only native source'}
        cfg['files'] = {n: {'sha256': hashlib.sha256(v).hexdigest(), 'mode': 420} for n, v in payloads.items()}
        cfg['manifest_sha256'] = hashlib.sha256(json.dumps(cfg['files'], sort_keys=True).encode()).hexdigest()
        with tarfile.open(old / 'source.tar.gz', 'w:gz') as tf:
            for n, v in payloads.items():
                entry = tarfile.TarInfo(n); entry.size = len(v); tf.addfile(entry, io.BytesIO(v))
                p = old / 'source' / n; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(v)
        (old / 'qa_unified_share_android.py').write_bytes(payloads['tools/qa_unified_share_android.py'])
        (old / 'job.json').write_text(json.dumps(cfg))
        old_seal, digest = self.seal(old, cfg); old_seal.rename(old / 'android-seal.json')
        for n, v in payloads.items():
            p = root / 'source' / n; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(v)
        (root / 'source/tools/qa_unified_share_android.py').write_bytes((HERE / 'qa_unified_share_android.py').read_bytes())
        (root / 'qa_unified_share_android.py').write_bytes((HERE / 'qa_unified_share_android.py').read_bytes())
        candidate: dict[str, Any] = dict(cfg, revision='unit-only-qa-repair', files={n: dict(v) for n, v in cfg['files'].items()})
        candidate['files']['tools/qa_unified_share_android.py']['sha256'] = runner.sha(HERE / 'qa_unified_share_android.py')
        candidate['manifest_sha256'] = hashlib.sha256(json.dumps(candidate['files'], sort_keys=True).encode()).hexdigest()
        (root / 'reuse-job.json').write_text(json.dumps(candidate))
        apk = old / 'source' / runner.APK_PATH; apk.parent.mkdir(parents=True); apk.write_bytes(b'NOT-AN-APK-unit-only')
        junit = old / 'source/android/app/build/test-results/testDebugUnitTest/TEST-fixture.xml'
        junit.parent.mkdir(parents=True); junit.write_text('<testsuite tests="381" failures="0" errors="0" skipped="0"/>')
        config = old / 'source/android/app/build/generated/source/buildConfig/debug/BuildConfig.java'
        config.parent.mkdir(parents=True); config.write_text('ORIGIN = ""')
        build = dict(status='ok', source_revision=cfg['revision'], source_manifest_sha256=cfg['manifest_sha256'],
                     artifacts=[dict(path=runner.APK_PATH, sha256=runner.sha(apk), aapt2=dict(package=runner.PKG))])
        (old / 'receipt.json').write_text(json.dumps(build))
        evidence = old / 'android-evidence'; evidence.mkdir(); (evidence / 'build.log').write_text('unit only')
        counts, _, hashes = runner.collect_junit(old)
        prior = dict(build=build, junit=counts, junit_xml_sha256=hashes, apk_sha256=runner.sha(apk),
                     failure_phase='fixture-and-boot', error='void cannot be dereferenced',
                     phases=dict(build=dict(status='PASS', log_sha256=runner.sha(evidence / 'build.log'))))
        (evidence / 'acceptance.json').write_text(json.dumps(prior))
        seal = dict(mode='reuse-build', revision=candidate['revision'], build_revision=cfg['revision'],
                    build_root=str(old), build_seal_sha256=digest, apk_sha256=runner.sha(apk),
                    files={n: runner.sha(root / n) for n in ('reuse-job.json', 'qa_unified_share_android.py')},
                    build_files={n: runner.sha(old / n) for n in ['receipt.json', 'android-evidence/acceptance.json',
                                 'android-evidence/build.log', str(config.relative_to(old)), *hashes]})
        return old, root, seal

    def reuse_case(self, mutate=None):
        with tempfile.TemporaryDirectory(prefix='unified-reuse-', dir=os.environ['TMPDIR']) as d:
            old, root, seal = self.reuse_fixture(Path(d))
            if mutate:
                mutate(old, root, seal)
            p = root / 'reuse-seal.json'; p.write_text(json.dumps(seal))
            # Reuse validation must remain read-only with no Gradle, SDK or subprocess work.
            with patch.object(runner.subprocess, 'run', side_effect=AssertionError('unexpected execution')):
                return runner.verify_reuse_build(root, p, runner.sha(p))

    def test_reuse_good_preserves_381_and_apk(self):
        _, _, build, junit, hashes, _ = self.reuse_case()
        self.assertEqual(build['status'], 'ok')
        self.assertEqual(junit, dict(tests=381, failures=0, errors=0, skipped=0))
        self.assertEqual(len(hashes), 1)

    def test_reuse_missing_receipt_fails_closed(self):
        with self.assertRaises(FileNotFoundError):
            self.reuse_case(lambda o, r, s: (o / 'receipt.json').unlink())

    def test_reuse_changed_receipt_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, 'reused evidence drift: receipt.json'):
            self.reuse_case(lambda o, r, s: (o / 'receipt.json').write_text('{}'))

    def test_reuse_wrong_receipt_identity_fails_even_when_bound(self):
        def mutate(o, r, s):
            p = o / 'receipt.json'; b = json.loads(p.read_text()); b['source_revision'] = 'wrong'
            p.write_text(json.dumps(b)); s['build_files']['receipt.json'] = runner.sha(p)
        with self.assertRaisesRegex(RuntimeError, 'source identity mismatch'):
            self.reuse_case(mutate)

    def test_reuse_missing_receipt_binding_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, 'missing reused evidence binding'):
            self.reuse_case(lambda o, r, s: s['build_files'].pop('receipt.json'))

    def test_reuse_changed_apk_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, 'APK identity mismatch'):
            self.reuse_case(lambda o, r, s: (o / 'source' / runner.APK_PATH).write_bytes(b'changed'))

    def test_reuse_changed_junit_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, 'reused evidence drift'):
            self.reuse_case(lambda o, r, s: (o / next(n for n in s['build_files'] if n.endswith('.xml'))).write_text('<testsuite tests="381" skipped="1"/>'))

    def test_reuse_changed_old_android_source_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, 'source drift: android'):
            self.reuse_case(lambda o, r, s: (o / 'source/android/source-marker').write_bytes(b'changed'))

    def test_reuse_candidate_android_change_refused_even_when_bound(self):
        def mutate(o, r, s):
            p = r / 'source/android/source-marker'; p.write_bytes(b'changed')
            c = json.loads((r / 'reuse-job.json').read_text()); c['files']['android/source-marker']['sha256'] = runner.sha(p)
            c['manifest_sha256'] = hashlib.sha256(json.dumps(c['files'], sort_keys=True).encode()).hexdigest()
            (r / 'reuse-job.json').write_text(json.dumps(c)); s['files']['reuse-job.json'] = runner.sha(r / 'reuse-job.json')
        with self.assertRaisesRegex(RuntimeError, 'non-QA source delta'):
            self.reuse_case(mutate)

    def test_reuse_candidate_source_drift_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'source drift'):
            self.reuse_case(lambda o, r, s: (r / 'source/tools/qa_unified_share_android.py').write_bytes(b'changed'))

    def test_reuse_unmanifested_candidate_file_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'unmanifested'):
            self.reuse_case(lambda o, r, s: (r / 'source/extra').write_bytes(b'changed'))

    def test_cleanup_waits_for_owned_serial_but_preserves_foreign(self):
        rig = runner.Rig.__new__(runner.Rig)
        rig.page = rig.fixture = rig.proxy = None
        rig.emulator = Mock(); rig.emulator.poll.return_value = 0
        rig.serial = 'emulator-5580'; rig.adb = 'unit-only-adb'; rig.devtools = 12345
        rig.report = {'emulator': {}}; rig.save = Mock(); rig.adb_cmd = Mock()
        rig.run = Mock(side_effect=['emulator-5580 offline\nemulator-5582 device', 'emulator-5582 device', ''])
        with patch.object(runner.time, 'sleep'):
            rig.close()
        self.assertTrue(rig.report['emulator']['serial_absent'])
        self.assertEqual(rig.report['cleanup_errors'], [])
        rig.adb_cmd.assert_called_once_with('emu', 'kill', timeout=20)
        self.assertEqual(rig.run.call_count, 3)

    def test_cleanup_serial_timeout_is_failure(self):
        rig = runner.Rig.__new__(runner.Rig)
        rig.page = rig.fixture = rig.proxy = None
        rig.emulator = Mock(); rig.emulator.poll.return_value = 0
        rig.serial = 'emulator-5580'; rig.adb = 'unit-only-adb'; rig.devtools = 12345
        rig.report = {'emulator': {}}; rig.save = Mock(); rig.adb_cmd = Mock(); rig.run = Mock()
        with patch.object(runner, 'wait', side_effect=RuntimeError('deadline')) as bounded:
            rig.close()
        self.assertFalse(rig.report['emulator']['serial_absent'])
        self.assertIn('bounded wait', rig.report['cleanup_errors'][0])
        self.assertEqual(bounded.call_args.args[1], 30)

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
