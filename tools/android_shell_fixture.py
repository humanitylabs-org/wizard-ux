#!/usr/bin/env python3
"""Disposable HTTPS fake Wizard for the Wizard Shell emulator smoke (debug build only; no owner server).

  android_shell_fixture.py mint CERT_DIR      per-run CA + leaf for 10.0.2.2 / 127.0.0.1 (CA → CERT_DIR/ca.pem)
  android_shell_fixture.py serve CERT_DIR OUT  HTTPS on 0.0.0.0:$FIXTURE_PORT (default 8443) until killed

The page at /wizard-os-home/ talks to window.wizardDevicePort v1 directly and posts what it saw to /log, one JSON
line per event in OUT/fixture.log. OUT/mode (re-read on every request) picks what the page does:
  record   discover capabilities, start a device.recording take (or report the live one), post status
  recover  list pending takes, read each completely, acknowledge it; probe an unknown take and method
  orb      turn the floating orb on (device.orb.enable)
  everywhere  the real Settings (web/core/settings.js + device-orb.js): Phone → Wizard Everywhere, for a native tap
  pin      a refused untapped pin, then the real Add to home screen sheet (web/core/home-screen-apps.js) for app qa-app
  idle     discover only
?app-session=<id> on the shell path is a pinned app's own task: it logs {ev:'session'} whatever the mode.
The orb's own files (web/assist/everywhere.*, orb.js, its images) are served from this repo's web/. OUT/orb picks how:
  up (default) · down (HTTP 503) · slow (answer after 4 s, past the 1.5 s deadline)
/elsewhere/ is a same-origin page outside the shell path: native must not answer it.
"""
import http.server, json, os, pathlib, ssl, subprocess, sys, time

WEB = pathlib.Path(__file__).resolve().parent.parent / 'web'
# The real web modules the everywhere/pin modes run (served as-is from this repo's web/).
CORE_FILES = {'core/device-port.js', 'core/device-orb.js', 'core/settings.js', 'core/settings.css',
              'core/home-screen-policy.js', 'core/home-screen-apps.js', 'core/home-screen-apps.css'}
ORB_FILES = {'assist/everywhere.html', 'assist/everywhere.js', 'assist/orb-size.js', 'orb.js', 'robert-thread-orb.png', 'robert-listening-galaxy.png'}

