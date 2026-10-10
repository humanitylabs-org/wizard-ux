"""Shared emulator + CDP helpers for tools/qa_android_apps.py (runs on Thales)."""
import json, os, pathlib, re, socket, subprocess, time, urllib.request

P = pathlib.Path
BASE = P('/Volumes/ThalesMedia/AndroidBuilds')
SDK = P('/opt/homebrew/share/android-commandlinetools')
ADB = str(SDK / 'platform-tools/adb')
BT = sorted((SDK / 'build-tools').iterdir())[-1]


class Emu:
    def __init__(self, job, port, pkg):
        self.job, self.port, self.pkg = job, port, pkg
        self.S = 'emulator-%d' % port
        self.env = os.environ.copy()
        self.env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
                        ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
        self.env['PATH'] = self.env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + self.env['PATH']
        (job / 'avd').mkdir(exist_ok=True)
        self.proc = None

    def sh(self, *a, stdin=None, binary=False, timeout=240):
        r = subprocess.run([str(x) for x in a], env=self.env, capture_output=True, input=stdin, text=not binary, timeout=timeout)
        return r.stdout if binary else (r.stdout + r.stderr)

    def sx(self, c, **kw): return self.sh(ADB, '-s', self.S, 'shell', c, **kw)

    def boot(self):
        self.sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'aa', '-k',
                'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7', '-p', self.job / 'dev', stdin='no\n')
        self.proc = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'aa', '-port', str(self.port), '-no-window', '-no-snapshot',
                                      '-no-audio', '-gpu', 'swiftshader_indirect', '-dns-server', '10.0.2.250'],
                                     env=self.env, stdout=open(self.job / 'em.log', 'w'), stderr=subprocess.STDOUT)
        for _ in range(140):
            if self.sx('getprop sys.boot_completed').strip() == '1': break
            time.sleep(3)
        time.sleep(10)
        for k in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'): self.sx('settings put global %s 0' % k)
        self.sx('settings put system screen_off_timeout 1800000')
        self.sx('input keyevent KEYCODE_WAKEUP'); self.sx('wm dismiss-keyguard')

    def kill(self):
        if self.proc:
            self.sh(ADB, '-s', self.S, 'emu', 'kill')
            try: self.proc.wait(40)
            except Exception: self.proc.kill()

    def top(self): return next((l.strip() for l in self.sx('dumpsys activity activities').splitlines() if 'topResumedActivity' in l), '')
    def shot(self, out, name): (out / (name + '.png')).write_bytes(self.sh(ADB, '-s', self.S, 'exec-out', 'screencap', '-p', binary=True))
    def ui(self): self.sx('uiautomator dump /sdcard/ui.xml >/dev/null'); return self.sx('cat /sdcard/ui.xml')
    def runas(self, c): return self.sx("run-as %s sh -c '%s'" % (self.pkg, c))
    def front(self): return self.pkg + '/' in self.top()

    def vcode(self, pkg):
        m = re.search(r'versionCode=(\d+)', self.sx('dumpsys package %s | grep versionCode' % pkg))
        return int(m.group(1)) if m else 0

    def source(self, pkg):
        d = self.sx('dumpsys package %s' % pkg)
        g = lambda k: (re.search(k + r'=(\S+)', d) or [None, ''])[1]
        return {'installer': g('installerPackageName'), 'initiator': g('installInitiatingPackageName'), 'updateOwner': g('updateOwnerPackageName')}

    def installer_ui(self, t=None):
        t = t if t is not None else self.top()
        return any(k in t for k in ('packageinstaller', 'PackageInstaller', 'InstallStart', 'InstallStaging', 'InstallInstalling', 'UninstallerActivity'))

    def tap_text(self, pattern, xml=None):
        xml = xml or self.ui()
        for m in re.finditer(r'<node [^>]*?>', xml):
            n = m.group(0)
            for attr in ('text', 'content-desc'):
                t = re.search(' ' + attr + r'="([^"]*)"', n)
                label = t.group(1) if t else ''
                if label and re.search(pattern, label, re.I):
                    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
                    if b:
                        x1, y1, x2, y2 = map(int, b.groups()); self.sx('input tap %d %d' % ((x1 + x2) // 2, (y1 + y2) // 2)); return label
        return None


def wait(fn, secs, step=0.7):
    t0 = time.time()
    while time.time() - t0 < secs:
        v = fn()
        if v: return v
        time.sleep(step)
    return fn()


class Page:
    """Minimal CDP client for the WebView's top page."""
    def __init__(self, emu, devtools, match='wizard-os-home'):
        pid = emu.sx('pidof %s' % emu.pkg).strip()
        emu.sh(ADB, '-s', emu.S, 'forward', 'tcp:%d' % devtools, 'localabstract:webview_devtools_remote_%s' % pid)
        page = None
        for _ in range(50):
            try:
                l = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json/list' % devtools, timeout=3))
                page = next((x for x in l if x.get('type') == 'page' and match in x.get('url', '')), None)
            except Exception: pass
            if page: break
            time.sleep(0.7)
        if not page: raise RuntimeError('no Wizard OS page')
        self.id = 0
        u = page['webSocketDebuggerUrl']; host, path = re.match(r'ws://([^/]+)(/.*)', u).groups()
        h, p = host.split(':'); self.s = socket.create_connection((h, int(p)), timeout=40)
        self.s.sendall(('GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n' % (path, host)).encode())
        buf = b''
        while b'\r\n\r\n' not in buf: buf += self.s.recv(4096)
        self.buf = buf.split(b'\r\n\r\n', 1)[1]

    def _send(self, obj):
        data = json.dumps(obj).encode(); hdr = bytearray([0x81]); mask = os.urandom(4); n = len(data)
        if n < 126: hdr.append(0x80 | n)
        elif n < 65536: hdr.append(0x80 | 126); hdr += n.to_bytes(2, 'big')
        else: hdr.append(0x80 | 127); hdr += n.to_bytes(8, 'big')
        self.s.sendall(bytes(hdr) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _need(self, k):
        while len(self.buf) < k:
            c = self.s.recv(65536)
            if not c: raise RuntimeError('ws closed')
            self.buf += c

    def _recv(self):
        msg = b''
        while True:
            self._need(2); b1, b2 = self.buf[0], self.buf[1]; n = b2 & 0x7f; off = 2
            if n == 126: self._need(4); n = int.from_bytes(self.buf[2:4], 'big'); off = 4
            elif n == 127: self._need(10); n = int.from_bytes(self.buf[2:10], 'big'); off = 10
            self._need(off + n); payload = self.buf[off:off + n]; self.buf = self.buf[off + n:]
            msg += payload
            if b1 & 0x80: return json.loads(msg.decode())

    def call(self, method, **params):
        self.id += 1; my = self.id; self._send({'id': my, 'method': method, 'params': params})
        while True:
            d = self._recv()
            if d.get('id') == my: return d

    def ev(self, expr):
        r = self.call('Runtime.evaluate', expression=expr, awaitPromise=True, returnByValue=True)
        rr = r.get('result', {})
        if rr.get('exceptionDetails'): raise RuntimeError(json.dumps(rr['exceptionDetails'])[:400])
        return rr.get('result', {}).get('value')

    def touch(self, x, y):
        self.call('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{'x': x, 'y': y}]); time.sleep(0.08)
        self.call('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])

    def tap(self, sel):
        r = self.ev("(() => { const e = document.querySelector(%s); if (!e) return null; e.scrollIntoView({block:'center'}); const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()" % json.dumps(sel))
        if not r: return False
        self.touch(*r); return True

    def close(self):
        try: self.s.close()
        except Exception: pass
