// QA: pins-only radial (James, 1 Nov 2026). Pins fill inner then outer; no desktop wedges.
// Exercise Settings/Customize pinning, late registry arrival, split-desk focus, geometry, safe voice and OFF parity.
// Usage: node qa-orb-radial.cjs   (QA_WEB_DIR=<tree with web/>, QA_SHOTS=<dir> for screenshots, QA_CHROME=<chrome>)
// Self-contained: every Wizard request is answered by this file (shell served from the tree, everything else stubbed);
// every non-GET Wizard write is recorded and refused, and the suite asserts nothing reached the agent (/v1/runs).
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = require('./tools/qa-paths.cjs').origin(), URL_ = ORIGIN + '/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NOW = Date.now();
const THREADS = Array.from({ length: 4 }, (_, i) => ({ id: `qa-${i}`, title: `QA thread ${i + 1}`, source: 'api_server', model: 'qa', message_count: 2, preview: 'Preview', last_active: NOW / 1000 - i * 600, started_at: NOW / 1000 - i * 600 - 60 }));
const CT = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const R = { words: 'open calendar', cmd: { route: 'agent' } };
const log = { writes: [], routes: [], stt: 0, uploads: 0 }, allRunRequests = [];
const APPS = [['wizard-search', 'Search'], ['notes', 'Notes'], ['wizard-calendar', 'Calendar'], ['stories', 'Stories'], ['wisdom', 'Wisdom'], ['wizard-music', 'Wizard Music'], ['topics', 'Topics'], ['files-qa', 'Files']];
// What would reach the agent: a run, a new session. (The take's own audio custody upload is not a message.)
const runs = () => allRunRequests;

