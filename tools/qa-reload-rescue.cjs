#!/usr/bin/env node
/* Closed synthetic shell: never contacts the owner server or opens owner audio. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const shell=require('./qa-closed-shell.cjs'),{chromium}=require('./qa-playwright.cjs');
// Adapter onto the shared closed shell: boot(phone, configure) -> {c}; page via getPage().
let browser;
async function boot({configure}){
 if(!browser){browser=await chromium.launch({headless:true,args:['--disable-lcd-text','--disable-gpu'],...(process.env.QA_CHROME?{executablePath:process.env.QA_CHROME}:{})});shell.setBrowser(browser);}
 // Secure loopback origin: Web Locks (microphone arbitration) need a secure context.
 const sink=await require('./qa-recorder-stop-evidence.cjs').start({out,mode:'phone',report:shell.report});
 const from=shell.report.errors.length,{c}=await shell.boot(true,configure,sink);
 return {page:shell.getPage(),get errors(){return shell.report.errors.slice(from)},close:async()=>{await c.close();await sink.close();}};
}
const out=path.resolve(process.env.QA_OUT||'qa-reload-rescue');fs.mkdirSync(out,{recursive:true});
// Decode browser PNG pixels: compressed PNG bytes are not an opacity oracle.
function pixels(png){
 const zlib=require('node:zlib'),data=[];let w,h,type;
 for(let off=8;off<png.length;){const n=png.readUInt32BE(off),tag=png.toString('ascii',off+4,off+8),b=png.subarray(off+8,off+8+n);if(tag==='IHDR'){w=b.readUInt32BE(0);h=b.readUInt32BE(4);assert.equal(b[8],8);type=b[9]}if(tag==='IDAT')data.push(b);off+=n+12}
 assert([2,6].includes(type));const bpp=type===6?4:3,stride=w*bpp,raw=zlib.inflateSync(Buffer.concat(data)),out=Buffer.alloc(h*stride);
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c};
 for(let y=0;y<h;y++){const kind=raw[y*(stride+1)];for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=bpp?out[i-bpp]:0,b=y?out[i-stride]:0,c=y&&x>=bpp?out[i-stride-bpp]:0;assert(kind<=4);out[i]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][kind])&255}}
 return out;
}
async function opacityProof(p,popup){
 const b=await popup.boundingBox(),clip={x:b.x+20,y:b.y+20,width:b.width-40,height:b.height-40};
 await popup.evaluate(el=>{const behind=document.createElement('div');behind.id='synthetic-opacity-background';behind.style.cssText='position:fixed;inset:0;z-index:69;pointer-events:none;background:blue;color:yellow;font:900 30px/32px sans-serif';behind.textContent='SYNTHETIC LOUD TEXT '.repeat(300);el.before(behind);el.style.willChange='transform'});
 const over=await p.screenshot({clip});await p.evaluate(()=>document.querySelector('#synthetic-opacity-background').style.visibility='hidden');const bare=await p.screenshot({clip});
 assert(pixels(over).equals(pixels(bare)),'notice pixels must be independent of background text');
 // Calibrate identical oracle against a deliberately transparent panel, then restore exact inline bytes.
 const old=await popup.getAttribute('style');await popup.evaluate(el=>{el.style.setProperty('background','transparent','important');el.style.setProperty('backdrop-filter','none','important');el.style.setProperty('-webkit-backdrop-filter','none','important')});
 const negativeBare=await p.screenshot({clip});await p.evaluate(()=>document.querySelector('#synthetic-opacity-background').style.visibility='visible');const negativeOver=await p.screenshot({clip});
 assert(!pixels(negativeOver).equals(pixels(negativeBare)),'oracle must reject an actually transparent panel');
 await popup.evaluate((el,old)=>{old===null?el.removeAttribute('style'):el.setAttribute('style',old);document.querySelector('#synthetic-opacity-background').remove()},old);
 return {opaque:true,negativeRejected:true};
}
(async()=>{
 const results=[];
 for(const skin of ['nebula','obsidian-light']){
  let revision='a'.repeat(40),uploaded=0,bytes=0,heads=0;
  const f=await boot({tree:process.env.QA_TREE,skin:'nebula',configure:async c=>{
   await c.route('**/ux-version.txt',r=>r.fulfill({status:200,contentType:'text/plain',body:revision}));
   await c.route('**/synthetic-capture/',r=>r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Synthetic capture fixture</title>'}));
   await c.route('**/wizard/files/upload',async r=>{const b=r.request().postDataBuffer();assert.equal(r.request().method(),'POST');assert.deepEqual([...b],[0,255,128,9]);bytes=b.length;uploaded++;await r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({file:{id:'wf_synthetic_recovered',bytes:b.length}})});});
   await c.route('**/wizard/files/wf_synthetic_recovered/content',async r=>{assert.equal(r.request().method(),'HEAD');heads++;await r.fulfill({status:200,headers:{'Content-Length':'4','Content-Type':'audio/webm'},body:''});});
  }});
  try{
   const p=f.page;
   await p.waitForFunction(()=>!!window.WizWebUpdate&&!!window.WizAppCapture&&!!window.WosSkin);
   await p.evaluate(async()=>{
    // Both browser-owned stores contain fixture bytes only. No persistent owner browser is used.
    const req=indexedDB.open('wizard-app-capture-v1',1);
    const db=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
    await new Promise((resolve,reject)=>{const tx=db.transaction(['sessions','chunks'],'readwrite');
      tx.objectStore('sessions').put({id:'synthetic-stale-note',appId:'messenger',kind:'audio',status:'pending',startedAt:Date.parse('2026-11-03T10:00:00Z'),durationMs:1,seq:2,bytes:4,mime:'audio/webm',meta:{}});
      tx.objectStore('chunks').put({id:'synthetic-stale-note',seq:0,source:'me',blob:new Blob([Uint8Array.of(0,255)])});
      tx.objectStore('chunks').put({id:'synthetic-stale-note',seq:1,source:'me',blob:new Blob([Uint8Array.of(128,9)])});
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
    await WizAppCapture.pending('messenger');
    for(const platform of ['mobile','desktop']){const apps=WizCore.apps(platform).APPS;const old=apps.find(a=>a.id==='messenger');if(old)Object.assign(old,{kind:'wizard',url:location.origin+'/synthetic-capture/'});else apps.push({id:'messenger',name:'Messenger',kind:'wizard',url:location.origin+'/synthetic-capture/'});}
    const frame=document.createElement('iframe');frame.style.display='none';frame.src='/synthetic-capture/';document.body.append(frame);await new Promise(r=>frame.onload=r);
    WizAppServices.attach(frame,{appId:'messenger',path:'/synthetic-capture/'});
    const client=WizAppServices.connect(frame.contentWindow);if(!client)throw Error('Synthetic app not authorized');
    window.__syntheticCaptureHold=client.update.hold('Recording');
    // This fixture app acknowledges that its own capture hold is empty after the host clears the row.
    addEventListener('wizard-app-capture-state',()=>{if(!WizAppCapture.staleTakes().length)window.__syntheticCaptureHold?.release()});
    await WizWebUpdate.check(true);
   });
   revision='b'.repeat(40);await p.evaluate(()=>WizWebUpdate.check(true));
   await p.evaluate(()=>WizCore.deeplink.route('/wizard-os-home/?view=skin'));
   await p.locator('#settingsBody').waitFor({state:'visible'});
   const family=await p.evaluate(s=>WosSkin.familyOf(s),skin);
   const familyButton=p.locator('[data-skinfamily="'+family+'"]:visible');if(await familyButton.count())await familyButton.tap();
   await p.locator('[data-skinpick="'+skin+'"]:visible').tap();
   assert.equal(await p.locator('[data-skinpick="'+skin+'"]:visible').getAttribute('aria-pressed'),'true');
   await p.evaluate(()=>__wos.closeSheets());
   await p.waitForFunction(s=>WosSkin.current===s,skin);await p.evaluate(()=>document.fonts.ready);await p.locator('.mz-intro').waitFor({state:'detached',timeout:15000});await p.waitForTimeout(500);
   // The pop-up shows only on an empty Home (homeInView): the fixture boots into Chats, so close its windows first.
   await p.evaluate(()=>{const P=window.__wos;P.closeSheets?.();for(const d of P.desks||[])for(const id of [...(d.wins||[])])P.closeWin?.(id,true);});
   await p.waitForTimeout(400);await p.evaluate(()=>WosUpdates.popup());
   const popup=p.locator('.osu-pop');
   try{await popup.waitFor({state:'visible',timeout:8000});}catch(e){
    const diag=await p.evaluate(()=>({card:WosUpdates.card?.(),key:WosUpdates.popKey?.(WosUpdates.card?.()),pending:WizWebUpdate.pending,idx:__wos.idx,wins:(__wos.desks||[]).map(d=>(d.wins||[]).length),hidden:document.hidden,blockers:[...document.querySelectorAll('.mz-intro, .rs-sheet, .wos-burst, .tour.on')].map(n=>n.className),stale:WizAppCapture.staleTakes?.()}));
    console.error('POPUP_DIAG '+JSON.stringify(diag));throw e;}
   await assert.equal(await popup.getByText('Save to Files and clear',{exact:true}).count(),1);
   assert.match(await popup.innerText(),/Messenger.*(3 Nov|Nov 3)/);
   assert.match(await popup.innerText(),/Discard/);
   // The test clock freezes the pop-up's 0.24 s fade-in at its first frame; finish it before measuring.
   await popup.evaluate(el=>el.getAnimations().forEach(a=>a.finish()));
   const geometry=await popup.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return{background:s.backgroundColor,image:s.backgroundImage,opacity:s.opacity,width:r.width,height:r.height,left:r.left,right:r.right,bottom:r.bottom,viewport:innerWidth}});
   assert.equal(geometry.opacity,'1');assert(geometry.left>=0&&geometry.right<=geometry.viewport);assert(geometry.height>100);
   const opacity=await opacityProof(p,popup);
   const shot=path.join(out,'phone-'+skin+'-rescue.png');await p.screenshot({path:shot});
   await popup.getByRole('button',{name:'Save to Files and clear',exact:true}).click();
   await p.waitForFunction(()=>!document.querySelector('.osu-pop [data-osu="rescue-save"]'));
   await p.waitForTimeout(1200);
   assert.equal(uploaded,1);assert.equal(bytes,4);assert.equal(heads,1);
   results.push({skin,shot,geometry,opacity,uploaded,bytes,heads,errors:f.errors});
   assert.deepEqual(f.errors,[]);
  }finally{await f.close()}
 }
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({ok:true,results,unknown:shell.report.unknown},null,2));console.log(JSON.stringify({ok:true,cases:results.length,results}));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1}).finally(()=>browser?.close());
