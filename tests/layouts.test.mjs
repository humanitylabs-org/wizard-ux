// Layouts (James, 22 Oct 2026): UX changes ship as an opt-in layer worn over any skin. Classic is the shell as
// everyone has it and loads nothing. The first layout, "Two orbs", went in wizard-ux issue 1338 (with Orb and Apps); the
// contract is now held against the one layout left, the desktop AI apps view (its desktop entry). These tests hold it:
//   - nobody gets a layout unless they pick one (no attribute, no CSS, no script, the orb's tap is untouched);
//   - picking one loads only its own files; going back to Classic removes everything it added;
//   - a broken layout turns itself off without touching the skin;
//   - layout CSS applies only under html[data-layout="<id>"];
//   - an agent-orb take keeps its agent through recovery, so it never falls back to the main agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withSkinHostParts } from './fixtures/skin-host-parts.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { between, block } from './fixtures/source-slice.mjs';

const root = new URL('../', import.meta.url);
const read = p => withShellParts(readFileSync(new URL(p, root), 'utf8'));
const settle = () => new Promise(r => setTimeout(r, 15));

function page({ layout = null, search = '' } = {}) {
  const links = [], mounted = [], toasts = [];
  const el = tag => ({ tag, nodeType: 1, dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { const i = links.indexOf(this); if (i >= 0) links.splice(i, 1); const j = mounted.indexOf(this); if (j >= 0) mounted.splice(j, 1); } });
  const device = { appendChild(n) { mounted.push(n); } };
  const ls = { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = String(v); }, removeItem(k) { delete this._[k]; } };
  // The desktop boots AI apps unless the device chose Desks; a stored layout hint stands in for no choice.
  if (layout) ls._['wos.layout'] = layout; else ls._['wos.desktop-view.v1'] = 'classic';
  const ctx = {
    console: { warn() {}, log() {} }, URL, URLSearchParams, location: { search }, Date, Promise, Set, Map, Object, Array, JSON, Math, Error, String, Blob,
    setTimeout, clearTimeout,
    navigator: { userAgent: 'Mozilla/5.0 (Macintosh)' }, matchMedia: () => ({ matches: false }),
    requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: id => clearTimeout(id),
    localStorage: ls,
    document: {
      baseURI: 'https://wizard.test/wizard-os-home/', documentElement: { dataset: { shell: 'desktop' }, removeAttribute() {} },
      createElement: el, head: { appendChild(n) { links.push(n); } },
      querySelector: () => null, getElementById: id => (id === 'device' ? device : null), addEventListener() {},
    },
  };
  ctx.window = ctx;
  ctx.window.WosSkin = { current: 'nebula', list: [{ id: 'nebula', name: 'Nebula' }], pkgOf: () => null };
  ctx.module = { exports: {} };
  vm.runInNewContext(withSkinHostParts(read('web/core/skin-host.js')), ctx);
  const host = ctx.window.WosSkinHost, imported = [];
  let mod = { default: api => { const n = el('button'); api.mount(n); api.orb.onTap(() => true); } };
  host._test.setImporter(async u => { imported.push(u); return mod; });
  const calls = [];
  const adapter = {
    route: () => ({ view: 'desk', thread: null, desk: 0, app: 'chats', agent: 'hermes' }),
    back() {}, openList() {}, openThread() {}, goDesk() {}, deskCount: () => 3, root: () => null, dock: () => null,
    locked: () => false, toast: t => toasts.push(t),
    agents: () => [{ id: 'hermes', label: 'Archimedes', colour: 'hsl(265 72% 62%)', main: true }, { id: 'philosopher', label: 'Philosopher', colour: 'hsl(40 72% 62%)' }],
    agentHere: () => ({ id: 'hermes', label: 'Archimedes', main: true, why: 'main' }), agentSigil: () => '',
    voiceState: () => ({ state: 'idle' }), talk: id => calls.push(['talk', id]), voiceTap: () => calls.push(['tap']), dictate: () => true,
  };
  return { host, ctx, links, mounted, imported, toasts, calls, adapter, setMod: m => { mod = m; } };
}

test('Classic (the default): no attribute, no layout files, the orb tap stays the shell\'s', async () => {
  const P = page();
  P.host.attach(P.adapter); await settle();
  assert.equal(P.host.layout, 'classic');
  assert.equal(P.ctx.document.documentElement.dataset.layout, undefined);
  assert.equal(P.links.length, 0); assert.equal(P.imported.length, 0); assert.equal(P.mounted.length, 0);
  assert.equal(P.host.orbTap(), false, 'nothing intercepts the dock orb');
});

