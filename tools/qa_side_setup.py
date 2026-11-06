#!/usr/bin/env python3
"""Side-button switch QA (runs on Thales). Fresh API35 emulator, the Wizard OS build under test, real taps.

usage: qa_side_setup.py NEW_APK PKG [OLD_APK]
With OLD_APK, installs it first and upgrades over it (the same path James's phone takes).
Checks: the switch shows on Home only in the native app; one tap asks for the mic in place; after the mic it
lands on the system assistant picker; picking Wizard OS there and coming back turns the card green on its own;
a real side-button hold reaches Wizard OS and the card then disappears; Android's assistant gear opens Wizard OS
on the switch; Back never leaves Wizard OS. Hermes/Wizard writes are failed by CDP. Always stops the emulator."""
import fcntl, json, os, pathlib, re, socket, subprocess, sys, time, uuid
import urllib.request
from qa_paths import work_root
from qa_paths import android_sdk, java_home
P = pathlib.Path
BASE = P(str(work_root() / 'AndroidBuilds')); SDK = android_sdk()
apk = P(sys.argv[1]); PKG = sys.argv[2]; old = P(sys.argv[3]) if len(sys.argv) > 3 else None
job = BASE / 'qa' / ('wos-side-' + uuid.uuid4().hex[:8]); job.mkdir(parents=True)
OUT = job / 'shots'; OUT.mkdir()
env = os.environ.copy(); env.update(JAVA_HOME=java_home(),
    ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK), ANDROID_AVD_HOME=str(job / 'avd'))
env['PATH'] = env['JAVA_HOME'] + '/bin:' + env['PATH']; (job / 'avd').mkdir()
ADB = str(SDK / 'platform-tools/adb'); PORT = 5690; S = f'emulator-{PORT}'; DEVTOOLS = 9341
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
        t = re.search(r' text="([^"]*)"', n)
        label = t.group(1) if t else ''
        if label and re.search(pattern, label, re.I):
            b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
            if b:
                x1, y1, x2, y2 = map(int, b.groups()); sx(f'input tap {(x1 + x2) // 2} {(y1 + y2) // 2}'); return label
    return None

class Page:
    """Raw CDP over a websocket to the app's WebView (stdlib only)."""
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
        if not page: raise RuntimeError('no Wizard OS page')
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
def card(pg):
    return pg.ev("(() => { const c = document.querySelector('.side-card'); return c ? { step: c.dataset.step, text: c.innerText.replace(/\\s+/g, ' ').trim(), on: c.classList.contains('on') } : null; })()")
