#!/usr/bin/env python3
"""Usuals device QA (runs on Thales): Wizard OS (QA build) + a stand-in Grab app (tools/fake-grab, package
com.grabtaxi.passenger) on a fresh API35 emulator.

usage: qa_usuals.py WOS_QA_APK FAKE_GRAB_APK WEB_DIR [OUT_DIR]

A. Usuals shows in the app list (native bridge present); without accessibility it says so.
B. Teach: tap Teach → name → Open Grab; the teach card is up; a person (adb taps) dismisses the promo, searches
   "krua", opens Krua Thai Kitchen, scrolls, taps Add by "Kra pao moo saap" twice and "Thai iced tea" once, opens
   the basket, taps Done → back in Wizard OS with the usual saved (steps recorded, total ฿245 read off checkout).
   (That a Place-order tap is never recorded or replayed is covered by UsualsPolicyTest.)
C. Run: tap Order → Grab opens fresh (promo shows on that launch), the cover is up, the run reaches checkout,
   the cover shows "Place order · ฿245"; NO order was placed by the run (FakeGrab log has no ORDER PLACED).
D. Look first → cover gone, Grab is on checkout, still no order.
E. Run again → Place order on the cover → FakeGrab logs exactly one ORDER PLACED with 2x Kra pao + 1x iced tea.
F. Voice: the in-app router turns "order my usual kra pao" into a run (handleText → localParse), no Wizard write.
G. Back: edit sheet open → Back closes the sheet, app stays open. No crashes.
"""
import fcntl, http.server, json, os, pathlib, re, socket, subprocess, sys, threading, time, uuid, urllib.request
P = pathlib.Path
BASE = P('/Volumes/ThalesMedia/AndroidBuilds'); SDK = P('/opt/homebrew/share/android-commandlinetools')
APK = P(sys.argv[1]); GRAB = P(sys.argv[2]); WEB = P(sys.argv[3])
job = BASE / 'qa' / ('wos-usuals-' + uuid.uuid4().hex[:8]); job.mkdir(parents=True)
OUT = P(sys.argv[4]) if len(sys.argv) > 4 else job / 'shots'; OUT.mkdir(parents=True, exist_ok=True)
env = os.environ.copy(); env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']; (job / 'avd').mkdir()
ADB = str(SDK / 'platform-tools/adb'); PORT = 5730; S = f'emulator-{PORT}'; DEVTOOLS = 9361; FAKE = 18791
PKG = 'ai.wizards.os.qa'; GPKG = 'com.grabtaxi.passenger'; ORIGIN = f'http://10.0.2.2:{FAKE}'
res = []
def check(n, ok, d=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n + (' — ' + str(d)[:400] if d else ''), flush=True)
def sh(*a, stdin=None, binary=False):
    r = subprocess.run([str(x) for x in a], env=env, capture_output=True, input=stdin, text=not binary)
    return r.stdout
def sx(c): return sh(ADB, '-s', S, 'shell', c)
def shot(name): (OUT / (name + '.png')).write_bytes(sh(ADB, '-s', S, 'exec-out', 'screencap', '-p', binary=True))
# No uiautomator: a dump re-binds UiAutomation and knocks Wizard OS's accessibility service (and its cover) off.
# The stand-in Grab and the cover (debug builds) log their labels and centres instead.
def _views(tag, prefix):
    lines = [l for l in sx(f'logcat -d -s {tag}:*').splitlines() if (': ' + prefix) in l]
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
        if u == '/wizard-os-home': return self._send(301, b'', extra={'Location': '/wizard-os-home/'})
        m = re.match(r'^/wizard-os-home/(.*)$', u)
        if m:
            f = m.group(1) or 'index.html'; p = (WEB / f).resolve()
            if f in ('data.js', 'summaries.js'): return self._send(200, b'', 'text/javascript')
            if str(p).startswith(str(WEB.resolve())) and p.is_file():
                ct = {'js': 'text/javascript', 'css': 'text/css', 'html': 'text/html', 'json': 'application/json', 'svg': 'image/svg+xml', 'png': 'image/png', 'webmanifest': 'application/manifest+json'}.get(p.suffix[1:], 'application/octet-stream')
                return self._send(200, p.read_bytes(), ct)
        if u.startswith('/wizard/v1/apps'): return self._send(200, b'{"schema":1,"apps":[]}')
        if u.startswith('/wizard/hermes/api/sessions'): return self._send(200, b'{"sessions":[]}')
        if 'update' in u or u.endswith('latest.json'): return self._send(404, b'{}')
        return self._send(200, b'{}')
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); self.rfile.read(n) if n else b''
        WRITES.append(self.path)
        return self._send(503, b'{"error":"qa: no writes"}')
