#!/usr/bin/env python3
"""Wizard OS native-parity QA (runs on Thales). Fresh API 35 emulator, the exact QA APK, real Android plumbing.

usage: qa_native_parity.py QA_APK NEXT_APK WEB_DIR [OUT_DIR]

QA_APK   debug build (ai.wizards.os.qa, versionCode N; 0.7.0 = 9)
NEXT_APK the qanext build of the same source (ai.wizards.os.qa, versionCode 9000+N, same debug key): the "newer
         signed APK" the update feed advertises.
WEB_DIR  the worktree's web/ (served as /wizard-os-home/ by the fake Wizard)

Nothing can reach the real Wizard: the app is pointed (debug-only files/qa_home.txt + qa_origin.txt) at a fake
Wizard on this Mac, reached from the emulator as http://localhost:PORT through `adb reverse`; the emulator runs
with a dead DNS server so private.wizard001.com cannot even resolve; and the WebView's resource log is checked
for any wizard001 request at the end.

Checks
  #14 orb take keeps recording with the app in the background and the screen off (file keeps growing, microphone
      foreground service + ongoing notification), sends exactly once; notification Send sends once; an app kill
      mid-take leaves a take that the app offers on relaunch and sends once.
  #20 Android share sheet lists Wizard; sharing an image → Share sheet in the app → new chat with the image
      uploaded and attached to the run; Back closes the sheet and stays in the app.
  #21 reply to a chat sent from Wizard OS while the app is in the background → notification → tap opens that thread.
  #22 update feed with a bad checksum is refused; the real newer APK shows the banner → Update → "Install unknown
      apps" → download → verify sha256 + signer → Android's package installer opens; installing it lands 9000+N.
      Web hot-reload keeps a typed chat draft.
"""
import fcntl, hashlib, http.server, json, os, pathlib, re, socket, subprocess, sys, threading, time, uuid
import urllib.request
P = pathlib.Path
BASE = P('/Volumes/ThalesMedia/AndroidBuilds'); SDK = P('/opt/homebrew/share/android-commandlinetools')
APK = P(sys.argv[1]); NEXT = P(sys.argv[2]); WEB = P(sys.argv[3])
PKG = 'ai.wizards.os.qa'
job = P(sys.argv[4]) if len(sys.argv) > 4 else BASE / 'qa' / ('wos-native-' + uuid.uuid4().hex[:8])
job.mkdir(parents=True, exist_ok=True)
OUT = job / 'shots'; OUT.mkdir(exist_ok=True)
env = os.environ.copy(); env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']; (job / 'avd').mkdir(exist_ok=True)
ADB = str(SDK / 'platform-tools/adb'); PORT = 5702; S = 'emulator-%d' % PORT; DEVTOOLS = 9353; FAKE = 18787
ORIGIN = 'http://localhost:%d' % FAKE
res = []; receipt = {'checks': [], 'job': str(job)}


def check(n, ok, d=''):
    res.append(bool(ok)); receipt['checks'].append({'name': n, 'ok': bool(ok), 'detail': str(d)[:400]})
    print(('PASS ' if ok else 'FAIL ') + n + (' — ' + str(d)[:400] if d else ''), flush=True)


def sh(*a, stdin=None, binary=False, timeout=120):
    r = subprocess.run([str(x) for x in a], env=env, capture_output=True, input=stdin, text=not binary, timeout=timeout)
    return r.stdout


def sx(c, **kw): return sh(ADB, '-s', S, 'shell', c, **kw)
def top(): return next((l.strip() for l in sx('dumpsys activity activities').splitlines() if 'topResumedActivity' in l), '')
def shot(name): (OUT / (name + '.png')).write_bytes(sh(ADB, '-s', S, 'exec-out', 'screencap', '-p', binary=True))
def ui(): sx('uiautomator dump /sdcard/ui.xml >/dev/null'); return sx('cat /sdcard/ui.xml')
def logs(tag, pat): return sx('logcat -d -s %s:* | grep -iE "%s" | tail -6' % (tag, pat)).strip()
def runas(c): return sx("run-as %s sh -c '%s'" % (PKG, c))


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


# ------------------------------------------------------------------ fake Wizard (+ static Wizard OS + update feed)
NEXT_SHA = hashlib.sha256(NEXT.read_bytes()).hexdigest()
ST = {'transcribe': [], 'uploads': [], 'sessions': {}, 'runs': [], 'keys': {}, 'done': set(), 'log': [],
      'feed': None, 'apk_gets': 0, 'route': 0}
