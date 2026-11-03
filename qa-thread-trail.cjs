// QA: thread trail (feature/thread-trail). A thread opened from a link inside another thread returns to that
// thread on Done, Defer and Back, instead of dropping to the Chats list. Opening from the list still returns to the
// list, and Back never leaves the app.
//
// James, 10 Oct 2026: "where I click to a thread from another thread, if I hit done to archive it, it should push
// me just back one screen to the previous one I was on."
//
// Real Wizard reads; fixture threads merged into the session list; EVERY write is intercepted (zero reach Archimedes).
// Usage: node tools/qa-origin.cjs 9481 <tree>/web &  then  QA_WEB_DIR=<tree> node qa-thread-trail.cjs [url]
const pw = require('./tools/qa-playwright.cjs');
const { chromium } = pw;
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9481/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || '';
const OUT = process.env.QA_OUT || require('./tools/qa-paths.cjs').workPath('wos-thread-trail-shots');
const EXEC = process.env.QA_CHROME || (process.env.QA_CHROME || undefined);
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === '' ? '' : JSON.stringify(extra).slice(0, 400)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const origin = new URL(URL_).origin;

const now = Date.now() / 1000;
let rid = 1;
const row = (role, content, ts) => ({ id: rid++, session_id: '', role, content, timestamp: ts });
const FIX = {
  qa_tt_sum: { title: 'QA trail summary', t: now - 30, rows: () => [row('user', 'Summarise my open threads', now - 300), row('assistant',
    `${'Roundup context paragraph.\n\n'.repeat(20)}Here are your threads:\n\n- [Thread A](/wizard/?session=qa_tt_a): done.\n- [Thread B](/wizard/?session=qa_tt_b): needs you.\n- [Thread C](${origin}/wizard-os-home/?session=qa_tt_c): own-page link.\n\n${'Remaining roundup notes.\n\n'.repeat(25)}`, now - 250)] },
  qa_tt_a: { title: 'QA trail A', t: now - 40, rows: () => [row('user', 'Thread A ask', now - 400), row('assistant', 'Thread A answer. See also [Thread B](/wizard/?session=qa_tt_b).', now - 350)] },
  qa_tt_b: { title: 'QA trail B', t: now - 41, rows: () => [row('user', 'Thread B ask', now - 400), row('assistant', 'Thread B answer.', now - 350)] },
  qa_tt_c: { title: 'QA trail C', t: now - 42, rows: () => [row('user', 'Thread C ask', now - 400), row('assistant', 'Thread C answer.', now - 350)] },
};
const ARCH = new Set(), DEF = new Set();
const HOLD = new Map(); // session id -> release(): its history read waits until the test lets it land
function fixSession(id) {
  const f = FIX[id], rows = f.rows(), last = rows[rows.length - 1], lastU = rows[0];
  return { id, agent: 'hermes', runtime: 'hermes', source: 'wizard-mobile', title: f.title, status: 'completed', archived: ARCH.has(id), hidden: false, message_count: rows.length,
    started_at: f.t - 600, last_active: f.t, wizard_last_user_at: lastU.timestamp, wizard_last_assistant_at: f.t, wizard_activity_at: f.t, wizard_run_id: '',
    wizard_deferred: DEF.has(id) || undefined,
    latest_message: { role: last.role, content: String(last.content).slice(0, 200), timestamp: last.timestamp },
    last_user_message: { role: 'user', content: lastU.content, timestamp: lastU.timestamp } };
}
const writes = [];
function routeFor() {
  return async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    const wm = u.pathname.match(/\/wizard-os-home\/((?:core\/|desktop\/)?[a-z-]+\.(?:js|css)|index\.html|desktop\.html|)$/);
    if (WEB && wm && m === 'GET' && !/^(data|summaries)\.js$/.test(wm[1])) { const f = wm[1] || 'index.html', fp = path.join(WEB, 'web', f); if (fs.existsSync(fp)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(fp) }); }
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (m !== 'GET' && m !== 'HEAD') {
      const body = (q.postDataBuffer() || Buffer.alloc(0)).toString();
      writes.push({ m, p: u.pathname, body });
      for (const id of Object.keys(FIX)) if (u.pathname.includes(id) || body.includes(id)) { if (/archive|hide|done/i.test(u.pathname + body)) ARCH.add(id); }
      if (u.pathname === '/wizard/thread-seen') { let st; try { st = JSON.parse(body).state; } catch (e) {} return json(200, { state: st || { initializedAt: Date.now(), threads: {} } }); }
      if (u.pathname.endsWith('/transcribe')) { await sleep(1500); return json(200, {text: 'QA linked voice reply'}); }
      if (u.pathname.endsWith('/files/upload')) return json(200, {file:{id:'qa_voice',filename:'voice.webm',mime:'audio/webm',bytes:4000}});
      if (u.pathname.endsWith('/v1/runs')) return json(202, {run_id:'qa_trail_run',status:'queued'});
      if (/\/route$/.test(u.pathname)) return json(200, {cmd:{route:'view'},ms:1});
      return json(200, { ok: true });
    }
    if (!u.pathname.startsWith('/wizard/')) return r.continue();
    if (u.pathname === '/wizard/hermes/api/sessions' && (u.searchParams.get('offset') || '0') === '0') {
      const res = await r.fetch(); const p = await res.json();
      p.data = Object.keys(FIX).map(fixSession).concat(p.data || []);
      return json(200, p);
    }
    const mm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm && FIX[mm[1]] && HOLD.has(mm[1])) await HOLD.get(mm[1]).wait;
    if (mm && FIX[mm[1]]) { rid = 1; const rows = FIX[mm[1]].rows().map(x => ({ ...x, session_id: mm[1] })); return json(200, { object: 'list', data: rows, pagination: { limit: 500, offset: 0, returned: rows.length } }); }
    const sm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)$/); if (sm && FIX[sm[1]]) return json(200, { session: fixSession(sm[1]) });
    return r.continue();
  };
}

