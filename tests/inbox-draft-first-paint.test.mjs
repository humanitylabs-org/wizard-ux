import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=process.env.SOURCE_ROOT || new URL('..',import.meta.url).pathname;
const kit=readFileSync(resolve(root,'web/core/chat-kit.js'),'utf8');
const chats=readFileSync(resolve(root,'web/core/chats.js'),'utf8');
function fixture(storage=new Map(),blocked=false) {
 const ctx={location:{origin:'https://wizard.example',hostname:'wizard.example',href:'https://wizard.example/'},localStorage:{getItem:k=>{if(blocked)throw Error('blocked');return storage.get(k)??null;},setItem:(k,v)=>{if(blocked)throw Error('blocked');storage.set(k,v);},removeItem:k=>storage.delete(k)},navigator:{},document:{addEventListener(){},querySelector:()=>null,createElement:()=>({style:{}})},addEventListener(){},setTimeout,clearTimeout,console,URL,Intl,Date};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(kit,ctx);return ctx.WosChat;
}
function shown(hint,age=0,host=false) {
 let now=0,scheduled=[],timers=[],events=[];
 const all={'new:aaaa':{text:'',files:[],reply:{key:'notification:synthetic'},at:1},'new:bbbb':{text:'owner words',files:[],reply:{key:'notification:synthetic'},at:2},'new:cccc':{text:'',files:[{name:'kept.txt'}],reply:{key:'notification:synthetic'},at:3},'new:dddd':{text:'',files:[],reply:{key:'app:reference'},at:4}};
 const ctx={KIT:{inboxHint:{get:()=>hint,set:v=>{hint=v;}},drafts:{all:()=>all,get:k=>all[k]}},window:{WosSkinHost:{inboxThreads:host},dispatchEvent:e=>events.push(e.type)},Event:class{constructor(type){this.type=type;}},Date:{now:()=>now},setTimeout:(fn,ms)=>{scheduled.push(ms);timers.push(fn);return 1;},NOTIF_KEY:/^notification:/};
 vm.createContext(ctx);
 // Execute the actual production list filter and its admission helpers, not a duplicate implementation.
 const begin=chats.indexOf('  const SAVED_NEW =');const end=chats.indexOf('  function draftRow(',begin);
 assert.ok(begin>=0&&end>begin);vm.runInContext(chats.slice(begin,end)+';globalThis.list=newDrafts;',ctx);
 now=age;return {keys:Array.from(ctx.list(),x=>x.key),scheduled,expire(){now=16000;timers.forEach(fn=>fn());return {hint,events,keys:Array.from(ctx.list(),x=>x.key)};}};
}
test('first paint remembers the inbox answer across reloads',()=>{const store=new Map(),a=fixture(store);assert.equal(a.inboxHint.get(),null);a.inboxHint.set(true);assert.equal(fixture(store).inboxHint.get(),true);a.inboxHint.set(false);assert.equal(fixture(store).inboxHint.get(),false);});
test('blocked storage does not throw or invent an answer',()=>{const k=fixture(new Map(),true);assert.equal(k.inboxHint.get(),null);k.inboxHint.set(true);assert.equal(k.inboxHint.get(),null);});
test('unknown first-load inbox hides only empty notification reply placeholders, preserves owner words/files/context',()=>{const out=shown(null);assert.deepEqual(out.keys,['new:dddd','new:cccc','new:bbbb']);assert.deepEqual(out.scheduled,[15100]);});
test('unknown inbox gets a bounded wait, then ordinary drafts are shown',()=>assert.ok(shown(null,16000).keys.includes('new:aaaa')));
test('stale true hint expires, clears storage and requests a real repaint',()=>{const f=shown(true);assert.ok(!f.keys.includes('new:aaaa'));const out=f.expire();assert.equal(out.hint,false);assert.deepEqual(out.events,['wos:prefs']);assert.ok(out.keys.includes('new:aaaa'));});
test('an active package still wins after the hint budget ends',()=>{const f=shown(true,0,true),out=f.expire();assert.equal(out.hint,true);assert.ok(!out.keys.includes('new:aaaa'));});
test('host hint follows thread registration, not list-only mode, and unregister clears it',()=>{
 const source=readFileSync(resolve(root,'web/core/skin-host.js'),'utf8'),start=source.indexOf('      threads(handlers = {}) {'),end=source.indexOf('      reply(id, words',start);
 let hint=null;const ctx={a:{id:'synthetic',offs:new Set()},guard:(_a,_s,fn)=>fn,inboxThreads:new Map(),window:{WosChat:{inboxHint:{set:v=>{hint=v;}}},dispatchEvent(){}},Event:class{}};vm.createContext(ctx);
 vm.runInContext('globalThis.api={'+source.slice(start,end)+'};globalThis.host={'+source.match(/get inboxThreads\(\) \{[^}]+\}/)[0]+'};',ctx);
 const off=ctx.api.threads({act(){},list:false});assert.equal(ctx.host.inboxThreads,true);assert.equal(hint,true);off();assert.equal(ctx.host.inboxThreads,false);assert.equal(hint,false);
});
test('known false shows replies immediately; known true or the active package suppresses only placeholders',()=>{assert.ok(shown(false).keys.includes('new:aaaa'));assert.ok(!shown(true).keys.includes('new:aaaa'));assert.ok(!shown(false,0,true).keys.includes('new:aaaa'));});
