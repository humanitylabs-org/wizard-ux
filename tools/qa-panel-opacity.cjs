// QA only. No opacity/fill overrides except an explicitly labelled failing positive control.
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const assert = require('node:assert/strict');
function decodePNG(buf) {
  assert.equal(buf.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  let w,h,type,depth,interlace; const chunks=[];
  for(let i=8;i<buf.length;) {
    const n=buf.readUInt32BE(i), t=buf.toString('ascii',i+4,i+8), b=buf.subarray(i+8,i+8+n); i+=n+12;
    if(t==='IHDR'){w=b.readUInt32BE(0);h=b.readUInt32BE(4);depth=b[8];type=b[9];interlace=b[12];}
    if(t==='IDAT')chunks.push(b); if(t==='IEND')break;
  }
  assert.equal(depth,8);assert.equal(interlace,0);assert([2,6].includes(type),'8-bit RGB/RGBA PNG required');
  const channels=type===6?4:3, stride=w*channels, raw=zlib.inflateSync(Buffer.concat(chunks));
  assert.equal(raw.length,(stride+1)*h);
  const rgb=Buffer.alloc(stride*h), rgba=Buffer.alloc(w*h*4);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<h;y++) {
    const filter=raw[y*(stride+1)];assert(filter<=4);
    for(let x=0;x<stride;x++) {
      const a=x>=channels?rgb[y*stride+x-channels]:0,b=y?rgb[(y-1)*stride+x]:0,c=y&&x>=channels?rgb[(y-1)*stride+x-channels]:0;
      rgb[y*stride+x]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;
    }
    for(let x=0;x<w;x++){for(let c=0;c<3;c++)rgba[(y*w+x)*4+c]=rgb[y*stride+x*channels+c];rgba[(y*w+x)*4+3]=channels===4?rgb[y*stride+x*channels+3]:255;}
  }
  return {width:w,height:h,data:rgba};
}
function mismatch(a,b,inside=()=>true) {
  assert.equal(a.width,b.width);assert.equal(a.height,b.height);
  let compared=0,count=0,minX=Infinity,minY=Infinity,maxX=-1,maxY=-1;const first=[];
  for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++) {
    if(!inside(x,y))continue;compared++;const i=(y*a.width+x)*4;
    if(a.data.subarray(i,i+4).equals(b.data.subarray(i,i+4)))continue;
    count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    if(first.length<10)first.push({x,y,before:[...a.data.subarray(i,i+4)],after:[...b.data.subarray(i,i+4)]});
  }
  assert(compared>0,'empty pixel ROI');return {compared,mismatches:count,bounds:count?{minX,minY,maxX,maxY}:null,first};
}
async function frames(p) {await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function provePanelOpaque(p,{shots,name,legacyProbe=false}) {
  assert(shots,'retain opacity evidence');fs.mkdirSync(shots,{recursive:true});
  const report={name,coordinateSpace:'viewport physical pixels, screenshots scale:device',captures:{},checks:[]};
  const save=()=>fs.writeFileSync(path.join(shots,name+'-opacity.json'),JSON.stringify(report,null,2)+'\n');
  const pass=(ok,label)=>{assert(ok,label);report.checks.push(label);};
  const sheet=p.locator('#overview.open.ov-pill .ov-sheet');
  const capture=async label=>{await frames(p);if(report.geometry){const b=await sheet.boundingBox();assert(b&&['x','y','width','height'].every(k=>b[k]===report.geometry[k]),'capture geometry changed: '+label);}const b=await p.screenshot({scale:'device',caret:'hide'});fs.writeFileSync(path.join(shots,name+'-'+label+'.png'),b);report.captures[label]=name+'-'+label+'.png';return decodePNG(b);};
  let originalStyle;
  try {
    await p.evaluate(()=>document.fonts.ready);
    await p.waitForFunction(()=>{
      const e=document.querySelector('#overview.open .ov-sheet');if(!e)return false;
      return !document.getElementById('overview').getAnimations({subtree:true}).some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity);
    });
    await frames(p);
    const geometry=await sheet.evaluate(e=>{
      const s=getComputedStyle(e),r=e.getBoundingClientRect(),rect=n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom};};
      return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,dpr:devicePixelRatio,radius:parseFloat(s.borderTopLeftRadius),paddingBottom:parseFloat(s.paddingBottom),opacity:s.opacity,transform:s.transform,clip:s.clipPath,background:s.backgroundColor,image:s.backgroundImage,excluded:[...e.querySelectorAll('.ov-scroll,.ov-close')].map(rect)};
    });report.geometry=geometry;
    pass(geometry.opacity==='1'&&geometry.transform==='none','settled visible panel is not normalized');
    pass(geometry.image==='none','homogeneous panel fill permits background-padding ROI');
    const inset=geometry.radius+3;
    const roi={left:Math.ceil((geometry.x+inset)*geometry.dpr),right:Math.floor((geometry.right-inset)*geometry.dpr),top:Math.ceil((geometry.bottom-geometry.paddingBottom+5)*geometry.dpr),bottom:Math.floor((geometry.bottom-inset)*geometry.dpr)};
    report.roi=roi;report.exclusions=geometry.excluded;
    const inside=(x,y)=>x>=roi.left&&x<roi.right&&y>=roi.top&&y<roi.bottom&&!geometry.excluded.some(r=>x>=(r.x-2)*geometry.dpr&&x<(r.right+2)*geometry.dpr&&y>=(r.y-2)*geometry.dpr&&y<(r.bottom+2)*geometry.dpr);
    const compare=(a,b)=>mismatch(a,b,inside);
    if(legacyProbe) {
      // Preserve the r2 comparison and its no-mutation control before QA stabilization.
      const a=await capture('r2-control-a'),a2=await capture('r2-control-b');
      await p.evaluate(()=>{const n=document.createElement('div');n.id='qa-r2-loud';n.style='position:fixed;inset:0;z-index:1;color:red;background:lime;font-size:48px;pointer-events:none';n.textContent='LOUD TEXT '.repeat(100);document.getElementById('device').append(n);});
      const b=await capture('r2-loud');await p.evaluate(()=>document.getElementById('qa-r2-loud').remove());const c=await capture('r2-restored');
      report.r2={controlFull:mismatch(a,a2),changedFull:mismatch(a,b),restoredFull:mismatch(a,c),controlROI:compare(a,a2),changedROI:compare(a,b),restoredROI:compare(a,c)};
      // Full element bounding box includes correctly transparent rounded corners.
      const bounds=(x,y)=>x>=Math.floor(geometry.x*geometry.dpr)&&x<Math.ceil(geometry.right*geometry.dpr)&&y>=Math.floor(geometry.y*geometry.dpr)&&y<Math.ceil(geometry.bottom*geometry.dpr);
      report.r2.sheetBounds=mismatch(a,b,bounds);report.r2.controlSheetBounds=mismatch(a,a2,bounds);
      report.r2.classification=report.r2.controlROI.mismatches?'unstable unmodified interior':report.r2.changedROI.mismatches?'interior changed: inspect stacking/opacity':report.r2.sheetBounds.mismatches?'bounding-box-only change, not background-interior leakage':'old probe did not reproduce a decoded pixel difference';save();
    }
    originalStyle=await sheet.getAttribute('style');
    report.stabilization=await sheet.evaluate(e=>{
      const paused=[];window.__qaOpacityPaused=[];for(const a of document.getAnimations())if(a.playState==='running'&&a.effect.getTiming().iterations===Infinity){paused.push({name:a.animationName,target:a.effect.target?.id||a.effect.target?.className});window.__qaOpacityPaused.push(a);a.pause();}
      e.style.willChange='transform';document.activeElement?.blur();return {paused,retainedRasterLayer:true};
    });
    // Absolute sibling, same overview stacking context, z=0 followed by sheet's
    // clip-path stacking context at auto/0. No foreground overlap, scrim alteration or reflow.
    report.stacking=await sheet.evaluate(e=>{
      const n=document.createElement('div');n.id='qa-opacity-behind';n.style='position:absolute;inset:0;z-index:0;padding:16px;box-sizing:border-box;color:red;background:var(--bg);font:900 48px/56px sans-serif;pointer-events:auto';e.before(n);
      const chain=[];for(let a=e;a;a=a.parentElement){const s=getComputedStyle(a);chain.push({tag:a.tagName,id:a.id,cls:a.className,z:s.zIndex,position:s.position,opacity:s.opacity,transform:s.transform,clip:s.clipPath,filter:s.filter,blend:s.mixBlendMode});if(a.id==='device')break;}return chain;
    });
    pass(report.stacking.every(s=>s.opacity==='1'&&s.filter==='none'&&s.blend==='normal'),'panel and ancestors have no opacity/filter/blend leak');
    const a=await capture('bare-a'),a2=await capture('bare-b');
    report.control=compare(a,a2);
    pass(report.control.compared>=800*geometry.dpr**2&&report.control.compared>=(roi.right-roi.left)*(roi.bottom-roi.top)*.5,'nonempty substantial background-only ROI');
    pass(report.control.mismatches===0,'no-background-change control is pixel-stable');
    await p.evaluate(()=>{const n=document.getElementById('qa-opacity-behind');n.style.background='lime';n.textContent='LOUD TEXT '.repeat(150);});
    report.hitTest=await p.evaluate(({roi,dpr})=>{
      const e=document.querySelector('#overview .ov-sheet'),n=document.getElementById('qa-opacity-behind'),pt={x:(roi.left+roi.right)/2/dpr,y:(roi.top+roi.bottom)/2/dpr};
      const stack=document.elementsFromPoint(pt.x,pt.y),si=stack.findIndex(x=>x===e||e.contains(x)),bi=stack.indexOf(n),outer=document.getElementById('overview').getBoundingClientRect();
      const outside={x:Math.ceil(outer.left)+4,y:Math.ceil(outer.top)+4};
      return {point:pt,sheetIndex:si,behindIndex:bi,order:stack.map(x=>x.id||x.className||x.tagName),outside,outsideTop:document.elementFromPoint(outside.x,outside.y)?.id,previousSibling:e.previousElementSibling===n,behindParent:n.parentElement.id};
    },{roi,dpr:geometry.dpr});
    pass(report.hitTest.sheetIndex>=0&&report.hitTest.behindIndex>report.hitTest.sheetIndex&&report.hitTest.previousSibling&&report.hitTest.behindParent==='overview','loud sibling is immediately beneath sheet in same stacking context');
    pass(report.hitTest.outsideTop==='qa-opacity-behind','loud sibling is unobstructed outside panel');
    const b=await capture('loud');report.changed=compare(a,b);
    const outside=report.hitTest.outside,ox=Math.floor(outside.x*geometry.dpr),oy=Math.floor(outside.y*geometry.dpr),oi=(oy*b.width+ox)*4;
    report.outsidePixel=[...b.data.subarray(oi,oi+4)];pass(JSON.stringify(report.outsidePixel)==='[0,255,0,255]','loud backdrop is actually painted lime');
    await p.evaluate(()=>{const n=document.getElementById('qa-opacity-behind');n.style.background='var(--bg)';n.textContent='';});const c=await capture('restored');report.restored=compare(a,c);
    // Positive control uses original winning owner material; never the passing fill.
    const control=await p.addStyleTag({content:'html[data-skin]:not([data-shell="desktop"]) .ov.ov-pill .ov-sheet {background:color-mix(in srgb,var(--bg) 94%,transparent)!important;-webkit-backdrop-filter:blur(26px) saturate(1.4)!important;backdrop-filter:blur(26px) saturate(1.4)!important;}'});
    const pa=await capture('translucent-bare'),pa2=await capture('translucent-control');
    await p.evaluate(()=>{const n=document.getElementById('qa-opacity-behind');n.style.background='lime';n.textContent='LOUD TEXT '.repeat(150);});const pb=await capture('translucent-loud');
    report.positive={control:compare(pa,pa2),changed:compare(pa,pb)};
    await control.evaluate(e=>e.remove());await p.evaluate(()=>{const n=document.getElementById('qa-opacity-behind');n.style.background='var(--bg)';n.textContent='';});
    pass(report.positive.control.mismatches===0,'translucent positive-control bare pair is stable');
    pass(report.positive.changed.mismatches>=1000,'original translucent material is detected by exact same ROI');
    pass(report.restored.mismatches===0,'removing loud backdrop restores identical interior');
    pass(report.changed.mismatches===0,'opaque panel interior pixels identical over loud text');
    report.complete=true;save();console.log('OPACITY',JSON.stringify(report));return report;
  } catch(e) {report.error=String(e);save();throw e;}
  finally {
    await p.evaluate(()=>{document.getElementById('qa-opacity-behind')?.remove();document.getElementById('qa-r2-loud')?.remove();for(const a of window.__qaOpacityPaused||[])a.play();delete window.__qaOpacityPaused;});
    if(originalStyle!==undefined)await sheet.evaluate((e,s)=>s===null?e.removeAttribute('style'):e.setAttribute('style',s),originalStyle);
  }
}
module.exports={decodePNG,mismatch,provePanelOpaque};
