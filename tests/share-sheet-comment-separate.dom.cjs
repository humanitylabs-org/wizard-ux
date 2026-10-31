/* Fast DOM integration gate (not a rendered-browser or Android/emulator substitute).
 * Requires jsdom in the development toolchain; run separately from the dependency-free node:test suite. */
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_MODULE || 'jsdom');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=process.env.SHARE_TEST_TREE || path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'web/core/share-wizard.js'),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
async function until(check){for(let n=0;n<30;n++){if(check())return;await tick();}throw Error('DOM state did not settle');}
function fixture({solo=false,delayedMain=false}={}){
 const errors=[],sends=[],uploads=[],requests=[];
 const console=new VirtualConsole();console.on('jsdomError',e=>errors.push(String(e)));
 const dom=new JSDOM('<!doctype html><html><body><button id="previous">Previous focus</button></body></html>',{runScripts:'outside-only',url:'https://synthetic.invalid/wizard-os-home/',virtualConsole:console});
 const w=dom.window, d=w.document;let mainResolve;
 const agents=[{id:'main',label:'Archimedes',is_default:true,status:'running'},...solo?[]:[{id:'synthetic-private',label:'Synthetic Private',privacy:'private',status:'running'},{id:'stopped',label:'Stopped',status:'stopped'}]];
 w.WizConfig={agent:()=> 'Archimedes'};
 w.fetch=async url=>{
   requests.push(url);
   if(url==='/wizard/v1/agents')return {ok:true,status:200,json:async()=>({agents})};
   const privateAgent=url.includes('agent=synthetic-private');
   const response={ok:true,json:async()=>({data:[{id:privateAgent?'private-existing':'main-existing',title:privateAgent?'Private existing':'Main existing'}]})};
   if(delayedMain&&!privateAgent)return new Promise(r=>{mainResolve=()=>r(response);});
   return response;
 };
 w.__wos={wins:{c:{app:'chats'}},openThread(){},toast(){},chats:{async uploadFile(f){uploads.push(f);return {id:'f'+uploads.length,name:f.name,bytes:f.size};},async sendChat(wid,text,how,audio,opts){sends.push({wid,text,opts});return {durable:true};}}};
 w.eval(fs.readFileSync(path.join(root,'web/core/attach-chip.js'),'utf8'));w.eval(source);
 const q=s=>d.querySelector(s), click=s=>{const el=typeof s==='string'?q(s):s;assert.ok(el,s);el.click();};
 const ready=()=>until(()=>q('[data-sharesend]')&&!q('[data-sharesend]').disabled);
 const choose=(which,id)=>{click('.dv-'+which);click('[data-dvpick="'+id+'"]');};
 return {w,d,dom,errors,sends,uploads,requests,q,click,ready,choose,mainResolve:()=>mainResolve?.()};
}
(async()=>{
 let pass=0;const checks=[];function mark(s){checks.push(s);pass++;}
 {
  const f=fixture({solo:true});let cancelled=0;f.q('#previous').focus();
  const result=f.w.WizShareWizard.open({android:true,text:'Emailing x.pdf',subject:'x.pdf',items:[{n:0,name:'x.pdf',bytes:3,mime:'application/pdf',blob:new f.w.Blob(['pdf'])}],onCancelled:()=>cancelled++});await f.ready();
  assert.equal(f.q('.dv-text').value,'');assert.equal(f.q('.dv-text').placeholder,'Add a comment (optional)');assert.equal(f.q('.dv-quote'),null);assert.ok(f.q('.dv-agent'));assert.equal(f.q('input[type=radio]'),null);
  f.click('.dv-chat');assert.equal(f.q('[role=option] span').textContent,'+ New chat');assert.equal(f.q('[role=option]').getAttribute('aria-selected'),'true');
  f.d.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(f.q('.dv-picker'),null);assert.ok(f.q('.wz-share'));
  f.click('.dv-scrim');assert.equal(await result,'cancelled');assert.equal(cancelled,1);assert.equal(f.d.activeElement.id,'previous');assert.deepEqual(f.errors,[]);mark('single agent / empty boilerplate comment / New chat / nested Escape / outside cancel and focus restoration');f.dom.window.close();
 }
 {
  const f=fixture();const result=f.w.WizShareWizard.wizard({title:'Messenger',text:'Quoted message',files:[new f.w.File(['pdf'],'x.pdf',{type:'application/pdf'}),new f.w.File(['drop'],'remove.pdf')]});await f.ready();
  assert.equal(f.q('.dv-text').value,'');assert.equal(f.q('.dv-quote').textContent,'Quoted message');assert.equal(f.q('.dv-head small').textContent,'Forwarded from Messenger');
  f.choose('chat','main-existing');assert.equal(f.q('.dv-chat strong').textContent,'Main existing');f.click('.dv-agent');assert.equal(f.q('[data-dvpick=stopped]').disabled,true);f.click('[data-dvpick=synthetic-private]');assert.equal(f.q('.dv-chat strong').textContent,'New chat');await f.ready();
  assert.ok(f.requests.some(u=>u.includes('&agent=synthetic-private')));f.choose('chat','private-existing');f.q('.dv-text').value='Owner comment';f.click('[data-attrm="1"]');f.click('[data-sharesend]');
  assert.equal(await result,'sent');assert.equal(f.q('.wz-share'),null);await until(()=>!f.w.WizShareWizard.busy);assert.equal(f.uploads.length,1);assert.equal(f.sends.length,1);assert.equal(f.sends[0].text,'Owner comment\n\nQuoted message');assert.equal(f.sends[0].opts.agent,'synthetic-private');assert.equal(f.sends[0].opts.sid,'private-existing');assert.equal(f.sends[0].opts.files[0].name,'x.pdf');assert.deepEqual(f.errors,[]);mark('Messenger forward / real shared UI events / stopped disabled / scoped reset / kept PDF + comment to existing synthetic agent');f.dom.window.close();
 }
 {
  const f=fixture();let job,complete;
  const result=f.w.WizShareWizard.open({android:true,text:'Emailing keep.pdf',items:[{n:0,name:'drop.pdf',mime:'application/pdf',bytes:3,read(){throw Error('must stay native');}},{n:2,name:'keep.pdf',mime:'application/pdf',bytes:4,read(){throw Error('must stay native');}}],nativeQueue:j=>{job=j;return new Promise(r=>complete=r);}});await f.ready();f.choose('agent','synthetic-private');await f.ready();f.q('.dv-text').value='Native comment';f.click('[data-attrm="0"]');f.click('[data-sharesend]');assert.equal(await result,'sent');assert.equal(f.q('.wz-share'),null);assert.equal(f.w.WizShareWizard.busy,true);assert.equal(job.agent,'synthetic-private');assert.equal(job.target,'__new__');assert.equal(job.note,'Native comment');assert.deepEqual(Array.from(job.keptItemIndexes),[2]);assert.equal(f.uploads.length,0);complete();await until(()=>!f.w.WizShareWizard.busy);assert.deepEqual(f.errors,[]);mark('native callback / original indexes retained / new synthetic agent / no JS file read / close before background acknowledgement');f.dom.window.close();
 }
 {
  const f=fixture({delayedMain:true});f.w.WizShareWizard.open({text:'race quote'});await until(()=>f.requests.some(u=>u.includes('/sessions?')));f.choose('agent','synthetic-private');await f.ready();f.mainResolve();await tick();f.click('.dv-chat');assert.equal(f.d.querySelectorAll('[data-dvpick]')[1].dataset.dvpick,'private-existing');f.w.WizShareWizard.back();f.w.WizShareWizard.back();assert.deepEqual(f.errors,[]);mark('late previous-agent session response cannot overwrite the selected agent');f.dom.window.close();
 }
 {
  const f=fixture();let cancel=0;f.w.WizShareWizard.open({text:'quote',agent:'synthetic-private',dest:'private-existing',items:[{n:2,name:'keep.pdf',bytes:4,mime:'application/pdf',read(){throw Error('must stay native');}}],nativeQueue:async()=>{throw Error('synthetic queue failure');},onCancelled:()=>cancel++});await f.ready();f.q('.dv-text').value='Keep note';f.click('[data-sharesend]');await until(()=>f.q('.dv-status')?.textContent.includes('Couldn’t send'));await f.ready();assert.equal(f.q('.dv-text').value,'Keep note');assert.equal(f.q('.dv-agent strong').textContent,'Synthetic Private');assert.equal(f.q('.dv-chat strong').textContent,'Private existing');f.click('.dv-scrim');assert.equal(cancel,1);assert.deepEqual(f.errors,[]);mark('native failure reopens with comment + agent + chat and retains cancellation callback');f.dom.window.close();
 }
 console.log(JSON.stringify({passed:pass,failed:0,checks,scope:'jsdom integration only; no rendered-browser/Android proof'}));
})().catch(e=>{console.error(e);process.exitCode=1;});
