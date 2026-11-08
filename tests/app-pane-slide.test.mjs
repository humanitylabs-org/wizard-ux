import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('AI apps pane: only the common desk slides; its title/window/body/frame never ease independently', () => {
 const css = read('web/layouts/ai-apps/desktop.css');
 const scoped = 'html[data-shell="desktop"][data-layout="ai-apps"] #stage > .wsp[data-aad-role="app"]';
 const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(r => r.split('{'));
 for (const suffix of [' > .aad-ptop', ' > .win', ' > .win > :is(.wbar, .wbody)', ' > .win > .wbody > iframe']) {
  const rule = rules.find(([selector]) => selector.split(',\n').some(s => s.trim() === scoped + suffix));
  assert.ok(rule, 'explicit child motion contract: ' + suffix);
  const transitions = rule[1].match(/transition:\s*([^;]+)/)?.[1];
  assert.ok(transitions, suffix);
  assert.doesNotMatch(transitions, /\b(all|transform|translate|left|right|width|inset)\b/, 'no independent positional transition');
 }
 assert.doesNotMatch(css, /\.aad-ptop\[data-aad-anim="app"\]\s*\{\s*animation:/, 'no separate title animation');
 assert.match(css, /prefers-reduced-motion: reduce[^}]*#stage > \.wsp[^}]*animation: none !important/s);
 const js = read('web/layouts/ai-apps/desktop.js');
 assert.match(js, /const headerHost = pane\?\.el \|\| top;/);
 assert.match(js, /headerHost\.append\(pTop\)/);
 assert.match(js, /kind === 'app' \? \[pane\?\.el\]/);
 assert.doesNotMatch(js, /flip\(\[pane\?\.el, pTop\]/, 'no nested FLIP double translation');
 assert.match(js, /goBack && !reduced\(\).*el0\.animate/s);
 assert.match(js, /top\.append\(pTop\);.*release layout-owned chrome/, 'teardown restores Classic ownership');
 assert.match(js, /closing\?\.\(\); closing = null; exitMotion\?\.cancel\?\.\(\)/, 'teardown cancels the parent exit animation as well as its timer');
});
