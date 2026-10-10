#!/usr/bin/env python3
"""Floating-orb battery measurement (runs on Thales). Fresh API35 emulator, real APKs, one minute per phase.

usage: qa_orb_battery.py NEW_APK PKG [BASE_APK] [SECS]

For each APK (baseline first when given, then the new one) it installs the exact bytes, turns Wizard
Everywhere on, leaves Wizard OS for another app (the dialer) so the floating orb shows, and measures over
SECS seconds:
  - frames the orb's overlay WebView rendered  (dumpsys gfxinfo PKG: Total frames rendered, reset first)
  - CPU time of every process of the package, incl. the WebView renderer (/proc/<pid>/stat utime+stime)
Phases: idle orb over the dialer; screen off (orb attached, display off).
James, 10 Oct 2026: Device care showed Wizard OS at 38.5% of a day's battery with the orb in the corner.
"""
import fcntl, json, os, pathlib, re, subprocess, sys, time, uuid
P = pathlib.Path
BASE = P('/Volumes/ThalesMedia/AndroidBuilds'); SDK = P('/opt/homebrew/share/android-commandlinetools')
new = P(sys.argv[1]); PKG = sys.argv[2]
base = P(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] not in ('', '-') else None
SECS = int(sys.argv[4]) if len(sys.argv) > 4 else 60
job = BASE / 'qa' / ('wos-orb-battery-' + uuid.uuid4().hex[:8]); job.mkdir(parents=True)
env = os.environ.copy(); env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']; (job / 'avd').mkdir()
ADB = str(SDK / 'platform-tools/adb'); PORT = 5694; S = f'emulator-{PORT}'
res = []; metrics = {}

def check(n, ok, d=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n + (' — ' + str(d) if d else ''), flush=True)
def sh(*a, stdin=None, binary=False):
    r = subprocess.run([str(x) for x in a], env=env, capture_output=True, input=stdin, text=not binary)
    return r.stdout
def sx(c): return sh(ADB, '-s', S, 'shell', c)
def bubble():
    for blk in sx('dumpsys window windows').split('Window #')[1:]:
        if 'WizardEverywhere' in blk.split('\n', 1)[0]:
            m = re.search(r'(?:mFrame|frame)=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]', blk)
            if m and 'mViewVisibility=0x8' not in blk and 'mViewVisibility=0x4' not in blk: return tuple(map(int, m.groups()))
    return None
def wait_bubble(want, secs=12):
    t0 = time.time()
    while time.time() - t0 < secs:
        if bool(bubble()) == want: return True
        time.sleep(0.8)
    return bool(bubble()) == want
def pids():
    out = []
    for line in sx('ps -A -o PID,NAME').splitlines()[1:]:
        p = line.split()
        if len(p) >= 2 and (PKG in p[1] or 'webview' in p[1].lower() or 'sandboxed_process' in p[1]): out.append(p[0])
    return out
def cpu_ticks():
    t = 0
    for p in pids():
        st = sx(f'cat /proc/{p}/stat 2>/dev/null').strip()
        if not st: continue
        f = st.rsplit(')', 1)[-1].split()
        try: t += int(f[11]) + int(f[12])
        except Exception: pass
    return t
def frames():
    m = re.search(r'Total frames rendered:\s*(\d+)', sx(f'dumpsys gfxinfo {PKG}'))
    return int(m.group(1)) if m else -1
def measure(label):
    sx(f'dumpsys gfxinfo {PKG} reset'); c0 = cpu_ticks(); t0 = time.time()
    time.sleep(SECS)
    dt = time.time() - t0; fr = frames(); c1 = cpu_ticks()
    hz = 100  # USER_HZ on Android
    m = {'frames_per_min': round(fr * 60 / dt), 'cpu_s_per_min': round((c1 - c0) / hz * 60 / dt, 2)}
    print(f'  {label}: {m}', flush=True); return m

