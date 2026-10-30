// Synthetic shell acceptance. No live reads; every write intercepted, no agent sends.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('./tools/qa-playwright.cjs');
const BASE=process.argv[2]||process.env.QA_ORIGIN;
if(!BASE) throw Error('Pass a synthetic origin URL');
const entry=new URL(BASE);
assert.equal(entry.pathname,'/wizard-os-home/','Fixture entry must match its shell asset route');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(entry.hostname),'Synthetic loopback origin required');
const ORIGIN=entry.origin,WEB=process.env.QA_WEB_DIR||__dirname;
const SHOTS=process.env.QA_OUT;if(!SHOTS)throw Error('QA_OUT required');
fs.mkdirSync(SHOTS,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results=[],diagnostics=[];
async function check(name,fn,p){try{await fn();results.push({name,pass:true});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:String(e)});console.log('FAIL',name,String(e));if(p)await p.screenshot({path:path.join(SHOTS,name.replace(/[^a-z0-9]/gi,'-')+'.png')}).catch(()=>{});}fs.writeFileSync(path.join(SHOTS,'results.json'),JSON.stringify({results,writes:W.writes},null,2));}
const NOW = Date.now(), MIN = 6e4;
const VIDEO_ID = '0123456789abcdef0123456789abcdef';
const W = {
  fast:true, writes: [], foreign: [], requests: [], routeErrors: [], bodyPending: 0, msgFetch: [], searchFetch: [], down: false, offline: false, voice: 'ok', brokenApp: false,
  threads: Array.from({ length: 12 }, (_, i) => ({ id: 'qa_t' + String(i).padStart(2, '0'), title: `Thread ${i}`, preview: `Preview line ${i}`, at: NOW - (i * 10 + 2) * MIN, status: 'completed', level: '' })),
};
W.threads[5].title = 'Quokka budget review';
W.threads[1].title = 'Neutral second thread';
W.threads[2].status = 'completed'; // an error card already: not in the banner
const BODY = {
  qa_t03: 'Here is the zebracorn migration plan we discussed: phase one moves the archive, phase two the index.',
  qa_t40: 'Older note: the zebracorn idea came up first in this thread.',
  qa_t08: `Open the other one here: [that thread](${BASE}?session=qa_t09) and carry on.`,
};
function sessionRow(t) {
  return { id: t.id, title: t.title, status: t.status, message_count: 2, last_active: new Date(t.at).toISOString(), wizard_activity_at: new Date(t.at).toISOString(),
    wizard_last_assistant_at: new Date(t.at).toISOString(), latest_message: { role: 'assistant', content: t.preview, timestamp: t.at / 1000 }, wizard_attention_level: t.level || undefined };
}
function messages(id) {
  const t = W.threads.find(x => x.id === id); const at = (t ? t.at : NOW) / 1000;
  return [{ id: 1, role: 'user', content: `Question for ${id}`, timestamp: at - 60 }, { id: 2, role: 'assistant', content: BODY[id] || `Plain answer in ${id}.`, timestamp: at }];
}
const SHELL = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'application/javascript' };

