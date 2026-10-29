#!/usr/bin/env python3
"""Thales API35 real ShortcutManager refresh acceptance, controlled shell fixture.

usage: qa_home_screen_refresh.py QA_BUILD_RECEIPT WEB_DIR OUT_DIR
The trusted /wizard-os-home/ test document loads the exact production sigil, policy and
home-screen-apps assets. Only app registry metadata and surrounding shell are fixtures.
Pin and OS confirmation use real native taps; reload/resume refresh never invokes the
bridge from the test. No production server, account or physical phone is touched.
"""
import fcntl, hashlib, http.server, json, os, pathlib, re, sys, threading, time
import xml.etree.ElementTree as ET
from urllib.parse import unquote, urlsplit
if sys.platform != 'darwin':
    raise SystemExit('Thales-only emulator QA')
from qa_aa_lib import Emu, Page, wait, ADB, BASE
P = pathlib.Path
build = json.loads(P(sys.argv[1]).read_text()); web = P(sys.argv[2]).resolve(); out = P(sys.argv[3]); out.mkdir(parents=True, exist_ok=True)
if build.get('status') != 'ok': raise SystemExit('QA build failed')
artifact = next(a for a in build['artifacts'] if a.get('aapt2', {}).get('package') == 'ai.wizards.os.qa' and a['path'].endswith('/debug/app-debug.apk'))
apk = P(build['job']) / 'source' / artifact['path']
if hashlib.sha256(apk.read_bytes()).hexdigest() != artifact['sha256']: raise SystemExit('QA APK hash mismatch')
state = {'id':'shortcut-qa','kind':'wizard','url':'/shortcut-qa/','name':'Shortcut QA','icon':'wisdom','colors':['#00aaff']}
checks = []; failure = None; page = None
assets = ['core/home-screen-policy.js','core/home-screen-apps.js','core/sigils.js','core/sigils.css','core/home-screen-apps.css']
asset_bytes = {p:(web / p).read_bytes() for p in assets}  # served from memory: request paths never reach the filesystem
asset_hashes = {p:hashlib.sha256(b).hexdigest() for p,b in asset_bytes.items()}
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        path = unquote(urlsplit(self.path).path); code = 200; mime = 'application/json'; body = b'{}'
        if path == '/wizard-os-home/':
            # Explicit test registry, real production iconPNG/bridge lifecycle modules and CSS.
            record = json.dumps(state)
            body = ('''<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shortcut refresh QA</title>
<link rel="stylesheet" href="core/sigils.css"><link rel="stylesheet" href="core/home-screen-apps.css">
<style>body{background:#110d1b;color:white;font:20px sans-serif;padding:24px}button{font:inherit;padding:24px} .home-pin-sheet{background:#222;color:white}</style>
<button id="offer">Pin test app</button>
<script>const app=RECORD;window.WizCore={appsLoaded:()=>Promise.resolve(),apps:()=>({APP:{[app.id]:app}})};</script>
<script src="core/sigils.js"></script><script src="core/home-screen-policy.js"></script><script src="core/home-screen-apps.js"></script>
<script>document.querySelector('#offer').onclick=()=>WizHomeScreenApps.offer(app);</script>'''.replace('RECORD',record)).encode(); mime = 'text/html'
        elif path.startswith('/wizard-os-home/') and path[len('/wizard-os-home/'):] in assets:
            f = path[len('/wizard-os-home/'):]; body = asset_bytes[f]; mime = 'text/css' if f.endswith('.css') else 'application/javascript'
        elif path == '/wizard-os-home/core/service-worker.js' or path.endswith('/sw.js'): code = 404
        self.send_response(code); self.send_header('Content-Type',mime); self.send_header('Content-Length',str(len(body))); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        self.send_response(405); self.send_header('Content-Length','0'); self.end_headers()
server = http.server.ThreadingHTTPServer(('127.0.0.1',0), Handler)
port = server.server_address[1]; origin = 'http://localhost:' + str(port)
threading.Thread(target=server.serve_forever, daemon=True).start()
emu = Emu(out, 5688, 'ai.wizards.os.qa')
identity = 'homeapp-' + hashlib.sha256((origin + '\nshortcut-qa').encode()).hexdigest()
def check(name, ok, detail=''):
    checks.append({'name':name,'ok':bool(ok),'detail':str(detail)[:600]}); print(('PASS ' if ok else 'FAIL ') + name + ' ' + str(detail)[:200], flush=True)
    return bool(ok)
