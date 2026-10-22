#!/usr/bin/env python3
"""Thales-only native orb tap/resume acceptance against an ALREADY BUILT debug APK.

Usage: python3 tools/qa_orb_tap_resume_native.py DEBUG_RECEIPT OUT
OUT must be a new directory under the worker build root ($ANDROID_BUILDS_ROOT).
Uses the inherited WIZARD_HEAVY_LOCK_FD or acquires worker.lock itself. No build.
All traffic goes to a loopback fake; no owner configuration or private audio.

Floating checks 1/2 use the real emulator MediaRecorder (silence is intentional:
only the tap may end these takes). Canned floating audio has a 4-second auto-finish
hook and would make a broken second tap look successful. Side canned audio has
its auto-send explicitly disabled. Dictation uses canned audio, paused before its
4-second deadline; completion must happen within 2 seconds of the paused tap.
"""
import argparse
import ast
import contextlib
import fcntl
import hashlib
import http.server
import json
import os
import pathlib
import re
import shlex
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.parse
import urllib.request
import uuid

P = pathlib.Path
BASE = P(os.environ.get('ANDROID_BUILDS_ROOT') or P.home() / 'AndroidBuilds')  # worker-local build root
SDK = P('/opt/homebrew/share/android-commandlinetools')
PKG = 'ai.wizards.os.qa'
HELPERS = {'Fake', 'Page', 'top', 'shot', 'ui', 'tap_text', 'bubble', 'controls',
           'mid', 'wait_bubble', 'wait_log'}
REQUIRED = {'everywhere.1', 'everywhere.2', 'everywhere.4', 'assist.1', 'assist.2'}
EXPECTED = REQUIRED | {'everywhere.3.dictation', 'everywhere.3.mic_lost',
                       'assist.3.dictation', 'assist.3.mic_lost', 'assist.4'}


def load_helpers(namespace):
    """Reuse legacy definitions WITHOUT importing its executable top-level suite.

    qa_everywhere.py has no main guard: importing it starts a server and emulator.
    Select only named function/class AST nodes. Never execute its assignments,
    with blocks, imports, or other top-level statements. Fail on helper drift.
    """
    source = P(__file__).with_name('qa_everywhere.py')
    tree = ast.parse(source.read_text(), filename=str(source))
    nodes: list[ast.stmt] = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef))
             and n.name in HELPERS]
    if {getattr(n, 'name', None) for n in nodes} != HELPERS:
        raise RuntimeError('qa_everywhere helper API changed')
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), namespace)
    return namespace


def artifact(receipt_path):
    receipt = json.loads(P(receipt_path).read_text())
    if receipt.get('status') != 'ok':
        raise ValueError('build receipt status is not ok')
    candidates = [a for a in receipt['artifacts']
                  if a.get('aapt2', {}).get('package') == PKG
                  and str(a.get('path', '')).endswith('.apk')]
    if len(candidates) != 1:
        raise ValueError('expected exactly one ai.wizards.os.qa APK in receipt')
    a = candidates[0]
    apk = (P(receipt['job']) / 'source' / a['path']).resolve()
    if hashlib.sha256(apk.read_bytes()).hexdigest() != a['sha256']:
        raise ValueError('APK sha256 mismatch')
    return apk, a['sha256']


def receipt_ok(checks, completed):
    by_id = {c['id']: c['status'] for c in checks}
    return (completed and REQUIRED <= by_id.keys()
            and all(by_id[k] == 'PASS' for k in REQUIRED)
            and not any(c['status'] == 'FAIL' for c in checks))


