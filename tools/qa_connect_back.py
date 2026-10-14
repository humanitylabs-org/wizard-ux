#!/usr/bin/env python3
"""Connect-screen + Back QA on an isolated Thales API35 emulator (never a physical phone, never the real Wizard).

Usage (on Thales): python3 tools/qa_connect_back.py <thales build receipt.json> [out_dir]

The debug APK is run as a build WITHOUT a private address (debug-only flag files/qa_unconfigured) and checks:
  1 a fresh launch shows "Connect to your Wizard" (no Wizard page is loaded)
  2 Back x3 on the connect screen leaves the app open, in front, still on the connect screen (Back never exits)
  3 a connect link (wizardos://connect?address=...) opens the screen with that address filled in
  4 a bad address is refused in place; Connect with a good one saves it in app prefs and leaves the connect screen
  5 Back after connecting still never exits
  6 without the flag, a build that carries an address never shows the connect screen
No real Wizard is reachable: the address used is the reserved example name.
"""
import fcntl, hashlib, json, os, pathlib, re, subprocess, sys, time, uuid

P = pathlib.Path
BASE = P('/Volumes/ThalesMedia/AndroidBuilds'); SDK = P('/opt/homebrew/share/android-commandlinetools')
if sys.platform != 'darwin':
    raise SystemExit('Thales required')
receipt = json.loads(P(sys.argv[1]).read_text()); assert receipt['status'] == 'ok' and receipt['host'] == 'thales'
art = next(x for x in receipt['artifacts'] if x['aapt2']['package'] == 'ai.wizards.os.qa')
apk = P(receipt['job']) / 'source' / art['path']; assert hashlib.sha256(apk.read_bytes()).hexdigest() == art['sha256']
PKG = art['aapt2']['package']
EXAMPLE = 'https://wizard.example.ts.net'
os.umask(0o077)
job = P(sys.argv[2]) if len(sys.argv) > 2 else BASE / 'qa' / ('wos-connect-' + uuid.uuid4().hex[:8]); job.mkdir(parents=True, exist_ok=True)
env = os.environ.copy(); env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home', ANDROID_HOME=str(SDK),
                                    ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd-home'))
env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']; (job / 'avd-home').mkdir(exist_ok=True)
adb = SDK / 'platform-tools/adb'; serial = 'emulator-5684'; em = None
RES = []


def check(n, ok, d=''):
    RES.append({'name': n, 'ok': bool(ok), 'detail': str(d)[:400]}); print(('PASS ' if ok else 'FAIL ') + n, '' if ok else d, flush=True)


def run(args, **kw):
    return subprocess.run([str(x) for x in args], env=env, check=True, **kw)


def sx(cmd):
    return subprocess.run([str(adb), '-s', serial, 'shell', cmd], env=env, capture_output=True, text=True).stdout


def dump(tag):
    sx('uiautomator dump /sdcard/w.xml >/dev/null 2>&1')
    run([adb, '-s', serial, 'pull', '/sdcard/w.xml', job / (tag + '.xml')], capture_output=True)
    with (job / (tag + '.png')).open('wb') as f:
        run([adb, '-s', serial, 'exec-out', 'screencap', '-p'], stdout=f)
    return (job / (tag + '.xml')).read_text(errors='replace')


def front():
    pid = sx('pidof ' + PKG).strip()
    act = sx('dumpsys activity activities')
    top = any(PKG in l for l in act.splitlines() if 'mResumedActivity' in l or 'topResumedActivity' in l)
    return pid, top


