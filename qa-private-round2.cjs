// Thales-only: real candidate Agent Service, disposable histories, two devices. No owner content.
const fs=require('fs'),path=require('path'),assert=require('assert');
const {chromium}=require('./tools/qa-playwright.cjs');
const BASE=process.argv[2]||'http://127.0.0.1:9743/wizard-os-home/',OUT=process.env.QA_OUT||path.join(__dirname,'qa-round2-out');fs.mkdirSync(OUT,{recursive:true});
const SID='wizard_round2_private',KEY='agent/private/direct:'+SID;let pass=0;
const ok=(v,n)=>{assert(v,n);pass++;console.log('PASS',n)};
async function openChats(p,mobile,agent=''){
 await p.evaluate(({mobile,agent})=>{const H=mobile?__wos:__wux;if(agent){window.WizOpenAgentChats(agent);return;}if(mobile)H.openApp(WizCore.apps('mobile').APPS.find(a=>a.id==='wizard'));}, {mobile,agent});
 await p.waitForFunction(agent=>Object.values((window.__wos||window.__wux).wins).some(w=>w.app==='chats'&&(w.agent||'')===agent),agent);
 const wid=await p.evaluate(agent=>Object.values((window.__wos||window.__wux).wins).find(w=>w.app==='chats'&&(w.agent||'')===agent).id,agent);
 if(mobile){await p.evaluate(id=>__wos.goDesk(__wos.desks.findIndex(d=>d.wins.includes(id))),wid);await p.waitForTimeout(400)}
 return {wid,pane:p.locator(mobile?`[data-chats="${wid}"]`:`.win[data-win="${wid}"]`)}
}
(async()=>{const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const pages=[];
 for(const mobile of [true,false]){
  const tag=mobile?'phone':'desktop',ctx=await b.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
  await ctx.addInitScript(()=>{try{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.done','1');}catch{}});
  const p=await ctx.newPage();pages.push({p,ctx,mobile});
  p.on('pageerror',e=>console.log('PAGEERROR',String(e)));
  await p.goto(BASE+(mobile?'':'desktop.html'));
  try { await p.waitForFunction(()=>WizLive.ok&&WizLive.agentSessions.private?.length); }
  catch(e){console.log('DIAGNOSTIC',await p.evaluate(()=>({live:window.WizLive&&{ok:WizLive.ok,error:WizLive.error,agentStatus:WizLive.agentStatus,sessions:WizLive.sessions},agents:window.WosAgents&&{list:WosAgents.list,error:WosAgents.error}})));await p.screenshot({path:path.join(OUT,tag+'-failure.png')});throw e;}

  const results=await p.evaluate(()=>WizLive.searchSessions('cobaltwatermelon'));
  ok(results.length===1&&results[0].agent==='private'&&results[0].id===SID,tag+': actual service FTS finds old private message, not title/preview');
  const scoped=await p.evaluate(()=>WizLive.searchSessions('cobaltwatermelon','private'));
  ok(scoped.length===1&&scoped[0].id===SID,tag+': Private workspace content search is scoped');
  let {wid,pane}=await openChats(p,mobile);
  await pane.locator('[data-chsearch]').fill('cobaltwatermelon');await pane.locator(`[data-chopen="${SID}"]`).first().waitFor();
  ok(await pane.locator(`[data-chopen="${SID}"] .ag-lock`).count()>0,tag+': search result carries a lock');
  await p.screenshot({path:path.join(OUT,tag+'-private-content-search.png')});
  await pane.locator(`[data-chopen="${SID}"]`).first().click();await pane.locator('.ch-thread').waitFor();await pane.getByText('A forgotten cobaltwatermelon secret',{exact:false}).waitFor();
  ok((await pane.innerText()).includes('forgotten cobaltwatermelon'),tag+': matched private conversation opens');
  await p.evaluate(()=>window.__r2Document=document);
  if(mobile)await p.evaluate(()=>__wosNativeBack());else {await p.evaluate(()=>history.back());await p.waitForTimeout(500);}
  await pane.locator(`[data-chopen="${SID}"]`).first().waitFor();
  ok(await p.evaluate(()=>document===__r2Document)&&await pane.locator('[data-chsearch]').inputValue()==='cobaltwatermelon',tag+': Back from result keeps app and results alive');
  const privateView=await openChats(p,mobile,'private');
  await privateView.pane.locator('[data-chsearch]').fill('cobaltwatermelon');await privateView.pane.locator(`[data-chopen="${SID}"]`).first().waitFor();
  ok(true,tag+': separate Private workspace still searches');
 }
 const [phone,desktop]=pages.map(x=>x.p);
 // Make a new, unread activity revision in both devices, then open/read only on phone.
 for(const p of [phone,desktop])await p.evaluate(id=>{const s=WizLive.session(id);s.messageCount=8;s.lastAssistantAt=new Date(Date.now()+1000).toISOString();WizLive.emit();},SID);
 ok(await desktop.evaluate(id=>WizLive.isNew(WizLive.session(id)),SID),'desktop starts with unseen private activity');
 await phone.evaluate(id=>WizLive.markSeen([id]),SID);
 await phone.waitForFunction(async key=>{const r=await fetch('/wizard/thread-seen');return !!(await r.json()).state?.threads?.[key]},KEY);
 const receipt=await phone.evaluate(async key=>(await(await fetch('/wizard/thread-seen')).json()).state.threads[key],KEY);
 ok(receipt.agent_id==='private'&&receipt.session_id===SID&&!('content' in receipt),'server persists only qualified private receipt metadata');
 await desktop.evaluate(async()=>{await WizLive.refresh(true)});
 ok(await desktop.evaluate(({id,at})=>!WizLive.isNew(WizLive.session(id))&&WizLive.seenRecord(WizLive.session(id))?.seenAt===at,{id:SID,at:receipt.seenAt}),'second independent browser context becomes read from exact server receipt');
 const d=pages[1];await d.p.goto(BASE+'agents/');await d.p.locator('[data-open="private"]').click();
 const toggle=d.p.getByRole('switch',{name:'Read standard chats'});await toggle.waitFor();
 ok(await toggle.isEnabled()&&await toggle.getAttribute('aria-checked')==='true','Agents app exposes enabled read-only standard-chat permission');
 await toggle.click();await d.p.waitForFunction(()=>WosAgents.get('private')?.permissions.read_standard_chats===false);
 ok(await d.p.getByRole('switch',{name:'Read standard chats'}).getAttribute('aria-checked')==='false','owner toggle persists revocation');
 await d.p.getByRole('switch',{name:'Read standard chats'}).click();await d.p.waitForFunction(()=>WosAgents.get('private')?.permissions.read_standard_chats===true);
 // Hosted appearance: keep Agents open while shell changes skins.
 for(const {p,mobile} of pages){
  await p.goto(BASE+(mobile?'':'desktop.html'));await p.waitForFunction(()=>WosAgents.ready);
  await p.evaluate(mobile=>{const H=mobile?__wos:__wux;H.openApp(WizCore.apps(mobile?'mobile':'desktop').APPS.find(a=>a.id==='agents'));},mobile);
  await p.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.contentDocument?.querySelector('[data-open="private"]')));
  const frame=p.frames().find(f=>/\/agents\//.test(f.url()));await frame.locator('[data-open="private"]').click();
  for(const skin of ['nebula','grove']){
   await p.evaluate(s=>WosSkin.set(s),skin);await p.waitForTimeout(800);
   const appearance=await frame.evaluate(()=>({skin:document.documentElement.dataset.skin,bg:getComputedStyle(document.body).backgroundColor}));
   ok(appearance.skin===skin&&appearance.bg!=='rgb(255, 255, 255)',(mobile?'phone':'desktop')+': hosted Agents follows '+skin);
   await p.screenshot({path:path.join(OUT,(mobile?'phone':'desktop')+'-agents-'+skin+'.png')});
  }
 }
 console.log(`${pass} pass, 0 fail`);
}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
