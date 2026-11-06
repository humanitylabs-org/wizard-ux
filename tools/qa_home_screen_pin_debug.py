#!/usr/bin/env python3
"""Thales API35 pin acceptance with the inspectable debug build of the same source (ai.wizards.os.qa).
Real native input throughout (adb `input swipe/tap`, OS confirmation, launcher icon); CDP is used ONLY to read where
the Wisdom row and the Add button really are, because the WebView accessibility tree reports stale bounds after the
launcher re-lays out (release smoke r5-r7: tree said y=1027 or 205, screenshot showed y~1850).
Read-only on the live Wizard: opens Wisdom's home view only.
Usage on Thales: QA_OUT=$WIZARD_WORK_ROOT/... python3 tools/qa_home_screen_pin_debug.py <AndroidBuilds/jobs/JOB/receipt.json>
"""
import json, os, pathlib, re, socket, sys, time
import xml.etree.ElementTree as E
from qa_paths import java_home
P = pathlib.Path
if sys.platform != 'darwin' or not os.environ.get('WIZARD_WORK_ROOT'):
    raise SystemExit('Thales-only emulator QA')
sys.path.insert(0, str(P(__file__).resolve().parent))
from qa_aa_lib import Emu, Page, wait, ADB

PKG = 'ai.wizards.os.qa'
build = json.loads(P(sys.argv[1]).read_text())
if build.get('status') != 'ok' or build.get('host') != os.environ.get('WIZARD_BUILD_HOST', socket.gethostname()): raise SystemExit('bad receipt')
a = next(x for x in build['artifacts'] if x.get('aapt2', {}).get('package') == PKG)
apk = P(build['job']) / 'source' / a['path']
out = P(os.environ['QA_OUT']); out.mkdir(parents=True, exist_ok=True)
emu = Emu(out, 5602, PKG, dns=os.environ.get('QA_DNS', '100.100.100.100'))
emu.env['JAVA_HOME'] = java_home()
emu.env['PATH'] = emu.env['JAVA_HOME'] + '/bin:' + emu.env['PATH']
checks = []
def check(name, cond, detail=None):
    checks.append({'name': name, 'pass': bool(cond), 'detail': detail})
    print(('PASS ' if cond else 'FAIL ') + name, '' if detail is None else str(detail)[:300], flush=True); return bool(cond)
def labels(xml):
    try: return [n.get('text') or n.get('content-desc') or '' for n in E.fromstring(xml).iter('node')]
    except Exception: return []
