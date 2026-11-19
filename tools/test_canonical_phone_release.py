import copy
import os
from pathlib import Path
import re
import struct
import tempfile
import unittest
import unittest.mock
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

    def test_build_tools_37_signer_format(self):
        # apksigner 37 (newest on ubuntu-latest, picked by build_tools()) prints per-scheme signer lines.
        v37 = 'Number of signers: 1\nV3.0 Signer: certificate DN: CN=release\nV3.0 Signer: certificate SHA-256 digest: ' + release.SIGNER + '\n'
        self.assertEqual(self.metadata(certificates=v37)['signer'], release.SIGNER)
        with self.assertRaises(ValueError):
            self.metadata(certificates=v37.replace(release.SIGNER, '0' * 64))
        with self.assertRaises(ValueError):
            self.metadata(certificates=v37 + v37.replace('V3.0', 'V3.1').replace(release.SIGNER, 'f' * 64))
        with self.assertRaises(ValueError):
            self.metadata(certificates=v37 + self.cert)

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

    def test_ci_publish_only_after_draft_readback(self):
        phone = self.metadata()
        out = Path(self.temp.name)
        (out / 'wizard-os-0.10.14.apk').write_bytes(self.apk.read_bytes())
        draft_state = dict(url='u', isDraft=True, targetCommitish=phone['source_commit'], assets=[{'name': 'wizard-os-0.10.14.apk'}, {'name': 'phone.json'}])

        def go(good_bytes, calls):

            def fake_run(argv, **kw):
                argv = list(map(str, argv))
                calls.append(argv)
                if argv[:3] == ['gh', 'release', 'download']:
                    d = Path(argv[argv.index('--dir') + 1])
                    (d / 'wizard-os-0.10.14.apk').write_bytes(self.apk.read_bytes() if good_bytes else b'tampered')
                    release.write_json(d / 'phone.json', phone)
                return unittest.mock.Mock(returncode=1 if argv[:3] == ['gh', 'release', 'view'] else 0)
            states = iter([draft_state, dict(draft_state, isDraft=False)])
            with patch.object(release.subprocess, 'run', side_effect=fake_run), \
                    patch.object(release, 'text', side_effect=lambda *a, **k: release.json.dumps(next(states))):
                try:
                    release.draft(out, phone, publish=True)
                finally:
                    import shutil
                    shutil.rmtree(out / 'draft-readback', ignore_errors=True)
            return calls
        calls = go(True, [])
        create = next(c for c in calls if c[:3] == ['gh', 'release', 'create'])
        self.assertIn('--draft', create)
        self.assertNotIn('--latest', create)
        self.assertEqual(calls[-1][:3], ['gh', 'release', 'edit'])
        self.assertIn('--draft=false', calls[-1])
        self.assertIn('--latest', calls[-1])
        captured = []
        with self.assertRaisesRegex(ValueError, 'bytes readback'):
            go(False, captured)
        self.assertTrue(any(c[:3] == ['gh', 'release', 'create'] for c in captured))
        self.assertFalse(any(c[:3] == ['gh', 'release', 'edit'] for c in captured), 'never published after a failed readback')

    def test_tester_lane_publishes_a_prerelease_never_latest(self):
        # wizard-os#720: with release lanes on, the CI build is a prerelease that boxes (releases/latest) ignore.
        phone = self.metadata()
        out = Path(self.temp.name)
        (out / 'wizard-os-0.10.14.apk').write_bytes(self.apk.read_bytes())
        draft_state = dict(url='u', isDraft=True, targetCommitish=phone['source_commit'], assets=[{'name': 'wizard-os-0.10.14.apk'}, {'name': 'phone.json'}])
        calls = []

        def fake_run(argv, **kw):
            argv = list(map(str, argv))
            calls.append(argv)
            if argv[:3] == ['gh', 'release', 'download']:
                d = Path(argv[argv.index('--dir') + 1])
                (d / 'wizard-os-0.10.14.apk').write_bytes(self.apk.read_bytes())
                release.write_json(d / 'phone.json', phone)
            return unittest.mock.Mock(returncode=1 if argv[:3] == ['gh', 'release', 'view'] else 0)
        for published, ok in [(dict(draft_state, isDraft=False, isPrerelease=True), True), (dict(draft_state, isDraft=False, isPrerelease=False), False)]:
            calls.clear()
            states = iter([draft_state, published])
            import shutil
            shutil.rmtree(out / 'draft-readback', ignore_errors=True)
            with patch.object(release.subprocess, 'run', side_effect=fake_run), \
                    patch.object(release, 'text', side_effect=lambda *a, **k: release.json.dumps(next(states))):
                if ok:
                    release.draft(out, phone, publish=True, prerelease=True)
                else:
                    with self.assertRaisesRegex(ValueError, 'lane readback'):
                        release.draft(out, phone, publish=True, prerelease=True)
            edit = calls[-1]
            self.assertEqual(edit[:3], ['gh', 'release', 'edit'])
            self.assertIn('--prerelease', edit)
            self.assertIn('--latest=false', edit)
            self.assertNotIn('--latest', edit)

    def test_public_release_file(self):
        root = Path(release.__file__).parent.parent
        data = release.json.loads((root / 'android/public-release.json').read_text())
        release.public_target(data)
        good = dict(versionName='0.10.60', versionCode=124, sha256='ab' * 32)
        release.public_target(good)
        for bad in [dict(good, versionCode='124'), dict(good, versionCode=True), dict(good, sha256='AB' * 32), dict(good, versionName='0.10'),
                    dict(good, extra=1), {k: v for k, v in good.items() if k != 'sha256'}, []]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                release.public_target(bad)
        owners = (root / '.github/CODEOWNERS').read_text()
        rules = dict(line.split(None, 1) for line in owners.splitlines() if line.strip() and not line.startswith('#'))
        self.assertEqual(rules.get('/android/public-release.json').split(), ['@jdefleur', '@JanMesaric', '@mistermizel'])

    def promote_fixture(self, *, tester=None, public='android-v0.10.13', public_code=77, apk_bytes=None, want=None, audit_cert=None):
        """Runs promote() against a fake gh: tester android-v0.10.14 (prerelease), public release `public`."""
        phone = self.metadata()
        apk_bytes = self.apk.read_bytes() if apk_bytes is None else apk_bytes
        root = Path(self.temp.name)
        public_file = root / 'public-release.json'
        release.write_json(public_file, want or {k: phone[k] for k in release.PUBLIC_KEYS})
        tester = dict(isDraft=False, isPrerelease=True, assets=[{'name': 'wizard-os-0.10.14.apk'}, {'name': 'phone.json'}]) if tester is None else tester
        latest = [public]
        calls = []

        def fake_text(argv, **kw):
            argv = list(map(str, argv))
            if argv[:2] == ['gh', 'api']:
                return release.json.dumps(dict(tag_name=latest[0]))
            if argv[:3] == ['gh', 'release', 'view']:
                return release.json.dumps(tester)
            raise AssertionError(argv)

        def fake_run(argv, **kw):
            argv = list(map(str, argv))
            calls.append(argv)
            if argv[:3] == ['gh', 'release', 'download']:
                d = Path(argv[argv.index('--dir') + 1])
                if argv[3] == 'android-v0.10.14':
                    (d / 'wizard-os-0.10.14.apk').write_bytes(apk_bytes)
                    release.write_json(d / 'phone.json', phone)
                else:
                    release.write_json(d / 'phone.json', dict(app=release.APP, versionCode=public_code))
            if argv[:3] == ['gh', 'release', 'edit']:
                tester.update(isPrerelease=False)
                latest[0] = argv[3]
            return unittest.mock.Mock(returncode=0)
        args = unittest.mock.Mock(public=public_file, output=root / 'promote')
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'true'}), \
                patch.object(release, 'run', side_effect=fake_run), patch.object(release, 'text', side_effect=fake_text), \
                patch.object(release, 'audit', return_value=(self.badging, audit_cert or self.cert, self.fields)):
            release.promote(args)
        return calls

    def test_promote_flips_the_same_tester_bytes_to_latest(self):
        calls = self.promote_fixture()
        edits = [c for c in calls if c[:3] == ['gh', 'release', 'edit']]
        self.assertEqual(len(edits), 1)
        self.assertEqual(edits[0][3], 'android-v0.10.14')
        self.assertIn('--prerelease=false', edits[0])
        self.assertIn('--latest', edits[0])
        self.assertFalse(any(c[:3] in (['gh', 'release', 'create'], ['gh', 'release', 'upload']) for c in calls), 'promotion never uploads bytes')

    def test_promote_is_a_no_op_when_already_public(self):
        self.assertEqual(self.promote_fixture(public='android-v0.10.14'), [])

    def test_promote_refuses_anything_but_the_exact_tester_build(self):
        phone = self.metadata()
        want = {k: phone[k] for k in release.PUBLIC_KEYS}
        cases = [
            ('other bytes', dict(apk_bytes=b'a different APK'), 'bytes do not match'),
            ('wrong sha in file', dict(want=dict(want, sha256='0' * 64)), 'does not match the tester build'),
            ('wrong code in file', dict(want=dict(want, versionCode=79)), 'does not match the tester build'),
            ('draft', dict(tester=dict(isDraft=True, isPrerelease=True, assets=[])), 'draft'),
            ('not a tester build', dict(tester=dict(isDraft=False, isPrerelease=False, assets=[])), 'not a tester build'),
            ('extra asset', dict(tester=dict(isDraft=False, isPrerelease=True, assets=[{'name': 'wizard-os-0.10.14.apk'}, {'name': 'phone.json'}, {'name': 'x'}])), 'assets'),
            ('not newer than public', dict(public_code=78), 'versionCode must rise'),
        ]
        for label, kw, message in cases:
            import shutil
            shutil.rmtree(Path(self.temp.name) / 'promote', ignore_errors=True)
            with self.subTest(label), self.assertRaisesRegex(ValueError, message):
                self.promote_fixture(**kw)

    def test_promote_rejects_a_foreign_signer(self):
        with self.assertRaisesRegex(ValueError, 'signer'):
            self.promote_fixture(audit_cert='Signer #1 certificate SHA-256 digest: ' + 'f' * 64 + '\n')

    def test_promote_workflow_is_off_until_lanes_are_on(self):
        root = Path(release.__file__).parent.parent
        wf = (root / '.github/workflows/phone-promote.yml').read_text()
        self.assertIn("    if: vars.WOS_RELEASE_LANES == 'on' && github.ref == 'refs/heads/main'\n", wf)
        self.assertIn("paths: ['android/public-release.json']", wf)
        self.assertNotIn('secrets.', wf)
        self.assertNotRegex(wf, r'(?m)^\s+environment:')
        self.assertIn('tools/phone_release.py promote --public android/public-release.json', wf)
        self.assertIn('group: phone-release-refs/heads/main', wf)
        for use in re.findall(r'uses: (\S+)', wf):
            self.assertRegex(use, r'@[0-9a-f]{40}$')
        _, jobs = self.ci_workflow_jobs()
        self.assertIn('LANES: ${{ vars.WOS_RELEASE_LANES }}', jobs['publish'])
        self.assertIn('if [ "$LANES" = on ]; then extra+=(--prerelease); fi', jobs['publish'])

    def test_ci_needs_a_rising_version_code(self):
        phone = self.metadata()
        release.newer_than(phone, None)
        release.newer_than(phone, dict(app=release.APP, versionCode=77))
        for previous in [dict(app=release.APP, versionCode=78), dict(app=release.APP, versionCode=90), dict(app='other', versionCode=1), dict(app=release.APP)]:
            with self.subTest(previous=previous), self.assertRaises(ValueError):
                release.newer_than(phone, previous)

    def test_ci_picks_newest_runner_build_tools(self):
        sdk = Path(self.temp.name) / 'sdk'
        for version, tools in [('34.0.0', ('aapt2', 'apksigner')), ('35.0.0', ('aapt2', 'apksigner')), ('9.0.0', ('aapt2', 'apksigner')), ('36.0.0', ('aapt2',))]:
            d = sdk / 'build-tools' / version
            d.mkdir(parents=True)
            for t in tools:
                (d / t).write_text('')
        self.assertEqual(release.build_tools(sdk).name, '35.0.0')
        with self.assertRaises(ValueError):
            release.build_tools(Path(self.temp.name) / 'none')

    def test_ci_runs_only_in_actions(self):
        args = unittest.mock.Mock()
        with patch.dict(os.environ, {'GITHUB_ACTIONS': ''}), self.assertRaisesRegex(ValueError, 'GitHub Actions'):
            release.ci(args)

    @staticmethod
    def ci_workflow_jobs():
        wf = (Path(release.__file__).parent.parent / '.github/workflows/phone-release.yml').read_text()
        body = wf.split('\njobs:\n', 1)[1]
        parts = re.split(r'^  ([a-z]+):\n', body, flags=re.M)
        return wf, dict(zip(parts[1::2], parts[2::2]))

    def test_ci_workflow_is_off_until_switched_on(self):
        wf, jobs = self.ci_workflow_jobs()
        self.assertEqual(list(jobs), ['regression', 'build', 'sign', 'publish'])
        gate = "vars.WOS_PHONE_CI_RELEASE == 'on' && github.event_name != 'pull_request' && github.ref == 'refs/heads/main'"
        for name in ('sign', 'publish'):
            self.assertIn('    if: ' + gate + " && needs.build.outputs.new == 'true'", jobs[name])
        build_if = re.search(r'^    if: (.*)$', jobs['build'], re.M).group(1)
        self.assertNotIn('pull_request', build_if, 'pull requests run only the unit fixtures')
        self.assertEqual(build_if.count("vars.WOS_PHONE_CI_RELEASE == 'on'"), 1, 'push builds only once switched on')
        self.assertIn('tools/phone_release.py ci --publish', jobs['publish'])
        self.assertIn('rm -f "$RUNNER_TEMP/wos-release.keystore"', jobs['sign'])

    def test_ci_signing_key_reaches_only_the_sign_job(self):
        # ux#1551 / wizard-os#680: Gradle and tools/ are project code, so they never share a job with the key.
        wf, jobs = self.ci_workflow_jobs()
        self.assertEqual(wf.count('secrets.'), 4)
        self.assertEqual(jobs['sign'].count('secrets.'), 4)
        self.assertEqual(wf.count('environment:'), 1)
        self.assertIn('    environment: phone-release\n', jobs['sign'])
        sign = jobs['sign']
        for banned in ('actions/checkout', 'setup-java', 'setup-gradle', 'gradlew', 'python', 'github.token', 'GH_TOKEN'):
            self.assertNotIn(banned, sign, banned)
        self.assertNotRegex(sign, r'(?<![-\w])tools/', 'no repository scripts in the sign job')
        uses = re.findall(r'uses: (\S+)', sign)
        self.assertEqual({u.split('@')[0] for u in uses}, {'actions/download-artifact', 'actions/upload-artifact'})
        for u in uses:
            self.assertRegex(u, r'@[0-9a-f]{40}$', 'third-party actions in the sign job are pinned by full SHA')
        self.assertIn('    permissions: {}\n', sign)
        self.assertIn('apksigner" sign', sign)
        self.assertNotIn('WOS_KEYSTORE', jobs['build'].replace('test -z "${WOS_KEYSTORE-}"', '').replace('WOS_KEYSTORE must not be set', '').replace('No WOS_KEYSTORE here', ''))
        self.assertIn('app-release-unsigned.apk', jobs['build'])
        self.assertIn('    needs: [build, sign]\n', jobs['publish'])
        self.assertIn('contents: write', jobs['publish'])
        self.assertIn('--apk "$RUNNER_TEMP/signed/app-release.apk"', jobs['publish'])

    def test_codeowners_cover_the_release_pipeline(self):
        owners = (Path(release.__file__).parent.parent / '.github/CODEOWNERS').read_text()
        rules = dict(line.split(None, 1) for line in owners.splitlines() if line.strip() and not line.startswith('#'))
        # James must own every release path and CODEOWNERS itself stays James only; the only other
        # owner allowed beside him is the one .github/CODEOWNERS already lists (Oscar).
        for path in ('/.github/**', '/tools/phone_release.py'):
            owners_for_path = (rules.get(path) or '').split()
            self.assertIn('@jdefleur', owners_for_path, path)
            self.assertTrue(set(owners_for_path) <= {'@jdefleur', '@oscarhenrycollins'}, path)
        self.assertEqual(rules.get('/.github/CODEOWNERS'), '@jdefleur')

    def test_signing_env_cannot_undo_isolated_gradle_home(self):
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            signing = Path(tmp) / 'signing.env'
            signing.write_text('GRADLE_OPTS="-Xmx2g -Dgradle.user.home=/shared/owner-gradle"\n')
            home = Path(tmp) / 'iso home'
            cmd = release.isolated_command(signing, home, 'false', ['/bin/sh', '-c', 'printf %s "$GRADLE_OPTS"'])
            opts = subprocess.run(['/bin/bash', '-c', cmd], env={'PATH': os.environ['PATH']}, capture_output=True, text=True, check=True).stdout
            self.assertIn('-Xmx2g', opts)
            self.assertTrue(opts.endswith('-Dgradle.user.home=' + str(home)), opts)  # the JVM keeps the last -D

    def test_toolchain_paths_come_from_env(self):
        self.assertTrue(release.DEFAULT_JAVA17_HOME and release.DEFAULT_ANDROID_HOME and release.DEFAULT_WORKER_PYTHON)
        src = Path(release.__file__).read_text()
        self.assertEqual(src.count('/opt/homebrew/'), 3, 'Homebrew paths live only in the overridable defaults')

if __name__ == '__main__':
    unittest.main()
