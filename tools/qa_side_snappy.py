#!/usr/bin/env python3
"""Side button 0.8.6: snappy close, screen never sleeps while any orb is live, a take is never lost to an update/kill.

usage: qa_side_snappy.py APK PKG [QANEXT_APK]

James (10 Oct 2026):
 1. after a side-button message is sent the orb lingered 1-2 s ("Sending to Wizard" / "Sent · tap to open" bubble);
 2. talking for a while the screen dimmed toward lock (side-button orb had no keep-screen-on);
 3. he paused a take, an update popped up (Wizard OS installed itself: a paused take was not "recording"), and the
    take was gone.
Checks: A snappy close, B/C/D screen awake (side orb, in-app orb, floating orb carrying the app take), E paused take
holds a ready update (needs QANEXT_APK), F a take cut off by an app update is recovered and sent.
A fake Wizard (10.0.2.2) stands in for every Wizard call.
"""
import fcntl, http.server, json, os, pathlib, re, socket, subprocess, sys, threading, time, uuid
import shlex, urllib.parse, urllib.request
from qa_paths import work_root
from qa_paths import android_sdk, java_home
P = pathlib.Path
BASE = P(str(work_root() / 'AndroidBuilds')); SDK = android_sdk()
apk = P(sys.argv[1]); PKG = sys.argv[2]; NEXT = P(sys.argv[3]) if len(sys.argv) > 3 else None
job = BASE / 'qa' / ('wos-side-snappy-' + uuid.uuid4().hex[:8]); job.mkdir(parents=True)
OUT = job / 'shots'; OUT.mkdir()
env = os.environ.copy(); env.update(JAVA_HOME=java_home(),
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:' + env['PATH']; (job / 'avd').mkdir()
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
        u = self.path.split('?')[0]
        if u == '/reports/wizard-os/latest.json':
            if not STATE.get('feed'): return self._json(404, {'error': 'none'})
            return self._json(200, STATE['feed'])
        if u == '/reports/wizard-os/wizard-os-qanext.apk' and NEXT:
            STATE['apk_gets'] = STATE.get('apk_gets', 0) + 1
            b = NEXT.read_bytes(); self.send_response(200); self.send_header('Content-Type', 'application/vnd.android.package-archive'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b); return
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
            STATE.setdefault('upload_mimes', []).append(self.headers.get('X-Wizard-Mime'))
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
    sx(f'run-as {PKG} cp /data/local/tmp/qa_voice.m4a files/qa_next.m4a')
    sx(f"run-as {PKG} sh -c 'echo {autosend_ms} > files/qa_autosend_ms.txt'")
def hold():
    sx('logcat -c'); sx('input keyevent --longpress KEYCODE_POWER')
def side_runs(): return [r for r in STATE['runs'] if 'side button' in r['body'].get('instructions', '')]
def wait_runs(n, secs=40):
    t0 = time.time()
    while time.time() - t0 < secs and len(side_runs()) < n: time.sleep(0.8)
    return len(side_runs())
def ts(line):
    m = re.search(r'(\d\d):(\d\d):(\d\d)\.(\d{3})', line or '')
    return int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3]) + int(m[4]) / 1000 if m else None
def keep_on_windows():
    """Window titles (first line of each dumpsys block) whose flags include KEEP_SCREEN_ON."""
    out = []
    for blk in sx('dumpsys window windows').split('Window #')[1:]:
        if 'KEEP_SCREEN_ON' in blk: out.append(blk.split('\n', 1)[0][:120])
    return out
def awake(): return (re.search(r'mWakefulness=(\w+)', sx('dumpsys power')) or [None, '?'])[1]
def orb_frame():
    fr = sx('logcat -d -s WizardOSAssist:* | grep "orb frame" | tail -1').strip()
    m = re.search(r'orb frame (\d+),(\d+),(\d+),(\d+)', fr)
    return tuple(map(int, m.groups())) if m else None
def tap_side_pause():
    f = orb_frame()
    if not f: return False
    fx, fy, fw, fh = f; sx(f'input tap {fx + fw - dp(140 + 28)} {fy + fh // 2}'); return True
