#!/usr/bin/env python3
"""Probe (runs on Thales): which settings pages and state Wizard OS can reach for side-button setup.
Boots a throwaway API35 emulator, installs the given APK, inspects intents/settings, always stops."""
import fcntl, os, pathlib, subprocess, sys, time, uuid
P = pathlib.Path
BASE = P('/Volumes/ThalesMedia/AndroidBuilds'); SDK = P('/opt/homebrew/share/android-commandlinetools')
apk = P(sys.argv[1]); PKG = sys.argv[2] if len(sys.argv) > 2 else 'ai.wizards.os'
job = BASE / 'qa' / ('wos-probe-' + uuid.uuid4().hex[:8]); job.mkdir(parents=True)
env = os.environ.copy(); env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']; (job / 'avd').mkdir()
ADB = str(SDK / 'platform-tools/adb'); S = 'emulator-5688'
def sh(*a, stdin=None): return subprocess.run([str(x) for x in a], env=env, capture_output=True, text=True, input=stdin).stdout
def sx(c): return sh(ADB, '-s', S, 'shell', c)
def top(): return next((l.strip() for l in sx('dumpsys activity activities').splitlines() if 'topResumedActivity' in l), '')
em = None
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'p', '-k', 'system-images;android-35;google_apis;arm64-v8a', '-p', job / 'dev', stdin='no\n')
        em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'p', '-port', '5688', '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect'], env=env, stdout=open(job / 'em.log', 'w'), stderr=subprocess.STDOUT)
        for _ in range(100):
            if sx('getprop sys.boot_completed').strip() == '1': break
            time.sleep(3)
        time.sleep(8)
        print(sh(ADB, '-s', S, 'install', '-r', apk).strip())
        print('power_button_long_press', sx('settings get global power_button_long_press').strip())
        print('config longpress', sx('cmd overlay lookup android android:integer/config_longPressOnPowerBehavior').strip())
        print('assistant holders', sx('cmd role get-role-holders --user 0 android.app.role.ASSISTANT').strip())
        for a in ['android.settings.VOICE_INPUT_SETTINGS', 'android.settings.MANAGE_DEFAULT_APPS_SETTINGS',
                  'android.intent.action.MANAGE_DEFAULT_APP', 'android.app.role.action.REQUEST_ROLE',
                  'android.settings.ASSIST_GESTURE_SETTINGS', 'android.settings.POWER_MENU_SETTINGS',
                  'android.settings.GESTURE_SETTINGS', 'com.android.settings.action.POWER_MENU_SETTINGS']:
            print('RESOLVE', a, '=>', sx(f'cmd package resolve-activity --brief -a {a}').strip().replace('\n', ' | '))
        # exported settings activities that mention power/gesture/assist
        dump = sx('dumpsys package com.android.settings')
        names = sorted({w for l in dump.splitlines() for w in l.split() if 'com.android.settings/' in w and any(k in w.lower() for k in ('power', 'gesture', 'assist', 'defaultapp', 'voice'))})
        print('SETTINGS ACTIVITIES', '\n  '.join([''] + names))
        pc = sx('dumpsys package com.android.permissioncontroller')
        i = pc.find('android.intent.action.MANAGE_DEFAULT_APP')
        print('PC MANAGE_DEFAULT_APP ctx', pc[max(0, i - 600):i + 200] if i >= 0 else 'none')
        # launch candidates as a plain app would see them (from shell; note shell has extra perms)
        for comp in ['-a android.settings.VOICE_INPUT_SETTINGS',
                     '-a android.intent.action.MANAGE_DEFAULT_APP --es android.intent.extra.ROLE_NAME android.app.role.ASSISTANT']:
            print('START', comp, sx(f'am start -W {comp}').strip()[-300:]); time.sleep(3); print('  top', top())
            sh(ADB, '-s', S, 'exec-out', 'screencap', '-p', stdin=None)
            sx('input keyevent KEYCODE_HOME'); time.sleep(1)
    finally:
        if em: sh(ADB, '-s', S, 'emu', 'kill'); em.wait(30)
