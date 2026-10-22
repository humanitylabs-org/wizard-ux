// Thales-only, real GET data. Run baseline and candidate with the SAME staging origin.
// QA_SHA=<git SHA> QA_WEB_DIR=<exact checkout> QA_MODE=candidate|baseline QA_OUT=$WIZARD_WORK_ROOT/... node qa-home-screen-apps.cjs
// QA_NATIVE_DOCUMENT_START=1 emulates ONLY the native early storage hook; not device proof.
if (!process.env.QA_ORIGIN) throw new Error('QA_ORIGIN is required: select an isolated tailnet preview');
const os=require('os'),fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
if(process.platform!=='darwin'||!process.env.WIZARD_WORK_ROOT)throw Error('Thales-only browser QA');
const {chromium}=require('./tools/qa-playwright.cjs');
const origin=new URL(process.env.QA_ORIGIN).origin;
const out=process.env.QA_OUT,source=process.env.QA_WEB_DIR,mode=process.env.QA_MODE||'candidate';
if(!out||!require('./tools/qa-paths.cjs').inWorkRoot(out)||!source||!['candidate','baseline'].includes(mode))throw Error('Exact source, mode and ThalesMedia output required');
const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
if(sha!==process.env.QA_SHA||cp.execFileSync('git',['status','--porcelain'],{cwd:source,encoding:'utf8'}).trim())throw Error('QA_SHA must identify clean exact source');
fs.mkdirSync(out,{recursive:true});const checks=[],blocked=[],errors=[],network=[],assets=[];
const check=(name,pass,detail,gate='feature')=>{checks.push({name,pass:!!pass,detail,gate});console.log(pass?'PASS':'FAIL',name,detail||'');};
const stamp=async p=>p.evaluate(()=>Object.fromEntries(['wins4','strip','idx4','recent'].map(k=>[k,localStorage.getItem('wos.'+k)])));
const chrome=p=>p.evaluate(()=>[...document.querySelectorAll('#launcher,#dock,#orb,.statusbar,#track')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&getComputedStyle(e).display!=='none'}).map(e=>e.id));
const reader=async f=>f.evaluate(()=>({url:location.href,id:document.querySelector('.wb-reader')?.dataset.read,count:document.querySelector('.wb-count')?.textContent,title:document.querySelector('.wb-top-title')?.textContent,transform:document.querySelector('.wb-track')?.style.transform}));
const waitFrame=async p=>{await p.waitForFunction(()=>{const w=document.querySelector('#singleApp > iframe.appframe')?.contentWindow;try{return w&&w.location.origin===location.origin&&!!w.WizardApp&&w.document.body?.innerText.length>80;}catch{return false;}},{},{timeout:45000,polling:100});const f=await(await p.locator('#singleApp > iframe.appframe').elementHandle()).contentFrame();return f;};
async function chapter(f,target=3){
 await f.page().bringToFront();
 // Choose an actual unread chapter from the live API, never a fabricated route or position fixture.
 const entry=await f.evaluate(async()=>{const r=await fetch(new URL('api/wisdom',new URL('.',location.href)));if(!r.ok)throw Error('Wisdom real data unavailable');const d=await r.json();return d.entries?.find(e=>!e.read&&e.body)||d.entries?.find(e=>!e.read);});
 if(!entry)throw Error('No actual unread Wisdom chapter available');
 // Use the real app router after following its real collection/list UI where possible.
 const link=f.locator(`[data-wisdom-route="/read/${entry.id}"]`).first();
 if(await link.count())await link.click();else{await f.evaluate(id=>Wisdom.navigate('/read/'+id),entry.id);}
 await f.locator('.wb-reader').waitFor();await f.evaluate(()=>document.fonts.ready);await f.page().waitForTimeout(500);await f.waitForFunction(()=>/^\d+\s*\/\s*\d+$/.test(document.querySelector('.wb-count')?.textContent||''));
 const start=await reader(f),total=Number(start.count.split('/')[1]);console.log('READER start',start);if(total<4)throw Error('Actual chapter too short for nonterminal position proof');
 await f.locator('.wb-top-title').click();const initial=Number(start.count.split('/')[0]);for(let n=initial;n<target;n++)await f.page().keyboard.press('ArrowRight');for(let n=initial;n>target;n--)await f.page().keyboard.press('ArrowLeft');await f.page().waitForTimeout(500);
 const saved=await reader(f);if(Number(saved.count.split('/')[0])!==target)throw Error('Actual reader did not advance to page '+target);return saved;
}
(async()=>{const browser=await chromium.launch({headless:true});const ctx=await browser.newContext({viewport:{width:412,height:892},hasTouch:true,isMobile:true,serviceWorkers:'block'});let failure=null;
try{
 await ctx.route('**/*',r=>{const req=r.request(),u=new URL(req.url());
  if(!['GET','HEAD'].includes(req.method())){blocked.push({method:req.method(),url:req.url()});return r.abort('blockedbyclient');}
  if(u.origin===origin&&u.pathname.startsWith('/wizard-os-home/')){
   const rel=decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length))||'index.html',root=path.resolve(source,'web'),p=path.resolve(root,rel);
   if(!p.startsWith(root+path.sep))return r.abort('blockedbyclient');
   if(fs.existsSync(p)&&fs.statSync(p).isFile()){const body=fs.readFileSync(p);assets.push({url:u.href,sha256:crypto.createHash('sha256').update(body).digest('hex'),source:'exact shell overlay'});return r.fulfill({body,contentType:rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':rel.endsWith('.html')?'text/html':'application/octet-stream'});}
  }return r.continue();
 });
 ctx.on('page',p=>{p.on('pageerror',e=>errors.push({page:p.url(),message:String(e),stack:String(e.stack)}));p.on('response',r=>{if(new URL(r.url()).origin===origin&&!r.url().includes('/wizard-os-home/'))network.push({url:r.url(),status:r.status()});});});
 await ctx.addInitScript(()=>{try{if(window===top)localStorage.setItem('wos.coached','true');}catch(_){} });
 if(process.env.QA_NATIVE_DOCUMENT_START==='1')await ctx.addInitScript(()=>{try{if(window!==top&&parent.WizHomeScreenPolicy?.mode)parent.WizHomeScreenPolicy.installPresentationStorage(window);}catch(_){} });
 const main=await ctx.newPage();await main.goto(origin+'/wizard-os-home/?shell=phone');await main.waitForFunction(()=>!!window.__wos);await main.evaluate(()=>WizCore.appsLoaded());
 check('ordinary shell boots with original window API',await main.evaluate(()=>!!__wos.wins&&!__wos.singleApp),null,'regression');
 await main.evaluate(()=>__wos.openSheet('launcher'));await main.locator('#launcher [data-app="wisdom"]').first().tap();await main.waitForTimeout(1800);
 const before=await stamp(main);check('ordinary Wisdom tap/window exists',await main.locator('.win iframe').count()>0,before,'regression');
 await main.reload();await main.waitForFunction(()=>!!window.__wos?.wins);await main.waitForTimeout(1500);
 check('ordinary refresh preserves desks/windows',JSON.stringify(before)===JSON.stringify(await stamp(main)),await stamp(main),'regression');
 const normalWisdom=main.frames().find(f=>f!==main.mainFrame()&&/wisdom/.test(f.url()));
 if(!normalWisdom)throw Error('Ordinary Wisdom iframe missing');
 const normalReading=await chapter(normalWisdom,2);
 const normalPlaces=await main.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>/^wisdom:.*:pos:/.test(k)).map(k=>[k,localStorage.getItem(k)])));
 await Promise.all([normalWisdom.waitForNavigation({waitUntil:'load'}),normalWisdom.evaluate(()=>location.reload())]);await normalWisdom.locator('.wb-count').waitFor();await normalWisdom.waitForFunction(()=>!!document.querySelector('.wb-count')?.textContent);await main.waitForTimeout(700);
 check('ordinary hosted reading refresh retains actual chapter/page',JSON.stringify(normalReading)===JSON.stringify(await reader(normalWisdom)),await reader(normalWisdom),'regression');
 const pages={},frames={};
 for(const id of ['wisdom','wizard-signal']){
  const p=await ctx.newPage();pages[id]=p;await p.goto(origin+'/wizard-os-home/?app-session='+id);await p.waitForTimeout(2000);
  const isolated=await p.evaluate(id=>__wos?.singleApp===id&&!__wos.wins,id);
  check(id+' isolated actual frontend',isolated&&await p.locator('#singleApp iframe').count()===1);
  check(id+' chrome absent from first session surface',(await chrome(p)).length===0,await chrome(p));
  if(!isolated)continue;
  const f=frames[id]=await waitFrame(p),registered=await p.evaluate(id=>WizCore.apps('mobile').APP[id]?.url,id);
  check(id+' resolves registered real route',new URL(f.url()).pathname===new URL(registered,origin).pathname,{registered,actual:f.url()});
  check(id+' shared capture/theme/back client available',await f.evaluate(()=>!!WizardApp.back&&!!WizardApp.capture&&!!WizardApp.theme));
  await p.waitForFunction(()=>WizAppearance.inspect().some(x=>x.acked),{},{timeout:10000});
  check(id+' theme reports immersive',await p.evaluate(()=>WizAppearance.inspect().some(x=>x.acked&&x.presentation==='immersive')));
  await p.screenshot({path:path.join(out,id+'-fullscreen.png')});
 }
 if(frames.wisdom){
  const p=pages.wisdom;let f=frames.wisdom;const saved=await chapter(f);
  check('Wisdom actual chapter/page 3 visible',!!saved.id&&/^3\s*\//.test(saved.count),saved);
  await pages['wizard-signal'].bringToFront();await p.bringToFront();
  check('Home-like switching preserves same frame/route/page',JSON.stringify(saved)===JSON.stringify(await reader(f)),await reader(f));
  await p.evaluate(()=>__wosSessionCheckpoint());await p.reload();f=frames.wisdom=await waitFrame(p);await f.locator('.wb-count').waitFor();await p.waitForTimeout(1000);
  check('Wisdom shell recreation restores actual chapter AND reading page',JSON.stringify(saved)===JSON.stringify(await reader(f)),await reader(f));
  await Promise.all([f.waitForNavigation({waitUntil:'load'}),f.evaluate(()=>location.reload())]);await f.locator('.wb-count').waitFor();await f.waitForFunction(()=>!!document.querySelector('.wb-count')?.textContent);await p.waitForTimeout(1000);
  check('Wisdom iframe refresh preserves chapter/page',JSON.stringify(saved)===JSON.stringify(await reader(f)),await reader(f));
  await p.evaluate(()=>__wosSessionCheckpoint());await p.close();const revived=pages.wisdom=await ctx.newPage();await revived.goto(origin+'/wizard-os-home/?app-session=wisdom');f=frames.wisdom=await waitFrame(revived);await f.locator('.wb-count').waitFor();await revived.waitForTimeout(1000);
  check('fresh task document restores route/page from durable storage',JSON.stringify(saved)===JSON.stringify(await reader(f)),await reader(f));
  const scoped=await revived.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith(WizHomeScreenPolicy.key(location.origin,'wisdom')+':presentation:')));
  check('paged presentation checkpoint is per task, not workspace',scoped.length>0,scoped);
  const searchURL=await revived.evaluate(()=>WizCore.apps('mobile').APP['wizard-search']?.url);
  check('shared selection Search utility is installed',!!searchURL,searchURL);
  if(searchURL){await f.evaluate(url=>window.open(url,'_blank'),searchURL);await revived.locator('.linksheet.open').waitFor();
   check('selection Search utility stays in shared link overlay, never creates desks',await revived.evaluate(()=>__wos.links.isOpen()&&!!__wos.singleApp&&!__wos.wins));
   check('utility cannot offer Keep as a desk window',await revived.locator('.linksheet .ls-keep').isHidden());
   await revived.evaluate(()=>__wosNativeBack());check('utility Back retains actual reader route/page',JSON.stringify(saved)===JSON.stringify(await reader(f)),await reader(f));
   await revived.evaluate(()=>__wos.links.open('/wizard-os-home/?open=wizard'));check('utility rejects nested shell/task navigation',await revived.evaluate(()=>!__wos.links.isOpen())&&JSON.stringify(saved)===JSON.stringify(await reader(f)));
  }
  check('ordinary Wisdom reading checkpoint was not copied/overwritten by app task',JSON.stringify(normalPlaces)===JSON.stringify(await main.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>/^wisdom:.*:pos:/.test(k)).map(k=>[k,localStorage.getItem(k)])))));
  await main.bringToFront();check('ordinary same-chapter reader retains separate page two',JSON.stringify(normalReading)===JSON.stringify(await reader(normalWisdom)),await reader(normalWisdom));await revived.bringToFront();
  await revived.evaluate(()=>__wosNativeBack());await revived.waitForTimeout(300);
  check('nested Back actually leaves chapter without exiting task',!(await f.locator('.wb-reader').count())&&await revived.evaluate(()=>__wos.singleApp==='wisdom'),f.url());
  // Real app overlay, not an Activity-name surrogate.
  // Select the real app root before opening its real request overlay; nested Back
  // was asserted independently above and can legitimately land on a collection.
  await f.evaluate(()=>Wisdom.navigate('/'));await f.locator('.wb-home-search').waitFor();await f.locator('.wb-home-search').click();await f.locator('[data-wisdom-request]').first().waitFor();
  const request=f.locator('[data-wisdom-request]').first();await request.click();await f.locator('.wb-sheet').waitFor();const route=f.url();await revived.evaluate(()=>__wosNativeBack());await revived.waitForTimeout(300);check('Back closes real Wisdom overlay before app route',await f.locator('.wb-sheet').count()===0&&f.url()===route);
  for(let n=0;n<5;n++)await revived.evaluate(()=>__wosNativeBack());await revived.waitForTimeout(400);
  check('repeated root Back stays on actual Wisdom root',await f.evaluate(()=>Wisdom.atRoot())&&(await chrome(revived)).length===0,f.url());
  const appsURL=await revived.evaluate(()=>WizConfig.endpoint('apps'));
  // Removal is a bounded real-registry metadata negative control, never a backend uninstall/write.
  await ctx.route(appsURL,async r=>{const response=await r.fetch(),data=await response.json();data.apps=data.apps.filter(a=>a.id!=='wisdom');await r.fulfill({response,json:data});});
  await revived.reload({waitUntil:'load'});await revived.locator('.single-unavailable h2').filter({hasText:'App unavailable'}).waitFor();
  check('removed app is useful unavailable surface, no arbitrary route',await revived.locator('.single-unavailable').innerText().then(x=>x.includes('App unavailable'))&&await revived.locator('#singleApp iframe').count()===0);
  await ctx.unroute(appsURL);await revived.reload({waitUntil:'load'});await waitFrame(revived);check('reinstalled registered app recovers without workspace',await revived.evaluate(()=>__wos.singleApp==='wisdom'&&!__wos.wins));
 }
 if(frames['wizard-signal']){
  const p=pages['wizard-signal'];let f=frames['wizard-signal'];
  const sourceLink=f.locator('[data-action="nav"][data-id="sources"]').first();await sourceLink.click();await f.waitForFunction(()=>history.state?.route==='sources'&&document.querySelector('.topbar')?.innerText.includes('Sources'),{},{timeout:45000,polling:100});
  const state=async()=>f.evaluate(()=>({url:location.href,route:history.state?.route,tab:history.state?.tab,source:history.state?.source,title:document.querySelector('.topbar')?.innerText}));
  const saved=await state();check('Signal real Sources route visible',saved.route==='sources'&&/Sources/.test(saved.title),saved);
  await p.evaluate(()=>__wosSessionCheckpoint());await p.reload();f=frames['wizard-signal']=await waitFrame(p);await p.waitForTimeout(700);
  check('Signal shell recreation reconstructs actual route and content',JSON.stringify(saved)===JSON.stringify(await state()),await state());
  await Promise.all([f.waitForNavigation({waitUntil:'load'}),f.evaluate(()=>location.reload())]);await f.waitForFunction(()=>history.state?.route==='sources'&&document.querySelector('.topbar')?.innerText.includes('Sources'),{},{timeout:45000,polling:100});
  check('Signal iframe refresh reconstructs route, not feed at #sources',JSON.stringify(saved)===JSON.stringify(await state()),await state());
  await p.evaluate(()=>__wosNativeBack());await f.waitForFunction(()=>history.state?.route==='feed'&&document.querySelector('.topbar')?.innerText.includes('Signal'),{},{timeout:45000,polling:100});
  check('Signal nested Back changes actual view to feed',await f.evaluate(()=>history.state?.route==='feed'&&document.querySelector('.topbar')?.innerText.includes('Signal')),f.url());
  const route=f.url();for(let n=0;n<4;n++)await p.evaluate(()=>__wosNativeBack());await p.waitForTimeout(300);
  check('Signal repeated root Back keeps real Signal route',f.url()===route&&(await chrome(p)).length===0,{route,actual:f.url()});
 }
 const invalid=await ctx.newPage();await invalid.goto(origin+'/wizard-os-home/?app-session=..%2Fwizard');await invalid.waitForTimeout(1000);check('invalid app link cannot reveal or navigate workspace',await invalid.locator('#singleApp iframe').count()===0&&(await chrome(invalid)).length===0);
 check('sessions do not mutate original arrangement',JSON.stringify(before)===JSON.stringify(await stamp(main)),await stamp(main));
 await main.bringToFront();await main.evaluate(()=>__wos.openSheet('launcher'));
 const tile=main.locator('#launcher [data-app="wisdom"]').first();await tile.scrollIntoViewIfNeeded();
 const cdp=await ctx.newCDPSession(main);
 const touch=async(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
 const point=async()=>{await main.evaluate(()=>__wos.openSheet('launcher'));await tile.scrollIntoViewIfNeeded();const b=await tile.boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
 const hold=async()=>{const q=await point();await touch('touchStart',[q]);await main.waitForTimeout(550);await touch('touchEnd',[]);await main.waitForTimeout(150);};
 for(const action of ['scroll','cancel']){const q=await point();await touch('touchStart',[q]);if(action==='scroll')await touch('touchMove',[{x:q.x,y:q.y+60}]);else await touch('touchCancel',[]);await main.waitForTimeout(550);if(action==='scroll')await touch('touchEnd',[]);check(action+' cancels trusted mobile hold',await main.locator('.home-pin-sheet').count()===0,null,'regression');}
 await hold();check('trusted mobile hold opens one action sheet',await main.locator('.home-pin-sheet').count()===1);
 if(await main.locator('.home-pin-sheet').count()){
  check('opening lift does not activate pin',await main.evaluate(()=>!WizHomeScreenApps.state.pending));
  check('unsupported browser launcher explanation is honest',await main.locator('.home-pin-sheet button').textContent()==="Can't add on this device");
  await main.evaluate(()=>__wosNativeBack());check('pin sheet Back leaves Apps menu',await main.locator('.home-pin-sheet').count()===0&&await main.locator('#launcher').evaluate(e=>e.classList.contains('open')));
 }
 await point();await main.waitForTimeout(750);await tile.tap();await main.waitForTimeout(800);check('ordinary app tap still uses a desk, never pin',await main.evaluate(()=>!!__wos.wins&&!__wos.singleApp)&&await main.locator('.home-pin-sheet').count()===0,null,'regression');
 check('ordinary shell new scripts have no runtime errors',errors.length===0,errors,'regression');
 check('real Wisdom/Signal network fetched, not nested shell/test doubles',network.some(x=>/wisdom/.test(x.url)&&x.status===200)&&network.some(x=>/wizard-signal/.test(x.url)&&x.status===200),network);
}catch(e){failure=String(e);console.error(e);for(const [i,p] of ctx.pages().entries()){await p.screenshot({path:path.join(out,'failure-'+i+'.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure-'+i+'.json'),JSON.stringify(await Promise.all(p.frames().map(f=>f.evaluate(()=>({url:location.href,text:document.body?.innerText?.slice(0,5000),reader:document.querySelector('.wb-reader')?.outerHTML?.slice(0,3000)})).catch(e=>({error:String(e)})))),null,2));}}finally{
 await ctx.close();await browser.close();
 const requiredNegative=['wisdom isolated actual frontend','wizard-signal isolated actual frontend','trusted mobile hold opens one action sheet'];
 const negativeVerified=mode==='baseline'&&requiredNegative.every(name=>checks.some(c=>c.name===name&&!c.pass))&&!failure&&!checks.some(c=>c.gate==='regression'&&!c.pass);
 const result={host:os.hostname(),source_revision:sha,mode,scope:'actual staging GET frontend/data + exact shell overlay; browser task recreation is not Android process death',nativeDocumentStartEmulated:process.env.QA_NATIVE_DOCUMENT_START==='1',checks,negativeVerified,assets,blockedWrites:blocked,errors,failure,deviceGates:['OS pin confirmation/name/sigil','three Recents tasks/re-tap reuse','signed Preview staging identity','real process death and camera/IME/network recovery']};
 fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(result,null,2));process.exitCode=mode==='baseline'?(negativeVerified?0:1):(failure||checks.some(c=>!c.pass)?1:0);
}})();
