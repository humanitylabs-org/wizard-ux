import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(process.env.ORB_SOURCE || new URL('../web/core/sigils.js', import.meta.url),'utf8');
const expose = source.replace('  window.WizSigil =', '  window.whitePixels = whitePixels; window.WizSigil =');
function load() {
  const window = { WizCore: { appLogo: id => `/wizard-os-home/store-data/app-logo/${id}?v=0123456789abcdef` } };
  vm.runInNewContext(expose,{window,Uint8ClampedArray}); return window;
}
function tile(bg,fg,transparent = false) {
  const data = new Uint8ClampedArray(16*16*4);
  for(let y=0;y<16;y++)for(let x=0;x<16;x++) {
    const inside=x>=5&&x<11&&y>=4&&y<12,i=(y*16+x)*4;
    data.set([...(inside?fg:bg),transparent&&!inside?0:255],i);
  }
  return data;
}
for(const [name,bg,fg,transparent] of [
  ['Airlock green lock on black',[13,21,18],[76,204,163],false],
  ['app without monochrome asset',[12,12,20],[240,80,120],false],
  ['dark glyph on white tile',[255,255,255],[20,20,30],false],
  ['transparent coloured asset',[0,0,0],[50,200,100],true],
]) test(`James: orb is white without a dark square — ${name}`,()=>{
  const w=load(); assert.equal(typeof w.whitePixels,'function');
  const output=w.whitePixels(tile(bg,fg,transparent),16,16);
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    const i=(y*16+x)*4,inside=x>=5&&x<11&&y>=4&&y<12;
    assert.equal(output[i+3],inside?255:0,'background including glyph cutouts is transparent');
    assert.deepEqual([...output.slice(i,i+3)],[255,255,255],'only white, never source colour');
  }
});
test('transparent round glyph touching all four edges keeps its foreground',()=>{
  const data=new Uint8ClampedArray(32*32*4);
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)if(Math.hypot(x-15.5,y-15.5)<16)data.set([70,200,160,255],(y*32+x)*4);
  const output=load().whitePixels(data,32,32);
  assert.equal(output[(16*32+16)*4+3],255);
  for(let i=3;i<data.length;i+=4)assert.equal(output[i],data[i]);
});
test('ordinary launcher/logo icons retain their exact colour markup',()=>{
  const {WizSigil:S}=load();
  assert.match(S.html({id:'airlock'}),/class="sglogo"/);
  assert.doesNotMatch(S.html({id:'airlock'}),/orb-glyph|sg-orb/);
  assert.match(S.html({id:'notes'}),/sgi sg-notes/);
  assert.match(S.html({id:'wizard-claude'}),/sgb-claude/);
});
test('orb normalizer is available and scoped to phone orb plus desktop app identity',()=>{
  assert.equal(typeof load().WizSigil.orb,'function');
  const phone=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
  assert.match(phone,/el\.innerHTML = h; window\.WizSigil\.orb\(el\)/);
  const desktop=fs.readFileSync(new URL('../web/layouts/ai-apps/desktop.js',import.meta.url),'utf8');
  assert.match(desktop,/paintOrbIdentity\(h\.app\)/);
  assert.match(desktop,/S\.orb\(micG\)/);
});
test('regenerated sigil renderer retains the orb correction',()=>{
  const template=fs.readFileSync(new URL('../tools/sigils/sigils.template.js',import.meta.url),'utf8');
  const start='  // Orb identity is a white glyph';
  assert.equal(source.slice(source.indexOf(start)),template.slice(template.indexOf(start)));
});
test('async image conversion cannot repaint a newer desk or leak an unconverted tile',()=>{
  assert.match(source,/!node\.contains\(fallback\)/);
  assert.ok(source.indexOf('el.replaceWith(fallback)') < source.indexOf('image.src = src'));
  assert.match(source,/ICON\.test\(src\) \|\| LOGO\.test\(src\)/);
  assert.match(source,/orbMasks\.size >= 128/);
});
