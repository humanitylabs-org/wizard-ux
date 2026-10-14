#!/usr/bin/env python3
"""Wizard OS address-move QA (runs on Thales): the one-time carry from an older name (the APK's first wizardLegacyHosts entry) to
the tailnet name, on a fresh API 35 emulator with the exact debug APK. Nothing reaches the real Wizard.

usage: qa_carry.py QA_APK WEB_DIR [OUT_DIR]

Two fake Wizards on this Mac stand in for the two names (debug hooks only): OLD = http://localhost:18791
(files/qa_carry_from.txt) and NEW = http://localhost:18792 (files/qa_home.txt + qa_origin.txt). The OLD origin
is seeded through the app's own WebView with a draft, a thread mark and two unsent messages (one with voice
audio), exactly as an older Wizard OS would have left them. Then:

  1 first launch opens OLD/wizard-os-home/carry.html, which hands everything over and the app goes to NEW
  2 the shell on NEW has the draft and the thread mark, and both unsent messages in its outbox (audio intact)
  3 the carried messages are delivered exactly once (same idempotency key) and nothing is sent twice
  4 Back from the shell does not land on the carry page; the app stays open
  5 a later launch goes straight to NEW (no second carry); the app's copy (files/carry.json) is gone
  6 values already on NEW are never overwritten
  7 if OLD cannot be reached, the app still opens NEW (and retries carry later, at most 3 times)
  8 safety net: the real tailnet name unreachable (dead DNS) → the app opens the same shell on the old name
    (served by CDP Fetch interception, as qa_mizel does) instead of an error page
"""
import base64, fcntl, http.server, json, os, pathlib, re, socket, subprocess, sys, threading, time, uuid
import urllib.request
# The Wizard the APK under test was built for (its private Gradle wizardOrigin / first wizardLegacyHosts entry).
# Set WIZARD_QA_ORIGIN / WIZARD_QA_LEGACY_HOST to match; see docs/qa-targets.md. Neutral examples by default.
QA_ORIGIN = os.environ.get('WIZARD_QA_ORIGIN', 'https://wizard.example.ts.net').rstrip('/')
QA_HOST = QA_ORIGIN.split('://', 1)[-1]
QA_LEGACY_HOST = os.environ.get('WIZARD_QA_LEGACY_HOST', 'old-name.example.com')
P = pathlib.Path
BASE = P('/Volumes/ThalesMedia/AndroidBuilds'); SDK = P('/opt/homebrew/share/android-commandlinetools')
APK = P(sys.argv[1]); WEB = P(sys.argv[2]).resolve()
PKG = 'ai.wizards.os.qa'
job = P(sys.argv[3]) if len(sys.argv) > 3 else BASE / 'qa' / ('wos-carry-' + uuid.uuid4().hex[:8])
job.mkdir(parents=True, exist_ok=True); OUT = job / 'shots'; OUT.mkdir(exist_ok=True)
env = os.environ.copy(); env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']; (job / 'avd').mkdir(exist_ok=True)
ADB = str(SDK / 'platform-tools/adb'); PORT = 5706; S = 'emulator-%d' % PORT; DEVTOOLS = 9357
OLD_PORT, NEW_PORT = 18791, 18792
OLD, NEW = 'http://localhost:%d' % OLD_PORT, 'http://localhost:%d' % NEW_PORT
res = []


def check(n, ok, d=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n + (' — ' + str(d)[:300] if d else ''), flush=True)


def sh(*a, stdin=None, binary=False, timeout=120):
    return subprocess.run([str(x) for x in a], env=env, capture_output=True, input=stdin, text=not binary, timeout=timeout).stdout


def sx(c, **kw): return sh(ADB, '-s', S, 'shell', c, **kw)
def runas(c): return sx("run-as %s sh -c '%s'" % (PKG, c))
def top(): return next((l.strip() for l in sx('dumpsys activity activities').splitlines() if 'topResumedActivity' in l), '')
def shot(name): (OUT / (name + '.png')).write_bytes(sh(ADB, '-s', S, 'exec-out', 'screencap', '-p', binary=True))


def wait(fn, secs, step=0.5):
    t0 = time.time()
    while time.time() - t0 < secs:
        v = fn()
        if v: return v
        time.sleep(step)
    return fn()


# ------------------------------------------------------------------ two fake Wizards (static shell + minimal API)
ST = {OLD_PORT: {'runs': [], 'keys': {}, 'sessions': set(), 'log': [], 'up': True},
      NEW_PORT: {'runs': [], 'keys': {}, 'sessions': set(), 'log': [], 'up': True}}
