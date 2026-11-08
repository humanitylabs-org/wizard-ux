#!/usr/bin/env python3
"""Orb long-press QA: fresh API35 google_apis emulator (forum: x86_64 under the inherited canonical worker lease;
elsewhere arm64-v8a), the exact QA APK, real taps, long-presses and Back.

usage: qa_orb_screen.py APK PKG [WEB_DIR] [--picture-only]

--picture-only: the same real install, Everywhere, overlay and Accessibility set-up, then only the native picture
overlay scene, the crash check and cleanup (a proportional lane for that scene). The default runs every case.

Receipt: <job>/receipt.json (every check by name, the parent of shots/). Search replies are synthetic HTTP fixtures
served by this script, never live inference.

WEB_DIR (the worktree's web/) is served as the WizardOS shell by the fake Wizard, since the emulator can't reach
the private network.

A fake Wizard Search on the host (the emulator reaches it as 10.0.2.2) answers /wizard-search/api/translate,
/wizard-search/api/read-image (the app asks ?geometry=1; lines only, like an older Search, except the one scene that
serves a fixture with boxes) and the search page, so nothing reaches the real Wizard.

Checks
  hold the orb → a menu with Select text · Translate screen · Hide orb, the orb does not move or start talking
  Select text over Chrome showing text the page blocks from copying (0.9.21, Google style): no boxes; a finger
  drag selects exactly the words it crosses, handles extend it, Copy copies it, Search opens Wizard Search in a
  sheet, Translate gives English; a tap picks a whole line
  Back steps out one layer at a time (search → selection → Screen) and never leaves the app underneath
  Translate screen (Google Lens style) → the foreign text alone is translated and painted over in place, the pill
  names the detected language, the language list re-translates
  Ask Wizard → WizardOS opens on its share sheet with the text
  a screen with no text layer (a picture) → Read picture text runs by itself
  Translate screen over a picture, with a geometry fixture → the English is painted in place over the Thai (no picture
  panel opens), Thai → English pill, Original, a hit-tested outside tap, Back, Copy translation
  Hide orb → the orb is gone, a "Floating orb hidden" notification brings it back; opening WizardOS does too
  without Accessibility, Select text opens the one-step setup instead of failing
  no crashes
"""
import fcntl, hashlib, http.server, json, os, pathlib, re, shlex, shutil, signal, socket, subprocess, sys, threading, time, urllib.parse, urllib.request, uuid
from qa_paths import work_root
from qa_paths import android_sdk, java_home
from qa_android_connect import choose_emulator_port  # recommended 5554..5584 console / 5555..5585 ADB, both sockets free
from qa_android_connect import EMULATOR_GRAPHICS, emulator_exit  # shared graphics runtime and exit diagnostic
P = pathlib.Path
def parse_args(argv):
    """APK PKG [WEB_DIR] [--picture-only] → (apk, pkg, web, picture_only). Anything else is refused."""
    flags = [a for a in argv if a.startswith('--')]
    pos = [a for a in argv if not a.startswith('--')]
    if any(f != '--picture-only' for f in flags) or len(flags) > 1 or len(pos) not in (2, 3):
        raise SystemExit('usage: qa_orb_screen.py APK PKG [WEB_DIR] [--picture-only]')
    web = P(pos[2]) if len(pos) == 3 else P(__file__).resolve().parent.parent / 'web'
    if not P(pos[0]).is_file(): raise SystemExit('APK not found: ' + pos[0])
    if not (web / 'index.html').is_file(): raise SystemExit('WEB_DIR has no index.html: ' + str(web))
    return P(pos[0]), pos[1], web, bool(flags)
