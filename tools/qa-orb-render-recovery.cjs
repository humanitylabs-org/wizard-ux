// Synthetic actual bundled-page diagnostics. No owner data, microphone or external requests.
'use strict';
const {chromium}=require('./qa-playwright.cjs');
const {installRafProbe,frozenIdle}=require('./qa-orb-idle-probe.cjs');
const {modes,variants,sha,metrics,uniformHistory,Collector,expectedCases}=require('./qa-orb-diagnostics.cjs');
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const out=path.resolve(process.env.QA_OUT||'qa-orb-render-recovery'), collector=new Collector(out,expectedCases());
const controlled=new Map();
// These are the checked-in target colours, not guessed settled values from wall time.
const roots=Object.fromEntries(variants.map(v=>[v,fs.realpathSync(process.env[`QA_ORB_${v.toUpperCase()}`])]));
const presets=Object.fromEntries(variants.map(v=>{
  const source=fs.readFileSync(path.join(roots[v],'orb.js'),'utf8');
  const block=source.match(/const MODES = (\{[\s\S]*?\n  \});/);assert.ok(block,`${v}: preset block`);
  return [v,JSON.parse(JSON.stringify(vm.runInNewContext('('+block[1]+')')))];
}));
// Preset parity is a gate on the comparison, not an assumption about different wall-clock lerps.
const presetParity=JSON.stringify(presets.baseline)===JSON.stringify(presets.candidate);
collector.result.presetHashes=Object.fromEntries(variants.map(v=>[v,sha(JSON.stringify(presets[v]))]));
collector.result.controls={shaderTime:8,dtSeconds:Array(15).fill(.1),initialMode:'idle',press:0,R:.64,gloss:1,
  policy:'Controlled lane explicitly replays ALL shader uniforms after Orb.sleep(true); actual real-clock page/lifecycle lane is untouched. Legacy .25 remains diagnostic; matched-input mean-channel delta <3 is unchanged.',
  discCriterion:'White majority in BOTH radial .256-.384 and .384-.512 (R=.64); >100 distinct inner colours. Field white extends through those annuli, unlike a modest white core. Not a field-trigger diagnosis.'};
collector.save();
function installGlProbe(){
  window.EverywhereNative={log(){}};window.__draws=0;window.__events=[];window.__capture=true;
  const proto=WebGLRenderingContext.prototype,draw=proto.drawArrays,programs=new WeakMap();let serial=0;
  window.__take=function(gl){
    const p=gl.getParameter(gl.CURRENT_PROGRAM),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,data=new Uint8Array(w*h*4),uniforms={};
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,data);
    if(p)for(let i=0;i<gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);i++){
      const name=gl.getActiveUniform(p,i).name,value=gl.getUniform(p,gl.getUniformLocation(p,name));
      uniforms[name]=ArrayBuffer.isView(value)?Array.from(value):value;
    }
    if(p&&!programs.has(p))programs.set(p,++serial);
    const debug=gl.getExtension('WEBGL_debug_renderer_info');
    return {w,h,data:Array.from(data),uniforms,programId:p?programs.get(p):null,error:gl.getError(),draws:window.__draws,now:performance.now(),
      mode:window.Orb?.mode,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
      shaders:p?gl.getAttachedShaders(p).map(s=>gl.getShaderSource(s)):[]};
  };
  proto.drawArrays=function(...args){const result=draw.apply(this,args);window.__draws++;window.__gl=this;
    if(window.__capture)window.__sample=window.__take(this);return result;};
  window.__controlled=function(uniforms){
    const gl=window.__gl,p=gl.getParameter(gl.CURRENT_PROGRAM);if(!p||gl.isContextLost())throw Error('no working GL program');
    gl.viewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    for(const [name,value] of Object.entries(uniforms)){
      const loc=gl.getUniformLocation(p,name);if(!loc)continue;
      if(Array.isArray(value)){if(value.length===2)gl.uniform2fv(loc,value);else gl.uniform3fv(loc,value);}else gl.uniform1f(loc,value);
    }
    draw.call(gl,gl.TRIANGLE_STRIP,0,4);window.__draws++;
    return window.__take(gl);
  };
  document.addEventListener('DOMContentLoaded',()=>{
    for(const name of ['webglcontextlost','webglcontextrestored'])document.getElementById('orb').addEventListener(name,()=>window.__events.push({name,at:performance.now(),draws:window.__draws}));
  });
}
async function openPage(browser,v,size){
  const context=await browser.newContext({viewport:{width:size,height:size},deviceScaleFactor:2,serviceWorkers:'block'});
  const errors=[],blocked=[];let page;
  try{
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());if(url.origin!=='http://orb.test'||route.request().method()!=='GET'){blocked.push(url.origin);return route.abort();}
      const file=path.resolve(roots[v],decodeURIComponent(url.pathname).slice(1)||'everywhere.html');
      if(!file.startsWith(roots[v]+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
      return route.fulfill({body:fs.readFileSync(file),contentType:({'.html':'text/html','.js':'text/javascript','.png':'image/png'})[path.extname(file)]||'application/octet-stream'});
    });
    await context.addInitScript(installRafProbe);await context.addInitScript(installGlProbe);
    page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://orb.test/everywhere.html',{waitUntil:'load'});
    await page.waitForFunction(()=>window.Orb?.webgl&&window.E&&window.__sample);
    return {context,page,errors,blocked};
  }catch(e){await context.close();throw e;}
}
async function state(page){return page.evaluate(()=>({webgl:Orb.webgl,canvasHidden:document.getElementById('orb').hidden,
  fallbackHidden:document.getElementById('orbFallback').hidden,mode:Orb.mode,draws:window.__draws,
  pending:window.__orbPendingRafs.size,events:window.__events,now:performance.now(),hidden:document.hidden}));}
