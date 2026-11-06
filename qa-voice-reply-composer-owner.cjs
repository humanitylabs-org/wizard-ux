// Reuse the custody suite's synthetic origin, fake microphone and real outbox.
const fs=require('fs'),path=require('path');
module.exports=async({boot,ok,sleep,sid,model,provider,out})=>{
 const smoke=process.env.QA_VOICE_REPLY_SMOKE==='1';
 const cases=smoke?[{desktop:true,skin:'nebula',scenario:'companion'}]:[
  ...['nebula','signal'].flatMap(skin=>['companion','ready','working','archive','search','after-send','pane-switch','new'].map(scenario=>({desktop:true,skin,scenario}))),
  ...['nebula','signal'].flatMap(skin=>['mic','orb','new'].map(scenario=>({desktop:false,skin,scenario})))
 ];
 for(const c of cases){
  const {desktop,skin,scenario}=c,label=`${desktop?'desktop':'phone'}-${skin}-${scenario}`,now=Date.now()/1000;
  const session={id:sid,source:'wizard-mobile',title:'Synthetic voice destination',status:scenario==='working'?'running':'completed',wizard_status:scenario==='working'?'running':'completed',...(scenario==='working'?{wizard_run_id:'voice-fixture-run'}:{}),...(scenario==='archive'?{archived:true}:{}),model,provider,started_at:now-60,last_active:now,message_count:2,messages:[{role:'user',content:'Synthetic question',timestamp:now-15},{role:'assistant',content:'Synthetic answer',timestamp:now-10}]};
  const fixture={voiceReply:true,skin,layout:'ai-apps',sessions:[session],agents:[{id:'hermes',is_default:true,label:'Wizard',status:'running',model:{model,provider}}],apps:[{id:'fixture-capture',name:'Synthetic companion',kind:'wizard',url:'/fixture-capture'}]};
  let f,detail={...c};
  try{
   f=await boot(desktop,false,null,fixture);const {p,wid,state}=f;state.down=false;state.sttDelay=500;
   const root=p.locator(`[data-chats="${wid}"]`);await p.evaluate(()=>document.activeElement?.blur());
   if(desktop&&['ready','working','archive','search'].includes(scenario)){
    await p.evaluate(wid=>{const A=__wux;A.chats.chatsBack(A.wins[wid]);},wid);
    if(scenario==='search'){await p.keyboard.press('Alt+f');await p.locator('.aad-q').fill('Synthetic voice destination');}
    let row=p.locator(`.aad-rw[data-sid="${sid}"] .aad-row`).first();
    if(!(await row.isVisible())){const h=p.getByRole('button',{name:new RegExp('^'+scenario+'\\b','i')}).first();if(await h.isVisible())await h.click();}
    await row.click();
   }
   if(scenario==='after-send'){
    await root.locator('textarea').fill('Synthetic previous reply');await root.locator('textarea').press('Control+Enter');
    await p.waitForFunction(()=>WosOutbox.unsent().length===0);ok(await p.evaluate(({wid,sid})=>__wux.wins[wid].thread===sid,{wid,sid}),`${label}: previous send keeps chat open`);
   }
   if(desktop&&['companion','pane-switch'].includes(scenario)){
    await p.evaluate(()=>{const A=__wux;A.openApp(WizCore.apps('desktop').APP['fixture-capture']);});
    await p.waitForFunction(()=>document.documentElement.dataset.aiFront==='app');
    if(scenario==='pane-switch')await p.evaluate(()=>{const p=WizCore.panes;p.setMode?.('pair');});
    await root.locator('textarea').waitFor({state:'visible'});
    // Do not click/focus Chats here: that masks the actual regression.
    detail.focus=await p.evaluate(()=>({cur:__wux.cur,focus:__wux.ws[__wux.cur].focus,wins:WizDesktop.host.windows()}));
    ok(detail.focus.wins.some(w=>w.kind==='frame'&&w.focused),`${label}: companion has logical focus`,detail.focus);
   }
   if(scenario==='new')await p.evaluate(wid=>{const A=window.__wux||window.__wos;A.chats.openChat(wid,'__new__');A.focusWin?.(wid);},wid);
   const control=p.locator(desktop?'.aad-orbbtn':scenario==='mic'?'[data-chmic]':'#orbWrap').first();
   await control[desktop?'click':'tap']();
   await p.waitForFunction(()=>(window.__wux||window.__wos).voice==='listen');await sleep(1100);
   await p.screenshot({path:path.join(out,label+'-listening.png'),animations:'disabled'});
   await control[desktop?'click':'tap']();
   await p.waitForFunction(()=>[...WosOutbox._items.values()].some(x=>x.kind!=='capture'&&x.audio?.size));
   await sleep(1400);
   detail.rows=await f.rows();detail.requests=state.requests;
   const voice=detail.rows.filter(x=>x.blob>0&&x.kind!=='capture');
   const creates=state.requests.filter(x=>x.method==='POST'&&x.path.endsWith('/api/sessions'));
   ok(voice.length===1,`${label}: exactly one voice custody row`,voice);
   const v=voice[0];
   ok(scenario==='new'?v?.kind==='new':v?.kind==='reply'&&v?.sessionId===sid,`${label}: original destination retained`,v);
   ok(scenario==='new'?creates.length===1:creates.length===0,`${label}: zero unintended thread creation`,creates);
   ok(v?.model===model&&v?.provider===provider,`${label}: recording route retained`,v);
   ok(state.scopeErrors.length===0,`${label}: synthetic session scope retained`,state.scopeErrors);
   await p.screenshot({path:path.join(out,label+'-after.png'),animations:'disabled'});
  }catch(e){detail.error=String(e.stack||e);ok(false,`${label}: browser scenario completes`,detail.error);if(f)await f.p.screenshot({path:path.join(out,label+'-failure.png')}).catch(()=>{});}
  finally{fs.writeFileSync(path.join(out,label+'-requests.json'),JSON.stringify(detail,null,2));if(f)await f.done(label);}
 }
};
