import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
function harness(options) {
  const handlers = {}, c = {}, w = { id: 'w', thread: '__new__' }, renders = [];
  const M = { ready: true, options, visible: () => options, defaultOption: () => options[0], short: x => x, currentRoute: () => ({model: 'other-model', provider: 'other'}) };
  const ctx = { window: { WizCore: { esc: String, clip: String }, WizLive: { session: () => null }, WosModels: M }, document: { addEventListener: (k, fn) => handlers[k] = fn } };
  vm.runInNewContext(read('web/core/chat-power.js'), ctx);
  const power = ctx.window.WosChatPower({ ch: () => c, H: { win: () => w }, CH: { w: c }, toast() {}, renderThreadNow: x => renders.push(x.id) });
  return { power, c, w, handlers, renders };
}
const options = [{ value: 'claude-opus-4', provider: 'anthropic', name: 'Opus' }, { value: 'gpt-6-astra', provider: 'openai', name: 'Astra' }, { value: 'gpt-6-sol', provider: 'openai', name: 'Sol' }];
test('three primary slots plus full picker render; unavailable models are disabled, other current routes remain visible', () => {
  const { power, w } = harness(options.slice(0, 2)); const html = power.modelSwitch(w, null);
  assert.match(html, /role="radiogroup"/); assert.match(html, /aria-checked="true"[^>]*>Opus/); assert.match(html, /data-msi="2"[^>]* disabled>Sol/); assert.match(html, /data-chmodel/);
  const other = power.modelSwitch({ id: 'w', thread: 'existing' }, { id: 'existing' }); assert.match(other, /other-model/);
});
test('keyboard-generated radio activation changes a new chat route without sending a request', async () => {
  const { handlers, c, renders } = harness(options);
  const b = { disabled: false, dataset: { msi: '2' }, closest: () => ({ dataset: { mswid: 'w' } }) };
  await handlers.click({ detail: 0, target: { closest: () => b } });
  assert.equal(c.newModel.model, 'gpt-6-sol'); assert.deepEqual(renders, ['w']);
});
test('desktop title remains slim and the model/actions bar is immediately before composer, independent of phone preview', () => {
  const source = read('web/core/chats.js');
  assert.match(source, /\$\{dbar\}<form class="ch-compose/); assert.match(source, /class="ch-dbar"/);
  assert.match(read('web/core/chats.css'), /\.ch-dbar \.ms/);
});
