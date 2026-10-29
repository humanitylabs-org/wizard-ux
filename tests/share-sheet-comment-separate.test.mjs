import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const root = process.env.SHARE_TEST_TREE || path.resolve(import.meta.dirname, '..');
const read = p => readFileSync(path.join(root,p),'utf8');
const shared = read('web/core/share-wizard.js');
function sheet() { const window = {}; vm.runInNewContext(shared,{window,document:{addEventListener(){}}}); return window.WizShareWizard; }

test('James: Emailing x.pdf and filename subject are not an owner comment or shared quote', () => {
  const S = sheet(); assert.equal(typeof S.sharedText,'function');
  assert.equal(S.sharedText({text:'Emailing x.pdf',subject:'x.pdf',items:[{name:'x.pdf'}]}),'');
  assert.equal(S.sharedText({text:'x.pdf',items:[{name:'x.pdf'}]}),'');
  assert.equal(S.sharedText({text:'Please review x.pdf today',subject:'x.pdf',items:[{name:'x.pdf'}]}),'Please review x.pdf today');
  assert.equal(S.sharedText({text:'Emailing x.pdf to the whole team',items:[{name:'x.pdf'}]}),'Emailing x.pdf to the whole team');
  assert.equal(S.sharedText({text:'https://example.org',subject:'Link'}),'Link\nhttps://example.org');
  assert.equal(S.sharedText({text:'Same words',subject:'Same words'}),'Same words');
});
test('James: compose comment is first, empty by default, with exact optional placeholder', () => {
  assert.match(shared,/comment = ''/); assert.match(shared,/placeholder="Add a comment \(optional\)"/);
  assert.ok(shared.indexOf('class="dv-text"') < shared.indexOf('class="dv-sharing"'));
  assert.doesNotMatch(shared,/textarea[^\n]*\$\{esc\(text\)\}/);
});
test('James: Agent row is unconditional; one Chat picker starts with New chat, no radios', () => {
  assert.match(shared,/class="dv-row dv-agent"/); assert.match(shared,/class="dv-row dv-chat"/);
  assert.match(shared,/id:'__new__', title:'\+ New chat'/); assert.doesNotMatch(shared,/type="radio"|radiogroup/);
  assert.match(shared,/g.status !== 'running'/); assert.doesNotMatch(shared,/filter\([^\n]*privacy/);
});
test('James: changing agent resets Chat before a scoped fetch and guards stale responses', () => {
  assert.match(shared,/target = '__new__'; threads = \[\]; loading = true/);
  assert.match(shared,/&agent=\$\{encodeURIComponent\(agentId\)\}/);
  assert.match(shared,/seq !== loadSeq/); assert.match(shared,/chosenAgent = g; status.textContent = ''; loadThreads\(\)/);
});
test('James: outside tap closes the top layer like Back; picker is opaque and skin-driven', () => {
  assert.match(shared,/data-dvclose/); assert.match(shared,/closest\('\[data-dvclose\]'\)\) return back\(\)/);
  assert.match(shared,/if \(active.picker\) \{ active.closePicker\(\); return true; \}/);
  const css = read('web/core/share-wizard.css');
  assert.match(css,/\.dv-picker \{[^}]*linear-gradient[^}]*#2a233c/s);
  assert.match(css,/var\(--wz-base/); assert.match(css,/var\(--wz-accent/);
});
test('James: real Chats outbox receives explicit second-agent id for NEW and EXISTING chats, without inheriting another window route/model', async () => {
  const src = read('web/core/chats.js'), start = src.indexOf('  async function sendChat('), end = src.indexOf('  const picker =',start);
  for (const [sid,agent] of [['__new__','synthetic-private'],['existing-synthetic','synthetic-private'],['__new__','']]) {
    const writes=[], draft={draft:'Keep me',files:[]};
    const sandbox={window:{},INC:null,MAX_FILES:10,W:{w1:{id:'w1',app:'chats',thread:'unrelated'}},ch:()=>draft,
      joinWords:(a,b)=>[a,b].filter(Boolean).join('\n\n'),focusOf:()=>({kind:'space',key:'wrong-space'}),PW:{newModel(){throw Error('must not take the window model');}},winAgent:()=> 'wrong-agent',AGS:()=>null,
      KIT:{drafts:{get:()=>({}),clear(){throw Error('must not consume draft');}}},LIVE:{session:()=>null},OUTBOX:{async enqueue(it){writes.push(it);return {durable:true};}},viewContext:()=>'',isWorking:()=>false,pendRef:f=>f,renderChats(){},applyLayout(){},deskOf:()=>0};
    vm.runInNewContext(src.slice(start,end)+';this.sendChat=sendChat;',sandbox);
    await sandbox.sendChat('w1','my comment','shared',null,{sid,agent,away:true,seal:false,files:[{id:'pdf',name:'x.pdf',bytes:4,mime:'application/pdf'}]});
    assert.equal(writes.length,1); assert.equal(writes[0].agent || '',agent); assert.equal(writes[0].kind,sid==='__new__'?'new':'reply'); assert.equal(writes[0].files[0].name,'x.pdf'); assert.equal(draft.draft,'Keep me');
  }
});
test('James: native imports retain real text as a quote and queue kept indexes without reading bytes through JS', async () => {
  const src = read('web/device.js'), start = src.indexOf('  async function onShare('), end = src.indexOf('  /* ================= #21',start);
  const calls=[],meta={subject:'x.pdf',text:'Emailing x.pdf',from:'Synthetic source',items:[{n:0,name:'x.pdf',mime:'application/pdf',bytes:5,sha256:'a'.repeat(64)}]};
  const port={capability:async()=>({v:1}),async call(method,params){calls.push({method,params});return {queued:true};}};
  const d={shareMeta:()=>JSON.stringify(meta),shareDone(){throw Error('do not delete staged files early');},shareRead(){throw Error('resumable files stay native');}};
  const window={WosDevicePort:port,WizConfig:{has:()=>true},WizShareWizard:{async open(o){assert.equal(o.text,'Emailing x.pdf');assert.equal(o.comment,undefined);o.onPresented();await o.nativeQueue({agent:'synthetic-private',agentLabel:'Synthetic',target:'existing',note:'my note',keptItemIndexes:[0]});return 'sent';}}};
  const context={window,DEV:()=>d,J:JSON.parse,closeSheet(){},log(){},toast(){},readBlob(){throw Error('must not read');}};
  vm.runInNewContext(src.slice(start,end)+';this.onShare=onShare;',context); await context.onShare('share-synthetic');
  const q=calls.find(c=>c.method==='device.shares.queue');assert.equal(q.params.agent,'synthetic-private');assert.equal(q.params.thread,'existing');assert.equal(q.params.note,'my note');assert.deepEqual([...q.params.keptItemIndexes],[0]);
  assert.equal(calls.at(-1).method,'device.shares.finish');
});
test('James: Android adapter contains no second sheet UI and port authority stays in trusted shell', () => {
  const java = read('android/app/src/main/java/ai/wizards/os/share/ShareActivity.java');
  assert.doesNotMatch(java,/new EditText|showThreads|showAgents|setContentView|SheetBack|Send to Archimedes/);
  assert.match(java,/EXTRA_TEXT/); assert.match(java,/ACTION_SHARE/);
  const bridge = read('android/app/src/main/java/ai/wizards/os/device/DeviceBridge.java');
  assert.match(bridge,/ownsIncomingShare\(id\)/); assert.match(bridge,/ShareStore.get\(activity\).enqueue/);
  const main=read('android/app/src/main/java/ai/wizards/os/MainActivity.java');assert.match(main,/web.setAlpha\(0\)/); assert.match(main,/moveTaskToBack\(true\)/);
});
