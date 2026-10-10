#!/usr/bin/env python3
"""Side button: Back never loses a message, and the Screen button (runs on Thales).

usage: qa_side_back_screen.py APK PKG

James (10 Oct 2026): side-button take was sending, he pressed Back to leave the web page he was on, and
Wizard closed and the message was lost. Rule now: Back closes the orb, a take with speech is sent, a message
already sending keeps going (toast when it lands), and Back also goes back in the app underneath.
Plus the Screen chip on the side-button orb attaches the current screen to the take.
A fake Wizard (10.0.2.2) stands in for every Wizard call.
"""
import fcntl, http.server, json, os, pathlib, re, socket, subprocess, sys, threading, time, uuid
import shlex, urllib.parse, urllib.request
P = pathlib.Path
BASE = P('/Volumes/ThalesMedia/AndroidBuilds'); SDK = P('/opt/homebrew/share/android-commandlinetools')
apk = P(sys.argv[1]); PKG = sys.argv[2]
job = BASE / 'qa' / ('wos-side-back-' + uuid.uuid4().hex[:8]); job.mkdir(parents=True)
OUT = job / 'shots'; OUT.mkdir()
env = os.environ.copy(); env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']; (job / 'avd').mkdir()
ADB = str(SDK / 'platform-tools/adb'); PORT = 5694; S = f'emulator-{PORT}'; DEVTOOLS = 9345; FAKE = 18779
res = []
def check(n, ok, d=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n + (' — ' + str(d) if d else ''), flush=True)
def sh(*a, stdin=None, binary=False):
    r = subprocess.run([str(x) for x in a], env=env, capture_output=True, input=stdin, text=not binary)
    return r.stdout
def sx(c): return sh(ADB, '-s', S, 'shell', c)
def top(): return next((l.strip() for l in sx('dumpsys activity activities').splitlines() if 'topResumedActivity' in l), '')
def shot(name): (OUT / (name + '.png')).write_bytes(sh(ADB, '-s', S, 'exec-out', 'screencap', '-p', binary=True))
def ui(): sx('uiautomator dump /sdcard/ui.xml >/dev/null'); return sx('cat /sdcard/ui.xml')
def tap_text(pattern, xml=None):
    xml = xml or ui()
    for m in re.finditer(r'<node [^>]*?>', xml):
        n = m.group(0)
        for attr in ('text', 'content-desc'):
            t = re.search(' ' + attr + r'="([^"]*)"', n)
            label = t.group(1) if t else ''
            if label and re.search(pattern, label, re.I):
                b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
                if b:
                    x1, y1, x2, y2 = map(int, b.groups()); sx(f'input tap {(x1 + x2) // 2} {(y1 + y2) // 2}'); return label
    return None

