import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/core/home-screen-apps.js',import.meta.url),'utf8');
const drain = async () => { for (let n=0;n<30;n++) await Promise.resolve(); };
function fixture({bridge=true, reply='pinned-list', ids=['wisdom'], broken=false, apps, code=source}={}) {
  const events={}, messages=[], timers=new Map(), headers=[], canvases=[];
  let loads=0, renders=0, serial=0;
  const app={id:'wisdom',name:'Wisdom',kind:'wizard',url:'/wisdom/',color:'#fec25d'};
  const registry=apps || {wisdom:app,other:{...app,id:'other'},bad:{...app,id:'../bad'},shell:{...app,id:'shell',url:'/wizard-os-home/'},native:{...app,id:'native',kind:'native'}};
  const window={WizCore:{appsLoaded(){loads++;return Promise.resolve();},apps:()=>({APP:registry})},
    WizHomeScreenPolicy:{validId:id=>/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(id),isShell:url=>url==='/wizard-os-home/',within:()=>true,displayName:a=>a.name},
    WizSigil:{box:()=>'<i class="sgi"></i>',of:a=>({color:a.color,letter:'W'})}};
  const document={body:{append:e=>{e.connected=true;headers.push(e);}},createElement(tag){
    if(tag==='canvas') { renders++;const c={getContext:()=>({fillRect(){},fillText(){},drawImage(){},set fillStyle(v){c.color=v;}}),toDataURL:()=>{if(broken)throw Error('decode');return 'data:image/png;base64,'+c.color;}};canvases.push(c);return c; }
    return {style:{},setAttribute(){},querySelector(){assert.equal(this.connected,true,'mask needs connected header');return null;},remove(){this.connected=false;}};
  }};
  if(bridge)window.wizardHomeScreenPort={postMessage(raw){const d=JSON.parse(raw);messages.push(d);if(reply==='timeout')return;this.onmessage({data:JSON.stringify({requestId:d.requestId,status:d.op==='pinned'?reply:'updated',appIds:ids})});}};
  vm.runInNewContext(code,{window,document,addEventListener:(t,fn)=>events[t]=fn,setTimeout:(fn)=>{const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
  return {window,events,messages,headers,canvases,app,registry,timers,get loads(){return loads;},get renders(){return renders;}};
}
test('without native bridge automatic load/resume refresh does not even read apps or render icons',async()=>{
  const f=fixture({bridge:false});await drain();await f.events['wos-native-resume']();await drain();
  assert.equal(f.loads,0);assert.equal(f.renders,0);assert.equal(f.messages.length,0);
});
test('no-bridge regression rejects removal of the entry guard',async()=>{
  const f=fixture({bridge:false,code:source.replace('if (!port()) return;\n    if (refreshing)','if (refreshing)')});await drain();assert.equal(f.loads,1);
});
test('load queries bounded valid frontend candidates and renders only native-confirmed pinned apps',async()=>{
  const f=fixture({ids:['wisdom','../bad','foreign']});await drain();
  assert.deepEqual(f.messages[0].candidates,['wisdom','other']);assert.deepEqual(f.messages.map(x=>x.op),['pinned','refresh']);
  assert.equal(f.messages[1].appId,'wisdom');assert.equal(f.messages[1].name,'Wisdom');assert.equal(f.messages[1].icon,'data:image/png;base64,#fec25d');
  assert.equal(f.canvases[0].width,192);assert.equal(f.canvases[0].height,192);assert.ok(f.headers.every(e=>!e.connected));
});
test('resume re-renders the current sigil and name without a user gesture or new pin',async()=>{
  const f=fixture();await drain();f.app.color='#00ff00';f.app.name='Wisdom changed';await f.events['wos-native-resume']();await drain();
  const r=f.messages.filter(x=>x.op==='refresh');assert.equal(r.length,2);assert.equal(r[1].icon,'data:image/png;base64,#00ff00');assert.equal(r[1].name,'Wisdom changed');assert.ok(f.messages.every(x=>x.op!=='pin'));
});
test('old APK unknown response and timeout are quiet no-ops, and a later resume can retry',async()=>{
  for(const reply of ['unknown','unsupported','timeout']) { const f=fixture({reply});await drain();
    await f.events['wos-native-resume']();await drain();
    if(reply==='timeout'){assert.equal(f.messages.length,1,'single flight while old APK is silent');for(const fn of [...f.timers.values()])fn();await drain();}
    assert.equal(f.renders,0);assert.ok(f.messages.every(x=>x.op==='pinned'));
    await f.events['wos-native-resume']();await drain();assert.ok(f.messages.length>=2);
  }
});
test('PNG render error stays silent, cleans the temporary glyph and does not send refresh',async()=>{
  const f=fixture({broken:true});await drain();assert.deepEqual(f.messages.map(x=>x.op),['pinned']);assert.ok(f.headers.every(e=>!e.connected));
});
test('candidate list and native response are capped; duplicate candidates cannot multiply work',async()=>{
  const apps=Object.fromEntries(Array.from({length:200},(_,i)=>['a'+i,{id:'app'+i,name:'App',kind:'wizard',url:'/app/'}]));apps.duplicate=apps.a0;
  const f=fixture({apps,ids:Array(129).fill('app0')});await drain();assert.equal(f.messages[0].candidates.length,128);assert.equal(f.renders,0);
});
test('a registry update during a refresh reruns it with the new apps instead of dropping it',async()=>{
  const f=fixture({reply:'timeout'});await drain();
  assert.deepEqual(f.messages.map(x=>x.op),['pinned']);
  // Registry changes while the first pass awaits native: mark dirty, no second flight yet.
  f.app.name='Wisdom renamed';f.app.color='#123456';f.events['wizard:apps']();await drain();
  assert.equal(f.messages.length,1);
  const answer=m=>f.window.wizardHomeScreenPort.onmessage({data:JSON.stringify({requestId:m.requestId,status:m.op==='pinned'?'pinned-list':'updated',appIds:['wisdom']})});
  for(let n=0;n<12;n++){const open=f.messages.filter(m=>!m.done);for(const m of open){m.done=true;answer(m);}await drain();}
  const r=f.messages.filter(x=>x.op==='refresh');
  assert.equal(f.messages.filter(x=>x.op==='pinned').length,2,'dirty pass reran once');
  assert.equal(r.at(-1).name,'Wisdom renamed');assert.equal(r.at(-1).icon,'data:image/png;base64,#123456');
});
