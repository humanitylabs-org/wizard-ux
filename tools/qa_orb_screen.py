#!/usr/bin/env python3
"""Orb long-press QA (runs on Thales): fresh API35 emulator, the exact QA APK, real taps, long-presses and Back.

usage: qa_orb_screen.py APK PKG

A fake Wizard Search on the Mac (the emulator reaches it as 10.0.2.2) answers /wizard-search/api/translate,
/wizard-search/api/read-image and the search page, so nothing reaches the real Wizard.

Checks
  hold the orb → a menu with Select text · Translate screen · Hide orb, the orb does not move or start talking
  Select text over Chrome showing text the page blocks from copying → every line is a block, a tap selects it,
  Copy puts it on the clipboard, Search opens Wizard Search in a sheet, Translate gives English
  Back steps out one layer at a time (search → selection → Screen) and never leaves the app underneath
  Translate screen → English laid over the text
  Ask Wizard → Wizard OS opens on its share sheet with the text
  a screen with no text layer (a picture) → Read picture text runs by itself
  Hide orb → the orb is gone, a "Floating orb hidden" notification brings it back; opening Wizard OS does too
  without Accessibility, Select text opens the one-step setup instead of failing
  no crashes
"""
import fcntl, http.server, json, os, pathlib, re, shlex, socket, subprocess, sys, threading, time, urllib.parse, urllib.request, uuid
P = pathlib.Path
BASE = P('/Volumes/ThalesMedia/AndroidBuilds'); SDK = P('/opt/homebrew/share/android-commandlinetools')
apk = P(sys.argv[1]); PKG = sys.argv[2]
job = BASE / 'qa' / ('wos-orb-screen-' + uuid.uuid4().hex[:8]); job.mkdir(parents=True)
OUT = job / 'shots'; OUT.mkdir()
env = os.environ.copy(); env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']; (job / 'avd').mkdir()
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
            items = json.loads(body).get('items', []); STATE['translate'].append(items)
            return self._json(200, {'to': 'English', 'from': 'Thai', 'items': ['EN(' + str(i) + ')' for i in items], 'ms': 5})
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
        sx(f'run-as {PKG} mkdir -p files'); sx(f"run-as {PKG} sh -c 'echo http://10.0.2.2:{FAKE} > files/qa_origin.txt'")
        sh(ADB, '-s', S, 'reverse', f'tcp:{FAKE}', f'tcp:{FAKE}')
        sx(f'pm grant {PKG} android.permission.RECORD_AUDIO'); sx(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
        sx(f'appops set {PKG} SYSTEM_ALERT_WINDOW allow'); sx(f'appops set {PKG} ACCESS_RESTRICTED_SETTINGS allow')
        sx(f'settings put secure enabled_accessibility_services {PKG}/ai.wizards.os.everywhere.WizardKeyboardService'); sx('settings put secure accessibility_enabled 1')
        sx('logcat -c')
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(9)
        pg = Page('wizard-os-home')
        pg.ev("new Promise(r => { const t = () => window.__wos ? r() : setTimeout(t, 200); t(); })")
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
        p = wait_peek(sp, lambda p: p and p.get('blocks'), 8)
        texts = [bl['t'] for bl in (p or {}).get('blocks', [])]
        want = ['ผัดกะเพราหมูสับไข่ดาว', 'ส่งฟรีเมื่อสั่งครบ 200 บาท', 'Order number 4471 ready at counter']
        check('every line of the copy-blocked page is a selectable block', all(any(t2 in t for t in texts) for t2 in want), texts[:12])
        check('the frozen screen picture is behind the blocks', p and p.get('shot'), p and p.get('shot'))
        thai = next(bl for bl in p['blocks'] if 'ผัดกะเพรา' in bl['t'])
        sx(f"input tap {thai['x']} {thai['y']}"); time.sleep(0.8)
        p = peek(sp); shot('04-selected')
        check('a tap selects that line and the action sheet shows it', p['sheet'] and 'ผัดกะเพรา' in p['sheetText'] and len(p['sel']) == 1, (p['sel'], p['sheetText'][:80]))
        sx(f"input tap {p['btn']['aCopy'][0]} {p['btn']['aCopy'][1]}"); time.sleep(0.8)
        cl = wait_log('screen copied chars=', 4)
        check('Copy puts it on the clipboard (text the page blocks from copying)', cl and 'chars=' in cl, cl)
        # a swipe across the other two lines adds them
        b2 = next(bl for bl in p['blocks'] if 'ส่งฟรี' in bl['t']); b3 = next(bl for bl in p['blocks'] if 'Order number' in bl['t'])
        sx(f"input swipe {b2['x']} {b2['y']} {b3['x']} {b3['y']} 500"); time.sleep(0.8)
        p = peek(sp)
        check('a swipe over more lines adds them to the selection', len(p['sel']) >= 3 and 'Order number' in p['sheetText'], (p['sel'], p['sheetText'][:120]))
        sx(f"input tap {p['btn']['aTrans'][0]} {p['btn']['aTrans'][1]}")
        p = wait_peek(sp, lambda p: p.get('trans') and p['trans'].get('text'), 8); shot('05-translated-selection')
        check('Translate turns the selection into English (Wizard Search)', p.get('trans') and 'EN(' in (p['trans'].get('text') or '') and STATE['translate'], (p.get('trans'), STATE['translate'][-1:] if STATE['translate'] else None))
        sx(f"input tap {p['btn']['aSearch'][0]} {p['btn']['aSearch'][1]}")
        p = wait_peek(sp, lambda p: p.get('searching'), 6); time.sleep(2.5); shot('06-search-sheet')
        check('Search opens Wizard Search for the selection in a sheet', p.get('searching') and STATE['search'] and 'ผัดกะเพรา' in STATE['search'][-1], STATE['search'][-1:] if STATE['search'] else None)
        # Back: one layer at a time
        sx('input keyevent KEYCODE_BACK'); time.sleep(1)
        p = peek(sp)
        check('Back closes the search sheet first, Screen mode stays', not p.get('searching') and window('WizScreen'), (p.get('searching'), window('WizScreen')))
        for i in range(4):
            if not window('WizScreen'): break
            sx('input keyevent KEYCODE_BACK'); time.sleep(1)
        check('more Backs step out of the selection, then out of Screen mode', not window('WizScreen'), i)
        check('… and never leave the app underneath (Chrome still in front)', 'chrome' in top(), top())
        check('the orb comes back when Screen mode closes', wait_window('WizardEverywhere', True, 6), bubble())
        sp.close()

        # ---------------- Translate screen
        b, m = open_menu()
        tap_text(r'^Translate screen$'); time.sleep(0.5)
        wait_window('WizScreen', True, 8)
        sp = screen_page()
        p = wait_peek(sp, lambda p: p and p.get('en', 0) > 0, 10); shot('07-translate-screen')
        check('Translate screen lays English over the text in place', p and p.get('en', 0) >= 3 and p.get('showEn'), (p or {}).get('en'))
        sent = STATE['translate'][-1] if STATE['translate'] else []
        check('… text only: toolbar icon labels are not translated over the icons', sent and not any(t in sent for t in ('New tab', 'Switch or close tabs', 'Customize and control Google Chrome')), sent[:8])
        # Ask Wizard from here: select one line, Ask
        thai = next(bl for bl in p['blocks'] if 'ผัดกะเพรา' in bl['t'])
        sx(f"input tap {thai['x']} {thai['y']}"); time.sleep(0.8); p = peek(sp)
        sx(f"input tap {p['btn']['aAsk'][0]} {p['btn']['aAsk'][1]}"); time.sleep(4)
        ask = wait_log('screen ask staged', 5); shot('08-ask-wizard')
        check('Ask Wizard opens Wizard OS with the text (and the screen picture)', ask and 'shot=' in ask and PKG in top(), (ask, top()))
        sp.close()
        try:
            pg = Page('wizard-os-home')
            sheet = None
            for _ in range(10):
                sheet = pg.ev("(() => { const t = document.querySelector('.dv-text'); const img = document.querySelectorAll('.dv-item').length; return t ? {text: t.value, items: img} : null; })()")
                if sheet: break
                time.sleep(0.6)
            check('the Wizard OS share sheet holds the original text, its English and the screen picture', sheet and 'ผัดกะเพรา' in sheet['text'] and 'English:' in sheet['text'] and 'EN(' in sheet['text'] and sheet['items'] == 1, sheet)
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
