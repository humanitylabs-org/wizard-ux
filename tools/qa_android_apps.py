#!/usr/bin/env python3
"""Android Apps device QA (runs on Thales). Fresh API 35 emulator, exact APK bytes, real PackageInstaller.

usage: qa_android_apps.py QA_APK WEB_DIR AA_STATIC_DIR OLD_APK NEW_APK [JOB_DIR]
  QA_APK       the debug build (ai.wizards.os.qa) of the candidate
  WEB_DIR      the shell's web/ dir (served by a fake Wizard on the Thales host, adb reverse)
  AA_STATIC    android-apps/app/static (the Android Apps view, served at /android-apps/)
  OLD_APK      fixture app, older (Aegis 3.4.2, versionCode 81, developer-signed)
  NEW_APK      fixture app, newer (Aegis 3.4.3, versionCode 82, same key)
A wrong-signer copy of NEW_APK is made here with a throwaway key. The real Wizard is never contacted (emulator DNS is
dead; the fake answers on localhost). Always stops the emulator.
"""
import argparse, fcntl, hashlib, http.server, json, os, pathlib, re, subprocess, sys, threading, time, uuid
from qa_paths import origin_host
from qa_paths import java_home
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_aa_lib import ADB, BASE, BT, Emu, Page, wait  # noqa: E402

QA_ORIGIN_HOST = origin_host()
P = pathlib.Path
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', choices=('legacy', 'device'), default='legacy')
parser.add_argument('--owner-switch', action='store_true', help='Exercise real Connect A→B isolation after package work')
parser.add_argument('qa_apk', type=P); parser.add_argument('web', type=P); parser.add_argument('aa', type=P)
parser.add_argument('old', type=P); parser.add_argument('new', type=P)
parser.add_argument('job', nargs='?', type=P)
args = parser.parse_args()
QA_APK, WEB, AA, OLD, NEW = args.qa_apk, args.web, args.aa, args.old, args.new
job = args.job or BASE / 'qa' / ('wos-aa-' + uuid.uuid4().hex[:8])
job.mkdir(parents=True, exist_ok=True)
OUT = job / 'shots'; OUT.mkdir(exist_ok=True)
PKG = 'ai.wizards.os.qa'; FIX = 'com.beemdevelopment.aegis'; FAKE = 18797; ORIGIN = 'http://localhost:%d' % FAKE
DEVTOOLS = 9361; JOB_ID = 7621
res, receipt = [], {'job': str(job), 'checks': [], 'candidate_head': os.environ.get('WIZARD_QA_HEAD'), 'port': args.port}


def check(n, ok, d=''):
    res.append(bool(ok)); receipt['checks'].append([bool(ok), n, str(d)[:400]])
    print(('PASS ' if ok else 'FAIL ') + n + (' — ' + str(d)[:300] if d not in ('', None) else ''), flush=True)


def sha(p): return hashlib.sha256(P(p).read_bytes()).hexdigest()


def signer(p):
    o = subprocess.run([str(BT / 'apksigner'), 'verify', '--print-certs', str(p)], capture_output=True, text=True, env=JENV).stdout
    m = re.search(r'Signer #1 certificate SHA-256 digest: ([0-9a-f]{64})', o)
    return m.group(1) if m else ''


# ---- fixtures: a wrong-signer copy of NEW (same package + versionCode, different key)
ks = job / 'wrong.jks'; WRONG = job / 'aegis-wrong-signer.apk'
JH = java_home(); JENV = dict(os.environ, JAVA_HOME=JH, PATH=JH + '/bin:' + os.environ['PATH'])
subprocess.run([JH + '/bin/keytool', '-genkeypair', '-keystore', str(ks), '-storepass', 'qaqaqa', '-keypass', 'qaqaqa', '-alias', 'qa',
                '-keyalg', 'RSA', '-keysize', '2048', '-validity', '2', '-dname', 'CN=Wrong Signer QA'], capture_output=True, env=JENV)
