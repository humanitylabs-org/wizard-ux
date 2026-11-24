import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as status from '../web/store/store-status.js';
import {projection, withPrivateCatalog, privateApps} from '../tools/store-private-catalog.mjs';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {storeContext, cut} from './fixtures/store-slice-harness.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';

const service={id:'screen-service',name:'Messenger-like',repo:'example/screen-service',type:'service',category:'app',has_view:true,commit:'a'.repeat(40)};
test('normalized service with UX is Apps, screenless service alone is Agent apps',()=>{
 assert.equal(status.storeKind(service),'apps');
 assert.equal(status.storeKind({...service,has_view:false}),'agent-apps');
 assert.equal(status.storeKind({type:'view'}),'apps');
 assert.equal(status.storeKind({type:'service',has_view:'true'}),'agent-apps');
});
test('explicit agents and connectors retain roles even when they have a setup view',()=>{
 for(const a of [{type:'agent'},{type:'service',category:'agent'}]) assert.equal(status.storeKind({...service,...a}),'agents');
 for(const a of [{type:'external'},{type:'service',category:'connector'}]) assert.equal(status.storeKind({...service,...a}),'connections');
});
test('feed carries presence only, never view source/build commands or private extras',()=>{
 const p=projection({...service,has_view:undefined,manifest:{view:{path:'/',source:{build:'DO_NOT_EXPOSE'}}},token:'DO_NOT_EXPOSE'});
 assert.equal(p.has_view,true);assert.equal(p.type,'service');assert.ok(!JSON.stringify(p).includes('DO_NOT_EXPOSE'));
 for(const view of [null,{},false,{path:''},{path:'//bad'},{path:'/\n'},{path:'/\\outside'},'https://',{url:'https://'},'javascript:bad']) assert.equal(projection({...service,has_view:undefined,view}).has_view,false);
 assert.equal(projection({...service,has_view:undefined,view:{open:'/screen/'}}).has_view,true);
 for(const view of ['/legacy/',{url:'https://example.test/screen/'},{path:'/screen/#item'}]) assert.equal(projection({...service,type:'legacy',has_view:undefined,view}).has_view,true);
});
test('every positive known UX stays out of Agent apps; legacy view type needs no flag',()=>{
 for(const type of ['service','view','legacy',undefined]) {
  const a=projection({...service,type});assert.equal(status.storeKind(a),'apps');
 }
 assert.equal(status.storeKind({type:'view',has_view:false}),'apps');
});
test('source merge, detail and raw packaging query preserve classification per release',async()=>{
 const proxy=withPrivateCatalog(async()=>({status:200,body:{apps:[service,{...service,id:'headless',repo:'example/headless',has_view:false}],next_offset:null}}),()=>[],{sourceRead:()=>null});
 const search=await proxy('/search',new URLSearchParams({type:'service',category:'app',q:'Messenger-like'}));
 assert.equal(search.body.total,2);assert.deepEqual(search.body.apps.map(status.storeKind),['apps','agent-apps']);
 const detail=await proxy('/apps/example/screen-service');
 assert.equal(detail.body.has_view,true);assert.equal(detail.body.releases[0].has_view,true);
 assert.equal((await proxy('/search',new URLSearchParams({type:'view'}))).body.total,0); // Packaging filters are NOT Store kinds.
});
test('legacy private views still work; explicit headless and connector records are not rewritten as view',()=>{
 const dir=mkdtempSync(join(tmpdir(),'store-kinds-'));
 try {
  const file=join(dir,'catalog.json');
  writeFileSync(file,JSON.stringify({schema:1,scope:'private-test',apps:[
   {...service,type:undefined,has_view:undefined},
   {...service,id:'headless',type:'service',has_view:false},
   {...service,id:'connector',type:'external'},
  ]}));
  assert.deepEqual(privateApps(file).map(status.storeKind),['apps','agent-apps','connections']);
 } finally {rmSync(dir,{recursive:true});}
});
test('detail behavior hint follows the shared UX kind, not service packaging',()=>{
 const s=readFileSync(new URL('../web/store/store.js',import.meta.url),'utf8');
 const expression=s.match(/const how = (\{[^\n]+\})\[k\.id\]/);
 const hints=vm.runInNewContext('('+expression[1]+')');
 assert.equal(hints[status.storeKind(service)],'Opens in its own Wizard window.');
 assert.doesNotMatch(hints[status.storeKind(service)],/background|no screen/i);
 assert.match(hints[status.storeKind({...service,has_view:false})],/Runs in the background/);
 assert.equal(hints[status.storeKind({...service,type:'agent'})],'An agent that lives on your Wizard.');
 assert.equal(hints[status.storeKind({...service,type:'external'})],'Connect an account once; every agent can use it.');
});
test('Store clean preserves strict view flag; all lists, query terms and detail labels share classifier',()=>{
 // clean(), search() and openKind() from store.js over the real storeKind (tests/fixtures/store-slice-harness.mjs).
 const shown=[];
 const ctx=storeContext(cut('  function search(q) {','\n  const removable =')+cut('  function openKind(id, keep) {','  function openApp(id)')+'\nthis.clean=clean;this.search=search;this.openKind=openKind;this.kindOf=kindOf;',
  {S:{apps:[],q:''},top:()=>'search',pop(){},push(){},window:{scrollTo(){}},showList:(title,list,sub)=>shown.push({title,ids:list.map(a=>a.id),sub})});
 assert.equal(ctx.clean({...service,has_view:'true'}).has_view,false,'only a real true is a view');
 assert.equal(ctx.clean(service).has_view,true);
 const apps=[ctx.clean(service),ctx.clean({...service,id:'quiet-service',name:'Quiet',has_view:false}),ctx.clean({...service,id:'helper',name:'Helper',type:'agent'}),ctx.clean({...service,id:'mail-link',name:'Mail link',type:'external'})];
 ctx.S.apps=apps;
 assert.deepEqual(apps.map(a=>ctx.kindOf(a).id),apps.map(status.storeKind),'one classifier');
 for(const k of ['apps','agent-apps','agents','connections']){ctx.openKind(k,true);assert.deepEqual(shown.at(-1).ids,apps.filter(a=>status.storeKind(a)===k).map(a=>a.id),k);}
 // A kind's word is a query term: "agent app" finds the screenless service, never the one with a screen.
 ctx.search('agent app');assert.deepEqual(shown.at(-1).ids,['quiet-service']);
 ctx.search('connector');assert.deepEqual(shown.at(-1).ids,['mail-link']);
 // the real showDetail: its Kind label and its hint come from the same kindOf as the lists
 const s=readFileSync(new URL('../web/store/store.js',import.meta.url),'utf8');
 for(const a of apps){
  const detail={innerHTML:''};
  const D=runRecording(`${block(s,'  function showDetail(id) {')}\nthis.showDetail=showDetail;`,{find:()=>a,selected:x=>x,kindOf:ctx.kindOf,hue:()=>['#000','#111'],S:{apps},esc:x=>String(x??''),
   $:id=>(id==='detail'?detail:{innerHTML:'',classList:{add(){},remove(){},toggle(){}},hidden:false,querySelector:()=>null}),action:()=>'',icon:()=>'',badge:()=>'',removable:()=>false,provenance:()=>({label:''}),cap:x=>x});
  try{D.showDetail(a.id);}catch(_){/* after the detail is drawn */}
  assert.ok(detail.innerHTML.includes(`<p>${ctx.kindOf(a).one}`),`${a.id}: the detail label reads the same kindOf`);
 }
});
