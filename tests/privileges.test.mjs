import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import http from 'node:http';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {managerSettings, privilegeMetadata, readPrivilegeStatus} from '../tools/privilege-status.mjs';
import {createStoreDataRoutes, PREFIX} from '../tools/store-data-origin.mjs';
const source = readFileSync(new URL('../web/core/privileges.js', import.meta.url), 'utf8');
const approval = {error:'needs_owner_approval',app:'files',risks:['app: privileged (full control of the server)','app: mounts host path /srv at /host (writable) outside app-data and owner files'],approve_url:'/wizard-os-home/store-install/_approve/files/'+'a'.repeat(64)};
function harness(reply = () => ({enabled:false,server_access:{active:false}})) {
  const calls = [], events = {}, style = {}, registered = [];
  const host = {innerHTML:'',hidden:true,getBoundingClientRect:() => ({height:64})};
  const document = {hidden:false,currentScript:{hasAttribute:() => true},getElementById:() => host,documentElement:{style:{setProperty:(k,v) => style[k]=v}},addEventListener:(k,f) => events[k]=f};
  const w = {document,Date,AbortSignal,Event,clearTimeout:() => {},setTimeout:() => 1,fetch:async(url,opts) => {calls.push({url,opts});return {ok:true,json:async() => reply()};},WosSettings:{register:g => registered.push(g),refresh(){}},dispatchEvent(){},addEventListener:(k,f) => events[k]=f};
  w.window=w; vm.createContext(w); vm.runInContext(source,w);
  return {P:w.WosPrivileges,w,calls,host,style,registered};
}
test('approval card renders everyday risks and links approve_url, never calls an approve endpoint itself', () => {
  const {P,calls} = harness(); const html = P.approvalHtml(approval,'Files');
  assert.match(html,/read(?:ing)? and chang(?:e|ing) files anywhere on/);
  assert.match(html,/href="\/wizard-os-home\/store-install\/_approve\/files\/a{64}"/);
  assert.equal((html.match(/>Approve<\/a>/g)||[]).length,1);
  assert.doesNotMatch(html,/onclick|<form|privileged|compose|cap_add/);
  assert.equal(calls.length,0);
});
test('approval card escapes names and refuses arbitrary or malformed approval destinations', () => {
  const {P} = harness();assert.match(P.approvalHtml(approval,'<script>'),/&lt;script&gt;/);
  for (const url of ['javascript:alert(1)','https://elsewhere.invalid'+approval.approve_url,approval.approve_url+'?x=1',approval.approve_url+'#x','//evil.invalid/approve']) assert.equal(P.approvalHtml({...approval,approve_url:url}), '');
  assert.equal(P.approvalHtml({...approval,app:'../files'}),'');
});
test('install, update and restore refusals survive direct JSON and terminal stderr wrappers', () => {
  const {P} = harness();
  for (const input of [approval,JSON.stringify(approval),{stderr:'operation refused\n'+JSON.stringify(approval)+'\n'},{content:[{type:'text',text:JSON.stringify({output:JSON.stringify(approval)})}]}]) assert.equal(P.from(input)?.approve_url,approval.approve_url);
  assert.equal(P.from({error:'other'}),null);
});
test('all host policy risk families get everyday sentences and unknown requests stay cautious', () => {
  const {P} = harness();
  for (const r of ['app: network_mode: host','app: devices requires host access','app: cap_add requires host access','app: env_file reads a host file','app: pid: host','volume x: external/custom host storage: {}','unknown']) {
    const s=P.riskSentence(r);assert.ok(s.length>30);assert.doesNotMatch(s,/compose|cap_add|env_file|sysctls|pid:|socket/);
  }
});
test('developer banner is present iff developer mode is enabled, with a return link not a write', () => {
  const {P} = harness();
  for (const doc of [null,{}, {enabled:false}]) assert.equal(P.bannerHtml(doc),'');
  assert.match(P.bannerHtml({enabled:true}),/This box runs personal builds/);
  assert.match(P.bannerHtml({enabled:true}),/_approve\/developer[^]*>Return to release<\/a>/);
});
test('red server access row is present iff server access is active, independent of developer mode', () => {
  const {P} = harness();
  for (const doc of [null,{}, {enabled:true,server_access:{active:false}}]) assert.equal(P.accessHtml(doc),'');
  const doc={enabled:false,server_access:{active:true,expires_at:'2026-11-01T12:00:00Z'}};
  assert.match(P.accessHtml(doc),/class="wz-server-access" data-server-access="active"/);
  assert.match(P.accessHtml(doc),/Your agent has full server access until/);
  assert.ok(P.accessText(doc).includes(new Date(doc.server_access.expires_at).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})));
  assert.match(P.accessHtml(doc),/_approve\/developer[^]*Turn off server access/);
});
test('drift warning appears only when protections changed and never prints raw server paths', () => {
  const {P} = harness(); const doc={server_access:{active:true,expires_at:null,drift:['/srv/private/protection']}};
  assert.match(P.accessHtml(doc),/Server protections changed/);assert.doesNotMatch(P.accessHtml(doc),/\/srv\/private/);
  assert.doesNotMatch(P.accessHtml({server_access:{active:true,drift:[]}}),/Server protections changed/);
});
test('polling is read-only and preserves a visible warning when status goes offline', async () => {
  let fail=false;
  const h=harness(() => {if(fail) throw Error('offline');return {enabled:true,server_access:{active:true,expires_at:'2026-11-01T12:00:00Z'}};});
  await h.P.load();assert.equal(h.host.hidden,false);assert.equal(h.style['--wz-privilege-banner-height'],'64px');
  fail=true;await h.P.load();assert.match(h.P.accessHtml(),/Can’t check the latest access/);assert.match(h.P.bannerHtml(),/last reading/);
  assert.ok(h.calls.every(c => c.opts.method===undefined && c.opts.cache==='no-store'));
});
test('status projection exposes only display fields, never source, tokens, agent identity or drift paths', () => {
  const j=privilegeMetadata({enabled:true,source:{repo:'secret'},server_access:{active:true,expires_at:'2026-11-01T12:00:00Z',agent:'secret',drift:['secret'],token:'secret'}});
  assert.equal(j.server_access.severity,'red');assert.deepEqual(j.server_access.drift,['changed']);assert.ok(!JSON.stringify(j).includes('secret'));
  assert.throws(() => privilegeMetadata({enabled:true,server_access:{active:'yes'}}));
});
test('status reader uses the thin client loopback settings and exact GET API without redirects', async () => {
  const home=mkdtempSync(join(tmpdir(),'privilege-client-'));
  try {writeFileSync(join(home,'client.json'),JSON.stringify({url:'http://127.0.0.1:7790'}));writeFileSync(join(home,'agent-token'),'x'.repeat(32));assert.equal(managerSettings(home).origin,'http://127.0.0.1:7790');
    for (const url of ['https://elsewhere.invalid','http://127.0.0.1:7790/api','http://user@127.0.0.1:7790','http://127.0.0.1:0']) {writeFileSync(join(home,'client.json'),JSON.stringify({url}));assert.throws(() => managerSettings(home));}
  } finally {rmSync(home,{recursive:true,force:true});}
  let call;
  await readPrivilegeStatus({settings:() => ({origin:'http://127.0.0.1:7790',token:'test'}),fetchImpl:async(url,opts) => {call={url,opts};return new Response(JSON.stringify({enabled:false,server_access:{active:false}}));}});
  assert.equal(call.url,'http://127.0.0.1:7790/api/status');assert.equal(call.opts.redirect,'error');assert.equal(call.opts.method,undefined);
});
test('browser status route refuses writes, queries and cross-site reads and returns generic failures', async () => {
  let fail=false;
  const s=http.createServer(createStoreDataRoutes({readPrivileges:async() => {if(fail)throw Error('private');return {enabled:false,server_access:{active:false}};}}));
  await new Promise(r=>s.listen(0,'127.0.0.1',r)); const base='http://127.0.0.1:'+s.address().port+PREFIX+'wizard/v1/privilege-status';
  try {assert.equal((await fetch(base,{method:'POST'})).status,405);assert.equal((await fetch(base+'?x=1')).status,400);assert.equal((await fetch(base,{headers:{'sec-fetch-site':'cross-site'}})).status,403);const ok=await fetch(base);assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'no-store');assert.equal((await fetch(base,{method:'HEAD'})).status,200);fail=true;const r=await fetch(base);assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'privilege_status_unavailable'});}finally{s.closeAllConnections();await new Promise(r=>s.close(r));}
});
test('shell registration happens after Settings on both shells and contributes server access to Resources', async () => {
  for (const f of ['index.html','desktop.html']) {
    const html=readFileSync(new URL('../web/'+f,import.meta.url),'utf8');
    assert.ok(html.indexOf('src="core/settings.js"')<html.indexOf('src="core/privileges.js"'));
  }
  const h=harness();h.w.document.currentScript.hasAttribute=() => false;vm.runInContext(source,h.w);
  await h.w.WosPrivileges.load();
  assert.equal(h.registered.length,1);assert.equal(h.registered[0].id,'server-access');assert.equal(h.registered[0].page,'usage');
});

test('chat approval remains visible outside collapsed activity and duplicate tool receipts do not duplicate cards', () => {
  const {w,P}=harness();vm.runInContext(readFileSync(new URL('../web/core/chat-work.js',import.meta.url),'utf8'),w);
  const html=w.WosWork.html({u:{at:0},work:[{at:10,ownerApproval:approval},{at:11,ownerApproval:approval}]},{live:false,open:false,key:'turn',now:50,md:String,esc:String,clip:String});
  assert.equal((html.match(/>Approve<\/a>/g)||[]).length,1);assert.match(html,/needs your approval/);
  assert.equal(P.approvalHtml(approval).includes('<form'),false);
});
