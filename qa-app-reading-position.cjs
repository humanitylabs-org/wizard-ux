// Execute on Thales under /Volumes/ThalesMedia/AndroidBuilds/worker.lock.
// Local shell + deterministic readers; optional actual I Ching GET-only proxy.
const fs=require('fs'), path=require('path'), http=require('http'), os=require('os'), assert=require('assert/strict');
const {chromium}=require(process.env.PW||'/Users/thales/workspace/wizard-mobile-link-candidate/node_modules/playwright');
const ROOT=process.env.QA_WEB_DIR||__dirname, OUT=process.env.QA_OUT||path.join(ROOT,'evidence/reading-position');
fs.mkdirSync(OUT,{recursive:true});
let version='abc0001', origin, writes=[], errors=[];
const checks=[];
function ok(name,value,detail){checks.push({name,pass:!!value,detail});console.log(value?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));assert.ok(value,name);}
const apps=[{id:'wisdom',url:'/wisdom/',name:'Wisdom'},{id:'iching',url:process.env.QA_REAL?'/iching/history/83154b50-f7f9-47b3-9ba5-c7bbf8a33d3b':'/iching/',name:'I Ching'}];
const paras=Array.from({length:100},(_,i)=>`<p id="p${i}">Paragraph ${i}: a dependable reading place. ${'Long reading content. '.repeat(10)}</p>`).join('');
function reader(url){const nested=url.includes('nested'),late=url.includes('late');return `<!doctype html><html><meta name="viewport" content="width=device-width"><style>body{margin:0;font:18px/1.8 sans-serif}p{margin:0 12px 20px}#panel{height:80vh;overflow:auto}</style><body>${nested?'<h1>Panel reader</h1><div id="panel">':''}<article id="text">${late?'Loading…':paras}</article>${nested?'</div>':''}<script>${late?`setTimeout(()=>document.querySelector('#text').innerHTML=${JSON.stringify(paras)},900);`:''}history.scrollRestoration='manual';requestAnimationFrame(()=>scrollTo(0,0));</script></body></html>`;}
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost'),send=(s,ct='text/html',status=200)=>{res.writeHead(status,{'Content-Type':ct,'Cache-Control':'no-store'});res.end(s)};
 if(!['GET','HEAD'].includes(req.method)){writes.push({method:req.method,url:req.url});return send('{}','application/json',405);}
 if(u.pathname.endsWith('/ux-version.txt'))return send(version,'text/plain');
 if(u.pathname.endsWith('/ux-changes.json'))return send('[]','application/json');
 if(u.pathname==='/wizard/v1/apps')return send(JSON.stringify({apps}),'application/json');
 if(u.pathname==='/wizard/v1/bootstrap')return send(JSON.stringify({bootstrap:1,endpoints:{apps:'/wizard/v1/apps'},settings:{agent:{name:'QA'}},capabilities:{}}),'application/json');
 if(u.pathname==='/wizard/hermes/api/sessions')return send('{"data":[],"has_more":false}','application/json');
 if(u.pathname.endsWith('/thread-seen'))return send('{"state":{"initializedAt":1,"threads":{}}}','application/json');
 if(u.pathname.startsWith('/wizard/'))return send('{}','application/json');
 if(u.pathname.startsWith('/iching/')&&process.env.QA_REAL){try{const r=await fetch('https://wizard.tailc0f369.ts.net'+req.url);return send(Buffer.from(await r.arrayBuffer()),r.headers.get('content-type')||'text/html',r.status)}catch(e){return send(String(e),'text/plain',502)}}
 if(u.pathname.startsWith('/wisdom/')||u.pathname.startsWith('/iching/'))return send(reader(req.url));
 if(u.pathname.startsWith('/wizard-os-home/')){const f=u.pathname.slice(16)||'index.html',p=path.resolve(ROOT,'web',f);if(!p.startsWith(path.resolve(ROOT,'web')+path.sep))return send('','text/plain',403);if(['data.js','summaries.js'].includes(f))return send('','application/javascript');if(!fs.existsSync(p))return send('','text/plain',404);return send(fs.readFileSync(p),f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':'application/octet-stream');}
 return send('','text/plain',404);
});
async function boot(browser,mobile){const ctx=await browser.newContext({viewport:mobile?{width:412,height:892}:{width:1440,height:1000},hasTouch:mobile,isMobile:mobile,serviceWorkers:'block'});await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await ctx.addInitScript(()=>{if(window!==parent)return;localStorage.setItem('wos.coached','true');localStorage.setItem('wos.shell','mobile');});const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));await p.goto(origin+'/wizard-os-home/'+(mobile?'?shell=phone':'desktop.html?shell=desktop'));await p.waitForFunction(m=>!!(m?window.__wos:window.__wux),mobile);await p.evaluate(()=>WizCore.appsLoaded());return{p,ctx};}
async function open(p,mobile,id,url){await p.evaluate(({mobile,id,url})=>{const a=WizCore.apps(mobile?'mobile':'desktop').APP[id];a.url=url;(mobile?__wos:__wux).openApp(a)},{mobile,id,url});return waitFrame(p,url);}
async function waitFrame(p,url){await p.waitForFunction(url=>[...document.querySelectorAll('iframe')].some(f=>{try{return f.contentWindow.location.pathname+f.contentWindow.location.search===url&&f.contentDocument.readyState==='complete'}catch(_){return false}}),url);return p.frames().find(f=>new URL(f.url()).pathname+new URL(f.url()).search===url);}
async function scroll(fr,nested,y){await fr.waitForFunction(({nested,y})=>{const el=nested?document.querySelector('#panel'):document.scrollingElement;return el&&el.clientHeight>0&&el.scrollHeight-el.clientHeight>=y},{nested,y});await fr.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await fr.evaluate(({nested,y})=>nested?document.querySelector('#panel').scrollTop=y:scrollTo(0,y),{nested,y});await fr.waitForTimeout(180);assert.ok(Math.abs(await pos(fr,nested)-y)<=2,'test scroll reached requested nonzero position');}
async function pos(fr,nested){return fr.evaluate(n=>n?document.querySelector('#panel').scrollTop:scrollY,nested);}
async function reload(p,url){
 if(new URL(url,origin).search){await p.evaluate(()=>WizAppReadingPosition.flush());const old=await waitFrame(p,url);await old.evaluate(()=>location.reload());}
 else await p.reload();
 const fr=await waitFrame(p,url);await fr.waitForTimeout(1600);return fr;
}
async function close(p,mobile,id){await p.evaluate(({mobile,id})=>{const s=mobile?__wos:__wux;for(const w of Object.values(s.wins))if(w.appId===id)s.closeWin(w.id)},{mobile,id});}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;const b=await chromium.launch({headless:true});let failure=null;
try{for(const mobile of [true,false]){const tag=mobile?'phone':'desktop';const{p,ctx}=await boot(b,mobile);
 let fr=await open(p,mobile,'wisdom','/wisdom/');await scroll(fr,false,1650);let saved=await pos(fr,false);fr=await reload(p,'/wisdom/');ok(tag+' root refresh restores exact scroll',Math.abs(await pos(fr,false)-saved)<=2,{saved,actual:await pos(fr,false)});
 // Update-notification Reload is the actual button, not a reload fixture.
 await p.evaluate(async m=>{if(m)await WosDevice.checkWeb(true);else await WizAppUpdates.check()},mobile);version='abc0002';await p.evaluate(async m=>{if(m)await WosDevice.checkWeb(true);else await WizAppUpdates.check()},mobile);
 await scroll(fr,false,2250);saved=await pos(fr,false);await p.locator(mobile?'[data-web="go"]':'#wizard-app-update button').click();fr=await waitFrame(p,'/wisdom/');await fr.waitForTimeout(1400);ok(tag+' update-banner Reload restores place',Math.abs(await pos(fr,false)-saved)<=2);version='abc0001';
  await close(p,mobile,'wisdom');fr=await open(p,mobile,'wisdom','/wisdom/?nested');await scroll(fr,true,1900);saved=await pos(fr,true);fr=await reload(p,'/wisdom/?nested');ok(tag+' internal reading panel restores',Math.abs(await pos(fr,true)-saved)<=2&&await fr.evaluate(()=>scrollY===0));
  await p.evaluate(()=>{WizAppReadingPosition.flush();const f=document.querySelector('iframe');f.style.display='none';f.contentWindow.location.reload()});await p.waitForTimeout(1700);await p.evaluate(()=>document.querySelector('iframe').style.display='');fr=await waitFrame(p,'/wisdom/?nested');await fr.waitForTimeout(1300);ok(tag+' parked app restores when shown',Math.abs(await pos(fr,true)-1900)<=2);
 await close(p,mobile,'wisdom');fr=await open(p,mobile,'wisdom','/wisdom/?late');await fr.waitForSelector('#p99');await scroll(fr,false,2100);saved=await pos(fr,false);fr=await reload(p,'/wisdom/?late');ok(tag+' delayed async text restores after loading',Math.abs(await pos(fr,false)-saved)<=2);
 // A real user gesture during the delayed load must cancel the saved-place jump.
 await fr.evaluate(()=>location.reload());fr=await waitFrame(p,'/wisdom/?late');await fr.locator('body').click({position:{x:5,y:5}});await fr.waitForSelector('#p99');await fr.waitForTimeout(1400);ok(tag+' user input cancels pending restore',await pos(fr,false)===0);
 await scroll(fr,false,1300);await fr.evaluate(()=>history.pushState({},'','/wisdom/?other'));await scroll(fr,false,450);await p.evaluate(()=>WizAppReadingPosition.flush());await fr.evaluate(()=>location.reload());fr=await waitFrame(p,'/wisdom/?other');await fr.waitForTimeout(1600);ok(tag+' SPA route has its own reading place',Math.abs(await pos(fr,false)-450)<=2,{actual:await pos(fr,false)});
 await close(p,mobile,'wisdom');await ctx.close();}
 if(process.env.QA_REAL){for(const mobile of [true,false]){const{p,ctx}=await boot(b,mobile);let fr=await open(p,mobile,'iching','/iching/history/83154b50-f7f9-47b3-9ba5-c7bbf8a33d3b');await fr.waitForFunction(()=>document.scrollingElement.scrollHeight>2500);await scroll(fr,false,1800);const saved=await pos(fr,false);fr=await reload(p,'/iching/history/83154b50-f7f9-47b3-9ba5-c7bbf8a33d3b');await fr.waitForTimeout(1800);ok((mobile?'phone':'desktop')+' actual I Ching saved reading reload',Math.abs(await pos(fr,false)-saved)<=2,{saved,actual:await pos(fr,false)});await ctx.close();}}
 ok('no agent/production writes',writes.length===0,writes);ok('no browser runtime errors',errors.length===0,errors);
}catch(e){failure=String(e);console.error(e)}finally{await b.close();server.close();fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify({hostname:os.hostname(),sha:process.env.QA_SHA,webTree:process.env.QA_TREE,checks,writes,errors,failure,scope:process.env.QA_REAL?'candidate shell with actual I Ching served through GET-only proxy + deterministic Wisdom fixture':'deterministic hosted readers; no production requests'},null,2));if(failure)process.exitCode=1;}
})();
