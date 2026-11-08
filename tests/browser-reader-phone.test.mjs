// REUSE: the installed Reader's preview opener and shared hosted-app Back, not a second navigator.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync(process.env.QA_BROWSER_PHONE_SOURCE || new URL('../web/app.js', import.meta.url), 'utf8');
const fn = name => { const start = source.indexOf(`  function ${name}(`); assert.ok(start >= 0); return source.slice(start, source.indexOf('\n  }', start) + 4); };
function phone() {
  const location = new URL('https://wizard.example/wizard-os-home/index.html');
  const app = {id:'browser', name:'Browser', kind:'wizard', url:'/browser/'};
  const chat = {id:'chat', app:'chats', thread:'thread1'};
  const W = {chat}, desks = [{id:'chat-desk', wins:['chat'], focus:'chat', full:false}];
  const iframe = {tagName:'IFRAME'}, calls = [], gates = [], navigations = [];
  let appPages = 0;
  const window = {
    WosAppSetup:{gate:(a,resume)=>{gates.push(resume);return true;}},
    WizAppServices:{back:frame=>{
      calls.push(frame);
      if(frame !== iframe) return 'notReady';
      if(appPages) { appPages--; return 'handled'; }
      return 'atRoot';
    }},
  };
  const c = {window, location, URL, W, desks, idx:0, APP:{browser:app}, document:{activeElement:null,querySelector:()=>null},
    appAt:path=>new URL(path,location).pathname.startsWith('/browser/') ? app : null,
    closeSheets(){}, LIVE:null, LINKS:null, sheet:null, menuFor:null, V:{state:'idle'}, rvCoach:null,
    CHATS:{isHosted:()=>false, threadBack:()=>false},
    winEl:id=>({querySelector:()=>id === 'reader' ? iframe : null}),
    agentWin:()=>false, deskOf:id=>desks.findIndex(d=>d.wins.includes(id)),
    clip:s=>s, winTitle:w=>w.app === 'chats' ? 'Chat' : 'Browser', deskName:()=>'',
    openWin:obj=>{const w={id:'reader',...obj}; W.reader=w; desks.push({id:'reader-desk',wins:['reader'],focus:'reader',full:false}); c.idx=1; return w;},
    closeWin:id=>{assert.equal(id,'reader'); const from=W[id].from; delete W[id]; desks.pop(); c.idx=desks.findIndex(d=>d.id === from.desk);},
    setFull(){throw Error('not full screen');},
    frameNav:()=>({canGoBack:true,back:()=>navigations.push('raw-frame-history')}),
    frameHref:()=>'/browser/?url=article', rememberFramePop(){}, selfPop(){},
    setTimeout(){}, toast(){},
  };
  vm.createContext(c);
  vm.runInContext(readFileSync(new URL('../web/core/escape-back.js',import.meta.url),'utf8'),c);
  c.phoneBack=window.WizEscapeBack.create();
  vm.runInContext(['fromOf','linkDesk','openLinkDesk','closeReviewCoach','hostedBack','backStep','onBack'].map(fn).join('\n'),c);
  vm.runInContext(source.match(/  phoneBack.watch\(\(\) => rvCoach,[^\n]+/)[0],c);
  // Execute the actual phone WizLinks mount's callback, not a manually checked open.
  const start = source.indexOf('    LINKS = window.WizLinks.mount({');
  const end = source.indexOf('\n    });', start);
  window.WizLinks={mount:opts=>opts}; c.device={};
  vm.runInContext(source.slice(start,end+8),c);
  return {c, W, desks, iframe, calls, gates, navigations, pages:n=>{appPages=n;}};
}
test('phone Reader callback paints its preview synchronously, without waiting for setup/network admission',()=>{
  const f=phone(); const url='/browser/?url='+encodeURIComponent('https://example.com/article');
  assert.equal(f.c.LINKS.readerOpen(url),true);
  assert.equal(f.gates.length,0,'installed Reader previews use the same immediate open as desktop previews');
  assert.equal(f.W.reader?.url,url,'the loading frame is mounted in the tap task');
  assert.equal(f.c.idx,1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.W.reader.from)),{desk:'chat-desk',win:'chat',sid:'thread1',title:'Chat'});
});
test('ordinary internal app links retain setup admission',()=>{
  const f=phone(); f.c.openLinkDesk('/browser/');
  assert.equal(f.gates.length,1); assert.equal(f.W.reader,undefined);
  f.gates.shift()(); assert.ok(f.W.reader);
});
test('phone Back asks the actual iframe; Reader history first, then closes to the originating chat',()=>{
  const f=phone(); f.c.openLinkDesk('/browser/?url=article',null,true); f.pages(1);
  f.c.rvCoach={classList:{remove(){}},remove(){}};
  f.c.onBack(); assert.equal(f.c.rvCoach,null); assert.equal(f.calls[0],f.iframe,'the window model is not an app-services frame');
  assert.ok(f.W.reader,'in-app previous page consumed the first Back');
  assert.equal(f.c.idx,1); assert.deepEqual(f.navigations,[]);
  f.c.onBack(); assert.equal(f.W.reader,undefined); assert.equal(f.c.idx,0);
  assert.equal(f.desks[0].focus,'chat'); assert.equal(f.W.chat.thread,'thread1');
  assert.deepEqual(f.navigations,[],'root Back must not traverse an iframe boot/history entry');
  assert.deepEqual([...f.c.window.__backLog],['hosted','review-close']);
});
test('first-use Review coach does not swallow Back from the Reader to its chat',()=>{
  const f=phone(); f.c.openLinkDesk('/browser/?url=article',null,true);
  f.c.rvCoach={classList:{remove(){}},remove(){}};
  f.c.onBack();
  assert.equal(f.c.rvCoach,null); assert.equal(f.W.reader,undefined); assert.equal(f.c.idx,0);
  assert.equal(f.W.chat.thread,'thread1'); assert.deepEqual([...f.c.window.__backLog],['review-close']);
});
test('outside dismisses only the Review coach, leaving the Reader in front',()=>{
  const f=phone(); f.c.openLinkDesk('/browser/?url=article',null,true);
  f.c.rvCoach={classList:{remove(){}},remove(){}};
  assert.equal(f.c.backStep(undefined,{outside:true}),'review-coach');
  assert.equal(f.c.rvCoach,null); assert.ok(f.W.reader); assert.equal(f.c.idx,1); assert.equal(f.calls.length,0);
});
