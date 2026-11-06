import unittest
from qa_phone_release import validate, SIGNER


class PhoneReleaseTest(unittest.TestCase):
    def config(self):
        return dict(revision='abc123', dirty=False, expected_signer=SIGNER, tasks=[':app:assembleRelease'])

    def test_exact_release(self):
        validate(self.config(), 'abc123')

    def test_revision_drift(self):
        with self.assertRaisesRegex(ValueError, 'revision drift'):
            validate(self.config(), 'other')

    def test_dirty_source(self):
        config = self.config(); config['dirty'] = True
        with self.assertRaisesRegex(ValueError, 'dirty'):
            validate(config, 'abc123')

    def test_wrong_signer(self):
        config = self.config(); config['expected_signer'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'signer'):
            validate(config, 'abc123')

    def test_unit_tests_stay_in_ci(self):
        config = self.config(); config['tasks'] = [':app:testDebugUnitTest', ':app:assembleRelease']
        with self.assertRaisesRegex(ValueError, 'CI'):
            validate(config, 'abc123')


if __name__ == '__main__':
    unittest.main()
