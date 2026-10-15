import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withPrivateCatalog} from '../tools/store-private-catalog.mjs';
const row={id:'private-app',name:'Private App',summary:'Test',repo:'example/private-app',type:'view',category:'app'};
test('pins shadow public rows; upstream never receives matching private search',async()=>{
 let calls=0; const proxy=withPrivateCatalog(async()=>{calls++;return {status:200,body:{apps:[{id:'private-app',name:'wrong'},{id:'public'}]}}},()=>[row]);
 assert.equal((await proxy('/search',new URLSearchParams())).body.apps[0].name,'Private App');
 assert.equal(calls,1);
 assert.equal((await proxy('/apps/example/private-app',new URLSearchParams())).body.name,'Private App');
 assert.equal((await proxy('/search',new URLSearchParams({q:'private'}))).body.apps.length,1);
 assert.equal(calls,1);
});
test('private list survives public outage and respects category',async()=>{
 const proxy=withPrivateCatalog(async()=>({status:502}),()=>[row]);
 assert.equal((await proxy('/search',new URLSearchParams())).body.apps.length,1);
 assert.equal((await proxy('/search',new URLSearchParams({category:'agent'}))).body.apps.length,0);
});
