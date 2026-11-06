/* Synthetic timing/custody regression: real Chromium GUM/MediaRecorder/IDB/Web Locks, no owner data. */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const root = path.resolve(__dirname, '..'), evidence = process.env.CAPTURE_EVIDENCE || path.join(__dirname, 'evidence-instant');
fs.mkdirSync(evidence, {recursive:true});
let source = fs.readFileSync(process.env.CAPTURE_SOURCE || path.join(root, 'web/core/app-capture.js'), 'utf8');
// Timing setter is test-only; production records no message/audio content or device telemetry.
source = source.replace('active = s;', "Object.defineProperty(s, 'stage', {get(){return this._stage;},set(v){this._stage=v;(window.startStages ||= []).push({stage:v,at:performance.now()});}}); active = s;");
const server = http.createServer((req,res) => {res.setHeader('Content-Type', req.url.includes('.js')?'text/javascript':'text/html'); res.end(req.url.includes('.js')?source:'<!doctype html><button id="tap">Record</button><script src="/capture.js"></script>');});
let browser; const results=[];
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({executablePath:process.env.CHROMIUM,headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 for(const mode of (process.env.INSTANT_MODES?.split(',') || ['normal','slow-store','slow-row','slow-recovery','hung-meter','permission','native','native-slow-store','storage-failure','occupied-lock'])) {
  const ctx=await browser.newContext(), p=await ctx.newPage();
  await p.addInitScript(({mode})=>{
   window.stageMode=mode; window.warnings=[];
   if(mode==='slow-store'||mode==='native-slow-store') {
    const open=indexedDB.open.bind(indexedDB);
    indexedDB.open=(...a)=>{const r=open(...a), desc=Object.getOwnPropertyDescriptor(IDBRequest.prototype,'onsuccess');Object.defineProperty(r,'onsuccess',{set(fn){desc.set.call(r,e=>setTimeout(()=>fn.call(r,e),1400));}});return r;};
   }
   if(mode==='slow-row'||mode==='slow-recovery') {
    const tx=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(stores,...a){const t=tx.call(this,stores,...a);if(a[0]===(mode==='slow-row'?'readwrite':'readonly')){const d=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');Object.defineProperty(t,'oncomplete',{set(fn){d.set.call(t,e=>setTimeout(()=>fn.call(t,e),1400));}});}return t;};
   }
   if(mode==='hung-meter') AudioContext.prototype.resume=()=>new Promise(()=>{});
   if(mode==='permission') {const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=(o)=>new Promise(r=>window.grant=()=>gum(o).then(r));}
   if(mode==='native'||mode==='native-slow-store') {
    let active=null; window.nativeCalls=[];
    window.WizardOSDevice={recActive:()=>JSON.stringify(active),recStart(kind){nativeCalls.push({method:'recStart',at:performance.now()});active={id:'synthetic-native'};return active.id;},recLevel:()=>25,recStop:()=>{active=null;return JSON.stringify({ms:800});},recRead:()=>JSON.stringify({b64:btoa('synthetic AAC bytes'),next:-1}),recDone:()=>{},recCancel:()=>{active=null;}};
   }
  },{mode});
  await p.goto('http://127.0.0.1:'+server.address().port);await p.waitForFunction(()=>!!window.WizAppCapture);
  await p.evaluate(()=>{document.querySelector('#tap').onclick=async()=>{window.tapped=performance.now();try{const attached=await WizAppCapture.attach('messenger');window.session=attached||await WizAppCapture.start('messenger',{kind:'audio',chunkMs:100,onWarn:w=>warnings.push(w)});window.started=performance.now();}catch(e){window.err={code:e.code,message:e.message};}};});
  if(mode==='occupied-lock') await p.evaluate(async()=>{window.held=new Promise(r=>window.unlock=r);window.lockReady=new Promise(resolve=>navigator.locks.request('wizard-app-capture-v1:microphone',async()=>{resolve();await held;}));await lockReady;});
  if(mode==='storage-failure') await p.evaluate(()=>{window.realTx=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(s,...a){if(a[0]==='readwrite')throw new DOMException('synthetic quota','QuotaExceededError');return realTx.call(this,s,...a);};});
  await p.click('#tap');
  if(mode==='permission') {await p.waitForFunction(()=>window.grant);await p.waitForTimeout(400);assert.equal(await p.evaluate(()=>!!window.session),false,'never pretend to record before permission');await p.evaluate(()=>{window.grantedAt=performance.now();grant();});}
  await p.waitForFunction(()=>window.session||window.err,null,{timeout:12000});
  const timing=await p.evaluate(()=>({mode:stageMode,ms:window.started-tapped,afterGrant:window.started-(window.grantedAt||tapped),phase:WizAppCapture.getState().phase,err:window.err||null,stages:window.startStages||[],nativeCalls:window.nativeCalls||[]}));
  fs.writeFileSync(path.join(evidence,mode+'-timing.json'),JSON.stringify(timing,null,2));
  if(mode==='occupied-lock') {assert.equal(timing.err?.code,'busy');await p.evaluate(()=>unlock());}
  else {
   assert.equal(timing.err,null,JSON.stringify(timing));
   assert.ok((mode==='permission'?timing.afterGrant:timing.ms)<300,JSON.stringify(timing));assert.equal(timing.phase,'recording');
   await p.waitForTimeout(mode==='storage-failure'?600:200);
   if(mode==='storage-failure') {assert.equal(await p.evaluate(()=>WizAppCapture.getState().phase),'recording');assert.ok(await p.evaluate(()=>warnings.length)>0);await p.evaluate(()=>{IDBDatabase.prototype.transaction=realTx;});}
   const out=await p.evaluate(async()=>{const r=await session.stop();const kept=(await WizAppCapture.pending('messenger')).find(x=>x.id===r.id);return {id:r.id,bytes:r.blob.size,kept:kept?.blob.size};});
   assert.ok(out.bytes>0);assert.equal(out.kept,out.bytes);timing.audio=out;
   await p.evaluate(id=>WizAppCapture.ack('messenger',id),out.id);
  }
  results.push(timing);fs.writeFileSync(path.join(evidence,'instant-start.json'),JSON.stringify({source:process.env.SOURCE_SHA||null,results},null,2));console.log('PASS',mode,JSON.stringify(timing));await ctx.close();
 }
})().catch(e=>{console.error(e);fs.writeFileSync(path.join(evidence,'failure.txt'),String(e.stack));process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
