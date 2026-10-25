#!/usr/bin/env python3
"""Exact release APK + candidate web modules, disposable trusted-HTTPS fixture.
No rebuilt APK, debug CA, run-as, provider credentials or personal device.
"""
import hashlib, http.server, json, os, pathlib, re, subprocess, threading, time, urllib.parse, xml.etree.ElementTree as ET
ROOT = pathlib.Path(__file__).resolve().parents[1]
WEB = pathlib.Path(os.environ['QA_WEB'])
OUT = pathlib.Path('audit/compat'); OUT.mkdir(parents=True, exist_ok=True)
PKG = 'ai.wizards.shell'; ACT = PKG + '/ai.wizards.shell.ShellActivity'
events = []; command = {}; serial = 0; checks = []
PAGE = '''<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><body style="background:#111;color:white;padding:80px 20px"><h1>Disposable signed APK fixture</h1><p id="status">Loading candidate modules</p><div id="settings"></div>
<script>window.WizCore={};window.WizBrand={html:'W'};window.__wos={V:{native:null},voice:'idle',toast(){},setVoice(s){this.voice=s},txHide(){},nativeResume(a){this.V.native=a.id;this.voice=a.paused?'paused':'listen';return true}};</script>
<script src="/wizard-os-home/outbox.js"></script><script src="/wizard-os-home/core/device-port.js"></script><script src="/wizard-os-home/core/device-recording.js"></script><script src="/wizard-os-home/core/settings.js"></script><script src="/wizard-os-home/core/device-orb.js"></script>
<script>
const log=o=>fetch('/log',{method:'POST',body:JSON.stringify(o)});let last=0;
const call=(m,p={},t=20000)=>WosDevicePort.call(m,p,t);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function run(c){let r;const d=WosDeviceRecording.device();
if(c.op==='status')r=await call('device.recording.status');
if(c.op==='start'){const id=d.recStart('auto');__wos.V.native=id;await wait(2000);r=await call('device.recording.status');}
if(c.op==='pause'){d.recPause(c.on);await wait(700);r=await call('device.recording.status');}
if(c.op==='cancel'){d.recCancel(c.id);__wos.V.native=null;await wait(700);r=await call('device.recording.pending');}
if(c.op==='stop'){
 await d.fetch(c.id);const f=d.fetched(c.id),p=await call('device.recording.pending');
 const it=await WosOutbox.capture(f.blob,'qa-'+c.id);await WosOutbox.transition(it.id,'held','Synthetic native fixture');
 const bytes=await new Promise((res,rej)=>{const o=indexedDB.open('wos-outbox');o.onsuccess=()=>{const q=o.result.transaction('items').objectStore('items').get(it.id);q.onsuccess=()=>{res(q.result.audio.size);o.result.close()};q.onerror=rej};o.onerror=rej});
 r={id:c.id,meta:f.meta,bytes:bytes,pendingBefore:p.some(t=>t.id===c.id),durable:it.durable};
 d.recDone(c.id);__wos.V.native=null;await wait(700);r.pendingAfter=(await call('device.recording.pending')).some(t=>t.id===c.id);
}
if(c.op==='pending')r=await call('device.recording.pending');
if(c.op==='retain'){await d.fetch(c.id);r=d.fetched(c.id).meta;__wos.V.native=null;}
if(c.op==='read')r=await call('device.recording.read',{id:c.id,offset:0}).then(()=>({unexpected:true}),e=>({error:e.message}));
if(c.op==='orb'){await WosDeviceOrb.toggle();await wait(700);r=WosDeviceOrb.state;}
if(c.op==='recovered'){await WosDeviceRecording.collect('qa');r={pending:await call('device.recording.pending'),rows:WosOutbox.recordings().map(t=>({id:t.id,bytes:t.audio.size,durable:t.durable,state:t.state}))};}
if(c.op==='iframe')r=await new Promise(res=>{const f=document.createElement('iframe');window.addEventListener('message',function h(e){if(e.source===f.contentWindow){window.removeEventListener('message',h);res(e.data);f.remove()}});f.src='/probe';document.body.append(f)});
await log({serial:c.serial,op:c.op,result:r});document.getElementById('status').textContent=c.op+' complete';
}
(async()=>{for(let i=0;i<150&&!WosDeviceRecording.ready;i++)await wait(200);await WosOutbox.load();const v=WosSettings.mount(document.getElementById('settings'),{shell:'phone'});v.focus('assistant');await log({boot:true,ready:WosDeviceRecording.ready,orb:WosDeviceOrb.ready,ua:navigator.userAgent,origin:location.origin,switches:document.querySelectorAll('[data-st="everywhere"]').length});setInterval(async()=>{const c=await(await fetch('/cmd',{cache:'no-store'})).json();if(c.serial&&c.serial!==last){last=c.serial;try{await run(c)}catch(e){await log({serial:c.serial,op:c.op,error:String(e)})}}} ,500)})();
</script>'''
PROBE = '''<script>let answered=false;const p=window.wizardDevicePort;if(p){p.onmessage=()=>answered=true;p.postMessage(JSON.stringify({v:1,id:'iframe-probe',method:'device.capabilities',params:{}}))}setTimeout(()=>parent.postMessage({port:!!p,answered},location.origin),3000)</script>'''
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,format,*args): pass
    def send(self,data,ctype='text/html'):
        if isinstance(data,str): data=data.encode()
        self.send_response(200);self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data)
    def do_GET(self):
        p=urllib.parse.urlparse(self.path).path
        if p=='/cmd': return self.send(json.dumps(command),'application/json')
        if p=='/probe': return self.send(PROBE)
        if p in ['/','/wizard-os-home','/wizard-os-home/']:return self.send(PAGE)
        if p.startswith('/wizard-os-home/'):
            f=(WEB/p[len('/wizard-os-home/'):]).resolve()
            if f.is_relative_to(WEB.resolve()) and f.is_file():
                with open(OUT/'assets.jsonl','a') as log:log.write(json.dumps({'path':p,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})+'\n')
                return self.send(f.read_bytes(),'application/javascript' if f.suffix=='.js' else 'text/css' if f.suffix=='.css' else 'text/html' if f.suffix=='.html' else 'image/png')
        self.send_error(404)
    def do_POST(self):
        n=int(self.headers.get('Content-Length','0'))
        if self.path!='/log' or n>100000:return self.send_error(400)
        ev=json.loads(self.rfile.read(n));events.append(ev)
        with open(OUT/'events.jsonl','a') as f:f.write(json.dumps(ev)+'\n')
        self.send('{}','application/json')
