'use strict';
// Saved Wizards live on the box (issue 1237). Real phone and desktop shells on a synthetic origin. The fake Agent
// Service holds one saved Wizard (added on another device); this device has never saved one itself. Asserts: the
// Wizard switcher shows, its menu lists the box's Wizard, and Forget/Add only reach the box as item operations.
// QA_WEB=<another checkout>/web runs the same check on that code (baseline); QA_OUT=<dir> keeps screenshots.
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.env.QA_WEB||path.join(__dirname,'../web')),origin='https://studio.test',prefix='/wizard-os-home/';
const out=process.env.QA_OUT||'';if(out)fs.mkdirSync(out,{recursive:true});
const type=f=>f.endsWith('.js')||f.endsWith('.mjs')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':f.endsWith('.json')?'application/json':f.endsWith('.svg')?'image/svg+xml':'application/octet-stream';
(async()=>{
 const browser=await chromium.launch({headless:true});const results=[];
 try{
  for(const v of [{shell:'phone',w:390,h:844},{shell:'desktop',w:1280,h:800}]){
   const phone=v.shell==='phone';
   const box={savedWizards:[{id:'remote-a',name:'Archimedes',url:'https://archimedes.test/'}],launcher:{},migrations:{'launcher-seed-v1':'2026-11-01T00:00:00Z'}},patches=[];
   const ctx=await browser.newContext({viewport:{width:v.w,height:v.h},isMobile:phone,hasTouch:phone,serviceWorkers:'block'});
   await ctx.routeWebSocket('**/*',ws=>ws.close());
   await ctx.addInitScript(shell=>{if(window!==window.top)return;for(const[k,val]of Object.entries({'wos.shell':shell,'wos.coached':'true','wos.tour.v1':'true','wos.welcome.v1':'done','wos.desktop-view.v1':'classic'}))localStorage.setItem(k,val);},v.shell);
   const errors=[],writes=[];
   await ctx.route('**/*',async r=>{
    const q=r.request(),u=new URL(q.url()),p=u.pathname;
    if(u.origin!==origin)return r.abort();
    if(p==='/wizard/v1/ui-preferences'){
     if(q.method()==='GET')return r.fulfill({json:box});
     if(q.method()==='PATCH'){const ops=JSON.parse(q.postData()).ops;patches.push(ops);for(const o of ops){if(o.key==='savedWizards'&&o.op==='add'&&!box.savedWizards.some(w=>w.id===o.item.id))box.savedWizards.push(o.item);if(o.key==='savedWizards'&&o.op==='remove')box.savedWizards=box.savedWizards.filter(w=>w.id!==o.item);}return r.fulfill({json:box});}
    }
    if(!['GET','HEAD'].includes(q.method())){writes.push(q.method()+' '+p);return r.fulfill({status:405,json:{error:'refused by test'}});}
    if(p.startsWith(prefix)){const f=path.resolve(root,p.slice(prefix.length)||'index.html');if(f.startsWith(root+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({contentType:type(f),body:fs.readFileSync(f)});}
    if(p==='/api/system/devices')return r.fulfill({json:{this:{wizard:'Studio'},devices:[],managed:[]}});
    if(p.endsWith('/v1/apps'))return r.fulfill({json:{apps:[]}});
    return r.fulfill({json:{sessions:[],agents:[],apps:[],connected:false}});
   });
   const pg=await ctx.newPage();pg.on('pageerror',e=>errors.push(e.message));
   await pg.goto(origin+prefix+(phone?'':'desktop.html'));
   await pg.waitForFunction(()=>window.WizWorkspaces&&(window.__wos||window.__wux));
   await pg.evaluate(()=>document.getElementById('wosWelcome')?.remove());
   const label=`${v.shell} ${v.w}x${v.h}`;
   const shown=await pg.waitForFunction(()=>window.WizWorkspaces.visible,null,{timeout:3000}).then(()=>true,()=>false);
   await pg.waitForTimeout(500);
   if(out)await pg.screenshot({path:path.join(out,`saved-wizards-${v.shell}.png`)});
   const r={variant:label,switcher:shown,names:await pg.evaluate(()=>window.WizWorkspaces.snapshot().items.map(i=>i.name))};
   if(shown){
    await pg.evaluate(()=>{const b=[...document.querySelectorAll('.wz-workspaces-control')].find(n=>!n.hidden&&n.getClientRects().length);if(b)b.click();else window.WizWorkspaces.openMenu(null);});
    await pg.waitForSelector('.wz-workspaces-panel');await pg.waitForTimeout(300);
    if(out)await pg.screenshot({path:path.join(out,`saved-wizards-${v.shell}-menu.png`)});
    r.menu=await pg.evaluate(()=>[...document.querySelectorAll('.wz-workspaces-item b')].map(n=>n.textContent));
    await pg.evaluate(()=>window.WizWorkspaces.close());
    await pg.evaluate(()=>window.WizWorkspaces.remove('remote-a'));
    await pg.waitForTimeout(400);
    r.afterForget=box.savedWizards.map(w=>w.name);r.patches=patches;r.local=await pg.evaluate(()=>localStorage.getItem('wos.workspaces.v1'));
   }
   results.push({...r,writes,errors});await ctx.close();
   assert.ok(shown,`${label}: the switcher shows the box's saved Wizard`);
   assert.deepEqual(r.menu,['Studio','Archimedes'],`${label}: menu lists this Wizard and the box's`);
   assert.deepEqual(r.afterForget,[],`${label}: Forget reaches the box`);
   assert.deepEqual(r.patches,[[{op:'remove',key:'savedWizards',item:'remote-a'}]],`${label}: one item operation, never a whole list`);
   assert.equal(r.local,null,`${label}: nothing saved only on this device`);
   assert.deepEqual(errors,[],`${label}: page errors`);
  }
  console.log(JSON.stringify({ok:true,results},null,1));
 }catch(e){console.error(JSON.stringify(results,null,1));console.error(e.message);process.exitCode=1;}
 finally{await browser.close();}
})();
