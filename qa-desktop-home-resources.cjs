// Desktop/mobile Home parity. Run on Thales; real reads, every external write fenced.
const {chromium}=require('./tools/qa-playwright.cjs');
const fs=require('fs'),path=require('path'),os=require('os');
if(!process.env.WIZARD_WORK_ROOT||!require('./tools/qa-paths.cjs').inWorkRoot(process.env.QA_OUT))throw Error('Run browser QA on ThalesMedia');
const BASE=process.argv[2],OUT=process.env.QA_OUT;fs.mkdirSync(OUT,{recursive:true});
const checks=[],errors=[],writes=[],reads=[];let browser;
function ok(pass,name,detail){checks.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));}
const nap=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(phone=false){const ctx=await browser.newContext({viewport:phone?{width:412,height:892}:{width:1440,height:900},hasTouch:phone,isMobile:phone,userAgent:phone?'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36'});
 await ctx.route('**/*',r=>{const q=r.request();if(!['GET','HEAD'].includes(q.method())){writes.push(q.url());return r.fulfill({status:403,body:'{}'});}if(/\/api\/system\/(load|devices)|\/wizard\/ai-usage/.test(q.url()))reads.push(q.url());
 const u=new URL(q.url());if(process.env.QA_SOURCE&&u.pathname.startsWith('/wizard-os-home/')){const rel=u.pathname.slice('/wizard-os-home/'.length)||'index.html',file=path.resolve(process.env.QA_SOURCE,'web',rel);if(file.startsWith(path.resolve(process.env.QA_SOURCE,'web')+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return r.fulfill({path:file});}return r.continue();});
 await ctx.addInitScript(()=>{localStorage.setItem('wos.coached','true');});
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));await p.goto(BASE);await p.waitForFunction(m=>m?window.__wos?.live?.ok:window.__wux?.live?.ok,phone,{timeout:60000});return{ctx,p};}
async function center(p,label){const d=await p.evaluate(()=>{const b=document.querySelector('#logo').getBoundingClientRect(),i=document.querySelector('#logo .dsg').getBoundingClientRect();return{dx:i.x+i.width/2-b.x-b.width/2,dy:i.y+i.height/2-b.y-b.height/2}});ok(Math.abs(d.dx)<0.6&&Math.abs(d.dy)<0.6,label,d);}
async function shot(p,name){await p.screenshot({path:path.join(OUT,name+'.png')});}
(async()=>{browser=await chromium.launch({executablePath:process.env.QA_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const {ctx,p}=await setup();await p.click('#logo');await center(p,'selected Home icon centered in its highlight');
 ok(await p.locator('#desktopHome [data-home-resources]').count()===1,'desktop Home includes shared Resources');
 await p.click('#wsList [data-ws="0"]');await p.keyboard.press('Alt+Digit1');
 ok(await p.evaluate(()=>__wux.homeOpen),'Alt/Option-1 opens Home');
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
 // Review regressions: a new shell overlay takes ownership from Resources.
 for (const [name,key,selector,action] of [
  ['palette','Meta+KeyK','#palette'],['keyboard help','Alt+Slash','#keys'],['Settings','Alt+Comma','#dsettings'],['Inbox','Alt+KeyI','#inbox'],['AI usage',null,'.usage-ov',()=>__wux.openUsage()],
 ]) {
  await p.click('#desktopHome [data-res-open="server"]');await p.waitForFunction(()=>WosResources.state.panel);
  if(key)await p.keyboard.press(key);else await p.evaluate(action);
  ok(await p.locator('.rs-sheet').count()===0&&await p.locator(selector).isVisible(),`${name} replaces Resources instead of opening beneath it`);
  await p.keyboard.press('Escape');
 }
 // Draft + parked app retain identity across Home and its dialogs.
 await p.click('#wsList [data-ws="0"]');await p.evaluate(()=>__wux.newChat());
 const wid=await p.evaluate(()=>__wux.ws[__wux.cur].focus),ta=p.locator(`.win[data-win="${wid}"] textarea`);await ta.fill('QA retained parity draft — never send');
 await p.evaluate(()=>{window.__savedWin=document.querySelector('.win.focus');});
 await ta.focus();await p.keyboard.press('Alt+Digit1');ok(await p.evaluate(()=>__wux.homeOpen),'Home chord works from composer');
 await p.click('#desktopHome [data-res-open="ai"]');await p.keyboard.press('Tab');await p.keyboard.press('Shift+Tab');
 ok(await p.evaluate(()=>!!document.activeElement.closest('.rs-sheet')),'Resources keyboard focus remains in dialog');
 await p.evaluate(()=>history.back());await nap(250);ok(await p.locator('.rs-sheet').count()===0&&await p.evaluate(()=>__wux.homeOpen),'browser Back closes Resources and stays inside Wizard');
 await p.click('#wsList [data-ws="0"]');
 ok(await ta.inputValue()==='QA retained parity draft — never send'&&await p.evaluate(()=>document.querySelector('.win.focus')===__savedWin),'Home Resources preserve composer and window node');
 await center(p,'unselected Home icon centered in its frame');
 await nap(250);ok(await p.evaluate(()=>!WosResources.state.timer&&!WosResources.state.busy),'resource polling stops away from Home');
 await p.click('#searchBtn');await p.fill('#palInput','Home');ok(await p.locator('#palList').innerText().then(x=>x.includes('⌥1')),'palette documents Home shortcut');await p.keyboard.press('Alt+Digit1');
 ok(await p.evaluate(()=>__wux.homeOpen&&document.querySelector('#palette').hidden),'Home chord works with palette open');
 await p.keyboard.press('Alt+Slash');ok((await p.locator('#keysBody').innerText()).includes('Home')&&(await p.locator('#keysBody').innerText()).includes('⌥1'),'keyboard help documents Home chord');await p.keyboard.press('Escape');
 await p.click('#desktopHome [data-home-settings]');ok(await p.locator('#dsettings').isVisible(),'Home Settings opens existing desktop settings');await p.keyboard.press('Escape');
 await p.click('#desktopHome [data-res-open="server"]');await p.click('#wsList [data-ws="0"]');ok(await p.locator('.rs-sheet').count()===0,'switching desktop closes Resources dialog');
 await p.keyboard.press('Alt+Digit1');await p.setViewportSize({width:1024,height:650});await nap(250);await center(p,'Home highlight stays centered at smaller desktop');
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
 // Icon navigation and Home-first digit mapping, using local frame fixtures only.
 await p.setViewportSize({width:1440,height:900});await p.keyboard.press('Alt+Digit2');
 ok(await p.evaluate(()=>!__wux.homeOpen&&__wux.cur===0),'Alt+2 opens first app desktop');
 ok(await p.locator('#wsList [data-ws="0"] .sgi').count()===1&&!(await p.locator('#wsList [data-ws="0"]').innerText()).trim(),'desktop bar uses an app icon instead of desktop number');
 ok((await p.locator('#wsList [data-ws="0"]').getAttribute('title')).includes('⌥2'),'first app icon advertises Alt+2');
 await ctx.route('**/__qa-icon-frame',r=>r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><textarea aria-label="QA fixture field">Fixture only</textarea>'}));
 const fid=await p.evaluate(()=>__wux.newWin({app:'frame',appId:'wizard-music',url:'/__qa-icon-frame',title:'QA music frame'}).id);
 await p.locator(`.win[data-win="${fid}"] iframe`).waitFor();
 ok(await p.locator('#wsList [data-ws="0"] .sg-music').count()===1&&(await p.locator('#wsList [data-ws="0"] .dn').innerText())==='2','mixed desktop shows focused app icon and window-count badge');
 await p.evaluate(id=>__wux.focusWin(id),wid);ok(await p.locator('#wsList [data-ws="0"] .sg-hat').count()===1,'desktop icon updates immediately with window focus');
 const beforeShiftHome=await p.evaluate(()=>JSON.stringify(__wux.ws.map(x=>x.wins)));
 await p.keyboard.press('Alt+Shift+Digit1');ok((await p.evaluate(()=>JSON.stringify(__wux.ws.map(x=>x.wins))))===beforeShiftHome&&!await p.evaluate(()=>__wux.homeOpen),'Shift+Alt+1 leaves app windows in place (Home stays empty)');
 await p.keyboard.press('Alt+Digit3');ok(await p.evaluate(()=>__wux.cur===1&&__wux.ws.length===2),'next icon slot Alt+3 creates one desktop');
 ok(await p.locator('#wsList [data-ws="1"] .dsg.empty').count()===1,'empty desktop shows mobile-style ring');
 await p.evaluate(()=>__wux.newChat());await p.keyboard.press('Alt+Shift+Digit2');
 ok(await p.evaluate(()=>__wux.ws[0].wins.length===3&&__wux.ws[1].wins.length===0),'Shift+Alt+2 sends app to first app desktop');
 await p.keyboard.press('Alt+Digit2');ok(await p.evaluate(()=>__wux.cur===0&&__wux.ws.length===1),'shifted mapping remains correct after empty-desktop pruning');
 await p.keyboard.press('Alt+Digit4');ok(await p.evaluate(()=>__wux.cur===0&&__wux.ws.length===1),'digits beyond next icon slot remain inert');
 await p.keyboard.press('Alt+Digit1');await p.keyboard.press('Alt+Digit1');ok(await p.evaluate(()=>__wux.homeOpen),'Home chord is idempotent');
 await shot(p,'desktop-shared-icons');
 await p.reload();await p.waitForFunction(()=>__wux?.live?.ok);ok(await p.evaluate(()=>__wux.homeOpen)&&await p.locator('#logo .sg-home').count()===1,'Home-first icon navigation restores without migrating saved windows');
 await p.keyboard.press('Alt+Digit2');ok(await p.locator('#wsList [data-ws="0"] .dn').innerText()==='3','workspace contents and badges survive reload');
 // Review regression: empty desktops show Home content without homeOpen=true.
 await p.evaluate(()=>__wux.newDesktop());
 ok(await p.locator('#palette').isVisible(),'new empty desktop opens app selector before Resources');
 await p.keyboard.press('Escape'); // Dismiss the newly requested picker before testing the underlying Resources surface.
 await p.click('.wsp:not([hidden]) [data-res-open="server"]');await p.waitForFunction(()=>WosResources.state.panel);
 await p.keyboard.press('Alt+Enter');
 ok(await p.locator('.rs-sheet').count()===0&&await p.evaluate(()=>!__wux.homeOpen&&__wux.ws[__wux.cur].wins.length===1),'launching New chat from empty-desktop Resources closes its modal');
 await p.evaluate(()=>{for(const id of [...__wux.ws[__wux.cur].wins])__wux.closeWin(id);__wux.goWs(0);});
 await ctx.close();
 const mob=await setup(true);const m=mob.p;await m.evaluate(()=>__wos.goDesk(0,true));await m.waitForFunction(()=>WosResources.state.server&&WosResources.state.ai,{timeout:30000});
 ok(await m.evaluate(()=>document.documentElement.dataset.shell==='phone')&&await m.locator('#logo').count()===0,'phone keeps phone shell');
 await m.click('[data-res-open="server"]');await m.waitForFunction(()=>WosResources.state.panel);ok(await m.locator('.device > .rs-sheet').count()===1,'phone Resources still mounts in device');await m.click('[data-res-tab="ai"]');await m.locator('.rs-sheet .us-row').first().waitFor();ok(await m.locator('.rs-sheet .us-row').count()>0,'phone AI details still render');await shot(m,'phone-ai');await m.keyboard.press('Escape');ok(await m.locator('.rs-sheet').count()===0,'phone Escape returns Home');await mob.ctx.close();
 ok(errors.length===0,'zero page errors',errors);ok(reads.some(x=>x.includes('/api/system/devices'))&&reads.some(x=>x.includes('/wizard/ai-usage')),'real resources read endpoints exercised');
})().catch(e=>{ok(false,'uncaught QA failure',String(e.stack||e));}).finally(async()=>{await browser?.close();const result={pass:checks.filter(x=>x.pass).length,fail:checks.filter(x=>!x.pass).length,checks,errors,blockedWrites:writes,resourceReads:reads};fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(result,null,2));console.log('RESULT',result.pass,result.fail);process.exitCode=result.fail?1:0;});
