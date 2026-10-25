import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../web/'+p,import.meta.url),'utf8');
function grammar(){
 const events=[],norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,'').trim();
 const app={id:'wizard-music',name:'Music'},box={console,Map,Set,URL,location:{href:'https://fixture.invalid/',origin:'https://fixture.invalid',hostname:'fixture.invalid'}};box.window=box;
 box.WizCore={norm};
 box.WosMusic={available:()=>true,parse:s=>s==='pause the music'?{op:'pause',strong:true}:s==='next track'?{op:'next',strong:true}:null,run:c=>{events.push(['music',c.op]);return true;}};
 box.WosFeatures={entries:[{id:'future',title:'Future view'}],open:(id,o)=>{events.push(['view',id,o]);return ['future'].includes(id);}};
 box.WosSettings={route:(id,open)=>{if(!['help','skin','settings'].includes(id))return false;open(id);return true;}};
 vm.runInNewContext(read('core/config.js'),Object.assign(box,{document:{addEventListener(){}}}));
 vm.runInNewContext(read('core/commands.js'),box);
 const CHATS={matchFilters:s=>s==='ready'?[{field:'status',value:'ready'}]:[],addFilter:(_w,f)=>events.push(['filter',f]),clearAll:()=>events.push(['clear']),setQuery:(_w,q)=>events.push(['query',q])};
 const find=s=>['Music','music','wizard-music'].includes(s)?app:null;
 const parser=box.WosCommands.create({CHATS,APP:{'wizard-music':app},findApp:find,appByName:find,quickSearch:s=>/^web search /.test(s)?{query:s.slice(11),tab:'all',strong:true}:null,sendSnap:()=>({})});
 const host={focused:()=>({app:'chats'}),chats:CHATS,search:(...x)=>{events.push(['search',...x]);return true;},settings:id=>events.push(['settings',id]),chatList:()=>{},launcher:()=>{},findApp:find,openApp:a=>{events.push(['app',a.id]);return true;},layout:c=>{events.push(['layout',c.action]);return true;}};
 return {box,events,parser,host};
}
test('one grammar handles music, app, filter, search, help and future registrations',()=>{
 const {box,events,parser,host}=grammar();
 for(const text of ['pause the music','next track','open music','filter ready','clear filters','web search custody','help','open future']){
  const c=parser.parse(text,{view:{kind:'thread list'}},'command');assert(c,text);assert.notEqual(box.WosCommands.execute(c,text,host),false,text);
 }
 assert(events.some(x=>x[0]==='music'));assert(events.some(x=>x[0]==='filter'));assert(events.some(x=>x[0]==='view'&&x[1]==='future'));
 for (const text of ['open week in review','open day','open month','zoom in','zoom out','directions to Bangkok','maps search Bangkok']) assert.equal(parser.parse(text,{},'command'),null,text);
 assert.equal(parser.parse('open inbox',{},'command').view,'chats');
 assert.equal(parser.parse('open notifications',{},'command').view,'chats');
 assert.equal(parser.parse('this is not a command',{},'command'),null);
 assert.equal(parser.parse('my normal one word reply',{view:{kind:'chat thread'}},'auto'),null);
});
test('explicit misses in phone never enter cloud routing; desktop command take is negative-send custody',()=>{
 const phone=read('app.js'),desk=read('desktop/desktop.js');
 const h=phone.slice(phone.indexOf('  async function handleText'),phone.indexOf('  /* Hold-command'));
 assert(h.indexOf("if (kind === 'command' && !typed) return holdNoMatch")<h.indexOf("endpoint('route')"));
 const command=desk.slice(desk.indexOf('    if (commandTake)'),desk.indexOf('    if (vConversation)'));
 assert(command.includes('retainDictation'));assert(command.includes('transcribeDictation'));assert(!command.includes('enqueue('));
});
test('general bound-view lifecycle preserves origin and manual dismissal',()=>{
 const {box}=grammar();vm.runInNewContext(read('core/bound-view.js'),box);
 const windows=[{id:'origin',app:'chats',thread:'original',agent:'private'}],closed=[];
 const anchor={hasAttribute:()=>false,closest:()=>null,getAttribute:()=>'/report/one'};
 const node={textContent:'Published view',querySelectorAll:()=>[anchor]};const el={querySelectorAll:()=>[node],querySelector:()=>null};
 const manager=box.WosBoundView.create({windows:()=>windows,win:id=>windows.find(w=>w.id===id),findApp:()=>null,APP:{},linkTitle:()=> 'Report',title:()=> 'Origin',visible:()=>true,open:w=>windows.push({...w,id:'bound'}),close:id=>{closed.push(id);windows.splice(windows.findIndex(w=>w.id===id),1);},reload(){}});
 manager.shown('origin',el);assert.equal(windows[1].from.sid,'original');assert.equal(windows[1].from.agent,'private');assert(Object.isFrozen(windows[1].from));
 manager.dismiss(windows[1]);windows.pop();manager.shown('origin',el);assert.equal(windows.length,1);
 manager.shown('origin',null);manager.shown('origin',el);assert.equal(windows.length,2);
 windows[0].thread='new-thread';manager.shown('origin',null);assert.deepEqual(closed,['bound']);
});
test('feedback rejects a missing route rather than targeting current focus',async()=>{
 const {box}=grammar();vm.runInNewContext(read('core/bound-view.js'),box);let calls=0;
 assert.equal(await box.WosBoundView.feedback({enqueue:()=>calls++},{thread:'original'},'words'),false);assert.equal(calls,0);
});
test('both adapters mount common nonsettings views, command grammar and capture tools',()=>{
 for(const p of ['index.html','desktop.html'])for(const asset of ['views.css','commands.js','features.js','bound-view.js','capture-tools.js','music-voice.js','screen-capture.js','sel-menu.js'])assert(read(p).includes('core/'+asset),p+': '+asset);
 for(const p of ['app.js','desktop/desktop.js']){const s=read(p);assert(s.includes('WosFeatures.install('));assert(s.includes('WosCommands.create('));assert(s.includes('WosCommands.execute('));assert(s.includes('WosBoundView.create('));assert(s.includes('WosCaptureTools.'));assert(!s.includes('function localParse('));assert(!s.includes('function renderLevel('));}
});


