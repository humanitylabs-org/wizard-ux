#!/usr/bin/env python3
"""Wizard OS cancelled-recording recovery QA (runs on Thales). Fresh API 35 emulator, the exact QA APK.

usage: qa_cancel_recover.py QA_APK WEB_DIR [OUT_DIR]

James, 11 Oct 2026: an accidental X threw away a long Wizard Everywhere message. A take cancelled after 15 s or more
is now kept on the phone; Settings -> Cancelled recordings -> Transcribe & copy puts the words on the clipboard.

Checks (fake Wizard on this Mac; nothing reaches the real one):
  in-app orb: a 17 s take cancelled -> kept on disk; a 3 s take cancelled -> nothing kept
  floating orb (Wizard Everywhere, over the launcher): a long take, the real X tapped -> kept, toast says where
  Settings lists both, newest first; Transcribe & copy sends that exact audio to Wizard Voice once, shows the words,
  and the Android clipboard holds them (pasted into a field with KEYCODE_PASTE); Delete removes the file;
  Back closes Settings and Wizard OS stays open; nothing was sent as a message; no crashes.
"""
import fcntl, hashlib, http.server, json, os, pathlib, re, socket, subprocess, sys, threading, time, uuid
import urllib.request
P = pathlib.Path
BASE = P('/Volumes/ThalesMedia/AndroidBuilds'); SDK = P('/opt/homebrew/share/android-commandlinetools')
APK = P(sys.argv[1]); NEXT = APK; WEB = P(sys.argv[2])
PKG = 'ai.wizards.os.qa'
job = P(sys.argv[3]) if len(sys.argv) > 3 else BASE / 'qa' / ('wos-cancel-' + uuid.uuid4().hex[:8])
job.mkdir(parents=True, exist_ok=True)
OUT = job / 'shots'; OUT.mkdir(exist_ok=True)
env = os.environ.copy(); env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']; (job / 'avd').mkdir(exist_ok=True)
ADB = str(SDK / 'platform-tools/adb'); PORT = 5712; S = 'emulator-%d' % PORT; DEVTOOLS = 9363; FAKE = 18797
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



def kept_files(): return [l for l in runas('ls files/cancelled 2>/dev/null').split() if l.endswith('.json')]
def cancelled_rows(): return pg.ev("Array.from(document.querySelectorAll('#settingsBody [data-cxid]')).map(r => r.innerText.replace(/\\s+/g, ' '))") or []
def ctl():
    out = {}
    for blk in sx('dumpsys window windows').split('Window #')[1:]:
        head = blk.split('\n', 1)[0]; m0 = re.search(r'WizOrbCtl-(\w+)', head)
        if not m0: continue
        m = re.search(r'(?:mFrame|frame)=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]', blk)
        if m and 'mViewVisibility=0x8' not in blk and 'mViewVisibility=0x4' not in blk: out[m0.group(1)] = tuple(map(int, m.groups()))
    return out
def bubble():
    for blk in sx('dumpsys window windows').split('Window #')[1:]:
        if 'WizardEverywhere' in blk.split('\n', 1)[0]:
            m = re.search(r'(?:mFrame|frame)=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]', blk)
            if m and 'mViewVisibility=0x8' not in blk and 'mViewVisibility=0x4' not in blk: return tuple(map(int, m.groups()))
    return None
