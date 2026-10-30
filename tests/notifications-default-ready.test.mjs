import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read = p => readFileSync(new URL('../'+p, import.meta.url), 'utf8');

test('notification-only Ready survives an empty default main-agent Chats list', () => {
  const src = read('web/core/chats.js');
  // Evaluate the real eligibility expression across every Focus/status/search boundary.
  const expr = src.match(/const listNotes = ([^;]+);/)[1];
  for (const [n,F,AGID,focus,visible] of [
    ['',null,'',null,true], ['',null,'',{kind:'agent',key:'hermes'},true],
    ['',null,'other',{kind:'agent',key:'other'},false], ['',null,'',{kind:'space',key:'test'},false],
    ['query',null,'',null,false], ['',{label:'Working'},'',null,false],
  ]) assert.equal(!!vm.runInNewContext(expr,{n,F,AGID,focus,notes:()=>({awake:[{}],later:[]})}),visible);
  assert.match(src,/else if \(filtered && !hit.length && !listNotesN\)/);
  assert.match(src,/else if \(!hit.length && !drafts.length && !listNotesN\)/);
  assert.match(src,/const nt = k === 'ready' \? listNotes : null/);
  assert.match(src,/\|\| filtered\) && !notesN\) return ''/);
  assert.ok(src.indexOf('const listNotes =') < src.indexOf('else if (filtered && !hit.length'));
});

test('Home Ready counts unread and snoozed notification rows but not completed rows or an off inbox', async () => {
  let items=[{id:'unread',read:false},{id:'snoozed',read:true},{id:'done',archived:true}], events=[];
  const window={WosSkinHost:{inboxList:true},WizCore:{backendApps:()=>[{id:'notifications'}]},dispatchEvent:e=>events.push(e.type)};
  const ctx={window,document:{querySelectorAll:()=>[],addEventListener(){}},location:{origin:'https://wizard.example.test'},addEventListener(){},setInterval(){},setTimeout(){},CustomEvent:class{constructor(type){this.type=type;}},fetch:async url=>({ok:true,json:async()=>url.includes('/items')?{items}:{unread:1,needs:1}})};
  vm.runInNewContext(read('web/core/notif-bell.js'),ctx);
  const bell=window.WosBell;
  bell.watch(()=>{}); await new Promise(r=>setImmediate(r));
  assert.equal(bell.readyCount(),2); assert.ok(events.includes('wizard:notifications'));
  window.WosSkinHost.inboxList=false; assert.equal(bell.readyCount(),0);
  window.WosSkinHost.inboxList=true;
  items=items.map(i=>({...i,archived:true}));
  await bell.mark(['unread','snoozed'],{archived:true}); assert.equal(bell.readyCount(),0);
});

test('phone and desktop Home and Chats badge use the notification Ready count and repaint when it changes', () => {
  for(const file of ['web/app.js','web/desktop/desktop.js']) {
    const src=read(file);
    assert.equal((src.match(/\+ \(window\.WosBell\?\.readyCount\?\.\(\) \|\| 0\)/g)||[]).length,2,file);
    assert.match(src,/addEventListener\('wizard:notifications',/);
  }
});
