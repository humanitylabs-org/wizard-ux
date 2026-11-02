"""Controller-only candidate custody refusal tests; no Android/emulator execution."""
import copy
import hashlib
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
import qa_dictation_candidate_resume as resume


class CustodyTests(unittest.TestCase):
    def setUp(self):
        self.before = {name:{'sha256':'old','mode':0o664} for name in resume.SOURCE_DELTA}
        self.before['android/app/src/main/java/Policy.java'] = {'sha256':'same','mode':0o664}
        self.after = copy.deepcopy(self.before)
        for name in resume.SOURCE_DELTA: self.after[name]['sha256'] = 'new'

    def test_only_exact_review_fix_is_allowed(self):
        resume.reviewed_delta(self.before,self.after)

    def test_unchanged_source_refused(self):
        with self.assertRaises(ValueError): resume.reviewed_delta(self.before,self.before)

    def test_unreviewed_production_change_refused(self):
        self.after['android/app/src/main/java/Policy.java']['sha256'] = 'unsafe'
        with self.assertRaises(ValueError): resume.reviewed_delta(self.before,self.after)

    def test_missing_member_refused(self):
        del self.after['android/app/src/main/java/Policy.java']
        with self.assertRaises(ValueError): resume.reviewed_delta(self.before,self.after)

    def test_extra_member_refused(self):
        self.after['unreviewed'] = {'sha256':'new','mode':0o664}
        with self.assertRaises(ValueError): resume.reviewed_delta(self.before,self.after)

    def test_mode_change_refused(self):
        self.after[resume.TEST]['mode'] = 0o777
        with self.assertRaises(ValueError): resume.reviewed_delta(self.before,self.after)

    def test_wrong_parent_and_asset_tree_refused(self):
        proof={'old_revision':resume.OLD_PRODUCT,'commit_chain':[resume.OLD_PRODUCT,'e'*40],
               'new_revision':'e'*40,'changed_paths':sorted(resume.SOURCE_DELTA),
               'changed_file_sha256':{name:'new' for name in resume.SOURCE_DELTA},
               'unchanged_trees':{'android/app/src/main/assets':['a','a'],'web':['b','b']},
               'old_unit_tests':406,'old_clip_tests':4,'new_clip_tests':8}
        resume.check_proof(proof,self.after)
        for mutate in (lambda p:p.update(commit_chain=['f'*40,'e'*40]),
                       lambda p:p['unchanged_trees'].update(web=['old','changed']),
                       lambda p:p.update(changed_paths=['other-test']),
                       lambda p:p['changed_file_sha256'].update({resume.TEST:'wrong'})):
            unsafe=copy.deepcopy(proof); mutate(unsafe)
            with self.assertRaises(ValueError): resume.check_proof(unsafe,self.after)

    def test_archive_bytes_and_modes_are_measured(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'source.tar.gz'
            with tarfile.open(path,'w:gz') as archive:
                item=tarfile.TarInfo('file');item.mode=0o664;item.size=5
                archive.addfile(item,io.BytesIO(b'bytes'))
            self.assertEqual({'file':{'sha256':hashlib.sha256(b'bytes').hexdigest(),'mode':0o664}},resume.archive_files(path))

    def test_archive_link_escape_and_duplicate_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'source.tar.gz'
            for name, kind, duplicate in (('../escape',tarfile.REGTYPE,False),
                                           ('file',tarfile.SYMTYPE,False),
                                           ('file',tarfile.REGTYPE,True)):
                with tarfile.open(path,'w:gz') as archive:
                    item=tarfile.TarInfo(name); item.type=kind;item.linkname='foreign'
                    archive.addfile(item)
                    if duplicate: archive.addfile(item)
                with self.assertRaises(ValueError): resume.archive_files(path)


if __name__ == '__main__': unittest.main()
