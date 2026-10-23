#!/usr/bin/env python3
"""Thales-only API35 SystemUI capture of the real shell's document-scrolling thread.
Usage: qa_scroll_capture.py DEBUG_APK OUT
No custom capture callback or JS capture entry points. All API traffic is synthetic;
unsafe HTTP methods are blocked by the fixture server, never sent to Agent Service.
"""
import base64, fcntl, hashlib, json, os, pathlib, re, sys, time, traceback, xml.etree.ElementTree as ET
from qa_aa_lib import Emu, Page, BASE, ADB, wait
from qa_scroll_fixture import serve, DECORATE
P=pathlib.Path
APK=P(sys.argv[1]); OUT=P(sys.argv[2]); OUT.mkdir(parents=True,exist_ok=True)
PKG='ai.wizards.os.qa'; PORT=19064; ORIGIN=f'http://localhost:{PORT}'
srv=serve(PORT)
em=Emu(OUT,5824,PKG); pg=None
receipt={'apk_sha256':hashlib.sha256(APK.read_bytes()).hexdigest(),'fixture':'real shell thread + synthetic read-only API + deterministic message bands','capture':'stock Android WebViewCaptureHelper, initiated by SystemUI','checks':[]}
def check(name,ok,detail=None):
 receipt['checks'].append({'name':name,'ok':bool(ok),'detail':detail});print(('PASS ' if ok else 'FAIL ')+name+' '+str(detail or ''),flush=True)
def shot(name):em.shot(OUT,name)
def dismiss():
 em.sx('input keyevent KEYCODE_BACK');time.sleep(.5)
 em.sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity');time.sleep(.5)
def geometry():
 return pg.ev("(()=>{const r=s=>document.querySelector('.wos-doc-thread '+s).getBoundingClientRect().toJSON();return {top:scrollY,height:document.scrollingElement.scrollHeight,vh:innerHeight,head:r('.ch-head'),composer:r('.ch-compose'),rows:[...document.querySelectorAll('.wos-doc-thread .msg.a')].map(n=>n.textContent),custom:typeof window.__wosScrollCapture};})()")
def open_thread(sid):
 pg.ev(f'__wos.goDesk(1);__wos.openWizardThread({json.dumps(sid)})')
 assert wait(lambda:pg.ev("(()=>{const w=Object.values(__wos.wins).find(w=>w.app==='chats'&&w.thread==="+json.dumps(sid)+");return !!w&&__wos.chats.ch(w.id).loadedFor===w.thread&&!!document.querySelector('.wos-doc-thread .msg.a');})()"),20),'real thread messages'
 time.sleep(.6);pg.ev(DECORATE);time.sleep(.8)
