"""Pure-Python contract tests. No Android, Gradle, SDK, subprocesses or emulator.

Run: python3 -m unittest discover -s tools -p test_qa_orb_tap_resume_native.py -v
These tests are NOT native acceptance evidence; that comes only from Thales.
"""
import fcntl
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

MODULE = Path(__file__).with_name('qa_orb_tap_resume_native.py')
with patch('subprocess.run', side_effect=AssertionError('import ran a command')), \
     patch('subprocess.Popen', side_effect=AssertionError('import spawned a process')):
    spec = importlib.util.spec_from_file_location('orbqa', MODULE)
    assert spec is not None and spec.loader is not None
    qa = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(qa)


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR'))
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def receipt_fixture(self):
        # Tiny test bytes, not an APK or a claimed build result.
        path = self.root / 'source/android/app/build/outputs/apk/debug/app-debug.apk'
        path.parent.mkdir(parents=True)
        path.write_bytes(b'unit-test-only-not-an-apk')
        receipt = {'status': 'ok', 'job': str(self.root), 'artifacts': [
            {'path': str(path.relative_to(self.root / 'source')),
             'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
             'aapt2': {'package': qa.PKG}}]}
        rp = self.root / 'receipt.json'
        rp.write_text(json.dumps(receipt))
        return rp, path, receipt

    def test_artifact_matches_existing_receipt_contract(self):
        rp, apk, receipt = self.receipt_fixture()
        self.assertEqual(qa.artifact(rp), (apk, receipt['artifacts'][0]['sha256']))

    def test_artifact_rejects_changed_bytes(self):
        rp, apk, _ = self.receipt_fixture()
        apk.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'sha256'):
            qa.artifact(rp)

    def test_artifact_rejects_non_ok_build(self):
        rp, _, r = self.receipt_fixture()
        r['status'] = 'failed'; rp.write_text(json.dumps(r))
        with self.assertRaisesRegex(ValueError, 'status'):
            qa.artifact(rp)

    def test_artifact_rejects_release_package(self):
        rp, _, r = self.receipt_fixture()
        r['artifacts'][0]['aapt2']['package'] = 'ai.wizards.os'
        rp.write_text(json.dumps(r))
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            qa.artifact(rp)

    def test_artifact_rejects_ambiguous_debug_apks(self):
        rp, _, r = self.receipt_fixture()
        r['artifacts'] *= 2; rp.write_text(json.dumps(r))
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            qa.artifact(rp)

    def passing_checks(self):
        return [{'id': k, 'status': 'PASS'} for k in qa.REQUIRED]

    def test_gate_passes_only_completed_required_matrix(self):
        self.assertTrue(qa.receipt_ok(self.passing_checks(), True))
        self.assertFalse(qa.receipt_ok(self.passing_checks(), False))
        for missing in qa.REQUIRED:
            self.assertFalse(qa.receipt_ok([c for c in self.passing_checks() if c['id'] != missing], True))

    def test_gate_rejects_required_nc_or_fail(self):
        for status in ('NOT_COVERED', 'FAIL'):
            for ident in qa.REQUIRED:
                checks = self.passing_checks()
                next(c for c in checks if c['id'] == ident)['status'] = status
                self.assertFalse(qa.receipt_ok(checks, True))

    def test_gate_allows_explicit_inapplicable_coverage(self):
        checks = self.passing_checks() + [{'id': k, 'status': 'NOT_COVERED'} for k in qa.EXPECTED - qa.REQUIRED]
        self.assertTrue(qa.receipt_ok(checks, True))
        checks.append({'id': 'unexpected-crash', 'status': 'FAIL'})
        self.assertFalse(qa.receipt_ok(checks, True))

    def test_legacy_helper_extraction_does_not_execute_suite(self):
        with patch('subprocess.run', side_effect=AssertionError('helper extraction ran a command')), \
             patch('subprocess.Popen', side_effect=AssertionError('helper extraction spawned a process')):
            ns = qa.load_helpers(dict(qa.__dict__))
        self.assertTrue(all(callable(ns[name]) for name in qa.HELPERS))
        self.assertNotIn('em', ns)
        self.assertNotIn('srv', ns)
        self.assertEqual(ns['mid']((10, 20, 30, 60)), (20, 40))

    def test_legacy_helper_drift_fails_closed(self):
        with patch.object(qa.P, 'read_text', return_value='raise Exception("must not execute")'):
            with self.assertRaisesRegex(RuntimeError, 'API changed'):
                qa.load_helpers({})

    def test_inherited_lock_is_validated_and_not_unlocked(self):
        lockpath = self.root / 'worker.lock'
        lockpath.touch()
        fd = os.open(lockpath, os.O_WRONLY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            with patch.object(qa, 'BASE', self.root), patch.dict(os.environ, WIZARD_HEAVY_LOCK_FD=str(fd)):
                with qa.worker_lock():
                    pass
            with lockpath.open('a') as probe:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
            os.fstat(fd)  # context manager must not close the worker's fd
        finally:
            os.close(fd)

    def test_wrong_inherited_lock_rejected(self):
        (self.root / 'worker.lock').touch()
        wrong = self.root / 'wrong.lock'; wrong.touch()
        with wrong.open('a') as lock:
            with patch.object(qa, 'BASE', self.root), patch.dict(os.environ, WIZARD_HEAVY_LOCK_FD=str(lock.fileno())):
                with self.assertRaisesRegex(RuntimeError, 'not the shared'):
                    with qa.worker_lock():
                        self.fail('wrong inherited lock admitted')

    def test_non_darwin_guard_precedes_android_commands(self):
        with patch.object(qa.sys, 'argv', [str(MODULE), 'receipt.json', 'out']), \
             patch.object(qa.sys, 'platform', 'linux'), \
             patch('subprocess.run', side_effect=AssertionError('SDK invoked')), \
             patch('subprocess.Popen', side_effect=AssertionError('emulator invoked')), \
             patch('sys.stderr'):
            with self.assertRaises(SystemExit) as cm:
                qa.main()
        self.assertEqual(cm.exception.code, 2)

    def main_fixture(self, suite):
        rp, _, _ = self.receipt_fixture()
        out = self.root / 'qa'
        with patch.object(qa.sys, 'argv', [str(MODULE), str(rp), str(out)]), \
             patch.object(qa.sys, 'platform', 'darwin'), patch.object(qa, 'BASE', self.root), \
             patch.object(qa, 'worker_lock', return_value=contextlib.nullcontext()), \
             patch.object(qa, 'Suite', return_value=suite), patch('sys.stdout'), \
             patch('subprocess.run', side_effect=AssertionError('SDK invoked')), \
             patch('subprocess.Popen', side_effect=AssertionError('emulator invoked')):
            result = qa.main()
        return result, json.loads((out / 'receipt.json').read_text())

    def test_assertion_timeout_is_specific_check_fail_not_nc(self):
        suite = Mock(checks=[], current_check='everywhere.1')
        suite.run.side_effect = AssertionError('unit-only timeout fixture')
        suite.close.return_value = []
        result, r = self.main_fixture(suite)
        self.assertEqual(result, 1)
        self.assertFalse(r['ok'])
        checks = {c['id']: c for c in r['checks']}
        self.assertEqual(checks['everywhere.1']['status'], 'FAIL')
        self.assertEqual(checks['assist.1']['status'], 'NOT_COVERED')
        self.assertIn('no appVoice/carrying/remote path', checks['assist.4']['detail'])
        suite.close.assert_called_once()

    def test_complete_receipt_preserves_optional_nc(self):
        suite = Mock(checks=self.passing_checks(), current_check=None)
        suite.close.return_value = []
        result, r = self.main_fixture(suite)
        self.assertEqual(result, 0)
        self.assertTrue(r['ok'])
        self.assertTrue(r['completed'])
        self.assertTrue(qa.EXPECTED <= {c['id'] for c in r['checks']})
        self.assertFalse(r['physical_device'])


if __name__ == '__main__':
    unittest.main()
