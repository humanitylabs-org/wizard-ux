'use strict';
// Bounded, private-data-free in-shell Notes identity/hover canary.
// Run via the admitted forum light lane; dynamic APIs never reach the owner box.
const { chromium } = require('../tools/qa-playwright.cjs');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { assertReadOnlyFixture } = require('./notes-fixture-write-policy.cjs');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.QA_OUT || path.join(ROOT, 'qa', 'notes-sigil');
const FIXTURE = process.env.QA_FIXTURE || path.join(ROOT, '..', 'fixture');
const BASELINE = process.env.NOTES_BASELINE;
fs.mkdirSync(OUT, { recursive: true });
const mime = { '.js':'application/javascript', '.mjs':'application/javascript', '.css':'text/css', '.html':'text/html', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.woff2':'font/woff2', '.json':'application/json' };
const apps = [
 { id:'notes', name:'Notes', url:'/notes/', view:{ mode:'original', url:'/notes/' }, source:'apps.json', state:'running', type:'service', category:'app' },
 { id:'calendar', name:'Calendar', url:'/calendar/', source:'apps.json', state:'running', type:'view', category:'app' },
];
let version = 'candidate';
const requests = [];
const server = http.createServer((req,res) => {
 const p = new URL(req.url, 'http://localhost').pathname;
 const request = { method:req.method, path:p };
 requests.push(request);
 function send(data, type='application/json', status=200) { res.writeHead(status, {'content-type':type, 'cache-control':'no-store'}); res.end(type === 'application/json' ? JSON.stringify(data) : data); }
 if (req.method !== 'GET') {
  request.status = 405; request.refusedBeforeHandlers = true;
  return send({ error:'fixture refuses writes' }, 'application/json', 405);
 }
 if (p === '/wizard/v1/bootstrap') return send({bootstrap:1,settings:{agent:{name:'Wizard QA'}},capabilities:{},endpoints:{apps:'/wizard/v1/apps'}});
 if (p === '/wizard/v1/apps') return send({ apps });
 if (p.endsWith('/wizard/v1/app-logos')) return send({logos:{notes:'0123456789abcdef'}});
 if (p.includes('/store-data/app-logo/notes')) return send(fs.readFileSync(path.join(FIXTURE,'notes-live-logo.jpg')), 'image/jpeg');
 if (p === '/notes/api/tree') return send({children:[]});
 if (p.includes('/api/') || p.includes('/wizard/v1/') || p.startsWith('/wizard/hermes/') || p.includes('/store-data/') || p === '/launcher.json') {
  if (p.endsWith('/model/options')) return send({provider:'qa', providers:[{slug:'qa',authenticated:true}]});
  if (p.endsWith('/setup')) return send({first_run:false,seen:true});
  if (p.endsWith('/config')) return send({settings:{agent:{name:'Wizard QA'}}});
  if (/\/agents\/?$/.test(p)) return send({agents:[]});
  if (/sessions|threads/.test(p)) return send({sessions:[],threads:[],has_more:false});
  return send({apps:[],agents:[],items:[],entries:[],children:[],sessions:[],settings:{},ok:true});
 }
 let f;
 if (p.startsWith('/wizard-os-home/')) f = path.join(ROOT,'web',p.slice('/wizard-os-home/'.length) || 'index.html');
 else if (p.startsWith('/notes/')) f = path.join(FIXTURE,'notes-web',p.slice('/notes/'.length) || 'index.html');
 else return send({},'application/json',404);
 if (!f.startsWith(ROOT + path.sep) && !f.startsWith(FIXTURE + path.sep)) return send({},'application/json',403);
 if (version === 'baseline' && p === '/wizard-os-home/core/sigils.js') f = BASELINE;
 try { if (fs.statSync(f).isDirectory()) f = path.join(f,'index.html'); send(fs.readFileSync(f),mime[path.extname(f)] || 'application/octet-stream'); }
 catch { send({},'application/json',404); }
});
function style(el) {
 const s=getComputedStyle(el),g=el.querySelector('.sgi,.sglogo'),q=g&&getComputedStyle(g);
 return {class:el.className,child:g?.className,bg:s.backgroundColor,image:s.backgroundImage,border:s.borderColor,shadow:s.boxShadow,outline:s.outline,mask:q?.maskImage,glyphBackground:q?.backgroundImage,logo:q?.getPropertyValue('--logo')};
}
async function settle(page,selector) {
 await page.locator(selector).first().waitFor({state:'visible'});
 await page.evaluate(async sel => {
  const el=document.querySelector(sel); if (!el) throw Error('missing '+sel);
  document.body.getBoundingClientRect(); await document.fonts.ready;
  const end=performance.now()+4500; let last='',stable=0,reason='surface did not settle';
  while(performance.now()<end){
   await new Promise(requestAnimationFrame);
   const r=el.getBoundingClientRect();
   const s=getComputedStyle(el); let running=false,hidden=false;
   for(let a=el;a;a=a.parentElement){ const c=getComputedStyle(a); hidden ||= +c.opacity<.99 || c.visibility==='hidden' || c.filter.includes('blur('); running ||= a.getAnimations().some(v=>v.playState==='running'&&v.effect.getTiming().iterations!==Infinity); }
   const mark=JSON.stringify([r.x,r.y,r.width,r.height,s.transform]);
   stable=mark===last&&!running&&!hidden?stable+1:0;last=mark;
   if(stable>=5){ const x=r.x+r.width/2,y=r.y+r.height/2; if(r.width<8||r.height<8||x<0||y<0||x>innerWidth||y>innerHeight){reason='clipped target';continue;} const hit=document.elementFromPoint(x,y);if(!el.contains(hit)){reason='covered target '+hit?.outerHTML.slice(0,150);continue;}return; }
  }
  throw Error(reason);
 },selector);
}
async function shot(page,name,sel) { await settle(page,sel); await page.screenshot({path:path.join(OUT,name+'.png')}); }
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const report={apps, cases:[], pageErrors:[],writes:[],failures:[]};
 try {
 for(const v of (BASELINE?['candidate','baseline']:['candidate'])) {
  version=v;
  for(const shell of ['phone','desktop']) {
   const context=await browser.newContext({viewport:shell==='phone'?{width:390,height:844}:{width:1440,height:1000},hasTouch:shell==='phone',isMobile:shell==='phone',deviceScaleFactor:1,serviceWorkers:'block'});
   try {
   // Allow ONLY this synthetic local origin: no leaked provider/private-agent traffic.
   await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
   await context.addInitScript(({shell})=>{
    localStorage.setItem('wux.shell',shell); localStorage.setItem('wos.skin','obsidian');
    localStorage.setItem('wos.welcome.v1','done'); localStorage.setItem('wos.onboarded','1');
    localStorage.setItem('wux.applogos.v1',JSON.stringify({notes:'/wizard-os-home/store-data/app-logo/notes?v=0123456789abcdef'}));
   },{shell});
   const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.pageErrors.push({v,shell,message:e.message}));
   // The real shell polls independently of readiness. Network-idle is not a boot contract.
   // Navigate straight to the requested entrypoint; shell.js otherwise stops and redirects.
   await page.goto(origin+'/wizard-os-home/'+(shell==='desktop'?'desktop.html':'')+'?shell='+shell,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(shell=>document.documentElement.dataset.shell===shell &&
    (shell==='phone'?window.__wos?.openSheet:window.__wux?.openPicker) &&
    window.WizConfig?.live && window.WizCore?.apps?.(shell==='phone'?'mobile':'desktop').APP?.notes &&
    window.WizSigil && window.WosSkin,shell);
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.shell),shell);
   let row,ic,calendar;
   if(shell==='phone') {
    await page.evaluate(()=>window.__wos.openSheet('launcher')); row='#launcher.open [data-app="notes"]';ic=row+' .ic';calendar='#launcher.open [data-app="calendar"]';
   } else {
    await page.keyboard.press('Alt+o');
    await page.locator('#palette:not([hidden])').waitFor({state:'visible'});
    // Read the actual production id: settle() also uses native querySelector.
    const target=page.locator('#palette:not([hidden]) .pal-app').filter({has:page.locator('.nm',{hasText:/^Notes$/})});
    await target.waitFor({state:'visible'});
    const id=await target.getAttribute('id');assert.match(id,/^pal-o\d+$/,'native picker id');
    row='#palette:not([hidden]) #'+id;ic=row+' .ic';
    calendar=page.locator('#palette:not([hidden]) .pal-app').filter({has:page.locator('.nm',{hasText:/^Calendar$/})});
   }
   for(const skin of ['obsidian','obsidian-light']) {
    await page.evaluate(s=>window.WosSkin.set(s),skin);
    await page.waitForFunction(s=>document.documentElement.dataset.skin===s,skin);
    await page.waitForFunction(()=>!document.querySelector('.mz-intro'));
    await settle(page,ic);await (typeof calendar==='string'?page.locator(calendar):calendar).hover();await settle(page,ic);
    const before=await page.locator(ic).evaluate(style);
    await page.locator(row).hover();await settle(page,ic);const hovered=await page.locator(ic).evaluate(style);
    const name=[v,shell,skin,'hover'].join('-');await shot(page,name,ic);
    const isMask=/\bsg-notes\b/.test(hovered.child||'') && !/sglogo/.test(hovered.child||'');
    report.cases.push({v,shell,skin,surface:'picker',before,hovered,isMask,screenshot:name+'.png'});
    if(v==='baseline') {
     assert.equal(isMask,false,'baseline must reach the known opaque-logo regression');
     assert.match(hovered.child||'',/\bsglogo\b/,'baseline is the actual legacy logo, not a missing glyph');
     assert.match(hovered.logo||'',/notes\?v=0123456789abcdef/,'baseline uses the pinned opaque Notes JPEG fixture');
    }
    else {
     assert.equal(isMask,true,'Notes uses shared approved mask');assert.ok(hovered.mask&&hovered.mask!=='none');assert.equal(hovered.logo,'');
     if(shell==='desktop') {
      assert.equal(await page.locator(row).evaluate(e=>e.classList.contains('sel')),true,'real hover selects the standard app tile');
      assert.match(hovered.shadow,/^rgba\(225, 214, 255, 0\.8\) 0px 0px 0px 2px,/,'shared white selection outline stays outside the mask, not a black picture');
     }
    }
   }
   // Open the real Notes app with an empty synthetic vault; never inspect owner notes.
   await page.locator(row).click();
   const frameSelector='iframe[title="Notes"]';
   await page.waitForSelector(frameSelector);
   await page.waitForFunction(()=>[...document.querySelectorAll('iframe[title="Notes"]')].some(f=>f.contentDocument?.querySelector('#tree')));
   const frames=page.frames().filter(f=>f.url().startsWith(origin+'/notes/'));assert.ok(frames.length,'real Notes view loaded');
   const frame=frames.at(-1);await frame.waitForSelector('#tree');
   await frame.evaluate(()=>window.__qaDocument=document);
   const appearances=[];
   for(const skin of ['obsidian','obsidian-light']) {
    await page.evaluate(s=>window.WosSkin.set(s),skin);
    await frame.waitForFunction(s=>document.documentElement.dataset.skin===s,skin);
    assert.equal(await frame.evaluate(()=>window.__qaDocument===document),true,'live skin change preserves the Notes document');
    appearances.push(await frame.evaluate(()=>({skin:document.documentElement.dataset.skin,scheme:document.documentElement.dataset.colorScheme,base:getComputedStyle(document.documentElement).getPropertyValue('--wz-base')})));
    await page.waitForFunction(()=>!document.querySelector('.mz-intro'));
    await shot(page,[v,shell,'notes-view',skin].join('-'),frameSelector);
   }
   assert.deepEqual(appearances.map(a=>a.scheme),['dark','light']);
   report.cases.push({v,shell,surface:'notes-view',iframe:frame.url(),appearances,screenshots:['obsidian','obsidian-light'].map(s=>[v,shell,'notes-view',s].join('-')+'.png')});
   }catch(e){
    report.failures.push({v,shell,message:e.message,stack:e.stack});
    for(const p of context.pages())await p.screenshot({path:path.join(OUT,`REJECTED-${v}-${shell}.png`)}).catch(()=>{});
   }finally{
    fs.writeFileSync(path.join(OUT,'progress.json'),JSON.stringify(report,null,2));
    await context.close();
   }
  }
 }
 // Standalone dark fallback is the actual Notes document with an empty synthetic vault.
 version='candidate';const standalone=await browser.newPage({viewport:{width:390,height:844}});
 await standalone.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 await standalone.goto(origin+'/notes/',{waitUntil:'domcontentloaded'});await standalone.waitForSelector('#tree');
 await standalone.screenshot({path:path.join(OUT,'standalone-dark.png')});
 report.standalone=await standalone.evaluate(()=>({scheme:document.documentElement.dataset.colorScheme,base:getComputedStyle(document.documentElement).getPropertyValue('--wz-base'),body:getComputedStyle(document.body).backgroundColor}));
 report.writes=requests.filter(r=>r.method!=='GET');
 report.writePolicy=assertReadOnlyFixture(requests);
 fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
 assert.equal(report.failures.length,0,JSON.stringify(report.failures));
 assert.equal(report.cases.length,BASELINE?12:6,'complete picker + Notes view matrix');
 assert.equal(report.standalone.scheme,'dark','standalone Notes stays dark');
 assert.equal(report.pageErrors.length,0,'no browser page errors');
 console.log('Notes identity canary PASS',JSON.stringify({cases:report.cases.length,out:OUT,pageErrors:report.pageErrors}));
 }catch(e){fs.writeFileSync(path.join(OUT,'failure.json'),JSON.stringify({message:e.message,stack:e.stack,report,requests},null,2));for(const p of browser.contexts().flatMap(c=>c.pages()))await p.screenshot({path:path.join(OUT,'REJECTED-'+Date.now()+'.png')}).catch(()=>{});throw e;}
 finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
