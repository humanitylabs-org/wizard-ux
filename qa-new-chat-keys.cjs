// Desktop new-chat shortcuts. Run on Thales; all writes intercepted.
const fs=require('fs'), path=require('path'), assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const BASE=process.argv[2]||'https://wizard.tailc0f369.ts.net/wizard-os-home/';
const ROOT=process.env.QA_WEB_DIR||__dirname, OUT=process.env.QA_OUT||path.join(__dirname,'key-evidence');
fs.mkdirSync(OUT,{recursive:true});let pass=0;const results=[];
function ok(c,n){assert(c,n);pass++;results.push(n);console.log('PASS',n);}
const nap=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const browser=await chromium.launch({...(process.env.QA_CHROME?{executablePath:process.env.QA_CHROME}:{}),args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 try{
 const ctx=await browser.newContext({viewport:{width:1450,height:900},ignoreHTTPSErrors:true,permissions:['microphone']});
 const writes=[],errors=[];let transcribeDelay=0;
 await ctx.route('**/*',async r=>{
  const q=r.request(),u=new URL(q.url());
  if(!['GET','HEAD'].includes(q.method())){
   writes.push({method:q.method(),path:u.pathname,body:q.postData()?.slice(0,4000)});
   const json=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
   if(/transcribe$/.test(u.pathname)){await nap(transcribeDelay);return json({text:'qa new voice chat words',ms:5});}
   if(/files\/upload$/.test(u.pathname))return json({file:{id:'drop_qa_voice_'+writes.length,filename:'voice.webm',mime:'audio/webm',bytes:4000}});
   if(/api\/sessions$/.test(u.pathname))return json({session:{id:'qa-new-'+writes.length}});
   if(/v1\/runs$/.test(u.pathname))return json({run_id:'qa-run-'+writes.length,status:'queued'});
   return json({});
  }
  if(u.pathname==='/qa-keys-frame/')return r.fulfill({contentType:'text/html',body:'<input id="inside" value="hosted draft">'});
  if(!process.env.QA_LIVE && u.pathname.startsWith('/wizard-os-home/')){
   const f=path.resolve(ROOT,'web',u.pathname.slice('/wizard-os-home/'.length)||'index.html');
   if(f.startsWith(path.resolve(ROOT,'web')+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({path:f});
  }
  return r.continue();
 });
 await ctx.addInitScript(()=>localStorage.setItem('wos.coached','true'));
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(BASE);await p.waitForFunction(()=>window.__wux?.live?.ok,null,{timeout:45000});
 await p.waitForFunction(()=>__wux.live.sessions.length>2);
 const url=p.url();
 const ids=await p.evaluate(()=>__wux.live.sessions.filter(s=>s.runtime!=='legacy').slice(0,2).map(s=>s.id));
 const sid=ids[0];
 await p.evaluate(sid=>__wux.openThread(sid),sid);
 await p.waitForFunction(sid=>Object.values(__wux.wins).some(w=>w.thread===sid),sid);
 await nap(1000);
 const oldWid=await p.evaluate(()=>__wux.ws[__wux.cur].focus);
 const oldTa=p.locator(`.win[data-win="${oldWid}"] .pane-main textarea`);
 await oldTa.fill('keep this reply draft');await oldTa.focus();
 const n0=await p.evaluate(()=>Object.keys(__wux.wins).length);
 await p.keyboard.press('Meta+n');await nap(200);
 ok(await p.evaluate(n=>Object.keys(__wux.wins).length===n+1&&__wux.wins[__wux.ws[__wux.cur].focus].thread==='__new__',n0),'Command-N opens a fresh New chat');
 ok(await p.evaluate(()=>document.activeElement?.tagName==='TEXTAREA'&&!!document.activeElement.closest('.pane-main')),'new-chat composer receives keyboard focus');
 ok(await p.evaluate(([wid,sid])=>__wux.wins[wid].thread===sid&&document.querySelector(`.win[data-win="${wid}"] textarea`).value==='keep this reply draft',[oldWid,sid]),'existing thread and unsent reply draft stay intact');
 const repeated=await p.evaluate(()=>{const n=Object.keys(__wux.wins).length;const e=new KeyboardEvent('keydown',{code:'KeyN',key:'n',metaKey:true,repeat:true,cancelable:true,bubbles:true});window.dispatchEvent(e);return e.defaultPrevented&&Object.keys(__wux.wins).length===n;});
 ok(repeated,'held Command-N is consumed without making duplicate windows');
 await p.keyboard.press('Meta+k');await p.keyboard.press('Meta+n');await nap(150);
 ok(!(await p.isVisible('#palette'))&&await p.evaluate(()=>__wux.wins[__wux.ws[__wux.cur].focus].thread==='__new__'),'new-chat shortcut also works while palette is open');
 await p.evaluate(()=>__wux.newWin({app:'frame',appId:'files',url:'/qa-keys-frame/'}));
 const fw=await p.evaluate(()=>__wux.ws[__wux.cur].focus);
 await p.frameLocator(`.win[data-win="${fw}"] iframe`).locator('#inside').focus();
 await p.keyboard.press('Meta+n');await nap(150);
 ok(await p.evaluate(()=>__wux.wins[__wux.ws[__wux.cur].focus].thread==='__new__'),'Command-N works from a hosted-app input');
 // Capture the exact outbox destination while still exercising its real persistence/delivery.
 await p.evaluate(()=>{window.__keyEnqueues=[];const send=__wux.outbox.enqueue.bind(__wux.outbox);__wux.outbox.enqueue=async x=>{__keyEnqueues.push({kind:x.kind,sid:x.sessionId||'',bytes:x.audio?.size||0,typed:x.typed||'',text:x.text||''});return send(x);};});
 await p.evaluate(([wid,sid])=>{__wux.focusWin(wid);__wux.chats.openChat(wid,sid);},[oldWid,sid]);await nap(250);
 await p.keyboard.press('Meta+Shift+n');await p.waitForFunction(()=>__wux.voice==='listen');await nap(1300);
 ok(await p.locator('#voiceText').textContent()==='Listening · new chat','new voice chord explicitly shows New chat with an existing thread open');
 ok(/⇧N/.test(await p.locator('#voiceKey').textContent()),'recording pill shows the send-again hotkey');
 await p.screenshot({path:path.join(OUT,'new-voice-chat.png')});
 await p.evaluate(sid=>__wux.openThread(sid),ids[1]);await nap(200);
 await p.keyboard.press('Meta+Shift+n');await p.waitForFunction(()=>__keyEnqueues.length===1);await nap(3000);
 const first=await p.evaluate(()=>__keyEnqueues[0]);
 ok(first.kind==='new'&&!first.sid&&first.bytes>1200,'new voice sends audio to a new thread even after switching focused threads');
 ok(!first.text&&!first.typed,'new voice does not steal text from an existing reply composer');
 ok(writes.some(w=>/api\/sessions$/.test(w.path)),'real durable outbox creates a new session (API intercepted)');
 ok(await p.evaluate(()=>__wux.voice==='idle'),'send-again stops recording');
 // Existing tap-to-reply and its destination survive the new chord.
 await p.evaluate(([wid,sid])=>{__wux.focusWin(wid);__wux.chats.openChat(wid,sid);},[oldWid,sid]);await nap(500);
 await p.keyboard.press('MetaRight');await p.waitForFunction(()=>__wux.voice==='listen');await nap(1300);
 await p.keyboard.press('Meta+Shift+n');await nap(120);
 ok(await p.evaluate(()=>__wux.voice==='listen'&&__keyEnqueues.length===1),'new-voice chord preserves an already-running reply recording');
 await p.keyboard.press('MetaRight');await p.waitForFunction(()=>__keyEnqueues.length===2);
 const reply=await p.evaluate(()=>__keyEnqueues[1]);
 ok(reply.kind==='reply'&&reply.sid===sid&&reply.bytes>1200,'Right Command still sends a reply to the existing thread');
 // Autorepeat must never send a new-voice take.
 await p.keyboard.press('Meta+Shift+n');await p.waitForFunction(()=>__wux.voice==='listen');await nap(600);
 await p.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyN',key:'N',metaKey:true,shiftKey:true,repeat:true,cancelable:true,bubbles:true})));
 ok(await p.evaluate(()=>__wux.voice==='listen'&&__keyEnqueues.length===2),'held new-voice key does not accidentally send');
 await p.click('#voiceCancel');await p.waitForFunction(()=>__wux.voice==='idle');
 ok(await p.evaluate(()=>__keyEnqueues.length===2),'Cancel discards new-voice take without creating a thread');
 // Browser-safe alias, and Windows/Linux chord.
 await p.keyboard.press('Alt+Shift+v');await p.waitForFunction(()=>__wux.voice==='listen');await nap(1300);
 ok(/⇧V/.test(await p.locator('#voiceKey').textContent()),'browser-safe new-voice alias shows its own send key');
 await p.keyboard.press('Alt+Shift+v');await p.waitForFunction(()=>__keyEnqueues.length===3);
 ok(await p.evaluate(()=>__keyEnqueues[2].kind==='new'&&!__keyEnqueues[2].sid&&__keyEnqueues[2].bytes>1200),'Option-Shift-V starts and sends new voice without browser-reserved chords');
 await p.keyboard.press('Control+Shift+n');await p.waitForFunction(()=>__wux.voice==='listen');
 ok(await p.locator('#voiceText').textContent()==='Listening · new chat','Control-Shift-N also starts a new-chat voice take');
 await p.click('#voiceCancel');await p.waitForFunction(()=>__wux.voice==='idle');
 await p.evaluate(()=>__wux.openPalette('Dictate'));await p.locator('#palList .pal-it').filter({has:p.locator('.nm',{hasText:/^Dictate$/})}).click();await p.waitForFunction(()=>__wux.voice==='listen');await nap(1300);
 await p.keyboard.press('Meta+Shift+n');
 ok(await p.evaluate(()=>__wux.voice==='listen'&&document.querySelector('#voicePill').classList.contains('dict')&&__keyEnqueues.length===3),'new-voice chord preserves active dictation');
 transcribeDelay=1200;
 await p.evaluate(()=>__wux.openPalette('Dictate'));await p.locator('#palList .pal-it').filter({has:p.locator('.nm',{hasText:/^Dictate$/})}).click();await p.waitForFunction(()=>__wux.voice==='think');
 await p.keyboard.press('Alt+Shift+v');
 ok(await p.evaluate(()=>__wux.voice==='think'&&__keyEnqueues.length===3),'new-voice chord preserves dictation while transcription is pending');
 await p.waitForFunction(()=>__wux.voice==='idle');transcribeDelay=0;
 await p.keyboard.press('Alt+Enter');await nap(150);
 ok(await p.evaluate(()=>__wux.wins[__wux.ws[__wux.cur].focus].thread==='__new__'),'browser-safe Option-Enter opens New chat');
 // A plain Control-N also supports the non-Mac desktop shell.
 await p.keyboard.press('Control+n');await nap(150);
 ok(await p.evaluate(()=>__wux.wins[__wux.ws[__wux.cur].focus].thread==='__new__'),'Control-N alternative opens New chat');
 await p.keyboard.press('Alt+/');
 ok(/New voice chat/.test(await p.locator('#keysBody').textContent()),'keyboard help exposes both new-chat shortcuts');
 await p.keyboard.press('Escape');await p.goBack();await nap(150);
 ok(!p.isClosed()&&p.url()===url,'Back from New chat keeps Wizard open');
 ok(errors.length===0,'no page errors: '+errors.join(' | '));
 fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({pass,results,writes,errors,url,source:ROOT},null,2));console.log(`${pass} passed`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
