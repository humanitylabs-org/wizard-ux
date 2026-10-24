// Renders the Wizard OS PWA icons from the supplied designer hat (web/brand/wizard-mark-white.png).
// Usage (repo root): node tools/brand/render-pwa-icons.cjs  -> web/icon-512.png, icon-192.png, apple-touch-icon.png, favicon.ico
const { chromium } = require('playwright'); const fs=require('fs'); const path=require('path');
const ROOT=path.join(__dirname,'..','..'), WEB=path.join(ROOT,'web');
const mark='data:image/png;base64,'+fs.readFileSync(path.join(WEB,'brand','wizard-mark-white.png')).toString('base64');
const html=`<html><body style="margin:0;background:transparent"><canvas id=c></canvas><script>
const UV='#7A5CFF', VOID='#0B0A10', ETCH='#1D1A24';
function rr(x,a,b,w,h,r){x.beginPath();x.moveTo(a+r,b);x.arcTo(a+w,b,a+w,b+h,r);x.arcTo(a+w,b+h,a,b+h,r);x.arcTo(a,b+h,a,b,r);x.arcTo(a,b,a+w,b,r);x.closePath();}
window.draw=async(S,opts)=>{const im=new Image();im.src='${mark}';await im.decode();
 const c=document.getElementById('c');c.width=c.height=S;const x=c.getContext('2d');x.clearRect(0,0,S,S);
 const full=opts.full; // full-bleed square (maskable/apple) vs rounded tile (favicon)
 if(full){x.fillStyle=VOID;x.fillRect(0,0,S,S)}else{rr(x,0,0,S,S,S*0.22);x.fillStyle=VOID;x.fill();}
 x.save(); if(!full){rr(x,0,0,S,S,S*0.22);x.clip();}
 // experimental: faint dotted lab grid + UV glow behind the mark
 if(S>=96){const g=S/16;x.fillStyle='rgba(122,92,255,0.22)';for(let i=1;i<16;i++)for(let j=1;j<16;j++){x.beginPath();x.arc(i*g,j*g,Math.max(0.8,S/420),0,7);x.fill();}}
 const rg=x.createRadialGradient(S*.5,S*.56,0,S*.5,S*.56,S*.48);rg.addColorStop(0,'rgba(122,92,255,0.45)');rg.addColorStop(1,'rgba(122,92,255,0)');x.fillStyle=rg;x.fillRect(0,0,S,S);
 // diagonal UV "test" band in the top-right corner (inside maskable safe area edge)
 x.restore();
 // mark: UV->white gradient, scaled into safe zone
 const mh=S*(opts.small?0.74:0.56), mw=mh*im.width/im.height, mx=(S-mw)/2, my=(S-mh)/2+S*0.01;
 const o=document.createElement('canvas');o.width=o.height=S;const ox=o.getContext('2d');ox.drawImage(im,mx,my,mw,mh);ox.globalCompositeOperation='source-in';
 const lg=ox.createLinearGradient(0,my,0,my+mh);lg.addColorStop(0,'#FFFFFF');lg.addColorStop(1,UV);ox.fillStyle=opts.small?UV:lg;ox.fillRect(0,0,S,S);
 x.drawImage(o,0,0);
 // badge: small UV pill dot at upper-right = "lab" marker
 if(false){const r=S*0.075, cx=S*0.73, cy=S*0.27;x.beginPath();x.arc(cx,cy,r,0,7);x.fillStyle=UV;x.fill();x.lineWidth=S*0.018;x.strokeStyle=VOID;x.stroke();}
 return c.toDataURL('image/png');};
</script></body></html>`;
(async()=>{const b=await chromium.launch({channel:'chrome'});const p=await b.newPage();await p.setContent(html);
const out={};const jobs=[['icon-512.png',512,{full:true}],['icon-192.png',192,{full:true}],['apple-touch-icon.png',180,{full:true}],['fav-64.png',64,{small:true}],['fav-32.png',32,{small:true}],['fav-16.png',16,{small:true}]];
for(const [n,S,o] of jobs){const d=await p.evaluate(([S,o])=>draw(S,o),[S,o]);out[n]=(Buffer.from(d.split(',')[1],'base64'));}
await b.close();
for(const n of ['icon-512.png','icon-192.png','apple-touch-icon.png'])fs.writeFileSync(path.join(WEB,n),out[n]);
// favicon.ico: PNG-in-ICO with 16/32/64 frames
const fr=['fav-16.png','fav-32.png','fav-64.png'].map(n=>out[n]),sz=[16,32,64];const h=Buffer.alloc(6+16*fr.length);h.writeUInt16LE(0,0);h.writeUInt16LE(1,2);h.writeUInt16LE(fr.length,4);let off=h.length;fr.forEach((b,i)=>{const e=6+16*i;h.writeUInt8(sz[i]%256,e);h.writeUInt8(sz[i]%256,e+1);h.writeUInt16LE(1,e+4);h.writeUInt16LE(32,e+6);h.writeUInt32LE(b.length,e+8);h.writeUInt32LE(off,e+12);off+=b.length;});
fs.writeFileSync(path.join(WEB,'favicon.ico'),Buffer.concat([h,...fr]));console.log('ok')})();
