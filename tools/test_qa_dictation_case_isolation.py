"""Controller regressions only. Synthetic transports are NOT native passes."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import qa_dictation_insertion_native as native
import qa_dictation_case_isolation as isolation
from test_qa_dictation_insertion_native import record


class IsolationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name)

    def test_process_census_exact_and_colon_suffix_not_similar_package(self):
        text = ('PID NAME\n10 ai.wizards.os.qa\n11 ai.wizards.os.qa:dictationEditor\n'
                '12 ai.wizards.os.qa.test\n13 ai.wizards.os.qa.other\n14 com.android.inputmethod.latin\n')
        self.assertEqual([10, 11, 12], [r['pid'] for r in isolation.package_processes(text, (native.PKG, native.TEST))])

    def test_callbacks_killed_before_fixture_deletion_and_absence_checked(self):
        calls = []; logs = iter(['PID NAME\n10 '+native.PKG+':dictationEditor\n', 'PID NAME\n'])
        def command(argv, **kwargs):
            calls.append(argv)
            return next(logs) if 'ps' in argv else ''
        with patch.object(isolation.time, 'sleep'):
            isolation.fresh_case(native, command, ['adb'], self.out)
        deletion = next(i for i, a in enumerate(calls) if 'rm' in a)
        self.assertTrue(all('force-stop' not in a for a in calls[deletion:]))
        self.assertEqual(2, sum('test' in a and '!' in a for a in calls))
        samples = json.loads((self.out/'before-process-absence.json').read_text())
        self.assertEqual([], samples[-1]['processes']); self.assertEqual(2, len(samples))

    def test_unrecognized_process_output_never_claims_absence(self):
        with self.assertRaisesRegex(ValueError, 'unrecognized'):
            isolation.fresh_case(native, lambda *a, **k: 'not a process list', ['adb'], self.out)
        self.assertFalse((self.out/'isolation.json').exists())

    def test_lingering_editor_refuses_dispatch(self):
        calls = []
        def command(argv, **kwargs): calls.append(argv); return 'PID NAME\n10 '+native.PKG+':dictationEditor\n'
        with patch.object(isolation.time, 'monotonic', side_effect=[0, 1, 9]), patch.object(isolation.time, 'sleep'):
            with self.assertRaisesRegex(TimeoutError, 'survived'): isolation.fresh_case(native, command, ['adb'], self.out)
        self.assertFalse(any('rm' in a for a in calls))

    def collect(self, lane, methods, codes=None, prep_error=None, cleanup_error=None):
        calls = []
        def fresh(n, cmd, adb, out):
            calls.append(('fresh', out.name))
            if prep_error and prep_error in out.name: raise RuntimeError('setup broken')
        def collect(command, adb, selected_lane, selected_methods, out, env):
            self.assertEqual(1, len(selected_methods)); method = selected_methods[0]
            calls.append(('instrument', method))
            code, stack = (codes or {}).get(method, (0, ''))
            text = record(method, code, stack)
            (out/(selected_lane+'-instrumentation.txt')).write_text(text)
            rows = native.statuses(text)
            try: native.validate_native(text, selected_methods, rejected=selected_lane == 'rejected'); status='ok'
            except AssertionError: status='failed'
            return {'status':status,'records':rows}
        def stop(n, command, adb, out, phase):
            calls.append(('stop', out.name))
            if cleanup_error and cleanup_error in out.name: raise RuntimeError('cleanup broken')
        with patch.object(isolation, 'fresh_case', side_effect=fresh), \
             patch.object(isolation, 'stop_processes', side_effect=stop), \
             patch.object(native, 'collect_lane', side_effect=collect), \
             patch.object(native, 'diagnostics', return_value={}):
            result = isolation.collect_isolated_lane(native, None, ['adb'], lane, methods, self.out, {})
        return result, calls

    def test_all_27_invocations_single_method_fresh_processes_and_global_census(self):
        methods = ['case'+str(i) for i in range(27)]
        result, calls = self.collect('candidate', methods)
        self.assertEqual('ok', result['status']); self.assertEqual(27, len(result['records']))
        self.assertEqual(27, len(result['per_case']))
        self.assertEqual(['fresh','instrument','stop'] * 27, [x[0] for x in calls])
        self.assertEqual(27, len(list((self.out/'candidate').glob('*/receipt.json'))))
        native.validate_native((self.out/'candidate-instrumentation.txt').read_text(), methods)

    def test_failure_and_raw_protocol_retained_while_other_cases_continue(self):
        result, calls = self.collect('candidate', ['a','b','c'], {'b':(-2,'expected:<1> but was:<0>')})
        self.assertEqual('failed', result['status']); self.assertEqual(['a','b','c'], [c[1] for c in calls if c[0]=='instrument'])
        self.assertIn('expected:<1>', (self.out/'candidate/02-b/candidate-instrumentation.txt').read_text())
        self.assertTrue((self.out/'candidate/02-b/receipt.json').is_file())

    def test_setup_failure_is_not_an_expected_rejection_and_does_not_skip_next(self):
        result, calls = self.collect('rejected', ['a','b'], {'b':(-2,'exact field text')}, prep_error='a')
        self.assertEqual('failed', result['status']); self.assertEqual(['b'], [c[1] for c in calls if c[0]=='instrument'])
        self.assertEqual(2, len(result['per_case']))

    def test_rejected_both_exact_insertion_assertions_remain_required(self):
        methods = sorted(native.CONTROLS)
        result, _ = self.collect('rejected', methods, {m:(-2,'java.lang.AssertionError: exact field text') for m in methods})
        self.assertEqual('ok', result['status'])

    def test_valid_protocol_cannot_hide_failed_teardown(self):
        result, _ = self.collect('candidate', ['a'], cleanup_error='a')
        self.assertEqual('failed', result['status']); self.assertIn('cleanup_error', result['per_case']['a'])

    def test_duplicate_or_traversal_method_refused_before_activity_or_directory(self):
        for methods in (['a','a'], ['../escape'], []):
            with self.assertRaises(ValueError): isolation.collect_isolated_lane(native, None, [], 'candidate', methods, self.out, {})

    def test_real_editor_audit_rejects_prior_mode_wrong_field_and_wrong_selection(self):
        expected = {'mode':'missingNode','start':7,'end':7}
        for mode, field, start, ok in [('missingNode','1',7,True), ('acceptedDelayedPaste','1',7,False),
                                      ('missingNode','2',7,False), ('missingNode','1',0,False)]:
            (self.out/'candidate-editor.json').write_text(json.dumps({'mode':mode}))
            (self.out/'candidate-logcat.txt').write_text(
                'V A11yInputMethod: CALL: onStartInput\n'
                'I GoogleInputMethodService: GoogleInputMethodService.onStartInput():1986 '
                'onStartInput(EditorInfo{EditorInfo{packageName=ai.wizards.os.qa, inputType=20001, '
                'initialSelStart='+str(start)+', initialSelEnd=7, initialCapsMode=0, '
                'fieldId='+field+', fieldName=null}}, false)\n')
            if ok: isolation.audit_editor(self.out, 'candidate', expected)
            else:
                with self.assertRaises(AssertionError): isolation.audit_editor(self.out, 'candidate', expected)

    def test_native_budget_unwinds_past_per_case_exception_handlers(self):
        self.assertFalse(issubclass(native.NativeDeadline, Exception))
        with self.assertRaises(native.NativeDeadline): native.expire_native(None, None)

    def test_unchanged_source_first_session_contract_and_exact_27_cases(self):
        root = Path(__file__).parents[1]
        if (root/'android/app/src').exists():
            # QA branch intentionally retains its inherited Android tree. Test the
            # exact reviewed PRODUCT object, not that older incidental checkout.
            import subprocess
            from qa_dictation_native_resume import PRODUCT
            target = self.out/'product'
            for rel in ('android/app/src/androidTest/java/ai/wizards/os/everywhere/DictationInsertionE2eTest.java',
                        'android/app/src/debug/java/ai/wizards/os/everywhere/DictationEditorFixture.java'):
                path = target/rel; path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(subprocess.run(['git','show',PRODUCT+':'+rel],cwd=root,check=True,capture_output=True,text=True).stdout)
            root = target
        else:
            # A fresh live 32-case packet points at a receipt that does not exist
            # until AFTER these pre-build tests. Keep this historical 27-case
            # contract bound to its separately frozen, already-built product.
            root = isolation.historical_source(Path(__file__).with_name('historical-packet.json'))
        test = (root/'android/app/src/androidTest/java/ai/wizards/os/everywhere/DictationInsertionE2eTest.java').read_text()
        import re
        methods = re.findall(r'@Test public void (\w+)\(', test)
        contract = isolation.editor_contract(root, methods)
        self.assertEqual(27, len(contract)); self.assertEqual(27, len(set(methods)))
        self.assertEqual({'mode':'missingNode','text':'prefix ','start':7,'end':7}, contract['missingNodeWorkingInputConnectionPreservesSingleInsertion'])


if __name__ == '__main__': unittest.main()
