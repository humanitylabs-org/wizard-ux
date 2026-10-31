#!/usr/bin/env python3
"""Remaining gates only; called by the sealed release coordinator's --resume mode."""
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time

APK_SHA256 = '469b765e58e1525fffd78944c9f2cb8c4d1d97a4f9e156a79130d505512838b9'
PRODUCT_REVISION = 'cf16c3090fbe97a0f18e76545212224c85758b7f'
PASSED_PHASES = {'baseline-signer', 'signed-build', 'signed-certificate', 'signed-package',
                 'browser-share', 'opaque-overlays'}


def inherited_gates(prior, browser, opacity):
    phases = prior.get('phases', [])
    if (prior.get('status') != 'FAIL' or prior.get('source_revision') != PRODUCT_REVISION
            or len(phases) != 7 or {x['name'] for x in phases[:-1]} != PASSED_PHASES
            or any(x['exit_code'] for x in phases[:-1])
            or phases[-1] != dict(name='signed-upgrade-82', exit_code=1)
            or prior.get('release_junit') != dict(tests=392, failures=0, errors=0, skipped=0)
            or prior.get('signed_apk', {}).get('sha256') != APK_SHA256
            or browser.get('passed') != 30 or browser.get('failed') != 0
            or opacity != dict(checked=680, failures=0, see_through=[])):
        raise ValueError('resume requires the exact verified pre-upgrade checkpoint')


def product_files(files):
    return {n: row for n, row in files.items() if n.startswith(('android/', 'web/'))}


def validate_inputs(root, cfg, packet):
    if cfg.get('mode') != 'resume' or cfg.get('product_revision') != PRODUCT_REVISION:
        raise ValueError('explicit resume product identity required')
    prior_root = Path(cfg['prior_packet'])
    prior = json.loads((prior_root / 'acceptance.json').read_text())
    inherited_gates(prior, json.loads((prior_root / 'evidence/browser-share.log').read_text()),
                    json.loads((prior_root / 'evidence/opaque-overlays.json').read_text()))
    original = json.loads((Path(cfg['release_job']) / 'job.json').read_text())
    native = json.loads((root / 'native/job.json').read_text())
    current = json.loads((root / 'product-files.json').read_text())
    # Hash+mode parity, not merely matching version numbers. No new Android/web build source.
    if (original['revision'] != PRODUCT_REVISION or native['revision'] != PRODUCT_REVISION
            or not current or current != product_files(original['files'])
            or current != product_files(native['files'])):
        raise ValueError('resume Android/web source differs from the signed APK')
    receipt = json.loads((Path(cfg['release_job']) / 'receipt.json').read_text())
    sys.path.insert(0, str(root / 'tools'))
    from qa_android_connect import signed_artifact
    owner = json.loads((root / 'owner82.json').read_text())
    apk = signed_artifact(receipt, owner)
    if (receipt.get('source_revision') != PRODUCT_REVISION
            or packet.sha(apk) != APK_SHA256 or packet.sha(Path(cfg['signed_apk'])) != APK_SHA256):
        raise ValueError('resume signed APK identity mismatch')
    packet.junit(Path(cfg['release_job']) / 'source/android/app/build/test-results/testReleaseUnitTest')
    for skin in ('nebula', 'grove'):
        for name in ('share-sheet', 'share-picker'):
            shot = prior_root / 'evidence/screenshots' / ('in-shell-' + skin + '-' + name + '.png')
            if not shot.is_file():
                raise ValueError('inherited in-shell two-skin screenshot missing')
    if packet.sha(prior_root / 'baseline82.apk') != packet.BASELINE:
        raise ValueError('published code82 bytes drift')
    return apk


