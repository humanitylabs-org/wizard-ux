// Run on Thales. Read-only live origin; all mutations intercepted locally.
const {chromium}=require('./tools/qa-playwright.cjs');
const fs=require('fs'),path=require('path');
const OUT=process.env.QA_OUT||require('./tools/qa-paths.cjs').workPath('wizard/phone-shell-scroll'), WEB=process.env.QA_WEB_DIR;
(async()=>{
 fs.mkdirSync(OUT,{recursive:true}); const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const ctx=await b.newContext({viewport:{width:412,height:842},hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36 WizardOS-Android/0.9.10',serviceWorkers:'block'});
 const writes=[],errors=[],checks=[];
 await ctx.route('**/*',async r=>{const q=r.request(),u=new URL(q.url()); if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({status:403,body:'read-only QA'});} if(WEB&&u.pathname.startsWith('/wizard-os-home/')){const f=path.join(WEB,u.pathname.slice('/wizard-os-home/'.length)||'index.html');if(fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({status:200,body:fs.readFileSync(f),contentType:f.endsWith('.css')?'text/css':f.endsWith('.js')?'application/javascript':f.endsWith('.html')?'text/html':undefined});} return r.continue();});
 await ctx.addInitScript(()=>{localStorage.setItem('wos.coached','true');window.WizardOSNative={insetTop:()=>24,cutoutTop:()=>24};});
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
 const ok=(yes,name,evidence)=>{checks.push({name,pass:!!yes,evidence});console.log(yes?'PASS':'FAIL',name,JSON.stringify(evidence||{}));};
 async function geometry(name){const g=await p.evaluate(()=>{const d=document.querySelector('#device'),r=d.getBoundingClientRect(),k=document.querySelector('#dock').getBoundingClientRect();return {deviceTop:r.top,deviceBottom:r.bottom,dockBottom:k.bottom,viewport:innerHeight,deviceScroll:d.scrollTop,bodyScroll:document.scrollingElement.scrollTop,searchTop:document.querySelector('[data-chsearch]')?.getBoundingClientRect().top};});ok(Math.abs(g.deviceTop)<1&&Math.abs(g.dockBottom-g.viewport)<1&&g.deviceScroll===0&&g.bodyScroll===0,name,g);return g;}
 await p.goto((require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/?open=chats'));await p.waitForFunction(()=>window.__wos?.live?.ok);await p.waitForTimeout(1400);await geometry('initial shell fills viewport');
 await p.evaluate(()=>WizCore.deeplink.route('/wizard-os-home/?view=chats&section=ready'));await p.waitForTimeout(1000);await geometry('Ready section navigation keeps shell anchored');await p.screenshot({path:OUT+'/ready.png'});
 await p.evaluate(()=>{const sec=document.querySelector('[data-sec="ready"]');sec?.scrollIntoView({block:'start'});});await p.waitForTimeout(300);await geometry('nested scrollIntoView cannot move shell');await p.screenshot({path:OUT+'/nested-scroll.png'});
 await p.evaluate(()=>{const s=document.querySelector('[data-chsearch]');s?.focus();s?.blur();});await p.setViewportSize({width:412,height:510});await p.waitForTimeout(200);await geometry('keyboard-sized viewport fills shell');await p.setViewportSize({width:412,height:842});await p.waitForTimeout(200);await geometry('keyboard dismissal restores dock');
 await p.evaluate(()=>{const rows=[...document.querySelectorAll('[data-chopen]')];rows.find(r=>r.getBoundingClientRect().height)?.click();});await p.waitForTimeout(1200);await p.evaluate(()=>__wos.onBack());await p.waitForTimeout(500);ok(await p.locator('.ch-list').count()>0&&p.url().includes('/wizard-os-home/'),'thread Back retains Wizard and returns to list');await geometry('Back keeps shell anchored');
 ok(errors.length===0,'no JavaScript errors',errors);fs.writeFileSync(OUT+'/result.json',JSON.stringify({checks,writesIntercepted:writes,errors},null,2));await b.close();process.exit(checks.every(c=>c.pass)?0:1);
})().catch(e=>{console.error(e);process.exit(1)});
