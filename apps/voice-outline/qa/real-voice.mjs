import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.OUTLINE_URL||'http://127.0.0.1:18871',out=process.env.EVIDENCE_DIR||'./evidence';mkdirSync(out,{recursive:true});
const receipt={kind:'real-shared-capture-real-tinfoil',url:base,started:new Date().toISOString(),checks:[],errors:[],events:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${process.env.QA_SPEECH}`]});
const context=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:1,permissions:['microphone'],colorScheme:'dark'}),page=await context.newPage();
page.on('pageerror',e=>receipt.errors.push(e.message));page.on('websocket',ws=>{ws.on('framesent',e=>{if(typeof e.payload!=='string'){receipt.sentBytes=(receipt.sentBytes||0)+e.payload.length;receipt.sentFrames=(receipt.sentFrames||0)+1;}});ws.on('framereceived',e=>{try{const m=JSON.parse(e.payload);receipt.events.push({...m,at:Date.now()});}catch{}});});
async function check(name,fn){await fn();receipt.checks.push(name);}
try{
 await page.goto(base);await page.waitForFunction(()=>document.querySelector('#save').textContent==='Saved');
 await check('actual shared capture and client loaded',async()=>{if(!await page.evaluate(()=>!!WizardApp.capture&&!!WizAppCapture))throw Error('Missing shared capture');});
 await page.locator('#title').fill('Room for ideas');await page.locator('.text').first().click();await page.locator('textarea').fill('A garden for unfinished thoughts');await page.locator('#child').click();await page.locator('textarea').fill('Give each idea a little room');await page.keyboard.press('Escape');
 await page.locator('#new').click();await page.locator('textarea').fill('Let the useful connections emerge');await page.keyboard.press('Escape');await page.locator('#child').click();await page.locator('textarea').fill('Keep the next step close');await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.querySelector('#save').textContent==='Saved');
 await page.screenshot({path:out+'/phone-editor.png',fullPage:true});
 await page.locator('#new').click();await page.keyboard.press('Escape');
 await page.locator('#live').click();
 await page.waitForFunction(()=>document.querySelector('#live').textContent.includes('Recording'),{},{timeout:20000});
 await check('live words arrive before Stop',async()=>{await page.waitForFunction(()=>Array.from(document.querySelectorAll('.draft')).some(e=>e.textContent.length>20),{},{timeout:60000});});
 await page.screenshot({path:out+'/phone-live.png',fullPage:true});
 const firstTarget=await page.locator('.live-target').getAttribute('data-id');
 await page.locator('#child').click();const secondTarget=await page.locator('.live-target').getAttribute('data-id');if(firstTarget===secondTarget)throw Error('Did not retarget next thought');
 await page.waitForTimeout(9000);
 await check('menu Back keeps app and recording',async()=>{await page.locator('#menu').click();await page.goBack();await page.waitForTimeout(120);if(await page.locator('#sheet').isVisible())throw Error('Sheet stayed');if(!await page.locator('#live').textContent().then(s=>s.includes('Recording')))throw Error('Recording stopped by Back');});
 await page.locator('#live').click();await page.waitForFunction(()=>document.querySelector('#live').textContent.includes('Go Live'),{},{timeout:65000});
 await page.waitForFunction(()=>document.querySelector('#save').textContent==='Saved');
 const document=await page.request.get(base+'/api/document').then(r=>r.json()),speech=await page.request.get(base+'/api/speech').then(r=>r.json());
 receipt.document=document;receipt.speech=speech;receipt.notice=await page.locator('#notice').textContent();
 await check('real finals retained on their exact target IDs',async()=>{for(const id of [firstTarget,secondTarget]){const u=speech.utterances.find(s=>s.target===id&&s.status==='final'&&s.text.length>5);if(!u)throw Error('Missing final for '+id);if(!document.document.nodes.find(n=>n.id===id)?.text.includes(u.text))throw Error('Final absent from target');}});
 await check('shared custody acknowledged only after durable audio',async()=>{if(await page.evaluate(async()=> (await WizardApp.capture.pending()).length))throw Error('Audio remains pending');});
 await page.reload();await page.waitForFunction(()=>document.querySelector('#save').textContent==='Saved');await check('reload retains tree and dictation',async()=>{const texts=await page.locator('.text').allTextContents();if(!texts.some(t=>t.includes('garden')))throw Error('Transcript missing');});
 await page.screenshot({path:out+'/phone-final.png',fullPage:true});await page.setViewportSize({width:1280,height:900});await page.screenshot({path:out+'/desktop-final.png',fullPage:true});
 receipt.ok=true;
}catch(e){receipt.ok=false;receipt.failure=e.stack;receipt.state=await page.evaluate(async()=>({notice:document.querySelector('#notice').textContent,capture:WizAppCapture.getState?.(),current:WizardApp.capture.current()?.getInfo?.(),locks:await navigator.locks.query()}));console.log(JSON.stringify(receipt.state));await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});}
finally{receipt.finished=new Date().toISOString();writeFileSync(out+'/real-voice.json',JSON.stringify(receipt,null,2));await browser.close();console.log(JSON.stringify({ok:receipt.ok,checks:receipt.checks,errors:receipt.errors,failure:receipt.failure,events:receipt.events.length}));if(!receipt.ok)process.exitCode=1;}
