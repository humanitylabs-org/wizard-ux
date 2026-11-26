// Wisdom's Ask AI is the real Chats thread laid over the Wisdom window (James, 22 Oct 2026: "we already have a fully
// functional chat interface"). The passage rides beside that thread's draft as a reply item, quoted as data on send.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { launcherFixture } from './launcher-fixture.mjs';
import { readFileSync } from 'node:fs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withShellParts } from './fixtures/shell-parts.mjs';
import { between, block, runRecording } from './fixtures/source-slice.mjs';
import { appClient } from './fixtures/app-client-harness.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';

const read = p => withShellParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
import { withServicesParts } from './fixtures/app-services-parts.mjs';
const chats = withParts(read('web/core/chats.js')), services = withServicesParts(read('web/core/app-services.js')), client = read('web/core/app-client.js');
const app = read('web/app.js'), desktop = read('web/desktop/desktop.js');

test('Manager and Wisdom use one synced launcher admission policy in both consumers', () => {
  const policy = launcherFixture({ window: {} });
  assert.equal(policy.hasHostedThread('wizard-manager'), true);
  assert.equal(policy.hasHostedThread('wisdom'), true);
  assert.equal(policy.hasHostedThread('other-app'), false);
  // both consumers run below: Chats' openHosted refuses an app outside the policy (the agent-aware test), and the
  // shell's hostedThreadAuthorized refuses one ('not a hosted-thread app' in the reply-item test)
  policy.accept({ launcher: { hostedThreadApps: [] } });
  assert.equal(policy.hasHostedThread('wisdom'), false);
});

test('any installed Wizard app may open its own Chats thread (issue 1838), others stay refused', () => {
  const reg = { mobile: [{ id: 'goals', kind: 'wizard', url: '/goals/' }, { id: 'site', kind: 'link', url: 'https://x.test/' }, { id: 'nourl', kind: 'wizard' }], desktop: [{ id: 'calendar', kind: 'wizard', url: '/wizard-calendar/' }] };
  const policy = launcherFixture({ window: { WizCore: { apps: k => ({ APPS: reg[k] }) } } });
  assert.equal(policy.hasHostedThread('goals'), true, 'a builder-made app on the box');
  assert.equal(policy.hasHostedThread('calendar'), true, 'found in either shell registry');
  assert.equal(policy.hasHostedThread('wisdom'), true, 'the synced list still counts');
  for (const id of ['not-installed', 'site', 'nourl', '', null, undefined]) assert.equal(policy.hasHostedThread(id), false, String(id));
  policy.accept({ launcher: { hostedThreadApps: [] } });
  assert.equal(policy.hasHostedThread('goals'), true, 'an old synced list cannot shut an installed app out');
  // a registry that throws is a refusal, never a crash
  const broken = launcherFixture({ window: { WizCore: { apps: () => { throw new Error('no registry'); } } } });
  assert.equal(broken.hasHostedThread('goals'), false);
});

// The real chat kit (drafts, reply items) in a vm, with its own storage.
function kit() {
  const store = new Map();
  const ctx = { location: { origin: 'https://wizard.test', hostname: 'wizard.test', href: 'https://wizard.test/wizard-os-home/' },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: {}, document: { addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) }, addEventListener() {}, setTimeout, clearTimeout, console, URL, Intl, Date };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx); vm.runInContext(readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8'), ctx);
  return ctx.WosChat;
}
const passage = { key: 'wisdom:book1-p4', title: 'Meditations · 4.3', message: 'You have power over your mind.' };

