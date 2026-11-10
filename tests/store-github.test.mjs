import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeStatus, githubStatus, githubStart, githubSignOut, githubSheet, shouldPoll} from '../web/store/store-github.js';
import {ownerRequest} from '../web/store/store-install.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const base='https://box.test/wizard-os-home/';
const view=(model)=>githubSheet(model,{esc});
const pending={state:'pending',user_code:'ABCD-1234',verification_uri:'https://github.com/login/device',expires_in:899};
test('status is rebuilt from validated scalars; nothing else is kept',()=>{
  assert.deepEqual(normalizeStatus({state:'signed_in',login:'friend',source:'file',access_token:'gho_TESTONLY',device_code:'secret',user_code:'ABCD-1234'}),
    {state:'signed_in',login:'friend',source:'file',user_code:'',verification_uri:'https://github.com/login/device',expires_in:0});
  assert.equal(normalizeStatus({state:'signed_in',login:'<img src=x>'}).login,'');
  assert.equal(normalizeStatus({state:'signed_in',login:'friend',source:'env'}).source,'env');
  assert.equal(normalizeStatus({state:'bogus'}).state,'error'); assert.equal(normalizeStatus(null).state,'error');
  assert.equal(normalizeStatus({state:'pending'}).state,'error','a pending flow without a valid code is not shown as one');
  assert.equal(normalizeStatus({state:'pending',user_code:'<b>',verification_uri:'https://evil.test/'}).state,'error');
  assert.equal(normalizeStatus({...pending,verification_uri:'https://evil.test/login/device'}).verification_uri,'https://github.com/login/device');
  assert.equal(normalizeStatus({...pending,expires_in:1e9}).expires_in,3600);
  assert.equal(normalizeStatus({state:'signed_out',user_code:'ABCD-1234',expires_in:5}).user_code,'');
});
test('requests use the owner gate: same origin, no cache, JSON + Store marker only on writes',async()=>{
  const calls=[]; const fetchImpl=async(url,o)=>{calls.push({url,o});return Response.json({state:'signed_out'});};
  await githubStatus({base,fetchImpl}); await githubStart({base,fetchImpl}); await githubSignOut({base,fetchImpl});
  assert.deepEqual(calls.map(c=>[c.o.method,c.url]),[['GET',base+'store-install/_github'],['POST',base+'store-install/_github/start'],['POST',base+'store-install/_github/signout']]);
  for(const c of calls){assert.equal(c.o.credentials,'same-origin');assert.equal(c.o.cache,'no-store');}
  assert.equal(calls[0].o.headers,undefined); assert.equal(calls[0].o.body,undefined);
  for(const c of calls.slice(1)){assert.equal(c.o.headers['X-Wizard-Store'],'1');assert.equal(c.o.headers['Content-Type'],'application/json');assert.equal(c.o.body,'{}');}
});
test('server answers: pending with code, not_configured 409, old App Manager 404, plain failures',async()=>{
  const reply=(status,body)=>({base,fetchImpl:async()=>Response.json(body,{status})});
  assert.equal((await githubStart(reply(200,pending))).user_code,'ABCD-1234');
  assert.equal((await githubStart(reply(409,{state:'not_configured'}))).state,'not_configured');
  assert.equal((await githubStart(reply(409,{state:'switched_off'}))).state,'switched_off');
  assert.equal((await githubStatus(reply(200,{state:'switched_off'}))).state,'switched_off');
  await assert.rejects(githubStatus(reply(404,{})),/needs updating/);
  await assert.rejects(githubStart(reply(403,{error:'Only the owner can do this.'})),/Only the owner/);
  await assert.rejects(githubStatus(reply(500,{})),/isn’t available \(500\)/);
});
test('ownerRequest keeps the install gate shape',async()=>{
  let seen; await ownerRequest('store-install/x',{method:'POST',body:{a:1},base,fetchImpl:async(u,o)=>{seen=o;return Response.json({});}});
  assert.deepEqual(seen.headers,{'Content-Type':'application/json','X-Wizard-Store':'1'}); assert.equal(seen.body,'{"a":1}');
});
test('sheet: signed out explains the permission plainly and offers Sign in',()=>{
  const h=view({status:{state:'signed_out'}});
  assert.match(h,/data-gh-start[^>]*>Sign in to GitHub</); assert.match(h,/appear in Apps under Beta/); assert.match(h,/all-or-nothing access to private repositories/);
  assert.doesNotMatch(h,/data-gh-out|data-gh-code/);
});
test('sheet: tap feedback state shows "Getting your code…" with a disabled, busy button',()=>{
  const h=view({status:{state:'signed_out'},busy:'start'});
  assert.match(h,/Getting your code…/); assert.match(h,/disabled aria-busy="true">Sign in to GitHub</);
});
test('sheet: pending shows the code, GitHub link and copy; no polling when hidden',()=>{
  const st=normalizeStatus(pending), h=view({status:st});
  assert.match(h,/data-gh-code[^>]*>ABCD-1234</); assert.match(h,/href="https:\/\/github\.com\/login\/device" target="_blank" rel="noopener noreferrer"/);
  assert.match(h,/Open github\.com\/login\/device/); assert.match(h,/data-gh-copy[^>]*>Copy code</); assert.match(h,/about 15 minutes/);
  assert.match(view({status:st,copied:true}),/>Copied</);
  assert.equal(shouldPoll(st,false),true); assert.equal(shouldPoll(st,true),false);
  for(const s of ['signed_out','signed_in','expired','denied','error','not_configured','switched_off','unknown']) assert.equal(shouldPoll({state:s},false),false,s);
});
test('sheet: signed in shows only the username and Sign out; env sign-in cannot be removed',()=>{
  const h=view({status:normalizeStatus({state:'signed_in',login:'friend'})});
  assert.match(h,/Signed in as <b>friend<\/b>/); assert.match(h,/data-gh-out[^>]*>Sign out</); assert.doesNotMatch(h,/gho_|token/i);
  const env=view({status:normalizeStatus({state:'signed_in',login:'friend',source:'env'})});
  assert.doesNotMatch(env,/data-gh-out/); assert.match(env,/can’t be removed here/);
  assert.match(view({status:normalizeStatus({state:'signed_in'})}),/Signed in to GitHub/);
});
test('sheet: not configured has no button; expired, denied, error and unreachable offer Try again',()=>{
  const nc=view({status:{state:'not_configured'}}); assert.match(nc,/isn’t set up on this WizardOS yet/); assert.doesNotMatch(nc,/<button type="button" class="get/);
  const so=view({status:normalizeStatus({state:'switched_off'})}); assert.match(so,/switched off on this Wizard/); assert.match(so,/Try new features/); assert.doesNotMatch(so,/<button type="button" class="get/);
  for(const [s,re] of [['expired',/code expired/],['denied',/cancelled/],['error',/couldn’t reach GitHub/]]) { const h=view({status:{state:s}}); assert.match(h,re); assert.match(h,/data-gh-start[^>]*>Try again</); }
  const u=view({status:{state:'unknown'},unreachable:true,error:'Offline.'}); assert.match(u,/couldn’t check GitHub sign-in/); assert.match(u,/data-gh-retry/); assert.match(u,/role="alert">Offline\./);
  assert.match(view({status:{state:'unknown'},loading:true}),/Checking GitHub sign-in…/);
});
test('sheet text is escaped',()=>{
  const h=view({status:{state:'signed_out'},error:'<img src=x onerror=alert(1)>'}); assert.doesNotMatch(h,/<img/);
});
