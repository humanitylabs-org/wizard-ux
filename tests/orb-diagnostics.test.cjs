'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {metrics,uniformHistory,Collector,expectedCases,png}=require('../tools/qa-orb-diagnostics.cjs');
// Synthetic analytic fixtures for classifier regression only; never presented as browser evidence.
function fixture(kind){const s={w:128,h:128,data:[]};for(let y=0;y<s.h;y++)for(let x=0;x<s.w;x++){
 const r=Math.hypot((x+.5)*2/s.w-1,(y+.5)*2/s.h-1);let rgb=[x,y,(x*7+y*11)%200];
 if((kind==='core'&&r<.27)||(kind==='disc'&&r<.64&&r>.025))rgb=[255,255,255];
 if(kind==='disc'&&r<=.025)rgb=[0,240,240];s.data.push(...rgb,255);
}return s;}
test('legacy quarter-white boundary is retained as diagnostic, not confused with a broad disc',()=>{
 const m=metrics(fixture('core'));assert.equal(m.legacyQuarterGate,false);assert.equal(m.broadWhiteDisc,false);assert.equal(m.noncollapsed,true);
});
test('full white disc with tiny cyan center is rejected spatially',()=>{
 const m=metrics(fixture('disc'));assert.equal(m.broadWhiteDisc,true);assert.equal(m.noncollapsed,false);assert.ok(m.radial[2].whiteFraction>.9);assert.ok(m.radial[3].whiteFraction>.9);
});
test('truncated or missing pixels cannot pass',()=>{assert.throws(()=>metrics({w:64,h:64,data:[]}));assert.throws(()=>metrics(null));});
test('uniform replay uses identical full histories including level, not wall-clock t-only substitution',()=>{
 const idle={a:[0,0,0],b:[0,0,0],c:[0,0,0],energy:.18,spin:.22,ring:0,core:.55};
 const command={a:[.1,.2,.3],b:[.4,.5,.6],c:[.7,.8,.9],energy:1,spin:1.4,ring:1,core:1.15};
 const a=uniformHistory({idle,command},'command',64),b=uniformHistory({idle,command},'command',64);
 assert.deepEqual(a,b);assert.equal(a.history.dtSeconds.length,15);assert.equal(a.uniforms.t,8);assert.ok(a.uniforms.lvl>0);assert.ok(a.uniforms.lvl<.3);
 assert.deepEqual(Object.keys(a.uniforms).sort(),['R','cA','cB','cC','core','energy','gloss','lvl','press','res','ring','spin','t'].sort());
});
test('collector persists raw pixels/PNG/metrics before a failing assertion and continues to candidate',async()=>{
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'orb-collector-'));
 try{const c=new Collector(root,['baseline-failed','candidate']);
 await c.run('baseline-failed',async(r,check)=>{r.artifacts.push(c.artifact(r.id,fixture('core')));check(false,'intentional failure');throw Error('intentional exception');});
 const r=await c.run('candidate',async(r,check)=>check(true,'candidate reached'));
 assert.equal(r.pass,true);assert.equal(c.finish(),false);
 const result=JSON.parse(fs.readFileSync(path.join(root,'result.json')));assert.equal(result.complete,true);assert.equal(result.cases.length,2);
 const a=result.cases[0].artifacts[0];assert.ok(a.metrics.whiteFraction>.25);assert.ok(fs.statSync(path.join(root,a.png)).size>0);assert.equal(fs.statSync(path.join(root,a.rgba)).size,128*128*4);
 assert.deepEqual(png(fixture('core')).subarray(0,8),Buffer.from('89504e470d0a1a0a','hex'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('inventory requires candidate, all controls, real clocks, controlled comparisons and recovery',()=>{
 const ids=expectedCases();assert.equal(ids.length,132);assert.equal(new Set(ids).size,132);
 assert.equal(ids.filter(x=>x.startsWith('candidate/')).length,40);
 assert.equal(ids.filter(x=>x.includes('/controlled/')).length,48);
 assert.equal(ids.filter(x=>x.includes('/realtime/')).length,48);
 assert.equal(ids.filter(x=>x.startsWith('comparison/')).length,16);
});
test('missing or duplicate cases fail completeness even if individual checks passed',async()=>{
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'orb-complete-'));
 try{const c=new Collector(root,['a','b']);await c.run('a',async(r,check)=>check(true,'a'));assert.equal(c.finish(),false);
 await c.run('a',async(r,check)=>check(true,'duplicate'));assert.equal(c.finish(),false);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