async function evidence(record,page,suffix='paint',sample){
  if(!page)return;
  sample=sample||await page.evaluate(()=>window.__sample);
  if(sample){const info=collector.artifact(record.id+'/'+suffix,sample);info.shaderHashes=sample.shaders.map(s=>sha(s));delete info.shaders;record.artifacts.push(info);}
  const png=record.id.replaceAll('/','-')+'-'+suffix+'-page.png';
  await page.screenshot({path:path.join(out,png),timeout:6000});record.pageImages=record.pageImages||[];record.pageImages.push(png);
  record.state=await state(page);collector.save();return sample;
}
const fallback=page=>record=>evidence(record,page,'failure');
async function freeze(page,record,check,label){
  const observation=await page.evaluate(frozenIdle);record[label]=observation;collector.save();
  await evidence(record,page,label);check(observation.pass,observation.error||'strict idle drained + zero draws for 300ms',observation);
}
async function restoreCase(browser,v,size,cycle,sleep){
  const id=`${v}/${size}/${sleep?'sleep-restore':'restore/'+cycle}`;let env;
  await collector.run(id,async(r,check)=>{
    env=await openPage(browser,v,size);const {page}=env;
    if(cycle===2){
      // Exercise the SECOND reset on an already-restored context, without letting an
      // unrelated prior case's assertion skip it. Both reset stages retain images.
      const before=await page.evaluate(()=>window.__sample);r.warmupBefore=await state(page);
      await evidence(r,page,'first-reset-before',before);
      await page.evaluate(()=>{window.__lose=window.__gl.getExtension('WEBGL_lose_context');if(!window.__lose)throw Error('WEBGL_lose_context unavailable');window.__lose.loseContext();});
      await page.waitForFunction(()=>window.__events.filter(e=>e.name==='webglcontextlost').length===1);
      r.warmupLoss=await state(page);await evidence(r,page,'first-reset-loss');
      check(r.warmupLoss.canvasHidden&&!r.warmupLoss.fallbackHidden,'first reset fallback visible',r.warmupLoss);
      if(v==='candidate')check(!r.warmupLoss.webgl,'first reset webgl status false',r.warmupLoss);
      await page.waitForTimeout(200);await page.evaluate(()=>window.__lose.restoreContext());
      await page.waitForFunction(()=>window.__events.filter(e=>e.name==='webglcontextrestored').length===1);
      if(v==='candidate')await page.waitForFunction(before=>window.__draws>before&&!document.getElementById('orb').hidden,before.draws);
      r.warmupRestore=await state(page);const first=await evidence(r,page,'first-reset-restored');
      if(v==='candidate')check(first.programId!==before.programId&&first.error===0&&metrics(first).noncollapsed,'first reset rebuilt working program',first.programId);
      else check(r.warmupRestore.canvasHidden&&!r.warmupRestore.fallbackHidden,'old first reset remains fallback',r.warmupRestore);
    }
    // Restore 1 retains live voice state and level. Restore 2 retains a frozen idle host.
    const mode=cycle===1&&!sleep?'typing':'idle',level=mode==='typing'?.3:0;
    await page.evaluate(({mode,level,sleep})=>{E.state({mode});E.level(level);if(sleep)Orb.sleep(true);},{mode,level,sleep});
    if(mode==='idle'&&!sleep&&v==='candidate')await freeze(page,r,check,'beforeLossIdle');
    else await page.waitForTimeout(250);
    const beforeSample=await evidence(r,page,'before-loss');r.before=await state(page);
    const oldLost=r.before.events.filter(e=>e.name==='webglcontextlost').length,oldRestored=r.before.events.filter(e=>e.name==='webglcontextrestored').length;
    await page.evaluate(()=>{window.__lose=window.__gl.getExtension('WEBGL_lose_context');if(!window.__lose)throw Error('WEBGL_lose_context unavailable');window.__lose.loseContext();});
    await page.waitForFunction(n=>window.__events.filter(e=>e.name==='webglcontextlost').length>n,oldLost);
    r.loss=await state(page);await evidence(r,page,'loss');
    check(r.loss.canvasHidden&&!r.loss.fallbackHidden,'fallback visible during loss',r.loss);
    if(v==='candidate')check(!r.loss.webgl,'webgl reflects loss',r.loss.webgl);
    await page.waitForTimeout(200);const beforeRestore=await state(page);
    await page.evaluate(()=>window.__lose.restoreContext());
    await page.waitForFunction(n=>window.__events.filter(e=>e.name==='webglcontextrestored').length>n,oldRestored);
    if(v==='candidate'&&!sleep)await page.waitForFunction(before=>window.__draws>before&&!document.getElementById('orb').hidden,beforeRestore.draws);
    else await page.waitForTimeout(300);
    r.restored=await state(page);await evidence(r,page,'restored');
    check(r.restored.mode===mode,'mode retained',r.restored.mode);
    if(v==='candidate'){
      check(r.restored.webgl&&!r.restored.canvasHidden&&r.restored.fallbackHidden,'working renderer restored',r.restored);
      if(sleep){check(r.restored.draws===beforeRestore.draws,'restoration respects host sleep',r.restored);
        await page.evaluate(()=>Orb.sleep(false));await page.waitForFunction(before=>window.__draws>before,beforeRestore.draws);
        await freeze(page,r,check,'afterResumeIdle');
      }else if(mode==='idle')await freeze(page,r,check,'afterRestoreIdle');
      else{
        const old=r.restored.draws;await page.waitForTimeout(300);check((await state(page)).draws>old,'live mode keeps animating after restore');
        const s=await evidence(r,page,'live-restored');check(s.error===0&&metrics(s).noncollapsed,'restored live galaxy pixels',metrics(s));
        check(s.uniforms.lvl>0,'live level retained in restored GPU uniforms',s.uniforms.lvl);
      }
      const sample=await evidence(r,page,'final');check(sample.error===0&&metrics(sample).noncollapsed,'final recovered pixels noncollapsed',metrics(sample));
      check(sample.programId!==beforeSample.programId,'restoration rebuilt a new GPU program',{before:beforeSample.programId,after:sample.programId});
    }else check(r.restored.canvasHidden&&!r.restored.fallbackHidden&&r.restored.draws===beforeRestore.draws,
      'negative control: old permanent fallback reproduced',r.restored);
    check(env.errors.length===0&&env.blocked.length===0,'no page errors/external requests',{errors:env.errors,blocked:env.blocked});
  },async r=>{if(env)await fallback(env.page)(r);});
  if(env)await env.context.close();
}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.QA_CHROME||undefined,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    for(const v of variants)for(const size of [64,76]){
      // Matched-input shader lane; every scalar/vector input is replayed, with CPU history retained.
      let controlledEnv;
      for(const mode of modes){const id=`${v}/${size}/controlled/${mode}`;
        await collector.run(id,async(r,check)=>{
          if(!controlledEnv){controlledEnv=await openPage(browser,v,size);await controlledEnv.page.evaluate(()=>{Orb.sleep(true);window.__capture=false;});}
          const setup=uniformHistory(presets[v],mode,size);r.controls=setup;
          const s=await controlledEnv.page.evaluate(uniforms=>window.__controlled(uniforms),setup.uniforms);
          await evidence(r,controlledEnv.page,'controlled',s); // Save PNG + RGBA + all inputs BEFORE any check.
          controlled.set(`${v}/${size}/${mode}`,s);
          check(s.error===0,'GL error absent',s.error);check(metrics(s).noncollapsed,'not broad white disc + colour diversity',metrics(s));
          for(const [name,value]of Object.entries(setup.uniforms)){
            if(name==='gloss'&&!(name in s.uniforms)&&v==='published')continue;
            const expected=Array.isArray(value)?value.map(Math.fround):Math.fround(value);
            check(JSON.stringify(s.uniforms[name])===JSON.stringify(expected),'GPU uniform matches explicit replay: '+name,{expected,actual:s.uniforms[name]});
          }
          check(controlledEnv.errors.length===0&&controlledEnv.blocked.length===0,'no page errors/external requests',{errors:controlledEnv.errors,blocked:controlledEnv.blocked});
        },async r=>{if(controlledEnv)await fallback(controlledEnv.page)(r);});
      }
      if(controlledEnv)await controlledEnv.context.close();
      // Actual page: no uniform override, clock mocking, timer changes or source transforms.
      let live;
      for(const mode of modes){const id=`${v}/${size}/realtime/${mode}`;
        await collector.run(id,async(r,check)=>{
          if(!live)live=await openPage(browser,v,size);
          await live.page.evaluate(mode=>{window.__capture=true;window.__sample=null;E.state({mode});E.level(['idle','paused'].includes(mode)?0:.3);},mode);
          await live.page.waitForTimeout(1500);const s=await live.page.evaluate(()=>window.__sample);
          await evidence(r,live.page,'realtime',s);
          check(!!s&&s.error===0,'real-clock GL sample',s?.error);
          check(metrics(s).noncollapsed,'real-clock noncollapsed galaxy',metrics(s));
          check(live.errors.length===0&&live.blocked.length===0,'no page errors/external requests',{errors:live.errors,blocked:live.blocked});
        },async r=>{if(live)await fallback(live.page)(r);});
      }
      await collector.run(`${v}/${size}/idle`,async(r,check)=>{
        if(!live)live=await openPage(browser,v,size);
        await live.page.evaluate(()=>{E.state({mode:'idle'});E.level(0);});await freeze(live.page,r,check,'idle');
      },async r=>{if(live)await fallback(live.page)(r);});
      if(live)await live.context.close();
      // Each restoration case has a fresh page: one failure cannot poison a later control/candidate.
      for(const cycle of [1,2])await restoreCase(browser,v,size,cycle,false);
      if(v==='candidate')await restoreCase(browser,v,size,3,true);
    }
    for(const size of [64,76])for(const mode of modes)await collector.run(`comparison/${size}/${mode}`,async(r,check)=>{
      const a=controlled.get(`baseline/${size}/${mode}`),b=controlled.get(`candidate/${size}/${mode}`);
      check(presetParity,'baseline/candidate mode presets identical',collector.result.presetHashes);
      if(!a||!b)throw Error('missing controlled baseline or candidate sample (see independent failure)');
      r.images={baseline:`baseline-${size}-controlled-${mode}-controlled.png`,candidate:`candidate-${size}-controlled-${mode}-controlled.png`};
      r.inputs={baseline:a.uniforms,candidate:b.uniforms};check(require('util').isDeepStrictEqual(a.uniforms,b.uniforms),'ALL actual GPU inputs identical',r.inputs);
      check(a.w===b.w&&a.h===b.h,'drawing-buffer dimensions identical');
      const delta=a.data.reduce((s,v,i)=>s+Math.abs(v-b.data[i]),0)/a.data.length;r.meanDelta=delta;
      r.baselineMetrics=metrics(a);r.candidateMetrics=metrics(b);
      check(delta<3,'intended appearance unchanged: mean channel delta <3',delta);
    });
  }finally{await browser.close();}
  const pass=collector.finish();console.log(JSON.stringify({pass,cases:collector.result.cases.length,expected:collector.result.expected.length,out}));if(!pass)process.exitCode=1;
})().catch(e=>{collector.result.fatal=e.stack;collector.finish();console.error(e);process.exitCode=1;});
