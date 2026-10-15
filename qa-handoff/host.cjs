/* Full actual shell + real WebAudio/IDB + adopted event store. Synthetic network/STT only. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const evidence=process.env.HOST_EVIDENCE,root=path.resolve(__dirname,'..');
if(!evidence?.startsWith('/Volumes/ThalesMedia/')||!os.hostname().startsWith('thales'))throw Error('Thales external QA only');
fs.mkdirSync(evidence,{recursive:true});process.env.QA_WEB_DIR=root;
// Reuse the maintained synthetic host fixture without executing its suite.
let boot,app,select,tap,contexts;
const server=require('node:http').createServer((req,res)=>{const file=path.join(root,'web',decodeURIComponent(req.url.split('?')[0]).replace(/^\/wizard-os-home\//,''));if(!file.startsWith(root+'/web/')||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(file));});
const checks=[];let browser;
async function test(name,fn){await fn();checks.push({name,passed:true});console.log('PASS',name);fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify(checks,null,2));}
async function tones(p){await p.evaluate(()=>{window.tone=440;window.graphs=[];navigator.mediaDevices.getUserMedia=async()=>{const ctx=new AudioContext(),o=ctx.createOscillator(),d=ctx.createMediaStreamDestination();o.frequency.value=tone;o.connect(d);o.start();await ctx.resume();graphs.push({ctx,o,stream:d.stream});return d.stream;};});}
(async()=>{
 const {OrbEvents}=await import(process.env.MIZEL_ADOPTION+'/orb-events.mjs');
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const fixture=fs.readFileSync(path.join(root,'qa-in-app-dictation.cjs'),'utf8').split('async function cases(browser)')[0].replaceAll('https://private.wizard001.com','http://127.0.0.1:'+server.address().port);
 ({boot,app,select,tap,contexts}=new Function('require','__dirname','process',fixture+'\nreturn {boot,app,select,tap,contexts};')((name)=>name==='playwright-core'?{chromium}:require(name),root,process));
 browser=await chromium.launch({executablePath:process.env.CHROMIUM,headless:true,args:['--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 let f=await boot(browser,false),p=f.p;await tones(p);const store=new OrbEvents(path.join(evidence,'events.json'));
 await f.context.route('**/mizel-live/orb-events**',async r=>{try{if(r.request().method()==='PUT'){const event=store.upsert(r.request().postDataJSON());return r.fulfill({json:{event}});}return r.fulfill({json:{events:store.list(new URL(r.request().url()).searchParams.get('meetingId'))}});}catch(e){console.error('EVENT REJECT',e.message,r.request().postData());return r.fulfill({status:409,json:{error:e.message}});}});
 await test('actual shell admits borrowed orb, resumes before delayed STT, sends only explicit question once',async()=>{
   await p.evaluate(async()=>{await WosModels.load();window.meeting=await WizAppCapture.start('mizel',{kind:'meeting',chunkMs:500,meta:{meetingId:'synthetic-host-meeting',title:'PRIVATE MUST NOT SEND'}});});
   await p.waitForTimeout(750);await p.evaluate(()=>{tone=880;});f.R.delay=2200;
   await p.evaluate(()=>__wos.startVoice('auto'));await p.waitForTimeout(750);
   assert.equal(await p.evaluate(()=>WizAppCapture.getState().phase),'handoff');
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
   const input=p.locator('[data-chat-input]').first();if(await input.count())await input.fill('original typed draft');
   await p.locator('[data-chmic]').first().click();await p.waitForTimeout(700);await p.locator('#arcPause').click();
   const original=await p.evaluate(()=>({reply:__wos.V.replyTo,route:__wos.V.snap.route}));assert.equal(original.reply.sid,'qa-0');
   // Open another app without cancelling the parked reply (unlike the old fixture helper).
   await p.evaluate(()=>__wos.openApp(window.__qaApp));await p.waitForTimeout(400);
   const frame=p.frames().find(x=>x.url().includes('/qa-iching/'));await select(frame);
   const before=f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length;
   await tap(p);await p.waitForFunction(()=>__wos.V.kind==='dictation');await p.waitForTimeout(700);await tap(p);
   await p.waitForFunction(()=>__wos.voice==='paused'&&__wos.V.replyTo?.sid==='qa-0');
   assert.equal(await frame.locator('#a').inputValue(),'one spoken words three');
   const restored=await p.evaluate(()=>({reply:__wos.V.replyTo,route:__wos.V.snap.route,bytes:__wos.V.parts.reduce((n,b)=>n+b.size,0),held:WosOutbox.get(__wos.V.custodyCapture)?.durable}));
   assert.deepEqual(restored.reply,original.reply);assert.deepEqual(restored.route,original.route);assert.ok(restored.bytes>0);assert.equal(restored.held,true);assert.equal(f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length,before);
 });
 await test('held command during parked reply executes locally and restores paused original',async()=>{
   f.R.words='open settings';const before=f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length;
   const touch=await f.context.newCDPSession(p),b=await p.locator('#orbWrap').boundingBox();
   await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:9}]});await p.waitForTimeout(1000);
   await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await p.waitForFunction(()=>__wos.voice==='paused'&&__wos.V.replyTo?.sid==='qa-0',null,{timeout:7000});
   assert.equal(f.writes.filter(w=>/\/v1\/runs$/.test(w.path)).length,before);
   await p.evaluate(()=>__wos.closeSheets(true));
 });
 await test('reload offers explicit parked reply recovery without opening microphone',async()=>{
   const id=await p.evaluate(()=>__wos.V.custodyCapture);await p.reload();await p.waitForFunction(()=>WosOutbox?.recoveryComplete&&window.__wos);
   assert.equal(await p.evaluate(id=>__wos.recoverParkedReply(id),id),true);
   assert.equal(await p.evaluate(()=>__wos.voice),'paused');assert.equal(await p.evaluate(()=>__wos.V.replyTo.sid),'qa-0');assert.equal(await p.evaluate(()=>__wos.V.stream),null);
 });
 await p.screenshot({path:path.join(evidence,'host.png')});
 assert.deepEqual(f.errors,[]);
 fs.writeFileSync(path.join(evidence,'receipt.json'),JSON.stringify({sourceSHA:process.env.SOURCE_SHA,checks,pageErrors:f.errors,synthetic:true,nativeEvidence:false},null,2));
})().catch(e=>{console.error(e);fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:e.stack,checks},null,2));process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