def bounds(xml, label):
    try: nodes = list(E.fromstring(xml).iter('node'))
    except Exception: return None
    for n in nodes:
        if (n.get('text') or n.get('content-desc') or '').strip().lower() == label.lower():
            v = list(map(int, re.findall(r'-?\d+', n.get('bounds', ''))))
            if len(v) == 4 and v[2] > v[0] and v[3] > v[1]: return ((v[0] + v[2]) // 2, (v[1] + v[3]) // 2)
    return None
def homeapp_tasks(raw):
    blocks = re.split(r'(?=\s*\* Recent #\d+:)', raw)
    return sorted(set(int(m.group(1)) for b in blocks if '.AppSessionActivity' in b
                      for m in [re.match(r'\s*\* Recent #\d+: Task\{\S+ #([0-9]+) type=standard A=\d+:ai\.wizards\.os\.qa\.homeapp\b', b)] if m))
def cap(name):
    try: emu.shot(out, name); (out / (name + '.xml')).write_text(emu.ui())
    except Exception as e: print('capture failed', name, e)
LOG = """(() => { window.__hl = []; const t0 = performance.now(); for (const t of ['pointerdown','pointercancel','contextmenu','pointerup']) document.addEventListener(t, e => window.__hl.push([Math.round(performance.now()-t0), e.type, (e.target.closest && e.target.closest('[data-app]') || {}).dataset?.app || e.target.className || e.target.tagName]), true); return 1; })()"""
def phys(page, sel):
    return page.ev("(() => { const e = document.querySelector(%s); if (!e) return null; const b = e.getBoundingClientRect(); const d = devicePixelRatio; return [Math.round((b.x + b.width/2)*d), Math.round((b.y + b.height/2)*d), Math.round(innerHeight*d)]; })()" % json.dumps(sel))
failure = None
try:
    emu.boot()
    for ime in emu.sx('ime list -s').split(): emu.sx('ime disable ' + ime)
    # Samsung-style three-button navigation, so the check sees Back/Home/Recents the way James uses them.
    emu.sx('cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.threebutton'); time.sleep(2)
    check('debug build of the same source installs', 'Success' in emu.sh(ADB, '-s', emu.S, 'install', '-r', str(apk)))
    emu.sx('am start -W -n %s/ai.wizards.os.MainActivity -a android.intent.action.MAIN -c android.intent.category.LAUNCHER' % PKG)
    for _ in range(12):
        xml = emu.ui(); ls = labels(xml)
        if any(s.startswith('Wizard orb.') for s in ls) and not any(s in ('Skip', 'Got it') for s in ls): break
        if not emu.tap_text(r'^(Skip|Got it|GOT IT|OK)$', xml): time.sleep(3)
        else: time.sleep(1.2)
    check('live Wizard shell loaded', wait(lambda: any(s.startswith('Wizard orb.') for s in labels(emu.ui())), 60))
    page = Page(emu, 9335)
    check('native pin bridge present', page.ev('!!window.wizardHomeScreenPort'))
    page.ev("__wos.openSheet('launcher')"); time.sleep(0.8)
    page.ev("(() => { const s = document.querySelector('#search'); s.value = 'wisdom'; s.dispatchEvent(new Event('input', {bubbles:true})); s.blur(); return 1; })()")
    time.sleep(2.5); page.ev(LOG); cap('p01-apps-search')
    row = phys(page, '#launcherBody .lrow[data-app="wisdom"]')
    check('Wisdom app row located in the real Apps menu', row is not None, row)
    emu.sx('input swipe %d %d %d %d 700' % (row[0], row[1], row[0], row[1])); time.sleep(1.2)
    cap('p02-sheet')
    st = page.ev("({log: window.__hl, state: window.WizHomeScreenApps.state, sheet: document.querySelector('.home-pin-sheet')?.innerText || null})")
    check('native long-press lands on the Wisdom row', any(e[1] == 'pointerdown' and e[2] == 'wisdom' for e in st['log']), st['log'])
    check('long-press opens the Wisdom Add to home screen sheet', st['state']['open'] and st['state']['appId'] == 'wisdom' and 'Add to home screen' in (st['sheet'] or ''), st)
    btn = phys(page, '.home-pin-sheet button')
    wait(lambda: page.ev("!document.querySelector('.home-pin-sheet button')?.disabled"), 10)
    emu.sx('input tap %d %d' % (btn[0], btn[1])); time.sleep(1.5)
    cap('p03-os-confirm')
    check('Android pin confirmation shown', not emu.front(), emu.top())
    confirmed = emu.tap_text(r'^(Add|Add automatically|Add to home screen|ADD)$')
    check('OS confirmation accepted', bool(confirmed), confirmed)
    time.sleep(2); cap('p04-after-confirm')
    sc = emu.sx('dumpsys shortcut'); (out / 'shortcuts.txt').write_text(sc)
    check('pinned shortcut exists for Wisdom', 'homeapp-' in sc and 'Wisdom' in sc)
    check('sheet confirms Added to home screen', 'Added to home screen' in (page.ev("document.querySelector('.home-pin-sheet')?.innerText || 'closed'") or '') or not page.ev('WizHomeScreenApps.state.open'))
    page.close()
    emu.sx('input keyevent KEYCODE_HOME'); time.sleep(1.5)
    icon = None
    for _ in range(4):
        icon = bounds(emu.ui(), 'Wisdom')
        if icon: break
        emu.sx('input swipe 900 1100 150 1100 250'); time.sleep(1)
    cap('p05-launcher-home')
    if not check('Wisdom icon on the Android home screen', icon is not None, icon): raise AssertionError('no pinned icon')
    emu.sx('input tap %d %d' % icon)
    check('icon opens Wisdom as its own app (AppSessionActivity)', wait(lambda: '.AppSessionActivity' in emu.top(), 30), emu.top())
    time.sleep(7)
    cap('p06-pinned-wisdom')
    xml = emu.ui(); text = ' '.join(labels(xml))
    check('no "Viewing full screen" hint (pinned app is not immersive)', 'Viewing full screen' not in text, text[:160])
    win = emu.sx('dumpsys window'); (out / 'window-pinned.txt').write_text(win)
    def bar_visible(kind):
        return bool(re.search(r'InsetsSource[^\n]*type=' + kind + r'[^\n]*visible=true', win))
    check('status bar stays visible in the pinned app', bar_visible('statusBars'))
    check('three-button navigation stays visible in the pinned app', bar_visible('navigationBars') and 'threebutton' in emu.sx('cmd overlay list'))
    check('pinned app shows Wisdom content', bool(re.search(r'Currently reading|Suggested|Browse all|collection|Wisdom', text)), text[:300])
    check('pinned app has no Wizard orb/dock', not any(s.startswith('Wizard orb.') for s in labels(xml)))
    emu.sx('input keyevent KEYCODE_BACK'); time.sleep(1.2); emu.sx('input keyevent KEYCODE_BACK'); time.sleep(1.2)
    cap('p07-after-back')
    check('Back at the app root keeps the pinned app open', '.AppSessionActivity' in emu.top(), emu.top())
    first = homeapp_tasks(emu.sx('dumpsys activity recents'))
    check('exactly one pinned Wisdom task', len(first) == 1, first)
    emu.sx('input keyevent KEYCODE_HOME'); time.sleep(1)
    icon = bounds(emu.ui(), 'Wisdom') or icon
    emu.sx('input tap %d %d' % icon); time.sleep(2.5)
    check('re-tapping the icon reuses the same task', homeapp_tasks(emu.sx('dumpsys activity recents')) == first and '.AppSessionActivity' in emu.top())
    emu.sx('am start -W -n %s/ai.wizards.os.MainActivity -a android.intent.action.MAIN -c android.intent.category.LAUNCHER' % PKG); time.sleep(3)
    check('ordinary Wizard still opens its own shell', '.MainActivity' in emu.top() and any(s.startswith('Wizard orb.') for s in labels(emu.ui())), emu.top())
    recents = emu.sx('dumpsys activity recents'); (out / 'recents.txt').write_text(recents)
    check('pinned Wisdom and Wizard are separate Recents tasks', len(homeapp_tasks(recents)) == 1 and '.MainActivity' in recents)
except Exception as e:
    failure = repr(e); print('ERROR', failure, flush=True); cap('failure')
finally:
    try: emu.kill()
    except Exception: pass
    passed = sum(c['pass'] for c in checks)
    (out / 'receipt.json').write_text(json.dumps({'source_revision': build.get('source_revision'), 'apk_sha256': a['sha256'], 'checks': checks, 'failure': failure, 'passed': passed, 'total': len(checks)}, indent=1))
    print('RESULT %d/%d%s' % (passed, len(checks), (' failure=' + failure) if failure else ''), flush=True)
    sys.exit(0 if failure is None and passed == len(checks) else 1)
