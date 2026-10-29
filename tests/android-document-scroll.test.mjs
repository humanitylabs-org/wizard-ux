// Source invariants complement the real-browser document geometry and Thales SystemUI gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Android capture uses stock WebView discovery, scrolling and default hint',()=>{
 const native=read('android/app/src/main/java/ai/wizards/os/SelectionWebView.java');
 assert.doesNotMatch(native,/setScrollCaptureCallback|setScrollCaptureHint|ChatScrollCapture|canScrollVertically\s*\(|computeVerticalScroll\w*\s*\(|scrollBy\s*\(|scrollTo\s*\(|onInitializeAccessibilityNodeInfo/);
 for(const p of ['android/app/src/main/assets/scroll-capture.js','android/app/src/main/java/ai/wizards/os/ChatScrollCapture.java'])assert.equal(existsSync(new URL('../'+p,import.meta.url)),false);
 assert.doesNotMatch(read('web/core/chats.js'),/__wosScrollCapture/);
});
test('document scrolling requires the explicit native capability marker on every release line',()=>{
 const js=read('web/core/chats.js');
 const m=/const androidDocument = ([^;]+);/.exec(js);assert.ok(m);
 const gate=ua=>new Function('navigator','return '+m[1])({userAgent:ua});
 for(const ua of ['Mozilla/5.0 Chrome/140','X WizardOS-Android/0.9.42','X WizardOS-Android/0.10.5','X WizardOS-Android/0.10.7'])assert.equal(gate(ua),false);
 assert.equal(gate('X WizardOS-Android/0.10.7 WizardOS-DocScroll'),true);
 assert.equal(gate('X WizardOS-Android/0.9.42 WizardOS-DocScroll'),true);
 assert.match(read('android/app/src/main/java/ai/wizards/os/MainActivity.java'),/setUserAgentString\(s.getUserAgentString\(\) \+ UA_TAG \+ " WizardOS-DocScroll"\)/);
 assert.match(js,/if \(!androidDocument\) return/);
 assert.match(js,/root.classList.toggle\('wos-doc-scroll', !!next\)/);
 assert.match(js,/const scrollBox = nb => nb && docOwner\?\.contains\(nb\) \? document.scrollingElement : nb/);
});
test('reading place, jump latest, prepend and repaint share the document adapter',()=>{
 const cp=read('web/core/chat-power.js'),ch=read('web/core/chats.js');
 assert.doesNotMatch(cp,/\bnb\.(scrollTop|scrollHeight|clientHeight|scrollTo)\b|\bbox\.(scrollTop|scrollHeight)\b/);
 assert.match(ch,/PW\?\.capture\(box\)/);
 assert.match(ch,/PW\?\.position\(w, el, nb, \{ turns, working, notification: NV\?\.id, notificationScroll \}\)/);
 assert.match(cp,/anchor: anchorOf\(nb\), shown: c.show/);
 assert.match(ch,/PW\?\.RP.read\(w.thread\)\?\.shown/);
 assert.doesNotMatch(ch,/docAway|docLast|docAnchor|docRestore|docOwnedAt|docAside/);
 assert.equal((cp.match(/function restore\(/g)||[]).length,1);
 assert.match(cp,/Math.abs\(s.scrollTop - to\) >= 1/);
});
test('native composer unions safe-bottom with the already covered keyboard/dock strip',()=>{
 const css=read('web/core/chats.css');
 // The measured dock strip already includes --safe-b. Adding both lifted a 440px
 // viewport's compact composer to y=101 and left a 34px picker (James correction).
 const bottom=/html\.wos-doc-scroll \.wos-doc-thread \.ch-compose\s*\{[^}]*bottom:\s*([^;]+);/.exec(css)?.[1];
 assert.equal(bottom,'max(var(--safe-b, 0px), var(--wos-doc-bottom, 0px)) !important');
 for(const [safe,covered,expected] of [[92,159,159],[0,66,66],[300,300,300],[24,0,24]]){
   const expression=bottom.replace(/ !important$/,'').replace('var(--safe-b, 0px)',String(safe)).replace('var(--wos-doc-bottom, 0px)',String(covered)).replace('max(','Math.max(');
   assert.equal(new Function('return '+expression)(),expected);
 }
 assert.equal((css.match(/max\(var\(--safe-b, 0px\), var\(--wos-doc-bottom, 0px\)\)/g)||[]).length,4,'composer, switch, Latest and document reserve share one inset');
 assert.doesNotMatch(css,/var\(--safe-b, 0px\) \+ var\(--wos-doc-bottom, 0px\)/);
});
test('header/composer and skin animation cannot acquire a document-sized fixed containing block',()=>{
 const css=read('web/core/chats.css');
 assert.match(css,/html.wos-doc-scroll .wos-doc-thread .ch-head\s*\{\s*position: fixed/);
 assert.match(css,/html.wos-doc-scroll .wos-doc-thread .ch-compose\s*\{\s*position: fixed/);
 assert.match(css,/--wos-doc-bottom/);
 assert.match(read('web/skins/obsidian/intro.js'),/!document.documentElement.classList.contains\('wos-doc-scroll'\)/);
});
