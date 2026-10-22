// Synthetic compact list/window acceptance. Run on Thales; no real API traffic.
const fs=require('fs'),path=require('path'),assert=require('assert');
const {chromium}=require('./tools/qa-playwright.cjs');
const TREE=process.env.QA_TREE||__dirname, OUT=process.env.QA_OUT||path.join(TREE,'qa-slim-out');fs.mkdirSync(OUT,{recursive:true});
let pass=0;const ok=(v,n)=>{assert(v,n);pass++;console.log('PASS',n)};
(async()=>{
 const {createListWindows}=await import(path.join(process.env.QA_SERVICE||path.join(TREE,'../service'),'server/session-list-window.mjs'));
 const {listPayload}=await import(path.join(process.env.QA_SERVICE||path.join(TREE,'../service'),'server/session-list-view.mjs'));
 const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try { for(const mobile of [true,false]){
  const tag=mobile?'phone':'desktop',now=Date.now()/1000,full='Original **unshortened** request '+ 'a long instruction '.repeat(100)+' beyond140needle FINAL-END';
  let rows=Array.from({length:140},(_,i)=>({id:`wizard_old_${i}`,title:`Archive ${i}`,source:'wizard-mobile',agent:{id:'hermes'},archived:i%2===0,last_active:now-20*86400-i,started_at:now-20*86400-i,message_count:4,wizard_request_preview:i===139?full:'old original',latest_message:{role:'assistant',content:'answer '.repeat(60),timestamp:now-20*86400-i}}));
  rows.push(...Array.from({length:120},(_,i)=>({id:`wizard_recent_${i}`,title:`Recent ${i}`,source:'wizard-mobile',agent:{id:'hermes'},last_active:now-i,started_at:now-i,message_count:4,preview:'recent answer',preview_role:'assistant',preview_timestamp:now-i})));
  rows.push({id:'wizard_failed',title:'Retry full input',agent:{id:'hermes'},source:'wizard-mobile',status:'failed',last_active:now,message_count:2,wizard_request_preview:full,model:'model-exact',provider:'provider-exact',wizard_model_lock_updated_at:125,last_user_message:{content:full,timestamp:now}});
  const privateRow={...rows[0],id:'wizard_synthetic_private',title:'Synthetic private-only match',agent:{id:'private'},wizard_request_preview:'private-only'};
  const pageWindow=createListWindows(),log=[];let reset=false,legacyDetail=false,detailOffline=false,privateDown=false,invalidDetail=false;
  const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
  await ctx.addInitScript(()=>{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.done','1');});
  await ctx.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());if(u.hostname!=='wizard.test')return route.abort();
   const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(!['GET','HEAD'].includes(req.method())){if(u.pathname==='/wizard/thread-seen')return reply({state:JSON.parse(req.postData()||'{}')});return reply({});}
   if(u.pathname==='/wizard/hermes/api/sessions'){
    const q=u.searchParams,agent=q.get('agent')||'hermes';log.push({path:u.pathname,agent,q:q.get('q'),offset:Number(q.get('offset')||0)});
    if(agent==='private' && privateDown){await new Promise(r=>setTimeout(r,300));return reply({error:'agent_unavailable'},503)}
    if(q.get('q')==='slowneedle')await new Promise(r=>setTimeout(r,900));
    if(Number(q.get('offset'))===100&&!reset&&!q.has('q')){reset=true;return reply({error:'conflict'},409)}
    try {const selected=await pageWindow({params:q,scope:agent,load:async()=>agent==='private'?[privateRow]:rows});return reply(listPayload(selected,q.get('q')))}catch(e){return reply({error:e.message},e.status||500)}
   }
   const m=u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/);
   if(m){const row=rows.find(s=>s.id===m[1])||privateRow;log.push({path:u.pathname,agent:u.searchParams.get('agent')||'hermes'});
     if(m[2])return reply({data:[{id:1,role:'user',content:['wizard_old_139','wizard_failed'].includes(row.id)?full:`Original ${row.title}`,timestamp:now-1},{id:2,role:'assistant',content:'Detailed answer',timestamp:now,finish_reason:'stop'}],has_more:false});
     if(detailOffline)return reply({error:'offline'},503);
     if(invalidDetail)return reply({});
     if(legacyDetail){if(u.searchParams.has('view'))return reply({error:'old-service'},404);return reply({...row,wizard_request_preview:full.slice(0,1000),last_user_message:{content:full.slice(0,1000)}})}
     return reply({...row,wizard_retry_input:full,wizard_title_renames:[{from:'Old name',to:row.title,at:now,by:'user'}]});}
   if(u.pathname==='/wizard/thread-seen')return reply({state:{initializedAt:1,threads:{}}});
   if(u.pathname==='/wizard/thread-dispositions')return reply({state:{}});
   if(u.pathname.startsWith('/wizard/'))return reply({});
   const rel=u.pathname.replace(/^\/wizard-os-home\//,'')||'index.html',f=path.join(TREE,'web',rel);
   if(fs.existsSync(f)&&fs.statSync(f).isFile())return route.fulfill({contentType:rel.endsWith('.html')?'text/html':rel.endsWith('.css')?'text/css':rel.endsWith('.svg')?'image/svg+xml':rel.endsWith('.png')?'image/png':rel.endsWith('.json')?'application/json':'application/javascript',body:fs.readFileSync(f)});
   return route.fulfill({status:200,contentType:'application/javascript',body:''});
  });
  const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(String(e)));
  await p.goto('https://wizard.test/wizard-os-home/'+(mobile?'':'desktop.html'));
  await p.waitForFunction(()=>WizLive.ok&&WizLive.sessions.length===171);
  ok(reset,tag+': expired snapshot restarts from page 1');
  ok(await p.evaluate(()=>WizLive.workGroups(WizLive.sessions).archive.length===50),tag+': exactly 50 actual Archive rows');
  ok(await p.evaluate(()=>WizLive.windows.hermes.archiveTotal===140),tag+': exact Archive total');
  ok(await p.evaluate(()=>WizLive.sessions.every(s=>s.preview.length<=140&&!s.request)),tag+': compact rows, no retry content');
  const before=log.length;await p.evaluate(()=>WizLive.refresh());ok(log.slice(before).filter(x=>x.path.endsWith('/sessions')).length===1,tag+': between-window poll only page 1');
  if(mobile){await p.evaluate(()=>__wos.openApp(WizCore.apps('mobile').APPS.find(a=>a.id==='wizard')));await p.waitForTimeout(800);}
  await p.waitForFunction(()=>Object.values((window.__wos||window.__wux).wins).some(w=>w.app==='chats'&&!w.agent));
  const wid=await p.evaluate(()=>Object.values((window.__wos||window.__wux).wins).find(w=>w.app==='chats'&&!w.agent).id);
  if(mobile) { await p.evaluate(id=>__wos.goDesk(__wos.desks.findIndex(d=>d.wins.includes(id))),wid); await p.waitForTimeout(400); }
  const pane=p.locator(mobile ? `[data-chats="${wid}"]` : `.win[data-win="${wid}"]`);
  await pane.locator('[data-sectoggle="archive"]').click();
  await pane.locator('[data-secmore="archive"]').click();
  ok(await pane.locator('[data-sec="archive"] .ch-row').count()===50,tag+': rendered Archive contains exactly 50 rows');
  ok((await pane.locator('[data-sec="archive"]').innerText()).includes('Newest 50 of 140'),tag+': rendered Archive explains total and older search');
  await pane.locator('[data-sectoggle="archive"]').scrollIntoViewIfNeeded();
  await p.screenshot({path:path.join(OUT,tag+'-slim-archive.png')});
  await pane.locator('[data-chsearch]').fill('beyond140needle');
  await pane.locator('[data-chopen="wizard_old_139"]').waitFor();
  await p.waitForFunction(()=>Object.values(WizCore.chatSearch.stats.runs).some(r=>r.q==='beyond140needle'&&!r.busy));
  ok(true,tag+': rendered search finds original text past 140 outside window');
  await pane.locator('[data-chopen="wizard_old_139"]').scrollIntoViewIfNeeded();
  await p.waitForFunction(()=>{const el=document.querySelector('[data-chopen="wizard_old_139"]');if(!el)return false;const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-chopen]')===el;});
  ok(true,tag+': off-window search result is actually visible, not behind Home');
  await p.screenshot({path:path.join(OUT,tag+'-slim-search.png')});
  await pane.locator('[data-chopen="wizard_old_139"]').click();
  await p.waitForFunction(()=>WizLive.session('wizard_old_139')?.request.endsWith('FINAL-END'));
  ok(await p.evaluate(()=>WizLive.session('wizard_old_139').renames.length===1),tag+': open hydrates full retry and rename detail');
  ok(await p.evaluate(()=>WizLive.sessions.length===171),tag+': opening off-window detail does not expand stored window');
  await p.evaluate(()=>WizLive.sessionInfo('wizard_old_138'));ok(await p.evaluate(()=>!!WizLive.session('wizard_old_138')),tag+': off-window direct detail resolves');
  // Exercise the real retry path with a captured synthetic outbox, not an API send.
  await p.evaluate(()=>{window.__retry=null;window.WosOutbox.enqueue=async x=>{window.__retry=x;return x};});
  // A minimal adapter uses the actual module, keeping its delivery route unchanged.
  const retry=await p.evaluate(async()=>{
    const power=WosChatPower({H:{win:()=>null},CH:{},ch:()=>({}),esc:String,clip:String,toast:()=>{},renderChats:()=>{}});
    window.__powerForQA=power;
    try {await power.retryThread('','wizard_failed');}catch(e){window.__retryError=String(e)}
    return window.__retry;
  });
  ok(retry&&retry.text===full,tag+': Retry enqueues every original character, not preview');
  ok(retry.model==='model-exact'&&retry.provider==='provider-exact',tag+': Retry preserves model/provider');
  legacyDetail=true;
  const legacyRetry=await p.evaluate(async()=>{window.__retry=null;await __powerForQA.retryThread('','wizard_failed');return window.__retry});
  ok(legacyRetry?.text===full,tag+': old-service fallback recovers full input, not its 1000-character preview');
  legacyDetail=false;detailOffline=true;
  const offlineRetry=await p.evaluate(async()=>{window.__retry=null;await __powerForQA.retryThread('','wizard_failed');return window.__retry});
  ok(!offlineRetry,tag+': failed detail read never falls back to a cached or short retry');
  detailOffline=false;invalidDetail=true;
  const invalidRetry=await p.evaluate(async()=>{window.__retry=null;await __powerForQA.retryThread('','wizard_failed');return window.__retry});
  ok(!invalidRetry,tag+': malformed successful detail cannot authorize cached retry input');
  invalidDetail=false;
  const scoped=await p.evaluate(()=>WizLive.searchSessions('private-only','private'));ok(scoped.length===1&&scoped[0].agent==='private',tag+': agent-scoped search isolates results');
  privateDown=true;
  const partial=await p.evaluate(async()=>{
    const previous=window.WosAgents;window.WosAgents={...previous,others:()=>[{id:'private'}],isOther:id=>!!id&&id!=='hermes'};
    const batches=[];try{const rows=await WizLive.searchSessions('beyond140needle','',undefined,rows=>batches.push(rows.map(s=>s.id)));return {partial:rows.partial,ids:rows.map(s=>s.id),batches};}finally{window.WosAgents=previous}
  });
  ok(partial.partial&&partial.ids.includes('wizard_old_139')&&partial.batches.some(ids=>ids.includes('wizard_old_139')),tag+': unavailable other agent does not discard or hold main-agent search hits');
  privateDown=false;
  await p.evaluate(()=>{window.__updates=[];WizCore.chatSearch.query('race','slowneedle',()=>__updates.push('slow'));});
  await p.waitForTimeout(350);await p.evaluate(()=>WizCore.chatSearch.query('race','beyond140needle',()=>__updates.push('fast')));await p.waitForTimeout(1100);
  ok(await p.evaluate(()=>!__updates.includes('slow')&&WizCore.chatSearch.stats.runs.race.q==='beyond140needle'),tag+': stale query cannot publish');
  rows=rows.filter(s=>s.id!=='wizard_old_0').map(s=>s.id==='wizard_old_138'?{...s,status:'failed',title:'Changed outside page 1'}:s);
  await p.evaluate(()=>{WizLive.fullAt=0;return WizLive.refresh(true)});
  ok(await p.evaluate(()=>!WizLive.sessions.some(s=>s.id==='wizard_old_0')&&WizLive.sessions.some(s=>s.id==='wizard_old_138'&&s.title==='Changed outside page 1')),tag+': periodic complete window catches deletion and old-row changes');
  ok(await p.evaluate(()=>!Object.entries(localStorage).some(([k,v])=>k.includes('chats.snapshot')&&v.includes('private-only'))),tag+': search/detail never persist private rows');
  ok(!errors.length,tag+': no page errors '+errors.join('|'));await ctx.close();
 }}finally{await browser.close()}
 console.log(`${pass} pass, 0 fail`);
})().catch(e=>{console.error(e);process.exit(1)});
