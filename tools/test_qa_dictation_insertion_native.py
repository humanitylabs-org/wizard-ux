#!/usr/bin/env python3
"""Controller-only fixtures: these are NOT Android compilation/native acceptance."""
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('dictation_native',Path(__file__).with_name('qa_dictation_insertion_native.py'))
assert spec is not None and spec.loader is not None
native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)


def record(name,code=0,stack=''):
    return (f'INSTRUMENTATION_STATUS: class={native.CLASS}\nINSTRUMENTATION_STATUS: test={name}\n'
            f'INSTRUMENTATION_STATUS_CODE: 1\nINSTRUMENTATION_STATUS: class={native.CLASS}\n'
            f'INSTRUMENTATION_STATUS: test={name}\nINSTRUMENTATION_STATUS: stack={stack}\n'
            f'INSTRUMENTATION_STATUS_CODE: {code}\n')


class NativeProtocolTests(unittest.TestCase):
    def test_all_cases_required(self):
        self.assertEqual(2,len(native.validate_native(record('a')+record('b'),{'a','b'})))
    def test_missing_case_fails(self):
        with self.assertRaises(AssertionError): native.validate_native(record('a'),{'a','b'})
    def test_extra_case_fails(self):
        with self.assertRaises(AssertionError): native.validate_native(record('a')+record('b'),{'a'})
    def test_duplicate_case_fails(self):
        with self.assertRaises(AssertionError): native.validate_native(record('a')+record('a'),{'a','b'})
    def test_skip_is_not_pass(self):
        with self.assertRaises(AssertionError): native.validate_native(record('a',-3),{'a'})
    def test_failure_is_not_pass(self):
        with self.assertRaises(AssertionError): native.validate_native(record('a',-2),{'a'})
    def test_crash_is_not_negative_control(self):
        with self.assertRaises(AssertionError): native.validate_native(record('a',-1,'exact field text'),{'a'},True)
    def test_expected_negative_control(self):
        native.validate_native(record('a',-2,'java.lang.AssertionError: exact field text'),{'a'},True)
    def test_unrelated_failure_is_not_expected_rejection(self):
        with self.assertRaises(AssertionError): native.validate_native(record('a',-2,'service missing'),{'a'},True)
    def test_instrumentation_failure_always_fails(self):
        with self.assertRaises(AssertionError): native.validate_native(record('a')+'INSTRUMENTATION_FAILED: crash',{'a'})
    def test_start_records_not_counted_as_completed(self):
        text=f'INSTRUMENTATION_STATUS: test=a\nINSTRUMENTATION_STATUS_CODE: 1\n'
        self.assertEqual([],native.statuses(text))
    def test_multiline_failure_preserved(self):
        rows=native.statuses(record('a',-2,'AssertionError\nexact field text'))
        self.assertIn('exact field text',rows[0]['stack'])


if __name__ == '__main__': unittest.main()
