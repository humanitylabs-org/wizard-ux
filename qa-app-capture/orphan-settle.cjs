/* Stop-only capture recovery: real Chromium IDB/Web Locks; synthetic native bridge, not phone hardware. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../tools/qa-playwright.cjs');
const src=fs.readFileSync(path.join(__dirname,'../web/core/app-capture.js'));
const server=http.createServer((q,r)=>{r.setHeader('Content-Type',q.url.endsWith('.js')?'text/javascript':'text/html');r.end(q.url.endsWith('.js')?src:'<button id="tap">Mic</button><script src="/capture.js"></script>');});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const b=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM});try{
 const c=await b.newContext(),p=await c.newPage();
 await p.addInitScript(()=>{
  const calls=()=>JSON.parse(localStorage.getItem('native-calls')||'{"start":0,"stop":0,"done":0}');
  const bump=k=>{const v=calls();v[k]++;localStorage.setItem('native-calls',JSON.stringify(v));};
  window.WizardOSDevice={recActive:()=>localStorage.getItem('native-active')||'null',recStart(kind){bump('start');const a={id:'synthetic-native-'+calls().start,kind};localStorage.setItem('native-active',JSON.stringify(a));return a.id;},recLevel:()=>30,
   recStop(id){bump('stop');if(JSON.parse(localStorage.getItem('native-active')||'null')?.id===id)localStorage.removeItem('native-active');return JSON.stringify({ms:5000});},
   recClaim:()=>JSON.stringify({ms:5000}),recRead:()=>JSON.stringify({b64:btoa('synthetic AAC audio'),next:-1}),recDone:()=>bump('done'),recCancel:()=>localStorage.removeItem('native-active')};
 });
 const url='http://127.0.0.1:'+server.address().port;
 await p.goto(url);await p.waitForFunction(()=>window.WizAppCapture);
 assert.deepEqual(await p.evaluate(()=>WizAppCapture.settle('messenger')),[]);
 assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('native-calls')||'{"start":0}').start),0);console.log('PASS no take: settle never starts recorder');
 await p.evaluate(async()=>{window.session=await WizAppCapture.start('messenger',{kind:'audio',meta:{purpose:'messenger-voice',person:'synthetic',micSession:'old-session'}});});
 await p.waitForTimeout(250);const id=await p.evaluate(()=>WizAppCapture.current('messenger').id);
 assert.equal(await p.evaluate(()=>WizAppCapture.current('messenger').recording),true);
 await p.reload();await p.waitForFunction(()=>window.WizAppCapture);await p.waitForFunction(()=>WizAppCapture.current('messenger')?.phase==='recoverable');
 const out=await p.evaluate(async()=>{const ts=await WizAppCapture.settle('messenger');return ts.map(t=>({id:t.id,bytes:t.blob.size,ms:t.durationMs,resumable:!!t.meta.captureRecovery?.resumable}));});
 assert.deepEqual(out,[{id,bytes:19,ms:5000,resumable:false}]);
 assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('native-calls'))),{start:1,stop:1,done:0});
 assert.equal(await p.evaluate(()=>WizAppCapture.current('messenger')),null);await p.evaluate(id=>WizAppCapture.ack('messenger',id),id);
 assert.deepEqual(await p.evaluate(()=>WizAppCapture.pending('messenger')),[]);console.log('PASS reload: running native orphan stopped without start/attach, bytes retained then acked');
 await p.evaluate(async()=>{window.session=await WizAppCapture.start('messenger',{kind:'audio',meta:{micSession:'this-session'}});});const keep=await p.evaluate(()=>session.id);
 await p.evaluate(keep=>WizAppCapture.settle('messenger',keep),keep);
 assert.equal(await p.evaluate(()=>WizAppCapture.current('messenger').recording),true);await p.evaluate(()=>session.cancel());console.log('PASS current explicit take exempted from orphan cleanup');
 await p.evaluate(async()=>{window.session=await WizAppCapture.start('recorder',{kind:'audio'});});
 await p.evaluate(()=>WizAppCapture.settle('messenger'));
 assert.equal(await p.evaluate(()=>WizAppCapture.current('recorder').recording),true);await p.evaluate(()=>session.cancel());console.log('PASS app scope: Messenger cleanup cannot stop Recorder');
 await c.close();console.log('ALL PASS orphan-settle');
}finally{await b.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