def mid(f): return ((f[0] + f[2]) // 2, (f[1] + f[3]) // 2)

em = None
receipt = {'checks': []}
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'cr', '-k', 'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7', '-p', job / 'dev', stdin='no\n')
        em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'cr', '-port', str(PORT), '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect', '-dns-server', '10.0.2.250'],
                              env=env, stdout=open(job / 'em.log', 'w'), stderr=subprocess.STDOUT)
        for _ in range(140):
            if sx('getprop sys.boot_completed').strip() == '1': break
            time.sleep(3)
        time.sleep(10)
        for k in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'): sx('settings put global %s 0' % k)
        sx('settings put system screen_off_timeout 1800000'); sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard')
        out = sh(ADB, '-s', S, 'install', '-r', APK).strip().splitlines()[-1]
        check('install the QA build', out == 'Success', out)
        sh(ADB, '-s', S, 'reverse', 'tcp:%d' % FAKE, 'tcp:%d' % FAKE)
        aiff = job / 'q.aiff'; aac = job / 'qa_mic.aac'; m4a = job / 'qa_next.m4a'
        sh('say', '-o', aiff, 'I was halfway through a really long message about the launch plan when my thumb hit the X button by accident.')
        sh('afconvert', '-f', 'adts', '-d', 'aac', aiff, aac)
        sh('afconvert', '-f', 'm4af', '-d', 'aac', aiff, m4a)
        sh(ADB, '-s', S, 'push', aac, '/data/local/tmp/qa_mic.aac'); sh(ADB, '-s', S, 'push', m4a, '/data/local/tmp/qa_voice.m4a')
        runas('mkdir -p files && echo %s > files/qa_home.txt && echo %s > files/qa_origin.txt && cp /data/local/tmp/qa_mic.aac files/qa_mic.aac' % (ORIGIN, ORIGIN))
        sx('pm grant %s android.permission.RECORD_AUDIO' % PKG); sx('pm grant %s android.permission.POST_NOTIFICATIONS' % PKG)
        sx('appops set %s SYSTEM_ALERT_WINDOW allow' % PKG)
        sx('logcat -c')
        sx('am start -W -n %s/ai.wizards.os.MainActivity' % PKG); time.sleep(6)
        connect()
        # A fresh install opens the first-run practice tour, which (by design) swallows orb taps: finish it first.
        pg.ev("(() => { try { localStorage.setItem('wos.tour.v1', 'true'); } catch (e) {} try { window.WosTour?.finish('qa'); } catch (e) {}; return true; })()"); time.sleep(1)
        check('the app loads Wizard OS from the fake Wizard', pg.ev('location.href').startswith(ORIGIN + '/wizard-os-home/'))
        check('the cancelled-recordings bridge is there', pg.ev("typeof window.WizardOSDevice?.cancelledList === 'function' && !!window.WosCancelled"))

        # ---------- in-app orb: short cancel is gone ----------
        pg.tap('#orbWrap'); time.sleep(3)
        pg.ev("window.__wos.cancelVoice()"); time.sleep(1.5)
        check('in-app orb: a 3 s take cancelled keeps nothing', not kept_files(), kept_files())
        # ---------- in-app orb: long cancel is kept ----------
        pg.tap('#orbWrap'); time.sleep(1.5)
        rid = pg.ev("window.__wos.V.native || ''")
        time.sleep(16)
        pg.ev("window.__wos.cancelVoice()"); time.sleep(0.4)
        toast1 = pg.ev("document.querySelector('#toast')?.innerText || ''")
        time.sleep(1.5)
        k1 = kept_files()
        check('in-app orb: a 17 s take cancelled is kept on the phone', rid and len(k1) == 1, (rid, k1, sx('logcat -d -s WizardOSCancelled:* | tail -3')))
        check('in-app orb: the toast says it was kept', 'kept' in toast1.lower(), toast1)
        check('in-app orb: nothing was sent', not ST['runs'] and not ST['transcribe'], (len(ST['runs']), ST['transcribe']))
        shot('01-inapp-kept')

        # ---------- floating orb over the launcher: the real X ----------
        pg.ev("window.WizardOSNative.setEverywhere(true)"); time.sleep(2)
        for _ in range(4):
            if re.search('Turn on voice typing|Not now', ui()): tap_text(r'^Not now$'); time.sleep(0.8)
            else: break
        sx('input keyevent KEYCODE_HOME'); time.sleep(3)
        b = None
        for _ in range(10):
            b = bubble()
            if b: break
            time.sleep(0.8)
        check('the floating orb shows on the home screen', b, b)
        runas('cp /data/local/tmp/qa_voice.m4a files/qa_next.m4a')
        sx('logcat -c')
        cx, cy = mid(b); sx('input tap %d %d' % (cx, cy)); time.sleep(1.5)
        cs = ctl()
        check('tap starts listening; Cancel and Pause are on screen', 'cancel' in cs and 'pause' in cs, cs)
        if 'pause' in cs: px, py = mid(cs['pause']); sx('input tap %d %d' % (px, py))   # hold the debug auto-send
        time.sleep(16)
        lg_before = sx('logcat -d -s WizardEverywhere:* | grep -iE "finish|sending" | tail -3').strip()
        if 'cancel' in cs: qx, qy = mid(cs['cancel']); sx('input tap %d %d' % (qx, qy))
        time.sleep(0.6); shot('02-everywhere-cancel-toast'); time.sleep(2)
        k2 = kept_files()
        kl = sx('logcat -d -s WizardOSCancelled:* | grep kept | tail -2').strip()
        check('floating orb: the X after 16 s keeps the take', len(k2) == 2 and 'everywhere' in kl, (k2, kl, lg_before))
        check('floating orb: nothing was sent', not ST['runs'] and not ST['transcribe'], (len(ST['runs']), ST['transcribe']))

        # ---------- Settings → Cancelled recordings ----------
        sx('am start -W -n %s/ai.wizards.os.MainActivity' % PKG); time.sleep(3); connect()
        pg.ev("window.__wos.openSettings()"); time.sleep(1)
        rows = cancelled_rows()
        check('Settings lists both cancelled takes, newest (floating orb) first', len(rows) == 2 and 'Floating orb' in rows[0] and 'Transcribe' in rows[0], rows)
        shot('03-settings-list')
        fsz = int((runas('stat -c %s files/cancelled/*.m4a 2>/dev/null').split() or ['0'])[0])
        t0 = len(ST['transcribe'])
        pg.ev("document.querySelector('#settingsBody [data-cxid] [data-cx=copy]').click()")
        for _ in range(30):
            if len(ST['transcribe']) > t0 and pg.ev("!!document.querySelector('#settingsBody [data-cxid] .cx-text')"): break
            time.sleep(0.7)
        time.sleep(1)
        words = pg.ev("document.querySelector('#settingsBody [data-cxid] .cx-text')?.innerText || ''")
        tx = ST['transcribe'][t0:]
        check('Transcribe & copy sends that exact recording to Wizard Voice once', len(tx) == 1 and fsz and abs(tx[0] - fsz) < 2000, (tx, fsz))
        check('the words show under the take', 'Native parity QA take' in words, words)
        shot('04-transcribed')
        # The Android clipboard holds the words: paste into a fresh field with the system paste key.
        pg.ev("(() => { const t = document.createElement('textarea'); t.id = 'qaPaste'; t.style.cssText = 'position:fixed;top:40px;left:10px;width:300px;height:60px;z-index:99999'; document.body.appendChild(t); t.focus(); return true; })()")
        time.sleep(0.8); sx('input keyevent 279'); time.sleep(1)
        pasted = pg.ev("(() => { const t = document.querySelector('#qaPaste'); const v = t ? t.value : ''; t && t.remove(); return v; })()")
        check('the Android clipboard holds the words (pasted with the system paste key)', pasted and pasted.strip() == words.strip(), (pasted, words))
        sx('input keyevent KEYCODE_BACK'); time.sleep(0.5)   # the keyboard, if the paste raised it
        if pg.ev("window.__wos.sheet") != 'settings': pg.ev("window.__wos.openSettings()"); time.sleep(0.8)
        pg.ev("document.querySelector('#settingsBody [data-cxid] [data-cx=delete]').click()"); time.sleep(1)
        check('Delete removes the file from the phone', len(kept_files()) == 1 and len(cancelled_rows()) == 1, (kept_files(), cancelled_rows()))
        sx('input keyevent KEYCODE_BACK'); time.sleep(1.2)
        check('Back closes Settings and Wizard OS stays open', pg.ev("window.__wos.sheet") != 'settings' and PKG in top(), (pg.ev("window.__wos.sheet"), top()[:90]))
        check('no message was ever sent', not ST['runs'], len(ST['runs']))
        crashed = sx('logcat -d -b crash')
        check('no crashes', 'FATAL EXCEPTION' not in crashed, crashed[:300])
    except Exception as e:
        check('script ran to the end', False, repr(e)[:300])
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
                       transcribe_bytes=ST['transcribe'], writes=[l for l in ST['log'] if not l.startswith('GET')])
        (job / 'receipt.json').write_text(json.dumps(receipt, indent=1, default=str))
print('%d/%d passed · %s' % (sum(res), len(res), job))
