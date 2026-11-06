import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const root=process.env.SHARE_SOURCE_ROOT||new URL('../',import.meta.url).pathname;
const read=p=>readFileSync(root+'/'+p,'utf8');
const agents=[{id:'main-a',label:'Synthetic Main',is_default:true,status:'running',permissions:{}},{id:'other-b',label:'Synthetic Other',status:'running',permissions:{}},{id:'stopped-c',label:'Stopped',status:'stopped',permissions:{}}];
function fixture(shell,registry=agents){
 let el,focus='',sent=0; const staged=[],files=[],store=new Map();
 const w={id:'main-chats',app:'chats',thread:null};
 const ta={offsetParent:{},value:'Existing note',setSelectionRange(){},focus(){}};
 const CHATS={setFocus:(win,f)=>{focus=f.key;},openNewDraft:()=>{w.thread='__new__';},insertText:(id,text)=>{staged.push({id,text,agent:focus});ta.value+=text;return true;},addFiles:(id,fs)=>files.push({id,files:fs,agent:focus}),send:()=>{sent++;}};
 const AG={visible:()=>registry,get:id=>registry.find(a=>a.id===id),load:async()=>{},isPrivate:()=>false};
 const window={WosAgents:AG,WizCore:{apps:()=>({APP:{}})},WizAppServices:{claimShare:()=>true},__wos:{chats:CHATS,wins:{[w.id]:w}},dispatchEvent(){}};
 const document={body:{appendChild(){}},querySelector:s=>s.includes('[data-chats="main-chats"]')?ta:null,createElement(){const handlers={};el={style:{},classList:{add(){},remove(){}},setAttribute(){},remove(){},querySelector:()=>null,addEventListener:(k,fn)=>handlers[k]=fn,handlers};return el;}};
 const context=vm.createContext({window,document,CHATS,LIVE:null,toast(){},closeSheets(){},placeApp:()=>w,mainChats:()=>true,findWin:()=>w,focusWin(){},newWin:()=>w,syncChatsPane(){},CSS:{escape:String},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},sessionStorage:{getItem:()=>null},CustomEvent:class{},File,Blob,URL,requestAnimationFrame:fn=>fn(),setTimeout:fn=>fn()});
 const code=read(shell==='phone'?'web/app.js':'web/desktop/desktop.js');const a=code.indexOf('  async function openAgentChats('),b=code.indexOf('  window.WizOpenAgentChats',a);
 vm.runInContext(code.slice(a,b)+'\nwindow.WizOpenAgentChats=openAgentChats;',context);
 vm.runInContext(read('web/core/share-sheet.js'),context);
 return {S:window.WosShareSheet,staged,files,w,ta,open:window.WizOpenAgentChats,sent:()=>sent,click:id=>el.handlers.click({detail:0,target:{closest:s=>s==='.shs-b'?{}:s==='[data-shs-agent]'?{dataset:{shsAgent:id}}:null}})};
}
for(const shell of ['phone','desktop'])for(const agent of ['main-a','other-b'])test(`${shell}: actual opener stages text and file to ${agent}, never sends or overwrites`,async()=>{
 const f=fixture(shell),file=new File(['synthetic'],'fixture.txt');
 const receipt=f.S.show({text:'Synthetic share',file},()=> 'unsupported');f.click(agent);assert.equal(await receipt,'shared');
 assert.equal(f.staged.length,1);assert.equal(f.staged[0].agent,agent);assert.equal(f.staged[0].id,'main-chats');assert.equal(f.ta.value,'Existing note\n\n> Synthetic share\n\n');
 assert.equal(f.files.length,1);assert.equal(f.files[0].agent,agent);assert.equal(f.files[0].files[0],file);assert.equal(f.sent(),0);assert.equal(f.w.thread,'__new__');
 assert.equal(await f.open(agent),true,'non-share callers keep boolean contract');
});
test('empty/unavailable registry preserves native fallback instead of fabricating an agent',async()=>{
 const f=fixture('phone',[]);assert.deepEqual([...f.S._agents('text')],[]);let called=0;assert.equal(await f.S.show({text:'Synthetic'},()=>{called++;return 'copied';}),'copied');assert.equal(called,1);assert.equal(f.staged.length,0);
});
test('stopped registry entries are never offered as recipients',()=>{const f=fixture('desktop');assert.deepEqual([...f.S._agents('text')],['main-a','other-b']);});
