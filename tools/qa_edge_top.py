#!/usr/bin/env python3
"""Status bar + camera edge (runs on Thales). usage: qa_edge_top.py APK PKG WEBDIR

James (10 Oct 2026): (1) the Wizard OS background stopped below the status bar; Telegram keeps its background
all the way up. (2) Full screen went under the camera and the thread title sat behind it. Now the page draws
under the status bar (content below it) and full screen keeps the background under the camera, content below.
A fake Wizard on the emulator host serves this branch's web/ and stubs every API.
"""
import fcntl, http.server, json, os, pathlib, re, socket, subprocess, sys, threading, time, uuid, mimetypes
import urllib.request
from qa_paths import work_root
from qa_paths import android_sdk, java_home
P = pathlib.Path
BASE = P(str(work_root() / 'AndroidBuilds')); SDK = android_sdk()
apk = P(sys.argv[1]); PKG = sys.argv[2]; WEB = P(sys.argv[3])
job = BASE / 'qa' / ('wos-edge-top-' + uuid.uuid4().hex[:8]); job.mkdir(parents=True)
OUT = job / 'shots'; OUT.mkdir()
env = os.environ.copy(); env.update(JAVA_HOME=java_home(),
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:' + env['PATH']; (job / 'avd').mkdir()
ADB = str(SDK / 'platform-tools/adb'); PORT = 5696; S = f'emulator-{PORT}'; DEVTOOLS = 9347; FAKE = 18781
res = []
def check(n, ok, d=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n + (' — ' + str(d) if d else ''), flush=True)
def sh(*a, stdin=None, binary=False):
    r = subprocess.run([str(x) for x in a], env=env, capture_output=True, input=stdin, text=not binary)
    return r.stdout
def sx(c): return sh(ADB, '-s', S, 'shell', c)
def top(): return next((l.strip() for l in sx('dumpsys activity activities').splitlines() if 'topResumedActivity' in l), '')
def shot(name): (OUT / (name + '.png')).write_bytes(sh(ADB, '-s', S, 'exec-out', 'screencap', '-p', binary=True))
NOW = time.time()
THREADS = [{'id': 'qa-%d' % i, 'title': 'QA thread %d' % (i + 1), 'source': 'api_server', 'model': 'qa', 'message_count': 2,
            'preview': 'Preview line', 'last_active': NOW - i * 600, 'started_at': NOW - i * 600 - 60} for i in range(12)]
class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body, ct):
        self.send_response(code); self.send_header('Content-Type', ct); self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(body)
    def _json(self, code, obj): self._send(code, json.dumps(obj).encode(), 'application/json')
    def do_HEAD(self): self.do_GET()
    def do_GET(self):
        path = self.path.split('?')[0]
        if path.startswith('/wizard-os-home/') and '/api/' not in path:
            f = path[len('/wizard-os-home/'):] or 'index.html'
            p = WEB / f
            if p.is_file():
                ct = mimetypes.guess_type(str(p))[0] or 'application/octet-stream'
                if f.endswith('.js'): ct = 'application/javascript'
                return self._send(200, p.read_bytes(), ct)
            if f.endswith('.js'): return self._send(200, b'', 'application/javascript')
        if path.endswith('/hermes/api/sessions'): return self._json(200, {'data': THREADS, 'has_more': False})
        if path.endswith('/wizard/thread-seen'): return self._json(200, {'state': {'initializedAt': int(NOW * 1000), 'threads': {}}})
        return self._json(200, {})
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); self.rfile.read(n) if n else b''
        if self.path.endswith('/wizard/thread-seen'): return self._json(200, {'state': {'initializedAt': int(NOW * 1000), 'threads': {}}})
        return self._json(200, {})
