// Borderless canvas acceptance (pixels, not box geometry): Wisdom library, the Critical Buddhism collection detail,
// in-app Back, Chats and desktop. Read-only: every non-GET request is aborted.
// QA_URL=https://… [QA_OUT=dir] [CAND_DIR=web dir to serve /wizard-os-home/ from, for a pre-deploy candidate] node tools/qa-borderless-canvas.cjs
const {chromium}=require('./qa-playwright.cjs'),fs=require('fs'),path=require('path');
const BASE=process.env.QA_URL,OUT=process.env.QA_OUT||'qa-borderless-canvas',CAND=process.env.CAND_DIR;let fails=0;const res=[];
const check=(name,ok,detail)=>{res.push({name,ok:!!ok,detail});if(!ok)fails++;console.log((ok?'PASS ':'FAIL ')+name+(ok?'':' '+JSON.stringify(detail)));};
const near=(a,b,t=10)=>a&&b&&Math.abs(a[0]-b[0])<=t&&Math.abs(a[1]-b[1])<=t&&Math.abs(a[2]-b[2])<=t;
(async()=>{fs.mkdirSync(OUT,{recursive:true});const b=await chromium.launch();
const ctx=async o=>{const c=await b.newContext({serviceWorkers:'block',...o});
  await c.route('**/*',r=>['GET','HEAD'].includes(r.request().method())?r.fallback():r.abort());
  if(CAND)await c.route('**/wizard-os-home/**',r=>{const f=path.join(CAND,new URL(r.request().url()).pathname.replace(/^.*?\/wizard-os-home\//,'')||'index.html');return fs.existsSync(f)&&fs.statSync(f).isFile()?r.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':'application/javascript'}):r.fallback();});
  return c;};
// Sample screen pixels from a real screenshot, decoded in the page.
const px=async(p,pts)=>{const b64=(await p.screenshot()).toString('base64');return p.evaluate(async([b64,pts])=>{const i=new Image();i.src='data:image/png;base64,'+b64;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);return pts.map(([a,b])=>Array.from(x.getImageData(Math.round(a),Math.round(b),1,1).data.slice(0,3)));},[b64,pts]);};
const geo=(p,sel)=>p.evaluate(sel=>{const w=document.querySelector(sel||`.win[data-win="${__wos.desks[__wos.idx].focus}"]`),r=e=>e&&e.getBoundingClientRect().toJSON();return {win:r(w),body:r(w.querySelector('.wbody')),title:r(w.querySelector('.wt')),close:r(w.querySelector('[data-wact="close"]')),closeBg:getComputedStyle(w.querySelector('[data-wact="close"]')).backgroundColor,orb:r(document.querySelector('#orb,.orb')),dock:r(document.querySelector('#dock')||document.querySelector('#bar')),menu:document.querySelectorAll('.sf-menu,.sf-move,.sf-review-tab').length};},sel);
const c=await ctx({viewport:{width:412,height:892},isMobile:true,hasTouch:true}),p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto(BASE+'/wizard-os-home/?open=wisdom&shell=phone',{waitUntil:'domcontentloaded'});
await p.frameLocator('iframe[src*="/wisdom/"]').locator('a.wb-pick[data-wisdom-route]').first().waitFor({timeout:30000});await p.waitForTimeout(1500);
const f=p.frames().find(f=>f.url().includes('/wisdom/'));let g=await geo(p);const lib=g;
check('borderless foundation, title and floating X, no ellipsis/move/review tab',await p.evaluate(()=>WosSkin.frame.foundation==='borderless')&&g.title&&g.close&&g.menu===0,g);
check('library: full-bleed app canvas, heading inset only',g.win.x===0&&g.body.x===0&&g.body.right===412&&g.title.x===16&&g.close.right===402,g);
check('X has no contrasting plate',g.closeBg==='rgba(0, 0, 0, 0)',g.closeBg);
let [hd,bd]=await px(p,[[200,8],[4,g.body.y+30]]);check('library: heading continues the window canvas',near(hd,bd,14),{hd,bd});await p.screenshot({path:OUT+'/phone-library.png'});
await f.evaluate(()=>{const a=document.querySelector('a.wb-pick[data-wisdom-route]');a.dataset.wisdomRoute='/collection/critical-buddhism';a.click();});
await f.waitForSelector('.wb-book-portrait');await f.waitForFunction(()=>document.querySelector('.wb-book-portrait').naturalWidth>0);await p.waitForTimeout(1200);
g=await geo(p);const art=await f.evaluate(()=>{const r=document.querySelector('.wb-book-hero').getBoundingClientRect();return {x:r.x,right:r.right,bottom:r.bottom,vw:innerWidth};});
check('detail: hero art reaches both screen edges',art.x===0&&art.right===art.vw&&g.body.x===0&&g.body.right===412,{art,body:g.body});
const y=g.body.y;const [h1,h2,e0,e1,mid,below,skin]=await px(p,[[200,6],[200,y-6],[1,y+40],[410,y+40],[206,y+40],[4,y+art.bottom+60],[200,6]]);
check('detail: no shell gutter, edge pixels match the art beside them',near(e0,mid,14)&&near(e1,mid,14),{e0,e1,mid});
check('detail: heading takes the hero top colour, no contrasting strip',near(h2,mid,14)&&near(h1,h2,4),{h1,h2,mid});
// The seam itself: heading 3px above vs rendered art 3px below, same columns. Mean within 4/255, every column within 8.
const xs=[30,90,150,262,322,382],ab=await px(p,xs.flatMap(x=>[[x,y-3],[x,y+3]])),up=ab.filter((_,i)=>!(i%2)),dn=ab.filter((_,i)=>i%2);
const avg=a=>[0,1,2].map(k=>Math.round(a.reduce((s,v)=>s+v[k],0)/a.length));
check('detail: no tonal step at the heading/art seam',near(avg(up),avg(dn),4)&&up.every((u,i)=>near(u,dn[i],8)),{up:avg(up),down:avg(dn),cols:up.map((u,i)=>[u,dn[i]])});
check('detail: below the hero the page keeps the library skin canvas',near(below,bd,16),{below,library:bd});
await p.screenshot({path:OUT+'/phone-critical-buddhism.png'});
await p.evaluate(()=>__wosNativeBack());await p.waitForTimeout(1200);g=await geo(p);[hd]=await px(p,[[200,8]]);
check('Back from detail stays in Wisdom and the heading returns to the skin canvas',await p.locator('iframe[src*="/wisdom/"]').isVisible()&&!f.url().includes('/collection/')&&near(hd,bd,14),{url:f.url(),hd,bd});
check('orb/dock unchanged across routes',JSON.stringify(g.orb)===JSON.stringify(lib.orb)&&JSON.stringify(g.dock)===JSON.stringify(lib.dock)&&Math.abs(g.body.bottom-g.dock.y)<1,{g,lib});
await p.screenshot({path:OUT+'/phone-after-back.png'});
await p.evaluate(()=>__wos.openWin({app:'chats',thread:null}));await p.waitForTimeout(1200);g=await geo(p);
check('Chats: full-bleed body with inset heading',g.body.x===0&&g.body.right===412&&g.title.x>=16&&g.close.right===402,g);await p.screenshot({path:OUT+'/phone-chats.png'});
await p.evaluate(()=>__wosNativeBack());await p.waitForTimeout(600);check('Back from Chats keeps shell open',p.url().startsWith(BASE)&&await p.locator('#device').isVisible(),p.url());
const dc=await ctx({viewport:{width:1440,height:900}}),dp=await dc.newPage();dp.on('pageerror',e=>errs.push(e.message));
await dp.goto(BASE+'/wizard-os-home/?open=wisdom&shell=desktop',{waitUntil:'domcontentloaded'});await dp.frameLocator('iframe[src*="/wisdom/"]').locator('a.wb-pick[data-wisdom-route]').first().waitFor({timeout:30000});await dp.waitForTimeout(1500);
g=await geo(dp,'.win:has(iframe[src*="/wisdom/"])');check('desktop: window keeps its arranged geometry, body fills it',g.win&&g.body.x-g.win.x<=2&&g.win.right-g.body.right<=2,g);await dp.screenshot({path:OUT+'/desktop.png'});
check('no page errors',errs.length===0,errs);
fs.writeFileSync(OUT+'/result.json',JSON.stringify({base:BASE,candidate:!!CAND,fails,res},null,1));await b.close();console.log(fails?`${fails} FAILED`:'ALL PASS');process.exit(fails?1:0);})();
