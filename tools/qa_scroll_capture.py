#!/usr/bin/env python3
"""Thales-only OS-initiated long screenshot spike; no private server/device.
Usage: qa_scroll_capture.py DEBUG_APK OUT
API35 SystemUI initiates discovery and capture. Fixture is explicitly synthetic,
using the same overflow-hidden / nested .ch-msgs and .ch-scroll arrangement.
"""
import base64, fcntl, hashlib, http.server, json, os, pathlib, re, sys, threading, time, traceback, xml.etree.ElementTree as ET
from qa_aa_lib import Emu, Page, BASE, ADB, wait
P=pathlib.Path
APK=P(sys.argv[1]); OUT=P(sys.argv[2]); OUT.mkdir(parents=True,exist_ok=True)
PKG='ai.wizards.os.qa'; PORT=19064; ORIGIN=f'http://localhost:{PORT}'
HTML='''<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scroll capture fixture</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#10202d;color:#fff;font:18px sans-serif}*{box-sizing:border-box}
[data-chats]{height:100%;display:flex;flex-direction:column}.ch-head,.ch-compose{height:64px;flex:none;background:#802040;padding:15px}
.ch-msgs,.ch-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}.row{height:120px;padding:16px;border-top:3px solid #fff;background:#183747}.row:nth-child(even){background:#28516a}.stripe{height:8px;background:#00ff80}body.overlap .ch-head,body.overlap .ch-compose{position:fixed;left:0;right:0;z-index:10}body.overlap .ch-head{top:0;height:60px}body.overlap .ch-compose{bottom:0;height:80px}</style>
<div data-chats="synthetic" data-draft-for="direct:fixture-a"><div class="ch-head">HEADER — appears outside capture</div><div class="ch-msgs"></div><div class="ch-compose">COMPOSER — outside capture</div></div>
<script>function seed(kind='ch-msgs',n=40){document.querySelector('.ch-msgs,.ch-scroll').className=kind;document.querySelector('.'+kind).innerHTML=Array.from({length:n},(_,i)=>`<div class="row" style="background:rgb(${30+i*4},60,90)"><b>ROW ${String(i).padStart(2,'0')}</b><p>Native composited text • band ${i}</p></div>`).join('');}seed();window.__wosNativeBack=()=>true;</script>'''
class H(http.server.BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_GET(self):
  b=HTML.encode() if self.path.startswith('/wizard-os-home') else b'{}'
  self.send_response(200);self.send_header('Content-Type','text/html' if self.path.startswith('/wizard-os-home') else 'application/json');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
srv=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),H)
threading.Thread(target=srv.serve_forever,daemon=True).start()
em=Emu(OUT,5824,PKG); pg=None
receipt={'apk_sha256':hashlib.sha256(APK.read_bytes()).hexdigest(),'fixture':'synthetic nested-chat geometry; not authenticated product QA','checks':[]}
def check(name,ok,detail=None):
 receipt['checks'].append({'name':name,'ok':bool(ok),'detail':detail});print(('PASS ' if ok else 'FAIL ')+name+' '+str(detail or ''),flush=True)
def shot(name):em.shot(OUT,name)
def dismiss():
 em.sx('input keyevent KEYCODE_BACK');time.sleep(.5)
 em.sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity');time.sleep(.5)
