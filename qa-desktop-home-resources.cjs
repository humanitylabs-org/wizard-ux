// Desktop/mobile Home parity. Run on Thales; real reads, every external write fenced.
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'/home/telos/node_modules/playwright');
const fs=require('fs'),path=require('path'),os=require('os');
if(!os.hostname().toLowerCase().includes('thales')||!process.env.QA_OUT?.startsWith('/Volumes/ThalesMedia/'))throw Error('Run browser QA on ThalesMedia');
const BASE=process.argv[2],OUT=process.env.QA_OUT;fs.mkdirSync(OUT,{recursive:true});
const checks=[],errors=[],writes=[],reads=[];let browser;
function ok(pass,name,detail){checks.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));}
const nap=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(phone=false){const ctx=await browser.newContext({viewport:phone?{width:412,height:892}:{width:1440,height:900},hasTouch:phone,isMobile:phone,userAgent:phone?'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36'});
 await ctx.route('**/*',r=>{const q=r.request();if(!['GET','HEAD'].includes(q.method())){writes.push(q.url());return r.fulfill({status:403,body:'{}'});}if(/\/api\/system\/(load|devices)|\/wizard\/ai-usage/.test(q.url()))reads.push(q.url());return r.continue();});
 await ctx.addInitScript(()=>{localStorage.setItem('wos.coached','true');});
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));await p.goto(BASE);await p.waitForFunction(m=>m?window.__wos?.live?.ok:window.__wux?.live?.ok,phone,{timeout:60000});return{ctx,p};}
async function center(p,label){const d=await p.evaluate(()=>{const b=document.querySelector('#logo').getBoundingClientRect(),i=document.querySelector('#logo .desktop-home-icon').getBoundingClientRect();return{dx:i.x+i.width/2-b.x-b.width/2,dy:i.y+i.height/2-b.y-b.height/2}});ok(Math.abs(d.dx)<0.6&&Math.abs(d.dy)<0.6,label,d);}
async function shot(p,name){await p.screenshot({path:path.join(OUT,name+'.png')});}
(async()=>{browser=await chromium.launch({executablePath:process.env.QA_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const {ctx,p}=await setup();await p.click('#logo');await center(p,'selected Home icon centered in its highlight');
 ok(await p.locator('#desktopHome [data-home-resources]').count()===1,'desktop Home includes shared Resources');
 await p.click('#wsList [data-ws="0"]');await p.keyboard.press('Alt+Digit0');
 ok(await p.evaluate(()=>__wux.homeOpen),'Alt/Option-0 opens Home');
 if(process.env.QA_BASELINE==='1'){await shot(p,'baseline');return;}
 await p.waitForFunction(()=>document.querySelectorAll('#desktopHome .rs-meter [role="meter"]').length===3&&document.querySelector('#desktopHome .rs-account'),{},{timeout:30000});
 ok(await p.locator('#desktopHome .rs-zone').count()===2,'Server and AI Home widgets present');
 ok(await p.locator('#desktopHome .rs-meter [role="meter"]').count()===3,'live CPU memory disk readings rendered');
 ok(await p.locator('#desktopHome .rs-account').count()>0,'real AI account readings rendered');
 ok(await p.locator('#desktopHome [data-app="agents"]').count()===1&&await p.locator('#desktopHome [data-app="system"]').count()===1&&await p.locator('#desktopHome [data-home-settings]').count()===1,'Agents System and Settings available on Home');
 await shot(p,'desktop-home');
 await p.click('#desktopHome [data-res-open="server"]');await p.waitForFunction(()=>WosResources.state.panel);
 ok(await p.locator('.rs-sheet [data-res-tab="server"]').innerText()==='Devices','Resources opens Devices tab');
 await p.waitForFunction(()=>document.querySelectorAll('.rs-device').length>1,{timeout:30000});
 ok(await p.locator('.rs-device').count()>1,'real monitored devices available on desktop');
 const box=await p.locator('.rs-sheet').boundingBox();ok(box.x>=0&&box.y>=0&&box.x+box.width<=1440&&box.y+box.height<=900,'Resources dialog fits desktop',box);
 await shot(p,'desktop-devices');
 await p.click('[data-res-tab="ai"]');await p.locator('.rs-sheet .us-row').first().waitFor();ok(await p.locator('.rs-sheet .us-row').count()>0,'AI accounts tab uses shared usage details');await shot(p,'desktop-ai');
 await p.keyboard.press('Escape');ok(await p.locator('.rs-sheet').count()===0&&await p.evaluate(()=>__wux.homeOpen),'Escape closes Resources and stays Home');
 ok(await p.evaluate(()=>document.activeElement.matches('[data-res-open="server"]')),'Resources returns focus to opener');
 // Draft + parked app retain identity across Home and its dialogs.
 await p.click('#wsList [data-ws="0"]');await p.evaluate(()=>__wux.newChat());
 const wid=await p.evaluate(()=>__wux.ws[__wux.cur].focus),ta=p.locator(`.win[data-win="${wid}"] textarea`);await ta.fill('QA retained parity draft — never send');
 await p.evaluate(()=>{window.__savedWin=document.querySelector('.win.focus');});
 await ta.focus();await p.keyboard.press('Alt+Digit0');ok(await p.evaluate(()=>__wux.homeOpen),'Home chord works from composer');
 await p.click('#desktopHome [data-res-open="ai"]');await p.keyboard.press('Tab');await p.keyboard.press('Shift+Tab');
 ok(await p.evaluate(()=>!!document.activeElement.closest('.rs-sheet')),'Resources keyboard focus remains in dialog');
 await p.evaluate(()=>history.back());await nap(250);ok(await p.locator('.rs-sheet').count()===0&&await p.evaluate(()=>__wux.homeOpen),'browser Back closes Resources and stays inside Wizard');
 await p.click('#wsList [data-ws="0"]');
 ok(await ta.inputValue()==='QA retained parity draft — never send'&&await p.evaluate(()=>document.querySelector('.win.focus')===__savedWin),'Home Resources preserve composer and window node');
 await center(p,'unselected Home icon centered in its frame');
 await nap(250);ok(await p.evaluate(()=>!WosResources.state.timer&&!WosResources.state.busy),'resource polling stops away from Home');
 await p.click('#searchBtn');await p.fill('#palInput','Home');ok(await p.locator('#palList').innerText().then(x=>x.includes('⌥0')),'palette documents Home shortcut');await p.keyboard.press('Alt+Digit0');
 ok(await p.evaluate(()=>__wux.homeOpen&&document.querySelector('#palette').hidden),'Home chord works with palette open');
 await p.keyboard.press('Alt+Slash');ok((await p.locator('#keysBody').innerText()).includes('Home')&&(await p.locator('#keysBody').innerText()).includes('⌥0'),'keyboard help documents Home chord');await p.keyboard.press('Escape');
 await p.click('#desktopHome [data-home-settings]');ok(await p.locator('#dsettings').isVisible(),'Home Settings opens existing desktop settings');await p.keyboard.press('Escape');
 await p.click('#desktopHome [data-res-open="server"]');await p.click('#wsList [data-ws="0"]');ok(await p.locator('.rs-sheet').count()===0,'switching desktop closes Resources dialog');
 await p.keyboard.press('Alt+Digit0');await p.setViewportSize({width:1024,height:650});await nap(250);await center(p,'Home highlight stays centered at smaller desktop');
 await p.click('#desktopHome [data-res-open="ai"]');const sm=await p.locator('.rs-sheet').boundingBox();ok(sm.x>=0&&sm.y>=0&&sm.x+sm.width<=1024&&sm.y+sm.height<=650,'Resources fits small desktop',sm);await shot(p,'desktop-small-ai');await p.keyboard.press('Escape');
 // Isolated resource lifecycle churn: existing general desktop soak has a baseline-matched node leak.
 const cdp=await ctx.newCDPSession(p);await cdp.send('Performance.enable');
 async function metrics(){await cdp.send('HeapProfiler.collectGarbage');return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));}
 async function cycle(){await p.click('#desktopHome [data-res-open="server"]');await p.locator('.rs-device').first().waitFor();await p.click('[data-res-tab="ai"]');await p.locator('.rs-sheet .us-row').first().waitFor();await p.keyboard.press('Escape');}
 await cycle();await cycle();const before=await metrics();for(let i=0;i<8;i++)await cycle();const after=await metrics();
 ok(after.Nodes-before.Nodes<500&&after.JSEventListeners-before.JSEventListeners<20,'resource open/tab/close churn stays bounded',{nodes:after.Nodes-before.Nodes,listeners:after.JSEventListeners-before.JSEventListeners});
 // Local outbox fixture: no records stored and no sends admitted.
 await p.evaluate(()=>{window.__savedUnsent=__wux.outbox.unsent;__wux.outbox.unsent=()=>[{id:'qa-only-not-stored',state:'failed',text:'QA failed message',createdAt:Date.now()}];__wux.goHome();});
 ok((await p.locator('#desktopHome [data-home-unsent]').innerText()).includes('1 not sent'),'unsent Home notice uses local failed outbox state (fixture)');
 await p.click('#desktopHome [data-home-unsent]');ok(await p.locator('#inbox').isVisible(),'unsent notice opens existing retry inbox');await p.keyboard.press('Escape');
 await p.evaluate(()=>{__wux.outbox.unsent=window.__savedUnsent;delete window.__savedUnsent;__wux.goHome();});
 ok(await p.locator('#desktopHome [data-home-unsent]').count()===0,'unsent notice disappears when local outbox is clear');
 await ctx.close();
 const mob=await setup(true);const m=mob.p;await m.evaluate(()=>__wos.goDesk(0,true));await m.waitForFunction(()=>WosResources.state.server&&WosResources.state.ai,{timeout:30000});
 ok(await m.evaluate(()=>document.documentElement.dataset.shell==='phone')&&await m.locator('#logo').count()===0,'phone keeps phone shell');
 await m.click('[data-res-open="server"]');await m.waitForFunction(()=>WosResources.state.panel);ok(await m.locator('.device > .rs-sheet').count()===1,'phone Resources still mounts in device');await m.click('[data-res-tab="ai"]');await m.locator('.rs-sheet .us-row').first().waitFor();ok(await m.locator('.rs-sheet .us-row').count()>0,'phone AI details still render');await shot(m,'phone-ai');await m.keyboard.press('Escape');ok(await m.locator('.rs-sheet').count()===0,'phone Escape returns Home');await mob.ctx.close();
 ok(errors.length===0,'zero page errors',errors);ok(reads.some(x=>x.includes('/api/system/devices'))&&reads.some(x=>x.includes('/wizard/ai-usage')),'real resources read endpoints exercised');
})().catch(e=>{ok(false,'uncaught QA failure',String(e.stack||e));}).finally(async()=>{await browser?.close();const result={pass:checks.filter(x=>x.pass).length,fail:checks.filter(x=>!x.pass).length,checks,errors,blockedWrites:writes,resourceReads:reads};fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(result,null,2));console.log('RESULT',result.pass,result.fail);process.exitCode=result.fail?1:0;});
