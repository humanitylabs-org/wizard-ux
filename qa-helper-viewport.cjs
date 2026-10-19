// Phone viewport regression: staging focus must never scroll hidden shell ancestors.
if (!process.env.QA_ORIGIN) throw new Error('QA_ORIGIN is required: select an isolated tailnet preview');
const {chromium}=require('/Users/thales/helper-status-qa/node_modules/playwright-core');
const assert=require('node:assert/strict');
const ORIGIN=new URL(process.env.QA_ORIGIN).origin;
let pass=0;const ok=(v,label)=>{assert.ok(v,label);console.log('PASS',label);pass++};
(async()=>{
 const b=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const c=await b.newContext({viewport:{width:412,height:760},isMobile:true,hasTouch:true,ignoreHTTPSErrors:true});const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const geometry=()=>p.evaluate(()=>{const rect=sel=>{const e=document.querySelector(sel);const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,scrollTop:e.scrollTop}};return{height:innerHeight,width:innerWidth,device:rect('#device'),win:rect('.app-chats'),head:rect('.app-chats .ch-head'),summary:rect('[data-wk] summary'),composer:rect('.app-chats .ch-compose'),button:document.querySelector('[data-helper-continue]')?rect('[data-helper-continue]'):null}});
 await p.goto(ORIGIN+'/',{waitUntil:'domcontentloaded'});await p.waitForSelector('[data-wk] summary');await p.waitForTimeout(2500);
 let m=await geometry();console.log('GEOMETRY',JSON.stringify(m));
 ok(m.device.scrollTop===0,'after delayed focus timers, hidden device is unscrolled');ok(m.head.top>=0,'thread header stays inside visible browser viewport');ok(m.summary.top>=0&&m.summary.bottom<=m.height,'Working row starts on-screen');
 if(!await p.locator('[data-wk]').evaluate(e=>e.open)) await p.locator('[data-wk] summary').click();
 await p.locator('[data-helper-continue]').waitFor({state:'visible'});
 for(const [width,height] of [[412,760],[360,650],[412,540],[412,892]]){
  await p.setViewportSize({width,height});await p.waitForTimeout(650);m=await geometry();
  ok(m.device.scrollTop===0,`${width}x${height}: shell never scrolled`);ok(m.head.top>=0,`${width}x${height}: header visible`);ok(m.composer.bottom<=height+1,`${width}x${height}: composer inside viewport`);
  await p.locator('[data-helper-continue]').scrollIntoViewIfNeeded();m=await geometry();
  ok(m.button.top>=0&&m.button.bottom<=height&&m.button.left>=0&&m.button.right<=width&&await p.locator('[data-helper-continue]').isVisible(),`${width}x${height}: Continue fully visible`);
  ok(m.device.scrollTop===0,`${width}x${height}: reaching Continue only scrolls messages`);
 }
 await p.setViewportSize({width:412,height:760});await p.locator('.ch-compose textarea').focus();await p.setViewportSize({width:412,height:520});await p.waitForTimeout(500);m=await geometry();ok(m.device.scrollTop===0,'composer focus and keyboard-sized resize do not scroll shell');
 await p.locator('.ch-compose textarea').evaluate(e=>e.blur());await p.setViewportSize({width:412,height:760});await p.waitForTimeout(500);m=await geometry();ok(m.head.top>=0&&m.button.top>=0&&m.button.bottom<=760,'restoring browser viewport keeps header and Continue visible');
 await p.waitForTimeout(16000);ok(await p.locator('[data-helper-continue]').isVisible(),'Working expansion survives the 15-second refresh');
 await p.screenshot({path:'/Users/thales/helper-status-qa/viewport-fixed.png'});
 await p.locator('[data-helper-continue]').click();await p.waitForFunction(()=>window.WizLive.session('wizard_preview_helpers_stalled')?.helperStatus?.phase==='integrating');ok(true,'Continue works without relocating the shell');await p.waitForTimeout(3500);await p.evaluate(()=>WizLive.refresh());await p.waitForFunction(()=>WizLive.session('wizard_preview_helpers_stalled')?.status==='completed');ok(true,'Continue still settles the example');
 await p.locator('[data-chback]').click();await p.waitForTimeout(500);ok(await p.locator('[data-chats]').count()>0,'Back returns to list and keeps Chats open');ok(errors.length===0,'no browser runtime errors');
 console.log(JSON.stringify({passed:pass,host:require('os').hostname(),errors}));await c.close();await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
