#!/usr/bin/env python3
"""Real native overlay host flows on a CI emulator (GitHub Actions; debug QA build only).

usage: ci_android_overlay_hosts.py APK OUT_DIR CERT_DIR

Unlike OverlayE2eTest (a debug Activity hosting the pages), this drives the shipped hosts the way a person does,
over adb, against a disposable fake Wizard at https://10.0.2.2 (the runner's loopback, port 443). Its TLS
certificate is minted per CI run; the debug-only network config trusts that run's CA (debug-overrides), so
release trust is unchanged. No owner server, account or secret is involved.

  A  floating orb (EverywhereService WindowManager overlay, SYSTEM_ALERT_WINDOW via appops)
  B  Screen mode (ScreenMode overlay, WizardKeyboardService accessibility capture), orb hold -> Select text
  C  side-button corner orb (WizardSession, VoiceInteraction; Wizard OS is the ASSISTANT role holder)
  L  lock-screen surface (AssistLockActivity over a PIN keyguard): bundled only, never fetches
Each remote-first host is checked online (page from the Wizard), with the Wizard unreachable, with a Wizard
that answers too slowly (the 1.5 s deadline), and in airplane mode (bundled copy, no request reaches the host).
Evidence per step: logcat (WizardOverlay / WizardEverywhere / WizardOSAssist), the fake host's request log,
dumpsys window, uiautomator dumps and screenshots, all in OUT_DIR. Any crash or ANR fails the run.
"""
import http.server, json, os, pathlib, re, socket, ssl, subprocess, sys, threading, time

P = pathlib.Path
APK, OUT, CERTS = P(sys.argv[1]), P(sys.argv[2]), P(sys.argv[3])
OUT.mkdir(parents=True, exist_ok=True)
WEB = P(__file__).resolve().parent.parent / 'web'
PKG = 'ai.wizards.os.qa'
ORIGIN = 'https://10.0.2.2'
DEADLINE = 1.5          # OverlayPage.TIMEOUT_MS
MARGIN = 2.0            # cold-emulator allowance on top of the deadline for the bundled page to be ready
MARKER = 'QA fixture Wizard copy'
results = []

def log(*a): print(*a, flush=True)
def check(flow, name, ok, detail='', gate=True):
    results.append({'flow': flow, 'check': name, 'ok': bool(ok), 'gate': gate, 'detail': str(detail)[:600]})
    tag = ('PASS ' if ok else 'FAIL ') if gate else ('SEEN ' if ok else 'NOT PROVEN ')
    log(tag + f'[{flow}] {name}' + (f' — {str(detail)[:400]}' if detail not in ('', None) else ''))
    return bool(ok)

class DeviceLost(Exception): pass
SLOW = {'n': 0}
def adb(*a, stdin=None, binary=False, timeout=30):
    t = time.time()
    try:
        r = subprocess.run(['adb', *map(str, a)], capture_output=True, input=stdin, text=not binary, timeout=timeout)
        err = r.stderr if not binary else r.stderr.decode(errors='replace')
        if r.returncode != 0 and err.strip(): log(f'  adb {" ".join(map(str, a))[:80]} rc={r.returncode}: {err.strip()[:200]}')
        out = r.stdout
    except subprocess.TimeoutExpired:
        log(f'  adb {" ".join(map(str, a))[:80]} TIMED OUT after {timeout}s')
        out = b'' if binary else ''
    if time.time() - t > 15:
        SLOW['n'] += 1
        state = subprocess.run(['adb', 'get-state'], capture_output=True, text=True, timeout=10).stdout.strip() if a[:1] != ('get-state',) else ''
        log(f'  slow adb ({time.time() - t:.0f}s), device state={state!r}')
        if state != 'device' and SLOW['n'] >= 3: host_diag('device-lost'); raise DeviceLost(f'emulator no longer answers adb (state={state!r})')
    if not binary and 'not found' in (err if 'err' in dir() else '') and a[:1] != ('get-state',):
        host_diag('device-not-found'); raise DeviceLost('adb: emulator-5554 not found (emulator process gone)')
    return out
def sx(cmd, **k): return adb('shell', cmd, **k)

# ------------------------------------------------------------------ fake Wizard (HTTPS, runner loopback :443)
OVERLAY_FILES = {'assist/everywhere.html', 'assist/surface.html', 'assist/screen.html', 'assist/everywhere.js',
                 'assist/surface.js', 'assist/screen.js', 'assist/orb-size.js', 'orb.js', 'motion/wizard-motion.js',
                 'motion/wizard-motion.css', 'robert-thread-orb.png', 'robert-listening-galaxy.png'}
