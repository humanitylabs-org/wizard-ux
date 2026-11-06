// Existing Android 0.9.15 share intents contain thread_id, not agent. Run actual web handoff functions.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(process.env.QA_WEB_DIR||__dirname,'web/app.js'),'utf8');
const start=source.indexOf('  function openWizardThread(');
const open=source.slice(start,source.indexOf('  /* ---------------- review',start));
const hs=source.indexOf('  let threadHandoffGeneration = 0;');
assert(hs>=0,'notification ownership barrier missing');
const handoff=source.slice(hs,source.indexOf("  $('#txChips').addEventListener",hs));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup({loaded=false,main=false,failed=false,rejected=false}={}) {
 let known=loaded,opened=[],errors=[],pending=[];
 const ctx={idx:0,HOME:0,W:{},desks:[{wins:[]}],LIVE:{agentStatus:{},agentOf:()=>known&&!main?'private':'',refresh(){},
  refreshAgents:()=>new Promise((resolve,reject)=>pending.push(()=>{if(rejected)return reject(Error('offline'));known=!failed;ctx.LIVE.agentStatus={private:{ok:!failed}};resolve()}))},
 closeSheets(){},goDesk(){},openWin(value){value.id='new';opened.push(value);return value},focusWin(){},openChat(wid,id){opened.find(w=>w.id===wid).thread=id},toast:(icon,text)=>errors.push(text)};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(open+'\n'+handoff,ctx);
 return {ctx,opened,errors,pending};
}
(async()=>{
 let passed=0;
 for(const loaded of [true,false]){
  const t=setup({loaded});assert.equal(t.ctx.__wosHandoff({action:'thread',id:'private-share'}),true);
  assert.equal(t.opened.length,0,'no main request before ownership lookup');t.pending.shift()();await tick();
  assert.equal(t.opened[0].agent,'private');passed++;
 }
 const main=setup({main:true});main.ctx.__wosHandoff({action:'thread',id:'main-share'});main.pending.shift()();await tick();assert.equal(main.opened[0].agent,undefined);passed++;
 for(const opts of [{failed:true},{rejected:true}]){const t=setup(opts);t.ctx.__wosHandoff({action:'thread',id:'unknown'});t.pending.shift()();await tick();assert.equal(t.opened.length,0);assert.equal(t.errors.length,1);passed++;}
 const t=setup();t.ctx.__wosHandoff({action:'thread',id:'older-thread'});t.ctx.__wosHandoff({action:'thread',id:'newer-thread'});t.pending[1]();await tick();t.pending[0]();await tick();assert.equal(t.opened.length,1);assert.equal(t.opened[0].thread,'newer-thread');passed++;
 console.log(JSON.stringify({passed,cases:['warm private','cold private','main unchanged','lookup unavailable fails closed','lookup rejected fails closed','latest notification wins']}));
})().catch(e=>{console.error(e);process.exitCode=1});
