const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('fs'),crypto=require('crypto');
const base=process.env.QA_URL;
if(!base)throw Error('QA_URL must name an explicitly authorized fixture; no live default');
const out=process.env.QA_OUT,fixture=JSON.parse(fs.readFileSync(process.env.QA_APPS,'utf8')),hashes=JSON.parse(fs.readFileSync(process.env.QA_HASHES,'utf8'));
const apps=fixture.apps.filter(a=>a.url&&a.id!=='wizard');apps.push({id:'usuals',name:'Food'});
const ids=[...new Set(apps.map(a=>a.id))];if(ids.length!==apps.length)throw Error('duplicate app fixture');
const cases=[];function check(ok,name,detail){cases.push({name,pass:!!ok,detail});if(!ok)throw Error(name+': '+JSON.stringify(detail));}
fs.mkdirSync(out,{recursive:true});
(async()=>{const b=await chromium.launch({headless:true});try{
for(const mobile of [false,true]){
 const name=mobile?'phone':'desktop';const ctx=await b.newContext({ignoreHTTPSErrors:true,viewport:mobile?{width:412,height:892}:{width:1440,height:960},isMobile:mobile,hasTouch:mobile,...(mobile?{userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'}:{})});
 const p=await ctx.newPage(),errors=[],served={},writes=[];p.on('pageerror',e=>errors.push(String(e)));p.on('response',r=>{const file=new URL(r.url()).pathname.split('/wizard-os-home/')[1];if(hashes[file]&&r.ok())r.body().then(x=>served[file]=crypto.createHash('sha256').update(x).digest('hex')).catch(()=>{});});
 await ctx.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({status:403,contentType:'application/json',body:'{"error":"fixture QA refuses writes"}'});}if(u.pathname==='/wizard/hermes/api/sessions'){
  const response=await r.fetch(),data=await response.json(),now=new Date().toISOString();const rows=ids.map(id=>({id:'qa-app-confirm-'+id,title:'App confirmation '+id,status:'completed',wizard_app_id:id,wizard_attention:{state:'done',ask:'App action finished',subject:'Wizard Apps'},wizard_last_user_at:now,wizard_last_assistant_at:now,wizard_activity_at:now,latest_message:{role:'assistant',content:'App action finished',created_at:now},source:'fixture'}));
  rows.push({id:'qa-app-unknown',title:'Topics CineQueue app discussion',status:'completed',wizard_app_id:'not-installed',wizard_attention:{state:'done',ask:'Discussed apps'},wizard_last_user_at:now,wizard_last_assistant_at:now});
  data.data=rows;data.has_more=false;data.pagination={...(data.pagination||{}),has_more:false};return r.fulfill({response,json:data});}
 return r.continue();});
 try{
 await p.goto(base,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>{const h=window.__wos||window.__wux;return h?.live.ok&&h.live.session('qa-app-confirm-cinequeue')&&window.WizCore.threadApp('cinequeue')},{},{timeout:90000});
 await p.evaluate(()=>{const h=window.__wos||window.__wux,w=Object.values(h.wins).find(w=>w.app==='chats');h.chats.setQuery(window.__wux?{id:w.id+'::list',thread:null}:w,'App confirmation');});await p.waitForTimeout(1200);
 check(await p.getAttribute('html','data-shell')===(mobile?'phone':'desktop'),name+' correct shell');
 for(const id of ids){const r=await p.evaluate(id=>{const row=document.querySelector('[data-chopen="qa-app-confirm-'+id+'"]'),app=window.WizCore.threadApp(id),sigil=window.WizSigil.of(app),icon=row?.querySelector(':scope > .ch-app-icon');return {found:!!icon,id:icon?.dataset.threadApp,glyph:icon?.querySelector('.sgi')?.className,letter:icon?.querySelector('.sgl')?.textContent,letterSize:icon?.querySelector('.sgl')?parseFloat(getComputedStyle(icon.querySelector('.sgl')).fontSize):null,colour:icon?.style.getPropertyValue('--c'),expected:sigil,aria:icon?.getAttribute('aria-label'),title:row?.querySelector('.tp b')?.textContent,dest:row?.dataset.chopen};},id);
  check(r.found&&r.id===id&&r.dest==='qa-app-confirm-'+id&&r.colour===r.expected.color&&(r.expected.glyph?r.glyph?.includes('sg-'+r.expected.glyph):r.letter===r.expected.letter&&r.letterSize>0),name+' '+id+' matches installed launcher',r);
 }
 const wid=await p.evaluate(()=>document.querySelector('[data-chopen="qa-app-confirm-cinequeue"]').closest('[data-chats]').dataset.chats);
 for(const id of ['topics','cinequeue','shopping','calendar','wizard-music','mizel','wisdom','usuals','wizard-signal','wizard-search']){
 for(const [status,state,badge] of [['running',null,'working'],['failed',null,'failed'],['waiting_for_approval',null,'approval'],['completed','needs_you','needs'],['completed','check','check']]){
 const r=await p.evaluate(({id,status,state,wid})=>{const h=window.__wos||window.__wux,s=h.live.session('qa-app-confirm-'+id);s.status=status;s.attention=state?{state,ask:'Action required'}:null;h.chats.renderChats({id:wid,app:'chats',thread:null});const row=document.querySelector('[data-chopen="qa-app-confirm-'+id+'"]');return {identity:row?.querySelector('.ch-app-icon')?.dataset.threadApp,kind:row?.querySelector('.ch-app-state')?.className};},{id,status,state,wid});
 check(r.identity===id&&r.kind?.includes('sti '+badge),name+' '+id+' retains '+badge+' status badge',r);
 }
 }
 await p.evaluate(()=>{const h=window.__wos||window.__wux,w=Object.values(h.wins).find(w=>w.app==='chats');h.chats.setQuery(window.__wux?{id:w.id+'::list',thread:null}:w,'Topics CineQueue app discussion');});
 check(await p.locator('[data-chopen="qa-app-unknown"] .ch-app-icon').count()===0,name+' unknown IDs and title mentions do not brand');
 await p.evaluate(()=>{const h=window.__wos||window.__wux;for(const s of h.live.sessions.filter(x=>x.id.startsWith('qa-app-confirm-'))){s.status='completed';s.attention={state:'done',ask:'App action finished',subject:'Wizard Apps'};}const w=Object.values(h.wins).find(w=>w.app==='chats');h.chats.setQuery(window.__wux?{id:w.id+'::list',thread:null}:w,'App confirmation');});
 await p.screenshot({path:out+'/'+name+'.png'});
 check(Object.keys(hashes).every(f=>served[f]===hashes[f]),name+' exact served candidate assets',served);
 check(errors.length===0,name+' zero JS errors',errors);check(writes.every(x=>x.includes('/thread-seen')),name+' no app mutations',writes);
 }finally{await ctx.unrouteAll({behavior:"wait"});await ctx.close();}
}
}finally{await b.close();fs.writeFileSync(out+'/result.json',JSON.stringify({host:require('os').hostname(),url:base,apps:ids,appCount:ids.length,cases,passed:cases.filter(x=>x.pass).length,failed:cases.filter(x=>!x.pass).length},null,2));}})().catch(e=>{console.error(e);process.exitCode=1;});
