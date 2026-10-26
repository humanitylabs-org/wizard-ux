#!/usr/bin/env python3
"""Food device QA (runs on a Linux/KVM worker): Wizard OS (QA build) + a stand-in Grab app (tools/fake-grab, package
com.grabtaxi.passenger) on a fresh API35 emulator.

usage: qa_usuals.py WOS_QA_APK FAKE_GRAB_APK WEB_DIR [OUT_DIR]
Set ANDROID_HOME, JAVA_HOME and WIZARD_WORK_ROOT. Optional QA_WEBVIEW_APK
uses a supplied x86_64 SystemWebView on the disposable device (never on a phone). SLICE8_FOOD_APP points to
the installed Food app checkout for candidate runs. For an old-to-new move in
the SAME native store, also set SLICE8_MOVE_WEB and SLICE8_MOVE_FOOD.

A. Usuals shows in the app list (native bridge present); without accessibility it says so; with it, the empty state
   leads with "Order something new" (no name asked first).
B. Order something new: Grab opens with the "Saving this order" card. A person (adb taps) browses like James would:
   closes the promo, searches "krua", LOOKS at Kruang Burger (opens it, backs out), opens Krua Thai Kitchen, adds
   2× Kra pao + 1× Mango sticky rice + 1× Thai iced tea, goes to checkout, REMOVES the mango sticky rice there, and
   taps Grab's own Place order. → exactly one order (2× kra pao + iced tea, ฿200); Wizard saves the route on its own,
   named "Kra pao moo saap + Thai iced tea", with the burger detour and the removed dish taken out; a "Saved to
   Usuals" card with Rename floats over Grab's tracking screen. Rename → Usuals opens with the name field → "Kra pao".
C. Run: tap Order → Grab opens fresh (promo shows on that launch), the cover is up, the run reaches checkout,
   the cover shows "Place order · ฿200"; NO order was placed by the run.
D. Look first → cover gone, Grab is on checkout, still no order.
Default legacy mode retains the full cover-confirmation and voice-routing E/F tests.
SLICE8_CHECKOUT_ONLY skips those extra legacy tests.
E. Optional old-to-new web move: native record unchanged, listed in hosted Food,
   replay still shows its cover and stops at checkout without another placement.
G. Back: edit sheet open → Back closes the sheet, app stays open. No crashes.
"""
import fcntl, http.server, json, os, pathlib, platform, re, socket, subprocess, sys, threading, time, uuid, urllib.request
from qa_paths import work_root
from qa_paths import android_sdk, java_home
P = pathlib.Path
BASE = P(str(work_root() / 'AndroidBuilds')); SDK = android_sdk()
ABI = os.environ.get('QA_ANDROID_ABI', 'arm64-v8a' if platform.machine().lower() in ('arm64', 'aarch64') else 'x86_64')
APK = P(sys.argv[1]); GRAB = P(sys.argv[2]); WEB = P(sys.argv[3])
job = BASE / 'qa' / ('wos-usuals-' + uuid.uuid4().hex[:8]); job.mkdir(parents=True)
OUT = P(sys.argv[4]) if len(sys.argv) > 4 else job / 'shots'; OUT.mkdir(parents=True, exist_ok=True)
env = os.environ.copy(); env.update(JAVA_HOME=java_home(),
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:' + env['PATH']; (job / 'avd').mkdir()
env['ANDROID_ADB_SERVER_PORT'] = os.environ.get('QA_ADB_PORT', '5048')
env.pop('ADB_SERVER_SOCKET', None)
ADB = str(SDK / 'platform-tools/adb'); PORT = int(os.environ.get('QA_EMULATOR_PORT', '5680')); S = f'127.0.0.1:{PORT+1}'; DEVTOOLS = int(os.environ.get('QA_DEVTOOLS_PORT', '9361')); FAKE = int(os.environ.get('QA_FAKE_PORT', '18791'))
PKG = 'ai.wizards.os.qa'; GPKG = 'com.grabtaxi.passenger'; ORIGIN = f'http://10.0.2.2:{FAKE}'
res = []; EVENTS = []; CHECKS = []
print('JOB', job, flush=True)
COMMANDS = []
def check(n, ok, d: object=''):
    CHECKS.append({'name': n, 'ok': bool(ok), 'detail': str(d)}); res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n + (' — ' + str(d)[:400] if d else ''), flush=True)
def sh(*a, stdin=None, binary=False):
    r = subprocess.run([str(x) for x in a], env=env, capture_output=True, input=stdin, text=not binary, timeout=90)
    COMMANDS.append({'argv':[str(x) for x in a], 'code':r.returncode, 'stdout':f'{len(r.stdout)} binary bytes' if binary else str(r.stdout)[-3000:], 'stderr':str(r.stderr)[-3000:]})
    return r.stdout
