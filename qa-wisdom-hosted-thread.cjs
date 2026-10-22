// Run on Thales. Wisdom's Ask AI opens the real Chats thread over the Wisdom window.
// Candidate shell + Wisdom assets over the live entry URL; every mutation is intercepted (never sent).
// Env: QA_URL (…/wizard-os-home/), QA_WEB_DIR (shell repo), QA_WISDOM_DIR (Wisdom repo), QA_OUT, QA_FIXTURE (json {sid,did,reply}).
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('./tools/qa-playwright.cjs');
const ROOT=process.env.QA_WEB_DIR||__dirname,WIS=process.env.QA_WISDOM_DIR,BASE=process.env.QA_URL,OUT=process.env.QA_OUT;
const FX=JSON.parse(fs.readFileSync(process.env.QA_FIXTURE,'utf8'));
const checks=[];fs.mkdirSync(OUT,{recursive:true});
function ok(name,v,d){checks.push({name,pass:!!v,detail:d});console.log(v?'PASS':'FAIL',name,JSON.stringify(d===undefined?'':d).slice(0,600));}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const TYPES={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
async function run(browser,mobile){
 const label=mobile?'phone':'desktop',sid=FX.sid,did=FX.did;
 const ctx=await browser.newContext({viewport:mobile?{width:412,height:892}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,ignoreHTTPSErrors:true,permissions:['microphone']});
 const writes=[],errors=[],served=[];let started=false;
 const json=(r,x,s=200)=>r.fulfill({status:s,contentType:'application/json',body:JSON.stringify(x)});
 await ctx.route('**/*',async r=>{
  const q=r.request(),u=new URL(q.url());
  if(!['GET','HEAD'].includes(q.method())){
   let body=null;try{body=/json/.test(q.headers()['content-type']||'')?q.postDataJSON():{bytes:q.postDataBuffer()?.length||0};}catch(_){}
   writes.push({path:u.pathname,body});
   if(u.pathname===`/wisdom/api/discussions/${did}/thread`)return json(r,{session_id:sid,title:'Wisdom · QA',started,reply:started?null:FX.reply});
   if(/\/transcribe$/.test(u.pathname))return json(r,{text:'spoken question about the floating man',ms:1});
   if(/\/v1\/runs$/.test(u.pathname))return json(r,{run_id:'qa-run',status:'queued'},202);
   if(/\/route$/.test(u.pathname))return json(r,{cmd:{route:'agent'},ms:1});
   return json(r,{accepted:true});
  }
  if(u.pathname==='/wizard/thread-seen')return json(r,{state:{initializedAt:Date.now(),threads:{}}});
  for(const[prefix,dir]of[['/wizard-os-home/',path.join(ROOT,'web')],['/wisdom/',WIS&&path.join(WIS,'static')]]){
   if(!dir||!u.pathname.startsWith(prefix)||u.pathname.slice(prefix.length).startsWith('api/'))continue;
   const p=path.resolve(dir,u.pathname.slice(prefix.length)||'index.html');
   if(p.startsWith(dir+path.sep)&&fs.existsSync(p)&&fs.statSync(p).isFile()&&prefix==='/wizard-os-home/'||p.startsWith(dir+path.sep)&&/discussions\.js$/.test(p)){served.push(prefix+path.relative(dir,p));return r.fulfill({status:200,contentType:TYPES[path.extname(p)]||'application/octet-stream',body:fs.readFileSync(p)});}
  }
  return r.continue();
 });
 await ctx.addInitScript(()=>{if(window!==top)return;localStorage.setItem('wos.coached','true');localStorage.setItem('wos.voiceTipSeen','true');});
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));const cons=[];p.on('console',m=>{if(['warning','error'].includes(m.type()))cons.push(m.text().slice(0,300));});
 await p.goto(BASE+'?open=wisdom'+(mobile?'&shell=phone':'&shell=desktop'));
 await p.waitForFunction(m=>m?!!window.__wos:!!window.__wux,mobile);
 await p.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.src.includes('/wisdom/')&&f.contentWindow?.WizardApp?.hosted&&f.contentWindow?.WisdomDiscussion),null,{timeout:30000});
 const f=p.frames().find(x=>x.url().includes('/wisdom/'));
 ok(label+' Wisdom hosted with the bridge',await f.evaluate(()=>typeof WizardApp.nav.openThread==='function'));
 // Ask AI on an existing passage discussion.
 await f.evaluate(id=>WisdomDiscussion.open(id),did);
 await p.waitForSelector('.hosted-thread .ch-compose textarea',{timeout:20000}).catch(async e=>{console.log('OPEN DEBUG',JSON.stringify({errors,writes,cons,served:[...new Set(served)],sheet:await f.evaluate(()=>WisdomDiscussion.isOpen()),svc:await p.evaluate(()=>window.WizAppServices?.inspect?.()).catch(()=>null)}));throw e;});
 const wid=await p.locator('.hosted-thread').getAttribute('data-chats');
 const info=await p.evaluate(({m,wid})=>{const s=m?__wos:__wux,w=s.wins[wid];return{appId:w.appId,app:w.app,thread:w.thread,inWin:!!document.querySelector(`[data-win="${wid}"] .hosted-thread`)};},{m:mobile,wid});
 ok(label+' real Chats thread inside the Wisdom window',info.appId==='wisdom'&&info.thread===sid&&info.inWin,info);
 ok(label+' Wisdom sheet not opened',await f.evaluate(()=>!WisdomDiscussion.isOpen()));
 const bubble=await p.locator('.hosted-thread .ch-reply').innerText().catch(()=>'');
 ok(label+' passage shows as the reply bubble',/Ask AI:/.test(bubble),bubble.slice(0,160));
 ok(label+' standard composer: mic, attach, model',await p.locator('.hosted-thread [data-chmic]').count()===1&&await p.locator('.hosted-thread [data-chattach]').count()===1&&await p.locator('.hosted-thread [data-chmodel]').count()>=1);
 await p.screenshot({path:path.join(OUT,label+'-wisdom-thread.png')});
 // Voice through the orb with the composer focused lands in this thread with the passage.
 await p.locator('.hosted-thread .ch-compose textarea').fill('Typed lead-in');
 await p.evaluate(m=>{window.__qaBefore=[...WosOutbox._items.keys()];return m?__wos.startVoice('auto'):__wux.talk('start');},mobile);
 if(mobile)await p.waitForFunction(()=>[...WosOutbox._items.values()].some(i=>!__qaBefore.includes(i.id)&&i.state==='capturing'),null,{timeout:10000}).catch(()=>{});
 await delay(1200);
 await p.evaluate(async m=>{if(m)__wos.finishVoice();else await __wux.talk('send');},mobile);
 await p.waitForFunction(()=>[...WosOutbox._items.values()].some(i=>!__qaBefore.includes(i.id)&&i.kind!=='capture'),null,{timeout:20000}).catch(()=>{});
 const all=await p.evaluate(()=>[...WosOutbox._items.values()].filter(i=>!__qaBefore.includes(i.id)).map(x=>({kind:x.kind,sessionId:x.sessionId,typed:x.typed,state:x.state})));console.log('VOICE ITEMS',JSON.stringify(all));
 const voice=await p.evaluate(()=>{const x=[...WosOutbox._items.values()].find(i=>!__qaBefore.includes(i.id)&&i.kind!=='capture');return x?{kind:x.kind,sessionId:x.sessionId,text:x.text,typed:x.typed,reply:x.reply?.key||null,bytes:x.audio?.size||0}:null;});
 if(!voice){await p.screenshot({path:path.join(OUT,label+'-voice-fail.png')});console.log('VDBG',JSON.stringify(await p.evaluate(()=>({keys:Object.keys(__wos||{}).join(','),toast:document.querySelector('.toast, [class*=toast]')?.innerText,hosted:!!document.querySelector('.hosted-thread'),items:[...WosOutbox._items.values()].map(i=>({k:i.kind,s:i.state,e:i.error,sid:i.sessionId,a:i.audio?.size}))}))));}
 ok(label+' orb voice goes to the Wisdom thread with the passage',voice&&voice.sessionId===sid&&voice.reply===FX.reply.key,voice);
 await p.screenshot({path:path.join(OUT,label+'-after-voice.png')});
 // Back returns to the reader; Wisdom is visible again.
 if(await p.locator('.hosted-thread').count()){await p.locator('.hosted-thread [data-chback]').click();}
 await p.waitForFunction(()=>!document.querySelector('.hosted-thread'),null,{timeout:10000}).catch(()=>{});
 ok(label+' Back returns to the Wisdom reader',await p.locator('.hosted-thread').count()===0&&await f.evaluate(()=>WizardApp.view.isVisible()));
 // Reopen: started thread, same session, no second passage item added.
 started=true;
 await f.evaluate(id=>WisdomDiscussion.open(id),did);
 await p.waitForSelector('.hosted-thread .ch-compose textarea',{timeout:20000});
 const again=await p.evaluate(m=>{const s=m?__wos:__wux,el=document.querySelector('.hosted-thread');return s.wins[el.dataset.chats].thread;},mobile);
 ok(label+' reopen lands in the same thread',again===sid,{again});
 await p.locator('.hosted-thread [data-chback]').click();await p.waitForFunction(()=>!document.querySelector('.hosted-thread'));
 if(mobile){await p.evaluate(()=>__wosNativeBack());await delay(400);ok(label+' root Back never exits',p.url().includes('/wizard-os-home/'));}
 ok(label+' no browser errors',errors.length===0,errors);
 fs.writeFileSync(path.join(OUT,label+'-writes.json'),JSON.stringify({writes,served:[...new Set(served)]},null,1));
 await ctx.close();
}
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME,headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 try{for(const m of process.env.QA_SHELL==='desktop'?[false]:process.env.QA_SHELL==='phone'?[true]:[true,false])await run(browser,m);}
 finally{fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({checks},null,1));await browser.close();}
 const bad=checks.filter(c=>!c.pass);console.log(bad.length?`FAILED ${bad.length}/${checks.length}`:`ALL ${checks.length} PASS`);process.exit(bad.length?1:0);})().catch(e=>{console.error(e);process.exit(1);});
