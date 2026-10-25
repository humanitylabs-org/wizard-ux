#!/usr/bin/env python3
"""Exact signed-byte origin custody: baked release -> generic release -> fresh Connect.

Thales API35 google_apis emulator only. Root reads real private SharedPreferences;
never seeds, edits, restores or replaces the origin. All evidence remains private.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import uuid
import xml.etree.ElementTree as ET
from phone_release import APP, SIGNER, apk_build_config, digest, require, write_json


def main():
    require(sys.platform == 'darwin' and os.environ.get('WIZARD_HEAVY_LOCK_FD'), 'Durable Thales lease required')
    old, new, out = map(Path, sys.argv[1:4])
    old_sha = sys.argv[4]
    require(digest(old) == old_sha, 'Baseline APK mismatch')
    expected = apk_build_config(old)['ORIGIN']
    require(isinstance(expected, str) and expected.startswith('https://'), 'Baseline must bake an HTTPS origin')
    require(apk_build_config(new)['ORIGIN'] == '', 'New artifact must be origin-less')
    out.mkdir(parents=True, mode=0o700, exist_ok=False)
    sdk = Path(os.environ.get('ANDROID_HOME', '/opt/homebrew/share/android-commandlinetools'))
    env = dict(os.environ, ANDROID_AVD_HOME=str(out / 'avd-home'))
    Path(env['ANDROID_AVD_HOME']).mkdir()
    adb = sdk / 'platform-tools/adb'
    serial = 'emulator-5684'
    emulator = None
    receipt = dict(ok=False, host=socket.gethostname(), api=35, package=APP, old_sha256=old_sha, new_sha256=digest(new), signer=SIGNER)
    def run(args, **kw):
        return subprocess.run(list(map(str, args)), env=env, check=True, timeout=150, **kw)
    def adb_text(*args):
        return run([adb, '-s', serial, *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).stdout
    def await_value(fn, predicate, seconds=60):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            try:
                value = fn()
                if predicate(value):
                    return value
            except subprocess.CalledProcessError:
                pass
            time.sleep(2)
        raise RuntimeError('Timed out waiting for emulator state; inspect private evidence')
    def foreground():
        activity = adb_text('shell', 'dumpsys', 'activity', 'activities')
        return '\n'.join(line for line in activity.splitlines() if 'mResumedActivity' in line or 'topResumedActivity' in line)
    def launch():
        result = adb_text('shell', 'am', 'start', '-W', '-n', APP + '/.MainActivity')
        require('Status: ok' in result, 'Launcher did not complete')
        return result
    def capture(name):
        with (out / (name + '.png')).open('wb') as f:
            run([adb, '-s', serial, 'exec-out', 'screencap', '-p'], stdout=f)
        # UI dump can transiently fail while first-run animation settles.
        def tree():
            adb_text('shell', 'rm', '-f', '/sdcard/phone-release-window.xml')
            adb_text('shell', 'uiautomator', 'dump', '/sdcard/phone-release-window.xml')
            return adb_text('shell', 'cat', '/sdcard/phone-release-window.xml')
        xml = await_value(tree, lambda value: '<hierarchy' in value, 90)
        (out / (name + '.xml')).write_text(xml)
        (out / (name + '-activity.txt')).write_text(foreground())
        return xml
    def prefs(name):
        # adb root on this test image permits the exact non-debuggable release's private file.
        raw = adb_text('shell', 'cat', '/data/user/0/' + APP + '/shared_prefs/wizard_server.xml')
        (out / (name + '-wizard_server.xml')).write_text(raw)
        values = {e.get('name'): e.text or '' for e in ET.fromstring(raw) if e.tag == 'string'}
        return values.get('origin', '')
    def no_crash(name):
        crash = adb_text('logcat', '-d', '-b', 'crash')
        (out / (name + '-crash.txt')).write_text(crash)
        require('FATAL EXCEPTION' not in crash, 'Crash buffer is nonempty')
        require(adb_text('shell', 'pidof', APP).strip(), 'App process missing')
    try:
        # Verify both exact APKs independently, before either installation.
        for name, apk in [('old', old), ('new', new)]:
            signer = run([sdk / 'build-tools/35.0.0/apksigner', 'verify', '--verbose', '--print-certs', apk], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).stdout
            require('Signer #1 certificate SHA-256 digest: ' + SIGNER in signer, 'Upgrade signer mismatch')
            (out / (name + '-signer.txt')).write_text(signer)
        require(serial not in run([adb, 'devices'], stdout=subprocess.PIPE, text=True).stdout, 'Emulator port already owned')
        avd = 'phone_origin_' + uuid.uuid4().hex[:10]
        run([sdk / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', avd, '-k', 'system-images;android-35;google_apis;arm64-v8a', '-p', out / 'device'], input='no\n', text=True, capture_output=True)
        with (out / 'emulator.log').open('w') as log:
            emulator = subprocess.Popen([str(sdk / 'emulator/emulator'), '-avd', avd, '-port', '5684', '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect', '-dns-server', '100.100.100.100'], env=env, stdout=log, stderr=subprocess.STDOUT)
        await_value(lambda: adb_text('shell', 'getprop', 'sys.boot_completed'), lambda v: v.strip() == '1', 300)
        await_value(lambda: adb_text('root'), lambda v: 'restarting adbd as root' in v or 'already running as root' in v, 60)
        adb_text('wait-for-device')
        require(adb_text('shell', 'id', '-u').strip() == '0', 'Root required for private-state proof')
        adb_text('shell', 'settings', 'put', 'global', 'window_animation_scale', '0')
        adb_text('shell', 'settings', 'put', 'global', 'transition_animation_scale', '0')
        adb_text('shell', 'settings', 'put', 'global', 'animator_duration_scale', '0')
        adb_text('shell', 'input', 'keyevent', '82')
        require('Success' in adb_text('install', old), 'Baseline installation failed')
        adb_text('logcat', '-c')
        (out / 'old-launch.txt').write_text(launch())
        saved = await_value(lambda: prefs('before-upgrade'), lambda v: v == expected)
        require(saved == expected, 'Baseline did not persist its baked origin')
        capture('before-upgrade')
        no_crash('before-upgrade')
        adb_text('shell', 'am', 'force-stop', APP)
        require('Success' in adb_text('install', '-r', new), 'Real signed upgrade failed')
        # Read immediately after -r, before launch: proves Android kept the actual storage.
        require(prefs('after-install-before-launch') == expected, 'Package upgrade lost origin')
        adb_text('logcat', '-c')
        (out / 'upgrade-launch.txt').write_text(launch())
        await_value(foreground, lambda v: APP + '/.MainActivity' in v)
        time.sleep(8)
        require(prefs('after-upgrade') == expected, 'Launch changed the saved origin')
        xml = capture('after-upgrade')
        require('ConnectActivity' not in foreground() and 'Connect to your Wizard' not in xml, 'Upgrade opened Connect')
        no_crash('after-upgrade')
        # Check nested native Back never leaves the installed shell.
        adb_text('shell', 'input', 'keyevent', '4')
        time.sleep(2)
        require(APP in foreground(), 'Back left the upgraded app')
        capture('after-upgrade-back')
        version = adb_text('shell', 'dumpsys', 'package', APP)
        (out / 'upgraded-package.txt').write_text(version)
        new_fields = apk_build_config(new)
        require('versionCode=' + str(new_fields['VERSION_CODE']) in version and 'versionName=' + new_fields['VERSION_NAME'] in version, 'Installed version mismatch')
        import hashlib
        receipt.update(upgrade_install=True, old_baked_origin_equals_persisted_before=True,
                       same_origin_after_install_before_launch=True, same_origin_after_launch=True,
                       origin_sha256=hashlib.sha256(expected.encode()).hexdigest(), no_connect_after_upgrade=True,
                       back_keeps_app=True, upgrade_no_crash=True)
        # Truly fresh state, not an origin preference fabricated by the test harness.
        require('Success' in adb_text('uninstall', APP), 'Uninstall failed')
        require('Success' in adb_text('install', new), 'Fresh install failed')
        adb_text('logcat', '-c')
        (out / 'fresh-launch.txt').write_text(launch())
        await_value(foreground, lambda v: APP + '/.ConnectActivity' in v)
        xml = capture('fresh-connect')
        require('Connect to your Wizard' in xml, 'Fresh generic release did not show Connect')
        no_crash('fresh-connect')
        receipt.update(ok=True, fresh_connect=True, fresh_no_crash=True)
    finally:
        write_json(out / 'receipt.json', receipt)
        if emulator is not None:
            subprocess.run([str(adb), '-s', serial, 'emu', 'kill'], env=env, capture_output=True, timeout=30)
            try:
                emulator.wait(timeout=30)
            except subprocess.TimeoutExpired:
                emulator.terminate()
                emulator.wait(timeout=20)
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
