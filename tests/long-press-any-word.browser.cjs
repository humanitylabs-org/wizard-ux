/* Browser proof for issue 1708: a long-press on ANY word in a chat message starts a selection, also "a" and "it".
 * Chrome only selects when the press lands on a glyph, so short words (and the space beside them) selected nothing.
 * Real sel-menu.js + the real chats.css selectable rules in Chromium, real CDP touch input (the Android WebView path).
 * Headless Chromium never selects on a long-press by itself, which is exactly the phone's short-word case, so every
 * hold here goes through the shell's fallback. Checks: one- and two-letter words, the gap beside a word, drag to
 * extend (both ways), Chrome's own selection is left alone, and links, text fields, rows, moved presses and mouse
 * holds keep their own behaviour. QA_WEB=<other checkout>/web runs it against another tree (main: QA_EXPECT=broken). */
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const WEB=process.env.QA_WEB?path.resolve(process.env.QA_WEB):path.resolve(__dirname,'..','web');
const BROKEN=process.env.QA_EXPECT==='broken';
const SHOTS=process.env.QA_SHOTS||'';
const links=[...fs.readFileSync(path.join(WEB,'index.html'),'utf8').matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m=>m[1]);
// route: '' (main Wizard thread) or a routed agent thread (host-profile, container, restricted): same message markup,
// renderThread only adds `.agent` and the agent colour.
const PAGE=(skin,route)=>`<!doctype html><html data-shell="phone" data-layout="ai-apps" data-skin="${skin}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${links.map(h=>`<link rel="stylesheet" href="/${h}">`).join('\n')}
<link rel="stylesheet" href="/layouts/ai-apps/layout.css">
<style>body{touch-action:auto;background:var(--wz-base,#111)}.ch-thread{padding-top:90px}.row{padding:14px;margin:12px 16px;border-radius:12px;background:var(--wz-surface,#222)}textarea{margin:12px 16px;width:80%;font:16px system-ui}</style>
<script>window.__tell=[];window.WizardOSNative={selection:s=>window.__tell.push(s)};window.__wos={toast(){}};</script>
<script src="/core/sel-menu.js"></script><script>document.addEventListener('click',e=>{if(e.target.closest('a'))e.preventDefault();});
// Stand-in for core/thread-swipe-back.js: it listens for touchmove on the Chats root and slides the thread on a drag right.
window.__swipeMoves=0;addEventListener('DOMContentLoaded',()=>document.querySelector('[data-chats]').addEventListener('touchmove',()=>window.__swipeMoves++,{passive:true}));</script></head><body>
<div data-chats="w1"><div data-part="thread" class="ch-thread${route?' agent':''}"${route?` data-route="${route}" style="--agc:#7aa2ff"`:''}><div class="ch-msgs">
<div class="msg a"><div class="bub md-doc" id="m1"><p>So it is a test of selection behaviour today.</p></div></div>
<div class="msg u"><div class="bub" id="m2">Read <a href="https://example.com/x" id="ln">this link</a> to me.</div></div>
<div class="row" id="row">A thread row with a title</div>
<textarea id="ta">a text field</textarea>
</div></div></div>
</body></html>`;
const ROUTES=['host-profile','container','restricted'];
const MIME={'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://x'),p=u.pathname;
  if(p==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(PAGE(u.searchParams.get('skin')==='grove'?'grove':'nebula',ROUTES.find(r=>r===u.searchParams.get('route'))||''));}
  const file=path.join(WEB,p);
  if(file.startsWith(WEB+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',MIME[path.extname(file)]||'application/octet-stream');return res.end(fs.readFileSync(file));}
  res.statusCode=404;res.end();
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const results=[];
  try{
  for(const [skin,route] of [['nebula',''],['grove',''],['nebula','host-profile'],['grove','container'],['nebula','restricted']]){
    const tag=`${skin} ${route||'main'}: `;
    const check=(cond,name,extra)=>{results.push([!!cond,tag+name,extra]);};
    const page=await browser.newPage({viewport:{width:412,height:892},isMobile:true,hasTouch:true,deviceScaleFactor:2});
    const errs=[];page.on('pageerror',e=>errs.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?skin=${skin}&route=${route}`);await page.waitForLoadState('networkidle');await page.waitForFunction(()=>window.WosSelMenu);
    const cdp=await page.context().newCDPSession(page);
    const sel=()=>page.evaluate(()=>String(getSelection()));
    const reset=()=>page.evaluate(()=>{getSelection().removeAllRanges();});
    // Centre (or an edge) of a word inside an element's text, in viewport px.
    const wordBox=(id,word,nth=0)=>page.evaluate(([id,word,nth])=>{const el=document.getElementById(id);const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
      for(let n;(n=w.nextNode());){let i=-1,k=0;const re=new RegExp('(^|[^\\p{L}])('+word+')(?![\\p{L}])','gu');let m;while((m=re.exec(n.data))){if(k++===nth){i=m.index+m[1].length;break;}}
        if(i>=0){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+word.length);const q=r.getBoundingClientRect();return {l:q.left,r:q.right,t:q.top,b:q.bottom,x:q.left+q.width/2,y:q.top+q.height/2};}}
      return null;},[id,word,nth]);
    const elBox=id=>page.evaluate(id=>{const q=document.getElementById(id).getBoundingClientRect();return {x:q.left+q.width/2,y:q.top+q.height/2};},id);
    const touch=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map(p=>({x:p.x,y:p.y,id:1}))});
    const hold=async(pt,{ms=900,moves=[],during}={})=>{
      await touch('touchStart',[pt]);
      if(during){await page.waitForTimeout(250);await during();await page.waitForTimeout(ms-250);}else await page.waitForTimeout(ms);
      for(const m of moves){await touch('touchMove',[m]);await page.waitForTimeout(120);}
      const held=await sel();
      await touch('touchEnd',[]);await page.waitForTimeout(450);
      return held;
    };
    const menu=()=>page.evaluate(()=>WosSelMenu.state);

    // 1-2: one- and two-letter words.
    await reset();let pt=await wordBox('m1','a');let held=await hold(pt);
    check(held==='a','long-press on "a" selects "a" while the finger is still down',held);
    if(SHOTS&&!route){fs.mkdirSync(SHOTS,{recursive:true});await page.evaluate(()=>getSelection().removeAllRanges());await touch('touchStart',[pt]);await page.waitForTimeout(900);await touch('touchEnd',[]);await page.waitForTimeout(500);await page.screenshot({path:path.join(SHOTS,`long-press-a-${BROKEN?'before':'after'}-${skin}.png`)});}
    let s=await sel(),m=await menu();
    check(s==='a'&&m.open&&m.text==='a','after lift "a" stays selected and the own menu shows',{s,m});
    await reset();held=await hold(await wordBox('m1','it'));
    check(held==='it'&&(await sel())==='it','long-press on "it" selects "it"',held);
    // 3: the space right after a short word snaps to the nearest word on that line.
    await reset();const a=await wordBox('m1','a'),nx=await wordBox('m1','test');
    held=await hold({x:a.r+(nx.l-a.r)*0.3,y:a.y});
    check(held==='a','a press on the gap right after "a" selects "a"',held);
    await reset();held=await hold({x:a.r+(nx.l-a.r)*0.8,y:a.y});
    check(held==='test','a press on the gap nearer "test" selects "test"',held);
    // 4: hold then drag extends word by word, forwards and backwards.
    await reset();const so=await wordBox('m1','So'),sl=await wordBox('m1','selection');
    held=await hold(so,{moves:[{x:so.x+30,y:so.y},{x:sl.x-10,y:sl.y},{x:sl.x,y:sl.y}]});
    check(held==='So it is a test of selection','hold on "So" then drag to "selection" selects "So it is a test of selection"',held);
    check((await menu()).open&&(await sel())==='So it is a test of selection','the dragged selection stays after lift with the own menu',await menu());
    // A drag right along the same line stays the selection's: the page gestures below (thread swipe-back) never see it.
    await reset();const it=await wordBox('m1','it'),te=await wordBox('m1','test');await page.evaluate(()=>{window.__swipeMoves=0;});
    held=await hold(it,{moves:[{x:it.x+12,y:it.y},{x:(it.x+te.x)/2,y:it.y},{x:te.x,y:te.y}]});
    const sm=await page.evaluate(()=>window.__swipeMoves);
    check(held==='it is a test'&&(await sel())==='it is a test'&&sm===0,'hold on "it" then drag right along the line to "test" selects "it is a test" and no swipe gesture sees the drag',{held,sm});
    await reset();const of=await wordBox('m1','of'),is=await wordBox('m1','is');
    held=await hold(of,{moves:[{x:of.x-20,y:of.y},{x:is.x,y:is.y}]});
    check(held==='is a test of','drag backwards from "of" to "is" selects "is a test of"',held);
    // 5: Chrome's own selection (it arrives during the hold, here on the long word under the finger) is left untouched.
    await reset();held=await hold(await wordBox('m1','selection'),{during:()=>page.evaluate(()=>{const t=document.getElementById('m1').querySelector('p').firstChild,i=t.data.indexOf('selection'),r=document.createRange();r.setStart(t,i);r.setEnd(t,i+9);getSelection().removeAllRanges();getSelection().addRange(r);})});
    check(held==='selection'&&(await sel())==='selection','a selection Chrome already started is left alone',held);
    // 6: links, rows, text fields, a press that moves (a scroll) and a mouse hold keep their own behaviour.
    await reset();held=await hold(await wordBox('m2','link'));
    check(held===''&&(await sel())==='','long-press on a link selects nothing (the link menu owns it)',held);
    await reset();held=await hold(await elBox('row'));
    check(held==='','long-press on a thread row selects nothing (the row sheet owns it)',held);
    await reset();await page.evaluate(()=>{const t=document.getElementById('ta');t.setSelectionRange(0,0);});held=await hold(await elBox('ta'));
    const ta=await page.evaluate(()=>{const t=document.getElementById('ta');return [t.selectionStart,t.selectionEnd,String(getSelection())];});
    check(ta[0]===ta[1]&&ta[2]==='','long-press in a text field leaves it to Android (no page selection made)',ta);
    await reset();pt=await wordBox('m1','a');await touch('touchStart',[pt]);await page.waitForTimeout(100);await touch('touchMove',[{x:pt.x,y:pt.y+30}]);await page.waitForTimeout(800);
    s=await sel();await touch('touchEnd',[]);await page.waitForTimeout(300);
    check(s===''&&(await sel())==='','a press that moves before the hold (a scroll) selects nothing',s);
    await reset();await page.mouse.move(pt.x,pt.y);await page.mouse.down();await page.waitForTimeout(900);s=await sel();await page.mouse.up();
    check(s==='','a mouse hold is left to the browser',s);
    check(errs.length===0,'no page errors',errs);
    await page.close();
  }
  }finally{await browser.close();server.close();}
  for(const [ok,name,extra] of results) console.log(ok?'PASS':'FAIL',name,ok?'':JSON.stringify(extra));
  const failed=results.filter(r=>!r[0]).map(r=>r[1]);
  if(BROKEN){
    // Main: the short-word checks must fail (the bug), the leave-alone checks still pass.
    assert.ok(failed.some(n=>/"a" selects "a"/.test(n)),'expected the short-word bug on this tree');
    console.log('baseline reproduces the bug: '+failed.length+' check(s) fail');
  }else{
    assert.deepEqual(failed,[],'all checks pass');
    console.log('pass: long-press selects any word, snaps from gaps, drags to extend, and leaves links, rows, fields and Chrome alone');
  }
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