apk, PKG, WEB, PICTURE_ONLY = parse_args(sys.argv[1:])
BASE = P(str(work_root() / 'AndroidBuilds')); SDK = android_sdk()
job = BASE / 'qa' / ('wos-orb-screen-' + uuid.uuid4().hex[:8]); job.mkdir(parents=True)
OUT = job / 'shots'; OUT.mkdir()
env = os.environ.copy(); env.update(JAVA_HOME=java_home(),
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:' + env['PATH']; (job / 'avd').mkdir()
ADB = str(SDK / 'platform-tools/adb'); PORT = S = None; DEVTOOLS = 9347; FAKE = 18779  # PORT/S chosen under the lease
FORUM = sys.platform == 'linux' and os.uname().nodename == 'forum'
ABI = 'x86_64' if FORUM else 'arm64-v8a'
# forum: the one canonical heavy lease, inherited from the queue worker; 200 GiB stays free beyond this guest's 20 GiB
LOCK_PATH = P('/srv/work/heavy/production/worker.lock') if FORUM else BASE / 'worker.lock'
RESERVE, GUEST = 200 * 1024**3, 20 * 1024**3
res, CHECKS = [], []
def check(n, ok, d=''):
    res.append(bool(ok)); CHECKS.append({'name': n, 'passed': bool(ok), 'detail': str(d)[:400] if d not in ('', None) else ''})
    print(('PASS ' if ok else 'FAIL ') + n + (' — ' + str(d)[:400] if d not in ('', None) else ''), flush=True)
def sh(*a, stdin=None, binary=False, check=True, timeout=30):
    """Never turn ADB failure into empty success. Retain bounded stderr for *every* invocation, even polls/cleanup."""
    argv = [str(x) for x in a]; started = time.monotonic()
    entry = {'argv': argv, 'serial': S, 'timeout_seconds': timeout}
    result = None
    try:
        result = subprocess.run(argv, env=env, capture_output=True, input=stdin, text=not binary, timeout=timeout)
        stderr = result.stderr.decode(errors='replace') if isinstance(result.stderr, bytes) else result.stderr
        entry.update(returncode=result.returncode, stderr=stderr[-8192:], stdout_bytes=len(result.stdout),
                     stdout=None if binary else result.stdout[-4096:])
        if check and result.returncode:
            raise RuntimeError('command failed: ' + json.dumps(entry))
        return result.stdout
    except subprocess.TimeoutExpired as error:
        stderr = error.stderr or b''
        entry.update(returncode=None, timed_out=True, stderr=(stderr.decode(errors='replace') if isinstance(stderr, bytes) else stderr)[-8192:])
        raise
    except OSError as error:
        entry.update(returncode=None, error=repr(error)); raise
    finally:
        entry['seconds'] = round(time.monotonic() - started, 3)
        with (job / 'commands.jsonl').open('a') as log: log.write(json.dumps(entry) + '\n')
def sx(c, **kw): return sh(ADB, '-s', S, 'shell', c, **kw)
def top(): return next((l.strip() for l in sx('dumpsys activity activities').splitlines() if 'topResumedActivity' in l), '')
def shot(name):
    data = sh(ADB, '-s', S, 'exec-out', 'screencap', '-p', binary=True)
    if not data.startswith(b'\x89PNG\r\n\x1a\n'): raise RuntimeError('screencap returned no PNG: ' + name)
    (OUT / (name + '.png')).write_bytes(data)
def device_snapshot():
    devices = sh(ADB, 'devices', '-l')
    return {'emulator_pid': em.pid if em else None, 'emulator_returncode': em.poll() if em else None, 'emulator': emulator_exit(em, EM_ARGV),
            'serial': S, 'devices': devices, 'target_device': bool(re.search(r'^' + re.escape(S or '<none>') + r'\s+device\b', devices, re.M)),
            'adb': ADB, 'environment': {k: env.get(k) for k in ('ANDROID_SERIAL', 'ADB_SERVER_SOCKET', 'ANDROID_ADB_SERVER_PORT', 'ADB_SERVER_PORT', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'ANDROID_AVD_HOME')}}
def require_device():
    state = device_snapshot(); (job / 'device-ready.json').write_text(json.dumps(state, indent=2))
    if state['emulator_returncode'] is not None or not state['target_device']:
        startup_diagnostics('emulator/ADB target not alive: ' + json.dumps(state))
        raise RuntimeError('owned emulator is not a live ADB target')
def ui(): sx('uiautomator dump /sdcard/ui.xml >/dev/null'); return sx('cat /sdcard/ui.xml')
def tap_text(pattern, xml=None):
    xml = xml or ui()
    for m in re.finditer(r'<node [^>]*?>', xml):
        n = m.group(0)
        for attr in ('text', 'content-desc'):
            t = re.search(' ' + attr + r'="([^"]*)"', n); label = t.group(1) if t else ''
            if label and re.search(pattern, label, re.I):
                b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
                if b:
                    x1, y1, x2, y2 = map(int, b.groups()); sx(f'input tap {(x1 + x2) // 2} {(y1 + y2) // 2}'); return label
    return None
def logs(pat): return sx(f'logcat -d -s WizardEverywhere:* | grep -iE "{pat}" | tail -5', check=False).strip()
def wait_log(pat, secs=20):
    t0 = time.time()
    while time.time() - t0 < secs:
        l = logs(pat)
        if l: return l
        time.sleep(0.7)
    return ''
def window(title):
    for blk in sx('dumpsys window windows').split('Window #')[1:]:
        if title in blk.split('\n', 1)[0]:
            m = re.search(r'(?:mFrame|frame)=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]', blk)
            if m and 'mViewVisibility=0x8' not in blk and 'mViewVisibility=0x4' not in blk: return tuple(map(int, m.groups()))
    return None
def wait_window(title, want=True, secs=8):
    t0 = time.time()
    while time.time() - t0 < secs:
        w = window(title)
        if bool(w) == want: return w
        time.sleep(0.6)
    return window(title)
def bubble(): return window('WizardEverywhere')
def mid(f): return ((f[0] + f[2]) // 2, (f[1] + f[3]) // 2)
def hold(x, y, ms=900): sx(f'input swipe {x} {y} {x} {y} {ms}')

# ---------------------------------------------------------------- fake Wizard Search
STATE = {'translate': [], 'read': 0, 'read_paths': [], 'geometry_reply': None, 'search': [], 'log': []}
class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        STATE['log'].append('GET ' + self.path)
        u = urllib.parse.urlsplit(self.path)
        if u.path == '/wizard-os-home':
            self.send_response(301); self.send_header('Location', '/wizard-os-home/'); self.send_header('Content-Length', '0'); self.end_headers(); return
        m = re.match(r'^/wizard-os-home/(.*)$', u.path)
        if m and not m.group(1).startswith('api/'):
            f = m.group(1) or 'index.html'; p = (WEB / f).resolve()
            if f in ('data.js', 'summaries.js') or not str(p).startswith(str(WEB.resolve())) or not p.is_file():
                b = b''; ct = 'application/javascript' if f.endswith('.js') else 'text/plain'
                self.send_response(200 if f.endswith('.js') else 404)
            else:
                b = p.read_bytes(); self.send_response(200)
                ct = {'css': 'text/css', 'html': 'text/html; charset=utf-8', 'png': 'image/png', 'svg': 'image/svg+xml', 'webmanifest': 'application/manifest+json', 'js': 'application/javascript', 'json': 'application/json'}.get(f.rsplit('.', 1)[-1], 'application/octet-stream')
            self.send_header('Content-Type', ct); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b); return
        if u.path == '/wizard/hermes/api/sessions': return self._json(200, {'data': [], 'has_more': False})
        if u.path.startswith('/wizard-search'):
            q = urllib.parse.parse_qs(u.query).get('q', [''])[0]; STATE['search'].append(q)
            b = ('<!doctype html><meta name=viewport content="width=device-width"><body style="background:#111;color:#eee;font:16px sans-serif">'
                 '<h3>Wizard Search (QA)</h3><p id=q>' + q.replace('<', '&lt;') + '</p></body>').encode()
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b); return
        self._json(404, {'error': 'nope'})
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n) if n else b''
        STATE['log'].append('POST ' + self.path)
        if self.path == '/wizard-search/api/translate':
            j = json.loads(body); items = j.get('items', []); to = j.get('to', 'English'); STATE['translate'].append(items)
            STATE.setdefault('to', []).append(to)
            thai = [bool(re.search('[\u0E00-\u0E7F]', str(i))) for i in items]
            foreign = thai if to == 'English' else [True] * len(items)
            return self._json(200, {'to': to, 'from': 'Thai' if any(thai) else '', 'ms': 5,
                                    'items': [('EN(' if to == 'English' else to[:2].upper() + '(') + str(i) + ')' if f else str(i) for i, f in zip(items, foreign)],
                                    'langs': ['Thai' if t else 'English' for t in thai], 'foreign': foreign})
        if self.path.split('?')[0] == '/wizard-search/api/read-image':
            STATE['read'] += 1; STATE['read_paths'].append(self.path)
            if STATE['geometry_reply'] and 'geometry=1' in self.path:  # synthetic fixture with boxes, not inference
                return self._json(200, STATE['geometry_reply'])
            return self._json(200, {'lines': ['CLOSED ON MONDAY', 'ปิดวันจันทร์'], 'model': 'qa', 'ms': 5, 'fixture': 'synthetic lines-only'})
        self._json(404, {'error': 'nope'})
