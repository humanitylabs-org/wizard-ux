"""Actual current shell/SDK/adopted Mizel UI + APK. Only upstream IO is synthetic.
Run through QA_INTEGRATED_ONLY=1 tools/qa_mizel.py on Thales. Fail-closed all WebView URLs.
"""
import base64
import hashlib
import json
import mimetypes
import pathlib
import re
import threading
import time
import urllib.parse


class Fixture:
    def __init__(self, root, adoption, job):
        self.root, self.adoption, self.job = map(pathlib.Path, (root, adoption, job))
        self.writes, self.assets, self.events, self.meetings = [], {}, {}, {}
        self.words, self.delay, self.serial = 'synthetic explicit question', 0, 0
        self.threads = [dict(id='qa-'+str(i), title='Synthetic thread '+str(i), model='qa-model', provider='qa-provider', status='completed', source='api_server', message_count=2, last_active=time.time()) for i in range(3)]

    def serve(self, pg, d):
        r=d['params']['request']; rid=d['params']['requestId']; u=urllib.parse.urlparse(r['url']); p=u.path; method=r['method']
        self.serial+=1; serial=self.serial
        def reply(obj, mime='application/json', status=200, delay=0):
            body = obj if isinstance(obj, bytes) else (obj.encode() if isinstance(obj, str) else json.dumps(obj).encode())
            payload={'id':1000000+serial,'method':'Fetch.fulfillRequest','params':{'requestId':rid,'responseCode':status,'responseHeaders':[{'name':'Content-Type','value':mime},{'name':'Cache-Control','value':'no-store'}],'body':base64.b64encode(body).decode()}}
            if delay: threading.Timer(delay, lambda: pg._send(payload)).start()
            else: pg._send(payload)
        # No request is continued to production, including reads, analytics or SW.
        if u.hostname != 'wizard.tailc0f369.ts.net': return reply({},status=403)
        if method=='GET':
            for prefix, root in [('/wizard-os-home/',self.root/'web'),('/mizel-live/',self.adoption/'web')]:
                if p.startswith(prefix):
                    f=(root/(p[len(prefix):] or 'index.html')).resolve()
                    if f.is_relative_to(root.resolve()) and f.is_file():
                        data=f.read_bytes();self.assets[p]=hashlib.sha256(data).hexdigest()
                        return reply(data,mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
        if method not in ('GET','HEAD'):
            self.writes.append({'path':p,'method':method,'body':r.get('postData',''),'t':time.time()})
        if p.endswith('/orb-events'):
            if method=='PUT':
                e=json.loads(r.get('postData','{}'));self.events[e['id']]=e;return reply({'event':e})
            mid=urllib.parse.parse_qs(u.query).get('meetingId',[None])[0]
            return reply({'events':[e for e in self.events.values() if not mid or e.get('meetingId')==mid]})
        if p.endswith('/transcribe'):return reply({'text':self.words,'ms':5},delay=self.delay)
        if p.endswith('/route'):return reply({'cmd':{'route':'agent'},'ms':5})
        if p.endswith('/files/upload'):return reply({'file':{'id':'synthetic-audio-'+str(serial),'filename':'voice.aac','mime':r.get('headers',{}).get('Content-Type','audio/aac'),'bytes':4096}})
        if p.endswith('/v1/runs'):return reply({'run_id':'qa-run-'+str(serial),'status':'queued'},status=202)
        if p=='/wizard/v1/bootstrap':return reply({'bootstrap':1,'settings':{'agent':{'name':'QA Agent'},'owner':{'name':'QA Owner'}},'capabilities':{'voice':True,'router':True,'files':True},'endpoints':{'transcribe':'/wizard/voice/transcribe','route':'/wizard/v1/route','sessions':'/wizard/hermes/api/sessions','runs':'/wizard/hermes/v1/runs','upload':'/wizard/files/upload','apps':'/wizard/v1/apps'}})
        if p=='/wizard/v1/apps':return reply({'apps':[{'id':'mizel','name':'Mizel','url':'/mizel-live/','icon':'M','colors':['#555','#888']}]})
        if p.endswith('/model/options'):return reply({'model':'qa-model','provider':'qa-provider','providers':[{'slug':'qa-provider','name':'Synthetic provider','authenticated':True,'is_current':True,'models':['qa-model']}]})
        if p.endswith('/api/sessions'):return reply({'data':self.threads,'has_more':False})
        if p.endswith('/messages'):return reply({'data':[{'role':'user','content':'hello'},{'role':'assistant','content':'hello'}],'has_more':False})
        if '/api/sessions/qa-' in p:return reply({'session':next((t for t in self.threads if p.endswith(t['id'])),self.threads[0])})
        if p.endswith('/thread-seen'):return reply({'state':{'initializedAt':int(time.time()*1000),'threads':{}}})
        if p=='/mizel-live/api/meetings':
            if method=='POST':
                mid='qa-integrated-'+str(len(self.meetings));m={'id':mid,'title':'PRIVATE SYNTHETIC MEETING CONTEXT','status':'recording','source':'meetings','started_at':'2026-10-15T00:00:00Z','created_at':'2026-10-15T00:00:00Z','notes':'PRIVATE NOTES DO NOT SEND','notes_rev':0,'segments':[]};self.meetings[mid]=m;return reply(m)
            return reply({'meetings':list(self.meetings.values())})
        if p.startswith('/mizel-live/api/meetings/'):
            mid=p.split('/')[4]
            if p.endswith('/segments'):return reply({'segments':[]})
            m=self.meetings.get(mid,{})
            if mid in getattr(self,'native_state',{}).get('status',{}):m['status']=self.native_state['status'][mid]
            chunks=list(getattr(self,'native_state',{}).get('chunks',{}).get(mid,{}).values())
            m['duration_ms']=max((c['start_ms']+c['dur_ms'] for c in chunks),default=0)
            m['audio']={'tracks':[{'source':'me','chunks':len(chunks)}]}
            return reply(m)
        if p.endswith('/api/calendar'):return reply({'events':[]})
        if p.endswith('/asks'):return reply({'asks':[]})
        if p.endswith('/summary'):return reply({'summary':{'topics':[]}})
        return reply({})

    def runs(self):return [w for w in self.writes if w['path'].endswith('/v1/runs')]
    def save(self):
        (self.job/'integrated-network.json').write_text(json.dumps({'writes':self.writes,'assets':self.assets,'events':self.events},indent=2))


def run(pg,sx,top,check,save,origin,pkg,state,lock,fixture,tap_note_action,shot):
    ev=pg.ev
    def wait(expr,secs=15):
        value=pg.pump(secs,lambda:ev(expr),.2)
        if not value:
            save('integrated-failure-state.json',ev("({voice:window.__wos?.voice,v:window.__wos&&{kind:__wos.V.kind,native:__wos.V.native,reply:__wos.V.replyTo,acc:__wos.V.acc,parts:__wos.V.parts?.map(b=>({size:b.size,type:b.type})),snap:__wos.V.snap},text:document.body.innerText,errors:window.qaErrors,capture:window.WizAppCapture?.getState(),frames:[...document.querySelectorAll('iframe')].map(f=>({src:f.src,text:f.contentDocument?.body?.innerText}))})"))
            fixture.save();raise AssertionError('Timed out: '+expr)
        return value
    def touch(selector='#orbWrap',hold=0.0):
        box=ev("(()=>{const e=[...document.querySelectorAll("+json.dumps(selector)+")].find(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight});if(!e)throw Error('missing visible control');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
        # Let the compositor own short-tap timing; two raw socket writes can be
        # separated by JNI stalls/TCP delayed ACKs and accidentally become a hold.
        if not hold:
            pg.call('Input.synthesizeTapGesture',x=box['x'],y=box['y'],duration=60,tapCount=1,gestureSourceType='touch')
        else:
            pg._send({'id':2000001,'method':'Input.dispatchTouchEvent','params':{'type':'touchStart','touchPoints':[dict(box,id=1)]}})
            pg.pump(hold,every=.02)
            pg._send({'id':2000002,'method':'Input.dispatchTouchEvent','params':{'type':'touchEnd','touchPoints':[]}})
        pg.pump(.3,every=.05)
    def native():return ev("JSON.parse(WizardOSDevice.recActive()||'null')")
    def cap():return ev('WizAppCapture.getState()')
    def mf(expr):return ev("(()=>{const w=[...document.querySelectorAll('iframe')].find(f=>f.src.includes('/mizel-live/')).contentWindow;return w.eval("+json.dumps(expr)+")})()")
    def start_meeting():
        ev("__wos.closeSheets(true);__wos.openApp({id:'mizel',kind:'wizard',url:'/mizel-live/',name:'Mizel'})")
        wait("[...document.querySelectorAll('iframe')].some(f=>f.src.includes('/mizel-live/')&&f.contentDocument?.querySelector('#btn-new-mobile'))")
        mf("document.querySelector('#btn-new-mobile').click()")
        wait("WizAppCapture.getState().phase==='recording'",25);pg.pump(1.5)
        return cap()['meetingId']
    def stop_meeting():
        mf("document.querySelector('[aria-label=\"Stop recording\"]').click()")
        # Event readback may race the final marker revision. The app deliberately
        # retains audio and offers Retry save; exercise that real UI, never ack it
        # from the harness or bypass the domain-readback gate.
        done="(async()=>!WizAppCapture.getState().recording&&(await WizAppCapture.pending('mizel')).length===0)()"
        for _ in range(3):
            if pg.pump(8,lambda:ev(done),.2):break
            mf("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Try again')?.click()")
        wait(done,10)
        pg.pump(1)
    check('integrated','actual shell and native bridge loaded',ev("!!__wos&&WizardOSDevice.recHandoffVersion()===1&&!!WizAppCapture"))
    ev('WosModels.load()')
    mid=start_meeting();check('integrated','actual adopted UI starts native meeting through SDK',cap().get('native') is True,cap())
    fixture.delay=5;before=len(fixture.runs());touch();wait("!!__wos.V.native&&!!__wos.V.meetingLoan")
    ident=ev('__wos.V.meetingLoan.id');take=ev('__wos.V.native');pg.pump(1.5)
    check('integrated','UI orb owns real borrowed recorder and frozen meeting',native()['id']==take and cap()['phase']=='handoff',{'take':take,'capture':cap()})
    touch();wait("WizAppCapture.getState().phase==='recording'",3)
    check('integrated','meeting resumes before delayed STT/run',len(fixture.runs())==before,cap())
    wait("Array.from(WosOutbox._items.values()).some(i=>i.meetingEventId&&i.state==='sent')",20)
    ev('WosOrbHandoff.sync()');pg.pump(.5)
    event=fixture.events.get(ident);check('integrated','one run and exact marker thread take correlation',len(fixture.runs())==before+1 and event and event.get('voiceTakeId')==take and event.get('meetingId')==mid and event.get('threadId') and event.get('runId'),event)
    check('integrated','no automatic private meeting context in run',all(x not in fixture.runs()[-1]['body'] for x in ['PRIVATE','Screen:','NOTES']))
    shot('integrated-meeting-resumed');stop_meeting();wait("__wos.voice==='idle'");fixture.delay=0
    # Actual notification actions, not a bridge stand-in.
    mid2=start_meeting();pause=tap_note_action('Recording|Mizel','Pause','integrated-notification-pause');pg.pump(.4)
    check('integrated','notification Pause tap pauses actual meeting',bool(pause) and cap()['phase']=='paused',cap())
    touch();wait('!!__wos.V.native');pg.pump(1.2);ev('__wos.cancelVoice(true)');pg.pump(.4)
    check('integrated','cancel preserves preexisting manual pause',cap()['phase']=='paused',cap())
    stop_meeting()
    mid3=start_meeting();touch();wait('!!__wos.V.native');pg.pump(1.2)
    mf("document.querySelector('[aria-label=\"Stop recording\"]').click()");pg.pump(.5);ev('__wos.cancelVoice(true)');pg.pump(2)
    check('integrated','actual adopted Stop during loan wins over cancellation resume',not cap().get('recording'),cap())
    if cap().get('recording'): stop_meeting()
    before=len(fixture.runs());check('integrated','cancelled loans create no extra sends',before==1,fixture.runs())
    check('integrated','cancelled originals are held durably without native send recovery',ev("[...WosOutbox._items.values()].filter(i=>i.id.startsWith('cancelled-')&&i.state==='held'&&i.durable&&i.audio?.size>600).length===2 && JSON.parse(WizardOSDevice.recPending()||'[]').length===0 && __wosVoiceRecovery().length===0"))
    # Reply -> paused -> actual adopted UI notes dictation -> held local command -> resume native -> send.
    ev("__wos.openWizardThread('qa-0')");pg.pump(1);wait("__wos.wins[__wos.desks[__wos.idx].focus]?.thread==='qa-0'")
    touch('[data-chmic]');wait('!!__wos.V.native');first=ev('__wos.V.native');pg.pump(1.5);touch('#arcPause');wait("__wos.voice==='paused'")
    ev("(()=>{const e=document.querySelector('.ch-compose textarea');e.value='original typed draft';e.dispatchEvent(new Event('input',{bubbles:true}));})()")
    original=ev('({reply:__wos.V.replyTo,route:__wos.V.snap.route})')
    ev("__wos.openApp({id:'mizel',kind:'wizard',url:'/mizel-live/',name:'Mizel'})");pg.pump(.6)
    # Use the real adopted app notes editor, not a replacement document.
    mf("document.querySelector('[data-mode=notes]').click();[...document.querySelectorAll('button')].find(e=>e.textContent==='Edit notes')?.click()")
    pg.pump(.4)
    fields=mf("[...document.querySelectorAll('textarea,input,[contenteditable]')].map(e=>({id:e.id,tag:e.tagName,visible:!!e.getClientRects().length}))")
    save('integrated-fields.json',fields)
    mf("(()=>{const e=[...document.querySelectorAll('textarea')].find(e=>e.getClientRects().length);if(!e)throw Error('no adopted notes textarea');e.value='one OLD three';e.focus();e.setSelectionRange(4,7);window.qaField=e;})()")
    pg.pump(.4);fixture.words='borrowed dictation words';touch();wait("__wos.V.kind==='dictation'&&!!__wos.V.native");borrowed=ev('__wos.V.native');pg.pump(1.5);touch();wait("__wos.voice==='paused'&&__wos.V.replyTo?.sid==='qa-0'")
    check('integrated','native dictation inserts only adopted UI field and restores paused reply',mf('qaField.value')=='one borrowed dictation words three' and len(fixture.runs())==before,{'field':mf('qaField.value'),'native':native()})
    original_id=ev('__wos.V.custodyCapture');check('integrated','original target route typed draft durable after native close',ev("WosOutbox.get(__wos.V.custodyCapture).durable&&__wos.V.seal.text==='original typed draft'&&__wos.V.resumeNative") and ev('({reply:__wos.V.replyTo,route:__wos.V.snap.route})')==original)
    fixture.words='open settings';touch(hold=1.1);wait("__wos.voice==='paused'&&__wos.V.replyTo?.sid==='qa-0'")
    check('integrated','held command consumes release without sending original',len(fixture.runs())==before and native() is None)
    ev('__wos.closeSheets(true)');pg.pump(.5);shot('integrated-reply-paused')
    # Capture original encoded segment before native Resume; real AAC decoder is exercised by the app at Send.
    parts=ev("Promise.all(__wos.V.parts.map(async b=>({type:b.type,size:b.size,b64:await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result.split(',')[1]);f.readAsDataURL(b)})})))")
    for i,part in enumerate(parts):(fixture.job/f'parked-part-{i}.aac').write_bytes(base64.b64decode(part['b64']))
    touch('#arcPause');wait("__wos.voice==='listen'&&!!__wos.V.native");last=ev('__wos.V.native');pg.pump(1.6)
    check('integrated','explicit Resume opens distinct native segment on same thread',last not in (first,borrowed) and ev("__wos.V.replyTo.sid==='qa-0'"),{'first':first,'borrowed':borrowed,'resumed':last})
    fixture.words='original resumed reply';fixture.delay=5;touch()
    wait('WosOutbox.get('+json.dumps(original_id)+")?.audio?.type==='audio/wav'",15)
    joined=ev("(async()=>{const b=WosOutbox.get("+json.dumps(original_id)+").audio;return {type:b.type,size:b.size,b64:await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result.split(',')[1]);f.readAsDataURL(b)})}})()")
    wait('WosOutbox.get('+json.dumps(original_id)+")?.state==='sent'",25)
    rows=fixture.runs();payload=json.loads(rows[-1]['body']);check('integrated','native AAC decode join sends original once with pinned route and typed draft',len(rows)==before+1 and payload.get('session_id')=='qa-0' and payload.get('model')==original['route']['model'] and 'original typed draft' in payload.get('input','') and 'borrowed dictation' not in payload.get('input',''),payload)
    audio=joined
    data=base64.b64decode(audio.pop('b64'));(fixture.job/'joined-reply.wav').write_bytes(data)
    check('integrated','joined delivery is real decoded PCM WAV',data[:4]==b'RIFF' and data[8:12]==b'WAVE' and len(data)>10000,dict(audio,sha256=hashlib.sha256(data).hexdigest()))
    wait("__wos.voice==='idle'");ev("__wos.openWizardThread('qa-0')");pg.pump(.5)
    sx('input keyevent KEYCODE_BACK');pg.pump(.5);check('integrated','actual shell nested Back leaves thread and stays foreground',pkg in top() and ev("__wos.wins[__wos.desks[__wos.idx].focus]?.thread!=='qa-0'"),ev('({url:location.href,view:__wos.viewContext()})'))
    for _ in range(8):sx('input keyevent KEYCODE_BACK');pg.pump(.15)
    check('integrated','actual shell repeated root Back never exits',pkg in top() and ev('__wos.idx===__wos.HOME'),top())
    before_cancel=len(fixture.runs());mid4=start_meeting();wait("__wos.voice==='idle'")
    # Exercise the orb's real accessible keyboard activation for this extra Cancel
    # case; short-tap timing is already covered above and can jitter under emulator load.
    ev("document.querySelector('#orbWrap').focus()")
    pg.call('Input.dispatchKeyEvent',type='keyDown',key='Enter',code='Enter',windowsVirtualKeyCode=13)
    pg.call('Input.dispatchKeyEvent',type='keyUp',key='Enter',code='Enter',windowsVirtualKeyCode=13)
    wait('!!__wos.V.native');pg.pump(1.2);ev('__wos.cancelVoice(true)')
    wait("WizAppCapture.getState().phase==='recording'")
    check('integrated','cancelled actual orb resumes same running meeting without send',cap()['meetingId']==mid4 and len(fixture.runs())==before_cancel,cap())
    stop_meeting()
    check('integrated','zero JavaScript page exceptions',not ev('qaErrors'),ev('qaErrors'))
    save('integrated-proof.json',{'original':original,'nativeIds':{'first':first,'borrowed':borrowed,'resumed':last},'parts':[{k:v for k,v in p.items() if k!='b64'} for p in parts],'joined':audio,'joinedSHA256':hashlib.sha256(data).hexdigest(),'event':event,'runs':rows})
    fixture.save();shot('integrated-final')
