#!/usr/bin/env python3
"""Thales API35 smoke for the PRODUCTION signed Wizard OS APK: pin one app from the real Apps menu,
open it from the Android launcher shortcut, prove Back never exits, and prove the pinned app is its own task.
Read-only on the live Wizard: opens Wisdom's home view only (no chapter, no page turns, no writes).
Usage on Thales: QA_OUT=/Volumes/ThalesMedia/... python3 tools/qa_home_screen_live_smoke.py <AndroidBuilds/jobs/JOB/receipt.json>
Optional QA_DNS (default 100.100.100.100, Tailscale MagicDNS so the emulator resolves the tailnet origin).
"""
import hashlib, json, os, pathlib, re, socket, sys, time
import xml.etree.ElementTree as E
P = pathlib.Path
if sys.platform != 'darwin' or 'thales' not in socket.gethostname().lower():
    raise SystemExit('Thales-only emulator QA')
sys.path.insert(0, str(P(__file__).resolve().parent))
from qa_aa_lib import Emu, wait, BASE, ADB

PKG = 'ai.wizards.os'
SIGNER = '3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd'
receipt_path = P(sys.argv[1]).resolve()
if not receipt_path.is_relative_to(BASE) or receipt_path.name != 'receipt.json':
    raise SystemExit('Require canonical remote build receipt under AndroidBuilds')
build = json.loads(receipt_path.read_text())
if build.get('status') != 'ok' or build.get('host') != 'thales':
    raise SystemExit('Build receipt is not successful Thales output')
arts = [a for a in build['artifacts'] if a.get('aapt2', {}).get('package') == PKG]
if len(arts) != 1:
    raise SystemExit('Exactly one production Wizard OS artifact required')
a = arts[0]
if a['signer_sha256'] != SIGNER:
    raise SystemExit('Wrong Wizard OS signer')
apk = P(build['job']) / 'source' / a['path']
if hashlib.sha256(apk.read_bytes()).hexdigest() != a['sha256']:
    raise SystemExit('Exact artifact SHA mismatch')

checks = []
def check(name, cond, detail=None):
    checks.append({'name': name, 'pass': bool(cond), 'detail': detail})
    print(('PASS ' if cond else 'FAIL ') + name, '' if detail is None else str(detail)[:300], flush=True)
    return bool(cond)

def labels(xml):
    try: return [n.get('text') or n.get('content-desc') or '' for n in E.fromstring(xml).iter('node')]
    except Exception: return []

