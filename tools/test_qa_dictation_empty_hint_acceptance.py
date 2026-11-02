#!/usr/bin/env python3
"""Browser/emulator-free controller regressions, also safe in sealed pre-build preflight."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import qa_dictation_empty_hint_acceptance as q


class AcceptanceTests(unittest.TestCase):
    def contract_fixture(self):
        """Real Git/archive Java bytes; synthetic historical metadata only, never future receipts."""
        from qa_dictation_native_resume import PRODUCT
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        root = Path(tmp.name); (root/'scratch').mkdir()
        tools = Path(__file__).parent
        rels = (q.TEST,'android/app/src/debug/java/ai/wizards/os/everywhere/DictationEditorFixture.java')
        historical = root/'historical-build'; source = historical/'source'
        manifest = {}
        if (tools/'historical-packet.json').exists():
            from qa_dictation_case_isolation import historical_source
            old_source = historical_source(tools/'historical-packet.json')
            old_bytes = {rel:(old_source/rel).read_bytes() for rel in rels}
            with tarfile.open(tools/'source.tar.gz') as archive:
                new_bytes = {}
                for rel in rels:
                    member = archive.extractfile(rel)
                    if member is None: raise ValueError('test fixture archive member missing')
                    new_bytes[rel] = member.read()
        else:
            old_bytes = {rel:subprocess.run(['git','show',PRODUCT+':'+rel],cwd=tools,check=True,capture_output=True).stdout for rel in rels}
            new_bytes = {rel:(tools.parent/rel).read_bytes() for rel in rels}
        for rel, data in old_bytes.items():
            target = source/rel; target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(data)
            manifest[rel] = {'sha256':hashlib.sha256(data).hexdigest(),'mode':0o644}
        mh = q.manifest_hash(manifest)
        (historical/'job.json').write_text(json.dumps({'revision':PRODUCT,'manifest_sha256':mh,'files':manifest}))
        (historical/'receipt.json').write_text(json.dumps({'status':'ok','host':'forum','job':str(historical),
            'source_revision':PRODUCT,'source_manifest_sha256':mh,'synthetic_unit_fixture':True}))
        import re
        old_methods = re.findall(r'@Test public void (\w+)\(', old_bytes[q.TEST].decode())
        packet = {'source_revision':PRODUCT,'candidate':{'revision':PRODUCT,'manifest_sha256':mh,
                  'receipt':str(historical/'receipt.json')},'candidate_cases':old_methods}
        (root/'historical-packet.json').write_text(json.dumps(packet))
        live = copy.deepcopy(packet); live['source_revision']='a'*40
        live['candidate'].update(receipt=str(root/'receipt.json'),revision='a'*40)
        live['candidate_cases'] += sorted(q.EXTRA)
        (root/'packet.json').write_text(json.dumps(live))
        with tarfile.open(root/'source.tar.gz','w:gz') as archive:
            import io
            for rel, data in new_bytes.items():
                member = tarfile.TarInfo(rel); member.size=len(data); archive.addfile(member,io.BytesIO(data))
        return root,live

    def test_exact_flat_historical_test_before_future_receipt_exists(self):
        root,live = self.contract_fixture()
        for name in q.MEMBERS: shutil.copyfile(Path(__file__).with_name(name),root/name)
        self.assertFalse((root/'source').exists())
        # This is the exact former FileNotFoundError setup, not a fake future build.
        with self.assertRaises(FileNotFoundError): Path(live['candidate']['receipt']).read_text()
        p = subprocess.run([sys.executable,'-m','unittest','-v',
            'test_qa_dictation_case_isolation.IsolationTests.test_unchanged_source_first_session_contract_and_exact_27_cases'],
            cwd=root,capture_output=True,text=True,timeout=30)
        self.assertEqual(0,p.returncode,p.stdout+p.stderr)
        self.assertIn('Ran 1 test',p.stderr)
        self.assertFalse((root/'receipt.json').exists()); self.assertFalse((root/'source').exists())

    def test_current_32_contract_uses_archive_before_build(self):
        root,live = self.contract_fixture()
        self.assertEqual({'historical_cases':27,'current_cases':32,'future_build_receipt_required':False},q.check_contract_inputs(root,live))
        self.assertFalse((root/'receipt.json').exists()); self.assertFalse((root/'source').exists())

    def test_historical_inputs_cannot_be_replaced_by_live_future_packet(self):
        from qa_dictation_case_isolation import historical_source
        root,live = self.contract_fixture()
        (root/'historical-packet.json').write_text(json.dumps(live))
        with self.assertRaisesRegex(ValueError,'historical product identity'): historical_source(root/'historical-packet.json')

    def test_historical_receipt_or_source_drift_refused(self):
        from qa_dictation_case_isolation import historical_source
        root,_ = self.contract_fixture()
        target = root/'historical-build/source'/q.TEST; target.write_text(target.read_text()+'// drift')
        with self.assertRaisesRegex(ValueError,'source drift'): historical_source(root/'historical-packet.json')
        receipt = root/'historical-build/receipt.json'; d=json.loads(receipt.read_text()); d['status']='failed'; receipt.write_text(json.dumps(d))
        with self.assertRaisesRegex(ValueError,'build identity'): historical_source(root/'historical-packet.json')

    def test_current_contract_rejects_missing_extra_duplicate_and_original_replacement(self):
        root,live = self.contract_fixture()
        for cases in (live['candidate_cases'][:-1],live['candidate_cases']+[live['candidate_cases'][0]],
                      live['candidate_cases'][1:]+['replacement']):
            wrong=copy.deepcopy(live); wrong['candidate_cases']=cases
            with self.assertRaises(ValueError):q.check_contract_inputs(root,wrong)

    def test_preflight_uses_same_complete_module_command_as_execute(self):
        root,_ = self.contract_fixture(); calls=[]
        def runner(argv,**kwargs):
            calls.append((argv,kwargs));kwargs['stdout'].write('Ran 73 tests in 0.1s\n\nOK\n')
            return subprocess.CompletedProcess(argv,0)
        with patch.object(q,'verify',return_value={}),patch.object(q,'check_contract_inputs',return_value={}):
            result=q.controller_preflight(root,runner=runner)
        self.assertEqual([sys.executable,'-m','unittest','-v',*q.TEST_MODULES],calls[0][0])
        self.assertEqual(root,calls[0][1]['cwd']);self.assertEqual(73,result['tests'])

    def test_current_archive_census_and_first_session_guards_not_just_packet(self):
        root,live = self.contract_fixture()
        with tarfile.open(root/'source.tar.gz') as archive:
            content = {m.name:archive.extractfile(m).read() for m in archive.getmembers()}
        import io
        for before,after in ((b'emptyHintNoopPasteRetainsTakeWithoutSecondWrite',b'replacedExtra'),
                             (b'fixture.delete();',b'/* readiness removed */')):
            with tarfile.open(root/'source.tar.gz','w:gz') as archive:
                for rel,data in content.items():
                    data=data.replace(before,after) if rel==q.TEST else data
                    member=tarfile.TarInfo(rel);member.size=len(data);archive.addfile(member,io.BytesIO(data))
            with self.assertRaises(ValueError):q.check_contract_inputs(root,live)

    def fixture(self):
        files={n:{'sha256':'new','mode':0o644} for n in q.ANDROID_DELTA}
        old=copy.deepcopy(files)
        for n in q.PRODUCT_DELTA:old[n]['sha256']='old'
        old['android/app/src/main/other.java']={'sha256':'same','mode':0o644}
        files['android/app/src/main/other.java']={'sha256':'same','mode':0o644}
        cfg={'host':'forum','tasks':q.TASKS.copy(),'revision':'a'*40,'files':files,'manifest_sha256':q.manifest_hash(files),
             'owner_config':None,'signing_env':None,'expected_signer':None,'cap_sync':False}
        proof={'revision':'a'*40,'reviewed_revision':'b'*40,'old_revision':q.OLD,'android_changed_paths':sorted(q.ANDROID_DELTA),
               'android_sha256':{n:'new' for n in q.ANDROID_DELTA},'unit_expected_tests':417,'dictation_unit_tests':21}
        return cfg,{'files':old},proof

    def test_exact_source_passes(self):
        q.check_source(*self.fixture())

    def test_generic_production_change_refused(self):
        cfg,old,proof=self.fixture();cfg['files']['android/app/src/main/other.java']['sha256']='drift'
        cfg['manifest_sha256']=q.manifest_hash(cfg['files'])
        with self.assertRaises(ValueError):q.check_source(cfg,old,proof)

    def test_missing_or_additional_product_normalization_refused(self):
        for name in q.PRODUCT_DELTA:
            cfg,old,proof=self.fixture();cfg['files'][name]=copy.deepcopy(old['files'][name])
            cfg['manifest_sha256']=q.manifest_hash(cfg['files'])
            with self.assertRaises(ValueError):q.check_source(cfg,old,proof)

    def test_owner_or_signing_or_sync_tasks_refused(self):
        for key in ('owner_config','signing_env','expected_signer','cap_sync'):
            cfg,old,proof=self.fixture();cfg[key]='unexpected'
            with self.assertRaises(ValueError):q.check_source(cfg,old,proof)
        cfg,old,proof=self.fixture();cfg['tasks']=[':app:assembleRelease']
        with self.assertRaises(ValueError):q.check_source(cfg,old,proof)

    def test_wrong_manifest_revision_unit_or_source_proof_refused(self):
        for key,value in [('revision','wrong'),('manifest_sha256','wrong')]:
            cfg,old,proof=self.fixture();cfg[key]=value
            with self.assertRaises(ValueError):q.check_source(cfg,old,proof)
        for key,value in [('unit_expected_tests',410),('dictation_unit_tests',14),('old_revision','wrong')]:
            cfg,old,proof=self.fixture();proof[key]=value
            with self.assertRaises(ValueError):q.check_source(cfg,old,proof)
        cfg,old,proof=self.fixture();proof['android_sha256'].pop(q.TEST)
        with self.assertRaises(ValueError):q.check_source(cfg,old,proof)

    def test_original_cases_plus_all_extras_once(self):
        old=['original'+str(i) for i in range(27)];new=old+sorted(q.EXTRA)
        q.check_cases(old,new)
        for wrong in (new[:-1],new+[new[0]],new[1:]+['replacement']):
            with self.assertRaises(ValueError):q.check_cases(old,wrong)

    def test_exact_opus_review_passes(self):
        proof={'reviewed_revision':'a'*40}
        review={'is_error':False,'permission_denials':[],'result':'## Verdict: PASS WITH NITS\nReviewed '+'a'*40,
                'modelUsage':{'claude-opus-5-5':{}}}
        q.check_review(review,proof)
        for key,value in [('is_error',True),('permission_denials',['denied']),('result','Verdict: FAIL; earlier PASS '+'a'*40),
                          ('result','Verdict: PASS\nwrongrevision'),('modelUsage',{'other-model':{}})]:
            wrong=copy.deepcopy(review);wrong[key]=value
            with self.assertRaises(ValueError):q.check_review(wrong,proof)


if __name__=='__main__':unittest.main()
