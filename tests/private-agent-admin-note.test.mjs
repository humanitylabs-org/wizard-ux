import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = f => readFileSync(new URL('../web/' + f, import.meta.url), 'utf8');
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, a); const j = s.indexOf(b, i); assert.ok(j > i, b); return s.slice(i, j); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const words = html => html.split(/<[^>]*>/).join(' ').replace(/\s+/g, ' '); // the text between tags

// The Agents app's permissions block (web/agents/agents.js) with the real core/agents.js, as tests/agent-apps-term.test.mjs runs it.
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

// wizard-os#138: private agents are separated by the Agent Service, not encrypted. The note must say who can still read.
test('private agent note says box administrators and a host Hermes can read its data', () => {
  const p = agentsPage();
  const note = privacy => {
    const html = p.ctx.permsHtml({ wizard_apps: [] }, { privacy, editable: true });
    return words(html.split('<p class="ag-note">').filter(x => /Sealed|other agent/i.test(x)).at(-1) || '');
  };
  const sealed = note('private');
  assert.match(sealed, /^Sealed: no other agent/);
  assert.match(sealed, /not encryption/);
  assert.match(sealed, /administrators/);
  assert.match(sealed, /Hermes/);
  assert.doesNotMatch(note('standard'), /^Sealed/, 'a standard agent does not claim to be sealed');
});