def capture(name,kind,top,overlap=False):
 assert pg is not None
 em.sx('rm -f /sdcard/Pictures/Screenshots/*')
 pg.ev(f"document.body.classList.toggle('overlap',{str(overlap).lower()});seed({json.dumps(kind)},{14 if overlap else 40});document.querySelector('.{kind}').scrollTop={top}");time.sleep(.8)
 if overlap:
  geometry=pg.ev("(()=>{const b=__wosScrollCapture.search(),h=document.querySelector('.ch-head').getBoundingClientRect(),c=document.querySelector('.ch-compose').getBoundingClientRect();return {b,header:h.bottom,composer:c.top};})()")
  check(name+' capture band excludes overlapping header/composer',bool(geometry['b']) and geometry['b']['y']>=geometry['header'] and geometry['b']['y']+geometry['b']['h']<=geometry['composer'],geometry)
 before=pg.ev(f"document.querySelector('.{kind}').scrollTop")
 em.sx('input keyevent KEYCODE_SYSRQ');time.sleep(.8)
 # SystemUI screenshot chip is transient; avoid a slow accessibility-tree dump before tapping.
 shot(name+'-chip')
 xml=em.ui();(OUT/(name+'-chip.xml')).write_text(xml)
 found=em.tap_text('^Capture more$',xml)
 check(name+' OS offers Capture more',bool(found),xml[-500:])
 if not found:
  diagnostic=pg.ev("JSON.stringify({capture:window.__wosScrollCapture?.search(),vw:innerWidth,dpr:devicePixelRatio,scale:visualViewport.scale,styles:[...document.querySelectorAll('html,body,[data-chats],.ch-msgs,.ch-scroll')].map(e=>{const s=getComputedStyle(e);return {tag:e.tagName,cls:e.className,zoom:s.zoom,scale:s.scale,rotate:s.rotate,perspective:s.perspective,transform:s.transform};})})")
  print('DISCOVERY_DIAGNOSTIC '+str(diagnostic),flush=True)
  dismiss();return
 time.sleep(7);shot(name+'-editor')
 xml=em.ui();(OUT/(name+'-editor.xml')).write_text(xml)
 check(name+' long screenshot editor visible','Save' in xml,em.top())
 check(name+' original scroll restored',pg.ev(f"document.querySelector('.{kind}').scrollTop")==before,pg.ev(f"document.querySelector('.{kind}').scrollTop"))
 # Android initially selects only the original viewport, even when a long image
 # was captured. Expand its actual accessibility-labelled crop handles first.
 for label in ['Top boundary','Bottom boundary']:
  tree=ET.fromstring(xml)
  handle=next(x for x in tree.iter('node') if x.get('content-desc','').startswith(label))
  crop=next(x for x in tree.iter('node') if x.get('resource-id','').endswith('/crop_view'))
  h=list(map(int,re.findall(r'\d+',handle.get('bounds'))));c=list(map(int,re.findall(r'\d+',crop.get('bounds'))))
  x=(h[0]+h[2])//2;y=(h[1]+h[3])//2;target=c[1]+2 if label.startswith('Top') else c[3]-2
  em.sx(f'input swipe {x} {y} {x} {target} 600');time.sleep(.5);xml=em.ui()
 check(name+' entire captured image selected','Top boundary 0 percent' in xml and 'Bottom boundary 100 percent' in xml)
 shot(name+'-expanded');em.tap_text('^Save$',xml);time.sleep(2)
 files=em.sx('find /sdcard/Pictures/Screenshots -type f').strip().splitlines()
 if files:
  path=files[-1];em.sh(ADB,'-s',em.S,'pull',path,OUT/(name+'-saved.png'))
  check(name+' saved OS image', (OUT/(name+'-saved.png')).exists(),path)
  encoded=base64.b64encode((OUT/(name+'-saved.png')).read_bytes()).decode()
  pixels=pg.ev("""(async()=>{const im=new Image();im.src='data:image/png;base64,"""+encoded+"""';await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);const a=ctx.getImageData(Math.floor(c.width*.95),0,1,c.height).data;let rows=[],last=-1;for(let y=0;y<c.height;y++){const k=y*4;if(a[k+1]===60&&a[k+2]===90&&a[k]>=30&&(a[k]-30)%4===0){const row=(a[k]-30)/4;if(row!==last){rows.push({row,y});last=row;}}}return {width:c.width,height:c.height,rows,viewport:innerHeight*devicePixelRatio};})()""")
  check(name+' saved image spans multiple viewports',pixels['height']>pixels['viewport']*1.5,pixels)
  ids=[x['row'] for x in pixels['rows']]
  check(name+' actual pixels encode consecutive nonduplicated rows',len(ids)>=8 and all(b==a+1 for a,b in zip(ids,ids[1:])),ids)
  steps=[b['y']-a['y'] for a,b in zip(pixels['rows'][1:],pixels['rows'][2:])]
  check(name+' no missing pixel bands at tile joins',bool(steps) and max(steps)-min(steps)<=2,steps)
  if overlap:check(name+' stitched pixels include first and last fixture messages',bool(ids) and ids[0]==0 and ids[-1]==13,ids)
  (OUT/(name+'-pixels.json')).write_text(json.dumps(pixels,indent=2))
 dismiss()
_inherited=os.environ.get('WIZARD_HEAVY_LOCK_FD')
_lock=os.fdopen(int(_inherited),'a',closefd=False) if _inherited else (BASE/'worker.lock').open('a')
with _lock as lock:
 if _inherited:
  want,have=(BASE/'worker.lock').stat(),os.fstat(lock.fileno())
  if (want.st_dev,want.st_ino)!=(have.st_dev,have.st_ino):raise RuntimeError('inherited lock identity mismatch')
 fcntl.flock(lock,fcntl.LOCK_EX|(fcntl.LOCK_NB if _inherited else 0))
 try:
  em.boot();check('install exact APK', 'Success' in em.sh(ADB,'-s',em.S,'install',APK))
  em.sh(ADB,'-s',em.S,'reverse',f'tcp:{PORT}',f'tcp:{PORT}')
  em.runas(f'mkdir -p files && echo {ORIGIN} > files/qa_home.txt && echo {ORIGIN} > files/qa_origin.txt')
  em.sx('settings put secure user_setup_complete 1');em.sx('logcat -c')
  em.sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity');time.sleep(3)
  pg=Page(em,9424)
  capture('thread-top','ch-msgs',0)
  capture('thread-middle','ch-msgs',1700)
  capture('list-bottom','ch-scroll',99999)
  capture('overlapping-chrome','ch-msgs',0,overlap=True)
  pg.ev("document.body.classList.remove('overlap')")
  pg.ev("seed('ch-msgs',2)");time.sleep(.5)
  em.sx('input keyevent KEYCODE_SYSRQ');time.sleep(.8);xml=em.ui()
  check('short content not offered', 'Capture more' not in xml,xml[-500:]);dismiss()
  em.sx('input keyevent KEYCODE_BACK');time.sleep(.5);check('Back never exits fixture root',em.front(),em.top())
  log=em.sx('logcat -d');(OUT/'logcat.txt').write_text(log)
  check('no app crash','FATAL EXCEPTION' not in log)
 except Exception as e:
  receipt['error']=str(e);traceback.print_exc();shot('failure')
 finally:
  if pg:pg.close()
  em.kill();srv.shutdown()
  receipt['status']='ok' if not receipt.get('error') and all(x['ok'] for x in receipt['checks']) else 'failed'
  (OUT/'receipt.json').write_text(json.dumps(receipt,indent=2))
print(json.dumps(receipt,indent=2));sys.exit(0 if receipt['status']=='ok' else 1)
