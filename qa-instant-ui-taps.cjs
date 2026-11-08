// Isolated full-shell regression: no live backend, no agent writes. Run on the Linux browser worker.
// QA_BASE_CHATS can serve the original chats.js for a failing-first A/B, without changing the checkout.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const fx=require('./tools/qa-proof-fixture.cjs'),crypto=require('node:crypto');
fx.failAtExit(() => out); // collect-all: one run reports every uncatalogued request, then exits non-zero
if(process.argv[2])throw Error('Network origins refused: synthetic fixture only');
const morning=process.env.QA_MORNING_DIR;if(!morning)throw Error('Pinned QA_MORNING_DIR required');
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
  const ctx = await browser.newContext({ viewport:desktop ? {width:1600,height:1000} : {width:412,height:892}, hasTouch:!desktop, isMobile:!desktop, serviceWorkers:'allow' });
  let hideRequests = 0, hideSettled = false, statusReads = 0;
  const model = { day:'2026-11-04', done:0,total:4,next:'workout',next_label:'Workout',hidden:false,steps:Object.fromEntries(['workout','meditate','mindfeed','read'].map(k=>[k,{done:false}])) };
  await ctx.addInitScript(require('./tools/qa-no-service-workers.cjs').blockServiceWorkerRegistration);
  await ctx.routeWebSocket('**/*',ws=>ws.close());
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), json = (body, code = 200) => r.fulfill({status:code,json:body});
    if(u.origin!==new URL(origin).origin)return r.abort();
    if(u.pathname==='/morning/ready.json')return json({contract:'wizard.ready-extension/1',module_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(morning,'web/shell.js'))).digest('hex'),style_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(morning,'web/shell.css'))).digest('hex')});
    if(/^\/morning\/(shell.js|shell.css)$/.test(u.pathname)){const f=path.join(morning,'web',path.basename(u.pathname)),b=fs.readFileSync(f);if(u.searchParams.get('sha256')!==crypto.createHash('sha256').update(b).digest('hex'))return r.abort();return r.fulfill({path:f});}
    if (u.pathname === '/morning/api/hide') {
      hideRequests++;
      await new Promise(resolve => setTimeout(resolve, 5000));
      hideSettled = true;
      if (status === 200) model.hidden = true;
      return json(status === 200 ? model : {error:'fixture failure'},status).catch(() => {});
    }
    if (u.pathname === '/morning/api/status') { statusReads++; return json(model); }
    if (u.pathname === '/wizard/v1/bootstrap') return json({bootstrap:1,settings:{agent:{name:'Wizard'},clock:{timezone:'UTC'}},capabilities:{},endpoints:{apps:'/wizard/v1/apps',sessions:'/wizard/hermes/api/sessions'}});
    if (u.pathname === '/wizard/v1/setup') return json({first_run:false});
    if (u.pathname === '/wizard/hermes/api/model/options') return json({provider:'fixture',providers:[{slug:'fixture',authenticated:true,models:[]}]});
    if (u.pathname === '/wizard/v1/apps') return json({apps:[fx.app('morning')]});
    if (u.pathname === '/wizard/hermes/api/sessions') return json({data:[row],has_more:false});
    if (u.pathname.endsWith('/messages')) return json({data:[{id:1,role:'user',content:'Fixture question',timestamp:now-30},{id:2,role:'assistant',content:'Fixture reply',timestamp:now}],has_more:false});
    if (u.pathname.endsWith('/sessions/tap-thread')) return json({session:row});
    if (u.pathname === '/wizard/v1/agents') return json({agents:[{id:'hermes',label:'Wizard',is_default:true,harness:'hermes',status:'running',privacy:'standard',model:{provider:'fixture',model:'fixture'}}]});
    if (u.pathname === '/wizard/thread-seen') return json({state:{initializedAt:1,threads:{}}});
    if (u.pathname === '/wizard/v1/ui-preferences') return json({spaces:[],pinnedChats:[],readyOrder:'newest',migrations:{'launcher.v1':true}});
    if (u.pathname.startsWith('/wizard/')) return r.fulfill(fx.response(u.pathname+(u.pathname==='/wizard/v1/my-skin'?u.search:''),q.method()));
    if(!['GET','HEAD'].includes(q.method()))return r.fulfill(fx.response(u.pathname,q.method())); // unlisted write: refused (451) and collected
    if (!u.pathname.startsWith('/wizard-os-home/')) return r.fulfill(fx.response(u.pathname,q.method())); // unknown non-shell path: refused and collected, never an empty success
    return r.continue();
  });
  await ctx.addInitScript(({desktop,skin}) => {
    if(window!==top)return;localStorage.setItem('wos.coached','true');localStorage.setItem('wos.welcome.v1','done');localStorage.setItem('wos.voiceTipSeen','true');localStorage.setItem('wos.shell',desktop?'desktop':'phone');localStorage.setItem('wos.skin',skin);
    const wins={wmain:{id:'wmain',app:'chats',thread:null}}, desk={id:'dmain',wins:['wmain'],focus:'wmain'};
    if(desktop){localStorage.setItem('wux.desk.wins',JSON.stringify(wins));localStorage.setItem('wux.desk.ws',JSON.stringify([desk]));localStorage.setItem('wux.desk.cur','0');localStorage.setItem('wux.desk.homeOpen','false');}
    else{localStorage.setItem('wos.wins4',JSON.stringify(wins));localStorage.setItem('wos.strip',JSON.stringify([{id:'home',home:true,wins:[],focus:null},desk]));localStorage.setItem('wos.idx4','1');localStorage.setItem('wos.idxDesk',JSON.stringify('dmain'));}
  },{desktop,skin});
  const p = await ctx.newPage(); p.setDefaultTimeout(15000);
  const errors = []; p.on('pageerror',e => errors.push(e.message));
  try {
    await p.goto(origin + (desktop ? 'desktop.html' : ''),{waitUntil:'domcontentloaded'});
    await p.waitForFunction(() => (window.__wux || window.__wos)?.live?.ok && window.WizCanOpen?.('morning'));
    // The initial async status can miss the first desktop paint on the original code. A fresh window is
    // the real user path that displays it, then leaves a New chat / existing thread beside its list.
    if (!statusReads) await p.waitForResponse(r => r.url().includes('/morning/api/status'));
    await p.waitForTimeout(100);
    await p.evaluate(({desktop,thread}) => {
      const a=window.__wux||window.__wos;
      if(desktop){a.newWin({app:'chats',thread:thread||null});a.closeWin('wmain');}
      else{const w=a.wins.wmain;a.goDesk(a.desks.findIndex(d=>d.wins.includes(w.id)));a.focusWin(w.id);a.chats.renderChats(w);}
    },{desktop,thread});
    const card = p.locator('.ch-morning-w:visible').first(); await card.waitFor();
    check(await p.evaluate(s => WosSkin.current === s && document.documentElement.dataset.skin === s, skin), `${label} actual shell skin`);
    await p.screenshot({path:path.join(out,label.replace(/[^a-z0-9-]/gi,'-')+'-before.png')});
    if (held) {
      // A live touch/reading guard must not swallow an explicit dismiss.
      await p.evaluate(() => {const n=document.querySelector('.ch-morning-w').closest('.ch-scroll');n.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,changedTouches:[new Touch({identifier:99,target:n,clientX:10,clientY:10})]}));});
      check(await p.evaluate(()=>{const b=document.querySelector('[data-chmorninghide]'),id=b.closest('[data-chats]').dataset.chats;return __wux.chats.holdList(id);}), `${label} real list guard held before tap`);
    }
    await p.evaluate(() => {
      window.__tap = {start:0,gone:null,sameTask:false,paintBeforeFetch:false};
      const realFetch=window.fetch;window.fetch=function(input,...args){if(String(input).includes('/morning/api/hide'))__tap.paintBeforeFetch=!document.querySelector('.ch-morning-w');return realFetch.call(this,input,...args);};
      document.addEventListener('click',e=>{if(e.target.closest('[data-chmorninghide]')) __tap.start=performance.now();},true);
      const mo=new MutationObserver(()=>{if(__tap.start&&!document.querySelector('.ch-morning-w')&&__tap.gone===null)__tap.gone=performance.now()-__tap.start;});
      mo.observe(document.body,{childList:true,subtree:true});
      document.addEventListener('click',e=>{if(__tap.start)__tap.sameTask=!document.querySelector('.ch-morning-w');});
    });
    await card.locator('[data-chmorninghide]').click();
    await p.waitForTimeout(100);
    const early = await p.evaluate(() => ({...__tap,cards:document.querySelectorAll('.ch-morning-w').length}));
    measurements.push({label,...early});
    check(early.cards === 0 && early.gone !== null && early.gone <= 100 && early.sameTask && early.paintBeforeFetch, `${label} gone in click task, <=100ms`,JSON.stringify(early));
    check(hideRequests === 1 && !hideSettled, `${label} backend still pending for 5s`);
    // A stale status message must not put a pending tap back on screen.
    await p.evaluate(model=>postMessage({type:'wizard:morning',status:model},location.origin), {...model,hidden:false});
    await p.waitForTimeout(50);
    check(await p.locator('.ch-morning-w').count() === 0, `${label} stale status cannot undo pending hide`);
    await p.waitForTimeout(5100);
    if(status === 500){
      check(await p.locator('.ch-morning-w').count() === 1, `${label} failure restores card`);
      check(await p.locator('#toast').innerText().then(s=>s.includes('!')&&s.includes('Save outcome unknown')),`${label} failure shows ! toast`);
    } else check(await p.locator('.ch-morning-w').count() === 0, `${label} successful reconciliation stays hidden`);
    await p.screenshot({path:path.join(out,label.replace(/[^a-z0-9-]/gi,'-')+'.png')});
    check(errors.length === 0, `${label} no page errors`,errors.join(' | '));
    if (desktop && status === 200) {
      const result=await p.evaluate(()=>{const a=__wux,id=Object.keys(a.wins)[0],start=performance.now();a.closeWin(id);return {ms:performance.now()-start,removed:!a.wins[id]&&!document.querySelector(`.win[data-win="${id}"]`)};});
      check(result.removed&&result.ms<=100, `${label} desktop window close synchronous`,JSON.stringify(result));
    }
  } catch(e) {check(false,label+' fixture/run',e.stack);console.log('DIAGNOSTIC',JSON.stringify(await p.evaluate(()=>({shell:!!(window.__wux||window.__wos),live:(window.__wux||window.__wos)?.live?.ok,can:window.WizCanOpen?.('morning'),text:document.body.innerText.slice(0,1200)}))),errors);}
  finally {await ctx.close();}
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}/wizard-os-home/`;
  const browser=await chromium.launch({executablePath:process.env.QA_CHROME||undefined,args:['--no-sandbox']});
  try {
    for(const [desktop,thread] of (process.env.QA_QUICK ? [[true,'__new__']] : [[false,null],[true,'__new__'],[true,'tap-thread']]))for(const status of (process.env.QA_QUICK ? [500] : [200,500]))await scenario(browser,origin,desktop,thread,status);
    if(!process.env.QA_BASE_CHATS)await scenario(browser,origin,true,'__new__',500,'nebula',true);
  } finally {await browser.close();server.close();}
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed,failed,measurements},null,2));
  console.log(`${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);server.close();process.exitCode=2;});
