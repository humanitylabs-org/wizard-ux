/* Seam-specific additions to qa-app-capture/run.cjs. Real core/host/client + staged Mizel.
 * Domain backend, display picker, native port are explicitly synthetic fixtures. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto'),vm=require('node:vm');
module.exports=async({browser,root,evidence,test})=>{
 const mizel=process.env.MIZEL_WEB;
 assert.ok(mizel,'MIZEL_WEB must point to the exact staged candidate');
 const core=fs.readFileSync(path.join(root,'web/core/app-capture.js'),'utf8');
 const donor=fs.readFileSync(process.env.MIZEL_BASE_WORKLET,'utf8');
 await test('pcm-byte-parity-with-live-Mizel-worklet-48k-44k1-stereo',async()=>{
  function run(source,rate,name,options){let Type,out=[];class Base{constructor(){this.port={postMessage:m=>{if(m.samples)out.push(new Int16Array(m.samples));}};}}
   const sandbox={AudioWorkletProcessor:Base,sampleRate:rate,registerProcessor:(n,t)=>{if(n===name)Type=t;},Int16Array,Math,globalThis:null};sandbox.globalThis=sandbox;vm.runInNewContext(source,sandbox);const p=new Type(options);
   for(let k=0;k<710;k++){const l=new Float32Array(128),r=new Float32Array(128);for(let i=0;i<128;i++){l[i]=Math.sin((k*128+i)*.123)*.8;r[i]=Math.cos((k*128+i)*.081)*.4;}p.process([[l,r]]);}
   p.port.onmessage({data:name==='wizard-capture-pcm'?'flush':{type:'flush'}});return Buffer.concat(out.map(a=>Buffer.from(a.buffer)));
  }
  for(const rate of [48000,44100])assert.deepEqual(run(core,rate,'wizard-capture-pcm',{}),run(donor,rate,'pcm16-downsampler',{processorOptions:{chunkSeconds:5,targetRate:16000}}));
 });
 const records=new Map(),writes=[],blocked=[],socketFrames=[],events=[];let next=0,corrupt=false,nativeCalls=[];
 const fresh=id=>({id,title:'Synthetic meeting',status:'recording',source:'meetings',created_at:new Date().toISOString(),duration_ms:0,notes:'',notes_rev:0,segments:[],enhanced:null,asks:[],jobs:{transcribe_pending:0},audio:{tracks:[]}});
 const get=id=>{if(!records.has(id))records.set(id,{doc:fresh(id),chunks:new Map()});return records.get(id);};
 function wav(raw){const b=Buffer.alloc(44+raw.length);b.write('RIFF');b.writeUInt32LE(36+raw.length,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(raw.length,40);raw.copy(b,44);return b;}
 function detail(id){const r=get(id),tracks={};for(const c of r.chunks.values())tracks[c.source]=(tracks[c.source]||0)+1;r.doc.audio={tracks:Object.entries(tracks).map(([source,chunks])=>({source,chunks}))};r.doc.duration_ms=Math.round(Math.max(0,...[...r.chunks.values()].map(c=>c.startMs+(c.bytes.length-44)/32)));return r.doc;}
 const hostBoot=`window.WizCore={apps:()=>({APPS:[{id:'mizel',url:'/mizel-live/'},{id:'trackhunt',url:'/trackhunt/'}]})};window.__wos={voice:'idle',V:{native:null},nativeResume:a=>{window.resumes.push(a.id);return true;},toast(){},setVoice(){},txHide(){}};window.resumes=[];window.WizConfig={agent:()=> 'Synthetic',owner:()=> 'Synthetic'};window.__wosReloading=false;`;
 const frameHTML='<!doctype html><html data-app="trackhunt"><button id="go">Capture</button><script src="/wizard-os-home/core/app-client.js"></script></html>';
 const hostHTML='<!doctype html><button id="gesture">Gesture</button><iframe id="frame" style="width:100%;height:900px"></iframe><script src="/boot.js"></script><script src="/wizard-os-home/core/app-capture.js"></script><script src="/wizard-os-home/core/app-services.js"></script><script src="/mount.js"></script>';
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');const send=(body,ct='application/json',status=200)=>{res.writeHead(status,{'Content-Type':ct,'Cache-Control':'no-store'});res.end(typeof body==='object'&&!Buffer.isBuffer(body)?JSON.stringify(body):body);};
  if(!['GET','HEAD'].includes(req.method))writes.push(req.method+' '+u.pathname);
  if(u.pathname==='/host/')return send(hostHTML,'text/html');
  if(u.pathname==='/boot.js')return send(hostBoot,'application/javascript');
  if(u.pathname==='/mount.js')return send(`const f=document.querySelector('#frame');const id=location.search.includes('trackhunt')?'trackhunt':'mizel';f.src='/'+(id==='mizel'?'mizel-live':id)+'/';WizAppServices.attach(f,{appId:id,path:f.src});`,'application/javascript');
  if(u.pathname==='/trackhunt/')return send(frameHTML,'text/html');
  if(u.pathname.startsWith('/wizard-os-home/')){const file=path.resolve(root,'web',u.pathname.slice('/wizard-os-home/'.length));if(!file.startsWith(path.resolve(root,'web')+path.sep)||!fs.existsSync(file))return send('', 'text/plain',404);return send(fs.readFileSync(file),file.endsWith('.js')?'application/javascript':'text/css');}
  if(u.pathname==='/mizel-live/asks')return send({asks:[]});
  if(u.pathname==='/mizel-live/api/calendar')return send([]);
  if(u.pathname==='/mizel-live/api/ask')return send({asks:[],thread:[]});
  if(u.pathname==='/mizel-live/api/meetings'){
   if(req.method==='POST'){let body='';for await(const b of req)body+=b;const id='mt_fixture_'+(++next);const r=get(id);r.doc.title=JSON.parse(body).title||r.doc.title;events.push({type:'created',id,at:Date.now()});return send(r.doc);}
   return send([...records.keys()].map(id=>detail(id)));
  }
  const match=u.pathname.match(/^\/mizel-live\/api\/meetings\/([^/]+)(?:\/(chunks|stop|audio.wav|segments))?$/);
  if(match){const [,id,op]=match,r=get(id);
   if(op==='chunks'){const bytes=[];for await(const b of req)bytes.push(b);const source=u.searchParams.get('source'),seq=+u.searchParams.get('seq'),startMs=+u.searchParams.get('start_ms');const key=source+':'+seq;const body=Buffer.concat(bytes);if(r.chunks.has(key))assert.deepEqual(r.chunks.get(key).bytes,body,'Replayed seq must retain exact PCM bytes');else r.chunks.set(key,{source,seq,startMs,bytes:body});return send({stored:true});}
   if(op==='stop'){let body='';for await(const b of req)body+=b;r.doc.status='processing';r.stop=JSON.parse(body||'{}');events.push({type:'stop',id,body:r.stop});return send(detail(id));}
   if(op==='audio.wav'){const n=Math.max(0,...[...r.chunks.values()].map(c=>Math.round(c.startMs*16)+(c.bytes.length-44)/2)),mixed=new Int32Array(n);for(const c of r.chunks.values()){const offset=Math.round(c.startMs*16);for(let i=44;i<c.bytes.length;i+=2)mixed[offset+(i-44)/2]+=c.bytes.readInt16LE(i);}const raw=Buffer.alloc(n*2);for(let i=0;i<n;i++)raw.writeInt16LE(Math.max(-32768,Math.min(32767,mixed[i])),i*2);if(corrupt&&raw.length)raw[0]^=1;return send(wav(raw),'audio/wav');}
   if(op==='segments')return send({segments:[],transcribe_pending:0,status:r.doc.status});return send(detail(id));
  }
  if(u.pathname.startsWith('/mizel-live/')){const f=path.resolve(mizel,u.pathname.slice('/mizel-live/'.length)||'index.html');if(!f.startsWith(path.resolve(mizel)+path.sep)||!fs.existsSync(f))return send('','text/plain',404);return send(fs.readFileSync(f),f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':'image/svg+xml');}
  send({},'application/json');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 let ctx,p;
 try{
  ctx=await browser.newContext({viewport:{width:1440,height:1100}});
  await ctx.route('**/*',r=>{if(new URL(r.request().url()).origin!==origin){blocked.push(r.request().url());return r.abort();}return r.continue();});
  await ctx.routeWebSocket('**/live',ws=>{ws.onMessage(data=>{socketFrames.push({url:ws.url(),binary:typeof data!=='string',bytes:Buffer.byteLength(data)});if(typeof data==='string')ws.send(JSON.stringify({type:'status',status:'listening'}));});});
  await ctx.addInitScript(()=>{if(window!==parent){window.rawCaptureAttempts=0;for(const name of ['getUserMedia','getDisplayMedia'])if(navigator.mediaDevices?.[name])navigator.mediaDevices[name]=()=>{rawCaptureAttempts++;throw new Error('Raw capture in hosted app is forbidden');};for(const name of ['AudioContext','MediaRecorder'])if(window[name])window[name]=function(){rawCaptureAttempts++;throw new Error('Raw capture in hosted app is forbidden');};return;}
   window.displayPrompts=[];window.mediaAdmissions=0;const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=(...a)=>{mediaAdmissions++;return gum(...a);};navigator.mediaDevices.getDisplayMedia=()=>{displayPrompts.push({active:navigator.userActivation.isActive,at:Date.now()});return gum({audio:true}).then(st=>{window.displayStreams||=[];displayStreams.push(st);return st;});};
  });
  p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await test('Mizel-actual-core-client-host-gesture-stream-reload-system-toggle-durable-ack',async()=>{
   await p.goto(origin+'/host/');const f=()=>p.frames().find(f=>f.url().includes('/mizel-live/'));
   await p.waitForFunction(()=>document.querySelector('iframe').contentWindow.WizardApp?.hosted);
   await f().waitForSelector('#btn-new');await f().evaluate(()=>localStorage.setItem('meetings.systemAudio','1'));
   await f().click('#btn-new');await p.waitForFunction(()=>WizAppCapture.getState().recording);
   await f().waitForSelector('#pill .stop');const id=await p.evaluate(()=>WizAppCapture.getState().id);
   assert.equal(await p.evaluate(()=>displayPrompts[0].active),true);assert.ok(events[0].at>=await p.evaluate(()=>displayPrompts[0].at));
   assert.equal(await f().evaluate(()=>rawCaptureAttempts),0);
   await p.waitForTimeout(5500);assert.ok(socketFrames.some(x=>x.binary));assert.ok([...records.values()][0].chunks.size>=1);
   assert.equal(await p.evaluate(()=>WizAppServices.update.busy()),true);
   const prior=socketFrames.filter(x=>x.binary).length;
   await p.evaluate(()=>document.querySelector('iframe').contentWindow.location.reload());
   await p.waitForFunction(()=>document.querySelector('iframe').contentWindow.WizardApp?.hosted);
   await f().waitForSelector('#pill .stop');await p.waitForTimeout(850);assert.equal(await p.evaluate(()=>WizAppCapture.getState().id),id);assert.ok(socketFrames.filter(x=>x.binary).length>prior,'Fresh iframe receives streaming PCM');
   assert.equal(await p.evaluate(()=>mediaAdmissions),1,'Physical mic did not restart after iframe reload');
   await f().click('#pill button[aria-label="Them: computer audio"]');await f().waitForFunction(()=>document.querySelector('#pill .them').getAttribute('aria-pressed')==='false');
   await p.waitForTimeout(650);await f().click('#pill button[aria-label="Them: computer audio"]');await f().waitForFunction(()=>document.querySelector('#pill .them').getAttribute('aria-pressed')==='true');
   assert.equal(await p.evaluate(()=>displayPrompts[1].active),true,'Mid-recording picker kept activation');
   await f().click('#pill button[aria-label="Pause"]');await p.waitForTimeout(400);await f().click('#pill button[aria-label="Resume"]');await p.waitForTimeout(900);
   await f().click('#pill .stop');await p.waitForFunction(()=>!WizAppCapture.getState().recording);await p.waitForFunction(async()=>!(await WizAppCapture.pending('mizel')).length);
   await p.waitForFunction(()=>!WizAppServices.update.busy());assert.equal(await f().evaluate(()=>rawCaptureAttempts),0);
   const r=[...records.values()][0];for(const source of ['me','them']){const cs=[...r.chunks.values()].filter(c=>c.source===source).sort((a,b)=>a.seq-b.seq);assert.deepEqual(cs.map(c=>c.seq),cs.map((c,i)=>i));assert.equal(r.stop.final_seq[source],cs.at(-1).seq);}
   await p.locator('#frame').screenshot({path:path.join(evidence,'mizel-shared-desktop.png')});
   assert.deepEqual(errors,[]);
  });
  await test('Mizel-mismatched-backend-PCM-retains-shared-custody-and-retry-acks',async()=>{
   await p.goto(origin+'/host/');let f=p.frames().find(f=>f.url().includes('/mizel-live/'));await f.waitForSelector('#btn-new');await f.evaluate(()=>localStorage.setItem('meetings.systemAudio','0'));await f.click('#btn-new');await f.waitForSelector('#pill .stop');await p.waitForTimeout(800);corrupt=true;await f.click('#pill .stop');await f.waitForFunction(()=>document.querySelector('#toasts').textContent.includes('differs'));
   assert.equal(await p.evaluate(async()=>(await WizAppCapture.pending('mizel')).length),1);assert.equal(await p.evaluate(()=>WizAppServices.update.busy()),true);
   const micCount=await p.evaluate(()=>mediaAdmissions);
   await f.evaluate(()=>location.reload());f=p.frames().find(f=>f.url().includes('/mizel-live/'));await f.waitForFunction(()=>document.querySelector('#toasts').textContent.includes('differs'));
   assert.equal(await p.evaluate(async()=>(await WizAppCapture.pending('mizel')).length),1,'Reload retains mismatched backend custody');
   corrupt=false;await f.getByRole('button',{name:'Try again',exact:true}).click();await p.waitForFunction(async()=>!(await WizAppCapture.pending('mizel')).length);
   assert.equal(await p.evaluate(()=>mediaAdmissions),micCount,'Domain Retry saves the old Result, never starts another recorder');
   assert.equal(await p.evaluate(()=>WizAppServices.update.busy()),false);
  });
  await test('Mizel-native-Stop-waits-own-backend-readback-without-error-or-duplicate-uploads',async()=>{
   await ctx.exposeBinding('completeNativeFixture',async(source,id)=>{setTimeout(()=>{const r=get(id),raw=Buffer.alloc(32000);r.chunks.set('me:0',{source:'me',seq:0,startMs:0,bytes:wav(raw)});r.doc.status='processing';},850);});
   const n=await ctx.newPage();await n.addInitScript(()=>{if(window!==parent)return;let st={recording:false},offs=new Set(),pcs=new Set(),lvs=new Set();
    window.wizardNative={meetings:{status:async()=>st,start:async({meetingId})=>{st={recording:true,paused:false,meetingId,mediaMs:1000,pendingChunks:0,livePcm:true};return st;},
     pcm:async(id,on)=>{if(on)setTimeout(()=>{pcs.forEach(cb=>cb({meetingId:id,startMs:0,pcm:new Uint8Array(8000)}));lvs.forEach(cb=>cb(.5));},250);},
     stop:async()=>{st={...st,recording:false,pendingChunks:1};offs.forEach(cb=>cb(st));await completeNativeFixture(st.meetingId);return st;},
     onState:cb=>(offs.add(cb),()=>offs.delete(cb)),onPcm:cb=>(pcs.add(cb),()=>pcs.delete(cb)),onLevel:cb=>(lvs.add(cb),()=>lvs.delete(cb)),pause:async()=>({...st,paused:true}),resume:async()=>({...st,paused:false})}};
   });await n.goto(origin+'/host/');const fr=n.frames().find(f=>f.url().includes('/mizel-live/'));await fr.waitForSelector('#btn-new');await fr.evaluate(()=>localStorage.setItem('meetings.systemAudio','0'));await fr.click('#btn-new');await fr.waitForSelector('#pill .stop');await n.waitForTimeout(400);await fr.click('#pill .stop');
   await n.waitForFunction(()=>!WizAppCapture.getState().recording);assert.equal(await n.evaluate(()=>WizAppServices.update.busy()),true,'Native microphone stopped but domain save remains held');
   await n.waitForFunction(async()=>!(await WizAppCapture.pending('mizel')).length);await n.waitForFunction(()=>!WizAppServices.update.busy());
   assert.equal(await fr.evaluate(()=>document.querySelector('#toasts').textContent.includes('Audio retained')),false,'Normal native upload drain is not a false error');
   const nativeId=await fr.evaluate(()=>mizel.state().meetingId);assert.equal(writes.filter(w=>w==='POST /mizel-live/api/meetings/'+nativeId+'/chunks'||w==='POST /mizel-live/api/meetings/'+nativeId+'/stop').length,0,'App never duplicates native-owned chunk uploads or final-sequence Stop');
   assert.equal(await fr.evaluate(()=>rawCaptureAttempts),0);await n.close();
  });
  await test('native-DeviceBridge-ownership-exact-live-recovery-legacy-import-isolation',async()=>{
   const q=await ctx.newPage();await q.addInitScript(()=>{if(window!==parent)return;const saved=JSON.parse(localStorage.getItem('seam-device')||'{"active":null,"takes":{}}');const save=()=>localStorage.setItem('seam-device',JSON.stringify(saved));window.deviceActions=[];
    window.WizardOSDevice={version:()=>1,updateState:()=> 'null',updateCheck(){},recActive:()=>JSON.stringify(saved.active),recPending:()=>JSON.stringify(Object.values(saved.takes).filter(t=>t.id!==saved.active?.id)),
     recStart:kind=>{if(saved.active)throw new Error('busy');const id='native_'+Date.now();saved.active={id,kind,ms:1250,paused:false,source:'app'};saved.takes[id]={id,kind,ms:1250,bytes:8,mime:'audio/aac',send:true};save();deviceActions.push('start:'+kind);return id;},recLevel:()=>50,recStop:id=>{saved.active=null;save();return JSON.stringify(saved.takes[id]);},recClaim:id=>{deviceActions.push('claim:'+id);return JSON.stringify(saved.takes[id]);},recRead:()=>JSON.stringify({b64:btoa('AAC-data'),next:-1}),recCancel:id=>{delete saved.takes[id];saved.active=null;save();},recDone:id=>{deviceActions.push('done:'+id);delete saved.takes[id];save();},recPause:on=>{saved.active.paused=on;save();}};
   });
   await q.goto(origin+'/host/?trackhunt');let fr=q.frames().find(f=>f.url().includes('/trackhunt/'));await fr.waitForFunction(()=>WizardApp.hosted);await fr.evaluate(()=>document.querySelector('#go').onclick=async()=>{window.take=await WizardApp.capture.start({kind:'audio'});});await fr.click('#go');await q.waitForFunction(()=>WizAppCapture.getState().recording);
   const takeId=await q.evaluate(()=>WizAppCapture.getState().id),nativeId=await q.evaluate(()=>JSON.parse(WizardOSDevice.recActive()).id);
   assert.deepEqual(await q.evaluate(()=>WizAppCapture.getState().nativeDeviceTakeIds),[nativeId]);
   await q.reload();await q.waitForFunction(()=>WizAppCapture.getState().nativeOwnershipReady);assert.equal(await q.evaluate(()=>WizAppCapture.getState().recording),true);assert.equal(await q.evaluate(()=>WizAppCapture.getState().hold),true);
   await q.addScriptTag({url:origin+'/wizard-os-home/device.js'});await q.waitForTimeout(150);assert.deepEqual(await q.evaluate(()=>resumes),[]);assert.deepEqual(await q.evaluate(()=>deviceActions),[]);
   fr=q.frames().find(f=>f.url().includes('/trackhunt/'));await fr.evaluate(async id=>{window.take=await WizardApp.capture.start({resumeId:id,kind:'audio'});window.result=await take.stop();},takeId);
   assert.deepEqual(await q.evaluate(()=>deviceActions),[],'Legacy importer did not claim/send/delete a task take');
   await fr.evaluate(id=>WizardApp.capture.ack(id),takeId);assert.deepEqual(await q.evaluate(()=>deviceActions),['done:'+nativeId]);
   await q.evaluate(()=>{window.legacyId=WizardOSDevice.recStart('auto');dispatchEvent(new Event('wos-native-resume'));});assert.deepEqual(await q.evaluate(()=>resumes),[await q.evaluate(()=>legacyId)]);
   await q.evaluate(()=>WizardOSDevice.recCancel(legacyId));await q.close();
  });
  fs.writeFileSync(path.join(evidence,'integration-manifest.json'),JSON.stringify({mizelSHA256:crypto.createHash('sha256').update(fs.readFileSync(path.join(mizel,'app.js'))).digest('hex'),coreSHA256:crypto.createHash('sha256').update(core).digest('hex'),writes,blocked,socketFrames,events,limitations:['Synthetic backend/microphone/display/native-port; physical/native service acceptance is separate.'],productionWrites:0},null,2));
 }catch(e){if(p)fs.writeFileSync(path.join(evidence,'seam-failure-context.json'),JSON.stringify(await p.evaluate(()=>({capture:WizAppCapture.getState(),host:WizAppServices.inspect(),app:document.querySelector('iframe')?.contentWindow?.mizel?.state?.(),toasts:document.querySelector('iframe')?.contentDocument?.querySelector('#toasts')?.textContent})),null,2));throw e;}finally{await ctx?.close();await new Promise(r=>server.close(r));}
};