def sx(c):
    result = sh(ADB, '-s', S, 'shell', c)
    if COMMANDS[-1]['code'] and ('not found' in COMMANDS[-1]['stderr'] or 'offline' in COMMANDS[-1]['stderr']):
        sh(ADB, 'connect', S); time.sleep(.5); result = sh(ADB, '-s', S, 'shell', c)
    return result
def shot(name): (OUT / (name + '.png')).write_bytes(sh(ADB, '-s', S, 'exec-out', 'screencap', '-p', binary=True))
# No uiautomator: a dump re-binds UiAutomation and knocks Wizard OS's accessibility service (and its cover) off.
# The stand-in Grab and the cover (debug builds) log their labels and centres instead.
def _views(tag, prefix):
    lines = [l for l in sx(f'logcat -d -s {tag}:*').splitlines() if (': ' + prefix) in l and ': views |Not now@' not in l]  # the pop-up logs its own line
    if not lines: return [], None
    l = lines[-1].split(': ' + prefix, 1)[1]
    frame = None
    m = re.match(r' frame=(-?\d+),(-?\d+),(-?\d+),(-?\d+)', l)
    if m: frame = tuple(map(int, m.groups()))
    out = []
    for part in l.split(' |')[1:]:
        lab, _, xy = part.rpartition('@')
        try: x, y = map(int, xy.split(','))
        except Exception: continue
        out.append({'text': lab, 'x': x, 'y': y})
    return out, frame
def gviews(): return _views('FakeGrab', 'views')[0]
def cviews(): return _views('WizardUsuals', 'cover')
def gfind(pattern):
    for n in gviews():
        if re.search(pattern, n['text'], re.I): return n
    return None
def cfind(pattern, since=None):
    v, _ = cviews()
    for n in v:
        if re.search(pattern, n['text'], re.I): return n
    return None
def tap(n): sx(f"input tap {n['x']} {n['y']}")
def find(pattern, pkg=None):
    return gfind(pattern) if pkg == GPKG else cfind(pattern)
def tap_text(pattern, pkg=None, tries=10):
    for _ in range(tries):
        n = find(pattern, pkg)
        if n: tap(n); return n['text']
        time.sleep(1)
    return None
def clear_logs(): sx('logcat -c')
def top(): return next((l.strip() for l in sx('dumpsys activity activities').splitlines() if 'topResumedActivity' in l), '')
def grablog(): return GLOG[0] + sx('logcat -d -s FakeGrab:*')
GLOG = ['']
def uslog(): return sx('logcat -d -s WizardUsuals:*')
def wait_for(fn, secs=30, step=1.0):
    t = time.time()
    while time.time() - t < secs:
        v = fn()
        if v: return v
        time.sleep(step)
    return None

# ---------------------------------------------------------------- fake Wizard: serves web/, answers nothing else
class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body, ctype='application/json', extra=None):
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        u = self.path.split('?')[0]
        if u == '/wizard/v1/ui-preferences': return self._send(200, b'{"migrations":{"launcher-seed-v1":true}}')
        if u.endswith('/store-install/_updates'): return self._send(200, b'{"mode":"ask","update_available":false}')
        if u == '/wizard-os-home': return self._send(301, b'', extra={'Location': '/wizard-os-home/'})
        m = re.match(r'^/wizard-os-home/(.*)$', u)
        if m:
            f = m.group(1) or 'index.html'; p = (WEB / f).resolve()
            if f in ('data.js', 'summaries.js'): return self._send(200, b'', 'text/javascript')
            if str(p).startswith(str(WEB.resolve())) and p.is_file():
                ct = {'js': 'text/javascript', 'css': 'text/css', 'html': 'text/html', 'json': 'application/json', 'svg': 'image/svg+xml', 'png': 'image/png', 'webmanifest': 'application/manifest+json'}.get(p.suffix[1:], 'application/octet-stream')
                return self._send(200, p.read_bytes(), ct)
        if FOOD_APP and u.startswith('/usuals/'):
            file = FOOD_FILES.get(u[len('/usuals/'):] or 'index.html')
            if file is None: return self._send(404, b'')
            ct = {'.html':'text/html','.css':'text/css','.js':'text/javascript'}.get(file.suffix,'application/octet-stream')
            return self._send(200, file.read_bytes(), ct)
        if u == '/wizard/v1/bootstrap':
            return self._send(200, json.dumps({'bootstrap':1,'settings':{'owner':{},'agent':{'name':'Wizard'},'clock':{},'appearance':{}},'capabilities':{},'endpoints':{'apps':'/wizard/v1/apps','agents':'/wizard/v1/agents','uiPreferences':'/wizard/v1/ui-preferences'}}).encode())
        if u.startswith('/wizard/v1/apps'):
            apps = [{'id':'usuals','name':'Food','url':'/usuals/','view':{'mode':'original','url':'/usuals/'},'source':'apps.json','status':'running','provides':['voice-commands'],'voice_names':['Food','Usuals','usual','food app','wizard eats','saved orders','eats','bites']}] if FOOD_APP else []
            return self._send(200, json.dumps({'schema':1,'apps':apps}).encode())
        if u.startswith('/wizard/hermes/api/sessions'): return self._send(200, b'{"sessions":[]}')
        if 'update' in u or u.endswith('latest.json'): return self._send(404, b'{}')
        return self._send(200, b'{}')
    def do_PUT(self):
        n = int(self.headers.get('Content-Length') or 0); self.rfile.read(n) if n else b''
        if self.path == '/wizard/thread-seen': return self._send(200, b'{}')
        return self._send(503, b'{"error":"qa: no writes"}')
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); self.rfile.read(n) if n else b''
        WRITES.append(self.path)
        return self._send(503, b'{"error":"qa: no writes"}')
