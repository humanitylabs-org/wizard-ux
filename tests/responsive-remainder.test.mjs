import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../web/'+p,import.meta.url),'utf8');
function grammar(){
 const events=[],norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,'').trim();
 const app={id:'wizard-music',name:'Music'},box={console,Map,Set,URL,location:{href:'https://fixture.invalid/',origin:'https://fixture.invalid',hostname:'fixture.invalid'}};box.window=box;
 box.WizCore={norm};box.WosViews={TODAY:'2026-10-15',YESTERDAY:'2026-10-14'};
 box.WosMusic={available:()=>true,parse:s=>s==='pause the music'?{op:'pause',strong:true}:s==='next track'?{op:'next',strong:true}:null,run:c=>{events.push(['music',c.op]);return true;}};
 box.WosFeatures={entries:[{id:'maps',title:'Maps'},{id:'future',title:'Future view'}],open:(id,o)=>{events.push(['view',id,o]);return ['maps','future'].includes(id);}};
 box.WosSettings={route:(id,open)=>{if(!['help','skin','settings'].includes(id))return false;open(id);return true;}};
 vm.runInNewContext(read('core/commands.js'),box);
 const CHATS={matchFilters:s=>s==='ready'?[{field:'status',value:'ready'}]:[],addFilter:(_w,f)=>events.push(['filter',f]),clearAll:()=>events.push(['clear']),setQuery:(_w,q)=>events.push(['query',q])};
 const find=s=>['Music','music','wizard-music'].includes(s)?app:null;
 const parser=box.WosCommands.create({CHATS,APP:{'wizard-music':app},findApp:find,appByName:find,quickSearch:s=>/^web search /.test(s)?{query:s.slice(11),tab:'all',strong:true}:null,sendSnap:()=>({})});
 const host={focused:()=>({app:'chats'}),chats:CHATS,maps:(...x)=>events.push(['maps',...x]),search:(...x)=>{events.push(['search',...x]);return true;},settings:id=>events.push(['settings',id]),inbox:()=>{},launcher:()=>{},findApp:find,openApp:a=>{events.push(['app',a.id]);return true;},layout:c=>{events.push(['layout',c.action]);return true;}};
 return {box,events,parser,host};
}
test('one grammar handles music, app, filter, Maps, search, help and future registrations',()=>{
 const {box,events,parser,host}=grammar();
 for(const text of ['pause the music','next track','open music','filter ready','clear filters','web search custody','search maps for Bangkok','directions to Bangkok','help','open future']){
  const c=parser.parse(text,{view:{kind:'thread list'}},'command');assert(c,text);assert.notEqual(box.WosCommands.execute(c,text,host),false,text);
 }
 assert(events.some(x=>x[0]==='music'));assert(events.some(x=>x[0]==='filter'));assert(events.some(x=>x[0]==='maps'&&x[2]==='bangkok'));assert(events.some(x=>x[0]==='view'&&x[1]==='future'));
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
 for(const p of ['index.html','desktop.html'])for(const asset of ['views.js','views.css','commands.js','features.js','bound-view.js','capture-tools.js','music-voice.js','screen-capture.js','sel-menu.js'])assert(read(p).includes('core/'+asset),p+': '+asset);
 for(const p of ['app.js','desktop/desktop.js']){const s=read(p);assert(s.includes('WosFeatures.install('));assert(s.includes('WosCommands.create('));assert(s.includes('WosCommands.execute('));assert(s.includes('WosBoundView.create('));assert(s.includes('WosCaptureTools.'));assert(!s.includes('function localParse('));assert(!s.includes('function renderLevel('));}
});

test('finite audit has all 73 capabilities and complete 163-row crosswalk, without unclosed browser gaps',()=>{
 const d=JSON.parse(fs.readFileSync(new URL('../docs/responsive-capability-coverage.json',import.meta.url),'utf8'));
 assert.equal(d.features.length,73);const ids=new Set(d.features.map(f=>f.id));assert.equal(ids.size,73);assert.equal(d.legacy_crosswalk.length,163);for(const row of d.legacy_crosswalk)assert(ids.has(row.feature_id));
 for(const f of d.features.filter(f=>f.scope==='browser-common'))assert(['shared-implemented','shared-delivered-pr31','inherited-shared'].includes(f.status),f.id);
 const counts={};for(const f of d.features)counts[f.status]=(counts[f.status]||0)+1;assert.deepEqual(counts,d.counts);
});