r = subprocess.run([str(BT / 'apksigner'), 'sign', '--ks', str(ks), '--ks-pass', 'pass:qaqaqa', '--out', str(WRONG), str(NEW)], capture_output=True, text=True, env=JENV)
if not WRONG.is_file(): sys.exit('could not make the wrong-signer fixture: ' + r.stdout + r.stderr)
FX = {'old': OLD, 'new': NEW, 'wrong': WRONG}
SHA = {k: sha(v) for k, v in FX.items()}
SIG = {k: signer(v) for k, v in FX.items()}
check('fixtures: old/new share the developer key, the wrong-signer copy does not',
      SIG['old'] and SIG['old'] == SIG['new'] and SIG['wrong'] and SIG['wrong'] != SIG['new'], SIG)

# ---- fake Wizard (shell + Android Apps view + its API)
ST = {'queue': [], 'updates': [], 'inventory': [], 'log': [], 'gets': {}, 'serve': {}}


def item(kind, qid=None, sha_=None, sig=None, name='Aegis'):
    vc = 81 if kind == 'old' else 82
    return {'id': qid or uuid.uuid4().hex[:12], 'name': name, 'package': FIX, 'route': 'open', 'source': 'github',
            'versionName': '3.4.2' if vc == 81 else '3.4.3', 'versionCode': vc, 'sha256': sha_ or SHA[kind],
            'signer': SIG['new'] if sig is None else sig, 'bytes': FX[kind].stat().st_size, 'state': 'ready', 'note': 'QA'}


BOOT = {'schema': 1, 'bootstrap': 1, 'capabilities': {'voice': True, 'router': True, 'files': True},
        'endpoints': {'apps': '/wizard/v1/apps', 'sessions': '/wizard/hermes/api/sessions', 'transcribe': '/wizard/voice/transcribe', 'route': '/wizard/v1/route'}}
APPS = {'schema': 1, 'apps': [{'id': 'android-apps', 'name': 'Android Apps', 'url': '/android-apps/', 'icon': '🤖', 'colors': ['#3ddc97', '#8f63ff'],
                               'desc': 'Your Android apps', 'status': 'running', 'source': 'launcher'}]}
CT = {'css': 'text/css', 'html': 'text/html', 'png': 'image/png', 'webmanifest': 'application/manifest+json', 'js': 'application/javascript', 'svg': 'image/svg+xml'}


