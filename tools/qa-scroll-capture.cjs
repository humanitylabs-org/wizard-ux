// Isolated real-shell browser contract tests; no request is ever continued/fetched.
// QA_PLAYWRIGHT=/external/path/playwright QA_CHROME=/path/to/chrome node tools/qa-scroll-capture.cjs
// QA_ROOT selects a source checkout (also permits baseline comparison); QA_OUT stores JSON evidence.
const fs = require('fs'), path = require('path');
const { chromium } = require('./qa-playwright.cjs');
const ROOT = path.resolve(process.env.QA_ROOT || path.join(__dirname, '..'));
const OUT = path.resolve(process.env.QA_OUT || 'qa-scroll-capture-results');
const helper = fs.readFileSync(path.join(ROOT, 'android/app/src/main/assets/scroll-capture.js'), 'utf8');
fs.mkdirSync(OUT, { recursive: true });
const results = [], writes = [], errors = [];
const now = Date.now() / 1000;
const sessions = Array.from({length: 36}, (_, i) => ({ id: 'qa_sc_' + i, title: 'Capture fixture ' + i, agent: 'hermes', runtime: 'hermes', source: 'wizard-mobile', status: 'completed', message_count: 2, started_at: now-600, last_active: now-i, wizard_last_user_at: now-300, wizard_last_assistant_at: now-i, wizard_activity_at: now-i, latest_message: {role:'assistant', content:'Fixture answer', timestamp:now-i}, last_user_message:{role:'user',content:'Fixture ask',timestamp:now-300} }));
const messages = id => [{id:1,session_id:id,role:'user',content:'Fixture question',timestamp:now-300},{id:2,session_id:id,role:'assistant',content:Array.from({length:70},(_,i)=>`Paragraph ${i}: synthetic ${id} content for scroll-capture lifecycle verification.`).join('\n\n'),timestamp:now-100}];
function ok(mode, name, value, detail) { const row={mode,name,pass:!!value,detail}; results.push(row); console.log(value?'PASS':'FAIL',mode,name,detail===undefined?'':JSON.stringify(detail)); }
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.QA_CHROME || undefined});
 try { for(const enabled of [false,true]) {
  const mode=enabled?'helper-on':'helper-off';
  const ctx=await browser.newContext({viewport:{width:412,height:892},deviceScaleFactor:2.625,isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await ctx.route('**/*',async r=>{
   const q=r.request(),u=new URL(q.url()),p=u.pathname;
   const json=x=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
   if(!['GET','HEAD'].includes(q.method())) { writes.push({method:q.method(),path:p}); return json(p==='/wizard/thread-seen'?{state:{initializedAt:Date.now(),threads:{}}}:{ok:true}); }
   if(p.startsWith('/wizard-os-home/')) {
    const rel=decodeURIComponent(p.slice('/wizard-os-home/'.length))||'index.html';
    const file=path.resolve(ROOT,'web',rel);
    if(file.startsWith(path.join(ROOT,'web')+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()) return r.fulfill({status:200,contentType:({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
    if(rel==='data.js')return r.fulfill({contentType:'application/javascript',body:'window.DATA = {};'});
    if(rel==='summaries.js')return r.fulfill({contentType:'application/javascript',body:'window.SUMMARIES = {};'});
   }
   if(p==='/wizard/v1/bootstrap')return json({bootstrap:1,settings:{agent:{name:'QA Agent'}},capabilities:{voice:true,files:true,router:true},endpoints:{sessions:'/wizard/hermes/api/sessions',runs:'/wizard/hermes/v1/runs',transcribe:'/wizard/voice/transcribe',route:'/wizard/v1/route',upload:'/wizard/files/upload'}});
   if(p==='/wizard/hermes/api/sessions')return json({data:sessions,has_more:false});
   if(/\/messages$/.test(p))return json({data:messages(p.split('/').at(-2)),has_more:false});
   if(/\/api\/sessions\/qa_sc_\d+$/.test(p))return json({session:sessions.find(s=>s.id===p.split('/').at(-1))});
   if(p==='/wizard/thread-seen')return json({state:{initializedAt:Date.now(),threads:{}}});
   if(p.endsWith('/model/options'))return json({model:'qa-model',provider:'qa-provider',providers:[{slug:'qa-provider',name:'QA',authenticated:true,is_current:true,models:['qa-model']}]});
   return json({}); // All unknown reads stay synthetic too. No real backend or origin required.
  });
  const p=await ctx.newPage();p.setDefaultTimeout(7000);p.on('pageerror',e=>errors.push({mode,error:String(e)}));
  await p.addInitScript(()=>{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.voiceTipSeen','true');});
  await p.goto('http://scroll-capture.invalid/wizard-os-home/');
  await p.waitForFunction(()=>window.__wos?.live?.session('qa_sc_0'));
  await p.evaluate(()=>__wos.goDesk(1));await p.waitForTimeout(700);
  if(enabled) {
   await p.evaluate(()=>{window.qaMetrics=[];window.wizardScrollPort={postMessage(raw){qaMetrics.push({at:performance.now(),...JSON.parse(raw)});}};});
   await p.evaluate(helper);
  }
  await p.evaluate(()=>{window.qaOwner=()=>{const w=Object.values(__wos.wins).find(w=>w.app==='chats');return {w,el:document.querySelector(`[data-chats="${w.id}"]`)};};window.qaScroller=()=>qaOwner().el.querySelector('.ch-msgs,.ch-scroll');});
  const open=async id=>{await p.evaluate(id=>__wos.openWizardThread(id),id);await p.waitForFunction(id=>qaOwner().w.thread===id&&qaOwner().el.querySelector('.ch-msgs .msg.a'),id);await p.waitForTimeout(400);await p.evaluate(()=>qaScroller().dispatchEvent(new Event('wheel',{bubbles:true})));await p.waitForTimeout(400);};
  const begin=async id=>p.evaluate(id=>{const e=qaScroller();e.scrollTop=160;window.qaOld=e;window.qaSaved=e.scrollTop;const b=__wosScrollCapture.search();return {search:b,start:__wosScrollCapture.start(id)};},id);
  const paint=async()=>p.evaluate(()=>{const {w,el}=qaOwner();w.thread?__wos.chats.renderThread(w,el):__wos.chats.renderChatList(w,el);});
  try {
   ok(mode,'synthetic session list in actual Wizard UI',await p.locator('[data-chopen="qa_sc_0"]').count()>0);
   if(enabled){
    await p.waitForTimeout(250);
    ok(mode,'retired proxy emits no port messages',await p.evaluate(()=>qaMetrics.length===0));
    ok(mode,'retired proxy refuses every scroll command without moving content',await p.evaluate(()=>{
      const e=qaScroller(),top=e.scrollTop;
      return ['', 'forged', undefined].every(key=>!__wosScrollCapture.proxyScroll(key,'to',900))&&e.scrollTop===top;
    }));
    await p.evaluate(()=>{__wosScrollCapture.refreshProxy();__wosScrollCapture.resumeProxy();});
    await p.waitForTimeout(250);
    ok(mode,'resume and refresh cannot reactivate proxy',await p.evaluate(()=>qaMetrics.length===0));
    const b=await begin('list');
    if(!b.start)b.diagnostic=await p.evaluate(()=>{const e=qaScroller(),r=e.getBoundingClientRect();return {rect:r.toJSON(),vh:innerHeight,vw:innerWidth,height:e.scrollHeight,client:e.clientHeight,parents:(()=>{let n=e,a=[];while(n){const s=getComputedStyle(n);a.push({cls:n.className,transform:s.transform,scale:s.scale,rotate:s.rotate,perspective:s.perspective,zoom:s.zoom});n=n.parentElement;}return a;})(),hits:[.1,.5,.9].flatMap(x=>[.1,.5,.9].map(y=>{const h=document.elementFromPoint(r.left+r.width*x,r.top+r.height*y);return {x,y,hit:h?.outerHTML.slice(0,200),inside:e.contains(h),dock:h?.closest('.ch-fab,.ch-pill,.ch-latest')?.className};}))};});
    ok(mode,'visible overflowing list discovered',!!b.start,b);
    await p.evaluate(()=>__wosScrollCapture.move('list',420));await paint();
    ok(mode,'same-list repaint held',await p.evaluate(()=>qaScroller()===qaOld&&!!__wosScrollCapture.check('list')));
    await p.evaluate(()=>__wosScrollCapture.end('list'));await p.waitForTimeout(500); // shell scroll-idle guard is 350ms
    ok(mode,'list hold flushed and reading position restored',await p.evaluate(()=>qaScroller()!==qaOld&&Math.abs(qaScroller().scrollTop-qaSaved)<2));
    // Real phone layout puts the new-chat button over a sampled corner of the list.
    const dock=await p.evaluate(()=>{const {el}=qaOwner(),f=el.querySelector('.ch-fab'),e=qaScroller(),r=e.getBoundingClientRect();
     Object.assign(f.style,{position:'absolute',left:'0',top:'0',right:'auto',bottom:'auto',pointerEvents:'auto',zIndex:'99999',transform:'none'});
     const fr=f.getBoundingClientRect();f.style.left=(r.left+r.width*.9-fr.left-27)+'px';f.style.top=(r.top+r.height*.9-fr.top-27)+'px';
     const covered=!e.contains(document.elementFromPoint(r.left+r.width*.9,r.top+r.height*.9));
     const found=!!__wosScrollCapture.search(),started=!!__wosScrollCapture.start('dock'),hidden=getComputedStyle(f).visibility==='hidden';
     const ended=__wosScrollCapture.end('dock'),restored=getComputedStyle(f).visibility==='visible'&&!f.style.visibility;
     Object.assign(f.style,{position:'',left:'',top:'',right:'',bottom:'',pointerEvents:'',zIndex:'',transform:''});return {covered,found,started,hidden,ended,restored};});
    ok(mode,'floating new-chat button over list: discovered, hidden while capturing, restored',dock.covered&&dock.found&&dock.started&&dock.hidden&&dock.ended&&dock.restored,dock);
    const voice=await p.evaluate(()=>{const g=document.querySelector('#generalVoice.general-voice'),old=g.getAttribute('style'),e=qaScroller(),r=e.getBoundingClientRect();
      g.style.cssText=`position:fixed;left:${r.left+r.width*.5-50}px;top:${r.top+r.height*.5-20}px;width:100px;height:40px;visibility:visible!important;display:block!important;pointer-events:auto!important;transform:none!important;z-index:99999;`;
      const covered=g.contains(document.elementFromPoint(r.left+r.width*.5,r.top+r.height*.5)),found=!!__wosScrollCapture.search(),started=!!__wosScrollCapture.start('voice-label'),hidden=getComputedStyle(g).visibility==='hidden';
      const ended=__wosScrollCapture.end('voice-label'),restored=g.style.getPropertyValue('visibility')==='visible'&&g.style.getPropertyPriority('visibility')==='important';
      old===null?g.removeAttribute('style'):g.setAttribute('style',old);return {covered,found,started,hidden,ended,restored};});
    ok(mode,'shell voice label excluded from captured tiles and exact visibility restored',Object.values(voice).every(Boolean),voice);
   }
   await open('qa_sc_0');
   ok(mode,'normal scrolling works',await p.evaluate(()=>{let e=qaScroller();e.scrollTop=220;return e.scrollTop===220;}));
   if(enabled){
    let b=await begin('thread');ok(mode,'visible thread discovered',!!b.start,b);
    await p.evaluate(()=>{__wosScrollCapture.move('thread',600);const c=__wos.chats.ch(qaOwner().w.id);window.qaTurns=c.turns;window.qaShape=JSON.stringify(c.turns[0]);});
    await paint();ok(mode,'same-thread repaint held during acquisition',await p.evaluate(()=>qaScroller()===qaOld&&!!__wosScrollCapture.check('thread')));
    await p.evaluate(()=>__wosScrollCapture.end('thread'));await p.waitForTimeout(500);
    const restored=await p.evaluate(()=>({held:!!qaOwner().w._scrollCaptureHeld,same:qaScroller()===qaOld,top:qaScroller().scrollTop,saved:qaSaved}));
    ok(mode,'thread hold flushed and reading position restored',!restored.held&&!restored.same&&Math.abs(restored.top-restored.saved)<2,restored);
    // Stream payload uses real shell turn cache and renderer, not a surrogate DOM.
    await begin('stream');
    const stream=await p.evaluate(()=>{const c=__wos.chats.ch(qaOwner().w.id);const t=c.turns.at(-1);if(!t.a?.text)return false;t.a.text+='\n\nQA_STREAM_MARKER';return true;});
    await paint();ok(mode,'stream repaint queued without mutation or capture abort',stream&&await p.evaluate(()=>!!__wosScrollCapture.check('stream')&&!qaScroller().textContent.includes('QA_STREAM_MARKER')));
    await p.evaluate(()=>__wosScrollCapture.end('stream'));await p.waitForTimeout(500); // shell's existing scroll-idle guard is 350ms
    const flushed=await p.evaluate(()=>({shown:qaScroller().textContent.includes('QA_STREAM_MARKER'),held:__wos.chats.ch(qaOwner().w.id).held,cache:__wos.chats.ch(qaOwner().w.id).turns.at(-1).a?.text.includes('QA_STREAM_MARKER'),same:qaScroller()===qaOld,tail:qaScroller().textContent.slice(-150)}));
    ok(mode,'stream update appears after end flush',flushed.shown,flushed);
    await begin('old-thread');await p.evaluate(()=>__wosScrollCapture.move('old-thread',700));await open('qa_sc_1');
    const nav=await p.evaluate(()=>{const e=qaScroller(),top=e.scrollTop;const stale=__wosScrollCapture.move('old-thread',0),ended=__wosScrollCapture.end('old-thread');return {stale,ended,same:qaScroller()===e,top,saved:e.scrollTop,thread:qaOwner().w.thread};});
    ok(mode,'navigation invalidates old token; stale cleanup cannot scroll new thread',nav.stale===null&&nav.ended===false&&nav.top===nav.saved&&nav.thread==='qa_sc_1',nav);
    // Overlay fixtures live in the real shell, in its transformed device coordinate space.
    const chrome=await p.evaluate(()=>{
      const e=qaScroller(),savedStyle=e.getAttribute('style'),savedTop=e.scrollTop;
      e.style.setProperty('padding-top','0px','important');e.style.setProperty('padding-bottom','0px','important');
      const r=e.getBoundingClientRect(),host=e.closest('.device');
      e.scrollTop=0;const firstGap=e.firstElementChild.getBoundingClientRect().top-r.top-e.clientTop;
      e.scrollTop=1e9;const lastGap=r.top+e.clientTop+e.clientHeight-e.lastElementChild.getBoundingClientRect().bottom;
      const overlay=(id,y,h)=>{
        const n=document.createElement('div');n.id=id;
        n.style.cssText=`position:fixed;left:0;top:0;width:${e.clientWidth}px;height:${h}px;background:#802040;z-index:999999;pointer-events:auto;`;
        host.append(n);const q=n.getBoundingClientRect();n.style.left=(r.left+e.clientLeft-q.left)+'px';n.style.top=(y-q.top)+'px';return n;
      };
      const header=overlay('qaHeader',r.top+e.clientTop,63),composer=overlay('qaComposer',r.top+e.clientTop+e.clientHeight-83,83);
      e.scrollTop=173;const original={top:e.scrollTop,pt:e.style.getPropertyValue('padding-top'),pp:e.style.getPropertyPriority('padding-top'),pb:e.style.getPropertyValue('padding-bottom'),bp:e.style.getPropertyPriority('padding-bottom')};
      const c=__wosScrollCapture,b=c.search(),start=c.start('chrome');
      const publicOnly=b&&Object.keys(b).sort().join(',')==='dpr,h,height,top,vw,w,x,y';
      const excludes=b&&b.y>=header.getBoundingClientRect().bottom&&b.y+b.h<=composer.getBoundingClientRect().top;
      const edge=(first)=>{c.move('chrome',first?0:1e9);const child=first?e.firstElementChild:e.lastElementChild;const q=child.getBoundingClientRect();return first?q.top:q.bottom;};
      const first=edge(true),last=edge(false),padded=e.style.paddingTop!=='0px'&&e.style.paddingBottom!=='0px';
      const ended=c.end('chrome'),exact=ended&&e.scrollTop===original.top&&e.style.getPropertyValue('padding-top')===original.pt&&e.style.getPropertyPriority('padding-top')===original.pp&&e.style.getPropertyValue('padding-bottom')===original.pb&&e.style.getPropertyPriority('padding-bottom')===original.bp;
      header.remove();composer.remove();savedStyle===null?e.removeAttribute('style'):e.setAttribute('style',savedStyle);e.scrollTop=savedTop;
      return {b,start,publicOnly,excludes,padded,first,last,firstGap,lastGap,exact};
    });
    ok(mode,'wide header/composer excluded; public search has no DOM objects',!!chrome.start&&chrome.excludes&&chrome.publicOnly,chrome);
    ok(mode,'padding brings first/last message edges to capture band at scroll limits',chrome.padded&&Math.abs(chrome.first-chrome.b.y-chrome.firstGap)<2&&Math.abs(chrome.last+chrome.lastGap-chrome.b.y-chrome.b.h)<2,chrome);
    ok(mode,'end restores exact padding priorities and original scrollTop',chrome.exact,chrome);
    const floater=await p.evaluate(()=>{
      const e=qaScroller(),r=e.getBoundingClientRect(),f=document.createElement('button');f.id='qaFloatingButton';f.textContent='PRIVATE_BUTTON_TEXT';
      f.style.cssText='position:fixed;left:0;top:0;width:56px;height:56px;z-index:999999;pointer-events:auto;visibility:visible!important;';e.closest('.device').append(f);
      const q=f.getBoundingClientRect();f.style.left=(r.left+r.width*.5-q.left-28)+'px';f.style.top=(r.top+r.height*.5-q.top-28)+'px';
      const hit=f.contains(document.elementFromPoint(r.left+r.width*.5,r.top+r.height*.5)),c=__wosScrollCapture,found=!!c.search(),detail=c.searchDetail(),started=!!c.start('floater'),hidden=getComputedStyle(f).visibility==='hidden';
      const ended=c.end('floater'),restored=f.style.getPropertyValue('visibility')==='visible'&&f.style.getPropertyPriority('visibility')==='important';f.remove();
      return {hit,found,listed:detail.floaters.includes('button#qaFloatingButton'),started,hidden,ended,restored};
    });
    ok(mode,'unregistered 56x56 floating button hidden only during capture',Object.values(floater).every(Boolean),floater);
    await begin('visibility');
    const visibility=await p.evaluate(async()=>{
      const descriptor=Object.getOwnPropertyDescriptor(document,'hidden');
      Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
      const kept=!!__wosScrollCapture.check('visibility');
      const raf=window.requestAnimationFrame;window.requestAnimationFrame=()=>0;
      const moved=await __wosScrollCapture.move('visibility',40);
      window.requestAnimationFrame=raf;
      descriptor?Object.defineProperty(document,'hidden',descriptor):delete document.hidden;
      window.dispatchEvent(new Event('pagehide'));
      return {kept,moved:!!moved,ended:!__wosScrollCapture.check('visibility'),restored:qaOld.scrollTop===qaSaved};
    });
    ok(mode,'hidden visibilitychange keeps session and frameless moves; pagehide restores it',Object.values(visibility).every(Boolean),visibility);
    for(const kind of ['same-height-text','append']){
      await begin(kind);
      const heights=await p.evaluate(kind=>{const e=qaScroller(),before=e.scrollHeight;
        if(kind==='append'){const n=document.createElement('div');n.style.height='200px';e.append(n);}
        else {const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){if(n.data.includes('Paragraph')){n.data=n.data.replace('Paragraph','PARAGRAPH');break;}}}
        return {before,after:e.scrollHeight};
      },kind);
      await p.waitForTimeout(50);
      if(kind==='same-height-text') {
        ok(mode,'same-height DOM mutation retains active session',heights.before===heights.after&&await p.evaluate(()=>!!__wosScrollCapture.check('same-height-text')),heights);
        await p.evaluate(()=>__wosScrollCapture.end('same-height-text'));
      } else ok(mode,'height-changing DOM mutation cancels and restores',heights.before!==heights.after&&await p.evaluate(()=>!__wosScrollCapture.check('append')&&Math.abs(qaOld.scrollTop-qaSaved)<2&&!qaOld.dataset.wosScrollCapture),heights);
    }
    await begin('cancel');await p.evaluate(()=>__wosScrollCapture.move('cancel',500));
    ok(mode,'explicit cancellation restores once, wrong token ignored',await p.evaluate(()=>__wosScrollCapture.end('wrong')===false&&__wosScrollCapture.end('cancel')===true&&__wosScrollCapture.end('cancel')===false&&qaOld.scrollTop===qaSaved));
    // Capture only the helper's 30s timer; invoke deterministically without sleeping.
    await p.evaluate(()=>{const native=setTimeout;window.qaNativeTimeout=native;window.setTimeout=(f,ms,...args)=>{if(ms===30000){window.qaDeadline=()=>f(...args);return native(()=>{},60000);}return native(f,ms,...args);};});
    await begin('timeout');await p.evaluate(()=>{setTimeout=qaNativeTimeout;__wosScrollCapture.move('timeout',650);qaDeadline();});
    ok(mode,'30s helper deadline restores and clears marker',await p.evaluate(()=>!__wosScrollCapture.check('timeout')&&qaOld.scrollTop===qaSaved&&!qaOld.dataset.wosScrollCapture));
    await p.evaluate(()=>{const o=document.createElement('div');o.id='qaCover';o.textContent='PRIVATE_OVERLAY_TEXT';o.style='position:fixed;inset:0;z-index:2147483647;background:black';document.body.append(o);});
    ok(mode,'occluded thread rejected',await p.evaluate(()=>__wosScrollCapture.search()===null));
    ok(mode,'empty JS discovery records the precise occlusion reason',await p.evaluate(()=>__wosScrollCapture.searchReason().includes('occluded')));
    ok(mode,'occlusion diagnostics have bounded sanitized element labels, never text',await p.evaluate(()=>{
      const d=__wosScrollCapture.searchDetail();
      return d.blockers.length>0&&d.blockers.length<=4&&d.blockers.every(b=>/^[a-z0-9#._-]{1,80}$/i.test(b.el)&&!('text' in b))&&!JSON.stringify(d).includes('PRIVATE_OVERLAY_TEXT');
    }));
    await p.evaluate(()=>document.getElementById('qaCover').remove());

    await begin('resize');
    const resize=await p.evaluate(()=>{const e=qaScroller(),old=e.getAttribute('style'),height=e.scrollHeight;
      e.style.height=(e.clientHeight-40)+'px';e.style.flex='none';
      const sameHeight=e.scrollHeight===height,ended=!__wosScrollCapture.check('resize');
      old===null?e.removeAttribute('style'):e.setAttribute('style',old);return {sameHeight,ended};
    });
    ok(mode,'scrollport resize cancels even if content height stays unchanged',resize.sameHeight&&resize.ended,resize);
    ok(mode,'proxy remains silent after navigation, mutations and capture sessions',await p.evaluate(()=>qaMetrics.length===0));
    await p.evaluate(()=>{qaScroller().style.transform='scale(.8)';});
    ok(mode,'scaled scroll surface rejected (pixel geometry must match)',await p.evaluate(()=>__wosScrollCapture.search()===null));
    ok(mode,'geometry rejection clears stale hit-test diagnostics',await p.evaluate(()=>__wosScrollCapture.searchDetail()===null));await p.evaluate(()=>qaScroller().style.transform='');
    await p.evaluate(()=>{qaScroller().style.height='20px';qaScroller().style.flex='none';});
    ok(mode,'too-small surface rejected',await p.evaluate(()=>__wosScrollCapture.search()===null));await p.evaluate(()=>{qaScroller().style.height='';qaScroller().style.flex='';});
    await p.evaluate(()=>__wos.goDesk(0));await p.waitForTimeout(600);ok(mode,'background chat rejected',await p.evaluate(()=>__wosScrollCapture.search()===null));await p.evaluate(()=>__wos.goDesk(1));await p.waitForTimeout(600);
   }
   await p.keyboard.press('Escape');await p.waitForTimeout(400);
   ok(mode,'Back from thread returns to list and keeps app open',await p.evaluate(()=>qaOwner().w.thread==null&&!!window.__wos&&document.visibilityState==='visible'));
   await p.keyboard.press('Escape');await p.waitForTimeout(400);
   ok(mode,'Back at root keeps app open',await p.evaluate(()=>!!window.__wos&&document.visibilityState==='visible'&&location.hostname==='scroll-capture.invalid'));
   await p.screenshot({path:path.join(OUT,mode+'.png')});
  }catch(e){ok(mode,'suite completed',false,String(e));console.log('DIAGNOSTIC',await p.evaluate(()=>({keys:Object.keys(window.__wos||{}),text:document.body.innerText.slice(0,1000)})));}
  await ctx.close();
 }
 }finally{await browser.close();fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({root:ROOT,results,writes,errors},null,2));}
 const passed=results.filter(r=>r.pass).length,failed=results.length-passed;
 console.log(JSON.stringify({passed,failed,writesIntercepted:writes.length,pageErrors:errors}));process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=2;});
