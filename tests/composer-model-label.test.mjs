import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { styles } from './fixtures/w5-css.mjs';
import { between, block, runRecording } from './fixtures/source-slice.mjs';
import { cascade } from './fixtures/mini-css.mjs'; // chats.js parts moved out verbatim (issue 1665)

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function models() {
  const window = { WosAgents: { lock: () => '<svg class="ag-lock"></svg>' } };
  const ctx = vm.createContext({ window, localStorage: { getItem: () => null, setItem() {} }, fetch: async () => ({}), console });
  vm.runInContext(read('web/core/chat-models.js'), ctx);
  const M = window.WosModels;
  const mk = (value, provider, name) => ({ value, provider, name, description: '' });
  M.options = [mk('claude-opus-5-5', 'anthropic', 'Claude Opus'), mk('claude-fable-5-1', 'anthropic', 'Claude Fable'), mk('claude-sonnet-5', 'anthropic', 'Claude Sonnet'),
    mk('gpt-6-astra', 'openai-codex', 'Astra'), mk('gpt-6.1-sol', 'openai-codex', 'GPT 6.1 Sol'), mk('gpt-6-luna', 'openai-codex', 'Luna'), mk('gpt-5.6-terra', 'openai-codex', 'Terra')];
  M.options[0].isGlobalDefault = true; M.ready = true; M.__window = window;
  // Issue 1561: the short list comes from the connected connectors, so Claude and ChatGPT are signed in here.
  M.providers = [{ slug: 'anthropic', authenticated: true }, { slug: 'openai-codex', authenticated: true }];
  return M;
}
// owner-correction: humanitylabs-org/wizard-ux#1043 · 2026-11-06 · "Claude Sonnet seems to have been removed from my drop-down screen. Please add Sonnet back in there."
test('new chat on Sol exposes catalogue Sonnet immediately without changing the default', () => {
  const M = models();
  const payload = { provider: 'openai-codex', model: 'gpt-6.1-sol', providers: [
    { slug: 'openai-codex', authenticated: true, models: ['gpt-6-astra', 'gpt-6.1-sol'] },
    { slug: 'anthropic', authenticated: true, models: ['claude-opus-5-5', 'claude-sonnet-4-6', 'claude-sonnet-5-5'] },
    { slug: 'claude-subscription-directsdk-experimental', authenticated: true, models: ['claude-sonnet-5[1m]'] },
  ] };
  M.options = M.normalize(payload, true); M.providers = payload.providers;
  const before = M.defaultOption();
  const cur = M.snapshot('');
  assert.equal(cur.model, 'gpt-6.1-sol');
  assert.equal(cur.provider, 'openai-codex');
  const { html, list } = M.popHtml({ mode: 'new', cur, all: false });
  const match = html.match(/data-mpick="(\d+)"[^>]*><span class="mn"><b>Sonnet<\/b>/);
  assert.ok(match, 'Sonnet is a first-open compact row, not hidden behind More models');
  const picked = list[Number(match[1])];
  assert.equal(picked.value, 'claude-sonnet-5-5');
  assert.equal(picked.provider, 'anthropic');
  assert.ok(M.options.includes(picked), 'the row points at the existing catalogue route');
  assert.equal(M.defaultOption(), before);
  assert.equal(M.snapshot('').model, 'gpt-6.1-sol');
  assert.equal(M.snapshot('').provider, 'openai-codex');
});

