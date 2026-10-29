/* Disposable browser proof. Uses the real installed-frame bridge + share sheet; Chats adapter
 * uploads/sends to a loopback test server only, never an owner's agent. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),ev=process.env.EVIDENCE_DIR||path.resolve(root,'.evidence/share-wizard');fs.mkdirSync(ev,{recursive:true});
const posts=[];
const server=http.createServer(async(req,res)=>{
 const p=new URL(req.url,'http://localhost').pathname;
 if(req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);if(p==='/api/uploads'){await new Promise(r=>setTimeout(r,400));posts.push({kind:'upload',bytes:body.length});res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({id:'f'+posts.length,name:req.headers['x-name'],mime:req.headers['content-type'],bytes:body.length}));}if(p==='/api/chat'){posts.push({kind:'send',...JSON.parse(body)});return res.end(JSON.stringify({durable:true,id:'test-send'}));}}
 if(p==='/messenger/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<script src="/core/app-client.js"></script><p>Disposable Messenger test frame</p>');}
 if(p==='/wizard-os-home/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/core/attach-chip.css"><link rel="stylesheet" href="/core/share-wizard.css"><script src="/core/attach-chip.js"></script><style>body{margin:0;font:15px system-ui;background:var(--wz-canvas);color:var(--wz-text)}:root{--wz-canvas:#131c20;--wz-surface:#21303b;--wz-surface-raised:#2c3b48;--wz-text:#e6f1f6;--wz-text-secondary:#a2b2bf;--wz-text-muted:#8193a3;--wz-accent:#89b4fa;--wz-accent-soft:#283950;--wz-on-accent:#101c30;--wz-border:#435363}iframe{width:100%;height:100vh;border:0}</style></head><body><script>window.WizCore={apps:()=>({APPS:[{id:'messenger',kind:'wizard',url:'/messenger/'}]})};</script><script src="/core/share-wizard.js"></script><script src="/core/app-services.js"></script><iframe id="app" src="/messenger/"></iframe><script>WizAppServices.attach(document.querySelector('iframe'),{appId:'messenger',path:'/messenger/',isVisible:()=>true});</script></body></html>`);}
 const file=path.join(root,'web',p);if(file.startsWith(path.join(root,'web'))&&fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/css');return res.end(fs.readFileSync(file));}res.statusCode=404;res.end();
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{for(const shell of ['phone','desktop']){
 const page=await browser.newPage({viewport:shell==='phone'?{width:412,height:892}:{width:1100,height:850},isMobile:shell==='phone',hasTouch:shell==='phone'});
 await page.goto(`http://127.0.0.1:${server.address().port}/wizard-os-home/`);await page.frameLocator('#app').locator('p').waitFor();
 await page.evaluate(shell=>{
  const wins={};const host={wins,live:{sessions:Array.from({length:9},(_,n)=>({id:'s'+n,title:'Recent chat '+n}))},chats:{
   async uploadFile(f){return fetch('/api/uploads',{method:'POST',headers:{'Content-Type':f.type,'X-Name':f.name},body:f}).then(r=>r.json());},
   async sendChat(wid,text,how,audio,opts){return fetch('/api/chat',{method:'POST',body:JSON.stringify({wid,text,files:opts.files,opts})}).then(r=>r.json());}
  }};
  wins.m={app:'messenger'};const nav=window.__nav=[];Object.assign(host,{idx:0,desks:[{focus:'m'}],goDesk:n=>nav.push('desk:'+n),focusWin:id=>{nav.push('focus:'+id);host.desks[0].focus=id;},closeWin:id=>{nav.push('close:'+id);delete wins[id];}});
  host.openWizardThread=host.openThread=sid=>{nav.push('open:'+sid);wins.w1={app:'chats',thread:sid};host.desks[0].focus='w1';};
  window[shell==='phone'?'__wos':'__wux']=host;
 },shell);
 // One call from the installed app, not from the top page. No native DEV() exists on either fixture.
 const app=page.frames().find(f=>f.url().endsWith('/messenger/'));
 await app.evaluate(async()=>{const c=document.createElement('canvas');c.width=c.height=80;const ctx=c.getContext('2d');ctx.fillStyle='#2c6bed';ctx.fillRect(0,0,80,80);ctx.fillStyle='white';ctx.font='40px sans-serif';ctx.fillText('M',22,56);const image=await new Promise(r=>c.toBlob(r));window.result=WizardApp.share.wizard({files:Array.from({length:10},(_,n)=>new File([n===0?'synthetic voice':image],n===0?'Miguel voice note.ogg':`photo-${n}.png`,{type:n===0?'audio/ogg':'image/png'})),text:'Miguel (19:24): The words and transcript',title:'Forwarded from Messenger'});});
 await page.getByRole('dialog',{name:'Share to Wizard'}).waitFor();assert.equal(await page.locator('.dv-items .ch-att').count(),10);assert.equal(await page.locator('.dv-chat option').count(),10,'every recent chat in one dropdown + its placeholder');
 // Forwarded words sit in a read-only quote; the comment box starts empty (James, 27 Oct 2026).
 assert.equal(await page.locator('.dv-quote').innerText(),'Miguel (19:24): The words and transcript');assert.equal(await page.locator('.dv-quote').evaluate(e=>e.isContentEditable),false);
 assert.equal(await page.locator('.dv-text').inputValue(),'');assert.equal(await page.getByRole('radio',{name:'New chat'}).isChecked(),true);
 if(shell==='desktop')await page.evaluate(()=>{const s=document.documentElement.style;for(const [k,v]of Object.entries({'--wz-canvas':'#f2e6d3','--wz-surface':'#fff6e8','--wz-surface-raised':'#ead8bd','--wz-text':'#342c25','--wz-text-secondary':'#66594b','--wz-text-muted':'#807465','--wz-accent':'#b87524','--wz-on-accent':'#fff8e8','--wz-border':'#b8a58d'}))s.setProperty(k,v);});
 await page.screenshot({path:ev+`/share-${shell}.png`});const start=posts.length;
 await page.locator('.dv-text').fill('My note');
 // Remove drops one item before sending.
 await page.locator('.dv-items .ch-att').nth(9).getByRole('button',{name:'Remove'}).click();assert.equal(await page.locator('.dv-items .ch-att').count(),9);
 // Send closes the sheet at once; ten slow uploads carry on in the background.
 const t0=Date.now();await page.getByRole('button',{name:'Send',exact:true}).dblclick();await page.locator('.wz-share').waitFor({state:'hidden',timeout:1000});
 assert.ok(Date.now()-t0<1000,'sheet closes immediately');assert.equal(await app.evaluate(()=>window.result),'sent');assert.equal(await page.evaluate(()=>WizShareWizard.busy),true,'still sending in the background');
 await page.waitForFunction(()=>!WizShareWizard.busy,null,{timeout:15000});const sent=posts.slice(start).filter(p=>p.kind==='send');assert.equal(sent.length,1);assert.equal(sent[0].files.length,9);assert.equal(sent[0].text,'My note\n\nMiguel (19:24): The words and transcript');assert.equal(sent[0].opts.seal,false);assert.equal(sent[0].opts.away,true);
 // App forwards leave the owner where they were: the temporary Chats window closes and Messenger keeps focus.
 assert.deepEqual(await page.evaluate(()=>[Object.keys(__nav.length&&(window.__wos||window.__wux).wins),(window.__wos||window.__wux).desks[0].focus,__nav]),[['m'],'m',['open:__new__','focus:m','close:w1']]);
 // With a main Chats window already open, the send rides on it and nothing navigates at all.
 await page.evaluate(()=>{const h=window.__wos||window.__wux;h.wins.c={app:'chats',thread:'s3'};__nav.length=0;});
 await app.evaluate(()=>{window.result=WizardApp.share.wizard({files:[],text:'Second forward'});});await page.locator('.wz-share').waitFor();
 // No chat picked yet: Send asks for one instead of guessing.
 await page.getByRole('radio',{name:'Existing chat'}).check();await page.getByRole('button',{name:'Send',exact:true}).click();assert.match(await page.locator('.dv-status').innerText(),/Choose a chat/);
 await page.locator('.dv-chat').selectOption({label:'Recent chat 1'});assert.equal(await page.getByRole('radio',{name:'Existing chat'}).isChecked(),true);
 await page.getByRole('radio',{name:'New chat'}).check();await page.locator('.dv-chat').selectOption({label:'Recent chat 1'});
 await page.getByRole('button',{name:'Send',exact:true}).click();await page.locator('.wz-share').waitFor({state:'hidden'});await page.waitForFunction(()=>!WizShareWizard.busy);
 assert.equal(await app.evaluate(()=>window.result),'sent');assert.deepEqual(await page.evaluate(()=>__nav),[],'no navigation');
 { const last=posts.filter(p=>p.kind==='send').at(-1); assert.equal(last.wid,'c'); assert.equal(last.opts.sid,'s1'); }
 // A failed background send brings the same share back, comment kept, so nothing is lost.
 await page.evaluate(()=>{const h=window.__wos||window.__wux;h.__up=h.chats.uploadFile;h.chats.uploadFile=async()=>{throw new Error('offline');};});
 await app.evaluate(async()=>{window.result=WizardApp.share.wizard({files:[new File(['x'],'a.txt',{type:'text/plain'})],text:'Quoted words'});});await page.locator('.wz-share').waitFor();
 await page.locator('.dv-text').fill('Keep me');await page.locator('.dv-chat').selectOption({label:'Recent chat 1'});await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.locator('.dv-status',{hasText:'check the connection'}).waitFor({timeout:5000});assert.equal(await page.locator('.dv-text').inputValue(),'Keep me');assert.equal(await page.locator('.dv-quote').innerText(),'Quoted words');assert.equal(await page.locator('.dv-items .ch-att').count(),1);
 assert.equal(await page.getByRole('radio',{name:'Existing chat'}).isChecked(),true,'retry keeps the chosen chat');assert.equal(await page.locator('.dv-chat option:checked').innerText(),'Recent chat 1');
 if(shell==='phone')await page.screenshot({path:ev+'/share-retry-phone.png'});
 await page.evaluate(()=>{const h=window.__wos||window.__wux;h.chats.uploadFile=h.__up;});await page.getByRole('button',{name:'Send',exact:true}).click();await page.locator('.wz-share').waitFor({state:'hidden'});await page.waitForFunction(()=>!WizShareWizard.busy);
 assert.equal(posts.filter(p=>p.kind==='send').at(-1).text,'Keep me\n\nQuoted words');
 await page.evaluate(()=>{delete (window.__wos||window.__wux).wins.c;});
 await app.evaluate(()=>{window.result=WizardApp.share.wizard({files:[],text:'Cancel me'});});await page.locator('.wz-share').waitFor();
 await page.evaluate(()=>WizShareWizard.back());assert.equal(await app.evaluate(()=>window.result),'cancelled');
 assert.equal(posts.slice(start).filter(p=>p.kind==='send').length,3);
 // Native shares (durable): the sheet still closes at once, but 'sent' waits for the receipt so device.js keeps the
 // staged copy (shareDone) until the message is saved; a failed send stays pending until the retry sheet settles.
 await page.evaluate(()=>{window.dres='pending';WizShareWizard.open({durable:true,text:'Native words',items:[{name:'n.txt',mime:'text/plain',bytes:1,blob:new Blob(['n'],{type:'text/plain'})}]}).then(r=>window.dres=r);});
 await page.getByRole('button',{name:'Send',exact:true}).click();await page.locator('.wz-share').waitFor({state:'hidden',timeout:1000});
 assert.equal(await page.evaluate(()=>window.dres),'pending','native share is not released while uploading');
 await page.waitForFunction(()=>!WizShareWizard.busy);assert.equal(await page.evaluate(()=>window.dres),'sent');
 await page.evaluate(()=>{const h=window.__wos||window.__wux;h.chats.uploadFile=async()=>{throw new Error('offline');};window.dres='pending';WizShareWizard.open({durable:true,text:'Native fail',items:[{name:'n.txt',mime:'text/plain',bytes:1,blob:new Blob(['n'],{type:'text/plain'})}]}).then(r=>window.dres=r);});
 await page.getByRole('button',{name:'Send',exact:true}).click();await page.locator('.dv-status',{hasText:'check the connection'}).waitFor({timeout:5000});
 assert.equal(await page.evaluate(()=>window.dres),'pending','failed native send keeps the staged copy');
 await page.evaluate(()=>{const h=window.__wos||window.__wux;h.chats.uploadFile=h.__up;WizShareWizard.back();});await page.waitForFunction(()=>window.dres==='cancelled');
 // Two overlapping deliveries never share one temporary Chats window (the first must not close it under the second).
 await page.evaluate(()=>{const h=window.__wos||window.__wux;h.__send=h.chats.sendChat;h.chats.sendChat=async(wid,...r)=>{await new Promise(x=>setTimeout(x,800));if(!h.wins[wid])throw new Error('window closed under send');return h.__send(wid,...r);};});
 const before2=posts.filter(p=>p.kind==='send').length;
 await page.evaluate(()=>{window.r1=WizShareWizard.open({text:'Overlap A',items:[{name:'a.txt',mime:'text/plain',bytes:1,blob:new Blob(['a'],{type:'text/plain'})}]});});
 await page.getByRole('button',{name:'Send',exact:true}).click();await page.locator('.wz-share').waitFor({state:'hidden'});
 await page.evaluate(()=>{window.r2=WizShareWizard.open({text:'Overlap B'});});await page.getByRole('button',{name:'Send',exact:true}).click();await page.locator('.wz-share').waitFor({state:'hidden'});
 await page.waitForFunction(()=>!WizShareWizard.busy||document.querySelector('.wz-share'),null,{timeout:10000});
 assert.equal(await page.locator('.wz-share').count(),0,'no retry sheet: both overlapping sends landed');
 assert.deepEqual(posts.filter(p=>p.kind==='send').slice(before2).map(p=>p.text).sort(),['Overlap A','Overlap B']);
 await page.evaluate(()=>{const h=window.__wos||window.__wux;h.chats.sendChat=h.__send;});
 await page.close();}
 fs.writeFileSync(ev+'/receipt.json',JSON.stringify({shells:['phone','desktop'],posts},null,2));console.log('pass: 2 shells; real installed-frame share.wizard → shared sheet; 10 uploads → 1 message; no DEV; two skins; Cancel/Back');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