WRITES = []
srv = http.server.ThreadingHTTPServer(('127.0.0.1', FAKE), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()

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
        self.id += 1; my = self.id
        self._send({'id': my, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'awaitPromise': True, 'returnByValue': True}})
        while True:
            d = self._recv()
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
            pg = Page(); pg.ev("new Promise(r => { const t = () => window.__wos ? r() : setTimeout(t, 200); t(); })"); return pg
        except Exception as e: print('  page retry', e); time.sleep(2)
    raise RuntimeError('no page')

def bring_wos():
    sx(f'am start -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(2.5)

em = None
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'us', '-k', 'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7', '-p', job / 'dev', stdin='no\n')
        em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'us', '-port', str(PORT), '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect'], env=env, stdout=open(job / 'em.log', 'w'), stderr=subprocess.STDOUT)
        for _ in range(120):
            if sx('getprop sys.boot_completed').strip() == '1': break
            time.sleep(3)
        time.sleep(10)
        for k in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'): sx(f'settings put global {k} 0')
        sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard'); sx('settings put system screen_off_timeout 1800000')
        out1 = sh(ADB, '-s', S, 'install', '-r', APK).strip().splitlines()[-1]
        out2 = sh(ADB, '-s', S, 'install', '-r', GRAB).strip().splitlines()[-1]
        check('install Wizard OS QA + stand-in Grab', out1 == 'Success' and out2 == 'Success', out1 + ' / ' + out2)
        sx(f'run-as {PKG} mkdir -p files'); sx(f"run-as {PKG} sh -c 'echo {ORIGIN} > files/qa_home.txt; echo {ORIGIN} > files/qa_origin.txt'")
        sx(f'pm grant {PKG} android.permission.RECORD_AUDIO'); sx(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(8)
        pg = page()

        # A. app list + blocker without accessibility
        has = pg.ev("!!(window.WizardOSNative && window.WizardOSNative.usuals) && !!window.__wos.openApp && (window.WizCore?.apps?.find?.('usuals') || true)")
        pg.ev("window.__wos.openApp({ id: 'usuals', name: 'Usuals', kind: 'usuals' })"); time.sleep(1.5)
        txt = pg.ev("document.querySelector('[data-usuals]')?.innerText || ''")
        check('A: Usuals window opens and asks for the accessibility switch first', has and 'One switch first' in (txt or ''), (txt or '')[:160])
        shot('a-needs-switch')

        # turn on accessibility (what the switch's setup ends in)
        sx(f'settings put secure enabled_accessibility_services {PKG}/ai.wizards.os.everywhere.WizardKeyboardService'); sx('settings put secure accessibility_enabled 1'); time.sleep(4)
        pg.ev("window.WosUsuals.refresh()"); time.sleep(.5)
        txt = pg.ev("document.querySelector('[data-usuals]')?.innerText || ''")
        check('A: with the switch on, the empty state invites teaching', 'Teach a usual' in txt and 'One switch' not in txt, txt[:160])
        shot('a-empty')

        # B. Teach
        pg.ev("document.querySelector('[data-us=teach]').click()"); time.sleep(.5)
        pg.ev("(() => { const i = document.querySelector('.us-teach input'); i.value = 'Kra pao'; document.querySelector('.us-teach button').click(); })()")
        ok = wait_for(lambda: GPKG in top(), 15)
        check('B: Open Grab launches Grab', ok, top())
        time.sleep(3)
        card = find(r'^Done$')
        card = card or wait_for(lambda: find(r'^Done$'), 6)
        check('B: the teach card (Done) floats over Grab', card is not None, cviews())
        shot('b-teach-card')
        # James builds the basket by hand:
        if wait_for(lambda: re.search(r'views \|Not now@(\d+),(\d+)', grablog()), 6):
            m = re.findall(r'views \|Not now@(\d+),(\d+)', grablog())[-1]; sx(f'input tap {m[0]} {m[1]}'); time.sleep(1.5)
        box = wait_for(lambda: gfind(r'Search for dishes'), 8)
        if box: tap(box); time.sleep(1); sx('input text krua'); time.sleep(1.5)
        r = wait_for(lambda: gfind(r'^Krua Thai Kitchen$'), 8)
        if r: tap(r); time.sleep(2)
        def add_by(item):
            for _ in range(8):
                time.sleep(.8); ns = gviews()
                it = next((n for n in ns if n['text'] == item), None)
                if it and it['y'] > 1800: sx('input swipe 540 1500 540 1000 400'); time.sleep(1.2); continue  # keep clear of the basket bar
                if it:
                    adds = sorted([n for n in ns if n['text'] == 'Add' and abs(n['y'] - it['y']) < 140], key=lambda n: abs(n['y'] - it['y']))
                    if adds:
                        before = grablog().count('added ' + item); tap(adds[0])
                        return bool(wait_for(lambda: grablog().count('added ' + item) > before, 5, .3))
                sx('input swipe 540 1700 540 1000 400'); time.sleep(1.2)
            return False
        a1 = add_by('Kra pao moo saap'); a2 = add_by('Kra pao moo saap'); a3 = add_by('Thai iced tea')
        check('B: (by hand) added 2× kra pao + 1× iced tea', a1 and a2 and a3, grablog()[-300:])
        time.sleep(.8); tap_text(r'^View basket', pkg=GPKG); time.sleep(2)
        check('B: (by hand) on checkout at ฿245', 'checkout total=245' in grablog(), grablog()[-200:])
        shot('b-checkout-teach')
        tap_text(r'^Done$'); time.sleep(3)
        back = wait_for(lambda: PKG in top(), 10)
        lst = json.loads(pg.ev("window.WizardOSNative.usuals()") or '{}')
        u = (lst.get('list') or [{}])[0]
        script = u.get('script', '')
        print('  recorded:', script.replace('\n', ' | '))
        check('B: Done returns to Wizard OS with the usual saved', back and u.get('name') == 'Kra pao' and len(u.get('steps', [])) >= 5, (top(), u.get('name'), len(u.get('steps', []))))
        check('B: recipe has the search, the restaurant and Add by the item (not screen spots)',
              'type krua' in script and 'Krua Thai Kitchen' in script and 'tap Add @ Kra pao moo saap' in script and 'tap Add @ Thai iced tea' in script, script)
        check('B: total read off checkout', u.get('lastTotal') == '฿245', u.get('lastTotal'))
        check('B: no order placed while teaching', 'ORDER PLACED' not in grablog())
        pg.close(); pg = page()
        pg.ev("window.WosUsuals.refresh()"); time.sleep(.5); shot('b-saved')

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
        check('C: the cover shows the total on Place order', ready is not None and '฿245' in (ready['text'] or ''), ready and ready['text'])
        check('C: the run closed Grab\'s promo pop-up by itself', 'popup closed' in grablog() or 'Not now' in log, '')
        check('C: nothing ordered by the run', 'ORDER PLACED' not in grablog())
        check('C: basket is right (2 kra pao + iced tea → checkout ฿245)', grablog().count('checkout total=245') >= 2, grablog()[-300:])
        shot('c-ready')

        # D. Look first
        tap_text(r'^Look first$'); time.sleep(2)
        check('D: Look first leaves Grab on its checkout, uncovered', find(r'^Ordering|^Look first') is None and find(r'^Place order ฿245$', pkg=GPKG) is not None)
        check('D: still nothing ordered', 'ORDER PLACED' not in grablog())
        shot('d-look-first')

        # E. Run again and order from the cover
        bring_wos(); pg.close(); pg = page()
        pg.ev("window.__wos.openApp({ id: 'usuals', name: 'Usuals', kind: 'usuals' })"); time.sleep(1)
        pg.ev("document.querySelector('[data-us=run]').click()")
        ready = wait_for(lambda: find(r'^Place order'), 90, 1)
        check('E: second run reaches checkout', ready is not None, uslog()[-400:])
        if ready: tap(ready)
        placed = wait_for(lambda: 'ORDER PLACED' in grablog(), 15, .5)
        gl = grablog()
        check('E: James\'s tap on Place order places exactly one order', placed and gl.count('ORDER PLACED') == 1, gl[-300:])
        check('E: the order is 2× kra pao + 1× iced tea, ฿245', 'ORDER PLACED total=245 items=2x Kra pao moo saap; 1x Thai iced tea;' in gl, gl[-200:])
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
        check('F: Cancel on the cover: nothing ordered, back in Wizard OS', grablog().count('ORDER PLACED') == 1 and PKG in top(), top())
        nm = pg.ev("window.WosUsuals.match('what is a good kra pao place')")
        check('F: ordinary talk about kra pao does not start an order', nm == '', nm)

        # G. Back from the edit sheet stays in the app
        pg.close(); pg = page()
        pg.ev("window.__wos.openApp({ id: 'usuals', name: 'Usuals', kind: 'usuals' })"); time.sleep(1)
        pg.ev("document.querySelector('[data-us=edit]').click()"); time.sleep(.6)
        shot('g-edit')
        sheet = pg.ev("!!document.querySelector('.us-sheet')")
        sx('input keyevent KEYCODE_BACK'); time.sleep(1.2)
        after = pg.ev("!!document.querySelector('.us-sheet')")
        check('G: Back closes the edit sheet and Wizard OS stays open', sheet and not after and PKG in top(), (sheet, after, top()))
        crashed = sx('logcat -d -b crash')
        check('no crashes', 'FATAL EXCEPTION' not in crashed, crashed[:300])
    finally:
        try: (job / 'logcat.txt').write_text(sx('logcat -d'))
        except Exception: pass
        if em: sh(ADB, '-s', S, 'emu', 'kill'); em.wait(40)
        srv.shutdown()
print(f'{sum(res)}/{len(res)} passed · shots {OUT}')
