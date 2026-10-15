#!/usr/bin/env python3
"""Thales-only native delayed-STT regression: real overlay taps + external editable + CDP.
Usage: qa_everywhere_processing.py QA_APK [BASELINE_QA_APK]
Fake transcription responses are deliberate fixtures; no production writes are made.
"""
# pyright: reportUndefinedVariable=false
import pathlib, sys, queue
args = sys.argv[:]
sys.argv = [args[0], args[1], 'ai.wizards.os.qa'] + args[2:]
P = pathlib.Path
helper = P(__file__).with_name('qa_everywhere.py').read_text().split('DENS = None')[0]
# Reuse bounded emulator/CDP helpers and fake-server protocol, without its full legacy suite.
exec(compile(helper, str(P(__file__).with_name('qa_everywhere.py')), 'exec'))
RESPONSE = queue.Queue(); ENTERED = threading.Event()
EDITOR = b'<html><meta name="viewport" content="width=device-width"><body style="background:#101020;color:white;font:20px sans-serif"><textarea id="ed" style="width:90%;height:180px;font:20px sans-serif" autofocus></textarea></body></html>'
old_get, old_post = Fake.do_GET, Fake.do_POST

def fake_get(self):
    if self.path.startswith('/editor'):
        self.send_response(200); self.send_header('Content-Type','text/html'); self.send_header('Content-Length',str(len(EDITOR))); self.end_headers(); self.wfile.write(EDITOR); return
    old_get(self)

def fake_post(self):
    if self.path == '/wizard-os-home/api/transcribe':
        self.rfile.read(int(self.headers.get('Content-Length') or 0))
        STATE['transcribe'] += 1; ENTERED.set()
        code, data = RESPONSE.get(timeout=90)
        return self._json(code, data)
    old_post(self)
Fake.do_GET, Fake.do_POST = fake_get, fake_post
# The helper initialized paths using argv; baseline is its optional third positional.
baseline = old
DENS = None; em = None; orb = None; ed = None

def must(n, ok, detail=''):
    check(n, ok, detail)
    if not ok: raise AssertionError(n + ': ' + str(detail))

def orb_state(): return orb.ev('({mode:S.mode,kb:S.kb,busy:document.body.classList.contains("busy"),timer:document.getElementById("timer").textContent,ring:getComputedStyle(document.getElementById("processing")||document.body).display})')
def tap_orb():
    b = bubble(); must('orb bounds available', bool(b), b)
    x,y = mid(b); sx(f'input tap {x} {y}')
def settle_ready():
    for _ in range(40):
        st = orb_state()
        if st['mode'] in ('type','idle'): return st
        time.sleep(.25)
    raise AssertionError('orb did not release: ' + str(st))
def begin():
    ENTERED.clear(); sx(f'run-as {PKG} cp /data/local/tmp/qa_voice.m4a files/qa_next.m4a')
    tap_orb()
    for _ in range(15):
        if orb_state()['mode']=='typing': break
        time.sleep(.15)
    must('real tap starts blue dictation', orb_state()['mode']=='typing', orb_state())
    tap_orb(); must('transcriber received stopped audio', ENTERED.wait(10), STATE['transcribe'])
    time.sleep(.5)
def wait_contains(text):
    for _ in range(45):
        t=ed.ev('document.getElementById("ed").value')
        if text.lower() in (t or '').lower(): return t
        time.sleep(.25)
    return t

