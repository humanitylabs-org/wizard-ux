// The real experience migration and shared host API; no browser or installed owner state.
const clone = x => JSON.parse(JSON.stringify(x));
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(process.env.WIZARD_DESKTOP_SOURCE_ROOT ? process.env.WIZARD_DESKTOP_SOURCE_ROOT + '/' + p : new URL('../' + p, import.meta.url), 'utf8');
function boot({ shell = 'desktop', saved, choice, layout, preset, own, deferManifest, skin, storage } = {}) {
  const store = storage || new Map();
  if (skin) store.set('wos.skin', skin);
  if (saved) store.set('wos.skin-tweaks.v1', JSON.stringify(saved));
  if (choice) store.set('wos.desktop-view.v1', choice);
  if (layout) store.set('wos.layout', layout);
  let active = [], current = layout || 'classic';
  const H = { personalState: {ready:false}, layouts: ['classic','ai-apps'].map(id => ({id,name:id})),
    get layout() { return current; }, setLayout(id) { current = id; },
    setStandardLayout(id) { current = id; }, get tweakState() { return active; },
    async loadTweaks(ids) { active = ids; } };
  const events = [];
  const W = { WosMySkin: { active: own }, WosSkin: {current:'nebula', families:[{id:'mizel',tweaks:'miguel'}], familyOf:id=>id==='obsidian'?'mizel':'wizard'}, WosSkinHost:H, addEventListener(){}, dispatchEvent(e){ events.push(e); } };
  vm.runInNewContext(read('web/core/experience.js'), { window:W, document:{documentElement:{dataset:{shell}}, baseURI:'https://wizard.test/wizard-os-home/', addEventListener(){}},
    Event,CustomEvent:class { constructor(type,{detail}={}) {this.type=type;this.detail=detail;} },URL,AbortSignal,setTimeout(){}, localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},
    fetch:async u=>{ if (deferManifest && u.pathname.endsWith('/manifest.json')) await deferManifest(); return {ok:true,json:async()=>JSON.parse(read('web/'+u.pathname.split('/wizard-os-home/')[1]))}; } });
  return { E:W.WosExperience,H,W,events,store,active:()=>active };
}
const state = mix => ({version:1,off:{},preset:'none',mix,defaultsMigrated:true,machinesHomeMoved:true});
for (const [name, options, expected] of [
  ['fresh desktop',{},'ai-apps'],
  ['saved Desks',{saved:state({'miguel/ai-apps':false})},'classic'],
  // The Orb and Apps views went in wizard-ux issue 1338: a saved choice of either falls back to the standard view.
  ['saved Orb (removed)',{saved:state({'miguel/orb-shell':true})},'ai-apps'],
  ['saved AI apps',{saved:state({'miguel/ai-apps':true})},'ai-apps'],
  ['saved Apps (removed)',{saved:state({'miguel/apps-home':true})},'ai-apps'],
  ['unrelated tweak only',{saved:state({'miguel/snooze-someday':true})},'ai-apps'],
  ['preset only',{saved:{version:1,preset:'miguel',off:{}}},'ai-apps'],
  ['new saved Desks',{choice:'classic'},'classic'],
  ['legacy stored Orb (removed)',{layout:'orb'},'ai-apps'],
  ['legacy stored Apps (removed)',{layout:'apps'},'ai-apps'],
  ['saved Orb desktop view (removed)',{choice:'orb'},'ai-apps'],
  ['legacy stored Two orbs (removed)',{layout:'two-orb'},'ai-apps'],
  ['legacy carry offs',{saved:{version:1,preset:'miguel',off:{},carry:['miguel/orb-shell','miguel/apps-home','miguel/ai-apps']}},'classic'],
  ['legacy per-preset offs',{saved:{version:1,preset:'miguel',off:{miguel:['miguel/orb-shell','miguel/apps-home','miguel/ai-apps']},carry:['miguel/orb-shell','miguel/apps-home','miguel/ai-apps']}},'classic'],
  ['old per-skin offs without preset',{skin:'obsidian',saved:{version:1,off:{miguel:['miguel/orb-shell','miguel/apps-home','miguel/ai-apps']}}},'classic'],
  ['recipe explicit offs',{own:{tweaks:{'miguel/orb-shell':false,'miguel/apps-home':false,'miguel/ai-apps':false}}},'classic'],
  ['fresh phone',{shell:'phone'},'classic'],
]) test(name, async()=>{ const f=boot(options);await f.E.refresh(); assert.equal(f.E.state.error,'');assert.equal(f.H.layout,expected); if(options.shell==='phone') assert.equal(f.store.has('wos.desktop-view.v1'),false); });
test('standard desktop renderer never loads a personal view tweak; changes and refresh retain explicit Desks',async()=>{
 const f=boot();await f.E.refresh();assert(!f.active().includes('miguel/ai-apps'));assert(!f.active().includes('miguel/machines-home'));
 const p=f.E.chooseDesktopView('classic');assert.equal(f.H.layout,'classic','paints before awaiting apply');await p;await f.E.refresh();assert.equal(f.H.layout,'classic');
 await f.E.chooseDesktopView('ai-apps');assert.equal(f.H.layout,'ai-apps');assert(!f.active().includes('miguel/ai-apps'));
 await f.E.adopt({});assert.equal(f.H.layout,'ai-apps','shared tweaks cannot reset device shell choice');
});
test('legacy AI apps switch still selects the built-in desktop layout',async()=>{
 const f=boot();await f.E.refresh();await f.E.toggle('miguel/ai-apps');assert.equal(f.H.layout,'classic');await f.E.toggle('miguel/ai-apps');assert.equal(f.H.layout,'ai-apps');
});
test('overlapping refreshes retain pre-flatten explicit offs',async()=>{
 let release, reached; const atManifest=new Promise(r=>reached=r), held=new Promise(r=>release=r);
 const f=boot({saved:{version:1,preset:'miguel',off:{},mix:{'miguel/orb-shell':false,'miguel/apps-home':false,'miguel/ai-apps':false}}, deferManifest:async()=>{ reached(); await held; }});
 const a=f.E.refresh();await atManifest;const b=f.E.refresh();release();await Promise.all([a,b]);assert.equal(f.H.layout,'classic');
});

