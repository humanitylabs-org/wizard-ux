// Read-only installed-app acceptance. Run on the admitted browser worker. Optional candidate asset overrides only.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {chromium}=require('./tools/qa-playwright.cjs');
const BASE=process.env.QA_ORIGIN, OUT=process.env.QA_OUT;
if(!BASE||!OUT)throw Error('Set QA_ORIGIN and QA_OUT');fs.mkdirSync(OUT,{recursive:true});
const receipt={cases:[],blockedWrites:[],errors:[],failedRequests:[],badResponses:[],assets:[],limitations:['Browser Android hook, not physical handset','All non-GET requests intercepted; local browser storage is disposable; workspace sync disabled']};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const browser=await chromium.launch({executablePath:process.env.QA_CHROME});
let ctx,p,f;
async function newSession(){
if(ctx)await ctx.close();f=null;
ctx=await browser.newContext({viewport:{width:412,height:892},isMobile:true,hasTouch:true,serviceWorkers:'block'});
await ctx.addInitScript(()=>{try{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.wsync.off','true');localStorage.setItem('wos.tour.done','1')}catch{}});
await ctx.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(!['GET','HEAD'].includes(q.method())){receipt.blockedWrites.push({method:q.method(),path:u.pathname});return r.fulfill({status:403,contentType:'application/json',body:'{"error":"Read-only acceptance run"}'})}
if(u.searchParams.get('build')==='1')return r.abort();
const replacements={'/wisdom/wisdom.js':process.env.QA_WISDOM&&path.join(process.env.QA_WISDOM,'static/wisdom.js'),'/wizard-os-home/core/app-client.js':process.env.QA_UX&&path.join(process.env.QA_UX,'web/core/app-client.js')};
const f=replacements[u.pathname];if(f){const body=fs.readFileSync(f);receipt.assets.push({url:u.pathname,file:f,sha256:crypto.createHash('sha256').update(body).digest('hex')});return r.fulfill({status:200,contentType:'application/javascript',body})}return r.continue();});
p=await ctx.newPage();p.on('pageerror',e=>receipt.errors.push(e.stack));p.on('requestfailed',r=>receipt.failedRequests.push({url:r.url(),error:r.failure()?.errorText}));p.on('response',r=>{if(r.status()>=400)receipt.badResponses.push({url:r.url(),status:r.status()})});
}
await newSession();
const shell=()=>p.evaluate(()=>({idx:__wos.idx,focus:__wos.desks[__wos.idx].focus,full:__wos.desks[__wos.idx].full,appId:__wos.wins[__wos.desks[__wos.idx].focus]?.appId,log:window.__backLog||[]}));
async function boot(){await p.goto(BASE+'/wizard-os-home/?open=wisdom');await p.waitForFunction(()=>window.WizCore&&window.__wos);await p.evaluate(()=>WizCore.appsLoaded());for(let i=0;i<60&&!f;i++){f=p.frames().find(x=>x.url().includes('/wisdom/'));if(!f)await sleep(250)}await f.locator('.wb-hero').waitFor({timeout:30000});}
async function record(name,fn){try{await fn();receipt.cases.push({name,pass:true});console.log('PASS',name)}catch(e){receipt.cases.push({name,pass:false,error:String(e),frame:f&&await f.evaluate(()=>({url:location.href,text:document.body.innerText.slice(0,500)})).catch(()=>null)});console.log('FAIL',name,String(e))}fs.writeFileSync(path.join(OUT,'wisdom.json'),JSON.stringify(receipt,null,2));}
const assert=(c,m)=>{if(!c)throw Error(m)};
async function backTo(expected,pre,method='native'){if(method==='browser')await p.goBack({waitUntil:'domcontentloaded'}).catch(()=>{});else if(method==='bridge')await p.evaluate(()=>__wosNativeBack());else await p.evaluate(()=>__wos.onBack());await sleep(1000);const after=await shell(),hash=await f.evaluate(()=>location.hash);assert(hash===expected,`expected ${expected}, got ${hash}`);assert(after.focus===pre.focus&&after.idx===pre.idx&&after.full===pre.full,`shell changed: ${JSON.stringify({pre,after})}`);await sleep(1300);assert(JSON.stringify(await shell())===JSON.stringify(after),'delayed second shell step');}
await boot();
const home=async()=>{await f.evaluate(()=>Wisdom.navigate('',{replace:true}));await f.locator('.wb-hero').waitFor()};
// Home's daily hero can be a chapter OR a collection. Follow a real chapter's
// visible parent Back, not the day's recommendation shape.
const collection=async()=>{await home();await f.locator('.wb-pick').first().tap();await f.locator('.wisdom-reader').waitFor();const parent=f.locator('.wb-top a[aria-label="Back"]');assert((await parent.getAttribute('href')).startsWith('#/collection/'),'reading shortcut has no collection parent');await parent.tap();await f.locator('.wb-book-hero').waitFor();return f.evaluate(()=>location.hash)};
let readerUrl,parentHash;
await record('home reading shortcut: hardware matches visible Back',async()=>{await f.locator('.wb-pick').first().tap();await f.locator('.wisdom-reader').waitFor();readerUrl=await f.evaluate(()=>location.href);parentHash=await f.locator('.wb-top a[aria-label="Back"]').getAttribute('href');await p.screenshot({path:path.join(OUT,'reader-before.png')});await backTo(parentHash,await shell());await p.screenshot({path:path.join(OUT,'reader-after.png')});});
await record('collection → reader → collection → library, fullscreen retained',async()=>{const col=await collection();await f.locator('a[href*="/read/"]').first().tap();await f.locator('.wisdom-reader').waitFor();await p.evaluate(()=>__wos.setFull(__wos.desks[__wos.idx].focus,true));await backTo(col,await shell());await backTo('',await shell());await p.evaluate(()=>__wos.setFull(__wos.desks[__wos.idx].focus,false));});
await record('on-screen Back then hardware does not reopen chapter',async()=>{await collection();await f.locator('a[href*="/read/"]').first().tap();await f.locator('.wb-top a[aria-label="Back"]').tap();await sleep(600);await backTo('',await shell());});
await record('cold deep-linked reader matches visible Back',async()=>{await newSession();await boot();await f.goto(readerUrl.replace('/wisdom/#','/wisdom/?qa-back='+Date.now()+'#'));await f.locator('.wisdom-reader').waitFor({timeout:30000});await backTo(parentHash,await shell());});
await record('restored reader matches visible Back',async()=>{await newSession();await boot();await f.goto(readerUrl.replace('/wisdom/#','/wisdom/?qa-back='+Date.now()+'#'));await f.locator('.wisdom-reader').waitFor({timeout:30000});await f.goto(BASE+'/wisdom/');await f.locator('.wisdom-reader').waitFor({timeout:30000});await backTo(parentHash,await shell());});
await record('chapter discussions close first and retain exact chapter',async()=>{await f.goto(readerUrl.replace('/wisdom/#','/wisdom/?qa-back='+Date.now()+'#'));await f.locator('.wisdom-reader').waitFor({timeout:30000});await f.locator('[aria-label="Chapter discussions"]').tap();await sleep(500);assert(await f.evaluate(()=>WisdomDiscussion.isOpen()),'discussion did not open');await backTo(new URL(readerUrl).hash,await shell());assert(!await f.evaluate(()=>WisdomDiscussion.isOpen()),'discussion still open');await backTo(parentHash,await shell());});
await record('browser history Back is one app step',async()=>{const col=await collection();await f.locator('a[href*="/read/"]').first().tap();await f.locator('.wisdom-reader').waitFor();await backTo(col,await shell(),'browser');});
await record('native bridge reader Back keeps the app and book',async()=>{await home();await f.locator('.wb-pick').first().tap();await f.locator('.wisdom-reader').waitFor();const parent=await f.locator('.wb-top a[aria-label="Back"]').getAttribute('href');await backTo(parent,await shell(),'bridge');});
await record('native root never exits shell',async()=>{await home();await p.evaluate(()=>__wosNativeBack());await sleep(300);await p.evaluate(()=>__wosNativeBack());await sleep(500);assert(p.url().includes('/wizard-os-home/'),'left Wizard');assert(await p.evaluate(()=>!!window.__wos),'shell lost');});
await record('no page errors during Wisdom navigation',async()=>assert(!receipt.errors.length,receipt.errors.join('\n')));
await browser.close();receipt.counts={passed:receipt.cases.filter(x=>x.pass).length,failed:receipt.cases.filter(x=>!x.pass).length};fs.writeFileSync(path.join(OUT,'wisdom.json'),JSON.stringify(receipt,null,2));console.log(receipt.counts);process.exitCode=receipt.counts.failed?1:0;
})().catch(e=>{fs.writeFileSync(path.join(OUT,'fatal.json'),JSON.stringify({error:String(e),receipt},null,2));console.error(e);process.exit(2)});
