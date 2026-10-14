#!/usr/bin/env python3
"""Thales API35 signed-preview pin/task probe. Real launcher/UI, no CDP or app doubles.
Usage on Thales: python3 tools/qa_home_screen_apps.py /Volumes/ThalesMedia/AndroidBuilds/jobs/JOB/receipt.json
The build must have come from android-build-thales --wait-for-lock. Never runs on VPS/physical phones.
"""
import fcntl, hashlib, json, os, pathlib, re, socket, sys, time
from qa_aa_lib import Emu, wait, BASE
P = pathlib.Path
if sys.platform != 'darwin' or 'thales' not in socket.gethostname().lower():
    raise SystemExit('Thales-only emulator QA')
receipt_path = P(sys.argv[1]).resolve()
if not receipt_path.is_relative_to(BASE) or receipt_path.name != 'receipt.json':
    raise SystemExit('Require canonical remote build receipt under AndroidBuilds')
build = json.loads(receipt_path.read_text())
if build.get('status') != 'ok' or build.get('host') != 'thales':
    raise SystemExit('Build receipt is not successful Thales output')
artifacts = [a for a in build['artifacts'] if a.get('aapt2',{}).get('package') == 'ai.wizards.os.preview']
if len(artifacts) != 1:
    raise SystemExit('Exactly one signed Preview artifact required')
a = artifacts[0]
if a['signer_sha256'] != '3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd':
    raise SystemExit('Wrong Wizard OS signer')
apk = P(build['job']) / 'source' / a['path']
if not apk.resolve().is_relative_to(P(build['job']) / 'source'):
    raise SystemExit('Artifact escaped source')
if hashlib.sha256(apk.read_bytes()).hexdigest() != a['sha256']:
    raise SystemExit('Exact artifact SHA mismatch')
checks=[]
def check(name, condition, detail=None):
    checks.append({'name':name,'pass':bool(condition),'detail':detail})
    print(('PASS ' if condition else 'FAIL ') + name, detail or '', flush=True)
    if not condition: raise AssertionError(name)
