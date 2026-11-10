import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createBetaSource} from '../tools/store-beta-source.mjs';
import {withPrivateCatalog} from '../tools/store-private-catalog.mjs';
import {createStoreDataRoutes, PREFIX} from '../tools/store-data-origin.mjs';
import {selectionSource} from '../web/store/store-install.js';
import {sourceLabel} from '../web/store/store-source.js';
const TOKEN='gho_TESTONLY'+'x'.repeat(24), SHA_A='a'.repeat(40), SHA_B='b'.repeat(40), SHA_C='c'.repeat(40);
const manifest=(id,extra='')=>`---\nid: ${id}\nname: ${id.toUpperCase()}\nsummary: A friend's app.\ntype: view\nversion: 1.0.0\n${extra}config:\n  password: never-project\n---\n# ${id}`;
const items=[{full_name:'friend/secret-app',private:true},{full_name:'friend/broken-app',private:true},{full_name:'friend/public-app',private:false},{full_name:'bad name/x y',private:true}];
// A mocked GitHub: only the documented endpoints answer, every request is recorded.
function github({repos=items,manifests={'friend/secret-app':manifest('secret-app'),'friend/broken-app':'no frontmatter here'},shas={'friend/secret-app':SHA_A,'friend/broken-app':SHA_B,'friend/public-app':SHA_C},fail=false}={}) {
  const calls=[];
  const fetchImpl=async(url,opts)=>{
    calls.push({url,opts}); const u=new URL(url);
    assert.equal(u.origin,'https://api.github.com'); assert.equal(opts.redirect,'error');
    if(fail) return new Response('{}',{status:500});
    if(u.pathname==='/search/repositories') return Response.json({items:repos});
    const m=/^\/repos\/([^/]+\/[^/]+)\/(commits\/HEAD|contents\/wizard\.md)$/.exec(u.pathname);
    if(!m) return new Response('{}',{status:404});
    if(m[2]==='commits/HEAD') return Response.json({sha:shas[m[1]]});
    assert.equal(u.searchParams.get('ref'),shas[m[1]]); return new Response(manifests[m[1]] ?? 'x');
  };
  return {calls,fetchImpl};
}
const q=(s={})=>new URLSearchParams(s);
test('no credential: no request and no Beta rows',async()=>{
  const g=github(), beta=createBetaSource({fetchImpl:g.fetchImpl,readToken:()=>''});
  assert.deepEqual(await beta({force:true}),{signedIn:false,rows:[],stale:false,error:null}); assert.deepEqual(g.calls,[]);
});
test('a private wizard-app repository becomes a Beta row; public, malformed and unreadable ones do not',async()=>{
  const g=github(), beta=createBetaSource({fetchImpl:g.fetchImpl,readToken:()=>TOKEN}), r=await beta();
  assert.equal(r.signedIn,true); assert.equal(r.rows.length,1);
  const row=r.rows[0];
  assert.deepEqual([row.id,row.repo,row.commit,row.source,row.channel,row.private,row.type,row.publisher],['secret-app','friend/secret-app',SHA_A,'beta','standard',true,'view','friend']);
  assert.ok(!JSON.stringify(r).includes('never-project'));
  assert.ok(g.calls.every(c=>c.opts.headers.Authorization==='Bearer '+TOKEN));
  assert.ok(!g.calls.some(c=>/public-app|bad%20name/.test(c.url)), 'public and malformed names are never fetched');
  assert.match(g.calls[0].url,/^https:\/\/api\.github\.com\/search\/repositories\?q=topic%3Awizard-app/);
});
test('cached for the TTL, bypassed by Refresh, manifest re-read only when HEAD moves',async()=>{
  let t=0; const g=github(), beta=createBetaSource({fetchImpl:g.fetchImpl,readToken:()=>TOKEN,now:()=>t});
  await beta(); const first=g.calls.length; t=1000; await beta(); assert.equal(g.calls.length,first);
  t=2000; await beta({force:true}); const contents=g.calls.filter(c=>/contents/.test(c.url));
  assert.equal(g.calls.length>first,true); assert.equal(contents.filter(c=>/secret-app/.test(c.url)).length,1,'same SHA => manifest cached');
  t=10*60*1000; await beta(); assert.ok(g.calls.length>first+2);
});
test('a failed refresh keeps the last rows and says so; first failure is empty and stale',async()=>{
  let bad=false; const g=github(), flaky=async(u,o)=>bad?new Response('{}',{status:502}):g.fetchImpl(u,o);
  const beta=createBetaSource({fetchImpl:flaky,readToken:()=>TOKEN});
  await beta(); bad=true; const r=await beta({force:true});
  assert.equal(r.rows.length,1); assert.equal(r.stale,true); assert.equal(r.error,'beta_unavailable');
  const first=await createBetaSource({fetchImpl:async()=>{throw Error('offline '+TOKEN);},readToken:()=>TOKEN})();
  assert.deepEqual([first.rows.length,first.stale,first.error],[0,true,'beta_unavailable']); assert.ok(!JSON.stringify(first).includes(TOKEN));
});
test('response size caps: an oversized wizard.md or search result is refused',async()=>{
  const big=github({manifests:{'friend/secret-app':manifest('secret-app','x: '+'y'.repeat(70*1024)+'\n'),'friend/broken-app':manifest('broken-app')}});
  const r=await createBetaSource({fetchImpl:big.fetchImpl,readToken:()=>TOKEN})();
  assert.deepEqual(r.rows.map(x=>x.id),['broken-app']);
  const huge=await createBetaSource({fetchImpl:async()=>new Response('{"items":[],"pad":"'+'z'.repeat(2*1024*1024+10)+'"}'),readToken:()=>TOKEN})();
  assert.deepEqual([huge.rows.length,huge.error],[0,'beta_unavailable']);
});
test('signing out clears rows at once; a different account never sees the previous one',async()=>{
  let tok=TOKEN; const g=github(), beta=createBetaSource({fetchImpl:g.fetchImpl,readToken:()=>tok});
  assert.equal((await beta()).rows.length,1); tok=''; const n=g.calls.length;
  assert.deepEqual(await beta(),{signedIn:false,rows:[],stale:false,error:null}); assert.equal(g.calls.length,n);
  tok='gho_TESTONLY'+'y'.repeat(24); const other=github({repos:[]}); const b2=createBetaSource({fetchImpl:other.fetchImpl,readToken:()=>tok});
  assert.equal((await b2()).rows.length,0);
});
test('the Beta source merges into the catalog: Beta label, own status, Refresh forwarded; signed out hides it',async()=>{
  let tok=TOKEN; const g=github(), betaRead=createBetaSource({fetchImpl:g.fetchImpl,readToken:()=>tok});
  const proxy=withPrivateCatalog(async()=>({status:200,body:{apps:[{id:'public-one',repo:'o/public-one',name:'Public'}],next_offset:null}}),()=>[],{sourceRead:()=>null,betaRead});
  let r=await proxy('/search',q({limit:'100'})); const row=r.body.apps.find(a=>a.id==='secret-app');
  assert.ok(row); assert.equal(sourceLabel(row).label,'Beta'); assert.equal(row.private,true);
  assert.deepEqual(r.body.sources.at(-1),{id:'beta',name:'Beta (GitHub)',stale:false,error:null});
  assert.equal((await proxy('/apps/friend/secret-app',q())).body.commit,SHA_A);
  const n=g.calls.length; await proxy('/search',q({refresh:'1'})); assert.ok(g.calls.length>n,'refresh=1 bypasses the cache');
  tok=''; r=await proxy('/search',q({limit:'100'}));
  assert.equal(r.body.apps.some(a=>a.id==='secret-app'),false); assert.ok(!r.body.sources.some(s=>s.id==='beta'));
});
test('same repository in the public index and Beta stays one row with both releases',async()=>{
  const g=github(), betaRead=createBetaSource({fetchImpl:g.fetchImpl,readToken:()=>TOKEN});
  const proxy=withPrivateCatalog(async()=>({status:200,body:{apps:[{id:'secret-app',repo:'friend/secret-app',name:'Public',commit:'d'.repeat(40),source:'standard'}],next_offset:null}}),()=>[],{sourceRead:()=>null,betaRead});
  const rows=(await proxy('/search',q())).body.apps.filter(a=>a.id==='secret-app');
  assert.equal(rows.length,1); assert.deepEqual(rows[0].releases.map(x=>x.source).sort(),['beta','standard']);
});
test('the token appears in no adapter response, log line or error text',async()=>{
  const seen=[], orig={}; for(const k of ['log','info','warn','error','debug']){orig[k]=console[k];console[k]=(...a)=>seen.push(a.map(String).join(' '));}
  const g=github(), route=createStoreDataRoutes({fetchImpl:g.fetchImpl,readWam:()=>({apps:[]}),readRuntipi:()=>{throw Error('no runtipi '+TOKEN);},
    index:withPrivateCatalog(async()=>({status:200,body:{apps:[],next_offset:null}}),()=>[],{sourceRead:()=>null,betaRead:createBetaSource({fetchImpl:g.fetchImpl,readToken:()=>TOKEN})})});
  const s=http.createServer(route); await new Promise(r=>s.listen(0,'127.0.0.1',r));
  try {
    const base=`http://127.0.0.1:${s.address().port}${PREFIX}`; const bodies=[];
    for(const p of ['wizard/v1/index/search?refresh=1','wizard/v1/index/tags','wizard/v1/index/apps/friend/secret-app','wizard/v1/link?repo=friend/secret-app','api/apps/installed']) {
      const r=await fetch(base+p); bodies.push(r.status+' '+JSON.stringify([...r.headers])+await r.text());
    }
    assert.ok(bodies[0].startsWith('200')&&bodies[0].includes('secret-app'));
    assert.ok(!bodies.join('\n').includes(TOKEN)); assert.ok(!seen.join('\n').includes(TOKEN));
  } finally { Object.assign(console,orig); s.close(); }
});
test('a Beta row installs through the existing link selection; an installed Beta app stays Beta',()=>{
  assert.equal(selectionSource('beta'),'link'); for(const s of ['standard','wizard-alpha','link','owner-private']) assert.equal(selectionSource(s),s);
  const app={source:'beta',repo:'friend/secret-app',private:true};
  assert.equal(sourceLabel(app,{source:'link',repo:'friend/secret-app'}).kind,'beta');
  assert.equal(sourceLabel(app,{source:'link',repo:'other/repo'}).kind,'link');
  assert.equal(sourceLabel({source:'standard',repo:'o/r'},{source:'link',repo:'o/r'}).kind,'link');
});