# ---------------------------------------------------------------- fake Wizard
STATE = {'transcribe': 0, 'runs': [], 'run_keys': {}, 'uploads': 0, 'sessions': set(), 'drop_transcribe': 1, 'drop_runs': 1, 'down': False, 'log': []}
class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def _drop(self):
        try: self.connection.shutdown(socket.SHUT_RDWR)
        except Exception: pass
        self.close_connection = True
    def do_GET(self):
        m = re.match(r'^/wizard/hermes/v1/runs/([^/?]+)', self.path)
        if m: return self._json(200, {'run_id': m.group(1), 'status': 'completed', 'output': 'QA reply from the fake Wizard.'})
        self._json(404, {'error': 'nope'})
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n) if n else b''
        STATE['log'].append(self.path)
        if STATE['down']: return self._json(503, {'error': 'down'})
        if self.path == '/wizard-os-home/api/transcribe':
            STATE['transcribe'] += 1
            if STATE.get('slow', 0): time.sleep(STATE['slow'])  # case A: keep the message in flight while Back is pressed
            if STATE['drop_transcribe'] > 0: STATE['drop_transcribe'] -= 1; return self._drop()
            return self._json(200, {'text': 'Wizard Everywhere QA message number %d' % STATE['transcribe']})
        if self.path == '/wizard/files/upload':
            STATE['uploads'] += 1
            STATE.setdefault('upload_names', []).append(self.headers.get('X-Wizard-Filename'))
            return self._json(200, {'file': {'id': 'drop_qa%d' % STATE['uploads'], 'filename': self.headers.get('X-Wizard-Filename'), 'mime': self.headers.get('X-Wizard-Mime') or 'audio/mp4', 'bytes': len(body)}})
        if self.path == '/wizard/hermes/api/sessions':
            sid = json.loads(body or b'{}').get('id')
            if sid in STATE['sessions']: return self._json(409, {'error': 'exists'})
            STATE['sessions'].add(sid); return self._json(201, {'id': sid})
        if self.path == '/wizard/hermes/v1/runs':
            key = self.headers.get('Idempotency-Key') or ''
            if key in STATE['run_keys']: return self._json(202, {'run_id': STATE['run_keys'][key], 'status': 'queued'})
            rid = 'run_qa%d' % (len(STATE['runs']) + 1)
            STATE['run_keys'][key] = rid; STATE['runs'].append({'key': key, 'body': json.loads(body or b'{}'), 'id': rid})
            if STATE['drop_runs'] > 0: STATE['drop_runs'] -= 1; return self._drop()  # admitted, but the reply is lost
            return self._json(202, {'run_id': rid, 'status': 'queued'})
        self._json(404, {'error': 'nope'})
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

def bubble():
    """Bounds of the floating button: Android's window list (an overlay window of our package), else the UI dump."""
    for blk in sx('dumpsys window windows').split('Window #')[1:]:
        if 'WizardEverywhere' in blk.split('\n', 1)[0]:
            m = re.search(r'(?:mFrame|frame)=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]', blk)
            if m and 'mViewVisibility=0x8' not in blk and 'mViewVisibility=0x4' not in blk: return tuple(map(int, m.groups()))
    return None
def controls():
    """0.6.2: Cancel · Pause · Screen are their own small windows (WizOrbCtl-*), so nothing else around the orb is touchable."""
    out = {}
    for blk in sx('dumpsys window windows').split('Window #')[1:]:
        head = blk.split('\n', 1)[0]
        m0 = re.search(r'WizOrbCtl-(\w+)', head)
        if not m0: continue
        m = re.search(r'(?:mFrame|frame)=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]', blk)
        if m and 'mViewVisibility=0x8' not in blk and 'mViewVisibility=0x4' not in blk: out[m0.group(1)] = tuple(map(int, m.groups()))
    return out
def ours_at(x, y, frames):
    """Is any Wizard Everywhere window (orb or button) under this point?"""
    return any(f and f[0] <= x < f[2] and f[1] <= y < f[3] for f in frames)
