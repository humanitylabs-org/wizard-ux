// wizard-ux#1801: Settings › Privacy (Private mode row, Privacy check, switch-over sheet, Why it matters), on for
// everyone (wizard-agent-service#626: the switch wizard/private-mode is removed). Runs the real web/core/privacy.js against a fake box that answers the Agent Service's
// private-mode routes the way wizard-agent-service server/private-mode.mjs does (one step per POST, next_step resumes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../web/core/privacy.js', import.meta.url), 'utf8');
const MODELS = readFileSync(new URL('../web/core/chat-models.js', import.meta.url), 'utf8');

function fakeBox({ older = false, tinfoil = true, steps = {}, privateAgent = null } = {}) {
  const b = { older, tinfoil, steps: { ...steps }, privateAgent, moved: new Set(), def: 'hermes', grant: false, posts: [] };
  const agents = () => [{ id: 'hermes', label: 'Hermes', privacy: 'standard', company: 'Anthropic' }, ...(b.privateAgent ? [{ id: b.privateAgent, label: 'Private', privacy: 'private', company: 'Tinfoil' }] : [])];
  b.state = () => {
    // An Agent Service from before private mode was on for everyone answers on: false.
    if (b.older) return { schema: 'wizard.private-mode/1', on: false };
    const next = !b.privateAgent ? 'agent' : ['agent', 'apps', 'context', 'default'].find(s => !b.steps[s]) || 'done';
    // Turned off: the private agent is kept (sealed) and the mode reads off until a step runs again.
    const mode = !b.privateAgent || (b.off && !Object.keys(b.steps).length) ? 'off' : next === 'done' ? 'on' : 'setting_up';
    return { schema: 'wizard.private-mode/1', on: true, mode, next_step: next, standard_agent: 'hermes', private_agent: b.privateAgent, moved_apps: [...b.moved].sort(), context: { granted: b.grant }, default_agent: b.def };
  };
  const app = (id, label, personal) => {
    const priv = b.moved.has(id), a = priv ? agents().find(x => x.privacy === 'private') : agents()[0];
    return { app_id: id, label, personal_data: personal, standard_only: false, agents: [a], lines: [`${label} → ${a.label} → ${a.company}`], private_only: priv, moved: priv };
  };
  b.check = () => ({ schema: 'wizard.privacy-check/1', private_mode: b.state().mode, agents: agents(), apps: [app('wizard-mail', 'Mail', true), app('wizard-notes', 'Notes', true), app('wizard-music', 'Music', false)] });
  b.fetch = async (url, init = {}) => {
    const u = String(url), method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
    const ok = (j, status = 200) => ({ ok: status < 400, status, json: async () => j });
    if (u === '/wizard-tinfoil/api/status') return ok(b.tinfoil ? { provider: 'tinfoil', credentialStored: true } : { provider: null, credentialStored: false });
    if (u === '/wizard/v1/private-first') return ok({ on: false, offer: null, private_agent: null });
    if (u === '/wizard/v1/privacy-check') return !b.older ? ok(b.check()) : ok({ error: 'not_found' }, 404);
    if (u === '/wizard/v1/private-mode') return ok(b.state());
    const m = u.match(/^\/wizard\/v1\/private-mode\/(\w+)$/);
    if (m && method === 'POST') {
      b.posts.push([m[1], body]);
      if (b.older) return ok({ ok: false, error: 'private_mode_off' }, 409);
      if (m[1] === 'agent') { const created = !b.privateAgent; b.privateAgent ||= 'private'; b.off = false; b.steps.agent = 1; return ok({ agent: b.privateAgent, created, state: b.state() }); }
      if (!b.privateAgent) return ok({ ok: false, error: 'private_agent_required' }, 409);
      if (m[1] === 'apps') { for (const id of body.move || []) b.moved.add(id); for (const id of body.back || []) b.moved.delete(id); b.steps.apps = 1; return ok({ results: [], state: b.state() }); }
      if (m[1] === 'context') { b.grant = body.grant !== false; b.steps.context = 1; return ok({ granted: b.grant, state: b.state() }); }
      if (m[1] === 'default') { if (body.private !== false) b.def = b.privateAgent; b.steps.default = 1; return ok({ default_agent: b.def, state: b.state() }); }
      if (m[1] === 'off') { b.off = true; b.moved.clear(); b.def = 'hermes'; b.steps = {}; b.grant = false; return ok({ ok: true, results: [], state: { ...b.state(), mode: 'off' } }); }
    }
    return ok({ error: 'not_found' }, 404);
  };
  return b;
}

