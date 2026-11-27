'use strict';
// Settings › Look: one list of skins (wizard-ux issues 1816 and 1190; no switch since 1190). Real phone (412 px) and
// desktop shells on a synthetic origin. A fake box keeps two own skins (/wizard/v1/skins: GET, PUT /active, POST);
// every other write is refused. Look shows ONE "Skins" list: every colour (the Landscapes colours
// stay a Background), the own skins and + New skin; no Skin row and no separate Colors row. Mode and Background follow
// the worn colour and step aside while an own skin is worn. New skin and Import skin JSON stay.
// QA_OUT=<dir> saves shots.
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.env.QA_WEB||path.join(__dirname,'../web')),origin='https://look-list.test',prefix='/wizard-os-home/';
const out=process.env.QA_OUT||'';if(out)fs.mkdirSync(out,{recursive:true});
const only=(process.env.QA_CASES||'phone,desktop').split(',');
const type=f=>f.endsWith('.js')||f.endsWith('.mjs')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':f.endsWith('.json')?'application/json':f.endsWith('.png')?'image/png':f.endsWith('.jpg')?'image/jpeg':f.endsWith('.webp')?'image/webp':f.endsWith('.svg')?'image/svg+xml':'application/octet-stream';
(async()=>{
 const browser=await chromium.launch({headless:true});const report=[];
 try{
  for(const v of [{shell:'phone',w:412,h:892},{shell:'desktop',w:1366,h:860}].filter(v=>only.includes(v.shell))){
   const phone=v.shell==='phone',label=v.shell;
   const ctx=await browser.newContext({viewport:{width:v.w,height:v.h},isMobile:phone,hasTouch:phone,deviceScaleFactor:phone?2:1,serviceWorkers:'block'});
   await ctx.routeWebSocket('**/*',ws=>ws.close());
   const mix={};
   await ctx.addInitScript(({shell,mix})=>{if(window!==window.top)return;if(sessionStorage.getItem('qa.boot'))return;sessionStorage.setItem('qa.boot','1');for(const[k,val]of Object.entries({'wos.shell':shell,'wos.channel.v1':'latest','wos.coached':'true','wos.tour.v1':'true','wos.welcome.v1':'done','wos.desktop-view.v1':'classic','wos.skin':'nebula','wos.skin-tweaks.v1':JSON.stringify({version:1,preset:'none',off:{},mix})}))localStorage.setItem(k,val);},{shell:v.shell,mix});
   // The fake box's own skins (the Agent Service /wizard/v1/skins shape).
   const box={skins:[{id:'work',name:'Work look',base:'grove',tweaks:{}},{id:'night',name:'Night look',base:'obsidian',tweaks:{}}],active:null};
   const errors=[],writes=[],skinWrites=[];
   await ctx.route('**/*',async r=>{
    const q=r.request(),u=new URL(q.url()),p=u.pathname,m=q.method();
    if(u.origin!==origin)return r.abort();
    if(p==='/wizard/v1/skins'||p.startsWith('/wizard/v1/skins/')){
     if(m==='GET')return r.fulfill({json:box});
     const body=(()=>{try{return JSON.parse(q.postData()||'{}');}catch(_){return {};}})();
     skinWrites.push(m+' '+p);
     if(m==='PUT'&&p==='/wizard/v1/skins/active'){box.active=body.id||null;return r.fulfill({json:box});}
     if(m==='POST'&&p==='/wizard/v1/skins'){const id='made-'+box.skins.length;box.skins.push({id,name:body.name,base:body.base,tweaks:body.tweaks||{}});if(body.activate)box.active=id;return r.fulfill({json:{id}});}
     return r.fulfill({status:405,json:{error:'refused by test'}});
    }
    if(p.startsWith('/wizard/v1/my-skin')){if(m!=='GET'){writes.push(m+' '+p);return r.fulfill({status:405,json:{error:'refused by test'}});}if(p.endsWith('/script'))return r.fulfill({status:404,body:''});if(u.searchParams.get('format')==='json')return r.fulfill({json:{exists:false}});return r.fulfill({contentType:'text/css',body:''});}
    if(!['GET','HEAD'].includes(m)){writes.push(m+' '+p);return r.fulfill({status:405,json:{error:'refused by test'}});}
    if(p.startsWith(prefix)){const f=path.resolve(root,p.slice(prefix.length)||'index.html');if(f.startsWith(root+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({contentType:type(f),body:fs.readFileSync(f)});return r.fulfill({status:404,body:''});}
    if(p==='/wizard/v1/ui-preferences')return r.fulfill({json:{launcher:{},migrations:{'launcher-seed-v1':true}}});
    if(p.endsWith('/v1/setup'))return r.fulfill({json:{first_run:false}});
    if(p.endsWith('/v1/apps'))return r.fulfill({json:{apps:[]}});
    if(p.startsWith('/wizard/v1/pages/'))return r.fulfill({status:404,json:{error:'file_not_found'}});
    return r.fulfill({json:{sessions:[],agents:[],apps:[],connected:false}});
   });
   const pg=await ctx.newPage();pg.on('pageerror',e=>errors.push(e.message));
   await pg.goto(origin+prefix+(phone?'':'desktop.html'));
   await pg.waitForFunction(()=>window.WosSettings&&(window.__wos||window.__wux)&&window.WosMySkin);
   await pg.addStyleTag({content:'#wosWelcome{display:none!important}'});
   await pg.evaluate(()=>{if(window.WosWelcome?.active)window.WosWelcome.close?.();});
   await pg.waitForFunction(()=>(window.WosMySkin.recipes||[]).length===2,null,{timeout:15000});
   await pg.waitForFunction(()=>{const o=window.__wos?.openSettings||window.__wux?.openSettings;o();return !!document.querySelector('.st-inner .st-index nav');},null,{timeout:15000});
   const look=async()=>{
    const stacked=await pg.evaluate(()=>{const p=document.querySelector('.st-root .st-page');return !p||!p.getClientRects().length||!p.getBoundingClientRect().height;});
    if(stacked||!(await pg.locator('[data-stgroup="look"]:visible').count()))await pg.locator('.st-index [data-st-page="appearance"]:visible').first().click();
    await pg.locator('[data-stgroup="look"]:visible').first().waitFor({timeout:10000});await pg.waitForTimeout(500);
   };
   await look();
   const read=()=>pg.evaluate(()=>{
    const g=[...document.querySelectorAll('[data-stgroup="look"]')].find(e=>e.getClientRects().length);
    const page=g.closest('.st-page')||g.parentElement;
    const heads=[...g.querySelectorAll('h4')].map(h=>h.textContent.trim());
    const list=g.querySelector('[role="group"][aria-label="Skins"]');
    const cards=list?[...list.querySelectorAll('.skp-card')].map(b=>({name:b.querySelector('.skp-nm')?.textContent.trim(),pick:b.dataset.skinpick||null,own:b.dataset.ownskin||null,newskin:b.hasAttribute('data-newskin'),pressed:b.getAttribute('aria-pressed')})):[];
    return {heads,cards,families:g.querySelectorAll('[data-skinfamily]').length,looks:/Looks/.test(g.textContent),mode:!!g.querySelector('[data-skinmode]'),background:!!g.querySelector('[role="radiogroup"][aria-label="Background"]'),ownPanel:!!g.querySelector('[data-ownskin-panel]'),import:!!page.querySelector('[data-skinimport]'),switches:g.querySelectorAll('[data-try-features]').length,html:g.outerHTML,cur:window.WosSkin.current,active:window.WosMySkin.active?.id||null};
   });
   const shot=async name=>{if(!out)return;const g=pg.locator('[data-stgroup="look"]:visible').first();await g.scrollIntoViewIfNeeded();await pg.screenshot({path:path.join(out,`look-${v.shell}-${name}.png`)});};
   const tap=async sel=>{const el=pg.locator(sel+':visible').first();await el.scrollIntoViewIfNeeded();if(phone)await el.tap();else await el.click();await pg.waitForTimeout(700);};
   const r={case:label};
   let s=await read();
   r.heads=s.heads;r.cards=s.cards.map(c=>c.name);
   await shot('on');
   // 1. One list of skins: every colour, the own skins, + New skin; no Skin row and no separate Colors row.
   assert.ok(s.families===0,`${label}: no skin family row`);
   assert.ok(!s.looks,`${label}: called skins, not looks (James, 27 Nov)`);
   assert.ok(!s.heads.includes('Colors')&&!s.heads.includes('Skin'),`${label}: no Colors or Skin heading ${JSON.stringify(s.heads)}`);
   assert.ok(s.heads.includes('Skins'),`${label}: one Skins list ${JSON.stringify(s.heads)}`);
   const picks=s.cards.filter(c=>c.pick).map(c=>c.pick);
   for(const id of ['nebula','grove','tide','ember','signal','obsidian'])assert.ok(picks.includes(id),`${label}: ${id} is a look ${JSON.stringify(picks)}`);
   assert.ok(!picks.some(id=>/^landscapes/.test(id)),`${label}: Landscapes colours stay a Background`);
   assert.deepEqual(s.cards.filter(c=>c.own).map(c=>c.name),['Work look','Night look'],`${label}: own skins are looks in the same list`);
   assert.ok(s.cards.at(-1).newskin,`${label}: + New skin ends the list`);
   assert.equal(s.cards.filter(c=>c.pressed==='true').map(c=>c.pick).join(),'nebula',`${label}: the worn look is marked`);
   assert.equal(s.switches,0,`${label}: no feature switches on Look`);
   assert.ok(s.import,`${label}: Import skin JSON stays`);
   r.modeBackgroundOnNebula={mode:s.mode,background:s.background};
   // 2. Mode and Background stay where a look has them: Obsidian (Dark/Light twins + Landscapes backgrounds).
   await tap('[data-skinpick="obsidian"]');s=await read();
   assert.equal(s.cur,'obsidian');assert.ok(s.mode&&s.background,`${label}: Obsidian shows Mode and Background`);
   await tap('[data-skinmode="light"]');s=await read();
   assert.equal(s.cur,'obsidian-light',`${label}: Mode Light switches the look`);
   assert.equal(s.cards.find(c=>c.pressed==='true')?.pick,'obsidian-light',`${label}: the light twin is marked`);
   // 3. An own skin is worn from the same list; it sets its own background, so Mode/Background step aside.
   await tap('[data-ownskin="work"]');await pg.waitForFunction(()=>window.WosMySkin.active?.id==='work',null,{timeout:8000});s=await read();
   assert.equal(s.cur,'grove',`${label}: wearing Work look wears its colour`);
   assert.deepEqual(s.cards.filter(c=>c.pressed==='true').map(c=>c.own),['work'],`${label}: only the own skin is marked`);
   assert.ok(!s.mode&&!s.background&&s.ownPanel,`${label}: own skin panel instead of Mode/Background`);
   await shot('own');
   // 4. Picking a colour takes the own skin off.
   await tap('[data-skinpick="tide"]');await pg.waitForFunction(()=>!window.WosMySkin.active,null,{timeout:8000});await pg.waitForTimeout(800);s=await read();
   assert.equal(s.cur,'tide');assert.equal(s.active,null,`${label}: a colour takes the own skin off`);
   // 5. New skin stays: a name and a colour, no feature list, and Create saves it as a look in the list.
   await tap('[data-newskin]');
   const sheet=await pg.evaluate(()=>{const g=[...document.querySelectorAll('[data-newskin-sheet]')].find(e=>e.getClientRects().length);return g&&{tweaks:g.querySelectorAll('[data-draft-tweak]').length,hint:!!g.querySelector('[data-newskin-look-only]')};});
   assert.ok(sheet&&sheet.tweaks===0&&sheet.hint,`${label}: New skin has no feature list ${JSON.stringify(sheet)}`);
   await pg.locator('[data-skin-name]:visible').first().fill('Beach look');await tap('[data-skin-create]');
   await pg.waitForFunction(()=>window.WosMySkin.active?.name==='Beach look',null,{timeout:8000});s=await read();
   assert.ok(s.cards.some(c=>c.own&&c.name==='Beach look'&&c.pressed==='true'),`${label}: the new skin is a look in the list`);
   r.skinWrites=skinWrites;r.writes=[...new Set(writes)];r.errors=errors;
   assert.deepEqual(errors,[],`${label}: no page errors`);
   report.push(r);await ctx.close();
  }
 }finally{await browser.close();}
 console.log(JSON.stringify(report,null,1));console.log('PASS',report.length,'cases');
})().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