def main(root, cfg, seal_digest, fd, packet):
    if (root / 'acceptance.json').exists():
        raise SystemExit('resume packet already executed; never overwrite evidence')
    space = packet.capacity(shutil.disk_usage(root).free)
    if not space['pass_gate']:
        raise SystemExit('200 GiB reserve PLUS full resume footprint required')
    apk = validate_inputs(root, cfg, packet)
    native = root / 'native'
    if any((native / n).exists() for n in ('source', 'receipt.json', 'android-evidence')):
        raise SystemExit('native job already executed')
    out = root / 'evidence'; out.mkdir(mode=0o700)
    artifacts = root / 'artifacts'; artifacts.mkdir(mode=0o700)
    report: dict = dict(status='RUNNING', mode='resume', source_revision=cfg['revision'],
                  product_revision=PRODUCT_REVISION, seal_sha256=seal_digest, storage=space,
                  publication=False, physical_device=False, authenticated_owner_proof=False,
                  synthetic_paired_upgrade=True, phases=[], inherited_packet=cfg['prior_packet'])
    env = os.environ.copy()
    for key in list(env):
        if (key.startswith(('ORG_GRADLE_PROJECT_', 'WOS_')) or key in (
                'GRADLE_OPTS', 'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'WIZARD_ORIGIN',
                'WIZARD_DEFAULT_ORIGIN', 'WIZARD_HOME_URL', 'WIZARD_PHOTOS_SERVER', 'WIZARD_UPDATE_ORIGIN')):
            env.pop(key)
    env.update(ANDROID_HOME='/srv/work/android-sdk', ANDROID_SDK_ROOT='/srv/work/android-sdk',
               JAVA_HOME='/usr/lib/jvm/java-21-openjdk-amd64', WIZARD_WORK_ROOT='/srv/work',
               ANDROID_BUILDS_ROOT='/srv/work/AndroidBuilds', GRADLE_USER_HOME=str(root / 'gradle-user'),
               ANDROID_USER_HOME=str(root / 'android-user'), ANDROID_AVD_HOME=str(root / 'android-avd'),
               ANDROID_EMULATOR_HOME=str(root / 'android-emulator'), TMPDIR=str(root / 'scratch'),
               PYTHONDONTWRITEBYTECODE='1')
    env['PATH'] = env['JAVA_HOME'] + '/bin:' + str(Path(cfg['node']).parent) + ':' + env['PATH']
    for name in ('gradle-user', 'android-user', 'android-avd', 'android-emulator', 'scratch'):
        (root / name).mkdir(mode=0o700)
    current = None
    # Only these serials are eligible for fallback teardown: upgrade launcher first
    # proves 5686 absent; the native runner records its exact freshly-created PID.
    upgrade_owned = False

    def save():
        (root / 'acceptance.json').write_text(json.dumps(report, indent=2) + '\n')

    def stop_process(proc):
        if proc and proc.poll() is None:
            proc.terminate()  # Child finally owns emulator teardown; do not SIGKILL first.
            try:
                proc.wait(timeout=45)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL); proc.wait(timeout=10)

    def run(name, argv, timeout):
        nonlocal current
        with (out / (name + '.log')).open('w') as log:
            current = subprocess.Popen(list(map(str, argv)), cwd=root, env=env,
                                       stdout=log, stderr=subprocess.STDOUT, pass_fds=(fd,), start_new_session=True)
            deadline = time.monotonic() + timeout
            while current.poll() is None:
                if shutil.disk_usage(root).free < packet.RESERVE or time.monotonic() > deadline:
                    stop_process(current)
                    raise RuntimeError('storage or phase deadline: ' + name)
                time.sleep(2)
        report['phases'].append(dict(name=name, exit_code=current.returncode)); save()
        if current.returncode:
            raise RuntimeError(name + ' failed; private log retained')

    def interrupt(signum, frame):
        raise RuntimeError('resume packet interrupted')

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, interrupt)
    save()
    try:
        # First live operations re-verify exact existing bytes/certificate/version. Never sign/rebuild release.
        bt = Path('/srv/work/android-sdk/build-tools/35.0.0')
        run('signed-certificate', [bt / 'apksigner', 'verify', '--print-certs', apk], 120)
        certs = re.findall(r'Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)',
                           (out / 'signed-certificate.log').read_text())
        if certs != [packet.SIGNER]:
            raise RuntimeError('exact Wizard OS signer required')
        run('signed-package', [bt / 'aapt2', 'dump', 'badging', apk], 120)
        if not re.search(r"package: name='ai.wizards.os' versionCode='86' versionName='0.10.22'",
                         (out / 'signed-package.log').read_text()):
            raise RuntimeError('signed package/version mismatch')
        retained = artifacts / 'wizard-os-0.10.22.apk'; shutil.copy2(apk, retained)
        if packet.sha(retained) != APK_SHA256:
            raise RuntimeError('retained APK drift')
        report['signed_apk'] = dict(path=str(retained), sha256=APK_SHA256, signer_sha256=packet.SIGNER,
                                    bytes=retained.stat().st_size, version_code=86)
        baseline = Path(cfg['prior_packet']) / 'baseline82.apk'
        devices = subprocess.run(['/srv/work/android-sdk/platform-tools/adb', 'devices'], env=env,
                                 capture_output=True, text=True, check=True, timeout=30).stdout
        if 'emulator-5686' in devices:
            raise RuntimeError('upgrade serial already owned by another job')
        upgrade_owned = True
        run('signed-upgrade-82', ['/usr/bin/python3', root / 'tools/qa_android_connect.py', '--upgrade-only',
                                 Path(cfg['release_job']) / 'receipt.json', baseline, root / 'owner82.json',
                                 root / 'upgrade82'], 900)
        upgrade = json.loads((root / 'upgrade82/receipt.json').read_text())
        names = {x['name'] for x in upgrade.get('checks', [])}
        if (upgrade.get('ok') is not True or not all(x['passed'] for x in upgrade['checks'])
                or not {'owned emulator serial is absent', 'synthetic app data marker survives in-place update',
                        'published release upgrades in place with same UID',
                        'install preserves the exact pre-launch origin preferences', 'owner origin silently persisted',
                        'app update never signs the owner out (no Connect after offline upgrade)'} <= names):
            raise RuntimeError('signed upgrade acceptance/cleanup failed')
        native_seal = native / 'android-seal.json'
        run('synthetic-native-share', ['/usr/bin/python3', native / 'qa_unified_share_android.py',
                                      '--seal', native_seal, '--seal-sha256', packet.sha(native_seal)], 4100)
        acceptance = json.loads((native / 'android-evidence/acceptance.json').read_text())
        if (acceptance.get('status') != 'PASS_SYNTHETIC_ANDROID_DEBUG_ONLY'
                or not acceptance.get('emulator', {}).get('stopped')
                or not acceptance.get('emulator', {}).get('serial_absent')):
            raise RuntimeError('native-share acceptance/cleanup failed')
        # Reuse, rather than regenerate, already passed in-shell screenshots on nebula+grove.
        shots = out / 'screenshots'; shots.mkdir()
        for skin in ('nebula', 'grove'):
            for name in ('share-sheet', 'share-picker'):
                filename = 'in-shell-' + skin + '-' + name + '.png'
                shutil.copy2(Path(cfg['prior_packet']) / 'evidence/screenshots' / filename, shots / filename)
        report['screenshots_reused'] = {p.name: packet.sha(p) for p in shots.iterdir()}
        # Exact publication bytes remain the same after both gates. Debug is a separately labelled fixture.
        if packet.sha(retained) != APK_SHA256 or packet.sha(apk) != APK_SHA256:
            raise RuntimeError('tested signed APK drift')
        packet.verify(root, seal_digest)
        report['sealed_inputs_unchanged_after_qa'] = True
        report['status'] = 'PASS_AUTOMATED_GATES_REQUIRES_PARENT_SCREENSHOT_REVIEW'
        report['limits'] = ['Synthetic pairing is not authenticated owner proof',
                            'Native share uses an origin-less debug build from the identical Android/web tree',
                            'Synthetic explicit sender is receiver proof, not Gmail/OS-chooser proof',
                            'No physical-handset proof; parent must inspect the retained two-skin screenshots']
    except BaseException as exc:
        report['status'] = 'FAIL'; report['failure'] = type(exc).__name__ + ': ' + str(exc)
        raise
    finally:
        stop_process(current)
        active = []
        owned = []
        if upgrade_owned and (root / 'upgrade82/emulator.log').exists():
            owned.append('emulator-5686')
        native_receipt = native / 'android-evidence/acceptance.json'
        if native_receipt.is_file():
            emulator = json.loads(native_receipt.read_text()).get('emulator', {})
            if emulator.get('started'):
                owned.append(emulator['serial'])
        elif (native / 'android-evidence/emulator.log').exists():
            active.append('native emulator ownership receipt missing')
        # Fallback after interrupted children: target only serials acquired under
        # this lease, never adb kill-server, pkill, another AVD or another job dir.
        adb = '/srv/work/android-sdk/platform-tools/adb'
        for serial in owned:
            try:
                def read_devices():
                    return subprocess.run([adb, 'devices'], env=env, capture_output=True,
                                          text=True, check=True, timeout=15).stdout
                if serial in read_devices():
                    subprocess.run([adb, '-s', serial, 'emu', 'kill'], env=env, capture_output=True, timeout=15)
                    deadline = time.monotonic() + 30
                    while serial in read_devices() and time.monotonic() < deadline:
                        time.sleep(1)
                if serial in read_devices():
                    active.append(serial)
            except Exception as exc:
                active.append(serial + ': ' + type(exc).__name__)
        report['cleanup_serials_checked'] = owned
        if not active:
            for path in (root / 'android-avd', root / 'android-emulator', root / 'android-user', root / 'gradle-user',
                         root / 'upgrade82/device', root / 'upgrade82/avd', native / 'gradle-user', native / 'android-user',
                         native / 'android-evidence/android_avd_home', native / 'android-evidence/android_user_home',
                         native / 'android-evidence/android_emulator_home'):
                shutil.rmtree(path, ignore_errors=True)
        else:
            report['status'] = 'FAIL'; report['cleanup_blockers'] = active
        report['cleanup'] = dict(avd_cleanup_safe=not active, free_bytes=shutil.disk_usage(root).free)
        if report['cleanup']['free_bytes'] < packet.RESERVE:
            report['status'] = 'FAIL'
        save()
    return 0 if report['status'].startswith('PASS_') else 1
