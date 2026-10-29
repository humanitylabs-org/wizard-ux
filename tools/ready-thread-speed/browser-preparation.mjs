// Fixture preparation only: use real shell navigation, never mutate its windows,
// overlays, animations or event handlers. Measured opens use actionable row input.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

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
  for(let n=0;n<10;n++){
    const more=page.locator(`[data-win="${wid}"] [data-secmore]:visible`).first();
    if(!await more.count())return;
    await actionable(more);await input(more,shell);
  }
  assert.equal(await page.locator(`[data-win="${wid}"] [data-secmore]:visible`).count(),0,'bounded real Show all preparation');
}
export async function backToList(page,wid,shell) {
  const back=page.locator(`[data-win="${wid}"] [data-chback]:visible`).last();
  await actionable(back);await input(back,shell);
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
  // Observe a real rendered sentinel in the owned window, not a cache, title,
  // hidden/off-desk transcript or arbitrary textContent. A frame gives layout and
  // the browser's paint opportunity before accepting a visible Range.
  await page.evaluate(({wid,expected,staleMarker})=>{
    window.__speed={start:0,expected,wid,first:null,stale:false,staleMarker};
    window.__speedObserver?.disconnect();cancelAnimationFrame(window.__speedFrame||0);
    const check=()=>{
      const s=window.__speed;if(!s.start||s.first!==null)return;
      const root=document.querySelector(`[data-win="${s.wid}"] .ch-msgs`);if(!root)return;
      const answer=[...root.querySelectorAll('.msg.a')].at(-1);if(!answer)return;
      const clip=root.getBoundingClientRect(),walker=document.createTreeWalker(answer,NodeFilter.SHOW_TEXT);
      let node;
      while(node=walker.nextNode()){
        const text=node.textContent||'',at=text.indexOf(s.expected);
        if(s.staleMarker&&text.includes(s.staleMarker))s.stale=true;
        if(at<0)continue;
        const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+s.expected.length);
        for(const r of range.getClientRects()){
          const x=Math.max(0,clip.left,r.left)+1,y=Math.max(0,clip.top,r.top)+1;
          if(x>=Math.min(innerWidth,clip.right,r.right)||y>=Math.min(innerHeight,clip.bottom,r.bottom))continue;
          const style=getComputedStyle(node.parentElement);
          if(style.visibility!=='hidden'&&style.display!=='none'&&root.contains(document.elementFromPoint(x,y))){
            if(s.visibleFrame){s.first=performance.now()-s.start;return;}
            s.visibleFrame=true;return;
          }
        }
      }
    };
    const loop=()=>{check();if(window.__speed.first===null)window.__speedFrame=requestAnimationFrame(loop);};
    window.__speedFrame=requestAnimationFrame(loop);
  },{wid,expected,staleMarker});
}