SEED_HTML = b'<!doctype html><meta charset=utf-8><title>seed</title><body>seed'


def make_handler(port):
    st = ST[port]

    class H(http.server.BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        def log_message(self, *a): pass

        def _send(self, code, body, ctype='application/json'):
            self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store'); self.end_headers()
            if self.command != 'HEAD': self.wfile.write(body)

        def _json(self, code, obj): self._send(code, json.dumps(obj).encode())

        def _down(self):
            if st['up']: return False
            try: self.connection.shutdown(socket.SHUT_RDWR)
            except OSError: pass
            return True

        def do_HEAD(self): self.do_GET()

        def do_GET(self):
            if self._down(): return
            u = self.path.split('?')[0]; st['log'].append('GET ' + u)
            if u == '/wizard-os-home/qa-seed.html': return self._send(200, SEED_HTML, 'text/html')
            m = re.match(r'^/wizard-os-home/(.*)$', u)
            if u == '/wizard-os-home':
                self.send_response(301); self.send_header('Location', '/wizard-os-home/'); self.send_header('Content-Length', '0'); self.end_headers(); return
            if m and not m.group(1).startswith('api/'):
                f = m.group(1) or 'index.html'; p = (WEB / f).resolve()
                if f in ('data.js', 'summaries.js') or not str(p).startswith(str(WEB)) or not p.is_file():
                    return self._send(200 if f.endswith('.js') else 404, b'', 'application/javascript')
                ct = {'css': 'text/css', 'html': 'text/html', 'png': 'image/png', 'webmanifest': 'application/manifest+json', 'js': 'application/javascript'}.get(f.rsplit('.', 1)[-1], 'application/octet-stream')
                return self._send(200, p.read_bytes(), ct)
            if u == '/wizard/hermes/api/sessions':
                return self._json(200, {'data': [{'id': 'qa_thread_a', 'title': 'Existing QA thread', 'status': 'completed', 'updated_at': '2026-10-09T00:00:00Z'}], 'has_more': False})
            if re.match(r'^/wizard/hermes/api/sessions/[^/]+/messages$', u): return self._json(200, {'data': [], 'has_more': False})
            if u == '/wizard/thread-seen': return self._json(200, {'state': {'initializedAt': int(time.time() * 1000), 'threads': {}}})
            if u == '/wizard/thread-dispositions': return self._json(200, {'state': {}})
            if u == '/reports/wizard-os/latest.json': return self._json(404, {'error': 'none'})
            return self._json(200, {})

        def do_PUT(self):
            if self._down(): return
            n = int(self.headers.get('Content-Length') or 0); self.rfile.read(n) if n else b''
            return self._json(200, {'state': {}})

        def do_POST(self):
            if self._down(): return
            n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n) if n else b''
            u = self.path.split('?')[0]; st['log'].append('POST ' + u)
            if u == '/wizard/files/upload':
                return self._json(201, {'file': {'id': 'drop_%d' % len(st['log']), 'filename': self.headers.get('X-Wizard-Filename'), 'mime': self.headers.get('X-Wizard-Mime'), 'bytes': len(body)}})
            if u == '/wizard-os-home/api/transcribe': return self._json(200, {'text': 'carried voice note', 'ms': 3})
            if u == '/wizard/hermes/api/sessions':
                sid = json.loads(body or b'{}').get('id')
                if sid in st['sessions']: return self._json(409, {'error': 'exists'})
                st['sessions'].add(sid); return self._json(201, {'session': {'id': sid}})
            if u == '/wizard/hermes/v1/runs':
                key = self.headers.get('Idempotency-Key') or ''
                if key in st['keys']: return self._json(202, {'run_id': st['keys'][key], 'status': 'queued'})
                rid = 'run_%d' % (len(st['runs']) + 1); st['keys'][key] = rid
                st['runs'].append({'key': key, 'body': json.loads(body or b'{}')})
                return self._json(202, {'run_id': rid, 'status': 'queued'})
            return self._json(200, {})
    return H


for p in (OLD_PORT, NEW_PORT):
    s = http.server.ThreadingHTTPServer(('127.0.0.1', p), make_handler(p))
    threading.Thread(target=s.serve_forever, daemon=True).start()


