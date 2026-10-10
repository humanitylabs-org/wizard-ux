#!/usr/bin/env python3
"""Wizard ID device QA (runs on Thales).

The real Wizard OS shell inside the real Android app (QA build) on a fresh API 35 emulator with a screen-lock PIN,
against a fake Wizard on this Mac. The fake records Wizard ID publishes and never contacts a relay.

usage: qa_wizard_id_device.py QA_APK WEB_DIR WIZARD_ID_PY [OUT_DIR]

Checks: create a Wizard ID (name, PIN prompt), copy-key backup, backup check, first profile signed and handed to the
shell for publishing (signature verified here), a post signed on the amber sheet after the PIN and verified, Deny and
Back refuse and leave Wizard OS open, an iframe on the same origin gets no answer from the identity port, and an
existing key (NIP-19 test nsec) brought in gives the expected npub.
"""
import fcntl, http.server, importlib.util, json, os, pathlib, re, socket, subprocess, sys, threading, time, urllib.request, uuid
from xml.etree import ElementTree as ET

P = pathlib.Path
BASE = P('/Volumes/ThalesMedia/AndroidBuilds'); SDK = P('/opt/homebrew/share/android-commandlinetools')
APK = P(sys.argv[1]); WEB = P(sys.argv[2]).resolve(); WID = P(sys.argv[3]).resolve(); PKG = 'ai.wizards.os.qa'
job = P(sys.argv[4]) if len(sys.argv) > 4 else BASE / 'qa' / ('wos-wizid-' + uuid.uuid4().hex[:6])
job.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('wizard_id', WID); W = importlib.util.module_from_spec(spec); spec.loader.exec_module(W)
env = os.environ.copy(); env.update(JAVA_HOME='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:/opt/homebrew/bin:' + env['PATH']; (job / 'avd').mkdir(exist_ok=True)
ADB = str(SDK / 'platform-tools/adb'); PORT = 5716; S = 'emulator-%d' % PORT; DEVTOOLS = 9367; FAKE = 18801
ORIGIN = 'http://localhost:%d' % FAKE; PIN = '1357'; NOW = int(time.time())
# NIP-19 test vector: this nsec belongs to this npub.
TEST_NSEC = 'nsec180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsgyumg0'
TEST_PUB = '718d756f60cf5179ef35b39dc6db3ff58f04c0734f81f6d4410f0b047ddf9029'  # pubkey of TEST_NSEC (checked with wizard_id._mul)
passed = failed = 0; RESULTS = []


def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1
    else: failed += 1
    RESULTS.append({'name': name, 'ok': bool(ok), 'detail': str(detail)[:600]})
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  ' + str(detail)[:600]), flush=True)


def sh(*a, stdin=None, binary=False, timeout=120):
    r = subprocess.run([str(x) for x in a], env=env, capture_output=True, input=stdin, text=not binary, timeout=timeout)
    return r.stdout


def sx(c, **kw): return sh(ADB, '-s', S, 'shell', c, **kw)
def runas(c): return sx("run-as %s sh -c '%s'" % (PKG, c))
def top(): return next((l.strip() for l in sx('dumpsys activity activities').splitlines() if 'topResumedActivity' in l), '')
def front(): return PKG + '/' in top()
def on_identity(): return 'identity.IdentityActivity' in top()
def on_shell(): return 'ai.wizards.os.MainActivity' in top()
def shot(name): (job / (name + '.png')).write_bytes(sh(ADB, '-s', S, 'exec-out', 'screencap', '-p', binary=True))


def wait(fn, secs, step=0.5):
    t0 = time.time()
    while time.time() - t0 < secs:
        try:
            v = fn()
            if v: return v
        except Exception: pass
        time.sleep(step)
    try: return fn()
    except Exception: return None


# ------------------------------------------------------------------ native UI via uiautomator
def nodes():
    sx('uiautomator dump /sdcard/wid.xml >/dev/null 2>&1')
    xml = sx('cat /sdcard/wid.xml')
    try: root = ET.fromstring(xml[xml.index('<?xml'):] if '<?xml' in xml else xml)
    except Exception: return []
    out = []
    for n in root.iter('node'):
        b = re.findall(r'\d+', n.get('bounds', ''))
        if len(b) == 4:
            x1, y1, x2, y2 = map(int, b)
            out.append({'text': n.get('text', ''), 'cls': n.get('class', ''), 'hint': n.get('hint', ''), 'pkg': n.get('package', ''),
                        'x': (x1 + x2) // 2, 'y': (y1 + y2) // 2})
    return out


def find(text, exact=True):
    for n in nodes():
        t = n['text'] or ''
        if (t == text) if exact else (text.lower() in t.lower()): return n
    return None


def tap_text(text, secs=15, exact=True):
    n = wait(lambda: find(text, exact), secs, 0.8)
    if not n: return False
    sx('input tap %d %d' % (n['x'], n['y'])); return True


def screen_text(): return ' | '.join(n['text'] for n in nodes() if n['text'])


def edits(): return [n for n in nodes() if n['cls'].endswith('EditText')]


def type_into(i, text):
    e = wait(lambda: (edits() or [None] * (i + 1))[i] if len(edits()) > i else None, 10, 0.8)
    if not e: return False
    sx('input tap %d %d' % (e['x'], e['y'])); time.sleep(0.6)
    sx("input text '%s'" % text); time.sleep(0.4); return True


def pin():
    """Answer the system credential prompt with the PIN (it belongs to com.android.systemui)."""
    ok = wait(lambda: any(n['pkg'] == 'com.android.systemui' for n in nodes()), 15, 0.8)
    time.sleep(1.0)
    sx("input text '%s'" % PIN); time.sleep(0.4); sx('input keyevent KEYCODE_ENTER')
    return bool(ok)


# ------------------------------------------------------------------ fake Wizard
PUBLISHED = []; WRITES = []
BOOT = {'bootstrap': 1, 'api': 'wizard-agent-service/1',
        'settings': {'owner': {'name': 'Robin', 'place': ''}, 'agent': {'name': 'Merlin'}, 'clock': {'timezone': 'UTC', 'day_starts_at': '06:00'}, 'voice': {'language': 'en', 'vocabulary': []}},
        'capabilities': {'voice': True, 'router': True, 'files': True, 'approvals': True, 'steer': True, 'markdown': True},
        'endpoints': {'sessions': '/wizard/hermes/api/sessions', 'runs': '/wizard/hermes/v1/runs', 'transcribe': '/wizard/voice/transcribe',
                      'route': '/wizard/v1/route', 'upload': '/wizard/files/upload', 'apps': '/wizard/v1/apps'}}
CT = {'css': 'text/css', 'html': 'text/html', 'png': 'image/png', 'webmanifest': 'application/manifest+json', 'js': 'application/javascript', 'svg': 'image/svg+xml', 'json': 'application/json'}


class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _send(self, code, body=b'', ctype='application/json', extra=None):
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)

    def _json(self, code, obj): self._send(code, json.dumps(obj).encode())

    def do_GET(self):
        u = self.path.split('?')[0]
        if u == '/wizard-os-home': return self._send(301, b'', extra={'Location': '/wizard-os-home/'})
        if u == '/wizard-os-home/api/identity/profile': return self._json(200, {'profile': None})
        m = re.match(r'^/wizard-os-home/(.*)$', u)
        if m:
            f = m.group(1) or 'index.html'; p = (WEB / f).resolve()
            if f in ('data.js', 'summaries.js') or not str(p).startswith(str(WEB)) or not p.is_file():
                return self._send(200 if f.endswith('.js') else 404, b'', 'application/javascript')
            return self._send(200, p.read_bytes(), CT.get(f.rsplit('.', 1)[-1], 'application/octet-stream'))
        if u == '/wizard/v1/bootstrap': return self._json(200, BOOT)
        if u == '/wizard/v1/apps': return self._json(200, {'apps': []})
        if u == '/wizard/hermes/api/sessions': return self._json(200, {'data': [], 'has_more': False})
        if u == '/wizard/thread-seen': return self._json(200, {'state': {'initializedAt': NOW * 1000, 'threads': {}}})
        if u == '/wizard/thread-dispositions': return self._json(200, {'state': {}})
        if u.startswith('/reports/wizard-os/latest.json'): return self._json(404, {'error': 'none'})
        return self._json(200, {})

    def _write(self):
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n) if n else b''
        u = self.path.split('?')[0]
        WRITES.append(self.command + ' ' + u)
        if u == '/wizard-os-home/api/identity/publish':
            try: ev = json.loads(body).get('event')
            except Exception: ev = None
            why = W.check_event(ev)
            PUBLISHED.append({'event': ev, 'error': why})
            return self._json(200 if not why else 400, {'ok': not why, 'error': why, 'relays': []})
        if u == '/wizard/thread-seen': return self._json(200, {'state': {'initializedAt': NOW * 1000, 'threads': {}}})
        if u == '/wizard/v1/route' or u.endswith('/api/route'): return self._json(200, {'ms': 5, 'cmd': {'route': 'agent'}})
        return self._json(403, {'error': 'qa: write refused'})
    do_POST = do_PUT = do_PATCH = do_DELETE = _write


srv = http.server.ThreadingHTTPServer(('127.0.0.1', FAKE), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()


# ------------------------------------------------------------------ raw CDP to the app's WebView
class Page:
    def __init__(self):
        pid = sx('pidof %s' % PKG).strip()
        sh(ADB, '-s', S, 'forward', 'tcp:%d' % DEVTOOLS, 'localabstract:webview_devtools_remote_%s' % pid)
        page = None
        for _ in range(50):
            try:
                l = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json/list' % DEVTOOLS, timeout=3))
                page = next((x for x in l if x.get('type') == 'page' and 'wizard-os-home' in x.get('url', '')), None)
            except Exception: pass
            if page: break
            time.sleep(0.7)
        if not page: raise RuntimeError('no Wizard OS page')
        self.id = 0
        m = re.match(r'ws://([^/]+)(/.*)', page['webSocketDebuggerUrl']); host, path = m.groups(); h, p = host.split(':')
        self.s = socket.create_connection((h, int(p)), timeout=60)
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
        rr = r.get('result', {})
        if rr.get('exceptionDetails'): raise RuntimeError(json.dumps(rr['exceptionDetails'])[:400])
        return rr.get('result', {}).get('value')


def start(pg, js, slot):
    """Kick off a WosIdentity promise without awaiting it; its outcome lands in window.__qa[slot]."""
    pg.ev("(() => { window.__qa = window.__qa || {}; window.__qa[%r] = {state: 'pending'}; (%s).then(r => window.__qa[%r] = {state: 'ok', r}, e => window.__qa[%r] = {state: 'err', code: e.code || e.message}); return 1; })()" % (slot, js, slot, slot))


def outcome(pg, slot, secs=20):
    return wait(lambda: (lambda o: o if o and o.get('state') != 'pending' else None)(pg.ev("window.__qa && window.__qa[%r]" % slot)), secs)


em = None
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'wizid', '-k', 'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7', '-p', job / 'dev', stdin='no\n')
        em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'wizid', '-port', str(PORT), '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect', '-dns-server', '10.0.2.250'],
                              env=env, stdout=open(job / 'em.log', 'w'), stderr=subprocess.STDOUT)
        for _ in range(140):
            if sx('getprop sys.boot_completed').strip() == '1': break
            time.sleep(3)
        time.sleep(8)
        sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard')
        for k in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'): sx('settings put global %s 0' % k)
        r = sx('locksettings set-pin %s' % PIN)
        check('emulator has a screen-lock PIN', 'set to' in r.lower() or 'pin' in r.lower(), r.strip())
        sx('input keyevent KEYCODE_WAKEUP'); time.sleep(1)
        inst = sh(ADB, '-s', S, 'install', '-r', APK).strip().splitlines()[-1]
        check('QA APK installs', 'Success' in inst, inst)
        sh(ADB, '-s', S, 'reverse', 'tcp:%d' % FAKE, 'tcp:%d' % FAKE)
        runas('mkdir -p files && echo %s > files/qa_home.txt && touch files/qa_screens.txt' % ORIGIN)
        sx('pm grant %s android.permission.RECORD_AUDIO' % PKG)
        sx('am start -W -n %s/ai.wizards.os.MainActivity' % PKG); time.sleep(4)
        # the lock screen comes back after setting a PIN: unlock with it
        if 'Keyguard' in sx('dumpsys window | grep -i mCurrentFocus') or 'NotificationShade' in sx('dumpsys window | grep -i mCurrentFocus'):
            sx('wm dismiss-keyguard'); time.sleep(1); sx("input text '%s'" % PIN); sx('input keyevent KEYCODE_ENTER'); time.sleep(2)
        sx('am start -W -n %s/ai.wizards.os.MainActivity' % PKG); time.sleep(6)
        sx('logcat -c')
        pg = Page()
        ready = wait(lambda: pg.ev("!!(window.__wos && window.WosIdentity)"), 45)
        pg.ev("(() => { const c = document.querySelector('#coach'); if (c && !c.hidden) document.querySelector('#coachGo')?.click(); try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} return 1; })()")
        check('shell is up with Wizard ID available', ready and pg.ev("window.WosIdentity.available()"), pg.ev("typeof window.wizardIdentityPort"))
        st = wait(lambda: pg.ev("window.WosIdentity.status()"), 10)
        check('status: no Wizard ID yet', isinstance(st, dict) and st.get('exists') is False, st)

        # Settings row
        pg.ev("document.querySelector('[data-act=settings]')?.click()"); time.sleep(1.5)
        row = pg.ev("(() => { const r = document.querySelector('[data-st=\"wizard-id\"]'); return r ? r.textContent : null; })()")
        check('Settings shows a Wizard ID row', row and 'Wizard ID' in row, row); shot('01-settings')

        # 1. Create
        start(pg, "window.WosIdentity.setup()", 'setup')
        check('setup opens the native Wizard ID screen', wait(on_identity, 10), top())
        check('welcome says what it is', wait(lambda: find('Create your Wizard ID'), 10), screen_text()); shot('02-welcome')
        type_into(0, 'Robin'); time.sleep(0.8)
        tap_text('Create my Wizard ID')
        check('creating asks for the PIN', pin())
        check('backup step: save it like a password', wait(lambda: find('Save your key'), 15), screen_text()); shot('03-backup')
        warn = screen_text()
        check('backup warning: nobody can reset it', 'Nobody, including us, can reset it' in warn, warn)
        tap_text('Copy the key instead'); time.sleep(1)
        key = wait(lambda: next((n['text'] for n in nodes() if n['text'].startswith('nsec1')), None), 10)
        check('the key is shown once, as nsec', bool(key) and len(key) == 63, key and key[:8] + '…'); shot('04-key')
        tap_text("I've saved it")
        check('check step', wait(lambda: find('Check your backup'), 10), screen_text())
        type_into(0, 'nsec1wrongwrongwrong'); tap_text('Check'); time.sleep(1)
        check('a wrong key is refused', find("That isn't the same key", exact=False), screen_text())
        e0 = edits()[0]; sx('input tap %d %d' % (e0['x'], e0['y'])); sx('input keyevent KEYCODE_MOVE_END')
        for _ in range(24): sx('input keyevent KEYCODE_DEL')
        sx("input text '%s'" % key); time.sleep(0.4); tap_text('Check')
        check('the right key passes: done', wait(lambda: find("You're set"), 10), screen_text()); shot('05-done')
        tap_text('Done')
        o = outcome(pg, 'setup')
        r = (o or {}).get('r') or {}
        check('back in Wizard OS after setup', wait(on_shell, 10), top())
        check('setup result: exists, backed up, npub', r.get('exists') is True and r.get('backedUp') is True and str(r.get('npub', '')).startswith('npub1'), o)
        pub = r.get('pubkey', '')
        check('npub in the shell matches the key that was shown', bool(pub) and W.hex_to_npub(pub) == r.get('npub'), r.get('npub'))
        prof = wait(lambda: PUBLISHED[:1], 10)
        pe = (prof or [{}])[0]
        check('first profile published: kind 0, signed by the new key, name Robin',
              pe.get('error') is None and (pe.get('event') or {}).get('pubkey') == pub and json.loads((pe.get('event') or {}).get('content') or '{}').get('name') == 'Robin', pe)
        js_keys = pg.ev("JSON.stringify(Object.keys(window.WosIdentity.last || {}))")
        check('the shell never sees the private key', 'nsec' not in (pg.ev("JSON.stringify(window.WosIdentity.last)") or '') and 'secret' not in js_keys, js_keys)

        # 2. Sign a post on the amber sheet
        start(pg, "window.WosIdentity.sign({kind: 1, content: 'Hello from Wizard OS QA', tags: [['t', 'wizard']]})", 'sign1')
        check('sign opens the approval sheet', wait(lambda: find('NEEDS YOUR APPROVAL'), 10), screen_text())
        sheet = screen_text()
        check('sheet says what will be signed, from the event', 'Post publicly' in sheet and 'Hello from Wizard OS QA' in sheet and 'Robin' in sheet, sheet); shot('06-sheet')
        tap_text('Approve & sign')
        check('signing asks for the PIN', pin())
        o = outcome(pg, 'sign1')
        ev = ((o or {}).get('r') or {}).get('event') or {}
        check('signed event verifies (id + BIP-340) under the owner key', ev.get('pubkey') == pub and ev.get('kind') == 1 and W.verify_event(ev), o)
        check('Wizard OS is in front after signing', wait(on_shell, 10), top())

        # 3. Deny, and Back on the sheet
        start(pg, "window.WosIdentity.sign({kind: 1, content: 'deny me'})", 'deny')
        wait(lambda: find('NEEDS YOUR APPROVAL'), 10); tap_text('Deny')
        o = outcome(pg, 'deny')
        check('Deny refuses', (o or {}).get('code') == 'denied', o)
        start(pg, "window.WosIdentity.sign({kind: 1, content: 'back out'})", 'back')
        wait(lambda: find('NEEDS YOUR APPROVAL'), 10); sx('input keyevent KEYCODE_BACK')
        o = outcome(pg, 'back')
        check('Back on the sheet refuses and Wizard OS stays open', (o or {}).get('code') == 'denied' and wait(on_shell, 8) and front(), (o, top()))
        start(pg, "window.WosIdentity.sign({kind: 1, content: 'x', pubkey: '%s'})" % ('00' * 32), 'other')
        o = outcome(pg, 'other')
        check('a request for a different identity is refused before any sheet', (o or {}).get('state') == 'err' and 'different identity' in str(o.get('code')), o)

        # 4. Frames can't reach the port
        pg.ev("(() => { const f = document.createElement('iframe'); f.id = 'qaFrame'; f.src = '/wizard-os-home/manifest.webmanifest'; document.body.appendChild(f); return 1; })()"); time.sleep(2)
        frame = pg.ev("(async () => { const w = document.getElementById('qaFrame').contentWindow; const p = w.wizardIdentityPort; if (!p) return 'no port'; return await new Promise(res => { p.onmessage = e => res('answered: ' + e.data); p.postMessage(JSON.stringify({id: 'f1', method: 'status'})); setTimeout(() => res('silent'), 3000); }); })()")
        check('a frame inside the shell gets no answer from Wizard ID', frame in ('no port', 'silent'), frame)

        # 5. Back at the shell root keeps Wizard OS open
        pg.ev("document.querySelector('#qaFrame')?.remove()")
        sx('input keyevent KEYCODE_BACK'); time.sleep(1.5)
        check('Back at the shell keeps Wizard OS open', front(), top())

        # 6. Remove, then bring an existing key in
        start(pg, "window.WosIdentity.setup()", 'manage')
        check('setup on an existing ID opens Your Wizard ID', wait(lambda: find('Your Wizard ID'), 10), screen_text()); shot('07-manage')
        tap_text('Remove from this phone'); time.sleep(1); tap_text('Remove', exact=True) or tap_text('REMOVE')
        check('removed: back to Create', wait(lambda: find('Create your Wizard ID'), 10), screen_text())
        tap_text('I already have one')
        check('import screen', wait(lambda: find('Bring your Wizard ID'), 10), screen_text())
        type_into(0, TEST_NSEC); tap_text('Bring it in')
        check('bringing a key in asks for the PIN', pin())
        check('import done', wait(lambda: find("You're set"), 15), screen_text()); shot('08-imported')
        tap_text('Done')
        o = outcome(pg, 'manage')
        r = (o or {}).get('r') or {}
        check('imported key gives the expected npub (NIP-19 vector)', r.get('pubkey') == TEST_PUB and r.get('npub') == W.hex_to_npub(TEST_PUB), o)
        check('an imported key counts as backed up', r.get('backedUp') is True, r)
        check('Wizard OS is in front at the end', wait(on_shell, 8), top())
        check('no other Wizard writes besides identity publishes', all('identity/publish' in w or 'thread-seen' in w or 'route' in w for w in WRITES), WRITES)
    except Exception as e:
        check('harness ran to the end', False, repr(e))
    finally:
        try: shot('99-final')
        except Exception: pass
        try: (job / 'logcat.txt').write_text(sh(ADB, '-s', S, 'logcat', '-d', '-v', 'time', timeout=60))
        except Exception: pass
        if em:
            try: sh(ADB, '-s', S, 'emu', 'kill', timeout=20)
            except Exception: pass
            try: em.wait(30)
            except Exception: em.kill()
        srv.shutdown()

(job / 'results.json').write_text(json.dumps({'passed': passed, 'failed': failed, 'results': RESULTS, 'published': PUBLISHED, 'writes': WRITES}, indent=1))
print('passed %d failed %d  (%s)' % (passed, failed, job), flush=True)
sys.exit(1 if failed else 0)
