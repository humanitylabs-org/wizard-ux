import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, read } from './fixtures/tweaks.mjs';
import { withSkinHostParts } from './fixtures/skin-host-parts.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { styleOf } from './fixtures/mini-css.mjs';

test('three callback faults retain the mounted AI apps sidebar and choice', async () => {
 const f=fixture({shell:'desktop',initialStorage:{'wos.desktop-view.v1':'ai-apps'}});await f.host.whenLayoutReady();
 f.ctx.console={warn(){},error(){}};let disposed=0,healthy=0;
 f.host._test.setImporter(async()=>({default(api){api.mount(f.doc.createElement('aside'));api.on('render',()=>{throw Error('synthetic callback fault');});api.on('render',()=>healthy++);return()=>disposed++;}}));
 await f.host._test.loadLayout('ai-apps');for(let i=0;i<3;i++)f.host.rendered('thread',f.thread);
 assert.equal(f.host.layoutState.active,true);assert.equal(f.host.layoutState.disabled,false);assert.equal(disposed,0);assert.equal(healthy,3);assert.equal(f.host.layoutState.mounts,1);assert.equal(f.host.chatsClaimed(),true);assert.equal(f.lsMap.get('wos.desktop-view.v1'),'ai-apps');
});
test('failed layout import retries three times with backoff and unique URLs, then retains shared Chats',async()=>{
 const f=fixture({shell:'desktop',desktopView:null});await f.host.whenLayoutReady();f.ctx.console={warn(){},error(){}};
 const recovery=[],urls=[],delays=[];f.adapter.layoutRecovery=on=>recovery.push(on);
 f.ctx.setTimeout=(fn,ms)=>{delays.push(ms);queueMicrotask(fn);return 1;};
 f.host._test.setImporter(async href=>{urls.push(href);throw Error('synthetic import fault');});await f.host._test.loadLayout('ai-apps');
 assert.equal(urls.length,4);assert.equal(new Set(urls).size,4);assert.deepEqual(delays,[250,750,1500]);
 assert.ok(urls.slice(1).every(u=>u.includes('layout-retry=')));assert.equal(recovery.at(-1),true);assert.equal(f.host.layout,'ai-apps');assert.equal(f.host.layoutState.disabled,false);assert.equal(f.host.chatsClaimed(),false);
 assert.equal(f.doc.documentElement.dataset.layoutBooting,undefined);
 f.host._test.setImporter(async()=>({default(){return()=>{};}}));await f.host._test.loadLayout('ai-apps');assert.equal(recovery.at(-1),false);assert.equal(f.host.layoutState.active,true);
});
test('a transient import failure recovers on a cache-busted retry without entering Classic',async()=>{
 const f=fixture({shell:'desktop',desktopView:null});await f.host.whenLayoutReady();f.ctx.console={warn(){},error(){}};
 let calls=0;const recovery=[];f.adapter.layoutRecovery=on=>recovery.push(on);f.ctx.setTimeout=fn=>{queueMicrotask(fn);return 1;};
 f.host._test.setImporter(async()=>{if(++calls<3)throw Error('temporary');return{default(){return()=>{};}};});await f.host._test.loadLayout('ai-apps');
 assert.equal(calls,3);assert.equal(f.host.layoutState.active,true);assert.equal(recovery.includes(true),false);assert.equal(f.host.layout,'ai-apps');
});
// (The render guard itself: 'three callback faults retain the mounted AI apps sidebar and choice' above runs it.)
test('recovery uses shared Chats and hides the Classic bar; no render guard/backoff is shipped',()=>{
 const boot=read('web/desktop/desktop-boot.js'),css=read('web/desktop/desktop.css');
 const run=(wins)=>{
  const document=createDocument();document.body.innerHTML='<div class="bar"></div><div class="stage"><div class="wsp"><div class="win" id="w7"><div class="wbar"></div><div class="dchats"><div class="pane-list" data-chats="7::list"></div><div class="pane-main"></div></div></div></div></div>';
  const ctx={document,mainChats:{app:'chats'},findWin:()=>wins[0]||null,newWin:spec=>{ctx.made=spec;return wins[1]||null;},winEl:id=>document.getElementById('w'+id),listWin:id=>'list:'+id};
  runRecording('globalThis.parts = { '+block(boot,'layoutRecovery(on) {')+' };',ctx);
  return ctx;
 };
 const r=run([{id:7,thread:'s1'}]);r.parts.layoutRecovery(true);
 const html=r.document.documentElement,win=r.document.getElementById('w7');
 assert.equal(html.getAttribute('data-layout-recovery'),'chats');assert.equal(win.getAttribute('data-layout-recovery-chat'),'');
 const calls=r.calls.map(c=>c[0]);
 assert.deepEqual(r.calls.find(c=>c[0]==='CHATS.renderChatList').slice(1),['list:7',r.document.querySelector('[data-chats="7::list"]')],'the real Chats list renderer draws into the Chats window');
 assert.ok(calls.includes('CHATS.renderChats')&&calls.includes('focusWin')&&calls.includes('syncChatsPane'));
 const st=(sel,prop)=>styleOf(r.document.querySelector(sel),css,prop);
 assert.equal(st('.bar','display'),'none','the Classic bar is hidden');
 assert.equal(st('.wbar','display'),'none');assert.equal(st('.dchats','display'),'flex');assert.equal(st('.pane-list','display'),'block');
 assert.equal(st('.win','position'),'fixed','the Chats window fills the screen');
 r.parts.layoutRecovery(false);
 assert.equal(html.getAttribute('data-layout-recovery'),null);assert.equal(win.getAttribute('data-layout-recovery-chat'),null);
 assert.notEqual(st('.bar','display'),'none','the bar is back once recovered');
 const none=run([null,{id:7,thread:null}]);none.parts.layoutRecovery(true);
 assert.deepEqual({...none.made},{app:'chats',thread:null},'no Chats window: one is opened');
 assert.ok(!none.calls.some(c=>c[0]==='CHATS.renderChats'),'no thread to draw');
});
