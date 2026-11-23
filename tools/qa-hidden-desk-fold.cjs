// AI apps desktop (wizard-ux issue 1742): folding the chats sidebar leaves desks out of sight where they are.
// Serve the shell first: node tools/qa-origin.cjs 9381. Fixture/boot copied from qa/scripts/qa-ai-apps-agent-focus.cjs.
// All Wizard reads are fixtures; every write is intercepted; navigation must create zero runs.
const { chromium } = require('./qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const origin = process.argv[2] || 'http://127.0.0.1:9381/wizard-os-home/';
const OUT = process.env.QA_OUT || require('./qa-paths.cjs').workPath('hidden-desk-fold');
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
   const wins={wmain:{id:'wmain',app:'chats',thread:null},w2:{id:'w2',app:'chats',agent:'philosopher',thread:null}}, ds=[{id:'home',home:true,wins:[],focus:null},{id:'dmain',wins:['wmain'],focus:'wmain'},{id:'d2',wins:['w2'],focus:'w2'}];
   if(legacy==='subject'){wins.wmain.focus={kind:'subject',key:'Philosophy'};}
   else if (legacy) { wins.wlegacy={id:'wlegacy',app:'chats',agent:'philosopher',thread:null};ds.push({id:'dlegacy',wins:['wlegacy'],focus:'wlegacy'}); if(legacy==='only'){delete wins.wmain;ds.splice(1,1);} }
   if(desktop){localStorage.setItem('wux.desk.wins',JSON.stringify(wins));localStorage.setItem('wux.desk.ws',JSON.stringify(ds.slice(1)));localStorage.setItem('wux.desk.cur','0');localStorage.setItem('wux.desk.homeOpen','false');}
   else {localStorage.setItem('wos.wins4',JSON.stringify(wins));localStorage.setItem('wos.strip',JSON.stringify(ds));localStorage.setItem('wos.idx4','1');localStorage.setItem('wos.idxDesk',JSON.stringify(ds[1].id));}
  }
 },{desktop,legacy,skin});
 const p=await ctx.newPage();p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(/layout|error/i.test(m.type()+m.text()))consoleLog.push(m.type()+': '+m.text().slice(0,400));});
 await p.goto(new URL('desktop.html',origin).href,{waitUntil:'domcontentloaded'});
 await p.waitForTimeout(800); return {ctx,p};
}
(async () => {
  const b = await chromium.launch();
  try {
    const { p } = await boot(b, true);
    await p.waitForFunction(() => document.documentElement.dataset.aiApps === 'desktop', null, { timeout: 25000 });
    await p.waitForTimeout(1500);
    await p.evaluate(() => { __wux.newDesktop(); __wux.newWin('chats'); }); await p.waitForTimeout(500);
    await p.evaluate(() => __wux.goWs(0)); await p.waitForTimeout(800);
    const m = () => p.evaluate(() => ({ side: document.documentElement.dataset.aadSide,
      desks: [...document.querySelectorAll('#stage > .wsp')].map(e => ({ hidden: e.hidden, role: e.dataset.aadRole || '', left: getComputedStyle(e).left, right: getComputedStyle(e).right })) }));
    const hid = s => s.desks.filter(d => d.hidden && !d.role).map(d => d.left + '/' + d.right);
    const a = await m(); console.log('open  ', JSON.stringify(a));
    await p.screenshot({ path: path.join(OUT, 'open.png') });
    ok(a.side === 'open' && hid(a).length === 1, 'sidebar open, one desk out of sight', a);
    await p.click('.aad-tog'); await p.waitForTimeout(800);
    const c = await m(); console.log('folded', JSON.stringify(c));
    await p.screenshot({ path: path.join(OUT, 'folded.png') });
    ok(c.side === 'rail', 'sidebar folded', c);
    ok(JSON.stringify(hid(a)) === JSON.stringify(hid(c)), 'the desk out of sight keeps its left/right edges', { before: hid(a), after: hid(c) });
    const shown = c.desks.find(d => !d.hidden && !d.role);
    await p.evaluate(() => __wux.goWs(1)); await p.waitForTimeout(800);
    const e = await m(); const now = e.desks.find(d => !d.hidden && !d.role);
    ok(now && shown && now.left === shown.left && now.right === shown.right, 'a desk coming into view takes the folded geometry', { shown, now });
  } finally { await b.close(); }
  console.log(pass + ' pass, ' + fail + ' fail; shots in ' + OUT);
  process.exit(fail ? 1 : 0);
})();