// owner-correction: humanitylabs-org/wizard-ux#1636 · 2026-11-19 · "Why isn't Fable visible in my model selector? Please fix."
test('Fable is a first-open compact row when the catalogue has it, and absent when it does not', () => {
  const M = models();
  const cat = fable => M.normalize({ provider: 'openai-codex', model: 'gpt-6.1-sol', providers: [
    { slug: 'openai-codex', authenticated: true, models: ['gpt-6-astra', 'gpt-6.1-sol'] }, // no Luna route here (issue 1561: Luna would join ChatGPT's short list)
    { slug: 'anthropic', authenticated: true, models: ['claude-opus-5-5', 'claude-sonnet-5-5', ...(fable ? ['claude-fable-5', 'claude-fable-5-1', 'claude-fable-5-2'] : [])] },
  ] }, true);
  M.options = cat(true);
  const before = M.defaultOption();
  const cur = M.snapshot('');
  const { html, list } = M.popHtml({ mode: 'new', cur, all: false });
  const names = [...html.matchAll(/<span class="mn"><b>([^<]+)<\/b>/g)].map(m => m[1]);
  assert.deepEqual(names, ['Fable', 'Opus', 'Sonnet', 'Astra', 'Sol']);
  const match = html.match(/data-mpick="(\d+)"[^>]*><span class="mn"><b>Fable<\/b>/);
  const picked = list[Number(match[1])];
  assert.equal(picked.value, 'claude-fable-5-2'); // the newest Fable, via the visibleChoices winner
  assert.equal(picked.provider, 'anthropic');
  assert.ok(M.options.includes(picked), 'the row points at the existing catalogue route');
  assert.equal(M.defaultOption(), before);
  assert.equal(M.snapshot('').model, 'gpt-6.1-sol');
  M.options = cat(false);
  const none = M.popHtml({ mode: 'new', cur: M.snapshot(''), all: false });
  assert.doesNotMatch(none.html, /Fable/, 'no Fable route: no Fable row, no placeholder');
  assert.ok(none.list.every(o => !/fable/.test(o.value)));
});

