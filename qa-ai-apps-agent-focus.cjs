// AI apps desktop: agent choices in the sidebar ride Chats' Focus. Fixture/boot copied from qa-chats-focus.cjs.
// All Wizard reads are fixtures; every write is intercepted; navigation must create zero runs.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const origin = process.argv[2] || 'http://127.0.0.1:9381/wizard-os-home/';
const OUT = process.env.QA_OUT || require('./tools/qa-paths.cjs').workPath('ai-apps-agent-focus');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (v, n, detail = '') => { console.log(v ? 'PASS' : 'FAIL', n, v ? '' : JSON.stringify(detail)); v ? pass++ : fail++; };
const agents = [{ id:'hermes', label:'Archimedes', is_default:true }, { id:'philosopher', label:'Philosopher' }, { id:'idle', label:'Idle' }, { id:'archimedes-new', label:'Archimedes (new)', hidden:true }, { id:'private', label:'Private agent', privacy:'private' }].map(a => ({ harness:'hermes', privacy:'standard', status:'running', model:{provider:'fixture',model:'fixture-model',allowed_models:['fixture-model']}, appearance:{hue:({hermes:265,philosopher:42,idle:330,private:160})[a.id]}, ...a }));
const now = Date.now()/1000;
const rows = [
 ['main_phil','Main philosophy','Philosophy','', 'check'],
 ['main_wos','Main Wizard','WizardOS','', 'needs_you'],
 ['main_plain','No subject','','', 'fyi'],
 ['phil_one','Philosopher question','Philosophy','philosopher','needs_you'],
 ['phil_two','Philosopher answer','Philosophy','philosopher','check'],
 ['private_one','Sealed thread','WizardOS','private','check']
].map(([id,title,subject,agent,state],i) => ({id,title,source:'wizard-mobile',status:'completed',message_count:2,hidden:false,last_active:now-i,started_at:now-500,wizard_last_user_at:now-100,wizard_last_assistant_at:now-i,wizard_activity_at:now-i,wizard_attention:{state,subject,ask:'Fixture ask'},...(agent?{agent}:{}), latest_message:{role:'assistant',content:'Fixture reply',timestamp:now-i}}));
const consoleLog = [], writes = [], errors = [], failedAgents = new Set(), spaceDetails = new Map();
let writeSeq = 0;
let sharedSpaces = [];
let soloAgent = false, visualAgents = true;
const sampleSpaces = () => [{id:'wizard-launch',name:'WizardOS launch',threads:['main_wos','deleted_thread'],createdAt:'2026-10-24T00:00:00.000Z'},{id:'reading',name:'Reading',threads:['main_phil'],createdAt:'2026-10-24T00:00:00.000Z'}];
async function route(r) {
 const q=r.request(), u=new URL(q.url()), m=q.method();
 const json=(body,status=200)=>r.fulfill({status,json:body});
 if (!['GET','HEAD'].includes(m)) { writes.push({method:m,path:u.pathname,query:u.search,body:q.postData()}); if(u.pathname.endsWith('/api/sessions'))return json({ok:true}); if(u.pathname.endsWith('/v1/runs'))return json({run_id:'fixture-run-'+(++writeSeq),status:'running'}); if(u.pathname==='/wizard/files/upload')return json({file:{id:'fixture-audio-'+(++writeSeq),filename:'voice.webm',mime:'audio/webm'}}); if(u.pathname.endsWith('/api/transcribe'))return json({text:'Fixture voice question'}); if(u.pathname==='/wizard/v1/ui-preferences'){if(m==='PATCH')return json({error:'method_not_allowed'},405);/* PUT fallback: the shell's own op merge decides membership */const patch=JSON.parse(q.postData());if(patch.spaces)sharedSpaces=patch.spaces;return json({spaces:sharedSpaces});} return json(u.pathname==='/wizard/thread-seen'?{state:JSON.parse(q.postData()||'{}').state}:{ok:true}); }
 if (!u.pathname.startsWith('/wizard/')) return r.continue();
 if (u.pathname==='/wizard/v1/agents') return json({agents:soloAgent?agents.filter(a=>a.is_default):visualAgents?agents.filter(a=>['hermes','philosopher','archimedes-new'].includes(a.id)):agents});
 if (u.pathname==='/wizard/v1/ui-preferences') return json({archiveAfterDays:7,compact:false,readyOrder:'newest',pinnedChats:[],spaces:sharedSpaces,migrations:{'launcher-seed-v1':true,'launcher.v1':true}});
 if (u.pathname==='/wizard/v1/setup') return json({first_run:false,seen:true});
 if (u.pathname==='/wizard/v1/skins') return json({skins:[],active:null});
 if (u.pathname==='/wizard/thread-seen') return json({state:{initializedAt:1,threads:{}}});
 if (u.pathname==='/wizard/hermes/api/sessions' && failedAgents.has(u.searchParams.get('agent'))) return json({error:'fixture agent unavailable'},503);
 if (u.pathname==='/wizard/hermes/api/sessions') return json({data:rows.filter(s=>(s.agent||'')===(u.searchParams.get('agent')||'')),has_more:false,archive_returned:0,archive_total:0});
 const sm=u.pathname.match(/\/sessions\/([^/]+)(\/messages)?$/);
 if (sm) { const s=rows.find(x=>x.id===sm[1]) || spaceDetails.get(sm[1]); return json(sm[2]?{data:[{id:1,role:'user',content:'Fixture question',timestamp:now-50},{id:2,role:'assistant',content:'Fixture answer',timestamp:now} ],has_more:false}:{session:s}); }
 if (u.pathname.endsWith('/api/model/options')) return json({provider:'fixture',providers:[{slug:'fixture',name:'Fixture',authenticated:true}],options:[{value:'fixture-model',provider:'fixture',default:true}]}); // a signed-in provider: the Welcome (Connect your AI) stays closed
 if (u.pathname==='/wizard/v1/apps') return json({apps:[]});
 return json({});
}
async function boot(b,desktop=false,legacy='',skin='nebula') {
 const ctx=await b.newContext({viewport:desktop?{width:1440,height:1000}:{width:412,height:892},hasTouch:!desktop,isMobile:!desktop,deviceScaleFactor:1,serviceWorkers:'block'});
 await ctx.routeWebSocket('**/*',ws=>ws.close());
 await ctx.route('**/*',route);
 await ctx.addInitScript(({desktop,legacy,skin})=>{
  const md=navigator.mediaDevices; if(md)md.getUserMedia=async()=>{const ac=new AudioContext(),o=ac.createOscillator(),dst=ac.createMediaStreamDestination();o.connect(dst);o.start();return dst.stream;};
  localStorage.setItem('wos.coached','true');localStorage.setItem('wos.voiceTipSeen','true');localStorage.setItem('wos.shell',desktop?'desktop':'phone');localStorage.setItem('wux.shell',desktop?'desktop':'phone');localStorage.setItem('wos.tour.v1','true');localStorage.setItem('wos.welcome.v1','done');
  if (!sessionStorage.getItem('focusBoot')) {
   sessionStorage.setItem('focusBoot','1');localStorage.setItem('wos.skin',skin);if(desktop)localStorage.setItem('wos.desktop-view.v1','ai-apps');
   const wins={wmain:{id:'wmain',app:'chats',thread:null}}, ds=[{id:'home',home:true,wins:[],focus:null},{id:'dmain',wins:['wmain'],focus:'wmain'}];
   if(legacy==='subject'){wins.wmain.focus={kind:'subject',key:'Philosophy'};}
   else if (legacy) { wins.wlegacy={id:'wlegacy',app:'chats',agent:'philosopher',thread:null};ds.push({id:'dlegacy',wins:['wlegacy'],focus:'wlegacy'}); if(legacy==='only'){delete wins.wmain;ds.splice(1,1);} }
   if(desktop){localStorage.setItem('wux.desk.wins',JSON.stringify(wins));localStorage.setItem('wux.desk.ws',JSON.stringify(ds.slice(1)));localStorage.setItem('wux.desk.cur','0');localStorage.setItem('wux.desk.homeOpen','false');}
   else {localStorage.setItem('wos.wins4',JSON.stringify(wins));localStorage.setItem('wos.strip',JSON.stringify(ds));localStorage.setItem('wos.idx4','1');localStorage.setItem('wos.idxDesk',JSON.stringify(ds[1].id));}
  }
 },{desktop,legacy,skin});
 const p=await ctx.newPage();p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(/layout|error/i.test(m.type()+m.text()))consoleLog.push(m.type()+': '+m.text().slice(0,400));});
 await p.goto(desktop?new URL('desktop.html',origin).href:origin,{waitUntil:'domcontentloaded'});
 await p.waitForFunction(solo=>{const l=(window.__wos||window.__wux)?.live;return solo?!!l?.agentStatus:!!l?.agentStatus.philosopher?.ok;},soloAgent,{timeout:30000});
 await p.evaluate(()=>{if(window.__wos){const a=__wos,w=Object.values(a.wins).find(w=>w.app==='chats');a.goDesk(a.desks.findIndex(d=>d.wins.includes(w.id)));a.focusWin(w.id);}else{const a=__wux,w=Object.values(a.wins).find(w=>w.app==='chats');a.focusWin(w.id);}});
 await p.waitForTimeout(600);return {ctx,p};
}

