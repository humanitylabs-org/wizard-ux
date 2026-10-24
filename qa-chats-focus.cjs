// Deterministic Chats Focus acceptance. Based on qa-ready-status.cjs boot/write fence.
// All Wizard reads are fixtures; every write is intercepted; navigation must create zero runs.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const origin = process.argv[2] || 'http://127.0.0.1:9381/wizard-os-home/';
const OUT = process.env.QA_OUT || require('./tools/qa-paths.cjs').workPath('chats-focus');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (v, n, detail = '') => { console.log(v ? 'PASS' : 'FAIL', n, v ? '' : JSON.stringify(detail)); v ? pass++ : fail++; };
const agents = [{ id:'hermes', label:'Archimedes', is_default:true }, { id:'philosopher', label:'Philosopher' }, { id:'idle', label:'Idle' }, { id:'archimedes-new', label:'Archimedes (new)', hidden:true }, { id:'private', label:'Private agent', privacy:'private' }].map(a => ({ harness:'hermes', privacy:'standard', status:'running', model:{provider:'fixture',model:'fixture-model',allowed_models:['fixture-model']}, appearance:{hue:({hermes:265,philosopher:42,idle:330,private:160})[a.id]}, ...a }));
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
let writeSeq = 0;
let sharedSpaces = [];
let soloAgent = false, visualAgents = false;
const sampleSpaces = () => [{id:'wizard-launch',name:'Wizard OS launch',threads:['main_wos','deleted_thread'],createdAt:'2026-10-24T00:00:00.000Z'},{id:'reading',name:'Reading',threads:['main_phil'],createdAt:'2026-10-24T00:00:00.000Z'}];
async function route(r) {
 const q=r.request(), u=new URL(q.url()), m=q.method();
 const json=(body,status=200)=>r.fulfill({status,json:body});
 if (!['GET','HEAD'].includes(m)) { writes.push({method:m,path:u.pathname,query:u.search,body:q.postData()}); if(u.pathname.endsWith('/api/sessions'))return json({ok:true}); if(u.pathname.endsWith('/v1/runs'))return json({run_id:'fixture-run-'+(++writeSeq),status:'running'}); if(u.pathname==='/wizard/files/upload')return json({file:{id:'fixture-audio-'+(++writeSeq),filename:'voice.webm',mime:'audio/webm'}}); if(u.pathname.endsWith('/api/transcribe'))return json({text:'Fixture voice question'}); if(u.pathname==='/wizard/v1/ui-preferences'){const patch=JSON.parse(q.postData());if(patch.spaces)sharedSpaces=patch.spaces;return json({spaces:sharedSpaces});} return json(u.pathname==='/wizard/thread-seen'?{state:JSON.parse(q.postData()||'{}').state}:{ok:true}); }
 if (!u.pathname.startsWith('/wizard/')) return r.continue();
 if (u.pathname==='/wizard/v1/agents') return json({agents:soloAgent?agents.filter(a=>a.is_default):visualAgents?agents.filter(a=>['hermes','philosopher','archimedes-new'].includes(a.id)):agents});
 if (u.pathname==='/wizard/v1/ui-preferences') return json({archiveAfterDays:7,compact:false,readyOrder:'newest',pinnedChats:[],spaces:sharedSpaces});
 if (u.pathname==='/wizard/thread-seen') return json({state:{initializedAt:1,threads:{}}});
 if (u.pathname==='/wizard/hermes/api/sessions' && failedAgents.has(u.searchParams.get('agent'))) return json({error:'fixture agent unavailable'},503);
 if (u.pathname==='/wizard/hermes/api/sessions') return json({data:rows.filter(s=>(s.agent||'')===(u.searchParams.get('agent')||'')),has_more:false,archive_returned:0,archive_total:0});
 const sm=u.pathname.match(/\/sessions\/([^/]+)(\/messages)?$/);
 if (sm) { const s=rows.find(x=>x.id===sm[1]); return json(sm[2]?{data:[{id:1,role:'user',content:'Fixture question',timestamp:now-50},{id:2,role:'assistant',content:'Fixture answer',timestamp:now} ],has_more:false}:{session:s}); }
 if (u.pathname.endsWith('/api/model/options')) return json({options:[{value:'fixture-model',provider:'fixture',default:true}]});
 if (u.pathname==='/wizard/v1/apps') return json({apps:[]});
 return json({});
}
async function boot(b,desktop=false,legacy='') {
 const ctx=await b.newContext({viewport:desktop?{width:1440,height:1000}:{width:412,height:892},hasTouch:!desktop,isMobile:!desktop,deviceScaleFactor:1,serviceWorkers:'block'});
 await ctx.route('**/*',route);
 await ctx.addInitScript(({desktop,legacy})=>{
  const md=navigator.mediaDevices; if(md)md.getUserMedia=async()=>{const ac=new AudioContext(),o=ac.createOscillator(),dst=ac.createMediaStreamDestination();o.connect(dst);o.start();return dst.stream;};
  localStorage.setItem('wos.coached','true');localStorage.setItem('wos.voiceTipSeen','true');localStorage.setItem('wos.shell',desktop?'desktop':'phone');
  if (!sessionStorage.getItem('focusBoot')) {
   sessionStorage.setItem('focusBoot','1');localStorage.setItem('wos.skin','obsidian');
   const wins={wmain:{id:'wmain',app:'chats',thread:null}}, ds=[{id:'home',home:true,wins:[],focus:null},{id:'dmain',wins:['wmain'],focus:'wmain'}];
   if(legacy==='subject'){wins.wmain.focus={kind:'subject',key:'Philosophy'};}
   else if (legacy) { wins.wlegacy={id:'wlegacy',app:'chats',agent:'philosopher',thread:null};ds.push({id:'dlegacy',wins:['wlegacy'],focus:'wlegacy'}); if(legacy==='only'){delete wins.wmain;ds.splice(1,1);} }
   if(desktop){localStorage.setItem('wux.desk.wins',JSON.stringify(wins));localStorage.setItem('wux.desk.ws',JSON.stringify(ds.slice(1)));localStorage.setItem('wux.desk.cur','0');localStorage.setItem('wux.desk.homeOpen','false');}
   else {localStorage.setItem('wos.wins4',JSON.stringify(wins));localStorage.setItem('wos.strip',JSON.stringify(ds));localStorage.setItem('wos.idx4','1');localStorage.setItem('wos.idxDesk',JSON.stringify(ds[1].id));}
  }
 },{desktop,legacy});
 const p=await ctx.newPage();p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(desktop?new URL('desktop.html',origin).href:origin,{waitUntil:'domcontentloaded'});
 await p.waitForFunction(solo=>{const l=(window.__wos||window.__wux)?.live;return solo?!!l?.agentStatus:!!l?.agentStatus.philosopher?.ok;},soloAgent);
 await p.evaluate(()=>{if(window.__wos){const a=__wos,w=Object.values(a.wins).find(w=>w.app==='chats');a.goDesk(a.desks.findIndex(d=>d.wins.includes(w.id)));a.focusWin(w.id);}else{const a=__wux,w=Object.values(a.wins).find(w=>w.app==='chats');a.focusWin(w.id);}});
 await p.waitForTimeout(600);return {ctx,p};
}
const snap=p=>p.evaluate(()=>{const a=window.__wos||window.__wux;return {desks:(a.desks||a.ws).length,wins:Object.keys(a.wins).length};});
const ids=p=>p.locator('.ch-list:visible [data-chopen]').evaluateAll(es=>es.map(e=>e.dataset.chopen).sort());
async function activate(p,s){const l=p.locator(s);await l[await p.evaluate(()=>navigator.maxTouchPoints>0)?'tap':'click']();}
async function choose(p,v){
 if(v.startsWith('space:')) { const id=v.slice(6),agent=sharedSpaces.find(s=>s.id===id)?.agent||'hermes';await choose(p,'agent:'+agent);await activate(p,`.ch-focus-strip:visible [data-chfocusopt="agent:${agent}"]`);await activate(p,`[data-spspace="${id}"]`);return; }
 const tab=p.locator(`.ch-focus-strip:visible [data-chfocusopt="${v}"]`);
 if(await tab.getAttribute('aria-pressed')!=='true') await activate(p,`.ch-focus-strip:visible [data-chfocusopt="${v}"]`);
}
const activeFocus = p => p.locator('.ch-focus-strip:visible [aria-pressed="true"]').innerText();
async function capture(p,name){await p.waitForTimeout(450);await p.screenshot({path:path.join(OUT,name+'.png'),animations:'disabled'});}
// Archived threads are read, and agent/Space dots count only unread threads the list shows (James, 24 Oct 2026).
async function archivedUnreadMatrix(b) {
 const saved=rows.slice(), t=now-10*86400;
 const mk=(id,extra)=>({...saved[4],id,title:id,agent:'idle',last_active:now,started_at:now-50,wizard_last_user_at:now-60,wizard_last_assistant_at:now,wizard_activity_at:now,latest_message:{role:'assistant',content:'Fixture',timestamp:now},...extra});
 rows.push(mk('idle_archived',{archived:true}),mk('idle_aged',{last_active:t,started_at:t-50,wizard_last_user_at:t,wizard_last_assistant_at:t,wizard_activity_at:t,latest_message:{role:'assistant',content:'Old',timestamp:t}}));
 for(const desktop of [false,true]) {
  const {ctx,p}=await boot(b,desktop),mode=desktop?'desktop':'phone';
  const dot='.ch-focus-strip:visible [data-chfocusopt="agent:idle"] .ch-focus-dot';
  const st=await p.evaluate(()=>{const L=(window.__wos||window.__wux).live,s=id=>L.unified().find(x=>x.id===id);return {arch:L.isNew(s('idle_archived')),aged:L.isNew(s('idle_aged')),vis:L.visibleUnread?L.visibleUnread(L.unified().filter(x=>x.agent==='idle')).length:-1};});
  ok(st.arch===false&&st.aged===false&&st.vis===0,mode+' archived and aged-out threads read as read',st);
  ok(await p.locator(dot).count()===0,mode+' no agent dot when only archived threads are unread');
  rows.push(mk('idle_live',{}));await p.evaluate(async()=>{const L=(window.__wos||window.__wux).live;L.fullAt=0;await L.refresh();L.emit();});await p.waitForTimeout(300);
  ok(await p.locator(dot).count()===1,mode+' agent dot returns for a visible unread thread');
  const before=writes.length;await p.evaluate(async()=>{await (window.__wos||window.__wux).live.archive('idle_live');});await p.waitForTimeout(300);
  const seen=writes.slice(before).find(w=>w.path==='/wizard/thread-seen'&&/agent\/idle\/[^"]*idle_live/.test(w.body||''));
  ok(!!seen,mode+' Done marks the thread read on the server');
  ok(await p.locator(dot).count()===0,mode+' agent dot clears once the thread is archived');
  rows.splice(rows.findIndex(r=>r.id==='idle_live'),1);
  await ctx.close();
 }
 rows.splice(0,rows.length,...saved);
}
async function sectionMatrix(b) {
 const saved=rows.slice();
 const sections=['ready','yesterday','pastWeek','archive','errors','working'];
 for(const [i,k] of sections.entries()) {
  const t=now-([0,86400,3*86400,10*86400,0,0][i]);
  rows.push({...rows[4],id:'section_'+k,title:'Section '+k,status:k==='errors'?'failed':k==='working'?'running':'completed',archived:k==='archive',last_active:t,started_at:t-50,wizard_last_user_at:t,wizard_last_assistant_at:t,wizard_activity_at:t,latest_message:{role:'assistant',content:'Section fixture',timestamp:t}});
 }
 sharedSpaces=[{id:'sections',name:'Sections',agent:'philosopher',threads:rows.filter(r=>r.agent==='philosopher').map(r=>r.id)}];
 for(const desktop of [false,true]) {
  const {ctx,p}=await boot(b,desktop),mode=desktop?'desktop':'phone';
  await p.evaluate(()=>{const a=window.__wos||window.__wux;document.documentElement.dataset.skin='nebula';a.live.chatLayout='day';});
  for(const focus of ['agent:philosopher','space:sections']) {
   await choose(p,focus);
   for(const k of sections) {
    const h=p.locator(`.ch-list:visible [data-sectoggle="${k}"]`);
    if(!await h.count()){ok(false,mode+' '+focus+' '+k+' header exists');continue;}
    if(await h.getAttribute('aria-expanded')==='false')await h.click();
    await h.click();ok(await h.getAttribute('aria-expanded')==='false',mode+' '+focus+' '+k+' collapses');
    await p.evaluate(()=>{const a=window.__wos||window.__wux;a.live.emit();});
    ok(await h.getAttribute('aria-expanded')==='false',mode+' '+focus+' '+k+' survives refresh');
    await h.click();ok(await h.getAttribute('aria-expanded')==='true',mode+' '+focus+' '+k+' expands');
   }
  }
  await ctx.close();
 }
 rows.splice(0,rows.length,...saved);sharedSpaces=[];
}
// Exercise the real durable outbox and intercepted create/run HTTP transports, not an enqueue stub.
async function routingMatrix(b) {
 for(const desktop of [false,true]) {
  const {ctx,p}=await boot(b,desktop),mode=desktop?'desktop':'phone';
  const reset=async(agent='philosopher')=>{
   await p.evaluate(agent=>{const a=window.__wos||window.__wux,w=Object.values(a.wins).find(w=>w.app==='chats');if(w.thread){if(window.__wos)a.onBack();else a.escStep();}a.chats.setFocus(w,agent.startsWith('space:')?{kind:'space',key:agent.slice(6)}:{kind:'agent',key:agent});a.focusWin(w.id);document.activeElement?.blur();},agent);
   await p.waitForTimeout(650);
   if(!desktop)await p.waitForFunction(()=>__wos.voice==='idle',null,{timeout:6000});
  };
  const send=async()=>{await p.locator('.ch-compose textarea:visible').fill('Fixture Focus route');await p.locator('.ch-compose textarea:visible').press('Control+Enter');};
  const check=async(name,act,agent='philosopher')=>{
   await reset(agent);const at=writes.length;
   try {await act();} catch(e) {ok(false,mode+' ROUTING '+name+' → '+agent,{error:e.message});return;}
   const end=Date.now()+16000;while(Date.now()<end&&!writes.slice(at).some(w=>w.path.endsWith('/v1/runs')))await p.waitForTimeout(100);
   const actual=writes.slice(at).filter(w=>w.path.endsWith('/api/sessions')||w.path.endsWith('/v1/runs'));
   const scoped=agent.startsWith('space:')?(sharedSpaces.find(s=>s.id===agent.slice(6))?.agent||'hermes'):agent;const target=scoped==='hermes'?'':scoped;
   ok(actual.length===2&&actual.every(w=>(new URLSearchParams(w.query).get('agent')||'')===target&&(JSON.parse(w.body).agent||'')===target),mode+' ROUTING '+name+' → '+agent,actual);return actual;
  };
  for(const agent of ['philosopher','hermes','private']) {
   await check('list +',async()=>{await activate(p,'[data-chfab]:visible');await send();},agent);
   await check('__new__ composer',async()=>{await p.evaluate(()=>{const a=window.__wos||window.__wux,w=Object.values(a.wins).find(w=>w.app==='chats');a.chats.openChat(w.id,'__new__');});await send();},agent);
  }
  await check('empty-state Start a new chat',async()=>{await p.locator('.ch-list:visible [data-chemptynew]').click();await send();},'idle');
  if(desktop) {
   await check('Start a new chat',async()=>{await p.locator('[data-panenew]:visible').click();await send();});
   await check('Alt+Enter',async()=>{await p.keyboard.press('Alt+Enter');await send();});
   await check('orb tap',async()=>{await p.locator('#micBtn').click();await p.waitForTimeout(900);await p.locator('#micBtn').click();});
   await check('Alt+Shift+V',async()=>{await p.keyboard.press('Alt+Shift+V');await p.waitForTimeout(900);await p.keyboard.press('Alt+Shift+V');});
   await check('new voice button',async()=>{await p.locator('#generalVoice').click();await p.waitForTimeout(900);await p.locator('#generalVoice').click();});
  } else {
   await check('orb tap',async()=>{await p.locator('#orbWrap').tap();await p.waitForTimeout(900);await p.locator('#orbWrap').tap();});
   await check('phone new voice',async()=>{await p.evaluate(()=>__wos.startVoice('general'));await p.waitForTimeout(900);await p.evaluate(()=>__wos.finishVoice());});
   // Holding is intentionally a local-command surface, NOT a message/new-chat transport.
   await reset();const at=writes.length;
   const box=await p.locator('#orbWrap').boundingBox();const cdp=await ctx.newCDPSession(p);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});await p.waitForTimeout(1100);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(1800);await cdp.detach();
   ok(!writes.slice(at).some(w=>w.path.endsWith('/api/sessions')||w.path.endsWith('/v1/runs')),'phone ROUTING orb hold → local command, no chat');
  }
  // Both legacy-main and agent-owned Spaces retain their owner route and durable membership.
  for(const spaceAgent of ['hermes','philosopher']) {
  sharedSpaces=[{id:'route-space',name:'Route space',agent:spaceAgent,threads:[]}];
  await p.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await p.waitForTimeout(250);
  for(const voice of [false,true]) {
   const req=await check(voice?'Space new voice':'Space list +',async()=>{
    if(!voice){await activate(p,'[data-chfab]:visible');await send();}
    else if(desktop){await p.locator('#generalVoice').click();await p.waitForTimeout(900);await p.locator('#generalVoice').click();}
    else{await p.evaluate(()=>__wos.startVoice('general'));await p.waitForTimeout(900);await p.evaluate(()=>__wos.finishVoice());}
   },'space:route-space');
   const sid=JSON.parse(req?.find(r=>r.path.endsWith('/v1/runs'))?.body||'{}').session_id;
   ok(!!sid&&sharedSpaces[0]?.threads.includes(sid),mode+' Space '+(voice?'voice':'typed')+' joins durable thread id',sharedSpaces);
  }
  }
  if(desktop)await check('Alt+N fresh window',async()=>{await p.keyboard.press('Alt+N');await send();});
  await ctx.close();sharedSpaces=[];
 }
}
async function visualPicker(b) {
 visualAgents=true;
 sharedSpaces=[{id:'launch',name:'WizardOS Launch',agent:'hermes',threads:['main_wos'],createdAt:new Date().toISOString()},{id:'apps',name:'WizardOS Apps',agent:'hermes',threads:['main_phil'],createdAt:new Date().toISOString()}];
 const {ctx,p}=await boot(b,false);await p.evaluate(()=>WosSkin.set('nebula'));await choose(p,'agent:hermes');
 await capture(p,'phone-nebula-strip');
 await activate(p,'.ch-focus-tab.on:visible');await capture(p,'phone-nebula-picker');
 const g=await p.locator('.ch-space-picker').boundingBox();ok(g.x>=0&&g.x+g.width<=412&&g.y>=0,'phone picker inside viewport',g);
 await activate(p,'[data-spspace="launch"]');await capture(p,'phone-nebula-space-active');
 await activate(p,'.ch-focus-tab.on:visible');await activate(p,'[data-spnew]');await p.locator('.ch-space-form input').fill('Research projects');
 await p.evaluate(()=>WosSkin.set('obsidian'));await p.locator('.mz-intro').waitFor({state:'attached'});await p.locator('.mz-intro').waitFor({state:'detached'});
 // Dark's existing first-switch intro navigates Home. Reopen the same Chats window after it finishes.
 await p.evaluate(()=>{const a=__wos,w=Object.values(a.wins).find(w=>w.app==='chats');a.goDesk(a.desks.findIndex(d=>d.wins.includes(w.id)));a.focusWin(w.id);});
 if(!await p.locator('[data-chspacepicker]').count())await activate(p,'.ch-focus-tab.on:visible');if(!await p.locator('.ch-space-form input').count())await activate(p,'[data-spnew]');await p.locator('.ch-space-form input').fill('Research projects');await capture(p,'phone-dark-new-space');
 ok(await p.locator('.ch-space-form input').inputValue()==='Research projects','Dark skin new Space input remains legible and editable');
 await p.evaluate(()=>__wos.onBack());await ctx.close();
 const wide=await boot(b,true);await wide.p.evaluate(()=>WosSkin.set('nebula'));await choose(wide.p,'agent:hermes');await activate(wide.p,'.ch-focus-tab.on:visible');await capture(wide.p,'desktop-nebula-picker');await wide.ctx.close();
 visualAgents=false;sharedSpaces=[];
}

