// Synthetic-only browser regression. Run with tools/fake-setup-api.cjs as QA_ORIGIN.
const {chromium}=require('./tools/qa-playwright.cjs'),assert=require('node:assert/strict');
const origin=process.env.QA_ORIGIN;
if(!origin)throw Error('QA_ORIGIN must be an isolated fake-setup-api origin');
(async()=>{const b=await chromium.launch();try{
 for(const skin of ['nebula','obsidian-light']){
  const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'});
  await c.addInitScript(s=>{localStorage.setItem('wux.shell','phone');localStorage.setItem('wos.skin',s);localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.v1','true');},skin);
  let item={id:'synthetic-ready',title:'Your test reminder is ready',message:'Synthetic notification. No private data.',time:Math.floor(Date.now()/1000),read:false,archived:false};
  await c.route('**/notifications/api/**',async r=>{const u=new URL(r.request().url());if(u.pathname.endsWith('/mark'))Object.assign(item,JSON.parse(r.request().postData()));await r.fulfill({contentType:'application/json',body:JSON.stringify(u.pathname.endsWith('/items')?{items:[item]}:{unread:!item.read&&!item.archived?1:0,needs:0})});});
  const p=await c.newPage();let errors=[];p.on('pageerror',e=>errors.push(String(e)));
  await p.goto(origin+'/wizard-os-home/?shell=phone');await p.waitForFunction(()=>window.__wos&&window.WosExperience);
  await p.evaluate(async()=>{WizCore.backendApps=()=>[{id:'notifications',name:'Notifications',backend:true}];await WosExperience.refresh();});
  // Home must repaint from the inbox read, without waiting for a session-list poll.
  await p.locator('[data-act="ready"][aria-label="Ready 1"]').waitFor({timeout:10000});
  await p.locator('[data-act="ready"]').click();
  const row=p.locator('.ch-sec[data-sec="ready"] [data-chnotif="synthetic-ready"]').filter({visible:true});
  await row.waitFor({timeout:8000});
  const wid=await p.evaluate(()=>__wos.desks[__wos.idx].focus);
  assert.equal(await p.evaluate(id=>__wos.wins[id].focus?.kind,wid),'agent','real default main-agent Focus');
  // All shows it too; Spaces, a status filter, and search do not.
  async function mode(focus,filter='',q=''){await p.evaluate(({wid,focus,filter,q})=>{const w=__wos.wins[wid];w.focus=focus;Object.assign(__wos.chatState(wid),{filter,q,listHTML:''});__wos.renderChats(w);},{wid,focus,filter,q});}
  await mode(null);await row.waitFor();
  await mode({kind:'space',key:'synthetic-space'});assert.equal(await row.count(),0);
  await mode(null,'working');assert.equal(await row.count(),0);
  await mode(null,'','missing');assert.equal(await row.count(),0);
  await mode({kind:'agent',key:await p.evaluate(()=>WosAgents.defaultId())});await row.waitFor();
  await p.evaluate(()=>WosBell.mark(['synthetic-ready'],{archived:true}));await row.waitFor({state:'hidden'});
  await p.evaluate(()=>__wos.goDesk(0,true));await p.locator('[data-act="ready"][aria-label="Ready 0"]').waitFor();
  assert.deepEqual(errors,[]);console.log('PASS notification-only Ready and Home count: '+skin);await c.close();
 }
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
