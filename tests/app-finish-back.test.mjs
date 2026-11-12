import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../web/'+p,import.meta.url),'utf8');
test('apps return through the shared Back step and hidden frames cannot navigate the owner',()=>{
 assert.match(read('core/app-client.js'),/back: \(\) => \{ try \{ return service\?\.nav\?\.back\?\.\(\) === true/);
 assert.match(read('core/app-services.js'),/back\(\) \{ check\(\); return navBack\(st\); \}/);
 assert.match(read('core/app-services.js'),/function navBack\(st\) \{ if \(st\.isVisible\?\.\(\) !== true/);
 assert.match(read('app.js'),/back: \(\) => \{ if \(desks\[idx\]\.focus !== w\.id\) return false; const did = backStep\(w\.id\)/);
});