srv = http.server.ThreadingHTTPServer(('127.0.0.1', FAKE), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()

# ---------------------------------------------------------------- CDP (raw websocket)
class Page:
    def __init__(self, match, sock=None):
        if sock is None: sock = 'webview_devtools_remote_' + sx(f'pidof {PKG}').strip()
        sh(ADB, '-s', S, 'forward', f'tcp:{DEVTOOLS}', f'localabstract:{sock}')
        page = None
        for _ in range(40):
            try:
                l = json.load(urllib.request.urlopen(f'http://127.0.0.1:{DEVTOOLS}/json/list', timeout=3))
                page = next((x for x in l if x.get('type') == 'page' and match in x.get('url', '')), None)
            except Exception: pass
            if page: break
            time.sleep(0.7)
        if not page: raise RuntimeError('no page ' + match)
        self.id = 0
        u = page['webSocketDebuggerUrl']; host, path = re.match(r'ws://([^/]+)(/.*)', u).groups()
        h, p = host.split(':'); self.s = socket.create_connection((h, int(p)), timeout=20)
        self.s.sendall(f'GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode())
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
    def ev(self, expr):
        self.id += 1; my = self.id; self._send({'id': my, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'awaitPromise': True, 'returnByValue': True}})
        while True:
            d = self._recv()
            if d.get('id') == my:
                rr = d.get('result', {})
                if rr.get('exceptionDetails'): raise RuntimeError(json.dumps(rr['exceptionDetails'])[:300])
                return rr.get('result', {}).get('value')
    def close(self):
        try: self.s.close()
        except Exception: pass

def screen_page():
    err = RuntimeError('no screen page')
    for _ in range(3):
        try: return Page('screen.html')
        except Exception as e: err = e; time.sleep(1.5)
    raise err
def peek(sp): return sp.ev('S.peek()')
def wait_peek(sp, fn, secs=10):
    t0 = time.time(); p = None
    while time.time() - t0 < secs:
        p = peek(sp)
        if fn(p): return p
        time.sleep(0.5)
    return p

TEST_HTML = """<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{font:20px sans-serif;margin:24px;background:#fff;color:#111;-webkit-user-select:none;user-select:none}p{margin:18px 0}</style>
<body oncopy="return false" oncontextmenu="return false">
<h2>Menu</h2><p id=a>ผัดกะเพราหมูสับไข่ดาว</p><p id=b>ส่งฟรีเมื่อสั่งครบ 200 บาท</p><p id=c>Order number 4471 ready at counter</p>
</body>"""
PIC_HTML = """<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body style="margin:0;background:#222">
<canvas id=c width=360 height=640 style="width:100vw;height:100vh"></canvas><script>const x=c.getContext('2d');x.fillStyle='#fff';x.font='bold 34px sans-serif';
x.fillText('CLOSED ON MONDAY',20,200);x.fillText('ปิดวันจันทร์',20,260);</script></body>"""
def chrome(html):
    sh(ADB, '-s', S, 'shell', 'am start -W -n com.android.chrome/com.google.android.apps.chrome.Main -a android.intent.action.VIEW -d '
       + shlex.quote('data:text/html;charset=utf-8,' + urllib.parse.quote(html)))
    time.sleep(4)
    for _ in range(4):
        if not tap_text(r'^(No thanks|No Thanks|Use without an account|Accept & continue|Got it|Continue)$'): break
        time.sleep(1.5)

# The shell the QA build opens: files/qa_home.txt holds an origin (AppState.isQaOrigin), and AppState.homeUrl loads
# that origin + "/wizard-os-home/". Selecting the page by that exact URL, not a loose substring.
QA_HOME = f'http://localhost:{FAKE}'
EXPECTED_HOME = QA_HOME + '/wizard-os-home/'
QA_ORIGIN_RE = r'http://(localhost|10\.0\.2\.2):\d{2,5}'
def startup_diagnostics(why):
    # Everything needed to explain a startup failure, kept before the guest is cleaned up.
    d = {'why': why, 'expected_url': EXPECTED_HOME}
    for key, fn in (('device', device_snapshot), ('top', top), ('pidof', lambda: sx(f'pidof {PKG}', check=False).strip()),
                    ('qa_home', lambda: sx(f'run-as {PKG} cat files/qa_home.txt').strip()),
                    ('qa_origin', lambda: sx(f'run-as {PKG} cat files/qa_origin.txt').strip()),
                    ('devtools_sockets', lambda: [l for l in sx('cat /proc/net/unix').split() if 'webview_devtools_remote' in l]),
                    ('fake_server_log', lambda: STATE['log'][-30:]),
                    ('targets', lambda: [{k: t.get(k) for k in ('type', 'url', 'title')} for t in json.load(urllib.request.urlopen(f'http://127.0.0.1:{DEVTOOLS}/json/list', timeout=3))])):
        try: d[key] = fn()
        except Exception as e: d[key] = 'unavailable: ' + repr(e)[:200]
    for name, fn in (('startup-ui.xml', ui), ('startup-logcat.txt', lambda: sx('logcat -d -t 600'))):
        try: (job / name).write_text(fn())
        except Exception as error: d[name + '_error'] = repr(error)
    try: shot('zz-startup')
    except Exception as error: d['screenshot_error'] = repr(error)
    (job / 'startup-diagnostics.json').write_text(json.dumps(d, indent=2, ensure_ascii=False))
    return d
def shell_page():
    # one app process, its DevTools socket, the exact shell page the fake served, then the real native bridge
    require_device()
    pid = ''
    for _ in range(40):
        pid = sx(f'pidof {PKG}', check=False).strip()
        if pid and ' ' not in pid: break
        time.sleep(0.5)
    else:
        startup_diagnostics('no single app process: ' + repr(pid)); raise RuntimeError('no app process for ' + PKG)
    try: pg = Page(EXPECTED_HOME, 'webview_devtools_remote_' + pid)
    except Exception as e:
        startup_diagnostics('no page ' + EXPECTED_HOME + ': ' + repr(e)); raise RuntimeError('no page ' + EXPECTED_HOME) from e
    ready = pg.ev("new Promise(r => { const t0 = Date.now(), t = () => (window.__wos && window.WizardOSNative) || Date.now() - t0 > 20000"
                  " ? r(!!(window.__wos && window.WizardOSNative)) : setTimeout(t, 200); t(); })")
    if not ready:
        startup_diagnostics('shell page without the native bridge (window.WizardOSNative) or __wos'); pg.close()
        raise RuntimeError('shell page not ready: ' + EXPECTED_HOME)
    return pg

def open_menu():
    b = wait_window('WizardEverywhere', True, 10)
    if not b: return None, None
    x, y = mid(b); hold(x, y, 1000)
    return b, wait_window('WizOrbMenu', True, 5)

# ---------------------------------------------------------------- native picture overlay (geometry fixture)
# A canvas-only page (no text layer): the Thai and English lines exist only as pixels. The fixture's boxes are computed
# from where Chrome draws its web content, loose like a model's; the page tightens them to the strokes it finds.
PIC_OVERLAY_HTML = """<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body style="margin:0;background:#fff">
<canvas id=c style="position:fixed;left:0;top:0;width:100vw;height:100vh"></canvas><script>const d=devicePixelRatio,c=document.getElementById('c');
c.width=innerWidth*d;c.height=innerHeight*d;const x=c.getContext('2d');x.scale(d,d);x.fillStyle='#fff';x.fillRect(0,0,innerWidth,innerHeight);
x.fillStyle='#111';x.font='30px sans-serif';x.fillText('ปิดวันจันทร์',24,160);x.fillText('CLOSED ON MONDAY',24,260);</script></body>"""
PIC_LINES = [('ปิดวันจันทร์', (16, 120, 300, 180)), ('CLOSED ON MONDAY', (16, 226, 340, 272))]  # css px in the web content
HIT_JS = (P(__file__).resolve().parent / 'qa-screen-hit.cjs').read_text()
_EXPORT = 'module.exports = { outsideTarget, sheetSettled, hitTarget };'
assert _EXPORT in HIT_JS; HIT_JS = HIT_JS.replace(_EXPORT, '')
def in_page(sp, call): return sp.ev('(() => {\n' + HIT_JS + '\nreturn ' + call + ';\n})()')
def wm(kind):
    out = sx('wm ' + kind)
    return (re.search(r'Override ' + kind + r': (\S+)', out) or re.search(r'Physical ' + kind + r': (\S+)', out)).group(1)
def web_rect():
    best = None
    for m in re.finditer(r'<node [^>]*?>', ui()):
        n = m.group(0)
        if 'class="android.webkit.WebView"' not in n or 'package="com.android.chrome"' not in n: continue
        r = tuple(map(int, re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n).groups()))
        if not best or (r[2] - r[0]) * (r[3] - r[1]) > (best[2] - best[0]) * (best[3] - best[1]): best = r
    return best