REQ = []                     # (host_time, path)
CONN = []                    # (host_time, client_port, path)
MODE = {'v': 'up'}           # up | slow
class Fake(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass
    def do_GET(self):
        REQ.append((time.time(), self.path))
        CONN.append((time.time(), self.client_address[1], self.path))   # client port: a new port = a new TCP+TLS connection
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        m = re.match(r'^/wizard-os-home/(.*)$', path)
        f = m.group(1) if m else None
        # Only the overlay allowlist (OverlayPolicy.FILES). The full shell is NOT served: rendering it in
        # MainActivity under swiftshader took the CI emulator down, and these flows don't need it (the app
        # shows its native reach screen instead).
        if f not in OVERLAY_FILES: f = None
        p = (WEB / f).resolve() if f else None
        if not p or not str(p).startswith(str(WEB.resolve())) or not p.is_file():
            b = b'{"error":"fixture"}'
            self.send_response(404); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b); return
        b = p.read_bytes()
        if f.startswith('assist/') and f.endswith('.html'):
            # A marker only the Wizard's copy carries, visible to uiautomator (not to people: opacity .02).
            tag = f'<p role="status" style="position:fixed;left:4px;top:4px;margin:0;font:11px sans-serif;color:#9a9;opacity:.7;pointer-events:none;z-index:99">{MARKER}</p>'.encode()
            b = b.replace(b'</body>', tag + b'</body>') if b'</body>' in b else b + tag
        ct = {'css': 'text/css', 'html': 'text/html; charset=utf-8', 'png': 'image/png', 'svg': 'image/svg+xml',
              'js': 'application/javascript', 'json': 'application/json', 'webmanifest': 'application/manifest+json'}.get(f.rsplit('.', 1)[-1], 'application/octet-stream')
        self.send_response(200); self.send_header('Content-Type', ct); self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store'); self.end_headers()
        try:
            if MODE['v'] == 'slow' and f.startswith('assist/') and f.endswith('.html'):
                # Alive but too slow: one byte every 0.3 s never trips the 1 s read timeout, so only the
                # 1.5 s page deadline can rescue the host.
                for i in range(len(b)):
                    self.wfile.write(b[i:i + 1]); self.wfile.flush(); time.sleep(0.3)
            else:
                self.wfile.write(b)
        except (BrokenPipeError, ConnectionResetError, ssl.SSLError, OSError):
            pass

class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
SRV = {'s': None}
def server_up(mode='up'):
    MODE['v'] = mode
    if SRV['s']: return
    s = Server(('127.0.0.1', 443), Fake)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(CERTS / 'leaf.pem', CERTS / 'leaf.key')
    # Handshake lazily in each handler thread: wrapping the listener with the default handshake-on-accept would
    # serialise every TLS handshake in the accept loop and add avoidable latency to each overlay resource.
    s.socket = ctx.wrap_socket(s.socket, server_side=True, do_handshake_on_connect=False)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    SRV['s'] = s
def server_down():
    s = SRV['s']; SRV['s'] = None
    if s: s.shutdown(); s.server_close()
def assist_reqs(since): return [p for t, p in REQ[since:] if p.split('?', 1)[0].removeprefix('/wizard-os-home/') in OVERLAY_FILES]

# ------------------------------------------------------------------ device helpers
def now():
    t = sx('date +%s.%N').strip()
    try: return float(t)
    except ValueError: return float(sx('date +%s').strip() or 0)
STREAM = OUT / 'logcat-stream.txt'
LOGCAT = {'p': None}
def mem_trace():
    while True:
        try:
            with open(OUT / 'host-mem.txt', 'a') as f:
                f.write(time.strftime('%H:%M:%S ') + subprocess.run("free -m | sed -n 2p; pgrep -f qemu-system >/dev/null && echo qemu-up || echo qemu-DOWN", shell=True, capture_output=True, text=True).stdout.replace('\n', ' ') + '\n')
        except Exception: pass
        time.sleep(5)
threading.Thread(target=mem_trace, daemon=True).start()
def stream_logcat():
    """One continuous logcat on the host: cheap to poll, and it survives an emulator that dies mid-run."""
    if LOGCAT['p'] and LOGCAT['p'].poll() is None: return
    LOGCAT['p'] = subprocess.Popen(['adb', 'logcat', '-v', 'epoch', '-b', 'main,system,crash,events'],
                                   stdout=open(STREAM, 'ab'), stderr=subprocess.STDOUT)
def all_logs(since):
    stream_logcat()
    out = []
    for line in STREAM.read_text(errors='replace').splitlines():
        m = re.match(r'\s*(\d+\.\d+)\s', line)
        if m and float(m.group(1)) >= since: out.append((float(m.group(1)), line))
    return out
TAGS = re.compile(r' [VDIWEF] (WizardOverlay|WizardEverywhere|WizardOSAssist)\s*:')
def logs(since): return [(t, l) for t, l in all_logs(since) if TAGS.search(l)]
def wait_log(since, pat, secs=20):
    t0 = time.time()
    while time.time() - t0 < secs:
        for t, l in logs(since):
            if re.search(pat, l): return t, l
        time.sleep(0.5)
    return None, ''
def first(since, pat):
    for t, l in logs(since):
        if re.search(pat, l): return t, l
    return None, ''
