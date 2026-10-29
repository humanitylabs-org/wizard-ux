// Actual Focus tabs, routed list/thread reads, shared Chats and IndexedDB; synthetic data only.
// Registry runtime kinds are fixtures, not host/container/backend or private-content acceptance.
const fs = require('fs'), path = require('path');
module.exports = async ({boot, ok, model, provider, out, browser}) => {
  const routes = [
    {kind:'main',id:'hermes',label:'Main fixture',is_default:true},
    {kind:'host-profile',id:'qa-profile',label:'Profile fixture',runtime:{kind:'host-profile',profile:'qa-profile'}},
    {kind:'container',id:'qa-container',label:'Container fixture',runtime:{kind:'container',container:'synthetic-only'}},
    {kind:'restricted',id:'qa-restricted',label:'Restricted fixture',privacy:'private',permissions:{tools:[],network:false}},
  ];
  const agents=routes.map(a=>({harness:'hermes',privacy:'standard',status:'running',model:{model,provider,allowed_models:[model],fallback:false},...a}));
  const now=Date.now()/1000;
  const sessions=routes.map((a,i)=>({id:'dismiss-'+a.kind,title:a.label+' active thread',agent:a.is_default?'':a.id,
    source:'wizard-mobile',status:'running',wizard_status:'running',wizard_run_id:'accepted-'+a.kind,model,provider,
    message_count:2,started_at:now-60,last_active:now-i,wizard_last_user_at:now-10,
    messages:[{id:1,role:'user',content:'Switch',timestamp:now-10},{id:2,role:'assistant',content:'Accepted reply stays intact',timestamp:now-5}]}));
  const smoke=process.env.QA_DISMISS_SMOKE==='1';
  const cases=smoke?[{desktop:true,skin:'nebula',route:routes[1]}]:[false,true].flatMap(desktop=>['nebula','signal'].flatMap(skin=>routes.map(route=>({desktop,skin,route}))));
  for(const {desktop,skin,route} of cases){
    const label=`${desktop?'desktop':'phone'}-${skin}-${route.kind}`,s=sessions.find(s=>s.id==='dismiss-'+route.kind),agent=s.agent;
    const f=await boot(desktop,false,null,{agents,sessions,skin}),p=f.p,wid=f.wid;
    const chat=p.locator(`[data-chats="${wid}"]`),bubble=id=>chat.locator(`[data-ob="${id}"]`),button=id=>bubble(id).locator(`[data-obdismissfailed="${id}"]`);
    const details={label,routeKind:route.kind,agent,sessionId:s.id};
    const record=(v,name,detail)=>ok(v,label+': '+name,detail);
    async function settled(){
      await p.waitForFunction(wid=>{const el=document.querySelector(`[data-chats="${wid}"]`),r=el?.getBoundingClientRect();return r&&r.left>=0&&r.right<=innerWidth+1&&r.width>0&&el.getAnimations({subtree:true}).every(a=>a.effect?.getTiming().iterations===Infinity||a.playState!=='running');},wid);
    }
    async function tap(control){
      await control.waitFor({state:'visible'});await control.scrollIntoViewIfNeeded();await settled();
      const hit=await control.evaluate(el=>{const r=el.getBoundingClientRect();return r.width>=28&&r.height>=24&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&[[.5,.5],[.15,.2],[.85,.8]].every(([x,y])=>el.contains(document.elementFromPoint(r.left+r.width*x,r.top+r.height*y)));});
      if(!hit)throw Error(label+': control clipped or covered: '+await control.evaluate(el=>el.outerHTML));
      await control[desktop?'click':'tap']();
    }
    async function retained(id,text){return p.evaluate(({id,text,agent,sid})=>{const it=WosOutbox.get(id);return it?.text===text&&it.sessionId===sid&&(it.agent||'')===agent&&it.state==='held'&&it.cancelled&&it.threadHidden&&it.durable&&!WosOutbox.canRetry(it)&&WosOutbox.unsent().some(x=>x.id===id);},{id,text,agent,sid:s.id});}
    async function active(){
      const state=await p.evaluate(sid=>{const A=window.__wos||window.__wux,s=A.live.session(sid);return {status:s?.status,runId:s?.runId,agent:A.live.agentOf(sid)};},s.id);
      record(state.status==='running'&&state.runId===s.wizard_run_id&&state.agent===agent,'accepted active run and route intact',state);
      record(await chat.locator('.msg.u:not(.pending) .bub').filter({hasText:/^Switch$/}).count()===1&&await chat.getByText('Accepted reply stays intact',{exact:true}).count()===1,'accepted Switch and reply intact');
    }
    try{
      await p.waitForFunction(()=>WosAgents.ready&&(window.__wos||window.__wux).live.agentStatus['qa-restricted']?.ok);await settled();
      record(await p.evaluate(skin=>WosSkin.current===skin&&document.documentElement.dataset.skin===skin,skin),'requested skin applied');
      // Use supported visible routing controls, never setFocus/openChat/w.agent stand-ins.
      await tap(chat.locator(`.ch-focus-strip [data-chfocusopt="agent:${route.id}"]`));
      await p.waitForFunction(({wid,id})=>(window.__wos||window.__wux).wins[wid]?.focus?.key===id,{wid,id:route.id});
      const listIds=await chat.locator('[data-part="list"] [data-chopen]').evaluateAll(es=>es.map(e=>e.dataset.chopen));
      record(listIds.includes(s.id)&&sessions.filter(x=>x.id!==s.id).every(x=>!listIds.includes(x.id)),'Focus filters other routes out of list',listIds);
      await tap(chat.locator(`[data-part="list"] [data-chopen="${s.id}"]`));
      await chat.getByText('Accepted reply stays intact',{exact:true}).waitFor();
      // Failed custody is seeded, but its owner is derived from the route just opened through real UI.
      const ids=await p.evaluate(async({wid,model,provider,foreign})=>{const A=window.__wos||window.__wux,w=A.wins[wid],sid=w.thread,agent=A.live.agentOf(sid);const add=async(text,sessionId=sid,targetAgent=agent)=>{const it=await WosOutbox.stage({kind:'reply',sessionId,agent:targetAgent,text,model,provider});await WosOutbox.transition(it.id,'failed','No confirmed model route');return it.id;};return {target:await add('Switch'),other:await add('Keep this other message'),foreign:await add('Other route failure',foreign.id,foreign.agent)};},{wid,model,provider,foreign:sessions.find(x=>x.id!==s.id)});
      details.ids=ids;
      await button(ids.target).waitFor({state:'visible'});await button(ids.target).scrollIntoViewIfNeeded();await settled();
      await p.screenshot({path:path.join(out,label+'-before.png'),animations:'disabled'});
      await tap(button(ids.target));
      // RAM flags change before IDB commit + emit. Wait for the selected bubble's DOM detachment.
      await bubble(ids.target).waitFor({state:'detached'});
      record(await retained(ids.target,'Switch'),'selected failure detached; original retained durably');
      record(await bubble(ids.other).count()===1&&await p.evaluate(id=>WosOutbox.get(id)?.state==='failed',ids.other),'other failed bubble intact');
      record(await bubble(ids.foreign).count()===0&&await p.evaluate(id=>WosOutbox.get(id)?.state==='failed',ids.foreign),'other route failure untouched and not rendered');
      await active();
      await p.reload();await p.waitForFunction(()=>window.WosOutbox?.recoveryComplete&&(window.__wos||window.__wux)?.live.agentStatus['qa-restricted']?.ok);await settled();
      const restored=await p.evaluate(wid=>{const w=(window.__wos||window.__wux).wins[wid];return {thread:w?.thread,focus:w?.focus};},wid);
      record(restored.thread===s.id&&restored.focus?.key===route.id,'reload restores same routed thread and Focus',restored);
      await button(ids.other).waitFor({state:'visible'});
      record(await bubble(ids.target).count()===0&&await retained(ids.target,'Switch'),'dismissed original stays hidden and nonretryable after reload');
      await active();
      await tap(button(ids.other));await bubble(ids.other).waitFor({state:'detached'});
      // Back is a phone control. Desktop already has the visible two-pane list.
      if(!desktop)await tap(chat.locator('[data-chback]'));
      const pillId=await p.evaluate(async({sid,agent,model,provider})=>{const it=await WosOutbox.stage({kind:'reply',sessionId:sid,agent,text:'Dismiss from list',model,provider});await WosOutbox.transition(it.id,'failed','No confirmed model route');return it.id;},{sid:s.id,agent,model,provider});details.pillId=pillId;
      const pill=chat.locator(`.ch-pill [data-obdismissfailed="${pillId}"]`);
      await pill.waitFor({state:'visible'});await pill.scrollIntoViewIfNeeded();await settled();
      await p.screenshot({path:path.join(out,label+'-pill-before.png'),animations:'disabled'});
      await tap(pill);await chat.locator('.ch-pill:not(.sent)').waitFor({state:'hidden'});
      record(await retained(pillId,'Dismiss from list'),'last failed-send pill clears after durable Dismiss');
      await p.reload();await p.waitForFunction(()=>window.WosOutbox?.recoveryComplete&&(window.__wos||window.__wux)?.live.agentStatus['qa-restricted']?.ok);await settled();
      await chat.locator('.ch-pill:not(.sent)').waitFor({state:'hidden'});
      record(await retained(pillId,'Dismiss from list')&&await retained(ids.target,'Switch'),'thread and pill dismissal both survive reload');
      if(!desktop)await tap(chat.locator(`[data-part="list"] [data-chopen="${s.id}"]`));
      await chat.getByText('Accepted reply stays intact',{exact:true}).waitFor();await active();
      await p.screenshot({path:path.join(out,label+'-after.png'),animations:'disabled'});
      const reads=f.state.requests.filter(q=>q.method==='GET'&&q.path.includes(`/api/sessions/${s.id}`));
      record(reads.some(q=>q.path.endsWith('/messages'))&&reads.every(q=>(new URLSearchParams(q.query).get('agent')||'')===agent)&&f.state.scopeErrors.length===0,'real thread/message reads use exact route owner',reads);
      const dangerous=f.state.requests.filter(q=>!['GET','HEAD'].includes(q.method)&&/\/v1\/runs|\/api\/sessions|\/stop|\/cancel|\/steer|\/transcribe|\/route/.test(q.path));
      record(dangerous.length===0,'Dismiss/reload make zero run, Stop, cancel, send or model calls',dangerous);
    }catch(e){await p.screenshot({path:path.join(out,label+'-failure.png'),animations:'disabled'}).catch(()=>{});throw e;
    }finally{details.requests=f.state.requests;details.scopeErrors=f.state.scopeErrors;fs.writeFileSync(path.join(out,label+'-requests.json'),JSON.stringify(details,null,2));await f.done(label);}
  }
  if(!smoke){
    // Composite untouched captures for two-skin visual comparison, not reconstructed UI.
    const ctx=await browser.newContext();const p=await ctx.newPage();
    for(const shell of ['phone','desktop'])for(const phase of ['before','pill-before','after']){
      const width=shell==='phone'?390:1440,height=shell==='phone'?844:960;
      await p.setViewportSize({width:width*2,height:height+30});
      await p.setContent('<body style="margin:0;background:#111;color:white;font:16px monospace"><div style="height:30px">Nebula (left) / Signal (right) · '+shell+' · '+phase+'</div><div style="display:flex">'+['nebula','signal'].map(skin=>'<img width="'+width+'" height="'+height+'" src="data:image/png;base64,'+fs.readFileSync(path.join(out,`${shell}-${skin}-main-${phase}.png`)).toString('base64')+'">').join('')+'</div>');
      await p.waitForFunction(()=>[...document.images].every(im=>im.complete&&im.naturalWidth));
      await p.screenshot({path:path.join(out,`${shell}-two-skins-${phase}.png`)});
    }await ctx.close();
  }
};
