import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { between } from './fixtures/source-slice.mjs';

// Opening the model sheet must refetch the catalogue (a newly entitled model like Astra appears without a
// Wizard reload) and repaint only when the list actually changed. The real openModels from chat-power.js runs here
// against a fake model catalogue (wizard-ux issue 1674: tests run the code).
const src = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');

function sheetHarness({ ready = true, options = [{ provider: 'anthropic', value: 'opus', name: 'Opus' }] } = {}) {
  const loads = [], paints = [], cat = { options };
  let resolve;
  const M = { get ready() { return ready; }, get options() { return cat.options; }, load: force => (loads.push(force), new Promise(r => { resolve = r; })) };
  const w = { id: 'w1', thread: 't1' };
  const ctx = { M, A: { owner: p => p, elOf: () => ({}), winAgent: () => '' }, H: { win: () => w }, LIVE: { session: () => ({ id: 't1' }) },
    chanPane: () => false, paneThread: () => 't1', chanCur: () => null, newModel: () => null, ch: () => ({}), threadModel: () => ({ model: 'opus', provider: 'anthropic' }),
    agentOfWin: () => '', paint: pane => paints.push(pane), sheet: null };
  vm.createContext(ctx);
  vm.runInContext(`let sheet = null; function openSheet(o) { sheet = o; }\n${between(src, '  function openModels(pane, mode, pop) {', '  function openFiles(pane) {')}\nthis.open = openModels;`, ctx);
  return { ctx, cat, loads, paints, settle: async () => { resolve(); await new Promise(r => setImmediate(r)); } };
}

test('model sheet revalidates the catalogue on every open', async () => {
  const warm = sheetHarness({ ready: true });
  warm.ctx.open('w1', 'thread');
  assert.deepEqual(warm.loads, [true], 'forces a refresh once the cache is warm');
  await warm.settle();
  assert.deepEqual(warm.paints, [], 'nothing changed: no repaint');

  const cold = sheetHarness({ ready: false });
  cold.ctx.open('w1', 'thread');
  assert.deepEqual(cold.loads, [false], 'a cold cache loads too (never a forced refetch on top of the first read)');

  const grew = sheetHarness();
  grew.ctx.open('w1', 'thread');
  grew.cat.options = [...grew.cat.options, { provider: 'openai-codex', value: 'gpt-astra', name: 'Astra' }]; // Astra arrives
  await grew.settle();
  assert.deepEqual(grew.paints, ['w1'], 'repaints once the list changed');
});
