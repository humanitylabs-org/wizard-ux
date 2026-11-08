import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import coreContract from './orb-core-contract.mjs';
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
function moduleFixture(saved, host = {}) {
  const storage=new Map(saved ? [['wos.orbSwitcher.v1',JSON.stringify(saved)]]:[]), listeners=new Map();
  const window={addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:(k,fn)=>{if(listeners.get(k)===fn)listeners.delete(k);},dispatchEvent(){}};
  const adapter={cancelGesture(){},hover(){},voice:{},apps:()=>[],openItems:()=>[],...host};
  const context={window,adapter,document:{querySelectorAll:()=>[],body:{classList:{remove(){}}}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},CustomEvent:class{},setTimeout,clearTimeout};
  const create=vm.runInNewContext(read('web/core/orb-switcher.js')+'\n;window.WosCreateOrbSwitcher;',context);
  return {create:()=>create(adapter),window,listeners,storage};
}
test('core radial initializes real defaults and tears down its global listeners',()=>{
  const f=moduleFixture(),o=f.create();
  assert.equal(f.window.WosOrbSwitcher,o);assert.equal(o.active(),true);assert.equal(o.get().quickTakes,false);
  assert.equal(o.get().pins.length,0);assert.equal(o.get().holdMs,300);assert.equal(f.listeners.size,2);
  coreContract(o,f.window);assert.equal(o.active(),false);assert.equal(f.window.WosOrbSwitcher,undefined);assert.equal(f.listeners.size,0);
  const again=f.create();assert.equal(again.active(),true);again.dispose();assert.equal(f.listeners.size,0);
});
test('radial saved configuration survives reload and preserves compact geometry',()=>{
  const f=moduleFixture({pins:['home','calendar'],voiceSlot:'far',holdMs:450,quickTakes:true}),o=f.create();
  assert.equal(o.get().pins.join(','),'home,calendar');assert.equal(o.get().voiceSlot,'far');assert.equal(o.get().holdMs,450);assert.equal(o.get().quickTakes,true);
  // Voice and Customize are fixed slots; every pin fills the inner ring first, open or closed.
  const slots=o._assign([{id:'calendar',desk:1,open:true}],'near');
  assert.equal(slots.length,3);
  assert.equal(slots.find(s=>s.kind==='voice').ring,0);
  assert.equal(slots.find(s=>s.kind==='custom').ring,1);
  assert.equal(slots.find(s=>s.item?.id==='calendar').ring,0);
  assert.ok(slots.every(s=>s.r1<=138));o.dispose();
});
test('phone loads core radial synchronously before shell, independent of tweak state; desktop/corner unchanged',()=>{
  const phone=read('web/index.html');
  assert.match(phone, /core\/orb-switcher\.css/);
  assert.ok(phone.indexOf('src="core/orb-switcher.js"') < phone.indexOf('src="app.js"'));
  assert.match(read('web/app.js'), /window\.WosCreateOrbSwitcher\(orbSwitcherHost\)/);
  assert.doesNotMatch(read('web/desktop.html'),/orb-switcher|orb-radial/);
  assert.match(read('web/app.js'),/WosOrbSwitcher\?\.active\(\) && !G\.corner/);
  assert.ok(!JSON.parse(read('web/tweaks/catalog.json')).tweaks.includes('wizard/orb-radial'));
  assert.ok(!JSON.parse(read('web/tweaks/wizard/profile.json')).tweaks.includes('wizard/orb-radial'));
});

