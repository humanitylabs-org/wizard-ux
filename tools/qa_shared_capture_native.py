"""Seam additions to existing qa_mizel.py. Real APK/DeviceBridge/Mizel service;
registered-path client fixture, synthetic meetings backend and emulator mic, no handset claim.
The existing runner owns emulator setup, fake backend, CDP and worker lease.
"""
import base64, hashlib, json, pathlib, time


def pages(root):
    root = pathlib.Path(root)
    scripts = {p: (root / 'web' / p).read_text() for p in ['core/app-capture.js', 'core/app-services.js', 'core/app-client.js', 'device.js']}
    boot = """window.resumes=[]; window.__wos={voice:'idle',V:{native:null},toast(){},txHide(){},setVoice(v){this.voice=v},nativeResume(a){resumes.push(a.id);this.V.native=a.id;this.voice='listen';return true}};
window.WizConfig={agent:()=> 'Synthetic',owner:()=> 'Synthetic'};
window.WizCore={apps:()=>({APPS:[{id:'mizel',url:'/mizel-qa/capture-frame.html'},{id:'trackhunt',url:'/mizel-qa/task-frame.html'}]})};
"""
    mount = """const f=document.querySelector('iframe');const task=location.search.includes('task');f.src=task?'/mizel-qa/task-frame.html':'/mizel-qa/capture-frame.html';WizAppServices.attach(f,{appId:task?'trackhunt':'mizel',path:f.src});
window.__wosNativeBack=()=>{WizAppServices.back(f);return 'shared-back';};"""
    frame = """window.stats={pcm:0,bytes:0,levels:0,raw:0,depth:0};
if(navigator.mediaDevices) navigator.mediaDevices.getUserMedia=()=>{stats.raw++;throw Error('App raw capture is forbidden');};
WizardApp.back.register({canGoBack:()=>stats.depth>0,back:()=>{if(stats.depth){stats.depth--;return true;}return false;}});
window.begin=async()=>{const current=WizardApp.capture.current();window.take=await WizardApp.capture.start({kind:document.documentElement.dataset.app==='mizel'?'meeting':'audio',resumeId:current?.id,meta:{meetingId:'qa_shared_native'}});
take.onPcm(f=>{stats.pcm++;stats.bytes+=f.pcm.byteLength});take.onLevel(()=>stats.levels++);return {id:take.id,info:take.getInfo()};};
"""
    html = '<!doctype html><div id="device"></div><iframe style="height:600px;width:100%"></iframe><script>' + boot + '</script>'
    for name in ['core/app-capture.js', 'core/app-services.js', 'device.js']:
        html += '<script>' + scripts[name] + '</script>'
    html += '<script>' + mount + '</script>'
    result = {'/mizel-qa/shared-native.html': html}
    for name, app in [('capture', 'mizel'), ('task', 'trackhunt')]:
        result[f'/mizel-qa/{name}-frame.html'] = '<!doctype html><html data-app="' + app + '"><button onclick="stats.depth++">Nested</button><script>' + scripts['core/app-client.js'] + '</script><script>' + frame + '</script></html>'
    return result, {name: hashlib.sha256(data.encode()).hexdigest() for name, data in scripts.items()}


