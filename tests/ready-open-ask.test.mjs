import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const chats = fs.readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8');
const live = fs.readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
function badge(s) {
  const context = vm.createContext({ s, attOf: s => s.status === 'completed' ? s.attention : null });
  const line = chats.split('\n').find(l => l.includes('const backgroundBadge ='));
  return vm.runInContext(line + '\nbackgroundBadge(s)', context);
}
test('QR delivered while helper builds button remains Ready with a muted helper badge', () => {
  assert.match(badge({ status: 'completed', attention: { state: 'needs_you', ask: 'Scan the QR' }, background: 'helper' }), /Helper still working/);
  assert.match(chats, /\$\{backgroundBadge\(s\)\}/);
});
test('progress-only Working rows and finished rows without background have no helper badge', () => {
  assert.equal(badge({ status: 'running', attention: { state: 'fyi' }, background: 'helper' }), '');
  assert.equal(badge({ status: 'completed', attention: { state: 'done' } }), '');
});
test('full list and slim list preserve the server background field without inventing Ready state', () => {
  assert.match(live, /background: \['helper', 'heavy'\]\.includes\(item\.wizard_background\)/);
  assert.match(live, /item\.listVersion === 1/);
});
test('helper badge reuses existing chip geometry and Wizard skin tokens in dark and light', () => {
  assert.match(badge({ status: 'completed', attention: { state: 'check' }, background: 'heavy' }), /ch-privtag ch-background/);
  const style = css.match(/\.ch-background \{([^}]+)\}/)[1];
  assert.match(style, /var\(--wz-text-secondary/);
  assert.match(style, /var\(--wz-surface/);
  assert.match(style, /font-weight: 400/);
});
test('Working helper rows keep their waiting label while preferring the latest reply preview', () => {
  assert.match(chats, /helperLabel\(s\.helperStatus\)/);
  assert.ok(live.includes('item.wizard_helper_status ? (latestText || clean(text(item.preview)) || userText)'));
});
test('helper badge stays visible on a phone: it sits outside the truncated title (James, 28 Oct 2026)', () => {
  assert.ok(chats.includes('${esc(s.title)}</b>${backgroundBadge(s)}<time>'));
  assert.ok(!chats.includes('${backgroundBadge(s)}</b>'));
});

// Parity (AGENTS.md): run the real list normalizer and row badge for a main thread and every routed runtime kind.
function pipeline() {
  const a = live.indexOf('  const READY_OR_ATTENTION'), b = live.indexOf('  /* ---- thread-seen');
  const lines = chats.split('\n');
  const pick = re => lines.find(l => re.test(l));
  assert.ok(a > 0 && b > a, 'live.js normalizer block found');
  const context = vm.createContext({});
  vm.runInContext(`${live.slice(a, b)}\n${pick(/const WORKING_ST =/)}\n${pick(/const isWorking =/)}\n${pick(/const backgroundBadge =/)}\n${pick(/const attOf =/)}\nthis.normalize = normalize; this.badge = backgroundBadge;`, context);
  return context;
}
test('main and routed rows (host-profile, container, restricted) show the badge from full and slim lists', () => {
  const { normalize, badge: render } = pipeline();
  const ask = { state: 'needs_you', ask: 'Your QR is ready. Scan it to connect your phone', subject: 'Phone' };
  for (const kind of ['main', 'host-profile', 'container', 'restricted']) {
    const agent = kind === 'main' ? '' : `qa-${kind}`;
    const full = normalize({ id: `qr-${kind}`, status: 'completed', agent, runtimeKind: kind, wizard_attention: ask, wizard_background: 'helper' });
    assert.equal(full.agent, agent);
    assert.equal(full.background, 'helper', `${kind} full row keeps background`);
    assert.match(render(full), /Helper still working/, `${kind} full row renders badge`);
    const slim = normalize({ listVersion: 1, id: `qr-${kind}`, status: 'completed', agent, attention: ask, background: 'heavy' });
    assert.match(render(slim), /Helper still working/, `${kind} slim row renders badge`);
    const working = normalize({ id: `fyi-${kind}`, status: 'running', agent, wizard_attention: { state: 'fyi', ask: 'Still building' }, wizard_background: 'helper', wizard_waiting_on: 'helper' });
    assert.equal(render(working), '', `${kind} Working row has no badge`);
    assert.equal(working.waitingOn, 'helper');
    const stray = normalize({ id: `x-${kind}`, status: 'completed', agent, wizard_attention: ask, wizard_background: 'root' });
    assert.equal(stray.background, '', 'unknown background values are dropped');
  }
});