# ------------------------------------------------------------------ raw CDP to the app's WebView
class Page:
    def __init__(self, want):
        pid = sx('pidof %s' % PKG).strip()
        sh(ADB, '-s', S, 'forward', 'tcp:%d' % DEVTOOLS, 'localabstract:webview_devtools_remote_%s' % pid)
        page = None
        for _ in range(60):
            try:
                l = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json/list' % DEVTOOLS, timeout=3))
                page = next((x for x in l if x.get('type') == 'page' and want(x.get('url', ''))), None)
            except Exception: pass
            if page: break
            time.sleep(0.5)
        if not page: raise RuntimeError('no matching page')
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

    def close(self):
        try: self.s.close()
        except Exception: pass


def page(want, secs=30):
    t0 = time.time(); last = None
    while time.time() - t0 < secs:
        try: return Page(want)
        except Exception as e: last = e; time.sleep(1)
    raise RuntimeError('page: %s' % last)


def launch(extra=''):
    sx('am force-stop %s' % PKG); time.sleep(1)
    sx('am start -W -n %s/ai.wizards.os.MainActivity %s' % (PKG, extra))


AUDIO = bytes(range(256)) * 40  # 10 KB of "voice"
SEED_JS = r"""(async () => {
  localStorage.setItem('wos.chat.drafts.v1', JSON.stringify({ 'w1': { text: 'carried draft text', files: [] } }));
  localStorage.setItem('wizard.thread-emojis.v1', JSON.stringify({ qa_thread_a: '🐸' }));
  localStorage.setItem('wos.chats.readyOrder.v1', 'old-value');
  const db = await new Promise((res, rej) => { const r = indexedDB.open('wos-outbox', 1); r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const bin = atob('%s'); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const items = [
    { id: 'wos-carry-text-1', createdAt: Date.now() - 60000, attempts: 3, state: 'failed', kind: 'new', sessionId: 'wizard_1_carrytext00', steerRunId: '', text: 'carried unsent text', instructions: '', files: [], audio: null, audioType: '', wid: '', how: '', source: 'chat', title: 'carried unsent text' },
    { id: 'wos-carry-voice-1', createdAt: Date.now() - 50000, attempts: 1, state: 'waiting', nextAt: Date.now() + 3600000, kind: 'reply', sessionId: 'qa_thread_a', steerRunId: '', text: '', instructions: '', files: [], audio: new Blob([u8], { type: 'audio/webm' }), audioType: 'audio/webm', wid: '', how: '', source: 'chat', title: '' },
    { id: 'wos-carry-sent-1', createdAt: Date.now() - 40000, attempts: 1, state: 'sent', sentAt: Date.now() - 30000, kind: 'reply', sessionId: 'qa_thread_a', text: 'already sent', files: [] },
  ];
  await new Promise((res, rej) => { const t = db.transaction('items', 'readwrite'); for (const it of items) t.objectStore('items').put(it); t.oncomplete = res; t.onerror = () => rej(t.error); });
  return localStorage.length;
})()""" % base64.b64encode(AUDIO).decode()

