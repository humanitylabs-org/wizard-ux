/* Full actual shell + real WebAudio/IDB + adopted event store. Synthetic network/STT only. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('../tools/qa-playwright.cjs');
const evidence=process.env.HOST_EVIDENCE,root=path.resolve(__dirname,'..');
if(!require('../tools/qa-paths.cjs').inWorkRoot(evidence)||!process.env.WIZARD_WORK_ROOT)throw Error('Thales external QA only');
fs.mkdirSync(evidence,{recursive:true});process.env.QA_WEB_DIR=root;
// Reuse the maintained synthetic host fixture without executing its suite.
let boot,app,select,tap,contexts;
const server=require('node:http').createServer((req,res)=>{const file=path.join(root,'web',decodeURIComponent(req.url.split('?')[0]).replace(/^\/wizard-os-home\//,''));if(!file.startsWith(root+'/web/')||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(file));});
const checks=[];let browser;
async function test(name,fn){await fn();checks.push({name,passed:true});console.log('PASS',name);fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify(checks,null,2));const p=contexts?.[0]?.p;if(p&&!p.isClosed())fs.appendFileSync(path.join(evidence,'voice-states.jsonl'),JSON.stringify({name,state:await p.evaluate(()=>({voice:__wos.voice,kind:__wos.V.kind,reply:__wos.V.replyTo,seal:__wos.V.seal?.text,custody:__wos.V.custodyCapture,parts:__wos.V.parts.length}))})+'\n');}
async function tones(p){await p.evaluate(()=>{window.tone=440;window.graphs=[];navigator.mediaDevices.getUserMedia=async()=>{const ctx=new AudioContext(),o=ctx.createOscillator(),d=ctx.createMediaStreamDestination();o.frequency.value=tone;o.connect(d);o.start();await ctx.resume();graphs.push({ctx,o,stream:d.stream});return d.stream;};});}
(async()=>{
 const {OrbEvents}=await import(process.env.MIZEL_ADOPTION+'/orb-events.mjs');
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 process.env.WIZARD_ORIGIN='http://127.0.0.1:'+server.address().port;
 const fixture=fs.readFileSync(path.join(root,'qa-in-app-dictation.cjs'),'utf8').split('async function cases(browser)')[0].replace('?.slice(0, 500)','');
 ({boot,app,select,tap,contexts}=new Function('require','__dirname','process',fixture+'\nreturn {boot,app,select,tap,contexts};')(require('node:module').createRequire(path.join(root,'package.json')),root,process));
 browser=await chromium.launch({executablePath:process.env.CHROMIUM,headless:true,args:['--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 let f=await boot(browser,false),p=f.p;await tones(p);const store=new OrbEvents(path.join(evidence,'events.json'));
 await p.evaluate(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));
 await f.context.route('**/mizel-live/orb-events**',async r=>{try{if(r.request().method()==='PUT'){const event=store.upsert(r.request().postDataJSON());return r.fulfill({json:{event}});}return r.fulfill({json:{events:store.list(new URL(r.request().url()).searchParams.get('meetingId'))}});}catch(e){console.error('EVENT REJECT',e.message,r.request().postData());return r.fulfill({status:409,json:{error:e.message}});}});
 for(const focused of [false,true]) await test('idle held command borrows active meeting and resumes before STT without agent send; field focused='+focused,async()=>{
   await p.evaluate(async()=>{await WosModels.load();window.meeting=await WizAppCapture.start('mizel',{kind:'meeting',chunkMs:500,meta:{meetingId:'idle-held-command'}});});
   let inputFrame,originalField;
   if(focused){await p.evaluate(()=>__wos.openApp(WizCore.apps('mobile').APP['qa-iching']));await p.waitForTimeout(400);inputFrame=p.frames().find(x=>x.url().includes('/qa-iching/'));await select(inputFrame);originalField=await inputFrame.locator('#a').inputValue();}
   await p.waitForTimeout(650);f.R.words='open settings';f.R.delay=2200;
   const touch=await f.context.newCDPSession(p),b=await p.locator('#orbWrap').boundingBox();
   await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:9}]});await p.waitForTimeout(1000);
   const started=await p.evaluate(()=>({voice:__wos.voice,kind:__wos.V.kind,capture:WizAppCapture.getState(),errors:document.querySelector('#toast').textContent}));
   fs.writeFileSync(path.join(evidence,'idle-hold-start.json'),JSON.stringify(started,null,2));
   assert.equal(started.voice,'command');assert.equal(started.capture.phase,'handoff');
   await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await p.waitForFunction(()=>WizAppCapture.getState().phase==='recording',null,{timeout:1700});
   assert.equal(await p.evaluate(()=>WizAppCapture.getState().meetingId),'idle-held-command');
   assert.equal(f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length,0);
   await p.waitForFunction(()=>__wos.voice==='idle',null,{timeout:7000});
   assert.equal(await p.evaluate(()=>document.querySelector('#settings').classList.contains('open')),true);
   assert.equal(f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length,0);
   if(focused)assert.equal(await inputFrame.locator('#a').inputValue(),originalField,'command must not overwrite the focused field');
   await p.evaluate(async()=>{__wos.closeSheets(true);await meeting.stop();});f.R.words='spoken words';f.R.delay=0;
   if(focused)await inputFrame.locator('#away').click();
 });
 await test('actual shell admits borrowed orb, resumes before delayed STT, sends only explicit question once',async()=>{
   await p.evaluate(async()=>{await WosModels.load();window.meeting=await WizAppCapture.start('mizel',{kind:'meeting',chunkMs:500,meta:{meetingId:'synthetic-host-meeting',title:'PRIVATE MUST NOT SEND'}});});
   await p.waitForTimeout(750);await p.evaluate(()=>{tone=880;});f.R.delay=2200;
   await p.evaluate(()=>__wos.startVoice('auto'));await p.waitForTimeout(750);
   assert.equal(await p.evaluate(()=>WizAppCapture.getState().phase),'handoff');
   assert.equal(await p.evaluate(()=>WosOrbHandoff.forTake(__wos.V.custodyCapture)?.id===__wos.V.meetingLoan.id),true);
   await p.evaluate(()=>{tone=660;__wos.finishVoice();});
   await p.waitForFunction(()=>WizAppCapture.getState().phase==='recording',{},{timeout:1700});
   assert.equal(f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length,0);
   await p.waitForFunction(()=>Array.from(WosOutbox._items.values()).some(i=>i.meetingEventId&&i.state==='sent'),null,{timeout:12000});
   const writes=f.writes.filter(w=>/\/v1\/runs$/.test(w.path));assert.equal(writes.length,1);assert.ok(!writes[0].body.includes('PRIVATE'));assert.ok(!writes[0].body.includes('Screen:'));
   await p.evaluate(()=>WosOrbHandoff.sync());await p.waitForTimeout(100);
   const row=store.list('synthetic-host-meeting')[0];assert.equal(row.status,'sent');assert.equal(row.runId,'qa-run');assert.equal(row.question,'spoken words');assert.ok(row.threadId);
   await store.refresh(async()=>({session_id:row.threadId,idempotency_key:row.deliveryKey,status:'completed',output:'Synthetic later answer',user_message_id:'synthetic-message'}));
   assert.equal(new OrbEvents(store.file).list(row.meetingId)[0].answer,'Synthetic later answer');
   await p.evaluate(async()=>{window.meetingResult=await meeting.stop();});
   await p.waitForFunction(()=>__wos.voice==='idle');
 });
 await test('foreground Manager meeting request stages before return and bypasses conversation dispatch',async()=>{
   await p.waitForFunction(()=>__wos.voice==='idle');
   await p.evaluate(()=>__wos.openApp(WizCore.apps('mobile').APP['qa-iching']));await p.waitForTimeout(300);
   await p.evaluate(async()=>{const w=Object.values(__wos.wins).find(w=>w.app==='frame');w.appId='wizard-manager';window.meeting=await WizAppCapture.start('mizel',{kind:'meeting',chunkMs:500,meta:{meetingId:'manager-meeting',title:'PRIVATE MANAGER NOTES'}});window.managerOrder=[];const stage=WosOutbox.stage,send=WosOutbox.sendConversation,end=WosOrbHandoff.end;WosOutbox.stage=async function(o){const r=await stage.call(this,o);managerOrder.push(['stage',r.durable]);return r;};WosOutbox.sendConversation=async()=>{throw Error('Manager conversation must not receive meeting loan');};WosOrbHandoff.end=async(...a)=>{managerOrder.push(['return']);return end(...a);};window.restoreManagerProbe=()=>{WosOutbox.stage=stage;WosOutbox.sendConversation=send;WosOrbHandoff.end=end;w.appId='qa-iching';};});
   const before=f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length;f.R.delay=1300;
   await p.evaluate(()=>__wos.startVoice('auto'));await p.waitForTimeout(450);
   assert.equal(await p.evaluate(()=>__wos.V.snap.conversation),null);assert.equal(await p.evaluate(()=>__wos.V.snap.view),null);
   await p.evaluate(()=>__wos.finishVoice());await p.waitForFunction(()=>WizAppCapture.getState().phase==='recording');
   const order=await p.evaluate(()=>managerOrder);assert.deepEqual(order.slice(0,2),[['stage',true],['return']]);
   await p.waitForFunction(()=>Array.from(WosOutbox._items.values()).some(i=>i.meetingEventId&&i.state==='sent'&&WosOrbHandoff.read()[i.meetingEventId]?.meetingId==='manager-meeting'));
   const writes=f.writes.filter(w=>/\/v1\/runs$/.test(w.path));assert.equal(writes.length,before+1);assert(!writes.at(-1).body.includes('PRIVATE'));assert(!writes.at(-1).body.includes('Manager'));
   await p.evaluate(async()=>{restoreManagerProbe();await meeting.stop();});f.R.delay=0;
 });
 await test('real IDB parked stage crash and later-segment tombstone dedupe',async()=>{
   const first=await p.evaluate(async()=>{const audio=new Blob(['synthetic first']);const it=await WosOutbox.stage({nativeId:'review-segment-a',audio,kind:'reply',sessionId:'qa-0',model:'qa-model',provider:'qa-provider',parkedDraft:{parts:[audio],typed:'typed kept'}});return {id:it.id,state:it.state,durable:it.durable};});assert(first.durable);assert.equal(first.state,'held');
   await p.reload();await p.waitForFunction(()=>WosOutbox?.recoveryComplete);await tones(p);
   const result=await p.evaluate(async id=>{const first=WosOutbox.nativeItem('review-segment-a');const duplicate=await WosOutbox.stage({nativeId:'review-segment-a',audio:new Blob(['do not duplicate'])});const appended=await WosOutbox.stage({captureId:id,nativeId:'review-segment-b',audio:new Blob([first.audio,'later']),typed:'typed kept',kind:'reply',sessionId:'qa-0'});await WosOutbox.transition(id,'held');await WosOutbox.remove(id);return {duplicate:duplicate.id,appended:appended.id,typed:appended.typed};},first.id);assert.equal(result.duplicate,first.id);assert.equal(result.appended,first.id);assert.equal(result.typed,'typed kept');
   await p.reload();await p.waitForFunction(()=>WosOutbox?.recoveryComplete);await tones(p);assert.deepEqual(await p.evaluate(()=>['review-segment-a','review-segment-b'].map(id=>({id:WosOutbox.nativeItem(id)?.id,state:WosOutbox.nativeItem(id)?.state}))),[{id:first.id,state:'sent'},{id:first.id,state:'sent'}]);
 });
 if(process.env.HOST_REVIEW_ONLY==='1') {
   await test('explicit user Pause during browser loan wins after durable cancel',async()=>{
     await p.evaluate(async()=>{window.meeting=await WizAppCapture.start('mizel',{kind:'meeting',chunkMs:500,meta:{meetingId:'review-user-pause'}});});
     await p.waitForTimeout(300);await p.evaluate(()=>__wos.startVoice('auto'));await p.waitForTimeout(350);await p.evaluate(()=>meeting.pause());
     assert.equal(await p.evaluate(async()=>{try{await meeting.resume();}catch(e){return e.code;}}),'mic_borrowed');
     await p.evaluate(()=>__wos.cancelVoice(true));assert.equal(await p.evaluate(()=>WizAppCapture.getState().phase),'paused');await p.evaluate(()=>meeting.stop());
   });
   assert.deepEqual(f.errors,[]);await p.screenshot({path:path.join(evidence,'review-host.png')});
   fs.writeFileSync(path.join(evidence,'receipt.json'),JSON.stringify({sourceSHA:process.env.SOURCE_SHA,checks,pageErrors:f.errors,synthetic:true,nativeEvidence:false,authorityFixture:'OrbEvents.refresh upstream affirmative idempotency_key equals exact outbox deliveryKey; latest adopted store, no live service'},null,2));return;
 }
 await test('cancel restores same meeting and leaves cancelled durable original without send',async()=>{
   f.R.delay=0;const before=f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length;
   await p.evaluate(async()=>{window.meeting=await WizAppCapture.start('mizel',{kind:'meeting',chunkMs:500,meta:{meetingId:'synthetic-cancel'}});});await p.waitForTimeout(450);
   await p.evaluate(()=>__wos.startVoice('auto'));await p.waitForTimeout(400);await p.evaluate(()=>__wos.cancelVoice(true));
   assert.equal(await p.evaluate(()=>WizAppCapture.getState().phase),'recording');
   await p.evaluate(()=>WosOrbHandoff.sync());await p.waitForFunction(()=>Object.values(WosOrbHandoff.read()).some(e=>e.meetingId==='synthetic-cancel'&&e.acked===e.clientRevision));assert.equal(store.list('synthetic-cancel')[0].status,'cancelled');assert.equal(f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length,before);
   await p.evaluate(()=>meeting.stop());
 });
 await test('preexisting manual meeting pause remains paused after actual orb send',async()=>{
   await p.evaluate(async()=>{window.meeting=await WizAppCapture.start('mizel',{kind:'meeting',chunkMs:500,meta:{meetingId:'synthetic-paused'}});await meeting.pause();});
   await p.evaluate(()=>__wos.startVoice('auto'));await p.waitForTimeout(650);await p.evaluate(()=>__wos.finishVoice());
   await p.waitForFunction(()=>!__wos.V.meetingLoan);assert.equal(await p.evaluate(()=>WizAppCapture.getState().phase),'paused');await p.evaluate(()=>meeting.stop());
   await p.waitForFunction(()=>__wos.voice==='idle');
 });
 await test('park reply, dictate in other app, restore exact target/model/text/audio paused',async()=>{
   await p.evaluate(()=>__wos.openWizardThread('qa-0'));await p.locator('[data-chmic]').first().waitFor();
   const input=p.locator('.ch-compose textarea').first();await p.evaluate(()=>{tone=440;});
   await p.locator('[data-chmic]').first().click();await p.waitForTimeout(700);
   const initialSends=f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length,touch=await f.context.newCDPSession(p),orb=await p.locator('#orbWrap').boundingBox();await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:orb.x+orb.width/2,y:orb.y+orb.height/2,id:8}]});await p.waitForTimeout(600);await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.equal(await p.evaluate(()=>__wos.voice),'listen');assert.equal(f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length,initialSends);
   await p.locator('#arcPause').click();await input.fill('original typed draft');
   const original=await p.evaluate(()=>({reply:__wos.V.replyTo,route:__wos.V.snap.route}));assert.equal(original.reply.sid,'qa-0');
   // Open another app without cancelling the parked reply (unlike the old fixture helper).
   await p.evaluate(()=>__wos.openApp(WizCore.apps('mobile').APP['qa-iching']));await p.waitForTimeout(400);
   const frame=p.frames().find(x=>x.url().includes('/qa-iching/'));await select(frame);
   const before=f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length;
   await p.evaluate(()=>{tone=880;});await tap(p);await p.waitForFunction(()=>__wos.V.kind==='dictation');await p.waitForTimeout(700);await tap(p);
   await p.waitForFunction(()=>__wos.voice==='paused'&&__wos.V.replyTo?.sid==='qa-0');
   assert.equal(await frame.locator('#a').inputValue(),'one spoken words three');
   const restored=await p.evaluate(()=>({reply:__wos.V.replyTo,route:__wos.V.snap.route,bytes:__wos.V.parts.reduce((n,b)=>n+b.size,0),held:WosOutbox.get(__wos.V.custodyCapture)?.durable}));
   assert.deepEqual(restored.reply,original.reply);assert.deepEqual(restored.route,original.route);assert.ok(restored.bytes>0);assert.equal(restored.held,true);assert.equal(await p.evaluate(()=>__wos.V.seal.text),'original typed draft');assert.equal(f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length,before);
 });
 await test('held command during parked reply executes locally and restores paused original',async()=>{
   f.R.words='open settings';const before=f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length;
   // Focused text fields deliberately suppress hold-for-command; leave the field first.
   await p.frames().find(x=>x.url().includes('/qa-iching/')).locator('#away').click();
   const touch=await f.context.newCDPSession(p),b=await p.locator('#orbWrap').boundingBox();
   await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:9}]});await p.waitForTimeout(1000);
   await p.waitForFunction(()=>__wos.V.kind==='command'&&__wos.voice==='command');
   await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await p.waitForFunction(()=>__wos.voice==='paused'&&__wos.V.replyTo?.sid==='qa-0',null,{timeout:7000});
   assert.equal(f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length,before);
   await p.evaluate(()=>__wos.closeSheets(true));
 });
 await test('cancelled and failed borrowed dictation keep exact paused original without sends',async()=>{
   const frame=p.frames().find(x=>x.url().includes('/qa-iching/'));
   await p.evaluate(()=>__wos.openApp(WizCore.apps('mobile').APP['qa-iching']));await p.waitForTimeout(350);const fieldFrame=p.frames().find(x=>x.url().includes('/qa-iching/'));await select(fieldFrame);
   const original=await p.evaluate(()=>({id:__wos.V.custodyCapture,text:__wos.V.seal.text,reply:__wos.V.replyTo,route:__wos.V.snap.route})),before=f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length;
   await tap(p);await p.waitForTimeout(500);await p.evaluate(()=>__wos.cancelVoice(true));assert.equal(await p.evaluate(()=>__wos.voice),'paused');
   await select(fieldFrame);f.R.down=true;await tap(p);await p.waitForTimeout(550);await tap(p);await p.waitForFunction(()=>__wos.voice==='paused');f.R.down=false;
   const after=await p.evaluate(()=>({id:__wos.V.custodyCapture,text:__wos.V.seal.text,reply:__wos.V.replyTo,route:__wos.V.snap.route}));assert.deepEqual(after,original);assert.equal(f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length,before);
 });
 await test('denied borrowed microphone restores original paused draft and target',async()=>{
   const fieldFrame=p.frames().find(x=>x.url().includes('/qa-iching/'));await select(fieldFrame);
   await p.evaluate(()=>{window.goodGum=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError');};});
   await tap(p);await p.waitForFunction(()=>__wos.voice==='paused'&&!__wos.voiceBorrowing&&document.querySelector('#toast').textContent.includes('Microphone unavailable'));assert.equal(await p.evaluate(()=>__wos.V.seal.text),'original typed draft');
   await p.evaluate(()=>{navigator.mediaDevices.getUserMedia=goodGum;});
 });
 await test('reload offers explicit parked reply recovery without opening microphone',async()=>{
   const id=await p.evaluate(()=>__wos.V.custodyCapture);await p.reload();await p.waitForFunction(()=>WosOutbox?.recoveryComplete&&window.__wos);
   assert.equal(await p.evaluate(id=>__wos.recoverParkedReply(id),id),true);
   assert.equal(await p.evaluate(()=>__wos.voice),'paused');assert.equal(await p.evaluate(()=>__wos.V.replyTo.sid),'qa-0');assert.equal(await p.evaluate(()=>__wos.V.stream),null);
 });
 await p.waitForTimeout(600);assert.equal(await p.locator('#arcPause').isVisible(),true);await p.screenshot({path:path.join(evidence,'host.png')});
 await test('explicit resume appends original audio and sends original target/model/text once; B excluded',async()=>{
   await tones(p);await p.evaluate(()=>{tone=660;});const original=await p.evaluate(()=>({id:__wos.V.custodyCapture,route:__wos.V.snap.route}));const before=f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length;
   let audio;await f.context.route('**/wizard/files/upload',async r=>{audio=r.request().postDataBuffer();return r.fulfill({json:{file:{id:'resumed-audio',filename:'resumed.wav',mime:'audio/wav',bytes:audio.length}}});});
   await p.locator('#arcPause').click();await p.waitForFunction(()=>__wos.voice==='listen');await p.waitForTimeout(800);f.R.words='Original resumed reply';await p.evaluate(()=>__wos.finishVoice());
   await p.waitForFunction(id=>WosOutbox.get(id)?.state==='sent',original.id,{timeout:15000});
   const writes=f.writes.filter(w=>/\/v1\/runs$/.test(w.path));assert.equal(writes.length,before+1);const body=JSON.parse(writes.at(-1).body);assert.equal(body.session_id,'qa-0');assert.equal(body.model,original.route.model);assert.equal(body.provider,original.route.provider);assert.match(body.input,/original typed draft/);assert.match(body.input,/Original resumed reply/);
   assert.equal(audio.toString('ascii',0,4),'RIFF');const rate=audio.readUInt32LE(24),n=(audio.length-44)/2;const energy=hz=>{let max=0;for(let at=0;at+1600<n;at+=1600){let re=0,im=0;for(let i=0;i<1600;i++){const x=audio.readInt16LE(44+2*(at+i))/32768;re+=x*Math.cos(2*Math.PI*hz*i/rate);im+=x*Math.sin(2*Math.PI*hz*i/rate);}max=Math.max(max,(re*re+im*im)/(1600*1600));}return max;};const spectrum={a:energy(440),b:energy(880),c:energy(660)};assert.ok(spectrum.a>.001);assert.ok(spectrum.c>.001);assert.ok(spectrum.b<.0001);fs.writeFileSync(path.join(evidence,'parked-spectrum.json'),JSON.stringify(spectrum));
 });
 assert.deepEqual(f.errors,[]);
 await test('native old ABI refuses in actual shell; v1 exact receipt admits only borrowed recorder (mock)',async()=>{
   const native=await boot(browser,true),n=native.p;const {installMeetingMock}=require('../qa-app-capture/native-mocks.cjs');await n.evaluate(installMeetingMock);
   await n.evaluate(async()=>{await WosModels.load();window.nmeeting=await WizAppCapture.start('mizel',{kind:'meeting',meta:{meetingId:'native-synthetic-host'}});});
   assert.equal(await n.evaluate(()=>__wos.startVoice('auto')),'busy');assert.equal(await n.evaluate(()=>__wos.voice),'idle');assert.equal(await n.evaluate(()=>WizAppCapture.getState().phase),'recording');
   await n.evaluate(()=>{window.borrowCalls=[];const old=WizardOSDevice.recStart;WizardOSDevice.recStart=()=>{throw Error('ordinary start must not be used');};WizardOSDevice.recHandoffVersion=()=>1;WizardOSDevice.recHandoffBegin=(id,meetingId)=>{borrowCalls.push('begin');emitMeetingState({paused:true});return JSON.stringify({id,meetingId,status:'paused',open:true,atMediaMs:1000,pausedAt:Date.now(),pausedByHandoff:true});};WizardOSDevice.recStartBorrowed=(kind,id)=>{borrowCalls.push('borrowed');return old(kind);};WizardOSDevice.recHandoffEnd=id=>{borrowCalls.push('end');emitMeetingState({paused:false});return JSON.stringify({id,status:'recording',open:false,pausedByHandoff:true});};});
   await n.evaluate(()=>__wos.startVoice('auto'));const binding=await n.evaluate(()=>({take:__wos.V.native,snap:WosOrbHandoff.takeSnap(__wos.V.native)}));assert.ok(binding.take);assert.ok(binding.snap.meetingEventId);await n.evaluate(()=>__wos.cancelVoice(true));
   assert.deepEqual(await n.evaluate(()=>borrowCalls),['begin','borrowed','end']);assert.equal(await n.evaluate(()=>WizAppCapture.getState().phase),'recording');assert.equal(native.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length,0);assert.deepEqual(native.errors,[]);
   await n.reload();await n.waitForFunction(()=>window.WosOrbHandoff&&window.__wos);assert.deepEqual(await n.evaluate(take=>WosOrbHandoff.takeSnap(take),binding.take),binding.snap);await native.context.close();
 });
 await test('native parked reply closes to durable custody and explicit Resume reopens native recorder (mock)',async()=>{
   const native=await boot(browser,true),n=native.p;await n.evaluate(async()=>{await WosModels.load();__wos.openWizardThread('qa-0');});await n.locator('[data-chmic]').first().click();await n.waitForTimeout(600);await n.locator('#arcPause').click();
   const original=await n.evaluate(()=>__wos.V.native);await n.evaluate(()=>__wos.openApp(WizCore.apps('mobile').APP['qa-iching']));await n.waitForTimeout(400);const nf=n.frames().find(x=>x.url().includes('/qa-iching/'));await select(nf);await tap(n);await n.waitForFunction(()=>__wos.V.kind==='dictation'&&!!__wos.V.native);await n.evaluate(()=>__wos.cancelVoice(true));
   assert.equal(await n.evaluate(()=>__wos.voice),'paused');assert.equal(await n.evaluate(()=>__wos.V.resumeNative),true);assert.equal(await n.evaluate(()=>WosOutbox.get(__wos.V.custodyCapture).durable),true);
   await n.waitForTimeout(500);await n.locator('#arcPause').click();await n.waitForFunction(()=>__wos.voice==='listen'&&!!__wos.V.native);assert.notEqual(await n.evaluate(()=>__wos.V.native),original);assert.equal(await n.evaluate(()=>__wos.V.replyTo.sid),'qa-0');assert.deepEqual(native.errors,[]);await native.context.close();
 });
 await test('manual pause during actual loan wins and resume is refused until voice closes',async()=>{
   await p.waitForFunction(()=>__wos.voice==='idle');await tones(p);await p.evaluate(async()=>{window.meeting=await WizAppCapture.start('mizel',{kind:'meeting',chunkMs:500,meta:{meetingId:'manual-during-loan'}});});await p.waitForTimeout(300);await p.evaluate(()=>__wos.startVoice('auto'));await p.waitForTimeout(300);await p.evaluate(()=>meeting.pause());
   assert.equal(await p.evaluate(async()=>{try{await meeting.resume();}catch(e){return e.code;}}),'mic_borrowed');await p.evaluate(()=>__wos.cancelVoice(true));assert.equal(await p.evaluate(()=>WizAppCapture.getState().phase),'paused');await p.evaluate(()=>meeting.stop());
 });
 await test('parked multipart fallback survives IDB failure/reload and explicit deletion removes hidden parts',async()=>{
   const saved=await p.evaluate(async()=>{const old=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(this.name==='items'&&value.parkedDraft)throw new DOMException('synthetic quota','QuotaExceededError');return old.call(this,value,...args);};try{const parts=[new Blob([new Uint8Array([1,2,3])],{type:'audio/test'}),new Blob([new Uint8Array([4,5])],{type:'audio/test'})];const it=await WosOutbox.stage({audio:new Blob(parts),parkedDraft:{parts},kind:'reply',sessionId:'fallback-synthetic'});await WosOutbox.transition(it.id,'held');return {id:it.id,durable:it.durable};}finally{IDBObjectStore.prototype.put=old;}});assert.equal(saved.durable,true);
   await p.reload();await p.waitForFunction(()=>WosOutbox?.recoveryComplete);assert.deepEqual(await p.evaluate(async id=>{const it=WosOutbox.get(id);return Promise.all(it.parkedDraft.parts.map(async b=>Array.from(new Uint8Array(await b.arrayBuffer()))));},saved.id),[[1,2,3],[4,5]]);
   await p.evaluate(id=>WosOutbox.remove(id),saved.id);assert.equal(await p.evaluate(id=>!!WosOutbox.get(id).parkedDraft,saved.id),false);
 });
 assert.deepEqual(f.errors,[]);
 fs.writeFileSync(path.join(evidence,'receipt.json'),JSON.stringify({sourceSHA:process.env.SOURCE_SHA,checks,pageErrors:f.errors,synthetic:true,nativeEvidence:false},null,2));
})().catch(e=>{console.error(e);fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:e.stack,checks},null,2));process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