def bounds(xml, label, app_row=False):
    try: nodes = list(E.fromstring(xml).iter('node'))
    except Exception: return None
    for node in nodes:
        text = node.get('text') or node.get('content-desc') or ''
        exact = text.strip().lower() == label.lower()
        row = app_row and node.get('class', '').endswith('Button') and (exact or (text.startswith(label + ' ') and '(test)' not in text))
        if (not app_row and exact) or row:
            v = re.findall(r'-?\d+', node.get('bounds', ''))
            if len(v) == 4:
                x1, y1, x2, y2 = map(int, v)
                if x2 > x1 and y2 > y1: return ((x1 + x2) // 2, (y1 + y2) // 2)
    return None

def edit_text(xml):
    try: nodes = list(E.fromstring(xml).iter('node'))
    except Exception: return None
    for n in nodes:
        if n.get('class', '').endswith('EditText'):
            v = list(map(int, re.findall(r'-?\d+', n.get('bounds', ''))))
            if len(v) == 4 and v[2] > v[0] and v[3] > v[1]: return ((v[0] + v[2]) // 2, (v[1] + v[3]) // 2), n.get('text', '')
    return None

def homeapp_tasks(raw):
    blocks = re.split(r'(?=\s*\* Recent #\d+:)', raw)
    return sorted(set(int(m.group(1)) for b in blocks if '.AppSessionActivity' in b
                      for m in [re.match(r'\s*\* Recent #\d+: Task\{\S+ #([0-9]+) type=standard A=\d+:ai\.wizards\.os\.homeapp\b', b)] if m))

def wisdom_content(xml):
    t = ' '.join(labels(xml))
    return bool(re.search(r'Currently reading|Suggested|Browse all|Request a new collection|Wisdom', t))

out = P(os.environ['QA_OUT']); out.mkdir(parents=True, exist_ok=True)
emu = Emu(out, 5598, PKG, dns=os.environ.get('QA_DNS', '100.100.100.100'))
emu.env['JAVA_HOME'] = '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home'
emu.env['PATH'] = emu.env['JAVA_HOME'] + '/bin:' + emu.env['PATH']
def cap(name):
    try:
        emu.shot(out, name); (out / (name + '.xml')).write_text(emu.ui())
    except Exception as e: print('capture failed', name, e)

failure = None
try:
    emu.boot()
    check('isolated API35 emulator', emu.sx('getprop ro.build.version.sdk').strip() == '35')
    inst = emu.sh(ADB, '-s', emu.S, 'install', '-r', str(apk))
    check('exact signed production APK installs', 'Success' in inst, inst)
    check('installed version matches build', str(a['aapt2'].get('version_code')) in emu.sx('dumpsys package %s | grep versionCode' % PKG), a['aapt2'].get('version_code'))
    # No on-screen keyboard: typed search text arrives as key events. With an IME, the WebView relayouts when it
    # closes and its accessibility tree keeps the keyboard-state bounds (r6 screenshot: row at y~1850, tree 1027).
    for ime in emu.sx('ime list -s').split():
        emu.sx('ime disable ' + ime)
    emu.sx('am start -W -n %s/.MainActivity -a android.intent.action.MAIN -c android.intent.category.LAUNCHER' % PKG)
    check('ordinary launch opens MainActivity', wait(lambda: '.MainActivity' in emu.top(), 30), emu.top())
    # Fresh install: get past Android immersive education and the first-run practice tour (Skip).
    for _ in range(12):
        xml = emu.ui(); ls = labels(xml)
        if any(s.startswith('Wizard orb.') for s in ls) and not any(s in ('Skip', 'Got it') for s in ls): break
        if not emu.tap_text(r'^(Skip|Got it|GOT IT|OK)$', xml): time.sleep(3)
        else: time.sleep(1.2)
    cap('01-ordinary-launch')
    xml = wait(lambda: (lambda x: x if any(s.startswith('Wizard orb.') for s in labels(x)) else None)(emu.ui()), 60) or emu.ui()
    orb_label = next((s for s in labels(xml) if s.startswith('Wizard orb.')), None)
    orb = bounds(xml, orb_label) if orb_label else None
    if not check('live Wizard shell loaded (orb visible)', orb is not None, orb_label):
        raise AssertionError('shell did not load; live origin unreachable from emulator?')
    x, y = orb
    emu.sx('input swipe %d %d %d %d 450' % (x, y, x, max(400, y - 700))); time.sleep(1.2)
    found = wait(lambda: edit_text(emu.ui()), 8)
    if not found:
        emu.sx('input swipe %d %d %d %d 450' % (x, y, x, max(400, y - 700))); found = wait(lambda: edit_text(emu.ui()), 8)
    check('Apps menu opens from the orb swipe', found is not None)
    (sx, sy), old = found
    emu.sx('input tap %d %d' % (sx, sy)); emu.sx('input keyevent KEYCODE_MOVE_END')
    if old: emu.sx('input keyevent ' + ' '.join(['KEYCODE_DEL'] * len(old)))
    emu.sx('input text wisdom'); time.sleep(1.5)
    # The results sheet re-lays out after the keyboard closes (more groups appear above the app row):
    # wait until the Wisdom app row reports the same position twice in a row before pressing it.
    # Wait for the keyboard to be fully gone: while the IME window animates out, the accessibility tree and
    # screenshots still show the keyboard-state layout, and the row then jumps ~800px once the WebView re-expands.
    ime_gone = wait(lambda: 'mInputShown=false' in emu.sx('dumpsys input_method').replace(' ', ''), 15)
    check('keyboard dismissed before measuring the Apps row', ime_gone)
    time.sleep(2)
    row, prev = None, None
    for _ in range(12):
        time.sleep(1.2); row = bounds(emu.ui(), 'Wisdom', app_row=True)
        if row and row == prev: break
        prev = row
    cap('02-apps-search')
    check('Wisdom row in the real Apps menu (stable position)', row is not None and row == prev, (row, prev))
    emu.sx('input swipe %d %d %d %d 650' % (row[0], row[1], row[0], row[1])); time.sleep(0.6)
    cap('03-long-press-sheet')
    sheet = ' '.join(labels(emu.ui()))
    check('long-press shows the Wisdom home-screen sheet', 'Wisdom home screen' in sheet, sheet[-400:])
    check('Add to home screen tapped', bool(emu.tap_text(r'^Add to home screen$')))
    time.sleep(1.2); cap('04-os-confirm')
    check('Android launcher confirmation shown', not emu.front(), emu.top())
    confirmed = emu.tap_text(r'^(Add|Add automatically|Add to home screen|ADD)$')
    check('OS confirmation accepted', bool(confirmed), confirmed)
    time.sleep(1.5); cap('05-after-confirm')
    sc = emu.sx('dumpsys shortcut'); (out / 'shortcuts.txt').write_text(sc)
    check('pinned shortcut exists for Wisdom', 'homeapp-' in sc and 'Wisdom' in sc)
    check('sheet reports Added to home screen (or closed)', 'Couldn' not in ' '.join(labels(emu.ui())))
    emu.sx('input keyevent KEYCODE_HOME'); time.sleep(1.5)
    icon = None
    for _ in range(4):
        icon = bounds(emu.ui(), 'Wisdom')
        if icon: break
        emu.sx('input swipe 900 1100 150 1100 250'); time.sleep(1)
    cap('06-launcher-home')
    if not check('Wisdom icon on the Android home screen', icon is not None, icon):
        raise AssertionError('no pinned Wisdom icon on the launcher')
    emu.sx('input tap %d %d' % icon)
    check('shortcut opens the app-only task (AppSessionActivity)', wait(lambda: '.AppSessionActivity' in emu.top(), 30), emu.top())
    time.sleep(6); xml = emu.ui(); cap('07-pinned-wisdom')
    check('pinned task shows Wisdom content', wisdom_content(xml), ' '.join(labels(xml))[:300])
    check('pinned task has no Wizard orb/dock chrome', not any(s.startswith('Wizard orb.') for s in labels(xml)))
    emu.sx('input keyevent KEYCODE_BACK'); time.sleep(1.2); emu.sx('input keyevent KEYCODE_BACK'); time.sleep(1.2)
    cap('08-after-back-at-root')
    check('Back at the app root keeps the pinned app open', '.AppSessionActivity' in emu.top(), emu.top())
    first = homeapp_tasks(emu.sx('dumpsys activity recents'))
    check('exactly one pinned Wisdom task', len(first) == 1, first)
    emu.sx('input keyevent KEYCODE_HOME'); time.sleep(1)
    icon = bounds(emu.ui(), 'Wisdom') or icon
    emu.sx('input tap %d %d' % icon); time.sleep(2)
    check('re-tap reuses the same pinned task', homeapp_tasks(emu.sx('dumpsys activity recents')) == first)
    emu.sx('am start -W -n %s/.MainActivity -a android.intent.action.MAIN -c android.intent.category.LAUNCHER' % PKG); time.sleep(3)
    xml = emu.ui(); cap('09-ordinary-again')
    check('ordinary Wizard still opens its own shell', '.MainActivity' in emu.top() and any(s.startswith('Wizard orb.') for s in labels(xml)), emu.top())
    recents = emu.sx('dumpsys activity recents'); (out / 'recents.txt').write_text(recents)
    check('pinned app and Wizard are separate Recents tasks', len(homeapp_tasks(recents)) == 1 and '.MainActivity' in recents)
except Exception as e:
    failure = repr(e); print('ERROR', failure, flush=True); cap('failure')
    try: (out / 'failure-logcat.txt').write_text(emu.sx('logcat -d -v threadtime'))
    except Exception: pass
finally:
    try: emu.kill()
    except Exception: pass
    passed = sum(c['pass'] for c in checks)
    res = {'host': socket.gethostname(), 'source_revision': build.get('source_revision'), 'apk_sha256': a['sha256'],
           'version': a['aapt2'], 'checks': checks, 'failure': failure, 'passed': passed, 'total': len(checks),
           'scope': 'production signed APK, real launcher + live Wizard (read-only Wisdom home)'}
    (out / 'receipt.json').write_text(json.dumps(res, indent=1))
    print('RESULT %d/%d%s' % (passed, len(checks), (' failure=' + failure) if failure else ''), flush=True)
    sys.exit(0 if failure is None and passed == len(checks) else 1)