def settle(sp, sheet, want, secs=6):
    t0 = time.time()
    while time.time() - t0 < secs:
        if in_page(sp, 'sheetSettled(' + json.dumps([sheet, want]) + ')'): return None
        time.sleep(0.15)
    return f'#{sheet} did not settle {"shown" if want else "hidden"} in {secs}s'
def picture_overlay():
    chrome(PIC_OVERLAY_HTML); shot('pic-overlay-01-chrome')
    w, h = map(int, wm('size').split('x')); dpr = int(wm('density')) / 160
    web = web_rect()
    check('native picture overlay: Chrome web content located for the fixture boxes', web, web)
    if not web: return
    scr = lambda b: [web[0] + b[0] * dpr, web[1] + b[1] * dpr, web[0] + b[2] * dpr, web[1] + b[3] * dpr]
    STATE['geometry_reply'] = {'lines': [t for t, _ in PIC_LINES], 'boxes': [[round(v / (w, h)[i % 2], 4) for i, v in enumerate(scr(b))] for _, b in PIC_LINES],
                               'model': 'qa-fixture', 'ms': 5, 'fixture': 'synthetic geometry computed from the drawn canvas; NOT inference'}
    reads0 = len(STATE['read_paths'])
    try:
        open_menu(); tap_text(r'^Translate screen$'); wait_window('WizScreen', True, 8)
        sp = screen_page()
        try:
            p = wait_peek(sp, lambda p: p and p.get('pictureState') in ('done', 'error') and p.get('nativeState') in ('done', 'error', ''), 20)
            shot('pic-overlay-02-translated')
            paths = STATE['read_paths'][reads0:]
            check('the production native bridge asked read-image with geometry=1', paths and all('geometry=1' in x for x in paths), paths)
            th = next((e for e in p.get('painted', []) if e.get('pic') and e['t'] == 'EN(ปิดวันจันทร์)'), None)
            ex, mg = scr(PIC_LINES[0][1]), 12 * dpr
            at = th and ex[0] - mg <= (th['r'][0] + th['r'][2]) / 2 <= ex[2] + mg and ex[1] - mg <= (th['r'][1] + th['r'][3]) / 2 <= ex[3] + mg
            check('the Thai picture line is painted in English over its own place (in-place overlay)', at, (th, ex))
            check('the English picture line is left as it is', not any('CLOSED' in e['t'] for e in p.get('painted', [])), [e['t'] for e in p.get('painted', [])])
            check('no picture panel opens by itself; the translation bar is shown', not p.get('sheet') and p.get('panel') == 'sel' and p.get('tbar'), (p.get('sheet'), p.get('panel'), p.get('tbar')))
            pill = p.get('pill') or ''
            check('the pill says Thai → English (never English → English), nothing left unplaced', 'Thai' in pill and 'English' in pill and not re.search(r'English\s*→', pill) and 'not placed' not in pill, pill)
            if not th: raise RuntimeError('nothing painted for the picture line; interactive checks cannot run')
            pdpr, win = sp.ev('devicePixelRatio'), window('WizScreen')
            paint_hidden = "getComputedStyle(document.getElementById('paint')).display === 'none'"
            sx(f"input tap {p['btn']['orig'][0]} {p['btn']['orig'][1]}"); time.sleep(0.8)
            q, hidden = peek(sp), sp.ev(paint_hidden); shot('pic-overlay-03-original')
            check('Original shows the untouched picture (overlay hidden)', q.get('showOrig') and hidden, (q.get('showOrig'), hidden))
            sx(f"input tap {p['btn']['orig'][0]} {p['btn']['orig'][1]}"); time.sleep(0.8)
            check('Translated brings the overlay back', not peek(sp).get('showOrig') and not sp.ev(paint_hidden))
            # pick, then a hit-tested outside tap on the touch layer (clear of sheets, chrome and paint)
            sx(f"input tap {th['c'][0]} {th['c'][1]}")
            err = settle(sp, 'sheet', True); q = peek(sp); shot('pic-overlay-04-picked')
            check('tapping the painted line shows its Thai and its English', not err and q.get('sheet') and 'ปิดวันจันทร์' in q.get('sheetText', '') and 'EN(' in q.get('sheetText', ''), (err, q.get('sheetText', '')[:120]))
            o = in_page(sp, 'outsideTarget()'); pt = o.get('point')
            if pt: sx(f"input tap {round(win[0] + pt['x'] * pdpr)} {round(win[1] + pt['y'] * pdpr)}")
            err = settle(sp, 'sheet', False) or settle(sp, 'tbar', True) if pt else 'no clear outside point'
            q = peek(sp); shot('pic-overlay-05-dismissed')
            check('a real outside tap (hit-tested on the touch layer) dismisses the sheet; the overlay stays',
                  pt and o.get('hit') == 'layer' and not err and not q.get('sheet') and q.get('tbar') and any(e.get('pic') for e in q.get('painted', [])), (pt, o.get('hit'), err))
            c = in_page(sp, "hitTarget('tCopy')")
            if c.get('ok'): sx(f"input tap {round(win[0] + c['x'] * pdpr)} {round(win[1] + c['y'] * pdpr)}")
            cl = wait_log('screen copied chars=' + str(len('EN(ปิดวันจันทร์)')), 4)
            check('Copy translation (hit-tested) copies the picture line’s English', c.get('ok') and cl, (c, cl))
            # Back steps off the pick first, then closes Screen mode; the app underneath stays
            sx(f"input tap {th['c'][0]} {th['c'][1]}"); err = settle(sp, 'sheet', True)
            sx('input keyevent KEYCODE_BACK'); err = err or settle(sp, 'sheet', False); q = peek(sp)
            check('Back steps off the picked line first; Screen mode and the overlay stay', not err and window('WizScreen') and any(e.get('pic') for e in q.get('painted', [])), err)
        finally: sp.close()
        for i in range(4):
            if not window('WizScreen'): break
            sx('input keyevent KEYCODE_BACK'); time.sleep(1)
        check('then Back closes Screen mode, Chrome still in front', not window('WizScreen') and 'chrome' in top(), top())
    finally:
        STATE['geometry_reply'] = None