class Fake(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass

    def _send(self, code, body, ctype='application/json'):
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store'); self.end_headers()
        if self.command != 'HEAD': self.wfile.write(body)

    def _json(self, code, o): self._send(code, json.dumps(o).encode())
    def do_HEAD(self): self.do_GET()

    def _static(self, root, rel):
        f = (root / (rel or 'index.html')).resolve()
        if rel in ('data.js', 'summaries.js'): return self._send(200, b'', 'application/javascript')
        if not str(f).startswith(str(root.resolve())) or not f.is_file(): return self._json(404, {'error': 'nf'})
        return self._send(200, f.read_bytes(), CT.get(f.suffix.lstrip('.'), 'application/octet-stream'))

    def do_GET(self):
        u = self.path.split('?')[0]; ST['log'].append('GET ' + u)
        if u in ('/wizard-os-home', '/android-apps'):
            self.send_response(301); self.send_header('Location', u + '/'); self.send_header('Content-Length', '0'); self.end_headers(); return
        if u.startswith('/wizard-os-home/') and not u.startswith('/wizard-os-home/api/'): return self._static(WEB, u[len('/wizard-os-home/'):])
        if u == '/wizard/v1/bootstrap': return self._json(200, BOOT)
        if u == '/wizard/v1/apps': return self._json(200, APPS)
        if u == '/android-apps/api/queue': return self._json(200, {'items': ST['queue']})
        if u == '/android-apps/api/updates': return self._json(200, {'at': int(time.time()), 'items': ST['updates'], 'errors': {}})
        m = re.match(r'^/android-apps/apk/([0-9a-f]{64})\.apk$', u)
        if m:
            ST['gets'][m.group(1)] = ST['gets'].get(m.group(1), 0) + 1
            f = ST['serve'].get(m.group(1))
            return self._send(200, f.read_bytes(), 'application/vnd.android.package-archive') if f else self._json(404, {'error': 'gone'})
        if u.startswith('/android-apps/') and '/api/' not in u: return self._static(AA, u[len('/android-apps/'):])
        if u == '/wizard/hermes/api/sessions': return self._json(200, {'data': [], 'has_more': False})
        if u == '/wizard/thread-seen': return self._json(200, {'state': {'initializedAt': int(time.time() * 1000), 'threads': {}}})
        return self._json(200, {})

    def do_PUT(self):
        n = int(self.headers.get('Content-Length') or 0); self.rfile.read(n) if n else b''
        return self._json(200, {'state': {}})

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n) if n else b''
        u = self.path.split('?')[0]; ST['log'].append('POST ' + u)
        if u == '/android-apps/api/inventory':
            try: ST['inventory'].append(json.loads(body))
            except ValueError: pass
            return self._json(200, {'ok': True})
        m = re.match(r'^/android-apps/api/queue/([0-9a-f]{12})/done$', u)
        if m:
            ST['queue'] = [x for x in ST['queue'] if x['id'] != m.group(1)]
            return self._json(200, {'ok': True})
        return self._json(200, {})


