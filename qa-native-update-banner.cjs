// QA: native update banner (PR #1093) in a real browser with a faked native bridge, phone + desktop x Nebula/Sepia.
//   First idle tap calls updateInstall once; a live take (simulated through the bridge's own __dev.takes/__dev.active,
//   not window.__wos.voice) holds the install; the update hint is re-seeded per skin so each skin starts from 'ready'.
//   Synthetic only: every request is routed to the fake Wizard; asserts zero runs/uploads/transcribes.
// Usage: QA_WEB_DIR=<worktree> QA_OUT=<dir> node qa-native-update-banner.cjs  (post-ship harness from the 0.10.27 run)
// QA: Wizard OS device features (feature/native-parity) in the web shell, with a faked native bridge.
//   #14 orb records through the native foreground-service recorder (WizardOSDevice.recStart/recStop), a take that
//       outlives the page is picked back up, a notification Send / an interrupted take reaches the durable outbox once.
//   #20 a shared item opens the Share sheet, uploads to Wizard Files and starts a new chat with the attachment;
//       Back closes the sheet and the app stays open.
//   #21 every send the outbox delivers is handed to the native reply watcher (watchRun).
//   #22 the native update banner shows/acts; the web hot-reload swaps in new code and keeps chat drafts.
// Usage: QA_WEB_DIR=<worktree> node qa-device.cjs  (self-contained: every request is routed; nothing leaves the box)
// Negative control: set QA_WEB_DIR to the pre-fix daily tree; the new updater assertions must FAIL.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const URL_ = (require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/');
const WEB = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || process.env.QA_OUT || path.join(process.env.TMPDIR || require('os').tmpdir(), 'qa-device');
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The fake Wizard: records every write; nothing reaches the real one.
const W = { uploads: [], sessions: new Set(), runs: [], keys: new Map(), transcribes: 0, assetVer: 1, foreign: [] };
async function boot(b, { native = true } = {}) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.hostname !== new URL(require('./tools/qa-paths.cjs').origin()).hostname) { W.foreign.push(u.href); return r.abort(); }
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && (q.method() === 'GET' || q.method() === 'HEAD') && !m[1].startsWith('api/')) {
      const f = m[1] || 'index.html', p = path.join(WEB, 'web', f);
      // Each "deploy" moves the web/ tree id the commit hooks write to ux-version.txt; W.noVersion = an origin without it.
      if (f === 'ux-changes.json') return W.changes ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(W.changes) }) : r.fulfill({ status: 404, body: '' });
      if (f === 'ux-version.txt') return W.noVersion ? r.fulfill({ status: 404, body: '' }) : r.fulfill({ status: 200, contentType: 'text/plain', body: (0xabc0000 + W.assetVer).toString(16) + '\n' });
      if (!fs.existsSync(p) || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : f.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/javascript';
      // Each "deploy" bumps the ETag of app.js, the way the static server's Last-Modified changes.
      // Headers only change through W.lenBump (the Agent Service sends no ETag, only Content-Length).
      const body = fs.readFileSync(p);
      return r.fulfill({ status: 200, contentType: ct, headers: { 'content-length': String(body.length + (f === 'core/chat-kit.js' ? W.lenBump || 0 : 0)) }, body: f === 'core/chat-kit.js' && W.lenBump ? Buffer.concat([body, Buffer.from(' '.repeat(W.lenBump))]) : body });
    }
    const json = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/wizard/hermes/api/model/options') return json({model:'fixture-model',provider:'fixture',providers:[{slug:'fixture',name:'Synthetic fixture route',authenticated:true,is_current:true,models:['fixture-model']}]});
    if (u.pathname.endsWith('/api/transcribe')) { W.transcribes++; return json({ text: 'Native recorder QA take', ms: 4 }); }
    if (u.pathname.endsWith('/api/route')) return json({ cmd: { route: 'agent' }, ms: 2 });
    if (u.pathname === '/wizard/hermes/api/sessions' && q.method() === 'GET') return json({ data: [{ id: 'qa_old_thread', title: 'Existing QA thread', status: 'completed', updated_at: new Date().toISOString() }], has_more: false });
    if (/^\/wizard\/hermes\/api\/sessions\/[^/]+\/messages/.test(u.pathname)) return json({ data: [] });
    if (u.pathname === '/wizard/thread-seen') return json({ state: { initializedAt: Date.now(), threads: {} } });
    if (u.pathname === '/wizard/thread-dispositions') return json({ state: {} });
    if (q.method() === 'GET') return json({});
    if (u.pathname === '/wizard/files/upload') {
      const h = q.headers(), body = q.postDataBuffer() || Buffer.alloc(0);
      const f = { id: 'drop_qa' + (W.uploads.length + 1), filename: h['x-wizard-filename'], mime: h['x-wizard-mime'], bytes: body.length };
      W.uploads.push(f); return json({ file: f }, 201);
    }
    if (u.pathname === '/wizard/hermes/api/sessions') { const id = JSON.parse(q.postData() || '{}').id; if (W.sessions.has(id)) return json({ error: 'exists' }, 409); W.sessions.add(id); return json({ session: { id } }, 201); }
    if (u.pathname === '/wizard/hermes/v1/runs') {
      const key = q.headers()['idempotency-key'], prev = W.keys.get(key);
      if (prev) return json({ run_id: prev.id, status: 'queued' }, 202);
      const run = { id: 'run_qa' + (W.runs.length + 1), key, body: JSON.parse(q.postData() || '{}') }; W.keys.set(key, run); W.runs.push(run);
      return json({ run_id: run.id, status: 'queued' }, 202);
    }
    return json({});
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(({ native }) => {
    try { localStorage.setItem('wos.coached', 'true'); } catch (e) {}
    if (!native || location.protocol === 'about:') return;
    // A faithful stand-in for the Android WizardOSDevice bridge (same method names and JSON shapes).
    const S = window.__dev = JSON.parse(sessionStorage.getItem('qa.dev') || 'null') || { calls: [], takes: {}, active: null, shares: {}, watch: [], upd: { state: 'idle', installed: '0.5.1' }, notif: { allowed: true, watching: 0 } };
    const persist = () => sessionStorage.setItem('qa.dev', JSON.stringify(S));
    const bytes = n => Array.from({ length: n }, (_, i) => (i * 7) & 255);
    const b64 = a => btoa(String.fromCharCode(...a));
    const call = (...a) => { S.calls.push(a.join(':')); persist(); };
    const chunk = (arr, off) => { if (!arr) return 'null'; const end = Math.min(off + 3000, arr.length); return JSON.stringify({ b64: b64(arr.slice(off, end)), next: end >= arr.length ? -1 : end, size: arr.length }); };
    window.WizardOSNative = { platform: () => 'android:qa', sideButton: () => '{"mic":true,"assistant":true,"used":true,"samsung":false,"step":"done"}', unsent: () => '[]', everywhere: () => '{}', appUnsent() {}, haptic() {}, keepAwake() {} };
    window.WizardOSDevice = {
      version: () => 1,
      recStart(kind) { call('recStart', kind); if (S.active) return S.active; const id = 'rec-qa-' + Date.now(); S.takes[id] = { id, kind, state: 'recording', startedAt: Date.now(), data: bytes(9000) }; S.active = id; persist(); return id; },
      recPause(on) { call('recPause', on); },
      recLevel: () => 35,
      recActive() { return S.active ? JSON.stringify({ id: S.active, ms: Date.now() - S.takes[S.active].startedAt, paused: false, source: 'qa' }) : 'null'; },
      recStop(id) { call('recStop', id); const t = S.takes[id]; if (!t) return 'null'; if (S.active === id) { t.state = 'stopped'; t.ms = Math.max(1500, Date.now() - t.startedAt); S.active = null; } t.claimed = true; persist(); return JSON.stringify({ id, state: t.state, ms: t.ms, kind: t.kind, bytes: t.data.length, mime: 'audio/aac' }); },
      recCancel(id) { call('recCancel', id); delete S.takes[id]; if (S.active === id) S.active = null; persist(); },
      recClaim(id) { call('recClaim', id); const t = S.takes[id]; if (!t) return 'null'; t.claimed = true; persist(); return JSON.stringify({ id, state: t.state, ms: t.ms, kind: t.kind, bytes: t.data.length, mime: 'audio/aac', send: !!t.send }); },
      recRead(id, off) { return chunk(S.takes[id]?.data, off); },
      recDone(id) { call('recDone', id); delete S.takes[id]; persist(); },
      recPending() { return JSON.stringify(Object.values(S.takes).filter(t => t.id !== S.active && !t.claimed).map(t => ({ id: t.id, kind: t.kind, state: t.state === 'recording' ? 'interrupted' : t.state, ms: t.ms || 4000, bytes: t.data.length, send: !!t.send }))); },
      shareMeta(id) { return S.shares[id] ? JSON.stringify(S.shares[id].meta) : 'null'; },
      shareRead(id, n, off) { return chunk(S.shares[id]?.files[n], off); },
      shareDone(id) { call('shareDone', id); delete S.shares[id]; persist(); },
      watchRun(s, r, t) { call('watchRun', s, r); S.watch.push({ s, r, t }); persist(); },
      replyNotes() { return JSON.stringify(S.notes || []); },
      clearThread(s) { call('clearThread', s); const n0 = (S.notes || []).length; S.notes = (S.notes || []).filter(x => x.s !== s); persist(); return n0 - S.notes.length; },
      notifications() { return JSON.stringify(S.notif); },
      updateCheck() { call('updateCheck'); }, updateInstall() { call('updateInstall'); },
      updateState() { return JSON.stringify(S.upd); },
    };
  }, { native }).catch(() => {});
  return { ctx, p, errs };
}
// addInitScript can't take a function argument inside the arg object; seeds are injected as source instead.
async function bootSeeded(b, seedSrc) {
  const r = await boot(b, { native: true });
  await r.p.addInitScript(src => { if (location.protocol === 'about:') return; if (!sessionStorage.getItem('qa.seeded')) { const S = window.__dev; Object.assign(S, (0, eval)(src)(S)); sessionStorage.setItem('qa.dev', JSON.stringify(S)); sessionStorage.setItem('qa.seeded', '1'); } }, seedSrc);
  return r;
}
async function open(p) {
  await p.goto('about:blank');
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok && window.WosDevice && window.WosDevice.ready, null, { timeout: 30000 });
  await sleep(600);
}
const dev = p => p.evaluate(() => window.__dev);
const shot = async (p, n) => { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, 'web-' + n + '.png') }); };
async function tapOrb(p) { const o = await p.locator('#orbWrap').boundingBox(); await p.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2); await sleep(900); }


