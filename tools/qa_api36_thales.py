#!/usr/bin/env python3
"""Thales-only API36 Back/insets acceptance of exact prepared debug/release bytes.
Usage: qa_api36_thales.py DEBUG_RECEIPT RELEASE_RECEIPT OUT
No publication, owner traffic, or builds. Synthetic Connect fixture, native lock surface.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from qa_orb_tap_resume_native import worker_lock, BASE, SDK


def artifact(receipt, suffix):
    matches = [a for a in receipt['artifacts'] if a['path'].endswith(suffix)]
    assert receipt['status'] == 'ok' and len(matches) == 1, suffix
    a = matches[0]
    p = Path(receipt['job']) / 'source' / a['path']
    assert hashlib.sha256(p.read_bytes()).hexdigest() == a['sha256']
    return p


def main():
    assert sys.platform == 'darwin', 'Thales only'
    debug, release = [json.loads(Path(p).read_text()) for p in sys.argv[1:3]]
    out = Path(sys.argv[3]).resolve()
    assert out.is_relative_to(BASE.resolve()) and not out.exists()
    out.mkdir(parents=True, mode=0o700)
    env = os.environ.copy()
    env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
               ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(out / 'avd'))
    env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']
    (out / 'avd').mkdir()
    adb = SDK / 'platform-tools/adb'
    serial = 'emulator-5694'
    checks, em, completed = [], None, False
    def run(args, **kw):
        return subprocess.run([str(x) for x in args], env=env, check=True, **kw)
    def ar(*args, binary=False):
        return run([adb, '-s', serial, *args], capture_output=True, text=not binary, timeout=240).stdout
    def shell(*args):
        return ar('shell', *args)
    def check(name, passed, detail=''):
        checks.append(dict(name=name, passed=bool(passed), detail=detail))
        print(json.dumps(checks[-1]), flush=True)
        assert passed, (name, detail)
    with worker_lock():
        try:
            image = 'system-images;android-36;google_apis;arm64-v8a'
            if not (SDK / 'system-images/android-36/google_apis/arm64-v8a/package.xml').exists():
                with (out / 'sdk-install.txt').open('w') as log:
                    run([SDK / 'cmdline-tools/latest/bin/sdkmanager', image], stdout=log, stderr=subprocess.STDOUT, timeout=1800)
            assert serial not in run([adb, 'devices'], capture_output=True, text=True).stdout
            run([SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'api36', '-k', image,
                 '-d', 'pixel_7', '-p', out / 'device'], input='no\n', text=True, capture_output=True)
            with (out / 'emulator.log').open('w') as log:
                em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'api36', '-port', '5694',
                    '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect'], env=env, stdout=log, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 300
            while time.monotonic() < deadline:
                if em.poll() is not None: raise RuntimeError('emulator exited')
                try:
                    if shell('getprop', 'sys.boot_completed').strip() == '1': break
                except subprocess.CalledProcessError: pass
                time.sleep(3)
            else: raise RuntimeError('boot timeout')
            check('API36 emulator', shell('getprop', 'ro.build.version.sdk').strip() == '36')
            shell('input', 'keyevent', 'KEYCODE_WAKEUP'); shell('wm', 'dismiss-keyguard')
            for key in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'):
                shell('settings', 'put', 'global', key, '0')
            # Both flavors use the shared native stack, but run each exact flavor and both navigation modes.
            for flavor in ('play', 'sideload'):
                for suffix in (f'/apk/{flavor}/debug/app-{flavor}-debug.apk',
                               f'/apk/androidTest/{flavor}/debug/app-{flavor}-debug-androidTest.apk'):
                    ar('install', '-r', artifact(debug, suffix))
                for mode, overlay in (('buttons', 'threebutton'), ('gestures', 'gestural')):
                    phase = out / (flavor + '-' + mode); phase.mkdir()
                    shell('cmd', 'overlay', 'enable-exclusive', '--category', 'com.android.internal.systemui.navbar.' + overlay)
                    time.sleep(2)
                    active = shell('cmd', 'overlay', 'list')
                    check(flavor + '-' + mode + ' navigation overlay', '[x] com.android.internal.systemui.navbar.' + overlay in active, active)
                    shell('am', 'force-stop', 'ai.wizards.os.qa')
                    shell('logcat', '-c')
                    text = shell('am', 'instrument', '-w', '-e', 'class', 'ai.wizards.os.ConnectE2eTest',
                                 '-e', 'gesture_back', str(mode == 'gestures').lower(),
                                 'ai.wizards.os.qa.test/androidx.test.runner.AndroidJUnitRunner')
                    (phase / 'instrumentation.txt').write_text(text)
                    (phase / 'logcat.txt').write_text(shell('logcat', '-d', '-v', 'threadtime'))
                    crash = shell('logcat', '-d', '-b', 'crash'); (phase / 'crash.txt').write_text(crash)
                    ar('pull', '/sdcard/Android/data/ai.wizards.os.qa/files', phase / 'shots')
                    check(flavor + '-' + mode + ' nested/root/overlay/IME/assistant Back and insets',
                          'OK (1 test)' in text and 'FAILURES' not in text, text[-4000:])
                    check(flavor + '-' + mode + ' no native crash', 'FATAL EXCEPTION' not in crash)
            # Exact release Play APK built beside the signed AAB: fresh Connect, root Back, signer in build receipt.
            play = artifact(release, '/apk/play/release/app-play-release.apk')
            ar('install', '-r', play)
            shell('am', 'start', '-W', '-n', 'ai.wizards.os/.MainActivity'); time.sleep(3)
            for step in range(3):
                top = '\n'.join(l for l in shell('dumpsys', 'activity', 'activities').splitlines() if 'topResumedActivity' in l or 'mResumedActivity' in l)
                check('signed Play Connect root foreground ' + str(step), 'ai.wizards.os/.ConnectActivity' in top, top)
                (out / f'signed-play-connect-{step}.png').write_bytes(ar('exec-out', 'screencap', '-p', binary=True))
                shell('input', 'keyevent', 'KEYCODE_BACK'); time.sleep(.5)
            completed = True
        finally:
            if em is not None:
                subprocess.run([str(adb), '-s', serial, 'emu', 'kill'], env=env, capture_output=True)
                try: em.wait(timeout=30)
                except subprocess.TimeoutExpired: em.terminate(); em.wait(timeout=20)
            receipt = dict(ok=completed and bool(checks) and all(c['passed'] for c in checks), checks=checks,
                           source_revision=debug['source_revision'], release_revision=release['source_revision'],
                           physical_device=False, fixture='synthetic loopback shell + real native Connect/assistant', published=False)
            (out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
            print(json.dumps(receipt), flush=True)


if __name__ == '__main__':
    main()
