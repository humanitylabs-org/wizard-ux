#!/usr/bin/env python3
"""Wizard OS image-save device QA (runs on Thales). The real Wizard OS shell + real Wizard Search, inside the real
Android app's WebView on a fresh API 35 emulator. It checks that saving a search image puts a real file in Downloads.

usage: qa_image_save_device.py QA_APK WEB_DIR SEARCH_PORT [OUT_DIR]
  QA_APK       a Wizard OS debug (".qa") build; its WebView download path matches the release
  WEB_DIR      the worktree's web/ (the shell under test), copied to this Mac
  SEARCH_PORT  a local port that reaches Wizard Search (an ssh -R tunnel to the VPS service under test)

A fake Wizard on this Mac (adb reverse) serves WEB_DIR at /wizard-os-home/, proxies /wizard-search/* to SEARCH_PORT,
and answers the few Wizard reads the shell needs. Every Wizard write is refused and counted. DNS on the emulator is
dead, so nothing can reach the real Wizard.

Checks: image spell → viewer; Save → Android DownloadManager → /sdcard/Download/<title>.jpg with the exact bytes the
search service serves, Wizard OS stays in front, viewer stays open; long-press the photo → Save / Share menu →
Save image → a second file; long-press a search result → opens with the menu; real Back key steps menu → viewer →
sheet and Wizard OS stays open.
"""
import fcntl, hashlib, http.server, json, os, pathlib, re, socket, subprocess, sys, threading, time, uuid, urllib.error, urllib.request
# The Wizard the APK under test was built for (its private Gradle wizardOrigin / first wizardLegacyHosts entry).
# Set WIZARD_QA_ORIGIN / WIZARD_QA_LEGACY_HOST to match; see docs/qa-targets.md. Neutral examples by default.
QA_ORIGIN = os.environ.get('WIZARD_QA_ORIGIN', 'https://wizard.example.ts.net').rstrip('/')
QA_HOST = QA_ORIGIN.split('://', 1)[-1]
QA_LEGACY_HOST = os.environ.get('WIZARD_QA_LEGACY_HOST', 'old-name.example.com')
P = pathlib.Path
BASE = P('/Volumes/ThalesMedia/AndroidBuilds'); SDK = P('/opt/homebrew/share/android-commandlinetools')
APK = P(sys.argv[1]); WEB = P(sys.argv[2]).resolve(); SEARCH = int(sys.argv[3]); PKG = 'ai.wizards.os.qa'
job = P(sys.argv[4]) if len(sys.argv) > 4 else BASE / 'qa' / ('wos-imgsave-' + uuid.uuid4().hex[:6])
job.mkdir(parents=True, exist_ok=True)
env = os.environ.copy(); env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']; (job / 'avd').mkdir(exist_ok=True)
ADB = str(SDK / 'platform-tools/adb'); PORT = 5714; S = 'emulator-%d' % PORT; DEVTOOLS = 9365; FAKE = 18799
ORIGIN = 'http://localhost:%d' % FAKE
NOW = int(time.time())
passed = failed = 0
RESULTS = []


def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1
    else: failed += 1
    RESULTS.append({'name': name, 'ok': bool(ok), 'detail': str(detail)[:600]})
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  ' + str(detail)[:600]), flush=True)


def sh(*a, stdin=None, binary=False, timeout=120):
    r = subprocess.run([str(x) for x in a], env=env, capture_output=True, input=stdin, text=not binary, timeout=timeout)
    return r.stdout


def sx(c, **kw): return sh(ADB, '-s', S, 'shell', c, **kw)
def runas(c): return sx("run-as %s sh -c '%s'" % (PKG, c))
def top(): return next((l.strip() for l in sx('dumpsys activity activities').splitlines() if 'topResumedActivity' in l), '')
def front(): return PKG + '/' in top()
def shot(name): (job / (name + '.png')).write_bytes(sh(ADB, '-s', S, 'exec-out', 'screencap', '-p', binary=True))
def su_sql(q): return sh(ADB, '-s', S, 'shell', "su 0 sqlite3 /data/data/com.android.providers.downloads/databases/downloads.db \"%s\" 2>&1" % q).strip()


# ------------------------------------------------------------------ fake Wizard + Wizard Search proxy
WRITES = []; SEARCH_LOG = []; ATT_LOG = []
ATT_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'