def run(pg, sx, top, check, save, origin, pkg, state, lock):
    def navigate(task=False):
        pg.ev("location.href=" + json.dumps(origin + '/mizel-qa/shared-native.html' + ('?task' if task else '')))
        assert pg.pump(25, lambda: pg.ev("!!(window.WizAppCapture?.getState().nativeOwnershipReady && document.querySelector('iframe')?.contentWindow?.WizardApp?.hosted)"), .5)
    def frame(expression):
        return pg.ev("document.querySelector('iframe').contentWindow." + expression)
    navigate()
    start = frame('begin()')
    pg.pump(2)
    stats = frame('stats')
    check('shared-native', 'actual core/host/client receives native quarter-second PCM and levels', stats['pcm'] >= 4 and stats['bytes'] > 0 and stats['levels'] > 0, stats)
    check('shared-native', 'Mizel app never invokes a raw microphone API', stats['raw'] == 0)
    check('shared-native', 'native meeting capture blocks Everywhere recorder', not pg.ev("WizardOSDevice.recStart('auto')"))
    before = pg.ev('WizAppCapture.getState().id')
    pg.ev("document.querySelector('iframe').contentWindow.location.reload()")
    pg.pump(2, lambda: pg.ev("!!document.querySelector('iframe').contentWindow.WizardApp?.hosted"), .3)
    attached = frame('begin()'); pg.pump(2)
    check('shared-native', 'iframe reload rebinds native PCM without a second take', attached['id'] == before and frame('stats.pcm') >= 4)
    pg.ev('location.reload()'); pg.pump(4)
    snapshot = pg.ev('WizAppCapture.getState()')
    check('shared-native', 'shell reload reports physical native meeting ownership/hold before logical resume', not snapshot['active'] and snapshot['recording'] and snapshot['hold'], snapshot)
    resumed = frame('begin()'); pg.pump(2)
    check('shared-native', 'shell restart resumes exact native meeting and live PCM', resumed['id'] == before and frame('stats.pcm') >= 4)
    check('shared-native', 'task meeting never enters legacy voice orb/outbox', not pg.ev('resumes.length') and not pg.ev("document.querySelector('.dv-take')!==null"))
    sx('input keyevent KEYCODE_HOME'); time.sleep(1)
    count = frame('stats.pcm'); pg.pump(6)
    check('shared-native', 'background gates transient PCM while native durable uploads continue', frame('stats.pcm') == count and len(state['chunks'].get('qa_shared_native', {})) >= 2)
    sx(f'am start -W -n {pkg}/ai.wizards.os.MainActivity'); time.sleep(2); pg.pump(2)
    check('shared-native', 'foreground restores streaming callbacks', frame('stats.pcm') > count)
    result = frame('take.stop().then(r=>({id:r.id,bytes:r.blob.size,meta:r.meta,durationMs:r.durationMs}))')
    pg.pump(8)
    with lock:
        stored = state['stops'].get('qa_shared_native')
        chunks = state['chunks'].get('qa_shared_native', {})
    check('shared-native', 'native task owns uploads and final sequence before shared ack', stored and stored['body']['final_seq']['me'] == max(chunks) and all(c['n'] < stored['n'] for c in chunks.values()), stored and stored['body'])
    check('shared-native', 'native tee stays partial backup, never replacement app upload', result['meta']['native']['backendOwned'] and result['meta']['native']['backendStopOwned'] and result['bytes'] > 44, result)
    pg.ev("document.querySelector('iframe').contentWindow.WizardApp.capture.ack(" + json.dumps(result['id']) + ')')
    check('shared-native', 'native meeting ack empties shared custody', not pg.ev("WizAppCapture.pending('mizel').then(r=>r.length)"))
    navigate(task=True)
    started = frame('begin()'); pg.pump(2)
    active = pg.ev('JSON.parse(WizardOSDevice.recActive())')
    check('shared-device', 'actual recActive omits kind but exact take id is exported', 'kind' not in active and pg.ev('WizAppCapture.getState().nativeDeviceTakeIds') == [active['id']], active)
    pg.ev('location.reload()');pg.pump(4)
    snapshot = pg.ev('WizAppCapture.getState()')
    check('shared-device', 'real DeviceBridge shared take survives shell restart with physical hold', snapshot['nativeOwnershipReady'] and snapshot['recording'] and snapshot['hold'] and snapshot['nativeDeviceTakeIds'] == [active['id']], snapshot)
    check('shared-device', 'legacy importer neither adopts nor offers shared active take', not pg.ev('resumes.length') and not pg.ev("document.querySelector('.dv-take')!==null"))
    frame('begin()')
    result = frame('take.stop().then(async r=>({id:r.id,bytes:r.blob.size,hash:Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await r.blob.arrayBuffer()))).map(b=>b.toString(16).padStart(2,"0")).join(""),meta:r.meta}))')
    native = pg.ev("(()=>{let a=[],o=0;while(o>=0){const x=JSON.parse(WizardOSDevice.recRead(" + json.dumps(active['id']) + ",o));a.push(x.b64);o=x.next;}return a})()")
    native_hash = hashlib.sha256(b''.join(base64.b64decode(s) for s in native)).hexdigest()
    check('shared-device', 'real native AAC bytes equal durable shared Result before deletion', result['bytes'] > 0 and result['hash'] == native_hash, result)
    check('shared-device', 'pending shared native take is never a legacy voice offer', not pg.ev('resumes.length') and not pg.ev("document.querySelector('.dv-take')!==null"))
    frame('WizardApp.capture.ack(' + json.dumps(result['id']) + ')')
    check('shared-device', 'ack deletes only the exact native task take', not pg.ev("JSON.parse(WizardOSDevice.recPending()).some(t=>t.id===" + json.dumps(active['id']) + ')'))
    legacy = pg.ev("WizardOSDevice.recStart('auto')")
    pg.ev("dispatchEvent(new Event('wos-native-resume'))");pg.pump(.5)
    check('shared-device', 'legacy voice resumes after ownership readiness', pg.ev('resumes') == [legacy], pg.ev('resumes'))
    pg.ev('WizardOSDevice.recCancel(' + json.dumps(legacy) + ')')
    frame('stats.depth=1');sx('input keyevent KEYCODE_BACK');pg.pump(1)
    check('shared-back', 'native Back closes nested shared app and never exits', frame('stats.depth') == 0 and pkg in top(), top())
    save('shared-native-snapshot.json', {'device': snapshot, 'task': result, 'nativeByteHash': native_hash})
