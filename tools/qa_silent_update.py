#!/usr/bin/env python3
"""Wizard OS hands-free update QA (runs on Thales). Fresh API 35 emulator, exact APK bytes, real PackageInstaller.

usage: qa_silent_update.py QA_APK NEXT_APK LATER_APK WEB_DIR [OUT_DIR]

QA_APK    debug build (ai.wizards.os.qa, versionCode N; 0.7.0 = 11), installed over adb (installer of record: none)
NEXT_APK  qanext build of the same job (versionCode 9000+N, same debug key): the first update
LATER_APK qalater build of the same job (versionCode 9100+N, same debug key): the second update, after Wizard OS
          has installed itself once

Nothing reaches the real Wizard: debug-only files/qa_home.txt + qa_origin.txt point the app at a fake Wizard on
this Mac (http://localhost:PORT through `adb reverse`); the emulator's DNS is dead.

Checks
  A  background: feed names NEXT with the right sha256/signer; with Wizard OS in the background the periodic job
     (forced with `cmd jobscheduler run -f`) downloads + verifies it by itself; without "Install unknown apps" it
     waits and leaves one "ready" notification; nothing installs yet.
  B  in front: one "Update ready · tap to restart" banner; tap → Android's "Install unknown apps" (once) → back →
     PackageInstaller session. API 35 would install even this first self-update silently, so the QA-only
     files/qa_update_confirm.txt forces USER_ACTION_REQUIRED: STATUS_PENDING_USER_ACTION → EXTRA_INTENT opens Android's
     confirm; Cancel → STATUS_FAILURE_ABORTED is shown; Retry → confirm → NEXT lands; Wizard OS is now the installer
     of record. Taps counted.
  N1 wrong sha256 in the feed: downloaded, refused, file deleted, nothing installs (app in background, so a missing
     check would install silently).
  N2 right sha256 but signed by another key: refused, nothing installs.
  R  recording running (native recorder, app in background): LATER downloads but is deferred; nothing installs
     while the take runs; after the take ends and Wizard OS is in the background, LATER installs with ZERO taps and
     no installer screen.
"""
import fcntl, hashlib, http.server, json, os, pathlib, re, socket, subprocess, sys, threading, time, uuid
import urllib.request
P = pathlib.Path
BASE = P('/Volumes/ThalesMedia/AndroidBuilds'); SDK = P('/opt/homebrew/share/android-commandlinetools')
APK = P(sys.argv[1]); NEXT = P(sys.argv[2]); LATER = P(sys.argv[3]); WEB = P(sys.argv[4])
PKG = 'ai.wizards.os.qa'
job = P(sys.argv[5]) if len(sys.argv) > 5 else BASE / 'qa' / ('wos-silent-' + uuid.uuid4().hex[:8])
job.mkdir(parents=True, exist_ok=True)
OUT = job / 'shots'; OUT.mkdir(exist_ok=True)
env = os.environ.copy(); env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']; (job / 'avd').mkdir(exist_ok=True)
ADB = str(SDK / 'platform-tools/adb'); PORT = 5704; S = 'emulator-%d' % PORT; DEVTOOLS = 9355; FAKE = 18789
ORIGIN = 'http://localhost:%d' % FAKE
BT = sorted((SDK / 'build-tools').iterdir())[-1]
JOB_ID = 7611
res = []; receipt = {'checks': [], 'job': str(job), 'taps': {}}


def check(n, ok, d=''):
    res.append(bool(ok)); receipt['checks'].append({'name': n, 'ok': bool(ok), 'detail': str(d)[:500]})
    print(('PASS ' if ok else 'FAIL ') + n + (' — ' + str(d)[:500] if d else ''), flush=True)


def sh(*a, stdin=None, binary=False, timeout=180):
    r = subprocess.run([str(x) for x in a], env=env, capture_output=True, input=stdin, text=not binary, timeout=timeout)
    return r.stdout if binary else (r.stdout + r.stderr)