def capture(name,top,attempt=0):
 first_check=len(receipt['checks'])
 em.sx('rm -f /sdcard/Pictures/Screenshots/*')
 # The offline emulator cannot reach the update feed; its error banner floats over the first fixture row.
 pg.ev("for(const e of document.querySelectorAll('body *'))if(/update feed/i.test(e.textContent)&&getComputedStyle(e).position==='fixed')e.style.display='none'")
 pg.ev(f'window.scrollTo(0,{top})');time.sleep(.8)
 g=geometry();before=g['top']
 check(name+' real header and composer visible',g['head']['top']>=0 and g['head']['bottom']<g['composer']['top'] and g['composer']['bottom']<=g['vh']+1,g)
 check(name+' real first/last fixture messages mounted',len(g['rows'])==14 and 'ROW 00' in g['rows'][0] and 'ROW 13' in g['rows'][-1],g['rows'])
 check(name+' custom capture absent',g['custom']=='undefined')
 em.sx('logcat -c')
 em.sx('input keyevent KEYCODE_SYSRQ');time.sleep(.8);shot(name+'-chip')
 xml=em.ui();(OUT/(name+'-chip.xml')).write_text(xml)
 found=em.tap_text('^Capture more$',xml)
 check(name+' OS offers Capture more',bool(found),xml[-500:])
 if not found: dismiss();return
 time.sleep(7);shot(name+'-editor');xml=em.ui();(OUT/(name+'-editor.xml')).write_text(xml)
 (OUT/(name+'-logcat.txt')).write_text(em.sx('logcat -d -v time'))
 try: (OUT/(name+'-page.json')).write_text(json.dumps(pg.ev("({href:location.href,nav:performance.getEntriesByType('navigation').map(n=>n.type),age:performance.now(),thread:!!document.querySelector('[data-chats] .ch-msgs'),scrollY})")))
 except Exception as e: (OUT/(name+'-page.json')).write_text(repr(e))
 log=(OUT/(name+'-logcat.txt')).read_text()
 if 'Save' not in xml and attempt==0 and 'NullPointerException' in log and 'CancellationSignal' in log and 'ScrollCapture' in log and all(c['ok'] for c in receipt['checks'][first_check:]):
  # AOSP ScrollCaptureConnection races its cancellation field between the binder and UI threads
  # (platform bug, outside the app; widened by the slow emulator). SystemUI aborts that one session.
  receipt.setdefault('platform_race_retries',[]).append(name)
  # Keep aborted-attempt evidence separate so the chain still receives exactly 31 acceptance checks.
  receipt.setdefault('platform_race_attempts',[]).append({'name':name,'checks':receipt['checks'][first_check:]})
  del receipt['checks'][first_check:]
  print('NOTE '+name+' AOSP ScrollCaptureConnection cancellation race; retrying once',flush=True)
  dismiss();open_thread('qa_doc_0')
  return capture(name,top,1)
 check(name+' long screenshot editor visible','Save' in xml,em.top())
 restored=pg.ev('scrollY')
 check(name+' original document scroll restored',abs(restored-before)<=1,{'before':before,'after':restored})
 for _ in range(3):
  if 'Top boundary 0 percent' in xml and 'Bottom boundary 100 percent' in xml: break
  for label in ['Top boundary','Bottom boundary']:
   if label+(' 0 percent' if label.startswith('Top') else ' 100 percent') in xml: continue
   tree=ET.fromstring(xml)
   handle=next(x for x in tree.iter('node') if x.get('content-desc','').startswith(label))
   crop=next(x for x in tree.iter('node') if x.get('resource-id','').endswith('/crop_view'))
   h=list(map(int,re.findall(r'\d+',handle.get('bounds'))));c=list(map(int,re.findall(r'\d+',crop.get('bounds'))))
   x=(h[0]+h[2])//2;y=(h[1]+h[3])//2;target=c[1]+2 if label.startswith('Top') else c[3]-2
   em.sx(f'input swipe {x} {y} {x} {target} 600');time.sleep(1.2);xml=em.ui()
 check(name+' entire captured image selected','Top boundary 0 percent' in xml and 'Bottom boundary 100 percent' in xml)
 shot(name+'-expanded');em.tap_text('^Save$',xml);time.sleep(2)
 files=em.sx('find /sdcard/Pictures/Screenshots -type f').strip().splitlines()
 saved=OUT/(name+'-saved.png')
 if files:em.sh(ADB,'-s',em.S,'pull',files[-1],saved)
 check(name+' saved OS image',saved.exists())
 if saved.exists():
  encoded=base64.b64encode(saved.read_bytes()).decode()
  pixels=pg.ev("""(async()=>{const im=new Image();im.src='data:image/png;base64,"""+encoded+"""';await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);const a=ctx.getImageData(Math.floor(c.width*.95),0,1,c.height).data;let rows=[],last=-1;for(let y=0;y<c.height;y++){const k=y*4;if(a[k+1]===60&&a[k+2]===90&&a[k]>=30&&(a[k]-30)%4===0){const row=(a[k]-30)/4;if(row!==last){rows.push({row,y});last=row;}}}return {width:c.width,height:c.height,rows,viewport:innerHeight*devicePixelRatio,expectedStep:130*devicePixelRatio};})()""")
  check(name+' saved image spans multiple viewports',pixels['height']>pixels['viewport']*1.5,pixels)
  ids=[x['row'] for x in pixels['rows']]
  check(name+' stitched image includes every first/last fixture message once',ids==list(range(14)),ids)
  steps=[b['y']-a['y'] for a,b in zip(pixels['rows'],pixels['rows'][1:])]
  check(name+' no duplicated or missing pixel bands at tile joins',len(steps)==13 and all(abs(s-pixels['expectedStep'])<=(2 if i<len(steps)-1 else 4) for i,s in enumerate(steps)),steps)
  (OUT/(name+'-pixels.json')).write_text(json.dumps(pixels,indent=2))
 dismiss()