(async()=>{
  const assert=require('node:assert/strict');
  const browser=await chromium.launch({headless:true});const result=[];
  try {
    for(const shell of ['phone','desktop']) {
      const {ctx,p,errs}=await boot(browser,{native:shell==='phone'});
      if(shell==='desktop')await p.setViewportSize({width:1512,height:920});
      await p.goto(URL_+'?shell='+shell,{waitUntil:'load'});
      await p.waitForFunction(s=>s==='phone'?window.WosDevice?.ready:window.__wux?.shell==='desktop',shell,{timeout:30000});
      const seed=()=>p.evaluate(()=>{window.__dev.upd={state:'deferred',reason:'take',installed:'0.10.26',installedCode:90,version:'0.10.27',versionCode:91};window.WosDevice.event('update',window.__dev.upd);});
      if(shell==='phone')await seed();
      for(const skin of ['nebula','sepia']) {
        if(skin==='sepia') {
          await p.evaluate(s=>(s==='phone'?window.__wos:window.__wux).openSettings('look'),shell);
          const family=p.locator('[data-skinfamily="novairecito"]');if(await family.count())await family.first().click();
          await p.locator('[data-skinpick="sepia"]').first().click();
          await p.waitForFunction(()=>WosSkin.current==='sepia');
          await p.evaluate(s=>{if(s==='desktop')window.__wux.closeSettings();else window.__wosNativeBack();},shell);
        }
        await p.waitForTimeout(350);
        assert.equal(await p.evaluate(()=>WosSkin.current),skin);
        if(shell==='phone'){
          await seed();
          const banner=p.locator('#dvUpdate');const text=await banner.innerText();
          assert.match(text,/Wizard OS 0.10.27 is ready/);assert.match(text,/Install now/);assert.doesNotMatch(text,/installs|recording|restart|Tap again/i);
          const geometry=await banner.evaluate(e=>{const r=e.getBoundingClientRect();return {width:r.width,x:r.x,y:r.y,height:r.height,overflow:e.scrollWidth>e.clientWidth+1,bg:getComputedStyle(e).backgroundColor};});
          assert(!geometry.overflow);assert(geometry.x>=0&&geometry.y>=0);assert(!/rgba\(.+,\s*0\)/.test(geometry.bg));
          await p.screenshot({path:SHOTS+'/'+shell+'-'+skin+'-ready.png'});
          const before=await p.evaluate(()=>__dev.calls.filter(x=>x==='updateInstall').length);
          await banner.locator('[data-upd="go"]').click();
          assert.equal(await p.evaluate(()=>__dev.calls.filter(x=>x==='updateInstall').length),before+1);
          assert.match(await banner.innerText(),/Opening installer/);
          await p.evaluate(()=>{__dev.takes.qa={startedAt:Date.now()};__dev.active='qa';WosDevice.event('update',__dev.upd);});
          assert.match(await banner.innerText(),/Finish your recording first/);
          await banner.locator('[data-upd="go"]').click();
          assert.equal(await p.evaluate(()=>__dev.calls.filter(x=>x==='updateInstall').length),before+1);
          await p.screenshot({path:SHOTS+'/'+shell+'-'+skin+'-take.png'});
          await p.evaluate(()=>{__dev.active=null;delete __dev.takes.qa;WosDevice.event('update',__dev.upd);});
          result.push({shell,skin,text,geometry,firstTapNativeCall:true,takeProtected:true});
        }else{
          assert.equal(await p.locator('#dvUpdate').count(),0);
          await p.screenshot({path:SHOTS+'/'+shell+'-'+skin+'-unchanged.png'});
          result.push({shell,skin,nativeBannerAbsent:true});
        }
      }
      assert.deepEqual(W.runs,[]);assert.deepEqual(W.uploads,[]);assert.equal(W.transcribes,0);
      result.push({shell,pageErrors:errs,writes:{runs:W.runs.length,uploads:W.uploads.length,transcribes:W.transcribes}});
      await ctx.close();
    }
    fs.writeFileSync(SHOTS+'/browser-results.json',JSON.stringify({status:'PASS',synthetic:true,results:result},null,2));console.log('PASS phone/desktop × Nebula/Sepia, first idle tap native, live take protected, no real origin/data/sends');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
