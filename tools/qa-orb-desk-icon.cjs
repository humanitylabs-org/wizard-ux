// Orb desk icon acceptance (Wizard skin family): on the phone dock, the orb carries the current desk's app icon in
// white, follows desk changes, hides while recording, and Miguel's skins keep their own treatment.
// Read-only: every non-GET request is aborted.
// QA_URL=http://127.0.0.1:8923 [QA_OUT=dir] [CAND_DIR=web dir to serve /wizard-os-home/ from] node tools/qa-orb-desk-icon.cjs
const {chromium}=require('./qa-playwright.cjs'),fs=require('fs'),path=require('path');
const BASE=process.env.QA_URL||'http://127.0.0.1:8923',OUT=process.env.QA_OUT||'qa-orb-desk-icon',CAND=process.env.CAND_DIR;let fails=0;const res=[],errs=[];
const check=(name,ok,detail)=>{res.push({name,ok:!!ok,detail});if(!ok)fails++;console.log((ok?'PASS ':'FAIL ')+name+(ok?'':' '+JSON.stringify(detail)));};
const TYPES={'.css':'text/css','.html':'text/html','.js':'application/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.txt':'text/plain'};
const UA='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
(async()=>{fs.mkdirSync(OUT,{recursive:true});const b=await chromium.launch();
const page=async skin=>{const c=await b.newContext({serviceWorkers:'block',viewport:{width:412,height:892},deviceScaleFactor:2,hasTouch:true,isMobile:true,userAgent:UA});
  await c.route('**/*',r=>['GET','HEAD'].includes(r.request().method())?r.fallback():r.abort());
  if(CAND)await c.route('**/wizard-os-home/**',r=>{let rel=new URL(r.request().url()).pathname.replace(/^.*?\/wizard-os-home\//,'');if(!rel)rel='index.html';const f=path.join(CAND,rel);return fs.existsSync(f)&&fs.statSync(f).isFile()?r.fulfill({body:fs.readFileSync(f),contentType:TYPES[path.extname(f)]||'application/octet-stream'}):r.fallback();});
  await c.addInitScript(s=>{try{if(!sessionStorage.qaSeeded){localStorage.setItem('wos.skin',s);localStorage.setItem('wos.skin.composition.v1',JSON.stringify({version:1,extends:s}));localStorage.setItem('wos.tour.done','1');sessionStorage.qaSeeded=1;}}catch(e){}},skin);
  const p=await c.newPage();p.on('pageerror',e=>errs.push(skin+': '+e.message));
  await p.goto(BASE+'/wizard-os-home/?shell=phone',{waitUntil:'domcontentloaded'});await p.waitForSelector('#orbWrap',{timeout:30000});await p.waitForTimeout(2500);return p;};
const probe=p=>p.evaluate(()=>{const el=document.getElementById('orbApp'),o=document.getElementById('orbWrap').getBoundingClientRect();if(!el)return {missing:true};
  const cs=getComputedStyle(el),g=el.querySelector('.sgi,img,svg'),gr=g&&g.getBoundingClientRect(),gc=g&&getComputedStyle(g);
  return {skin:document.documentElement.dataset.skin,layout:document.documentElement.dataset.layout||'',display:cs.display,opacity:+cs.opacity,html:el.innerHTML.slice(0,160),
    glyph:g&&{bg:gc.backgroundColor,bgi:gc.backgroundImage.slice(0,40),filter:gc.filter,w:Math.round(gr.width),cx:Math.round(gr.x+gr.width/2-(o.x+o.width/2)),cy:Math.round(gr.y+gr.height/2-(o.y+o.height/2))},orb:Math.round(o.width)};});
const shotOrb=async(p,name)=>{const o=await p.locator('#orbWrap').boundingBox();await p.screenshot({path:`${OUT}/${name}.png`,clip:{x:0,y:Math.max(0,o.y-40),width:412,height:o.height+80}});};
for(const skin of ['nebula','grove','tide','ember','signal']){
  const p=await page(skin);let s=await probe(p);
  check(`${skin}: orb shows the current desk icon`,s.skin===skin&&s.display!=='none'&&s.opacity>.8&&s.glyph,s);
  check(`${skin}: icon is white`,s.glyph&&(s.glyph.bg==='rgb(255, 255, 255)'&&s.glyph.bgi==='none'||/invert\(1\)/.test(s.glyph.filter)),s.glyph);
  check(`${skin}: icon centred inside the orb`,s.glyph&&Math.abs(s.glyph.cx)<=2&&Math.abs(s.glyph.cy)<=2&&s.glyph.w<s.orb*.6,s);
  await shotOrb(p,skin+'-home');
  if(skin==='nebula'){
    const before=s.html;
    await p.evaluate(()=>window.__wos?.openApp?.('wisdom')||window.__wos?.goDesk?.(1));await p.waitForTimeout(1500);
    const after=await probe(p);check('nebula: icon follows the desk in view',after.html!==before&&after.display!=='none',{before,after:after.html});
    await shotOrb(p,'nebula-app');
    await p.evaluate(()=>document.getElementById('device').dataset.voice='listen');await p.waitForTimeout(400);
    const rec=await probe(p);check('nebula: icon steps aside while recording',rec.opacity===0,rec);
  }
  await p.context().close();}
const m=await page('obsidian');const ms=await probe(m);check('obsidian: Miguel skin keeps its ink-coloured icon',ms.display!=='none'&&ms.glyph,ms);await shotOrb(m,'obsidian-home');await m.context().close();
check('no page errors',errs.length===0,errs);
fs.writeFileSync(OUT+'/result.json',JSON.stringify({base:BASE,candidate:!!CAND,fails,res},null,1));await b.close();console.log(fails?`${fails} FAILED`:'ALL PASS');process.exit(fails?1:0);})();
