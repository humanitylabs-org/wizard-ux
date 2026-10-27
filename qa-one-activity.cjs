// Synthetic-only phone regression for James: a running reply has one activity section.
// QA_WEB_DIR serves a candidate; QA_STATIC_ORIGIN reads ONLY /wizard-os-home/ static bytes.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('./tools/qa-playwright.cjs');
const WEB = path.resolve(process.env.QA_WEB_DIR || path.join(__dirname, 'web'));
const OUT = process.env.QA_OUT || path.join(process.env.TMPDIR || '.', 'one-activity');
const STATIC = process.env.QA_STATIC_ORIGIN || '';
const AGENT = process.env.QA_AGENT || '';
const scopes = new Set();
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
fs.mkdirSync(OUT, {recursive:true});
const sec = Math.floor(Date.now()/1000), sid = 'synthetic-one-activity', rid = 'synthetic-running';
const messages = [
  {role:'user',content:'Check the release state.',timestamp:sec-37},
  {role:'assistant',content:'',timestamp:sec-36,tool_calls:[{id:'check',display_label:'Checked the release state',function:{name:'terminal',arguments:'{}'}}]},
  {role:'tool',content:'Synthetic check complete',tool_call_id:'check',timestamp:sec-35},
  {role:'assistant',content:'',timestamp:sec-34,tool_calls:[{id:'review',display_label:'Reviewing the result',function:{name:'terminal',arguments:'{}'}}]}
];
const session = {id:sid,agent:AGENT,title:'One activity section',source:'wizard-mobile',status:'running',wizard_run_id:rid,started_at:sec-37,updated_at:sec,wizard_last_user_at:sec-37,message_count:messages.length,last_user_message:messages[0]};
const streams = new Set();
let historyCaughtUp = false;
const server = http.createServer(async(req,res) => {
 try {
  const u = new URL(req.url,'http://fixture');
  if (u.pathname.startsWith('/wizard/')) {
   if (u.pathname.endsWith('/events')) {
    scopes.add(u.searchParams.get('agent') || '');
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'}); streams.add(res);
    const emit = (name,data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    emit('tool.started',{step_id:'review',tool:'terminal',preview:'git status --short'});
    emit('message.delta',{delta:'The check is complete. I’m reviewing the result.'});
    req.on('close',()=>streams.delete(res)); return;
   }
   let payload = {data:[],apps:[],agents:[],items:[]};
   if (u.pathname.endsWith('/v1/agents')) payload={agents:[{id:'hermes',label:'Main',is_default:true,status:'running'},{id:'qa-host',label:'Synthetic routed',harness:'hermes',privacy:'standard',status:'running'}]};
   else if (u.pathname.endsWith('/messages')) payload={data:messages.slice(0,historyCaughtUp?4:3),has_more:false,pagination:{has_more:false}};
   else if (/\/api\/sessions$/.test(u.pathname)) payload={data:(u.searchParams.get('agent')||'')===AGENT?[session]:[],has_more:false};
   else if (u.pathname.endsWith('/sessions/'+sid)) payload={session};
   else if (u.pathname.endsWith('/runs/'+rid)) payload={run_id:rid,session_id:sid,status:'running'};
   else if (u.pathname.endsWith('/thread-seen')) payload={state:{initializedAt:Date.now(),threads:{}}};
   else if (u.pathname.endsWith('/thread-dispositions')) payload={state:{}};
   res.writeHead(200,{'content-type':'application/json'}); return res.end(JSON.stringify(payload));
  }
  if (!u.pathname.startsWith('/wizard-os-home/')) {res.writeHead(404);return res.end();}
  if (STATIC) {
   const r=await fetch(STATIC+u.pathname+u.search);res.writeHead(r.status,{'content-type':r.headers.get('content-type')||'application/octet-stream'});return res.end(Buffer.from(await r.arrayBuffer()));
  }
  const rel=decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)) || 'index.html';
  const file=path.resolve(WEB,rel);
  if(!file.startsWith(WEB+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
  res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
 } catch(e) {console.error(e);res.writeHead(500);res.end('Synthetic fixture error');}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true});const results=[];
 try {
  for (const skin of ['nebula','sepia']) {
   historyCaughtUp = false; scopes.clear();
   const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,serviceWorkers:'block'});
   await ctx.addInitScript(skin=>{localStorage.setItem('wos.skin',skin);localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.v1','true');localStorage.setItem('wos.voiceTipSeen','true');},skin);
   const page=await ctx.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
   // No external API or private data can be reached, even from an embedded frame.
   await ctx.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   await page.goto(base+'/wizard-os-home/?open=chats&session='+sid,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.WizLive?.session('synthetic-one-activity'),null,{timeout:20000});
   await page.evaluate(sid=>window.__wos.openWizardThread(sid),sid);
   try { await page.waitForSelector('[data-streaming] .bub',{timeout:20000}); }
   catch(e) { console.log('FIXTURE DEBUG',await page.evaluate(()=>({body:document.body.innerText,wins:window.__wos?.wins,session:WizLive.session('synthetic-one-activity'),streams:[...document.querySelectorAll('[data-streaming]')].map(el=>el.outerHTML)})),errors); await page.screenshot({path:path.join(OUT,'debug.jpg'),type:'jpeg',quality:70});throw e; }
   const root=page.locator('[data-chats]:visible').last();
   assert.equal(await root.locator('[data-wk]').count(),1,'running reply shows one activity section, not two');
   assert.equal(await root.locator('.ch-steps').count(),0);
   const summary=root.locator('[data-wk] summary');
   await summary.click();assert.equal(await root.locator('[data-wk]').evaluate(el=>el.open),true);
   assert.equal(await root.locator('.wk-steps li').count(),2);
   assert.match(await root.locator('.wk-steps').innerText(),/Checked the release state/);
   assert.match(await root.locator('.wk-steps time').first().innerText(),/1s/);
   assert.match(await root.locator('.wk-preview').innerText(),/git status --short/);
   assert.deepEqual([...scopes],[AGENT],'stream belongs to the selected main/routed agent');
   const shot=path.join(OUT,skin+'.jpg');await page.screenshot({path:shot,type:'jpeg',quality:80});
   assert.ok(fs.statSync(shot).size<1000000);
   const state=await page.evaluate(()=>({skin:WosSkin.current,overflow:document.documentElement.scrollWidth>390}));
   assert.equal(state.skin,skin);assert.equal(state.overflow,false);
   await summary.click();assert.equal(await root.locator('[data-wk]').evaluate(el=>el.open),false);
   await summary.click();assert.equal(await root.locator('[data-wk]').evaluate(el=>el.open),true);
   historyCaughtUp=true;
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.WizLive?.session('synthetic-one-activity'));
   await page.evaluate(sid=>window.__wos.openWizardThread(sid),sid);
   await page.waitForSelector('[data-streaming] .bub');
   const refreshed=page.locator('[data-chats]:visible').last();
   const disclosure=refreshed.locator('[data-wk]');
   if (!await disclosure.evaluate(el=>el.open)) await disclosure.locator('summary').click();
   assert.equal(await refreshed.locator('.wk-steps li').count(),2,'history refresh binds the live ID without duplicating the tool row');
   assert.match(await refreshed.locator('.wk-steps').innerText(),/Reviewing the result/);
   assert.match(await refreshed.locator('.wk-preview').innerText(),/git status --short/);
   assert.deepEqual(errors,[]);
   results.push({...state,agent:AGENT,sections:1,rows:2,liveOnly:true,historyReconciled:true,shot,bytes:fs.statSync(shot).size,errors});
   await ctx.close();
  }
  fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
 } finally {await browser.close();for(const s of streams)s.end();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);for(const s of streams)s.end();server.closeAllConnections();server.close();process.exitCode=1;});
