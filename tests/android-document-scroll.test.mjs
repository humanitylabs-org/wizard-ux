// Source invariants complement the real-browser document geometry and Thales SystemUI gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
// The Android-source contract lives with the APK branch (fix/android-document-scroll-capture).
test('document scrolling is opted in only by APKs that declare WizardOS-DocScroll',()=>{
 const js=read('web/core/chats.js');
 const m=/const androidDocument = (.*);/.exec(js);assert.ok(m);
 const gate=ua=>new Function('navigator','return '+m[1])({userAgent:ua});
 assert.equal(gate('Mozilla/5.0 Chrome/140'),false);
 assert.equal(gate('X WizardOS-Android/0.10.5'),false);
 assert.equal(gate('X WizardOS-Android/0.10.7 WizardOS-DocScroll'),true);
 assert.match(js,/if \(!androidDocument\) return/);
});
test('reading place, jump latest, prepend and repaint share the document adapter',()=>{
 const cp=read('web/core/chat-power.js'),ch=read('web/core/chats.js');
 assert.doesNotMatch(cp,/\bnb\.(scrollTop|scrollHeight|clientHeight|scrollTo)\b|\bbox\.(scrollTop|scrollHeight)\b/);
 assert.match(ch,/PW\?\.capture\(box\)/);
 assert.match(ch,/PW\?\.position\(w, el, nb, \{ turns, working \}\)/);
 assert.match(cp,/anchor: anchorOf\(nb\), shown: c.show/);
 assert.match(ch,/PW\?\.RP.read\(w.thread\)\?\.shown/);
 assert.doesNotMatch(ch,/docAway|docLast|docAnchor|docRestore|docOwnedAt|docAside/);
 assert.equal((cp.match(/function restore\(/g)||[]).length,1);
 assert.match(cp,/Math.abs\(s.scrollTop - to\) >= 1/);
});
test('header/composer and skin animation cannot acquire a document-sized fixed containing block',()=>{
 const css=read('web/core/chats.css');
 assert.match(css,/html.wos-doc-scroll .wos-doc-thread .ch-head\s*\{\s*position: fixed/);
 assert.match(css,/html.wos-doc-scroll .wos-doc-thread .ch-compose\s*\{\s*position: fixed/);
 assert.match(css,/--wos-doc-bottom/);
 assert.match(read('web/skins/obsidian/intro.js'),/!document.documentElement.classList.contains\('wos-doc-scroll'\)/);
});