test('a layout loads its own css and script only, and Classic removes everything it added', async () => {
  const P = page();
  P.host.attach(P.adapter);
  P.host.setLayout('ai-apps'); await settle();
  assert.equal(P.ctx.document.documentElement.dataset.layout, 'ai-apps');
  assert.deepEqual(P.links.map(l => l.href), ['https://wizard.test/wizard-os-home/layouts/ai-apps/desktop-boot.css']);
  assert.deepEqual(P.imported, ['https://wizard.test/wizard-os-home/layouts/ai-apps/desktop.js']);
  assert.equal(P.mounted.length, 1); assert.equal(P.host.orbTap(), true);
  assert.equal(P.ctx.localStorage._['wos.layout'], 'ai-apps');
  P.host.setLayout('classic'); await settle();
  assert.equal(P.ctx.document.documentElement.dataset.layout, undefined);
  assert.equal(P.links.length, 0, 'layout css removed'); assert.equal(P.mounted.length, 0, 'agent orb removed');
  assert.equal(P.host.orbTap(), false); assert.equal(P.ctx.localStorage._['wos.layout'], undefined);
});

test('a stored layout paints before the shell attaches (no flash), then its script loads on attach', async () => {
  const P = page({ layout: 'ai-apps' });
  assert.equal(P.ctx.document.documentElement.dataset.layout, 'ai-apps');
  assert.equal(P.links.filter(l => l.tag === 'link').length, 1); assert.equal(P.imported.length, 0, 'no script before the shell is ready');
  assert.equal(P.links.filter(l => l.tag === 'style').length, 1, 'plus the inline boot veil (issue 1556)');
  P.host.attach(P.adapter); await settle();
  assert.equal(P.imported.length, 1); assert.equal(P.host.layoutState.active, true);
});

test('issue 1556: before the shell attaches the boot veil never gives up, however long the parser takes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const P = page({ layout: 'ai-apps' });
  assert.equal(P.ctx.document.documentElement.dataset.layoutBooting, '');
  t.mock.timers.tick(120000);
  assert.notEqual(P.ctx.document.documentElement.dataset.layoutBooting, undefined, 'still veiled: no shell to recover with yet');
});

test('unknown layout ids fall back to Classic', async () => {
  // On the desktop an unknown stored hint means no choice: the standard view (AI apps) boots, as with no hint at all.
  for (const id of ['nope', 'two-orb', 'orb', 'apps']) assert.equal(page({ layout: id }).host.layout, 'ai-apps', id);
  const P = page(); P.host.attach(P.adapter); await settle();
  assert.equal(P.host.layout, 'classic'); assert.equal(P.links.length, 0);
  assert.equal(P.host.setLayout('../../evil'), 'classic');
  // The removed layouts (wizard-ux issue 1338) are unknown now: setLayout refuses them.
  for (const id of ['two-orb', 'orb', 'apps']) assert.equal(P.host.setLayout(id), 'classic', id);
});

test('broken layout callbacks stay contained without removing navigation, and can recover', async () => {
  const P = page();
  let tap, attempts = 0;
  P.setMod({ default: api => { tap = api.orb.onTap(() => { if (++attempts <= 3) throw new Error('boom'); return true; }); } });
  P.host.attach(P.adapter); P.host.setLayout('ai-apps'); await settle();
  for (let i = 0; i < 3; i++) assert.notEqual(P.host.orbTap(), true);
  assert.equal(P.host.layoutState.disabled, false); assert.equal(P.host.layoutState.active, true);
  assert.equal(P.host.orbTap(), true, 'the existing hook can recover on its next call');
  assert.ok(!P.toasts.some(t => /turned off/.test(t)));
  assert.equal(typeof tap, 'function');
});

test('the agent API reaches the shell adapter (talk, tap, list, here)', async () => {
  const P = page(); let api;
  P.setMod({ default: a => { api = a; } });
  P.host.attach(P.adapter); P.host.setLayout('ai-apps'); await settle();
  assert.deepEqual(api.agents.list().map(a => a.id), ['hermes', 'philosopher']);
  assert.equal(api.agents.here().id, 'hermes');
  api.voice.talk('philosopher'); api.voice.tap();
  assert.deepEqual(P.calls, [['talk', 'philosopher'], ['tap']]);
  assert.equal(api.route().agent, 'hermes');
});

