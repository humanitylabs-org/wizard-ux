// Shared real phone/desktop Chats and IndexedDB, isolated synthetic inputs only.
const path = require('path');
module.exports = async ({boot, ok, sleep, sid, model, provider, out}) => {
  for (const desktop of [false, true]) for (const skin of ['nebula', 'signal']) {
    const f = await boot(desktop), p = f.p, label = `${desktop ? 'desktop' : 'phone'}-${skin}`;
    try {
      await p.evaluate(skin => { localStorage.setItem('wos.skin', skin); window.WosSkin?.set(skin); }, skin);
      const ids = await p.evaluate(async ({sid,model,provider}) => {
        const add = async text => { const it = await WosOutbox.stage({kind:'reply',sessionId:sid,text,model,provider}); await WosOutbox.transition(it.id,'failed','No confirmed model route · choose a model before retrying'); return it.id; };
        return { target: await add('Switch'), other: await add('Keep this other message') };
      }, {sid,model,provider});
      const target = p.locator(`[data-obdismissfailed="${ids.target}"]`).first();
      await target.waitFor({state:'visible'});
      await target.scrollIntoViewIfNeeded(); await sleep(350);
      const box = await target.boundingBox();
      ok(box && box.width >= 40 && box.height >= 24, label+': Dismiss is visible and tappable',box);
      await p.screenshot({path:path.join(out,label+'-before.png')});
      const before = f.state.posts.length;
      await target.click();
      await p.waitForFunction(id=>WosOutbox.get(id)?.threadHidden===true,ids.target);
      ok(await p.locator(`[data-obdismissfailed="${ids.target}"]`).count()===0,label+': selected failed bubble disappears');
      ok(await p.locator(`[data-obdismissfailed="${ids.other}"]`).count()===1,label+': other failed message stays');
      ok(await p.evaluate(()=>document.body.innerText.includes('Hello')&&document.body.innerText.includes('Ready')),label+': accepted conversation stays');
      await p.reload();
      await p.waitForFunction(()=>window.WosOutbox?.recoveryComplete && !!(window.__wos||window.__wux)?.chats);
      await p.evaluate(sid=>{const A=window.__wos||window.__wux;const w=A.openWin?A.openWin({app:'chats'}):null;const id=w?.id||Object.keys(A.wins).find(k=>A.wins[k].app==='chats');A.chats.openChat(id,sid);A.focusWin?.(id);},sid);
      await p.locator(`[data-obdismissfailed="${ids.other}"]`).first().waitFor({state:'visible'});
      ok(await p.locator(`[data-obdismissfailed="${ids.target}"]`).count()===0,label+': dismissed message stays gone after reload');
      ok(await p.evaluate(id=>{const it=WosOutbox.get(id);return it?.text==='Switch'&&it.cancelled&&!WosOutbox.canRetry(it);},ids.target),label+': original retained and cannot retry');
      ok(f.state.posts.length===before,label+': dismissal and reload admit no turn');
      await p.locator(`[data-obdismissfailed="${ids.other}"]`).first().click();
      await p.waitForFunction(id=>WosOutbox.get(id)?.threadHidden,ids.other);
      await sleep(350); await p.screenshot({path:path.join(out,label+'-after.png')});
      // The single-item list pill has the same action, including nonretryable failures.
      const pillId=await p.evaluate(async({sid,model,provider})=>{const x=await WosOutbox.stage({kind:'reply',sessionId:sid,text:'Dismiss from list',model,provider});await WosOutbox.transition(x.id,'failed','No confirmed model route');return x.id;},{sid,model,provider});
      await p.evaluate(()=>{const A=window.__wos||window.__wux;const w=A.openWin?A.openWin({app:'chats'}):null;if(!w){const id=Object.keys(A.wins).find(k=>A.wins[k].app==='chats');A.chats.openChat(id,'');}});
      const pill=p.locator(`.ch-pill [data-obdismissfailed="${pillId}"]`).first();
      await pill.waitFor({state:'visible'});await pill.click();
      await p.waitForFunction(id=>WosOutbox.get(id)?.threadHidden,pillId);
      ok(await p.locator('.ch-pill:not(.sent)').count()===0,label+': last failed-send pill clears');
    } finally { await f.done(label); }
  }
};