FILES = {}


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

    def _sessions(self):
        out = [{'id': 'qa_old_thread', 'title': 'Existing QA thread', 'status': 'completed', 'updated_at': '2026-10-09T00:00:00Z'}]
        for sid, s in ST['sessions'].items():
            out.insert(0, {'id': sid, 'title': s.get('title') or 'QA chat', 'status': 'completed', 'updated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
        return out

    def do_HEAD(self): self.do_GET()

    def do_GET(self):
        u = self.path.split('?')[0]
        ST['log'].append('GET ' + u)
        m = re.match(r'^/wizard-os-home/(.*)$', u)
        if u == '/wizard-os-home': return self._send(301, b'', extra={'Location': '/wizard-os-home/'})
        if m and not m.group(1).startswith('api/'):
            f = m.group(1) or 'index.html'
            p = (WEB / f).resolve()
            if f in ('data.js', 'summaries.js') or not str(p).startswith(str(WEB.resolve())) or not p.is_file():
                return self._send(200 if f.endswith('.js') else 404, b'', 'application/javascript')
            ct = {'css': 'text/css', 'html': 'text/html', 'png': 'image/png', 'webmanifest': 'application/manifest+json', 'js': 'application/javascript'}.get(f.rsplit('.', 1)[-1], 'application/octet-stream')
            st = p.stat()
            return self._send(200, p.read_bytes(), ct, {'Last-Modified': time.strftime('%a, %d %b %Y %H:%M:%S GMT', time.gmtime(st.st_mtime)), 'ETag': '"%d-%d"' % (int(st.st_mtime), st.st_size)})
        if u == '/reports/wizard-os/latest.json':
            return self._json(200, ST['feed']) if ST['feed'] else self._json(404, {'error': 'none'})
        if u == '/reports/wizard-os/wizard-os-qanext.apk':
            ST['apk_gets'] += 1
            return self._send(200, NEXT.read_bytes(), 'application/vnd.android.package-archive')
        if u == '/wizard/hermes/api/sessions': return self._json(200, {'data': self._sessions(), 'has_more': False})
        m = re.match(r'^/wizard/hermes/api/sessions/([^/]+)/messages$', u)
        if m:
            sid = m.group(1); msgs = []
            for r in ST['runs']:
                if r['session'] == sid:
                    msgs.append({'id': r['id'] + '-u', 'role': 'user', 'content': r['body'].get('input', ''), 'timestamp': r['at']})
                    if r['id'] in ST['done']: msgs.append({'id': r['id'] + '-a', 'role': 'assistant', 'content': 'QA reply from the fake Wizard for ' + r['id'], 'timestamp': r['at'] + 5})
            return self._json(200, {'data': msgs, 'has_more': False})
        m = re.match(r'^/wizard/hermes/api/sessions/([^/]+)$', u)
        if m: return self._json(200, {'session': {'id': m.group(1), 'title': 'QA chat'}})
        m = re.match(r'^/wizard/hermes/v1/runs/([^/]+)$', u)
        if m:
            rid = m.group(1)
            if rid in ST['done']: return self._json(200, {'run_id': rid, 'status': 'completed', 'output': 'QA reply from the fake Wizard for ' + rid})
            return self._json(200, {'run_id': rid, 'status': 'running'})
        m = re.match(r'^/wizard/files/([^/]+)/content$', u)
        if m and m.group(1) in FILES: return self._send(200, FILES[m.group(1)][1], FILES[m.group(1)][0])
        if u == '/wizard/thread-seen': return self._json(200, {'state': {'initializedAt': int(time.time() * 1000), 'threads': {}}})
        if u == '/wizard/thread-dispositions': return self._json(200, {'state': {}})
        return self._json(200, {})

    def do_PUT(self):
        n = int(self.headers.get('Content-Length') or 0); self.rfile.read(n) if n else b''
        ST['log'].append('PUT ' + self.path)
        return self._json(200, {'state': {}})

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n) if n else b''
        u = self.path.split('?')[0]
        ST['log'].append('POST ' + u)
        if u == '/wizard-os-home/api/transcribe':
            ST['transcribe'].append(len(body))
            return self._json(200, {'text': 'Native parity QA take number %d' % len(ST['transcribe']), 'ms': 5})
        if u == '/wizard-os-home/api/route':
            ST['route'] += 1
            return self._json(200, {'cmd': {'route': 'agent'}, 'ms': 3})
        if u == '/wizard/files/upload':
            fid = 'drop_qa%d' % (len(ST['uploads']) + 1)
            f = {'id': fid, 'filename': self.headers.get('X-Wizard-Filename'), 'mime': self.headers.get('X-Wizard-Mime'), 'bytes': len(body)}
            ST['uploads'].append(f); FILES[fid] = (f['mime'] or 'application/octet-stream', body)
            return self._json(201, {'file': f})
        if u == '/wizard/hermes/api/sessions':
            sid = json.loads(body or b'{}').get('id')
            if sid in ST['sessions']: return self._json(409, {'error': 'exists'})
            ST['sessions'][sid] = {}; return self._json(201, {'session': {'id': sid}})
        if u == '/wizard/hermes/v1/runs':
            key = self.headers.get('Idempotency-Key') or ''
            if key in ST['keys']: return self._json(202, {'run_id': ST['keys'][key], 'status': 'queued'})
            b = json.loads(body or b'{}')
            rid = 'run_qa%d' % (len(ST['runs']) + 1)
            sid = b.get('session_id') or b.get('sessionId') or ''
            ST['keys'][key] = rid; ST['runs'].append({'key': key, 'body': b, 'id': rid, 'session': sid, 'at': int(time.time())})
            if sid in ST['sessions'] and not ST['sessions'][sid].get('title'): ST['sessions'][sid]['title'] = (b.get('input') or 'QA chat')[:40]
            return self._json(202, {'run_id': rid, 'status': 'queued'})
        m = re.match(r'^/wizard/hermes/v1/runs/([^/]+)/(steer|stop|approval)$', u)
        if m: return self._json(200, {'ok': True})
        return self._json(200, {})


srv = http.server.ThreadingHTTPServer(('127.0.0.1', FAKE), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()


# ------------------------------------------------------------------ raw CDP to the app's WebView
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
        """A touch on the element's centre (CDP touch input: the same pointer events a finger makes)."""
        r = self.ev("(() => { const e = document.querySelector(%s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()" % json.dumps(sel))
        if not r: return False
        x, y = r
        self.call('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{'x': x, 'y': y}])
        time.sleep(0.08)
        self.call('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
        return True

    def close(self):
        try: self.s.close()
        except Exception: pass


pg = None


def connect(secs=40):
    global pg
    if pg: pg.close()
    t0 = time.time(); err = None
    while time.time() - t0 < secs:
        try:
            pg = Page()
            pg.ev("new Promise((r, j) => { const t0 = Date.now(); const t = () => (window.__wos && window.__wos.live && window.__wos.live.ok && window.WosDevice && window.WosDevice.ready) ? r(true) : Date.now() - t0 > 30000 ? j(new Error('shell not ready')) : setTimeout(t, 250); t(); })")
            pg.ev("(() => { const c = document.querySelector('#coach'); if (c && !c.hidden) document.querySelector('#coachGo')?.click(); return true; })()")
            return pg
        except Exception as e:
            err = e; time.sleep(1.5)
    raise RuntimeError('connect: %s' % err)


def voice(): return pg.ev("window.__wos.voice")
def native_id(): return pg.ev("window.__wos.V.native || ''")
def rec_size(rid): 
    o = runas('stat -c %%s files/recordings/%s.aac 2>/dev/null || echo 0' % rid).strip()
    try: return int(o.splitlines()[-1])
    except Exception: return 0
def fgs(): return sx('dumpsys activity services %s | grep -E "RecorderService|isForeground|foregroundServiceType|types=" ' % PKG)
def notifs(): return sx('dumpsys notification --noredact | grep -E "pkg=%s|android.title=|android.text=|channel=" ' % PKG)
def front(): return PKG in top()
def bring_front(): sx('am start -W -n %s/ai.wizards.os.MainActivity' % PKG); time.sleep(2)
def runs_n(): return len(ST['runs'])
FOREIGN = []
def sweep():
    """Every resource this page has loaded that isn't the fake Wizard (the real one must never be touched)."""
    try:
        FOREIGN.extend(pg.ev("performance.getEntriesByType('resource').map(e => e.name).concat([location.href]).filter(u => /^https?:/.test(u) && !u.startsWith(%s))" % json.dumps(ORIGIN)) or [])
        return True
    except Exception as e:
        FOREIGN.append('(could not read: %s)' % e); return False


em = None
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'np', '-k', 'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7', '-p', job / 'dev', stdin='no\n')
        # Dead DNS: nothing on the emulator can resolve private.wizard001.com (QA must never reach the real Wizard).
        em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'np', '-port', str(PORT), '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect', '-dns-server', '10.0.2.250'],
                              env=env, stdout=open(job / 'em.log', 'w'), stderr=subprocess.STDOUT)
        for _ in range(140):
            if sx('getprop sys.boot_completed').strip() == '1': break
            time.sleep(3)
        time.sleep(10)
        for k in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'): sx('settings put global %s 0' % k)
        sx('settings put system screen_off_timeout 1800000')
        sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard')
        out = sh(ADB, '-s', S, 'install', '-r', APK).strip().splitlines()[-1]
        ver = re.search(r'versionCode=\d+', sx('dumpsys package %s' % PKG))
        # The qanext fixture is the same source at versionCode 9000+N (build.gradle androidComponents).
        VC = int(ver.group(0).split('=')[1]) if ver else 0; NEXT_VC = 9000 + VC
        VN = (re.search(r'versionName=(\S+)', sx('dumpsys package %s' % PKG)) or [None, '0-qa'])[1]
        NEXT_VN = re.sub(r'-qa$', '', VN) + '-qanext'
        check('install the QA build', out == 'Success', out + ' ' + (ver.group(0) if ver else ''))
        resolv = sx('ping -c 1 -W 2 wizard.tailc0f369.ts.net 2>&1 | head -2')
        check('the real Wizard is unreachable from the emulator (DNS dead)', 'unknown host' in resolv.lower() or 'bad address' in resolv.lower() or not re.search(r'\d+\.\d+\.\d+\.\d+', resolv), resolv.strip())
        sh(ADB, '-s', S, 'reverse', 'tcp:%d' % FAKE, 'tcp:%d' % FAKE)
        # QA hooks (debug build only): fake origin for the page + native HTTP, canned microphone.
        aiff = job / 'q.aiff'; aac = job / 'qa_mic.aac'
        sh('say', '-o', aiff, 'This is the Wizard OS native recorder test. It keeps recording with the screen off.')
        sh('afconvert', '-f', 'adts', '-d', 'aac', aiff, aac)
        sh(ADB, '-s', S, 'push', aac, '/data/local/tmp/qa_mic.aac')
        runas('mkdir -p files && echo %s > files/qa_home.txt && echo %s > files/qa_origin.txt && cp /data/local/tmp/qa_mic.aac files/qa_mic.aac' % (ORIGIN, ORIGIN))
        sx('pm grant %s android.permission.RECORD_AUDIO' % PKG); sx('pm grant %s android.permission.POST_NOTIFICATIONS' % PKG)
        # The feed starts with a tampered checksum (must be refused); fixed later.
        ST['feed'] = {'version': NEXT_VN, 'versionCode': NEXT_VC, 'sha256': '0' * 64, 'url': 'wizard-os-qanext.apk', 'bytes': NEXT.stat().st_size, 'notes': 'QA update'}
        sx('logcat -c')
        sx('am start -W -n %s/ai.wizards.os.MainActivity' % PKG); time.sleep(6)
        connect()
        href = pg.ev('location.href')
        check('the app loads Wizard OS from the fake Wizard', href.startswith(ORIGIN + '/wizard-os-home/'), href)
        check('native device bridge present', pg.ev("typeof window.WizardOSDevice?.recStart === 'function'"))
        shot('00-home')

        # ============ #22a update check (feed advertises 9000+N with a tampered sha256) ============
        # Since silent-update (0.7.0) the on-resume check downloads by itself, so the tampered feed is caught at once:
        # the banner names the refusal and nothing is installed.
        banner = wait(lambda: pg.ev("(() => { const e = document.querySelector('#dvUpdate'); return e && !e.hidden ? e.innerText.replace(/\\s+/g, ' ') : ''; })()"), 25)
        check('#22 a newer Wizard OS in the feed is found and checked (tampered checksum refused, Retry offered)', banner and 'checksum' in banner and 'Retry' in banner and ('available %s' % NEXT_VN) in logs('WizardUpdate', 'available'), banner)
        shot('22a-update-banner')

        # ============ #14a orb take: background + screen off, then send once ============
        n0, t0n = runs_n(), len(ST['transcribe'])
        pg.tap('#orbWrap'); time.sleep(1.5)
        rid = native_id()
        check('#14 orb tap records in the native recorder', rid and voice() in ('listen', 'paused'), (rid, voice()))
        sv = fgs()
        check('#14 microphone foreground service is running', 'RecorderService' in sv and ('isForeground=true' in sv), sv.strip()[:300])
        nt = notifs()
        check('#14 ongoing "Recording for Wizard" notification with Stop/Send', 'Recording for Wizard' in nt, nt[:300])
        shot('14a-recording')
        s1 = rec_size(rid)
        sx('input keyevent KEYCODE_HOME'); time.sleep(6)
        s2 = rec_size(rid)
        check('#14 keeps recording with Wizard OS in the background', s2 > s1 + 20000 and not front(), (s1, s2, top()[:80]))
        sx('input keyevent KEYCODE_SLEEP'); time.sleep(2)
        pw = sx('dumpsys power | grep -E "mWakefulness=|Display Power: state="')
        time.sleep(12)
        s3 = rec_size(rid)
        check('#14 keeps recording with the screen off', ('Asleep' in pw or 'Dozing' in pw or 'state=OFF' in pw) and s3 > s2 + 60000, (pw.strip().replace('\n', ' '), s2, s3))
        sx('input keyevent KEYCODE_WAKEUP'); time.sleep(1); sx('wm dismiss-keyguard'); time.sleep(1)
        bring_front(); connect()
        check('#14 back in the app the orb is still recording the same take', native_id() == rid and voice() in ('listen', 'paused'), (native_id(), voice()))
        shot('14b-back-still-recording')
        pg.tap('#orbWrap')
        wait(lambda: runs_n() > n0, 40)
        time.sleep(4)
        tx = ST['transcribe'][t0n:]
        check('#14 tap orb → transcribed once from the whole take', len(tx) == 1 and tx[0] >= s3, tx)
        check('#14 sent exactly once', runs_n() == n0 + 1, [r['body'].get('input') for r in ST['runs'][n0:]])
        check('#14 the take is deleted from the phone after sending', wait(lambda: rec_size(rid) == 0, 10), rec_size(rid))
        check('#14 foreground service gone after the take', 'RecorderService' not in fgs() or 'isForeground=true' not in fgs(), fgs()[:200])
        run14 = ST['runs'][n0] if runs_n() > n0 else None
        shot('14c-sent')

        sweep()
        # ============ #14b notification Send while backgrounded ============
        n0 = runs_n()
        pg.ev("window.__wos.goDesk(window.__wos.HOME, true)"); time.sleep(0.5)
        pg.tap('#orbWrap'); time.sleep(1.5)
        rid2 = native_id()
        sx('input keyevent KEYCODE_HOME'); time.sleep(4)
        sx('cmd statusbar expand-notifications')
        xml = wait(lambda: (lambda x: x if 'Recording for Wizard' in x else '')(ui()), 10, 1) or ui()
        if not re.search(r'(text|content-desc)="Send"', xml):
            tap_text(r'^Recording for Wizard$', xml); time.sleep(1.5); xml = ui()  # expand to show the actions
        shot('14d-notification-actions')
        hit = tap_text(r'^Send$', xml)
        if not hit and 'Recording for Wizard' in sx('dumpsys notification --noredact | grep android.title='):
            # uiautomator can't get an idle dump while the notification's chronometer ticks; the shade layout on
            # this fixed pixel_7/API 35 image puts the first notification's 2nd action at (368, 1096) (see shot 14d).
            sx('input tap 368 1096'); hit = 'Send (fixed position; ui dump not idle)'
        time.sleep(1); sx('cmd statusbar collapse')
        wait(lambda: runs_n() > n0, 40); time.sleep(5)
        check('#14 notification Send (app in background) sends the take exactly once', hit and runs_n() == n0 + 1 and rec_size(rid2) == 0, (hit, rid2, runs_n() - n0))
        bring_front(); connect()
        check('#14 orb idle after notification Send', wait(lambda: voice() == 'idle', 10), voice())
        if voice() != 'idle':  # keep later steps independent of this one
            pg.ev("window.__wos.cancelVoice(true)"); time.sleep(1)

        sweep()
        # ============ #14c app killed mid-take → recovered → sent once ============
        n0, u0 = runs_n(), len(ST['uploads'])
        pg.ev("window.__wos.goDesk(window.__wos.HOME, true)"); time.sleep(0.5)
        pg.tap('#orbWrap'); time.sleep(1.5)
        rid3 = native_id(); time.sleep(6)
        pid = sx('pidof %s' % PKG).strip()
        runas('kill -9 %s' % pid); time.sleep(3)
        killed = sx('pidof %s' % PKG).strip()
        size3 = rec_size(rid3)
        check('#14 app process killed mid-take; the take is on disk', rid3 and killed != pid and size3 > 20000, (rid3, pid, killed, size3))
        sx('am start -W -n %s/ai.wizards.os.MainActivity' % PKG); time.sleep(5)
        connect()
        card = wait(lambda: pg.ev("(() => { const e = document.querySelector('[data-dv=recording]'); return e ? e.innerText.replace(/\\s+/g, ' ') : ''; })()"), 15)
        check('#14 relaunch offers the interrupted recording', card and 'Recording saved' in card and 'closed while you were recording' in card, card)
        shot('14e-recovered')
        pg.tap('[data-dv=recording] [data-takeact=send]')
        wait(lambda: runs_n() > n0, 40); time.sleep(4)
        b = ST['runs'][n0]['body'] if runs_n() > n0 else {}
        check('#14 recovered take sent exactly once with the voice note attached', runs_n() == n0 + 1 and len(ST['uploads']) == u0 + 1 and b.get('wizard_file_ids'), (runs_n() - n0, ST['uploads'][u0:], list(b.keys())))
        check('#14 recovered take removed from the phone', rec_size(rid3) == 0, rec_size(rid3))
        time.sleep(2); bring_front(); connect()
        check('#14 not offered again', not pg.ev("!!document.querySelector('[data-dv=recording]')"))

        sweep()
        # ============ #14d 0.7.0 hand-off: leave the app mid-take → the floating orb carries THE SAME native take ====
        # One take, one microphone: RecorderService keeps recording; the Everywhere orb only shows/drives it.
        def fgs_type(svc):
            """foregroundServiceType of one of our services (bit 0x80 = microphone; 0 = not a foreground service)."""
            for b in sx('dumpsys activity services %s' % PKG).split('* ServiceRecord{')[1:]:
                if svc in b.split('\n', 1)[0]:
                    if 'isForeground=true' not in b: return 0
                    m = re.search(r'(?:foregroundServiceType|\btypes)=0x([0-9a-f]+)', b)
                    return int(m.group(1), 16) if m else -1
            return 0
        def bubble():
            for blk in sx('dumpsys window windows').split('Window #')[1:]:
                if 'WizardEverywhere' in blk.split('\n', 1)[0]:
                    m = re.search(r'(?:mFrame|frame)=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]', blk)
                    if m and 'mViewVisibility=0x8' not in blk and 'mViewVisibility=0x4' not in blk: return tuple(map(int, m.groups()))
            return None
        def ctl_windows():
            # Since 0.6.2 the orb's Cancel/Pause/Screen buttons are their own small overlay windows (WizOrbCtl-*),
            # so "expanded, carrying" means those windows are on screen, not a wider orb window.
            out = []
            for blk in sx('dumpsys window windows').split('Window #')[1:]:
                head = blk.split('\n', 1)[0]
                if 'WizOrbCtl-' in head and 'mViewVisibility=0x8' not in blk and 'mViewVisibility=0x4' not in blk:
                    m = re.search(r'WizOrbCtl-(\w+)', head)
                    if m: out.append(m.group(1))
            return sorted(out)
        sx('appops set %s SYSTEM_ALERT_WINDOW allow' % PKG)
        pg.ev("window.WizardOSNative.setEverywhere(true)"); time.sleep(2)
        for _ in range(4):  # switching it on may offer the voice-typing setup dialog
            if 'Turn on voice typing' in ui(): tap_text(r'^Not now$'); time.sleep(0.8)
            else: break
        # Where the idle floating orb sits (it stays there; carrying fans the controls out around it).
        sx('input keyevent KEYCODE_HOME'); time.sleep(3)
        bi = wait(lambda: bubble(), 8)
        ocx, ocy = ((bi[0] + bi[2]) // 2, (bi[1] + bi[3]) // 2) if bi else (0, 0)
        bring_front(); connect()
        n0, t0n = runs_n(), len(ST['transcribe'])
        pg.ev("window.__wos.goDesk(window.__wos.HOME, true)"); time.sleep(0.5)
        sx('logcat -c')
        pg.tap('#orbWrap'); time.sleep(1.5)
        rh = native_id()
        sx('input keyevent KEYCODE_HOME'); time.sleep(4)
        b = wait(lambda: (lambda c: c if {'cancel', 'pause'} <= set(c) else None)(ctl_windows()) if bi else None, 8)
        s1 = rec_size(rh)
        shot('14f-carried-by-floating-orb')
        evl = sx('logcat -d -s WizardEverywhere:* | grep -iE "app voice|listening|remote" | tail -6').strip()
        check('#14 leave the app mid-take → the floating orb shows the take (Cancel + Pause out, carrying)', rh and bi and b and bubble() and 'app voice listen' in evl, (rh, bi, b, evl))
        ev_t, rs_t = fgs_type('EverywhereService'), fgs_type('RecorderService')
        check('#14 one microphone owner: RecorderService records, the floating orb service does not', rs_t > 0 and (rs_t & 0x80) and ev_t >= 0 and not (ev_t & 0x80) and ': listening' not in evl, (hex(ev_t), hex(rs_t)))
        time.sleep(5)
        check('#14 the same native take keeps growing while carried', rec_size(rh) > s1 + 15000, (s1, rec_size(rh)))
        sx('input tap %d %d' % (ocx, ocy))  # tap the floating orb → send
        wait(lambda: runs_n() > n0, 40); time.sleep(4)
        tx = ST['transcribe'][t0n:]
        evl2 = sx('logcat -d -s WizardEverywhere:* | grep -iE "remote|listening" | tail -6').strip()
        check('#14 floating orb tap sends the carried take exactly once (one transcription, one run)', len(tx) == 1 and runs_n() == n0 + 1 and 'remote send' in evl2, (tx, runs_n() - n0, evl2))
        check('#14 the carried take is deleted once sent; nothing left recording', wait(lambda: rec_size(rh) == 0, 10) and not ('isForeground=true' in fgs() and 'RecorderService' in fgs()), (rec_size(rh), fgs()[:160]))
        check('#14 the floating orb never opened its own recording during the hand-off', ': listening' not in evl2, evl2)
        pg.ev("window.WizardOSNative.setEverywhere(false)"); time.sleep(1)
        bring_front(); connect()

        sweep()
        # ============ #20 share sheet → new chat with the image ============
        n0, u0 = runs_n(), len(ST['uploads'])
        png = job / 'qa-share.png'
        import struct, zlib
        def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
        raw = b''.join(b'\x00' + b''.join(bytes(((x * 7 + y) & 255, (y * 5) & 255, ((x ^ y) * 3) & 255)) for x in range(240)) for y in range(320))
        png.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 240, 320, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))
        sh(ADB, '-s', S, 'push', png, '/sdcard/Pictures/qa-share.png')
        sx('am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/qa-share.png')
        def media_id():
            q = sx("content query --uri content://media/external/images/media --projection _id --where \"_display_name='qa-share.png'\"")
            m = re.search(r'_id=(\d+)', q); return m.group(1) if m else None
        mid = wait(media_id, 20, 1)
        media = 'content://media/external/images/media/%s' % mid
        qa_ = sx('cmd package query-activities --brief -a android.intent.action.SEND -t image/png')
        check('#20 Wizard is registered as a share target for images (and text/files)', 'ai.wizards.os.share.ShareActivity' in qa_ and mid, (mid, [l.strip() for l in qa_.splitlines() if '/' in l][:6]))
        sx('input keyevent KEYCODE_HOME'); time.sleep(1.5)
        # The system share sheet, as another app opens it (ACTION_CHOOSER around ACTION_SEND).
        sx("am start -a android.intent.action.SEND -t image/png --eu android.intent.extra.STREAM %s --es android.intent.extra.TEXT 'Shared from the QA gallery' --grant-read-uri-permission -f 0x10000000" % media)
        time.sleep(4)
        xml = ui(); shot('20a-share-sheet')
        hit = None
        if not front():
            hit = tap_text(r'^Wizard$', xml)
            time.sleep(1.5)
            if not wait(front, 6): tap_text(r'^Just once$|^Always$'); time.sleep(2)
        check('#20 sharing from outside lands in Wizard OS', wait(front, 8), (hit, top()[:100]))
        if not wait(front, 6):
            sx("am start -n %s/ai.wizards.os.share.ShareActivity -a android.intent.action.SEND -t image/png --eu android.intent.extra.STREAM %s --es android.intent.extra.TEXT 'Shared from the QA gallery' --grant-read-uri-permission" % (PKG, media))
            time.sleep(3)
        connect()
        sheet = wait(lambda: pg.ev("(() => { const e = document.querySelector('[data-dv=share]'); return e ? e.innerText.replace(/\\s+/g, ' ') : ''; })()"), 15)
        check('#20 Wizard OS opens the Share sheet with the image and text', sheet and 'Share to Wizard' in sheet and 'qa-share' in sheet and pg.ev("document.querySelector('[data-dv=share] textarea')?.value || ''").startswith('Shared from'), sheet)
        time.sleep(1); shot('20b-share-in-app')
        # Back closes the sheet and stays in the app (Back never exits), then share again.
        sx('input keyevent KEYCODE_BACK'); time.sleep(1.5)
        check('#20 Back closes the Share sheet and Wizard OS stays open', front() and not pg.ev("!!document.querySelector('[data-dv=share]')"), top()[:100])
        sx('input keyevent KEYCODE_HOME'); time.sleep(1.5)
        sx("am start -a android.intent.action.SEND -t image/png --eu android.intent.extra.STREAM %s --es android.intent.extra.TEXT 'Shared from the QA gallery' --grant-read-uri-permission -f 0x10000000" % media)
        time.sleep(4)
        if not front():
            tap_text(r'^Wizard$'); time.sleep(1.5)
            if not wait(front, 6): tap_text(r'^Just once$|^Always$'); time.sleep(2)
        connect()
        sheet2 = wait(lambda: pg.ev("(() => { const e = document.querySelector('[data-dv=share]'); return e ? e.innerText.replace(/\\s+/g, ' ') : ''; })()"), 15)
        check('#20 sharing again opens a fresh Share sheet with the image', sheet2 and 'qa-share' in sheet2, (sheet2, logs('WizardShare', '.')))
        pg.tap('[data-dv=share] [data-shareto=__new__]')
        wait(lambda: runs_n() > n0, 40); time.sleep(3)
        up = ST['uploads'][u0:]
        b = ST['runs'][n0]['body'] if runs_n() > n0 else {}
        check('#20 image uploaded to Wizard Files byte-for-byte', len(up) == 1 and up[0]['bytes'] == png.stat().st_size and (up[0]['mime'] or '').startswith('image/'), (up, png.stat().st_size))
        check('#20 a new chat started with the image attached (exactly one run)', runs_n() == n0 + 1 and up and up[0]['id'] in json.dumps(b) and 'Shared from the QA gallery' in json.dumps(b), (runs_n() - n0, json.dumps(b)[:300]))
        share_sid = ST['runs'][n0]['session'] if runs_n() > n0 else ''
        th = pg.ev("(() => { const w = window.__wos; const d = w.desks[w.idx]; const f = w.wins[d.focus]; return f ? (f.app + ':' + (f.thread || '')) : ''; })()") or ''
        # A new thread starts in the background (0.6.x rule): Chats steps back to its list and the thread is listed there.
        listed = pg.ev("(sid => !!document.querySelector('[data-chopen=\"' + sid + '\"]'))(%s)" % json.dumps(share_sid)) if share_sid else False
        check('#20 the new thread starts in the background and is listed in Chats', share_sid and th == 'chats:' and listed, (th, share_sid, listed))
        time.sleep(1.5); shot('20c-shared-thread')

        # ============ #21 reply notification for that chat (app in background) → tap opens the thread ============
        watch = runas('cat shared_prefs/reply-watch.xml 2>/dev/null')
        check('#21 the shared chat\'s run is being watched for a reply', share_sid and share_sid in watch, watch[-300:])
        pg.ev("window.__wos.goDesk(window.__wos.HOME, true)"); time.sleep(0.5)
        sx('input keyevent KEYCODE_HOME'); time.sleep(3)
        if share_sid: ST['done'].add(ST['runs'][n0]['id'])
        t_note = wait(lambda: 'QA reply from the fake Wizard' in notifs(), 45, 1.5)
        nt = notifs()
        check('#21 "Archimedes replied" notification while Wizard OS is in the background', t_note and 'chat-replies' in nt, nt[:400])
        sx('cmd statusbar expand-notifications'); time.sleep(2); shot('21a-reply-notification')
        hit = tap_text(r'QA reply from the fake Wizard')
        time.sleep(4)
        connect()
        th = pg.ev("(() => { const w = window.__wos; const d = w.desks[w.idx]; const f = w.wins[d.focus]; return f ? (f.app + ':' + (f.thread || '')) : ''; })()") or ''
        check('#21 tapping it opens that thread in Wizard OS', hit and front() and th == 'chats:' + share_sid, (hit, th, top()[:80]))
        time.sleep(2); shot('21b-thread-opened')
        # The earlier voice chat (#14) replies while the app is in front: no notification (James is looking at it).
        if run14:
            ST['done'].add(run14['id']); time.sleep(12)
            check('#21 no notification while Wizard OS is in front', 'for ' + run14['id'] not in notifs(), '')
        for _ in range(3): sx('input keyevent KEYCODE_BACK'); time.sleep(1)
        check('Back never leaves Wizard OS (thread → list → home)', front(), top()[:100])

        sweep()
        # ============ #22b web hot-reload keeps a typed draft ============
        pg.ev("window.__wos.openWizardThread('qa_old_thread')"); time.sleep(2)
        pg.ev("(() => { const t = document.querySelector('.win.focus .ch-compose textarea') || document.querySelector('.ch-compose textarea'); t.value = 'Half-typed draft that must survive'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()")
        pg.ev("window.WosDevice.checkWeb(true)"); time.sleep(2)
        os.utime(WEB / 'app.js', None)  # "deploy": app.js changes on the server
        time.sleep(1.2); pg.ev("window.WosDevice.checkWeb(true)"); time.sleep(2)
        bn = pg.ev("(() => { const e = document.querySelector('#dvWeb'); return e ? e.innerText.replace(/\\s+/g, ' ') : ''; })()")
        check('#22 web update detected → "Wizard OS was updated · Reload"', 'updated' in (bn or ''), bn)
        shot('22b-web-updated')
        sweep(); pg.ev("window.__qaMark = 1"); pg.tap('#dvWeb [data-web=go]'); time.sleep(4)
        connect()
        same = pg.ev("window.__qaMark === 1")
        dv = pg.ev("(() => { const t = document.querySelector('.ch-compose textarea'); return t ? t.value : null; })()")
        check('#22 reload swaps in the new code and keeps the draft', not same and dv == 'Half-typed draft that must survive', (same, dv))
        shot('22c-draft-kept')
        pg.ev("window.__wos.goDesk(window.__wos.HOME, true)")

        # ============ #22c APK update: bad checksum refused → fixed feed → "Install unknown apps" → installed ============
        # Since silent-update (0.7.0) Wizard OS downloads and verifies FIRST, and only a verified APK asks for
        # "Install unknown apps" (a tampered one never reaches Android). On API 35 the self-update may then install
        # through a PackageInstaller session with or without Android's confirm screen; either way it must land.
        sweep()
        sx('logcat -c')
        pg.ev("window.WizardOSDevice.updateCheck()"); time.sleep(3)
        pg.tap('#dvUpdate [data-upd=go]'); time.sleep(4)
        connect()
        err = wait(lambda: pg.ev("(() => { const e = document.querySelector('#dvUpdate'); return e && e.dataset.state === 'error' ? e.innerText.replace(/\\s+/g, ' ') : ''; })()"), 40)
        check('#22 a download that doesn\'t match the published sha256 is refused', 'checksum' in (err or '') and 'installer opened' not in logs('WizardUpdate', 'installer opened') and front(), (err, top()[-80:]))
        check('#22 refused file is deleted', 'apk' not in runas('ls cache/updates files/updates 2>/dev/null'), runas('ls cache/updates files/updates 2>/dev/null'))
        shot('22e-checksum-refused')
        ST['feed'] = dict(ST['feed'], sha256=NEXT_SHA)
        gets0 = ST['apk_gets']
        pg.tap('#dvUpdate [data-upd=go]')
        settings = wait(lambda: (lambda t: t if ('ManageAppExternalSources' in t or 'com.android.settings' in t or 'Spa' in t) else '')(top()), 60, 1)
        shot('22d-allow-unknown-apps')
        lg = logs('WizardUpdate', 'verified|rejected|available')
        check('#22 Retry downloads the newer APK, verifies sha256 + signer, then asks for "Install unknown apps" (first time)', settings and ST['apk_gets'] > gets0 and 'verified' in lg, (settings[:140] if settings else top()[:140], lg))
        if settings:
            tap_text(r'Allow from this source'); time.sleep(1.5)
            if 'allow' not in sx('appops get %s REQUEST_INSTALL_PACKAGES' % PKG).lower():
                sx('appops set %s REQUEST_INSTALL_PACKAGES allow' % PKG)
            sx('input keyevent KEYCODE_BACK'); time.sleep(2)   # system Back returns to Wizard OS
        confirm = False; t0 = time.time()
        while time.time() - t0 < 90:
            if ('versionCode=%d' % NEXT_VC) in sx('dumpsys package %s | grep versionCode' % PKG): break
            tt = top()
            if any(k in tt for k in ('packageinstaller', 'PackageInstaller', 'InstallStart', 'InstallStaging')):
                if not confirm: shot('22f-installer')
                if tap_text(r'^(Update|Install)$', ui()): confirm = True; time.sleep(3)
            elif front() and not confirm:
                st = pg.ev("(() => { const e = document.querySelector('#dvUpdate'); return e && !e.hidden ? e.dataset.state + ':' + e.innerText.replace(/\\s+/g, ' ') : ''; })()") if pg else ''
                if st and st.startswith('ready'): pg.tap('#dvUpdate .dv-um')   # in front: the "tap to restart" banner
            time.sleep(1)
        newv = wait(lambda: ('versionCode=%d' % NEXT_VC) in sx('dumpsys package %s | grep versionCode' % PKG), 30, 2)
        lg = logs('WizardUpdate', 'session|status|installer opened|replaced')
        check('#22 the verified update installs through a PackageInstaller session and lands the newer build (versionCode %d)' % NEXT_VC, newv and 'session' in lg, (sx('dumpsys package %s | grep -E "versionCode|versionName"' % PKG).strip(), 'confirm' if confirm else 'no confirm', lg[-300:]))
        shot('22g-installed')

        crashed = sx('logcat -d -b crash')
        check('no crashes', 'FATAL EXCEPTION' not in crashed, crashed[:300])
        sx('am start -W -n %s/ai.wizards.os.MainActivity' % PKG); time.sleep(4)
        try:
            connect(); sweep()
            check('the updated app (%d) starts' % NEXT_VC + ' and loads Wizard OS', pg.ev("window.WizardOSNative.platform()").endswith('-qanext'), pg.ev("window.WizardOSNative.platform()"))
        except Exception as e:
            check('the updated app (%d) starts' % NEXT_VC + ' and loads Wizard OS', False, e)
        check('zero requests to the real Wizard from the WebView (fake origin only)', not FOREIGN, FOREIGN[:5])
        writes = [l for l in ST['log'] if not l.startswith('GET')]
        receipt['fake_writes'] = writes
    finally:
        try:
            if pg: pg.close()
        except Exception: pass
        if em:
            sh(ADB, '-s', S, 'emu', 'kill')
            try: em.wait(40)
            except Exception: em.kill()
        srv.shutdown()
        receipt.update(passed=sum(res), total=len(res), apk=str(APK), apk_sha256=hashlib.sha256(APK.read_bytes()).hexdigest(),
                       next_apk=str(NEXT), next_sha256=NEXT_SHA,
                       fake={'runs': [{'id': r['id'], 'session': r['session'], 'input': r['body'].get('input', '')[:120], 'files': r['body'].get('wizard_file_ids')} for r in ST['runs']],
                             'uploads': ST['uploads'], 'transcribe_bytes': ST['transcribe'], 'apk_gets': ST['apk_gets']})
        (job / 'receipt.json').write_text(json.dumps(receipt, indent=1, default=str))
print('%d/%d passed · %s' % (sum(res), len(res), job))
