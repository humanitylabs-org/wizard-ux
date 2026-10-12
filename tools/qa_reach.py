#!/usr/bin/env python3
"""Wizard OS "can't reach your Wizard" QA (runs on Thales): the native connection screen that replaced the pure
black screen James saw with Tailscale off (12 Oct). Fresh API 35 emulator, exact debug APK, dead DNS (like a phone
off the tailnet). A fake Wizard on this Mac answers ok / hangs forever / 502 on demand. Nothing reaches the real Wizard.

usage: qa_reach.py QA_APK [OUT_DIR]

  1 a normal open never shows the screen (no flash)
  2 Tailscale off + a connection that never answers (James's case) → "Tailscale is off" within 3 s, not black
  3 Back on that screen keeps the app open and the screen up
  4 Try again with the Wizard back → the shell, screen gone
  5 Tailscale on + never answers → "Connecting to your Wizard…", then "Can't reach your Wizard" at ~10 s
  6 …and it comes back by itself (no taps) once the Wizard answers
  7 a refused connection → "Can't reach your Wizard" at once
  8 a 502 from the gateway → the screen with "Wizard answered 502"; Try again recovers
  9 airplane mode → "You're offline"; network back → the shell by itself
 10 the real build origins with no Tailscale and dead DNS → "Tailscale is off" (the exact phone case)
"""
import fcntl, http.server, json, os, pathlib, re, subprocess, sys, threading, time, uuid
import urllib.request
P = pathlib.Path
BASE = P('/Volumes/ThalesMedia/AndroidBuilds'); SDK = P('/opt/homebrew/share/android-commandlinetools')
APK = P(sys.argv[1])
PKG = 'ai.wizards.os.qa'
job = P(sys.argv[2]) if len(sys.argv) > 2 else BASE / 'qa' / ('wos-reach-' + uuid.uuid4().hex[:8])
job.mkdir(parents=True, exist_ok=True); OUT = job / 'shots'; OUT.mkdir(exist_ok=True)
env = os.environ.copy(); env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']; (job / 'avd').mkdir(exist_ok=True)
ADB = str(SDK / 'platform-tools/adb'); PORT = 5708; S = 'emulator-%d' % PORT; DEVTOOLS = 9359
OK_PORT, DEAD_PORT = 18795, 18796
WIZ, DEAD = 'http://localhost:%d' % OK_PORT, 'http://10.0.2.2:19'  # nothing listens: a real refusal
res = []


def check(n, ok, d=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n + (' — ' + str(d)[:300] if d else ''), flush=True)


def sh(*a, stdin=None, binary=False, timeout=120):
    return subprocess.run([str(x) for x in a], env=env, capture_output=True, input=stdin, text=not binary, timeout=timeout).stdout


def sx(c, **kw): return sh(ADB, '-s', S, 'shell', c, **kw)
def runas(c): return sx("run-as %s sh -c '%s'" % (PKG, c))
def top(): return next((l.strip() for l in sx('dumpsys activity activities').splitlines() if 'topResumedActivity' in l), '')
def shot(name): (OUT / (name + '.png')).write_bytes(sh(ADB, '-s', S, 'exec-out', 'screencap', '-p', binary=True))


def ui():
    sx('uiautomator dump /sdcard/ui.xml >/dev/null')
    return sx('cat /sdcard/ui.xml')


def wait(fn, secs, step=0.5):
    t0 = time.time()
    while time.time() - t0 < secs:
        v = fn()
        if v: return v
        time.sleep(step)
    return fn()


def seen(text, secs):
    return bool(wait(lambda: text in ui(), secs, 0.7))


def gone(text, secs):
    return bool(wait(lambda: text not in ui(), secs, 0.7))


