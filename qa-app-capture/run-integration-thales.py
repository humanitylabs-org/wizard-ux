#!/usr/bin/env python3
"""Exact integration acceptance, ONLY Thales and under worker.lock (caller lockf).
Uses existing suites plus their seam additions; never publishes or contacts prod backends.
"""
import hashlib, http.server, json, os, pathlib, socketserver, subprocess, sys, threading
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from tools.qa_paths import work_root, required_work_root, android_sdk, java_home
root=pathlib.Path(__file__).resolve().parent.parent
evidence=pathlib.Path(os.environ['INTEGRATION_EVIDENCE']);evidence.mkdir(parents=True,exist_ok=True)
required_work_root()
env=os.environ.copy();env.update(QA_WEB_DIR=str(root),QA_BLOCK_WRITES='1',QA_CHROME=env['CHROMIUM'])
receipt={'hostname':subprocess.check_output(['hostname'],text=True).strip(),'sourceSHA':env['SOURCE_SHA'],'sourceTree':env['SOURCE_TREE'],'commands':[],'productionWrites':0,'deployed':False}
files=['web/core/app-capture.js','web/core/app-client.js','web/core/app-services.js','web/device.js','web/app.js','web/desktop/desktop.js','qa-app-capture/integration.cjs','tools/qa_shared_capture_native.py','adoptions/mizel-live/mizel-live.patch','adoptions/mizel-live/manifest.json','android/app/src/main/java/ai/wizards/os/recording/RecorderService.java','android/app/src/main/java/ai/wizards/os/mizel/MeetingRecorderService.java','android/app/src/main/java/ai/wizards/os/device/DeviceBridge.java']
receipt['sourceHashes']={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in files}
manifest=json.loads((root/'adoptions/mizel-live/manifest.json').read_text())
for name,expected in manifest['candidate_files'].items():
 actual=hashlib.sha256((pathlib.Path(env['MIZEL_WEB']).parent/name).read_bytes()).hexdigest()
 if actual!=expected:raise SystemExit('Candidate drift: '+name)
receipt['mizelBase']=manifest['base_git_head'];receipt['mizelPatchSHA256']=manifest['patch_sha256']
def save(): (evidence/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
def run(name,args,extra=None,cwd=root):
 out=evidence/name;out.mkdir(exist_ok=True);e=env.copy();e.update(QA_OUT=str(out),QA_SHOTS=str(out/'shots'),CAPTURE_EVIDENCE=str(out));e.update(extra or {})
 print('RUN',name,args,flush=True)
 with (out/'run.log').open('w') as log:r=subprocess.run(args,cwd=cwd,env=e,stdout=log,stderr=subprocess.STDOUT)
 receipt['commands'].append({'name':name,'argv':args,'cwd':str(cwd),'exit':r.returncode,'log':str(out/'run.log')});save();print('EXIT',name,r.returncode,flush=True);return r.returncode
# All existing root shell unknown GET routes are synthetic read fixtures, not production.
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,format,*args):pass
 def do_GET(self):
  from urllib.parse import urlsplit
  url=urlsplit(self.path).path
  if url.startswith('/wizard-os-home/'):
   f=root/'web'/(url[len('/wizard-os-home/'):] or 'index.html')
   if f.is_file() and f.is_relative_to(root/'web'):
    body=f.read_bytes();self.send_response(200);self.send_header('Content-Type','application/javascript' if f.suffix=='.js' else 'text/css' if f.suffix=='.css' else 'text/html' if f.suffix=='.html' else 'application/octet-stream');self.end_headers();self.wfile.write(body);return
  body={'apps':[]} if url=='/wizard/v1/apps' else {'bootstrap':1,'settings':{},'capabilities':{},'endpoints':{}} if url=='/wizard/v1/bootstrap' else {'state':{'initializedAt':1,'threads':{}}} if url in ['/wizard/thread-seen','/wizard/thread-dispositions'] else {'model':'fixture-model','provider':'fixture','providers':[{'slug':'fixture','name':'Synthetic fixture','is_current':True,'authenticated':True,'models':['fixture-model']}]} if url=='/wizard/hermes/api/model/options' else {}
  self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(body).encode())
 def do_POST(self):self.send_error(405)
 do_PATCH=do_POST;do_PUT=do_POST;do_DELETE=do_POST
server=socketserver.ThreadingTCPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
base='http://127.0.0.1:'+str(server.server_address[1])+'/wizard-os-home/'
try:
 run('capture-and-mizel',['node','qa-app-capture/run.cjs'])
 run('host',['node','-r','./qa-thales-loader.cjs','qa-app-services.cjs'],{'QA_BLOCK_WRITES':'0'}) # Self-contained server; actual SW/cache migration must not be mocked/blocked.
 run('share-ab',['node','-r','./qa-thales-loader.cjs','qa-share-receipt-ab.cjs'],{'QA_BASELINE':env['SHARE_BASELINE']})
 run('device',['node','-r','./qa-thales-loader.cjs','qa-device.cjs'])
 run('chats-return-position',['node','-r','./qa-thales-loader.cjs','qa-chats-return-position.cjs',base])
 run('chats-return-position-full',['node','-r','./qa-thales-loader.cjs','qa-chats-return-position.cjs',base],{'QA_FULL':'1'})
 # Native sources unchanged, exact integration-built debug APK, test-only package on an isolated API35 guest.
 sdk=str(android_sdk());jdk=java_home()
 nativeEnv={'JAVA_HOME':jdk,'ANDROID_HOME':sdk,'ANDROID_SDK_ROOT':sdk,'PATH':jdk+'/bin:'+env.get('PATH','')}
 (root/'android/local.properties').write_text('sdk.dir='+sdk+'\n')
 build=run('native-build',['./gradlew','--no-daemon',':app:assembleSideloadDebug',':app:testSideloadDebugUnitTest'],nativeEnv,root/'android')
 if not build:
  apk=root/'android/app/build/outputs/apk/sideload/debug/app-sideload-debug.apk';receipt['apkSHA256']=hashlib.sha256(apk.read_bytes()).hexdigest();save()
  run('native',['python3','tools/qa_mizel.py',str(apk),'ai.wizards.os.qa','20',str(evidence/'native/job')],{'QA_SHARED_CAPTURE_ONLY':'1','QA_PCM_ONLY':'1','QA_EXTERNAL_LOCK':'1'})
finally:server.shutdown();save()
raise SystemExit(1 if any(c['exit'] for c in receipt['commands']) else 0)
