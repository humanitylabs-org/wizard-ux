#!/usr/bin/env python3
"""Thales API35 signed-preview pin/task probe. Real launcher/UI, no CDP or app doubles.
Usage on Thales: QA_SHA=<exact candidate SHA> python3 tools/qa_home_screen_apps.py /Volumes/ThalesMedia/AndroidBuilds/jobs/JOB/receipt.json
The build must have come from android-build-thales --wait-for-lock. Never runs on VPS/physical phones.
"""
import fcntl, hashlib, json, os, pathlib, re, socket, subprocess, sys, time, urllib.request, urllib.parse
P = pathlib.Path
if sys.platform != 'darwin' or 'thales' not in socket.gethostname().lower():
    raise SystemExit('Thales-only emulator QA')
from qa_aa_lib import Emu, wait, BASE
receipt_path = P(sys.argv[1]).resolve()
if not receipt_path.is_relative_to(BASE) or receipt_path.name != 'receipt.json':
    raise SystemExit('Require canonical remote build receipt under AndroidBuilds')
build = json.loads(receipt_path.read_text())
if build.get('status') != 'ok' or build.get('host') != 'thales':
    raise SystemExit('Build receipt is not successful Thales output')
if not re.fullmatch(r'[a-f0-9]{40}',os.environ.get('QA_SHA','')) or build.get('source_revision') != os.environ['QA_SHA']:
    raise SystemExit('QA_SHA must match exact remote candidate source revision')
artifacts = [a for a in build['artifacts'] if a.get('aapt2',{}).get('package') == 'ai.wizards.os.preview']
if len(artifacts) != 1:
    raise SystemExit('Exactly one signed Preview artifact required')
a = artifacts[0]
if str(a['aapt2'].get('version_code')) != '1001' or a['aapt2'].get('version_name') != '0.9.12-homescreen.1-preview' or a['aapt2'].get('application_label') != 'Wizard Preview':
    raise SystemExit('Wrong coordinated Home-screen Preview version/label')
if a['signer_sha256'] != '3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd':
    raise SystemExit('Wrong Wizard OS signer')
apk = P(build['job']) / 'source' / a['path']
if not apk.resolve().is_relative_to(P(build['job']) / 'source'):
    raise SystemExit('Artifact escaped source')
if hashlib.sha256(apk.read_bytes()).hexdigest() != a['sha256']:
    raise SystemExit('Exact artifact SHA mismatch')
