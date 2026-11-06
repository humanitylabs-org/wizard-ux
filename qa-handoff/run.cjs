/* Synthetic capture seam proof; no credentials, production endpoints or model calls. */
const fs=require('node:fs'), path=require('node:path'), http=require('node:http'), assert=require('node:assert/strict'), os=require('node:os');
const {chromium}=require('../tools/qa-playwright.cjs');
const root=path.resolve(__dirname,'..'), evidence=process.env.HANDOFF_EVIDENCE;
if(!require('../tools/qa-paths.cjs').inWorkRoot(evidence) || !process.env.WIZARD_WORK_ROOT) throw Error('Thales external evidence directory required');
fs.mkdirSync(evidence,{recursive:true});
const results=[]; let browser;
const server=http.createServer((req,res)=>{
  const files={'/capture.js':'web/core/app-capture.js','/outbox.js':'web/outbox.js'};
  if(files[req.url]) {res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,files[req.url])));}
  else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><button id="go">Record synthetic meeting</button><script src="/capture.js"></script><script src="/outbox.js"></script>');}
});
async function test(name,fn){await fn();results.push({name,passed:true});console.log('PASS',name);fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify(results,null,2));}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r)); const url='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM,headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext(), p=await context.newPage(); const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(url); await p.waitForFunction(()=>window.WizAppCapture && window.WosOutbox?.recoveryComplete);
 async function setup(system=false){await p.evaluate(system=>{
   window.session=null;window.tone=440;window.streams=[];window.graphs=[];window.chunks=[];window.warnings=[];
   navigator.mediaDevices.getUserMedia=async()=>{const ctx=new AudioContext(),osc=ctx.createOscillator(),dest=ctx.createMediaStreamDestination();osc.frequency.value=tone;osc.connect(dest);osc.start();await ctx.resume();streams.push(dest.stream);graphs.push({ctx,osc});return dest.stream;};
   navigator.mediaDevices.getDisplayMedia=()=>navigator.mediaDevices.getUserMedia({audio:true});
   document.querySelector('#go').onclick=async()=>{window.session=await WizAppCapture.start('mizel',{kind:'meeting',chunkMs:1000,systemAudio:system,meta:{meetingId:'synthetic-meeting'},onWarn:w=>warnings.push(w),onChunk:c=>chunks.push(c)});};
 },system);await p.click('#go');await p.waitForFunction(()=>window.session);}
 await test('A-meeting-B-voice-C-same-meeting-durable-separate-audio',async()=>{
   await setup();await p.waitForTimeout(900);
   const before=await p.evaluate(async()=>{window.loan=await WizAppCapture.beginVoiceBorrow('handoff-synthetic-1');return {loan,live:streams.flatMap(s=>s.getTracks()).filter(t=>t.readyState==='live').length,state:WizAppCapture.getState()};});
   assert.equal(before.live,0);assert.equal(before.loan.micReleased,true);assert.equal(before.state.hold,true);assert.equal(before.state.appId,'mizel');
   assert.equal(await p.evaluate(async()=>{try{await WizAppCapture.beginVoiceBorrow('handoff-synthetic-2');}catch(e){return e.code;}}),'busy');
   const other=await context.newPage();await other.goto(url);assert.equal(await other.evaluate(async()=>{try{await WizAppCapture.start('other',{kind:'song'});}catch(e){return e.code;}}),'busy');await other.close();
   await p.evaluate(async()=>{tone=880;window.voiceStream=await navigator.mediaDevices.getUserMedia({audio:true});window.voiceParts=[];window.rec=new MediaRecorder(voiceStream);rec.ondataavailable=e=>voiceParts.push(e.data);rec.start(100);});
   await p.waitForTimeout(650);
   const saved=await p.evaluate(async()=>{await new Promise(r=>{rec.onstop=r;rec.stop();});voiceStream.getTracks().forEach(t=>t.stop());window.voiceBlob=new Blob(voiceParts,{type:rec.mimeType});const item=await WosOutbox.capture(voiceBlob,'synthetic-voice-B');await WosOutbox.transition(item.id,'held');tone=660;const ended=await WizAppCapture.endVoiceBorrow(loan.id,{voiceTakeId:item.id});return {durable:item.durable,bytes:voiceBlob.size,ended,state:WizAppCapture.getState()};});
   assert.equal(saved.durable,true);assert.ok(saved.bytes>100);assert.equal(saved.ended.resumeStatus,'recording');assert.equal(saved.state.id,before.state.id);
   await p.waitForTimeout(900);
   const audio=await p.evaluate(async()=>{window.meeting=await session.stop();const data=new DataView(await meeting.blob.arrayBuffer());let powers={};const n=(data.byteLength-44)/2;for(const f of [440,660,880]){let re=0,im=0;for(let i=0;i<n;i++){const x=data.getInt16(44+i*2,true)/32768;re+=x*Math.cos(2*Math.PI*f*i/16000);im+=x*Math.sin(2*Math.PI*f*i/16000);}powers[f]=(re*re+im*im)/(n*n);}return {id:meeting.id,bytes:meeting.blob.size,ms:meeting.durationMs,powers,markers:meeting.meta.handoffs,events:chunks.map(c=>({seq:c.seq,startMs:c.startMs,bytes:c.blob.size}))};});
   assert.ok(audio.powers[440]>audio.powers[880]*50);assert.ok(audio.powers[660]>audio.powers[880]*50);
   assert.equal(audio.markers.length,1);assert.equal(audio.markers[0].voiceTakeId,'synthetic-voice-B');assert.equal(audio.markers[0].meetingId,'synthetic-meeting');
   assert.ok(audio.events.length>=2);for(let i=1;i<audio.events.length;i++){assert.equal(audio.events[i].seq,audio.events[i-1].seq+1);assert.ok(audio.events[i].startMs>audio.events[i-1].startMs);}
   await p.reload();await p.waitForFunction(()=>window.WosOutbox?.recoveryComplete);
   const recovered=await p.evaluate(async()=>{const m=(await WizAppCapture.pending('mizel'))[0],v=WosOutbox.get('synthetic-voice-B');return {meetingBytes:m.blob.size,voiceBytes:v.audio.size,id:m.id,markers:m.meta.handoffs,voiceState:v.state};});
   assert.equal(recovered.meetingBytes,audio.bytes);assert.equal(recovered.voiceBytes,saved.bytes);assert.equal(recovered.voiceState,'held');assert.equal(recovered.id,audio.id);
   fs.writeFileSync(path.join(evidence,'abc-proof.json'),JSON.stringify({before,saved,audio,recovered},null,2));
   await p.evaluate(id=>WizAppCapture.ack('mizel',id),audio.id);
 });
 await test('manual-pause-is-not-auto-resumed-and-explicit-resume-works',async()=>{
   await setup();await p.waitForTimeout(400);await p.evaluate(()=>session.pause());
   const marker=await p.evaluate(async()=>{const b=await WizAppCapture.beginVoiceBorrow('handoff-manual-pause');return WizAppCapture.endVoiceBorrow(b.id,{status:'cancelled'});});
   assert.equal(marker.resumeStatus,'paused');assert.equal(await p.evaluate(()=>streams.flatMap(s=>s.getTracks()).filter(t=>t.readyState==='live').length),0);
   await p.evaluate(()=>session.resume());assert.equal(await p.evaluate(()=>WizAppCapture.getState().phase),'recording');await p.waitForTimeout(300);
   await p.evaluate(async()=>{const r=await session.stop();await WizAppCapture.ack('mizel',r.id);});
 });
 await test('stop-during-loan-never-restarts-meeting',async()=>{
   await setup();await p.waitForTimeout(300);await p.evaluate(()=>WizAppCapture.beginVoiceBorrow('handoff-stop-test'));
   await p.evaluate(async()=>{const r=await session.stop();await WizAppCapture.ack('mizel',r.id);});
   assert.equal(await p.evaluate(async()=>{try{await WizAppCapture.endVoiceBorrow('handoff-stop-test');}catch(e){return e.code;}}),'stale_handoff');assert.equal(await p.evaluate(()=>WizAppCapture.getState().active),false);
 });
 await test('all-meeting-tracks-release-and-computer-audio-needs-opt-in',async()=>{
   await setup(true);await p.waitForTimeout(400);
   assert.equal(await p.evaluate(()=>streams.flatMap(s=>s.getTracks()).filter(t=>t.readyState==='live').length),2);
   await p.evaluate(()=>WizAppCapture.beginVoiceBorrow('handoff-two-tracks'));
   assert.equal(await p.evaluate(()=>streams.flatMap(s=>s.getTracks()).filter(t=>t.readyState==='live').length),0);
   await p.evaluate(()=>WizAppCapture.endVoiceBorrow('handoff-two-tracks',{voiceTakeId:'retained-B'}));
   assert.equal(await p.evaluate(()=>streams.flatMap(s=>s.getTracks()).filter(t=>t.readyState==='live').length),1);
   assert.ok(await p.evaluate(()=>warnings.some(w=>w.includes('Computer audio is off'))));
   await p.waitForTimeout(300);const tracks=await p.evaluate(async()=>{const r=await session.stop();return r.meta.captureTracks.map(t=>({source:t.source,bytes:t.blob.size}));});
   assert.ok(tracks.some(t=>t.source==='them'&&t.bytes>44));
 });
 await test('stop-racing-pause-grants-no-late-lease',async()=>{
   await setup();await p.waitForTimeout(300);
   const race=await p.evaluate(async()=>{const a=WizAppCapture.beginVoiceBorrow('handoff-race-start').then(()=> 'granted',e=>e.code);const stopped=await session.stop();return {result:await a,bytes:stopped.blob.size,active:WizAppCapture.getState().active};});
   assert.equal(race.result,'stale_handoff');assert.ok(race.bytes>44);assert.equal(race.active,false);
 });
 await test('duplicate-return-does-not-open-two-microphones',async()=>{
   await setup();await p.waitForTimeout(300);await p.evaluate(()=>WizAppCapture.beginVoiceBorrow('handoff-double-end'));
   const race=await p.evaluate(async()=>{const a=WizAppCapture.endVoiceBorrow('handoff-double-end');const b=WizAppCapture.endVoiceBorrow('handoff-double-end').then(()=> 'accepted',e=>e.code);await a;return {second:await b,live:streams.flatMap(s=>s.getTracks()).filter(t=>t.readyState==='live').length};});
   assert.equal(race.second,'busy');assert.equal(race.live,1);await p.evaluate(()=>session.stop());
 });
 await test('storage-failure-grants-no-lease-and-preserves-A',async()=>{
   await setup();await p.waitForTimeout(300);
   const result=await p.evaluate(async()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(this.name==='sessions'&&value.meta?.handoffs?.length){IDBObjectStore.prototype.put=original;throw new DOMException('fixture','QuotaExceededError');}return original.call(this,value,...args);};let failure;try{await WizAppCapture.beginVoiceBorrow('handoff-storage-fail');}catch(e){failure=e.name;}finally{IDBObjectStore.prototype.put=original;}const state=WizAppCapture.getState();const r=await session.stop();return {failure,released:state.voiceBorrow?.micReleased,bytes:r.blob.size};});
   assert.equal(result.failure,'QuotaExceededError');assert.equal(result.released,false);assert.ok(result.bytes>44);
 });
 await test('resume-permission-denial-keeps-meeting-paused-and-audio',async()=>{
   await setup();await p.waitForTimeout(300);await p.evaluate(()=>WizAppCapture.beginVoiceBorrow('handoff-denied-test'));
   await p.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError');};});
   const marker=await p.evaluate(()=>WizAppCapture.endVoiceBorrow('handoff-denied-test',{voiceTakeId:'retained-voice'}));
   assert.equal(marker.resumeStatus,'failed');assert.equal(await p.evaluate(()=>WizAppCapture.getState().phase),'paused');
   const bytes=await p.evaluate(async()=>{const r=await session.stop();return r.blob.size;});assert.ok(bytes>44);
 });
 assert.deepEqual(errors,[]);await p.screenshot({path:path.join(evidence,'browser.png')});
 fs.writeFileSync(path.join(evidence,'receipt.json'),JSON.stringify({passed:true,host:os.hostname(),sourceSHA:process.env.SOURCE_SHA,results,scope:'Synthetic browser capture seam, not shell integration/native device/STT/backend/visual acceptance'},null,2));
})().catch(e=>{console.error(e);fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:String(e.stack),results},null,2));process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
