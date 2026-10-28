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
