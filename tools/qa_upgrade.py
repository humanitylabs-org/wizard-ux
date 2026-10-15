#!/usr/bin/env python3
"""Upgrade smoke (runs on Thales): install the OLD release, upgrade to the NEW release in place, launch it,
confirm it is the same app (data kept), it starts, the shell loads, and nothing crashes. Always stops the emulator.
usage: qa_upgrade.py OLD_APK NEW_APK"""
import fcntl, hashlib, json, os, pathlib, re, subprocess, sys, time, uuid
P = pathlib.Path
BASE = P('/Volumes/ThalesMedia/AndroidBuilds'); SDK = P('/opt/homebrew/share/android-commandlinetools')
old, new = P(sys.argv[1]), P(sys.argv[2]); PKG = 'ai.wizards.os'
job = BASE / 'qa' / ('wos-upgrade-' + uuid.uuid4().hex[:8]); job.mkdir(parents=True)
env = os.environ.copy(); env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']; (job / 'avd').mkdir()
ADB = str(SDK / 'platform-tools/adb'); PORT = 5694; S = f'emulator-{PORT}'
res = []
def check(n, ok, d=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n + (' — ' + str(d) if d else ''), flush=True)
def sh(*a, binary=False, stdin=None):
    return subprocess.run([str(x) for x in a], env=env, capture_output=True, text=not binary, input=stdin).stdout
def sx(c): return sh(ADB, '-s', S, 'shell', c)
def top(): return next((l.strip() for l in sx('dumpsys activity activities').splitlines() if 'topResumedActivity' in l), '')
bt = sorted((SDK / 'build-tools').iterdir())[-1]
for f in (old, new):
    certs = sh(bt / 'apksigner', 'verify', '--print-certs', f)
    print(f.name, re.search(r'SHA-256 digest: (\w+)', certs).group(1)[:16] if 'SHA-256' in certs else certs[:200])
# The expected new versionName: WOS_NEW if given, else read from the new APK itself (no stale hard-coded default).
_vn = re.search(r"versionName='([^']+)'", sh(bt / 'aapt2', 'dump', 'badging', new) or '')
WANT_VN = os.environ.get('WOS_NEW') or (_vn.group(1) if _vn else '')
print('expect versionName', WANT_VN)
em = None
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'q', '-k', 'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7', '-p', job / 'dev', stdin='no\n')
        em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'q', '-port', str(PORT), '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect'], env=env, stdout=open(job / 'em.log', 'w'), stderr=subprocess.STDOUT)
        for _ in range(120):
            if sx('getprop sys.boot_completed').strip() == '1': break
            time.sleep(3)
        time.sleep(8); sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard')
        o1 = sh(ADB, '-s', S, 'install', old).strip().splitlines()[-1]
        check('old release installs', o1 == 'Success', o1)
        sx(f'am start -W -n {PKG}/.MainActivity'); time.sleep(6)
        sx(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
        old_package = sx(f'dumpsys package {PKG}')
        first = next((l.strip() for l in old_package.splitlines() if 'firstInstallTime=' in l), '')
        old_uid = re.search(r'userId=(\d+)', old_package).group(1)
        o2 = sh(ADB, '-s', S, 'install', '-r', new).strip().splitlines()[-1]
        ver = re.search(r'versionName=\S+', sx(f'dumpsys package {PKG}')).group(0)
        check('new release installs over the old one (same signer, data kept)', o2 == 'Success' and WANT_VN and ver == 'versionName=' + WANT_VN and sx(f'dumpsys package {PKG} | grep firstInstallTime').strip() == first, (o2, ver))
        new_package = sx(f'dumpsys package {PKG}')
        check('same install identity and notification grant survive upgrade',
              bool(re.search(r'userId=' + old_uid + r'\b', new_package)) and 'android.permission.POST_NOTIFICATIONS: granted=true' in new_package)
        check('release remains non-debuggable and includes native audio',
              'DEBUGGABLE' not in new_package and 'BackgroundAudioService' in new_package)
        sx('logcat -c')
        sx(f'am start -W -n {PKG}/.MainActivity'); time.sleep(8)
        check('new release launches into Wizard OS', PKG in top(), top())
        (job / 'after.png').write_bytes(sh(ADB, '-s', S, 'exec-out', 'screencap', '-p', binary=True))
        for step in range(3):
            sx('input keyevent KEYCODE_BACK'); time.sleep(1)
            check(f'signed upgrade Back step {step+1} retains Wizard', PKG in top(), top())
        sx('input keyevent KEYCODE_HOME'); time.sleep(3)
        crashed = sx('logcat -d -b crash')
        check('no crashes', 'FATAL EXCEPTION' not in crashed, crashed[:300])
        perms = sx(f'dumpsys package {PKG} | grep -E "SYSTEM_ALERT_WINDOW|POST_NOTIFICATIONS|FOREGROUND_SERVICE_SPECIAL_USE" | head -5')
        check('declares overlay + notifications + voice typing (accessibility) service', 'SYSTEM_ALERT_WINDOW' in perms and 'POST_NOTIFICATIONS' in perms and 'WizardKeyboardService' in sx(f'dumpsys package {PKG}'), perms.strip()[:300])
        check('Everywhere stays off until switched on in Settings', 'EverywhereService' not in sx('dumpsys activity services ' + PKG))
    finally:
        if em: sh(ADB, '-s', S, 'emu', 'kill'); em.wait(40)
print(f'{sum(res)}/{len(res)} passed · {job}')
(job / 'receipt.json').write_text(json.dumps({'old_sha256':hashlib.sha256(old.read_bytes()).hexdigest(), 'new_sha256':hashlib.sha256(new.read_bytes()).hexdigest(), 'expected_version':WANT_VN, 'checks':res, 'passed':sum(res), 'total':len(res), 'ok':bool(res) and all(res)},indent=2))
sys.exit(0 if res and all(res) else 1)
