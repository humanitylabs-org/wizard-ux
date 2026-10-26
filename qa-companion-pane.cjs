// Read-only installed-app A/B + generic SDK acceptance. Run browser on forum.
// Usage: QA_CHROME=<chrome> PW=<playwright module> QA_OUT=$TMPDIR/companion/<name>
//        node qa-companion-pane.cjs http://127.0.0.1:<port> [--baseline]
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PW || './tools/qa-playwright.cjs');
const origin = process.argv[2], baseline = process.argv.includes('--baseline');
const out = process.env.QA_OUT || path.join(process.env.TMPDIR || '.', 'companion');
fs.mkdirSync(out, { recursive: true });
const receipt = { baseline, app: 'real installed Video Editor via qa-origin read-only app proxy', checks: [], layouts: {}, errors: [], blockedWrites: [] };
function ok(name, value, detail) { receipt.checks.push({ name, pass: !!value, detail }); console.log(`${value ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`); assert.ok(value, name); }
const fixtureHTML = '<!doctype html><html data-app="qa-companion"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/wizard-os-home/kit/wizard-ui.css"><body><main class="wz-app"><section class="wz-scroll"><h2 class="wz-sec-h">Bound selection</h2><p>Shared companion view</p><p>Nested view: <output id="depth">1</output></p><div class="wz-field-row"><input class="wz-field" aria-label="Unsent draft" id="draft" value="retained draft"></div></section></main><script src="/wizard-os-home/core/app-client.js"></script><script src="/qa-companion/fixture.js"></script></body></html>';
const fixtureJS = `window.depth=1;window.messages=[];WizardApp.back.register({canGoBack:()=>depth>0,back:()=>{if(!depth)return false;document.querySelector('#depth').textContent=--depth;return true}});WizardApp.shell?.onCompanionMessage(msg=>messages.push(msg));window.sdkReady=WizardApp.ready();`;
async function frameFor(p, part) { const locator = p.locator(`.win iframe[src*="${part}"]`).first(); await locator.waitFor({state:'attached'}); const f = await (await locator.elementHandle()).contentFrame(); await f.waitForURL(url => url.href.includes(part)); await f.waitForLoadState('domcontentloaded'); return f; }
async function back(p, mobile) { const step = await p.evaluate(m => m ? __wosNativeBack() : __wux.escStep(), mobile); await p.waitForTimeout(150); return step; }
async function current(p, mobile) { return p.evaluate(m => { const s=m?__wos:__wux; return m?s.desks[s.idx].focus:s.ws[s.cur].focus; }, mobile); }
(async () => {
 const b = await chromium.launch({ executablePath: process.env.QA_CHROME, headless: true, args: ['--no-sandbox'] });
 try {
  for (const mobile of [true, false]) {
   const label = mobile ? 'phone' : 'desktop';
   const ctx = await b.newContext({ viewport: mobile ? { width: 412, height: 892 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
   await ctx.addInitScript(() => { if (window === parent) { localStorage.setItem('wos.coached','true'); localStorage.setItem('wos.deskcoached','true'); localStorage.setItem('wos.tour.done','true'); } });
   await ctx.route('**/*', async r => {
    const req=r.request(), u=new URL(req.url());
    if (u.origin !== origin) return r.abort();
    if (!['GET','HEAD'].includes(req.method())) { receipt.blockedWrites.push({method:req.method(),path:u.pathname}); return r.fulfill({status:403,contentType:'application/json',body:'{"error":"QA read-only"}'}); }
    // Isolate unrelated owner skin recipes; 404 exercises the supported local-preview fallback.
    if (/^\/wizard\/v1\/(skins|my-skin)(\/|$)/.test(u.pathname)) return r.fulfill({status:404,body:'{}'});
    if (u.pathname === '/qa-companion/fixture.js') return r.fulfill({contentType:'application/javascript',body:fixtureJS});
    if (u.pathname === '/qa-companion/') return r.fulfill({contentType:'text/html',body:fixtureHTML});
    if (u.pathname.endsWith('/data.js') || u.pathname.endsWith('/summaries.js')) return r.fulfill({contentType:'application/javascript',body:''});
    if (u.pathname === '/wizard/v1/apps') {
     const response=await r.fetch(), json=await response.json();
     json.apps ||= []; json.apps.push({id:'qa-companion',kind:'wizard',name:'Companion SDK fixture',url:'/qa-companion/',colors:['#8899aa','#99aabb']});
     return r.fulfill({response,json});
    }
    return r.continue();
   });
   const p = await ctx.newPage(); p.on('pageerror',e=>receipt.errors.push({shell:label,error:String(e)}));
   try {
    await p.goto(origin + '/wizard-os-home/' + (mobile?'?shell=phone':'desktop.html?shell=desktop'));
    await p.waitForFunction(m=>m?!!window.__wos?.wins:!!window.__wux?.wins,mobile); await p.evaluate(()=>WizCore.appsLoaded());
    await p.evaluate(m=>{ const s=m?__wos:__wux; s.openApp(WizCore.apps(m?'mobile':'desktop').APP['video-editor']); },mobile);
    const video=await frameFor(p,'/video-editor/');
    const clipButton = video.locator('[data-act="go"][data-v*="/clip/"]').first();
    await clipButton.waitFor({state:'attached'});
    const hash = await clipButton.getAttribute('data-v');
    await p.evaluate(m=>{const s=m?__wos:__wux,w=Object.values(s.wins).find(w=>w.appId==='video-editor');if(m)s.goDesk(s.desks.findIndex(d=>d.wins.includes(w.id)),true);s.focusWin(w.id);},mobile);
    await clipButton.evaluate(el=>el.click());
    await p.waitForFunction(()=>{const s=window.__wos||window.__wux;return Object.values(s.wins).some(w=>w.url?.includes('pane=feedback'));});
    const feedback=await frameFor(p,'pane=feedback'); await feedback.waitForFunction(hash=>location.hash===hash,hash);
    const layout=await p.evaluate(m=>{
     const s=m?__wos:__wux, owner=Object.values(s.wins).find(w=>w.appId==='video-editor'), peer=Object.values(s.wins).find(w=>w.url?.includes('pane=feedback'));
     const rect=id=>{const r=document.querySelector('.win[data-win="'+id+'"]')?.getBoundingClientRect();return {x:r?.x,width:r?.width};};
     return {owner:owner.id,peer:peer.id,order:m?s.desks.filter(d=>!d.home).flatMap(d=>d.wins.map(id=>id===owner.id?'app':id===peer.id?'companion':s.wins[id]?.app==='chats'?'chats':'other')):undefined,ownerShare:owner.share,peerShare:peer.share,ownerRect:rect(owner.id),peerRect:rect(peer.id)};
    },mobile);
    receipt.layouts[label]=layout;
    ok(label+' real installed clip opens Feedback',!!layout.peer);
    if(mobile)ok(label+' Chats → app → companion desk order',JSON.stringify(layout.order.slice(0,3))==='["chats","app","companion"]',layout.order);
    else {ok(label+' legacy layout shares unchanged',layout.ownerShare===.46&&layout.peerShare===.26,layout);ok(label+' companion tiled beside app',layout.peerRect.x>layout.ownerRect.x && layout.peerRect.width<layout.ownerRect.width);}
    await p.screenshot({path:path.join(out,label+'-video.png')});
    // Real unchanged Add note message (context + focus), without writing a note.
    await video.evaluate(()=>{const button=[...document.querySelectorAll('button')].find(b=>/add note/i.test(b.textContent)); if(!button)throw Error('Real Add note control missing'); button.click();});
    await p.waitForFunction(({id,m})=>{const s=m?__wos:__wux;return (m?s.desks[s.idx]:s.ws[s.cur]).focus===id;},{id:layout.peer,m:mobile});
    ok(label+' real Add note focuses Feedback',await current(p,mobile)===layout.peer);
    await back(p,mobile);
    ok(label+' real Feedback Back (legacy open-video) returns to app',await current(p,mobile)===layout.owner);
    // Leave clip via the real app router; both implementations close only the bound pane.
    await video.locator('[data-act="go"][data-v="#/"]').evaluate(el=>el.click());
    await p.waitForFunction(id=>!(window.__wos||window.__wux).wins[id],layout.peer);
    ok(label+' leaving clip closes Feedback',true);
    if(!baseline) {
     await p.evaluate(m=>{const s=m?__wos:__wux;s.openApp(WizCore.apps(m?'mobile':'desktop').APP['qa-companion']);},mobile);
     const app=await frameFor(p,'/qa-companion/'); await app.evaluate(()=>sdkReady);
     const own=await p.evaluate(m=>{const s=m?__wos:__wux;return Object.values(s.wins).find(w=>w.appId==='qa-companion').id;},mobile);
     const peer=await app.evaluate(()=>WizardApp.shell.openCompanion({path:'?pane=notes',title:'Notes',share:.36,focus:true,data:{item:'selected'}}));
     const companion=await frameFor(p,'pane=notes'); await companion.evaluate(()=>sdkReady);
     await companion.waitForFunction(()=>messages.some(m=>m.data?.item==='selected'));
     ok(label+' generic SDK opens a companion with replayed initial binding',!!peer.id);
     const share=await p.evaluate(id=>(window.__wos||window.__wux).wins[id].share,peer.id); ok(label+' generic desktop share persisted',share===.36);
     await companion.evaluate(()=>WizardApp.shell.postCompanion({note:'reply'})); await app.waitForFunction(()=>messages.some(m=>m.from==='companion'&&m.data?.note==='reply'));
     ok(label+' bound bidirectional messages',true);
     await back(p,mobile); ok(label+' nested companion Back peels one view',await companion.evaluate(()=>depth===0) && await current(p,mobile)===peer.id);
     await back(p,mobile); ok(label+' next Back returns to app',await current(p,mobile)===own);
     await back(p,mobile); ok(label+' app Back returns to previous nested view, shell stays open',await app.evaluate(()=>depth===0) && p.url().startsWith(origin+'/wizard-os-home/'));
     for(const skin of ['nebula','obsidian-light']) {
      await p.evaluate(()=>WizCore.deeplink.route(location.pathname+'?view=skin'));
      const family = skin === 'nebula' ? 'wizard' : 'mizel';
      const familyButton = p.locator('#settingsBody [data-skinfamily="'+family+'"]:visible').first();
      await familyButton.click();
      await p.locator('#settingsBody [data-skinpick="'+skin+'"]:visible').first().click();
      await p.waitForFunction(skin=>document.documentElement.dataset.skin===skin,skin);
      await p.locator('.mz-intro').waitFor({state:'detached'});
      const actual=await p.evaluate(()=>WosSkin.current);
      assert.equal(actual, skin, 'requested skin must exist');
      await p.evaluate(m=>m?__wos.closeSheets():__wux.closeSettings(),mobile);
      await p.evaluate(({id,m})=>{const s=m?__wos:__wux;if(m)s.goDesk(s.desks.findIndex(d=>d.wins.includes(id)),true);s.focusWin(id);},{id:peer.id,m:mobile});
      await p.waitForTimeout(200);
      await p.screenshot({path:path.join(out,label+'-generic-'+actual+'.png')});
      ok(label+' '+actual+' skin retains draft and bound view',await app.locator('#draft').inputValue()==='retained draft' && await p.evaluate(id=>!!(window.__wos||window.__wux).wins[id],peer.id));
     }
     const denied=await app.evaluate(async()=>{try{await WizardApp.shell.openCompanion({path:'/other-app/'});return false}catch{return true}});ok(label+' cross-app companion denied',denied);
     await app.evaluate(()=>WizardApp.shell.closeCompanion()); await p.waitForFunction(id=>!(window.__wos||window.__wux).wins[id],peer.id);
     ok(label+' closeCompanion removes only its pane',await p.evaluate(id=>!!(window.__wos||window.__wux).wins[id],own));
    }
    ok(label+' zero page errors',receipt.errors.filter(e=>e.shell===label).length===0,receipt.errors);
   } catch(e) { for (const f of p.frames()) console.error('DIAGNOSTIC', f.url(), await f.locator('body').innerText().catch(()=>''), await f.evaluate(()=>({loaded:typeof loaded==='undefined'?'missing':loaded,base:typeof BASE==='undefined'?'missing':BASE})).catch(()=>null)); await p.screenshot({path:path.join(out,label+'-failure.png')}).catch(()=>{});throw e;} finally {await ctx.close();}
  }
 } finally {await b.close();fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2));}
 console.log(JSON.stringify({passed:receipt.checks.filter(c=>c.pass).length,failed:receipt.checks.filter(c=>!c.pass).length,pageErrors:receipt.errors.length,app:receipt.app}));
})().catch(e=>{console.error(e);process.exitCode=1;});
