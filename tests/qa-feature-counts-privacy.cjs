'use strict';
// Share feature counts in Settings › Privacy (wizard-ux issue 2053, switch wizard/feature-counts-privacy). Real phone
// (412 px) and desktop shells on a synthetic origin, For testers channel, every box write refused. Switch on: Try new
// features no longer lists Share feature counts; Privacy shows "Share feature counts with the team" bound to the same
// switch (wizard/try-feature-counts), off by default, turning it on goes through the Share prompt, off is one tap, and
// a device that already shared keeps sharing. QA_SWITCH=off checks today's places (Try new features has it, Privacy
// has none). QA_LOOK=old runs with Skins are look only off (Try new features inside Appearance). QA_OUT saves shots.
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.env.QA_WEB||path.join(__dirname,'../web')),origin='https://feature-counts.test',prefix='/wizard-os-home/';
const out=process.env.QA_OUT||'';if(out)fs.mkdirSync(out,{recursive:true});
const ON=process.env.QA_SWITCH!=='off',ID='wizard/feature-counts-privacy',COUNTS='wizard/try-feature-counts',LOOK='wizard/skins-look-only';
const OLD_LOOK=process.env.QA_LOOK==='old';
const only=(process.env.QA_CASES||'phone,desktop').split(',');
const type=f=>f.endsWith('.js')||f.endsWith('.mjs')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':f.endsWith('.json')?'application/json':f.endsWith('.png')?'image/png':f.endsWith('.svg')?'image/svg+xml':'application/octet-stream';
(async()=>{
 const browser=await chromium.launch({headless:true});const report=[];
 try{
  for(const v of [{shell:'phone',w:412,h:892},{shell:'desktop',w:1366,h:860}].filter(v=>only.includes(v.shell))){
   for(const shared of [false,true]){
    const phone=v.shell==='phone',label=`${v.shell}${ON?'':' (switch off)'}${shared?' already sharing':''}`;
    const ctx=await browser.newContext({viewport:{width:v.w,height:v.h},isMobile:phone,hasTouch:phone,deviceScaleFactor:phone?2:1,serviceWorkers:'block'});
    await ctx.routeWebSocket('**/*',ws=>ws.close());
    const mix={...(OLD_LOOK?{}:{[LOOK]:true}),...(ON?{[ID]:true}:{}),...(shared?{[COUNTS]:true}:{})};
    await ctx.addInitScript(({shell,mix,shared})=>{if(window!==window.top)return;if(sessionStorage.getItem('qa.boot'))return;sessionStorage.setItem('qa.boot','1');const ls={'wos.shell':shell,'wos.channel.v1':'latest','wos.coached':'true','wos.tour.v1':'true','wos.welcome.v1':'done','wos.desktop-view.v1':'classic','wos.skin':'nebula','wos.skin-tweaks.v1':JSON.stringify({version:1,preset:'none',off:{},mix})};if(shared)ls['wos.feature-counts.answer.v1']='share';for(const[k,val]of Object.entries(ls))localStorage.setItem(k,val);},{shell:v.shell,mix,shared});
    const errors=[],writes=[];
    await ctx.route('**/*',async r=>{
     const q=r.request(),u=new URL(q.url()),p=u.pathname,m=q.method();
     if(u.origin!==origin)return r.abort();
     if(!['GET','HEAD'].includes(m)){writes.push(m+' '+p);return r.fulfill({status:405,json:{error:'refused by test'}});}
     if(p.startsWith(prefix)&&!p.includes('/store-install/')){const f=path.resolve(root,p.slice(prefix.length)||'index.html');if(f.startsWith(root+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({contentType:type(f),body:fs.readFileSync(f)});return r.fulfill({status:404,body:''});}
     if(p.startsWith('/wizard/v1/my-skin')){if(p.endsWith('/script'))return r.fulfill({status:404,body:''});if(u.searchParams.get('format')==='json')return r.fulfill({json:{exists:false}});return r.fulfill({contentType:'text/css',body:''});}
     if(p==='/wizard/v1/skins')return r.fulfill({json:{skins:[],active:null}});
     if(p==='/wizard/v1/ui-preferences')return r.fulfill({json:{launcher:{},migrations:{'launcher-seed-v1':true}}});
     if(p.endsWith('/v1/setup'))return r.fulfill({json:{first_run:false}});
     if(p.endsWith('/v1/apps'))return r.fulfill({json:{apps:[]}});
     if(p.startsWith('/wizard/v1/pages/'))return r.fulfill({status:404,json:{error:'file_not_found'}});
     if(p.includes('/store-install/'))return r.fulfill({status:404,json:{error:'none'}});
     return r.fulfill({json:{sessions:[],agents:[],apps:[],connected:false}});
    });
    const pg=await ctx.newPage();pg.on('pageerror',e=>errors.push(e.message));
    await pg.goto(origin+prefix+(phone?'':'desktop.html'));
    await pg.waitForFunction(()=>window.WosSettings&&(window.__wos||window.__wux)&&window.WosExperience);
    await pg.addStyleTag({content:'#wosWelcome{display:none!important}'});
    await pg.evaluate(()=>{if(window.WosWelcome?.active)window.WosWelcome.close?.();});
    await pg.waitForFunction(([id,on])=>(document.documentElement.dataset.tweaks||'').split(' ').includes(id)===on,[ID,ON],{timeout:15000});
    await pg.waitForFunction(()=>(window.WosExperience.state.tweaks||[]).length>0,null,{timeout:15000});
    await pg.waitForFunction(()=>{const o=window.__wos?.openSettings||window.__wux?.openSettings;o();return !!document.querySelector('.st-inner .st-index nav');},null,{timeout:15000});
    const tryPage=OLD_LOOK?'appearance':'try-features';
    const openPage=async id=>{
     const back=pg.locator('.st-root .st-back:visible, .st-root [data-st-back]:visible').first();
     const btn=pg.locator(`.st-index [data-st-page="${id}"]:visible`).first();
     if(!(await btn.count())&&(await back.count()))await back.click();
     await pg.locator(`.st-index [data-st-page="${id}"]:visible`).first().click();
     await pg.waitForTimeout(600);
    };
    const pages=await pg.evaluate(()=>[...document.querySelectorAll('.st-index [data-st-page]')].map(b=>b.dataset.stPage));
    const rows=()=>pg.evaluate(()=>[...document.querySelectorAll('[data-tweak-toggle]')].filter(b=>b.getClientRects().length).map(b=>({id:b.dataset.tweakToggle,name:b.querySelector('b')?.textContent.trim(),on:b.getAttribute('aria-checked'),try:!!b.closest('[data-try-features]')})));
    const r={case:label};
    let tryRows=[];
    if(pages.includes(tryPage)){await openPage(tryPage);tryRows=(await rows()).filter(x=>x.try);}
    r.tryHasCounts=tryRows.some(x=>x.id===COUNTS);
    if(out&&!shared&&r.tryHasCounts)await pg.locator(`[data-try-features] [data-tweak-toggle="${COUNTS}"]:visible`).first().scrollIntoViewIfNeeded();
    if(out&&!shared&&pages.includes(tryPage))await pg.screenshot({path:path.join(out,`try-${v.shell}-${ON?'on':'off'}.png`)});
    await openPage('privacy');
    const priv=(await rows()).filter(x=>x.id===COUNTS);
    r.privacy=priv.map(x=>`${x.name} (${x.on==='true'?'on':'off'})`);
    if(!ON){
     assert.ok(r.tryHasCounts,`${label}: Try new features keeps Share feature counts`);
     assert.equal(priv.length,0,`${label}: nothing new on Privacy`);
    }else{
     assert.ok(!r.tryHasCounts,`${label}: Try new features no longer lists Share feature counts`);
     assert.equal(priv.length,1,`${label}: Privacy has one Share feature counts row`);
     assert.equal(priv[0].name,'Share feature counts with the team');
     assert.equal(priv[0].on,String(shared),`${label}: the device's current choice carries over`);
     const row=pg.locator(`[data-tweak-toggle="${COUNTS}"]:visible`).first();
     await row.scrollIntoViewIfNeeded();
     if(out&&!shared)await pg.screenshot({path:path.join(out,`privacy-${v.shell}-on.png`)});
     if(!shared){
      await row.click();await pg.waitForTimeout(400);
      const ask=await pg.evaluate(()=>document.querySelector('[data-fc-ask]')?.textContent||'');
      assert.match(ask,/Share feature counts\?/,`${label}: turning it on asks first`);
      assert.match(ask,/in Settings, under Privacy/,`${label}: the prompt says where to turn it off`);
      assert.ok(!(await pg.evaluate(c=>(document.documentElement.dataset.tweaks||'').split(' ').includes(c),COUNTS)),'nothing on before Share');
      await pg.locator('[data-fc-ask-yes]').click();
      await pg.waitForFunction(c=>(document.documentElement.dataset.tweaks||'').split(' ').includes(c),COUNTS,{timeout:8000});
      await pg.waitForTimeout(400);
      assert.equal((await rows()).find(x=>x.id===COUNTS)?.on,'true',`${label}: Share turns it on`);
     }
     await pg.locator(`[data-tweak-toggle="${COUNTS}"]:visible`).first().click();
     await pg.waitForFunction(c=>!(document.documentElement.dataset.tweaks||'').split(' ').includes(c),COUNTS,{timeout:8000});
     assert.equal(await pg.evaluate(()=>!!document.querySelector('[data-fc-ask]')),false,'off is one tap, no prompt');
     r.flow=shared?'kept on → one tap off':'prompt → Share → on → one tap off';
    }
    assert.deepEqual(errors,[],`${label}: page errors`);
    report.push(r);await ctx.close();
   }
  }
  console.log(JSON.stringify({ok:true,switch:ON?'on':'off',look:OLD_LOOK?'old':'look-only',report},null,1));
 }catch(e){console.log(JSON.stringify({ok:false,error:e.message,report},null,1));process.exitCode=1;}
 finally{await browser.close();}
})();
