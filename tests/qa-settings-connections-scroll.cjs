'use strict';
// Settings › Connections has one scroll area (issue 1242). Real phone and desktop shells on a synthetic origin, no
// owner reads or writes. The App Manager's view is stood in by a page laid out like its ?embed=settings mode (a
// full-height sheet whose body scrolls a long list). Asserts: the Settings page itself never scrolls, the frame
// scrolls its own list, and the page's Wizards › Add a Wizard row is in view without scrolling anything.
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../web'),origin='https://connections.test',prefix='/wizard-os-home/';
const out=process.env.QA_OUT||'';if(out)fs.mkdirSync(out,{recursive:true});
const rows=Array.from({length:40},(_,i)=>`<div class="row">Linked app ${i+1}</div>`).join('');
const EMBED=`<!doctype html><html lang="en" data-embed="settings"><head><style>
html,body{margin:0;background:transparent}.wux-sheet{display:flex;flex-direction:column;height:100dvh}
.wux-body{flex:1;min-height:0;overflow-y:auto}.row{height:56px;border-bottom:1px solid #8884}</style></head>
<body class="wux"><div class="wux-sheet"><div class="wux-body" id="list">${rows}<div id="last">See map</div></div></div></body></html>`;
const type=f=>f.endsWith('.js')||f.endsWith('.mjs')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':f.endsWith('.json')?'application/json':'application/octet-stream';
(async()=>{
 const browser=await chromium.launch({headless:true});const results=[];
 try{
  for(const v of [{shell:'phone',w:390,h:844},{shell:'phone',w:360,h:640},{shell:'desktop',w:1280,h:800}]){
   const phone=v.shell==='phone';
   const ctx=await browser.newContext({viewport:{width:v.w,height:v.h},isMobile:phone,hasTouch:phone,serviceWorkers:'block'});
   await ctx.routeWebSocket('**/*',ws=>ws.close());
   await ctx.addInitScript(shell=>{if(window!==window.top)return;for(const[k,val]of Object.entries({'wos.shell':shell,'wos.coached':'true','wos.tour.v1':'true','wos.welcome.v1':'done','wos.desktop-view.v1':'classic'}))localStorage.setItem(k,val);},v.shell);
   const errors=[],writes=[];
   await ctx.route('**/*',async r=>{
    const q=r.request(),u=new URL(q.url()),p=u.pathname;
    if(u.origin!==origin)return r.abort();
    if(!['GET','HEAD'].includes(q.method())){writes.push(q.method()+' '+p);return r.fulfill({status:405,json:{error:'refused by test'}});}
    if(p===prefix+'store-install/_connections/')return r.fulfill({contentType:'text/html',body:EMBED});
    if(p.startsWith(prefix)){const f=path.resolve(root,p.slice(prefix.length)||'index.html');if(f.startsWith(root+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({contentType:type(f),body:fs.readFileSync(f)});}
    if(p==='/wizard/v1/ui-preferences')return r.fulfill({json:{launcher:{},migrations:{'launcher-seed-v1':true}}});
    if(p.endsWith('/v1/apps'))return r.fulfill({json:{apps:[]}});
    return r.fulfill({json:{sessions:[],agents:[],apps:[],connected:false}});
   });
   const pg=await ctx.newPage();pg.on('pageerror',e=>errors.push(e.message));
   await pg.goto(origin+prefix+(phone?'':'desktop.html'));
   await pg.waitForFunction(()=>window.WosSettings&&(window.__wos||window.__wux));
   await pg.evaluate(()=>document.getElementById('wosWelcome')?.remove());
   // The tab shows once the listener answers; then open the page the way a deep link does.
   await pg.waitForFunction(()=>{const o=window.__wos?.openSettings||window.__wux?.openSettings;o('connections');return !!document.querySelector('[data-st-connections] iframe');},null,{timeout:15000});
   const frame=pg.frameLocator('[data-st-connections] iframe');await frame.locator('#last').waitFor({state:'attached'});
   await pg.waitForTimeout(400);
   const m=await pg.evaluate(()=>{
    const f=document.querySelector('[data-st-connections] iframe'),add=document.querySelector('[data-workspaces-add]');
    const rootEl=f.closest('.st-root'),page=f.closest('.st-page'),fr=f.getBoundingClientRect(),ar=add?.getBoundingClientRect();
    const scrolls=[rootEl,page].filter(Boolean).filter(e=>e.scrollHeight>e.clientHeight+1&&/(auto|scroll)/.test(getComputedStyle(e).overflowY)).map(e=>e.className);
    const list=f.contentDocument.getElementById('list');
    return {frame:{top:Math.round(fr.top),bottom:Math.round(fr.bottom),height:Math.round(fr.height)},add:ar&&{top:Math.round(ar.top),bottom:Math.round(ar.bottom)},
     vh:innerHeight,outerScrolls:scrolls,listScrolls:list.scrollHeight>list.clientHeight};
   });
   const label=`${v.shell} ${v.w}x${v.h}`;
   if(out)await pg.screenshot({path:path.join(out,`connections-${v.shell}-${v.w}x${v.h}.png`)});
   assert.ok(m.add,`${label}: Wizards › Add a Wizard is on the page`);
   assert.deepEqual(m.outerScrolls,[],`${label}: the Settings page around the frame does not scroll (one scroll area) ${JSON.stringify(m)}`);
   assert.ok(m.add.bottom<=m.vh&&m.add.top>=0,`${label}: Add a Wizard is in view without scrolling ${JSON.stringify(m)}`);
   assert.ok(m.add.top>=m.frame.bottom-1,`${label}: Add a Wizard sits below the frame ${JSON.stringify(m)}`);
   assert.ok(m.frame.height>=240,`${label}: the frame keeps room for its list ${JSON.stringify(m)}`);
   assert.ok(m.listScrolls,`${label}: the frame scrolls its own list`);
   assert.deepEqual(errors,[],`${label}: page errors`);
   results.push({variant:label,...m,writes});await ctx.close();
  }
  console.log(JSON.stringify({ok:true,results},null,1));
 }catch(e){console.error(JSON.stringify(results,null,1));console.error(e.message);process.exitCode=1;}
 finally{await browser.close();}
})();