// Focused offline admission for the desktop new-send adapter. This stays in the
// thread-navigation suite; all content is synthetic and every request is local.
// QA_SEND_RETURN=1 QA_WEB_DIR=<repo> QA_OUT=<dir> node qa-thread-trail.cjs https://wizard.test/wizard-os-home/
async function sendReturnChecks(b) {
  if (!WEB) throw new Error('Focused send-return QA requires sealed source');
  const evidence = [], contexts = new Map(), checks = [];
  const flush = () => fs.writeFileSync(path.join(OUT,'send-return-evidence.json'),JSON.stringify({pass,fail,checks,evidence,realRuns:0},null,2));
  const check = (condition,name,extra='') => { ok(condition,name,extra); checks.push({name,pass:!!condition,extra}); flush(); };
  const close = async c => { const journal=evidence.find(x=>x.context===contexts.get(c)); if(journal) { journal.final=await Promise.race([c.pages()[0]?.evaluate(()=>({receipts:window.__qaReceipts,models:window.WosModels&&{ready:WosModels.ready,options:WosModels.options,error:WosModels.error,loading:!!WosModels.loading,defaultOption:WosModels.defaultOption()},items:[...(window.WosOutbox?._items?.values()||[])].map(x=>({id:x.id,sessionId:x.sessionId,state:x.state,text:x.text,error:x.error,runId:x.runId}))})).catch(()=>null),sleep(1500).then(()=>({diagnosticTimeout:true}))]); } clearTimeout(contexts.get(c)); contexts.delete(c); await c.close(); flush(); };
  const closeAll = async () => { for (const c of [...contexts.keys()]) await close(c).catch(()=>{}); };
  try {
  async function boot(mobile, skin, half = false) {
    const c = await b.newContext({viewport:mobile ? {width:412,height:892} : {width:1200,height:900},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
    contexts.set(c,setTimeout(()=>{void c.close().catch(()=>{});},60000)); // hard per-context case cap
    const intercepted = [], errors = [], heldRuns = [], receipts = [], requests = []; let holdAck = true;
    const journal={mobile,skin,half,writes:intercepted,errors,receipts,requests,models:[]}; Object.defineProperty(journal,'context',{value:contexts.get(c)}); evidence.push(journal); flush();
    await c.exposeBinding('__qaReceipt',(_source,value)=>{receipts.push(value);flush();});
    await c.exposeBinding('__qaModelState',(_source,value)=>{journal.models.push(value);flush();});
    await c.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()); requests.push({method:q.method(),path:u.pathname}); flush();
      const json = (status, body) => r.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if (u.origin !== origin) return r.abort();
      if (!['GET','HEAD'].includes(q.method())) {
        const write={method:q.method(),path:u.pathname,body:q.postData() || '',key:q.headers()['idempotency-key'] || ''}; intercepted.push(write); flush();
        if (u.pathname.endsWith('/v1/runs')) {
          if (holdAck) await new Promise(resolve => heldRuns.push(resolve));
          write.ack={run_id:'qa_return_'+write.key,session_id:JSON.parse(write.body).session_id,status:'queued'}; flush(); return json(202,write.ack);
        }
        if (u.pathname === '/wizard/thread-seen') return json(200,{state:JSON.parse(q.postData() || '{}').state || {initializedAt:1,threads:{}}});
        return json(200,{ok:true});
      }
      // chat-models.normalize/resolveRoute require a confirmed default. An empty
      // {} lets enqueue persist a durable FAILED item without ever posting a run.
      if (u.pathname === '/wizard/hermes/api/model/options') return json(200,{model:'qa-model',provider:'qa-provider',providers:[{slug:'qa-provider',authenticated:true,models:['qa-model']}]});
      if (u.pathname === '/wizard/v1/agents') return json(200,{agents:[{id:'hermes',label:'QA Agent',is_default:true,status:'running',model:{model:'qa-model',provider:'qa-provider'}}]});
      if (u.pathname === '/wizard/hermes/api/sessions') return json(200,{object:'list',data:!u.searchParams.get('agent')||u.searchParams.get('agent')==='hermes'?Object.keys(FIX).map(fixSession):[],has_more:false,limit:100,offset:0,snapshot:'synthetic-return'});
      const m = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/);
      if (m && FIX[m[1]]) return json(200,m[2] ? {object:'list',data:FIX[m[1]].rows().map(x=>({...x,session_id:m[1]})),pagination:{limit:500,offset:0}} : {session:fixSession(m[1])});
      if (u.pathname === '/wizard/thread-seen') return json(200,{state:{initializedAt:1,threads:{}}});
      if (u.pathname === '/wizard/v1/boomerangs') return json(200,{reminders:[]});
      if (u.pathname.startsWith('/wizard/')) return json(200,{});
      const rel = u.pathname.replace(/^\/wizard-os-home\//,'') || 'index.html';
      const file = path.resolve(WEB,'web',rel), root = path.resolve(WEB,'web') + path.sep;
      if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return r.fulfill({status:404,body:''});
      const mime = rel.endsWith('.html') ? 'text/html' : rel.endsWith('.css') ? 'text/css' : rel.endsWith('.json') ? 'application/json' : rel.endsWith('.svg') ? 'image/svg+xml' : rel.endsWith('.png') ? 'image/png' : 'application/javascript';
      return r.fulfill({status:200,contentType:mime,body:fs.readFileSync(file)});
    });
    await c.addInitScript(skin => { localStorage.setItem('wos.coached','true'); localStorage.setItem('wos.tour.done','1'); localStorage.setItem('wos.skin',skin); },skin);
    const p = await c.newPage(); p.setDefaultTimeout(8000); p.setDefaultNavigationTimeout(12000); p.on('pageerror',e=>{errors.push(String(e));flush();});
    await p.goto(URL_+(URL_.includes('?')?'&':'?')+'shell='+(mobile?'phone':'desktop'),{waitUntil:'load'});
    await p.waitForFunction(mobile => mobile ? !!window.__wos?.live?.session('qa_tt_a') : !!window.__wux?.live?.session('qa_tt_a'),mobile);
    // The catalogue is lazy. Welcome's independent model/options fetch does not
    // populate WosModels; await the real module, never synthesize its state.
    await p.evaluate(async()=>{
      const M=window.WosModels;
      if(typeof M?.load!=='function')throw new Error('Fixture contract: WosModels.load missing');
      const snapshot=phase=>({phase,ready:M.ready,options:M.options,error:M.error,loading:!!M.loading,defaultOption:M.defaultOption()});
      await window.__qaModelState(snapshot('before-load'));
      const pending=M.load();
      await window.__qaModelState(snapshot('load-started'));
      let cap;
      try { await Promise.race([pending,new Promise((_,reject)=>{cap=setTimeout(()=>reject(new Error('Fixture model load exceeded 6s')),6000);})]); }
      finally { clearTimeout(cap); await window.__qaModelState(snapshot('after-load')); }
      const d=M.defaultOption();
      if(!M.ready||M.error||M.loading||d?.value!=='qa-model'||d?.provider!=='qa-provider'||!M.options.some(o=>o.value===d.value&&o.provider===d.provider&&o.isGlobalDefault))
        throw new Error('Fixture model catalogue invalid: '+JSON.stringify(snapshot('invalid')));
    });
    await p.evaluate(mobile => {
      document.getElementById('wosWelcome')?.remove(); if (mobile) __wos.goDesk(1); else __wux.openChatsList();
      // done() persists sent before the hook; landed() may later compact text and
      // runId away. Bind this receipt to the exact idempotency key, not 'some sent'.
      window.__qaReceipts=[];
      WosOutbox.onSent((it,res)=>{const value={id:it.id,sessionId:it.sessionId,kind:it.kind,text:it.text,model:it.model,provider:it.provider,body:it.body,state:it.state,runId:res.runId};__qaReceipts.push(value);void window.__qaReceipt(value);});
    },mobile);
    if (half) await p.evaluate(()=>__wux.newWin({app:'settings'}));
    const id = await p.evaluate(mobile=>Object.values((mobile ? __wos : __wux).wins).find(w=>w.app==='chats'&&!w.agent).id,mobile);
    if (!mobile) await p.evaluate(id=>__wux.focusWin(id),id);
    await p.waitForTimeout(300);
    const root = `.win[data-win="${id}"]`, list = mobile ? root : root + ' .pane-list';
    const state = () => p.evaluate(({id,mobile})=>{
      const w=(mobile ? __wos : __wux).wins[id], el=document.querySelector(`.win[data-win="${id}"]`);
      const box=el.querySelector('.dchats'), list=el.querySelector(mobile ? '.ch-list' : '.pane-list');
      return {thread:w.thread ?? null,attr:box?.dataset.thread,width:box?.getBoundingClientRect().width,list:!!list&&list.getBoundingClientRect().width>0&&getComputedStyle(list).display!=='none',draft:el.querySelector('.ch-compose textarea')?.value || ''};
    },{id,mobile});
    const newChat = async () => { await p.locator(list+' [data-chnew]').first().click(); await p.waitForSelector(root+' .ch-compose textarea',{state:'visible'}); };
    const send = async text => {
      holdAck=true;
      await p.locator(root+' .ch-compose textarea').fill(text);
      // Bubble listener runs after the real form's handler, in the SAME task.
      await p.evaluate(({id,mobile})=>{document.addEventListener('submit',()=>{const w=(mobile ? __wos : __wux).wins[id],box=document.querySelector(`.win[data-win="${id}"] .dchats`); window.__qaSubmit={thread:w.thread??null,attr:box?.dataset.thread};},{once:true});},{id,mobile});
      await p.locator(root+' .ch-send').click();
      journal.submission=await p.evaluate(()=>__qaSubmit);flush();return journal.submission;
    };
    const holdSave = () => p.evaluate(()=>{const ob=WosOutbox,enqueue=ob.enqueue;window.__qaResume=null;ob.enqueue=async x=>{await new Promise((resolve,reject)=>{window.__qaResume={resolve,reject};});return enqueue.call(ob,x);};window.__qaUnhold=()=>{ob.enqueue=enqueue;};});
    const release = async reject => { await p.evaluate(reject=>{const r=__qaResume;__qaUnhold();reject ? r.reject(new Error('QA disk full')) : r.resolve();},reject); };
    const openOther = () => p.locator(list+' [data-chopen="qa_tt_b"]').first().click();
    const ack = () => {holdAck=false;heldRuns.splice(0).forEach(r=>r());};
    const sent = async text => {
      await p.waitForFunction(text=>[...WosOutbox._items.values()].some(x=>x.text===text&&x.state==='sending'),text);
      await p.waitForFunction(text=>[...WosOutbox._items.values()].some(x=>x.text===text&&!!x.body),text);
      for(let n=0;n<80&&!intercepted.some(w=>w.path.endsWith('/v1/runs')&&JSON.parse(w.body).input===text);n++)await p.waitForTimeout(50);
      const runs=intercepted.filter(w=>w.path.endsWith('/v1/runs')&&JSON.parse(w.body).input===text);
      if(runs.length!==1||!runs[0].key)throw new Error('Expected one exact held run for '+text);
      const write=runs[0],body=JSON.parse(write.body);
      const item=await p.evaluate(key=>{const x=WosOutbox._items.get(key);return x&&{id:x.id,sessionId:x.sessionId,text:x.text,model:x.model,provider:x.provider,body:x.body};},write.key);
      check(!!item&&item.text===text&&body.input===text&&body.session_id===item.sessionId&&body.model===item.model&&body.provider===item.provider&&body.require_model_lock===true&&write.body===item.body,'held run bound to exact item, destination, text and model', {write,item});
      return async()=>{ack();await p.waitForFunction(key=>__qaReceipts.some(x=>x.id===key),write.key);const receipt=await p.evaluate(key=>__qaReceipts.find(x=>x.id===key),write.key);check(receipt.state==='sent'&&receipt.text===text&&receipt.sessionId===body.session_id&&receipt.runId===write.ack.run_id&&receipt.body===write.body,'persisted receipt bound to exact intercepted ACK',{receipt,write});};
    };
    return {c,p,id,root,list,state,newChat,send,holdSave,release,openOther,ack,sent,intercepted,errors};
  }
  // Parent runner admits the full matrix only after the exact real form can
  // reach a held run and persist its matching ACK on every sealed source.
  if(process.env.QA_SEND_RETURN_SMOKE==='1') {
    try { const t=await boot(false,'nebula',true);
      await t.newChat(); await t.holdSave(); await t.send('QA model route smoke'); await t.release(false);
      await (await t.sent('QA model route smoke'))();
      check(t.errors.length===0,'model route smoke has no page errors',t.errors);
      console.log('MODEL_ROUTE_SMOKE_OK'); await close(t.c);
    } catch(e) { check(false,'model route smoke exception',String(e.stack||e)); }
    return;
  }
  for (const skin of ['nebula','grove']) { try {
    const t=await boot(false,skin,true), {p}=t;
    check((await t.state()).width<=620,skin+': real tiled half-width Chats');
    await t.newChat(); await t.holdSave();
    const sync=await t.send('QA half new '+skin);
    check(sync.thread===null&&sync.attr==='',skin+': real New chat click/send returns list in same task',sync);
    await p.waitForTimeout(450); let st=await t.state();
    check(st.thread===null&&st.attr===''&&st.list,skin+': list remains past legacy timer with save held',st);
    if (process.env.QA_EXPECT_RED === '1') {
      await p.screenshot({path:path.join(OUT,'baseline-half-new-send.png')});
      evidence[evidence.length-1].red={state:st,sync};flush();
      console.log(st.thread==='__new__'&&!st.list ? 'RED_EXPECTED half-width timer reopened __new__' : 'RED_NOT_REPRODUCED');
      await close(t.c); return;
    }
    await t.release(false);
    const ackExact=await t.sent('QA half new '+skin);
    await p.waitForTimeout(350); st=await t.state();
    check(st.thread===null&&st.list,skin+': pending run ACK leaves list visible',st);
    await ackExact();
    st=await t.state(); check(st.thread===null&&st.list,skin+': outbox ACK does not reopen New chat',st);
    check(await p.evaluate(skin=>WosSkin.current===skin&&document.documentElement.dataset.skin===skin,skin),skin+': screenshot wears requested real shell skin');
    await p.screenshot({path:path.join(OUT,`half-new-send-${skin}.png`)});
    await t.newChat(); await t.holdSave(); await t.send('QA recover '+skin); await t.release(true); await p.waitForTimeout(450);
    st=await t.state(); check(st.thread==='__new__'&&st.draft==='QA recover '+skin,skin+': failed save restores original composer without timer clearing words',st);
    await p.locator(t.root+' [data-chback]').click();
    await t.newChat(); await t.holdSave(); await t.send('QA navigate success '+skin); await t.openOther(); await p.waitForTimeout(450);
    check((await t.state()).thread==='qa_tt_b',skin+': opening another thread during save survives old timer');
    await t.release(false);await (await t.sent('QA navigate success '+skin))(); await p.waitForTimeout(450);
    check((await t.state()).thread==='qa_tt_b',skin+': newer thread survives save and ACK');
    await p.locator(t.root+' [data-chback]').click();
    await t.newChat(); await t.holdSave(); await t.send('QA navigate failure '+skin); await t.openOther(); await t.release(true); await p.waitForTimeout(450);
    st=await t.state(); check(st.thread==='qa_tt_b',skin+': delayed failure cannot take over newer thread',st);
    const failedText='QA navigate failure '+skin;
    const persisted=await p.evaluate(()=>JSON.parse(localStorage.getItem('wos.chat.drafts.v1')||'{}'));
    check(persisted.new?.text===failedText,skin+': late failed draft persists exact text before fresh New chat',persisted);
    await p.locator(t.root+' [data-chback]').click(); await t.newChat();
    st=await t.state(); check(st.thread==='__new__'&&st.draft==='',skin+': fresh New chat stays empty after late failure',st);
    // Fresh New chat intentionally rotates the recovered live slot. Resume the
    // saved words through the real list row, not a product/debug state setter.
    await p.locator(t.root+' [data-chback]').click();
    const saved=await p.evaluate(text=>Object.entries(JSON.parse(localStorage.getItem('wos.chat.drafts.v1')||'{}')).filter(([key,d])=>/^new:[a-z0-9]{4,40}$/.test(key)&&d.text===text).map(([key])=>key),failedText);
    // The cached desktop pane refreshes through the owner's real window control.
    await p.keyboard.press('Alt+r');
    await p.locator(t.list+' [data-chdraft="'+saved[0]+'"]').waitFor({state:'visible'});
    const draftRow=p.locator(t.list+' [data-chdraft]').filter({has:p.getByText(failedText,{exact:true})});
    const rowCount=await draftRow.count();
    const rowKey=rowCount===1 ? await draftRow.getAttribute('data-chdraft') : null;
    check(saved.length===1&&rowCount===1&&rowKey===saved[0],skin+': unique real saved-draft row matches exact persisted failed text',{saved,rowCount,rowKey});
    await draftRow.click();
    st=await t.state(); check(st.thread==='__new__'&&st.draft===failedText,skin+': late failed draft remains recoverable',st);
    await p.evaluate(()=>WosSkin.set('obsidian')); await p.waitForTimeout(200);
    check(await p.evaluate(()=>WosSkin.current==='obsidian'&&document.documentElement.dataset.skin==='obsidian'&&!!getComputedStyle(document.documentElement).getPropertyValue('--wz-base').trim()),skin+': live skin change retains Appearance tokens');
    check(t.errors.length===0,skin+': no page errors',t.errors); await close(t.c);
  } catch(e) { check(false,skin+': case exception',String(e.stack||e)); await closeAll(); }
  }
  // Neighbours: shared core API wide replies stay open; the wide shell's existing
  // real-form shortcut still opens a fresh draft. Phone retains send-and-back.
  try { const wide=await boot(false,'nebula');
  check((await wide.state()).width>620,'wide desktop uses two-pane layout');
  await wide.p.locator(wide.list+' [data-chopen="qa_tt_a"]').first().click();
  await wide.p.evaluate(id=>__wux.chats.sendChat(id,'QA wide keep thread'),wide.id); await wide.p.waitForTimeout(250);
  check((await wide.state()).thread==='qa_tt_a','wide desktop shared reply keeps thread');
  await wide.p.locator(wide.list+' [data-chnew]').first().click(); await wide.send('QA wide real form'); await wide.p.waitForTimeout(450);
  check((await wide.state()).thread==='__new__','wide desktop real-form fresh-draft shortcut unchanged'); wide.ack();
  check(wide.errors.length===0,'wide desktop no page errors',wide.errors); await close(wide.c);
  } catch(e) { check(false,'wide case exception',String(e.stack||e)); await closeAll(); }
  try { const phone=await boot(true,'nebula');
  check(await phone.p.evaluate(()=>document.documentElement.dataset.shell)==='phone','phone fixture uses real phone shell');
  await phone.newChat(); await phone.holdSave(); const sync=await phone.send('QA phone new');
  check(sync.thread===null,'phone new send immediately returns list',sync); await phone.release(false);await (await phone.sent('QA phone new'))(); await phone.p.waitForTimeout(450);
  check((await phone.state()).thread===null,'phone new ACK retains list');
  await phone.p.locator(phone.list+' [data-chopen="qa_tt_a"]').first().click(); await phone.send('QA phone reply');await (await phone.sent('QA phone reply'))(); await phone.p.waitForTimeout(450);
  check((await phone.state()).thread===null,'phone reply still returns list');
  await phone.p.locator(phone.list+' [data-chopen="qa_tt_b"]').first().click(); await phone.p.evaluate(()=>__wosNativeBack());
  check((await phone.state()).thread===null,'phone Back returns list'); await phone.p.evaluate(()=>__wosNativeBack());
  check(await phone.p.evaluate(()=>!!window.__wos&&document.visibilityState==='visible'),'phone root Back never exits');
  check(phone.errors.length===0,'phone no page errors',phone.errors); await close(phone.c);
  } catch(e) { check(false,'phone case exception',String(e.stack||e)); await closeAll(); }
  } finally { await closeAll(); flush(); }
}

