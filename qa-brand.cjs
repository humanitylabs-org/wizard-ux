// Supplied-logo regression; real rendered shell, intercepted writes, never replace semantic sigils.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const W=process.env.QA_WEB_DIR||__dirname, OUT=process.env.QA_OUT||path.join(__dirname,'qa-brand-out');
fs.mkdirSync(OUT,{recursive:true});let pass=0,fail=0;
const ok=(v,n)=>{console.log((v?'PASS ':'FAIL ')+n);v?pass++:fail++;};
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
(async()=>{const b=await chromium.launch({executablePath:process.env.QA_CHROME,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
for(const shell of ['phone','desktop']){
 const live=process.env.QA_LIVE==='1', origin=require('./tools/qa-paths.cjs').origin(), base=origin+'/wizard-os-home/';
 const c=await b.newContext({viewport:shell==='phone'?{width:412,height:892}:{width:1440,height:960},isMobile:shell==='phone',hasTouch:shell==='phone',userAgent:shell==='phone'?'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36':undefined,serviceWorkers:'block'});
 let writes=0;await c.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(q.method()!=='GET'){writes++;return r.fulfill({status:403,body:'{}'});}if(live)return r.continue();
 if(u.pathname.startsWith('/wizard-os-home/')){const f=u.pathname.slice(16)||'index.html', p=path.join(W,'web',f);if(!fs.existsSync(p))return r.fulfill({status:200,body:''});const ct=f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':f.endsWith('.png')?'image/png':f.endsWith('.ico')?'image/x-icon':f.endsWith('.webmanifest')?'application/manifest+json':'application/javascript';return r.fulfill({status:200,contentType:ct,body:fs.readFileSync(p)});}
 const data=/\/sessions$/.test(u.pathname)?{data:[],has_more:false}:/\/apps$/.test(u.pathname)?{apps:[]}:{};return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
 await c.addInitScript(()=>{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.v1','true');});
 const p=await c.newPage(),errs=[];p.on('pageerror',e=>errs.push(String(e)));p.on('requestfailed',r=>console.log('REQUESTFAILED',r.url(),r.failure()));
 await p.goto(base+(shell==='desktop'?'desktop.html':''));await p.waitForFunction(()=>window.__wos||window.__wux);await p.waitForTimeout(1200);await p.evaluate(()=>window.WosTour?.finish('qa'));
 ok(await p.getAttribute('html','data-shell')===shell,shell+' correct shell');
 ok(await p.evaluate(()=>!!window.WizBrand?.html),shell+' supplied brand renderer');
 if(await p.evaluate(()=>!!window.WizBrand)){
  ok(await p.evaluate(()=>WizBrand.icon('★')==='★'&&WizBrand.icon('⚡')==='⚡'),shell+' action stars and lightning preserved');
  ok(await p.evaluate(()=>WizSigil.of({id:'wizard'}).glyph==='hat'&&WizSigil.of({id:'wizard-music'}).glyph==='music'),shell+' Chats and Music semantic sigils preserved');
  if(shell==='phone'){await p.evaluate(()=>__wos.toast('✦','Brand QA',20000));ok(await p.locator('#toast .wizard-brand-mark').count()===1,'phone brand toast uses hat');ok(await p.locator('#txRouteIcon .wizard-brand-mark').count()===1,'phone initial transcript uses hat');}
 }
 if(shell==='desktop'){
  ok(await p.locator('#logo .wizard-brand-mark').count()===1,'desktop toolbar uses supplied hat');await p.locator('#logo').click();ok(await p.locator('#palette').isVisible().catch(()=>false),'desktop hat retains search action');
 }
 for(const f of ['icon-192.png','icon-512.png','brand/wizard-mark-white.png','favicon.ico','apple-touch-icon.png']){
  const body=live ? await (await c.request.get(base+f)).body() : f==='favicon.ico' ? fs.readFileSync(path.join(W,'web',f)) : Buffer.from(await p.evaluate(async url=>Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),base+f)), local=path.join(W,'web',f);ok(fs.existsSync(local)&&hash(body)===hash(fs.readFileSync(local)),shell+(live||f!=='favicon.ico'?' exact bytes ':' staged file ')+f);
 }
 const man=await (await c.request.get(base+'manifest.webmanifest')).json();ok(man.id==='/wizard-os-home/'&&man.scope==='/wizard-os-home/',shell+' PWA identity unchanged');
 ok(errs.length===0,shell+' zero page errors '+errs.join(';'));
 await p.screenshot({path:path.join(OUT,shell+'.png')});await c.close();
}
await b.close();console.log(JSON.stringify({pass,fail}));process.exit(fail?1:0);})().catch(e=>{console.error(e);process.exit(2)});
