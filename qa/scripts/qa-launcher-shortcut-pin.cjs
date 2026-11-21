// Shared real-shell QA, synthetic APIs only. Trusted Playwright input; no live writes.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
module.exports=async({boot,ok,sleep,sid,out})=>{
 const model='gpt-6.1-sol',provider='openai-codex';
 for(const desktop of [true,false])for(const skin of ['nebula','signal']){
  const label=`${desktop?'desktop':'phone'}-${skin}`;
  const fixture={orb:true,layout:desktop?'ai-apps':'classic',skin:'nebula',sessions:[{id:sid,title:'Synthetic launcher QA',source:'wizard-mobile',model,provider,status:'completed',message_count:2,messages:[{role:'user',content:'Synthetic fixture'},{role:'assistant',content:'Ready'}]}],agents:[{id:'hermes',label:'Wizard',is_default:true,status:'running',model:{model,provider}}],modelOptions:{model,provider,providers:[{slug:provider,authenticated:true,is_current:true,models:[model]}]},apps:[{id:'video-editor',name:'Video Editor',url:'/fixture-capture/',source:'launcher.json',icon:'🎬'},{id:'mail',name:'Mail',url:'/fixture-mail/',source:'apps.json'}]};
  const f=await boot(desktop,false,null,fixture),p=f.p;
  const record=(v,n,d)=>{ok(v,`${label}: ${n}`,d);assert.ok(v,n);};
  try{
   await p.evaluate(s=>WosSkin.set(s),skin);await p.waitForFunction(s=>WosSkin.current===s,skin);
   if(desktop){
    await p.waitForSelector('.aad-vall');
    // Open once through the real shell adapter, then all interactions use actual UI/input.
    await p.locator('.aad-vall').click();await p.locator('.vc-q').fill('Video Editor');await p.locator('.vc-app[data-app="video-editor"]').click();
    await p.waitForSelector('.aad-vtab[data-app="video-editor"]');
    const count=()=>p.evaluate(()=>Object.values(__wux.wins).filter(w=>w.appId==='video-editor').length);
    const initial=await count();
    const search=p.locator('.vc-q');
    await p.keyboard.down('AltLeft');await sleep(350);await p.keyboard.down('Space');await p.keyboard.down('Space');await p.keyboard.up('Space');await p.keyboard.up('AltLeft');
    await search.waitFor({state:'visible'});
    record(await p.evaluate(()=>document.querySelectorAll('.vc-sheet').length===1&&__launcherMediaStarts===0&&__wux.voiceState==='idle'),'left Option hold + Space/repeat/release opens one picker and zero capture');
    await search.fill('Video Editor');
    const hit=p.locator('.vc-app[data-app="video-editor"]');await hit.waitFor();
    await p.screenshot({path:path.join(out,`${label}-search.png`),animations:'disabled'});
    await hit.click();await p.waitForSelector('.vc-sheet',{state:'detached'});
    record(await count()===initial,'search includes already-open launcher link and selecting reuses its existing window');
    let tab=p.locator('.aad-vtab[data-app="video-editor"]');await tab.click({button:'right'});
    await p.locator('.aad-appmenu [data-act="pin"]').click();
    record(await tab.getAttribute('data-group')==='pin','Pin paints immediately on the existing row');
    const pinKey=await p.evaluate(()=>Object.keys(localStorage).find(k=>k.endsWith('.pins')&&JSON.parse(localStorage[k])?.includes?.('video-editor')));
    record(!!pinKey,'Pin persisted to the existing layout store',pinKey);
    await p.reload();await p.waitForSelector('.aad-vtab[data-app="video-editor"][data-group="pin"]');
    record(await p.evaluate(k=>JSON.parse(localStorage[k]).includes('video-editor'),pinKey),'Pin survives reload with launcher catalog classification');
    tab=p.locator('.aad-vtab[data-app="video-editor"]');await tab.click({button:'right'});
    record(await p.locator('.aad-appmenu [data-act="unpin"] svg').count()===1,'Unpin menu keeps its correct glyph');
    await p.screenshot({path:path.join(out,`${label}-pin.png`),animations:'disabled'});
    await p.locator('.aad-appmenu [data-act="unpin"]').click();
    record(await tab.getAttribute('data-group')==='open'&&await p.evaluate(k=>!JSON.parse(localStorage[k]).includes('video-editor'),pinKey),'Unpin paints and persists through the same store');
    // Field path: keydown in real composer. The modifier release never records.
    await p.locator('.aad-wsn').click();await p.locator('.ch-compose textarea:visible').first().focus();
    await p.keyboard.down('AltLeft');await p.keyboard.press('Space');await p.keyboard.up('AltLeft');await search.waitFor();
    record(await p.evaluate(()=>__launcherMediaStarts===0),'focused-field left Option Space does not capture');
    await p.keyboard.press('Escape');
    // Same-origin frame Window capture path, before app Document listeners.
    await p.locator('.aad-vall').click();await p.locator('.vc-q').fill('Video Editor');await p.locator('.vc-app[data-app="video-editor"]').click();
    const frame=p.frames().find(f=>f.url().includes('/fixture-capture'));
    assert.ok(frame,'real embedded app frame');await frame.locator('body').click();
    await p.keyboard.down('AltLeft');await p.keyboard.press('Space');await p.keyboard.up('AltLeft');await search.waitFor();
    record(await p.evaluate(()=>__launcherMediaStarts===0&&document.querySelectorAll('.vc-sheet').length===1),'same-origin iframe left Option Space dispatches once with zero capture');
    await p.keyboard.press('Escape');
    // Negative chord: Shift/Control must not be reinterpreted as the new shortcut.
    await p.keyboard.down('Control');await p.keyboard.down('AltLeft');await p.keyboard.press('Space');await p.keyboard.up('AltLeft');await p.keyboard.up('Control');
    record(await p.locator('.vc-sheet').count()===0&&await p.evaluate(()=>__launcherMediaStarts===0),'Control chord remains outside left Option Space');
    await p.screenshot({path:path.join(out,`${label}-after.png`),animations:'disabled'});
   }else{
    await p.screenshot({path:path.join(out,`${label}-after.png`),animations:'disabled'});
    record(await p.evaluate(s=>WosSkin.current===s&&document.documentElement.dataset.shell==='phone',skin),'phone keeps its chosen skin and existing shell');
   }
  }catch(e){await p.screenshot({path:path.join(out,`${label}-failure.png`)}).catch(()=>{});fs.writeFileSync(path.join(out,`${label}-failure.json`),JSON.stringify({error:String(e),errors:f.state.errors,html:await p.locator('html').getAttribute('data-layout')},null,2));throw e;}
  finally{await f.done(label+' launcher fixture');}
 }
};
