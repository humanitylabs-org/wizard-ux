// Borderless default acceptance: phone starts Borderless on fresh storage, Settings → Windows → Borderless apps
// switches it off/on without rebuilding the app frame and survives reload; desktop always keeps framed windows and
// shows no switch. Read-only: every non-GET request is aborted.
// QA_URL=https://… [QA_OUT=dir] [CAND_DIR=web dir to serve /wizard-os-home/ from] node tools/qa-borderless-default.cjs
const {chromium}=require('playwright'),fs=require('fs'),path=require('path');
const BASE=process.env.QA_URL,OUT=process.env.QA_OUT||'qa-borderless-default',CAND=process.env.CAND_DIR;let fails=0;const res=[],errs=[];
const check=(name,ok,detail)=>{res.push({name,ok:!!ok,detail});if(!ok)fails++;console.log((ok?'PASS ':'FAIL ')+name+(ok?'':' '+JSON.stringify(detail)));};
const TYPES={'.css':'text/css','.html':'text/html','.js':'application/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.txt':'text/plain'};
(async()=>{fs.mkdirSync(OUT,{recursive:true});const b=await chromium.launch();
const ctx=async o=>{const c=await b.newContext({serviceWorkers:'block',...o});
  await c.route('**/*',r=>['GET','HEAD'].includes(r.request().method())?r.fallback():r.abort());
  if(CAND)await c.route('**/wizard-os-home/**',r=>{let rel=new URL(r.request().url()).pathname.replace(/^.*?\/wizard-os-home\//,'');if(!rel)rel='index.html';const f=path.join(CAND,rel);return fs.existsSync(f)&&fs.statSync(f).isFile()?r.fulfill({body:fs.readFileSync(f),contentType:TYPES[path.extname(f)]||'application/octet-stream'}):r.fallback();});
  return c;};
const state=p=>p.evaluate(()=>{const id=__wos.desks[__wos.idx].focus,w=document.querySelector(`.win[data-win="${id}"]`),r=e=>e&&e.getBoundingClientRect().toJSON(),f=w&&w.querySelector('iframe');
  return {frame:document.documentElement.dataset.skinFrame,win:r(w),body:r(w&&w.querySelector('.wbody')),bar:w&&getComputedStyle(w.querySelector('.wbar')).height,border:w&&getComputedStyle(w).borderTopWidth,iframeTag:f&&(f.__qaTag||(f.__qaTag=Math.random().toString(36).slice(2)))};});
// ---- phone, fresh storage ----
const pc=await ctx({viewport:{width:412,height:892},deviceScaleFactor:2,hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'}),p=await pc.newPage();p.on('pageerror',e=>errs.push('phone: '+e.message));
await p.goto(BASE+'/wizard-os-home/?open=wisdom&shell=phone',{waitUntil:'domcontentloaded'});
await p.frameLocator('iframe[src*="/wisdom/"]').locator('body').waitFor({timeout:30000});await p.waitForTimeout(2000);
let s=await state(p);check('phone: fresh install starts Borderless',s.frame==='borderless',s);
check('phone: app canvas is edge to edge',s.body&&s.body.x===0&&Math.round(s.body.right)===412,s);
await p.screenshot({path:OUT+'/phone-borderless.png'});
const tag=s.iframeTag;
await p.evaluate(()=>__wos.openSettings());await p.waitForTimeout(600);
const sw=p.locator('#settingsBody [data-skinborderless]');
check('phone: Settings shows the Borderless apps switch, on',await sw.count()===1&&await sw.getAttribute('aria-checked')==='true',await sw.count());
await sw.scrollIntoViewIfNeeded();await p.screenshot({path:OUT+'/phone-settings-on.png'});
await sw.click();await p.waitForTimeout(400);
check('phone: switch turns off',await p.locator('#settingsBody [data-skinborderless]').getAttribute('aria-checked')==='false');
await p.locator('#settingsBody [data-skinborderless]').scrollIntoViewIfNeeded();await p.screenshot({path:OUT+'/phone-settings-off.png'});
await p.evaluate(()=>__wos.closeSheets(true));await p.waitForTimeout(600);
s=await state(p);check('phone: off restores framed windows without reloading the app',s.frame==='framed'&&s.iframeTag===tag&&s.body.x>0,s);
await p.screenshot({path:OUT+'/phone-framed.png'});
await p.reload({waitUntil:'domcontentloaded'});await p.frameLocator('iframe[src*="/wisdom/"]').locator('body').waitFor({timeout:30000});await p.waitForTimeout(1500);
s=await state(p);check('phone: Off survives reload',s.frame==='framed',s);
await p.evaluate(()=>__wos.openSettings());await p.waitForTimeout(500);await p.locator('#settingsBody [data-skinborderless]').click();await p.evaluate(()=>__wos.closeSheets(true));await p.waitForTimeout(600);
s=await state(p);check('phone: switch back on returns to Borderless',s.frame==='borderless'&&s.body.x===0,s);
await p.evaluate(()=>__wosNativeBack());await p.waitForTimeout(800);
check('phone: Back keeps Wizard open',p.url().startsWith(BASE)&&await p.locator('#device').isVisible(),p.url());
// ---- desktop, storage that says Borderless ----
const dc=await ctx({viewport:{width:1440,height:900}}),dp=await dc.newPage();dp.on('pageerror',e=>errs.push('desktop: '+e.message));
await dp.addInitScript(()=>{try{if(!sessionStorage.qaSeeded){localStorage.setItem('wos.skin.composition.v1',JSON.stringify({version:1,extends:'nebula',frame:{foundation:'borderless'}}));sessionStorage.qaSeeded=1;}}catch(e){}});
await dp.goto(BASE+'/wizard-os-home/?open=wisdom&shell=desktop',{waitUntil:'domcontentloaded'});
await dp.frameLocator('iframe[src*="/wisdom/"]').locator('body').waitFor({timeout:30000});await dp.waitForTimeout(1500);
const d=await dp.evaluate(()=>{const w=document.querySelector('.win:has(iframe[src*="/wisdom/"])'),cs=getComputedStyle(w),bar=w.querySelector('.wbar');
  const host=document.createElement('div');document.body.appendChild(host);const m=WosSettings.mount(host,{});const has=!!host.querySelector('[data-skinborderless]');m.destroy();host.remove();
  return {shell:document.documentElement.dataset.shell,frame:document.documentElement.dataset.skinFrame,border:cs.borderTopWidth,radius:cs.borderTopLeftRadius,barShown:getComputedStyle(bar).display!=='none'&&bar.getBoundingClientRect().height,settingsSwitch:has};});
check('desktop: framed windows even when phone storage says Borderless',d.shell==='desktop'&&d.frame==='framed'&&d.border==='1px'&&d.barShown,d);
check('desktop: Settings has no borderless switch',d.settingsSwitch===false,d);
await dp.screenshot({path:OUT+'/desktop.png'});
check('no page errors',errs.length===0,errs);
fs.writeFileSync(OUT+'/result.json',JSON.stringify({base:BASE,candidate:!!CAND,fails,res},null,1));await b.close();console.log(fails?`${fails} FAILED`:'ALL PASS');process.exit(fails?1:0);})();
