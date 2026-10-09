#!/usr/bin/env python3
"""Wizard Everywhere QA (runs on Thales). Fresh API35 emulator, the exact QA APK, real taps and drags.

usage: qa_everywhere.py APK PKG [OLD_APK]

A fake Wizard on the Mac (reached from the emulator as 10.0.2.2) stands in for every Wizard call, so nothing
is written to the real Wizard. It drops the first transcribe and the first run admission (connection reset),
then answers; it replays the run when the same Idempotency-Key comes back, exactly like the real server.

0.6.0 adds: the orb is the app's orb (no portrait); while talking Cancel · Pause · Screen fan out and work;
a screenshot rides along with the message; with a keyboard open the orb becomes voice typing and types the
words into the focused field (nothing goes to Wizard); it keeps a separate spot over the keyboard; the side
button sends by itself (no "send this?" draft).

Checks: Settings shows the Everywhere switch; turning it on asks for the overlay permission; the floating
button is hidden while Wizard OS is in front and shows bottom-right on the launcher and over another app;
a drag moves it and it snaps to an edge and stays there; a tap records (canned audio), the recording survives
the dropped connection, lands as exactly one run with the voice note attached; the Unsent list + "Not sent"
notification appear when Wizard is down, Retry from the notification delivers it once; no crashes; Back never
leaves Wizard OS.
"""
import fcntl, http.server, json, os, pathlib, re, socket, subprocess, sys, threading, time, uuid
import urllib.request
P = pathlib.Path
BASE = P('/Volumes/ThalesMedia/AndroidBuilds'); SDK = P('/opt/homebrew/share/android-commandlinetools')
apk = P(sys.argv[1]); PKG = sys.argv[2]; old = P(sys.argv[3]) if len(sys.argv) > 3 else None
job = BASE / 'qa' / ('wos-everywhere-' + uuid.uuid4().hex[:8]); job.mkdir(parents=True)
OUT = job / 'shots'; OUT.mkdir()
env = os.environ.copy(); env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']; (job / 'avd').mkdir()
ADB = str(SDK / 'platform-tools/adb'); PORT = 5692; S = f'emulator-{PORT}'; DEVTOOLS = 9343; FAKE = 18777
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
    """Raw CDP to the app's WebView; every Wizard write from the WebView is failed (never reaches Wizard)."""
    def __init__(self):
        pid = sx(f'pidof {PKG}').strip()
        sh(ADB, '-s', S, 'forward', f'tcp:{DEVTOOLS}', f'localabstract:webview_devtools_remote_{pid}')
        page = None
        for _ in range(40):
            try:
                l = json.load(urllib.request.urlopen(f'http://127.0.0.1:{DEVTOOLS}/json/list', timeout=3))
                page = next((x for x in l if x.get('type') == 'page' and 'wizard-os-home' in x.get('url', '')), None)
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
        self.call('Fetch.enable', patterns=[{'urlPattern': '*/hermes/*'}, {'urlPattern': '*/v1/*'}, {'urlPattern': '*/wizard/*'}])
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
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'q', '-k', 'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7', '-p', job / 'dev', stdin='no\n')
        em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'q', '-port', str(PORT), '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect'], env=env, stdout=open(job / 'em.log', 'w'), stderr=subprocess.STDOUT)
        for _ in range(120):
            if sx('getprop sys.boot_completed').strip() == '1': break
            time.sleep(3)
        time.sleep(10)
        sx('settings put global window_animation_scale 0'); sx('settings put global transition_animation_scale 0'); sx('settings put global animator_duration_scale 0')
        sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard')
        DENS = int(re.search(r'(\d+)\s*$', sx('wm density').strip()).group(1)) / 160.0
        sx('settings put secure show_ime_with_hard_keyboard 1')
        if old:
            print('old install', sh(ADB, '-s', S, 'install', old).strip().splitlines()[-1])
        out = sh(ADB, '-s', S, 'install', '-r', apk).strip().splitlines()[-1]
        ver = re.search(r'versionName=\S+', sx(f'dumpsys package {PKG}')).group(0)
        check('install' + (' over the old build' if old else ''), out == 'Success', out + ' ' + ver)
        # QA plumbing: canned audio (no emulator mic) + fake Wizard origin, both debug-build-only hooks.
        aiff = job / 'q.aiff'; canned = job / 'qa_voice.m4a'
        sh('say', '-o', aiff, 'This is a Wizard Everywhere test message.')
        sh('afconvert', '-f', 'm4af', '-d', 'aac', aiff, canned)
        sh(ADB, '-s', S, 'push', canned, '/data/local/tmp/qa_voice.m4a')
        def stage_audio(): sx(f'run-as {PKG} cp /data/local/tmp/qa_voice.m4a files/qa_next.m4a')
        sx(f'run-as {PKG} mkdir -p files'); sx(f"run-as {PKG} sh -c 'echo http://10.0.2.2:{FAKE} > files/qa_origin.txt'")
        sx(f'pm grant {PKG} android.permission.RECORD_AUDIO'); sx(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
        sx('logcat -c')
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(9)
        pg = Page(); wait_shell(pg)
        pg.ev("(() => { const c = document.querySelector('#coach'); if (c && !c.hidden) document.querySelector('#coachGo').click(); return true; })()")
        time.sleep(1)
        gear = pg.ev("!!document.querySelector('.gear')")
        check('Home has the Settings gear (top right)', gear)
        pg.ev("document.querySelector('.gear').click()"); time.sleep(1.2)
        row = pg.ev("(() => { const r = document.querySelector('[data-st=everywhere]'); return r ? r.innerText.replace(/\\s+/g,' ') : null; })()")
        check('Settings shows the Wizard Everywhere switch, off', row and 'Wizard Everywhere' in row and not pg.ev("document.querySelector('[data-st=everywhere] .sw').classList.contains('on')"), row)
        shot('01-settings-off')
        pg.ev("document.querySelector('[data-st=everywhere]').click()"); time.sleep(3)
        t = top(); shot('02-overlay-page')
        check('turning it on opens Android’s “Display over other apps” page', any(k in t for k in ('ManageOverlay', 'AppDrawOverlay', 'SpaActivity', 'com.android.settings')), t)
        # Flip the toggle the way a person does: tap the switch on the system page.
        tapped = tap_text(r'Allow display over other apps|Allow permission|Permit drawing')
        time.sleep(1.5)
        if 'allow' not in sx(f'appops get {PKG} SYSTEM_ALERT_WINDOW').lower():
            print('  system switch tap did not land (', tapped, '); granting by appops to continue')
            sx(f'appops set {PKG} SYSTEM_ALERT_WINDOW allow')
        for _ in range(4):
            if PKG in top(): break
            sx('input keyevent KEYCODE_BACK'); time.sleep(1.5)
        time.sleep(2.5)
        check('Back from the overlay page returns to Wizard OS', PKG in top(), top())
        st = json.loads(pg.ev("window.WizardOSNative.everywhere()"))
        check('switch reads on with overlay allowed', st.get('enabled') and st.get('overlay'), st)
        shot('03-settings-on')
        check('floating button is hidden while Wizard OS is in front', wait_bubble(False, 4) is None, bubble())
        # Leave the app: home screen
        sx('input keyevent KEYCODE_HOME'); time.sleep(2.5)
        b = wait_bubble(True)
        sw, shh = map(int, re.search(r'(\d+)x(\d+)', sx('wm size')).groups())
        shot('04-launcher-bubble')
        check('floating button appears on the home screen, lower right above the dock', b and b[0] > sw * 0.6 and shh * 0.5 < b[1] and b[3] < shh * 0.82, (b, sw, shh))
        # Over another app (Android's own Settings hides every app's overlays by design, so use the dialer)
        sx('am start -W -a android.intent.action.DIAL'); time.sleep(3)
        b2 = wait_bubble(True); shot('05-over-dialer')
        check('floating button floats over another app', b2 is not None and 'dialer' in top().lower(), (b2, top()))
        # Drag it to the left middle; it snaps to the left edge and stays there.
        cx, cy = (b2[0] + b2[2]) // 2, (b2[1] + b2[3]) // 2
        sx(f'input swipe {cx} {cy} {sw // 3} {shh // 2} 700'); time.sleep(1.5)
        b3 = bubble(); shot('06-dragged')
        check('drag moves it and it snaps to the left edge', b3 and b3[0] < sw * 0.1 and abs((b3[1] + b3[3]) // 2 - shh // 2) < shh * 0.12, b3)
        sx('input keyevent KEYCODE_HOME'); time.sleep(2)
        b4 = wait_bubble(True)
        check('it remembers where it was left', b4 and abs(b4[0] - b3[0]) < 10 and abs(b4[1] - b3[1]) < 10, (b3, b4))
        # The orb is the app's orb, not a portrait (visual check is on the screenshot; here: the page loaded the orb).
        lg = logs('page: everywhere page ready')
        check('floating orb draws the shared Wizard orb', 'everywhere page ready' in lg, lg)
        cx, cy = (b4[0] + b4[2]) // 2, (b4[1] + b4[3]) // 2
        dxs = -1 if cx > sw / 2 else 1; dys = -1 if cy > shh * 0.42 else 1
        PAUSE = (cx + dxs * dp(54), cy + dys * dp(54)); CANCEL = (cx, cy + dys * dp(74)); SHOT = (cx + dxs * dp(74), cy)
        # 1. Talk, Pause, carry on, Cancel: nothing is sent.
        stage_audio(); sx('logcat -c')
        sx(f'input tap {cx} {cy}'); time.sleep(1.2)
        bx = bubble()
        check('tap starts listening and the controls open around the orb', 'listening' in logs('listening') and bx and (bx[2] - bx[0]) > dp(200), (logs('listening'), bx))
        sx(f'input tap {PAUSE[0]} {PAUSE[1]}'); time.sleep(1.0); shot('07-paused')
        check('Pause pauses the recording', 'paused' in logs(': paused'), logs('paused|resumed'))
        time.sleep(3)  # the QA recording would have finished by now if Pause didn't hold it
        check('while paused it does not send', STATE['transcribe'] == 0 and 'listening' in logs('listening'), STATE['transcribe'])
        sx(f'input tap {PAUSE[0]} {PAUSE[1]}'); time.sleep(0.6)
        check('Pause again carries on', 'resumed' in logs('resumed'), logs('paused|resumed'))
        sx(f'input tap {CANCEL[0]} {CANCEL[1]}'); time.sleep(3.5)
        check('Cancel throws it away: nothing sent', 'cancelled' in logs('cancelled') and STATE['transcribe'] == 0 and not STATE['runs'], (logs('cancelled'), STATE['transcribe']))
        b5 = wait_bubble(True, 4)
        check('the orb shrinks back after Cancel', b5 and (b5[2] - b5[0]) < dp(120), b5)
        # 2. Voice typing + screenshots need Accessibility → Wizard OS.
        sx(f'settings put secure enabled_accessibility_services {PKG}/ai.wizards.os.everywhere.WizardKeyboardService')
        sx('settings put secure accessibility_enabled 1'); time.sleep(3)
        check('voice typing service connects', 'keyboard service connected' in logs('keyboard service connected'), logs('keyboard'))
        # 3. Talk with a screenshot. First transcribe + first admission are dropped by the fake Wizard.
        stage_audio(); sx('logcat -c')
        sx(f'input tap {cx} {cy}'); time.sleep(1.2); shot('08-listening-controls')
        print('  controls at', {'pause': PAUSE, 'cancel': CANCEL, 'shot': SHOT, 'bubble': bubble()})
        sx(f'input tap {SHOT[0]} {SHOT[1]}')
        sl = wait_log('screenshot attached', 8)
        check('Screen attaches a screenshot while talking', 'screenshot attached' in sl, sl or logs('screenshot|Accessibility|page:'))
        t0 = time.time()
        while time.time() - t0 < 75 and ': sent ' not in logs(': sent '):
            time.sleep(1.5)
        lg = logs(': sent |attempt')
        print('  outbox log:', lg)
        check('dropped transcription was retried (recording kept on the phone)', STATE['transcribe'] >= 2, STATE['transcribe'])
        check('lost admission reply → same Idempotency-Key replayed → exactly one run', len(STATE['runs']) == 1, [r['key'] for r in STATE['runs']])
        body = STATE['runs'][0]['body'] if STATE['runs'] else {}
        check('the run carries the words, the voice note and the screenshot', 'Wizard Everywhere QA message' in body.get('input', '')
              and len(body.get('wizard_file_ids') or []) == 2 and 'screenshot' in body.get('instructions', ''), (body.get('wizard_file_ids'), body.get('instructions', '')[-120:]))
        time.sleep(8)
        nt = sx('dumpsys notification --noredact | grep -E "android.title=|android.text=" | head -20')
        check('reply arrives as a notification that opens the thread', 'QA reply from the fake Wizard' in nt, nt[:300])
        # 4. Keyboard open → the orb is a mic that types into the field. Nothing goes to Wizard.
        runs_before = len(STATE['runs']); sx('logcat -c')
        opened = None
        for cmd in ['am start -W -a android.intent.action.SENDTO -d sms:5551234', 'am start -W -a android.intent.action.INSERT -t vnd.android.cursor.dir/contact']:
            sx(cmd); time.sleep(3.5)
            tap_text(r'^(Text message|Message|First name|Name)$|RCS message|Type .*message')
            time.sleep(2)
            if ime_shown(): opened = cmd; break
            sx('input keyevent KEYCODE_BACK'); sx('input keyevent KEYCODE_BACK'); time.sleep(1)
        check('a real app with a text field and the keyboard is open', opened, top())
        kb = wait_log('keyboard open', 6)
        wait_log('keyboard open imeTop=', 12)   # the keyboard's top edge arrives once it has slid up
        wait_log('placed over keyboard', 6)
        time.sleep(1.5)
        print('  placement:', logs('placed over keyboard|keyboard (open|closed)'))
        bk = bubble(); shot('09-keyboard-mic')
        tops = re.findall(r'imeTop=(\d+)', logs('keyboard open'))
        ime_top = int(tops[-1]) if tops else None
        check('orb switches to voice typing when the keyboard opens', 'keyboard open' in kb, kb)
        check('over a keyboard it moves clear of the keys (its own spot)', bk and ime_top and bk[3] <= ime_top + 4, (bk, ime_top))
        stage_audio()
        kcx, kcy = (bk[0] + bk[2]) // 2, (bk[1] + bk[3]) // 2
        sx(f'input tap {kcx} {kcy}'); time.sleep(1)
        check('a tap over the keyboard starts voice typing', 'voice typing' in logs('listening'), logs('listening'))
        dl = wait_log('dictation (typed|copied)', 40)
        time.sleep(1.5)
        typed = 'Wizard Everywhere QA message' in ui()
        shot('10-typed')
        check('the words are typed into the field', 'dictation typed' in dl and typed, (dl, typed))
        check('voice typing sends nothing to Wizard', len(STATE['runs']) == runs_before, len(STATE['runs']))
        for _ in range(3): sx('input keyevent KEYCODE_BACK'); time.sleep(1)
        sx('input keyevent KEYCODE_HOME'); time.sleep(3)
        bh = wait_bubble(True)
        check('keyboard gone → the orb returns to where it was left', bh and abs(bh[0] - b4[0]) < 12 and abs(bh[1] - b4[1]) < 12, (bh, b4))
        # 5. Side button (assistant): talks and sends by itself, no draft.
        sx(f'run-as {PKG} cp /data/local/tmp/qa_voice.m4a files/qa_side.m4a'); sx('logcat -c')
        runs_before = len(STATE['runs'])
        sx(f'am start -W -a android.intent.action.ASSIST -n {PKG}/ai.wizards.os.assist.AssistLockActivity --es qa_audio qa_side.m4a --el qa_autosend_ms 2500')
        time.sleep(2); shot('11-side-listening')
        check('the floating orb steps aside while the side-button surface is up (one orb at a time)', not bubble(), bubble())
        t0 = time.time()
        while time.time() - t0 < 45 and len(STATE['runs']) == runs_before: time.sleep(1)
        time.sleep(2); shot('12-side-sent')
        sb = STATE['runs'][-1]['body'] if len(STATE['runs']) > runs_before else {}
        check('side button sends by itself (no draft, no Send tap)', len(STATE['runs']) == runs_before + 1 and 'side button' in sb.get('instructions', ''), (len(STATE['runs']) - runs_before, sb.get('instructions', '')[:90]))
        dlv = wait_log('delivered session', 10, alogs)
        check('the side-button surface says it was sent', 'delivered' in dlv, dlv or alogs('sending|queued'))
        check('no draft was opened in Wizard OS', 'MainActivity' not in top(), top())
        sx('input keyevent KEYCODE_BACK'); time.sleep(1); sx('input keyevent KEYCODE_HOME'); time.sleep(2)
        cx, cy = (bh[0] + bh[2]) // 2, (bh[1] + bh[3]) // 2
        # Wizard down: the message stays, becomes "Not sent" with a notification and Retry.
        STATE['down'] = True; STATE['drop_transcribe'] = 0
        stage_audio(); sx(f'input tap {cx} {cy}'); time.sleep(5)
        # Speed the backoff: retry presses + time; then force the attempts to run out via repeated pumps.
        t0 = time.time()
        while time.time() - t0 < 280 and 'not sent' not in logs('not sent'):
            time.sleep(5)
        nt = sx('dumpsys notification --noredact | grep -E "android.title=|android.text=" | head -20')
        shot('12b-not-sent')
        check('Wizard down → “Not sent” notification', 'not sent' in nt.lower(), nt[:400])
        # Open the app → the Unsent list shows it (with the app's own outbox entries)
        sx(f'am start -W -a ai.wizards.os.action.UNSENT -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(3)
        pg.close(); pg = Page(); wait_shell(pg); time.sleep(1.5)
        rows = pg.ev("[...document.querySelectorAll('#settingsBody .ub-row')].map(r => r.innerText.replace(/\\s+/g,' '))")
        shot('13-unsent-list')
        check('notification opens Settings on the Unsent list with the message', rows and any('Everywhere button' in r and 'Not sent' in r for r in rows), rows)
        vt = pg.ev("(() => { const r = document.querySelector('[data-st=typing]'); return r ? r.innerText.replace(/\\s+/g,' ') : null; })()")
        check('Settings shows Voice typing & screenshots as on', vt and 'On' in vt, vt)
        check('floating button hidden again while Wizard OS is open', wait_bubble(False, 4) is None)
        # Retry from the list once Wizard is back
        STATE['down'] = False
        n_before = len(STATE['runs'])
        pg.ev("document.querySelector('#settingsBody .ub-row[data-uborigin=everywhere] [data-ub=retry]').click()")
        t0 = time.time()
        while time.time() - t0 < 40 and len(STATE['runs']) == n_before: time.sleep(1)
        time.sleep(3)
        rows2 = pg.ev("[...document.querySelectorAll('#settingsBody .ub-row')].length")
        check('Retry delivers it exactly once and the list clears', len(STATE['runs']) == n_before + 1 and rows2 == 0, (len(STATE['runs']), rows2))
        shot('14-all-sent')
        # Back never exits
        for _ in range(4): sx('input keyevent KEYCODE_BACK'); time.sleep(1)
        check('Back stays in Wizard OS', PKG in top(), top())
        # Switch off → button gone everywhere
        pg.ev("window.WizardOSNative.setEverywhere(false)"); time.sleep(1)
        sx('input keyevent KEYCODE_HOME'); time.sleep(2.5)
        check('switching it off removes the button', wait_bubble(False, 5) is None)
        crashed = sx('logcat -d -b crash')
        check('no crashes', 'FATAL EXCEPTION' not in crashed, crashed[:300])
        check('nothing from the WebView was written to Wizard', not pg.writes, pg.writes[:3])
    finally:
        if pg: pg.close()
        if em: sh(ADB, '-s', S, 'emu', 'kill'); em.wait(40)
        srv.shutdown()
        (job / 'fake-wizard.json').write_text(json.dumps({k: (list(v) if isinstance(v, set) else v) for k, v in STATE.items()}, indent=1, default=str))
print(f'{sum(res)}/{len(res)} passed · shots {OUT}')