test('pins survive a split desk without being replaced by its focused app or title',()=>{
  const f=moduleFixture({pins:['calendar','notes','wizard'],showOpen:true},{
    apps:()=>[{id:'calendar',name:'Calendar',html:'C'},{id:'notes',name:'Notes',html:'N'},{id:'wizard',name:'Chats',html:'W'}],
    openItems:()=>[{id:'notes',name:'Notes + Calendar',desk:2,appIds:['notes','calendar'],cur:true},{id:'unrelated',desk:3,appIds:['unrelated']}]
  }),o=f.create(),items=o._buildItems();
  assert.equal(items.map(x=>x.id).join(','),'calendar,notes,wizard');
  assert.equal(items[0].label,'Calendar');assert.equal(items[0].desk,2);assert.equal(items[0].open,true);assert.equal(items[0].cur,true);
  assert.equal(items[1].open,true);assert.equal(items[2].open,false);
  assert.equal(o._assign(items,'near').filter(s=>s.kind==='app').map(s=>s.item.id).join(','),'calendar,notes,wizard');
  o.dispose();
});
for(const voiceSlot of ['near','far'])test(`pins fill both rings in saved order with voice ${voiceSlot}`,()=>{
  const f=moduleFixture(),o=f.create(),pins=Array.from({length:13},(_,i)=>({id:`pin-${i}`,pinned:true,open:i%2===0}));
  const slots=o._assign(pins,voiceSlot),apps=slots.filter(s=>s.kind==='app');
  assert.equal(slots.length,15);assert.equal(apps.length,13);assert.equal(apps.map(s=>s.item.id).join(','),pins.map(s=>s.id).join(','));
  assert.equal(apps.filter(s=>s.ring===0).length,voiceSlot==='near'?5:6);
  assert.equal(apps.filter(s=>s.ring===1).length,voiceSlot==='near'?8:7);
  assert.equal(slots.find(s=>s.kind==='voice').ring,voiceSlot==='near'?0:1);assert.equal(slots.find(s=>s.kind==='voice').k,0);
  assert.equal(slots.find(s=>s.kind==='custom').ring,1);assert.equal(slots.find(s=>s.kind==='custom').k,8);
  assert.ok(slots.every(s=>s.r0===44||s.r0===92));assert.ok(slots.every(s=>s.r1===90||s.r1===138));
  const sparse=o._assign(pins.slice(0,4),voiceSlot);assert.equal(sparse.length,6);assert.equal(sparse.filter(s=>s.kind==='app'&&s.ring===1).length,0);
  assert.equal(o._assign([],voiceSlot).map(s=>s.kind).sort().join(','),'custom,voice');o.dispose();
});
test('old showOpen setting is ignored and never saved; pin order persists with bounded capacity',()=>{
 const f=moduleFixture({pins:['calendar','calendar','wizard'],showOpen:false}),o=f.create();
 assert.equal('showOpen' in o.get(),false);assert.equal(o.get().pins.join(','),'calendar,wizard');
 o.set({showOpen:true,pins:['wizard','calendar']});
 assert.equal(o.get().pins.join(','),'wizard,calendar');assert.equal('showOpen' in JSON.parse(f.storage.get('wos.orbSwitcher.v1')),false);
 o.set({pins:Array.from({length:20},(_,i)=>`p${i}`)});assert.equal(o.get().pins.length,13);o.dispose();
 const again=f.create();assert.equal(again.get().pins.length,13);again.dispose();
});
test('late app registry changes repaint Customize and unsubscribe on teardown',()=>{
 const f=moduleFixture(),o=f.create();assert.equal(typeof f.listeners.get('wizard:apps'),'function');f.listeners.get('wizard:apps')();o.dispose();assert.equal(f.listeners.has('wizard:apps'),false);
});
test('orb picker admits arbitrary registry apps without feature-id branches',()=>{
 const source=read('web/app.js');
 const start=source.indexOf('apps: () =>',source.indexOf('const orbSwitcherHost'));
 const end=source.indexOf('openItems:',start);
 const block=source.slice(start,end);
 assert.doesNotMatch(block,/a\.id\s*===|includes\(a\.id\)/);
 const expression=block.match(/APPS\.filter\((a => .*?)\)\s*\n\s*\.map/)[1];
 const predicate=vm.runInNewContext(expression,{window:{WizCore:{isMaintenanceApp:a=>a.maintenance===true}}});
 for(const id of ['random-app','app-store','agents','totally-new-package'])assert.equal(predicate({id,kind:'wizard'}),true);
 assert.equal(predicate({id:'random-app',kind:'wizard',maintenance:true}),false);
 assert.equal(predicate({id:'random-app',kind:'native'}),false);
});

test('stale pins remain removable at capacity without discarding saved choices or blocking a replacement',()=>{
 const source=read('web/core/orb-switcher.js');
 const pinRows=source.slice(source.indexOf('  function pinRows('),source.indexOf('  const seg ='));
 const clicks=source.slice(source.indexOf('  function onSheetClick('),source.indexOf('  function closeSheet('));
 for(const liveCount of [0,1]){
  let apps=[{id:'new-app',name:'New app',html:'N'},...(liveCount?[{id:'kept',name:'Kept app',html:'K'}]:[])];
  const cfg={pins:[...Array.from({length:13-liveCount},(_,i)=>'gone-'+i),...(liveCount?['kept']:[])]};
  const box={cfg,MAX_PINS:13,H:()=>({apps:()=>apps}),esc:String,UP2:'',sheet:{},closeSheet:()=>assert.fail('a pin click must not close settings'),set:next=>Object.assign(cfg,next)};
  vm.runInNewContext(pinRows+'\n'+clicks+'\nthis.rows=pinRows;this.click=onSheetClick',box);
  let html=box.rows();assert.equal((html.match(/aria-checked="true"/g)||[]).length,13);
  assert.match(html,/data-app="gone-0"[^]*?Unavailable app[^]*?data-pin><i>/,'missing app has an enabled removal switch');
  assert.match(html,/data-app="new-app"[^]*?data-pin disabled/,'full saved list still enforces capacity');
  const click=id=>box.click({target:{closest:s=>s==='[data-app]'?{dataset:{app:id}}:s==='[data-pin]'?{disabled:false}:null}});
  click('gone-0');assert.equal(cfg.pins.length,12);assert.equal(cfg.pins.includes('gone-0'),false);
  html=box.rows();assert.match(html,/data-app="new-app"[^]*?data-pin><i>/,'one removal frees an available switch');
  click('new-app');assert.equal(cfg.pins.length,13);assert.equal(cfg.pins.at(-1),'new-app');assert.equal(cfg.pins.includes('gone-1'),true,'unavailable choices are never silently erased');
  apps.push({id:'gone-1',name:'Restored app',html:'R'});assert.match(box.rows(),/data-app="gone-1"[^]*?Restored app/,'registry recovery resolves a saved pin');
 }
});

test('pinned app releases use shared placement, never a cached desk; empty and settings copy stay pins-only',()=>{
 const s=read('web/core/orb-switcher.js'),app=read('web/app.js');
 assert.match(s,/w\?\.kind === 'app'\) out = \{ kind: 'open', id: w\.item\.id \}/);
 assert.doesNotMatch(s,/kind: 'desk'|showOpen|Show open apps/);
 assert.match(s,/Hold the orb for pinned apps/);
 assert.match(s,/Pinned apps fill the radial\. Open desktops stay on swipe up\./);assert.match(s,/Pin apps in Customize/);
 assert.match(app,/else if \(out.kind === 'open'\) \{ const a = APP\[out.id\]; if \(a\) openApp\(a\); \}/);
});
