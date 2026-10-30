// Real opened-alert Chats surface; isolated synthetic data, never owner API writes.
const {chromium}=require('./tools/qa-playwright.cjs'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const origin=process.env.QA_ORIGIN,out=process.env.QA_OUT,census=process.env.QA_MODE==='census';
// Every isolated context is a new device. Against a box with no read state yet, Wizard's existing list refresh
// (web/live.js first-run branch) seeds an empty read-state record once at boot: PUT /wizard/thread-seen with
// exactly {initializedAt,threads:{}}. That is not caused by opening or reading an alert. Reading cases therefore
// serve an existing, empty read state like a set-up box and still allow zero writes; census mode proves the
// boot write's exact identity on old and new source and that nothing is written after the alert opens.
if(!origin||!out)throw Error('QA_ORIGIN and QA_OUT are required');fs.mkdirSync(out,{recursive:true});
const summary='The automatic daily fix attempt failed and will retry on its own schedule. Nothing to do.';
const original='Daily Wizard code fix did not run\n\nThe task stopped before a repair could be applied.\n\nOriginal failure: the repair worker could not start.\n\n<img src=x onerror="window.ALERT_INJECTION=true">\n<script>window.ALERT_INJECTION=true</script>\n\n'+('Full original diagnostic paragraph.\n\n'.repeat(500))+'https://example.test/'+('a'.repeat(600))+'\n\nFINAL ORIGINAL LINE — retained without truncation.';
(async()=>{const b=await chromium.launch({executablePath:process.env.QA_CHROME||undefined});let result=[];try{
for(const skin of census?['nebula']:['nebula','obsidian-light'])for(const width of census?[390]:[360,390])for(const native of census?[false]:[false,true]){
 const mode=native?'native':'browser';
 const c=await b.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',userAgent:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'+(native?' WizardOS-DocScroll':'')});
 await c.addInitScript(s=>{localStorage.setItem('wux.shell','phone');localStorage.setItem('wos.skin',s);localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.v1','true');},skin);
 const item={id:'synthetic-original-alert',title:'Daily Wizard code fix didn’t run',message:summary,details:original,time:Math.floor(Date.now()/1000),read:false,archived:false};let writes=[],foreign=[],phase='boot';
 await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==origin){foreign.push(q.url());return r.abort();}if(q.method()!=='GET'&&q.method()!=='HEAD'){writes.push({method:q.method(),path:u.pathname,phase,body:q.postData()});return r.fulfill({status:403,contentType:'application/json',body:'{"error":"isolated QA: writes blocked"}'});}if(!census&&u.pathname==='/wizard/thread-seen')return r.fulfill({contentType:'application/json',body:JSON.stringify({state:{initializedAt:1767225600000,threads:{}}})});if(u.pathname.startsWith('/notifications/api/'))return r.fulfill({contentType:'application/json',body:JSON.stringify(u.pathname.endsWith('/items')?{items:[item]}:{unread:1,needs:0})});return r.continue();});
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(String(e)));
 await c.request.post(origin+'/__fake/state',{data:{firstRun:false}});
 await p.goto(origin+'/wizard-os-home/?shell=phone');await p.waitForFunction(()=>window.__wos&&window.WosExperience);
 await p.evaluate(async()=>{WizCore.backendApps=()=>[{id:'notifications',name:'Notifications',backend:true}];await WosExperience.refresh();__wos.goDesk(0,true);});
 await p.locator('[data-act="ready"][aria-label="Ready 1"]').waitFor({timeout:10000});
 if(census){await p.waitForFunction(()=>window.WizLive?.ok&&window.WizLive.seen,null,{timeout:10000});for(const end=Date.now()+5000;!writes.length&&Date.now()<end;)await p.waitForTimeout(50);}
 phase='open';await p.locator('[data-act="ready"]').click();
 const row=p.locator('.ch-sec[data-sec="ready"] [data-chnotif="synthetic-original-alert"]').filter({visible:true});await row.waitFor({timeout:10000});await row.click();
 if(census){const bub=p.locator('.ch-notif .bub').filter({visible:true});await bub.waitFor({timeout:10000});await p.waitForTimeout(750);assert.ok((await bub.innerText()).includes(summary));
  await bub.evaluate(e=>{const s=document.documentElement.classList.contains('wos-doc-scroll')?document.scrollingElement:e.closest('.ch-msgs');s.scrollTop=s.scrollHeight;s.dispatchEvent(new Event('scroll'));});await p.waitForTimeout(150);
  await p.evaluate(()=>{const w=__wos.wins[__wos.desks[__wos.idx].focus];__wos.renderChats(w);});await p.waitForTimeout(1500);
  const boot=writes.filter(w=>w.phase==='boot'),after=writes.filter(w=>w.phase!=='boot');
  assert.equal(boot.length,1,'exactly one boot write expected');assert.equal(boot[0].method,'PUT');assert.equal(boot[0].path,'/wizard/thread-seen');
  const body=JSON.parse(boot[0].body);assert.deepEqual(Object.keys(body).sort(),['initializedAt','threads']);assert.ok(Number.isFinite(body.initializedAt));assert.deepEqual(body.threads,{});
  assert.deepEqual(after,[],'opening and reading the alert must not resolve, mark, or start an agent');assert.deepEqual(foreign,[]);assert.deepEqual(errors,[]);
  result.push({mode:'census',skin,width,bootWrites:boot.map(({method,path,body})=>({method,path,bodyKeys:Object.keys(JSON.parse(body)).sort(),threads:Object.keys(JSON.parse(body).threads).length})),writesAfterOpen:0});console.log('PASS write census: only first-run empty read-state seed at boot; zero writes after opening alert');await c.close();continue;}
 const n=p.locator('.ch-notif-original').filter({visible:true});await n.waitFor({timeout:10000});await p.waitForTimeout(750);
 assert.equal(await p.evaluate(()=>document.documentElement.dataset.shell),'phone');assert.equal(await p.evaluate(()=>document.documentElement.dataset.skin),skin);
 assert.equal(await n.textContent(),original);assert.equal(await p.evaluate(()=>!!window.ALERT_INJECTION),false);assert.equal(await n.locator('img,script').count(),0);
 assert.ok((await p.locator('.ch-notif .bub').filter({visible:true}).innerText()).includes(summary));
 const initial=await n.evaluate(e=>{const s=document.documentElement.classList.contains('wos-doc-scroll')?document.scrollingElement:e.closest('.ch-msgs'),r=e.getBoundingClientRect();return{top:s.scrollTop,client:s.clientHeight,height:s.scrollHeight,width:s.clientWidth,scrollWidth:s.scrollWidth,detailY:r.top};});
 assert.ok(initial.top<2,'opened alert must start at the summary, not its tail');assert.ok(initial.height>initial.client,'long source must scroll');assert.ok(initial.scrollWidth<=initial.width+2,'long source must wrap');
 await p.screenshot({path:path.join(out,`${mode}-${skin}-${width}-opened-top.png`)});
 await n.evaluate(e=>{const s=document.documentElement.classList.contains('wos-doc-scroll')?document.scrollingElement:e.closest('.ch-msgs');s.scrollTop=650;s.dispatchEvent(new Event('scroll'));});await p.waitForTimeout(150);
 await p.evaluate(()=>{const w=__wos.wins[__wos.desks[__wos.idx].focus];__wos.renderChats(w);});await p.waitForTimeout(150);
 assert.ok(await n.evaluate(e=>Math.abs((document.documentElement.classList.contains('wos-doc-scroll')?document.scrollingElement:e.closest('.ch-msgs')).scrollTop-650)<3),'repaint must preserve reading place');
 await n.evaluate(e=>{const s=document.documentElement.classList.contains('wos-doc-scroll')?document.scrollingElement:e.closest('.ch-msgs');s.scrollTop=s.scrollHeight;});await p.waitForTimeout(150);
 const tail=await n.evaluate(e=>{const range=document.createRange();range.selectNodeContents(e);range.setStart(e.firstChild,e.firstChild.length-55);const r=range.getBoundingClientRect(),s=e.closest('.ch-msgs').getBoundingClientRect(),native=document.documentElement.classList.contains('wos-doc-scroll');return{top:r.top,bottom:r.bottom,viewTop:native?document.querySelector('.ch-head').getBoundingClientRect().bottom:s.top,viewBottom:native?document.querySelector('.ch-compose').getBoundingClientRect().top:s.bottom};});assert.ok(tail.bottom<=tail.viewBottom+2&&tail.top>=tail.viewTop,'last original paragraph must be reachable');
 await p.screenshot({path:path.join(out,`${mode}-${skin}-${width}-opened-tail.png`)});
 assert.deepEqual(writes,[],'reading details must not resolve, mark, or start an agent');assert.deepEqual(foreign,[]);assert.deepEqual(errors,[]);
 result.push({skin,width,mode,sourceCharacters:original.length,initial,tail,writes:0,errors});console.log('PASS opened alert full original details '+mode+' '+skin+' '+width);await c.close();
}
fs.writeFileSync(path.join(out,census?'census.json':'browser.json'),JSON.stringify({passed:true,mode:census?'census':'reading',cases:result},null,2));
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
