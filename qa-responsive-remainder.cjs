/* Bounded both-shell browser acceptance on the isolated origin from custody-callers.
 * Synthetic microphone/STT/upload/capture capabilities are fixtures, never production writes. */
const path=require('path');
module.exports=async({boot,ok,sleep,sid,model,provider,out})=>{
 for(const desktop of [false,true]){
  const f=await boot(desktop),p=f.p,label=desktop?'desktop':'phone';if(!desktop)await p.setViewportSize({width:360,height:800});
  if(!desktop)await p.setViewportSize({width:360,height:800});
  // Registered once: Settings discovery, deeplink and actual shared mount/actions in each shell.
  await p.evaluate(()=>{
   window.__sharedRan=[];
   WosFeatures.register({id:'parity-future',title:'Future registered view',mount(root){root.innerHTML='<button id="future-action">Future action</button>';root.querySelector('button').onclick=()=>__sharedRan.push('action');}});
   WosFeatures.register({id:'parity-action',title:'Future registered action',run(){__sharedRan.push('registered-action');}});
   (window.__wux||window.__wos).openSettings();
  });
  ok(await p.locator('.st-shortcuts,[data-feature-open],[data-st-shortcut]').count()===0,`${label}: Settings lists no launcher shortcuts (James, 25 Oct 2026)`);
  await p.evaluate(()=>{WosFeatures.open('parity-action');WosFeatures.open('parity-future');});
  await p.locator('#future-action').click();
  ok(await p.evaluate(()=>__sharedRan.join(',')==='registered-action,action'),`${label}: registered action and view execute through shared registry`);
  ok(await p.evaluate(()=>WizCore.deeplink.parse('?view=parity-future').view==='parity-future'),`${label}: future view automatically deep-links`);
  await p.evaluate(()=>WosFeatures.open('command'));
  const input=p.locator('.shared-command input').last();await input.fill('a completely unknown explicit command');await input.press('Enter');
  ok(await p.locator('.shared-command [role=status]').last().textContent().then(x=>x.includes('Nothing sent')),`${label}: explicit command miss never agent-sends`);
  ok(!f.state.posts.length,`${label}: command miss has zero fixture mutations`);
  for(const text of ['show this week','open maps','help']){
   const parsed=await p.evaluate(text=>{
    const C=WizCore.apps('desktop');const P=WosCommands.create({CHATS:{matchFilters:()=>[]},APP:C.APP,appByName:C.appByName,findApp:C.findApp,quickSearch:C.quickSearch,sendSnap:()=>({})});return P.parse(text,{},'command');
   },text);ok(!!parsed,`${label}: shared grammar recognizes ${text}`,parsed);
  }
  for(const level of ['day','week','month']){
   await p.evaluate(level=>WizCore.deeplink.route('?view='+level),level);
   await p.waitForSelector('.review .summary');
   ok(await p.locator('.review .summary').count()>0,`${label}: ${level} review mounted through actual shell`);
  }
  await p.screenshot({path:path.join(out,label+'-review.png')});
  await p.evaluate(()=>WosFeatures.open('maps'));
  const form=p.locator('.map-query').last();await form.locator('input').fill('Bangkok');await form.locator('[value=dir]').click();
  ok(await p.locator('a[href*="google.com/maps/dir/"]').last().getAttribute('href').then(x=>x.includes('Bangkok')),`${label}: local Maps search and directions preserve destination`);
  await p.screenshot({path:path.join(out,label+'-maps.png')});
  await p.evaluate(()=>history.back());await sleep(500);
  ok(await p.evaluate(()=>!!(window.__wux||window.__wos))&&p.url().includes('wizard-os-home'),`${label}: nested Back keeps app open`);
  // Browser selection actions use the same menu on both shells.
  await p.evaluate(()=>{const el=document.createElement('div');el.className='msg a';el.innerHTML='<div class="bub" style="user-select:text;-webkit-user-select:text">Selected fixture words</div>';el.style.cssText='position:fixed;top:220px;left:10px;z-index:900;width:240px;background:#222';document.body.append(el);const r=document.createRange();r.selectNodeContents(el.querySelector('.bub'));getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));});await sleep(180);
  ok(await p.evaluate(()=>WosSelMenu.state.open&&WosSelMenu.state.items.includes('copy')),`${label}: selected text common actions reachable without native bridge`,await p.evaluate(()=>({state:WosSelMenu.state,selection:String(getSelection())})));
  await p.evaluate(()=>WosSelMenu.back());
  // Bound feedback fixture deliberately focuses a different thread before finishing.
  const bound=await p.evaluate(async({sid,model,provider})=>{const calls=[];const take=Object.freeze({thread:sid,url:'https://fixture.invalid/review',route:Object.freeze({model,provider,agent:'private-fixture'})});await WosBoundView.feedback({enqueue:async o=>{calls.push(o);return o;}},take,'Original feedback',new Blob(['audio']),[{id:'photo'}]);return calls[0];},{sid,model,provider});
  ok(bound.sessionId===sid&&bound.model===model&&bound.agent==='private-fixture'&&bound.files[0].id==='photo',`${label}: shared bound feedback preserves original thread, private route and files`);
  await f.done(label+' views and actions');
 }
 // Supported install capability is conditional, and activation is a real button click (prompt itself fixture).
 for(const desktop of [false,true]){
  const f=await boot(desktop),p=f.p,label=desktop?'desktop':'phone';if(!desktop)await p.setViewportSize({width:360,height:800});
  ok(await p.locator('#wizard-pwa-install').count()===0,`${label}: no install offer without browser capability`);
  await p.evaluate(()=>{window.__prompts=0;const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=async()=>{__prompts++;};e.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(e);});
  await p.locator('#wizard-pwa-install').locator('button.action').click();
  ok(await p.evaluate(()=>__prompts===1&&!document.getElementById('wizard-pwa-install')),`${label}: supported install prompt runs only on activation`);
  // Shared command drawer operates on the origin list, not its own new window.
  await p.evaluate(({desktop,wid})=>{const H=desktop?__wux:__wos;H.chats.chatsBack(H.wins[wid]);H.focusWin(wid);WosFeatures.open('command');},{desktop,wid:f.wid});
  await p.locator('.shared-command input').fill('search custody');await p.locator('.shared-command input').press('Enter');
  ok(await p.evaluate(({desktop,wid})=>(desktop?__wux:__wos).chats.ch(wid).q==='custody',{desktop,wid:f.wid}),`${label}: common search command targets originating chat list`);
  await f.done(label+' install and local search');
 }
 // Auto-bound page and actual recording caller must keep the original thread through navigation.
 for(const desktop of [false,true]){
  const f=await boot(desktop),p=f.p,label=desktop?'desktop':'phone';if(!desktop)await p.setViewportSize({width:360,height:800});
  await f.ctx.route('**/api/sessions/**',r=>r.request().method()==='GET'?r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({session:{id:sid,title:'Bound original',status:'completed',model,provider},messages:[{role:'user',content:'Review this'},{role:'assistant',content:'[View the report](/qa-bound-report/)'}]})}):r.fallback());
  await f.ctx.route('**/qa-bound-report/',r=>r.fulfill({status:200,contentType:'text/html',body:'<h1>Bound report fixture</h1><p>Feedback remains attached to its original thread.</p>'}));
  await p.reload();await p.waitForFunction(desktop=>Object.values((desktop?__wux:__wos).wins).some(w=>w.bound),desktop);
  const b=await p.evaluate(desktop=>Object.values((desktop?__wux:__wos).wins).find(w=>w.bound),desktop);
  ok(b.from.sid===sid&&b.url==='/qa-bound-report/',`${label}: latest thread reply creates real bound iframe`,b);
  await p.evaluate(({desktop,id})=>(desktop?__wux:__wos).focusWin(id),{desktop,id:b.id});
  await p.evaluate(desktop=>desktop?__wux.talk('start'):__wos.startVoice('auto'),desktop);await sleep(1100);
  await p.evaluate(()=>WosFeatures.open('maps'));await p.evaluate(desktop=>desktop?__wux.talk('send'):__wos.finishVoice(),desktop);await sleep(600);
  const row=(await f.rows()).find(x=>x.blob&&x.kind==='reply');
  ok(row?.sessionId===sid&&row.model===model,`${label}: actual bound feedback after focus change replies to original thread`,row);
  await f.done(label+' bound caller');
 }
 // Actual recorder controls, common screenshot adapter and actual upload route on BOTH shells.
 for(const desktop of [false,true]){
  const f=await boot(desktop),p=f.p,label=desktop?'desktop':'phone';if(!desktop)await p.setViewportSize({width:360,height:800});
  await f.ctx.route('**/wizard/files/upload',async route=>{const req=route.request();if(req.headers()['x-wizard-mime']!=='image/png')return route.fallback();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({file:{id:'screenshot-fixture',filename:req.headers()['x-wizard-filename'],mime:'image/png',bytes:req.postDataBuffer()?.length||0}})});});
  await p.evaluate(()=>{window.__capturePending=null;window.wizardScreenPort={postMessage(id){if(id.startsWith('cancel:'))return;window.__capturePending=id;}};});
  await p.locator(`[data-chats="${f.wid}"] .ch-mic`).click();
  await sleep(1100);await p.locator(desktop?'#voicePause':'#arcPause').click();
  ok(await p.evaluate(desktop=>desktop?__wux.voiceState==='paused':__wos.voice==='paused',desktop),`${label}: pause actual capture`);
  await p.screenshot({path:path.join(out,label+'-paused-controls.png')});
  ok(await p.evaluate(()=>WosCaptureTools.awakeWanted),`${label}: capture requests shared screen-awake state`);
  await p.locator(desktop?'#voicePause':'#arcPause').click();
  ok(await p.evaluate(desktop=>desktop?__wux.voiceState==='listen':__wos.voice==='listen',desktop),`${label}: resume actual capture`);
  if(desktop)await p.locator('#voiceScreenshot').evaluate(e=>e.hidden=false);
  await p.locator(desktop?'#voiceScreenshot':'#arcScreen').click();await p.waitForFunction(()=>!!__capturePending);
  const busy=await p.evaluate(desktop=>desktop?__wux.talk('send'):(__wos.finishVoice(),'busy'),desktop);
  ok(busy==='busy',`${label}: screenshot reserves take before chooser/upload resolves`);
  await p.evaluate(()=>__wosScreenResult(__capturePending,'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZFkAAAAASUVORK5CYII=',''));
  await sleep(250);await p.evaluate(desktop=>desktop?__wux.openMaps('search','different focus'):WosFeatures.open('maps'),desktop);
  await p.evaluate(desktop=>desktop?__wux.talk('send'):__wos.finishVoice(),desktop);await sleep(700);
  const rows=await f.rows();const row=rows.find(x=>x.files?.some(f=>f.id==='screenshot-fixture'));
  ok(row?.sessionId===sid&&row.model===model&&row.blob>0,`${label}: screenshot/audio sent as one take to recording-start destination`,row);
  ok(await p.evaluate(()=>!WosCaptureTools.awakeWanted),`${label}: wake request released after finish`);
  await f.done(label+' capture controls');
 }
 // Failed attachment upload retains original File and take; actual Retry uses those bytes.
 for(const desktop of [false,true]){
  const f=await boot(desktop),p=f.p,label=desktop?'desktop':'phone';if(!desktop)await p.setViewportSize({width:360,height:800});let attempts=0;
  await f.ctx.route('**/wizard/files/upload',r=>{if(r.request().headers()['x-wizard-mime']!=='text/plain')return r.fallback();attempts++;return r.fulfill({status:attempts===1?503:200,contentType:'application/json',body:JSON.stringify(attempts===1?{error:'Fixture upload unavailable'}:{file:{id:'retried-fixture',filename:'kept.txt',mime:'text/plain',bytes:r.request().postDataBuffer()?.length||0}})});});
  await p.locator(`[data-chats="${f.wid}"] .ch-mic`).click();await sleep(1100);
  await p.locator(desktop?'#voiceFileInput':'[data-voice-files]').setInputFiles({name:'kept.txt',mimeType:'text/plain',buffer:Buffer.from('Original file bytes')});await sleep(180);
  await p.evaluate(desktop=>desktop?__wux.talk('send'):__wos.finishVoice(),desktop);
  ok(await p.evaluate(desktop=>['listen','paused'].includes((desktop?__wux:__wos).voice),desktop),`${label}: failed upload cannot discard or finish the take`);
  await p.locator(desktop?'[data-vretry]':'#arcAttach').click();await sleep(220);
  await p.evaluate(desktop=>desktop?__wux.talk('send'):__wos.finishVoice(),desktop);await sleep(500);
  ok(attempts===2&&(await f.rows()).some(x=>x.blob&&x.files?.some(file=>file.id==='retried-fixture')),`${label}: failed upload retry preserves original attachment/audio`,{attempts,rows:await f.rows()});
  await f.done(label+' upload failure');
 }
 // Desktop browser focused-field seals: cursor retained, changed/replaced field never receives late STT.
 for(const desktop of [false,true])for(const stale of [false,true]){
  const f=await boot(desktop),p=f.p,label=desktop?'desktop':'phone';if(!desktop)await p.setViewportSize({width:360,height:800});f.state.sttDelay=300;
  await p.evaluate(()=>{const el=document.createElement('textarea');el.id='dictation-target';el.value='before AFTER';el.style.cssText='position:fixed;top:200px;left:20px;z-index:1000';document.body.append(el);el.focus();el.setSelectionRange(7,12);});
  await p.locator(desktop?'#dictateBtn':'#orbWrap').click();await sleep(1100);
  if(stale)await p.locator('#dictation-target').fill('Changed while recording');
  await p.evaluate(desktop=>desktop?__wux.dictate():__wos.finishVoice(),desktop);await p.waitForFunction(desktop=>(desktop?__wux:__wos).voice==='idle',desktop);await sleep(100);
  const val=await p.locator('#dictation-target').inputValue();
  ok(stale?val==='Changed while recording':val==='before spoken original words',`${label}: ${stale?'stale focused field preserved':'dictation replaces captured cursor range'}`,val);
  ok(!f.state.posts.length,`${label}: ${stale?'stale':'cursor'} dictation cannot send to agent`);await f.done(label+' focused dictation');
 }
 // Normal desktop global talk recognizes an unambiguous local command; no backend message.
 {const f=await boot(true);f.state.text='show this week';await f.p.evaluate(()=>__wux.talk('start'));await sleep(1100);const result=await f.p.evaluate(()=>__wux.talk('send'));ok(result==='local'&&!f.state.posts.length,'desktop: normal global talk dispatches local commands instead of agent-send');ok(await f.p.locator('.review').count()>0,'desktop: normal voice opens actual shared review');await f.done('desktop automatic local command');}
 // Current model changes while recording cannot change the sealed route.
 {const f=await boot(true);await f.p.locator(`[data-chats="${f.wid}"] .ch-mic`).click();await sleep(1100);await f.p.evaluate(()=>{WosModels.snapshot=()=>({model:'replacement-model',provider:'replacement-provider'});});await f.p.evaluate(()=>__wux.talk('send'));await sleep(250);ok((await f.rows()).some(x=>x.blob&&x.model===model&&x.provider===provider),'desktop: recorder START pins model/provider against later edits');await f.done('desktop model pin');}
 // Fine-pointer narrow desktop does not hide browser recording controls behind the toolbar.
 {const f=await boot(true),p=f.p;await p.setViewportSize({width:360,height:800});await p.evaluate(()=>__wux.talk('start'));await sleep(1100);await p.locator('#voicePill').hover();await p.locator('#voicePause').click();
  const bounds=await p.locator('#voicePill').boundingBox(),tray=await p.locator('#voicePill .voice-tray').boundingBox();ok(bounds.x>=0&&bounds.x+bounds.width<=361&&bounds.y>=0&&bounds.y+bounds.height<=34&&tray.x>=0&&tray.x+tray.width<=361,'narrow desktop: compact capture pill sits inside the top bar and its controls fit 360px');
  const bar=await p.locator('#voicePill').boundingBox(),stage=await p.locator('#stage').boundingBox();ok(stage.y===34&&stage.y>=bar.y+bar.height,'narrow desktop: capture neither covers nor pushes the window');ok(await p.evaluate(()=>document.documentElement.classList.contains('voice-on')&&getComputedStyle(document.getElementById('voiceGlow')).pointerEvents==='none'),'narrow desktop: edge glow is on and click-through');const compose=await p.locator(`[data-chats="${f.wid}"] .ch-compose`).boundingBox();ok(compose&&compose.y+compose.height<=800,'narrow desktop: composer remains in viewport during capture');
  await p.locator('[data-wact="mono"]').click();await sleep(220);const full=await p.locator('#voicePill').boundingBox();ok(full.x>=0&&full.y>=0&&full.x+full.width<=360,'narrow desktop: fullscreen retains all capture controls');await p.evaluate(()=>__wux.localCommand('exit fullscreen'));await sleep(220);
  await p.screenshot({path:path.join(out,'desktop-360-capture.png')});await p.evaluate(()=>__wux.talk('cancel'));await p.evaluate(()=>__wux.goHome());await p.evaluate(()=>history.back());await sleep(100);ok(p.url().includes('wizard-os-home')&&await p.evaluate(()=>!!__wux),'narrow desktop: root Back keeps app');await f.done('narrow desktop');}
 // Explicit spoken command miss retains audio; it does not use /route or /send.
 {const f=await boot(true);f.state.text='utterly unknown command';await f.p.evaluate(()=>__wux.commandVoice());await sleep(1100);await f.p.evaluate(()=>__wux.commandVoice());ok(!f.state.posts.length,'desktop: spoken command miss cannot send a message');ok((await f.rows()).some(x=>x.kind==='dictation'&&x.state==='held'&&x.blob),'desktop: spoken command miss retains transcript/audio');await f.done('desktop spoken command');}
};