def launch(): emu.sx('am start -W -n ai.wizards.os.qa/ai.wizards.os.MainActivity')
def connect():
    p = Page(emu, 9388); wait(lambda:p.ev('!!window.WizHomeScreenApps && !!window.wizardHomeScreenPort'), 25); return p
def tap(selector):
    xy = page.ev("(() => { const e=document.querySelector(%s);if(!e)return null;const b=e.getBoundingClientRect();return [Math.round((b.x+b.width/2)*devicePixelRatio),Math.round((b.y+b.height/2)*devicePixelRatio)];})()" % json.dumps(selector))
    if not xy: raise RuntimeError('missing tap target '+selector)
    emu.sx('input tap %d %d' % tuple(xy))
def prefs():
    raw = emu.runas('cat shared_prefs/home-screen-pins.xml')
    try: return {e.attrib['name']:e.text or '' for e in ET.fromstring(raw)}
    except ET.ParseError: return {}
def snapshot(name):
    raw = emu.sx('dumpsys shortcut'); (out / (name + '.txt')).write_text(raw)
    data = prefs(); result = {'name':data.get(identity+':name'),'icon_sha256':hashlib.sha256(data.get(identity+':icon','').encode()).hexdigest()}
    # API35 userdebug emulator is rooted before installing. Hash actual launcher's persisted bitmap, not just prefs.
    paths = re.findall(r'(?:bitmapPath=|path=)([^\s,}\]]+)',raw)
    paths = [p for p in paths if 'ai.wizards.os.qa' in p and p.endswith('.png')]
    result['bitmaps'] = {p:emu.sx('sha256sum ' + p).strip() for p in paths}
    result['updates'] = emu.sx('logcat -d -s WizardHomeShortcuts:I *:S').count('updated ' + identity)
    (out / (name + '.json')).write_text(json.dumps(result,indent=2)); return result
