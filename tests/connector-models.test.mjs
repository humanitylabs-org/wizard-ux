// wizard-ux#1201: the chats model menu's short list comes from the connected AI connectors. Each connector gives only
// its few main models, and only while connected. Issue 1561: on for everyone (the wizard/connector-models tweak is gone),
// and Tinfoil's deepseek-v4-1-flash is one row, DeepSeek Flash.
// Run: node --test tests/connector-models.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const TINFOIL_MODELS = ['glm-5-3', 'kimi-k3', 'deepseek-v4-1-flash', 'gpt-oss-120b', 'llama3-3-70b', 'nomic-embed-text', 'qwen3-tts', 'pii-filter', 'decision-small', 'whisper-large-v3-turbo'];
function models({ claude = false, chatgpt = false, tinfoil = false, current = 'anthropic', model = 'claude-opus-5-5', claudeAccounts, agents } = {}) {
  const document = { documentElement: { dataset: { skin: 'nebula', tweaks: '' } } };
  const window = { WosAgents: agents || { lock: () => '<svg class="ag-lock"></svg>' } };
  const ctx = vm.createContext({ window, document, AbortSignal, localStorage: { getItem: () => null }, fetch: async () => ({}) });
  vm.runInContext(read('web/core/chat-models.js'), ctx);
  const M = window.WosModels;
  // A Tinfoil-only box: Hermes still lists the configured Claude route (the bug) with its catalogue.
  const payload = { provider: current, model, providers: [
    { slug: 'anthropic', authenticated: claude, models: ['claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5'] },
    { slug: 'openai-codex', authenticated: chatgpt, models: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.6-terra'] },
    { slug: 'wizard-tinfoil', is_user_defined: true, authenticated: true, models: TINFOIL_MODELS },
  ] };
  M.providers = payload.providers;
  M.tinfoil = tinfoil ? { provider: 'tinfoil', credentialStored: true } : null;
  M.claudeAccounts = claudeAccounts === undefined ? { accounts: claude ? [{ id: 'a1', status: 'ready' }] : [] } : claudeAccounts;
  M.options = M.normalize(payload).filter(o => !M.isPrivateRoute(o.provider) || M.tinfoilReady());
  M.ready = true;
  return M;
}
const names = html => [...html.matchAll(/<b>(?:<svg[^>]*><\/svg>)?([^<]+)<\/b>/g)].map(m => m[1]);

test('Tinfoil only: the menu offers GLM, Kimi and DeepSeek Flash, and no Claude model', () => {
  const M = models({ tinfoil: true, current: 'custom:wizard-tinfoil', model: 'glm-5-3' });
  const { html } = M.popHtml({ mode: 'new', cur: null });
  assert.deepEqual(names(html), ['GLM', 'Kimi', 'DeepSeek Flash']);
  assert.doesNotMatch(html, /Opus|Sonnet|Astra|nomic|tts|pii|decision/i);
  assert.equal(M.visible('', '').some(o => /^claude-/.test(o.value)), false);
});

test('Tinfoil only, Hermes still configured on Claude: Claude rows stay out of the short list', () => {
  const M = models({ tinfoil: true });
  const { html } = M.popHtml({ mode: 'new', cur: null });
  assert.deepEqual(names(html), ['GLM', 'Kimi', 'DeepSeek Flash']);
});

test('a thread already on a disconnected model still shows that model', () => {
  const M = models({ tinfoil: true });
  const cur = { model: 'claude-opus-5-5', provider: 'anthropic' };
  const { html } = M.popHtml({ mode: 'thread', cur });
  assert.deepEqual(names(html), ['GLM', 'Kimi', 'DeepSeek Flash', 'Opus']);
});

test('Claude and ChatGPT connected: their curated short lists, in connector order', () => {
  const M = models({ claude: true, chatgpt: true });
  assert.deepEqual(names(M.popHtml({ mode: 'new', cur: null }).html), ['Opus', 'Sonnet', 'Haiku', 'Astra', 'Sol', 'Luna']);
});

test('every connector connected: Terra and the utility models stay behind More models', () => {
  const M = models({ claude: true, chatgpt: true, tinfoil: true });
  const short = names(M.popHtml({ mode: 'new', cur: null }).html);
  assert.deepEqual(short, ['Opus', 'Sonnet', 'Haiku', 'Astra', 'Sol', 'Luna', 'GLM', 'Kimi', 'DeepSeek Flash']);
  assert.match(M.popHtml({ mode: 'new', cur: null }).html, /data-mall/);
});

test('no connector connected: the menu says so and links to Connectors', () => {
  const M = models({});
  const pop = M.popHtml({ mode: 'new', cur: null }).html;
  assert.match(pop, /No AI connected yet/);
  assert.match(pop, /href="\/wizard-os-home\/store\/index\.html\?kind=connections"/);
  assert.doesNotMatch(pop, /Opus|Sonnet|Astra|GLM/);
  assert.match(M.sheetHtml({ mode: 'new', cur: null }).html, /No AI connected yet/);
});

test('no Claude app answering: Hermes\u2019 own Claude sign-in decides (alongside boxes)', () => {
  assert.deepEqual(names(models({ claude: true, claudeAccounts: null }).popHtml({ mode: 'new', cur: null }).html), ['Opus', 'Sonnet', 'Haiku']);
  assert.match(models({ claude: false, claudeAccounts: null }).popHtml({ mode: 'new', cur: null }).html, /No AI connected yet/);
});

test('a Claude app with no ready account means Claude is not connected', () => {
  const M = models({ claude: true, claudeAccounts: { accounts: [{ id: 'a1', status: 'signed_out' }] }, tinfoil: true });
  assert.deepEqual(names(M.popHtml({ mode: 'new', cur: null }).html), ['GLM', 'Kimi', 'DeepSeek Flash']);
});

test('stock look, no tweak: a connected Tinfoil shows its three models; deepseek-* is one DeepSeek Flash row', () => {
  const M = models({ tinfoil: true, claude: true, chatgpt: true });
  const { html, list } = M.popHtml({ mode: 'new', cur: null });
  assert.deepEqual(names(html).slice(-3), ['GLM', 'Kimi', 'DeepSeek Flash']);
  assert.doesNotMatch(html, /<b>(?:<svg[^>]*><\/svg>)?(?:DeepSeek|Flash)<\/b>/);
  assert.equal(M.family('deepseek-v4-1-flash', 'custom:wizard-tinfoil'), 'tinfoil:deepseek');
  assert.equal(M.family('deepseek-v4', 'custom:wizard-tinfoil'), 'tinfoil:deepseek');
  const ds = list.find(o => o.value === 'deepseek-v4-1-flash');
  assert.equal(ds.provider, 'custom:wizard-tinfoil');
});

test('routed agents keep their own allowed models whatever is connected (host-profile, container, restricted)', () => {
  for (const kind of ['host-profile', 'container', 'restricted']) {
    const agent = { id: `ag-${kind}`, label: kind, kind, model: { provider: 'anthropic' } };
    const agents = { lock: () => '', modelOptions: () => [{ value: 'claude-sonnet-5', provider: 'anthropic', name: 'Sonnet', agent: agent.id }] };
    const M = models({ tinfoil: true, agents });
    const { html } = M.popHtml({ mode: 'thread', cur: null, agent });
    assert.deepEqual(names(html), ['Sonnet'], kind);
    assert.doesNotMatch(html, /No AI connected|GLM/, kind);
  }
});

test('the connector-models tweak is gone: no switch, no off path', () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(!cat.tweaks.includes('wizard/connector-models'));
  assert.doesNotMatch(read('web/core/chat-models.js'), /connector-models|connectorOn/);
});

