// Browser-free orchestration regression only; mocks never write screenshots.
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'qa-claude-credits.cjs'),'utf8');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
assert.match(read('web/desktop.html'),/<button id="logo"[^>]*aria-label="Home"/);
assert.ok(read('web/desktop/desktop.js').includes("$('#logo').addEventListener('click', () => goHome());"));
assert.match(read('web/desktop/desktop.js'),/homeOpen = true; store\.set\('homeOpen', true\); render\(\);/);
assert.match(read('web/desktop/desktop.js'),/home\.hidden = !homeOpen;\s+if \(homeOpen\) paintHome\(home, homeHtml\(null\)\);/);
assert.ok(read('web/desktop/desktop.js').includes("window.WosResources?.home() || ''"));
assert.ok(read('web/core/skin-host.js').includes("else if (!explicit && chosen === 'classic') chosen = 'ai-apps';"));
assert.match(read('web/layouts/ai-apps/desktop.css'),/#bar :is\(#logo,[^\n]*display: none !important/);
assert.ok(!/outerHTML\s*=|dataset\.tweaks\s*=/.test(source),'no widget/dataset injection');
assert.ok(!source.includes("locator('.rs-sheet"),'optional details cannot block cells');

async function exercise(code){
 const captures=[],contexts=[],failures=[],files=new Map(),events=[];
 const sandbox=vm.createContext({Buffer,URL,console:{log(){},error:e=>failures.push(String(e))},process:{env:{QA_PLAYWRIGHT_PATH:'mock-playwright',QA_OUT:'/mock-proof'},exitCode:0},__dirname:root});
 const invoke=(context,fn,arg)=>{context.__arg=arg;return vm.runInContext(typeof fn==='function'?`(${fn.toString()})(__arg)`:fn,context);};
 const chromium={async launch(){return {async newContext(options){
  const shell=options.isMobile?'phone':'desktop',storage=new Map();let entered=shell==='phone',route,wsRoute;
  const dataset={shell,skin:'nebula'},pageContext=vm.createContext({document:{documentElement:{dataset}},localStorage:{setItem:(k,v)=>storage.set(k,v)},getComputedStyle:()=>({getPropertyValue:p=>p==='--wz-base'?'#111':'#eee'})});
  Object.assign(pageContext,{WosSkin:{set:s=>{dataset.skin=s;}},WosSkinHost:{layout:'classic'},WosResources:{state:{ai:{providers:[]}}}});
  if(shell==='desktop')pageContext.__wux={homeOpen:false};pageContext.window=pageContext;
  const page={on(){},async goto(url){assert.ok(url.startsWith('https://wizard.test/'));assert.equal(storage.get('wux.shell'),shell);if(shell==='desktop'){pageContext.WosSkinHost.layout=storage.get('wos.desktop-view.v1')||'ai-apps';}events.push(shell+':navigate');},
   async waitForFunction(fn,arg){assert.ok(invoke(pageContext,fn,arg),'unsatisfied wait: '+fn);},async evaluate(fn,arg){return invoke(pageContext,fn,arg);},async waitForTimeout(ms){assert.equal(ms,700);},
   locator(selector){return {first(){return this;},async click(){assert.equal(selector,'#logo');assert.equal(shell,'desktop');assert.equal(pageContext.WosSkinHost.layout,'classic','Home control hidden in AI apps');entered=true;pageContext.__wux.homeOpen=true;events.push('desktop:trusted-home-click');},async waitFor(){assert.ok(entered,'Home must be opened before widget visibility');if(selector.includes('rs-widget')&&shell==='desktop')assert.equal(selector,'#desktopHome .rs-widget');},async innerText(){assert.ok(entered);return 'Claude 100% ChatGPT 91% $123.45 left Usage credits remaining';}};},
   async screenshot({path:shot}){assert.ok(entered);captures.push({shell,skin:dataset.skin,shot});}};
  const ctx={async routeWebSocket(_glob,handler){wsRoute=handler;},async route(_glob,handler){route=handler;},async addInitScript(fn,arg){invoke(pageContext,fn,arg);},async newPage(){return page;},async close(){}};
  contexts.push({shell,options,storage,get route(){return route;},get wsRoute(){return wsRoute;}});return ctx;
 },async close(){}};}};
 const mockfs={mkdirSync(){},writeFileSync:(p,v)=>files.set(p,v),existsSync:fs.existsSync,statSync:fs.statSync,readFileSync:fs.readFileSync};
 const fixture={ORIGIN:'https://wizard.test',refused:vm.runInContext('(()=>[])',sandbox),response:()=>{throw Error('unexpected fixture route in orchestration preflight');}};
 sandbox.require=id=>id==='node:fs'?mockfs:id==='node:path'?path:id==='node:assert/strict'?assert:id==='mock-playwright'?{chromium}:id==='./tools/qa-proof-fixture.cjs'?fixture:assert.fail('unexpected import '+id);
 await vm.runInContext(code,sandbox,{filename:'qa-claude-credits.cjs'});
 if(sandbox.process.exitCode||failures.length)throw Error(failures.join('\n'));
 assert.deepEqual(captures.map(c=>[c.shell,c.skin]),[['phone','nebula'],['phone','grove'],['desktop','nebula'],['desktop','grove']]);
 assert.deepEqual(JSON.parse(JSON.stringify(contexts.map(c=>c.options.viewport))),[{width:412,height:892},{width:1440,height:1000}]);
 for(const c of contexts){assert.equal(c.options.serviceWorkers,'block');assert.equal(c.options.hasTouch,c.shell==='phone');assert.ok(c.wsRoute);let closed=false;c.wsRoute({close(){closed=true;}});assert.ok(closed);let aborted=false;await c.route({request:()=>({url:()=> 'https://external.invalid/no-network'}),abort:reason=>{assert.equal(reason,'blockedbyclient');aborted=true;}});assert.ok(aborted);let snapshot;await c.route({request:()=>({url:()=> 'https://wizard.test/wizard/ai-usage'}),fulfill:r=>{snapshot=r.json;}});assert.equal(snapshot.providers[0].paid.balanceMinor,12345);}
 const receipt=JSON.parse(files.get('/mock-proof/results.json'));assert.equal(receipt.results.length,4);assert.ok(events.indexOf('desktop:trusted-home-click')>events.indexOf('desktop:navigate'));
 return {captureIntents:captures.length,contexts:contexts.length};
}
(async()=>{
 const result=await exercise(source);
 await assert.rejects(exercise(source.replace("await page.locator('#logo').click();",'// omitted for negative preflight')),/Home must be opened|unsatisfied wait/);
 await assert.rejects(exercise(source.replace("if(shell==='desktop')localStorage.setItem('wos.desktop-view.v1','classic');",'// omitted for negative preflight')),/unsatisfied wait|Home control hidden/);
 console.log(JSON.stringify({ok:true,kind:'browser-free-mocked-orchestration-not-browser-evidence',...result,negativeGuards:2,sourceHomeChain:true,noScreenshotsWritten:true}));
})().catch(e=>{console.error(e);process.exitCode=1;});