em = None
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'cq', '-k', 'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7', '-p', job / 'dev', stdin='no\n')
        em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'cq', '-port', str(PORT), '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect', '-dns-server', '10.0.2.250'],
                              env=env, stdout=open(job / 'em.log', 'w'), stderr=subprocess.STDOUT)
        for _ in range(140):
            if sx('getprop sys.boot_completed').strip() == '1': break
            time.sleep(3)
        time.sleep(8)
        for k in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'): sx('settings put global %s 0' % k)
        sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard')
        out = sh(ADB, '-s', S, 'install', '-r', APK).strip().splitlines()[-1]
        check('install the QA build', out == 'Success', out)
        for p in (OLD_PORT, NEW_PORT): sh(ADB, '-s', S, 'reverse', 'tcp:%d' % p, 'tcp:%d' % p)
        sx('pm grant %s android.permission.POST_NOTIFICATIONS' % PKG)

        # ---- seed OLD the way an older build left it: the app's own WebView, on the OLD origin
        runas('mkdir -p files && echo %s > files/qa_home.txt && echo %s > files/qa_origin.txt && rm -f files/qa_carry_from.txt' % (OLD, OLD))
        launch(); time.sleep(4)
        pg = page(lambda u: u.startswith(OLD + '/wizard-os-home/'))
        pg.ev("location.href = %s" % json.dumps(OLD + '/wizard-os-home/qa-seed.html')); pg.close(); time.sleep(2)
        pg = page(lambda u: u.endswith('/qa-seed.html'))
        n = pg.ev(SEED_JS); pg.close()
        check('seeded the old origin (drafts, thread marks, 2 unsent + 1 sent in the outbox)', n and n >= 3, n)
        # The WebView writes localStorage to disk lazily; a force-stop right after the writes loses them (a real
        # phone's old-name state was written long ago). Give it time, then prove the seed survived a restart.
        time.sleep(12); sx('am force-stop %s' % PKG); time.sleep(1)
        launch(); time.sleep(4)
        pg = page(lambda u: u.startswith(OLD + '/wizard-os-home/'))
        kept = pg.ev("JSON.stringify([localStorage.getItem('wos.chat.drafts.v1'), localStorage.getItem('wizard.thread-emojis.v1'), localStorage.getItem('wos.chats.readyOrder.v1')])"); pg.close()
        check('the seed is on disk on the old name (survives a restart)', 'carried draft text' in (kept or '') and '🐸' in (kept or ''), kept)
        time.sleep(12); sx('am force-stop %s' % PKG); time.sleep(1)
        # A pre-existing value on NEW must survive the carry.
        runas('echo %s > files/qa_home.txt && echo %s > files/qa_origin.txt' % (NEW, NEW))
        launch(); time.sleep(4)
        pg = page(lambda u: u.startswith(NEW + '/wizard-os-home/'))
        pg.ev("localStorage.setItem('wos.chats.readyOrder.v1', 'new-value'), 1"); pg.close(); time.sleep(12)
        runas('rm -f shared_prefs/carry.xml files/carry.json')
        nOld0, nNew0 = len(ST[OLD_PORT]['runs']), len(ST[NEW_PORT]['runs'])

        # ---- 1. first launch with the move
        runas('echo %s > files/qa_carry_from.txt' % OLD)
        launch(); time.sleep(2)
        hit = wait(lambda: 'GET /wizard-os-home/carry.html' in ST[OLD_PORT]['log'], 15)
        check('#1 first launch opens the carry page on the old name', hit)
        pg = page(lambda u: u.startswith(NEW + '/wizard-os-home/') and 'carry.html' not in u, 40)
        href = pg.ev('location.href')
        check('#1 then lands on the shell on the new name', href.startswith(NEW + '/wizard-os-home/'), href)
        shot('01-new-home')

        # ---- 2. state arrived
        rep = wait(lambda: pg.ev('window.WosCarryReport || null'), 10)
        check('#2 carry report present', rep and rep.get('from') == OLD and rep.get('outbox') == 2, rep)
        draft = pg.ev("localStorage.getItem('wos.chat.drafts.v1')") or ''
        check('#2 draft carried', 'carried draft text' in draft, draft[:120])
        check('#2 thread mark carried', '🐸' in (pg.ev("localStorage.getItem('wizard.thread-emojis.v1')") or ''))
        check('#6 a value already on the new name is not overwritten', pg.ev("localStorage.getItem('wos.chats.readyOrder.v1')") == 'new-value')
        ob = wait(lambda: pg.ev("(async () => { await window.WosOutbox.load(); return [...window.WosOutbox._items.values()].map(i => ({ id: i.id, state: i.state, audio: i.audio ? i.audio.size : 0, type: i.audio ? i.audio.type : '' })); })()"), 15)
        ids = {o['id']: o for o in (ob or [])}
        check('#2 both unsent messages are in the new outbox, the sent one is not', 'wos-carry-text-1' in ids and 'wos-carry-voice-1' in ids and 'wos-carry-sent-1' not in ids, ob)
        v = ids.get('wos-carry-voice-1') or {}
        check('#2 the voice note audio arrived intact', v.get('audio') == len(AUDIO) and v.get('type') == 'audio/webm', v)

        # ---- 3. delivered once, on the new name only
        pg.ev("window.WosOutbox.retryAll(), 1")
        wait(lambda: len(ST[NEW_PORT]['runs']) - nNew0 >= 2, 30)
        time.sleep(4)
        pg.ev("window.WosOutbox.retryAll(), 1"); time.sleep(4)
        runs = ST[NEW_PORT]['runs'][nNew0:]
        keys = [r['key'] for r in runs]
        check('#3 both carried messages reach the new Wizard', 'wos-carry-text-1' in keys and 'wos-carry-voice-1' in keys, keys)
        check('#3 each exactly once (idempotent)', len(keys) == len(set(keys)), keys)
        check('#3 nothing was sent to the old name', len(ST[OLD_PORT]['runs']) == nOld0, len(ST[OLD_PORT]['runs']) - nOld0)
        check('#2 the app dropped its copy after the shell took it', 'carry.json' not in runas('ls files'))
        pg.close()

        # ---- 4. Back never lands on the carry page
        sx('input keyevent KEYCODE_BACK'); time.sleep(1.5); sx('input keyevent KEYCODE_BACK'); time.sleep(1.5)
        pg = page(lambda u: u.startswith(NEW) or u.startswith(OLD), 10)
        href = pg.ev('location.href'); pg.close()
        check('#4 Back stays in the app and never shows the carry page', PKG in top() and 'carry.html' not in href and href.startswith(NEW), (top()[:80], href))

        # ---- 5. a later launch goes straight home
        cut = len(ST[OLD_PORT]['log'])
        launch(); time.sleep(5)
        pg = page(lambda u: u.startswith(NEW + '/wizard-os-home/'), 20); href = pg.ev('location.href'); pg.close()
        check('#5 a later launch goes straight to the new name, no second carry', href.startswith(NEW) and not any('carry.html' in x for x in ST[OLD_PORT]['log'][cut:]), href)

        # ---- 7. old name unreachable: the app still opens home
        runas('rm -f shared_prefs/carry.xml files/carry.json')
        ST[OLD_PORT]['up'] = False
        launch(); time.sleep(2)
        pg = page(lambda u: u.startswith(NEW + '/wizard-os-home/'), 40); href = pg.ev('location.href'); pg.close()
        check('#7 old name down: the app still opens the shell on the new name', href.startswith(NEW), href)
        prefs = runas('cat shared_prefs/carry.xml 2>/dev/null')
        check('#7 and keeps the carry for a later launch (not marked done)', 'name="done" value="true"' not in prefs and 'tries' in prefs, prefs.strip()[:200])
        shot('07-old-down')

        # ---- 8. safety net: the real build origins, tailnet name unreachable → old name, same page
        runas('rm -f files/qa_home.txt files/qa_origin.txt files/qa_carry_from.txt files/carry.json shared_prefs/carry.xml')
        launch(); time.sleep(6)  # tailnet name fails (dead DNS) → old name fails too → offline page
        pg = page(lambda u: True, 20)
        pg.call('Fetch.enable', patterns=[{'urlPattern': 'https://' + QA_LEGACY_HOST + '/*'}])
        served = []
        # (0.9.10: the offline page is a native screen now; drive the same home load the old Retry link made.)
        pg._send({'id': 899999, 'method': 'Page.navigate', 'params': {'url': QA_ORIGIN + '/wizard-os-home/'}})
        t0 = time.time(); pg.s.settimeout(1.0)
        while time.time() - t0 < 25:
            try: d = pg._recv()
            except socket.timeout: continue
            except Exception: break
            if d.get('method') != 'Fetch.requestPaused': continue
            p = d['params']; url = p['request']['url']; served.append(url)
            if p.get('resourceType') == 'Document':
                body = b'<!doctype html><meta charset=utf-8><title>legacy-shell</title><body>legacy shell'
                hdrs = [{'name': 'Content-Type', 'value': 'text/html'}]
            else:
                body = b'{}'; hdrs = [{'name': 'Content-Type', 'value': 'application/json'}]
            pg._send({'id': 900000 + len(served), 'method': 'Fetch.fulfillRequest', 'params': {'requestId': p['requestId'], 'responseCode': 200, 'responseHeaders': hdrs, 'body': base64.b64encode(body).decode()}})
            if p.get('resourceType') == 'Document': time.sleep(2); break
        pg.s.settimeout(30)
        href = pg.ev('location.href'); title = pg.ev('document.title'); pg.close()
        check('#8 tailnet name unreachable → the shell opens on the old name instead of an error', href.startswith('https://' + QA_LEGACY_HOST + '/wizard-os-home/') and title == 'legacy-shell', (href, title, served[:3]))
        check('#8 the app stays open', PKG in top(), top()[:80])
        shot('08-safety-net')

        crashed = sx('logcat -d -b crash')
        check('no crashes', 'FATAL EXCEPTION' not in crashed, crashed[:300])
    except Exception as e:
        check('harness', False, repr(e))
    finally:
        if em:
            sh(ADB, '-s', S, 'emu', 'kill')
            try: em.wait(40)
            except Exception: em.kill()
print('%d/%d passed · %s' % (sum(res), len(res), job))
