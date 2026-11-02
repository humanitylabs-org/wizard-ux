#!/usr/bin/env python3
"""Small offline regressions for the diagnostic (not Android/native acceptance)."""
import copy
import hashlib
from pathlib import Path
import tempfile
import json
import re
import unittest
import qa_dictation_empty_hint_diagnostic as diag

ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT/'android/app/src/androidTest/java/ai/wizards/os/everywhere/DictationInsertionE2eTest.java'
FIXTURE = ROOT/'android/app/src/debug/java/ai/wizards/os/everywhere/DictationEditorFixture.java'


def original_assertions(text):
    """Project only the explicit five additions and strengthened clipboard assertion.

    Keep the original 27-case hash frozen, rather than hashing the evolving tail
    or blessing a new hash. All original assertion bytes must still be present.
    """
    from qa_dictation_empty_hint_acceptance import EXTRA
    chunks = re.split(r'(?=    @Test public void )', text[text.index('@Test public void '):])
    matches = [re.search(r'@Test public void (\w+)\(', part) for part in chunks]
    if not all(matches): raise ValueError('test-method boundary differs')
    methods = [match.group(1) for match in matches if match is not None]
    if len(methods) != 32 or len(set(methods)) != 32 or not EXTRA.issubset(methods):
        raise ValueError('current 32-case census differs')
    tail = ''.join(part for name, part in zip(methods, chunks) if name not in EXTRA)
    added = ('        final String[] clip = {null};\n'
             '        onMain(() -> clip[0] = context.getSystemService(ClipboardManager.class).getPrimaryClip().getItemAt(0).getText().toString());\n'
             '        assertEquals("saved clipboard",clip[0]);\n')
    start = tail.index('@Test public void hintIsNotExistingTextAndSentenceCapitalizationSurvives')
    end = tail.index('    @Test public void ', start + 1)
    body = tail[start:end]
    if body.count(added) != 1: raise ValueError('strengthened hint clipboard assertion differs')
    return tail[:start] + body.replace(added, '', 1) + tail[end:]


def sample():
    pre = {'editorPackage':diag.native.PKG, 'fieldId':1,'initialStart':0,'initialEnd':0,
           'nodeShowingHint':True,'nodeFocused':True,'nodeEditable':True,
           'nodeStart':-1,'nodeEnd':-1,
           'snapshot':{'text':'','start':-1,'end':-1,'valid':False}}
    fixture = {'text':'','mode':'noopIc','commits':1,'pastes':0,'observationsDropped':0,
               'observations':[{'phase':'publish','actualStart':0,'actualEnd':0,'actualText':'',
                                'clipClass':'fixture saved','actions':[32768], 'nodeStart':-1, 'nodeEnd':-1, 'nodeShowingHint':True},
                               {'phase':'commit','clipClass':'fixture saved'}]}
    return pre, fixture


