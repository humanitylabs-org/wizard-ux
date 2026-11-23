import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import { shareSheet, flush } from './fixtures/share-sheet-harness.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { runOpaque } from './fixtures/r8A-opaque-overlays.mjs';
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
test('James: compose comment is first, empty by default, with exact optional placeholder', async () => {
  // the real sheet (tests/fixtures/share-sheet-harness.mjs): shared text is quoted below, never put in the comment
  const h = shareSheet(); h.S.open({ text: 'https://example.org' }); await flush();
  const box = h.q('.dv-text');
  assert.equal(box.value, '', 'the comment starts empty');
  assert.equal(box.getAttribute('placeholder'), 'Add a comment (optional)');
  const compose = h.q('.dv-compose').children.map(e => e.className);
  assert.deepEqual(compose, ['dv-text', 'dv-sharing'], 'the comment comes before what is shared');
  assert.equal(h.q('.dv-quote').textContent, 'https://example.org');
});
test('James: Agent row is unconditional; one Chat picker starts with New chat, no radios', async () => {
  const h = shareSheet({ agents: [{ id: 'hermes', label: 'Wizard', is_default: true, status: 'running' }, { id: 'merlin', label: 'Merlin', status: 'stopped', privacy: 'private' }] });
  h.S.open({ text: 'hi' }); await flush();
  assert.ok(h.q('.dv-row.dv-agent') && h.q('.dv-row.dv-chat'), 'both rows, whatever the agents');
  h.tap('.dv-chat');
  assert.deepEqual(h.all('[data-dvpick]').map(b => b.dataset.dvpick), ['__new__', 't1'], 'New chat first, then recent chats');
  assert.match(h.all('[data-dvpick]')[0].textContent, /^\+ New chat/);
  assert.equal(h.all('input[type="radio"], [role="radiogroup"]').length, 0);
  h.tap('.dv-picker-scrim'); h.tap('.dv-agent');
  const rows = h.all('[data-dvpick]');
  assert.deepEqual(rows.map(b => [b.dataset.dvpick, b.disabled]), [['hermes', false], ['merlin', true]], 'every agent is listed (none hidden for privacy); stopped ones cannot be picked');
});
test('James: changing agent resets Chat before a scoped fetch and guards stale responses', async () => {
  const h = shareSheet({ hold: true }); h.S.open({ text: 'hi', dest: 't1' }); await flush(); await h.release();
  assert.equal(h.q('.dv-chat strong').textContent, 'Plans', 'the retry destination is kept on first load');
  h.tap('.dv-agent'); h.tap(h.all('[data-dvpick]').find(b => b.dataset.dvpick === 'merlin')); await flush();
  assert.equal(h.q('.dv-chat strong').textContent, 'New chat', 'a new agent starts on New chat');
  assert.equal(h.q('[data-sharesend]').disabled, true, 'Send waits for that agent\'s chats');
  assert.match(h.fetches.at(-1), /&agent=merlin$/, 'its chats are asked for by agent id');
  await h.release();
  // a slow answer for the earlier agent must not replace the newer agent's chats
  h.tap('.dv-agent'); h.tap(h.all('[data-dvpick]').find(b => b.dataset.dvpick === 'hermes')); await flush();
  h.tap('.dv-agent'); h.tap(h.all('[data-dvpick]').find(b => b.dataset.dvpick === 'merlin')); await flush();
  const [stale, fresh] = h.pending.splice(0); fresh(); await flush(); stale(); await flush();
  h.tap('.dv-chat');
  assert.deepEqual(h.all('[data-dvpick]').map(b => b.dataset.dvpick), ['__new__', 'm1'], 'only the chosen agent\'s chats');
  assert.equal(h.q('[data-sharesend]').disabled, false);
});
test('James: outside tap closes the top layer like Back; picker is opaque and skin-driven', async () => {
  const h = shareSheet(); const done = h.S.open({ text: 'hi' }); await flush();
  h.tap('.dv-chat'); assert.ok(h.q('.dv-picker'));
  h.tap('.dv-sheet [data-dvclose]'); assert.equal(h.q('.dv-picker'), null, 'Cancel with a chooser open closes the chooser');
  assert.ok(h.q('.wz-share'), 'and the sheet stays');
  h.tap('.dv-chat'); assert.equal(h.S.back(), true); assert.equal(h.q('.dv-picker'), null, 'system Back closes the chooser first');
  assert.ok(h.q('.wz-share'));
  h.S.back(); assert.equal(h.q('.dv-backhint').textContent, 'Press back again to cancel', 'a sheet with content warns once');
  h.tap('.dv-scrim'); assert.equal(h.q('.wz-share'), null, 'the scrim closes at once');
  assert.equal(await done, 'cancelled');
  // the chooser the real sheet drew, cascaded with the real share-wizard.css: opaque, from the skin's tokens
  const css = read('web/core/share-wizard.css');
  const again = shareSheet(); again.S.open({ text: 'hi' }); await flush(); again.tap('.dv-chat');
  const bg = cascade(again.q('.dv-picker'), css).background?.value || '';
  assert.match(bg, /^linear-gradient\(var\(--dv-raised\), ?var\(--dv-raised\)\), ?linear-gradient\(var\(--dv-base\), ?var\(--dv-base\)\) black$/, 'raised over base over a black backstop: never see-through (no literal colours: style ratchet)');
  const tokens = cascade(again.q('.wz-share'), css);
  assert.match(tokens['--dv-base']?.value || '', /var\(--wz-base\)/, 'the base follows the skin');
  assert.equal(tokens['--dv-accent']?.value, 'var(--wz-accent)', 'the accent follows the skin');
});
test('James: every share panel uses opaque panel tokens; pixel guard includes rows, cards and options', async () => {
  const css=read('web/core/share-wizard.css');
  // the real sheet with its chooser open, asked what wins on what it drew
  const h = shareSheet(); h.S.open({ text: 'hi' }); await flush();
  h.tap('.dv-chat');
  const root = cascade(h.q('.wz-share'), css);
  assert.match(root['--dv-base']?.value || '', /^var\(--wz-panel/, 'the sheet base is the opaque panel role');
  const rows = h.all('.wz-share .dv-row'), opts = h.all('.wz-share .dv-picker button');
  assert.ok(rows.length && opts.length, 'rows and chooser options are drawn');
  for (const el of [...rows, ...opts]) {
    const got = cascade(el, css);
    assert.ok(got.background?.value, 'a background of its own');
    assert.notEqual(got.background.value.trim(), 'transparent', el.className);
    assert.equal(got['backdrop-filter'], undefined, 'no see-through blur');
  }
  // the real pixel guard (tools/qa-opaque-overlays.cjs, fake Chromium) checks each share surface on the real share CSS
  for (const [name, cls] of [['share-compose','dv-compose'],['share-destination','dv-dest'],['share-agent-row','dv-row dv-agent'],['share-chat-row','dv-row dv-chat'],['share-message','dv-quote'],['share-attachment','ch-att'],['share-picker','dv-picker'],['share-option',''],['share-backhint','dv-backhint']]) {
    const run = await runOpaque({ filter: name });
    assert.ok(run.result?.checked > 0, `${name}: checked`);
    const panel = run.pages[0].doc.querySelector('[data-qa-panel]');
    assert.equal(panel.className, cls, name); assert.ok(panel.closest('.wz-share'), `${name}: inside the share sheet`);
    if (name === 'share-option') assert.equal(panel.tagName.toLowerCase(), 'button'), assert.equal(panel.parentElement.className, 'dv-picker');
  }
});
test('James: real Chats outbox receives explicit second-agent id for NEW and EXISTING chats, without inheriting another window route/model', async () => {
  const src = withParts(read('web/core/chats.js')), start = src.indexOf('  async function sendChat('), end = src.indexOf('  const picker =',start);
  for (const [sid,agent] of [['__new__','synthetic-private'],['existing-synthetic','synthetic-private'],['__new__','']]) {
    const writes=[], draft={draft:'Keep me',files:[]};
    const sandbox={window:{},INC:null,MAX_FILES:10,W:{w1:{id:'w1',app:'chats',thread:'unrelated'}},ch:()=>draft,
      joinWords:(a,b)=>[a,b].filter(Boolean).join('\n\n'),focusOf:()=>({kind:'space',key:'wrong-space'}),PW:{newModel(){throw Error('must not take the window model');}},winAgent:()=> 'wrong-agent',AGS:()=>null,
      KIT:{drafts:{get:()=>({}),clear(){throw Error('must not consume draft');}}},LIVE:{session(){throw Error('must not borrow unqualified window session');}},OUTBOX:{async enqueue(it){writes.push(it);return {durable:true};}},viewContext(){throw Error('must not scrape another window context');},isWorking:()=>false,pendRef:f=>f,renderChats(){},applyLayout(){},deskOf:()=>0};
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
test('legacy native transport keeps staged custody when the sheet cannot open', async () => {
  const src=read('web/device.js'),start=src.indexOf('  async function onShare('),end=src.indexOf('  /* ================= #21',start);
  for(const result of ['unsupported','sent','cancelled']) {
    let finished=0;const d={shareMeta:()=>JSON.stringify({subject:'x.pdf',text:'Emailing x.pdf',items:[]}),shareDone(){finished++;}};
    const window={WizShareWizard:{async open(options){assert.equal(options.durable,true);assert.equal(options.nativeQueue,null);assert.equal(options.android,true);return result;}}};
    const context={window,DEV:()=>d,J:JSON.parse,closeSheet(){},log(){},toast(){},readBlob(){throw Error('no reads');}};
    vm.runInNewContext(src.slice(start,end)+';this.onShare=onShare;',context);await context.onShare('synthetic');
    assert.equal(finished,result==='unsupported'?0:1);
  }
});
test('a permission revoked while another delivery holds the lane never sends', async()=>{
  const source=read('web/core/share-wizard.js'),start=source.indexOf('  async function deliver('),end=source.indexOf('  async function carry(',start);
  const laneSource=source.split('\n').find(line=>line.includes('const inLane ='));
  let release,authorized=true;const sent=[],first=new Promise(r=>release=r);
  const sandbox={jobs:0,lane:Promise.resolve(),retries:[],carry:async(w,chats,job)=>{sent.push(job.id);if(job.id===1)await first;return 'sent';}};
  vm.runInNewContext(laneSource+'\n'+source.slice(start,end)+';this.deliver=deliver;',sandbox);
  const w={},chats={},one=sandbox.deliver(w,chats,{id:1,files:[],authorize:()=>true});
  for(let n=0;n<10;n++)await Promise.resolve();
  const two=sandbox.deliver(w,chats,{id:2,files:[],authorize:()=>authorized});
  for(let n=0;n<10;n++)await Promise.resolve();authorized=false;release();
  assert.equal(await one,'sent');assert.equal(await two,'unsupported');assert.deepEqual(sent,[1]);
});
test('real share discovery rejects ambiguous IDs and never substitutes a missing explicit agent',()=>{
  const start=shared.indexOf('  function shareAgents('),end=shared.indexOf('  // Android',start),window={};
  vm.runInNewContext(shared.slice(start,end)+';Object.assign(window,{shareAgents,initialAgent});',{window});
  const main={id:'main',is_default:true,status:'running'},other={id:'private',status:'running'};
  for(const rows of [[main,{id:'',status:'running'}],[main,{id:' private',status:'running'}],[main,other,{...other}],[main,{id:'another',is_default:true}],[{...main,is_default:'false'}],[],{}])assert.throws(()=>window.shareAgents(rows));
  const agents=window.shareAgents([main,other]);assert.equal(window.initialAgent(agents,{}).id,'main');assert.equal(window.initialAgent(agents,{agent:'private'}).id,'private');
  assert.throws(()=>window.initialAgent([main],{agent:'private'}));assert.throws(()=>window.initialAgent([other],{agent:''}));
});
test('resumable import with all files removed still waits for the ordinary web receipt',async()=>{
  const source=read('web/device.js'),start=source.indexOf('  async function onShare('),end=source.indexOf('  /* ================= #21',start);
  let resolve,opened=false;const calls=[],meta={items:[{n:0,name:'x.pdf',bytes:4,mime:'application/pdf',sha256:'a'.repeat(64)}]};
  const port={capability:async()=>({v:1}),async call(method){calls.push(method);return {queued:true};}};
  const window={WosDevicePort:port,WizConfig:{has:()=>true},WizShareWizard:{open(options){assert.equal(options.durable,true);assert.equal(typeof options.nativeQueue,'function');opened=true;return new Promise(r=>resolve=r);}}};
  const sandbox={window,DEV:()=>({shareMeta:()=>JSON.stringify(meta)}),J:JSON.parse,closeSheet(){},log(){},toast(){}};
  vm.runInNewContext(source.slice(start,end)+';this.onShare=onShare;',sandbox);const pending=sandbox.onShare('synthetic');
  for(let n=0;n<10;n++)await Promise.resolve();assert.equal(opened,true);assert.deepEqual(calls,[]);resolve('sent');await pending;assert.deepEqual(calls,['device.shares.finish']);
});
test('legacy async native file reads are awaited after close, never uploaded as [object Promise]',async()=>{
  const start=shared.indexOf('  async function deliver('),end=shared.indexOf('  async function carry(',start);let reads=0;const uploads=[];
  const sandbox={jobs:0,File,blob:x=>x instanceof Blob,inLane:fn=>fn(),carry:async()=> 'sent'};
  vm.runInNewContext(shared.slice(start,end)+';this.deliver=deliver;',sandbox);
  const job={authorize:()=>true,files:[{name:'x.pdf',type:'application/pdf',async 'read'(){reads++;return new Blob(['exact native bytes']);}}]};
  const result=await sandbox.deliver({}, {async uploadFile(file){uploads.push(file);assert.equal(await file.text(),'exact native bytes');return {id:'uploaded'};}},job);
  assert.equal(result,'sent');assert.equal(reads,1);assert.equal(uploads.length,1);assert.equal(uploads[0].name,'x.pdf');
});
// APK source is outside this web-only port: the shipped APK is retained, not rebuilt.
// Its newer native-only adapter assertions remain in the archived live source and future APK acceptance.