// Agent chat parity (wizard-agent-service qa/agent-parity/features.json compact-model-menu-families): the Fable row is
// the main agent's; a host-profile, container or restricted agent's own chats list only that agent's allowed models.
test('main vs routed threads: Fable joins the main menu, routed agents keep exactly their own models', () => {
  const M = models();
  const mkAgent = (id, kind, provider, allowed) => ({ id, kind, label: id, model: { provider, model: allowed[0], allowed_models: allowed } });
  const agents = [mkAgent('philosopher', 'host-profile', 'anthropic', ['claude-opus-5-5', 'claude-fable-5-1']),
    mkAgent('boxed', 'container', 'openai-codex', ['gpt-6-astra']), mkAgent('locked', 'restricted', 'anthropic', ['claude-sonnet-5'])];
  M.options = M.normalize({ provider: 'anthropic', model: 'claude-opus-5-5', providers: [
    { slug: 'anthropic', authenticated: true, models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2'] },
    { slug: 'openai-codex', authenticated: true, models: ['gpt-6-astra', 'gpt-6.1-sol'] }] }, true);
  const names = html => [...html.matchAll(/<span class="mn"><b>([^<]+)<\/b>/g)].map(m => m[1]);
  const main = M.popHtml({ mode: 'thread', cur: { model: 'claude-opus-5-5', provider: 'anthropic' }, all: false });
  assert.deepEqual(names(main.html), ['Fable', 'Opus', 'Sonnet', 'Astra', 'Sol']);
  assert.equal(main.list[0].value, 'claude-fable-5-2');
  const W = M.__window;
  for (const a of agents) {
    W.WosAgents.modelOptions = ag => ag.model.allowed_models.map(v => ({ value: v, provider: ag.model.provider, agent: ag.id, name: `own:${v}` }));
    const { html, list } = M.popHtml({ mode: 'thread', cur: { model: a.model.model, provider: a.model.provider, agent: a.id }, all: false, agent: a });
    assert.deepEqual(names(html), a.model.allowed_models.map(v => `own:${v}`), `${a.kind} lists only its own models`);
    assert.ok(list.every(o => o.agent === a.id && o.provider === a.model.provider), `${a.kind} rows stay on its own route`);
    assert.ok(!list.some(o => o.value === 'claude-fable-5-2'), `${a.kind} never inherits the main agent's Fable route`);
  }
});

const priv = [{ value: 'glm-5.3', provider: 'custom', name: 'GLM 5.3', agent: 'private-1', private: true }];
const order = html => [...html.matchAll(/<span>([^<]+)<\/span><\/div>|<b>(?:<svg[^>]*><\/svg>)?([^<]+)<\/b>|data-mall>([^<]+)</g)].map(m => m[1] ? `## ${m[1]}` : m[2] || m[3]);

// owner-correction: humanitylabs-org/wizard-ux#939 · 2026-11-04 · "Why is Sonnet missing from my model list when I never requested Sonnet to be removed? We previously added it."
test('compact menu reads bottom-up from the thumb: Opus, Sonnet, Astra, Sol last, Private agent above, More models on top', () => {
  const M = models();
  M.options = M.options.filter(o => !/fable|luna/.test(o.value)); // an owner with no Fable or Luna route (Fable's row: issue 1636 test above; Luna: issue 1561)
  const { html, list } = M.popHtml({ mode: 'thread', cur: { model: 'claude-opus-5-5', provider: 'anthropic' }, all: false, priv });
  assert.deepEqual(order(html), ['More models', '## Private agent', 'GLM 5.3', '## Models', 'Opus', 'Sonnet', 'Astra', 'Sol']);
  assert.match(html, /class="ch-sheet ch-mpop"/);
  assert.equal(list.length, 5); // every row maps to a pickable option
});

test('in a private chat the private models sit by the thumb and the main models move above', () => {
  const M = models();
  const { html } = M.popHtml({ mode: 'new', cur: { model: 'glm-5.3', provider: 'custom', agent: 'private-1' }, all: false, priv });
  const o = order(html);
  assert.deepEqual(o.slice(-2), ['## Private agent', 'GLM 5.3']);
  assert.ok(o.indexOf('## Models') < o.indexOf('## Private agent'));
});

test('More models expands to the other families once each, above the short list', () => {
  const M = models();
  const { html } = M.popHtml({ mode: 'thread', cur: { model: 'claude-opus-5-5', provider: 'anthropic' }, all: true, priv: [] });
  const o = order(html);
  assert.deepEqual(o.slice(-6), ['Fable', 'Opus', 'Sonnet', 'Astra', 'Sol', 'Luna']);
  assert.ok(o.indexOf('Terra') >= 0 && o.indexOf('Terra') < o.indexOf('## Models'));
  assert.equal(o.filter(x => /Opus/.test(x)).length, 1);
  assert.equal(o.filter(x => /Fable/.test(x)).length, 1);
});

// The real chat-power.js (the model label and chip), as tests/channel-box-model-pick.test.mjs runs it.
function power() {
  const OPTS = [{ value: 'claude-opus', provider: 'anthropic', name: 'Opus', isGlobalDefault: true }];
  const ctx = { console, URL, Intl, Date, File, Blob, Response, setTimeout, clearTimeout, location: { origin: 'https://fixture.invalid', href: 'https://fixture.invalid/', hostname: 'fixture.invalid' }, navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: { addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) }, addEventListener() {},
    WizCore: { esc: String, clip: s => s }, WizConfig: { agent: () => 'Fixture' }, WizLive: { session: () => null },
    WosAgents: { isOther: () => false, get: id => ({ id }), isPrivate: () => false },
    WosModels: { ready: true, options: OPTS, load: async () => {}, currentRoute: () => ({ model: 'claude-opus', provider: 'anthropic' }), privateOptions: () => [],
      defaultOption: () => OPTS[0], name: v => v, short: v => (OPTS.find(o => o.value === v) || {}).name || v, ours: () => false, sheetHtml: () => ({ list: OPTS, html: '' }) },
    WosOutbox: { unsent: () => [] } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(read('web/core/chat-kit.js'), ctx); vm.runInContext(read('web/core/chat-power.js'), ctx);
  const w = { id: 'win', app: 'chats', thread: '__new__' };
  const H = { root: () => ({ querySelectorAll: () => [] }), win: id => (id === 'win' ? w : null), recordReply: () => '', recordingFor: () => '', viewContext: () => '', overlay() {} };
  const api = ctx.WosChatPower({ ch: () => ({}), CH: {}, toast() {}, H, renderChats() {}, renderThreadNow() {}, owner: id => id,
    elOf: () => ({ querySelectorAll: () => [], querySelector: () => null, insertAdjacentHTML() {}, classList: { remove() {}, add() {} }, style: { removeProperty() {}, setProperty() {} } }),
    MIC_SVG: '<svg ', closeRowSheet() {}, vib() {}, isWorking: () => false, takeComposer: () => ({ text: '', files: [], done() {}, putBack() {} }), leaveAfterSend: () => false, openChat() {},
    winAgent: () => '', chanOpen: () => null, chanSpaceOf: () => null, spaceMember() {}, chanBox: () => '', chanModel: () => null, setChanModel: () => false });
  return { api, w };
}
// The real fitLabel (core/chats-fitlabel.js) over a composer whose sizes the test sets (no layout here).
function fitWorld({ value = '', placeholder = 'Message Wizard', lines = 1, lastEnd = 40, scrollHeight = 42 } = {}) {
  const doc = createDocument();
  doc.body.innerHTML = '<div class="ch-field"><textarea></textarea><button class="ch-mlabel ch-model">Opus</button></div>';
  const field = doc.body.firstElementChild, ta = field.querySelector('textarea'), lab = field.querySelector('.ch-mlabel');
  ta.value = value; ta.placeholder = placeholder;
  Object.assign(ta, { clientWidth: 300, clientHeight: 42, scrollHeight }); lab.offsetWidth = 80;
  const make = doc.createElement;
  doc.createElement = t => { const e = make(t); if (t === 'span') Object.defineProperty(e, 'offsetLeft', { get: () => lastEnd }); else Object.defineProperty(e, 'offsetHeight', { get: () => lines * 20 }); return e; };
  const ctx = { window: {}, document: doc, getComputedStyle: () => ({ paddingLeft: '12px', font: '16px x', letterSpacing: 'normal', lineHeight: '20px' }) };
  vm.runInNewContext(read('web/core/chats-fitlabel.js'), ctx);
  const { fitLabel } = ctx.window.WizCore.chatsParts.fitlabel({ addFiles() {}, chatVars: {}, picker: { addEventListener() {} }, W: {} });
  fitLabel(field);
  return { field, ta, row: field.classList.contains('lab-row') };
}

test('the thread header no longer carries the model; a draft keeps the label outside the editable rows', () => {
  const chats = withParts(read('web/core/chats.js')), css = read('web/core/chat-power.css');
  const { api, w } = power();
  // The label is the chip restyled for the box: no ▾, its own class.
  const label = api.modelLabel(w, null), chip = api.modelChip(w, null);
  assert.match(chip, /class="ch-model/); assert.match(chip, /▾/);
  assert.match(label, /class="ch-mlabel ch-model/); assert.doesNotMatch(label, /▾/);
  // Which one the thread paint draws, and where (core/chats-threadpaint.js, run on its own lines).
  const pick = between(chats, '    const msw = PW?.modelSwitch && s !== undefined', '    const fail = PW &&');
  const drawn = PW => { const c = { PW, s: null, w }; vm.runInNewContext(pick + 'this.r = { msw, mlabel, chip };', c); return c.r; };
  const now = drawn({ modelLabel: api.modelLabel, modelChip: api.modelChip });
  assert.equal(now.chip, '', 'the header carries no model');
  assert.equal(now.mlabel, label, 'the label goes in the message box');
  assert.equal(drawn({ modelChip: () => 'CHIP' }).chip, 'CHIP', 'only a power part without the box label keeps the header chip');
  const field = between(chats, '<div class="ch-field"><textarea', '${mlabel}</div>', chats.indexOf('data-chform>')) + '${mlabel}</div>'; // the thread composer
  const doc = createDocument();
  doc.body.innerHTML = vm.runInNewContext('`' + field + '`', { isNew: true, s: null, window: {}, working: false, held: false, TAG: '', esc: String, agentName: () => 'Wizard', draft: 'half a thought', mlabel: label });
  const box = doc.body.querySelector('.ch-field');
  assert.deepEqual(box.children.map(e => e.localName + (e.className ? '.' + e.className.split(' ')[0] : '')), ['textarea', 'button.ch-mlabel'], 'the label sits beside the textarea, never inside it');
  assert.equal(box.querySelector('textarea').textContent, 'half a thought');
  // fitLabel: any draft moves the label to its own strip; an empty box shares the corner unless it would collide.
  assert.equal(fitWorld().row, false, 'empty, short placeholder: the label stays in the corner');
  assert.equal(fitWorld({ value: 'hi' }).row, true, 'a draft: the label gets its own strip');
  assert.equal(fitWorld({ lines: 3 }).row, true, 'a three-line placeholder');
  assert.equal(fitWorld({ lastEnd: 280 }).row, true, 'the last line would run under the label');
  assert.equal(fitWorld({ scrollHeight: 90 }).row, true, 'a scrolling box');
  assert.equal(fitWorld({ value: 'hi' }).ta.style.paddingRight, '14px');
  // growTa: measured after the height is set, and the owner's scroll position put back.
  const log = [], ta = { scrollTop: 37, clientWidth: 300, scrollHeight: 300, getClientRects: () => [1], style: {} };
  let h = ''; Object.defineProperty(ta.style, 'height', { get: () => h, set: v => { log.push(['height', v]); h = v; ta.scrollTop = 0; } });
  vm.runInNewContext(block(chats, '  function growTa(ta)') + '\ngrowTa(ta);', { ta, fitLabel: t => log.push(['fit', t === ta, h]) });
  assert.deepEqual(log, [['height', 'auto'], ['height', '140px'], ['fit', true, '140px']]);
  assert.equal(ta.scrollTop, 37, 'scroll position kept');
  // The CSS on that markup: the strip is a column with room for the label; the label sits bottom-right of the box.
  const sk = createDocument();
  sk.body.innerHTML = '<form class="ch-compose"><div class="ch-field lab-row"><textarea></textarea><button class="ch-mlabel ch-model">Opus</button></div></form>';
  const row = styles(sk.body.querySelector('.ch-field'), [css]), lab = styles(sk.body.querySelector('.ch-mlabel'), [css]);
  assert.equal(row['flex-direction'], 'column'); assert.equal(row['padding-bottom'], '24px');
  assert.equal(lab.position, 'absolute'); assert.equal(lab.right, '4px'); assert.equal(lab.bottom, '1px');
});

test('agent chats show the short family name, never the raw model id', () => {
  const M = models();
  assert.equal(M.short('claude-fable-5-1', 'anthropic'), 'Fable');
  assert.equal(M.short('claude-fable-5-1', 'claude-cli'), 'Fable');
  assert.equal(M.short('claude-opus-5-5', ''), 'Opus');
  // The real thread-header chip (chat-power.js modelChip) on an agent's thread: the short name, the agent's provider.
  const power = read('web/core/chat-power.js');
  const chip = (model, provider, agentProvider) => {
    const ag = { id: 'pi', model: { provider: agentProvider } };
    const r = runRecording(block(power, '  function modelChip(') + '\nthis.modelChip = modelChip;', { M, esc: String, ch: () => ({}),
      threadModel: () => ({ model, provider }), agentOfWin: () => ag, window: { WosAgents: { isOther: () => true, get: () => ag, isPrivate: () => false, modelName: (a, m) => m, lock: () => '' } } });
    const doc = createDocument(); doc.body.innerHTML = r.modelChip({ id: 'w1', thread: 't1' }, { id: 't1' });
    return doc.querySelector('[data-chmodel]').textContent.replace('▾', '').trim();
  };
  assert.equal(chip('claude-fable-5-1', '', 'anthropic'), 'Fable', 'the agent\'s provider names the family');
  assert.equal(chip('claude-opus-5-5', 'anthropic', ''), 'Opus');
  assert.equal(chip('glm-5-3', '', 'wizard-tinfoil'), 'GLM 5.3', 'a private agent on Tinfoil: its route\'s own name (GLM 5.3)');
  assert.equal(chip('mystery-model-9', '', ''), 'Mystery Model 9', 'an unknown model: a readable name, not the raw id');
});

test('tall-draft model menu stays above composer and respects visible keyboard height (James correction)', () => {
  const src = read('web/core/chat-power.js');
  const place = src.slice(src.indexOf('  function placePop(el) {'), src.indexOf('  function openSheet(o) {'));
  for (const composerTop of [600, 260]) {
    for (const viewportHeight of [780, 440]) {
      const styles = new Map(), rect = { top: 0, bottom: 892, right: 412, height: 892 };
      const pop = { getBoundingClientRect: () => rect, style: { setProperty: (k, v) => styles.set(k, parseFloat(v)) } };
      const boxes = {
        '.ch-psheet.ch-mpop': pop,
        '.ch-mlabel': { getBoundingClientRect: () => ({ top: 740, right: 392 }) },
        '.ch-head': { getBoundingClientRect: () => ({ bottom: 80 }) },
        '.ch-compose': { getBoundingClientRect: () => ({ top: composerTop, height: 180 }) },
      };
      const ctx = vm.createContext({ window: { visualViewport: { offsetTop: 0, offsetLeft: 0, height: viewportHeight, width: 412 } }, el: { querySelector: s => boxes[s] || null } });
      vm.runInContext(`${place}; placePop(el);`, ctx);
      const bottom = rect.bottom - styles.get('--mpop-b'), height = styles.get('--mpop-h');
      assert.ok(bottom < composerTop, 'composer must never obscure model rows');
      assert.ok(bottom < viewportHeight, 'keyboard must never obscure model rows');
      assert.ok(height > 40 && bottom - height >= 80, 'bounded scroll area stays below thread header');
    }
  }
  // The card's CSS (real chat-power.css) on the picker's markup: bounded by placePop's height, opaque, above the
  // document-scroll chrome.
  const css = read('web/core/chat-power.css');
  const doc = createDocument();
  doc.documentElement.className = 'wos-doc-scroll';
  doc.body.innerHTML = '<div class="wos-doc-thread"><div class="ch-sheet ch-psheet ch-mpop"><div class="ch-sheet-b"></div></div></div>';
  const card = cascade(doc.querySelector('.ch-sheet-b'), css), wrap = cascade(doc.querySelector('.ch-mpop'), css);
  assert.equal(card['max-height']?.value, 'min(var(--mpop-h, 64%), 440px)', 'placePop\'s --mpop-h bounds the card');
  assert.match(card.background?.value || '', /^linear-gradient\(.+\), var\(--wz-panel, var\(--bg,/, 'an opaque panel');
  assert.deepEqual([wrap.position?.value, wrap.inset?.value, wrap['z-index']?.value], ['fixed', '0', '52'], 'above the native document-scroll chrome (z 50)');
  // The open picker (real chat-power.js) re-places the card when the visible keyboard resizes the viewport.
  const on = {}, placed = [];
  const el = { classList: { add() {}, remove: c => placed.push(['remove', c]) }, style: { removeProperty: k => placed.push(['unset', k]) }, querySelector: () => null };
  const win = { addEventListener() {}, visualViewport: { addEventListener: (t, f) => { on['vv:' + t] = f; } } };
  const open = runRecording(block(src, '    if (sheet.pop) {'), { sheet: { pop: true }, el, window: win, placePop: () => placed.push(['place']),
    requestAnimationFrame: f => (f(), 1), cancelAnimationFrame() {}, AbortController, ResizeObserver: class { observe() {} disconnect() {} } });
  placed.length = 0; on['vv:resize'](); assert.deepEqual(placed, [['place']], 'a keyboard resize places the card again');
  placed.length = 0; open.popOff(); assert.deepEqual(placed, [['remove', 'ch-model-picking'], ['unset', '--mpop-input-max']], 'closing gives the input back its height');
});

test('native keyboard leaves a usable picker above the temporarily shorter input', () => {
  const src = read('web/core/chat-power.js');
  const place = src.slice(src.indexOf('  function placePop(el) {'), src.indexOf('  function openSheet(o) {'));
  const styles = new Map();
  let inputHeight = 140;
  const rect = { top: 0, bottom: 440, right: 412, height: 440 };
  const boxes = {
    '.ch-psheet.ch-mpop': { getBoundingClientRect: () => rect, style: { setProperty: (k, v) => styles.set(k, parseFloat(v)) } },
    '.ch-mlabel': { getBoundingClientRect: () => ({ top: 260, right: 392 }) },
    '.ch-head': { getBoundingClientRect: () => ({ bottom: 53 }) },
    '.ch-compose': { getBoundingClientRect: () => ({ top: 205 - inputHeight, height: inputHeight + 45 }) },
    '.ch-compose textarea': { getBoundingClientRect: () => ({ height: inputHeight }) },
  };
  const el = { querySelector: s => boxes[s] || null, style: { setProperty: (k, v) => { inputHeight = Math.min(140, parseFloat(v)); } } };
  const ctx = vm.createContext({ window: { visualViewport: { offsetTop: 0, offsetLeft: 0, height: 440, width: 412 } }, el });
  vm.runInContext(`${place}; placePop(el); placePop(el);`, ctx);
  assert.equal(inputHeight, 42, 'only the input viewport shrinks; its value is untouched');
  assert.ok(styles.get('--mpop-h') >= 90, 'at least one complete model row remains reachable');
  assert.ok(rect.bottom - styles.get('--mpop-b') < boxes['.ch-compose'].getBoundingClientRect().top);
  // (closing the picker gives the input its height back: the test above runs popOff)
});

test('the composer scripts parse', () => {
  for (const f of ['web/core/chats.js', 'web/core/chat-power.js', 'web/core/chat-models.js']) assert.doesNotThrow(() => new vm.Script(read(f), { filename: f }));
});
