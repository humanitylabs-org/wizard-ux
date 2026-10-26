// Dispatch proof through the real, read-only installed app, not a fake frame.
// Run tools/qa-origin.cjs with QA_READ_APP_PREFIX=/wizard-music/,
// QA_READ_APP_PORT from the live unit, QA_READ_APP_UPSTREAM_PREFIX=/wizard-music.
// This origin refuses writes: it proves dispatch + real receiver ack, NOT audible playback.
const {chromium}=require('./tools/qa-playwright.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const origin=process.env.QA_ORIGIN||'http://127.0.0.1:19371';
const shots=process.env.QA_SHOTS||path.join(process.env.TMPDIR||require('node:os').tmpdir(),'voice');
fs.mkdirSync(shots,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.QA_CHROME||undefined});
 const results=[];
 try {
  for(const shell of ['phone','desktop']){
   const context=await browser.newContext({viewport:shell==='phone'?{width:412,height:892}:{width:1440,height:1000},isMobile:shell==='phone',hasTouch:shell==='phone'});
   await context.addInitScript(()=>{
    try{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.voiceTipSeen','true');localStorage.setItem('wos.tour.v1','true');}catch{}
    window.__qaMusicEvents=[];
    addEventListener('message',e=>{if(e.origin===location.origin&&/^wizard-os:music/.test(e.data?.type||''))window.__qaMusicEvents.push(JSON.parse(JSON.stringify(e.data)));});
   });
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
   await page.goto(origin+'/wizard-os-home/?shell='+shell,{waitUntil:'load'});
   await page.waitForFunction(s=>!!(s==='phone'?window.__wos:window.__wux)&&!!window.WizCore.apps(s==='phone'?'mobile':'desktop').APP['wizard-music'],shell);
   // Use the real tour dismissal: stored flags are not the launcher's current contract.
   const skip=page.getByText('Skip tour',{exact:true});
   if(await skip.isVisible().catch(()=>false))await skip.click();
   await page.evaluate(s=>s==='phone'?window.__wos.handleText('Play music Guy Barato Trap.','command',false,300,null):window.__wux.localCommand('Play music Guy Barato Trap.'),shell);
   const element=await page.waitForSelector('iframe.appframe[src*="/wizard-music/"]'),frame=await element.contentFrame();
   await frame.waitForSelector('.music-chip',{timeout:60000});
   await page.waitForFunction(()=>window.__qaMusicEvents.some(e=>e.type==='wizard-os:music:ack'),null,{timeout:30000});
   const command=await frame.evaluate(()=>window.__qaMusicEvents.find(e=>e.type==='wizard-os:music'));
   // Main's parse() preserves the raw play utterance, including STT punctuation.
   assert.deepEqual(command.cmd,{op:'play',said:'Play music Guy Barato Trap.'});
   const ack=await page.evaluate(()=>window.__qaMusicEvents.find(e=>e.type==='wizard-os:music:ack'));
   assert.equal(ack.id,command.id);assert.equal(errors.length,0,errors.join('\n'));
   await page.screenshot({path:path.join(shots,'real-music-'+shell+'.png')});
   results.push({shell,cmd:command.cmd,ack:true,pageErrors:errors.length,realFrame:new URL(frame.url()).pathname});
   await context.close();
  }
  console.log(JSON.stringify({results},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
