'use strict';
// Browser-free exact-production old/new controller preflight; no capture or network.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {fixture}=require('./qa-recorder-controller.cjs');
async function run(file,old,unknown=false){
 const holds=new Set(),calls=[];
 const api={capture:{current:()=>null,pending:async()=>{if(unknown)throw Error('Synthetic unknown custody');return []}},update:{hold(reason){holds.add(reason);return {release(){holds.delete(reason);calls.push('release')}}}}};
 const html=fixture(fs.readFileSync(file,'utf8')),script=html.slice(html.lastIndexOf('<script>')+8,html.lastIndexOf('</script>'));
 const ctx={window:{WizardApp:api},DOMException,Set,Object,console,setInterval:()=>1,clearInterval(){},clearTimeout(){}};vm.createContext(ctx);
 await vm.runInContext(script,ctx,{timeout:1000});assert.equal(ctx.window.fixtureReady,true);assert.equal(ctx.window.fixtureError,undefined,'controller fixture setup');
 assert.equal(ctx.window.fixtureState.rec.phase,'error');
 if(old||unknown){assert(holds.has('Mizel recording'));assert.equal(calls.length,0)}else{assert.equal(holds.size,0);assert.equal(ctx.window.fixtureState.rec.engine,null);assert.deepEqual(calls,['release'])}
 return {source:file,old,unknown,holds:[...holds],phase:ctx.window.fixtureState.rec.phase};
}
(async()=>{const [oldFile,newFile]=process.argv.slice(2);assert(oldFile&&newFile,'baseline and candidate app.js required');const results=[await run(oldFile,true),await run(newFile,false),await run(newFile,false,true)];console.log(JSON.stringify({pass:true,results},null,2))})().catch(e=>{console.error(e);process.exitCode=1});
