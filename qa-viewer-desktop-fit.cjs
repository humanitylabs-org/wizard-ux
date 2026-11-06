'use strict';
// Real shell + shared viewer + real app-media bridge. Entirely synthetic; forum queue only.
// Runner contract (on the admitted QA worker; ffmpeg + ffprobe required):
// export QA_MEDIA_DIR="$PWD/qa-native-media"; mkdir -p "$QA_MEDIA_DIR"
// ffmpeg -v error -f lavfi -i color=c=blue:s=160x90:r=1:d=30 -c:v libvpx -threads 1 -b:v 20k -an "$QA_MEDIA_DIR/native-video.webm"
// ffmpeg -v error -f lavfi -i anullsrc=r=8000:cl=mono -t 30 -c:a pcm_s16le "$QA_MEDIA_DIR/native-audio.wav"
// for file in "$QA_MEDIA_DIR/native-video.webm" "$QA_MEDIA_DIR/native-audio.wav"; do ffprobe -v error -show_entries format=duration:stream=codec_name,codec_type -of json "$file"; done
// Both fixtures must decode and report 30 seconds (VP8 video / PCM audio).
// QA_TREE=<export> QA_OUT=<fresh-dir> QA_MEDIA_DIR="$QA_MEDIA_DIR" node qa-viewer-desktop-fit.cjs
// Focused native acceptance (same mandatory provisioned QA_MEDIA_DIR):
// QA_TREE=<export> QA_OUT=<fresh-dir> QA_MEDIA_DIR="$QA_MEDIA_DIR" QA_ONLY='iframe gallery arrows focus/order/count/propagation|native media controls seek without gallery navigation' node qa-viewer-desktop-fit.cjs
// Optional QA_RED=1 retains the baseline runner mode; never omit QA_MEDIA_DIR.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('./tools/qa-playwright.cjs');
const F=require('./tools/qa-closed-shell.cjs'),OUT=process.env.QA_OUT,RED=process.env.QA_RED==='1';
const Repair=require('./tools/viewer-qa-repair.cjs');
const SELECT=process.env.QA_ONLY?new Set(process.env.QA_ONLY.split('|')):null;
const results=[],geometries=[],captures=[],mediaTransport=[],nativeDiagnostics=[];let browser,p,ctx,active='boot';
// Synthetic origin must implement byte ranges: a full 200 for Range can stall native seeks.
function nativeMediaResponse(body,contentType,range){
  const size=body.length,headers={'accept-ranges':'bytes','content-type':contentType,'content-length':String(size)};
  if(!range)return {status:200,headers,body};
  const match=/^bytes=(\d*)-(\d*)$/.exec(range);
  const unsatisfied=()=>({status:416,headers:{...headers,'content-range':`bytes */${size}`,'content-length':'0'},body:Buffer.alloc(0)});
  if(!match||(!match[1]&&!match[2]))return unsatisfied();
  let start,end;
  if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return unsatisfied();start=Math.max(0,size-suffix);end=size-1;}
  else{start=Number(match[1]);end=match[2]?Number(match[2]):size-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start)return unsatisfied();
  end=Math.min(end,size-1);const slice=body.subarray(start,end+1);
  return {status:206,headers:{...headers,'content-range':`bytes ${start}-${end}/${size}`,'content-length':String(slice.length)},body:slice};
}
function persistNative(journal){for(const [name,value] of [['native-media-keys',journal],['native-media-diagnostics',nativeDiagnostics],['native-media-transport',mediaTransport]])fs.writeFileSync(path.join(OUT,name+'.json'),JSON.stringify(value,null,2));}
async function nativeSnapshot(selector,meta){
  let media;try{media=await p.locator(selector).evaluate(m=>({currentSrc:m.currentSrc,currentTime:m.currentTime,duration:m.duration,paused:m.paused,readyState:m.readyState,networkState:m.networkState,seeking:m.seeking,seekable:Array.from({length:m.seekable.length},(_,i)=>[m.seekable.start(i),m.seekable.end(i)]),buffered:Array.from({length:m.buffered.length},(_,i)=>[m.buffered.start(i),m.buffered.end(i)]),error:m.error?{code:m.error.code,message:m.error.message}:null,events:m.__qaMediaEvents||[]}));}catch(e){media={snapshotError:String(e)}}
  nativeDiagnostics.push({...meta,at:Date.now(),media});fs.writeFileSync(path.join(OUT,'native-media-diagnostics.json'),JSON.stringify(nativeDiagnostics,null,2));
}
const state=()=>p.evaluate(()=>WosChat.viewer.state);
async function check(name,fn){if(SELECT&&!SELECT.has(name))return;active=name;try{await fn();results.push({name,pass:true});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:String(e.stack||e)});console.log('FAIL',name,String(e));if(p)await p.screenshot({path:path.join(OUT,'failure-'+results.length+'.png')}).catch(()=>{});}}
async function ready(){await p.waitForFunction(()=>{const i=document.querySelector('.mviewer img');return i&&i.complete&&i.naturalWidth>0});await F.settle(p);}
async function boot(phone=false){const b=await F.boot(phone,async c=>{
  await c.addInitScript(()=>{if(window!==window.top)return;window.__nativeKeys=[];window.addEventListener('keydown',e=>{if(!/^Arrow(Left|Right)$/.test(e.key))return;const row={key:e.key,trusted:e.isTrusted,target:e.target.tagName,path:e.composedPath().map(n=>n.tagName).filter(Boolean),prevented:e.defaultPrevented};__nativeKeys.push(row);setTimeout(()=>row.prevented=e.defaultPrevented,0)},true)});
  await c.route(/\/wizard\/v1\/apps(?:\?.*)?$/,r=>r.fulfill({json:{apps:[{id:'viewer-fixture',name:'Synthetic album',kind:'wizard',url:'/viewer-fixture/'}]}}));
  await c.route('**/viewer-fixture/**',r=>{
    const u=new URL(r.request().url());
    if(r.request().method()!=='GET')return r.fulfill({status:403,body:'No writes'});
    if(u.pathname==='/viewer-fixture/')return r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic album</title><button id="open">Open synthetic album</button><input id="draft" value="Synthetic unsent draft"><script>window.documentIdentity="synthetic-retained";window.arrows=0;addEventListener("keydown",e=>{if(/^Arrow/.test(e.key))arrows++});document.querySelector("#open").onclick=()=>parent.WizAppServices.connect(window,{}).media.view(parent.__album,1);</script>'});
    if(['/viewer-fixture/native-video.webm','/viewer-fixture/native-audio.wav'].includes(u.pathname)) {
      assert(process.env.QA_MEDIA_DIR,'sealed synthetic native media required');
      const body=fs.readFileSync(path.join(process.env.QA_MEDIA_DIR,path.basename(u.pathname))),range=r.request().headers()['range']||null;
      const response=nativeMediaResponse(body,u.pathname.endsWith('.webm')?'video/webm':'audio/wav',range);
      const row={url:u.pathname,requestRange:range,status:response.status,responseHeaders:response.headers,fixtureBytes:body.length,fixtureSha256:crypto.createHash('sha256').update(body).digest('hex'),responseBytes:response.body.length,fulfilled:false};
      mediaTransport.push(row);fs.writeFileSync(path.join(OUT,'native-media-transport.json'),JSON.stringify(mediaTransport,null,2));
      return r.fulfill(response).then(()=>{row.fulfilled=true;fs.writeFileSync(path.join(OUT,'native-media-transport.json'),JSON.stringify(mediaTransport,null,2));});
    }
    const m=/^\/viewer-fixture\/(\d+)x(\d+)\.svg$/.exec(u.pathname);if(!m)throw Error('uncatalogued synthetic media');
    const w=+m[1],h=+m[2];return r.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#19344d"/><path d="M0 0L${w} ${h}M${w} 0L0 ${h}" stroke="#8df" stroke-width="12"/><rect x="0" y="${h-30}" width="${w}" height="30" fill="#ffdf00"/><rect x="0" y="0" width="${w}" height="30" fill="#ef6b7b"/><text x="20" y="90" fill="white" font-size="45">SYNTHETIC ${w} × ${h}</text></svg>`});
  });
});ctx=b.c;p=F.getPage();p.setDefaultTimeout(10000);
await p.evaluate(()=>{const frame=document.createElement('iframe');frame.id='synthetic-album';frame.src='/viewer-fixture/';frame.style.cssText='position:fixed;left:24px;top:110px;width:550px;height:260px;z-index:60';(document.getElementById('device')||document.body).appendChild(frame);WizAppServices.attach(frame,{appId:'viewer-fixture',path:'/viewer-fixture/',isVisible:()=>true,isFront:()=>true});window.__album=[[2400,900],[786,1704],[1200,1200],[240,4800],[80,60]].map(([w,h],i)=>({url:`/viewer-fixture/${w}x${h}.svg`,name:`Synthetic ${i}: ${w}x${h}`,kind:'image',mime:'image/svg+xml'}));window.__underArrows=0;window.addEventListener('keydown',e=>{if(/^Arrow(Left|Right)$/.test(e.key))__underArrows++},true);});
await p.frameLocator('#synthetic-album').locator('#open').waitFor();return b;}
async function open(i=1){await p.evaluate(i=>WosChat.viewer.open(__album,i),i);await ready();}
async function clickOpen(){await p.frameLocator('#synthetic-album').locator('#open').click();await ready();}
async function geometry(){return p.evaluate(()=>{const v=document.querySelector('.mviewer'),s=v.querySelector('.mv-stage'),i=s.querySelector('img'),r=i.getBoundingClientRect(),b=s.getBoundingClientRect(),k=Math.min(r.width/i.naturalWidth,r.height/i.naturalHeight),w=i.naturalWidth*k,h=i.naturalHeight*k;return{shell:document.documentElement.dataset.shell,skin:window.WosSkin?.current,state:WosChat.viewer.state,viewport:{w:innerWidth,h:innerHeight},stage:b.toJSON(),pic:{left:r.left+(r.width-w)/2,right:r.left+(r.width+w)/2,top:r.top+(r.height-h)/2,bottom:r.top+(r.height+h)/2,w,h},ratio:i.naturalWidth/i.naturalHeight,controls:[...v.querySelectorAll('.mv-top button,.mv-bar button')].filter(e=>!e.hidden).map(e=>{const r=e.getBoundingClientRect();return{name:e.dataset.mv,rect:r.toJSON(),hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})}});}
async function fits(label){const g=await geometry();geometries.push({label,...g});assert.equal(g.shell,'desktop');assert.equal(g.state.long,false,'desktop must not width-fit long images');const a=g.pic,b=g.stage;assert(a.left>=b.left-.6&&a.right<=b.right+.6&&a.top>=b.top-.6&&a.bottom<=b.bottom+.6,'entire painted photo within stage');assert(Math.abs(a.w/a.h-g.ratio)<.001,'aspect retained');assert(Math.abs((a.left+a.right)-(b.left+b.right))<1&&Math.abs((a.top+a.bottom)-(b.top+b.bottom))<1,'photo centred');assert(b.top>=0&&b.bottom<=g.viewport.h,'stage within viewport');for(const c of g.controls)assert(c.hit&&c.rect.top>=0&&c.rect.bottom<=g.viewport.h&&c.rect.left>=0&&c.rect.right<=g.viewport.w,'visible hit-tested '+c.name);}
async function capture(name){await F.settle(p);const file=path.join(OUT,name+'.png');await p.screenshot({path:file});captures.push({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),geometry:await geometry()});}
async function close(){await p.evaluate(()=>{while(WosChat.viewer.isOpen())WosChat.viewer.close()});}
async function drag(cdp,points,end){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});for(let j=1;j<=10;j++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points.map((x,k)=>({x:x.x+(end[k].x-x.x)*j/10,y:x.y+(end[k].y-x.y)*j/10}))});await p.waitForTimeout(20);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(100);}
async function opacity(name){return Repair.opacity({p,out:OUT,name,settle:F.settle});}
(async()=>{fs.mkdirSync(OUT,{recursive:true});browser=await chromium.launch({headless:true});F.setBrowser(browser);
try{
await boot();
await check('desktop portrait initial-fit',async()=>{await clickOpen();await capture('desktop-portrait-'+(RED?'before':'after'));await fits('initial portrait');});
await close();
await check('iframe gallery arrows focus/order/count/propagation',async()=>{await clickOpen();assert(await p.evaluate(()=>document.activeElement.classList.contains('mviewer')),'focus leaves original iframe');for(const [key,index]of [['ArrowRight',2],['ArrowRight',3],['ArrowLeft',2],['ArrowLeft',1],['ArrowLeft',0],['ArrowLeft',4],['ArrowRight',0]]){await p.keyboard.press(key);await ready();assert.equal((await state()).i,index);assert.equal(await p.locator('.mv-ti small').textContent(),`${index+1} of 5`);}assert.equal(await p.evaluate(()=>__underArrows),0,'underlying capture handler sees no gallery arrows');assert.equal(await p.frameLocator('#synthetic-album').locator('body').evaluate(()=>arrows),0);});
await check('native media controls seek without gallery navigation',async()=>{
  const journal=[];persistNative(journal);
  try {
  // Proportional native check: UA timeline is an outcome check, not a page-dispatch oracle.
  // Chromium can consume trusted input internally with an empty page key journal.
  const shell='desktop',cdp=await ctx.newCDPSession(p),diagnostic=process.env.QA_NATIVE_DIAGNOSTIC==='1';
  const shellState=()=>p.evaluate(()=>({shell:document.documentElement.dataset.shell,idx:window.__wos?.idx??null,track:document.querySelector('#track')?.style.transform??null}));
  try {
    // Observe only. No test keyboard listener changes time, focus or event cancellation.
    await F.settle(p);assert.equal((await shellState()).shell,shell);
    for(const [kind,focusMode] of [['video','ua-timeline'],['video','host'],['audio','host']]) {
      const count=1;
      await close();await p.evaluate(kind=>{WosChat.viewer.open([{kind,url:kind==='video'?'/viewer-fixture/native-video.webm':'/viewer-fixture/native-audio.wav',name:'Synthetic native '+kind,mime:kind==='video'?'video/webm':'audio/wav'}],0)},kind);
      const selector='.mv-stage '+kind,meta={shell,kind,count,focusMode};
      let phase='metadata';
      try {
      await p.locator(selector).evaluate(m=>{m.__qaMediaEvents=[];for(const name of ['loadedmetadata','loadeddata','progress','canplay','seeking','seeked','stalled','suspend','error'])m.addEventListener(name,()=>m.__qaMediaEvents.push({name,currentTime:m.currentTime,readyState:m.readyState,networkState:m.networkState,seeking:m.seeking,at:performance.now()}));});
      await nativeSnapshot(selector,{...meta,phase:'opened'});
      await p.waitForFunction(s=>{const m=document.querySelector(s);return m&&m.readyState>=2&&Number.isFinite(m.duration)&&m.duration>20&&!m.error},selector);
      await nativeSnapshot(selector,{...meta,phase:'metadata-ready'});
      phase='seekable-precondition';
      await p.waitForFunction(s=>{const m=document.querySelector(s);return Array.from({length:m.seekable.length},(_,i)=>[m.seekable.start(i),m.seekable.end(i)]).some(([start,end])=>start<=10&&end>10)},selector);
      phase='initial-seek';
      await p.locator(selector).evaluate(m=>{m.pause();m.currentTime=10});
      await nativeSnapshot(selector,{...meta,phase:'seek-requested'});
      await p.waitForFunction(s=>Math.abs(document.querySelector(s).currentTime-10)<.1&&!document.querySelector(s).seeking,selector);
      await nativeSnapshot(selector,{...meta,phase:'seek-precondition-valid'});
      phase='trusted-native-key';
      let timeline=null,focusError=null;
      try {
        if(focusMode==='ua-timeline') {
          const dom=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
          const walk=n=>[n,...(n.children||[]).flatMap(walk),...(n.shadowRoots||[]).flatMap(walk)];
          timeline=walk(dom.root).find(n=>(n.attributes||[]).includes('-webkit-media-controls-timeline'));
          assert(timeline,'real native media timeline');await cdp.send('DOM.focus',{backendNodeId:timeline.backendNodeId});
        } else {
          // Focus the real host only; no dispatched events or keyboard/seek shim.
          await p.locator(selector).evaluate(m=>m.tabIndex=0);await p.locator(selector).focus();
        }
        assert(await p.locator(selector).evaluate(m=>m===document.activeElement&&m.controls),'native media host owns focus');
      } catch(e) {
        if(focusMode==='ua-timeline')throw e;
        focusError=String(e);journal.push({...meta,focusLanded:false,focusError,guardEvidence:'unit-proven; browser dispatch not observed'});continue;
      }
      const initial=await state(),key='ArrowRight';
      await p.evaluate(()=>{window.__nativeKeys=[];window.__underArrows=0});
      const before=await p.locator(selector).evaluate(m=>m.currentTime),shellBefore=await shellState(),underBefore=await p.evaluate(()=>__underArrows);
      const seekedBefore=await p.locator(selector).evaluate(m=>m.__qaMediaEvents.filter(e=>e.name==='seeked').length);
      await p.keyboard.press(key);await p.waitForTimeout(120);
      const after=await p.locator(selector).evaluate(m=>m.currentTime),events=await p.evaluate(()=>__nativeKeys),current=await state(),shellAfter=await shellState(),underAfter=await p.evaluate(()=>__underArrows);
      const seekedAfter=await p.locator(selector).evaluate(m=>m.__qaMediaEvents.filter(e=>e.name==='seeked').length);
      const row={...meta,key,focusLanded:true,before,after,delta:after-before,events,indexBefore:initial.i,indexAfter:current.i,shellBefore,shellAfter,underBefore,underAfter,seekedBefore,seekedAfter,timelineBackendNodeId:timeline?.backendNodeId??null,
        guardEvidence:focusMode==='ua-timeline'?'native controls unaffected; guard not exercised':events.length?'page dispatch observed':'unit-proven; browser dispatch not observed'};
      journal.push(row);persistNative(journal);
      await nativeSnapshot(selector,{...meta,phase:'after-trusted-key'});
      // Baseline host behavior is diagnostic; it need not reproduce an old hijack.
      if(!diagnostic||focusMode==='ua-timeline') {
        assert.equal(current.i,initial.i,'native key must not navigate gallery');assert(current.open);
        assert.equal(underBefore,0);assert.equal(underAfter,0,'underlying capture handler sees no native arrows');
        assert.deepEqual(shellAfter,shellBefore,'native key must not change underlying shell workspace');
      }
      if(focusMode==='ua-timeline') {
        assert(after-before>.01,'native browser seeking must change currentTime');
        assert(seekedAfter>seekedBefore,'real native seeked event after trusted key');
      } else if(events.length&&!diagnostic) {
        assert(events.length===1&&events[0].trusted&&events[0].target===kind.toUpperCase()&&!events[0].prevented,'observed trusted host key must remain uncancelled');
      }
      }catch(e){await nativeSnapshot(selector,{...meta,phase,error:String(e.stack||e)});throw e;}
      finally{persistNative(journal);}
    }
  }finally{await cdp.detach();await close();}
  await ctx.close();await boot();
  }finally{persistNative(journal);}
});
if(!RED){
await check('desktop shapes at large/small/resized hosts',async()=>{for(const size of [{width:1440,height:900},{width:760,height:540},{width:420,height:650}]){await p.setViewportSize(size);for(let i=0;i<5;i++){await open(i);await fits(`${size.width}x${size.height} item ${i}`)}}await p.setViewportSize({width:1440,height:900});});
await check('desktop explicit zoom/reset still works',()=>Repair.zoom({p,out:OUT,settle:F.settle,state,open,fits:process.env.QA_ZOOM_DIAGNOSTIC==='1'?null:fits}));
await check('two real skins/live switch/opaque chrome and menu',async()=>{await Repair.paintCalibration({p,out:OUT});await open();for(const skin of ['nebula','signal','sepia']){await p.evaluate(skin=>WosSkin.set(skin),skin);await p.waitForFunction(skin=>WosSkin.current===skin&&document.documentElement.dataset.skin===skin,skin);await F.settle(p);await fits(skin);await opacity(skin);await capture('desktop-'+skin);await p.locator('.mv-stage img').click({button:'right'});await opacity(skin+' menu');await p.keyboard.press('Escape');assert((await state()).open&&!(await state()).menu,'Escape closes only menu');}});
await check('Share and Save retain selected synthetic file',async()=>{await p.evaluate(()=>{window.WosShareSheet=null;window.__shared=[];Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async x=>{__shared.push({name:x.files?.[0]?.name,size:x.files?.[0]?.size})}})});await open(2);await p.locator('[data-mv="share"]').click();await p.waitForFunction(()=>__shared.length===1);assert.equal(await p.evaluate(()=>__shared[0].name),'Synthetic 2: 1200x1200');const download=p.waitForEvent('download');await p.locator('[data-mv="save"]').click();const d=await download;assert((await d.suggestedFilename()).includes('Synthetic 2'));assert.equal(await d.failure(),null);});
await check('Escape/outside close only viewer and restore app focus/draft',async()=>{await close();await clickOpen();const before=await p.frameLocator('#synthetic-album').locator('#draft').inputValue();await p.keyboard.press('Escape');assert(!(await state()).open);assert.equal(await p.evaluate(()=>document.activeElement.id),'synthetic-album');assert.equal(await p.frameLocator('#synthetic-album').locator('#draft').inputValue(),before);await clickOpen();const g=await geometry();await p.mouse.click(g.stage.left+4,(g.stage.top+g.stage.bottom)/2);assert(!(await state()).open);assert.equal(await p.frameLocator('#synthetic-album').locator('body').evaluate(()=>documentIdentity),'synthetic-retained');});
if(!SELECT || [...SELECT].some(name=>name.startsWith('phone '))){
await ctx.close();await boot(true);
await check('phone UA/touch long-reading pan/fling and bottom reach',()=>Repair.phoneBottom({p,ctx,out:OUT,drag,open,state,capture}));
await check('phone pinch/pan/reset and gallery swipe preserve order',()=>Repair.phoneGestures({p,ctx,out:OUT,drag,open,state,capture,settle:F.settle}));
await check('phone Back/menu/outside retain mounted synthetic app',async()=>{await p.evaluate(()=>WosChat.viewer.menu());await p.evaluate(()=>__wosNativeBack());assert((await state()).open&&!(await state()).menu);await p.evaluate(()=>__wosNativeBack());assert(!(await state()).open);assert.equal(await p.frameLocator('#synthetic-album').locator('#draft').inputValue(),'Synthetic unsent draft');await open(0);const g=await geometry();await p.touchscreen.tap(g.stage.left+4,g.stage.top+4);assert(!(await state()).open);});
}
}
await ctx.close();
if(!RED) await check('standalone dark fallback without Appearance host',async()=>{
  ctx=await browser.newContext({viewport:{width:1100,height:760},serviceWorkers:'block'});
  const tree=process.env.QA_TREE||__dirname;
  await ctx.route('**/*',r=>{const u=new URL(r.request().url());if(r.request().method()!=='GET'||u.origin!=='https://viewer.invalid')return r.abort();if(u.pathname==='/')return r.fulfill({contentType:'text/html',body:'<!doctype html><html data-shell="desktop"><link rel="stylesheet" href="/core/base.css"><link rel="stylesheet" href="/core/chats.css"><script src="/core/chat-kit.js"></script><body><button id="source">Synthetic standalone</button>'});if(['/core/base.css','/core/chats.css','/core/chat-kit.js'].includes(u.pathname))return r.fulfill({contentType:u.pathname.endsWith('.css')?'text/css':'application/javascript',body:fs.readFileSync(path.join(tree,'web',u.pathname))});return r.abort()});
  p=await ctx.newPage();await p.goto('https://viewer.invalid/');await p.evaluate(()=>{const c=document.createElement('canvas');c.width=786;c.height=1704;const g=c.getContext('2d');g.fillStyle='#19344d';g.fillRect(0,0,c.width,c.height);window.__album=[{url:c.toDataURL(),kind:'image',name:'Synthetic standalone'}];WosChat.viewer.open(__album)});await ready();
  await opacity('standalone-dark');assert.equal(await p.evaluate(()=>document.documentElement.dataset.skin),undefined);await capture('standalone-dark');await ctx.close();
});
}catch(e){results.push({name:active,pass:false,harnessError:String(e.stack||e)});}finally{await browser?.close();const report={red:RED,source:process.env.QA_SOURCE_SHA,synthetic:true,physicalDevice:false,results,geometries,captures,transport:F.report};fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length,unknown:F.report.unknown,errors:F.report.errors}));if(F.report.unknown.length||F.report.errors.length)process.exitCode=2;else process.exitCode=results.some(x=>!x.pass)?1:0;}
})().catch(e=>{console.error(e);process.exitCode=2});
