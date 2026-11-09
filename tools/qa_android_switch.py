#!/usr/bin/env python3
"""Forum emulator proof: switching to another Wizard stays inside the Android app.
Usage: qa_android_switch.py DEBUG_RECEIPT OUT   (DEBUG_RECEIPT: android-build-forum receipt with the QA apk + test apk)
Runs ai.wizards.os.SwitchE2eTest (two synthetic Wizards, no owner traffic) on a fresh API35 x86_64 emulator, then
checks the logcat: no ACTION_VIEW left the app for the second Wizard during the in-app switch. Exit 1 on any failure."""
import fcntl, hashlib, json, os, signal, subprocess, sys, time
from pathlib import Path

SDK = Path('/srv/work/android-sdk')
BASE = Path(os.environ.get('ANDROID_BUILDS_ROOT') or '/srv/work/AndroidBuilds')
GRAPHICS = ('-gpu', 'swiftshader', '-feature', '-Vulkan')


def main():
    receipt = json.loads(Path(sys.argv[1]).read_text()); out = Path(sys.argv[2])
    assert receipt['status'] == 'ok' and out.resolve().is_relative_to(BASE)
    out.mkdir(parents=True, exist_ok=True); (out / 'avd').mkdir(exist_ok=True)

    def artifact(package):
        a = next(a for a in receipt['artifacts'] if a['aapt2']['package'] == package)
        p = Path(receipt['job']) / 'source' / a['path']
        assert hashlib.sha256(p.read_bytes()).hexdigest() == a['sha256']
        return p
    qa, test = artifact('ai.wizards.os.qa'), artifact('ai.wizards.os.qa.test')
    env = os.environ.copy()
    env.update(JAVA_HOME='/usr/lib/jvm/java-21-openjdk-amd64', ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(out / 'avd'))
    adb = SDK / 'platform-tools/adb'
    inherited = os.environ.get('WIZARD_HEAVY_LOCK_FD')
    if not inherited: raise SystemExit('forum requires the inherited durable worker lease')
    lock = os.fdopen(int(inherited), 'a', closefd=False)
    checks = []; em = None; serial = ''

    def run(args, **kw): return subprocess.run([str(a) for a in args], env=env, **kw)
    def shell(*a): return run([adb, '-s', serial, 'shell', *a], capture_output=True, text=True, timeout=120).stdout
    def check(name, ok, detail=''):
        checks.append(dict(name=name, passed=bool(ok), detail=str(detail)[-2000:])); print(('PASS ' if ok else 'FAIL ') + name, flush=True)
    def bail(signum, frame): raise SystemExit('interrupted ' + str(signum))
    signal.signal(signal.SIGTERM, bail); signal.signal(signal.SIGALRM, bail); signal.alarm(900)
    with lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            port = 5584
            devices = run([adb, 'devices'], capture_output=True, text=True).stdout
            while f'emulator-{port}' in devices and port > 5554: port -= 2
            serial = f'emulator-{port}'
            run([SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'switch', '-k', 'system-images;android-35;google_apis;x86_64',
                 '-d', 'pixel_7', '-p', out / 'device'], input='no\n', text=True, capture_output=True, check=True)
            with (out / 'emulator.log').open('w') as log:
                em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'switch', '-port', str(port), '-no-window', '-no-snapshot', '-no-audio', *GRAPHICS, '-accel', 'on'],
                                      env=env, stdout=log, stderr=subprocess.STDOUT)
            for _ in range(80):
                if em.poll() is not None: raise RuntimeError('emulator exited %s' % em.returncode)
                try:
                    if shell('getprop', 'sys.boot_completed').strip() == '1': break
                except Exception: pass
                time.sleep(3)
            else: raise RuntimeError('emulator boot timeout')
            shell('input', 'keyevent', 'KEYCODE_WAKEUP'); shell('wm', 'dismiss-keyguard')
            for k in ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']: shell('settings', 'put', 'global', k, '0')
            run([adb, '-s', serial, 'install', '-r', '-g', qa], check=True, capture_output=True); run([adb, '-s', serial, 'install', '-r', test], check=True, capture_output=True)
            run([adb, '-s', serial, 'logcat', '-c'])
            text = shell('am', 'instrument', '-w', '-e', 'class', 'ai.wizards.os.SwitchE2eTest', 'ai.wizards.os.qa.test/androidx.test.runner.AndroidJUnitRunner')
            (out / 'instrumentation.txt').write_text(text)
            log = run([adb, '-s', serial, 'logcat', '-d', '-v', 'threadtime'], capture_output=True, text=True, errors='replace').stdout
            (out / 'logcat.txt').write_text(log)
            check('SwitchE2eTest passes (switch in app, page loads, way back)', 'OK (1 test)' in text and 'FAILURES' not in text, text)
            views = [l for l in log.splitlines() if 'android.intent.action.VIEW' in l and ('localhost' in l or '10.0.2.2' in l)]
            (out / 'view-intents.txt').write_text('\n'.join(views))
            check('no ACTION_VIEW to a Wizard address left the app', not views, '\n'.join(views[:5]))
            (out / 'shots').mkdir(exist_ok=True)
            names = [n for n in shell('ls', '/data/local/tmp').split() if n.endswith('.png') and n.startswith(('switch-', 'fail-'))]
            for n in names: run([adb, '-s', serial, 'pull', '/data/local/tmp/' + n, out / 'shots' / n], capture_output=True)
            if not names: (out / 'shots.missing').write_text('none\n')
        finally:
            if em is not None:
                try: run([adb, '-s', serial, 'emu', 'kill'], timeout=20, capture_output=True)
                except Exception: pass
                try: em.wait(timeout=30)
                except Exception: em.kill()
            (out / 'result.json').write_text(json.dumps(dict(checks=checks, serial=serial), indent=2))
    sys.exit(0 if checks and all(c['passed'] for c in checks) else 1)


if __name__ == '__main__': main()