def png():
    import struct, zlib
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    w = h = 96; raw = b''.join(b'\x00' + bytes([120, 60, 220]) * w for _ in range(h))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


PNG = png()
THREADS = [{'id': 'qa-%d' % i, 'title': 'QA thread %d' % (i + 1), 'source': 'api_server', 'model': 'qa', 'message_count': 2,
            'preview': 'Preview', 'last_active': NOW - i * 600, 'started_at': NOW - i * 600 - 60} for i in range(4)]
BOOT = {'bootstrap': 1, 'api': 'wizard-agent-service/1',
        'settings': {'owner': {'name': 'Robin', 'place': ''}, 'agent': {'name': 'Merlin'}, 'clock': {'timezone': 'UTC', 'day_starts_at': '06:00'}, 'voice': {'language': 'en', 'vocabulary': []}},
        'capabilities': {'voice': True, 'router': True, 'files': True, 'approvals': True, 'steer': True, 'markdown': True},
        'endpoints': {'sessions': '/wizard/hermes/api/sessions', 'runs': '/wizard/hermes/v1/runs', 'transcribe': '/wizard/voice/transcribe',
                      'route': '/wizard/v1/route', 'upload': '/wizard/files/upload', 'apps': '/wizard/v1/apps'}}
APPS = {'apps': [{'id': 'wizard-search', 'name': 'Search', 'desc': 'Image search and AI overview', 'url': '/wizard-search/', 'icon': '⌕', 'colors': ['#8f63ff', '#ff5ccf'], 'source': 'launcher.json'}]}
CT = {'css': 'text/css', 'html': 'text/html', 'png': 'image/png', 'webmanifest': 'application/manifest+json', 'js': 'application/javascript', 'svg': 'image/svg+xml', 'json': 'application/json'}


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
        if u.startswith('/wizard-search'):
            SEARCH_LOG.append({'path': self.path, 'ua': self.headers.get('User-Agent', '')})
            try:
                r = urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:%d%s' % (SEARCH, self.path), method=self.command), timeout=60)
                code, body, hd = r.status, r.read(), r.headers
            except urllib.error.HTTPError as e:
                code, body, hd = e.code, e.read(), e.headers
            except Exception as e:
                return self._send(502, str(e).encode(), 'text/plain')
            extra = {k: hd[k] for k in ('Content-Disposition', 'Location') if hd.get(k)}
            return self._send(code, body, hd.get('Content-Type') or 'application/octet-stream', extra)
        if u == '/wizard-os-home': return self._send(301, b'', extra={'Location': '/wizard-os-home/'})
        m = re.match(r'^/wizard-os-home/(.*)$', u)
        if m:
            f = m.group(1) or 'index.html'; p = (WEB / f).resolve()
            if f in ('data.js', 'summaries.js') or not str(p).startswith(str(WEB)) or not p.is_file():
                return self._send(200 if f.endswith('.js') else 404, b'', 'application/javascript')
            return self._send(200, p.read_bytes(), CT.get(f.rsplit('.', 1)[-1], 'application/octet-stream'))
        if u == '/wizard/v1/bootstrap': return self._json(200, BOOT)
        if u == '/wizard/v1/apps': return self._json(200, APPS)
        if u == '/wizard/hermes/api/sessions': return self._json(200, {'data': THREADS, 'has_more': False})
        if re.match(r'^/wizard/hermes/api/sessions/qa-0/messages$', u):
            att = '<helm_attachments>' + json.dumps({'items': [{'id': ATT_ID, 'name': 'chart.png', 'mime': 'image/png', 'kind': 'image', 'bytes': len(PNG)}]}) + '</helm_attachments>'
            return self._json(200, {'object': 'list', 'data': [{'id': 1, 'role': 'user', 'content': 'make me a chart', 'timestamp': NOW - 100}, {'id': 2, 'role': 'assistant', 'content': 'Here it is.\n\n' + att, 'timestamp': NOW - 90}]})
        if re.match(r'^/wizard/hermes/api/sessions/[^/]+/messages$', u):
            return self._json(200, {'object': 'list', 'data': [{'id': 1, 'role': 'user', 'content': 'hello', 'timestamp': NOW - 100}, {'id': 2, 'role': 'assistant', 'content': 'hi', 'timestamp': NOW - 90}]})
        if u == '/wizard/attachments/' + ATT_ID:
            ATT_LOG.append(self.headers.get('User-Agent', ''))
            return self._send(200, PNG, 'image/png', {'Content-Disposition': 'inline; filename="chart.png"'})
        if u == '/wizard/thread-seen': return self._json(200, {'state': {'initializedAt': NOW * 1000, 'threads': {}}})
        if u == '/wizard/thread-dispositions': return self._json(200, {'state': {}})
        if u.startswith('/reports/wizard-os/latest.json'): return self._json(404, {'error': 'none'})
        return self._json(200, {})

    def _write(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n: self.rfile.read(n)
        u = self.path.split('?')[0]
        WRITES.append(self.command + ' ' + u)
        if u == '/wizard/thread-seen': return self._json(200, {'state': {'initializedAt': NOW * 1000, 'threads': {}}})
        if u == '/wizard/v1/route' or u.endswith('/api/route'): return self._json(200, {'ms': 5, 'cmd': {'route': 'agent'}})
        return self._json(403, {'error': 'qa: write refused'})
    do_POST = do_PUT = do_PATCH = do_DELETE = _write


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
        u = page['webSocketDebuggerUrl']; m = re.match(r'ws://([^/]+)(/.*)', u); assert m
        host, path = m.groups(); h, p = host.split(':'); self.s = socket.create_connection((h, int(p)), timeout=60)
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

    def touch(self, x, y, hold=0.0):
        """A real Android touch (adb input) at CSS (x, y): a tap, or a long-press when hold > 0. The page draws from
        the top of the screen (0.8.7+), so CSS px × devicePixelRatio is the screen pixel. CDP touch events were too
        slow on this emulator: a 'tap' could last 600 ms and count as a long-press."""
        dpr = self.ev('window.devicePixelRatio') or 1
        X, Y = int(x * dpr), int(y * dpr)
        if hold: sx('input swipe %d %d %d %d %d' % (X, Y, X, Y, int(hold * 1000)))
        else: sx('input tap %d %d' % (X, Y))

    def centre(self, js):
        return self.ev("(() => { const e = %s; if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()" % js)

    def close(self):
        try: self.s.close()
        except Exception: pass


FRAME = "document.querySelector('.linksheet iframe')"
FWIN = FRAME + ".contentWindow"
VIEWER = "JSON.stringify(window.WosChat.viewer.state)"


def wait(fn, secs, step=0.5):
    t0 = time.time()
    while time.time() - t0 < secs:
        try:
            v = fn()
            if v: return v
        except Exception: pass
        time.sleep(step)
    try: return fn()
    except Exception: return None


def viewer(pg): return json.loads(pg.ev(VIEWER) or '{}')


def downloads():
    rows = su_sql("select _id,uri,status,total_bytes,current_bytes,_data,mimetype from downloads")
    out = []
    for l in rows.splitlines():
        p = l.split('|')
        if len(p) >= 7 and p[0].isdigit(): out.append({'id': int(p[0]), 'uri': p[1], 'status': p[2], 'bytes': p[3], 'cur': p[4], 'path': p[5], 'mime': p[6]})
    return out


def done_download(after_id):
    return [d for d in downloads() if d['id'] > after_id and d['status'] == '200' and d['path']]


def served(path):
    r = urllib.request.urlopen('http://127.0.0.1:%d%s' % (SEARCH, path), timeout=60)
    return r.read(), r.headers.get('Content-Disposition', '')


em = None
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'imgsave', '-k', 'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7', '-p', job / 'dev', stdin='no\n')
        em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'imgsave', '-port', str(PORT), '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect', '-dns-server', '10.0.2.250'],
                              env=env, stdout=open(job / 'em.log', 'w'), stderr=subprocess.STDOUT)
        for _ in range(140):
            if sx('getprop sys.boot_completed').strip() == '1': break
            time.sleep(3)
        time.sleep(8)
        sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard'); sx('settings put global window_animation_scale 0')
        # DNS stays dead, so Android never validates the network and DownloadManager would wait forever (status 190).
        # A phone's network is validated; skipping the captive-portal probe gives the emulator the same state.
        sx('settings put global captive_portal_mode 0'); sx('cmd connectivity airplane-mode enable'); time.sleep(3)
        sx('cmd connectivity airplane-mode disable')
        val = wait(lambda: 'VALIDATED' in sx('dumpsys connectivity | grep -E "NetworkAgentInfo.*(WIFI|CELLULAR)"'), 40, 2)
        print('network validated:', bool(val), flush=True)
        resolv = sx('ping -c1 -W2 ' + QA_HOST + ' 2>&1')
        check('the real Wizard is unreachable from the emulator (DNS dead)', not re.search(r'\(\d+\.\d+\.\d+\.\d+\)', resolv), resolv.strip()[:120])
        inst = sh(ADB, '-s', S, 'install', '-r', APK).strip().splitlines()[-1]
        ver = re.search(r'versionName=(\S+)', sx('dumpsys package %s | grep versionName' % PKG) or '')
        check('QA APK installs', 'Success' in inst, inst)
        print('app version', ver.group(1) if ver else '?', flush=True)
        sh(ADB, '-s', S, 'reverse', 'tcp:%d' % FAKE, 'tcp:%d' % FAKE)
        runas('mkdir -p files && echo %s > files/qa_home.txt' % ORIGIN)
        sx('pm grant %s android.permission.RECORD_AUDIO' % PKG)
        sx('am start -W -n %s/ai.wizards.os.MainActivity' % PKG); time.sleep(6)
        pg = Page()
        ready = wait(lambda: pg.ev("!!(window.__wos && window.__wos.live && window.__wos.live.ok && window.WosChat && window.WizCore && window.WizCore.apps)"), 45)
        pg.ev("(() => { const c = document.querySelector('#coach'); if (c && !c.hidden) document.querySelector('#coachGo')?.click(); try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} return 1; })()")
        ua = pg.ev('navigator.userAgent')
        check('Wizard OS shell is up inside the app (fake Wizard)', ready and 'WizardOS-Android/' in (ua or ''), ua)
        time.sleep(1.5)

        # 1. Image spell → search sheet → real results
        pg.ev("window.__wos.runUtterance('image search goku super saiyan', 'auto', true)")
        n = wait(lambda: pg.ev("(() => { const f = %s; return f && f.WizardSearch ? f.WizardSearch.state().images : 0; })()" % FWIN), 60)
        check('image search opens Wizard Search with real results', (n or 0) > 10, n)
        wait(lambda: pg.ev("(() => { const f = %s; const i = f && f.document.querySelector('#grid .tile img'); return !!(i && i.complete && i.naturalWidth); })()" % FWIN), 20)
        time.sleep(1); shot('01-results')

        def tile_xy(i):
            return pg.ev("(() => { const fr = %s.getBoundingClientRect(); const t = %s.document.querySelectorAll('#grid .tile')[%d]; t.scrollIntoView({ block: 'center' }); const r = t.getBoundingClientRect(); return [fr.x + r.x + r.width / 2, fr.y + r.y + Math.min(r.height / 2, 60)]; })()" % (FRAME, FWIN, i))

        # 2. Tap a result → viewer → Save (the button James pressed)
        xy = tile_xy(1); time.sleep(0.5); xy = tile_xy(1)
        pg.touch(*xy)
        v = wait(lambda: (lambda s: s if s.get('open') else None)(viewer(pg)), 10) or {}
        check('tapping a result opens it in the viewer', v.get('open') and v.get('kind') == 'image', v)
        wait(lambda: pg.ev("(() => { const i = document.querySelector('.mviewer .mv-stage img'); return !!(i && i.complete && i.naturalWidth); })()"), 30)
        item = json.loads(pg.ev("(() => { const f = %s; const s = f.WizardSearch; const im = f.document.querySelectorAll('#grid .tile')[1]; return JSON.stringify({ name: window.WosChat.viewer.state.name, url: document.querySelector('.mviewer .mv-stage img').getAttribute('src') }); })()" % FWIN))
        last = max([d['id'] for d in downloads()] or [0])
        pg.ev("window.__toasts = []; (() => { const t = document.getElementById('toast'); if (t) new MutationObserver(() => { const s = (t.textContent || '').trim(); if (s) window.__toasts.push(s); }).observe(t, { subtree: true, childList: true, characterData: true }); })(); 1")
        pg.ev("""(() => { window.__clk = []; const log = k => e => window.__clk.push(k + ':' + (e.target.dataset?.mv || e.target.className || e.target.nodeName) + '@' + Math.round(performance.now()));
          ['pointerdown', 'pointerup', 'click'].forEach(k => document.addEventListener(k, log(k), true));
          const c0 = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { window.__clk.push('a.click:' + this.getAttribute('href') + ' dl=' + this.download); return c0.call(this); }; return 1; })()""")
        xy = pg.centre("document.querySelector('.mviewer [data-mv=\"save\"]')")
        hit = pg.ev("(() => JSON.stringify(document.elementsFromPoint(%f, %f).slice(0, 5).map(e => { const cs = getComputedStyle(e); return e.outerHTML.slice(0, 160) + ' | z=' + cs.zIndex + ' pos=' + cs.position + ' op=' + cs.opacity + ' pe=' + cs.pointerEvents + ' parent=' + (e.parentElement && (e.parentElement.id || e.parentElement.className)); })))()" % (xy[0], xy[1]))
        print('save button at', xy, 'hit-test:', hit, 'since open ms:', pg.ev("Math.round(performance.now())"), flush=True)
        pg.touch(*xy); time.sleep(1.2); shot('02-after-save')
        print('events:', pg.ev("JSON.stringify(window.__clk)"), flush=True)
        got = wait(lambda: done_download(last), 60, 1.5) or []
        toasts = pg.ev("JSON.stringify(window.__toasts || [])")
        check('Save: Android downloads the image (DownloadManager status 200)', len(got) == 1, downloads())
        check('Save: no “Saving isn’t available here”', 'available here' not in (toasts or ''), toasts)
        if got:
            d = got[0]; pull = job / 'saved-1.bin'
            sh(ADB, '-s', S, 'pull', d['path'], pull)
            body, cd = served(re.sub(r'^https?://[^/]+', '', d['uri']))
            b = pull.read_bytes() if pull.exists() else b''
            stem = re.sub(r'[^\w]+', ' ', item['name']).strip().split(' ')[0]
            same = bool(b) and hashlib.sha256(b).hexdigest() == hashlib.sha256(body).hexdigest()
            check('Save: the file in Downloads is the full image, byte for byte (%d bytes)' % len(b),
                  same and (b[:3] == b'\xff\xd8\xff' or b[:8] == b'\x89PNG\r\n\x1a\n' or b[:4] == b'RIFF' or b[:3] == b'GIF'), (len(b), len(body), b[:8]))
            check('Save: it is named after the result (%s)' % d['path'].rsplit('/', 1)[-1],
                  d['path'].startswith('/storage/emulated/0/Download/') and stem.lower() in d['path'].lower() and re.search(r'\.(jpe?g|png|webp|gif)$', d['path'], re.I), (d['path'], item['name'], cd))
        check('Save: Wizard OS stays in front, viewer still open', front() and viewer(pg).get('open'), (top()[-90:], viewer(pg)))

        # 3. Long-press the photo → Save / Share menu → Save image
        img = pg.centre("document.querySelector('.mviewer .mv-stage img')")
        pg.touch(img[0], img[1], hold=0.9); time.sleep(0.6); shot('03-hold-menu')
        v = viewer(pg)
        check('long-press the photo opens Save / Share (photo stays put)', v.get('menu') and v.get('open') and v.get('scale') == 1, v)
        sx('input keyevent KEYCODE_BACK'); time.sleep(0.8)
        v = viewer(pg)
        check('Android Back closes the menu; the photo stays open; app in front', not v.get('menu') and v.get('open') and front(), (v, top()[-80:]))
        pg.touch(img[0], img[1], hold=0.9); time.sleep(0.8)
        last = max([d['id'] for d in downloads()] or [0])
        xy = pg.centre("document.querySelector('.mviewer [data-mvm=\"save\"]')")
        pg.touch(*xy); time.sleep(1.2)
        got2 = wait(lambda: done_download(last), 60, 1.5) or []
        check('menu → Save image puts a second file in Downloads; menu closes', len(got2) == 1 and not viewer(pg).get('menu'), (downloads()[-2:], viewer(pg)))

        # 4. Back closes the viewer, then long-press a search result directly
        sx('input keyevent KEYCODE_BACK'); time.sleep(0.8)
        v = viewer(pg); sheet = json.loads(pg.ev("JSON.stringify(window.__wos.links ? window.__wos.links.state() : {})") or '{}')
        check('Android Back closes the viewer; search results still open', not v.get('open') and sheet.get('open') and front(), (v, sheet))
        xy = tile_xy(2); time.sleep(0.5); xy = tile_xy(2)
        pg.touch(xy[0], xy[1], hold=0.9); time.sleep(1.2); shot('04-hold-result')
        v = viewer(pg)
        check('long-press a search result opens it with Save / Share', v.get('open') and v.get('menu') and v.get('i') == 2, v)

        # 5. Back ×3 never leaves Wizard OS
        for _ in range(3): sx('input keyevent KEYCODE_BACK'); time.sleep(0.8)
        v = viewer(pg); sheet = json.loads(pg.ev("JSON.stringify(window.__wos.links ? window.__wos.links.state() : {})") or '{}')
        check('Back ×3 (menu → viewer → sheet) and Wizard OS is still open', front() and not v.get('open') and not sheet.get('open'), (top()[-80:], v, sheet))
        shot('05-after-back')

        # 6. A photo in a chat thread: same viewer, same Save → Downloads
        pg.ev("window.__wos.openWizardThread('qa-0')")
        ok_img = wait(lambda: pg.ev("(() => { const i = document.querySelector('.ch-msgs img[src*=\"/wizard/attachments/\"]'); return !!(i && i.complete && i.naturalWidth); })()"), 30)
        check('chat thread shows the attached photo', ok_img)
        if ok_img:
            xy = pg.centre("document.querySelector('.ch-msgs img[src*=\"/wizard/attachments/\"]')"); pg.touch(*xy); time.sleep(1.2)
            v = viewer(pg)
            last = max([d['id'] for d in downloads()] or [0])
            xy = pg.centre("document.querySelector('.mviewer [data-mv=\"save\"]')"); pg.touch(*xy)
            got3 = wait(lambda: done_download(last), 60, 1.5) or []
            if got3:
                pull = job / 'saved-chat.bin'; sh(ADB, '-s', S, 'pull', got3[0]['path'], pull)
            b3 = (job / 'saved-chat.bin').read_bytes() if got3 and (job / 'saved-chat.bin').exists() else b''
            # Wizard serves chat images 'inline', and Android's filename guesser only reads 'attachment' names, so the
            # file is named by its attachment id (right extension, exact bytes). Search images carry real names (?dl=).
            check('chat photo: viewer → Save puts the photo in Downloads, byte for byte (%s)' % (got3[0]['path'].rsplit('/', 1)[-1] if got3 else '-'),
                  v.get('open') and got3 and b3 == PNG and got3[0]['path'].endswith('.png'), (v, got3, len(b3)))
            check('chat photo: Wizard OS stays in front', front(), top()[-80:])
            pg.touch(*pg.centre("document.querySelector('.mviewer .mv-stage img')"), hold=0.9); time.sleep(0.8)
            check('chat photo: long-press opens Save / Share too', viewer(pg).get('menu'), viewer(pg))
            shot('06-chat-photo-menu')
            for _ in range(2): sx('input keyevent KEYCODE_BACK'); time.sleep(0.8)
            check('chat photo: Back ×2 (menu → viewer) leaves the thread open, app in front', front() and not viewer(pg).get('open') and pg.ev("Object.values(__wos.wins).some(w => w.app === 'chats' && w.thread === 'qa-0')"), top()[-80:])

        bad = [w for w in WRITES if not re.match(r'^(PUT|POST) /wizard/(thread-seen|v1/route)', w) and not w.endswith('/api/route')]
        check('zero Wizard writes beyond read markers', not bad, bad)
        dm_ua = [l for l in SEARCH_LOG if '?dl=' in l['path']]
        print('download fetches:', json.dumps([(l['path'][:80], l['ua'][:50]) for l in dm_ua]), flush=True)
        pg.close()
    except Exception as e:
        import traceback; traceback.print_exc()
        check('suite ran to the end', False, repr(e))
    finally:
        try: (job / 'logcat.txt').write_text(sx('logcat -d | grep -E "DownloadManager|WizardOS|chromium|Toast" | tail -200'))
        except Exception: pass
        try: sh(ADB, '-s', S, 'emu', 'kill', timeout=30)
        except Exception: pass
        if em:
            try: em.wait(30)
            except Exception: em.kill()
        srv.shutdown()
(job / 'results.json').write_text(json.dumps({'passed': passed, 'failed': failed, 'results': RESULTS}, indent=1))
print('\n%d/%d passed' % (passed, passed + failed))
print('job', job)
