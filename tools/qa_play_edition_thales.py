#!/usr/bin/env python3
"""Build a prepared Android job and audit both distributions, on Thales only.

Copy this script beside a prepared worker.py/job.json and run --job that directory.
No publication, emulator or production access. All evidence stays beside the job.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

EXPECTED = '3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd'
JAVA = Path('/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home/bin')
SDK = Path('/opt/homebrew/share/android-commandlinetools')
ANDROID = '{http://schemas.android.com/apk/res/android}'
OWNER_KEYS = ('wizardOrigin', 'wizardHomeUrl', 'wizardLegacyHosts', 'wizardQaHomeUrl', 'photosServer', 'wizardDeepLinkHost')


def run(args, dest, **kw):
    p = subprocess.run([str(x) for x in args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, **kw)
    dest.write_text(p.stdout)
    if p.returncode:
        raise RuntimeError(f'{Path(str(args[0])).name} failed ({p.returncode}); see {dest}')
    return p.stdout


def dex(path):
    with zipfile.ZipFile(path) as z:
        return b''.join(z.read(n) for n in z.namelist() if re.search(r'(^|/)classes\d*\.dex$', n))


def tests(app, variant):
    paths = sorted((app / 'build/test-results' / ('test' + variant + 'UnitTest')).glob('TEST-*.xml'))
    assert paths, variant + ': missing test results'
    total = failures = errors = skipped = 0
    for p in paths:
        t = ET.parse(p).getroot()
        total += int(t.get('tests', '0'))
        failures += int(t.get('failures', '0'))
        errors += int(t.get('errors', '0'))
        skipped += int(t.get('skipped', '0'))
    assert total > 0 and failures == errors == skipped == 0, (variant, total, failures, errors, skipped)
    return {'tests': total, 'failures': failures, 'errors': errors, 'skipped': skipped}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--job', type=Path, required=True)
    ap.add_argument('--audit-only', action='store_true')
    a = ap.parse_args()
    assert sys.platform == 'darwin', 'Thales only; never build on the control plane'
    job = a.job.resolve()
    assert 'ThalesMedia' in job.parts
    # Standalone fallback and durable execution share the same lease; children inherit it.
    standalone_lock = None
    if not os.environ.get('WIZARD_HEAVY_LOCK_FD'):
        standalone_lock = (job.parent.parent / 'worker.lock').open('a')
        fcntl.flock(standalone_lock, fcntl.LOCK_EX)
        os.environ['WIZARD_HEAVY_LOCK_FD'] = str(standalone_lock.fileno())
    evidence = job / 'play-evidence'
    evidence.mkdir(exist_ok=True)
    os.umask(0o077)
    env = os.environ.copy()
    for key in OWNER_KEYS:
        env['ORG_GRADLE_PROJECT_' + key] = ''
    # Also neutralize legacy environment fallback values; no private worker defaults enter Play.
    for key in ('WIZARD_ORIGIN', 'WIZARD_DEFAULT_ORIGIN', 'WIZARD_PHOTOS_SERVER'):
        env[key] = ''
    env['JAVA_HOME'] = str(JAVA.parent)
    env['PATH'] = str(JAVA) + ':/opt/homebrew/bin:' + env.get('PATH', '')
    if not a.audit_only:
        fd = env.get('WIZARD_HEAVY_LOCK_FD')
        run([sys.executable, job / 'worker.py', '--worker', job / 'job.json'], evidence / 'build.log',
            env=env, pass_fds=(int(fd),) if fd else ())
    receipt = json.loads((job / 'receipt.json').read_text())
    assert receipt['status'] == 'ok'
    app = job / 'source/android/app'
    aab = app / 'build/outputs/bundle/playRelease/app-play-release.aab'
    apk = app / 'build/outputs/apk/sideload/release/app-sideload-release.apk'
    assert aab.is_file() and apk.is_file()
    signing = run([JAVA / 'jarsigner', '-verify', '-verbose', '-certs', aab], evidence / 'jarsigner.txt', env=env)
    assert 'jar verified.' in signing and 'unsigned entries' not in signing.lower()
    cert = run([JAVA / 'keytool', '-printcert', '-jarfile', aab], evidence / 'bundle-certificate.txt', env=env)
    fingerprints = re.findall(r'SHA256:\s*([0-9A-F:]+)', cert)
    assert len(fingerprints) == 1 and fingerprints[0].replace(':', '').lower() == EXPECTED
    bundletool = evidence / 'bundletool-all-1.18.3.jar'
    if not bundletool.exists():
        urllib.request.urlretrieve('https://github.com/google/bundletool/releases/download/1.18.3/bundletool-all-1.18.3.jar', bundletool)
    manifest = run([JAVA / 'java', '-jar', bundletool, 'dump', 'manifest', '--bundle=' + str(aab), '--module=base'], evidence / 'play-manifest.xml', env=env)
    tree = ET.fromstring(manifest)
    permissions = [n.get(ANDROID + 'name') for n in tree.findall('uses-permission')]
    assert 'android.permission.REQUEST_INSTALL_PACKAGES' not in permissions
    assert 'android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION' not in permissions
    assert 'android.permission.ENFORCE_UPDATE_OWNERSHIP' not in permissions
    assert tree.get('package') == 'ai.wizards.os'
    assert tree.get(ANDROID + 'versionCode') == '1000069'
    assert tree.get(ANDROID + 'versionName') == '0.10.5'
    for cls in ('update.InstallReceiver', 'update.UpdateBoot', 'update.UpdateJob', 'update.ApkProvider', 'apps.AppsInstallReceiver', 'apps.AppsUpdateJob'):
        assert not any((n.get(ANDROID + 'name') or '').endswith('.' + cls) for n in tree.iter())
    config_path = app / 'build/generated/source/buildConfig/play/release/ai/wizards/os/BuildConfig.java'
    config = config_path.read_text()
    (evidence / 'PlayBuildConfig.java').write_text(config)
    for field in ('ORIGIN', 'HOME_URL', 'PHOTOS_SERVER'):
        assert re.search(r'public static final String ' + field + r' = "";', config), field
    assert 'UPDATE_SIGNER' not in config
    play_dex, direct_dex = dex(aab), dex(apk)
    excluded = ['update/Updater', 'update/InstallReceiver', 'update/UpdateBoot', 'update/UpdateJob', 'update/ApkProvider',
                'apps/AppsInstaller', 'apps/AppsInstallReceiver', 'apps/AppsUpdateJob']
    for cls in excluded:
        descriptor = ('Lai/wizards/os/' + cls + ';').encode()
        assert descriptor not in play_dex, cls
        assert descriptor in direct_dex, cls
    for forbidden in (b'/reports/wizard-os/latest.json', b'Landroid/content/pm/PackageInstaller;', b'UPDATE_SIGNER'):
        assert forbidden not in play_dex, forbidden
    assert b'market://details?id=' in play_dex and b'https://play.google.com/store/apps/details?id=' in play_dex
    direct_manifest = run([SDK / 'build-tools/35.0.0/aapt2', 'dump', 'xmltree', apk, '--file', 'AndroidManifest.xml'], evidence / 'sideload-manifest.txt', env=env)
    assert 'android.permission.REQUEST_INSTALL_PACKAGES' in direct_manifest
    assert 'ai.wizards.os.update.UpdateJob' in direct_manifest
    direct_signer = run([SDK / 'build-tools/35.0.0/apksigner', 'verify', '--print-certs', apk], evidence / 'sideload-signer.txt', env=env)
    assert EXPECTED in direct_signer.lower()
    suites = {v: tests(app, v) for v in ('PlayRelease', 'SideloadRelease')}
    lint = {}
    for variant in ('playRelease', 'sideloadRelease'):
        paths = list((app / 'build/reports').glob('lint-results-' + variant + '.xml'))
        assert len(paths) == 1, (variant, paths)
        issues = list(ET.parse(paths[0]).getroot())
        errors = [i for i in issues if i.get('severity') in ('Error', 'Fatal')]
        assert not errors, (variant, errors)
        lint[variant] = {'errors': len(errors), 'warnings': sum(i.get('severity') == 'Warning' for i in issues)}
    # Verify historical task aliases never accidentally pull Play into direct-release/QA automation.
    env.update(GRADLE_USER_HOME=str(job.parent.parent / 'gradle-cache'), ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK))
    dry = run(['./gradlew', '--no-daemon', '--console=plain', '--dry-run', ':app:assembleRelease', ':app:testReleaseUnitTest', ':app:lintRelease', ':app:assembleDebug', ':app:assembleQanext', ':app:assembleQalater'], evidence / 'legacy-task-dry-run.txt', cwd=app.parent, env=env)
    assert 'Play' not in dry
    for name in ('assembleSideloadRelease', 'testSideloadReleaseUnitTest', 'lintSideloadRelease', 'assembleSideloadDebug', 'assembleSideloadQanext', 'assembleSideloadQalater'):
        assert ':app:' + name in dry, name
    result = {'status': 'ok', 'source_revision': receipt['source_revision'], 'aab_path': str(aab),
              'aab_sha256': hashlib.sha256(aab.read_bytes()).hexdigest(), 'version_code': 1000069, 'version_name': '0.10.5',
              'signer_sha256': fingerprints[0], 'application_id': 'ai.wizards.os', 'play_origin': '',
              'play_request_install_packages': False, 'play_installer_classes': False,
              'sideload_apk_path': str(apk), 'sideload_apk_sha256': hashlib.sha256(apk.read_bytes()).hexdigest(),
              'sideload_request_install_packages': True, 'sideload_updater_classes': True,
              'unit_tests': suites, 'lint': lint, 'legacy_tasks_sideload_only': True, 'published': False}
    (evidence / 'acceptance.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