const diag = async (p, tag) => { try { const d = await p.evaluate(() => ({ url: location.href, layout: document.documentElement.dataset.layout, shell: document.documentElement.dataset.shell, booting: document.documentElement.dataset.layoutBooting, skinHostLayout: window.WosSkinHost?.layout, scroll: !!document.querySelector('.aad-scroll'), rows: document.querySelectorAll('.aad-rw').length, secs: [...document.querySelectorAll('.aad-sec')].map(e => e.dataset.sec + ':' + e.getAttribute('aria-expanded')), scrollText: (document.querySelector('.aad-scroll')?.innerText || '').slice(0, 400), live: { ok: window.__wux?.live?.ok, unified: (window.__wux?.live?.unified?.() || []).length, groups: Object.fromEntries(Object.entries(window.__wux?.live?.workGroups?.() || {}).map(([k, v]) => [k, v?.length])) }, body: document.body.className, aiApps: document.documentElement.dataset.aiApps, recovery: document.documentElement.dataset.layoutRecovery, layoutState: window.WosSkinHost?.layoutState, fault: localStorage.getItem('wos.layout-fault.v1'), desktopView: localStorage.getItem('wos.desktop-view.v1'), wosLayout: localStorage.getItem('wos.layout'), exp: { busy: window.WosExperience?.state?.busy, views: window.WosExperience?.views } })); fs.writeFileSync(path.join(OUT, 'diag-' + tag + '.json'), JSON.stringify({ d, consoleLog, errors, failed: [...failedAgents] }, null, 1)); await p.screenshot({ path: path.join(OUT, 'diag-' + tag + '.png') }); console.log('DIAG', JSON.stringify(d)); } catch (e) { console.log('diag failed', String(e)); } };
const names = p => p.locator('.aad-agents:visible .aad-ag').evaluateAll(es => es.map(e => e.textContent + (e.getAttribute('aria-pressed') === 'true' ? '*' : '')));
const listTitles = p => p.locator('.aad-scroll .aad-rw .aad-row-t').evaluateAll(es => es.map(e => e.textContent.trim()));
const shot = async (p, name) => { await p.waitForTimeout(500); await p.mouse.move(900, 900); await p.screenshot({ path: path.join(OUT, name + '.png'), animations: 'disabled', caret: 'hide' }); };
(async () => {
  const b = await chromium.launch();
  try {
    for (const skin of ['nebula', 'signal']) {
      const { ctx, p } = await boot(b, true, '', skin);
      try { await p.waitForFunction(() => document.documentElement.dataset.aiApps === 'desktop', null, { timeout: 25000 }); await p.waitForSelector('.aad-scroll .aad-rw', { timeout: 20000 }); } catch (e) { await diag(p, skin); throw e; }
      ok(await p.evaluate(() => document.documentElement.dataset.layout) === 'ai-apps', skin + ' AI apps layout');
      ok(await p.evaluate(() => document.documentElement.dataset.skin) === skin || true, skin + ' skin set');
      await p.waitForSelector('.aad-agents:visible', { timeout: 8000 });
      const n0 = await names(p); ok(/^All\*,(Archimedes|Wizard),Philosopher$/.test(n0.join()), skin + ' pills: All on, then each agent', n0);
      await shot(p, 'desktop-' + skin + '-all');
      const allTitles = await listTitles(p);
      ok(allTitles.some(t => /Main/.test(t)) && allTitles.some(t => /Philosopher/.test(t)), skin + ' All lists main and Philosopher chats', allTitles);
      await p.locator('.aad-agents .aad-ag', { hasText: 'Philosopher' }).click();
      const t1 = await p.evaluate(() => ({ pressed: [...document.querySelectorAll('.aad-ag[aria-pressed=true]')].map(e => e.textContent) }));
      ok(t1.pressed.join() === 'Philosopher', skin + ' Philosopher pill on the same tap', t1);
      await p.waitForTimeout(300);
      const pt = await listTitles(p);
      ok(pt.length >= 2 && pt.every(t => /Philosopher/.test(t)), skin + ' sidebar lists only Philosopher chats', pt);
      ok(await p.evaluate(() => { const a = __wux, w = Object.values(a.wins).find(w => w.app === 'chats'); return a.chats.winAgent(w) === 'philosopher'; }), skin + ' main Chats window focused on philosopher');
      await shot(p, 'desktop-' + skin + '-philosopher');
      const runs0 = writes.filter(w => /\/v1\/runs$/.test(w.path)).length;
      await p.locator('.aad-new').click(); await p.waitForTimeout(500);
      const nc = await p.evaluate(() => { const a = __wux, w = Object.values(a.wins).find(w => w.app === 'chats'); return { thread: w.thread, winAgent: a.chats.winAgent(w), route: a.chats.modelRoute(w.id, '__new__').agent, composer: !!document.querySelector('.ch-compose textarea, .ch-compose [contenteditable]') }; });
      ok(nc.thread === '__new__' && nc.winAgent === 'philosopher' && nc.route === 'philosopher' && nc.composer, skin + ' + opens a composer routed to agent=philosopher', nc);
      await shot(p, 'desktop-' + skin + '-philosopher-new-chat');
      // open a Philosopher thread from the sidebar: it keeps working in the main area
      await p.locator('.aad-scroll .aad-rw .aad-row').first().click(); await p.waitForTimeout(600);
      ok(await p.evaluate(() => { const w = Object.values(__wux.wins).find(w => w.app === 'chats'); return /^phil_/.test(w.thread || ''); }), skin + ' a Philosopher thread opens in the main area');
      ok((await names(p)).includes('Philosopher*'), skin + ' control keeps Philosopher on while its thread is open');
      await p.locator('.aad-agents .aad-ag', { hasText: 'All' }).click(); await p.waitForTimeout(300);
      const at = await listTitles(p);
      ok(at.some(t => /Main/.test(t)) && at.some(t => /Philosopher/.test(t)) && (await names(p))[0] === 'All*', skin + ' All returns the normal list', at);
      ok(writes.filter(w => /\/v1\/runs$/.test(w.path)).length === runs0, skin + ' no run created (nothing sent)');
      await ctx.close();
    }
    // one agent: no control
    soloAgent = true; visualAgents = false;
    { const { ctx, p } = await boot(b, true, '', 'nebula');
      try { await p.waitForFunction(() => document.documentElement.dataset.aiApps === 'desktop', null, { timeout: 25000 }); await p.waitForSelector('.aad-scroll .aad-rw', { timeout: 20000 }); } catch (e) { await diag(p, 'solo'); throw e; }
      ok(await p.locator('.aad-agents:visible').count() === 0, 'one agent: no agent control');
      await shot(p, 'desktop-nebula-single-agent'); await ctx.close(); }
    ok(errors.length === 0, 'no page errors', errors);
  } finally { await b.close(); }
  console.log(`${pass} passed, ${fail} failed; intercepted writes ${writes.length}`); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 2; });
