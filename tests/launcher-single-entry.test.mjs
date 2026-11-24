import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { withShellParts } from './fixtures/shell-parts.mjs';
const source=withShellParts(readFileSync(new URL('../web/app.js',import.meta.url),'utf8'));
const render=source.slice(source.indexOf('  function renderLauncher('),source.indexOf('  // This desk\'s windows',source.indexOf('  function renderLauncher(')));
function paint(recent,APPS){
 const APP=Object.fromEntries(APPS.map(a=>[a.id,a]));APP.retired=APP.alpha;
 const body={scrollTop:0,scrollHeight:400};
 const context={APPS,APP,tileN:0,oursSkin:()=>false,$:()=>body,store:{get:()=>recent},window:{WizCore:{isMaintenanceApp:()=>false}},appTile:a=>`<button data-app="${a.id}"></button>`};
 vm.runInNewContext(render+';renderLauncher("",false);',context);
 // The "+ Get apps" tile opens the Store's Apps section (data-storekind), so the App Store's own tile is its one entry.
 return {html:body.innerHTML,ids:[...body.innerHTML.matchAll(/data-app="([^"]+)"/g)].map(m=>m[1]),get:body.innerHTML.match(/data-storekind="apps"/g)?.length||0};
}
const apps=[{id:'alpha',kind:'wizard'},{id:'beta',kind:'wizard'},{id:'wizard',kind:'chats'},{id:'app-store',kind:'wizard'}];
test('Recent and Apps render one tile per resolved app id, preserving both destinations',()=>{
 const result=paint(['retired','alpha','alpha','wizard'],apps);
 assert.deepEqual(result.ids,['alpha','wizard','beta','app-store']);
 assert.equal(new Set(result.ids).size,result.ids.length);
 assert.match(result.html,/>Recent</);assert.match(result.html,/>Apps <span>2<\/span>/);assert.equal(result.get,1);
});
test('empty or stale recents leave every available app reachable once',()=>{
 const result=paint(['missing'],apps);
 // The App Store is a normal tile too (ux#1493), and the Get apps tile stays.
 assert.deepEqual(result.ids,['alpha','beta','wizard','app-store']);assert.equal(result.get,1);
 assert.equal(new Set(result.ids).size,result.ids.length);
});
