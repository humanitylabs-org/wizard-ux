'use strict';
// Search in Settings (switch wizard/settings-search, humanitylabs-org/try-wizard#94). Real phone and desktop shells on a
// synthetic origin, every write refused. With the switch on: the box sits at the top of the category list; typing
// keeps only the pages that mention the words, marks them on the open page and scrolls the first mark into view; Esc
// clears it. With it off (QA_ONLY_OFF=1, or the off pass of every run): no box, and the list is the full list.
// QA_OUT=<dir> saves screenshots. QA_WEB=<checkout>/web points at another build.
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.env.QA_WEB||path.join(__dirname,'../web')),origin='https://settings-search.test',prefix='/wizard-os-home/';
const out=process.env.QA_OUT||'';if(out)fs.mkdirSync(out,{recursive:true});
const ID='wizard/settings-search',WORD=process.env.QA_WORD||'skin',DEEPS={desktop:process.env.QA_DEEP||'Moonrise',phone:process.env.QA_DEEP||'opacity'};
const type=f=>f.endsWith('.js')||f.endsWith('.mjs')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':f.endsWith('.json')?'application/json':'application/octet-stream';
(async()=>{
 const browser=await chromium.launch({headless:true});const results=[];
 try{
  for(const on of process.env.QA_ONLY_OFF==='1'?[false]:[false,true])for(const v of [{shell:'desktop',w:1280,h:760},{shell:'desktop',w:2400,h:900},{shell:'phone',w:390,h:844}]){
   const phone=v.shell==='phone',DEEP=DEEPS[v.shell],label=`${v.shell} ${v.w} ${on?'on':'off'}`;
   const ctx=await browser.newContext({viewport:{width:v.w,height:v.h},isMobile:phone,hasTouch:phone,serviceWorkers:'block'});
   await ctx.routeWebSocket('**/*',ws=>ws.close());
   const mix=on?{[ID]:true}:{};
   await ctx.addInitScript(({shell,mix})=>{if(window!==window.top)return;for(const[k,val]of Object.entries({'wos.shell':shell,'wos.coached':'true','wos.tour.v1':'true','wos.welcome.v1':'done','wos.desktop-view.v1':'classic','wos.skin-tweaks.v1':JSON.stringify({version:1,preset:'none',off:{},mix})}))localStorage.setItem(k,val);},{shell:v.shell,mix});
   const errors=[],writes=[];
   await ctx.route('**/*',async r=>{
    const q=r.request(),u=new URL(q.url()),p=u.pathname;
    if(u.origin!==origin)return r.abort();
    if(!['GET','HEAD'].includes(q.method())){writes.push(q.method()+' '+p);return r.fulfill({status:405,json:{error:'refused by test'}});}
    if(p.startsWith(prefix)){const f=path.resolve(root,p.slice(prefix.length)||'index.html');if(f.startsWith(root+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({contentType:type(f),body:fs.readFileSync(f)});}
    if(p==='/wizard/v1/ui-preferences')return r.fulfill({json:{launcher:{},migrations:{'launcher-seed-v1':true}}});
    if(p.endsWith('/v1/setup'))return r.fulfill({json:{first_run:false}});
    if(p.endsWith('/v1/apps'))return r.fulfill({json:{apps:[]}});
    return r.fulfill({json:{sessions:[],agents:[],apps:[],connected:false}});
   });
   const pg=await ctx.newPage();pg.on('pageerror',e=>errors.push(e.message));
   await pg.goto(origin+prefix+(phone?'':'desktop.html'));
   await pg.waitForFunction(()=>window.WosSettings&&(window.__wos||window.__wux));
   await pg.addStyleTag({content:'#wosWelcome{display:none!important}'});
   // The synthetic box answers no setup: close the Welcome so it doesn't own Esc.
   await pg.evaluate(()=>{if(window.WosWelcome?.active)window.WosWelcome.close?.();});
   await pg.waitForFunction(()=>{const o=window.__wos?.openSettings||window.__wux?.openSettings;o();return !!document.querySelector('.st-inner .st-index nav');},null,{timeout:15000});
   if(on)await pg.waitForFunction(id=>(document.documentElement.dataset.tweaks||'').split(' ').includes(id)&&document.querySelector('[data-st-search]'),ID,{timeout:15000});
   await pg.waitForTimeout(600);
   const cats=()=>pg.evaluate(()=>[...document.querySelectorAll('.st-index [data-st-page]')].map(b=>b.dataset.stPage));
   const all=await cats();
   const r={variant:label,all};
   if(out)await pg.screenshot({path:path.join(out,`settings-search-${v.shell}-${v.w}-${on?'on':'off'}-before.png`)});
   if(!on){
    r.box=await pg.locator('[data-st-search]').count();
    assert.equal(r.box,0,`${label}: no search box while off`);
   }else{
    const box=pg.locator('[data-st-search]');
    const geo=await pg.evaluate(()=>{const b=document.querySelector('[data-st-search]').getBoundingClientRect(),c=document.querySelector('.st-index [data-st-page]').getBoundingClientRect();return {boxTop:b.top,boxLeft:b.left,firstCat:c.top};});
    assert.ok(geo.boxTop<geo.firstCat,`${label}: the box sits above the categories ${JSON.stringify(geo)}`);
    await box.click();await box.pressSequentially(WORD,{delay:30});await pg.waitForTimeout(300);
    r.filtered=await cats();
    r.focused=await pg.evaluate(()=>document.activeElement?.matches?.('[data-st-search]'));
    assert.ok(r.focused,`${label}: typing keeps focus in the box`);
    assert.ok(r.filtered.length>0&&r.filtered.length<all.length,`${label}: the list narrows ${JSON.stringify(r)}`);
    assert.ok(r.filtered.includes('appearance'),`${label}: Appearance mentions "${WORD}"`);
    // A narrow Settings (the phone, or a narrow desktop window) shows the list alone: open the page from it.
    r.stacked=await pg.evaluate(()=>{const p=document.querySelector('[data-st-search]').closest('.st-root').querySelector('.st-page');return !p.getClientRects().length||!p.getBoundingClientRect().height;});
    if(r.stacked){await pg.locator('.st-index [data-st-page="appearance"]').click();await pg.waitForTimeout(300);}
    r.marks=await pg.evaluate(()=>{const st=[...document.querySelectorAll('.st-root')].find(x=>x.querySelector('[data-st-search]')),pane=st.querySelector('.st-page'),ms=[...pane.querySelectorAll('mark.st-hit')],f=pane.querySelector('mark.st-hit-first');const fr=f?.getBoundingClientRect(),pr=pane.getBoundingClientRect();return {pane:[pr.top,pr.bottom,pane.scrollTop,pane.scrollHeight,pane.clientHeight],fr:fr&&[fr.top,fr.bottom],firstText:f?.parentElement?.outerHTML.slice(0,200),n:ms.length,texts:[...new Set(ms.map(m=>m.textContent.toLowerCase()))],first:!!f,firstVisible:!!fr&&fr.bottom>Math.max(0,pr.top)&&fr.top<Math.min(innerHeight,pr.bottom)};});
    assert.ok(r.marks.n>0,`${label}: the open page marks the words ${JSON.stringify(r.marks)}`);
    assert.deepEqual(r.marks.texts,[WORD.toLowerCase()]);
    if(out)await pg.screenshot({path:path.join(out,`settings-search-${v.shell}-${v.w}-on-after.png`)});
    assert.ok(r.marks.first&&r.marks.firstVisible,`${label}: the first mark is scrolled into view ${JSON.stringify(r.marks)}`);
    r.catMarks=await pg.locator('.st-index .st-category mark.st-hit').count();
    if(out)await pg.screenshot({path:path.join(out,`settings-search-${v.shell}-${v.w}-on-after.png`)});
    if(r.stacked){await pg.locator('[data-st-back]').click();await pg.waitForTimeout(300);r.backKept=await pg.evaluate(()=>document.querySelector('[data-st-search]')?.value);assert.equal(r.backKept,WORD,`${label}: Back to the list keeps the words`);}
    await pg.waitForFunction(()=>{if(window.WosWelcome?.active)window.WosWelcome.close?.();return !window.WosWelcome?.active;});
    // A word that is not on the default page, typed letter by letter: the page beside the list follows the matches
    // on every keystroke (it used to fall back to Appearance on every other letter).
    await pg.locator('[data-st-search]').fill('');await pg.waitForTimeout(200);
    r.typed=[];
    for(const ch of 'voice'){await pg.locator('[data-st-search]').press(ch);await pg.waitForTimeout(150);r.typed.push(await pg.evaluate(()=>{const st=[...document.querySelectorAll('.st-root')].find(x=>x.querySelector('[data-st-search]'));return {q:st.querySelector('[data-st-search]').value,head:st.querySelector('.st-page-head h3')?.textContent,marks:st.querySelectorAll('.st-page mark.st-hit').length,cats:[...st.querySelectorAll('.st-index [data-st-page]')].map(b=>b.dataset.stPage)};}));}
    if(!r.stacked)for(const t of r.typed.slice(1))assert.ok(t.marks>0&&t.cats.length>0,`${label}: "${t.q}" shows a matching page with marks ${JSON.stringify(t)}`);
    if(!r.stacked)assert.equal(r.typed.at(-1).head,'Voice & typing',`${label}: typing "voice" shows Voice & typing ${JSON.stringify(r.typed)}`);
    if(out)await pg.screenshot({path:path.join(out,`settings-search-${v.shell}-${v.w}-on-voice.png`)});
    // Esc right after typing clears at the first press.
    await pg.locator('[data-st-search]').press('Escape');await pg.waitForTimeout(250);
    r.escOnce=await pg.evaluate(()=>[...document.querySelectorAll('[data-st-search]')].map(i=>i.value).join('|'));
    assert.equal(r.escOnce,'',`${label}: one Esc clears the words`);
    // A word far down the page (a background's name): the page opens scrolled to it, not at the top.
    await pg.locator('[data-st-search]').fill(DEEP);await pg.waitForTimeout(300);
    r.deepPages=await cats();
    assert.ok(r.deepPages.length>0,`${label}: some page mentions "${DEEP}"`);
    if(r.stacked){await pg.locator('.st-index [data-st-page]').first().click();await pg.waitForTimeout(400);}
    r.deep=await pg.evaluate(()=>{const st=[...document.querySelectorAll('.st-root')].find(x=>x.querySelector('[data-st-search]')),pane=st.querySelector('.st-page'),f=pane.querySelector('mark.st-hit-first');const fr=f?.getBoundingClientRect(),pr=pane.getBoundingClientRect();return {scrollTop:pane.scrollTop,overflow:pane.scrollHeight>pane.clientHeight,first:!!f,firstVisible:!!fr&&fr.bottom>Math.max(0,pr.top)&&fr.top<Math.min(innerHeight,pr.bottom)};});
    assert.ok(r.deep.first&&r.deep.firstVisible,`${label}: the first "${DEEP}" is in view ${JSON.stringify(r.deep)}`);
    if(out)await pg.screenshot({path:path.join(out,`settings-search-${v.shell}-${v.w}-on-deep.png`)});
    if(r.stacked){await pg.locator('[data-st-back]').click();await pg.waitForTimeout(300);}
    await pg.locator('[data-st-search]').press('Escape');await pg.waitForTimeout(300);
    r.cleared=await cats();r.stillOpen=await pg.locator('.st-inner').count();
    assert.deepEqual(r.cleared,all,`${label}: Esc clears the search and brings every category back`);
    assert.equal(r.stillOpen,1,`${label}: Esc with words in the box doesn't close Settings`);
    await pg.locator('[data-st-search]').fill('zzzz-nothing');await pg.waitForTimeout(300);
    r.none=await pg.locator('.st-search-none').textContent();
    assert.match(r.none,/No settings mention/);
   }
   assert.deepEqual(errors,[],`${label}: page errors`);
   r.writes=writes;results.push(r);
   await ctx.close();
  }
  console.log(JSON.stringify({ok:true,results},null,1));
 }catch(e){console.error(JSON.stringify(results,null,1));console.error(e.message);process.exitCode=1;}
 finally{await browser.close();}
})();
