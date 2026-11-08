import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/links.js',import.meta.url),'utf8');
function fixture({installed=true,native=false,appURL='/browser/',activation=true,store={},config={}}={}) {
 const calls=[], downloads=[], origin='https://wizard.example', location=new URL(origin+'/wizard-os-home/');
 class El {
  constructor(){this.handlers={};this.nodes={};this.style={};this.classList={add(){},remove(){},contains(){return false;},toggle(){return false;}};this.contentWindow={location:{replace(){}}};}
  setAttribute(){} appendChild(){} remove(){} querySelector(s){return this.nodes[s] ||= new El();}
  addEventListener(n,fn){(this.handlers[n] ||= []).push(fn);}
  click(){calls.push(['download',this.href]);downloads.push({href:this.href,target:this.target,rel:this.rel,download:this.download});}
 }
 const document={body:new El(),createElement:()=>new El()}, w={open:url=>calls.push(['browser',url])};
 if(native)w.WizardOSNative={openInBrowser:url=>calls.push(['native-browser',url]),download:url=>calls.push(['native-download',url])};
 const localStorage={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v);}};w.WizConfig={raw:config,localURL:(h,b)=>new URL(h,b)};
 vm.runInNewContext(source,{window:w,location,navigator:{userAgent:'fixture',userActivation:{get isActive(){return activation;}}},localStorage,document,URL,console,setTimeout,clearTimeout,performance:{now:()=>0},Date,JSON,Object,Set});
 const L=w.WizLinks.mount({readerApp:()=>installed?{id:'browser',url:appURL}:null,asWindow:path=>{calls.push(['window',path]);return true;}});
 const chat=new El();w.WizLinks.intercept(chat,L);
 const doc=new El(),win={document:doc,location:new URL(origin+'/search/'),open(){},frameElement:{}};
 w.WizLinks.guardFrame(win,'/search/',L);
 const readerDoc=new El();w.WizLinks.guardFrame({document:readerDoc,location:new URL(origin+'/browser/?url=x'),open(){},frameElement:{}},'/browser/',L);
 function click(root,href,attrs={}) {
   const a={ownerDocument:document,getAttribute:k=>k==='href'?href:attrs[k] || null,hasAttribute:k=>k in attrs,closest:s=>s==='[data-mi]' || s==='[data-chats]'?null:({})};
   const e={button:0,target:{closest:()=>a},preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};
   for(const fn of root.handlers.click || [])fn(e);return e;
 }
 return {calls,downloads,L,chat,doc,readerDoc,click,store,setActivation:v=>{activation=v;}};
}
test('chat tap synchronously opens installed Browser Reader, never the remote origin',()=>{const f=fixture();f.click(f.chat,'https://example.com/story?a=1#part');assert.deepEqual(f.calls,[['window','/browser/?url=https%3A%2F%2Fexample.com%2Fstory%3Fa%3D1%23part']]);});
test('Search hosted result uses the same Browser Reader path',()=>{const f=fixture();f.click(f.doc,'https://example.com/story');assert.deepEqual(f.calls,[['window','/browser/?url=https%3A%2F%2Fexample.com%2Fstory']]);});
test('without Reader the existing system browser path is retained',()=>{const f=fixture({installed:false});f.click(f.chat,'https://example.com/story');assert.deepEqual(f.calls,[['browser','https://example.com/story']]);});
test('a Wizard internal link still opens internally',()=>{const f=fixture();f.click(f.chat,'/notes/');assert.deepEqual(f.calls,[['window','/notes/']]);});
for(const ext of ['pdf','apk'])test('external '+ext+' remains a download',()=>{const f=fixture();f.click(f.chat,'https://example.com/file.'+ext);assert.deepEqual(f.calls,[['download','https://example.com/file.'+ext]]);});
test('Reader explicit source escape opens desktop original, not another Reader',()=>{const f=fixture();f.click(f.doc,'https://example.com/story',{'data-wizard-browse':'',target:'_blank'});assert.deepEqual(f.calls,[['browser','https://example.com/story']]);});
test('Reader source escape uses the Android openInBrowser bridge',()=>{const f=fixture({native:true});f.click(f.doc,'https://example.com/story',{'data-wizard-browse':'',target:'_blank'});assert.deepEqual(f.calls,[['native-browser','https://example.com/story']]);});
test('cross-origin file downloads have a safe new context when inline responses ignore download',()=>{for(const ext of ['pdf','apk']){const f=fixture();f.click(f.chat,'https://example.com/inline.'+ext);assert.equal(f.downloads[0].target,'_blank');assert.equal(f.downloads[0].rel,'noopener');assert.equal(f.downloads[0].download,'inline.'+ext);}});
test('same-origin downloads keep the existing download context',()=>{const f=fixture();f.click(f.chat,'/reports/file.pdf');assert.equal(f.downloads[0].target,undefined);assert.equal(f.downloads[0].download,'file.pdf');});
test('native file downloads still use the native bridge',()=>{const f=fixture({native:true});f.click(f.chat,'https://example.com/file.pdf');assert.deepEqual(f.calls,[['native-download','https://example.com/file.pdf']]);assert.equal(f.downloads.length,0);});
test('Reader route rejects an outside-origin app registration',()=>{const f=fixture({appURL:'https://untrusted.example/'});assert.equal(f.L.open('https://example.com/'),true);assert.equal(f.calls[0][0],'browser');});