test('openThread forwards an app-keyed reply item; foreign keys are refused', () => {
  // the app SDK: WizardApp.nav.openThread is the shell's answer, true only when the shell says true
  const asked = [];
  for (const answer of [true, 'yes']) {
    const c = appClient({ service: { nav: { openThread: (id, opts) => { asked.push([id, opts]); return answer; } } } });
    c.api.ready();
    assert.equal(c.api.nav.openThread('sid1', { reply: passage }), answer === true);
  }
  assert.deepEqual(asked.map(([id, o]) => [id, o.reply.key]), [['sid1', passage.key], ['sid1', passage.key]]);
  // the shell's admission (core/app-services.js threadOpen), with the real reply cleaner
  const KIT = kit(), opened = [];
  const svc = runRecording(between(services, '  const fault = message => new Error(message);', '\n') + '\n' + block(services, '  function threadOpen(st, id, opts, authorized) {') + '\nglobalThis.threadOpen = threadOpen;',
    { window: { WosChat: KIT, WosAgents: { get: () => null, isOther: () => false } } });
  const st = (visible = true) => ({ appId: 'wisdom', isVisible: () => visible, openThread: (id, o) => { opened.push([id, JSON.parse(JSON.stringify(o))]); return true; } });
  assert.equal(svc.threadOpen(st(), 'sid1', { reply: passage }, true), true);
  assert.deepEqual(opened, [['sid1', { reply: JSON.parse(JSON.stringify(KIT.reply.clean(passage))) }]], 'the cleaned item travels with the open');
  assert.throws(() => svc.threadOpen(st(), 'sid1', { reply: { ...passage, key: 'notes:1' } }, true), /Reply context must be keyed to this app/);
  assert.throws(() => svc.threadOpen(st(), 'sid1', { reply: passage }, false), /Thread navigation unavailable/, 'an app not admitted');
  assert.throws(() => svc.threadOpen(st(false), 'sid1', { reply: passage }, true), /Thread navigation unavailable/, 'a hidden window');
  assert.equal(opened.length, 1, 'nothing opened for a refused call');
  // the admission: only a hosted-thread app's own current document (launcher policy + the box's app list)
  const auth = runRecording(block(services, '  function hostedThreadAuthorized(st, sandboxed = false) {') + '\nglobalThis.authorized = hostedThreadAuthorized;',
    { window: { WizLauncher: { hasHostedThread: id => id === 'wisdom' } }, valid: () => true, URL, location: { href: 'https://wizard.test/wizard-os-home/' },
      apps: () => [{ id: 'wisdom', kind: 'wizard', url: '/wisdom/' }, { id: 'notes', kind: 'wizard', url: '/notes/' }] });
  const at = (appId, url) => ({ appId, url: new URL(url), openThread() {} });
  assert.equal(auth.authorized(at('wisdom', 'https://wizard.test/wisdom/')), true);
  assert.equal(auth.authorized(at('notes', 'https://wizard.test/notes/')), false, 'not a hosted-thread app');
  assert.equal(auth.authorized(at('wisdom', 'https://wizard.test/elsewhere/')), false, 'not its own document');
  // both shells: the frame's openThread opens the hosted thread over the app (stock: no layout placing it)
  for (const [name, src] of [['phone', app], ['desktop', desktop]]) {
    const c = runRecording('globalThis.open = (sid, opts) => ' + block(src, 'openThread: (sid, opts) =>').replace(/^openThread: \(sid, opts\) => /, '') + ';',
      { window: {}, a: { id: 'wisdom' }, w: { id: 'w3' }, f: { frame: 1 }, CHATS: { openHosted: (...x) => { c.got = x; return true; } } });
    const opts = { reply: passage };
    assert.equal(c.open('sid1', opts), true, name);
    assert.deepEqual(c.got, ['w3', { frame: 1 }, 'sid1', opts], name + ': CHATS.openHosted over the app window');
  }
});

