// Layouts (James, 22 Oct 2026): UX changes ship as an opt-in layer worn over any skin. Classic is the shell as
// everyone has it and loads nothing; "Two orbs" is the first layout. These tests hold the contract:
//   - nobody gets a layout unless they pick one (no attribute, no CSS, no script, the orb's tap is untouched);
//   - picking one loads only its own files; going back to Classic removes everything it added;
//   - a broken layout turns itself off without touching the skin;
//   - layout CSS applies only under html[data-layout="<id>"];
//   - an agent-orb take keeps its agent through recovery, so it never falls back to the main agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const settle = () => new Promise(r => setTimeout(r, 15));

function page({ layout = null } = {}) {
  const links = [], mounted = [], toasts = [];
  const el = tag => ({ tag, nodeType: 1, dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { const i = links.indexOf(this); if (i >= 0) links.splice(i, 1); const j = mounted.indexOf(this); if (j >= 0) mounted.splice(j, 1); } });
  const device = { appendChild(n) { mounted.push(n); } };
  const ls = { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = String(v); }, removeItem(k) { delete this._[k]; } };
  if (layout) ls._['wos.layout'] = layout;
  const ctx = {
    console: { warn() {}, log() {} }, URL, Date, Promise, Set, Map, Object, Array, JSON, Math, Error, String, Blob,
    setTimeout, clearTimeout,
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)' }, matchMedia: () => ({ matches: true }),
    requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: id => clearTimeout(id),
    localStorage: ls,
    document: {
      baseURI: 'https://wizard.test/wizard-os-home/', documentElement: { dataset: { shell: 'phone' } },
      createElement: el, head: { appendChild(n) { links.push(n); } },
      querySelector: () => null, getElementById: id => (id === 'device' ? device : null), addEventListener() {},
    },
  };
  ctx.window = ctx;
  ctx.window.WosSkin = { current: 'nebula', list: [{ id: 'nebula', name: 'Nebula' }], pkgOf: () => null };
  ctx.module = { exports: {} };
  vm.runInNewContext(read('web/core/skin-host.js'), ctx);
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

test('Two orbs: its own css and script only, and Classic removes everything it added', async () => {
  const P = page();
  P.host.attach(P.adapter);
  P.host.setLayout('two-orb'); await settle();
  assert.equal(P.ctx.document.documentElement.dataset.layout, 'two-orb');
  assert.deepEqual(P.links.map(l => l.href), ['https://wizard.test/wizard-os-home/layouts/two-orb/layout.css']);
  assert.deepEqual(P.imported, ['https://wizard.test/wizard-os-home/layouts/two-orb/layout.js']);
  assert.equal(P.mounted.length, 1); assert.equal(P.host.orbTap(), true);
  assert.equal(P.ctx.localStorage._['wos.layout'], 'two-orb');
  P.host.setLayout('classic'); await settle();
  assert.equal(P.ctx.document.documentElement.dataset.layout, undefined);
  assert.equal(P.links.length, 0, 'layout css removed'); assert.equal(P.mounted.length, 0, 'agent orb removed');
  assert.equal(P.host.orbTap(), false); assert.equal(P.ctx.localStorage._['wos.layout'], undefined);
});

test('a stored layout paints before the shell attaches (no flash), then its script loads on attach', async () => {
  const P = page({ layout: 'two-orb' });
  assert.equal(P.ctx.document.documentElement.dataset.layout, 'two-orb');
  assert.equal(P.links.length, 1); assert.equal(P.imported.length, 0, 'no script before the shell is ready');
  P.host.attach(P.adapter); await settle();
  assert.equal(P.imported.length, 1); assert.equal(P.host.layoutState.active, true);
});

test('unknown layout ids fall back to Classic', async () => {
  const P = page({ layout: 'nope' }); P.host.attach(P.adapter); await settle();
  assert.equal(P.host.layout, 'classic'); assert.equal(P.links.length, 0);
  assert.equal(P.host.setLayout('../../evil'), 'classic');
});

test('a broken layout turns itself off and the shell carries on', async () => {
  const P = page();
  let tap;
  P.setMod({ default: api => { tap = api.orb.onTap(() => { throw new Error('boom'); }); } });
  P.host.attach(P.adapter); P.host.setLayout('two-orb'); await settle();
  for (let i = 0; i < 3; i++) assert.notEqual(P.host.orbTap(), true);
  assert.equal(P.host.layoutState.disabled, true); assert.equal(P.host.layoutState.active, false);
  assert.equal(P.host.orbTap(), false, 'the classic tap is back');
  assert.ok(P.toasts.some(t => /turned off/.test(t)));
  assert.equal(typeof tap, 'function');
});

test('the agent API reaches the shell adapter (talk, tap, list, here)', async () => {
  const P = page(); let api;
  P.setMod({ default: a => { api = a; } });
  P.host.attach(P.adapter); P.host.setLayout('two-orb'); await settle();
  assert.deepEqual(api.agents.list().map(a => a.id), ['hermes', 'philosopher']);
  assert.equal(api.agents.here().id, 'hermes');
  api.voice.talk('philosopher'); api.voice.tap();
  assert.deepEqual(P.calls, [['talk', 'philosopher'], ['tap']]);
  assert.equal(api.route().agent, 'hermes');
});

test('layout files exist and every rule is scoped to its layout', () => {
  for (const f of ['web/layouts/two-orb/layout.css', 'web/layouts/two-orb/layout.js']) assert.ok(existsSync(new URL(f, root)), f);
  const css = read('web/layouts/two-orb/layout.css').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  for (const m of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const top = []; let d = 0, cur = ''; for (const ch of m[1]) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { top.push(cur); cur = ''; } else cur += ch; } top.push(cur);
    for (const sel of top.map(x => x.trim()).filter(Boolean)) assert.match(sel, /^html\[data-layout="two-orb"\]/, sel);
  }
  const js = read('web/layouts/two-orb/layout.js');
  assert.doesNotMatch(js, /__wos|localStorage|fetch\(|\bimport\b/, 'layouts use the hook API only');
});

test('the shell wires layouts: orb tap hook, Settings row, agent kept on recovered takes', () => {
  const app = read('web/app.js');
  assert.match(app, /window\.WosSkinHost\?\.orbTap\?\.\(\) \? undefined : startOrbVoice\(\)/);
  assert.match(app, /talk: id => talkTo\(id\)/);
  assert.match(app, /opt\.agent && window\.WosAgents\?\.isOther\(opt\.agent\)/, 'an agent pick routes only to that agent');
  assert.match(read('web/core/settings.js'), /data-layoutpick/);
  const models = read('web/core/chat-models.js');
  assert.match(models, /route\.agent \? \{ agent: route\.agent \}/);
  assert.match(models, /M\.currentRoute\('', saved, saved\.agent \|\| ''\)/);
});
