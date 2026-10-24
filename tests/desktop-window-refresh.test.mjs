import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');

test('every desktop window bar has a Refresh button wired to reloadWin', () => {
  assert.match(js, /\$\{reloadable\(w\) \? `<button data-wact="reload" title="Refresh \(\$\{MOD\}R\)"/);
  assert.match(js, /if \(act === 'reload'\) return reloadWin\(id\);/);
});

test('⌥R refreshes the focused window in place (no close/reopen)', () => {
  assert.match(js, /code === 'KeyR' && !shift\) return hit\(\(\) => \{ if \(!e\.repeat\) reloadCurrent\(\); \}\)/);
  const body = js.slice(js.indexOf('function reloadWin('), js.indexOf('function reloadCurrent('));
  assert.ok(!/closeWin\(/.test(body), 'refresh must not close the window');
  assert.match(body, /contentWindow\.location\.reload\(\)/, 'app frames reload at their current page');
  assert.ok(!/CHATS\./.test(body), 'Chats keeps its own live refresh; window refresh never touches chat state');
  assert.match(js, /const reloadable = w => !!w && w\.app !== 'chats';/);
  assert.match(body, /Restarted \$\{winTitle\(w\)\}/, 'cross-origin frames say they restarted, not refreshed');
});

test('Refresh is listed in the keys sheet and the command palette', () => {
  assert.match(js, /\[`\$\{MOD\}R`, 'Refresh window'\]/);
  assert.match(js, /name: 'Refresh window', icon: '↻', keys: `\$\{MOD\}R`/);
});

test('refresh confirms with the shell toast, not a new animation', () => {
  assert.match(js, /toast\('↻', `Refreshed \$\{winTitle\(w\)\}`, 900\)/);
});