def tap_side_cancel():
    f = orb_frame()
    if not f: return False
    fx, fy, fw, fh = f; sx(f'input tap {fx + fw - dp(196 + 23)} {fy + fh // 2}'); return True

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
        sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard'); sx('svc power stayon false')
        sx('settings put system screen_off_timeout 1800000')
        DENS = int(re.search(r'(\d+)\s*$', sx('wm density').strip()).group(1)) / 160.0
        out = sh(ADB, '-s', S, 'install', '-r', apk).strip().splitlines()[-1]
        ver = re.search(r'versionName=\S+', sx(f'dumpsys package {PKG}')).group(0)
        check('install', out == 'Success', out + ' ' + ver)
        aiff = job / 'q.aiff'; canned = job / 'qa_voice.m4a'; adts = job / 'take.aac'
        sh('say', '-o', aiff, 'Side button test. This message was cut off by an update and must still arrive.')
        sh('afconvert', '-f', 'm4af', '-d', 'aac', aiff, canned)
        sh('afconvert', '-f', 'adts', '-d', 'aac', aiff, adts)
        sh(ADB, '-s', S, 'push', canned, '/data/local/tmp/qa_voice.m4a'); sh(ADB, '-s', S, 'push', adts, '/data/local/tmp/take.aac')
        sx(f'run-as {PKG} mkdir -p files'); sx(f"run-as {PKG} sh -c 'echo http://10.0.2.2:{FAKE} > files/qa_origin.txt'")
        sx(f'pm grant {PKG} android.permission.RECORD_AUDIO'); sx(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
        sx(f'appops set {PKG} SYSTEM_ALERT_WINDOW allow')
        STATE['drop_transcribe'] = 0; STATE['drop_runs'] = 0
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(8)
        sx('input keyevent KEYCODE_HOME'); time.sleep(1.5)
        sx(f'cmd role add-role-holder --user 0 {SIDE} {PKG}'); time.sleep(2)
        sx('settings put global power_button_long_press 5')
        check('Wizard OS is the assistant (side button)', PKG in sx(f'cmd role get-role-holders --user 0 {SIDE}'))

        # A. Snappy: after the take is sent the orb is gone within ~1 s, no lingering bubble, no "Sent" toast.
        arm(1500); n0 = len(side_runs())
        hold(); sl = wait_log('sending via=', 12, alogs)
        t_send = ts(sl); time.sleep(0.25); shot('a1-just-sent')
        hid = wait_log('corner hidden', 6, alogs); t_hide = ts(hid)
        gap = (t_hide - t_send) if (t_send is not None and t_hide is not None) else None
        check('A: the side-button orb closes itself right after sending (≤ 1.0 s, no lingering bubble)', gap is not None and gap <= 1.0, (gap, sl, hid))
        time.sleep(1.2); shot('a2-gone')
        got = wait_runs(n0 + 1)
        check('A: the message reaches Wizard exactly once', got == n0 + 1, got)
        time.sleep(3)
        toasts = alogs('toast:')
        check('A: no "Sending/Sent to Wizard" toast hangs around afterwards', 'Sent to Wizard' not in toasts and 'Still sending' not in toasts, toasts)
        check('A: the "sent" chime/haptic fired as it left', 'sent; corner closes itself' in alogs('closes itself'), alogs('closes itself'))

        # B. Side-button orb keeps the screen on while talking AND while paused; lets go after.
        sx('settings put system screen_off_timeout 15000'); sx('input keyevent KEYCODE_WAKEUP')
        arm(0); n0 = len(side_runs())
        hold(); wait_log('listening', 10, alogs); time.sleep(1.5)
        kw = keep_on_windows()
        check('B: side-button orb holds keep-screen-on while listening', any('VoiceInteraction' in w or 'Voice' in w for w in kw) or 'keep screen on true' in alogs('keep screen on'), (kw, alogs('keep screen on')))
        tap_side_pause(); time.sleep(1)
        check('B: Pause pauses the side-button take', 'paused' in alogs(': paused|paused$'), alogs('paused|resumed'))
        time.sleep(24)   # > 15 s screen timeout
        w = awake(); shot('b1-paused-25s')
        check('B: paused 25 s with a 15 s screen timeout: screen still on (no dim, no lock)', w == 'Awake', w)

        # E (with QANEXT): a newer Wizard OS is ready while the take is paused: it must wait, not install.
        if NEXT:
            sha = __import__('hashlib').sha256(NEXT.read_bytes()).hexdigest()
            BT = sorted((SDK / 'build-tools').iterdir())[-1]
            signer = (re.search(r'SHA-256 digest: ([0-9a-f]{64})', sh(BT / 'apksigner', 'verify', '--print-certs', NEXT)) or [None, ''])[1]
            vc0 = re.search(r'versionCode=(\d+)', sx(f'dumpsys package {PKG}')).group(1)
            STATE['feed'] = {'app': PKG, 'version': 'qanext', 'versionName': 'qanext', 'versionCode': 9000 + int(vc0), 'url': 'wizard-os-qanext.apk',
                             'bytes': NEXT.stat().st_size, 'sha256': sha, 'signer': signer, 'notes': 'QA'}
            sx(f"run-as {PKG} sh -c 'echo http://10.0.2.2:{FAKE} > files/qa_home.txt'")
            sx(f'appops set {PKG} REQUEST_INSTALL_PACKAGES allow')
            sx(f'cmd jobscheduler run -f {PKG} 7611')
            d = wait_log('step DEFER', 60, lambda p: sx(f'logcat -d -s WizardUpdate:* | grep -iE "{p}" | tail -3').strip())
            time.sleep(22)
            vc1 = re.search(r'versionCode=(\d+)', sx(f'dumpsys package {PKG}')).group(1)
            ul = sx('logcat -d -s WizardUpdate:* | grep -iE "step|verified|session" | tail -6').strip()
            check('E: update downloaded while the side-button take is paused, but deferred (nothing installs)', 'DEFER' in d and vc1 == vc0 and 'session' not in ul, (vc0, vc1, ul[-300:]))
            check('E: the paused take is still alive after the deferral', 'corner hidden' not in alogs('corner hidden') and sx(f'pidof {PKG}').strip() != '', alogs('corner hidden|discard'))
            sx(f"run-as {PKG} rm -f files/qa_home.txt"); STATE['feed'] = None
        tap_side_pause(); time.sleep(0.8)
        check('B: Pause again carries on', 'resumed' in alogs('resumed'), alogs('paused|resumed'))
        tap_side_cancel(); time.sleep(2.5)
        check('B: Cancel discards, nothing sent', len(side_runs()) == n0, len(side_runs()) - n0)
        kw2 = keep_on_windows()
        check('B: after the take ends nothing holds the screen on', not any('Voice' in w for w in kw2), kw2)
        sx('settings put system screen_off_timeout 1800000'); sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard')

        # C/D. In-app orb keeps the screen on; leave the app mid-take → floating orb carries it and keeps it on.
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(3)
        try:
            pg = Page(); wait_shell(pg)
            pg.ev("window.__wos.closeSheets && window.__wos.closeSheets()")
            pg.ev("window.WizardOSNative.setEverywhere(true)"); time.sleep(1.5)
            sx('logcat -c'); pg.ev("window.__wos.startVoice('auto')"); time.sleep(2.5)
            kw = keep_on_windows()
            check('C: in-app orb recording holds keep-screen-on on the app window', any('MainActivity' in w for w in kw), kw)
            sx('input keyevent KEYCODE_HOME'); time.sleep(3.5)
            kw = keep_on_windows(); el = logs('keep screen on|app voice')
            check('D: leave the app mid-take → floating orb carries it and keeps the screen on', any('WizardEverywhere' in w for w in kw) or 'keep screen on true' in el, (kw, el))
            sx('settings put system screen_off_timeout 15000'); sx('input keyevent KEYCODE_WAKEUP')
            time.sleep(22); w = awake(); shot('d1-carry-22s')
            check('D: carried take, 22 s with a 15 s timeout: screen still on', w == 'Awake', w)
            sx('settings put system screen_off_timeout 1800000'); sx('input keyevent KEYCODE_WAKEUP')
            sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(2.5)
            pg.close(); pg = Page(); wait_shell(pg)
            pg.ev("window.__wos.cancelVoice && window.__wos.cancelVoice(true)"); time.sleep(2)
            pg.ev("window.WizardOSNative.setEverywhere(false)"); time.sleep(1)
            sx('input keyevent KEYCODE_HOME'); time.sleep(1.5)
        except Exception as e:
            check('C/D: in-app page reachable for the orb checks', False, repr(e)[:300])

        # F. A side-button take cut off mid-recording by an app update (process killed) is recovered and sent.
        n0 = len(side_runs()); m0 = len(STATE.get('upload_mimes', []))
        sx(f"run-as {PKG} sh -c 'mkdir -p files/side-takes && cp /data/local/tmp/take.aac files/side-takes/side-1791000000000.aac'")
        sx('logcat -c')
        out = sh(ADB, '-s', S, 'install', '-r', apk).strip().splitlines()[-1]   # same as an update: kill + MY_PACKAGE_REPLACED
        got = wait_runs(n0 + 1, 60)
        rl = alogs('recovered')
        mimes = STATE.get('upload_mimes', [])[m0:]
        check('F: after the update the cut-off take is recovered and sent to Wizard (once)', got == n0 + 1 and 'recovered an unfinished take' in rl, (got - n0, rl))
        check('F: it travels as AAC (audio/aac voice note)', 'audio/aac' in mimes, mimes)
        left = sx(f'run-as {PKG} ls files/side-takes').split()
        check('F: nothing left behind to send twice', not left, left)
        sx(f'am force-stop {PKG}'); time.sleep(1); hold(); time.sleep(3); sx('input keyevent KEYCODE_BACK'); time.sleep(3)
        check('F: a later restart does not send it again', len(side_runs()) <= n0 + 2 and 'recovered an unfinished take' not in alogs('recovered'), (len(side_runs()) - n0, alogs('recovered')))

        crashed = sx('logcat -d -b crash')
        check('no crashes', 'FATAL EXCEPTION' not in crashed, crashed[:300])
    finally:
        try: (job / 'logcat.txt').write_text(sx('logcat -d'))
        except Exception as e: print('  logcat dump failed', e)
        if em: sh(ADB, '-s', S, 'emu', 'kill'); em.wait(40)
        srv.shutdown()
        (job / 'fake-wizard.json').write_text(json.dumps({k: (list(v) if isinstance(v, set) else v) for k, v in STATE.items() if k != 'feed'}, indent=1, default=str))
print(f'{sum(res)}/{len(res)} passed · shots {OUT}')