// A browser just big enough for privacy.js: a body to hold the sheet, capture click listeners, Settings.
function browser(box, { ask = () => true } = {}) {
  const listeners = [], features = [], calls = [];
  const sheetEls = [];
  const root = { tweaks: 'wizard/unified-inbox', getAttribute: n => (n === 'data-tweaks' ? root.tweaks : null) };
  const document = {
    documentElement: root,
    addEventListener: (type, fn) => { if (type === 'click') listeners.push(fn); },
    createElement: () => { const el = { innerHTML: '', className: '', dataset: {}, classList: { add() {}, contains: c => el.className.split(' ').includes(c) }, remove() { sheetEls.splice(sheetEls.indexOf(el), 1); }, querySelector: () => null }; return el; },
    body: { appendChild: el => sheetEls.push(el) },
  };
  const window = {
    WosSettings: { register: f => features.push(f), refresh() {} },
    WosSkinHost: { textDraft: t => { calls.push(['draft', t]); return ask(t); } },
    WosAgents: { ready: true, list: [], others: () => [], isPrivate: a => a?.privacy === 'private', load: async () => {} },
    WosAppRoute: { openAgents: id => calls.push(['agents', id]) },
    WizOpenApp: (id, path) => calls.push(['open', id, path]),
  };
  const fetch = (url, init) => { calls.push(['fetch', String(url), init?.method || 'GET']); return box.fetch(url, init); };
  const ctx = { window, document, fetch, console, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: fn => setTimeout(fn, 0), MutationObserver: class { observe() {} }, AbortSignal };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'privacy.js' });
  const P = window.WosPrivacy, feature = features.find(f => f.id === 'private-mode');
  const sheet = () => sheetEls[0];
  // A tap: target.closest() answers the selectors the module asks with, inside the sheet or on the Settings page.
  const tap = (attrs, { inSheet = true } = {}) => {
    const target = { dataset: attrs, tagName: 'BUTTON', classList: { contains: () => false } };
    const keys = Object.keys(attrs).map(k => 'data-' + k.replace(/[A-Z]/g, c => '-' + c.toLowerCase()));
    target.closest = sel => sel.includes('button') ? target : keys.some(k => sel.includes(`[${k}]`)) && !inSheet ? target : inSheet && sel.includes('.pm-sheet') ? sheet() : null;
    const e = { target, stopPropagation() {}, preventDefault() {} };
    for (const fn of listeners) fn(e);
  };
  const outside = () => { const s = sheet(); const e = { target: s, stopPropagation() {}, preventDefault() {} }; s.closest = () => s; for (const fn of listeners) fn(e); };
  return { P, feature, calls, sheet, tap, outside, root, window, ctx };
}
const settle = (ms = 30) => new Promise(r => setTimeout(r, ms));
const ENT = { '&amp;': '&', '&#39;': "'", '&rsaquo;': '›', '&quot;': '"', '&lt;': '<', '&gt;': '>' };
const text = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&(amp|#39|rsaquo|quot|lt|gt);/g, m => ENT[m]).replace(/’/g, "'").replace(/\s+/g, ' ').trim();
async function until(fn, ms = 2000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await settle(20); } return false; }

test('no switch: Settings › Privacy is there for everyone, with no switch in the Look; the box is asked only when it is opened', async () => {
  const b = browser(fakeBox());
  assert.ok(b.feature, 'registered once on the Privacy page');
  assert.equal(b.feature.page, 'privacy');
  assert.equal(b.feature.available, undefined, 'always available');
  assert.equal(b.P.on(), true);
  await settle();
  assert.deepEqual(b.calls.filter(c => c[0] === 'fetch'), [], 'nothing is read at page load');
  assert.equal(b.P.setupDue(), true, 'no private agent yet');
  b.feature.html();
  assert.ok(await until(() => b.calls.some(c => c[1] === '/wizard/v1/private-mode')), 'opening Settings › Privacy reads the box');
});

