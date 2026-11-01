import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
const source = fs.readFileSync(new URL('../web/core/browser-boundary.js', import.meta.url), 'utf8');
const TOKEN = 'd1'.repeat(32);
function harness(secret = TOKEN) {
  const messages = [], requests = [], events = new Map();
  const node = secret === null ? null : { content: secret, remove() { this.removed = true; } };
  const document = { querySelector: () => node, activeElement: null };
  const sandbox = { document, location: { origin: 'https://box.example.test', href: 'https://box.example.test/wizard-os-home/desktop.html' },
    Request, Headers, URL, TextEncoder, crypto: webcrypto, Map, Promise, Object, setTimeout: (fn, ms) => setTimeout(fn, ms === 1200 ? 20 : ms), clearTimeout,
    addEventListener: (name, fn) => events.set(name, fn), fetch: async request => { requests.push(request); return new Response('{}'); } };
  sandbox.window = sandbox; sandbox.parent = sandbox;
  vm.runInNewContext(source, sandbox);
  const frameEvents = new Map(), classes = new Set();
  const host = { classList: { add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v) } };
  const frame = { isConnected: true, matches: () => true, sandbox: { contains: () => false },
    getClientRects: () => [{}], closest: s => s === '.win' ? host : null,
    addEventListener: (name, fn) => frameEvents.set(name, fn), removeEventListener: name => frameEvents.delete(name),
    contentWindow: { postMessage: (data, origin) => messages.push({ data, origin }) } };
  let port;
  const reply = (data, origin = 'null', from = frame.contentWindow) => {
    const body={ type:'wizard:boundary',version:1,channel:messages.at(-1)?.data.channel,...data };
    if (data.op === 'ready' && origin === 'null' && from === frame.contentWindow) {
      port={start(){},close(){this.closed=true;},postMessage(d){messages.push({data:d,port:true});if(d.op==='challenge')this.onmessage({data:{type:'wizard:boundary',version:1,channel:d.channel,op:'challenge.reply',nonce:d.nonce}});}};
      events.get('message')({data:{...body,portRole:'document'},origin,source:from,ports:[port]});
    } else if (origin === 'null' && from === frame.contentWindow && port && !port.closed) port.onmessage({data:body});
    else events.get('message')({data:body,origin,source:from,ports:[]});
  };
  return { sandbox, node, frame, frameEvents, messages, requests, reply, document, classes };
}

