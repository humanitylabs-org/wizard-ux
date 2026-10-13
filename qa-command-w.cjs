// Focused regression: Command-W closes Wizard apps and preserves the desktop root.
// Run on Thales: QA_WEB_DIR=<repo> PLAYWRIGHT_PATH=<module> node qa-command-w.cjs [origin]
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE = process.argv[2] || 'https://wizard.tailc0f369.ts.net/wizard-os-home/';
const ROOT = process.env.QA_WEB_DIR || __dirname;
const OUT = process.env.QA_OUT || path.join(process.cwd(), 'command-w-evidence');
fs.mkdirSync(OUT, {recursive:true});
let pass=0; const results=[];
function ok(c,n) { assert(c,n); pass++; results.push(n); console.log('PASS',n); }
(async()=>{
 const browser=await chromium.launch({...(process.env.QA_CHROME?{executablePath:process.env.QA_CHROME}:{}),headless:true});
 try {
 const ctx=await browser.newContext({viewport:{width:1400,height:900},ignoreHTTPSErrors:true});
 let writes=0; const errors=[];
 await ctx.route('**/*', async r=>{
  const q=r.request(),u=new URL(q.url());
  if(q.method()!=='GET' && q.method()!=='HEAD') {writes++;return r.fulfill({status:403,body:'QA: writes blocked'});}
  if(u.pathname==='/qa-close-frame/') return r.fulfill({contentType:'text/html',body:'<input id="inside" value="frame text"><p>Command-W fixture</p>'});
  if(u.pathname.startsWith('/wizard-os-home/')) {
   const rel=u.pathname.slice('/wizard-os-home/'.length)||'index.html';
   const f=path.resolve(ROOT,'web',rel);
   if(f.startsWith(path.resolve(ROOT,'web')+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile()) return r.fulfill({path:f});
  }
  return r.continue();
 });
 await ctx.addInitScript(()=>localStorage.setItem('wos.coached','true'));
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(BASE);await p.waitForFunction(()=>window.__wux?.live?.ok,null,{timeout:45000});
 const url=p.url();
 await p.evaluate(()=>{ __wux.goWs(0);for(const id of [...__wux.ws[0].wins])__wux.closeWin(id); });
 // DOM-level assertion proves preventDefault even at root; native menu takes ownership of the OS chord.
 const root=await p.evaluate(()=>{const e=new KeyboardEvent('keydown',{key:'w',code:'KeyW',metaKey:true,bubbles:true,cancelable:true});window.dispatchEvent(e);return {prevented:e.defaultPrevented,n:__wux.ws[0].wins.length};});
 ok(root.prevented && root.n===0,'root consumes Command-W with no app open');
 ok(!p.isClosed() && p.url()===url,'empty desktop remains open at the same URL');
 await p.evaluate(()=>{__wux.newWin({app:'chats',thread:'__new__'});});
 const last=await p.evaluate(()=>__wux.ws[0].focus);
 await p.keyboard.press('Meta+w');
 ok(await p.evaluate(id=>!__wux.wins[id]&&__wux.ws[0].wins.length===0,last),'last New chat window closes to desktop');
 ok(!p.isClosed() && p.url()===url,'closing last internal app preserves outer Wizard');
 await p.evaluate(()=>{__wux.newWin({app:'chats'});__wux.newWin({app:'chats',thread:'__new__'});});
 const pair=await p.evaluate(()=>[...__wux.ws[0].wins]);
 await p.locator(`.win[data-win="${pair[1]}"] textarea`).focus();
 await p.keyboard.press('Meta+w');
 ok(await p.evaluate(ids=>!!__wux.wins[ids[0]]&&!__wux.wins[ids[1]]&&__wux.ws[0].focus===ids[0],pair),'Command-W in composer closes only focused app and focuses its neighbour');
 await p.evaluate(()=>{__wux.goWs(1);__wux.newWin({app:'chats',thread:'__new__'});});
 await p.keyboard.press('Meta+w');
 ok(await p.evaluate(id=>__wux.ws[1].wins.length===0&&!!__wux.wins[id],pair[0]),'Command-W preserves apps on other workspaces');
 await p.evaluate(()=>{__wux.goWs(0);__wux.newWin({app:'frame',appId:'files',url:'/qa-close-frame/'});});
 const fid=await p.evaluate(()=>__wux.ws[0].focus);
 const frame=p.frameLocator(`.win[data-win="${fid}"] iframe`);
 await frame.locator('#inside').waitFor();await frame.locator('#inside').focus();
 await p.keyboard.press('Meta+w');
 ok(await p.evaluate(id=>!__wux.wins[id],fid),'Command-W from hosted app input closes its Wizard window');
 await p.evaluate(()=>__wux.openPalette());await p.keyboard.press('Meta+w');
 ok(await p.evaluate(()=>__wux.ws[0].wins.length===0),'Command-W remains a close-app shortcut with palette open');
 await p.keyboard.press('Meta+w');
 ok(!p.isClosed() && p.url()===url,'repeated root Command-W leaves Wizard visible');
 await p.evaluate(()=>{__wux.closePalette();__wux.newWin({app:'chats'});});
 await p.keyboard.press('Alt+w');
 ok(await p.evaluate(()=>__wux.ws[0].wins.length===0),'existing Option-W remains compatible');
 // Native wrapper dispatches this top-level chord, including when iframe has keyboard focus.
 await p.evaluate(()=>{__wux.newWin({app:'chats'});window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',code:'KeyW',metaKey:true,bubbles:true,cancelable:true}));});
 ok(await p.evaluate(()=>__wux.ws[0].wins.length===0),'native top-level Command-W dispatch uses the same close path');
 await p.screenshot({path:path.join(OUT,'desktop-root.png')});
 ok(errors.length===0,'no page errors');ok(writes===0,'no backend writes attempted');
 fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({pass,results,url,errors,writes},null,2));
 console.log(`${pass} passed`);
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