async function pickerAcceptance(browser, mode) {
 sharedSpaces = [{id:'main-only',name:'Main plans',threads:['main_wos','not-loaded-yet'],createdAt:new Date().toISOString()}, {id:'phil-only',name:'Reading',agent:'philosopher',threads:['phil_one'],createdAt:new Date().toISOString()}];
 const at=writes.length;const {ctx,p}=await boot(browser,mode==='desktop');await choose(p,'agent:hermes');
 ok(!await p.locator('.ch-focus-strip [data-chfocusopt^="space:"]').count(),mode+' strip has no Space pills');
 ok(!await p.locator('[data-chfocusopt="agent:archimedes-new"]').count(),mode+' hidden agent excluded from strip');
 await activate(p,'.ch-focus-strip:visible [data-chfocusopt="agent:hermes"]');
 ok(await p.locator('[data-chspacepicker]').count()===1,mode+' tapping active agent opens picker');
 ok(await p.locator('[data-spspace="main-only"]').count()===1&&!await p.locator('[data-spspace="phil-only"]').count(),mode+' picker only owner agent Spaces');
 ok((await p.locator('[data-spspace="main-only"] small').innerText())==='1',mode+' picker excludes archived persisted members outside loaded list window');
 await activate(p,'[data-spspace="main-only"]');
 ok((await p.locator('.ch-focus-tab.on:visible').innerText()).includes('Main plans'),mode+' Space replaces agent label');
 ok((await p.locator('.ch-focus-tab.on:visible').getAttribute('data-chfocusopt'))==='agent:hermes',mode+' Space retains agent tab identity');
 await activate(p,'.ch-focus-tab.on:visible');await activate(p,'[data-spall]');
 ok((await p.locator('.ch-focus-tab.on:visible').innerText()).includes('Archimedes'),mode+' All restores agent label');
 const phi=p.locator('.ch-focus-strip:visible [data-chfocusopt="agent:philosopher"]');
 await phi.scrollIntoViewIfNeeded();
 await p.waitForFunction(()=>[...document.querySelectorAll('.ch-focus-strip [data-chfocusopt="agent:philosopher"]')].some(e=>{const r=e.getBoundingClientRect();return r.height>0&&r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
 if(mode==='phone') {const b=await phi.boundingBox();const cdp=await p.context().newCDPSession(p);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});await p.waitForTimeout(550);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}else{await phi.hover();await p.mouse.down();await p.waitForTimeout(550);await p.mouse.up();}
 if(!await p.locator('[data-chspacepicker]').count()){await capture(p,mode+'-longpress-failure');console.log('longpress geometry',await phi.boundingBox());}
 ok(await p.locator('[data-chspacepicker]').count()===1,mode+' inactive agent long-press opens picker');
 ok(await p.locator('[data-spspace="phil-only"]').count()===1&&!await p.locator('[data-spspace="main-only"]').count(),mode+' long-press correct agent list');
 const before=await p.evaluate(()=>Object.values((window.__wos||window.__wux).wins).find(w=>w.app==='chats').focus);
 const back=await p.evaluate(()=>{if(window.__wos){__wos.onBack();return __backLog.at(-1);}return __wux.escStep();});
 ok(back==='space-picker'&&!await p.locator('[data-chspacepicker]').count(),mode+' Back closes nested picker first');
 ok(await p.evaluate(f=>{const w=Object.values((window.__wos||window.__wux).wins).find(w=>w.app==='chats');return !!w&&JSON.stringify(w.focus)===JSON.stringify(f)},before),mode+' Back preserves app and prior focus');
 await p.waitForTimeout(800);await phi.click({button:'right'});
 ok(await p.locator('[data-chspacepicker]').count()===1,mode+' right click opens agent picker');
 await activate(p,'[data-spnew]');await p.locator('.ch-space-form input').fill('  Philosophy QA  ');
 await p.locator('.ch-space-form').evaluate(f=>{f.requestSubmit();f.requestSubmit();});
 await p.waitForTimeout(900);
 const allWrites=writes.slice(at);
 const put=allWrites.find(x=>x.method==='PUT'&&x.path==='/wizard/v1/ui-preferences'&&JSON.parse(x.body||'{}').spaces?.some(s=>s.name==='Philosophy QA'));
 const newSpace=put&&JSON.parse(put.body).spaces.find(s=>s.name==='Philosophy QA');
 ok(!!newSpace&&newSpace.agent==='philosopher',mode+' New Space PUT has selected agent');
 ok(await p.evaluate(id=>{const w=Object.values((window.__wos||window.__wux).wins).find(w=>w.app==='chats');return w.focus?.key===id},newSpace?.id),mode+' New Space immediately focused');
 const creates=allWrites.filter(x=>x.method==='POST'&&x.path==='/wizard/hermes/api/sessions'),runs=allWrites.filter(x=>x.method==='POST'&&x.path==='/wizard/hermes/v1/runs');
 ok(creates.length===1&&runs.length===1,mode+' double submit produces exactly one new thread/run',{creates,runs});
 ok([...creates,...runs].every(x=>new URLSearchParams(x.query).get('agent')==='philosopher'&&JSON.parse(x.body||'{}').agent==='philosopher'),mode+' fill uses normal outbox and agent query+body on both writes',{creates,runs});
 const run=JSON.parse(runs[0]?.body||'{}');
 ok(JSON.stringify(run.input).includes('Fill my new Space')&&JSON.stringify(run.input).includes(newSpace?.id||'NEVER'),mode+' fill command contains existing Space id');
 ok(sharedSpaces.find(s=>s.id===newSpace?.id)?.threads.length===1,mode+' fill thread joins its Space');
 ok(sharedSpaces.find(s=>s.id==='main-only')?.threads.includes('main_wos'),mode+' New Space preserves existing collections');
 await ctx.close();
}

async function soloAcceptance(b) {
 soloAgent=true;
 try { for(const desktop of [false,true]) {
  const mode=(desktop?'desktop':'phone')+' solo';sharedSpaces=[];
  const {ctx,p}=await boot(b,desktop);
  try {
   await p.waitForTimeout(1200);await p.evaluate(()=>WosSkin.set('nebula'));await p.waitForTimeout(500);
   ok(await p.locator('.ch-focus-strip').count()===0,mode+' zero Spaces hides strip');
   const row=p.locator('[data-chopen="main_wos"]:visible');
   await row.scrollIntoViewIfNeeded();
   if(desktop)await row.click({button:'right'});
   else {const r=await row.boundingBox(),cdp=await ctx.newCDPSession(p);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height/2}]});await p.waitForTimeout(600);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
   ok(await p.locator('[data-rsspacepicker]').count()===1,mode+' long-press offers Add to a Space with zero Spaces');
   await activate(p,'[data-rsspacepicker]');
   ok(await p.locator('[data-spnew]').count()===1,mode+' empty Add picker offers New Space');
   await activate(p,'[data-spnew]');await p.locator('.ch-space-form input').fill('First space');
   const prior=await snap(p);
   await p.evaluate(()=>{if(window.__wos)__wos.onBack();else __wux.escStep();});
   ok(!await p.locator('[data-chspacepicker]').count()&&JSON.stringify(await snap(p))===JSON.stringify(prior),mode+' Back closes nested New Space without leaving Chats');
   await row.click({button:'right'});await activate(p,'[data-rsspacepicker]');await activate(p,'[data-spnew]');
   const at=writes.length;await p.locator('.ch-space-form input').fill('First space');await p.locator('.ch-space-form').evaluate(f=>f.requestSubmit());await p.waitForTimeout(400);
   ok(sharedSpaces.length===1&&sharedSpaces[0].threads.includes('main_wos'),mode+' first Space contains the held thread');
   ok(!writes.slice(at).some(w=>w.path.endsWith('/v1/runs')),mode+' row-created Space starts no fill run');
  } finally {await ctx.close();}
  sharedSpaces=[{id:'solo',name:'Solo space',threads:['main_wos']},{id:'reading',name:'Reading',threads:['main_phil']}];
  const r=await boot(b,desktop);
  try { for(const skin of ['nebula','obsidian-light']) {
   await r.p.evaluate(s=>WosSkin.set(s),skin);await r.p.waitForTimeout(400);await r.p.locator('.mz-intro').waitFor({state:'detached'});
   await r.p.evaluate(()=>{const a=window.__wos||window.__wux,w=Object.values(a.wins).find(w=>w.app==='chats');if(window.__wos)a.goDesk(a.desks.findIndex(d=>d.wins.includes(w.id)));a.focusWin(w.id);});
   const strip=r.p.locator('.ch-focus-strip:visible');
   ok(JSON.stringify(await strip.locator('[data-chfocusopt]').evaluateAll(es=>es.map(e=>e.dataset.chfocusopt)))===JSON.stringify(['all:','space:solo','space:reading'])&&await strip.locator('[data-chspacenew]').count()===1,mode+' '+skin+' All / Space / +, no agent chip');
   await activate(r.p,'.ch-focus-strip:visible [data-chfocusopt="space:solo"]');
   ok(!await r.p.locator('[data-chspacepicker]').count()&&JSON.stringify(await ids(r.p))===JSON.stringify(['main_wos']),mode+' '+skin+' Space tap directly filters without picker');
   ok(await r.p.evaluate(()=>{const a=window.__wos||window.__wux,w=Object.values(a.wins).find(w=>w.app==='chats');return a.chats.listTitle(w)==='Solo space';}),mode+' '+skin+' header focus title is Space name');
   await capture(r.p,mode+'-'+skin+'-flat-spaces');
   await activate(r.p,'[data-chspacenew]:visible');
   ok(await r.p.locator('.ch-space-form input').count()===1,mode+' '+skin+' + opens existing naming form');
   await r.p.locator('.ch-space-form input').fill('Unsent name');
   await capture(r.p,mode+'-'+skin+'-new-space');
   const prior=await snap(r.p);await r.p.evaluate(()=>{if(window.__wos)__wos.onBack();else __wux.escStep();});
   ok(!await r.p.locator('[data-chspacepicker]').count()&&JSON.stringify(await snap(r.p))===JSON.stringify(prior),mode+' '+skin+' Back from + form preserves app');
  }} finally {await r.ctx.close();}
 }} finally {soloAgent=false;sharedSpaces=[];}
}

