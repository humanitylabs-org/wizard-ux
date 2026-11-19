'use strict';
// wizard-ux#1640: on a phone, Add a Wizard focuses its address field, the keyboard raises and the WebView shrinks.
// Real phone and desktop shells on a synthetic origin: open the sheet, shrink the viewport like a keyboard does,
// and assert the sheet is still open with the field focused. QA_WEB=<another checkout>/web runs the same check on
// that code (QA_EXPECT=broken asserts the sheet closed there); QA_OUT=<dir> keeps screenshots.
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.env.QA_WEB||path.join(__dirname,'../web')),origin='https://studio.test',prefix='/wizard-os-home/';
const out=process.env.QA_OUT||'',broken=process.env.QA_EXPECT==='broken';if(out)fs.mkdirSync(out,{recursive:true});
const type=f=>f.endsWith('.js')||f.endsWith('.mjs')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':f.endsWith('.json')?'application/json':f.endsWith('.svg')?'image/svg+xml':'application/octet-stream';
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const v of [{shell:'phone',w:412,h:915,kb:520},{shell:'desktop',w:1280,h:800,kb:700}]){
   const phone=v.shell==='phone';
   const ctx=await browser.newContext({viewport:{width:v.w,height:v.h},isMobile:phone,hasTouch:phone,serviceWorkers:'block'});
   await ctx.routeWebSocket('**/*',ws=>ws.close());
   await ctx.addInitScript(shell=>{if(window!==window.top)return;for(const[k,val]of Object.entries({'wos.shell':shell,'wos.coached':'true','wos.tour.v1':'true','wos.welcome.v1':'done','wos.desktop-view.v1':'classic'}))localStorage.setItem(k,val);},v.shell);
   const errors=[];
   await ctx.route('**/*',async r=>{
    const q=r.request(),u=new URL(q.url()),p=u.pathname;
    if(u.origin!==origin)return r.abort();
    if(p==='/wizard/v1/ui-preferences')return r.fulfill({json:{savedWizards:[],launcher:{},migrations:{'launcher-seed-v1':'2026-11-01T00:00:00Z'}}});
    if(!['GET','HEAD'].includes(q.method()))return r.fulfill({status:405,json:{error:'refused by test'}});
    if(p.startsWith(prefix)){const f=path.resolve(root,p.slice(prefix.length)||'index.html');if(f.startsWith(root+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({contentType:type(f),body:fs.readFileSync(f)});}
    if(p==='/api/system/devices')return r.fulfill({json:{this:{wizard:'Studio'},devices:[],managed:[]}});
    if(p.endsWith('/v1/apps'))return r.fulfill({json:{apps:[]}});
    return r.fulfill({json:{sessions:[],agents:[],apps:[],connected:false}});
   });
   const pg=await ctx.newPage();pg.on('pageerror',e=>errors.push(e.message));
   await pg.goto(origin+prefix+(phone?'':'desktop.html'));
   await pg.waitForFunction(()=>window.WizWorkspaces);
   await pg.evaluate(()=>document.getElementById('wosWelcome')?.remove());
   await pg.waitForTimeout(1500); // let the shell finish its first renders (the onboarding card takes focus once)
   await pg.evaluate(()=>window.WizWorkspaces.add());
   await pg.waitForSelector('.wz-workspaces-panel.is-sheet');
   // The keyboard rises: the WebView loses height.
   await pg.setViewportSize({width:v.w,height:v.h-v.kb});await pg.waitForTimeout(400);
   if(out)await pg.screenshot({path:path.join(out,`add-wizard-${v.shell}-${broken?'before':'after'}.png`)});
   const r=await pg.evaluate(()=>({open:!!document.querySelector('.wz-workspaces-panel.is-sheet'),focus:document.activeElement?.name||''}));
   if(r.open){await pg.keyboard.type('http://forum-box:8923');await pg.evaluate(()=>{document.querySelector('.wz-workspaces-panel input[name=name]').focus();});await pg.keyboard.type('Forum');}
   const typed=r.open&&await pg.evaluate(()=>[...document.querySelectorAll('.wz-workspaces-panel input')].map(n=>n.value).join('|'));
   console.log(JSON.stringify({variant:v.shell,...r,typed,errors}));
   await ctx.close();
   if(broken){assert.equal(r.open,false,`${v.shell}: baseline closes the sheet on resize`);continue;}
   assert.equal(r.open,true,`${v.shell}: sheet stays open after the keyboard resize`);
   assert.equal(r.focus,'url',`${v.shell}: address field keeps focus`);
   assert.equal(typed,'http://forum-box:8923|Forum',`${v.shell}: owner can type address and name`);
   assert.deepEqual(errors,[],`${v.shell}: page errors`);
  }
  console.log('qa-add-wizard-keyboard: ok');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