def shot(name): (OUT / f'{name}.png').write_bytes(adb('exec-out', 'screencap', '-p', binary=True))
def ui(name):
    x, best = '', ''
    for args in ('--windows /sdcard/ui.xml', '/sdcard/ui.xml'):
        sx(f'rm -f /sdcard/ui.xml; uiautomator dump {args} >/dev/null 2>&1')
        x = sx('cat /sdcard/ui.xml')
        if '<hierarchy' in x and PKG in x: best = x; break
        if '<hierarchy' in x and not best: best = x
    x = best
    (OUT / f'{name}.xml').write_text(x)
    return x
def windows():
    w = sx('dumpsys window windows'); return w
def window(title):
    for blk in windows().split('Window #')[1:]:
        if title in blk.split('\n', 1)[0]:
            m = re.search(r'(?:mFrame|frame)=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]', blk)
            if m and 'mViewVisibility=0x8' not in blk and 'mViewVisibility=0x4' not in blk: return tuple(map(int, m.groups()))
    return None
def wait_window(title, secs=10):
    t0 = time.time()
    while time.time() - t0 < secs:
        w = window(title)
        if w: return w
        time.sleep(0.5)
    return None
def tap_text(pattern, xml):
    for m in re.finditer(r'<node [^>]*?>', xml):
        n = m.group(0)
        for attr in ('text', 'content-desc'):
            t = re.search(' ' + attr + r'="([^"]*)"', n)
            if t and t.group(1) and re.search(pattern, t.group(1)):
                b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
                if b:
                    x1, y1, x2, y2 = map(int, b.groups()); sx(f'input tap {(x1 + x2) // 2} {(y1 + y2) // 2}'); return t.group(1)
    return None
def top(): return next((l.strip() for l in sx('dumpsys activity activities').splitlines() if 'topResumedActivity' in l), '')
def write_pref(name, body):
    xml = "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n" + body + "\n</map>\n"
    sx(f'run-as {PKG} mkdir -p shared_prefs')
    adb('shell', f"run-as {PKG} sh -c 'cat > shared_prefs/{name}.xml'", stdin=xml)
def a11y_on():
    sx(f'settings put secure enabled_accessibility_services {PKG}/ai.wizards.os.everywhere.WizardKeyboardService')
    sx('settings put secure accessibility_enabled 1')
def bind_assistant(since):
    """force-stop unbinds the VoiceInteractionService ("Force stopping current voice interactor") and Android
    does not rebind it by itself; re-selecting the assistant role does, like picking it again in Settings."""
    sx(f'cmd role remove-role-holder --user 0 android.app.role.ASSISTANT {PKG}'); time.sleep(1)
    sx(f'cmd role add-role-holder --user 0 android.app.role.ASSISTANT {PKG}')
    t, _ = wait_log(since, r'voice service ready', 15)
    return t
def fresh():
    """New app process: every host builds a new WebView (and so a new OverlayPage load)."""
    t0 = now()
    sx(f'am force-stop {PKG}'); time.sleep(1.5)
    a11y_on()   # Android disables a force-stopped package's accessibility service
    if not bind_assistant(t0): log('  WARNING: voice interaction service did not report ready after force-stop')
def launch_then_home(since):
    sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(7)
    sx('input keyevent KEYCODE_HOME')
    return wait_log(since, r'everywhere\.html from (Wizard|bundle)', 25)
def trigger_assist(since, pat=r'surface\.html#corner from (Wizard|bundle)'):
    """Side button (long-press power = assistant), then KEYCODE_ASSIST, then the VIS shell command."""
    for how in ('input keyevent --longpress KEYCODE_POWER', 'input keyevent KEYCODE_ASSIST', 'cmd voiceinteraction show'):
        sx(how)
        t, l = wait_log(since, pat, 12)
        if t: return how, t, l
        if 'GlobalActions' in windows(): sx('input keyevent KEYCODE_BACK')
    return None, None, ''
def close_corner():
    sx('input keyevent KEYCODE_HOME'); time.sleep(1.5)
def open_screen(since):
    b = wait_window('WizardEverywhere', 10)
    if not b: return None, None, ''
    x, y = (b[0] + b[2]) // 2, (b[1] + b[3]) // 2
    for _ in range(3):   # a hold that lands while the orb page is still settling is ignored; hold again, as a person would
        sx(f'input swipe {x} {y} {x} {y} 1000')
        if wait_window('WizOrbMenu', 4): break
        time.sleep(1.5)
    else: return b, None, ''
    xml = ui('tmp-menu'); picked = tap_text(r'^Select text$', xml)
    t, l = wait_log(since, r'screen\.html from (Wizard|bundle)', 20)
    return b, picked, l
def close_screen():
    sx('input keyevent KEYCODE_BACK'); time.sleep(0.8)
    if window('WizScreen'): sx('input keyevent KEYCODE_BACK'); time.sleep(0.8)
