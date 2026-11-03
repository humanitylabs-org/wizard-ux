#!/usr/bin/env python3
"""Focused forum-only native overlay acceptance. No owner traffic or publication.

Signed release: actual bundled overlay, idle, real recording/pause/cancel, sleep.
Debug: same bundled bytes in the actual overlay WebView; forced GL loss/restore.
Uses the existing raw CDP Page helper. Never enables debugging in release code.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time
import xml.etree.ElementTree as ET
import zipfile

SDK = Path('/srv/work/android-sdk')
SIGNER = '3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd'


def sha(p):
    with Path(p).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def check_assets(apk, source):
    with zipfile.ZipFile(apk) as z:
        for p in (source / 'android/app/src/main/assets/assist').iterdir():
            if p.is_file():
                assert z.read('assets/assist/' + p.name) == p.read_bytes(), p.name
    assert (source / 'web/orb.js').read_bytes() == (source / 'android/app/src/main/assets/assist/orb.js').read_bytes()


class Overlay:
    def __init__(self, out):
        self.out = out
        self.env = os.environ.copy()
        self.env.update(JAVA_HOME='/usr/lib/jvm/java-21-openjdk-amd64', ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK))
        self.env['PATH'] = self.env['JAVA_HOME'] + '/bin:' + self.env['PATH']
        for key in ('ANDROID_USER_HOME', 'ANDROID_EMULATOR_HOME', 'ANDROID_AVD_HOME'):
            self.env[key] = str(out / key.lower()); Path(self.env[key]).mkdir()
        self.em = None
        self.page = None
        self.checks = []
        self.S = 'emulator-5678'
        self.pkg = 'ai.wizards.os'

    def sh(self, *args, stdin=None, binary=False, timeout=90):
        r = subprocess.run([str(a) for a in args], input=stdin, env=self.env, capture_output=True, text=not binary, timeout=timeout)
        if r.returncode:
            raise RuntimeError('native operation failed: ' + str(r.returncode))
        return r.stdout

    def sx(self, command, **kw):
        return self.sh(SDK / 'platform-tools/adb', '-s', self.S, 'shell', command, **kw)

    def adb(self, *args, **kw):
        return self.sh(SDK / 'platform-tools/adb', '-s', self.S, *args, **kw)

    def check(self, name, ok):
        self.checks.append({'name': name, 'passed': bool(ok)})
        (self.out / 'checks.json').write_text(json.dumps(self.checks, indent=2))
        print(('PASS ' if ok else 'FAIL ') + name, flush=True)
        if not ok:
            raise AssertionError(name)

    def wait(self, fn, seconds=25):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if fn(): return
            time.sleep(.3)
        raise RuntimeError('native predicate deadline')

    def boot(self):
        assert self.S not in self.sh(SDK / 'platform-tools/adb', 'devices')
        self.sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'orb', '-k',
                'system-images;android-35;google_apis;x86_64', '-d', 'pixel_6', stdin='no\n', timeout=180)
        self.em = subprocess.Popen([str(SDK / 'emulator/emulator'), '@orb', '-port', '5678', '-no-window', '-no-audio',
            '-no-boot-anim', '-no-snapshot', '-gpu', 'swangle', '-feature', '-Vulkan,-GLDirectMem', '-accel', 'on',
            '-cores', '4', '-memory', '3072', '-camera-back', 'none', '-camera-front', 'none'], env=self.env,
            stdout=(self.out / 'emulator.log').open('w'), stderr=subprocess.STDOUT, start_new_session=True)
        from qa_unified_share_android import wait_for_emulator_boot
        wait_for_emulator_boot(self.em, lambda: self.sx('getprop sys.boot_completed', timeout=10))
        self.adb('root'); self.adb('wait-for-device')
        self.sx('svc wifi disable; svc data disable; input keyevent KEYCODE_WAKEUP; wm dismiss-keyguard; settings put system screen_off_timeout 1800000')
        for key in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'):
            self.sx('settings put global ' + key + ' 0')

    def window(self, title):
        for blk in self.sx('dumpsys window windows').split('Window #')[1:]:
            if title not in blk.split('\n', 1)[0] or 'mViewVisibility=0x8' in blk or 'mViewVisibility=0x4' in blk:
                continue
            m = re.search(r'(?:mFrame|frame)=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]', blk)
            if m:
                rect = tuple(map(int, m.groups()))
                if rect[2] > rect[0] and rect[3] > rect[1]: return rect
        return None

    def tap_window(self, title):
        self.wait(lambda: self.window(title))
        a = self.window(title); time.sleep(.5); b = self.window(title)
        assert a is not None and a == b and b is not None
        self.sx('input tap %d %d' % ((b[0] + b[2]) // 2, (b[1] + b[3]) // 2))

    def shot(self, name):
        p = self.out / (name + '.png')
        p.write_bytes(self.adb('exec-out', 'screencap', '-p', binary=True))
        # Parent must visually inspect these actual compositor pixels; an intact
        # PNG plus GL startup is not a colored-galaxy acceptance claim.
        rect = self.window('WizardEverywhere'); assert rect
        assert p.read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
        (self.out / (name + '-bounds.json')).write_text(json.dumps({'overlay_rect': rect, 'screenshot_sha256': sha(p)}))
        self.check(name + ': compositor screenshot captured for review', True)

    def setup(self, apk, pkg):
        self.pkg = pkg
        self.adb('install', apk)
        self.sx('am force-stop ' + pkg)
        uid = re.search(r'(?:userId|appId)=(\d+)', self.sx('dumpsys package ' + pkg)).group(1)
        base = '/data/user/0/' + pkg
        self.sx('mkdir -p ' + base + '/shared_prefs')
        prefs = '<map><boolean name="enabled" value="true"/></map>'
        self.adb('shell', 'sh -c "cat > ' + base + '/shared_prefs/everywhere.xml"', stdin=prefs)
        if pkg.endswith('.qa'):
            # Synthetic-only state, no authenticated owner/home fixture.
            text = '<map><string name="origin">https://fixture.invalid</string></map>'
            self.adb('shell', 'sh -c "cat > ' + base + '/shared_prefs/wizard_server.xml"', stdin=text)
        self.sx('chown -R ' + uid + ':' + uid + ' ' + base + '/shared_prefs; restorecon -RF ' + base + '/shared_prefs')
        self.sx('appops set ' + pkg + ' SYSTEM_ALERT_WINDOW allow')
        for perm in ('RECORD_AUDIO', 'POST_NOTIFICATIONS'):
            self.sx('pm grant ' + pkg + ' android.permission.' + perm)
        self.sx('logcat -c; am start -W -n ' + pkg + '/ai.wizards.os.MainActivity')
        time.sleep(5)
        self.sx('input keyevent KEYCODE_HOME')
        self.wait(lambda: self.window('WizardEverywhere'))
        self.wait(lambda: 'everywhere page ready webgl=true' in self.sx('logcat -d -s WizardEverywhere:V'))

    def recording(self, label):
        self.tap_window('WizardEverywhere')
        self.wait(lambda: self.window('WizOrbCtl-pause'))
        self.check(label + ': real recording starts', ': listening' in self.sx('logcat -d -s WizardEverywhere:V'))
        self.tap_window('WizOrbCtl-pause')
        self.wait(lambda: ': paused' in self.sx('logcat -d -s WizardEverywhere:V'))
        self.check(label + ': recording pauses', True)
        self.tap_window('WizOrbCtl-cancel')
        self.wait(lambda: not self.window('WizOrbCtl-pause'))
        self.check(label + ': recording cancels without send', ': sending' not in self.sx('logcat -d -s WizardEverywhere:V'))

    def debug_recovery(self):
        from qa_aa_lib import Page
        self.page = p = Page(self, 9349, match='assist/everywhere.html')
        self.check('debug: actual bundled native overlay', p.ev("location.href==='file:///android_asset/assist/everywhere.html' && Orb.webgl"))
        p.ev("window.__draws=0;{const g=WebGLRenderingContext.prototype,f=g.drawArrays;g.drawArrays=function(...a){__draws++;return f.apply(this,a)}};window.__ext=document.getElementById('orb').getContext('webgl').getExtension('WEBGL_lose_context')")
        self.check('debug: loss extension available', p.ev('!!__ext'))
        for i in range(2):
            p.ev('__ext.loseContext()')
            self.wait(lambda: p.ev('!Orb.webgl && document.getElementById("orb").hidden && !document.getElementById("orbFallback").hidden'))
            p.ev('__ext.restoreContext()')
            self.wait(lambda: p.ev('Orb.webgl && !document.getElementById("orb").hidden && document.getElementById("orbFallback").hidden'))
            self.check('debug: context recovery ' + str(i + 1), p.ev("Orb.mode==='idle' && S.mode==='idle'"))
            self.shot('debug-restored-' + str(i + 1))
        time.sleep(3); draws = p.ev('__draws'); time.sleep(2)
        self.check('debug: recovered idle refreezes', draws == p.ev('__draws'))
        self.sx('logcat -c; input keyevent KEYCODE_SLEEP'); time.sleep(2)
        # No CDP evaluation while sleeping: inspecting a WebView may wake it.
        self.sx('input keyevent KEYCODE_WAKEUP; wm dismiss-keyguard'); time.sleep(2)
        logs = self.sx('logcat -d -s WizardEverywhere:V')
        self.check('debug: native screen sleep/wake', 'orb asleep' in logs and 'orb awake' in logs)
        self.check('debug: recovered after real screen wake', p.ev('Orb.webgl'))
        self.page.close(); self.page = None

    def close(self):
        if self.page: self.page.close()
        if self.em:
            try: self.adb('emu', 'kill')
            finally:
                try: self.em.wait(40)
                except subprocess.TimeoutExpired:
                    os.killpg(self.em.pid, signal.SIGKILL); self.em.wait(10)
            assert self.em.poll() is not None


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('release'); ap.add_argument('debug'); ap.add_argument('out'); a = ap.parse_args()
    assert os.uname().nodename == 'forum' and os.environ.get('WIZARD_HEAVY_LOCK_FD')
    lock = int(os.environ['WIZARD_HEAVY_LOCK_FD'])
    assert os.fstat(lock).st_ino == Path('/srv/work/heavy/production/worker.lock').stat().st_ino
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    out = Path(a.out); assert out.is_relative_to('/srv/work/AndroidBuilds'); out.mkdir()
    source = Path(__file__).resolve().parent.parent
    for apk in (a.release, a.debug): check_assets(apk, source)
    suite = Overlay(out); ok = False
    def interrupted(signum, frame):
        raise SystemExit('native gate interrupted: ' + str(signum))
    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGALRM):
        signal.signal(signum, interrupted)
    signal.alarm(780)
    try:
        suite.boot(); suite.setup(a.release, 'ai.wizards.os')
        suite.shot('signed-idle'); suite.recording('signed')
        suite.sx('logcat -c; input keyevent KEYCODE_SLEEP'); time.sleep(3)
        suite.sx('input keyevent KEYCODE_WAKEUP; wm dismiss-keyguard'); time.sleep(2)
        logs = suite.sx('logcat -d -s WizardEverywhere:V')
        suite.check('signed: native screen sleep/wake', 'orb asleep' in logs and 'orb awake' in logs)
        suite.shot('signed-wake'); suite.sx('am force-stop ai.wizards.os')
        suite.setup(a.debug, 'ai.wizards.os.qa'); suite.debug_recovery(); suite.recording('debug')
        crash = suite.sx('logcat -d -b crash'); (out / 'crash.txt').write_text(crash)
        suite.check('debug: no native crash', 'FATAL EXCEPTION' not in crash)
        ok = True
    finally:
        suite.close()
        (out / 'receipt.json').write_text(json.dumps({'ok': ok, 'checks': suite.checks,
            'release_sha256': sha(a.release), 'debug_sha256': sha(a.debug),
            'orb_sha256': sha(source / 'web/orb.js'), 'emulator_stopped': suite.em is None or suite.em.poll() is not None,
            'scope': 'API35 x86_64 emulator: signed overlay + same-asset debug GL loss; not physical Samsung trigger proof'}, indent=2))


if __name__ == '__main__': main()
