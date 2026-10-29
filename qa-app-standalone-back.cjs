// Focused shared-client Back gate. Run on Thales; no live services or writes.
// PLAYWRIGHT_DIR=<module> QA_WEB_DIR=<repo> QA_OUT=<evidence> node qa-app-standalone-back.cjs
const fs=require('fs'), path=require('path'), http=require('http'), assert=require('assert/strict');
const {chromium}=require('./tools/qa-playwright.cjs');
const root=process.env.QA_WEB_DIR||__dirname, out=process.env.QA_OUT||path.join(__dirname,'evidence/standalone-back');
const client=fs.readFileSync(path.join(root,'web/core/app-client.js'));
const receipt={core_sha256:require('crypto').createHash('sha256').update(client).digest('hex'),checks:[],limitations:['Installed display mode and native bridge presence are simulated in desktop Chrome; not physical-device acceptance.']};
const html=`<!doctype html><html><body><h1 id="tap">App</h1><button id="nested">Nested</button><output id="route"></output>
<script>window.pushes=[];const push=history.pushState;history.pushState=function(s,...a){pushes.push(s);return push.call(this,s,...a)};</script>
<script src="/wizard-os-home/core/app-client.js"></script><script>
history.replaceState({depth:0},'',location.href);let current=location.hash;window.routePops=0;
const isRoot=()=>!location.hash;
WizardApp.back.useHistory({isRoot});
// A cold deep link has no prior domain entry: its router supplies the parent.
function coldBack(){history.replaceState({depth:0},'','/app/');paint();return true}
WizardApp.back.register({canGoBack:()=>!isRoot()&&!history.state.depth,back:coldBack});
function paint(){current=location.hash;document.querySelector('#route').textContent=current||'home'}
document.querySelector('#nested').onclick=()=>{history.pushState({depth:1},'','#nested');paint()};
addEventListener('popstate',()=>{routePops++;if(current===location.hash&&!isRoot()&&!history.state.depth)coldBack();else paint()});paint();
</script></body></html>`;
const host=`<!doctype html><html><body><div class="win"><iframe src="/app/"></iframe></div>
${['core','config','apps','appearance-host','chat-kit','app-services'].map(n=>'<script src="/wizard-os-home/core/'+n+'.js"></script>').join('')}
<script>WizCore.appsLoaded().then(()=>WizAppServices.attach(document.querySelector('iframe'),{appId:'fixture',path:'/app/'}));</script></body></html>`;
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost'),send=(s,type='text/html')=>{res.setHeader('Content-Type',type);res.end(s)};
 if(req.method!=='GET') {res.statusCode=405;return res.end()}
 if(u.pathname==='/app/')return send(html);
 if(u.pathname==='/host/')return send(host);
 if(u.pathname==='/wizard/v1/apps')return send(JSON.stringify({apps:[{id:'fixture',name:'Fixture',url:'/app/'}]}),'application/json');
 if(u.pathname==='/wizard/v1/bootstrap')return send(JSON.stringify({bootstrap:1,endpoints:{apps:'/wizard/v1/apps'},settings:{agent:{name:'Fixture Wizard'}},capabilities:{}}),'application/json');
 if(u.pathname.startsWith('/wizard/'))return send('{}','application/json');
 if(u.pathname.startsWith('/wizard-os-home/')){const p=path.resolve(root,'web',u.pathname.slice('/wizard-os-home/'.length));if(p.startsWith(path.resolve(root,'web')+path.sep)&&fs.existsSync(p))return send(fs.readFileSync(p),'application/javascript')}
 res.statusCode=404;res.end();
});
function ok(name,value){assert(value,name);receipt.checks.push(name);console.log('PASS',name)}
(async()=>{
 fs.mkdirSync(out,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
 for(const mode of ['browser','installed','android','mac']){
  const ctx=await browser.newContext({viewport:{width:412,height:915}});
  await ctx.addInitScript(mode=>{if(mode==='installed'){const mm=matchMedia;window.matchMedia=q=>q==='(display-mode: standalone)'?{matches:true}:mm(q)}if(mode==='android')window.WizardOSNative={};if(mode==='mac')window.webkit={messageHandlers:{wizardNative:{postMessage(){}}}};},mode);
  for(const cold of [false,true]){
   const p=await ctx.newPage();await p.goto(origin+'/app/'+(cold?'#cold':''));await p.locator('#tap').click();
   ok(mode+' '+cold+' guard is not domain history',await p.evaluate(()=>history.state.__wizardApp.index===0));
   if(cold){await p.goBack();await p.waitForFunction(()=>!location.hash);ok(mode+' cold Back is one parent step',await p.evaluate(()=>routePops===1))}
   await p.goBack();await p.waitForTimeout(60);
   ok(mode+' '+cold+' first root Back stays',p.url()===origin+'/app/');
   if(mode==='browser'){
    ok('browser '+cold+' warns',await p.locator('#wizard-app-back-notice').textContent()==='Press back again to exit');
    await p.goBack();await p.waitForURL('about:blank');ok('browser '+cold+' second Back exits',p.url()==='about:blank');
   }else{
    for(let i=0;i<3;i++){await p.goBack();await p.waitForTimeout(50)}
    ok(mode+' '+cold+' repeated root Back consumed',p.url()===origin+'/app/'&&!await p.locator('#wizard-app-back-notice').count());
   }
   await p.close();
  }
  // A real domain entry is popped once, never counted as a root press.
  const p=await ctx.newPage();await p.goto(origin+'/app/');await p.locator('#nested').click();await p.goBack();await p.waitForFunction(()=>!location.hash);
  ok(mode+' domain Back has no phantom step/warning',await p.evaluate(()=>routePops===1&&!document.querySelector('#wizard-app-back-notice')));
  await p.locator('#tap').click();await p.goBack();await p.waitForTimeout(60);ok(mode+' root after domain stays',p.url()===origin+'/app/');
  await p.close();await ctx.close();
 }
 // Timeout re-arms the browser floor rather than leaving a permanent exit window.
 const ctx=await browser.newContext(),p=await ctx.newPage();await p.goto(origin+'/app/');await p.locator('#tap').click();await p.goBack();await p.waitForTimeout(2200);await p.locator('#tap').click();await p.goBack();ok('expired browser exit window warns again',p.url()===origin+'/app/'&&await p.locator('#wizard-app-back-notice').count()===1);await ctx.close();
 const oc=await browser.newContext(),op=await oc.newPage();await op.goto(origin+'/app/#cold');await op.locator('#tap').click();await op.evaluate(()=>{window.order=[];WizardApp.back.push(()=>order.push(1));WizardApp.back.push(()=>order.push(2))});
 for(const expected of [[2],[2,1]]){await op.keyboard.press('Escape');await op.waitForTimeout(60);assert.deepEqual(await op.evaluate(()=>order),expected);assert(op.url().endsWith('#cold'));await op.locator('#tap').click()}
 ok('CloseWatcher overlays LIFO preserve domain',true);await op.keyboard.press('Escape');await op.waitForFunction(()=>!location.hash);ok('CloseWatcher next Back reaches root',true);await oc.close();
 const hc=await browser.newContext(),hp=await hc.newPage();await hp.goto(origin+'/host/');const fr=hp.frames().find(f=>f.url()===origin+'/app/');assert(fr);await fr.waitForFunction(()=>WizardApp.hosted);await fr.locator('#tap').click();ok('hosted creates no client guard',await fr.evaluate(()=>pushes.length===0));
 await fr.locator('#nested').click();assert.equal(await hp.evaluate(()=>WizAppServices.back(document.querySelector('iframe'))),'handled');await fr.waitForFunction(()=>!location.hash);assert.equal(await hp.evaluate(()=>WizAppServices.back(document.querySelector('iframe'))),'atRoot');ok('real shared host keeps one domain Back and root ownership',await fr.evaluate(()=>routePops===1&&pushes.length===1));await hc.close();
 }finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2))}
})().catch(e=>{receipt.error=String(e.stack);fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2));console.error(e);server.close();process.exitCode=1});
