import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../web/core/share-wizard.js',import.meta.url),'utf8');
function sheet() {
  const timers=new Map(), intervals=new Map(), sends=[], uploads=[]; let serial=0, click;
  const document={addEventListener(){}, activeElement:null};
  const button={ownerDocument:document, isConnected:true, dataset:{shareto:'__new__'}};
  const field={value:'synthetic share'}, status={};
  const el={isConnected:true, dataset:{}, remove(){this.isConnected=false;}, contains:n=>n===button,
    querySelector:s=>s==='[role=dialog]'?{focus(){}}:s==='.dv-text'?field:status,
    querySelectorAll:()=>[button], addEventListener:(name,fn)=>{if(name==='click')click=fn;}};
  const mount={classList:{add(){},remove(){}},append(){el.isConnected=true;}};
  document.querySelector=()=>mount;document.createElement=()=>el;
  const host={wins:{}, idx:0, live:{sessions:[]},
    openWizardThread(target){host.wins.chat={app:'chats',thread:target};},
    closeWin(id){delete this.wins[id];},
    chats:{async uploadFile(file){uploads.push(file);return {id:'fixture-file'};},async sendChat(...args){sends.push(args);return {durable:true};}}};
  const ctx={window:{__wos:host}, document, URL, Blob, File,
    setTimeout(fn){const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
    setInterval(fn){const id=++serial;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id)};
  vm.runInNewContext(source,ctx);
  const target={ownerDocument:document,closest:s=>s==='[data-shareto]'?button:null};
  return {api:ctx.window.WizShareWizard,ctx,host,button,el,target,timers,intervals,sends,uploads,
    click:(isTrusted=false,other={})=>click({target,isTrusted,...other})};
}
test('no shell gesture times out denied with zero uploads/sends',async()=>{
  const f=sheet(),p=f.api.wizard({text:'synthetic'},()=>true,{requireTrusted:true});
  assert.equal(f.sends.length,0);assert.equal(f.uploads.length,0);
  [...f.timers.values()][0]();assert.equal(await p,'denied');
  assert.equal(f.timers.size,0);assert.equal(f.intervals.size,0);
});
test('synthetic click is denied; trusted shell-document event branch sends exactly once',async()=>{
  const f=sheet(),p=f.api.wizard({text:'synthetic'},()=>true,{requireTrusted:true});
  await f.click(false);assert.equal(await p,'denied');assert.equal(f.sends.length,0);
  const g=sheet(),q=g.api.wizard({text:'synthetic',files:[new File(['x'],'fixture.ogg')]},()=>true,{requireTrusted:true});
  await g.click(true);assert.equal(await q,'sent');assert.equal(g.sends.length,1);assert.equal(g.uploads.length,1);
  assert.equal(g.timers.size,0);assert.equal(g.intervals.size,0);
});
test('claimed trusted event with foreign document, detached button or removed sheet cannot confirm',async()=>{
  for(const mutate of [f=>{f.target.ownerDocument={};},f=>{f.button.ownerDocument={};},f=>{f.button.isConnected=false;},f=>{f.el.isConnected=false;}]){
    const f=sheet(),p=f.api.wizard({text:'synthetic'},()=>true,{requireTrusted:true});mutate(f);
    await f.click(true);assert.equal(await p,'denied');assert.equal(f.sends.length,0);
  }
});
test('stale authorization is denied before open, at click and without a click',async()=>{
  const f=sheet();assert.equal(await f.api.wizard({text:'synthetic'},()=>false,{requireTrusted:true}),'denied');
  const g=sheet();let alive=true;const p=g.api.wizard({text:'synthetic'},()=>alive,{requireTrusted:true});alive=false;
  await g.click(true);assert.equal(await p,'denied');assert.equal(g.sends.length,0);
  const h=sheet();let attached=true;const q=h.api.wizard({text:'synthetic'},()=>attached,{requireTrusted:true});attached=false;
  [...h.intervals.values()][0]();assert.equal(await q,'denied');assert.equal(h.sends.length,0);
});
test('navigation during upload prevents send and an old completion cannot close a newer sheet',async()=>{
  const f=sheet();let alive=true, complete;
  f.host.chats.uploadFile=()=>new Promise(r=>complete=r);
  const p=f.api.wizard({files:[new File(['x'],'fixture.ogg')]},()=>alive,{requireTrusted:true});
  const sending=f.click(true);alive=false;[...f.intervals.values()][0]();assert.equal(await p,'denied');
  const next=f.api.wizard({text:'new synthetic'},()=>true,{requireTrusted:true});
  complete({id:'old-upload'});await sending;assert.equal(f.api.busy,true);assert.equal(f.sends.length,0);
  [...f.timers.values()][0]();assert.equal(await next,'denied');
});
test('boundary-off sheet retains existing click behaviour',async()=>{
  const f=sheet(),p=f.api.wizard({text:'synthetic'},()=>true);
  await f.click(false);assert.equal(await p,'sent');assert.equal(f.sends.length,1);
});
