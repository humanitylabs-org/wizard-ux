// Isolated exact-tree Mac integration regression. Synthetic state; all egress intercepted.
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const ROOT=process.env.QA_WEB_DIR||__dirname,OUT=process.env.QA_OUT;
const origin='http://127.0.0.1:9737', results=[];
const apps=[{id:'fixture-letter',name:'Fixture Letter',icon:'',url:'/fixture-app/',colors:['#a978ee','#6543aa']},{id:'fixture-calendar',name:'Fixture Calendar',icon:'calendar',url:'/fixture-calendar/'}];
function check(c,name,detail){results.push({name,passed:!!c,detail});assert(c,name+': '+JSON.stringify(detail));}
(async()=>{const engine=process.env.QA_ENGINE==='webkit'?webkit:chromium;const browser=await engine.launch({headless:true,...(process.env.QA_ENGINE==='webkit'?{}:{executablePath:process.env.CHROMIUM})});
try {for(const mobile of [false,true]){
 const ctx=await browser.newContext({viewport:mobile?{width:412,height:892}:{width:1440,height:960},hasTouch:mobile,isMobile:mobile});
 const errors=[],writes=[],foreign=[];
 await ctx.addInitScript(apps=>{localStorage.setItem('wos.coached','true');localStorage.setItem('wux.apps.v1',JSON.stringify(apps));},apps);
 await ctx.route('**/*',r=>{const q=r.request(),u=new URL(q.url()),json=(o,s=200)=>r.fulfill({status:s,json:o});
  if(u.origin!==origin){foreign.push(u.href);return r.abort();}
  if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return json({state:{}},200);}
  if(u.pathname==='/wizard/hermes/api/model/options')return json({model:'fixture-model',provider:'fixture',providers:[{slug:'fixture',authenticated:true,is_current:true,models:['fixture-model']}]});
  if(u.pathname==='/wizard/hermes/api/sessions')return json({data:[...apps.map(a=>({id:'thread-'+a.id,title:'Synthetic app confirmation',status:'completed',wizard_app_id:a.id,message_count:2,updated_at:new Date().toISOString()})),{id:'thread-unknown',title:'Fixture Letter is only mentioned',status:'completed',wizard_app_id:'uninstalled',updated_at:new Date().toISOString()}],has_more:false});
  if(u.pathname.endsWith('/messages'))return json({data:[]});
  if(u.pathname.includes('thread-seen'))return json({state:{initializedAt:Date.now(),threads:{}}});
  if(u.pathname.includes('thread-dispositions'))return json({state:{}});
  if(u.pathname.endsWith('/api/apps')||u.pathname==='/wizard/apps')return json({apps});
  if(u.pathname.startsWith('/wizard-os-home/')&&!u.pathname.includes('/api/')){
   const rel=u.pathname.slice('/wizard-os-home/'.length)||'index.html';const p=path.join(ROOT,'web',rel);
   if(!fs.existsSync(p))return r.fulfill({status:404,body:''});
   const contentType=rel.endsWith('.html')?'text/html':rel.endsWith('.css')?'text/css':rel.endsWith('.svg')?'image/svg+xml':rel.endsWith('.png')?'image/png':rel.endsWith('.json')?'application/json':rel.endsWith('.webmanifest')?'application/manifest+json':'application/javascript';return r.fulfill({contentType,body:fs.readFileSync(p)});
  }
  return json({});
 });
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(origin+'/wizard-os-home/'+(mobile?'index.html':'desktop.html')+'?open=chats');
 await p.waitForFunction(()=>{const h=window.__wos||window.__wux;return h?.live.ok&&h.live.session('thread-fixture-letter')&&window.WizCore.threadApp('fixture-letter');},null,{timeout:15000});
 const label=mobile?'phone':'desktop';
 await p.evaluate(()=>{window.WosTour?.finish('qa');const h=window.__wos||window.__wux,w=Object.values(h.wins).find(w=>w.app==='chats');h.chats.setQuery(window.__wux?{id:w.id+'::list',thread:null}:w,'Synthetic app confirmation');});
 await p.waitForTimeout(400);
 for(const app of apps){const r=await p.evaluate(id=>{const row=document.querySelector('[data-chopen="thread-'+id+'"]'),icon=row?.querySelector('.ch-app-icon'),letter=icon?.querySelector('.sgl');return {id:icon?.dataset.threadApp,font:letter?parseFloat(getComputedStyle(letter).fontSize):null,letter:letter?.textContent,dest:row?.dataset.chopen};},app.id);check(r.id===app.id&&r.dest==='thread-'+app.id,label+' provenance '+app.id,r);if(!app.icon)check(r.font>0,label+' letter sigil visible',r);}
 check(await p.evaluate(()=>WizCore.threadApp('uninstalled')===null),label+' unknown app rejected');
 check(await p.evaluate(()=>typeof WizCore.apps.confirmManagedFrame==='function'),label+' managed app isolation retained');
 check(await p.evaluate(()=>typeof WosOutbox.stage==='function'&&typeof WosOutbox.protect==='function'),label+' custody API wired');
 check(await p.evaluate(()=>Object.keys(localStorage).every(k=>!k.includes('canonical-style'))),label+' no canonical-style activation');
 const row=p.locator('[data-chopen="thread-fixture-letter"]').first();await row.click();await p.waitForTimeout(200);
 check(await p.evaluate(()=>{const h=window.__wos||window.__wux;return Object.values(h.wins).some(w=>w.thread==='thread-fixture-letter');}),label+' nested chat opens');
 check(!writes.some(x=>x.includes('/v1/runs')||x.includes('/continue')),label+' opening chat does not run agent',writes);
 check(errors.length===0,label+' zero runtime errors',errors);check(foreign.length===0,label+' no external requests',foreign);
 if(OUT){fs.mkdirSync(OUT,{recursive:true});await p.screenshot({path:path.join(OUT,label+'.png')});}
 await ctx.unrouteAll({behavior:'wait'});await ctx.close();
 }}finally{await browser.close();if(OUT){fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({engine:process.env.QA_ENGINE||'chromium',results,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length},null,2));}}
 console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1;});
