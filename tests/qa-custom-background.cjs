'use strict';
// Full in-shell proof on a completely synthetic origin; no owner reads or writes.
const {chromium}=require('../tools/qa-playwright.cjs');
const {ownerRead}=require('../tools/qa-desktop-frame-fixture.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=process.env.QA_OUT||'custom-background-evidence';fs.mkdirSync(out,{recursive:true});
const root=path.resolve(__dirname,'../web'),origin='https://background.test',prefix='/wizard-os-home/';
const wide=process.env.QA_WIDE||path.join(root,'core/skins/wizard/lake-wide.webp');
const tall=process.env.QA_TALL||path.join(root,'core/skins/wizard/lake-tall.webp');
const results=[],requests=[],errors=[];let page;
(async()=>{
 const browser=await chromium.launch();
 try {
  let look={version:1,skin:{id:'nebula',at:1},tweaks:{}},version=1,sequence=0,releaseComplete;
  const uploads=new Map(),files=new Map();
  const context=await browser.newContext({viewport:{width:1440,height:960},serviceWorkers:'block'});
  await context.routeWebSocket('**/*',ws=>ws.close());
  await context.addInitScript(()=>{
   if(window!==window.top)return;
   for(const[k,v]of Object.entries({'wos.coached':'true','wos.tour.v1':'true','wos.welcome.v1':'done','wos.skin':'nebula','wos.shell':'desktop'}))if(localStorage.getItem(k)===null)localStorage.setItem(k,v);
   window.wallDraws=[];window.wallPaints={};
   const covers=new WeakMap(),draw=CanvasRenderingContext2D.prototype.drawImage;
   CanvasRenderingContext2D.prototype.drawImage=function(im,...args){
    if(im instanceof HTMLImageElement&&im.src.includes('/wizard/files/')){
     const row={src:im.src,args,width:this.canvas.width,height:this.canvas.height,nw:im.naturalWidth,nh:im.naturalHeight};
     covers.set(this.canvas,row);wallDraws.push(row);
    }
    // WIZ memoizes cover canvases. Observe their actual on-screen reuse, not
    // the last image decoded (which can belong to the previous orientation).
    if(this.canvas.matches('.skin-bg')){
     const cover=covers.get(im);
     wallPaints[this.canvas.id]=cover?{...cover,targetWidth:this.canvas.width,targetHeight:this.canvas.height}:null;
    }
    return Reflect.apply(draw,this,[im,...args]);
   };
  });
  await context.route('**/*',async r=>{
   const q=r.request(),u=new URL(q.url()),m=q.method(),p=u.pathname;
   if(u.origin!==origin){requests.push({m,p,external:true});return r.abort();}
   if(p==='/wizard/v1/pages/wizard-look/look.json'){
    if(m==='PUT'){const b=q.postDataJSON();assert.equal(b.version,String(version));look=JSON.parse(b.text);version++;return r.fulfill({json:{version:String(version)}});}
    return r.fulfill({json:{exists:true,text:JSON.stringify(look),version:String(version)}});
   }
   if(p==='/wizard/v1/uploads'&&m==='POST'){
    const body=q.postDataJSON(),id='upload-'+(++sequence);uploads.set(id,{body,offset:0,data:[]});
    requests.push({m,p,accepted:true});return r.fulfill({json:{upload_id:id,offset:0,status:'uploading',chunk_bytes:1048576}});
   }
   const match=p.match(/^\/wizard\/v1\/uploads\/(upload-\d+)(\/complete)?$/);
   if(match){const up=uploads.get(match[1]);assert.ok(up);
    if(m==='PATCH'){const b=q.postDataBuffer();up.data.push(b);up.offset+=b.length;return r.fulfill({status:204,headers:{'Upload-Offset':String(up.offset)}});}
    if(m==='POST'&&match[2]){
     assert.equal(up.offset,up.body.bytes);
     if(sequence===1)await new Promise(resolve=>{releaseComplete=resolve;});
     const id='file-'+match[1];files.set(id,Buffer.concat(up.data));
     return r.fulfill({json:{file:{id,name:up.body.filename,mime:up.body.mime,bytes:up.body.bytes}}});
    }
    return r.fulfill({json:{offset:up.offset,status:'uploading'}});
   }
   const image=p.match(/^\/wizard\/files\/([^/]+)\/content$/);
   if(image){assert.ok(files.has(image[1]));return r.fulfill({contentType:'image/webp',body:files.get(image[1])});}
   if(!['GET','HEAD'].includes(m)){requests.push({m,p,refused:true});return r.fulfill({status:405,json:{error:'Synthetic fixture refuses this write'}});}
   if(p==='/wizard/v1/bootstrap')return r.fulfill({json:{bootstrap:1,settings:{agent:{name:'Wizard'},owner:{name:'Synthetic owner'}},capabilities:{resumable_uploads:true,files:true},endpoints:{uploads:'/wizard/v1/uploads'}}});
   if(p==='/wizard/v1/ui-preferences')return r.fulfill({json:{migrations:{'launcher-seed-v1':true}}});
   if(p==='/wizard/v1/agents')return r.fulfill({json:{agents:[{id:'hermes',is_default:true,label:'Wizard',privacy:'standard',status:'running'}]}});
   if(p.startsWith('/wizard/'))return r.fulfill({json:ownerRead(p)});
   if(p.startsWith(prefix)){
    const file=path.resolve(root,p.slice(prefix.length)||'index.html');
    if(file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return r.fulfill({path:file});
   }
   return r.fulfill({status:404,body:''});
  });
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const ready=async()=>{await page.waitForFunction(()=>window.__wux&&window.WosSettings&&window.WizUploads?.supported()&&!WosExperience.state.busy);await page.evaluate(()=>document.getElementById('wosWelcome')?.remove());};
  const lookPage=async()=>{await page.evaluate(()=>__wux.openSettings('skin'));await page.locator('[data-bgpick="custom"]:visible').waitFor();};
  const choose=async(selector,file)=>{const choosing=page.waitForEvent('filechooser');await page.locator(selector).click();await(await choosing).setFiles(file);};
  await page.goto(origin+prefix+'desktop.html');await ready();await lookPage();
  await choose('[data-bgpick="custom"]',wide);
  await page.waitForFunction(()=>document.querySelector('[data-background-status]')?.textContent.includes('Uploading'));
  assert.equal(await page.evaluate(()=>WosSkin.wallpaper),'living','upload is pending, not falsely saved');
  while(!releaseComplete)await new Promise(resolve=>setTimeout(resolve,20));releaseComplete();
  await page.waitForFunction(()=>WosSkin.wallpaper==='custom');
  await page.waitForFunction(()=>wallDraws.length>0);
  await choose('[data-background-portrait]',tall);await page.waitForFunction(()=>!!WosSkin.desktopBackdrop.tall);
  await page.evaluate(()=>WosLookSync.current.sync());
  assert.equal(look.desktopBackdrop.id,'custom');assert.ok(look.desktopBackdrop.tall);
  await page.reload();await ready();assert.equal(await page.evaluate(()=>WosSkin.wallpaper),'custom','reload persists');
  for(const skin of ['nebula','grove']){
   await lookPage();await page.locator(`[data-skinpick="${skin}"]`).click();
   await page.waitForFunction(s=>WosSkin.current===s,skin);await page.waitForTimeout(700);
   assert.equal(await page.locator('[data-bgpick="custom"]').getAttribute('aria-pressed'),'true');
   await page.locator('[data-background-portrait]').scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(out,`${skin}-look.png`)});
   await page.evaluate(()=>__wux.closeSettings());
   // The same real backdrop engine renders wide and tall without stretching or gaps.
   for(const viewport of [{width:1440,height:960},{width:720,height:1120}]){
    await page.setViewportSize(viewport);await page.waitForTimeout(700);
    const painted=()=>{
     const canvas=[...document.querySelectorAll('.skin-bg')].filter(c=>Number(getComputedStyle(c).opacity)>.99).at(-1);
     const row=canvas&&wallPaints[canvas.id],dpr=Math.min(devicePixelRatio||1,1.5);
     return row&&row.width===(innerWidth*dpr|0)&&row.height===(innerHeight*dpr|0)&&row.targetWidth===row.width&&row.targetHeight===row.height?row:null;
    };
    await page.waitForFunction(painted);
    const row=await page.evaluate(painted);assert.ok(row);
    const k=Math.max(row.width/row.nw,row.height/row.nh),[x,y,w,h]=row.args;
    assert.ok(Math.abs(w-row.nw*k)<.01&&Math.abs(h-row.nh*k)<.01,'cover retains image aspect ratio');
    assert.ok(w>=row.width-.01&&h>=row.height-.01&&x<=.01&&y<=.01,'cover fills canvas');
    assert.ok(row.src.endsWith(viewport.height>viewport.width*1.1?look.desktopBackdrop.tall+'/content':look.desktopBackdrop.wide+'/content'),'correct orientation asset');
    results.push({skin,viewport,cover:row});
    await page.screenshot({path:path.join(out,`${skin}-${viewport.width}-shell.png`)});
   }
   await page.setViewportSize({width:1440,height:960});
   // Existing opaque Settings text panel must not change a pixel when the backdrop changes.
   await lookPage();await page.waitForTimeout(500);
   const pane=page.locator('#settingsBody .st-page:visible').first();await pane.waitFor();
   const rect=await pane.boundingBox();const clip={x:rect.x+8,y:rect.y+8,width:Math.min(200,rect.width-16),height:80};
   const before=await page.screenshot({clip,animations:'disabled'});
   await page.evaluate(()=>WosSkin.setWallpaper('lake'));await page.waitForTimeout(350);
   const after=await page.screenshot({clip,animations:'disabled'});assert.deepEqual(after,before,'opaque Settings text panel pixels independent of backdrop');
   await page.evaluate(()=>WosSkin.setWallpaper('custom'));
  }
  // Existing built-ins still selectable and the custom asset survives switching away and back.
  await lookPage();await page.locator('[data-bgpick="lake"]').click();assert.equal(await page.evaluate(()=>WosSkin.wallpaper),'lake');
  await page.locator('[data-bgpick="custom"]').click();assert.equal(await page.evaluate(()=>WosSkin.wallpaper),'custom');
  assert.equal(await page.evaluate(()=>WosSkin.current),'grove');
  assert.ok(requests.every(r=>!r.external&&(r.accepted||r.refused)));
  assert.deepEqual(errors,[]);await context.close();
 }catch(e){if(page){try{await page.screenshot({path:path.join(out,'failure.png')});fs.writeFileSync(path.join(out,'failure.html'),await page.content());}catch{}}throw e;
 }finally{await browser.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,requests,errors},null,2));}
 assert.equal(results.length,4);console.log('PASS custom-background',JSON.stringify(results));
})().catch(e=>{console.error(e);process.exit(1);});
