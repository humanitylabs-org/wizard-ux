'use strict';
// WizardOS updates on a Mac (wizard-app-manager#696, wizard-ux#1282). Real desktop and phone shells on a synthetic
// origin; the App Manager's update status is stood in (by_host: a Mac's VM). No owner reads or writes.
//  1. Settings › About shows the "WizardOS update ready" card (screenshots per skin with QA_OUT=<dir>).
//  2. Desktop: while the Updating panel is open, Esc minimizes the panel and does nothing else (Settings, open behind
//     it, stays as it was); the next Esc does what Esc does without the panel (one press, one owner).
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.env.QA_WEB||path.join(__dirname,'../web')),origin='https://os-update.test',prefix='/wizard-os-home/';
const out=process.env.QA_OUT||'';if(out)fs.mkdirSync(out,{recursive:true});
const type=f=>f.endsWith('.js')||f.endsWith('.mjs')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':f.endsWith('.json')?'application/json':f.endsWith('.svg')?'image/svg+xml':'application/octet-stream';
const base={mode:'ask',chosen:true,channel:'latest',installed:'0.3.242',latest:'0.3.243',stable:'0.3.240',update_available:true,unpinned:false,checked:true,
 installing:false,interrupted:false,failed:false,failure_reason:null,retry_target:null,superseded:null,by_host:true,host_pending:null,host_headsup:null,
 receipt:'pinned',host_update:null,quick:false,waits_for_work:true,impact:{impact:'service',interrupts:'os'},waiting_for:[],when_idle:null};