test('the shell wires layouts: orb tap hook, Settings row, agent kept on recovered takes', () => {
  const app = read('web/app.js'), raw = p => readFileSync(new URL(p, root), 'utf8');
  // The orb's tap (web/app-orbswipe.js): a layout that takes the tap (orbTap() true) gets it; otherwise the stock take.
  const tapLine = between(raw('web/app-orbswipe.js'), "      if (V.state === 'idle') return window.WosSkinHost?.orbTap?.()", '\n');
  const tap = orbTap => { const calls = []; vm.runInNewContext(`(() => {${tapLine}})()`, { V: { state: 'idle' }, window: { WosSkinHost: orbTap === undefined ? undefined : { orbTap } }, startOrbVoice: () => calls.push('stock') }); return calls; };
  assert.deepEqual(tap(() => true), [], 'the layout took the tap');
  assert.deepEqual(tap(() => false), ['stock']); assert.deepEqual(tap(undefined), ['stock'], 'no layout: the stock take');
  // The layout API's talk(id) (web/app-agentorb.js) talks to that agent.
  const talkLine = between(raw('web/app-agentorb.js'), '    talk: id => talkTo(id),', '\n');
  const talked = []; const api = vm.runInNewContext(`({${talkLine}})`, { talkTo: id => talked.push(id) });
  api.talk('philosopher'); assert.deepEqual(talked, ['philosopher']);
  // startVoice (app.js): an agent pick routes only to that agent; the main agent and dictation keep their route.
  const pick = block(app, "    if (initialSnap && kind === 'general' && opt.agent && window.WosAgents?.isOther(opt.agent)) {");
  const route = (kind, agent) => {
    const initialSnap = { route: { model: 'm', provider: 'p' } }, toasts = [];
    const ctx = { initialSnap, kind, opt: { agent }, toast: (...a) => toasts.push(a), esc: String,
      window: { WosAgents: { isOther: id => id !== 'hermes' }, WosModels: { snapshot: (sid, choice, ag) => ({ model: 'agent-m', provider: 'agent-p', agent: ag }) } } };
    vm.runInNewContext(`(() => {${pick}})()`, ctx); return JSON.parse(JSON.stringify(initialSnap.route));
  };
  assert.deepEqual(route('general', 'philosopher'), { model: 'agent-m', provider: 'agent-p', agent: 'philosopher' });
  assert.deepEqual(route('general', 'hermes'), { model: 'm', provider: 'p' });
  assert.deepEqual(route('general', ''), { model: 'm', provider: 'p' });
  assert.doesNotMatch(read('web/core/settings.js'), /data-layoutpick|data-layout-row/);
  // A recovered take keeps its agent (core/chat-models.js keepVoiceRoute / voiceRoute).
  const store = new Map(), window = {};
  vm.runInNewContext(raw('web/core/chat-models.js'), { window, localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }, fetch: async () => ({}), console, document: { documentElement: { dataset: {} } } });
  const M = window.WosModels, asked = [];
  M.currentRoute = (sid, saved, agent) => { asked.push([sid, saved.model, agent]); return { ...saved }; };
  M.keepVoiceRoute('take-1', { model: 'claude-opus', provider: 'anthropic', agent: 'philosopher' });
  M.keepVoiceRoute('take-2', { model: 'claude-opus', provider: 'anthropic' });
  assert.deepEqual(JSON.parse(store.get('wos.voice-model-routes.v1')), { 'take-1': { model: 'claude-opus', provider: 'anthropic', agent: 'philosopher' }, 'take-2': { model: 'claude-opus', provider: 'anthropic' } });
  M.voiceRoute('take-1'); M.voiceRoute('take-2');
  assert.deepEqual(asked, [['', 'claude-opus', 'philosopher'], ['', 'claude-opus', '']], 'the saved agent goes back into the route');
});

test('a ?layout= link turns a layout on or off and remembers it', async () => {
  const on = page({ search: '?layout=ai-apps' });
  assert.equal(on.ctx.document.documentElement.dataset.layout, 'ai-apps');
  assert.equal(on.ctx.localStorage._['wos.layout'], 'ai-apps');
  const off = page({ layout: 'ai-apps', search: '?layout=classic' });
  assert.equal(off.ctx.document.documentElement.dataset.layout, undefined);
  assert.equal(off.ctx.localStorage._['wos.layout'], undefined);
  const junk = page({ search: '?layout=../x' }); assert.equal(junk.ctx.localStorage._['wos.layout'], undefined);
});
