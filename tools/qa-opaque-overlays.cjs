/* James: readable floating panels are opaque, not blurred glass.
 * No network or owner data. Loads production CSS and component contexts, not copied fills.
 * QA_WEB_DIR=<checkout> QA_SHOTS=<optional directory> QA_PHASE=before|after
 * NODE_PATH=<playwright install>/node_modules node tools/qa-opaque-overlays.cjs
 * Each panel's interior must be byte-identical over loud text and an empty canvas.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(process.env.QA_WEB_DIR || path.join(__dirname, '..'));
const read = f => fs.readFileSync(path.join(root, 'web', f), 'utf8');
const skins = ['nebula', 'grove', 'tide', 'ember', 'signal'];
const phoneCSS = ['core/base.css', 'styles.css', 'core/chats.css', 'core/chat-power.css', 'core/desks.css', 'core/tour.css', 'core/polish.css', 'core/update-banner.css', 'core/home-surfaces.css', 'core/home-screen-apps.css', 'core/scheduled-reminders.css', 'core/app-route.css', 'core/share-wizard.css', 'core/sel-menu.css', 'core/skins.css'];
const groups = {
 phone: phoneCSS,
 desktop: ['core/base.css', 'core/chats.css', 'desktop/desktop.css', 'core/update-banner.css', 'core/skins.css'],
 kit: ['kit/wizard-tokens.css', 'kit/wizard-ui.css'],
 setup: ['kit/wizard-tokens.css', 'setup/setup.css'],
 store: ['kit/wizard-tokens.css', 'store/store.css'],
 agents: ['kit/wizard-tokens.css', 'agents/agents.css'],
 motion: ['kit/wizard-tokens.css', 'motion/wizard-motion.css'],
};
// These are the real production panel classes and their cascade/ancestor contexts.
// Scrims and in-flow cards are intentionally absent. Visibility/layout is normalized only
// to inspect settled interiors; no background, filter or colour is injected by the test.
const cases = [
 ...['sheet open','wmenu on','toast on','desk-label on','timer','transcript','pk-card','dv-sheet','ch-pill','ch-sheet-b','ch-fcard','rv-card','ov open','nd-search','wx-banner','wx-fcard','dv-update','app-upd','wos-burst','home-pin-sheet','boom-card','ar-card','selmenu on','wz-home-popup','tr-copy','tr-skip'].map(cls => ({group:'phone',name:cls.split(' ')[0],cls})),
 {group:'phone',name:'floating-timer',cls:'timer',wrap:'device'},
 {group:'phone',name:'corner-timer',cls:'timer',wrap:'device orb-corner'},
 {group:'phone',name:'dock',cls:'dock',wrap:'device'},
 {group:'phone',name:'scrub-label',cls:'sc-label',wrap:'scrub'},
 {group:'phone',name:'share-wizard',cls:'dv-sheet',wrap:'wz-share'},
 {group:'phone',name:'message-popover',cls:'ch-sheet-b',wrap:'ch-mpop'},
 {group:'phone',name:'reminder-footer',cls:'',tag:'footer',wrap:'boom-card'},
 {group:'phone',name:'tour-step-three',cls:'tr-copy',wrap:'tour',attrs:'data-step="3"'},
 ...['bar','pal-card','keys-card','toast on','exit-full','bar-tip'].map(cls=>({group:'desktop',name:cls.split(' ')[0],cls})),
 {group:'desktop',name:'voice-pill',id:'voicePill'},
 {group:'desktop',name:'voice-tray',cls:'voice-tray',wrapId:'voicePill'},
 {group:'desktop',name:'update-thread-menu',cls:'dv-wl',wrapId:'dvWeb',attrs:'data-shell="desktop"'},
 ...['wz-sheet','wz-sheet-x'].map(cls=>({group:'kit',name:cls,cls})),
 ...['menu','sheet','toast'].map(cls=>({group:'setup',name:cls,cls})),
 ...['top','toast on'].map(cls=>({group:'store',name:cls.split(' ')[0],cls})),
 {group:'agents',name:'agent-sheet',cls:'card',wrap:'ag-sheet'},
 {group:'agents',name:'agent-footer',cls:'ag-flow-foot'},
 ...['wm-card on','wm-hint on','wm-pill'].map(cls=>({group:'motion',name:cls.split(' ')[0],cls})),
];
const loud = Array.from({length:40},(_,i)=>`<div style="color:${i%2?'#fff':'#ff0'};background:${i%2?'#f0f':'#00f'}">BEHIND TEXT WWWWW ${i}</div>`).join('');
function html(test, skin, hosted) {
 const css = [...new Set(['kit/wizard-tokens.css',...groups[test.group]])].map(read).join('\n');
 const tag=test.tag||'section';
 const panel=`<${tag} id="${test.id||'qa-panel'}" class="${test.cls||''}" data-qa-panel><strong>Readable ${test.name}</strong><p>Nothing behind this panel should show through.</p></${tag}>`;
 const wrap=`<div ${test.wrapId?`id="${test.wrapId}"`:''} class="${test.wrap||''}" ${test.attrs||''}>${panel}</div>`;
 return `<!doctype html><html data-skin="${skin}" data-shell="${test.group==='desktop'?'desktop':'phone'}" class="${hosted?'wz-hosted':''}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>
 * {animation:none!important;transition:none!important;caret-color:transparent!important}
 html,body {margin:0;width:390px;height:844px;overflow:hidden}
 body {background:var(--wz-base,#05030c)}
 #behind {position:fixed;inset:0;z-index:0;font:900 26px/30px sans-serif}
 #fixture {position:fixed;inset:0;z-index:1;isolation:isolate;background:none}
 #fixture > div {position:absolute;inset:0;background:none;opacity:1;transform:none;pointer-events:auto}
 /* A retained raster layer prevents gradient dithering from changing on an unrelated repaint.
  * This does not supply an opaque backing: the old translucent materials still fail. */
 [data-qa-panel] {will-change:transform;position:absolute!important;display:block!important;inset:220px auto auto 16px!important;width:358px!important;height:240px!important;min-width:0!important;max-width:none!important;max-height:none!important;margin:0!important;padding:24px!important;box-sizing:border-box!important;transform:none!important;scale:1!important;visibility:visible!important;overflow:hidden!important}
 </style></head><body><div id="behind">${loud}</div><main id="fixture">${wrap}</main></body></html>`;
}
async function realShell(browser, results) {
 // Boot the real shell from this checkout. APIs are isolated fixtures, all writes/network blocked.
 const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
 await ctx.route('**/*',r=>{
  const u=new URL(r.request().url());
  if(u.origin!=='http://opaque.test')return r.abort();
  const rel=u.pathname.replace(/^\/wizard-os-home\//,'')||'index.html';
  const f=path.resolve(root,'web',rel);
  if(r.request().method()==='GET'&&f.startsWith(path.join(root,'web')+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile()) {
   const ext=path.extname(f);const types={'.css':'text/css','.html':'text/html','.js':'application/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
   return r.fulfill({status:200,contentType:types[ext]||'application/octet-stream',body:fs.readFileSync(f)});
  }
  const body=/\/sessions$/.test(u.pathname)?{data:[],has_more:false}:{};
  return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await ctx.addInitScript(()=>{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour','done')});
 const page=await ctx.newPage();
 await page.goto('http://opaque.test/wizard-os-home/',{waitUntil:'load'});
 await page.waitForFunction(()=>window.__wos&&window.WosSkin,{timeout:30000});
 await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important} canvas{visibility:hidden!important}'});
 for(const skin of skins)for(const hosted of [true,false])for(const name of ['settings','overview','link-menu']) {
  await page.evaluate(({skin,hosted,name})=>{
   document.querySelectorAll('[data-qa-hide]').forEach(e=>{e.style.removeProperty('visibility');e.removeAttribute('data-qa-hide')});
   document.querySelector('#qa-real-behind')?.remove();
   document.querySelector('.wiz-linkmenu')?.remove();
   __wos.closeSheets();__wos.closeOverview();
   WosSkin.set(skin);document.documentElement.classList.toggle('wz-hosted',hosted);
   if(name==='settings')__wos.openSheet('settings');
   else if(name==='overview')__wos.openOverview();
   else {
    let a=document.querySelector('#qa-real-link');if(!a){a=document.createElement('a');a.id='qa-real-link';a.className='bub';a.href='https://example.org/';a.textContent='Test link';(document.querySelector('#track')||document.body).appendChild(a)}
    a.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:200}));
   }
  },{skin,hosted,name});
  const sel={settings:'#settings.open',overview:'#overview.open','link-menu':'.wiz-linkmenu'}[name];
  const panel=page.locator(sel);await panel.waitFor({state:'visible'});
  await panel.evaluate((e,loud)=>{
   // Hide other shell content, never the panel's ancestors. The controlled backdrop
   // is its immediately preceding sibling at the same stacking level.
   for(let n=e;n&&n!==document.body;n=n.parentElement)for(const sib of n.parentElement.children)if(sib!==n){sib.setAttribute('data-qa-hide','');sib.style.visibility='hidden'}
   const behind=document.createElement('div');behind.id='qa-real-behind';behind.innerHTML=loud;
   behind.style.cssText='position:fixed;inset:0;pointer-events:none;font:900 26px/30px sans-serif;visibility:visible';
   behind.style.zIndex=String((Number(getComputedStyle(e).zIndex)||1)-1);e.before(behind);
   e.style.willChange='transform';
  },loud);
  const b=await panel.boundingBox();assert(b&&b.width>80&&b.height>48,`${name} real shell panel visible`);
  const inset=Math.min(32,b.height/5);
  const clip={x:b.x+32,y:b.y+inset,width:b.width-64,height:b.height-inset*2};
  const over=await page.screenshot({clip});
  if(skin==='nebula'&&hosted&&process.env.QA_SHOTS){fs.mkdirSync(process.env.QA_SHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.QA_SHOTS,`${process.env.QA_PHASE||'after'}-real-${name}.png`)})}
  await page.evaluate(()=>document.querySelector('#qa-real-behind').style.visibility='hidden');
  const bare=await page.screenshot({clip});
  results.push({skin,hosted,group:'real-shell',panel:name,opaque:over.equals(bare)});
 }
 await ctx.close();
}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-lcd-text','--disable-gpu']});
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
 const results=[];
 for(const skin of skins) for(const hosted of [true,false]) for(const test of cases.filter(t=>!process.env.QA_FILTER || t.name===process.env.QA_FILTER)) {
  await page.setContent(html(test,skin,hosted));
  const panel=page.locator('[data-qa-panel]');
  // Open an initially hidden fixture; never mask a persistently translucent visible state.
  await panel.evaluate(e=>{if(Number(getComputedStyle(e).opacity)===0)e.style.opacity='1'});
  const b=await panel.boundingBox(); assert(b&&b.width>40&&b.height>40,`${test.name} rendered`);
  // Stay inside pill/elliptical corners as well as ordinary rounded cards.
  const clip={x:b.x+64,y:b.y+64,width:b.width-128,height:b.height-128};
  const over=await page.screenshot({clip});
  if(skin==='nebula'&&hosted&&process.env.QA_SHOTS&&test.group==='phone'&&['sheet','wmenu','share-wizard'].includes(test.name)) {
   fs.mkdirSync(process.env.QA_SHOTS,{recursive:true});
   await page.screenshot({path:path.join(process.env.QA_SHOTS,`${process.env.QA_PHASE||'after'}-${test.name}.png`)});
  }
  await page.evaluate(()=>document.querySelector('#behind').style.visibility='hidden');
  const bare=await page.screenshot({clip});
  results.push({skin,hosted,group:test.group,panel:test.name,opaque:over.equals(bare),material:await panel.evaluate(e=>({color:getComputedStyle(e).backgroundColor,image:getComputedStyle(e).backgroundImage,opacity:getComputedStyle(e).opacity}))});
 }
 if(!process.env.QA_FILTER || process.env.QA_FILTER==='real')await realShell(browser,results);
 await browser.close();
 const failed=results.filter(r=>!r.opaque);
 const result={checked:results.length,failures:failed.length,see_through:failed};
 if(process.env.QA_RESULT)fs.writeFileSync(process.env.QA_RESULT,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
 assert.equal(failed.length,0,'text-bearing overlay interiors must be independent of content behind');
 console.log('PASS opaque overlays');
})().catch(e=>{console.error(e);process.exitCode=1});
