// Fixture preparation only: use real shell navigation, never mutate its windows,
// overlays, animations or event handlers. Measured opens use actionable row input.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { installPaintProbe } from './paint-probe.mjs';

export async function verifyServingBytes(origin,ux,headers={}) {
  const receipts=[];
  for(const path of ['live.js','core/chats.js','app.js','desktop/desktop.js','core/shell.js']) {
    const r=await fetch(`${origin}/wizard-os-home/${path}`,{headers});
    assert.equal(r.status,200,'served source '+path);
    const actual=Buffer.from(await r.arrayBuffer()),expected=readFileSync(join(ux,'web',path));
    assert.ok(actual.equals(expected),'served source must equal its staged Git export: '+path);
    receipts.push({path,sha256:createHash('sha256').update(actual).digest('hex'),bytes:actual.length});
  }
  return receipts;
}

export async function initialize(ctx, skin) {
  await ctx.addInitScript(skin => {
    // Setup is isolated at the disposable Service settings file, not hidden here.
    // Sandboxed app frames can have opaque origins; they do not own shell storage.
    try {
      for (const key of ['wos.coached','wos.tour.v1','wos.tour.done','wos.voiceTipSeen']) localStorage.setItem(key,'true');
      localStorage.setItem('wos.skin',skin);
      localStorage.setItem('wos.skin.composition.v1',JSON.stringify({version:1,extends:skin}));
    } catch (e) { if (e.name !== 'SecurityError') throw e; }
    Object.defineProperty(navigator,'connection',{value:{saveData:true},configurable:true});
    document.addEventListener('pointerdown',e=>{
      const row=e.target.closest('[data-chopen]'),s=window.__speed;
      if(row&&s&&row.closest('[data-win]')?.dataset.win===s.wid)s.start=performance.now();
    },true);
  }, skin);
}

export async function openList(page, origin, shell, agent='hermes') {
  await page.goto(`${origin}/wizard-os-home/${shell==='desktop'?'desktop.html':''}?shell=${shell}`);
  await page.waitForFunction(shell => window.WizLive?.ok && document.documentElement.dataset.shell===shell &&
    (shell==='phone' ? !!window.__wos : !!window.__wux), shell);
  // A fresh context joins the disposable box's workspaces after 300 ms. Wait
  // for that real join BEFORE opening focus/retaining a window id; it may replace
  // the starter window with a previous cell's synced Chats. Never disable sync.
  await page.waitForFunction(()=>window.WosWorkspaceSync?.current?.ok===true);
  const actual=await page.evaluate(()=>({shell:document.documentElement.dataset.shell,selected:window.WIZ_SHELL}));
  assert.deepEqual(actual,{shell,selected:shell},'the requested shell must actually serve this cell');
  const ok=await page.evaluate(async id=>{
    await WosAgents.load(true);
    return await WizOpenAgentChats(id);
  },agent);
  assert.equal(ok,true,`real shell opened agent focus ${agent}`);
  return await page.evaluate(()=>{
    const h=window.__wos||window.__wux;
    const d=window.__wos?h.desks[h.idx]:h.ws[h.cur];
    const w=d.wins.map(id=>h.wins[id]).find(w=>w?.app==='chats'&&!w.agent);
    if(!w)throw Error('No Chats window on current desk');
    return w.id;
  });
}

export function rowFor(page,wid,id) {
  // Desktop can have a list pane (wid::list) and phone retains off-desk DOM.
  // Never pick the first layout-visible row from the entire document.
  return page.locator(`[data-win="${wid}"] [data-chopen="${id}"]:visible`).first();
}
export async function actionable(row) {
  await row.waitFor({state:'visible'});
  await row.scrollIntoViewIfNeeded();
  await row.click({trial:true}); // waits for actual layout/overlay settlement
  const geometry=await row.evaluate(e=>{
    const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;
    return {x,y,width:b.width,height:b.height,inViewport:x>=0&&y>=0&&x<innerWidth&&y<innerHeight,
      hit:e.contains(document.elementFromPoint(x,y)),owner:e.closest('[data-win]')?.dataset.win};
  });
  assert.ok(geometry.inViewport&&geometry.hit,'row is on-screen and owns the input point');
  return geometry;
}
export async function input(row,shell) {
  // Desktop hover warming remains real; phone touchstart warming remains real.
  if(shell==='phone')await row.tap();else await row.click();
}
export async function expandList(page,wid,shell) {
  // Real section paging, before timing. A 600-row fixture is not fully rendered
  // until Show all is used; row 30/400 must not depend on the initial page size.
  // A sync/focus re-render can replace this pane and reset its per-pane paging.
  // Open only fixture-relevant sections using their real buttons, then Show all.
  for(const key of ['ready','working','errors']){
    const toggle=page.locator(`[data-win="${wid}"] [data-sectoggle="${key}"][aria-expanded="false"]:visible`);
    if(await toggle.count()){await actionable(toggle);await input(toggle,shell);}
  }
  for(let n=0;n<10;n++){
    const more=page.locator(`[data-win="${wid}"] [data-secmore]:visible`).first();
    if(!await more.count())return;
    await actionable(more);await input(more,shell);
  }
  assert.equal(await page.locator(`[data-win="${wid}"] [data-secmore]:visible`).count(),0,'bounded real Show all preparation');
}
export async function backToList(page,wid,shell) {
  const pane=page.locator(`[data-win="${wid}"]`);
  const splitList=pane.locator('.dchats .pane-list:visible');
  if(shell==='desktop'&&await splitList.count()){
    // Wide desktop has no Back: its same owned list remains beside the thread.
    // The CSS switches back to the normal Back contract below 620px.
    const geometry=await actionable(splitList.locator('[data-chsearch]'));
    assert.equal(await pane.locator('.pane-main [data-chback]:visible').count(),0,'split desktop Back is intentionally hidden');
    return {contract:'persistent-split-list',geometry};
  }
  const back=pane.locator('[data-chback]:visible').last();
  const geometry=await actionable(back);await input(back,shell);
  await pane.locator('.ch-list:visible').waitFor();
  return {contract:'visible-back',geometry};
}
export async function diagnostics(page) {
  return page.evaluate(()=>{
    const h=window.__wos||window.__wux;
    return {url:location.href,shell:document.documentElement.dataset.shell,selected:window.WIZ_SHELL,
      bodyClass:document.body.className,setup:window.WosSetupLaunch?.log,
      current:window.__wos?h?.idx:h?.cur,sheet:h?.sheet,
      desks:window.__wos?h?.desks:h?.ws,wins:h?.wins,
      rows:[...document.querySelectorAll('[data-chopen]')].slice(0,30).map(e=>{
        const b=e.getBoundingClientRect();return {id:e.dataset.chopen,owner:e.closest('[data-win]')?.dataset.win,x:b.x,y:b.y,width:b.width,height:b.height};
      })};
  });
}

export async function armPaint(page,wid,expected,staleMarker='') {
  await page.evaluate(installPaintProbe,{wid,expected,staleMarker});
}
