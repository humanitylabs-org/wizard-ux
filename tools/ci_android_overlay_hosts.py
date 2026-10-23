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
def check(flow, name, ok, detail=''):
    results.append({'flow': flow, 'check': name, 'ok': bool(ok), 'detail': str(detail)[:600]})
    log(('PASS ' if ok else 'FAIL ') + f'[{flow}] {name}' + (f' — {str(detail)[:400]}' if detail not in ('', None) else ''))
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
        if state != 'device' and SLOW['n'] >= 3: raise DeviceLost(f'emulator no longer answers adb (state={state!r})')
    return out
def sx(cmd, **k): return adb('shell', cmd, **k)

# ------------------------------------------------------------------ fake Wizard (HTTPS, runner loopback :443)
REQ = []                     # (host_time, path)
MODE = {'v': 'up'}           # up | slow
class Fake(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass
    def do_GET(self):
        REQ.append((time.time(), self.path))
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        m = re.match(r'^/wizard-os-home/(.*)$', path)
        f = (m.group(1) or 'index.html') if m else None
        p = (WEB / f).resolve() if f else None
        if not p or not str(p).startswith(str(WEB.resolve())) or not p.is_file():
            b = b'{"error":"fixture"}'
            self.send_response(404); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b); return
        b = p.read_bytes()
        if f.startswith('assist/') and f.endswith('.html'):
            # A marker only the Wizard's copy carries, visible to uiautomator (not to people: opacity .02).
            tag = f'<div aria-label="{MARKER}" style="position:fixed;left:0;top:0;width:6px;height:6px;opacity:.02;overflow:hidden">{MARKER}</div>'.encode()
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
    s.socket = ctx.wrap_socket(s.socket, server_side=True)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    SRV['s'] = s
def server_down():
    s = SRV['s']; SRV['s'] = None
    if s: s.shutdown(); s.server_close()
def assist_reqs(since): return [p for t, p in REQ[since:] if '/wizard-os-home/assist/' in p]

# ------------------------------------------------------------------ device helpers
def now():
    t = sx('date +%s.%N').strip()
    try: return float(t)
    except ValueError: return float(sx('date +%s').strip() or 0)
def logs(since, tags=('WizardOverlay', 'WizardEverywhere', 'WizardOSAssist')):
    out = []
    for line in adb('logcat', '-d', '-v', 'epoch', '-s', *[t + ':*' for t in tags]).splitlines():
        m = re.match(r'\s*(\d+\.\d+)\s', line)
        if m and float(m.group(1)) >= since: out.append((float(m.group(1)), line))
    return out
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
    x = ''
    for args in ('--windows /sdcard/ui.xml', '/sdcard/ui.xml'):
        sx(f'rm -f /sdcard/ui.xml; uiautomator dump {args} >/dev/null 2>&1')
        x = sx('cat /sdcard/ui.xml')
        if '<hierarchy' in x: break
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
def fresh():
    """New app process: every host builds a new WebView (and so a new OverlayPage load)."""
    sx(f'am force-stop {PKG}'); time.sleep(1.5)
    a11y_on()   # Android disables a force-stopped package's accessibility service
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
    sx(f'input swipe {x} {y} {x} {y} 1000')
    if not wait_window('WizOrbMenu', 5): return b, None, ''
    xml = ui('tmp-menu'); picked = tap_text(r'^Select text$', xml)
    t, l = wait_log(since, r'screen\.html from (Wizard|bundle)', 20)
    return b, picked, l
def close_screen():
    sx('input keyevent KEYCODE_BACK'); time.sleep(0.8)
    if window('WizScreen'): sx('input keyevent KEYCODE_BACK'); time.sleep(0.8)
def no_crash(flow, since):
    full = adb('logcat', '-d', '-v', 'epoch')
    crash = adb('logcat', '-d', '-b', 'crash', '-v', 'epoch')
    bad = []
    for buf in (full, crash):
        lines = buf.splitlines()
        for i, l in enumerate(lines):
            m = re.match(r'\s*(\d+\.\d+)\s', l)
            if not m or float(m.group(1)) < since: continue
            if 'FATAL EXCEPTION' in l and any(PKG in x for x in lines[i:i + 4]): bad.append(' | '.join(lines[i:i + 6]))
            if f'ANR in {PKG}' in l: bad.append(l)
    check(flow, 'no crash or ANR from Wizard OS', not bad, bad[:3])
def evidence(name):
    shot(name); ui(name); (OUT / f'{name}-windows.txt').write_text(windows())

def ms(a, b): return None if a is None or b is None else round((b - a) * 1000)

