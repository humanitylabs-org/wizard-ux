// Source contracts only: these do not establish computed styles or browser pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const phone = read('web/styles.css');
const desktop = read('web/desktop/desktop.css');
const skins = read('web/core/skins.css');
const gate = ':where(html:not([data-skin="nebula"]), html[data-my-skin])';
const rules = css => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1].trim(), m[2].trim()]);
// Normalize only the known type-only prefix; retain all contextual and state selectors.
const rule = (css, selector) => rules(css).find(([s]) => s.replace(/(?:button|i|:is\(button, div, span(?:, i)?\))(?=:where\()/g, '') === selector)?.[1] || '';
const paint = /(?:^|;)\s*(?:background(?:-color)?|color|border-color)\s*:/;

test('stock voice paint uses a type-only specificity seam without weakening control geometry', () => {
  assert.ok(phone.includes('button:where(.arc)'));
  assert.ok(phone.includes('i:where(.arc-count)'));
  assert.ok(desktop.includes(':is(button, div, span):where(#voicePill)'));
  for (const selector of ['.arc', '.arc-count', '.device:not(.orb-corner) .voice .arc']) {
    assert.ok(rule(phone, selector), selector + ' retains geometry');
    assert.doesNotMatch(rule(phone, selector), paint, selector + ' paint is not a strong stock default');
    assert.match(rule(phone, ':where(' + selector + ')'), paint, selector + ' has weak stock paint');
  }
  assert.doesNotMatch(rule(phone, '.arc'), /(?:^|;)\s*border\s*:/, 'border shorthand must not reset the weak border-color');
  for (const selector of ['.arc:active', '.arc-left', '.arc-right', '.arc-right.has', '.device[data-voice="paused"] .arc-mid', '.device:not(.orb-corner)[data-voice="paused"] .voice .arc-mid']) {
    assert.equal(rule(phone, selector), '', selector + ' no strong state paint');
    assert.match(rule(phone, ':where(' + selector + ')'), paint);
  }
  for (const selector of ['#voicePill', '#voicePill .voice-tray', '#voicePill .lvl', '#voiceCancel', '#voicePill .voice-extras button']) {
    assert.ok(rule(desktop, selector), selector + ' retains geometry');
    assert.doesNotMatch(rule(desktop, selector), paint);
    assert.match(rule(desktop, ':where(' + selector + ')'), paint);
  }
  for (const selector of ['#voiceCancel:hover', '#voicePill .voice-extras button:hover:not(:disabled)']) {
    assert.equal(rule(desktop, selector), '');
    assert.match(rule(desktop, ':where(' + selector + ')'), paint);
  }
});

test('one shared low-specificity default covers non-Nebula AND active My skin, including states', () => {
  assert.ok(skins.includes(gate + ' :is(button, div, span, i):where(.arc)'), 'type-only specificity ties base.css button reset, then wins by load order');
  const expected = new Map([
    ['.arc', ['--wz-panel', '--ink', '--line-2']],
    ['.arc-left', ['--red']], ['.arc:active', ['--ink', '--wz-panel']],
    ['.arc-right.has', ['--violet', '--wz-panel']],
    ['.device[data-voice="paused"] .arc-mid', ['--amber', '--wz-panel']],
    ['.arc-count', ['--violet-2', '--bg']],
    ['#voicePill, #voicePill .voice-tray', ['--wz-panel', '--ink']],
    ['#voicePill .lvl', ['--ink']], ['#voiceCancel', ['--ink-2']],
    ['#voiceCancel:hover', ['--pink', '--ink']],
    ['#voicePill .voice-extras button', ['--ink']],
    ['#voicePill .voice-extras button:hover:not(:disabled)', ['--ink']],
  ]);
  for (const [selector, tokens] of expected) {
    const body = rule(skins, gate + ' :where(' + selector + ')');
    assert.ok(body, selector + ': context and state specificity stay inside :where; ordinary html[data-skin] overrides win');
    for (const token of tokens) assert.ok(body.includes('var(' + token), selector + ' uses ' + token);
    assert.doesNotMatch(body.replaceAll('#05030c', ''), /!important|#[0-9a-f]{3,8}\b|rgba?\(/i, 'tokens with only the standalone dark fallback');
    assert.doesNotMatch(body, /var\(--sk-tour\)/, 'a light My skin must not inherit Nebula tour-overlay navy');
  }
  assert.ok(!rules(skins).some(([s]) => s.includes('.arc') && !s.startsWith(gate)), 'no older generic .arc paint can outrank the shared seam');
  assert.match(rule(phone, ':where(.device:not(.orb-corner) .voice .arc)'), /rgba\(25, 15, 49, \.9\)/, 'uncustomized Nebula keeps original dock paint');
  assert.match(rule(desktop, ':where(#voicePill)'), /rgba\(16, 10, 30, \.82\)/, 'uncustomized Nebula keeps original pill paint');
});

test('real load and mutation seam supports live base/My skin switches without changing root skin identity', () => {
  for (const [entry, stock] of [['web/index.html', 'styles.css'], ['web/desktop.html', 'desktop/desktop.css']]) {
    const html = read(entry);
    assert.ok(html.indexOf('href="' + stock + '"') < html.indexOf('href="core/skins.css"'));
    assert.ok(html.indexOf('href="core/skins.css"') < html.indexOf('src="core/my-skin.js"'));
  }
  const my = read('web/core/my-skin.js');
  assert.match(my, /toggleAttribute\('data-my-skin', !off && !!own\(\) && !state\.empty\)/);
  assert.match(my, /head\.lastElementChild !== el\) head\.appendChild\(el\)/);
  assert.doesNotMatch(my, /(?:dataset\.skin\s*=|setAttribute\(['"]data-skin)/);
  assert.ok(skins.includes(gate), 'CSS responds to the real root attribute, not a synthetic My skin palette id');
});
