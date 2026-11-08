import { modelContext, runWithChatsModel } from './fixtures/chats-list-model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const chats = fs.readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8');
const live = fs.readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
// James, 7 Nov 2026: the 'Helper still working' pill is gone everywhere; the Working spinner already shows it.
test('no helper badge on any row, and its pill styling is gone', () => {
  assert.doesNotMatch(chats, /backgroundBadge|Helper still working/);
  assert.doesNotMatch(css, /\.ch-background \{/);
});
test('full list and slim list preserve the server background field without inventing Ready state', () => {
  assert.match(live, /background: \['helper', 'heavy'\]\.includes\(item\.wizard_background\)/);
  assert.match(live, /item\.listVersion === 1/);
});
test('Working helper rows keep their waiting label while preferring the latest reply preview', () => {
  assert.match(chats, /helperLabel\(s\.helperStatus\)/);
  assert.ok(live.includes('item.wizard_helper_status ? (latestText || clean(text(item.preview)) || userText)'));
});
// Parity (AGENTS.md): run the real list normalizer and row badge for a main thread and every routed runtime kind.
function pipeline() {
  const a = live.indexOf('  const READY_OR_ATTENTION'), b = live.indexOf('  /* ---- thread-seen');
  const lines = chats.split('\n');
  const pick = re => lines.find(l => re.test(l));
  assert.ok(a > 0 && b > a, 'live.js normalizer block found');
  const context = modelContext({});
  vm.runInContext(`${live.slice(a, b)}\n${pick(/const WORKING_ST =/)}\n${pick(/const isWorking =/)}\n${pick(/const attOf =/)}\nthis.normalize = normalize;`, context);
  return context;
}
test('main and routed rows (host-profile, container, restricted) keep background from full and slim lists', () => {
  const { normalize } = pipeline();
  const ask = { state: 'needs_you', ask: 'Your QR is ready. Scan it to connect your phone', subject: 'Phone' };
  for (const kind of ['main', 'host-profile', 'container', 'restricted']) {
    const agent = kind === 'main' ? '' : `qa-${kind}`;
    const full = normalize({ id: `qr-${kind}`, status: 'completed', agent, runtimeKind: kind, wizard_attention: ask, wizard_background: 'helper' });
    assert.equal(full.agent, agent);
    assert.equal(full.background, 'helper', `${kind} full row keeps background`);
    const working = normalize({ id: `fyi-${kind}`, status: 'running', agent, wizard_attention: { state: 'fyi', ask: 'Still building' }, wizard_background: 'helper', wizard_waiting_on: 'helper' });
    assert.equal(working.waitingOn, 'helper');
    const stray = normalize({ id: `x-${kind}`, status: 'completed', agent, wizard_attention: ask, wizard_background: 'root' });
    assert.equal(stray.background, '', 'unknown background values are dropped');
  }
});