def no_crash(flow, since):
    lines = [l for _, l in all_logs(since)]
    bad = []
    for i, l in enumerate(lines):
        if 'FATAL EXCEPTION' in l and any(PKG in x for x in lines[i:i + 4]): bad.append(' | '.join(lines[i:i + 6]))
        if f'ANR in {PKG}' in l or re.search(r'am_anr.*' + re.escape(PKG), l): bad.append(l)
    check(flow, 'no crash or ANR from Wizard OS', not bad, bad[:3])
def host_diag(tag):
    with open(OUT / f'host-diag-{tag}.txt', 'w') as f:
        for c in ('free -m', 'uptime', 'pgrep -a -f qemu-system || echo NO-QEMU-PROCESS', 'ls -la /tmp/android-runner /tmp/android-$USER 2>&1 || true', 'sudo dmesg 2>/dev/null | grep -iE "oom|killed process|qemu|segfault" | tail -20', 'sudo dmesg 2>/dev/null | tail -25'):
            f.write(f'$ {c}\n' + subprocess.run(c, shell=True, capture_output=True, text=True).stdout + '\n')
    log((OUT / f'host-diag-{tag}.txt').read_text()[-3000:])
def why(since, page):
    t, l = first(since, re.escape(page) + r': .*showing bundled copy')
    return l.split(page + ': ', 1)[-1] if l else ''
def evidence(name):
    shot(name); ui(name); (OUT / f'{name}-windows.txt').write_text(windows())

# ---- WebView DevTools (debug builds: MainActivity enables WebView debugging for the whole process)
import base64, urllib.request
def devtools(match=None):
    pid = sx(f'pidof {PKG}').strip().split()[:1]
    if not pid: return []
    adb('forward', 'tcp:9333', f'localabstract:webview_devtools_remote_{pid[0]}')
    try: pages = json.load(urllib.request.urlopen('http://127.0.0.1:9333/json/list', timeout=5))
    except Exception as e: log('  devtools list failed:', e); return []
    return [x for x in pages if x.get('type') == 'page' and (match is None or match(x.get('url', '')))]
