/* Synthetic, disposable loopback proof: real app bridge + unified sheet, no owner-agent data.
 * Run on forum via wizard_heavy_submit. SHARE_TEST_TREE points at old source for a red check. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs'), path=require('path'), http=require('http'), assert=require('assert/strict'), vm=require('vm');
const root=process.env.SHARE_TEST_TREE || path.resolve(__dirname,'..'), evidence=process.env.EVIDENCE_DIR || path.join(root,'.evidence/share-unified');
fs.mkdirSync(evidence,{recursive:true});
const skinSource=fs.readFileSync(path.join(root,'web/core/skins.js'),'utf8');
const skins=vm.runInNewContext('const T=o=>o;'+skinSource.slice(skinSource.indexOf('  const SKINS = ['),skinSource.indexOf('  // Each skin'))+'SKINS');
const primary={id:'synthetic-main',label:'Archimedes',is_default:true,status:'running'}, second={id:'synthetic-private',label:'Synthetic Private',privacy:'private',status:'running'}, stopped={id:'synthetic-stopped',label:'Stopped Synthetic',status:'stopped'};
let many=false, slow=false; const requests=[], posts=[], passed=[];
const check=(name,fn)=>{fn();passed.push(name);};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'), p=url.pathname;
  if(req.method==='POST'){
    const chunks=[];for await(const c of req) chunks.push(c);const body=Buffer.concat(chunks);res.setHeader('Content-Type','application/json');
    if(p==='/api/uploads'){await new Promise(r=>setTimeout(r,140));posts.push({kind:'upload',name:req.headers['x-name'],bytes:body.length});return res.end(JSON.stringify({id:'f'+posts.length,name:req.headers['x-name'],mime:req.headers['content-type'],bytes:body.length}));}
    if(p==='/api/chat'||p==='/api/native-queue'){const item={kind:p==='/api/chat'?'send':'queue',...JSON.parse(body)};posts.push(item);if(p==='/api/native-queue')await new Promise(r=>setTimeout(r,600));return res.end(JSON.stringify({durable:true,queued:true,id:'synthetic-receipt'}));}
  }
  if(p==='/wizard/v1/agents'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({agents:many?[primary,second,stopped]:[primary]}));}
  if(p==='/wizard/hermes/api/sessions'){
    const agent=url.searchParams.get('agent')||'';requests.push(agent);
    if(slow && !agent)await new Promise(r=>setTimeout(r,350));
    res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data:[{id:agent?'private-existing':'main-existing',title:agent?'Synthetic Private existing':'Synthetic Main existing'}]}));
  }
  if(p==='/messenger/'){res.setHeader('Content-Type','text/html;charset=utf-8');return res.end('<script src="/core/app-client.js"></script><p>Synthetic Messenger frame</p>');}
  if(p==='/wizard-os-home/'){
    res.setHeader('Content-Type','text/html;charset=utf-8');return res.end(`<!doctype html><html data-shell="phone" data-skin="nebula"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/core/skins.css"><link rel="stylesheet" href="/core/attach-chip.css"><link rel="stylesheet" href="/core/share-wizard.css"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;font:16px system-ui;background:var(--bg);color:var(--ink)}iframe{width:100%;height:100%;border:0}body{background-image:repeating-linear-gradient(45deg,transparent 0 8px,#78f3 8px 16px)}</style><script src="/core/attach-chip.js"></script></head><body><script>window.WizCore={apps:()=>({APPS:[{id:'messenger',kind:'wizard',url:'/messenger/'}]})};window.WizConfig={agent:()=> 'Archimedes'};</script><script src="/core/share-wizard.js"></script><script src="/core/app-services.js"></script><iframe id="app" src="/messenger/"></iframe><script>WizAppServices.attach(document.querySelector('iframe'),{appId:'messenger',path:'/messenger/',isVisible:()=>true});</script></body></html>`);
  }
  const file=path.resolve(root,'web','.'+p), web=path.resolve(root,'web')+path.sep;
  if(file.startsWith(web)&&fs.existsSync(file)&&fs.statSync(file).isFile()){
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'application/octet-stream');return res.end(fs.readFileSync(file));
  }
  res.statusCode=404;res.end();
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
 for(const shell of ['phone','desktop']){
  many=false; const page=await browser.newPage({viewport:shell==='phone'?{width:412,height:892}:{width:1100,height:850},isMobile:shell==='phone',hasTouch:shell==='phone'});page.setDefaultTimeout(4000);
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/wizard-os-home/`);await page.frameLocator('#app').locator('p').waitFor();
  await page.evaluate(({shell,tokens})=>{
    document.documentElement.dataset.shell=shell;for(const[k,v]of Object.entries(tokens))document.documentElement.style.setProperty('--'+k,v);
    const wins={m:{app:'messenger'},c:{app:'chats',thread:'unrelated'}}, host={wins,idx:0,desks:[{focus:'m'}],live:{sessions:[]},openThread(){},openWizardThread(){},toast(){},chats:{
      uploadFile:f=>fetch('/api/uploads',{method:'POST',headers:{'Content-Type':f.type,'X-Name':f.name},body:f}).then(r=>r.json()),
      sendChat:(wid,text,how,audio,opts)=>fetch('/api/chat',{method:'POST',body:JSON.stringify({wid,text,files:opts.files,opts})}).then(r=>r.json())}};
    window[shell==='phone'?'__wos':'__wux']=host;
  },{shell,tokens:skins.find(s=>s.id==='nebula').t});
  const app=page.frames().find(f=>f.url().endsWith('/messenger/'));
  const ready=()=>page.locator('[data-sharesend]').waitFor({state:'visible'}).then(()=>page.waitForFunction(()=>!document.querySelector('[data-sharesend]').disabled));
  const start=()=>posts.length;
  const openNative=async(extra={})=>page.evaluate(o=>{window.result=WizShareWizard.open({android:true,text:'Emailing x.pdf',subject:'x.pdf',from:'Synthetic PDF sender',items:[{n:0,name:'x.pdf',mime:'application/pdf',bytes:313000,blob:new Blob(['synthetic-pdf'])}],...o});},extra);
  await openNative();await ready();
  assert.equal(await page.locator('.dv-text').inputValue(),'');assert.equal(await page.locator('.dv-text').getAttribute('placeholder'),'Add a comment (optional)');assert.equal(await page.locator('.dv-quote').count(),0);check(`${shell}: empty comment and no Emailing quote`,()=>{});
  check(`${shell}: Agent shown with one agent`,()=>{});assert.equal(await page.locator('.dv-agent').count(),1);assert.equal(await page.locator('.dv-agent strong').innerText(),'Archimedes');
  await page.locator('.dv-chat').click();assert.equal(await page.getByRole('option').first().locator('span').first().innerText(),'+ New chat');assert.equal(await page.getByRole('option').first().getAttribute('aria-selected'),'true');check(`${shell}: one picker, New chat first/default`,()=>{});
  const opaque=await page.locator('.dv-picker').evaluate(e=>({color:getComputedStyle(e).backgroundColor,backdrop:getComputedStyle(e).backdropFilter}));assert.ok(!opaque.color.includes('rgba'));assert.ok(['none',''].includes(opaque.backdrop));
  await page.screenshot({path:path.join(evidence,`share-unified-${shell}-picker.png`)});
  await page.keyboard.press('Escape');assert.equal(await page.locator('.dv-picker').count(),0);assert.equal(await page.locator('.wz-share').count(),1);
  await page.mouse.click(5,5);assert.equal(await page.evaluate(()=>window.result),'cancelled');check(`${shell}: Escape peels picker then outside cancels sheet`,()=>{});
  many=true;
  await app.evaluate(()=>{window.result=WizardApp.share.wizard({text:'Archimedes · synthetic message\nHermes is restarting — synthetic quoted text',title:'Messenger',files:[new File(['pdf'],'brief.pdf',{type:'application/pdf'}),new File(['drop'],'remove.pdf',{type:'application/pdf'})]});});await ready();
  assert.equal(await page.locator('.dv-head small').innerText(),'Forwarded from Messenger');assert.equal(await page.locator('.dv-text').inputValue(),'');assert.equal(await page.locator('.dv-quote').evaluate(e=>e.isContentEditable),false);check(`${shell}: installed Messenger forward uses empty comment + read-only quote`,()=>{});
  await page.locator('.dv-text').fill('Why did this happen twice this morning?');
  await page.locator('.dv-chat').click();await page.getByRole('option',{name:'Synthetic Main existing',exact:true}).click();
  await page.locator('.dv-agent').click();assert.equal(await page.getByRole('option',{name:'Stopped Synthetic · Stopped'}).isDisabled(),true);await page.getByRole('option',{name:'Synthetic Private',exact:true}).click();await ready();
  assert.equal(await page.locator('.dv-chat strong').innerText(),'New chat');assert.ok(requests.includes('synthetic-private'));check(`${shell}: private agents included, stopped disabled, changing Agent resets Chat and scopes fetch`,()=>{});
  await page.locator('.dv-chat').click();assert.equal(await page.getByRole('option').nth(1).innerText(),'Synthetic Private existing');await page.getByRole('option',{name:'Synthetic Private existing',exact:true}).click();
  await page.locator('.ch-att').nth(1).getByRole('button',{name:'Remove',exact:true}).click();assert.equal(await page.locator('.ch-att').count(),1);
  await page.screenshot({path:path.join(evidence,`share-unified-${shell}-nebula.png`)});
  await page.evaluate(tokens=>{document.documentElement.dataset.skin='sepia';for(const[k,v]of Object.entries(tokens))document.documentElement.style.setProperty('--'+k,v);},skins.find(s=>s.id==='sepia').t);
  await page.addStyleTag({url:'/skins/sepia/skin.css'});await page.screenshot({path:path.join(evidence,`share-unified-${shell}-sepia.png`)});
  assert.equal(await page.locator('.dv-text').inputValue(),'Why did this happen twice this morning?');check(`${shell}: live two-skin change keeps composition`,()=>{});
  const before=start(), t=Date.now();await page.locator('[data-sharesend]').click();await page.locator('.wz-share').waitFor({state:'detached'});assert.ok(Date.now()-t<1000);assert.equal(await app.evaluate(()=>window.result),'sent');await page.waitForFunction(()=>!WizShareWizard.busy);
  const send=posts.slice(before).find(p=>p.kind==='send');assert.equal(send.opts.agent,'synthetic-private');assert.equal(send.opts.sid,'private-existing');assert.equal(send.files.length,1);assert.equal(send.files[0].name,'brief.pdf');assert.ok(send.text.startsWith('Why did this happen twice this morning?\n\nArchimedes'));check(`${shell}: close immediately, existing second-agent chat receives comment + kept PDF`,()=>{});
  // New private chat also carries the same explicit route, never the window focus/default route.
  await app.evaluate(()=>{window.result=WizardApp.share.wizard({text:'new private synthetic'});});await ready();await page.locator('.dv-agent').click();await page.getByRole('option',{name:'Synthetic Private',exact:true}).click();await ready();await page.locator('[data-sharesend]').click();await page.waitForFunction(()=>!WizShareWizard.busy);assert.equal(posts.filter(p=>p.kind==='send').at(-1).opts.agent,'synthetic-private');assert.equal(posts.filter(p=>p.kind==='send').at(-1).opts.sid,'__new__');check(`${shell}: new private chat carries agent id`,()=>{});
  // Native-queue callback is SIMULATED. Actual Android service/emulator proof is a separate required gate.
  await page.evaluate(()=>{window.queueResult=WizShareWizard.open({android:true,from:'Synthetic PDF sender',text:'Emailing x.pdf',items:[{n:0,name:'x.pdf',bytes:313000,mime:'application/pdf',read(){throw Error('native bytes must stay native');}},{n:1,name:'remove.pdf',bytes:10,mime:'application/pdf',read(){throw Error('native bytes must stay native');}}],nativeQueue:job=>fetch('/api/native-queue',{method:'POST',body:JSON.stringify(job)}).then(r=>r.json())});});await ready();await page.locator('.dv-text').fill('Synthetic phone comment');await page.locator('.dv-agent').click();await page.getByRole('option',{name:'Synthetic Private',exact:true}).click();await ready();await page.locator('.ch-att').nth(1).getByRole('button',{name:'Remove',exact:true}).click();await page.locator('[data-sharesend]').click();await page.locator('.wz-share').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>WizShareWizard.busy),true);await page.waitForFunction(()=>!WizShareWizard.busy);const q=posts.filter(p=>p.kind==='queue').at(-1);assert.deepEqual(q.keptItemIndexes,[0]);assert.equal(q.agent,'synthetic-private');assert.equal(q.note,'Synthetic phone comment');check(`${shell}: native callback carries agent/comment/indexes, closes before queue completes, no JS file read`,()=>{});
  // Keep the pre-unification batch guarantee: ten app attachments become one message, not ten sends.
  await app.evaluate(()=>{window.result=WizardApp.share.wizard({text:'ten files synthetic',files:Array.from({length:10},(_,n)=>new File(['bytes-'+n],'file-'+n+'.pdf',{type:'application/pdf'}))});});await ready();
  const batchStart=start();await page.locator('[data-sharesend]').click();await page.waitForFunction(()=>!WizShareWizard.busy);
  assert.equal(posts.slice(batchStart).filter(p=>p.kind==='upload').length,10);assert.equal(posts.slice(batchStart).filter(p=>p.kind==='send').length,1);assert.equal(posts.slice(batchStart).find(p=>p.kind==='send').files.length,10);check(`${shell}: ten app files remain one message`,()=>{});
  // A failed upload reopens with comment, agent and existing destination intact.
  await page.evaluate(()=>{const h=window.__wos||window.__wux;h.goodUpload=h.chats.uploadFile;h.chats.uploadFile=async()=>{throw Error('synthetic offline');};window.retryResult=WizShareWizard.open({agent:'synthetic-private',dest:'private-existing',text:'real quote',items:[{name:'retry.pdf',mime:'application/pdf',bytes:3,blob:new Blob(['pdf'])}]});});await ready();await page.locator('.dv-text').fill('Keep my note');await page.locator('[data-sharesend]').click();await page.locator('.dv-status',{hasText:'check the connection'}).waitFor();await ready();assert.equal(await page.locator('.dv-text').inputValue(),'Keep my note');assert.equal(await page.locator('.dv-agent strong').innerText(),'Synthetic Private');assert.equal(await page.locator('.dv-chat strong').innerText(),'Synthetic Private existing');await page.evaluate(()=>{const h=window.__wos||window.__wux;h.chats.uploadFile=h.goodUpload;});await page.locator('[data-sharesend]').click();await page.waitForFunction(()=>!WizShareWizard.busy);check(`${shell}: background failure retains comment/agent/chat for retry`,()=>{});
  // Missing thread listing cannot leave an old selected target from the previous agent.
  assert.deepEqual(errors,[]);check(`${shell}: no browser errors`,()=>{});await page.close();
 }
 fs.writeFileSync(path.join(evidence,'receipt.json'),JSON.stringify({passed:passed.length,checks:passed,posts,requests,actualAndroid:false},null,2));console.log(JSON.stringify({passed:passed.length,failed:0,evidence,actualAndroid:false}));
 }catch(e){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({passed:passed.length,checks:passed,error:String(e.stack)},null,2));throw e;}
 finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
