import copy
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import phone_release as release


def dex_fixture(origin=''):
    """Minimal explicit unit fixture for encoded BuildConfig fields, not an APK."""
    strings = ['Lai/wizards/os/BuildConfig;', 'Ljava/lang/String;', 'HOME_URL', 'ORIGIN', '', origin]
    data = bytearray(112 + len(strings) * 4 + 2 * 4 + 2 * 8 + 32)
    struct.pack_into('<8s', data, 0, b'dex\n035\0')
    so = 112
    to = so + len(strings) * 4
    fo = to + 8
    co = fo + 16
    struct.pack_into('<IIIIIIIIIIII', data, 56, len(strings), so, 2, to, 0, 0, 2, fo, 0, 0, 1, co)
    for i, value in enumerate(strings):
        struct.pack_into('<I', data, so + 4 * i, len(data))
        data.extend(bytes([len(value)]) + value.encode() + b'\0')
    struct.pack_into('<II', data, to, 0, 1)
    struct.pack_into('<HHIHHI', data, fo, 0, 1, 2, 0, 1, 3)
    class_data = len(data)
    data.extend(bytes([2, 0, 0, 0, 0, 25, 1, 25]))
    values = len(data)
    data.extend(bytes([2, 0x17, 4, 0x17, 5]))
    struct.pack_into('<IIIIIIII', data, co, 0, 1, 0, 0, 0, 0, class_data, values)
    return bytes(data)


class PhoneReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR'))
        self.addCleanup(self.temp.cleanup)
        self.apk = Path(self.temp.name) / 'unit-fixture.apk'
        self.apk.write_bytes(b'explicit metadata unit fixture, not an Android artifact')
        self.badging = "package: name='ai.wizards.os' versionCode='78' versionName='0.10.14' platformBuildVersionName='15'"
        self.cert = 'Signer #1 certificate SHA-256 digest: ' + release.SIGNER + '\n'
        self.fields = dict(APPLICATION_ID=release.APP, VERSION_CODE=78, VERSION_NAME='0.10.14', DEBUG=False, ORIGIN='', HOME_URL='', PHOTOS_SERVER='')
        self.commit = 'a' * 40

    def metadata(self, **kw):
        args = dict(apk=self.apk, badging=self.badging, certificates=self.cert, fields=self.fields, commit=self.commit, notes='The same phone app now pairs at first launch.', minimum='0.3.40')
        args.update(kw)
        return release.metadata(**args)

    def test_contract_from_bytes(self):
        result = self.metadata()
        self.assertEqual(set(result), {'app', 'versionCode', 'versionName', 'sha256', 'bytes', 'signer', 'asset_url', 'notes', 'min_box_snapshot', 'source_commit'})
        self.assertEqual(result['versionCode'], 78)
        self.assertEqual(result['versionName'], '0.10.14')
        self.assertEqual(result['bytes'], self.apk.stat().st_size)
        self.assertEqual(result['sha256'], release.digest(self.apk))
        self.assertEqual(result['asset_url'], 'https://github.com/humanitylabs-org/wizard-ux/releases/download/android-v0.10.14/wizard-os-0.10.14.apk')

    def test_wrong_signer_rejected(self):
        with self.assertRaises(ValueError):
            self.metadata(certificates=self.cert.replace(release.SIGNER, '0' * 64))

    def test_multiple_signers_rejected(self):
        with self.assertRaises(ValueError):
            self.metadata(certificates=self.cert + self.cert.replace('#1', '#2'))

    def test_missing_signer_rejected(self):
        with self.assertRaises(ValueError):
            self.metadata(certificates='DOES NOT VERIFY')

    def test_origin_and_home_url_rejected(self):
        for key in ('ORIGIN', 'HOME_URL', 'PHOTOS_SERVER'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.metadata(fields=dict(self.fields, **{key: 'https://unit.test'}))

    def test_missing_origin_rejected(self):
        fields = copy.copy(self.fields)
        del fields['ORIGIN']
        with self.assertRaises(ValueError):
            self.metadata(fields=fields)

    def test_application_version_and_debug_disagreement_rejected(self):
        for change in [dict(APPLICATION_ID='ai.wizards.os.qa'), dict(VERSION_CODE=77), dict(VERSION_NAME='0.10.13'), dict(DEBUG=True)]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.metadata(fields=dict(self.fields, **change))

    def test_bad_aapt_rejected(self):
        for text in ['', self.badging.replace('ai.wizards.os', 'unit.other'), self.badging.replace('0.10.14', '../evil'), self.badging.replace("versionCode='78'", "versionCode='0'")]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                self.metadata(badging=text)

    def test_source_commit_literal_format(self):
        for commit in ['ABC' * 13, 'a' * 39, 'a' * 40 + '\n', 'main']:
            with self.subTest(commit=commit), self.assertRaises(ValueError):
                self.metadata(commit=commit)

    def test_private_or_multiline_notes_rejected(self):
        for notes in ['See https://unit.test.', 'At unit.ts.net.', '/home/unit/path.', 'A.\nB.', 'unit@unit.test.', 'Missing full stop']:
            with self.subTest(notes=notes), self.assertRaises(ValueError):
                self.metadata(notes=notes)

    def test_minimum_format(self):
        with self.assertRaises(ValueError):
            self.metadata(minimum='latest')

    def test_origin_environment_rejected(self):
        release.reject_origin_environment({})
        release.reject_origin_environment({key: '' for key in release.ORIGIN_ENV})
        for key in release.ORIGIN_ENV:
            with self.subTest(key=key), self.assertRaises(ValueError):
                release.reject_origin_environment({key: 'https://unit.test'})
        with self.assertRaises(ValueError):
            release.reject_origin_environment({'GRADLE_OPTS': '-Dorg.gradle.project.wizardOrigin=https://unit.test'})

    def test_source_origin_property_rejected(self):
        source = Path(self.temp.name)
        (source / 'android').mkdir()
        p = source / 'android/gradle.properties'
        p.write_text('wizardOrigin=https://unit.test\n')
        with self.assertRaises(ValueError):
            release.reject_source_properties(source)
        p.write_text('# wizardOrigin is private\nwizardOrigin=\n')
        release.reject_source_properties(source)

    def test_dex_encoded_origin(self):
        fields = release.dex_build_config(dex_fixture())
        self.assertEqual(fields, dict(HOME_URL='', ORIGIN=''))
        self.assertEqual(release.dex_build_config(dex_fixture('https://unit.test'))['ORIGIN'], 'https://unit.test')

    def test_dex_absent_build_config(self):
        data = dex_fixture().replace(b'Lai/wizards/os/BuildConfig;', b'Lai/wizards/os/BuildConfiX;')
        self.assertIsNone(release.dex_build_config(data))

    def test_dex_bad_magic_rejected(self):
        with self.assertRaises(ValueError):
            release.dex_build_config(b'not dex')

    def test_uleb_bounds(self):
        self.assertEqual(release.uleb(bytes([0xe5, 0x8e, 0x26]), 0), (624485, 3))
        with self.assertRaises(ValueError):
            release.uleb(bytes([0x80] * 5), 0)

    def test_existing_release_not_overwritten(self):
        phone = self.metadata()
        apk = Path(self.temp.name) / 'wizard-os-0.10.14.apk'
        apk.write_bytes(self.apk.read_bytes())
        with patch.object(release.subprocess, 'run') as run:
            run.return_value.returncode = 0
            with self.assertRaisesRegex(ValueError, 'already exists'):
                release.draft(Path(self.temp.name), phone)
            self.assertEqual(run.call_count, 1)


if __name__ == '__main__':
    unittest.main()
