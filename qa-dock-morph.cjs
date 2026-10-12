// Dock morph acceptance: real touch gestures + current-take screenshot custody. API writes are fixtures only.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/home/telos/node_modules/playwright');
const fs = require('fs'), path = require('path');
const W = process.env.QA_WEB_DIR || __dirname;
const URL_ = 'https://private.wizard001.com/wizard-os-home/';
let pass=0,fail=0;
const ok=(v,n,d='')=>{v?pass++:fail++; console.log((v?'PASS ':'FAIL ')+n+' '+d);};
// Reuse the existing isolated boot (all network intercepted, writes only recorded, never delivered).
const source = fs.readFileSync(path.join(__dirname,'qa-voice-nav.cjs'),'utf8');
const THREADS=Array.from({length:40},(_,i)=>({id:'qa-'+i,title:'QA thread '+i,source:'api_server',message_count:2,last_active:Date.now()/1000}));
const SEND_MS=1500;
eval(source.slice(source.indexOf('async function boot'),source.indexOf('async function tapOrb')).replace('async function boot','global.boot = async function'));
async function tapOrb(p){const r=await p.locator('#orbWrap').boundingBox();await p.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);await p.waitForTimeout(700);}
async function swipe(ctx,p,dx,dy=0){const r=await p.locator('#orbWrap').boundingBox();const x=r.x+r.width/2,y=r.y+r.height/2;const c=await ctx.newCDPSession(p); const pts=(xx,yy)=>[{x:xx,y:yy,id:1}];await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:pts(x,y)});for(let i=1;i<=12;i++){await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:pts(x+dx*i/12,y+dy*i/12)});await p.waitForTimeout(16);}await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(700);}
(async()=>{
 const b=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 const {ctx,p,errs,runs}=await boot(b);
 await p.evaluate(()=>{localStorage.setItem('wos.tour.v1','true');window.WosTour?.finish('qa');});
 const uploads=[], held=[]; let holdUploads=false;
 await ctx.route('**/files/upload',async r=>{
   if (holdUploads) { held.push(r); return; }
   uploads.push(r.request().postDataBuffer());
   await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({file:{id:'qa-shot-'+uploads.length,filename:'screen.png',mime:'image/png',bytes:100}})});
 });
 // Mock only the new native primitive. Its pixels are a real browser capture; native PixelCopy has a separate device gate.
 let delay=80, failure='';
 const sampling=[];
 await p.exposeFunction('fixtureCapture',id=>{
   if (id.startsWith('cancel:')) return;
   const lag=delay,error=failure;
   setTimeout(async()=>{
     try {
       const admitted=await p.evaluate(id=>window.__wosScreenSample(id),id); if (!admitted) return;
       sampling.push(await p.evaluate(()=>getComputedStyle(document.getElementById('dock')).visibility));
       const shot=await p.screenshot();
       await p.evaluate(id=>window.__wosScreenSampled(id),id);
       await p.evaluate(({id,data,error})=>window.__wosScreenResult?.(id,data,error),{id,data:'data:image/png;base64,'+shot.toString('base64'),error});
     } catch(e) {}
   },lag);
 });
 await p.evaluate(()=>{window.WizardOSNative={sideButton:()=> '{}',keepAwake(){},haptic(){}};window.wizardScreenPort={postMessage:id=>window.fixtureCapture(id)};});
 for(const width of [360,412]){
  await p.setViewportSize({width,height:892});await tapOrb(p);
  const g=await p.evaluate(()=>{const dock=document.querySelector('#dock').getBoundingClientRect();const ids=['arcCancel','arcPause','orbWrap','arcScreen','arcAttach'];return ids.map(id=>{const e=document.getElementById(id);if(!e)return {id,missing:true};const r=e.getBoundingClientRect();return {id,x:r.x,w:r.width,h:r.height,inDock:r.y>=dock.y&&r.bottom<=dock.bottom,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),opacity:+getComputedStyle(e).opacity};});});
  ok(g.every(x=>!x.missing&&x.inDock&&x.w>=44&&x.h>=44&&x.hit&&x.opacity>.9),width+'px: all five controls inside dock and hit-testable',JSON.stringify(g));
  ok(g.every((x,i)=>!i||x.x>=g[i-1].x+g[i-1].w),width+'px: order X Pause Orb Screenshot Attach, no overlap');
  if(g.some(x=>x.missing)){await b.close();console.log(pass+' pass '+fail+' fail');process.exit(1);}
  await p.locator('#arcCancel').tap();await p.waitForTimeout(500);
 }
 await p.evaluate(()=>__wos.goDesk(0,true));await p.waitForTimeout(500);await tapOrb(p);
 let ix=await p.evaluate(()=>__wos.idx);
 await swipe(ctx,p,-150);ok(await p.evaluate(()=>__wos.idx===1&&__wos.voice==='listen'),'orb left swipe switches desk without sending');
 await swipe(ctx,p,150);ok(await p.evaluate(()=>__wos.idx===0&&__wos.voice==='listen'),'orb right swipe returns while recording');
 await p.locator('#arcPause').tap();await swipe(ctx,p,-150);ok(await p.evaluate(()=>__wos.idx===1&&__wos.voice==='paused'),'paused orb swipe navigates and preserves take');
 await p.locator('#arcPause').tap();await swipe(ctx,p,0,-200);ok(await p.evaluate(()=>document.getElementById('launcher').classList.contains('open')&&__wos.voice==='listen'),'orb up swipe still opens apps while recording');
 await p.evaluate(()=>window.__wosNativeBack());await p.waitForTimeout(500);
 // Verify representative app-owned bottom tabs at every sampled pixel, immediately above the dock.
 await p.evaluate(()=>{const dock=document.getElementById('dock').getBoundingClientRect();const nav=document.createElement('nav');nav.id='qaAppNav';Object.assign(nav.style,{position:'absolute',left:'0',right:'0',top:(dock.top-56)+'px',height:'56px',zIndex:'49',display:'flex',background:'#18201a'});nav.innerHTML=['Home','Search','Library','Queue'].map(x=>'<button style="flex:1" onclick="window.__qaTab=this.textContent">'+x+'</button>').join('');document.getElementById('device').append(nav);});
 for(const tab of ['Home','Search','Library','Queue']){await p.locator('#qaAppNav button',{hasText:tab}).tap();ok(await p.evaluate(()=>window.__qaTab)===tab,'app '+tab+' tab remains tappable');}
 await p.locator('#arcScreen').tap();await p.waitForFunction(()=>!document.getElementById('arcScreen').disabled);ok(await p.locator('#attachCount').textContent()==='1','screenshot attaches to current take');ok(uploads.length===1&&uploads[0].includes(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),'upload multipart contains captured PNG bytes',uploads.map(x=>x.length).join(','));
 ok(await p.evaluate(()=>__wos.voice==='listen'&&!document.getElementById('device').classList.contains('capturing-screen')),'screen capture restores UI and leaves recorder running');
 await tapOrb(p);await p.waitForTimeout(4500);ok(runs.some(r=>r.wizard_file_ids?.includes('qa-shot-1')),'voice send payload includes screenshot file ID');
 await p.waitForTimeout(1000);await tapOrb(p);failure='Capture refused';await p.locator('#arcScreen').tap();await p.waitForFunction(()=>!document.getElementById('arcScreen').disabled);ok(await p.locator('#attachCount').textContent()===''&&await p.evaluate(()=>__wos.voice==='listen'),'capture failure attaches nothing and preserves take');failure='';
 delay=1500;await p.locator('#arcScreen').tap();await p.waitForTimeout(600);await p.locator('#arcCancel').tap();await p.waitForTimeout(300);await tapOrb(p);await p.waitForTimeout(1800);ok(await p.locator('#attachCount').textContent()===''&&uploads.length===1,'late capture after Cancel/new take never attaches to new take');
 delay=1400;await p.locator('#arcScreen').tap();await p.waitForTimeout(600);await tapOrb(p);ok(await p.evaluate(()=>__wos.voice==='listen'),'send while capture pending waits rather than omitting screenshot');await p.waitForTimeout(1600);ok(await p.locator('#attachCount').textContent()==='1','pending shot completes on original take');
 await p.locator('#arcCancel').tap();await p.waitForTimeout(500);ok(await p.evaluate(()=>__wos.voice==='idle'),'X still cancels');
 // Reviewer regression: a stalled upload must never own controls on the next take.
 delay=80;holdUploads=true;await tapOrb(p);
 let uploading=p.waitForRequest(r=>r.url().endsWith('/files/upload'));
 await p.locator('#arcScreen').tap();await uploading;await p.waitForTimeout(100);
 ok(await p.locator('#arcScreen').isDisabled(),'stalled upload owns Screenshot only on current take');
 await p.locator('#arcCancel').tap();await tapOrb(p);
 ok(await p.locator('#arcScreen').isEnabled(),'Cancel/new take immediately releases Screenshot during stalled upload');
 holdUploads=false;await p.locator('#arcScreen').tap();await p.waitForFunction(()=>!document.getElementById('arcScreen').disabled);
 ok(await p.locator('#attachCount').textContent()==='1','new take can capture while previous upload is abandoned');
 await p.locator('#arcCancel').tap();await p.waitForTimeout(400);
 // Real fetch abort deadline, not a simulated successful response.
 holdUploads=true;await tapOrb(p);uploading=p.waitForRequest(r=>r.url().endsWith('/files/upload'));
 await p.locator('#arcScreen').tap();await uploading;
 await p.waitForFunction(()=>!document.getElementById('arcScreen').disabled,null,{timeout:23000});
 ok(await p.locator('#attachCount').textContent()===''&&await p.evaluate(()=>__wos.voice==='listen'),'stalled upload deadline clears reservation and leaves take usable');
 ok(await p.locator('#arcScreen').isEnabled(),'upload timeout restores Screenshot without a reload');
 ok(sampling.every(s=>s==='hidden'),'chrome hidden at actual sample even for delayed capture',sampling.join(','));
 await p.locator('#arcCancel').tap();holdUploads=false;
 for(const r of held) await r.abort().catch(()=>{});
 ok(errs.length===0,'no page errors',errs.join('|'));
 await b.close();console.log(pass+' pass '+fail+' fail');process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(2)});