(async()=>{
 const b=await chromium.launch({executablePath:process.env.QA_CHROME||undefined,args:['--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 try {
 await soloAcceptance(b);
 if(process.env.QA_SOLO_ONLY){console.log(`${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;return;}
 await visualPicker(b);
 await pickerAcceptance(b,'phone');await pickerAcceptance(b,'desktop');
 if(process.env.QA_PICKER_ONLY){console.log(`${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;return;}
 const navigationAt=writes.length;
 // One-agent install: no strip and no Focus section until a second agent or a Space exists.
 for(const desktop of [false,true]){
  soloAgent=true;sharedSpaces=[];
  const {ctx,p}=await boot(b,desktop), mode=(desktop?'desktop':'phone')+' one-agent';
  await p.waitForTimeout(1200);
  ok(await p.locator('.ch-focus-strip').count()===0,mode+' shows no Focus strip');
  const fb=p.locator('.ch-list:visible [data-chfbtn]').first();
  if(await fb.count()){await fb.click();await p.waitForTimeout(300);ok(!(await p.locator('[data-chfsheet]').innerText().catch(()=>'')).includes('Focus'),mode+' Filter sheet has no Focus section');}
  else ok(false,mode+' filter button found');
  await ctx.close();
  sharedSpaces=[{id:'solo',name:'Solo space',threads:[]}];
  const r2=await boot(b,desktop);await r2.p.waitForTimeout(1200);
  ok(await r2.p.locator('.ch-focus-strip:visible').count()===1,mode+' a Space brings the strip back');
  await r2.ctx.close();
  soloAgent=false;sharedSpaces=[];
 }
 for(const desktop of process.env.QA_ROUTING_ONLY?[]:[false,true]){
  sharedSpaces=[];
  const {ctx,p}=await boot(b,desktop), mode=desktop?'desktop':'phone', before=await snap(p);
  const present=await p.locator('.ch-focus-strip:visible').count();ok(present===1,mode+' Focus strip exists');
  if(!present){await capture(p,mode+'-missing');await ctx.close();continue;}
  ok((await activeFocus(p))==='All',mode+' defaults to All');
  ok((await ids(p)).length===6,mode+' All includes every agent and subjectless threads');
  ok(await p.locator('[data-chfocus], .ch-focus, [aria-label="Focus chats"]').count()===0,mode+' pill and standalone Focus sheet absent');
  const box=await p.locator('.ch-focus-strip:visible [data-chfocusopt="all:"]').boundingBox();ok(box.height>=44&&box.width>=44,mode+' tab thumb target >=44px',box);
  const opts=p.locator('.ch-focus-strip:visible [data-chfocusopt]');
  ok(await opts.count()===5,mode+' strip exactly All plus every agent, despite subjects');
  ok(await opts.first().getAttribute('data-chfocusopt')==='all:',mode+' All first');
  ok(JSON.stringify(await opts.evaluateAll(es=>es.map(e=>e.dataset.chfocusopt)))===JSON.stringify(['all:','agent:hermes','agent:philosopher','agent:idle','agent:private']),mode+' stable All then registry agent order',await opts.evaluateAll(es=>es.map(e=>({key:e.dataset.chfocusopt,label:e.getAttribute('aria-label')}))));
  ok(await p.locator('.ch-focus-strip [data-chfocusopt="agent:idle"]').count()===1,mode+' empty agent remains on strip');
  ok(await p.locator('.ch-focus-strip [data-chfocusopt="agent:private"] .ag-lock').count()>0,mode+' private lock visible');
  ok(await p.locator('.ch-focus-strip:visible').evaluate(e=>e.scrollWidth>=e.clientWidth&&getComputedStyle(e).touchAction==='pan-x'&&new Set([...e.children].map(c=>c.offsetTop)).size===1),mode+' single row scrolls horizontally');
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
  await capture(p,desktop?'desktop-dark':'phone-dark-all');
  ok(await p.locator('.ch-list:visible').evaluate(e=>!e.style.getPropertyValue('--ch-agent-hue')),mode+' All has no agent tint');
  const pill=await opts.first().evaluate(e=>({hit:e.getBoundingClientRect().height,visual:parseFloat(getComputedStyle(e,'::before').height)}));
  ok(pill.hit>=44&&pill.visual<=34&&pill.visual>=30,mode+' slim 32px pill and 44px target',pill);
  const existingRows=rows.slice();
  rows.push(...Array.from({length:24},(_,i)=>({...rows[0],id:'subject_fixture_'+i,title:'Subject fixture '+i,wizard_attention:{...rows[0].wizard_attention,subject:'Automatic topic '+i}})));
  await p.evaluate(async()=>{const a=window.__wos||window.__wux;await a.live.refresh();a.live.emit();});await p.waitForTimeout(100);
  ok(await p.locator('.ch-focus-strip:visible [data-chfocusopt]').count()===5,mode+' 26 automatic subjects create zero tabs');
  rows.splice(0,rows.length,...existingRows);await p.evaluate(async()=>{const a=window.__wos||window.__wux;await a.live.refresh();a.live.emit();});
  // Cross-device preference pull creates only explicit Spaces after agents.
  sharedSpaces=sampleSpaces();await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await p.waitForTimeout(200);
  ok(JSON.stringify(await opts.evaluateAll(es=>es.map(e=>e.dataset.chfocusopt)))===JSON.stringify(['all:','agent:hermes','agent:philosopher','agent:idle','agent:private']),mode+' Spaces never add strip tabs');
  await choose(p,'agent:philosopher');
  ok(JSON.stringify(await ids(p))===JSON.stringify(['phil_one','phil_two']),mode+' Philosopher only');
  ok((await activeFocus(p)).includes('Philosopher'),mode+' active tab updates');
  ok(await p.locator('.ch-list:visible').evaluate(e=>e.style.getPropertyValue('--ch-agent-hue')===String(WosAgents.distinctHues().get('philosopher'))&&getComputedStyle(e).backgroundImage==='none'),mode+' focused list keeps the skin background (no wash)');
  {const hl=await p.locator('.ch-list:visible').evaluate(e=>{const fab=e.querySelector('.ch-fab'),strip=e.querySelector('.ch-focus-strip');return {fab:fab?getComputedStyle(fab).backgroundImage:'',strip:strip?getComputedStyle(strip).borderTopWidth:''};});
  ok(hl.strip==='2px'&&(!hl.fab||!/155, 107, 255/.test(hl.fab)),mode+' agent colour carries the highlights (+ button, strip edge)',hl);}
  ok(await opts.evaluateAll(es=>es.filter(e=>e.dataset.chfocusopt.startsWith('agent:')).every(e=>e.style.getPropertyValue('--ch-agent-colour')===WosAgents.colour(WosAgents.get(e.dataset.chfocusopt.slice(6))))),mode+' tabs reuse registry colours');
  const activePaint=await p.locator('.ch-focus-strip:visible .on').evaluate(e=>({bg:getComputedStyle(e,'::before').backgroundColor,neutral:getComputedStyle(e.parentElement).backgroundColor}));
  ok(activePaint.bg!=='rgba(0, 0, 0, 0)'&&activePaint.bg!==activePaint.neutral,mode+' active pill filled',activePaint);
  const ready=p.locator('.ch-list:visible [data-sectoggle=ready]');
  await ready.click();ok(await ready.getAttribute('aria-expanded')==='false',mode+' agent Ready collapses');
  await choose(p,'all:');ok(await ready.getAttribute('aria-expanded')==='false',mode+' All shares collapsed section state');
  await choose(p,'space:wizard-launch');ok(await ready.getAttribute('aria-expanded')==='false',mode+' Space shares collapsed section state');
  ok(await p.locator('.ch-list:visible').evaluate(e=>!!e.style.getPropertyValue('--ch-agent-hue')),mode+' Space retains owner agent tint');
  await ready.click();ok(await ready.getAttribute('aria-expanded')==='true',mode+' Space Ready expands');
  await choose(p,'agent:philosopher');
  ok(await p.locator('.ch-focus-strip:visible .on').evaluate(e=>{const a=e.getBoundingClientRect(),r=e.parentElement.getBoundingClientRect();return a.left>=r.left&&a.right<=r.right;}),mode+' active tab auto-scrolls fully into view');
  ok(JSON.stringify(await snap(p))===JSON.stringify(before),mode+' focus creates no window or desk');
  await capture(p,desktop?'desktop-philosopher':'phone-dark-philosopher');
  await p.locator('[data-chsearch]:visible').fill('answer');await p.waitForTimeout(220);
  ok(JSON.stringify(await ids(p))===JSON.stringify(['phil_two']),mode+' search AND Focus');
  await p.locator('[data-chsclear]:visible').click();
  await p.locator('[data-chsearch]:visible').blur();
  failedAgents.add('philosopher');
  await p.evaluate(async()=>{const a=window.__wos||window.__wux;await a.live.refreshAgents(undefined,'philosopher');a.live.emit();});
  await p.locator('.ch-list:visible .ch-sync.off').waitFor({timeout:10000});
  ok(await p.locator('.ch-list:visible .ch-sync.off').count()===1,mode+' focused agent errors use existing scoped status');
  failedAgents.clear();
  await p.evaluate(async()=>{const a=window.__wos||window.__wux;await a.live.refreshAgents(undefined,'philosopher');a.live.emit();});
  await choose(p,'space:wizard-launch');
  ok(JSON.stringify(await ids(p))===JSON.stringify(['main_wos']),mode+' Space filters exact members, ignores deleted ids');
  await p.locator('[data-chfbtn]:visible').click();
  ok(await p.locator('.ch-fcard h5').evaluateAll(es=>es.some(e=>e.textContent==='Focus')),mode+' Filter sheet has Focus section');
  ok(await p.locator('.ch-fcard [data-chfocusopt]').count()===7,mode+' Filter offers every focus option');
  ok(await p.locator('.ch-fcard [data-chfocusopt^="subject:"]').count()===0,mode+' no automatic subject Focus in Filter');
  ok(await p.locator('.ch-fcard [data-chfocusopt="agent:idle"]').count()===1,mode+' Filter keeps empty agent reachable');
  await activate(p,'.ch-fcard [data-chfocusopt="agent:private"]');
  ok(JSON.stringify(await ids(p))===JSON.stringify(['private_one']),mode+' Filter Focus selection sets scope');
  await choose(p,'space:wizard-launch');await p.locator('[data-chfbtn]:visible').click();
  ok(await p.locator('[data-chfopt^="subject:"]').count()===0,mode+' status sheet no longer has Subject');
  await p.locator('[data-chfopt="status:needs"]:visible').click();
  ok(JSON.stringify(await ids(p))===JSON.stringify(['main_wos']),mode+' status AND Focus');
  ok(await p.locator('.ch-search:visible').evaluate(e=>e.scrollWidth<=e.clientWidth+1),mode+' Focus plus status fit search field');
  await capture(p,mode+'-focus-status');
  await p.locator('[data-chchipx="status"]:visible').click();
  await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(solo=>{const l=(window.__wos||window.__wux)?.live;return solo?!!l?.agentStatus:!!l?.agentStatus.philosopher?.ok;},soloAgent);
  ok((await p.locator('.ch-focus-strip:visible [aria-pressed="true"]').innerText()).includes('Wizard OS launch'),mode+' Space focus survives reload');
  await p.locator('[data-chopen="main_wos"]:visible').click();await p.waitForTimeout(250);
  ok(await p.locator('.ch-thread .ch-focus-strip').count()===0&&(desktop||await p.locator('.ch-focus-strip:visible').count()===0),mode+' thread view has no strip');
  if(desktop) ok(await p.locator('.pane-list .ch-focus-strip:visible').count()===1,mode+' desktop strip stays in list pane only');
  await p.evaluate(()=>{const a=window.__wos||window.__wux;if(window.__wos){a.onBack();a.onBack();}else{a.escStep();a.escStep();}});
  ok(await p.locator('.ch-focus-strip:visible').count()===1&&(await p.locator('.ch-focus-strip:visible [aria-pressed="true"]').innerText()).includes('Wizard OS launch'),mode+' Back twice keeps app and Focus');
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
   await p.evaluate(async({typed})=>{const a=window.__wos||window.__wux;if(window.__wos)await a.handleText('focus Wizard OS launch',typed?'auto':'command',typed,300,null);else a.localCommand('focus Wizard OS launch');},{typed});
   ok((await p.locator('.ch-focus-strip:visible [aria-pressed="true"]').innerText()).includes('Wizard OS launch'),mode+(typed?' typed':' held')+' focus Wizard OS launch');
   if(typed) await capture(p,mode+'-space');
   await p.evaluate(async({typed})=>{const a=window.__wos||window.__wux;if(window.__wos)await a.handleText('clear focus',typed?'auto':'command',typed,300,null);else a.localCommand('clear focus');},{typed});
   ok((await p.locator('.ch-focus-strip:visible [aria-pressed="true"]').innerText()).includes('All'),mode+(typed?' typed':' held')+' clear focus');
  }
  await p.evaluate(()=>{const a=window.__wos||window.__wux;return window.__wos?a.handleText('show Philosopher chats','command',false,300,null):a.localCommand('show Philosopher chats');});
  ok((await p.locator('.ch-focus-strip:visible [aria-pressed="true"]').innerText()).includes('Philosopher'),mode+' show agent chats');
  await p.evaluate(()=>{const a=window.__wos||window.__wux;return window.__wos?a.handleText('all chats','command',false,300,null):a.localCommand('all chats');});
  ok((await p.locator('.ch-focus-strip:visible [aria-pressed="true"]').innerText()).includes('All'),mode+' all chats');
  await p.locator('[data-chsearch]:visible').fill('Reading');
  await p.locator('[data-chsug="space:reading"]:visible').click();
  ok((await p.locator('.ch-focus-strip:visible [aria-pressed="true"]').innerText()).includes('Reading'),mode+' Space suggestion sets Focus');
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
   await choose(p,'space:wizard-launch');await capture(p,'phone-nebula-space');
   const nebula=await p.evaluate(()=>({bottom:document.querySelector('.ch-focus-strip').getBoundingClientRect().bottom,dockTop:document.querySelector('#dock').getBoundingClientRect().top}));
   ok(nebula.bottom<=nebula.dockTop,'phone Nebula strip clears dock',nebula);
   await p.evaluate(()=>{document.querySelector('#device').style.setProperty('--safe-b','24px');__wos.setFull('wmain',true);});await p.waitForTimeout(400);
   const corner=await p.evaluate(()=>({bottom:document.querySelector('.ch-focus-strip').getBoundingClientRect().bottom,orbTop:document.querySelector('#orbWrap').getBoundingClientRect().top,corner:document.querySelector('#device').classList.contains('orb-corner')}));
   ok(corner.corner&&corner.bottom<=corner.orbTop,'phone fullscreen strip respects safe area and corner orb',corner);
   await p.evaluate(()=>{document.querySelector('#device').style.removeProperty('--safe-b');__wos.setFull('wmain',false);});await p.waitForTimeout(400);
   await p.locator('[data-chfbtn]:visible').click();await capture(p,'phone-nebula-filter');
   await activate(p,'.ch-fcard [data-chfocusopt="agent:philosopher"]');await capture(p,'phone-nebula-philosopher');
  }
  await choose(p,'space:reading');
  await p.locator('[data-chopen="main_phil"]:visible').dispatchEvent('contextmenu');
  ok(await p.locator('[data-rsspace="reading"]').innerText().then(t=>t.includes('Remove from Space')),mode+' existing context menu offers Remove from Space');
  await p.locator('[data-rsspace="reading"]').click();await p.waitForTimeout(80);
  ok(JSON.stringify(await ids(p))===JSON.stringify([])&&!sharedSpaces.find(s=>s.id==='reading').threads.includes('main_phil'),mode+' remove membership PUT and visible filter');
  await choose(p,'all:');await p.locator('[data-chopen="main_phil"]:visible').dispatchEvent('contextmenu');
  await activate(p,'[data-rsspacepicker]');await activate(p,'[data-spspace="reading"]');await p.waitForTimeout(80);
  ok(sharedSpaces.find(s=>s.id==='reading').threads.includes('main_phil'),mode+' context menu Add to Space syncs');
  await choose(p,'space:reading');
  const prefsBefore=writes.filter(w=>w.path==='/wizard/v1/ui-preferences').length;
  await p.evaluate(async()=>{
    const a=window.__wos||window.__wux,w=Object.values(a.wins).find(w=>w.app==='chats');
    // Fence transport at the actual durable enqueue boundary: no real run or thread is created.
    const original=WosOutbox.enqueue;WosOutbox.enqueue=async o=>({id:'fixture-enqueue',sessionId:'wizard_space_new',kind:'new',durable:true,state:'queued'});
    try { a.chats.openChat(w.id,'__new__');await a.chats.sendChat(w.id,'fixture Space message','send'); } finally {WosOutbox.enqueue=original;}
  });await p.waitForTimeout(150);
  ok(sharedSpaces.find(s=>s.id==='reading').threads.includes('wizard_space_new')&&writes.filter(w=>w.path==='/wizard/v1/ui-preferences').length>prefsBefore,mode+' new chat inherits Space through prefs PUT');
  await p.evaluate(()=>{const a=window.__wos||window.__wux;if(window.__wos)a.onBack();else a.escStep();});
  const savedRows=rows.splice(0);await p.evaluate(async()=>{const a=window.__wos||window.__wux;if(window.__wos)a.onBack();else a.escStep();await a.live.refresh();a.live.emit();});await p.waitForTimeout(250);
  ok(await p.locator('.ch-focus-strip:visible [data-chfocusopt]').count()===5,mode+' empty lists retain agent tabs, never Space tabs');rows.push(...savedRows);
  await p.evaluate(()=>{const a=window.__wos||window.__wux,w=Object.values(a.wins).find(w=>w.app==='chats');a.chats.setFocus(w,{kind:'space',key:'reading'});});sharedSpaces=sharedSpaces.filter(s=>s.id!=='reading');
  await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await p.waitForTimeout(200);
  ok((await activeFocus(p))==='All',mode+' deleted Space focus migrates to All on preference sync');
  await ctx.close();
  for(const legacy of ['both','only','subject']){
   const {ctx:lc,p:lp}=await boot(b,desktop,legacy);
   ok(await lp.evaluate(({legacy})=>{const a=window.__wos||window.__wux,cs=Object.values(a.wins).filter(w=>w.app==='chats');return cs.length===1&&!cs[0].agent&&(legacy==='only'?cs[0].focus?.key==='philosopher':legacy==='subject'?!cs[0].focus:cs[0].id==='wmain');},{legacy}),mode+' legacy '+legacy+' migration');
   await lc.close();
  }
 }
 ok(writes.slice(navigationAt).filter(w=>/\/v1\/runs$/.test(w.path)).length===0,'zero /v1/runs during navigation');
 await sectionMatrix(b);
 await archivedUnreadMatrix(b);
 await routingMatrix(b);
 ok(errors.length===0,'no page errors',errors);
 }finally{await b.close();}
 console.log(`${pass} passed, ${fail} failed; intercepted writes ${writes.length}`);process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=2;});
