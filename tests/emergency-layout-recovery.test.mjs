import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, read } from './fixtures/tweaks.mjs';

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
test('recovery uses shared Chats and hides the Classic bar; no render guard/backoff is shipped',()=>{
 const s=read('web/core/skin-host.js');assert.match(s,/const guard = \(a, where, fn\) => function \(\) \{ if \(a.dead\) return; try \{ return fn.apply\(this, arguments\); \} catch \(e\) \{ fault\(a, where, e\); \} \};/);
 assert.match(read('web/desktop/desktop.js'),/layoutRecovery\(on\)[\s\S]*CHATS.renderChatList/);assert.match(read('web/desktop/desktop.css'),/data-layout-recovery="chats"\] \.bar/);
});
