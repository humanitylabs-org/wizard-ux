// The boundary document template injects the shell token with sub_filter into text/html responses. nginx's
// built-in error pages are text/html with a <head>, so any refusal that falls back to them would carry the token
// (seen with real nginx 1.28 on wizard-os #386; tools/qa-browser-listener-gate.cjs checks the served bytes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tpl = readFileSync(new URL('../packaging/browser-boundary-document.conf.template', import.meta.url), 'utf8');
const rules = tpl.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));

test('boundary document refusals have their own non-HTML body, never an nginx error page', () => {
  assert.match(tpl, /^default_type text\/plain;$/m);
  const returns = rules.filter(l => /\breturn\s+\d{3}/.test(l));
  assert.ok(returns.length >= 3, 'navigation, mode and method refusals');
  for (const l of returns) assert.match(l, /return\s+40[35]\s+"[^"<]+";/, l);
  for (const l of rules) {
    assert.doesNotMatch(l, /\blimit_except\b|\bdeny\s+all\b|\berror_page\b/, 'access-phase denials use the built-in HTML page: ' + l);
    assert.doesNotMatch(l, /return\s+\d{3}\s*;/, 'bare return uses the built-in HTML page: ' + l);
  }
  assert.match(tpl, /if \(\$request_method !~ \^\(GET\|HEAD\)\$\) \{ return 405 /);
});