test('an older Agent Service without private mode: the row says it is not available yet and the sheet says so too', async () => {
  const b = browser(fakeBox({ older: true }));
  await b.P.read(true);
  assert.match(text(b.feature.html()), /Private mode Not available on this Wizard yet\. Update it in About & updates\./);
  assert.doesNotMatch(text(b.feature.html()), /Privacy check/);
  assert.equal(b.P.setupDue(), false);
  assert.equal(b.P.on(), false, 'the Store and app routes keep their own fallback on such a box');
  assert.equal(await b.P.open('setup'), true);
  await settle();
  assert.match(text(b.sheet().innerHTML), /Private mode isn't available on this Wizard yet/);
});

test('private mode off: the Private mode row says Off, the Privacy check lists Mail and Notes with their agent and company, then Set up private AI', async () => {
  const b = browser(fakeBox());
  await b.P.read(true);
  const page = text(b.feature.html());
  assert.match(page, /Private mode Apps with personal data use a private AI that only you can see\. Off/);
  assert.match(page, /Privacy check/);
  assert.match(page, /Mail Mail → Hermes → Anthropic/);
  assert.match(page, /Notes Notes → Hermes → Anthropic/);
  assert.doesNotMatch(page, /Music/, 'only apps holding personal data');
  assert.match(page, /Set up private AI/);
  assert.doesNotMatch(page, /Move to/, 'no moves while private mode is off');
  assert.match(page, /Why it matters/);
  assert.equal(b.P.setupDue(), true);
});

test('turn on with Mail and Notes ticked: every step runs once, Done lists Mail and Notes, the check shows them on the private agent', async () => {
  const box = fakeBox();
  const b = browser(box);
  await b.P.read(true);
  b.tap({ pmRow: 'off' }, { inSheet: false });
  assert.ok(await until(() => b.P.screen === 'agent'), 'Tinfoil signed in: starts at Create your private agent');
  assert.match(text(b.sheet().innerHTML), /Create your private agent/);
  b.tap({ pmGo: 'agent' });
  assert.ok(await until(() => b.P.screen === 'check'));
  const check = text(b.sheet().innerHTML);
  assert.match(check, /Mail Claude can read your email today\. Move to private\./);
  assert.match(check, /Notes Claude can read your notes today\. Move to private\./);
  assert.match(b.sheet().innerHTML, /data-pm-tick="wizard-mail"[^>]*/);
  assert.match(check, /Move 2 apps/);
  b.tap({ pmGo: 'apps' });
  assert.ok(await until(() => b.P.screen === 'context'));
  assert.match(b.sheet().innerHTML, /aria-checked="true" data-pm-grant/, 'Bring your context along is on by default');
  b.tap({ pmGo: 'context' });
  assert.ok(await until(() => b.P.screen === 'default'));
  assert.match(text(b.sheet().innerHTML), /Start new chats on private AI Private AI is a bit less capable than Claude for hard problems\. You can still pick Claude in any chat\./);
  assert.match(b.sheet().innerHTML, /aria-checked="true" data-pm-default/);
  b.tap({ pmGo: 'default' });
  assert.ok(await until(() => b.P.screen === 'done'));
  const done = text(b.sheet().innerHTML);
  assert.match(done, /Private mode is on/);
  assert.match(done, /Moved to private AI: Mail, Notes\./);
  assert.match(done, /What Claude already saw stays in your standard agent's memory and chats, and in Anthropic's records\./);
  assert.match(b.sheet().innerHTML, /href="https:\/\/claude\.ai\/settings\/data-privacy-controls"/);
  assert.deepEqual(box.posts.map(p => p[0]), ['agent', 'apps', 'context', 'default']);
  assert.deepEqual(box.posts[1][1], { move: ['wizard-mail', 'wizard-notes'] });
  assert.deepEqual(box.posts[2][1], { grant: true });
  assert.deepEqual(box.posts[3][1], { private: true });
  b.tap({ pmAgents: '' });
  assert.deepEqual(b.calls.find(c => c[0] === 'agents'), ['agents', 'hermes'], 'the standard agent\'s chats and memory');
  await b.P.read(true);
  const page = text(b.feature.html());
  assert.match(page, /Private mode New chats start on Private\. Tap to turn it off\. On/);
  assert.match(page, /Mail Mail → Private → Tinfoil Move to standard/);
  assert.match(page, /Notes Notes → Private → Tinfoil Move to standard/);
  assert.doesNotMatch(page, /Set up private AI/);
});

test('left after step 2: the row says Finish setting up and reopening resumes at the Privacy check, nothing made twice', async () => {
  const box = fakeBox();
  const b = browser(box);
  await b.P.open('setup');
  assert.ok(await until(() => b.P.screen === 'agent'));
  b.tap({ pmGo: 'agent' });
  assert.ok(await until(() => b.P.screen === 'check'));
  b.tap({ pmClose: '' });
  assert.equal(b.P.isOpen, false);
  await b.P.read(true);
  assert.match(text(b.feature.html()), /Finish setting up private AI/);
  b.tap({ pmRow: 'finish' }, { inSheet: false });
  assert.ok(await until(() => b.P.screen === 'check'), 'resumes at step 3');
  assert.deepEqual(box.posts.map(p => p[0]), ['agent'], 'the agent is not created again');
});

test('turn off from the row: one POST off, then the check shows the apps back on the standard agent', async () => {
  const box = fakeBox({ privateAgent: 'private', steps: { agent: 1, apps: 1, context: 1, default: 1 } });
  box.moved.add('wizard-mail'); box.moved.add('wizard-notes'); box.def = 'private';
  const b = browser(box);
  await b.P.read(true);
  b.tap({ pmRow: 'on' }, { inSheet: false });
  assert.ok(await until(() => b.P.screen === 'off'));
  assert.match(text(b.sheet().innerHTML), /Turn off private mode\? Your apps go back to your standard agent and new chats start there again\. Your private agent and its chats are kept, sealed\./);
  b.tap({ pmGo: 'off' });
  assert.ok(await until(() => !b.P.isOpen));
  assert.deepEqual(box.posts.map(p => p[0]), ['off']);
  await b.P.read(true);
  const page = text(b.feature.html());
  assert.match(page, /Mail Mail → Hermes → Anthropic/);
  assert.match(page, /Private mode .* Off/);
});

test('Move to private / Move to standard on the Privacy check while private mode is on', async () => {
  const box = fakeBox({ privateAgent: 'private', steps: { agent: 1, apps: 1, context: 1, default: 1 } });
  const b = browser(box);
  await b.P.read(true);
  assert.match(text(b.feature.html()), /Mail Mail → Hermes → Anthropic Move to private/);
  b.tap({ pmMove: 'move:wizard-mail' }, { inSheet: false });
  assert.ok(await until(() => /Mail Mail → Private → Tinfoil Move to standard/.test(text(b.feature.html()))));
  b.tap({ pmMove: 'back:wizard-mail' }, { inSheet: false });
  assert.ok(await until(() => /Mail Mail → Hermes → Anthropic Move to private/.test(text(b.feature.html()))));
  assert.deepEqual(box.posts, [['apps', { move: ['wizard-mail'] }], ['apps', { back: ['wizard-mail'] }]]);
});

test('Tinfoil not signed in: step 1 is the Tinfoil app\'s own sign-in page, and the sheet moves on once it is signed in', async () => {
  const box = fakeBox({ tinfoil: false });
  const b = browser(box);
  await b.P.open('setup');
  assert.ok(await until(() => b.P.screen === 'signin'));
  assert.match(b.sheet().innerHTML, /<iframe src="\/wizard-tinfoil\/\?connect=1"/);
  assert.match(text(b.sheet().innerHTML), /Sign in to private AI/);
  box.tinfoil = true;
  assert.ok(await until(() => b.P.screen === 'agent', 6000), 'continues by itself');
  assert.deepEqual(box.posts, [], 'nothing is created before the owner taps Create');
});

test('Why it matters: three sentences, no video link yet, Ask my Wizard opens a new chat with the question unsent', async () => {
  const b = browser(fakeBox());
  await b.P.open('why');
  const why = text(b.sheet().innerHTML);
  assert.match(why, /Why private AI matters/);
  assert.equal((why.match(/\./g) || []).length >= 3, true);
  assert.doesNotMatch(b.sheet().innerHTML, /aiwizards\.com|Watch the video/);
  b.tap({ pmAsk: '' });
  assert.deepEqual(b.calls.find(c => c[0] === 'draft'), ['draft', 'Why would I want private AI?']);
  assert.equal(b.P.isOpen, false);
});

test('Back and an outside tap close the sheet', async () => {
  const b = browser(fakeBox());
  await b.P.open('why');
  assert.equal(b.P.back(), 'privacy');
  assert.equal(b.P.isOpen, false);
  await b.P.open('why');
  b.outside();
  assert.equal(b.P.isOpen, false);
});

test('model picker: the Private group offers Set up private AI only while there is no private agent', async () => {
  const run = (privacy) => {
    const window = { WosPrivacy: privacy, WosAgents: { lock: () => '', modelOptions: () => [] } };
    vm.runInNewContext(MODELS, { window, fetch: async () => ({ ok: false, json: async () => null }), AbortSignal, console });
    return window.WosModels;
  };
  const on = run({ setupDue: () => true }), off = run({ setupDue: () => false }), none = run(undefined);
  for (const M of [on, off, none]) M.ready = true;
  assert.match(on.popHtml({ mode: 'new', cur: null, priv: [] }).html, /data-mprivsetup>Set up private AI</);
  assert.match(on.sheetHtml({ mode: 'new', cur: null, priv: [] }).html, /Private<\/span><\/div><button type="button" class="mrow more" data-mprivsetup>Set up private AI/);
  assert.doesNotMatch(off.popHtml({ mode: 'new', cur: null, priv: [] }).html, /data-mprivsetup/);
  assert.doesNotMatch(none.sheetHtml({ mode: 'new', cur: null, priv: [] }).html, /data-mprivsetup/);
  assert.doesNotMatch(on.popHtml({ mode: 'new', cur: null, agent: { id: 'a', label: 'A', allowed_models: [] } }).html, /data-mprivsetup/, 'an agent\'s own chats never offer it');
});
