#!/usr/bin/env python3
"""Thales native smoke: AppKit keyboard events in the isolated desktop preview.
Uses the existing native QA notifier. Restores defaults and leaves any prior app alone.
"""
import fcntl,json,os,pathlib,subprocess as sp,time
from tools.qa_paths import work_root
BASE=pathlib.Path(str(work_root() / 'Projects/wizard-command-w'))
APP=pathlib.Path(str(work_root() / 'Projects/wizard-desktop/new-chat-keys/qa-host/dist/Wizard.app'))
OUT=pathlib.Path(str(work_root() / 'Projects/wizard-desktop/new-chat-keys/evidence/native'));OUT.mkdir(parents=True,exist_ok=True)
DOMAIN='org.humanitylabs.wizard'
origin=os.environ.get('QA_ORIGIN', '').rstrip('/')
if not origin: raise SystemExit('QA_ORIGIN is required: select an isolated tailnet preview')
URL=origin+'/wizard-os-home/desktop.html?open=chats'
passed=[]
def run(*args,check=True):return sp.run(args,check=check,text=True,stdout=sp.PIPE,stderr=sp.PIPE)
def qa(cmd):return run('/tmp/wizard-qa-post',cmd)
def ev(js):
 p=pathlib.Path('/tmp/wizard-qa-eval.txt');p.unlink(missing_ok=True);qa('eval '+js)
 end=time.monotonic()+12
 while time.monotonic()<end:
  if p.exists() and p.stat().st_size:
   x=p.read_text()
   if x.startswith('ERROR'):raise AssertionError(x)
   return x
  time.sleep(.1)
 raise AssertionError('Native eval timed out')
def ok(c,n):
 if not c:raise AssertionError(n)
 passed.append(n);print('PASS',n,flush=True)
def chord(shift=False):
 qa('show-window');time.sleep(.2)
 qa('key-n-shift' if shift else 'key-n')
 time.sleep(.4)
lock=open(str(work_root() / 'AndroidBuilds/worker.lock'),'a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
if run('pgrep','-f','/Wizard.app/Contents/MacOS/Wizard',check=False).stdout.strip():raise SystemExit('Prior native app running; preserve it')
backup=OUT/'defaults.plist';saved=run('defaults','export',DOMAIN,str(backup),check=False).returncode==0
proc=None
try:
 for k,v in [('QAHooks','true'),('LegacyUX','false'),('voiceKeysEnabled','false')]:run('defaults','write',DOMAIN,k,'-bool',v)
 proc=sp.Popen([str(APP/'Contents/MacOS/Wizard')],stdout=(OUT/'app.log').open('w'),stderr=sp.STDOUT)
 time.sleep(2);qa('connect '+URL)
 end=time.monotonic()+50
 while time.monotonic()<end:
  try:
   if ev('!!window.__wux && !!window.__wux.live.ok')=='1':break
  except AssertionError:pass
  time.sleep(.4)
 else:raise AssertionError('Native preview did not load')
 ev("__wux.goWs(0);for(const id of [...__wux.ws[0].wins])__wux.closeWin(id);__wux.newWin({app:'chats'});__wux.openThread(__wux.live.sessions[0].id);window.__oldNative=__wux.ws[0].focus;window.__oldSid=__wux.wins[__oldNative].thread;true")
 time.sleep(.7)
 before=int(ev('Object.keys(__wux.wins).length'));chord()
 ok(int(ev('Object.keys(__wux.wins).length'))==before+1 and ev("__wux.wins[__wux.ws[0].focus].thread==='__new__'")=='1','AppKit Command-N opens a new chat in WKWebView')
 ok(ev('__wux.wins[__oldNative].thread===__oldSid')=='1','native new-chat chord preserves the previous thread')
 # The QA origin refuses writes; intercept enqueue too so no recording is retained/sent.
 ev("window.__nativeEnqueues=[];__wux.outbox.enqueue=async x=>{__nativeEnqueues.push({kind:x.kind,sid:x.sessionId||'',bytes:x.audio?.size||0});return {id:'native-qa'};};navigator.mediaDevices.getUserMedia=async()=>{const ac=new AudioContext();const dest=ac.createMediaStreamDestination();const osc=ac.createOscillator();osc.connect(dest);osc.start();ac.resume();window.__qaTone=ac;return dest.stream;};__wux.focusWin(__oldNative);true")
 chord(True)
 end=time.monotonic()+12
 while time.monotonic()<end:
  if ev("__wux.voice==='listen' && document.querySelector('#voiceText').textContent==='Listening · new chat'")=='1':break
  time.sleep(.2)
 else:raise AssertionError('Native new voice did not start')
 ok(True,'AppKit Command-Shift-N starts a new-chat voice take with an existing thread open')
 qa('snapshot '+str(OUT/'native-new-voice.png'));time.sleep(1.3)
 chord(True)
 end=time.monotonic()+12
 while time.monotonic()<end:
  if ev('__nativeEnqueues.length')=='1':break
  time.sleep(.2)
 else:raise AssertionError('Native audio not captured')
 data=json.loads(ev('JSON.stringify(__nativeEnqueues[0])'))
 ok(data['kind']=='new' and data['sid']=='' and data['bytes']>1200,'second AppKit Command-Shift-N sends audio to a new thread')
 ok(ev("__wux.voice==='idle'")=='1' and proc.poll() is None,'native Wizard remains open after voice send')
 (OUT/'receipt.json').write_text(json.dumps({'passed':passed,'url':URL,'version':'0.5.1','app':str(APP),'captured':data,'audio':'generated test tone, MediaRecorder actual capture','keyEntry':'AppKit NSApp.sendEvent/key equivalent, not DOM injection','event':json.loads(pathlib.Path('/tmp/wizard-qa-key-n.json').read_text())},indent=2))
finally:
 if proc:
  proc.terminate()
  try:proc.wait(timeout=8)
  except sp.TimeoutExpired:proc.kill();proc.wait()
 if saved:run('defaults','import',DOMAIN,str(backup))
 else:run('defaults','delete',DOMAIN,check=False)
 lock.close()