def cdp_eval(page, expr):
    u = page['webSocketDebuggerUrl']; host, path = re.match(r'ws://([^/]+)(/.*)', u).groups(); h, port = host.split(':')
    s_ = socket.create_connection(('127.0.0.1', 9333), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    s_.sendall(f'GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode())
    buf = b''
    while b'\r\n\r\n' not in buf: buf += s_.recv(4096)
    buf = buf.split(b'\r\n\r\n', 1)[1]
    data = json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True}}).encode()
    mask = os.urandom(4); n = len(data)
    hdr = bytearray([0x81]) + (bytearray([0x80 | n]) if n < 126 else bytearray([0x80 | 126]) + n.to_bytes(2, 'big'))
    s_.sendall(bytes(hdr) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
    def need(k):
        nonlocal buf
        while len(buf) < k:
            c = s_.recv(65536)
            if not c: raise RuntimeError('ws closed')
            buf += c
    while True:
        need(2); n = buf[1] & 0x7f; off = 2
        if n == 126: need(4); n = int.from_bytes(buf[2:4], 'big'); off = 4
        elif n == 127: need(10); n = int.from_bytes(buf[2:10], 'big'); off = 10
        need(off + n); msg = json.loads(buf[off:off + n]); buf = buf[off + n:]
        if msg.get('id') == 1: s_.close(); return msg.get('result', {}).get('result', {}).get('value')
def doc(name, want_corner=None):
    """The live document of an overlay page, read from inside the WebView: its URL, the fixture marker, its API."""
    def match(u):
        if f'/assist/{name}' not in u: return False
        return want_corner is None or (('#corner' in u) == want_corner)
    pages = devtools(match)
    out = []
    for pg in pages:
        try:
            v = cdp_eval(pg, "JSON.stringify({href: location.href, marker: !!document.body && document.body.innerText.includes(%s), "
                             "api: typeof (window.W || window.E || window.S), csp: !!document.querySelector('meta[http-equiv=Content-Security-Policy]')})" % json.dumps(MARKER))
            out.append(json.loads(v))
        except Exception as e: out.append({'href': pg.get('url'), 'error': repr(e)[:120]})
    (OUT / 'devtools.log').open('a').write(f'{time.strftime("%H:%M:%S")} {name} corner={want_corner}: {json.dumps(out)}\n')
    return out
# #323 serves remote overlay documents on a virtual origin (OverlayPolicy.VIRTUAL) whose bytes come from the selected
# Wizard by native fetch; the fixture marker proves the bytes are the Wizard's, not the APK's.
VIRTUAL = 'https://wizard-overlay.invalid'
def from_wizard(docs): return bool(docs) and all(d.get('href', '').startswith(VIRTUAL + '/wizard-os-home/assist/') and d.get('marker') for d in docs)
def from_bundle(docs): return bool(docs) and all(d.get('href', '').startswith('file:///android_asset/wizard-os-home/assist/') and not d.get('marker') for d in docs)

def page_is(flow, name, want, corner=None):
    """Assert, from inside the live WebView, where the shown document came from and that its page API runs."""
    d = doc(name, corner)
    ok = (from_wizard(d) if want == 'Wizard' else from_bundle(d)) and all(x.get('api') == 'object' and x.get('csp') for x in d)
    return check(flow, f'live {name} document is the {"Wizard" if want == "Wizard" else "bundled"} copy, API running, CSP present (DevTools)', ok, d)

def settle(max_s=25, below=1.5):
    """Wait for the guest to go quiet (1-min load average) so a remote load measures the page, not boot noise."""
    t = time.time(); la = '?'
    while time.time() - t < max_s:
        la = sx('cat /proc/loadavg').split()[:1]
        try:
            if la and float(la[0]) < below: break
        except ValueError: pass
        time.sleep(2)
    log(f'  guest load before remote load: {la} after {time.time() - t:.0f}s')

def ms(a, b): return None if a is None or b is None else round((b - a) * 1000)

# ================================================================== run
results_file = OUT / 'results.json'
try:
    adb('wait-for-device')
    sx('while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done', timeout=600)
    stream_logcat()
    log('== settling fresh-boot services'); time.sleep(45)
    for k in ('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'): sx(f'settings put global {k} 0')
    sx('settings put system screen_off_timeout 1800000'); sx('svc power stayon true')
    sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard')
    sx('locksettings clear --old 1234 >/dev/null 2>&1')
    out = adb('install', '-r', '-g', APK, timeout=240).strip().splitlines()
    check('setup', 'debug QA APK installs', out and out[-1] == 'Success', out[-1:] if out else 'no output')
    check('setup', 'build is the debug QA package', PKG in sx(f'pm path {PKG}'))
    write_pref('wizard_server', f'    <string name="origin">{ORIGIN}</string>')
    write_pref('everywhere', '    <boolean name="enabled" value="true" />')
    sx(f'appops set {PKG} SYSTEM_ALERT_WINDOW allow'); sx(f'appops set {PKG} ACCESS_RESTRICTED_SETTINGS allow')
    sx(f'pm grant {PKG} android.permission.RECORD_AUDIO'); sx(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
    sx(f'cmd role add-role-holder --user 0 android.app.role.ASSISTANT {PKG}'); time.sleep(2)
    sx('settings put global power_button_long_press 5')
    check('setup', 'SYSTEM_ALERT_WINDOW granted (appops)', 'allow' in sx(f'appops get {PKG} SYSTEM_ALERT_WINDOW'))
    holders = sx('cmd role get-role-holders --user 0 android.app.role.ASSISTANT').strip()
    vis = sx('settings get secure voice_interaction_service').strip()
    check('setup', 'Wizard OS is the default assistant (role + voice_interaction_service)', PKG in holders and PKG in vis, (holders, vis))
    a11y_on(); time.sleep(1)
    server_up()
    start = now()
    log('== device after setup:', sx('getprop sys.boot_completed').strip(), '| top:', top()[:120])

    # ---------------------------------------------------------------- Wizard unreachable (nothing listening on :443)
    log('== Wizard unreachable (nothing listening on :443)')
    server_down()
    t0 = now(); fresh()
    tr, line = launch_then_home(t0)
    check('A orb unreachable', 'floating orb shows the bundled copy', 'from bundle' in line, line)
    tb, _ = first(t0, r'bubble shown'); tf, fl = first(t0, r'everywhere\.html: .*showing bundled copy')
    check('A orb unreachable', f'fallback decided within {DEADLINE}s and ready within {DEADLINE + MARGIN}s of the orb attaching', ms(tb, tf) is not None and ms(tb, tf) <= DEADLINE * 1000 and ms(tb, tr) <= (DEADLINE + MARGIN) * 1000, {'decision_ms': ms(tb, tf), 'ready_ms': ms(tb, tr), 'why': fl})
    check('A orb unreachable', 'orb overlay window present', wait_window('WizardEverywhere', 8))
    time.sleep(1.0); evidence('A-orb-unreachable'); page_is('A orb unreachable', 'everywhere.html', 'bundle')

    t0 = now()
    how, tc, line = trigger_assist(t0)
    check('C side button unreachable', 'corner surface shows the bundled copy', 'from bundle' in line, (how, line))
    ts_, _ = first(t0, r'corner shown'); tf, fl = first(t0, r'surface\.html#corner: .*showing bundled copy')
    check('C side button unreachable', f'fallback ready within {DEADLINE + MARGIN}s of the corner showing', ms(ts_, tc) is not None and ms(ts_, tc) <= (DEADLINE + MARGIN) * 1000, {'ready_ms': ms(ts_, tc), 'why': fl})
    time.sleep(1.0); evidence('C-side-unreachable'); x = (OUT / 'C-side-unreachable.xml').read_text()
    page_is('C side button unreachable', 'surface.html', 'bundle', corner=True)
    close_corner()
    no_crash('unreachable hosts', start)

    # ---------------------------------------------------------------- Wizard answers, too slowly -> the 1.5 s deadline
    log('== Wizard answers too slowly -> the 1.5 s deadline')
    server_up('slow')
    t0 = now(); r0 = len(REQ); fresh()
    tr, line = launch_then_home(t0)
    tb, _ = first(t0, r'bubble shown'); tf, fl = first(t0, r'everywhere\.html: timeout; showing bundled copy')
    check('A orb slow Wizard', 'deadline fired (timeout) and the orb shows the bundled copy', tf and 'from bundle' in line, (fl, line))
    check('A orb slow Wizard', f'timeout fired at ~{DEADLINE}s (1.2-2.0 s after attach); bundled ready within {DEADLINE + MARGIN}s',
          ms(tb, tf) is not None and 1200 <= ms(tb, tf) <= 2000 and ms(tb, tr) <= (DEADLINE + MARGIN) * 1000, {'timeout_ms': ms(tb, tf), 'ready_ms': ms(tb, tr)})
    check('A orb slow Wizard', 'the slow host really was contacted', any(p.endswith('assist/everywhere.html') for p in assist_reqs(r0)), assist_reqs(r0))
    time.sleep(1.0); evidence('A-orb-slow'); page_is('A orb slow Wizard', 'everywhere.html', 'bundle')
    MODE['v'] = 'up'

    # ---------------------------------------------------------------- airplane mode (Wizard up, phone offline)
    log('== airplane mode (Wizard up, phone offline)')
    sx('cmd connectivity airplane-mode enable'); time.sleep(4)
    ap = sx('settings get global airplane_mode_on').strip()
    reach = sx('ping -c 1 -W 2 10.0.2.2 >/dev/null 2>&1 && echo reachable || echo unreachable').strip()
    check('airplane', 'airplane mode on and 10.0.2.2 unreachable from the phone', ap == '1' and reach == 'unreachable', (ap, reach))
    t0 = now(); r0 = len(REQ); fresh()
    tr, line = launch_then_home(t0)
    check('A orb airplane', 'floating orb shows the bundled copy', 'from bundle' in line, line)
    tb, _ = first(t0, r'bubble shown'); tf, fl = first(t0, r'everywhere\.html: .*showing bundled copy')
    check('A orb airplane', f'fallback decided within {DEADLINE}s, ready within {DEADLINE + MARGIN}s', ms(tb, tf) is not None and ms(tb, tf) <= DEADLINE * 1000 and ms(tb, tr) <= (DEADLINE + MARGIN) * 1000, {'decision_ms': ms(tb, tf), 'ready_ms': ms(tb, tr), 'why': fl})
    time.sleep(1.0); evidence('A-orb-airplane'); page_is('A orb airplane', 'everywhere.html', 'bundle')
    t1 = now()
    how, tc, line = trigger_assist(t1)
    check('C side button airplane', 'corner surface shows the bundled copy', 'from bundle' in line, (how, line))
    time.sleep(1.0); evidence('C-side-airplane'); x = (OUT / 'C-side-airplane.xml').read_text()
    page_is('C side button airplane', 'surface.html', 'bundle', corner=True)
    close_corner()
    check('airplane', 'no overlay request reached the Wizard while in airplane mode', not assist_reqs(r0), assist_reqs(r0))
    sx('cmd connectivity airplane-mode disable'); time.sleep(5)
    no_crash('airplane hosts', start)

    # ---------------------------------------------------------------- lock screen (PIN keyguard), Wizard online
    log('== lock screen (PIN keyguard), Wizard online')
    t0 = now(); fresh()
    launch_then_home(t0)   # debug builds enable WebView DevTools when MainActivity starts in this process
    t0 = now(); r0 = len(REQ)
    sx('locksettings set-pin 1234'); time.sleep(1)
    sx('input keyevent KEYCODE_SLEEP'); time.sleep(2); sx('input keyevent KEYCODE_WAKEUP'); time.sleep(2)
    kg = sx('dumpsys window | grep -iE "mDreamingLockscreen|isKeyguardShowing|KeyguardShowing|mShowingLockscreen"')
    (OUT / 'L-keyguard-before.txt').write_text(kg)
    shot('L-keyguard-before')
    how, tl, line = trigger_assist(t0, r'surface\.html from (Wizard|bundle)')

    log('  lock trigger:', how)
    check('L lock screen', 'keyguard (PIN) was showing before the trigger', re.search(r'(?i)(KeyguardShowing|mShowingLockscreen)=true', kg), kg.strip()[:200])
    check('L lock screen', 'assist over the PIN keyguard opens AssistLockActivity (locked=true)', first(t0, r'surface created locked=true')[0], (how, first(t0, r'surface created|session:')[1]))
    check('L lock screen', 'lock-screen surface uses the bundled copy', 'from bundle' in line, line)
    check('L lock screen', 'real VoiceInteraction session handed off while locked (no direct Activity bypass)',
          first(t0, r'session: locked, opening the lock-screen surface')[0], how)
    (OUT / 'L-lock-requests.txt').write_text('\n'.join(f'{t:.3f} {p}' for t, p in REQ[r0:]) + '\n')

    page_is('L lock screen', 'surface.html', 'bundle', corner=False)
    check('L lock screen', 'AssistLockActivity is the resumed activity', 'AssistLockActivity' in top(), top())
    time.sleep(1.5); evidence('L-lock-surface'); x = (OUT / 'L-lock-surface.xml').read_text()
    lk = doc('surface.html', False)
    try: locked_ui = cdp_eval(devtools(lambda u: '/assist/surface.html' in u and '#corner' not in u)[0], "document.getElementById('lock').textContent + '|' + getComputedStyle(document.getElementById('unlockC')).display")
    except Exception as e: locked_ui = repr(e)[:120]
    check('L lock screen', 'surface shows its locked state (lock label, Unlock chip shown)', isinstance(locked_ui, str) and 'locked' in locked_ui and not locked_ui.endswith('|none'), locked_ui)
    (OUT / 'L-lock-trigger.txt').write_text(str(how))
    check('L lock screen', 'zero requests to the Wizard while locked, including the hidden session', not REQ[r0:], REQ[r0:])
    no_crash('lock screen', start)
    sx(f'am force-stop {PKG}'); sx('input keyevent KEYCODE_WAKEUP')
    sx('locksettings clear --old 1234'); sx('wm dismiss-keyguard'); time.sleep(1)

    server_up()
    log('== online (renderer now warm): orb, side button')
    def orb_online(attempt):
        t0 = now(); r0 = len(REQ); fresh(); settle()
        tr, line = launch_then_home(t0)
        return t0, r0, line
    # ---------------------------------------------------------------- A online: orb from the Wizard
    log('== A online: orb from the Wizard')
    cold = []
    for attempt in range(1, 6):
        t0, r0, line = orb_online(attempt)
        if 'from Wizard' in line: break
        # A cold emulator renderer can miss the 1.5 s deadline (docs/android-overlay-security.md); that is the
        # fallback doing its job. Keep the evidence and retry, at most 5 loads in total.
        cold.append(f'attempt {attempt}: {line.strip()[-70:]} | reason: {why(t0, "everywhere.html")} | requests: {assist_reqs(r0)}')
        log('  orb load fell back:', cold[-1])
    (OUT / 'A-orb-online-attempts.txt').write_text('\n'.join(cold + [f'final: {line.strip()}']) + '\n')
    check('A orb online', 'remote load attempts until the Wizard copy was ready (<= 5)', 'from Wizard' in line, f'{len(cold) + 1} load(s); fell back first: {len(cold)}')
    check('A orb online', 'floating orb page came from the Wizard', 'from Wizard' in line, (line, why(t0, 'everywhere.html')))
    w = wait_window('WizardEverywhere', 10)
    check('A orb online', 'orb is a WindowManager overlay window (WizardEverywhere)', w, w)
    got = assist_reqs(r0)
    check('A orb online', 'fake Wizard served everywhere.html, everywhere.js and orb.js (static allowlist)', all(any(p.endswith(f) for p in got) for f in ('assist/everywhere.html', 'assist/everywhere.js', '/orb.js')), got)
    time.sleep(1.5); evidence('A-orb-online')
    x = (OUT / 'A-orb-online.xml').read_text()
    check('A orb online', 'orb visible in uiautomator dump (content-desc Wizard Everywhere)', 'Wizard Everywhere' in x, 'see A-orb-online.xml')
    page_is('A orb online', 'everywhere.html', 'Wizard')

    # ---------------------------------------------------------------- C online: side-button corner orb from the Wizard
    log('== C online: side-button corner orb from the Wizard')
    settle(); t0 = now(); r0 = len(REQ)
    corner_tries = []
    for attempt in range(1, 6):
        how, tc, line = trigger_assist(t0)
        if not line or 'from Wizard' in line: break
        corner_tries.append(f'attempt {attempt}: {line.strip()[-60:]} | reason: {why(t0, "surface.html#corner")} | requests: {assist_reqs(r0)}')
        log('  corner load fell back:', corner_tries[-1])
        # A re-shown session keeps its WebView: only a new app process gives the corner a new page load.
        if attempt == 5: break
        close_corner(); evidence(f'C-side-online-fallback-{attempt}'); t0 = now(); fresh(); launch_then_home(t0); settle(); t0 = now(); r0 = len(REQ)
    (OUT / 'C-side-online-attempts.txt').write_text('\n'.join(corner_tries + [f'final: {line.strip()}']) + '\n')
    won = 'from Wizard' in line
    tshow, _ = first(t0, r'corner shown'); tdead, _ = first(t0, r'surface\.html#corner: timeout')
    cports = sorted({c for t, c, p in CONN if t >= (REQ[r0][0] if r0 < len(REQ) else 0) and p.split('?')[0].removeprefix('/wizard-os-home/') in OVERLAY_FILES})
    check('C side button unlocked online', 'Wizard copy of the corner page ready inside the 1.5 s production deadline', won,
          f'{len(corner_tries) + (1 if won else 0)} load(s), {len(corner_tries)} fell back; last: new TCP/TLS connections={len(cports)} for {len(assist_reqs(r0))} overlay requests; ready_ms={ms(tshow, tc)}')
    log('  assist trigger:', how)
    check('C side button unlocked online', 'assist gesture reached WizardSession (corner shown)', first(t0, r'corner shown')[0], (how, first(t0, r'corner shown|session:')[1]))
    check('C side button unlocked online', 'fake Wizard served surface.html and surface.js', any(p.endswith('assist/surface.html') for p in assist_reqs(r0)) and any(p.endswith('assist/surface.js') for p in assist_reqs(r0)), assist_reqs(r0))
    time.sleep(1.5); evidence('C-side-online'); x = (OUT / 'C-side-online.xml').read_text()
    page_is('C side button unlocked online', 'surface.html', 'Wizard', corner=True)
    close_corner()
    no_crash('online hosts', start)

    # ---------------------------------------------------------------- Screen mode last (accessibility capture is the heaviest emulator path)
    log('== Screen mode (accessibility): online, unreachable, airplane')
    for phase in ('online', 'unreachable', 'airplane'):
        if phase == 'unreachable': server_down()
        if phase == 'airplane': server_up(); sx('cmd connectivity airplane-mode enable'); time.sleep(4)
        t0 = now(); r0 = len(REQ); fresh()
        launch_then_home(t0)
        wait_log(t0, r'keyboard service connected', 15)
        b, picked, line = open_screen(t0)
        flow = f'B screen {phase}'
        check(flow, 'orb hold -> menu -> Select text', picked, (b, picked))
        check(flow, 'Screen mode page came from the Wizard' if phase == 'online' else 'Screen mode shows the bundled copy',
              ('from Wizard' if phase == 'online' else 'from bundle') in line, (line, why(t0, 'screen.html')))
        check(flow, 'Screen mode is a WindowManager overlay window (WizScreen)', wait_window('WizScreen', 6))
        check(flow, 'accessibility screenshot taken for the page', first(t0, r'screen shot \d+ bytes')[0], first(t0, r'screen shot')[1])
        if phase != 'online':
            tb, _ = first(t0, r'screen mode open'); tr, _ = first(t0, r'screen\.html from bundle')
            check(flow, f'bundled page ready within {DEADLINE + MARGIN}s of open', ms(tb, tr) is not None and ms(tb, tr) <= (DEADLINE + MARGIN) * 1000, {'ready_ms': ms(tb, tr), 'why': why(t0, 'screen.html')})
        time.sleep(1.5); evidence(f'B-screen-{phase}'); x = (OUT / f'B-screen-{phase}.xml').read_text()
        check(flow, 'Screen page UI in uiautomator dump (Select all / Close)', re.search(r'Select all|"Close"', x), f'see B-screen-{phase}.xml')
        page_is(flow, 'screen.html', 'Wizard' if phase == 'online' else 'bundle')
        if phase == 'airplane': check(flow, 'no request reached the Wizard', not assist_reqs(r0), assist_reqs(r0))
        close_screen()
        no_crash(flow, start)
    sx('cmd connectivity airplane-mode disable')

    no_crash('whole run', start)
except DeviceLost as e:
    check('harness', 'emulator stayed reachable over adb', False, repr(e))
except Exception as e:
    import traceback; traceback.print_exc()
    check('harness', 'host-flow script ran to completion', False, repr(e))
finally:
    try:
        if LOGCAT['p']: LOGCAT['p'].terminate()
        (OUT / 'requests.txt').write_text('\n'.join(f'{t:.3f} {p}' for t, p in REQ))
        (OUT / 'connections.txt').write_text('\n'.join(f'{t:.3f} port={c} {p}' for t, c, p in CONN))
    except Exception: pass
    for f in OUT.glob('tmp-*'): f.unlink()
    results_file.write_text(json.dumps(results, indent=1))
    fails = [r for r in results if not r['ok'] and r.get('gate', True)]
    unproven = [r for r in results if not r['ok'] and not r.get('gate', True)]
    with open(OUT / 'summary.md', 'w') as s:
        gated = [r for r in results if r.get('gate', True)]
        s.write(f'### Android overlay host flows: {len(gated) - len(fails)}/{len(gated)} gating checks passed'
                + (f'; {len(unproven)} NOT PROVEN on this emulator (non-gating, listed with ⚠️)' if unproven else '') + '\n\n')
        for r in results: s.write(f"- {'✅' if r['ok'] else ('❌' if r.get('gate', True) else '⚠️ NOT PROVEN:')} **{r['flow']}** {r['check']}" + (f" — `{r['detail'][:200]}`" if r['detail'] else '') + '\n')
    server_down()
    sys.exit(1 if fails or not results else 0)
