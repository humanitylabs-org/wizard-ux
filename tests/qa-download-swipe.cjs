'use strict';
// Swipe to dismiss the download banner and the Downloads sheet (switch wizard/download-swipe, wizard-ux issue 1343).
// The real phone shell (412 x 915, touch) on a synthetic origin, every write refused, with a FAKE Android downloads
// port (window.wizardDownloadsPort, protocol v1) that records every call. Gestures are real touches sent through CDP
// (trusted pointer + touch events, like a finger), in two skins.
// With the switch on: a swipe up or sideways on the banner and a swipe down on the sheet dismiss them, following the
// finger and settling on release; a short drag snaps back; taps on the banner and on Open still work; nothing is
// cancelled or removed and the file is still listed from Settings → Downloads.
// With it off (QA_ONLY_OFF=1, or the off pass of every run): the same swipes leave the banner and the sheet in place.
// QA_OUT=<dir> saves screenshots (also mid-swipe frames). QA_WEB=<checkout>/web points at another build. QA_EXPECT=broken expects today's
// behaviour also with the switch on (to show the cause on main).
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.env.QA_WEB||path.join(__dirname,'../web')),origin='https://download-swipe.test',prefix='/wizard-os-home/';
const out=process.env.QA_OUT||'';if(out)fs.mkdirSync(out,{recursive:true});
const ID='wizard/download-swipe',broken=process.env.QA_EXPECT==='broken';
const SKINS=(process.env.QA_SKINS||'nebula,grove').split(',');
const type=f=>f.endsWith('.js')||f.endsWith('.mjs')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':f.endsWith('.json')?'application/json':'application/octet-stream';
// The fake native side: answers list/open/cancel/remove like Downloads.java and records every call in window.__dlCalls.
function fakePort(){
 if(window!==window.top)return;
 const now=Date.now();
 window.__dlItems=[{id:'12',name:'Plan.pdf',mime:'application/pdf',size:4700000,got:4700000,status:'done',started:now-5000,finished:now-1000},
  {id:'13',name:'Big.zip',mime:'application/zip',size:9000000,got:3000000,status:'running',started:now-3000,finished:0}];
 window.__dlCalls=[];const handlers=[];
 const answer=m=>{
  if(m.method==='list')return {ok:true,result:{v:1,items:window.__dlItems}};
  window.__dlCalls.push(m.method+':'+(m.params&&m.params.id));
  return {ok:true,result:'ok'};
 };
 window.__dlPush=ev=>handlers.forEach(f=>f({data:JSON.stringify({v:1,event:ev})}));
 window.wizardDownloadsPort={postMessage(text){const m=JSON.parse(text),r=answer(m);setTimeout(()=>handlers.forEach(f=>f({data:JSON.stringify({v:1,id:m.id,...r})})),5);},addEventListener(t,f){if(t==='message')handlers.push(f);}};
}
(async()=>{
 const browser=await chromium.launch({headless:true});const results=[];
 try{
  for(const on of process.env.QA_ONLY_OFF==='1'?[false]:[false,true])for(const skin of SKINS){
   const label=`${skin} ${on?'on':'off'}`,works=on&&!broken;
   const ctx=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:1,userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',serviceWorkers:'block'});
   await ctx.routeWebSocket('**/*',ws=>ws.close());
   const mix=on?{[ID]:true}:{};
   await ctx.addInitScript(({skin,mix})=>{if(window!==window.top)return;for(const[k,val]of Object.entries({'wos.shell':'phone','wos.skin':skin,'wos.coached':'true','wos.tour.v1':'true','wos.welcome.v1':'done','wos.skin-tweaks.v1':JSON.stringify({version:1,preset:'none',off:{},mix})}))localStorage.setItem(k,val);},{skin,mix});
   await ctx.addInitScript(fakePort);
   const errors=[],writes=[];
   await ctx.route('**/*',async r=>{
    const q=r.request(),u=new URL(q.url()),p=u.pathname;
    if(u.origin!==origin)return r.abort();
    if(!['GET','HEAD'].includes(q.method())){writes.push(q.method()+' '+p);return r.fulfill({status:405,json:{error:'refused by test'}});}
    if(p.startsWith(prefix)){const f=path.resolve(root,p.slice(prefix.length)||'index.html');if(f.startsWith(root+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({contentType:type(f),body:fs.readFileSync(f)});}
    if(p==='/wizard/v1/ui-preferences')return r.fulfill({json:{launcher:{},migrations:{'launcher-seed-v1':true}}});
    if(p.endsWith('/v1/setup'))return r.fulfill({json:{first_run:false}});
    if(p.endsWith('/v1/apps'))return r.fulfill({json:{apps:[]}});
    return r.fulfill({json:{sessions:[],agents:[],apps:[],connected:false}});
   });
   const pg=await ctx.newPage();pg.on('pageerror',e=>errors.push(e.message));
   const cdp=await ctx.newCDPSession(pg);
   // A finger: down, `steps` moves (one per frame), up. Returns where the element was halfway (it follows the finger).
   const swipe=async(x,y,dx,dy,{steps=12,ms=16,probe=null,shot=''}={})=>{
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    let mid=null;
    for(let i=1;i<=steps;i++){
     await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/steps,y:y+dy*i/steps}]});
     await pg.waitForTimeout(ms);
     if(shot&&out&&i===Math.round(steps/2))await pg.screenshot({path:path.join(out,shot)});
     if(probe&&i===Math.round(steps/2))mid=await pg.evaluate(s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left,y:r.top};},probe);
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    return mid;
   };
   const tap=async(x,y)=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
   const rect=s=>pg.evaluate(s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2};},s);
   const banner=()=>pg.evaluate(()=>!!document.querySelector('.wdl-banner.on'));
   const sheetOpen=()=>pg.evaluate(()=>!!window.WosDownloads?.isOpen?.());
   const showBanner=async()=>{await pg.evaluate(()=>window.__dlPush({type:'done',item:{id:'12'}}));await pg.waitForSelector('.wdl-banner.on',{timeout:5000});await pg.waitForTimeout(250);};
   const calls=()=>pg.evaluate(()=>window.__dlCalls.slice());
   await pg.goto(origin+prefix);
   await pg.waitForFunction(()=>window.WosDownloads?.available?.()&&(window.__wos||window.__wux));
   await pg.addStyleTag({content:'#wosWelcome{display:none!important}'});
   await pg.evaluate(()=>{if(window.WosWelcome?.active)window.WosWelcome.close?.();});
   if(on)await pg.waitForFunction(id=>(document.documentElement.dataset.tweaks||'').split(' ').includes(id),ID,{timeout:15000});
   await pg.waitForTimeout(500);
   const r={variant:label};
   // 1. Banner: swipe up.
   await showBanner();
   const b0=await rect('.wdl-banner');
   if(out)await pg.screenshot({path:path.join(out,`download-swipe-${skin}-${on?'on':'off'}-banner.png`)});
   const midUp=await swipe(b0.x+60,b0.cy,0,-140,{probe:'.wdl-banner',shot:`download-swipe-${skin}-${on?'on':'off'}-banner-mid.png`});
   r.upFollowed=midUp&&Math.round(b0.y-midUp.y);
   await pg.waitForTimeout(450);
   r.upGone=!(await banner());
   if(works){assert.ok(r.upFollowed>40,`${label}: the banner follows the finger up ${JSON.stringify(r)}`);assert.ok(r.upGone,`${label}: a swipe up dismisses the banner`);}
   else{assert.ok(!r.upGone,`${label}: the banner stays after a swipe (today)`);assert.ok(!(r.upFollowed>4),`${label}: the banner doesn't move (today) ${JSON.stringify(r)}`);}
   await pg.evaluate(()=>document.querySelectorAll('.wdl-banner').forEach(e=>e.remove()));
   // 2. Banner: swipe sideways (left and right).
   for(const dir of [-1,1]){
    await showBanner();const b=await rect('.wdl-banner');
    await swipe(b.x+(dir<0?260:60),b.cy,dir*230,6);await pg.waitForTimeout(450);
    r['side'+dir]=!(await banner());
    assert.equal(r['side'+dir],works,`${label}: a sideways swipe (${dir}) dismisses the banner only when on`);
    await pg.evaluate(()=>document.querySelectorAll('.wdl-banner').forEach(e=>e.remove()));
   }
   // 3. Short drag snaps back, then a plain tap on the banner opens the sheet.
   await showBanner();const b1=await rect('.wdl-banner');
   await swipe(b1.x+60,b1.cy,0,-24,{steps:4});await pg.waitForTimeout(400);
   const b2=await rect('.wdl-banner');
   r.snapBack=!!b2&&Math.abs(b2.y-b1.y)<2&&await banner();
   assert.ok(r.snapBack,`${label}: a short drag leaves the banner where it was ${JSON.stringify({b1,b2})}`);
   await tap(b1.x+60,b1.cy);await pg.waitForTimeout(400);
   r.tapOpensSheet=await sheetOpen();
   assert.ok(r.tapOpensSheet,`${label}: a tap on the banner still opens the Downloads sheet`);
   await pg.waitForSelector('.wdl-sheet.on .wdl-row');await pg.waitForTimeout(300);
   if(out)await pg.screenshot({path:path.join(out,`download-swipe-${skin}-${on?'on':'off'}-sheet.png`)});
   // 4. Sheet: a short pull snaps back; Open in a row still works; a swipe down closes it.
   const p0=await rect('.wdl-panel');
   await swipe(p0.cx,p0.y+20,0,30,{steps:4});await pg.waitForTimeout(350);
   const p1=await rect('.wdl-panel');
   r.sheetSnap=await sheetOpen()&&Math.abs(p1.y-p0.y)<2;
   assert.ok(r.sheetSnap,`${label}: a short pull leaves the sheet open ${JSON.stringify({p0,p1})}`);
   const openBtn=await rect('.wdl-row .wdl-act[data-wdl="open"]');
   await tap(openBtn.cx,openBtn.cy);await pg.waitForTimeout(400);
   r.sheetOpenTap=(await calls()).includes('open:12');
   assert.ok(r.sheetOpenTap,`${label}: Open in the sheet still opens the file`);
   const midDown=await swipe(p0.cx,p0.y+20,0,260,{probe:'.wdl-panel',shot:`download-swipe-${skin}-${on?'on':'off'}-sheet-mid.png`});
   r.downFollowed=midDown&&Math.round(midDown.y-p0.y);
   await pg.waitForTimeout(450);
   r.sheetClosed=!(await sheetOpen());
   if(works){assert.ok(r.downFollowed>60,`${label}: the sheet follows the finger down ${JSON.stringify(r)}`);assert.ok(r.sheetClosed,`${label}: a swipe down closes the sheet`);}
   else assert.ok(!r.sheetClosed,`${label}: the sheet stays after a swipe down (today)`);
   if(!r.sheetClosed)await pg.evaluate(()=>window.WosDownloads.back());
   await pg.waitForTimeout(300);
   // 5. Banner Open still opens the file.
   await pg.evaluate(()=>{window.__dlCalls.length=0;});
   await showBanner();const ob=await rect('.wdl-banner .wdl-open');
   await tap(ob.cx,ob.cy);await pg.waitForTimeout(400);
   r.bannerOpen=(await calls()).includes('open:12');
   assert.ok(r.bannerOpen,`${label}: Open on the banner still opens the file`);
   await pg.evaluate(()=>document.querySelectorAll('.wdl-banner').forEach(e=>e.remove()));
   // 6. Dismissing never cancels: no cancel/remove went to native, and Settings → Downloads still lists both files.
   const all=await calls();r.cancelled=all.filter(c=>/^(cancel|remove)/.test(c));
   assert.deepEqual(r.cancelled,[],`${label}: nothing was cancelled or removed`);
   await pg.evaluate(()=>(window.__wos||window.__wux).openSettings());
   await pg.waitForSelector('.st-index [data-st-page="phone"]',{timeout:15000});
   await pg.locator('.st-index [data-st-page="phone"]').click();
   await pg.locator('[data-st="downloads"]').click();
   await pg.waitForSelector('.wdl-sheet.on .wdl-row',{timeout:5000});
   r.listed=await pg.evaluate(()=>[...document.querySelectorAll('.wdl-sheet .wdl-row b')].map(b=>b.textContent));
   assert.deepEqual(r.listed,['Plan.pdf','Big.zip'],`${label}: both files are still in Settings → Downloads`);
   r.running=await pg.evaluate(()=>/Downloading/.test(document.querySelector('.wdl-sheet .wdl-row:nth-child(2)')?.textContent||''));
   assert.ok(r.running,`${label}: the running download is still running`);
   // 7. The list at its top pulls the sheet down too (a pull that starts on a row, not on the grip).
   const row=await rect('.wdl-sheet .wdl-row .wdl-tx');
   await swipe(row.cx,row.cy,0,240);await pg.waitForTimeout(450);
   r.rowPullClosed=!(await sheetOpen());
   assert.equal(r.rowPullClosed,works,`${label}: a pull down from the list closes the sheet only when on`);
   r.cancelledAfter=(await calls()).filter(c=>/^(cancel|remove)/.test(c));
   assert.deepEqual(r.cancelledAfter,[],`${label}: still nothing cancelled`);
   assert.deepEqual(errors,[],`${label}: page errors`);
   r.writes=writes;results.push(r);
   await ctx.close();
  }
  console.log(JSON.stringify({ok:true,results},null,1));
 }catch(e){console.error(JSON.stringify(results,null,1));console.error(e.message);process.exitCode=1;}
 finally{await browser.close();}
})();
