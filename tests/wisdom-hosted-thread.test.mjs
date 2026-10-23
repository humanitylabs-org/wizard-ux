// Wisdom's Ask AI is the real Chats thread laid over the Wisdom window (James, 22 Oct 2026: "we already have a fully
// functional chat interface"). The passage rides beside that thread's draft as a reply item, quoted as data on send.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const chats = read('web/core/chats.js'), services = read('web/core/app-services.js'), client = read('web/core/app-client.js');
const app = read('web/app.js'), desktop = read('web/desktop/desktop.js');

test('Manager and Wisdom are the admitted hosts, in both lists', () => {
  assert.match(chats, /const HOSTED_APPS = new Set\(\['wizard-manager', 'wisdom'\]\);/);
  assert.match(services, /const HOSTED_THREAD_APPS = new Set\(\['wizard-manager', 'wisdom'\]\);/);
  assert.match(chats, /!HOSTED_APPS\.has\(w\.appId\)/);
});

test('openThread forwards an app-keyed reply item; foreign keys are refused', () => {
  assert.match(client, /openThread: \(id, opts\) => service\?\.nav\?\.openThread\(id, opts\) === true/);
  assert.match(services, /if \(!key\.startsWith\(st\.appId \+ ':'\)\) throw fault\('Reply context must be keyed to this app'\);/);
  assert.match(services, /hostedThreadAuthorized\(st\) \|\| st\.isVisible/);
  for (const src of [app, desktop]) assert.match(src, /openThread: \(sid, opts\) => CHATS\.openHosted\(w\.id, f, sid, opts\)/);
});

test('the item pins to the thread draft once and shows as the reply bubble', () => {
  assert.match(chats, /if \(rp && sid !== '__new__' && !KIT\.drafts\.get\('direct:' \+ sid\)\.reply\) KIT\.drafts\.setReply\('direct:' \+ sid, rp\);/);
  assert.match(chats, /const r = w\.thread && \(w\.thread !== '__new__' \|\| !winAgent\(w\)\) \? KIT\.drafts\.get\(draftKey\(w\)\)\.reply : null;/);
});

test('agent-aware hosted navigation pins a known running non-main agent before opening', () => {
  const effects = [], hosted = new Map(), w = {};
  const frame = {isConnected:true, closest: () => ({dataset:{win:'w'}}), style:{}, parentElement:{style:{position:'relative'}, append(){}}};
  const A = {get: id => id === 'philosopher' ? {status:'running'} : id === 'stopped' ? {status:'stopped'} : id === 'hermes' ? {status:'running'} : null, isOther: id => id !== 'hermes'};
  const sandbox = {W:{w}, HOSTED_APPS:new Set(['wisdom']), window:{WosAgents:A}, LIVE:{pinAgent:(...args) => effects.push(['pin',...args])},
    KIT:{reply:{clean:r=>r}}, hosted, closeHosted(){}, document:{createElement:()=>({style:{},dataset:{}})}, getComputedStyle:()=>({position:'relative'}), openChat:(...args)=>effects.push(['open',...args])};
  w.appId = 'wisdom';
  const fn = chats.slice(chats.indexOf('  function openHosted('), chats.indexOf('  function closeHosted('));
  vm.runInNewContext(fn + '; this.openHosted = openHosted;', sandbox);
  for (const agent of ['unknown','stopped','hermes',{},'']) assert.equal(sandbox.openHosted('w',frame,'sid',{agent}), false);
  assert.deepEqual(effects, []);
  assert.equal(sandbox.openHosted('w',frame,'sid',{agent:'philosopher'}), true);
  assert.deepEqual(effects, [['pin','sid','philosopher'],['open','w','sid']]);
  assert.match(services, /a\.status !== 'running' \|\| !window\.WosAgents\.isOther\(agent\)/);
  assert.match(client, /get threadAgents\(\) \{ return service\?\.nav\?\.threadAgents === true; \}/);
});

test('Manager-only link ownership is unchanged', () => {
  assert.match(services, /function managerAuthorized\(st\) \{\n    if \(!st \|\| st\.appId !== 'wizard-manager'/);
});