WRITES = []
FOOD_APP = os.environ.get('SLICE8_FOOD_APP', '')
def food_files(root):
    base = P(root) / 'app/static'
    return {file.relative_to(base).as_posix(): file for file in base.rglob('*') if file.is_file() and file.resolve().is_relative_to(base.resolve())} if root else {}
FOOD_FILES = food_files(FOOD_APP)
srv = None

class Page:
    def __init__(self):
        pid = sx(f'pidof {PKG}').strip().split()[0]
        sh(ADB, '-s', S, 'forward', f'tcp:{DEVTOOLS}', f'localabstract:webview_devtools_remote_{pid}')
        page = None
        for _ in range(50):
            try:
                l = json.load(urllib.request.urlopen(f'http://127.0.0.1:{DEVTOOLS}/json/list', timeout=3))
                page = next((x for x in l if x.get('type') == 'page' and 'wizard-os-home' in x.get('url', '')), None)
            except Exception: pass
            if page: break
            time.sleep(0.7)
        if not page: raise RuntimeError('no Wizard OS page')
        self.id = 0
        u = page['webSocketDebuggerUrl']; host, path = re.match(r'ws://([^/]+)(/.*)', u).groups()
        h, p = host.split(':'); self.s = socket.create_connection((h, int(p)), timeout=30)
        self.s.sendall(f'GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode())
        buf = b''
        while b'\r\n\r\n' not in buf: buf += self.s.recv(4096)
        self.buf = buf.split(b'\r\n\r\n', 1)[1]
        for i, method in enumerate(['Runtime.enable', 'Log.enable'], 10000):
            self._send({'id':i,'method':method})
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
        if FOOD_APP:
            frame = "document.querySelector('iframe.appframe:not([data-voice-service])[src*=\"/usuals/\"]')"
            expr = expr.replace("window.__wos.openApp({ id: 'usuals', name: 'Food', kind: 'usuals' })", "window.WizOpenApp('usuals')")
            expr = re.sub(r"document\.querySelector\((['\"])(?=\[data-us|\.us-)", lambda m: frame + '.contentDocument.querySelector(' + m.group(1), expr)
            expr = expr.replace('window.WosUsuals', frame + '.contentWindow.WosUsuals')
        self.id += 1; my = self.id
        self._send({'id': my, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'awaitPromise': True, 'returnByValue': True, 'userGesture': True}})
        while True:
            d = self._recv()
            if 'method' in d: EVENTS.append(d)
            if d.get('id') == my:
                rr = d.get('result', {})
                if rr.get('exceptionDetails'): raise RuntimeError(json.dumps(rr['exceptionDetails'])[:400])
                return rr.get('result', {}).get('value')
    def close(self):
        try: self.s.close()
        except Exception: pass

def page():
    for _ in range(3):
        try:
            pg = Page(); pg.ev("new Promise(r => { const t = () => window.__wos ? r() : setTimeout(t, 200); t(); })")
            # A fresh install opens the first-run tour (0.9.3+), which swallows every tap outside itself.
            pg.ev("(() => { try { localStorage.setItem('wos.tour.v1', 'true'); } catch (e) {} return 1; })()")
            # It starts ~600 ms after boot, so wait for it and close it rather than racing it.
            pg.ev("new Promise(r => { let n = 0; const t = () => { const T = window.WosTour; if (T && T.active) { T.finish('qa'); r(1); } else if (++n > 15) r(0); else setTimeout(t, 200); }; t(); })")
            if FOOD_APP: pg.ev('window.WizCore.appsLoaded()')
            return pg
        except Exception as e: print('  page retry', e); time.sleep(2)
    raise RuntimeError('no page')

