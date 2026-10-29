'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const modes = ['idle', 'listen', 'paused', 'think', 'type', 'typing', 'command', 'done'];
const variants = ['candidate', 'baseline', 'published']; // Never let a control starve the candidate.
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
function metrics(s) {
  if (!s || s.data.length !== s.w * s.h * 4) throw Error('missing/truncated RGBA');
  const bands = Array.from({length: 5}, () => ({n: 0, white: 0, saturated: 0, sum: 0, colors: new Set()}));
  let n = 0, white = 0; const colors = new Set();
  for (let y=0;y<s.h;y++) for(let x=0;x<s.w;x++) {
    const r = Math.hypot((x+.5)*2/s.w-1,(y+.5)*2/s.h-1), i=(y*s.w+x)*4;
    const rgb=s.data.slice(i,i+3), w=rgb.every(v=>v>235), sat=Math.max(...rgb)-Math.min(...rgb)>40;
    if(r<.5) { n++; if(w)white++; colors.add(rgb.join(',')); }
    const b=bands[Math.floor(r/.128)]; // Five equal-radius bands across R=.64 (not area bands).
    if(b) {b.n++; b.white+=+w; b.saturated+=+sat; b.sum+=rgb.reduce((a,v)=>a+v,0)/3; b.colors.add(rgb.join(','));}
  }
  const radial=bands.map(b=>({n:b.n,whiteFraction:b.white/b.n,saturatedFraction:b.saturated/b.n,mean:b.sum/b.n,colors:b.colors.size}));
  // Field evidence is white across the sphere, not merely a central highlight.
  // A majority-white middle AND outer interior identifies a broad disc; tiny cyan center is allowed.
  const broadWhiteDisc=radial[2].whiteFraction>.5 && radial[3].whiteFraction>.5;
  return {colors:colors.size,whiteFraction:white/n,legacyQuarterGate:white/n<.25,radial,
    saturatedCenterFraction:radial[0].saturatedFraction,broadWhiteDisc,
    noncollapsed:colors.size>100 && !broadWhiteDisc};
}
function uniformHistory(presets, mode, size) {
  const cur=structuredClone(presets.idle), dt=Array(15).fill(.1), target=presets[mode];
  let lvl=0; const level=['paused','idle'].includes(mode)?0:.3;
  for(const step of dt){const k=1-Math.pow(.0015,step);
    for(const key of ['energy','spin','ring','core'])cur[key]+=(target[key]-cur[key])*k;
    for(const key of ['a','b','c'])for(let i=0;i<3;i++)cur[key][i]+=(target[key][i]-cur[key][i])*k;
    lvl+=(level-lvl)*(1-Math.pow(.00002,step));}
  return {history:{initial:'idle',target:mode,dtSeconds:dt,level,press:0,shaderTimeSeconds:8},
    uniforms:{res:[size*2,size*2],t:8,lvl,energy:cur.energy,spin:cur.spin,ring:cur.ring,core:cur.core,press:0,R:.64,gloss:1,cA:cur.a,cB:cur.b,cC:cur.c}};
}
function png(s) {
  function crc(b) {let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
  function chunk(name,data){const n=Buffer.from(name),b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length);n.copy(b,4);data.copy(b,8);b.writeUInt32BE(crc(Buffer.concat([n,data])),8+data.length);return b;}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(s.w);ihdr.writeUInt32BE(s.h,4);ihdr[8]=8;ihdr[9]=6;
  const data=Buffer.alloc(s.h*(1+s.w*4));for(let y=0;y<s.h;y++)Buffer.from(s.data.slice((s.h-y-1)*s.w*4,(s.h-y)*s.w*4)).copy(data,y*(1+s.w*4)+1);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(data)),chunk('IEND',Buffer.alloc(0))]);
}
class Collector {
  constructor(out, expected){this.out=out;fs.mkdirSync(out,{recursive:true});this.result={scope:'synthetic Chromium/SwiftShader, not field-driver/native/signing proof',expected,cases:[],pass:false};this.save();}
  save(){fs.writeFileSync(path.join(this.out,'result.json'),JSON.stringify(this.result,null,2)+'\n');}
  artifact(id,s){const stem=id.replaceAll('/','-'),raw=Buffer.from(s.data),image=png(s);
    fs.writeFileSync(path.join(this.out,stem+'.rgba'),raw);fs.writeFileSync(path.join(this.out,stem+'.png'),image);
    const info={...s,data:undefined,rgba:stem+'.rgba',png:stem+'.png',rgbaSha256:sha(raw),pngSha256:sha(image),metrics:metrics(s)};
    fs.writeFileSync(path.join(this.out,stem+'.json'),JSON.stringify(info,null,2)+'\n');return info;}
  async run(id, action, fallback){const record={id,pass:false,checks:[],artifacts:[]};this.result.cases.push(record);this.save();
    const check=(condition,message,actual)=>{record.checks.push({pass:!!condition,message,actual});this.save();};
    try{await action(record,check);record.pass=record.checks.length>0&&record.checks.every(c=>c.pass);}
    catch(e){record.error=e.stack;}
    finally{if(!record.pass&&fallback)try{await fallback(record);}catch(e){record.captureError=e.stack;}this.save();}
    return record;}
  finish(){const actual=this.result.cases.map(c=>c.id);this.result.complete=actual.length===this.result.expected.length&&new Set(actual).size===actual.length&&this.result.expected.every(id=>actual.includes(id));this.result.pass=this.result.complete&&this.result.cases.every(c=>c.pass);this.save();return this.result.pass;}
}
function expectedCases(){const ids=[];for(const v of variants)for(const size of [64,76]){
  for(const mode of modes)ids.push(`${v}/${size}/controlled/${mode}`,`${v}/${size}/realtime/${mode}`);
  ids.push(`${v}/${size}/idle`);for(const cycle of [1,2])ids.push(`${v}/${size}/restore/${cycle}`);
  if(v==='candidate')ids.push(`${v}/${size}/sleep-restore`);
}for(const size of [64,76])for(const mode of modes)ids.push(`comparison/${size}/${mode}`);return ids;}
module.exports={modes,variants,sha,metrics,uniformHistory,png,Collector,expectedCases};