def sx(c, **kw): return sh(ADB, '-s', S, 'shell', c, **kw)
def top(): return next((l.strip() for l in sx('dumpsys activity activities').splitlines() if 'topResumedActivity' in l), '')
def shot(name): (OUT / (name + '.png')).write_bytes(sh(ADB, '-s', S, 'exec-out', 'screencap', '-p', binary=True))
def ui(): sx('uiautomator dump /sdcard/ui.xml >/dev/null'); return sx('cat /sdcard/ui.xml')
def logs(pat, n=8): return sx('logcat -d -s WizardUpdate:* | grep -iE "%s" | tail -%d' % (pat, n)).strip()
def runas(c): return sx("run-as %s sh -c '%s'" % (PKG, c))
def vcode():
    m = re.search(r'versionCode=(\d+)', sx('dumpsys package %s | grep versionCode' % PKG))
    return int(m.group(1)) if m else 0
def installer(): return (re.search(r'installerPackageName=(\S+)', sx('dumpsys package %s | grep -i installer' % PKG)) or [None, '?'])[1]
def front(): return PKG in top()
def installer_ui(t=None):
    t = t if t is not None else top()
    return any(k in t for k in ('packageinstaller', 'PackageInstaller', 'InstallStart', 'InstallStaging', 'InstallInstalling'))
def run_job(): return sx('cmd jobscheduler run -f %s %d' % (PKG, JOB_ID)).strip()
def notifs(): return sx('dumpsys notification --noredact | grep -E "android.title=|android.text="')
def cached(): return runas('ls cache/updates 2>/dev/null').split()


