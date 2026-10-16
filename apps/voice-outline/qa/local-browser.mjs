// Bounded browser acceptance, not a benchmark. Chrome file -> real shared microphone
// capture -> real local adapter. Never inject transcripts or replace capture/ASR.
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.OUTLINE_URL||'http://127.0.0.1:18881',out=process.env.EVIDENCE_DIR;
assert(out&&process.env.QA_SPEECH&&process.env.QA_SILENCE);mkdirSync(out,{recursive:true});
const receipt={kind:'chrome-microphone-shared-capture-real-local-nemotron',url:base,started:new Date().toISOString(),checks:[],errors:[],events:[],requests:[],audio:[]};
const hash=b=>createHash('sha256').update(b).digest('hex');
let browser,page,adapterStopped=false;
const adapterRoot=process.env.QA_ADAPTER_ROOT;
async function launch(file){
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${file}`]});
 const context=await browser.newContext({viewport:{width:393,height:852},permissions:['microphone'],colorScheme:'dark'});page=await context.newPage();
 page.on('pageerror',e=>receipt.errors.push(e.message));page.on('request',r=>receipt.requests.push(r.url()));
 page.on('websocket',ws=>{ws.on('framesent',e=>{if(typeof e.payload!=='string'){receipt.sentBytes=(receipt.sentBytes||0)+e.payload.length;receipt.sentFrames=(receipt.sentFrames||0)+1;}else receipt.events.push({direction:'sent',...JSON.parse(e.payload),at:Date.now()});});ws.on('framereceived',e=>{try{receipt.events.push({...JSON.parse(e.payload),at:Date.now()});}catch{}});});
 await page.goto(base);await page.waitForFunction(()=>document.querySelector('#save').textContent==='Saved');
}
async function live(){await page.locator('#live').click();await page.waitForFunction(()=>document.querySelector('#live').textContent.includes('Recording'),null,{timeout:20000});}
async function words(){await page.waitForFunction(()=>[...document.querySelectorAll('.draft')].some(e=>e.textContent.length>25),null,{timeout:15000});}
async function stop(){await page.locator('#live').click();await page.waitForFunction(()=>document.querySelector('#live').textContent.includes('Go Live'),null,{timeout:40000});await page.waitForFunction(()=>document.querySelector('#save').textContent==='Saved');}
async function check(name,fn){await fn();receipt.checks.push(name);}
async function get(path){return page.request.get(base+path).then(r=>r.json());}
async function audioReadback(){
 const {takes}=await get('/api/audio');
 for(const take of takes){for(const chunk of take.chunks){const path=`/api/audio/${take.id}/${chunk.seq}`,metadata=await get(path),raw=await page.request.get(base+path+'?raw').then(r=>r.body());assert.equal(hash(raw),metadata.hash);assert.equal(raw.length,metadata.bytes);receipt.audio.push({take:take.id,seq:chunk.seq,bytes:raw.length,sha256:hash(raw)});}const wav=await page.request.get(`${base}/api/audio/${take.id}/wav`).then(r=>r.body());assert.equal(wav.toString('ascii',0,4),'RIFF');assert(wav.length>44);}
 assert(takes.length);assert.equal(await page.evaluate(async()=>(await WizardApp.capture.pending()).length),0);
}
try{
 await launch(process.env.QA_SPEECH);receipt.health=await get('/healthz');assert.equal(receipt.health.liveReady,true);assert.equal(receipt.health.provider,'local-sherpa-cpu');assert.equal(receipt.health.fallback,null);
 await check('actual shared capture; isolated recovery/capture owner',async()=>{assert(await page.evaluate(()=>!!WizardApp.capture&&!!WizAppCapture));assert.equal(await page.getAttribute('html','data-app'),'outline-streaming-demo');const names=await page.evaluate(async()=>(await indexedDB.databases()).map(d=>d.name));assert(names.includes('outline-streaming-demo-recovery'));assert(!names.includes('voice-outline-recovery'));});
 await live();await words();receipt.beforeStop=await page.locator('.draft').allTextContents();await page.screenshot({path:out+'/phone-live.png',fullPage:true});receipt.checks.push('real visible replacement words BEFORE Stop');
 const first=await page.locator('.live-target').getAttribute('data-id');
 await page.locator('#new').click();const middle=await page.locator('.live-target').getAttribute('data-id');
 await page.locator('#new').click();const last=await page.locator('.live-target').getAttribute('data-id');
 assert.notEqual(first,last);receipt.targets={first,middle,last};await words();await page.waitForTimeout(4000);
 await check('menu Back keeps recording and app',async()=>{await page.locator('#menu').click();await page.goBack();await page.waitForTimeout(150);assert.equal(await page.locator('#sheet').isVisible(),false);assert((await page.locator('#live').textContent()).includes('Recording'));});
 await check('root Back keeps recording and app',async()=>{await page.goBack();await page.waitForTimeout(150);assert.equal(new URL(page.url()).origin,new URL(base).origin);assert((await page.locator('#live').textContent()).includes('Recording'));});
 await stop();receipt.document=await get('/api/document');receipt.speech=await get('/api/speech');
 await check('rapid New bullet queued PCM finalizes on exact targets',async()=>{for(const id of [first,last]){const u=receipt.speech.utterances.find(u=>u.target===id&&u.status==='final');assert(u&&u.text.length>5);assert.equal(receipt.document.document.nodes.find(n=>n.id===id).text,u.text);}assert.equal(receipt.events.filter(e=>e.type==='error').length,0);});
 await check('original WAV chunks hash-readback and custody acknowledged',audioReadback);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#save').textContent==='Saved');assert.deepEqual((await get('/api/document')).document,receipt.document.document);receipt.checks.push('reload preserves exact finals');
 await page.screenshot({path:out+'/phone-final.png',fullPage:true});await page.setViewportSize({width:1280,height:900});await page.screenshot({path:out+'/desktop-final.png',fullPage:true});
 await page.locator('#menu').click();assert.match(await page.locator('#trial-note').textContent(),/Parakeet is withheld/);await page.screenshot({path:out+'/model-note.png',fullPage:true});await browser.close();
 await launch(process.env.QA_SILENCE);await page.locator('#new').click();await page.keyboard.press('Escape');const silent=await page.locator('.selected').getAttribute('data-id');await live();await page.waitForTimeout(2500);await stop();const silentSpeech=(await get('/api/speech')).utterances.find(u=>u.target===silent);assert.equal(silentSpeech?.status,'final');assert.equal(silentSpeech.text,'');receipt.checks.push('silence stop returns empty final, no invented words');await browser.close();
 if(adapterRoot){
  assert(adapterRoot.endsWith('/WizardApps/outline-streaming-demo'));
  await launch(process.env.QA_SPEECH);await page.locator('#new').click();await page.keyboard.press('Escape');await live();await words();
  const pid=JSON.parse(readFileSync(adapterRoot+'/evidence/adapter-runtime.json')).snapshot.pid;
  const argv=execFileSync('/bin/ps',['-p',String(pid),'-o','command='],{encoding:'utf8'});assert(argv.includes('adapter.py')&&argv.includes('--port 18885'));
  writeFileSync(adapterRoot+'/runtime/adapter-paused','owned browser outage test');adapterStopped=true;process.kill(pid,'SIGTERM');
  await page.waitForFunction(()=>document.querySelector('#live').textContent.includes('Paused'),null,{timeout:10000});
  await stop();assert(await page.locator('.draft').filter({hasText:'Unconfirmed speech'}).count());await audioReadback();await page.screenshot({path:out+'/error-retained.png',fullPage:true});receipt.checks.push('real adapter shutdown leaves unconfirmed text and verified original audio');
  const unhealthy=await get('/healthz');assert.equal(unhealthy.liveReady,false);await page.locator('#live').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('unavailable'));assert.equal(await page.evaluate(()=>WizardApp.capture.current()),null);receipt.checks.push('unavailable model blocks new capture, no fallback');
  rmSync(adapterRoot+'/runtime/adapter-paused');adapterStopped=false;
 }
 assert.equal(receipt.errors.length,0);assert(receipt.requests.every(u=>new URL(u).origin===new URL(base).origin));receipt.checks.push('no JavaScript errors; all browser requests stay same-origin');receipt.ok=true;
}catch(e){receipt.ok=false;receipt.failure=e.stack;receipt.state=await page?.evaluate(()=>({notice:document.querySelector('#notice')?.textContent,live:document.querySelector('#live')?.textContent})).catch(()=>null);await page?.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});}
finally{if(adapterStopped)rmSync(adapterRoot+'/runtime/adapter-paused',{force:true});await browser?.close();receipt.finished=new Date().toISOString();writeFileSync(out+'/local-browser.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify({ok:receipt.ok,checks:receipt.checks,errors:receipt.errors,failure:receipt.failure,state:receipt.state}));if(!receipt.ok)process.exitCode=1;}
