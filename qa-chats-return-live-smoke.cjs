// Post-release real-data shell check. No fixture data or asset overrides; every write refused.
const QA_ORIGIN = (process.env.WIZARD_QA_ORIGIN || 'https://wizard.example.ts.net').replace(/\/+$/, ''); // the Wizard under test (env; see docs/qa-targets.md)
const {chromium}=require('playwright-core');
const fs=require('fs'), path=require('path');
const URL_=process.argv[2] || QA_ORIGIN + '/wizard-os-home/';
const OUT=process.env.QA_OUT || path.join(__dirname,'live-smoke');fs.mkdirSync(OUT,{recursive:true});
(async()=>{const b=await chromium.launch({executablePath:process.env.QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const checks=[];
try{for(const kind of ['phone','desktop']){
 const ctx=await b.newContext({viewport:kind==='phone'?{width:412,height:892}:{width:1440,height:1000},hasTouch:kind==='phone',isMobile:kind==='phone',serviceWorkers:'block',...(kind==='phone'?{userAgent:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'}:{})});
 const writes=[],errors=[];await ctx.route('**/*',r=>{const m=r.request().method();if(m==='GET'||m==='HEAD')return r.continue();writes.push(r.request().url());return r.fulfill({status:403,contentType:'application/json',body:'{"error":"qa read-only"}'});});
 await ctx.addInitScript(()=>{localStorage.clear();localStorage.setItem('wos.coached','true');localStorage.setItem('wos.voiceTipSeen','true');});
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(URL_+'?open=chats');await p.waitForSelector('.ch-row[data-chopen]');await p.waitForTimeout(1600);
 const shell=await p.evaluate(()=>document.documentElement.dataset.shell);if(shell!==kind)throw Error(kind+' wrong shell: '+shell);
 const count=await p.locator('.ch-row[data-chopen]').count();if(!count)throw Error(kind+' missing real threads');
 if(kind==='phone'){
  await p.locator('.win [data-wact="full"]').first().tap();await p.waitForTimeout(1400);
  const before=await p.evaluate(()=>{const sc=document.querySelector('.ch-scroll');sc.scrollTop=Math.min(1000,sc.scrollHeight-sc.clientHeight);const r=sc.getBoundingClientRect();const a=[...sc.querySelectorAll('[data-chopen]')].find(e=>{const b=e.getBoundingClientRect();return b.top>r.top+100&&b.bottom<r.bottom-100;});return {top:sc.scrollTop,id:a.dataset.chopen};});
  await p.locator(`[data-chopen="${before.id}"]`).tap();await p.waitForSelector('.ch-thread');await p.waitForTimeout(900);await p.locator('[data-chback]').tap();await p.waitForSelector('.ch-list');await p.waitForTimeout(600);
  const top=await p.locator('.ch-scroll').evaluate(e=>e.scrollTop);if(Math.abs(top-before.top)>2)throw Error('real thread return lost place '+JSON.stringify({before,top}));checks.push({name:'phone real thread return',before,after:top});
 }
 if(errors.length)throw Error(kind+' errors '+JSON.stringify(errors));await p.screenshot({path:path.join(OUT,kind+'.png')});checks.push({name:kind+' real-data shell',shell,realRows:count,errors,writesBlocked:writes.length});await ctx.close();
 }fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({origin:URL_,checks},null,2));console.log(JSON.stringify(checks,null,2));}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