def bring_wos():
    sx(f'am start -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(2.5)
    # Android force-stop intentionally unbinds accessibility; restore the user's fixture switch.
    sx('settings put secure enabled_accessibility_services null')
    sx(f'settings put secure enabled_accessibility_services {PKG}/ai.wizards.os.everywhere.WizardKeyboardService')
    sx('settings put secure accessibility_enabled 1'); time.sleep(3)

em = None; adb_owned = False
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        if int(env['ANDROID_ADB_SERVER_PORT']) == 5037: raise RuntimeError('Refuse shared ADB server')
        for port in (int(env['ANDROID_ADB_SERVER_PORT']), PORT, PORT + 1, DEVTOOLS, FAKE):
            with socket.socket() as probe:
                if probe.connect_ex(('127.0.0.1', port)) == 0: raise RuntimeError(f'QA port {port} already belongs to another process')
        srv = http.server.ThreadingHTTPServer(('127.0.0.1', FAKE), Fake)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'us', '-k', f'system-images;android-35;google_apis;{ABI}', '-d', 'pixel_7', '-p', job / 'dev', stdin='no\n')
        sh(ADB, 'start-server')
        if COMMANDS[-1]['code']: raise RuntimeError('Private ADB startup failed')
        adb_owned = True
        em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'us', '-port', str(PORT), '-accel', 'on', '-no-window', '-no-snapshot', '-no-audio', *(['-gpu', 'swangle', '-feature', '-Vulkan,-GLDirectMem'] if sys.platform.startswith('linux') else ['-gpu', 'swiftshader_indirect']), '-verbose', '-memory', '2560', '-cores', '4'], env=env, stdout=open(job / 'em.log', 'w'), stderr=subprocess.STDOUT)
        for _ in range(120):
            if em.poll() is not None: raise RuntimeError('emulator exited ' + str(em.returncode))
            if sx('getprop sys.boot_completed').strip() == '1': break
            time.sleep(3)
        else: raise RuntimeError('boot timeout')
        time.sleep(10)
        for k in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'): sx(f'settings put global {k} 0')
        sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard'); sx('settings put system screen_off_timeout 1800000')
        if os.environ.get('QA_WEBVIEW_APK'):
            sh(ADB, '-s', S, 'install', '-r', os.environ['QA_WEBVIEW_APK'])
            provider = sx('cmd webviewupdate set-webview-implementation com.android.webview')
            if 'Success' not in provider: raise RuntimeError('QA WebView provider failed: ' + provider)
        (OUT / 'webview-provider.txt').write_text(sx('dumpsys webviewupdate'))
        out1 = sh(ADB, '-s', S, 'install', '-r', APK).strip().splitlines()[-1]
        out2 = sh(ADB, '-s', S, 'install', '-r', GRAB).strip().splitlines()[-1]
        check('install Wizard OS QA + stand-in Grab', out1 == 'Success' and out2 == 'Success', out1 + ' / ' + out2)
        sx(f'run-as {PKG} mkdir -p files'); sx(f"run-as {PKG} sh -c 'echo {ORIGIN} > files/qa_home.txt; echo {ORIGIN} > files/qa_origin.txt'")
        sx(f'pm grant {PKG} android.permission.RECORD_AUDIO'); sx(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(8)
        print('SLICE8_SETUP ' + json.dumps(COMMANDS[-8:]), flush=True)
        print('TRANSPORT', sh(ADB, 'devices', '-l'), 'PID', sx(f'pidof {PKG}'), 'ACTIVITY', top(), flush=True)
        shot('pre-page')
        pg = page()

        # A. app list + blocker without accessibility
        has = pg.ev("!!(window.WizardOSNative && window.WizardOSNative.usuals) && !!window.__wos.openApp && (window.WizCore?.apps?.find?.('usuals') || true)")
        pg.ev("window.__wos.openApp({ id: 'usuals', name: 'Food', kind: 'usuals' })"); time.sleep(1.5)
        txt = pg.ev("document.querySelector('[data-usuals]')?.innerText || ''")
        check('A: Usuals window opens and asks for the accessibility switch first', has and 'One switch first' in (txt or ''), (txt or '')[:160])
        shot('a-needs-switch')

        # turn on accessibility (what the switch's setup ends in)
        sx(f'settings put secure enabled_accessibility_services {PKG}/ai.wizards.os.everywhere.WizardKeyboardService'); sx('settings put secure accessibility_enabled 1'); time.sleep(4)
        pg.ev("window.WosUsuals.refresh()"); time.sleep(.5)
        txt = pg.ev("document.querySelector('[data-usuals]')?.innerText || ''")
        check('A: with the switch on, the empty state leads with Order something new (no name asked)',
              'Order something new' in txt and 'One switch' not in txt and not pg.ev("!!document.querySelector('.us-teach input')"), txt[:200])
        shot('a-empty')

        # B. Order something new: browse, change his mind, order in Grab → saved by itself
        pg.ev("document.querySelector('[data-us=new]').click()")
        ok = wait_for(lambda: GPKG in top(), 15)
        check('B: Order something new opens Grab straight away', ok, top())
        time.sleep(3)
        card = wait_for(lambda: find(r'^Save$'), 8)
        cv, _ = cviews()
        check('B: the "Saving this order" card floats over Grab', card is not None and any('Saving this order' in n['text'] for n in cv), cv)
        shot('b-browse-card')
        if wait_for(lambda: re.search(r'views \|Not now@(\d+),(\d+)', grablog()), 6):
            m = re.findall(r'views \|Not now@(\d+),(\d+)', grablog())[-1]; sx(f'input tap {m[0]} {m[1]}'); time.sleep(1.5)
        box = wait_for(lambda: gfind(r'Search for dishes'), 8)
        if box: tap(box); time.sleep(1); sx('input text krua'); time.sleep(1.5)
        # A look at the burger place, then back out of it
        r = wait_for(lambda: gfind(r'^Kruang Burger$'), 8)
        if r: tap(r); time.sleep(2.5)
        looked = 'screen menu Kruang Burger' in grablog()
        sx('input keyevent KEYCODE_BACK'); time.sleep(2)
        box = wait_for(lambda: gfind(r'Search for dishes'), 8)
        if box: tap(box); time.sleep(1); sx('input text krua'); time.sleep(1.5)
        r = wait_for(lambda: gfind(r'^Krua Thai Kitchen$'), 8)
        if r: tap(r); time.sleep(2)
        check('B: (by hand) looked at Kruang Burger, backed out, opened Krua Thai Kitchen', looked and 'screen menu Krua Thai Kitchen' in grablog(), grablog()[-300:])
        def add_by(item):
            last_y = None
            for _ in range(10):
                time.sleep(.8); ns = gviews()
                it = next((n for n in ns if n['text'] == item), None)
                # Keep clear of the basket bar; the last row can't scroll any higher, so take it where it is.
                if it and it['y'] > 1800 and it['y'] != last_y: last_y = it['y']; sx('input swipe 540 1500 540 1000 400'); time.sleep(1.2); continue
                if it:
                    adds = sorted([n for n in ns if n['text'] == 'Add' and abs(n['y'] - it['y']) < 140], key=lambda n: abs(n['y'] - it['y']))
                    if adds:
                        before = grablog().count('added ' + item); tap(adds[0])
                        return bool(wait_for(lambda: grablog().count('added ' + item) > before, 5, .3))
                sx('input swipe 540 1700 540 1000 400'); time.sleep(1.2)
            return False
        a1 = add_by('Kra pao moo saap'); a2 = add_by('Kra pao moo saap'); a3 = add_by('Thai iced tea'); a4 = add_by('Mango sticky rice')
        check('B: (by hand) added 2× kra pao + iced tea + mango sticky rice', a1 and a2 and a3 and a4, grablog()[-300:])
        time.sleep(2)
        cv, _ = cviews()
        line = next((n['text'] for n in cv if '×' in n['text']), '')
        check('B: the card shows the basket so far', '2× Kra pao moo saap' in line and 'Thai iced tea' in line, cv)
        shot('b-browse-basket')
        tap_text(r'^View basket', pkg=GPKG); time.sleep(2)
        # Changes his mind about dessert at checkout
        def remove(item):
            for _ in range(6):
                ns = gviews()
                it = next((n for n in ns if item in n['text']), None)
                rm = it and sorted([n for n in ns if n['text'] == 'Remove' and abs(n['y'] - it['y']) < 120], key=lambda n: abs(n['y'] - it['y']))
                if rm: tap(rm[0]); return bool(wait_for(lambda: ('removed ' + item) in grablog(), 5, .3))
                time.sleep(1)
            return False
        rmd = remove('Mango sticky rice'); time.sleep(2)
        check('B: (by hand) removed the mango sticky rice at checkout → ฿200', rmd and 'checkout total=200' in grablog(), grablog()[-300:])
        shot('b-checkout')
        orders0 = grablog().count('ORDER PLACED')
        tap_text(r'^Place order', pkg=GPKG)
        placed = wait_for(lambda: grablog().count('ORDER PLACED') > orders0, 8, .3)
        gl = grablog()
        check('B: his own tap on Place order in Grab places exactly one order (2× kra pao + iced tea, ฿200)',
              placed and gl.count('ORDER PLACED') == 1 and 'ORDER PLACED total=200 items=2x Kra pao moo saap; 1x Thai iced tea;' in gl, gl[-300:])
        saved = wait_for(lambda: find(r'^Rename$'), 8, .5)
        cv, _ = cviews()
        check('B: Wizard saves it by itself: "Saved to Food" with Rename over Grab\'s tracking screen',
              saved is not None and any('Saved to Food' in n['text'] for n in cv) and GPKG in top(), (cv, top()))
        shot('b-saved-card')
        lst = json.loads(pg.ev("window.WizardOSNative.usuals()") or '{}')
        u = (lst.get('list') or [{}])[0]
        script = u.get('script', '')
        print('  recorded:', script.replace('\n', ' | '))
        print('  usual:', {k: u.get(k) for k in ['name','basket','place','lastTotal','needsName','lastResult']})
        (OUT / 'native-order.json').write_text(json.dumps(u, indent=2))
        check('B: named after the food', u.get('name') == 'Kra pao moo saap + Thai iced tea' and u.get('needsName') is True, u.get('name'))
        check('B: basket and place read off the route', u.get('basket') == '2× Kra pao moo saap · 1× Thai iced tea' and u.get('place') == 'Krua Thai Kitchen', (u.get('basket'), u.get('place')))
        check('B: route keeps the search, the restaurant and Add by the item',
              'type krua' in script and 'tap Krua Thai Kitchen' in script and script.count('tap Add @ Kra pao moo saap') == 2 and 'tap Add @ Thai iced tea' in script, script)
        check('B: the burger detour and the removed dessert are not in the route',
              'Kruang' not in script and 'Mango' not in script and 'Remove' not in script and 'Place order' not in script, script)
        check('B: total read off checkout', u.get('lastTotal') == '฿200', u.get('lastTotal'))
        # Rename from the card
        tap_text(r'^Rename$'); time.sleep(3)
        back = wait_for(lambda: PKG in top(), 10)
        pg.close(); pg = page(); time.sleep(1)
        has_name = pg.ev("!!document.querySelector('.us-name input')")
        check('B: Rename opens Usuals with the name field and what\'s in it', back and has_name and '2× Kra pao' in (pg.ev("document.querySelector('.us-name')?.innerText || ''") or ''), (top(), has_name))
        shot('b-name')
        pg.ev("(() => { const i = document.querySelector('.us-name input'); i.value = 'Kra pao'; document.querySelector('.us-name button[type=submit]').click(); })()"); time.sleep(.8)
        lst = json.loads(pg.ev("window.WizardOSNative.usuals()") or '{}'); u = (lst.get('list') or [{}])[0]
        check('B: renamed to Kra pao, name field gone', u.get('name') == 'Kra pao' and not u.get('needsName') and not pg.ev("!!document.querySelector('.us-name')"), (u.get('name'), u.get('needsName')))
        pg.ev("window.WosUsuals.refresh()"); time.sleep(.5); shot('b-saved'); print('SLICE8_NATIVE_ORDER ' + json.dumps({k:u.get(k) for k in ['name','basket','place','script','steps','lastTotal']}, sort_keys=True), flush=True)

        # Close and reopen the real app, without clearing native state.
        sx(f'am force-stop {PKG}'); bring_wos(); pg.close(); pg = page()
        pg.ev("window.__wos.openApp({ id: 'usuals', name: 'Food', kind: 'usuals' })"); time.sleep(2)
        check('saved order survives force-stop and reopen', 'Kra pao' in pg.ev("document.querySelector('[data-usuals]').innerText") and json.loads(pg.ev('window.WizardOSNative.usuals()'))['list'][0]['id'] == u['id'])
        pg.ev('window.WosUsuals.refresh()'); time.sleep(1)
        check('accessibility is rebound after fixture force-stop', json.loads(pg.ev('window.WizardOSNative.usuals()')).get('blocker') == '')
        shot('b-reopened')

        # C. Run → cover → checkout, nothing ordered
        t0 = time.time()
        pg.ev(f"document.querySelector('[data-us=run]').click()")
        covered = wait_for(lambda: find(r'^Ordering your Kra pao'), 15, .5)
        check('C: the cover is up while Grab works underneath', covered is not None and GPKG in top(), top())
        shot('c-cover')
        ready = wait_for(lambda: find(r'^Place order'), 90, 1)
        secs = round(time.time() - t0, 1)
        log = uslog()
        check(f'C: run reaches checkout under the cover ({secs}s)', ready is not None, log[-900:])
        check('C: the cover shows the total on Place order', ready is not None and '฿200' in (ready['text'] or ''), ready and ready['text'])
        check('C: the run closed Grab\'s promo pop-up by itself', 'popup closed' in grablog() or 'Not now' in log, '')
        check('C: nothing ordered by the run', grablog().count('ORDER PLACED') == 1)
        check('C: basket is right (2 kra pao + iced tea → checkout ฿200)', grablog().count('checkout total=200') >= 2, grablog()[-300:])
        shot('c-ready')

        # D. Look first
        tap_text(r'^Look first$'); time.sleep(2)
        ul = uslog(); hidden = ul.rfind('cover hidden') > ul.rfind('cover frame')
        check('D: Look first leaves Grab on its checkout, uncovered', hidden and GPKG in top() and find(r'^Place order ฿200$', pkg=GPKG) is not None, (hidden, top()))
        check('D: still nothing ordered', grablog().count('ORDER PLACED') == 1)
        shot('d-look-first')

        # Optional in-place web move: preserve this device and its native store.
        if os.environ.get('SLICE8_MOVE_WEB'):
            before = json.loads(pg.ev('window.WizardOSNative.usuals()'))['list']
            WEB = P(os.environ['SLICE8_MOVE_WEB']); FOOD_APP = os.environ['SLICE8_MOVE_FOOD']; FOOD_FILES = food_files(FOOD_APP)
            sx(f'am force-stop {PKG}'); bring_wos(); pg.close(); pg = page()
            pg.ev("window.WizCore.appsLoaded().then(() => window.WizOpenApp('usuals'))"); time.sleep(3)
            shot('migration-open')
            print('MIGRATION_HOST', pg.ev("JSON.stringify({apps:window.WizCore.apps('mobile').APPS.map(a=>({id:a.id,url:a.url})),frames:[...document.querySelectorAll('iframe')].map(f=>f.src)})"), flush=True)
            check('native bridge ready after web move', json.loads(pg.ev('window.WizardOSNative.usuals()')).get('blocker') == '')
            after = json.loads(pg.ev('window.WizardOSNative.usuals()'))['list']
            (OUT / 'native-before-move.json').write_text(json.dumps(before, indent=2))
            (OUT / 'native-after-move.json').write_text(json.dumps(after, indent=2))
            check('old saved native order is unchanged under new web', before == after and 'Kra pao' in pg.ev("document.querySelector('[data-usuals]').innerText"))
            shot('migration-listed')
            pg.ev("document.querySelector('[data-us=run]').click()")
            covered = wait_for(lambda: find(r'^Ordering your Kra pao'),15,.5)
            print('MIGRATION_REPLAY_STATE ' + str(pg.ev('window.WizardOSNative.usuals()')), flush=True)
            check('old saved order replays under new with cover', bool(covered))
            shot('migration-cover')
            ready = wait_for(lambda: find(r'^Place order'),90,1)
            check('old saved order stops at checkout under new, total 200, no placement', ready is not None and '฿200' in ready['text'] and grablog().count('ORDER PLACED') == 1)
            shot('migration-ready')
            tap_text(r'^Cancel$'); time.sleep(2)
        elif not FOOD_APP and not os.environ.get('SLICE8_CHECKOUT_ONLY'):
            # E. Run again and order from the cover
            bring_wos(); pg.close(); pg = page()
            pg.ev("window.__wos.openApp({ id: 'usuals', name: 'Food', kind: 'usuals' })"); time.sleep(1)
            pg.ev("document.querySelector('[data-us=run]').click()")
            ready = wait_for(lambda: find(r'^Place order'), 90, 1)
            check('E: second run reaches checkout', ready is not None, uslog()[-400:])
            if ready: tap(ready)
            placed = wait_for(lambda: grablog().count('ORDER PLACED') >= 2, 15, .5)
            gl = grablog()
            check('E: James\'s tap on Place order places exactly one more order', placed and gl.count('ORDER PLACED') == 2, gl[-300:])
            check('E: the order is 2× kra pao + 1× iced tea, ฿200', 'ORDER PLACED total=200 items=2x Kra pao moo saap; 1x Thai iced tea;' in gl, gl[-200:])
            time.sleep(1.5); shot('e-ordered')
            wait_for(lambda: find(r'^Ordered') is None, 6, .5)

            # F. Voice routing (in-app orb / typed): "order my usual kra pao" starts a run; nothing written to Wizard
            bring_wos(); pg.close(); pg = page()
            n0 = len(WRITES); g0 = grablog().count('screen checkout')
            pg.ev("window.__wos.handleText('Order my usual kra pao', 'auto')")
            covered = wait_for(lambda: find(r'^Ordering your Kra pao'), 15, .5)
            check('F: "order my usual kra pao" starts the run on the phone', covered is not None, uslog()[-300:])
            check('F: …and sends nothing to Wizard', len(WRITES) == n0, WRITES[n0:])
            ready = wait_for(lambda: find(r'^Place order'), 90, 1)
            tap_text(r'^Cancel$'); time.sleep(2)
            check('F: Cancel on the cover: nothing ordered, back in Wizard OS', grablog().count('ORDER PLACED') == 2 and PKG in top(), top())
            nm = pg.ev("window.WosUsuals.match('what is a good kra pao place')")
            check('F: ordinary talk about kra pao does not start an order', nm == '', nm)
            nm2 = pg.ev("window.WosUsuals.match('I want something else')")
            check('F: "I want something else" is ordinary talk too', nm2 == '', nm2)
            # "Order something new" by voice opens Grab to browse; "Don't save" leaves nothing behind
            pg.close(); pg = page()
            n0 = len(WRITES); c0 = len(json.loads(pg.ev("window.WizardOSNative.usuals()") or '{}').get('list') or [])
            pg.ev("window.__wos.handleText('Order something new', 'auto')")
            card = wait_for(lambda: find(r'^Save$'), 15, .5)
            check('F: "order something new" opens Grab with the Saving card', card is not None and GPKG in top() and len(WRITES) == n0, (top(), WRITES[n0:]))
            tap_text(r'^✕$'); time.sleep(2.5)
            pg.close(); pg = page()
            c1 = len(json.loads(pg.ev("window.WizardOSNative.usuals()") or '{}').get('list') or [])
            check('F: ✕ (don\'t save) → back in Wizard OS, no new usual, no order', PKG in top() and c1 == c0 and grablog().count('ORDER PLACED') == 2, (top(), c0, c1))
            # Food spells (James, 12 Oct): "order grab" / "order food" / "I want to order lunch" open Grab for a new order
            for said in ('Order grab', 'Order food.', 'I want to order lunch'):
                pg.close(); pg = page(); n0 = len(WRITES)
                m = pg.ev(f"window.WosUsuals.match({json.dumps(said)})")
                pg.ev(f"window.__wos.handleText({json.dumps(said)}, 'auto')")
                card = wait_for(lambda: find(r'^Save$'), 15, .5)
                check(f'F: spell "{said}" opens Grab with the Saving card (native match {m!r}), nothing to Wizard',
                      card is not None and GPKG in top() and len(WRITES) == n0 and m == '+new', (m, top(), WRITES[n0:]))
                tap_text(r'^✕$'); time.sleep(2.5)
            # "Food" on its own opens the Food app, titled Food
            pg.close(); pg = page(); bring_wos(); time.sleep(1); n0 = len(WRITES)
            pg.ev("window.__wos.handleText('Food', 'command')"); time.sleep(1.5)
            opened = pg.ev("!!document.querySelector('[data-usuals]')")
            title = pg.ev("(document.querySelector('.win.focus .wt, .win .wt, .win-title')||{}).innerText || ''")
            spells = pg.ev("document.querySelector('.us-spells')?.innerText || ''")
            shot('f-food-spells')
            check('F: "Food" opens the Food app with the spells listed, nothing to Wizard',
                  opened and 'order food' in (spells or '') and len(WRITES) == n0, (opened, title, spells[:120], WRITES[n0:]))

        else:
            bring_wos(); pg.close(); pg = page()

        # G. Back from the edit sheet stays in the app
        bring_wos(); pg.close(); pg = page()
        pg.ev("window.__wos.openApp({ id: 'usuals', name: 'Food', kind: 'usuals' })"); time.sleep(1)
        pg.ev("document.querySelector('[data-us=edit]').click()"); time.sleep(.6)
        shot('g-edit')
        sheet = pg.ev("!!document.querySelector('.us-sheet')")
        sx('input keyevent KEYCODE_BACK'); time.sleep(1.2)
        after = pg.ev("!!document.querySelector('.us-sheet')")
        check('G: Back closes the edit sheet and Wizard OS stays open', sheet and not after and PKG in top(), (sheet, after, top()))
        crashed = sx('logcat -d -b crash')
        check('no crashes', not re.search(r'FATAL EXCEPTION|Fatal signal|BEGIN CRASHPAD MINIDUMP', crashed), crashed[:300])
        errors = [e for e in EVENTS if e.get('method') == 'Runtime.exceptionThrown' or e.get('method') == 'Runtime.consoleAPICalled' and e.get('params', {}).get('type') == 'error' or e.get('method') == 'Log.entryAdded' and e.get('params', {}).get('entry', {}).get('level') == 'error']
        check('zero WebView console errors', not errors, errors)
    finally:
        print('COMMAND_LOG ' + str(OUT / 'commands.json'), flush=True)
        (OUT / 'commands.json').write_text(json.dumps(COMMANDS, indent=2))
        (OUT / 'events.json').write_text(json.dumps(EVENTS, indent=2))
        (OUT / 'checks.json').write_text(json.dumps(CHECKS, indent=2))
        try:
            if adb_owned: (OUT / 'logcat.txt').write_text(sx('logcat -d'))
        except Exception: pass
        if em:
            try: sh(ADB, '-s', f'emulator-{PORT}', 'emu', 'kill'); em.wait(40)
            except Exception: em.terminate(); em.wait(20)
        import shutil
        if (job / 'em.log').exists(): shutil.copyfile(job / 'em.log', OUT / 'emulator.log')
        if adb_owned: sh(ADB, 'kill-server') # Only this job's private server.
        if srv: srv.shutdown()
print(f'{sum(res)}/{len(res)} passed · shots {OUT}'); sys.exit(0 if all(res) else 1)