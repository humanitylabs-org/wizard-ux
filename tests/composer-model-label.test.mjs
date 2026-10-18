import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function models() {
  const window = { WosAgents: { lock: () => '<svg class="ag-lock"></svg>' } };
  const ctx = vm.createContext({ window, localStorage: { getItem: () => null, setItem() {} }, fetch: async () => ({}), console });
  vm.runInContext(read('web/core/chat-models.js'), ctx);
  const M = window.WosModels;
  const mk = (value, provider, name) => ({ value, provider, name, description: '' });
  M.options = [mk('claude-opus-5-5', 'anthropic', 'Claude Opus'), mk('claude-fable-5-1', 'anthropic', 'Claude Fable'), mk('claude-sonnet-5', 'anthropic', 'Claude Sonnet'),
    mk('gpt-6-astra', 'openai-codex', 'Astra'), mk('gpt-6.1-sol', 'openai-codex', 'GPT 6.1 Sol'), mk('gpt-6-luna', 'openai-codex', 'Luna')];
  M.options[0].isGlobalDefault = true; M.ready = true;
  return M;
}
const priv = [{ value: 'glm-5.3', provider: 'custom', name: 'GLM 5.3', agent: 'private-1', private: true }];
const order = html => [...html.matchAll(/<span>([^<]+)<\/span><\/div>|<b>(?:<svg[^>]*><\/svg>)?([^<]+)<\/b>|data-mall>([^<]+)</g)].map(m => m[1] ? `## ${m[1]}` : m[2] || m[3]);

test('compact menu reads bottom-up from the thumb: Opus, Astra, Sol last, Private agent above, More models on top', () => {
  const M = models();
  const { html, list } = M.popHtml({ mode: 'thread', cur: { model: 'claude-opus-5-5', provider: 'anthropic' }, all: false, priv });
  assert.deepEqual(order(html), ['More models', '## Private agent', 'GLM 5.3', '## Models', 'Opus', 'Astra', 'Sol']);
  assert.match(html, /class="ch-sheet ch-mpop"/);
  assert.equal(list.length, 4); // every row maps to a pickable option
});

test('in a private chat the private models sit by the thumb and the main models move above', () => {
  const M = models();
  const { html } = M.popHtml({ mode: 'new', cur: { model: 'glm-5.3', provider: 'custom', agent: 'private-1' }, all: false, priv });
  const o = order(html);
  assert.deepEqual(o.slice(-2), ['## Private agent', 'GLM 5.3']);
  assert.ok(o.indexOf('## Models') < o.indexOf('## Private agent'));
});

test('More models expands to the other families once each, above the primary three', () => {
  const M = models();
  const { html } = M.popHtml({ mode: 'thread', cur: { model: 'claude-opus-5-5', provider: 'anthropic' }, all: true, priv: [] });
  const o = order(html);
  assert.deepEqual(o.slice(-3), ['Opus', 'Astra', 'Sol']);
  assert.ok(o.includes('Fable') || o.includes('Claude Fable'));
  assert.equal(o.filter(x => /Opus/.test(x)).length, 1);
});

test('the thread header no longer carries the model; the label lives inside the message box with early wrap', () => {
  const chats = read('web/core/chats.js'), power = read('web/core/chat-power.js'), css = read('web/core/chat-power.css');
  assert.match(chats, /<div class="ch-field"><textarea/);
  assert.match(chats, /\$\{mlabel\}<\/div>/);
  assert.match(chats, /const chip = PW && !PW\.modelLabel \? PW\.modelChip\(w, s\) : ''/);
  assert.match(chats, /function fitLabel\(el\)/);
  assert.match(power, /function modelLabel\(w, s\)/);
  assert.match(power, /pop: !!pop && mode !== 'retry'/);
  assert.match(css, /\.ch-field > \.ch-mlabel \{ position: absolute; right: 4px; bottom: 1px;/);
});