def tap(label):
    x = ui()
    m = re.search(r'text="%s"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' % re.escape(label), x)
    if not m: return False
    x1, y1, x2, y2 = map(int, m.groups()); sx('input tap %d %d' % ((x1 + x2) // 2, (y1 + y2) // 2)); return True


def title():
    """The WebView page's title over devtools (debug build), '' if none."""
    pid = sx('pidof %s' % PKG).strip()
    if not pid: return ''
    sh(ADB, '-s', S, 'forward', 'tcp:%d' % DEVTOOLS, 'localabstract:webview_devtools_remote_%s' % pid)
    try:
        l = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json/list' % DEVTOOLS, timeout=3))
        return next((x.get('title', '') for x in l if x.get('type') == 'page'), '')
    except Exception:
        return ''


def shell_up(secs):
    return bool(wait(lambda: title() == 'wizard-shell-ok', secs, 1.0))


# ------------------------------------------------------------------ the fake Wizard: ok / hang / 502 on demand
MODE = {'m': 'ok'}
SHELL = b'<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><title>wizard-shell-ok</title><body style="background:#1d3b2a;color:#fff;font:28px sans-serif;padding:40px">WIZARD SHELL OK<script>navigator.serviceWorker && navigator.serviceWorker.register("/wizard-os-home/sw.js", {scope: "/wizard-os-home/"})</script>'
SW = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sw.js'), 'rb').read()  # the real shell's worker


class H(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass

    def do_GET(self):
        m = MODE['m']
        if m == 'hang':
            time.sleep(150); self.close_connection = True; return  # never answers (a tailnet IP with Tailscale off)
        if m != '502' and self.path.startswith('/wizard-os-home/sw.js'): code, body, ct = 200, SW, 'text/javascript'
        elif m == '502': code, body, ct = 502, b'Bad Gateway', 'text/html'
        elif self.path.startswith('/wizard-os-home'): code, body, ct = 200, SHELL, 'text/html'
        else: code, body, ct = 200, b'{}', 'application/json'
        self.send_response(code); self.send_header('Content-Type', ct)
        self.send_header('Content-Length', str(len(body))); self.send_header('Cache-Control', 'no-store'); self.end_headers()
        self.wfile.write(body)

    do_HEAD = do_GET


srv = http.server.ThreadingHTTPServer(('127.0.0.1', OK_PORT), H); srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()


def launch():
    sx('am force-stop %s' % PKG); time.sleep(1)
    sx('am start -n %s/ai.wizards.os.MainActivity' % PKG)


def home(origin, vpn):
    cmd = 'mkdir -p files && echo %s > files/qa_home.txt && echo %s > files/qa_origin.txt' % (origin, origin)
    cmd += (' && echo %s > files/qa_vpn.txt' % vpn) if vpn else ' && rm -f files/qa_vpn.txt'
    runas(cmd)


em = None
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'rq', '-k', 'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7', '-p', job / 'dev', stdin='no\n')
        em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'rq', '-port', str(PORT), '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect', '-dns-server', '10.0.2.250'],
                              env=env, stdout=open(job / 'em.log', 'w'), stderr=subprocess.STDOUT)
        for _ in range(140):
            if sx('getprop sys.boot_completed').strip() == '1': break
            time.sleep(3)
        time.sleep(8)
        for k in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'): sx('settings put global %s 0' % k)
        sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard'); sx('svc power stayon true')
        out = sh(ADB, '-s', S, 'install', '-r', APK).strip().splitlines()[-1]
        check('install the QA build', out == 'Success', out)
        for p in (OK_PORT,): sh(ADB, '-s', S, 'reverse', 'tcp:%d' % p, 'tcp:%d' % p)
        sx('pm grant %s android.permission.POST_NOTIFICATIONS' % PKG)
        sx('logcat -c')

        # 1 normal open: no flash
        MODE['m'] = 'ok'; home(WIZ, 'on'); launch()
        ok = shell_up(20); x = ui()
        check('#1 a normal open lands on the shell', ok, title())
        time.sleep(3)  # the shell's service worker installs (the real shell has one; later loads go through it)
        check('#1 …and never shows the connection screen', 'Connecting to your Wizard' not in x and "Can't reach" not in x)
        shot('01-normal')

        # 2 James's case: Tailscale off, the connection never answers
        MODE['m'] = 'hang'; home(WIZ, 'off'); launch(); t0 = time.time()
        ok = seen('Tailscale is off', 6); dt = time.time() - t0
        check('#2 Tailscale off + no answer → "Tailscale is off" (not a black screen)', ok and dt < 6, '%.1fs' % dt)
        x = ui()
        check('#2 …says what to do and offers Try again', 'Turn Tailscale on' in x and 'text="Try again"' in x, x[:200] if not ok else '')
        shot('02-tailscale-off')

        # 3 Back keeps the app and the screen
        sx('input keyevent KEYCODE_BACK'); time.sleep(2)
        check('#3 Back on the screen keeps Wizard OS open', PKG in top(), top()[:90])
        check('#3 …and the screen stays up', seen('Tailscale is off', 4))

        # 4 Wizard back + Try again
        MODE['m'] = 'ok'; home(WIZ, 'on')
        check('#4 Try again is tappable', tap('Try again'))
        check('#4 …the shell opens and the screen leaves', shell_up(15) and gone('Try again', 6), title())
        shot('04-recovered')

        # 5 Tailscale on, never answers: Connecting, then Can't reach
        MODE['m'] = 'hang'; home(WIZ, 'on'); launch(); t0 = time.time()
        ok = seen('Connecting to your Wizard', 6)
        check('#5 Tailscale on + slow → "Connecting to your Wizard…"', ok, '%.1fs' % (time.time() - t0))
        shot('05a-connecting')
        ok = seen("Can't reach your Wizard", 16); dt = time.time() - t0
        check('#5 …then "Can\'t reach your Wizard" at ~10 s', ok and 8 <= dt <= 18, '%.1fs' % dt)
        shot('05b-cant-reach')

        # 6 comes back by itself
        MODE['m'] = 'ok'; t0 = time.time()
        ok = shell_up(25) and gone("Can't reach your Wizard", 5)
        check('#6 the Wizard answers again → the shell by itself, no taps', ok, '%.1fs' % (time.time() - t0))

        # 7 refused
        home(DEAD, 'on'); launch(); t0 = time.time()
        ok = seen("Can't reach your Wizard", 8)
        check('#7 refused connection → the screen at once', ok, '%.1fs' % (time.time() - t0))
        shot('07-refused')

        # 8 502
        MODE['m'] = '502'; home(WIZ, 'on'); launch()
        ok = seen("Can't reach your Wizard", 8)
        check('#8 gateway 502 → the screen', ok and 'Wizard answered 502' in ui())
        shot('08-502')
        MODE['m'] = 'ok'; tap('Try again')
        check('#8 …Try again recovers', shell_up(15) and gone('Try again', 6), title())

        # 9 airplane mode
        MODE['m'] = 'ok'; home(WIZ, 'on')
        sx('cmd connectivity airplane-mode enable'); time.sleep(4)
        launch()
        ok = seen("You're offline", 8)
        check('#9 airplane mode → "You\'re offline"', ok)
        shot('09-offline')
        sx('cmd connectivity airplane-mode disable'); t0 = time.time()
        ok = shell_up(40)
        check('#9 …network back → the shell by itself', ok and gone("You're offline", 5), '%.1fs' % (time.time() - t0))

        # 10 the real build origins, no Tailscale, dead DNS (exactly the phone)
        runas('rm -f files/qa_home.txt files/qa_origin.txt files/qa_vpn.txt'); launch(); t0 = time.time()
        ok = seen('Tailscale is off', 8)
        check('#10 real origins + no Tailscale → "Tailscale is off"', ok, '%.1fs' % (time.time() - t0))
        check('#10 Open Tailscale hidden when Tailscale isn\'t installed', 'Open Tailscale' not in ui())
        check('#10 the app stays open', PKG in top(), top()[:90])
        shot('10-real-origin')

        log = sx('logcat -d -s WizardOSReach')
        (job / 'reach.log').write_text(log)
        crashed = '\n'.join(l for l in sx('logcat -d -b crash').splitlines() if PKG in l or 'ai.wizards.os' in l)
        check('no Wizard OS crashes (UiAutomation harness crashes ignored)', 'FATAL' not in crashed and 'ai.wizards.os' not in crashed, crashed[:300])
    except Exception as e:
        check('harness', False, repr(e))
    finally:
        if em:
            sh(ADB, '-s', S, 'emu', 'kill')
            try: em.wait(40)
            except Exception: em.kill()
        srv.shutdown()
print('%d/%d passed · %s' % (sum(res), len(res), job))
