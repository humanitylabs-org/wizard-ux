'use strict';
// Read-only synthetic-origin regression for James's repeated white orb correction.
// QA_OUT=... BASELINE_WEB=... node tests/qa-orb-white-app-icon.cjs
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.QA_OUT||path.join(ROOT,'qa-orb-white'),BASELINE=process.env.BASELINE_WEB;
const MIME={'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.json':'application/json'};
const apps=[{id:'airlock',name:'Airlock'},{id:'orb-no-mono',name:'No monochrome asset'},{id:'orb-transparent',name:'Transparent glyph'}].map(a=>({...a,type:'service',url:'/fixture-app/'+a.id,colors:['#4ccca3','#62baf0']}));
const logos=Object.fromEntries(apps.map(a=>[a.id,'0123456789abcdef']));
const noMono='<svg xmlns="http://www.w3.org/2000/svg" width="192" height="128"><path fill="#12121e" d="M0 0h192v128H0z"/><path fill="#ef5080" d="M72 20h48v24h24v40h-24v24H72V84H48V44h24z"/></svg>';
const transparent='<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><path fill="#4ccca3" d="M48 16h32v32h32v32H80v32H48V80H16V48h32z"/></svg>';
let version='candidate'; const requests=[];
const server=http.createServer((req,res)=>{
 const p=new URL(req.url,'http://localhost').pathname,row={version,method:req.method,path:p}; requests.push(row);
 const send=(data,type='application/json',status=200)=>{row.status=status;res.writeHead(status,{'content-type':type,'cache-control':'no-store'});res.end(type==='application/json'?JSON.stringify(data):data);};
 if(req.method!=='GET'){row.refusedBeforeHandlers=true;return send({error:'read-only fixture'},'application/json',405);}
 if(p==='/wizard/v1/bootstrap')return send({bootstrap:1,settings:{agent:{name:'Orb regression'}},capabilities:{},endpoints:{apps:'/wizard/v1/apps'}});
 if(p==='/wizard/v1/apps')return send({apps});
 if(p.endsWith('/wizard/v1/app-logos'))return send({logos});
 if(p.includes('/store-data/app-logo/')){const id=p.split('/').pop();return id==='airlock'?send(fs.readFileSync(path.join(ROOT,'tests/fixtures/orb-white-airlock.jpg')),'image/jpeg'):send(id==='orb-no-mono'?noMono:transparent,'image/svg+xml');}
 if(p.startsWith('/fixture-app/'))return send('<!doctype html><html><title>Empty synthetic app</title><body style="background:#14141b;color:white;font:20px system-ui">Synthetic app · no owner data</body></html>','text/html');
 if(p.includes('/api/')||p.includes('/wizard/v1/')||p.startsWith('/wizard/hermes/')||p.includes('/store-data/')||p==='/launcher.json'){
  if(p.endsWith('/model/options'))return send({provider:'qa',providers:[{slug:'qa',authenticated:true}]});
  if(p.endsWith('/setup'))return send({first_run:false,seen:true});
  if(p.endsWith('/config'))return send({settings:{agent:{name:'Orb regression'}}});
  if(/\/agents\/?$/.test(p))return send({agents:[]});
  if(/sessions|threads/.test(p))return send({sessions:[],threads:[],has_more:false});
  return send({apps:[],agents:[],items:[],entries:[],sessions:[],settings:{},ok:true});
 }
 if(!p.startsWith('/wizard-os-home/'))return send({},'application/json',404);
 const web=version==='baseline'?BASELINE:path.join(ROOT,'web');
 let file=path.resolve(web,p.slice('/wizard-os-home/'.length)||'index.html');
 if(!file.startsWith(path.resolve(web)+path.sep))return send({},'application/json',403);
 try{if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');return send(fs.readFileSync(file),MIME[path.extname(file)]||'application/octet-stream');}catch{return send({},'application/json',404);}
});
async function inspect(page,shell){return page.evaluate(async shell=>{
 const host=document.querySelector(shell==='phone'?'#orbApp':'.aad-mic');
 const glyph=host?.querySelector('[data-orb-glyph],.sglogo,.sgi,svg');
 if(!glyph)return {ok:false,reason:'missing orb glyph',html:host?.innerHTML};
 const c=getComputedStyle(glyph),r=glyph.getBoundingClientRect();
 const data={tag:glyph.tagName,class:glyph.className.baseVal||glyph.className,width:r.width,height:r.height,bg:c.backgroundColor,bgi:c.backgroundImage,mask:c.maskImage,filter:c.filter,html:host.innerHTML};
 let src=glyph.tagName==='IMG'?glyph.src:null;
 if(glyph.classList.contains('sglogo'))src=glyph.style.getPropertyValue('--logo').match(/url\(['"]?(.*?)['"]?\)/)?.[1];
 if(src){
  const image=new Image(); image.src=src; await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const p=ctx.getImageData(0,0,canvas.width,canvas.height).data;let white=0,coloured=0,borderOpaque=0,visible=0;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4;if(p[i+3]>8){visible++;if(p[i]===255&&p[i+1]===255&&p[i+2]===255)white++;else coloured++;if(x<2||y<2||x>=canvas.width-2||y>=canvas.height-2)borderOpaque++;}}
  data.pixels={white,coloured,borderOpaque,visible};data.ok=white>0&&coloured===0&&borderOpaque===0;
 }else data.ok=glyph.hasAttribute('data-orb-glyph')&&c.backgroundColor==='rgb(255, 255, 255)'&&c.backgroundImage==='none'&&c.maskImage!=='none';
 data.ok=data.ok&&r.width>8&&r.height>8;return data;
},shell);}
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});assert.ok(BASELINE,'BASELINE_WEB must point to exact current live web snapshot');
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const report={origin,cases:[],errors:[],failures:[],requests};
 try{
  for(const v of ['baseline','candidate']){version=v;
   for(const shell of ['phone','desktop'])for(const skin of ['nebula','obsidian']){
    const ctx=await browser.newContext({viewport:shell==='phone'?{width:412,height:892}:{width:1440,height:1000},deviceScaleFactor:1,hasTouch:shell==='phone',isMobile:shell==='phone',serviceWorkers:'block',...(shell==='phone'?{userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'}:{})});
    try{
     await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
     await ctx.addInitScript(({shell,skin,logos})=>{
      if(shell==='phone')window.WizardOSNative={usuals:()=>JSON.stringify([])};
      for(const [k,v] of Object.entries({'wux.shell':shell,'wos.desktop-view.v1':'ai-apps','wos.skin':skin,'wos.welcome.v1':'done','wos.onboarded':'1','wos.coached':'true','wos.tour.v1':'true','wos.tour.done':'1'}))localStorage.setItem(k,v);
      localStorage.setItem('wos.skin.composition.v1',JSON.stringify({version:1,extends:skin,layout:shell==='phone'?'classic':'ai-apps'}));
      localStorage.setItem('wux.applogos.v1',JSON.stringify(Object.fromEntries(Object.entries(logos).map(([id,h])=>[id,'/wizard-os-home/store-data/app-logo/'+id+'?v='+h]))));
     },{shell,skin,logos});
     const page=await ctx.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push({v,shell,skin,error:e.message}));
     await page.goto(origin+'/wizard-os-home/'+(shell==='desktop'?'desktop.html':'')+'?shell='+shell,{waitUntil:'domcontentloaded'});
     await page.waitForFunction(shell=>document.documentElement.dataset.shell===shell&&window.WizConfig?.live&&window.WizCore?.apps?.(shell==='phone'?'mobile':'desktop').APP?.airlock&&window.WizSigil&&window.WosSkin,shell);
     await page.evaluate(()=>window.WizCore.appsLoaded());
     for(const app of apps){
      if(shell==='phone')await page.evaluate(id=>window.__wos.openApp(id),app.id);
      else{await page.keyboard.press('Alt+o');const row=page.locator('#palette:not([hidden]) .pal-app').filter({has:page.locator('.nm',{hasText:new RegExp('^'+app.name+'$')})});await row.click();}
      await page.locator('iframe[title="'+app.name+'"]').first().waitFor({state:'visible'});
      await page.waitForTimeout(900);
      if(v==='candidate')await page.waitForFunction(shell=>!!document.querySelector((shell==='phone'?'#orbApp':'.aad-mic')+' [data-orb-glyph]'),shell);
      const probe=await inspect(page,shell),file=[v,shell,skin,app.id].join('-')+'.png';
      await page.screenshot({path:path.join(OUT,file)});
      const row={v,shell,skin,id:app.id,...probe,screenshot:file,actual:await page.evaluate(()=>({shell:document.documentElement.dataset.shell,skin:document.documentElement.dataset.skin,layout:document.documentElement.dataset.layout}))}; report.cases.push(row);
      if(v==='candidate'&&!probe.ok)report.failures.push(row);
     }
    }catch(e){report.failures.push({v,shell,skin,error:e.stack});}finally{await ctx.close();}
   }
  }
  for(const shell of ['phone','desktop'])assert.ok(report.cases.some(c=>c.v==='baseline'&&c.shell===shell&&!c.ok),'baseline reproduces '+shell);
  assert.equal(report.cases.filter(c=>c.v==='candidate'&&c.ok).length,12,'all apps, both shells and skins');
  assert.equal(requests.filter(r=>r.method!=='GET'&&r.status<400).length,0,'no accepted writes');
  assert.equal(report.failures.length,0,JSON.stringify(report.failures));
 }catch(e){report.failures.push({error:e.stack});process.exitCode=1;}
 finally{fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(report,null,2));await browser.close();server.close();}
 console.log(JSON.stringify({cases:report.cases.length,green:report.cases.filter(c=>c.v==='candidate'&&c.ok).length,baselineRed:report.cases.filter(c=>c.v==='baseline'&&!c.ok).length,failures:report.failures}));
})();
