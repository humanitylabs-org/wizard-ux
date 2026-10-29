"""Controller-only regressions; generated DEX/APK bytes below are explicit fixtures.
No Android build, signer claim or device behavior is simulated as real evidence.
"""
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from apk_build_config import apk_build_config, dex_build_config
from publish_owner_phone import APP, SIGNER, audit, owner_origin, promote

ORIGIN = 'https://owner.example.ts.net'


def leb(n):
    out = bytearray()
    while n > 127:
        out.append((n & 127) | 128)
        n >>= 7
    return bytes(out + bytes([n]))


def dex_fixture(fields):
    """Minimal encoded BuildConfig unit fixture, not runnable Android code."""
    names = sorted(fields)
    strings = ['Lai/wizards/os/BuildConfig;', 'Ljava/lang/String;', *names]
    for v in fields.values():
        if isinstance(v, str) and v not in strings:
            strings.append(v)
    so, to = 112, 112 + len(strings) * 4
    fo, co = to + 8, to + 8 + len(names) * 8
    data = bytearray(co + 32)
    data[:8] = b'dex\n035\0'
    struct.pack_into('<IIIIIIIIIIII', data, 56, len(strings), so, 2, to, 0, 0, len(names), fo, 0, 0, 1, co)
    for i, s in enumerate(strings):
        struct.pack_into('<I', data, so + 4 * i, len(data))
        data.extend(leb(len(s)) + s.encode() + b'\0')
    struct.pack_into('<II', data, to, 0, 1)
    for i, name in enumerate(names):
        struct.pack_into('<HHI', data, fo + 8 * i, 0, 1, strings.index(name))
    class_data = len(data)
    data.extend(leb(len(names)) + b'\0\0\0')
    for i in range(len(names)):
        data.extend(leb(0 if i == 0 else 1) + leb(25))
    values = len(data)
    data.extend(leb(len(names)))
    for name in names:
        v = fields[name]
        if type(v) is bool:
            data.append(0x3f if v else 0x1f)
        elif type(v) is int:
            data.extend(b'\x64' + struct.pack('<I', v))
        else:
            idx = strings.index(v)
            width = max(1, (idx.bit_length() + 7) // 8)
            data.extend(bytes([0x17 | ((width - 1) << 5)]) + idx.to_bytes(width, 'little'))
    struct.pack_into('<IIIIIIII', data, co, 0, 1, 0, 0, 0, 0, class_data, values)
    return bytes(data)


class OwnerReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR'))
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.settings = self.root / 'settings.json'
        self.settings.write_text(json.dumps({'network': {'base_url': ORIGIN}}))
        self.apk = self.root / 'fixture.apk'
        self.receipt = self.root / 'receipt.json'
        self.feed = self.root / 'feed'
        self.feed.mkdir()
        self.prior = b'{"versionCode":81,"version":"0.10.17"}\n'
        (self.feed / 'latest.json').write_bytes(self.prior)
        self.fields = dict(APPLICATION_ID=APP, VERSION_CODE=82, VERSION_NAME='0.10.18',
                           BUILD_TYPE='release', DEBUG=False, ORIGIN=ORIGIN,
                           HOME_URL=ORIGIN + '/wizard-os-home/', UPDATE_SIGNER=SIGNER)
        self.build()

    def build(self, **changes):
        self.fields.update(changes)
        with zipfile.ZipFile(self.apk, 'w') as z:
            z.writestr('classes.dex', dex_fixture(self.fields))
            # A decoy hostname proves that substring scanning would be unsafe.
            z.writestr('assets/decoy.txt', ORIGIN)
        blob = self.apk.read_bytes()
        self.record = dict(status='ok', source_revision='a' * 40, artifacts=[dict(
            sha256=hashlib.sha256(blob).hexdigest(), bytes=len(blob), signer_sha256=SIGNER,
            aapt2=dict(package=APP, version_code=82, version_name='0.10.18'))])
        self.receipt.write_text(json.dumps(self.record))

    def run_publish(self, publish=True):
        return promote(self.apk, self.receipt, self.settings, self.feed, 'Fixture release.', publish)

    def unchanged(self):
        self.assertEqual((self.feed / 'latest.json').read_bytes(), self.prior)
        self.assertEqual(list(self.feed.iterdir()), [self.feed / 'latest.json'])

    def test_app_update_never_signs_the_owner_out_from_a_pre_pref_build(self):
        # James skipped the migration release: the old APK knew its origin but
        # never created wizard_server/origin. No persisted origin may be assumed.
        old_fields = dex_build_config(dex_fixture(dict(ORIGIN=ORIGIN)))
        assert old_fields is not None
        self.assertEqual(old_fields['ORIGIN'], owner_origin(self.settings))
        self.build(ORIGIN='', HOME_URL='')
        with self.assertRaisesRegex(ValueError, 'pre-preference phones would open Connect'):
            self.run_publish()
        self.unchanged()
        # The permitted artifact supplies the fallback consumed by ServerSettings.
        self.build(ORIGIN=ORIGIN, HOME_URL=ORIGIN + '/wizard-os-home/')
        self.assertEqual(self.run_publish()['status'], 'published')
        self.assertEqual(apk_build_config(self.feed / 'wizard-os-0.10.18.apk')['ORIGIN'], old_fields['ORIGIN'])

    def test_wrong_nonempty_origin_is_also_refused(self):
        self.build(ORIGIN='https://another.example')
        with self.assertRaisesRegex(ValueError, 'ORIGIN'):
            self.run_publish()
        self.unchanged()

    def test_missing_origin_fails_closed(self):
        del self.fields['ORIGIN']
        self.build()
        with self.assertRaisesRegex(ValueError, 'ORIGIN'):
            self.run_publish()
        self.unchanged()

    def test_dry_audit_never_writes_the_feed(self):
        self.assertEqual(self.run_publish(False)['status'], 'audit-only')
        self.unchanged()

    def test_settings_are_read_at_publish_not_embedded_in_source(self):
        self.settings.write_text(json.dumps({'network': {'base_url': 'https://moved.example'}}))
        with self.assertRaisesRegex(ValueError, 'ORIGIN'):
            self.run_publish()
        self.unchanged()

    def test_settings_are_rechecked_under_publication_lock(self):
        real_audit = audit
        calls = []
        def move_after_first_audit(*args):
            result = real_audit(*args)
            calls.append(1)
            if len(calls) == 1:
                self.settings.write_text(json.dumps({'network': {'base_url': 'https://moved.example'}}))
            return result
        with patch('publish_owner_phone.audit', side_effect=move_after_first_audit):
            with self.assertRaisesRegex(ValueError, 'ORIGIN'):
                self.run_publish()
        self.assertEqual((self.feed / 'latest.json').read_bytes(), self.prior)
        self.assertFalse((self.feed / 'wizard-os-0.10.18.apk').exists())

    def test_published_bytes_are_the_audited_snapshot_not_a_changed_input_file(self):
        original = self.apk.read_bytes()
        real_audit = audit
        def replace_input_after_audit(*args):
            result = real_audit(*args)
            self.apk.write_bytes(b'changed after admission')
            return result
        with patch('publish_owner_phone.audit', side_effect=replace_input_after_audit):
            self.run_publish()
        self.assertEqual((self.feed / 'wizard-os-0.10.18.apk').read_bytes(), original)

    def test_missing_or_malformed_owner_config_fails_closed(self):
        for value in ['', 'http://owner.example', ORIGIN + '/', ORIGIN + ':443', ORIGIN + '/wizard-os-home/', 'https://u:p@owner.example', ORIGIN + '?x=1']:
            self.settings.write_text(json.dumps({'network': {'base_url': value}}))
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.run_publish()
            self.unchanged()
        self.settings.unlink()
        with self.assertRaises(OSError):
            self.run_publish()
        self.unchanged()

    def test_home_package_debug_and_signer_must_agree(self):
        for change in [dict(HOME_URL=''), dict(APPLICATION_ID=APP + '.qa'), dict(DEBUG=True), dict(UPDATE_SIGNER='0' * 64), dict(BUILD_TYPE='debug')]:
            saved = self.fields.copy()
            self.build(**change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.run_publish()
            self.unchanged()
            self.fields = saved

    def test_receipt_must_pin_exact_bytes_signer_and_version(self):
        for key, value in [('sha256', '0' * 64), ('signer_sha256', '0' * 64), ('bytes', 1), ('aapt2', {})]:
            record = json.loads(json.dumps(self.record))
            record['artifacts'][0][key] = value
            self.receipt.write_text(json.dumps(record))
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.run_publish()
            self.unchanged()

    def test_failed_or_prepared_receipt_is_not_a_release(self):
        for state in ['prepared', 'failed', 'started']:
            self.record['status'] = state
            self.receipt.write_text(json.dumps(self.record))
            with self.subTest(state=state), self.assertRaises(ValueError):
                self.run_publish()
            self.unchanged()

    def test_feed_is_promoted_only_after_exact_apk_and_backup(self):
        result = self.run_publish()
        meta = json.loads((self.feed / 'latest.json').read_text())
        self.assertEqual(result['sha256'], meta['sha256'])
        self.assertEqual((self.feed / meta['url']).read_bytes(), self.apk.read_bytes())
        self.assertEqual((self.feed / 'latest.json.bak-81').read_bytes(), self.prior)
        with self.assertRaisesRegex(ValueError, 'non-newer'):
            self.run_publish()

    def test_conflicting_versioned_artifact_is_not_overwritten(self):
        p = self.feed / 'wizard-os-0.10.18.apk'
        p.write_bytes(b'other release')
        with self.assertRaisesRegex(ValueError, 'different versioned APK'):
            self.run_publish()
        self.assertEqual(p.read_bytes(), b'other release')
        self.assertEqual((self.feed / 'latest.json').read_bytes(), self.prior)

    def test_staging_failure_does_not_promote_feed(self):
        with patch('publish_owner_phone.atomic_write', side_effect=OSError('fixture failure')):
            with self.assertRaises(OSError):
                self.run_publish()
        self.assertEqual((self.feed / 'latest.json').read_bytes(), self.prior)

    def test_dex_metadata_must_be_unique_not_decoy_strings(self):
        with zipfile.ZipFile(self.apk, 'a') as z:
            z.writestr('classes2.dex', dex_fixture(self.fields))
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            apk_build_config(self.apk)

    def test_cli_refusal_is_nonzero_and_does_not_disclose_owner(self):
        self.build(ORIGIN='', HOME_URL='')
        p = subprocess.run([sys.executable, str(Path(__file__).with_name('publish_owner_phone.py')),
                            '--apk', str(self.apk), '--receipt', str(self.receipt), '--settings', str(self.settings),
                            '--feed-dir', str(self.feed), '--notes', 'Fixture release.', '--publish'], capture_output=True, text=True)
        self.assertEqual(p.returncode, 1)
        self.assertNotIn(ORIGIN, p.stdout + p.stderr)
        self.unchanged()


if __name__ == '__main__':
    unittest.main()