def run_apk(name, apk):
    sh(ADB, '-s', S, 'uninstall', PKG)
    out = sh(ADB, '-s', S, 'install', '-r', apk).strip().splitlines()[-1]
    ver = re.search(r'versionName=\S+', sx(f'dumpsys package {PKG}'))
    check(f'{name}: install', out == 'Success', out + ' ' + (ver.group(0) if ver else ''))
    sx(f'appops set {PKG} SYSTEM_ALERT_WINDOW allow'); sx(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS'); sx(f'pm grant {PKG} android.permission.RECORD_AUDIO')
    sx(f'run-as {PKG} mkdir -p shared_prefs')
    sx(f"run-as {PKG} sh -c 'echo \"<?xml version=\\\"1.0\\\" encoding=\\\"utf-8\\\" standalone=\\\"yes\\\" ?><map><boolean name=\\\"enabled\\\" value=\\\"true\\\" /></map>\" > shared_prefs/everywhere.xml'")
    sx('logcat -c')
    sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(10)
    sx('am start -W -a android.intent.action.DIAL'); time.sleep(4)
    shown = wait_bubble(True)
    check(f'{name}: floating orb shows over another app', shown, bubble())
    sh(ADB, '-s', S, 'exec-out', 'screencap', '-p', binary=True) and (job / f'{name}-orb.png').write_bytes(sh(ADB, '-s', S, 'exec-out', 'screencap', '-p', binary=True))
    time.sleep(3)
    m = {'idle': measure(f'{name} idle orb over the dialer')}
    sx('svc power stayon false'); sx('input keyevent KEYCODE_SLEEP'); time.sleep(3)
    print('  display:', re.findall(r'mWakefulness=\w+', sx('dumpsys power')), flush=True)
    m['screen_off'] = measure(f'{name} screen off')
    sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard'); sx('svc power stayon true'); time.sleep(3)
    m['awake_again_bubble'] = wait_bubble(True)
    m['log'] = sx('logcat -d -s WizardEverywhere:* | grep -iE "orb (asleep|awake)" | tail -6').strip()
    crashed = sx('logcat -d -b crash')
    check(f'{name}: no crashes', 'FATAL EXCEPTION' not in crashed, crashed[:300])
    return m

em = None
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'q', '-k', 'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7', '-p', job / 'dev', stdin='no\n')
        em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'q', '-port', str(PORT), '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect'], env=env, stdout=open(job / 'em.log', 'w'), stderr=subprocess.STDOUT)
        for _ in range(120):
            if sx('getprop sys.boot_completed').strip() == '1': break
            time.sleep(3)
        time.sleep(10)
        sx('settings put system screen_off_timeout 1800000'); sx('svc power stayon true')
        sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard')
        if base: metrics['baseline'] = run_apk('baseline', base)
        sx('svc power stayon true')
        metrics['new'] = run_apk('new', new)
        n = metrics['new']
        check('new: floating orb back after screen on', n['awake_again_bubble'])
        check('new: orb sleeps with the screen off and wakes with it', 'asleep' in n['log'] and 'awake' in n['log'], n['log'])
        if base:
            b = metrics['baseline']
            drop = 1 - n['idle']['frames_per_min'] / max(1, b['idle']['frames_per_min'])
            metrics['idle_frame_drop'] = round(drop, 3)
            check('idle floating orb renders ≥ 70% fewer frames than the baseline', drop >= .7, f"{b['idle']['frames_per_min']} → {n['idle']['frames_per_min']} frames/min")
            check('idle floating orb uses less CPU than the baseline', n['idle']['cpu_s_per_min'] < b['idle']['cpu_s_per_min'], f"{b['idle']['cpu_s_per_min']} → {n['idle']['cpu_s_per_min']} CPU s/min")
        check('idle floating orb rests at ≤ 15 fps', n['idle']['frames_per_min'] <= 15 * 60, n['idle'])
        check('screen off: (almost) no orb frames', n['screen_off']['frames_per_min'] <= 30, n['screen_off'])
    finally:
        if em: sh(ADB, '-s', S, 'emu', 'kill'); em.wait(40)
        (job / 'metrics.json').write_text(json.dumps(metrics, indent=1))
print('METRICS ' + json.dumps({k: v for k, v in metrics.items()}, default=str))
print(f'{sum(res)}/{len(res)} passed · {job}')