async function boot(b, vp = { width: 412, height: 892 }, seed = {}, enable = true) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'], serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' });
  const json = (r, o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (m !== 'GET' && /\/v1\/runs|\/sessions$/.test(u.pathname)) allRunRequests.push(m + ' ' + u.pathname);
    if (u.hostname !== new URL(ORIGIN).hostname) return m === 'GET' ? r.continue() : r.abort();
    const app = APPS.find(a => u.pathname.startsWith('/' + a[0] + '/'));
    if (app) return r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>${app[1]}</title><body style="background:#123;color:#fff;font:24px system-ui;padding:40px">${app[1]} app</body>` });
    const sh = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (sh && (m === 'GET' || m === 'HEAD')) {
      const f = sh[1] || 'index.html', p = path.join(WEB, 'web', f);
      if (!fs.existsSync(p) || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return r.fulfill({ status: 200, contentType: CT[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(p) });
    }
    if (m !== 'GET' && m !== 'HEAD') {
      log.writes.push(`${m} ${u.pathname}`);
      if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: NOW, threads: {} } });
      if (/\/files\/upload$/.test(u.pathname)) { log.uploads++; const h = q.headers(); return json(r, { file: { id: 'drop_qa' + log.uploads, filename: h['x-wizard-filename'] || 'f', mime: h['x-wizard-mime'] || '', bytes: 70 } }); } // the take's own audio copy (custody), not a message
      if (/\/transcribe$/.test(u.pathname)) { log.stt++; return json(r, { text: R.words, ms: 5 }); }
      if (u.pathname === '/wizard/v1/route') { log.routes.push(JSON.parse(q.postData() || '{}')); return json(r, { ms: 5, cmd: R.cmd }); }
      return json(r, { error: 'qa: write refused' }, 403);
    }
    if (u.pathname === '/wizard/v1/bootstrap') return json(r, { bootstrap: 1, api: 'wizard-agent-service/1', settings: { owner: { name: 'Robin', place: '' }, agent: { name: 'Merlin' }, clock: { timezone: 'UTC', day_starts_at: '06:00' }, voice: { language: 'en', vocabulary: [] } },
      capabilities: { voice: true, router: true, files: true, approvals: true, steer: true, markdown: true }, endpoints: { sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs', transcribe: '/wizard/voice/transcribe', route: '/wizard/v1/route', upload: '/wizard/files/upload', apps: '/wizard/v1/apps' } });
    if (u.pathname === '/wizard/hermes/api/sessions') return json(r, { data: THREADS, has_more: false });
    const mm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm) return json(r, { object: 'list', data: [{ id: 1, role: 'user', content: 'hello', timestamp: NOW / 1000 - 100 }, { id: 2, role: 'assistant', content: 'hi', timestamp: NOW / 1000 - 90 }] });
    const sm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)$/);
    if (sm) { const t = THREADS.find(x => x.id === decodeURIComponent(sm[1])); return t ? json(r, { session: t }) : json(r, { error: 'not_found' }, 404); }
    if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: NOW - 864e5, threads: {} } });
    if (u.pathname === '/wizard/thread-dispositions') return json(r, { state: {} });
    if (u.pathname === '/wizard/hermes/api/model/options') return json(r, { model: 'fixture-model', provider: 'fixture', providers: [{ slug: 'fixture', name: 'Synthetic fixture route', authenticated: true, is_current: true, models: ['fixture-model'] }] });
    if (u.pathname === '/wizard/v1/apps') return json(r, { apps: APPS.map(([id, name]) => ({ id, name, desc: name, url: `/${id}/`, icon: name[0], colors: ['#8f63ff', '#ff5ccf'], source: 'launcher.json' })) });
    return json(r, {});
  });
  await ctx.addInitScript(s => { try { if (!sessionStorage.getItem('qa.seeded')) { sessionStorage.setItem('qa.seeded', '1'); localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.welcome.v1', 'done'); for (const k in s) localStorage.setItem(k, s[k]); } } catch (e) {} }, seed);
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(String(e)));
  p.cdp = await ctx.newCDPSession(p);
  await p.goto(ORIGIN + '/qa-start').catch(() => {});
  await p.goto(URL_, { waitUntil: 'load' });
  await ready(p, enable);
  return { ctx, p };
}
async function ready(p, enable = true) {
  await p.waitForFunction(() => window.__wos?.live?.ok && window.WosExperience && !WosExperience.state.busy && window.WosOrbSwitcher?.active(), null, { timeout: 30000 });
  ok(!await p.locator('[data-tweak-toggle="wizard/orb-radial"]').count(), 'radial is core, not a tweak switch');
  await p.waitForFunction(() => window.WosOrbSwitcher?.active());
  await p.waitForFunction(() => window.WizCore.apps && document.querySelector('#search'), null, { timeout: 10000 });
  await sleep(1200);
}
const shot = async (p, n) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, n + '.png') }); } };
// Real touch events (pointerType touch), so the suite exercises what a thumb does.
const T = (p, type, x, y) => p.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }] });
async function slide(p, from, to, steps = 10, dt = 16) { for (let i = 1; i <= steps; i++) { await T(p, 'touchMove', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await sleep(dt); } }
async function orbXY(p) { const r = await p.locator('#orbWrap').boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
const wedges = p => p.evaluate(() => [...document.querySelectorAll('.wor-ic')].map(e => { const r = e.getBoundingClientRect(), w = document.querySelector(`.wor-w[data-i="${e.dataset.i}"]`); return { i: +e.dataset.i, kind: [...e.classList].find(c => ['voice', 'custom', 'app'].includes(c)) || 'app', label: w.getAttribute('aria-label'), x: r.x + r.width / 2, y: r.y + r.height / 2, dis: e.classList.contains('dis') }; }));
const byLabel = (ws, re) => ws.find(w => re.test(w.label));
// The radial's own geometry (viewport px, centre = the orb): ring, slot, radii, sweep, desk index, label.
const geo = p => p.evaluate(() => WosOrbSwitcher._wedges().map((w, i) => ({ i, kind: w.kind, ring: w.ring, k: w.k, r0: w.r0, r1: w.r1, rm: w.rm, a0: w.a0, a1: w.a1, x: w.x, y: w.y, desk: w.item ? w.item.desk : null, open: !!w.item?.open, cur: !!w.item?.cur, id: w.item?.id, label: w.kind === 'voice' ? 'Voice command' : w.kind === 'custom' ? 'Customize' : w.item.label })));
const arcAtMid = w => w.rm * (w.a1 - w.a0) * Math.PI / 180;
const dist = (w, o) => Math.hypot(w.x - o.x, w.y - o.y);
// Close any desk that is not Home, Chats or one of the three fixture apps, so the ring contents are predictable.
async function resetDesks(p) {
  await p.evaluate(() => { const keep = ['notes', 'wizard-calendar', 'stories']; for (let i = __wos.desks.length - 1; i > 0; i--) { const d = __wos.desks[i]; if (d.home) continue; const ids = d.wins.map(w => __wos.wins[w].appId || __wos.wins[w].app); if (!ids.some(id => keep.includes(id) || id === 'chats' || id === 'wizard')) __wos.closeDesk(i); } __wos.goDesk(0); });
  await sleep(900);
}
const radialOpen = p => p.evaluate(() => !!document.querySelector('.wor.on') || !!document.querySelector('.wor:not(.off)'));
const st = p => p.evaluate(() => ({ idx: __wos.idx, n: __wos.desks.length, voice: __wos.voice, kind: __wos.V.kind, sheet: __wos.sheet, zen: document.getElementById('device').classList.contains('zen'), sw: { open: WosOrbSwitcher.isOpen, sel: WosOrbSwitcher.selected, v: WosOrbSwitcher.voice } }));
// The desk whose section sits nearest the viewport's left edge (the one actually in view), not the label.
const visibleDesk = p => p.evaluate(() => { let best = null, bd = 1e9; for (const el of document.querySelectorAll('.track > .desk')) { const d = Math.abs(el.getBoundingClientRect().left); if (d < bd) { bd = d; best = el; } } return __wos.desks.findIndex(d => d.id === best?.dataset.did); });
async function press(p, o, ms = 480) { await T(p, 'touchStart', o.x, o.y); await sleep(ms); }
async function hold(p, o, ms = 480) { await press(p, o, ms); await p.waitForFunction(() => window.WosOrbSwitcher?.isOpen); }
const release = p => T(p, 'touchEnd');
async function closeAnyRadial(p) { await release(p).catch(() => {}); await sleep(300); }
async function openDeskFor(p, names) { for (const n of names) { await p.evaluate(n => window.__wos.handleText(n, 'command', false, 100, null), n).catch(() => {}); await sleep(700); } }
async function setPins(p, pins, extra = {}) { await p.evaluate(a => WosOrbSwitcher.set(a), { pins, ...extra }); }
const settle = async p => { await p.waitForFunction(() => __wos.V.state === 'idle' && !__wos.V.admitting, null, { timeout: 10000 }).catch(() => {}); await sleep(500); };
async function cancelTake(p) { await p.evaluate(() => window.__wos.cancelVoice(true)); await sleep(400); }

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
  for (const oldChoice of [true, false]) {
    const {ctx:oldCtx,p:old}=await boot(b,undefined,{'wos.skin-tweaks.v1':JSON.stringify({version:1,off:{},preset:'none',mix:{'wizard/orb-radial':oldChoice}})});
    const oo=await orbXY(old);await press(old,oo,650);
    ok(await radialOpen(old) && await old.evaluate(()=>__wos.voice==='idle'), 'legacy '+oldChoice+' choice: core hold opens radial, never a recording');
    await release(old);await oldCtx.close();
  }
  const {ctx,p}=await boot(b);let o=await orbXY(p),ws,s;
  ok(await p.evaluate(()=>WosOrbSwitcher.get().pins.length===0&&!('showOpen' in WosOrbSwitcher.get())&&!WosOrbSwitcher.get().quickTakes),'real defaults: no pins, no desktop switch, quick takes OFF');
  await hold(p,o,900);ws=await wedges(p);ok(ws.length===2&&ws.every(w=>w.kind==='voice'||w.kind==='custom'),'empty radial contains only voice + Customize');
  ok(await p.locator('.wor-label').textContent()==='Pin apps in Customize','empty hint is Pin apps in Customize');
  await shot(p,'orb-radial-pins-empty');await release(p);await sleep(300);
  ok(await p.evaluate(()=>__wos.voice==='idle')&&log.stt===0,'hold-release without movement never starts voice');
  // The real Settings > Phone entry, not a programmatic set(), must pin an app.
  await p.evaluate(()=>__wos.openSheet('settings'));await p.locator('[data-st-page=phone]').click();await p.locator('[data-orbsw-open]').click();
  ok(await p.locator('.wor-sheet [data-toggle=showOpen]').count()===0,'Show open apps is absent');
  ok((await p.locator('.wor-sheet').innerText()).includes('Pinned apps fill the radial. Open desktops stay on swipe up.'),'settings explain pins and swipe up');
  await p.locator('[data-app=wizard-calendar] [data-pin]').click();ok(await p.evaluate(()=>WosOrbSwitcher.get().pins.join(',')==='wizard-calendar'),'Settings > Phone pin toggle changes saved pins');
  ok(await p.evaluate(()=>JSON.parse(localStorage.getItem('wos.orbSwitcher.v1')).pins.join(',')==='wizard-calendar'),'pin persisted under canonical storage key');
  await p.locator('.wor-sheet [data-close]').click();await p.evaluate(()=>__wos.closeSheets());await sleep(400);
  await hold(p,o);let g=await geo(p);ok(g.filter(w=>w.kind==='app').map(w=>w.id).join(',')==='wizard-calendar','reopened radial contains the pin, no unpinned desktops');
  let target=g.find(w=>w.id==='wizard-calendar');await slide(p,o,target,8,24);await release(p);await sleep(900);
  const calWindow=await p.evaluate(()=>Object.values(__wos.wins).find(w=>w.appId==='wizard-calendar')?.id);
  ok(!!calWindow&&await p.evaluate(()=>__wos.desks[__wos.idx].wins.some(id=>__wos.wins[id].appId==='wizard-calendar')),'releasing on newly pinned app opens it through shared opener');
  // Put another app in front on the same desk. The old build hides Calendar completely here.
  await p.evaluate(()=>__wos.openApp(WizCore.apps('mobile').APP.notes,{}, {desk:__wos.idx}));await sleep(700);await p.evaluate(()=>__wos.goDesk(0));await sleep(400);
  await hold(p,o);g=await geo(p);target=g.find(w=>w.id==='wizard-calendar');
  ok(!!target&&target.open&&target.label==='Calendar','split desk: pinned secondary app keeps its own icon/name and open status');
  ok(await p.locator('.wor-ic.app .wor-dot').count()===1,'open pin shows its open dot even on another desk');
  await slide(p,o,target,8,22);await sleep(300);await release(p);await sleep(900);
  ok(await p.evaluate(id=>__wos.desks[__wos.idx].focus===id,calWindow),'release on already-open secondary pin focuses its app, not just a cached desk');
  ok(await p.evaluate(id=>Object.values(__wos.wins).filter(w=>w.appId==='wizard-calendar').length===1,calWindow),'open pin reuses its existing window');
  await p.evaluate(()=>__wos.goDesk(0));await sleep(400);await hold(p,o);g=await geo(p);target=g.find(w=>w.kind==='custom');await slide(p,o,target,8,20);await release(p);await sleep(300);
  ok(await p.evaluate(()=>WosOrbSwitcher.sheetOpen),'Customize wedge opens the real settings sheet');
  await p.locator('[data-app=notes] [data-pin]').click();await p.locator('[data-app=stories] [data-pin]').click();await p.locator('[data-app=wizard] [data-pin]').click();
  ok(await p.evaluate(()=>WosOrbSwitcher.get().pins.join(',')==='wizard-calendar,notes,stories,wizard'),'Customize pin toggles append in user order');
  await p.locator('[data-app=wizard] [data-mv=top]').click();
  ok(await p.evaluate(()=>WosOrbSwitcher.get().pins.join(',')==='wizard,wizard-calendar,notes,stories'),'move-to-top changes the radial order');
  // Late registry arrival must repaint an already open picker; app IDs are used verbatim.
  await p.evaluate(()=>{const r=WizCore.apps('mobile');r.APPS.push({id:'delayed-app',name:'Delayed app',kind:'wizard',url:'/delay/'});r.APP['delayed-app']=r.APPS.at(-1);window.dispatchEvent(new CustomEvent('wizard:apps'));});
  ok(await p.locator('[data-app=delayed-app] [data-pin]').count()===1,'late installed app appears without closing Customize');
  await shot(p,'orb-radial-pins-settings');
  await p.locator('.wor-sheet [data-close]').click();await p.reload({waitUntil:'load'});await ready(p);
  ok(await p.evaluate(()=>WosOrbSwitcher.get().pins.join(',')==='wizard,wizard-calendar,notes,stories'),'pin IDs and user order survive reload');o=await orbXY(p);
  await p.evaluate(()=>__wos.goDesk(0));await sleep(300);
  for(const skin of ['nebula','grove']){
    await p.evaluate(s=>WosSkin.set(s),skin);await p.waitForFunction(()=>!WosExperience.state.busy&&WosOrbSwitcher?.active());await sleep(500);o=await orbXY(p);await hold(p,o);g=await geo(p);
    ok(g.length===6&&g.filter(w=>w.kind==='app').map(w=>w.id).join(',')==='wizard,wizard-calendar,notes,stories',skin+': wedge set exactly four pins + voice + Customize, never desktops');
    ok(g.filter(w=>w.kind==='app').every(w=>w.ring===0),skin+': four pins fill inner ring, outer empty except Customize');
    const voice=g.find(w=>w.kind==='voice'),custom=g.find(w=>w.kind==='custom');
    ok(voice.ring===0&&voice.k===0&&custom.ring===1&&custom.k===8,skin+': near voice rightmost inner, Customize far-left outer');
    ok(g.every(w=>w.r1<=138&&arcAtMid(w)>=40),skin+': compact 138 px and >=40 px mid-arc targets');
    await sleep(650);await shot(p,'orb-radial-pins-'+skin);await release(p);await sleep(300);
  }
  // Capacity, both voice positions, pin order and real hit-testing, with no filler slots.
  const thirteen=['wizard','wizard-calendar','notes','stories','wisdom','wizard-music','wizard-search','topics','files-qa','home','pages','setup','troubleshooter'];
  for(const voiceSlot of ['near','far']){
   await setPins(p,thirteen,{voiceSlot});await hold(p,o);g=await geo(p);
   const app=g.filter(w=>w.kind==='app');ok(g.length===15&&app.map(w=>w.id).join(',')===thirteen.join(','),voiceSlot+': all 13 pins occupy exactly 13 slots in pin order');
   ok(app.filter(w=>w.ring===0).length===(voiceSlot==='near'?5:6)&&app.filter(w=>w.ring===1).length===(voiceSlot==='near'?8:7),voiceSlot+': correct per-ring capacity');
   ok(g.find(w=>w.kind==='voice').ring===(voiceSlot==='near'?0:1)&&g.find(w=>w.kind==='voice').k===0,voiceSlot+': fixed rightmost voice slot');
   for(const w of g){await T(p,'touchMove',w.x,w.y);await sleep(60);const selected=await p.evaluate(()=>WosOrbSwitcher.selected);ok(selected===w.i,voiceSlot+': hit-test '+(w.id||w.kind),JSON.stringify({expected:w.i,selected}));}
   await T(p,'touchMove',o.x,o.y);await release(p);await sleep(250);
  }
  await setPins(p,['wizard','wizard-calendar','notes','stories'],{voiceSlot:'near',holdMs:300});await p.evaluate(()=>WosSkin.set('nebula'));await sleep(500);o=await orbXY(p);
  // Swipe-up classification outside the hold is unchanged with the tweak ON (the two-orbs pass went with that switch,
  // wizard-ux issue 1239).
  for(const two of [false]){
   for(const desks of [false,true]){
    await p.evaluate(d=>{document.documentElement.style.setProperty('--wos-orb-swipe-up',d?'desks':'');__wos.closeSheets();__wos.closeOverview();},desks);o=await orbXY(p);await T(p,'touchStart',o.x,o.y);await slide(p,o,{x:o.x,y:o.y-150},8,12);await release(p);await sleep(500);
    ok(await p.evaluate(d=>d?!!document.querySelector('#overview.open'):__wos.sheet==='launcher',desks),`ON swipe up: two-orbs ${two}, CSS desks ${desks} preserves shell route`);
   }
   await p.evaluate(()=>{__wos.closeSheets();__wos.closeOverview();});
  }
  await p.evaluate(()=>{document.documentElement.style.removeProperty('--wos-orb-swipe-up');__wos.goDesk(0);});await sleep(400);o=await orbXY(p);
  // Plain and jittered holds cannot start voice.
  await hold(p,o,1600);await release(p);await sleep(250);ok(await p.evaluate(()=>__wos.voice==='idle'),'1.6 s plain hold-release starts no recording');
  await hold(p,o);await T(p,'touchMove',o.x+3,o.y-3);await sleep(650);await release(p);await sleep(250);ok(await p.evaluate(()=>__wos.voice==='idle'),'jittered hold-release starts no recording');
  // Retained voice-dwell acceptance follows unchanged.
  // ---- 5. Voice wedge: dwell arms, then records; release runs the command; slide out discards ----
  log.writes.length = 0; log.stt = 0; log.routes.length = 0;
  await T(p, 'touchStart', o.x, o.y); await sleep(480);
  ws = await wedges(p); const V0 = ws.find(w => w.kind === 'voice');
  ok(Math.hypot(V0.x - o.x, V0.y - o.y) < 90, 'voice wedge is close: its centre is under 90 px from the orb', String(Math.hypot(V0.x - o.x, V0.y - o.y)));
  await p.evaluate(() => { WosOrbSwitcher.set({ holdMs: 450 }); window.__samples = []; const f = () => { window.__samples.push([WosOrbSwitcher.voice, +document.querySelector('.wor-arm').style.strokeDashoffset, +getComputedStyle(document.querySelector('.wor-arm')).opacity]); window.__raf = requestAnimationFrame(f); }; f(); });
  await T(p, 'touchMove', V0.x, V0.y); // one jump onto the wedge: a fast finger keeps restarting the dwell...
  const fast = await p.evaluate(() => ({ v: WosOrbSwitcher.voice, off: document.querySelector('.wor-arm').style.strokeDashoffset }));
  ok(fast.v === 'arming' && +fast.off >= 99, 'arriving fast: arming has started but the dwell sweep has not advanced (speed guard)', JSON.stringify(fast));
  for (let i = 0; i < 40 && (await st(p)).voice !== 'command'; i++) { await T(p, 'touchMove', V0.x + (i % 2), V0.y); await sleep(40); if (i === 3) await shot(p, 'radial-voice-arming'); } // ...a slow finger lets it sweep
  await sleep(300);
  const sm = await p.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__samples; });
  const iRec = sm.findIndex(x => x[0] === 'rec'), mid = sm.slice(0, iRec).filter(x => x[0] === 'arming' && x[1] > 0 && x[1] < 99 && x[2] > 0);
  ok(iRec > 0 && mid.length >= 2, 'resting on the voice wedge shows the arming sweep growing, and recording starts only after it completes', JSON.stringify({ iRec, mid: mid.length, n: sm.length }));
  await p.evaluate(() => WosOrbSwitcher.set({ holdMs: 300 }));
  s = await st(p);
  ok(s.voice === 'command' && s.kind === 'command', 'after the dwell the voice command starts (startVoice command)', JSON.stringify(s));
  await sleep(250);
  ok(await p.evaluate(() => !!document.querySelector('.wor-w.voice.rec') && WosOrbSwitcher.voice === 'rec'), 'wedge shows the recording state');
  await shot(p, 'radial-voice-recording');
  // slide out of the wedge: take is discarded, back to selection
  const away = ws.filter(w => w.kind === 'app').find(w => /^Notes/.test(w.label));
  await slide(p, V0, away, 8, 25); await sleep(500);
  s = await st(p);
  ok(s.voice === 'idle' && log.stt === 0, 'sliding out of the voice wedge discards the take (nothing transcribed)', JSON.stringify({ s, stt: log.stt }));
  ok(await radialOpen(p) && s.sw.sel === away.i, 'and the radial stays open on the wedge the finger moved to', JSON.stringify(s));
  await slide(p, away, o, 8, 20); await release(p); await sleep(600);
  ok((await st(p)).idx === 0 && !(await radialOpen(p)), 'release back on the orb after discarding: nothing happens');
  // now the full run: dwell, speak, release inside = command
  await T(p, 'touchStart', o.x, o.y); await sleep(480);
  await slide(p, o, V0, 8, 25);
  for (let i = 0; i < 20 && (await st(p)).voice !== 'command'; i++) { await T(p, 'touchMove', V0.x + (i % 2), V0.y); await sleep(60); }
  ok((await st(p)).voice === 'command', 'second take: voice command recording');
  await sleep(900);
  await release(p);
  await p.waitForFunction(() => __wos.voice === 'idle', null, { timeout: 15000 }).catch(() => {}); await sleep(1500);
  const cal = await p.evaluate(() => { const d = __wos.desks[__wos.idx]; return d.wins.map(w => __wos.wins[w].appId || __wos.wins[w].app); });
  ok(log.stt === 1, 'release inside the voice wedge finishes the take (one transcription)', String(log.stt));
  ok(cal.includes('wizard-calendar'), 'stubbed transcript "open calendar" ran as a command: Calendar is in front', JSON.stringify(cal));
  ok(runs().length === 0, 'voice command sent nothing to the agent (zero /v1/runs or sessions)', JSON.stringify(log.writes));
  await p.evaluate(() => __wos.goDesk(0)); await sleep(700);


  // A retired switch is harmless and cannot disable a core phone capability.
  await p.evaluate(()=>WosExperience.toggle('wizard/orb-radial'));
  ok(await p.evaluate(()=>WosOrbSwitcher.active()),'retired toggle cannot tear down core handler');
  await p.reload({waitUntil:'load'});await ready(p);
  o=await orbXY(p);await hold(p,o,650);
  ok(await radialOpen(p)&&await p.evaluate(()=>__wos.voice==='idle'),'reload always restores ready radial without recording');
  await release(p);
  ok(p.errs.length===0,'no browser JS errors',JSON.stringify(p.errs));await ctx.close();
  const {ctx:smallCtx,p:small}=await boot(b,{width:360,height:780});await setPins(small,['wizard','wizard-calendar','notes','stories']);const so=await orbXY(small);await hold(small,so);const sg=await geo(small);
  ok(sg.every(w=>w.r1<=138&&w.x>=8&&w.x<=352),'360 px compact radial fits without enlarging target radius');await release(small);await smallCtx.close();
  ok(runs().length===0,'zero /v1/runs or new session writes throughout all scenarios',JSON.stringify(runs()));
  console.log(`\n${pass} passed, ${fail} failed`);if(fail)process.exitCode=1;
  } finally { await b.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
