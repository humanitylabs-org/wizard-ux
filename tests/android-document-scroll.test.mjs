// Source invariants complement the real-browser document geometry and Thales SystemUI gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import vm from 'node:vm';
import { java, constant, statement } from './fixtures/s1-java-slice.mjs';
import { between, block, runRecording } from './fixtures/source-slice.mjs';
import { px, valueOf } from './fixtures/r7A-css.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
const ch = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Android capture uses stock WebView discovery, scrolling and default hint',()=>{
 const native=read('android/app/src/main/java/ai/wizards/os/SelectionWebView.java');
 assert.doesNotMatch(native,/setScrollCaptureCallback|setScrollCaptureHint|ChatScrollCapture|canScrollVertically\s*\(|computeVerticalScroll\w*\s*\(|scrollBy\s*\(|scrollTo\s*\(|onInitializeAccessibilityNodeInfo/);
 for(const p of ['android/app/src/main/assets/scroll-capture.js','android/app/src/main/java/ai/wizards/os/ChatScrollCapture.java'])assert.equal(existsSync(new URL('../'+p,import.meta.url)),false);
 assert.doesNotMatch(withParts(read('web/core/chats.js')),/__wosScrollCapture/);
});
test('document scrolling requires the explicit native capability marker on every release line',()=>{
 const js=withParts(read('web/core/chats.js'));
 const m=/const androidDocument = ([^;]+);/.exec(js);
 const gate=ua=>new Function('navigator','return '+m[1])({userAgent:ua});
 for(const ua of ['Mozilla/5.0 Chrome/140','X WizardOS-Android/0.9.42','X WizardOS-Android/0.10.5','X WizardOS-Android/0.10.7'])assert.equal(gate(ua),false);
 assert.equal(gate('X WizardOS-Android/0.10.7 WizardOS-DocScroll'),true);
 assert.equal(gate('X WizardOS-Android/0.9.42 WizardOS-DocScroll'),true);
 // the real MainActivity WebView setup line, run: the user agent it hands the page passes the real gate above
 const main=java('MainActivity.java'),UA_TAG=constant(main,'UA_TAG',{BuildConfig:{VERSION_NAME:'0.10.7'}});
 let ua='Mozilla/5.0 Chrome/140';const s={getUserAgentString:()=>ua,setUserAgentString:v=>{ua=v;}};
 assert.equal(gate(ua+UA_TAG),false,'the app tag alone is not the marker');
 statement(main,'s.setUserAgentString(',{s,UA_TAG});
 assert.equal(gate(ua),true,ua);
 // the real syncDocumentThread: without the marker the thread keeps its own box; with it the page scrolls the thread
 const sync=androidDocument=>{
  const doc=createDocument();doc.body.innerHTML='<div class="win" data-chats="w1"><div class="ch-thread"><div class="ch-msgs"></div></div></div>';
  const el=doc.querySelector('.win');el.getClientRects=()=>[{}];doc.scrollingElement={scrollTop:0};
  const shown=['w1'];
  const S=runRecording(`${block(js,'  function syncDocumentThread() {')}\nthis.sync=syncDocumentThread;`,{androidDocument,document:doc,docOwner:null,docResize:null,docObserved:[],visibleThreads:new Set(),H:{visible:()=>shown},elOf:()=>el,window:{scrollTo(){}},ResizeObserver:class{observe(){}disconnect(){}}});
  return {S,doc,el,shown};
 };
 const off=sync(false);off.S.sync();
 assert.equal(off.doc.documentElement.classList.contains('wos-doc-scroll'),false,'no marker: no document scrolling');
 assert.equal(off.S.docOwner,null);assert.ok(off.S.calls.some(c=>c[0]==='restoreVisibleThreads'),'the box threads keep their own place');
 const on=sync(true);on.S.sync();
 assert.equal(on.doc.documentElement.classList.contains('wos-doc-scroll'),true,'marker: the document scrolls the thread');
 assert.equal(on.S.docOwner,on.el);assert.ok(on.el.classList.contains('wos-doc-thread'));
 on.shown.length=0;on.S.sync();
 assert.equal(on.doc.documentElement.classList.contains('wos-doc-scroll'),false,'leaving the thread gives the box scrolling back');
 // scrollBox (the document for the owner thread): run in 'reading place, jump latest, prepend and repaint share the document adapter'
});
// chat-power.js run with chats.js's real scrollBox: a thread that is the page scrolls the document, never its div.
function documentThread() {
  const writes = [];
  const scroller = { scrollHeight: 3000, clientHeight: 700, _top: 1200, get scrollTop() { return this._top; }, set scrollTop(v) { writes.push(['document', v]); this._top = v; } };
  const head = { getBoundingClientRect: () => ({ top: 0, bottom: 56, height: 56 }) };
  const thread = { querySelector: s => (s === '.ch-head' ? head : null) };
  const el = { dataset: { chats: 'win' } };
  const msgs = [300, 900, 1500].map((y, i) => ({ dataset: { morphKey: 'm' + i }, getBoundingClientRect: () => ({ top: y - scroller._top, height: 200, bottom: y - scroller._top + 200 }) }));
  const nb = { isConnected: true, get scrollTop() { return 0; }, set scrollTop(v) { writes.push(['div', v]); }, scrollHeight: 700, clientHeight: 700,
    closest: s => (s === '[data-chats]' ? el : s === '.ch-thread' ? thread : null), querySelectorAll: s => (s === '[data-morph-key]' ? msgs : s === '.msg.a' ? msgs : []),
    querySelector: () => null, getBoundingClientRect: () => ({ top: 56, bottom: 700 }), firstElementChild: msgs[0], lastElementChild: msgs[2] };
  el.querySelector = s => (s === '.ch-msgs' ? nb : null);
  const docOwner = { contains: n => n === nb };
  const shims = runRecording(between(ch, '  const scrollBox = nb =>', '\n') + '\nglobalThis.scrollBox = scrollBox;', { docOwner, document: { scrollingElement: scroller } });
  const store = new Map(), state = { lid: '2:x', posFor: 'sid', show: 40 }, w = { id: 'win', thread: 'sid' };
  const ctx = { console, URL, Intl, Date, setTimeout, clearTimeout, location: { origin: 'https://fixture.invalid', href: 'https://fixture.invalid/', hostname: 'fixture.invalid' }, navigator: {},
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem() {} },
    document: { documentElement: { dataset: {} }, addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) }, addEventListener() {},
    WizCore: { esc: String, clip: x => x }, WizConfig: { agent: () => 'Fixture' }, WizLive: { session: () => null } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(read('web/core/chat-kit.js'), ctx); vm.runInContext(read('web/core/chat-power.js'), ctx);
  const PW = ctx.WosChatPower({ ch: () => state, toast() {}, H: { win: () => w }, CH: { win: state }, renderChats() {}, scrollBox: shims.scrollBox, threadOnScreen: () => true, elOf: () => el });
  return { PW, nb, scroller, writes, state };
}
test('reading place, jump latest, prepend and repaint share the document adapter',()=>{
 const t=documentThread();
 t.PW.capture(t.nb);
 const saved=t.PW.RP.read('sid');
 assert.equal(saved.scrollTop,1200,'the reading place is the document\'s scroll');
 assert.equal(saved.shown,40);assert.deepEqual({...saved.anchor},{key:'m2',nth:0,off:1500-1200-56},'anchored on the first message still on screen under the header');
 t.scroller._top=0;assert.equal(t.PW.restore(t.nb,saved),true);
 assert.deepEqual(t.writes.at(-1),['document',1200],'restore puts the document back on that message');
 const n=t.writes.length;t.PW.restore(t.nb,t.PW.RP.read('sid'));assert.equal(t.writes.length,n,'already there: no write (a write kills a fling)');
 t.PW.follow('win',false);assert.deepEqual(t.writes.at(-1),['document',2300],'Latest: the document\'s bottom');
 assert.ok(!t.writes.some(([who])=>who==='div'),'the thread div is never scrolled');
 assert.doesNotMatch(ch,/docAway|docLast|docAnchor|docRestore|docOwnedAt|docAside/);
});
test('native composer unions safe-bottom with the already covered keyboard/dock strip',()=>{
 const css=read('web/core/chats.css');
 // The measured dock strip already includes --safe-b. Adding both lifted a 440px
 // viewport's compact composer to y=101 and left a 34px picker (James correction).
 // the cascade on a document-scrolled thread: composer, switch, Latest, the thread's reserve and the Channels jump pill
 // all sit on max(safe-bottom, covered strip), never their sum
 const doc=createDocument();doc.documentElement.className='wos-doc-scroll';
 doc.body.innerHTML='<div class="wos-doc-thread"><div class="ch-thread"><form class="ch-compose"></form><div class="ch-swrow"></div><button class="ch-latest"></button><button class="ch-jump down"></button></div></div>';
 for(const [safe,covered,expected] of [[92,159,159],[0,66,66],[300,300,300],[24,0,24]]){
   const sheet=css+`\n.wos-doc-thread{--safe-b:${safe}px;--wos-doc-bottom:${covered}px;--wos-doc-compose:84px;--wos-doc-switch:10px}`;
   const at=(sel,prop)=>px(valueOf(doc.querySelector(sel),sheet,prop).replace(/\s*!important$/,''));
   assert.equal(at('.ch-compose','bottom'),expected,`composer ${safe}/${covered}`);
   assert.equal(at('.ch-swrow','bottom'),expected+84,'switch');
   assert.equal(at('.ch-latest','bottom'),84+10+expected+12,'Latest');
   assert.equal(at('.ch-thread','padding-bottom'),84+10+expected+16,'document reserve');
   assert.equal(at('.ch-jump','bottom'),84+10+expected+12,'the Channels jump pill');
 }
 assert.doesNotMatch(css,/var\(--safe-b, 0px\) \+ var\(--wos-doc-bottom, 0px\)/);
});
test('header/composer and skin animation cannot acquire a document-sized fixed containing block',async()=>{
 const css=read('web/core/chats.css'),doc=createDocument();
 doc.body.innerHTML='<div id="device"><div class="ch-thread wos-doc-thread"><div class="ch-head"></div><div class="ch-msgs"></div><form class="ch-compose"></form></div></div>';
 const at=sel=>cascade(doc.querySelector(sel),css);
 doc.documentElement.className='wos-doc-scroll';
 assert.equal(at('.ch-head').position.value,'fixed');assert.equal(at('.ch-compose').position.value,'fixed');
 assert.match(at('.ch-compose').bottom.value,/var\(--wos-doc-bottom, 0px\)/,'the composer sits on the measured bottom strip');
 doc.documentElement.className='';
 assert.notEqual(at('.ch-head').position?.value,'fixed','box scrolling: no fixed header');
 // the skin-switch intro never transforms or filters #device (which would become the fixed children's containing block)
 const { playIntro }=await import(new URL('../web/skins/obsidian/intro.js',import.meta.url).href);
 const was=globalThis.document;
 try {
  for(const docScroll of [false,true]){
   const d=createDocument(),anims=[];d.body.innerHTML='<div id="device"></div>';
   const make=d.createElement.bind(d);d.createElement=t=>{const e=make(t);e.style.setProperty=()=>{};e.animate=()=>({finished:new Promise(()=>{}),cancel(){}});return e;};
   d.getElementById('device').animate=(frames)=>{anims.push(frames);return {finished:new Promise(()=>{}),cancel(){}};};
   d.documentElement.className=docScroll?'wos-doc-scroll':'';globalThis.document=d;
   for(const id of ['obsidian','landscapes'])playIntro({id});
   assert.equal(anims.length,docScroll?0:2,docScroll?'document scrolling: #device is never animated':'box scrolling: the skin intro still plays on #device');
  }
 } finally {globalThis.document=was;}
});
