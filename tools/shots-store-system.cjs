// Screenshot pass for design review: phone + desktop, Store and System, entered the way James enters them.
const {chromium}=require(process.env.PW);const fs=require('fs');
const B='https://store-window.staging.wizard001.com/wizard-os-home/',OUT=process.env.QA_OUT||'shots';fs.mkdirSync(OUT,{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const b=await chromium.launch();const errs=[],unsafe=[];
 const ctx=async m=>{const c=await b.newContext(m?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}:{viewport:{width:1440,height:900}});
  await c.route('**/*',r=>{const q=r.request();if(!['GET','HEAD'].includes(q.method())){unsafe.push(q.method()+' '+q.url());return r.fulfill({status:403,body:'{}'});}return r.continue();});
  await c.addInitScript(()=>{try{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.done','1');}catch(_){}});return c;};
 // standalone pages at phone size (pure design)
 let c=await ctx(true),p=await c.newPage();p.on('pageerror',e=>errs.push('store:'+e));
 await p.goto(B+'store/index.html');await p.waitForSelector('.feat:not(.skel)',{timeout:20000});await wait(1500);await p.screenshot({path:OUT+'/m-store-top.png'});
 await p.screenshot({path:OUT+'/m-store-full.png',fullPage:true});
 await p.click('.kind.k-agent-apps');await wait(600);await p.screenshot({path:OUT+'/m-store-list.png'});
 await p.click('.row[data-app="defleur-video"]');await wait(1200);await p.screenshot({path:OUT+'/m-store-detail.png',fullPage:true});
 await p.evaluate(()=>window.__wizardCloseOverlay());await p.evaluate(()=>window.__wizardCloseOverlay());await wait(300);
 await p.fill('#q','transcri');await wait(500);await p.screenshot({path:OUT+'/m-store-search.png'});
 console.log('store state',JSON.stringify(await p.evaluate(()=>__store.state())));
 p=await c.newPage();p.on('pageerror',e=>errs.push('system:'+e));await p.goto(B+'system/index.html');await p.waitForFunction(()=>window.__system?.state().loaded,null,{timeout:20000});await wait(800);
 await p.screenshot({path:OUT+'/m-system-top.png'});await p.screenshot({path:OUT+'/m-system-full.png',fullPage:true});
 await p.click('.node[data-node^="c:firecrawl"]').catch(()=>{});await wait(400);await p.screenshot({path:OUT+'/m-system-focus.png'});
 console.log('system state',JSON.stringify(await p.evaluate(()=>__system.state())));
 // in the shell: Home → Your system, launcher → Get apps
 p=await c.newPage();p.on('pageerror',e=>errs.push('shell:'+String(e).slice(0,160)));await p.goto(B+'?shell=phone');await wait(3500);await p.evaluate(()=>__wos.goDesk(0,true));await wait(600);await p.screenshot({path:OUT+'/m-home.png'});
 await p.click('[data-act="system"]');await wait(2500);await p.screenshot({path:OUT+'/m-shell-system.png'});
 await p.evaluate(()=>__wos.openSheet('launcher'));await wait(700);await p.screenshot({path:OUT+'/m-launcher.png'});
 await p.click('#launcherBody [data-app="app-store"]');await wait(3000);await p.screenshot({path:OUT+'/m-shell-store.png'});
 await c.close();
 c=await ctx(false);p=await c.newPage();p.on('pageerror',e=>errs.push('desk:'+String(e).slice(0,160)));
 await p.goto(B+'store/index.html');await p.waitForSelector('.feat:not(.skel)');await wait(1500);await p.screenshot({path:OUT+'/d-store.png'});
 await p.click('.feat[data-app]');await wait(1000);await p.screenshot({path:OUT+'/d-store-detail.png'});
 await p.goto(B+'system/index.html');await p.waitForFunction(()=>window.__system?.state().loaded);await wait(800);await p.screenshot({path:OUT+'/d-system.png',fullPage:true});
 await p.goto(B+'desktop.html?view=store');await wait(4000);await p.screenshot({path:OUT+'/d-shell-store.png'});
 await c.close();await b.close();console.log('errors',JSON.stringify(errs));console.log('unsafe',JSON.stringify(unsafe));})().catch(e=>{console.error(e);process.exit(1);});
