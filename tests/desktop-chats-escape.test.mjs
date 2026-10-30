// Focused source-executed regression; QA_SOURCE_DIR supports the unchanged live tree.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=process.env.QA_SOURCE_DIR||fileURLToPath(new URL('../',import.meta.url));
const desktop=fs.readFileSync(path.join(root,'web/desktop/desktop.js'),'utf8');
const core=fs.readFileSync(path.join(root,'web/core/chats.js'),'utf8');
const esc=desktop.slice(desktop.indexOf('  function escStep()'),desktop.indexOf('  /* ---------------- hold left',desktop.indexOf('  function escStep()')));
const clear=core.slice(core.indexOf('  function clearFilter(w)'),core.indexOf('  const hasFilter',core.indexOf('  function clearFilter(w)')));
function fixture({thread='selected',q='quokka',filter='unread',inList=true,mono=false}={}){
 const state={q,filter}, other={q:'other'},w={id:'one',app:'chats',thread};
 const calls=[],document={activeElement:{}};
 const ctx={window:{WizCore:{chatSearch:{cancel:id=>calls.push('cancel:'+id)}}},document,
 ch:id=>id==='one::list'?state:other,rerenderList:()=>calls.push('render'),syncChatsPane:()=>calls.push('sync'),
 focused:()=>w,listWin:id=>({id:id+'::list',thread:null}),winEl:()=>({querySelector:()=>({contains:()=>inList,focus:()=>{}}),focus:()=>{}}),
 pal:{hidden:true},keyHints:{pinned:()=>false},LINKS:null,closeUsage:()=>false,settingsReturn:'',settingsFocused:()=>false,
 hudBack:()=>'',homeOpen:false,ws:[{mono}],cur:0,toggleMono:()=>calls.push('mono'),
 CHATS:{KIT:{},isHosted:()=>false,closeOverlay:()=>'',threadBack:()=>{w.thread=null;calls.push('thread');return 'thread';}},
 closeWin:()=>calls.push('close')};
 vm.createContext(ctx);vm.runInContext(clear,ctx);ctx.CHATS.clearFilter=ctx.clearFilter;vm.runInContext(esc,ctx);
 return {ctx,state,other,w,calls,step:()=>ctx.escStep()};
}
test('Escape in split search clears query, cancels its own run, preserves thread and chip',()=>{const f=fixture();assert.equal(f.step(),'search');assert.equal(f.state.q,'');assert.equal(f.state.filter,'unread');assert.equal(f.w.thread,'selected');assert.deepEqual(f.calls,['cancel:one::list','render','sync']);assert.equal(f.other.q,'other');});
test('search layer precedes desktop full-screen navigation',()=>{const f=fixture({mono:true});assert.equal(f.step(),'search');assert.ok(!f.calls.includes('mono'));});
test('filter sheet above text consumes one press only',()=>{const f=fixture();f.ctx.CHATS.closeOverlay=()=> 'filter-sheet';assert.equal(f.step(),'filter-sheet');assert.equal(f.state.q,'quokka');});
test('next press removes chip only',()=>{const f=fixture({q:''});assert.equal(f.step(),'filter');assert.equal(f.state.filter,'');assert.equal(f.w.thread,'selected');});
test('empty list root is inert',()=>{const f=fixture({q:'',filter:'',thread:null});assert.equal(f.step(),'');assert.deepEqual(f.calls,[]);});
test('thread-pane Escape still returns to list, preserves parked search',()=>{const f=fixture({inList:false});assert.equal(f.step(),'thread');assert.equal(f.state.q,'quokka');});
test('list-only window clears search without input focus',()=>{const f=fixture({inList:false,thread:null});assert.equal(f.step(),'search');});
test('palette above search consumes one press only',()=>{const f=fixture();f.ctx.pal.hidden=false;f.ctx.closePalette=()=>{f.ctx.pal.hidden=true;};assert.equal(f.step(),'palette');assert.equal(f.state.q,'quokka');});
for(const flags of [{repeat:true},{isComposing:true},{keyCode:229}])test('search Escape guard '+JSON.stringify(flags),()=>{
 const start=desktop.indexOf('  function onKey(e, fromFrame = false)');
 const prefix=desktop.slice(start,desktop.indexOf('    if (pick.active())',start));
 const ctx={};vm.createContext(ctx);vm.runInContext(prefix+' return "fell-through"; }',ctx);
 const e={key:'Escape',target:{matches:()=>true},preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...flags};
 assert.notEqual(ctx.onKey(e),'fell-through');if(flags.repeat){assert.equal(e.prevented,true);assert.equal(e.stopped,true);}
});