def setup(build):
    global orb, ed
    if orb: orb.close(); orb=None
    if ed: ed.close(); ed=None
    sx(f'am force-stop {PKG}'); sh(ADB,'-s',S,'uninstall',PKG)
    must('QA APK installs', 'Success' in sh(ADB,'-s',S,'install',build))
    sx(f'run-as {PKG} mkdir -p files shared_prefs')
    # Debug-only native endpoint + durable settings. No remote writes or settings through production UI.
    conf = job / 'origin.txt'; conf.write_text(f'http://10.0.2.2:{FAKE}')
    prefs = job / 'everywhere.xml'; prefs.write_text('<?xml version="1.0" encoding="utf-8"?><map><boolean name="enabled" value="true"/></map>')
    sh(ADB,'-s',S,'push',conf,'/data/local/tmp/qa_origin.txt'); sh(ADB,'-s',S,'push',prefs,'/data/local/tmp/everywhere.xml')
    sx(f'run-as {PKG} cp /data/local/tmp/qa_origin.txt files/qa_origin.txt'); sx(f'run-as {PKG} cp /data/local/tmp/everywhere.xml shared_prefs/everywhere.xml')
    sx(f'pm grant {PKG} android.permission.RECORD_AUDIO'); sx(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS')
    sx(f'appops set {PKG} SYSTEM_ALERT_WINDOW allow'); sx(f'appops set {PKG} ACCESS_RESTRICTED_SETTINGS allow')
    sx(f'settings put secure enabled_accessibility_services {PKG}/ai.wizards.os.everywhere.WizardKeyboardService'); sx('settings put secure accessibility_enabled 1')
    sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity'); time.sleep(5)
    sx('input keyevent KEYCODE_HOME'); time.sleep(2)
    # Chrome first-run is suppressed on this disposable emulator only.
    sx('am set-debug-app --persistent com.android.chrome')
    cmd=job/'chrome-command-line'; cmd.write_text('_ --disable-fre --no-default-browser-check --no-first-run')
    sh(ADB,'-s',S,'push',cmd,'/data/local/tmp/chrome-command-line'); sx('am force-stop com.android.chrome')
    sx(f'am start -W -n com.android.chrome/com.google.android.apps.chrome.Main -a android.intent.action.VIEW -d http://10.0.2.2:{FAKE}/editor'); time.sleep(4)
    for _ in range(3):
        if not tap_text(r'^(No thanks|No Thanks|Use without an account|Accept & continue|Got it)$'): break
        time.sleep(1)
    ed=Page(sock='chrome_devtools_remote',match='/editor',fetch=False)
    # A real touch focuses the field and opens the keyboard.
    xy=ed.ev('(()=>{const r=document.getElementById("ed").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+50}})()')
    for typ in ('touchStart','touchEnd'): ed.call('Input.dispatchTouchEvent',type=typ,touchPoints=[xy] if typ=='touchStart' else [])
    time.sleep(3)
    must('external app keyboard opens',ime_shown())
    must('floating orb visible over editor',bool(wait_bubble(True)))
    orb=Page(match='everywhere.html',fetch=False)
    must('blue ready state',orb_state()['mode']=='type',orb_state())
    orb.ev('window.__draws=0;{const gl=WebGLRenderingContext.prototype,o=gl.drawArrays;gl.drawArrays=function(...a){window.__draws++;return o.apply(this,a)}}')

with (BASE/'worker.lock').open('a') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX)
    try:
        sh(SDK/'cmdline-tools/latest/bin/avdmanager','create','avd','-n','q','-k','system-images;android-35;google_apis;arm64-v8a','-d','pixel_7','-p',job/'dev',stdin='no\n')
        em=subprocess.Popen([str(SDK/'emulator/emulator'),'-avd','q','-port',str(PORT),'-no-window','-no-snapshot','-no-audio','-gpu','swiftshader_indirect'],env=env,stdout=open(job/'em.log','w'),stderr=subprocess.STDOUT)
        for _ in range(120):
            if sx('getprop sys.boot_completed').strip()=='1': break
            time.sleep(2)
        sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard')
        sx('settings put secure show_ime_with_hard_keyboard 1')
        for name in ('window_animation_scale','transition_animation_scale','animator_duration_scale'): sx(f'settings put global {name} 0')
        aiff=job/'qa.aiff'; canned=job/'qa.m4a'; sh('say','-o',aiff,'A delayed transcription test for Wizard Everywhere.'); sh('afconvert','-f','m4af','-d','aac',aiff,canned); sh(ADB,'-s',S,'push',canned,'/data/local/tmp/qa_voice.m4a')
        if baseline:
            setup(baseline); begin(); time.sleep(3)
            must('NEGATIVE CONTROL reproduces idle while transcribing',orb_state()['mode']=='type' and not orb_state()['busy'],orb_state())
            tap_orb(); time.sleep(.4)
            must('NEGATIVE CONTROL admits overlapping take',bool(controls()),controls())
            if 'cancel' in controls():
                x,y=mid(controls()['cancel']);sx(f'input tap {x} {y}')
            RESPONSE.put((200,{'text':'Baseline fixture words.'})); time.sleep(2)
        setup(apk)
        # Idle battery saving survives; processing stays active after several seconds.
        time.sleep(3); a=orb.ev('__draws');time.sleep(2);must('true keyboard idle draws no frames',orb.ev('__draws')==a)
        begin();time.sleep(4)
        st=orb_state();must('long transcription stays visibly busy',st['mode']=='transcribe' and st['busy'] and st['ring']=='block',st)
        a=orb.ev('__draws');time.sleep(2);must('processing animation continues',orb.ev('__draws')>a+3)
        shot('processing-before-reentry')
        b=bubble();x,y=mid(b)
        for _ in range(3):sx(f'input tap {x} {y}')
        sx(f'input swipe {x} {y} {x} {y} 800');time.sleep(.3)
        must('repeat taps and hold cannot start another take/menu',not controls() and 'WizOrbMenu' not in sx('dumpsys window windows') and orb_state()['busy'],orb_state())
        must('one transcription only while blocked',STATE['transcribe']==(2 if baseline else 1),STATE['transcribe'])
        # Still draggable while logically locked.
        sx(f'input swipe {x} {y} {x-80} {y-70} 600');time.sleep(.3)
        must('busy orb remains draggable',bubble()!=b,(b,bubble()))
        # Carry is an existing take, not admission: exercise the actual MainActivity bridge and
        # real native remote-send dispatch while the previous outbox transcription is still held.
        # Recording state is an explicit fixture here; this test never sends a second real message.
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity');time.sleep(2)
        app=Page(fetch=True)
        app.ev('window.__carryCommands=[];window.__wosVoiceCmd=c=>{__carryCommands.push(c);WizardOSNative.appVoice("idle",0)};WizardOSNative.appVoice("listen",1500)')
        time.sleep(.5);sx('input keyevent KEYCODE_HOME');time.sleep(2)
        must('pending transcription can display a carried recording',orb_state()['mode']=='listen',orb_state())
        tap_orb();time.sleep(1)
        must('carried recording Send bypasses new-take lock',app.ev('__carryCommands.includes("send")'))
        must('after carried Send previous work still owns busy state',orb_state()['busy'],orb_state())
        app.close()
        # Return to the same text field before allowing the held dictation to finish.
        sx(f'am start -W -n com.android.chrome/com.google.android.apps.chrome.Main');time.sleep(1)
        for typ in ('touchStart','touchEnd'): ed.call('Input.dispatchTouchEvent',type=typ,touchPoints=[{'x':150,'y':140}] if typ=='touchStart' else [])
        time.sleep(.5)
        RESPONSE.put((200,{'text':'The delayed words arrived once.'}))
        text=wait_contains('delayed words arrived once');must('words inserted once into original external field',text.lower().count('delayed words arrived once')==1,text)
        settle_ready();time.sleep(3);a=orb.ev('__draws');time.sleep(2);must('completion returns to still ready state',orb_state()['mode']=='type' and not orb_state()['busy'] and orb.ev('__draws')==a,orb_state())
        shot('processing-completed')
        # Network retry remains locked; next attempt keeps processing.
        begin();RESPONSE.put((503,{'error':'fixture offline'}));time.sleep(.4)
        must('automatic retry wait stays visibly busy',orb_state()['mode']=='retry' and orb_state()['busy'],orb_state())
        ENTERED.clear();must('automatic retry reaches transcriber',ENTERED.wait(8),STATE['transcribe']);time.sleep(.3)
        must('retry attempt resumes processing animation',orb_state()['mode']=='transcribe' and orb_state()['busy'],orb_state())
        RESPONSE.put((200,{'text':'Retry words arrived.'}));must('retry inserts one result','retry words arrived' in wait_contains('retry words arrived').lower());settle_ready()
        before=ed.ev('document.getElementById("ed").value')
        begin();RESPONSE.put((200,{'text':''}));settle_ready()
        must('empty speech releases lock without changing text',ed.ev('document.getElementById("ed").value')==before)
        begin();RESPONSE.put((403,{'error':'fixture terminal denial'}));settle_ready()
        must('terminal failure releases lock and raises badge',orb.ev('document.getElementById("badge").classList.contains("on")'))
        sx(f'run-as {PKG} cp /data/local/tmp/qa_voice.m4a files/qa_next.m4a');tap_orb();time.sleep(.4)
        must('new take accepted after terminal failure',orb_state()['mode']=='typing',orb_state())
        cs=controls();x,y=mid(cs['cancel']);sx(f'input tap {x} {y}');time.sleep(.5)
        must('no chat runs from dictation',not STATE['runs'],STATE['runs'])
        # Screen-off and hidden paths keep the native sleep contract.
        sx('input keyevent KEYCODE_SLEEP');time.sleep(2);a=orb.ev('__draws');time.sleep(2);must('screen-off stops orb frames',orb.ev('__draws')==a)
        sx('input keyevent KEYCODE_WAKEUP');sx('wm dismiss-keyguard');time.sleep(1)
        sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity');time.sleep(2)
        for _ in range(4):sx('input keyevent KEYCODE_BACK');time.sleep(.3)
        must('root Back stays in Wizard',PKG in top(),top())
        must('no Android crash','FATAL EXCEPTION' not in sx('logcat -d -b crash'))
    finally:
        if orb:orb.close()
        if ed:ed.close()
        RESPONSE.put((200,{'text':'cleanup'}))
        if em:sh(ADB,'-s',S,'emu','kill');em.wait(40)
        srv.shutdown()
        (job/'result.json').write_text(json.dumps({'passed':sum(res),'total':len(res),'checks':res,'state':STATE,'shots':str(OUT)},default=list,indent=2))
print(f'{sum(res)}/{len(res)} passed · evidence {job}')
sys.exit(0 if res and all(res) else 1)