srv = http.server.ThreadingHTTPServer(('127.0.0.1', FAKE), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()

class Page:
    """Raw CDP to the app's WebView; every Wizard write from the WebView is failed (never reaches Wizard).
    Page(sock='chrome_devtools_remote', match='data:', fetch=False) drives Chrome instead (the editor test)."""
    def __init__(self, sock=None, match='wizard-os-home', fetch=True):
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
        if not page:
            print('DIAG top:', top()); print('DIAG pages:', l if 'l' in dir() else None)
            print('DIAG log:', sx("logcat -d | grep -E 'AndroidRuntime|FATAL|WizardOS|chromium' | tail -40"))
            raise RuntimeError('no Wizard OS page')
        self.writes = []; self.id = 0
        u = page['webSocketDebuggerUrl']; host, path = re.match(r'ws://([^/]+)(/.*)', u).groups()
        h, p = host.split(':'); self.s = socket.create_connection((h, int(p)), timeout=20)
        key = 'dGhlIHNhbXBsZSBub25jZQ=='
        self.s.sendall(f'GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode())
        buf = b''
        while b'\r\n\r\n' not in buf: buf += self.s.recv(4096)
        self.buf = buf.split(b'\r\n\r\n', 1)[1]
        if fetch: self.call('Fetch.enable', patterns=[{'urlPattern': '*/hermes/*'}, {'urlPattern': '*/v1/*'}, {'urlPattern': '*/wizard/*'}])
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
            if d.get('method') == 'Fetch.requestPaused':
                r = d['params']['request']
                if r['method'] not in ('GET', 'HEAD'):
                    self.writes.append(r['method'] + ' ' + r['url'])
                    self._send({'id': 900000 + len(self.writes), 'method': 'Fetch.failRequest', 'params': {'requestId': d['params']['requestId'], 'errorReason': 'BlockedByClient'}})
                else:
                    self._send({'id': 800000 + self.id, 'method': 'Fetch.continueRequest', 'params': {'requestId': d['params']['requestId']}})
    def ev(self, expr):
        r = self.call('Runtime.evaluate', expression=expr, awaitPromise=True, returnByValue=True)
        rr = r.get('result', {})
        if rr.get('exceptionDetails'): raise RuntimeError(json.dumps(rr['exceptionDetails'])[:400])
        return rr.get('result', {}).get('value')
    def close(self):
        try: self.s.close()
        except Exception: pass

def wait_shell(pg):
    pg.ev("new Promise(r => { const t = () => window.__wos ? r() : setTimeout(t, 200); t(); })")


J = lambda pg, e: pg.ev('(() => {' + e + '})()')
em = None; pg = None
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'q', '-k', 'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7', '-p', job / 'dev', stdin='no\n')
        em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'q', '-port', str(PORT), '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect'], env=env, stdout=open(job / 'em.log', 'w'), stderr=subprocess.STDOUT)
        for _ in range(120):
            if sx('getprop sys.boot_completed').strip() == '1': break
            time.sleep(3)
        time.sleep(10)
        for k in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'): sx(f'settings put global {k} 0')
        sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard')
        sx('settings put secure immersive_mode_confirmations confirmed')  # Android's one-time full-screen tip would cover the shots
        # A phone with a punch-hole-ish camera notch (James's phone has one).
        ov = [l.split()[-1] for l in sx('cmd overlay list android').splitlines() if 'cutout.emulation' in l]
        pick = next((o for o in ov if o.endswith('.tall')), None) or next((o for o in ov if o.endswith('.corner')), None) or (ov[0] if ov else None)
        if pick: sx(f'cmd overlay enable-exclusive --category {pick}'); time.sleep(4)
        check('setup: emulated camera cutout', bool(pick), f'{pick} of {ov}')
        out = sh(ADB, '-s', S, 'install', '-r', apk).strip().splitlines()[-1]
        ver = re.search(r'versionName=\S+', sx(f'dumpsys package {PKG}')).group(0)
        check('install', out == 'Success', out + ' ' + ver)
        sx(f'run-as {PKG} mkdir -p files'); sx(f"run-as {PKG} sh -c 'echo http://10.0.2.2:{FAKE} > files/qa_home.txt'")
        sx(f'pm grant {PKG} android.permission.RECORD_AUDIO'); sx(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(10)
        pg = Page(fetch=False); wait_shell(pg)
        J(pg, "try { localStorage.setItem('wos.coached','true'); localStorage.setItem('wos.voiceTipSeen','true'); } catch (e) {} document.querySelector('.coach')?.remove(); return 1")
        time.sleep(3)
        g = J(pg, """const cs = getComputedStyle(document.documentElement), gear = document.querySelector('.gear')?.getBoundingClientRect();
            return { natT: parseFloat(cs.getPropertyValue('--nat-t')) || 0, native: +window.WizardOSNative.insetTop(), cut: +window.WizardOSNative.cutoutTop(),
              ih: innerHeight, sh: screen.height, dpr: devicePixelRatio, gearTop: gear ? gear.top : -1, ver: window.WizardOSNative.platform() };""")
        shot('1-home')
        print('DIAG home', g)
        check('native shell reports the status bar height to the page', g['natT'] > 10 and g['natT'] == g['native'], g)
        check('page runs under the status bar (Telegram-style): background reaches the top of the glass', g['ih'] >= g['sh'] - 60, g)
        check('Home content (gear) still starts below the status bar', g['gearTop'] >= g['natT'], g)
        # Full-screen Chats, then a thread: the title sits below the camera, background above it.
        J(pg, "const i = __wos.desks.findIndex(d => d.wins.some(id => __wos.wins[id].app === 'chats')); __wos.goDesk(i, true); return i")
        time.sleep(1.5)
        J(pg, "__wos.setFull(__wos.desks[__wos.idx].focus, true); return 1"); time.sleep(2.5)
        f = J(pg, """const we = document.querySelector('.win.full'), t = we && we.querySelector('.ch-top, .ch-head');
            const cs = getComputedStyle(document.querySelector('#device'));
            return { imm: document.querySelector('#device').classList.contains('immersive'), winTop: we ? we.getBoundingClientRect().top : -1,
              rowTop: t ? t.getBoundingClientRect().top : -1, cutT: parseFloat(cs.getPropertyValue('--cut-t')) || 0, natT: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nat-t')) || 0, ih: innerHeight, sh: screen.height };""")
        shot('2-chats-full'); print('DIAG full', f)
        check('full screen: window (background) starts at the very top edge', f['imm'] and f['winTop'] <= 0.5 and f['ih'] >= f['sh'] - 60, f)
        check('full screen: Chats top row starts below the camera', f['cutT'] > 0 and f['rowTop'] >= f['cutT'] - 0.5, f)
        J(pg, "document.querySelector('.win.full [data-chopen]')?.click(); return 1"); time.sleep(2.5)
        h = J(pg, "const h = document.querySelector('.win.full .ch-head'); return { head: h ? h.getBoundingClientRect().top : -1, cutT: parseFloat(getComputedStyle(document.querySelector('#device')).getPropertyValue('--cut-t')) || 0 }")
        shot('3-thread-full'); print('DIAG thread', h)
        check('full screen thread: title bar sits below the camera', h['head'] >= h['cutT'] - 0.5 and h['cutT'] > 0, h)
        J(pg, "__wos.setFull(__wos.desks[__wos.idx].focus, false); return 1"); time.sleep(2)
        b = J(pg, "return { natT: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nat-t')) || 0, tiles: document.querySelector('.tiles')?.getBoundingClientRect().top }")
        shot('4-back-to-tiles'); print('DIAG tiles', b)
        check('leaving full screen: status bar inset comes back and tiles sit below it', b['natT'] > 10 and b['tiles'] >= b['natT'], b)
        crash = sx(f"logcat -d -b crash | grep -c {PKG}").strip()
        check('no crash', crash in ('', '0'), crash)
    except Exception as e:
        import traceback; traceback.print_exc(); check('run completed', False, repr(e)[:300])
    finally:
        try: pg and pg.close()
        except Exception: pass
        if em: sh(ADB, '-s', S, 'emu', 'kill'); em.wait(40)
print(f'shots: {OUT}')
print(f'{sum(res)}/{len(res)} passed')
sys.exit(0 if res and all(res) else 1)
