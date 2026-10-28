// Isolated browser acceptance. No backend, service worker or live install is used.
const {chromium}=require('./qa-playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..','web'),out=process.env.QA_OUTPUT||path.join(__dirname,'..','qa','privsep');fs.mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const approval={error:'needs_owner_approval',app:'messenger',risks:['app: privileged (full control of the server)','app: mounts host path /srv at /host (writable) outside app-data and owner files'],approve_url:'/wizard-os-home/store-install/_approve/messenger/'+'a'.repeat(64)};
const app={id:'messenger',name:'Messenger',summary:'An isolated approval test',repo:'example/messenger',version:'1.0.0',commit:'a'.repeat(40),source:'standard',source_name:'Standard',channel:'standard',type:'view',uses:[],provides:[]};
(async()=>{
 const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://fixture');if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}const rel=decodeURIComponent(u.pathname.replace(/^\/wizard-os-home\//,''))||'index.html';const file=path.resolve(root,rel);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(file).pipe(res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.env.QA_CHROME?{executablePath:process.env.QA_CHROME}:{}),args:['--no-sandbox']});
 const results=[];
 try {
 for(const skin of ['obsidian','obsidian-light']) for(const mode of ['phone','desktop']) {
   let status={enabled:true,server_access:{active:true,expires_at:'2026-11-01T12:00:00Z',drift:['changed']}},requests=[];
   const ctx=await browser.newContext({serviceWorkers:'block',viewport:mode==='phone'?{width:412,height:892}:{width:1440,height:1000},timezoneId:'Europe/London'});
   await ctx.addInitScript(s=>{localStorage.setItem('wos.skin',s);localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.v1','true');localStorage.setItem('wos.voiceTipSeen','true');},skin);
   await ctx.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());
     if(u.origin!==origin)return r.abort();
     if(u.pathname.includes('/_approve/')) {requests.push({method:q.method(),path:u.pathname});return r.fulfill({contentType:'text/html',body:'<h1>App Manager owner confirmation</h1>'});}
     if(u.pathname.endsWith('/store-install/messenger')) {requests.push({method:q.method(),path:u.pathname});return r.fulfill({status:409,json:approval});}
     if(!['GET','HEAD'].includes(q.method())) {requests.push({method:q.method(),path:u.pathname});return r.fulfill({status:403,json:{error:'QA refuses writes'}});}
     if(u.pathname.endsWith('/privilege-status'))return r.fulfill({json:status});
     if(u.pathname.includes('/store-data/')) {
       if(u.pathname.includes('/index/search'))return r.fulfill({json:{apps:[app],sources:[],next_offset:null}});
       if(u.pathname.endsWith('/installed-apps'))return r.fulfill({json:{wam:[],shell:[],complete:true}});
       return r.fulfill({json:{installed:[]}});
     }
     if(/\/(data|summaries)\.js$/.test(u.pathname))return r.fulfill({contentType:'application/javascript',body:'// Empty fixture data'});
     if(u.pathname.startsWith('/wizard/')||u.pathname.startsWith('/api/')) {
       if(u.pathname.endsWith('/setup'))return r.fulfill({json:{first_run:false}});
       if(u.pathname.endsWith('/thread-seen'))return r.fulfill({json:{state:{initializedAt:1,threads:{}}}});
       if(u.pathname.endsWith('/system/health'))return r.fulfill({json:{available:true,checks:[],counts:{},status:'ok'}});
       return r.fulfill({json:{data:[],sessions:[],apps:[],devices:[],total:0,has_more:false}});
     }
     return r.continue();
   });
   const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(String(e)));
   await p.goto(origin+'/wizard-os-home/'+(mode==='desktop'?'desktop.html':''),{waitUntil:'load'});
   await p.waitForFunction(()=>!!window.WosPrivileges?.state && !!window.WosSettings);
   await p.locator('#wz-privilege-banner').waitFor({state:'visible'});
   assert.equal(await p.locator('#wz-privilege-banner').innerText().then(t=>t.includes('This box runs personal builds')),true);
   // The red row is a real Settings contribution. Follow existing nested navigation, never add a new route.
   await p.evaluate(()=>WizCore.deeplink.route(location.pathname+'?view=server-access'));
   await p.locator('.wz-server-access:visible').first().waitFor();
   assert.match(await p.locator('.wz-server-access:visible').first().innerText(),/Your agent has full server access until/);
   assert.match(await p.locator('.wz-server-access:visible').first().innerText(),/Server protections changed/);
   const color=await p.locator('.wz-server-access:visible').first().evaluate(el=>getComputedStyle(el).color);assert.notEqual(color,'rgb(0, 0, 0)');
   await p.screenshot({path:path.join(out,`${mode}-${skin}-server-access.png`),fullPage:true});
   // Capture the actual skin token values, not a palette made just for this test.
   const details=await p.evaluate(()=>({skin:document.documentElement.dataset.skin,banner:getComputedStyle(document.querySelector('.wz-developer-banner')).backgroundColor,row:getComputedStyle(document.querySelector('.wz-server-access')).color}));
   assert.equal(details.skin,skin);
   if(mode==='phone') {
     const at=await p.evaluate(()=>({url:location.href,sheet:window.__wos?.sheet}));
     await p.evaluate(()=>window.__wos.onBack());
     assert.equal(await p.locator('.st-category:visible').count()>0,true,'nested Back returns to Settings categories');
     await p.evaluate(()=>window.__wos.onBack());
     assert.equal(await p.locator('.st-root:visible').count(),0,'second Back closes Settings, not Wizard');
     assert.equal(new URL(p.url()).pathname,new URL(at.url).pathname);
     await p.evaluate(()=>window.__wos.onBack());assert.equal(new URL(p.url()).origin,origin,'root Back never exits');
   }
   // State transitions: revoke clears only the red row; developer mode controls its own banner.
   status={enabled:true,server_access:{active:false}};await p.evaluate(()=>WosPrivileges.load());
   assert.equal(await p.locator('.wz-server-access:visible').count(),0);assert.equal(await p.locator('#wz-privilege-banner').isVisible(),true);
   status={enabled:false,server_access:{active:false}};await p.evaluate(()=>WosPrivileges.load());assert.equal(await p.locator('#wz-privilege-banner').isVisible(),false);
   // Real Store POST refusal, then only a GET to the manager's confirmation page.
   await p.goto(origin+'/wizard-os-home/store/index.html?app=messenger',{waitUntil:'load'});
   await p.locator('#detail [data-get]').click();await p.locator('#detail .wz-owner-approval').waitFor();
   const card=p.locator('#detail .wz-owner-approval');assert.equal(await card.locator('a').count(),1);assert.match(await card.innerText(),/reading and changing files anywhere on/);
   assert.equal(await card.locator('a').getAttribute('href'),approval.approve_url);
   // Opaque pixel proof: identical panel over loud underlying text and an empty backdrop.
   await card.scrollIntoViewIfNeeded();const before=await card.screenshot();
   await p.evaluate(()=>{const loud=document.createElement('div');loud.id='qa-loud';loud.style='position:fixed;inset:0;z-index:-1;color:magenta;font-size:48px';loud.textContent='LOUD TEXT '.repeat(1000);document.body.append(loud);});
   const after=await card.screenshot();assert.equal(Buffer.compare(before,after),0,'approval panel is opaque');
   await p.screenshot({path:path.join(out,`${mode}-${skin}-approval.png`),fullPage:true});
   const popupWait=p.waitForEvent('popup');await card.locator('a').click();const popup=await popupWait;await popup.waitForLoadState();assert.equal(new URL(popup.url()).pathname,approval.approve_url);await popup.close();
   assert.equal(await p.locator('#detail').isVisible(),true,'approval keeps its nested app view');
   await p.locator('#detail [data-back]').click();assert.equal(await p.locator('#discover').isVisible(),true,'Back from approval app returns to Store, never exits');
   const writes=requests.filter(q=>!['GET','HEAD'].includes(q.method));assert.deepEqual(writes,[{method:'POST',path:'/wizard-os-home/store-install/messenger'}]);
   assert.ok(requests.some(q=>q.method==='GET'&&q.path===approval.approve_url));
   results.push({skin,mode,details,requests,errors});await ctx.close();
 }
 }finally{await browser.close();await new Promise(r=>server.close(r));}
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:results.length,results},null,2));console.log(JSON.stringify({passed:results.length,results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
