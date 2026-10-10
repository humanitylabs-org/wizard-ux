#!/usr/bin/env python3
"""Probe (runs on Thales): which page-side ways of saving a file does the Wizard OS WebView hand to its
DownloadListener (→ Android DownloadManager → Downloads), and which ones navigate the shell away?

usage: probe_webview_download.py QA_APK [OUT_DIR]

A fresh API 35 emulator with dead DNS loads a probe page from a fake origin on this Mac (adb reverse). Each case
runs JS in the app's WebView over DevTools, then records: did the top page stay put, did the download manager fetch
the file (request log + User-Agent), and did a file land in /sdcard/Download.
"""
import fcntl, http.server, json, os, pathlib, re, socket, subprocess, sys, threading, time, uuid, urllib.request, struct, zlib
P = pathlib.Path
BASE = P('/Volumes/ThalesMedia/AndroidBuilds'); SDK = P('/opt/homebrew/share/android-commandlinetools')
APK = P(sys.argv[1]); PKG = 'ai.wizards.os.qa'
job = P(sys.argv[2]) if len(sys.argv) > 2 else BASE / 'qa' / ('wos-dlprobe-' + uuid.uuid4().hex[:6])
job.mkdir(parents=True, exist_ok=True)
env = os.environ.copy(); env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']; (job / 'avd').mkdir(exist_ok=True)
ADB = str(SDK / 'platform-tools/adb'); PORT = 5712; S = 'emulator-%d' % PORT; DEVTOOLS = 9363; FAKE = 18797
ORIGIN = 'http://localhost:%d' % FAKE


def sh(*a, stdin=None, binary=False, timeout=120):
    r = subprocess.run([str(x) for x in a], env=env, capture_output=True, input=stdin, text=not binary, timeout=timeout)
    return r.stdout


def sx(c, **kw): return sh(ADB, '-s', S, 'shell', c, **kw)
def runas(c): return sx("run-as %s sh -c '%s'" % (PKG, c))


def png():
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    w = h = 64; raw = b''.join(b'\x00' + bytes([200, 120, 30]) * w for _ in range(h))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


PNG = png(); LOG = []
PAGE = b'<!doctype html><meta name=viewport content="width=device-width"><title>probe</title><body style="background:#123"><h1 id=h>probe</h1><img id=im src="/img/inline.png" style="width:300px"></body>'


