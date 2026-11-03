// Isolated full-shell regression: no live backend, no agent writes. Run on the Linux browser worker.
// QA_BASE_CHATS can serve the original chats.js for a failing-first A/B, without changing the checkout.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const web = path.resolve(process.env.QA_WEB_DIR || path.join(__dirname, 'web'));
const out = process.env.QA_OUT || path.join(process.env.TMPDIR || process.cwd(), 'instant-ui-taps');
fs.mkdirSync(out, { recursive: true });
let passed = 0, failed = 0;
const measurements = [], check = (value, name, detail = '') => { value ? passed++ : failed++; console.log(value ? 'PASS' : 'FAIL', name, detail); };
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://fixture');
  let rel = u.pathname.replace(/^\/wizard-os-home\//, '') || 'index.html';
  if (!u.pathname.startsWith('/wizard-os-home/') || rel.includes('..')) { res.writeHead(404); return res.end(); }
  const f = process.env.QA_BASE_CHATS && rel === 'core/chats.js' ? process.env.QA_BASE_CHATS : path.join(web, rel);
  if (rel === 'data.js' || rel === 'summaries.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(rel === 'data.js' ? 'window.WIZ_DATA={threads:[],projects:{}};' : 'window.WIZ_SUMMARIES={};'); }
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', mime[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(res);
});
const now = Date.now()/1000;
const row = { id:'tap-thread', title:'Fixture thread', source:'wizard-mobile', status:'completed', message_count:2, hidden:false, started_at:now-60,last_active:now,wizard_last_user_at:now-30,wizard_last_assistant_at:now,wizard_activity_at:now,wizard_attention:{state:'check'},latest_message:{role:'assistant',content:'Fixture reply',timestamp:now} };
async function scenario(browser, origin, desktop, thread, status, skin = 'obsidian', held = false) {
  const label = `${desktop ? 'desktop' : 'plain'}:${thread || 'list'}:${status}:${skin}${held ? ':held' : ''}`;
  const ctx = await browser.newContext({ viewport:desktop ? {width:1600,height:1000} : {width:412,height:892}, hasTouch:!desktop, isMobile:!desktop, serviceWorkers:'block' });
  let writes = 0, settled = false;
  const model = { ...row };
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), json = (body, code = 200) => r.fulfill({status:code,json:body});
    if (u.pathname.endsWith('/sessions/tap-thread') && q.method() === 'PATCH') {
      writes++;
      await new Promise(resolve => setTimeout(resolve, 5000));
      settled = true;
      if (status === 200) model.archived = true;
      return json(status === 200 ? {session:model} : {error:'fixture failure'}, status).catch(() => {});
    }
    if (u.pathname === '/wizard/v1/bootstrap') return json({bootstrap:1,settings:{agent:{name:'Wizard'},clock:{timezone:'UTC'}},capabilities:{},endpoints:{apps:'/wizard/v1/apps',sessions:'/wizard/hermes/api/sessions'}});
    if (u.pathname === '/wizard/v1/setup') return json({first_run:false});
    if (u.pathname === '/wizard/hermes/api/model/options') return json({provider:'fixture',providers:[{slug:'fixture',authenticated:true,models:[]}]});
    if (u.pathname === '/wizard/v1/apps') return json({apps:[]});
    if (u.pathname === '/wizard/hermes/api/sessions') return json({data:[model],has_more:false});
    if (u.pathname.endsWith('/messages')) return json({data:[{id:1,role:'user',content:'Fixture question',timestamp:now-30},{id:2,role:'assistant',content:'Fixture reply',timestamp:now}],has_more:false});
    if (u.pathname.endsWith('/sessions/tap-thread')) return json({session:model});
    if (u.pathname === '/wizard/v1/agents') return json({agents:[{id:'hermes',label:'Wizard',is_default:true,harness:'hermes',status:'running',privacy:'standard',model:{provider:'fixture',model:'fixture'}}]});
    if (u.pathname === '/wizard/thread-seen') return json({state:{initializedAt:1,threads:{}}});
    if (u.pathname === '/wizard/v1/ui-preferences') return json({spaces:[],pinnedChats:[],readyOrder:'newest',migrations:{'launcher.v1':true}});
    if (u.pathname.startsWith('/wizard/')) return json({});
    if (!u.pathname.startsWith('/wizard-os-home/')) return json({});
    return r.continue();
  });
  await ctx.addInitScript(({desktop,skin}) => {
    localStorage.setItem('wos.coached','true');localStorage.setItem('wos.welcome.v1','done');localStorage.setItem('wos.voiceTipSeen','true');localStorage.setItem('wos.shell',desktop?'desktop':'phone');localStorage.setItem('wos.skin',skin);
    const wins={wmain:{id:'wmain',app:'chats',thread:null}}, desk={id:'dmain',wins:['wmain'],focus:'wmain'};
    if(desktop){localStorage.setItem('wux.desk.wins',JSON.stringify(wins));localStorage.setItem('wux.desk.ws',JSON.stringify([desk]));localStorage.setItem('wux.desk.cur','0');localStorage.setItem('wux.desk.homeOpen','false');}
    else{localStorage.setItem('wos.wins4',JSON.stringify(wins));localStorage.setItem('wos.strip',JSON.stringify([{id:'home',home:true,wins:[],focus:null},desk]));localStorage.setItem('wos.idx4','1');localStorage.setItem('wos.idxDesk',JSON.stringify('dmain'));}
  },{desktop,skin});
  const p = await ctx.newPage(); p.setDefaultTimeout(15000);
  const errors = []; p.on('pageerror',e => errors.push(e.message));
  try {
    await p.goto(origin + (desktop ? 'desktop.html' : ''),{waitUntil:'domcontentloaded'});
    await p.waitForFunction(() => (window.__wux || window.__wos)?.live?.ok);
    await p.evaluate(({desktop,thread}) => {
      const a=window.__wux||window.__wos;
      if(desktop){a.newWin({app:'chats',thread:thread||null});a.closeWin('wmain');}
      else{const w=a.wins.wmain;a.goDesk(a.desks.findIndex(d=>d.wins.includes(w.id)));a.focusWin(w.id);a.chats.renderChats(w);}
    },{desktop,thread});
    const target = p.locator('.ch-list [data-sec]:not([data-sec="archive"]) [data-chopen="tap-thread"]').first(); await target.waitFor();
    const listId = await target.evaluate(node => node.closest('[data-chats]').dataset.chats);
    // The desktop also caches a hidden list in the thread pane after threadBack.
    // Assert the actual list pane, not duplicate rows in that hidden cache.
    const active = `[data-chats="${listId}"] [data-sec]:not([data-sec="archive"]) [data-chopen="tap-thread"]`;
    check(await p.evaluate(s => WosSkin.current === s && document.documentElement.dataset.skin === s, skin), `${label} actual shell skin`);
    await p.screenshot({path:path.join(out,label.replace(/[^a-z0-9-]/gi,'-')+'-before.png')});
    // Real context-menu input holds background paints; the action must still paint itself.
    await target.click({button:'right'});
    await p.locator('[data-rsact="done"]').waitFor();
    if (held) {
      await p.evaluate(() => {const n=document.querySelector('.ch-list .ch-scroll');n.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,changedTouches:[new Touch({identifier:99,target:n,clientX:10,clientY:10})]}));});
      check(await p.evaluate(()=>{const b=document.querySelector('.ch-list [data-chopen="tap-thread"]'),id=b.closest('[data-chats]').dataset.chats;return __wux.chats.holdList(id);}), `${label} real list guard held before tap`);
    }
    await p.evaluate(active => {
      window.__tap = {start:0,gone:null,sameTask:false};
      document.addEventListener('click',e=>{if(e.target.closest('[data-rsact="done"]')) __tap.start=performance.now();},true);
      const mo=new MutationObserver(()=>{if(__tap.start&&!document.querySelector(active)&&__tap.gone===null)__tap.gone=performance.now()-__tap.start;});
      mo.observe(document.body,{childList:true,subtree:true});
      document.addEventListener('click',()=>{if(__tap.start)__tap.sameTask=!document.querySelector(active);});
    }, active);
    await p.locator('[data-rsact="done"]').click();
    await p.waitForTimeout(100);
    const early = await p.evaluate(active => ({...__tap,rows:document.querySelectorAll(active).length}), active);
    measurements.push({label,...early});
    check(early.rows === 0 && early.gone !== null && early.gone <= 100 && early.sameTask, `${label} archived in click task, <=100ms`,JSON.stringify(early));
    check(writes === 1 && !settled, `${label} backend still pending for 5s`);
    await p.waitForTimeout(5100);
    if(status === 500){
      await p.locator(active).first().waitFor({state:'visible',timeout:2500});
      const restored = await p.locator(active).evaluateAll(nodes => nodes.map(n => ({owner:n.closest('[data-chats]')?.dataset.chats,section:n.closest('[data-sec]')?.dataset.sec,visible:!!n.getClientRects().length,html:n.outerHTML.slice(0,140)})));
      check(restored.length === 1, `${label} failure restores row`,JSON.stringify(restored));
      check(await p.locator('#toast').innerText().then(s=>s.includes('!')&&s.includes('Couldn’t archive')),`${label} failure shows ! toast`);
    } else check(await p.locator(active).count() === 0, `${label} successful reconciliation stays archived`);
    await p.screenshot({path:path.join(out,label.replace(/[^a-z0-9-]/gi,'-')+'.png')});
    check(errors.length === 0, `${label} no page errors`,errors.join(' | '));
    if (desktop && status === 200) {
      const result=await p.evaluate(()=>{const a=__wux,id=Object.keys(a.wins)[0],start=performance.now();a.closeWin(id);return {ms:performance.now()-start,removed:!a.wins[id]&&!document.querySelector(`.win[data-win="${id}"]`)};});
      check(result.removed&&result.ms<=100, `${label} desktop window close synchronous`,JSON.stringify(result));
    }
  } catch(e) {check(false,label+' fixture/run',e.stack);console.log('DIAGNOSTIC',JSON.stringify(await p.evaluate(()=>({shell:!!(window.__wux||window.__wos),live:(window.__wux||window.__wos)?.live?.ok,text:document.body.innerText.slice(0,1200)}))),errors);}
  finally {await ctx.close();}
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=process.argv[2]||`http://127.0.0.1:${server.address().port}/wizard-os-home/`;
  const browser=await chromium.launch({executablePath:process.env.QA_CHROME||undefined,args:['--no-sandbox']});
  try {
    for(const [desktop,thread] of (process.env.QA_QUICK ? [[true,'__new__']] : [[false,null],[true,'__new__'],[true,'tap-thread']]))for(const status of (process.env.QA_QUICK ? [500] : [200,500]))await scenario(browser,origin,desktop,thread,status);
    if(!process.env.QA_BASE_CHATS)await scenario(browser,origin,true,'__new__',500,'nebula',true);
  } finally {await browser.close();server.close();}
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed,failed,measurements},null,2));
  console.log(`${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);server.close();process.exitCode=2;});
