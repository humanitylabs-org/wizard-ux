// Queued worker only. Registered-frame integration, not production-shell/device acceptance.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {createFixture} = require('./fixture.cjs');
const {chromium} = require(process.env.QA_PLAYWRIGHT || 'playwright');
const root = process.env.DRAFTS_KEEP_ROOT;
assert(root, 'DRAFTS_KEEP_ROOT must name the sealed acceptance packet');
const out = path.join(root,'evidence'); fs.mkdirSync(out,{recursive:true});
const server = createFixture({shell:path.join(root,'shell-current/web'),wisdom:path.join(root,'wisdom/static')});
const results = [], pixelPairs = [];
function noMojibake(text) { assert(!/[Ã]|â€|ðŸ|ðœ/.test(text), 'notice encoding: '+text); }
async function settle(page) {
  await page.evaluate(async()=>{
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().iterations)).map(a=>a.finished.catch(()=>{})));
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  });
}
// Resolve actual computed paint (including the banner's equal-stop opaque-backed gradient),
// reject filters/ancestor alpha, and hit-test text. No injected foreground/background overrides.
async function paint(locator) {
  return locator.evaluate(el=>{
    const ctx=document.createElement('canvas').getContext('2d');ctx.canvas.width=ctx.canvas.height=1;
    const rgba=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data).map((v,i)=>i===3?v/255:v);};
    const over=(a,b)=>{const alpha=a[3]+b[3]*(1-a[3]);return [...a.slice(0,3).map((v,i)=>(v*a[3]+b[i]*b[3]*(1-a[3]))/(alpha||1)),alpha];};
    const chain=[];for(let p=el;p;p=p.parentElement)chain.unshift(p);
    let bg=[0,0,0,0],opacity=1;const layers=[];
    for(const p of chain){const s=getComputedStyle(p);opacity*=Number(s.opacity);if(s.filter!=='none')throw Error('filtered notice');let c=rgba(s.backgroundColor);bg=over(c,bg);
      // Computed multi-layer backgrounds list unused layers as 'none'; drop only those.
      const image=s.backgroundImage.replace(/(?:,\s*none)+$/,'').replace(/^(?:none,\s*)+/,'');
      if(image!=='none'){
        const m=image.match(/^linear-gradient\((rgba?\([^)]*\)), (rgba?\([^)]*\))\)$/);
        if(!m||m[1]!==m[2])throw Error('unsupported painted gradient '+image);
        bg=over(rgba(m[1]),bg);
      }
      layers.push({tag:p.tagName,id:p.id,opacity:s.opacity,background:s.backgroundColor,image:s.backgroundImage});
    }
    const s=getComputedStyle(el),fg=over(rgba(s.color),bg);
    const lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    const a=lum(fg),b=lum(bg),contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
    return {color:s.color,bg,fg,contrast,opacity,layers,hit:hit===el||el.contains(hit),rect:{x:r.x,y:r.y,width:r.width,height:r.height},text:el.innerText};
  });
}
async function assertPaint(locator,label) {
  const p=await paint(locator);assert.equal(p.opacity,1,label+' opacity');assert.equal(p.bg[3],1,label+' opaque backing');assert(p.contrast>=4.5,label+' contrast '+JSON.stringify(p));assert(p.hit,label+' text is covered');return p;
}
async function pixels(page,selector,name,negative=false) {
  const box=await page.locator(selector).boundingBox();assert(box);
  const inset=Math.min(10,box.height/4),clip={x:Math.ceil(box.x+inset),y:Math.ceil(box.y+inset),width:Math.floor(box.width-2*inset),height:Math.floor(box.height-2*inset)};
  // Put loud content immediately under the tested notice; it remains below the real banner.
  await page.evaluate(()=>{const p=document.querySelector('#paint-probe');p.style.zIndex='59';p.style.background='repeating-linear-gradient(45deg,white 0 7px,magenta 7px 14px,black 14px 21px)';p.textContent='LOUD UNDERLYING TEXT '.repeat(200);});
  const a=name+'-loud.png',b=name+'-blank.png';
  await page.screenshot({path:path.join(out,a),clip,animations:'disabled',caret:'hide'});
  await page.evaluate(()=>{const p=document.querySelector('#paint-probe');p.style.background='black';p.textContent='';});
  await page.screenshot({path:path.join(out,b),clip,animations:'disabled',caret:'hide'});
  await page.evaluate(()=>{const p=document.querySelector('#paint-probe');p.style.background='';p.style.zIndex='';});
  pixelPairs.push({a,b,expectEqual:!negative});
}
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+server.address().port;
  let browser,page;
  try{
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    for(const profile of [{shell:'phone',width:412,height:915,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'},{shell:'desktop',width:1365,height:900}]){
      const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},isMobile:!!profile.isMobile,hasTouch:!!profile.hasTouch,...(profile.userAgent?{userAgent:profile.userAgent}:{})});
      page=await context.newPage();const errors=[],escaped=[],unknown=[];
      page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/favicon.ico'))unknown.push(r.url());});
      await context.route('**/*',route=>{if(new URL(route.request().url()).origin===url)return route.continue();escaped.push(route.request().url());return route.abort();});
      await page.goto(url+'/?shell='+profile.shell);let f=page.frameLocator('#wisdom');
      await f.locator('#wb-req-text').waitFor();await page.waitForFunction(()=>WizWebUpdate.firstObservedVersion);
      assert.equal(await page.locator('html').getAttribute('data-shell'),profile.shell);
      assert.equal(await f.locator('body').evaluate(()=>innerWidth),await page.locator('#wisdom').evaluate(el=>el.clientWidth));
      await page.evaluate(async()=>{await fetch('/fixture/update');await WizAppUpdates.check();});
      await page.locator('#dvWeb [data-web=go]').waitFor();
      const text='Synthetic collection request — keep across Reload 🌱';await f.locator('#wb-req-text').fill(text);
      assert.equal(await page.evaluate(()=>WizAppServices.update.reloadPlan().ok),false);
      for(const skin of ['nebula','grove']){
        // Fixture has no Settings UI: call the real registry API, assert real applied palette.
        await page.evaluate(s=>{WosSkin.set(s);WizAppearance.sync();},skin);
        await page.waitForFunction(s=>document.querySelector('#wisdom').contentDocument.documentElement.dataset.skin===s,skin);
        const palette=await page.evaluate(()=>({current:WosSkin.current,root:document.documentElement.dataset.skin,base:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),expected:WosSkin.list.find(s=>s.id===WosSkin.current).t.bg}));
        assert.equal(palette.current,skin);assert.equal(palette.root,skin);
        // Compare normalized CSS colors, not dataset or text label.
        assert(await page.evaluate(p=>{const e=document.createElement('i');document.body.append(e);e.style.color=p.base;const a=getComputedStyle(e).color;e.style.color=p.expected;const b=getComputedStyle(e).color;e.remove();return a===b;},palette));
        await settle(page);
        const title=await assertPaint(page.locator('#dvWeb .dv-um'),'notice title');
        const body=await assertPaint(page.locator('#dvWeb .wos-reload-reason'),'notice body');
        noMojibake(await page.locator('#dvWeb').innerText());
        const material=await f.locator('.wb-sheet-card').evaluate(el=>getComputedStyle(el).backgroundColor);
        assert(!/rgba\([^)]*,\s*0\)/.test(material));
        await page.screenshot({path:path.join(out,`request-${profile.width}-${skin}.png`),animations:'disabled',caret:'hide'});
        await pixels(page,'#dvWeb',`notice-${profile.width}-${skin}`);
        // Calibrate the identical pixel oracle against a genuinely transparent notice.
        if(skin==='nebula'){
          await page.locator('#dvWeb').evaluate(el=>el.style.background='transparent');
          await pixels(page,'#dvWeb',`transparent-negative-${profile.width}`,true);
          await page.locator('#dvWeb').evaluate(el=>el.style.removeProperty('background'));
        }
        results.push({phase:'request',width:profile.width,skin,palette,title,body,material});
      }
      const loaded=page.waitForEvent('load');await page.locator('#dvWeb [data-web=go]').click();await loaded;
      f=page.frameLocator('#wisdom');await f.locator('#wb-req-text').waitFor();assert.equal(await f.locator('#wb-req-text').inputValue(),text);
      await f.locator('#wb-req-text').fill(text+' edited');assert.equal(await page.evaluate(()=>WizAppServices.update.reloadPlan().ok),false);
      const mf=page.frameLocator('#messenger');await page.waitForFunction(()=>document.querySelector('#messenger').contentWindow.fixtureReady===true);
      await mf.locator('body').evaluate(()=>window.audioHold=WizardApp.update.hold('Unsent voice note'));
      await page.waitForFunction(()=>WizAppServices.update.reloadPlan().blocking.some(b=>b.appId==='messenger'&&/voice/i.test(b.reason)));
      const blockers=await page.evaluate(()=>WizAppServices.update.reloadPlan().blocking);
      assert(blockers.some(b=>b.appId==='messenger'&&/voice/i.test(b.reason)),JSON.stringify(blockers));
      assert(!blockers.some(b=>b.appId==='wisdom'&&/voice/i.test(b.reason)));
      await page.waitForFunction(()=>WizWebUpdate.firstObservedVersion);
      await page.evaluate(async()=>{await fetch('/fixture/update');await WizAppUpdates.check();});
      const before=await page.evaluate(()=>performance.timeOrigin);await page.locator('#dvWeb [data-web=go]').click();
      await page.waitForFunction(()=>WizWebUpdate.reloadStatus().reason==='Messenger has a voice note that isn’t sent yet.');
      assert.equal(await page.evaluate(()=>performance.timeOrigin),before);
      assert.equal(await f.locator('#wb-req-text').inputValue(),text+' edited');
      for(const skin of ['nebula','grove']){
        await page.evaluate(s=>{WosSkin.set(s);WizAppearance.sync();},skin);
        await page.waitForFunction(s=>document.querySelector('#wisdom').contentDocument.documentElement.dataset.skin===s,skin);
        await settle(page);
        const title=await assertPaint(page.locator('#dvWeb .dv-um'),'blocked title'),body=await assertPaint(page.locator('#dvWeb .wos-reload-reason'),'blocked body');
        const notice=await page.locator('#dvWeb').innerText();noMojibake(notice);assert(notice.includes('Messenger has a voice note that isn’t sent yet.'));assert(!notice.includes('Wisdom has a voice'));
        assert.equal(await page.locator('button').filter({hasText:/^Reload$/}).count(),1,'only product Reload button');
        await page.screenshot({path:path.join(out,`voice-blocked-${profile.width}-${skin}.png`),animations:'disabled',caret:'hide'});
        await pixels(page,'#dvWeb',`blocked-notice-${profile.width}-${skin}`);
        if(profile.shell==='desktop')await pixels(page,'#dvWeb .wos-reload-detail',`blocked-detail-${profile.width}-${skin}`);
        results.push({phase:'voice-blocked',width:profile.width,skin,title,body,notice,blockers,draftRestored:true,editInvalidatesKeep:true});
      }
      assert.deepEqual(errors,[]);assert.deepEqual(escaped,[]);assert.deepEqual(unknown,[]);await context.close();
    }
    const standalone=await browser.newContext({viewport:{width:412,height:915},colorScheme:'dark'});page=await standalone.newPage();
    await standalone.route('**/*',r=>new URL(r.request().url()).origin===url?r.continue():r.abort());
    await page.goto(url+'/wisdom/');await page.locator('#wb-req-text').waitFor();await settle(page);
    assert.equal(await page.locator('html').getAttribute('data-wz-hosted'),null);
    const fallback=await assertPaint(page.locator('.wb-sheet-card h3'),'standalone title');
    await page.screenshot({path:path.join(out,'request-standalone-dark.png'),animations:'disabled',caret:'hide'});results.push({standaloneDarkFallback:true,fallback});await standalone.close();
    fs.writeFileSync(path.join(out,'browser-result.json'),JSON.stringify({pass:true,fixture:'Synthetic registered-frame host with real core, palette API and instrumented Wisdom request sheet. Not full-shell or physical-device proof.',results,pixelPairs},null,2));
  }catch(e){await page?.screenshot({path:path.join(out,'failure.png'),animations:'disabled',caret:'hide'}).catch(()=>{});fs.writeFileSync(path.join(out,'browser-failure.json'),JSON.stringify({pass:false,error:e.stack,results,pixelPairs},null,2));throw e;}
  finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
