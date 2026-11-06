import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {createFixture,host,frame,messenger,utf8Type}=require('../tools/drafts-keep/fixture.cjs');

test('synthetic registered-frame HTML declares UTF-8 before scripts',()=>{
  for(const html of [host('phone'),host('desktop'),frame,messenger]){
    assert(html.indexOf('<meta charset="utf-8">')<html.indexOf('<script'));
  }
});
test('real base tokens and palette implementation precede Appearance',()=>{
  const h=host('phone');
  assert(h.includes('core/base.css'));assert(h.includes('core/skins.js'));
  assert(h.indexOf('core/base.css')<h.indexOf('kit/shell-tokens.css'));
  assert(h.indexOf('core/skins.js')<h.indexOf('core/appearance-host.js'));
  assert(h.includes("shell:document.documentElement.dataset.shell"));
});
test('voice fixture owns a distinct registered Messenger frame, not Wisdom',()=>{
  const h=host('phone');
  assert(h.includes("appId:'messenger',path:'/messenger/'"));
  assert(h.includes("appId:'wisdom',path:'/wisdom/'"));
  assert(h.includes("id:'messenger',name:'Messenger'"));
  assert(!h.includes('Messenger voice note')); // reason must not spoof identity
});
test('no extra fixture Reload button or visible status line',()=>{
  const h=host('phone');assert(!h.includes('<button'));assert(!h.includes('id="status"'));
  assert(h.includes("WizWebUpdate.init"));
});
test('all text/script/JSON responses carry UTF-8, binary does not',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'drafts-harness-'));
  const shell=path.join(dir,'shell'),wisdom=path.join(dir,'wisdom');
  mkdirSync(shell);mkdirSync(wisdom);
  writeFileSync(path.join(shell,'notice.js'),"window.test='✦ isn’t — 🌱';");
  writeFileSync(path.join(wisdom,'wisdom.js'),'return {syncOffline,');
  const server=createFixture({shell,wisdom});
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const base='http://127.0.0.1:'+server.address().port;
    for(const p of ['/','/wisdom/','/messenger/','/wizard-os-home/notice.js','/wisdom/fixture-wisdom.js','/wizard-os-home/ux-changes.json','/wizard-os-home/ux-version.txt']){
      const r=await fetch(base+p);assert.equal(r.status,200,p);assert.match(r.headers.get('content-type'),/charset=utf-8$/);
      if(p.endsWith('notice.js'))assert.equal(await r.text(),"window.test='✦ isn’t — 🌱';");
    }
    assert.equal((await fetch(base+'/unknown')).status,404);
    assert.equal((await fetch(base+'/',{method:'POST'})).status,405);
    assert.equal(utf8Type('image/png'),'image/png');
  }finally{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
test('browser keeps exact owner, mojibake, two-palette and contrast assertions',()=>{
  const b=readFileSync(new URL('../tools/drafts-keep/browser.cjs',import.meta.url),'utf8');
  assert(b.includes("WosSkin.set(s)"));assert(b.includes("['nebula','grove']"));
  assert(b.includes("b.appId==='messenger'"));assert(b.includes('Messenger has a voice note that isn’t sent yet.'));
  assert(b.includes('p.contrast>=4.5'));assert(b.includes('noMojibake(notice)'));
  assert(b.includes('transparent-negative-'));assert(b.includes("isMobile:true,hasTouch:true"));
});
test('QA packet has no image operations, PNG decoder verifies actual pixels and rejects CRC drift',()=>{
  const runner=new URL('../tools/drafts-keep/run-packet.py',import.meta.url);
  const source=readFileSync(runner,'utf8');
  assert(!/['"]docker['"]|Dockerfile|wisdom-baseline-image\.tar/.test(source));
  const probe=String.raw`
import runpy,sys,struct,zlib,tempfile,pathlib
m=runpy.run_path(sys.argv[1])
def chunk(k,b):
 return struct.pack('>I',len(b))+k+b+struct.pack('>I',zlib.crc32(k+b)&0xffffffff)
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d)/'test.png'
 for channels,color in [(3,2),(4,6)]:
  row=bytes((i*23)%256 for i in range(3*channels)); previous=bytes((i*17)%256 for i in range(3*channels))
  for filt in range(5):
   encoded=bytearray()
   for i,v in enumerate(row):
    a=row[i-channels] if i>=channels else 0
    b=previous[i];c=previous[i-channels] if i>=channels else 0
    g=a+b-c;pa,pb,pc=abs(g-a),abs(g-b),abs(g-c)
    predict=a if pa<=pb and pa<=pc else b if pb<=pc else c
    encoded.append((v-(0,a,b,(a+b)//2,predict)[filt])&255)
   image=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',3,2,8,color,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0'+previous+bytes([filt])+encoded))+chunk(b'IEND',b'')
   p.write_bytes(image)
   assert m['png_pixels'](p)==(3,2,channels,previous+row)
   p.write_bytes(image[:-1]+bytes([image[-1]^1]))
   try: m['png_pixels'](p)
   except AssertionError: pass
   else: raise AssertionError('corrupt CRC accepted')
print('all five PNG filters, RGB/RGBA, and corrupt CRC checked')
`;
  const r=spawnSync('python3',['-c',probe,runner.pathname],{encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+r.stderr);
});