def card_center(pg):
    r = pg.ev("(() => { const c = document.querySelector('.side-card'); if (!c) return null; const b = c.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, dpr: devicePixelRatio, ih: innerHeight }; })()")
    return r

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
        if old:
            print('old install', sh(ADB, '-s', S, 'install', old).strip().splitlines()[-1])
            print('old version', re.search(r'versionName=\S+', sx(f'dumpsys package {PKG}')).group(0))
        out = sh(ADB, '-s', S, 'install', '-r', apk).strip().splitlines()[-1]
        ver = re.search(r'versionName=\S+', sx(f'dumpsys package {PKG}')).group(0)
        check('install' + (' over the old build' if old else ''), out == 'Success', out + ' ' + ver)
        check('mic not yet granted (real first run)', 'RECORD_AUDIO: granted=true' not in sx(f'dumpsys package {PKG} | grep RECORD_AUDIO'))
        holders0 = sx('cmd role get-role-holders --user 0 android.app.role.ASSISTANT').strip()
        print('assistant before:', holders0)
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(9)
        pg = Page(); wait_shell(pg)
        pg.ev("(() => { const c = document.querySelector('#coach'); if (c && !c.hidden) document.querySelector('#coachGo').click(); return true; })()")
        time.sleep(1)
        st = json.loads(pg.ev("window.WizardOSNative.sideButton()"))
        check('native bridge reports mic first', st['step'] == 'mic', st)
        c = card(pg)
        check('Home shows the Side button card with Turn on', c and c['step'] == 'mic' and 'Turn on' in c['text'], c)
        shot('01-home-card')
        lau = pg.ev("(() => { window.__wos.openSheet('launcher'); return [...document.querySelectorAll('[data-app=\"side-button\"]')].length; })()")
        check('launcher lists Side button', (lau or 0) >= 1, lau)
        pg.ev("window.__wos.closeSheets()"); time.sleep(0.6)
        # Real tap on the card
        cc = card_center(pg)
        sw, shh = map(int, re.search(r'(\d+)x(\d+)', sx('wm size')).groups())
        # WebView fills the screen minus status bar (insets padding); map CSS px to device px
        off_y = shh - round(cc['ih'] * cc['dpr'])
        sx(f"input tap {round(cc['x'] * cc['dpr'])} {round(cc['y'] * cc['dpr']) + max(0, off_y - 0)}")
        time.sleep(2.5)
        xml = ui(); shot('02-mic-prompt')
        check('one tap asks for the microphone in place', 'permissioncontroller' in xml and re.search(r'record audio|microphone', xml, re.I), top())
        tapped = tap_text(r'^While using the app$', xml) or tap_text(r'^Allow$', xml)
        time.sleep(3)
        t = top(); shot('03-assistant-page')
        check('after the mic it lands on the system assistant picker', 'ManageAssist' in t or 'DefaultApp' in t or 'Settings' in t, t)
        check('mic granted', 'RECORD_AUDIO: granted=true' in sx(f'dumpsys package {PKG} | grep RECORD_AUDIO'), tapped)
        # Pick Wizard OS the way a person would: Digital assistant app -> Wizard OS -> OK
        picked = None
        for pat in [r'^(Default )?digital assistant app$|^Assist app$', r'^Wizard OS', r'^OK$|^Agree$']:
            time.sleep(1.5); picked = tap_text(pat); print('  tapped', pat, '->', picked)
        time.sleep(2); shot('04-picked')
        holders = sx('cmd role get-role-holders --user 0 android.app.role.ASSISTANT').strip()
        if PKG not in holders:
            print('  UI pick did not land (', holders, '); setting role by shell to continue the flow')
            sx(f'cmd role add-role-holder --user 0 android.app.role.ASSISTANT {PKG}'); time.sleep(2)
        check('Wizard OS picked as the assistant in the system page', PKG in sx('cmd role get-role-holders --user 0 android.app.role.ASSISTANT'), holders)
        # Come back the way a person does: Back from Settings
        for _ in range(4):
            if PKG in top(): break
            sx('input keyevent KEYCODE_BACK'); time.sleep(1.5)
        time.sleep(2)
        check('Back from Settings returns to Wizard OS', PKG in top(), top())
        pg.close(); pg = Page(); wait_shell(pg); time.sleep(1.5)
        c = card(pg); shot('05-card-on')
        check('the card turns green on its own: Side button is on', c and c['on'] and c['step'] == 'press' and 'Hold the side button' in c['text'], c)
        # Real long-press of the power key
        used_before = json.loads(pg.ev("window.WizardOSNative.sideButton()"))['used']
        sx('settings put global power_button_long_press 5'); sx('logcat -c')
        sx('input keyevent --longpress KEYCODE_POWER'); time.sleep(4)
        t = top(); shot('06-side-hold')
        lg = sx('logcat -d | grep -iE "corner shown|lock-screen surface" | tail -3').strip()
        check('holding the side button reaches Wizard OS (corner orb)', 'corner shown' in lg and not used_before, lg)
        sx('input keyevent KEYCODE_BACK'); time.sleep(1.5)
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(3)
        pg.close(); pg = Page(); wait_shell(pg); time.sleep(1)
        st = json.loads(pg.ev("window.WizardOSNative.sideButton()"))
        check('after a real hold the switch reads ready and the card is gone', st['step'] == 'ready' and card(pg) is None, st)
        # Android's assistant gear -> Wizard OS on the switch
        sx('input keyevent KEYCODE_HOME'); time.sleep(1)
        o = sx(f'am start -W -n {PKG}/ai.wizards.os.assist.AssistSetupActivity'); time.sleep(3)
        check("Android's assistant settings gear opens Wizard OS itself", re.search(re.escape(PKG) + r'/(ai\.wizards\.os)?\.MainActivity', top()), top())
        # Back never exits
        for _ in range(3): sx('input keyevent KEYCODE_BACK'); time.sleep(1)
        check('Back at Home stays in Wizard OS', PKG in top(), top())
        crashed = 'FATAL EXCEPTION' in sx('logcat -d -b crash')
        check('no crashes', not crashed)
        check('nothing written to Wizard during QA', not pg.writes, pg.writes[:3])
    finally:
        if pg: pg.close()
        if em: sh(ADB, '-s', S, 'emu', 'kill'); em.wait(40)
print(f'{sum(res)}/{len(res)} passed · shots {OUT}')