checks=[]
origin='https://home-screen-apps.staging.wizard001.com'
incomplete=['signed WebView exact inner URL/iframe-refresh and per-instance storage readback (debug companion required)',
            'camera/IME/sigil pixel acceptance and selection/share/capture device interactions',
            'invalid-native-intent and network/Tailscale recovery device gates',
            'affected browser regressions and expected-failure baseline receipts']
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
                x1,y1,x2,y2=map(int,values)
                if x2>x1 and y2>y1:return ((x1+x2)//2,(y1+y2)//2)
    return None
def tasks(raw):
    # Recents headers uniquely enumerate tasks; inspect their actual base intent component.
    blocks=re.split(r'(?=\s*\* Recent #\d+:)',raw)
    return sorted(set(int(m.group(1)) for block in blocks
        if 'ai.wizards.os.preview' in block and '.AppSessionActivity' in block
        for m in [re.search(r'Task\{[^\n]* #([0-9]+)',block)] if m))

def labels(xml):
    import xml.etree.ElementTree as E
    return [n.get('text') or n.get('content-desc') or '' for n in E.fromstring(xml).iter('node')]
def reading(xml):
    return next((s.strip() for s in labels(xml) if re.fullmatch(r'\s*\d+\s*/\s*\d+\s*',s)),None)
def app_content(label,xml):
    text=' '.join(labels(xml))
    if label=='Wisdom': return bool(re.search(r'Currently reading|Suggested|Browse all|Request a new collection',text)) or bool(reading(xml))
    return 'Signal' in text and bool(re.search(r'For You|Latest|Sources|Saved',text)) and not reading(xml)
def get_json(url):
    with urllib.request.urlopen(url,timeout=30) as r:return json.load(r)

# The exact canonical shared heavy-worker lease; no alternate lock or fallback.
with (BASE/'worker.lock').open('a') as lease:
    fcntl.flock(lease,fcntl.LOCK_EX)
    out = BASE/'qa'/('home-screen-'+str(int(time.time())))
    out.mkdir(parents=True);emu=Emu(out,5596,'ai.wizards.os.preview',dns=os.environ.get('QA_DNS','192.168.1.1'));failure=None
    emu.env['JAVA_HOME']='/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home'
    emu.env['PATH']=emu.env['JAVA_HOME']+'/bin:'+emu.env['PATH']
    def capture(name):
        emu.shot(out,name);(out/(name+'.xml')).write_text(emu.ui());(out/(name+'-activities.txt')).write_text(emu.sx('dumpsys activity activities'))
        if name=='failure':(out/'failure-logcat.txt').write_text(emu.sx('logcat -d -v threadtime'))
    try:
        emu.boot();check('isolated API35 emulator',emu.sx('getprop ro.build.version.sdk').strip()=='35')
        source=P(build['job'])/'source'
        for rel in ('index.html','core/home-screen-policy.js','core/single-app-session.js','core/home-screen-apps.js'):
            with urllib.request.urlopen(origin+'/wizard-os-home/'+rel,timeout=30) as r:served=r.read()
            expected=(source/'web'/rel).read_bytes()
            # The parent-owned preview proxy adds this single, audited coaching/tag script.
            # Compare every shell byte after removing ONLY that exact transport injection;
            # record the actual delivered bytes and boot script identity as separate evidence.
            injected=b'<head><script src="/__staging/boot.js"></script>'
            normalized=served.replace(injected,b'<head>',1) if rel=='index.html' and served.count(injected)==1 else served
            if normalized!=served:
                with urllib.request.urlopen(origin+'/__staging/boot.js',timeout=30) as r:boot=r.read()
                (out/'staging-boot.js').write_bytes(boot)
                (out/'served-index.html').write_bytes(served)
                check('parent staging boot transport injection recorded',b"staging: no service worker" in boot,{'served_sha256':hashlib.sha256(served).hexdigest(),'boot_sha256':hashlib.sha256(boot).hexdigest()})
            check('durable staging candidate bytes '+rel,hashlib.sha256(normalized).digest()==hashlib.sha256(expected).digest(),{'served':hashlib.sha256(served).hexdigest(),'source':hashlib.sha256(expected).hexdigest()})
        registry=get_json(origin+'/wizard/v1/apps')['apps']
        routes={app['id']:urllib.parse.urljoin(origin,app['url']) for app in registry if app['id'] in ('wisdom','wizard-signal')}
        check('real registered frontend routes present',set(routes)=={'wisdom','wizard-signal'},routes)
        live=get_json(urllib.parse.urljoin(routes['wisdom'],'api/wisdom'))
        unread=[e for e in live['entries'] if not e.get('read')]
        check('live Wisdom has actual unread reading data',bool(unread))
        from qa_aa_lib import ADB
        install=emu.sh(ADB,'-s',emu.S,'install','-r',apk)
        check('exact signed-preview APK installs on emulator','Success' in install,install)
        emu.sx('input keyevent KEYCODE_HOME');time.sleep(1)
        point=bounds(emu.ui(),'Wizard Preview')
        if not point:
            emu.sx('input swipe 540 2180 540 400 350');time.sleep(1)
            for _ in range(5):
                point=bounds(emu.ui(),'Wizard Preview')
                if point:break
                emu.sx('input swipe 540 1850 540 600 300');time.sleep(0.4)
        check('ordinary Preview icon is present in Android launcher',point is not None)
        emu.sx('input tap %d %d'%point)
        check('ordinary Preview launcher opens MainActivity',wait(lambda:'.MainActivity' in emu.top(),30),emu.top())
        time.sleep(6);capture('ordinary-launch')
        pinned=[]
        for label in ('Wisdom','Signal'):
            # Apps is the existing mobile upward swipe from the orb; no synthetic native launch URL.
            xml=emu.ui();orb_label=next((s for s in labels(xml) if s.startswith('Wizard orb.')),None)
            orb=bounds(xml,orb_label) if orb_label else None
            check('actual orb gesture target is visible',orb is not None,orb)
            x,y=orb;emu.sx('input swipe %d %d %d %d 450'%(x,y,x,max(400,y-700)));time.sleep(1)
            point=None
            for _ in range(6):
                point=bounds(emu.ui(),label) or (bounds(emu.ui(),'Wizard Signal') if label=='Signal' else None)
                if point:break
                # The real menu opens bottom anchored; scroll only the app list, not the orb.
                emu.sx('input swipe 540 1250 540 1800 300');time.sleep(0.4)
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
            check(label+' own icon launches correct real frontend content',wait(lambda:app_content(label,emu.ui()),25),emu.top());capture(label.lower()+'-session')
            for n in range(3):emu.sx('input keyevent KEYCODE_BACK');time.sleep(0.3)
            check(label+' repeated root Back retains actual app content',app_content(label,emu.ui()) and emu.front())
            emu.sx('input keyevent KEYCODE_HOME');time.sleep(1)
            emu.sx('am start -W -n ai.wizards.os.preview/.MainActivity -a android.intent.action.MAIN -c android.intent.category.LAUNCHER');time.sleep(1)
        emu.sx('input keyevent KEYCODE_HOME');time.sleep(1)
        original=tasks(emu.sx('dumpsys activity recents'));check('Wisdom and Signal independent Recents tasks',len(original)==2,original)
        recents=emu.sx('dumpsys activity recents');check('Wizard ordinary task remains separate', '.MainActivity' in recents)
        for label in ('Wisdom','Signal','Wisdom'):
            emu.sx('input keyevent KEYCODE_HOME');time.sleep(0.5);point=bounds(emu.ui(),label);check(label+' launcher icon still present',point is not None)
            emu.sx('input tap %d %d'%point);time.sleep(1)
            check(label+' repeated launch reuses existing task set',tasks(emu.sx('dumpsys activity recents'))==original)
            check(label+' switch/re-tap preserves actual displayed app',app_content(label,emu.ui()))
        # Actual Wisdom pages, not an Activity-name surrogate or a made-up #/read route.
        check('Wisdom Browse control opens',bool(emu.tap_text(r'Browse all|Browse & search')))
        time.sleep(1);check('Wisdom real To read list opens',bool(emu.tap_text(r'^To read$')));time.sleep(1)
        selected=None
        for _ in range(8):
            xml=emu.ui()
            selected=next((e for e in unread if e['title'] in ' '.join(labels(xml))),None)
            if selected and emu.tap_text(re.escape(selected['title']),xml):break
            selected=None;emu.sx('input swipe 540 1850 540 750 300');time.sleep(0.5)
        check('actual unread Wisdom chapter opened',selected is not None)
        check('actual paged reader visible',wait(lambda:reading(emu.ui()),20),selected['title'])
        first=reading(emu.ui());check('real chapter has nonterminal pages',int(first.split('/')[1])>=4,first)
        for _ in range(2):emu.sx('input keyevent KEYCODE_DPAD_RIGHT');time.sleep(0.4)
        saved=reading(emu.ui());check('actual reader advanced to page three',bool(saved and int(saved.split('/')[0])==3),saved)
        capture('wisdom-page-three')
        for label in ('Signal','Wisdom','Wisdom'):
            emu.sx('input keyevent KEYCODE_HOME');time.sleep(0.5);point=bounds(emu.ui(),label);check(label+' pinned icon present for reading switch',point is not None)
            emu.sx('input tap %d %d'%point);time.sleep(1)
            if label=='Wisdom':check('Wisdom Home/switch/re-tap retains actual chapter/page',reading(emu.ui())==saved and selected['title'] in ' '.join(labels(emu.ui())))
            else:check('Signal task still displays real Signal frontend',app_content(label,emu.ui()))
        emu.sx('input keyevent KEYCODE_HOME');time.sleep(0.5);emu.sx('am kill ai.wizards.os.preview')
        check('background process death exercised',wait(lambda:not emu.sx('pidof ai.wizards.os.preview').strip(),10))
        point=bounds(emu.ui(),'Wisdom');check('Wisdom icon survives process death',point is not None);emu.sx('input tap %d %d'%point);time.sleep(4)
        check('Wisdom process death restores actual chapter AND reading page',wait(lambda:reading(emu.ui())==saved and selected['title'] in ' '.join(labels(emu.ui())),25));capture('death-restore')
        emu.sx('input keyevent KEYCODE_BACK');time.sleep(1)
        check('nested Back actually leaves reading page, remains Wisdom',reading(emu.ui()) is None and app_content('Wisdom',emu.ui()) and emu.front())
        # Close a real app overlay before leaving its route; never submit its form.
        for _ in range(4):emu.sx('input keyevent KEYCODE_BACK');time.sleep(0.3)
        emu.sx('input swipe 540 1800 540 800 400');time.sleep(0.5)
        check('Wisdom real request overlay opens',bool(emu.tap_text(r'^Request a new collection$')));time.sleep(0.5)
        check('Wisdom real request textbox visible','wb-req-text' in emu.ui() or 'What do you want to read' in emu.ui())
        emu.sx('input keyevent KEYCODE_BACK');time.sleep(0.5)
        check('overlay Back does not exit or reveal desks',emu.front() and app_content('Wisdom',emu.ui()) and 'What do you want to read' not in emu.ui())
        recents=emu.sx('dumpsys activity recents');(out/'final-recents.txt').write_text(recents)
        check('no duplicate app tasks after death',tasks(recents)==original)
    except Exception as error:
        failure=str(error)
        try:capture('failure')
        except Exception:pass
    finally:
        if os.environ.get('QA_COMPANION')=='1':
            companion_out=out/'companion'
            try:
                env=emu.env.copy();env.update(QA_SERIAL=emu.S,QA_BUILD_SHA=build['source_revision'],QA_SOURCE_SHA=os.environ.get('QA_SOURCE_SHA',''))
                with (out/'companion.log').open('w') as log:
                    run=subprocess.run(['node',str(P(__file__).with_name('qa_home_screen_companion.cjs')),sys.argv[1],str(companion_out)],cwd=P(__file__).parent.parent,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=1200)
                companion=json.loads((companion_out/'receipt.json').read_text())
                checks.append({'name':'actual exact-source API35 CDP companion','pass':run.returncode==0 and not companion.get('missing'),'detail':{'receipt':str(companion_out/'receipt.json'),'failure':companion.get('failure'),'missing':companion.get('missing'),'totals':companion.get('totals')}})
            except Exception as error:
                checks.append({'name':'actual exact-source API35 CDP companion','pass':False,'detail':str(error)})
        emu.kill()
        result={'host':socket.gethostname(),'source_revision':build['source_revision'],'source_manifest_sha256':build['source_manifest_sha256'],'apk':str(apk),'sha256':a['sha256'],'signer_sha256':a['signer_sha256'],'package':a['aapt2'],'checks':checks,'failure':failure,'scope':'actual signed Preview/launcher/API35 UI + candidate staging readback; no debug-CDP substitution','incomplete':incomplete,
                'acceptance':{'1':'OS pin/name + confirmation; sigil pixels need review','2':'task counts + actual Home/re-tap content/page','3':'actual death restores reader; workspace/isolation/frame-refresh browser+debug companion required','4':'real overlay/nested/root Back; camera/IME/utilities/recovery pending','5':'signed APK + exact staging GET source; browser baseline/regressions separate'}}
        (out/'receipt.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2));print('EVIDENCE',out)
        if failure:raise SystemExit(1)
        if incomplete:raise SystemExit(2) # a successful subset is not five-outcome acceptance
