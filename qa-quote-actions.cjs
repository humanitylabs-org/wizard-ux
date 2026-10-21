// Shared Chats quote-only Copy/Share, phone + desktop. All writes intercepted.
// QA_WEB_DIR=checkout (omit for live), QA_OUT=dir, QA_PLAYWRIGHT=module
const fs=require('fs'),path=require('path');
const {chromium}=require(process.env.QA_PLAYWRIGHT||'playwright');
const origin=process.argv[2]||'https://wizard.tailc0f369.ts.net';
const out=process.env.QA_OUT||'quote-evidence';fs.mkdirSync(out,{recursive:true});
const quote='Hello **Miguel**,\n\n1. Ship it.\n2. Then check.\n\n- Update [App Manager](https://github.com/humanitylabs-org/wizard-app-manager/pull/34).\n- Keep the existing build running.';
const markdown='Outside introduction.\n\n'+quote.split('\n').map(l=>'> '+l).join('\n')+'\n\nOutside conclusion.\n\n> Second quote.\n>\n> > Nested quote.\n\n```text\n> literal code\n```';
let pass=0,fail=0;const ok=(v,label)=>{console.log(v?'PASS':'FAIL',label);v?pass++:fail++;};
(async()=>{const browser=await chromium.launch({headless:true});try{for(const desktop of [false,true]){
 const mode=desktop?'desktop':'phone';const errors=[],writes=[];
 const ctx=await browser.newContext({viewport:desktop?{width:1440,height:1000}:{width:412,height:892},hasTouch:!desktop,isMobile:!desktop,ignoreHTTPSErrors:true,serviceWorkers:'block',permissions:['clipboard-read','clipboard-write']});
 await ctx.addInitScript(()=>{localStorage.setItem('wos.coached','true');window.__shares=[];navigator.share=async d=>{window.__shares.push(d);if(window.__cancelShare)throw new DOMException('Cancelled','AbortError');};});
 const sid='qa_quote_actions',now=Date.now()/1000,fixture={id:sid,title:'Quote actions',source:'wizard-mobile',status:'completed',message_count:2,last_active:now,wizard_last_assistant_at:now};
 await ctx.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());const json=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
  if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return json({ok:true,state:{initializedAt:Date.now(),threads:{}}});}
  if(process.env.QA_WEB_DIR&&u.pathname.startsWith('/wizard-os-home/')){const rel=u.pathname.slice('/wizard-os-home/'.length)||'index.html';const p=path.resolve(process.env.QA_WEB_DIR,'web',rel);if(!['data.js','summaries.js'].includes(rel)&&p.startsWith(path.resolve(process.env.QA_WEB_DIR,'web')+path.sep)&&fs.existsSync(p)&&fs.statSync(p).isFile())return r.fulfill({body:fs.readFileSync(p),contentType:rel.endsWith('.js')?'application/javascript':rel.endsWith('.css')?'text/css':rel.endsWith('.html')?'text/html':'application/octet-stream'});}
  if(u.pathname==='/wizard/hermes/api/sessions'){const res=await r.fetch();const d=await res.json();d.data=[fixture,...(d.data||[])];return json(d);}
  if(u.pathname===`/wizard/hermes/api/sessions/${sid}`)return json({session:fixture});
  if(u.pathname===`/wizard/hermes/api/sessions/${sid}/messages`)return json({data:[{id:1,role:'user',content:'Give me a message for Miguel',timestamp:now-20},{id:2,role:'assistant',content:markdown,timestamp:now-10}],pagination:{offset:0,limit:500,returned:2}});
  return r.continue();});
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));p.setDefaultTimeout(10000);
 try{
 await p.goto(origin+'/wizard-os-home/'+(desktop?'desktop.html':''));
 await p.waitForFunction(d=>!!(d?window.__wux:window.__wos)?.live?.ok,desktop,{timeout:60000});
 await p.evaluate(([d,id])=>d?__wux.openThread(id):__wos.openWizardThread(id),[desktop,sid]);
 await p.evaluate(()=>{WizConfig.raw.settings.agent.name='Athena';});
 const identityPaths=await p.evaluate(()=>{const cmd=WosCommands.create({CHATS:{},APP:{},appByName:()=>null,findApp:()=>null,quickSearch:()=>null,sendSnap:()=>({view:{kind:'home'}})});return {command:cmd.parse('Athena open settings',null,'command')?.view,music:WosMusic.parse('Athena music search gentle rain',false,false)?.query,food:window.WosUsuals?.spell('Athena order food'),search:WizCore.apps('phone').quickSearch('Athena image search mountains')?.query};});
 ok(identityPaths.command==='settings'&&identityPaths.music==='gentle rain'&&(!identityPaths.food||identityPaths.food==='new')&&identityPaths.search==='mountains',mode+' configured name in command, music, food and search parsing '+JSON.stringify(identityPaths));
 const msg=p.locator('.msg.a').filter({hasText:'Outside introduction.'}).last();await msg.waitFor();
 const controls=msg.locator('[data-quotecopy]');ok(await controls.count()===3,mode+' one toolbar per quote including nested; none in code');
 if(await controls.count()!==3)continue;
 const clip=()=>p.evaluate(async()=>{const item=(await navigator.clipboard.read())[0];return {text:await(await item.getType('text/plain')).text(),html:item.types.includes('text/html')?await(await item.getType('text/html')).text():''};});
 await controls.first().click();await p.waitForTimeout(150);const c=await clip();
 ok(c.text.includes('Hello Miguel')&&!/Outside|Second quote|Copy|Share/.test(c.text),mode+' quote copy excludes surrounding response and controls');
 ok(c.html.includes('<strong>Miguel</strong>')&&c.html.includes('href="https://github.com/'),mode+' quote copy preserves formatting and links');
 ok(/1\. Ship it\.\n2\. Then check\./.test(c.text)&&/1\. Ship it\..*2\. Then check\./s.test(c.html)&&/• Update/.test(c.text)&&/• Update/.test(c.html)&&!/<[ou]l[ >]/.test(c.html),mode+' quote copy keeps list markers as text in both flavours');
 ok(!/class=|style=|data-quote/.test(c.html),mode+' clean pasted HTML');
 await msg.locator('[data-quoteshare]').first().click();ok(await p.evaluate(q=>__shares.at(-1).text==='From Athena:\n\n'+q,quote),mode+' quote share configured attribution plus exact markdown');
 await controls.nth(1).click();await p.waitForTimeout(100);ok((await clip()).text==='Nested quote.',mode+' nested copy only nested quote');
 await msg.locator('[data-quoteshare]').nth(2).click();ok(await p.evaluate(()=>__shares.at(-1).text==='From Athena:\n\nSecond quote.\n\n> Nested quote.'),mode+' parent quote includes nested content');
 await msg.locator('[data-mcopy]').click();await p.waitForTimeout(100);const full=await clip();ok(full.text.includes('Outside introduction.')&&full.text.includes('Outside conclusion.')&&!full.text.includes('Share'),mode+' full response copy preserved');
 await msg.locator('[data-mshare]').click();ok(await p.evaluate(m=>__shares.at(-1).text==='From Athena:\n\n'+m,markdown),mode+' full response share preserved');
 await msg.locator('[data-codecopy]').click();await p.waitForTimeout(100);ok((await p.evaluate(()=>navigator.clipboard.readText()))==='> literal code',mode+' code copy remains exact');
 await msg.locator('[data-codeshare]').click();ok(await p.evaluate(()=>__shares.at(-1).text==='From Athena:\n\n> literal code'),mode+' code share uses configured attribution');
 await p.evaluate(()=>{WizConfig.raw.settings.agent.name='Merlin';});await msg.locator('[data-quoteshare]').first().click();ok(await p.evaluate(q=>__shares.at(-1).text==='From Merlin:\n\n'+q,quote),mode+' rename used at next share');
 await p.evaluate(()=>{WizConfig.raw.settings.agent.name=' ';});await msg.locator('[data-quoteshare]').first().click();ok(await p.evaluate(q=>__shares.at(-1).text==='From Wizard:\n\n'+q,quote),mode+' unnamed wizard uses neutral fallback');
 const selectionShare=async selector=>{await p.locator(selector).last().evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);WosSelMenu.show();});await p.locator('[data-sm="share"]').click();};
 await selectionShare('.msg.a blockquote p');ok(await p.evaluate(()=>__shares.at(-1).text.startsWith('From Wizard:\n\n')),mode+' selected assistant text attributed');
 await selectionShare('.msg.u .bub p');ok(await p.evaluate(()=>__shares.at(-1).text==='Give me a message for Miguel'),mode+' own selected words not attributed');
 await p.locator('.msg.u .bub').last().evaluate(el=>{el.innerHTML=WosChat.md('> My quoted words.\n\n```text\nmy code\n```');});
 await p.locator('.msg.u [data-quoteshare]').last().click();ok(await p.evaluate(()=>__shares.at(-1).text==='My quoted words.'),mode+' owner quote remains unattributed');
 await p.locator('.msg.u [data-codeshare]').last().click();ok(await p.evaluate(()=>__shares.at(-1).text==='my code'),mode+' owner code remains unattributed');
 await p.evaluate(()=>__cancelShare=true);await msg.locator('[data-quoteshare]').first().click();await p.waitForTimeout(100);ok(!errors.length,mode+' cancellation harmless');
 await p.evaluate(()=>{__cancelShare=false;navigator.share=undefined;});await msg.locator('[data-quoteshare]').first().click();await p.waitForTimeout(100);ok((await p.evaluate(()=>navigator.clipboard.readText()))==='From Wizard:\n\n'+quote,mode+' unavailable share copies attributed quote');
 await controls.first().scrollIntoViewIfNeeded();const geom=await msg.evaluate(el=>{const q=el.querySelector('blockquote'),a=q.querySelector('.quote-actions'),b=el.querySelector('[data-mcopy]');return {nested:a.getBoundingClientRect().left>q.getBoundingClientRect().left+8,overflow:q.scrollWidth>q.clientWidth+1};});
 ok(geom.nested&&!geom.overflow,mode+' indented toolbar and wrapped quote');
 await p.screenshot({path:path.join(out,mode+'.png')});
 ok(!writes.some(x=>/\/v1\/runs|\/messages$/.test(x)),mode+' no actual send');ok(!errors.length,mode+' no page errors');
 }catch(e){ok(false,mode+' '+e.stack);await p.screenshot({path:path.join(out,mode+'-error.png')});}
 finally{await ctx.unrouteAll({behavior:'ignoreErrors'});await ctx.close();}
}}finally{await browser.close();}fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({pass,fail},null,2));process.exitCode=fail?1:0;})();
