"""Lightweight import/config regression; never starts Java, Gradle or an emulator."""
import importlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import qa_paths


class QaPathsTest(unittest.TestCase):
    def test_import_has_no_self_import_cycle(self):
        loaded = importlib.reload(qa_paths)
        self.assertTrue(callable(loaded.android_sdk))
        self.assertTrue(callable(loaded.java_home))

    def test_explicit_work_volume_and_tool_env(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as scratch:
            with patch.dict(os.environ, {'WIZARD_WORK_ROOT':scratch, 'ANDROID_HOME':scratch+'/sdk', 'JAVA_HOME':scratch+'/jdk'}):
                self.assertEqual(Path(scratch).resolve(), qa_paths.required_work_root())
                self.assertEqual((Path(scratch)/'sdk').resolve(), qa_paths.android_sdk())
                self.assertEqual(str((Path(scratch)/'jdk').resolve()), qa_paths.java_home())

    def test_missing_worker_config_fails_clearly(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(SystemExit, 'WIZARD_WORK_ROOT'): qa_paths.required_work_root()
            with self.assertRaisesRegex(SystemExit, 'ANDROID_HOME'): qa_paths.android_sdk()
            with self.assertRaisesRegex(SystemExit, 'JAVA_HOME'): qa_paths.java_home()


if __name__ == '__main__': unittest.main()