test('no bootstrap element means no feature and the original fetch is untouched', () => {
  const h = harness(null); assert.equal(h.sandbox.WizBrowserBoundary, undefined);
  assert.equal(h.requests.length, 0);
});
test('the only secret is consumed into a closure, not serialized on the bridge', async () => {
  const h = harness(); assert.equal(h.node.removed, true);
  assert.equal(JSON.stringify(h.sandbox.WizBrowserBoundary).includes(TOKEN), false);
  await h.sandbox.fetch('/wizard/v1/settings');
  assert.equal(h.requests[0].headers.get('X-Wizard-Shell-Token'), TOKEN);
  assert.equal(h.requests[0].redirect, 'error');
  await h.sandbox.fetch('/fixture-app/api/state');
  await h.sandbox.fetch('https://elsewhere.example/wizard/v1/settings');
  await h.sandbox.fetch('/wizard/mcp');
  for (const request of h.requests.slice(1)) assert.equal(request.headers.has('X-Wizard-Shell-Token'), false);
  assert.equal(h.sandbox.WizBrowserBoundary.fetch, undefined);
});
test('Request body and non-secret headers survive the owner-only wrapper', async () => {
  const h = harness();
  await h.sandbox.fetch(new Request('https://box.example.test/wizard/v1/setup/seen', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', 'X-Test': 'fixture' } }));
  assert.equal(await h.requests[0].text(), '{}');
  assert.equal(h.requests[0].headers.get('X-Test'), 'fixture');
  assert.equal(h.requests[0].headers.get('X-Wizard-Shell-Token'), TOKEN);
});
test('Back requires the exact opaque source+channel; a timeout never steps the shell', async () => {
  const h = harness(), api = h.sandbox.WizBrowserBoundary; const detach = api.attach(h.frame);
  assert.equal(h.messages[0].origin, '*');
  h.reply({ op: 'ready' }, 'https://box.example.test');
  assert.equal(await api.back(h.frame), 'stay');
  h.reply({ op: 'ready' });
  let stepped = 0; const result = api.back(h.frame, () => stepped++);
  const id = h.messages.at(-1).data.id;
  h.reply({ op: 'reply', id, status: 'atRoot' }, 'null', {});
  assert.equal(await result, 'stay'); assert.equal(stepped, 0);
  const next = api.back(h.frame, () => stepped++);
  h.reply({ op: 'reply', id: h.messages.at(-1).data.id, status: 'atRoot' });
  await next; assert.equal(stepped, 1); detach();
});
test('navigation and detach revoke pending pins and old channel replies', async () => {
  const h = harness(), api = h.sandbox.WizBrowserBoundary; const detach = api.attach(h.frame);
  h.reply({ op: 'ready' }); h.document.activeElement = h.frame;
  const pin = api.pinField(h.frame); const previous = h.messages.at(-1).data;
  h.frameEvents.get('load')();
  h.reply({ op: 'reply', id: previous.id, channel: previous.channel, status: 'pinned', seal: 'old' });
  assert.equal(await pin, null);
  h.reply({ op: 'ready' }); const second = api.pinField(h.frame);
  h.reply({ op: 'reply', id: h.messages.at(-1).data.id, status: 'pinned', seal: 'new' });
  const seal = await second; assert.ok(seal); detach();
  assert.equal(await seal.insert('must not deliver'), false);
});
test('appearance marker requires acknowledgement of the current revision', () => {
  const h = harness(), api = h.sandbox.WizBrowserBoundary; api.attach(h.frame); h.reply({ op: 'ready' });
  api.theme(h.frame, { revision: 7 });
  h.reply({ op: 'theme.applied', revision: 6 }); assert.equal(h.classes.has('wz-themed'), false);
  h.reply({ op: 'theme.applied', revision: 7 }); assert.equal(h.classes.has('wz-themed'), true);
  h.frameEvents.get('load')(); assert.equal(h.classes.has('wz-themed'), false);
});
test('adapter port rejects unknown, forged identity, replay and stale generation before disclosure', async () => {
  const h=harness(), api=h.sandbox.WizBrowserBoundary;let granted=true;
  api.attach(h.frame,{appId:'fixture-list',authorize:()=>granted});h.reply({op:'ready'});
  const request=(id,method,args,extra={})=>h.reply({op:'service.request',id,method,args,...extra});
  const settle=()=>new Promise(r=>setImmediate(r));
  request('wbs-1','owner.fetch',{});await settle();assert.equal(h.messages.at(-1).data.error.code,'not_allowed');
  request('wbs-1','owner.fetch',{});assert.equal(h.messages.at(-1).data.error.code,'replay');
  request('wbs-2','data.call',{operation:'fixture.notifications.list',args:{limit:2},appId:'fixture-drafts'});await settle();assert.equal(h.messages.at(-1).data.error.code,'bad_request');
  const count=h.messages.length, calls=h.requests.length;
  request('wbs-3','data.call',{operation:'fixture.notifications.list',args:{limit:2}},{channel:'stale-generation'});await settle();assert.equal(h.messages.length,count);assert.equal(h.requests.length,calls);
  granted=false;request('wbs-4','data.call',{operation:'fixture.notifications.list',args:{limit:2}});await settle();assert.equal(h.messages.length,count);
});
test('temporary binding creation failure can recover on same channel',async()=>{
 const h=harness();h.sandbox.WizBrowserBoundary.attach(h.frame,{appId:'fixture-list',authorize:()=>true});h.reply({op:'ready'});
 let attempts=0;h.sandbox.fetch=async()=>{if(++attempts===1)throw new Error('temporary');return new Response('{}');};
 const send=id=>h.reply({op:'service.request',id,method:'data.call',args:{operation:'fixture.notifications.list',args:{limit:2}}});
 send('wbs-1');await new Promise(r=>setImmediate(r));assert.equal(h.messages.at(-1).data.error.code,'backend_failed');
 send('wbs-2');await new Promise(r=>setImmediate(r));assert.equal(attempts,3);assert.equal(h.messages.at(-1).data.error,undefined);
});
test('the shell has no same-origin, popup or top-navigation sandbox exception', () => {
  assert.equal(harness().sandbox.WizBrowserBoundary.frameAttributes(), 'sandbox="allow-scripts allow-forms allow-downloads" referrerpolicy="no-referrer"');
});