(async () => {
  const b = await chromium.launch({ executablePath: EXEC && fs.existsSync(EXEC) ? EXEC : undefined, args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] });
  if (process.env.QA_SEND_RETURN === '1') { try { await sendReturnChecks(b); } finally { await b.close(); } console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, serviceWorkers:'block' });
  await ctx.route('**/*', routeFor());
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_tt_sum'), null, { timeout: 90000 }).catch(() => {});
  ok(await p.evaluate(() => !!window.__wos?.live?.session('qa_tt_sum')), 'thread list loaded with fixture threads');
  await p.evaluate(() => __wos.goDesk(1)); await sleep(600);

  const wid = () => p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats')?.id);
  const thread = () => p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats')?.thread ?? null);
  const S = async sel => `[data-chats="${await wid()}"] ${sel}`;
  const alive = () => p.evaluate(() => !!window.__wos && document.visibilityState === 'visible' && !!document.querySelector('.win'));
  async function waitThread(id) {
    await p.waitForFunction(id => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'); return w?.thread === id && document.querySelector(`[data-chats="${w.id}"] .ch-msgs .msg.a`); }, id, { timeout: 20000 }).catch(() => {});
    await sleep(400);
  }
  async function openFromList(id) { await p.evaluate(id => __wos.openWizardThread(id), id); await waitThread(id); }
  async function tapLink(text) {
    const sel = await S(`.ch-msgs .msg.a a`);
    const loc = p.locator(sel, { hasText: text }).last();
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await loc.tap();
  }
  async function tapAct(a) {
    const sel = await S(`[data-chact="${a}"]`);
    await p.waitForSelector(sel, { timeout: 8000 }).catch(() => {});
    await p.locator(sel).scrollIntoViewIfNeeded().catch(() => {});
    await p.locator(sel).tap(); await sleep(700);
  }
  const back = async () => { await p.keyboard.press('Escape'); await sleep(500); };

  try {
    // 1. Summary → link A → Done returns to the summary (James's case).
    await openFromList('qa_tt_sum');
    ok(await thread() === 'qa_tt_sum', '1 summary thread open from the list');
    await tapLink('Thread A'); await waitThread('qa_tt_a');
    ok(await thread() === 'qa_tt_a', '1 tapping a thread link opens that thread');
    await p.screenshot({ path: path.join(OUT, '1-linked-thread.png') });
    const w0 = writes.length;
    await tapAct('done'); await waitThread('qa_tt_sum');
    ok(await thread() === 'qa_tt_sum', '1 Done on a linked thread returns to the thread you came from (not the list)', await thread());
    ok(writes.slice(w0).some(w => /qa_tt_a/.test(w.p + w.body)), '1 Done still archives the linked thread', writes.slice(w0).map(w => w.p));
    await p.screenshot({ path: path.join(OUT, '1-after-done.png') });

    // 2. Summary → link B → Back returns to the summary; Back again → list; the app stays open.
    await tapLink('Thread B'); await waitThread('qa_tt_b');
    ok(await thread() === 'qa_tt_b', '2 second link opens thread B');
    await back();
    ok(await thread() === 'qa_tt_sum', '2 Back on a linked thread returns to the summary thread', await thread());
    await back();
    ok(await thread() === null, '2 Back on the summary (opened from the list) returns to the list', await thread());
    ok(await alive(), '2 app still open after Back');

    // 2b. Back while the linked thread's read is still out (James, 23 Oct 2026: Morning projects → linked working
    // thread → Back showed the linked thread's messages under the Morning header until the 60 s re-read). Thread B is
    // already on this device from case 2, so it paints from its cached copy while its server read waits.
    await openFromList('qa_tt_sum');
    { let release; HOLD.set('qa_tt_b', { wait: new Promise(r => { release = r; }) });
      await tapLink('Thread B');
      await p.waitForFunction(() => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'); return w?.thread === 'qa_tt_b' && /Thread B answer/.test(document.querySelector(`[data-chats="${w.id}"] .ch-msgs`)?.textContent || ''); }, null, { timeout: 8000 }).catch(() => {});
      const body = async () => p.evaluate(() => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'), el = document.querySelector(`[data-chats="${w.id}"]`); return { thread: w.thread, title: el?.querySelector('.ch-head .ti b')?.textContent || '', text: el?.querySelector('.ch-msgs')?.textContent || '' }; });
      ok(/Thread B answer/.test((await body()).text), '2b linked thread paints its cached copy while its read is out', await body());
      await back(); await sleep(1500);
      let s2 = await body();
      ok(s2.thread === 'qa_tt_sum' && s2.title === 'QA trail summary' && /Here are your threads/.test(s2.text) && !/Thread B answer/.test(s2.text), '2b Back during the linked read shows the summary’s own messages, not the linked thread’s', { ...s2, text: s2.text.slice(0, 160) });
      release(); HOLD.delete('qa_tt_b'); await sleep(900);
      s2 = await body();
      ok(s2.thread === 'qa_tt_sum' && /Here are your threads/.test(s2.text) && !/Thread B answer/.test(s2.text), '2b the late linked read cannot paint over the summary', { ...s2, text: s2.text.slice(0, 160) });
      await tapLink('Thread B'); await waitThread('qa_tt_b');
      ok((await body()).thread === 'qa_tt_b', '2b the summary’s links still work after that Back');
      await back(); await back();
      ok(await thread() === null && await alive(), '2b nested Back then root Back: list, app still open', await thread()); }

    // 3. Chain: summary → A → B; Done on B → A; Back on A → summary; Back → list.
    await openFromList('qa_tt_sum');
    ARCH.delete('qa_tt_a'); await p.evaluate(() => __wos.live.refresh?.()); await sleep(800);
    await openFromList('qa_tt_a'); // reopen from list is a fresh trail …
    await back(); ok(await thread() === null, '3 thread opened from the list: Back goes to the list (fresh trail)', await thread());
    await openFromList('qa_tt_sum');
    await tapLink('Thread A'); await waitThread('qa_tt_a');
    await tapLink('Thread B'); await waitThread('qa_tt_b');
    ok(await thread() === 'qa_tt_b', '3 link inside a linked thread opens the next thread');
    // Snooze now opens its time picker (#365), so the one-tap step back here is Done.
    await tapAct('done'); await waitThread('qa_tt_a');
    ok(await thread() === 'qa_tt_a', '3 Done steps back one thread (B → A)', await thread());
    await back();
    ok(await thread() === 'qa_tt_sum', '3 Back steps back again (A → summary)', await thread());
    await back();
    ok(await thread() === null, '3 Back from the root thread → list', await thread());

    // 4. Own-page link (…/wizard-os-home/?session=) keeps the trail too.
    await openFromList('qa_tt_sum');
    await tapLink('Thread C'); await waitThread('qa_tt_c');
    ok(await thread() === 'qa_tt_c', '4 own-page thread link opens thread C in place');
    await tapAct('done'); await waitThread('qa_tt_sum');
    ok(await thread() === 'qa_tt_sum', '4 Done on an own-page-linked thread returns to the summary', await thread());

    // 5. Done on a thread opened from the list still goes to the list.
    ARCH.delete('qa_tt_b'); await p.evaluate(() => __wos.live.refresh?.()); await sleep(800);
    await openFromList('qa_tt_b');
    await tapAct('done');
    ok(await thread() === null, '5 Done on a thread opened from the list returns to the list', await thread());
    ok(await alive(), '5 app still open');

    const idle = async id => p.evaluate(id => { const s=__wos.live.session(id); Object.assign(s,{status:'completed',runId:'',archived:false}); },id);
    const type = async text => { await p.locator(await S('textarea')).fill(text); await sleep(80); };
    const send = async () => p.locator(await S('button.ch-send')).tap();
    const prepare = async () => { await openFromList('qa_tt_sum'); await idle('qa_tt_a'); await tapLink('Thread A'); await waitThread('qa_tt_a'); };
    const runsSince = n => writes.slice(n).filter(w=>/\/v1\/runs$/.test(w.p)).map(w=>JSON.parse(w.body));
    // 6. Actual Send with an outstanding save: return to the link's reading position, retaining the parent's draft.
    await openFromList('qa_tt_sum'); await type('Roundup draft stays here');
    await p.locator(await S('.ch-msgs a')).filter({hasText:'Thread A'}).last().scrollIntoViewIfNeeded(); await sleep(350);
    const parentTop = await p.locator(await S('.ch-msgs')).evaluate(e=>e.scrollTop);
    await idle('qa_tt_a'); await tapLink('Thread A'); await waitThread('qa_tt_a');
    await p.evaluate(()=>{const ob=WosOutbox; window.qaEnqueue=ob.enqueue.bind(ob); ob.enqueue=async spec=>{window.qaSpec=spec; await new Promise(r=>window.qaSave=r); return qaEnqueue(spec);};});
    await type('QA linked typed reply'); const n6=writes.length; await send(); await sleep(150);
    ok(await thread()==='qa_tt_sum','6 typed send returns to roundup before local storage completes',await thread());
    if(await thread()==='qa_tt_sum') {
      await waitThread('qa_tt_sum');
      const top=await p.locator(await S('.ch-msgs')).evaluate(e=>e.scrollTop);
      ok(Math.abs(top-parentTop)<4,'6 roundup reading position restored',{parentTop,top});
      ok(await p.locator(await S('textarea')).inputValue()==='Roundup draft stays here','6 parent draft retained');
    } else {ok(false,'6 roundup reading position restored');ok(false,'6 parent draft retained');}
    await p.evaluate(()=>{qaSave();WosOutbox.enqueue=qaEnqueue;}); await sleep(1800);
    ok(runsSince(n6).some(r=>r.session_id==='qa_tt_a'&&r.input.includes('QA linked typed reply')),'6 reply delivered to linked child, not parent');
    ok(await thread()==='qa_tt_sum','6 asynchronous delivery does not pop parent again');
    await p.screenshot({path:path.join(OUT,'6-reply-back-to-roundup.png')});
    await back();ok(await thread()===null,'6 parent Back returns to list');

    // 7. Nested reply returns exactly one level; subsequent Back retains the remaining trail.
    await prepare();await idle('qa_tt_b');await tapLink('Thread B');await waitThread('qa_tt_b');
    await type('QA nested reply');await send();await sleep(600);
    ok(await thread()==='qa_tt_a','7 nested reply B → A');await back();
    ok(await thread()==='qa_tt_sum','7 remaining trail A → roundup');

    // 8. Save rejection returns the child composer and restores its trail.
    await prepare();await p.evaluate(()=>{WosOutbox.enqueue=async()=>{throw Error('QA disk rejected');};});
    await type('QA retained on save failure');await send();await sleep(500);
    ok(await thread()==='qa_tt_a'&&await p.locator(await S('textarea')).inputValue()==='QA retained on save failure','8 save failure restores child and words');
    await back();ok(await thread()==='qa_tt_sum','8 failed-send recovery preserves parent trail');
    await p.evaluate(()=>WosOutbox.enqueue=qaEnqueue);

    // 9. A delayed rejection cannot steal a newer navigation, even when it ends back at the same parent.
    await prepare();await p.evaluate(()=>{WosOutbox.enqueue=()=>new Promise((r,j)=>window.qaReject=j);});
    await type('QA delayed save failure');await send();await sleep(200);
    await openFromList('qa_tt_c');await openFromList('qa_tt_sum');
    await p.evaluate(()=>{qaReject(Error('QA delayed rejection'));WosOutbox.enqueue=qaEnqueue;});await sleep(400);
    ok(await thread()==='qa_tt_sum','9 late failure leaves newer navigation alone');
    await openFromList('qa_tt_a');
    ok(await p.locator(await S('textarea')).inputValue()==='QA delayed save failure','9 failed message remains recoverable in child');

    // 10. The shared composer-mic send path also returns once, with its audio and typed words pinned.
    await prepare();await type('QA typed with voice');
    const n10=writes.length;
    await p.evaluate(wid=>{window.qaVoiceSend=__wos.chats.sendVoiceTo(wid,'qa_tt_a',new Blob([new Uint8Array(4000)],{type:'audio/webm'}));},await wid());
    await sleep(300);ok(await thread()==='qa_tt_sum','10 composer voice returns to roundup');
    await sleep(2200);
    const v10=await p.evaluate(()=>WosOutbox.forThread('qa_tt_a').filter(x=>x.typed==='QA typed with voice').map(x=>({sid:x.sessionId,audio:!!(x.audio||x.audioFile),typed:x.typed})));
    ok(v10.some(x=>x.sid==='qa_tt_a'&&x.audio),'10 voice and typed composer stay pinned to child',v10);
    ok(await thread()==='qa_tt_sum','10 voice completion leaves roundup open');

    // 11. Real orb taps + fake microphone; slow transcription cannot pop twice or redirect the message.
    await prepare();
    const tapOrb=async()=>{const r=await p.locator('#orbWrap').boundingBox();await p.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);};
    await tapOrb();await sleep(1400);ok(await p.evaluate(()=>__wos.voice)==='listen','11 orb recording started');
    const n11=writes.length;await tapOrb();await sleep(400);
    ok(await thread()==='qa_tt_sum','11 orb send returns to roundup immediately');
    await sleep(4500);
    if(!runsSince(n11).some(r=>r.session_id==='qa_tt_a')) console.log('VOICE DEBUG',writes.slice(n11).map(w=>({p:w.p,body:w.body.slice(0,250)})),await p.evaluate(()=>({voice:__wos.voice,out:WosOutbox.forThread('qa_tt_a').map(x=>({kind:x.kind,state:x.state,error:x.error,text:x.text,typed:x.typed})),pill:document.querySelector('#txRouteText')?.textContent})));
    ok(runsSince(n11).some(r=>r.session_id==='qa_tt_a'),'11 orb reply targets child after return',runsSince(n11).map(r=>r.session_id));
    ok(await thread()==='qa_tt_sum','11 orb completion leaves roundup open');
    await back();await p.evaluate(()=>window.__wosNativeBack());await sleep(250);
    ok(await alive(),'11 nested and root Back keep Wizard open');

    await openFromList('qa_tt_c');await idle('qa_tt_c');await type('QA direct list reply');await send();await sleep(300);
    ok(await thread()===null,'12 direct list reply returns to list');
    await p.evaluate(id=>__wos.openChat(id,'__new__'),await wid());await sleep(300);
    await type('QA new chat');await send();await sleep(300);
    ok(await thread()===null,'12 new chat send returns to list');

    await prepare();await type('QA voice save failure');
    await p.evaluate(async wid=>{WosOutbox.enqueue=async()=>{throw Error('QA voice save failed');};try{await __wos.chats.sendVoiceTo(wid,'qa_tt_a',new Blob([new Uint8Array(4000)],{type:'audio/webm'}));}catch{}finally{WosOutbox.enqueue=qaEnqueue;}},await wid());
    ok(await thread()==='qa_tt_a'&&await p.locator(await S('textarea')).inputValue()==='QA voice save failure','13 voice save failure restores child composer');
    await back();ok(await thread()==='qa_tt_sum','13 voice save failure restores linked trail');

    const dc=await b.newContext({viewport:{width:1440,height:900},serviceWorkers:'block',ignoreHTTPSErrors:true});
    await dc.route('**/*',routeFor());const dp=await dc.newPage();await dp.goto(URL_+'desktop.html',{waitUntil:'domcontentloaded'});
    await dp.waitForFunction(()=>window.__wux?.live?.session('qa_tt_sum'));
    const dr=await dp.evaluate(async()=>{const x=__wux;x.openThread('qa_tt_sum');await new Promise(r=>setTimeout(r,500));const w=Object.values(x.wins).find(w=>w.app==='chats'&&w.thread==='qa_tt_sum');x.chats.openChat(w.id,'qa_tt_b',{via:'link'});const left=x.chats.leaveAfterSend(w.id,'qa_tt_b',false);return {left,thread:w.thread};});
    ok(dr.left===false&&dr.thread==='qa_tt_b','14 desktop reply keeps thread beside list',dr);await dc.close();
  } catch (e) { ok(false, 'suite crashed', String(e)); console.log('STATE', await p.evaluate(()=>({url:location.href,idx:__wos.idx,desks:__wos.desks,wins:__wos.wins,body:document.body.innerText.slice(-1500)}))); }

  const newIds = new Set(writes.filter(w=>w.m==='POST' && w.p==='/wizard/hermes/api/sessions').map(w=>JSON.parse(w.body).id).filter(Boolean));
  ok(writes.filter(w => /\/v1\/runs$/.test(w.p)).every(w => { const id=JSON.parse(w.body).session_id;return /^qa_tt_/.test(id)||newIds.has(id); }), 'all intercepted replies target fixture threads or the fixture-created new chat');
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
  await b.close();
  console.log(`\nthread-trail: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
