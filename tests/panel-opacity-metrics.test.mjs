import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {decodePNG,mismatch}=require('../tools/qa-panel-opacity.cjs');
const {checks,matrix}=require('../tools/qa-legacy-overlay-contract.cjs');
// Independent 2x2 fixture; CRCs are immaterial to the decoder (Chromium supplies validated PNGs).
function png(filter,channels=4){
  const chunk=(name,b)=>{const n=Buffer.alloc(4);n.writeUInt32BE(b.length);return Buffer.concat([n,Buffer.from(name),b,Buffer.alloc(4)]);};
  const pixels=[[30,60,90,255,120,150,180,255],[50,80,110,255,140,170,200,255]].map(row=>channels===4?row:row.filter((_,i)=>i%4!==3));
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);if(pa<=pb&&pa<=pc)return a;if(pb<=pc)return b;return c;};
  const raw=[];for(let y=0;y<2;y++){raw.push(filter);for(let x=0;x<2*channels;x++){const a=x>=channels?pixels[y][x-channels]:0,b=y?pixels[y-1][x]:0,c=y&&x>=channels?pixels[y-1][x-channels]:0;raw.push((pixels[y][x]-[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter]+256)%256);}}
  const h=Buffer.alloc(13);h.writeUInt32BE(2,0);h.writeUInt32BE(2,4);h[8]=8;h[9]=channels===4?6:2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.from(raw))),chunk('IEND',Buffer.alloc(0))]);
}
for(const filter of [0,1,2,3,4])test(`decode Chromium PNG filter ${filter} as exact RGBA`,()=>{
  for(const channels of [3,4]){const a=decodePNG(png(filter,channels));assert.equal(a.width,2);assert.equal(a.height,2);assert.deepEqual([...a.data],[30,60,90,255,120,150,180,255,50,80,110,255,140,170,200,255]);}
});
test('zero tolerance reports count, device coordinates and colours',()=>{const a=decodePNG(png(0)),b=decodePNG(png(1));b.data[12]++;const d=mismatch(a,b);assert.equal(d.mismatches,1);assert.deepEqual(d.bounds,{minX:1,minY:1,maxX:1,maxY:1});assert.equal(d.first[0].after[0],141);assert.equal(mismatch(a,b,(x,y)=>y===0).mismatches,0);assert.throws(()=>mismatch(a,b,()=>false),/empty pixel ROI/);});
test('PNG encoding differences are not pixel differences',()=>{const a=png(0),b=png(4);assert(!a.equals(b));assert.equal(mismatch(decodePNG(a),decodePNG(b)).mismatches,0);});
test('acceptance contract includes every skin/radial/two-orb obligation',()=>{const full=checks();assert.equal(new Set(matrix().map(x=>x.name)).size,matrix().length);for(const c of matrix())assert(full.includes(`${c.skin} radial:${c.radial} two-orbs:${c.two}: actual Look -> Miguel selector`));assert(full.includes('no agent runs or new sessions'));assert(checks(true).includes('baseline palette switch silently clears persisted active pointer and returns Apps'));assert(checks(false,true).length<full.length);assert.equal(full.filter(x=>x==='selector panel pixels unchanged over loud text').length,matrix().length);});
