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
test('document scrolling is opted in only by app 0.9.42 or newer (older APKs keep inner scrolling)',()=>{
 const js=read('web/core/chats.js');
 const m=/const androidDocument = (\(\(\) => \{[\s\S]*?\}\)\(\));/.exec(js);assert.ok(m);
 const gate=ua=>new Function('navigator','return '+m[1])({userAgent:ua});
 assert.equal(gate('Mozilla/5.0 Chrome/140'),false);
 assert.equal(gate('X WizardOS-Android/0.9.41'),false);
 assert.equal(gate('X WizardOS-Android/0.9.42'),true);
 assert.equal(gate('X WizardOS-Android/0.10.1'),true);
 assert.match(js,/if \(!androidDocument\) return/);
 assert.match(js,/root.classList.toggle\('wos-doc-scroll', !!next\)/);
 assert.match(js,/const scrollBox = nb => nb && docOwner\?\.contains\(nb\) \? document.scrollingElement : nb/);
});
test('reading place, jump latest, prepend and repaint share the document adapter',()=>{
 const cp=read('web/core/chat-power.js'),ch=read('web/core/chats.js');
 assert.doesNotMatch(cp,/\bnb\.(scrollTop|scrollHeight|clientHeight|scrollTo)\b|\bbox\.(scrollTop|scrollHeight)\b/);
 assert.match(ch,/if \(keep\) ns.scrollTop = ns.scrollHeight - keep.h \+ keep.top/);
 assert.match(cp,/shown: scrollBox\(nb\) !== nb \? c.show : undefined/);
 assert.match(ch,/PW\?\.RP.read\(w.thread\)\?\.shown/);
});
test('header/composer and skin animation cannot acquire a document-sized fixed containing block',()=>{
 const css=read('web/core/chats.css');
 assert.match(css,/html.wos-doc-scroll .wos-doc-thread .ch-head\s*\{\s*position: fixed/);
 assert.match(css,/html.wos-doc-scroll .wos-doc-thread .ch-compose\s*\{\s*position: fixed/);
 assert.match(css,/--wos-doc-bottom/);
 assert.match(read('web/skins/obsidian/intro.js'),/!document.documentElement.classList.contains\('wos-doc-scroll'\)/);
});