class Fake(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass
    def _send(self, code, body, ctype, extra=None):
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD': self.wfile.write(body)
    def do_HEAD(self): self.do_GET()
    def do_GET(self):
        LOG.append({'path': self.path, 'ua': self.headers.get('User-Agent', ''), 'method': self.command, 't': time.time()})
        u = self.path.split('?')[0]
        if u.startswith('/wizard-os-home'): return self._send(200, PAGE, 'text/html')
        if u == '/img/inline.png': return self._send(200, PNG, 'image/png', {'Content-Disposition': 'inline; filename="inline.png"'})
        if u == '/img/plain.png': return self._send(200, PNG, 'image/png')
        if u.startswith('/img/att'): return self._send(200, PNG, 'image/png', {'Content-Disposition': 'attachment; filename="probe-%s.png"' % u.rsplit('/', 1)[-1].split('.')[0]})
        return self._send(404, b'', 'text/plain')


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
                page = next((x for x in l if x.get('type') == 'page'), None)
            except Exception: pass
            if page: break
            time.sleep(0.7)
        if not page: raise RuntimeError('no page')
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
        return r.get('result', {}).get('result', {}).get('value')


CASES = [
    ('a-download-inline', "(() => { const a = document.createElement('a'); a.href = '/img/inline.png'; a.download = 'a-inline.png'; document.body.appendChild(a); a.click(); a.remove(); return 1; })()"),
    ('a-download-plain', "(() => { const a = document.createElement('a'); a.href = '/img/plain.png'; a.download = 'a-plain.png'; document.body.appendChild(a); a.click(); a.remove(); return 1; })()"),
    ('a-download-attachment', "(() => { const a = document.createElement('a'); a.href = '/img/att-a.png'; a.download = 'x.png'; document.body.appendChild(a); a.click(); a.remove(); return 1; })()"),
    ('iframe-attachment', "(() => { const f = document.createElement('iframe'); f.style.display = 'none'; f.src = '/img/att-iframe.png'; document.body.appendChild(f); setTimeout(() => f.remove(), 8000); return 1; })()"),
    ('iframe-inline', "(() => { const f = document.createElement('iframe'); f.style.display = 'none'; f.src = '/img/inline.png?ifr'; document.body.appendChild(f); setTimeout(() => f.remove(), 8000); return 1; })()"),
    ('a-download-blob', "(async () => { const b = await (await fetch('/img/plain.png')).blob(); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'a-blob.png'; document.body.appendChild(a); a.click(); a.remove(); return 1; })()"),
]
# Top-level navigation to an attachment response: the WebView should hand it to the DownloadListener and keep the
# page (the navigation never commits). Marker + beforeunload show whether the page survived untouched.
NAV = [
    ('nav-attachment', "(() => { window.__mark = 'alive'; window.__bu = 0; addEventListener('beforeunload', () => { window.__bu++; }); location.href = '/img/att-nav.png'; return 1; })()"),
    ('nav-attachment-2', "(() => { location.assign('/img/att-nav2.png'); return 1; })()"),
]
if os.environ.get('PROBE') == 'nav': CASES = NAV
if os.environ.get('PROBE') == 'frames': CASES = [c for c in CASES if c[0] in ('iframe-attachment', 'a-download-attachment', 'a-download-plain')]

em = None; out = {'cases': {}}
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'dl', '-k', 'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7', '-p', job / 'dev', stdin='no\n')
        em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'dl', '-port', str(PORT), '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect'] + ([] if os.environ.get('LIVE_DNS') else ['-dns-server', '10.0.2.250']),
                              env=env, stdout=open(job / 'em.log', 'w'), stderr=subprocess.STDOUT)
        for _ in range(140):
            if sx('getprop sys.boot_completed').strip() == '1': break
            time.sleep(3)
        time.sleep(8)
        sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard')
        print('install', sh(ADB, '-s', S, 'install', '-r', APK).strip().splitlines()[-1], flush=True)
        print('su', sx('su 0 id 2>&1').strip(), flush=True)
        sh(ADB, '-s', S, 'reverse', 'tcp:%d' % FAKE, 'tcp:%d' % FAKE)
        runas('mkdir -p files && echo %s > files/qa_home.txt && echo %s > files/qa_origin.txt' % (ORIGIN, ORIGIN))
        sx('am start -W -n %s/ai.wizards.os.MainActivity' % PKG); time.sleep(6)
        pg = Page()
        for _ in range(30):
            if pg.ev('document.title') == 'probe': break
            time.sleep(1)
        print('page', pg.ev('location.href'), flush=True)
        for name, js in CASES:
            n0 = len(LOG)
            try: pg.ev(js)
            except Exception as e: print('js error', name, e)
            time.sleep(6)
            try:
                href = pg.ev('location.href'); title = pg.ev('document.title')
            except Exception:
                pg = Page(); href = pg.ev('location.href'); title = pg.ev('document.title')
            reqs = [(l['path'], 'DM' if 'AndroidDownloadManager' in l['ua'] or 'Dalvik' in l['ua'] else ('WV' if 'WizardOS' in l['ua'] or 'wv' in l['ua'] else l['ua'][:40])) for l in LOG[n0:]]
            files = sx('ls /sdcard/Download/ 2>&1').split()
            stayed = title == 'probe' and href.startswith(ORIGIN + '/wizard-os-home')
            alive = pg.ev("JSON.stringify({ mark: window.__mark || '', bu: window.__bu || 0 })")
            top = next((l.strip() for l in sx('dumpsys activity activities').splitlines() if 'topResumedActivity' in l), '')
            for _ in range(10):
                time.sleep(3)
                if '|200|' in sh(ADB, '-s', S, 'shell', "su 0 sqlite3 /data/data/com.android.providers.downloads/databases/downloads.db 'select status from downloads' 2>&1").replace('\n', '|') + '|': break
            dl = sh(ADB, '-s', S, 'shell', "su 0 sqlite3 /data/data/com.android.providers.downloads/databases/downloads.db 'select _id,uri,status,errorMsg,total_bytes,current_bytes,_data,mimetype,notificationpackage from downloads' 2>&1")
            files = sx('ls -la /sdcard/Download/ 2>&1')
            out['cases'][name] = {'stayed': stayed, 'alive': alive, 'top': top[-80:], 'href': href, 'reqs': [(l['path'], l['ua'][:60]) for l in LOG[n0:]], 'dm': dl.strip(), 'downloads': files}
            print(name, json.dumps(out['cases'][name]), flush=True)
            if not stayed:
                sx('am start -W -n %s/ai.wizards.os.MainActivity' % PKG); time.sleep(2)
                pg.ev("location.href = %s" % json.dumps(ORIGIN + '/wizard-os-home/')); time.sleep(3)
        pid = sx('pidof %s' % PKG).strip()
        out['logcat'] = sx('logcat -d | grep -E " %s |DownloadManager|DownloadThread|DownloadProvider|DownloadInfo|Toast" | grep -viE "Carrier|SP.AiAi|ApkAssets|Bugle" | tail -60' % pid)
        print(out['logcat'])
        (job / 'probe.json').write_text(json.dumps(out, indent=1))
    finally:
        try: sh(ADB, '-s', S, 'emu', 'kill', timeout=30)
        except Exception: pass
        if em:
            try: em.wait(30)
            except Exception: em.kill()
        srv.shutdown()
print('job', job)