class DiagnosticTests(unittest.TestCase):
    def test_unknown_empty_hint_selection_is_observation_not_normalization(self):
        p,f=sample(); before=copy.deepcopy((p,f)); result=diag.observations(p,f)
        self.assertIn('invalid empty-hint snapshot',result['mechanism'])
        self.assertFalse(result['product_acceptance']); self.assertEqual((p,f),before)

    def test_missing_or_opaque_snapshot_never_becomes_empty_caret(self):
        for snap in (None,{'text':None,'start':-1,'end':-1,'valid':False}):
            p,f=sample();p['snapshot']=snap
            self.assertTrue(diag.observations(p,f)['mechanism'].startswith('unresolved'))

    def test_valid_snapshot_without_clip_observation_stays_unresolved(self):
        p,f=sample();p['snapshot'].update(start=0,end=0,valid=True)
        self.assertTrue(diag.observations(p,f)['mechanism'].startswith('unresolved'))

    def test_observed_wizard_clip_prevents_h1_claim(self):
        p,f=sample();f['observations'][0]['clipClass']='wizard'
        self.assertTrue(diag.observations(p,f)['mechanism'].startswith('unresolved'))
        f['observations'][0]['actions']=[]
        self.assertIn('no observed Wizard-clip node advertised',diag.observations(p,f)['mechanism'])

    def test_truncation_zero_and_multiple_dispatches_fail_closed(self):
        for mutate in (lambda f:f.update(observationsDropped=1),lambda f:f.update(observations=[]),
                       lambda f:f.update(commits=2),
                       lambda f:f['observations'].append({'phase':'paste','clipClass':'wizard'})):
            p,f=sample();mutate(f)
            with self.assertRaises(AssertionError):diag.observations(p,f)

    def test_no_hint_or_half_unknown_selection_is_not_h1(self):
        for key,value in (('nodeShowingHint',False),('nodeEnd',0),('nodeFocused',False)):
            p,f=sample();p[key]=value
            self.assertTrue(diag.observations(p,f)['mechanism'].startswith('unresolved'))

    def test_wrong_real_editor_or_selection_fails_closed(self):
        for key,value in (('fieldId',2),('editorPackage','another'),('initialStart',4)):
            p,f=sample();p[key]=value
            with self.assertRaises(AssertionError):diag.observations(p,f)

    def test_original_27_assertion_bodies_are_byte_exact(self):
        tail=original_assertions(TEST.read_text())
        self.assertEqual(hashlib.sha256(tail.encode()).hexdigest(),
                         '84dc90484b424b5233ca38b6bd2945e6c671042f348e580aca3094ad6a6631bf')
        self.assertEqual(tail.count('@Test public void '),27)

    def test_projection_never_hides_original_or_new_assertion_drift(self):
        text=TEST.read_text()
        with self.assertRaises(ValueError):
            original_assertions(text.replace('emptyHintLatePasteRetainsTakeWithoutSecondWrite', 'unreviewedReplacement'))
        with self.assertRaises(ValueError):
            original_assertions(text.replace('assertEquals("saved clipboard",clip[0]);', 'assertEquals("changed",clip[0]);'))
        changed=original_assertions(text.replace('terminal(true); inserted("Hello world ",0,1);',
                                                'terminal(false); inserted("Hello world ",0,1);', 1))
        self.assertNotEqual(hashlib.sha256(changed.encode()).hexdigest(),
                            '84dc90484b424b5233ca38b6bd2945e6c671042f348e580aca3094ad6a6631bf')

    def test_selected_methods_have_one_original_editor(self):
        contract=diag.editor_contract(ROOT,diag.METHODS)
        self.assertEqual(contract[diag.METHODS[0]],{'mode':'substring','text':'','start':0,'end':0})
        self.assertEqual(contract[diag.METHODS[1]],{'mode':'noopIc','text':'','start':0,'end':0})
        self.assertNotEqual(contract[diag.METHODS[2]]['text'],'')

    def test_observer_never_changes_advertised_capabilities(self):
        text=FIXTURE.read_text();body=text[text.index('private void observe('):text.index('private void persist(')]
        for forbidden in ('setPrimaryClip','setTextSelection','addAction','removeAction','requestFocus','commitText','performAction'):
            self.assertNotIn(forbidden,body)
        self.assertIn('observations.length() >= 64',body)
        self.assertIn('if (!emptyHintDiagnostics) return;',body)

    def test_real_preflight_capture_is_read_only(self):
        text=TEST.read_text();body=text[text.index('private void captureEmptyHintPreflight('):text.index('private static Object diagnosticSnapshot(')]
        for forbidden in ('setPrimaryClip','setTextSelection','addAction','removeAction','requestFocus','commitText','performAction'):
            self.assertNotIn(forbidden,body)
        self.assertIn('"focusedEditor"',body);self.assertIn('"nodeText"',body)

    def test_seal_verifier_detects_mutation(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);(p/'controller').write_text('original')
            (p/'job.json').write_text(json.dumps({'tasks':diag.TASKS,'revision':'test'}))
            seal={'qa_revision':'test','files':{'controller':diag.sha(p/'controller')},'prior_evidence':{}}
            (p/'empty-hint-seal.json').write_text(json.dumps(seal));diag.validate_seal(p)
            (p/'controller').write_text('changed')
            with self.assertRaises(AssertionError):diag.validate_seal(p)


if __name__=='__main__':unittest.main()
