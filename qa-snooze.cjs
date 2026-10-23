// QA: Snooze through the shared scheduler and existing deferred disposition, phone + desktop, two skins.
// API fixtures fence every mutation; no real Wizard writes, runs or notifications.
// Use QA_LIVE=1 QA_ORIGIN=... to test actual served assets, never an asset overlay.
// Usage: QA_WEB_DIR=<tree> QA_OUT=<dir> QA_PLAYWRIGHT=<playwright> node qa-snooze.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const W = process.env.QA_WEB_DIR || __dirname, OUT = process.env.QA_OUT || 'qa-live/snooze';
const ORIGIN = process.env.QA_ORIGIN || 'http://127.0.0.1:9371';
if (process.env.QA_LIVE && !process.env.QA_ORIGIN) throw new Error('QA_LIVE requires QA_ORIGIN');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === '' ? '' : JSON.stringify(extra).slice(0, 500)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = Date.now() / 1000;
const T = [
  { id: 'qa_boom_a', title: 'QA · Quote for the deck', ask: 'Can you price the deck?', reply: 'The deck quote is 4,200 THB including delivery.' },
  { id: 'qa_boom_b', title: 'QA · Pin me', ask: 'Pin test', reply: 'A thread to pin.' },
];
const session = (t, i) => ({ id: t.id, source: 'wizard-mobile', title: t.title, status: 'completed', archived: false, hidden: false, message_count: 2,
  started_at: now - 7200 - i * 60, last_active: now - 600 - i * 60, wizard_last_user_at: now - 7200, wizard_last_assistant_at: now - 600 - i * 60, wizard_activity_at: now - 600 - i * 60,
  latest_message: { role: 'assistant', content: t.reply, timestamp: now - 600 - i * 60 }, last_user_message: { role: 'user', content: t.ask, timestamp: now - 7200 } });
const rows = t => [{ id: 1, session_id: t.id, role: 'user', content: t.ask, timestamp: now - 7200 }, { id: 2, session_id: t.id, role: 'assistant', content: t.reply, timestamp: now - 600 }];
const ct = f => f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/javascript';

function fakeWizard() {
  const st = { schedules: [], prefs: { pinnedChats: [] }, posts: [], prefPuts: [], runs: 0, n: 0, dispositions: {}, dispositionWrites: [], failDefer: false, failSchedule: false };
  st.route = async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method(), p = u.pathname;
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.origin !== ORIGIN) return r.abort();
    const wm = p.match(/^\/wizard-os-home\/(.*)$/);
    if (wm && m === 'GET') { if (process.env.QA_LIVE) return r.continue(); const f = wm[1] || 'index.html', fp = path.join(W, 'web', f); if (!fs.existsSync(fp) || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: ct(f), body: '' }); return r.fulfill({ status: 200, contentType: ct(f), body: fs.readFileSync(fp) }); }
    const body = () => { try { return JSON.parse(q.postData() || '{}'); } catch { return {}; } };
    if (p === '/wizard/v1/schedules' && m === 'GET') return json(200, { schedules: st.schedules });
    if (p === '/wizard/v1/schedules' && m === 'POST') { const b = body(); if(st.failSchedule)return json(503,{error:'QA schedule unavailable'}); st.posts.push(b); const j = { id: 'job' + (++st.n), enabled: true, agent: 'hermes', ...b, nextRun: b.when.once, lastRun: null }; st.schedules.push(j); return json(201, j); }
    const sm = p.match(/^\/wizard\/v1\/schedules\/([^/]+)$/);
    if (sm && m === 'PATCH') { const j = st.schedules.find(x => x.id === sm[1]); Object.assign(j, body()); return json(200, j); }
    if (sm && m === 'DELETE') { st.schedules = st.schedules.filter(x => x.id !== sm[1]); return json(200, { deleted: true }); }
    if (p === '/wizard/v1/ui-preferences') { if (m === 'PUT') { const b = body(); st.prefPuts.push(b); Object.assign(st.prefs, b); } return json(200, st.prefs); }
    if (p.endsWith('/v1/runs') && m === 'POST') { st.runs++; return json(403, { error: 'QA: Boomerang must never start a run' }); }
    if(p === '/wizard/thread-dispositions') {
      if(m === 'PUT'){const b=body();st.dispositionWrites.push(b);if(st.failDefer)return json(503,{error:'QA disposition unavailable'});const record={deferred:b.deferred,updatedAt:new Date().toISOString()};st.dispositions[(b.runtime||'direct')+':'+b.sessionId]=record;return json(200,{record})}
      return json(200,{state:st.dispositions});
    }
    if (m !== 'GET') return json(403, { error: 'QA refuses unhandled mutation' });
    if (p === '/wizard/hermes/api/sessions') return json(200, { data: T.map(session), has_more: false });
    for (const [i, t] of T.entries()) {
      if (p === `/wizard/hermes/api/sessions/${t.id}/messages`) { const d = rows(t); return json(200, { object: 'list', data: d, pagination: { limit: 500, offset: 0, returned: d.length } }); }
      if (p === `/wizard/hermes/api/sessions/${t.id}`) return json(200, { session: session(t, i) });
    }
    return json(200, {});
  };
  st.fire = id => { const j = st.schedules.find(x => x.id === id); j.lastRun = { outcome: 'returned', scheduledFor: new Date(Date.parse(j.when.once)).toISOString(), finishedAt: new Date().toISOString() }; j.nextRun = null; j.enabled = false; };
  return st;
}

