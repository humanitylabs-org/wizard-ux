// Per-app "updated · Reload" QA (core/app-versions.js). Run on Thales: local fixture server, real shell scripts from
// QA_WEB_DIR/web, fixture apps using the real app client. No production requests, no writes.
// Usage: QA_WEB_DIR=<worktree> PW=<playwright> QA_OUT=<dir> node qa-app-versions.cjs
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os'), assert = require('assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const ROOT = process.env.QA_WEB_DIR || __dirname, OUT = process.env.QA_OUT || path.join(ROOT, 'evidence/app-versions');
fs.mkdirSync(OUT, { recursive: true });
const apps = [{id:'messenger',url:'/messenger/',name:'Messenger',colors:['#444444','#777777']}];
const revs={messenger:'synthetic-instant'};
let feedHits = 0, feedStatus = 200;
const writes = [];
const messenger = process.env.MESSENGER_ROOT;
assert.ok(messenger,'MESSENGER_ROOT must be a synthetic source checkout');
const source=fs.readFileSync(path.join(messenger,'static/unified.js'),'utf8');
const composer=source.slice(source.indexOf('  function composer(id, p) {'),source.indexOf('  // WebM (Matroska)'));
const oldTest=fs.readFileSync(path.join(messenger,'tests/voice_note_record_browser.cjs'),'utf8');
const text=oldTest.slice(oldTest.indexOf('const fixture=`')+'const fixture=`'.length,oldTest.indexOf('`;\n(async()=>'));
const iconHelpers=source.slice(source.indexOf('  const ICONS ='),source.indexOf('  // Stable per-name avatar'));
const fixture=text.replace('${composer}',composer).replace(/const iconButton=[^\n]+\n/,iconHelpers+'\n').replace("fmtDur=ms=>'0:'+Math.floor(ms/1000)","fmtDur=ms=>'0:'+String(Math.floor(ms/1000)).padStart(2,'0')");
function appHTML(){return `<!doctype html><html data-app="messenger" class="wz-hosted"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/messenger/app.css"><link rel="stylesheet" href="/messenger/unified.css"><body><main id="root" class="u-thread" style="height:100vh;display:flex;flex-direction:column;justify-content:flex-end"><header class="u-thread-head">Synthetic recording test</header></main><p id="hidden-error" hidden></p><script src="/wizard-os-home/core/app-client.js"></script><script src="/fixture.js"></script></body></html>`;}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const send = (body, ct = 'text/html', status = 200) => { res.writeHead(status, { 'Content-Type': ct, 'Cache-Control': 'no-store' }); res.end(body); };
  if (!['GET', 'HEAD'].includes(req.method)) { writes.push({ method: req.method, url: req.url }); return send('{}', 'application/json', 405); }
  if (u.pathname === '/wizard-os-home/store-data/wizard/v1/installed-apps') {
    feedHits++;
    if (feedStatus !== 200) return send('{"error":"x"}', 'application/json', feedStatus);
    return send(JSON.stringify({ wam: Object.entries(revs).map(([id, commit]) => ({ id, repo: 'x/' + id, commit, version: '1', status: 'running' })), shell: [], complete: true, unavailable: [] }), 'application/json');
  }
  if (u.pathname.endsWith('/ux-version.txt')) return send('tree0001', 'text/plain');
  if (u.pathname.endsWith('/ux-changes.json')) return send('[]', 'application/json');
  if (u.pathname === '/wizard/v1/apps') return send(JSON.stringify({ apps }), 'application/json');
  if (u.pathname === '/wizard/v1/bootstrap') return send(JSON.stringify({ bootstrap: 1, endpoints: { apps: '/wizard/v1/apps' }, settings: { agent: { name: 'Fixture Wizard' } }, capabilities: {} }), 'application/json');
  if (u.pathname === '/wizard/hermes/api/model/options') return send(JSON.stringify({provider:'synthetic', providers:[{slug:'synthetic',authenticated:true,auth_type:'fixture'}]}), 'application/json');
  if (u.pathname === '/wizard/v1/setup') return send(JSON.stringify({first_run:false}), 'application/json');
  if (u.pathname === '/wizard/hermes/api/sessions') return send(JSON.stringify({ data: [], has_more: false }), 'application/json');
  if (u.pathname.endsWith('/thread-seen')) return send(JSON.stringify({ state: { initializedAt: Date.now(), threads: {} } }), 'application/json');
  if (u.pathname.endsWith('/thread-dispositions')) return send(JSON.stringify({ state: {} }), 'application/json');
  if (u.pathname === '/wizard/v1/ui-preferences') return send(JSON.stringify({migrations: {'launcher-seed-v1': true}}), 'application/json');
  if (u.pathname.startsWith('/wizard/')) return send('{}', 'application/json');
  if (u.pathname.endsWith('/sw.js')) return send("self.addEventListener('install',()=>self.skipWaiting());", 'application/javascript');
  if (u.pathname === '/fixture.js') return send(fixture,'application/javascript');
  if (u.pathname === '/messenger/app.css' || u.pathname === '/messenger/unified.css') return send(fs.readFileSync(path.join(messenger,'static',path.basename(u.pathname))),'text/css');
  const app = apps.find(a => u.pathname.startsWith(a.url)); if (app) return send(appHTML(app.id));
  if (u.pathname.startsWith('/wizard-os-home/')) {
    const file = u.pathname.slice('/wizard-os-home/'.length) || 'index.html';
    const p = path.resolve(ROOT, 'web', file); if (!p.startsWith(path.resolve(ROOT, 'web') + path.sep)) return send('', 'text/plain', 403);
    if (file === 'data.js' || file === 'summaries.js') return send('', 'application/javascript');
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return send('', 'text/plain', 404);
    return send(fs.readFileSync(p), file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream');
  }
  send('', 'text/plain', 404);
});
const receipt = { hostname: os.hostname(), source: process.env.QA_SHA, tests: [], blockedExternal: [] };
function ok(name, cond, detail) { receipt.tests.push({ name, pass: !!cond, ...(detail === undefined ? {} : { detail }) }); console.log(cond ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); assert.ok(cond, name); }
let origin;
async function waitFrame(p, url) { await p.waitForFunction(u => [...document.querySelectorAll('iframe')].some(f => f.src === u), url); for (let i = 0; i < 100; i++) { const fr = p.frames().find(f => f.url().split('#')[0] === url); if (fr) return fr; await p.waitForTimeout(50); } throw new Error('Missing frame ' + url); }
const loads = fr => fr.evaluate(() => +document.querySelector('#loads').textContent);
const strip = (p, id) => p.evaluate(id => { const s = [...document.querySelectorAll('.app-upd')].find(e => e.dataset.app === id); if (!s) return null; const b = s.getBoundingClientRect(), f = s.parentElement.querySelector('iframe')?.getBoundingClientRect(); const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); const desc = e => e ? (e.tagName + '.' + [...e.classList].join('.') + '#' + e.id) : null; const chain = []; for (let e = s.parentElement; e && chain.length < 6; e = e.parentElement) chain.push(desc(e) + ' pos=' + getComputedStyle(e).position + ' z=' + getComputedStyle(e).zIndex + ' ov=' + getComputedStyle(e).overflow); const fr = s.parentElement.querySelector('iframe'); window.__qaStripDbg = { top: desc(top), chain, frame: fr && (getComputedStyle(fr).position + ' z=' + getComputedStyle(fr).zIndex), box: [b.left, b.top, b.width, b.height] }; return { dbg: window.__qaStripDbg, onTop: !!top && s.contains(top), text: s.innerText.replace(/\s+/g, ' ').trim(), inWin: !!s.closest('[data-win]'), shown: b.width > 0 && getComputedStyle(s).display !== 'none', nearTop: f ? b.top >= f.top - 1 && b.top < f.top + 80 : false, insideX: f ? b.left >= f.left - 1 && b.right <= f.right + 1 : false }; }, id);
const check = p => p.evaluate(() => WizAppVersions.check());
async function waitFor(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 150)); } return false; }
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const b=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 try{
  const ctx=await b.newContext({viewport:{width:390,height:860},hasTouch:true,isMobile:true,serviceWorkers:'block'});
  await ctx.route('**/*',r=>{if(new URL(r.request().url()).origin!==origin){receipt.blockedExternal.push(r.request().url());return r.abort();}return r.continue();});
  await ctx.addInitScript(()=>{if(window!==parent)return;localStorage.setItem('wos.coached','true');localStorage.setItem('wos.welcome.v1','done');});
  const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(origin+'/wizard-os-home/?shell=phone');await p.waitForFunction(()=>window.__wos&&window.WizAppServices);await p.evaluate(()=>WizCore.appsLoaded());
  await p.evaluate(()=>__wos.openApp(WizCore.apps('mobile').APP.messenger));
  const f=await waitFrame(p,origin+'/messenger/');await f.waitForFunction(()=>window.WizardApp?.hosted&&document.querySelector('.u-mic')); await p.waitForTimeout(2500);
  // Slow row persistence in the parent only: frame is forbidden from owning a recorder.
  await p.evaluate(()=>{const tx=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,...a){const t=tx.call(this,stores,...a);if(this.name==='wizard-app-capture-v1'&&a[0]==='readwrite'){const d=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');Object.defineProperty(t,'oncomplete',{set(fn){d.set.call(t,e=>setTimeout(()=>fn.call(t,e),1200));}});}return t;};});
  await f.evaluate(()=>{document.querySelector('.u-mic').addEventListener('click',()=>window.tap=performance.now(),{capture:true});const obs=new MutationObserver(()=>{if(document.querySelector('.u-recording .u-send')&&!window.timerAt)window.timerAt=performance.now();});obs.observe(document.body,{subtree:true,childList:true});});
  await f.getByRole('button',{name:'Record voice message'}).click();await f.getByRole('button',{name:'Send voice message'}).waitFor();
  const ms=await f.evaluate(()=>timerAt-tap);ok('real hosted capture + Messenger timer in <300ms despite 1200ms storage',ms<300,{ms});
  ok('physical parent recorder is recording',await p.evaluate(()=>WizAppCapture.getState().phase==='recording'));
  ok('no Starting after recorder acknowledgement',!/Starting/.test(await f.locator('.u-recording').innerText()));
  const id=await p.evaluate(()=>WizAppCapture.getState().id);
  for(const skin of ['nebula','grove']){
   await p.evaluate(s=>{WosSkin.set(s);WizAppearance.sync();},skin);
   await p.waitForTimeout(700); ok('Appearance v1 '+skin+' acknowledged',await p.evaluate(s=>WizAppearance.inspect().some(x=>x.acked)&&WosSkin.current===s,skin)); await p.screenshot({path:path.join(OUT,skin+'-recording.png')});
   ok('live skin '+skin+' retains the same take',await p.evaluate(id=>WizAppCapture.getState().id===id,id));
  }
  await f.getByRole('button',{name:'Discard recording'}).click();await p.waitForFunction(()=>!WizAppCapture.getState().active);
  ok('zero owner/backend writes',writes.length===0,writes);ok('no external requests',receipt.blockedExternal.length===0,receipt.blockedExternal);ok('no page errors',errors.length===0,errors);
  await ctx.close();
 }finally{await b.close();server.close();fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify(receipt,null,2));}
})().catch(e=>{receipt.error=String(e.stack);fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify(receipt,null,2));console.error(e);server.close();process.exitCode=1;});
