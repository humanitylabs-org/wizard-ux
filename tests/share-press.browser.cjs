/* Browser proof for the shared Share hold gesture (WosChat.bindSharePress, bound once on document).
 * Real chat-kit.js + sel-menu.js in Chromium, real mouse and touch input (CDP touch = Android WebView path).
 * Agent chat parity: the same reply Share control in a main thread and in host-profile, container and restricted
 * routed threads; plus the selection-menu Share on touch (one action, no double fire from pointerup or click).
 * Fixture replies + a click delegate shaped like chats.js's [data-mshare] handler; no owner data, no network. */
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const KINDS=['main','host-profile','container','restricted'];
const PAGE=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;font:16px system-ui}.msg{padding:12px}button{min-width:88px;min-height:44px}.selmenu{position:fixed;left:0;top:0;display:flex;gap:4px}.selmenu[hidden]{display:none}</style>
<script>window.__native=[];window.__sheet=[];
window.WizardOSNative={shareText:(t,title)=>{window.__native.push(t);return 'shared';}};
window.WosShareSheet={show:(p)=>{window.__sheet.push(p.text);return Promise.resolve('cancelled');}};
window.__wos={toast(){}};</script>
<script src="/core/chat-kit.js"></script><script src="/core/sel-menu.js"></script></head><body>
${KINDS.map(k=>`<section data-chats data-agent="${k}"><div class="ch-thread"><div class="msg a"><div class="bub" id="t-${k}">Reply from the ${k} agent</div><div class="mmeta"><button type="button" data-mshare="0" data-kind="${k}" aria-label="Share response">Share</button></div></div></div></section>`).join('')}
<script>document.addEventListener('click',e=>{const ms=e.target.closest('[data-mshare]');if(ms)WosChat.shareAssistantText(document.getElementById('t-'+ms.dataset.kind).textContent);});</script>
</body></html>`;
const server=http.createServer((req,res)=>{
  const p=new URL(req.url,'http://x').pathname;
  if(p==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(PAGE);}
  const file=path.join(root,'web',p);
  if(file.startsWith(path.join(root,'web')+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/css');return res.end(fs.readFileSync(file));}
  res.statusCode=404;res.end();
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:412,height:892},isMobile:true,hasTouch:true});
    const errs=[];page.on('pageerror',e=>errs.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.WosChat?.bindSharePress);
    const cdp=await page.context().newCDPSession(page);
    const counts=()=>page.evaluate(()=>[window.__native.length,window.__sheet.length]);
    const centre=async loc=>{await loc.scrollIntoViewIfNeeded();const b=await loc.boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
    const touchHold=async loc=>{const {x,y}=await centre(loc);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await page.waitForTimeout(650);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(400);};
    const mouseHold=async loc=>{const {x,y}=await centre(loc);await page.mouse.move(x,y);await page.mouse.down();await page.waitForTimeout(650);await page.mouse.up();await page.waitForTimeout(300);};
    for(const k of KINDS){
      const btn=page.locator(`[data-mshare][data-kind="${k}"]`);
      let [n,s]=await counts();
      await mouseHold(btn);
      assert.deepEqual(await counts(),[n+1,s],`${k}: mouse hold → system share once, no Wizard sheet`);
      assert.match(await page.evaluate(()=>window.__native.at(-1)),new RegExp(`Reply from the ${k} agent$`));
      await touchHold(btn);
      assert.deepEqual(await counts(),[n+2,s],`${k}: touch hold → system share once, release click swallowed`);
      await btn.click();await page.waitForTimeout(100);
      assert.deepEqual(await counts(),[n+2,s+1],`${k}: tap → Wizard sheet`);
    }
    // Selection-menu Share: a touch hold runs it once (sel-menu's own release handler steps aside), a tap runs it once.
    const select=async k=>{await page.evaluate(k=>{const t=document.getElementById('t-'+k).firstChild,r=document.createRange();r.setStart(t,0);r.setEnd(t,5);const s=getSelection();s.removeAllRanges();s.addRange(r);},k);
      await page.locator('.selmenu:not([hidden]) [data-sm="share"]').waitFor({timeout:5000});};
    await select('main');let [n,s]=await counts();
    await touchHold(page.locator('.selmenu [data-sm="share"]'));
    assert.deepEqual(await counts(),[n+1,s],'selection menu: touch hold → system share exactly once');
    await select('restricted');[n,s]=await counts();
    const {x,y}=await centre(page.locator('.selmenu [data-sm="share"]'));await page.touchscreen.tap(x,y);await page.waitForTimeout(400);
    assert.deepEqual(await counts(),[n,s+1],'selection menu: tap → Wizard sheet exactly once');
    assert.deepEqual(errs,[]);
    console.log(`pass: Share hold/tap parity across ${KINDS.join(', ')} threads (mouse + touch); selection-menu Share fires once on hold and on tap`);
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
