import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const cut = (a,b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
function fixture(phone, after, siblings = []) {
 const w = {id:'chat',app:'chats',thread:'__new__'}, state = {draft:'Keep typed words',trail:['parent']}, calls = [], toasts = [], draft = {text:'Keep typed words',files:[],reply:{key:'notifications:synthetic'}};
 const item = {id:'synthetic',app:'notes'}, n = {id:item.id,item,acts:['done','snooze','restore']};
 const context = {window:{WosSkinHost:{inboxAct:(...args)=>calls.push(args)},WosBell:{mark:async ids=>{calls.push(['mark',ids]);return true;},route:()=> 'chats',setRoute:()=>true,movedToast(){}}},
  W:{chat:w},CH:{chat:state},H:{changed(){}},PHONE:()=>phone,keepThreadOpen:()=>!phone||after==='stay',owner:x=>x,notifOf:()=>n,ch:()=>state,vib(){},renderChats(){},toast(...x){toasts.push(x);},
  noteQuiet:()=>true,noteSiblings:()=>siblings,noteAt:i=>i.id==='synthetic'?2:1,noteRoute:()=> 'notes',
  KIT:{drafts:{get:()=>draft,clear:()=>{draft.reply=null;},setReply:(_k,r)=>{draft.reply=r;}}},
  chatsBack:()=>{w.thread=null;},
 };
 vm.createContext(context);
 vm.runInContext(cut('  function notifAct(', '  /* Where this notification'),context);
 vm.runInContext(cut('  async function notifDoneAll(', '  // Quiet thread'),context);
 vm.runInContext(cut('  function notifRoute(', '  /* Thread tracker:'),context);
 return {context,w,calls,draft,state,toasts};
}
// James, 8 Nov 2026: Archive and Snooze of an alert land like Archive on a normal chat: phone straight to the chats list whatever
// After-actions says; desktop keeps following After-actions. Restore, route and other actions keep the setting.
for (const phone of [true,false]) for (const after of ['stay','list']) for (const action of ['done','snooze','restore','all','route']) test(`${phone?'phone':'desktop'} notification ${action}, ${after}`,async()=>{
 const f=fixture(phone,after);
 if(action==='all') await f.context.notifDoneAll('chat','synthetic');
 else if(action==='route') f.context.notifRoute('chat','notes','badge');
 else f.context.notifAct('chat',action);
 const retained=phone&&after==='stay'&&['restore','route'].includes(action); assert.equal(f.w.thread,retained?'__new__':null);
 assert.equal(!!f.draft.reply,retained,'retained notification still owns its reply metadata');
 if(phone&&['done','snooze','all'].includes(action)) assert.equal(f.state.trail.length,0,'phone lands on the list, no step up the link trail');
});
for (const action of ['done','snooze']) test(`phone alert ${action} with the default stay-open setting lands on the chats list on the tap frame, toasting`,()=>{
 const f=fixture(true,'stay'); const r=f.context.notifAct('chat',action);   // synchronous: nothing awaited before the list
 assert.equal(r,true); assert.equal(f.w.thread,null); assert.equal(f.state.trail.length,0);
 assert.equal(f.toasts[0]?.[1],action==='done'?'Archived':'Snoozed');
});
for (const after of ['stay','list']) for (const action of ['done','snooze']) test(`phone alert stack ${action}, ${after}: leaves for the list, never moves to the next alert`,()=>{
 const f=fixture(true,after,[{id:'older'}]); f.context.notifAct('chat',action);
 assert.equal(f.calls.some(([a])=>a==='open'),false); assert.equal(f.w.thread,null); assert.equal(f.draft.reply,null);
});
for (const after of ['stay','list']) for (const action of ['done','snooze']) test(`desktop alert stack ${action}, ${after}: unchanged, next alert opens in place`,()=>{
 const f=fixture(false,after,[{id:'older'}]); f.context.notifAct('chat',action);
 assert.deepEqual(f.calls.find(([a])=>a==='open'),['open','older']); assert.equal(f.w.thread,'__new__');
});
