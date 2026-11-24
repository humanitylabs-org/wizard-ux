'use strict';
// Manage Wizards (wizard-ux#1670). Real phone and desktop shells on a synthetic origin, Nebula and Grove. The fake Agent
// Service holds two saved Wizards, one of them reinstalled under a new address. Asserts, through taps only: the
// switcher's Manage Wizards opens Settings › Connections › Wizards, which lists both with address and status; Rename,
// Change address and Remove (one tap, with Undo) reach the box as item operations.
// QA_WEB=<another checkout>/web runs it on that code (baseline: Manage Wizards is missing); QA_OUT=<dir> keeps screenshots.
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.env.QA_WEB||path.join(__dirname,'../web')),origin='https://studio.test',prefix='/wizard-os-home/';
const out=process.env.QA_OUT||'';if(out)fs.mkdirSync(out,{recursive:true});
const only=process.env.QA_VARIANT||'';
const type=f=>f.endsWith('.js')||f.endsWith('.mjs')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':f.endsWith('.json')?'application/json':f.endsWith('.svg')?'image/svg+xml':'application/octet-stream';
(async()=>{
 const browser=await chromium.launch({headless:true});const results=[];
 try{
  for(const v of [{shell:'phone',w:412,h:915,skin:'nebula'},{shell:'phone',w:412,h:915,skin:'grove'},{shell:'desktop',w:1280,h:800,skin:'nebula'}]){
   const label=`${v.shell} ${v.skin} ${v.w}x${v.h}`;if(only&&!label.includes(only))continue;
   const phone=v.shell==='phone',shot=n=>out?pg.screenshot({path:path.join(out,`manage-wizards-${v.shell}-${v.skin}-${n}.png`)}):null;
   const box={savedWizards:[{id:'remote-f',name:'Forum',url:'https://forum-old.test/'},{id:'remote-a',name:'Archimedes',url:'https://archimedes.test/'}],launcher:{},migrations:{'launcher-seed-v1':'2026-11-01T00:00:00Z'}},patches=[];
   const ctx=await browser.newContext({viewport:{width:v.w,height:v.h},isMobile:phone,hasTouch:phone,serviceWorkers:'block'});
   await ctx.routeWebSocket('**/*',ws=>ws.close());
   await ctx.addInitScript(([shell,skin])=>{if(window!==window.top)return;for(const[k,val]of Object.entries({'wos.shell':shell,'wos.coached':'true','wos.tour.v1':'true','wos.welcome.v1':'done','wos.desktop-view.v1':'classic','wos.skin':skin}))localStorage.setItem(k,val);
    // Reached a month and a half ago from this device: the old Forum address shows as unreachable for a long time.
    if(!localStorage.getItem('wos.workspaces.reach.v1'))localStorage.setItem('wos.workspaces.reach.v1',JSON.stringify({'https://forum-old.test':{ok:Date.now()-45*864e5}}));},[v.shell,v.skin]);
   const errors=[],writes=[];
   await ctx.route('**/*',async r=>{
    const q=r.request(),u=new URL(q.url()),p=u.pathname;
    if(u.origin!==origin)return r.abort();
    if(p==='/wizard/v1/ui-preferences'){
     if(q.method()==='GET')return r.fulfill({json:box});
     if(q.method()==='PATCH'){const ops=JSON.parse(q.postData()).ops;patches.push(ops);for(const o of ops){if(o.key==='savedWizards'&&o.op==='add'&&!box.savedWizards.some(w=>w.id===o.item.id))box.savedWizards.push(o.item);if(o.key==='savedWizards'&&o.op==='remove')box.savedWizards=box.savedWizards.filter(w=>w.id!==o.item);const m=/^savedWizards\/(.+)\/name$/.exec(o.key);if(m)box.savedWizards=box.savedWizards.map(w=>w.id===m[1]?{...w,name:o.item}:w);}return r.fulfill({json:box});}
    }
    if(!['GET','HEAD'].includes(q.method())){writes.push(q.method()+' '+p);return r.fulfill({status:405,json:{error:'refused by test'}});}
    if(p.startsWith(prefix)){const f=path.resolve(root,p.slice(prefix.length)||'index.html');if(f.startsWith(root+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({contentType:type(f),body:fs.readFileSync(f)});}
    // The Connections page Settings embeds above Wizards: an empty stand-in (it is not under test here).
    if(p.includes('/_connections/'))return r.fulfill({contentType:'text/html',body:'<!doctype html><html style="color-scheme:dark;background:transparent"><title>Connections</title><body></body></html>'});
    if(p==='/api/system/devices')return r.fulfill({json:{this:{wizard:'Studio'},devices:[],managed:[]}});
    if(p.endsWith('/v1/apps'))return r.fulfill({json:{apps:[]}});
    return r.fulfill({json:{sessions:[],agents:[],apps:[],connected:false}});
   });
   const pg=await ctx.newPage();pg.on('pageerror',e=>errors.push(e.message));
   await pg.goto(origin+prefix+(phone?'':'desktop.html'));
   await pg.waitForFunction(()=>window.WizWorkspaces&&(window.__wos||window.__wux));
   await pg.evaluate(()=>document.getElementById('wosWelcome')?.remove());
   await pg.waitForFunction(()=>window.WizWorkspaces.visible,null,{timeout:5000});
   await pg.waitForTimeout(500);await pg.evaluate(()=>document.getElementById('wosWelcome')?.remove());
   const r={variant:label};
   const control=pg.locator('.wz-workspaces-control:visible').first();
   await control.click();await pg.waitForSelector('.wz-workspaces-panel');await pg.waitForTimeout(250);await shot('menu');
   r.menu=await pg.evaluate(()=>[...document.querySelectorAll('.wz-workspaces-panel button')].map(n=>n.textContent.trim()));
   const manage=pg.locator('.wz-workspaces-manage');r.manage=await manage.count()>0;
   if(!r.manage){await pg.keyboard.press('Escape');await pg.evaluate(()=>{window.WizWorkspaces.close();window.WizCore.deeplink.route(location.pathname+'?view=connections');});await pg.waitForTimeout(800);
    await pg.evaluate(()=>[...document.querySelectorAll('[data-workspaces-add]')].find(n=>n.getClientRects().length)?.scrollIntoView({block:'center'}));await pg.waitForTimeout(300);await shot('settings');results.push({...r,errors});await ctx.close();if(process.env.QA_WEB)continue;assert.fail(`${label}: the switcher has Manage Wizards`);}
   await manage.click();
   await pg.waitForSelector('[data-saved-wizard="remote-f"]',{state:'visible',timeout:5000});await pg.waitForTimeout(400);
   const rows=()=>pg.evaluate(()=>[...document.querySelectorAll('[data-saved-wizard]')].filter(n=>n.getClientRects().length).map(n=>({id:n.dataset.savedWizard,stale:n.classList.contains('is-stale'),text:n.querySelector('small').textContent,name:n.querySelector('b').textContent})));
   r.list=await rows();await shot('list');
   // Change address: the reinstalled Forum now answers elsewhere.
   await pg.locator('[data-wizard-address="remote-f"]:visible').click();
   await pg.waitForSelector('.wz-workspaces-panel.is-sheet input[name="url"]');
   await pg.fill('.wz-workspaces-panel input[name="url"]','https://forum-new.test');await shot('edit');
   await pg.click('.wz-workspaces-panel button[type="submit"]');await pg.waitForSelector('.wz-workspaces-panel',{state:'detached'});
   // Rename
   await pg.locator('[data-wizard-rename="remote-f"]:visible').click();
   await pg.fill('.wz-workspaces-panel input[name="name"]','Forum (new)');await pg.click('.wz-workspaces-panel button[type="submit"]');
   await pg.waitForSelector('.wz-workspaces-panel',{state:'detached'});await pg.waitForTimeout(300);
   r.afterEdit=await rows();
   // Remove: one tap, then Undo, then remove for good.
   await pg.locator('[data-wizard-remove="remote-a"]:visible').click();await pg.waitForSelector('.wz-workspaces-undo');await pg.waitForTimeout(300);await shot('removed');
   r.afterRemove=box.savedWizards.map(w=>w.name);
   await pg.click('.wz-workspaces-undo button');await pg.waitForTimeout(400);r.afterUndo=box.savedWizards.map(w=>w.name).sort();
   await pg.locator('[data-wizard-remove="remote-a"]:visible').click();await pg.waitForTimeout(400);
   r.final=box.savedWizards.map(w=>[w.name,w.url]);r.patches=patches;
   results.push({...r,writes,errors});await ctx.close();
   assert.deepEqual(r.list.map(x=>x.id),['this','remote-f','remote-a'],`${label}: lists this Wizard and both saved ones`);
   assert.ok(r.list[1].stale&&/Unreachable for a long time/.test(r.list[1].text)&&/forum-old\.test/.test(r.list[1].text),`${label}: the dead address is plain`);
   assert.match(r.list[2].text,/archimedes\.test · Not reached from this device yet/);
   assert.deepEqual(r.afterEdit.find(x=>x.id==='remote-f').name,'Forum (new)');
   assert.match(r.afterEdit.find(x=>x.id==='remote-f').text,/forum-new\.test/);
   assert.deepEqual(r.afterRemove,['Forum (new)'],`${label}: one tap removes`);
   assert.deepEqual(r.afterUndo,['Archimedes','Forum (new)'],`${label}: Undo puts it back`);
   assert.deepEqual(r.final,[['Forum (new)','https://forum-new.test/']]);
   assert.ok(patches.flat().every(o=>o.key==='savedWizards'||o.key.startsWith('savedWizards/')),`${label}: item operations only`);
   assert.deepEqual(errors,[],`${label}: page errors`);
  }
  console.log(JSON.stringify({ok:true,results},null,1));
 }catch(e){console.error(JSON.stringify(results,null,1));console.error(e.message);process.exitCode=1;}
 finally{await browser.close();}
})();