_inherited=os.environ.get('WIZARD_HEAVY_LOCK_FD')
lock=os.fdopen(int(_inherited),'a',closefd=False) if _inherited else (BASE/'worker.lock').open('a')
with lock:
 if _inherited:
  _want,_have=(BASE/'worker.lock').stat(),os.fstat(lock.fileno());assert (_want.st_dev,_want.st_ino)==(_have.st_dev,_have.st_ino),'inherited lock mismatch'
 fcntl.flock(lock,fcntl.LOCK_EX | (fcntl.LOCK_NB if _inherited else 0))
 try:
  em.boot();check('install exact APK','Success' in em.sh(ADB,'-s',em.S,'install',APK))
  em.sh(ADB,'-s',em.S,'reverse',f'tcp:{PORT}',f'tcp:{PORT}')
  em.runas(f'mkdir -p files && echo {ORIGIN} > files/qa_home.txt && echo {ORIGIN} > files/qa_origin.txt')
  em.sx('settings put secure user_setup_complete 1');em.sx('logcat -c')
  em.sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity');time.sleep(3)
  pg=Page(em,9424)
  # Exercise the APK's real UA, never emulate the capability that gates live document scrolling.
  receipt['user_agent']=pg.ev('navigator.userAgent')
  assert 'WizardOS-Android/0.10.7' in receipt['user_agent'] and 'WizardOS-DocScroll' in receipt['user_agent'],'APK document-scroll UA missing'
  pg.call('Page.enable');pg.call('Page.addScriptToEvaluateOnNewDocument',source="localStorage.setItem('wos.coached','true');localStorage.setItem('wos.voiceTipSeen','true');")
  pg.call('Page.navigate',url=ORIGIN+'/wizard-os-home/')
  assert wait(lambda:pg.ev("!!window.__wos?.live?.session('qa_doc_0')"),20),'real shell fixture boot'
  open_thread('qa_doc_0')
  check('long real thread makes WebView document scrollable',pg.ev('document.scrollingElement.scrollHeight>innerHeight*1.5'))
  capture('thread-top',0)
  # dismiss() presses Back after Save; with the editor already closed that Back (correctly) leaves the thread.
  open_thread('qa_doc_0')
  capture('thread-middle',480)
  open_thread('qa_doc_1');pg.ev('window.scrollTo(0,0)');time.sleep(.5)
  check('short real thread has no document scroll',pg.ev('document.scrollingElement.scrollHeight<=innerHeight+1'))
  em.sx('input keyevent KEYCODE_SYSRQ');time.sleep(.8);xml=em.ui();shot('short-chip')
  check('short thread has no Capture more','Capture more' not in xml);dismiss()
  open_thread('qa_doc_0')
  for i in range(3):
   em.sx('input keyevent KEYCODE_BACK');time.sleep(.8)
   check(f'nested thread Back {i+1} keeps app',PKG in em.top(),em.top())
   if i==0:check('Back leaves document thread mode',pg.ev("!document.documentElement.classList.contains('wos-doc-scroll')"))
  check('no Android crash','FATAL EXCEPTION' not in em.sx('logcat -d -b crash'))
  assert receipt['checks'] and all(x['ok'] for x in receipt['checks']), 'scroll-capture checks failed'
  receipt['status']='ok'
 except Exception as e:
  receipt['status']='failed';receipt['error']=str(e);traceback.print_exc();shot('failure')
 finally:
  if pg:pg.close()
  em.kill();srv.shutdown();(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2))
print(json.dumps({'status':receipt['status'],'out':str(OUT),'checks':len(receipt['checks'])}));sys.exit(0 if receipt['status']=='ok' else 1)