def bounds(xml, text):
    m = re.search(r'<node[^>]*?(?:text|content-desc)="' + re.escape(text) + r'"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml)
    if not m:
        return None
    x1, y1, x2, y2 = map(int, m.groups()); return (x1 + x2) // 2, (y1 + y2) // 2


def launch(fresh_flag=None):
    sx('am force-stop ' + PKG)
    if fresh_flag is True:
        sx(f"run-as {PKG} sh -c 'mkdir -p files && touch files/qa_unconfigured'")
    elif fresh_flag is False:
        sx(f"run-as {PKG} rm -f files/qa_unconfigured")
    sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(6)


CONNECT = 'Connect to your Wizard'
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        assert serial not in run([adb, 'devices'], capture_output=True, text=True).stdout, 'QA emulator port already owned'
        run([SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'wizard_connect_35', '-k',
             'system-images;android-35;google_apis;arm64-v8a', '-p', job / 'device'], input='no\n', text=True, capture_output=True)
        with (job / 'emulator.log').open('w') as log:
            em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'wizard_connect_35', '-port', '5684', '-no-window', '-no-snapshot',
                                   '-no-audio', '-gpu', 'swiftshader_indirect'], env=env, stdout=log, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            if em.poll() is not None:
                raise RuntimeError('emulator exited before boot')
            p = subprocess.run([str(adb), '-s', serial, 'shell', 'getprop', 'sys.boot_completed'], env=env, capture_output=True, text=True)
            if p.returncode == 0 and p.stdout.strip() == '1':
                break
            time.sleep(3)
        else:
            raise RuntimeError('emulator boot timeout')
        sx('settings put global window_animation_scale 0; settings put global transition_animation_scale 0; input keyevent KEYCODE_WAKEUP; wm dismiss-keyguard')
        assert 'Success' in run([adb, '-s', serial, 'install', '-r', apk], capture_output=True, text=True).stdout
        run([adb, '-s', serial, 'logcat', '-c'])
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(4)  # creates the app's files dir

        # 1 unconfigured launch
        launch(fresh_flag=True)
        x = dump('1-connect')
        check('1 unconfigured launch shows "Connect to your Wizard"', CONNECT in x, x[:300])
        pid, top = front(); check('1 app is in front', pid and top, (pid, top))

        # 2 Back x3 never exits
        for _ in range(3):
            sx('input keyevent KEYCODE_BACK'); time.sleep(1.2)
        x = dump('2-after-back')
        pid2, top2 = front()
        check('2 Back x3 on the connect screen: app still running, same process, in front', pid2 and pid2 == pid and top2, (pid, pid2, top2))
        check('2 Back x3: still on the connect screen', CONNECT in x)

        # 3 connect link pre-fills
        sx("am start -W -a android.intent.action.VIEW -d 'wizardos://connect?address=https%3A%2F%2Fwizard.example.ts.net%2F' " + PKG); time.sleep(3)
        x = dump('3-link')
        check('3 connect link opens the screen with the address filled in', CONNECT in x and EXAMPLE in x, x[:300])

        # 4 bad address refused, good one saved
        xy = bounds(x, 'Wizard address')
        if xy:
            sx(f'input tap {xy[0]} {xy[1]}'); time.sleep(0.5)
            sx('input keyevent KEYCODE_MOVE_END ' + ' '.join(['KEYCODE_DEL'] * 60))
            sx('input text http://plain.example.com'); time.sleep(0.5)
            c = bounds(dump('4a-typed'), 'Connect')
            if c:
                sx(f'input tap {c[0]} {c[1]}'); time.sleep(1.5)
            x = dump('4b-refused')
            check('4 an http:// address is refused in place', CONNECT in x and "isn't a Wizard address" in x, x[:300])
            sx('input keyevent KEYCODE_MOVE_END ' + ' '.join(['KEYCODE_DEL'] * 60))
            sx('input text wizard.example.ts.net'); time.sleep(0.5)
            c = bounds(dump('4c-typed'), 'Connect')
            if c:
                sx(f'input tap {c[0]} {c[1]}'); time.sleep(6)
        else:
            check('4 address field found', False, 'no field')
        prefs = sx(f'run-as {PKG} cat shared_prefs/wizard_address.xml')
        check('4 Connect saved the address in app prefs', EXAMPLE in prefs, prefs[:300])
        x = dump('4d-connected')
        check('4 after Connect the connect screen is gone (the app tries that Wizard)', CONNECT not in x, x[:300])

        # 5 Back after connecting never exits
        pid, _ = front()
        for _ in range(3):
            sx('input keyevent KEYCODE_BACK'); time.sleep(1.2)
        pid5, top5 = front(); dump('5-after-back')
        check('5 Back x3 after connecting: app still running and in front', pid5 and pid5 == pid and top5, (pid, pid5, top5))

        # 6 a build that carries an address (no flag, prefs cleared) never shows the connect screen
        sx(f'run-as {PKG} rm -f shared_prefs/wizard_address.xml')
        launch(fresh_flag=False)
        x = dump('6-configured')
        check('6 configured build: no connect screen', CONNECT not in x, x[:300])

        crash = run([adb, '-s', serial, 'logcat', '-d', '-b', 'crash'], capture_output=True, text=True).stdout
        (job / 'crash.txt').write_text(crash)
        check('no crash', 'FATAL EXCEPTION' not in crash, crash[:400])
        logs = run([adb, '-s', serial, 'logcat', '-d', '-s', 'WizardOS:*', 'WizardOSReach:*'], capture_output=True, text=True).stdout
        (job / 'logcat.txt').write_text(logs)
    finally:
        if em is not None:
            subprocess.run([str(adb), '-s', serial, 'emu', 'kill'], env=env, capture_output=True)
            try:
                em.wait(timeout=30)
            except subprocess.TimeoutExpired:
                em.terminate(); em.wait(timeout=20)
passed = sum(r['ok'] for r in RES)
result = {'status': 'ok' if RES and passed == len(RES) else 'failed', 'passed': passed, 'total': len(RES), 'checks': RES,
          'package': PKG, 'apk_sha256': art['sha256'], 'build_job': receipt['job'], 'job': str(job), 'published': False, 'physical_device': False}
(job / 'receipt.json').write_text(json.dumps(result, indent=2) + '\n'); print(json.dumps({k: result[k] for k in ('status', 'passed', 'total', 'job')}))
sys.exit(0 if result['status'] == 'ok' else 1)
