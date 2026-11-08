import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const cut = (a,b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
function fixture(phone, after, siblings = []) {
 const w = {id:'chat',app:'chats',thread:'__new__'}, state = {draft:'Keep typed words'}, calls = [], draft = {text:'Keep typed words',files:[],reply:{key:'notifications:synthetic'}};
 const item = {id:'synthetic',app:'notes'}, n = {id:item.id,item,acts:['done','snooze','restore']};
 const context = {window:{WosSkinHost:{inboxAct:(...args)=>calls.push(args)},WosBell:{mark:async ids=>{calls.push(['mark',ids]);return true;},route:()=> 'chats',setRoute:()=>true,movedToast(){}}},
  W:{chat:w},CH:{chat:state},H:{changed(){}},PHONE:()=>phone,keepThreadOpen:()=>!phone||after==='stay',owner:x=>x,notifOf:()=>n,ch:()=>state,vib(){},renderChats(){},toast(){},
  noteQuiet:()=>true,noteSiblings:()=>siblings,noteAt:i=>i.id==='synthetic'?2:1,noteRoute:()=> 'notes',
  KIT:{drafts:{get:()=>draft,clear:()=>{draft.reply=null;},setReply:(_k,r)=>{draft.reply=r;}}},
  chatsBack:()=>{w.thread=null;},
 };
 vm.createContext(context);
 vm.runInContext(cut('  function notifAct(', '  /* Where this notification'),context);
 vm.runInContext(cut('  async function notifDoneAll(', '  // Quiet thread'),context);
 vm.runInContext(cut('  function notifRoute(', '  /* Thread tracker:'),context);
 return {context,w,calls,draft};
}
for (const phone of [true,false]) for (const after of ['stay','list']) for (const action of ['done','snooze','restore','all','route']) test(`${phone?'phone':'desktop'} notification ${action}, ${after}`,async()=>{
 const f=fixture(phone,after);
 if(action==='all') await f.context.notifDoneAll('chat','synthetic');
 else if(action==='route') f.context.notifRoute('chat','notes','badge');
 else f.context.notifAct('chat',action);
 const retained=phone&&after==='stay'; assert.equal(f.w.thread,retained?'__new__':null);
 assert.equal(!!f.draft.reply,retained,'retained notification still owns its reply metadata');
});
for (const after of ['stay','list']) test(`phone notification stack ${after}: preserve same or old next-item behavior`,()=>{
 const f=fixture(true,after,[{id:'older'}]); f.context.notifAct('chat','done');
 assert.equal(f.calls.some(([action])=>action==='open'),after==='list');
 assert.equal(!!f.draft.reply,after==='stay');
});
