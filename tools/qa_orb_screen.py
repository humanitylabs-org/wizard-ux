#!/usr/bin/env python3
"""Orb long-press QA (runs on Thales): fresh API35 emulator, the exact QA APK, real taps, long-presses and Back.

usage: qa_orb_screen.py APK PKG [WEB_DIR]

WEB_DIR (the worktree's web/) is served as the Wizard OS shell by the fake Wizard, since the emulator can't reach
the private network.

A fake Wizard Search on the Mac (the emulator reaches it as 10.0.2.2) answers /wizard-search/api/translate,
/wizard-search/api/read-image and the search page, so nothing reaches the real Wizard.

Checks
  hold the orb → a menu with Select text · Translate screen · Hide orb, the orb does not move or start talking
  Select text over Chrome showing text the page blocks from copying (0.9.21, Google style): no boxes; a finger
  drag selects exactly the words it crosses, handles extend it, Copy copies it, Search opens Wizard Search in a
  sheet, Translate gives English; a tap picks a whole line
  Back steps out one layer at a time (search → selection → Screen) and never leaves the app underneath
  Translate screen (Google Lens style) → the foreign text alone is translated and painted over in place, the pill
  names the detected language, the language list re-translates
  Ask Wizard → Wizard OS opens on its share sheet with the text
  a screen with no text layer (a picture) → Read picture text runs by itself
  Hide orb → the orb is gone, a "Floating orb hidden" notification brings it back; opening Wizard OS does too
  without Accessibility, Select text opens the one-step setup instead of failing
  no crashes
"""
import fcntl, http.server, json, os, pathlib, re, shlex, socket, subprocess, sys, threading, time, urllib.parse, urllib.request, uuid
from qa_paths import work_root
from qa_paths import android_sdk, java_home
P = pathlib.Path
BASE = P(str(work_root() / 'AndroidBuilds')); SDK = android_sdk()
apk = P(sys.argv[1]); PKG = sys.argv[2]; WEB = P(sys.argv[3]) if len(sys.argv) > 3 else P(__file__).resolve().parent.parent / 'web'
job = BASE / 'qa' / ('wos-orb-screen-' + uuid.uuid4().hex[:8]); job.mkdir(parents=True)
OUT = job / 'shots'; OUT.mkdir()
env = os.environ.copy(); env.update(JAVA_HOME=java_home(),
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:' + env['PATH']; (job / 'avd').mkdir()
ADB = str(SDK / 'platform-tools/adb'); PORT = 5696; S = f'emulator-{PORT}'; DEVTOOLS = 9347; FAKE = 18779
res = []
def check(n, ok, d=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n + (' — ' + str(d)[:400] if d not in ('', None) else ''), flush=True)
def sh(*a, stdin=None, binary=False):
    return subprocess.run([str(x) for x in a], env=env, capture_output=True, input=stdin, text=not binary).stdout
def sx(c): return sh(ADB, '-s', S, 'shell', c)
def top(): return next((l.strip() for l in sx('dumpsys activity activities').splitlines() if 'topResumedActivity' in l), '')
def shot(name): (OUT / (name + '.png')).write_bytes(sh(ADB, '-s', S, 'exec-out', 'screencap', '-p', binary=True))
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
def logs(pat): return sx(f'logcat -d -s WizardEverywhere:* | grep -iE "{pat}" | tail -5').strip()
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
STATE = {'translate': [], 'read': 0, 'search': [], 'log': []}
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
        if self.path == '/wizard-search/api/read-image':
            STATE['read'] += 1
            return self._json(200, {'lines': ['CLOSED ON MONDAY', 'ปิดวันจันทร์'], 'model': 'qa', 'ms': 5})
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

def open_menu():
    b = wait_window('WizardEverywhere', True, 10)
    if not b: return None, None
    x, y = mid(b); hold(x, y, 1000)
    return b, wait_window('WizOrbMenu', True, 5)

em = None
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
        out = sh(ADB, '-s', S, 'install', '-r', apk).strip().splitlines()[-1]
        check('QA build installs', out == 'Success', out + ' ' + (re.search(r'versionName=\S+', sx(f'dumpsys package {PKG}')) or [''])[0])
        sx(f'run-as {PKG} mkdir -p files'); sx(f"run-as {PKG} sh -c 'echo http://10.0.2.2:{FAKE} > files/qa_origin.txt; echo http://localhost:{FAKE} > files/qa_home.txt'")
        sh(ADB, '-s', S, 'reverse', f'tcp:{FAKE}', f'tcp:{FAKE}')
        sx(f'pm grant {PKG} android.permission.RECORD_AUDIO'); sx(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
        sx(f'appops set {PKG} SYSTEM_ALERT_WINDOW allow'); sx(f'appops set {PKG} ACCESS_RESTRICTED_SETTINGS allow')
        sx(f'settings put secure enabled_accessibility_services {PKG}/ai.wizards.os.everywhere.WizardKeyboardService'); sx('settings put secure accessibility_enabled 1')
        sx('logcat -c')
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(9)
        pg = Page('wizard-os-home')
        pg.ev("new Promise(r => { const t0 = Date.now(), t = () => window.__wos || Date.now() - t0 > 20000 ? r() : setTimeout(t, 200); t(); })")
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
        p = wait_peek(sp, lambda p: p and p.get('painted'), 10); shot('08-translate-screen')
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
        check('Ask Wizard opens Wizard OS with the text (and the screen picture)', ask and 'shot=' in ask and PKG in top(), (ask, top()))
        sp.close()
        try:
            pg = Page('wizard-os-home')
            sheet = None
            for _ in range(10):
                sheet = pg.ev("(() => { const t = document.querySelector('.dv-quote'); const img = document.querySelectorAll('.dv-items .ch-att').length; return t ? {text: t.textContent, items: img} : null; })()")
                if sheet: break
                time.sleep(0.6)
            check('the Wizard OS share sheet holds the original text, its English and the screen picture', sheet and 'ผัด' in sheet['text'] and 'English:' in sheet['text'] and 'EN(' in sheet['text'] and sheet['items'] == 1, sheet)
            sx('input keyevent KEYCODE_BACK'); time.sleep(1)
            pg.close()
        except Exception as e:
            check('the Wizard OS share sheet holds the selected text', False, e)

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
        check('opening Wizard OS brings the orb back too', wait_window('WizardEverywhere', True, 6), bubble())

        # ---------------- without Accessibility: Select text opens the setup
        sx('settings put secure enabled_accessibility_services ""'); time.sleep(3)
        b, m = open_menu(); tap_text(r'^Select text$'); time.sleep(3); shot('12-no-a11y')
        x = ui()
        check('without Accessibility, Select text opens Wizard OS on the one-step setup', PKG in top() and re.search('voice typing|Accessibility', x, re.I), (top(), re.findall(r'text="([^"]+)"', x)[:8]))

        crashed = sx('logcat -d -b crash')
        # Only Wizard OS counts: a uiautomator dump racing the emulator ("FATAL EXCEPTION: UiAutomation") is the harness.
        mine = [b for b in crashed.split('FATAL EXCEPTION')[1:] if 'UiAutomation' not in b.split('\n', 1)[0]]
        pids = sx(f'pidof {PKG}').split()
        check('no Wizard OS crashes', not mine and f'Process: {PKG}' not in crashed, (crashed[:400], pids))
    except Exception as e:
        import traceback; traceback.print_exc()
        check('script ran to the end', False, repr(e)); shot('zz-error')
        print(sx("logcat -d | grep -E 'AndroidRuntime|WizardEverywhere|chromium' | tail -40"))
    finally:
        if em: sh(ADB, '-s', S, 'emu', 'kill'); em.wait(40)
print(f'{sum(res)}/{len(res)} passed · {job}')
