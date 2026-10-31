#!/usr/bin/env python3
"""Sealed forum-only release gate; reuses build/share/Connect runners and never publishes.

The parent admits this ONE packet with wizard_heavy_submit(host='forum'); the queue lease is the
approval boundary. Fresh emulators and synthetic fixtures only; the owner origin is metadata.
Published 82 is origin-less, so upgrade pairing is an explicitly labelled synthetic fixture.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

RESERVE = 214748364800
# Two Gradle working sets (12 GiB), two fresh unretained AVDs (6 GiB), APK/logs/screens (1 GiB),
# job-local Playwright package + baseline + staging (1 GiB). Browser binaries are the shared pinned cache.
FOOTPRINT = 20 * 1024**3
SIGNER = '3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd'
BASELINE = '5e8be00bd7161e07786e7d716698d4c12cc8450f12c8ab7f3906a97009d3161d'


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def capacity(free):
    return dict(free_bytes=free, reserve_bytes=RESERVE, footprint_bytes=FOOTPRINT,
                pass_gate=free >= RESERVE + FOOTPRINT)


def verify(root, expected):
    if sha(root / 'packet-seal.json') != expected:
        raise ValueError('packet seal drift')
    seal = json.loads((root / 'packet-seal.json').read_text())
    for name, digest in seal['files'].items():
        path = Path(name)
        if (not path.is_absolute() or '..' in path.parts or not name.startswith('/srv/work/')
                or path.is_symlink() or not path.is_file() or sha(path) != digest):
            raise ValueError('sealed input drift: ' + name)
    cfg = json.loads((root / 'packet.json').read_text())
    if seal['revision'] != cfg['revision'] or cfg['host'] != 'forum' or cfg['version_code'] != 86:
        raise ValueError('packet source/host/version mismatch')
    return cfg


def junit(path):
    totals = dict(tests=0, failures=0, errors=0, skipped=0)
    for xml in path.glob('TEST-*.xml'):
        node = ET.parse(xml).getroot()
        for key in totals:
            totals[key] += int(node.get(key, '0'))
    if totals != dict(tests=392, failures=0, errors=0, skipped=0):
        raise ValueError('Full reconciled-head JUnit mismatch: ' + json.dumps(totals))
    return totals


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seal-sha256', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    if os.uname().nodename != 'forum' or not root.is_relative_to('/srv/work/AndroidBuilds/jobs'):
        raise SystemExit('forum durable jobs only')
    fd = int(os.environ['WIZARD_HEAVY_LOCK_FD'])
    actual = os.fstat(fd)
    expected = Path('/srv/work/heavy/production/worker.lock').stat()
    if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino):
        raise SystemExit('wrong durable heavy lease')
    cfg = verify(root, args.seal_sha256)
    deps = json.loads((root / 'browser-deps-manifest.json').read_text())
    for name, digest in deps.items():
        path = root / 'browser-deps/node_modules' / name
        if path.is_symlink() or not path.is_file() or sha(path) != digest:
            raise SystemExit('sealed browser dependency drift')
    space = capacity(shutil.disk_usage(root).free)
    if not space['pass_gate']:
        raise SystemExit('200 GiB reserve PLUS full sealed footprint required')
    release, debug = Path(cfg['release_job']), Path(cfg['debug_job'])
    for job in (release, debug):
        child = json.loads((job / 'job.json').read_text())
        if child['revision'] != cfg['revision'] or child['host'] != 'forum' or (job / 'source').exists() or (job / 'receipt.json').exists():
            raise SystemExit('child source identity drift or previously executed packet')
    signing = Path.home() / '.wizard-secure/wizard-os/signing.env'
    release_cfg = json.loads((release / 'job.json').read_text())
    if (release_cfg['signing_env'] != str(signing) or release_cfg['expected_signer'] != SIGNER
            or not signing.is_file() or signing.stat().st_mode & 0o077):
        raise SystemExit('private Wizard OS signing identity required')
    # Check names only. Values stay inside the signing subprocess, never in logs.
    names = set(re.findall(r'(?m)^\s*(?:export\s+)?(WOS_[A-Z_]+)\s*=', signing.read_text()))
    if not {'WOS_KEYSTORE', 'WOS_STORE_PASSWORD', 'WOS_KEY_ALIAS', 'WOS_KEY_PASSWORD'} <= names:
        raise SystemExit('Wizard OS signing names missing')
    out = root / 'evidence'; out.mkdir(mode=0o700)
    artifacts = root / 'artifacts'; artifacts.mkdir(mode=0o700)
    report: dict = dict(status='RUNNING', source_revision=cfg['revision'], seal_sha256=args.seal_sha256,
                  storage=space, publication=False, physical_device=False, authenticated_owner_proof=False,
                  synthetic_paired_upgrade=True, phases=[])
    env = os.environ.copy()
    for key in list(env):
        if key.startswith('ORG_GRADLE_PROJECT_') or key in ('GRADLE_OPTS', 'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS',
                'WIZARD_ORIGIN', 'WIZARD_DEFAULT_ORIGIN', 'WIZARD_HOME_URL', 'WIZARD_PHOTOS_SERVER', 'WIZARD_UPDATE_ORIGIN'):
            env.pop(key)
    env.update(ANDROID_HOME='/srv/work/android-sdk', ANDROID_SDK_ROOT='/srv/work/android-sdk',
               JAVA_HOME='/usr/lib/jvm/java-21-openjdk-amd64', WIZARD_WORK_ROOT='/srv/work',
               ANDROID_BUILDS_ROOT='/srv/work/AndroidBuilds',
               GRADLE_USER_HOME=str(root / 'gradle-user'), ANDROID_USER_HOME=str(root / 'android-user'),
               ANDROID_AVD_HOME=str(root / 'android-avd'), ANDROID_EMULATOR_HOME=str(root / 'android-emulator'),
               TMPDIR=str(root / 'scratch'), PYTHONDONTWRITEBYTECODE='1',
               PLAYWRIGHT_MODULE=str(root / 'browser-deps/node_modules/playwright'),
               NODE_PATH=str(root / 'browser-deps/node_modules'), PLAYWRIGHT_BROWSERS_PATH=cfg['browser_home'])
    env['PATH'] = str(Path(cfg['node']).parent) + ':' + env['JAVA_HOME'] + '/bin:' + env.get('PATH', '')
    for name in ('gradle-user', 'android-user', 'android-avd', 'android-emulator', 'scratch'):
        (root / name).mkdir(mode=0o700)
    current = None

    def save():
        (root / 'acceptance.json').write_text(json.dumps(report, indent=2) + '\n')

    def stop_process(proc):
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=45)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL); proc.wait(timeout=10)

    def run(name, argv, timeout=1800, extra=None, cwd=None):
        nonlocal current
        if shutil.disk_usage(root).free < RESERVE:
            raise RuntimeError('reserve exhausted before ' + name)
        with (out / (name + '.log')).open('w') as log:
            current = subprocess.Popen(list(map(str, argv)), cwd=cwd or root, env=dict(env, **(extra or {})),
                                       stdout=log, stderr=subprocess.STDOUT, pass_fds=(fd,), start_new_session=True)
            deadline = time.monotonic() + timeout
            while current.poll() is None:
                if shutil.disk_usage(root).free < RESERVE or time.monotonic() > deadline:
                    stop_process(current)
                    raise RuntimeError('storage or phase deadline: ' + name)
                time.sleep(2)
        code = current.returncode
        report['phases'].append(dict(name=name, exit_code=code)); save()
        if code:
            raise RuntimeError(name + ' failed; private log retained')

    def interrupt(signum, frame):
        raise RuntimeError('packet interrupted')

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, interrupt)
    try:
        # Re-fetch the exact currently published baseline from the feed, never a guessed APK.
        with urllib.request.urlopen(cfg['feed_url'], timeout=30) as response:
            feed = json.load(response)
        (out / 'published-feed.json').write_text(json.dumps(feed, indent=2) + '\n')
        if (feed.get('versionCode') != 82 or feed.get('sha256') != BASELINE or feed.get('app') != 'ai.wizards.os'
                or feed.get('url') != 'wizard-os-0.10.18.apk' or feed.get('signer') != SIGNER):
            raise RuntimeError('published baseline moved; re-review packet rather than silently replacing it')
        baseline = root / 'baseline82.apk'
        url = cfg['feed_url'].rsplit('/', 1)[0] + '/' + feed['url']
        with urllib.request.urlopen(url, timeout=120) as response, baseline.open('wb') as target:
            shutil.copyfileobj(response, target)
        if sha(baseline) != BASELINE or baseline.stat().st_size != feed['bytes']:
            raise RuntimeError('published baseline bytes mismatch')
        run('baseline-signer', ['/srv/work/android-sdk/build-tools/35.0.0/apksigner', 'verify', '--print-certs', baseline], 120)
        run('signed-build', ['/usr/bin/python3', release / 'worker.py', '--worker', release / 'job.json'], 2400)
        source = release / 'source'
        report['release_junit'] = junit(source / 'android/app/build/test-results/testReleaseUnitTest')
        sys.path.insert(0, str(source / 'tools'))
        from qa_android_connect import signed_artifact
        owner = json.loads((root / 'owner82.json').read_text())
        receipt = json.loads((release / 'receipt.json').read_text())
        apk = signed_artifact(receipt, owner)
        if receipt.get('source_revision') != cfg['revision']:
            raise RuntimeError('signed receipt revision mismatch')
        run('signed-certificate', ['/srv/work/android-sdk/build-tools/35.0.0/apksigner', 'verify', '--print-certs', apk], 120)
        for name in ('baseline-signer', 'signed-certificate'):
            text = (out / (name + '.log')).read_text()
            certs = re.findall(r'Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)', text)
            if certs != [SIGNER]:
                raise RuntimeError('exact Wizard OS signer required: ' + name)
        run('signed-package', ['/srv/work/android-sdk/build-tools/35.0.0/aapt2', 'dump', 'badging', apk], 120)
        badging = (out / 'signed-package.log').read_text()
        if not re.search(r"package: name='ai.wizards.os' versionCode='86' versionName='0.10.22'", badging):
            raise RuntimeError('signed package/version mismatch')
        retained = artifacts / 'wizard-os-0.10.22.apk'; shutil.copy2(apk, retained)
        report['signed_apk'] = dict(path=str(retained), sha256=sha(retained), bytes=retained.stat().st_size, signer_sha256=SIGNER)
        # Cheap exact-source browser/opacity gates fail fast before either emulator.
        browser_env = dict(EVIDENCE_DIR=str(out / 'browser'))
        run('browser-share', [cfg['node'], source / 'tests/app-share-wizard.browser.cjs'], 900, browser_env, source)
        run('opaque-overlays', [cfg['node'], source / 'tools/qa-opaque-overlays.cjs'], 900,
            dict(QA_WEB_DIR=str(source), QA_RESULT=str(out / 'opaque-overlays.json'),
                 QA_SHOTS=str(out / 'screenshots'), QA_PHASE='release'), source)
        opacity = json.loads((out / 'opaque-overlays.json').read_text())
        if opacity['failures'] or not opacity['checked'] or opacity['see_through']:
            raise RuntimeError('opaque pixel gate failed')
        for skin in ('nebula', 'grove'):
            for name in ('share-sheet', 'share-picker'):
                if not (out / 'screenshots' / ('in-shell-' + skin + '-' + name + '.png')).is_file():
                    raise RuntimeError('in-shell two-skin screenshot missing')
        report['opacity'] = dict(checked=opacity['checked'], failures=opacity['failures'])
        run('signed-upgrade-82', ['/usr/bin/python3', source / 'tools/qa_android_connect.py', '--upgrade-only',
                                 release / 'receipt.json', baseline, root / 'owner82.json', root / 'upgrade82'], 900)
        upgrade = json.loads((root / 'upgrade82/receipt.json').read_text())
        names = {x['name'] for x in upgrade.get('checks', [])}
        if (upgrade.get('ok') is not True or not all(x['passed'] for x in upgrade['checks'])
                or not {'owned emulator serial is absent', 'synthetic app data marker survives in-place update',
                        'published release upgrades in place with same UID',
                        'app update never signs the owner out (no Connect after offline upgrade)'} <= names):
            raise RuntimeError('signed upgrade acceptance/cleanup failed')
        # Origin-less debug of THE SAME frozen head; native fixture stays on loopback.
        seal = debug / 'android-seal.json'
        run('synthetic-native-share', ['/usr/bin/python3', debug / 'qa_unified_share_android.py',
                                      '--seal', seal, '--seal-sha256', sha(seal)], 4100)
        native = json.loads((debug / 'android-evidence/acceptance.json').read_text())
        if (native.get('status') != 'PASS_SYNTHETIC_ANDROID_DEBUG_ONLY' or not native.get('emulator', {}).get('stopped')
                or not native.get('emulator', {}).get('serial_absent')):
            raise RuntimeError('native-share acceptance/cleanup failed')
        report['status'] = 'PASS_AUTOMATED_GATES_REQUIRES_PARENT_SCREENSHOT_REVIEW'
        report['limits'] = ['Synthetic pairing marker is not authenticated owner/account proof',
                            'Published 82 has empty DEX defaults; candidate 86 DEX must equal sealed owner origin',
                            'Explicit synthetic sender is receiver proof, not Gmail/OS-chooser proof',
                            'No physical-handset proof; parent must inspect screenshots and verify phones after release']
    except BaseException as exc:
        report['status'] = 'FAIL'
        report['failure'] = type(exc).__name__ + ': ' + str(exc)
        raise
    finally:
        stop_process(current)
        release, debug = Path(cfg['release_job']), Path(cfg['debug_job'])
        # Child rigs own and stop their emulator processes. Never kill another job's emulator.
        active = []
        native_path = debug / 'android-evidence/acceptance.json'
        if native_path.exists():
            emulator = json.loads(native_path.read_text()).get('emulator', {})
            if emulator.get('started') and not (emulator.get('stopped') and emulator.get('serial_absent')):
                active.append(str(native_path))
        upgrade_path = root / 'upgrade82/receipt.json'
        if upgrade_path.exists():
            checks = json.loads(upgrade_path.read_text()).get('checks', [])
            if any(x['name'] == 'owned emulator serial is absent' and not x['passed'] for x in checks):
                active.append(str(upgrade_path))
        elif (root / 'upgrade82/emulator.log').exists():
            active.append('upgrade emulator receipt missing')
        for job in (release, debug):
            for name in ('gradle-user', 'android-user'):
                shutil.rmtree(job / name, ignore_errors=True)
        if not active:
            for path in (root / 'android-avd', root / 'android-emulator', root / 'android-user', root / 'gradle-user',
                         root / 'upgrade82/device', root / 'upgrade82/android-user', root / 'upgrade82/emulator-user',
                         root / 'upgrade82/avd', debug / 'android-evidence/android_avd_home',
                         debug / 'android-evidence/android_emulator_home', debug / 'android-evidence/android_user_home'):
                shutil.rmtree(path, ignore_errors=True)
        else:
            report['status'] = 'FAIL'; report['cleanup_blockers'] = active
        report['cleanup'] = dict(avd_cleanup_safe=not active, free_bytes=shutil.disk_usage(root).free,
                                 gradle_homes_removed=all(not (job / 'gradle-user').exists() for job in (release, debug)))
        if report['cleanup']['free_bytes'] < RESERVE:
            report['status'] = 'FAIL'
        save()


if __name__ == '__main__':
    main()