async function boot(browser,{shell,skin,status,w,h}){
 const phone=shell==='phone';
 const ctx=await browser.newContext({viewport:{width:w,height:h},isMobile:phone,hasTouch:phone,serviceWorkers:'block'});
 await ctx.routeWebSocket('**/*',ws=>ws.close());
 await ctx.addInitScript(({shell,skin})=>{if(window!==window.top)return;for(const[k,v]of Object.entries({'wos.shell':shell,'wux.shell':shell,'wos.coached':'true','wos.tour.v1':'true','wos.welcome.v1':'done','wos.desktop-view.v1':'classic','wos.skin':skin}))localStorage.setItem(k,v);},{shell,skin});
 const errors=[],writes=[];
 await ctx.route('**/*',async r=>{
  const q=r.request(),u=new URL(q.url()),p=u.pathname;
  if(u.origin!==origin)return r.abort();
  if(p===prefix+'store-install/_updates'){if(q.method()!=='GET'){writes.push(q.method()+' '+p);return r.fulfill({status:405,json:{error:'refused by test'}});}return r.fulfill({json:status()});}
  if(!['GET','HEAD'].includes(q.method())){writes.push(q.method()+' '+p);return r.fulfill({status:405,json:{error:'refused by test'}});}
  if(p.startsWith(prefix)){const f=path.resolve(root,p.slice(prefix.length)||'index.html');if(f.startsWith(root+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({contentType:type(f),body:fs.readFileSync(f)});}
  // Welcome stays closed: the model options can't be read (welcome.js aiReady null), like a Wizard that is set up.
  if(p==='/wizard/hermes/api/model/options')return r.fulfill({status:404,json:{error:'not in this test'}});
  if(p==='/wizard/v1/ui-preferences')return r.fulfill({json:{launcher:{},migrations:{'launcher-seed-v1':true}}});
  if(p.endsWith('/v1/apps'))return r.fulfill({json:{apps:[]}});
  return r.fulfill({json:{sessions:[],agents:[],apps:[],connected:false}});
 });
 const pg=await ctx.newPage();pg.on('pageerror',e=>errors.push(e.message));
 await pg.goto(origin+prefix+(phone?'':'desktop.html'));
 await pg.waitForFunction(()=>window.WosSettings&&window.WosUpdateFlow&&(window.__wos||window.__wux));
 await pg.evaluate(()=>document.getElementById('wosWelcome')?.remove());
 return {ctx,pg,errors,writes};
}
const openSettings=pg=>pg.evaluate(()=>(window.__wos?.openSettings||window.__wux?.openSettings)('updates'));
(async()=>{
 const browser=await chromium.launch({headless:true});const results=[];
 try{
  // 1. The Settings card, two skins, both shells.
  for(const skin of ['nebula','grove'])for(const v of [{shell:'desktop',w:1280,h:800},{shell:'phone',w:390,h:844}]){
   const {ctx,pg,errors}=await boot(browser,{...v,skin,status:()=>base});
   await openSettings(pg);
   const card=pg.locator('.osu-card:visible').first();await card.waitFor({state:'visible',timeout:15000});
   const text=(await card.innerText()).replace(/\s+/g,' ');
   assert.match(text,/WizardOS update ready/,`${skin} ${v.shell}: card title`);
   assert.match(text,/Update now/,`${skin} ${v.shell}: Update now`);
   if(out){await card.scrollIntoViewIfNeeded();await pg.screenshot({path:path.join(out,`settings-card-${skin}-${v.shell}.png`)});}
   assert.deepEqual(errors,[],`${skin} ${v.shell}: page errors`);
   results.push({check:'settings-card',skin,shell:v.shell,text});await ctx.close();
  }
  // 2. Desktop Esc on the Updating panel: minimizes it and nothing else. `shell` is what Back can change behind it
  // (Settings open, which page, the focused window). Control: the same desk with no panel, one Esc.
  // `esc` is the desktop's own record of which owner took each Esc (desktop.js log 'esc:<owner>').
  const shell=pg=>pg.evaluate(()=>{const e=document.querySelector('.st-root[data-settings-root]');const open=!!e&&!!(e.offsetWidth||e.offsetHeight)&&!e.closest('[hidden]');
   const a=document.activeElement;return {settings:open,focus:a?.dataset?.stPage?'page:'+a.dataset.stPage:a?.tagName||'',esc:(window.__wuxLog||[]).filter(x=>x.startsWith('esc:'))};});
  // Put the keyboard in Settings the way the owner does (a click on a plain part of it), so Esc there is Settings'
  // own Back (About & updates → the Settings list): the press a stray second owner would show up in.
  const focusSettings=async pg=>{const b=await pg.locator('.st-root[data-settings-root]').boundingBox();await pg.mouse.click(b.x+b.width-40,b.y+b.height-30);await pg.waitForTimeout(200);};
  const panelHidden=pg=>pg.evaluate(()=>document.getElementById('wosUpdating')?.hidden);
  for(const skin of ['nebula','grove']){
   const ctl=await boot(browser,{shell:'desktop',skin,w:1280,h:800,status:()=>base});
   await openSettings(ctl.pg);await ctl.pg.locator('.osu-card:visible').first().waitFor({timeout:15000});await ctl.pg.waitForTimeout(1500);await focusSettings(ctl.pg);
   const ctlBefore=await shell(ctl.pg);await ctl.pg.keyboard.press('Escape');await ctl.pg.waitForTimeout(300);const ctlAfter=await shell(ctl.pg);await ctl.ctx.close();
   assert.deepEqual(ctlAfter.esc,['esc:settings-page'],`${skin}: control: Esc in Settings is Settings' Back ${JSON.stringify({ctlBefore,ctlAfter})}`);
   const at=Math.floor(Date.now()/1000);
   const {ctx,pg,errors,writes}=await boot(browser,{shell:'desktop',skin,w:1280,h:800,status:()=>({...base,host_update:{id:'u1',phase:'updating',target:'0.3.243',result:null,reason:null,at}})});
   await openSettings(pg);
   assert.equal(await pg.evaluate(()=>!!window.WosWelcome?.active),false,`${skin}: no Welcome over the shell`);
   await pg.waitForFunction(()=>document.getElementById('wosUpdating')?.hidden===false,null,{timeout:15000});await pg.waitForTimeout(300);await focusSettings(pg);
   assert.equal(await panelHidden(pg),false,`${skin}: the panel is still open`);
   const before=await shell(pg);
   assert.deepEqual({...before,focus:''},{...ctlBefore,focus:''},`${skin}: same desk as the control ${JSON.stringify({before,ctlBefore})}`);
   if(out)await pg.screenshot({path:path.join(out,`updating-panel-${skin}-desktop.png`)});
   await pg.keyboard.press('Escape');await pg.waitForTimeout(300);
   const after1={panelHidden:await panelHidden(pg),shell:await shell(pg)};
   assert.deepEqual(after1,{panelHidden:true,shell:{...before,esc:['esc:os-update']}},`${skin}: the first Esc minimizes the panel and changes nothing behind it ${JSON.stringify(after1)}`);
   if(out)await pg.screenshot({path:path.join(out,`updating-minimized-${skin}-desktop.png`)});
   await pg.keyboard.press('Escape');await pg.waitForTimeout(300);
   const after2={panelHidden:await panelHidden(pg),shell:await shell(pg)};
   assert.deepEqual(after2,{panelHidden:true,shell:{...ctlAfter,esc:['esc:os-update','esc:settings-page']}},`${skin}: the next Esc does what Esc does without the panel ${JSON.stringify({after2,ctlAfter})}`);
   assert.deepEqual(errors,[],`${skin}: page errors`);assert.deepEqual(writes.filter(w=>w.includes('_updates')),[],`${skin}: no update request`);
   results.push({check:'esc-minimizes-only-the-panel',skin,before,after1,after2,control:{ctlBefore,ctlAfter}});await ctx.close();
  }
  console.log(JSON.stringify({ok:true,results},null,1));
 }catch(e){console.error(JSON.stringify(results,null,1));console.error(e.message);process.exitCode=1;}
 finally{await browser.close();}
})();
