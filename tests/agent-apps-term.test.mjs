// Decision #84 (wizard-os docs/DECISIONS.md, 23 Oct 2026): owners never see "Wizard apps". Screenless apps agents use are
// "Agent apps", apps with a screen are plain "Apps". Code identifiers (kind: 'wizard', data-wizard-apps) keep their names.
// Each test renders the real screen code and reads what the owner sees (wizard-ux issue 1674: tests run the code).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = f => readFileSync(new URL('../web/' + f, import.meta.url), 'utf8');
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, a); const j = s.indexOf(b, i); assert.ok(j > i, b); return s.slice(i, j); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const words = html => html.split(/<[^>]*>/).join(' ').replace(/\s+/g, ' '); // the text between tags

// The Agents app's permissions block and its Add sheet (web/agents/agents.js), with the real core/agents.js.
function agentsPage({ apps = [] } = {}) {
  const ctx = { console, fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }), localStorage: { getItem: () => null, setItem() {} },
    addEventListener() {}, dispatchEvent() {}, CustomEvent: class {}, setTimeout, clearTimeout, location: { pathname: '/agents/' },
    document: { documentElement: { dataset: { leaving: '1' }, getAttribute: () => '' } } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(src('core/agents.js'), ctx);
  const page = src('agents/agents.js');
  const S = { view: { name: 'detail', id: 'a1' }, sheet: null, opts: { wizard_apps: [{ id: 'calendar', label: 'Calendar' }, { id: 'notes', label: 'Notes' }], agent_apps: [{ id: 'search', label: 'Search', kind: 'tool' }], outside_tools: [], other_agents: ['none'] } };
  ctx.AG = ctx.WosAgents; ctx.AG.get = () => ({ id: 'a1', privacy: 'standard', permissions: { wizard_apps: apps } }); ctx.S = S; ctx.esc = esc;
  vm.runInContext(`${between(page, '  const PLUS = ', '\n  /* ---------------- data')}
${between(page, '  const list = ', '  const provider = ')}
${between(page, '  function permsHtml(', '  /* ---------------- detail')}
${between(page, '  function sheetHtml() {', '  /* ---------------- render + events')}
this.permsHtml = permsHtml; this.sheetHtml = sheetHtml;`, ctx);
  return { ctx, S };
}

test('agent page: sections, empty line, Add button, picker title and note say Apps, never Wizard apps', () => {
  const p = agentsPage();
  const none = p.ctx.permsHtml({ wizard_apps: [] }, { privacy: 'standard', editable: true });
  assert.match(none, /<div class="ag-sec">Apps<small>0<\/small><\/div>/);
  assert.match(none, /No apps\./);
  assert.match(none, /data-add="wizard">.*Add app<\/button>/);
  const two = agentsPage({ apps: ['calendar'] }).ctx.permsHtml({ wizard_apps: ['calendar'] }, { privacy: 'standard', editable: true });
  assert.match(two, /<b>Calendar<\/b><small>App<\/small>/, 'an app row is labelled App');
  p.S.sheet = { type: 'add', kind: 'wizard' };
  const sheet = p.ctx.sheetHtml();
  assert.match(sheet, /<h2>Add app<\/h2><p class="ag-note">Apps have their own screen\. The agent can use them for you\./);
  for (const h of [none, two, sheet]) assert.doesNotMatch(words(h), /Wizard apps?\b/i);
});

test('stock Apps sheet group is headed Apps', () => {
  const app = src('app.js'), body = { scrollTop: 0, scrollHeight: 0, innerHTML: '' };
  const APPS = [{ id: 'calendar', name: 'Calendar', kind: 'wizard' }, { id: 'notes', name: 'Notes', kind: 'wizard' }, { id: 'apk', name: 'Native', kind: 'native' }];
  const ctx = { $: () => body, store: { get: (k, d) => d }, APP: Object.fromEntries(APPS.map(a => [a.id, a])), APPS, esc,
    ico: () => '<span class="ic"></span>', tileN: 0, window: { WizCore: { isMaintenanceApp: () => false } } };
  vm.createContext(ctx);
  vm.runInContext(`let tileN = 0;\n${between(app, '  function appTile(a) {', '  function appRow(')}\n${between(app, '  function renderLauncher(q, live) {', '    const n = norm(q);')} }\nthis.renderLauncher = renderLauncher;`, ctx);
  ctx.renderLauncher('', false);
  assert.match(body.innerHTML, /<div class="lgroup"><h4>Apps <span>2<\/span><\/h4>/);
  assert.doesNotMatch(words(body.innerHTML), /Wizard apps/i);
});

test('share sheet: People → Apps → Other apps', () => {
  let el;
  const map = new Map([['wos.share.receivers.v1', JSON.stringify({ messenger: { accepts: ['text'], targets: [{ id: 'p1', name: 'Test Person' }] }, notes: { accepts: ['text'] } })], ['wos.share.recent.v1', '[]']]);
  const window = { WizCore: { apps: () => ({ APP: { messenger: { kind: 'wizard', name: 'Messenger' }, notes: { kind: 'wizard', name: 'Notes' } } }) },
    WizAppServices: { claimShare: () => true }, WizOpenApp: () => true, dispatchEvent() {} };
  const document = { body: { appendChild() {} }, createElement() { el = { style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, remove() {}, querySelector: () => null, addEventListener() {} }; return el; } };
  vm.runInNewContext(src('core/share-sheet.js'), { window, document, localStorage: { getItem: k => map.get(k), setItem: (k, v) => map.set(k, v) },
    Date, File, Blob, URL, CustomEvent: class {}, requestAnimationFrame: f => f(), setTimeout: f => f(), clearTimeout: () => {} });
  window.WosShareSheet.show({ text: 'Synthetic' }, () => 'unsupported');
  const seen = words(el.innerHTML);
  const at = w => seen.indexOf(w);
  assert.ok(at('People') >= 0 && at('People') < at(' Apps ') && at(' Apps ') < at('Other apps'), seen);
  assert.match(el.innerHTML, /<div class="shs-sub">Apps<\/div>/);
  assert.doesNotMatch(seen, /Wizard apps/i);
});
