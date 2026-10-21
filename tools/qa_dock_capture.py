#!/usr/bin/env python3
"""Thales-only native dock / PixelCopy acceptance. Exact debug APK, isolated emulator, fake Wizard writes.
usage: qa_dock_capture.py DEBUG_APK WEB_DIR OUT_DIR
Reuses the established native-parity fake API and raw WebView CDP adapter; never reaches James's agent.
"""
import sys, pathlib, json, fcntl, subprocess, time, hashlib
P = pathlib.Path
apk, webdir, outdir = sys.argv[1:4]
# The fixture library's argv convention also has a next-APK; this suite uses no update feed.
sys.argv = [sys.argv[0], apk, apk, webdir, outdir]
source = (P(__file__).parent / 'qa_native_parity.py').read_text()
prelude = source.split('em = None\nwith (BASE')[0]
prelude = prelude.replace('PORT = 5702;', 'PORT = 5794;').replace('DEVTOOLS = 9353; FAKE = 18787', 'DEVTOOLS = 9394; FAKE = 18994')
exec(compile(prelude, 'native-parity-fixture', 'exec'), globals())
em = None
with (BASE / 'worker.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        sh(SDK / 'cmdline-tools/latest/bin/avdmanager', 'create', 'avd', '-n', 'dockcap', '-k', 'system-images;android-35;google_apis;arm64-v8a', '-d', 'pixel_7', '-p', job / 'dev', stdin='no\n')
        em = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', 'dockcap', '-port', str(PORT), '-no-window', '-no-snapshot', '-no-audio', '-gpu', 'swiftshader_indirect', '-dns-server', '10.0.2.250'], env=env, stdout=open(job / 'em.log','w'), stderr=subprocess.STDOUT)
        if not wait(lambda: sx('getprop sys.boot_completed').strip() == '1', 240, 2): raise RuntimeError('emulator boot timed out')
        for k in ('window_animation_scale','transition_animation_scale','animator_duration_scale'): sx('settings put global %s 0' % k)
        sx('settings put system screen_off_timeout 1800000'); sx('input keyevent KEYCODE_WAKEUP'); sx('wm dismiss-keyguard')
        installed = sh(ADB,'-s',S,'install','-r',APK).strip()
        check('exact debug APK installed', installed.endswith('Success'), installed)
        sh(ADB,'-s',S,'reverse','tcp:%d'%FAKE,'tcp:%d'%FAKE)
        aiff=job/'q.aiff'; aac=job/'qa_mic.aac'
        sh('say','-o',aiff,'I am testing the Wizard dock screenshot button. The recording continues while I browse.')
        sh('afconvert','-f','adts','-d','aac',aiff,aac)
        sh(ADB,'-s',S,'push',aac,'/data/local/tmp/qa_mic.aac')
        runas('mkdir -p files && echo %s > files/qa_home.txt && echo %s > files/qa_origin.txt && cp /data/local/tmp/qa_mic.aac files/qa_mic.aac'%(ORIGIN,ORIGIN))
        sx('pm grant %s android.permission.RECORD_AUDIO'%PKG);sx('pm grant %s android.permission.POST_NOTIFICATIONS'%PKG)
        sx('logcat -c');bring_front();connect()
        pg.ev("localStorage.setItem('wos.tour.v1','true');window.WosTour?.finish('qa');localStorage.setItem('wos.voiceTipSeen','true');__wos.goDesk(0,true)")
        check('native main-frame capture port available',pg.ev("typeof window.wizardScreenPort?.postMessage === 'function'"))
        check('capture is not exposed through all-frame JavascriptInterface',pg.ev("typeof window.WizardOSNative.captureScreen === 'undefined'"))
        pg.ev("""(() => {
          window.__captureReplies=[];const orig=window.__wosScreenResult;
          window.__wosScreenResult=(id,data,error)=>{__captureReplies.push({id,data,error});orig(id,data,error);};
          const main=document.createElement('div');main.id='captureGreen';Object.assign(main.style,{position:'absolute',left:'24px',top:'160px',width:'80px',height:'80px',background:'#00ff00',zIndex:40});document.getElementById('device').append(main);
          const frame=document.createElement('iframe');frame.id='captureFrame';Object.assign(frame.style,{position:'absolute',right:'24px',top:'160px',width:'80px',height:'80px',border:0,zIndex:40});
          frame.srcdoc='<body style="margin:0"><canvas width="80" height="80" id="c"></canvas><script>const x=document.getElementById("c").getContext("2d");x.fillStyle="#0050ff";x.fillRect(0,0,80,80);<\\/script>';
          const nav=document.createElement('div');nav.id='captureNav';const d=document.getElementById('dock').getBoundingClientRect();Object.assign(nav.style,{position:'absolute',left:'24px',top:(d.top-36)+'px',width:'120px',height:'30px',background:'#ffff00',zIndex:40});document.getElementById('device').append(nav);
          document.getElementById('device').append(frame);return true;
        })()""")
        time.sleep(1)
        # Same-origin hosted frame may have the port, but Android isMainFrame must reject it.
        attack='f'*32
        pg.ev("document.getElementById('captureFrame').contentWindow.wizardScreenPort?.postMessage(%s)"%json.dumps(attack));time.sleep(1)
        check('hosted frame cannot invoke native capture',pg.ev("__captureReplies.length===0"))
        pg.tap('#orbWrap');time.sleep(1)
        rid=native_id();check('orb starts a real native take',bool(rid) and voice()=='listen',(rid,voice()))
        geometry=pg.ev("(() => {const d=document.getElementById('dock').getBoundingClientRect();return ['arcCancel','arcPause','orbWrap','arcScreen','arcAttach'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {id,inDock:r.y>=d.y&&r.bottom<=d.bottom,w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});})()")
        check('native phone dock has five separated 44px controls inside bar', all(x['inDock'] and x['hit'] and x['w']>=44 and x['h']>=44 for x in geometry),geometry)
        pg.tap('#arcScreen')
        ready=wait(lambda: len(ST['uploads'])>0 and any(f.get('mime')=='image/png' for f in ST['uploads']),15,.25)
        shot('dock-recording-screenshot-attached')
        f=next((f for f in ST['uploads'] if f.get('mime')=='image/png'),None)
        check('Screenshot uploads actual native PNG bytes',bool(f) and FILES[f['id']][1].startswith(b'\x89PNG\r\n\x1a\n'),f)
        if not f:raise RuntimeError('no native screenshot upload')
        png=FILES[f['id']][1];(job/'captured.png').write_bytes(png)
        receipt['captured_png_sha256']=hashlib.sha256(png).hexdigest()
        decoded=pg.ev("""(async () => {
          const image=new Image();image.src=__captureReplies.find(x=>x.data)?.data;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const x=c.getContext('2d');x.drawImage(image,0,0);
          const sample=id=>{const r=document.getElementById(id).getBoundingClientRect();const a=x.getImageData(Math.round((r.x+r.width/2)*image.width/innerWidth),Math.round((r.y+r.height/2)*image.width/innerWidth),1,1).data;return [...a];};
          return {width:image.width,height:image.height,green:sample('captureGreen'),blue:sample('captureFrame'),nav:sample('captureNav'),orb:sample('orbWrap'),capturedCssHeight:image.height*innerWidth/image.width,dockTop:document.getElementById('dock').getBoundingClientRect().top};
        })()""")
        check('native capture includes real app pixels',decoded['green'][:3]==[0,255,0],decoded)
        check('native capture includes rendered iframe canvas pixels',decoded['blue'][:3]==[0,80,255],decoded)
        check('native screenshot keeps the app bottom navigation pixels',decoded['nav'][:3]==[255,255,0],decoded['nav'])
        check('native sampling excludes recorder orb chrome',max(decoded['orb'][:3])<80,decoded['orb'])
        check('native screenshot ends at the app boundary above dock',abs(decoded['capturedCssHeight']-decoded['dockTop'])<2,decoded)
        check('native capture is bounded to 1600px',max(decoded['width'],decoded['height'])<=1600,decoded)
        check('Screenshot leaves the same native take recording',native_id()==rid and voice()=='listen',(native_id(),voice()))
        check('screen attached indicator visible and capture UI restored',pg.ev("document.getElementById('attachCount').textContent==='1'&&!document.getElementById('device').classList.contains('capturing-screen')"))
        # Native recording must survive orb swipe navigation and Back.
        x,y=pg.ev("(()=>{const r=document.getElementById('orbWrap').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];})()")
        pg.call('Input.dispatchTouchEvent',type='touchStart',touchPoints=[{'x':x,'y':y}])
        for i in range(1,11):pg.call('Input.dispatchTouchEvent',type='touchMove',touchPoints=[{'x':x-i*12,'y':y}]);time.sleep(.016)
        pg.call('Input.dispatchTouchEvent',type='touchEnd',touchPoints=[]);time.sleep(.6)
        check('native orb swipe changes desktop and keeps the take',pg.ev('__wos.idx===1') and native_id()==rid and voice()=='listen')
        pg.tap('#arcPause');time.sleep(.3);check('Pause preserves native take',voice()=='paused' and native_id()==rid)
        sx('input keyevent KEYCODE_BACK');time.sleep(.5)
        check('Android Back keeps Wizard foregrounded and take paused',front() and voice()=='paused')
        pg.tap('#orbWrap')
        admitted=wait(lambda: any(f['id'] in r['body'].get('wizard_file_ids',[]) for r in ST['runs']),35,.5)
        check('native voice send includes the captured screenshot file ID in one request',bool(admitted),[r['body'].get('wizard_file_ids') for r in ST['runs']])
        check('fixture received one voice run, no duplicate sends',len(ST['runs'])==1,len(ST['runs']))
        pg.ev('__wos.goDesk(0,true)'); sx('input keyevent KEYCODE_BACK'); time.sleep(.3); sx('input keyevent KEYCODE_BACK'); time.sleep(.3)
        check('repeated Android Back at true root never exits Wizard',front())
        sweep();check('emulator contacted only the fake Wizard',not FOREIGN,FOREIGN)
        crash=sx('logcat -d -s AndroidRuntime:E').strip();check('no Android crash',not crash,crash)
        receipt.update(status='ok' if all(res) else 'failed',host=__import__('socket').gethostname(),source_web=str(WEB),apk_sha256=hashlib.sha256(APK.read_bytes()).hexdigest(),passed=sum(res),failed=len(res)-sum(res))
    except Exception as e:
        receipt.update(status='failed',error=str(e));print('ERROR',e,flush=True)
    finally:
        if pg:pg.close()
        if em:
            sh(ADB,'-s',S,'emu','kill');
            try:em.wait(timeout=20)
            except subprocess.TimeoutExpired:em.kill()
        srv.shutdown();(job/'receipt.json').write_text(json.dumps(receipt,indent=2))
print(json.dumps({k:receipt.get(k) for k in ['status','host','passed','failed','error','apk_sha256','captured_png_sha256']},indent=2))
sys.exit(0 if receipt.get('status')=='ok' else 1)
