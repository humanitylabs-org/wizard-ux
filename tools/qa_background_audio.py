#!/usr/bin/env python3
"""Thales-only real cached-song streaming + exact shell/Music + signed preview API35 emulator QA."""
import fcntl, hashlib, http.server, json, mimetypes, os, pathlib, plistlib, re, socket, sqlite3, subprocess, sys, threading, time, urllib.parse, urllib.request
P=pathlib.Path
if not str(P.cwd()).startswith('/Volumes/ThalesMedia/'):
    raise SystemExit('Thales media worker required')
apk,shell,music,out=map(P,sys.argv[1:5]); out.mkdir(parents=True,exist_ok=True)
SDK=P('/opt/homebrew/share/android-commandlinetools'); PKG='ai.wizards.os.musicpreview'; PORT=5704; ADB=str(SDK/'platform-tools/adb'); SERIAL=f'emulator-{PORT}'; HTTP=18794; CDP=9354
ENV=os.environ.copy();ENV.update(JAVA_HOME='/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',ANDROID_HOME=str(SDK),ANDROID_SDK_ROOT=str(SDK),ANDROID_AVD_HOME=str(out/'avd'));ENV['PATH']='/opt/homebrew/bin:'+ENV['JAVA_HOME']+'/bin:'+ENV['PATH'];(out/'avd').mkdir(exist_ok=True)
def sh(*args,stdin=None,timeout=120):
    r=subprocess.run(list(map(str,args)),input=stdin,text=True,capture_output=True,env=ENV,timeout=timeout)
    if r.returncode: raise RuntimeError('command failed '+str(args)[:180]+'\n'+r.stderr[-2000:]+'\n'+r.stdout[-2000:])
    return r.stdout