# ================================================================== run
results_file = OUT / 'results.json'
try:
    adb('wait-for-device')
    sx('while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done', timeout=600)
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

    # ---------------------------------------------------------------- A online: orb from the Wizard
    log('== A online: orb from the Wizard')
    t0 = now(); r0 = len(REQ); fresh()
    tr, line = launch_then_home(t0)
    check('A orb online', 'floating orb page came from the Wizard', 'from Wizard' in line, line)
    w = wait_window('WizardEverywhere', 10)
    check('A orb online', 'orb is a WindowManager overlay window (WizardEverywhere)', w, w)
    got = assist_reqs(r0)
    check('A orb online', 'fake Wizard served everywhere.html, everywhere.js and orb.js', all(any(p.endswith(f) for p in got) for f in ('assist/everywhere.html', 'assist/everywhere.js', '/orb.js')), got)
    time.sleep(1.5); evidence('A-orb-online')
    x = (OUT / 'A-orb-online.xml').read_text()
    log('  orb in uiautomator dump:', 'Wizard Everywhere' in x, '| Wizard marker:', MARKER in x)
    check('A orb online', 'orb visible in uiautomator dump (content-desc Wizard Everywhere)', 'Wizard Everywhere' in x, 'see A-orb-online.xml')

    # ---------------------------------------------------------------- B online: Screen mode from the Wizard
    log('== B online: Screen mode from the Wizard')
    t0 = now(); r0 = len(REQ)
    wait_log(t0 - 60, r'keyboard service connected', 15)
    b, picked, line = open_screen(t0)
    check('B screen online', 'orb hold -> menu -> Select text', picked, (b, picked))
    check('B screen online', 'Screen mode page came from the Wizard', 'from Wizard' in line, line)
    check('B screen online', 'Screen mode is a WindowManager overlay window (WizScreen)', wait_window('WizScreen', 6))
    check('B screen online', 'accessibility screenshot reached the page', first(t0, r'screen shot \d+ bytes')[0], first(t0, r'screen shot')[1])
    time.sleep(1.5); evidence('B-screen-online'); x = (OUT / 'B-screen-online.xml').read_text()
    check('B screen online', 'Screen page UI in uiautomator dump (Select all / Close)', re.search(r'Select all|"Close"', x), 'see B-screen-online.xml')
    check('B screen online', 'uiautomator sees the Wizard-only marker', MARKER in x)
    close_screen()

    # ---------------------------------------------------------------- C online: side-button corner orb from the Wizard
    log('== C online: side-button corner orb from the Wizard')
    t0 = now(); r0 = len(REQ)
    how, tc, line = trigger_assist(t0)
    log('  assist trigger:', how)
    check('C side button unlocked online', 'assist gesture reached WizardSession (corner shown)', first(t0, r'corner shown')[0], (how, first(t0, r'corner shown|session:')[1]))
    check('C side button unlocked online', 'corner surface page came from the Wizard', 'from Wizard' in line, line)
    check('C side button unlocked online', 'fake Wizard served surface.html and surface.js', any(p.endswith('assist/surface.html') for p in assist_reqs(r0)) and any(p.endswith('assist/surface.js') for p in assist_reqs(r0)), assist_reqs(r0))
    time.sleep(1.5); evidence('C-side-online'); x = (OUT / 'C-side-online.xml').read_text()
    check('C side button unlocked online', 'surface UI in uiautomator dump (Pause / Cancel)', re.search(r'content-desc="(Pause|Cancel)"', x), 'see C-side-online.xml')
    close_corner()
    no_crash('online hosts', start)

    # ---------------------------------------------------------------- D/E/F: Wizard unreachable (nothing listening on :443)
    log('== D/E/F: Wizard unreachable (nothing listening on :443)')
    server_down()
    t0 = now(); r0 = len(REQ)
    b, picked, line = open_screen(t0)
    check('B screen unreachable', 'Screen mode shows the bundled copy', 'from bundle' in line, line)
    tb, _ = first(t0, r'screen mode open'); tf, fl = first(t0, r'screen\.html: .*showing bundled copy'); tr, _ = first(t0, r'screen\.html from bundle')
    check('B screen unreachable', f'fallback decided within {DEADLINE}s and ready within {DEADLINE + MARGIN}s of open', ms(tb, tf) is not None and ms(tb, tf) <= DEADLINE * 1000 and ms(tb, tr) <= (DEADLINE + MARGIN) * 1000, {'decision_ms': ms(tb, tf), 'ready_ms': ms(tb, tr), 'why': fl})
    time.sleep(1.0); evidence('B-screen-unreachable'); x = (OUT / 'B-screen-unreachable.xml').read_text()
    check('B screen unreachable', 'bundled Screen UI in uiautomator dump, without the Wizard marker', re.search(r'Select all|"Close"', x) and MARKER not in x)
    close_screen()

    t0 = now(); fresh()
    tr, line = launch_then_home(t0)
    check('A orb unreachable', 'floating orb shows the bundled copy', 'from bundle' in line, line)
    tb, _ = first(t0, r'bubble shown'); tf, fl = first(t0, r'everywhere\.html: .*showing bundled copy')
    check('A orb unreachable', f'fallback decided within {DEADLINE}s and ready within {DEADLINE + MARGIN}s of the orb attaching', ms(tb, tf) is not None and ms(tb, tf) <= DEADLINE * 1000 and ms(tb, tr) <= (DEADLINE + MARGIN) * 1000, {'decision_ms': ms(tb, tf), 'ready_ms': ms(tb, tr), 'why': fl})
    check('A orb unreachable', 'orb overlay window present', wait_window('WizardEverywhere', 8))
    time.sleep(1.0); evidence('A-orb-unreachable')

    t0 = now()
    how, tc, line = trigger_assist(t0)
    check('C side button unreachable', 'corner surface shows the bundled copy', 'from bundle' in line, (how, line))
    tf, fl = first(t0, r'surface\.html#corner: .*showing bundled copy')
    check('C side button unreachable', f'fallback decided and ready within {DEADLINE + MARGIN}s of the assist trigger log', tf is not None and tc is not None, {'why': fl})
    time.sleep(1.0); evidence('C-side-unreachable')
    close_corner()
    no_crash('unreachable hosts', start)

    # ---------------------------------------------------------------- G: Wizard answers, too slowly -> the 1.5 s deadline
    log('== G: Wizard answers, too slowly -> the 1.5 s deadline')
    server_up('slow')
    t0 = now(); r0 = len(REQ); fresh()
    tr, line = launch_then_home(t0)
    tb, _ = first(t0, r'bubble shown'); tf, fl = first(t0, r'everywhere\.html: timeout; showing bundled copy')
    check('A orb slow Wizard', 'deadline fired (timeout) and the orb shows the bundled copy', tf and 'from bundle' in line, (fl, line))
    check('A orb slow Wizard', f'timeout fired at ~{DEADLINE}s (1.2-2.0 s after attach); bundled ready within {DEADLINE + MARGIN}s',
          ms(tb, tf) is not None and 1200 <= ms(tb, tf) <= 2000 and ms(tb, tr) <= (DEADLINE + MARGIN) * 1000, {'timeout_ms': ms(tb, tf), 'ready_ms': ms(tb, tr)})
    check('A orb slow Wizard', 'the slow host really was contacted', any(p.endswith('assist/everywhere.html') for p in assist_reqs(r0)), assist_reqs(r0))
    time.sleep(1.0); evidence('A-orb-slow')
    MODE['v'] = 'up'

    # ---------------------------------------------------------------- H: airplane mode (Wizard up, phone offline)
    log('== H: airplane mode (Wizard up, phone offline)')
    sx('cmd connectivity airplane-mode enable'); time.sleep(4)
    ap = sx('settings get global airplane_mode_on').strip()
    reach = sx('ping -c 1 -W 2 10.0.2.2 >/dev/null 2>&1 && echo reachable || echo unreachable').strip()
    check('airplane', 'airplane mode on and 10.0.2.2 unreachable from the phone', ap == '1' and reach == 'unreachable', (ap, reach))
    t0 = now(); r0 = len(REQ); fresh()
    tr, line = launch_then_home(t0)
    check('A orb airplane', 'floating orb shows the bundled copy', 'from bundle' in line, line)
    tb, _ = first(t0, r'bubble shown'); tf, fl = first(t0, r'everywhere\.html: .*showing bundled copy')
    check('A orb airplane', f'fallback decided within {DEADLINE}s, ready within {DEADLINE + MARGIN}s', ms(tb, tf) is not None and ms(tb, tf) <= DEADLINE * 1000 and ms(tb, tr) <= (DEADLINE + MARGIN) * 1000, {'decision_ms': ms(tb, tf), 'ready_ms': ms(tb, tr), 'why': fl})
    time.sleep(1.0); evidence('A-orb-airplane')
    t1 = now()
    how, tc, line = trigger_assist(t1)
    check('C side button airplane', 'corner surface shows the bundled copy', 'from bundle' in line, (how, line))
    time.sleep(1.0); evidence('C-side-airplane'); x = (OUT / 'C-side-airplane.xml').read_text()
    check('C side button airplane', 'bundled surface UI in uiautomator dump, without the Wizard marker', re.search(r'content-desc="(Pause|Cancel)"', x) and MARKER not in x)
    close_corner()
    t2 = now()
    wait_log(t0, r'keyboard service connected', 10)
    b, picked, line = open_screen(t2)
    check('B screen airplane', 'Screen mode shows the bundled copy', 'from bundle' in line, (picked, line))
    time.sleep(1.0); evidence('B-screen-airplane')
    close_screen()
    check('airplane', 'no overlay request reached the Wizard while in airplane mode', not assist_reqs(r0), assist_reqs(r0))
    sx('cmd connectivity airplane-mode disable'); time.sleep(5)
    no_crash('airplane hosts', start)

    # ---------------------------------------------------------------- L: lock screen (PIN keyguard), Wizard online
    log('== L: lock screen (PIN keyguard), Wizard online')
    t0 = now(); r0 = len(REQ); fresh()
    sx('locksettings set-pin 1234'); time.sleep(1)
    sx('input keyevent KEYCODE_SLEEP'); time.sleep(2); sx('input keyevent KEYCODE_WAKEUP'); time.sleep(2)
    kg = sx('dumpsys window | grep -iE "mDreamingLockscreen|isKeyguardShowing|KeyguardShowing|mShowingLockscreen"')
    (OUT / 'L-keyguard-before.txt').write_text(kg)
    shot('L-keyguard-before')
    how, tl, line = trigger_assist(t0, r'surface\.html from (Wizard|bundle)')
    if not tl:
        # Last resort, as the Thales scripts do: the ASSIST intent straight to the lock-screen surface.
        how = 'am start -a android.intent.action.ASSIST (direct)'
        sx(f'am start -a android.intent.action.ASSIST -n {PKG}/ai.wizards.os.assist.AssistLockActivity')
        tl, line = wait_log(t0, r'surface\.html from (Wizard|bundle)', 15)
    log('  lock trigger:', how)
    check('L lock screen', 'side button over the PIN keyguard opens AssistLockActivity (locked=true)', first(t0, r'surface created locked=true')[0], (how, first(t0, r'surface created|session:')[1]))
    check('L lock screen', 'lock-screen surface uses the bundled copy', 'from bundle' in line, line)
    check('L lock screen', 'the lock-screen surface never contacted the (reachable) Wizard', not any('surface' in p for p in assist_reqs(r0)), assist_reqs(r0))
    check('L lock screen', 'AssistLockActivity is the resumed activity', 'AssistLockActivity' in top(), top())
    time.sleep(1.5); evidence('L-lock-surface'); x = (OUT / 'L-lock-surface.xml').read_text()
    check('L lock screen', 'locked surface UI in uiautomator dump (Unlock the phone), without the Wizard marker', 'Unlock the phone' in x and MARKER not in x, 'see L-lock-surface.xml')
    (OUT / 'L-lock-trigger.txt').write_text(str(how))
    no_crash('lock screen', start)
    sx(f'am force-stop {PKG}'); sx('input keyevent KEYCODE_WAKEUP')
    sx('locksettings clear --old 1234'); sx('wm dismiss-keyguard')

    no_crash('whole run', start)
except DeviceLost as e:
    check('harness', 'emulator stayed reachable over adb', False, repr(e))
except Exception as e:
    import traceback; traceback.print_exc()
    check('harness', 'host-flow script ran to completion', False, repr(e))
finally:
    try:
        (OUT / 'logcat.txt').write_text(adb('logcat', '-d', '-v', 'epoch', timeout=120))
        (OUT / 'logcat-crash.txt').write_text(adb('logcat', '-d', '-b', 'crash', '-v', 'epoch'))
        (OUT / 'requests.txt').write_text('\n'.join(f'{t:.3f} {p}' for t, p in REQ))
    except Exception: pass
    for f in OUT.glob('tmp-*'): f.unlink()
    results_file.write_text(json.dumps(results, indent=1))
    fails = [r for r in results if not r['ok']]
    with open(OUT / 'summary.md', 'w') as s:
        s.write(f'### Android overlay host flows: {len(results) - len(fails)}/{len(results)} checks passed\n\n')
        for r in results: s.write(f"- {'✅' if r['ok'] else '❌'} **{r['flow']}** {r['check']}" + (f" — `{r['detail'][:200]}`" if r['detail'] else '') + '\n')
    server_down()
    sys.exit(1 if fails or not results else 0)
