/* Actual orb pointer clicks -> desktop skin-host -> WizCore voice -> shared Chats -> real outbox.
 * Imported by qa-voice-custody-callers.cjs (QA_ORB_ONLY=1). Synthetic endpoints only.
 * QA_ORB_SMOKE=1 reproduces the reported AI-apps click bug against QA_SOURCE's immutable tree.
 */
const fs=require('fs'),path=require('path');
module.exports=async({boot,ok,sleep,sid,model,provider,out})=>{
 const agent='research',other='orb-other-thread',typed='Pinned typed context',image='drop_orb_fixture';
 const matrix=process.env.QA_ORB_SMOKE==='1'?[{desktop:true,layout:'ai-apps',skin:'nebula',scenario:'reply'}]:[
  ...['ai-apps','classic'].flatMap(layout=>['nebula','signal'].flatMap(skin=>['reply','capture-nav','stt-nav','steer','list','explicit-new',...(layout==='ai-apps'?['held','dictate']:[])].map(scenario=>({desktop:true,layout,skin,scenario})))),
  ...['nebula','signal'].flatMap(skin=>['reply','stt-nav'].map(scenario=>({desktop:false,layout:'classic',skin,scenario})))
 ];
 for(const c of matrix){
  const {desktop,layout,skin,scenario}=c,label=`${desktop?'desktop':'phone'}-${layout}-${skin}-${scenario}`;
  const now=Date.now()/1000,active=scenario==='steer';
  const sessions=[sid,other].map((id,i)=>({id,agent,source:'wizard-mobile',title:i?'Other synthetic thread':'Original synthetic thread',status:active&&!i?'running':'completed',wizard_status:active&&!i?'running':'completed',...(active&&!i?{wizard_run_id:'orb-original-active-run'}:{}),model,provider,started_at:now-60,last_active:now-i,message_count:2,messages:[{role:'user',content:'Synthetic question',timestamp:now-10},{role:'assistant',content:'Synthetic answer',timestamp:now-5}]}));
  const agents=[{id:'hermes',is_default:true,label:'Wizard',status:'running',model:{model,provider}},{id:agent,label:'Research fixture',status:'running',model:{model,provider}}];
  const f=await boot(desktop,false,null,{orb:true,layout,skin,agents,sessions}),{p,wid,state}=f;
  state.down=false;state.sttDelay=scenario==='stt-nav'?1200:300;
  if(scenario==='dictate')state.text='only synthetic STT words';
  const root=p.locator(`[data-chats="${wid}"]`),control=p.locator(desktop?(layout==='ai-apps'?'.aad-orbbtn':'#micBtn'):'#orb');
  const detail={...c,wid,requests:state.requests};
  const record=(v,n,d)=>ok(v,`${label}: ${n}`,d);
  async function navigate(){
   await p.evaluate(({wid,other})=>{const A=window.__wos||window.__wux;A.chats.openChat(wid,other);A.focusWin?.(wid);A.chats.setDraft(wid,'Other composer remains untouched',[]);A.chats.renderChats(A.wins[wid]);},{wid,other});
  }
  try{
   await p.waitForFunction(({wid,sid,desktop,layout})=>{const A=window.__wos||window.__wux;return A.wins[wid]?.thread===sid&&(!desktop||WosSkinHost.layout===layout);},{wid,sid,desktop,layout});
   record(await p.evaluate(({skin,desktop})=>document.documentElement.dataset.skin===skin&&(window.__wux?.shell==='desktop')===desktop,{skin,desktop}),'actual shell and skin selected');
   await root.locator('textarea').fill(typed);
   // Attachment fixture is injected into the real shared composer; no private files are read.
   await p.evaluate(({wid,image})=>{const A=window.__wos||window.__wux;A.chats.ch(wid).files=[{id:image,name:'synthetic.png',mime:'image/png',bytes:7}];A.chats.saveDraft(wid);},{wid,image});
   if(scenario==='list')await p.evaluate(wid=>{const A=window.__wos||window.__wux;A.chats.chatsBack(A.wins[wid]);},wid);
   const before=await p.evaluate(({wid})=>{const A=window.__wos||window.__wux,w=A.wins[wid];return {thread:w.thread||'',route:A.chats.modelRoute(wid,w.thread||'__new__')};},{wid});detail.before=before;
   if(scenario==='dictate')await p.keyboard.press('Alt+d');
   else if(scenario==='explicit-new')await p.keyboard.press('Alt+v');
   else if(scenario==='held'){
    state.text='go home';state.cmd={route:'command',action:'home'};
    await control.hover();await p.mouse.down();
   }else await control[desktop?'click':'tap']();
   await p.waitForFunction(()=>{const A=window.__wos||window.__wux;return (A.voiceState||A.voice)==='listen';});
   await sleep(1150);
   if(scenario==='reply')await p.screenshot({path:path.join(out,label+'-listening.png'),animations:'disabled'});
   if(scenario==='capture-nav')await navigate();
   if(scenario==='dictate')await p.keyboard.press('Alt+d');
   else if(scenario==='explicit-new')await p.keyboard.press('Alt+v');
   else if(scenario==='held')await p.mouse.up();
   else await control[desktop?'click':'tap']();
   if(scenario==='dictate'){
    await p.waitForFunction(()=>!!window.__wuxLastDictation);
    record(state.posts.length===0&&!(state.steers||[]).length,'dictation never submits to an agent');
    record((await root.locator('textarea').inputValue()).includes('only synthetic STT words'),'dictation inserts into the focused field');
   }else if(scenario==='held'){
    await p.waitForFunction(()=>[...WosOutbox._items.values()].some(x=>x.completion==='local'));
    record(state.posts.length===0&&!(state.steers||[]).length,'real held orb command stays local');
    record(await p.evaluate(()=>!WosOutbox.unsent().some(x=>x.intent==='command')),'successful local command does not masquerade as unsent');
   }else{
    await p.waitForFunction(()=>[...WosOutbox._items.values()].some(x=>x.kind!=='capture'&&x.audio?.size>0));
    const staged=await p.evaluate(()=>[...WosOutbox._items.values()].find(x=>x.kind!=='capture'&&x.audio?.size>0));
    detail.staged={id:staged.id,kind:staged.kind,sessionId:staged.sessionId,agent:staged.agent,model:staged.model,provider:staged.provider,state:staged.state,sealKey:staged.sealKey,files:staged.files,typed:staged.typed};
    if(scenario==='stt-nav')await navigate();
    await p.waitForFunction(()=>[...WosOutbox._items.values()].some(x=>x.state==='sent'),null,{timeout:18000});
    const items=await p.evaluate(()=>[...WosOutbox._items.values()].map(x=>({id:x.id,kind:x.kind,state:x.state,sessionId:x.sessionId,agent:x.agent,model:x.model,provider:x.provider,steerRunId:x.steerRunId,steered:x.steered,typed:x.typed,files:x.files,audioFile:x.audioFile,durable:x.durable,sealKey:x.sealKey})));
    detail.items=items;
    const sent=items.filter(x=>x.state==='sent'),created=state.requests.filter(q=>q.method==='POST'&&q.path.endsWith('/api/sessions'));
    const newThread=['list','explicit-new'].includes(scenario);
    record(sent.length===1,'one durable outbox submission',sent);
    const it=sent[0];
    record(it?.durable&&!!it?.audioFile?.id&&!items.some(x=>x.kind==='capture'),'one owner retains uploaded audio receipt; no stray capture owner',items);
    if(newThread){
     record(it?.kind==='new'&&it.sessionId!==sid&&created.length===1&&state.posts.length===1,'intentional list/new-chat records create exactly one new thread',{it,created,posts:state.posts});
     record(!it?.typed&&!(it?.files||[]).some(x=>x.id===image),'intentional list/new-chat shares no original composer context',it);
    }else{
     record(it?.kind==='reply'&&it.sessionId===sid&&created.length===0,'open thread remains exact original; zero thread creation',{it,created});
     record(it?.agent===agent&&it.model===before.route.model&&it.provider===before.route.provider,'original scoped agent/model/provider remain pinned',{it,before});
     record(it?.typed===typed&&it.files.some(x=>x.id===image),'original typed draft and attachment sealed once',it);
     if(active)record(state.posts.length===0&&(state.steers||[]).length===1&&state.steers[0].path.endsWith('/orb-original-active-run/steer')&&state.steers[0].query.includes('agent=research')&&state.steers[0].body.agent===agent,'active run steered exactly once at pinned target',state.steers);
     else record(state.posts.length===1&&state.posts[0].session_id===sid&&state.posts[0].agent===agent,'one same-session admission; no route fallback',state.posts);
     if(scenario.includes('nav'))record(await root.locator('textarea').inputValue()==='Other composer remains untouched','navigation composer remains intact');
    }
    const posts=state.posts.length,steers=(state.steers||[]).length;
    await p.evaluate(()=>dispatchEvent(new Event('online')));await sleep(150);
    record(state.posts.length===posts&&(state.steers||[]).length===steers,'connectivity wake never replays accepted take');
    if(scenario==='reply'){
     // No CSS changes in this repair; still prove token repaint on the same live document.
     const skin2=skin==='nebula'?'signal':'nebula';
     const oldInk=await p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--wz-ink'));
     await p.evaluate(s=>WosSkin.set(s),skin2);await p.waitForFunction(s=>document.documentElement.dataset.skin===s,skin2);
     await p.evaluate(s=>WosSkin.set(s),skin);await p.waitForFunction(s=>document.documentElement.dataset.skin===s,skin);
     record(await p.evaluate(s=>document.documentElement.dataset.skin===s,skin)&&!!oldInk.trim(),'live skin changes preserve shell and Appearance tokens');
     await p.evaluate(()=>document.fonts.ready);await sleep(180);
     await p.screenshot({path:path.join(out,label+'-after.png'),animations:'disabled'});
    }
   }
   record(state.scopeErrors.length===0,'all synthetic session reads stay in owning agent',state.scopeErrors);
  }catch(e){detail.error=String(e.stack||e);await p.screenshot({path:path.join(out,label+'-failure.png'),animations:'disabled'}).catch(()=>{});throw e;}
  finally{fs.writeFileSync(path.join(out,label+'-requests.json'),JSON.stringify(detail,null,2));await f.done(label);}
 }
};