def sx(cmd): return sh(ADB,'-s',SERIAL,'shell',cmd)
state={'tracks':[], 'events':[], 'bytes':0,'gets':[], 'refills':0,'batches':{},'next':3,'down':False}
LOCK=threading.Lock(); em=None;server=None
with P('/Volumes/ThalesMedia/AndroidBuilds/worker.lock').open('a') as worker:
    fcntl.flock(worker,fcntl.LOCK_EX)
    try:
        cache=P.home()/'.wizard-home/music-hub/cache'; con=sqlite3.connect(P.home()/'.wizard-home/music-hub/hub.sqlite3')
        envfile=P.home()/'.wizard-home/music-hub/hub.env'; tok=''
        for l in envfile.read_text().splitlines():
            if l.startswith('WIZARD_MUSIC_HUB_TOKEN='): tok=l.split('=',1)[1].strip().strip('"\'')
        clips=out/'clips';clips.mkdir(exist_ok=True)
        for file in cache.iterdir():
            if file.suffix not in ['.m4a','.webm','.opus','.mp3'] or not re.fullmatch('[A-Za-z0-9_-]{11}',file.stem):continue
            row=con.execute('select title,artist,album from tracks where id=?',('yt:'+file.stem,)).fetchone()
            if not row: continue
            target=clips/(file.stem+'.mp3')
            try: sh('ffmpeg','-v','error','-y','-i',file,'-t','12','-ar','44100','-ac','2','-b:a','96k',target)
            except Exception:continue
            art=clips/(file.stem+'.jpg')
            try:
                req=urllib.request.Request('http://127.0.0.1:8793/art/yt:'+file.stem,headers={'Authorization':'Bearer '+tok});art.write_bytes(urllib.request.urlopen(req,timeout=12).read())
            except Exception:pass
            state['tracks'].append({'id':'yt:'+file.stem,'title':row[0],'artist':row[1],'album':row[2],'durationMs':12000,'source':'youtube','stream':'/wizard-music/stream/yt:'+file.stem,'art':'/wizard-music/art/yt:'+file.stem})
            if len(state['tracks'])>=14:break
        assert len(state['tracks'])>=8, 'Need distinct actual cached songs'
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self,format,*args):pass
            def body(self,status,data,ct='application/json',extra=None):
                raw=json.dumps(data).encode() if ct=='application/json' else data
                self.send_response(status);self.send_header('Content-Type',ct);self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store')
                for k,v in (extra or {}).items():self.send_header(k,v)
                self.end_headers()
                if self.command!='HEAD':
                    try:self.wfile.write(raw)
                    except (BrokenPipeError,ConnectionResetError):pass
            def do_HEAD(self):self.do_GET()
            def do_GET(self):
                u=urllib.parse.urlparse(self.path);p=u.path;q=urllib.parse.parse_qs(u.query)
                if p=='/qa/stats':return self.body(200,state)
                if p=='/qa/sx':
                    cmd=q.get('cmd',[''])[0]
                    if not cmd.startswith(('input keyevent ','wm dismiss-keyguard','am start ','am broadcast ','dumpsys ','pidof ','cmd media_session ')):return self.body(400,{'error':'command'})
                    return self.body(200,{'result':sx(cmd)})
                if p.startswith('/wizard-music/stream/') or p.startswith('/wizard-music/art/'):
                    tid=p.rsplit(':',1)[-1];kind='stream' if '/stream/' in p else 'art';f=clips/(tid+('.mp3' if kind=='stream' else '.jpg'))
                    if not f.exists():return self.body(404,{})
                    raw=f.read_bytes();total=len(raw);start=0;end=total-1;status=200;hdr={'Accept-Ranges':'bytes'}
                    r=re.match(r'bytes=(\d+)-(\d*)',self.headers.get('Range',''))
                    if r:start=int(r[1]);end=min(total-1,int(r[2]) if r[2] else total-1);status=206;hdr['Content-Range']=f'bytes {start}-{end}/{total}'
                    if kind=='stream':
                        with LOCK:state['bytes']+=max(0,end-start+1);state['gets'].append({'id':tid,'range':self.headers.get('Range'),'cookie':bool(self.headers.get('Cookie'))})
                    return self.body(status,raw[start:end+1],'audio/mpeg' if kind=='stream' else 'image/jpeg',hdr)
                if p=='/wizard-music/api/home':return self.body(200,{'sources':[],'vibes':[],'liked':[],'recent':state['tracks'][:3],'library':state['tracks'][:3]})
                if p=='/wizard-music/api/search':return self.body(200,{'tracks':state['tracks'][:3]})
                if p.startswith('/wizard-music/api/station/'):
                    with LOCK:
                        if state['down']:return self.body(503,{'error':'offline'})
                        key=q.get('requestId',[''])[0]
                        if key not in state['batches']:
                            a=state['next'];batch=state['tracks'][a:a+6];state['next']+=len(batch);state['refills']+=1;state['batches'][key]=batch
                        return self.body(200,{'tracks':state['batches'][key]})
                if p=='/wizard/v1/apps':return self.body(200,{'apps':[]})
                if p=='/reports/wizard-os/latest.json':return self.body(200,{'app':'ai.wizards.os','versionCode':0,'version':'0','bytes':1,'sha256':'0'*64,'url':'no.apk','signer':'0'*64})
                if p.startswith(('/wizard/','/v1/','/hermes/','/meetings/')):return self.body(200,{'data':[],'sessions':[],'threads':[],'ok':True})
                if p=='/':return self.body(200,b'<a href="/wizard-os-home/?open=wizard-music">Open Music</a>','text/html')
                if p.startswith('/wizard-os-home/'):
                    rel=p[len('/wizard-os-home/'):] or 'index.html';root=shell/'web'
                elif p.startswith('/wizard-music/'):
                    rel=p[len('/wizard-music/'):] or 'index.html';root=music/'dist'
                else:return self.body(404,{})
                f=(root/rel).resolve()
                if not f.is_relative_to(root.resolve()) or not f.is_file():return self.body(404,{})
                return self.body(200,f.read_bytes(),mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
            def do_POST(self):
                p=urllib.parse.urlparse(self.path).path;data=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or b'{}')
                if p in ['/wizard-music/api/station','/wizard-music/api/play']:
                    return self.body(200,{'kind':'station','heard':state['tracks'][0]['title'],'station':{'id':'a'*16,'title':'Real-song background QA','more':'/wizard-music/api/station/'+('a'*16)+'/more'},'tracks':state['tracks'][:3]})
                if p=='/wizard-music/api/feedback':
                    with LOCK:state['events'].append(data)
                    t=next((t for t in state['tracks'] if t['id']==data.get('id')),state['tracks'][0]);return self.body(200,{'ok':True,'track':t,'drop':[],'learned':None})
                if p=='/qa/offline':state['down']=bool(data.get('down'));return self.body(200,{'ok':True})
                return self.body(403,{'error':'isolated_qa'})
        server=http.server.ThreadingHTTPServer(('127.0.0.1',HTTP),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
        sh(SDK/'cmdline-tools/latest/bin/avdmanager','create','avd','-n','q','-k','system-images;android-35;google_apis;arm64-v8a','-d','pixel_7','-p',out/'dev',stdin='no\n')
        em=subprocess.Popen([str(SDK/'emulator/emulator'),'-avd','q','-port',str(PORT),'-no-window','-no-snapshot','-no-audio','-gpu','swiftshader_indirect'],env=ENV,stdout=(out/'em.log').open('w'),stderr=subprocess.STDOUT)
        for _ in range(120):
            try:
                if sx('getprop sys.boot_completed').strip()=='1':break
            except Exception:pass
            time.sleep(3)
        sx('input keyevent KEYCODE_WAKEUP');sx('wm dismiss-keyguard');sh(ADB,'-s',SERIAL,'install',apk)
        (out/'qaorigin').write_text('http://10.0.2.2:'+str(HTTP));sh(ADB,'-s',SERIAL,'push',out/'qaorigin','/data/local/tmp/qaorigin');sx(f'run-as {PKG} mkdir -p files');sx(f'run-as {PKG} cp /data/local/tmp/qaorigin files/qa_origin.txt')
        sx(f'pm grant {PKG} android.permission.POST_NOTIFICATIONS');sx(f'pm grant {PKG} android.permission.RECORD_AUDIO');sx(f'am start -W -n {PKG}/ai.wizards.os.MainActivity');time.sleep(5)
        pid=sx('pidof '+PKG).strip();sh(ADB,'-s',SERIAL,'forward',f'tcp:{CDP}',f'localabstract:webview_devtools_remote_{pid}')
        r=subprocess.run(['/opt/homebrew/bin/node',str(shell/'tools/qa-background-audio.cjs'),str(CDP),str(HTTP),str(out)],env=ENV,text=True,capture_output=True,timeout=450)
        (out/'qa.log').write_text(r.stdout+'\n'+r.stderr);print(r.stdout,flush=True);print(r.stderr,flush=True)
        log=sx('logcat -d -b crash');(out/'crash.log').write_text(log);(out/'service.log').write_text(sx('logcat -d -s WizardAudio:*'))
        (out/'http-state.json').write_text(json.dumps(state,indent=2))
        receipt={'host':socket.gethostname(),'apk_sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'shell_sha':sh('git','-C',shell,'rev-parse','HEAD').strip() if (shell/'.git').exists() else shell.name,'music_source':music.name,'qa_exit':r.returncode,'crashes':'FATAL EXCEPTION' in log,'real_tracks':len(state['tracks']),'stream_bytes':state['bytes'],'refills':state['refills'],'out':str(out)}
        (out/'remote-receipt.json').write_text(json.dumps(receipt,indent=2))
        if r.returncode or receipt['crashes']:raise SystemExit(1)
    finally:
        if em:
            try:sh(ADB,'-s',SERIAL,'emu','kill');em.wait(timeout=40)
            except Exception:em.terminate()
        if server:server.shutdown()
