#!/usr/bin/env python3
"""Thales API35 diagnosis: why a native long-press on an Apps row does not open the Add to home screen sheet.
Debug (inspectable) APK against the live Wizard, read-only. Logs pointer/contextmenu/scroll events over CDP
during a real `input swipe` hold, then repeats the hold with a CDP touch for comparison.
Usage on Thales: QA_OUT=/Volumes/ThalesMedia/... python3 tools/qa_home_screen_diag.py <AndroidBuilds/jobs/JOB/receipt.json>
"""
import json, os, pathlib, re, socket, sys, time
import xml.etree.ElementTree as E
P = pathlib.Path
if sys.platform != 'darwin' or 'thales' not in socket.gethostname().lower():
    raise SystemExit('Thales-only emulator QA')
sys.path.insert(0, str(P(__file__).resolve().parent))
from qa_aa_lib import Emu, Page, wait, BASE, ADB

PKG = 'ai.wizards.os.qa'
build = json.loads(P(sys.argv[1]).read_text())
a = next(x for x in build['artifacts'] if x.get('aapt2', {}).get('package') == PKG)
apk = P(build['job']) / 'source' / a['path']
out = P(os.environ['QA_OUT']); out.mkdir(parents=True, exist_ok=True)
emu = Emu(out, 5600, PKG, dns=os.environ.get('QA_DNS', '100.100.100.100'))
emu.env['JAVA_HOME'] = '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home'
emu.env['PATH'] = emu.env['JAVA_HOME'] + '/bin:' + emu.env['PATH']
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
            v = list(map(int, re.findall(r'-?\d+', node.get('bounds', ''))))
            if len(v) == 4 and v[2] > v[0] and v[3] > v[1]: return ((v[0] + v[2]) // 2, (v[1] + v[3]) // 2)
    return None
R = {}
LOGGER = """(() => { window.__hl = []; const t0 = performance.now(); const L = (e) => window.__hl.push([Math.round(performance.now()-t0), e.type, e.pointerType||'', e.isTrusted, e.isPrimary, e.button, (e.target&&e.target.closest&&e.target.closest('[data-app]')||{}).dataset?.app||'', e.defaultPrevented]);
 for (const t of ['pointerdown','pointermove','pointerup','pointercancel','contextmenu','touchstart','touchcancel','touchend','click','visibilitychange']) document.addEventListener(t, L, true);
 document.querySelector('#launcher').addEventListener('scroll', e => window.__hl.push([Math.round(performance.now()-t0),'scroll',e.target.id||e.target.className]), true);
 return { port: !!window.wizardHomeScreenPort, apps: !!window.WizHomeScreenApps, policy: !!window.WizHomeScreenPolicy, open: document.querySelector('#launcher').classList.contains('open'),
   row: (() => { const r = document.querySelector('#launcherBody [data-app="wisdom"]'); if (!r) return null; const b = r.getBoundingClientRect(); return [r.className, b.x, b.y, b.width, b.height, devicePixelRatio]; })() }; })()"""
try:
    emu.boot()
    R['install'] = emu.sh(ADB, '-s', emu.S, 'install', '-r', str(apk)).strip()[-40:]
    emu.sx('am start -W -n %s/ai.wizards.os.MainActivity -a android.intent.action.MAIN -c android.intent.category.LAUNCHER' % PKG)
    for _ in range(12):
        xml = emu.ui(); ls = labels(xml)
        if any(s.startswith('Wizard orb.') for s in ls) and not any(s in ('Skip', 'Got it') for s in ls): break
        if not emu.tap_text(r'^(Skip|Got it|GOT IT|OK)$', xml): time.sleep(3)
        else: time.sleep(1.2)
    xml = wait(lambda: (lambda x: x if any(s.startswith('Wizard orb.') for s in labels(x)) else None)(emu.ui()), 60) or emu.ui()
    orb = bounds(xml, next(s for s in labels(xml) if s.startswith('Wizard orb.')))
    page = Page(emu, 9333)
    R['before'] = page.ev("({port: !!window.wizardHomeScreenPort, apps: !!window.WizHomeScreenApps, href: location.href})")
    page.ev("__wos.openSheet('launcher')"); time.sleep(0.8)
    page.ev("(() => { const s = document.querySelector('#search'); s.value = 'wisdom'; s.dispatchEvent(new Event('input', {bubbles:true})); s.blur(); return 1; })()"); time.sleep(2)
    R['setup'] = page.ev(LOGGER)
    emu.shot(out, 'diag-01')
    row = bounds(emu.ui(), 'Wisdom', app_row=True); R['row_native'] = row
    emu.sx('input swipe %d %d %d %d 900' % (row[0], row[1], row[0], row[1])); time.sleep(0.8)
    emu.shot(out, 'diag-02-after-native-hold')
    R['native_hold'] = page.ev("({log: window.__hl, state: window.WizHomeScreenApps?.state, sheet: document.querySelector('.home-pin-sheet')?.innerText || null})")
    page.ev("(() => { document.querySelector('.home-pin-backdrop')?.remove(); window.WizHomeScreenApps?.back(); window.__hl.length = 0; return 1; })()"); time.sleep(0.5)
    rr = page.ev("(() => { const b = document.querySelector('#launcherBody [data-app=\"wisdom\"]').getBoundingClientRect(); return [b.x + b.width/2, b.y + b.height/2]; })()")
    page.call('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{'x': rr[0], 'y': rr[1]}]); time.sleep(0.9)
    page.call('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[]); time.sleep(0.6)
    R['cdp_hold'] = page.ev("({log: window.__hl, state: window.WizHomeScreenApps?.state, sheet: document.querySelector('.home-pin-sheet')?.innerText || null})")
    emu.shot(out, 'diag-03-after-cdp-hold')
    page.close()
except Exception as e:
    R['error'] = repr(e)
finally:
    try: emu.kill()
    except Exception: pass
    (out / 'diag.json').write_text(json.dumps(R, indent=1))
    print(json.dumps(R, indent=1)[:6000], flush=True)