// Codex P2: a real new-chat picker passes the Hermes default as cur (chat-power openModels). A disconnected
// default must not come back as a row next to "No AI connected yet"; an existing thread keeps its model.
test('a new chat never inherits a disconnected default into the menu', () => {
  const cur = { model: 'claude-opus-5-5', provider: 'anthropic', isDefault: true };
  const none = models({});
  const pop = none.popHtml({ mode: 'new', cur }).html;
  assert.match(pop, /No AI connected yet/);
  assert.doesNotMatch(pop, /Opus/);
  assert.doesNotMatch(none.sheetHtml({ mode: 'new', cur }).html, /Claude Opus/);
  assert.deepEqual(names(models({ tinfoil: true }).popHtml({ mode: 'new', cur }).html), ['GLM', 'Kimi', 'DeepSeek Flash']);
  assert.deepEqual(names(models({ tinfoil: true }).popHtml({ mode: 'thread', cur }).html), ['GLM', 'Kimi', 'DeepSeek Flash', 'Opus']);
});

// Codex P2: "More models" in the full sheet lists the reachable catalogue only.
test('the expanded sheet leaves out disconnected connectors too', () => {
  const M = models({ tinfoil: true, current: 'custom:wizard-tinfoil', model: 'glm-5-3' });
  const short = M.sheetHtml({ mode: 'new', cur: null }).html;
  const count = Number(/More models · (\d+)/.exec(short)?.[1]);
  assert.equal(count, TINFOIL_MODELS.length);
  const all = M.sheetHtml({ mode: 'new', cur: null, all: true });
  assert.equal(all.list.some(o => /^claude-|^gpt-\d/.test(o.value)), false);
  assert.equal(all.list.length, TINFOIL_MODELS.length);
});