test('ordinary thread words remain replies while explicit commands still work',()=>{
 const {parser}=grammar();
 for(const text of ['help','settings','open music','open inbox']){
  const snap={view:{kind:'chat thread'}};
  assert.equal(parser.parse(text,snap,'auto'),null,text);
  assert(parser.parse(text,snap,'command'),text);
 }
});
test('phone non-recorded review feedback resolves only its original thread, or stays held',async()=>{
 const source=read('app.js');const start=source.indexOf('  async function sendReview('),end=source.indexOf('  function deliverToView',start);
 const calls=[],ctx={window:{WosModels:{snapshot:sid=>({model:'private-model',provider:'p',agent:'private',sid})},WosBoundView:{feedback:async(o,t,text)=>{calls.push(t);return {state:'queued'};}}},OUTBOX:{stage:async o=>{calls.push(o);return {id:'kept'};},transition:async(...x)=>calls.push(x)},reviewContext:()=>'',setVoice(){},toast(){}};
 vm.runInNewContext(source.slice(start,end),ctx);
 await ctx.sendReview({thread:'private-original'},'Looks good',null);
 assert.equal(calls[0].thread,'private-original');assert.equal(calls[0].route.agent,'private');
 calls.length=0;ctx.window.WosModels.snapshot=()=>{throw Error('route down')};
 const result=await ctx.sendReview({thread:'private-original'},'Keep original',null);
 assert.equal(result.id,'kept');assert.equal(calls[0].sessionId,'private-original');assert.equal(calls[0].kind,'reply');assert.equal(calls[1][1],'held');
});

test('finite audit has all 72 capabilities and complete 163-row crosswalk, without unclosed browser gaps',()=>{
 const d=JSON.parse(fs.readFileSync(new URL('../docs/responsive-capability-coverage.json',import.meta.url),'utf8'));
 assert.equal(d.features.length,72);const ids=new Set(d.features.map(f=>f.id));assert.equal(ids.size,72);assert.equal(d.legacy_crosswalk.length,163);for(const row of d.legacy_crosswalk)assert(ids.has(row.feature_id));
 for(const f of d.features.filter(f=>f.scope==='browser-common'))assert(['shared-implemented','shared-delivered-pr31','inherited-shared'].includes(f.status),f.id);
 const counts={};for(const f of d.features)counts[f.status]=(counts[f.status]||0)+1;assert.deepEqual(counts,d.counts);
});
