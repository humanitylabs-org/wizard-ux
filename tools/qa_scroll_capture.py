#!/usr/bin/env python3
"""Thales-only OS-initiated long screenshot spike; no private server/device.
Usage: qa_scroll_capture.py DEBUG_APK OUT
API35 SystemUI initiates discovery and capture. Fixture is explicitly synthetic,
using the same overflow-hidden / nested .ch-msgs and .ch-scroll arrangement.
"""
import fcntl, hashlib, http.server, json, pathlib, re, sys, threading, time, traceback
from qa_aa_lib import Emu, Page, BASE, ADB, wait
P=pathlib.Path
APK=P(sys.argv[1]); OUT=P(sys.argv[2]); OUT.mkdir(parents=True,exist_ok=True)
PKG='ai.wizards.os.qa'; PORT=19064; ORIGIN=f'http://localhost:{PORT}'
HTML='''<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scroll capture fixture</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#10202d;color:#fff;font:18px sans-serif}*{box-sizing:border-box}
[data-chats]{height:100%;display:flex;flex-direction:column}.ch-head,.ch-compose{height:64px;flex:none;background:#802040;padding:15px}
.ch-msgs,.ch-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}.row{height:120px;padding:16px;border-top:3px solid #fff;background:#183747}.row:nth-child(even){background:#28516a}.stripe{height:8px;background:#00ff80}</style>
<div data-chats="synthetic" data-draft-for="direct:fixture-a"><div class="ch-head">HEADER — appears outside capture</div><div class="ch-msgs"></div><div class="ch-compose">COMPOSER — outside capture</div></div>
<script>function seed(kind='ch-msgs',n=40){document.querySelector('.ch-msgs,.ch-scroll').className=kind;document.querySelector('.'+kind).innerHTML=Array.from({length:n},(_,i)=>`<div class="row"><b>ROW ${String(i).padStart(2,'0')}</b><p>Native composited text • band ${i}</p></div>`).join('');}seed();window.__wosNativeBack=()=>true;</script>'''
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
def capture(name,kind,top):
 pg.ev(f"seed({json.dumps(kind)});document.querySelector('.{kind}').scrollTop={top}");time.sleep(.8)
 before=pg.ev(f"document.querySelector('.{kind}').scrollTop")
 em.sx('input keyevent KEYCODE_SYSRQ');time.sleep(.8)
 # SystemUI screenshot chip is transient; avoid a slow accessibility-tree dump before tapping.
 shot(name+'-chip')
 xml=em.ui();(OUT/(name+'-chip.xml')).write_text(xml)
 found=em.tap_text('^Capture more$',xml)
 check(name+' OS offers Capture more',bool(found),xml[-500:])
 if not found:return
 time.sleep(7);shot(name+'-editor')
 xml=em.ui();(OUT/(name+'-editor.xml')).write_text(xml)
 check(name+' long screenshot editor visible','Save' in xml,em.top())
 check(name+' original scroll restored',pg.ev(f"document.querySelector('.{kind}').scrollTop")==before,pg.ev(f"document.querySelector('.{kind}').scrollTop"))
 em.tap_text('^Save$',xml);time.sleep(2)
 files=em.sx('find /sdcard/Pictures/Screenshots -type f').strip().splitlines()
 if files:
  path=files[-1];em.sh(ADB,'-s',em.S,'pull',path,OUT/(name+'-saved.png'))
  check(name+' saved OS image', (OUT/(name+'-saved.png')).exists(),path)
 dismiss()
with (BASE/'worker.lock').open('a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 try:
  em.boot();check('install exact APK', 'Success' in em.sh(ADB,'-s',em.S,'install',APK))
  em.sh(ADB,'-s',em.S,'reverse',f'tcp:{PORT}',f'tcp:{PORT}')
  em.runas(f'mkdir -p files && echo {ORIGIN}/wizard-os-home/ > files/qa_home.txt && echo {ORIGIN} > files/qa_origin.txt')
  em.sx('settings put secure user_setup_complete 1');em.sx('logcat -c')
  em.sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity');time.sleep(3)
  pg=Page(em,9424)
  capture('thread-top','ch-msgs',0)
  capture('thread-middle','ch-msgs',1700)
  capture('list-bottom','ch-scroll',99999)
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