// Codex P1 / AGENTS.md agent parity: open the real picker through chat-power (the label in the message box), tap the
// first row and check where the new chat routes, on the main agent and on host-profile, container and restricted agents.
function powered(kind) {
  const document = { documentElement: { dataset: { skin: 'nebula', tweaks: '' } }, addEventListener() {} };
  const agent = kind === 'main' ? null : { id: `ag-${kind}`, label: `Agent ${kind}`, kind, model: { provider: 'custom', default: 'claude-sonnet-5' } };
  const AG = { ready: true, lock: () => '', isOther: id => !!agent && id === agent.id, get: id => (agent && id === agent.id ? agent : null),
    others: () => (agent ? [agent] : []), isPrivate: () => false, modelName: (_a, m) => m,
    modelOptions: a => [{ value: 'claude-sonnet-5', provider: 'custom', name: 'Sonnet', agent: a.id, isGlobalDefault: true }],
    route: (a, want) => ({ model: want || 'claude-sonnet-5', provider: a.model.provider, agent: a.id }), allows: () => true };
  const state = {}, w = { id: 'win', thread: '__new__', ...(agent ? { agent: agent.id } : {}) };
  let html = '';
  const el = { querySelectorAll: () => [], querySelector: () => null, insertAdjacentHTML: (_p, h) => { html = h; }, classList: { add() {}, remove() {} }, style: { setProperty() {}, removeProperty() {} } };
  const ctx = { setTimeout, clearTimeout, console, AbortSignal, AbortController, document, addEventListener() {}, localStorage: { getItem: () => null, setItem() {} },
    fetch: async () => ({ ok: false, json: async () => ({}) }), WizCore: { esc: String, clip: String }, WizConfig: { agent: () => 'Wizard' },
    WizLive: { session: () => null, agentOf: () => '' }, WosAgents: AG, Event: class {},
    ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {} };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(read('web/core/chat-models.js'), ctx);
  const M = ctx.WosModels;
  const payload = { provider: 'anthropic', model: 'claude-opus-5-5', providers: [
    { slug: 'anthropic', authenticated: false, models: ['claude-opus-5-5', 'claude-sonnet-5'] },
    { slug: 'wizard-tinfoil', is_user_defined: true, authenticated: true, models: TINFOIL_MODELS }] };
  M.providers = payload.providers; M.tinfoil = { provider: 'tinfoil', credentialStored: true }; M.claudeAccounts = { accounts: [] };
  M.options = M.normalize(payload); M.ready = true; M.at = Date.now(); M.load = async () => M.options;
  vm.runInContext(read('web/core/chat-power.js'), ctx);
  const api = ctx.WosChatPower({ ch: () => state, CH: { win: state }, H: { win: () => w, root: () => el, overlay() {} },
    owner: id => id, winAgent: win => win.agent || '', elOf: () => el, closeRowSheet() {}, vib() {}, toast() {}, renderThreadNow() {} });
  const tap = sel => api.click({ target: { closest: s => (s === sel ? { dataset: { mpick: '0' } } : s === '.ch-mlabel' ? {} : null) } }, 'win');
  return { M, state, agent, html: () => html, open: () => tap('[data-chmodel]'), pick: () => tap('[data-mpick]') };
}
for (const kind of ['main', 'host-profile', 'container', 'restricted']) {
  test(`connector models, ${kind}: the opened picker and the picked route stay with that agent`, () => {
    const h = powered(kind);
    h.open();
    const shown = names(h.html());
    if (kind === 'main') assert.deepEqual(shown, ['GLM', 'Kimi', 'DeepSeek Flash']);
    else assert.deepEqual(shown, ['Sonnet']);
    h.pick();
    if (kind === 'main') {
      assert.deepEqual({ ...h.state.newModel }, { model: 'glm-5-3', provider: 'custom:wizard-tinfoil' });
      assert.deepEqual({ ...h.M.snapshot('__new__', h.state.newModel) }, { model: 'glm-5-3', provider: 'custom:wizard-tinfoil' });
    } else {
      assert.deepEqual({ ...h.state.newModel }, { model: 'claude-sonnet-5', provider: 'custom', agent: h.agent.id });
      assert.deepEqual({ ...h.M.snapshot('__new__', h.state.newModel) }, { model: 'claude-sonnet-5', provider: 'custom', agent: h.agent.id });
    }
  });
}