test('interrupted migration survives a reload after preset flattening',async()=>{
 let release,reached;const atManifest=new Promise(r=>reached=r),held=new Promise(r=>release=r);
 const f=boot({saved:{version:1,preset:'miguel',off:{},mix:{'miguel/ai-apps':false}},deferManifest:async()=>{reached();await held;}});
 const a=f.E.refresh();await atManifest;const g=boot({storage:f.store});await g.E.refresh();assert.equal(g.H.layout,'classic');release();await a;
});

test('unchosen desktop default never becomes a shared view seed or tweak choice', async()=>{
 const f=boot();await f.E.refresh();
 assert.deepEqual(clone(f.E.views),{});assert.ok(!f.E.mix['miguel/ai-apps']);
 assert.ok(!f.events.some(e=>e.type==='wos:view-choice'||e.type==='wos:tweak-choice'));
});
for (const [id,layout] of [['','classic'],['miguel/orb-shell','ai-apps'],['miguel/apps-home','ai-apps'],['miguel/ai-apps','ai-apps']]) test(`shared desktop intent ${id||'Desks'} overrides the local default`,async()=>{
 const f=boot();await f.E.refresh();await f.E.adopt({}, {desktop:id,phone:'miguel/orb-shell'});
 assert.equal(f.H.layout,layout);assert.equal(f.E.views.phone,'miguel/orb-shell');
 assert.ok(!f.active().some(id=>['miguel/ai-apps','miguel/apps-home','miguel/orb-shell'].includes(id)));
});
for (const [id,layout] of [['','classic'],['miguel/ai-apps','ai-apps']]) test(`last synced ${layout} survives an older document without views`,async()=>{
 const f=boot();await f.E.refresh();await f.E.adopt({}, {desktop:id});
 assert.equal(f.store.get('wos.desktop-view.v1'),layout,'canonical choice refreshes local fallback');
 await f.E.adopt({}, {});assert.equal(f.H.layout,layout,'old writer cannot restore a stale local view');
 const g=boot({storage:f.store});await g.E.refresh();assert.equal(g.H.layout,layout,'same after reload');
});
test('explicit desktop choice publishes only canonical view intent, preserving phone and shared defaults',async()=>{
 const f=boot();await f.E.refresh();await f.E.adopt({}, {desktop:'',phone:'miguel/orb-shell'}, {'wizard/unified-inbox':false});
 const before=f.E.defaultChoices;await f.E.chooseDesktopView('ai-apps');
 assert.deepEqual(clone(f.E.views),{desktop:'miguel/ai-apps',phone:'miguel/orb-shell'});
 assert.deepEqual(clone(f.E.defaultChoices),clone(before));
 assert.deepEqual(clone(f.events.filter(e=>e.type==='wos:view-choice').map(e=>e.detail)),[{shell:'desktop',id:'miguel/ai-apps'}]);
 assert.ok(!f.events.some(e=>e.type==='wos:tweak-choice'));
 await f.E.adopt({}, {desktop:'',phone:'miguel/orb-shell'});assert.equal(f.H.layout,'classic','newer shared Desks wins over device cache');
});
test('legacy shared supported view still wins before per-shell choices exist; a removed one does not',async()=>{
 const f=boot({choice:'classic'});await f.E.refresh();await f.E.adopt({'miguel/ai-apps':true},{});assert.equal(f.H.layout,'ai-apps','a supported old shared view beats the local fallback');
 const g=boot({choice:'classic'});await g.E.refresh();await g.E.adopt({'miguel/orb-shell':true},{});assert.equal(g.H.layout,'classic','a removed view in an old shared mix changes nothing');
});
test('migration is one-shot, including explicitly all views off',async()=>{
 const f=boot({saved:state({'miguel/orb-shell':false,'miguel/apps-home':false,'miguel/ai-apps':false})});await f.E.refresh();assert.equal(f.H.layout,'classic');
 const g=boot({choice:f.store.get('wos.desktop-view.v1')});await g.E.refresh();assert.equal(g.H.layout,'classic');
});
