// Deterministic Chats Focus acceptance. Based on qa-ready-status.cjs boot/write fence.
// All Wizard reads are fixtures; every write is intercepted; navigation must create zero runs.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const origin = process.argv[2] || 'http://127.0.0.1:9381/wizard-os-home/';
const OUT = process.env.QA_OUT || require('./tools/qa-paths.cjs').workPath('chats-focus');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (v, n, detail = '') => { console.log(v ? 'PASS' : 'FAIL', n, v ? '' : JSON.stringify(detail)); v ? pass++ : fail++; };
const agents = [{ id:'hermes', label:'Main', is_default:true }, { id:'philosopher', label:'Philosopher' }, { id:'idle', label:'Idle' }, { id:'private', label:'Private', privacy:'private' }].map(a => ({ harness:'hermes', privacy:'standard', status:'running', model:{provider:'fixture',model:'fixture-model',allowed_models:['fixture-model']}, appearance:{hue:220}, ...a }));
const now = Date.now()/1000;
const rows = [
 ['main_phil','Main philosophy','Philosophy','', 'check'],
 ['main_wos','Main Wizard','Wizard OS','', 'needs_you'],
 ['main_plain','No subject','','', 'fyi'],
 ['phil_one','Philosopher question','Philosophy','philosopher','needs_you'],
 ['phil_two','Philosopher answer','Philosophy','philosopher','check'],
 ['private_one','Sealed thread','Wizard OS','private','check']
].map(([id,title,subject,agent,state],i) => ({id,title,source:'wizard-mobile',status:'completed',message_count:2,hidden:false,last_active:now-i,started_at:now-500,wizard_last_user_at:now-100,wizard_last_assistant_at:now-i,wizard_activity_at:now-i,wizard_attention:{state,subject,ask:'Fixture ask'},...(agent?{agent}:{}), latest_message:{role:'assistant',content:'Fixture reply',timestamp:now-i}}));
const writes = [], errors = [], failedAgents = new Set();
async function route(r) {
 const q=r.request(), u=new URL(q.url()), m=q.method();
 const json=(body,status=200)=>r.fulfill({status,json:body});
 if (!['GET','HEAD'].includes(m)) { writes.push({path:u.pathname,body:q.postData()}); return json(u.pathname==='/wizard/thread-seen'?{state:JSON.parse(q.postData()||'{}').state}:{ok:true}); }
 if (!u.pathname.startsWith('/wizard/')) return r.continue();
 if (u.pathname==='/wizard/v1/agents') return json({agents});
 if (u.pathname==='/wizard/v1/ui-preferences') return json({archiveAfterDays:7,compact:false,readyOrder:'newest',pinnedChats:[]});
 if (u.pathname==='/wizard/thread-seen') return json({state:{initializedAt:1,threads:{}}});
 if (u.pathname==='/wizard/hermes/api/sessions' && failedAgents.has(u.searchParams.get('agent'))) return json({error:'fixture agent unavailable'},503);
 if (u.pathname==='/wizard/hermes/api/sessions') return json({data:rows.filter(s=>(s.agent||'')===(u.searchParams.get('agent')||'')),has_more:false,archive_returned:0,archive_total:0});
 const sm=u.pathname.match(/\/sessions\/([^/]+)(\/messages)?$/);
 if (sm) { const s=rows.find(x=>x.id===sm[1]); return json(sm[2]?{data:[{id:1,role:'user',content:'Fixture question',timestamp:now-50},{id:2,role:'assistant',content:'Fixture answer',timestamp:now} ],has_more:false}:{session:s}); }
 if (u.pathname==='/wizard/v1/apps') return json({apps:[]});
 return json({});
}
async function boot(b,desktop=false,legacy='') {
 const ctx=await b.newContext({viewport:desktop?{width:1440,height:1000}:{width:412,height:892},hasTouch:!desktop,isMobile:!desktop,deviceScaleFactor:1,serviceWorkers:'block'});
 await ctx.route('**/*',route);
 await ctx.addInitScript(({desktop,legacy})=>{
  localStorage.setItem('wos.coached','true');localStorage.setItem('wos.voiceTipSeen','true');localStorage.setItem('wos.shell',desktop?'desktop':'phone');
  if (!sessionStorage.getItem('focusBoot')) {
   sessionStorage.setItem('focusBoot','1');localStorage.setItem('wos.skin','obsidian');
   const wins={wmain:{id:'wmain',app:'chats',thread:null}}, ds=[{id:'home',home:true,wins:[],focus:null},{id:'dmain',wins:['wmain'],focus:'wmain'}];
   if (legacy) { wins.wlegacy={id:'wlegacy',app:'chats',agent:'philosopher',thread:null};ds.push({id:'dlegacy',wins:['wlegacy'],focus:'wlegacy'}); if(legacy==='only'){delete wins.wmain;ds.splice(1,1);} }
   if(desktop){localStorage.setItem('wux.desk.wins',JSON.stringify(wins));localStorage.setItem('wux.desk.ws',JSON.stringify(ds.slice(1)));localStorage.setItem('wux.desk.cur','0');localStorage.setItem('wux.desk.homeOpen','false');}
   else {localStorage.setItem('wos.wins4',JSON.stringify(wins));localStorage.setItem('wos.strip',JSON.stringify(ds));localStorage.setItem('wos.idx4','1');localStorage.setItem('wos.idxDesk',JSON.stringify(ds[1].id));}
  }
 },{desktop,legacy});
 const p=await ctx.newPage();p.setDefaultTimeout(4000);p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(desktop?new URL('desktop.html',origin).href:origin,{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>!!(window.__wos||window.__wux)?.live?.agentStatus.philosopher?.ok);
 await p.evaluate(()=>{if(window.__wos){const a=__wos,w=Object.values(a.wins).find(w=>w.app==='chats');a.goDesk(a.desks.findIndex(d=>d.wins.includes(w.id)));a.focusWin(w.id);}else{const a=__wux,w=Object.values(a.wins).find(w=>w.app==='chats');a.focusWin(w.id);}});
 await p.waitForTimeout(600);return {ctx,p};
}
const snap=p=>p.evaluate(()=>{const a=window.__wos||window.__wux;return {desks:(a.desks||a.ws).length,wins:Object.keys(a.wins).length};});
const ids=p=>p.locator('.ch-list:visible [data-chopen]').evaluateAll(es=>es.map(e=>e.dataset.chopen).sort());
async function activate(p,s){const l=p.locator(s);await l[await p.evaluate(()=>navigator.maxTouchPoints>0)?'tap':'click']();}
async function choose(p,v){await activate(p,`.ch-focus-strip:visible [data-chfocusopt="${v}"]`);}
const activeFocus = p => p.locator('.ch-focus-strip:visible [aria-pressed="true"]').innerText();
async function capture(p,name){await p.waitForTimeout(450);await p.screenshot({path:path.join(OUT,name+'.png'),animations:'disabled'});}
(async()=>{
 const b=await chromium.launch({executablePath:process.env.QA_CHROME||undefined});
 try {
 for(const desktop of [false,true]){
  const {ctx,p}=await boot(b,desktop), mode=desktop?'desktop':'phone', before=await snap(p);
  const present=await p.locator('.ch-focus-strip:visible').count();ok(present===1,mode+' Focus strip exists');
  if(!present){await capture(p,mode+'-missing');await ctx.close();continue;}
  ok((await activeFocus(p))==='All',mode+' defaults to All');
  ok((await ids(p)).length===6,mode+' All includes every agent and subjectless threads');
  ok(await p.locator('[data-chfocus], .ch-focus, [aria-label="Focus chats"]').count()===0,mode+' pill and standalone Focus sheet absent');
  const box=await p.locator('.ch-focus-strip:visible [data-chfocusopt="all:"]').boundingBox();ok(box.height>=44&&box.width>=44,mode+' tab thumb target >=44px',box);
  const opts=p.locator('.ch-focus-strip:visible [data-chfocusopt]');
  ok(await opts.count()===6,mode+' strip All, three populated agents and two subjects');
  ok(await opts.first().getAttribute('data-chfocusopt')==='all:',mode+' All first');
  ok(JSON.stringify(await opts.evaluateAll(es=>es.map(e=>e.dataset.chfocusopt)))===JSON.stringify(['all:','agent:hermes','subject:Philosophy','subject:Wizard OS','agent:philosopher','agent:private']),mode+' busiest first: unread then most recent activity',await opts.evaluateAll(es=>es.map(e=>({key:e.dataset.chfocusopt,label:e.getAttribute('aria-label')}))));
  ok(await p.locator('.ch-focus-strip [data-chfocusopt="agent:idle"]').count()===0,mode+' empty agent omitted from strip');
  ok(await p.locator('.ch-focus-strip [data-chfocusopt="agent:private"] .ag-lock').count()>0,mode+' private lock visible');
  ok(await p.locator('.ch-focus-strip:visible').evaluate(e=>e.scrollWidth>e.clientWidth&&getComputedStyle(e).touchAction==='pan-x'&&new Set([...e.children].map(c=>c.offsetTop)).size===1),mode+' single row scrolls horizontally');
  ok(await p.locator('.ch-focus-strip [data-chfocusopt="agent:philosopher"] .ch-focus-dot').count()>0,mode+' unread tab dot');
  ok(await p.locator('.ch-focus-strip:visible').evaluate(e=>{const sc=e.parentElement.querySelector('.ch-scroll');return sc.getBoundingClientRect().bottom<=e.getBoundingClientRect().top+1&&parseFloat(getComputedStyle(sc).paddingBottom)>0;}),mode+' list reserves footer height and bottom padding');
  if(!desktop){
   await p.waitForFunction(()=>{const e=document.querySelector('.ch-focus-strip'),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.right-25,r.top+r.height/2));});
   const geometry=await p.evaluate(()=>{const s=document.querySelector('.ch-focus-strip').getBoundingClientRect(),d=document.querySelector('#dock').getBoundingClientRect();return {bottom:s.bottom,dockTop:d.top};});
   ok(geometry.bottom<=geometry.dockTop,mode+' strip clears dock',geometry);
   const session=await p.context().newCDPSession(p), r=await p.locator('.ch-focus-strip:visible').boundingBox(), desk=await p.evaluate(()=>__wos.idx);
   await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width-25,y:r.y+r.height/2}]});
   for(let i=1;i<=8;i++){await p.waitForTimeout(30);await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r.x+r.width-25-i*30,y:r.y+r.height/2}]});}
   await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(250);
   ok(await p.evaluate(()=>__wos.idx)===desk,mode+' strip horizontal swipe never changes desk');
   const scroll=await p.locator('.ch-focus-strip:visible').evaluate(e=>({left:e.scrollLeft,width:e.scrollWidth,client:e.clientWidth,hit:document.elementFromPoint(e.getBoundingClientRect().right-25,e.getBoundingClientRect().top+26)?.outerHTML}));
   ok(scroll.left>0,mode+' real touch swipe scrolls strip',scroll);
   await session.detach();
   const scrolled=await p.locator('.ch-focus-strip').evaluate(e=>e.scrollLeft);
   const oldTitle=rows[0].title;rows[0].title+=' updated';await p.evaluate(async()=>{await __wos.live.refresh();__wos.live.emit();});await p.waitForTimeout(150);
   ok(await p.locator('.ch-focus-strip').evaluate(e=>e.scrollLeft)>=scrolled-1,mode+' live morph preserves manual tab scroll');rows[0].title=oldTitle;
  }
  await p.locator('.ch-focus-strip:visible').evaluate(e=>e.scrollLeft=0);
  await capture(p,desktop?'desktop-dark':'phone-dark-list');
  await choose(p,'agent:philosopher');
  ok(JSON.stringify(await ids(p))===JSON.stringify(['phil_one','phil_two']),mode+' Philosopher only');
  ok((await activeFocus(p)).includes('Philosopher'),mode+' active tab updates');
  ok(await p.locator('.ch-focus-strip:visible .on').evaluate(e=>{const a=e.getBoundingClientRect(),r=e.parentElement.getBoundingClientRect();return a.left>=r.left&&a.right<=r.right;}),mode+' active tab auto-scrolls fully into view');
  ok(JSON.stringify(await snap(p))===JSON.stringify(before),mode+' focus creates no window or desk');
  await capture(p,desktop?'desktop-philosopher':'phone-dark-philosopher');
  await p.locator('[data-chsearch]:visible').fill('answer');await p.waitForTimeout(220);
  ok(JSON.stringify(await ids(p))===JSON.stringify(['phil_two']),mode+' search AND Focus');
  await p.locator('[data-chsclear]:visible').click();
  await p.locator('[data-chsearch]:visible').blur();
  failedAgents.add('philosopher');
  await p.evaluate(async()=>{const a=window.__wos||window.__wux;await a.live.refreshAgents(undefined,'philosopher');a.live.emit();});
  await p.locator('.ch-list:visible .ch-sync.off').waitFor({timeout:4000});
  ok(await p.locator('.ch-list:visible .ch-sync.off').count()===1,mode+' focused agent errors use existing scoped status');
  failedAgents.clear();
  await p.evaluate(async()=>{const a=window.__wos||window.__wux;await a.live.refreshAgents(undefined,'philosopher');a.live.emit();});
  await choose(p,'subject:Philosophy');
  ok(JSON.stringify(await ids(p))===JSON.stringify(['main_phil','phil_one','phil_two']),mode+' subject spans main and philosopher');
  await p.locator('[data-chfbtn]:visible').click();
  ok(await p.locator('.ch-fcard h5').evaluateAll(es=>es.some(e=>e.textContent==='Focus')),mode+' Filter sheet has Focus section');
  ok(await p.locator('.ch-fcard [data-chfocusopt]').count()===7,mode+' Filter offers every focus option');
  ok(await p.locator('.ch-fcard [data-chfocusopt="agent:idle"]').count()===1,mode+' Filter keeps empty agent reachable');
  await activate(p,'.ch-fcard [data-chfocusopt="agent:private"]');
  ok(JSON.stringify(await ids(p))===JSON.stringify(['private_one']),mode+' Filter Focus selection sets scope');
  await choose(p,'subject:Philosophy');await p.locator('[data-chfbtn]:visible').click();
  ok(await p.locator('[data-chfopt^="subject:"]').count()===0,mode+' status sheet no longer has Subject');
  await p.locator('[data-chfopt="status:needs"]:visible').click();
  ok(JSON.stringify(await ids(p))===JSON.stringify(['phil_one']),mode+' status AND Focus');
  ok(await p.locator('.ch-search:visible').evaluate(e=>e.scrollWidth<=e.clientWidth+1),mode+' Focus plus status fit search field');
  await capture(p,mode+'-focus-status');
  await p.locator('[data-chchipx="status"]:visible').click();
  await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>!!(window.__wos||window.__wux)?.live?.agentStatus.philosopher?.ok);
  ok((await p.locator('.ch-focus-strip:visible [aria-pressed="true"]').innerText()).includes('Philosophy'),mode+' focus survives reload');
  await p.locator('[data-chopen="phil_one"]:visible').click();await p.waitForTimeout(250);
  ok(await p.locator('.ch-thread .ch-focus-strip').count()===0&&(desktop||await p.locator('.ch-focus-strip:visible').count()===0),mode+' thread view has no strip');
  if(desktop) ok(await p.locator('.pane-list .ch-focus-strip:visible').count()===1,mode+' desktop strip stays in list pane only');
  await p.evaluate(()=>{const a=window.__wos||window.__wux;if(window.__wos){a.onBack();a.onBack();}else{a.escStep();a.escStep();}});
  ok(await p.locator('.ch-focus-strip:visible').count()===1&&(await p.locator('.ch-focus-strip:visible [aria-pressed="true"]').innerText()).includes('Philosophy'),mode+' Back twice keeps app and Focus');
  await p.evaluate(()=>WizOpenAgentChats('philosopher'));await p.waitForTimeout(150);
  ok(JSON.stringify(await snap(p))===JSON.stringify(before)&&(await p.locator('.ch-focus-strip:visible [aria-pressed="true"]').innerText()).includes('Philosopher'),mode+' openAgentChats reuses main window');
  await p.evaluate(()=>WizOpenAgentChats('private',{thread:'__new__'}));
  ok(await p.evaluate(()=>{const a=window.__wos||window.__wux,w=Object.values(a.wins).find(w=>w.app==='chats');return w.thread==='__new__'&&a.chats.winAgent(w)==='private'&&a.chats.modelRoute(w.id,'__new__').agent==='private';}),mode+' private new draft retains sealed route');
  await p.evaluate(()=>{const a=window.__wos||window.__wux;if(window.__wos)a.onBack();else a.escStep();});
  await p.evaluate(()=>{const a=window.__wos||window.__wux,w=Object.values(a.wins).find(w=>w.app==='chats');a.chats.openContextDraft(w.id,'qa-focus:item',{title:'Fixture app item',message:'Fixture public app context'});});
  ok(await p.evaluate(()=>{const a=window.__wos||window.__wux,w=Object.values(a.wins).find(w=>w.app==='chats');return !a.chats.winAgent(w)&&w.thread==='__new__';}),mode+' app-item reply keeps its explicit main-agent route');
  await p.evaluate(()=>{const a=window.__wos||window.__wux;if(window.__wos)a.onBack();else a.escStep();});
  await choose(p,'agent:hermes');ok(JSON.stringify(await ids(p))===JSON.stringify(['main_phil','main_plain','main_wos']),mode+' main excludes other agents');
  // Both typed and held commands go through the same existing grammar and executor.
  for(const typed of [false,true]){
   await p.evaluate(async({typed})=>{const a=window.__wos||window.__wux;if(window.__wos)await a.handleText('focus Wizard OS',typed?'auto':'command',typed,300,null);else a.localCommand('focus Wizard OS');},{typed});
   ok((await p.locator('.ch-focus-strip:visible [aria-pressed="true"]').innerText()).includes('Wizard OS'),mode+(typed?' typed':' held')+' focus Wizard OS');
   if(typed) await capture(p,mode+'-subject');
   await p.evaluate(async({typed})=>{const a=window.__wos||window.__wux;if(window.__wos)await a.handleText('clear focus',typed?'auto':'command',typed,300,null);else a.localCommand('clear focus');},{typed});
   ok((await p.locator('.ch-focus-strip:visible [aria-pressed="true"]').innerText()).includes('All'),mode+(typed?' typed':' held')+' clear focus');
  }
  await p.evaluate(()=>{const a=window.__wos||window.__wux;return window.__wos?a.handleText('show Philosopher chats','command',false,300,null):a.localCommand('show Philosopher chats');});
  ok((await p.locator('.ch-focus-strip:visible [aria-pressed="true"]').innerText()).includes('Philosopher'),mode+' show agent chats');
  await p.evaluate(()=>{const a=window.__wos||window.__wux;return window.__wos?a.handleText('all chats','command',false,300,null):a.localCommand('all chats');});
  ok((await p.locator('.ch-focus-strip:visible [aria-pressed="true"]').innerText()).includes('All'),mode+' all chats');
  await p.locator('[data-chsearch]:visible').fill('Philosophy');
  await p.locator('[data-chsug="subject:Philosophy"]:visible').click();
  ok((await p.locator('.ch-focus-strip:visible [aria-pressed="true"]').innerText()).includes('Philosophy'),mode+' Filter subject suggestion sets Focus');
  await p.evaluate(()=>{const a=window.__wos||window.__wux;return window.__wos?a.openWizardThread('private_one'):a.openThread('private_one');});
  ok(JSON.stringify(await snap(p))===JSON.stringify(before),mode+' foreign thread links reuse main window');
  ok(await p.locator('[data-wiz-private]:visible').count()>0,mode+' foreign private thread keeps lock');
  await p.goto((desktop?new URL('desktop.html',origin).href:origin)+'?session=private_one',{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>{const a=window.__wos||window.__wux;return a&&Object.values(a.wins).some(w=>w.thread==='private_one');},null,{timeout:15000});
  ok(JSON.stringify(await snap(p))===JSON.stringify(before),mode+' private ?session deep link reuses main window');
  if(!desktop){
   await p.evaluate(()=>__wos.onBack());
   // Skin screenshots use the shared skin setter, not fixture CSS.
   await p.evaluate(()=>WosSkin.set('nebula'));await p.waitForTimeout(250);
   await choose(p,'all:');await capture(p,'phone-nebula-list');
   const nebula=await p.evaluate(()=>({bottom:document.querySelector('.ch-focus-strip').getBoundingClientRect().bottom,dockTop:document.querySelector('#dock').getBoundingClientRect().top}));
   ok(nebula.bottom<=nebula.dockTop,'phone Nebula strip clears dock',nebula);
   await p.evaluate(()=>{document.querySelector('#device').style.setProperty('--safe-b','24px');__wos.setFull('wmain',true);});await p.waitForTimeout(400);
   const corner=await p.evaluate(()=>({bottom:document.querySelector('.ch-focus-strip').getBoundingClientRect().bottom,orbTop:document.querySelector('#orbWrap').getBoundingClientRect().top,corner:document.querySelector('#device').classList.contains('orb-corner')}));
   ok(corner.corner&&corner.bottom<=corner.orbTop,'phone fullscreen strip respects safe area and corner orb',corner);
   await p.evaluate(()=>{document.querySelector('#device').style.removeProperty('--safe-b');__wos.setFull('wmain',false);});await p.waitForTimeout(400);
   await p.locator('[data-chfbtn]:visible').click();await capture(p,'phone-nebula-filter');
   await activate(p,'.ch-fcard [data-chfocusopt="agent:philosopher"]');await capture(p,'phone-nebula-philosopher');
  }
  const savedRows=rows.splice(0);await p.evaluate(async()=>{const a=window.__wos||window.__wux;if(window.__wos)a.onBack();else a.escStep();await a.live.refresh();a.live.emit();});await p.waitForTimeout(250);
  ok(await p.locator('.ch-focus-strip:visible').count()===0,mode+' no threads hides All-only strip');rows.push(...savedRows);
  await ctx.close();
  for(const legacy of ['both','only']){
   const {ctx:lc,p:lp}=await boot(b,desktop,legacy);
   ok(await lp.evaluate(({legacy})=>{const a=window.__wos||window.__wux,cs=Object.values(a.wins).filter(w=>w.app==='chats');return cs.length===1&&!cs[0].agent&&(legacy==='both'?cs[0].id==='wmain':cs[0].focus?.key==='philosopher');},{legacy}),mode+' legacy '+legacy+' migration');
   await lc.close();
  }
 }
 ok(writes.filter(w=>/\/v1\/runs$/.test(w.path)).length===0,'zero /v1/runs during navigation');
 ok(errors.length===0,'no page errors',errors);
 }finally{await b.close();}
 console.log(`${pass} passed, ${fail} failed; intercepted writes ${writes.length}`);process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=2;});