// James, 7 Nov 2026: Wizard's own pages never go into Reader, and a page Reader cannot read never needs a second tap.
const tick=()=>new Promise(r=>setTimeout(r,5));
const READER=href=>['window','/browser/?url='+encodeURIComponent(href)];
for(const href of ['https://wizard.aiwizards.com/clips-pipeline/#/clip/pod-2026-09-25-03-agency-small-wins','https://wizard.example-tailnet.ts.net/notes/','https://private.wizard001.com/apps/','https://wizard.example:8443/wizard-os-home/','http://192.168.1.20/','http://localhost:3000/','http://nas/'])
 test('Wizard own or private host opens as before Reader, never in Reader: '+new URL(href).host,()=>{const f=fixture();f.click(f.chat,href);assert.deepEqual(f.calls,[['browser',href]]);});
test('the configured Wizard base URL host never goes into Reader',()=>{const f=fixture({config:{settings:{network:{base_url:'https://box.owner-wizard.example/'}}}});f.click(f.chat,'https://box.owner-wizard.example/clips/');assert.deepEqual(f.calls,[['browser','https://box.owner-wizard.example/clips/']]);});
test('Wizard own host on the phone uses the native browser bridge, not Reader',()=>{const f=fixture({native:true});f.click(f.chat,'https://wizard.aiwizards.com/clips-pipeline/');assert.deepEqual(f.calls,[['native-browser','https://wizard.aiwizards.com/clips-pipeline/']]);});
test('phone: Reader auto hand-off opens the original natively at once and the next tap skips Reader',()=>{
 const f=fixture({native:true}),href='https://www.reuters.com/world/story';
 f.click(f.chat,href);assert.deepEqual(f.calls,[READER(href)]);
 const e=f.click(f.readerDoc,href,{'data-wizard-browse':'auto','data-wizard-reason':'blocked',target:'_blank'});
 assert.equal(e.defaultPrevented,true);assert.deepEqual(f.calls.at(-1),['native-browser',href]);
 f.click(f.chat,'https://www.reuters.com/business/other');assert.deepEqual(f.calls.at(-1),['native-browser','https://www.reuters.com/business/other']);
 assert.equal(f.calls.filter(c=>c[0]==='window').length,1);
});
test('desktop: hand-off inside the fresh tap opens one browser tab',async()=>{
 const f=fixture(),href='https://www.reddit.com/r/programming/';
 const e=f.click(f.readerDoc,href,{'data-wizard-browse':'auto','data-wizard-reason':'blocked',target:'_blank'});
 assert.equal(e.defaultPrevented,true);await tick();assert.deepEqual(f.calls,[['browser',href]]);
});
test('desktop: a stale tap declines the hand-off (no blocked popup) but the next tap opens the browser directly',async()=>{
 const f=fixture({activation:false}),href='https://www.ddproperty.com/listing/1';
 const e=f.click(f.readerDoc,href,{'data-wizard-browse':'auto','data-wizard-reason':'blocked',target:'_blank'});
 assert.equal(e.defaultPrevented,undefined);await tick();assert.deepEqual(f.calls,[]);
 f.setActivation(true);f.click(f.chat,'https://www.ddproperty.com/listing/2');assert.deepEqual(f.calls,[['browser','https://www.ddproperty.com/listing/2']]);
 assert.deepEqual(Object.keys(JSON.parse(f.store['wos.readerDirect.v1'])),['www.ddproperty.com'],'only the hostname and time are remembered');
});
test('a page without an article is handed off but its host still tries Reader next time',async()=>{
 const f=fixture({native:true}),href='https://github.com/humanitylabs-org';
 f.click(f.readerDoc,href,{'data-wizard-browse':'auto','data-wizard-reason':'noarticle',target:'_blank'});assert.deepEqual(f.calls,[['native-browser',href]]);
 f.click(f.chat,'https://github.com/humanitylabs-org/wizard-ux/pull/1023');assert.deepEqual(f.calls.at(-1),READER('https://github.com/humanitylabs-org/wizard-ux/pull/1023'));
});
test('a remembered host expires after 14 days and goes back to Reader',()=>{
 const store={'wos.readerDirect.v1':JSON.stringify({'www.reuters.com':Date.now()-15*864e5,'apnews.com':Date.now()})};const f=fixture({store});
 f.click(f.chat,'https://www.reuters.com/a');f.click(f.chat,'https://apnews.com/b');assert.deepEqual(f.calls,[READER('https://www.reuters.com/a'),['browser','https://apnews.com/b']]);
});
test('a corrupt remembered-host value never breaks link taps',()=>{const f=fixture({store:{'wos.readerDirect.v1':'[not json'}});f.click(f.chat,'https://example.com/a');assert.deepEqual(f.calls,[READER('https://example.com/a')]);});
test('an explicit Open in your browser tap still opens even without a fresh-tap check',()=>{const f=fixture({activation:false});f.click(f.doc,'https://example.com/story',{'data-wizard-browse':'',target:'_blank'});assert.deepEqual(f.calls,[['browser','https://example.com/story']]);});
test('another app cannot use the Reader hand-off to remember hosts',()=>{
 const f=fixture({activation:false}),href='https://news.example/a';
 f.click(f.doc,href,{'data-wizard-browse':'auto','data-wizard-reason':'blocked',target:'_blank'});
 assert.equal(f.store['wos.readerDirect.v1'],undefined);assert.deepEqual(f.calls,[['browser',href]]);
});

test('an auxiliary links mount (App Setup) never replaces the shell Reader identity', () => {
  const src = readFileSync(new URL('../web/core/links.js', import.meta.url), 'utf8');
  assert.match(src, /if \(arguments\[0\]\?\.readerApp\) readerHome = /);
  assert.doesNotMatch(src, /^\s*readerHome = \(\) =>/m);
});
