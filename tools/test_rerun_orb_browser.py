import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('recovery', Path(__file__).with_name('rerun-orb-browser.py'))
assert spec is not None and spec.loader is not None
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class EvidenceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.manifest = {'product_revision': 'product', 'evidence': {}, 'harness_root': str(self.root), 'harness_files': {}}
        phases = []
        for name, code in [('candidate-unit', 0), ('baseline-unit-negative', 1), ('published-unit-negative', 1), ('browser', 1)]:
            self.put(name, 'undefined smoothstep(.9, .2, ...)\nwebgl must reflect loss\ncontext restoration must rebuild')
            phases.append({'name': name, 'exit_code': code, 'log_sha256': self.manifest['evidence'][name]['sha256']})
        self.put('manifest', json.dumps({'revision': 'product'}))
        self.put('receipt', json.dumps({'revision': 'product', 'manifest_sha256': self.manifest['evidence']['manifest']['sha256'], 'phases': phases}))
        self.put('browser-result', json.dumps({'cases': [None]*8, 'pass': False, 'errors': ['native idle must stay frozen']}))

    def tearDown(self):
        self.temp.cleanup()

    def put(self, name, text):
        path = self.root / name
        path.write_text(text)
        self.manifest['evidence'][name] = {'path': str(path), 'sha256': recovery.digest(path)}

    def test_inherits_only_expected_complete_phases(self):
        recovery.verify_inherited(self.manifest)

    def test_refuses_changed_or_missing_original_log(self):
        (self.root/'candidate-unit').write_text('changed')
        with self.assertRaisesRegex(RuntimeError, 'evidence drift'):
            recovery.verify_inherited(self.manifest)
        (self.root/'candidate-unit').unlink()
        with self.assertRaises(FileNotFoundError):
            recovery.verify_inherited(self.manifest)

    def test_refuses_failed_candidate_unit_even_if_new_receipt_hash_matches(self):
        receipt = json.loads((self.root/'receipt').read_text())
        receipt['phases'][0]['exit_code'] = 1
        self.put('receipt', json.dumps(receipt))
        with self.assertRaisesRegex(RuntimeError, 'original phases'):
            recovery.verify_inherited(self.manifest)

    def test_refuses_revision_or_harness_drift(self):
        changed = copy.deepcopy(self.manifest); changed['product_revision'] = 'other'
        with self.assertRaisesRegex(RuntimeError, 'revision mismatch'):
            recovery.verify_inherited(changed)
        changed = copy.deepcopy(self.manifest); changed['harness_files'] = {'candidate-unit': 'wrong'}
        with self.assertRaisesRegex(RuntimeError, 'harness drift'):
            recovery.verify_inherited(changed)

    def test_refuses_missing_negative_assertion(self):
        self.put('baseline-unit-negative', 'no named failures')
        receipt = json.loads((self.root/'receipt').read_text())
        receipt['phases'][1]['log_sha256'] = self.manifest['evidence']['baseline-unit-negative']['sha256']
        self.put('receipt', json.dumps(receipt))
        with self.assertRaisesRegex(RuntimeError, 'missing inherited negative'):
            recovery.verify_inherited(self.manifest)
    def test_browser_requires_exact_inventory_and_every_check_pass(self):
        manifest = {'expected_cases': ['candidate/64/controlled/idle', 'baseline/64/controlled/idle']}
        browser = {'pass': True, 'complete': True, 'expected': manifest['expected_cases'],
                   'cases': [{'id': item, 'pass': True} for item in manifest['expected_cases']]}
        recovery.verify_browser(browser, manifest)
        for change in [
            {'pass': False}, {'complete': False}, {'expected': ['wrong']},
            {'cases': browser['cases'][:1]}, {'cases': browser['cases'] * 2},
            {'cases': [{'id': browser['cases'][0]['id'], 'pass': False}, browser['cases'][1]]},
        ]:
            with self.subTest(change=change), self.assertRaisesRegex(RuntimeError, 'failed or incomplete'):
                recovery.verify_browser(browser | change, manifest)

    def test_refuses_second_failed_browser_drift(self):
        self.put('second-browser-result', json.dumps({'cases': [None] * 16, 'pass': False,
                                                    'errors': ['galaxy collapsed to flat white']}))
        recovery.verify_inherited(self.manifest)
        self.put('second-browser-result', json.dumps({'cases': [], 'pass': True, 'errors': []}))
        with self.assertRaisesRegex(RuntimeError, 'second browser failure'):
            recovery.verify_inherited(self.manifest)

    def test_refuses_dependency_tree_drift(self):
        dep = self.root / 'dependency'; dep.mkdir(); (dep / 'file').write_text('original')
        self.manifest['dependency_trees'] = [{'root': str(dep), 'files': {'file': recovery.digest(dep / 'file')}}]
        recovery.verify_inherited(self.manifest)
        (dep / 'file').write_text('changed')
        with self.assertRaisesRegex(RuntimeError, 'dependency tree drift'):
            recovery.verify_inherited(self.manifest)

    def test_refuses_harness_archive_drift(self):
        archive = self.root / 'archive'; archive.write_text('original')
        harness = self.root / 'harness'; harness.mkdir()
        self.manifest['harness_root'] = str(harness)
        self.manifest.update(harness_archive=str(archive), harness_archive_sha256=recovery.digest(archive))
        recovery.verify_inherited(self.manifest)
        archive.write_text('changed')
        with self.assertRaisesRegex(RuntimeError, 'archive drift'):
            recovery.verify_inherited(self.manifest)


if __name__ == '__main__':
    unittest.main()