def bounds(xml, label):
    import xml.etree.ElementTree as E
    for node in E.fromstring(xml).iter('node'):
        text=node.get('text') or node.get('content-desc') or ''
        if text.strip().lower() == label.lower():
            values=re.findall(r'\d+',node.get('bounds',''))
            if len(values)==4:
                x1,y1,x2,y2=map(int,values);return ((x1+x2)//2,(y1+y2)//2)
    return None
def tasks(raw):
    # Recents headers uniquely enumerate tasks; inspect their actual base intent component.
    blocks=re.split(r'(?=\s*\* Recent #\d+:)',raw)
    return sorted(set(int(m.group(1)) for block in blocks
        if 'ai.wizards.os.preview' in block and '.AppSessionActivity' in block
        for m in [re.search(r'Task\{[^\n]* #([0-9]+)',block)] if m))

# The exact canonical shared heavy-worker lease; no alternate lock or fallback.
with (BASE/'worker.lock').open('a') as lease:
    fcntl.flock(lease,fcntl.LOCK_EX)
    out = BASE/'qa'/('home-screen-'+str(int(time.time())))
    out.mkdir(parents=True);emu=Emu(out,5596,'ai.wizards.os.preview');failure=None
    emu.env['JAVA_HOME']='/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home'
    emu.env['PATH']=emu.env['JAVA_HOME']+'/bin:'+emu.env['PATH']
    def capture(name):
        emu.shot(out,name);(out/(name+'.xml')).write_text(emu.ui());(out/(name+'-activities.txt')).write_text(emu.sx('dumpsys activity activities'))
    try:
        emu.boot();check('isolated API35 emulator',emu.sx('getprop ro.build.version.sdk').strip()=='35')
        from qa_aa_lib import ADB
        install=emu.sh(ADB,'-s',emu.S,'install','-r',apk)
        check('exact signed-preview APK installs on emulator','Success' in install,install)
        emu.sx('monkey -p ai.wizards.os.preview -c android.intent.category.LAUNCHER 1')
        check('ordinary Preview launcher opens MainActivity',wait(lambda:'.MainActivity' in emu.top(),30),emu.top())
        time.sleep(6);capture('ordinary-launch')
        pinned=[]
        for label in ('Wisdom','Signal'):
            # Apps is the existing mobile upward swipe from the orb; no synthetic native launch URL.
            emu.sx('input swipe 540 2160 540 1400 450');time.sleep(1)
            point=bounds(emu.ui(),label)
            check(label+' appears in real Apps menu',point is not None)
            x,y=point;emu.sx('input swipe %d %d %d %d 650'%(x,y,x,y));time.sleep(0.5)
            capture(label.lower()+'-pin-action')
            check(label+' hold opens action sheet',bool(emu.tap_text(r'^Add to home screen$')))
            time.sleep(1);capture(label.lower()+'-os-confirm')
            check(label+' request opens actual launcher confirmation',not emu.front(),emu.top())
            confirmed=emu.tap_text(r'^(Add|Add automatically|Add to home screen)$')
            check(label+' OS confirmation control tapped',bool(confirmed),confirmed)
            time.sleep(1)
            shortcuts=emu.sx('dumpsys shortcut');(out/(label.lower()+'-shortcuts.txt')).write_text(shortcuts)
            check(label+' Android pinned shortcut exists',label in shortcuts and 'homeapp-' in shortcuts)
            pinned.append(label)
            emu.sx('input keyevent KEYCODE_HOME');time.sleep(1)
            point=bounds(emu.ui(),label);check(label+' own home icon/name exists',point is not None)
            emu.sx('input tap %d %d'%point);time.sleep(4)
            check(label+' own icon launches AppSessionActivity','.AppSessionActivity' in emu.top(),emu.top());capture(label.lower()+'-session')
            for n in range(3):emu.sx('input keyevent KEYCODE_BACK');time.sleep(0.3)
            check(label+' root Back remains in app task','.AppSessionActivity' in emu.top())
            emu.sx('input keyevent KEYCODE_HOME');time.sleep(1)
            emu.sx('monkey -p ai.wizards.os.preview -c android.intent.category.LAUNCHER 1');time.sleep(1)
        emu.sx('input keyevent KEYCODE_HOME');time.sleep(1)
        original=tasks(emu.sx('dumpsys activity recents'));check('Wisdom and Signal independent Recents tasks',len(original)==2,original)
        for label in ('Wisdom','Signal','Wisdom'):
            emu.sx('input keyevent KEYCODE_HOME');time.sleep(0.5);point=bounds(emu.ui(),label);check(label+' launcher icon still present',point is not None)
            emu.sx('input tap %d %d'%point);time.sleep(1)
            check(label+' repeated launch reuses existing task set',tasks(emu.sx('dumpsys activity recents'))==original)
        emu.sx('input keyevent KEYCODE_HOME');time.sleep(0.5);emu.sx('am kill ai.wizards.os.preview')
        check('background process death exercised',wait(lambda:not emu.sx('pidof ai.wizards.os.preview').strip(),10))
        point=bounds(emu.ui(),'Wisdom');check('Wisdom icon survives process death',point is not None);emu.sx('input tap %d %d'%point);time.sleep(4)
        check('Wisdom recreates own task after death','.AppSessionActivity' in emu.top());capture('death-restore')
        recents=emu.sx('dumpsys activity recents');(out/'final-recents.txt').write_text(recents)
        check('no duplicate app tasks after death',tasks(recents)==original)
    except Exception as error:
        failure=str(error)
        try:capture('failure')
        except Exception:pass
    finally:
        emu.kill()
        result={'host':socket.gethostname(),'source_revision':build['source_revision'],'source_manifest_sha256':build['source_manifest_sha256'],'apk':str(apk),'sha256':a['sha256'],'signer_sha256':a['signer_sha256'],'package':a['aapt2'],'checks':checks,'failure':failure,'scope':'actual signed Preview/launcher/API35; no debug-CDP substitution','incomplete':['real chapter route/reading-position death+refresh comparison','nested app-overlay Back','camera/IME cutouts','removed-app/network recovery','durable staging source readback','affected browser regressions/negative control']}
        (out/'receipt.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2));print('EVIDENCE',out)
        if failure:raise SystemExit(1)