inherited = os.environ.get('WIZARD_HEAVY_LOCK_FD')
lock = os.fdopen(int(inherited),'a',closefd=False) if inherited else (BASE / 'worker.lock').open('a')
with lock:
    if inherited:
        want,have = (BASE / 'worker.lock').stat(),os.fstat(lock.fileno())
        if (want.st_dev,want.st_ino) != (have.st_dev,have.st_ino): raise SystemExit('wrong inherited lease')
    fcntl.flock(lock,fcntl.LOCK_EX | (fcntl.LOCK_NB if inherited else 0))
    try:
        emu.boot(); emu.sh(ADB,'-s',emu.S,'root'); emu.sh(ADB,'-s',emu.S,'wait-for-device')
        check('exact coinstallable QA APK installs','Success' in emu.sh(ADB,'-s',emu.S,'install',str(apk)))
        emu.sh(ADB,'-s',emu.S,'reverse','tcp:'+str(port),'tcp:'+str(port))
        # Existing debug-only origin fixture, never baked into the release APK.
        emu.runas('mkdir -p files'); emu.runas('printf '+origin+' > files/qa_home.txt'); emu.runas('printf '+origin+' > files/qa_origin.txt')
        emu.sx('logcat -c'); launch(); page = connect()
        check('trusted native bridge loaded with production web module',page.ev('!!window.wizardHomeScreenPort && !!window.WizHomeScreenApps'))
        check('fresh shell does not create a pin',identity not in emu.sx('dumpsys shortcut'))
        tap('#offer'); wait(lambda:page.ev('!!document.querySelector(".home-pin-sheet button") && !document.querySelector(".home-pin-sheet button").disabled'),10)
        tap('.home-pin-sheet button'); time.sleep(1)
        check('real Android pin confirmation accepted',bool(emu.tap_text(r'^(Add|Add automatically|Add to home screen|ADD)$')))
        # The pending token is removed once Android confirms the pin; the stored icon/name stay.
        if not wait(lambda:(identity+':icon') in prefs(),20): raise RuntimeError('pin preferences missing')
        wait(lambda:identity in emu.sx('dumpsys shortcut'),20); time.sleep(2)
        before = snapshot('01-pinned'); check('actual package-owned pinned shortcut exists',identity in (out/'01-pinned.txt').read_text() and before['name']=='Shortcut QA')
        emu.sx('input keyevent KEYCODE_HOME'); time.sleep(1); emu.shot(out,'01-launcher-before'); launch(); time.sleep(2)
        # Change metadata in the served test document, then recreate the document. No refresh RPC from the harness.
        state['colors'] = ['#ff0066']; state['name'] = 'Shortcut changed'
        page.call('Page.reload',ignoreCache=True)
        wait(lambda:prefs().get(identity+':name')=='Shortcut changed',25); time.sleep(2)
        after = snapshot('02-after-shell-load')
        check('shell load automatically updates icon and name',after['name']=='Shortcut changed' and before['icon_sha256']!=after['icon_sha256'])
        check('ShortcutManager updateShortcuts succeeded',after['updates']>before['updates'],after)
        bitmap_changed = bool(before['bitmaps'] and after['bitmaps']) and {v.split()[0] for v in before['bitmaps'].values()} != {v.split()[0] for v in after['bitmaps'].values()}
        check('dumpsys bitmap state proves actual icon file changed',bitmap_changed,{'before':before['bitmaps'],'after':after['bitmaps']})
        emu.sx('input keyevent KEYCODE_HOME'); time.sleep(2); emu.shot(out,'02-launcher-after'); launch(); time.sleep(2)
        unchanged = snapshot('03-unchanged-resume'); check('unchanged resume does not call updateShortcuts again',unchanged['updates']==after['updates'])
        # Metadata mutation is a test hook into the fixture registry only. Native Activity resume drives refresh.
        page.ev("app.sigil={icon:'calendar',colors:['#22dd66']};app.name='Shortcut resumed';true")
        emu.sx('input keyevent KEYCODE_HOME'); time.sleep(1); launch()
        wait(lambda:prefs().get(identity+':name')=='Shortcut resumed',25); time.sleep(1)
        resumed = snapshot('04-after-native-resume')
        check('native resume automatically refreshes without a tap',resumed['name']=='Shortcut resumed' and resumed['icon_sha256']!=after['icon_sha256'] and resumed['updates']>after['updates'])
        # Same real pin gesture on an existing pin must update rather than request a second OS pin.
        page.ev("WizHomeScreenApps.back();app.name='Shortcut readded';app.sigil={icon:'wisdom',colors:['#8855ff']};WizHomeScreenApps.offer(app);true")
        wait(lambda:page.ev('document.querySelector(".home-pin-sheet button")?.textContent === "Already on home screen"'),10)
        # Existing UI disables a redundant Add. Enable only the UI button in this QA fixture to exercise pin's
        # already-pinned native branch with genuine transient activation; product trust gates remain intact.
        page.ev("document.querySelector('.home-pin-sheet button').disabled=false;true"); tap('.home-pin-sheet button')
        wait(lambda:prefs().get(identity+':name')=='Shortcut readded',20)
        readded = snapshot('05-readded'); check('re-adding existing pin refreshes name/icon without a new confirmation',readded['name']=='Shortcut readded' and readded['icon_sha256']!=resumed['icon_sha256'] and emu.front())
        crashed = emu.sx('logcat -d -b crash'); (out/'crash.txt').write_text(crashed); check('no native crash','FATAL EXCEPTION' not in crashed)
    except Exception as error:
        failure = repr(error); print('ERROR '+failure,flush=True)
        try: emu.shot(out,'failure')
        except Exception: pass
    finally:
        if page: page.close()
        emu.kill(); server.shutdown()
        result = {'source_revision':build.get('source_revision'),'apk_sha256':artifact['sha256'],'fixture':'controlled trusted shell + exact production web assets; actual native pin/updateShortcuts','asset_hashes':asset_hashes,'checks':checks,'passed':sum(c['ok'] for c in checks),'total':len(checks),'failure':failure,'ok':not failure and bool(checks) and all(c['ok'] for c in checks)}
        (out/'receipt.json').write_text(json.dumps(result,indent=2)); print(json.dumps(result,indent=2),flush=True)
sys.exit(0 if result['ok'] else 1)