def adb(*args):return subprocess.check_output(['adb',*args],text=True,stderr=subprocess.STDOUT)
def check(name,condition):
    checks.append({'name':name,'pass':bool(condition)});print(('PASS ' if condition else 'FAIL ')+name,flush=True)
    (OUT/'checks.json').write_text(json.dumps(checks,indent=2))
    assert condition,name

def until(fn,seconds=60):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        r=fn()
        if r:return r
        time.sleep(1)
    raise AssertionError('timeout waiting for fixture result')
def send(op,**kw):
    global serial,command
    serial+=1;command={'op':op,'serial':serial,**kw}
    ev=until(lambda:next((e for e in reversed(events) if e.get('serial')==serial),None))
    assert not ev.get('error'),ev
    return ev.get('result')
def ui():
    adb('shell','uiautomator','dump','/sdcard/ui.xml')
    s=adb('exec-out','cat','/sdcard/ui.xml');(OUT/'latest-ui.xml').write_text(s)
    return ET.fromstring(s)
def tap(text):
    for n in ui().iter('node'):
        if n.attrib.get('text')==text:
            a=list(map(int,re.findall(r'\d+',n.attrib['bounds'])));adb('shell','input','tap',str((a[0]+a[2])//2),str((a[1]+a[3])//2));return True
    return False

def connect(origin):
    before=len(events)
    adb('shell','am','start','-W','-a','android.intent.action.VIEW','-d','wizard://connect?origin='+urllib.parse.quote(origin,safe=''),PKG)
    def loaded():
        boot=next((e for e in events[before:] if e.get('boot')),None)
        if boot:return boot
        # A repeated Launcher ANR can obscure a tap after a previous dump. Close that unrelated
        # system dialog, then retry the still-visible Connect button; never skip the web boot gate.
        if not tap('Close app'):tap('Connect')
        return None
    boot=until(loaded,120)
    check('trusted HTTPS loads real candidate clients',boot['ready'] and boot['orb'] and boot['switches']==1)
    return boot

def main():
    server=http.server.ThreadingHTTPServer(('127.0.0.1',18881),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
    log=open(OUT/'tunnel.log','w');tunnel=subprocess.Popen(['cloudflared','tunnel','--url','http://127.0.0.1:18881','--no-autoupdate'],stdout=log,stderr=log)
    tunnel2=None;log2=None
    try:
        origin=until(lambda: (re.search(r'https://[a-z0-9-]+\.trycloudflare.com',(OUT/'tunnel.log').read_text()) or [None])[0],60)
        (OUT/'origin.txt').write_text(origin)
        adb('shell','pm','grant',PKG,'android.permission.RECORD_AUDIO');adb('shell','pm','grant',PKG,'android.permission.POST_NOTIFICATIONS')
        connect(origin)
        check('same-origin iframe gets no capability reply',send('iframe')['answered'] is False)
        st=send('start');take=st['id'];check('native recorder starts',take and st['state']=='recording')
        services=adb('shell','dumpsys','activity','services',PKG);(OUT/'services.txt').write_text(services)
        check('native microphone foreground service', 'RecorderService' in services and 'isForeground=true' in services)
        time.sleep(3);a=send('status');adb('shell','input','keyevent','KEYCODE_SLEEP');time.sleep(10);adb('shell','input','keyevent','KEYCODE_WAKEUP');adb('shell','wm','dismiss-keyguard');b=send('status')
        check('screen-off recorder duration advances',b['id']==take and b['ms']>a['ms']+7000)
        adb('shell','input','keyevent','KEYCODE_HOME');time.sleep(8);adb('shell','am','start','-W','-n',ACT);c=send('status')
        check('background recorder duration advances',c['id']==take and c['ms']>b['ms']+5000)
        p=send('pause',on=True);time.sleep(2);q=send('status');check('native pause freezes duration',p['state']=='paused' and q['state']=='paused' and abs(q['ms']-p['ms'])<400)
        r=send('pause',on=False);check('native resume',r['state']=='recording')
        time.sleep(2);r=send('stop',id=take);check('complete bytes durable before native ack',r['bytes']>0 and r['bytes']==r['meta']['bytes'] and r['pendingBefore'] and r['durable'] and not r['pendingAfter'])
        st=send('start');time.sleep(2);r=send('cancel',id=st['id']);check('short cancel never queued',not any(t['id']==st['id'] for t in r))
        st=send('start');time.sleep(4);before=len(events);adb('shell','am','force-stop',PKG);adb('shell','am','start','-W','-n',ACT)
        until(lambda:any(e.get('boot') for e in events[before:]),90);r=send('recovered')
        check('force-stop recovery into real durable outbox',not any(t['id']==st['id'] for t in r['pending']) and any(t['id']=='native-'+st['id'] and t['durable'] and t['bytes']>0 and t['state']=='held' for t in r['rows']))
        adb('shell','appops','set',PKG,'SYSTEM_ALERT_WINDOW','allow');r=send('orb');check('Everywhere capability enabled',r['on'] and r['permitted'])
        adb('shell','am','start','-W','-a','android.intent.action.DIAL');time.sleep(5)
        windows=adb('shell','dumpsys','window','windows');(OUT/'orb-windows.txt').write_text(windows)
        check('native orb window exists', 'WizardShellOrb' in windows)
        (OUT/'orb-logcat.txt').write_text(adb('logcat','-d','-s','ShellOrb:I'))
        adb('shell','am','start','-W','-n',ACT);send('orb')
        st=send('start');time.sleep(4);retained=send('retain',id=st['id'])
        check('origin-bound take retained before switching',retained['bytes']>0)
        log2=open(OUT/'tunnel2.log','w');tunnel2=subprocess.Popen(['cloudflared','tunnel','--url','http://127.0.0.1:18881','--no-autoupdate'],stdout=log2,stderr=log2)
        second=until(lambda:(re.search(r'https://[a-z0-9-]+\.trycloudflare.com',(OUT/'tunnel2.log').read_text()) or [None])[0],60)
        check('second trusted origin is distinct',second!=origin)
        connect(second)
        check('other Wizard cannot list retained take',not any(t['id']==st['id'] for t in send('pending')))
        check('other Wizard cannot read retained take',send('read',id=st['id']).get('error')=='unknown take')
        connect(origin);r=send('recovered')
        check('original Wizard recovers its own retained take',any(t['id']=='native-'+st['id'] and t['durable'] and t['bytes']==retained['bytes'] for t in r['rows']))
        print(json.dumps({'pass':True,'checks':len(checks),'scope':'Signed Android14 emulator + candidate modules/real outbox on HTTPS fixture, not whole shell/provider/OEM proof'}),flush=True)
    finally:
        (OUT/'logcat.txt').write_text(adb('logcat','-d'))
        subprocess.run(['adb','exec-out','screencap','-p'],stdout=open(OUT/'screen.png','wb'))
        tunnel.terminate();tunnel.wait(timeout=15);server.shutdown();log.close()
        if tunnel2:tunnel2.terminate();tunnel2.wait(timeout=15)
        if log2:log2.close()
if __name__=='__main__':main()