async function context(b, { desktop = false } = {}) {
  const ctx = await b.newContext(desktop
    ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true, serviceWorkers: 'block' }
    : { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36', ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    W.requests.push({method:m,url:u.href,type:q.resourceType()});
    try {
    if (W.offline && (u.pathname.startsWith('/wizard/') || u.pathname.startsWith('/troubleshoot/'))) return r.abort('internetdisconnected');
    if (u.origin !== ORIGIN) { W.foreign.push(u.href); return r.abort(); }
    const json = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    const sh = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (sh && (m === 'GET' || m === 'HEAD')) {
      const f = sh[1] || 'index.html', p = path.join(WEB, 'web', f);
      if (W.brokenApp && f === 'app.js') return r.fulfill({ status: 200, contentType: 'application/javascript', body: "throw new Error('QA broke the shell on purpose');" });
      if (/^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return r.fulfill({status:404,body:'Missing synthetic asset: '+f});
      return r.fulfill({ status: 200, contentType: SHELL[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(p) });
    }
    if (m !== 'GET' && m !== 'HEAD') {
      W.writes.push(`${m} ${u.pathname}`);
      if (u.pathname === '/wizard/thread-seen') return json({ state: JSON.parse(q.postData() || '{}').state || { initializedAt: NOW, threads: {} } });
      return json({ error: 'qa: write refused' }, 403);
    }
    if (u.pathname === '/wizard/v1/bootstrap') return json({ bootstrap: 1, api: 'wizard-agent-service/1', settings: { owner: { name: 'Robin', place: '' }, agent: { name: 'Merlin' }, clock: { timezone: 'UTC', day_starts_at: '06:00' }, voice: { language: 'en', vocabulary: [] } },
      capabilities: { voice: true, router: true, files: true, approvals: true, steer: true, markdown: true }, endpoints: { sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs', transcribe: '/wizard/voice/transcribe', route: '/wizard/v1/route', upload: '/wizard/files/upload', apps: '/wizard/v1/apps' } });
    if (u.pathname === '/wizard/v1/agents') return json({agents:[{id:'hermes',label:'Merlin',is_default:true,status:'running'}]});
    if (u.pathname === '/wizard/voice/status') return W.voice === 'ok' ? json({ ready: true, provider: 'tinfoil', name: 'Tinfoil', model: 'voxtral-small-24b', attested: true }) : json({ error: 'down' }, 503);
    if (u.pathname === '/wizard/hermes/api/sessions') {
      if (W.down) return json({ error: 'unavailable' }, 503);
      if (u.searchParams.get('q')) W.searchFetch.push(u.searchParams.get('q'));
      if(W.fast && u.searchParams.get('fields')==='slim') {
        const extra={id:'qa_archived',agent:'hermes',title:'Zirconium archived thread',preview:'Old preview',status:'completed',archived:true,cardTime:new Date(NOW-20*864e5).toISOString()};
        const cursor=u.searchParams.get('cursor');
        const data=cursor?[extra,{...extra,id:'qa_private',agent:'private',title:'private sentinel'}]:W.threads.map(t=>({id:t.id,agent:'hermes',title:t.title,preview:t.preview,status:t.status,archived:false,cardTime:new Date(t.at).toISOString()}));
        return json({data,fields:'slim',view:'list',list_version:1,window:'archive-50',account_scope:'qa-owner',build:'qa-index-build',snapshot:'qa-index-snapshot',has_more:false,archive_cursor:cursor?null:'qa-index-snapshot:50'});
      }
      if(W.fast && u.searchParams.get('mode')==='body') {
        if(W.fastFail) return json({error:'busy'},503);
        const word=u.searchParams.get('q').toLowerCase(); W.bodyPending++;
        try { await sleep(900);
        const data=Object.entries(BODY).filter(([,body])=>body.toLowerCase().includes(word)).map(([id,snippet])=>({id,agent:'hermes',snippet}));
        return await json({data,view:'list',list_version:1,mode:'body',search_total:data.length,partial:false,timings:{list_ms:0,fts_ms:1,read_ms:1}}).catch(()=>{});
        } finally { W.bodyPending--; }
      }
      const off = +(u.searchParams.get('offset') || 0), lim = +(u.searchParams.get('limit') || 100);
      const rows = W.threads.slice(off, off + lim).map(sessionRow);
      return json({ data: rows, has_more: off + lim < W.threads.length });
    }
    const mm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm) {
      const id = decodeURIComponent(mm[1]); W.msgFetch.push({ id, order: u.searchParams.get('order'), limit: u.searchParams.get('limit') });
      await sleep(u.searchParams.get('order') === 'latest' ? 120 : 10); // body search is slow enough to cancel
      return json({ object: 'list', data: messages(id), pagination: { returned: 2 } }).catch(() => {});
    }
    const sm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)$/);
    if (sm) { const t = W.threads.find(x => x.id === decodeURIComponent(sm[1])); return t ? json({ session: sessionRow(t) }) : json({ error: 'not_found' }, 404); }
    if (u.pathname === `/wizard/attachments/${VIDEO_ID}`) return r.fulfill({ status: 200, headers: { 'content-type': 'video/mp4', 'content-disposition': 'inline; filename="qa-clip.mp4"' }, body: m === 'HEAD' ? '' : Buffer.alloc(64) });
    if (u.pathname.startsWith('/wizard/attachments/')) return json({ error: 'not_found' }, 404);
    if (u.pathname === '/wizard/thread-seen') return json({ state: { initializedAt: NOW - 864e5, threads: {} } });
    if (u.pathname === '/wizard/thread-dispositions') return json({ state: {} });
    if (u.pathname === '/wizard/v1/apps') return json({ apps: [] });
    return json({});
    } catch(e) { W.routeErrors.push({method:m,url:u.href,error:String(e),stack:e.stack}); await r.fulfill({status:500,body:'Synthetic route failed'}).catch(()=>{}); }
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1','true');localStorage.setItem('wux.desk.homeOpen','false');localStorage.setItem('wos.skin','nebula'); } catch (e) {} });
  return ctx;
}

async function boot(b,desktop){
 const ctx=await context(b,{desktop}),p=await ctx.newPage(),tag=desktop?'desktop':'phone';
 p.setDefaultTimeout(6000);p.setDefaultNavigationTimeout(15000);
 const d={profile:tag,entry:BASE,pageErrors:[],requestFailures:[],httpErrors:[]};diagnostics.push(d);p.errors=d.pageErrors;
 p.on('pageerror',e=>p.errors.push(String(e)));
 p.on('requestfailed',q=>d.requestFailures.push({url:q.url(),error:q.failure()?.errorText}));
 p.on('response',r=>{if(r.status()>=400)d.httpErrors.push({url:r.url(),status:r.status()});});
 try {
  await p.goto(BASE);await p.waitForFunction(()=> (window.__wux||window.__wos)?.live?.ok,null,{timeout:15000});
  await p.waitForTimeout(700);return {ctx,p};
 } catch(e) {
  d.error=String(e);d.url=p.url();d.requests=W.requests;d.routeErrors=W.routeErrors;
  d.shell=await p.evaluate(()=>({title:document.title,shell:document.documentElement.dataset.shell,desktop:!!window.__wux,phone:!!window.__wos,liveError:(window.__wux||window.__wos)?.live?.error})).catch(x=>({error:String(x)}));
  fs.writeFileSync(path.join(SHOTS,tag+'-boot-failure.json'),JSON.stringify(d,null,2));
  await p.screenshot({path:path.join(SHOTS,tag+'-boot-failure.png')}).catch(()=>{});await ctx.close();throw e;
 }
}
async function win(p){return p.evaluate(()=>Object.values((window.__wux||window.__wos).wins).find(w=>w.app==='chats').id);}
async function state(p,id,desktop){return p.evaluate(({id,desktop})=>{const a=window.__wux||window.__wos,c=a.chats.ch(id+(desktop?'::list':''));return {q:c.q,filter:c.filter,sheet:c.sheet,thread:a.wins[id]?.thread,runs:WizCore.chatSearch.stats.runs};},{id,desktop});}
async function setup(p,id,desktop,{thread=null,filter='',q=''}={}){await p.evaluate(({id,desktop,thread,filter,q})=>{const a=window.__wux||window.__wos,w=a.wins[id];w.thread=thread;const c=a.chats.ch(id+(desktop?'::list':''));c.q=q;c.filter=filter;c.sheet=false;if(desktop){a.focusWin(id);a.chats.openChat(id,thread);a.chats.renderChats({id:id+'::list',thread:null});}else{a.goDesk(a.desks.findIndex(d=>d.wins.includes(id)));a.chats.openChat(id,thread);a.chats.renderChats(w);}},{id,desktop,thread,filter,q});await sleep(600);}
function input(p,id,desktop){return p.locator(`[data-chats="${id}${desktop?'::list':''}"] [data-chsearch]`);}
(async()=>{const b=await chromium.launch({executablePath:process.env.QA_CHROME||undefined,args:['--use-gl=swiftshader','--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
try{for(const desktop of [true,false]){const {ctx,p}=await boot(b,desktop),id=await win(p),tag=desktop?'desktop':'phone';
await check(tag+' startup shell + no crossload',async()=>{assert.equal(await p.evaluate(()=>document.documentElement.dataset.shell),desktop?'desktop':'phone');assert.equal(p.errors.length,0,p.errors.join('|'));},p);
await setup(p,id,desktop,{thread:desktop?'qa_t05':null,filter:'unread'});
await check(tag+' focused search Escape clears stored query and keeps chip/thread',async()=>{const s=input(p,id,desktop);await s.fill('Quokka');await p.keyboard.press('Escape');await sleep(150);const c=await state(p,id,desktop);assert.equal(c.q,'');assert.equal(await s.inputValue(),'');assert.equal(c.filter,'unread');assert.equal(c.thread,desktop?'qa_t05':null);assert.ok(!c.runs[id+(desktop?'::list':'')]);},p);
await setup(p,id,desktop,{thread:desktop?'qa_t05':null});
await check(tag+' in-flight body response cannot restore cancelled results',async()=>{const s=input(p,id,desktop);await s.fill('zebracorn');await p.waitForFunction(key=>WizCore.chatSearch.stats.runs[key]?.busy,id+(desktop?'::list':''));const until=Date.now()+2000;while(!W.bodyPending&&Date.now()<until)await sleep(10);assert.ok(W.bodyPending>0,'Actual delayed body request must be pending');await p.keyboard.press('Escape');await sleep(1200);const c=await state(p,id,desktop);assert.equal(c.q,'');assert.ok(!c.runs[id+(desktop?'::list':'')]);assert.equal(await p.locator('[data-chbs]').count(),0);},p);
await setup(p,id,desktop,{thread:desktop?'qa_t05':null,filter:'unread',q:'Quokka'});
await check(tag+' layers sheet then query then last chip',async()=>{await input(p,id,desktop).click();await p.locator(`[data-chats="${id}${desktop?'::list':''}"] [data-chfbtn]`).click();await p.keyboard.press('Escape');assert.equal((await state(p,id,desktop)).q,'Quokka');await input(p,id,desktop).focus();await p.keyboard.press('Escape');let c=await state(p,id,desktop);assert.equal(c.q,'');assert.equal(c.filter,'unread');await input(p,id,desktop).focus();await p.keyboard.press('Escape');c=await state(p,id,desktop);assert.equal(c.filter,'');assert.equal(c.thread,desktop?'qa_t05':null);},p);
if(desktop){
await setup(p,id,true,{thread:'qa_t05',filter:'unread',q:'Quokka'});
await check('desktop held Escape consumes only query',async()=>{await input(p,id,true).focus();await p.keyboard.down('Escape');await p.keyboard.down('Escape');await p.keyboard.up('Escape');const c=await state(p,id,true);assert.equal(c.q,'');assert.equal(c.filter,'unread');assert.equal(c.thread,'qa_t05');},p);
await setup(p,id,true,{thread:'qa_t05',q:'Quokka'});
await check('desktop composing Escape leaves query and thread',async()=>{await input(p,id,true).focus();await input(p,id,true).evaluate(n=>n.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',isComposing:true,bubbles:true,cancelable:true})));const c=await state(p,id,true);assert.equal(c.q,'Quokka');assert.equal(c.thread,'qa_t05');},p);
await check('desktop palette owns first Escape',async()=>{await p.keyboard.press('Alt+Space');await p.keyboard.press('Escape');assert.equal((await state(p,id,true)).q,'Quokka');},p);
await check('desktop second Chats window cancellation remains isolated',async()=>{const other=await p.evaluate(()=>__wux.newWin({app:'chats',thread:null}));const oid=typeof other==='string'?other:other?.id;assert.ok(oid,'newWin id');await setup(p,oid,true,{q:'Neutral'});await input(p,oid,true).focus();await p.keyboard.press('Escape');assert.equal((await state(p,oid,true)).q,'');assert.equal((await state(p,id,true)).q,'Quokka');await p.evaluate(id=>__wux.closeWin(id),oid);},p);
await setup(p,id,true,{thread:null});await check('desktop empty Chats root stays open',async()=>{await input(p,id,true).focus();await p.keyboard.press('Escape');assert.ok(await p.evaluate(id=>!!__wux.wins[id],id));assert.equal((await state(p,id,true)).thread,null);},p);
await setup(p,id,true,{thread:'qa_t05',q:'Quokka'});await check('desktop thread-pane Escape preserves parked query',async()=>{await p.locator(`.win[data-win="${id}"] .pane-main textarea`).focus();await p.keyboard.press('Escape');const c=await state(p,id,true);assert.equal(c.thread,null);assert.equal(c.q,'Quokka');},p);
}
await setup(p,id,desktop,{q:'Quokka'});
await check(tag+' live skin change preserves search state and tokens',async()=>{for(const skin of ['nebula','grove']){await p.evaluate(d=>d?__wux.openSettings('appearance'):__wos.openSheet('settings'),desktop); const appearance=p.locator('[data-st-page="appearance"]');if(await appearance.isVisible())await appearance.click();await p.locator('[data-skinfamily="wizard"]').click();await p.locator(`[data-skinpick="${skin}"]`).click();await p.evaluate(d=>d?__wux.closeSettings():__wos.closeSheets(),desktop);await sleep(900);assert.equal(await p.evaluate(()=>WosSkin.current),skin);assert.equal((await state(p,id,desktop)).q,'Quokka');assert.ok(await p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--wz-panel').trim()));await p.screenshot({path:path.join(SHOTS,tag+'-'+skin+'.png')});}},p);
await check(tag+' no page errors and zero agent sends',async()=>{assert.deepEqual(p.errors,[]);assert.deepEqual(W.routeErrors,[]);assert.equal(W.writes.filter(x=>/\/v1\/runs|POST .*\/api\/sessions(?:$|\/.*\/steer)/.test(x)).length,0);},p);
await ctx.close();}}
finally{await b.close();fs.writeFileSync(path.join(SHOTS,'results.json'),JSON.stringify({results,writes:W.writes,foreign:W.foreign,diagnostics,requests:W.requests,routeErrors:W.routeErrors},null,2));}
process.exitCode=results.some(r=>!r.pass)?1:0;
})().catch(e=>{console.error(e);fs.writeFileSync(path.join(SHOTS,'fatal.json'),JSON.stringify({error:String(e),stack:e.stack,results,diagnostics,requests:W.requests,routeErrors:W.routeErrors},null,2));process.exitCode=2;});
