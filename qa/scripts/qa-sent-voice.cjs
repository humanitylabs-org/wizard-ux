// Extends qa-manager-native.cjs: all service writes remain intercepted.
const path=require('path');
module.exports=async({p,mobile,label,sid,wid,R,writes,errors,ok,delay,out})=>{
 const add=async(text,sessionId=sid)=>{R.text=text;const id=await p.evaluate(async({sessionId})=>{const s=WizLive.session(sessionId)||{};const it=await WosOutbox.enqueue({kind:'reply',sessionId,model:s.model||'fixture-model',provider:s.provider||'fixture-provider',audio:new Blob(['synthetic original recording'],{type:'audio/webm'})});return it.id;},{sessionId});await p.waitForFunction(id=>WosOutbox.get(id)?.state==='sent',id);return id;};
 const reopen=async()=>{const f=p.frames().find(x=>x.url().includes('/wizard-manager/'));await f.waitForSelector('[data-message-id="2"] .mgr-actions a');await f.locator('[data-message-id="2"] .mgr-actions a').click();await p.waitForSelector('.hosted-thread .ch-compose');wid=await p.locator('.hosted-thread').getAttribute('data-chats');};
 const snap=id=>p.evaluate(id=>{const x=WosOutbox.get(id);return {state:x.state,runId:x.runId,sessionId:x.sessionId,model:x.model,provider:x.provider,audioFile:x.audioFile,files:x.files,text:x.text,body:x.body};},id);
 const submissions=()=>writes.filter(x=>/\/v1\/runs$/.test(x.path));
 const words='A delivered voice note waiting for its canonical history';
 const id=await add(words);await delay(1800);
 // Reopen to exercise the persisted Sent shape even when the old host missed onChange.
 await p.locator('.hosted-thread [data-chback]').click();await reopen();
 const bubble=p.locator(`.hosted-thread [data-ob="${id}"]`);
 await bubble.waitFor();await p.screenshot({path:path.join(out,label+'-sent.png')});
 ok(label+' sent note awaiting history has Dismiss in Manager',await bubble.locator('[data-obdismiss]').count()===1,await bubble.innerText());
 const before=await snap(id),posts=submissions().length;
 await bubble.locator('[data-obdismiss]').click();
 await p.waitForFunction(id=>!document.querySelector(`.hosted-thread [data-ob="${id}"]`),id,{timeout:1200});
 ok(label+' Dismiss immediately removes hosted sent bubble',await bubble.count()===0);
 ok(label+' dismissal preserves admission and original upload route',JSON.stringify(await snap(id))===JSON.stringify(before));
 ok(label+' sent dismissal feedback never calls it unsent',!(await p.locator('#toast').innerText()).includes('Unsent'));
 await p.reload();await p.waitForFunction(()=>WosOutbox?.recoveryComplete&&(window.__wos||window.__wux)?.chats);await reopen();
 ok(label+' sent dismissal survives reload and Manager reopen',await p.evaluate(id=>WosOutbox.get(id)?.threadHidden&&!WosOutbox.forThread(WosOutbox.get(id).sessionId).some(x=>x.id===id),id)&&await p.locator(`.hosted-thread [data-ob="${id}"]`).count()===0);
 for(let n=0;n<6;n++){await delay(4000);if(await p.locator(`.hosted-thread [data-ob="${id}"]`).count())throw Error('Dismissed sent bubble reappeared during polling');}
 ok(label+' dismissed bubble stays gone through six poll intervals',submissions().length===posts);
 // Canonical arrival still appears; dismissal never removes server history.
 R.canonical.push({id:900003,role:'user',content:words});
 const secondWords='Another accepted voice note automatically settles into history';
 const second=await add(secondWords);R.canonical.push({id:900004,role:'user',content:secondWords});
 await p.waitForFunction(id=>WosOutbox.get(id)?.compact===true,second,{timeout:6000});
 await p.waitForFunction(id=>!document.querySelector(`.hosted-thread [data-ob="${id}"]`),second,{timeout:1200});
 ok(label+' canonical arrival automatically removes optimistic bubble',await p.locator(`.hosted-thread [data-ob="${second}"]`).count()===0);
 const users=await p.locator('.hosted-thread .msg.u:not(.pending)').allTextContents();
 ok(label+' both real history messages remain exactly once',users.filter(x=>x.includes(words)).length===1&&users.filter(x=>x.includes(secondWords)).length===1,users);
 ok(label+' no resend cancel or cross-thread admission',submissions().length===posts+1&&submissions().every(x=>x.body.session_id===sid)&&!writes.some(x=>/\/(cancel|stop)$/.test(x.path)));
 // Held notes also repaint inside Manager; standalone Chats was insufficient coverage.
 const held=await p.evaluate(async sid=>{const it=await WosOutbox.stage({kind:'reply',sessionId:sid,audio:new Blob(['held original'],{type:'audio/webm'})});await WosOutbox.transition(it.id,'held','Saved locally');return it.id;},sid);
 await p.waitForSelector(`.hosted-thread [data-ob="${held}"] [data-obdismiss]`,{timeout:1200});
 await p.locator(`.hosted-thread [data-ob="${held}"] [data-obdismiss]`).click();
 await p.waitForFunction(id=>!document.querySelector(`.hosted-thread [data-ob="${id}"]`),held,{timeout:1200});
 ok(label+' held dismissal also updates Manager immediately',await p.evaluate(id=>WosOutbox.get(id).audio.size>0&&WosOutbox.get(id).state==='held',held));
 ok(label+' no browser errors',errors.length===0,errors);
 await p.screenshot({path:path.join(out,label+'-settled.png')});
};
