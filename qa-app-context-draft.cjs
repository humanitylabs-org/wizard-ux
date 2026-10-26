'use strict';
// Isolated browser stores, synthetic report reads, no production writes or private thread reads.
// QA_SOURCE overlays only shell assets; QA_APP_ORIGIN optionally stages the real app frontend.
const {chromium}=require('./tools/qa-playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const BASE=process.env.QA_BASE||'http://127.0.0.1:8796', OUT=process.env.QA_OUT;
if(!OUT) throw Error('QA_OUT required'); fs.mkdirSync(OUT,{recursive:true});
const source=process.env.QA_SOURCE, baseline=process.env.QA_BASELINE==='1', appOrigin=process.env.QA_APP_ORIGIN;
(async()=>{const b=await chromium.launch({headless:true,args:process.env.QA_HOST_RESOLVER?['--host-resolver-rules='+process.env.QA_HOST_RESOLVER]:[]});const results=[];
try {for(const mobile of [false,true]) {
 const c=await b.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
 const writes=[],errors=[],forbidden=[];
 await c.route('**/*',async r=>{try {const q=r.request(),u=new URL(q.url());
  if(!['GET','HEAD'].includes(q.method())) {writes.push({method:q.method(),path:u.pathname});return await r.fulfill({status:403,json:{error:'QA blocks production writes'}});}
  if(/\/workspaces(?:\/|$)|\/workspace-sync\//.test(u.pathname))return await r.fulfill({status:404,json:{error:'QA isolated workspace'}});
  if(/\/sessions(?:\/|$)|\/runs(?:\/|$)/.test(u.pathname)){forbidden.push(u.pathname);return await r.fulfill({json:{sessions:[],data:[],has_more:false}});}
  if(u.pathname.startsWith('/morning-report/api/')) {const target='http://127.0.0.1:18812'+u.pathname+u.search; const response=await r.fetch({url:target});return await r.fulfill({response});}
  if(appOrigin&&u.pathname.startsWith('/morning-report/')) {const response=await r.fetch({url:appOrigin+u.pathname+u.search});return await r.fulfill({response});}
  if(source&&u.pathname.startsWith('/wizard-os-home/')) {const rel=u.pathname.slice(16)||'index.html',f=path.resolve(source,'web',rel);if(f.startsWith(path.resolve(source,'web')+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return await r.fulfill({body:fs.readFileSync(f),contentType:{'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'}[path.extname(f)]||'application/octet-stream'});}
  return await r.continue();
 } catch(e) { if(!/closed|disposed|detached/i.test(e.message)) errors.push(e.message); }
 });
 await c.addInitScript(()=>{for(const [k,v] of Object.entries({'wos.wsync.off':'true','wos.tour.v1':'true','wos.tour.done':'1','wos.coached':'true','wos.skin':'landscapes'}))localStorage.setItem(k,v);navigator.sendBeacon=()=>false;});
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto(BASE+'/wizard-os-home/'+(mobile?'':'desktop.html'));
 await p.waitForFunction(()=>!!(window.__wos||window.__wux),null,{timeout:60000});
 await p.evaluate(()=>WizCore.deeplink.route('/wizard-os-home/?open=morning-report'));
 await p.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.src.includes('/morning-report/')),null,{timeout:30000});
 await p.waitForTimeout(2500);
 const f=p.frames().find(f=>f.url().includes('/morning-report/')); await f.waitForSelector('#paper p');
 await p.waitForTimeout(1500);
 const selected=await f.evaluate(()=>{const n=document.querySelector('#paper p').firstChild,r=document.createRange();r.setStart(n,6);r.setEnd(n,22);const s=getSelection();s.removeAllRanges();s.addRange(r);return s.toString();});
 await f.locator('#reply').waitFor({state:'visible'});await p.screenshot({path:path.join(OUT,(mobile?'mobile':'desktop')+'-selection.png')});
 if(mobile)await f.locator('#reply').tap();else await f.locator('#reply').click();
 await p.waitForTimeout(750);
 const status=await f.locator('#status').innerText();
 const draft=await p.evaluate(()=>JSON.parse(localStorage.getItem('wos.chat.drafts.v1')||'{}'));
 if(baseline){assert.match(status,/does not support Morning Report/);assert.ok(!draft.new?.reply);}
 else {assert.match(status,/Nothing sent/);assert.equal(draft.new.reply.message,selected);assert.match(draft.new.reply.key,/^morning-report:/);assert.equal(draft.new.text,'');assert.equal(draft.new.files.length,0);assert.match(draft.new.reply.title,/2026-01-02/);await p.locator('[data-chreply]').first().waitFor({state:'visible'});}
 await p.screenshot({path:path.join(OUT,(mobile?'mobile':'desktop')+'-draft.png')});
 if(!baseline){await p.reload();await p.waitForFunction(()=>!!(window.__wos||window.__wux),null,{timeout:60000});const persisted=await p.evaluate(()=>JSON.parse(localStorage.getItem('wos.chat.drafts.v1')||'{}'));assert.deepEqual(persisted.new.reply,draft.new.reply);}
 // No session/run/send HTTP mutation even attempted. Background UI prefs/workspace writes may be blocked.
 const sendCalls=writes.filter(w=>/sessions|runs|send|messages/.test(w.path));assert.deepEqual(sendCalls,[]);
 assert.deepEqual(errors,[]);
 results.push({surface:mobile?'mobile touch emulation':'desktop',baseline,selected,status,draft,sendCalls,blockedBackgroundWrites:writes,blockedPrivateReads:forbidden,errors});await c.close();
}fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({PASS:true,results},null,2));console.log(JSON.stringify({PASS:true,results},null,2));}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
