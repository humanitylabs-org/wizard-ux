// Real phone + desktop shells, contract fake only: no owner/relay/network writes.
// QA_URL=http://127.0.0.1:9371 QA_OUT=... node tools/qa-look-skins.cjs
const {chromium} = require('./qa-playwright.cjs'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const fake = require('./fake-skins-api.cjs');
const BASE = process.env.QA_URL, ROOT = process.env.CAND_DIR || path.join(__dirname, '../web'), OUT = process.env.QA_OUT || 'qa-look-skins';
if (!BASE) throw Error('QA_URL required');
fs.mkdirSync(OUT, {recursive: true});
const receipt = {sha: process.env.QA_SHA, tree: process.env.QA_TREE, host: require('node:os').hostname(), fixture: true, tests: [], limitations: ['API, identity, capture and signatures are explicit contract fakes, not native/crypto/relay proof']};
const check = (name, pass, detail) => {receipt.tests.push({name, pass: !!pass, detail}); console.log(pass ? 'PASS' : 'FAIL', name, detail ?? ''); assert.ok(pass, name);};
const TYPES = {'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.json':'application/json'};
(async () => {
 const browser = await chromium.launch({...process.env.QA_CHROME ? {executablePath:process.env.QA_CHROME} : {}, args: ['--use-gl=angle','--use-angle=swiftshader']});
 try {
  for (const mobile of [true, false]) {
   const f = fake(), mode = mobile ? 'phone' : 'desktop', errors = [], refused = [];
   const c = await browser.newContext({viewport:mobile?{width:412,height:892}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block', ...(mobile ? {userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'} : {})});
   await c.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    const send = (body, contentType = 'application/json', status = 200) => r.fulfill({body: typeof body === 'object' && !Buffer.isBuffer(body) ? JSON.stringify(body) : body, contentType, status});
    if (u.pathname.startsWith('/wizard/v1/skins') || u.pathname === '/wizard/v1/my-skin') return r.fulfill(f.handle(u.pathname + u.search, q.method(), q.postData() ? JSON.parse(q.postData()) : {}));
    if (u.origin !== new URL(BASE).origin) return send('', 'text/plain', 404);
    if (!['GET','HEAD'].includes(q.method())) { refused.push(q.method() + ' ' + u.pathname); return send({}, 'application/json', 403); }
    if (u.pathname === '/wizard/v1/bootstrap') return send({bootstrap:1,settings:{owner:{name:'',place:''},agent:{name:'Demo Wizard'},clock:{timezone:'',day_starts_at:'00:00'},voice:{language:'',vocabulary:[]}},capabilities:{},endpoints:{}});
    if (u.pathname === '/wizard/v1/apps') return send({apps:[]});
    if (u.pathname.endsWith('/setup')) return send({first_run:false,items:[]});
    if (u.pathname.endsWith('/sessions')) return send({data:[],has_more:false});
    if (u.pathname.endsWith('/thread-seen')) return send({state:{initializedAt:Date.now(),threads:{}}});
    if (u.pathname.endsWith('/thread-dispositions')) return send({state:{}});
    if (u.pathname.startsWith('/wizard/')) return send({}, 'application/json', 404);
    if (u.pathname.startsWith('/wizard-os-home/')) {
     const rel = u.pathname.slice('/wizard-os-home/'.length) || 'index.html';
     if (rel === 'data.js') return send('window.WIZ_DATA={projects:{},threads:[]};','application/javascript');
     if (rel === 'summaries.js') return send("window.WIZ_SUMM={days:{},weeks:{},month:''};",'application/javascript');
     const p = path.resolve(ROOT, rel); if (p.startsWith(path.resolve(ROOT) + path.sep) && fs.existsSync(p) && fs.statSync(p).isFile()) return send(fs.readFileSync(p), TYPES[path.extname(p)] || 'application/octet-stream');
    }
    return send('', 'text/plain', 404);
   });
   await c.addInitScript(mobile => {
    if (window !== parent) return;
    localStorage.setItem('wos.coached','true');localStorage.setItem('wos.voiceTipSeen','true');
    localStorage.setItem('wos.myskin.js.ok','unchanged-fixture-approval');
    window.__nativeCalls=[];window.__identity=false;window.__deny=true;
    if (mobile) window.WizardNative = {postMessage(raw) {
     const m=JSON.parse(raw);__nativeCalls.push(m);
     let result;
     if(m.method==='identity.info') result=__identity?{pubkey:'a'.repeat(64),npub:'npub1fixture',name:'Demo maker',picture:null,backed_up:true}:{none:true};
     else if(m.method==='identity.setup'){__identity=true;result={pubkey:'a'.repeat(64),npub:'npub1fixture'};}
     else if(m.method==='view.capture'){
      const d=document.querySelector('.ls-demo');window.__captureSafe=!!d&&d.contentDocument.body.textContent.includes('Let’s make room for a good day.')&&!d.contentDocument.body.textContent.includes('Demo Wizard');
      result={webp_b64:'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',width:340,height:400};
     } else if(m.method==='identity.sign') result=__deny?{denied:true}:{...m.params.event,id:'d'.repeat(64),sig:'e'.repeat(128)};
     else result={};
     queueMicrotask(()=>window.wizardNativeReply({id:m.id,result}));
    }};
   }, mobile);
   const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message));
   const openLook = async () => {await p.evaluate(()=>WizCore.deeplink.route(location.pathname+'?view=skin')); await p.locator('[data-ls-view="store"]').waitFor();};
   const click = async sel => {await p.locator(sel).first().click(); await idle();};
   const idle = async () => {await p.waitForFunction(()=>!document.querySelector('.ls-look[aria-busy="true"]'));};
   const level = () => p.locator('[data-look-level]').getAttribute('data-look-level');
   const back = async () => {await p.evaluate(()=>dispatchEvent(new CustomEvent('wizard:back'))); await p.waitForTimeout(120);};
   await p.goto(BASE+'/wizard-os-home/'+(mobile?'?shell=phone':'desktop.html?shell=desktop'));
   await p.waitForFunction(m=>m?!!window.__wos:!!window.__wux,mobile); await openLook();
   check(mode+': Default retains original built-in picker', await p.locator('[data-skinpick]').count() > 0);
   await click('[data-ls-view="mine"]');
   check(mode+': My skins shows folders/None and native capability gate', await p.locator('.ls-mine').count()===1 && await p.locator('[data-ls="active"][data-ls-id=""]').count()===1 && (mobile?await p.locator('[data-ls="setup"]').count()>0:await p.locator('[data-ls="publish"]').isDisabled()));
   await click('[data-ls="new"]');await p.locator('[data-ls-field="name"]').fill('A second look');await click('[data-ls="submit"]');check(mode+': New folder readback',await p.locator('.ls-mine').count()===2);
   await click('[data-ls="active"][data-ls-id=""]');check(mode+': None removes real layer',f.active===null&&!await p.locator('#wosMySkin').count());
   await click('[data-ls="active"][data-ls-id="my-skin"]');
   await click('[data-ls-view="store"]');
   check(mode+': Featured first + image/swatch + author/date/forks', (await p.locator('.ls-card').first().innerText()).includes('Quiet Grove') && await p.locator('img.ls-preview').count()===1 && await p.locator('.ls-swatch i[style]').count()===3 && (await p.locator('.ls-card').first().innerText()).includes('7 forks'));
   await p.screenshot({path:path.join(OUT,mode+'-nebula-store.png')});
   await click('.ls-card');
   const cache=await p.evaluate(()=>({css:localStorage.getItem('wos.myskin.v1'),approval:localStorage.getItem('wos.myskin.js.ok'),state:JSON.stringify(WosMySkin.state)}));
   await click('[data-ls="try"]');
   check(mode+': Try on uses temporary verified CSS, suppresses real sheet',await p.locator('#wosSkinTryOn').count()===1&&await p.locator('#wosMySkin').getAttribute('media')==='not all');
   check(mode+': Try on changes no cached CSS/state/script approval',await p.evaluate(before=>before.css===localStorage.getItem('wos.myskin.v1')&&before.approval===localStorage.getItem('wos.myskin.js.ok')&&before.state===JSON.stringify(WosMySkin.state),cache));
   await click('[data-ls="cancel-try"]');check(mode+': Cancel restores real CSS',!await p.locator('#wosSkinTryOn').count()&&await p.locator('#wosMySkin').getAttribute('media')==='');
   await click('[data-ls="try"]');await click('[data-ls-view="mine"]');check(mode+': changing Look level restores own CSS',!await p.locator('#wosSkinTryOn').count());
   await click('[data-ls-view="store"]');await click('.ls-card');await click('[data-ls="try"]');await p.locator(mobile?'[data-stclose]':'#dsettings [data-close]').click();check(mode+': closing Settings restores own CSS',!await p.locator('#wosSkinTryOn').count());await openLook();await click('[data-ls-view="store"]');await click('.ls-card');
   await click('[data-ls="try"]');await back();check(mode+': Back closes detail and restores own CSS',await level()==='store'&&!await p.locator('#wosSkinTryOn').count());
   await back();check(mode+': next Back leaves Store, not app',await level()==='default'&&p.url().includes('/wizard-os-home/'));
   await click('[data-ls-view="store"]');await click('.ls-card');await click('[data-ls="try"]');await p.reload();await p.waitForFunction(m=>m?!!window.__wos:!!window.__wux,mobile);await openLook();check(mode+': reload discards Try on',!await p.locator('#wosSkinTryOn').count());
   await click('[data-ls-view="store"]');await click('.ls-card');await click('[data-ls="report"]');await p.locator('[data-ls-field="reason"]').fill('Fixture reason');await click('[data-ls="submit"]');check(mode+': Report posts reason',f.calls.some(c=>c.path.endsWith('/report')&&c.body.reason==='Fixture reason'));
   await p.evaluate(()=>WosSkin.set('obsidian-light'));await p.waitForTimeout(3200);await openLook();await click('[data-ls-view="store"]');await click('.ls-card');await p.screenshot({path:path.join(OUT,mode+'-light-detail.png')});
   await click('[data-ls="add"]');check(mode+': Add reads active copy back and applies immediately',f.active==='quiet-grove'&&await p.evaluate(()=>WosMySkin.state.css.includes('--ls-test:store'))&&(await p.locator('.ls-mine').last().innerText()).includes('forked from Quiet Grove'));
   if(mobile){
    await click('[data-ls="setup"]');check('phone: native identity.setup makes Publish available',await p.locator('[data-ls="publish"]').first().isEnabled());
    await click('[data-ls="publish"][data-ls-id="quiet-grove"]');await p.locator('[data-ls-field="name"]').fill('My public grove');await p.locator('[data-ls-field="summary"]').fill('A fixed-demo skin.');
    await p.screenshot({path:path.join(OUT,'phone-light-publish.png')});await click('[data-ls="submit"]');
    check('phone: denied signature publishes nothing',(await p.locator('.sc-sheet').innerText()).includes('Signature denied. Nothing was published.')&&!f.calls.some(c=>c.path.endsWith('/publish')));
    await p.evaluate(()=>window.__deny=false);await click('[data-ls="submit"]');
    check('phone: signed contract event publishes and reads Published state',f.calls.some(c=>c.path.endsWith('/publish')&&c.body.event.tags.some(t=>t[0]==='name'&&t[1]==='My public grove'))&&(await p.locator('.ls-mine').last().innerText()).includes('Published'));
    check('phone: native capture is ONLY fixed sandbox demo',await p.evaluate(()=>__captureSafe&&__nativeCalls.some(c=>c.method==='view.capture'&&c.params.rect.width>0))&&f.calls.some(c=>c.path.endsWith('/pack')&&c.body.preview_webp_b64));
   }
   check(mode+': no page errors',errors.length===0,errors);
   check(mode+': fixture is the only write destination',refused.length===0,refused);
   await c.close();
  }
 } catch(e){receipt.failure=String(e.stack||e);throw e;} finally {fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(receipt,null,2));await browser.close();}
 console.log('ALL PASS',receipt.tests.length,'checks');
})().catch(e=>{console.error(e);process.exitCode=1});