async function shell(b, st, desktop, skin) {
  const ctx = await b.newContext(desktop ? { serviceWorkers: 'block', viewport: { width: 1440, height: 900 } } : { serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route('**/*', st.route);
  await ctx.addInitScript(skin => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.skin', skin); } catch (e) {} }, skin);
  const p = await ctx.newPage(); p.setDefaultTimeout(15000);
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(ORIGIN + '/wizard-os-home/' + (desktop ? 'desktop.html' : ''), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(id => { const A = window.__wos || window.__wux, L = window.WizLive; return L?.ok && L.session(id) && window.WosBoomerang && window.WosChatPins; }, T[0].id, { timeout: 60000 });
  return { ctx, p, errs };
}
const openThread = (p, id, desktop) => p.evaluate(({ id, desktop }) => desktop ? window.__wux.openThread(id) : window.__wos.openWizardThread(id), { id, desktop });
const back = (p, desktop) => p.evaluate(desktop => { if (desktop) return window.__wux.escStep(); window.__wos.onBack(); return (window.__backLog || []).at(-1); }, desktop);
const threadOpen = (p, id) => p.evaluate(id => [...document.querySelectorAll('[data-chats]')].some(el => el.querySelector('.ch-thread') && el.offsetParent !== null) && Object.values((window.__wos || window.__wux).wins || {}).some(w => w.thread === id), id);


(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined });
  for(const skin of ['sepia','novairecito']) for(const desktop of [false,true]) {
    const st=fakeWizard(),L=`${desktop?'desktop':'phone'}/${skin}`;
    const {ctx,p,errs}=await shell(b,st,desktop,skin);
    const shot=name=>p.screenshot({path:path.join(OUT,`${skin}-${desktop?'desktop':'phone'}-${name}.png`)});
    const open=async()=>{await openThread(p,T[0].id,desktop);await p.locator('.ch-tacts [data-chact="snooze"]:visible').waitFor()};
    const pick=async()=>{await p.locator('.ch-tacts [data-chact="snooze"]:visible').click();await p.locator('.boom-card').waitFor()};
    await open();
    ok(await p.locator('[data-chact="defer"], [data-chact="boomerang"]').count()===0,`${L}: one thread Snooze action replaces both old controls`);
    await pick();
    ok(await p.locator('#boom-title').innerText()==='Snooze' && await p.locator('.boom-prompt').innerText()==='When should this come back?',`${L}: name and approved prompt`);
    ok((await p.locator('.boom-presets button span').allTextContents()).join('|')==='Later today|Tomorrow 9:00|Next week|Pick a time|Someday',`${L}: five approved choices`);
    const rect=await p.locator('.boom-card').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,overflow:el.scrollWidth>el.clientWidth}});
    ok(rect.x>=0&&rect.right<=rect.w&&rect.bottom<=rect.h&&!rect.overflow,`${L}: picker fits`,rect);
    ok(await p.evaluate(()=>document.documentElement.dataset.skin)===skin,`${L}: worn skin`);
    await p.evaluate(()=>{document.querySelector('.boom-card input[name=note]').value='Keep this note';window.WosSkin.set(document.documentElement.dataset.skin==='sepia'?'novairecito':'sepia')});
    await sleep(250);
    ok(await p.locator('.boom-card input[name=note]').inputValue()==='Keep this note'&&await threadOpen(p,T[0].id),`${L}: live skin change retains note and thread`);
    await p.evaluate(s=>window.WosSkin.set(s),skin);await sleep(250);
    await shot('picker');
    ok(await back(p,desktop)==='boomerang'&&await p.locator('.boom-sheet').count()===0&&await threadOpen(p,T[0].id),`${L}: nested Back closes only picker, app/thread stay`);
    await pick();
    await p.locator('[data-boom-preset="tomorrow-am"]').click();
    await p.locator('.boom-card [type=submit]').click();await p.locator('.boom-banner').waitFor();
    const post=st.posts.at(-1);
    ok(post?.kind==='return'&&post.thread===T[0].id&&post.target.message===null&&post.timezone==='Asia/Bangkok'&&/T02:00:00.000Z$/.test(post.when.once),`${L}: timed Snooze uses unchanged shared scheduler at Bangkok 9:00`,post);
    const label=await p.evaluate(()=>window.WosBoomerang._returnLabel(window.WosBoomerang.nextFor('qa_boom_a')));
    ok((await p.locator('.boom-banner').innerText()).includes(label)&&await p.evaluate(l=>document.body.innerText.includes(l),label),`${L}: exact saved return confirmation`,label);
    await shot('timed');
    await p.locator('.boom-banner [data-boom-change]').click();await p.locator('[data-boom-exact]').click();
    await p.locator('.boom-card input[name=time]').fill('09:37');
    await p.locator('.boom-card [type=submit]').click();await p.waitForFunction(()=>window.WosBoomerang.nextFor('qa_boom_a')?.due_at.includes('02:37:'));
    ok(st.schedules.length===1&&st.schedules[0].when.once.includes('T02:37:'),`${L}: edit keeps existing scheduler id and exact minutes`);
    await p.locator('.msg.a [data-mboom]:visible').first().click();
    ok(await p.locator('#boom-title').innerText()==='Snooze',`${L}: message action uses same picker`);
    await p.locator('[data-boom-note-toggle]').click();await p.locator('input[name=note]').fill('Check the price');
    await p.locator('.boom-card [type=submit]').click();await p.waitForFunction(()=>!window.WosBoomerang.isOpen());
    const msg=st.posts.at(-1);
    ok(msg.target.message>0&&msg.prompt==='Check the price'&&msg.target.excerpt.includes('4,200'),`${L}: message Snooze preserves anchor and note`);
    st.fire(st.schedules.at(-1).id);await p.evaluate(()=>window.WosBoomerang.refresh());
    await p.locator('.boom-banner.due').waitFor();
    ok((await p.locator('.boom-banner').innerText()).includes('Back for you'),`${L}: existing scheduler return still works`);
    await p.locator('[data-boom-open]').click();await sleep(250);
    ok(await p.locator('.msg.a.boom-flash').count()===1,`${L}: returned message opens its exact reply`);
    await p.locator('[data-boom-done]').click();await sleep(300);
    await p.locator('.boom-banner [data-boom-cancel]').click();await sleep(300);
    // Both failures retain the picker/thread and never announce success.
    await pick();st.failSchedule=true;await p.locator('.boom-card [type=submit]').click();
    await p.locator('.boom-error').filter({hasText:'QA schedule unavailable'}).waitFor();
    ok(await threadOpen(p,T[0].id)&&st.schedules.length===0,`${L}: failed timed Snooze retains thread and picker`);st.failSchedule=false;
    st.failDefer=true;await p.locator('[data-boom-someday]').click();
    await p.locator('.boom-error').filter({hasText:'Could not snooze'}).waitFor();
    ok(await threadOpen(p,T[0].id)&&await p.locator('.boom-sheet').count()===1,`${L}: failed Someday retains thread and picker`);st.failDefer=false;
    // A previously scheduled Boomerang is not deleted by the old Defer/Someday operation.
    const legacy={id:'legacy-return',kind:'return',name:'Boomerang · Older reminder',thread:T[0].id,when:{once:'2099-01-01T02:00:00.000Z'},timezone:'Asia/Bangkok',prompt:'',target:{message:null,excerpt:''}};
    st.schedules.push(legacy);
    const beforePosts=st.posts.length;
    await p.locator('[data-boom-someday]').click();await p.waitForFunction(()=>!window.WosBoomerang.isOpen());await sleep(250);
    ok(st.posts.length===beforePosts&&st.schedules.some(j=>j.id===legacy.id)&&st.dispositionWrites.at(-1)?.deferred===true,`${L}: Someday uses old deferred disposition, no timed job`);
    ok(await p.evaluate(()=>document.body.innerText.includes('Snoozed · bottom of Ready')),`${L}: exact Someday confirmation`);
    const row=p.locator(`[data-sec="ready"] [data-chopen="${T[0].id}"]`).first();await row.waitFor();
    ok((await row.innerText()).includes('Snoozed'),`${L}: existing deferred row says Snoozed`);
    const ids=await p.locator('[data-sec="ready"] [data-chopen]').evaluateAll(els=>els.map(el=>el.dataset.chopen));
    ok(ids.at(-1)===T[0].id,`${L}: Someday at bottom of Ready`,ids);
    await shot('someday');
    for(const q of ['snooze','defer','later','boomerang']) {
      const search=p.locator('.ch-search input:visible, input[data-chsearch]:visible').first();
      await search.fill(q);await p.locator('[data-chsug="status:deferred"]:visible').first().click();await sleep(200);ok((await p.locator(`[data-chopen="${T[0].id}"]:visible`).count())>0,`${L}: search synonym ${q}`);await p.locator('[data-chchipx="status"]:visible').first().click();
    }
    ok(st.runs===0&&errs.length===0,`${L}: no runs or page errors`,errs);
    await ctx.close();
  }
  await b.close();console.log(`${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exit(2)});
