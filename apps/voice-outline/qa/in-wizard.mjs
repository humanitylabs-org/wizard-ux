// Run only on Thales. Actual production shell + shared capture + real local ASR.
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.WIZARD_ORIGIN,out=process.env.EVIDENCE_DIR,wav=process.env.QA_SPEECH;
assert(origin&&out&&wav);mkdirSync(out,{recursive:true});
const base=origin+'/voice-outline-streaming/',entry=origin+'/wizard-os-home/?open=outline-streaming-demo';
const receipt={entry,kind:'actual-Wizard-shell-shared-microphone-real-Nemotron',checks:[],events:[],errors:[],audio:[]};
let browser,page,app;
const hash=b=>createHash('sha256').update(b).digest('hex');
const check=(name,value)=>{assert(value,name);receipt.checks.push(name)};
async function get(path){return page.request.get(base+path).then(r=>r.json())}
async function attach(){await page.waitForFunction(()=>window.__wos&&Array.from(document.querySelectorAll('iframe')).some(f=>{try{return f.contentWindow.location.pathname==='/voice-outline-streaming/'&&f.contentWindow.WizardApp}catch{return false}}),null,{timeout:25000});app=page.frames().find(f=>f.url().includes('/voice-outline-streaming/'));await app.waitForFunction(()=>document.querySelector('#save')?.textContent==='Saved');}
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${wav}`]});
 const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,permissions:['microphone'],colorScheme:'dark'});page=await context.newPage();
 page.on('pageerror',e=>receipt.errors.push(e.message));
 page.on('websocket',ws=>{if(!ws.url().includes('/voice-outline-streaming/'))return;ws.on('framesent',e=>{if(typeof e.payload!=='string'){receipt.pcmFrames=(receipt.pcmFrames||0)+1;receipt.pcmBytes=(receipt.pcmBytes||0)+e.payload.length;}else{try{receipt.events.push({direction:'sent',...JSON.parse(e.payload)})}catch{}}});ws.on('framereceived',e=>{try{receipt.events.push({direction:'received',...JSON.parse(e.payload)})}catch{}})});
 await page.goto(entry);await attach();
 receipt.ready=await app.evaluate(async()=>({ready:await WizardApp.ready(),capabilities:WizardApp.capture.capabilities({kind:'outline',pcm:true})}));
 check('canonical app identity, hosted shared PCM',receipt.ready.ready.hosted&&receipt.ready.ready.appId==='outline-streaming-demo'&&receipt.ready.capabilities.pcm);
 receipt.windows=await page.evaluate(()=>Object.values(__wos.wins).map(w=>({appId:w.appId,url:w.url,title:w.title})));
 receipt.before={document:await get('api/document'),speech:await get('api/speech'),audio:await get('api/audio')};
 receipt.health=await get('healthz');check('actual local model ready and no fallback',receipt.health.liveReady&&receipt.health.provider==='local-sherpa-cpu'&&receipt.health.fallback===null);
 await app.locator('#new').click();await page.keyboard.press('Escape');
 await app.locator('#live').click();await app.waitForFunction(()=>document.querySelector('#live').textContent.includes('Recording'),null,{timeout:15000});
 receipt.capture=await app.evaluate(()=>WizardApp.capture.current());
 await app.waitForFunction(()=>[...document.querySelectorAll('.draft')].some(e=>e.textContent.length>15),null,{timeout:20000});
 receipt.beforeStop=await app.locator('.draft').allTextContents();check('real words visible before Stop',receipt.beforeStop.some(s=>s.length>15));
 await page.screenshot({path:out+'/in-shell-live.png',fullPage:true});
 const first=await app.locator('.live-target').getAttribute('data-id');await app.locator('#new').click();const second=await app.locator('.live-target').getAttribute('data-id');receipt.targets={first,second};
 await app.waitForFunction(id=>document.querySelector(`[data-id="${id}"] .draft`)?.textContent.length>15,second,{timeout:20000});
 await app.locator('#live').click();await app.waitForFunction(()=>document.querySelector('#live').textContent.includes('Go Live'),null,{timeout:40000});await app.waitForFunction(()=>document.querySelector('#save').textContent==='Saved');
 receipt.after={document:await get('api/document'),speech:await get('api/speech'),audio:await get('api/audio')};
 for(const id of [first,second]){const u=receipt.after.speech.utterances.find(u=>u.target===id&&u.status==='final');check('final persisted on targeted bullet '+id,!!u&&receipt.after.document.document.nodes.find(n=>n.id===id)?.text===u.text&&u.text.length>5)}
 const priorTakes=new Set(receipt.before.audio.takes.map(t=>t.id));
 for(const take of receipt.after.audio.takes.filter(t=>!priorTakes.has(t.id))){for(const chunk of take.chunks){const path=`api/audio/${take.id}/${chunk.seq}`,meta=await get(path),raw=await page.request.get(base+path+'?raw').then(r=>r.body());assert.equal(hash(raw),meta.hash);assert.equal(raw.length,meta.bytes);receipt.audio.push({take:take.id,seq:chunk.seq,bytes:raw.length,sha256:hash(raw)})}const raw=await page.request.get(base+`api/audio/${take.id}/wav`).then(r=>r.body());assert.equal(raw.toString('ascii',0,4),'RIFF');assert(raw.length>44)}
 check('nonempty original audio hash readback',receipt.audio.length>0);
 receipt.pending=await app.evaluate(async()=>await WizardApp.capture.pending());check('custody acknowledged after verified readback',receipt.pending.length===0);
 check('shared capture ended cleanly',await app.evaluate(()=>WizardApp.capture.current()===null));
 check('real PCM sent and replacement events received',receipt.pcmBytes>0&&receipt.events.some(e=>e.direction==='received'&&e.type==='delta'&&e.replace===true));
 await page.screenshot({path:out+'/in-shell-final.png',fullPage:true});
 await page.reload();await attach();check('in-shell reload preserves exact finals',JSON.stringify((await get('api/document')).document)===JSON.stringify(receipt.after.document.document));
 await app.locator('#menu').click();await page.goBack();await page.waitForTimeout(300);check('menu Back stays in shell',new URL(page.url()).pathname==='/wizard-os-home/'&&await app.locator('#sheet').isVisible()===false);
 await page.screenshot({path:out+'/in-shell-back.png',fullPage:true});
 // Raw link window remains untrusted even though the private app is installed.
 await page.evaluate(url=>__wos.openLinkDesk(url),base);await page.waitForTimeout(700);
 const linkFrames=page.frames().filter(f=>f.url().includes('/voice-outline-streaming/'));
 const raw=linkFrames.at(-1);receipt.raw=await raw.evaluate(async()=>({ready:await WizardApp.ready(),cap:WizardApp.capture.capabilities({kind:'outline',pcm:true})}));
 if(!receipt.raw.ready.hosted){await raw.locator('#live').click();await page.waitForTimeout(300);receipt.raw.notice=await raw.locator('#notice').textContent();check('unregistered raw link denied with canonical recovery action',!receipt.raw.cap.pcm&&await raw.locator('#notice a[href="/wizard-os-home/?open=outline-streaming-demo"]').count()===1);await page.screenshot({path:out+'/raw-link-recovery.png',fullPage:true})}
 check('no application JavaScript errors',receipt.errors.length===0);receipt.ok=true;
}catch(e){receipt.ok=false;receipt.failure=e.stack;receipt.state=await app?.evaluate(()=>({notice:document.querySelector('#notice')?.textContent,live:document.querySelector('#live')?.textContent})).catch(()=>null);await page?.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{})}
finally{await browser?.close();writeFileSync(out+'/in-wizard.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));if(!receipt.ok)process.exitCode=1}
