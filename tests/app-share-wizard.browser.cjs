/* Disposable browser proof. Uses the real installed-frame bridge + share sheet; Chats adapter
 * uploads/sends to a loopback test server only, never an owner's agent. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),ev=process.env.EVIDENCE_DIR||path.resolve(root,'.evidence/share-wizard');fs.mkdirSync(ev,{recursive:true});
const posts=[];
const server=http.createServer(async(req,res)=>{
 const p=new URL(req.url,'http://localhost').pathname;
 if(req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);if(p==='/api/uploads'){posts.push({kind:'upload',bytes:body.length});res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({id:'f'+posts.length,name:req.headers['x-name'],mime:req.headers['content-type'],bytes:body.length}));}if(p==='/api/chat'){posts.push({kind:'send',...JSON.parse(body)});return res.end(JSON.stringify({durable:true,id:'test-send'}));}}
 if(p==='/messenger/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<script src="/core/app-client.js"></script><p>Disposable Messenger test frame</p>');}
 if(p==='/wizard-os-home/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/core/share-wizard.css"><style>body{margin:0;font:15px system-ui;background:var(--wz-canvas);color:var(--wz-text)}:root{--wz-canvas:#131c20;--wz-surface:#21303b;--wz-surface-raised:#2c3b48;--wz-text:#e6f1f6;--wz-text-secondary:#a2b2bf;--wz-text-muted:#8193a3;--wz-accent:#89b4fa;--wz-accent-soft:#283950;--wz-on-accent:#101c30;--wz-border:#435363}iframe{width:100%;height:100vh;border:0}</style></head><body><script>window.WizCore={apps:()=>({APPS:[{id:'messenger',kind:'wizard',url:'/messenger/'}]})};</script><script src="/core/share-wizard.js"></script><script src="/core/app-services.js"></script><iframe id="app" src="/messenger/"></iframe><script>WizAppServices.attach(document.querySelector('iframe'),{appId:'messenger',path:'/messenger/',isVisible:()=>true});</script></body></html>`);}
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
 await page.getByRole('dialog',{name:'Share to Wizard'}).waitFor();assert.equal(await page.locator('.dv-item').count(),10);assert.equal(await page.locator('.dv-thread').count(),6);
 assert.equal(await page.locator('.dv-text').inputValue(),'Miguel (19:24): The words and transcript');
 if(shell==='desktop')await page.evaluate(()=>{const s=document.documentElement.style;for(const [k,v]of Object.entries({'--wz-canvas':'#f2e6d3','--wz-surface':'#fff6e8','--wz-surface-raised':'#ead8bd','--wz-text':'#342c25','--wz-text-secondary':'#66594b','--wz-text-muted':'#807465','--wz-accent':'#b87524','--wz-on-accent':'#fff8e8','--wz-border':'#b8a58d'}))s.setProperty(k,v);});
 await page.screenshot({path:ev+`/share-${shell}.png`});const start=posts.length;
 await page.locator('.dv-text').fill('My note\n\nMiguel (19:24): The words and transcript');
 await page.getByRole('button',{name:'Send to a new chat',exact:true}).dblclick();await page.locator('.wz-share').waitFor({state:'hidden'});
 assert.equal(await app.evaluate(()=>window.result),'sent');const sent=posts.slice(start).filter(p=>p.kind==='send');assert.equal(sent.length,1);assert.equal(sent[0].files.length,10);assert.match(sent[0].text,/My note/);assert.equal(sent[0].opts.seal,false);assert.equal(sent[0].opts.away,true);
 // App forwards leave the owner where they were: the temporary Chats window closes and Messenger keeps focus.
 assert.deepEqual(await page.evaluate(()=>[Object.keys(__nav.length&&(window.__wos||window.__wux).wins),(window.__wos||window.__wux).desks[0].focus,__nav]),[['m'],'m',['open:__new__','close:w1','focus:m']]);
 // With a main Chats window already open, the send rides on it and nothing navigates at all.
 await page.evaluate(()=>{const h=window.__wos||window.__wux;h.wins.c={app:'chats',thread:'s3'};__nav.length=0;});
 await app.evaluate(()=>{window.result=WizardApp.share.wizard({files:[],text:'Second forward'});});await page.locator('.wz-share').waitFor();
 await page.getByRole('button',{name:'Recent chat 1',exact:true}).click();await page.locator('.wz-share').waitFor({state:'hidden'});
 assert.equal(await app.evaluate(()=>window.result),'sent');assert.deepEqual(await page.evaluate(()=>__nav),[],'no navigation');
 { const last=posts.filter(p=>p.kind==='send').at(-1); assert.equal(last.wid,'c'); assert.equal(last.opts.sid,'s1'); }
 await page.evaluate(()=>{delete (window.__wos||window.__wux).wins.c;});
 await app.evaluate(()=>{window.result=WizardApp.share.wizard({files:[],text:'Cancel me'});});await page.locator('.wz-share').waitFor();
 await page.evaluate(()=>WizShareWizard.back());assert.equal(await app.evaluate(()=>window.result),'cancelled');
 assert.equal(posts.slice(start).filter(p=>p.kind==='send').length,2);
 await page.close();}
 fs.writeFileSync(ev+'/receipt.json',JSON.stringify({shells:['phone','desktop'],posts},null,2));console.log('pass: 2 shells; real installed-frame share.wizard → shared sheet; 10 uploads → 1 message; no DEV; two skins; Cancel/Back');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