// Codex P2 on PR 1562: a connector that signs out while the picker opens changes no catalogue row, only the sign-in
// state; the just-opened menu must still repaint without that connector's models.
test('the open picker repaints when a connector signs out during its refresh', async () => {
  const h = powered('main');
  h.M.load = async () => { h.M.tinfoil = null; return h.M.options; };
  h.open();
  assert.deepEqual(names(h.html()), ['GLM', 'Kimi', 'DeepSeek Flash']);
  await new Promise(r => setTimeout(r, 0));
  assert.match(h.html(), /No AI connected yet/);
  assert.doesNotMatch(h.html(), /GLM|Kimi|DeepSeek/);
});

// Issue 1561 (Archimedes, 19 Nov): a fresh install with Tinfoil as the only AI opened an EMPTY menu from the chip.
test('fresh install, Tinfoil the only AI and the Hermes default: the chip menu lists Kimi and GLM', () => {
  const M = models({ tinfoil: true, current: 'wizard-tinfoil', model: 'kimi-k3-1-pro' });
  M.options = M.normalize({ provider: 'wizard-tinfoil', model: 'kimi-k3-1-pro', providers: [
    { slug: 'wizard-tinfoil', is_user_defined: true, authenticated: true, models: ['kimi-k3-1-pro', 'glm-5-3'] }] });
  const cur = M.snapshot ? M.snapshot('') : { model: 'kimi-k3-1-pro', provider: 'custom:wizard-tinfoil' };
  const { html, list } = M.popHtml({ mode: 'thread', cur: { model: 'kimi-k3-1-pro', provider: cur.provider || 'custom:wizard-tinfoil' }, all: false });
  assert.deepEqual(names(html).sort(), ['GLM', 'Kimi']);
  assert.ok(list.length === 2 && list.every(o => /tinfoil/.test(o.provider)));
});

test('the menu is never empty: nothing listable still shows the current model and Connect an AI', () => {
  const M = models({ claude: true });
  M.options = []; // e.g. the catalogue answered with no routes for the connected account
  const { html } = M.popHtml({ mode: 'new', cur: null, all: false });
  assert.match(html, /Connect an AI/);
  const M2 = models({ claude: true });
  M2.options = M2.options.filter(o => o.value === 'claude-opus-5-5');
  M2.claudeAccounts = { accounts: [] }; M2.providers = M2.providers.map(p => ({ ...p, authenticated: false }));
  M2.tinfoil = { provider: 'tinfoil', credentialStored: true }; // connected, but no Tinfoil route in the catalogue
  const thread = M2.popHtml({ mode: 'new', cur: { model: 'claude-opus-5-5', provider: 'anthropic' }, all: false }).html;
  assert.match(thread, /Connect an AI/);
  assert.match(thread, /Opus/);
});