PAGE = r"""<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>fixture</title><body style="background:#111;color:#eee;font:16px sans-serif;padding:80px 20px">
<p id=s>QA fixture Wizard</p><script>
const P=window.wizardDevicePort, log=o=>fetch('/log',{method:'POST',body:JSON.stringify({...o,path:location.pathname})}).catch(()=>{});
let n=0;const pend=new Map();
function call(method,params={},ms=20000){return new Promise((res,rej)=>{const id='q'+(++n);const t=setTimeout(()=>{pend.delete(id);rej(new Error('noreply'))},ms);pend.set(id,{res,rej,t});P.postMessage(JSON.stringify({v:1,id,method,params}));});}
if(P)P.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch(_){return}const w=pend.get(m.id);if(!w)return;pend.delete(m.id);clearTimeout(w.t);m.ok?w.res(m.result):w.rej(new Error(m.error));};
const Q=new URLSearchParams(location.search);
function load(src){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=rej;document.head.appendChild(s);});}
// Where an element is, in CSS px of the WebView, for a real native tap (the smoke adds the WebView's screen offset).
function rect(el){if(!el)return{};const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,dpr:devicePixelRatio};}
function css(href){const l=document.createElement('link');l.rel='stylesheet';l.href=href;document.head.appendChild(l);}
async function everywhere(){
  window.WizCore={};window.WizBrand={html:'W'};
  css('core/settings.css');
  const box=document.createElement('div');box.id='st';document.body.replaceChildren(box);
  await load('core/device-port.js');await load('core/settings.js');await load('core/device-orb.js');
  for(let i=0;i<100&&!window.WosDeviceOrb?.ready;i++)await new Promise(r=>setTimeout(r,100));
  const view=WosSettings.mount(box,{shell:'phone',helpSub:'',haptic(){}});view.focus('assistant');
  await new Promise(r=>setTimeout(r,500));
  log({ev:'everywhere',...rect(box.querySelector('[data-st="everywhere"]')),ready:!!WosDeviceOrb.ready,switches:box.querySelectorAll('[data-st="everywhere"]').length,orbRows:box.querySelectorAll('[data-st="shell-orb"]').length,dead:box.querySelectorAll('[data-st="side"],[data-st="typing"]').length,on:WosDeviceOrb.state.on});
  let was=WosDeviceOrb.state.on;setInterval(()=>{const on=WosDeviceOrb.state.on;if(on!==was){was=on;log({ev:'everywhere-switch',on,checked:box.querySelector('[data-st="everywhere"]')?.getAttribute('aria-checked')});}},300);
}
async function pin(){
  const H=window.wizardHomeScreenPort;if(!H){log({ev:'nohomeport'});return;}
  // Negative control: a pin no one tapped for is refused.
  const raw=await new Promise(res=>{const t=setTimeout(()=>res('noreply'),4000);H.onmessage=e=>{clearTimeout(t);try{res(JSON.parse(e.data).status)}catch(_){res('bad')}};
    H.postMessage(JSON.stringify({op:'pin',requestId:'99',appId:'qa-app',name:'QA App',icon:'data:image/png;base64,AAAA'}));});
  log({ev:'untapped',status:raw});
  const app={id:'qa-app',name:'QA App',kind:'wizard',url:'/qa-app/'};
  window.WizCore={apps:()=>({APP:{'qa-app':app}})};
  window.WizSigil={of:()=>({color:'#9b7bff',letter:'Q'}),box:()=>'<span class="sgi"></span>'};
  css('core/home-screen-apps.css');
  document.body.style.padding='0';document.getElementById('s').textContent='';
  await load('core/home-screen-policy.js');await load('core/home-screen-apps.js');
  log({ev:'offer',shown:WizHomeScreenApps.offer(app)});
  let last='';setInterval(()=>{const b=document.querySelector('.home-pin-sheet button');const t=b?b.textContent:'(closed)';if(t!==last){last=t;log({ev:'sheet',text:t,state:WizHomeScreenApps.state,...rect(b)});}},200);
}
(async()=>{
  if(Q.has('app-session')){log({ev:'session',app:Q.get('app-session'),devicePort:!!window.wizardDevicePort,homePort:!!window.wizardHomeScreenPort});document.getElementById('s').textContent='QA pinned app '+Q.get('app-session');return;}
  if(!P){log({ev:'noport'});return;}
  if(location.pathname.startsWith('/elsewhere/')){const r=await call('device.capabilities',{},2500).then(()=>'answered',e=>e.message);log({ev:'elsewhere',r});return;}
  const caps=await call('device.capabilities');log({ev:'caps',caps});
  const mode=(await (await fetch('/wizard-os-home/mode',{cache:'no-store'})).text()).trim();
  document.getElementById('s').textContent='QA fixture Wizard · '+mode;
  if(mode==='record'){
    const st=await call('device.recording.status');
    if(st.id)log({ev:'already',st});
    else{const r=await call('device.recording.start',{kind:'voice',ref:'fixture'},60000).then(r=>r,e=>({error:e.message}));log({ev:'started',...r});}
    setInterval(async()=>{try{log({ev:'status',st:await call('device.recording.status')});}catch(e){}},3000);
  }
  if(mode==='everywhere'){await everywhere();return;}
  if(mode==='pin'){await pin();return;}
  if(mode==='orb'){log({ev:'orb',r:await call('device.orb.enable').then(r=>r,e=>({error:e.message}))});}
  if(mode==='recover'){
    const p=await call('device.recording.pending');log({ev:'pending',p});
    for(const t of p){let off=0,size=0;while(off>=0){const c=await call('device.recording.read',{id:t.id,offset:off});size+=atob(c.b64).length;off=c.next;}
      log({ev:'read',id:t.id,size,bytes:t.bytes,state:t.state});log({ev:'ack',id:t.id,a:await call('device.recording.ack',{id:t.id})});}
    log({ev:'unknownTake',r:await call('device.recording.read',{id:'take-1-00000000',offset:0}).then(()=>'answered',e=>e.message)});
    log({ev:'unknownMethod',r:await call('device.recording.delete',{}).then(()=>'answered',e=>e.message)});
    location.href='/elsewhere/';
  }
})().catch(e=>log({ev:'error',m:String(e)}));
</script>"""


