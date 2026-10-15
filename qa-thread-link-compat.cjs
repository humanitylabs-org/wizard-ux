// Read-only Thales browser regression. Local assets, real target transcript GETs; every write intercepted.
// QA_WEB_DIR=<tree> QA_OUT=<evidence> QA_PLAYWRIGHT=<module> node qa-thread-link-compat.cjs [origin]
const fs=require('fs'),path=require('path');
const {chromium}=require(process.env.QA_PLAYWRIGHT||'playwright');
const ROOT=process.env.QA_WEB_DIR||__dirname, OUT=process.env.QA_OUT||path.join(__dirname,'qa-thread-link-evidence');
const origin=process.argv[2]||'https://wizard.tailc0f369.ts.net';
const ids=JSON.parse(fs.readFileSync(path.join(__dirname,'tests/roundup-thread-ids.json')));
const source='qa_thread_link_roundup', realSource='wizard_1792060331687_4812ce96c5c5';
fs.mkdirSync(OUT,{recursive:true});
let pass=0,fail=0;
function ok(c,label,detail=''){console.log(c?'PASS':'FAIL',label,detail);c?pass++:fail++;}
(async()=>{
 const b=await chromium.launch({headless:true,...(process.env.QA_CHROME?{executablePath:process.env.QA_CHROME}:{})});
 try {for(const desktop of [false,true]){
  const mode=desktop?'desktop':'phone', writes=[], reads=[], errors=[];
  const ctx=await b.newContext({viewport:desktop?{width:1440,height:1000}:{width:412,height:892},hasTouch:!desktop,isMobile:!desktop,ignoreHTTPSErrors:true,serviceWorkers:'block'});
  await ctx.addInitScript(()=>{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.rvCoached','true');localStorage.setItem('wos.voiceTipSeen','true');});
  const fixture={id:source,title:'Thread link compatibility QA',source:'wizard-mobile',status:'completed',message_count:2,last_active:Date.now()/1000,wizard_last_assistant_at:Date.now()/1000};
  const markdown=ids.map((id,i)=>`- [Roundup ${i}](/?session=${id})`).join('\n')+`\n\n[Legacy](/wizard/?session=${ids[0]})\n\n[Canonical](/wizard-os-home/?session=${ids[0]})\n\n@session:default/${ids[0]}`;
  await ctx.route('**/*',async r=>{
   const q=r.request(),u=new URL(q.url()),m=q.method();
   const json=v=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(v)});
   if(!['GET','HEAD'].includes(m)){writes.push({method:m,path:u.pathname});return json({ok:true,state:{initializedAt:Date.now(),threads:{}}});}
   if(u.pathname.startsWith('/wizard-os-home/')){
    const rel=u.pathname.slice('/wizard-os-home/'.length)||'index.html';
    if(!['data.js','summaries.js'].includes(rel)){
     const file=path.resolve(ROOT,'web',rel);
     if(file.startsWith(path.resolve(ROOT,'web')+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return r.fulfill({status:200,contentType:rel.endsWith('.js')?'application/javascript':rel.endsWith('.css')?'text/css':rel.endsWith('.html')?'text/html':rel.endsWith('.svg')?'image/svg+xml':'application/octet-stream',body:fs.readFileSync(file)});
    }
   }
   // Mirror the old gateway's query-dropping root redirect: a regression must not pass against a friendly mock root.
   if(u.pathname==='/')return r.fulfill({status:302,headers:{location:'/apps/308'},body:''});
   if(u.pathname==='/apps/308')return r.fulfill({status:200,contentType:'text/html',body:'<h1>Obsolete Apps Manager (QA gateway fixture)</h1>'});
   if(u.pathname==='/__qa-thread-frame/')return r.fulfill({status:200,contentType:'text/html',body:`<a id="root" target="_top" href="/?session=${ids[0]}">Root thread</a><a id="canonical" target="_top" href="/wizard-os-home/?session=${ids[0]}">Canonical thread</a>`});
   if(u.pathname==='/wizard/hermes/api/sessions'){
    const res=await r.fetch();const data=await res.json();data.data=[fixture,...(data.data||[])];return json(data);
   }
   if(u.pathname===`/wizard/hermes/api/sessions/${source}`)return json({session:fixture});
   if(u.pathname===`/wizard/hermes/api/sessions/${source}/messages`)return json({object:'list',data:[{id:1,session_id:source,role:'user',content:'Read-only roundup regression',timestamp:Date.now()/1000-20},{id:2,session_id:source,role:'assistant',content:markdown,timestamp:Date.now()/1000-10}],pagination:{offset:0,limit:500,returned:2}});
   if(/\/sessions\/[^/]+\/messages$/.test(u.pathname))reads.push(u.pathname);
   return r.continue();
  });
  const p=await ctx.newPage();p.setDefaultTimeout(6000);p.on('pageerror',e=>errors.push(String(e)));
  const shell=origin+'/wizard-os-home/'+(desktop?'desktop.html':'');
  const thread=()=>p.evaluate(d=>{const api=d?window.__wux:window.__wos;return Object.values(api.wins).find(w=>w.app==='chats')?.thread},desktop);
  const open=async id=>{await p.evaluate(([d,id])=>(d?__wux.openThread(id):__wos.openWizardThread(id)),[desktop,id]);await wait(id);};
  const wait=async id=>{await p.waitForFunction(([d,id])=>{const api=d?window.__wux:window.__wos;const w=Object.values(api.wins).find(w=>w.app==='chats');return w?.thread===id&&!!document.querySelector('.ch-msgs .msg.a')},[desktop,id],{timeout:20000});};
  const back=async()=>{if(desktop)await p.keyboard.press('Escape');else await p.evaluate(()=>window.__wosNativeBack());await p.waitForTimeout(350);};
  const tap=async loc=>{await loc.scrollIntoViewIfNeeded();if(desktop)await loc.click();else await loc.tap();await p.waitForTimeout(450);};
  try{
   await p.goto(shell,{waitUntil:'domcontentloaded'});
   await p.waitForFunction(d=>!!(d?window.__wux:window.__wos),desktop,{timeout:30000});
   await open(source);
   const links=await p.locator('.ch-msgs a').evaluateAll(as=>as.filter(a=>a.textContent.startsWith('Roundup ')).map(a=>({href:a.getAttribute('href'),session:a.dataset.session})));
   ok(links.length===ids.length&&links.every((a,i)=>a.href==='/wizard-os-home/?session='+ids[i]&&a.session===ids[i]),mode+' all roundup anchors canonical/native',JSON.stringify(links));
   // Continue after baseline failure so the actual broken click has observable evidence.
   for(let i=0;i<ids.length;i++){
    await open(source);await tap(p.locator('.ch-msgs a').filter({hasText:new RegExp('^Roundup '+i+'$')}).last());
    const landed=await thread()===ids[i];ok(landed,mode+' roundup tap '+i);
    if(!landed){await p.screenshot({path:path.join(OUT,mode+'-broken-root.png')});await p.goto(shell);await p.waitForFunction(d=>!!(d?window.__wux:window.__wos),desktop);break;}
    await wait(ids[i]);await back();ok(await thread()===source&&p.url().startsWith(shell),mode+' target → Back → source '+i);
   }
   for(const label of ['Legacy','Canonical','@session:']){
    await open(source);await tap(p.locator('.ch-msgs a').filter({hasText:label}).last());await wait(ids[0]);await back();ok(await thread()===source,mode+' '+label+' click/Back');
   }
   // Actual source transcript, not the synthetic roundup above. Targets remain real GETs throughout.
   if(process.env.QA_REAL_SOURCE==='1') {
   await open(realSource);
   const actualLink=p.locator(`.ch-msgs a[href*="${ids[0]}"]`).last();
   if(await actualLink.count()){
    await tap(actualLink);const landed=await thread()===ids[0];ok(landed,mode+' real roundup source → target');
    if(landed){await wait(ids[0]);await back();ok(await thread()===realSource,mode+' real target → Back → real source');}
   }else ok(false,mode+' original roundup anchor present');
   await p.screenshot({path:path.join(OUT,mode+'-real-roundup.png')});
   }
   // Use the real frame guard with actual iframe clicks (the Manager PR path), no nested shell.
   for(const link of ['root','canonical']){
    await p.goto(shell);await p.waitForFunction(d=>!!(d?window.__wux:window.__wos),desktop);
    await p.evaluate(()=>{const f=document.createElement('iframe');f.id='compat-frame';f.src='/__qa-thread-frame/';f.style='position:fixed;z-index:99999;left:10px;top:120px;width:350px;height:120px;background:white';document.body.append(f);});
    await p.waitForFunction(()=>document.querySelector('#compat-frame')?.contentDocument?.querySelector('#root'));
    await p.evaluate(()=>{const f=document.querySelector('#compat-frame');WizLinks.guardFrame(f.contentWindow,'/__qa-thread-frame/',{open(){throw Error('Unexpected nested link sheet')},route(){return false}})});
    await tap(p.frameLocator('#compat-frame').locator('#'+link));
    ok(await thread()===ids[0]&&p.url().startsWith(shell),mode+' hosted '+link+' click stays shell');
    await p.evaluate(()=>document.querySelector('#compat-frame')?.remove());await back();
    ok(p.url().startsWith(shell)&&await p.evaluate(()=>!!(window.__wux||window.__wos)),mode+' hosted '+link+' Back stays shell');
   }
   ok(reads.some(x=>x.includes(ids[0])),mode+' real target transcript read');
   ok(!writes.some(x=>/\/v1\/runs|\/messages$/.test(x.path)),mode+' no send attempts');
   ok(!errors.length,mode+' no page errors',JSON.stringify(errors));
   await p.screenshot({path:path.join(OUT,mode+'-after-back.png')});
  }catch(e){ok(false,mode+' suite exception',String(e));await p.screenshot({path:path.join(OUT,mode+'-exception.png')}).catch(()=>{});}
  fs.writeFileSync(path.join(OUT,mode+'-requests.json'),JSON.stringify({writesIntercepted:writes,transcriptReads:reads,errors},null,2));
  await ctx.close();
 }}finally{await b.close();}
 fs.writeFileSync(path.join(OUT,'summary.json'),JSON.stringify({pass,fail,uniqueRoundupIds:ids.length,source:realSource,tree:ROOT},null,2));
 console.log(`thread-link-compat: ${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1});
