// James's rare thread Back regression. Run the real shell with delayed fixture reads;
// run exact history bridge source with deferred traversal callbacks (no wall-clock sleeps).
// All writes intercepted. Browser execution belongs on Thales.
let pw; try { pw = require('playwright-core'); } catch (_) { pw = require(process.env.PW || 'playwright'); }
const { chromium } = pw, fs = require('fs'), path = require('path'), vm = require('vm');
const WEB = process.env.QA_WEB_DIR || __dirname;
const URL_ = process.argv[2] || 'http://127.0.0.1:9440/wizard-os-home/';
let pass=0, fail=0; const ok=(yes,label,data)=>{if(yes)pass++;else fail++;console.log(yes?'PASS':'FAIL',label,yes?'':JSON.stringify(data));};
const source=fs.readFileSync(path.join(WEB,'web/app.js'),'utf8');
function fn(name) { const start=source.indexOf('  function '+name+'('); let at=source.indexOf('{',start), depth=0, quote='',escape=false,line=false,block=false; for(let i=at;i<source.length;i++){const c=source[i],next=source[i+1];if(line){if(c==='\n')line=false;continue;}if(block){if(c==='*'&&next==='/'){block=false;i++;}continue;}if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote='';continue;}if(c==='/'&&next==='/'){line=true;i++;continue;}if(c==='/'&&next==='*'){block=true;i++;continue;}if(c==='"'||c==="'"||c==='`'){quote=c;continue;}if(c==='{')depth++;if(c==='}'&&!--depth)return source.slice(start,i+1);}throw Error('extract '+name); }
function historyCase(delay,navAvailable=true,noop=false) {
  let now=0, calls=0, guards=0, entries=[{key:'root',index:0},{key:'nested',index:1}], current=noop?entries[0]:entries[1];
  const handlers={}; const doc={addEventListener(){},querySelector(){return null;}};
  const win={document:doc, navigator:{userActivation:{isActive:false}},location:{pathname:'/qa-preview/',search:'',href:'https://qa/qa-preview/#nested'},__wosHref:'https://qa/qa-preview/#nested',history:{back(){},go(){},pushState(){},replaceState(){}},addEventListener(t,cb){handlers[t]=cb;}};
  if(navAvailable)win.navigation={entries:()=>entries,get currentEntry(){return current;}};
  const frame={isConnected:true,closest:()=>({dataset:{win:'frame'}}),contentWindow:win};
  const sandbox={Date:{now:()=>now},W:{frame:{app:'frame',appId:'qa-preview'}},APP:{'qa-preview':{url:'/qa-preview/'}},LINKS:null,window:{WizAppServices:{inspect(){return []}}},desks:[{focus:'chats',wins:['chats']},{focus:'frame',wins:['frame']}],idx:0,deskOf:()=>1,armWatcher(){},armBack(){},tamePinch(){},armFrameBack(){},shareCutout(){},frameEdge(){},dropUntil:0,ignorePop:0,guardOn:false,sheet:null,menuFor:null,V:{state:'idle'},document:{querySelector(){return null;}},history:{state:{wos:'guard'}},onBack(){calls++;},ensureGuard(){guards++;},exitUntil:0,setTimeout(){},console};
  vm.createContext(sandbox);vm.runInContext(['tameHistory','selfPop','takeSelfPop','bridgeFrame'].map(fn).join('\n')+'; this.setup=()=>{tameHistory(this.win); bridgeFrame(this.frame);};',sandbox);sandbox.win=win;sandbox.frame=frame;sandbox.setup();
  win.history.back(); now=delay; current=entries[0]; win.location.href='https://qa/qa-preview/';
  handlers.popstate({stopImmediatePropagation(){},state:{__wizardApp:{version:1}}});
  return {get calls(){return calls;},get guards(){return guards;},win,frame,handlers,setCurrent:e=>{current=e;}};
}
for(const delay of [799,801,5000]) {const r=historyCase(delay);ok(r.calls===0,`off-screen app-owned history Back after ${delay} ms never backs the visible thread`,{calls:r.calls});}
{const r=historyCase(5000,false);ok(r.calls===0,'older-browser traversal ownership survives delayed dispatch',{calls:r.calls});}
{const r=historyCase(5000,true,true);ok(r.calls===1,'no-op app history Back leaves the next user Back available',{calls:r.calls});}
{const r=historyCase(5000);r.handlers.popstate({stopImmediatePropagation(){},state:{}});ok(r.calls===1,'app-owned traversal consumed once; next user Back takes one shell step',{calls:r.calls});}
{const r=historyCase(5000);r.frame.isConnected=false;r.handlers.popstate({stopImmediatePropagation(){},state:{}});ok(r.calls===0,'detached preview cannot take a shell Back step',{calls:r.calls});}
(async()=>{
const b=await chromium.launch({executablePath:process.env.QA_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const ctx=await b.newContext({viewport:{width:412,height:892},hasTouch:true,isMobile:true,ignoreHTTPSErrors:true,serviceWorkers:'block'});
const pending=new Map(), writes=[], errors=[],requested=[]; const now=Date.now()/1000;
const sessions=['qa_race_a','qa_race_b','qa_race_c'].map((id,i)=>({id,source:'wizard-mobile',title:'Back race '+id,status:'completed',message_count:2,started_at:now-600,last_active:now-i,wizard_last_assistant_at:now-i,latest_message:{role:'assistant',content:'Transcript '+id,timestamp:now-i}}));
let gateA=true;
await ctx.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());const json=body=>r.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return json({ok:true});}
 if(u.pathname==='/qa-back-preview/')return r.fulfill({contentType:'text/html',body:'<!doctype html><title>Back timing fixture</title><p>Preview</p>'});
 const m=u.pathname.match(/^\/wizard-os-home\/((?:core\/|desktop\/)?[a-z-]+\.(?:js|css)|index\.html|desktop\.html|)$/);if(m&&!process.env.QA_LIVE&&!/^(data|summaries)\.js$/.test(m[1])){const file=path.join(WEB,'web',m[1]||'index.html');if(fs.existsSync(file))return r.fulfill({contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/javascript',body:fs.readFileSync(file)});}
 if(u.pathname==='/wizard/hermes/api/sessions')return json({data:sessions,pagination:{total:sessions.length,limit:500,offset:0,returned:sessions.length}});
 const mm=u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/(qa_race_[abc])\/messages$/);if(mm){const sid=mm[1];requested.push(sid);if(sid==='qa_race_a'&&gateA)await new Promise(resolve=>pending.set(sid,resolve));return json({data:[{id:1,role:'user',content:'Read '+sid,timestamp:now-60,session_id:sid},{id:2,role:'assistant',content:'Transcript '+sid+(sid==='qa_race_c'?' [Preview](/qa-back-preview/)':''),timestamp:now-30,session_id:sid}],pagination:{limit:500,offset:0,returned:2}});}
 const sm=u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/(qa_race_[abc])$/);if(sm)return json({session:sessions.find(x=>x.id===sm[1])});
 return r.continue();});
const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));await p.addInitScript(()=>{try{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.rvCoached','true');}catch(_){} });
try {
 await p.goto(URL_,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__wos?.live?.session('qa_race_a'),null,{timeout:45000});
 const state=()=>p.evaluate(()=>{const w=Object.values(__wos.wins).find(w=>w.app==='chats'),c=__wos.chatState(w.id);return {thread:w.thread,loading:!!c.loading,loadedFor:c.loadedFor,turns:JSON.stringify(c.turns),idx:__wos.idx,text:document.querySelector(`[data-chats="${w.id}"]`)?.textContent};});
 const open=sid=>p.evaluate(id=>__wos.openWizardThread(id),sid);
 await open('qa_race_a');await p.waitForTimeout(250);ok(pending.has('qa_race_a'),'thread A read is outstanding before navigation');
 await open('qa_race_b');await p.waitForTimeout(750);let s=await state();ok(s.thread==='qa_race_b'&&s.loadedFor==='qa_race_b'&&s.text.includes('Transcript qa_race_b'),'destination thread loads while old thread A is still outstanding',s);
 gateA=false;pending.get('qa_race_a')?.();pending.delete('qa_race_a');await p.waitForTimeout(700);s=await state();ok(s.thread==='qa_race_b'&&s.loadedFor==='qa_race_b'&&!s.text.includes('Transcript qa_race_a'),'late A response cannot paint B or attach A preview',s);
 // A -> B -> A must not revive the first A generation or release the newer read lock.
 gateA=true;await p.evaluate(()=>{const w=Object.values(__wos.wins).find(w=>w.app==='chats');__wos.chatState(w.id).loadedFor='';});await open('qa_race_a');await p.waitForTimeout(200);const oldA=pending.get('qa_race_a');pending.delete('qa_race_a');await open('qa_race_c');await open('qa_race_a');await p.waitForTimeout(400);const newA=pending.get('qa_race_a');ok(!!oldA&&!!newA&&oldA!==newA,'reopening A starts a new independent read generation');oldA?.();await p.waitForTimeout(400);s=await state();ok(s.thread==='qa_race_a'&&s.loading&&s.loadedFor!=='qa_race_a','old A generation cannot unlock or publish into reopened A',s);gateA=false;newA?.();pending.delete('qa_race_a');await p.waitForTimeout(650);s=await state();ok(s.loadedFor==='qa_race_a'&&!s.loading,'new A generation finishes normally',s);
 gateA=true;await p.evaluate(()=>{const w=Object.values(__wos.wins).find(w=>w.app==='chats');__wos.chatState(w.id).loadedFor='';__wos.chats.loadThread(w,true);});await p.waitForTimeout(250);await p.evaluate(()=>__wosNativeBack());const listBefore=await state();gateA=false;pending.get('qa_race_a')?.();pending.delete('qa_race_a');await p.waitForTimeout(700);s=await state();ok(s.thread===null&&s.idx===listBefore.idx&&!s.text.includes('Transcript qa_race_a'),'Back to list stays there after late thread response',s);
 await p.evaluate(()=>__wosNativeBack());await p.evaluate(()=>__wosNativeBack());ok(await p.evaluate(()=>!!__wos&&document.visibilityState==='visible'),'nested and root Back leave Wizard open');
 await open('qa_race_c');await p.waitForFunction(()=>document.querySelector('iframe[src="/qa-back-preview/"]')?.contentWindow?.__wosTamed);await p.waitForTimeout(300);
 const frame=p.frames().find(f=>f.url().includes('/qa-back-preview/'));
 await frame.evaluate(()=>{history.pushState({__wizardApp:{version:1}},'', '#nested');history.back();const until=performance.now()+1300;while(performance.now()<until){};});await p.waitForTimeout(500);s=await state();
 ok(s.thread==='qa_race_c'&&s.text.includes('Transcript qa_race_c'),'REAL delayed background iframe traversal does not navigate the visible thread',s);
 await p.evaluate(()=>__wosNativeBack());await p.waitForTimeout(300);s=await state();ok(s.thread===null&&await p.evaluate(()=>!!__wos&&document.visibilityState==='visible'),'one subsequent native Back returns to list, Wizard stays open',s);
 ok(!errors.length,'zero browser page errors',errors);ok(!writes.some(x=>/v1\/runs/.test(x)),'zero sends to Archimedes',writes);
} catch(e){ok(false,'browser regression execution',String(e.stack||e));}
finally{for(const resolve of pending.values())resolve();await b.close();}
console.log(`thread-back-race: ${pass} passed, ${fail} failed`);process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