@contextlib.contextmanager
def worker_lock():
    inherited = os.environ.get('WIZARD_HEAVY_LOCK_FD')
    lock = os.fdopen(int(inherited), 'a', closefd=False) if inherited else (BASE / 'worker.lock').open('a')
    with lock:
        if inherited:
            a, b = (BASE / 'worker.lock').stat(), os.fstat(lock.fileno())
            if (a.st_dev, a.st_ino) != (b.st_dev, b.st_ino):
                raise RuntimeError('inherited fd is not the shared worker.lock')
        fcntl.flock(lock, fcntl.LOCK_EX | (fcntl.LOCK_NB if inherited else 0))
        # Do not LOCK_UN an inherited open-file description owned by the worker.
        yield


class Suite:
    def __init__(self, out, apk):
        self.out, self.apk = out, apk
        self.checks, self.pages, self.crashes = [], [], []
        self.em = self.server = None
        self.phase = 'setup'
        self.current_check = None
        self.env = os.environ.copy()
        self.env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
                        ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK),
                        ANDROID_AVD_HOME=str(out / 'avd'))
        self.env['PATH'] = self.env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + self.env['PATH']
        self.port, self.devtools, self.fake = 5688, 9347, 18781
        self.serial = f'emulator-{self.port}'
        self.adb = SDK / 'platform-tools/adb'
        self.state = {'transcribe': 0, 'runs': [], 'run_keys': {}, 'uploads': 0,
                      'sessions': set(), 'drop_transcribe': 0, 'drop_runs': 0,
                      'down': False, 'log': []}
        ns = dict(globals(), ADB=str(self.adb), S=self.serial, DEVTOOLS=self.devtools,
                  FAKE=self.fake, WEB=P(__file__).resolve().parent.parent / 'web',
                  STATE=self.state, OUT=out, env=self.env, sh=self.sh, sx=self.sx,
                  logs=self.logs, alogs=self.alogs)
        self.h = load_helpers(ns)

    def sh(self, *args, stdin=None, binary=False):
        r = subprocess.run([str(a) for a in args], env=self.env, capture_output=True,
                           input=stdin, text=not binary, timeout=90)
        if r.returncode:
            raise RuntimeError(f'command failed ({r.returncode}): {args!r}: {r.stderr!r}')
        return r.stdout

    def sx(self, command):
        return self.sh(self.adb, '-s', self.serial, 'shell', command)

    def log(self, tag, pattern):
        text = self.sx(f'logcat -d -v brief -s {tag}:V')
        return '\n'.join(l for l in text.splitlines() if re.search(pattern, l, re.I))

    def logs(self, pattern):
        return self.log('WizardEverywhere', pattern)

    def alogs(self, pattern):
        return self.log('WizardOSAssist', pattern)

    def wait(self, fn, seconds=12):
        deadline = time.monotonic() + seconds
        last = None
        while time.monotonic() < deadline:
            last = fn()
            if last:
                return last
            time.sleep(.15)
        raise AssertionError(f'timeout in {self.phase}: {last!r}')

    def check(self, ident, passed, detail):
        self.checks.append({'id': ident, 'status': 'PASS' if passed else 'FAIL', 'detail': detail})
        self.current_check = None
        print(self.checks[-1]['status'], ident, flush=True)
        if not passed:
            raise AssertionError(ident)

    def nc(self, ident, reason):
        self.checks.append({'id': ident, 'status': 'NOT_COVERED', 'detail': reason})

    def save(self):
        (self.out / (self.phase + '-logcat.txt')).write_text(self.sx('logcat -d -v threadtime'))
        crash = self.sx('logcat -d -b crash')
        (self.out / (self.phase + '-crash.txt')).write_text(crash)
        if 'FATAL EXCEPTION' in crash:
            self.crashes.append({'phase': self.phase, 'log': crash})
        self.h['shot'](self.phase)

    def begin(self, phase):
        self.save()
        self.phase = phase
        self.sx('logcat -c')

    def tap(self, point):
        self.sx('input tap %d %d' % tuple(point))

    def settled(self, read):
        # A window's frame is reported before it is laid out and animated in; tapping that first
        # frame lands on whatever is underneath (r6 opened the launcher's YouTube icon). Tap only a
        # non-empty frame that reads the same twice, 300 ms apart.
        def stable():
            a = read()
            if not a or a[2] - a[0] < 8 or a[3] - a[1] < 8:
                return None
            time.sleep(.3)
            return a if read() == a else None
        return self.wait(stable)

    def orb(self):
        self.tap(self.h['mid'](self.settled(self.h['bubble'])))

    def control(self, name):
        self.tap(self.h['mid'](self.settled(lambda: self.h['controls']().get(name))))

    def page(self, match):
        pg = self.h['Page'](match=match, fetch=False)
        self.pages.append(pg)
        return pg

    def submissions(self):
        # Exclude incidental reads; include every mutation that could finish a take.
        return [p for p in self.state['log'] if p in (
            '/wizard-os-home/api/transcribe', '/wizard/files/upload',
            '/wizard/hermes/api/sessions', '/wizard/hermes/v1/runs')]

    def unchanged(self, before, pg, expression, seconds=1.2):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if self.submissions() != before or not pg.ev(expression):
                return False
            time.sleep(.15)
        return True

    def stage(self, filename='qa_next.m4a'):
        self.sx(f'run-as {PKG} cp /data/local/tmp/qa_voice.m4a files/{filename}')

    def write_private(self, filename, text):
        # adb's stdin, rather than shell interpolation, writes disposable guest files.
        self.sh(self.adb, '-s', self.serial, 'shell',
                f'run-as {PKG} sh -c {shlex.quote("cat > " + filename)}', stdin=text)

    def setup(self):
        devices = self.sh(self.adb, 'devices')
        if self.serial in devices:
            raise RuntimeError('reserved emulator serial already in use; refusing to touch it')
        (self.out / 'avd').mkdir()
        self.sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'orb-resume',
                '-k', 'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7',
                '-p', self.out / 'device', stdin='no\n')
        with (self.out / 'emulator.log').open('w') as log:
            self.em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'orb-resume',
                '-port', str(self.port), '-no-window', '-no-snapshot', '-no-audio',
                '-gpu', 'swiftshader_indirect'], env=self.env, stdout=log, stderr=subprocess.STDOUT)
        def booted():
            if self.em is None or self.em.poll() is not None:
                raise RuntimeError('emulator exited before boot')
            try:
                return self.sx('getprop sys.boot_completed').strip() == '1'
            except RuntimeError:
                return False
        self.wait(booted, 300)
        self.sx('input keyevent KEYCODE_WAKEUP'); self.sx('wm dismiss-keyguard')
        for key in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'):
            self.sx(f'settings put global {key} 0')
        self.check('setup.api35', self.sx('getprop ro.build.version.sdk').strip() == '35', 'fresh API35 guest')
        self.sh(self.adb, '-s', self.serial, 'install', self.apk)
        self.sx(f'run-as {PKG} mkdir -p files shared_prefs')  # run-as rejects non-debug APKs
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', self.fake), self.h['Fake'])
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        origin = f'http://localhost:{self.fake}'
        self.sh(self.adb, '-s', self.serial, 'reverse', f'tcp:{self.fake}', f'tcp:{self.fake}')
        self.write_private('files/qa_origin.txt', f'http://10.0.2.2:{self.fake}\n')
        self.write_private('files/qa_home.txt', origin + '\n')
        # MainActivity gates on ServerSettings BEFORE consulting qa_home. Seed fresh
        # debug prefs while the process is stopped, then read back before launch.
        prefs = f'<?xml version="1.0" encoding="utf-8"?><map><string name="origin">{origin}</string></map>\n'
        self.write_private('shared_prefs/wizard_server.xml', prefs)
        self.check('setup.origin', origin in self.sx(f'run-as {PKG} cat shared_prefs/wizard_server.xml'),
                   'debug-only loopback origin seeded before first launch; Connect UI is not under test')
        for perm in ('RECORD_AUDIO', 'POST_NOTIFICATIONS'):
            self.sx(f'pm grant {PKG} android.permission.{perm}')
        self.sx(f'appops set {PKG} SYSTEM_ALERT_WINDOW allow')
        self.sh('say', '-o', self.out / 'speech.aiff', 'This is a synthetic Wizard orb resume test.')
        self.sh('afconvert', '-f', 'm4af', '-d', 'aac', self.out / 'speech.aiff', self.out / 'speech.m4a')
        self.sh(self.adb, '-s', self.serial, 'push', self.out / 'speech.m4a', '/data/local/tmp/qa_voice.m4a')
        # A fresh Google image's preinstalled apps raise permission dialogs over the overlay; the
        # suite's taps must reach Wizard's windows, so keep them out of this throwaway guest.
        for noisy in ('com.google.android.youtube', 'com.google.android.apps.youtube.music'):
            self.sx(f'pm disable-user --user 0 {noisy} >/dev/null 2>&1; true')
        self.sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity')
        self.home = self.page('wizard-os-home')
        self.wait(lambda: self.home.ev('!!window.__wos'))
        self.home.ev("document.querySelector('#coachGo')?.click(); window.__wos.closeSheets(); window.WizardOSNative.setEverywhere(true)")
        # Enabling Everywhere may show the Accessibility setup dialog. Dismiss it
        # through the real UI, rather than leaving a native modal over the shell.
        self.h['tap_text']('^Not now$')
        self.sx('input keyevent KEYCODE_HOME')
        self.wait(self.h['bubble'])
        self.floating = self.page('assist/everywhere.html')
        self.wait(lambda: self.floating.ev("typeof S !== 'undefined' && S.mode==='idle'"))

    def floating_take(self):
        self.current_check = 'everywhere.1'
        self.begin('everywhere-resume')
        before = self.submissions()
        self.orb()  # NO staged file: real recorder, no QA auto-finish timer.
        self.wait(lambda: self.logs(r': listening$'))
        self.control('pause')
        self.wait(lambda: self.logs(r': paused$'))
        self.wait(lambda: self.floating.ev("S.mode==='paused'"))
        self.orb()
        resumed = self.h['wait_log'](r': resumed$', 5)
        self.check('everywhere.1', bool(resumed) and self.unchanged(before, self.floating,
                   "S.mode==='listen'") and 'pause' in self.h['controls'](),
                   {'log': resumed, 'new_posts': self.submissions()[len(before):], 'audio': 'real MediaRecorder; no auto-finish'})
        self.save()
        self.current_check = 'everywhere.2'
        self.begin('everywhere-send')
        n = len(self.state['runs'])
        self.orb()
        self.wait(lambda: not self.h['controls'](), 2)
        self.wait(lambda: len(self.state['runs']) > n, 45)
        sent = self.h['wait_log'](': sent ', 15)
        time.sleep(1)
        body = self.state['runs'][-1]['body']
        self.check('everywhere.2', len(self.state['runs']) == n + 1 and bool(sent)
                   and bool(body.get('wizard_file_ids')),
                   {'log': sent, 'runs_delta': len(self.state['runs']) - n,
                    'new_posts': self.submissions()[len(before):], 'body': body})
        self.wait(lambda: self.floating.ev("S.mode==='idle'"), 15)

    def carried_take(self):
        self.current_check = 'everywhere.4'
        self.begin('everywhere-carried')
        self.sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity')
        self.wait(lambda: not self.h['bubble']())
        self.home.ev("window.__wos.closeSheets(); window.__wos.startVoice('auto')")
        self.wait(lambda: self.home.ev("__wos.voice==='listen' && !!__wos.V.native"))
        take = self.home.ev('__wos.V.native')
        self.sx('input keyevent KEYCODE_HOME')
        self.wait(self.h['bubble'])
        self.wait(lambda: self.logs('app voice listen'))
        self.control('pause')
        self.wait(lambda: self.home.ev("__wos.voice==='paused'"))
        self.wait(lambda: self.floating.ev("S.mode==='paused'"))
        active_before = self.wait(lambda: self.home.ev('(()=>{const a=JSON.parse(WizardOSDevice.recActive());return a?.paused && a})()'))
        if not active_before or active_before['id'] != take or not active_before['paused']:
            raise AssertionError('carried pause did not reach the real native recorder')
        self.save()
        self.sx('logcat -c')  # remove the Pause CHIP's remote pause before tapping orb
        before = self.submissions()
        self.orb()
        remote = self.h['wait_log'](r': remote pause$', 5)
        self.wait(lambda: self.home.ev("__wos.voice==='listen'"))
        active_after = self.wait(lambda: self.home.ev('(()=>{const a=JSON.parse(WizardOSDevice.recActive());return a && !a.paused && a})()'))
        self.check('everywhere.4', bool(remote) and not self.logs('remote send')
                   and bool(active_after) and active_after['id'] == take and not active_after['paused']
                   and self.unchanged(before, self.floating, "S.mode==='listen'"),
                   {'log': remote, 'before': active_before, 'after': active_after,
                    'new_posts': self.submissions()[len(before):]})
        self.control('cancel')
        self.wait(lambda: self.home.ev("__wos.voice==='idle'"))
        self.wait(lambda: not self.h['controls']())

    def dictation(self):
        self.current_check = 'everywhere.3.dictation'
        self.begin('everywhere-dictation')
        # A real focused system app field + bound accessibility service selects
        # dictation via KeyboardSignal. Never inject native dictating/paused flags.
        self.sx(f'appops set {PKG} ACCESS_RESTRICTED_SETTINGS allow')
        self.sx(f'settings put secure enabled_accessibility_services {PKG}/ai.wizards.os.everywhere.WizardKeyboardService')
        self.sx('settings put secure accessibility_enabled 1')
        self.wait(lambda: self.logs('keyboard service connected'))
        self.sx('settings put secure show_ime_with_hard_keyboard 1')
        self.sx('am start -W -a android.intent.action.INSERT -t vnd.android.cursor.dir/contact')
        self.wait(lambda: self.h['tap_text']('^(First name|Name)$'))
        self.wait(lambda: 'mInputShown=true' in self.sx('dumpsys input_method'))
        # UIAutomator temporarily suspends accessibility and does not always rebind it; re-enable the
        # service (the same settings an owner toggles) until Android reports it bound again.
        def bound():
            return 'WizardKeyboardService' in '\n'.join(
                l for l in self.sx('dumpsys accessibility').splitlines() if 'Bound services' in l)
        for _ in range(4):
            try:
                self.wait(bound, 6)
                break
            except AssertionError:
                self.sx('settings put secure enabled_accessibility_services ""')
                time.sleep(.5)
                self.sx(f'settings put secure enabled_accessibility_services {PKG}/ai.wizards.os.everywhere.WizardKeyboardService')
        self.wait(bound, 6)
        self.wait(lambda: self.floating.ev("S.mode==='type'"))
        self.stage()
        before, runs, transcribes = self.submissions(), len(self.state['runs']), self.state['transcribe']
        self.orb()
        self.wait(lambda: self.logs(r': listening \(voice typing\)'), 2)
        self.control('pause')
        self.wait(lambda: self.logs(r': paused$'), 2)
        self.wait(lambda: self.floating.ev("S.mode==='paused'"), 2)
        self.orb()
        # QA_FINISH_MS keeps polling while paused. A wrong resume resets its
        # 4-second timer; controls must close within 2 seconds, not at that timer.
        self.wait(lambda: not self.h['controls'](), 2)
        typed = self.h['wait_log']('dictation (typed|copied)', 30)
        self.check('everywhere.3.dictation', bool(typed) and not self.logs(r': resumed$')
                   and self.state['transcribe'] == transcribes + 1 and len(self.state['runs']) == runs,
                   {'log': typed, 'new_posts': self.submissions()[len(before):],
                    'finish_signal': 'native controls removed within 2s; dictation typed/copied; no run'})
        self.sx('input keyevent KEYCODE_HOME')
        self.wait(lambda: self.floating.ev("S.mode==='idle'"), 15)

    def side_point(self, target):
        # Same native orb-frame signal/layout as qa_side_back_screen.py.
        frames = re.findall(r'orb frame (\d+),(\d+),(\d+),(\d+)', self.alogs('orb frame'))
        if not frames:
            raise AssertionError('no native assist orb frame')
        x, y, w, h = map(int, frames[-1])
        density = int(re.findall(r'(\d+)\s*$', self.sx('wm density').strip())[-1]) / 160
        inset = {'orb': 66, 'pause': 140 + 23}[target]
        self.tap((x + w - round(inset * density), y + h // 2))

    def assist_take(self):
        self.current_check = 'assist.1'
        self.begin('assist-resume')
        role = 'android.app.role.ASSISTANT'
        self.sx(f'cmd role add-role-holder --user 0 {role} {PKG}')
        self.sx('settings put global power_button_long_press 5')
        if PKG not in self.sx(f'cmd role get-role-holders --user 0 {role}'):
            raise AssertionError('assistant role setup failed')
        self.stage()
        self.write_private('files/qa_autosend_ms.txt', '0\n')
        before = self.submissions()
        self.sx('input keyevent --longpress KEYCODE_POWER')
        self.wait(lambda: self.alogs(r': listening$'))
        side = self.page('assist/surface.html')
        self.wait(lambda: side.ev("window.__wl?.state==='listen' && document.body.classList.contains('corner')"))
        self.side_point('pause')
        self.wait(lambda: self.alogs(r': paused$'))
        self.wait(lambda: side.ev('__wl.paused===true'))
        self.side_point('orb')
        resumed = self.h['wait_log'](r': resumed$', 5, self.alogs)
        self.check('assist.1', bool(resumed) and not self.alogs('sending via=')
                   and self.unchanged(before, side, "__wl.state==='listen' && !__wl.paused"),
                   {'log': resumed, 'new_posts': self.submissions()[len(before):], 'qa_autosend_ms': 0})
        self.save()
        # Keep frame logs: the native session may not relayout on the second tap.
        self.current_check = 'assist.2'
        self.phase = 'assist-send'
        n = len(self.state['runs'])
        self.side_point('orb')
        sending = self.h['wait_log']('sending via=orb', 5, self.alogs)
        self.wait(lambda: len(self.state['runs']) > n, 45)
        delivered = self.h['wait_log']('delivered session=', 15, self.alogs)
        time.sleep(1)
        body = self.state['runs'][-1]['body']
        self.check('assist.2', bool(sending) and bool(delivered) and len(self.state['runs']) == n + 1
                   and 'side button' in body.get('instructions', '') and bool(body.get('wizard_file_ids')),
                   {'sending': sending, 'delivered': delivered, 'runs_delta': len(self.state['runs']) - n, 'body': body})

    def section(self, fn):
        # One failed section is recorded and the suite moves on, so a single harness or app fault
        # never hides the remaining checks. Evidence of the failing moment is kept per section.
        try:
            fn()
        except Exception:
            err = traceback.format_exc()
            ident = self.current_check or fn.__name__
            if not any(c['id'] == ident for c in self.checks):
                self.checks.append({'id': ident, 'status': 'FAIL', 'detail': err})
            try:
                tag = 'fail-' + fn.__name__
                (self.out / (tag + '-ui.xml')).write_text(self.sx('uiautomator dump /dev/tty') or '')
                self.begin(tag)
            except Exception:
                pass
            for step in (lambda: self.control('cancel'), lambda: self.sx('input keyevent KEYCODE_HOME')):
                try:
                    step()
                except Exception:
                    pass
            time.sleep(3)
            self.current_check = None

    def run(self):
        self.setup()
        for fn in (self.floating_take, self.carried_take, self.dictation, self.assist_take):
            self.section(fn)
        self.save()
        crash = self.sx('logcat -d -b crash')
        (self.out / 'crash.txt').write_text(crash)
        self.check('no-native-crash', not self.crashes and 'FATAL EXCEPTION' not in crash, self.crashes)

    def close(self):
        errors = []
        if self.em is not None:
            try:
                self.save()
            except Exception as e:
                errors.append('final evidence: ' + repr(e))
        for pg in self.pages:
            pg.close()
        if self.em is not None:
            try:
                self.sh(self.adb, '-s', self.serial, 'emu', 'kill')
            except Exception as e:
                errors.append('emulator kill: ' + repr(e))
            try:
                self.em.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self.em.terminate()
                try:
                    self.em.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    self.em.kill(); self.em.wait(timeout=15)
        if self.server:
            self.server.shutdown(); self.server.server_close()
        (self.out / 'fake-wizard.json').write_text(json.dumps(self.state, indent=2, default=list) + '\n')
        return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('debug_receipt', type=P)
    parser.add_argument('out', type=P)
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('Thales/macOS required; never run Android tools on the VPS')
    out = args.out.resolve()
    if not out.is_relative_to(BASE) or out == BASE:
        parser.error(f'OUT must be a new directory below {BASE}')
    os.umask(0o077)
    out.mkdir(parents=True, exist_ok=False)
    checks, completed, error, cleanup = [], False, None, []
    suite = None
    digest = None
    # Receipt covers validation, lock acquisition, setup, and assertion failures.
    try:
        apk, digest = artifact(args.debug_receipt)
        with worker_lock():
            suite = Suite(out, apk)
            checks = suite.checks
            try:
                suite.run()
                completed = True
            finally:
                cleanup = suite.close()
    except Exception:
        error = traceback.format_exc()
        (out / 'error.txt').write_text(error)
        if suite and suite.current_check and not any(c['id'] == suite.current_check for c in checks):
            checks.append({'id': suite.current_check, 'status': 'FAIL', 'detail': error})
        checks.append({'id': 'execution', 'status': 'FAIL', 'detail': error})
    reasons = {
        'everywhere.3.mic_lost': 'NOT injected: API35 has no deterministic hardware/MediaRecorder error trigger; killing/revoking permission would not prove micLost(). Dictation covers the feasible finish exception.',
        'assist.3.dictation': 'Not applicable: VoiceCapture has no dictation mode; only EverywhereService selects KeyboardSignal dictation.',
        'assist.3.mic_lost': 'No deterministic emulator microphone-loss callback injection; staged audio cannot experience hardware mic loss.',
        'assist.4': 'Not applicable: WizardSession starts its own VoiceCapture; it has no appVoice/carrying/remote path. Carried app takes belong to EverywhereService.',
    }
    present = {c['id'] for c in checks}
    for ident in sorted(EXPECTED - present):
        checks.append({'id': ident, 'status': 'NOT_COVERED',
                       'detail': reasons.get(ident, 'Not reached after execution/setup failure; see error.txt')})
    if cleanup:
        checks.append({'id': 'cleanup', 'status': 'FAIL', 'detail': cleanup})
    receipt = {'ok': receipt_ok(checks, completed), 'checks': checks,
               'required': sorted(REQUIRED), 'completed': completed,
               'apk_sha256': digest, 'debug_build_receipt': str(args.debug_receipt.resolve()),
               'physical_device': False, 'published': False,
               'scope': 'Native emulator taps + real recorder/bridge/UI signals; synthetic loopback server/audio; no live Wizard traffic'}
    (out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt), flush=True)
    return 0 if receipt['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