def mint(d):
    d = pathlib.Path(d); d.mkdir(parents=True, exist_ok=True)
    run = lambda *a: subprocess.run(a, check=True, capture_output=True)
    run('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', d / 'ca.key', '-out', d / 'ca.pem', '-days', '2',
        '-subj', '/CN=Wizard Shell CI fixture CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign')
    run('openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-keyout', d / 'leaf.key', '-out', d / 'leaf.csr', '-subj', '/CN=10.0.2.2')
    (d / 'ext.cnf').write_text('subjectAltName=IP:10.0.2.2,IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n')
    run('openssl', 'x509', '-req', '-in', d / 'leaf.csr', '-CA', d / 'ca.pem', '-CAkey', d / 'ca.key', '-CAcreateserial',
        '-out', d / 'leaf.pem', '-days', '2', '-extfile', d / 'ext.cnf')
    (d / 'ca.key').unlink()  # nothing else can ever be signed by this CA
    print(d / 'ca.pem')


def serve(d, out):
    d, out = pathlib.Path(d), pathlib.Path(out); out.mkdir(parents=True, exist_ok=True)
    logf = open(out / 'fixture.log', 'a', buffering=1)

    class H(http.server.BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        def log_message(self, *a): pass
        def send(self, code, body, ctype='text/html; charset=utf-8'):
            b = body.encode() if isinstance(body, str) else body
            self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(b)))
            self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(b)
        def do_GET(self):
            p, _, q = self.path.partition('?')
            logf.write(json.dumps({'t': time.time(), 'get': p, 'q': q}) + '\n')
            if p == '/wizard-os-home/mode':
                m = (out / 'mode').read_text().strip() if (out / 'mode').exists() else 'idle'
                return self.send(200, m, 'text/plain')
            if p in ('/', '/wizard-os-home', '/wizard-os-home/', '/wizard-os-home/index.html', '/elsewhere/'): return self.send(200, PAGE)
            f = p[len('/wizard-os-home/'):] if p.startswith('/wizard-os-home/') else None
            if f in CORE_FILES:
                return self.send(200, (WEB / f).read_bytes(), 'text/css' if f.endswith('.css') else 'application/javascript')
            if f in ORB_FILES:
                how = (out / 'orb').read_text().strip() if (out / 'orb').exists() else 'up'
                if how == 'down': return self.send(503, 'down', 'text/plain')
                if how == 'slow': time.sleep(4)
                ctype = 'text/html; charset=utf-8' if f.endswith('.html') else 'application/javascript' if f.endswith('.js') else 'image/png'
                return self.send(200, (WEB / f).read_bytes(), ctype)
            self.send(404, 'not found', 'text/plain')
        def do_POST(self):
            n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n).decode(errors='replace')
            try: ev = json.loads(body)
            except ValueError: ev = {'raw': body[:200]}
            ev['t'] = str(time.time()); logf.write(json.dumps(ev) + '\n')
            self.send(204, b'', 'text/plain')

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(d / 'leaf.pem', d / 'leaf.key')

    class S(http.server.ThreadingHTTPServer):
        daemon_threads = True
        def finish_request(self, sock, addr):
            # TLS handshake on the connection's own thread: one stalled client never blocks accept().
            sock.settimeout(15)
            try: tls = ctx.wrap_socket(sock, server_side=True)
            except (OSError, ssl.SSLError): return
            self.RequestHandlerClass(tls, addr, self)

    S(('0.0.0.0', int(os.environ.get('FIXTURE_PORT', '8443'))), H).serve_forever()


if __name__ == '__main__':
    if sys.argv[1] == 'mint': mint(sys.argv[2])
    elif sys.argv[1] == 'serve': serve(sys.argv[2], sys.argv[3])
    else: sys.exit(__doc__)