def picture_scene():
    """The native picture overlay scene; a failure is a failed check and Screen mode is closed, so later cases run."""
    try: picture_overlay()
    except Exception as e:
        check('native picture overlay scene ran to the end', False, repr(e)); shot('pic-overlay-error')
        for _ in range(4):
            if not window('WizScreen'): break
            sx('input keyevent KEYCODE_BACK'); time.sleep(1)

em = EM_ARGV = None; FREE = None
COMPLETED, INTERRUPTED = False, None
def _interrupted(signum, frame):
    """The controller's timeout or cancel (SIGTERM/SIGINT): leave through the finally below, which removes this run's
    emulator, forwards and fixture server and writes an incomplete (never ok) receipt. Cleanup itself is not
    interrupted again."""
    global INTERRUPTED
    for sig in (signal.SIGTERM, signal.SIGINT): signal.signal(sig, signal.SIG_IGN)
    INTERRUPTED = signal.Signals(signum).name
    raise SystemExit(128 + signum)
for _sig in (signal.SIGTERM, signal.SIGINT): signal.signal(_sig, _interrupted)
# Reuse the durable worker lease instead of blocking on our own ancestor's lock. On forum only the inherited canonical
# lease is accepted: same inode as the canonical lock AND an exclusive FLOCK held on that very descriptor. No fallback.
_inherited = os.environ.get('WIZARD_HEAVY_LOCK_FD')
if FORUM and not _inherited: raise SystemExit('forum requires the inherited canonical worker lease (WIZARD_HEAVY_LOCK_FD)')
_lockfile = os.fdopen(int(_inherited), 'a', closefd=False) if _inherited else LOCK_PATH.open('a')
with _lockfile as lock:
    if _inherited:
        _want, _have = LOCK_PATH.stat(), os.fstat(lock.fileno())
        if (_want.st_dev, _want.st_ino) != (_have.st_dev, _have.st_ino): raise SystemExit('inherited lock identity mismatch')
        if FORUM and not any(l.startswith('lock:') and 'FLOCK' in l and 'WRITE' in l
                             for l in P(f'/proc/self/fdinfo/{lock.fileno()}').read_text().splitlines()):
            raise SystemExit('inherited canonical lease is not held')
    fcntl.flock(lock, fcntl.LOCK_EX | (fcntl.LOCK_NB if _inherited else 0))
    try:
        if FORUM:
            FREE = shutil.disk_usage(BASE).free
            if FREE < RESERVE + GUEST: raise SystemExit(f'disk reserve: {FREE} free < 200 GiB reserve + 20 GiB guest')
        PORT = choose_emulator_port(sh(ADB, 'devices')); S = f'emulator-{PORT}'  # never a fixed, non-recommended port
        if S in sh(ADB, 'devices'): raise SystemExit(S + ' is already running; not ours to reuse or kill')
        sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'q', '-k', 'system-images;android-35;google_apis;' + ABI, '-d', 'pixel_7', '-p', job / 'dev', stdin='no\n')
        EM_ARGV = [str(SDK / 'emulator/emulator'), '-avd', 'q', '-port', str(PORT), '-no-window', '-no-snapshot', '-no-audio', *EMULATOR_GRAPHICS] + (['-accel', 'on'] if FORUM else [])
        em = subprocess.Popen(EM_ARGV,
                              env=env, stdout=open(job / 'em.log', 'w'), stderr=subprocess.STDOUT, start_new_session=True)
        for _ in range(120):
            if em.poll() is not None: raise RuntimeError('emulator exited before boot: ' + json.dumps(emulator_exit(em, EM_ARGV)))
            if sx('getprop sys.boot_completed', check=False, timeout=8).strip() == '1': break
            time.sleep(3)
        else: raise RuntimeError('emulator boot timeout')
        require_device()
        check('fresh API35 google_apis ' + ABI + ' guest', sx('getprop ro.build.version.sdk').strip() == '35' and ABI in sx('getprop ro.product.cpu.abi'), sx('getprop ro.product.cpu.abi').strip())
        time.sleep(10)
        for k in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'): sx(f'settings put global {k} 0')
        sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard')
        out = sh(ADB, '-s', S, 'install', '-r', apk, timeout=120).strip().splitlines()[-1]
        check('QA build installs', out == 'Success', out + ' ' + (re.search(r'versionName=\S+', sx(f'dumpsys package {PKG}')) or [''])[0])
        sx(f'run-as {PKG} mkdir -p files'); sx(f"run-as {PKG} sh -c 'echo http://10.0.2.2:{FAKE} > files/qa_origin.txt; echo {QA_HOME} > files/qa_home.txt'")
        sh(ADB, '-s', S, 'reverse', f'tcp:{FAKE}', f'tcp:{FAKE}')
        sx(f'pm grant {PKG} android.permission.RECORD_AUDIO'); sx(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
        sx(f'appops set {PKG} SYSTEM_ALERT_WINDOW allow'); sx(f'appops set {PKG} ACCESS_RESTRICTED_SETTINGS allow')
        sx(f'settings put secure enabled_accessibility_services {PKG}/ai.wizards.os.everywhere.WizardKeyboardService'); sx('settings put secure accessibility_enabled 1')
        sx('logcat -c')
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(9)
        pg = shell_page()
        # Fresh-install coaching captures outside taps, so finish it before exercising the real orb.
        pg.ev("(() => { localStorage.setItem('wos.tour.v1', 'true'); window.WosTour?.finish('qa'); return true; })()")
        pg.ev("window.WizardOSNative.setEverywhere(true)"); time.sleep(2)
        st = json.loads(pg.ev("window.WizardOSNative.everywhere()"))
        check('Everywhere on (overlay + accessibility), status says hold is available', st.get('enabled') and st.get('overlay') and st.get('keyboard') and st.get('hold'), st)
        for _ in range(3):
            if not re.search('Turn on voice typing', ui()): break
            sx('input keyevent KEYCODE_BACK'); time.sleep(1)
        pg.ev("document.querySelector('.gear') && document.querySelector('.gear').click()"); time.sleep(1.2)
        row = pg.ev("(() => { const r = document.querySelector('[data-st=everywhere]'); return r ? r.innerText.replace(/\\s+/g,' ') : null; })()")
        # The Settings copy is web (served live from Wizard, not from this APK): checked after the merge instead.
        print('  settings row (live web):', row)
        pg.close()

        if PICTURE_ONLY:
            # proportional lane: the same real set-up above, then only the picture overlay scene (crashes + cleanup below)
            picture_scene()
        else:
            # ---------------- hold → menu, over a page whose text cannot be copied
            chrome(TEST_HTML); shot('01-chrome-no-copy')
            b0 = wait_window('WizardEverywhere', True, 10)
            check('the orb floats over Chrome', b0, b0)
            b, m = open_menu(); shot('02-menu')
            x = ui()
            rows = [r for r in ('Select text', 'Translate screen', 'Hide orb') if re.search('text="' + r, x)]
            check('holding the orb opens a menu: Select text · Translate screen · Hide orb', m and len(rows) == 3, (m, rows))
            check('holding neither moved the orb nor started a recording', bubble() == b and not logs('listening'), (b, bubble(), logs('listening')))
            sx('input keyevent KEYCODE_BACK'); time.sleep(1)
            check('Back closes the menu (one layer) and Chrome stays in front', not wait_window('WizOrbMenu', False, 4) and 'chrome' in top(), (window('WizOrbMenu'), top()))
            b, m = open_menu()
            sx('input tap 60 1500'); time.sleep(1)
            check('a touch outside closes the menu', m and not wait_window('WizOrbMenu', False, 4), (m, window('WizOrbMenu')))
            check('Chrome is still in front after closing the menu', 'chrome' in top(), top())

            # ---------------- Select text
            b, m = open_menu()
            tap_text(r'^Select text$'); time.sleep(0.5)
            w = wait_window('WizScreen', True, 8); shot('03-screen-select')
            check('Select text opens Screen mode over the whole screen', w, w)
            check('the orb steps out of the picture while Screen mode is up', not bubble(), bubble())
            sp = screen_page()
            p = wait_peek(sp, lambda p: p and p.get('words'), 8)
            words = ''.join(w['t'] for w in (p or {}).get('words', []))
            want = ['ผัดกะเพรา', 'ส่งฟรี', 'Order', 'number', '4471', 'counter']
            check('every word of the copy-blocked page is selectable', all(t2 in words for t2 in want), [w['t'] for w in (p or {}).get('words', [])][:24])
            check('the frozen screen picture is behind the text', p and p.get('shot'), p and p.get('shot'))
            print('  ', logs('char positions'))
            def wd(p, t): return next((w for w in p['words'] if w['t'] == t), None)
            def wd_has(p, t): return next((w for w in p['words'] if t in w['t']), None)
            print('  words:', [w['t'] for w in p['words']][:30], 'exact blocks:', p.get('exact'), 'of', p.get('blocks'))
            check('no boxes are drawn around the text (Google style)', p.get('boxes') == 0 and p.get('hl') == 0, (p.get('boxes'), p.get('hl')))
            print('  blocks with exact character positions:', p.get('exact'), 'of', p.get('blocks'))
            # a drag inside one line selects just the words it crossed (Google's free selection)
            w1, w2 = wd(p, 'number'), wd(p, 'ready')
            check('the page’s words are individually selectable', w1 and w2, [w['t'] for w in p['words']][:20])
            sx(f"input swipe {w1['l'] + 4} {w1['y']} {w2['r'] - 4} {w2['y']} 700"); time.sleep(0.8)
            p = peek(sp); shot('04-drag-select')
            check('a finger drag from “number” to “ready” selects exactly “number 4471 ready”', p['selText'] == 'number 4471 ready', p['selText'])
            check('the selection is highlighted with two handles and the action sheet shows it', p['hl'] >= 1 and all(p['handles']) and p['sheet'] and 'number 4471 ready' in p['sheetText'], (p['hl'], p['handles'], p['sheetText'][:60]))
            # drag the end handle onto the next line
            h = p['handles'][1]; ctr = wd(p, 'counter')
            sx(f"input swipe {h[0]} {h[1]} {ctr['r'] - 4} {ctr['y'] + 70} 700"); time.sleep(0.8)
            p = peek(sp)
            check('dragging the end handle extends the selection to “counter”', p['selText'] == 'number 4471 ready at counter', p['selText'])
            sx(f"input tap {p['btn']['aCopy'][0]} {p['btn']['aCopy'][1]}"); time.sleep(0.8)
            cl = wait_log('screen copied chars=', 4)
            check('Copy copies exactly the selection (text the page blocks from copying)', cl and 'chars=28' in cl, cl)
            # a drag across two lines from the Thai dish down into the delivery line
            th, baht = wd_has(p, 'ผัด'), wd(p, '200')
            sx(f"input swipe {th['l'] + 6} {th['y']} {baht['r'] - 4} {baht['y']} 900"); time.sleep(0.8)
            p = peek(sp); shot('05-drag-two-lines')
            check('a drag across lines selects from the start word to the end word', p['selText'].startswith('ผัด') and p['selText'].endswith('200') and '\n' in p['selText'], p['selText'])
            sx(f"input tap {p['btn']['aTrans'][0]} {p['btn']['aTrans'][1]}")
            p = wait_peek(sp, lambda p: p.get('trans') and p['trans'].get('text'), 8); shot('06-translated-selection')
            check('Translate turns the selection into English (Wizard Search)', p.get('trans') and 'EN(' in (p['trans'].get('text') or ''), (p.get('trans'), STATE['translate'][-1:]))
            sx(f"input tap {p['btn']['aSearch'][0]} {p['btn']['aSearch'][1]}")
            p = wait_peek(sp, lambda p: p.get('searching'), 6); time.sleep(2.5); shot('07-search-sheet')
            check('Search opens Wizard Search for the selection in a sheet', p.get('searching') and STATE['search'] and 'ผัด' in STATE['search'][-1], STATE['search'][-1:] if STATE['search'] else None)
            sx('input keyevent KEYCODE_BACK'); time.sleep(1)
            p = peek(sp)
            check('Back closes the search sheet first, Screen mode stays', not p.get('searching') and window('WizScreen'), (p.get('searching'), window('WizScreen')))
            # a tap on a word picks its whole line; a tap on nothing clears
            o = wd(p, 'Order')
            sx(f"input tap {o['x']} {o['y']}"); time.sleep(0.8); p = peek(sp)
            check('a tap on text picks that whole line', p['selText'] == 'Order number 4471 ready at counter', p['selText'])
            for i in range(5):
                if not window('WizScreen'): break
                sx('input keyevent KEYCODE_BACK'); time.sleep(1)
            check('more Backs step out of the selection, then out of Screen mode', not window('WizScreen'), i)
            check('… and never leave the app underneath (Chrome still in front)', 'chrome' in top(), top())
            check('the orb comes back when Screen mode closes', wait_window('WizardEverywhere', True, 6), bubble())
            sp.close()

            # ---------------- Translate screen (Google Lens style)
            b, m = open_menu()
            tap_text(r'^Translate screen$'); time.sleep(0.5)
            wait_window('WizScreen', True, 8)
            sp = screen_page()
            # the app text and the picture are read in parallel: wait for both before judging the pill
            p = wait_peek(sp, lambda p: p and p.get('painted') and p.get('nativeState') == 'done' and p.get('pictureState') == 'done', 10); shot('08-translate-screen')
            painted = [e['t'] for e in (p or {}).get('painted', [])]
            check('Translate screen detects the foreign text and paints English over it by itself', len(painted) == 2 and all(t.startswith('EN(') for t in painted), painted)
            check('English text on the page is left as it is', not any('Order number' in t for t in painted), painted)
            check('the pill names the detected language: Thai → English', p.get('pill') and 'Thai' in p['pill'] and 'English' in p['pill'], p.get('pill'))
            sent = STATE['translate'][-1] if STATE['translate'] else []
            check('… text only: toolbar icon labels and the address bar are never sent', sent and not any(t in sent for t in ('New tab', 'Switch or close tabs', 'Customize and control Google Chrome')) and not any(t.startswith('data:') for t in sent), sent[:8])
            # tap a translation → the sheet shows original + English
            e0 = next(e for e in p['painted'] if 'ผัด' in e['t'])
            sx(f"input tap {e0['c'][0]} {e0['c'][1]}"); time.sleep(0.8); p = peek(sp); shot('09-translate-tap')
            check('tapping a translation shows the original and the English in the sheet', p['sheet'] and 'ผัด' in p['sheetText'] and 'EN(' in p['sheetText'], p['sheetText'][:120])
            sx('input keyevent KEYCODE_BACK'); time.sleep(0.8)
            # the pill → language list → Japanese
            p = peek(sp)
            sx(f"input tap {p['btn']['pill'][0]} {p['btn']['pill'][1]}"); time.sleep(0.8); p = peek(sp)
            jp = (p.get('langBtn') or {}).get('Japanese')
            check('the language pill opens a list of languages', p.get('langsOpen') and jp, list((p.get('langBtn') or {}).keys())[:6])
            if jp:
                sx(f"input tap {jp[0]} {jp[1]}")
                p = wait_peek(sp, lambda p: p.get('to') == 'Japanese' and p.get('painted') and p['painted'][0]['t'].startswith('JA('), 8); shot('10-japanese')
                check('picking Japanese translates the screen into Japanese', p.get('to') == 'Japanese' and STATE['to'][-1] == 'Japanese', (p.get('to'), [e['t'] for e in p.get('painted', [])][:3]))
                sx(f"input tap {p['btn']['pill'][0]} {p['btn']['pill'][1]}"); time.sleep(0.8); p = peek(sp)
                en = p['langBtn']['English']; sx(f"input tap {en[0]} {en[1]}")
                p = wait_peek(sp, lambda p: p.get('to') == 'English' and p.get('painted') and p['painted'][0]['t'].startswith('EN('), 8)
            # Ask Wizard from the whole translated screen
            sx(f"input tap {p['btn']['tAsk'][0]} {p['btn']['tAsk'][1]}"); time.sleep(4)
            ask = wait_log('screen ask staged', 5); shot('11-ask-wizard')
            check('Ask Wizard opens WizardOS with the text (and the screen picture)', ask and 'shot=' in ask and PKG in top(), (ask, top()))
            sp.close()
            try:
                pg = Page('wizard-os-home')
                sheet = None
                for _ in range(10):
                    sheet = pg.ev("(() => { const t = document.querySelector('.dv-quote'); const img = document.querySelectorAll('.dv-items .ch-att').length; return t ? {text: t.textContent, items: img} : null; })()")
                    if sheet: break
                    time.sleep(0.6)
                check('the WizardOS share sheet holds the original text, its English and the screen picture', sheet and 'ผัด' in sheet['text'] and 'English:' in sheet['text'] and 'EN(' in sheet['text'] and sheet['items'] == 1, sheet)
                sx('input keyevent KEYCODE_BACK'); time.sleep(1)
                pg.close()
            except Exception as e:
                check('the WizardOS share sheet holds the selected text', False, e)

            # ---------------- a picture with no text layer
            chrome(PIC_HTML)
            b, m = open_menu()
            tap_text(r'^Select text$'); wait_window('WizScreen', True, 8)
            sp = screen_page()
            p = wait_peek(sp, lambda p: isinstance(p.get('pic'), list) and p['pic'], 12); shot('09-picture-text')
            check('a screen that is only a picture gets read automatically (Read picture text)', isinstance(p.get('pic'), list) and 'CLOSED ON MONDAY' in p['pic'] and STATE['read'] >= 1, (p.get('pic'), STATE['read']))
            for i in range(4):
                if not window('WizScreen'): break
                sx('input keyevent KEYCODE_BACK'); time.sleep(1)
            check('Back out of it, still in Chrome', not window('WizScreen') and 'chrome' in top(), (i, top()))
            sp.close()

            # ---------------- Translate screen over a picture: English painted in place (geometry fixture, real bridge)
            picture_scene()

            # ---------------- Hide orb (from a known app in front: Chrome)
            chrome(TEST_HTML)
            b, m = open_menu()
            tap_text(r'^Hide orb$'); time.sleep(1.5); shot('10-hidden')
            check('Hide orb removes the orb from the screen', not wait_window('WizardEverywhere', False, 4), (bubble(), top()))
            sx('input keyevent KEYCODE_HOME'); time.sleep(2)
            check('it stays hidden on the launcher', not bubble(), (bubble(), logs('orb menu|unhidden|bubble ')))
            sx('am start -W -a android.intent.action.DIAL'); time.sleep(2.5)
            check('… and over other apps (dialer)', not bubble(), (bubble(), top()))
            sx('input keyevent KEYCODE_HOME'); time.sleep(1.5)
            sx('cmd statusbar expand-notifications'); time.sleep(2); x = ui(); shot('11-shade-hidden')
            check('a "Floating orb hidden" notification is there', 'Floating orb hidden' in x, re.findall(r'text="([^"]+)"', x)[:14])
            tap_text(r'^Floating orb hidden$', x); time.sleep(2); sx('cmd statusbar collapse'); time.sleep(1)
            check('tapping the notification brings the orb back', wait_window('WizardEverywhere', True, 6), bubble())
            b, m = open_menu(); tap_text(r'^Hide orb$'); time.sleep(1.5)
            check('hidden again', not wait_window('WizardEverywhere', False, 4), bubble())
            sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(4)
            sx('input keyevent KEYCODE_HOME'); time.sleep(2)
            check('opening WizardOS brings the orb back too', wait_window('WizardEverywhere', True, 6), bubble())

            # ---------------- without Accessibility: Select text opens the setup
            sx('settings put secure enabled_accessibility_services ""'); time.sleep(3)
            b, m = open_menu(); tap_text(r'^Select text$'); time.sleep(3); shot('12-no-a11y')
            x = ui()
            check('without Accessibility, Select text opens WizardOS on the one-step setup', PKG in top() and re.search('voice typing|Accessibility', x, re.I), (top(), re.findall(r'text="([^"]+)"', x)[:8]))

        crashed = sx('logcat -d -b crash')
        # Only WizardOS counts: a uiautomator dump racing the emulator ("FATAL EXCEPTION: UiAutomation") is the harness.
        mine = [b for b in crashed.split('FATAL EXCEPTION')[1:] if 'UiAutomation' not in b.split('\n', 1)[0]]
        pids = sx(f'pidof {PKG}', check=False).split()
        check('no WizardOS crashes', not mine and f'Process: {PKG}' not in crashed, (crashed[:400], pids))
        COMPLETED = True  # the whole selected flow ran; only now can the receipt be ok
    except Exception as e:
        import traceback; traceback.print_exc()
        check('script ran to the end', False, repr(e))
        startup_diagnostics('harness exception: ' + repr(e))
    finally:
        # only what this run created: its CDP forward, its reverse, its emulator (own session), its fixture server
        EM_EXIT = emulator_exit(em, EM_ARGV)  # before our own kill, so a host crash (e.g. -11 SIGSEGV) stays visible
        if em:
            # Best effort ADB cleanup must not skip killing this run's actual emulator process or the receipt.
            for args in [('forward', '--remove', f'tcp:{DEVTOOLS}'), ('reverse', '--remove', f'tcp:{FAKE}'), ('emu', 'kill')]:
                try: sh(ADB, '-s', S, *args, check=False, timeout=8)
                except (OSError, subprocess.TimeoutExpired): pass  # exact error retained in commands.jsonl
            try: em.wait(40)
            except subprocess.TimeoutExpired:
                os.killpg(em.pid, signal.SIGTERM)
                try: em.wait(20)
                except subprocess.TimeoutExpired: os.killpg(em.pid, signal.SIGKILL); em.wait(10)
            devices = None
            for _ in range(30):
                try:
                    devices = sh(ADB, 'devices', timeout=8)
                    if S not in devices: break
                except (OSError, RuntimeError, subprocess.TimeoutExpired): devices = None
                time.sleep(1)
            gone = devices is not None and S not in devices and em.poll() is not None
            check('owned emulator serial is gone', gone)
            if gone:
                for d in (job / 'dev', job / 'avd'): shutil.rmtree(d, ignore_errors=True)  # guest disk, not evidence
        srv.shutdown(); srv.server_close()
        (job / 'receipt.json').write_text(json.dumps({
            'ok': COMPLETED and bool(res) and all(res), 'completed': COMPLETED, 'interrupted': INTERRUPTED,
            'passed': sum(res), 'total': len(res), 'checks': CHECKS,
            'mode': 'picture-only' if PICTURE_ONLY else 'full', 'host': os.uname().nodename, 'abi': ABI,
            'serial': S, 'emulator_before_cleanup': EM_EXIT, 'console_port': PORT, 'adb_port': PORT + 1 if PORT else None, 'inherited_lease': bool(_inherited),
            'free_bytes_before_boot': FREE, 'apk_sha256': hashlib.sha256(apk.read_bytes()).hexdigest(), 'package': PKG,
            'read_image_paths': STATE['read_paths'],
            'command_log': str(job / 'commands.jsonl'), 'device_ready': str(job / 'device-ready.json'),
            'search': 'synthetic HTTP fixtures served by this script (lines-only and one geometry fixture); NOT live inference',
            'physical_device': False, 'published': False}, indent=2, ensure_ascii=False))
print(f'{sum(res)}/{len(res)} passed · {job}')
if not COMPLETED or not res or not all(res): sys.exit(1)