srv = http.server.ThreadingHTTPServer(('127.0.0.1', FAKE), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()

em = Emu(job, 5712, PKG); pg = None
shot = lambda n: em.shot(OUT, n)


def front_wizard(): em.sx('am start -n %s/ai.wizards.os.MainActivity' % PKG); time.sleep(2.5)


def connect():
    global pg
    try:
        if pg: pg.close()
    except Exception: pass
    pg = Page(em, DEVTOOLS, 'wizard-os-home')
    return pg


FRAME = "[...document.querySelectorAll('iframe.appframe')].find(f => { try { return /^\\/android-apps\\//.test(f.contentWindow.location.pathname); } catch (e) { return false; } })"


def fev(expr):
    """Evaluate in the Android Apps frame (same origin): `d` is its document, `w` its window."""
    return pg.ev("(() => { const f = %s; if (!f) return null; const w = f.contentWindow, d = f.contentDocument; return (%s); })()" % (FRAME, expr))


def ftap(sel):
    """A real touch on an element inside the Android Apps frame."""
    r = pg.ev("(() => { const f = %s; if (!f) return null; const e = f.contentDocument.querySelector(%s); if (!e) return null; e.scrollIntoView({block:'center'});"
              " const a = f.getBoundingClientRect(), b = e.getBoundingClientRect(); return [a.x + b.x + b.width / 2, a.y + b.y + b.height / 2]; })()" % (FRAME, json.dumps(sel)))
    if not r: return False
    pg.touch(*r); return True


def rows(): return fev("[...d.querySelectorAll('#installed .row')].map(e => e.dataset.pkg)") or []
def state(pkg=FIX): return fev("(w.__aaState || null)") if False else None
def logs(pat, n=20): return '\n'.join([l for l in em.sx('logcat -d -s WizardApps:*').splitlines() if re.search(pat, l)][-n:])
def frame_open(): return bool(pg.ev("!!(%s)" % FRAME))


def back_stays(label):
    em.sx('input keyevent KEYCODE_BACK'); time.sleep(1.2)
    ok = em.front()
    check('Back (%s): Wizard OS stays open' % label, ok, em.top())
    return ok


def watch_installer(secs, until):
    """Poll the top activity; returns (seen_installer_ui, result_of_until)."""
    seen = False; t0 = time.time(); v = None
    while time.time() - t0 < secs:
        if em.installer_ui(): seen = True
        v = until()
        if v: break
        time.sleep(0.4)
    return seen, v


from qa_device_packages import connect_origin, owner_switch, run_device, worker_lock

if args.port == 'device':
    sys.exit(run_device(globals()))

with worker_lock(BASE / 'worker.lock'):
    try:
        em.boot()
        out = em.sh(ADB, '-s', em.S, 'install', '-r', QA_APK).strip().splitlines()[-1]
        check('install the candidate QA build', out == 'Success', out)
        em.sx('svc data disable'); time.sleep(2)
        resolv = em.sx(f'ping -c 1 -W 2 {QA_ORIGIN_HOST} 2>&1 | head -2')
        check('the real Wizard is unreachable from the emulator', not re.search(r'\(\d+\.\d+\.\d+\.\d+\)', resolv), resolv.strip()[:120])
        em.sh(ADB, '-s', em.S, 'reverse', 'tcp:%d' % FAKE, 'tcp:%d' % FAKE)
        if args.owner_switch:
            pg = connect_origin(globals(), ORIGIN)
        else:
            em.runas('mkdir -p files && echo %s > files/qa_home.txt && echo %s > files/qa_origin.txt' % (ORIGIN, ORIGIN))
        em.sx('pm grant %s android.permission.POST_NOTIFICATIONS' % PKG)
        man = em.sh(BT / 'aapt2', 'dump', 'xmltree', '--file', 'AndroidManifest.xml', QA_APK)
        check('manifest: no QUERY_ALL_PACKAGES; <queries> for launcher apps; ENFORCE_UPDATE_OWNERSHIP + REQUEST_DELETE_PACKAGES',
              'QUERY_ALL_PACKAGES' not in man and 'E: queries' in man and 'ENFORCE_UPDATE_OWNERSHIP' in man and 'REQUEST_DELETE_PACKAGES' in man)

        # ============ 1: open Android Apps from its single launcher tile ============
        front_wizard(); connect(); time.sleep(3)
        check('Wizard OS loads the shell from the fake Wizard', pg.ev('location.href').startswith(ORIGIN), pg.ev('location.href'))
        check('the shell has the Android Apps port (window.wizardAppsPort)', pg.ev("typeof window.wizardAppsPort === 'object' && !!window.wizardAppsPort"))
        # First-run coach card covers the launcher: a returning user has dismissed it (like qa-launcher-apps).
        pg.ev("(() => { const g = document.querySelector('#coachGo'); if (g && !document.querySelector('#coach').hidden) g.click(); return 1; })()"); time.sleep(0.6)
        pg.ev("__wos.openSheet('launcher')"); time.sleep(1.2)
        tiles = pg.ev("[...document.querySelectorAll('#launcherBody [data-app]')].map(e => e.dataset.app)") or []
        check('launcher: exactly one Android Apps tile, no Android app tiles', tiles.count('android-apps') == 1 and not {'aegis', FIX} & set(tiles), tiles)
        shot('01-launcher-tile')
        pg.tap('#launcherBody [data-app="android-apps"]')
        wait(lambda: frame_open() and fev("d.readyState === 'complete' && !!d.querySelector('#installed')"), 20)
        wait(lambda: fev("!!w && d.querySelector('#empty') && d.querySelector('#empty').textContent !== 'Loading…'") , 15)
        time.sleep(1.5)
        check('the tile opens the Android Apps view (hosted frame at /android-apps/)', frame_open())
        fev("(d.querySelector('#sys').click(), 1)"); time.sleep(0.8)
        sysrows = rows()
        check('System toggle lists the phone’s launchable apps through the bridge', len(sysrows) >= 3 and 'com.android.settings' in sysrows, sysrows[:12])
        fev("(d.querySelector('#sys').click(), 1)"); time.sleep(0.5)
        check('system apps hidden by default', 'com.android.settings' not in rows(), rows())
        check('the view posted the inventory to the server', wait(lambda: any(isinstance(i.get('apps'), list) and len(i['apps']) >= 3 for i in ST['inventory']), 15), len(ST['inventory']))
        shot('02-android-apps-open')

        # ============ 2: first install (Aegis 3.4.2): permission once, then Android's one confirm ============
        ST['serve'][SHA['old']] = OLD
        ST['queue'] = [item('old', qid='a00000000001')]
        fev("(w.dispatchEvent(new Event('visibilitychange')), 1)"); pg.ev("document.dispatchEvent(new Event('visibilitychange'))")
        fev("(d.dispatchEvent(new Event('visibilitychange')), 1)")
        wait(lambda: fev("!!d.querySelector('#ready [data-install]')"), 25)
        check('“Ready to install” shows the queued app with one Install button', fev("d.querySelectorAll('#ready [data-install]').length") == 1,
              fev("d.querySelector('#ready') && d.querySelector('#ready').innerText"))
        shot('03-ready-to-install')
        ftap('#ready [data-install]')
        perm = wait(lambda: 'Settings' in em.top() or 'settings' in em.top().lower(), 10)
        check('without “Install unknown apps”, Install opens Android’s permission screen (no install yet)', perm and em.vcode(FIX) == 0, em.top())
        shot('04-permission-screen')
        em.sx('appops set %s REQUEST_INSTALL_PACKAGES allow' % PKG); time.sleep(0.5)
        em.sx('input keyevent KEYCODE_BACK'); time.sleep(1.5)
        if not em.front(): front_wizard()
        connect(); time.sleep(1)
        check('back from the permission screen lands in Android Apps', em.front() and frame_open(), em.top())
        em.sx('logcat -c')
        ftap('#ready [data-install]')
        dlg = wait(lambda: em.installer_ui(), 30)
        shot('05-android-confirm')
        check('first install: Android shows its one confirm', dlg, em.top())
        tapped = None
        for _ in range(6):
            tapped = em.tap_text(r'^(Install|INSTALL|Update|UPDATE)$')
            if tapped: break
            time.sleep(1)
        ok = wait(lambda: em.vcode(FIX) == 81, 60)
        check('… one tap installs it (Aegis 3.4.2, versionCode 81)', ok and tapped, (tapped, em.vcode(FIX)))
        src = em.source(FIX)
        check('installer of record = Wizard OS', src['installer'] == PKG, src)
        check('update owner = Wizard OS (setRequestUpdateOwnership)', src['updateOwner'] == PKG, src)
        if not em.front(): front_wizard()
        connect(); time.sleep(2)
        wait(lambda: FIX in rows(), 15)
        badge = fev("(d.querySelector('[data-pkg=\"%s\"] .badge') || {}).textContent" % FIX)
        check('the new app shows in Installed with a Wizard badge', FIX in rows() and badge == 'Wizard', (rows(), badge))
        check('the installed app left “Ready to install”', wait(lambda: not ST['queue'] and not fev("d.querySelector('#ready [data-install]')"), 20), ST['queue'])
        check('inventory after install includes it, owned by Wizard OS', wait(lambda: any(a.get('package') == FIX and a.get('installer') == PKG for i in ST['inventory'][-3:] for a in i.get('apps', [])), 15))
        shot('06-installed-wizard-badge')

        # ============ 3: launch from the list ============
        ftap('[data-launch="%s"]' % FIX)
        launched = wait(lambda: FIX + '/' in em.top(), 12)
        check('tapping a row launches the app', launched, em.top())
        shot('07-launched-aegis')
        front_wizard(); connect(); time.sleep(1.5)

        # ============ 4: refusals (hash mismatch, wrong signer) — nothing installs ============
        bad_sha = 'f' * 64
        ST['serve'][bad_sha] = NEW  # the bytes don't hash to what was asked for
        ST['updates'] = [item('new', sha_=bad_sha)]
        fev("(d.dispatchEvent(new Event('visibilitychange')), 1)")
        wait(lambda: fev("!!d.querySelector('[data-update]')"), 20)
        em.sx('logcat -c')
        ftap('[data-update]')
        seen, msg = watch_installer(30, lambda: fev("(d.querySelector('#updates') || {}).innerText || ''").find('checksum') >= 0 and 'checksum')
        txt = fev("(d.querySelector('#updates') || {}).innerText") or ''
        check('hash mismatch: refused with a plain message, no installer UI, still 3.4.2', 'checksum' in txt and not seen and em.vcode(FIX) == 81, (txt[:160], seen, em.vcode(FIX)))
        shot('08-hash-mismatch')

        ST['serve'][SHA['wrong']] = WRONG
        ST['updates'] = [item('new', sha_=SHA['wrong'], sig='')]   # no recorded signer: the installed key must still match
        fev("(d.dispatchEvent(new Event('visibilitychange')), 1)"); time.sleep(2.5)
        ftap('[data-update]')
        seen, _ = watch_installer(30, lambda: 'different key' in (fev("(d.querySelector('#updates') || {}).innerText") or ''))
        txt = fev("(d.querySelector('#updates') || {}).innerText") or ''
        check('wrong signer (vs installed): refused with a plain message, no installer UI', 'different key' in txt and not seen and em.vcode(FIX) == 81, (txt[:160], seen))
        ST['updates'] = [item('new', sha_=SHA['wrong'])]            # recorded signer = developer key
        fev("(d.dispatchEvent(new Event('visibilitychange')), 1)"); time.sleep(2.5)
        ftap('[data-update]')
        seen, _ = watch_installer(30, lambda: 'key Wizard recorded' in (fev("(d.querySelector('#updates') || {}).innerText") or ''))
        txt = fev("(d.querySelector('#updates') || {}).innerText") or ''
        check('wrong signer (vs recorded key): refused, still 3.4.2', 'key Wizard recorded' in txt and not seen and em.vcode(FIX) == 81, (txt[:160], seen))
        shot('09-wrong-signer')
        receipt['refusal_log'] = logs('refused|doesn|isn|different|checksum', 12)

        # ============ 5: silent update by the background job (Wizard in the background, no dialog) ============
        ST['serve'][SHA['new']] = NEW
        ST['updates'] = [item('new')]
        em.sx('input keyevent KEYCODE_HOME'); time.sleep(1.5)
        js = em.sx('dumpsys jobscheduler | grep -A3 "%s/ai.wizards.os.apps.AppsUpdateJob" | head -4' % PKG)
        check('the Android Apps update job is scheduled once the add-on is used', 'AppsUpdateJob' in js, js.strip()[:200])
        em.sx('logcat -c')
        em.sx('cmd jobscheduler run -f %s %d' % (PKG, JOB_ID))
        seen, ok = watch_installer(90, lambda: em.vcode(FIX) == 82)
        lg = logs('session|status|requireUserAction', 8)
        check('silent update: the job installs Aegis 3.4.3 by itself', ok, (em.vcode(FIX), lg[-400:]))
        check('… with no Android dialog (USER_ACTION_NOT_REQUIRED, Wizard owns it)', not seen and 'requireUserAction=2' in lg, lg[-300:])
        src = em.source(FIX)
        check('… and Wizard OS is still installer of record / update owner', src['installer'] == PKG and src['updateOwner'] == PKG, src)
        nt = em.sx('dumpsys notification --noredact | grep -E "android.title=|android.text=" | head -8')
        check('no failure notification after a good update', 'Couldn' not in nt, nt.strip()[:200])
        shot('10-after-silent-update')

        # ============ 6: menu + Back contract + uninstall ============
        front_wizard(); connect(); time.sleep(2)
        if not frame_open():
            pg.ev("__wos.openSheet('launcher')"); time.sleep(1); pg.tap('#launcherBody [data-app="android-apps"]'); time.sleep(3)
        wait(lambda: FIX in rows(), 15)
        ftap('[data-menu="%s"]' % FIX); time.sleep(0.8)
        menu = fev("({open: !d.querySelector('#menu').hidden, txt: d.querySelector('#menu').innerText})") or {}
        check('row menu offers Open in Play / App info / Uninstall', menu.get('open') and all(k in menu.get('txt', '') for k in ('App info', 'Uninstall')), menu)
        shot('11-row-menu')
        back_stays('menu open')
        check('… Back closed the menu, Android Apps still open', frame_open() and fev("d.querySelector('#menu').hidden"))
        ftap('[data-menu="%s"]' % FIX); time.sleep(0.6); ftap('#menu [data-act="appInfo"]')
        info = wait(lambda: 'settings' in em.top().lower(), 8)
        check('App info opens Android’s app details', info, em.top())
        em.sx('input keyevent KEYCODE_BACK'); time.sleep(1.5)
        check('Back from App info returns to Wizard OS', em.front(), em.top())
        connect(); time.sleep(1)
        ftap('[data-menu="%s"]' % FIX); time.sleep(0.6); ftap('#menu [data-act="uninstall"]')
        dlg = wait(lambda: em.installer_ui() or 'uninstall' in em.ui().lower(), 10)
        shot('12-uninstall-confirm')
        tapped = None
        for _ in range(5):
            tapped = em.tap_text(r'^(OK|Uninstall|UNINSTALL)$')
            if tapped: break
            time.sleep(1)
        gone = wait(lambda: em.vcode(FIX) == 0, 30)
        check('Uninstall: Android’s confirm → app removed', dlg and tapped and gone, (tapped, em.vcode(FIX)))
        if not em.front(): front_wizard()
        connect(); time.sleep(2)
        check('the list drops the removed app', wait(lambda: FIX not in rows(), 15), rows())
        check('inventory after uninstall no longer has it', wait(lambda: ST['inventory'] and not any(a.get('package') == FIX for a in ST['inventory'][-1].get('apps', [])), 15))
        shot('13-after-uninstall')
        for i in range(3): back_stays('at Android Apps root #%d' % (i + 1))
        shot('14-after-backs')

        # ============ 7: ?open=android-apps deep link (cold) ============
        pg.ev("location.href = '%s/wizard-os-home/?open=android-apps'" % ORIGIN); time.sleep(5)
        connect(); time.sleep(2)
        check('?open=android-apps opens Android Apps', wait(frame_open, 15), pg.ev('location.href'))
        shot('15-deeplink-open')

        if args.owner_switch:
            pg = owner_switch(globals(), pg)
        crashed = em.sx('logcat -d -b crash')
        check('no crashes', 'FATAL EXCEPTION' not in crashed, crashed[:300])
        receipt['wizard_apps_log'] = em.sx('logcat -d -s WizardApps:*')[-6000:]
    except Exception as e:
        check('QA ran to the end', False, repr(e))
        try: shot('zz-error')
        except Exception: pass
    finally:
        try:
            if pg: pg.close()
        except Exception: pass
        (job / 'logcat.txt').write_text(em.sx('logcat -d'))
        em.kill()
        srv.shutdown()
        receipt.update(passed=sum(res), total=len(res), apk=str(QA_APK), apk_sha256=sha(QA_APK), gets=ST['gets'],
                       real_wizard_requests=[l for l in ST['log'] if 'wizard001' in l], mode='legacy',
                       screenshots=sorted(str(p) for p in OUT.glob('*.png')))
        (job / 'receipt.json').write_text(json.dumps(receipt, indent=1, default=str))
print('%d/%d passed · %s' % (sum(res), len(res), job))
if args.owner_switch: sys.exit(0 if all(res) else 1)
