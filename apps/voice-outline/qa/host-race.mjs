// Desktop-window race: the host attaches the frame after the app has started. Recovery must not fail.
import {createRequire} from 'node:module';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright'),base=process.env.OUTLINE_URL||'http://127.0.0.1:18890',out=process.env.EVIDENCE_DIR||'./evidence',delay=+(process.env.ATTACH_DELAY_MS||400);mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}),page=await browser.newPage({viewport:{width:1440,height:900}}),receipt={kind:'desktop-host-attach-race',delay,errors:[]};page.on('pageerror',e=>receipt.errors.push(e.message));
const html=`<!doctype html><html><head><script>window.WizCore={apps:()=>({APPS:[{id:'voice-outline',kind:'web',url:'/index.html'}]})};</script><script src="/wizard-os-home/core/app-capture.js"></script><script src="/wizard-os-home/core/app-services.js"></script></head><body><iframe id="app" style="width:900px;height:800px"></iframe><script>const f=document.querySelector('iframe');f.src='/index.html';setTimeout(()=>WizAppServices.attach(f,{appId:'voice-outline',path:'/index.html'}),${delay});</script></body></html>`;
await page.route('**/healthz',r=>r.fulfill({json:{ok:true,liveReady:true}}));let wire;await page.routeWebSocket('**/api/live',ws=>{wire=ws;ws.onMessage(d=>{if(typeof d==='string'){const m=JSON.parse(d);if(m.type==='begin')setTimeout(()=>ws.send(JSON.stringify({...m,type:'final',text:''})),300);}});});
await page.route('**/qa-host',r=>r.fulfill({contentType:'text/html',body:html}));
try{await page.goto(base+'/qa-host');const frame=page.frameLocator('#app');await frame.locator('#save').filter({hasText:'Saved'}).waitFor({state:'attached'});await page.waitForTimeout(2500);
 receipt.notice=await frame.locator('#notice').textContent();receipt.hosted=await frame.locator('html').evaluate(()=>WizardApp.hosted);
 assert(!receipt.notice.includes('Could not load recovery'),receipt.notice);assert.equal(receipt.hosted,true);
 await frame.locator('#live').click();await page.waitForFunction(()=>WizAppCapture.getState().active===true,null,{timeout:8000});receipt.captureStarted=true;await page.waitForTimeout(1200);
 await frame.locator('#live').click();await page.waitForFunction(()=>WizAppCapture.getState().active===false,null,{timeout:40000});
 await page.screenshot({path:out+'/host-race.png'});assert.deepEqual(receipt.errors,[]);receipt.ok=true;
}catch(e){receipt.ok=false;receipt.failure=e.message.slice(0,600);receipt.after=await page.frameLocator('#app').locator('#notice').textContent().catch(()=>null);await page.screenshot({path:out+'/host-race-failure.png'}).catch(()=>{});}
finally{writeFileSync(out+'/host-race.json',JSON.stringify(receipt,null,2));await browser.close();console.log(JSON.stringify(receipt));if(!receipt.ok)process.exitCode=1;}
