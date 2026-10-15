/* Bounded both-shell browser acceptance on the isolated origin from custody-callers.
 * Synthetic microphone/STT/upload/capture capabilities are fixtures, never production writes. */
const path=require('path');
module.exports=async({boot,ok,sleep,sid,model,provider,out})=>{
 for(const desktop of [false,true]){
  const f=await boot(desktop),p=f.p,label=desktop?'desktop':'phone';
  if(!desktop)await p.setViewportSize({width:360,height:800});
  // Registered once: Settings discovery, deeplink and actual shared mount/actions in each shell.
  await p.evaluate(()=>{
   window.__sharedRan=[];
   WosFeatures.register({id:'parity-future',title:'Future registered view',mount(root){root.innerHTML='<button id="future-action">Future action</button>';root.querySelector('button').onclick=()=>__sharedRan.push('action');}});
   WosFeatures.register({id:'parity-action',title:'Future registered action',run(){__sharedRan.push('registered-action');}});
   (window.__wux||window.__wos).openSettings();
  });
  ok(await p.locator('[data-feature-open="parity-future"]').count()===1,`${label}: new common view discoverable from Settings`);
  await p.locator('[data-feature-open="parity-action"]').click();
  await p.locator('[data-feature-open="parity-future"]').click();
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
 // Actual recorder controls, common screenshot adapter and actual upload route on BOTH shells.
 for(const desktop of [false,true]){
  const f=await boot(desktop),p=f.p,label=desktop?'desktop':'phone';
  await f.ctx.route('**/wizard/files/upload',async route=>{const req=route.request();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({file:{id:'screenshot-fixture',filename:req.headers()['x-wizard-filename'],mime:'image/png',bytes:req.postDataBuffer()?.length||0}})});});
  await p.evaluate(()=>{window.__capturePending=null;window.wizardScreenPort={postMessage(id){if(id.startsWith('cancel:'))return;window.__capturePending=id;}};});
  await p.locator(`[data-chats="${f.wid}"] .ch-mic`).click();
  await sleep(1100);await p.locator(desktop?'#voicePause':'#arcPause').click();
  ok(await p.evaluate(desktop=>desktop?__wux.voiceState==='paused':__wos.voice==='paused',desktop),`${label}: pause actual capture`);
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
 // Desktop browser focused-field seals: cursor retained, changed/replaced field never receives late STT.
 for(const stale of [false,true]){
  const f=await boot(true),p=f.p;f.state.sttDelay=300;
  await p.evaluate(()=>{const el=document.createElement('textarea');el.id='dictation-target';el.value='before AFTER';el.style.cssText='position:fixed;top:200px;left:20px;z-index:1000';document.body.append(el);el.focus();el.setSelectionRange(7,12);});
  await p.locator('#dictateBtn').click();await sleep(1100);
  if(stale)await p.locator('#dictation-target').fill('Changed while recording');
  await p.evaluate(()=>__wux.dictate());await sleep(100);
  const val=await p.locator('#dictation-target').inputValue();
  ok(stale?val==='Changed while recording':val==='before spoken original words',`desktop: ${stale?'stale focused field preserved':'dictation replaces captured cursor range'}`,val);
  ok(!f.state.posts.length,`desktop: ${stale?'stale':'cursor'} dictation cannot send to agent`);await f.done('desktop focused dictation');
 }
 // Explicit spoken command miss retains audio; it does not use /route or /send.
 {const f=await boot(true);f.state.text='utterly unknown command';await f.p.evaluate(()=>__wux.commandVoice());await sleep(1100);await f.p.evaluate(()=>__wux.commandVoice());ok(!f.state.posts.length,'desktop: spoken command miss cannot send a message');ok((await f.rows()).some(x=>x.kind==='dictation'&&x.state==='held'&&x.blob),'desktop: spoken command miss retains transcript/audio');await f.done('desktop spoken command');}
};