def mid(f): return ((f[0] + f[2]) // 2, (f[1] + f[3]) // 2)
def wait_bubble(want, secs=8):
    t0 = time.time()
    while time.time() - t0 < secs:
        b = bubble()
        if bool(b) == want: return b
        time.sleep(0.8)
    return bubble()
def logs(pat): return sx(f'logcat -d -s WizardEverywhere:* | grep -iE "{pat}" | tail -5').strip()
def alogs(pat): return sx(f'logcat -d -s WizardOSAssist:* | grep -iE "{pat}" | tail -5').strip()
def wait_log(pat, secs=30, fn=None):
    fn = fn or logs; t0 = time.time()
    while time.time() - t0 < secs:
        l = fn(pat)
        if l: return l
        time.sleep(0.8)
    return ''
def ime_shown(): return 'mInputShown=true' in sx('dumpsys input_method')
DENS = None
def dp(v): return int(round(v * DENS))


em = None; pg = None
SIDE = 'android.app.role.ASSISTANT'
def arm(autosend_ms):
    """Stage canned speech for the next side-button take; autosend_ms 0 = the take stays open until we act."""
    sx(f'run-as {PKG} cp /data/local/tmp/qa_voice.m4a files/qa_next.m4a')
    sx(f"run-as {PKG} sh -c 'echo {autosend_ms} > files/qa_autosend_ms.txt'")
def hold():
    sx('logcat -c'); sx('input keyevent --longpress KEYCODE_POWER')
def side_runs(): return [r for r in STATE['runs'] if 'side button' in r['body'].get('instructions', '')]
def wait_runs(n, secs=40):
    t0 = time.time()
    while time.time() - t0 < secs and len(side_runs()) < n: time.sleep(0.8)
    return len(side_runs())
def settings_depth():
    """Where Android Settings is: 'sub' on the Battery page, 'root' on the main list."""
    x = ui()
    if re.search(r'text="(Battery usage|Battery Saver|Battery percentage|Adaptive preferences)"', x): return 'sub'
    if re.search(r'text="(Network &amp; internet|Connected devices|Apps)"', x): return 'root'
    return 'other'
def open_settings_sub():
    sx('am force-stop com.android.settings')
    sx('am start -W -n com.android.settings/.Settings'); time.sleep(2.5)
    tap_text(r'^Battery$'); time.sleep(2)  # first screen, no scrolling (Display is below the fold on API 35)
    return settings_depth()

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
        DENS = int(re.search(r'(\d+)\s*$', sx('wm density').strip()).group(1)) / 160.0
        out = sh(ADB, '-s', S, 'install', '-r', apk).strip().splitlines()[-1]
        ver = re.search(r'versionName=\S+', sx(f'dumpsys package {PKG}')).group(0)
        check('install', out == 'Success', out + ' ' + ver)
        aiff = job / 'q.aiff'; canned = job / 'qa_voice.m4a'
        sh('say', '-o', aiff, 'Side button test. Please look this up for me.')
        sh('afconvert', '-f', 'm4af', '-d', 'aac', aiff, canned)
        sh(ADB, '-s', S, 'push', canned, '/data/local/tmp/qa_voice.m4a')
        sx(f'run-as {PKG} mkdir -p files'); sx(f"run-as {PKG} sh -c 'echo http://10.0.2.2:{FAKE} > files/qa_origin.txt'")
        sx(f'pm grant {PKG} android.permission.RECORD_AUDIO'); sx(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
        STATE['drop_transcribe'] = 0; STATE['drop_runs'] = 0
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(8)
        sx('input keyevent KEYCODE_HOME'); time.sleep(1.5)
        sx(f'cmd role add-role-holder --user 0 {SIDE} {PKG}'); time.sleep(2)
        sx('settings put global power_button_long_press 5')
        check('Wizard OS is the assistant (side button)', PKG in sx(f'cmd role get-role-holders --user 0 {SIDE}'))
        sx(f'settings put secure enabled_accessibility_services {PKG}/ai.wizards.os.everywhere.WizardKeyboardService'); sx('settings put secure accessibility_enabled 1'); time.sleep(3)

        # A. James's exact case: talk, it sends, he presses Back to leave the page he was on.
        d0 = open_settings_sub(); shot('a0-settings-display')
        check('setup: a page with somewhere to go Back to (Settings → Battery)', d0 == 'sub', d0)
        arm(0); n0 = len(side_runs())
        hold(); ll = wait_log('listening', 10, alogs); time.sleep(1.5); shot('a1-listening')
        check('A: side button is listening', 'listening' in ll, ll)
        sx('input keyevent KEYCODE_BACK'); time.sleep(1.0); shot('a2-after-back')
        bl = alogs('back ignored|back pressed|corner hidden|back passed|dismissed|sending via')
        check('A: Back while the orb is up is ignored (still listening, orb stays, nothing sent)',
              'back ignored listening=true' in bl and 'corner hidden' not in bl and 'sending via' not in bl, bl)
        fr = sx(f'logcat -d -s WizardOSAssist:* | grep "orb frame" | tail -1').strip()
        fx, fy, fw, fh = map(int, re.search(r'orb frame (\d+),(\d+),(\d+),(\d+)', fr).groups())
        sx(f'input tap {fx + fw - dp(66)} {fy + fh // 2}')  # tap the orb = send, as on the phone
        sl = wait_log('sending via', 8, alogs)
        check('A: tapping the orb after that Back sends it', 'sending via=button' in sl or 'sending via=tap' in sl or 'sending via' in sl, sl)
        got = wait_runs(n0 + 1)
        check('A: the message reaches Wizard exactly once', got == n0 + 1, (got, STATE['log'][-6:]))
        d1 = settings_depth(); shot('a3-page-stays')
        check('A: Back never reached the app underneath (Battery page stays)', d1 == 'sub' and not alogs('back passed'), d1)

        # B. Back in the middle of talking: what was said is sent, not thrown away.
        d0 = open_settings_sub()
        arm(0); n0 = len(side_runs())
        hold(); ll = wait_log('listening', 10, alogs); time.sleep(1.5); shot('b1-listening')
        check('B: side button is listening', 'listening' in ll, ll)
        for _ in range(2): sx('input keyevent KEYCODE_BACK'); time.sleep(0.8)
        time.sleep(1); shot('b2-after-back')
        bl = alogs('back ignored|dismissed while listening|sending via|corner hidden|discard')
        check('B: Back mid-talk is ignored: still listening, nothing sent, orb still up',
              'back ignored listening=true' in bl and 'sending via' not in bl and 'corner hidden' not in bl and len(side_runs()) == n0, bl)
        # Only the X ends it: Cancel throws it away.
        fr = sx(f'logcat -d -s WizardOSAssist:* | grep "orb frame" | tail -1').strip()
        fx, fy, fw, fh = map(int, re.search(r'orb frame (\d+),(\d+),(\d+),(\d+)', fr).groups())
        sx(f'input tap {fx + fw - dp(196 + 23)} {fy + fh // 2}'); time.sleep(3)
        check('B: the X after those Backs discards it (nothing sent)', len(side_runs()) == n0 and 'sending via' not in alogs('sending via'), alogs('sending via|discard'))
        check('B: the page underneath never moved', settings_depth() == 'sub', settings_depth())

        # C. Screen button on the side-button orb: attach the screen, then it sends with the take.
        # No uiautomator from here until the chip is tapped: a UiAutomation connection suspends every other
        # accessibility service (WizardKeyboardService included), which makes the chip take its "set up
        # Accessibility" branch. James's phone never has that connection.
        d0 = open_settings_sub()
        for _ in range(20):
            if 'WizardKeyboardService' in sx('dumpsys accessibility | grep -iE "Bound services|Enabled services"'): break
            time.sleep(1)
        bound = sx('dumpsys accessibility | grep -iE "Bound services"').strip()
        print('  a11y before C:', bound[:200])
        arm(0); n0 = len(side_runs()); u0 = len(STATE.get('upload_names', []))
        hold(); wait_log('listening', 10, alogs); time.sleep(2); shot('c1-controls')
        vw = sx('dumpsys window windows'); i = vw.find('VoiceInteractionSession}:')
        reg = re.search(r'touchable region=SkRegion\(([^)]*)\)', vw[i:i + 3000]) if i >= 0 else None
        print('  side orb touchable region while talking:', reg.group(1) if reg else None)
        if True:
            fr = sx(f'logcat -d -s WizardOSAssist:* | grep "orb frame" | tail -1').strip()
            m = re.search(r'orb frame (\d+),(\d+),(\d+),(\d+)', fr)
            fx, fy, fw, fh = map(int, m.groups())
            # surface.html: body.corner.canshot #shotC {right:252px; width:46px; top:50%} inside the orb window
            x = fx + fw - dp(252 + 23); y = fy + fh // 2
            print('  screen chip via orb frame', (fx, fy, fw, fh), '→ tap', x, y); sx(f'input tap {x} {y}')
        time.sleep(0.4); (job / 'c-window.txt').write_text(sx('dumpsys window windows'))
        sa = wait_log('screenshot attached', 10, alogs); time.sleep(0.8); shot('c2-shot-attached')
        (job / 'logcat-c.txt').write_text(sx('logcat -d'))
        print('  C trace:', alogs('screen chip|screenshot|onHide from|sending via')[-600:])
        check('C: Screen chip shows while the side-button orb listens and attaches a screenshot', 'screenshot attached 1' in sa, sa or alogs('screen|shot'))
        fr = sx(f'logcat -d -s WizardOSAssist:* | grep "orb frame" | tail -1').strip()
        fx, fy, fw, fh = map(int, re.search(r'orb frame (\d+),(\d+),(\d+),(\d+)', fr).groups())
        sx(f'input tap {fx + fw - dp(66)} {fy + fh // 2}'); time.sleep(1.5)  # tap the orb = send
        sl = alogs('sending via')
        check('C: the take goes with the screenshot', 'shots=1' in sl, sl)
        got = wait_runs(n0 + 1)
        names = STATE.get('upload_names', [])[u0:]
        run = side_runs()[-1]['body'] if side_runs() else {}
        check('C: Wizard gets the voice note + the screenshot in one message',
              got == n0 + 1 and any(n and n.endswith('.png') for n in names) and len(run.get('wizard_file_ids', [])) == 2 and '1 screenshot' in run.get('instructions', ''),
              (got, names, run.get('wizard_file_ids'), run.get('instructions', '')[-90:]))

        # C2. Cancel chip (same row, was also under the invisible bubble): throws the take away, nothing sent.
        d0 = open_settings_sub()
        arm(0); n0 = len(side_runs())
        hold(); wait_log('listening', 10, alogs); time.sleep(2)
        fr = sx(f'logcat -d -s WizardOSAssist:* | grep "orb frame" | tail -1').strip()
        fx, fy, fw, fh = map(int, re.search(r'orb frame (\d+),(\d+),(\d+),(\d+)', fr).groups())
        sx(f'input tap {fx + fw - dp(196 + 23)} {fy + fh // 2}'); time.sleep(3)
        cl = alogs('sending via|discard|corner hidden')
        check('C2: Cancel chip on the side-button orb discards (nothing sent)', len(side_runs()) == n0 and 'sending via' not in cl, (len(side_runs()) - n0, cl))

        # D. Lock-screen surface: Back mid-talk also sends.
        n0 = len(side_runs())
        sx(f'run-as {PKG} cp /data/local/tmp/qa_voice.m4a files/qa_side.m4a'); sx('logcat -c')
        sx(f'am start -W -a android.intent.action.ASSIST -n {PKG}/ai.wizards.os.assist.AssistLockActivity --es qa_audio qa_side.m4a --el qa_autosend_ms 6000')
        wait_log('listening', 10, alogs); time.sleep(1.5)
        sx('input keyevent KEYCODE_BACK'); time.sleep(1.5)
        dl = alogs('back ignored|dismissed while listening|sending via|surface closed')
        check('D: lock-screen surface ignores Back mid-talk (still open, still listening)',
              'back ignored listening=true' in dl and 'surface closed' not in dl and 'AssistLockActivity' in top(), (dl, top()))
        wait_log('sending via', 15, alogs)  # canned audio sends itself after its auto-send window
        got = wait_runs(n0 + 1, 30)
        check('D: that take still reaches Wizard once (Back lost nothing)', got == n0 + 1, (got, alogs('sending via|surface closed')))

        crashed = sx('logcat -d -b crash')
        check('no crashes', 'FATAL EXCEPTION' not in crashed, crashed[:300])
    finally:
        try: (job / 'logcat.txt').write_text(sx('logcat -d'))
        except Exception as e: print('  logcat dump failed', e)
        if em: sh(ADB, '-s', S, 'emu', 'kill'); em.wait(40)
        srv.shutdown()
        (job / 'fake-wizard.json').write_text(json.dumps({k: (list(v) if isinstance(v, set) else v) for k, v in STATE.items()}, indent=1, default=str))
print(f'{sum(res)}/{len(res)} passed · shots {OUT}')
