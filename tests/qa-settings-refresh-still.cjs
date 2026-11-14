'use strict';
// Settings stays still on a refresh that changes nothing (issue 1450, from Jan's PR 1281). Several modules call
// WosSettings.refresh() on timers (workspace sync, update checks, downloads...). Each call used to rewrite the whole
// Settings markup: the page blinked and the desktop category list (its own scroller) jumped back to the top.
// Real phone and desktop shells on a synthetic origin, no owner writes. Asserts: five plain refreshes keep the same
// Settings element and the category list's scroll; opening a category still redraws.
// QA_WEB=<main checkout>/web QA_EXPECT=broken proves the bug on main. QA_OUT=<dir> saves screenshots.
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.env.QA_WEB||path.join(__dirname,'../web')),origin='https://settings-still.test',prefix='/wizard-os-home/';
const broken=process.env.QA_EXPECT==='broken',out=process.env.QA_OUT||'';if(out)fs.mkdirSync(out,{recursive:true});
const type=f=>f.endsWith('.js')||f.endsWith('.mjs')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':f.endsWith('.json')?'application/json':'application/octet-stream';
(async()=>{
 const browser=await chromium.launch({headless:true});const results=[];
 try{
  for(const v of [{shell:'desktop',w:1280,h:520},{shell:'phone',w:390,h:844}]){
   const phone=v.shell==='phone';
   const ctx=await browser.newContext({viewport:{width:v.w,height:v.h},isMobile:phone,hasTouch:phone,serviceWorkers:'block'});
   await ctx.routeWebSocket('**/*',ws=>ws.close());
   await ctx.addInitScript(shell=>{if(window!==window.top)return;for(const[k,val]of Object.entries({'wos.shell':shell,'wos.coached':'true','wos.tour.v1':'true','wos.welcome.v1':'done','wos.desktop-view.v1':'classic'}))localStorage.setItem(k,val);},v.shell);
   const errors=[];
   await ctx.route('**/*',async r=>{
    const q=r.request(),u=new URL(q.url()),p=u.pathname;
    if(u.origin!==origin)return r.abort();
    if(!['GET','HEAD'].includes(q.method()))return r.fulfill({status:405,json:{error:'refused by test'}});
    if(p.startsWith(prefix)){const f=path.resolve(root,p.slice(prefix.length)||'index.html');if(f.startsWith(root+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({contentType:type(f),body:fs.readFileSync(f)});}
    if(p==='/wizard/v1/ui-preferences')return r.fulfill({json:{launcher:{},migrations:{'launcher-seed-v1':true}}});
    if(p.endsWith('/v1/setup'))return r.fulfill({json:{first_run:false}});
    if(p.endsWith('/v1/apps'))return r.fulfill({json:{apps:[]}});
    return r.fulfill({json:{sessions:[],agents:[],apps:[],connected:false}});
   });
   const pg=await ctx.newPage();pg.on('pageerror',e=>errors.push(e.message));
   await pg.goto(origin+prefix+(phone?'':'desktop.html'));
   await pg.waitForFunction(()=>window.WosSettings&&(window.__wos||window.__wux));
   await pg.addStyleTag({content:'#wosWelcome{display:none!important}'});
   await pg.waitForFunction(()=>{const o=window.__wos?.openSettings||window.__wux?.openSettings;o();return !!document.querySelector('.st-inner .st-index nav');},null,{timeout:15000});
   await pg.waitForTimeout(800);
   const label=`${v.shell} ${v.w}x${v.h}`;
   const m=await pg.evaluate(async()=>{
    const settle=()=>new Promise(r=>setTimeout(r,60));
    const inner=()=>document.querySelector('.st-inner'),idx=()=>document.querySelector('.st-index');
    // Let timers that were already queued run, so only our refreshes count.
    window.WosSettings.refresh();await settle();
    const i0=idx(),scrolls=i0.scrollHeight>i0.clientHeight+1&&/(auto|scroll)/.test(getComputedStyle(i0).overflowY);
    if(scrolls){i0.scrollTop=Math.min(120,i0.scrollHeight-i0.clientHeight);await settle();}
    const want=idx().scrollTop,el0=inner();let rebuilt=0;
    const mo=new MutationObserver(l=>{for(const r of l)if([...r.removedNodes].includes(el0))rebuilt++;});
    mo.observe(el0.parentNode,{childList:true});
    for(let i=0;i<5;i++){window.WosSettings.refresh();await settle();}
    mo.disconnect();
    window.__stEl0=el0;
    return {scrolls,want,plain:{same:inner()===el0,rebuilt,indexTop:idx().scrollTop}};
   });
   if(out)await pg.screenshot({path:path.join(out,`settings-${v.shell}-after-5-refreshes.png`)});
   m.changed=await pg.evaluate(async()=>{
    const settle=()=>new Promise(r=>setTimeout(r,60));
    // A refresh that does change something still redraws: open a category (its markup differs).
    const cat=[...document.querySelectorAll('.st-index [data-st-page]')].find(b=>b.getAttribute('aria-current')!=='page'&&!b.closest('.st-active'));
    cat?.click();await settle();
    return {redrew:document.querySelector('.st-inner')!==window.__stEl0};
   });
   results.push({variant:label,...m});
   if(broken){assert.ok(!m.plain.same&&m.plain.rebuilt>0,`${label}: main rebuilds Settings on a no-change refresh ${JSON.stringify(m)}`);continue;}
   assert.ok(m.plain.same,`${label}: a no-change refresh keeps the same Settings element ${JSON.stringify(m)}`);
   assert.equal(m.plain.rebuilt,0,`${label}: nothing was rebuilt`);
   if(m.scrolls){assert.ok(m.want>0,`${label}: the category list was scrolled`);assert.equal(m.plain.indexTop,m.want,`${label}: category list kept its place`);}
   assert.ok(m.changed.redrew,`${label}: a real change still redraws`);
   assert.deepEqual(errors,[],`${label}: page errors`);
   await ctx.close();
  }
  console.log(JSON.stringify({ok:true,expect:broken?'broken':'fixed',results},null,1));
 }catch(e){console.error(JSON.stringify(results,null,1));console.error(e.message);process.exitCode=1;}
 finally{await browser.close();}
})();
