#!/usr/bin/env python3
"""Thales-only API35 Connect acceptance. Synthetic debug traffic; signed upgrade runs offline.
Usage: qa_android_connect.py DEBUG_RECEIPT GENERIC_RECEIPT OWNER_RECEIPT OLD_APK OWNER_CONFIG OUT
OWNER_CONFIG is private JSON with origin and baseline_sha256; never commit it.
Set pre_pref_baseline=true to prove skipped-version migration from an app that
never stored wizard_server.xml. No publishing.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

from apk_build_config import apk_build_config

SDK = Path('/opt/homebrew/share/android-commandlinetools')
BASE = Path(os.environ.get('ANDROID_BUILDS_ROOT') or Path.home() / 'AndroidBuilds')  # worker-local build root

def main():
    if sys.platform != 'darwin':
        raise SystemExit('Thales/macOS required')
    debug, generic, owner = [json.loads(Path(x).read_text()) for x in sys.argv[1:4]]
    old, config, out = Path(sys.argv[4]), json.loads(Path(sys.argv[5]).read_text()), Path(sys.argv[6])
    assert out.resolve().is_relative_to(BASE)
    out.mkdir(parents=True, exist_ok=True)
    os.umask(0o077)
    checks = []
    completed = False
    env = os.environ.copy()
    env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
               ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(out / 'avd'))
    env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']
    (out / 'avd').mkdir(exist_ok=True)
    def run(args, **kwargs):
        return subprocess.run([str(a) for a in args], env=env, check=True, **kwargs)
    def artifact(receipt, package):
        assert receipt['status'] == 'ok'
        a = next(a for a in receipt['artifacts'] if a['aapt2']['package'] == package)
        p = Path(receipt['job']) / 'source' / a['path']
        assert hashlib.sha256(p.read_bytes()).hexdigest() == a['sha256']
        return p
    qa_apk = artifact(debug, 'ai.wizards.os.qa')
    test_apk = artifact(debug, 'ai.wizards.os.qa.test')
    generic_apk = artifact(generic, 'ai.wizards.os')
    owner_apk = artifact(owner, 'ai.wizards.os')
    assert hashlib.sha256(old.read_bytes()).hexdigest() == config['baseline_sha256']
    adb = SDK / 'platform-tools/adb'
    serial = 'emulator-5686'
    def adb_run(*args, binary=False):
        return run([adb, '-s', serial, *args], capture_output=True, text=not binary).stdout
    def shell(*args):
        return adb_run('shell', *args)
    def top():
        return '\n'.join(l for l in shell('dumpsys', 'activity', 'activities').splitlines() if 'topResumedActivity' in l or 'mResumedActivity' in l)
    def check(name, passed, detail=''):
        checks.append(dict(name=name, passed=bool(passed), detail=detail))
        print(('PASS ' if passed else 'FAIL ') + name, flush=True)
    def screenshot(name):
        (out / (name + '.png')).write_bytes(adb_run('exec-out', 'screencap', '-p', binary=True))
    inherited = os.environ.get('WIZARD_HEAVY_LOCK_FD')
    lock = os.fdopen(int(inherited), 'a', closefd=False) if inherited else (BASE / 'worker.lock').open('a')
    em = None
    with lock:
        if inherited:
            a, b = (BASE / 'worker.lock').stat(), os.fstat(lock.fileno())
            assert (a.st_dev, a.st_ino) == (b.st_dev, b.st_ino)
        fcntl.flock(lock, fcntl.LOCK_EX | (fcntl.LOCK_NB if inherited else 0))
        try:
            assert serial not in run([adb, 'devices'], capture_output=True, text=True).stdout
            run([SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'connect', '-k',
                 'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7', '-p', out / 'device'], input='no\n', text=True, capture_output=True)
            with (out / 'emulator.log').open('w') as log:
                em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'connect', '-port', '5686', '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect'], env=env, stdout=log, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 240
            while time.monotonic() < deadline:
                if em.poll() is not None: raise RuntimeError('emulator exited')
                try:
                    if shell('getprop', 'sys.boot_completed').strip() == '1': break
                except subprocess.CalledProcessError: pass
                time.sleep(3)
            else: raise RuntimeError('emulator boot timeout')
            shell('input', 'keyevent', 'KEYCODE_WAKEUP'); shell('wm', 'dismiss-keyguard')
            for key in ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']:
                shell('settings', 'put', 'global', key, '0')
            check('API35 emulator', shell('getprop', 'ro.build.version.sdk').strip() == '35')
            adb_run('install', '-r', qa_apk); adb_run('install', '-r', test_apk)
            text = shell('am', 'instrument', '-w', '-e', 'class', 'ai.wizards.os.ConnectE2eTest', 'ai.wizards.os.qa.test/androidx.test.runner.AndroidJUnitRunner')
            (out / 'instrumentation.txt').write_text(text)
            (out / 'instrumentation-logcat.txt').write_text(run([adb, '-s', serial, 'logcat', '-d', '-v', 'threadtime'], capture_output=True, text=True, errors='replace').stdout)
            check('Connect UI instrumentation', 'OK (1 test)' in text and 'FAILURES' not in text, text[-3000:])
            try: adb_run('pull', '/sdcard/Android/data/ai.wizards.os.qa/files', out / 'instrumentation-shots')
            except subprocess.CalledProcessError: (out / 'instrumentation-shots.missing').write_text('no screenshots to pull\n')
            adb_run('install', '-r', generic_apk)
            shell('am', 'start', '-W', '-n', 'ai.wizards.os/.MainActivity'); time.sleep(3)
            check('signed generic fresh install shows Connect', 'ConnectActivity' in top(), top())
            screenshot('signed-fresh-connect')
            shell('input', 'keyevent', 'KEYCODE_BACK'); time.sleep(1)
            check('signed Connect root Back retains app', 'ai.wizards.os/.ConnectActivity' in top(), top())
            adb_run('uninstall', 'ai.wizards.os')
            # Real published signed bytes, but no live-owner traffic: install/upgrade and launch with radios disabled.
            shell('svc', 'wifi', 'disable'); shell('svc', 'data', 'disable')
            adb_run('install', old)
            # The old APK must be launched naturally, never preference-seeded.
            # Optional pre_pref_baseline proves James's skipped-migration case,
            # rather than the easier already-persisted-origin generic upgrade.
            adb_run('root'); adb_run('wait-for-device')
            shell('am', 'start', '-W', '-n', 'ai.wizards.os/.MainActivity'); time.sleep(4)
            if config.get('pre_pref_baseline'):
                old_fields = apk_build_config(old)
                check('pre-preference baseline has the expected baked owner origin', old_fields.get('ORIGIN') == config['origin'])
                absent = shell('if test -e /data/user/0/ai.wizards.os/shared_prefs/wizard_server.xml; then echo present; else echo absent; fi').strip()
                check('old app never wrote an origin preference after launch', absent == 'absent')
                if absent != 'absent': raise RuntimeError('Not a pre-preference baseline; refuse the easier upgrade proof')
            shell('am', 'force-stop', 'ai.wizards.os')
            old_dump = shell('dumpsys', 'package', 'ai.wizards.os')
            old_uid = re.search(r'(?:userId|appId)=(\d+)', old_dump).group(1)
            first = next(l.strip() for l in old_dump.splitlines() if 'firstInstallTime=' in l)
            shell('pm', 'grant', 'ai.wizards.os', 'android.permission.POST_NOTIFICATIONS')
            adb_run('install', '-r', owner_apk)
            new_dump = shell('dumpsys', 'package', 'ai.wizards.os')
            check('published release upgrades in place with same UID', bool(re.search(r'(?:userId|appId)=' + old_uid + r'\b', new_dump)) and first in new_dump)
            check('notification grant preserved', 'android.permission.POST_NOTIFICATIONS: granted=true' in new_dump)
            shell('logcat', '-c'); shell('am', 'start', '-W', '-n', 'ai.wizards.os/.MainActivity'); time.sleep(4)
            check('app update never signs the owner out (no Connect after offline upgrade)', 'ai.wizards.os/.MainActivity' in top() and 'ConnectActivity' not in top(), top())
            screenshot('owner-upgrade-offline')
            # google_apis emulator supports root; read the exact release's migrated SharedPreferences.
            adb_run('root'); adb_run('wait-for-device')
            xml = shell('cat', '/data/user/0/ai.wizards.os/shared_prefs/wizard_server.xml')
            values = {e.attrib.get('name'): e.text for e in ET.fromstring(xml)}
            check('owner origin silently persisted', values.get('origin') == config['origin'])
            for step in range(2):
                shell('input', 'keyevent', 'KEYCODE_BACK'); time.sleep(1)
                check('signed owner Back retains app ' + str(step + 1), 'ai.wizards.os' in top(), top())
            crash = shell('logcat', '-d', '-b', 'crash'); (out / 'crash.txt').write_text(crash)
            check('no native crashes', 'FATAL EXCEPTION' not in crash)
            completed = True
        finally:
            if em is not None:
                subprocess.run([str(adb), '-s', serial, 'emu', 'kill'], env=env, capture_output=True)
                try: em.wait(timeout=30)
                except subprocess.TimeoutExpired: em.terminate(); em.wait(timeout=20)
            receipt = {'checks': checks, 'passed': sum(x['passed'] for x in checks), 'total': len(checks),
                       'ok': completed and bool(checks) and all(x['passed'] for x in checks), 'physical_device': False,
                       'upgrade_network': 'offline, deliberately no owner traffic', 'published': False,
                       'pre_pref_baseline': config.get('pre_pref_baseline', False),
                       'old_sha256': hashlib.sha256(old.read_bytes()).hexdigest(),
                       'new_sha256': hashlib.sha256(owner_apk.read_bytes()).hexdigest()}
            (out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
            print(json.dumps(receipt), flush=True)
    if not checks or not all(x['passed'] for x in checks): raise SystemExit(1)

if __name__ == '__main__':
    main()
