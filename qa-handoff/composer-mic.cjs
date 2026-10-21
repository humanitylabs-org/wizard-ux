/* Composer mic during a Mizel meeting (James, 18 Oct 2026: "If I have a thread open and I hit the microphone button and
 * not the orb, it still blocks it. The orb works."). Real shell, real WebAudio/MediaRecorder, real IndexedDB outbox,
 * real orb handoff journal; synthetic network/STT only. Proves the thread mic borrows the meeting's microphone through
 * the orb's own pathway, sends the reply to the thread it was started in, and hands the microphone back.
 * Thales only: HOST_EVIDENCE=$WIZARD_WORK_ROOT/... PLAYWRIGHT_MODULE=... CHROMIUM=... node qa-handoff/composer-mic.cjs
 * Negative control: the same script against daily before this fix fails case 1 ("Microphone held by another app"). */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('../tools/qa-playwright.cjs');
const evidence=process.env.HOST_EVIDENCE,root=path.resolve(process.env.QA_WEB_ROOT||path.join(__dirname,'..'));
if(!require('../tools/qa-paths.cjs').inWorkRoot(evidence)||!process.env.WIZARD_WORK_ROOT)throw Error('Thales external QA only');
fs.mkdirSync(evidence,{recursive:true});process.env.QA_WEB_DIR=root;
let boot,select,tap,contexts;
const server=require('node:http').createServer((req,res)=>{const file=path.join(root,'web',decodeURIComponent(req.url.split('?')[0]).replace(/^\/wizard-os-home\//,''));if(!file.startsWith(root+'/web/')||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(file));});
const checks=[];let browser,failed=0;
async function test(name,fn){try{await fn();checks.push({name,passed:true});console.log('PASS',name);}catch(e){failed++;checks.push({name,passed:false,error:String(e.stack||e).slice(0,1500)});console.log('FAIL',name,'\n ',String(e.message||e).slice(0,600));}fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify(checks,null,2));}
async function tones(p){await p.evaluate(()=>{window.tone=440;window.graphs=[];navigator.mediaDevices.getUserMedia=async()=>{const ctx=new AudioContext(),o=ctx.createOscillator(),d=ctx.createMediaStreamDestination();o.frequency.value=tone;o.connect(d);o.start();await ctx.resume();graphs.push({ctx,o,stream:d.stream});return d.stream;};});}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 process.env.WIZARD_ORIGIN='http://127.0.0.1:'+server.address().port;
 const fixture=fs.readFileSync(path.join(__dirname,'..','qa-in-app-dictation.cjs'),'utf8').split('async function cases(browser)')[0].replace('?.slice(0, 500)','');
 ({boot,select,tap,contexts}=new Function('require','__dirname','process',fixture+'\nreturn {boot,select,tap,contexts};')(require('node:module').createRequire(path.join(root,'package.json')),root,process));
 browser=await chromium.launch({executablePath:process.env.CHROMIUM,headless:true,args:['--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 const f=await boot(browser,false),p=f.p;await tones(p);const events=[];
 await f.context.route('**/mizel-live/orb-events**',async r=>{if(r.request().method()==='PUT'){const ev=r.request().postDataJSON();const i=events.findIndex(e=>e.id===ev.id);if(i>=0)events[i]=ev;else events.push(ev);return r.fulfill({json:{event:ev}});}return r.fulfill({json:{events:events.filter(e=>e.meetingId===new URL(r.request().url()).searchParams.get('meetingId'))}});});
 const runs=()=>f.writes.filter(w=>/\/v1\/runs$/.test(w.path));
 await p.evaluate(()=>WosModels.load());
 await test('thread composer mic borrows a recording meeting instead of refusing',async()=>{
   await p.evaluate(async()=>{window.meeting=await WizAppCapture.start('mizel',{kind:'meeting',chunkMs:500,meta:{meetingId:'composer-mic-meeting',title:'PRIVATE MEETING'}});});
   await p.waitForTimeout(700);
   await p.evaluate(()=>__wos.openWizardThread('qa-0'));const mic=p.locator('[data-chmic]').first();await mic.waitFor();
   await p.evaluate(()=>{tone=880;document.querySelector('#toast').textContent='';});
   await mic.click();
   await p.waitForFunction(()=>WizAppCapture.getState().phase==='handoff'&&__wos.voice==='listen',null,{timeout:4000}).catch(()=>{});
   const st=await p.evaluate(()=>({voice:__wos.voice,phase:WizAppCapture.getState().phase,reply:__wos.V.replyTo,loan:!!__wos.V.meetingLoan,toast:document.querySelector('#toast').textContent,lit:document.querySelector('[data-chmic]')?.classList.contains('on')}));
   fs.writeFileSync(path.join(evidence,'mic-start.json'),JSON.stringify(st,null,2));await p.screenshot({path:path.join(evidence,'1-mic-recording.png')});
   assert.doesNotMatch(st.toast,/held by another app/i,'no "Microphone held by another app" refusal');
   assert.equal(st.voice,'listen');assert.equal(st.phase,'handoff');assert.equal(st.loan,true);
   assert.equal(st.reply?.sid,'qa-0','reply pinned to the open thread');assert.equal(st.lit,true,'thread mic lit');
 });
 await test('second mic tap sends the reply to that thread once and the meeting resumes',async()=>{
   const before=runs().length;await p.waitForTimeout(800);await p.evaluate(()=>{tone=660;});
   await p.locator('[data-chmic]').first().click();
   await p.waitForFunction(()=>WizAppCapture.getState().phase==='recording',null,{timeout:4000});
   assert.equal(await p.evaluate(()=>WizAppCapture.getState().meetingId),'composer-mic-meeting','same meeting continues');
   await p.waitForFunction(()=>Array.from(WosOutbox._items.values()).some(i=>i.meetingEventId&&i.state==='sent'),null,{timeout:15000});
   const w=runs().slice(before);assert.equal(w.length,1,'one send');const body=JSON.parse(w[0].body);
   assert.equal(body.session_id,'qa-0','delivered to the thread the mic was tapped in');
   assert.ok(!w[0].body.includes('PRIVATE'),'meeting content stays out of the message');
   const it=await p.evaluate(()=>{const i=Array.from(WosOutbox._items.values()).find(i=>i.meetingEventId&&i.state==='sent');return {sessionId:i.sessionId,steer:i.steerRunId,ev:WosOrbHandoff.read()[i.meetingEventId]};});
   assert.equal(it.sessionId,'qa-0');assert.equal(it.steer,'');assert.equal(it.ev.meetingId,'composer-mic-meeting');assert.equal(it.ev.routing?.target?.thread||'qa-0','qa-0');
   await p.waitForFunction(()=>__wos.voice==='idle',null,{timeout:8000});
   await p.screenshot({path:path.join(evidence,'2-sent.png')});
 });
 await test('cancel from the orb during a mic loan hands the same meeting back with no send',async()=>{
   // A sent voice reply steps back to the list (like a typed send); reopen the thread.
   const before=runs().length;await p.evaluate(()=>__wos.openWizardThread('qa-0'));await p.locator('[data-chmic]').first().click();
   await p.waitForFunction(()=>WizAppCapture.getState().phase==='handoff'&&__wos.voice==='listen',null,{timeout:4000});
   await p.waitForTimeout(400);await p.evaluate(()=>__wos.cancelVoice(true));
   await p.waitForFunction(()=>WizAppCapture.getState().phase==='recording',null,{timeout:4000});
   await p.waitForTimeout(600);assert.equal(runs().length,before);assert.equal(await p.evaluate(()=>__wos.V.replyTo),null);
 });
 await test('orb parity: the orb still borrows the same meeting',async()=>{
   await p.evaluate(()=>__wos.startVoice('auto'));await p.waitForFunction(()=>WizAppCapture.getState().phase==='handoff',null,{timeout:4000});
   await p.evaluate(()=>__wos.cancelVoice(true));await p.waitForFunction(()=>WizAppCapture.getState().phase==='recording',null,{timeout:4000});
   await p.evaluate(async()=>{await meeting.stop();});
 });
 await test('no meeting: thread mic records and sends a normal reply',async()=>{
   await p.waitForFunction(()=>__wos.voice==='idle');const before=runs().length;await p.evaluate(()=>__wos.openWizardThread('qa-0'));
   await p.locator('[data-chmic]').first().click();await p.waitForFunction(()=>__wos.voice==='listen'&&__wos.V.replyTo?.sid==='qa-0',null,{timeout:4000});
   await p.waitForTimeout(800);await p.locator('[data-chmic]').first().click();
   const ok=await (async()=>{for(let i=0;i<60;i++){if(runs().length>before)return true;await p.waitForTimeout(250);}return false;})();
   assert.ok(ok,'reply sent');assert.equal(JSON.parse(runs().at(-1).body).session_id,'qa-0');
 });
 await test('no page errors',async()=>{assert.deepEqual(f.errors,[]);});
 await test('phone (native meeting recorder, ABI v1 mock): thread mic takes the borrowed native recorder pinned to the thread',async()=>{
   const native=await boot(browser,true),n=native.p;const {installMeetingMock}=require('../qa-app-capture/native-mocks.cjs');await n.evaluate(installMeetingMock);
   await n.evaluate(async()=>{await WosModels.load();window.nmeeting=await WizAppCapture.start('mizel',{kind:'meeting',meta:{meetingId:'native-composer-mic'}});});
   await n.evaluate(()=>{window.borrowCalls=[];const old=WizardOSDevice.recStart;WizardOSDevice.recStart=()=>{throw Error('ordinary start must not be used');};WizardOSDevice.recHandoffVersion=()=>1;WizardOSDevice.recHandoffBegin=(id,meetingId)=>{borrowCalls.push('begin');emitMeetingState({paused:true});return JSON.stringify({id,meetingId,status:'paused',open:true,atMediaMs:1000,pausedAt:Date.now(),pausedByHandoff:true});};WizardOSDevice.recStartBorrowed=(kind,id)=>{borrowCalls.push('borrowed');return old(kind);};WizardOSDevice.recHandoffEnd=id=>{borrowCalls.push('end');emitMeetingState({paused:false});return JSON.stringify({id,status:'recording',open:false,pausedByHandoff:true});};});
   await n.evaluate(()=>__wos.openWizardThread('qa-0'));const mic=n.locator('[data-chmic]').first();await mic.waitFor();await mic.click();
   await n.waitForFunction(()=>!!__wos.V.native&&__wos.voice==='listen',null,{timeout:4000});
   const st=await n.evaluate(()=>({calls:borrowCalls.slice(),take:__wos.V.native,reply:__wos.V.replyTo,pin:window.__wosReplyTake(__wos.V.native),snap:WosOrbHandoff.takeSnap(__wos.V.native)}));
   fs.writeFileSync(path.join(evidence,'native-mic-start.json'),JSON.stringify(st,null,2));
   assert.deepEqual(st.calls,['begin','borrowed']);assert.equal(st.reply.sid,'qa-0');assert.equal(st.pin?.sid,'qa-0','reload-safe reply pin saved for the native take');assert.ok(st.snap?.meetingEventId);
   await n.evaluate(()=>__wos.cancelVoice(true));await n.waitForFunction(()=>borrowCalls.includes('end'),null,{timeout:4000});
   assert.equal(await n.evaluate(()=>WizAppCapture.getState().phase),'recording');assert.equal(native.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length,0);assert.deepEqual(native.errors,[]);
   await native.context.close();
 });
 fs.writeFileSync(path.join(evidence,'receipt.json'),JSON.stringify({sourceSHA:process.env.SOURCE_SHA,webRoot:root,checks,pageErrors:f.errors,synthetic:true,nativeEvidence:false},null,2));
 console.log(`\n${checks.length-failed}/${checks.length} passed`);process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:e.stack,checks},null,2));process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
