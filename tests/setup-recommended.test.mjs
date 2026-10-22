import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(new URL('../web/setup/recommended.js', import.meta.url), 'utf8');
const selection = {source:'standard',repo:'org/cloudflare',commit:'a'.repeat(40),operation:'install'};
const rows = [{id:'wizard-cloudflare',name:'Cloudflare',summary:'Publish sites',installed:false,selection},
  {id:'wizard-connectors',name:'Connected accounts',summary:'Google',installed:false,selection:null,unavailable:'Not published yet'}];
const tick = () => new Promise(r => setImmediate(r));
async function harness(reply, visible = () => true) {
  const calls=[], messages=[], listeners={};
  const window={};
  const context={window,parent:{postMessage:(m,o)=>messages.push([m,o])},location:{origin:'https://box.example'},
    document:{addEventListener:(e,f)=>listeners[e]=f},addEventListener:(e,f)=>listeners[e]=f,
    setTimeout:f=>{f();},fetch:async(url,options={})=>{
      calls.push({url,...options});
      const [status, data] = await reply(url,options);
      return {ok:status>=200 && status<300,status,json:async()=>data};
    }};
  vm.runInNewContext(src,context);
  const R=window.WosRecommended;
  R.init(()=>{},visible); await R.load();
  const click = id => listeners.click({target:{closest:s=>s==='[data-recommended]'?{dataset:{recommended:id}}:null}});
  return {R,calls,messages,click,listeners};
}
test('single list shows optional apps; unpublished app is disabled',async()=>{
  const {R}=await harness(()=>[200,{apps:rows}]);
  const html=R.html();
  assert.equal((html.match(/Recommended next/g)||[]).length,2); // label and heading, one section
  assert.match(html,/data-recommended="wizard-connectors" disabled/);
  assert.match(html,/Install and sign in/);
});
test('one tap uses existing exact Store selection, polls and opens app sign-in',async()=>{
  let posts=0;
  const {calls,messages,click}=await harness((url,o)=>{
    if(url.endsWith('_recommended')) return [200,{apps:structuredClone(rows)}];
    if(o.method==='POST') {posts++; return [202,{state:'installing'}];}
    return [200,{state:'installed',selection}];
  });
  click('wizard-cloudflare'); click('wizard-cloudflare');
  await tick(); await tick();
  assert.equal(posts,1);
  const post=calls.find(c=>c.method==='POST');
  assert.deepEqual(JSON.parse(post.body),selection);
  assert.equal(post.headers['X-Wizard-Store'],'1');
  assert.equal(post.credentials,'same-origin');
  assert.deepEqual(JSON.parse(JSON.stringify(messages.map(m=>m[0]))),[
    {type:'wizard:apps-changed',id:'wizard-cloudflare'}, {type:'wizard:open-app',id:'wizard-cloudflare'}]);
});
test('failed or mismatched install never opens sign-in and retains retry',async()=>{
  for(const result of [{state:'failed',error:'Pull failed'},{state:'installed',selection:{...selection,commit:'b'.repeat(40)}}]) {
    const {R,click,messages}=await harness((url)=>url.endsWith('_recommended')?[200,{apps:structuredClone(rows)}]:[200,result]);
    click('wizard-cloudflare'); await tick();
    assert.equal(messages.length,0); assert.match(R.html(),/Install and sign in/);
    assert.match(R.html(),/Pull failed|did not match/);
  }
});
test('does not steal focus if owner left Setup during installation',async()=>{
  const {click,messages,R}=await harness(url=>url.endsWith('_recommended')?[200,{apps:structuredClone(rows)}]:[200,{state:'installed',selection}],()=>false);
  click('wizard-cloudflare'); await tick();
  assert.equal(messages.filter(m=>m[0].type==='wizard:open-app').length,0);
  assert.match(R.html(),/Open sign-in/);
});
test('prefetch asks only WAM policy; never browser URLs or install recipes',async()=>{
  const {R,calls}=await harness(()=>[200,{apps:rows}]);
  await R.prefetch();
  const post=calls.find(c=>c.method==='POST');
  assert.equal(post.url,'../store-install/_recommended');
  assert.deepEqual(JSON.parse(post.body),{});
});
test('Setup triggers prefetch only after successful seen or already-seen read',()=>{
  const setup=readFileSync(new URL('../web/setup/setup.js',import.meta.url),'utf8');
  assert.match(setup,/if \(r\.data\.first_run === false\) window\.WosRecommended\?\.prefetch\(\)/);
  assert.match(setup,/if \(r\.kind !== 'ok'\) S\.seenPosted = false;[^\n]*\n    else window\.WosRecommended\?\.prefetch\(\)/);
});
test('missing manager renders retry instead of hiding recommendations',async()=>{
  const {R}=await harness(()=>[404,{}]);
  assert.match(R.html(),/Recommendations aren’t available right now/);
  assert.match(R.html(),/data-recommended-retry/);
});
