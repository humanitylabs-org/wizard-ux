// Synthetic API only. Candidate gateway must not point at production.
const { chromium } = require('./tools/qa-playwright.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.QA_ORIGIN;
const out = process.env.QA_SHOTS;
(async () => {
 const b = await chromium.launch({executablePath:process.env.QA_CHROME, args:['--no-sandbox']});
 const results=[];
 try { for(const shell of ['desktop','phone']) {
  const ctx=await b.newContext({viewport:shell==='phone'?{width:412,height:915}:{width:1440,height:1000},hasTouch:shell==='phone',isMobile:shell==='phone',serviceWorkers:'block'});
  const writes=[]; const now=Date.now();
  const messages=[{role:'user',content:'Please outline the checks.',timestamp:now-40000},{role:'assistant',content:'Step 2: Run the verification suite, then inspect the screenshots.',timestamp:now-30000}];
  const session={id:'qa-message-reply',title:'Synthetic reply verification',status:'completed',updated_at:now-30000,last_assistant_at:now-30000,message_count:2};
  await ctx.route('**/*',async r=>{
   const u=new URL(r.request().url());
   if(u.origin!==new URL(base).origin) return r.abort();
   if(!u.pathname.startsWith('/wizard/')) return r.continue();
   let data={};
   if(r.request().method()!=='GET') {
    writes.push({path:u.pathname,body:r.request().postData()});
    if(u.pathname.endsWith('/runs')) { const body=r.request().postDataJSON(); console.log('PAYLOAD',shell,JSON.stringify(body)); messages.push({role:'user',content:body.input,timestamp:Date.now()}); session.message_count=messages.length; data={run_id:'qa-run',status:'queued'}; }
    else data={accepted:true};
   } else if(u.pathname.endsWith('/messages')) data={data:messages};
   else if(u.pathname.endsWith('/sessions')) data={data:[session]};
   else if(u.pathname.endsWith('/qa-message-reply')) data={session};
   else if(u.pathname.endsWith('/agents')) data={agents:[]};
   else if(/thread-seen|thread-dispositions/.test(u.pathname)) data={state:{threads:{},version:1}};
   else if(/my-skin/.test(u.pathname)) return r.fulfill({status:404,body:''});
   else if(/model\/options/.test(u.pathname)) data={model:'qa-model',provider:'qa',providers:[{slug:'qa',name:'QA',is_current:true,authenticated:true,models:['qa-model']}]};
   else if(/models/.test(u.pathname)) data={models:[]};
   return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('PAGEERROR',e.stack));

  await p.addInitScript(()=>localStorage.setItem('wos.coached','true'));
  await p.goto(base+'?shell='+shell);
  await p.waitForFunction(()=>(window.__wos||window.__wux)?.live?.ok);
  console.log('BOOT',shell);
  const wid=await p.evaluate(()=>{if(window.__wux){__wux.openThread('qa-message-reply');return Object.values(__wux.wins).find(w=>w.thread==='qa-message-reply').id;} __wos.goDesk(1);return __wos.desks[1].wins.find(x=>__wos.wins[x].app==='chats')});
  await p.evaluate(([w,id])=>(window.__wos ? __wos.openChat(w,id) : __wux.openThread(id)),[wid,session.id]);
  const root=p.locator(`[data-chats="${wid}"]`).last();
  await root.locator('[data-mreply]').first().waitFor();
  await root.locator('.msg.a [data-mreply]').last().click();
  await root.locator('[data-chreply]').waitFor();
  assert.match(await root.locator('[data-chreply]').innerText(),/Step 2/);
  const ta=root.locator('textarea'); await ta.fill('Run this again');
  await ta.evaluate(e=>window.qaTextarea=e);
  for(let i=0;i<3;i++){await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForTimeout(1000);}
  assert.equal(await ta.inputValue(),'Run this again');
  assert.equal(await ta.evaluate(e=>e===window.qaTextarea),true);
  const skins=await p.evaluate(()=>WosSkin.list.map(x=>x.id));
  for(const skin of skins){await p.evaluate(id=>WosSkin.set(id),skin);await p.waitForTimeout(900);assert.equal(await ta.inputValue(),'Run this again');assert.match(await root.locator('[data-chreply]').innerText(),/Step 2/);
   await root.locator('[data-chreplyx]').click(); await root.locator('.msg.a [data-mreply]').last().click();
   await p.waitForTimeout(200);
   const fits=await root.locator('.ch-send').evaluate(e=>{const r=e.getBoundingClientRect(), dock=document.querySelector('.dock')?.getBoundingClientRect();return r.bottom<=(dock?.top||innerHeight)+1;}); assert.ok(fits,skin+' composer above dock');
   fs.mkdirSync(out,{recursive:true}); await p.screenshot({path:out+'/'+shell+'-'+skin+'-chip.png'});
  }
  await p.evaluate(()=>WosSkin.set('sepia')); await p.waitForTimeout(1500);
  console.log('GEOMETRY',shell,await p.evaluate(()=>[...document.querySelectorAll('.ch-thread,.ch-msgs,.ch-compose,.ch-reply,.voice,.dock')].map(e=>({c:e.className,r:JSON.stringify(e.getBoundingClientRect()),height:getComputedStyle(e).height,min:getComputedStyle(e).minHeight,flex:getComputedStyle(e).flex}))));
  fs.mkdirSync(out,{recursive:true}); await p.screenshot({path:out+'/'+shell+'-chip.png'});
  await root.locator('[data-chreplyx]').click();assert.equal(await root.locator('[data-chreply]').count(),0);assert.equal(await ta.inputValue(),'Run this again');
  await root.locator('.msg.u [data-mreply]').first().click();assert.match(await root.locator('[data-chreply]').innerText(),/Please outline/);
  await root.locator('.msg.a [data-mreply]').last().click();
  await root.locator('.ch-send').click();
  await p.waitForTimeout(8000);

  const run=writes.find(x=>x.path.endsWith('/runs')); assert.ok(run,'outbound run request');
  assert.match(run.body,/Step 2: Run the verification suite/);assert.match(run.body,/WIZARD_REPLY_V1/);assert.match(run.body,/Run this again/);
  await p.evaluate(([w,id])=>(window.__wos ? __wos.openChat(w,id) : __wux.openThread(id)),[wid,session.id]);await root.locator('.ch-rq').first().waitFor();
  assert.match(await root.locator('.ch-rq').first().innerText(),/Step 2/);
  await p.reload(); await p.waitForFunction(()=>(window.__wos||window.__wux)?.live?.ok);
  await p.evaluate(id=>{if(window.__wux)__wux.openThread(id);else {__wos.goDesk(1);const w=__wos.desks[1].wins.find(x=>__wos.wins[x].app==='chats');__wos.openChat(w,id);}},session.id);
  await p.locator('.msg.u:not(.pending) .ch-rq').first().waitFor();
  await p.screenshot({path:out+'/'+shell+'-sent.png'});
  results.push({shell,skins,writes,passed:true});await ctx.close();
 }} finally {await b.close();}
 fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS',results.length,'shells');
})().catch(e=>{console.error(e);process.exitCode=1});