def tap_text(pattern, xml=None, cls=None):
    xml = xml or ui()
    for m in re.finditer(r'<node [^>]*?>', xml):
        n = m.group(0)
        if cls and ('class="%s"' % cls) not in n: continue
        for attr in ('text', 'content-desc'):
            t = re.search(' ' + attr + r'="([^"]*)"', n)
            label = t.group(1) if t else ''
            if label and re.search(pattern, label, re.I):
                b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
                if b:
                    x1, y1, x2, y2 = map(int, b.groups()); sx('input tap %d %d' % ((x1 + x2) // 2, (y1 + y2) // 2)); return label
    return None


def wait(fn, secs, step=0.7):
    t0 = time.time()
    while time.time() - t0 < secs:
        v = fn()
        if v: return v
        time.sleep(step)
    return fn()


# ------------------------------------------------------------------ fixtures
BAD = job / 'qalater-othersigner.apk'
ks = job / 'other.jks'
if ks.exists(): ks.unlink()
sh('keytool', '-genkeypair', '-keystore', ks, '-storepass', 'qaqaqa', '-keypass', 'qaqaqa', '-alias', 'other', '-keyalg', 'RSA',
   '-keysize', '2048', '-validity', '3650', '-dname', 'CN=Not Wizard OS')
sh(BT / 'apksigner', 'sign', '--ks', ks, '--ks-pass', 'pass:qaqaqa', '--key-pass', 'pass:qaqaqa', '--out', BAD, LATER)
SHA = {k: hashlib.sha256(p.read_bytes()).hexdigest() for k, p in (('next', NEXT), ('later', LATER), ('bad', BAD))}


def cert(p):
    o = sh(BT / 'apksigner', 'verify', '--print-certs', p)
    m = re.search(r'Signer #1 certificate SHA-256 digest: ([0-9a-f]{64})', o)
    return m.group(1) if m else ''


SIGNER = cert(APK); SIGNERS = {'qa': SIGNER, 'next': cert(NEXT), 'later': cert(LATER), 'bad': cert(BAD)}
receipt['fixtures'] = {'sha256': SHA, 'signers': SIGNERS}
print('fixtures', json.dumps(receipt['fixtures']), flush=True)

ST = {'feed': None, 'gets': {}, 'log': []}
SERVE = {'wizard-os-qanext.apk': NEXT, 'wizard-os-qalater.apk': LATER, 'wizard-os-qalater-other.apk': BAD}


class Fake(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass

    def _send(self, code, body, ctype='application/json', extra=None):
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD': self.wfile.write(body)

    def _json(self, code, obj): self._send(code, json.dumps(obj).encode())
    def do_HEAD(self): self.do_GET()

    def do_GET(self):
        u = self.path.split('?')[0]
        ST['log'].append('GET ' + u)
        if u == '/wizard-os-home': return self._send(301, b'', extra={'Location': '/wizard-os-home/'})
        m = re.match(r'^/wizard-os-home/(.*)$', u)
        if m and not m.group(1).startswith('api/'):
            f = m.group(1) or 'index.html'
            p = (WEB / f).resolve()
            if f in ('data.js', 'summaries.js') or not str(p).startswith(str(WEB.resolve())) or not p.is_file():
                return self._send(200 if f.endswith('.js') else 404, b'', 'application/javascript')
            ct = {'css': 'text/css', 'html': 'text/html', 'png': 'image/png', 'webmanifest': 'application/manifest+json', 'js': 'application/javascript'}.get(f.rsplit('.', 1)[-1], 'application/octet-stream')
            return self._send(200, p.read_bytes(), ct)
        if u == '/reports/wizard-os/latest.json':
            return self._json(200, ST['feed']) if ST['feed'] else self._json(404, {'error': 'none'})
        m = re.match(r'^/reports/wizard-os/([^/]+\.apk)$', u)
        if m and m.group(1) in SERVE:
            ST['gets'][m.group(1)] = ST['gets'].get(m.group(1), 0) + 1
            return self._send(200, SERVE[m.group(1)].read_bytes(), 'application/vnd.android.package-archive')
        if u == '/wizard/hermes/api/sessions': return self._json(200, {'data': [{'id': 'qa_old', 'title': 'QA thread', 'status': 'completed', 'updated_at': '2026-10-09T00:00:00Z'}], 'has_more': False})
        if re.match(r'^/wizard/hermes/api/sessions/[^/]+/messages$', u): return self._json(200, {'data': [], 'has_more': False})
        if u == '/wizard/thread-seen': return self._json(200, {'state': {'initializedAt': int(time.time() * 1000), 'threads': {}}})
        if u == '/wizard/thread-dispositions': return self._json(200, {'state': {}})
        return self._json(200, {})

    def do_PUT(self):
        n = int(self.headers.get('Content-Length') or 0); self.rfile.read(n) if n else b''
        return self._json(200, {'state': {}})

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); self.rfile.read(n) if n else b''
        ST['log'].append('POST ' + self.path)
        if self.path.startswith('/wizard-os-home/api/transcribe'): return self._json(200, {'text': 'qa', 'ms': 5})
        return self._json(200, {})


def feed(kind, sha=None, url=None, signer=None):
    vc = {'next': NEXT_VC, 'later': LATER_VC}[kind]
    p = NEXT if kind == 'next' else LATER
    ST['feed'] = {'app': PKG, 'version': VN0 + '-' + ('qanext' if kind == 'next' else 'qalater'), 'versionName': VN0 + '-' + ('qanext' if kind == 'next' else 'qalater'),
                  'versionCode': vc, 'url': url or ('wizard-os-%s.apk' % ('qanext' if kind == 'next' else 'qalater')),
                  'bytes': p.stat().st_size if not url else BAD.stat().st_size, 'sha256': sha or SHA[kind],
                  'signer': signer or SIGNER, 'notes': 'QA ' + kind}


srv = http.server.ThreadingHTTPServer(('127.0.0.1', FAKE), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()


class Page:
    def __init__(self):
        pid = sx('pidof %s' % PKG).strip()
        sh(ADB, '-s', S, 'forward', 'tcp:%d' % DEVTOOLS, 'localabstract:webview_devtools_remote_%s' % pid)
        page = None
        for _ in range(50):
            try:
                l = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json/list' % DEVTOOLS, timeout=3))
                page = next((x for x in l if x.get('type') == 'page' and 'wizard-os-home' in x.get('url', '')), None)
            except Exception: pass
            if page: break
            time.sleep(0.7)
        if not page: raise RuntimeError('no Wizard OS page')
        self.id = 0
        u = page['webSocketDebuggerUrl']; host, path = re.match(r'ws://([^/]+)(/.*)', u).groups()
        h, p = host.split(':'); self.s = socket.create_connection((h, int(p)), timeout=30)
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

    def tap(self, sel):
        r = self.ev("(() => { const e = document.querySelector(%s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()" % json.dumps(sel))
        if not r: return False
        x, y = r
        self.call('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{'x': x, 'y': y}]); time.sleep(0.08)
        self.call('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
        return True

    def close(self):
        try: self.s.close()
        except Exception: pass


pg = None


def connect(secs=45):
    global pg
    if pg: pg.close()
    t0 = time.time(); err = None
    while time.time() - t0 < secs:
        try:
            pg = Page()
            pg.ev("new Promise((r, j) => { const t0 = Date.now(); const t = () => (window.__wos && window.WosDevice && window.WosDevice.ready) ? r(true) : Date.now() - t0 > 30000 ? j(new Error('shell not ready')) : setTimeout(t, 250); t(); })")
            pg.ev("(() => { const c = document.querySelector('#coach'); if (c && !c.hidden) document.querySelector('#coachGo')?.click(); return true; })()")
            return pg
        except Exception as e:
            err = e; time.sleep(1.5)
    raise RuntimeError('connect: %s' % err)


def banner(): return pg.ev("(() => { const e = document.querySelector('#dvUpdate'); return e && !e.hidden ? (e.dataset.state + ': ' + e.innerText.replace(/\\s+/g, ' ')) : ''; })()") or ''
def bring_front(): sx('am start -W -n %s/ai.wizards.os.MainActivity' % PKG); time.sleep(2)
def home(): sx('input keyevent KEYCODE_HOME'); time.sleep(1.5)
def native_id(): return pg.ev("window.__wos.V && window.__wos.V.native || ''")


em = None
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'su', '-k', 'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7', '-p', job / 'dev', stdin='no\n')
        em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'su', '-port', str(PORT), '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect', '-dns-server', '10.0.2.250'],
                              env=env, stdout=open(job / 'em.log', 'w'), stderr=subprocess.STDOUT)
        for _ in range(140):
            if sx('getprop sys.boot_completed').strip() == '1': break
            time.sleep(3)
        time.sleep(10)
        for k in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'): sx('settings put global %s 0' % k)
        sx('settings put system screen_off_timeout 1800000')
        sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard')
        sx('svc wifi enable'); sx('svc data disable'); time.sleep(4)
        net = sx('dumpsys connectivity | grep -E "^  *NetworkAgentInfo|Active default network" | head -4')
        receipt['network'] = net
        out = sh(ADB, '-s', S, 'install', '-r', APK).strip().splitlines()[-1]
        VC = vcode(); NEXT_VC = 9000 + VC; LATER_VC = 9100 + VC
        VN0 = re.sub(r'-qa$', '', (re.search(r'versionName=(\S+)', sx('dumpsys package %s' % PKG)) or [None, '0-qa'])[1])
        check('install the 0.7.0 QA build over adb (installer of record: %s)' % installer(), out == 'Success' and VC > 0, '%s versionCode=%d' % (out, VC))
        resolv = sx('ping -c 1 -W 2 private.wizard001.com 2>&1 | head -2')
        check('the real Wizard is unreachable from the emulator (DNS dead)', 'unknown host' in resolv.lower() or 'bad address' in resolv.lower() or not re.search(r'\d+\.\d+\.\d+\.\d+', resolv), resolv.strip())
        check('fixtures: qanext/qalater share the QA signer, the tampered one does not',
              SIGNERS['next'] == SIGNERS['later'] == SIGNER and SIGNERS['bad'] and SIGNERS['bad'] != SIGNER, SIGNERS)
        sh(ADB, '-s', S, 'reverse', 'tcp:%d' % FAKE, 'tcp:%d' % FAKE)
        aiff = job / 'q.aiff'; aac = job / 'qa_mic.aac'
        sh('say', '-o', aiff, 'Wizard OS update test. This take must not be interrupted by an update.')
        sh('afconvert', '-f', 'adts', '-d', 'aac', aiff, aac)
        sh(ADB, '-s', S, 'push', aac, '/data/local/tmp/qa_mic.aac')
        def stage():
            runas('mkdir -p files && echo %s > files/qa_home.txt && echo %s > files/qa_origin.txt && cp /data/local/tmp/qa_mic.aac files/qa_mic.aac' % (ORIGIN, ORIGIN))
        stage()
        sx('pm grant %s android.permission.RECORD_AUDIO' % PKG); sx('pm grant %s android.permission.POST_NOTIFICATIONS' % PKG)
        check('"Install unknown apps" starts off (a fresh phone)', 'allow' not in sx('appops get %s REQUEST_INSTALL_PACKAGES' % PKG).lower(), sx('appops get %s REQUEST_INSTALL_PACKAGES' % PKG).strip())

        # ============ A: background check + automatic download, waits for permission ============
        sx('logcat -c')
        bring_front(); connect(); time.sleep(4)
        check('the app loads Wizard OS from the fake Wizard', pg.ev('location.href').startswith(ORIGIN), pg.ev('location.href'))
        js = sx('cmd jobscheduler get-job-state %s %d' % (PKG, JOB_ID)).strip()
        dj = sx('dumpsys jobscheduler | grep -A12 "%s/ai.wizards.os.update.UpdateJob" | head -14' % PKG)
        check('periodic background update job is scheduled', 'UpdateJob' in dj and 'unknown' not in js.lower(), (js, dj.strip()[:400]))
        home()
        feed('next')
        g0 = ST['gets'].get('wizard-os-qanext.apk', 0)
        r = run_job()
        verified = wait(lambda: 'verified' in logs('verified|rejected'), 60, 1)
        time.sleep(3)
        lg = logs('job|step|verified|state .*ready|available', 12)
        check('A: with Wizard OS in the background the job downloads the newer build by itself', ST['gets'].get('wizard-os-qanext.apk', 0) > g0, (r, ST['gets']))
        check('A: the download passes size + sha256 + package + versionCode + signer checks', verified and SHA['next'] + '.apk' in cached(), (lg[-600:], cached()))
        check('A: nothing installs without "Install unknown apps" (waits for James)', vcode() == VC and 'WAIT_PERMISSION' in lg, (vcode(), lg[-300:]))
        nt = wait(lambda: (lambda n: n if 'is ready' in n else '')(notifs()), 10) or notifs()
        check('A: one "Wizard OS … is ready · Tap to install" notification', 'is ready' in nt and 'Tap to install' in nt, nt.strip()[:300])
        sx('cmd statusbar expand-notifications'); time.sleep(1.5); shot('A1-ready-notification'); sx('cmd statusbar collapse')

        # ============ B: front → one banner → tap → allow → (confirm) → installed ============
        taps = 0
        sx('logcat -c')
        bring_front(); connect()
        b = wait(lambda: (lambda x: x if x.startswith('ready') else '')(banner()), 20)
        check('B: in front, one "Update ready · tap to restart" banner', 'Update ready · tap to restart' in (b or ''), b)
        shot('B1-update-ready-banner')
        check('B: only one update banner on the page', pg.ev("document.querySelectorAll('#dvUpdate:not([hidden])').length") == 1)
        runas('echo 1 > files/qa_update_confirm.txt')
        pg.tap('#dvUpdate .dv-um'); taps += 1  # the banner itself is the button
        t = wait(lambda: (lambda x: x if ('Settings' in x or 'settings' in x or 'ManageAppExternalSources' in x or 'Spa' in x) else '')(top()), 15)
        shot('B2-allow-unknown-apps')
        hit = tap_text(r'Allow from this source')
        if hit: taps += 1
        time.sleep(1.5)
        check('B: first time only, Android\'s "Install unknown apps" opens and is allowed with one tap', hit and 'allow' in sx('appops get %s REQUEST_INSTALL_PACKAGES' % PKG).lower(), (t[:140], hit))
        sx('input keyevent KEYCODE_BACK'); time.sleep(2)   # back to Wizard OS (the system Back, not a tap)
        # API 35 lets even this first self-update through without a confirm (UPDATE_PACKAGES_WITHOUT_USER_ACTION +
        # updating itself). files/qa_update_confirm.txt (QA builds only) makes the session ask anyway, so the
        # STATUS_PENDING_USER_ACTION → EXTRA_INTENT path and a cancelled confirm (STATUS_FAILURE_ABORTED) run for real.
        t = wait(lambda: (lambda x: x if installer_ui(x) else '')(top()), 30, 1)
        shot('B3-android-confirm')
        lg = logs('status|installer opened', 6)
        check('B(confirm): STATUS_PENDING_USER_ACTION opens Android\'s confirm from EXTRA_INTENT', bool(t) and 'status -1' in lg and 'installer opened' in lg, (t[-100:] if t else top()[-100:], lg[-300:]))
        hc = tap_text(r'^Cancel$'); time.sleep(3)
        if hc: taps += 1
        lg = logs('status|install failed', 6)
        bring_front(); connect(); time.sleep(1)
        eb = wait(lambda: (lambda x: x if x.startswith('error') else '')(banner()), 15)
        shot('B4-cancelled')
        check('B(failure): a cancelled confirm (STATUS_FAILURE_ABORTED) is surfaced and nothing installs', 'status 3' in lg and 'cancelled' in (eb or '').lower() and vcode() == VC, (eb, lg[-300:]))
        pg.tap('#dvUpdate [data-upd=go]'); taps += 1   # Retry
        confirm = False; seen = []
        t0 = time.time()
        while time.time() - t0 < 90:
            if vcode() == NEXT_VC: break
            tt = top(); seen.append(tt[-80:])
            if installer_ui(tt):
                x = ui()
                h2 = tap_text(r'^(Update|Install)$', x)
                if h2: taps += 1; confirm = True; time.sleep(3)
            time.sleep(1)
        newv = wait(lambda: vcode() == NEXT_VC, 30, 2)
        lg = logs('session|status|installer opened|replaced', 12)
        receipt['taps']['first_update'] = taps
        check('B: installs through a PackageInstaller session (QA-forced requireUserAction=1 for the confirm path)', 'requireUserAction=1' in lg and 'session' in lg, lg[-500:])
        check('B: the first update lands after one Android confirm (versionCode %d) · taps=%d (banner, allow, cancel, retry, confirm)' % (NEXT_VC, taps), newv and confirm, (vcode(), lg[-300:]))
        runas('rm -f files/qa_update_confirm.txt')
        inst = installer()
        check('B: Wizard OS is now its own installer of record (later updates are silent)', inst == PKG, inst)
        stage()  # app data survives an update; harmless re-stage
        time.sleep(4)
        relaunched = front(); nt = notifs()
        receipt['bal'] = sx('logcat -d | grep -iE "Background activity launch|BAL_|Abort background activity" | tail -4')
        receipt['relaunched_after_tap_update'] = relaunched
        shot('B5-after-first-update')
        check('B: after a tapped update James lands back in Wizard OS (or gets a "tap to open" notification)', relaunched or 'Wizard OS updated to' in nt,
              (relaunched, top()[-80:], logs('replaced', 2)))
        if not relaunched: bring_front()
        connect()
        check('B: the updated app (%d) runs and loads Wizard OS' % NEXT_VC, pg.ev("window.WizardOSNative.platform()").endswith('-qanext'), pg.ev("window.WizardOSNative.platform()"))

        # ============ N1: wrong sha256 ============
        sx('logcat -c'); home()
        feed('later', sha='0' * 64)
        g0 = ST['gets'].get('wizard-os-qalater.apk', 0)
        run_job()
        rej = wait(lambda: logs('rejected'), 60, 1); time.sleep(8)
        check('N1: a download that doesn\'t match the feed\'s sha256 is refused', 'checksum' in (rej or '') and ST['gets'].get('wizard-os-qalater.apk', 0) > g0, (rej, ST['gets']))
        check('N1: nothing installs and the file is deleted', vcode() == NEXT_VC and not any(f.endswith('.apk') for f in cached()), (vcode(), cached()))
        bring_front(); connect(); time.sleep(1)
        eb = banner(); shot('N1-checksum-refused')
        check('N1: the page says why', 'checksum' in eb, eb)

        # ============ N2: right sha256, wrong signer ============
        sx('logcat -c'); home()
        feed('later', sha=SHA['bad'], url='wizard-os-qalater-other.apk')
        g0 = ST['gets'].get('wizard-os-qalater-other.apk', 0)
        run_job()
        rej = wait(lambda: logs('rejected'), 60, 1); time.sleep(8)
        check('N2: an APK signed by another key is refused (sha256 matched)', 'signed by Wizard OS' in (rej or '') and ST['gets'].get('wizard-os-qalater-other.apk', 0) > g0, (rej, ST['gets']))
        check('N2: nothing installs and the file is deleted', vcode() == NEXT_VC and not any(f.endswith('.apk') for f in cached()), (vcode(), cached()))
        bring_front(); connect(); time.sleep(1)
        eb = banner(); shot('N2-signer-refused')
        check('N2: the page says why', 'signed' in eb, eb)

        # ============ R: recording defers; then ZERO-tap silent install ============
        sx('logcat -c')
        feed('later')
        pg.ev("window.__wos.goDesk && window.__wos.goDesk(window.__wos.HOME, true)"); time.sleep(0.5)
        pg.tap('#orbWrap'); time.sleep(2)
        rid = native_id()
        check('R: a native recording is running', bool(rid), rid)
        home()
        g0 = ST['gets'].get('wizard-os-qalater.apk', 0)
        run_job()
        d = wait(lambda: 'DEFER' in logs('step'), 60, 1)
        time.sleep(25)   # the deferred re-check fires every 20 s; it must keep deferring
        lg = logs('step|verified', 10)
        check('R: the second update downloads + verifies during the take', ST['gets'].get('wizard-os-qalater.apk', 0) > g0 and 'verified' in lg, (ST['gets'], lg[-300:]))
        check('R: while recording it is deferred, nothing installs', d and vcode() == NEXT_VC and lg.count('DEFER') >= 2 and 'session' not in logs('session'), (vcode(), lg[-400:]))
        bring_front(); connect()
        check('R: the take is still recording after the deferral', native_id() == rid, (native_id(), rid))
        shot('R1-deferred-while-recording')
        db = banner()
        pg.ev("window.__wos.cancelVoice && window.__wos.cancelVoice(true)"); time.sleep(2)
        b = wait(lambda: (lambda x: x if x.startswith('ready') else '')(banner()), 30)
        check('R: take over, in front → "Update ready · tap to restart" (not installed under James\'s fingers)', 'Update ready' in (b or '') and vcode() == NEXT_VC, (db, b))
        shot('R2-ready-after-recording')
        # Zero taps from here: leave the app; it restarts into the update by itself.
        sx('logcat -c'); home()
        t0 = time.time(); ui_seen = []
        while time.time() - t0 < 120 and vcode() != LATER_VC:
            tt = top()
            if installer_ui(tt): ui_seen.append(tt[-80:])
            time.sleep(1)
        took = int(time.time() - t0)
        lg = logs('session|status|replaced', 10)
        receipt['taps']['second_update'] = 0
        check('R: the second update installs with ZERO taps (versionCode %d, %ds after leaving)' % (LATER_VC, took), vcode() == LATER_VC, (vcode(), lg[-400:]))
        check('R: no installer screen was shown', not ui_seen, ui_seen[:3])
        check('R: silent session (requireUserAction=2, no STATUS_PENDING_USER_ACTION, package replaced)', 'requireUserAction=2' in lg and 'status -1' not in lg and ('status 0' in lg or 'replaced' in lg), lg[-400:])
        shot('R3-after-silent-update')
        stage(); bring_front()
        try:
            connect()
            check('R: the silently-updated app (%d) starts and loads Wizard OS' % LATER_VC, pg.ev("window.WizardOSNative.platform()").endswith('-qalater'), pg.ev("window.WizardOSNative.platform()"))
            shot('R4-qalater-running')
        except Exception as e:
            check('R: the silently-updated app (%d) starts and loads Wizard OS' % LATER_VC, False, e)

        crashed = sx('logcat -d -b crash')
        check('no crashes', 'FATAL EXCEPTION' not in crashed, crashed[:300])
        receipt['wizard_log'] = sx('logcat -d -s WizardUpdate:*')[-6000:]
    finally:
        try:
            if pg: pg.close()
        except Exception: pass
        if em:
            sh(ADB, '-s', S, 'emu', 'kill')
            try: em.wait(40)
            except Exception: em.kill()
        srv.shutdown()
        receipt.update(passed=sum(res), total=len(res), apk=str(APK), apk_gets=ST['gets'],
                       real_wizard_requests=[l for l in ST['log'] if 'wizard001' in l])
        (job / 'receipt.json').write_text(json.dumps(receipt, indent=1, default=str))
print('%d/%d passed · %s' % (sum(res), len(res), job))
