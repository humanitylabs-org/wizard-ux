// Read-only bounded gap probes; all writes denied. Evidence remains private.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {chromium}=require(process.env.PW||'playwright');
const BASE=process.env.QA_ORIGIN,OUT=process.env.QA_OUT;
if(!BASE||!OUT)throw Error('QA_ORIGIN and QA_OUT required');fs.mkdirSync(OUT,{recursive:true});
(async()=>{const browser=await chromium.launch({executablePath:process.env.QA_CHROME});
for(const id of process.argv.slice(2)){
const row={id,mode:'live-read-only',requests:[],errors:[],assets:[]};
const ctx=await browser.newContext({viewport:{width:412,height:892},isMobile:true,hasTouch:true,serviceWorkers:'block'});
await ctx.addInitScript(()=>{localStorage.setItem('wos.coached','true')});
await ctx.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(!['GET','HEAD'].includes(q.method())){row.requests.push({blocked:true,method:q.method(),path:u.pathname});return r.fulfill({status:403,contentType:'application/json',body:'{}'})}if(u.searchParams.get('build')==='1')return r.abort();return r.continue()});
const p=await ctx.newPage();p.setDefaultTimeout(8000);
p.on('pageerror',e=>row.errors.push(String(e)));p.on('response',async r=>{try{if(r.url().includes('/api/'))row.requests.push({url:r.url(),status:r.status()});if(/\.js(?:\?|$)/.test(r.url()))row.assets.push({url:r.url(),sha256:crypto.createHash('sha256').update(await r.body()).digest('hex')})}catch{}});
try{await p.goto(BASE+'/wizard-os-home/?open='+encodeURIComponent(id));await p.waitForFunction(()=>window.__wos&&window.WizCore);await p.evaluate(()=>WizCore.appsLoaded());await p.waitForTimeout(6000);
const shell=()=>p.evaluate(()=>{const d=__wos.desks[__wos.idx],w=__wos.wins[d.focus];return{idx:__wos.idx,focus:d.focus,app:w?.appId||w?.app,full:d.full,thread:w?.thread,sheet:document.querySelector('#inbox')?.className}});
row.shell=await shell();const el=p.locator('.win[data-win="'+row.shell.focus+'"] iframe');const f=id==='v-inbox'?p:await(await el.elementHandle())?.contentFrame();
if(!f)throw Error('No frame');
const state=()=>f.evaluate(()=>({url:location.href,text:document.body.innerText.slice(0,6000),controls:[...document.querySelectorAll('button,a,input,[data-note]')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height).map(e=>({tag:e.tagName,id:e.id,cls:e.className,text:(e.getAttribute('aria-label')||e.innerText||e.placeholder||'').slice(0,120),html:e.outerHTML.slice(0,350)}))}));
row.initial=await state();await p.screenshot({path:path.join(OUT,id+'-initial.png')});
row.tests=[];
const native=async()=>{await p.evaluate(()=>window.__wosNativeBack?__wosNativeBack():__wos.onBack());await p.waitForTimeout(1700)};
const test=async(name,fn)=>{try{await fn();row.tests.push({name,pass:true})}catch(e){row.tests.push({name,pass:false,error:String(e)})}};
const assert=(x,m)=>{if(!x)throw Error(m)};
const same=async()=>{const s=await shell();assert(s.idx===row.shell.idx&&s.focus===row.shell.focus&&s.full===row.shell.full,'Shell moved: '+JSON.stringify(s))};
async function pair(name,open,close,closed){let targets=[];for(const action of ['visible','hardware']){await open();await p.waitForTimeout(400);const nested=await state();await p.screenshot({path:path.join(OUT,id+'-'+name+'-'+action+'-nested.png')});if(action==='visible')await close();else await native();await p.waitForTimeout(700);assert(await closed(),'Nested layer did not close');await same();targets.push({action,url:(await state()).url,shell:await shell()});row.tests.push({name:name+'-'+action,pass:true,nestedURL:nested.url,target:targets.at(-1)})}assert(targets[0].url===targets[1].url,'Visible/hardware target mismatch')}
if(id==='wizard-signal'){
 await f.locator('[data-action="add"]:visible').first().waitFor();
 await test('add-source-equivalence',()=>pair('add-source',()=>f.locator('[data-action="add"]:visible').first().tap(),()=>f.locator('[data-action="close"]:visible').tap(),async()=>!(await f.locator('[role="dialog"]').count())));
 await test('sources-to-feed',()=>pair('sources',()=>f.locator('[data-action="nav"][data-id="sources"]:visible').first().tap(),()=>f.locator('[data-action="nav"][data-id="feed"]:visible').first().tap(),()=>f.locator('h1').innerText().then(t=>t==='Signal')));
}
if(id==='oscar-graph'){
 await test('store-to-myapps',()=>pair('store',()=>f.locator('[data-mode="store"]').tap(),()=>f.locator('[data-mode="apps"]').tap(),()=>f.locator('[data-mode="apps"]').getAttribute('class').then(c=>c.includes('on'))));
 await test('card-to-myapps',()=>pair('card',async()=>{await f.locator('.wam-anchor').first().tap();await f.locator('[data-wam-back]').waitFor();row.card=await state()},()=>f.locator('[data-wam-back]').tap(),async()=>await f.locator('.wam-anchor').count()>0&&!(await f.locator('[data-wam-back]').count())));
}
if(id==='wizard-search'){
 await test('images-tab-to-all',()=>pair('tab',()=>f.locator('[data-t="images"]').tap(),()=>f.locator('[data-t="all"]').tap(),()=>f.locator('[data-t="all"]').getAttribute('aria-selected').then(x=>x==='true')));
 // No real model/search invocation: response fixture supplies only image-result data.
 await ctx.route('**/wizard-search/api/**',r=>{const u=new URL(r.request().url());if(u.pathname.endsWith('overview-stream'))return r.fulfill({contentType:'text/event-stream',body:'event: done\ndata: {"answer":""}\n\n'});return r.fulfill({contentType:'application/json',body:JSON.stringify(u.pathname.endsWith('images')?{images:[{id:'qa-synthetic',title:'QA synthetic image',host:'fixture.invalid',w:1,h:1,page:'https://fixture.invalid/'}]}:{results:[]})})});
 await ctx.route('**/wizard-search/{thumb,img}/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>'}));
 row.fixture='Search result and image only; actual hosted UI and shell viewer';
 await f.locator('#q').fill('QA synthetic image');await f.locator('#q').press('Enter');await f.locator('#strip [data-i]').first().waitFor();
 await test('image-viewer',()=>pair('image',async()=>{await f.locator('#strip [data-i]').first().tap();assert(await p.evaluate(()=>WosChat.viewer.isOpen()),'Viewer not opened')},()=>p.locator('.mv-x').tap(),async()=>!(await p.evaluate(()=>WosChat.viewer.isOpen()))&&await f.locator('#q').inputValue()==='QA synthetic image'));
}
if(id==='wizard-music'){
 row.fixture='Only POST /wizard-music/api/station fulfilled locally; not sent to production';
 await ctx.route('**/wizard-music/api/station',async r=>{const home=await f.evaluate(()=>fetch('api/home').then(r=>r.json()));row.musicHomeKeys=Object.keys(home);const tracks=home.library||home.local||home.tracks||[];row.fixtureTracks=tracks;return r.fulfill({contentType:'application/json',body:JSON.stringify({station:{id:'qa-synthetic',title:'QA synthetic station'},tracks})})});
 await test('player-equivalence',()=>pair('player',()=>f.locator('button.music-tile').first().tap(),()=>f.locator('[aria-label="Close player"]').tap(),async()=>!(await f.locator('.music-now').count())));
}
if(id==='v-inbox'){
 row.noteCount=await p.locator('#inbox [data-note]').count();
 if(row.noteCount)await test('inbox-thread-equivalence',async()=>{const note=p.locator('#inbox [data-note]').first(),target=await note.getAttribute('data-note');await note.tap();await p.waitForTimeout(1000);const nested=await shell();assert(nested.thread===target,'Inbox opened wrong thread');row.openedTarget=target;await p.screenshot({path:path.join(OUT,id+'-thread-nested.png')});await native();const after=await shell();row.inboxAfter=after;assert(!after.thread&&after.focus===nested.focus&&after.idx===nested.idx,'Wrong thread Back target');await p.locator('.win[data-win="'+after.focus+'"] [data-chopen="'+target+'"]').tap();await p.waitForTimeout(800);assert((await shell()).thread===target,'Reopen selected wrong thread');await p.locator('.win[data-win="'+after.focus+'"] [data-chback]').tap();await p.waitForTimeout(1000);row.inboxVisibleAfter=await shell();assert(JSON.stringify(after)===JSON.stringify(row.inboxVisibleAfter),'Visible/hardware targets differ')});
}
if(id==='social'||id==='messenger')row.gate=(await state()).text;
// Exhaust to shell root; root repeated native callbacks must stay. Not app-root retention.
await test('shell-root-stay',async()=>{for(let i=0;i<5;i++)await native();const root=await shell();await native();await native();assert(JSON.stringify(root)===JSON.stringify(await shell()),'Root changed');row.root=root;assert(p.url().includes('/wizard-os-home/'),'Document exited')});
row.final=await state();await p.screenshot({path:path.join(OUT,id+'-final.png')});
}catch(e){row.error=String(e)}finally{fs.writeFileSync(path.join(OUT,id+'.json'),JSON.stringify(row,null,2));console.log(id,row.error||'inspected');await ctx.close()}}
await browser.close()})().catch(e=>{console.error(e);process.exit(1)});