test('the item pins to the thread draft once and shows as the reply bubble', () => {
  const KIT = kit(), doc = createDocument();
  doc.body.innerHTML = '<div data-chats="w1"><form data-chform><textarea></textarea></form></div>';
  const ctx = runRecording([block(chats, '  function prepThread(sid, opts = {}) {'), between(chats, '  const draftKey = w =>', '\n'), block(chats, '  function replyBubble(r) {'), block(chats, '  function refreshReply(wid) {'),
    'globalThis.api = { prepThread, refreshReply };'].join('\n'),
    { KIT, window: {}, LIVE: {}, W: { w1: { id: 'w1', thread: 'sid1' } }, elOf: () => doc.querySelector('[data-chats="w1"]'), winAgent: () => '', chanDraftKey: null, esc: v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') });
  assert.equal(ctx.api.prepThread('sid1', { reply: passage }), true);
  assert.equal(KIT.drafts.get('direct:sid1').reply.key, passage.key, 'pinned beside the thread draft');
  assert.equal(KIT.drafts.get('direct:sid1').text || '', '', 'the composer stays the owner\'s own words');
  ctx.api.prepThread('sid1', { reply: { ...passage, key: 'wisdom:book1-p9', title: 'Another' } });
  assert.equal(KIT.drafts.get('direct:sid1').reply.key, passage.key, 'once: never replaces the one already waiting');
  ctx.api.prepThread('__new__', { reply: passage });
  assert.equal(KIT.drafts.get('direct:__new__').reply, null, 'a new chat gets no item');
  ctx.api.refreshReply('w1');
  const form = doc.querySelector('[data-chform]');
  assert.ok(form.classList.contains('has-reply'));
  assert.ok(form.querySelector('[data-chreply]'), 'the reply bubble');
  assert.match(form.querySelector('[data-chreply]').textContent, /You have power over your mind/);
});

test('agent-aware hosted navigation pins a known running non-main agent before opening', () => {
  const effects = [], hosted = new Map(), w = {};
  const frame = {isConnected:true, closest: () => ({dataset:{win:'w'}}), style:{}, parentElement:{style:{position:'relative'}, append(){}}};
  const A = {get: id => id === 'philosopher' ? {status:'running'} : id === 'stopped' ? {status:'stopped'} : id === 'hermes' ? {status:'running'} : null, isOther: id => id !== 'hermes'};
  const sandbox = {W:{w}, HOSTED_APPS:new Set(['wisdom']), window:{WosAgents:A}, LIVE:{pinAgent:(...args) => effects.push(['pin',...args])},
    KIT:{reply:{clean:r=>r}}, hosted, closeHosted(){}, document:{createElement:()=>({style:{},dataset:{}})}, getComputedStyle:()=>({position:'relative'}), openChat:(...args)=>effects.push(['open',...args])};
  w.appId = 'wisdom';
  launcherFixture(sandbox);
  const fn = chats.slice(chats.indexOf('  function openHosted('), chats.indexOf('  function closeHosted('));
  vm.runInNewContext(fn + '; this.openHosted = openHosted;', sandbox);
  for (const agent of ['unknown','stopped','hermes',{},'']) assert.equal(sandbox.openHosted('w',frame,'sid',{agent}), false);
  assert.deepEqual(effects, []);
  assert.equal(sandbox.openHosted('w',frame,'sid',{agent:'philosopher'}), true);
  assert.deepEqual(effects, [['pin','sid','philosopher'],['open','w','sid']]);
  // an app outside the launcher's hosted-thread policy: nothing opens
  w.appId = 'other-app'; assert.equal(sandbox.openHosted('w',frame,'sid',{agent:'philosopher'}), false); assert.equal(effects.length, 2);
  // the shell's admission (app-services threadOpen): only a running agent other than the main one travels
  const opened = [];
  const svc = runRecording(between(services, '  const fault = message => new Error(message);', '\n') + '\n' + block(services, '  function threadOpen(st, id, opts, authorized) {') + '\nglobalThis.threadOpen = threadOpen;',
    { window: { WosChat: { reply: { clean: r => r } }, WosAgents: A } });
  const st = { appId: 'wisdom', isVisible: () => true, openThread: (id, o) => { opened.push([id, { ...o }]); return true; } };
  assert.equal(svc.threadOpen(st, 'sid', { agent: 'philosopher' }, true), true);
  for (const agent of ['stopped', 'hermes', 'unknown', {}]) assert.throws(() => svc.threadOpen(st, 'sid', { agent }, true), /Thread agent unavailable/, JSON.stringify(agent));
  assert.deepEqual(opened, [['sid', { agent: 'philosopher' }]]);
  // the app SDK says it can name an agent when the same-origin shell does
  const said = nav => { const c = appClient({ service: { nav } }); c.api.ready(); return c.api.nav.threadAgents; };
  assert.equal(said({ threadAgents: true }), true); assert.equal(said({}), false, 'an older shell: no');
  assert.equal(said({ threadAgents: 'yes' }), false, 'only a real true');
  const bare = appClient(); bare.api.ready(); assert.equal(bare.api.nav.threadAgents, false, 'no shell services, not sandboxed');
});

test('native draft admission precedes agent pin/navigation and conflicts do not open a layer',()=>{
 const effects=[],hosted=new Map(),w={appId:'wisdom'};
 const frame={isConnected:true,closest:()=>({dataset:{win:'w'}}),style:{},parentElement:{style:{position:'relative'},append(){}}};
 let accepts=false;
 const A={get:id=>id==='philosopher'?{status:'running'}:null,isOther:id=>id==='philosopher'};
 const sandbox={W:{w},window:{WosAgents:A},LIVE:{pinAgent:(...a)=>effects.push(['pin',...a])},KIT:{reply:{clean:r=>r},drafts:{admit:(k,text,r)=>{effects.push(['admit',k,text,r?.key]);return accepts},get:()=>({reply:{key:'wisdom:one'}})}},hosted,closeHosted(){},document:{createElement:()=>({style:{},dataset:{}})},getComputedStyle:()=>({position:'relative'}),requestAnimationFrame(){},openChat:(...a)=>effects.push(['open',...a])};
 launcherFixture(sandbox);const fn=chats.slice(chats.indexOf('  function openHosted('),chats.indexOf('  function closeHosted('));vm.runInNewContext(fn+';this.openHosted=openHosted;',sandbox);
 const opts={agent:'philosopher',reply:{key:'wisdom:one'},draft:{text:'My exact question'}};
 assert.equal(sandbox.openHosted('w',frame,'sid',opts),false);assert.equal(hosted.size,0);assert.deepEqual(effects,[['admit','direct:sid','My exact question','wisdom:one']]);
 effects.length=0;accepts=true;assert.equal(sandbox.openHosted('w',frame,'sid',opts),true);assert.deepEqual(effects,[['admit','direct:sid','My exact question','wisdom:one'],['pin','sid','philosopher'],['open','w','sid']]);
 effects.length=0;assert.equal(sandbox.openHosted('w',frame,'sid',opts),false);assert.deepEqual(effects,[]);
 hosted.clear();assert.equal(sandbox.openHosted('w',frame,'sid',{...opts,agent:'missing'}),false);assert.deepEqual(effects,[]);
});

test('Manager-only link ownership is unchanged', () => {
  // the real managerAuthorized (app-services): thread links belong to the installed Manager window only, never Wisdom
  const auth = runRecording(`${block(services, '  function managerAuthorized(st) {')}\nglobalThis.auth = managerAuthorized;`,
    { valid: () => true, apps: () => [{ id: 'wizard-manager', kind: 'wizard', url: '/wizard-manager/' }, { id: 'wisdom', kind: 'wizard', url: '/wisdom/' }],
      location: new URL('https://box.test/wizard-os-home/'), URL }).auth;
  const st = (appId, path, extra = {}) => ({ appId, doc: {}, url: new URL(path, 'https://box.test/'), openThread() {}, ...extra });
  assert.equal(auth(st('wizard-manager', '/wizard-manager/')), true, 'the installed Manager');
  assert.equal(auth(st('wisdom', '/wisdom/')), false, 'Wisdom hosts a thread but never owns thread links');
  assert.equal(auth(st('wizard-manager', '/elsewhere/')), false, 'a frame that is not the installed Manager page');
  assert.equal(auth(st('wizard-manager', '/wizard-manager/', { openThread: null })), false, 'no thread opener');
  assert.equal(auth(null), false);
});
