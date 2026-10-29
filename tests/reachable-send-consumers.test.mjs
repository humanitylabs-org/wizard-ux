import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// PR689 P2: these consumers render the shared short label directly, unlike the
// list pill. Exercise their production functions with the actual cached probe.
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const reachSource = read('web/core/reach.js');
function productionFunction(file, name, next) {
  const source = read(file), start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf(`\n  function ${next}(`, start);
  assert.ok(start >= 0 && end > start, `${name} production boundary`);
  return source.slice(start, end) + `\nthis.render = ${name};`;
}
const pendingSource = productionFunction('web/core/chats.js', 'pendingState', 'pendingHtml');
const unsentSource = productionFunction('web/core/settings.js', 'unsentRow', 'focusUnsent');
async function diagnosis(outage) {
  const ctx = { navigator: { onLine: true }, location: { hostname: 'synthetic.test' },
    AbortController, Event, setTimeout, clearTimeout, dispatchEvent() {},
    fetch: async () => ({ ok: true, json: async () => ({ overall: outage ? 'down' : 'ok', checks: outage ? [{ id: 'agent-service', ok: false }] : [] }) }) };
  ctx.window = ctx;
  vm.runInNewContext(reachSource, ctx);
  await ctx.WizReach.diagnose(0);
  return ctx.WizReach;
}
for (const outage of [false, true]) for (const consumer of ['in-thread pending', 'Settings Unsent']) {
  test(`${consumer}: ${outage ? 'diagnosed outage keeps Reconnecting' : 'healthy probes use neutral message retry copy'}`, async () => {
    const api = await diagnosis(outage);
    const item = { id: 'synthetic-waiting', state: 'waiting', origin: 'app', text: 'Synthetic retained message', createdAt: 1 };
    const outbox = { quarantined: () => false, canRetry: () => true };
    const ctx = { H: {}, OUTBOX: outbox, esc: s => String(s ?? ''), reach: () => api.failure(),
      troubleshoot: '<button data-chtroubleshoot>Open Troubleshooter</button>', WizReach: api };
    ctx.window = ctx;
    vm.runInNewContext(consumer === 'in-thread pending' ? pendingSource : unsentSource, ctx);
    const before = JSON.stringify(item);
    const html = ctx.render(item, consumer === 'Settings Unsent' ? { outbox } : undefined);
    const expected = outage ? 'Reconnecting…' : 'Message not sent · retrying';
    assert.ok(html.includes(expected), `${consumer} must render ${expected}: ${html}`);
    if (!outage) assert.doesNotMatch(html, /Reconnecting|offline|didn’t take/i);
    assert.match(html, /Retry/);
    assert.match(html, /Troubleshooter/);
    assert.equal(JSON.stringify(item), before, 'rendering must not change retained-message custody');
  });
}
